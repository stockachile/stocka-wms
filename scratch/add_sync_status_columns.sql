-- Migración: Agregar columnas de monitoreo de sincronización a merchant_integrations
ALTER TABLE public.merchant_integrations ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.merchant_integrations ADD COLUMN IF NOT EXISTS last_sync_error TEXT;

-- Forzar recarga del esquema en PostgREST
NOTIFY pgrst, 'reload';
