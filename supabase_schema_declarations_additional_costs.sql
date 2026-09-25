-- WMS STOCKA - Agregar Columna para Costos Adicionales de Recepción en Declaraciones de Ingreso
-- Ejecutar en el SQL Editor de Supabase

ALTER TABLE public.stock_declarations 
ADD COLUMN IF NOT EXISTS additional_costs JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.stock_declarations.additional_costs IS 'Listado de costos adicionales/servicios extras aplicados por administración durante la recepción (ej. despacho pagado en bodega destino, paletizado, etc.)';
