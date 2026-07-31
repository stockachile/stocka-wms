-- WMS STOCKA - Supabase Schema Phase 18: Desacoplar estado de despachos de stock operacional
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase (https://supabase.com/dashboard/project/ejtjfaucnxbikrwjwwdu/sql)

-- 1. Redefinir la función trigger de sincronización de Envíame para NO actualizar orders.status
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


-- 2. Redefinir la función trigger de envios_unificados para NO actualizar orders.status
CREATE OR REPLACE FUNCTION public.sync_unified_status_to_orders_func()
RETURNS TRIGGER AS $$
DECLARE
  v_order_uuid UUID;
  v_current_wms_status TEXT;
  v_target_operador TEXT;
  v_courier_upper TEXT;
BEGIN
  -- Si el pedido_referencia está vacío, no hacemos nada
  IF NEW.pedido_referencia IS NULL THEN
    RETURN NEW;
  END IF;

  -- 1. Buscar la orden por UUID o por external_order_number
  IF NEW.pedido_referencia ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id, status INTO v_order_uuid, v_current_wms_status FROM public.orders WHERE id = NEW.pedido_referencia::uuid;
  ELSE
    SELECT id, status INTO v_order_uuid, v_current_wms_status FROM public.orders WHERE external_order_number = NEW.pedido_referencia;
  END IF;

  -- 2. Si encontramos la orden, evaluar si debemos actualizar los datos de tracking
  IF v_order_uuid IS NOT NULL THEN
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

    -- Actualizamos los datos en orders sin modificar el estado operacional (status)
    IF NEW.global_status = 'DESPACHADO' OR 
       EXISTS (SELECT 1 FROM public.orders WHERE id = v_order_uuid AND (tracking_number IS NULL OR tracking_number = '')) 
    THEN
      UPDATE public.orders
      SET
        tracking_number = NEW.tracking,
        tracking_url = NEW.tracking_url,
        courier = NEW.courier,
        operador = v_target_operador
      WHERE id = v_order_uuid;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. Redefinir la función trigger que maneja cambios de estado del envío unificado
CREATE OR REPLACE FUNCTION public.handle_unified_shipment_status_change()
RETURNS TRIGGER AS $$
DECLARE
  v_order RECORD;
  v_new_estado_wms TEXT := NULL;
  v_new_status TEXT := NULL;
  v_changes_array JSONB;
BEGIN
  -- A) Se deshabilita la actualización automática a 'DESPACHADO' para no alterar stock ni estado lógico del WMS
  -- IF NEW.global_status = 'DESPACHADO' AND (OLD.global_status IS NULL OR OLD.global_status != 'DESPACHADO') THEN
  --   v_new_estado_wms := 'Despachado';
  --   v_new_status := 'despachado';
  -- END IF;

  -- B) Si pasa a 'ALERTA' (Incidencia) y antes no lo estaba, mantenemos la creación de alertas
  IF NEW.global_status = 'ALERTA' AND (OLD.global_status IS NULL OR OLD.global_status != 'ALERTA') THEN
    v_new_estado_wms := 'Incidencia';
    v_new_status := 'incidencia';
  END IF;

  IF v_new_estado_wms IS NOT NULL THEN
    
    FOR v_order IN 
      SELECT id, estado_wms, status, comercio 
      FROM public.orders 
      WHERE external_order_number = NEW.pedido_referencia
    LOOP
      IF v_order.estado_wms != v_new_estado_wms THEN
        
        UPDATE public.orders
        SET estado_wms = v_new_estado_wms,
            status = v_new_status
        WHERE id = v_order.id;

        v_changes_array := jsonb_build_array(
          'Estado WMS cambiado a "' || v_new_estado_wms || '" automáticamente por Courier (' || COALESCE(NEW.courier, 'Desconocido') || ')',
          'Estado lógico cambiado a "' || v_new_status || '" (Cambio automático)'
        );

        INSERT INTO public.order_audit_logs (
          order_id,
          user_id,
          user_email,
          action,
          details
        ) VALUES (
          v_order.id,
          NULL,
          'WMS System (Auto-Transit)',
          'Actualización de Estado vía Courier',
          jsonb_build_object('changes', v_changes_array, 'courier', NEW.courier, 'tracking', NEW.tracking, 'shipment_id', NEW.id)
        );
      END IF;
    END LOOP;

    IF NEW.pedido_referencia ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      FOR v_order IN 
        SELECT id, estado_wms, status, comercio 
        FROM public.orders 
        WHERE id = NEW.pedido_referencia::uuid
      LOOP
        IF v_order.estado_wms != v_new_estado_wms THEN
          
          UPDATE public.orders
          SET estado_wms = v_new_estado_wms,
              status = v_new_status
          WHERE id = v_order.id;

          v_changes_array := jsonb_build_array(
            'Estado WMS cambiado a "' || v_new_estado_wms || '" automáticamente por Courier (' || COALESCE(NEW.courier, 'Desconocido') || ')',
            'Estado lógico cambiado a "' || v_new_status || '" (Cambio automático)'
          );

          INSERT INTO public.order_audit_logs (
            order_id,
            user_id,
            user_email,
            action,
            details
          ) VALUES (
            v_order.id,
            NULL,
            'WMS System (Auto-Transit)',
            'Actualización de Estado vía Courier',
            jsonb_build_object('changes', v_changes_array, 'courier', NEW.courier, 'tracking', NEW.tracking, 'shipment_id', NEW.id)
          );
        END IF;
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
