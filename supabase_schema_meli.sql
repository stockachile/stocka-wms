-- WMS STOCKA - Supabase Schema: Integración MercadoLibre
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase para habilitar MercadoLibre.

-- 1. Modificar la restricción CHECK en la columna 'platform' de merchant_integrations
ALTER TABLE merchant_integrations DROP CONSTRAINT IF EXISTS merchant_integrations_platform_check;
ALTER TABLE merchant_integrations ADD CONSTRAINT merchant_integrations_platform_check 
  CHECK (platform IN ('Shopify', 'WooCommerce', 'Jumpseller', 'Tiendanube', 'Optiroute', 'Paris', 'Falabella', 'MercadoLibre'));

-- 2. Asegurar columnas de credenciales de MercadoLibre en merchant_integrations
ALTER TABLE merchant_integrations ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE merchant_integrations ADD COLUMN IF NOT EXISTS client_secret TEXT;
ALTER TABLE merchant_integrations ADD COLUMN IF NOT EXISTS refresh_token TEXT;

-- 3. Agregar columna para almacenar la data cruda de la API de MercadoLibre
ALTER TABLE orders ADD COLUMN IF NOT EXISTS raw_meli_data JSONB;
ALTER TABLE products ADD COLUMN IF NOT EXISTS raw_meli_data JSONB;
