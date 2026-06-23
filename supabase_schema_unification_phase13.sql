-- WMS STOCKA - Supabase Schema Phase 13: Crear tabla de reglas de visibilidad y configurar políticas RLS
-- Ejecuta este script completo en el SQL Editor de Supabase.

-- 1. Crear la tabla reglas_visibilidad si no existe
CREATE TABLE IF NOT EXISTS public.reglas_visibilidad (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope TEXT NOT NULL CHECK (scope IN ('global', 'user')),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    user_email TEXT,
    courier TEXT, -- NULL significa 'Cualquier Courier'
    status TEXT, -- NULL significa 'Cualquier Estado'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Habilitar la Seguridad a Nivel de Fila (RLS)
ALTER TABLE public.reglas_visibilidad ENABLE ROW LEVEL SECURITY;

-- 3. Eliminar políticas existentes si las hay para evitar duplicados
DROP POLICY IF EXISTS "Admins have full access on rules" ON public.reglas_visibilidad;
DROP POLICY IF EXISTS "Users can read global and their own rules" ON public.reglas_visibilidad;

-- 4. Crear políticas RLS
-- Administradores: Acceso completo (lectura, inserción, actualización, eliminación)
CREATE POLICY "Admins have full access on rules" 
ON public.reglas_visibilidad 
FOR ALL 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
  )
);

-- Clientes / Observadores: Solo lectura para reglas globales o específicas de su propio usuario
CREATE POLICY "Users can read global and their own rules" 
ON public.reglas_visibilidad 
FOR SELECT 
TO authenticated 
USING (
  scope = 'global' OR user_id = auth.uid()
);

-- 5. Otorgar permisos sobre la tabla
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reglas_visibilidad TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reglas_visibilidad TO service_role;
GRANT SELECT ON public.reglas_visibilidad TO anon;
