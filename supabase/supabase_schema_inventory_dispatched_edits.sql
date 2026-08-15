-- WMS STOCKA - SQL Migration for Dispatched Order Items Edits
-- Run this script in the Supabase SQL Editor.

-- 1. Actualizar handle_new_order_item para descontar stock físico si el pedido ya está despachado/completado
CREATE OR REPLACE FUNCTION public.handle_new_order_item()
RETURNS trigger AS $$
DECLARE
  v_order_status TEXT;
  v_is_virtual BOOLEAN;
  v_should_process BOOLEAN;
BEGIN
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


-- 2. Actualizar handle_delete_order_item para devolver stock físico si el pedido ya está despachado/completado
CREATE OR REPLACE FUNCTION public.handle_delete_order_item()
RETURNS trigger AS $$
DECLARE
  v_order_status TEXT;
  v_is_virtual BOOLEAN;
  v_should_process BOOLEAN;
BEGIN
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


-- 3. Actualizar handle_update_order_item para manejar cambios de cantidad, producto o bodega en pedidos despachados/completados
CREATE OR REPLACE FUNCTION public.handle_update_order_item()
RETURNS trigger AS $$
DECLARE
  v_order_status TEXT;
  v_old_process BOOLEAN;
  v_new_process BOOLEAN;
  v_old_is_virtual BOOLEAN;
  v_new_is_virtual BOOLEAN;
  v_qty_diff INTEGER;
BEGIN
  SELECT status INTO v_order_status FROM public.orders WHERE id = COALESCE(NEW.order_id, OLD.order_id);
  v_old_process := public.should_process_order_stock(OLD.order_id);
  v_new_process := public.should_process_order_stock(NEW.order_id);

  SELECT COALESCE(is_virtual, false) INTO v_old_is_virtual FROM public.products WHERE id = OLD.product_id;
  SELECT COALESCE(is_virtual, false) INTO v_new_is_virtual FROM public.products WHERE id = NEW.product_id;

  -- Caso A: Pedido ya descontó stock físico
  IF v_order_status IN ('despachado', 'entregado', 'retirado') THEN
    -- A1. Si cambió el producto o la bodega:
    IF OLD.product_id != NEW.product_id OR OLD.warehouse_id != NEW.warehouse_id THEN
      -- Devolver stock del anterior
      IF v_old_process AND OLD.warehouse_id IS NOT NULL AND NOT v_old_is_virtual THEN
        UPDATE public.inventory
        SET quantity = quantity + OLD.quantity
        WHERE product_id = OLD.product_id AND warehouse_id = OLD.warehouse_id;

        INSERT INTO public.movements (product_id, warehouse_id, type, quantity, reference_doc)
        VALUES (OLD.product_id, OLD.warehouse_id, 'in', OLD.quantity, 'Pedido ' || OLD.order_id || ' (Cambiado de bodega/producto)');
      END IF;

      -- Descontar stock del nuevo
      IF v_new_process AND NEW.warehouse_id IS NOT NULL AND NOT v_new_is_virtual THEN
        UPDATE public.inventory
        SET quantity = GREATEST(0, quantity - NEW.quantity)
        WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;

        INSERT INTO public.movements (product_id, warehouse_id, type, quantity, reference_doc)
        VALUES (NEW.product_id, NEW.warehouse_id, 'out', NEW.quantity, 'Pedido ' || NEW.order_id || ' (Cambiado de bodega/producto)');
      END IF;
      
    -- A2. Mismo producto/bodega, pero cambió la cantidad
    ELSIF OLD.quantity != NEW.quantity THEN
      IF v_new_process AND NEW.warehouse_id IS NOT NULL AND NOT v_new_is_virtual THEN
        v_qty_diff := NEW.quantity - OLD.quantity;
        
        IF v_qty_diff > 0 THEN
          -- Aumentó cantidad: descontar stock adicional
          UPDATE public.inventory
          SET quantity = GREATEST(0, quantity - v_qty_diff)
          WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;

          INSERT INTO public.movements (product_id, warehouse_id, type, quantity, reference_doc)
          VALUES (NEW.product_id, NEW.warehouse_id, 'out', v_qty_diff, 'Pedido ' || NEW.order_id || ' (Aumento de cantidad en edición)');
        ELSE
          -- Disminuyó cantidad: devolver stock sobrante
          UPDATE public.inventory
          SET quantity = quantity + ABS(v_qty_diff)
          WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;

          INSERT INTO public.movements (product_id, warehouse_id, type, quantity, reference_doc)
          VALUES (NEW.product_id, NEW.warehouse_id, 'in', ABS(v_qty_diff), 'Pedido ' || NEW.order_id || ' (Reducción de cantidad en edición)');
        END IF;
      END IF;
    END IF;

  -- Caso B: Pedido activo en preparación (Afecta stock comprometido)
  ELSIF v_order_status NOT IN ('cancelado') THEN
    -- Restar anterior
    IF v_old_process AND OLD.warehouse_id IS NOT NULL AND NOT v_old_is_virtual THEN
      UPDATE public.inventory
      SET committed_quantity = GREATEST(0, committed_quantity - OLD.quantity)
      WHERE product_id = OLD.product_id AND warehouse_id = OLD.warehouse_id;
    END IF;

    -- Sumar nuevo
    IF v_new_process AND NEW.warehouse_id IS NOT NULL AND NOT v_new_is_virtual THEN
      UPDATE public.inventory
      SET committed_quantity = committed_quantity + NEW.quantity
      WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
