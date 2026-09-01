-- WMS STOCKA - Columnas de Estado de Facturación en Ingresos de Stock
-- Ejecutar en el SQL Editor de Supabase

ALTER TABLE public.stock_declarations ADD COLUMN IF NOT EXISTS billing_status TEXT DEFAULT 'Pendiente';
ALTER TABLE public.stock_declarations ADD COLUMN IF NOT EXISTS billed_at TIMESTAMPTZ;
ALTER TABLE public.stock_declarations ADD COLUMN IF NOT EXISTS billing_notes TEXT;

-- Asegurar que los registros existentes tengan valor por defecto 'Pendiente' si son nulos
UPDATE public.stock_declarations 
SET billing_status = 'Pendiente' 
WHERE billing_status IS NULL;
