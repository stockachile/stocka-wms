-- WMS STOCKA - Integración de Leads y Registro Demo en public.profiles

-- 1. Agregar columnas para la gestión de leads y seguimiento comercial en public.profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_demo_user BOOLEAN DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS lead_status TEXT DEFAULT 'nuevo';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS lead_notes TEXT DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS lead_emails_sent JSONB DEFAULT '[]'::jsonb;

-- 2. Asegurar que los roles permitidos incluyan observadores y clientes (los leads inician como observer con bandera is_demo_user)
-- Nota: La validación check_role_check ya existe, pero nos aseguramos que is_demo_user diferencie los accesos demo.

-- 3. Modificar la función trigger handle_new_user() para heredar la bandera is_demo_user desde los metadatos de Auth
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (
    id, 
    role, 
    company_name, 
    full_name, 
    email, 
    comercio,
    is_demo_user,
    lead_status,
    lead_notes,
    lead_emails_sent
  )
  VALUES (
    new.id, 
    'observer', -- Rol inicial por defecto
    COALESCE(new.raw_user_meta_data->>'company_name', 'Mi Empresa ' || split_part(new.email, '@', 1)),
    COALESCE(new.raw_user_meta_data->>'full_name', 'Nuevo Usuario'),
    new.email,
    'no asignado',
    COALESCE((new.raw_user_meta_data->>'is_demo_user')::boolean, false),
    CASE WHEN (new.raw_user_meta_data->>'is_demo_user')::boolean = true THEN 'nuevo' ELSE NULL END,
    '',
    '[]'::jsonb
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Recrear el trigger para asegurar que se aplique la nueva lógica
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 5. Comentario explicativo
COMMENT ON COLUMN public.profiles.is_demo_user IS 'Indica si el usuario se registró para probar la demo y califica como lead comercial.';
COMMENT ON COLUMN public.profiles.lead_status IS 'Estado del lead comercial: nuevo, contactado, seguimiento, convertido.';
COMMENT ON COLUMN public.profiles.lead_notes IS 'Notas internas sobre el lead.';
COMMENT ON COLUMN public.profiles.lead_emails_sent IS 'Historial en formato JSON de correos enviados al lead a través de Brevo.';
