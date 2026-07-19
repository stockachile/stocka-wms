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
BEGIN
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
        p_contrato_url, p_contrato_storage_path, 'pending'
    )
    RETURNING id INTO v_request_id;
    
    RETURN v_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Otorgar permiso de ejecución al público
GRANT EXECUTE ON FUNCTION public.create_onboarding_request TO anon, authenticated;

-- 3. Función segura para comprobar la existencia del correo
CREATE OR REPLACE FUNCTION public.check_email_exists(p_email TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM auth.users WHERE email = p_email
    ) OR EXISTS (
        SELECT 1 FROM public.onboarding_requests WHERE email = p_email AND status = 'pending'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Otorgar permiso de ejecución al público
GRANT EXECUTE ON FUNCTION public.check_email_exists TO anon, authenticated;

-- 3. Políticas de Storage sobre el bucket 'service_docs'
-- Permite que los usuarios autenticados (incluso con rol inicial 'observer') puedan subir archivos en la carpeta onboarding/
DROP POLICY IF EXISTS "Permitir subir onboarding a autenticados" ON storage.objects;
CREATE POLICY "Permitir subir onboarding a autenticados" ON storage.objects
    FOR INSERT TO authenticated
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
    v_email_type := 'onboarding_received';
  ELSIF (TG_OP = 'UPDATE') THEN
    IF (OLD.status = NEW.status) THEN
      RETURN NEW; -- No cambió el estado, no hacer nada
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

  -- Invocar la Edge Function para envío de correos usando pg_net
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
      'customMessage', v_custom_message
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
