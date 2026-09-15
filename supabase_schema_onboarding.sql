-- WMS STOCKA - Esquema de Base de Datos para Onboarding Fulfillment 360
-- Ejecutar este archivo en el Editor SQL de Supabase (SQL Editor)

-- 1. Crear Tabla para Solicitudes de Onboarding
CREATE TABLE IF NOT EXISTS public.onboarding_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    rut_personal TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    cargo TEXT,
    razon_social TEXT NOT NULL,
    rut_empresa TEXT NOT NULL,
    giro_comercio TEXT NOT NULL,
    direccion_facturacion TEXT NOT NULL,
    comuna TEXT NOT NULL,
    email_facturacion TEXT NOT NULL,
    nombre_fantasia TEXT NOT NULL,
    sitio_web TEXT,
    plataformas_venta TEXT[],                   -- Array de plataformas (ej: ['Shopify', 'Woocommerce'])
    marketplaces TEXT[],                        -- Array de marketplaces (ej: ['Mercadolibre'])
    courier_santiago TEXT[],                    -- Preferencias de courier en Santiago
    courier_regiones TEXT[],                    -- Preferencias de courier en Regiones
    ml_opciones TEXT[],                         -- Opciones de Mercado Libre si aplica
    retiro_sucursal BOOLEAN DEFAULT false,      -- Ofrece retiro en sucursal
    descripcion_packaging TEXT,                 -- Instrucciones de empaque
    contrato_url TEXT,                          -- Enlace público del contrato subido en Supabase
    contrato_storage_path TEXT,                 -- Ruta en el storage (ej: 'onboarding/123-uuid_contrato.pdf')
    status TEXT CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
    rejection_reason TEXT,                      -- Motivo en caso de rechazo
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.onboarding_requests ENABLE ROW LEVEL SECURITY;

-- Otorgar Permisos de Acceso a Roles de Supabase
GRANT ALL ON public.onboarding_requests TO postgres, service_role;
GRANT ALL ON public.onboarding_requests TO anon, authenticated;

-- Políticas RLS para onboarding_requests
DROP POLICY IF EXISTS "Usuarios leen su propia solicitud de onboarding" ON public.onboarding_requests;
CREATE POLICY "Usuarios leen su propia solicitud de onboarding" ON public.onboarding_requests
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins leen y gestionan todas las solicitudes" ON public.onboarding_requests;
CREATE POLICY "Admins leen y gestionan todas las solicitudes" ON public.onboarding_requests
    FOR ALL TO authenticated USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
    );

-- 2. Función segura (SECURITY DEFINER) para crear solicitudes
-- Esto permite el insert desde la interfaz pública invocándola como RPC, evitando problemas de RLS durante el registro.
CREATE OR REPLACE FUNCTION public.create_onboarding_request(
    p_user_id UUID,
    p_full_name TEXT,
    p_rut_personal TEXT,
    p_email TEXT,
    p_phone TEXT,
    p_cargo TEXT,
    p_razon_social TEXT,
    p_rut_empresa TEXT,
    p_giro_comercio TEXT,
    p_direccion_facturacion TEXT,
    p_comuna TEXT,
    p_email_facturacion TEXT,
    p_nombre_fantasia TEXT,
    p_sitio_web TEXT,
    p_plataformas_venta TEXT[],
    p_marketplaces TEXT[],
    p_courier_santiago TEXT[],
    p_courier_regiones TEXT[],
    p_ml_opciones TEXT[],
    p_retiro_sucursal BOOLEAN,
    p_descripcion_packaging TEXT,
    p_contrato_url TEXT,
    p_contrato_storage_path TEXT
)
RETURNS UUID AS $$
DECLARE
    v_request_id UUID;
    v_status TEXT;
BEGIN
    -- Si no se envía url del contrato, queda en 'pending_contract' (esperando firma privada)
    IF (p_contrato_url IS NULL OR p_contrato_url = '') THEN
        v_status := 'pending_contract';
    ELSE
        v_status := 'pending';
    END IF;

    INSERT INTO public.onboarding_requests (
        user_id, full_name, rut_personal, email, phone, cargo,
        razon_social, rut_empresa, giro_comercio, direccion_facturacion, comuna, email_facturacion,
        nombre_fantasia, sitio_web, plataformas_venta, marketplaces,
        courier_santiago, courier_regiones, ml_opciones, retiro_sucursal, descripcion_packaging,
        contrato_url, contrato_storage_path, status
    )
    VALUES (
        p_user_id, p_full_name, p_rut_personal, p_email, p_phone, p_cargo,
        p_razon_social, p_rut_empresa, p_giro_comercio, p_direccion_facturacion, p_comuna, p_email_facturacion,
        p_nombre_fantasia, p_sitio_web, p_plataformas_venta, p_marketplaces,
        p_courier_santiago, p_courier_regiones, p_ml_opciones, p_retiro_sucursal, p_descripcion_packaging,
        p_contrato_url, p_contrato_storage_path, v_status
    )
    RETURNING id INTO v_request_id;
    
    RETURN v_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Otorgar permiso de ejecución al público
GRANT EXECUTE ON FUNCTION public.create_onboarding_request TO anon, authenticated;

-- 3. Función segura para comprobar la existencia del correo y permitir conversión de usuarios demo
DROP FUNCTION IF EXISTS public.check_email_exists(TEXT);
CREATE OR REPLACE FUNCTION public.check_email_exists(p_email TEXT)
RETURNS JSONB AS $$
DECLARE
    v_clean_email TEXT := LOWER(TRIM(p_email));
    v_user_id UUID;
    v_is_demo BOOLEAN := false;
    v_role TEXT := '';
BEGIN
    IF v_clean_email IS NULL OR v_clean_email = '' THEN
        RETURN jsonb_build_object('allowed', false, 'is_demo', false, 'message', 'Por favor ingresa un correo electrónico válido.');
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.onboarding_requests 
        WHERE LOWER(TRIM(email)) = v_clean_email 
          AND status IN ('pending', 'pending_contract', 'approved')
    ) THEN
        RETURN jsonb_build_object('allowed', false, 'is_demo', false, 'message', 'Ya existe una solicitud de onboarding en proceso o aprobada para este correo electrónico.');
    END IF;

    SELECT id INTO v_user_id FROM auth.users WHERE LOWER(TRIM(email)) = v_clean_email LIMIT 1;

    IF v_user_id IS NOT NULL THEN
        SELECT COALESCE(is_demo_user, false), COALESCE(role, 'observer') 
        INTO v_is_demo, v_role
        FROM public.profiles WHERE id = v_user_id;

        IF (v_is_demo IS TRUE OR v_role = 'observer') THEN
            RETURN jsonb_build_object('allowed', true, 'is_demo', true, 'user_id', v_user_id, 'message', 'Usuario demo detectado. Se vinculará a la solicitud oficial de cliente.');
        ELSE
            RETURN jsonb_build_object('allowed', false, 'is_demo', false, 'message', 'El correo electrónico ya se encuentra registrado con una cuenta activa en el sistema.');
        END IF;
    END IF;

    RETURN jsonb_build_object('allowed', true, 'is_demo', false, 'message', 'Correo disponible.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.check_email_exists TO anon, authenticated, service_role;

-- 3.1 Función segura para convertir usuarios demo en onboarding
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
    SELECT id INTO v_user_id FROM auth.users WHERE LOWER(TRIM(email)) = v_clean_email LIMIT 1;
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'No se encontró la cuenta de usuario para el correo proporcionado.';
    END IF;

    SELECT COALESCE(is_demo_user, false), COALESCE(role, 'observer') 
    INTO v_is_demo, v_role
    FROM public.profiles WHERE id = v_user_id;

    IF NOT (v_is_demo IS TRUE OR v_role = 'observer') THEN
        RAISE EXCEPTION 'Esta cuenta no califica como usuario demo convertible.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.onboarding_requests 
        WHERE LOWER(TRIM(email)) = v_clean_email 
          AND status IN ('pending', 'pending_contract', 'approved')
    ) THEN
        RAISE EXCEPTION 'Ya existe una solicitud de onboarding activa o aprobada para este correo.';
    END IF;

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

GRANT EXECUTE ON FUNCTION public.convert_demo_user_for_onboarding TO anon, authenticated, service_role;

-- 3. Políticas de Storage sobre el bucket 'service_docs'
-- Permite que cualquiera (incluyendo usuarios anónimos durante el proceso de registro) pueda subir archivos en la carpeta onboarding/
DROP POLICY IF EXISTS "Permitir subir onboarding a autenticados" ON storage.objects;
DROP POLICY IF EXISTS "Permitir subir onboarding a cualquiera" ON storage.objects;
CREATE POLICY "Permitir subir onboarding a cualquiera" ON storage.objects
    FOR INSERT TO public
    WITH CHECK (
        bucket_id = 'service_docs' AND
        (storage.foldername(name))[1] = 'onboarding'
    );

-- 4. Función trigger para enviar correos de onboarding automáticamente
CREATE OR REPLACE FUNCTION public.tr_onboarding_request_email_notification()
RETURNS TRIGGER AS $$
DECLARE
  v_email_type TEXT;
  v_custom_message TEXT := '';
BEGIN
  IF (TG_OP = 'INSERT') THEN
    -- 1. Enviar correo de confirmación al cliente
    PERFORM net.http_post(
      url := 'https://ejtjfaucnxbikrwjwwdu.supabase.co/functions/v1/send-billing-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzMTE4NSwiZXhwIjoyMDk1NDA3MTg1fQ.YX4okf4XNkkVQaU0XbbRtm4SNRTqvwEVNd7ubc4PGe8'
      ),
      body := jsonb_build_object(
        'commerceName', NEW.nombre_fantasia,
        'emailType', 'onboarding_received',
        'emails', ARRAY[NEW.email]
      )
    );

    RETURN NEW;
  ELSIF (TG_OP = 'UPDATE') THEN
    IF (OLD.status = NEW.status) THEN
      RETURN NEW; -- No cambió el estado, no hacer nada
    END IF;

    -- Si el estado cambió a 'pending', notificar al administrador con los detalles completos y el contrato firmado
    IF (NEW.status = 'pending') THEN
      -- 1. Notificación al administrador (stockachile@gmail.com)
      PERFORM net.http_post(
        url := 'https://ejtjfaucnxbikrwjwwdu.supabase.co/functions/v1/send-billing-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzMTE4NSwiZXhwIjoyMDk1NDA3MTg1fQ.YX4okf4XNkkVQaU0XbbRtm4SNRTqvwEVNd7ubc4PGe8'
        ),
        body := jsonb_build_object(
          'commerceName', NEW.nombre_fantasia,
          'emailType', 'onboarding_admin_notification',
          'emails', ARRAY['stockachile@gmail.com'],
          'onboardingDetails', jsonb_build_object(
            'razonSocial', NEW.razon_social,
            'rutEmpresa', NEW.rut_empresa,
            'contactName', NEW.full_name,
            'contactEmail', NEW.email,
            'phone', NEW.phone,
            'giroComercio', NEW.giro_comercio,
            'direccion', NEW.direccion_facturacion,
            'comuna', NEW.comuna,
            'contratoUrl', NEW.contrato_url,
            'acceptedAnnexes', NEW.accepted_annexes
          )
        )
      );

      -- 2. Copia de confirmación al cliente (NEW.email)
      PERFORM net.http_post(
        url := 'https://ejtjfaucnxbikrwjwwdu.supabase.co/functions/v1/send-billing-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzMTE4NSwiZXhwIjoyMDk1NDA3MTg1fQ.YX4okf4XNkkVQaU0XbbRtm4SNRTqvwEVNd7ubc4PGe8'
        ),
        body := jsonb_build_object(
          'commerceName', NEW.nombre_fantasia,
          'emailType', 'onboarding_contract_received',
          'emails', ARRAY[NEW.email],
          'onboardingDetails', jsonb_build_object(
            'razonSocial', NEW.razon_social,
            'rutEmpresa', NEW.rut_empresa,
            'contactName', NEW.full_name,
            'contactEmail', NEW.email,
            'phone', NEW.phone,
            'giroComercio', NEW.giro_comercio,
            'direccion', NEW.direccion_facturacion,
            'comuna', NEW.comuna,
            'contratoUrl', NEW.contrato_url,
            'acceptedAnnexes', NEW.accepted_annexes
          )
        )
      );
      RETURN NEW;
    END IF;

    IF (NEW.status = 'approved') THEN
      v_email_type := 'onboarding_approved';
    ELSIF (NEW.status = 'rejected') THEN
      v_email_type := 'onboarding_observed';
      v_custom_message := COALESCE(NEW.rejection_reason, '');
    ELSE
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  -- Invocar la Edge Function para envío de correos de actualización (aprobado u observado)
  PERFORM net.http_post(
    url := 'https://ejtjfaucnxbikrwjwwdu.supabase.co/functions/v1/send-billing-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzMTE4NSwiZXhwIjoyMDk1NDA3MTg1fQ.YX4okf4XNkkVQaU0XbbRtm4SNRTqvwEVNd7ubc4PGe8'
    ),
    body := jsonb_build_object(
      'commerceName', NEW.nombre_fantasia,
      'emailType', v_email_type,
      'emails', ARRAY[NEW.email],
      'customMessage', v_custom_message,
      'contratoUrl', NEW.contrato_url
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Crear el trigger en la tabla onboarding_requests
DROP TRIGGER IF EXISTS tg_onboarding_request_email ON public.onboarding_requests;
CREATE TRIGGER tg_onboarding_request_email
  AFTER INSERT OR UPDATE OF status ON public.onboarding_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.tr_onboarding_request_email_notification();

-- 5. RPC para actualizar metadatos del usuario en auth.users desde el onboarding (ejecutado por administradores)
CREATE OR REPLACE FUNCTION public.update_user_metadata_from_onboarding(
    p_user_id UUID,
    p_role TEXT,
    p_comercio TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE auth.users
    SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('role', p_role, 'comercio', p_comercio)
    WHERE id = p_user_id;
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Otorgar permisos de ejecución al rol autenticado
GRANT EXECUTE ON FUNCTION public.update_user_metadata_from_onboarding TO authenticated;
