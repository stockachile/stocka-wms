-- WMS STOCKA - Configuración de Embalaje por Comercio
-- Ejecutar en el SQL Editor de Supabase

-- 1. Agregar columna de configuración de embalaje (JSONB)
ALTER TABLE public.comercios_adicional_config 
ADD COLUMN IF NOT EXISTS embalaje_config JSONB DEFAULT NULL;

-- 2. Habilitar RLS (Row Level Security)
ALTER TABLE public.comercios_adicional_config ENABLE ROW LEVEL SECURITY;

-- 3. Crear o Reemplazar Políticas de Acceso

-- Lectura para todos los usuarios autenticados
DROP POLICY IF EXISTS "Todos los usuarios autenticados leen la config de comercios" ON public.comercios_adicional_config;
CREATE POLICY "Todos los usuarios autenticados leen la config de comercios" ON public.comercios_adicional_config
    FOR SELECT USING (auth.role() = 'authenticated');

-- Admins gestionan toda la configuración
DROP POLICY IF EXISTS "Admins gestionan la config de comercios" ON public.comercios_adicional_config;
CREATE POLICY "Admins gestionan la config de comercios" ON public.comercios_adicional_config
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
    );

-- Clientes autorizados gestionan la configuración de sus propios comercios
DROP POLICY IF EXISTS "Clientes autorizados gestionan config de sus comercios" ON public.comercios_adicional_config;
CREATE POLICY "Clientes autorizados gestionan config de sus comercios" ON public.comercios_adicional_config
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
              AND (
                LOWER(comercios_adicional_config.comercio) = ANY (
                  SELECT TRIM(LOWER(token))
                  FROM unnest(string_to_array(profiles.comercio, ',')) AS token
                )
              )
        )
    );

-- Otorgar permisos
GRANT ALL ON public.comercios_adicional_config TO postgres, service_role;
GRANT ALL ON public.comercios_adicional_config TO anon, authenticated;
