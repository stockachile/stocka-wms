-- WMS STOCKA - Supabase Schema Actualización: Sincronización Automática de Envíame a Pedidos (Orders) con mapeo de Operador
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase (https://supabase.com/dashboard/project/ejtjfaucnxbikrwjwwdu/sql)

-- 1. Crear o reemplazar la función trigger
CREATE OR REPLACE FUNCTION public.sync_enviame_shipment_to_orders_func()
RETURNS TRIGGER AS $$
DECLARE
  v_order_uuid UUID;
  v_current_wms_status TEXT;
  v_target_operador TEXT;
  v_courier_upper TEXT;
BEGIN
  -- Si el envío no tiene un order_id (referencia al pedido), no hacemos nada
  IF NEW.order_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolver el UUID del pedido buscando por id (si es UUID) o por external_order_number
  IF NEW.order_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id, status INTO v_order_uuid, v_current_wms_status FROM public.orders WHERE id = NEW.order_id::uuid;
  ELSE
    SELECT id, status INTO v_order_uuid, v_current_wms_status FROM public.orders WHERE external_order_number = NEW.order_id;
  END IF;

  -- Si se encuentra el pedido correspondiente, actualizar sus metadatos
  IF v_order_uuid IS NOT NULL THEN
    
    -- Mapear courier a operador WMS compatible
    v_courier_upper := UPPER(TRIM(NEW.courier));
    IF v_courier_upper LIKE '%STARKEN%' THEN
      v_target_operador := 'STARKEN';
    ELSIF v_courier_upper LIKE '%BLUE%' THEN
      v_target_operador := 'BLUEXPRESS';
    ELSIF v_courier_upper LIKE '%CHILEXPRESS%' THEN
      v_target_operador := 'CHILEXPRESS';
    ELSIF v_courier_upper LIKE '%ENVIAME%' THEN
      v_target_operador := 'ENVIAME';
    ELSIF v_courier_upper LIKE '%ALPHA%' OR v_courier_upper LIKE '%LIGHTDATA%' THEN
      v_target_operador := 'ALPHA';
    ELSIF v_courier_upper LIKE '%FALABELLA%' THEN
      v_target_operador := 'FALABELLA';
    ELSIF v_courier_upper LIKE '%MERCADO%' THEN
      v_target_operador := 'MERCADOLIBRE';
    ELSIF v_courier_upper LIKE '%RECIBELO%' OR v_courier_upper LIKE '%RECÍBELO%' OR v_courier_upper LIKE '%WELIVERY%' OR v_courier_upper LIKE '%WOODELIVERY%' OR v_courier_upper LIKE '%WODELY%' THEN
      v_target_operador := 'STOCKA X';
    ELSE
      v_target_operador := v_courier_upper;
    END IF;

    -- Actualizar los datos en la tabla orders (excluyendo la columna status)
    UPDATE public.orders
    SET
      tracking_number = NEW.tracking_number,
      tracking_url = NEW.tracking_url,
      label_url = NEW.label_url,
      courier = NEW.courier,
      operador = v_target_operador,
      enviame_delivery_id = NEW.id,
      enviame_status = NEW.status
    WHERE id = v_order_uuid;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Vincular el trigger a la tabla enviame_shipments
DROP TRIGGER IF EXISTS trg_sync_enviame_shipment_to_orders ON public.enviame_shipments;
CREATE TRIGGER trg_sync_enviame_shipment_to_orders
  AFTER INSERT OR UPDATE ON public.enviame_shipments
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_enviame_shipment_to_orders_func();
