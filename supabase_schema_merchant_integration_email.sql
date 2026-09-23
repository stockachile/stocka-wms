-- ==============================================================================
-- TRIGGER SUPABASE: Notificación por Email de Nueva Conexión de Integración
-- Destinatario: stockachile@gmail.com
-- Remitente: info@stocka.cl (WMS STOCKA Integraciones)
-- ==============================================================================

-- 1. Asegurar extensión pg_net para llamadas HTTP asíncronas
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Función Trigger
CREATE OR REPLACE FUNCTION tr_fn_merchant_integration_connected_email()
RETURNS TRIGGER AS $$
DECLARE
  v_supabase_url text := 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
  v_service_key  text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzMTE4NSwiZXhwIjoyMDk1NDA3MTg1fQ.YX4okf4XNkkVQaU0XbbRtm4SNRTqvwEVNd7ubc4PGe8';
  v_payload      jsonb;
  v_user_name    text := 'Usuario WMS';
  v_user_email   text := 'N/A';
  v_comercio     text := 'Comercio';
BEGIN
  -- Solo disparar si la integración está activa
  IF NEW.is_active IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- Si es un UPDATE, disparar solo si pasó de falso a verdadero o cambió el access_token
  IF TG_OP = 'UPDATE' THEN
    IF OLD.is_active = TRUE AND OLD.access_token IS NOT DISTINCT FROM NEW.access_token THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Resolver nombre de comercio
  IF NEW.comercio IS NOT NULL AND NEW.comercio != '' THEN
    v_comercio := NEW.comercio;
  ELSE
    SELECT COALESCE(raw_user_meta_data->>'full_name', email)
    INTO v_comercio
    FROM auth.users
    WHERE id = NEW.merchant_id;
  END IF;

  -- Resolver datos del usuario que la configuró
  IF NEW.merchant_id IS NOT NULL THEN
    SELECT 
      COALESCE(raw_user_meta_data->>'full_name', email),
      email
    INTO v_user_name, v_user_email
    FROM auth.users
    WHERE id = NEW.merchant_id;
  END IF;

  -- Construir payload para la Edge Function send-billing-email
  v_payload := jsonb_build_object(
    'emailType', 'merchant_integration_connected',
    'comercio', COALESCE(v_comercio, 'STOCKA'),
    'commerceName', COALESCE(v_comercio, 'STOCKA'),
    'platform', COALESCE(NEW.platform, 'Plataforma'),
    'shopUrl', COALESCE(NEW.shop_url, '-'),
    'connectionType', CASE 
      WHEN NEW.platform = 'Shopify' AND NEW.access_token LIKE 'shpat_%' THEN 'Token de Acceso Shopify'
      WHEN NEW.platform = 'Shopify' THEN 'OAuth 2.0 Oficial'
      WHEN NEW.platform = 'Mercado Libre' THEN 'OAuth 2.0 Mercado Libre'
      WHEN NEW.platform = 'WooCommerce' THEN 'Claves API WooCommerce'
      WHEN NEW.platform = 'Falabella' THEN 'API Key Falabella Seller'
      WHEN NEW.platform = 'Ripley' THEN 'API Key Ripley Mirakl'
      WHEN NEW.platform = 'Walmart' THEN 'Credenciales Walmart API'
      WHEN NEW.platform = 'París' OR NEW.platform = 'Paris' THEN 'API Key París Mirakl'
      WHEN NEW.platform = 'Jumpseller' THEN 'Credenciales Jumpseller'
      WHEN NEW.platform = 'Tiendanube' THEN 'Token Tiendanube'
      WHEN NEW.platform = 'Optiroute' THEN 'Token de Tracking Optiroute'
      ELSE 'Conexión Directa'
    END,
    'userName', COALESCE(v_user_name, 'Usuario WMS'),
    'userEmail', COALESCE(v_user_email, 'N/A'),
    'connectedAt', to_char(NOW() AT TIME ZONE 'America/Santiago', 'DD/MM/YYYY HH24:MI:SS'),
    'extraDetails', 'Notificación automática enviada desde base de datos Supabase.'
  );

  -- Realizar llamada HTTP asíncrona a send-billing-email
  PERFORM net.http_post(
    url := v_supabase_url || '/functions/v1/send-billing-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := v_payload
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Error en tr_fn_merchant_integration_connected_email: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Crear Trigger en la tabla merchant_integrations
DROP TRIGGER IF EXISTS tr_merchant_integration_email ON merchant_integrations;
CREATE TRIGGER tr_merchant_integration_email
  AFTER INSERT OR UPDATE OF is_active, access_token ON merchant_integrations
  FOR EACH ROW
  EXECUTE FUNCTION tr_fn_merchant_integration_connected_email();
