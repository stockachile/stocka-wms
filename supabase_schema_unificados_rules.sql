-- WMS STOCKA - Supabase Schema Actualización: Reglas de Negocio para Envíos Unificados
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase (https://supabase.com/dashboard/project/ejtjfaucnxbikrwjwwdu/sql)

-- =========================================================================
-- REGLA 1: Auto-asignación de tracking con movimiento (DESPACHADO) a Pedidos
-- =========================================================================

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
    -- Mapear courier a operador WMS
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

DROP TRIGGER IF EXISTS trg_sync_unified_to_orders ON public.envios_unificados;
CREATE TRIGGER trg_sync_unified_to_orders
  AFTER INSERT OR UPDATE ON public.envios_unificados
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_unified_status_to_orders_func();


-- =========================================================================
-- REGLA 2: Alerta / Incidencia si existen múltiples envíos activos con movimiento
-- =========================================================================

CREATE OR REPLACE FUNCTION public.check_multiple_shipments_movement_func()
RETURNS TRIGGER AS $$
DECLARE
  v_count_moved INTEGER;
  v_admin_id UUID;
  v_incident_title TEXT;
BEGIN
  -- Solo comprobar si el envío tiene movimiento (DESPACHADO) y tiene referencias válidas
  IF NEW.global_status = 'DESPACHADO' AND NEW.pedido_referencia IS NOT NULL AND NEW.tracking IS NOT NULL AND NEW.tracking != '' THEN
    
    -- Contar cuántos OTROS números de tracking distintos tienen movimiento (DESPACHADO) para esta misma referencia
    SELECT COUNT(DISTINCT tracking) INTO v_count_moved
    FROM public.envios_unificados
    WHERE pedido_referencia = NEW.pedido_referencia
      AND global_status = 'DESPACHADO'
      AND tracking IS NOT NULL
      AND tracking != ''
      AND tracking != NEW.tracking;

    -- Si se detectan más envíos activos, generar la incidencia
    IF v_count_moved > 0 THEN
      -- Obtener el ID de un usuario administrador
      SELECT id INTO v_admin_id FROM public.profiles WHERE role = 'admin' LIMIT 1;

      IF v_admin_id IS NOT NULL THEN
        v_incident_title := 'Múltiples trackings con movimiento - Pedido ' || NEW.pedido_referencia;

        -- Insertar la incidencia solo si no hay una pendiente con el mismo título
        IF NOT EXISTS (
          SELECT 1 FROM public.incidencias 
          WHERE title = v_incident_title AND status = 'pendiente'
        ) THEN
          INSERT INTO public.incidencias (
            user_id,
            comercio,
            title,
            description,
            solution,
            type,
            severity,
            status
          ) VALUES (
            v_admin_id,
            'ADMIN_ONLY', -- Usamos un comercio ficticio para que RLS impida que el comercio cliente la visualice
            v_incident_title,
            'Se han detectado 2 o más números de seguimiento distintos con movimiento (global_status = DESPACHADO) asociados a la referencia ' || NEW.pedido_referencia || '. El sistema ha priorizado el último movimiento detectado, pero se requiere verificación del administrador para descartar duplicidades.',
            'Verificar en los portales de los transportistas cuál es el envío real y anular o dar seguimiento al correspondiente.',
            'pedido',
            'alto',
            'pendiente'
          );
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_check_multiple_shipments_movement ON public.envios_unificados;
CREATE TRIGGER trg_check_multiple_shipments_movement
  AFTER INSERT OR UPDATE ON public.envios_unificados
  FOR EACH ROW
  EXECUTE FUNCTION public.check_multiple_shipments_movement_func();
