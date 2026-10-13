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
BEGIN
  -- Validar si el pedido califica para procesamiento de stock según reglas de corte
  IF NOT public.should_process_order_stock(NEW.id) THEN
    RETURN NEW;
  END IF;

  v_old_wms := COALESCE(OLD.estado_wms, 'En procesamiento');
  v_new_wms := COALESCE(NEW.estado_wms, 'En procesamiento');
  v_order_num := COALESCE(NEW.external_order_number, NEW.id::text);

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
          ELSIF v_old_wms = 'En procesamiento' THEN
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

          -- Si venía directo de procesamiento: libera de comprometido y descuenta físico
          ELSE
            UPDATE public.inventory 
            SET quantity = GREATEST(0, quantity - item.quantity),
                committed_quantity = GREATEST(0, committed_quantity - item.quantity)
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
        IF v_old_wms = 'En procesamiento' THEN
          UPDATE public.inventory 
          SET committed_quantity = GREATEST(0, committed_quantity - item.quantity),
              reserved_quantity = reserved_quantity + item.quantity
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        ELSIF v_old_wms IN ('Cancelado', 'Archivado') THEN
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
          SET reserved_quantity = GREATEST(0, reserved_quantity - item.quantity),
              committed_quantity = committed_quantity + item.quantity
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        ELSIF v_old_wms IN ('Archivado', 'Cancelado') THEN
          UPDATE public.inventory 
          SET committed_quantity = committed_quantity + item.quantity
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        END IF;
      END IF;
    END LOOP;

  -- =========================================================================
  -- CASO 4: El pedido se CANCELA o ARCHIVA en WMS (Liberación total de compromisos/reservas sin afectar físico)
  -- =========================================================================
  ELSIF v_new_wms IN ('Cancelado', 'Archivado') 
        AND v_old_wms NOT IN ('Cancelado', 'Archivado', 'Despachado') THEN
    
    FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
      SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
      IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
        IF v_old_wms IN ('En preparación', 'Pickeado') THEN
          UPDATE public.inventory 
          SET reserved_quantity = GREATEST(0, reserved_quantity - item.quantity)
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        ELSE
          UPDATE public.inventory 
          SET committed_quantity = GREATEST(0, committed_quantity - item.quantity)
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        END IF;
      END IF;
    END LOOP;

  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Reasegurar trigger sobre orders
DROP TRIGGER IF EXISTS on_order_wms_status_change ON public.orders;

CREATE TRIGGER on_order_wms_status_change
  BEFORE UPDATE OF estado_wms ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_order_status_change();
