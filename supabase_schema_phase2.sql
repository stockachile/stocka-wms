-- WMS STOCKA - Supabase Schema Phase 2 (Pedidos y Lógica de Stock)

-- 1. Modificar Inventario existente para soportar stock comprometido
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS committed_quantity INTEGER DEFAULT 0 CHECK (committed_quantity >= 0);

-- 2. Crear Tabla de Pedidos (Orders)
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT CHECK (status IN ('para procesar', 'en preparación', 'preparado', 'despachado', 'en espera', 'sin stock', 'incidencia', 'cancelado')) DEFAULT 'para procesar',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clientes ven sus pedidos" ON orders
  FOR SELECT USING (auth.uid() = merchant_id);

-- 3. Crear Tabla de Ítems del Pedido (Order Items)
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clientes ven items de sus pedidos" ON order_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM orders WHERE orders.id = order_items.order_id AND orders.merchant_id = auth.uid())
  );

-- ==========================================
-- LÓGICA AUTOMÁTICA (TRIGGERS)
-- ==========================================

-- A) Al insertar un ítem a un pedido, se reserva (compromete) el stock
CREATE OR REPLACE FUNCTION public.handle_new_order_item()
RETURNS trigger AS $$
BEGIN
  UPDATE inventory
  SET committed_quantity = committed_quantity + NEW.quantity
  WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_order_item_inserted ON order_items;
CREATE TRIGGER on_order_item_inserted
  AFTER INSERT ON order_items
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_order_item();


-- B) Al actualizar el estado del pedido a Despachado o Cancelado
CREATE OR REPLACE FUNCTION public.handle_order_status_change()
RETURNS trigger AS $$
DECLARE
  item RECORD;
BEGIN
  -- Si pasa a "despachado": descontar stock físico y comprometido, y generar movimiento "out"
  IF NEW.status = 'despachado' AND OLD.status != 'despachado' THEN
    FOR item IN SELECT * FROM order_items WHERE order_id = NEW.id LOOP
      -- Actualizar Inventario
      UPDATE inventory 
      SET quantity = quantity - item.quantity,
          committed_quantity = committed_quantity - item.quantity
      WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
      
      -- Generar Log de Movimiento
      INSERT INTO movements (product_id, warehouse_id, type, quantity, reference_doc)
      VALUES (item.product_id, item.warehouse_id, 'out', item.quantity, 'Pedido ' || NEW.id);
    END LOOP;
  END IF;

  -- Si pasa a "cancelado": liberar el stock comprometido
  IF NEW.status = 'cancelado' AND OLD.status != 'cancelado' AND OLD.status != 'despachado' THEN
    FOR item IN SELECT * FROM order_items WHERE order_id = NEW.id LOOP
      UPDATE inventory 
      SET committed_quantity = committed_quantity - item.quantity
      WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_order_status_update ON orders;
CREATE TRIGGER on_order_status_update
  AFTER UPDATE OF status ON orders
  FOR EACH ROW EXECUTE PROCEDURE public.handle_order_status_change();


-- ==========================================
-- DATOS DE PRUEBA: CREAR UN PEDIDO MOCK
-- (Reemplaza TU_USER_ID por tu UUID real: f8b7f19a-549a-4879-89cf-58163493bc16)
-- ==========================================
/*
DO $$
DECLARE
  v_order_id UUID;
  v_product_id UUID;
  v_warehouse_id UUID;
BEGIN
  -- 1. Insertar un Pedido 'para procesar'
  INSERT INTO orders (merchant_id, status) 
  VALUES ('f8b7f19a-549a-4879-89cf-58163493bc16', 'para procesar')
  RETURNING id INTO v_order_id;

  -- 2. Obtener un producto y bodega (del inventario existente)
  SELECT product_id, warehouse_id INTO v_product_id, v_warehouse_id 
  FROM inventory LIMIT 1;

  -- 3. Insertar el ítem (Esto disparará el trigger que compromete el stock)
  IF v_product_id IS NOT NULL THEN
    INSERT INTO order_items (order_id, product_id, warehouse_id, quantity)
    VALUES (v_order_id, v_product_id, v_warehouse_id, 2);
  END IF;
END $$;
*/
