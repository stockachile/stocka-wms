-- WMS STOCKA - Supabase Schema Actualización: Sincronización Automática de Envíame a Pedidos (Orders) con mapeo de Operador y Salvaguardas
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase (https://supabase.com/dashboard/project/ejtjfaucnxbikrwjwwdu/sql)

-- 1. Crear o reemplazar la función trigger
CREATE OR REPLACE FUNCTION public.sync_enviame_shipment_to_orders_func()
RETURNS TRIGGER AS $$
DECLARE
  v_order_uuid UUID;
  v_current_tracking TEXT;
  v_target_operador TEXT;
  v_courier_upper TEXT;
  v_clean_tracking TEXT;
  v_clean_ref TEXT;
BEGIN
  -- Si el envío no tiene un order_id (referencia al pedido) ni id, no hacemos nada
  IF NEW.order_id IS NULL AND NEW.id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 1. Limpieza y validación del tracking number entrante
  v_clean_tracking := NULLIF(TRIM(NEW.tracking_number), '');
  IF v_clean_tracking IS NOT NULL THEN
    IF UPPER(v_clean_tracking) IN ('NO INFORMADO', 'NOINFORMADO', 'NULL', 'UNDEFINED', 'N/A', '-', 'SIN INFORMACION', 'SIN INFORMACIÓN') THEN
      v_clean_tracking := NULL;
    END IF;
  END IF;

  -- 2. Resolver el pedido correspondiente en public.orders
  -- A. Si NEW.order_id es un UUID válido
  IF NEW.order_id IS NOT NULL AND NEW.order_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id, tracking_number INTO v_order_uuid, v_current_tracking 
    FROM public.orders 
    WHERE id = NEW.order_id::uuid 
    LIMIT 1;
  END IF;

  -- B. Si no se encontró por UUID, buscar por external_order_number exacto
  IF v_order_uuid IS NULL AND NEW.order_id IS NOT NULL THEN
    SELECT id, tracking_number INTO v_order_uuid, v_current_tracking 
    FROM public.orders 
    WHERE external_order_number = NEW.order_id 
    LIMIT 1;
  END IF;

  -- C. Buscar quitando caracteres '#' o prefijos comunes de 2 a 5 letras (ej: DOR55019059 <-> 55019059)
  IF v_order_uuid IS NULL AND NEW.order_id IS NOT NULL THEN
    v_clean_ref := regexp_replace(TRIM(NEW.order_id), '^#+', '');
    v_clean_ref := regexp_replace(v_clean_ref, '^[A-Za-z]{2,5}', '');
    
    IF LENGTH(v_clean_ref) >= 3 THEN
      SELECT id, tracking_number INTO v_order_uuid, v_current_tracking 
      FROM public.orders 
      WHERE external_order_number = v_clean_ref
         OR external_order_number = ('#' || v_clean_ref)
         OR external_order_number ILIKE ('%' || v_clean_ref)
      ORDER BY created_at DESC 
      LIMIT 1;
    END IF;
  END IF;

  -- D. Fallback: buscar por enviame_delivery_id
  IF v_order_uuid IS NULL AND NEW.id IS NOT NULL THEN
    SELECT id, tracking_number INTO v_order_uuid, v_current_tracking 
    FROM public.orders 
    WHERE enviame_delivery_id = NEW.id 
    LIMIT 1;
  END IF;

  -- 3. Si se encuentra el pedido, actualizar datos
  IF v_order_uuid IS NOT NULL THEN
    
    -- Mapear courier a operador WMS compatible
    v_courier_upper := UPPER(TRIM(COALESCE(NEW.courier, '')));
    IF v_courier_upper LIKE '%STARKEN%' THEN
      v_target_operador := 'STARKEN';
    ELSIF v_courier_upper LIKE '%BLUE%' THEN
      v_target_operador := 'BLUEXPRESS';
    ELSIF v_courier_upper LIKE '%CHILEXPRESS%' THEN
      v_target_operador := 'CHILEXPRESS';
    ELSIF v_courier_upper LIKE '%ALPHA%' OR v_courier_upper LIKE '%LIGHTDATA%' THEN
      v_target_operador := 'ALPHA';
    ELSIF v_courier_upper LIKE '%FALABELLA%' THEN
      v_target_operador := 'FALABELLA';
    ELSIF v_courier_upper LIKE '%MERCADO%' THEN
      v_target_operador := 'MERCADOLIBRE';
    ELSIF v_courier_upper LIKE '%PARIS%' THEN
      v_target_operador := 'PARIS';
    ELSIF v_courier_upper LIKE '%RIPLEY%' THEN
      v_target_operador := 'RIPLEY';
    ELSIF v_courier_upper LIKE '%WALMART%' THEN
      v_target_operador := 'WALMART';
    ELSIF v_courier_upper LIKE '%RECIBELO%' OR v_courier_upper LIKE '%RECÍBELO%' OR v_courier_upper LIKE '%WELIVERY%' OR v_courier_upper LIKE '%WOODELIVERY%' OR v_courier_upper LIKE '%WODELY%' THEN
      v_target_operador := 'STOCKA X';
    ELSIF v_courier_upper <> '' THEN
      v_target_operador := v_courier_upper;
    ELSE
      v_target_operador := 'STOCKA';
    END IF;

    -- Actualizar los datos en la tabla orders SIN sobrescribir con valores inválidos
    UPDATE public.orders
    SET
      -- Si v_clean_tracking existe, asignarlo. Si no existe, pero el tracking actual era "No informado", limpiarlo a NULL. De lo contrario, mantener el actual.
      tracking_number = COALESCE(
        v_clean_tracking, 
        CASE 
          WHEN UPPER(TRIM(COALESCE(v_current_tracking, ''))) IN ('NO INFORMADO', 'NOINFORMADO', 'NULL', 'UNDEFINED', 'N/A', '-') THEN NULL 
          ELSE tracking_number 
        END
      ),
      tracking_url = COALESCE(NULLIF(TRIM(NEW.tracking_url), ''), tracking_url),
      label_url = COALESCE(NULLIF(TRIM(NEW.label_url), ''), label_url),
      courier = COALESCE(NULLIF(TRIM(NEW.courier), ''), courier),
      operador = COALESCE(v_target_operador, operador),
      enviame_delivery_id = COALESCE(NEW.id, enviame_delivery_id),
      enviame_status = COALESCE(NEW.status, enviame_status)
    WHERE id = v_order_uuid;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Vincular el trigger a la tabla enviame_shipments
DROP TRIGGER IF EXISTS trg_sync_enviame_shipment_to_orders ON public.enviame_shipments;
CREATE TRIGGER trg_sync_enviame_shipment_to_orders
  AFTER INSERT OR UPDATE ON public.enviame_shipments
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_enviame_shipment_to_orders_func();
