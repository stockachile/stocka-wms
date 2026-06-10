-- WMS STOCKA - Phase 4 Admin Schema Updates

-- 1. Create a helper function to check if the current user is an admin
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- 2. Add Policies for Admins to view and modify all data

-- PROFILES: Admin can view all profiles
CREATE POLICY "Admin can view all profiles" ON profiles
  FOR SELECT USING (is_admin());

-- WAREHOUSES: Admin can insert/update/delete warehouses
CREATE POLICY "Admin can modify warehouses" ON warehouses
  FOR ALL USING (is_admin());

-- MERCHANTS_WAREHOUSES: Admin can view and modify all warehouse assignments
CREATE POLICY "Admin can view and modify all warehouse assignments" ON merchants_warehouses
  FOR ALL USING (is_admin());

-- PRODUCTS: Admin can view and modify all products
CREATE POLICY "Admin can view and modify all products" ON products
  FOR ALL USING (is_admin());

-- INVENTORY: Admin can view and modify all inventory records
CREATE POLICY "Admin can view and modify all inventory" ON inventory
  FOR ALL USING (is_admin());

-- MOVEMENTS: Admin can view and create all movements
CREATE POLICY "Admin can view and modify all movements" ON movements
  FOR ALL USING (is_admin());

-- ORDERS: Admin can view and modify all orders
CREATE POLICY "Admin can view and modify all orders" ON orders
  FOR ALL USING (is_admin());

-- ORDER_ITEMS: Admin can view and modify all order items
CREATE POLICY "Admin can view and modify all order items" ON order_items
  FOR ALL USING (is_admin());

-- 3. Modify the 'process_order_stock' Trigger
-- We previously had a trigger for when orders are set to 'despachado'.
-- Now we have more states:
-- para procesar -> en preparación -> preparado -> despachado -> en tránsito -> entregado
-- cancelado, en espera, listo para retiro, retirado
-- 
-- The math:
-- When order is CREATED (para procesar): committed++ (Already done in phase 2 trigger `on_order_item_created`)
-- When order state CHANGES to 'despachado' or 'retirado': 
--     physical_stock-- AND committed_stock--
-- When order state CHANGES to 'cancelado':
--     committed_stock--

CREATE OR REPLACE FUNCTION handle_order_status_change()
RETURNS trigger AS $$
BEGIN
  -- If status changes to 'despachado' or 'retirado'
  IF NEW.status IN ('despachado', 'retirado') AND OLD.status NOT IN ('despachado', 'retirado') THEN
    -- Decrease physical stock and committed stock for all items
    -- Also create a movement 'out'
    DECLARE
      item RECORD;
    BEGIN
      FOR item IN SELECT * FROM order_items WHERE order_id = NEW.id LOOP
        -- Update inventory
        UPDATE inventory 
        SET quantity = quantity - item.quantity,
            committed_quantity = committed_quantity - item.quantity,
            updated_at = NOW()
        WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;

        -- Create movement
        INSERT INTO movements (product_id, warehouse_id, type, quantity, reference_doc)
        VALUES (item.product_id, item.warehouse_id, 'out', item.quantity, 'Pedido ' || NEW.id);
      END LOOP;
    END;
  
  -- If status changes to 'cancelado' (and it wasn't already despachado/retirado)
  ELSIF NEW.status = 'cancelado' AND OLD.status NOT IN ('despachado', 'retirado', 'cancelado') THEN
    -- Release committed stock
    DECLARE
      item RECORD;
    BEGIN
      FOR item IN SELECT * FROM order_items WHERE order_id = NEW.id LOOP
        UPDATE inventory 
        SET committed_quantity = committed_quantity - item.quantity,
            updated_at = NOW()
        WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
      END LOOP;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- We already created `on_order_status_change` in Phase 2, but we replace it with this updated version.
DROP TRIGGER IF EXISTS on_order_status_change ON orders;

CREATE TRIGGER on_order_status_change
  AFTER UPDATE OF status ON orders
  FOR EACH ROW
  EXECUTE PROCEDURE handle_order_status_change();
