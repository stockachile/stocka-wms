-- =========================================================================================
-- WMS STOCKA - MIGRACIÓN INTEGRAL: NUEVO ESTADO WMS "Entregado" (Finalizado / Inmutable),
-- SNAPSHOT CONGELADO EN BD Y MOTOR DE AUTOMATIZACIONES ACTIVAS
-- Fecha: 2026-11-16
-- =========================================================================================

-- =========================================================================================
-- 1. ACTUALIZAR RESTRICCIONES CHECK EN public.orders
-- =========================================================================================
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS check_estado_wms;
ALTER TABLE public.orders ADD CONSTRAINT check_estado_wms
  CHECK (estado_wms IN (
    'En procesamiento',
    'En preparación',
    'Pickeado',
    'Despachado',
    'Entregado',
    'Incidencia',
    'Cancelado',
    'Archivado'
  ));

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'para procesar',
    'en preparación',
    'preparado',
    'listo para retiro',
    'despachado',
    'en tránsito',
    'en transito',
    'entregado',
    'retirado',
    'en espera',
    'sin stock',
    'incidencia',
    'cancelado'
  ));

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_categoria_entrega_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_categoria_entrega_check
  CHECK (categoria_entrega IN (
    'RETIRO',
    'DISTRIBUCIÓN',
    'LOGÍSTICA INVERSA',
    'LOGISTICA INVERSA',
    'SHOP POINT (POS)',
    'SHOP POINT',
    'POS'
  ));

-- =========================================================================================
-- 2. NUEVAS COLUMNAS DE CIERRE, HISTORIAL Y SNAPSHOT EN public.orders
-- =========================================================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS transport_status_normalized TEXT,
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by_automation TEXT,
  ADD COLUMN IF NOT EXISTS tracking_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS picker_history_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS closed_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS consolidated_into_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_consolidated BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_orders_estado_wms ON public.orders(estado_wms);
CREATE INDEX IF NOT EXISTS idx_orders_delivered_at ON public.orders(delivered_at DESC) WHERE delivered_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_transport_norm ON public.orders(transport_status_normalized) WHERE transport_status_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_consolidated_into ON public.orders(consolidated_into_order_id) WHERE consolidated_into_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_raw_consolidated_into ON public.orders ((raw_shopify_data->>'_consolidated_into_order_id')) WHERE (raw_shopify_data->>'_consolidated_into_order_id') IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_forced_tracking ON public.orders (UPPER(TRIM(raw_shopify_data->'wms_forced_tracking'->>'tracking_number'))) WHERE COALESCE((raw_shopify_data->'wms_forced_tracking'->>'active')::boolean, FALSE) IS TRUE;
CREATE INDEX IF NOT EXISTS idx_store_pickups_pedido ON public.store_pickups(pedido);

COMMENT ON COLUMN public.orders.closed_snapshot IS 'Snapshot inmutable 360° sellado al pasar a estado_wms = Entregado. Permite consultar todo el pedido sin cruzar otras tablas ni plataformas externas.';
COMMENT ON COLUMN public.orders.tracking_history IS 'Historial cronológico acumulado de estados y checkpoints del transporte/retiro.';
COMMENT ON COLUMN public.orders.picker_history_snapshot IS 'Respaldo local de trazabilidad de escaneo y retiro desde App Picker para consultas autónomas sin consultar BD externa.';

-- =========================================================================================
-- 3. TABLAS DEL MOTOR DEL CENTRO DE AUTOMATIZACIONES (automation_rules & automation_execution_logs)
-- =========================================================================================
CREATE TABLE IF NOT EXISTS public.automation_rules (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'stock_couriers',
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  mode TEXT,
  trigger_desc TEXT,
  condition_desc TEXT,
  action_desc TEXT,
  tech_source TEXT,
  executions_count BIGINT NOT NULL DEFAULT 0,
  last_executed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.automation_execution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id TEXT REFERENCES public.automation_rules(id) ON DELETE SET NULL,
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  external_order_number TEXT,
  comercio TEXT,
  previous_wms_status TEXT,
  new_wms_status TEXT,
  trigger_source TEXT,
  trigger_detail TEXT,
  stock_shortage_incident BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_logs_created_at ON public.automation_execution_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_logs_order_id ON public.automation_execution_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_automation_logs_rule_id ON public.automation_execution_logs(rule_id);

ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_execution_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins gestionan automation_rules" ON public.automation_rules;
CREATE POLICY "Admins gestionan automation_rules" ON public.automation_rules
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Usuarios autenticados leen automation_rules" ON public.automation_rules;
CREATE POLICY "Usuarios autenticados leen automation_rules" ON public.automation_rules
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins gestionan automation_execution_logs" ON public.automation_execution_logs;
CREATE POLICY "Admins gestionan automation_execution_logs" ON public.automation_execution_logs
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT ALL ON public.automation_rules TO postgres, service_role;
GRANT SELECT, UPDATE ON public.automation_rules TO authenticated;
GRANT ALL ON public.automation_execution_logs TO postgres, service_role;
GRANT SELECT ON public.automation_execution_logs TO authenticated;

-- Sembrar / Actualizar catálogo oficial de reglas en automation_rules
INSERT INTO public.automation_rules (id, title, category, is_enabled, mode, trigger_desc, condition_desc, action_desc, tech_source)
VALUES
  (
    'auto-transport-in-transit-to-despachado',
    'Transporte → WMS: Pedido con Etiqueta "En Tránsito" pasa automáticamente a Despachado',
    'stock_couriers',
    TRUE,
    'Trigger SQL Tiempo Real + Sync Couriers',
    'El envío asociado al pedido cambia su estado de transporte normalizado a "EN TRÁNSITO" (movimiento físico confirmado en Envíame, BlueX, Starken, LightData/ALPHA u Optiroute).',
    'El pedido no es de categoría RETIRO y se encuentra en "En procesamiento", "En preparación" o "Pickeado".',
    'Cambia automáticamente estado_wms a "Despachado" (descontando stock físico de forma idempotente), limpia active_orders en Picker si seguía abierto y levanta alerta de auditoría si faltaba cierre previo de picking.',
    'Trigger trg_on_unified_shipment_status_change + sync_to_picker.js'
  ),
  (
    'auto-dispatch-delivered-to-entregado',
    'Despacho → WMS: Envío Entregado cierra el pedido en ENTREGADO (Snapshot Inmutable)',
    'stock_couriers',
    TRUE,
    'Trigger SQL Tiempo Real + Cierre Definitivo',
    'El despacho del pedido confirma estado "ENTREGADO" real al destinatario (excluyendo devoluciones o entregas en origen).',
    'El pedido no se encuentra ya en "Entregado", "Cancelado" ni "Archivado".',
    'Cambia estado_wms a "Entregado" (Finalizado), sella closed_snapshot con tracking, receptor, historial, picking y SLA, propaga a pedidos secundarios consolidados y detiene futuras consultas externas.',
    'Trigger trg_on_unified_shipment_status_change + zz_seal_order_closed_snapshot'
  ),
  (
    'auto-pickup-retirado-to-entregado',
    'Retiro en Sucursal → WMS: Pedido Retirado pasa automáticamente a ENTREGADO',
    'picker_wms',
    TRUE,
    'Trigger SQL + Polling Picker 30s / Worker',
    'El retiro del pedido se marca como "Retirado" en App Picker o "ENTREGADO" en store_pickups / sucursal_pickups.',
    'El pedido no está en "Cancelado" ni "Archivado".',
    'Cambia automáticamente estado_wms a "Entregado" (status = "retirado"), descuenta stock si aún no se había rebajado, guarda PIN/receptor/hora en closed_snapshot y cierra el pedido en Shopify.',
    'Trigger trg_auto_store_pickup_to_entregado + sync_to_picker.js + js/admin.js'
  ),
  (
    'auto-pos-sale-to-entregado',
    'Shop Point (POS) → WMS: Venta Presencial en Bodega nace cerrada en ENTREGADO',
    'stock_couriers',
    TRUE,
    'Trigger SQL Instantáneo al Crear',
    'Se registra una venta presencial con categoría "SHOP POINT (POS)" / origen "Punto de Venta".',
    'Venta confirmada en módulo POS Sucursal Ñuñoa.',
    'Asigna estado_wms = "Entregado" de inmediato, rebaja stock físico de Matriz Ñuñoa y sella su snapshot presencial sin requerir seguimiento posterior.',
    'Trigger aa_enforce_delivered_immutability_and_auto_close + js/pos_admin.js'
  ),
  (
    'auto-marketplace-delivered-to-entregado',
    'Marketplaces & Shopify → WMS: Entrega Confirmada (Delivered) pasa a ENTREGADO',
    'wms_shopify',
    TRUE,
    'Trigger SQL + Sync Marketplaces',
    'Mercado Libre, Falabella, Paris, Ripley, Walmart o Shopify Fulfillment confirman estado de entrega "delivered".',
    'El pedido no está en "Entregado", "Cancelado" ni "Archivado".',
    'Cambia estado_wms a "Entregado", sella closed_snapshot con datos del canal y excluye el pedido de futuras re-sincronizaciones.',
    'Trigger aa_enforce_delivered_immutability_and_auto_close + sync_*.js'
  ),
  (
    'auto-reverse-logistics-to-entregado',
    'Logística Inversa → WMS: Recepción Procesada en Bodega cierra orden LI en ENTREGADO',
    'stock_couriers',
    TRUE,
    'Trigger SQL Tiempo Real',
    'Un registro en reverse_logistics cambia a estado "procesado" al recepcionarse físicamente en bodega.',
    'Existe orden WMS vinculada (wms_order_id / folio LI-...).',
    'Reingresa de forma idempotente las unidades devueltas a inventory (movimiento "in") y cierra la orden de Logística Inversa en estado_wms = "Entregado".',
    'Trigger trg_auto_reverse_logistics_to_entregado'
  ),
  (
    'auto-picker-to-pickeado',
    'Picker → WMS: Pedido Completado pasa a Pickeado',
    'picker_wms',
    TRUE,
    'Tiempo Real (Polling 30s + Worker)',
    'Operario finaliza el armado del pedido en App Picker (Completado, Completado-Asistido o Listo para retiro).',
    'El pedido se encuentra en estado "En preparación" en Stocka WMS.',
    'Cambia el pedido a estado_wms = "Pickeado", respalda picker_history_snapshot en WMS y guarda operario + etiqueta escaneada.',
    'js/admin.js (syncPickerStatusToWms) & sync_to_picker.js'
  ),
  (
    'auto-shopify-ready-for-pickup',
    'WMS → Shopify: Pedido de Retiro Pickeado pasa a "Listo para retirar"',
    'wms_shopify',
    TRUE,
    'Trigger SQL + Edge Function Tiempo Real',
    'Un pedido de RETIRO cambia a estado_wms = "Pickeado" en WMS.',
    'El comercio tiene activa la sincronización inversa (sync_tracking_enabled = true).',
    'Encola set_ready_for_pickup y ejecuta fulfillmentOrderLineItemsPreparedForPickup en Shopify.',
    'Trigger trg_enqueue_shopify_fulfillment + Edge Function shopify-fulfillment-sync'
  ),
  (
    'auto-shopify-in-progress',
    'WMS → Shopify: Pedido En Preparación pasa a "En curso" (IN_PROGRESS)',
    'wms_shopify',
    TRUE,
    'Trigger SQL + Edge Function Tiempo Real',
    'Un pedido cambia a estado_wms = "En preparación" en Stocka WMS.',
    'El comercio tiene sync_tracking_enabled = true y sync_intermediate_statuses = true.',
    'Encola set_in_progress y publica progreso en Shopify.',
    'Trigger trg_enqueue_shopify_fulfillment + Edge Function shopify-fulfillment-sync'
  ),
  (
    'auto-shopify-create-fulfillment',
    'WMS → Shopify: Pedido Pickeado / Despachado / Entregado → Fulfilled + Tracking',
    'wms_shopify',
    TRUE,
    'Trigger SQL + Edge Function Tiempo Real',
    'Un pedido pasa a Pickeado, Despachado o Entregado.',
    'El comercio tiene sync_tracking_enabled = true.',
    'Crea o cierra el Fulfillment en Shopify adjuntando tracking y URL.',
    'Trigger trg_enqueue_shopify_fulfillment + Edge Function shopify-fulfillment-sync'
  ),
  (
    'auto-shopify-in-transit-delivered',
    'WMS → Shopify: Transporte En Tránsito y Entregado → Eventos Nativos de Envío en Shopify',
    'wms_shopify',
    TRUE,
    'Triggers de Transporte + Reconciliación WMS',
    'El paquete cambia a EN TRÁNSITO o ENTREGADO en couriers o WMS.',
    'El comercio tiene sync_tracking_enabled = true.',
    'Publica FulfillmentEvent in_transit o delivered en Shopify.',
    'Triggers trg_shopify_shipment_status_* + Edge Function shopify-fulfillment-sync'
  ),
  (
    'auto-wms-to-picker-sync',
    'WMS → Picker: Inyección de Pedidos En Preparación y Generación de PIN de Retiro',
    'picker_wms',
    TRUE,
    'Worker Continuo + Acciones WMS',
    'Un pedido pasa a "En preparación" en Stocka WMS.',
    'Si es courier externo exige tracking_number; si es RETIRO genera PIN.',
    'Inserta ítems y ubicaciones en active_orders de Picker y crea store_pickups.',
    'sync_to_picker.js & js/admin.js'
  ),
  (
    'auto-wms-stock-deduction',
    'WMS → Inventario: Control Exclusivo de Stock Físico, en Mesa y Comprometido',
    'stock_couriers',
    TRUE,
    'Trigger SQL Transaccional',
    'Cambio de estado_wms entre En procesamiento, En preparación/Pickeado, Despachado/Entregado y Cancelado/Archivado.',
    'Evalúa should_process_order_stock, is_order_stock_eligible e idempotencia por order_id en movements.',
    'Mueve unidades entre committed_quantity, reserved_quantity y descuento definitivo de quantity en Despachado/Entregado sin doble descuento.',
    'Trigger on_order_stock_change (handle_order_status_change)'
  )
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  category = EXCLUDED.category,
  mode = EXCLUDED.mode,
  trigger_desc = EXCLUDED.trigger_desc,
  condition_desc = EXCLUDED.condition_desc,
  action_desc = EXCLUDED.action_desc,
  tech_source = EXCLUDED.tech_source,
  updated_at = NOW();

-- Helper para consultar si una regla está activa
CREATE OR REPLACE FUNCTION public.is_automation_rule_enabled(p_rule_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_enabled FROM public.automation_rules WHERE id = p_rule_id),
    TRUE
  );
$$;

-- Helper para registrar ejecución de automatización
CREATE OR REPLACE FUNCTION public.log_automation_execution(
  p_rule_id TEXT,
  p_order_id UUID,
  p_ext_order_num TEXT,
  p_comercio TEXT,
  p_prev_wms TEXT,
  p_new_wms TEXT,
  p_source TEXT,
  p_detail TEXT,
  p_shortage BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.automation_execution_logs (
    rule_id, order_id, external_order_number, comercio,
    previous_wms_status, new_wms_status, trigger_source, trigger_detail, stock_shortage_incident
  ) VALUES (
    p_rule_id, p_order_id, p_ext_order_num, p_comercio,
    p_prev_wms, p_new_wms, p_source, p_detail, COALESCE(p_shortage, FALSE)
  );

  UPDATE public.automation_rules
  SET executions_count = executions_count + 1,
      last_executed_at = NOW(),
      updated_at = NOW()
  WHERE id = p_rule_id;
EXCEPTION WHEN OTHERS THEN
  -- Jamás abortar la transacción principal por un error de bitácora
  NULL;
END;
$$;

-- =========================================================================================
-- 4. CLASIFICADOR CANÓNICO DE ESTADO DE TRANSPORTE Y HELPERS DE SNAPSHOT
-- =========================================================================================
CREATE OR REPLACE FUNCTION public.classify_shipment_transport_status(
  p_source_table TEXT,
  p_status TEXT,
  p_raw_data JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_src TEXT := LOWER(TRIM(COALESCE(p_source_table, '')));
  v_status_text TEXT := TRIM(COALESCE(p_status, ''));
  v_raw23 TEXT;
  v_nested TEXT;
  v_low TEXT;
  v_norm TEXT := 'SIN MOVIMIENTO';
BEGIN
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

  -- 5. ENTREGADO exitoso al destinatario final (excluyendo disponible en sucursal/agencia pendiente de retiro)
  IF v_low ~ '(entregad|delivered|entrega exitosa|recibido conforme)'
     AND v_low !~ '(no entregad|fallid|rechazad|remitente|devuel|devoluc|origen|disponible para retiro|listo para retiro|pendiente)'
  THEN
    RETURN jsonb_build_object(
      'norm', 'ENTREGADO',
      'clean_status', CASE WHEN v_status_text ~ '^-?[0-9]+\.[0-9]+$' THEN 'Entregado' ELSE v_status_text END
    );
  END IF;

  -- 6. EN TRÁNSITO (movimiento físico confirmado por el operador logístico)
  IF v_low ~ '(tr[aá]nsito|in_transit|out_for_delivery|reparto|en ruta|onroute|ongoing|arrived|en camino|camino al destinatario|admitid|planta|clasificado|recepcionado en planta|en destino|redestin|disponible para retiro|cambio de direcci|cambi[oó] de direcci|nadie)'
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
$$;

-- Helper para acumular checkpoint en tracking_history sin duplicar el último estado consecutivo
CREATE OR REPLACE FUNCTION public.append_order_tracking_checkpoint(
  p_history JSONB,
  p_status TEXT,
  p_norm TEXT,
  p_source TEXT,
  p_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_hist JSONB := CASE WHEN p_history IS NOT NULL AND jsonb_typeof(p_history) = 'array' THEN p_history ELSE '[]'::jsonb END;
  v_len INT;
  v_last JSONB;
  v_entry JSONB;
BEGIN
  IF COALESCE(TRIM(p_status), '') = '' AND COALESCE(TRIM(p_norm), '') = '' THEN
    RETURN v_hist;
  END IF;

  v_len := jsonb_array_length(v_hist);
  IF v_len > 0 THEN
    v_last := v_hist->(v_len - 1);
    IF LOWER(COALESCE(v_last->>'status', '')) = LOWER(COALESCE(TRIM(p_status), ''))
       AND COALESCE(v_last->>'norm', '') = COALESCE(TRIM(p_norm), '') THEN
      RETURN v_hist;
    END IF;
  END IF;

  v_entry := jsonb_build_object(
    'at', COALESCE(p_at, NOW()),
    'status', COALESCE(NULLIF(TRIM(p_status), ''), p_norm),
    'norm', COALESCE(NULLIF(TRIM(p_norm), ''), 'SIN MOVIMIENTO'),
    'source', COALESCE(NULLIF(TRIM(p_source), ''), 'wms')
  );

  v_hist := v_hist || jsonb_build_array(v_entry);

  -- Mantener máximo 50 hitos más recientes para evitar crecimiento ilimitado
  IF jsonb_array_length(v_hist) > 50 THEN
    SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
    INTO v_hist
    FROM (
      SELECT elem
      FROM jsonb_array_elements(v_hist) WITH ORDINALITY AS t(elem, ord)
      WHERE ord > jsonb_array_length(v_hist) - 50
      ORDER BY ord
    ) sub;
  END IF;

  RETURN v_hist;
END;
$$;

-- Helper para detectar si un pedido POS o Marketplace/Shopify Fulfillment confirma entrega
CREATE OR REPLACE FUNCTION public.extract_marketplace_or_pos_delivery(p_order public.orders)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_plat TEXT := LOWER(REGEXP_REPLACE(COALESCE(p_order.origen, p_order.external_platform, ''), '\s+', '', 'g'));
  v_cat TEXT := UPPER(TRIM(COALESCE(p_order.categoria_entrega, '')));
  v_meli JSONB := p_order.raw_meli_data;
  v_meli_ship JSONB;
  v_meli_st TEXT;
  v_meli_sub TEXT;
  v_fal_st TEXT;
  v_paris_st TEXT;
  v_ripley_st TEXT;
  v_walmart_st TEXT;
  v_shop_deliv BOOLEAN := FALSE;
  v_deliv_at TIMESTAMPTZ := NULL;
BEGIN
  -- 1. Venta Presencial POS (SHOP POINT)
  IF v_cat IN ('SHOP POINT (POS)', 'SHOP POINT', 'POS')
     OR v_plat IN ('puntodeventa', 'pos', 'shoppoint', 'shoppoint(pos)')
     OR UPPER(TRIM(COALESCE(p_order.agenda, ''))) = 'COMPRA EN BODEGA'
     OR COALESCE((p_order.raw_shopify_data->>'is_pos_sale')::boolean, FALSE) IS TRUE
  THEN
    RETURN jsonb_build_object(
      'is_pos', TRUE,
      'is_delivered', TRUE,
      'rule_id', 'auto-pos-sale-to-entregado',
      'source', 'pos',
      'courier', 'Venta Presencial Sucursal Ñuñoa',
      'status_text', 'Entregado en Punto de Venta (POS)',
      'delivered_at', COALESCE(p_order.created_at, NOW())
    );
  END IF;

  -- 2. Mercado Libre
  IF v_plat LIKE '%mercadolibre%' OR v_plat LIKE '%meli%' OR v_meli IS NOT NULL THEN
    IF jsonb_typeof(v_meli) = 'array' AND jsonb_array_length(v_meli) > 0 THEN
      v_meli_ship := v_meli->0->'shipping';
    ELSIF jsonb_typeof(v_meli) = 'object' THEN
      v_meli_ship := COALESCE(v_meli->'shipping', v_meli->'shipment', v_meli->'orders'->0->'shipping');
    END IF;
    v_meli_st := LOWER(TRIM(COALESCE(v_meli->>'shipping_status', v_meli_ship->>'status', '')));
    v_meli_sub := LOWER(TRIM(COALESCE(v_meli_ship->>'substatus', '')));

    IF v_meli_st = 'delivered' OR v_meli_sub = 'delivered' OR (v_meli_ship->'status_history'->>'date_delivered') IS NOT NULL THEN
      BEGIN
        v_deliv_at := (v_meli_ship->'status_history'->>'date_delivered')::timestamptz;
      EXCEPTION WHEN OTHERS THEN
        v_deliv_at := NULL;
      END;
      RETURN jsonb_build_object(
        'is_pos', FALSE,
        'is_delivered', TRUE,
        'rule_id', 'auto-marketplace-delivered-to-entregado',
        'source', 'mercadolibre',
        'courier', COALESCE(NULLIF(TRIM(p_order.courier), ''), 'Mercado Libre'),
        'status_text', 'Entregado (Mercado Libre)',
        'delivered_at', COALESCE(v_deliv_at, NOW())
      );
    END IF;
  END IF;

  -- 3. Falabella
  IF v_plat LIKE '%falabella%' OR p_order.raw_falabella_data IS NOT NULL THEN
    v_fal_st := LOWER(TRIM(COALESCE(
      p_order.raw_falabella_data->'Statuses'->>'Status',
      p_order.raw_falabella_data->>'Status',
      p_order.raw_falabella_data->>'status',
      ''
    )));
    IF v_fal_st IN ('delivered', 'entregado') THEN
      RETURN jsonb_build_object(
        'is_pos', FALSE,
        'is_delivered', TRUE,
        'rule_id', 'auto-marketplace-delivered-to-entregado',
        'source', 'falabella',
        'courier', COALESCE(NULLIF(TRIM(p_order.courier), ''), 'Falabella'),
        'status_text', 'Entregado (Falabella)',
        'delivered_at', NOW()
      );
    END IF;
  END IF;

  -- 4. Paris
  IF v_plat LIKE '%paris%' OR p_order.raw_paris_data IS NOT NULL THEN
    v_paris_st := LOWER(TRIM(COALESCE(
      p_order.raw_paris_data->'subOrders'->0->'status'->>'name',
      CASE WHEN jsonb_typeof(p_order.raw_paris_data->'subOrders'->0->'status') = 'string'
           THEN p_order.raw_paris_data->'subOrders'->0->>'status' ELSE NULL END,
      p_order.raw_paris_data->>'status',
      p_order.payment_status,
      ''
    )));
    IF v_paris_st IN ('delivered', 'entregado', 'received')
       OR COALESCE(p_order.raw_paris_data->'subOrders'->0->'status'->>'id', '') = '4' THEN
      RETURN jsonb_build_object(
        'is_pos', FALSE,
        'is_delivered', TRUE,
        'rule_id', 'auto-marketplace-delivered-to-entregado',
        'source', 'paris',
        'courier', COALESCE(NULLIF(TRIM(p_order.courier), ''), 'Paris'),
        'status_text', 'Entregado (Paris)',
        'delivered_at', NOW()
      );
    END IF;
  END IF;

  -- 5. Ripley / Walmart
  IF v_plat LIKE '%ripley%' OR p_order.raw_ripley_data IS NOT NULL THEN
    v_ripley_st := LOWER(TRIM(COALESCE(p_order.raw_ripley_data->>'order_state', p_order.raw_ripley_data->>'status', p_order.payment_status, '')));
    IF v_ripley_st IN ('received', 'delivered', 'entregado', 'closed') THEN
      RETURN jsonb_build_object(
        'is_pos', FALSE,
        'is_delivered', TRUE,
        'rule_id', 'auto-marketplace-delivered-to-entregado',
        'source', 'ripley',
        'courier', COALESCE(NULLIF(TRIM(p_order.courier), ''), 'Ripley'),
        'status_text', 'Entregado (Ripley)',
        'delivered_at', NOW()
      );
    END IF;
  END IF;

  IF v_plat LIKE '%walmart%' OR p_order.raw_walmart_data IS NOT NULL THEN
    v_walmart_st := LOWER(TRIM(COALESCE(p_order.raw_walmart_data->>'status', p_order.payment_status, '')));
    IF v_walmart_st IN ('delivered', 'entregado') THEN
      RETURN jsonb_build_object(
        'is_pos', FALSE,
        'is_delivered', TRUE,
        'rule_id', 'auto-marketplace-delivered-to-entregado',
        'source', 'walmart',
        'courier', COALESCE(NULLIF(TRIM(p_order.courier), ''), 'Walmart'),
        'status_text', 'Entregado (Walmart)',
        'delivered_at', NOW()
      );
    END IF;
  END IF;

  -- 6. Shopify Fulfillment nativo reportando delivered (solo si NO es hijo de split sin envío propio)
  IF p_order.raw_shopify_data IS NOT NULL
     AND jsonb_typeof(p_order.raw_shopify_data->'fulfillments') = 'array'
     AND COALESCE(p_order.is_split, FALSE) IS FALSE
     AND p_order.parent_order_id IS NULL
     AND COALESCE((p_order.raw_shopify_data->>'_is_split_child')::boolean, FALSE) IS FALSE
  THEN
    SELECT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_order.raw_shopify_data->'fulfillments') AS f
      WHERE LOWER(TRIM(COALESCE(f->>'shipment_status', ''))) = 'delivered'
    ) INTO v_shop_deliv;

    IF v_shop_deliv THEN
      RETURN jsonb_build_object(
        'is_pos', FALSE,
        'is_delivered', TRUE,
        'rule_id', 'auto-marketplace-delivered-to-entregado',
        'source', 'shopify_fulfillment',
        'courier', COALESCE(NULLIF(TRIM(p_order.courier), ''), p_order.operador, 'Courier Shopify'),
        'status_text', 'Entregado (Shopify Fulfillment)',
        'delivered_at', NOW()
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('is_pos', FALSE, 'is_delivered', FALSE);
END;
$$;

-- =========================================================================================
-- 5. CONSTRUCTOR DEL SNAPSHOT INMUTABLE 360° (public.build_order_closed_snapshot)
-- Guarda en la propia fila de orders todo dato de despacho, retiro, picking, receptor, GPS e ítems
-- para que ninguna consulta futura requiera cruzar tablas ni plataformas externas.
-- =========================================================================================
CREATE OR REPLACE FUNCTION public.build_order_closed_snapshot(p_order public.orders)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cat TEXT := UPPER(TRIM(COALESCE(p_order.categoria_entrega, 'DISTRIBUCIÓN')));
  v_ext_clean TEXT := REGEXP_REPLACE(TRIM(COALESCE(p_order.external_order_number, '')), '^#+', '');
  v_forced_track TEXT := NULL;
  v_clean_track TEXT := NULL;
  v_ship_j JSONB := NULL;
  v_opti_j JSONB := NULL;
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

  -- A. Buscar datos de Retiro en Tienda si aplica (usa idx_store_pickups_pedido en O(log N))
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

  -- B. Buscar mejor envío en envios_unificados usando UNION ALL de búsquedas indexadas puras (0 Seq Scans)
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
          SELECT eu.* FROM public.envios_unificados eu WHERE eu.source_table = 'lightdata_envios' AND eu.source_id = v_forced_track
        ) c
        WHERE UPPER(COALESCE(c.courier, '')) !~ '(RECIBELO|RECÍBELO|WELIVERY|WOODELIVERY|WODELY)'
        ORDER BY
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
          WHERE v_clean_track IS NOT NULL AND eu.source_table = 'lightdata_envios' AND eu.source_id = v_clean_track
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
        WHERE UPPER(COALESCE(c.courier, '')) !~ '(RECIBELO|RECÍBELO|WELIVERY|WOODELIVERY|WODELY)'
        ORDER BY
          CASE WHEN (public.classify_shipment_transport_status(c.source_table, c.status, c.raw_data))->>'norm' = 'ENTREGADO' THEN 3
               WHEN (public.classify_shipment_transport_status(c.source_table, c.status, c.raw_data))->>'norm' = 'EN TRÁNSITO' THEN 2
               ELSE 1 END DESC,
          c.updated_at DESC NULLS LAST
        LIMIT 1
      ) t;
    END IF;

    -- Enriquecer metadatos permanentes de Optiroute por índice B-tree puro (referencia o tracking)
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

  -- Resolver courier, tracking, URL y fecha de entrega definitivos
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
    CASE WHEN (v_ship_j->>'source_table') = 'lightdata_envios' THEN NULLIF(TRIM(v_ship_j->>'source_id'), '') END,
    NULLIF(NULLIF(TRIM(p_order.tracking_number), 'No informado'), 'N/A'),
    NULLIF(NULLIF(TRIM(v_ship_j->>'tracking'), 'No informado'), 'N/A'),
    CASE WHEN (v_pickup_j->>'pin_retiro') IS NOT NULL AND TRIM(v_pickup_j->>'pin_retiro') <> '' THEN 'PIN: ' || (v_pickup_j->>'pin_retiro') END
  );

  v_eff_url := COALESCE(
    NULLIF(NULLIF(TRIM(p_order.tracking_url), 'N/A'), ''),
    NULLIF(NULLIF(TRIM(v_ship_j->>'tracking_url'), 'N/A'), '')
  );

  BEGIN
    v_delivered_at := COALESCE(
      p_order.delivered_at,
      NULLIF(TRIM(v_opti_j->>'opti_completed_at'), '')::timestamptz,
      NULLIF(TRIM(v_ship_j->>'updated_at'), '')::timestamptz,
      NULLIF(TRIM(v_pickup_j->>'updated_at'), '')::timestamptz,
      NULLIF(TRIM(v_mkt->>'delivered_at'), '')::timestamptz,
      NOW()
    );
  EXCEPTION WHEN OTHERS THEN
    v_delivered_at := COALESCE(p_order.delivered_at, NOW());
  END;

  -- Construir bloque shipment
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
      v_opti_j->>'opti_reception_name',
      v_pickup_j->>'nombre_apellido'
    ),
    'reception_rut', COALESCE(
      v_opti_j->>'opti_reception_rut',
      v_pickup_j->>'rut'
    ),
    'vehicle', v_opti_j->>'opti_vehicle',
    'route_started_at', v_opti_j->>'opti_route_started_at',
    'gps_lat', v_opti_j->>'opti_lat',
    'gps_lng', v_opti_j->>'opti_lng',
    'gps', CASE WHEN NULLIF(TRIM(v_opti_j->>'opti_lat'), '') IS NOT NULL AND NULLIF(TRIM(v_opti_j->>'opti_lng'), '') IS NOT NULL
                THEN jsonb_build_object('lat', v_opti_j->>'opti_lat', 'lng', v_opti_j->>'opti_lng')
                ELSE NULL END
  );

  -- Construir bloque pickup
  v_pickup_json := jsonb_build_object(
    'is_pickup', (v_cat = 'RETIRO' OR UPPER(TRIM(COALESCE(p_order.agenda, ''))) = 'RETIRO'),
    'pin_retiro', v_pickup_j->>'pin_retiro',
    'sucursal', COALESCE(v_pickup_j->>'sucursal', p_order.sucursal_pickeo),
    'estado_pedido', COALESCE(v_pickup_j->>'estado_pedido', CASE WHEN v_cat = 'RETIRO' THEN 'ENTREGADO' ELSE NULL END),
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

  -- Construir bloque picking (fusiona columnas de orders + picker_history_snapshot sincronizado desde Picker)
  v_picking_json := jsonb_build_object(
    'status', COALESCE(p_order.picker_status, p_order.picker_history_snapshot->>'status', 'Completado'),
    'operator', COALESCE(
      p_order.picker_operator,
      p_order.picker_history_snapshot->>'operator',
      v_pickup_j->>'picker_entrega'
    ),
    'warehouse', COALESCE(p_order.sucursal_pickeo, p_order.picker_history_snapshot->>'sucursal', 'Matriz Ñuñoa'),
    'picked_at', COALESCE(p_order.picker_last_synced_at, p_order.stock_descontado_at, p_order.created_at),
    'scanned_label', COALESCE(p_order.picker_scanned_label, p_order.picker_history_snapshot->>'scanned_label'),
    'items_summary', p_order.picker_history_snapshot->>'items_summary',
    'observation', p_order.picker_history_snapshot->>'observation',
    'logs', v_logs_json,
    'history_logs', v_logs_json
  );

  -- Resumen compacto de ítems del pedido (para el RPC público de tracking y auditoría autónoma)
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

  -- Asegurar que el hito final ENTREGADO esté en tracking_history
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
    'delivered_at', v_delivered_at,
    'dispatched_at', COALESCE(p_order.dispatched_at, p_order.stock_descontado_at, v_delivered_at),
    'shipment', v_ship_json,
    'pickup', v_pickup_json,
    'picking', v_picking_json,
    'items_snapshot', v_items_json,
    'total_units', v_total_units,
    'tracking_history', v_hist
  );
END;
$$;

-- =========================================================================================
-- 6. ACTUALIZAR FUNCIONES Y TRIGGERS DE INVENTARIO / ELEGIBILIDAD / CATEGORÍAS
-- =========================================================================================

-- 6.1 Categoría de Entrega (incluyendo SHOP POINT POS y LOGÍSTICA INVERSA en producción)
CREATE OR REPLACE FUNCTION public.handle_order_delivery_category_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_has_keyword BOOLEAN := false;
  v_keyword RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.categoria_entrega IN ('SHOP POINT (POS)', 'SHOP POINT', 'POS')
       OR NEW.origen IN ('Punto de Venta', 'POS', 'Shop Point', 'SHOP POINT (POS)')
       OR NEW.external_platform IN ('Punto de Venta', 'POS', 'Shop Point', 'SHOP POINT (POS)')
       OR NEW.agenda = 'COMPRA EN BODEGA'
       OR (NEW.external_order_number IS NOT NULL AND (NEW.external_order_number LIKE 'POS-%' OR NEW.external_order_number LIKE 'VTA-%'))
       OR (NEW.raw_shopify_data IS NOT NULL AND COALESCE((NEW.raw_shopify_data->>'is_pos_sale')::boolean, FALSE) IS TRUE) THEN
      NEW.categoria_entrega := 'SHOP POINT (POS)';
      IF NEW.agenda IS NULL OR NEW.agenda = '' OR NEW.agenda = 'POS' THEN
        NEW.agenda := 'COMPRA EN BODEGA';
      END IF;
      IF NEW.operador IS NULL OR NEW.operador = '' THEN
        NEW.operador := 'SUCURSAL ÑUÑOA';
      END IF;

    ELSIF NEW.categoria_entrega IN ('LOGÍSTICA INVERSA', 'LOGISTICA INVERSA')
       OR NEW.origen = 'Logística Inversa'
       OR NEW.external_platform = 'Logística Inversa'
       OR (NEW.external_order_number IS NOT NULL AND NEW.external_order_number LIKE 'LI-%')
       OR (NEW.raw_shopify_data IS NOT NULL AND COALESCE((NEW.raw_shopify_data->>'is_reverse_logistics')::boolean, FALSE) IS TRUE) THEN
      NEW.categoria_entrega := 'LOGÍSTICA INVERSA';

    ELSIF NEW.categoria_entrega IS NULL OR NEW.categoria_entrega = 'DISTRIBUCIÓN' THEN
      IF NEW.shipping_method IS NOT NULL AND NEW.shipping_method <> '' THEN
        FOR v_keyword IN SELECT value FROM public.wms_config_options WHERE type = 'keyword_retiro' LOOP
          IF LOWER(NEW.shipping_method) LIKE '%' || LOWER(v_keyword.value) || '%' THEN
            v_has_keyword := true;
            EXIT;
          END IF;
        END LOOP;
      END IF;
      NEW.categoria_entrega := CASE WHEN v_has_keyword THEN 'RETIRO' ELSE 'DISTRIBUCIÓN' END;
    END IF;

    IF NEW.categoria_entrega = 'RETIRO' THEN
      IF NEW.agenda IS NULL OR NEW.agenda = '' THEN NEW.agenda := 'RETIRO'; END IF;
      IF NEW.operador IS NULL OR NEW.operador = '' OR NEW.operador = 'STARKEN' THEN NEW.operador := 'SUCURSAL ÑUÑOA'; END IF;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.categoria_entrega IN ('SHOP POINT (POS)', 'SHOP POINT', 'POS') THEN
      NEW.categoria_entrega := 'SHOP POINT (POS)';
      IF NEW.agenda IS NULL OR NEW.agenda = '' OR NEW.agenda = 'POS' THEN NEW.agenda := 'COMPRA EN BODEGA'; END IF;
      IF NEW.operador IS NULL OR NEW.operador = '' THEN NEW.operador := 'SUCURSAL ÑUÑOA'; END IF;

    ELSIF NEW.categoria_entrega IN ('LOGÍSTICA INVERSA', 'LOGISTICA INVERSA') THEN
      NEW.categoria_entrega := 'LOGÍSTICA INVERSA';
      IF NEW.agenda = 'RETIRO' THEN NEW.agenda := NULL; END IF;
      IF NEW.operador = 'SUCURSAL ÑUÑOA' THEN NEW.operador := NULL; END IF;

    ELSIF (NEW.shipping_method IS DISTINCT FROM OLD.shipping_method) AND (NEW.categoria_entrega = 'DISTRIBUCIÓN' OR NEW.categoria_entrega IS NULL) THEN
      IF NOT (NEW.origen IN ('Logística Inversa', 'Punto de Venta') OR NEW.external_platform IN ('Logística Inversa', 'Punto de Venta') OR NEW.agenda = 'COMPRA EN BODEGA' OR COALESCE(NEW.external_order_number, '') LIKE 'LI-%') THEN
        IF NEW.shipping_method IS NOT NULL AND NEW.shipping_method <> '' THEN
          FOR v_keyword IN SELECT value FROM public.wms_config_options WHERE type = 'keyword_retiro' LOOP
            IF LOWER(NEW.shipping_method) LIKE '%' || LOWER(v_keyword.value) || '%' THEN
              v_has_keyword := true;
              EXIT;
            END IF;
          END LOOP;
        END IF;
        IF v_has_keyword THEN NEW.categoria_entrega := 'RETIRO'; END IF;
      END IF;
    END IF;

    IF NEW.categoria_entrega = 'RETIRO' AND (OLD.categoria_entrega IS DISTINCT FROM 'RETIRO') THEN
      NEW.agenda := 'RETIRO';
      NEW.operador := 'SUCURSAL ÑUÑOA';
    ELSIF NEW.categoria_entrega IN ('DISTRIBUCIÓN', 'LOGÍSTICA INVERSA', 'LOGISTICA INVERSA') AND OLD.categoria_entrega = 'RETIRO' THEN
      IF NEW.agenda = 'RETIRO' THEN NEW.agenda := NULL; END IF;
      IF NEW.operador = 'SUCURSAL ÑUÑOA' THEN NEW.operador := NULL; END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 6.2 Elegibilidad de compromiso de stock (incluye Entregado como estado terminal no comprometido)
CREATE OR REPLACE FUNCTION public.is_order_stock_eligible(p_order public.orders)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_status TEXT;
  v_wms TEXT;
  v_pay_status TEXT;
  v_shop_fin TEXT;
  v_platform TEXT;
  v_is_marketplace BOOLEAN;
BEGIN
  IF p_order.id IS NULL THEN
    RETURN FALSE;
  END IF;

  v_status := LOWER(TRIM(COALESCE(p_order.status, '')));
  v_wms := COALESCE(p_order.estado_wms, 'En procesamiento');

  IF v_status IN ('cancelado', 'devolución', 'devolucion') THEN
    RETURN FALSE;
  END IF;

  IF v_wms IN ('Cancelado', 'Archivado', 'Despachado', 'Entregado') THEN
    RETURN FALSE;
  END IF;

  IF p_order.raw_shopify_data IS NOT NULL THEN
    IF p_order.raw_shopify_data->>'cancelled_at' IS NOT NULL THEN
      RETURN FALSE;
    END IF;
    IF COALESCE((p_order.raw_shopify_data->>'confirmed')::boolean, true) = false THEN
      RETURN FALSE;
    END IF;
  END IF;

  v_pay_status := LOWER(TRIM(COALESCE(p_order.payment_status, '')));
  v_shop_fin := LOWER(TRIM(COALESCE(p_order.raw_shopify_data->>'financial_status', '')));
  v_platform := COALESCE(p_order.external_platform, p_order.origen, 'Manual');
  v_is_marketplace := v_platform IN ('Falabella', 'MercadoLibre', 'Mercado Libre', 'Paris', 'Ripley', 'Walmart');

  IF v_pay_status IN ('pending', 'pendiente', 'unpaid', 'no pagado', 'por_pagar', 'por pagar')
     OR v_shop_fin IN ('pending', 'pendiente', 'unpaid', 'no pagado', 'por_pagar', 'por pagar') THEN
    RETURN FALSE;
  END IF;

  IF v_pay_status IN ('refunded', 'reembolsado', 'partially_refunded', 'parcialmente_reembolsado', 'voided', 'anulado')
     OR v_shop_fin IN ('refunded', 'reembolsado', 'partially_refunded', 'parcialmente_reembolsado', 'voided', 'anulado') THEN
    RETURN FALSE;
  END IF;

  IF v_pay_status IN ('paid', 'pagado', 'completed', 'confirmed', 'approved', 'cobrado')
     OR v_shop_fin IN ('paid', 'pagado', 'completed', 'confirmed', 'approved', 'cobrado') THEN
    RETURN TRUE;
  END IF;

  IF v_is_marketplace THEN
    RETURN TRUE;
  END IF;

  IF v_platform IN ('Manual', 'Punto de Venta', 'Logística Inversa', 'Logistica Inversa') THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$function$;

-- 6.3 Validación antes de despacho: NUNCA revertir a "En procesamiento" cuando el paquete YA tiene tránsito/entrega física real
CREATE OR REPLACE FUNCTION public.validate_order_stock_before_dispatch()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  item RECORD;
  v_available_qty INTEGER;
  v_insufficient BOOLEAN := FALSE;
  v_user_id UUID;
  v_missing_sku TEXT;
  v_missing_qty INTEGER;
  v_wh_name TEXT;
  v_order_num TEXT;
  v_is_physical_auto BOOLEAN := FALSE;
  v_incident_title TEXT;
BEGIN
  v_order_num := COALESCE(NEW.external_order_number, NEW.id::text);

  -- 0. Idempotencia: si ya descontó stock, ya estaba Despachado/Entregado, o es backfill histórico antiguo (>14d), permitir siempre
  IF COALESCE(OLD.stock_descontado, FALSE) = TRUE
     OR COALESCE(NEW.stock_descontado, FALSE) = TRUE
     OR COALESCE(OLD.estado_wms, '') IN ('Despachado', 'Entregado')
     OR (COALESCE(NEW.closed_by_automation, '') LIKE 'backfill:%' AND COALESCE(OLD.created_at, NOW()) < NOW() - INTERVAL '14 days')
     OR EXISTS (SELECT 1 FROM public.movements WHERE order_id = NEW.id AND type = 'out')
     OR EXISTS (
          SELECT 1 FROM public.movements m
          JOIN public.order_items oi ON oi.order_id = NEW.id AND oi.product_id = m.product_id
          WHERE m.order_id IS NULL
            AND m.type = 'out'
            AND (m.reference_doc = 'Pedido ' || v_order_num
                 OR m.reference_doc = 'Pedido #' || v_order_num
                 OR m.reference_doc = 'Pedido ' || NEW.id::text)
     )
  THEN
    RETURN NEW;
  END IF;

  v_is_physical_auto := (COALESCE(current_setting('app.physical_carrier_transition', true), 'false') = 'true')
                        OR (NEW.closed_by_automation IS NOT NULL)
                        OR (NEW.estado_wms = 'Entregado');

  IF (NEW.status IN ('despachado', 'entregado', 'retirado', 'en preparación') AND COALESCE(OLD.status, '') NOT IN ('despachado', 'entregado', 'retirado', 'en preparación'))
     OR (NEW.estado_wms IN ('En preparación', 'Despachado', 'Entregado') AND COALESCE(OLD.estado_wms, '') NOT IN ('En preparación', 'Despachado', 'Entregado')) THEN

      IF NOT public.should_process_order_stock(NEW.id) THEN
        RETURN NEW;
      END IF;

      FOR item IN
        SELECT oi.*, p.sku, p.name AS prod_name, p.is_virtual, w.name AS wh_name
        FROM public.order_items oi
        JOIN public.products p ON p.id = oi.product_id
        JOIN public.warehouses w ON w.id = oi.warehouse_id
        WHERE oi.order_id = NEW.id
      LOOP
        IF COALESCE(item.is_virtual, FALSE) THEN
          CONTINUE;
        END IF;

        IF item.warehouse_id = 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09' THEN
          CONTINUE;
        END IF;

        SELECT COALESCE(quantity, 0) INTO v_available_qty
        FROM public.inventory
        WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;

        IF v_available_qty < item.quantity THEN
          v_insufficient := TRUE;
          v_missing_sku := item.sku;
          v_missing_qty := item.quantity - v_available_qty;
          v_wh_name := item.wh_name;
          EXIT;
        END IF;
      END LOOP;

      IF v_insufficient THEN
        SELECT id INTO v_user_id FROM public.profiles WHERE comercio ILIKE '%' || NEW.comercio || '%' LIMIT 1;

        IF v_is_physical_auto THEN
          -- REGLA DE ORO APROBADA: El paquete ya salió físicamente o fue entregado/retirado.
          -- JAMÁS revertir el pedido a "En procesamiento"; permitimos avanzar a Despachado/Entregado
          -- y creamos una Incidencia de Cuadratura de Stock para auditoría interna.
          v_incident_title := 'Cuadratura de stock post-despacho - Pedido ' || v_order_num;
          IF NOT EXISTS (
            SELECT 1 FROM public.incidencias
            WHERE title = v_incident_title AND status = 'pendiente'
          ) THEN
            INSERT INTO public.incidencias (
              user_id, comercio, title, description, type, severity, status, solution
            ) VALUES (
              COALESCE(v_user_id, NEW.merchant_id),
              'ADMIN_ONLY',
              v_incident_title,
              'El pedido ' || v_order_num || ' (' || COALESCE(NEW.comercio, 'Sin comercio') || ') avanzó automáticamente a "' || NEW.estado_wms || '" por confirmación real de transporte/retiro, pero en sistema faltaban ' || v_missing_qty || ' un. del SKU ' || v_missing_sku || ' en ' || v_wh_name || '. Se mantuvo el estado real del pedido y el inventario quedó en 0.',
              'stock',
              'alto',
              'pendiente',
              'Realizar conteo cíclico y ajuste de cuadratura del SKU ' || v_missing_sku || ' en ' || v_wh_name || '.'
            );
          END IF;
        ELSE
          -- Acción manual previa al despacho físico: prevenir cambio y revertir a En procesamiento
          NEW.status := 'para procesar';
          NEW.estado_wms := 'En procesamiento';

          IF NOT EXISTS (
            SELECT 1 FROM public.incidencias
            WHERE comercio = NEW.comercio
              AND status = 'pendiente'
              AND title = 'Falta de stock crítico - Pedido ' || NEW.external_order_number
          ) THEN
            INSERT INTO public.incidencias (
              user_id, comercio, title, description, type, severity, status, solution
            ) VALUES (
              COALESCE(v_user_id, NEW.merchant_id),
              NEW.comercio,
              'Falta de stock crítico - Pedido ' || NEW.external_order_number,
              'El pedido ' || NEW.external_order_number || ' no se pudo despachar/procesar por falta de stock del SKU ' || v_missing_sku || ' en la bodega ' || v_wh_name || ' (Faltan ' || v_missing_qty || ' un.).',
              'stock',
              'critico',
              'pendiente',
              ''
            );
          END IF;
        END IF;
      END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 6.4 Control transaccional de stock por estado WMS (Despachado y Entregado comparten descuento único idempotente)
CREATE OR REPLACE FUNCTION public.handle_order_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  item RECORD;
  v_old_wms TEXT;
  v_new_wms TEXT;
  v_is_virtual BOOLEAN;
  v_order_num TEXT;
  v_was_eligible BOOLEAN;
  v_is_eligible BOOLEAN;
BEGIN
  v_old_wms := COALESCE(OLD.estado_wms, 'En procesamiento');
  v_new_wms := COALESCE(NEW.estado_wms, 'En procesamiento');
  v_order_num := COALESCE(NEW.external_order_number, NEW.id::text);

  -- Marcas temporales operativas
  IF v_new_wms IN ('Despachado', 'Entregado') AND NEW.dispatched_at IS NULL THEN
    NEW.dispatched_at := COALESCE(NEW.stock_descontado_at, NOW());
  END IF;
  IF v_new_wms = 'Entregado' THEN
    NEW.delivered_at := COALESCE(NEW.delivered_at, NOW());
    NEW.closed_at := COALESCE(NEW.closed_at, NOW());
  END IF;

  IF NOT public.should_process_order_stock(NEW.id) THEN
    RETURN NEW;
  END IF;

  v_was_eligible := public.is_order_stock_eligible(OLD);
  v_is_eligible := public.is_order_stock_eligible(NEW);

  -- =========================================================================
  -- CASO 1: El pedido entra por primera vez al grupo de salida física ('Despachado' o 'Entregado')
  -- Nota: Si pasa de 'Despachado' -> 'Entregado', v_old_wms YA está en el grupo, por lo que NO descuenta dos veces.
  -- =========================================================================
  IF v_new_wms IN ('Despachado', 'Entregado') AND v_old_wms NOT IN ('Despachado', 'Entregado') THEN

    IF COALESCE(OLD.stock_descontado, false) = true
       OR (COALESCE(NEW.closed_by_automation, '') LIKE 'backfill:%' AND COALESCE(OLD.created_at, NOW()) < NOW() - INTERVAL '14 days')
       OR EXISTS (SELECT 1 FROM public.movements WHERE order_id = NEW.id AND type = 'out')
       OR EXISTS (
            SELECT 1 FROM public.movements m
            JOIN public.order_items oi ON oi.order_id = NEW.id AND oi.product_id = m.product_id
            WHERE m.order_id IS NULL
              AND m.type = 'out'
              AND (m.reference_doc = 'Pedido ' || v_order_num
                   OR m.reference_doc = 'Pedido #' || v_order_num
                   OR m.reference_doc = 'Pedido ' || NEW.id::text)
       )
    THEN
      UPDATE public.movements m
      SET order_id = NEW.id
      FROM public.order_items oi
      WHERE m.order_id IS NULL
        AND m.type = 'out'
        AND oi.order_id = NEW.id
        AND oi.product_id = m.product_id
        AND (m.reference_doc = 'Pedido ' || v_order_num
             OR m.reference_doc = 'Pedido #' || v_order_num
             OR m.reference_doc = 'Pedido ' || NEW.id::text);

      FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
        SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
        IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
          IF v_old_wms IN ('En preparación', 'Pickeado') THEN
            UPDATE public.inventory
            SET reserved_quantity = GREATEST(0, reserved_quantity - item.quantity)
            WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
          ELSIF v_old_wms = 'En procesamiento' AND v_was_eligible THEN
            UPDATE public.inventory
            SET committed_quantity = GREATEST(0, committed_quantity - item.quantity)
            WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
          END IF;
        END IF;
      END LOOP;

      NEW.stock_descontado := true;
      NEW.stock_descontado_at := COALESCE(NEW.stock_descontado_at, NOW());
      RETURN NEW;
    END IF;

    FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
      SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
      IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN

        IF NOT EXISTS (
          SELECT 1 FROM public.movements
          WHERE order_id = NEW.id AND product_id = item.product_id AND type = 'out'
        ) THEN
          IF v_old_wms IN ('En preparación', 'Pickeado') THEN
            UPDATE public.inventory
            SET quantity = GREATEST(0, quantity - item.quantity),
                reserved_quantity = GREATEST(0, reserved_quantity - item.quantity)
            WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;

          ELSIF v_old_wms IN ('Cancelado', 'Archivado') THEN
            UPDATE public.inventory
            SET quantity = GREATEST(0, quantity - item.quantity)
            WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;

          ELSE
            UPDATE public.inventory
            SET quantity = GREATEST(0, quantity - item.quantity),
                committed_quantity = CASE WHEN v_was_eligible THEN GREATEST(0, committed_quantity - item.quantity) ELSE committed_quantity END
            WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
          END IF;

          INSERT INTO public.movements (product_id, warehouse_id, type, quantity, date, reference_doc, order_id)
          VALUES (item.product_id, item.warehouse_id, 'out', item.quantity, NOW(), 'Pedido ' || v_order_num, NEW.id);
        END IF;

      END IF;
    END LOOP;

    NEW.stock_descontado := true;
    NEW.stock_descontado_at := COALESCE(NEW.stock_descontado_at, NOW());

  -- =========================================================================
  -- CASO 2: El pedido pasa a "En preparación" o "Pickeado"
  -- =========================================================================
  ELSIF v_new_wms IN ('En preparación', 'Pickeado')
        AND v_old_wms NOT IN ('En preparación', 'Pickeado', 'Despachado', 'Entregado') THEN

    FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
      SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
      IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
        IF v_old_wms = 'En procesamiento' AND v_was_eligible THEN
          UPDATE public.inventory
          SET committed_quantity = GREATEST(0, committed_quantity - item.quantity),
              reserved_quantity = reserved_quantity + item.quantity
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        ELSE
          UPDATE public.inventory
          SET reserved_quantity = reserved_quantity + item.quantity
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        END IF;
      END IF;
    END LOOP;

  -- =========================================================================
  -- CASO 3: El pedido se DEVUELVE de mesa ("En preparación"/"Pickeado") a "En procesamiento"
  -- =========================================================================
  ELSIF v_new_wms = 'En procesamiento'
        AND v_old_wms IN ('En preparación', 'Pickeado')
        AND v_old_wms NOT IN ('Despachado', 'Entregado') THEN

    FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
      SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
      IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
        UPDATE public.inventory
        SET reserved_quantity = GREATEST(0, reserved_quantity - item.quantity)
        WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;

        IF v_is_eligible THEN
          UPDATE public.inventory
          SET committed_quantity = committed_quantity + item.quantity
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        END IF;
      END IF;
    END LOOP;

  -- =========================================================================
  -- CASO 4: El pedido se CANCELA o ARCHIVA en WMS
  -- =========================================================================
  ELSIF v_new_wms IN ('Cancelado', 'Archivado')
        AND v_old_wms NOT IN ('Cancelado', 'Archivado', 'Despachado', 'Entregado') THEN

    FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
      SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
      IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
        IF v_old_wms IN ('En preparación', 'Pickeado') THEN
          UPDATE public.inventory
          SET reserved_quantity = GREATEST(0, reserved_quantity - item.quantity)
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        ELSIF v_was_eligible THEN
          UPDATE public.inventory
          SET committed_quantity = GREATEST(0, committed_quantity - item.quantity)
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        END IF;
      END IF;
    END LOOP;

  -- =========================================================================
  -- CASO 5: Transición de Elegibilidad de Stock en Estante ('En procesamiento')
  -- =========================================================================
  ELSIF v_new_wms = 'En procesamiento' AND v_old_wms IN ('En procesamiento', 'Cancelado', 'Archivado', 'Incidencia') THEN
    IF NOT v_was_eligible AND v_is_eligible THEN
      FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
        SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
        IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
          UPDATE public.inventory
          SET committed_quantity = committed_quantity + item.quantity
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        END IF;
      END LOOP;
    ELSIF v_was_eligible AND NOT v_is_eligible THEN
      FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
        SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
        IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
          UPDATE public.inventory
          SET committed_quantity = GREATEST(0, committed_quantity - item.quantity)
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        END IF;
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 6.5 Triggers de order_items y recalculate_committed_stock (protegiendo 'Entregado')
CREATE OR REPLACE FUNCTION public.handle_new_order_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_order public.orders;
  v_wms_status TEXT;
  v_is_virtual BOOLEAN;
  v_should_process BOOLEAN;
  v_is_eligible BOOLEAN;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = NEW.order_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_wms_status := COALESCE(v_order.estado_wms, 'En procesamiento');
  v_should_process := public.should_process_order_stock(NEW.order_id);
  IF NOT v_should_process THEN RETURN NEW; END IF;

  SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = NEW.product_id;
  IF v_is_virtual THEN RETURN NEW; END IF;

  IF v_wms_status IN ('Despachado', 'Entregado', 'Cancelado', 'Archivado') THEN
    RETURN NEW;
  END IF;

  IF v_wms_status IN ('En preparación', 'Pickeado') THEN
    IF NEW.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET reserved_quantity = reserved_quantity + NEW.quantity
      WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
    END IF;
  ELSE
    v_is_eligible := public.is_order_stock_eligible(v_order);
    IF v_is_eligible AND NEW.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET committed_quantity = committed_quantity + NEW.quantity
      WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_delete_order_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_order public.orders;
  v_wms_status TEXT;
  v_is_virtual BOOLEAN;
  v_should_process BOOLEAN;
  v_was_eligible BOOLEAN;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = OLD.order_id;
  IF NOT FOUND THEN RETURN OLD; END IF;

  v_should_process := public.should_process_order_stock(OLD.order_id);
  IF NOT v_should_process THEN RETURN OLD; END IF;

  SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = OLD.product_id;
  IF v_is_virtual THEN RETURN OLD; END IF;

  v_wms_status := COALESCE(v_order.estado_wms, 'En procesamiento');
  IF v_wms_status IN ('Despachado', 'Entregado', 'Cancelado', 'Archivado') THEN
    RETURN OLD;
  END IF;

  IF v_wms_status IN ('En preparación', 'Pickeado') THEN
    IF OLD.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET reserved_quantity = GREATEST(0, reserved_quantity - OLD.quantity)
      WHERE product_id = OLD.product_id AND warehouse_id = OLD.warehouse_id;
    END IF;
  ELSE
    v_was_eligible := public.is_order_stock_eligible(v_order);
    IF v_was_eligible AND OLD.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET committed_quantity = GREATEST(0, committed_quantity - OLD.quantity)
      WHERE product_id = OLD.product_id AND warehouse_id = OLD.warehouse_id;
    END IF;
  END IF;

  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_update_order_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_order public.orders;
  v_old_process BOOLEAN;
  v_new_process BOOLEAN;
  v_old_is_virtual BOOLEAN;
  v_new_is_virtual BOOLEAN;
  v_qty_diff INTEGER;
  v_wms_status TEXT;
  v_is_eligible BOOLEAN;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = NEW.order_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_old_process := public.should_process_order_stock(OLD.order_id);
  v_new_process := public.should_process_order_stock(NEW.order_id);
  IF NOT v_old_process AND NOT v_new_process THEN RETURN NEW; END IF;

  SELECT COALESCE(is_virtual, false) INTO v_old_is_virtual FROM public.products WHERE id = OLD.product_id;
  SELECT COALESCE(is_virtual, false) INTO v_new_is_virtual FROM public.products WHERE id = NEW.product_id;

  v_wms_status := COALESCE(v_order.estado_wms, 'En procesamiento');
  IF v_wms_status IN ('Despachado', 'Entregado', 'Cancelado', 'Archivado') THEN
    RETURN NEW;
  END IF;

  v_is_eligible := public.is_order_stock_eligible(v_order);

  IF v_wms_status IN ('En preparación', 'Pickeado') THEN
    IF OLD.product_id != NEW.product_id OR OLD.warehouse_id != NEW.warehouse_id THEN
      IF v_old_process AND OLD.warehouse_id IS NOT NULL AND NOT v_old_is_virtual THEN
        UPDATE public.inventory
        SET reserved_quantity = GREATEST(0, reserved_quantity - OLD.quantity)
        WHERE product_id = OLD.product_id AND warehouse_id = OLD.warehouse_id;
      END IF;
      IF v_new_process AND NEW.warehouse_id IS NOT NULL AND NOT v_new_is_virtual THEN
        UPDATE public.inventory
        SET reserved_quantity = reserved_quantity + NEW.quantity
        WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
      END IF;
    ELSE
      v_qty_diff := NEW.quantity - OLD.quantity;
      IF v_qty_diff != 0 AND NEW.warehouse_id IS NOT NULL AND NOT v_new_is_virtual THEN
        UPDATE public.inventory
        SET reserved_quantity = GREATEST(0, reserved_quantity + v_qty_diff)
        WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
      END IF;
    END IF;
  ELSE
    IF OLD.product_id != NEW.product_id OR OLD.warehouse_id != NEW.warehouse_id THEN
      IF v_old_process AND OLD.warehouse_id IS NOT NULL AND NOT v_old_is_virtual AND v_is_eligible THEN
        UPDATE public.inventory
        SET committed_quantity = GREATEST(0, committed_quantity - OLD.quantity)
        WHERE product_id = OLD.product_id AND warehouse_id = OLD.warehouse_id;
      END IF;
      IF v_new_process AND NEW.warehouse_id IS NOT NULL AND NOT v_new_is_virtual AND v_is_eligible THEN
        UPDATE public.inventory
        SET committed_quantity = committed_quantity + NEW.quantity
        WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
      END IF;
    ELSE
      v_qty_diff := NEW.quantity - OLD.quantity;
      IF v_qty_diff != 0 AND NEW.warehouse_id IS NOT NULL AND NOT v_new_is_virtual AND v_is_eligible THEN
        UPDATE public.inventory
        SET committed_quantity = GREATEST(0, committed_quantity + v_qty_diff)
        WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_committed_stock()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  r RECORD;
BEGIN
  UPDATE public.inventory
  SET committed_quantity = 0,
      reserved_quantity = 0
  WHERE id IS NOT NULL;

  FOR r IN
    SELECT oi.product_id, oi.warehouse_id, SUM(oi.quantity) AS total_committed
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE COALESCE(o.estado_wms, 'En procesamiento') NOT IN ('En preparación', 'Pickeado', 'Despachado', 'Entregado', 'Cancelado', 'Archivado')
      AND public.should_process_order_stock(o.id)
      AND public.is_order_stock_eligible(o)
    GROUP BY oi.product_id, oi.warehouse_id
  LOOP
    IF r.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET committed_quantity = r.total_committed
      WHERE product_id = r.product_id AND warehouse_id = r.warehouse_id;
    END IF;
  END LOOP;

  FOR r IN
    SELECT oi.product_id, oi.warehouse_id, SUM(oi.quantity) AS total_reserved
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.estado_wms IN ('En preparación', 'Pickeado')
      AND public.should_process_order_stock(o.id)
    GROUP BY oi.product_id, oi.warehouse_id
  LOOP
    IF r.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET reserved_quantity = r.total_reserved
      WHERE product_id = r.product_id AND warehouse_id = r.warehouse_id;
    END IF;
  END LOOP;
END;
$function$;

-- =========================================================================================
-- 7. BLINDAJE DE INMUTABILIDAD DE "Entregado", AUTO-CIERRE POS/MARKETPLACE Y SELLADO SNAPSHOT
-- =========================================================================================

-- 7.1 Primer trigger BEFORE (aa_...): Inmutabilidad de pedidos cerrados + Auto-detección POS y Marketplaces
CREATE OR REPLACE FUNCTION public.enforce_delivered_immutability_and_auto_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mkt JSONB;
BEGIN
  -- A. Si el pedido YA estaba en 'Entregado' y NO es una reapertura autorizada por Super-Admin:
  --    Congelar todos los campos operativos/logísticos, permitiendo únicamente metadatos administrativos
  --    (ej: periodo_facturacion para Finanzas, admin_notes, auditoría de Shopify o enriquecimiento de picker_history_snapshot).
  IF TG_OP = 'UPDATE'
     AND OLD.estado_wms = 'Entregado'
     AND COALESCE(current_setting('app.allow_admin_reopen', true), 'false') <> 'true'
  THEN
    NEW.estado_wms := 'Entregado';
    NEW.status := OLD.status;
    NEW.tracking_number := COALESCE(OLD.tracking_number, NEW.tracking_number);
    NEW.tracking_url := COALESCE(OLD.tracking_url, NEW.tracking_url);
    NEW.courier := COALESCE(OLD.courier, NEW.courier);
    NEW.operador := COALESCE(OLD.operador, NEW.operador);
    NEW.agenda := COALESCE(OLD.agenda, NEW.agenda);
    NEW.categoria_entrega := COALESCE(OLD.categoria_entrega, NEW.categoria_entrega);
    NEW.sucursal_pickeo := COALESCE(OLD.sucursal_pickeo, NEW.sucursal_pickeo);
    NEW.cantidad := OLD.cantidad;
    NEW.sku := OLD.sku;
    NEW.item := OLD.item;
    NEW.stock_descontado := OLD.stock_descontado;
    NEW.stock_descontado_at := OLD.stock_descontado_at;
    NEW.dispatched_at := COALESCE(OLD.dispatched_at, NEW.dispatched_at);
    NEW.delivered_at := COALESCE(OLD.delivered_at, NEW.delivered_at);
    NEW.closed_at := COALESCE(OLD.closed_at, NEW.closed_at);
    NEW.closed_by_automation := COALESCE(OLD.closed_by_automation, NEW.closed_by_automation);
    NEW.transport_status_normalized := 'ENTREGADO';
    NEW.tracking_history := COALESCE(OLD.tracking_history, NEW.tracking_history);

    -- Si llegó enriquecimiento tardío de picker_history_snapshot y antes no estaba en closed_snapshot, regenerar snapshot una sola vez
    IF OLD.closed_snapshot IS NOT NULL AND (NEW.picker_history_snapshot IS NOT DISTINCT FROM OLD.picker_history_snapshot) THEN
      NEW.closed_snapshot := OLD.closed_snapshot;
    END IF;

    RETURN NEW;
  END IF;

  -- B. Auto-cierre por Venta Presencial POS o Entrega Confirmada en Marketplace/Shopify Fulfillment
  IF COALESCE(NEW.estado_wms, 'En procesamiento') NOT IN ('Entregado', 'Cancelado', 'Archivado') THEN
    v_mkt := public.extract_marketplace_or_pos_delivery(NEW);

    IF COALESCE((v_mkt->>'is_pos')::boolean, FALSE) IS TRUE
       AND public.is_automation_rule_enabled('auto-pos-sale-to-entregado') THEN
      NEW.estado_wms := 'Entregado';
      NEW.status := 'entregado';
      NEW.transport_status_normalized := 'ENTREGADO';
      NEW.closed_by_automation := 'auto-pos-sale-to-entregado';
      NEW.delivered_at := COALESCE(NEW.delivered_at, (v_mkt->>'delivered_at')::timestamptz, NOW());
      NEW.closed_at := COALESCE(NEW.closed_at, NOW());

    ELSIF COALESCE((v_mkt->>'is_delivered')::boolean, FALSE) IS TRUE
       AND public.is_automation_rule_enabled('auto-marketplace-delivered-to-entregado') THEN
      NEW.estado_wms := 'Entregado';
      NEW.status := 'entregado';
      NEW.transport_status_normalized := 'ENTREGADO';
      NEW.closed_by_automation := 'auto-marketplace-delivered-to-entregado';
      NEW.delivered_at := COALESCE(NEW.delivered_at, (v_mkt->>'delivered_at')::timestamptz, NOW());
      NEW.closed_at := COALESCE(NEW.closed_at, NOW());
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aa_enforce_delivered_immutability_and_auto_close ON public.orders;
CREATE TRIGGER aa_enforce_delivered_immutability_and_auto_close
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_delivered_immutability_and_auto_close();

-- 7.2 Último trigger BEFORE (zz_...): Sellar closed_snapshot siempre que un pedido entre o esté en 'Entregado'
CREATE OR REPLACE FUNCTION public.seal_order_closed_snapshot_trigger_func()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.estado_wms = 'Entregado' THEN
    NEW.transport_status_normalized := 'ENTREGADO';
    NEW.delivered_at := COALESCE(NEW.delivered_at, NOW());
    NEW.closed_at := COALESCE(NEW.closed_at, NOW());
    NEW.dispatched_at := COALESCE(NEW.dispatched_at, NEW.stock_descontado_at, NEW.delivered_at);
    IF NEW.status NOT IN ('entregado', 'retirado', 'despachado') THEN
      NEW.status := CASE WHEN UPPER(TRIM(COALESCE(NEW.categoria_entrega, ''))) = 'RETIRO' THEN 'retirado' ELSE 'entregado' END;
    END IF;

    IF TG_OP = 'INSERT'
       OR OLD.estado_wms IS DISTINCT FROM 'Entregado'
       OR NEW.closed_snapshot IS NULL
       OR (NEW.picker_history_snapshot IS DISTINCT FROM OLD.picker_history_snapshot)
    THEN
      NEW.closed_snapshot := public.build_order_closed_snapshot(NEW);
      NEW.tracking_history := COALESCE(NEW.closed_snapshot->'tracking_history', NEW.tracking_history);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_seal_order_closed_snapshot ON public.orders;
CREATE TRIGGER zz_seal_order_closed_snapshot
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.seal_order_closed_snapshot_trigger_func();

-- 7.3 Trigger AFTER en orders: Bitácora de auto-cierres POS/Marketplace y Propagación a Hijos Consolidados
CREATE OR REPLACE FUNCTION public.after_order_wms_transition_propagate_func()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_wms TEXT := CASE WHEN TG_OP = 'UPDATE' THEN COALESCE(OLD.estado_wms, 'En procesamiento') ELSE NULL END;
BEGIN
  -- 1. Registrar en bitácora si el cierre fue disparado por regla automática en orders (POS / Marketplace)
  IF NEW.estado_wms = 'Entregado'
     AND (TG_OP = 'INSERT' OR OLD.estado_wms IS DISTINCT FROM 'Entregado')
     AND NEW.closed_by_automation IN ('auto-pos-sale-to-entregado', 'auto-marketplace-delivered-to-entregado')
  THEN
    PERFORM public.log_automation_execution(
      NEW.closed_by_automation,
      NEW.id,
      NEW.external_order_number,
      NEW.comercio,
      COALESCE(v_prev_wms, 'Nuevo'),
      'Entregado',
      NEW.closed_by_automation,
      'Cierre automático y sellado de snapshot en base de datos',
      FALSE
    );
  END IF;

  -- 2. Propagar Despachado / Entregado desde Pedido Principal Consolidado hacia sus Pedidos Secundarios Consolidados
  --    (dividido en 2 consultas por índice parcial B-tree puro para evitar Seq Scan / descompresión TOAST de raw_shopify_data)
  IF NEW.estado_wms IN ('Despachado', 'Entregado')
     AND (TG_OP = 'INSERT' OR OLD.estado_wms IS DISTINCT FROM NEW.estado_wms)
  THEN
    PERFORM set_config('app.physical_carrier_transition', 'true', true);

    UPDATE public.orders child
    SET
      estado_wms = NEW.estado_wms,
      status = NEW.status,
      tracking_number = COALESCE(NEW.tracking_number, child.tracking_number),
      tracking_url = COALESCE(NEW.tracking_url, child.tracking_url),
      courier = COALESCE(NEW.courier, child.courier),
      operador = COALESCE(NEW.operador, child.operador),
      transport_status_normalized = NEW.transport_status_normalized,
      dispatched_at = COALESCE(NEW.dispatched_at, child.dispatched_at),
      delivered_at = CASE WHEN NEW.estado_wms = 'Entregado' THEN COALESCE(NEW.delivered_at, NOW()) ELSE child.delivered_at END,
      closed_by_automation = CASE WHEN NEW.estado_wms = 'Entregado' THEN COALESCE(NEW.closed_by_automation, 'consolidated_from_primary') ELSE child.closed_by_automation END
    WHERE child.consolidated_into_order_id IS NOT NULL
      AND child.consolidated_into_order_id = NEW.id
      AND child.id <> NEW.id
      AND child.estado_wms NOT IN ('Entregado', 'Cancelado', 'Archivado')
      AND child.estado_wms IS DISTINCT FROM NEW.estado_wms;

    UPDATE public.orders child
    SET
      estado_wms = NEW.estado_wms,
      status = NEW.status,
      tracking_number = COALESCE(NEW.tracking_number, child.tracking_number),
      tracking_url = COALESCE(NEW.tracking_url, child.tracking_url),
      courier = COALESCE(NEW.courier, child.courier),
      operador = COALESCE(NEW.operador, child.operador),
      transport_status_normalized = NEW.transport_status_normalized,
      dispatched_at = COALESCE(NEW.dispatched_at, child.dispatched_at),
      delivered_at = CASE WHEN NEW.estado_wms = 'Entregado' THEN COALESCE(NEW.delivered_at, NOW()) ELSE child.delivered_at END,
      closed_by_automation = CASE WHEN NEW.estado_wms = 'Entregado' THEN COALESCE(NEW.closed_by_automation, 'consolidated_from_primary') ELSE child.closed_by_automation END
    WHERE (child.raw_shopify_data->>'_consolidated_into_order_id') IS NOT NULL
      AND (child.raw_shopify_data->>'_consolidated_into_order_id') = NEW.id::text
      AND child.id <> NEW.id
      AND child.estado_wms NOT IN ('Entregado', 'Cancelado', 'Archivado')
      AND child.estado_wms IS DISTINCT FROM NEW.estado_wms;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_after_order_wms_transition_propagate ON public.orders;
CREATE TRIGGER trg_after_order_wms_transition_propagate
  AFTER INSERT OR UPDATE OF estado_wms ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.after_order_wms_transition_propagate_func();

-- =========================================================================================
-- 8. AUTOMATIZACIONES EN TIEMPO REAL DESDE envios_unificados, store_pickups Y reverse_logistics
-- =========================================================================================

-- 8.1 Proteger sync_unified_status_to_orders_func y sync_enviame_shipment_to_orders_func en pedidos cerrados
CREATE OR REPLACE FUNCTION public.sync_unified_status_to_orders_func()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_order_uuid UUID;
  v_current_wms_status TEXT;
  v_current_track TEXT;
  v_current_url TEXT;
  v_target_operador TEXT;
  v_courier_upper TEXT;
  v_effective_tracking TEXT;
BEGIN
  IF NEW.pedido_referencia IS NULL THEN
    RETURN NEW;
  END IF;

  v_courier_upper := UPPER(TRIM(COALESCE(NEW.courier, '')));
  IF v_courier_upper ~ '(RECIBELO|RECÍBELO|WELIVERY|WOODELIVERY|WODELY)' THEN
    RETURN NEW;
  END IF;

  IF NEW.pedido_referencia ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id, estado_wms, tracking_number, tracking_url
    INTO v_order_uuid, v_current_wms_status, v_current_track, v_current_url
    FROM public.orders WHERE id = NEW.pedido_referencia::uuid;
  ELSE
    SELECT id, estado_wms, tracking_number, tracking_url
    INTO v_order_uuid, v_current_wms_status, v_current_track, v_current_url
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

  IF v_order_uuid IS NULL OR COALESCE(v_current_wms_status, '') = 'Entregado' THEN
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

  IF NEW.source_table = 'lightdata_envios' THEN
    v_effective_tracking := COALESCE(NULLIF(TRIM(NEW.source_id), ''), NEW.tracking);
  ELSE
    v_effective_tracking := NEW.tracking;
  END IF;

  IF NEW.global_status = 'DESPACHADO' OR (v_current_track IS NULL OR TRIM(v_current_track) = '') THEN
    UPDATE public.orders
    SET
      tracking_number = COALESCE(NULLIF(TRIM(v_effective_tracking), ''), tracking_number),
      tracking_url = CASE
        WHEN TRIM(COALESCE(v_current_track, '')) = TRIM(COALESCE(v_effective_tracking, ''))
             AND v_current_url IS NOT NULL AND TRIM(v_current_url) LIKE 'http%'
        THEN v_current_url
        ELSE COALESCE(NULLIF(TRIM(NEW.tracking_url), ''), tracking_url)
      END,
      courier = COALESCE(NULLIF(TRIM(NEW.courier), ''), courier),
      operador = COALESCE(NULLIF(TRIM(v_target_operador), ''), operador)
    WHERE id = v_order_uuid
      AND estado_wms <> 'Entregado'
      AND (
        COALESCE(tracking_number, '') IS DISTINCT FROM COALESCE(NULLIF(TRIM(v_effective_tracking), ''), tracking_number, '')
        OR (v_current_url IS NULL AND NEW.tracking_url IS NOT NULL)
      );
  END IF;

  RETURN NEW;
END;
$function$;

-- 8.2 Motor Principal en envios_unificados:
--     - "EN TRÁNSITO" -> Despachado (desde En procesamiento, En preparación o Pickeado)
--     - "ENTREGADO"   -> Entregado (cierre definitivo con snapshot)
--     - "ALERTA"      -> Incidencia (solo si no estaba cerrado)
CREATE OR REPLACE FUNCTION public.handle_unified_shipment_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
BEGIN
  IF v_courier_upper ~ '(RECIBELO|RECÍBELO|WELIVERY|WOODELIVERY|WODELY)' THEN
    RETURN NEW;
  END IF;

  v_class := public.classify_shipment_transport_status(NEW.source_table, NEW.status, NEW.raw_data);
  v_norm := v_class->>'norm';
  v_clean_status := v_class->>'clean_status';

  IF NEW.source_table = 'lightdata_envios' THEN
    v_eff_tracking := COALESCE(NULLIF(TRIM(NEW.source_id), ''), NULLIF(TRIM(NEW.tracking), ''));
  ELSE
    v_eff_tracking := NULLIF(TRIM(NEW.tracking), '');
  END IF;
  IF UPPER(COALESCE(v_eff_tracking, '')) IN ('N/A', 'NO INFORMADO', 'NOINFORMADO', 'NULL', 'UNDEFINED', '-') THEN
    v_eff_tracking := NULL;
  END IF;

  -- 1. Resolver pedido con máxima precisión (sin colisión entre comercios ni confusión con hijos Split #6560-2)
  IF NEW.pedido_referencia IS NOT NULL AND NEW.pedido_referencia ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO v_order FROM public.orders WHERE id = NEW.pedido_referencia::uuid LIMIT 1;
  END IF;

  IF v_order.id IS NULL AND v_eff_tracking IS NOT NULL THEN
    -- 1A. Primero revisar guía forzada mediante índice parcial idx_orders_forced_tracking
    SELECT * INTO v_order
    FROM public.orders o
    WHERE COALESCE((o.raw_shopify_data->'wms_forced_tracking'->>'active')::boolean, FALSE) IS TRUE
      AND UPPER(TRIM(o.raw_shopify_data->'wms_forced_tracking'->>'tracking_number')) = UPPER(v_eff_tracking)
    ORDER BY o.created_at DESC
    LIMIT 1;
  END IF;

  IF v_order.id IS NULL AND v_eff_tracking IS NOT NULL THEN
    -- 1B. Luego revisar tracking_number directo mediante idx_orders_tracking_number
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
      -- Sin comercio explícito en el envío: solo aceptar coincidencia exacta unívoca (no numérica corta genérica)
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

  -- Si el pedido ya está cerrado en 'Entregado', 'Cancelado' o 'Archivado', no alterar jamás
  IF COALESCE(v_order.estado_wms, '') IN ('Entregado', 'Cancelado', 'Archivado') THEN
    RETURN NEW;
  END IF;

  -- Respetar wms_forced_tracking: si el usuario fijó otra guía distinta en este pedido, ignorar envíos secundarios
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
    -- Caso especial: si es una orden de LOGÍSTICA INVERSA, la entrega confirma arribo a bodega Stocka
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
    -- Si salta desde En procesamiento o En preparación sin haber sido marcado Pickeado, levantar alerta de trazabilidad de picking
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
    -- Actualizar solo historial y estado normalizado si cambió
    IF (v_order.transport_status_normalized IS DISTINCT FROM v_norm)
       OR (v_order.tracking_history IS DISTINCT FROM v_new_hist) THEN
      UPDATE public.orders
      SET transport_status_normalized = v_norm,
          tracking_history = v_new_hist
      WHERE id = v_order.id
        AND estado_wms <> 'Entregado';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_on_unified_shipment_status_change ON public.envios_unificados;
CREATE TRIGGER trg_on_unified_shipment_status_change
  AFTER INSERT OR UPDATE ON public.envios_unificados
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_unified_shipment_status_change();

-- 8.3 Automatización en store_pickups: Retiro ENTREGADO / RETIRADO -> Estado WMS "Entregado"
CREATE OR REPLACE FUNCTION public.handle_store_pickup_to_entregado_func()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_st TEXT := UPPER(TRIM(COALESCE(NEW.estado_pedido, '')));
  v_ped_clean TEXT := REGEXP_REPLACE(TRIM(COALESCE(NEW.pedido, '')), '^#+', '');
  v_order public.orders;
BEGIN
  IF v_st NOT IN ('ENTREGADO', 'RETIRADO') OR v_ped_clean = '' THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_automation_rule_enabled('auto-pickup-retirado-to-entregado') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_order
  FROM public.orders o
  WHERE o.external_order_number IN (TRIM(NEW.pedido), v_ped_clean, '#' || v_ped_clean)
    AND (NEW.comercio IS NULL OR TRIM(NEW.comercio) = '' OR LOWER(TRIM(o.comercio)) = LOWER(TRIM(NEW.comercio)))
  ORDER BY o.created_at DESC
  LIMIT 1;

  IF v_order.id IS NULL AND NEW.pedido ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO v_order FROM public.orders WHERE id = NEW.pedido::uuid LIMIT 1;
  END IF;

  IF v_order.id IS NULL OR COALESCE(v_order.estado_wms, '') IN ('Entregado', 'Cancelado', 'Archivado') THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.physical_carrier_transition', 'true', true);

  UPDATE public.orders
  SET
    estado_wms = 'Entregado',
    status = 'retirado',
    transport_status_normalized = 'ENTREGADO',
    delivered_at = COALESCE(delivered_at, NEW.updated_at, NOW()),
    closed_at = NOW(),
    closed_by_automation = 'auto-pickup-retirado-to-entregado',
    tracking_history = public.append_order_tracking_checkpoint(
      tracking_history,
      'Retirado por cliente en sucursal',
      'ENTREGADO',
      'store_pickups',
      COALESCE(NEW.updated_at, NOW())
    )
  WHERE id = v_order.id;

  PERFORM public.log_automation_execution(
    'auto-pickup-retirado-to-entregado',
    v_order.id,
    v_order.external_order_number,
    v_order.comercio,
    COALESCE(v_order.estado_wms, 'En procesamiento'),
    'Entregado',
    'store_pickups',
    'Pedido retirado en ' || COALESCE(NEW.sucursal, 'Sucursal') || COALESCE(' · PIN: ' || NEW.pin_retiro, ''),
    FALSE
  );

  INSERT INTO public.order_audit_logs (order_id, user_id, user_email, action, details)
  VALUES (
    v_order.id,
    NULL,
    'Centro de Automatizaciones WMS',
    'Cierre Automático por Retiro en Sucursal',
    jsonb_build_object(
      'rule_id', 'auto-pickup-retirado-to-entregado',
      'previous_wms_status', v_order.estado_wms,
      'new_wms_status', 'Entregado',
      'sucursal', NEW.sucursal,
      'pin_retiro', NEW.pin_retiro,
      'picker_entrega', NEW.picker_entrega,
      'changes', jsonb_build_array(
        'Estado WMS cerrado en "Entregado" tras confirmarse retiro del pedido en sucursal.'
      )
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_store_pickup_to_entregado ON public.store_pickups;
CREATE TRIGGER trg_auto_store_pickup_to_entregado
  AFTER INSERT OR UPDATE OF estado_pedido ON public.store_pickups
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_store_pickup_to_entregado_func();

-- 8.4 Automatización en reverse_logistics: Recepción Procesada -> Reingreso Stock idempotente + Orden LI a "Entregado"
CREATE OR REPLACE FUNCTION public.handle_reverse_logistics_to_entregado_func()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_st TEXT := LOWER(TRIM(COALESCE(NEW.status, NEW.estado, '')));
  v_order public.orders;
  v_target_wh UUID := '973da888-8a63-4790-a08f-919e1af41a93'; -- Matriz Ñuñoa por defecto
  v_elem JSONB;
  v_prod_id UUID;
  v_sku TEXT;
  v_qty INT;
BEGIN
  IF v_st <> 'procesado' OR NEW.wms_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_automation_rule_enabled('auto-reverse-logistics-to-entregado') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = NEW.wms_order_id LIMIT 1;
  IF v_order.id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolver bodega destino si viene especificada
  IF COALESCE(NEW.sucursal, v_order.sucursal_pickeo) IS NOT NULL THEN
    SELECT id INTO v_target_wh
    FROM public.warehouses
    WHERE LOWER(name) LIKE '%' || LOWER(REPLACE(COALESCE(NEW.sucursal, v_order.sucursal_pickeo), 'Sucursal ', '')) || '%'
    LIMIT 1;
    v_target_wh := COALESCE(v_target_wh, '973da888-8a63-4790-a08f-919e1af41a93');
  END IF;

  -- Reingreso idempotente de productos devueltos a inventory (si aún no tienen movement 'in' para este order_id)
  IF NEW.productos IS NOT NULL AND jsonb_typeof(NEW.productos) = 'array' THEN
    FOR v_elem IN SELECT * FROM jsonb_array_elements(NEW.productos) LOOP
      IF COALESCE((v_elem->>'regresar_a_inventario')::boolean, TRUE) IS FALSE THEN
        CONTINUE;
      END IF;

      v_prod_id := NULL;
      IF (v_elem->>'product_id') IS NOT NULL AND (v_elem->>'product_id') ~ '^[0-9a-f-]{36}$' THEN
        v_prod_id := (v_elem->>'product_id')::uuid;
      END IF;
      v_sku := NULLIF(TRIM(COALESCE(v_elem->>'sku', '')), '');
      IF v_prod_id IS NULL AND v_sku IS NOT NULL THEN
        SELECT id INTO v_prod_id
        FROM public.products
        WHERE sku = v_sku
          AND (v_order.comercio IS NULL OR LOWER(TRIM(comercio)) = LOWER(TRIM(v_order.comercio)))
        LIMIT 1;
      END IF;

      v_qty := GREATEST(1, COALESCE((v_elem->>'cantidad')::int, (v_elem->>'quantity')::int, 1));

      IF v_prod_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.movements WHERE order_id = v_order.id AND product_id = v_prod_id AND type = 'in'
      ) THEN
        IF EXISTS (SELECT 1 FROM public.inventory WHERE product_id = v_prod_id AND warehouse_id = v_target_wh) THEN
          UPDATE public.inventory
          SET quantity = COALESCE(quantity, 0) + v_qty
          WHERE product_id = v_prod_id AND warehouse_id = v_target_wh;
        ELSE
          INSERT INTO public.inventory (product_id, warehouse_id, quantity)
          VALUES (v_prod_id, v_target_wh, v_qty);
        END IF;

        INSERT INTO public.movements (product_id, warehouse_id, type, quantity, date, order_id, reference_doc)
        VALUES (
          v_prod_id,
          v_target_wh,
          'in',
          v_qty,
          NOW(),
          v_order.id,
          COALESCE(NEW.tipo_movimiento, 'Devolución') || ' [Ped: ' || COALESCE(NEW.referencia_pedido, v_order.external_order_number, 'N/A') || ']'
        );
      END IF;
    END LOOP;
  END IF;

  IF COALESCE(v_order.estado_wms, '') NOT IN ('Entregado', 'Cancelado', 'Archivado') THEN
    PERFORM set_config('app.physical_carrier_transition', 'true', true);

    UPDATE public.orders
    SET
      estado_wms = 'Entregado',
      status = 'entregado',
      stock_descontado = TRUE,
      stock_descontado_at = COALESCE(stock_descontado_at, NOW()),
      transport_status_normalized = 'ENTREGADO',
      delivered_at = COALESCE(delivered_at, NOW()),
      closed_at = NOW(),
      closed_by_automation = 'auto-reverse-logistics-to-entregado'
    WHERE id = v_order.id;

    PERFORM public.log_automation_execution(
      'auto-reverse-logistics-to-entregado',
      v_order.id,
      v_order.external_order_number,
      v_order.comercio,
      COALESCE(v_order.estado_wms, 'En procesamiento'),
      'Entregado',
      'reverse_logistics',
      'Logística Inversa recepcionada y procesada en bodega',
      FALSE
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_reverse_logistics_to_entregado ON public.reverse_logistics;
CREATE TRIGGER trg_auto_reverse_logistics_to_entregado
  AFTER INSERT OR UPDATE ON public.reverse_logistics
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_reverse_logistics_to_entregado_func();

-- =========================================================================================
-- 9. ACTUALIZAR TRIGGER SHOPIFY FULFILLMENT (soporte para salto directo a 'Entregado')
-- =========================================================================================
CREATE OR REPLACE FUNCTION public.enqueue_shopify_fulfillment_trigger_func()
RETURNS trigger
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
    v_is_preparing BOOLEAN;
    v_is_picked BOOLEAN;
    v_was_picked BOOLEAN;
    v_is_pickup BOOLEAN;
BEGIN
    IF NEW.external_platform IS NULL OR UPPER(NEW.external_platform) != 'SHOPIFY' THEN
        RETURN NEW;
    END IF;

    -- Evitar encolar notificaciones masivas en Shopify durante backfill histórico de pedidos antiguos
    IF COALESCE(NEW.closed_by_automation, '') LIKE 'backfill:%'
       AND COALESCE(NEW.created_at, NOW()) < NOW() - INTERVAL '7 days' THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF (OLD.estado_wms IS NOT DISTINCT FROM NEW.estado_wms)
           AND (OLD.status IS NOT DISTINCT FROM NEW.status)
           AND (OLD.lightdata_status IS NOT DISTINCT FROM NEW.lightdata_status)
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

    v_is_delivered := (LOWER(TRIM(COALESCE(NEW.status, ''))) IN ('entregado', 'delivered'))
                      OR (LOWER(TRIM(COALESCE(NEW.estado_wms, ''))) = 'entregado')
                      OR (LOWER(COALESCE(NEW.lightdata_status, '')) LIKE '%entregad%')
                      OR (LOWER(COALESCE(NEW.lightdata_status, '')) LIKE '%delivered%')
                      OR (LOWER(COALESCE(NEW.estado_ruta_optiroute, '')) LIKE '%entregad%')
                      OR (LOWER(COALESCE(NEW.estado_ruta_optiroute, '')) LIKE '%deliver%');
    v_was_delivered := CASE WHEN TG_OP = 'UPDATE' THEN
        (LOWER(TRIM(COALESCE(OLD.status, ''))) IN ('entregado', 'delivered'))
        OR (LOWER(TRIM(COALESCE(OLD.estado_wms, ''))) = 'entregado')
        OR (LOWER(COALESCE(OLD.lightdata_status, '')) LIKE '%entregad%')
        OR (LOWER(COALESCE(OLD.lightdata_status, '')) LIKE '%delivered%')
        OR (LOWER(COALESCE(OLD.estado_ruta_optiroute, '')) LIKE '%entregad%')
        OR (LOWER(COALESCE(OLD.estado_ruta_optiroute, '')) LIKE '%deliver%')
    ELSE false END;

    v_is_in_transit := (LOWER(TRIM(COALESCE(NEW.status, ''))) IN ('en tránsito', 'en transito', 'in_transit', 'en reparto'))
                       OR (LOWER(COALESCE(NEW.lightdata_status, '')) ~ '(camino|planta|recepcionado|clasificado|reparto|tránsito|transito|ruta)')
                       OR (LOWER(COALESCE(NEW.estado_ruta_optiroute, '')) ~ '(route|ruta|camino|onroute|ongoing|arrived)');
    v_was_in_transit := CASE WHEN TG_OP = 'UPDATE' THEN
        (LOWER(TRIM(COALESCE(OLD.status, ''))) IN ('en tránsito', 'en transito', 'in_transit', 'en reparto'))
        OR (LOWER(COALESCE(OLD.lightdata_status, '')) ~ '(camino|planta|recepcionado|clasificado|reparto|tránsito|transito|ruta)')
        OR (LOWER(COALESCE(OLD.estado_ruta_optiroute, '')) ~ '(route|ruta|camino|onroute|ongoing|arrived)')
    ELSE false END;

    -- Incluye 'entregado' y 'retirado' para que si un Retiro o Same-Day salta directo de Pickeado -> Entregado, cree igualmente el fulfillment en Shopify
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

    v_is_preparing := (LOWER(TRIM(COALESCE(NEW.estado_wms, ''))) = 'en preparación');
    v_is_picked := (LOWER(TRIM(COALESCE(NEW.estado_wms, ''))) = 'pickeado') OR (LOWER(TRIM(COALESCE(NEW.status, ''))) = 'listo para retiro');
    v_was_picked := CASE WHEN TG_OP = 'UPDATE' THEN
        (LOWER(TRIM(COALESCE(OLD.estado_wms, ''))) = 'pickeado') OR (LOWER(TRIM(COALESCE(OLD.status, ''))) = 'listo para retiro')
    ELSE false END;

    -- Si es un pedido de distribución que aún no tiene shopify_fulfillment_id y salta a Entregado, primero asegurar create_fulfillment
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

    -- CASO B2: Retiro Pickeado -> set_ready_for_pickup
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
       AND (TG_OP = 'INSERT' OR LOWER(COALESCE(OLD.estado_wms, '')) NOT IN ('en preparación', 'pickeado', 'despachado', 'entregado')) THEN
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
-- 10. RPC DE REAPERTURA AUDITADA EXCLUSIVA PARA SUPER-ADMIN (reopen_delivered_order)
--     Y RPC DE CONCILIACIÓN MANUAL DESDE EL CENTRO DE AUTOMATIZACIONES
-- =========================================================================================
CREATE OR REPLACE FUNCTION public.reopen_delivered_order(
  p_order_id UUID,
  p_target_wms_status TEXT DEFAULT 'Despachado',
  p_reason TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_user_email TEXT;
  v_target_status TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permiso denegado: Solo un Administrador puede reabrir un pedido en estado Entregado.';
  END IF;

  IF LENGTH(TRIM(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Debe ingresar un motivo de auditoría válido (mínimo 5 caracteres) para reabrir un pedido cerrado.';
  END IF;

  IF p_target_wms_status NOT IN ('Despachado', 'Incidencia', 'Pickeado', 'En procesamiento') THEN
    RAISE EXCEPTION 'Estado destino inválido para reapertura: %', p_target_wms_status;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido no encontrado.';
  END IF;

  IF v_order.estado_wms <> 'Entregado' THEN
    RETURN jsonb_build_object('ok', true, 'message', 'El pedido ya no se encontraba en estado Entregado.');
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = auth.uid();

  v_target_status := CASE
    WHEN p_target_wms_status = 'Despachado' THEN 'despachado'
    WHEN p_target_wms_status = 'Incidencia' THEN 'incidencia'
    WHEN p_target_wms_status = 'Pickeado' THEN 'preparado'
    ELSE 'para procesar'
  END;

  PERFORM set_config('app.allow_admin_reopen', 'true', true);

  UPDATE public.orders
  SET
    estado_wms = p_target_wms_status,
    status = v_target_status,
    closed_at = NULL,
    closed_by_automation = NULL
  WHERE id = p_order_id;

  INSERT INTO public.order_audit_logs (order_id, user_id, user_email, action, details)
  VALUES (
    p_order_id,
    auth.uid(),
    COALESCE(v_user_email, 'Admin'),
    'Reapertura Administrativa de Pedido Entregado',
    jsonb_build_object(
      'previous_wms_status', 'Entregado',
      'new_wms_status', p_target_wms_status,
      'reason', TRIM(p_reason),
      'changes', jsonb_build_array(
        'Pedido reabierto manualmente de "Entregado" a "' || p_target_wms_status || '". Motivo: ' || TRIM(p_reason)
      )
    )
  );

  RETURN jsonb_build_object('ok', true, 'new_wms_status', p_target_wms_status, 'new_status', v_target_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reopen_delivered_order(UUID, TEXT, TEXT) TO authenticated, service_role;

-- RPC para ejecutar conciliación inmediata de envíos en tránsito y entregas desde el Centro de Automatizaciones
CREATE OR REPLACE FUNCTION public.reconcile_wms_transport_automations(p_limit INT DEFAULT 400)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_to_entregado INT := 0;
  v_to_despachado INT := 0;
BEGIN
  PERFORM set_config('app.physical_carrier_transition', 'true', true);

  -- 1. Retiros marcados ENTREGADO / RETIRADO en store_pickups cuyo pedido aún no está en Entregado
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

  -- 2. Envíos en envios_unificados con estado normalizado ENTREGADO o EN TRÁNSITO (usando UNION ALL indexado sin OR cruzado)
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
      m.updated_at,
      (public.classify_shipment_transport_status(m.source_table, m.status, m.raw_data))->>'norm' AS norm_st,
      (public.classify_shipment_transport_status(m.source_table, m.status, m.raw_data))->>'clean_status' AS clean_st
    FROM (
      SELECT o.id, o.external_order_number, o.comercio, o.estado_wms, o.categoria_entrega,
             eu.source_table, eu.courier, eu.tracking, eu.updated_at, eu.status, eu.raw_data
      FROM public.orders o
      JOIN public.envios_unificados eu ON eu.tracking = o.tracking_number
      WHERE COALESCE(o.estado_wms, 'En procesamiento') NOT IN ('Entregado', 'Cancelado', 'Archivado')
        AND o.tracking_number IS NOT NULL AND o.tracking_number <> '' AND UPPER(o.tracking_number) NOT IN ('N/A', 'NO INFORMADO', '-')
      UNION ALL
      SELECT o.id, o.external_order_number, o.comercio, o.estado_wms, o.categoria_entrega,
             eu.source_table, eu.courier, eu.tracking, eu.updated_at, eu.status, eu.raw_data
      FROM public.orders o
      JOIN public.envios_unificados eu ON eu.source_table = 'lightdata_envios' AND eu.source_id = o.tracking_number
      WHERE COALESCE(o.estado_wms, 'En procesamiento') NOT IN ('Entregado', 'Cancelado', 'Archivado')
        AND o.tracking_number IS NOT NULL AND o.tracking_number <> '' AND UPPER(o.tracking_number) NOT IN ('N/A', 'NO INFORMADO', '-')
      UNION ALL
      SELECT o.id, o.external_order_number, o.comercio, o.estado_wms, o.categoria_entrega,
             eu.source_table, eu.courier, eu.tracking, eu.updated_at, eu.status, eu.raw_data
      FROM public.orders o
      JOIN public.envios_unificados eu ON eu.pedido_referencia = o.external_order_number
      WHERE COALESCE(o.estado_wms, 'En procesamiento') NOT IN ('Entregado', 'Cancelado', 'Archivado')
        AND o.external_order_number IS NOT NULL
        AND (eu.empresa_comercio_proveedor IS NULL OR UPPER(TRIM(eu.empresa_comercio_proveedor)) IN ('', 'NO ASIGNADO', 'STOCKA') OR LOWER(TRIM(eu.empresa_comercio_proveedor)) = LOWER(TRIM(COALESCE(o.comercio, ''))))
    ) m
    WHERE UPPER(COALESCE(m.courier, '')) !~ '(RECIBELO|RECÍBELO|WELIVERY|WOODELIVERY|WODELY)'
    ORDER BY m.id,
      CASE WHEN (public.classify_shipment_transport_status(m.source_table, m.status, m.raw_data))->>'norm' = 'ENTREGADO' THEN 3
           WHEN (public.classify_shipment_transport_status(m.source_table, m.status, m.raw_data))->>'norm' = 'EN TRÁNSITO' THEN 2
           ELSE 1 END DESC,
      m.updated_at DESC NULLS LAST
    LIMIT p_limit
  LOOP
    IF v_rec.norm_st = 'ENTREGADO' AND public.is_automation_rule_enabled('auto-dispatch-delivered-to-entregado') THEN
      UPDATE public.orders
      SET estado_wms = 'Entregado',
          status = 'entregado',
          delivered_at = COALESCE(delivered_at, v_rec.updated_at, NOW()),
          closed_at = NOW(),
          closed_by_automation = 'auto-dispatch-delivered-to-entregado'
      WHERE id = v_rec.id;
      v_to_entregado := v_to_entregado + 1;

    ELSIF v_rec.norm_st = 'EN TRÁNSITO'
          AND UPPER(TRIM(COALESCE(v_rec.categoria_entrega, ''))) <> 'RETIRO'
          AND COALESCE(v_rec.estado_wms, 'En procesamiento') IN ('En procesamiento', 'En preparación', 'Pickeado')
          AND public.is_automation_rule_enabled('auto-transport-in-transit-to-despachado') THEN
      UPDATE public.orders
      SET estado_wms = 'Despachado',
          status = 'despachado',
          transport_status_normalized = 'EN TRÁNSITO',
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
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_wms_transport_automations(INT) TO authenticated, service_role;

-- =========================================================================================
-- 11. ACTUALIZAR RPC PÚBLICO get_customer_tracking CON LECTURA O(1) DESDE closed_snapshot
-- =========================================================================================
CREATE OR REPLACE FUNCTION public.build_public_tracking_order_json(o public.orders)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_masked_name TEXT;
  v_masked_email TEXT;
  v_snap JSONB := o.closed_snapshot;
  v_opti RECORD;
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

  -- SHORT-CIRCUIT O(1): Si el pedido está cerrado en 'Entregado' y posee closed_snapshot,
  -- devolver todo directamente desde el snapshot sellado sin consultar ninguna otra tabla ni recalcular.
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
      'delivered_at', COALESCE(v_snap->>'delivered_at', o.delivered_at::text),
      'tracking_history', COALESCE(v_snap->'tracking_history', o.tracking_history, '[]'::jsonb),
      'picking_info', jsonb_build_object(
        'warehouse', COALESCE(v_snap->'picking'->>'warehouse', o.sucursal_pickeo, 'Centro de Distribución Stocka'),
        'status', COALESCE(v_snap->'picking'->>'status', 'Completado'),
        'picked_at', COALESCE(v_snap->'picking'->>'picked_at', o.stock_descontado_at::text),
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
        'proof_image', NULL
      )
    );
  END IF;

  -- Ruta activa para pedidos que siguen en proceso / tránsito
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
      WHEN (o.categoria_entrega = 'RETIRO' OR o.operador ILIKE '%RETIRO%') AND LOWER(COALESCE(o.estado_wms, '')) IN ('pickeado', 'listo para retiro') THEN 'Listo para retiro'
      ELSE COALESCE(o.estado_wms, o.status, 'En Proceso')
    END,
    'estado_wms', COALESCE(o.estado_wms, 'En procesamiento'),
    'is_closed_final', FALSE,
    'tracking_number', COALESCE(
      CASE WHEN COALESCE((o.raw_shopify_data->'wms_forced_tracking'->>'active')::boolean, false) IS TRUE
        THEN NULLIF(TRIM(o.raw_shopify_data->'wms_forced_tracking'->>'tracking_number'), '')
        ELSE NULL END,
      NULLIF(NULLIF(o.tracking_number, 'No informado'), ''),
      (SELECT eu.tracking FROM public.envios_unificados eu WHERE eu.pedido_referencia = o.external_order_number AND eu.tracking IS NOT NULL AND eu.tracking <> 'No informado' AND LOWER(COALESCE(eu.status, '')) NOT LIKE '%cancel%' LIMIT 1),
      o.tracking_number
    ),
    'tracking_url', COALESCE(
      CASE WHEN COALESCE((o.raw_shopify_data->'wms_forced_tracking'->>'active')::boolean, false) IS TRUE
        THEN NULLIF(TRIM(o.raw_shopify_data->'wms_forced_tracking'->>'tracking_url'), '')
        ELSE NULL END,
      o.tracking_url,
      (SELECT eu.tracking_url FROM public.envios_unificados eu WHERE eu.pedido_referencia = o.external_order_number AND eu.tracking_url IS NOT NULL AND eu.tracking_url <> '' AND LOWER(COALESCE(eu.status, '')) NOT LIKE '%cancel%' LIMIT 1)
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
    'delivered_at', COALESCE(o.delivered_at::text, v_opti.opti_completed_at),
    'tracking_history', COALESCE(o.tracking_history, '[]'::jsonb),
    'picking_info', jsonb_build_object(
      'warehouse', COALESCE(o.sucursal_pickeo, 'Centro de Distribución Stocka'),
      'status', COALESCE(
        o.picker_status,
        CASE
          WHEN LOWER(COALESCE(o.estado_wms, '')) IN ('despachado', 'pickeado', 'entregado') THEN 'Completado'
          WHEN LOWER(COALESCE(o.estado_wms, '')) LIKE '%prep%' THEN 'En preparación'
          ELSE 'En proceso'
        END
      ),
      'picked_at', COALESCE(o.picker_last_synced_at::text, o.stock_descontado_at::text),
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
      'reception_name', v_opti.opti_reception_name,
      'proof_image', v_opti.proof_image
    )
  );
END;
$$;

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

    IF v_token_uuid IS NOT NULL THEN
      SELECT COALESCE(jsonb_agg(public.build_public_tracking_order_json(o)), '[]'::jsonb)
      INTO v_results
      FROM public.orders o
      WHERE o.id = v_token_uuid;
      RETURN v_results;
    ELSE
      SELECT COALESCE(jsonb_agg(public.build_public_tracking_order_json(o)), '[]'::jsonb)
      INTO v_results
      FROM public.orders o
      WHERE (o.raw_shopify_data IS NOT NULL AND LOWER(COALESCE(o.raw_shopify_data->>'token', '')) = v_clean_token)
         OR LOWER(TRIM(COALESCE(o.tracking_number, ''))) = v_clean_token
      LIMIT 5;
      RETURN v_results;
    END IF;

  ELSIF v_clean_email <> '' AND v_clean_order <> '' THEN
    v_num_only := regexp_replace(v_clean_order, '[^0-9]', '', 'g');
    SELECT COALESCE(jsonb_agg(public.build_public_tracking_order_json(o) ORDER BY o.created_at DESC), '[]'::jsonb)
    INTO v_results
    FROM (
      SELECT * FROM public.orders o
      WHERE LOWER(TRIM(COALESCE(o.customer_email, ''))) = v_clean_email
        AND (
          LOWER(TRIM(COALESCE(o.external_order_number, ''))) = LOWER(v_clean_order)
          OR LOWER(TRIM(COALESCE(o.external_order_number, ''))) = '#' || LOWER(regexp_replace(v_clean_order, '^#+', ''))
          OR (v_num_only <> '' AND regexp_replace(COALESCE(o.external_order_number, ''), '[^0-9]', '', 'g') = v_num_only)
        )
      ORDER BY o.created_at DESC
      LIMIT 10
    ) o;
    RETURN v_results;

  ELSIF v_clean_courier <> '' THEN
    SELECT COALESCE(jsonb_agg(public.build_public_tracking_order_json(o) ORDER BY o.created_at DESC), '[]'::jsonb)
    INTO v_results
    FROM (
      SELECT * FROM public.orders o
      WHERE LOWER(TRIM(COALESCE(o.tracking_number, ''))) = LOWER(v_clean_courier)
         OR LOWER(TRIM(COALESCE(o.tracking_number, ''))) ILIKE '%' || LOWER(v_clean_courier)
      ORDER BY o.created_at DESC
      LIMIT 10
    ) o;
    RETURN v_results;
  END IF;

  RETURN '[]'::jsonb;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_tracking(text, text, text, text) TO anon, authenticated;

-- Proteger nuevas columnas frente a ediciones directas de rol cliente en RLS
CREATE OR REPLACE FUNCTION public.protect_orders_sensitive_columns_on_client_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  IF current_user = 'authenticated' THEN
    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
    IF COALESCE(v_role, '') NOT IN ('admin', 'operario', 'picker', 'supervisor') AND NOT public.is_admin() THEN
      NEW.comercio := OLD.comercio;
      NEW.external_order_number := OLD.external_order_number;
      NEW.estado_wms := OLD.estado_wms;
      NEW.status := OLD.status;
      NEW.stock_descontado := OLD.stock_descontado;
      NEW.stock_descontado_at := OLD.stock_descontado_at;
      NEW.sucursal_pickeo := OLD.sucursal_pickeo;
      NEW.picker_status := OLD.picker_status;
      NEW.picker_scanned_label := OLD.picker_scanned_label;
      NEW.picker_last_synced_at := OLD.picker_last_synced_at;
      NEW.picker_history_snapshot := OLD.picker_history_snapshot;
      NEW.closed_snapshot := OLD.closed_snapshot;
      NEW.tracking_history := OLD.tracking_history;
      NEW.transport_status_normalized := OLD.transport_status_normalized;
      NEW.dispatched_at := OLD.dispatched_at;
      NEW.delivered_at := OLD.delivered_at;
      NEW.closed_at := OLD.closed_at;
      NEW.closed_by_automation := OLD.closed_by_automation;
      NEW.raw_shopify_data := OLD.raw_shopify_data;
      NEW.raw_lightdata_data := OLD.raw_lightdata_data;
      NEW.tracking_number := OLD.tracking_number;
      NEW.tracking_url := OLD.tracking_url;
      NEW.courier := OLD.courier;
      NEW.operador := OLD.operador;
      NEW.lightdata_status := OLD.lightdata_status;
      NEW.bluex_status := OLD.bluex_status;
      NEW.starken_status := OLD.starken_status;
      NEW.optiroute_status := OLD.optiroute_status;
      NEW.enviame_status := OLD.enviame_status;
      NEW.created_at := OLD.created_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
