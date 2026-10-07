-- =========================================================================================
-- WMS STOCKA - MIGRACIÓN: Doble Check Estricto por ID de Envíame y Comercio para Envíos
-- Archivo: migrations/20261007_enviame_strict_commerce_double_check.sql
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase:
-- https://supabase.com/dashboard/project/ejtjfaucnxbikrwjwwdu/sql
-- =========================================================================================

-- 1. Asegurar mapeo de Envíame ID para comercios activos (ej: MAESE -> 166878)
UPDATE public.comercios_adicional_config
SET enviame_id = '166878'
WHERE comercio = 'MAESE' AND (enviame_id IS NULL OR enviame_id = '');

-- 2. Redefinir la función trigger con salvaguardas estrictas contra asignaciones cruzadas
CREATE OR REPLACE FUNCTION public.sync_enviame_shipment_to_orders_func()
RETURNS TRIGGER AS $$
DECLARE
  v_enviame_id TEXT;
  v_comercio_name TEXT;
  v_sigla TEXT;
  v_clean_ref TEXT;
  
  v_order_uuid UUID;
  v_current_tracking TEXT;
  v_target_operador TEXT;
  v_courier_upper TEXT;
  v_clean_tracking TEXT;
BEGIN
  -- Si el envío no tiene un order_id (referencia al pedido) ni id de envío, no hacemos nada
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

  -- 2. Resolver comercio e ID de Envíame a partir del envío entrante
  -- A. Extraer ID de compañía desde el raw_payload o seller_name
  IF NEW.raw_payload IS NOT NULL THEN
    IF NEW.raw_payload->'company'->>'id' IS NOT NULL THEN
      v_enviame_id := TRIM(NEW.raw_payload->'company'->>'id');
    ELSIF NEW.raw_payload->>'seller_id' IS NOT NULL THEN
      v_enviame_id := TRIM(NEW.raw_payload->>'seller_id');
    ELSIF NEW.raw_payload->'links' IS NOT NULL THEN
      SELECT substring((elem->>'href') from '/companies/([0-9]+)/') INTO v_enviame_id
      FROM jsonb_array_elements(NEW.raw_payload->'links') AS elem
      WHERE elem->>'href' ~ '/companies/[0-9]+/'
      LIMIT 1;
    END IF;
  END IF;

  IF v_enviame_id IS NULL AND NEW.seller_name IS NOT NULL THEN
    IF NEW.seller_name ~* '^ID\s*:?\s*[0-9]+$' THEN
      v_enviame_id := trim(regexp_replace(NEW.seller_name, '^ID\s*:?\s*', '', 'i'));
    END IF;
  END IF;

  -- B. Resolver nombre del comercio a partir del enviame_id
  IF v_enviame_id IS NOT NULL THEN
    SELECT comercio INTO v_comercio_name
    FROM public.comercios_adicional_config
    WHERE v_enviame_id = ANY(string_to_array(regexp_replace(enviame_id, '\s+', '', 'g'), ','))
    LIMIT 1;
  END IF;

  -- C. Resolver por seller_name o company.name si no se resolvió por ID
  IF v_comercio_name IS NULL THEN
    DECLARE
      v_candidate_seller TEXT := NULL;
    BEGIN
      IF NEW.raw_payload IS NOT NULL AND NEW.raw_payload->'company'->>'name' IS NOT NULL THEN
        v_candidate_seller := TRIM(NEW.raw_payload->'company'->>'name');
      ELSIF NEW.seller_name IS NOT NULL AND NOT (NEW.seller_name ~* '^ID\s*:?\s*[0-9]+$') THEN
        v_candidate_seller := TRIM(NEW.seller_name);
      END IF;

      IF v_candidate_seller IS NOT NULL THEN
        SELECT comercio INTO v_comercio_name
        FROM public.comercios_adicional_config
        WHERE LOWER(trim(comercio)) = LOWER(v_candidate_seller)
           OR LOWER(v_candidate_seller) LIKE ('%' || LOWER(trim(comercio)) || '%')
        LIMIT 1;
      END IF;
    END;
  END IF;

  -- D. Obtener la sigla del comercio
  IF v_comercio_name IS NOT NULL THEN
    SELECT sigla INTO v_sigla
    FROM public.v_comercios_config
    WHERE LOWER(trim(nombre)) = LOWER(trim(v_comercio_name))
    LIMIT 1;
  END IF;

  -- E. Fallback por Sigla: Si aún no se resolvió el comercio, ver si NEW.order_id empieza con una sigla registrada
  IF v_comercio_name IS NULL AND NEW.order_id IS NOT NULL THEN
    DECLARE
      v_prefix TEXT := UPPER(substring(regexp_replace(trim(NEW.order_id), '^[^A-Za-z0-9]+', '', 'i') from 1 for 3));
    BEGIN
      IF length(v_prefix) = 3 THEN
        SELECT nombre, sigla INTO v_comercio_name, v_sigla
        FROM public.v_comercios_config
        WHERE UPPER(sigla) = v_prefix
        LIMIT 1;
      END IF;
    END;
  END IF;

  -- 3. RESOLVER EL PEDIDO EN public.orders CON SALVAGUARDA ESTRICTA DE COMERCIO
  -- Si NEW.order_id es un UUID válido directo:
  IF NEW.order_id IS NOT NULL AND NEW.order_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id, tracking_number INTO v_order_uuid, v_current_tracking 
    FROM public.orders 
    WHERE id = NEW.order_id::uuid 
    LIMIT 1;
  END IF;

  -- Si no es UUID y conocemos el comercio (comercio resuelto mediante ID de Envíame o Sigla):
  IF v_order_uuid IS NULL AND v_comercio_name IS NOT NULL AND NEW.order_id IS NOT NULL THEN
    -- Limpiar prefijos '#' y prefijos de sigla
    v_clean_ref := regexp_replace(TRIM(NEW.order_id), '^#+', '');
    IF v_sigla IS NOT NULL THEN
      v_clean_ref := regexp_replace(v_clean_ref, '^' || v_sigla || '[#\-_]?', '', 'i');
    END IF;
    v_clean_ref := regexp_replace(v_clean_ref, '^[A-Za-z]{2,5}', '');

    -- Búsqueda estrictamente circunscrita al comercio validado
    SELECT o.id, o.tracking_number INTO v_order_uuid, v_current_tracking
    FROM public.orders o
    LEFT JOIN public.profiles p ON p.id = o.merchant_id
    WHERE (
          LOWER(trim(o.comercio)) = LOWER(trim(v_comercio_name))
       OR LOWER(trim(v_comercio_name)) = ANY(string_to_array(regexp_replace(LOWER(p.comercio), '\s*,\s*', ',', 'g'), ','))
    )
    AND (
          o.external_order_number = NEW.order_id
       OR o.external_order_number = v_clean_ref
       OR o.external_order_number = ('#' || v_clean_ref)
       OR (v_sigla IS NOT NULL AND o.external_order_number = (v_sigla || '#' || v_clean_ref))
       OR (v_sigla IS NOT NULL AND o.external_order_number = (v_sigla || v_clean_ref))
    )
    AND COALESCE(o.external_platform, '') NOT IN ('MercadoLibre', 'Falabella', 'Paris', 'Ripley', 'Walmart')
    ORDER BY o.created_at DESC
    LIMIT 1;
  END IF;

  -- Fallback de seguridad: buscar por enviame_delivery_id SÓLO dentro del mismo comercio validado
  IF v_order_uuid IS NULL AND v_comercio_name IS NOT NULL AND NEW.id IS NOT NULL THEN
    SELECT o.id, o.tracking_number INTO v_order_uuid, v_current_tracking 
    FROM public.orders o
    LEFT JOIN public.profiles p ON p.id = o.merchant_id
    WHERE (
          LOWER(trim(o.comercio)) = LOWER(trim(v_comercio_name))
       OR LOWER(trim(v_comercio_name)) = ANY(string_to_array(regexp_replace(LOWER(p.comercio), '\s*,\s*', ',', 'g'), ','))
    )
    AND o.enviame_delivery_id = NEW.id
    LIMIT 1;
  END IF;

  -- SI NO SE PUDO DETERMINAR EL COMERCIO O NO HAY COINCIDENCIA DENTRO DE ÉL,
  -- NO SE TOCA LA TABLA ORDERS PARA PREVENIR ASIGNACIONES CRUZADAS DE TRACKING.
  IF v_order_uuid IS NULL THEN
    RETURN NEW;
  END IF;

  -- 4. Actualizar datos en orders si hay correspondencia legítima
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

  UPDATE public.orders
  SET
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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Vincular el trigger a la tabla enviame_shipments
DROP TRIGGER IF EXISTS trg_sync_enviame_shipment_to_orders ON public.enviame_shipments;
CREATE TRIGGER trg_sync_enviame_shipment_to_orders
  AFTER INSERT OR UPDATE ON public.enviame_shipments
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_enviame_shipment_to_orders_func();
