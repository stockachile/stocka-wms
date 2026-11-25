-- =========================================================================================
-- MIGRACIÓN: Validación estricta de Bodega Física y Stock al pasar a Despachado / Entregado
-- Fecha: 2026-11-25
-- Propósito:
--   1. Impedir que un cambio manual a 'Entregado' o 'Despachado' salte la validación de stock
--      por enviar NEW.stock_descontado = true o por asumir transición automática de courier.
--   2. Garantizar que NINGUNA salida física ('Listo para retiro', 'Despachado', 'Entregado')
--      descuente stock en Bodega Central (ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09) ni omita
--      el Kardex por warehouse_id NULL:
--      - En acciones manuales sin bodega física asignada: exige seleccionar bodega física.
--      - En transiciones automáticas reales de transporte/retiro: resuelve automáticamente la
--        bodega física del pedido/producto (Ñuñoa, La Reina o Recoleta) y libera cualquier
--        compromiso previo que estuviese en Bodega Central.
-- =========================================================================================

-- 1. Helper para resolver siempre una bodega física real (nunca Bodega Central)
CREATE OR REPLACE FUNCTION public.resolve_physical_warehouse_for_order_item(
  p_order public.orders,
  p_product_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_central_wh UUID := 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09';
  v_nunoa_wh UUID := '973da888-8a63-4790-a08f-919e1af41a93';
  v_lareina_wh UUID := '414605cb-f926-43d2-8bd2-d9509f7b458a';
  v_recoleta_wh UUID := '1e3395fc-bc24-48e5-8c3c-04e8a0f7c32a';
  v_suc_low TEXT := LOWER(TRIM(COALESCE(p_order.sucursal_pickeo, '')));
  v_best_wh UUID;
BEGIN
  -- 1. Si el pedido ya indica una sucursal física explícita, respetarla
  IF v_suc_low LIKE '%la reina%' THEN
    RETURN v_lareina_wh;
  ELSIF v_suc_low LIKE '%recoleta%' THEN
    RETURN v_recoleta_wh;
  ELSIF v_suc_low LIKE '%ñuñoa%' OR v_suc_low LIKE '%nunoa%' THEN
    RETURN v_nunoa_wh;
  END IF;

  -- 2. Buscar la bodega física donde este producto tenga mayor stock físico disponible
  SELECT inv.warehouse_id
  INTO v_best_wh
  FROM public.inventory inv
  WHERE inv.product_id = p_product_id
    AND inv.warehouse_id IS NOT NULL
    AND inv.warehouse_id <> v_central_wh
  ORDER BY COALESCE(inv.quantity, 0) DESC,
           CASE WHEN inv.warehouse_id = v_nunoa_wh THEN 1 ELSE 2 END ASC
  LIMIT 1;

  IF v_best_wh IS NOT NULL THEN
    RETURN v_best_wh;
  END IF;

  -- 3. Buscar bodega física predominante de otros productos del mismo comercio
  SELECT inv.warehouse_id
  INTO v_best_wh
  FROM public.inventory inv
  JOIN public.products p ON p.id = inv.product_id
  WHERE p.comercio = p_order.comercio
    AND inv.warehouse_id IS NOT NULL
    AND inv.warehouse_id <> v_central_wh
    AND COALESCE(inv.quantity, 0) > 0
  GROUP BY inv.warehouse_id
  ORDER BY SUM(inv.quantity) DESC
  LIMIT 1;

  RETURN COALESCE(v_best_wh, v_nunoa_wh);
END;
$$;

-- 2. Actualizar validate_order_stock_before_dispatch
CREATE OR REPLACE FUNCTION public.validate_order_stock_before_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_central_wh UUID := 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09';
  item RECORD;
  v_eff_wh_id UUID;
  v_available_qty INTEGER;
  v_insufficient BOOLEAN := FALSE;
  v_user_id UUID;
  v_missing_sku TEXT;
  v_missing_qty INTEGER;
  v_wh_name TEXT;
  v_order_num TEXT;
  v_is_physical_auto BOOLEAN := FALSE;
  v_suc_low TEXT;
  v_has_explicit_sucursal BOOLEAN := FALSE;
  v_incident_title TEXT;
BEGIN
  v_order_num := COALESCE(NEW.external_order_number, NEW.id::text);

  -- 0. Idempotencia: SOLO si YA tenía stock descontado antes (OLD.stock_descontado = TRUE),
  --    o ya estaba en salida física antes, o ya cuenta con movimiento 'out' activo en bodega física.
  --    NOTA: NO usar NEW.stock_descontado = TRUE para evitar que un UPDATE manual salte esta validación.
  IF COALESCE(OLD.stock_descontado, FALSE) = TRUE
     OR COALESCE(OLD.estado_wms, '') IN ('Listo para retiro', 'Despachado', 'Entregado')
     OR (COALESCE(NEW.closed_by_automation, '') LIKE 'backfill:%' AND COALESCE(OLD.created_at, NOW()) < NOW() - INTERVAL '14 days')
     OR EXISTS (
          SELECT 1 FROM public.movements
          WHERE order_id = NEW.id
            AND type = 'out'
            AND reversed_at IS NULL
            AND warehouse_id <> v_central_wh
     )
     OR EXISTS (
          SELECT 1 FROM public.movements m
          JOIN public.order_items oi ON oi.order_id = NEW.id AND oi.product_id = m.product_id
          WHERE m.order_id IS NULL
            AND m.type = 'out'
            AND m.reversed_at IS NULL
            AND m.warehouse_id <> v_central_wh
            AND (m.reference_doc = 'Pedido ' || v_order_num
                 OR m.reference_doc = 'Pedido #' || v_order_num
                 OR m.reference_doc = 'Pedido ' || NEW.id::text)
     )
  THEN
    RETURN NEW;
  END IF;

  -- Solo considerar transición física automática cuando proviene genuinamente de automatizaciones / Picker / transporte real
  -- (NO cuando un usuario cambia manualmente a 'Entregado' con closed_by_automation IS NULL)
  v_is_physical_auto := (COALESCE(current_setting('app.physical_carrier_transition', true), 'false') = 'true')
                        OR (COALESCE(current_setting('app.picker_completed_transition', true), 'false') = 'true')
                        OR (NEW.closed_by_automation IS NOT NULL)
                        OR (NEW.estado_wms = 'Listo para retiro' AND COALESCE(OLD.estado_wms, '') IN ('En preparación', 'Pickeado'));

  IF (NEW.status IN ('listo para retiro', 'despachado', 'entregado', 'retirado', 'en preparación') AND COALESCE(OLD.status, '') NOT IN ('listo para retiro', 'despachado', 'entregado', 'retirado', 'en preparación'))
     OR (NEW.estado_wms IN ('En preparación', 'Listo para retiro', 'Despachado', 'Entregado') AND COALESCE(OLD.estado_wms, '') NOT IN ('En preparación', 'Listo para retiro', 'Despachado', 'Entregado')) THEN

      IF NOT public.should_process_order_stock(NEW.id) THEN
        RETURN NEW;
      END IF;

      v_suc_low := LOWER(TRIM(COALESCE(NEW.sucursal_pickeo, '')));
      v_has_explicit_sucursal := (v_suc_low LIKE '%ñuñoa%' OR v_suc_low LIKE '%nunoa%' OR v_suc_low LIKE '%la reina%' OR v_suc_low LIKE '%recoleta%');

      FOR item IN
        SELECT oi.*, p.sku, p.name AS prod_name, p.is_virtual
        FROM public.order_items oi
        JOIN public.products p ON p.id = oi.product_id
        WHERE oi.order_id = NEW.id
      LOOP
        IF COALESCE(item.is_virtual, FALSE) THEN
          CONTINUE;
        END IF;

        -- En 'En preparación' todavía se permite Hub Virtual si se eligió explícitamente,
        -- pero en SALIDA FÍSICA ('Listo para retiro', 'Despachado', 'Entregado') NUNCA se permite Bodega Central ni NULL.
        IF NEW.estado_wms IN ('Listo para retiro', 'Despachado', 'Entregado')
           OR NEW.status IN ('listo para retiro', 'despachado', 'entregado', 'retirado')
        THEN
          IF item.warehouse_id IS NULL OR item.warehouse_id = v_central_wh THEN
            IF NOT v_is_physical_auto AND NOT v_has_explicit_sucursal THEN
              RAISE EXCEPTION 'El pedido % tiene productos asignados a Bodega Central (Hub Virtual) sin sucursal física definida. Selecciona la bodega física (Ñuñoa, La Reina o Recoleta) desde donde descontar el stock.', v_order_num;
            END IF;
            v_eff_wh_id := public.resolve_physical_warehouse_for_order_item(NEW, item.product_id);
          ELSE
            v_eff_wh_id := item.warehouse_id;
          END IF;
        ELSE
          -- 'En preparación'
          IF item.warehouse_id IS NULL OR item.warehouse_id = v_central_wh THEN
            CONTINUE;
          END IF;
          v_eff_wh_id := item.warehouse_id;
        END IF;

        SELECT name INTO v_wh_name FROM public.warehouses WHERE id = v_eff_wh_id;

        SELECT COALESCE(quantity, 0) INTO v_available_qty
        FROM public.inventory
        WHERE product_id = item.product_id AND warehouse_id = v_eff_wh_id;

        IF COALESCE(v_available_qty, 0) < item.quantity THEN
          v_insufficient := TRUE;
          v_missing_sku := item.sku;
          v_missing_qty := item.quantity - COALESCE(v_available_qty, 0);
          v_wh_name := COALESCE(v_wh_name, 'Bodega Física');
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
              'El pedido ' || v_order_num || ' (' || COALESCE(NEW.comercio, 'Sin comercio') || ') avanzó automáticamente a "' || NEW.estado_wms || '" tras confirmación física de picking/transporte/retiro, pero en sistema faltaban ' || v_missing_qty || ' un. del SKU ' || v_missing_sku || ' en ' || v_wh_name || '. Se mantuvo el estado real del pedido y el inventario quedó en 0.',
              'stock',
              'alto',
              'pendiente',
              'Realizar conteo cíclico y ajuste de cuadratura del SKU ' || v_missing_sku || ' en ' || v_wh_name || '.'
            );
          END IF;
        ELSE
          -- Acción manual sin stock suficiente: revertir estado, limpiar cierres y registrar incidencia
          NEW.status := CASE
            WHEN COALESCE(OLD.estado_wms, 'En procesamiento') = 'En preparación' THEN 'en preparación'
            WHEN COALESCE(OLD.estado_wms, 'En procesamiento') = 'Pickeado' THEN 'preparado'
            ELSE 'para procesar'
          END;
          NEW.estado_wms := COALESCE(OLD.estado_wms, 'En procesamiento');
          NEW.stock_descontado := COALESCE(OLD.stock_descontado, FALSE);
          NEW.stock_descontado_at := OLD.stock_descontado_at;
          NEW.ready_for_pickup_at := OLD.ready_for_pickup_at;
          NEW.delivered_at := OLD.delivered_at;
          NEW.closed_at := OLD.closed_at;

          IF NOT EXISTS (
            SELECT 1 FROM public.incidencias
            WHERE comercio = NEW.comercio
              AND status = 'pendiente'
              AND title = 'Falta de stock crítico - Pedido ' || v_order_num
          ) THEN
            INSERT INTO public.incidencias (
              user_id, comercio, title, description, type, severity, status, solution
            ) VALUES (
              COALESCE(v_user_id, NEW.merchant_id),
              NEW.comercio,
              'Falta de stock crítico - Pedido ' || v_order_num,
              'El pedido ' || v_order_num || ' no se pudo pasar manualmente a "' || COALESCE(NEW.estado_wms, 'salida') || '" por falta de stock del SKU ' || v_missing_sku || ' en la bodega ' || v_wh_name || ' (Faltan ' || v_missing_qty || ' un.).',
              'stock',
              'critico',
              'pendiente',
              ''
            );
          END IF;

          RAISE EXCEPTION 'Stock físico insuficiente en % para SKU % (faltan % un.).', v_wh_name, v_missing_sku, v_missing_qty;
        END IF;
      END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 3. Actualizar handle_order_status_change para que toda salida física descuente SIEMPRE en bodega física real (nunca en Bodega Central ni NULL)
CREATE OR REPLACE FUNCTION public.handle_order_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_central_wh UUID := 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09';
  item RECORD;
  v_eff_wh_id UUID;
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
            WHERE order_id = NEW.id AND type = 'out' AND reversed_at IS NULL AND warehouse_id <> v_central_wh
       )
       OR EXISTS (
            SELECT 1 FROM public.movements m
            JOIN public.order_items oi ON oi.order_id = NEW.id AND oi.product_id = m.product_id
            WHERE m.order_id IS NULL
              AND m.type = 'out'
              AND m.reversed_at IS NULL
              AND m.warehouse_id <> v_central_wh
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
      IF NOT v_is_virtual THEN
        -- Resolver siempre bodega física real si el ítem seguía en Bodega Central o NULL
        IF item.warehouse_id IS NULL OR item.warehouse_id = v_central_wh THEN
          v_eff_wh_id := public.resolve_physical_warehouse_for_order_item(NEW, item.product_id);

          -- Liberar reserva/compromiso previo si estaba registrado sobre Bodega Central
          IF item.warehouse_id = v_central_wh THEN
            IF v_old_wms IN ('En preparación', 'Pickeado') THEN
              UPDATE public.inventory
              SET reserved_quantity = GREATEST(0, reserved_quantity - item.quantity)
              WHERE product_id = item.product_id AND warehouse_id = v_central_wh;
            ELSIF v_old_wms = 'En procesamiento' AND v_was_eligible THEN
              UPDATE public.inventory
              SET committed_quantity = GREATEST(0, committed_quantity - item.quantity)
              WHERE product_id = item.product_id AND warehouse_id = v_central_wh;
            END IF;
          END IF;

          UPDATE public.order_items
          SET warehouse_id = v_eff_wh_id
          WHERE id = item.id;
        ELSE
          v_eff_wh_id := item.warehouse_id;
        END IF;

        -- Si no tenía sucursal_pickeo asignada, sincronizarla con la bodega física resuelta
        IF NEW.sucursal_pickeo IS NULL OR TRIM(NEW.sucursal_pickeo) = '' OR NEW.sucursal_pickeo = 'Sucursal Virtual (Hub)' THEN
          NEW.sucursal_pickeo := CASE
            WHEN v_eff_wh_id = '414605cb-f926-43d2-8bd2-d9509f7b458a' THEN 'Sucursal La Reina'
            WHEN v_eff_wh_id = '1e3395fc-bc24-48e5-8c3c-04e8a0f7c32a' THEN 'Sucursal Recoleta'
            ELSE 'Sucursal Ñuñoa'
          END;
        END IF;

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
                reserved_quantity = CASE WHEN item.warehouse_id = v_eff_wh_id THEN GREATEST(0, reserved_quantity - item.quantity) ELSE reserved_quantity END
            WHERE product_id = item.product_id AND warehouse_id = v_eff_wh_id;

          ELSIF v_old_wms IN ('Cancelado', 'Archivado') THEN
            UPDATE public.inventory
            SET quantity = GREATEST(0, quantity - item.quantity)
            WHERE product_id = item.product_id AND warehouse_id = v_eff_wh_id;

          ELSE
            UPDATE public.inventory
            SET quantity = GREATEST(0, quantity - item.quantity),
                committed_quantity = CASE WHEN item.warehouse_id = v_eff_wh_id AND v_was_eligible THEN GREATEST(0, committed_quantity - item.quantity) ELSE committed_quantity END
            WHERE product_id = item.product_id AND warehouse_id = v_eff_wh_id;
          END IF;

          INSERT INTO public.movements (product_id, warehouse_id, type, quantity, date, reference_doc, order_id)
          VALUES (item.product_id, v_eff_wh_id, 'out', item.quantity, NOW(), 'Pedido ' || v_order_num, NEW.id);
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
