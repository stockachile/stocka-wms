-- WMS STOCKA - Automatización de Notificaciones por Correo de Ingresos de Stock
-- Ejecutar en el SQL Editor de Supabase

-- 1. Función para disparar la notificación por correo al crear un ingreso de stock
CREATE OR REPLACE FUNCTION public.tr_fn_stock_declaration_created_email()
RETURNS TRIGGER AS $$
DECLARE
  v_payload jsonb;
BEGIN
  -- Construir el objeto JSON con la información del ingreso
  v_payload := jsonb_build_object(
    'emailType', 'stock_inbound_created',
    'comercio', COALESCE(NEW.comercio, 'Cliente WMS'),
    'title', COALESCE(NEW.title, 'Ingreso de Stock'),
    'quantityDeclared', COALESCE(NEW.quantity_declared, 0),
    'packageCount', COALESCE(NEW.package_count, 0),
    'packageType', COALESCE(NEW.package_type, 'Cajas'),
    'estimatedArrivalType', COALESCE(NEW.estimated_arrival_type, 'estimate'),
    'estimatedArrivalDate', NEW.estimated_arrival_date,
    'estimatedArrivalPeriod', NEW.estimated_arrival_period,
    'deliveryMethod', COALESCE(NEW.delivery_method, 'No especificado'),
    'carrierInfo', NEW.carrier_info,
    'contactInfo', NEW.contact_info,
    'notes', NEW.notes,
    'declarationId', NEW.id
  );

  -- Petición HTTP asíncrona a la Edge Function
  PERFORM net.http_post(
    url := 'https://ejtjfaucnxbikrwjwwdu.supabase.co/functions/v1/send-billing-email'::text,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzMTE4NSwiZXhwIjoyMDk1NDA3MTg1fQ.YX4okf4XNkkVQaU0XbbRtm4SNRTqvwEVNd7ubc4PGe8'
    ),
    body := v_payload
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Asignar el trigger a la tabla stock_declarations
DROP TRIGGER IF EXISTS tr_stock_declaration_created_email ON public.stock_declarations;
CREATE TRIGGER tr_stock_declaration_created_email
  AFTER INSERT ON public.stock_declarations
  FOR EACH ROW
  EXECUTE FUNCTION public.tr_fn_stock_declaration_created_email();
