-- WMS STOCKA - Trigger de Notificación Automática para Ingresos de Stock
-- Ejecutar en el SQL Editor de Supabase para activar el envío 100% automático desde la Base de Datos

CREATE EXTENSION IF NOT EXISTS pg_net;

-- Función de trigger: Notificar a través de la Edge Function cada vez que se crea un nuevo ingreso
CREATE OR REPLACE FUNCTION public.tr_fn_stock_declaration_created_notify()
RETURNS TRIGGER AS $$
BEGIN
  -- Disparar petición HTTP asíncrona hacia la Edge Function de Supabase
  PERFORM net.http_post(
    url := 'https://ejtjfaucnxbikrwjwwdu.supabase.co/functions/v1/send-billing-email'::text,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzMTE4NSwiZXhwIjoyMDk1NDA3MTg1fQ.YX4okf4XNkkVQaU0XbbRtm4SNRTqvwEVNd7ubc4PGe8'
    ),
    body := jsonb_build_object(
      'emailType', 'stock_inbound_created',
      'declarationId', NEW.id,
      'comercio', NEW.comercio,
      'title', NEW.title,
      'quantityDeclared', NEW.quantity_declared,
      'packageCount', NEW.package_count,
      'packageType', NEW.package_type,
      'deliveryMethod', NEW.delivery_method,
      'carrierInfo', NEW.carrier_info,
      'notes', NEW.notes,
      'estimatedArrivalDate', NEW.estimated_arrival_date,
      'estimatedArrivalPeriod', NEW.estimated_arrival_period
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Crear el trigger en la tabla stock_declarations
DROP TRIGGER IF EXISTS tr_stock_declaration_created_notify ON public.stock_declarations;
CREATE TRIGGER tr_stock_declaration_created_notify
  AFTER INSERT ON public.stock_declarations
  FOR EACH ROW
  EXECUTE FUNCTION public.tr_fn_stock_declaration_created_notify();
