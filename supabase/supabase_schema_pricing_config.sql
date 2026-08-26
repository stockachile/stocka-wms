-- Tabla para la configuración dinámica de tarifas del cotizador WMS Stocka
CREATE TABLE IF NOT EXISTS public.pricing_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_key VARCHAR(50) UNIQUE NOT NULL DEFAULT 'current_rates',
    data JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Habilitar RLS en pricing_config
ALTER TABLE public.pricing_config ENABLE ROW LEVEL SECURITY;

-- Política de lectura pública: cualquiera puede leer la configuración del tarifario
CREATE POLICY "Public Read Pricing Config"
ON public.pricing_config
FOR SELECT
TO public
USING (true);

-- Política de edición: solo administradores autenticados pueden insertar o modificar
CREATE POLICY "Admin Insert Pricing Config"
ON public.pricing_config
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND (profiles.role = 'admin' OR profiles.is_admin = true)
    )
);

CREATE POLICY "Admin Update Pricing Config"
ON public.pricing_config
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND (profiles.role = 'admin' OR profiles.is_admin = true)
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND (profiles.role = 'admin' OR profiles.is_admin = true)
    )
);

-- Tabla para almacenar leads y cotizaciones generadas por usuarios públicos
CREATE TABLE IF NOT EXISTS public.quote_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    company_name TEXT,
    contact_name TEXT,
    email TEXT,
    phone TEXT,
    monthly_orders INTEGER,
    estimated_volume NUMERIC(10, 2),
    quote_data JSONB,
    estimated_monthly_net NUMERIC(12, 0),
    status TEXT DEFAULT 'nuevo', -- 'nuevo', 'contactado', 'en_negociacion', 'cerrado'
    notes TEXT
);

-- Habilitar RLS en quote_leads
ALTER TABLE public.quote_leads ENABLE ROW LEVEL SECURITY;

-- Permitir inserción pública (anon) para registrar cotizaciones
CREATE POLICY "Public Insert Quote Leads"
ON public.quote_leads
FOR INSERT
TO public
WITH CHECK (true);

-- Permitir lectura y gestión solo a administradores
CREATE POLICY "Admin Select Quote Leads"
ON public.quote_leads
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND (profiles.role = 'admin' OR profiles.is_admin = true)
    )
);

CREATE POLICY "Admin Update Quote Leads"
ON public.quote_leads
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND (profiles.role = 'admin' OR profiles.is_admin = true)
    )
);
