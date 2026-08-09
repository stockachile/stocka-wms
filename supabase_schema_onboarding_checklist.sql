-- WMS STOCKA - Agregar columna para progreso del checklist de onboarding
-- Ejecutar este archivo en el Editor SQL de Supabase (SQL Editor)

ALTER TABLE public.comercios_adicional_config 
ADD COLUMN IF NOT EXISTS onboarding_checklist JSONB DEFAULT '{"integrations": false, "catalog_ready": false, "shipping_configured": false, "stock_declared": false, "sku_guide": false, "dismissed": false}'::jsonb;
