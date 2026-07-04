-- Añadir columna para marcar si un pedido fue exportado en formato Shopify
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS shopify_exported BOOLEAN DEFAULT false;
