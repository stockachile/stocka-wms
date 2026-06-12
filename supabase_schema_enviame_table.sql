-- WMS STOCKA - Supabase Schema Actualización: Tabla Dedicada Enviame
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- Crear la función helper is_admin() por si no existe aún en la base de datos
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- 1. Crear la tabla de envíos (despachos) de Enviame si no existe (con order_id TEXT)
CREATE TABLE IF NOT EXISTS enviame_shipments (
  id TEXT PRIMARY KEY, -- ID Maestro / ID de Envío de Enviame (enviame_delivery_id)
  order_id TEXT, -- Referencia de texto del pedido (ej: Sag_16101), sin clave foránea
  tracking_number TEXT,
  tracking_url TEXT,
  label_url TEXT,
  courier TEXT,
  status TEXT, -- Estado crudo reportado por Enviame
  raw_payload JSONB, -- Objeto completo recibido de Enviame
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 2. Modificaciones en caso de que la tabla ya existiera previamente con el esquema antiguo:

-- A. ELIMINAR POLÍTICAS EXISTENTES PRIMERO (Evita error de dependencia al alterar la columna)
DROP POLICY IF EXISTS "Clientes ven sus propios envios" ON enviame_shipments;
DROP POLICY IF EXISTS "Admin gestiona todos los envios" ON enviame_shipments;

-- B. Asegurar columna raw_payload
ALTER TABLE enviame_shipments ADD COLUMN IF NOT EXISTS raw_payload JSONB;

-- C. Eliminar clave foránea si existe (para quitar restricción con la tabla orders)
ALTER TABLE enviame_shipments DROP CONSTRAINT IF EXISTS enviame_shipments_order_id_fkey;

-- D. Cambiar tipo de columna order_id a TEXT (realizando el casting explícito a TEXT)
ALTER TABLE enviame_shipments ALTER COLUMN order_id TYPE TEXT USING order_id::text;

-- 3. Crear índices para optimizar búsquedas
CREATE INDEX IF NOT EXISTS idx_enviame_shipments_order_id ON enviame_shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_enviame_shipments_tracking_number ON enviame_shipments(tracking_number);

-- 4. Habilitar Seguridad a Nivel de Fila (RLS)
ALTER TABLE enviame_shipments ENABLE ROW LEVEL SECURITY;

-- 5. Crear Políticas de Seguridad (ahora que order_id es garantizadamente TEXT, evitando error text = uuid)
CREATE POLICY "Clientes ven sus propios envios" ON enviame_shipments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM orders 
      WHERE (orders.external_order_number = enviame_shipments.order_id OR orders.id::text = enviame_shipments.order_id)
        AND orders.merchant_id = auth.uid()
    )
  );

CREATE POLICY "Admin gestiona todos los envios" ON enviame_shipments
  FOR ALL USING (is_admin());
