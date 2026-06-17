-- WMS STOCKA - Supabase Schema: Integración París (Mirakl)
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase para habilitar París.

-- 1. Modificar la restricción CHECK en la columna 'platform' de merchant_integrations
ALTER TABLE merchant_integrations DROP CONSTRAINT IF EXISTS merchant_integrations_platform_check;
ALTER TABLE merchant_integrations ADD CONSTRAINT merchant_integrations_platform_check 
  CHECK (platform IN ('Shopify', 'WooCommerce', 'Jumpseller', 'Tiendanube', 'Optiroute', 'Paris'));

-- 2. Agregar columna para almacenar la data cruda de la API de París (Mirakl)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS raw_paris_data JSONB;
ALTER TABLE products ADD COLUMN IF NOT EXISTS raw_paris_data JSONB;
