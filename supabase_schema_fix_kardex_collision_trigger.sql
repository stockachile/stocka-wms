-- ==============================================================================
-- WMS STOCKA - CORRECCIÓN DEFINITIVA DE TRIGGER: PREVENCIÓN DE COLISIÓN DE KARDEX
-- ==============================================================================
-- Este script elimina la búsqueda permisiva por subcadenas numéricas (%clean_num%)
-- en el trigger handle_order_status_change(), la cual provocaba que órdenes con 
-- números cortos (ej: 2997, 1033, 1250) colisionaran erróneamente con UUIDs 
-- o pedidos de otros comercios, omitiendo la inserción en Kardex y la rebaja de stock.
--
-- Ejecuta este script en el Supabase SQL Editor.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.handle_order_status_change()
RETURNS trigger AS $$
DECLARE
  item RECORD;
  v_old_wms TEXT;
  v_new_wms TEXT;
  v_is_virtual BOOLEAN;
  v_order_num TEXT;
  v_was_eligible BOOLEAN;
  v_is_eligible BOOLEAN;
BEGIN
  -- Validar si el pedido califica para procesamiento de stock según reglas de corte
  IF NOT public.should_process_order_stock(NEW.id) THEN
    RETURN NEW;
  END IF;

  v_old_wms := COALESCE(OLD.estado_wms, 'En procesamiento');
  v_new_wms := COALESCE(NEW.estado_wms, 'En procesamiento');
  v_order_num := COALESCE(NEW.external_order_number, NEW.id::text);

  v_was_eligible := public.is_order_stock_eligible(OLD);
  v_is_eligible := public.is_order_stock_eligible(NEW);

  -- =========================================================================
  -- CASO 1: El pedido pasa a DESPACHADO (Únicamente cuando estado_wms = 'Despachado')
  -- =========================================================================
  IF v_new_wms = 'Despachado' AND v_old_wms != 'Despachado' THEN
    
    -- REGLA DE IDEMPOTENCIA BLINDADA (SIN COLISIÓN NUMÉRICA POR SUBCADENA):
    -- Solo se considera duplicado si:
    -- 1. La orden ya tenía stock_descontado = true en su registro previo (OLD)
    -- 2. Ya existen movimientos 'out' asignados a este order_id exacto
    -- 3. Existen movimientos 'out' desvinculados (order_id IS NULL) pero con coincidencia
    --    EXACTA del documento ('Pedido ' || v_order_num o 'Pedido #' || v_order_num)
    --    Y cuyos productos pertenezcan a esta orden.
    IF COALESCE(OLD.stock_descontado, false) = true 
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
      -- Auto-enlazar movimientos desvinculados ÚNICAMENTE con coincidencia exacta y del mismo producto
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

      -- Liberar compromisos o reservas en estante/mesa sin afectar stock físico
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

    -- Si NO existía movimiento previo: Realizar rebaja física e insertar en Kardex
    FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
      SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
      IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
        
        -- Blindaje por ítem: asegurar que no exista ya una salida previa de este producto y orden
        IF NOT EXISTS (
          SELECT 1 FROM public.movements 
          WHERE order_id = NEW.id AND product_id = item.product_id AND type = 'out'
        ) THEN
          -- Si venía de preparación/mesa (En preparación o Pickeado): libera de reservado y descuenta físico
          IF v_old_wms IN ('En preparación', 'Pickeado') THEN
            UPDATE public.inventory 
            SET quantity = GREATEST(0, quantity - item.quantity),
                reserved_quantity = GREATEST(0, reserved_quantity - item.quantity)
            WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
          
          -- Si venía de Archivado o Cancelado: descuenta directamente del stock físico
          ELSIF v_old_wms IN ('Cancelado', 'Archivado') THEN
            UPDATE public.inventory 
            SET quantity = GREATEST(0, quantity - item.quantity)
            WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;

          -- Si venía directo de procesamiento: libera de comprometido (si correspondía) y descuenta físico
          ELSE
            UPDATE public.inventory 
            SET quantity = GREATEST(0, quantity - item.quantity),
                committed_quantity = CASE WHEN v_was_eligible THEN GREATEST(0, committed_quantity - item.quantity) ELSE committed_quantity END
            WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
          END IF;
          
          -- Generar Log de Movimiento oficial con order_id explícito y fecha exacta
          INSERT INTO public.movements (product_id, warehouse_id, type, quantity, date, reference_doc, order_id)
          VALUES (item.product_id, item.warehouse_id, 'out', item.quantity, NOW(), 'Pedido ' || v_order_num, NEW.id);
        END IF;

      END IF;
    END LOOP;

    NEW.stock_descontado := true;
    NEW.stock_descontado_at := NOW();

  -- =========================================================================
  -- CASO 2: El pedido pasa a "En preparación" o "Pickeado" (Sale del estante hacia la mesa)
  -- =========================================================================
  ELSIF v_new_wms IN ('En preparación', 'Pickeado') AND v_old_wms NOT IN ('En preparación', 'Pickeado') 
        AND v_old_wms != 'Despachado' THEN
    
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
  -- CASO 3: El pedido se DEVUELVE de mesa ("En preparación"/"Pickeado") o inactivo a "En procesamiento"
  -- =========================================================================
  ELSIF v_new_wms = 'En procesamiento' AND v_old_wms IN ('En preparación', 'Pickeado', 'Archivado', 'Cancelado') 
        AND v_old_wms != 'Despachado' THEN
    
    FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
      SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
      IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
        IF v_old_wms IN ('En preparación', 'Pickeado') THEN
          UPDATE public.inventory 
          SET reserved_quantity = GREATEST(0, reserved_quantity - item.quantity)
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        END IF;

        IF v_is_eligible THEN
          UPDATE public.inventory 
          SET committed_quantity = committed_quantity + item.quantity
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        END IF;
      END IF;
    END LOOP;

  -- =========================================================================
  -- CASO 4: El pedido se CANCELA o ARCHIVA en WMS
  -- Nota: Si el pedido está 'En preparación' o 'Pickeado', el stock en mesa (reserved_quantity)
  -- NO se libera automáticamente por un cambio en 'status' (origen); solo se libera cuando
  -- estado_wms pasa explícitamente a 'Cancelado' o 'Archivado'.
  -- =========================================================================
  ELSIF v_new_wms IN ('Cancelado', 'Archivado') AND v_old_wms NOT IN ('Cancelado', 'Archivado', 'Despachado') THEN
    
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
  -- (Ej: Pago confirmado de pendiente -> pagado, o pedido cancelado / reembolsado)
  -- =========================================================================
  ELSIF v_new_wms = 'En procesamiento' AND v_old_wms = 'En procesamiento' THEN
    -- A) Si antes NO comprometía y AHORA SÍ compromete (pago y pedido confirmados):
    IF NOT v_was_eligible AND v_is_eligible THEN
      FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
        SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
        IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
          UPDATE public.inventory 
          SET committed_quantity = committed_quantity + item.quantity
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        END IF;
      END LOOP;

    -- B) Si antes SÍ comprometía y AHORA YA NO compromete (pasó a pendiente, reembolsado, o cancelado):
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Eliminar TODOS los triggers legados/duplicados sobre orders para evitar doble o triple ejecución
DROP TRIGGER IF EXISTS on_order_wms_status_change ON public.orders;
DROP TRIGGER IF EXISTS on_order_status_change ON public.orders;
DROP TRIGGER IF EXISTS on_order_status_update ON public.orders;
DROP TRIGGER IF EXISTS on_order_stock_change ON public.orders;

CREATE TRIGGER on_order_stock_change
  BEFORE UPDATE OF estado_wms, payment_status, status, raw_shopify_data ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_order_status_change();

-- Actualizar función de recálculo oficial (recalculate_committed_stock) para que el stock en mesa
-- (reserved_quantity) dependa exclusivamente de estado_wms ('En preparación', 'Pickeado')
CREATE OR REPLACE FUNCTION public.recalculate_committed_stock()
RETURNS void AS $$
DECLARE
  r RECORD;
BEGIN
  -- Resetear committed_quantity y reserved_quantity a 0
  UPDATE public.inventory 
  SET committed_quantity = 0, 
      reserved_quantity = 0
  WHERE id IS NOT NULL;

  -- Recalcular committed_quantity:
  -- Solo pedidos en estante ('En procesamiento'), que califiquen en should_process_order_stock
  -- Y que tengan pedido confirmado y pago confirmado
  FOR r IN 
    SELECT oi.product_id, oi.warehouse_id, SUM(oi.quantity) as total_committed
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE COALESCE(o.estado_wms, 'En procesamiento') NOT IN ('En preparación', 'Pickeado', 'Despachado', 'Cancelado', 'Archivado')
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

  -- Recalcular reserved_quantity:
  -- Pedidos físicamente activos en mesa de preparación ('En preparación' o 'Pickeado'),
  -- independientemente de si el cliente luego canceló en la plataforma de origen
  FOR r IN 
    SELECT oi.product_id, oi.warehouse_id, SUM(oi.quantity) as total_reserved
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recalcular stock comprometido y en mesa inmediatamente para sanear cualquier desfase previo
SELECT public.recalculate_committed_stock();
