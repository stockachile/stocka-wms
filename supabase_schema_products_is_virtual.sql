-- WMS STOCKA - SQL Migration for Virtual Products Support
-- Run this script in the Supabase SQL Editor.

-- 1. Add is_virtual column to products table
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_virtual BOOLEAN DEFAULT FALSE;
COMMENT ON COLUMN public.products.is_virtual IS 'Indica si el producto es virtual y no requiere procesamiento logístico ni de stock';

-- 2. Update handle_new_order_item trigger function
CREATE OR REPLACE FUNCTION public.handle_new_order_item()
RETURNS trigger AS $$
BEGIN
  -- Si el producto es virtual, no procesamos stock comprometido
  IF EXISTS (SELECT 1 FROM public.products WHERE id = NEW.product_id AND is_virtual = true) THEN
    RETURN NEW;
  END IF;

  UPDATE inventory
  SET committed_quantity = committed_quantity + NEW.quantity
  WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Update handle_update_order_item trigger function
CREATE OR REPLACE FUNCTION public.handle_update_order_item()
RETURNS trigger AS $$
DECLARE
  v_order_status TEXT;
  v_old_process BOOLEAN;
  v_new_process BOOLEAN;
  v_old_is_virtual BOOLEAN;
  v_new_is_virtual BOOLEAN;
BEGIN
  SELECT status INTO v_order_status FROM public.orders WHERE id = COALESCE(NEW.order_id, OLD.order_id);
  IF v_order_status IN ('despachado', 'cancelado', 'entregado', 'retirado') THEN
    RETURN NEW;
  END IF;

  v_old_process := public.should_process_order_stock(OLD.order_id);
  v_new_process := public.should_process_order_stock(NEW.order_id);

  SELECT COALESCE(is_virtual, false) INTO v_old_is_virtual FROM public.products WHERE id = OLD.product_id;
  SELECT COALESCE(is_virtual, false) INTO v_new_is_virtual FROM public.products WHERE id = NEW.product_id;

  -- Restar cantidad anterior si correspondía procesar y tenía bodega y no era virtual
  IF v_old_process AND OLD.warehouse_id IS NOT NULL AND NOT v_old_is_virtual THEN
    UPDATE public.inventory
    SET committed_quantity = GREATEST(0, committed_quantity - OLD.quantity)
    WHERE product_id = OLD.product_id AND warehouse_id = OLD.warehouse_id;
  END IF;

  -- Sumar cantidad nueva si corresponde procesar y tiene bodega y no es virtual
  IF v_new_process AND NEW.warehouse_id IS NOT NULL AND NOT v_new_is_virtual THEN
    UPDATE public.inventory
    SET committed_quantity = committed_quantity + NEW.quantity
    WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Update handle_delete_order_item trigger function
CREATE OR REPLACE FUNCTION public.handle_delete_order_item()
RETURNS trigger AS $$
DECLARE
  v_order_status TEXT;
  v_is_virtual BOOLEAN;
BEGIN
  SELECT status INTO v_order_status FROM public.orders WHERE id = OLD.order_id;
  IF v_order_status IN ('despachado', 'cancelado', 'entregado', 'retirado') THEN
    RETURN OLD;
  END IF;

  SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = OLD.product_id;

  IF public.should_process_order_stock(OLD.order_id) AND OLD.warehouse_id IS NOT NULL AND NOT v_is_virtual THEN
    UPDATE public.inventory
    SET committed_quantity = GREATEST(0, committed_quantity - OLD.quantity)
    WHERE product_id = OLD.product_id AND warehouse_id = OLD.warehouse_id;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Update handle_order_status_change trigger function
CREATE OR REPLACE FUNCTION handle_order_status_change()
RETURNS trigger AS $$
BEGIN
  -- If status changes to 'despachado' or 'retirado'
  IF NEW.status IN ('despachado', 'retirado') AND OLD.status NOT IN ('despachado', 'retirado') THEN
    -- Decrease physical stock and committed stock for all items (except virtual ones)
    DECLARE
      item RECORD;
      v_is_virtual BOOLEAN;
    BEGIN
      FOR item IN SELECT * FROM order_items WHERE order_id = NEW.id LOOP
        SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
        
        IF NOT v_is_virtual THEN
          -- Update inventory
          UPDATE inventory 
          SET quantity = quantity - item.quantity,
              committed_quantity = committed_quantity - item.quantity,
              updated_at = NOW()
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;

          -- Create movement
          INSERT INTO movements (product_id, warehouse_id, type, quantity, reference_doc)
          VALUES (item.product_id, item.warehouse_id, 'out', item.quantity, 'Pedido ' || NEW.id);
        END IF;
      END LOOP;
    END;
  
  -- If status changes to 'cancelado' (and it wasn't already despachado/retirado)
  ELSIF NEW.status = 'cancelado' AND OLD.status NOT IN ('despachado', 'retirado', 'cancelado') THEN
    -- Release committed stock (except virtual ones)
    DECLARE
      item RECORD;
      v_is_virtual BOOLEAN;
    BEGIN
      FOR item IN SELECT * FROM order_items WHERE order_id = NEW.id LOOP
        SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
        
        IF NOT v_is_virtual THEN
          UPDATE inventory 
          SET committed_quantity = committed_quantity - item.quantity,
              updated_at = NOW()
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        END IF;
      END LOOP;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Update recalculate_committed_stock function
CREATE OR REPLACE FUNCTION public.recalculate_committed_stock()
RETURNS VOID AS $$
BEGIN
  -- Reset all committed quantities to 0
  UPDATE public.inventory SET committed_quantity = 0;

  -- Recalculate based on active orders (excluding virtual products)
  UPDATE public.inventory inv
  SET committed_quantity = COALESCE(summary.total_committed, 0)
  FROM (
    SELECT 
      oi.product_id,
      oi.warehouse_id,
      SUM(oi.quantity)::INTEGER AS total_committed
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.products p ON p.id = oi.product_id
    WHERE o.status NOT IN ('despachado', 'cancelado', 'entregado', 'retirado')
      AND oi.warehouse_id IS NOT NULL
      AND public.should_process_order_stock(o.id)
      AND COALESCE(p.is_virtual, false) = false
    GROUP BY oi.product_id, oi.warehouse_id
  ) summary
  WHERE inv.product_id = summary.product_id
    AND inv.warehouse_id = summary.warehouse_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
