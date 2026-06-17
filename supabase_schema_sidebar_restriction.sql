-- WMS STOCKA - Esquema para Restricción de Módulos de Barra Lateral

-- 1. Agregar la columna allowed_modules a la tabla public.profiles si no existe
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS allowed_modules TEXT DEFAULT 'all';

-- 2. Modificar la función trigger handle_new_user() para asignar todos los módulos por defecto al registrarse
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
    allowed_modules
  )
  VALUES (
    new.id, 
    'observer', -- Rol inicial por defecto
    COALESCE(new.raw_user_meta_data->>'company_name', 'Mi Empresa ' || split_part(new.email, '@', 1)),
    COALESCE(new.raw_user_meta_data->>'full_name', 'Nuevo Usuario'),
    new.email,
    'no asignado',
    'all' -- Permite todos los módulos inicialmente
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recrear el trigger handle_new_user
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Modificar el trigger de seguridad prevent_unauthorized_profile_updates
-- Esto evita que usuarios no-administradores se auto-asignen módulos o cambien sus roles
CREATE OR REPLACE FUNCTION public.prevent_unauthorized_profile_updates()
RETURNS TRIGGER AS $$
BEGIN
  -- Solo validar si la consulta proviene de un usuario autenticado de la app
  IF auth.uid() IS NOT NULL THEN
    -- Si no es administrador, prohibir cambios críticos
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    ) THEN
      IF NEW.role IS DISTINCT FROM OLD.role 
         OR NEW.comercio IS DISTINCT FROM OLD.comercio 
         OR NEW.company_name IS DISTINCT FROM OLD.company_name
         OR NEW.allowed_modules IS DISTINCT FROM OLD.allowed_modules THEN
        RAISE EXCEPTION 'No tienes permisos para modificar tus roles, comercios o módulos asignados.';
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

-- 4. Modificar la función RPC admin_create_user para soportar la asignación de módulos en la creación
CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_email TEXT,
  p_password TEXT,
  p_full_name TEXT,
  p_company_name TEXT,
  p_role TEXT,
  p_comercio TEXT,
  p_allowed_modules TEXT DEFAULT 'all'
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

  -- 2. Insertar en la tabla auth.users con contraseña encriptada y email auto-confirmado
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
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    json_build_object('full_name', p_full_name, 'company_name', p_company_name)::jsonb,
    now(),
    now()
  ) RETURNING id INTO v_user_id;

  -- 3. Actualizar el perfil generado automáticamente con todos los detalles
  UPDATE public.profiles
  SET role = p_role,
      comercio = p_comercio,
      full_name = p_full_name,
      company_name = p_company_name,
      email = p_email,
      allowed_modules = p_allowed_modules
  WHERE id = v_user_id;

  RETURN v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
