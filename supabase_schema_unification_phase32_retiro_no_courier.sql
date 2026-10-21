-- =================================================================================
-- FASE 32: BLOQUEO ESTRICTO DE COURIER Y TRACKING PARA PEDIDOS CATEGORÍA "RETIRO"
-- =================================================================================
-- Regla de Negocio:
-- Cuando un pedido tiene la categoría de entrega 'RETIRO', NUNCA deberá tener
-- asignación de courier ni tracking (ni etiqueta de courier externo). Cualquier
-- intento de asignación (manual, webhook, Envíame, LightData, Starken, BlueX, etc.)
-- queda bloqueado automáticamente en base de datos a menos que su categoría cambie
-- a 'DISTRIBUCIÓN' o 'LOGÍSTICA INVERSA'.
-- =================================================================================

CREATE OR REPLACE FUNCTION public.enforce_retiro_no_courier_rules()
RETURNS TRIGGER AS $$
BEGIN
  IF UPPER(TRIM(COALESCE(NEW.categoria_entrega, ''))) = 'RETIRO' THEN
    NEW.agenda := 'RETIRO';
    NEW.operador := 'SUCURSAL ÑUÑOA';
    NEW.courier := NULL;
    NEW.tracking_number := NULL;
    NEW.tracking_url := NULL;
    NEW.label_url := NULL;
    NEW.label_base64 := NULL;
    NEW.enviame_delivery_id := NULL;
    NEW.enviame_status := NULL;
    NEW.raw_lightdata_data := NULL;
    NEW.lightdata_status := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_z_enforce_retiro_no_courier ON public.orders;
CREATE TRIGGER trg_z_enforce_retiro_no_courier
BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.enforce_retiro_no_courier_rules();

-- Limpieza retroactiva de cualquier pedido actual con categoría RETIRO que tenga courier o tracking asignado
UPDATE public.orders
SET
  agenda = 'RETIRO',
  operador = 'SUCURSAL ÑUÑOA',
  courier = NULL,
  tracking_number = NULL,
  tracking_url = NULL,
  label_url = NULL,
  label_base64 = NULL,
  enviame_delivery_id = NULL,
  enviame_status = NULL,
  raw_lightdata_data = NULL,
  lightdata_status = NULL
WHERE UPPER(TRIM(COALESCE(categoria_entrega, ''))) = 'RETIRO'
  AND (
    courier IS NOT NULL OR
    tracking_number IS NOT NULL OR
    tracking_url IS NOT NULL OR
    label_url IS NOT NULL OR
    label_base64 IS NOT NULL OR
    enviame_delivery_id IS NOT NULL OR
    raw_lightdata_data IS NOT NULL
  );
