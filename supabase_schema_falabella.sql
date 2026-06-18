-- WMS STOCKA - Supabase Schema: Integración Falabella (Mirakl)
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase para habilitar Falabella.

-- 1. Modificar la restricción CHECK en la columna 'platform' de merchant_integrations
ALTER TABLE merchant_integrations DROP CONSTRAINT IF EXISTS merchant_integrations_platform_check;
ALTER TABLE merchant_integrations ADD CONSTRAINT merchant_integrations_platform_check 
  CHECK (platform IN ('Shopify', 'WooCommerce', 'Jumpseller', 'Tiendanube', 'Optiroute', 'Paris', 'Falabella'));

-- 2. Asegurar columna username en merchant_integrations para almacenar el UserID / Email de Falabella
ALTER TABLE merchant_integrations ADD COLUMN IF NOT EXISTS username TEXT;

-- 3. Agregar columna para almacenar la data cruda de la API de Falabella (Mirakl)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS raw_falabella_data JSONB;
ALTER TABLE products ADD COLUMN IF NOT EXISTS raw_falabella_data JSONB;

-- 4. Agregar columna para almacenar la etiqueta de despacho en Base64
ALTER TABLE orders ADD COLUMN IF NOT EXISTS label_base64 TEXT;
