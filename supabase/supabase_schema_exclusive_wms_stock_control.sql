-- ==============================================================================
-- WMS STOCKA - MIGRACIÓN: EXCLUSIVIDAD DE ESTADO WMS EN CONTROL DE INVENTARIO
-- El stock (Físico, Mesa/Reservado, Comprometido y Movimientos) SOLO responde al estado WMS.
-- Los estados de origen/plataforma (status) NO descuentan ni alteran stock físico.
-- ==============================================================================

-- 1. Redefinir la función handle_order_status_change() para que se guíe EXCLUSIVAMENTE por estado_wms
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
    
    FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
      SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
      IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
        
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

        -- Si venía directo de procesamiento (sin pasar por mesa): libera de comprometido y descuenta físico
        ELSE
          UPDATE public.inventory 
          SET quantity = GREATEST(0, quantity - item.quantity),
              committed_quantity = GREATEST(0, committed_quantity - item.quantity)
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        END IF;
        
        -- Generar Log de Movimiento con fecha y hora actual exacta del WMS
        INSERT INTO public.movements (product_id, warehouse_id, type, quantity, date, reference_doc)
        VALUES (item.product_id, item.warehouse_id, 'out', item.quantity, NOW(), 'Pedido ' || v_order_num);
      END IF;
    END LOOP;

  -- =========================================================================
  -- CASO 2: El pedido pasa a "En preparación" o "Pickeado" (Sale del estante hacia la mesa)
  -- =========================================================================
  ELSIF v_new_wms IN ('En preparación', 'Pickeado') AND v_old_wms NOT IN ('En preparación', 'Pickeado') 
        AND v_old_wms != 'Despachado' THEN
    
    FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
      SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
      IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
        -- Si venía de estar comprometido en estante: liberar committed y sumar a reserved
        IF v_old_wms = 'En procesamiento' THEN
          UPDATE public.inventory 
          SET committed_quantity = GREATEST(0, committed_quantity - item.quantity),
              reserved_quantity = reserved_quantity + item.quantity
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        -- Si venía de Archivado o Cancelado: sumar directamente a reserved
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


-- 2. Redefinir la función handle_new_order_item() para guiarse por estado_wms
CREATE OR REPLACE FUNCTION public.handle_new_order_item()
RETURNS trigger AS $$
DECLARE
  v_wms_status TEXT;
  v_is_virtual BOOLEAN;
  v_should_process BOOLEAN;
BEGIN
  SELECT COALESCE(estado_wms, 'En procesamiento') INTO v_wms_status 
  FROM public.orders WHERE id = NEW.order_id;
  
  v_should_process := public.should_process_order_stock(NEW.order_id);

  IF NOT v_should_process THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = NEW.product_id;
  IF v_is_virtual THEN
    RETURN NEW;
  END IF;

  -- Si la orden está finalizada, cancelada o archivada en WMS, nunca alterar stock ni crear movimientos
  IF v_wms_status IN ('Despachado', 'Cancelado', 'Archivado') THEN
    RETURN NEW;
  END IF;

  -- Si la orden está en preparación/mesa: actualizar reserved_quantity
  IF v_wms_status IN ('En preparación', 'Pickeado') THEN
    IF NEW.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET reserved_quantity = reserved_quantity + NEW.quantity
      WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
    END IF;
  -- Si la orden está en procesamiento/estante: actualizar committed_quantity
  ELSE
    IF NEW.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET committed_quantity = committed_quantity + NEW.quantity
      WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. Redefinir la función handle_delete_order_item() para guiarse por estado_wms
CREATE OR REPLACE FUNCTION public.handle_delete_order_item()
RETURNS trigger AS $$
DECLARE
  v_wms_status TEXT;
  v_is_virtual BOOLEAN;
  v_should_process BOOLEAN;
BEGIN
  SELECT COALESCE(estado_wms, 'En procesamiento') INTO v_wms_status 
  FROM public.orders WHERE id = OLD.order_id;
  
  v_should_process := public.should_process_order_stock(OLD.order_id);

  IF NOT v_should_process THEN
    RETURN OLD;
  END IF;

  SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = OLD.product_id;
  IF v_is_virtual THEN
    RETURN OLD;
  END IF;

  -- Si la orden está finalizada, cancelada o archivada en WMS, no alterar stock
  IF v_wms_status IN ('Despachado', 'Cancelado', 'Archivado') THEN
    RETURN OLD;
  END IF;

  -- Si la orden estaba en preparación/mesa: liberar reserved_quantity
  IF v_wms_status IN ('En preparación', 'Pickeado') THEN
    IF OLD.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET reserved_quantity = GREATEST(0, reserved_quantity - OLD.quantity)
      WHERE product_id = OLD.product_id AND warehouse_id = OLD.warehouse_id;
    END IF;
  -- Si la orden estaba en procesamiento/estante: liberar committed_quantity
  ELSE
    IF OLD.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET committed_quantity = GREATEST(0, committed_quantity - OLD.quantity)
      WHERE product_id = OLD.product_id AND warehouse_id = OLD.warehouse_id;
    END IF;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4. Actualizar función de recálculo oficial (recalculate_committed_stock)
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

  -- Recalcular committed_quantity (Solo pedidos activos en estante: 'En procesamiento' o sin estado)
  FOR r IN 
    SELECT oi.product_id, oi.warehouse_id, SUM(oi.quantity) as total_committed
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE COALESCE(o.estado_wms, 'En procesamiento') NOT IN ('En preparación', 'Pickeado', 'Despachado', 'Cancelado', 'Archivado')
      AND public.should_process_order_stock(o.id)
    GROUP BY oi.product_id, oi.warehouse_id
  LOOP
    IF r.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET committed_quantity = r.total_committed
      WHERE product_id = r.product_id AND warehouse_id = r.warehouse_id;
    END IF;
  END LOOP;

  -- Recalcular reserved_quantity (Solo pedidos en mesa: 'En preparación' o 'Pickeado')
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
