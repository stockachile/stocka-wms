-- WMS STOCKA - Supabase Schema Actualización: Integración Shopify (Fase 1)

-- 1. Modificar tabla PRODUCTS
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS barcode TEXT,
ADD COLUMN IF NOT EXISTS price NUMERIC(10, 2),
ADD COLUMN IF NOT EXISTS weight NUMERIC(10, 2),
ADD COLUMN IF NOT EXISTS height NUMERIC(10, 2), -- Altura (editable en WMS)
ADD COLUMN IF NOT EXISTS length NUMERIC(10, 2), -- Largo (editable en WMS)
ADD COLUMN IF NOT EXISTS width NUMERIC(10, 2),  -- Ancho (editable en WMS)
ADD COLUMN IF NOT EXISTS options JSONB,         -- Para guardar { "Color": "Rojo", "Talla": "M" }
ADD COLUMN IF NOT EXISTS shopify_product_id TEXT, -- ID Externo de Shopify
ADD COLUMN IF NOT EXISTS shopify_variant_id TEXT;

-- 2. Modificar tabla ORDERS
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS external_order_number TEXT, -- Ej: #1001
ADD COLUMN IF NOT EXISTS external_platform TEXT DEFAULT 'Manual', -- Ej: 'Shopify'
ADD COLUMN IF NOT EXISTS payment_status TEXT, -- Ej: 'PAID', 'PENDING'
ADD COLUMN IF NOT EXISTS total_value NUMERIC(10, 2),
ADD COLUMN IF NOT EXISTS shipping_method TEXT,
-- Datos del Cliente
ADD COLUMN IF NOT EXISTS customer_email TEXT,
ADD COLUMN IF NOT EXISTS customer_phone TEXT,
ADD COLUMN IF NOT EXISTS customer_name TEXT,
ADD COLUMN IF NOT EXISTS shipping_address TEXT,
ADD COLUMN IF NOT EXISTS shipping_city TEXT,
ADD COLUMN IF NOT EXISTS shipping_complement TEXT;

-- 3. Crear Tabla de CREDENCIALES DE INTEGRACIÓN (App Shopify)
CREATE TABLE IF NOT EXISTS merchant_integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('Shopify', 'WooCommerce', 'Jumpseller', 'Tiendanube')),
  shop_url TEXT NOT NULL,          -- Ej: mitienda.myshopify.com
  access_token TEXT NOT NULL,      -- El token de acceso a la API (Debería encriptarse idealmente)
  webhook_secret TEXT,             -- Para validar el HMAC del webhook
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(merchant_id, platform)
);

ALTER TABLE merchant_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clientes gestionan sus credenciales" ON merchant_integrations
  FOR ALL USING (auth.uid() = merchant_id);


-- 4. Crear Tabla de ALERTAS DE PEDIDOS
CREATE TABLE IF NOT EXISTS order_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,       -- Ej: 'CANCELADO', 'DIRECCION_MODIFICADA'
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,  -- Para marcar como leída en la UI
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE order_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clientes ven sus alertas" ON order_alerts
  FOR SELECT USING (auth.uid() = merchant_id);
CREATE POLICY "Clientes pueden marcar alertas leidas" ON order_alerts
  FOR UPDATE USING (auth.uid() = merchant_id);
