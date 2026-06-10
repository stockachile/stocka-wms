-- Añadir columna JSONB para guardar la data cruda de Shopify y discriminar luego
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS raw_shopify_data JSONB;

ALTER TABLE products
ADD COLUMN IF NOT EXISTS raw_shopify_data JSONB;
