-- WMS STOCKA - Supabase Schema Actualización: Tabla Dedicada Enviame
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- Crear la función helper is_admin() por si no existe aún en la base de datos
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- 1. Crear la tabla de envíos (despachos) de Enviame
CREATE TABLE IF NOT EXISTS enviame_shipments (
  id TEXT PRIMARY KEY, -- ID Maestro / ID de Envío de Enviame (enviame_delivery_id)
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  tracking_number TEXT,
  tracking_url TEXT,
  label_url TEXT,
  courier TEXT,
  status TEXT, -- Estado crudo reportado por Enviame
  raw_payload JSONB, -- Objeto completo recibido de Enviame
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Crear índices para optimizar búsquedas
CREATE INDEX IF NOT EXISTS idx_enviame_shipments_order_id ON enviame_shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_enviame_shipments_tracking_number ON enviame_shipments(tracking_number);

-- 2. Habilitar Seguridad a Nivel de Fila (RLS)
ALTER TABLE enviame_shipments ENABLE ROW LEVEL SECURITY;

-- 3. Crear Políticas de Seguridad
DROP POLICY IF EXISTS "Clientes ven sus propios envios" ON enviame_shipments;
CREATE POLICY "Clientes ven sus propios envios" ON enviame_shipments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM orders 
      WHERE orders.id = enviame_shipments.order_id 
        AND orders.merchant_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admin gestiona todos los envios" ON enviame_shipments;
CREATE POLICY "Admin gestiona todos los envios" ON enviame_shipments
  FOR ALL USING (is_admin());

-- En caso de que la tabla ya exista, nos aseguramos de añadir la columna raw_payload
ALTER TABLE enviame_shipments ADD COLUMN IF NOT EXISTS raw_payload JSONB;
