-- WMS STOCKA - Configuración Adicional de Comercios
-- Ejecutar en el SQL Editor de Supabase

-- 1. Crear la Tabla de Configuración Adicional de Comercios
CREATE TABLE IF NOT EXISTS public.comercios_adicional_config (
    comercio TEXT PRIMARY KEY,                       -- Nombre del comercio (de v_comercios_config)
    comercio_id UUID,                                -- ID del comercio (de v_comercios_config)
    inventario_seguimiento BOOLEAN NOT NULL DEFAULT false, -- Si se hace seguimiento al inventario o no
    pedido_trae_sigla BOOLEAN NOT NULL DEFAULT false,       -- Si el pedido trae de origen una sigla o no
    rut TEXT,                                        -- RUT de la empresa asociada
    razon_social TEXT,                               -- Razón Social de la empresa asociada
    plat_siglas_config JSONB DEFAULT '{}'::jsonb,    -- Configuración de siglas y prefijos por plataforma
    email_colaborador TEXT,                          -- Correo para cuentas de colaborador en marketplaces
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Si la tabla ya existe en tu base de datos, ejecuta estas líneas en el Editor de SQL:
ALTER TABLE public.comercios_adicional_config ADD COLUMN IF NOT EXISTS rut TEXT;
ALTER TABLE public.comercios_adicional_config ADD COLUMN IF NOT EXISTS razon_social TEXT;
ALTER TABLE public.comercios_adicional_config ADD COLUMN IF NOT EXISTS plat_siglas_config JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.comercios_adicional_config ADD COLUMN IF NOT EXISTS email_colaborador TEXT;

-- 2. Habilitar RLS (Row Level Security)
ALTER TABLE public.comercios_adicional_config ENABLE ROW LEVEL SECURITY;

-- 3. Crear Políticas de Acceso
DROP POLICY IF EXISTS "Todos los usuarios autenticados leen la config de comercios" ON public.comercios_adicional_config;
CREATE POLICY "Todos los usuarios autenticados leen la config de comercios" ON public.comercios_adicional_config
    FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins gestionan la config de comercios" ON public.comercios_adicional_config;
CREATE POLICY "Admins gestionan la config de comercios" ON public.comercios_adicional_config
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
    );

-- 4. Otorgar Permisos de Acceso a Roles de Supabase
GRANT ALL ON public.comercios_adicional_config TO postgres, service_role;
GRANT ALL ON public.comercios_adicional_config TO anon, authenticated;
