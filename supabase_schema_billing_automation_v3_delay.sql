-- WMS STOCKA - Actualización de Automatización de Correos (12 Horas de Desfase)
-- Ejecutar en el SQL Editor de Supabase

-- 1. Actualizar la función del trigger para encolar el aviso de pago vencido con 12 horas de desfase en lugar de enviarlo de forma inmediata
CREATE OR REPLACE FUNCTION public.tr_fn_billing_record_overdue_email()
RETURNS TRIGGER AS $$
DECLARE
  v_service_type TEXT;
BEGIN
  -- Si se marcó como overdue_notified en esta actualización
  IF (NEW.overdue_notified = true AND OLD.overdue_notified = false) THEN
     -- Determinar el tipo de servicio atrasado
     v_service_type := CASE 
       WHEN NEW.pago_fulfillment = 'Atrasado' AND NEW.pago_enviame = 'Atrasado' THEN 'both'
       WHEN NEW.pago_enviame = 'Atrasado' THEN 'enviame'
       ELSE 'fulfillment'
     END;

     -- Encolar el aviso de pago vencido en la tabla de cola con 12 horas de desfase (interval '12 hours')
     INSERT INTO public.billing_email_queue (record_id, email_type, service_type, send_at)
     VALUES (NEW.id, 'payment_overdue', v_service_type, now() + interval '12 hours');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Asegurar que el trigger esté enlazado correctamente
DROP TRIGGER IF EXISTS tr_billing_record_overdue_email ON public.billing_records;
CREATE TRIGGER tr_billing_record_overdue_email
  AFTER UPDATE ON public.billing_records
  FOR EACH ROW
  EXECUTE FUNCTION public.tr_fn_billing_record_overdue_email();

-- 3. Mensaje de confirmación en la consola
SELECT 'Trigger de cobro vencido automatizado actualizado con desfase de 12 horas exitosamente.' as resultado;
