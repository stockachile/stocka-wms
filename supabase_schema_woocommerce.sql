-- WMS STOCKA - Supabase Schema: Integración WooCommerce
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase para habilitar WooCommerce.

-- 1. Agregar columnas para almacenar la data cruda y mapeo de IDs de WooCommerce
ALTER TABLE orders ADD COLUMN IF NOT EXISTS raw_woocommerce_data JSONB;
ALTER TABLE products 
  ADD COLUMN IF NOT EXISTS woocommerce_product_id TEXT,
  ADD COLUMN IF NOT EXISTS woocommerce_variation_id TEXT,
  ADD COLUMN IF NOT EXISTS raw_woocommerce_data JSONB;
