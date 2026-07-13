-- WMS STOCKA - Esquema de Automatización de Correos de Facturación (Versión 2)
-- Ejecutar en el SQL Editor de Supabase

-- 1. Agregar columnas necesarias a la tabla de registros de facturación
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS last_notified_at TIMESTAMPTZ;
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS overdue_notified BOOLEAN DEFAULT false;

-- 2. Asegurar que la extensión pg_net esté activada para peticiones HTTP
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 3. Trigger BEFORE UPDATE: Marcar registro como vencido/notificado para evitar duplicados
CREATE OR REPLACE FUNCTION public.tr_fn_billing_record_overdue_check()
RETURNS TRIGGER AS $$
BEGIN
  -- Si el pago cambia a 'Atrasado' por primera vez y no ha sido notificado
  IF ((NEW.pago_fulfillment = 'Atrasado' AND OLD.pago_fulfillment IS DISTINCT FROM 'Atrasado') OR
      (NEW.pago_enviame = 'Atrasado' AND OLD.pago_enviame IS DISTINCT FROM 'Atrasado')) 
     AND NEW.overdue_notified = false THEN
     NEW.overdue_notified := true;
     NEW.last_notified_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_billing_record_overdue_check ON public.billing_records;
CREATE TRIGGER tr_billing_record_overdue_check
  BEFORE UPDATE ON public.billing_records
  FOR EACH ROW
  EXECUTE FUNCTION public.tr_fn_billing_record_overdue_check();

-- 4. Trigger AFTER UPDATE: Enviar correo de "Plazo de Pago Vencido" automáticamente una sola vez
CREATE OR REPLACE FUNCTION public.tr_fn_billing_record_overdue_email()
RETURNS TRIGGER AS $$
BEGIN
  -- Si se marcó como overdue_notified en esta actualización
  IF (NEW.overdue_notified = true AND OLD.overdue_notified = false) THEN
     -- Invocar a la Edge Function enviando la petición con el token de service role
     PERFORM net.http_post(
       url := 'https://ejtjfaucnxbikrwjwwdu.supabase.co/functions/v1/send-billing-email',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzMTE4NSwiZXhwIjoyMDk1NDA3MTg1fQ.YX4okf4XNkkVQaU0XbbRtm4SNRTqvwEVNd7ubc4PGe8'
       ),
       body := jsonb_build_object(
         'recordId', NEW.id,
         'emailType', 'payment_overdue',
         'serviceType', CASE 
            WHEN NEW.pago_fulfillment = 'Atrasado' AND NEW.pago_enviame = 'Atrasado' THEN 'both'
            WHEN NEW.pago_enviame = 'Atrasado' THEN 'enviame'
            ELSE 'fulfillment'
          END
       )
     );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_billing_record_overdue_email ON public.billing_records;
CREATE TRIGGER tr_billing_record_overdue_email
  AFTER UPDATE ON public.billing_records
  FOR EACH ROW
  EXECUTE FUNCTION public.tr_fn_billing_record_overdue_email();

-- 5. Trigger AFTER INSERT OR UPDATE en commerce_billing_status: Enviar correo de "Servicio Pausado/Restablecido" automáticamente
CREATE OR REPLACE FUNCTION public.tr_fn_commerce_status_email()
RETURNS TRIGGER AS $$
DECLARE
  v_should_send_paused BOOLEAN := false;
  v_should_send_restored BOOLEAN := false;
BEGIN
  -- Si es un UPDATE
  IF (TG_OP = 'UPDATE') THEN
    -- Si cambia de activo a suspendido (al_dia = false)
    IF (NEW.al_dia = false AND (OLD.al_dia = true OR OLD.al_dia IS NULL)) THEN
      v_should_send_paused := true;
    -- Si cambia de suspendido a activo (al_dia = true)
    ELSIF (NEW.al_dia = true AND OLD.al_dia = false) THEN
      v_should_send_restored := true;
    END IF;
  -- Si es un INSERT y se inicializa directamente como suspendido
  ELSIF (TG_OP = 'INSERT') THEN
    IF (NEW.al_dia = false) THEN
      v_should_send_paused := true;
    END IF;
  END IF;

  IF v_should_send_paused THEN
     PERFORM net.http_post(
       url := 'https://ejtjfaucnxbikrwjwwdu.supabase.co/functions/v1/send-billing-email',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzMTE4NSwiZXhwIjoyMDk1NDA3MTg1fQ.YX4okf4XNkkVQaU0XbbRtm4SNRTqvwEVNd7ubc4PGe8'
       ),
       body := jsonb_build_object(
         'commerceName', NEW.comercio,
         'emailType', 'service_paused',
         'serviceType', 'both'
       )
     );
  ELSIF v_should_send_restored THEN
     PERFORM net.http_post(
       url := 'https://ejtjfaucnxbikrwjwwdu.supabase.co/functions/v1/send-billing-email',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzMTE4NSwiZXhwIjoyMDk1NDA3MTg1fQ.YX4okf4XNkkVQaU0XbbRtm4SNRTqvwEVNd7ubc4PGe8'
       ),
       body := jsonb_build_object(
         'commerceName', NEW.comercio,
         'emailType', 'service_restored',
         'serviceType', 'both'
       )
     );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_commerce_status_email ON public.commerce_billing_status;
CREATE TRIGGER tr_commerce_status_email
  AFTER INSERT OR UPDATE ON public.commerce_billing_status
  FOR EACH ROW
  EXECUTE FUNCTION public.tr_fn_commerce_status_email();
