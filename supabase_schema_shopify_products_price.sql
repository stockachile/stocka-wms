-- 1. Agregar columna price a la tabla synced_products
ALTER TABLE public.synced_products ADD COLUMN IF NOT EXISTS price NUMERIC(10, 2) DEFAULT 0.00;

-- 2. Comentario explicativo
COMMENT ON COLUMN public.synced_products.price IS 'Precio de venta de la variante en la plataforma externa';
