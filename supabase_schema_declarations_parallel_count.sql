-- WMS STOCKA - Columnas para Ingreso con Conteo en Paralelo en Declaraciones de Ingreso
-- Ejecutar en el SQL Editor de Supabase

ALTER TABLE public.stock_declarations 
ADD COLUMN IF NOT EXISTS parallel_count BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.stock_declarations 
ADD COLUMN IF NOT EXISTS parallel_count_data JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.stock_declarations.parallel_count IS 'Indica si la recepción ingresó stock provisionalmente a inventario mientras el conteo físico se realiza en paralelo';
COMMENT ON COLUMN public.stock_declarations.parallel_count_data IS 'Metadatos del conteo en paralelo: fecha de inicio, unidades provisionales ingresadas, usuario responsable y fecha de confirmación';
