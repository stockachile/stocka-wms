-- ==============================================================================
-- WMS STOCKA - CORRECCIÓN DEFINITIVA DE TRIGGERS EN BASE DE DATOS
-- Ejecutar este script en el SQL Editor de Supabase.
-- ==============================================================================

-- 1. Redefinir handle_new_order_item para NUNCA crear movimientos en pedidos cerrados
CREATE OR REPLACE FUNCTION public.handle_new_order_item()
RETURNS trigger AS $$
DECLARE
  v_order_status TEXT;
  v_is_virtual BOOLEAN;
  v_should_process BOOLEAN;
BEGIN
  SELECT status INTO v_order_status FROM public.orders WHERE id = NEW.order_id;
  v_should_process := public.should_process_order_stock(NEW.order_id);

  IF NOT v_should_process THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = NEW.product_id;
  IF v_is_virtual THEN
    RETURN NEW;
  END IF;

  -- Si la orden ya está finalizada (despachado, entregado, retirado, cancelado), NUNCA alterar stock ni crear movimientos
  IF v_order_status IN ('despachado', 'entregado', 'retirado', 'cancelado') THEN
    RETURN NEW;
  END IF;

  -- Si la orden está activa en preparación, actualiza stock comprometido
  IF NEW.warehouse_id IS NOT NULL THEN
    UPDATE public.inventory
    SET committed_quantity = committed_quantity + NEW.quantity
    WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. Redefinir handle_delete_order_item para NUNCA crear movimientos en pedidos cerrados
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

  SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = OLD.product_id;
  IF v_is_virtual THEN
    RETURN OLD;
  END IF;

  -- Si la orden ya está finalizada (despachado, entregado, retirado, cancelado), NUNCA alterar stock ni crear movimientos
  IF v_order_status IN ('despachado', 'entregado', 'retirado', 'cancelado') THEN
    RETURN OLD;
  END IF;

  -- Si la orden está activa en preparación, libera stock comprometido
  IF OLD.warehouse_id IS NOT NULL THEN
    UPDATE public.inventory
    SET committed_quantity = GREATEST(0, committed_quantity - OLD.quantity)
    WHERE product_id = OLD.product_id AND warehouse_id = OLD.warehouse_id;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. Redefinir handle_update_order_item para NUNCA crear movimientos en pedidos cerrados
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
  SELECT status INTO v_order_status FROM public.orders WHERE id = NEW.order_id;
  v_old_process := public.should_process_order_stock(OLD.order_id);
  v_new_process := public.should_process_order_stock(NEW.order_id);

  IF NOT v_old_process AND NOT v_new_process THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(is_virtual, false) INTO v_old_is_virtual FROM public.products WHERE id = OLD.product_id;
  SELECT COALESCE(is_virtual, false) INTO v_new_is_virtual FROM public.products WHERE id = NEW.product_id;

  -- Si la orden ya está finalizada, NUNCA alterar stock físico ni crear movimientos
  IF v_order_status IN ('despachado', 'entregado', 'retirado', 'cancelado') THEN
    RETURN NEW;
  END IF;

  -- Si la orden está activa en preparación, actualizar stock comprometido
  IF OLD.product_id != NEW.product_id OR OLD.warehouse_id != NEW.warehouse_id THEN
    IF v_old_process AND OLD.warehouse_id IS NOT NULL AND NOT v_old_is_virtual THEN
      UPDATE public.inventory
      SET committed_quantity = GREATEST(0, committed_quantity - OLD.quantity)
      WHERE product_id = OLD.product_id AND warehouse_id = OLD.warehouse_id;
    END IF;

    IF v_new_process AND NEW.warehouse_id IS NOT NULL AND NOT v_new_is_virtual THEN
      UPDATE public.inventory
      SET committed_quantity = committed_quantity + NEW.quantity
      WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
    END IF;
  ELSE
    v_qty_diff := NEW.quantity - OLD.quantity;
    IF v_qty_diff != 0 AND NEW.warehouse_id IS NOT NULL AND NOT v_new_is_virtual THEN
      UPDATE public.inventory
      SET committed_quantity = GREATEST(0, committed_quantity + v_qty_diff)
      WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Purgar definitivamente cualquier movimiento espurio residual
DELETE FROM public.movements WHERE reference_doc ILIKE '%Item % en edición%';
DELETE FROM public.movements WHERE reference_doc ILIKE '%Cambiado de bodega%';
