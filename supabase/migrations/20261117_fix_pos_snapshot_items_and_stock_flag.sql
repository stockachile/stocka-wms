-- =========================================================================================
-- MIGRACIÓN: Regularización de stock_descontado e items_snapshot en Ventas POS / Entregado
-- Fecha: 2026-11-17
-- Propósito:
--   1. Permitir transición unidireccional FALSE -> TRUE de stock_descontado y refresco
--      controlado de closed_snapshot (items_snapshot) en pedidos cerrados en 'Entregado'.
--   2. Actualizar automáticamente closed_snapshot.items_snapshot cuando se insertan filas
--      en public.order_items inmediatamente después de crear un pedido directo en 'Entregado'
--      (ej. Ventas Presenciales POS).
--   3. Regularizar órdenes existentes en 'Despachado'/'Entregado' que ya poseen su salida
--      física en Kardex (public.movements type='out') pero tenían stock_descontado = false,
--      y rellenar items_snapshot en órdenes 'Entregado' cuyos ítems se insertaron post-cabecera.
-- =========================================================================================

-- 1. Actualizar enforce_delivered_immutability_and_auto_close
CREATE OR REPLACE FUNCTION public.enforce_delivered_immutability_and_auto_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mkt JSONB;
  v_allow_snap_refresh BOOLEAN := (COALESCE(current_setting('app.refresh_closed_snapshot', true), 'false') = 'true');
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.estado_wms = 'Entregado'
     AND COALESCE(current_setting('app.allow_admin_reopen', true), 'false') <> 'true'
  THEN
    NEW.estado_wms := 'Entregado';
    NEW.status := OLD.status;
    NEW.tracking_number := COALESCE(OLD.tracking_number, NEW.tracking_number);
    NEW.tracking_url := COALESCE(OLD.tracking_url, NEW.tracking_url);
    NEW.courier := COALESCE(OLD.courier, NEW.courier);
    NEW.operador := COALESCE(OLD.operador, NEW.operador);
    NEW.agenda := COALESCE(OLD.agenda, NEW.agenda);
    NEW.categoria_entrega := COALESCE(OLD.categoria_entrega, NEW.categoria_entrega);
    NEW.sucursal_pickeo := COALESCE(OLD.sucursal_pickeo, NEW.sucursal_pickeo);
    NEW.cantidad := OLD.cantidad;
    NEW.sku := OLD.sku;
    NEW.item := OLD.item;
    -- Permitir confirmación unidireccional FALSE -> TRUE de stock_descontado (jamás revertir TRUE -> FALSE sin reapertura admin)
    NEW.stock_descontado := COALESCE(OLD.stock_descontado, FALSE) OR COALESCE(NEW.stock_descontado, FALSE);
    NEW.stock_descontado_at := COALESCE(
      OLD.stock_descontado_at,
      CASE WHEN COALESCE(NEW.stock_descontado, FALSE) THEN COALESCE(NEW.stock_descontado_at, NOW()) ELSE NULL END
    );
    NEW.dispatched_at := COALESCE(OLD.dispatched_at, NEW.dispatched_at);
    NEW.delivered_at := COALESCE(OLD.delivered_at, NEW.delivered_at);
    NEW.closed_at := COALESCE(OLD.closed_at, NEW.closed_at);
    NEW.closed_by_automation := COALESCE(OLD.closed_by_automation, NEW.closed_by_automation);
    NEW.transport_status_normalized := 'ENTREGADO';
    NEW.tracking_history := COALESCE(OLD.tracking_history, NEW.tracking_history);

    IF OLD.closed_snapshot IS NOT NULL
       AND NOT v_allow_snap_refresh
       AND (NEW.picker_history_snapshot IS NOT DISTINCT FROM OLD.picker_history_snapshot)
    THEN
      NEW.closed_snapshot := OLD.closed_snapshot;
    END IF;

    RETURN NEW;
  END IF;

  -- Auto-cierre por Venta Presencial POS o Entrega Confirmada en Marketplace/Shopify Fulfillment
  IF COALESCE(NEW.estado_wms, 'En procesamiento') NOT IN ('Entregado', 'Cancelado', 'Archivado') THEN
    v_mkt := public.extract_marketplace_or_pos_delivery(NEW);

    IF COALESCE((v_mkt->>'is_pos')::boolean, FALSE) IS TRUE
       AND public.is_automation_rule_enabled('auto-pos-sale-to-entregado') THEN
      NEW.estado_wms := 'Entregado';
      NEW.status := 'entregado';
      NEW.transport_status_normalized := 'ENTREGADO';
      NEW.closed_by_automation := 'auto-pos-sale-to-entregado';
      NEW.delivered_at := COALESCE(NEW.delivered_at, (v_mkt->>'delivered_at')::timestamptz, NOW());
      NEW.closed_at := COALESCE(NEW.closed_at, NOW());

    ELSIF COALESCE((v_mkt->>'is_delivered')::boolean, FALSE) IS TRUE
       AND public.is_automation_rule_enabled('auto-marketplace-delivered-to-entregado') THEN
      NEW.estado_wms := 'Entregado';
      NEW.status := 'entregado';
      NEW.transport_status_normalized := 'ENTREGADO';
      NEW.closed_by_automation := 'auto-marketplace-delivered-to-entregado';
      NEW.delivered_at := COALESCE(NEW.delivered_at, (v_mkt->>'delivered_at')::timestamptz, NOW());
      NEW.closed_at := COALESCE(NEW.closed_at, NOW());
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Actualizar handle_new_order_item para sellar items_snapshot cuando los order_items se insertan después de crear un pedido en 'Entregado' (ej. POS)
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

  -- Si el pedido ya nació cerrado en 'Entregado' (ej. Venta POS), enriquecer items_snapshot en closed_snapshot sin tocar stock ni Kardex
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

  IF v_wms_status IN ('Despachado', 'Cancelado', 'Archivado') THEN
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

-- 3. Regularización única e idempotente de datos existentes (sin alterar inventory ni movements)
DO $$
DECLARE
  r RECORD;
  v_items_json JSONB;
  v_total_units INT;
BEGIN
  PERFORM set_config('app.refresh_closed_snapshot', 'true', true);

  -- 3A. Sincronizar stock_descontado = TRUE en pedidos Despachado/Entregado que ya tienen salida registrada en Kardex (movements type='out')
  UPDATE public.orders o
  SET
    stock_descontado = TRUE,
    stock_descontado_at = COALESCE(
      o.stock_descontado_at,
      (SELECT MIN(m.date) FROM public.movements m WHERE m.order_id = o.id AND m.type = 'out'),
      o.dispatched_at,
      o.closed_at,
      NOW()
    ),
    closed_by_automation = CASE
      WHEN o.estado_wms = 'Entregado' AND o.closed_by_automation IS NULL AND UPPER(COALESCE(o.categoria_entrega, '')) LIKE '%POS%'
      THEN 'auto-pos-sale-to-entregado'
      ELSE o.closed_by_automation
    END
  WHERE o.estado_wms IN ('Despachado', 'Entregado')
    AND COALESCE(o.stock_descontado, FALSE) = FALSE
    AND EXISTS (
      SELECT 1 FROM public.movements m
      WHERE m.order_id = o.id AND m.type = 'out'
    );

  -- 3B. Poblar items_snapshot en pedidos 'Entregado' cuyo closed_snapshot tenía items_snapshot vacío pero sí poseen filas en order_items
  FOR r IN
    SELECT o.id, o.sku, o.item, o.cantidad
    FROM public.orders o
    WHERE o.estado_wms = 'Entregado'
      AND o.closed_snapshot IS NOT NULL
      AND jsonb_array_length(COALESCE(o.closed_snapshot->'items_snapshot', '[]'::jsonb)) = 0
      AND EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id)
  LOOP
    SELECT
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'product_id', oi.product_id,
          'sku', COALESCE(p.sku, r.sku),
          'name', COALESCE(p.name, r.item, 'Producto'),
          'barcode', COALESCE(NULLIF(p.barcode, ''), NULLIF(p.barcode_wms, ''), p.sku),
          'quantity', oi.quantity,
          'warehouse_id', oi.warehouse_id
        )
      ), '[]'::jsonb),
      COALESCE(SUM(oi.quantity), COALESCE(r.cantidad, 1))
    INTO v_items_json, v_total_units
    FROM public.order_items oi
    LEFT JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = r.id;

    UPDATE public.orders
    SET closed_snapshot = closed_snapshot || jsonb_build_object('items_snapshot', v_items_json, 'total_units', v_total_units)
    WHERE id = r.id;
  END LOOP;
END;
$$;
