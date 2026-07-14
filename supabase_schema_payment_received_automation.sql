-- 1. Crear tabla de cola de correos si no existe
CREATE TABLE IF NOT EXISTS public.billing_email_queue (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  record_id uuid REFERENCES public.billing_records(id) ON DELETE CASCADE,
  email_type text NOT NULL,
  service_type text NOT NULL,
  send_at timestamp with time zone NOT NULL,
  sent_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar RLS y otorgar accesos necesarios
ALTER TABLE public.billing_email_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins ven cola de correos" ON public.billing_email_queue;
CREATE POLICY "Admins ven cola de correos" ON public.billing_email_queue
  FOR ALL USING (auth.role() = 'authenticated');

GRANT ALL ON public.billing_email_queue TO postgres, service_role;
GRANT SELECT ON public.billing_email_queue TO authenticated;

-- 2. Trigger function para encolar el correo de pago recibido
CREATE OR REPLACE FUNCTION public.tr_fn_queue_payment_received_email()
RETURNS TRIGGER AS $$
DECLARE
  v_should_queue_fulfillment BOOLEAN := false;
  v_should_queue_enviame BOOLEAN := false;
BEGIN
  -- Verificar si el pago de Fulfillment cambia a 'Recibido'
  IF (NEW.pago_fulfillment = 'Recibido' AND (OLD.pago_fulfillment IS NULL OR OLD.pago_fulfillment != 'Recibido')) THEN
    v_should_queue_fulfillment := true;
  END IF;

  -- Verificar si el pago de Envíame cambia a 'Recibido'
  IF (NEW.pago_enviame = 'Recibido' AND (OLD.pago_enviame IS NULL OR OLD.pago_enviame != 'Recibido')) THEN
    v_should_queue_enviame := true;
  END IF;

  -- Encolar para Fulfillment (se enviará en 15 minutos)
  IF v_should_queue_fulfillment THEN
    INSERT INTO public.billing_email_queue (record_id, email_type, service_type, send_at)
    VALUES (NEW.id, 'payment_received', 'fulfillment', now() + interval '15 minutes');
  END IF;

  -- Encolar para Envíame (se enviará en 15 minutos)
  IF v_should_queue_enviame THEN
    INSERT INTO public.billing_email_queue (record_id, email_type, service_type, send_at)
    VALUES (NEW.id, 'payment_received', 'enviame', now() + interval '15 minutes');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Enlazar trigger a la tabla billing_records
DROP TRIGGER IF EXISTS tr_queue_payment_received_email ON public.billing_records;
CREATE TRIGGER tr_queue_payment_received_email
  AFTER UPDATE ON public.billing_records
  FOR EACH ROW
  EXECUTE FUNCTION public.tr_fn_queue_payment_received_email();

-- 3. Función para procesar y despachar la cola de correos
CREATE OR REPLACE FUNCTION public.process_billing_email_queue()
RETURNS jsonb AS $$
DECLARE
  v_row record;
  v_success_count integer := 0;
  v_error_count integer := 0;
BEGIN
  FOR v_row IN 
    SELECT q.id, q.record_id, q.email_type, q.service_type
    FROM public.billing_email_queue q
    WHERE q.send_at <= now() AND q.sent_at IS NULL
  LOOP
    BEGIN
      PERFORM net.http_post(
        url := 'https://ejtjfaucnxbikrwjwwdu.supabase.co/functions/v1/send-billing-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzMTE4NSwiZXhwIjoyMDk1NDA3MTg1fQ.YX4okf4XNkkVQaU0XbbRtm4SNRTqvwEVNd7ubc4PGe8'
        ),
        body := jsonb_build_object(
          'recordId', v_row.record_id,
          'emailType', v_row.email_type,
          'serviceType', v_row.service_type
        )
      );

      UPDATE public.billing_email_queue
      SET sent_at = now()
      WHERE id = v_row.id;

      v_success_count := v_success_count + 1;
    EXCEPTION WHEN OTHERS THEN
      v_error_count := v_error_count + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'processed', v_success_count + v_error_count,
    'success', v_success_count,
    'errors', v_error_count
  );
END;
$$ LANGUAGE plpgsql;

-- 4. Programar ejecución cada minuto con pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.unschedule('process-billing-email-queue-job') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-billing-email-queue-job');
SELECT cron.schedule('process-billing-email-queue-job', '* * * * *', 'SELECT public.process_billing_email_queue()');
