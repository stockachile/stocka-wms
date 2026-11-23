-- =========================================================================================
-- WMS STOCKA - MIGRACIÓN: REVERSO AUDITADO DE MOVIMIENTOS KARDEX Y REVERSO AL CANCELAR PEDIDOS
-- Fecha: 2026-11-22
-- Incluye:
--   1. Trazabilidad inmutable de reversos en public.movements (sin borrado físico del historial)
--   2. Tabla de auditoría public.kardex_audit_logs (registro permanente de reversos)
--   3. Endurecimiento de RLS DELETE en public.movements (exclusivo Administradores)
--   4. Actualización de idempotencia en validate_order_stock_before_dispatch y
--      handle_order_status_change para considerar únicamente movimientos 'out' activos
--      (reversed_at IS NULL), permitiendo volver a descontar si un pedido reversado se reactiva
--   5. Actualización de RPC get_kardex_movements para exponer metadatos de reverso y vínculos
--   6. RPC get_order_reversible_stock_summary(UUID[]) para consultar salidas activas y RL previas
--   7. RPC cancel_orders_with_stock_reversal(UUID[], BOOLEAN, TEXT) atómico para cancelar pedidos
--      y opcionalmente generar contramovimientos 'in' + devolver stock físico en la misma bodega
--   8. RPC reverse_kardex_movement(UUID, TEXT, BOOLEAN) atómico para reversar un movimiento desde
--      Kardex (bloqueando doble reverso, transferencias individuales y stock negativo en 'in')
-- =========================================================================================

BEGIN;

-- =========================================================================================
-- 1. COLUMNAS E ÍNDICES DE TRAZABILIDAD DE REVERSOS EN public.movements
-- =========================================================================================
ALTER TABLE public.movements
  ADD COLUMN IF NOT EXISTS created_by_name TEXT,
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversed_by_name TEXT,
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT,
  ADD COLUMN IF NOT EXISTS reversal_movement_id UUID REFERENCES public.movements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversed_from_movement_id UUID REFERENCES public.movements(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.movements.reversed_at IS
  'Fecha y hora en que este movimiento fue reversado mediante un contramovimiento en Kardex.';
COMMENT ON COLUMN public.movements.reversed_by IS
  'UUID del usuario administrador que ejecutó el reverso.';
COMMENT ON COLUMN public.movements.reversed_by_name IS
  'Nombre o correo legible del administrador que ejecutó el reverso.';
COMMENT ON COLUMN public.movements.reversal_reason IS
  'Motivo obligatorio registrado al reversar este movimiento.';
COMMENT ON COLUMN public.movements.reversal_movement_id IS
  'UUID del contramovimiento generado que anuló el efecto de esta fila.';
COMMENT ON COLUMN public.movements.reversed_from_movement_id IS
  'UUID del movimiento original del cual esta fila es contramovimiento de reverso.';

CREATE INDEX IF NOT EXISTS idx_movements_order_id_active_out
  ON public.movements (order_id, product_id)
  WHERE order_id IS NOT NULL AND type = 'out' AND reversed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_movements_reversal_id
  ON public.movements (reversal_movement_id)
  WHERE reversal_movement_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_movements_reversed_from
  ON public.movements (reversed_from_movement_id)
  WHERE reversed_from_movement_id IS NOT NULL;


-- =========================================================================================
-- 2. TABLA DE AUDITORÍA PERMANENTE DE REVERSOS KARDEX (public.kardex_audit_logs)
-- =========================================================================================
CREATE TABLE IF NOT EXISTS public.kardex_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email TEXT,
  user_name TEXT,
  movement_id UUID REFERENCES public.movements(id) ON DELETE SET NULL,
  reversal_movement_id UUID REFERENCES public.movements(id) ON DELETE SET NULL,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  original_type TEXT,
  reversal_type TEXT,
  quantity INTEGER NOT NULL,
  reason TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_kardex_audit_logs_created_at
  ON public.kardex_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kardex_audit_logs_movement_id
  ON public.kardex_audit_logs (movement_id)
  WHERE movement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kardex_audit_logs_order_id
  ON public.kardex_audit_logs (order_id)
  WHERE order_id IS NOT NULL;

ALTER TABLE public.kardex_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins leen kardex_audit_logs" ON public.kardex_audit_logs;
CREATE POLICY "Admins leen kardex_audit_logs" ON public.kardex_audit_logs
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins insertan kardex_audit_logs" ON public.kardex_audit_logs;
CREATE POLICY "Admins insertan kardex_audit_logs" ON public.kardex_audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());


-- =========================================================================================
-- 3. ENDURECIMIENTO DE RLS EN public.movements (DELETE EXCLUSIVO ADMIN)
-- =========================================================================================
ALTER TABLE public.movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "movements_delete_policy" ON public.movements;
CREATE POLICY "movements_delete_policy" ON public.movements
  FOR DELETE TO authenticated
  USING (public.is_admin());


-- =========================================================================================
-- 4. ACTUALIZACIÓN DE IDEMPOTENCIA EN TRIGGERS DE STOCK DE PEDIDOS
--    Solo los movimientos 'out' NO reversados (reversed_at IS NULL) cuentan como salida activa.
--    Así, si un pedido se cancela + reversa stock y luego se reactiva y vuelve a despachar,
--    el sistema volverá a validar y descontar stock correctamente sin generar stock fantasma.
-- =========================================================================================

-- 4.1 Validación previa de stock antes de despacho / retiro
CREATE OR REPLACE FUNCTION public.validate_order_stock_before_dispatch()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  item RECORD;
  v_available_qty INTEGER;
  v_insufficient BOOLEAN := FALSE;
  v_user_id UUID;
  v_missing_sku TEXT;
  v_missing_qty INTEGER;
  v_wh_name TEXT;
  v_order_num TEXT;
  v_is_physical_auto BOOLEAN := FALSE;
  v_incident_title TEXT;
BEGIN
  v_order_num := COALESCE(NEW.external_order_number, NEW.id::text);

  -- 0. Idempotencia: si ya descontó stock activo (no reversado), ya estaba en salida física, o es backfill histórico (>14d), permitir siempre
  IF COALESCE(OLD.stock_descontado, FALSE) = TRUE
     OR COALESCE(NEW.stock_descontado, FALSE) = TRUE
     OR COALESCE(OLD.estado_wms, '') IN ('Listo para retiro', 'Despachado', 'Entregado')
     OR (COALESCE(NEW.closed_by_automation, '') LIKE 'backfill:%' AND COALESCE(OLD.created_at, NOW()) < NOW() - INTERVAL '14 days')
     OR EXISTS (
          SELECT 1 FROM public.movements
          WHERE order_id = NEW.id AND type = 'out' AND reversed_at IS NULL
     )
     OR EXISTS (
          SELECT 1 FROM public.movements m
          JOIN public.order_items oi ON oi.order_id = NEW.id AND oi.product_id = m.product_id
          WHERE m.order_id IS NULL
            AND m.type = 'out'
            AND m.reversed_at IS NULL
            AND (m.reference_doc = 'Pedido ' || v_order_num
                 OR m.reference_doc = 'Pedido #' || v_order_num
                 OR m.reference_doc = 'Pedido ' || NEW.id::text)
     )
  THEN
    RETURN NEW;
  END IF;

  v_is_physical_auto := (COALESCE(current_setting('app.physical_carrier_transition', true), 'false') = 'true')
                        OR (COALESCE(current_setting('app.picker_completed_transition', true), 'false') = 'true')
                        OR (NEW.closed_by_automation IS NOT NULL)
                        OR (NEW.estado_wms = 'Entregado')
                        OR (NEW.estado_wms = 'Listo para retiro' AND COALESCE(OLD.estado_wms, '') IN ('En preparación', 'Pickeado'));

  IF (NEW.status IN ('listo para retiro', 'despachado', 'entregado', 'retirado', 'en preparación') AND COALESCE(OLD.status, '') NOT IN ('listo para retiro', 'despachado', 'entregado', 'retirado', 'en preparación'))
     OR (NEW.estado_wms IN ('En preparación', 'Listo para retiro', 'Despachado', 'Entregado') AND COALESCE(OLD.estado_wms, '') NOT IN ('En preparación', 'Listo para retiro', 'Despachado', 'Entregado')) THEN

      IF NOT public.should_process_order_stock(NEW.id) THEN
        RETURN NEW;
      END IF;

      FOR item IN
        SELECT oi.*, p.sku, p.name AS prod_name, p.is_virtual, w.name AS wh_name
        FROM public.order_items oi
        JOIN public.products p ON p.id = oi.product_id
        JOIN public.warehouses w ON w.id = oi.warehouse_id
        WHERE oi.order_id = NEW.id
      LOOP
        IF COALESCE(item.is_virtual, FALSE) THEN
          CONTINUE;
        END IF;

        IF item.warehouse_id = 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09' THEN
          CONTINUE;
        END IF;

        SELECT COALESCE(quantity, 0) INTO v_available_qty
        FROM public.inventory
        WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;

        IF v_available_qty < item.quantity THEN
          v_insufficient := TRUE;
          v_missing_sku := item.sku;
          v_missing_qty := item.quantity - v_available_qty;
          v_wh_name := item.wh_name;
          EXIT;
        END IF;
      END LOOP;

      IF v_insufficient THEN
        SELECT id INTO v_user_id FROM public.profiles WHERE comercio ILIKE '%' || NEW.comercio || '%' LIMIT 1;

        IF v_is_physical_auto THEN
          v_incident_title := 'Cuadratura de stock post-salida - Pedido ' || v_order_num;
          IF NOT EXISTS (
            SELECT 1 FROM public.incidencias
            WHERE title = v_incident_title AND status = 'pendiente'
          ) THEN
            INSERT INTO public.incidencias (
              user_id, comercio, title, description, type, severity, status, solution
            ) VALUES (
              COALESCE(v_user_id, NEW.merchant_id),
              'ADMIN_ONLY',
              v_incident_title,
              'El pedido ' || v_order_num || ' (' || COALESCE(NEW.comercio, 'Sin comercio') || ') avanzó a "' || NEW.estado_wms || '" tras confirmación física de picking/transporte/retiro, pero en sistema faltaban ' || v_missing_qty || ' un. del SKU ' || v_missing_sku || ' en ' || v_wh_name || '. Se mantuvo el estado real del pedido y el inventario quedó en 0.',
              'stock',
              'alto',
              'pendiente',
              'Realizar conteo cíclico y ajuste de cuadratura del SKU ' || v_missing_sku || ' en ' || v_wh_name || '.'
            );
          END IF;
        ELSE
          NEW.status := 'para procesar';
          NEW.estado_wms := 'En procesamiento';
          NEW.ready_for_pickup_at := NULL;

          IF NOT EXISTS (
            SELECT 1 FROM public.incidencias
            WHERE comercio = NEW.comercio
              AND status = 'pendiente'
              AND title = 'Falta de stock crítico - Pedido ' || NEW.external_order_number
          ) THEN
            INSERT INTO public.incidencias (
              user_id, comercio, title, description, type, severity, status, solution
            ) VALUES (
              COALESCE(v_user_id, NEW.merchant_id),
              NEW.comercio,
              'Falta de stock crítico - Pedido ' || NEW.external_order_number,
              'El pedido ' || NEW.external_order_number || ' no se pudo procesar/despachar por falta de stock del SKU ' || v_missing_sku || ' en la bodega ' || v_wh_name || ' (Faltan ' || v_missing_qty || ' un.).',
              'stock',
              'critico',
              'pendiente',
              ''
            );
          END IF;
        END IF;
      END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 4.2 Control transaccional de stock por estado WMS (idempotente respecto a salidas activas)
CREATE OR REPLACE FUNCTION public.handle_order_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  item RECORD;
  v_old_wms TEXT;
  v_new_wms TEXT;
  v_is_virtual BOOLEAN;
  v_order_num TEXT;
  v_was_eligible BOOLEAN;
  v_is_eligible BOOLEAN;
BEGIN
  v_old_wms := COALESCE(OLD.estado_wms, 'En procesamiento');
  v_new_wms := COALESCE(NEW.estado_wms, 'En procesamiento');
  v_order_num := COALESCE(NEW.external_order_number, NEW.id::text);

  -- Marcas temporales operativas
  IF v_new_wms = 'Listo para retiro' THEN
    NEW.ready_for_pickup_at := COALESCE(NEW.ready_for_pickup_at, NOW());
    NEW.dispatched_at := COALESCE(NEW.dispatched_at, NEW.ready_for_pickup_at, NOW());
  ELSIF v_new_wms IN ('Despachado', 'Entregado') AND NEW.dispatched_at IS NULL THEN
    NEW.dispatched_at := COALESCE(NEW.stock_descontado_at, NOW());
  END IF;

  IF v_new_wms = 'Entregado' THEN
    NEW.delivered_at := COALESCE(NEW.delivered_at, NOW());
    NEW.closed_at := COALESCE(NEW.closed_at, NOW());
  END IF;

  IF NOT public.should_process_order_stock(NEW.id) THEN
    RETURN NEW;
  END IF;

  v_was_eligible := public.is_order_stock_eligible(OLD);
  v_is_eligible := public.is_order_stock_eligible(NEW);

  -- =========================================================================
  -- CASO 1: El pedido entra al grupo de salida física ('Listo para retiro', 'Despachado', 'Entregado')
  -- =========================================================================
  IF v_new_wms IN ('Listo para retiro', 'Despachado', 'Entregado')
     AND v_old_wms NOT IN ('Listo para retiro', 'Despachado', 'Entregado') THEN

    IF COALESCE(OLD.stock_descontado, false) = true
       OR (COALESCE(NEW.closed_by_automation, '') LIKE 'backfill:%' AND COALESCE(OLD.created_at, NOW()) < NOW() - INTERVAL '14 days')
       OR EXISTS (
            SELECT 1 FROM public.movements
            WHERE order_id = NEW.id AND type = 'out' AND reversed_at IS NULL
       )
       OR EXISTS (
            SELECT 1 FROM public.movements m
            JOIN public.order_items oi ON oi.order_id = NEW.id AND oi.product_id = m.product_id
            WHERE m.order_id IS NULL
              AND m.type = 'out'
              AND m.reversed_at IS NULL
              AND (m.reference_doc = 'Pedido ' || v_order_num
                   OR m.reference_doc = 'Pedido #' || v_order_num
                   OR m.reference_doc = 'Pedido ' || NEW.id::text)
       )
    THEN
      UPDATE public.movements m
      SET order_id = NEW.id
      FROM public.order_items oi
      WHERE m.order_id IS NULL
        AND m.type = 'out'
        AND m.reversed_at IS NULL
        AND oi.order_id = NEW.id
        AND oi.product_id = m.product_id
        AND (m.reference_doc = 'Pedido ' || v_order_num
             OR m.reference_doc = 'Pedido #' || v_order_num
             OR m.reference_doc = 'Pedido ' || NEW.id::text);

      FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
        SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
        IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
          IF v_old_wms IN ('En preparación', 'Pickeado') THEN
            UPDATE public.inventory
            SET reserved_quantity = GREATEST(0, reserved_quantity - item.quantity)
            WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
          ELSIF v_old_wms = 'En procesamiento' AND v_was_eligible THEN
            UPDATE public.inventory
            SET committed_quantity = GREATEST(0, committed_quantity - item.quantity)
            WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
          END IF;
        END IF;
      END LOOP;

      NEW.stock_descontado := true;
      NEW.stock_descontado_at := COALESCE(NEW.stock_descontado_at, NOW());
      RETURN NEW;
    END IF;

    FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
      SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
      IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN

        IF NOT EXISTS (
          SELECT 1 FROM public.movements
          WHERE order_id = NEW.id
            AND product_id = item.product_id
            AND type = 'out'
            AND reversed_at IS NULL
        ) THEN
          IF v_old_wms IN ('En preparación', 'Pickeado') THEN
            UPDATE public.inventory
            SET quantity = GREATEST(0, quantity - item.quantity),
                reserved_quantity = GREATEST(0, reserved_quantity - item.quantity)
            WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;

          ELSIF v_old_wms IN ('Cancelado', 'Archivado') THEN
            UPDATE public.inventory
            SET quantity = GREATEST(0, quantity - item.quantity)
            WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;

          ELSE
            UPDATE public.inventory
            SET quantity = GREATEST(0, quantity - item.quantity),
                committed_quantity = CASE WHEN v_was_eligible THEN GREATEST(0, committed_quantity - item.quantity) ELSE committed_quantity END
            WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
          END IF;

          INSERT INTO public.movements (product_id, warehouse_id, type, quantity, date, reference_doc, order_id)
          VALUES (item.product_id, item.warehouse_id, 'out', item.quantity, NOW(), 'Pedido ' || v_order_num, NEW.id);
        END IF;

      END IF;
    END LOOP;

    NEW.stock_descontado := true;
    NEW.stock_descontado_at := COALESCE(NEW.stock_descontado_at, NOW());

  -- =========================================================================
  -- CASO 2: El pedido pasa a "En preparación" o "Pickeado" (solo si aún no salió físicamente)
  -- =========================================================================
  ELSIF v_new_wms IN ('En preparación', 'Pickeado')
        AND v_old_wms NOT IN ('En preparación', 'Pickeado', 'Listo para retiro', 'Despachado', 'Entregado')
        AND COALESCE(OLD.stock_descontado, false) = false THEN

    FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
      SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
      IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
        IF v_old_wms = 'En procesamiento' AND v_was_eligible THEN
          UPDATE public.inventory
          SET committed_quantity = GREATEST(0, committed_quantity - item.quantity),
              reserved_quantity = reserved_quantity + item.quantity
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        ELSE
          UPDATE public.inventory
          SET reserved_quantity = reserved_quantity + item.quantity
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        END IF;
      END IF;
    END LOOP;

  -- =========================================================================
  -- CASO 3: El pedido se DEVUELVE de mesa ("En preparación"/"Pickeado") a "En procesamiento"
  -- =========================================================================
  ELSIF v_new_wms = 'En procesamiento'
        AND v_old_wms IN ('En preparación', 'Pickeado')
        AND v_old_wms NOT IN ('Listo para retiro', 'Despachado', 'Entregado')
        AND COALESCE(OLD.stock_descontado, false) = false THEN

    FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
      SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
      IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
        UPDATE public.inventory
        SET reserved_quantity = GREATEST(0, reserved_quantity - item.quantity)
        WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;

        IF v_is_eligible THEN
          UPDATE public.inventory
          SET committed_quantity = committed_quantity + item.quantity
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        END IF;
      END IF;
    END LOOP;

  -- =========================================================================
  -- CASO 4: El pedido se CANCELA o ARCHIVA en WMS antes de salir físicamente
  -- =========================================================================
  ELSIF v_new_wms IN ('Cancelado', 'Archivado')
        AND v_old_wms NOT IN ('Cancelado', 'Archivado', 'Listo para retiro', 'Despachado', 'Entregado') THEN

    FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
      SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
      IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
        IF v_old_wms IN ('En preparación', 'Pickeado') THEN
          UPDATE public.inventory
          SET reserved_quantity = GREATEST(0, reserved_quantity - item.quantity)
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        ELSIF v_was_eligible THEN
          UPDATE public.inventory
          SET committed_quantity = GREATEST(0, committed_quantity - item.quantity)
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        END IF;
      END IF;
    END LOOP;

  -- =========================================================================
  -- CASO 5: Transición de Elegibilidad de Stock en Estante ('En procesamiento')
  -- =========================================================================
  ELSIF v_new_wms = 'En procesamiento'
        AND v_old_wms IN ('En procesamiento', 'Cancelado', 'Archivado', 'Incidencia')
        AND COALESCE(OLD.stock_descontado, false) = false THEN
    IF NOT v_was_eligible AND v_is_eligible THEN
      FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
        SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
        IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
          UPDATE public.inventory
          SET committed_quantity = committed_quantity + item.quantity
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        END IF;
      END LOOP;
    ELSIF v_was_eligible AND NOT v_is_eligible THEN
      FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
        SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
        IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
          UPDATE public.inventory
          SET committed_quantity = GREATEST(0, committed_quantity - item.quantity)
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        END IF;
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;


-- =========================================================================================
-- 5. ACTUALIZACIÓN DE RPC get_kardex_movements (EXPONE METADATOS DE REVERSO Y VÍNCULOS)
-- =========================================================================================
DROP FUNCTION IF EXISTS public.get_kardex_movements(text, uuid, uuid, timestamptz, timestamptz, int);

CREATE OR REPLACE FUNCTION public.get_kardex_movements(
  p_commerce text DEFAULT NULL,
  p_product_id uuid DEFAULT NULL,
  p_warehouse_id uuid DEFAULT NULL,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL,
  p_limit int DEFAULT 2500
)
RETURNS TABLE (
  id uuid,
  date timestamptz,
  type text,
  quantity numeric,
  reference_doc text,
  warehouse_id uuid,
  warehouse_name text,
  product_id uuid,
  product_sku text,
  product_name text,
  product_comercio text,
  order_id uuid,
  transfer_id uuid,
  created_by_name text,
  reversed_at timestamptz,
  reversed_by_name text,
  reversal_reason text,
  reversal_movement_id uuid,
  reversed_from_movement_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.date,
    m.type,
    m.quantity::numeric,
    m.reference_doc,
    m.warehouse_id,
    COALESCE(w.name, 'Bodega Principal') AS warehouse_name,
    p.id AS product_id,
    COALESCE(p.sku, 'SIN-SKU') AS product_sku,
    COALESCE(p.name, 'Producto sin nombre') AS product_name,
    COALESCE(p.comercio, 'Sin Comercio') AS product_comercio,
    m.order_id,
    m.transfer_id,
    m.created_by_name,
    m.reversed_at,
    m.reversed_by_name,
    m.reversal_reason,
    m.reversal_movement_id,
    m.reversed_from_movement_id
  FROM public.movements m
  LEFT JOIN public.products p ON p.id = m.product_id
  LEFT JOIN public.warehouses w ON w.id = m.warehouse_id
  WHERE (p_commerce IS NULL OR p_commerce = '' OR p.comercio = p_commerce)
    AND (p_product_id IS NULL OR m.product_id = p_product_id)
    AND (p_warehouse_id IS NULL OR m.warehouse_id = p_warehouse_id)
    AND (p_start_date IS NULL OR m.date >= p_start_date)
    AND (p_end_date IS NULL OR m.date <= p_end_date)
  ORDER BY m.date DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_kardex_movements(text, uuid, uuid, timestamptz, timestamptz, int)
  TO authenticated, anon, service_role;


-- =========================================================================================
-- 6. RPC: CONSULTAR RESUMEN DE STOCK REVERSIBLE DE UNO O VARIOS PEDIDOS ANTES DE CANCELAR
-- =========================================================================================
CREATE OR REPLACE FUNCTION public.get_order_reversible_stock_summary(
  p_order_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
  v_order public.orders;
  v_order_num TEXT;
  v_clean_ext TEXT;
  v_movs JSONB;
  v_total_units INTEGER;
  v_rl RECORD;
  v_rl_json JSONB;
  v_existing_in_units INTEGER;
  v_result JSONB := '[]'::jsonb;
BEGIN
  IF NOT public.is_admin()
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Acceso denegado: Se requieren privilegios de administrador.';
  END IF;

  IF p_order_ids IS NULL OR cardinality(p_order_ids) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  FOREACH v_order_id IN ARRAY p_order_ids LOOP
    SELECT * INTO v_order FROM public.orders WHERE id = v_order_id;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_order_num := COALESCE(NULLIF(TRIM(v_order.external_order_number), ''), v_order.id::text);
    v_clean_ext := UPPER(REGEXP_REPLACE(TRIM(COALESCE(v_order.external_order_number, '')), '^#+', ''));

    -- Buscar salidas ('out') activas (no reversadas) vinculadas por order_id o por referencia legado
    SELECT
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', sub.id,
          'product_id', sub.product_id,
          'sku', sub.sku,
          'product_name', sub.product_name,
          'warehouse_id', sub.warehouse_id,
          'warehouse_name', sub.warehouse_name,
          'quantity', sub.quantity,
          'date', sub.date,
          'reference_doc', sub.reference_doc,
          'type', sub.type
        ) ORDER BY sub.date ASC
      ), '[]'::jsonb),
      COALESCE(SUM(sub.quantity), 0)::integer
    INTO v_movs, v_total_units
    FROM (
      SELECT
        m.id,
        m.product_id,
        COALESCE(p.sku, 'SIN-SKU') AS sku,
        COALESCE(p.name, 'Producto') AS product_name,
        m.warehouse_id,
        COALESCE(w.name, 'Bodega Principal') AS warehouse_name,
        m.quantity,
        m.date,
        m.reference_doc,
        m.type
      FROM public.movements m
      LEFT JOIN public.products p ON p.id = m.product_id
      LEFT JOIN public.warehouses w ON w.id = m.warehouse_id
      WHERE m.type = 'out'
        AND m.reversed_at IS NULL
        AND (
          m.order_id = v_order.id
          OR (
            m.order_id IS NULL
            AND EXISTS (
              SELECT 1 FROM public.order_items oi
              WHERE oi.order_id = v_order.id AND oi.product_id = m.product_id
            )
            AND (
              m.reference_doc = 'Pedido ' || v_order_num
              OR m.reference_doc = 'Pedido #' || v_order_num
              OR m.reference_doc = 'Pedido ' || v_order.id::text
            )
          )
        )
    ) sub;

    -- Verificar si ya existe una Orden de Logística Inversa vinculada (para advertir posible doble reingreso)
    v_rl_json := NULL;
    SELECT
      rl.id,
      rl.status,
      COALESCE(rl.inventory_restocked, FALSE) AS inventory_restocked,
      rl.tipo_movimiento,
      rl.wms_order_id,
      rl.referencia_pedido,
      rl.created_at
    INTO v_rl
    FROM public.reverse_logistics rl
    WHERE COALESCE(LOWER(rl.status), '') <> 'rechazado'
      AND (
        rl.origen_order_id = v_order.id
        OR rl.wms_order_id = v_order.id
        OR (
          v_clean_ext <> ''
          AND UPPER(REGEXP_REPLACE(TRIM(COALESCE(rl.referencia_pedido, '')), '^#+', '')) = v_clean_ext
          AND (
            v_order.comercio IS NULL
            OR rl.comercio IS NULL
            OR UPPER(TRIM(rl.comercio)) = UPPER(TRIM(v_order.comercio))
          )
        )
      )
    ORDER BY rl.created_at DESC
    LIMIT 1;

    IF FOUND THEN
      v_rl_json := jsonb_build_object(
        'id', v_rl.id,
        'status', v_rl.status,
        'inventory_restocked', v_rl.inventory_restocked,
        'tipo_movimiento', v_rl.tipo_movimiento,
        'wms_order_id', v_rl.wms_order_id,
        'referencia_pedido', v_rl.referencia_pedido,
        'created_at', v_rl.created_at
      );
    END IF;

    -- Contar unidades ya reingresadas vía devolución / ingreso directo vinculado al pedido o a su orden LI
    SELECT COALESCE(SUM(m.quantity), 0)::integer
    INTO v_existing_in_units
    FROM public.movements m
    WHERE m.type = 'in'
      AND m.reversed_at IS NULL
      AND (
        m.order_id = v_order.id
        OR (v_rl_json IS NOT NULL AND (v_rl_json->>'wms_order_id') IS NOT NULL AND m.order_id = (v_rl_json->>'wms_order_id')::uuid)
      );

    v_result := v_result || jsonb_build_array(
      jsonb_build_object(
        'order_id', v_order.id,
        'external_order_number', v_order_num,
        'comercio', COALESCE(v_order.comercio, ''),
        'estado_wms', COALESCE(v_order.estado_wms, 'En procesamiento'),
        'status', COALESCE(v_order.status, ''),
        'stock_descontado', COALESCE(v_order.stock_descontado, FALSE),
        'has_active_out', (v_total_units > 0),
        'total_units', v_total_units,
        'movements', v_movs,
        'existing_rl', v_rl_json,
        'existing_in_units', v_existing_in_units
      )
    );
  END LOOP;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_order_reversible_stock_summary(UUID[])
  TO authenticated, service_role;


-- =========================================================================================
-- 7. RPC ATÓMICO: CANCELAR PEDIDO(S) CON OPCIÓN DE REVERSAR UNIDADES AL STOCK + KARDEX
-- =========================================================================================
CREATE OR REPLACE FUNCTION public.cancel_orders_with_stock_reversal(
  p_order_ids UUID[],
  p_reverse_stock BOOLEAN DEFAULT FALSE,
  p_reason TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
  v_order public.orders;
  v_order_num TEXT;
  v_clean_reason TEXT := TRIM(COALESCE(p_reason, ''));
  v_user_email TEXT;
  v_actor_name TEXT;
  v_mov RECORD;
  v_rev_mov_id UUID;
  v_prev_qty INTEGER;
  v_new_qty INTEGER;
  v_sku TEXT;
  v_wh_name TEXT;
  v_order_rev_units INTEGER;
  v_order_rev_movs INTEGER;
  v_order_changes JSONB;
  v_cancelled_count INTEGER := 0;
  v_reversed_orders_count INTEGER := 0;
  v_reversed_movs_total INTEGER := 0;
  v_reversed_units_total INTEGER := 0;
  v_details JSONB := '[]'::jsonb;
  v_had_active_out BOOLEAN;
BEGIN
  -- 1. Validar permisos de administrador
  IF NOT public.is_admin()
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Acceso denegado: Se requieren privilegios de administrador para cancelar y reversar stock.';
  END IF;

  IF p_order_ids IS NULL OR cardinality(p_order_ids) = 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'cancelled_orders_count', 0,
      'reversed_orders_count', 0,
      'reversed_movements_count', 0,
      'reversed_units_total', 0,
      'details', '[]'::jsonb
    );
  END IF;

  IF p_reverse_stock AND LENGTH(v_clean_reason) < 4 THEN
    RAISE EXCEPTION 'MOTIVO_REQUERIDO: Debes ingresar un motivo válido (mínimo 4 caracteres) para reversar unidades a inventario.';
  END IF;

  SELECT
    email,
    COALESCE(
      NULLIF(TRIM(raw_user_meta_data->>'full_name'), ''),
      NULLIF(TRIM(raw_user_meta_data->>'name'), ''),
      email,
      'Admin'
    )
  INTO v_user_email, v_actor_name
  FROM auth.users
  WHERE id = auth.uid();

  v_user_email := COALESCE(v_user_email, 'Admin');
  v_actor_name := COALESCE(v_actor_name, v_user_email, 'Admin');

  FOREACH v_order_id IN ARRAY p_order_ids LOOP
    SELECT * INTO v_order
    FROM public.orders
    WHERE id = v_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_order_num := COALESCE(NULLIF(TRIM(v_order.external_order_number), ''), v_order.id::text);

    IF COALESCE(v_order.estado_wms, '') = 'Entregado' THEN
      RAISE EXCEPTION 'PEDIDO_ENTREGADO_CONGELADO: El pedido % está finalizado en estado "Entregado". Reábrelo primero con Reapertura Administrativa para poder cancelarlo.', v_order_num;
    END IF;

    v_order_rev_units := 0;
    v_order_rev_movs := 0;
    v_order_changes := '[]'::jsonb;
    v_had_active_out := FALSE;

    -- Enlazar primero cualquier movimiento legado (order_id IS NULL) perteneciente a este pedido
    UPDATE public.movements m
    SET order_id = v_order.id
    FROM public.order_items oi
    WHERE m.order_id IS NULL
      AND m.type = 'out'
      AND m.reversed_at IS NULL
      AND oi.order_id = v_order.id
      AND oi.product_id = m.product_id
      AND (
        m.reference_doc = 'Pedido ' || v_order_num
        OR m.reference_doc = 'Pedido #' || v_order_num
        OR m.reference_doc = 'Pedido ' || v_order.id::text
      );

    SELECT EXISTS (
      SELECT 1 FROM public.movements
      WHERE order_id = v_order.id AND type = 'out' AND reversed_at IS NULL
    ) INTO v_had_active_out;

    IF p_reverse_stock AND v_had_active_out THEN
      FOR v_mov IN
        SELECT *
        FROM public.movements
        WHERE order_id = v_order.id
          AND type = 'out'
          AND reversed_at IS NULL
        ORDER BY date ASC
        FOR UPDATE
      LOOP
        IF v_mov.product_id IS NULL OR v_mov.warehouse_id IS NULL THEN
          RAISE EXCEPTION 'MOVIMIENTO_INCOMPLETO: El movimiento % del pedido % no tiene producto o bodega asignada y no puede reversarse automáticamente.', v_mov.id, v_order_num;
        END IF;

        SELECT COALESCE(sku, 'SIN-SKU') INTO v_sku FROM public.products WHERE id = v_mov.product_id;
        SELECT COALESCE(name, 'Bodega Principal') INTO v_wh_name FROM public.warehouses WHERE id = v_mov.warehouse_id;

        -- Sumar de vuelta al inventario físico de la misma bodega donde se descontó
        SELECT quantity INTO v_prev_qty
        FROM public.inventory
        WHERE product_id = v_mov.product_id AND warehouse_id = v_mov.warehouse_id
        FOR UPDATE;

        IF FOUND THEN
          v_prev_qty := COALESCE(v_prev_qty, 0);
          v_new_qty := v_prev_qty + v_mov.quantity;
          UPDATE public.inventory
          SET quantity = v_new_qty,
              updated_at = NOW()
          WHERE product_id = v_mov.product_id AND warehouse_id = v_mov.warehouse_id;
        ELSE
          v_prev_qty := 0;
          v_new_qty := v_mov.quantity;
          INSERT INTO public.inventory (product_id, warehouse_id, quantity, committed_quantity, reserved_quantity)
          VALUES (v_mov.product_id, v_mov.warehouse_id, v_new_qty, 0, 0);
        END IF;

        -- Insertar contramovimiento 'in' en Kardex (historial 100% inmutable)
        INSERT INTO public.movements (
          product_id,
          warehouse_id,
          type,
          quantity,
          date,
          order_id,
          reference_doc,
          created_by_name,
          reversed_from_movement_id
        ) VALUES (
          v_mov.product_id,
          v_mov.warehouse_id,
          'in',
          v_mov.quantity,
          NOW(),
          v_order.id,
          'Reverso por cancelación Pedido ' || v_order_num || ' · ' || LEFT(v_clean_reason, 140),
          v_actor_name,
          v_mov.id
        )
        RETURNING id INTO v_rev_mov_id;

        -- Marcar el movimiento original como reversado
        UPDATE public.movements
        SET
          reversed_at = NOW(),
          reversed_by = auth.uid(),
          reversed_by_name = v_actor_name,
          reversal_reason = v_clean_reason,
          reversal_movement_id = v_rev_mov_id
        WHERE id = v_mov.id;

        -- Auditoría permanente de Kardex
        INSERT INTO public.kardex_audit_logs (
          action,
          user_id,
          user_email,
          user_name,
          movement_id,
          reversal_movement_id,
          order_id,
          product_id,
          warehouse_id,
          original_type,
          reversal_type,
          quantity,
          reason,
          metadata
        ) VALUES (
          'reverse_order_on_cancel',
          auth.uid(),
          v_user_email,
          v_actor_name,
          v_mov.id,
          v_rev_mov_id,
          v_order.id,
          v_mov.product_id,
          v_mov.warehouse_id,
          'out',
          'in',
          v_mov.quantity,
          v_clean_reason,
          jsonb_build_object(
            'order_number', v_order_num,
            'comercio', v_order.comercio,
            'sku', v_sku,
            'warehouse_name', v_wh_name,
            'previous_stock', v_prev_qty,
            'new_stock', v_new_qty,
            'previous_estado_wms', v_order.estado_wms,
            'original_reference_doc', v_mov.reference_doc
          )
        );

        v_order_rev_units := v_order_rev_units + v_mov.quantity;
        v_order_rev_movs := v_order_rev_movs + 1;
        v_order_changes := v_order_changes || jsonb_build_array(
          'Reverso de stock: +' || v_mov.quantity || ' un. de SKU ' || v_sku || ' en ' || v_wh_name || ' (' || v_prev_qty || ' -> ' || v_new_qty || ')'
        );
      END LOOP;
    END IF;

    -- Actualizar el estado del pedido a Cancelado (y resetear stock_descontado si se reversaron todas sus salidas)
    IF v_order_rev_movs > 0 THEN
      UPDATE public.orders
      SET
        estado_wms = 'Cancelado',
        status = 'cancelado',
        stock_descontado = FALSE,
        stock_descontado_at = NULL
      WHERE id = v_order.id;

      v_reversed_orders_count := v_reversed_orders_count + 1;
      v_reversed_movs_total := v_reversed_movs_total + v_order_rev_movs;
      v_reversed_units_total := v_reversed_units_total + v_order_rev_units;

      INSERT INTO public.order_audit_logs (order_id, user_id, user_email, action, details)
      VALUES (
        v_order.id,
        auth.uid(),
        v_user_email,
        'Cancelación de Pedido con Reverso de Stock',
        jsonb_build_object(
          'previous_wms_status', v_order.estado_wms,
          'new_wms_status', 'Cancelado',
          'reversed_stock', true,
          'reversed_units', v_order_rev_units,
          'reversed_movements_count', v_order_rev_movs,
          'reason', v_clean_reason,
          'changes', jsonb_build_array(
            'Pedido cancelado desde "' || COALESCE(v_order.estado_wms, 'En procesamiento') || '" con reverso de +' || v_order_rev_units || ' un. al inventario. Motivo: ' || v_clean_reason
          ) || v_order_changes
        )
      );
    ELSE
      UPDATE public.orders
      SET
        estado_wms = 'Cancelado',
        status = 'cancelado'
      WHERE id = v_order.id;

      IF v_had_active_out OR COALESCE(v_order.stock_descontado, FALSE) = TRUE THEN
        INSERT INTO public.order_audit_logs (order_id, user_id, user_email, action, details)
        VALUES (
          v_order.id,
          auth.uid(),
          v_user_email,
          'Cancelación de Pedido (Sin Reverso de Stock)',
          jsonb_build_object(
            'previous_wms_status', v_order.estado_wms,
            'new_wms_status', 'Cancelado',
            'reversed_stock', false,
            'reason', NULLIF(v_clean_reason, ''),
            'changes', jsonb_build_array(
              'Pedido cancelado desde "' || COALESCE(v_order.estado_wms, 'En procesamiento') || '" manteniendo el stock descontado (sin reverso automático).'
            )
          )
        );
      END IF;
    END IF;

    v_cancelled_count := v_cancelled_count + 1;
    v_details := v_details || jsonb_build_array(
      jsonb_build_object(
        'order_id', v_order.id,
        'external_order_number', v_order_num,
        'reversed_units', v_order_rev_units,
        'reversed_movements', v_order_rev_movs,
        'stock_descontado', CASE WHEN v_order_rev_movs > 0 THEN FALSE ELSE COALESCE(v_order.stock_descontado, FALSE) END
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'cancelled_orders_count', v_cancelled_count,
    'reversed_orders_count', v_reversed_orders_count,
    'reversed_movements_count', v_reversed_movs_total,
    'reversed_units_total', v_reversed_units_total,
    'details', v_details
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_orders_with_stock_reversal(UUID[], BOOLEAN, TEXT)
  TO authenticated, service_role;


-- =========================================================================================
-- 8. RPC ATÓMICO: REVERSAR UN MOVIMIENTO INDIVIDUAL DESDE KARDEX (EXCLUSIVO ADMIN)
--    - Inmutable: conserva el movimiento original marcado como Reversado y crea contramovimiento
--    - Bloquea doble reverso, reverso de contramovimiento, transferencias individuales y stock negativo
--    - Coordina orders.stock_descontado + order_audit_logs cuando corresponde
-- =========================================================================================
CREATE OR REPLACE FUNCTION public.reverse_kardex_movement(
  p_movement_id UUID,
  p_reason TEXT,
  p_sync_order_flag BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mov public.movements;
  v_clean_reason TEXT := TRIM(COALESCE(p_reason, ''));
  v_user_email TEXT;
  v_actor_name TEXT;
  v_counter_type TEXT;
  v_delta INTEGER;
  v_prev_qty INTEGER;
  v_new_qty INTEGER;
  v_rev_mov_id UUID;
  v_sku TEXT;
  v_prod_name TEXT;
  v_comercio TEXT;
  v_wh_name TEXT;
  v_ref_doc TEXT;
  v_order public.orders;
  v_remaining_active_outs INTEGER := 0;
  v_order_flag_reset BOOLEAN := FALSE;
  v_order_num TEXT;
  v_order_estado_wms TEXT;
BEGIN
  -- 1. Validar permisos de administrador
  IF NOT public.is_admin()
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Acceso denegado: Solo un Administrador puede reversar movimientos del Kardex.';
  END IF;

  IF LENGTH(v_clean_reason) < 5 THEN
    RAISE EXCEPTION 'MOTIVO_REQUERIDO: Debes ingresar un motivo de auditoría válido (mínimo 5 caracteres) para reversar este movimiento.';
  END IF;

  -- 2. Bloquear la fila del movimiento para evitar condiciones de carrera / doble clic
  SELECT * INTO v_mov
  FROM public.movements
  WHERE id = p_movement_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MOVIMIENTO_NO_ENCONTRADO: El movimiento de Kardex solicitado no existe.';
  END IF;

  -- 3. Protecciones de integridad
  IF v_mov.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'MOVIMIENTO_YA_REVERSADO: Este movimiento ya fue reversado el % por %.',
      TO_CHAR(v_mov.reversed_at AT TIME ZONE 'America/Santiago', 'DD-MM-YYYY HH24:MI'),
      COALESCE(v_mov.reversed_by_name, 'Admin');
  END IF;

  IF v_mov.reversed_from_movement_id IS NOT NULL THEN
    RAISE EXCEPTION 'CONTRAMOVIMIENTO_BLOQUEADO: Esta fila ya corresponde a un contramovimiento de reverso y no puede volver a reversarse en cadena.';
  END IF;

  IF v_mov.transfer_id IS NOT NULL
     OR COALESCE(v_mov.reference_doc, '') ~* '\[#TRF-[A-Z0-9-]+\]' THEN
    RAISE EXCEPTION 'TRANSFER_MOVEMENT_BLOCKED: Este movimiento pertenece a una Transferencia entre Bodegas. Para mantener cuadradas bodega origen y destino, reviértela desde el módulo de Transferencias.';
  END IF;

  IF v_mov.type NOT IN ('in', 'out') OR COALESCE(v_mov.quantity, 0) <= 0 THEN
    RAISE EXCEPTION 'MOVIMIENTO_INVALIDO: Tipo o cantidad de movimiento no válida para reverso.';
  END IF;

  IF v_mov.product_id IS NULL OR v_mov.warehouse_id IS NULL THEN
    RAISE EXCEPTION 'MOVIMIENTO_INCOMPLETO: Este movimiento no tiene producto o bodega asignada y no puede reversarse automáticamente.';
  END IF;

  SELECT
    email,
    COALESCE(
      NULLIF(TRIM(raw_user_meta_data->>'full_name'), ''),
      NULLIF(TRIM(raw_user_meta_data->>'name'), ''),
      email,
      'Admin'
    )
  INTO v_user_email, v_actor_name
  FROM auth.users
  WHERE id = auth.uid();

  v_user_email := COALESCE(v_user_email, 'Admin');
  v_actor_name := COALESCE(v_actor_name, v_user_email, 'Admin');

  SELECT COALESCE(sku, 'SIN-SKU'), COALESCE(name, 'Producto'), COALESCE(comercio, '')
  INTO v_sku, v_prod_name, v_comercio
  FROM public.products
  WHERE id = v_mov.product_id;
  v_sku := COALESCE(v_sku, 'SIN-SKU');
  v_prod_name := COALESCE(v_prod_name, 'Producto');
  v_comercio := COALESCE(v_comercio, '');

  SELECT COALESCE(name, 'Bodega Principal')
  INTO v_wh_name
  FROM public.warehouses
  WHERE id = v_mov.warehouse_id;
  v_wh_name := COALESCE(v_wh_name, 'Bodega Principal');

  v_counter_type := CASE WHEN v_mov.type = 'out' THEN 'in' ELSE 'out' END;
  v_delta := CASE WHEN v_mov.type = 'out' THEN v_mov.quantity ELSE -v_mov.quantity END;

  -- 4. Ajustar inventario físico atómicamente (bloqueando fila en inventory)
  SELECT quantity INTO v_prev_qty
  FROM public.inventory
  WHERE product_id = v_mov.product_id AND warehouse_id = v_mov.warehouse_id
  FOR UPDATE;

  IF NOT FOUND THEN
    IF v_delta < 0 THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK_FOR_REVERSAL: No se puede reversar este ingreso de % un. porque el SKU % no tiene stock físico disponible en % (stock actual: 0).',
        v_mov.quantity, v_sku, v_wh_name;
    END IF;
    v_prev_qty := 0;
    v_new_qty := v_delta;
    INSERT INTO public.inventory (product_id, warehouse_id, quantity, committed_quantity, reserved_quantity)
    VALUES (v_mov.product_id, v_mov.warehouse_id, v_new_qty, 0, 0);
  ELSE
    v_prev_qty := COALESCE(v_prev_qty, 0);
    IF v_delta < 0 AND v_prev_qty < v_mov.quantity THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK_FOR_REVERSAL: No se puede reversar este ingreso de % un. del SKU % porque % solo tiene % un. físicas disponibles (el stock no puede quedar negativo).',
        v_mov.quantity, v_sku, v_wh_name, v_prev_qty;
    END IF;
    v_new_qty := v_prev_qty + v_delta;
    UPDATE public.inventory
    SET quantity = v_new_qty,
        updated_at = NOW()
    WHERE product_id = v_mov.product_id AND warehouse_id = v_mov.warehouse_id;
  END IF;

  -- 5. Insertar contramovimiento en Kardex
  v_ref_doc := 'Reverso Kardex [' || COALESCE(NULLIF(TRIM(v_mov.reference_doc), ''), 'Mov ' || LEFT(v_mov.id::text, 8)) || '] · ' || LEFT(v_clean_reason, 140);

  INSERT INTO public.movements (
    product_id,
    warehouse_id,
    type,
    quantity,
    date,
    order_id,
    reference_doc,
    created_by_name,
    reversed_from_movement_id
  ) VALUES (
    v_mov.product_id,
    v_mov.warehouse_id,
    v_counter_type,
    v_mov.quantity,
    NOW(),
    v_mov.order_id,
    v_ref_doc,
    v_actor_name,
    v_mov.id
  )
  RETURNING id INTO v_rev_mov_id;

  -- 6. Marcar movimiento original como reversado
  UPDATE public.movements
  SET
    reversed_at = NOW(),
    reversed_by = auth.uid(),
    reversed_by_name = v_actor_name,
    reversal_reason = v_clean_reason,
    reversal_movement_id = v_rev_mov_id
  WHERE id = v_mov.id;

  -- 7. Si el movimiento estaba vinculado a un pedido, coordinar flag stock_descontado y auditoría del pedido
  IF v_mov.order_id IS NOT NULL THEN
    SELECT * INTO v_order FROM public.orders WHERE id = v_mov.order_id FOR UPDATE;
    IF FOUND THEN
      v_order_num := COALESCE(NULLIF(TRIM(v_order.external_order_number), ''), v_order.id::text);
      v_order_estado_wms := v_order.estado_wms;

      IF v_mov.type = 'out' AND p_sync_order_flag AND COALESCE(v_order.estado_wms, '') <> 'Entregado' THEN
        SELECT COUNT(*)::integer INTO v_remaining_active_outs
        FROM public.movements
        WHERE order_id = v_order.id
          AND type = 'out'
          AND reversed_at IS NULL;

        IF v_remaining_active_outs = 0 AND COALESCE(v_order.stock_descontado, FALSE) = TRUE THEN
          UPDATE public.orders
          SET stock_descontado = FALSE,
              stock_descontado_at = NULL
          WHERE id = v_order.id;
          v_order_flag_reset := TRUE;
        END IF;
      END IF;

      INSERT INTO public.order_audit_logs (order_id, user_id, user_email, action, details)
      VALUES (
        v_order.id,
        auth.uid(),
        v_user_email,
        'Reverso de Movimiento Kardex (Admin)',
        jsonb_build_object(
          'movement_id', v_mov.id,
          'reversal_movement_id', v_rev_mov_id,
          'sku', v_sku,
          'warehouse_name', v_wh_name,
          'original_type', v_mov.type,
          'reversal_type', v_counter_type,
          'quantity', v_mov.quantity,
          'previous_stock', v_prev_qty,
          'new_stock', v_new_qty,
          'order_stock_descontado_reset', v_order_flag_reset,
          'reason', v_clean_reason,
          'changes', jsonb_build_array(
            'Reverso manual en Kardex de ' ||
            CASE WHEN v_mov.type = 'out' THEN 'Salida (-' ELSE 'Ingreso (+' END || v_mov.quantity || ') SKU ' || v_sku ||
            ' en ' || v_wh_name || ' (' || v_prev_qty || ' -> ' || v_new_qty || '). Motivo: ' || v_clean_reason ||
            CASE WHEN v_order_flag_reset THEN ' [Indicador stock_descontado restablecido a false]' ELSE '' END
          )
        )
      );
    END IF;
  END IF;

  -- 8. Registrar en auditoría permanente de Kardex
  INSERT INTO public.kardex_audit_logs (
    action,
    user_id,
    user_email,
    user_name,
    movement_id,
    reversal_movement_id,
    order_id,
    product_id,
    warehouse_id,
    original_type,
    reversal_type,
    quantity,
    reason,
    metadata
  ) VALUES (
    'reverse_movement',
    auth.uid(),
    v_user_email,
    v_actor_name,
    v_mov.id,
    v_rev_mov_id,
    v_mov.order_id,
    v_mov.product_id,
    v_mov.warehouse_id,
    v_mov.type,
    v_counter_type,
    v_mov.quantity,
    v_clean_reason,
    jsonb_build_object(
      'sku', v_sku,
      'product_name', v_prod_name,
      'comercio', v_comercio,
      'warehouse_name', v_wh_name,
      'previous_stock', v_prev_qty,
      'new_stock', v_new_qty,
      'original_reference_doc', v_mov.reference_doc,
      'original_date', v_mov.date,
      'order_number', v_order_num,
      'order_estado_wms', v_order_estado_wms,
      'order_stock_descontado_reset', v_order_flag_reset
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'movement_id', v_mov.id,
    'reversal_movement_id', v_rev_mov_id,
    'product_id', v_mov.product_id,
    'sku', v_sku,
    'warehouse_id', v_mov.warehouse_id,
    'warehouse_name', v_wh_name,
    'original_type', v_mov.type,
    'reversal_type', v_counter_type,
    'quantity', v_mov.quantity,
    'previous_stock', v_prev_qty,
    'new_stock', v_new_qty,
    'order_id', v_mov.order_id,
    'order_stock_descontado_reset', v_order_flag_reset
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reverse_kardex_movement(UUID, TEXT, BOOLEAN)
  TO authenticated, service_role;

COMMIT;
