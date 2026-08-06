-- WMS STOCKA - SQL Migration to fix VULN-07 (Secure billing_email_queue RLS)
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Asegurar que la función helper is_admin() existe
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- 2. Eliminar la política RLS insegura previa
DROP POLICY IF EXISTS "Admins ven cola de correos" ON public.billing_email_queue;

-- 3. Crear política segura restringida únicamente a administradores
CREATE POLICY "Admins gestionan cola de correos" ON public.billing_email_queue
  FOR ALL USING (is_admin());

-- 4. Asegurar los permisos correspondientes de acceso a la tabla
GRANT ALL ON public.billing_email_queue TO postgres, service_role;
GRANT SELECT ON public.billing_email_queue TO authenticated;
