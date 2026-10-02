-- ========================================================
-- WMS STOCKA: RPC get_customer_tracking con Picking Seguro y Rastreo Directo Optiroute
-- ========================================================

DROP FUNCTION IF EXISTS public.get_customer_tracking(text, text, text, text);
DROP FUNCTION IF EXISTS public.get_customer_tracking;

CREATE OR REPLACE FUNCTION public.get_customer_tracking(
  p_email text DEFAULT NULL,
  p_order_number text DEFAULT NULL,
  p_courier_code text DEFAULT NULL,
  p_token text DEFAULT NULL
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
  v_clean_token text := LOWER(TRIM(COALESCE(p_token, '')));
  v_token_uuid uuid := NULL;
  v_formatted_token text;
  v_num_only text;
BEGIN
  -- 0. Parsear Token si fue proporcionado
  IF v_clean_token <> '' THEN
    IF v_clean_token ~ '^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$' THEN
      v_formatted_token := replace(v_clean_token, '-', '');
      v_formatted_token := SUBSTRING(v_formatted_token FROM 1 FOR 8) || '-' ||
                           SUBSTRING(v_formatted_token FROM 9 FOR 4) || '-' ||
                           SUBSTRING(v_formatted_token FROM 13 FOR 4) || '-' ||
                           SUBSTRING(v_formatted_token FROM 17 FOR 4) || '-' ||
                           SUBSTRING(v_formatted_token FROM 21 FOR 12);
      BEGIN
        v_token_uuid := v_formatted_token::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_token_uuid := NULL;
      END;
    END IF;

    -- Rama A: Token UUID
    IF v_token_uuid IS NOT NULL THEN
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'order_number', COALESCE(o.external_order_number, o.id::text),
          'comercio', COALESCE(o.comercio, 'Tienda Asociada Stocka'),
          'customer_name', COALESCE(o.customer_name, 'Cliente'),
          'customer_email', CASE
            WHEN o.customer_email IS NOT NULL AND position('@' in o.customer_email) > 2 THEN
              SUBSTRING(o.customer_email FROM 1 FOR 2) || '***@' || split_part(o.customer_email, '@', 2)
            ELSE '***'
          END,
          'status', CASE
            WHEN LOWER(COALESCE(o.lightdata_status, '')) LIKE '%entregad%' 
              OR LOWER(COALESCE(o.raw_lightdata_data->>'status', '')) LIKE '%entregad%'
              OR LOWER(COALESCE(o.bluex_status, '')) LIKE '%entregad%'
              OR LOWER(COALESCE(o.bluex_status, '')) LIKE '%delivered%'
              OR LOWER(COALESCE(o.starken_status, '')) LIKE '%entregad%'
              OR LOWER(COALESCE(o.optiroute_status, '')) LIKE '%entregad%'
              OR LOWER(COALESCE(o.optiroute_status, '')) LIKE '%completed%'
              OR LOWER(COALESCE(o.optiroute_status, '')) LIKE '%delivered%'
              OR LOWER(COALESCE(opti.opti_status, '')) LIKE '%delivered%'
              OR LOWER(COALESCE(opti.opti_status, '')) LIKE '%entregad%'
              OR LOWER(COALESCE(o.enviame_status, '')) LIKE '%entregad%'
              OR LOWER(COALESCE(o.enviame_status, '')) LIKE '%delivered%'
              OR EXISTS (
                SELECT 1 FROM public.envios_unificados eu
                WHERE (eu.pedido_referencia = o.external_order_number OR (o.tracking_number IS NOT NULL AND o.tracking_number <> '' AND eu.tracking = o.tracking_number))
                  AND (LOWER(eu.status) LIKE '%entregad%' OR LOWER(eu.status) = 'delivered')
              ) THEN 'Entregado'
            WHEN LOWER(COALESCE(o.estado_wms, '')) LIKE '%incidenc%' 
              OR LOWER(COALESCE(o.lightdata_status, '')) LIKE '%incidenc%' THEN 'Incidencia'
            WHEN LOWER(COALESCE(o.estado_wms, '')) LIKE '%cancel%' 
              OR LOWER(COALESCE(o.status, '')) LIKE '%cancel%' THEN 'Cancelado'
            WHEN (o.categoria_entrega = 'RETIRO' OR o.operador ILIKE '%RETIRO%') 
              AND LOWER(COALESCE(o.estado_wms, '')) LIKE '%listo%' THEN 'Listo para retiro'
            ELSE COALESCE(o.estado_wms, o.status, 'En Proceso')
          END,
          'tracking_number', COALESCE(
            NULLIF(NULLIF(o.tracking_number, 'No informado'), ''),
            (SELECT eu.tracking FROM public.envios_unificados eu WHERE eu.pedido_referencia = o.external_order_number AND eu.tracking IS NOT NULL AND eu.tracking <> 'No informado' LIMIT 1),
            o.tracking_number
          ),
          'tracking_url', COALESCE(
            o.tracking_url,
            (SELECT eu.tracking_url FROM public.envios_unificados eu WHERE eu.pedido_referencia = o.external_order_number AND eu.tracking_url IS NOT NULL AND eu.tracking_url <> '' LIMIT 1)
          ),
          'courier', COALESCE(o.operador, o.courier, 'Stocka Same Day / Courier'),
          'categoria_entrega', COALESCE(o.categoria_entrega, 'DISTRIBUCIÓN'),
          'shipping_city', o.shipping_city,
          'created_at', o.created_at,
          'delivered_at', CASE
            WHEN LOWER(COALESCE(o.lightdata_status, '')) LIKE '%entregad%' THEN COALESCE(o.raw_lightdata_data->>'fecha_actualizacion_lightdata', o.raw_lightdata_data->>'updated_at')
            WHEN opti.opti_completed_at IS NOT NULL THEN opti.opti_completed_at
            ELSE (
              SELECT eu.updated_at::text 
              FROM public.envios_unificados eu 
              WHERE (eu.pedido_referencia = o.external_order_number OR (o.tracking_number IS NOT NULL AND eu.tracking = o.tracking_number))
                AND (LOWER(eu.status) LIKE '%entregad%' OR LOWER(eu.status) = 'delivered')
              LIMIT 1
            )
          END,
          'picking_info', jsonb_build_object(
            'warehouse', COALESCE(o.sucursal_pickeo, 'Centro de Distribución Stocka'),
            'status', COALESCE(
            o.picker_status,
            CASE 
              WHEN LOWER(COALESCE(o.estado_wms, '')) IN ('despachado', 'pickeado')
                OR LOWER(COALESCE(o.status, '')) IN ('despachado', 'preparado') THEN 'Completado'
              WHEN LOWER(COALESCE(o.estado_wms, '')) LIKE '%prep%'
                OR LOWER(COALESCE(o.status, '')) LIKE '%prep%' THEN 'En preparación'
              ELSE 'En proceso'
            END
          ),
          'picked_at', COALESCE(
            o.picker_last_synced_at::text,
            o.stock_descontado_at::text,
            CASE 
              WHEN LOWER(COALESCE(o.estado_wms, '')) IN ('despachado', 'pickeado')
                OR LOWER(COALESCE(o.status, '')) IN ('despachado', 'preparado')
              THEN COALESCE(o.raw_shopify_data->>'updated_at', o.created_at::text)
              ELSE NULL
            END
          ),
            'scanned_label', o.picker_scanned_label,
            'total_units', (SELECT COALESCE(sum(quantity), 0) FROM public.order_items oi WHERE oi.order_id = o.id),
            'items', (
              SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                  'name', COALESCE(p.name, 'Producto'),
                  'quantity', oi.quantity,
                  'sku', p.sku,
                  'barcode', COALESCE(NULLIF(p.barcode, ''), NULLIF(p.barcode_wms, ''), p.sku)
                )
              ), '[]'::jsonb)
              FROM public.order_items oi
              LEFT JOIN public.products p ON p.id = oi.product_id
              WHERE oi.order_id = o.id
            )
          ),
          'optiroute_info', jsonb_build_object(
            'is_optiroute', (opti.opti_status IS NOT NULL OR o.operador ILIKE '%STOCKA%' OR o.courier ILIKE '%OPTIROUTE%' OR o.operador ILIKE '%SAME DAY%'),
            'status_title', COALESCE(opti.opti_status_title, opti.opti_status, CASE WHEN o.estado_wms = 'Despachado' THEN 'En Ruta' ELSE o.estado_wms END),
            'service_type', COALESCE(opti.opti_service_type, 'Stocka Express (Same Day / 24 hrs)'),
            'vehicle', opti.opti_vehicle,
            'route_started_at', opti.opti_route_started_at,
            'delivered_at', opti.opti_completed_at,
            'reception_name', opti.opti_reception_name,
            'proof_image', opti.proof_image
          )
        )
      ), '[]'::jsonb)
      INTO v_results
      FROM public.orders o
      LEFT JOIN LATERAL (
        SELECT 
          opt.status as opti_status,
          opt.servicio_tipo_envio as opti_service_type,
          opt.raw_data->'assigned_vehicle'->>'name' as opti_vehicle,
          opt.raw_data->>'route_started_at' as opti_route_started_at,
          opt.raw_data->>'completed_at' as opti_completed_at,
          opt.raw_data->>'status_title' as opti_status_title,
          COALESCE(opt.raw_data->'images'->0->>'url', opt.raw_data->'waypoint'->'images'->0->>'url') as proof_image,
          opt.raw_data->'waypoint'->>'reception_name' as opti_reception_name
        FROM public.optiroute_orders opt
        WHERE (opt.referencia = o.external_order_number 
           OR (o.tracking_number IS NOT NULL AND o.tracking_number <> '' AND opt.tracking = o.tracking_number))
        ORDER BY opt.created_at DESC
        LIMIT 1
      ) opti ON TRUE
      WHERE o.id = v_token_uuid;

      RETURN v_results;

    ELSE
      -- Rama B: Token Shopify
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'order_number', COALESCE(o.external_order_number, o.id::text),
          'comercio', COALESCE(o.comercio, 'Tienda Asociada Stocka'),
          'customer_name', COALESCE(o.customer_name, 'Cliente'),
          'customer_email', CASE
            WHEN o.customer_email IS NOT NULL AND position('@' in o.customer_email) > 2 THEN
              SUBSTRING(o.customer_email FROM 1 FOR 2) || '***@' || split_part(o.customer_email, '@', 2)
            ELSE '***'
          END,
          'status', CASE
            WHEN LOWER(COALESCE(o.lightdata_status, '')) LIKE '%entregad%' 
              OR LOWER(COALESCE(o.raw_lightdata_data->>'status', '')) LIKE '%entregad%'
              OR LOWER(COALESCE(o.bluex_status, '')) LIKE '%entregad%'
              OR LOWER(COALESCE(o.bluex_status, '')) LIKE '%delivered%'
              OR LOWER(COALESCE(o.starken_status, '')) LIKE '%entregad%'
              OR LOWER(COALESCE(o.optiroute_status, '')) LIKE '%entregad%'
              OR LOWER(COALESCE(o.optiroute_status, '')) LIKE '%completed%'
              OR LOWER(COALESCE(o.optiroute_status, '')) LIKE '%delivered%'
              OR LOWER(COALESCE(opti.opti_status, '')) LIKE '%delivered%'
              OR LOWER(COALESCE(opti.opti_status, '')) LIKE '%entregad%'
              OR LOWER(COALESCE(o.enviame_status, '')) LIKE '%entregad%'
              OR LOWER(COALESCE(o.enviame_status, '')) LIKE '%delivered%'
              OR EXISTS (
                SELECT 1 FROM public.envios_unificados eu
                WHERE (eu.pedido_referencia = o.external_order_number OR (o.tracking_number IS NOT NULL AND o.tracking_number <> '' AND eu.tracking = o.tracking_number))
                  AND (LOWER(eu.status) LIKE '%entregad%' OR LOWER(eu.status) = 'delivered')
              ) THEN 'Entregado'
            WHEN LOWER(COALESCE(o.estado_wms, '')) LIKE '%incidenc%' 
              OR LOWER(COALESCE(o.lightdata_status, '')) LIKE '%incidenc%' THEN 'Incidencia'
            WHEN LOWER(COALESCE(o.estado_wms, '')) LIKE '%cancel%' 
              OR LOWER(COALESCE(o.status, '')) LIKE '%cancel%' THEN 'Cancelado'
            WHEN (o.categoria_entrega = 'RETIRO' OR o.operador ILIKE '%RETIRO%') 
              AND LOWER(COALESCE(o.estado_wms, '')) LIKE '%listo%' THEN 'Listo para retiro'
            ELSE COALESCE(o.estado_wms, o.status, 'En Proceso')
          END,
          'tracking_number', COALESCE(
            NULLIF(NULLIF(o.tracking_number, 'No informado'), ''),
            (SELECT eu.tracking FROM public.envios_unificados eu WHERE eu.pedido_referencia = o.external_order_number AND eu.tracking IS NOT NULL AND eu.tracking <> 'No informado' LIMIT 1),
            o.tracking_number
          ),
          'tracking_url', COALESCE(
            o.tracking_url,
            (SELECT eu.tracking_url FROM public.envios_unificados eu WHERE eu.pedido_referencia = o.external_order_number AND eu.tracking_url IS NOT NULL AND eu.tracking_url <> '' LIMIT 1)
          ),
          'courier', COALESCE(o.operador, o.courier, 'Stocka Same Day / Courier'),
          'categoria_entrega', COALESCE(o.categoria_entrega, 'DISTRIBUCIÓN'),
          'shipping_city', o.shipping_city,
          'created_at', o.created_at,
          'delivered_at', CASE
            WHEN LOWER(COALESCE(o.lightdata_status, '')) LIKE '%entregad%' THEN COALESCE(o.raw_lightdata_data->>'fecha_actualizacion_lightdata', o.raw_lightdata_data->>'updated_at')
            WHEN opti.opti_completed_at IS NOT NULL THEN opti.opti_completed_at
            ELSE (
              SELECT eu.updated_at::text 
              FROM public.envios_unificados eu 
              WHERE (eu.pedido_referencia = o.external_order_number OR (o.tracking_number IS NOT NULL AND eu.tracking = o.tracking_number))
                AND (LOWER(eu.status) LIKE '%entregad%' OR LOWER(eu.status) = 'delivered')
              LIMIT 1
            )
          END,
          'picking_info', jsonb_build_object(
            'warehouse', COALESCE(o.sucursal_pickeo, 'Centro de Distribución Stocka'),
            'status', COALESCE(
            o.picker_status,
            CASE 
              WHEN LOWER(COALESCE(o.estado_wms, '')) IN ('despachado', 'pickeado')
                OR LOWER(COALESCE(o.status, '')) IN ('despachado', 'preparado') THEN 'Completado'
              WHEN LOWER(COALESCE(o.estado_wms, '')) LIKE '%prep%'
                OR LOWER(COALESCE(o.status, '')) LIKE '%prep%' THEN 'En preparación'
              ELSE 'En proceso'
            END
          ),
          'picked_at', COALESCE(
            o.picker_last_synced_at::text,
            o.stock_descontado_at::text,
            CASE 
              WHEN LOWER(COALESCE(o.estado_wms, '')) IN ('despachado', 'pickeado')
                OR LOWER(COALESCE(o.status, '')) IN ('despachado', 'preparado')
              THEN COALESCE(o.raw_shopify_data->>'updated_at', o.created_at::text)
              ELSE NULL
            END
          ),
            'scanned_label', o.picker_scanned_label,
            'total_units', (SELECT COALESCE(sum(quantity), 0) FROM public.order_items oi WHERE oi.order_id = o.id),
            'items', (
              SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                  'name', COALESCE(p.name, 'Producto'),
                  'quantity', oi.quantity,
                  'sku', p.sku,
                  'barcode', COALESCE(NULLIF(p.barcode, ''), NULLIF(p.barcode_wms, ''), p.sku)
                )
              ), '[]'::jsonb)
              FROM public.order_items oi
              LEFT JOIN public.products p ON p.id = oi.product_id
              WHERE oi.order_id = o.id
            )
          ),
          'optiroute_info', jsonb_build_object(
            'is_optiroute', (opti.opti_status IS NOT NULL OR o.operador ILIKE '%STOCKA%' OR o.courier ILIKE '%OPTIROUTE%' OR o.operador ILIKE '%SAME DAY%'),
            'status_title', COALESCE(opti.opti_status_title, opti.opti_status, CASE WHEN o.estado_wms = 'Despachado' THEN 'En Ruta' ELSE o.estado_wms END),
            'service_type', COALESCE(opti.opti_service_type, 'Stocka Express (Same Day / 24 hrs)'),
            'vehicle', opti.opti_vehicle,
            'route_started_at', opti.opti_route_started_at,
            'delivered_at', opti.opti_completed_at,
            'reception_name', opti.opti_reception_name,
            'proof_image', opti.proof_image
          )
        )
      ), '[]'::jsonb)
      INTO v_results
      FROM public.orders o
      LEFT JOIN LATERAL (
        SELECT 
          opt.status as opti_status,
          opt.servicio_tipo_envio as opti_service_type,
          opt.raw_data->'assigned_vehicle'->>'name' as opti_vehicle,
          opt.raw_data->>'route_started_at' as opti_route_started_at,
          opt.raw_data->>'completed_at' as opti_completed_at,
          opt.raw_data->>'status_title' as opti_status_title,
          COALESCE(opt.raw_data->'images'->0->>'url', opt.raw_data->'waypoint'->'images'->0->>'url') as proof_image,
          opt.raw_data->'waypoint'->>'reception_name' as opti_reception_name
        FROM public.optiroute_orders opt
        WHERE (opt.referencia = o.external_order_number 
           OR (o.tracking_number IS NOT NULL AND o.tracking_number <> '' AND opt.tracking = o.tracking_number))
        ORDER BY opt.created_at DESC
        LIMIT 1
      ) opti ON TRUE
      WHERE (o.raw_shopify_data->>'token') = v_clean_token
      LIMIT 1;

      RETURN v_results;
    END IF;
  END IF;

  -- Limpiar prefijo '#' si fue ingresado en número de orden
  IF LEFT(v_clean_order, 1) = '#' THEN
    v_clean_order := SUBSTRING(v_clean_order FROM 2);
  END IF;

  v_num_only := regexp_replace(v_clean_order, '[^0-9]', '', 'g');

  -- 1. Validación Cruzada (Orden + Correo)
  IF v_clean_email <> '' AND v_clean_order <> '' THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'order_number', COALESCE(o.external_order_number, o.id::text),
        'comercio', COALESCE(o.comercio, 'Tienda Asociada Stocka'),
        'customer_name', COALESCE(o.customer_name, 'Cliente'),
        'customer_email', CASE
          WHEN o.customer_email IS NOT NULL AND position('@' in o.customer_email) > 2 THEN
            SUBSTRING(o.customer_email FROM 1 FOR 2) || '***@' || split_part(o.customer_email, '@', 2)
          ELSE '***'
        END,
        'status', CASE
          WHEN LOWER(COALESCE(o.lightdata_status, '')) LIKE '%entregad%' 
            OR LOWER(COALESCE(o.raw_lightdata_data->>'status', '')) LIKE '%entregad%'
            OR LOWER(COALESCE(o.bluex_status, '')) LIKE '%entregad%'
            OR LOWER(COALESCE(o.bluex_status, '')) LIKE '%delivered%'
            OR LOWER(COALESCE(o.starken_status, '')) LIKE '%entregad%'
            OR LOWER(COALESCE(o.optiroute_status, '')) LIKE '%entregad%'
            OR LOWER(COALESCE(o.optiroute_status, '')) LIKE '%completed%'
            OR LOWER(COALESCE(o.optiroute_status, '')) LIKE '%delivered%'
            OR LOWER(COALESCE(opti.opti_status, '')) LIKE '%delivered%'
            OR LOWER(COALESCE(opti.opti_status, '')) LIKE '%entregad%'
            OR LOWER(COALESCE(o.enviame_status, '')) LIKE '%entregad%'
            OR LOWER(COALESCE(o.enviame_status, '')) LIKE '%delivered%'
            OR EXISTS (
              SELECT 1 FROM public.envios_unificados eu
              WHERE (eu.pedido_referencia = o.external_order_number OR (o.tracking_number IS NOT NULL AND o.tracking_number <> '' AND eu.tracking = o.tracking_number))
                AND (LOWER(eu.status) LIKE '%entregad%' OR LOWER(eu.status) = 'delivered')
            ) THEN 'Entregado'
          WHEN LOWER(COALESCE(o.estado_wms, '')) LIKE '%incidenc%' 
            OR LOWER(COALESCE(o.lightdata_status, '')) LIKE '%incidenc%' THEN 'Incidencia'
          WHEN LOWER(COALESCE(o.estado_wms, '')) LIKE '%cancel%' 
            OR LOWER(COALESCE(o.status, '')) LIKE '%cancel%' THEN 'Cancelado'
          WHEN (o.categoria_entrega = 'RETIRO' OR o.operador ILIKE '%RETIRO%') 
            AND LOWER(COALESCE(o.estado_wms, '')) LIKE '%listo%' THEN 'Listo para retiro'
          ELSE COALESCE(o.estado_wms, o.status, 'En Proceso')
        END,
        'tracking_number', COALESCE(
          NULLIF(NULLIF(o.tracking_number, 'No informado'), ''),
          (SELECT eu.tracking FROM public.envios_unificados eu WHERE eu.pedido_referencia = o.external_order_number AND eu.tracking IS NOT NULL AND eu.tracking <> 'No informado' LIMIT 1),
          o.tracking_number
        ),
        'tracking_url', COALESCE(
          o.tracking_url,
          (SELECT eu.tracking_url FROM public.envios_unificados eu WHERE eu.pedido_referencia = o.external_order_number AND eu.tracking_url IS NOT NULL AND eu.tracking_url <> '' LIMIT 1)
        ),
        'courier', COALESCE(o.operador, o.courier, 'Stocka Same Day / Courier'),
        'categoria_entrega', COALESCE(o.categoria_entrega, 'DISTRIBUCIÓN'),
        'shipping_city', o.shipping_city,
        'created_at', o.created_at,
        'delivered_at', CASE
          WHEN LOWER(COALESCE(o.lightdata_status, '')) LIKE '%entregad%' THEN COALESCE(o.raw_lightdata_data->>'fecha_actualizacion_lightdata', o.raw_lightdata_data->>'updated_at')
          WHEN opti.opti_completed_at IS NOT NULL THEN opti.opti_completed_at
          ELSE (
            SELECT eu.updated_at::text 
            FROM public.envios_unificados eu 
            WHERE (eu.pedido_referencia = o.external_order_number OR (o.tracking_number IS NOT NULL AND eu.tracking = o.tracking_number))
              AND (LOWER(eu.status) LIKE '%entregad%' OR LOWER(eu.status) = 'delivered')
            LIMIT 1
          )
        END,
        'picking_info', jsonb_build_object(
          'warehouse', COALESCE(o.sucursal_pickeo, 'Centro de Distribución Stocka'),
          'status', COALESCE(
            o.picker_status,
            CASE 
              WHEN LOWER(COALESCE(o.estado_wms, '')) IN ('despachado', 'pickeado')
                OR LOWER(COALESCE(o.status, '')) IN ('despachado', 'preparado') THEN 'Completado'
              WHEN LOWER(COALESCE(o.estado_wms, '')) LIKE '%prep%'
                OR LOWER(COALESCE(o.status, '')) LIKE '%prep%' THEN 'En preparación'
              ELSE 'En proceso'
            END
          ),
          'picked_at', COALESCE(
            o.picker_last_synced_at::text,
            o.stock_descontado_at::text,
            CASE 
              WHEN LOWER(COALESCE(o.estado_wms, '')) IN ('despachado', 'pickeado')
                OR LOWER(COALESCE(o.status, '')) IN ('despachado', 'preparado')
              THEN COALESCE(o.raw_shopify_data->>'updated_at', o.created_at::text)
              ELSE NULL
            END
          ),
          'scanned_label', o.picker_scanned_label,
          'total_units', (SELECT COALESCE(sum(quantity), 0) FROM public.order_items oi WHERE oi.order_id = o.id),
          'items', (
            SELECT COALESCE(jsonb_agg(
              jsonb_build_object(
                'name', COALESCE(p.name, 'Producto'),
                'quantity', oi.quantity,
                'sku', p.sku,
                'barcode', COALESCE(NULLIF(p.barcode, ''), NULLIF(p.barcode_wms, ''), p.sku)
              )
            ), '[]'::jsonb)
            FROM public.order_items oi
            LEFT JOIN public.products p ON p.id = oi.product_id
            WHERE oi.order_id = o.id
          )
        ),
        'optiroute_info', jsonb_build_object(
          'is_optiroute', (opti.opti_status IS NOT NULL OR o.operador ILIKE '%STOCKA%' OR o.courier ILIKE '%OPTIROUTE%' OR o.operador ILIKE '%SAME DAY%'),
          'status_title', COALESCE(opti.opti_status_title, opti.opti_status, CASE WHEN o.estado_wms = 'Despachado' THEN 'En Ruta' ELSE o.estado_wms END),
          'service_type', COALESCE(opti.opti_service_type, 'Stocka Express (Same Day / 24 hrs)'),
          'vehicle', opti.opti_vehicle,
          'route_started_at', opti.opti_route_started_at,
          'delivered_at', opti.opti_completed_at,
          'reception_name', opti.opti_reception_name,
          'proof_image', opti.proof_image
        )
      ) ORDER BY o.created_at DESC
    ), '[]'::jsonb)
    INTO v_results
    FROM public.orders o
    LEFT JOIN LATERAL (
      SELECT 
        opt.status as opti_status,
        opt.servicio_tipo_envio as opti_service_type,
        opt.raw_data->'assigned_vehicle'->>'name' as opti_vehicle,
        opt.raw_data->>'route_started_at' as opti_route_started_at,
        opt.raw_data->>'completed_at' as opti_completed_at,
        opt.raw_data->>'status_title' as opti_status_title,
        COALESCE(opt.raw_data->'images'->0->>'url', opt.raw_data->'waypoint'->'images'->0->>'url') as proof_image,
        opt.raw_data->'waypoint'->>'reception_name' as opti_reception_name
      FROM public.optiroute_orders opt
      WHERE (opt.referencia = o.external_order_number 
         OR (o.tracking_number IS NOT NULL AND o.tracking_number <> '' AND opt.tracking = o.tracking_number))
      ORDER BY opt.created_at DESC
      LIMIT 1
    ) opti ON TRUE
    WHERE 
      LOWER(TRIM(COALESCE(o.customer_email, ''))) = v_clean_email
      AND (
        LOWER(TRIM(COALESCE(o.external_order_number, ''))) = LOWER(v_clean_order)
        OR LOWER(TRIM(COALESCE(o.external_order_number, ''))) ILIKE '%' || LOWER(v_clean_order)
        OR (LENGTH(v_num_only) >= 3 AND regexp_replace(COALESCE(o.external_order_number, ''), '[^0-9]', '', 'g') = v_num_only)
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
        'customer_email', CASE
          WHEN o.customer_email IS NOT NULL AND position('@' in o.customer_email) > 2 THEN
            SUBSTRING(o.customer_email FROM 1 FOR 2) || '***@' || split_part(o.customer_email, '@', 2)
          ELSE '***'
        END,
        'status', CASE
          WHEN LOWER(COALESCE(o.lightdata_status, '')) LIKE '%entregad%' 
            OR LOWER(COALESCE(o.raw_lightdata_data->>'status', '')) LIKE '%entregad%'
            OR LOWER(COALESCE(o.bluex_status, '')) LIKE '%entregad%'
            OR LOWER(COALESCE(o.bluex_status, '')) LIKE '%delivered%'
            OR LOWER(COALESCE(o.starken_status, '')) LIKE '%entregad%'
            OR LOWER(COALESCE(o.optiroute_status, '')) LIKE '%entregad%'
            OR LOWER(COALESCE(o.optiroute_status, '')) LIKE '%completed%'
            OR LOWER(COALESCE(o.optiroute_status, '')) LIKE '%delivered%'
            OR LOWER(COALESCE(opti.opti_status, '')) LIKE '%delivered%'
            OR LOWER(COALESCE(opti.opti_status, '')) LIKE '%entregad%'
            OR LOWER(COALESCE(o.enviame_status, '')) LIKE '%entregad%'
            OR LOWER(COALESCE(o.enviame_status, '')) LIKE '%delivered%'
            OR EXISTS (
              SELECT 1 FROM public.envios_unificados eu
              WHERE (eu.pedido_referencia = o.external_order_number OR (o.tracking_number IS NOT NULL AND o.tracking_number <> '' AND eu.tracking = o.tracking_number))
                AND (LOWER(eu.status) LIKE '%entregad%' OR LOWER(eu.status) = 'delivered')
            ) THEN 'Entregado'
          WHEN LOWER(COALESCE(o.estado_wms, '')) LIKE '%incidenc%' 
            OR LOWER(COALESCE(o.lightdata_status, '')) LIKE '%incidenc%' THEN 'Incidencia'
          WHEN LOWER(COALESCE(o.estado_wms, '')) LIKE '%cancel%' 
            OR LOWER(COALESCE(o.status, '')) LIKE '%cancel%' THEN 'Cancelado'
          WHEN (o.categoria_entrega = 'RETIRO' OR o.operador ILIKE '%RETIRO%') 
            AND LOWER(COALESCE(o.estado_wms, '')) LIKE '%listo%' THEN 'Listo para retiro'
          ELSE COALESCE(o.estado_wms, o.status, 'En Proceso')
        END,
        'tracking_number', COALESCE(
          NULLIF(NULLIF(o.tracking_number, 'No informado'), ''),
          (SELECT eu.tracking FROM public.envios_unificados eu WHERE eu.pedido_referencia = o.external_order_number AND eu.tracking IS NOT NULL AND eu.tracking <> 'No informado' LIMIT 1),
          o.tracking_number
        ),
        'tracking_url', COALESCE(
          o.tracking_url,
          (SELECT eu.tracking_url FROM public.envios_unificados eu WHERE eu.pedido_referencia = o.external_order_number AND eu.tracking_url IS NOT NULL AND eu.tracking_url <> '' LIMIT 1)
        ),
        'courier', COALESCE(o.operador, o.courier, 'Stocka Same Day / Courier'),
        'categoria_entrega', COALESCE(o.categoria_entrega, 'DISTRIBUCIÓN'),
        'shipping_city', o.shipping_city,
        'created_at', o.created_at,
        'delivered_at', CASE
          WHEN LOWER(COALESCE(o.lightdata_status, '')) LIKE '%entregad%' THEN COALESCE(o.raw_lightdata_data->>'fecha_actualizacion_lightdata', o.raw_lightdata_data->>'updated_at')
          WHEN opti.opti_completed_at IS NOT NULL THEN opti.opti_completed_at
          ELSE (
            SELECT eu.updated_at::text 
            FROM public.envios_unificados eu 
            WHERE (eu.pedido_referencia = o.external_order_number OR (o.tracking_number IS NOT NULL AND eu.tracking = o.tracking_number))
              AND (LOWER(eu.status) LIKE '%entregad%' OR LOWER(eu.status) = 'delivered')
            LIMIT 1
          )
        END,
        'picking_info', jsonb_build_object(
          'warehouse', COALESCE(o.sucursal_pickeo, 'Centro de Distribución Stocka'),
          'status', COALESCE(
            o.picker_status,
            CASE 
              WHEN LOWER(COALESCE(o.estado_wms, '')) IN ('despachado', 'pickeado')
                OR LOWER(COALESCE(o.status, '')) IN ('despachado', 'preparado') THEN 'Completado'
              WHEN LOWER(COALESCE(o.estado_wms, '')) LIKE '%prep%'
                OR LOWER(COALESCE(o.status, '')) LIKE '%prep%' THEN 'En preparación'
              ELSE 'En proceso'
            END
          ),
          'picked_at', COALESCE(
            o.picker_last_synced_at::text,
            o.stock_descontado_at::text,
            CASE 
              WHEN LOWER(COALESCE(o.estado_wms, '')) IN ('despachado', 'pickeado')
                OR LOWER(COALESCE(o.status, '')) IN ('despachado', 'preparado')
              THEN COALESCE(o.raw_shopify_data->>'updated_at', o.created_at::text)
              ELSE NULL
            END
          ),
          'scanned_label', o.picker_scanned_label,
          'total_units', (SELECT COALESCE(sum(quantity), 0) FROM public.order_items oi WHERE oi.order_id = o.id),
          'items', (
            SELECT COALESCE(jsonb_agg(
              jsonb_build_object(
                'name', COALESCE(p.name, 'Producto'),
                'quantity', oi.quantity,
                'sku', p.sku,
                'barcode', COALESCE(NULLIF(p.barcode, ''), NULLIF(p.barcode_wms, ''), p.sku)
              )
            ), '[]'::jsonb)
            FROM public.order_items oi
            LEFT JOIN public.products p ON p.id = oi.product_id
            WHERE oi.order_id = o.id
          )
        ),
        'optiroute_info', jsonb_build_object(
          'is_optiroute', (opti.opti_status IS NOT NULL OR o.operador ILIKE '%STOCKA%' OR o.courier ILIKE '%OPTIROUTE%' OR o.operador ILIKE '%SAME DAY%'),
          'status_title', COALESCE(opti.opti_status_title, opti.opti_status, CASE WHEN o.estado_wms = 'Despachado' THEN 'En Ruta' ELSE o.estado_wms END),
          'service_type', COALESCE(opti.opti_service_type, 'Stocka Express (Same Day / 24 hrs)'),
          'vehicle', opti.opti_vehicle,
          'route_started_at', opti.opti_route_started_at,
          'delivered_at', opti.opti_completed_at,
          'reception_name', opti.opti_reception_name,
          'proof_image', opti.proof_image
        )
      ) ORDER BY o.created_at DESC
    ), '[]'::jsonb)
    INTO v_results
    FROM public.orders o
    LEFT JOIN LATERAL (
      SELECT 
        opt.status as opti_status,
        opt.servicio_tipo_envio as opti_service_type,
        opt.raw_data->'assigned_vehicle'->>'name' as opti_vehicle,
        opt.raw_data->>'route_started_at' as opti_route_started_at,
        opt.raw_data->>'completed_at' as opti_completed_at,
        opt.raw_data->>'status_title' as opti_status_title,
        COALESCE(opt.raw_data->'images'->0->>'url', opt.raw_data->'waypoint'->'images'->0->>'url') as proof_image,
        opt.raw_data->'waypoint'->>'reception_name' as opti_reception_name
      FROM public.optiroute_orders opt
      WHERE (opt.referencia = o.external_order_number 
         OR (o.tracking_number IS NOT NULL AND o.tracking_number <> '' AND opt.tracking = o.tracking_number))
      ORDER BY opt.created_at DESC
      LIMIT 1
    ) opti ON TRUE
    WHERE LOWER(TRIM(COALESCE(o.customer_email, ''))) = v_clean_email
    LIMIT 10;

  -- 3. Solo Código de Courier
  ELSIF v_clean_courier <> '' THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'order_number', COALESCE(o.external_order_number, o.id::text),
        'comercio', COALESCE(o.comercio, 'Tienda Asociada Stocka'),
        'customer_name', COALESCE(o.customer_name, 'Cliente'),
        'customer_email', CASE
          WHEN o.customer_email IS NOT NULL AND position('@' in o.customer_email) > 2 THEN
            SUBSTRING(o.customer_email FROM 1 FOR 2) || '***@' || split_part(o.customer_email, '@', 2)
          ELSE '***'
        END,
        'status', CASE
          WHEN LOWER(COALESCE(o.lightdata_status, '')) LIKE '%entregad%' 
            OR LOWER(COALESCE(o.raw_lightdata_data->>'status', '')) LIKE '%entregad%'
            OR LOWER(COALESCE(o.bluex_status, '')) LIKE '%entregad%'
            OR LOWER(COALESCE(o.bluex_status, '')) LIKE '%delivered%'
            OR LOWER(COALESCE(o.starken_status, '')) LIKE '%entregad%'
            OR LOWER(COALESCE(o.optiroute_status, '')) LIKE '%entregad%'
            OR LOWER(COALESCE(o.optiroute_status, '')) LIKE '%completed%'
            OR LOWER(COALESCE(o.optiroute_status, '')) LIKE '%delivered%'
            OR LOWER(COALESCE(opti.opti_status, '')) LIKE '%delivered%'
            OR LOWER(COALESCE(opti.opti_status, '')) LIKE '%entregad%'
            OR LOWER(COALESCE(o.enviame_status, '')) LIKE '%entregad%'
            OR LOWER(COALESCE(o.enviame_status, '')) LIKE '%delivered%'
            OR EXISTS (
              SELECT 1 FROM public.envios_unificados eu
              WHERE (eu.pedido_referencia = o.external_order_number OR (o.tracking_number IS NOT NULL AND o.tracking_number <> '' AND eu.tracking = o.tracking_number))
                AND (LOWER(eu.status) LIKE '%entregad%' OR LOWER(eu.status) = 'delivered')
            ) THEN 'Entregado'
          WHEN LOWER(COALESCE(o.estado_wms, '')) LIKE '%incidenc%' 
            OR LOWER(COALESCE(o.lightdata_status, '')) LIKE '%incidenc%' THEN 'Incidencia'
          WHEN LOWER(COALESCE(o.estado_wms, '')) LIKE '%cancel%' 
            OR LOWER(COALESCE(o.status, '')) LIKE '%cancel%' THEN 'Cancelado'
          WHEN (o.categoria_entrega = 'RETIRO' OR o.operador ILIKE '%RETIRO%') 
            AND LOWER(COALESCE(o.estado_wms, '')) LIKE '%listo%' THEN 'Listo para retiro'
          ELSE COALESCE(o.estado_wms, o.status, 'En Proceso')
        END,
        'tracking_number', COALESCE(
          NULLIF(NULLIF(o.tracking_number, 'No informado'), ''),
          (SELECT eu.tracking FROM public.envios_unificados eu WHERE eu.pedido_referencia = o.external_order_number AND eu.tracking IS NOT NULL AND eu.tracking <> 'No informado' LIMIT 1),
          o.tracking_number
        ),
        'tracking_url', COALESCE(
          o.tracking_url,
          (SELECT eu.tracking_url FROM public.envios_unificados eu WHERE eu.pedido_referencia = o.external_order_number AND eu.tracking_url IS NOT NULL AND eu.tracking_url <> '' LIMIT 1)
        ),
        'courier', COALESCE(o.operador, o.courier, 'Stocka Same Day / Courier'),
        'categoria_entrega', COALESCE(o.categoria_entrega, 'DISTRIBUCIÓN'),
        'shipping_city', o.shipping_city,
        'created_at', o.created_at,
        'delivered_at', CASE
          WHEN LOWER(COALESCE(o.lightdata_status, '')) LIKE '%entregad%' THEN COALESCE(o.raw_lightdata_data->>'fecha_actualizacion_lightdata', o.raw_lightdata_data->>'updated_at')
          WHEN opti.opti_completed_at IS NOT NULL THEN opti.opti_completed_at
          ELSE (
            SELECT eu.updated_at::text 
            FROM public.envios_unificados eu 
            WHERE (eu.pedido_referencia = o.external_order_number OR (o.tracking_number IS NOT NULL AND eu.tracking = o.tracking_number))
              AND (LOWER(eu.status) LIKE '%entregad%' OR LOWER(eu.status) = 'delivered')
            LIMIT 1
          )
        END,
        'picking_info', jsonb_build_object(
          'warehouse', COALESCE(o.sucursal_pickeo, 'Centro de Distribución Stocka'),
          'status', COALESCE(
            o.picker_status,
            CASE 
              WHEN LOWER(COALESCE(o.estado_wms, '')) IN ('despachado', 'pickeado')
                OR LOWER(COALESCE(o.status, '')) IN ('despachado', 'preparado') THEN 'Completado'
              WHEN LOWER(COALESCE(o.estado_wms, '')) LIKE '%prep%'
                OR LOWER(COALESCE(o.status, '')) LIKE '%prep%' THEN 'En preparación'
              ELSE 'En proceso'
            END
          ),
          'picked_at', COALESCE(
            o.picker_last_synced_at::text,
            o.stock_descontado_at::text,
            CASE 
              WHEN LOWER(COALESCE(o.estado_wms, '')) IN ('despachado', 'pickeado')
                OR LOWER(COALESCE(o.status, '')) IN ('despachado', 'preparado')
              THEN COALESCE(o.raw_shopify_data->>'updated_at', o.created_at::text)
              ELSE NULL
            END
          ),
          'scanned_label', o.picker_scanned_label,
          'total_units', (SELECT COALESCE(sum(quantity), 0) FROM public.order_items oi WHERE oi.order_id = o.id),
          'items', (
            SELECT COALESCE(jsonb_agg(
              jsonb_build_object(
                'name', COALESCE(p.name, 'Producto'),
                'quantity', oi.quantity,
                'sku', p.sku,
                'barcode', COALESCE(NULLIF(p.barcode, ''), NULLIF(p.barcode_wms, ''), p.sku)
              )
            ), '[]'::jsonb)
            FROM public.order_items oi
            LEFT JOIN public.products p ON p.id = oi.product_id
            WHERE oi.order_id = o.id
          )
        ),
        'optiroute_info', jsonb_build_object(
          'is_optiroute', (opti.opti_status IS NOT NULL OR o.operador ILIKE '%STOCKA%' OR o.courier ILIKE '%OPTIROUTE%' OR o.operador ILIKE '%SAME DAY%'),
          'status_title', COALESCE(opti.opti_status_title, opti.opti_status, CASE WHEN o.estado_wms = 'Despachado' THEN 'En Ruta' ELSE o.estado_wms END),
          'service_type', COALESCE(opti.opti_service_type, 'Stocka Express (Same Day / 24 hrs)'),
          'vehicle', opti.opti_vehicle,
          'route_started_at', opti.opti_route_started_at,
          'delivered_at', opti.opti_completed_at,
          'reception_name', opti.opti_reception_name,
          'proof_image', opti.proof_image
        )
      ) ORDER BY o.created_at DESC
    ), '[]'::jsonb)
    INTO v_results
    FROM public.orders o
    LEFT JOIN LATERAL (
      SELECT 
        opt.status as opti_status,
        opt.servicio_tipo_envio as opti_service_type,
        opt.raw_data->'assigned_vehicle'->>'name' as opti_vehicle,
        opt.raw_data->>'route_started_at' as opti_route_started_at,
        opt.raw_data->>'completed_at' as opti_completed_at,
        opt.raw_data->>'status_title' as opti_status_title,
        COALESCE(opt.raw_data->'images'->0->>'url', opt.raw_data->'waypoint'->'images'->0->>'url') as proof_image,
        opt.raw_data->'waypoint'->>'reception_name' as opti_reception_name
      FROM public.optiroute_orders opt
      WHERE (opt.referencia = o.external_order_number 
         OR (o.tracking_number IS NOT NULL AND o.tracking_number <> '' AND opt.tracking = o.tracking_number))
      ORDER BY opt.created_at DESC
      LIMIT 1
    ) opti ON TRUE
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

GRANT EXECUTE ON FUNCTION public.get_customer_tracking(text, text, text, text) TO anon, authenticated;
