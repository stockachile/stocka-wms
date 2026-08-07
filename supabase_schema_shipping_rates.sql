-- WMS STOCKA - Tabla de Tarifas de Despacho Dinámicas
-- Ejecutar en el SQL Editor de Supabase

-- 1. Crear la Tabla de Tarifas
CREATE TABLE IF NOT EXISTS public.shipping_rates (
    id TEXT PRIMARY KEY,                             -- ID único (usaremos 'current')
    rates JSONB NOT NULL,                            -- Estructura completa de comunas y tarifas en formato JSON
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 2. Habilitar RLS (Row Level Security)
ALTER TABLE public.shipping_rates ENABLE ROW LEVEL SECURITY;

-- 3. Crear Políticas de Acceso
DROP POLICY IF EXISTS "Todos los usuarios autenticados leen tarifas" ON public.shipping_rates;
CREATE POLICY "Todos los usuarios autenticados leen tarifas" ON public.shipping_rates
    FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Solo administradores modifican tarifas" ON public.shipping_rates;
CREATE POLICY "Solo administradores modifican tarifas" ON public.shipping_rates
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
    );

-- 4. Otorgar Permisos a los Roles de Supabase
GRANT ALL ON public.shipping_rates TO postgres, service_role;
GRANT ALL ON public.shipping_rates TO anon, authenticated;
