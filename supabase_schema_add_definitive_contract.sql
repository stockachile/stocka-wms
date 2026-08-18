-- =========================================================================
-- MIGRACIÓN: AÑADIR CONTRATO DEFINITIVO A CONFIGURACIÓN DE COMERCIOS
-- =========================================================================

-- 1. Agregar columnas a public.comercios_adicional_config
ALTER TABLE public.comercios_adicional_config ADD COLUMN IF NOT EXISTS contrato_url TEXT;
ALTER TABLE public.comercios_adicional_config ADD COLUMN IF NOT EXISTS contrato_storage_path TEXT;

-- 2. Recrear la función trigger para enviar correos de onboarding incluyendo la URL del contrato
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

  -- Invocar la Edge Function para envío de correos de actualización (aprobado u observado) con contratoUrl
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
