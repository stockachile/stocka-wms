-- =========================================================================================
-- WMS STOCKA - Integración WooDelivery (Wodely / ALPHA) con Autoridad Post-Retiro,
-- Tabla Dedicada woodelivery_envios, Unificación, POD, Tracking Público y Shopify Sync
-- Fecha: 2026-11-20
-- =========================================================================================

-- =========================================================================================
-- 1. TABLA DEDICADA public.woodelivery_envios
-- =========================================================================================
CREATE TABLE IF NOT EXISTS public.woodelivery_envios (
  external_key TEXT PRIMARY KEY,                              -- LightData did (5-8 dígitos) o MeLi shipping_id (11 dígitos)
  source_kind TEXT NOT NULL DEFAULT 'lightdata'
    CHECK (source_kind IN ('lightdata', 'meli_flex', 'other')), -- Solo 'lightdata' sincroniza a envios_unificados/orders; 'meli_flex' queda para visibilidad/auditoría
  task_id BIGINT NOT NULL,                                    -- ID numérico de la tarea ganadora en Wodely
  task_guid TEXT NOT NULL,                                    -- GUID público para https://app.woodelivery.com/t?q={task_guid}
  tracking_url TEXT,                                          -- Enlace público oficial con reporte y fotos POD
  my_id TEXT,                                                 -- tag3 ("MyID", ej: GLS28237, BIT11050262)
  comercio TEXT,                                              -- Comercio resuelto vía lightdata_envios o sigla
  courier TEXT NOT NULL DEFAULT 'ALPHA',                      -- Siempre 'ALPHA' para compatibilidad WMS (evita exclusión Envíame)
  status_id INT NOT NULL,                                     -- 10,15,20,25,28,30,40,50,51,52,90
  status_desc TEXT NOT NULL,                                  -- Texto original Wodely (Completed, Failed, Returned, etc.)
  status_display TEXT,                                        -- Texto limpio en español para UI WMS y tracking
  status_wms_normalized TEXT NOT NULL DEFAULT 'SIN MOVIMIENTO'
    CHECK (status_wms_normalized IN ('SIN MOVIMIENTO', 'EN TRÁNSITO', 'ALERTA', 'DEVOLUCIÓN', 'ENTREGADO')),
  is_final BOOLEAN NOT NULL DEFAULT FALSE,                    -- TRUE = estado final alcanzado (dejar de consultar)
  final_reason TEXT,                                          -- completed_real | returned | cancelled_confirmed | failed_stale_30d
  driver_name TEXT,
  is_virtual_driver BOOLEAN NOT NULL DEFAULT FALSE,           -- TRUE si chofer es cola virtual (A RETIRAR, - NO RETIRADO, - RETORNADOS, CD, etc.)
  tag2_alpha_stage TEXT,                                      -- Retirado | En Planta | En planta de procesamiento | A retirar
  tag4_notes TEXT,                                            -- Notas internas / reagendamiento Alpha
  failed_reason_code TEXT,                                    -- 10,20,30,40,50,60,71,72,73,99
  failed_reason_text TEXT,                                    -- Descripción legible del motivo de fallo
  recipient_name TEXT,
  recipient_phone TEXT,
  recipient_email TEXT,
  destination_address TEXT,
  zone_name TEXT,
  completed_recipient_name TEXT,
  completed_notes TEXT,
  completed_coordinates TEXT,
  pod_images JSONB NOT NULL DEFAULT '[]'::jsonb,              -- URLs Azure Blob de fotos POD
  history_events JSONB NOT NULL DEFAULT '[]'::jsonb,          -- Timeline cronológico limpio (/Task/TaskHistory)
  pod_fetched_at TIMESTAMPTZ,                                 -- Timestamp de última captura de POD/historial
  wd_created_at TIMESTAMPTZ,
  wd_modified_at TIMESTAMPTZ,
  wd_completed_at TIMESTAMPTZ,
  related_task_ids JSONB NOT NULL DEFAULT '[]'::jsonb,        -- Auditoría de tareas múltiples para el mismo external_key
  raw_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_woodelivery_envios_is_final
  ON public.woodelivery_envios (is_final, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_woodelivery_envios_status_id
  ON public.woodelivery_envios (status_id);
CREATE INDEX IF NOT EXISTS idx_woodelivery_envios_my_id
  ON public.woodelivery_envios (my_id) WHERE my_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_woodelivery_envios_comercio
  ON public.woodelivery_envios (comercio);
CREATE INDEX IF NOT EXISTS idx_woodelivery_envios_source_kind
  ON public.woodelivery_envios (source_kind);
CREATE INDEX IF NOT EXISTS idx_woodelivery_envios_updated_at
  ON public.woodelivery_envios (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_woodelivery_envios_pod_pending
  ON public.woodelivery_envios (updated_at DESC)
  WHERE pod_fetched_at IS NULL AND status_id IN (50, 51, 52) AND source_kind = 'lightdata';

COMMENT ON TABLE public.woodelivery_envios IS
  'Fuente de verdad post-retiro para envíos Alpha Group sincronizados por lotes desde app.woodelivery.com (Wodely). Incluye envíos MeLi Flex solo para auditoría (source_kind = meli_flex).';

ALTER TABLE public.woodelivery_envios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins gestionan woodelivery_envios" ON public.woodelivery_envios;
CREATE POLICY "Admins gestionan woodelivery_envios" ON public.woodelivery_envios
  FOR ALL
  TO authenticated
  USING (
    public.is_admin()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'operario', 'picker', 'supervisor')
  )
  WITH CHECK (
    public.is_admin()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'operario', 'supervisor')
  );

DROP POLICY IF EXISTS "Clientes leen sus envios woodelivery" ON public.woodelivery_envios;
CREATE POLICY "Clientes leen sus envios woodelivery" ON public.woodelivery_envios
  FOR SELECT
  TO authenticated
  USING (
    public.check_user_commerce(comercio)
  );

GRANT ALL ON public.woodelivery_envios TO postgres, service_role;
GRANT SELECT ON public.woodelivery_envios TO authenticated;

-- Habilitar Realtime para woodelivery_envios
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'woodelivery_envios'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.woodelivery_envios;
  END IF;
END $$;

-- =========================================================================================
-- 2. NUEVAS COLUMNAS EN public.orders Y PROTECCIÓN EN TRIGGER DE EDICIÓN CLIENTE
-- =========================================================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS woodelivery_status TEXT,
  ADD COLUMN IF NOT EXISTS raw_woodelivery_data JSONB;

CREATE OR REPLACE FUNCTION public.protect_orders_sensitive_columns_on_client_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  IF COALESCE(auth.role(), '') = 'authenticated' AND auth.uid() IS NOT NULL THEN
    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();

    IF COALESCE(v_role, '') NOT IN ('admin', 'operario', 'picker', 'supervisor') AND NOT public.is_admin() THEN
      NEW.merchant_id := OLD.merchant_id;
      NEW.comercio := OLD.comercio;
      NEW.created_at := OLD.created_at;
      NEW.external_order_number := OLD.external_order_number;
      NEW.external_platform := OLD.external_platform;
      NEW.origen := OLD.origen;

      NEW.payment_status := OLD.payment_status;
      NEW.estado_wms := OLD.estado_wms;
      NEW.status := OLD.status;
      NEW.shipping_method := OLD.shipping_method;
      NEW.stock_descontado := OLD.stock_descontado;
      NEW.stock_descontado_at := OLD.stock_descontado_at;
      NEW.sucursal_pickeo := OLD.sucursal_pickeo;
      NEW.agenda := OLD.agenda;
      NEW.operador := OLD.operador;
      NEW.courier := OLD.courier;
      NEW.categoria_entrega := OLD.categoria_entrega;
      NEW.fecha_procesamiento := OLD.fecha_procesamiento;
      NEW.periodo_facturacion := OLD.periodo_facturacion;

      NEW.tracking_number := OLD.tracking_number;
      NEW.tracking_url := OLD.tracking_url;
      NEW.label_url := OLD.label_url;
      NEW.label_base64 := OLD.label_base64;
      NEW.enviame_delivery_id := OLD.enviame_delivery_id;
      NEW.enviame_status := OLD.enviame_status;
      NEW.optiroute_id := OLD.optiroute_id;
      NEW.optiroute_status := OLD.optiroute_status;
      NEW.raw_optiroute_data := OLD.raw_optiroute_data;
      NEW.estado_ruta_optiroute := OLD.estado_ruta_optiroute;
      NEW.lightdata_status := OLD.lightdata_status;
      NEW.raw_lightdata_data := OLD.raw_lightdata_data;
      NEW.woodelivery_status := OLD.woodelivery_status;
      NEW.raw_woodelivery_data := OLD.raw_woodelivery_data;
      NEW.bluex_status := OLD.bluex_status;
      NEW.raw_bluex_data := OLD.raw_bluex_data;
      NEW.starken_status := OLD.starken_status;
      NEW.raw_starken_data := OLD.raw_starken_data;

      NEW.picker_status := OLD.picker_status;
      NEW.picker_operator := OLD.picker_operator;
      NEW.picker_scanned_label := OLD.picker_scanned_label;
      NEW.picker_last_synced_at := OLD.picker_last_synced_at;
      NEW.picker_location_info := OLD.picker_location_info;
      NEW.picker_history_snapshot := OLD.picker_history_snapshot;
      NEW.shopify_fulfillment_id := OLD.shopify_fulfillment_id;
      NEW.shopify_fulfillment_status := OLD.shopify_fulfillment_status;
      NEW.shopify_sync_last_error := OLD.shopify_sync_last_error;
      NEW.shopify_order_status := OLD.shopify_order_status;
      NEW.shopify_fulfillment_order_id := OLD.shopify_fulfillment_order_id;
      NEW.shopify_status_updated_at := OLD.shopify_status_updated_at;
      NEW.parent_order_id := OLD.parent_order_id;
      NEW.is_split := OLD.is_split;
      NEW.split_sequence := OLD.split_sequence;
      NEW.split_reason := OLD.split_reason;
      NEW.has_picking_request := OLD.has_picking_request;
      NEW.picking_request_status := OLD.picking_request_status;
      NEW.admin_notes := OLD.admin_notes;
      NEW.transport_status_normalized := OLD.transport_status_normalized;
      NEW.dispatched_at := OLD.dispatched_at;
      NEW.delivered_at := OLD.delivered_at;
      NEW.closed_at := OLD.closed_at;
      NEW.closed_by_automation := OLD.closed_by_automation;
      NEW.tracking_history := OLD.tracking_history;
      NEW.closed_snapshot := OLD.closed_snapshot;
      NEW.consolidated_into_order_id := OLD.consolidated_into_order_id;
      NEW.is_consolidated := OLD.is_consolidated;
      NEW.hold_reason := OLD.hold_reason;
      NEW.ready_for_pickup_at := OLD.ready_for_pickup_at;

      NEW.raw_shopify_data := public.merge_client_allowed_order_raw_data(OLD.raw_shopify_data, NEW.raw_shopify_data);
      NEW.raw_woocommerce_data := public.merge_client_allowed_order_raw_data(OLD.raw_woocommerce_data, NEW.raw_woocommerce_data);
      NEW.raw_falabella_data := public.merge_client_allowed_order_raw_data(OLD.raw_falabella_data, NEW.raw_falabella_data);
      NEW.raw_paris_data := public.merge_client_allowed_order_raw_data(OLD.raw_paris_data, NEW.raw_paris_data);
      NEW.raw_ripley_data := public.merge_client_allowed_order_raw_data(OLD.raw_ripley_data, NEW.raw_ripley_data);
      NEW.raw_jumpseller_data := public.merge_client_allowed_order_raw_data(OLD.raw_jumpseller_data, NEW.raw_jumpseller_data);
      NEW.raw_tiendanube_data := public.merge_client_allowed_order_raw_data(OLD.raw_tiendanube_data, NEW.raw_tiendanube_data);
      NEW.raw_meli_data := public.merge_client_allowed_order_raw_data(OLD.raw_meli_data, NEW.raw_meli_data);
      NEW.raw_walmart_data := public.merge_client_allowed_order_raw_data(OLD.raw_walmart_data, NEW.raw_walmart_data);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- =========================================================================================
-- 3. PERMITIR 'woodelivery_envios' EN public.envios_unificados Y ACTUALIZAR CLASIFICADORES
-- =========================================================================================
ALTER TABLE public.envios_unificados
  DROP CONSTRAINT IF EXISTS envios_unificados_source_table_check;

ALTER TABLE public.envios_unificados
  ADD CONSTRAINT envios_unificados_source_table_check
  CHECK (source_table IN (
    'lightdata_envios',
    'enviame_shipments',
    'optiroute_orders',
    'bluex_envios',
    'starken_envios',
    'woodelivery_envios'
  ));

CREATE OR REPLACE FUNCTION public.get_global_status(source_table TEXT, status_str TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  s TEXT;
BEGIN
  IF status_str IS NULL THEN
    RETURN NULL;
  END IF;

  s := LOWER(TRIM(status_str));

  IF s LIKE '%rechazado por courier%' OR s = 'rechazado por courier' THEN
    RETURN 'SIN MOVIMIENTO';
  END IF;

  IF source_table = 'woodelivery_envios' THEN
    IF s IN ('unassigned', 'assigning', 'assigned', 'pendiente de retiro', 'sin movimiento', 'no retirado', 'a retirar') THEN
      RETURN 'SIN MOVIMIENTO';
    ELSIF s ~ '(failed|fallid|intento fallido|cancel|devoluc|devuelt|returned|alerta|incidencia)' THEN
      RETURN 'ALERTA';
    ELSIF s ~ '(processed|loaded|transit|arrived|completed|entregad|delivered|en tránsito|en transito|en ruta|reparto|planta|retirado|cargado|camino)' THEN
      RETURN 'DESPACHADO';
    END IF;
  ELSIF source_table = 'lightdata_envios' THEN
    IF s IN ('no retirado', 'a retirar') THEN
      RETURN 'SIN MOVIMIENTO';
    ELSIF s IN ('entregado', 'nadie') OR s LIKE '%camino%' THEN
      RETURN 'DESPACHADO';
    ELSIF s = 'cancelado' THEN
      RETURN 'ALERTA';
    END IF;
  ELSIF source_table = 'optiroute_orders' THEN
    IF s IN ('reviewing', 'scheduled', 'skipped') THEN
      RETURN 'SIN MOVIMIENTO';
    ELSIF s IN ('onroute', 'ongoing', 'arrived', 'delivered', 'en ruta') THEN
      RETURN 'DESPACHADO';
    ELSIF s IN ('cancelled', 'canceled', 'deleted') THEN
      RETURN 'ALERTA';
    END IF;
  ELSIF source_table = 'enviame_shipments' THEN
    IF s LIKE '%requiere solucion%' OR s LIKE '%requiere solución%' OR s LIKE '%pendiente - requiere%'
       OR s LIKE '%excepcion%' OR s LIKE '%excepción%' OR s LIKE '%siniestr%' OR s LIKE '%fallid%'
       OR s LIKE '%cancel%' OR (s LIKE '%rechazad%' AND s NOT LIKE '%rechazado por courier%') THEN
      RETURN 'ALERTA';
    ELSIF s IN ('creado', 'eliminado', 'listo para despacho - impreso', 'listo para despacho') OR s LIKE '%impres%' THEN
      RETURN 'SIN MOVIMIENTO';
    ELSIF s IN ('devolucion', 'en reparto', 'en tránsito', 'entregado', 'no hay quien reciba', 'extraviado', 'expirado', 'entregado con exito')
       OR s LIKE '%planta%' OR s LIKE '%transito%' OR s LIKE '%tránsito%' OR s LIKE '%reparto%' OR s LIKE '%entregad%' OR s LIKE '%ruta%' OR s LIKE '%camino%' THEN
      RETURN 'DESPACHADO';
    END IF;
  ELSIF source_table = 'bluex_envios' THEN
    IF s IN ('in_transit', 'out_for_delivery', 'delivered', 'entregado', 'en reparto', 'en ruta', 'en camino', 'en tránsito')
       OR s LIKE '%transit%' OR s LIKE '%deliver%' OR s LIKE '%ruta%' OR s LIKE '%reparto%' THEN
      RETURN 'DESPACHADO';
    ELSIF s IN ('pickup', 'in_preparation', 'creado', 'emitido', 'ingresado', 'recepcionado', 'procesando')
       OR s LIKE '%pickup%' OR s LIKE '%preparation%' THEN
      RETURN 'SIN MOVIMIENTO';
    ELSIF s IN ('cancelado', 'anulado', 'fallido', 'devuelto', 'siniestro', 'incidencia', 'failed')
       OR s LIKE '%cancel%' OR s LIKE '%fail%' THEN
      RETURN 'ALERTA';
    END IF;
  ELSIF source_table = 'starken_envios' THEN
    IF s IN ('transito', 'destino', 'reparto', 'entregados', 'entregado', 'redestino', 'redestinado', 'en transito', 'en destino', 'en reparto')
       OR s LIKE '%transit%' OR s LIKE '%deliver%' OR s LIKE '%reparto%' OR s LIKE '%entregad%' OR s LIKE '%destino%' THEN
      RETURN 'DESPACHADO';
    ELSIF s IN ('origen', 'en origen', 'creado', 'emitido', 'ingresado', 'recepcionado', 'recepcion')
       OR s LIKE '%origen%' THEN
      RETURN 'SIN MOVIMIENTO';
    ELSIF s IN ('excepciones', 'excepcion', 'cancelado', 'anulado', 'fallido', 'devuelto', 'siniestro', 'incidencia', 'failed')
       OR s LIKE '%excepcion%' OR s LIKE '%cancel%' OR s LIKE '%fail%' THEN
      RETURN 'ALERTA';
    END IF;
  END IF;

  RETURN 'SIN MOVIMIENTO';
END;
$function$;

CREATE OR REPLACE FUNCTION public.classify_shipment_transport_status(
  p_source_table TEXT,
  p_status TEXT,
  p_raw_data JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_src TEXT := LOWER(TRIM(COALESCE(p_source_table, '')));
  v_status_text TEXT := TRIM(COALESCE(p_status, ''));
  v_raw23 TEXT;
  v_nested TEXT;
  v_low TEXT;
  v_norm TEXT := 'SIN MOVIMIENTO';
  v_wd_norm TEXT;
  v_wd_sid INT;
  v_wd_vdrv BOOLEAN := FALSE;
  v_wd_drv TEXT := '';
  v_wd_fr TEXT := '';
BEGIN
  -- 0. Clasificador de alta precisión para WooDelivery (ALPHA)
  IF v_src = 'woodelivery_envios' THEN
    IF p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data) = 'object' THEN
      v_wd_norm := UPPER(TRIM(COALESCE(p_raw_data->>'status_wms_normalized', '')));
      v_wd_vdrv := COALESCE((p_raw_data->>'is_virtual_driver')::boolean, FALSE);
      v_wd_drv := UPPER(TRIM(COALESCE(p_raw_data->>'driver_name', '')));
      v_wd_fr := TRIM(COALESCE(p_raw_data->>'failed_reason_text', ''));
      BEGIN
        v_wd_sid := NULLIF(TRIM(COALESCE(p_raw_data->>'status_id', '')), '')::int;
      EXCEPTION WHEN OTHERS THEN
        v_wd_sid := NULL;
      END;

      -- Guardrail duro: nunca cerrar como ENTREGADO si el chofer es una cola virtual de retorno o no retiro
      IF v_wd_sid = 52 OR v_wd_norm = 'DEVOLUCIÓN'
         OR (v_wd_vdrv AND v_wd_drv ~ '(RETORN|CENTRO DE|DEVOL)') THEN
        RETURN jsonb_build_object(
          'norm', 'DEVOLUCIÓN',
          'clean_status', COALESCE(NULLIF(v_status_text, ''), 'Devuelto a origen')
        );
      END IF;

      IF v_wd_sid = 51 OR v_wd_norm = 'ALERTA' THEN
        RETURN jsonb_build_object(
          'norm', 'ALERTA',
          'clean_status', COALESCE(
            NULLIF(v_status_text, ''),
            CASE WHEN v_wd_fr <> '' THEN 'Intento fallido: ' || v_wd_fr ELSE 'Intento fallido' END
          )
        );
      END IF;

      IF v_wd_sid = 90 THEN
        RETURN jsonb_build_object(
          'norm', 'ALERTA',
          'clean_status', COALESCE(NULLIF(v_status_text, ''), 'Cancelado en WooDelivery')
        );
      END IF;

      IF v_wd_sid = 50 AND NOT v_wd_vdrv THEN
        RETURN jsonb_build_object(
          'norm', 'ENTREGADO',
          'clean_status', COALESCE(NULLIF(v_status_text, ''), 'Entregado')
        );
      END IF;

      IF v_wd_norm IN ('SIN MOVIMIENTO', 'EN TRÁNSITO', 'ALERTA', 'DEVOLUCIÓN', 'ENTREGADO') THEN
        IF v_wd_norm = 'ENTREGADO' AND v_wd_vdrv THEN
          v_wd_norm := 'SIN MOVIMIENTO';
        END IF;
        RETURN jsonb_build_object(
          'norm', v_wd_norm,
          'clean_status', COALESCE(NULLIF(v_status_text, ''), v_wd_norm)
        );
      END IF;
    END IF;
  END IF;

  -- 1. Enriquecer estado real en LightData (ALPHA) cuando status trae coordenadas GPS (-33.xxx) o está vacío
  IF v_src = 'lightdata_envios' AND p_raw_data IS NOT NULL THEN
    IF jsonb_typeof(p_raw_data) = 'array' AND jsonb_array_length(p_raw_data) > 23 THEN
      v_raw23 := TRIM(COALESCE(p_raw_data->>23, ''));
    ELSIF jsonb_typeof(p_raw_data) = 'object' AND p_raw_data->'raw_data' IS NOT NULL AND jsonb_typeof(p_raw_data->'raw_data') = 'array' THEN
      v_raw23 := TRIM(COALESCE(p_raw_data->'raw_data'->>23, ''));
    END IF;

    IF (v_status_text = '' OR v_status_text ~ '^-?[0-9]+\.[0-9]+$') AND v_raw23 IS NOT NULL AND v_raw23 <> '' AND v_raw23 !~ '^-?[0-9]+\.[0-9]+$' THEN
      v_status_text := v_raw23;
    ELSIF v_raw23 IS NOT NULL AND v_raw23 <> '' AND v_raw23 !~ '^-?[0-9]+\.[0-9]+$' THEN
      IF LOWER(v_raw23) ~ '(entregad|delivered|camino|reparto|planta|ruta|tránsito|transito)' THEN
        v_status_text := v_raw23;
      END IF;
    END IF;
  ELSIF v_src = 'enviame_shipments' AND p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data) = 'object' THEN
    v_nested := TRIM(COALESCE(p_raw_data->'status'->>'name', p_raw_data->'status'->>'code', p_raw_data->>'tracking_status', ''));
    IF v_nested <> '' AND (v_status_text = '' OR LOWER(v_status_text) = 'despachado') THEN
      v_status_text := v_nested;
    END IF;
  END IF;

  v_low := LOWER(TRIM(v_status_text));

  IF v_low = '' THEN
    RETURN jsonb_build_object('norm', 'SIN MOVIMIENTO', 'clean_status', 'Sin movimiento');
  END IF;

  -- 2. Reglas de exclusión prioritaria: sin movimiento inicial
  IF v_low LIKE '%rechazado por courier%'
     OR (v_src = 'woodelivery_envios' AND v_low IN ('unassigned', 'assigning', 'assigned', 'pendiente de retiro', 'sin movimiento', 'no retirado', 'a retirar'))
     OR (v_src = 'optiroute_orders' AND v_low IN ('skipped', 'reviewing', 'scheduled', 'imported', 'temporary'))
     OR (v_src = 'lightdata_envios' AND v_low IN ('no retirado', 'a retirar'))
     OR (v_src = 'bluex_envios' AND v_low IN ('pickup', 'in_preparation', 'creado', 'emitido', 'ingresado', 'procesando'))
     OR (v_src = 'starken_envios' AND v_low IN ('origen', 'en origen', 'creado', 'emitido', 'ingresado'))
     OR (v_src = 'enviame_shipments' AND (v_low IN ('creado', 'listo para despacho', 'listo para despacho - impreso', 'eliminado') OR v_low LIKE '%impres%' OR v_low LIKE '%listo para despacho%'))
  THEN
    RETURN jsonb_build_object('norm', 'SIN MOVIMIENTO', 'clean_status', v_status_text);
  END IF;

  -- 3. Devoluciones o entregas al remitente/origen (¡NUNCA cerrar como Entregado exitoso al cliente!)
  IF v_low ~ '(devoluci[oó]n|devuelto|returned|entregado al remitente|entregado en origen|devuelto a origen|retorno a origen)' THEN
    RETURN jsonb_build_object('norm', 'DEVOLUCIÓN', 'clean_status', v_status_text);
  END IF;

  -- 4. Alertas, excepciones, siniestros, intentos fallidos o cancelaciones de guía
  IF v_low ~ '(requiere soluci[oó]n|pendiente - requiere|retenid|excepci[oó]n|siniestr|extraviad|fallid|no entregad|failed|cancel|anula|eliminad|deleted)'
     OR (v_low LIKE '%rechazad%' AND v_low NOT LIKE '%rechazado por courier%')
  THEN
    RETURN jsonb_build_object('norm', 'ALERTA', 'clean_status', v_status_text);
  END IF;

  -- 5. ENTREGADO exitoso al destinatario final
  IF v_low ~ '(entregad|delivered|completed|entrega exitosa|recibido conforme)'
     AND v_low !~ '(no entregad|fallid|rechazad|remitente|devuel|devoluc|origen|disponible para retiro|listo para retiro|pendiente)'
  THEN
    RETURN jsonb_build_object(
      'norm', 'ENTREGADO',
      'clean_status', CASE WHEN v_status_text ~ '^-?[0-9]+\.[0-9]+$' THEN 'Entregado' ELSE v_status_text END
    );
  END IF;

  -- 6. EN TRÁNSITO (movimiento físico confirmado por el operador logístico)
  IF v_low ~ '(tr[aá]nsito|in_transit|out_for_delivery|transit|loaded|processed|reparto|en ruta|onroute|ongoing|arrived|en camino|camino al destinatario|admitid|planta|clasificado|recepcionado en planta|en destino|redestin|disponible para retiro|cambio de direcci|cambi[oó] de direcci|nadie)'
     OR (v_src = 'lightdata_envios' AND v_low ~ '(camino|recepcionado|procesamiento)')
     OR (v_src = 'starken_envios' AND v_low IN ('transito', 'destino', 'reparto'))
  THEN
    RETURN jsonb_build_object(
      'norm', 'EN TRÁNSITO',
      'clean_status', CASE WHEN v_status_text ~ '^-?[0-9]+\.[0-9]+$' THEN 'En tránsito' ELSE v_status_text END
    );
  END IF;

  RETURN jsonb_build_object('norm', v_norm, 'clean_status', v_status_text);
END;
$function$;

-- =========================================================================================
-- 4. TRIGGERS woodelivery_envios -> envios_unificados (SOLO source_kind = 'lightdata')
--    (Envíos MeLi Flex quedan únicamente en woodelivery_envios para visibilidad/auditoría)
-- =========================================================================================
CREATE OR REPLACE FUNCTION public.sync_woodelivery_to_unified()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_id TEXT := 'woodelivery_envios:' || NEW.external_key;
  v_global_status TEXT;
  v_ref TEXT := NULL;
  v_comercio TEXT := NULL;
  v_status_text TEXT;
  v_enriched_raw JSONB;
BEGIN
  -- Solo los envíos Alpha/LightData sincronizan con envios_unificados y orders.
  -- Los envíos MeLi Flex ('meli_flex') y otros se conservan en woodelivery_envios solo para auditoría.
  IF NEW.source_kind <> 'lightdata' THEN
    DELETE FROM public.envios_unificados WHERE id = v_id;
    RETURN NEW;
  END IF;

  v_status_text := COALESCE(NULLIF(TRIM(NEW.status_display), ''), NEW.status_desc);

  v_global_status := CASE NEW.status_wms_normalized
    WHEN 'ENTREGADO' THEN 'DESPACHADO'
    WHEN 'EN TRÁNSITO' THEN 'DESPACHADO'
    WHEN 'ALERTA' THEN 'ALERTA'
    WHEN 'DEVOLUCIÓN' THEN 'ALERTA'
    ELSE 'SIN MOVIMIENTO'
  END;

  -- Resolver pedido_referencia y comercio desde orders o lightdata_envios
  SELECT o.external_order_number, o.comercio
  INTO v_ref, v_comercio
  FROM public.orders o
  WHERE o.tracking_number = NEW.external_key
  ORDER BY o.created_at DESC
  LIMIT 1;

  IF v_ref IS NULL OR v_comercio IS NULL THEN
    SELECT COALESCE(v_ref, ld.tracking), COALESCE(v_comercio, ld.comercio, ld.empresa_comercio)
    INTO v_ref, v_comercio
    FROM public.lightdata_envios ld
    WHERE ld.id = NEW.external_key
    LIMIT 1;
  END IF;

  v_ref := COALESCE(NULLIF(TRIM(v_ref), ''), NULLIF(TRIM(NEW.my_id), ''), NEW.external_key);
  v_comercio := COALESCE(
    NULLIF(TRIM(NEW.comercio), ''),
    NULLIF(TRIM(v_comercio), ''),
    public.get_resolved_empresa(v_ref, 'Stocka')
  );

  v_enriched_raw := jsonb_build_object(
    'task_id', NEW.task_id,
    'task_guid', NEW.task_guid,
    'external_key', NEW.external_key,
    'my_id', NEW.my_id,
    'tracking_url', NEW.tracking_url,
    'status_id', NEW.status_id,
    'status_desc', NEW.status_desc,
    'status_display', v_status_text,
    'status_wms_normalized', NEW.status_wms_normalized,
    'is_final', NEW.is_final,
    'final_reason', NEW.final_reason,
    'driver_name', NEW.driver_name,
    'is_virtual_driver', NEW.is_virtual_driver,
    'tag2_alpha_stage', NEW.tag2_alpha_stage,
    'tag4_notes', NEW.tag4_notes,
    'failed_reason_code', NEW.failed_reason_code,
    'failed_reason_text', NEW.failed_reason_text,
    'completed_recipient_name', NEW.completed_recipient_name,
    'completed_notes', NEW.completed_notes,
    'completed_coordinates', NEW.completed_coordinates,
    'pod_images', COALESCE(NEW.pod_images, '[]'::jsonb),
    'history_events', COALESCE(NEW.history_events, '[]'::jsonb),
    'wd_completed_at', NEW.wd_completed_at,
    'wd_modified_at', NEW.wd_modified_at
  );

  INSERT INTO public.envios_unificados (
    id, source_table, source_id, empresa_comercio_proveedor,
    tracking, tracking_url, courier, status, global_status,
    created_at, updated_at, servicio_tipo_envio,
    nombre_destinatario, telefono_destino, email_cliente_destino,
    direccion_destino, complemento_destino, comuna_destino,
    pedido_referencia, raw_data
  ) VALUES (
    v_id,
    'woodelivery_envios',
    NEW.external_key,
    v_comercio,
    NEW.external_key,
    NEW.tracking_url,
    'ALPHA',
    v_status_text,
    v_global_status,
    COALESCE(NEW.wd_created_at, NEW.created_at),
    COALESCE(NEW.wd_completed_at, NEW.wd_modified_at, NEW.updated_at),
    'SAME DAY/24 HRS',
    NEW.recipient_name,
    NEW.recipient_phone,
    NEW.recipient_email,
    NEW.destination_address,
    NEW.completed_notes,
    NEW.zone_name,
    v_ref,
    v_enriched_raw
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

DROP TRIGGER IF EXISTS trg_sync_woodelivery ON public.woodelivery_envios;
CREATE TRIGGER trg_sync_woodelivery
  AFTER INSERT OR UPDATE ON public.woodelivery_envios
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_woodelivery_to_unified();

CREATE OR REPLACE FUNCTION public.delete_woodelivery_from_unified()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  DELETE FROM public.envios_unificados WHERE id = 'woodelivery_envios:' || OLD.external_key;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_delete_woodelivery ON public.woodelivery_envios;
CREATE TRIGGER trg_delete_woodelivery
  AFTER DELETE ON public.woodelivery_envios
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_woodelivery_from_unified();

-- =========================================================================================
-- 5. ACTUALIZAR sync_unified_status_to_orders_func()
--    - Restringe exclusión RECIBELO/WELIVERY/WOODELIVERY/WODELY solo a enviame_shipments
--    - Promueve tracking_url hacia https://app.woodelivery.com/t?q={guid} cuando llega WooDelivery
--    - Impide que LightData pise una URL de WooDelivery
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
  v_is_wd_url_upgrade BOOLEAN := FALSE;
BEGIN
  IF NEW.pedido_referencia IS NULL AND NEW.source_table <> 'woodelivery_envios' THEN
    RETURN NEW;
  END IF;

  v_courier_upper := UPPER(TRIM(COALESCE(NEW.courier, '')));
  IF NEW.source_table = 'enviame_shipments'
     AND v_courier_upper ~ '(RECIBELO|RECÍBELO|WELIVERY|WOODELIVERY|WODELY)' THEN
    RETURN NEW;
  END IF;

  IF NEW.source_table IN ('lightdata_envios', 'woodelivery_envios') THEN
    v_effective_tracking := COALESCE(NULLIF(TRIM(NEW.source_id), ''), NULLIF(TRIM(NEW.tracking), ''));
  ELSE
    v_effective_tracking := NULLIF(TRIM(NEW.tracking), '');
  END IF;

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

  IF v_effective_tracking IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolver pedido prioritariamente por tracking_number cuando viene de woodelivery_envios
  IF NEW.source_table = 'woodelivery_envios' THEN
    SELECT id, estado_wms, categoria_entrega, tracking_number, tracking_url, raw_shopify_data
    INTO v_order_uuid, v_current_wms_status, v_current_cat, v_current_track, v_current_url, v_current_raw_shopify
    FROM public.orders
    WHERE tracking_number = v_effective_tracking
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  IF v_order_uuid IS NULL AND NEW.pedido_referencia IS NOT NULL AND NEW.pedido_referencia ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id, estado_wms, categoria_entrega, tracking_number, tracking_url, raw_shopify_data
    INTO v_order_uuid, v_current_wms_status, v_current_cat, v_current_track, v_current_url, v_current_raw_shopify
    FROM public.orders WHERE id = NEW.pedido_referencia::uuid;
  ELSIF v_order_uuid IS NULL AND NEW.pedido_referencia IS NOT NULL THEN
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
  ELSIF v_courier_upper LIKE '%ALPHA%' OR v_courier_upper LIKE '%LIGHTDATA%' OR v_courier_upper LIKE '%CARRIER EXTERNO%' OR NEW.source_table = 'woodelivery_envios' THEN v_target_operador := 'ALPHA';
  ELSIF v_courier_upper LIKE '%FALABELLA%' THEN v_target_operador := 'FALABELLA';
  ELSIF v_courier_upper LIKE '%MERCADO%' THEN v_target_operador := 'MERCADOLIBRE';
  ELSE v_target_operador := v_courier_upper;
  END IF;

  -- Detectar promoción de tracking_url a enlace público de WooDelivery (incluye reporte + fotos POD)
  v_is_wd_url_upgrade := (
    NEW.source_table = 'woodelivery_envios'
    AND v_clean_url IS NOT NULL
    AND v_clean_url ILIKE '%app.woodelivery.com/t?q=%'
    AND COALESCE(v_current_url, '') IS DISTINCT FROM v_clean_url
  );

  -- Nunca permitir que LightData degrade una URL de WooDelivery
  IF NEW.source_table = 'lightdata_envios' AND COALESCE(v_current_url, '') ILIKE '%app.woodelivery.com/t?q=%' THEN
    v_clean_url := v_current_url;
  END IF;

  IF v_is_wd_url_upgrade
     OR NEW.global_status = 'DESPACHADO'
     OR v_current_track IS NULL
     OR TRIM(v_current_track) = ''
     OR UPPER(TRIM(v_current_track)) IN ('NO INFORMADO', 'NOINFORMADO', 'NULL', 'UNDEFINED', 'N/A', '-') THEN
    UPDATE public.orders
    SET
      tracking_number = v_effective_tracking,
      tracking_url = CASE
        WHEN v_is_wd_url_upgrade THEN v_clean_url
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
        v_is_wd_url_upgrade
        OR COALESCE(tracking_number, '') IS DISTINCT FROM v_effective_tracking
        OR ((v_current_url IS NULL OR v_current_url ~* '(no\s*informado|no%20informado)') AND v_clean_url IS NOT NULL)
      );
  END IF;

  RETURN NEW;
END;
$function$;

-- =========================================================================================
-- 6. MOTOR PRINCIPAL handle_unified_shipment_status_change()
--    - Autoridad exclusiva de WooDelivery para cerrar pedidos ALPHA en 'Entregado'
--    - LightData solo avanza pre-retiro -> Despachado (NUNCA cierra Entregado ni pisa WooDelivery)
-- =========================================================================================
CREATE OR REPLACE FUNCTION public.handle_unified_shipment_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_courier_upper TEXT := UPPER(TRIM(COALESCE(NEW.courier, '')));
  v_class JSONB;
  v_norm TEXT;
  v_clean_status TEXT;
  v_eff_tracking TEXT;
  v_ship_comercio TEXT := UPPER(TRIM(COALESCE(NEW.empresa_comercio_proveedor, '')));
  v_ref_clean TEXT;
  v_sigla TEXT;
  v_order public.orders;
  v_forced_track TEXT;
  v_new_hist JSONB;
  v_target_wms TEXT := NULL;
  v_target_status TEXT := NULL;
  v_rule_id TEXT := NULL;
  v_admin_id UUID;
  v_inc_title TEXT;
  v_has_woodelivery BOOLEAN := FALSE;
  v_wd_url TEXT := NULL;
BEGIN
  IF NEW.source_table = 'enviame_shipments'
     AND v_courier_upper ~ '(RECIBELO|RECÍBELO|WELIVERY|WOODELIVERY|WODELY)' THEN
    RETURN NEW;
  END IF;

  -- Si este envío viene de LightData y ya existe seguimiento autoritativo en WooDelivery, ceder autoridad
  IF NEW.source_table = 'lightdata_envios' AND NEW.source_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.woodelivery_envios wd
      WHERE wd.external_key = NEW.source_id
        AND wd.source_kind = 'lightdata'
    ) INTO v_has_woodelivery;

    IF v_has_woodelivery THEN
      RETURN NEW;
    END IF;
  END IF;

  v_class := public.classify_shipment_transport_status(NEW.source_table, NEW.status, NEW.raw_data);
  v_norm := v_class->>'norm';
  v_clean_status := v_class->>'clean_status';

  -- REGLA DE AUTORIDAD ALPHA: LightData solo es confiable hasta el retiro en bodega.
  -- NUNCA permitir que LightData cierre un pedido como ENTREGADO (esa autoridad es exclusiva de WooDelivery).
  IF NEW.source_table = 'lightdata_envios' AND v_norm = 'ENTREGADO' THEN
    v_norm := 'EN TRÁNSITO';
    v_clean_status := 'Retirado por Alpha (esperando confirmación WooDelivery)';
  END IF;

  IF NEW.source_table IN ('lightdata_envios', 'woodelivery_envios') THEN
    v_eff_tracking := COALESCE(NULLIF(TRIM(NEW.source_id), ''), NULLIF(TRIM(NEW.tracking), ''));
  ELSE
    v_eff_tracking := NULLIF(TRIM(NEW.tracking), '');
  END IF;
  IF UPPER(COALESCE(v_eff_tracking, '')) IN ('N/A', 'NO INFORMADO', 'NOINFORMADO', 'NULL', 'UNDEFINED', '-') THEN
    v_eff_tracking := NULL;
  END IF;

  IF NEW.source_table = 'woodelivery_envios'
     AND NEW.tracking_url IS NOT NULL
     AND NEW.tracking_url ILIKE '%app.woodelivery.com/t?q=%' THEN
    v_wd_url := TRIM(NEW.tracking_url);
  END IF;

  -- 1. Resolver pedido con máxima precisión
  IF NEW.pedido_referencia IS NOT NULL AND NEW.pedido_referencia ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO v_order FROM public.orders WHERE id = NEW.pedido_referencia::uuid LIMIT 1;
  END IF;

  IF v_order.id IS NULL AND v_eff_tracking IS NOT NULL THEN
    SELECT * INTO v_order
    FROM public.orders o
    WHERE COALESCE((o.raw_shopify_data->'wms_forced_tracking'->>'active')::boolean, FALSE) IS TRUE
      AND UPPER(TRIM(o.raw_shopify_data->'wms_forced_tracking'->>'tracking_number')) = UPPER(v_eff_tracking)
    ORDER BY o.created_at DESC
    LIMIT 1;
  END IF;

  IF v_order.id IS NULL AND v_eff_tracking IS NOT NULL THEN
    SELECT * INTO v_order
    FROM public.orders o
    WHERE o.tracking_number = v_eff_tracking
      AND (v_ship_comercio IN ('', 'NO ASIGNADO', 'STOCKA') OR UPPER(TRIM(COALESCE(o.comercio, ''))) = v_ship_comercio)
    ORDER BY o.created_at DESC
    LIMIT 1;
  END IF;

  IF v_order.id IS NULL AND NEW.pedido_referencia IS NOT NULL AND TRIM(NEW.pedido_referencia) <> '' THEN
    v_ref_clean := REGEXP_REPLACE(TRIM(NEW.pedido_referencia), '^#+', '');
    IF v_ship_comercio NOT IN ('', 'NO ASIGNADO', 'STOCKA') THEN
      SELECT sigla INTO v_sigla FROM public.v_comercios_config WHERE UPPER(TRIM(nombre)) = v_ship_comercio LIMIT 1;
      IF v_sigla IS NOT NULL AND LENGTH(TRIM(v_sigla)) > 0 THEN
        v_ref_clean := REGEXP_REPLACE(v_ref_clean, '^' || TRIM(v_sigla) || '[#\-_]?', '', 'i');
      END IF;

      SELECT * INTO v_order
      FROM public.orders o
      WHERE UPPER(TRIM(COALESCE(o.comercio, ''))) = v_ship_comercio
        AND o.external_order_number IN (
          TRIM(NEW.pedido_referencia),
          v_ref_clean,
          '#' || v_ref_clean,
          COALESCE(v_sigla, '') || '#' || v_ref_clean,
          COALESCE(v_sigla, '') || v_ref_clean
        )
      ORDER BY o.created_at DESC
      LIMIT 1;
    ELSE
      IF LENGTH(v_ref_clean) >= 6 OR v_ref_clean ~ '^[A-Za-z]{2,}' THEN
        SELECT * INTO v_order
        FROM public.orders o
        WHERE o.external_order_number IN (TRIM(NEW.pedido_referencia), '#' || v_ref_clean, v_ref_clean)
        ORDER BY o.created_at DESC
        LIMIT 1;
      END IF;
    END IF;
  END IF;

  IF v_order.id IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(v_order.estado_wms, '') IN ('Entregado', 'Cancelado', 'Archivado') THEN
    RETURN NEW;
  END IF;

  IF v_order.raw_shopify_data IS NOT NULL
     AND COALESCE((v_order.raw_shopify_data->'wms_forced_tracking'->>'active')::boolean, FALSE) IS TRUE THEN
    v_forced_track := NULLIF(TRIM(v_order.raw_shopify_data->'wms_forced_tracking'->>'tracking_number'), '');
    IF v_forced_track IS NOT NULL
       AND UPPER(v_forced_track) <> UPPER(COALESCE(v_eff_tracking, ''))
       AND UPPER(v_forced_track) <> UPPER(COALESCE(NEW.source_id, '')) THEN
      RETURN NEW;
    END IF;
  END IF;

  v_new_hist := public.append_order_tracking_checkpoint(
    v_order.tracking_history,
    v_clean_status,
    v_norm,
    NEW.source_table,
    COALESCE(NEW.updated_at, NOW())
  );

  -- Evaluar reglas del Centro de Automatizaciones
  IF v_norm = 'ENTREGADO' THEN
    IF UPPER(TRIM(COALESCE(v_order.categoria_entrega, ''))) IN ('LOGÍSTICA INVERSA', 'LOGISTICA INVERSA') THEN
      IF public.is_automation_rule_enabled('auto-reverse-logistics-to-entregado') THEN
        v_target_wms := 'Entregado';
        v_target_status := 'entregado';
        v_rule_id := 'auto-reverse-logistics-to-entregado';
      END IF;
    ELSIF public.is_automation_rule_enabled('auto-dispatch-delivered-to-entregado') THEN
      v_target_wms := 'Entregado';
      v_target_status := 'entregado';
      v_rule_id := 'auto-dispatch-delivered-to-entregado';
    END IF;

  ELSIF v_norm = 'EN TRÁNSITO'
        AND UPPER(TRIM(COALESCE(v_order.categoria_entrega, ''))) <> 'RETIRO'
        AND COALESCE(v_order.estado_wms, 'En procesamiento') IN ('En procesamiento', 'En preparación', 'Pickeado') THEN
    IF public.is_automation_rule_enabled('auto-transport-in-transit-to-despachado') THEN
      v_target_wms := 'Despachado';
      v_target_status := 'despachado';
      v_rule_id := 'auto-transport-in-transit-to-despachado';
    END IF;

  ELSIF v_norm IN ('ALERTA', 'DEVOLUCIÓN')
        AND COALESCE(v_order.estado_wms, 'En procesamiento') <> 'Incidencia' THEN
    v_target_wms := 'Incidencia';
    v_target_status := 'incidencia';
  END IF;

  IF v_target_wms IS NOT NULL AND v_order.estado_wms IS DISTINCT FROM v_target_wms THEN
    IF v_target_wms IN ('Despachado', 'Entregado')
       AND COALESCE(v_order.estado_wms, 'En procesamiento') IN ('En procesamiento', 'En preparación')
       AND v_order.picker_operator IS NULL THEN
      SELECT id INTO v_admin_id FROM public.profiles WHERE role = 'admin' LIMIT 1;
      v_inc_title := 'Alerta Picking: Tránsito/Entrega sin cierre Picker - Pedido ' || COALESCE(v_order.external_order_number, v_order.id::text);
      IF v_admin_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.incidencias WHERE title = v_inc_title AND status = 'pendiente'
      ) THEN
        INSERT INTO public.incidencias (
          user_id, comercio, title, description, solution, type, severity, status
        ) VALUES (
          v_admin_id,
          'ADMIN_ONLY',
          v_inc_title,
          'El pedido ' || COALESCE(v_order.external_order_number, v_order.id::text) || ' (' || COALESCE(v_order.comercio, '-') || ') pasó automáticamente de "' || COALESCE(v_order.estado_wms, 'En procesamiento') || '" a "' || v_target_wms || '" porque el courier (' || COALESCE(NEW.courier, NEW.source_table) || ') reportó "' || v_clean_status || '", sin registro previo de cierre en App Picker.',
          'Verificar en historial de Picker y confirmar limpieza de orden activa.',
          'pedido',
          'medio',
          'pendiente'
        );
      END IF;
    END IF;

    PERFORM set_config('app.physical_carrier_transition', 'true', true);

    UPDATE public.orders
    SET
      estado_wms = v_target_wms,
      status = v_target_status,
      transport_status_normalized = v_norm,
      tracking_history = v_new_hist,
      woodelivery_status = CASE WHEN NEW.source_table = 'woodelivery_envios' THEN v_clean_status ELSE woodelivery_status END,
      raw_woodelivery_data = CASE WHEN NEW.source_table = 'woodelivery_envios' THEN NEW.raw_data ELSE raw_woodelivery_data END,
      tracking_url = CASE WHEN v_wd_url IS NOT NULL THEN v_wd_url ELSE tracking_url END,
      dispatched_at = CASE WHEN v_target_wms IN ('Despachado', 'Entregado') THEN COALESCE(dispatched_at, NEW.updated_at, NOW()) ELSE dispatched_at END,
      delivered_at = CASE WHEN v_target_wms = 'Entregado' THEN COALESCE(delivered_at, NEW.updated_at, NOW()) ELSE delivered_at END,
      closed_at = CASE WHEN v_target_wms = 'Entregado' THEN NOW() ELSE closed_at END,
      closed_by_automation = COALESCE(v_rule_id, closed_by_automation)
    WHERE id = v_order.id;

    IF v_rule_id IS NOT NULL THEN
      PERFORM public.log_automation_execution(
        v_rule_id,
        v_order.id,
        v_order.external_order_number,
        v_order.comercio,
        COALESCE(v_order.estado_wms, 'En procesamiento'),
        v_target_wms,
        NEW.source_table || ':' || COALESCE(NEW.courier, ''),
        'Estado courier: "' || v_clean_status || '" (' || v_norm || ') · Guía: ' || COALESCE(v_eff_tracking, 'S/N'),
        FALSE
      );
    END IF;

    INSERT INTO public.order_audit_logs (order_id, user_id, user_email, action, details)
    VALUES (
      v_order.id,
      NULL,
      'Centro de Automatizaciones WMS',
      'Cambio Automático por Estado de Transporte',
      jsonb_build_object(
        'rule_id', v_rule_id,
        'previous_wms_status', v_order.estado_wms,
        'new_wms_status', v_target_wms,
        'transport_status', v_clean_status,
        'normalized_status', v_norm,
        'courier', NEW.courier,
        'tracking', v_eff_tracking,
        'shipment_id', NEW.id,
        'changes', jsonb_build_array(
          'Estado WMS actualizado de "' || COALESCE(v_order.estado_wms, 'En procesamiento') || '" a "' || v_target_wms || '" por transporte (' || v_clean_status || ')'
        )
      )
    );
  ELSE
    IF (v_order.transport_status_normalized IS DISTINCT FROM v_norm)
       OR (v_order.tracking_history IS DISTINCT FROM v_new_hist)
       OR (NEW.source_table = 'woodelivery_envios' AND (
            COALESCE(v_order.woodelivery_status, '') IS DISTINCT FROM COALESCE(v_clean_status, '')
            OR (v_wd_url IS NOT NULL AND COALESCE(v_order.tracking_url, '') IS DISTINCT FROM v_wd_url)
          )) THEN
      UPDATE public.orders
      SET transport_status_normalized = v_norm,
          tracking_history = v_new_hist,
          woodelivery_status = CASE WHEN NEW.source_table = 'woodelivery_envios' THEN v_clean_status ELSE woodelivery_status END,
          raw_woodelivery_data = CASE WHEN NEW.source_table = 'woodelivery_envios' THEN NEW.raw_data ELSE raw_woodelivery_data END,
          tracking_url = CASE WHEN v_wd_url IS NOT NULL THEN v_wd_url ELSE tracking_url END
      WHERE id = v_order.id
        AND estado_wms <> 'Entregado';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- =========================================================================================
-- 7. ACTUALIZAR enqueue_shopify_fulfillment_trigger_func()
--    - Quita lightdata_status de v_is_delivered (solo WooDelivery / estado_wms / Optiroute cierran Entregado)
--    - Soporta woodelivery_status y promociona tracking_url a Shopify cuando se actualiza al link WooDelivery
-- =========================================================================================
CREATE OR REPLACE FUNCTION public.enqueue_shopify_fulfillment_trigger_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_integration RECORD;
    v_shopify_order_id TEXT;
    v_action TEXT;
    v_existing_queue_id UUID;
    v_has_tracking BOOLEAN;
    v_is_dispatched BOOLEAN;
    v_was_dispatched BOOLEAN;
    v_is_delivered BOOLEAN;
    v_was_delivered BOOLEAN;
    v_is_in_transit BOOLEAN;
    v_was_in_transit BOOLEAN;
    v_tracking_changed BOOLEAN;
    v_tracking_url_upgraded BOOLEAN;
    v_is_preparing BOOLEAN;
    v_is_picked BOOLEAN;
    v_was_picked BOOLEAN;
    v_is_pickup BOOLEAN;
BEGIN
    IF NEW.external_platform IS NULL OR UPPER(NEW.external_platform) != 'SHOPIFY' THEN
        RETURN NEW;
    END IF;

    IF COALESCE(NEW.closed_by_automation, '') LIKE 'backfill:%'
       AND COALESCE(NEW.created_at, NOW()) < NOW() - INTERVAL '7 days' THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF (OLD.estado_wms IS NOT DISTINCT FROM NEW.estado_wms)
           AND (OLD.status IS NOT DISTINCT FROM NEW.status)
           AND (OLD.lightdata_status IS NOT DISTINCT FROM NEW.lightdata_status)
           AND (OLD.woodelivery_status IS NOT DISTINCT FROM NEW.woodelivery_status)
           AND (OLD.estado_ruta_optiroute IS NOT DISTINCT FROM NEW.estado_ruta_optiroute)
           AND (OLD.tracking_number IS NOT DISTINCT FROM NEW.tracking_number)
           AND (OLD.tracking_url IS NOT DISTINCT FROM NEW.tracking_url)
           AND (OLD.courier IS NOT DISTINCT FROM NEW.courier) THEN
            RETURN NEW;
        END IF;
    END IF;

    SELECT id, merchant_id, sync_tracking_enabled, sync_intermediate_statuses, granted_scopes
    INTO v_integration
    FROM public.merchant_integrations
    WHERE platform = 'Shopify'
      AND is_active = true
      AND UPPER(TRIM(comercio)) = UPPER(TRIM(NEW.comercio))
    LIMIT 1;

    IF v_integration.id IS NULL OR COALESCE(v_integration.sync_tracking_enabled, false) = false THEN
        RETURN NEW;
    END IF;

    BEGIN
        v_shopify_order_id := NEW.raw_shopify_data->>'id';
    EXCEPTION WHEN OTHERS THEN
        v_shopify_order_id := NULL;
    END;

    IF v_shopify_order_id IS NULL OR v_shopify_order_id = '' THEN
        RETURN NEW;
    END IF;

    v_is_pickup := (UPPER(TRIM(COALESCE(NEW.categoria_entrega, ''))) = 'RETIRO')
                   OR (UPPER(TRIM(COALESCE(NEW.agenda, ''))) = 'RETIRO')
                   OR (UPPER(TRIM(COALESCE(NEW.operador, ''))) LIKE 'SUCURSAL%')
                   OR (LOWER(COALESCE(NEW.shipping_method, '')) LIKE '%retiro%');

    -- Autoridad ALPHA: lightdata_status NO dispara set_delivered (solo estado_wms = Entregado o woodelivery_status Entregado/Completed)
    v_is_delivered := (LOWER(TRIM(COALESCE(NEW.status, ''))) IN ('entregado', 'delivered'))
                      OR (LOWER(TRIM(COALESCE(NEW.estado_wms, ''))) = 'entregado')
                      OR (LOWER(TRIM(COALESCE(NEW.woodelivery_status, ''))) IN ('entregado', 'completed', 'delivered'))
                      OR (LOWER(COALESCE(NEW.estado_ruta_optiroute, '')) LIKE '%entregad%')
                      OR (LOWER(COALESCE(NEW.estado_ruta_optiroute, '')) LIKE '%deliver%');
    v_was_delivered := CASE WHEN TG_OP = 'UPDATE' THEN
        (LOWER(TRIM(COALESCE(OLD.status, ''))) IN ('entregado', 'delivered'))
        OR (LOWER(TRIM(COALESCE(OLD.estado_wms, ''))) = 'entregado')
        OR (LOWER(TRIM(COALESCE(OLD.woodelivery_status, ''))) IN ('entregado', 'completed', 'delivered'))
        OR (LOWER(COALESCE(OLD.estado_ruta_optiroute, '')) LIKE '%entregad%')
        OR (LOWER(COALESCE(OLD.estado_ruta_optiroute, '')) LIKE '%deliver%')
    ELSE false END;

    v_is_in_transit := (LOWER(TRIM(COALESCE(NEW.status, ''))) IN ('en tránsito', 'en transito', 'in_transit', 'en reparto'))
                       OR (LOWER(COALESCE(NEW.woodelivery_status, '')) ~ '(tr[aá]nsito|reparto|ruta|camino|planta|cargado|destino|transit|arrived|loaded|processed)')
                       OR (LOWER(COALESCE(NEW.lightdata_status, '')) ~ '(camino|planta|recepcionado|clasificado|reparto|tránsito|transito|ruta)')
                       OR (LOWER(COALESCE(NEW.estado_ruta_optiroute, '')) ~ '(route|ruta|camino|onroute|ongoing|arrived)');
    v_was_in_transit := CASE WHEN TG_OP = 'UPDATE' THEN
        (LOWER(TRIM(COALESCE(OLD.status, ''))) IN ('en tránsito', 'en transito', 'in_transit', 'en reparto'))
        OR (LOWER(COALESCE(OLD.woodelivery_status, '')) ~ '(tr[aá]nsito|reparto|ruta|camino|planta|cargado|destino|transit|arrived|loaded|processed)')
        OR (LOWER(COALESCE(OLD.lightdata_status, '')) ~ '(camino|planta|recepcionado|clasificado|reparto|tránsito|transito|ruta)')
        OR (LOWER(COALESCE(OLD.estado_ruta_optiroute, '')) ~ '(route|ruta|camino|onroute|ongoing|arrived)')
    ELSE false END;

    v_is_dispatched := (LOWER(COALESCE(NEW.estado_wms, '')) IN ('despachado', 'entregado'))
                       OR (LOWER(COALESCE(NEW.status, '')) IN ('despachado', 'retirado', 'entregado'));
    v_was_dispatched := CASE WHEN TG_OP = 'UPDATE' THEN
        (LOWER(COALESCE(OLD.estado_wms, '')) IN ('despachado', 'entregado'))
        OR (LOWER(COALESCE(OLD.status, '')) IN ('despachado', 'retirado', 'entregado'))
    ELSE false END;

    v_has_tracking := (
        NEW.tracking_number IS NOT NULL
        AND TRIM(NEW.tracking_number) != ''
        AND UPPER(TRIM(NEW.tracking_number)) NOT IN ('N/A', 'S/N', 'NO INFORMADO', 'NOINFORMADO', 'NULL', '-')
        AND TRIM(NEW.tracking_number) != TRIM(COALESCE(NEW.external_order_number, ''))
        AND TRIM(NEW.tracking_number) !~ '^46[0-9]{6,}$'
    );
    v_tracking_changed := CASE WHEN TG_OP = 'UPDATE' THEN
        v_has_tracking AND (COALESCE(TRIM(OLD.tracking_number), '') IS DISTINCT FROM COALESCE(TRIM(NEW.tracking_number), ''))
    ELSE v_has_tracking END;

    v_tracking_url_upgraded := CASE WHEN TG_OP = 'UPDATE' THEN
        v_has_tracking
        AND COALESCE(NEW.tracking_url, '') ILIKE '%app.woodelivery.com/t?q=%'
        AND COALESCE(TRIM(OLD.tracking_url), '') IS DISTINCT FROM COALESCE(TRIM(NEW.tracking_url), '')
    ELSE false END;

    v_is_preparing := (LOWER(TRIM(COALESCE(NEW.estado_wms, ''))) = 'en preparación');
    v_is_picked := (LOWER(TRIM(COALESCE(NEW.estado_wms, ''))) IN ('pickeado', 'listo para retiro'))
                   OR (LOWER(TRIM(COALESCE(NEW.status, ''))) = 'listo para retiro');
    v_was_picked := CASE WHEN TG_OP = 'UPDATE' THEN
        (LOWER(TRIM(COALESCE(OLD.estado_wms, ''))) IN ('pickeado', 'listo para retiro'))
        OR (LOWER(TRIM(COALESCE(OLD.status, ''))) = 'listo para retiro')
    ELSE false END;

    IF v_is_delivered AND NOT v_is_pickup AND (NEW.shopify_fulfillment_id IS NULL OR TRIM(NEW.shopify_fulfillment_id) = '') THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.shopify_fulfillment_queue
            WHERE order_id = NEW.id AND action_type = 'create_fulfillment' AND status IN ('pending', 'processing', 'completed', 'needs_reauth')
        ) THEN
            INSERT INTO public.shopify_fulfillment_queue (
                order_id, merchant_id, comercio, shopify_order_id,
                tracking_number, tracking_url, courier, operador, action_type, status
            ) VALUES (
                NEW.id, v_integration.merchant_id, NEW.comercio, v_shopify_order_id,
                NEW.tracking_number, NEW.tracking_url, NEW.courier, NEW.operador, 'create_fulfillment', 'pending'
            );
        END IF;
    END IF;

    -- Si la URL promocionó al enlace público de WooDelivery y ya existe fulfillment en Shopify, encolar update_tracking primero
    IF v_tracking_url_upgraded AND NOT v_is_pickup AND NEW.shopify_fulfillment_id IS NOT NULL AND TRIM(NEW.shopify_fulfillment_id) != '' THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.shopify_fulfillment_queue
            WHERE order_id = NEW.id
              AND action_type = 'update_tracking'
              AND status IN ('pending', 'processing', 'completed')
              AND TRIM(COALESCE(tracking_url, '')) = TRIM(COALESCE(NEW.tracking_url, ''))
        ) THEN
            INSERT INTO public.shopify_fulfillment_queue (
                order_id, merchant_id, comercio, shopify_order_id,
                tracking_number, tracking_url, courier, operador,
                shopify_fulfillment_id, action_type, status
            ) VALUES (
                NEW.id, v_integration.merchant_id, NEW.comercio, v_shopify_order_id,
                NEW.tracking_number, NEW.tracking_url, NEW.courier, NEW.operador,
                NEW.shopify_fulfillment_id, 'update_tracking', 'pending'
            );
        END IF;
    END IF;

    -- CASO 0: Pedido con transporte ENTREGADO -> "Entregado" (set_delivered) en Shopify
    IF v_is_delivered AND NOT v_was_delivered AND NOT v_is_pickup THEN
        SELECT id INTO v_existing_queue_id
        FROM public.shopify_fulfillment_queue
        WHERE order_id = NEW.id
          AND action_type = 'set_delivered'
          AND status IN ('pending', 'processing', 'completed', 'needs_reauth')
        LIMIT 1;

        IF v_existing_queue_id IS NULL THEN
            INSERT INTO public.shopify_fulfillment_queue (
                order_id, merchant_id, comercio, shopify_order_id,
                tracking_number, tracking_url, courier, operador,
                shopify_fulfillment_id, action_type, status
            ) VALUES (
                NEW.id, v_integration.merchant_id, NEW.comercio, v_shopify_order_id,
                NEW.tracking_number, NEW.tracking_url, NEW.courier, NEW.operador,
                NEW.shopify_fulfillment_id, 'set_delivered', 'pending'
            );
        END IF;
        RETURN NEW;
    END IF;

    -- CASO 0.5: Pedido con transporte EN TRÁNSITO -> "En tránsito" (set_in_transit) en Shopify
    IF v_is_in_transit AND NOT v_was_in_transit AND NOT v_is_pickup AND NOT v_is_delivered THEN
        SELECT id INTO v_existing_queue_id
        FROM public.shopify_fulfillment_queue
        WHERE order_id = NEW.id
          AND action_type = 'set_in_transit'
          AND status IN ('pending', 'processing', 'completed', 'needs_reauth')
        LIMIT 1;

        IF v_existing_queue_id IS NULL THEN
            INSERT INTO public.shopify_fulfillment_queue (
                order_id, merchant_id, comercio, shopify_order_id,
                tracking_number, tracking_url, courier, operador,
                shopify_fulfillment_id, action_type, status
            ) VALUES (
                NEW.id, v_integration.merchant_id, NEW.comercio, v_shopify_order_id,
                NEW.tracking_number, NEW.tracking_url, NEW.courier, NEW.operador,
                NEW.shopify_fulfillment_id, 'set_in_transit', 'pending'
            );
        END IF;
        RETURN NEW;
    END IF;

    -- CASO A: Pedido Despachado / Retirado (o actualización de tracking)
    IF (v_is_dispatched AND (NOT v_was_dispatched OR (v_tracking_changed AND NOT v_is_delivered AND COALESCE(NEW.shopify_order_status, '') != 'delivered')))
       OR (v_is_picked AND NOT v_is_pickup AND v_tracking_changed AND NEW.shopify_fulfillment_id IS NOT NULL) THEN
        IF NEW.shopify_fulfillment_id IS NOT NULL AND TRIM(NEW.shopify_fulfillment_id) != '' THEN
            v_action := 'update_tracking';
        ELSE
            v_action := 'create_fulfillment';
        END IF;

        IF v_action = 'update_tracking' THEN
            IF NOT v_has_tracking THEN RETURN NEW; END IF;
            IF EXISTS (
                SELECT 1 FROM public.shopify_fulfillment_queue
                WHERE order_id = NEW.id
                  AND action_type IN ('create_fulfillment', 'update_tracking')
                  AND status = 'completed'
                  AND TRIM(COALESCE(tracking_number, '')) = TRIM(COALESCE(NEW.tracking_number, ''))
                  AND TRIM(COALESCE(tracking_url, '')) = TRIM(COALESCE(NEW.tracking_url, ''))
            ) THEN
                RETURN NEW;
            END IF;
        END IF;

        SELECT id INTO v_existing_queue_id
        FROM public.shopify_fulfillment_queue
        WHERE order_id = NEW.id AND action_type = v_action AND status IN ('pending', 'needs_reauth')
        LIMIT 1;

        IF v_existing_queue_id IS NOT NULL THEN
            UPDATE public.shopify_fulfillment_queue
            SET tracking_number = NEW.tracking_number,
                tracking_url = NEW.tracking_url,
                courier = NEW.courier,
                operador = NEW.operador,
                shopify_fulfillment_id = NEW.shopify_fulfillment_id,
                status = 'pending',
                updated_at = NOW()
            WHERE id = v_existing_queue_id;
        ELSE
            INSERT INTO public.shopify_fulfillment_queue (
                order_id, merchant_id, comercio, shopify_order_id,
                tracking_number, tracking_url, courier, operador,
                shopify_fulfillment_id, action_type, status
            ) VALUES (
                NEW.id, v_integration.merchant_id, NEW.comercio, v_shopify_order_id,
                NEW.tracking_number, NEW.tracking_url, NEW.courier, NEW.operador,
                NEW.shopify_fulfillment_id, v_action, 'pending'
            );
        END IF;

        RETURN NEW;
    END IF;

    -- CASO B1: Distribución Pickeado -> create_fulfillment
    IF v_is_picked AND (NOT v_is_pickup) AND (NOT v_was_picked)
       AND (NEW.shopify_fulfillment_id IS NULL OR TRIM(NEW.shopify_fulfillment_id) = '') THEN
        SELECT id INTO v_existing_queue_id
        FROM public.shopify_fulfillment_queue
        WHERE order_id = NEW.id AND action_type = 'create_fulfillment' AND status IN ('pending', 'processing', 'completed', 'needs_reauth')
        LIMIT 1;
        IF v_existing_queue_id IS NULL THEN
            INSERT INTO public.shopify_fulfillment_queue (
                order_id, merchant_id, comercio, shopify_order_id,
                tracking_number, tracking_url, courier, operador, action_type, status
            ) VALUES (
                NEW.id, v_integration.merchant_id, NEW.comercio, v_shopify_order_id,
                NEW.tracking_number, NEW.tracking_url, NEW.courier, NEW.operador, 'create_fulfillment', 'pending'
            );
        END IF;
        RETURN NEW;
    END IF;

    -- CASO B2: Retiro en "Listo para retiro" -> set_ready_for_pickup
    IF v_is_picked AND v_is_pickup AND (NOT v_was_picked) AND (NEW.shopify_fulfillment_id IS NULL) THEN
        SELECT id INTO v_existing_queue_id
        FROM public.shopify_fulfillment_queue
        WHERE order_id = NEW.id AND action_type = 'set_ready_for_pickup' AND status IN ('pending', 'processing', 'completed', 'needs_reauth')
        LIMIT 1;
        IF v_existing_queue_id IS NULL THEN
            INSERT INTO public.shopify_fulfillment_queue (
                order_id, merchant_id, comercio, shopify_order_id, action_type, status
            ) VALUES (
                NEW.id, v_integration.merchant_id, NEW.comercio, v_shopify_order_id, 'set_ready_for_pickup', 'pending'
            );
        END IF;
        RETURN NEW;
    END IF;

    -- CASO C: En Preparación -> set_in_progress
    IF v_is_preparing
       AND (COALESCE(v_integration.sync_intermediate_statuses, true) = true)
       AND (NEW.shopify_fulfillment_id IS NULL)
       AND (TG_OP = 'INSERT' OR LOWER(COALESCE(OLD.estado_wms, '')) NOT IN ('en preparación', 'pickeado', 'listo para retiro', 'despachado', 'entregado')) THEN
        SELECT id INTO v_existing_queue_id
        FROM public.shopify_fulfillment_queue
        WHERE order_id = NEW.id AND action_type = 'set_in_progress' AND status IN ('pending', 'processing', 'completed', 'needs_reauth')
        LIMIT 1;
        IF v_existing_queue_id IS NULL THEN
            INSERT INTO public.shopify_fulfillment_queue (
                order_id, merchant_id, comercio, shopify_order_id, action_type, status
            ) VALUES (
                NEW.id, v_integration.merchant_id, NEW.comercio, v_shopify_order_id, 'set_in_progress', 'pending'
            );
        END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Aviso en enqueue_shopify_fulfillment_trigger_func: %', SQLERRM;
    RETURN NEW;
END;
$function$;

-- =========================================================================================
-- 8. ACTUALIZAR build_order_closed_snapshot() Y build_public_tracking_order_json()
--    CON PRIORIDAD WOODELIVERY + FOTOS POD + RECEPTOR + GPS
-- =========================================================================================
CREATE OR REPLACE FUNCTION public.build_order_closed_snapshot(p_order public.orders)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cat TEXT := UPPER(TRIM(COALESCE(p_order.categoria_entrega, 'DISTRIBUCIÓN')));
  v_ext_clean TEXT := REGEXP_REPLACE(TRIM(COALESCE(p_order.external_order_number, '')), '^#+', '');
  v_forced_track TEXT := NULL;
  v_clean_track TEXT := NULL;
  v_ship_j JSONB := NULL;
  v_opti_j JSONB := NULL;
  v_wd_j JSONB := NULL;
  v_pickup_j JSONB := NULL;
  v_mkt JSONB;
  v_ship_json JSONB;
  v_pickup_json JSONB;
  v_picking_json JSONB;
  v_items_json JSONB := '[]'::jsonb;
  v_total_units INT := 0;
  v_eff_courier TEXT;
  v_eff_tracking TEXT;
  v_eff_url TEXT;
  v_delivered_at TIMESTAMPTZ;
  v_hist JSONB;
  v_logs_json JSONB;
  v_wd_lat TEXT := NULL;
  v_wd_lng TEXT := NULL;
BEGIN
  IF p_order.raw_shopify_data IS NOT NULL
     AND COALESCE((p_order.raw_shopify_data->'wms_forced_tracking'->>'active')::boolean, FALSE) IS TRUE THEN
    v_forced_track := NULLIF(TRIM(p_order.raw_shopify_data->'wms_forced_tracking'->>'tracking_number'), '');
  END IF;

  IF p_order.tracking_number IS NOT NULL
     AND TRIM(p_order.tracking_number) <> ''
     AND UPPER(TRIM(p_order.tracking_number)) NOT IN ('N/A', 'NO INFORMADO', 'NOINFORMADO', 'NULL', '-') THEN
    v_clean_track := TRIM(p_order.tracking_number);
  END IF;

  IF v_cat = 'RETIRO' OR UPPER(TRIM(COALESCE(p_order.agenda, ''))) = 'RETIRO' THEN
    SELECT to_jsonb(sp)
    INTO v_pickup_j
    FROM public.store_pickups sp
    WHERE sp.pedido = ANY(ARRAY[
      COALESCE(p_order.external_order_number, ''),
      v_ext_clean,
      '#' || v_ext_clean,
      p_order.id::text
    ])
    AND (p_order.comercio IS NULL OR sp.comercio IS NULL OR LOWER(TRIM(sp.comercio)) = LOWER(TRIM(p_order.comercio)))
    ORDER BY sp.updated_at DESC NULLS LAST, sp.id DESC
    LIMIT 1;
  END IF;

  IF v_cat NOT IN ('RETIRO', 'SHOP POINT (POS)', 'SHOP POINT', 'POS') THEN
    IF v_forced_track IS NOT NULL THEN
      SELECT to_jsonb(t)
      INTO v_ship_j
      FROM (
        SELECT
          c.id, c.source_table, c.source_id, c.courier, c.tracking, c.tracking_url,
          c.servicio_tipo_envio, c.created_at, c.updated_at,
          (public.classify_shipment_transport_status(c.source_table, c.status, c.raw_data))->>'norm' AS norm_st,
          (public.classify_shipment_transport_status(c.source_table, c.status, c.raw_data))->>'clean_status' AS clean_st
        FROM (
          SELECT eu.* FROM public.envios_unificados eu WHERE eu.tracking = v_forced_track
          UNION ALL
          SELECT eu.* FROM public.envios_unificados eu WHERE eu.source_table IN ('woodelivery_envios', 'lightdata_envios') AND eu.source_id = v_forced_track
        ) c
        WHERE NOT (c.source_table = 'enviame_shipments' AND UPPER(COALESCE(c.courier, '')) ~ '(RECIBELO|RECÍBELO|WELIVERY|WOODELIVERY|WODELY)')
        ORDER BY
          CASE WHEN c.source_table = 'woodelivery_envios' THEN 10 ELSE 0 END DESC,
          CASE WHEN (public.classify_shipment_transport_status(c.source_table, c.status, c.raw_data))->>'norm' = 'ENTREGADO' THEN 3
               WHEN (public.classify_shipment_transport_status(c.source_table, c.status, c.raw_data))->>'norm' = 'EN TRÁNSITO' THEN 2
               ELSE 1 END DESC,
          c.updated_at DESC NULLS LAST
        LIMIT 1
      ) t;
    ELSE
      SELECT to_jsonb(t)
      INTO v_ship_j
      FROM (
        SELECT
          c.id, c.source_table, c.source_id, c.courier, c.tracking, c.tracking_url,
          c.servicio_tipo_envio, c.created_at, c.updated_at,
          (public.classify_shipment_transport_status(c.source_table, c.status, c.raw_data))->>'norm' AS norm_st,
          (public.classify_shipment_transport_status(c.source_table, c.status, c.raw_data))->>'clean_status' AS clean_st
        FROM (
          SELECT eu.* FROM public.envios_unificados eu
          WHERE v_clean_track IS NOT NULL AND eu.tracking = v_clean_track
          UNION ALL
          SELECT eu.* FROM public.envios_unificados eu
          WHERE v_clean_track IS NOT NULL AND eu.source_table IN ('woodelivery_envios', 'lightdata_envios') AND eu.source_id = v_clean_track
          UNION ALL
          SELECT eu.* FROM public.envios_unificados eu
          WHERE eu.pedido_referencia = ANY(ARRAY_REMOVE(ARRAY[
            NULLIF(TRIM(COALESCE(p_order.external_order_number, '')), ''),
            NULLIF(v_ext_clean, ''),
            CASE WHEN v_ext_clean <> '' THEN '#' || v_ext_clean ELSE NULL END,
            p_order.id::text
          ], NULL))
          AND (
            eu.pedido_referencia = p_order.id::text
            OR eu.empresa_comercio_proveedor IS NULL
            OR UPPER(TRIM(eu.empresa_comercio_proveedor)) IN ('', 'NO ASIGNADO', 'STOCKA')
            OR LOWER(TRIM(eu.empresa_comercio_proveedor)) = LOWER(TRIM(COALESCE(p_order.comercio, '')))
          )
        ) c
        WHERE NOT (c.source_table = 'enviame_shipments' AND UPPER(COALESCE(c.courier, '')) ~ '(RECIBELO|RECÍBELO|WELIVERY|WOODELIVERY|WODELY)')
        ORDER BY
          CASE WHEN c.source_table = 'woodelivery_envios' THEN 10 ELSE 0 END DESC,
          CASE WHEN (public.classify_shipment_transport_status(c.source_table, c.status, c.raw_data))->>'norm' = 'ENTREGADO' THEN 3
               WHEN (public.classify_shipment_transport_status(c.source_table, c.status, c.raw_data))->>'norm' = 'EN TRÁNSITO' THEN 2
               ELSE 1 END DESC,
          c.updated_at DESC NULLS LAST
        LIMIT 1
      ) t;
    END IF;

    -- Enriquecer metadatos directos de WooDelivery (POD, receptor, chofer, coordenadas) por PK O(1)
    IF COALESCE(v_forced_track, v_clean_track, v_ship_j->>'source_id') IS NOT NULL THEN
      SELECT to_jsonb(wd)
      INTO v_wd_j
      FROM public.woodelivery_envios wd
      WHERE wd.external_key = COALESCE(v_forced_track, v_clean_track, v_ship_j->>'source_id')
        AND wd.source_kind = 'lightdata'
      LIMIT 1;

      IF v_wd_j IS NOT NULL AND NULLIF(TRIM(v_wd_j->>'completed_coordinates'), '') IS NOT NULL AND POSITION(',' IN (v_wd_j->>'completed_coordinates')) > 0 THEN
        v_wd_lat := NULLIF(TRIM(split_part(v_wd_j->>'completed_coordinates', ',', 1)), '');
        v_wd_lng := NULLIF(TRIM(split_part(v_wd_j->>'completed_coordinates', ',', 2)), '');
      END IF;
    END IF;

    IF p_order.external_order_number IS NOT NULL AND v_ext_clean <> '' THEN
      SELECT to_jsonb(t)
      INTO v_opti_j
      FROM (
        SELECT
          opt.status AS opti_status,
          opt.servicio_tipo_envio AS opti_service_type,
          opt.raw_data->'assigned_vehicle'->>'name' AS opti_vehicle,
          opt.raw_data->>'route_started_at' AS opti_route_started_at,
          opt.raw_data->>'completed_at' AS opti_completed_at,
          COALESCE(opt.raw_data->'waypoint'->>'reception_name', opt.raw_data->>'reception_name') AS opti_reception_name,
          COALESCE(opt.raw_data->'waypoint'->>'reception_rut', opt.raw_data->>'reception_rut') AS opti_reception_rut,
          COALESCE(opt.raw_data->'waypoint'->>'latitude', opt.raw_data->'address'->>'latitude') AS opti_lat,
          COALESCE(opt.raw_data->'waypoint'->>'longitude', opt.raw_data->'address'->>'longitude') AS opti_lng
        FROM public.optiroute_orders opt
        WHERE opt.referencia = ANY(ARRAY[p_order.external_order_number, v_ext_clean, '#' || v_ext_clean])
        ORDER BY opt.updated_at DESC NULLS LAST, opt.created_at DESC NULLS LAST
        LIMIT 1
      ) t;
    END IF;

    IF v_opti_j IS NULL AND v_clean_track IS NOT NULL THEN
      SELECT to_jsonb(t)
      INTO v_opti_j
      FROM (
        SELECT
          opt.status AS opti_status,
          opt.servicio_tipo_envio AS opti_service_type,
          opt.raw_data->'assigned_vehicle'->>'name' AS opti_vehicle,
          opt.raw_data->>'route_started_at' AS opti_route_started_at,
          opt.raw_data->>'completed_at' AS opti_completed_at,
          COALESCE(opt.raw_data->'waypoint'->>'reception_name', opt.raw_data->>'reception_name') AS opti_reception_name,
          COALESCE(opt.raw_data->'waypoint'->>'reception_rut', opt.raw_data->>'reception_rut') AS opti_reception_rut,
          COALESCE(opt.raw_data->'waypoint'->>'latitude', opt.raw_data->'address'->>'latitude') AS opti_lat,
          COALESCE(opt.raw_data->'waypoint'->>'longitude', opt.raw_data->'address'->>'longitude') AS opti_lng
        FROM public.optiroute_orders opt
        WHERE opt.tracking = v_clean_track
        ORDER BY opt.updated_at DESC NULLS LAST, opt.created_at DESC NULLS LAST
        LIMIT 1
      ) t;
    END IF;
  END IF;

  v_mkt := public.extract_marketplace_or_pos_delivery(p_order);
  IF COALESCE((v_mkt->>'is_pos')::boolean, FALSE) IS TRUE THEN
    v_cat := 'SHOP POINT (POS)';
  ELSIF COALESCE(p_order.external_order_number, '') LIKE 'LI-%'
        OR COALESCE(p_order.origen, '') = 'Logística Inversa'
        OR v_cat IN ('LOGÍSTICA INVERSA', 'LOGISTICA INVERSA') THEN
    v_cat := 'LOGÍSTICA INVERSA';
  END IF;

  v_eff_courier := COALESCE(
    CASE WHEN v_cat = 'SHOP POINT (POS)' THEN 'Venta Presencial Sucursal Ñuñoa' END,
    CASE WHEN v_cat = 'LOGÍSTICA INVERSA' THEN COALESCE(NULLIF(TRIM(v_ship_j->>'courier'), ''), 'Logística Inversa Bodega') END,
    CASE WHEN v_cat = 'RETIRO' THEN 'Retiro en Sucursal' END,
    NULLIF(TRIM(v_ship_j->>'courier'), ''),
    NULLIF(TRIM(p_order.courier), ''),
    NULLIF(TRIM(v_mkt->>'courier'), ''),
    NULLIF(TRIM(p_order.operador), ''),
    'Transporte Stocka'
  );

  v_eff_tracking := COALESCE(
    v_forced_track,
    CASE WHEN (v_ship_j->>'source_table') IN ('woodelivery_envios', 'lightdata_envios') THEN NULLIF(TRIM(v_ship_j->>'source_id'), '') END,
    NULLIF(NULLIF(TRIM(p_order.tracking_number), 'No informado'), 'N/A'),
    NULLIF(NULLIF(TRIM(v_ship_j->>'tracking'), 'No informado'), 'N/A'),
    CASE WHEN (v_pickup_j->>'pin_retiro') IS NOT NULL AND TRIM(v_pickup_j->>'pin_retiro') <> '' THEN 'PIN: ' || (v_pickup_j->>'pin_retiro') END
  );

  v_eff_url := COALESCE(
    NULLIF(NULLIF(TRIM(v_wd_j->>'tracking_url'), 'N/A'), ''),
    NULLIF(NULLIF(TRIM(v_ship_j->>'tracking_url'), 'N/A'), ''),
    NULLIF(NULLIF(TRIM(p_order.tracking_url), 'N/A'), '')
  );

  BEGIN
    v_delivered_at := COALESCE(
      p_order.delivered_at,
      NULLIF(TRIM(v_wd_j->>'wd_completed_at'), '')::timestamptz,
      NULLIF(TRIM(v_opti_j->>'opti_completed_at'), '')::timestamptz,
      NULLIF(TRIM(v_ship_j->>'updated_at'), '')::timestamptz,
      NULLIF(TRIM(v_pickup_j->>'updated_at'), '')::timestamptz,
      NULLIF(TRIM(v_mkt->>'delivered_at'), '')::timestamptz,
      NOW()
    );
  EXCEPTION WHEN OTHERS THEN
    v_delivered_at := COALESCE(p_order.delivered_at, NOW());
  END;

  v_ship_json := jsonb_build_object(
    'id', COALESCE(v_ship_j->>'id', 'sealed:' || p_order.id::text),
    'source_table', COALESCE(v_ship_j->>'source_table', CASE WHEN v_cat = 'RETIRO' THEN 'store_pickups' ELSE COALESCE(v_mkt->>'source', 'orders') END),
    'source_id', COALESCE(v_ship_j->>'source_id', p_order.id::text),
    'courier', v_eff_courier,
    'operador', COALESCE(p_order.operador, v_eff_courier),
    'tracking', v_eff_tracking,
    'tracking_url', v_eff_url,
    'status', COALESCE(
      v_ship_j->>'clean_st',
      CASE WHEN v_cat = 'RETIRO' THEN 'Retirado por cliente en sucursal' END,
      v_mkt->>'status_text',
      'Entregado'
    ),
    'global_status', 'ENTREGADO',
    'service_type', COALESCE(
      v_ship_j->>'servicio_tipo_envio',
      v_opti_j->>'opti_service_type',
      p_order.shipping_method
    ),
    'created_at', COALESCE(v_ship_j->>'created_at', p_order.created_at::text),
    'updated_at', v_delivered_at,
    'delivered_at', v_delivered_at,
    'reception_name', COALESCE(
      NULLIF(TRIM(v_wd_j->>'completed_recipient_name'), ''),
      v_opti_j->>'opti_reception_name',
      v_pickup_j->>'nombre_apellido'
    ),
    'reception_rut', COALESCE(
      v_opti_j->>'opti_reception_rut',
      v_pickup_j->>'rut'
    ),
    'driver_name', NULLIF(TRIM(v_wd_j->>'driver_name'), ''),
    'completed_notes', NULLIF(TRIM(v_wd_j->>'completed_notes'), ''),
    'pod_images', COALESCE(v_wd_j->'pod_images', '[]'::jsonb),
    'proof_image', COALESCE(v_wd_j->'pod_images'->>0, NULL),
    'vehicle', v_opti_j->>'opti_vehicle',
    'route_started_at', v_opti_j->>'opti_route_started_at',
    'gps_lat', COALESCE(v_wd_lat, v_opti_j->>'opti_lat'),
    'gps_lng', COALESCE(v_wd_lng, v_opti_j->>'opti_lng'),
    'gps', CASE WHEN COALESCE(v_wd_lat, NULLIF(TRIM(v_opti_j->>'opti_lat'), '')) IS NOT NULL
                     AND COALESCE(v_wd_lng, NULLIF(TRIM(v_opti_j->>'opti_lng'), '')) IS NOT NULL
                THEN jsonb_build_object(
                  'lat', COALESCE(v_wd_lat, v_opti_j->>'opti_lat'),
                  'lng', COALESCE(v_wd_lng, v_opti_j->>'opti_lng')
                )
                ELSE NULL END
  );

  v_pickup_json := jsonb_build_object(
    'is_pickup', (v_cat = 'RETIRO' OR UPPER(TRIM(COALESCE(p_order.agenda, ''))) = 'RETIRO'),
    'pin_retiro', v_pickup_j->>'pin_retiro',
    'sucursal', COALESCE(v_pickup_j->>'sucursal', p_order.sucursal_pickeo),
    'estado_pedido', COALESCE(v_pickup_j->>'estado_pedido', CASE WHEN v_cat = 'RETIRO' THEN 'ENTREGADO' ELSE NULL END),
    'ready_for_pickup_at', p_order.ready_for_pickup_at,
    'fecha_retiro', v_pickup_j->>'fecha_retiro',
    'hora_retiro', v_pickup_j->>'hora_retiro',
    'picker_entrega', v_pickup_j->>'picker_entrega',
    'rut_retira', v_pickup_j->>'rut'
  );

  v_logs_json := COALESCE(
    p_order.picker_history_snapshot->'logs',
    p_order.picker_history_snapshot->'history_logs',
    '[]'::jsonb
  );

  v_picking_json := jsonb_build_object(
    'status', COALESCE(p_order.picker_status, p_order.picker_history_snapshot->>'status', 'Completado'),
    'operator', COALESCE(
      p_order.picker_operator,
      p_order.picker_history_snapshot->>'operator',
      v_pickup_j->>'picker_entrega'
    ),
    'warehouse', COALESCE(p_order.sucursal_pickeo, p_order.picker_history_snapshot->>'sucursal', 'Matriz Ñuñoa'),
    'picked_at', COALESCE(p_order.ready_for_pickup_at, p_order.picker_last_synced_at, p_order.stock_descontado_at, p_order.created_at),
    'scanned_label', COALESCE(p_order.picker_scanned_label, p_order.picker_history_snapshot->>'scanned_label'),
    'items_summary', p_order.picker_history_snapshot->>'items_summary',
    'observation', p_order.picker_history_snapshot->>'observation',
    'logs', v_logs_json,
    'history_logs', v_logs_json
  );

  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'product_id', oi.product_id,
        'sku', COALESCE(p.sku, p_order.sku),
        'name', COALESCE(p.name, p_order.item, 'Producto'),
        'barcode', COALESCE(NULLIF(p.barcode, ''), NULLIF(p.barcode_wms, ''), p.sku),
        'quantity', oi.quantity,
        'warehouse_id', oi.warehouse_id
      )
    ), '[]'::jsonb),
    COALESCE(SUM(oi.quantity), COALESCE(p_order.cantidad, 1))
  INTO v_items_json, v_total_units
  FROM public.order_items oi
  LEFT JOIN public.products p ON p.id = oi.product_id
  WHERE oi.order_id = p_order.id;

  v_hist := public.append_order_tracking_checkpoint(
    p_order.tracking_history,
    COALESCE(v_ship_json->>'status', 'Entregado'),
    'ENTREGADO',
    COALESCE(v_ship_json->>'source_table', 'wms'),
    v_delivered_at
  );

  RETURN jsonb_build_object(
    'version', 1,
    'sealed_at', NOW(),
    'closed_by', COALESCE(p_order.closed_by_automation, 'manual_or_system'),
    'final_wms_status', 'Entregado',
    'final_origin_status', COALESCE(p_order.status, 'entregado'),
    'categoria_entrega', v_cat,
    'ready_for_pickup_at', p_order.ready_for_pickup_at,
    'delivered_at', v_delivered_at,
    'dispatched_at', COALESCE(p_order.dispatched_at, p_order.ready_for_pickup_at, p_order.stock_descontado_at, v_delivered_at),
    'shipment', v_ship_json,
    'pickup', v_pickup_json,
    'picking', v_picking_json,
    'items_snapshot', v_items_json,
    'total_units', v_total_units,
    'tracking_history', v_hist
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.build_public_tracking_order_json(o public.orders)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_masked_name TEXT;
  v_masked_email TEXT;
  v_snap JSONB := o.closed_snapshot;
  v_opti RECORD;
  v_wd RECORD;
BEGIN
  v_masked_name := CASE
    WHEN COALESCE(TRIM(o.customer_name), '') = '' THEN 'Cliente'
    WHEN split_part(TRIM(o.customer_name), ' ', 2) <> '' THEN
      split_part(TRIM(o.customer_name), ' ', 1) || ' ' || LEFT(split_part(TRIM(o.customer_name), ' ', 2), 1) || '.'
    ELSE split_part(TRIM(o.customer_name), ' ', 1)
  END;

  v_masked_email := CASE
    WHEN o.customer_email IS NOT NULL AND position('@' in o.customer_email) > 2 THEN
      SUBSTRING(o.customer_email FROM 1 FOR 2) || '***@' || split_part(o.customer_email, '@', 2)
    ELSE '***'
  END;

  IF o.estado_wms = 'Entregado' AND v_snap IS NOT NULL THEN
    RETURN jsonb_build_object(
      'id', o.id,
      'order_number', COALESCE(o.external_order_number, o.id::text),
      'comercio', COALESCE(o.comercio, 'Tienda Asociada Stocka'),
      'customer_name', v_masked_name,
      'customer_email', v_masked_email,
      'status', 'Entregado',
      'estado_wms', 'Entregado',
      'is_closed_final', TRUE,
      'tracking_number', COALESCE(v_snap->'shipment'->>'tracking', o.tracking_number),
      'tracking_url', COALESCE(v_snap->'shipment'->>'tracking_url', o.tracking_url),
      'courier', COALESCE(v_snap->'shipment'->>'courier', o.courier, o.operador, 'Stocka'),
      'categoria_entrega', COALESCE(v_snap->>'categoria_entrega', o.categoria_entrega, 'DISTRIBUCIÓN'),
      'shipping_city', o.shipping_city,
      'created_at', o.created_at,
      'ready_for_pickup_at', COALESCE(v_snap->>'ready_for_pickup_at', o.ready_for_pickup_at::text),
      'delivered_at', COALESCE(v_snap->>'delivered_at', o.delivered_at::text),
      'tracking_history', COALESCE(v_snap->'tracking_history', o.tracking_history, '[]'::jsonb),
      'picking_info', jsonb_build_object(
        'warehouse', COALESCE(v_snap->'picking'->>'warehouse', o.sucursal_pickeo, 'Centro de Distribución Stocka'),
        'status', COALESCE(v_snap->'picking'->>'status', 'Completado'),
        'picked_at', COALESCE(v_snap->'picking'->>'picked_at', o.ready_for_pickup_at::text, o.stock_descontado_at::text),
        'scanned_label', COALESCE(v_snap->'picking'->>'scanned_label', o.picker_scanned_label),
        'total_units', COALESCE((v_snap->>'total_units')::int, o.cantidad, 1),
        'items', COALESCE(v_snap->'items_snapshot', '[]'::jsonb)
      ),
      'optiroute_info', jsonb_build_object(
        'is_optiroute', (COALESCE(v_snap->'shipment'->>'source_table', '') = 'optiroute_orders' OR COALESCE(o.operador, '') ILIKE '%STOCKA%'),
        'status_title', COALESCE(v_snap->'shipment'->>'status', 'Entregado'),
        'service_type', COALESCE(v_snap->'shipment'->>'service_type', 'Stocka Express (Same Day / 24 hrs)'),
        'vehicle', v_snap->'shipment'->>'vehicle',
        'route_started_at', v_snap->'shipment'->>'route_started_at',
        'delivered_at', COALESCE(v_snap->>'delivered_at', o.delivered_at::text),
        'reception_name', v_snap->'shipment'->>'reception_name',
        'proof_image', COALESCE(v_snap->'shipment'->>'proof_image', v_snap->'shipment'->'pod_images'->>0)
      ),
      'woodelivery_info', CASE WHEN COALESCE(v_snap->'shipment'->>'source_table', '') = 'woodelivery_envios'
        THEN jsonb_build_object(
          'tracking_url', v_snap->'shipment'->>'tracking_url',
          'driver_name', v_snap->'shipment'->>'driver_name',
          'reception_name', v_snap->'shipment'->>'reception_name',
          'completed_notes', v_snap->'shipment'->>'completed_notes',
          'pod_images', COALESCE(v_snap->'shipment'->'pod_images', '[]'::jsonb)
        )
        ELSE NULL END
    );
  END IF;

  SELECT
    opt.status AS opti_status,
    opt.servicio_tipo_envio AS opti_service_type,
    opt.raw_data->'assigned_vehicle'->>'name' AS opti_vehicle,
    opt.raw_data->>'route_started_at' AS opti_route_started_at,
    opt.raw_data->>'completed_at' AS opti_completed_at,
    opt.raw_data->>'status_title' AS opti_status_title,
    COALESCE(opt.raw_data->'images'->0->>'url', opt.raw_data->'waypoint'->'images'->0->>'url') AS proof_image,
    opt.raw_data->'waypoint'->>'reception_name' AS opti_reception_name
  INTO v_opti
  FROM public.optiroute_orders opt
  WHERE (opt.referencia = o.external_order_number
     OR (o.tracking_number IS NOT NULL AND o.tracking_number <> '' AND opt.tracking = o.tracking_number))
  ORDER BY opt.created_at DESC
  LIMIT 1;

  IF o.tracking_number IS NOT NULL AND TRIM(o.tracking_number) <> '' THEN
    SELECT
      wd.tracking_url,
      wd.status_display,
      wd.status_wms_normalized,
      wd.driver_name,
      wd.completed_recipient_name,
      wd.completed_notes,
      wd.failed_reason_text,
      wd.pod_images,
      wd.wd_completed_at
    INTO v_wd
    FROM public.woodelivery_envios wd
    WHERE wd.external_key = TRIM(o.tracking_number)
      AND wd.source_kind = 'lightdata'
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'id', o.id,
    'order_number', COALESCE(o.external_order_number, o.id::text),
    'comercio', COALESCE(o.comercio, 'Tienda Asociada Stocka'),
    'customer_name', v_masked_name,
    'customer_email', v_masked_email,
    'status', CASE
      WHEN o.estado_wms = 'Entregado' OR o.transport_status_normalized = 'ENTREGADO' THEN 'Entregado'
      WHEN LOWER(COALESCE(o.estado_wms, '')) LIKE '%incidenc%' THEN 'Incidencia'
      WHEN LOWER(COALESCE(o.estado_wms, '')) LIKE '%cancel%' OR LOWER(COALESCE(o.status, '')) LIKE '%cancel%' THEN 'Cancelado'
      WHEN o.estado_wms = 'Listo para retiro' OR ((o.categoria_entrega = 'RETIRO' OR o.operador ILIKE '%RETIRO%') AND LOWER(COALESCE(o.estado_wms, '')) IN ('pickeado', 'listo para retiro')) THEN 'Listo para retiro'
      ELSE COALESCE(o.estado_wms, o.status, 'En Proceso')
    END,
    'estado_wms', COALESCE(o.estado_wms, 'En procesamiento'),
    'is_closed_final', FALSE,
    'tracking_number', COALESCE(
      CASE WHEN COALESCE((o.raw_shopify_data->'wms_forced_tracking'->>'active')::boolean, false) IS TRUE
        THEN NULLIF(TRIM(o.raw_shopify_data->'wms_forced_tracking'->>'tracking_number'), '')
        ELSE NULL END,
      NULLIF(NULLIF(o.tracking_number, 'No informado'), ''),
      (SELECT eu.tracking FROM public.envios_unificados eu WHERE eu.pedido_referencia = o.external_order_number AND eu.tracking IS NOT NULL AND eu.tracking <> 'No informado' AND LOWER(COALESCE(eu.status, '')) NOT LIKE '%cancel%' ORDER BY CASE WHEN eu.source_table = 'woodelivery_envios' THEN 0 ELSE 1 END, eu.updated_at DESC LIMIT 1),
      o.tracking_number
    ),
    'tracking_url', COALESCE(
      CASE WHEN COALESCE((o.raw_shopify_data->'wms_forced_tracking'->>'active')::boolean, false) IS TRUE
        THEN NULLIF(TRIM(o.raw_shopify_data->'wms_forced_tracking'->>'tracking_url'), '')
        ELSE NULL END,
      NULLIF(TRIM(v_wd.tracking_url), ''),
      o.tracking_url,
      (SELECT eu.tracking_url FROM public.envios_unificados eu WHERE eu.pedido_referencia = o.external_order_number AND eu.tracking_url IS NOT NULL AND eu.tracking_url <> '' AND LOWER(COALESCE(eu.status, '')) NOT LIKE '%cancel%' ORDER BY CASE WHEN eu.source_table = 'woodelivery_envios' THEN 0 ELSE 1 END, eu.updated_at DESC LIMIT 1)
    ),
    'courier', COALESCE(
      CASE WHEN COALESCE((o.raw_shopify_data->'wms_forced_tracking'->>'active')::boolean, false) IS TRUE
        THEN NULLIF(TRIM(o.raw_shopify_data->'wms_forced_tracking'->>'courier'), '')
        ELSE NULL END,
      o.courier,
      o.operador,
      'Stocka Same Day / Courier'
    ),
    'categoria_entrega', COALESCE(o.categoria_entrega, 'DISTRIBUCIÓN'),
    'shipping_city', o.shipping_city,
    'created_at', o.created_at,
    'ready_for_pickup_at', o.ready_for_pickup_at,
    'delivered_at', COALESCE(o.delivered_at::text, v_wd.wd_completed_at::text, v_opti.opti_completed_at),
    'tracking_history', COALESCE(o.tracking_history, '[]'::jsonb),
    'picking_info', jsonb_build_object(
      'warehouse', COALESCE(o.sucursal_pickeo, 'Centro de Distribución Stocka'),
      'status', COALESCE(
        o.picker_status,
        CASE
          WHEN LOWER(COALESCE(o.estado_wms, '')) IN ('listo para retiro', 'despachado', 'pickeado', 'entregado') THEN 'Completado'
          WHEN LOWER(COALESCE(o.estado_wms, '')) LIKE '%prep%' THEN 'En preparación'
          ELSE 'En proceso'
        END
      ),
      'picked_at', COALESCE(o.ready_for_pickup_at::text, o.picker_last_synced_at::text, o.stock_descontado_at::text),
      'scanned_label', o.picker_scanned_label,
      'total_units', (SELECT COALESCE(SUM(quantity), 0) FROM public.order_items oi WHERE oi.order_id = o.id),
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
      'is_optiroute', (v_opti.opti_status IS NOT NULL OR o.operador ILIKE '%STOCKA%' OR o.courier ILIKE '%OPTIROUTE%' OR o.operador ILIKE '%SAME DAY%'),
      'status_title', COALESCE(v_opti.opti_status_title, v_opti.opti_status, CASE WHEN o.estado_wms = 'Despachado' THEN 'En Ruta' ELSE o.estado_wms END),
      'service_type', COALESCE(v_opti.opti_service_type, 'Stocka Express (Same Day / 24 hrs)'),
      'vehicle', v_opti.opti_vehicle,
      'route_started_at', v_opti.opti_route_started_at,
      'delivered_at', v_opti.opti_completed_at,
      'reception_name', COALESCE(v_wd.completed_recipient_name, v_opti.opti_reception_name),
      'proof_image', COALESCE(v_wd.pod_images->>0, v_opti.proof_image)
    ),
    'woodelivery_info', CASE WHEN v_wd.tracking_url IS NOT NULL OR v_wd.status_display IS NOT NULL
      THEN jsonb_build_object(
        'tracking_url', v_wd.tracking_url,
        'status', v_wd.status_display,
        'status_norm', v_wd.status_wms_normalized,
        'driver_name', v_wd.driver_name,
        'reception_name', v_wd.completed_recipient_name,
        'completed_notes', v_wd.completed_notes,
        'failed_reason_text', v_wd.failed_reason_text,
        'pod_images', COALESCE(v_wd.pod_images, '[]'::jsonb)
      )
      ELSE NULL END
  );
END;
$function$;

-- =========================================================================================
-- 9. ACTUALIZAR reconcile_wms_transport_automations()
--    - Prioriza woodelivery_envios y excluye lightdata_envios del cierre automático a Entregado
-- =========================================================================================
CREATE OR REPLACE FUNCTION public.reconcile_wms_transport_automations(p_limit INT DEFAULT 400)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rec RECORD;
  v_to_entregado INT := 0;
  v_to_despachado INT := 0;
BEGIN
  PERFORM set_config('app.physical_carrier_transition', 'true', true);

  -- 1. Retiros marcados ENTREGADO / RETIRADO en store_pickups
  IF public.is_automation_rule_enabled('auto-pickup-retirado-to-entregado') THEN
    FOR v_rec IN
      SELECT DISTINCT ON (o.id) o.id, o.external_order_number, o.comercio, o.estado_wms, sp.sucursal, sp.pin_retiro, sp.updated_at
      FROM public.orders o
      JOIN public.store_pickups sp
        ON sp.pedido IN (o.external_order_number, REGEXP_REPLACE(COALESCE(o.external_order_number, ''), '^#+', ''), '#' || REGEXP_REPLACE(COALESCE(o.external_order_number, ''), '^#+', ''))
      WHERE UPPER(TRIM(COALESCE(sp.estado_pedido, ''))) IN ('ENTREGADO', 'RETIRADO')
        AND COALESCE(o.estado_wms, 'En procesamiento') NOT IN ('Entregado', 'Cancelado', 'Archivado')
        AND (sp.comercio IS NULL OR LOWER(TRIM(sp.comercio)) = LOWER(TRIM(COALESCE(o.comercio, ''))))
      LIMIT p_limit
    LOOP
      UPDATE public.orders
      SET estado_wms = 'Entregado',
          status = 'retirado',
          delivered_at = COALESCE(delivered_at, v_rec.updated_at, NOW()),
          closed_at = NOW(),
          closed_by_automation = 'auto-pickup-retirado-to-entregado'
      WHERE id = v_rec.id;
      v_to_entregado := v_to_entregado + 1;
    END LOOP;
  END IF;

  -- 2. Envíos en envios_unificados (con prioridad woodelivery_envios sobre lightdata_envios)
  FOR v_rec IN
    SELECT DISTINCT ON (m.id)
      m.id,
      m.external_order_number,
      m.comercio,
      m.estado_wms,
      m.categoria_entrega,
      m.source_table,
      m.courier,
      m.tracking,
      m.tracking_url,
      m.updated_at,
      (public.classify_shipment_transport_status(m.source_table, m.status, m.raw_data))->>'norm' AS norm_st,
      (public.classify_shipment_transport_status(m.source_table, m.status, m.raw_data))->>'clean_status' AS clean_st
    FROM (
      SELECT o.id, o.external_order_number, o.comercio, o.estado_wms, o.categoria_entrega,
             eu.source_table, eu.courier, eu.tracking, eu.tracking_url, eu.updated_at, eu.status, eu.raw_data
      FROM public.orders o
      JOIN public.envios_unificados eu ON eu.tracking = o.tracking_number
      WHERE COALESCE(o.estado_wms, 'En procesamiento') NOT IN ('Entregado', 'Cancelado', 'Archivado')
        AND o.tracking_number IS NOT NULL AND o.tracking_number <> '' AND UPPER(o.tracking_number) NOT IN ('N/A', 'NO INFORMADO', '-')
      UNION ALL
      SELECT o.id, o.external_order_number, o.comercio, o.estado_wms, o.categoria_entrega,
             eu.source_table, eu.courier, eu.tracking, eu.tracking_url, eu.updated_at, eu.status, eu.raw_data
      FROM public.orders o
      JOIN public.envios_unificados eu ON eu.source_table IN ('woodelivery_envios', 'lightdata_envios') AND eu.source_id = o.tracking_number
      WHERE COALESCE(o.estado_wms, 'En procesamiento') NOT IN ('Entregado', 'Cancelado', 'Archivado')
        AND o.tracking_number IS NOT NULL AND o.tracking_number <> '' AND UPPER(o.tracking_number) NOT IN ('N/A', 'NO INFORMADO', '-')
      UNION ALL
      SELECT o.id, o.external_order_number, o.comercio, o.estado_wms, o.categoria_entrega,
             eu.source_table, eu.courier, eu.tracking, eu.tracking_url, eu.updated_at, eu.status, eu.raw_data
      FROM public.orders o
      JOIN public.envios_unificados eu ON eu.pedido_referencia = o.external_order_number
      WHERE COALESCE(o.estado_wms, 'En procesamiento') NOT IN ('Entregado', 'Cancelado', 'Archivado')
        AND o.external_order_number IS NOT NULL
        AND (eu.empresa_comercio_proveedor IS NULL OR UPPER(TRIM(eu.empresa_comercio_proveedor)) IN ('', 'NO ASIGNADO', 'STOCKA') OR LOWER(TRIM(eu.empresa_comercio_proveedor)) = LOWER(TRIM(COALESCE(o.comercio, ''))))
    ) m
    WHERE NOT (m.source_table = 'enviame_shipments' AND UPPER(COALESCE(m.courier, '')) ~ '(RECIBELO|RECÍBELO|WELIVERY|WOODELIVERY|WODELY)')
    ORDER BY m.id,
      CASE WHEN m.source_table = 'woodelivery_envios' THEN 10 ELSE 0 END DESC,
      CASE WHEN (public.classify_shipment_transport_status(m.source_table, m.status, m.raw_data))->>'norm' = 'ENTREGADO' THEN 3
           WHEN (public.classify_shipment_transport_status(m.source_table, m.status, m.raw_data))->>'norm' = 'EN TRÁNSITO' THEN 2
           ELSE 1 END DESC,
      m.updated_at DESC NULLS LAST
    LIMIT p_limit
  LOOP
    -- Autoridad ALPHA: lightdata_envios nunca cierra a Entregado
    IF v_rec.norm_st = 'ENTREGADO'
       AND v_rec.source_table <> 'lightdata_envios'
       AND public.is_automation_rule_enabled('auto-dispatch-delivered-to-entregado') THEN
      UPDATE public.orders
      SET estado_wms = 'Entregado',
          status = 'entregado',
          tracking_url = CASE WHEN v_rec.source_table = 'woodelivery_envios' AND v_rec.tracking_url ILIKE '%app.woodelivery.com/t?q=%' THEN v_rec.tracking_url ELSE tracking_url END,
          delivered_at = COALESCE(delivered_at, v_rec.updated_at, NOW()),
          closed_at = NOW(),
          closed_by_automation = 'auto-dispatch-delivered-to-entregado'
      WHERE id = v_rec.id;
      v_to_entregado := v_to_entregado + 1;

    ELSIF (v_rec.norm_st = 'EN TRÁNSITO' OR (v_rec.source_table = 'lightdata_envios' AND v_rec.norm_st = 'ENTREGADO'))
          AND UPPER(TRIM(COALESCE(v_rec.categoria_entrega, ''))) <> 'RETIRO'
          AND COALESCE(v_rec.estado_wms, 'En procesamiento') IN ('En procesamiento', 'En preparación', 'Pickeado')
          AND public.is_automation_rule_enabled('auto-transport-in-transit-to-despachado') THEN
      UPDATE public.orders
      SET estado_wms = 'Despachado',
          status = 'despachado',
          transport_status_normalized = 'EN TRÁNSITO',
          tracking_url = CASE WHEN v_rec.source_table = 'woodelivery_envios' AND v_rec.tracking_url ILIKE '%app.woodelivery.com/t?q=%' THEN v_rec.tracking_url ELSE tracking_url END,
          dispatched_at = COALESCE(dispatched_at, v_rec.updated_at, NOW()),
          closed_by_automation = 'auto-transport-in-transit-to-despachado'
      WHERE id = v_rec.id;
      v_to_despachado := v_to_despachado + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'moved_to_entregado', v_to_entregado,
    'moved_to_despachado', v_to_despachado
  );
END;
$function$;

-- =========================================================================================
-- 10. ACTUALIZAR DESCRIPCIONES EN public.automation_rules Y RECARGAR SCHEMA CACHE
-- =========================================================================================
UPDATE public.automation_rules
SET trigger_desc = 'El envío asociado al pedido cambia su estado de transporte normalizado a "EN TRÁNSITO" (movimiento físico confirmado en Envíame, BlueX, Starken, WooDelivery/LightData ALPHA u Optiroute).',
    updated_at = NOW()
WHERE id = 'auto-transport-in-transit-to-despachado';

UPDATE public.automation_rules
SET trigger_desc = 'El despacho del pedido confirma estado "ENTREGADO" real al destinatario (para ALPHA con autoridad exclusiva de WooDelivery; excluyendo devoluciones, choferes virtuales o entregas en origen).',
    updated_at = NOW()
WHERE id = 'auto-dispatch-delivered-to-entregado';

NOTIFY pgrst, 'reload schema';
