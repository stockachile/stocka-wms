-- WMS STOCKA - Esquema de Contactos de Facturación
-- Ejecutar en el SQL Editor de Supabase

-- Crear la Tabla de Contactos de Facturación
CREATE TABLE IF NOT EXISTS public.billing_contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    comercio TEXT NOT NULL,          -- Nombre del comercio (ej: 'BIG BANG')
    nombre TEXT NOT NULL,            -- Nombre del contacto (ej: 'Juan Pérez')
    email TEXT NOT NULL,             -- Correo electrónico del contacto (ej: 'finanzas@comercio.cl')
    rol TEXT DEFAULT 'finanzas',     -- Rol ('finanzas', 'contacto', etc.)
    activo BOOLEAN DEFAULT true,     -- Para activar/desactivar el contacto
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Habilitar RLS
ALTER TABLE public.billing_contacts ENABLE ROW LEVEL SECURITY;

-- Crear Políticas de RLS
DROP POLICY IF EXISTS "Admins gestionan contactos de facturacion" ON public.billing_contacts;
CREATE POLICY "Admins gestionan contactos de facturacion" ON public.billing_contacts 
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
    );

DROP POLICY IF EXISTS "Clientes ven sus propios contactos de facturacion" ON public.billing_contacts;
CREATE POLICY "Clientes ven sus propios contactos de facturacion" ON public.billing_contacts 
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND (
                p.role = 'admin'
                OR p.comercio = 'all'
                OR public.billing_contacts.comercio = ANY (
                     ARRAY(SELECT trim(name) FROM unnest(string_to_array(p.comercio, ',')) AS name)
                )
                OR EXISTS (
                     SELECT 1 FROM public.billing_mappings bg
                     WHERE bg.billing_name = public.billing_contacts.comercio
                       AND bg.comercio_nombre = ANY (
                            ARRAY(SELECT trim(name) FROM unnest(string_to_array(p.comercio, ',')) AS name)
                       )
                )
              )
        )
    );

-- Otorgar permisos
GRANT ALL ON public.billing_contacts TO postgres, service_role;
GRANT ALL ON public.billing_contacts TO anon, authenticated;
