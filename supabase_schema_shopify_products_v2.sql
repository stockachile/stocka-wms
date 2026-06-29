-- WMS STOCKA - Supabase Schema Actualización: Integración Shopify (Productos v2)

-- Añadir nuevas columnas requeridas y opcionales a la tabla PRODUCTS
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS image_url TEXT,              -- URL de la imagen del producto
ADD COLUMN IF NOT EXISTS shopify_stock INTEGER,        -- Nivel de stock en Shopify
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active', -- Estado ('active', 'draft', 'archived')
ADD COLUMN IF NOT EXISTS expiration_date DATE,         -- Fecha de vencimiento (editable manual en WMS)
ADD COLUMN IF NOT EXISTS lot_number TEXT;              -- Número de lote (editable manual en WMS)
