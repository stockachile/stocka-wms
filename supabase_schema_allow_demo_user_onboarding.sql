-- ==============================================================================
-- WMS STOCKA - Migración: Permitir Onboarding a Usuarios Demo con el Mismo Correo
-- Ejecutar este script en el SQL Editor de Supabase
-- ==============================================================================

-- 1. Eliminar la versión previa de check_email_exists para actualizar su tipo de retorno
DROP FUNCTION IF EXISTS public.check_email_exists(TEXT);

-- 2. Nueva función check_email_exists que diferencia leads demo de clientes activos
CREATE OR REPLACE FUNCTION public.check_email_exists(p_email TEXT)
RETURNS JSONB AS $$
DECLARE
    v_clean_email TEXT := LOWER(TRIM(p_email));
    v_user_id UUID;
    v_is_demo BOOLEAN := false;
    v_role TEXT := '';
BEGIN
    -- Validar formato básico
    IF v_clean_email IS NULL OR v_clean_email = '' THEN
        RETURN jsonb_build_object(
            'allowed', false,
            'is_demo', false,
            'message', 'Por favor ingresa un correo electrónico válido.'
        );
    END IF;

    -- 2.1 Verificar si ya existe una solicitud de onboarding en curso o aprobada para este correo
    IF EXISTS (
        SELECT 1 FROM public.onboarding_requests 
        WHERE LOWER(TRIM(email)) = v_clean_email 
          AND status IN ('pending', 'pending_contract', 'approved')
    ) THEN
        RETURN jsonb_build_object(
            'allowed', false,
            'is_demo', false,
            'message', 'Ya existe una solicitud de onboarding en proceso o aprobada para este correo electrónico. Nuestro equipo se contactará contigo.'
        );
    END IF;

    -- 2.2 Buscar si el usuario existe en auth.users
    SELECT id INTO v_user_id 
    FROM auth.users 
    WHERE LOWER(TRIM(email)) = v_clean_email 
    LIMIT 1;

    IF v_user_id IS NOT NULL THEN
        -- Verificar el estado y rol en public.profiles
        SELECT COALESCE(is_demo_user, false), COALESCE(role, 'observer') 
        INTO v_is_demo, v_role
        FROM public.profiles 
        WHERE id = v_user_id;

        -- Si es un usuario registrado para la DEMO y con rol 'observer' (no cliente operativo, admin o colaborador)
        IF (v_is_demo IS TRUE OR v_role = 'observer') THEN
            RETURN jsonb_build_object(
                'allowed', true,
                'is_demo', true,
                'user_id', v_user_id,
                'message', 'Usuario demo detectado. Se vinculará tu cuenta existente a tu solicitud oficial de cliente.'
            );
        ELSE
            -- Es un usuario operativo, cliente o admin existente: Bloquear para evitar sobreescritura accidental
            RETURN jsonb_build_object(
                'allowed', false,
                'is_demo', false,
                'message', 'El correo electrónico ya se encuentra registrado con una cuenta activa en el sistema. Inicia sesión o contacta a soporte.'
            );
        END IF;
    END IF;

    -- 2.3 El correo no existe en el sistema: Completamente libre
    RETURN jsonb_build_object(
        'allowed', true,
        'is_demo', false,
        'user_id', NULL,
        'message', 'Correo disponible.'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Otorgar permisos de ejecución para la comprobación
GRANT EXECUTE ON FUNCTION public.check_email_exists TO anon, authenticated, service_role;


-- 3. Función segura para convertir un usuario Demo en usuario de Onboarding
-- Actualiza credenciales (Bcrypt), remueve la bandera demo y deja el registro listo para onboarding_requests
CREATE OR REPLACE FUNCTION public.convert_demo_user_for_onboarding(
    p_email TEXT,
    p_password TEXT,
    p_full_name TEXT,
    p_company_name TEXT
)
RETURNS UUID AS $$
DECLARE
    v_clean_email TEXT := LOWER(TRIM(p_email));
    v_user_id UUID;
    v_is_demo BOOLEAN := false;
    v_role TEXT := '';
BEGIN
    -- 3.1 Buscar usuario en auth.users
    SELECT id INTO v_user_id 
    FROM auth.users 
    WHERE LOWER(TRIM(email)) = v_clean_email 
    LIMIT 1;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'No se encontró la cuenta de usuario para el correo proporcionado.';
    END IF;

    -- 3.2 Verificar que sea estrictamente una cuenta demo o rol observer
    SELECT COALESCE(is_demo_user, false), COALESCE(role, 'observer') 
    INTO v_is_demo, v_role
    FROM public.profiles 
    WHERE id = v_user_id;

    IF NOT (v_is_demo IS TRUE OR v_role = 'observer') THEN
        RAISE EXCEPTION 'Esta cuenta no califica como usuario demo convertible.';
    END IF;

    -- 3.3 Verificar que no tenga solicitudes activas previas
    IF EXISTS (
        SELECT 1 FROM public.onboarding_requests 
        WHERE LOWER(TRIM(email)) = v_clean_email 
          AND status IN ('pending', 'pending_contract', 'approved')
    ) THEN
        RAISE EXCEPTION 'Ya existe una solicitud de onboarding activa o aprobada para este correo.';
    END IF;

    -- 3.4 Actualizar auth.users (contraseña encriptada, metadatos y confirmación de correo)
    IF p_password IS NOT NULL AND LENGTH(p_password) >= 8 THEN
        UPDATE auth.users
        SET 
            encrypted_password = crypt(p_password, gen_salt('bf', 10)),
            raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
                'full_name', p_full_name,
                'company_name', p_company_name,
                'is_demo_user', false
            ),
            email_confirmed_at = COALESCE(email_confirmed_at, now()),
            updated_at = now()
        WHERE id = v_user_id;
    ELSE
        UPDATE auth.users
        SET 
            raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
                'full_name', p_full_name,
                'company_name', p_company_name,
                'is_demo_user', false
            ),
            email_confirmed_at = COALESCE(email_confirmed_at, now()),
            updated_at = now()
        WHERE id = v_user_id;
    END IF;

    -- 3.5 Actualizar public.profiles para reflejar la transición
    UPDATE public.profiles
    SET 
        full_name = p_full_name,
        company_name = p_company_name,
        is_demo_user = false,
        lead_status = 'onboarding',
        updated_at = now()
    WHERE id = v_user_id;

    RETURN v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Otorgar permisos de ejecución para la conversión
GRANT EXECUTE ON FUNCTION public.convert_demo_user_for_onboarding TO anon, authenticated, service_role;
