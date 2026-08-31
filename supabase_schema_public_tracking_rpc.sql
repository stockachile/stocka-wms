-- ========================================================
-- WMS STOCKA: RPC Segura con Coincidencia Flexible de Prefijos
-- ========================================================

-- 1. Eliminar versiones anteriores sobrecargadas para evitar conflicto
DROP FUNCTION IF EXISTS public.get_customer_tracking(text, text);
DROP FUNCTION IF EXISTS public.get_customer_tracking(text, text, text);
DROP FUNCTION IF EXISTS public.get_customer_tracking;

-- 2. Crear la función actualizada con soporte de prefijos y validación cruzada
CREATE OR REPLACE FUNCTION public.get_customer_tracking(
  p_email text DEFAULT NULL,
  p_order_number text DEFAULT NULL,
  p_courier_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_results jsonb;
  v_clean_email text := LOWER(TRIM(COALESCE(p_email, '')));
  v_clean_order text := TRIM(COALESCE(p_order_number, ''));
  v_clean_courier text := TRIM(COALESCE(p_courier_code, ''));
  v_num_only text;
BEGIN
  -- Limpiar prefijo '#' si fue ingresado
  IF LEFT(v_clean_order, 1) = '#' THEN
    v_clean_order := SUBSTRING(v_clean_order FROM 2);
  END IF;

  -- Extraer solo dígitos de la orden para comparación numérica flexible
  v_num_only := regexp_replace(v_clean_order, '[^0-9]', '', 'g');

  -- 1. Validación Cruzada (Orden + Correo con soporte de prefijos)
  IF v_clean_email <> '' AND v_clean_order <> '' THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'order_number', COALESCE(o.external_order_number, o.id::text),
        'comercio', COALESCE(o.comercio, 'Tienda Asociada Stocka'),
        'customer_name', COALESCE(o.customer_name, 'Cliente'),
        'customer_email', o.customer_email,
        'status', COALESCE(o.estado_wms, o.status, 'En Proceso'),
        'tracking_number', o.tracking_number,
        'tracking_url', o.tracking_url,
        'courier', COALESCE(o.operador, o.courier, 'Stocka Same Day / Courier'),
        'categoria_entrega', COALESCE(o.categoria_entrega, 'DISTRIBUCIÓN'),
        'shipping_city', o.shipping_city,
        'created_at', o.created_at
      ) ORDER BY o.created_at DESC
    ), '[]'::jsonb)
    INTO v_results
    FROM public.orders o
    WHERE 
      LOWER(TRIM(COALESCE(o.customer_email, ''))) = v_clean_email
      AND (
        -- Coincidencia exacta
        LOWER(TRIM(COALESCE(o.external_order_number, ''))) = LOWER(v_clean_order)
        -- Coincidencia con prefijo en BD (ej: DB tiene "MED-10452" y usuario busca "10452")
        OR LOWER(TRIM(COALESCE(o.external_order_number, ''))) ILIKE '%' || LOWER(v_clean_order)
        -- Coincidencia numérica (ignora letras de prefijos)
        OR (LENGTH(v_num_only) >= 3 AND regexp_replace(COALESCE(o.external_order_number, ''), '[^0-9]', '', 'g') = v_num_only)
        -- Coincidencia por UUID interno
        OR o.id::text = v_clean_order
      )
    LIMIT 10;

  -- 2. Solo Correo Electrónico
  ELSIF v_clean_email <> '' AND v_clean_order = '' AND v_clean_courier = '' THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'order_number', COALESCE(o.external_order_number, o.id::text),
        'comercio', COALESCE(o.comercio, 'Tienda Asociada Stocka'),
        'customer_name', COALESCE(o.customer_name, 'Cliente'),
        'customer_email', o.customer_email,
        'status', COALESCE(o.estado_wms, o.status, 'En Proceso'),
        'tracking_number', o.tracking_number,
        'tracking_url', o.tracking_url,
        'courier', COALESCE(o.operador, o.courier, 'Stocka Same Day / Courier'),
        'categoria_entrega', COALESCE(o.categoria_entrega, 'DISTRIBUCIÓN'),
        'shipping_city', o.shipping_city,
        'created_at', o.created_at
      ) ORDER BY o.created_at DESC
    ), '[]'::jsonb)
    INTO v_results
    FROM public.orders o
    WHERE LOWER(TRIM(COALESCE(o.customer_email, ''))) = v_clean_email
    LIMIT 10;

  -- 3. Solo Código de Courier (Starken, Blue, Chilexpress)
  ELSIF v_clean_courier <> '' THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'order_number', COALESCE(o.external_order_number, o.id::text),
        'comercio', COALESCE(o.comercio, 'Tienda Asociada Stocka'),
        'customer_name', COALESCE(o.customer_name, 'Cliente'),
        'customer_email', o.customer_email,
        'status', COALESCE(o.estado_wms, o.status, 'En Proceso'),
        'tracking_number', o.tracking_number,
        'tracking_url', o.tracking_url,
        'courier', COALESCE(o.operador, o.courier, 'Stocka Same Day / Courier'),
        'categoria_entrega', COALESCE(o.categoria_entrega, 'DISTRIBUCIÓN'),
        'shipping_city', o.shipping_city,
        'created_at', o.created_at
      ) ORDER BY o.created_at DESC
    ), '[]'::jsonb)
    INTO v_results
    FROM public.orders o
    WHERE 
      LOWER(TRIM(COALESCE(o.tracking_number, ''))) = LOWER(v_clean_courier)
      OR LOWER(TRIM(COALESCE(o.tracking_number, ''))) ILIKE '%' || LOWER(v_clean_courier)
    LIMIT 10;

  ELSE
    RETURN '[]'::jsonb;
  END IF;

  RETURN v_results;
END;
$$;

-- 3. Conceder permisos con especificación explícita de argumentos
GRANT EXECUTE ON FUNCTION public.get_customer_tracking(text, text, text) TO anon, authenticated;
