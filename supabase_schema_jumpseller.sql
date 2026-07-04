-- WMS STOCKA - Supabase Schema: Integración Jumpseller
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase para habilitar Jumpseller.

-- 1. Agregar columnas para almacenar la data cruda y mapeo de IDs de Jumpseller en órdenes
ALTER TABLE orders ADD COLUMN IF NOT EXISTS raw_jumpseller_data JSONB;

-- 2. Agregar columnas para almacenar la data cruda y mapeo de IDs de Jumpseller en productos
ALTER TABLE products 
  ADD COLUMN IF NOT EXISTS jumpseller_product_id TEXT,
  ADD COLUMN IF NOT EXISTS jumpseller_variant_id TEXT,
  ADD COLUMN IF NOT EXISTS raw_jumpseller_data JSONB;

-- 3. Asegurar que Jumpseller esté permitido en el check constraint de platform
-- Eliminamos el check anterior para evitar colisiones
ALTER TABLE merchant_integrations 
  DROP CONSTRAINT IF EXISTS merchant_integrations_platform_check;

-- Creamos el nuevo check constraint incluyendo todas las plataformas soportadas
ALTER TABLE merchant_integrations 
  ADD CONSTRAINT merchant_integrations_platform_check 
  CHECK (platform IN ('Shopify', 'WooCommerce', 'Jumpseller', 'Tiendanube', 'Optiroute', 'Paris', 'Falabella', 'MercadoLibre'));
