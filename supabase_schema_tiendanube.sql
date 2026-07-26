-- WMS STOCKA - Supabase Schema: Integración Tiendanube
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase para habilitar Tiendanube.

-- 1. Agregar columnas para almacenar la data cruda y mapeo de IDs de Tiendanube en productos
ALTER TABLE products 
  ADD COLUMN IF NOT EXISTS tiendanube_product_id TEXT,
  ADD COLUMN IF NOT EXISTS tiendanube_variant_id TEXT,
  ADD COLUMN IF NOT EXISTS raw_tiendanube_data JSONB;

-- 2. Agregar columnas para almacenar la data cruda de Tiendanube en órdenes
ALTER TABLE orders 
  ADD COLUMN IF NOT EXISTS raw_tiendanube_data JSONB;

-- 3. Asegurar que Tiendanube esté permitido en el check constraint de platform de merchant_integrations
ALTER TABLE merchant_integrations 
  DROP CONSTRAINT IF EXISTS merchant_integrations_platform_check;

ALTER TABLE merchant_integrations 
  ADD CONSTRAINT merchant_integrations_platform_check 
  CHECK (platform IN ('Shopify', 'WooCommerce', 'Jumpseller', 'Tiendanube', 'Optiroute', 'Paris', 'Falabella', 'MercadoLibre', 'Walmart'));
