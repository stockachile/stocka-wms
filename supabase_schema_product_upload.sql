-- WMS STOCKA - Supabase Schema Actualización: Carga de Planillas de Productos
-- Ejecuta este script en el editor SQL de Supabase para habilitar las nuevas columnas del producto.

ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS barcode TEXT,
ADD COLUMN IF NOT EXISTS type TEXT,
ADD COLUMN IF NOT EXISTS color TEXT,
ADD COLUMN IF NOT EXISTS variable_1 TEXT,
ADD COLUMN IF NOT EXISTS variable_2 TEXT,
ADD COLUMN IF NOT EXISTS talla TEXT,
ADD COLUMN IF NOT EXISTS largo NUMERIC(10, 4),
ADD COLUMN IF NOT EXISTS ancho NUMERIC(10, 4),
ADD COLUMN IF NOT EXISTS alto NUMERIC(10, 4),
ADD COLUMN IF NOT EXISTS volumen NUMERIC(12, 6);

-- Comentarios explicativos de las nuevas columnas
COMMENT ON COLUMN public.products.barcode IS 'Código de barras de la variante o producto';
COMMENT ON COLUMN public.products.type IS 'Tipo de producto (ej: Calzado, Ropa)';
COMMENT ON COLUMN public.products.color IS 'Color del producto';
COMMENT ON COLUMN public.products.variable_1 IS 'Atributo dinámico variable 1';
COMMENT ON COLUMN public.products.variable_2 IS 'Atributo dinámico variable 2';
COMMENT ON COLUMN public.products.talla IS 'Talla del producto';
COMMENT ON COLUMN public.products.largo IS 'Largo del producto';
COMMENT ON COLUMN public.products.ancho IS 'Ancho del producto';
COMMENT ON COLUMN public.products.alto IS 'Alto del producto';
COMMENT ON COLUMN public.products.volumen IS 'Volumen en m3 (calculado o manual)';
