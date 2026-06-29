-- WMS STOCKA - Supabase Schema: Columnas de Producto para MercadoLibre
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase para habilitar la sincronización de catálogo de MercadoLibre.

ALTER TABLE products 
  ADD COLUMN IF NOT EXISTS meli_item_id TEXT,
  ADD COLUMN IF NOT EXISTS meli_variation_id TEXT;
