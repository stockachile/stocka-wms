-- WMS STOCKA - SQL Migration to Fix Spurious Movements on Dispatched Order Syncs
-- Run this script in the Supabase SQL Editor.

-- 1. Actualizar handle_new_order_item para ignorar registros durante sincronizaciones automáticas (app.is_sync_mode)
CREATE OR REPLACE FUNCTION public.handle_new_order_item()
RETURNS trigger AS $$
DECLARE
  v_order_status TEXT;
  v_is_virtual BOOLEAN;
  v_should_process BOOLEAN;
  v_is_sync BOOLEAN;
BEGIN
  -- Verificar si la sesión actual está en modo de sincronización
  v_is_sync := COALESCE(current_setting('app.is_sync_mode', true), 'false') = 'true';
  IF v_is_sync THEN
    RETURN NEW;
  END IF;

  -- Obtener estado de la orden y ver si califica para procesamiento de stock
  SELECT status INTO v_order_status FROM public.orders WHERE id = NEW.order_id;
  v_should_process := public.should_process_order_stock(NEW.order_id);

  IF NOT v_should_process THEN
    RETURN NEW;
  END IF;

  -- Bypasar si el producto es virtual
  SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = NEW.product_id;
  IF v_is_virtual THEN
    RETURN NEW;
  END IF;

  -- Caso A: Pedido ya descontó stock físico (Despachado, Entregado, Retirado)
  IF v_order_status IN ('despachado', 'entregado', 'retirado') THEN
    IF NEW.warehouse_id IS NOT NULL THEN
      -- Descontar del stock físico real
      UPDATE public.inventory
      SET quantity = GREATEST(0, quantity - NEW.quantity)
      WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;

      -- Registrar movimiento de salida
      INSERT INTO public.movements (product_id, warehouse_id, type, quantity, reference_doc)
      VALUES (NEW.product_id, NEW.warehouse_id, 'out', NEW.quantity, 'Pedido ' || NEW.order_id || ' (Item agregado en edición)');
    END IF;

  -- Caso B: Pedido activo en preparación (Afecta stock comprometido)
  ELSIF v_order_status NOT IN ('cancelado') THEN
    IF NEW.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET committed_quantity = committed_quantity + NEW.quantity
      WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. Actualizar handle_delete_order_item para ignorar registros durante sincronizaciones automáticas
CREATE OR REPLACE FUNCTION public.handle_delete_order_item()
RETURNS trigger AS $$
DECLARE
  v_order_status TEXT;
  v_is_virtual BOOLEAN;
  v_should_process BOOLEAN;
  v_is_sync BOOLEAN;
BEGIN
  -- Verificar si la sesión actual está en modo de sincronización
  v_is_sync := COALESCE(current_setting('app.is_sync_mode', true), 'false') = 'true';
  IF v_is_sync THEN
    RETURN OLD;
  END IF;

  SELECT status INTO v_order_status FROM public.orders WHERE id = OLD.order_id;
  v_should_process := public.should_process_order_stock(OLD.order_id);

  IF NOT v_should_process THEN
    RETURN OLD;
  END IF;

  -- Bypasar si el producto es virtual
  SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = OLD.product_id;
  IF v_is_virtual THEN
    RETURN OLD;
  END IF;

  -- Caso A: Pedido ya descontó stock físico
  IF v_order_status IN ('despachado', 'entregado', 'retirado') THEN
    IF OLD.warehouse_id IS NOT NULL THEN
      -- Devolver al stock físico real
      UPDATE public.inventory
      SET quantity = quantity + OLD.quantity
      WHERE product_id = OLD.product_id AND warehouse_id = OLD.warehouse_id;

      -- Registrar movimiento de entrada (retorno)
      INSERT INTO public.movements (product_id, warehouse_id, type, quantity, reference_doc)
      VALUES (OLD.product_id, OLD.warehouse_id, 'in', OLD.quantity, 'Pedido ' || OLD.order_id || ' (Item eliminado en edición)');
    END IF;

  -- Caso B: Pedido activo en preparación (Libera stock comprometido)
  ELSIF v_order_status NOT IN ('cancelado') THEN
    IF OLD.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET committed_quantity = GREATEST(0, committed_quantity - OLD.quantity)
      WHERE product_id = OLD.product_id AND warehouse_id = OLD.warehouse_id;
    END IF;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. Script opcional para limpiar movimientos fantasma existentes que se anulan entre sí
-- (Ejecutar si se desea borrar registros pasados de +N y -N con glosa de edición creados al mismo segundo)
/*
DELETE FROM public.movements
WHERE id IN (
  SELECT m1.id
  FROM public.movements m1
  JOIN public.movements m2 ON m1.product_id = m2.product_id 
    AND m1.warehouse_id = m2.warehouse_id
    AND m1.quantity = m2.quantity
    AND DATE_TRUNC('minute', m1.date) = DATE_TRUNC('minute', m2.date)
  WHERE m1.reference_doc LIKE '%(Item agregado en edición)%'
    AND m2.reference_doc LIKE '%(Item eliminado en edición)%'
);
*/
