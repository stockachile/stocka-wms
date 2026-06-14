-- WMS STOCKA - Usuarios, Roles, Vista de Comercios y Funciones Administrativas

-- 1. Asegurar que las columnas existan en la tabla public.profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS comercio TEXT DEFAULT 'no asignado';

-- 2. Asegurar el constraint de roles ('admin', 'client', 'observer')
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'client', 'observer'));
ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'observer';

-- 3. Crear la vista v_comercios_config para resolver el problema de permisos de la tabla externa (Foreign Table)
-- Esta vista se creará bajo el owner 'postgres' (que tiene mapeos FDW configurados), lo que permite que sea consultada
-- por roles autenticados y anónimos de la aplicación.
CREATE OR REPLACE VIEW public.v_comercios_config AS
SELECT id, nombre, sigla FROM public.comercios_config;

-- Otorgar permisos de lectura sobre la vista a los roles anon y authenticated de Supabase
GRANT SELECT ON public.v_comercios_config TO anon, authenticated;

-- 4. Modificar la función trigger handle_new_user() para asignar rol de observer por defecto y guardar metadatos
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (
    id, 
    role, 
    company_name, 
    full_name, 
    email, 
    comercio
  )
  VALUES (
    new.id, 
    'observer', -- Rol inicial de solo lectura por defecto
    COALESCE(new.raw_user_meta_data->>'company_name', 'Mi Empresa ' || split_part(new.email, '@', 1)),
    COALESCE(new.raw_user_meta_data->>'full_name', 'Nuevo Usuario'),
    new.email,
    'no asignado'
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recrear el trigger handle_new_user sobre auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 5. Crear trigger prevent_unauthorized_profile_updates para seguridad a nivel de base de datos
-- Esto evita que usuarios no-administradores se auto-asignen roles elevados ('admin', 'client') o modifiquen sus comercios asociados
CREATE OR REPLACE FUNCTION public.prevent_unauthorized_profile_updates()
RETURNS TRIGGER AS $$
BEGIN
  -- Solo aplicar la validación si la actualización proviene de un usuario autenticado de la app
  IF auth.uid() IS NOT NULL THEN
    -- Si el usuario no tiene rol admin, bloquear cambios a role, comercio o company_name
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    ) THEN
      IF NEW.role IS DISTINCT FROM OLD.role OR NEW.comercio IS DISTINCT FROM OLD.comercio OR NEW.company_name IS DISTINCT FROM OLD.company_name THEN
        RAISE EXCEPTION 'No tienes permisos para modificar tu Rol, Comercio o Nombre de Empresa.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recrear el trigger check_profile_updates
DROP TRIGGER IF EXISTS check_profile_updates ON public.profiles;
CREATE TRIGGER check_profile_updates
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_unauthorized_profile_updates();

-- 6. Crear la función administrativa para crear usuarios desde el panel de admin
CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_email TEXT,
  p_password TEXT,
  p_full_name TEXT,
  p_company_name TEXT,
  p_role TEXT,
  p_comercio TEXT
)
RETURNS UUID AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- 1. Seguridad: Verificar que el usuario que ejecuta la función es realmente un Administrador
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Acceso denegado: Se requieren permisos de Administrador.';
  END IF;

  -- 2. Insertar en la tabla auth.users con contraseña encriptada (Bcrypt) y confirmación automática de email
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    p_email,
    crypt(p_password, gen_salt('bf', 10)),
    now(), -- Se confirma automáticamente
    '{"provider":"email","providers":["email"]}'::jsonb,
    json_build_object('full_name', p_full_name, 'company_name', p_company_name)::jsonb,
    now(),
    now()
  ) RETURNING id INTO v_user_id;

  -- 3. Actualizar el perfil generado automáticamente para fijar el rol, comercio, nombre y correo
  UPDATE public.profiles
  SET role = p_role,
      comercio = p_comercio,
      full_name = p_full_name,
      company_name = p_company_name,
      email = p_email
  WHERE id = v_user_id;

  RETURN v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
