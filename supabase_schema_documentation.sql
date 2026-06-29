-- WMS STOCKA - Esquema para Módulo de Documentación de Servicio

-- 1. Crear la tabla para registrar la documentación
CREATE TABLE IF NOT EXISTS public.service_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  file_url TEXT NOT NULL,
  storage_path TEXT,
  folder TEXT NOT NULL DEFAULT 'General',
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- Habilitar RLS
ALTER TABLE public.service_docs ENABLE ROW LEVEL SECURITY;

-- 2. Asegurar permisos de acceso a nivel de Base de Datos para roles
GRANT ALL ON public.service_docs TO postgres, service_role;
GRANT ALL ON public.service_docs TO anon, authenticated;

-- Políticas RLS sobre la tabla service_docs
DROP POLICY IF EXISTS "Cualquier usuario autenticado puede ver documentos" ON public.service_docs;
CREATE POLICY "Cualquier usuario autenticado puede ver documentos" ON public.service_docs
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Solo administradores pueden insertar documentos" ON public.service_docs;
CREATE POLICY "Solo administradores pueden insertar documentos" ON public.service_docs
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Solo administradores pueden actualizar documentos" ON public.service_docs;
CREATE POLICY "Solo administradores pueden actualizar documentos" ON public.service_docs
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Solo administradores pueden eliminar documentos" ON public.service_docs;
CREATE POLICY "Solo administradores pueden eliminar documentos" ON public.service_docs
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- 3. Crear el bucket en Supabase Storage y configurar políticas
INSERT INTO storage.buckets (id, name, public)
VALUES ('service_docs', 'service_docs', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Políticas de Storage sobre service_docs en storage.objects
DROP POLICY IF EXISTS "Permitir ver documentos de servicio a cualquiera" ON storage.objects;
CREATE POLICY "Permitir ver documentos de servicio a cualquiera" ON storage.objects
    FOR SELECT TO public
    USING (bucket_id = 'service_docs');

DROP POLICY IF EXISTS "Permitir subir documentos de servicio a admins" ON storage.objects;
CREATE POLICY "Permitir subir documentos de servicio a admins" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'service_docs' AND
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
    );

DROP POLICY IF EXISTS "Admins gestionan todos los documentos de servicio" ON storage.objects;
CREATE POLICY "Admins gestionan todos los documentos de servicio" ON storage.objects
    FOR ALL TO authenticated
    USING (
        bucket_id = 'service_docs' AND
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
    );
