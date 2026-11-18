-- =========================================================================================
-- WMS STOCKA - MIGRACIÓN INTEGRAL: NUEVO ESTADO WMS "Listo para retiro"
-- Exclusivo para pedidos con categoría RETIRO, auto-transición desde Pickeado,
-- salida física idempotente de inventario (Kardex OUT) y exigencia de Logística Inversa al cancelar.
-- Fecha: 2026-11-19
-- =========================================================================================

-- =========================================================================================
-- 1. EXTENSIÓN DE ESQUEMA Y RESTRICCIONES CHECK EN public.orders Y public.reverse_logistics
-- =========================================================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS ready_for_pickup_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_ready_for_pickup_at
  ON public.orders(ready_for_pickup_at DESC)
  WHERE ready_for_pickup_at IS NOT NULL;

COMMENT ON COLUMN public.orders.ready_for_pickup_at IS
  'Marca temporal exacta en que un pedido de categoría RETIRO quedó armado en estantería (Listo para retiro) y rebajó stock físico.';

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS check_estado_wms;
ALTER TABLE public.orders ADD CONSTRAINT check_estado_wms
  CHECK (estado_wms IN (
    'En procesamiento',
    'En preparación',
    'Pickeado',
    'Listo para retiro',
    'Despachado',
    'Entregado',
    'Incidencia',
    'Cancelado',
    'Archivado'
  ));

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'para procesar',
    'en preparación',
    'preparado',
    'listo para retiro',
    'despachado',
    'en tránsito',
    'en transito',
    'entregado',
    'retirado',
    'en espera',
    'sin stock',
    'incidencia',
    'cancelado'
  ));

-- Garantizar columna e índice origen_order_id en reverse_logistics para validación O(log N) al cancelar retiros
ALTER TABLE public.reverse_logistics
  ADD COLUMN IF NOT EXISTS origen_order_id UUID;

CREATE INDEX IF NOT EXISTS idx_reverse_logistics_origen_order
  ON public.reverse_logistics(origen_order_id)
  WHERE origen_order_id IS NOT NULL;

-- =========================================================================================
-- 2. REGISTRAR Y ACTUALIZAR REGLAS EN EL CENTRO DE AUTOMATIZACIONES (automation_rules)
-- =========================================================================================
INSERT INTO public.automation_rules (id, title, category, is_enabled, mode, trigger_desc, condition_desc, action_desc, tech_source)
VALUES
  (
    'auto-retiro-pickeado-to-listo',
    'Retiro en Sucursal → WMS: Pedido RETIRO Pickeado pasa automáticamente a LISTO PARA RETIRO y rebaja stock',
    'picker_wms',
    TRUE,
    'Trigger SQL Tiempo Real + Sync Picker',
    'Un pedido con categoría RETIRO finaliza su armado en App Picker o cambia a estado "Pickeado".',
    'El pedido tiene categoría de entrega "RETIRO" (exclusivo).',
    'Transforma automáticamente estado_wms a "Listo para retiro" (status = "listo para retiro"), descuenta stock físico de forma idempotente (Kardex OUT), libera reserva de mesa, actualiza store_pickups a "LISTO PARA RETIRO" y notifica a Shopify.',
    'Trigger ab_02_enforce_listo_para_retiro_rules + on_order_stock_change + sync_to_picker.js'
  ),
  (
    'auto-pickup-retirado-to-entregado',
    'Retiro en Sucursal → WMS: Pedido Retirado cierra automáticamente en ENTREGADO',
    'picker_wms',
    TRUE,
    'Trigger SQL + Polling Picker 30s / Worker',
    'El retiro del pedido (en "Listo para retiro") se marca como "Retirado" en App Picker o "ENTREGADO" en store_pickups / sucursal_pickups.',
    'El pedido no está en "Cancelado" ni "Archivado".',
    'Cambia automáticamente estado_wms a "Entregado" (status = "retirado") sin doble descuento de stock, guarda PIN/receptor/hora en closed_snapshot y cierra el pedido en Shopify.',
    'Trigger trg_auto_store_pickup_to_entregado + sync_to_picker.js + js/admin.js'
  ),
  (
    'auto-shopify-ready-for-pickup',
    'WMS → Shopify: Pedido en "Listo para retiro" pasa a "Listo para retirar"',
    'wms_shopify',
    TRUE,
    'Trigger SQL + Edge Function Tiempo Real',
    'Un pedido de RETIRO pasa a estado_wms = "Listo para retiro" en Stocka WMS.',
    'El comercio tiene activa la sincronización inversa (sync_tracking_enabled = true).',
    'Encola set_ready_for_pickup, ejecuta fulfillmentOrderLineItemsPreparedForPickup en Shopify y añade tag "Stocka: Listo para Retiro".',
    'Trigger trg_enqueue_shopify_fulfillment + Edge Function shopify-fulfillment-sync'
  ),
  (
    'auto-wms-stock-deduction',
    'WMS → Inventario: Control Exclusivo de Stock Físico, en Mesa y Comprometido',
    'stock_couriers',
    TRUE,
    'Trigger SQL Transaccional',
    'Cambio de estado_wms entre En procesamiento, En preparación/Pickeado, Listo para retiro/Despachado/Entregado y Cancelado/Archivado.',
    'Evalúa should_process_order_stock, is_order_stock_eligible e idempotencia por order_id en movements.',
    'Mueve unidades entre committed_quantity, reserved_quantity y descuento definitivo de quantity en Listo para retiro, Despachado o Entregado sin doble descuento.',
    'Trigger on_order_stock_change (handle_order_status_change)'
  )
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  category = EXCLUDED.category,
  mode = EXCLUDED.mode,
  trigger_desc = EXCLUDED.trigger_desc,
  condition_desc = EXCLUDED.condition_desc,
  action_desc = EXCLUDED.action_desc,
  tech_source = EXCLUDED.tech_source,
  updated_at = NOW();

-- =========================================================================================
-- 3. ORDENAMIENTO CANÓNICO DE TRIGGERS BEFORE EN public.orders:
--    aa_enforce_delivered_immutability_and_auto_close
--    ab_01_order_delivery_category  (resuelve categoria_entrega ANTES de evaluar retiro y stock)
--    ab_02_enforce_listo_para_retiro_rules (auto-convierte Pickeado+RETIRO -> Listo para retiro y exige LI al cancelar)
--    ... validate_order_stock_before_dispatch / on_order_stock_change ...
--    trg_z_enforce_retiro_no_courier
--    zz_seal_order_closed_snapshot
-- =========================================================================================

-- 3.1 Reubicar trigger de categoría a ab_01_order_delivery_category para que corra ANTES de ab_02 y on_order_stock_change
DROP TRIGGER IF EXISTS trg_order_delivery_category ON public.orders;
DROP TRIGGER IF EXISTS ab_01_order_delivery_category ON public.orders;
CREATE TRIGGER ab_01_order_delivery_category
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_order_delivery_category_rules();

-- 3.2 Función y trigger ab_02_enforce_listo_para_retiro_rules
CREATE OR REPLACE FUNCTION public.enforce_listo_para_retiro_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cat TEXT := UPPER(TRIM(COALESCE(NEW.categoria_entrega, 'DISTRIBUCIÓN')));
  v_old_wms TEXT := CASE WHEN TG_OP = 'UPDATE' THEN COALESCE(OLD.estado_wms, 'En procesamiento') ELSE NULL END;
  v_has_rl BOOLEAN := FALSE;
  v_clean_ext TEXT;
BEGIN
  -- Si ya estaba sellado en 'Entregado' y no es reapertura admin, aa_... ya congeló la fila
  IF TG_OP = 'UPDATE'
     AND OLD.estado_wms = 'Entregado'
     AND COALESCE(current_setting('app.allow_admin_reopen', true), 'false') <> 'true'
  THEN
    RETURN NEW;
  END IF;

  -- REGLA A: Pedidos RETIRO nunca usan 'Pickeado' ni 'Despachado':
  --   - Si entran/pasan a 'Pickeado' (por Picker o acción manual) y la regla está activa -> 'Listo para retiro'
  --   - Si algún flujo legado envía 'Despachado' para un RETIRO -> mapear a 'Entregado' (si status='retirado') o 'Listo para retiro'
  IF v_cat = 'RETIRO' THEN
    IF NEW.estado_wms = 'Pickeado' AND public.is_automation_rule_enabled('auto-retiro-pickeado-to-listo') THEN
      NEW.estado_wms := 'Listo para retiro';
      NEW.status := 'listo para retiro';
      NEW.ready_for_pickup_at := COALESCE(NEW.ready_for_pickup_at, NOW());
      NEW.agenda := COALESCE(NULLIF(TRIM(NEW.agenda), ''), 'RETIRO');
      NEW.operador := COALESCE(NULLIF(TRIM(NEW.operador), ''), 'SUCURSAL ÑUÑOA');

      -- Si proviene del completado físico en App Picker, activar Regla de Oro (no revertir a En procesamiento por descuadre teórico)
      IF (TG_OP = 'UPDATE' AND v_old_wms = 'En preparación' AND (NEW.picker_status IS NOT NULL OR NEW.picker_operator IS NOT NULL))
         OR COALESCE(current_setting('app.picker_completed_transition', true), 'false') = 'true'
      THEN
        PERFORM set_config('app.physical_carrier_transition', 'true', true);
      END IF;

    ELSIF NEW.estado_wms = 'Despachado' THEN
      IF LOWER(TRIM(COALESCE(NEW.status, ''))) IN ('retirado', 'entregado') THEN
        NEW.estado_wms := 'Entregado';
        NEW.status := 'retirado';
      ELSE
        NEW.estado_wms := 'Listo para retiro';
        NEW.status := 'listo para retiro';
        NEW.ready_for_pickup_at := COALESCE(NEW.ready_for_pickup_at, NOW());
      END IF;
    END IF;
  END IF;

  -- REGLA B: Exclusividad estricta: ningún pedido fuera de categoría RETIRO puede tener estado 'Listo para retiro'
  IF NEW.estado_wms = 'Listo para retiro' AND v_cat <> 'RETIRO' THEN
    RAISE EXCEPTION 'EXCLUSIVIDAD_RETIRO: El estado WMS "Listo para retiro" es exclusivo para pedidos con categoría RETIRO (categoría actual: %).', COALESCE(NEW.categoria_entrega, 'SIN CATEGORÍA');
  END IF;

  -- REGLA C: Exigir Orden Formal de Logística Inversa para cancelar un pedido que YA está en 'Listo para retiro' (stock físico ya rebajado)
  IF TG_OP = 'UPDATE'
     AND v_old_wms = 'Listo para retiro'
     AND NEW.estado_wms = 'Cancelado'
     AND COALESCE(current_setting('app.allow_admin_reopen', true), 'false') <> 'true'
  THEN
    v_clean_ext := UPPER(REGEXP_REPLACE(TRIM(COALESCE(OLD.external_order_number, '')), '^#+', ''));

    SELECT EXISTS (
      SELECT 1
      FROM public.reverse_logistics rl
      WHERE rl.origen_order_id = OLD.id
         OR rl.wms_order_id = OLD.id
         OR (
           v_clean_ext <> ''
           AND UPPER(REGEXP_REPLACE(TRIM(COALESCE(rl.referencia_pedido, '')), '^#+', '')) = v_clean_ext
           AND (
             OLD.comercio IS NULL
             OR rl.comercio IS NULL
             OR UPPER(TRIM(rl.comercio)) = UPPER(TRIM(OLD.comercio))
           )
         )
    ) INTO v_has_rl;

    IF NOT v_has_rl THEN
      RAISE EXCEPTION 'RL_REQUIRED_FOR_PICKUP_CANCEL: Para cancelar el pedido % en estado "Listo para retiro" (unidades ya rebajadas del inventario) es obligatorio generar una Orden Formal de Logística Inversa.', COALESCE(OLD.external_order_number, OLD.id::text);
    END IF;
  END IF;

  -- REGLA D: Sellar metadatos e hito de trazabilidad al entrar a 'Listo para retiro'
  IF NEW.estado_wms = 'Listo para retiro' THEN
    NEW.status := 'listo para retiro';
    NEW.ready_for_pickup_at := COALESCE(NEW.ready_for_pickup_at, NOW());
    NEW.agenda := COALESCE(NULLIF(TRIM(NEW.agenda), ''), 'RETIRO');
    NEW.operador := COALESCE(NULLIF(TRIM(NEW.operador), ''), 'SUCURSAL ÑUÑOA');

    IF TG_OP = 'INSERT' OR v_old_wms IS DISTINCT FROM 'Listo para retiro' THEN
      NEW.tracking_history := public.append_order_tracking_checkpoint(
        NEW.tracking_history,
        'Pedido armado y listo para retiro en sucursal',
        'LISTO PARA RETIRO',
        'wms',
        NEW.ready_for_pickup_at
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ab_02_enforce_listo_para_retiro_rules ON public.orders;
CREATE TRIGGER ab_02_enforce_listo_para_retiro_rules
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_listo_para_retiro_rules();

-- =========================================================================================
-- 4. ACTUALIZAR FUNCIONES TRANSACCIONALES DE INVENTARIO, ELEGIBILIDAD Y BODEGAS
--    Grupo de Salida Física Idempotente: ('Listo para retiro', 'Despachado', 'Entregado')
-- =========================================================================================

-- 4.1 Elegibilidad de compromiso en estante
CREATE OR REPLACE FUNCTION public.is_order_stock_eligible(p_order public.orders)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_status TEXT;
  v_wms TEXT;
  v_pay_status TEXT;
  v_shop_fin TEXT;
  v_platform TEXT;
  v_is_marketplace BOOLEAN;
BEGIN
  IF p_order.id IS NULL THEN
    RETURN FALSE;
  END IF;

  v_status := LOWER(TRIM(COALESCE(p_order.status, '')));
  v_wms := COALESCE(p_order.estado_wms, 'En procesamiento');

  IF v_status IN ('cancelado', 'devolución', 'devolucion') THEN
    RETURN FALSE;
  END IF;

  IF v_wms IN ('Cancelado', 'Archivado', 'Listo para retiro', 'Despachado', 'Entregado') THEN
    RETURN FALSE;
  END IF;

  IF p_order.raw_shopify_data IS NOT NULL THEN
    IF p_order.raw_shopify_data->>'cancelled_at' IS NOT NULL THEN
      RETURN FALSE;
    END IF;
    IF COALESCE((p_order.raw_shopify_data->>'confirmed')::boolean, true) = false THEN
      RETURN FALSE;
    END IF;
  END IF;

  v_pay_status := LOWER(TRIM(COALESCE(p_order.payment_status, '')));
  v_shop_fin := LOWER(TRIM(COALESCE(p_order.raw_shopify_data->>'financial_status', '')));
  v_platform := COALESCE(p_order.external_platform, p_order.origen, 'Manual');
  v_is_marketplace := v_platform IN ('Falabella', 'MercadoLibre', 'Mercado Libre', 'Paris', 'Ripley', 'Walmart');

  IF v_pay_status IN ('pending', 'pendiente', 'unpaid', 'no pagado', 'por_pagar', 'por pagar')
     OR v_shop_fin IN ('pending', 'pendiente', 'unpaid', 'no pagado', 'por_pagar', 'por pagar') THEN
    RETURN FALSE;
  END IF;

  IF v_pay_status IN ('refunded', 'reembolsado', 'partially_refunded', 'parcialmente_reembolsado', 'voided', 'anulado')
     OR v_shop_fin IN ('refunded', 'reembolsado', 'partially_refunded', 'parcialmente_reembolsado', 'voided', 'anulado') THEN
    RETURN FALSE;
  END IF;

  IF v_pay_status IN ('paid', 'pagado', 'completed', 'confirmed', 'approved', 'cobrado')
     OR v_shop_fin IN ('paid', 'pagado', 'completed', 'confirmed', 'approved', 'cobrado') THEN
    RETURN TRUE;
  END IF;

  IF v_is_marketplace THEN
    RETURN TRUE;
  END IF;

  IF v_platform IN ('Manual', 'Punto de Venta', 'Logística Inversa', 'Logistica Inversa') THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$function$;

-- 4.2 Validación previa de stock (con soporte para Listo para retiro y Regla de Oro post-picking físico)
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

  -- 0. Idempotencia: si ya descontó stock, ya estaba en grupo de salida física, o es backfill histórico (>14d), permitir siempre
  IF COALESCE(OLD.stock_descontado, FALSE) = TRUE
     OR COALESCE(NEW.stock_descontado, FALSE) = TRUE
     OR COALESCE(OLD.estado_wms, '') IN ('Listo para retiro', 'Despachado', 'Entregado')
     OR (COALESCE(NEW.closed_by_automation, '') LIKE 'backfill:%' AND COALESCE(OLD.created_at, NOW()) < NOW() - INTERVAL '14 days')
     OR EXISTS (SELECT 1 FROM public.movements WHERE order_id = NEW.id AND type = 'out')
     OR EXISTS (
          SELECT 1 FROM public.movements m
          JOIN public.order_items oi ON oi.order_id = NEW.id AND oi.product_id = m.product_id
          WHERE m.order_id IS NULL
            AND m.type = 'out'
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
          -- REGLA DE ORO: El paquete ya fue pickeado físicamente / despachado / retirado.
          -- Jamás revertir a "En procesamiento"; registrar incidencia interna de cuadratura.
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
          -- Acción manual desde En procesamiento sin stock suficiente: prevenir cambio y revertir
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

-- 4.3 Control transaccional de stock por estado WMS:
--     'Listo para retiro', 'Despachado' y 'Entregado' comparten descuento único idempotente (Kardex OUT)
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
  -- CASO 1: El pedido entra por primera vez al grupo de salida física:
  --         ('Listo para retiro', 'Despachado', 'Entregado')
  -- Nota: Si luego pasa de 'Listo para retiro' -> 'Entregado' (o 'Despachado' -> 'Entregado'),
  --       v_old_wms YA pertenece al grupo, por lo que JAMÁS descuenta dos veces.
  -- =========================================================================
  IF v_new_wms IN ('Listo para retiro', 'Despachado', 'Entregado')
     AND v_old_wms NOT IN ('Listo para retiro', 'Despachado', 'Entregado') THEN

    IF COALESCE(OLD.stock_descontado, false) = true
       OR (COALESCE(NEW.closed_by_automation, '') LIKE 'backfill:%' AND COALESCE(OLD.created_at, NOW()) < NOW() - INTERVAL '14 days')
       OR EXISTS (SELECT 1 FROM public.movements WHERE order_id = NEW.id AND type = 'out')
       OR EXISTS (
            SELECT 1 FROM public.movements m
            JOIN public.order_items oi ON oi.order_id = NEW.id AND oi.product_id = m.product_id
            WHERE m.order_id IS NULL
              AND m.type = 'out'
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
          WHERE order_id = NEW.id AND product_id = item.product_id AND type = 'out'
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
  -- (Si estaba en 'Listo para retiro' o 'Despachado', el reingreso se realiza vía Orden Formal de Logística Inversa)
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

-- Incluir categoria_entrega en las columnas observadas por on_order_stock_change
-- para que si un pedido ya 'Pickeado' cambia a categoría 'RETIRO', ab_02 lo promueva a 'Listo para retiro' y este trigger descuente stock
DROP TRIGGER IF EXISTS on_order_stock_change ON public.orders;
CREATE TRIGGER on_order_stock_change
  BEFORE UPDATE OF estado_wms, payment_status, status, raw_shopify_data, categoria_entrega ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_order_status_change();

-- 4.4 Triggers de order_items y recalculate_committed_stock (protegiendo 'Listo para retiro' y conservando snapshot POS de 20261117)
CREATE OR REPLACE FUNCTION public.handle_new_order_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order public.orders;
  v_wms_status TEXT;
  v_is_virtual BOOLEAN;
  v_should_process BOOLEAN;
  v_is_eligible BOOLEAN;
  v_items_json JSONB := '[]'::jsonb;
  v_total_units INT := 0;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = NEW.order_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_wms_status := COALESCE(v_order.estado_wms, 'En procesamiento');

  IF v_wms_status = 'Entregado' THEN
    SELECT
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'product_id', oi.product_id,
          'sku', COALESCE(p.sku, v_order.sku),
          'name', COALESCE(p.name, v_order.item, 'Producto'),
          'barcode', COALESCE(NULLIF(p.barcode, ''), NULLIF(p.barcode_wms, ''), p.sku),
          'quantity', oi.quantity,
          'warehouse_id', oi.warehouse_id
        )
      ), '[]'::jsonb),
      COALESCE(SUM(oi.quantity), COALESCE(v_order.cantidad, 1))
    INTO v_items_json, v_total_units
    FROM public.order_items oi
    LEFT JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = NEW.order_id;

    PERFORM set_config('app.refresh_closed_snapshot', 'true', true);

    UPDATE public.orders
    SET closed_snapshot = CASE
      WHEN closed_snapshot IS NOT NULL THEN
        closed_snapshot || jsonb_build_object('items_snapshot', v_items_json, 'total_units', v_total_units)
      ELSE
        public.build_order_closed_snapshot(v_order)
    END
    WHERE id = NEW.order_id;

    RETURN NEW;
  END IF;

  v_should_process := public.should_process_order_stock(NEW.order_id);
  IF NOT v_should_process THEN RETURN NEW; END IF;

  SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = NEW.product_id;
  IF v_is_virtual THEN RETURN NEW; END IF;

  IF v_wms_status IN ('Listo para retiro', 'Despachado', 'Entregado', 'Cancelado', 'Archivado') THEN
    RETURN NEW;
  END IF;

  IF v_wms_status IN ('En preparación', 'Pickeado') THEN
    IF NEW.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET reserved_quantity = reserved_quantity + NEW.quantity
      WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
    END IF;
  ELSE
    v_is_eligible := public.is_order_stock_eligible(v_order);
    IF v_is_eligible AND NEW.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET committed_quantity = committed_quantity + NEW.quantity
      WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_delete_order_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order public.orders;
  v_wms_status TEXT;
  v_is_virtual BOOLEAN;
  v_should_process BOOLEAN;
  v_was_eligible BOOLEAN;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = OLD.order_id;
  IF NOT FOUND THEN RETURN OLD; END IF;

  v_should_process := public.should_process_order_stock(OLD.order_id);
  IF NOT v_should_process THEN RETURN OLD; END IF;

  SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = OLD.product_id;
  IF v_is_virtual THEN RETURN OLD; END IF;

  v_wms_status := COALESCE(v_order.estado_wms, 'En procesamiento');
  IF v_wms_status IN ('Listo para retiro', 'Despachado', 'Entregado', 'Cancelado', 'Archivado') THEN
    RETURN OLD;
  END IF;

  IF v_wms_status IN ('En preparación', 'Pickeado') THEN
    IF OLD.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET reserved_quantity = GREATEST(0, reserved_quantity - OLD.quantity)
      WHERE product_id = OLD.product_id AND warehouse_id = OLD.warehouse_id;
    END IF;
  ELSE
    v_was_eligible := public.is_order_stock_eligible(v_order);
    IF v_was_eligible AND OLD.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET committed_quantity = GREATEST(0, committed_quantity - OLD.quantity)
      WHERE product_id = OLD.product_id AND warehouse_id = OLD.warehouse_id;
    END IF;
  END IF;

  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_update_order_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order public.orders;
  v_old_process BOOLEAN;
  v_new_process BOOLEAN;
  v_old_is_virtual BOOLEAN;
  v_new_is_virtual BOOLEAN;
  v_qty_diff INTEGER;
  v_wms_status TEXT;
  v_is_eligible BOOLEAN;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = NEW.order_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_old_process := public.should_process_order_stock(OLD.order_id);
  v_new_process := public.should_process_order_stock(NEW.order_id);
  IF NOT v_old_process AND NOT v_new_process THEN RETURN NEW; END IF;

  SELECT COALESCE(is_virtual, false) INTO v_old_is_virtual FROM public.products WHERE id = OLD.product_id;
  SELECT COALESCE(is_virtual, false) INTO v_new_is_virtual FROM public.products WHERE id = NEW.product_id;

  v_wms_status := COALESCE(v_order.estado_wms, 'En procesamiento');
  IF v_wms_status IN ('Listo para retiro', 'Despachado', 'Entregado', 'Cancelado', 'Archivado') THEN
    RETURN NEW;
  END IF;

  v_is_eligible := public.is_order_stock_eligible(v_order);

  IF v_wms_status IN ('En preparación', 'Pickeado') THEN
    IF OLD.product_id != NEW.product_id OR OLD.warehouse_id != NEW.warehouse_id THEN
      IF v_old_process AND OLD.warehouse_id IS NOT NULL AND NOT v_old_is_virtual THEN
        UPDATE public.inventory
        SET reserved_quantity = GREATEST(0, reserved_quantity - OLD.quantity)
        WHERE product_id = OLD.product_id AND warehouse_id = OLD.warehouse_id;
      END IF;
      IF v_new_process AND NEW.warehouse_id IS NOT NULL AND NOT v_new_is_virtual THEN
        UPDATE public.inventory
        SET reserved_quantity = reserved_quantity + NEW.quantity
        WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
      END IF;
    ELSE
      v_qty_diff := NEW.quantity - OLD.quantity;
      IF v_qty_diff != 0 AND NEW.warehouse_id IS NOT NULL AND NOT v_new_is_virtual THEN
        UPDATE public.inventory
        SET reserved_quantity = GREATEST(0, reserved_quantity + v_qty_diff)
        WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
      END IF;
    END IF;
  ELSE
    IF OLD.product_id != NEW.product_id OR OLD.warehouse_id != NEW.warehouse_id THEN
      IF v_old_process AND OLD.warehouse_id IS NOT NULL AND NOT v_old_is_virtual AND v_is_eligible THEN
        UPDATE public.inventory
        SET committed_quantity = GREATEST(0, committed_quantity - OLD.quantity)
        WHERE product_id = OLD.product_id AND warehouse_id = OLD.warehouse_id;
      END IF;
      IF v_new_process AND NEW.warehouse_id IS NOT NULL AND NOT v_new_is_virtual AND v_is_eligible THEN
        UPDATE public.inventory
        SET committed_quantity = committed_quantity + NEW.quantity
        WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
      END IF;
    ELSE
      v_qty_diff := NEW.quantity - OLD.quantity;
      IF v_qty_diff != 0 AND NEW.warehouse_id IS NOT NULL AND NOT v_new_is_virtual AND v_is_eligible THEN
        UPDATE public.inventory
        SET committed_quantity = GREATEST(0, committed_quantity + v_qty_diff)
        WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_committed_stock()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  r RECORD;
BEGIN
  UPDATE public.inventory
  SET committed_quantity = 0,
      reserved_quantity = 0
  WHERE id IS NOT NULL;

  FOR r IN
    SELECT oi.product_id, oi.warehouse_id, SUM(oi.quantity) AS total_committed
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE COALESCE(o.estado_wms, 'En procesamiento') NOT IN ('En preparación', 'Pickeado', 'Listo para retiro', 'Despachado', 'Entregado', 'Cancelado', 'Archivado')
      AND public.should_process_order_stock(o.id)
      AND public.is_order_stock_eligible(o)
    GROUP BY oi.product_id, oi.warehouse_id
  LOOP
    IF r.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET committed_quantity = r.total_committed
      WHERE product_id = r.product_id AND warehouse_id = r.warehouse_id;
    END IF;
  END LOOP;

  FOR r IN
    SELECT oi.product_id, oi.warehouse_id, SUM(oi.quantity) AS total_reserved
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.estado_wms IN ('En preparación', 'Pickeado')
      AND public.should_process_order_stock(o.id)
    GROUP BY oi.product_id, oi.warehouse_id
  LOOP
    IF r.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET reserved_quantity = r.total_reserved
      WHERE product_id = r.product_id AND warehouse_id = r.warehouse_id;
    END IF;
  END LOOP;
END;
$function$;

-- 4.5 Cambio de bodega de stock (incluyendo 'Listo para retiro' como salida física ya aplicada)
CREATE OR REPLACE FUNCTION public.change_orders_stock_warehouse(
  p_order_ids UUID[],
  p_target_warehouse_id UUID,
  p_sync_sucursal BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
  v_target_wh UUID;
  v_old_wh UUID;
  v_sucursal_pickeo TEXT;
  v_estado_wms TEXT;
  v_stock_descontado BOOLEAN;
  v_item RECORD;
  v_target_sucursal_name TEXT;
  v_updated_orders_count INT := 0;
  v_updated_items_count INT := 0;
  v_adjusted_physical_count INT := 0;
  v_kardex_updated_count INT := 0;
BEGIN
  IF NOT public.is_admin()
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Acceso denegado: Se requieren privilegios de administrador para cambiar bodegas de stock.';
  END IF;

  IF p_target_warehouse_id IS NOT NULL THEN
    IF p_target_warehouse_id = '973da888-8a63-4790-a08f-919e1af41a93' THEN
      v_target_sucursal_name := 'Sucursal Ñuñoa';
    ELSIF p_target_warehouse_id = '414605cb-f926-43d2-8bd2-d9509f7b458a' THEN
      v_target_sucursal_name := 'Sucursal La Reina';
    ELSIF p_target_warehouse_id = '1e3395fc-bc24-48e5-8c3c-04e8a0f7c32a' THEN
      v_target_sucursal_name := 'Sucursal Recoleta';
    ELSIF p_target_warehouse_id = 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09' THEN
      v_target_sucursal_name := 'Sucursal Virtual (Hub)';
    END IF;
  END IF;

  FOREACH v_order_id IN ARRAY p_order_ids LOOP
    SELECT sucursal_pickeo, estado_wms, COALESCE(stock_descontado, false)
    INTO v_sucursal_pickeo, v_estado_wms, v_stock_descontado
    FROM public.orders
    WHERE id = v_order_id;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF p_target_warehouse_id IS NULL THEN
      IF LOWER(COALESCE(v_sucursal_pickeo, '')) LIKE '%ñuñoa%' THEN
        v_target_wh := '973da888-8a63-4790-a08f-919e1af41a93';
      ELSIF LOWER(COALESCE(v_sucursal_pickeo, '')) LIKE '%la reina%' THEN
        v_target_wh := '414605cb-f926-43d2-8bd2-d9509f7b458a';
      ELSIF LOWER(COALESCE(v_sucursal_pickeo, '')) LIKE '%recoleta%' THEN
        v_target_wh := '1e3395fc-bc24-48e5-8c3c-04e8a0f7c32a';
      ELSE
        v_target_wh := 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09';
      END IF;
    ELSE
      v_target_wh := p_target_warehouse_id;
    END IF;

    IF p_sync_sucursal AND v_target_sucursal_name IS NOT NULL THEN
      UPDATE public.orders
      SET sucursal_pickeo = v_target_sucursal_name
      WHERE id = v_order_id AND (sucursal_pickeo IS DISTINCT FROM v_target_sucursal_name);
    END IF;

    FOR v_item IN
      SELECT oi.id, oi.product_id, oi.warehouse_id, oi.quantity, COALESCE(p.is_virtual, false) AS is_virtual
      FROM public.order_items oi
      LEFT JOIN public.products p ON p.id = oi.product_id
      WHERE oi.order_id = v_order_id
    LOOP
      v_old_wh := v_item.warehouse_id;
      IF v_old_wh IS NOT DISTINCT FROM v_target_wh THEN
        CONTINUE;
      END IF;

      UPDATE public.order_items
      SET warehouse_id = v_target_wh
      WHERE id = v_item.id;

      v_updated_items_count := v_updated_items_count + 1;

      IF v_item.is_virtual OR v_item.product_id IS NULL THEN
        CONTINUE;
      END IF;

      IF v_estado_wms IN ('Listo para retiro', 'Despachado', 'Entregado') OR v_stock_descontado = true THEN
        IF v_old_wh IS NOT NULL THEN
          UPDATE public.inventory
          SET quantity = quantity + v_item.quantity
          WHERE product_id = v_item.product_id AND warehouse_id = v_old_wh;
        END IF;

        INSERT INTO public.inventory (product_id, warehouse_id, quantity, committed_quantity, reserved_quantity)
        VALUES (v_item.product_id, v_target_wh, 0, 0, 0)
        ON CONFLICT (product_id, warehouse_id) DO NOTHING;

        UPDATE public.inventory
        SET quantity = GREATEST(0, quantity - v_item.quantity)
        WHERE product_id = v_item.product_id AND warehouse_id = v_target_wh;

        v_adjusted_physical_count := v_adjusted_physical_count + 1;

        UPDATE public.movements
        SET warehouse_id = v_target_wh
        WHERE order_id = v_order_id
          AND product_id = v_item.product_id
          AND type = 'out';

        IF FOUND THEN
          v_kardex_updated_count := v_kardex_updated_count + 1;
        END IF;

      ELSIF v_estado_wms IN ('En preparación', 'Pickeado') THEN
        IF v_old_wh IS NOT NULL THEN
          UPDATE public.inventory
          SET reserved_quantity = GREATEST(0, reserved_quantity - v_item.quantity)
          WHERE product_id = v_item.product_id AND warehouse_id = v_old_wh;
        END IF;

        INSERT INTO public.inventory (product_id, warehouse_id, quantity, committed_quantity, reserved_quantity)
        VALUES (v_item.product_id, v_target_wh, 0, 0, 0)
        ON CONFLICT (product_id, warehouse_id) DO NOTHING;

        UPDATE public.inventory
        SET reserved_quantity = reserved_quantity + v_item.quantity
        WHERE product_id = v_item.product_id AND warehouse_id = v_target_wh;

      ELSIF COALESCE(v_estado_wms, 'En procesamiento') = 'En procesamiento' THEN
        IF v_old_wh IS NOT NULL THEN
          UPDATE public.inventory
          SET committed_quantity = GREATEST(0, committed_quantity - v_item.quantity)
          WHERE product_id = v_item.product_id AND warehouse_id = v_old_wh;
        END IF;

        INSERT INTO public.inventory (product_id, warehouse_id, quantity, committed_quantity, reserved_quantity)
        VALUES (v_item.product_id, v_target_wh, 0, 0, 0)
        ON CONFLICT (product_id, warehouse_id) DO NOTHING;

        UPDATE public.inventory
        SET committed_quantity = committed_quantity + v_item.quantity
        WHERE product_id = v_item.product_id AND warehouse_id = v_target_wh;
      END IF;
    END LOOP;

    v_updated_orders_count := v_updated_orders_count + 1;
  END LOOP;

  PERFORM public.recalculate_committed_stock();

  RETURN jsonb_build_object(
    'success', true,
    'orders_count', v_updated_orders_count,
    'items_count', v_updated_items_count,
    'physical_adjustments', v_adjusted_physical_count,
    'kardex_movements_updated', v_kardex_updated_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.change_orders_stock_warehouse(UUID[], UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_orders_stock_warehouse(UUID[], UUID, BOOLEAN) TO authenticated, service_role;

-- =========================================================================================
-- 5. SNAPSHOT 360°, PROPAGACIÓN A store_pickups / HIJOS CONSOLIDADOS, SHOPIFY Y REAPERTURA
-- =========================================================================================

-- 5.1 Enriquecer build_order_closed_snapshot con ready_for_pickup_at
CREATE OR REPLACE FUNCTION public.build_order_closed_snapshot(p_order public.orders)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cat TEXT := UPPER(TRIM(COALESCE(p_order.categoria_entrega, 'DISTRIBUCIÓN')));
  v_ext_clean TEXT := REGEXP_REPLACE(TRIM(COALESCE(p_order.external_order_number, '')), '^#+', '');
  v_forced_track TEXT := NULL;
  v_clean_track TEXT := NULL;
  v_ship_j JSONB := NULL;
  v_opti_j JSONB := NULL;
  v_pickup_j JSONB := NULL;
  v_mkt JSONB;
  v_ship_json JSONB;
  v_pickup_json JSONB;
  v_picking_json JSONB;
  v_items_json JSONB := '[]'::jsonb;
  v_total_units INT := 0;
  v_eff_courier TEXT;
  v_eff_tracking TEXT;
  v_eff_url TEXT;
  v_delivered_at TIMESTAMPTZ;
  v_hist JSONB;
  v_logs_json JSONB;
BEGIN
  IF p_order.raw_shopify_data IS NOT NULL
     AND COALESCE((p_order.raw_shopify_data->'wms_forced_tracking'->>'active')::boolean, FALSE) IS TRUE THEN
    v_forced_track := NULLIF(TRIM(p_order.raw_shopify_data->'wms_forced_tracking'->>'tracking_number'), '');
  END IF;

  IF p_order.tracking_number IS NOT NULL
     AND TRIM(p_order.tracking_number) <> ''
     AND UPPER(TRIM(p_order.tracking_number)) NOT IN ('N/A', 'NO INFORMADO', 'NOINFORMADO', 'NULL', '-') THEN
    v_clean_track := TRIM(p_order.tracking_number);
  END IF;

  IF v_cat = 'RETIRO' OR UPPER(TRIM(COALESCE(p_order.agenda, ''))) = 'RETIRO' THEN
    SELECT to_jsonb(sp)
    INTO v_pickup_j
    FROM public.store_pickups sp
    WHERE sp.pedido = ANY(ARRAY[
      COALESCE(p_order.external_order_number, ''),
      v_ext_clean,
      '#' || v_ext_clean,
      p_order.id::text
    ])
    AND (p_order.comercio IS NULL OR sp.comercio IS NULL OR LOWER(TRIM(sp.comercio)) = LOWER(TRIM(p_order.comercio)))
    ORDER BY sp.updated_at DESC NULLS LAST, sp.id DESC
    LIMIT 1;
  END IF;

  IF v_cat NOT IN ('RETIRO', 'SHOP POINT (POS)', 'SHOP POINT', 'POS') THEN
    IF v_forced_track IS NOT NULL THEN
      SELECT to_jsonb(t)
      INTO v_ship_j
      FROM (
        SELECT
          c.id, c.source_table, c.source_id, c.courier, c.tracking, c.tracking_url,
          c.servicio_tipo_envio, c.created_at, c.updated_at,
          (public.classify_shipment_transport_status(c.source_table, c.status, c.raw_data))->>'norm' AS norm_st,
          (public.classify_shipment_transport_status(c.source_table, c.status, c.raw_data))->>'clean_status' AS clean_st
        FROM (
          SELECT eu.* FROM public.envios_unificados eu WHERE eu.tracking = v_forced_track
          UNION ALL
          SELECT eu.* FROM public.envios_unificados eu WHERE eu.source_table = 'lightdata_envios' AND eu.source_id = v_forced_track
        ) c
        WHERE UPPER(COALESCE(c.courier, '')) !~ '(RECIBELO|RECÍBELO|WELIVERY|WOODELIVERY|WODELY)'
        ORDER BY
          CASE WHEN (public.classify_shipment_transport_status(c.source_table, c.status, c.raw_data))->>'norm' = 'ENTREGADO' THEN 3
               WHEN (public.classify_shipment_transport_status(c.source_table, c.status, c.raw_data))->>'norm' = 'EN TRÁNSITO' THEN 2
               ELSE 1 END DESC,
          c.updated_at DESC NULLS LAST
        LIMIT 1
      ) t;
    ELSE
      SELECT to_jsonb(t)
      INTO v_ship_j
      FROM (
        SELECT
          c.id, c.source_table, c.source_id, c.courier, c.tracking, c.tracking_url,
          c.servicio_tipo_envio, c.created_at, c.updated_at,
          (public.classify_shipment_transport_status(c.source_table, c.status, c.raw_data))->>'norm' AS norm_st,
          (public.classify_shipment_transport_status(c.source_table, c.status, c.raw_data))->>'clean_status' AS clean_st
        FROM (
          SELECT eu.* FROM public.envios_unificados eu
          WHERE v_clean_track IS NOT NULL AND eu.tracking = v_clean_track
          UNION ALL
          SELECT eu.* FROM public.envios_unificados eu
          WHERE v_clean_track IS NOT NULL AND eu.source_table = 'lightdata_envios' AND eu.source_id = v_clean_track
          UNION ALL
          SELECT eu.* FROM public.envios_unificados eu
          WHERE eu.pedido_referencia = ANY(ARRAY_REMOVE(ARRAY[
            NULLIF(TRIM(COALESCE(p_order.external_order_number, '')), ''),
            NULLIF(v_ext_clean, ''),
            CASE WHEN v_ext_clean <> '' THEN '#' || v_ext_clean ELSE NULL END,
            p_order.id::text
          ], NULL))
          AND (
            eu.pedido_referencia = p_order.id::text
            OR eu.empresa_comercio_proveedor IS NULL
            OR UPPER(TRIM(eu.empresa_comercio_proveedor)) IN ('', 'NO ASIGNADO', 'STOCKA')
            OR LOWER(TRIM(eu.empresa_comercio_proveedor)) = LOWER(TRIM(COALESCE(p_order.comercio, '')))
          )
        ) c
        WHERE UPPER(COALESCE(c.courier, '')) !~ '(RECIBELO|RECÍBELO|WELIVERY|WOODELIVERY|WODELY)'
        ORDER BY
          CASE WHEN (public.classify_shipment_transport_status(c.source_table, c.status, c.raw_data))->>'norm' = 'ENTREGADO' THEN 3
               WHEN (public.classify_shipment_transport_status(c.source_table, c.status, c.raw_data))->>'norm' = 'EN TRÁNSITO' THEN 2
               ELSE 1 END DESC,
          c.updated_at DESC NULLS LAST
        LIMIT 1
      ) t;
    END IF;

    IF p_order.external_order_number IS NOT NULL AND v_ext_clean <> '' THEN
      SELECT to_jsonb(t)
      INTO v_opti_j
      FROM (
        SELECT
          opt.status AS opti_status,
          opt.servicio_tipo_envio AS opti_service_type,
          opt.raw_data->'assigned_vehicle'->>'name' AS opti_vehicle,
          opt.raw_data->>'route_started_at' AS opti_route_started_at,
          opt.raw_data->>'completed_at' AS opti_completed_at,
          COALESCE(opt.raw_data->'waypoint'->>'reception_name', opt.raw_data->>'reception_name') AS opti_reception_name,
          COALESCE(opt.raw_data->'waypoint'->>'reception_rut', opt.raw_data->>'reception_rut') AS opti_reception_rut,
          COALESCE(opt.raw_data->'waypoint'->>'latitude', opt.raw_data->'address'->>'latitude') AS opti_lat,
          COALESCE(opt.raw_data->'waypoint'->>'longitude', opt.raw_data->'address'->>'longitude') AS opti_lng
        FROM public.optiroute_orders opt
        WHERE opt.referencia = ANY(ARRAY[p_order.external_order_number, v_ext_clean, '#' || v_ext_clean])
        ORDER BY opt.updated_at DESC NULLS LAST, opt.created_at DESC NULLS LAST
        LIMIT 1
      ) t;
    END IF;

    IF v_opti_j IS NULL AND v_clean_track IS NOT NULL THEN
      SELECT to_jsonb(t)
      INTO v_opti_j
      FROM (
        SELECT
          opt.status AS opti_status,
          opt.servicio_tipo_envio AS opti_service_type,
          opt.raw_data->'assigned_vehicle'->>'name' AS opti_vehicle,
          opt.raw_data->>'route_started_at' AS opti_route_started_at,
          opt.raw_data->>'completed_at' AS opti_completed_at,
          COALESCE(opt.raw_data->'waypoint'->>'reception_name', opt.raw_data->>'reception_name') AS opti_reception_name,
          COALESCE(opt.raw_data->'waypoint'->>'reception_rut', opt.raw_data->>'reception_rut') AS opti_reception_rut,
          COALESCE(opt.raw_data->'waypoint'->>'latitude', opt.raw_data->'address'->>'latitude') AS opti_lat,
          COALESCE(opt.raw_data->'waypoint'->>'longitude', opt.raw_data->'address'->>'longitude') AS opti_lng
        FROM public.optiroute_orders opt
        WHERE opt.tracking = v_clean_track
        ORDER BY opt.updated_at DESC NULLS LAST, opt.created_at DESC NULLS LAST
        LIMIT 1
      ) t;
    END IF;
  END IF;

  v_mkt := public.extract_marketplace_or_pos_delivery(p_order);
  IF COALESCE((v_mkt->>'is_pos')::boolean, FALSE) IS TRUE THEN
    v_cat := 'SHOP POINT (POS)';
  ELSIF COALESCE(p_order.external_order_number, '') LIKE 'LI-%'
        OR COALESCE(p_order.origen, '') = 'Logística Inversa'
        OR v_cat IN ('LOGÍSTICA INVERSA', 'LOGISTICA INVERSA') THEN
    v_cat := 'LOGÍSTICA INVERSA';
  END IF;

  v_eff_courier := COALESCE(
    CASE WHEN v_cat = 'SHOP POINT (POS)' THEN 'Venta Presencial Sucursal Ñuñoa' END,
    CASE WHEN v_cat = 'LOGÍSTICA INVERSA' THEN COALESCE(NULLIF(TRIM(v_ship_j->>'courier'), ''), 'Logística Inversa Bodega') END,
    CASE WHEN v_cat = 'RETIRO' THEN 'Retiro en Sucursal' END,
    NULLIF(TRIM(v_ship_j->>'courier'), ''),
    NULLIF(TRIM(p_order.courier), ''),
    NULLIF(TRIM(v_mkt->>'courier'), ''),
    NULLIF(TRIM(p_order.operador), ''),
    'Transporte Stocka'
  );

  v_eff_tracking := COALESCE(
    v_forced_track,
    CASE WHEN (v_ship_j->>'source_table') = 'lightdata_envios' THEN NULLIF(TRIM(v_ship_j->>'source_id'), '') END,
    NULLIF(NULLIF(TRIM(p_order.tracking_number), 'No informado'), 'N/A'),
    NULLIF(NULLIF(TRIM(v_ship_j->>'tracking'), 'No informado'), 'N/A'),
    CASE WHEN (v_pickup_j->>'pin_retiro') IS NOT NULL AND TRIM(v_pickup_j->>'pin_retiro') <> '' THEN 'PIN: ' || (v_pickup_j->>'pin_retiro') END
  );

  v_eff_url := COALESCE(
    NULLIF(NULLIF(TRIM(p_order.tracking_url), 'N/A'), ''),
    NULLIF(NULLIF(TRIM(v_ship_j->>'tracking_url'), 'N/A'), '')
  );

  BEGIN
    v_delivered_at := COALESCE(
      p_order.delivered_at,
      NULLIF(TRIM(v_opti_j->>'opti_completed_at'), '')::timestamptz,
      NULLIF(TRIM(v_ship_j->>'updated_at'), '')::timestamptz,
      NULLIF(TRIM(v_pickup_j->>'updated_at'), '')::timestamptz,
      NULLIF(TRIM(v_mkt->>'delivered_at'), '')::timestamptz,
      NOW()
    );
  EXCEPTION WHEN OTHERS THEN
    v_delivered_at := COALESCE(p_order.delivered_at, NOW());
  END;

  v_ship_json := jsonb_build_object(
    'id', COALESCE(v_ship_j->>'id', 'sealed:' || p_order.id::text),
    'source_table', COALESCE(v_ship_j->>'source_table', CASE WHEN v_cat = 'RETIRO' THEN 'store_pickups' ELSE COALESCE(v_mkt->>'source', 'orders') END),
    'source_id', COALESCE(v_ship_j->>'source_id', p_order.id::text),
    'courier', v_eff_courier,
    'operador', COALESCE(p_order.operador, v_eff_courier),
    'tracking', v_eff_tracking,
    'tracking_url', v_eff_url,
    'status', COALESCE(
      v_ship_j->>'clean_st',
      CASE WHEN v_cat = 'RETIRO' THEN 'Retirado por cliente en sucursal' END,
      v_mkt->>'status_text',
      'Entregado'
    ),
    'global_status', 'ENTREGADO',
    'service_type', COALESCE(
      v_ship_j->>'servicio_tipo_envio',
      v_opti_j->>'opti_service_type',
      p_order.shipping_method
    ),
    'created_at', COALESCE(v_ship_j->>'created_at', p_order.created_at::text),
    'updated_at', v_delivered_at,
    'delivered_at', v_delivered_at,
    'reception_name', COALESCE(
      v_opti_j->>'opti_reception_name',
      v_pickup_j->>'nombre_apellido'
    ),
    'reception_rut', COALESCE(
      v_opti_j->>'opti_reception_rut',
      v_pickup_j->>'rut'
    ),
    'vehicle', v_opti_j->>'opti_vehicle',
    'route_started_at', v_opti_j->>'opti_route_started_at',
    'gps_lat', v_opti_j->>'opti_lat',
    'gps_lng', v_opti_j->>'opti_lng',
    'gps', CASE WHEN NULLIF(TRIM(v_opti_j->>'opti_lat'), '') IS NOT NULL AND NULLIF(TRIM(v_opti_j->>'opti_lng'), '') IS NOT NULL
                THEN jsonb_build_object('lat', v_opti_j->>'opti_lat', 'lng', v_opti_j->>'opti_lng')
                ELSE NULL END
  );

  v_pickup_json := jsonb_build_object(
    'is_pickup', (v_cat = 'RETIRO' OR UPPER(TRIM(COALESCE(p_order.agenda, ''))) = 'RETIRO'),
    'pin_retiro', v_pickup_j->>'pin_retiro',
    'sucursal', COALESCE(v_pickup_j->>'sucursal', p_order.sucursal_pickeo),
    'estado_pedido', COALESCE(v_pickup_j->>'estado_pedido', CASE WHEN v_cat = 'RETIRO' THEN 'ENTREGADO' ELSE NULL END),
    'ready_for_pickup_at', p_order.ready_for_pickup_at,
    'fecha_retiro', v_pickup_j->>'fecha_retiro',
    'hora_retiro', v_pickup_j->>'hora_retiro',
    'picker_entrega', v_pickup_j->>'picker_entrega',
    'rut_retira', v_pickup_j->>'rut'
  );

  v_logs_json := COALESCE(
    p_order.picker_history_snapshot->'logs',
    p_order.picker_history_snapshot->'history_logs',
    '[]'::jsonb
  );

  v_picking_json := jsonb_build_object(
    'status', COALESCE(p_order.picker_status, p_order.picker_history_snapshot->>'status', 'Completado'),
    'operator', COALESCE(
      p_order.picker_operator,
      p_order.picker_history_snapshot->>'operator',
      v_pickup_j->>'picker_entrega'
    ),
    'warehouse', COALESCE(p_order.sucursal_pickeo, p_order.picker_history_snapshot->>'sucursal', 'Matriz Ñuñoa'),
    'picked_at', COALESCE(p_order.ready_for_pickup_at, p_order.picker_last_synced_at, p_order.stock_descontado_at, p_order.created_at),
    'scanned_label', COALESCE(p_order.picker_scanned_label, p_order.picker_history_snapshot->>'scanned_label'),
    'items_summary', p_order.picker_history_snapshot->>'items_summary',
    'observation', p_order.picker_history_snapshot->>'observation',
    'logs', v_logs_json,
    'history_logs', v_logs_json
  );

  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'product_id', oi.product_id,
        'sku', COALESCE(p.sku, p_order.sku),
        'name', COALESCE(p.name, p_order.item, 'Producto'),
        'barcode', COALESCE(NULLIF(p.barcode, ''), NULLIF(p.barcode_wms, ''), p.sku),
        'quantity', oi.quantity,
        'warehouse_id', oi.warehouse_id
      )
    ), '[]'::jsonb),
    COALESCE(SUM(oi.quantity), COALESCE(p_order.cantidad, 1))
  INTO v_items_json, v_total_units
  FROM public.order_items oi
  LEFT JOIN public.products p ON p.id = oi.product_id
  WHERE oi.order_id = p_order.id;

  v_hist := public.append_order_tracking_checkpoint(
    p_order.tracking_history,
    COALESCE(v_ship_json->>'status', 'Entregado'),
    'ENTREGADO',
    COALESCE(v_ship_json->>'source_table', 'wms'),
    v_delivered_at
  );

  RETURN jsonb_build_object(
    'version', 1,
    'sealed_at', NOW(),
    'closed_by', COALESCE(p_order.closed_by_automation, 'manual_or_system'),
    'final_wms_status', 'Entregado',
    'final_origin_status', COALESCE(p_order.status, 'entregado'),
    'categoria_entrega', v_cat,
    'ready_for_pickup_at', p_order.ready_for_pickup_at,
    'delivered_at', v_delivered_at,
    'dispatched_at', COALESCE(p_order.dispatched_at, p_order.ready_for_pickup_at, p_order.stock_descontado_at, v_delivered_at),
    'shipment', v_ship_json,
    'pickup', v_pickup_json,
    'picking', v_picking_json,
    'items_snapshot', v_items_json,
    'total_units', v_total_units,
    'tracking_history', v_hist
  );
END;
$$;

-- 5.2 Trigger AFTER en orders: Bitácora, sincronización automática con store_pickups y propagación a consolidados
CREATE OR REPLACE FUNCTION public.after_order_wms_transition_propagate_func()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_wms TEXT := CASE WHEN TG_OP = 'UPDATE' THEN COALESCE(OLD.estado_wms, 'En procesamiento') ELSE NULL END;
  v_order_no TEXT := TRIM(COALESCE(NEW.external_order_number, NEW.id::text));
  v_clean_no TEXT := REGEXP_REPLACE(TRIM(COALESCE(NEW.external_order_number, '')), '^#+', '');
  v_pickup_id BIGINT;
  v_next_pickup_id BIGINT;
  v_pin TEXT;
BEGIN
  -- 1A. Bitácora de auto-cierres POS / Marketplace
  IF NEW.estado_wms = 'Entregado'
     AND (TG_OP = 'INSERT' OR OLD.estado_wms IS DISTINCT FROM 'Entregado')
     AND NEW.closed_by_automation IN ('auto-pos-sale-to-entregado', 'auto-marketplace-delivered-to-entregado')
  THEN
    PERFORM public.log_automation_execution(
      NEW.closed_by_automation,
      NEW.id,
      NEW.external_order_number,
      NEW.comercio,
      COALESCE(v_prev_wms, 'Nuevo'),
      'Entregado',
      NEW.closed_by_automation,
      'Cierre automático y sellado de snapshot en base de datos',
      FALSE
    );
  END IF;

  -- 1B. Bitácora y sincronización con store_pickups al entrar a 'Listo para retiro'
  IF NEW.estado_wms = 'Listo para retiro'
     AND (TG_OP = 'INSERT' OR OLD.estado_wms IS DISTINCT FROM 'Listo para retiro')
  THEN
    PERFORM public.log_automation_execution(
      'auto-retiro-pickeado-to-listo',
      NEW.id,
      NEW.external_order_number,
      NEW.comercio,
      COALESCE(v_prev_wms, 'Nuevo'),
      'Listo para retiro',
      COALESCE(NEW.picker_operator, 'wms'),
      'Pedido RETIRO listo en sucursal (' || COALESCE(NEW.sucursal_pickeo, 'Sucursal Ñuñoa') || ') y stock rebajado de inventario',
      FALSE
    );

    -- Actualizar o crear registro en store_pickups con estado 'LISTO PARA RETIRO'
    BEGIN
      SELECT sp.id
      INTO v_pickup_id
      FROM public.store_pickups sp
      WHERE sp.pedido = ANY(ARRAY_REMOVE(ARRAY[
        NULLIF(v_order_no, ''),
        NULLIF(v_clean_no, ''),
        CASE WHEN v_clean_no <> '' THEN '#' || v_clean_no ELSE NULL END,
        NEW.id::text
      ], NULL))
      AND (NEW.comercio IS NULL OR sp.comercio IS NULL OR LOWER(TRIM(sp.comercio)) = LOWER(TRIM(NEW.comercio)))
      ORDER BY sp.id DESC
      LIMIT 1;

      IF v_pickup_id IS NOT NULL THEN
        UPDATE public.store_pickups
        SET estado_pedido = 'LISTO PARA RETIRO',
            sucursal = COALESCE(NULLIF(TRIM(sucursal), ''), NEW.sucursal_pickeo, 'Sucursal Ñuñoa'),
            updated_at = NOW()
        WHERE id = v_pickup_id
          AND UPPER(TRIM(COALESCE(estado_pedido, ''))) NOT IN ('ENTREGADO', 'RETIRADO', 'CANCELADO');
      ELSE
        SELECT COALESCE(MAX(id), 0) + 1 INTO v_next_pickup_id FROM public.store_pickups;
        v_pin := UPPER(SUBSTRING(MD5(NEW.id::text || NOW()::text) FROM 1 FOR 6));

        INSERT INTO public.store_pickups (
          id, comercio, pedido, nombre_apellido, estado_pedido, sucursal,
          observaciones, pin_retiro, marcar_retirado_web, avisado_x_mail, cant_mails_enviados, notificado_automatico
        ) VALUES (
          v_next_pickup_id,
          NEW.comercio,
          v_order_no,
          COALESCE(NEW.customer_name, 'Cliente'),
          'LISTO PARA RETIRO',
          COALESCE(NEW.sucursal_pickeo, 'Sucursal Ñuñoa'),
          COALESCE(NEW.customer_name, 'Cliente') || ' | Listo para retiro WMS',
          v_pin,
          FALSE,
          FALSE,
          0,
          FALSE
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  -- 1C. Si se cancela un pedido de RETIRO (con Orden de Logística Inversa validada), marcar store_pickups en CANCELADO
  IF TG_OP = 'UPDATE'
     AND NEW.estado_wms = 'Cancelado'
     AND OLD.estado_wms IS DISTINCT FROM 'Cancelado'
     AND UPPER(TRIM(COALESCE(NEW.categoria_entrega, ''))) = 'RETIRO'
  THEN
    BEGIN
      UPDATE public.store_pickups
      SET estado_pedido = 'CANCELADO',
          updated_at = NOW()
      WHERE pedido = ANY(ARRAY_REMOVE(ARRAY[
        NULLIF(v_order_no, ''),
        NULLIF(v_clean_no, ''),
        CASE WHEN v_clean_no <> '' THEN '#' || v_clean_no ELSE NULL END,
        NEW.id::text
      ], NULL))
      AND (NEW.comercio IS NULL OR comercio IS NULL OR LOWER(TRIM(comercio)) = LOWER(TRIM(NEW.comercio)));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  -- 2. Propagar Listo para retiro / Despachado / Entregado desde Pedido Principal Consolidado hacia sus Secundarios
  IF NEW.estado_wms IN ('Listo para retiro', 'Despachado', 'Entregado')
     AND (TG_OP = 'INSERT' OR OLD.estado_wms IS DISTINCT FROM NEW.estado_wms)
  THEN
    PERFORM set_config('app.physical_carrier_transition', 'true', true);

    UPDATE public.orders child
    SET
      estado_wms = CASE
        WHEN NEW.estado_wms = 'Listo para retiro' AND UPPER(TRIM(COALESCE(child.categoria_entrega, ''))) <> 'RETIRO' THEN child.estado_wms
        ELSE NEW.estado_wms
      END,
      status = CASE
        WHEN NEW.estado_wms = 'Listo para retiro' AND UPPER(TRIM(COALESCE(child.categoria_entrega, ''))) <> 'RETIRO' THEN child.status
        ELSE NEW.status
      END,
      tracking_number = COALESCE(NEW.tracking_number, child.tracking_number),
      tracking_url = COALESCE(NEW.tracking_url, child.tracking_url),
      courier = COALESCE(NEW.courier, child.courier),
      operador = COALESCE(NEW.operador, child.operador),
      transport_status_normalized = NEW.transport_status_normalized,
      ready_for_pickup_at = CASE WHEN NEW.estado_wms = 'Listo para retiro' THEN COALESCE(NEW.ready_for_pickup_at, NOW()) ELSE child.ready_for_pickup_at END,
      dispatched_at = COALESCE(NEW.dispatched_at, child.dispatched_at),
      delivered_at = CASE WHEN NEW.estado_wms = 'Entregado' THEN COALESCE(NEW.delivered_at, NOW()) ELSE child.delivered_at END,
      closed_by_automation = CASE WHEN NEW.estado_wms = 'Entregado' THEN COALESCE(NEW.closed_by_automation, 'consolidated_from_primary') ELSE child.closed_by_automation END
    WHERE child.consolidated_into_order_id IS NOT NULL
      AND child.consolidated_into_order_id = NEW.id
      AND child.id <> NEW.id
      AND child.estado_wms NOT IN ('Entregado', 'Cancelado', 'Archivado')
      AND child.estado_wms IS DISTINCT FROM NEW.estado_wms;

    UPDATE public.orders child
    SET
      estado_wms = CASE
        WHEN NEW.estado_wms = 'Listo para retiro' AND UPPER(TRIM(COALESCE(child.categoria_entrega, ''))) <> 'RETIRO' THEN child.estado_wms
        ELSE NEW.estado_wms
      END,
      status = CASE
        WHEN NEW.estado_wms = 'Listo para retiro' AND UPPER(TRIM(COALESCE(child.categoria_entrega, ''))) <> 'RETIRO' THEN child.status
        ELSE NEW.status
      END,
      tracking_number = COALESCE(NEW.tracking_number, child.tracking_number),
      tracking_url = COALESCE(NEW.tracking_url, child.tracking_url),
      courier = COALESCE(NEW.courier, child.courier),
      operador = COALESCE(NEW.operador, child.operador),
      transport_status_normalized = NEW.transport_status_normalized,
      ready_for_pickup_at = CASE WHEN NEW.estado_wms = 'Listo para retiro' THEN COALESCE(NEW.ready_for_pickup_at, NOW()) ELSE child.ready_for_pickup_at END,
      dispatched_at = COALESCE(NEW.dispatched_at, child.dispatched_at),
      delivered_at = CASE WHEN NEW.estado_wms = 'Entregado' THEN COALESCE(NEW.delivered_at, NOW()) ELSE child.delivered_at END,
      closed_by_automation = CASE WHEN NEW.estado_wms = 'Entregado' THEN COALESCE(NEW.closed_by_automation, 'consolidated_from_primary') ELSE child.closed_by_automation END
    WHERE (child.raw_shopify_data->>'_consolidated_into_order_id') IS NOT NULL
      AND (child.raw_shopify_data->>'_consolidated_into_order_id') = NEW.id::text
      AND child.id <> NEW.id
      AND child.estado_wms NOT IN ('Entregado', 'Cancelado', 'Archivado')
      AND child.estado_wms IS DISTINCT FROM NEW.estado_wms;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_after_order_wms_transition_propagate ON public.orders;
CREATE TRIGGER trg_after_order_wms_transition_propagate
  AFTER INSERT OR UPDATE OF estado_wms ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.after_order_wms_transition_propagate_func();

-- 5.3 Actualizar Trigger Shopify Fulfillment:
--     - 'Listo para retiro' dispara set_ready_for_pickup (fulfillmentOrderLineItemsPreparedForPickup)
--     - 'Entregado' (retirado) dispara create_fulfillment
CREATE OR REPLACE FUNCTION public.enqueue_shopify_fulfillment_trigger_func()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_integration RECORD;
    v_shopify_order_id TEXT;
    v_action TEXT;
    v_existing_queue_id UUID;
    v_has_tracking BOOLEAN;
    v_is_dispatched BOOLEAN;
    v_was_dispatched BOOLEAN;
    v_is_delivered BOOLEAN;
    v_was_delivered BOOLEAN;
    v_is_in_transit BOOLEAN;
    v_was_in_transit BOOLEAN;
    v_tracking_changed BOOLEAN;
    v_is_preparing BOOLEAN;
    v_is_picked BOOLEAN;
    v_was_picked BOOLEAN;
    v_is_pickup BOOLEAN;
BEGIN
    IF NEW.external_platform IS NULL OR UPPER(NEW.external_platform) != 'SHOPIFY' THEN
        RETURN NEW;
    END IF;

    IF COALESCE(NEW.closed_by_automation, '') LIKE 'backfill:%'
       AND COALESCE(NEW.created_at, NOW()) < NOW() - INTERVAL '7 days' THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF (OLD.estado_wms IS NOT DISTINCT FROM NEW.estado_wms)
           AND (OLD.status IS NOT DISTINCT FROM NEW.status)
           AND (OLD.lightdata_status IS NOT DISTINCT FROM NEW.lightdata_status)
           AND (OLD.estado_ruta_optiroute IS NOT DISTINCT FROM NEW.estado_ruta_optiroute)
           AND (OLD.tracking_number IS NOT DISTINCT FROM NEW.tracking_number)
           AND (OLD.tracking_url IS NOT DISTINCT FROM NEW.tracking_url)
           AND (OLD.courier IS NOT DISTINCT FROM NEW.courier) THEN
            RETURN NEW;
        END IF;
    END IF;

    SELECT id, merchant_id, sync_tracking_enabled, sync_intermediate_statuses, granted_scopes
    INTO v_integration
    FROM public.merchant_integrations
    WHERE platform = 'Shopify'
      AND is_active = true
      AND UPPER(TRIM(comercio)) = UPPER(TRIM(NEW.comercio))
    LIMIT 1;

    IF v_integration.id IS NULL OR COALESCE(v_integration.sync_tracking_enabled, false) = false THEN
        RETURN NEW;
    END IF;

    BEGIN
        v_shopify_order_id := NEW.raw_shopify_data->>'id';
    EXCEPTION WHEN OTHERS THEN
        v_shopify_order_id := NULL;
    END;

    IF v_shopify_order_id IS NULL OR v_shopify_order_id = '' THEN
        RETURN NEW;
    END IF;

    v_is_pickup := (UPPER(TRIM(COALESCE(NEW.categoria_entrega, ''))) = 'RETIRO')
                   OR (UPPER(TRIM(COALESCE(NEW.agenda, ''))) = 'RETIRO')
                   OR (UPPER(TRIM(COALESCE(NEW.operador, ''))) LIKE 'SUCURSAL%')
                   OR (LOWER(COALESCE(NEW.shipping_method, '')) LIKE '%retiro%');

    v_is_delivered := (LOWER(TRIM(COALESCE(NEW.status, ''))) IN ('entregado', 'delivered'))
                      OR (LOWER(TRIM(COALESCE(NEW.estado_wms, ''))) = 'entregado')
                      OR (LOWER(COALESCE(NEW.lightdata_status, '')) LIKE '%entregad%')
                      OR (LOWER(COALESCE(NEW.lightdata_status, '')) LIKE '%delivered%')
                      OR (LOWER(COALESCE(NEW.estado_ruta_optiroute, '')) LIKE '%entregad%')
                      OR (LOWER(COALESCE(NEW.estado_ruta_optiroute, '')) LIKE '%deliver%');
    v_was_delivered := CASE WHEN TG_OP = 'UPDATE' THEN
        (LOWER(TRIM(COALESCE(OLD.status, ''))) IN ('entregado', 'delivered'))
        OR (LOWER(TRIM(COALESCE(OLD.estado_wms, ''))) = 'entregado')
        OR (LOWER(COALESCE(OLD.lightdata_status, '')) LIKE '%entregad%')
        OR (LOWER(COALESCE(OLD.lightdata_status, '')) LIKE '%delivered%')
        OR (LOWER(COALESCE(OLD.estado_ruta_optiroute, '')) LIKE '%entregad%')
        OR (LOWER(COALESCE(OLD.estado_ruta_optiroute, '')) LIKE '%deliver%')
    ELSE false END;

    v_is_in_transit := (LOWER(TRIM(COALESCE(NEW.status, ''))) IN ('en tránsito', 'en transito', 'in_transit', 'en reparto'))
                       OR (LOWER(COALESCE(NEW.lightdata_status, '')) ~ '(camino|planta|recepcionado|clasificado|reparto|tránsito|transito|ruta)')
                       OR (LOWER(COALESCE(NEW.estado_ruta_optiroute, '')) ~ '(route|ruta|camino|onroute|ongoing|arrived)');
    v_was_in_transit := CASE WHEN TG_OP = 'UPDATE' THEN
        (LOWER(TRIM(COALESCE(OLD.status, ''))) IN ('en tránsito', 'en transito', 'in_transit', 'en reparto'))
        OR (LOWER(COALESCE(OLD.lightdata_status, '')) ~ '(camino|planta|recepcionado|clasificado|reparto|tránsito|transito|ruta)')
        OR (LOWER(COALESCE(OLD.estado_ruta_optiroute, '')) ~ '(route|ruta|camino|onroute|ongoing|arrived)')
    ELSE false END;

    -- IMPORTANTE: 'Listo para retiro' NO es v_is_dispatched en Shopify; en Shopify corresponde a set_ready_for_pickup.
    -- El cierre en Shopify (create_fulfillment) ocurre recién al pasar a 'Entregado' (status = 'retirado').
    v_is_dispatched := (LOWER(COALESCE(NEW.estado_wms, '')) IN ('despachado', 'entregado'))
                       OR (LOWER(COALESCE(NEW.status, '')) IN ('despachado', 'retirado', 'entregado'));
    v_was_dispatched := CASE WHEN TG_OP = 'UPDATE' THEN
        (LOWER(COALESCE(OLD.estado_wms, '')) IN ('despachado', 'entregado'))
        OR (LOWER(COALESCE(OLD.status, '')) IN ('despachado', 'retirado', 'entregado'))
    ELSE false END;

    v_has_tracking := (
        NEW.tracking_number IS NOT NULL
        AND TRIM(NEW.tracking_number) != ''
        AND UPPER(TRIM(NEW.tracking_number)) NOT IN ('N/A', 'S/N', 'NO INFORMADO', 'NOINFORMADO', 'NULL', '-')
        AND TRIM(NEW.tracking_number) != TRIM(COALESCE(NEW.external_order_number, ''))
        AND TRIM(NEW.tracking_number) !~ '^46[0-9]{6,}$'
    );
    v_tracking_changed := CASE WHEN TG_OP = 'UPDATE' THEN
        v_has_tracking AND (COALESCE(TRIM(OLD.tracking_number), '') IS DISTINCT FROM COALESCE(TRIM(NEW.tracking_number), ''))
    ELSE v_has_tracking END;

    v_is_preparing := (LOWER(TRIM(COALESCE(NEW.estado_wms, ''))) = 'en preparación');
    v_is_picked := (LOWER(TRIM(COALESCE(NEW.estado_wms, ''))) IN ('pickeado', 'listo para retiro'))
                   OR (LOWER(TRIM(COALESCE(NEW.status, ''))) = 'listo para retiro');
    v_was_picked := CASE WHEN TG_OP = 'UPDATE' THEN
        (LOWER(TRIM(COALESCE(OLD.estado_wms, ''))) IN ('pickeado', 'listo para retiro'))
        OR (LOWER(TRIM(COALESCE(OLD.status, ''))) = 'listo para retiro')
    ELSE false END;

    IF v_is_delivered AND NOT v_is_pickup AND (NEW.shopify_fulfillment_id IS NULL OR TRIM(NEW.shopify_fulfillment_id) = '') THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.shopify_fulfillment_queue
            WHERE order_id = NEW.id AND action_type = 'create_fulfillment' AND status IN ('pending', 'processing', 'completed', 'needs_reauth')
        ) THEN
            INSERT INTO public.shopify_fulfillment_queue (
                order_id, merchant_id, comercio, shopify_order_id,
                tracking_number, tracking_url, courier, operador, action_type, status
            ) VALUES (
                NEW.id, v_integration.merchant_id, NEW.comercio, v_shopify_order_id,
                NEW.tracking_number, NEW.tracking_url, NEW.courier, NEW.operador, 'create_fulfillment', 'pending'
            );
        END IF;
    END IF;

    -- CASO 0: Pedido con transporte ENTREGADO -> "Entregado" (set_delivered) en Shopify
    IF v_is_delivered AND NOT v_was_delivered AND NOT v_is_pickup THEN
        SELECT id INTO v_existing_queue_id
        FROM public.shopify_fulfillment_queue
        WHERE order_id = NEW.id
          AND action_type = 'set_delivered'
          AND status IN ('pending', 'processing', 'completed', 'needs_reauth')
        LIMIT 1;

        IF v_existing_queue_id IS NULL THEN
            INSERT INTO public.shopify_fulfillment_queue (
                order_id, merchant_id, comercio, shopify_order_id,
                tracking_number, tracking_url, courier, operador,
                shopify_fulfillment_id, action_type, status
            ) VALUES (
                NEW.id, v_integration.merchant_id, NEW.comercio, v_shopify_order_id,
                NEW.tracking_number, NEW.tracking_url, NEW.courier, NEW.operador,
                NEW.shopify_fulfillment_id, 'set_delivered', 'pending'
            );
        END IF;
        RETURN NEW;
    END IF;

    -- CASO 0.5: Pedido con transporte EN TRÁNSITO -> "En tránsito" (set_in_transit) en Shopify
    IF v_is_in_transit AND NOT v_was_in_transit AND NOT v_is_pickup AND NOT v_is_delivered THEN
        SELECT id INTO v_existing_queue_id
        FROM public.shopify_fulfillment_queue
        WHERE order_id = NEW.id
          AND action_type = 'set_in_transit'
          AND status IN ('pending', 'processing', 'completed', 'needs_reauth')
        LIMIT 1;

        IF v_existing_queue_id IS NULL THEN
            INSERT INTO public.shopify_fulfillment_queue (
                order_id, merchant_id, comercio, shopify_order_id,
                tracking_number, tracking_url, courier, operador,
                shopify_fulfillment_id, action_type, status
            ) VALUES (
                NEW.id, v_integration.merchant_id, NEW.comercio, v_shopify_order_id,
                NEW.tracking_number, NEW.tracking_url, NEW.courier, NEW.operador,
                NEW.shopify_fulfillment_id, 'set_in_transit', 'pending'
            );
        END IF;
        RETURN NEW;
    END IF;

    -- CASO A: Pedido Despachado / Retirado (o actualización de tracking)
    IF (v_is_dispatched AND (NOT v_was_dispatched OR (v_tracking_changed AND NOT v_is_delivered AND COALESCE(NEW.shopify_order_status, '') != 'delivered')))
       OR (v_is_picked AND NOT v_is_pickup AND v_tracking_changed AND NEW.shopify_fulfillment_id IS NOT NULL) THEN
        IF NEW.shopify_fulfillment_id IS NOT NULL AND TRIM(NEW.shopify_fulfillment_id) != '' THEN
            v_action := 'update_tracking';
        ELSE
            v_action := 'create_fulfillment';
        END IF;

        IF v_action = 'update_tracking' THEN
            IF NOT v_has_tracking THEN RETURN NEW; END IF;
            IF EXISTS (
                SELECT 1 FROM public.shopify_fulfillment_queue
                WHERE order_id = NEW.id
                  AND action_type IN ('create_fulfillment', 'update_tracking')
                  AND status = 'completed'
                  AND TRIM(COALESCE(tracking_number, '')) = TRIM(COALESCE(NEW.tracking_number, ''))
            ) THEN
                RETURN NEW;
            END IF;
        END IF;

        SELECT id INTO v_existing_queue_id
        FROM public.shopify_fulfillment_queue
        WHERE order_id = NEW.id AND action_type = v_action AND status IN ('pending', 'needs_reauth')
        LIMIT 1;

        IF v_existing_queue_id IS NOT NULL THEN
            UPDATE public.shopify_fulfillment_queue
            SET tracking_number = NEW.tracking_number,
                tracking_url = NEW.tracking_url,
                courier = NEW.courier,
                operador = NEW.operador,
                shopify_fulfillment_id = NEW.shopify_fulfillment_id,
                status = 'pending',
                updated_at = NOW()
            WHERE id = v_existing_queue_id;
        ELSE
            INSERT INTO public.shopify_fulfillment_queue (
                order_id, merchant_id, comercio, shopify_order_id,
                tracking_number, tracking_url, courier, operador,
                shopify_fulfillment_id, action_type, status
            ) VALUES (
                NEW.id, v_integration.merchant_id, NEW.comercio, v_shopify_order_id,
                NEW.tracking_number, NEW.tracking_url, NEW.courier, NEW.operador,
                NEW.shopify_fulfillment_id, v_action, 'pending'
            );
        END IF;

        RETURN NEW;
    END IF;

    -- CASO B1: Distribución Pickeado -> create_fulfillment
    IF v_is_picked AND (NOT v_is_pickup) AND (NOT v_was_picked)
       AND (NEW.shopify_fulfillment_id IS NULL OR TRIM(NEW.shopify_fulfillment_id) = '') THEN
        SELECT id INTO v_existing_queue_id
        FROM public.shopify_fulfillment_queue
        WHERE order_id = NEW.id AND action_type = 'create_fulfillment' AND status IN ('pending', 'processing', 'completed', 'needs_reauth')
        LIMIT 1;
        IF v_existing_queue_id IS NULL THEN
            INSERT INTO public.shopify_fulfillment_queue (
                order_id, merchant_id, comercio, shopify_order_id,
                tracking_number, tracking_url, courier, operador, action_type, status
            ) VALUES (
                NEW.id, v_integration.merchant_id, NEW.comercio, v_shopify_order_id,
                NEW.tracking_number, NEW.tracking_url, NEW.courier, NEW.operador, 'create_fulfillment', 'pending'
            );
        END IF;
        RETURN NEW;
    END IF;

    -- CASO B2: Retiro en "Listo para retiro" -> set_ready_for_pickup
    IF v_is_picked AND v_is_pickup AND (NOT v_was_picked) AND (NEW.shopify_fulfillment_id IS NULL) THEN
        SELECT id INTO v_existing_queue_id
        FROM public.shopify_fulfillment_queue
        WHERE order_id = NEW.id AND action_type = 'set_ready_for_pickup' AND status IN ('pending', 'processing', 'completed', 'needs_reauth')
        LIMIT 1;
        IF v_existing_queue_id IS NULL THEN
            INSERT INTO public.shopify_fulfillment_queue (
                order_id, merchant_id, comercio, shopify_order_id, action_type, status
            ) VALUES (
                NEW.id, v_integration.merchant_id, NEW.comercio, v_shopify_order_id, 'set_ready_for_pickup', 'pending'
            );
        END IF;
        RETURN NEW;
    END IF;

    -- CASO C: En Preparación -> set_in_progress
    IF v_is_preparing
       AND (COALESCE(v_integration.sync_intermediate_statuses, true) = true)
       AND (NEW.shopify_fulfillment_id IS NULL)
       AND (TG_OP = 'INSERT' OR LOWER(COALESCE(OLD.estado_wms, '')) NOT IN ('en preparación', 'pickeado', 'listo para retiro', 'despachado', 'entregado')) THEN
        SELECT id INTO v_existing_queue_id
        FROM public.shopify_fulfillment_queue
        WHERE order_id = NEW.id AND action_type = 'set_in_progress' AND status IN ('pending', 'processing', 'completed', 'needs_reauth')
        LIMIT 1;
        IF v_existing_queue_id IS NULL THEN
            INSERT INTO public.shopify_fulfillment_queue (
                order_id, merchant_id, comercio, shopify_order_id, action_type, status
            ) VALUES (
                NEW.id, v_integration.merchant_id, NEW.comercio, v_shopify_order_id, 'set_in_progress', 'pending'
            );
        END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Aviso en enqueue_shopify_fulfillment_trigger_func: %', SQLERRM;
    RETURN NEW;
END;
$function$;

-- 5.4 Reapertura administrativa desde 'Entregado' (soportando 'Listo para retiro' para pedidos RETIRO)
CREATE OR REPLACE FUNCTION public.reopen_delivered_order(
  p_order_id UUID,
  p_target_wms_status TEXT DEFAULT 'Despachado',
  p_reason TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_user_email TEXT;
  v_target_status TEXT;
  v_eff_target_wms TEXT := TRIM(COALESCE(p_target_wms_status, 'Despachado'));
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permiso denegado: Solo un Administrador puede reabrir un pedido en estado Entregado.';
  END IF;

  IF LENGTH(TRIM(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Debe ingresar un motivo de auditoría válido (mínimo 5 caracteres) para reabrir un pedido cerrado.';
  END IF;

  IF v_eff_target_wms NOT IN ('Listo para retiro', 'Despachado', 'Incidencia', 'Pickeado', 'En procesamiento') THEN
    RAISE EXCEPTION 'Estado destino inválido para reapertura: %', v_eff_target_wms;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido no encontrado.';
  END IF;

  IF v_order.estado_wms <> 'Entregado' THEN
    RETURN jsonb_build_object('ok', true, 'message', 'El pedido ya no se encontraba en estado Entregado.');
  END IF;

  IF UPPER(TRIM(COALESCE(v_order.categoria_entrega, ''))) = 'RETIRO' THEN
    IF v_eff_target_wms IN ('Despachado', 'Pickeado') THEN
      v_eff_target_wms := 'Listo para retiro';
    END IF;
  ELSIF v_eff_target_wms = 'Listo para retiro' THEN
    RAISE EXCEPTION 'El estado "Listo para retiro" es exclusivo para pedidos con categoría RETIRO.';
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = auth.uid();

  v_target_status := CASE
    WHEN v_eff_target_wms = 'Listo para retiro' THEN 'listo para retiro'
    WHEN v_eff_target_wms = 'Despachado' THEN 'despachado'
    WHEN v_eff_target_wms = 'Incidencia' THEN 'incidencia'
    WHEN v_eff_target_wms = 'Pickeado' THEN 'preparado'
    ELSE 'para procesar'
  END;

  PERFORM set_config('app.allow_admin_reopen', 'true', true);

  UPDATE public.orders
  SET
    estado_wms = v_eff_target_wms,
    status = v_target_status,
    closed_at = NULL,
    closed_by_automation = NULL
  WHERE id = p_order_id;

  IF v_eff_target_wms = 'Listo para retiro' THEN
    UPDATE public.store_pickups
    SET estado_pedido = 'LISTO PARA RETIRO',
        updated_at = NOW()
    WHERE pedido = ANY(ARRAY_REMOVE(ARRAY[
      NULLIF(TRIM(COALESCE(v_order.external_order_number, '')), ''),
      NULLIF(REGEXP_REPLACE(TRIM(COALESCE(v_order.external_order_number, '')), '^#+', ''), ''),
      CASE WHEN TRIM(COALESCE(v_order.external_order_number, '')) <> '' THEN '#' || REGEXP_REPLACE(TRIM(COALESCE(v_order.external_order_number, '')), '^#+', '') ELSE NULL END,
      v_order.id::text
    ], NULL))
    AND (v_order.comercio IS NULL OR comercio IS NULL OR LOWER(TRIM(comercio)) = LOWER(TRIM(v_order.comercio)));
  END IF;

  INSERT INTO public.order_audit_logs (order_id, user_id, user_email, action, details)
  VALUES (
    p_order_id,
    auth.uid(),
    COALESCE(v_user_email, 'Admin'),
    'Reapertura Administrativa de Pedido Entregado',
    jsonb_build_object(
      'previous_wms_status', 'Entregado',
      'new_wms_status', v_eff_target_wms,
      'reason', TRIM(p_reason),
      'changes', jsonb_build_array(
        'Pedido reabierto manualmente de "Entregado" a "' || v_eff_target_wms || '". Motivo: ' || TRIM(p_reason)
      )
    )
  );

  RETURN jsonb_build_object('ok', true, 'new_wms_status', v_eff_target_wms, 'new_status', v_target_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reopen_delivered_order(UUID, TEXT, TEXT) TO authenticated, service_role;

-- 5.5 Actualizar build_public_tracking_order_json para reconocer 'Listo para retiro' en picking_info y status público
CREATE OR REPLACE FUNCTION public.build_public_tracking_order_json(o public.orders)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_masked_name TEXT;
  v_masked_email TEXT;
  v_snap JSONB := o.closed_snapshot;
  v_opti RECORD;
BEGIN
  v_masked_name := CASE
    WHEN COALESCE(TRIM(o.customer_name), '') = '' THEN 'Cliente'
    WHEN split_part(TRIM(o.customer_name), ' ', 2) <> '' THEN
      split_part(TRIM(o.customer_name), ' ', 1) || ' ' || LEFT(split_part(TRIM(o.customer_name), ' ', 2), 1) || '.'
    ELSE split_part(TRIM(o.customer_name), ' ', 1)
  END;

  v_masked_email := CASE
    WHEN o.customer_email IS NOT NULL AND position('@' in o.customer_email) > 2 THEN
      SUBSTRING(o.customer_email FROM 1 FOR 2) || '***@' || split_part(o.customer_email, '@', 2)
    ELSE '***'
  END;

  IF o.estado_wms = 'Entregado' AND v_snap IS NOT NULL THEN
    RETURN jsonb_build_object(
      'id', o.id,
      'order_number', COALESCE(o.external_order_number, o.id::text),
      'comercio', COALESCE(o.comercio, 'Tienda Asociada Stocka'),
      'customer_name', v_masked_name,
      'customer_email', v_masked_email,
      'status', 'Entregado',
      'estado_wms', 'Entregado',
      'is_closed_final', TRUE,
      'tracking_number', COALESCE(v_snap->'shipment'->>'tracking', o.tracking_number),
      'tracking_url', COALESCE(v_snap->'shipment'->>'tracking_url', o.tracking_url),
      'courier', COALESCE(v_snap->'shipment'->>'courier', o.courier, o.operador, 'Stocka'),
      'categoria_entrega', COALESCE(v_snap->>'categoria_entrega', o.categoria_entrega, 'DISTRIBUCIÓN'),
      'shipping_city', o.shipping_city,
      'created_at', o.created_at,
      'ready_for_pickup_at', COALESCE(v_snap->>'ready_for_pickup_at', o.ready_for_pickup_at::text),
      'delivered_at', COALESCE(v_snap->>'delivered_at', o.delivered_at::text),
      'tracking_history', COALESCE(v_snap->'tracking_history', o.tracking_history, '[]'::jsonb),
      'picking_info', jsonb_build_object(
        'warehouse', COALESCE(v_snap->'picking'->>'warehouse', o.sucursal_pickeo, 'Centro de Distribución Stocka'),
        'status', COALESCE(v_snap->'picking'->>'status', 'Completado'),
        'picked_at', COALESCE(v_snap->'picking'->>'picked_at', o.ready_for_pickup_at::text, o.stock_descontado_at::text),
        'scanned_label', COALESCE(v_snap->'picking'->>'scanned_label', o.picker_scanned_label),
        'total_units', COALESCE((v_snap->>'total_units')::int, o.cantidad, 1),
        'items', COALESCE(v_snap->'items_snapshot', '[]'::jsonb)
      ),
      'optiroute_info', jsonb_build_object(
        'is_optiroute', (COALESCE(v_snap->'shipment'->>'source_table', '') = 'optiroute_orders' OR COALESCE(o.operador, '') ILIKE '%STOCKA%'),
        'status_title', COALESCE(v_snap->'shipment'->>'status', 'Entregado'),
        'service_type', COALESCE(v_snap->'shipment'->>'service_type', 'Stocka Express (Same Day / 24 hrs)'),
        'vehicle', v_snap->'shipment'->>'vehicle',
        'route_started_at', v_snap->'shipment'->>'route_started_at',
        'delivered_at', COALESCE(v_snap->>'delivered_at', o.delivered_at::text),
        'reception_name', v_snap->'shipment'->>'reception_name',
        'proof_image', NULL
      )
    );
  END IF;

  SELECT
    opt.status AS opti_status,
    opt.servicio_tipo_envio AS opti_service_type,
    opt.raw_data->'assigned_vehicle'->>'name' AS opti_vehicle,
    opt.raw_data->>'route_started_at' AS opti_route_started_at,
    opt.raw_data->>'completed_at' AS opti_completed_at,
    opt.raw_data->>'status_title' AS opti_status_title,
    COALESCE(opt.raw_data->'images'->0->>'url', opt.raw_data->'waypoint'->'images'->0->>'url') AS proof_image,
    opt.raw_data->'waypoint'->>'reception_name' AS opti_reception_name
  INTO v_opti
  FROM public.optiroute_orders opt
  WHERE (opt.referencia = o.external_order_number
     OR (o.tracking_number IS NOT NULL AND o.tracking_number <> '' AND opt.tracking = o.tracking_number))
  ORDER BY opt.created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'id', o.id,
    'order_number', COALESCE(o.external_order_number, o.id::text),
    'comercio', COALESCE(o.comercio, 'Tienda Asociada Stocka'),
    'customer_name', v_masked_name,
    'customer_email', v_masked_email,
    'status', CASE
      WHEN o.estado_wms = 'Entregado' OR o.transport_status_normalized = 'ENTREGADO' THEN 'Entregado'
      WHEN LOWER(COALESCE(o.estado_wms, '')) LIKE '%incidenc%' THEN 'Incidencia'
      WHEN LOWER(COALESCE(o.estado_wms, '')) LIKE '%cancel%' OR LOWER(COALESCE(o.status, '')) LIKE '%cancel%' THEN 'Cancelado'
      WHEN o.estado_wms = 'Listo para retiro' OR ((o.categoria_entrega = 'RETIRO' OR o.operador ILIKE '%RETIRO%') AND LOWER(COALESCE(o.estado_wms, '')) IN ('pickeado', 'listo para retiro')) THEN 'Listo para retiro'
      ELSE COALESCE(o.estado_wms, o.status, 'En Proceso')
    END,
    'estado_wms', COALESCE(o.estado_wms, 'En procesamiento'),
    'is_closed_final', FALSE,
    'tracking_number', COALESCE(
      CASE WHEN COALESCE((o.raw_shopify_data->'wms_forced_tracking'->>'active')::boolean, false) IS TRUE
        THEN NULLIF(TRIM(o.raw_shopify_data->'wms_forced_tracking'->>'tracking_number'), '')
        ELSE NULL END,
      NULLIF(NULLIF(o.tracking_number, 'No informado'), ''),
      (SELECT eu.tracking FROM public.envios_unificados eu WHERE eu.pedido_referencia = o.external_order_number AND eu.tracking IS NOT NULL AND eu.tracking <> 'No informado' AND LOWER(COALESCE(eu.status, '')) NOT LIKE '%cancel%' LIMIT 1),
      o.tracking_number
    ),
    'tracking_url', COALESCE(
      CASE WHEN COALESCE((o.raw_shopify_data->'wms_forced_tracking'->>'active')::boolean, false) IS TRUE
        THEN NULLIF(TRIM(o.raw_shopify_data->'wms_forced_tracking'->>'tracking_url'), '')
        ELSE NULL END,
      o.tracking_url,
      (SELECT eu.tracking_url FROM public.envios_unificados eu WHERE eu.pedido_referencia = o.external_order_number AND eu.tracking_url IS NOT NULL AND eu.tracking_url <> '' AND LOWER(COALESCE(eu.status, '')) NOT LIKE '%cancel%' LIMIT 1)
    ),
    'courier', COALESCE(
      CASE WHEN COALESCE((o.raw_shopify_data->'wms_forced_tracking'->>'active')::boolean, false) IS TRUE
        THEN NULLIF(TRIM(o.raw_shopify_data->'wms_forced_tracking'->>'courier'), '')
        ELSE NULL END,
      o.courier,
      o.operador,
      'Stocka Same Day / Courier'
    ),
    'categoria_entrega', COALESCE(o.categoria_entrega, 'DISTRIBUCIÓN'),
    'shipping_city', o.shipping_city,
    'created_at', o.created_at,
    'ready_for_pickup_at', o.ready_for_pickup_at,
    'delivered_at', COALESCE(o.delivered_at::text, v_opti.opti_completed_at),
    'tracking_history', COALESCE(o.tracking_history, '[]'::jsonb),
    'picking_info', jsonb_build_object(
      'warehouse', COALESCE(o.sucursal_pickeo, 'Centro de Distribución Stocka'),
      'status', COALESCE(
        o.picker_status,
        CASE
          WHEN LOWER(COALESCE(o.estado_wms, '')) IN ('listo para retiro', 'despachado', 'pickeado', 'entregado') THEN 'Completado'
          WHEN LOWER(COALESCE(o.estado_wms, '')) LIKE '%prep%' THEN 'En preparación'
          ELSE 'En proceso'
        END
      ),
      'picked_at', COALESCE(o.ready_for_pickup_at::text, o.picker_last_synced_at::text, o.stock_descontado_at::text),
      'scanned_label', o.picker_scanned_label,
      'total_units', (SELECT COALESCE(SUM(quantity), 0) FROM public.order_items oi WHERE oi.order_id = o.id),
      'items', (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'name', COALESCE(p.name, 'Producto'),
            'quantity', oi.quantity,
            'sku', p.sku,
            'barcode', COALESCE(NULLIF(p.barcode, ''), NULLIF(p.barcode_wms, ''), p.sku)
          )
        ), '[]'::jsonb)
        FROM public.order_items oi
        LEFT JOIN public.products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id
      )
    ),
    'optiroute_info', jsonb_build_object(
      'is_optiroute', (v_opti.opti_status IS NOT NULL OR o.operador ILIKE '%STOCKA%' OR o.courier ILIKE '%OPTIROUTE%' OR o.operador ILIKE '%SAME DAY%'),
      'status_title', COALESCE(v_opti.opti_status_title, v_opti.opti_status, CASE WHEN o.estado_wms = 'Despachado' THEN 'En Ruta' ELSE o.estado_wms END),
      'service_type', COALESCE(v_opti.opti_service_type, 'Stocka Express (Same Day / 24 hrs)'),
      'vehicle', v_opti.opti_vehicle,
      'route_started_at', v_opti.opti_route_started_at,
      'delivered_at', v_opti.opti_completed_at,
      'reception_name', v_opti.opti_reception_name,
      'proof_image', v_opti.proof_image
    )
  );
END;
$$;

-- =========================================================================================
-- 6. MIGRACIÓN RETROACTIVA IDEMPOTENTE (BACKFILL):
--    Pasar todos los pedidos actuales en ('Pickeado' + categoría 'RETIRO') hacia 'Listo para retiro',
--    ejecutando su salida física de inventario (Kardex OUT) y liberando reserved_quantity.
-- =========================================================================================
DO $$
DECLARE
  v_migrated_count INT := 0;
BEGIN
  -- Activar Regla de Oro durante backfill para que si algún pedido ya pickeado tiene 0 en stock teórico,
  -- igualmente avance a 'Listo para retiro' y registre incidencia ADMIN_ONLY de cuadratura en vez de revertirse.
  PERFORM set_config('app.physical_carrier_transition', 'true', true);
  PERFORM set_config('app.picker_completed_transition', 'true', true);

  WITH updated_rows AS (
    UPDATE public.orders
    SET
      estado_wms = 'Listo para retiro',
      status = 'listo para retiro',
      ready_for_pickup_at = COALESCE(ready_for_pickup_at, picker_last_synced_at, NOW()),
      agenda = COALESCE(NULLIF(TRIM(agenda), ''), 'RETIRO'),
      operador = COALESCE(NULLIF(TRIM(operador), ''), 'SUCURSAL ÑUÑOA')
    WHERE estado_wms = 'Pickeado'
      AND UPPER(TRIM(COALESCE(categoria_entrega, ''))) = 'RETIRO'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_migrated_count FROM updated_rows;

  -- Sincronizar cuadratura global de committed_quantity y reserved_quantity
  PERFORM public.recalculate_committed_stock();

  RAISE NOTICE 'Backfill Listo para retiro completado: % pedido(s) RETIRO migrados desde Pickeado con salida de stock.', v_migrated_count;
END;
$$;
