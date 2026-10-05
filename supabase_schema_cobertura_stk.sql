-- WMS STOCKA - Supabase Migration: Cobertura STK en wms_config_options
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase si deseas permitir el tipo 'cobertura_stk_comuna' como registros individuales.
-- La aplicación funcionará automáticamente tanto si se ejecuta este script como si no (cuenta con fallback compatible sin errores).

ALTER TABLE public.wms_config_options DROP CONSTRAINT IF EXISTS wms_config_options_type_check;
ALTER TABLE public.wms_config_options ADD CONSTRAINT wms_config_options_type_check 
CHECK (type IN ('agenda', 'operador', 'keyword_retiro', 'cobertura_stk_comuna'));
