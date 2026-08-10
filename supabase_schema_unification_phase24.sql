-- WMS STOCKA - Supabase Schema Phase 24: Corregir coincidencia de comercio para perfiles con múltiples comercios asociados
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Redefinir sync_enviame_shipment_to_orders_func para soportar perfiles con múltiples comercios (separados por comas) y coincidencia directa por orders.comercio
CREATE OR REPLACE FUNCTION public.sync_enviame_shipment_to_orders_func()
RETURNS TRIGGER AS $$
DECLARE
  v_enviame_id TEXT;
  v_comercio_name TEXT;
  v_sigla TEXT;
  v_clean_order_id TEXT;
  
  v_order_uuid UUID;
  v_current_wms_status TEXT;
  v_target_operador TEXT;
  v_courier_upper TEXT;
BEGIN
  -- Si el envío no tiene un order_id (referencia al pedido), no hacemos nada
  IF NEW.order_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- A. Intentar extraer el ID de Enviame desde el raw_payload o de seller_name
  IF NEW.raw_payload IS NOT NULL THEN
    IF NEW.raw_payload->'company'->>'id' IS NOT NULL THEN
      v_enviame_id := NEW.raw_payload->'company'->>'id';
    ELSIF NEW.raw_payload->>'seller_id' IS NOT NULL THEN
      v_enviame_id := NEW.raw_payload->>'seller_id';
    END IF;
  END IF;

  IF v_enviame_id IS NULL AND NEW.seller_name IS NOT NULL THEN
    IF NEW.seller_name ~* '^ID\s*:?\s*[0-9]+$' THEN
      v_enviame_id := trim(regexp_replace(NEW.seller_name, '^ID\s*:?\s*', '', 'i'));
    END IF;
  END IF;

  -- B. Resolver el nombre del comercio usando el ID de Enviame
  IF v_enviame_id IS NOT NULL THEN
    SELECT comercio INTO v_comercio_name
    FROM public.comercios_adicional_config
    WHERE v_enviame_id = ANY(string_to_array(regexp_replace(enviame_id, '\s+', '', 'g'), ','))
    LIMIT 1;
  END IF;

  -- C. Fallback: Resolver por seller_name exacto
  IF v_comercio_name IS NULL AND NEW.seller_name IS NOT NULL THEN
    SELECT comercio INTO v_comercio_name
    FROM public.comercios_adicional_config
    WHERE LOWER(trim(comercio)) = LOWER(trim(NEW.seller_name))
    LIMIT 1;
  END IF;

  -- D. Obtener la sigla del comercio a partir de su nombre
  IF v_comercio_name IS NOT NULL THEN
    SELECT sigla INTO v_sigla
    FROM public.v_comercios_config
    WHERE LOWER(trim(nombre)) = LOWER(trim(v_comercio_name))
    LIMIT 1;
  END IF;

  -- E. Fallback Secundario: Si no se resolvió el comercio por ID/Nombre, intentar obtenerlo mediante la sigla inicial en el order_id del envío
  IF v_comercio_name IS NULL THEN
    DECLARE
      v_ref_clean TEXT := UPPER(regexp_replace(trim(NEW.order_id), '^[^A-Z0-9]+', '', 'i'));
    BEGIN
      IF length(v_ref_clean) >= 3 THEN
        SELECT nombre, sigla INTO v_comercio_name, v_sigla
        FROM public.v_comercios_config
        WHERE UPPER(sigla) = substring(v_ref_clean from 1 for 3)
        LIMIT 1;
      END IF;
    END;
  END IF;

  -- F. Resolver el UUID del pedido buscando por ID (si es UUID) o por coincidencia normalizada
  IF NEW.order_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id, status INTO v_order_uuid, v_current_wms_status FROM public.orders WHERE id = NEW.order_id::uuid;
  END IF;

  IF v_order_uuid IS NULL THEN
    -- Limpiar la referencia de pedido del envío
    v_clean_order_id := public.clean_ref(NEW.order_id, v_sigla);

    IF v_comercio_name IS NOT NULL AND v_clean_order_id IS NOT NULL THEN
      -- 1. Intentar coincidencia exacta primero dentro del mismo comercio
      -- Buscamos tanto en o.comercio como en p.comercio (soportando listas de comercios separadas por comas)
      SELECT o.id, o.status INTO v_order_uuid, v_current_wms_status
      FROM public.orders o
      LEFT JOIN public.profiles p ON p.id = o.merchant_id
      WHERE (LOWER(trim(o.comercio)) = LOWER(trim(v_comercio_name))
         OR LOWER(trim(v_comercio_name)) = ANY(string_to_array(regexp_replace(LOWER(p.comercio), '\s*,\s*', ',', 'g'), ',')))
        AND o.external_order_number = NEW.order_id
      LIMIT 1;

      -- 2. Si falla, buscar con la lógica limpia optimizada con pre-filtro de texto
      IF v_order_uuid IS NULL THEN
        SELECT o.id, o.status INTO v_order_uuid, v_current_wms_status
        FROM public.orders o
        LEFT JOIN public.profiles p ON p.id = o.merchant_id
        WHERE (LOWER(trim(o.comercio)) = LOWER(trim(v_comercio_name))
           OR LOWER(trim(v_comercio_name)) = ANY(string_to_array(regexp_replace(LOWER(p.comercio), '\s*,\s*', ',', 'g'), ',')))
          AND o.external_order_number LIKE '%' || v_clean_order_id
          AND public.clean_ref(o.external_order_number, v_sigla) = v_clean_order_id
        LIMIT 1;
      END IF;
    END IF;

    -- Fallback final: Buscar en toda la tabla por external_order_number exacto sin importar el comercio
    IF v_order_uuid IS NULL THEN
      SELECT id, status INTO v_order_uuid, v_current_wms_status FROM public.orders WHERE external_order_number = NEW.order_id LIMIT 1;
    END IF;
  END IF;

  -- G. Actualizar metadatos del pedido si se encontró correspondencia
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- 2. Redefinir la función trigger para actualizar la tabla consolidada envios_unificados
CREATE OR REPLACE FUNCTION public.sync_enviame_to_unified()
RETURNS TRIGGER AS $$
DECLARE
  v_global_status TEXT;
  v_id TEXT := 'enviame_shipments:' || NEW.id;
  
  v_enviame_id TEXT;
  v_comercio_name TEXT;
  v_sigla TEXT;
  v_clean_order_id TEXT;
  
  v_order_uuid UUID;
  v_pedido_ref TEXT;
  v_empresa_resuelta TEXT;
BEGIN
  v_global_status := public.get_global_status('enviame_shipments', NEW.status);

  -- A. Intentar extraer el ID de Enviame desde el raw_payload o de seller_name
  IF NEW.raw_payload IS NOT NULL THEN
    IF NEW.raw_payload->'company'->>'id' IS NOT NULL THEN
      v_enviame_id := NEW.raw_payload->'company'->>'id';
    ELSIF NEW.raw_payload->>'seller_id' IS NOT NULL THEN
      v_enviame_id := NEW.raw_payload->>'seller_id';
    END IF;
  END IF;

  IF v_enviame_id IS NULL AND NEW.seller_name IS NOT NULL THEN
    IF NEW.seller_name ~* '^ID\s*:?\s*[0-9]+$' THEN
      v_enviame_id := trim(regexp_replace(NEW.seller_name, '^ID\s*:?\s*', '', 'i'));
    END IF;
  END IF;

  -- B. Resolver el nombre del comercio usando el ID de Enviame
  IF v_enviame_id IS NOT NULL THEN
    SELECT comercio INTO v_comercio_name
    FROM public.comercios_adicional_config
    WHERE v_enviame_id = ANY(string_to_array(regexp_replace(enviame_id, '\s+', '', 'g'), ','))
    LIMIT 1;
  END IF;

  -- C. Fallback: Resolver por seller_name exacto
  IF v_comercio_name IS NULL AND NEW.seller_name IS NOT NULL THEN
    SELECT comercio INTO v_comercio_name
    FROM public.comercios_adicional_config
    WHERE LOWER(trim(comercio)) = LOWER(trim(NEW.seller_name))
    LIMIT 1;
  END IF;

  -- D. Obtener la sigla del comercio a partir de su nombre
  IF v_comercio_name IS NOT NULL THEN
    SELECT sigla INTO v_sigla
    FROM public.v_comercios_config
    WHERE LOWER(trim(nombre)) = LOWER(trim(v_comercio_name))
    LIMIT 1;
  END IF;

  -- E. Fallback Secundario: Resolver comercio mediante la sigla inicial en el order_id
  IF v_comercio_name IS NULL THEN
    DECLARE
      v_ref_clean TEXT := UPPER(regexp_replace(trim(NEW.order_id), '^[^A-Z0-9]+', '', 'i'));
    BEGIN
      IF length(v_ref_clean) >= 3 THEN
        SELECT nombre, sigla INTO v_comercio_name, v_sigla
        FROM public.v_comercios_config
        WHERE UPPER(sigla) = substring(v_ref_clean from 1 for 3)
        LIMIT 1;
      END IF;
    END;
  END IF;

  -- F. Resolver el UUID del pedido buscando por ID (si es UUID) o por coincidencia normalizada
  IF NEW.order_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id, external_order_number INTO v_order_uuid, v_pedido_ref FROM public.orders WHERE id = NEW.order_id::uuid;
  END IF;

  IF v_order_uuid IS NULL THEN
    v_clean_order_id := public.clean_ref(NEW.order_id, v_sigla);

    IF v_comercio_name IS NOT NULL AND v_clean_order_id IS NOT NULL THEN
      -- 1. Intentar coincidencia exacta primero
      SELECT o.id, o.external_order_number INTO v_order_uuid, v_pedido_ref
      FROM public.orders o
      LEFT JOIN public.profiles p ON p.id = o.merchant_id
      WHERE (LOWER(trim(o.comercio)) = LOWER(trim(v_comercio_name))
         OR LOWER(trim(v_comercio_name)) = ANY(string_to_array(regexp_replace(LOWER(p.comercio), '\s*,\s*', ',', 'g'), ',')))
        AND o.external_order_number = NEW.order_id
      LIMIT 1;

      -- 2. Si falla, usar la lógica limpia optimizada con pre-filtro de texto
      IF v_order_uuid IS NULL THEN
        SELECT o.id, o.external_order_number INTO v_order_uuid, v_pedido_ref
        FROM public.orders o
        LEFT JOIN public.profiles p ON p.id = o.merchant_id
        WHERE (LOWER(trim(o.comercio)) = LOWER(trim(v_comercio_name))
           OR LOWER(trim(v_comercio_name)) = ANY(string_to_array(regexp_replace(LOWER(p.comercio), '\s*,\s*', ',', 'g'), ',')))
          AND o.external_order_number LIKE '%' || v_clean_order_id
          AND public.clean_ref(o.external_order_number, v_sigla) = v_clean_order_id
        LIMIT 1;
      END IF;
    END IF;

    -- Fallback final: Buscar en toda la tabla por external_order_number exacto
    IF v_order_uuid IS NULL THEN
      SELECT id, external_order_number INTO v_order_uuid, v_pedido_ref FROM public.orders WHERE external_order_number = NEW.order_id LIMIT 1;
    END IF;
  END IF;

  -- Si no se encontró ningún pedido, mantenemos el order_id original como referencia
  IF v_pedido_ref IS NULL THEN
    v_pedido_ref := NEW.order_id;
  END IF;

  v_empresa_resuelta := public.get_resolved_empresa(v_pedido_ref, NEW.seller_name);

  INSERT INTO public.envios_unificados (
    id, source_table, source_id, empresa_comercio_proveedor, tracking, tracking_url, courier, status, global_status, created_at, updated_at, servicio_tipo_envio, nombre_destinatario, telefono_destino, email_cliente_destino, direccion_destino, complemento_destino, comuna_destino, pedido_referencia, raw_data
  ) VALUES (
    v_id,
    'enviame_shipments',
    NEW.id,
    v_empresa_resuelta,
    NEW.tracking_number,
    NEW.tracking_url,
    NEW.courier,
    NEW.status,
    v_global_status,
    COALESCE(NEW.enviame_created_at, NEW.created_at),
    COALESCE(NEW.enviame_updated_at, NEW.updated_at),
    NEW.service_type,
    NEW.recipient_name,
    NEW.recipient_phone,
    NEW.recipient_email,
    NEW.recipient_address,
    NEW.address_complement,
    NEW.commune,
    v_pedido_ref,
    NEW.raw_payload
  )
  ON CONFLICT (id) DO UPDATE SET
    empresa_comercio_proveedor = EXCLUDED.empresa_comercio_proveedor,
    tracking = EXCLUDED.tracking,
    tracking_url = EXCLUDED.tracking_url,
    courier = EXCLUDED.courier,
    status = EXCLUDED.status,
    global_status = EXCLUDED.global_status,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at,
    servicio_tipo_envio = EXCLUDED.servicio_tipo_envio,
    nombre_destinatario = EXCLUDED.nombre_destinatario,
    telefono_destino = EXCLUDED.telefono_destino,
    email_cliente_destino = EXCLUDED.email_cliente_destino,
    direccion_destino = EXCLUDED.direccion_destino,
    complemento_destino = EXCLUDED.complemento_destino,
    comuna_destino = EXCLUDED.comuna_destino,
    pedido_referencia = EXCLUDED.pedido_referencia,
    raw_data = EXCLUDED.raw_data;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
