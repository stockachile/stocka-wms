-- =========================================================================
-- MIGRACIÓN: AGREGAR INFORMACIÓN DE KAM / EJECUTIVO DE CUENTAS A COMERCIOS
-- Ejecutar en el SQL Editor de Supabase
-- =========================================================================

-- 1. Agregar columnas a public.comercios_adicional_config para almacenar el KAM asignado
ALTER TABLE public.comercios_adicional_config ADD COLUMN IF NOT EXISTS kam_nombre TEXT;
ALTER TABLE public.comercios_adicional_config ADD COLUMN IF NOT EXISTS kam_email TEXT;
ALTER TABLE public.comercios_adicional_config ADD COLUMN IF NOT EXISTS kam_telefono TEXT;
ALTER TABLE public.comercios_adicional_config ADD COLUMN IF NOT EXISTS kam_notas TEXT;

-- 2. Asegurar permisos de acceso
GRANT ALL ON public.comercios_adicional_config TO postgres, service_role;
GRANT ALL ON public.comercios_adicional_config TO anon, authenticated;
