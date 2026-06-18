-- WMS STOCKA - Supabase Schema Actualización: Columnas Planas de Pedido
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS origen TEXT,
ADD COLUMN IF NOT EXISTS item TEXT,
ADD COLUMN IF NOT EXISTS cantidad INTEGER,
ADD COLUMN IF NOT EXISTS sku TEXT;
