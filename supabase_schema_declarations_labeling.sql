-- WMS STOCKA - Agregar Columnas para Control de Etiquetado en Declaraciones de Ingreso
-- Ejecutar en el SQL Editor de Supabase

ALTER TABLE public.stock_declarations 
ADD COLUMN IF NOT EXISTS labeling_type TEXT NOT NULL DEFAULT 'completely' 
CHECK (labeling_type IN ('completely', 'partially', 'none'));

ALTER TABLE public.stock_declarations 
ADD COLUMN IF NOT EXISTS labeling_qty_requested INTEGER DEFAULT 0 CHECK (labeling_qty_requested >= 0);

ALTER TABLE public.stock_declarations 
ADD COLUMN IF NOT EXISTS labeling_qty_confirmed INTEGER DEFAULT 0 CHECK (labeling_qty_confirmed >= 0);
