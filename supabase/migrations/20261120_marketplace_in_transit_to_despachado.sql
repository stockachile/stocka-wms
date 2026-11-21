-- =========================================================================================
-- MIGRACIÓN: Extensión de "En Tránsito -> Despachado" a Marketplaces y Shopify Fulfillment
-- Fecha: 2026-11-20
-- Propósito:
--   1. Extender public.extract_marketplace_or_pos_delivery para detectar estados "shipped" /
--      "in_transit" / "out_for_delivery" en Falabella, Mercado Libre, Paris, Ripley, Walmart
--      y Fulfillments nativos de Shopify (cuando el envío no pasa por envios_unificados).
--   2. Hacer que aa_enforce_delivered_immutability_and_auto_close avance automáticamente
--      dichos pedidos desde En procesamiento / En preparación / Pickeado hacia 'Despachado'
--      bajo la regla 'auto-transport-in-transit-to-despachado'.
--   3. Eliminar restricciones UPDATE OF columnas en triggers de stock/propagación para que
--      cualquier cambio de estado_wms efectuado dentro de un trigger BEFORE dispare siempre
--      el descuento de inventario, bitácora de automatizaciones y cola Shopify.
--   4. Ejecutar conciliación inmediata de pedidos abiertos actualmente en tránsito (ej. MAG3262170234).
-- =========================================================================================

-- 1. Actualizar descripción de la regla en el Centro de Automatizaciones
UPDATE public.automation_rules
SET
  trigger_desc = 'El envío asociado al pedido cambia a "EN TRÁNSITO" (movimiento físico confirmado en Envíame, BlueX, Starken, LightData/ALPHA, Optiroute, o estado "shipped / in_transit" en Falabella, Mercado Libre, Paris, Ripley, Walmart y Shopify Fulfillment).',
  tech_source = 'Triggers SQL handle_unified_shipment_status_change + enforce_delivered_immutability_and_auto_close',
  updated_at = NOW()
WHERE id = 'auto-transport-in-transit-to-despachado';

-- 2. Extender extract_marketplace_or_pos_delivery con detección de is_in_transit
CREATE OR REPLACE FUNCTION public.extract_marketplace_or_pos_delivery(p_order public.orders)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_plat TEXT := LOWER(REGEXP_REPLACE(COALESCE(p_order.origen, p_order.external_platform, ''), '\s+', '', 'g'));
  v_cat TEXT := UPPER(TRIM(COALESCE(p_order.categoria_entrega, '')));
  v_meli JSONB := p_order.raw_meli_data;
  v_meli_ship JSONB;
  v_meli_st TEXT;
  v_meli_sub TEXT;
  v_fal_st TEXT;
  v_paris_st TEXT;
  v_ripley_st TEXT;
  v_walmart_st TEXT;
  v_shop_f JSONB := NULL;
  v_deliv_at TIMESTAMPTZ := NULL;
BEGIN
  -- 1. Venta Presencial POS (SHOP POINT)
  IF v_cat IN ('SHOP POINT (POS)', 'SHOP POINT', 'POS')
     OR v_plat IN ('puntodeventa', 'pos', 'shoppoint', 'shoppoint(pos)')
     OR UPPER(TRIM(COALESCE(p_order.agenda, ''))) = 'COMPRA EN BODEGA'
     OR COALESCE((p_order.raw_shopify_data->>'is_pos_sale')::boolean, FALSE) IS TRUE
  THEN
    RETURN jsonb_build_object(
      'is_pos', TRUE,
      'is_delivered', TRUE,
      'is_in_transit', FALSE,
      'rule_id', 'auto-pos-sale-to-entregado',
      'source', 'pos',
      'courier', 'Venta Presencial Sucursal Ñuñoa',
      'status_text', 'Entregado en Punto de Venta (POS)',
      'delivered_at', COALESCE(p_order.created_at, NOW())
    );
  END IF;

  -- 2. Mercado Libre
  IF v_plat LIKE '%mercadolibre%' OR v_plat LIKE '%meli%' OR v_meli IS NOT NULL THEN
    IF jsonb_typeof(v_meli) = 'array' AND jsonb_array_length(v_meli) > 0 THEN
      v_meli_ship := v_meli->0->'shipping';
    ELSIF jsonb_typeof(v_meli) = 'object' THEN
      v_meli_ship := COALESCE(v_meli->'shipping', v_meli->'shipment', v_meli->'orders'->0->'shipping');
    END IF;
    v_meli_st := LOWER(TRIM(COALESCE(v_meli->>'shipping_status', v_meli_ship->>'status', '')));
    v_meli_sub := LOWER(TRIM(COALESCE(v_meli_ship->>'substatus', '')));

    IF v_meli_st = 'delivered' OR v_meli_sub = 'delivered' OR (v_meli_ship->'status_history'->>'date_delivered') IS NOT NULL THEN
      BEGIN
        v_deliv_at := (v_meli_ship->'status_history'->>'date_delivered')::timestamptz;
      EXCEPTION WHEN OTHERS THEN
        v_deliv_at := NULL;
      END;
      RETURN jsonb_build_object(
        'is_pos', FALSE,
        'is_delivered', TRUE,
        'is_in_transit', FALSE,
        'rule_id', 'auto-marketplace-delivered-to-entregado',
        'source', 'mercadolibre',
        'courier', COALESCE(NULLIF(TRIM(p_order.courier), ''), 'Mercado Libre'),
        'status_text', 'Entregado (Mercado Libre)',
        'delivered_at', COALESCE(v_deliv_at, NOW())
      );
    ELSIF v_meli_st = 'shipped'
          OR v_meli_sub IN ('in_transit', 'out_for_delivery', 'in_hub')
          OR (v_meli_ship->'status_history'->>'date_shipped') IS NOT NULL THEN
      RETURN jsonb_build_object(
        'is_pos', FALSE,
        'is_delivered', FALSE,
        'is_in_transit', TRUE,
        'rule_id', 'auto-transport-in-transit-to-despachado',
        'source', 'mercadolibre',
        'courier', COALESCE(NULLIF(TRIM(p_order.courier), ''), 'Mercado Libre'),
        'status_text', 'En tránsito (Mercado Libre)'
      );
    END IF;
  END IF;

  -- 3. Falabella
  IF v_plat LIKE '%falabella%' OR p_order.raw_falabella_data IS NOT NULL THEN
    v_fal_st := LOWER(TRIM(COALESCE(
      p_order.raw_falabella_data->'Statuses'->>'Status',
      p_order.raw_falabella_data->>'Status',
      p_order.raw_falabella_data->>'status',
      ''
    )));
    IF v_fal_st IN ('delivered', 'entregado') THEN
      RETURN jsonb_build_object(
        'is_pos', FALSE,
        'is_delivered', TRUE,
        'is_in_transit', FALSE,
        'rule_id', 'auto-marketplace-delivered-to-entregado',
        'source', 'falabella',
        'courier', COALESCE(NULLIF(TRIM(p_order.courier), ''), 'Falabella'),
        'status_text', 'Entregado (Falabella)',
        'delivered_at', NOW()
      );
    ELSIF v_fal_st IN ('shipped', 'in_transit', 'en tránsito', 'en transito') THEN
      RETURN jsonb_build_object(
        'is_pos', FALSE,
        'is_delivered', FALSE,
        'is_in_transit', TRUE,
        'rule_id', 'auto-transport-in-transit-to-despachado',
        'source', 'falabella',
        'courier', COALESCE(NULLIF(TRIM(p_order.courier), ''), 'Falabella'),
        'status_text', 'En tránsito (Falabella)'
      );
    END IF;
  END IF;

  -- 4. Paris
  IF v_plat LIKE '%paris%' OR p_order.raw_paris_data IS NOT NULL THEN
    v_paris_st := LOWER(TRIM(COALESCE(
      p_order.raw_paris_data->'subOrders'->0->'status'->>'name',
      CASE WHEN jsonb_typeof(p_order.raw_paris_data->'subOrders'->0->'status') = 'string'
           THEN p_order.raw_paris_data->'subOrders'->0->>'status' ELSE NULL END,
      p_order.raw_paris_data->>'status',
      p_order.payment_status,
      ''
    )));
    IF v_paris_st IN ('delivered', 'entregado', 'received')
       OR COALESCE(p_order.raw_paris_data->'subOrders'->0->'status'->>'id', '') = '4' THEN
      RETURN jsonb_build_object(
        'is_pos', FALSE,
        'is_delivered', TRUE,
        'is_in_transit', FALSE,
        'rule_id', 'auto-marketplace-delivered-to-entregado',
        'source', 'paris',
        'courier', COALESCE(NULLIF(TRIM(p_order.courier), ''), 'Paris'),
        'status_text', 'Entregado (Paris)',
        'delivered_at', NOW()
      );
    ELSIF v_paris_st IN ('shipped', 'shipped_by_seller', 'in_transit', 'en tránsito', 'en transito') THEN
      RETURN jsonb_build_object(
        'is_pos', FALSE,
        'is_delivered', FALSE,
        'is_in_transit', TRUE,
        'rule_id', 'auto-transport-in-transit-to-despachado',
        'source', 'paris',
        'courier', COALESCE(NULLIF(TRIM(p_order.courier), ''), 'Paris'),
        'status_text', 'En tránsito (Paris)'
      );
    END IF;
  END IF;

  -- 5. Ripley
  IF v_plat LIKE '%ripley%' OR p_order.raw_ripley_data IS NOT NULL THEN
    v_ripley_st := LOWER(TRIM(COALESCE(p_order.raw_ripley_data->>'order_state', p_order.raw_ripley_data->>'status', p_order.payment_status, '')));
    IF v_ripley_st IN ('received', 'delivered', 'entregado', 'closed') THEN
      RETURN jsonb_build_object(
        'is_pos', FALSE,
        'is_delivered', TRUE,
        'is_in_transit', FALSE,
        'rule_id', 'auto-marketplace-delivered-to-entregado',
        'source', 'ripley',
        'courier', COALESCE(NULLIF(TRIM(p_order.courier), ''), 'Ripley'),
        'status_text', 'Entregado (Ripley)',
        'delivered_at', NOW()
      );
    ELSIF v_ripley_st IN ('shipped', 'in_transit', 'en tránsito', 'en transito') THEN
      RETURN jsonb_build_object(
        'is_pos', FALSE,
        'is_delivered', FALSE,
        'is_in_transit', TRUE,
        'rule_id', 'auto-transport-in-transit-to-despachado',
        'source', 'ripley',
        'courier', COALESCE(NULLIF(TRIM(p_order.courier), ''), 'Ripley'),
        'status_text', 'En tránsito (Ripley)'
      );
    END IF;
  END IF;

  -- 6. Walmart
  IF v_plat LIKE '%walmart%' OR p_order.raw_walmart_data IS NOT NULL THEN
    v_walmart_st := LOWER(TRIM(COALESCE(p_order.raw_walmart_data->>'status', p_order.payment_status, '')));
    IF v_walmart_st IN ('delivered', 'entregado') THEN
      RETURN jsonb_build_object(
        'is_pos', FALSE,
        'is_delivered', TRUE,
        'is_in_transit', FALSE,
        'rule_id', 'auto-marketplace-delivered-to-entregado',
        'source', 'walmart',
        'courier', COALESCE(NULLIF(TRIM(p_order.courier), ''), 'Walmart'),
        'status_text', 'Entregado (Walmart)',
        'delivered_at', NOW()
      );
    ELSIF v_walmart_st IN ('shipped', 'in_transit', 'en tránsito', 'en transito') THEN
      RETURN jsonb_build_object(
        'is_pos', FALSE,
        'is_delivered', FALSE,
        'is_in_transit', TRUE,
        'rule_id', 'auto-transport-in-transit-to-despachado',
        'source', 'walmart',
        'courier', COALESCE(NULLIF(TRIM(p_order.courier), ''), 'Walmart'),
        'status_text', 'En tránsito (Walmart)'
      );
    END IF;
  END IF;

  -- 7. Shopify Fulfillment nativo (delivered o in_transit/out_for_delivery; excluye splits, retiros y couriers excluidos)
  IF p_order.raw_shopify_data IS NOT NULL
     AND jsonb_typeof(p_order.raw_shopify_data->'fulfillments') = 'array'
     AND COALESCE(p_order.is_split, FALSE) IS FALSE
     AND p_order.parent_order_id IS NULL
     AND COALESCE((p_order.raw_shopify_data->>'_is_split_child')::boolean, FALSE) IS FALSE
  THEN
    SELECT f INTO v_shop_f
    FROM jsonb_array_elements(p_order.raw_shopify_data->'fulfillments') AS f
    WHERE COALESCE(LOWER(TRIM(f->>'status')), 'success') <> 'cancelled'
      AND UPPER(COALESCE(f->>'tracking_company', '')) !~ '(RECIBELO|RECÍBELO|WELIVERY|WOODELIVERY|WODELY)'
      AND LOWER(TRIM(COALESCE(f->>'shipment_status', ''))) = 'delivered'
    LIMIT 1;

    IF v_shop_f IS NOT NULL THEN
      RETURN jsonb_build_object(
        'is_pos', FALSE,
        'is_delivered', TRUE,
        'is_in_transit', FALSE,
        'rule_id', 'auto-marketplace-delivered-to-entregado',
        'source', 'shopify_fulfillment',
        'courier', COALESCE(NULLIF(TRIM(p_order.courier), ''), NULLIF(TRIM(v_shop_f->>'tracking_company'), ''), p_order.operador, 'Courier Shopify'),
        'tracking', NULLIF(TRIM(v_shop_f->>'tracking_number'), ''),
        'status_text', 'Entregado (Shopify Fulfillment)',
        'delivered_at', NOW()
      );
    END IF;

    IF v_cat <> 'RETIRO' THEN
      SELECT f INTO v_shop_f
      FROM jsonb_array_elements(p_order.raw_shopify_data->'fulfillments') AS f
      WHERE COALESCE(LOWER(TRIM(f->>'status')), 'success') <> 'cancelled'
        AND UPPER(COALESCE(f->>'tracking_company', '')) !~ '(RECIBELO|RECÍBELO|WELIVERY|WOODELIVERY|WODELY)'
        AND LOWER(TRIM(COALESCE(f->>'shipment_status', ''))) IN ('in_transit', 'out_for_delivery')
      LIMIT 1;

      IF v_shop_f IS NOT NULL THEN
        RETURN jsonb_build_object(
          'is_pos', FALSE,
          'is_delivered', FALSE,
          'is_in_transit', TRUE,
          'rule_id', 'auto-transport-in-transit-to-despachado',
          'source', 'shopify_fulfillment',
          'courier', COALESCE(NULLIF(TRIM(p_order.courier), ''), NULLIF(TRIM(v_shop_f->>'tracking_company'), ''), p_order.operador, 'Courier Shopify'),
          'tracking', NULLIF(TRIM(v_shop_f->>'tracking_number'), ''),
          'status_text', 'En tránsito (Shopify Fulfillment)'
        );
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('is_pos', FALSE, 'is_delivered', FALSE, 'is_in_transit', FALSE);
END;
$$;

-- 3. Actualizar enforce_delivered_immutability_and_auto_close para aplicar también is_in_transit -> Despachado
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
  -- A. Inmutabilidad estricta si el pedido ya estaba cerrado en 'Entregado'
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

  -- B. Auto-transiciones por POS, Marketplace o Shopify Fulfillment
  IF COALESCE(NEW.estado_wms, 'En procesamiento') NOT IN ('Entregado', 'Cancelado', 'Archivado') THEN
    v_mkt := public.extract_marketplace_or_pos_delivery(NEW);

    IF COALESCE((v_mkt->>'is_pos')::boolean, FALSE) IS TRUE
       AND public.is_automation_rule_enabled('auto-pos-sale-to-entregado') THEN
      PERFORM set_config('app.physical_carrier_transition', 'true', true);
      NEW.estado_wms := 'Entregado';
      NEW.status := 'entregado';
      NEW.transport_status_normalized := 'ENTREGADO';
      NEW.closed_by_automation := 'auto-pos-sale-to-entregado';
      NEW.delivered_at := COALESCE(NEW.delivered_at, (v_mkt->>'delivered_at')::timestamptz, NOW());
      NEW.closed_at := COALESCE(NEW.closed_at, NOW());

    ELSIF COALESCE((v_mkt->>'is_delivered')::boolean, FALSE) IS TRUE
       AND public.is_automation_rule_enabled('auto-marketplace-delivered-to-entregado') THEN
      PERFORM set_config('app.physical_carrier_transition', 'true', true);
      NEW.estado_wms := 'Entregado';
      NEW.status := 'entregado';
      NEW.transport_status_normalized := 'ENTREGADO';
      NEW.closed_by_automation := 'auto-marketplace-delivered-to-entregado';
      NEW.tracking_number := COALESCE(NULLIF(TRIM(NEW.tracking_number), ''), NULLIF(TRIM(v_mkt->>'tracking'), ''));
      NEW.courier := COALESCE(NULLIF(TRIM(NEW.courier), ''), NULLIF(TRIM(v_mkt->>'courier'), ''));
      NEW.delivered_at := COALESCE(NEW.delivered_at, (v_mkt->>'delivered_at')::timestamptz, NOW());
      NEW.closed_at := COALESCE(NEW.closed_at, NOW());

    ELSIF TG_OP = 'UPDATE'
       AND COALESCE((v_mkt->>'is_in_transit')::boolean, FALSE) IS TRUE
       AND UPPER(TRIM(COALESCE(NEW.categoria_entrega, ''))) <> 'RETIRO'
       AND COALESCE(NEW.estado_wms, 'En procesamiento') IN ('En procesamiento', 'En preparación', 'Pickeado')
       AND public.is_automation_rule_enabled('auto-transport-in-transit-to-despachado') THEN
      PERFORM set_config('app.physical_carrier_transition', 'true', true);
      PERFORM set_config('app.marketplace_in_transit_triggered', 'true', true);
      NEW.estado_wms := 'Despachado';
      NEW.status := 'despachado';
      NEW.transport_status_normalized := 'EN TRÁNSITO';
      NEW.dispatched_at := COALESCE(NEW.dispatched_at, NOW());
      NEW.closed_by_automation := 'auto-transport-in-transit-to-despachado';
      NEW.tracking_number := COALESCE(NULLIF(TRIM(NEW.tracking_number), ''), NULLIF(TRIM(v_mkt->>'tracking'), ''));
      NEW.courier := COALESCE(NULLIF(TRIM(NEW.courier), ''), NULLIF(TRIM(v_mkt->>'courier'), ''));
      NEW.tracking_history := public.append_order_tracking_checkpoint(
        NEW.tracking_history,
        COALESCE(v_mkt->>'status_text', 'En tránsito'),
        'EN TRÁNSITO',
        COALESCE(v_mkt->>'source', 'marketplace'),
        NOW()
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 4. Actualizar after_order_wms_transition_propagate_func para registrar en bitácora los avances En Tránsito -> Despachado de Marketplaces/Shopify
CREATE OR REPLACE FUNCTION public.after_order_wms_transition_propagate_func()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_wms TEXT := CASE WHEN TG_OP = 'UPDATE' THEN COALESCE(OLD.estado_wms, 'En procesamiento') ELSE NULL END;
  v_admin_id UUID;
  v_inc_title TEXT;
  v_mkt JSONB;
BEGIN
  -- 1A. Registrar en bitácora si el cierre en Entregado fue disparado por regla automática en orders (POS / Marketplace)
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

  -- 1B. Registrar en bitácora y auditoría cuando un Marketplace / Shopify Fulfillment avanzó automáticamente a Despachado por estar En Tránsito
  IF TG_OP = 'UPDATE'
     AND NEW.estado_wms = 'Despachado'
     AND OLD.estado_wms IS DISTINCT FROM 'Despachado'
     AND NEW.closed_by_automation = 'auto-transport-in-transit-to-despachado'
     AND COALESCE(current_setting('app.marketplace_in_transit_triggered', true), 'false') = 'true'
  THEN
    v_mkt := public.extract_marketplace_or_pos_delivery(NEW);

    IF COALESCE(v_prev_wms, 'En procesamiento') IN ('En procesamiento', 'En preparación')
       AND NEW.picker_operator IS NULL THEN
      SELECT id INTO v_admin_id FROM public.profiles WHERE role = 'admin' LIMIT 1;
      v_inc_title := 'Alerta Picking: Tránsito/Entrega sin cierre Picker - Pedido ' || COALESCE(NEW.external_order_number, NEW.id::text);
      IF v_admin_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.incidencias WHERE title = v_inc_title AND status = 'pendiente'
      ) THEN
        INSERT INTO public.incidencias (
          user_id, comercio, title, description, solution, type, severity, status
        ) VALUES (
          v_admin_id,
          'ADMIN_ONLY',
          v_inc_title,
          'El pedido ' || COALESCE(NEW.external_order_number, NEW.id::text) || ' (' || COALESCE(NEW.comercio, '-') || ') pasó automáticamente de "' || COALESCE(v_prev_wms, 'En procesamiento') || '" a "Despachado" porque el canal/transporte (' || COALESCE(v_mkt->>'source', NEW.external_platform, 'Marketplace') || ') reportó "' || COALESCE(v_mkt->>'status_text', 'En tránsito') || '", sin registro previo de cierre en App Picker.',
          'Verificar en historial de Picker y confirmar limpieza de orden activa.',
          'pedido',
          'medio',
          'pendiente'
        );
      END IF;
    END IF;

    PERFORM public.log_automation_execution(
      'auto-transport-in-transit-to-despachado',
      NEW.id,
      NEW.external_order_number,
      NEW.comercio,
      COALESCE(v_prev_wms, 'En procesamiento'),
      'Despachado',
      COALESCE(v_mkt->>'source', NEW.external_platform, 'marketplace') || ':' || COALESCE(NEW.courier, ''),
      COALESCE(v_mkt->>'status_text', 'En tránsito') || ' · Guía: ' || COALESCE(NEW.tracking_number, 'S/N'),
      FALSE
    );

    INSERT INTO public.order_audit_logs (order_id, user_id, user_email, action, details)
    VALUES (
      NEW.id,
      NULL,
      'Centro de Automatizaciones WMS',
      'Cambio Automático por Estado de Transporte',
      jsonb_build_object(
        'rule_id', 'auto-transport-in-transit-to-despachado',
        'previous_wms_status', OLD.estado_wms,
        'new_wms_status', 'Despachado',
        'transport_status', COALESCE(v_mkt->>'status_text', 'En tránsito'),
        'normalized_status', 'EN TRÁNSITO',
        'courier', NEW.courier,
        'tracking', NEW.tracking_number,
        'changes', jsonb_build_array(
          'Estado WMS actualizado de "' || COALESCE(OLD.estado_wms, 'En procesamiento') || '" a "Despachado" por transporte (' || COALESCE(v_mkt->>'status_text', 'En tránsito') || ')'
        )
      )
    );
  END IF;

  -- 2. Propagar Despachado / Entregado desde Pedido Principal Consolidado hacia sus Pedidos Secundarios Consolidados
  IF NEW.estado_wms IN ('Despachado', 'Entregado')
     AND (TG_OP = 'INSERT' OR OLD.estado_wms IS DISTINCT FROM NEW.estado_wms)
  THEN
    PERFORM set_config('app.physical_carrier_transition', 'true', true);

    UPDATE public.orders child
    SET
      estado_wms = NEW.estado_wms,
      status = NEW.status,
      tracking_number = COALESCE(NEW.tracking_number, child.tracking_number),
      tracking_url = COALESCE(NEW.tracking_url, child.tracking_url),
      courier = COALESCE(NEW.courier, child.courier),
      operador = COALESCE(NEW.operador, child.operador),
      transport_status_normalized = NEW.transport_status_normalized,
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
      estado_wms = NEW.estado_wms,
      status = NEW.status,
      tracking_number = COALESCE(NEW.tracking_number, child.tracking_number),
      tracking_url = COALESCE(NEW.tracking_url, child.tracking_url),
      courier = COALESCE(NEW.courier, child.courier),
      operador = COALESCE(NEW.operador, child.operador),
      transport_status_normalized = NEW.transport_status_normalized,
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

-- 5. Garantizar que triggers de stock, propagación y cola Shopify se disparen siempre que un trigger BEFORE modifique estado_wms
DROP TRIGGER IF EXISTS on_order_stock_change ON public.orders;
CREATE TRIGGER on_order_stock_change
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_order_status_change();

DROP TRIGGER IF EXISTS trg_after_order_wms_transition_propagate ON public.orders;
CREATE TRIGGER trg_after_order_wms_transition_propagate
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.after_order_wms_transition_propagate_func();

DROP TRIGGER IF EXISTS trg_enqueue_shopify_fulfillment ON public.orders;
CREATE TRIGGER trg_enqueue_shopify_fulfillment
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_shopify_fulfillment_trigger_func();

-- 6. Actualizar RPC reconcile_wms_transport_automations para incluir también Marketplaces y Shopify Fulfillment
CREATE OR REPLACE FUNCTION public.reconcile_wms_transport_automations(p_limit INT DEFAULT 400)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_ord public.orders;
  v_mkt JSONB;
  v_to_entregado INT := 0;
  v_to_despachado INT := 0;
BEGIN
  PERFORM set_config('app.physical_carrier_transition', 'true', true);

  -- 1. Retiros marcados ENTREGADO / RETIRADO en store_pickups
  IF public.is_automation_rule_enabled('auto-pickup-retirado-to-entregado') THEN
    FOR v_rec IN
      SELECT DISTINCT ON (o.id) o.id, o.external_order_number, o.comercio, o.estado_wms, sp.sucursal, sp.pin_retiro, sp.updated_at
      FROM public.orders o
      JOIN public.store_pickups sp
        ON sp.pedido IN (o.external_order_number, REGEXP_REPLACE(COALESCE(o.external_order_number, ''), '^#+', ''), '#' || REGEXP_REPLACE(COALESCE(o.external_order_number, ''), '^#+', ''))
      WHERE UPPER(TRIM(COALESCE(sp.estado_pedido, ''))) IN ('ENTREGADO', 'RETIRADO')
        AND COALESCE(o.estado_wms, 'En procesamiento') NOT IN ('Entregado', 'Cancelado', 'Archivado')
        AND (sp.comercio IS NULL OR LOWER(TRIM(sp.comercio)) = LOWER(TRIM(COALESCE(o.comercio, ''))))
      LIMIT p_limit
    LOOP
      UPDATE public.orders
      SET estado_wms = 'Entregado',
          status = 'retirado',
          delivered_at = COALESCE(delivered_at, v_rec.updated_at, NOW()),
          closed_at = NOW(),
          closed_by_automation = 'auto-pickup-retirado-to-entregado'
      WHERE id = v_rec.id;
      v_to_entregado := v_to_entregado + 1;
    END LOOP;
  END IF;

  -- 2. Envíos en envios_unificados con estado normalizado ENTREGADO o EN TRÁNSITO
  FOR v_rec IN
    SELECT DISTINCT ON (m.id)
      m.id,
      m.external_order_number,
      m.comercio,
      m.estado_wms,
      m.categoria_entrega,
      m.source_table,
      m.courier,
      m.tracking,
      m.updated_at,
      (public.classify_shipment_transport_status(m.source_table, m.status, m.raw_data))->>'norm' AS norm_st,
      (public.classify_shipment_transport_status(m.source_table, m.status, m.raw_data))->>'clean_status' AS clean_st
    FROM (
      SELECT o.id, o.external_order_number, o.comercio, o.estado_wms, o.categoria_entrega,
             eu.source_table, eu.courier, eu.tracking, eu.updated_at, eu.status, eu.raw_data
      FROM public.orders o
      JOIN public.envios_unificados eu ON eu.tracking = o.tracking_number
      WHERE COALESCE(o.estado_wms, 'En procesamiento') NOT IN ('Entregado', 'Cancelado', 'Archivado')
        AND o.tracking_number IS NOT NULL AND o.tracking_number <> '' AND UPPER(o.tracking_number) NOT IN ('N/A', 'NO INFORMADO', '-')
      UNION ALL
      SELECT o.id, o.external_order_number, o.comercio, o.estado_wms, o.categoria_entrega,
             eu.source_table, eu.courier, eu.tracking, eu.updated_at, eu.status, eu.raw_data
      FROM public.orders o
      JOIN public.envios_unificados eu ON eu.source_table = 'lightdata_envios' AND eu.source_id = o.tracking_number
      WHERE COALESCE(o.estado_wms, 'En procesamiento') NOT IN ('Entregado', 'Cancelado', 'Archivado')
        AND o.tracking_number IS NOT NULL AND o.tracking_number <> '' AND UPPER(o.tracking_number) NOT IN ('N/A', 'NO INFORMADO', '-')
      UNION ALL
      SELECT o.id, o.external_order_number, o.comercio, o.estado_wms, o.categoria_entrega,
             eu.source_table, eu.courier, eu.tracking, eu.updated_at, eu.status, eu.raw_data
      FROM public.orders o
      JOIN public.envios_unificados eu ON eu.pedido_referencia = o.external_order_number
      WHERE COALESCE(o.estado_wms, 'En procesamiento') NOT IN ('Entregado', 'Cancelado', 'Archivado')
        AND o.external_order_number IS NOT NULL
        AND (eu.empresa_comercio_proveedor IS NULL OR UPPER(TRIM(eu.empresa_comercio_proveedor)) IN ('', 'NO ASIGNADO', 'STOCKA') OR LOWER(TRIM(eu.empresa_comercio_proveedor)) = LOWER(TRIM(COALESCE(o.comercio, ''))))
    ) m
    WHERE UPPER(COALESCE(m.courier, '')) !~ '(RECIBELO|RECÍBELO|WELIVERY|WOODELIVERY|WODELY)'
    ORDER BY m.id,
      CASE WHEN (public.classify_shipment_transport_status(m.source_table, m.status, m.raw_data))->>'norm' = 'ENTREGADO' THEN 3
           WHEN (public.classify_shipment_transport_status(m.source_table, m.status, m.raw_data))->>'norm' = 'EN TRÁNSITO' THEN 2
           ELSE 1 END DESC,
      m.updated_at DESC NULLS LAST
    LIMIT p_limit
  LOOP
    IF v_rec.norm_st = 'ENTREGADO' AND public.is_automation_rule_enabled('auto-dispatch-delivered-to-entregado') THEN
      UPDATE public.orders
      SET estado_wms = 'Entregado',
          status = 'entregado',
          delivered_at = COALESCE(delivered_at, v_rec.updated_at, NOW()),
          closed_at = NOW(),
          closed_by_automation = 'auto-dispatch-delivered-to-entregado'
      WHERE id = v_rec.id;
      v_to_entregado := v_to_entregado + 1;

    ELSIF v_rec.norm_st = 'EN TRÁNSITO'
          AND UPPER(TRIM(COALESCE(v_rec.categoria_entrega, ''))) <> 'RETIRO'
          AND COALESCE(v_rec.estado_wms, 'En procesamiento') IN ('En procesamiento', 'En preparación', 'Pickeado')
          AND public.is_automation_rule_enabled('auto-transport-in-transit-to-despachado') THEN
      UPDATE public.orders
      SET estado_wms = 'Despachado',
          status = 'despachado',
          transport_status_normalized = 'EN TRÁNSITO',
          dispatched_at = COALESCE(dispatched_at, v_rec.updated_at, NOW()),
          closed_by_automation = 'auto-transport-in-transit-to-despachado'
      WHERE id = v_rec.id;
      v_to_despachado := v_to_despachado + 1;
    END IF;
  END LOOP;

  -- 3. Marketplaces (Falabella, Mercado Libre, Paris, Ripley, Walmart) y Shopify Fulfillment nativo
  FOR v_ord IN
    SELECT o.*
    FROM public.orders o
    WHERE COALESCE(o.estado_wms, 'En procesamiento') NOT IN ('Entregado', 'Cancelado', 'Archivado')
      AND (
        o.raw_falabella_data IS NOT NULL
        OR o.raw_meli_data IS NOT NULL
        OR o.raw_paris_data IS NOT NULL
        OR o.raw_ripley_data IS NOT NULL
        OR o.raw_walmart_data IS NOT NULL
        OR (o.raw_shopify_data IS NOT NULL AND jsonb_typeof(o.raw_shopify_data->'fulfillments') = 'array')
      )
      AND (
        COALESCE((public.extract_marketplace_or_pos_delivery(o)->>'is_delivered')::boolean, FALSE) IS TRUE
        OR (
          COALESCE((public.extract_marketplace_or_pos_delivery(o)->>'is_in_transit')::boolean, FALSE) IS TRUE
          AND UPPER(TRIM(COALESCE(o.categoria_entrega, ''))) <> 'RETIRO'
          AND COALESCE(o.estado_wms, 'En procesamiento') IN ('En procesamiento', 'En preparación', 'Pickeado')
        )
      )
    LIMIT p_limit
  LOOP
    v_mkt := public.extract_marketplace_or_pos_delivery(v_ord);
    IF COALESCE((v_mkt->>'is_delivered')::boolean, FALSE) IS TRUE
       AND public.is_automation_rule_enabled('auto-marketplace-delivered-to-entregado') THEN
      UPDATE public.orders
      SET estado_wms = 'Entregado',
          status = 'entregado',
          delivered_at = COALESCE(delivered_at, NOW()),
          closed_at = NOW(),
          closed_by_automation = 'auto-marketplace-delivered-to-entregado'
      WHERE id = v_ord.id;
      v_to_entregado := v_to_entregado + 1;

    ELSIF COALESCE((v_mkt->>'is_in_transit')::boolean, FALSE) IS TRUE
          AND public.is_automation_rule_enabled('auto-transport-in-transit-to-despachado') THEN
      PERFORM set_config('app.marketplace_in_transit_triggered', 'true', true);
      UPDATE public.orders
      SET estado_wms = 'Despachado',
          status = 'despachado',
          transport_status_normalized = 'EN TRÁNSITO',
          dispatched_at = COALESCE(dispatched_at, NOW()),
          tracking_number = COALESCE(NULLIF(TRIM(tracking_number), ''), NULLIF(TRIM(v_mkt->>'tracking'), '')),
          courier = COALESCE(NULLIF(TRIM(courier), ''), NULLIF(TRIM(v_mkt->>'courier'), '')),
          closed_by_automation = 'auto-transport-in-transit-to-despachado',
          tracking_history = public.append_order_tracking_checkpoint(
            tracking_history,
            COALESCE(v_mkt->>'status_text', 'En tránsito'),
            'EN TRÁNSITO',
            COALESCE(v_mkt->>'source', 'marketplace'),
            NOW()
          )
      WHERE id = v_ord.id;
      v_to_despachado := v_to_despachado + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'moved_to_entregado', v_to_entregado,
    'moved_to_despachado', v_to_despachado
  );
END;
$$;

-- 7. Ejecutar conciliación inmediata en producción
SELECT public.reconcile_wms_transport_automations(500);
