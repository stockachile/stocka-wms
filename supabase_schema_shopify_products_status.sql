-- 1. Agregar columna status a la tabla synced_products
ALTER TABLE public.synced_products ADD COLUMN IF NOT EXISTS status TEXT;

-- 2. Comentario explicativo
COMMENT ON COLUMN public.synced_products.status IS 'Estado del producto en el canal externo de ventas (ej: active, draft, archived)';
