-- WMS STOCKA - RPC segura para que un Administrador confirme manualmente el correo electrónico de un usuario
-- Útil cuando el servidor de correo corporativo del cliente bloquea o filtra el enlace de confirmación.

CREATE OR REPLACE FUNCTION public.admin_confirm_user_email(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_email TEXT;
  v_existing_confirmed TIMESTAMPTZ;
  v_confirmed_at TIMESTAMPTZ;
BEGIN
  -- 1. Seguridad: solo Administradores autenticados o service_role pueden ejecutar esta función
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    IF auth.uid() IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    ) THEN
      RAISE EXCEPTION 'Acceso denegado: Se requieren permisos de Administrador.';
    END IF;
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'ID de usuario inválido.';
  END IF;

  -- 2. Verificar existencia del usuario en auth.users
  SELECT email, email_confirmed_at
  INTO v_email, v_existing_confirmed
  FROM auth.users
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado en el sistema de autenticación.';
  END IF;

  -- 3. Confirmar correo en auth.users (preservando fecha previa si ya estaba confirmado)
  UPDATE auth.users
  SET
    email_confirmed_at = COALESCE(email_confirmed_at, now()),
    raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('email_verified', true),
    updated_at = now()
  WHERE id = p_user_id
  RETURNING email_confirmed_at INTO v_confirmed_at;

  -- 4. Sincronizar explícitamente en public.profiles
  UPDATE public.profiles
  SET email_confirmed_at = v_confirmed_at
  WHERE id = p_user_id
    AND (email_confirmed_at IS NULL OR email_confirmed_at <> v_confirmed_at);

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'email', v_email,
    'email_confirmed_at', v_confirmed_at,
    'already_confirmed', (v_existing_confirmed IS NOT NULL)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_confirm_user_email(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_confirm_user_email(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_confirm_user_email(UUID) TO authenticated, service_role;
