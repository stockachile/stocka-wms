-- WMS STOCKA - SQL Migration to fix RLS for contractual_document_versions
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Asegurar que la función helper is_admin() existe
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- 2. Asegurar que RLS está habilitado en la tabla de versiones
ALTER TABLE public.contractual_document_versions ENABLE ROW LEVEL SECURITY;

-- 3. Eliminar políticas conflictivas previas
DROP POLICY IF EXISTS "Admins gestionan versiones de documentos" ON public.contractual_document_versions;
DROP POLICY IF EXISTS "Autenticados ven versiones de documentos" ON public.contractual_document_versions;
DROP POLICY IF EXISTS "Solo administradores pueden insertar versiones" ON public.contractual_document_versions;
DROP POLICY IF EXISTS "Solo administradores pueden actualizar versiones" ON public.contractual_document_versions;
DROP POLICY IF EXISTS "Usuarios autenticados pueden ver versiones de documentos" ON public.contractual_document_versions;
DROP POLICY IF EXISTS "Admins pueden insertar versiones de documentos" ON public.contractual_document_versions;

-- 4. Crear política para que cualquier usuario autenticado (Clientes y Admins) pueda ver el historial (SELECT)
CREATE POLICY "Usuarios autenticados pueden ver versiones de documentos" 
  ON public.contractual_document_versions
  FOR SELECT 
  TO authenticated 
  USING (true);

-- 5. Crear política para que los administradores puedan registrar versiones (INSERT)
CREATE POLICY "Admins pueden insertar versiones de documentos" 
  ON public.contractual_document_versions
  FOR INSERT 
  TO authenticated 
  WITH CHECK (public.is_admin());

-- 6. Asegurar los permisos correspondientes de acceso a la tabla a nivel de base de datos
GRANT ALL ON public.contractual_document_versions TO postgres, service_role;
GRANT SELECT, INSERT ON public.contractual_document_versions TO authenticated;
