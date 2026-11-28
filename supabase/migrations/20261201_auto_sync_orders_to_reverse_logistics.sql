-- =========================================================================================
-- WMS STOCKA - SINCRONIZACIÓN AUTOMÁTICA BIDIRECCIONAL: orders ↔ reverse_logistics
-- Fecha: 2026-12-01
-- Objetivo:
--   1. Garantizar que toda orden WMS de Logística Inversa (LI-... / RMA-...) que pase a
--      estado_wms = 'Despachado' o 'Entregado' (por panel Admin, courier, Picker o webhook)
--      actualice automáticamente su registro vinculado en public.reverse_logistics a
--      status = 'procesado' y workflow_status = 'completado', ejecutando el reingreso
--      idempotente de stock / cuarentena sin depender del frontend.
--   2. Proteger contra recursión infinita entre trg_auto_order_to_reverse_logistics_sync y
--      trg_auto_reverse_logistics_to_entregado mediante app.syncing_reverse_logistics.
--   3. Mantener consistencia entre status = 'procesado' y workflow_status = 'completado'
--      (incluyendo saneamiento seguro de registros históricos y desincronizados).
-- =========================================================================================

-- 1. Índice de soporte para búsqueda instantánea por wms_order_id
CREATE INDEX IF NOT EXISTS idx_reverse_logistics_wms_order
  ON public.reverse_logistics(wms_order_id)
  WHERE wms_order_id IS NOT NULL;

-- 2. Registrar la nueva regla en el Centro de Automatizaciones
INSERT INTO public.automation_rules (
  id,
  title,
  category,
  is_enabled,
  mode,
  trigger_desc,
  condition_desc,
  action_desc,
  tech_source
)
VALUES (
  'auto-wms-order-to-reverse-logistics-completado',
  'WMS → Logística Inversa: Pedido Despachado / Entregado completa solicitud LI',
  'stock_couriers',
  TRUE,
  'Trigger SQL Tiempo Real',
  'Una orden WMS de Logística Inversa (LI-... o RMA-...) pasa a estado_wms "Despachado" o "Entregado" por panel Admin, courier, Picker o automatización.',
  'Existe un registro vinculado en reverse_logistics (wms_order_id o replacement_order_id) aún pendiente (o en preparación para RMA de portal al llegar a Entregado).',
  'Marca automáticamente el registro de reverse_logistics como status = "procesado" y workflow_status = "completado", y ejecuta de forma idempotente el reingreso a inventario/cuarentena.',
  'Trigger trg_auto_order_to_reverse_logistics_sync'
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

-- 3. Refinar handle_reverse_logistics_to_entregado_func (reverse_logistics → orders):
--    - Evitar re-ejecutar reingreso de stock si el registro YA estaba 'procesado' y no cambiaron sus ítems.
--    - Sincronizar workflow_status = 'completado' cuando status = 'procesado' y workflow_status era 'pendiente'.
--    - Saltar la sección B (escritura sobre orders) si la invocación provino desde orders (app.syncing_reverse_logistics = 'order_to_rl').
--    - Marcar app.syncing_reverse_logistics = 'rl_to_order' antes de actualizar public.orders para evitar loops.
CREATE OR REPLACE FUNCTION public.handle_reverse_logistics_to_entregado_func()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_st TEXT := LOWER(TRIM(COALESCE(NEW.status, NEW.estado, '')));
  v_old_st TEXT := CASE WHEN TG_OP = 'UPDATE' THEN LOWER(TRIM(COALESCE(OLD.status, OLD.estado, ''))) ELSE '' END;
  v_wf TEXT := LOWER(TRIM(COALESCE(NEW.workflow_status, '')));
  v_sync_dir TEXT := COALESCE(current_setting('app.syncing_reverse_logistics', true), '');
  v_items_changed BOOLEAN := FALSE;
  v_newly_processed BOOLEAN := FALSE;
  v_order public.orders;
  v_rep_order public.orders;
  v_target_wh UUID := '973da888-8a63-4790-a08f-919e1af41a93'; -- Matriz Ñuñoa
  v_items_source JSONB;
  v_elem JSONB;
  v_prod_id UUID;
  v_raw_id TEXT;
  v_sku TEXT;
  v_qty INT;
  v_restock BOOLEAN;
  v_ref_order_id UUID;
  v_ref_label TEXT;
BEGIN
  -- Activar solo cuando se confirma recepción física ('procesado' o estados post-recepción QC en v2)
  IF v_st <> 'procesado' AND v_wf NOT IN ('reemplazo_en_preparacion', 'completado') THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_automation_rule_enabled('auto-reverse-logistics-to-entregado') THEN
    RETURN NEW;
  END IF;

  v_items_changed := (TG_OP = 'UPDATE' AND (OLD.productos IS DISTINCT FROM NEW.productos OR OLD.return_items IS DISTINCT FROM NEW.return_items));
  v_newly_processed := (TG_OP = 'INSERT') OR (v_old_st <> 'procesado' AND v_st = 'procesado') OR (TG_OP = 'UPDATE' AND LOWER(TRIM(COALESCE(OLD.workflow_status, ''))) NOT IN ('reemplazo_en_preparacion', 'completado') AND v_wf IN ('reemplazo_en_preparacion', 'completado'));

  IF NEW.wms_order_id IS NOT NULL THEN
    SELECT * INTO v_order FROM public.orders WHERE id = NEW.wms_order_id LIMIT 1;
  END IF;

  IF NEW.replacement_order_id IS NOT NULL THEN
    SELECT * INTO v_rep_order FROM public.orders WHERE id = NEW.replacement_order_id LIMIT 1;
  END IF;

  -- Resolver bodega receptora (por defecto Matriz Ñuñoa)
  IF COALESCE(NEW.sucursal, v_order.sucursal_pickeo) IS NOT NULL THEN
    SELECT id INTO v_target_wh
    FROM public.warehouses
    WHERE LOWER(name) LIKE '%' || LOWER(REPLACE(REPLACE(COALESCE(NEW.sucursal, v_order.sucursal_pickeo), 'Punto Físico ', ''), 'Sucursal ', '')) || '%'
    LIMIT 1;
    v_target_wh := COALESCE(v_target_wh, '973da888-8a63-4790-a08f-919e1af41a93');
  END IF;

  v_ref_order_id := COALESCE(NEW.wms_order_id, NEW.origen_order_id, NEW.replacement_order_id);
  v_ref_label := COALESCE(NEW.rma_number, NEW.referencia_pedido, v_order.external_order_number, 'RMA');

  -- A. Procesar reingreso a stock / cuarentena (solo en primera transición o si se editaron productos)
  IF (COALESCE(NEW.inventory_restocked, FALSE) IS FALSE AND v_newly_processed)
     OR v_items_changed THEN
    IF NEW.return_items IS NOT NULL AND jsonb_typeof(NEW.return_items) = 'array' AND jsonb_array_length(NEW.return_items) > 0 THEN
      v_items_source := NEW.return_items;
    ELSIF NEW.productos IS NOT NULL AND jsonb_typeof(NEW.productos) = 'array' THEN
      v_items_source := NEW.productos;
    ELSE
      v_items_source := '[]'::jsonb;
    END IF;

    FOR v_elem IN SELECT * FROM jsonb_array_elements(v_items_source) LOOP
      v_prod_id := NULL;
      v_raw_id := COALESCE(NULLIF(TRIM(v_elem->>'product_id'), ''), NULLIF(TRIM(v_elem->>'id_devuelto'), ''));
      IF v_raw_id IS NOT NULL AND v_raw_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        v_prod_id := v_raw_id::uuid;
      END IF;

      v_sku := NULLIF(TRIM(COALESCE(v_elem->>'sku', '')), '');
      -- Si viene en formato legacy "[SKU] Nombre" o "SKU - Nombre" en producto_devuelto
      IF v_prod_id IS NULL AND v_sku IS NULL AND (v_elem->>'producto_devuelto') IS NOT NULL THEN
        IF (v_elem->>'producto_devuelto') ~ '^\[([^\]]+)\]' THEN
          v_sku := SUBSTRING((v_elem->>'producto_devuelto') FROM '^\[([^\]]+)\]');
        ELSIF POSITION(' - ' IN (v_elem->>'producto_devuelto')) > 1 THEN
          v_sku := SPLIT_PART((v_elem->>'producto_devuelto'), ' - ', 1);
        END IF;
      END IF;

      IF v_prod_id IS NULL AND v_sku IS NOT NULL THEN
        SELECT id INTO v_prod_id
        FROM public.products
        WHERE sku = TRIM(v_sku)
          AND (NEW.comercio IS NULL OR LOWER(TRIM(comercio)) = LOWER(TRIM(NEW.comercio)))
        LIMIT 1;
      END IF;

      v_qty := COALESCE(
        NULLIF((v_elem->>'qty')::int, 0),
        NULLIF((v_elem->>'qty_devuelto')::int, 0),
        NULLIF((v_elem->>'cantidad')::int, 0),
        NULLIF((v_elem->>'quantity')::int, 0),
        0
      );

      -- En filas legacy de CAMBIO donde una fila solo tenía producto_reemplazo sin producto_devuelto, saltar
      IF v_prod_id IS NULL OR v_qty <= 0 THEN
        CONTINUE;
      END IF;

      v_restock := COALESCE(
        (v_elem->>'return_to_stock')::boolean,
        (v_elem->>'regresar_a_inventario')::boolean,
        TRUE
      );

      IF v_restock THEN
        IF v_ref_order_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.movements
          WHERE order_id = v_ref_order_id AND product_id = v_prod_id AND type = 'in'
        ) THEN
          IF EXISTS (SELECT 1 FROM public.inventory WHERE product_id = v_prod_id AND warehouse_id = v_target_wh) THEN
            UPDATE public.inventory
            SET quantity = COALESCE(quantity, 0) + v_qty,
                quarantine_quantity = CASE
                  WHEN COALESCE(NEW.inventory_restocked, FALSE) IS TRUE THEN GREATEST(0, COALESCE(quarantine_quantity, 0) - v_qty)
                  ELSE COALESCE(quarantine_quantity, 0)
                END,
                updated_at = NOW()
            WHERE product_id = v_prod_id AND warehouse_id = v_target_wh;
          ELSE
            INSERT INTO public.inventory (product_id, warehouse_id, quantity)
            VALUES (v_prod_id, v_target_wh, v_qty);
          END IF;

          INSERT INTO public.movements (product_id, warehouse_id, type, quantity, date, order_id, reference_doc)
          VALUES (
            v_prod_id,
            v_target_wh,
            'in',
            v_qty,
            NOW(),
            v_ref_order_id,
            COALESCE(NEW.tipo_movimiento, 'Devolución') || ' [' || v_ref_label || ']'
          );
        END IF;
      ELSE
        -- Si ya tenía un movimiento 'in' en Kardex porque antes estaba como regresar_a_inventario = true y ahora pasó a Merma: revertirlo
        IF v_ref_order_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.movements
          WHERE order_id = v_ref_order_id AND product_id = v_prod_id AND type = 'in'
        ) THEN
          DELETE FROM public.movements
          WHERE order_id = v_ref_order_id AND product_id = v_prod_id AND type = 'in';

          UPDATE public.inventory
          SET quantity = GREATEST(0, COALESCE(quantity, 0) - v_qty),
              quarantine_quantity = COALESCE(quarantine_quantity, 0) + v_qty,
              updated_at = NOW()
          WHERE product_id = v_prod_id AND warehouse_id = v_target_wh;
        ELSIF COALESCE(NEW.inventory_restocked, FALSE) IS FALSE THEN
          -- Producto marcado como Merma / Dañado desde el inicio -> suma a quarantine_quantity (no disponible para venta)
          IF EXISTS (SELECT 1 FROM public.inventory WHERE product_id = v_prod_id AND warehouse_id = v_target_wh) THEN
            UPDATE public.inventory
            SET quarantine_quantity = COALESCE(quarantine_quantity, 0) + v_qty,
                updated_at = NOW()
            WHERE product_id = v_prod_id AND warehouse_id = v_target_wh;
          ELSE
            INSERT INTO public.inventory (product_id, warehouse_id, quantity, quarantine_quantity)
            VALUES (v_prod_id, v_target_wh, 0, v_qty);
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- Mantener inventory_restocked y workflow_status coherentes sin recursión infinita
  IF (COALESCE(NEW.inventory_restocked, FALSE) IS FALSE AND v_newly_processed)
     OR (v_st = 'procesado' AND v_wf IN ('', 'pendiente')) THEN
    UPDATE public.reverse_logistics
    SET inventory_restocked = CASE
          WHEN v_newly_processed THEN TRUE
          ELSE inventory_restocked
        END,
        workflow_status = CASE
          WHEN v_st = 'procesado' AND LOWER(TRIM(COALESCE(workflow_status, ''))) IN ('', 'pendiente') THEN 'completado'
          ELSE workflow_status
        END,
        updated_at = NOW()
    WHERE id = NEW.id
      AND (
        (v_newly_processed AND COALESCE(inventory_restocked, FALSE) IS FALSE)
        OR (v_st = 'procesado' AND LOWER(TRIM(COALESCE(workflow_status, ''))) IN ('', 'pendiente'))
      );
  END IF;

  -- Si la actualización provino desde un cambio en public.orders, NO re-escribir public.orders
  -- (evita loops y evita sobreescribir 'Despachado' con 'Entregado' prematuramente).
  IF v_sync_dir = 'order_to_rl' THEN
    RETURN NEW;
  END IF;

  -- B. Gestión inteligente de la Orden WMS vinculada:
  -- B1. Si existe replacement_order_id (orden de salida de reemplazo v2):
  IF v_rep_order.id IS NOT NULL THEN
    IF v_rep_order.hold_reason = 'awaiting_return_receipt'
       AND COALESCE(NEW.payment_status, 'not_required') IN ('not_required', 'paid', 'waived')
       AND COALESCE(v_rep_order.estado_wms, '') NOT IN ('Listo para retiro', 'Despachado', 'Entregado', 'Cancelado', 'Archivado') THEN
      PERFORM set_config('app.syncing_reverse_logistics', 'rl_to_order', true);
      UPDATE public.orders
      SET hold_reason = NULL,
          status = CASE WHEN status = 'en espera' THEN 'para procesar' ELSE status END
      WHERE id = v_rep_order.id;
    END IF;
  END IF;

  -- B2. Si existe wms_order_id (orden de devolución entrante, o cambio presencial en sucursal):
  IF v_order.id IS NOT NULL AND (v_rep_order.id IS NULL OR v_order.id <> v_rep_order.id) THEN
    IF COALESCE(NEW.tipo_movimiento, 'DEVOLUCION') = 'DEVOLUCION'
       OR COALESCE(NEW.modo_entrega, '') = 'sucursal'
       OR COALESCE(NEW.logistics_option, '') = 'sucursal_nunoa' THEN
      IF COALESCE(v_order.estado_wms, '') NOT IN ('Entregado', 'Cancelado', 'Archivado') THEN
        PERFORM set_config('app.syncing_reverse_logistics', 'rl_to_order', true);
        PERFORM set_config('app.physical_carrier_transition', 'true', true);

        UPDATE public.orders
        SET
          estado_wms = 'Entregado',
          status = 'entregado',
          hold_reason = NULL,
          stock_descontado = TRUE,
          stock_descontado_at = COALESCE(stock_descontado_at, NOW()),
          transport_status_normalized = 'ENTREGADO',
          delivered_at = COALESCE(delivered_at, NOW()),
          closed_at = NOW(),
          closed_by_automation = 'auto-reverse-logistics-to-entregado'
        WHERE id = v_order.id;

        PERFORM public.log_automation_execution(
          'auto-reverse-logistics-to-entregado',
          v_order.id,
          v_order.external_order_number,
          v_order.comercio,
          COALESCE(v_order.estado_wms, 'En procesamiento'),
          'Entregado',
          'reverse_logistics',
          'Logística Inversa recepcionada y procesada en bodega (' || v_ref_label || ')',
          FALSE
        );
      END IF;
    ELSIF v_order.hold_reason = 'awaiting_return_receipt' THEN
      PERFORM set_config('app.syncing_reverse_logistics', 'rl_to_order', true);
      UPDATE public.orders
      SET hold_reason = NULL,
          status = CASE WHEN status = 'en espera' THEN 'para procesar' ELSE status END
      WHERE id = v_order.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_reverse_logistics_to_entregado ON public.reverse_logistics;
CREATE TRIGGER trg_auto_reverse_logistics_to_entregado
  AFTER INSERT OR UPDATE ON public.reverse_logistics
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_reverse_logistics_to_entregado_func();

-- 4. NUEVO TRIGGER: public.orders → public.reverse_logistics
--    Cuando una orden WMS de Logística Inversa pasa a Despachado o Entregado por cualquier vía
--    (panel Admin, courier, webhook, Picker o automatización), sincroniza automáticamente su
--    registro en reverse_logistics a status = 'procesado' / workflow_status = 'completado'.
CREATE OR REPLACE FUNCTION public.handle_order_to_reverse_logistics_sync_func()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sync_dir TEXT := COALESCE(current_setting('app.syncing_reverse_logistics', true), '');
  v_is_entregado BOOLEAN;
  v_is_despachado BOOLEAN;
  v_rl RECORD;
  v_rl_st TEXT;
  v_rl_wf TEXT;
  v_is_portal_rma BOOLEAN;
  v_should_complete BOOLEAN;
  v_prev_label TEXT;
BEGIN
  -- Evitar recursión cuando el cambio en orders provino de reverse_logistics
  IF v_sync_dir IN ('rl_to_order', 'order_to_rl') THEN
    RETURN NEW;
  END IF;

  -- Solo reaccionar si realmente cambió estado_wms o status
  IF OLD.estado_wms IS NOT DISTINCT FROM NEW.estado_wms
     AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  v_is_entregado := (
    NEW.estado_wms = 'Entregado'
    OR LOWER(TRIM(COALESCE(NEW.status, ''))) IN ('entregado', 'retirado')
  );
  v_is_despachado := (
    NEW.estado_wms = 'Despachado'
    OR LOWER(TRIM(COALESCE(NEW.status, ''))) = 'despachado'
  );

  IF NOT (v_is_entregado OR v_is_despachado) THEN
    RETURN NEW;
  END IF;

  -- Fast-path: ignorar pedidos regulares que no corresponden a Logística Inversa
  IF NOT (
    COALESCE(NEW.origen, '') IN ('Logística Inversa', 'Logistica Inversa')
    OR COALESCE(NEW.external_platform, '') IN ('Logística Inversa', 'Logistica Inversa')
    OR COALESCE(NEW.categoria_entrega, '') IN ('LOGÍSTICA INVERSA', 'LOGISTICA INVERSA')
    OR COALESCE(NEW.external_order_number, '') LIKE 'LI-%'
    OR COALESCE(NEW.external_order_number, '') LIKE 'RMA-%'
    OR COALESCE((NEW.raw_shopify_data->>'is_reverse_logistics')::boolean, FALSE) IS TRUE
    OR (NEW.raw_shopify_data IS NOT NULL AND NEW.raw_shopify_data ? 'rl_id')
  ) THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_automation_rule_enabled('auto-wms-order-to-reverse-logistics-completado') THEN
    RETURN NEW;
  END IF;

  FOR v_rl IN
    SELECT *
    FROM public.reverse_logistics
    WHERE wms_order_id = NEW.id
       OR replacement_order_id = NEW.id
  LOOP
    v_rl_st := LOWER(TRIM(COALESCE(v_rl.status, 'pendiente')));
    v_rl_wf := LOWER(TRIM(COALESCE(v_rl.workflow_status, 'pendiente')));

    -- Saltar registros ya terminales o rechazados/cancelados
    IF v_rl_wf IN ('completado', 'rechazado', 'cancelado')
       OR v_rl_st IN ('rechazado', 'cancelado') THEN
      CONTINUE;
    END IF;

    v_is_portal_rma := (
      v_rl.rma_number IS NOT NULL
      OR LOWER(TRIM(COALESCE(v_rl.portal_origin, 'wms_internal'))) IN ('seller_portal', 'stocka_global_portal', 'stocka_global')
    );

    v_should_complete := FALSE;

    IF NOT v_is_portal_rma THEN
      -- Solicitudes internas creadas por Seller o Admin en plataforma:
      -- pasan a Completado (procesado) al despacharse o entregarse la orden WMS vinculada.
      IF v_rl_st = 'pendiente' AND (v_is_despachado OR v_is_entregado) THEN
        v_should_complete := TRUE;
      END IF;
    ELSE
      -- Solicitudes del Portal Público RMA v2:
      -- solo se completan automáticamente al confirmarse entrega ('Entregado') de la orden
      -- una vez que el RMA ya había sido aprobado / estaba en preparación o recepción.
      IF v_is_entregado AND (
        v_rl_wf IN ('reemplazo_en_preparacion', 'cambio_en_preparacion')
        OR (
          COALESCE(v_rl.tipo_movimiento, '') = 'DEVOLUCION'
          AND v_rl_wf IN ('aprobado_esperando_retorno', 'en_transito_retorno', 'recibido_en_revision')
        )
      ) THEN
        v_should_complete := TRUE;
      END IF;
    END IF;

    IF v_should_complete THEN
      v_prev_label := COALESCE(NULLIF(v_rl_wf, ''), v_rl_st, 'pendiente');

      PERFORM set_config('app.syncing_reverse_logistics', 'order_to_rl', true);

      UPDATE public.reverse_logistics
      SET
        status = 'procesado',
        workflow_status = 'completado',
        sucursal = COALESCE(NULLIF(TRIM(sucursal), ''), NEW.sucursal_pickeo, 'Matriz Ñuñoa'),
        updated_at = NOW()
      WHERE id = v_rl.id;

      PERFORM public.log_automation_execution(
        'auto-wms-order-to-reverse-logistics-completado',
        NEW.id,
        NEW.external_order_number,
        NEW.comercio,
        v_prev_label,
        'completado',
        'orders',
        'Orden WMS pasó a ' || COALESCE(NEW.estado_wms, NEW.status, 'Despachado') || ' -> Logística Inversa completada automáticamente',
        FALSE
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_order_to_reverse_logistics_sync ON public.orders;
CREATE TRIGGER trg_auto_order_to_reverse_logistics_sync
  AFTER UPDATE OF estado_wms, status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_order_to_reverse_logistics_sync_func();

-- 5. Saneamiento idempotente de registros existentes:
-- 5.1 Registros ya procesados históricamente cuya columna workflow_status quedó en 'pendiente'
--     (como OLD.status ya es 'procesado' y productos no cambia, el trigger NO reingresa stock duplicado).
UPDATE public.reverse_logistics
SET
  workflow_status = 'completado',
  inventory_restocked = TRUE,
  updated_at = NOW()
WHERE LOWER(TRIM(COALESCE(status, ''))) IN ('procesado', 'confirmado')
  AND LOWER(TRIM(COALESCE(workflow_status, 'pendiente'))) IN ('', 'pendiente');

-- 5.2 Registros internos ('wms_internal') que quedaron pendientes pese a que su orden WMS
--     ya fue cerrada en 'Despachado' o 'Entregado' (el trigger reingresará stock solo si falta 'in').
DO $$
DECLARE
  v_rec RECORD;
BEGIN
  PERFORM set_config('app.syncing_reverse_logistics', 'order_to_rl', true);

  FOR v_rec IN
    SELECT rl.id, o.sucursal_pickeo
    FROM public.reverse_logistics rl
    JOIN public.orders o ON o.id = rl.wms_order_id
    WHERE LOWER(TRIM(COALESCE(rl.status, 'pendiente'))) = 'pendiente'
      AND rl.rma_number IS NULL
      AND LOWER(TRIM(COALESCE(rl.portal_origin, 'wms_internal'))) = 'wms_internal'
      AND (
        o.estado_wms IN ('Despachado', 'Entregado')
        OR LOWER(TRIM(COALESCE(o.status, ''))) IN ('despachado', 'entregado', 'retirado')
      )
  LOOP
    UPDATE public.reverse_logistics
    SET
      status = 'procesado',
      workflow_status = 'completado',
      sucursal = COALESCE(NULLIF(TRIM(sucursal), ''), v_rec.sucursal_pickeo, 'Matriz Ñuñoa'),
      updated_at = NOW()
    WHERE id = v_rec.id;
  END LOOP;
END;
$$;
