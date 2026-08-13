-- WMS STOCKA - Supabase Schema: Integración Ripley (Mirakl)
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase para habilitar Ripley.

-- 1. Modificar la restricción CHECK en la columna 'platform' de merchant_integrations
ALTER TABLE merchant_integrations DROP CONSTRAINT IF EXISTS merchant_integrations_platform_check;
ALTER TABLE merchant_integrations ADD CONSTRAINT merchant_integrations_platform_check 
  CHECK (platform IN ('Shopify', 'WooCommerce', 'Jumpseller', 'Tiendanube', 'Optiroute', 'Paris', 'Falabella', 'MercadoLibre', 'Walmart', 'Ripley'));

-- 2. Agregar columna para almacenar la data cruda de la API de Ripley (Mirakl)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS raw_ripley_data JSONB;
ALTER TABLE products ADD COLUMN IF NOT EXISTS raw_ripley_data JSONB;
