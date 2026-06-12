-- WMS STOCKA - Supabase Schema: Creación de tabla dedicada para Optiroute (Actualizada)
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- Eliminar la tabla anterior si existe para recrear el esquema limpio
DROP TABLE IF EXISTS optiroute_orders;

CREATE TABLE optiroute_orders (
  id TEXT PRIMARY KEY,                           -- ID único de la orden en Optiroute
  empresa_comercio_proveedor TEXT,               -- Nombre de la empresa, comercio o proveedor (company_name)
  tracking TEXT,                                 -- Código de seguimiento
  tracking_url TEXT,                             -- URL del portal de seguimiento
  courier TEXT,                                  -- Nombre del Courier (ej: "STOCKA X")
  status TEXT,                                   -- Nombre legible del estado de entrega
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()),
  servicio_tipo_envio TEXT,                      -- Tipo de servicio de envío (ej: "SAME DAY/24 HRS")
  nombre_destinatario TEXT,                       -- Nombre del receptor / cliente final
  telefono_destino TEXT,                         -- Teléfono del destinatario
  email_cliente_destino TEXT,                    -- Email del cliente destinatario
  direccion_destino TEXT,                        -- Dirección física de entrega
  complemento_destino TEXT,                      -- Complemento (departamento, villa, block, etc.)
  comuna_destino TEXT,                           -- Comuna de destino
  raw_data JSONB                                 -- Payload JSON completo para auditoría/futuros datos
);

-- Índices para optimizar búsquedas por tracking, destinatario o proveedor
CREATE INDEX IF NOT EXISTS idx_optiroute_orders_tracking ON optiroute_orders(tracking);
CREATE INDEX IF NOT EXISTS idx_optiroute_orders_empresa ON optiroute_orders(empresa_comercio_proveedor);
CREATE INDEX IF NOT EXISTS idx_optiroute_orders_comuna ON optiroute_orders(comuna_destino);

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
      WHERE (orders.external_order_number = optiroute_orders.id OR orders.id::text = optiroute_orders.id)
        AND orders.merchant_id = auth.uid()
    )
  );
