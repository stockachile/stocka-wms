-- WMS STOCKA - SQL Migration to fix VULN-08 (profiles UPDATE RLS policies)
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Asegurar que la función helper is_admin() existe
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- 2. Eliminar políticas UPDATE previas si existen
DROP POLICY IF EXISTS "Admins pueden actualizar todos los perfiles" ON public.profiles;
DROP POLICY IF EXISTS "Usuarios pueden actualizar su propio perfil" ON public.profiles;

-- 3. Crear política para que administradores puedan actualizar cualquier perfil
CREATE POLICY "Admins pueden actualizar todos los perfiles" ON public.profiles
  FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());

-- 4. Crear política para que usuarios comunes puedan actualizar únicamente su propio perfil
CREATE POLICY "Usuarios pueden actualizar su propio perfil" ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- 5. Asegurar permisos correctos de actualización sobre la tabla para los roles autenticados
GRANT UPDATE ON public.profiles TO authenticated;
