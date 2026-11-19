-- ============================================================================
-- WMS STOCKA - Fix persistencia de edición de pedidos por sellers (RLS + Trigger)
-- ============================================================================
-- Causa raíz del incidente MAGMAN26111912105935 (19-11-2026):
--   1) En producción no existían políticas RLS de UPDATE en public.orders ni
--      UPDATE/DELETE en public.order_items para rol 'client', por lo que
--      PostgREST devolvía 204 (0 filas afectadas, error=null) y el editor
--      mostraba "¡Guardado!" y grababa auditoría sin persistir cambios.
--   2) El script legacy supabase_schema_allow_client_edit_en_procesamiento.sql
--      referenciaba columnas inexistentes (external_order_id, warehouse_id) y
--      sobrescribía NEW.raw_shopify_data := OLD.raw_shopify_data, lo que habría
--      borrado wms_items_edited / wms_manual_edits / line_items al editar.
--   3) El rol 'observer' (solo lectura) debe quedar explícitamente excluido de
--      toda política de escritura.
-- ============================================================================

-- 1. Endurecer check_user_commerce para tolerar espacios/NULLs sin romper SELECT
CREATE OR REPLACE FUNCTION public.check_user_commerce(p_comercio text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND (
        LOWER(TRIM(COALESCE(profiles.comercio, ''))) = 'all'
        OR LOWER(TRIM(COALESCE(p_comercio, ''))) = ANY (
          SELECT TRIM(LOWER(token))
          FROM unnest(string_to_array(COALESCE(profiles.comercio, ''), ',')) AS token
        )
      )
  );
END;
$$;

-- 2. Helper seguro para permitir solo las claves de edición de ítems en raw_*_data
--    Preserva intactas claves sensibles (financial_status, cancelled_at, created_from, etc.)
--    y conserva wms_items_edited / wms_custom_edited / wms_manual_edits / line_items
--    para que los syncs (Shopify/Woo/etc.) no sobrescriban cambios del seller.
CREATE OR REPLACE FUNCTION public.merge_client_allowed_order_raw_data(p_old jsonb, p_new jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_base jsonb;
BEGIN
  IF p_new IS NOT DISTINCT FROM p_old THEN
    RETURN p_old;
  END IF;

  IF p_new IS NULL OR jsonb_typeof(p_new) <> 'object' THEN
    RETURN p_old;
  END IF;

  v_base := CASE
    WHEN p_old IS NOT NULL AND jsonb_typeof(p_old) = 'object' THEN p_old
    ELSE '{}'::jsonb
  END;

  IF p_new ? 'line_items' THEN
    v_base := jsonb_set(v_base, '{line_items}', p_new->'line_items', true);
  END IF;

  IF p_new ? 'wms_items_edited' THEN
    v_base := jsonb_set(v_base, '{wms_items_edited}', p_new->'wms_items_edited', true);
  END IF;

  IF p_new ? 'wms_custom_edited' THEN
    v_base := jsonb_set(v_base, '{wms_custom_edited}', p_new->'wms_custom_edited', true);
  END IF;

  IF p_new ? 'wms_manual_edits' THEN
    v_base := jsonb_set(v_base, '{wms_manual_edits}', p_new->'wms_manual_edits', true);
  END IF;

  -- Permitir guardar el snapshot original una sola vez si todavía no existía
  IF (NOT (v_base ? 'shopify_original_line_items')) AND (p_new ? 'shopify_original_line_items') THEN
    v_base := jsonb_set(v_base, '{shopify_original_line_items}', p_new->'shopify_original_line_items', true);
  END IF;

  RETURN v_base;
END;
$$;

-- 3. Trigger BEFORE UPDATE en public.orders (solo columnas reales + merge seguro de raw_*_data)
CREATE OR REPLACE FUNCTION public.protect_orders_sensitive_columns_on_client_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  -- Nota: dentro de SECURITY DEFINER, current_user es el owner ('postgres'), NO 'authenticated'.
  -- Por eso se debe validar con auth.role() y auth.uid() (PostgREST fija request.jwt.claims).
  IF COALESCE(auth.role(), '') = 'authenticated' AND auth.uid() IS NOT NULL THEN
    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();

    IF COALESCE(v_role, '') NOT IN ('admin', 'operario', 'picker', 'supervisor') AND NOT public.is_admin() THEN
      -- Columnas de identidad, comercio y origen
      NEW.merchant_id := OLD.merchant_id;
      NEW.comercio := OLD.comercio;
      NEW.created_at := OLD.created_at;
      NEW.external_order_number := OLD.external_order_number;
      NEW.external_platform := OLD.external_platform;
      NEW.origen := OLD.origen;

      -- Estados operativos, pago y facturación
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

      -- Etiquetas, tracking y transportistas
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
      NEW.bluex_status := OLD.bluex_status;
      NEW.raw_bluex_data := OLD.raw_bluex_data;
      NEW.starken_status := OLD.starken_status;
      NEW.raw_starken_data := OLD.raw_starken_data;

      -- Picker, Shopify fulfillment, splits, consolidación y snapshots de cierre
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

      -- En payloads raw_*_data de canales, permitir únicamente claves seguras de edición de ítems
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

-- Nombrar con prefijo aa_00_ para que corra ANTES de aa_enforce_delivered_* y on_order_stock_change
DROP TRIGGER IF EXISTS trg_protect_orders_sensitive_columns ON public.orders;
DROP TRIGGER IF EXISTS aa_00_protect_orders_sensitive_columns ON public.orders;
CREATE TRIGGER aa_00_protect_orders_sensitive_columns
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_orders_sensitive_columns_on_client_update();

-- 4. Política RLS: clientes (no observers) pueden actualizar sus pedidos en 'En procesamiento'
DROP POLICY IF EXISTS "Clientes pueden editar sus pedidos en procesamiento" ON public.orders;
CREATE POLICY "Clientes pueden editar sus pedidos en procesamiento" ON public.orders
  FOR UPDATE
  TO authenticated
  USING (
    LOWER(TRIM(COALESCE(estado_wms, 'en procesamiento'))) = 'en procesamiento'
    AND LOWER(TRIM(COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid()), ''))) <> 'observer'
    AND (
      public.check_user_commerce(comercio)
      OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'operario', 'supervisor')
    )
  )
  WITH CHECK (
    LOWER(TRIM(COALESCE(estado_wms, 'en procesamiento'))) = 'en procesamiento'
    AND LOWER(TRIM(COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid()), ''))) <> 'observer'
    AND (
      public.check_user_commerce(comercio)
      OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'operario', 'supervisor')
    )
  );

-- 5. Política RLS: clientes (no observers) pueden insertar/actualizar/eliminar ítems
--    de sus pedidos en 'En procesamiento', validando que el producto pertenezca al mismo comercio
DROP POLICY IF EXISTS "Clientes pueden modificar items de pedidos en procesamiento" ON public.order_items;
CREATE POLICY "Clientes pueden modificar items de pedidos en procesamiento" ON public.order_items
  FOR ALL
  TO authenticated
  USING (
    LOWER(TRIM(COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid()), ''))) <> 'observer'
    AND EXISTS (
      SELECT 1
      FROM public.orders
      WHERE orders.id = order_items.order_id
        AND LOWER(TRIM(COALESCE(orders.estado_wms, 'en procesamiento'))) = 'en procesamiento'
        AND (
          public.check_user_commerce(orders.comercio)
          OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'operario', 'supervisor')
        )
    )
  )
  WITH CHECK (
    LOWER(TRIM(COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid()), ''))) <> 'observer'
    AND EXISTS (
      SELECT 1
      FROM public.orders
      WHERE orders.id = order_items.order_id
        AND LOWER(TRIM(COALESCE(orders.estado_wms, 'en procesamiento'))) = 'en procesamiento'
        AND (
          public.check_user_commerce(orders.comercio)
          OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'operario', 'supervisor')
        )
        AND (
          order_items.product_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.products p
            WHERE p.id = order_items.product_id
              AND (
                (
                  public.check_user_commerce(p.comercio)
                  AND LOWER(TRIM(COALESCE(p.comercio, ''))) = LOWER(TRIM(COALESCE(orders.comercio, '')))
                )
                OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'operario', 'supervisor')
              )
          )
        )
    )
  );

-- 5b. Endurecer también política legacy de INSERT en order_items para evitar bypass cross-commerce u observer
DROP POLICY IF EXISTS "Clientes pueden insertar items en sus pedidos" ON public.order_items;
CREATE POLICY "Clientes pueden insertar items en sus pedidos" ON public.order_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    LOWER(TRIM(COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid()), ''))) <> 'observer'
    AND EXISTS (
      SELECT 1
      FROM public.orders
      WHERE orders.id = order_items.order_id
        AND orders.merchant_id = auth.uid()
        AND (
          order_items.product_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.products p
            WHERE p.id = order_items.product_id
              AND public.check_user_commerce(p.comercio)
              AND LOWER(TRIM(COALESCE(p.comercio, ''))) = LOWER(TRIM(COALESCE(orders.comercio, '')))
          )
        )
    )
  );

NOTIFY pgrst, 'reload schema';
