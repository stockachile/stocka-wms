-- WMS STOCKA - Agregar Columnas para Observaciones de Envíame
-- Ejecutar este script en el SQL Editor de Supabase para separar las observaciones de Fulfillment y Envíame.

ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS client_observation_enviame TEXT;
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS admin_response_enviame TEXT;
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS observation_status_enviame TEXT CHECK (observation_status_enviame IN ('sin_observacion', 'pendiente', 'respondida')) DEFAULT 'sin_observacion';
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS observation_updated_at_enviame TIMESTAMPTZ;

-- Recargar el caché de PostgREST para exponer las nuevas columnas de inmediato en la API
NOTIFY pgrst, 'reload schema';
