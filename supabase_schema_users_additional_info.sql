-- WMS STOCKA - Supabase Schema: Additional User Information
-- Sincroniza la última conexión (last_sign_in_at) y confirmación de correo (email_confirmed_at)
-- desde la tabla interna de autenticación auth.users a public.profiles.

-- 1. Agregar columnas a la tabla pública profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMP WITH TIME ZONE;

-- 2. Función trigger para actualizar perfiles ante cambios en auth.users
CREATE OR REPLACE FUNCTION public.handle_auth_user_update()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.profiles
  SET last_seen = NEW.last_sign_in_at,
      email_confirmed_at = NEW.email_confirmed_at
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Crear el trigger sobre auth.users para interceptar actualizaciones
DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE OF last_sign_in_at, email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_update();

-- 4. Retroalimentar los registros existentes (Backfill)
UPDATE public.profiles p
SET last_seen = u.last_sign_in_at,
    email_confirmed_at = u.email_confirmed_at
FROM auth.users u
WHERE p.id = u.id;
