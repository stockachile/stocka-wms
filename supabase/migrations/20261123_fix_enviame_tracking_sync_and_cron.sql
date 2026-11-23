-- =========================================================================================
-- WMS STOCKA - Migración: Blindaje de Triggers de Tracking Envíame, Limpieza de URLs
-- Inválidas, Realtime en orders/envios_unificados y Poller Automático pg_cron (cada 5 min)
-- Fecha: 2026-11-19
-- =========================================================================================

-- =========================================================================================
-- 1. BLINDAR public.sync_enviame_shipment_to_orders_func()
--    - Evita escribir label_url corrupto (ej: '{"PDF":null,...}') o tracking_url con 'No informado'
--    - Respeta estado_wms IN ('Entregado', 'Listo para retiro'), categoria_entrega = 'RETIRO'
--      y wms_forced_tracking activo
-- =========================================================================================
CREATE OR REPLACE FUNCTION public.sync_enviame_shipment_to_orders_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_enviame_id TEXT;
  v_comercio_name TEXT;
  v_sigla TEXT;
  v_clean_ref TEXT;

  v_order_uuid UUID;
  v_current_wms_status TEXT;
  v_current_cat TEXT;
  v_current_tracking TEXT;
  v_current_url TEXT;
  v_current_label_url TEXT;
  v_current_courier TEXT;
  v_current_operador TEXT;
  v_current_raw_shopify JSONB;

  v_forced_active BOOLEAN := FALSE;
  v_forced_track TEXT;
  v_has_diff_forced BOOLEAN := FALSE;

  v_target_operador TEXT;
  v_courier_upper TEXT;
  v_clean_tracking TEXT;
  v_clean_tracking_url TEXT;
  v_clean_label_url TEXT;
BEGIN
  IF NEW.order_id IS NULL AND NEW.id IS NULL THEN
    RETURN NEW;
  END IF;

  v_courier_upper := UPPER(TRIM(COALESCE(NEW.courier, '')));
  -- Ignorar completamente envíos de RECIBELO y WELIVERY para no pisar el tracking real de Alpha / Lightdata
  IF v_courier_upper LIKE '%RECIBELO%' OR v_courier_upper LIKE '%RECÍBELO%'
     OR v_courier_upper LIKE '%WELIVERY%' OR v_courier_upper LIKE '%WOODELIVERY%'
     OR v_courier_upper LIKE '%WODELY%' THEN
    RETURN NEW;
  END IF;

  -- Validar tracking entrante
  v_clean_tracking := NULLIF(TRIM(NEW.tracking_number), '');
  IF v_clean_tracking IS NOT NULL THEN
    IF UPPER(v_clean_tracking) IN ('NO INFORMADO', 'NOINFORMADO', 'NULL', 'UNDEFINED', 'N/A', '-', 'SIN INFORMACION', 'SIN INFORMACIÓN')
       OR v_clean_tracking ~ '^46[0-9]{6,}$' THEN
      v_clean_tracking := NULL;
    END IF;
  END IF;

  -- Validar label_url entrante (solo URL http/https real, nunca JSON '{"PDF":null,...}' ni 'N/A')
  v_clean_label_url := NULLIF(TRIM(NEW.label_url), '');
  IF v_clean_label_url IS NOT NULL AND v_clean_label_url !~* '^https?://' THEN
    v_clean_label_url := NULL;
  END IF;

  -- Validar tracking_url entrante (solo URL http/https sin 'No informado')
  v_clean_tracking_url := NULLIF(TRIM(NEW.tracking_url), '');
  IF v_clean_tracking_url IS NOT NULL THEN
    IF v_clean_tracking_url !~* '^https?://' OR v_clean_tracking_url ~* '(no\s*informado|no%20informado)' THEN
      v_clean_tracking_url := NULL;
    END IF;
  END IF;
  IF v_clean_tracking IS NULL THEN
    v_clean_tracking_url := NULL;
  ELSIF v_clean_tracking_url IS NULL THEN
    IF v_courier_upper LIKE '%STARKEN%' THEN
      v_clean_tracking_url := 'https://www.starken.cl/seguimiento?codigo=' || v_clean_tracking;
    ELSIF v_courier_upper LIKE '%BLUE%' OR v_courier_upper = 'BX' THEN
      v_clean_tracking_url := 'https://tracking-unificado.blue.cl/?n_seguimiento=' || v_clean_tracking;
    ELSIF v_courier_upper LIKE '%CHILEXPRESS%' OR v_courier_upper = 'CXP' THEN
      v_clean_tracking_url := 'https://www.chilexpress.cl/seguimiento-envio?numero=' || v_clean_tracking;
    END IF;
  END IF;

  -- Resolver enviame_id y comercio
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

  IF v_enviame_id IS NOT NULL THEN
    SELECT comercio INTO v_comercio_name
    FROM public.comercios_adicional_config
    WHERE v_enviame_id = ANY(string_to_array(regexp_replace(enviame_id, '\s+', '', 'g'), ','))
    LIMIT 1;
  END IF;

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

  IF v_comercio_name IS NOT NULL THEN
    SELECT sigla INTO v_sigla
    FROM public.v_comercios_config
    WHERE LOWER(trim(nombre)) = LOWER(trim(v_comercio_name))
    LIMIT 1;
  END IF;

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

  -- Resolver pedido en public.orders con salvaguarda de comercio
  IF NEW.order_id IS NOT NULL AND NEW.order_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id, estado_wms, categoria_entrega, tracking_number, tracking_url, label_url, courier, operador, raw_shopify_data
    INTO v_order_uuid, v_current_wms_status, v_current_cat, v_current_tracking, v_current_url, v_current_label_url, v_current_courier, v_current_operador, v_current_raw_shopify
    FROM public.orders
    WHERE id = NEW.order_id::uuid
    LIMIT 1;
  END IF;

  IF v_order_uuid IS NULL AND v_comercio_name IS NOT NULL AND NEW.order_id IS NOT NULL THEN
    v_clean_ref := regexp_replace(TRIM(NEW.order_id), '^#+', '');
    IF v_sigla IS NOT NULL THEN
      v_clean_ref := regexp_replace(v_clean_ref, '^' || v_sigla || '[#\-_]?', '', 'i');
    END IF;
    v_clean_ref := regexp_replace(v_clean_ref, '^[A-Za-z]{2,5}', '');

    SELECT o.id, o.estado_wms, o.categoria_entrega, o.tracking_number, o.tracking_url, o.label_url, o.courier, o.operador, o.raw_shopify_data
    INTO v_order_uuid, v_current_wms_status, v_current_cat, v_current_tracking, v_current_url, v_current_label_url, v_current_courier, v_current_operador, v_current_raw_shopify
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

  IF v_order_uuid IS NULL AND v_comercio_name IS NOT NULL AND NEW.id IS NOT NULL THEN
    SELECT o.id, o.estado_wms, o.categoria_entrega, o.tracking_number, o.tracking_url, o.label_url, o.courier, o.operador, o.raw_shopify_data
    INTO v_order_uuid, v_current_wms_status, v_current_cat, v_current_tracking, v_current_url, v_current_label_url, v_current_courier, v_current_operador, v_current_raw_shopify
    FROM public.orders o
    LEFT JOIN public.profiles p ON p.id = o.merchant_id
    WHERE (
          LOWER(trim(o.comercio)) = LOWER(trim(v_comercio_name))
       OR LOWER(trim(v_comercio_name)) = ANY(string_to_array(regexp_replace(LOWER(p.comercio), '\s*,\s*', ',', 'g'), ','))
    )
    AND o.enviame_delivery_id = NEW.id
    LIMIT 1;
  END IF;

  -- Protecciones: no tocar pedidos cerrados ni categoría RETIRO
  IF v_order_uuid IS NULL
     OR COALESCE(v_current_wms_status, '') IN ('Entregado', 'Listo para retiro')
     OR UPPER(TRIM(COALESCE(v_current_cat, ''))) = 'RETIRO' THEN
    RETURN NEW;
  END IF;

  -- Verificar tracking fijado (wms_forced_tracking)
  v_forced_active := COALESCE((v_current_raw_shopify->'wms_forced_tracking'->>'active')::boolean, FALSE);
  v_forced_track := NULLIF(TRIM(v_current_raw_shopify->'wms_forced_tracking'->>'tracking_number'), '');
  IF v_forced_active AND v_forced_track IS NOT NULL THEN
    IF v_clean_tracking IS NULL OR UPPER(v_forced_track) <> UPPER(v_clean_tracking) THEN
      v_has_diff_forced := TRUE;
    END IF;
  END IF;

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
  ELSIF v_courier_upper <> '' THEN
    v_target_operador := v_courier_upper;
  ELSE
    v_target_operador := 'STOCKA';
  END IF;

  IF v_has_diff_forced THEN
    -- Solo actualizar metadatos Envíame y label_url válida sin tocar tracking/courier fijado
    UPDATE public.orders
    SET
      label_url = CASE
        WHEN v_clean_label_url IS NOT NULL THEN v_clean_label_url
        WHEN v_current_label_url IS NOT NULL AND TRIM(v_current_label_url) !~* '^https?://' THEN NULL
        ELSE label_url
      END,
      enviame_delivery_id = COALESCE(NEW.id, enviame_delivery_id),
      enviame_status = COALESCE(NEW.status, enviame_status)
    WHERE id = v_order_uuid
      AND estado_wms NOT IN ('Entregado', 'Listo para retiro');
  ELSE
    UPDATE public.orders
    SET
      tracking_number = COALESCE(
        v_clean_tracking,
        CASE
          WHEN UPPER(TRIM(COALESCE(v_current_tracking, ''))) IN ('NO INFORMADO', 'NOINFORMADO', 'NULL', 'UNDEFINED', 'N/A', '-', 'SIN INFORMACION', 'SIN INFORMACIÓN') THEN NULL
          ELSE tracking_number
        END
      ),
      tracking_url = CASE
        WHEN v_clean_tracking IS NOT NULL AND TRIM(COALESCE(v_current_tracking, '')) = TRIM(v_clean_tracking)
             AND v_current_url IS NOT NULL AND TRIM(v_current_url) ~* '^https?://'
             AND v_current_url !~* '(no\s*informado|no%20informado)'
        THEN v_current_url
        WHEN v_clean_tracking_url IS NOT NULL THEN v_clean_tracking_url
        WHEN v_current_url IS NOT NULL AND v_current_url ~* '(no\s*informado|no%20informado)' THEN NULL
        ELSE tracking_url
      END,
      label_url = CASE
        WHEN v_clean_label_url IS NOT NULL THEN v_clean_label_url
        WHEN v_current_label_url IS NOT NULL AND TRIM(v_current_label_url) !~* '^https?://' THEN NULL
        ELSE label_url
      END,
      courier = COALESCE(NULLIF(TRIM(NEW.courier), ''), courier),
      operador = COALESCE(v_target_operador, operador),
      enviame_delivery_id = COALESCE(NEW.id, enviame_delivery_id),
      enviame_status = COALESCE(NEW.status, enviame_status)
    WHERE id = v_order_uuid
      AND estado_wms NOT IN ('Entregado', 'Listo para retiro');
  END IF;

  RETURN NEW;
END;
$function$;


-- =========================================================================================
-- 2. SANITIZAR tracking_url EN public.sync_enviame_to_unified()
-- =========================================================================================
CREATE OR REPLACE FUNCTION public.sync_enviame_to_unified()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_clean_tracking TEXT;
  v_clean_tracking_url TEXT;
  v_courier_upper TEXT := UPPER(TRIM(COALESCE(NEW.courier, '')));
BEGIN
  v_global_status := public.get_global_status('enviame_shipments', NEW.status);

  -- Validar tracking y URL para evitar guardar '.../No informado/tracking'
  v_clean_tracking := NULLIF(TRIM(NEW.tracking_number), '');
  IF v_clean_tracking IS NOT NULL AND UPPER(v_clean_tracking) IN ('NO INFORMADO', 'NOINFORMADO', 'NULL', 'UNDEFINED', 'N/A', '-', 'SIN INFORMACION', 'SIN INFORMACIÓN') THEN
    v_clean_tracking := NULL;
  END IF;

  v_clean_tracking_url := NULLIF(TRIM(NEW.tracking_url), '');
  IF v_clean_tracking IS NULL OR v_clean_tracking_url IS NULL
     OR v_clean_tracking_url !~* '^https?://'
     OR v_clean_tracking_url ~* '(no\s*informado|no%20informado)' THEN
    v_clean_tracking_url := NULL;
  END IF;

  IF v_clean_tracking IS NOT NULL AND v_clean_tracking_url IS NULL THEN
    IF v_courier_upper LIKE '%STARKEN%' THEN
      v_clean_tracking_url := 'https://www.starken.cl/seguimiento?codigo=' || v_clean_tracking;
    ELSIF v_courier_upper LIKE '%BLUE%' OR v_courier_upper = 'BX' THEN
      v_clean_tracking_url := 'https://tracking-unificado.blue.cl/?n_seguimiento=' || v_clean_tracking;
    ELSIF v_courier_upper LIKE '%CHILEXPRESS%' OR v_courier_upper = 'CXP' THEN
      v_clean_tracking_url := 'https://www.chilexpress.cl/seguimiento-envio?numero=' || v_clean_tracking;
    END IF;
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

  -- E. Fallback Secundario: Resolver comercio mediante la sigla inicial en el order_id
  IF v_comercio_name IS NULL AND NEW.order_id IS NOT NULL THEN
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
      SELECT o.id, o.external_order_number INTO v_order_uuid, v_pedido_ref
      FROM public.orders o
      LEFT JOIN public.profiles p ON p.id = o.merchant_id
      WHERE (LOWER(trim(o.comercio)) = LOWER(trim(v_comercio_name))
         OR LOWER(trim(v_comercio_name)) = ANY(string_to_array(regexp_replace(LOWER(p.comercio), '\s*,\s*', ',', 'g'), ',')))
        AND o.external_order_number = NEW.order_id
      LIMIT 1;

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

    IF v_order_uuid IS NULL THEN
      SELECT id, external_order_number INTO v_order_uuid, v_pedido_ref FROM public.orders WHERE external_order_number = NEW.order_id LIMIT 1;
    END IF;
  END IF;

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
    COALESCE(v_clean_tracking, 'No informado'),
    v_clean_tracking_url,
    NEW.courier,
    NEW.status,
    v_global_status,
    COALESCE(NEW.enviame_created_at, NEW.created_at),
    COALESCE(NEW.updated_at, NEW.enviame_updated_at, NOW()),
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
$function$;


-- =========================================================================================
-- 3. BLINDAR public.sync_unified_status_to_orders_func()
--    - Nunca escribe 'No informado' ni URLs inválidas en orders
--    - Respeta Entregado, Listo para retiro, RETIRO y wms_forced_tracking
-- =========================================================================================
CREATE OR REPLACE FUNCTION public.sync_unified_status_to_orders_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order_uuid UUID;
  v_current_wms_status TEXT;
  v_current_cat TEXT;
  v_current_track TEXT;
  v_current_url TEXT;
  v_current_raw_shopify JSONB;
  v_forced_active BOOLEAN := FALSE;
  v_forced_track TEXT;
  v_target_operador TEXT;
  v_courier_upper TEXT;
  v_effective_tracking TEXT;
  v_clean_url TEXT;
BEGIN
  IF NEW.pedido_referencia IS NULL THEN
    RETURN NEW;
  END IF;

  v_courier_upper := UPPER(TRIM(COALESCE(NEW.courier, '')));
  IF v_courier_upper ~ '(RECIBELO|RECÍBELO|WELIVERY|WOODELIVERY|WODELY)' THEN
    RETURN NEW;
  END IF;

  IF NEW.source_table = 'lightdata_envios' THEN
    v_effective_tracking := COALESCE(NULLIF(TRIM(NEW.source_id), ''), NULLIF(TRIM(NEW.tracking), ''));
  ELSE
    v_effective_tracking := NULLIF(TRIM(NEW.tracking), '');
  END IF;

  -- Filtrar literales no válidos para nunca contaminar orders.tracking_number
  IF v_effective_tracking IS NOT NULL THEN
    IF UPPER(v_effective_tracking) IN ('NO INFORMADO', 'NOINFORMADO', 'NULL', 'UNDEFINED', 'N/A', '-', 'SIN INFORMACION', 'SIN INFORMACIÓN')
       OR (NEW.source_table = 'enviame_shipments' AND v_effective_tracking ~ '^46[0-9]{6,}$') THEN
      v_effective_tracking := NULL;
    END IF;
  END IF;

  v_clean_url := NULLIF(TRIM(NEW.tracking_url), '');
  IF v_effective_tracking IS NULL OR v_clean_url IS NULL
     OR v_clean_url !~* '^https?://'
     OR v_clean_url ~* '(no\s*informado|no%20informado)' THEN
    v_clean_url := NULL;
  END IF;

  -- Si no hay tracking válido, no sobrescribir orders
  IF v_effective_tracking IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.pedido_referencia ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id, estado_wms, categoria_entrega, tracking_number, tracking_url, raw_shopify_data
    INTO v_order_uuid, v_current_wms_status, v_current_cat, v_current_track, v_current_url, v_current_raw_shopify
    FROM public.orders WHERE id = NEW.pedido_referencia::uuid;
  ELSE
    SELECT id, estado_wms, categoria_entrega, tracking_number, tracking_url, raw_shopify_data
    INTO v_order_uuid, v_current_wms_status, v_current_cat, v_current_track, v_current_url, v_current_raw_shopify
    FROM public.orders
    WHERE external_order_number = NEW.pedido_referencia
      AND (
        NEW.empresa_comercio_proveedor IS NULL
        OR UPPER(TRIM(NEW.empresa_comercio_proveedor)) IN ('', 'NO ASIGNADO', 'STOCKA')
        OR LOWER(TRIM(comercio)) = LOWER(TRIM(NEW.empresa_comercio_proveedor))
      )
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  IF v_order_uuid IS NULL
     OR COALESCE(v_current_wms_status, '') IN ('Entregado', 'Listo para retiro')
     OR UPPER(TRIM(COALESCE(v_current_cat, ''))) = 'RETIRO' THEN
    RETURN NEW;
  END IF;

  -- Respetar tracking fijado manualmente
  v_forced_active := COALESCE((v_current_raw_shopify->'wms_forced_tracking'->>'active')::boolean, FALSE);
  v_forced_track := NULLIF(TRIM(v_current_raw_shopify->'wms_forced_tracking'->>'tracking_number'), '');
  IF v_forced_active AND v_forced_track IS NOT NULL AND UPPER(v_forced_track) <> UPPER(v_effective_tracking) THEN
    RETURN NEW;
  END IF;

  IF v_courier_upper LIKE '%STARKEN%' THEN v_target_operador := 'STARKEN';
  ELSIF v_courier_upper LIKE '%BLUE%' THEN v_target_operador := 'BLUEXPRESS';
  ELSIF v_courier_upper LIKE '%CHILEXPRESS%' THEN v_target_operador := 'CHILEXPRESS';
  ELSIF v_courier_upper LIKE '%ENVIAME%' THEN v_target_operador := 'ENVIAME';
  ELSIF v_courier_upper LIKE '%ALPHA%' OR v_courier_upper LIKE '%LIGHTDATA%' OR v_courier_upper LIKE '%CARRIER EXTERNO%' THEN v_target_operador := 'ALPHA';
  ELSIF v_courier_upper LIKE '%FALABELLA%' THEN v_target_operador := 'FALABELLA';
  ELSIF v_courier_upper LIKE '%MERCADO%' THEN v_target_operador := 'MERCADOLIBRE';
  ELSE v_target_operador := v_courier_upper;
  END IF;

  IF NEW.global_status = 'DESPACHADO'
     OR v_current_track IS NULL
     OR TRIM(v_current_track) = ''
     OR UPPER(TRIM(v_current_track)) IN ('NO INFORMADO', 'NOINFORMADO', 'NULL', 'UNDEFINED', 'N/A', '-') THEN
    UPDATE public.orders
    SET
      tracking_number = v_effective_tracking,
      tracking_url = CASE
        WHEN TRIM(COALESCE(v_current_track, '')) = TRIM(v_effective_tracking)
             AND v_current_url IS NOT NULL AND TRIM(v_current_url) ~* '^https?://'
             AND v_current_url !~* '(no\s*informado|no%20informado)'
        THEN v_current_url
        ELSE COALESCE(v_clean_url, tracking_url)
      END,
      courier = COALESCE(NULLIF(TRIM(NEW.courier), ''), courier),
      operador = COALESCE(NULLIF(TRIM(v_target_operador), ''), operador)
    WHERE id = v_order_uuid
      AND estado_wms NOT IN ('Entregado', 'Listo para retiro')
      AND (
        COALESCE(tracking_number, '') IS DISTINCT FROM v_effective_tracking
        OR ((v_current_url IS NULL OR v_current_url ~* '(no\s*informado|no%20informado)') AND v_clean_url IS NOT NULL)
      );
  END IF;

  RETURN NEW;
END;
$function$;


-- =========================================================================================
-- 4. LIMPIEZA RETROACTIVA DE REGISTROS CONTAMINADOS (label_url JSON y tracking_url 'No informado')
-- =========================================================================================
UPDATE public.orders
SET label_url = NULL
WHERE label_url IS NOT NULL
  AND TRIM(label_url) <> ''
  AND TRIM(label_url) !~* '^https?://'
  AND COALESCE(estado_wms, '') <> 'Entregado';

UPDATE public.orders
SET tracking_url = NULL
WHERE tracking_url IS NOT NULL
  AND tracking_url ~* '(no\s*informado|no%20informado)'
  AND COALESCE(estado_wms, '') <> 'Entregado';

UPDATE public.orders
SET tracking_number = NULL
WHERE tracking_number IS NOT NULL
  AND UPPER(TRIM(tracking_number)) IN ('NO INFORMADO', 'NOINFORMADO', 'NULL', 'UNDEFINED', 'N/A', '-', 'SIN INFORMACION', 'SIN INFORMACIÓN')
  AND COALESCE(estado_wms, '') <> 'Entregado';

UPDATE public.envios_unificados
SET tracking_url = NULL
WHERE tracking_url IS NOT NULL
  AND tracking_url ~* '(no\s*informado|no%20informado)'
  AND created_at >= NOW() - INTERVAL '30 days';

UPDATE public.enviame_shipments
SET label_url = NULL,
    tracking_url = CASE
      WHEN tracking_url ~* '(no\s*informado|no%20informado)' THEN NULL
      ELSE tracking_url
    END
WHERE created_at >= NOW() - INTERVAL '30 days'
  AND (
    (label_url IS NOT NULL AND TRIM(label_url) <> '' AND TRIM(label_url) !~* '^https?://')
    OR tracking_url ~* '(no\s*informado|no%20informado)'
  );


-- =========================================================================================
-- 5. HABILITAR SUPABASE REALTIME PARA orders Y envios_unificados (Torre de Control en vivo)
-- =========================================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'envios_unificados'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.envios_unificados;
  END IF;
END $$;


-- =========================================================================================
-- 6. POLLER AUTOMÁTICO pg_cron CADA 5 MINUTOS -> Edge Function enviame-webhook
--    Respaldo independiente de GitHub Actions y Google Apps Script.
--    Lee el secreto 'enviame_poller_secret' desde Supabase Vault (sin hardcodear tokens).
-- =========================================================================================
CREATE OR REPLACE FUNCTION public.poll_enviame_pending_trackings()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_secret TEXT;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'enviame_poller_secret'
  LIMIT 1;

  IF v_secret IS NULL OR TRIM(v_secret) = '' THEN
    RAISE WARNING 'poll_enviame_pending_trackings: secreto enviame_poller_secret no encontrado en vault.secrets';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://ejtjfaucnxbikrwjwwdu.supabase.co/functions/v1/enviame-webhook',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-poller-secret', v_secret
    ),
    body := jsonb_build_object(
      'mode', 'poll_pending',
      'pending_limit', 25,
      'store_batch_size', 6
    ),
    timeout_milliseconds := 25000
  );
END;
$function$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'enviame-tracking-poller-5m') THEN
    PERFORM cron.unschedule('enviame-tracking-poller-5m');
  END IF;
  PERFORM cron.schedule(
    'enviame-tracking-poller-5m',
    '*/5 * * * *',
    'SELECT public.poll_enviame_pending_trackings()'
  );
END $$;
