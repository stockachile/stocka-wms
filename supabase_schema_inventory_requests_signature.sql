-- WMS STOCKA - Esquema para Firma Electrónica Digital de Actas de Inventario Físico
-- Ejecutar en el SQL Editor de Supabase (https://supabase.com/dashboard)

-- 1. Columnas de Firma Digital del Cliente / Comercio
ALTER TABLE public.inventory_requests ADD COLUMN IF NOT EXISTS signed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.inventory_requests ADD COLUMN IF NOT EXISTS signed_by TEXT;
ALTER TABLE public.inventory_requests ADD COLUMN IF NOT EXISTS signed_rut TEXT;
ALTER TABLE public.inventory_requests ADD COLUMN IF NOT EXISTS signed_role TEXT;
ALTER TABLE public.inventory_requests ADD COLUMN IF NOT EXISTS signed_signature_data TEXT;

-- 2. Columnas de Firma Digital del Supervisor / Auditor STOCKA
ALTER TABLE public.inventory_requests ADD COLUMN IF NOT EXISTS admin_signed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.inventory_requests ADD COLUMN IF NOT EXISTS admin_signed_by TEXT;
ALTER TABLE public.inventory_requests ADD COLUMN IF NOT EXISTS admin_signature_data TEXT;

-- 3. Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_inventory_requests_signed_at ON public.inventory_requests(signed_at);
CREATE INDEX IF NOT EXISTS idx_inventory_requests_admin_signed_at ON public.inventory_requests(admin_signed_at);

-- 4. Notificar recarga de schema cache a PostgREST
NOTIFY pgrst, 'reload schema';
