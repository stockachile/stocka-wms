-- WMS STOCKA - Supabase Schema: Creación de tabla dedicada para Optiroute
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

CREATE TABLE IF NOT EXISTS optiroute_orders (
  id TEXT PRIMARY KEY,                           -- ID único de la orden en Optiroute
  reference TEXT,                                -- Referencia provista por el usuario (ID del pedido)
  optiroute_created_at TIMESTAMP WITH TIME ZONE,  -- Fecha de creación en Optiroute
  delivery_date TIMESTAMP WITH TIME ZONE,        -- Fecha de entrega en Optiroute
  status INTEGER,                                -- Código de estado entero en Optiroute
  status_name TEXT,                              -- Nombre legible del estado
  assigned_driver TEXT,                          -- Nombre del conductor asignado
  delivery_details TEXT,                         -- Comentarios del conductor
  tracking TEXT,                                 -- Código de seguimiento
  tracking_url TEXT,                             -- URL de seguimiento
  raw_data JSONB,                                -- Payload JSON completo de la API
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- Índices para optimizar búsquedas por referencia o seguimiento
CREATE INDEX IF NOT EXISTS idx_optiroute_orders_reference ON optiroute_orders(reference);
CREATE INDEX IF NOT EXISTS idx_optiroute_orders_status ON optiroute_orders(status);
CREATE INDEX IF NOT EXISTS idx_optiroute_orders_tracking ON optiroute_orders(tracking);

-- Habilitar Seguridad a Nivel de Fila (RLS)
ALTER TABLE optiroute_orders ENABLE ROW LEVEL SECURITY;

-- Crear helper is_admin() por si no existe aún
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Políticas de Seguridad
DROP POLICY IF EXISTS "Admin gestiona todos los pedidos de Optiroute" ON optiroute_orders;
CREATE POLICY "Admin gestiona todos los pedidos de Optiroute" ON optiroute_orders
  FOR ALL USING (is_admin());

DROP POLICY IF EXISTS "Clientes ven sus propios pedidos de Optiroute por referencia" ON optiroute_orders;
CREATE POLICY "Clientes ven sus propios pedidos de Optiroute por referencia" ON optiroute_orders
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM orders 
      WHERE (orders.external_order_number = optiroute_orders.reference OR orders.id::text = optiroute_orders.reference)
        AND orders.merchant_id = auth.uid()
    )
  );
