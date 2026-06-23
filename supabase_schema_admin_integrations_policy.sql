-- WMS STOCKA - Supabase Schema: Habilitar Acceso Administrador a Integraciones de Clientes
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Crear función is_admin() si no existe (con seguridad definer para evitar recursión RLS)
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- 2. Habilitar política para que los administradores puedan ver y gestionar todas las integraciones
DROP POLICY IF EXISTS "Admin gestiona todas las integraciones" ON public.merchant_integrations;
CREATE POLICY "Admin gestiona todas las integraciones" ON public.merchant_integrations
  FOR ALL USING (is_admin());
