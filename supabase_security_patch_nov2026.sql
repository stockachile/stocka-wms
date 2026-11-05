-- ==============================================================================
-- WMS STOCKA - PARCHE CONSOLIDADO DE SEGURIDAD (AUDITORÍA NOVIEMBRE 2026)
-- ==============================================================================
-- Cubre remediaciones de Base de Datos, RLS, Triggers y RPCs SECURITY DEFINER:
--   - VULN-19: Restricción de change_orders_stock_warehouse a Administradores / service_role.
--   - VULN-21: Protección de columnas sensibles en orders y billing_records (BEFORE UPDATE)
--              + validación de comercio de product_id en order_items.
--   - VULN-23: Blindaje de clean_old_receipts, check_overdue_payments,
--              preview_campaign_retroactive y apply_campaign_retroactively.
--   - VULN-24: Blindaje del Portal Público de Tracking (get_customer_tracking):
--              eliminación de consulta solo por email, sanitización de comodines SQL ('%', '_')
--              y enmascaramiento de apellidos desde SQL.
--   - VULN-25: Cierre de políticas RLS permisivas en optiroute_route_records,
--              product_locations y order_picking_requests.
--   - VULN-27: Eliminación de política SELECT anónima sobre el bucket payment_receipts
--              y revocación de permisos anon sobre tablas de facturación.
--
-- Instrucciones:
--   Copia y ejecuta este script completo en el SQL Editor de Supabase:
--   https://supabase.com/dashboard/project/ejtjfaucnxbikrwjwwdu/sql/new
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- 1. VULN-19: Blindaje de RPC change_orders_stock_warehouse
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.change_orders_stock_warehouse(
  p_order_ids UUID[],
  p_target_warehouse_id UUID,
  p_sync_sucursal BOOLEAN DEFAULT false
)
RETURNS JSONB AS $$
DECLARE
  v_order_id UUID;
  v_target_wh UUID;
  v_old_wh UUID;
  v_sucursal_pickeo TEXT;
  v_estado_wms TEXT;
  v_stock_descontado BOOLEAN;
  v_item RECORD;
  v_target_sucursal_name TEXT;
  v_updated_orders_count INT := 0;
  v_updated_items_count INT := 0;
  v_adjusted_physical_count INT := 0;
  v_kardex_updated_count INT := 0;
BEGIN
  -- 0. Validar que solo Administradores o service_role puedan ejecutar este RPC (VULN-19)
  IF NOT public.is_admin()
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Acceso denegado: Se requieren privilegios de administrador para cambiar bodegas de stock.';
  END IF;

  IF p_target_warehouse_id IS NOT NULL THEN
    IF p_target_warehouse_id = '973da888-8a63-4790-a08f-919e1af41a93' THEN
      v_target_sucursal_name := 'Sucursal Ñuñoa';
    ELSIF p_target_warehouse_id = '414605cb-f926-43d2-8bd2-d9509f7b458a' THEN
      v_target_sucursal_name := 'Sucursal La Reina';
    ELSIF p_target_warehouse_id = '1e3395fc-bc24-48e5-8c3c-04e8a0f7c32a' THEN
      v_target_sucursal_name := 'Sucursal Recoleta';
    ELSIF p_target_warehouse_id = 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09' THEN
      v_target_sucursal_name := 'Sucursal Virtual (Hub)';
    END IF;
  END IF;

  FOREACH v_order_id IN ARRAY p_order_ids LOOP
    SELECT sucursal_pickeo, estado_wms, COALESCE(stock_descontado, false)
    INTO v_sucursal_pickeo, v_estado_wms, v_stock_descontado
    FROM public.orders
    WHERE id = v_order_id;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF p_target_warehouse_id IS NULL THEN
      IF LOWER(COALESCE(v_sucursal_pickeo, '')) LIKE '%ñuñoa%' THEN
        v_target_wh := '973da888-8a63-4790-a08f-919e1af41a93';
      ELSIF LOWER(COALESCE(v_sucursal_pickeo, '')) LIKE '%la reina%' THEN
        v_target_wh := '414605cb-f926-43d2-8bd2-d9509f7b458a';
      ELSIF LOWER(COALESCE(v_sucursal_pickeo, '')) LIKE '%recoleta%' THEN
        v_target_wh := '1e3395fc-bc24-48e5-8c3c-04e8a0f7c32a';
      ELSE
        v_target_wh := 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09';
      END IF;
    ELSE
      v_target_wh := p_target_warehouse_id;
    END IF;

    IF p_sync_sucursal AND v_target_sucursal_name IS NOT NULL THEN
      UPDATE public.orders
      SET sucursal_pickeo = v_target_sucursal_name
      WHERE id = v_order_id AND (sucursal_pickeo IS DISTINCT FROM v_target_sucursal_name);
    END IF;

    FOR v_item IN 
      SELECT oi.id, oi.product_id, oi.warehouse_id, oi.quantity, COALESCE(p.is_virtual, false) as is_virtual
      FROM public.order_items oi
      LEFT JOIN public.products p ON p.id = oi.product_id
      WHERE oi.order_id = v_order_id
    LOOP
      v_old_wh := v_item.warehouse_id;

      IF v_old_wh IS NOT DISTINCT FROM v_target_wh THEN
        CONTINUE;
      END IF;

      UPDATE public.order_items
      SET warehouse_id = v_target_wh
      WHERE id = v_item.id;
      
      v_updated_items_count := v_updated_items_count + 1;

      IF v_item.is_virtual OR v_item.product_id IS NULL THEN
        CONTINUE;
      END IF;

      IF v_estado_wms = 'Despachado' OR v_stock_descontado = true THEN
        IF v_old_wh IS NOT NULL THEN
          UPDATE public.inventory
          SET quantity = quantity + v_item.quantity
          WHERE product_id = v_item.product_id AND warehouse_id = v_old_wh;
        END IF;

        INSERT INTO public.inventory (product_id, warehouse_id, quantity, committed_quantity, reserved_quantity)
        VALUES (v_item.product_id, v_target_wh, 0, 0, 0)
        ON CONFLICT (product_id, warehouse_id) DO NOTHING;

        UPDATE public.inventory
        SET quantity = GREATEST(0, quantity - v_item.quantity)
        WHERE product_id = v_item.product_id AND warehouse_id = v_target_wh;

        v_adjusted_physical_count := v_adjusted_physical_count + 1;

        UPDATE public.movements
        SET warehouse_id = v_target_wh
        WHERE order_id = v_order_id 
          AND product_id = v_item.product_id 
          AND type = 'out';

        IF FOUND THEN
          v_kardex_updated_count := v_kardex_updated_count + 1;
        END IF;

      ELSIF v_estado_wms IN ('En preparación', 'Pickeado') THEN
        IF v_old_wh IS NOT NULL THEN
          UPDATE public.inventory
          SET reserved_quantity = GREATEST(0, reserved_quantity - v_item.quantity)
          WHERE product_id = v_item.product_id AND warehouse_id = v_old_wh;
        END IF;

        INSERT INTO public.inventory (product_id, warehouse_id, quantity, committed_quantity, reserved_quantity)
        VALUES (v_item.product_id, v_target_wh, 0, 0, 0)
        ON CONFLICT (product_id, warehouse_id) DO NOTHING;

        UPDATE public.inventory
        SET reserved_quantity = reserved_quantity + v_item.quantity
        WHERE product_id = v_item.product_id AND warehouse_id = v_target_wh;

      ELSIF COALESCE(v_estado_wms, 'En procesamiento') = 'En procesamiento' THEN
        IF v_old_wh IS NOT NULL THEN
          UPDATE public.inventory
          SET committed_quantity = GREATEST(0, committed_quantity - v_item.quantity)
          WHERE product_id = v_item.product_id AND warehouse_id = v_old_wh;
        END IF;

        INSERT INTO public.inventory (product_id, warehouse_id, quantity, committed_quantity, reserved_quantity)
        VALUES (v_item.product_id, v_target_wh, 0, 0, 0)
        ON CONFLICT (product_id, warehouse_id) DO NOTHING;

        UPDATE public.inventory
        SET committed_quantity = committed_quantity + v_item.quantity
        WHERE product_id = v_item.product_id AND warehouse_id = v_target_wh;
      END IF;

    END LOOP;

    v_updated_orders_count := v_updated_orders_count + 1;
  END LOOP;

  PERFORM public.recalculate_committed_stock();

  RETURN jsonb_build_object(
    'success', true,
    'orders_count', v_updated_orders_count,
    'items_count', v_updated_items_count,
    'physical_adjustments', v_adjusted_physical_count,
    'kardex_movements_updated', v_kardex_updated_count
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.change_orders_stock_warehouse(UUID[], UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_orders_stock_warehouse(UUID[], UUID, BOOLEAN) TO authenticated, service_role;


-- ==============================================================================
-- 2. VULN-21: Protección de Columnas Sensibles en orders, order_items y billing_records
-- ==============================================================================

-- 2.1 Política de order_items con validación estricta de que el producto pertenece al mismo comercio del pedido
DROP POLICY IF EXISTS "Clientes pueden modificar items de pedidos en procesamiento" ON public.order_items;
CREATE POLICY "Clientes pueden modificar items de pedidos en procesamiento" ON public.order_items
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE orders.id = order_items.order_id
        AND LOWER(TRIM(orders.estado_wms)) = 'en procesamiento'
        AND (
          public.check_user_commerce(orders.comercio)
          OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'operario', 'supervisor')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE orders.id = order_items.order_id
        AND LOWER(TRIM(orders.estado_wms)) = 'en procesamiento'
        AND (
          public.check_user_commerce(orders.comercio)
          OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'operario', 'supervisor')
        )
        AND (
          order_items.product_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = order_items.product_id
              AND (
                (public.check_user_commerce(p.comercio) AND LOWER(TRIM(COALESCE(p.comercio, ''))) = LOWER(TRIM(COALESCE(orders.comercio, ''))))
                OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'operario', 'supervisor')
              )
          )
        )
    )
  );

-- 2.2 Trigger BEFORE UPDATE en public.orders para impedir manipulación de columnas operativas/financieras por clientes
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
      NEW.external_order_id := OLD.external_order_id;
      NEW.external_order_number := OLD.external_order_number;
      NEW.estado_wms := OLD.estado_wms;
      NEW.status := OLD.status;
      NEW.stock_descontado := OLD.stock_descontado;
      NEW.stock_descontado_at := OLD.stock_descontado_at;
      NEW.sucursal_pickeo := OLD.sucursal_pickeo;
      NEW.warehouse_id := OLD.warehouse_id;
      NEW.picker_status := OLD.picker_status;
      NEW.picker_scanned_label := OLD.picker_scanned_label;
      NEW.picker_last_synced_at := OLD.picker_last_synced_at;
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

DROP TRIGGER IF EXISTS trg_protect_orders_sensitive_columns ON public.orders;
CREATE TRIGGER trg_protect_orders_sensitive_columns
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_orders_sensitive_columns_on_client_update();

-- 2.3 Trigger BEFORE UPDATE en public.billing_records para impedir que clientes alteren montos, estados de pago o facturas
CREATE OR REPLACE FUNCTION public.tr_fn_billing_record_before_update()
RETURNS TRIGGER AS $$
BEGIN
    IF current_user = 'authenticated' AND NOT public.is_admin() THEN
        NEW.period_id := OLD.period_id;
        NEW.comercio := OLD.comercio;
        NEW.fecha_limite := OLD.fecha_limite;
        NEW.fecha_limite_enviame := OLD.fecha_limite_enviame;
        NEW.desglose_fulfillment := OLD.desglose_fulfillment;
        NEW.total_fulfillment := OLD.total_fulfillment;
        NEW.abono_fulfillment := OLD.abono_fulfillment;
        NEW.pago_fulfillment := OLD.pago_fulfillment;
        NEW.factura_fulfillment := OLD.factura_fulfillment;
        NEW.num_factura := OLD.num_factura;
        NEW.enviame := OLD.enviame;
        NEW.abono_enviame := OLD.abono_enviame;
        NEW.pago_enviame := OLD.pago_enviame;
        NEW.factura_enviame := OLD.factura_enviame;
        NEW.num_factura_enviame := OLD.num_factura_enviame;
        NEW.fecha_pago_recibido_fulfillment := OLD.fecha_pago_recibido_fulfillment;
        NEW.fecha_pago_recibido_enviame := OLD.fecha_pago_recibido_enviame;
        NEW.fulfillment_link := OLD.fulfillment_link;
        NEW.fulfillment_pdf_url := OLD.fulfillment_pdf_url;
        NEW.enviame_pdfs := OLD.enviame_pdfs;
        NEW.admin_response := OLD.admin_response;
        NEW.admin_response_enviame := OLD.admin_response_enviame;
        RETURN NEW;
    END IF;

    IF (NEW.desglose_fulfillment = 'Aprobado' AND OLD.desglose_fulfillment IS DISTINCT FROM 'Aprobado') THEN
        IF (NEW.pago_fulfillment IS DISTINCT FROM 'Recibido') THEN
            NEW.pago_fulfillment := 'aprobado';
        END IF;
        NEW.abono_fulfillment := NEW.total_fulfillment;
    END IF;

    IF (NEW.pago_fulfillment IN ('Recibido', 'aprobado') AND OLD.pago_fulfillment IS DISTINCT FROM NEW.pago_fulfillment) THEN
        NEW.abono_fulfillment := NEW.total_fulfillment;
    END IF;
    
    IF (NEW.pago_enviame IN ('Recibido', 'aprobado') AND OLD.pago_enviame IS DISTINCT FROM NEW.pago_enviame) THEN
        NEW.abono_enviame := NEW.enviame;
    END IF;

    IF (NEW.pago_fulfillment NOT IN ('Recibido', 'aprobado') AND OLD.pago_fulfillment IN ('Recibido', 'aprobado') AND NEW.abono_fulfillment = NEW.total_fulfillment) THEN
        NEW.abono_fulfillment := 0;
    END IF;
    IF (NEW.pago_enviame NOT IN ('Recibido', 'aprobado') AND OLD.pago_enviame IN ('Recibido', 'aprobado') AND NEW.abono_enviame = NEW.enviame) THEN
        NEW.abono_enviame := 0;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_billing_record_before_update ON public.billing_records;
CREATE TRIGGER tr_billing_record_before_update
    BEFORE UPDATE ON public.billing_records
    FOR EACH ROW
    EXECUTE FUNCTION public.tr_fn_billing_record_before_update();


-- ==============================================================================
-- 3. VULN-23 & VULN-27: Blindaje de RPCs de Facturación, Campañas y Storage
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.clean_old_receipts()
RETURNS void AS $$
BEGIN
    IF NOT public.is_admin()
       AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
       AND current_user NOT IN ('postgres', 'service_role') THEN
        RAISE EXCEPTION 'Acceso denegado: Se requieren privilegios de administrador.';
    END IF;

    DELETE FROM storage.objects
    WHERE bucket_id = 'payment_receipts'
      AND created_at < (NOW() - INTERVAL '7 days');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.check_overdue_payments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_overdue_payments() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.clean_old_receipts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clean_old_receipts() TO authenticated, service_role;

-- Revocar permisos de anon sobre tablas de facturación y comprobantes
REVOKE ALL ON public.billing_mappings, public.commerce_billing_status, public.billing_periods, public.billing_records, public.payment_reports FROM anon;

-- Restringir SELECT en bucket payment_receipts a usuarios autenticados (VULN-27)
DROP POLICY IF EXISTS "Permitir ver comprobantes a cualquiera" ON storage.objects;
DROP POLICY IF EXISTS "Permitir ver comprobantes a usuarios autenticados" ON storage.objects;
CREATE POLICY "Permitir ver comprobantes a usuarios autenticados" ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'payment_receipts');

-- Blindar preview_campaign_retroactive y apply_campaign_retroactively (VULN-23)
CREATE OR REPLACE FUNCTION public.preview_campaign_retroactive(
  p_campaign_id UUID,
  p_target_statuses TEXT[] DEFAULT ARRAY['para procesar', 'en preparación'],
  p_gift_quantity_mode VARCHAR DEFAULT NULL,
  p_gift_quantity INTEGER DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_campaign RECORD;
  v_gift_product RECORD;
  v_order RECORD;
  v_eligible_orders JSONB := '[]'::jsonb;
  v_order_count INTEGER := 0;
  v_total_units_required INTEGER := 0;
  v_order_gift_qty INTEGER := 0;
  v_available_stock INTEGER := 0;
  v_excluded_statuses TEXT[] := ARRAY['despachado', 'cancelado', 'entregado', 'retirado'];
  v_excluded_wms TEXT[] := ARRAY['Despachado', 'Cancelado', 'Archivado'];
  v_has_label BOOLEAN;
  v_already_applied BOOLEAN;
  v_clean_targets TEXT[];
BEGIN
  SELECT * INTO v_campaign FROM public.campaigns WHERE id = p_campaign_id;
  IF v_campaign.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Campaña no encontrada');
  END IF;

  IF NOT public.check_user_commerce(v_campaign.comercio)
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND current_user NOT IN ('postgres', 'service_role') THEN
    RETURN jsonb_build_object('error', 'Acceso denegado: No tienes permisos sobre el comercio de esta campaña');
  END IF;

  SELECT * INTO v_gift_product 
  FROM public.products 
  WHERE LOWER(TRIM(sku)) = LOWER(TRIM(v_campaign.gift_sku))
    AND LOWER(TRIM(comercio)) = LOWER(TRIM(v_campaign.comercio))
  LIMIT 1;

  IF v_gift_product.id IS NULL THEN
    RETURN jsonb_build_object('error', 'El SKU de regalo no existe en los productos del comercio');
  END IF;

  SELECT COALESCE(SUM(quantity - committed_quantity), 0) INTO v_available_stock
  FROM public.inventory
  WHERE product_id = v_gift_product.id;

  IF p_target_statuses IS NULL OR cardinality(p_target_statuses) = 0 THEN
    v_clean_targets := ARRAY['para procesar', 'en preparación'];
  ELSE
    SELECT array_agg(LOWER(TRIM(s))) INTO v_clean_targets FROM unnest(p_target_statuses) s;
  END IF;

  FOR v_order IN
    SELECT o.id, o.external_order_number, o.created_at, o.status, o.estado_wms, o.tracking_number, o.label_base64
    FROM public.orders o
    WHERE LOWER(TRIM(o.comercio)) = LOWER(TRIM(v_campaign.comercio))
      AND (
        LOWER(TRIM(COALESCE(o.status, ''))) = ANY(v_clean_targets)
        OR LOWER(TRIM(COALESCE(o.estado_wms, ''))) = ANY(v_clean_targets)
      )
      AND NOT (LOWER(TRIM(COALESCE(o.status, ''))) = ANY(v_excluded_statuses))
      AND NOT (COALESCE(o.estado_wms, '') = ANY(v_excluded_wms))
      AND (v_campaign.start_date IS NULL OR o.created_at >= v_campaign.start_date)
      AND (v_campaign.end_date IS NULL OR o.created_at <= v_campaign.end_date)
    ORDER BY o.created_at DESC
  LOOP
    v_has_label := (v_order.tracking_number IS NOT NULL AND TRIM(v_order.tracking_number) != '')
                   OR (v_order.label_base64 IS NOT NULL AND TRIM(v_order.label_base64) != '');
    IF v_has_label THEN
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.order_items
      WHERE order_id = v_order.id
        AND campaign_id = v_campaign.id
    ) INTO v_already_applied;

    IF v_already_applied THEN
      CONTINUE;
    END IF;

    IF public.order_matches_campaign_conditions(v_order.id, v_campaign.id) THEN
      v_order_gift_qty := public.calculate_campaign_gift_quantity(v_order.id, v_campaign.id, p_gift_quantity_mode, p_gift_quantity);
      IF v_order_gift_qty > 0 THEN
        v_order_count := v_order_count + 1;
        v_total_units_required := v_total_units_required + v_order_gift_qty;
        IF v_order_count <= 50 THEN
          v_eligible_orders := v_eligible_orders || jsonb_build_object(
            'id', v_order.id,
            'order_number', COALESCE(v_order.external_order_number, v_order.id::text),
            'created_at', v_order.created_at,
            'status', COALESCE(v_order.estado_wms, v_order.status),
            'gift_quantity', v_order_gift_qty
          );
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'campaign_id', v_campaign.id,
    'campaign_name', v_campaign.name,
    'gift_sku', v_campaign.gift_sku,
    'gift_quantity', COALESCE(p_gift_quantity, v_campaign.gift_quantity),
    'gift_quantity_mode', COALESCE(p_gift_quantity_mode, v_campaign.gift_quantity_mode, 'fixed'),
    'eligible_orders_count', v_order_count,
    'total_units_required', v_total_units_required,
    'available_stock', v_available_stock,
    'sufficient_stock', (v_available_stock >= v_total_units_required),
    'sample_orders', v_eligible_orders
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.apply_campaign_retroactively(
  p_campaign_id UUID,
  p_target_statuses TEXT[] DEFAULT ARRAY['para procesar', 'en preparación'],
  p_merge_existing BOOLEAN DEFAULT TRUE
)
RETURNS JSONB AS $$
DECLARE
  v_campaign RECORD;
  v_gift_product RECORD;
  v_order RECORD;
  v_applied_count INTEGER := 0;
  v_total_units_applied INTEGER := 0;
  v_order_gift_qty INTEGER := 0;
  v_warehouse_id UUID;
  v_default_warehouse_id UUID;
  v_excluded_statuses TEXT[] := ARRAY['despachado', 'cancelado', 'entregado', 'retirado'];
  v_excluded_wms TEXT[] := ARRAY['Despachado', 'Cancelado', 'Archivado'];
  v_clean_targets TEXT[];
  v_has_label BOOLEAN;
  v_already_applied BOOLEAN;
  v_new_cantidad INTEGER;
  v_new_skus TEXT;
  v_new_items TEXT;
  v_dep_item RECORD;
  v_dep_qty INTEGER;
BEGIN
  SELECT * INTO v_campaign FROM public.campaigns WHERE id = p_campaign_id;
  IF v_campaign.id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Campaña no encontrada');
  END IF;

  IF NOT public.check_user_commerce(v_campaign.comercio)
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND current_user NOT IN ('postgres', 'service_role') THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Acceso denegado: No tienes permisos sobre el comercio de esta campaña');
  END IF;

  SELECT * INTO v_gift_product 
  FROM public.products 
  WHERE LOWER(TRIM(sku)) = LOWER(TRIM(v_campaign.gift_sku))
    AND LOWER(TRIM(comercio)) = LOWER(TRIM(v_campaign.comercio))
  LIMIT 1;

  IF v_gift_product.id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'El SKU de regalo no existe en los productos del comercio');
  END IF;

  SELECT id INTO v_default_warehouse_id FROM public.warehouses LIMIT 1;

  IF p_target_statuses IS NULL OR cardinality(p_target_statuses) = 0 THEN
    v_clean_targets := ARRAY['para procesar', 'en preparación'];
  ELSE
    SELECT array_agg(LOWER(TRIM(s))) INTO v_clean_targets FROM unnest(p_target_statuses) s;
  END IF;

  FOR v_order IN
    SELECT o.id, o.external_order_number, o.created_at, o.status, o.estado_wms, o.tracking_number, o.label_base64
    FROM public.orders o
    WHERE LOWER(TRIM(o.comercio)) = LOWER(TRIM(v_campaign.comercio))
      AND (
        LOWER(TRIM(COALESCE(o.status, ''))) = ANY(v_clean_targets)
        OR LOWER(TRIM(COALESCE(o.estado_wms, ''))) = ANY(v_clean_targets)
      )
      AND NOT (LOWER(TRIM(COALESCE(o.status, ''))) = ANY(v_excluded_statuses))
      AND NOT (COALESCE(o.estado_wms, '') = ANY(v_excluded_wms))
      AND (v_campaign.start_date IS NULL OR o.created_at >= v_campaign.start_date)
      AND (v_campaign.end_date IS NULL OR o.created_at <= v_campaign.end_date)
    ORDER BY o.created_at ASC
  LOOP
    v_has_label := (v_order.tracking_number IS NOT NULL AND TRIM(v_order.tracking_number) != '')
                   OR (v_order.label_base64 IS NOT NULL AND TRIM(v_order.label_base64) != '');
    IF v_has_label THEN
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.order_items
      WHERE order_id = v_order.id
        AND campaign_id = v_campaign.id
    ) INTO v_already_applied;

    IF v_already_applied THEN
      CONTINUE;
    END IF;

    IF NOT public.order_matches_campaign_conditions(v_order.id, v_campaign.id) THEN
      CONTINUE;
    END IF;

    v_order_gift_qty := public.calculate_campaign_gift_quantity(v_order.id, v_campaign.id);
    IF v_order_gift_qty <= 0 THEN
      CONTINUE;
    END IF;

    SELECT warehouse_id INTO v_warehouse_id
    FROM public.order_items
    WHERE order_id = v_order.id AND warehouse_id IS NOT NULL
    LIMIT 1;

    IF v_warehouse_id IS NULL THEN
      v_warehouse_id := v_default_warehouse_id;
    END IF;

    INSERT INTO public.order_items (order_id, product_id, warehouse_id, quantity, tag, is_gift, campaign_id)
    VALUES (v_order.id, v_gift_product.id, v_warehouse_id, v_order_gift_qty, 'Campaña', TRUE, v_campaign.id);

    FOR v_dep_item IN
      SELECT oi.id, oi.quantity, oi.campaign_id
      FROM public.order_items oi
      JOIN public.campaigns c ON c.id = oi.campaign_id
      WHERE oi.order_id = v_order.id
        AND oi.campaign_id != v_campaign.id
        AND c.active = TRUE
        AND c.gift_quantity_mode = 'order_total_qty'
    LOOP
      v_dep_qty := public.calculate_campaign_gift_quantity(v_order.id, v_dep_item.campaign_id);
      IF v_dep_qty > 0 AND v_dep_qty IS DISTINCT FROM v_dep_item.quantity THEN
        UPDATE public.order_items
        SET quantity = v_dep_qty
        WHERE id = v_dep_item.id;
      END IF;
    END LOOP;

    SELECT COALESCE(SUM(quantity), 0) INTO v_new_cantidad
    FROM public.order_items WHERE order_id = v_order.id;

    SELECT string_agg(DISTINCT p.sku, ', ') INTO v_new_skus
    FROM public.order_items oi
    JOIN public.products p ON oi.product_id = p.id
    WHERE oi.order_id = v_order.id;

    SELECT string_agg(DISTINCT p.name, ', ') INTO v_new_items
    FROM public.order_items oi
    JOIN public.products p ON oi.product_id = p.id
    WHERE oi.order_id = v_order.id;

    UPDATE public.orders
    SET cantidad = v_new_cantidad,
        sku = v_new_skus,
        item = v_new_items
    WHERE id = v_order.id;

    v_applied_count := v_applied_count + 1;
    v_total_units_applied := v_total_units_applied + v_order_gift_qty;
  END LOOP;

  UPDATE public.campaigns
  SET is_retroactive = TRUE,
      retroactive_applied_at = timezone('utc'::text, now()),
      retroactive_target_statuses = v_clean_targets
  WHERE id = p_campaign_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'campaign_id', p_campaign_id,
    'applied_orders_count', v_applied_count,
    'total_units_applied', v_total_units_applied
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.preview_campaign_retroactive(UUID, TEXT[], VARCHAR, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_campaign_retroactive(UUID, TEXT[], VARCHAR, INTEGER) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.apply_campaign_retroactively(UUID, TEXT[], BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_campaign_retroactively(UUID, TEXT[], BOOLEAN) TO authenticated, service_role;


-- ==============================================================================
-- 4. VULN-25: Endurecimiento de RLS en optiroute_route_records, product_locations y order_picking_requests
-- ==============================================================================

-- 4.1 optiroute_route_records: Solo administradores y personal operativo
DROP POLICY IF EXISTS "Permitir lectura de rutas optiroute a usuarios autenticados" ON public.optiroute_route_records;
CREATE POLICY "Permitir lectura de rutas optiroute a usuarios autenticados"
    ON public.optiroute_route_records
    FOR SELECT
    TO authenticated
    USING (
        public.is_admin()
        OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('operario', 'picker', 'supervisor')
    );

DROP POLICY IF EXISTS "Permitir inserción y actualización de rutas optiroute a usuarios autenticados" ON public.optiroute_route_records;
CREATE POLICY "Permitir inserción y actualización de rutas optiroute a usuarios autenticados"
    ON public.optiroute_route_records
    FOR ALL
    TO authenticated
    USING (
        public.is_admin()
        OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('operario', 'picker', 'supervisor')
    )
    WITH CHECK (
        public.is_admin()
        OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('operario', 'picker', 'supervisor')
    );

-- 4.2 product_locations: Lectura por comercio/personal de bodega, escritura exclusiva de personal de bodega/admin
DROP POLICY IF EXISTS "Autenticados pueden ver ubicaciones" ON public.product_locations;
CREATE POLICY "Autenticados pueden ver ubicaciones" ON public.product_locations
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.check_user_commerce(comercio)
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('operario', 'picker', 'supervisor')
  );

DROP POLICY IF EXISTS "Autenticados pueden insertar ubicaciones" ON public.product_locations;
CREATE POLICY "Autenticados pueden insertar ubicaciones" ON public.product_locations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('operario', 'picker', 'supervisor')
  );

DROP POLICY IF EXISTS "Autenticados pueden actualizar ubicaciones" ON public.product_locations;
CREATE POLICY "Autenticados pueden actualizar ubicaciones" ON public.product_locations
  FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('operario', 'picker', 'supervisor')
  )
  WITH CHECK (
    public.is_admin()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('operario', 'picker', 'supervisor')
  );

DROP POLICY IF EXISTS "Autenticados pueden eliminar ubicaciones" ON public.product_locations;
CREATE POLICY "Autenticados pueden eliminar ubicaciones" ON public.product_locations
  FOR DELETE TO authenticated
  USING (
    public.is_admin()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('operario', 'picker', 'supervisor')
  );

-- 4.3 order_picking_requests: Eliminar bypass `OR created_by = auth.uid()` y exigir que order_id pertenezca al mismo comercio
DROP POLICY IF EXISTS "Clientes consultan solicitudes de su comercio" ON public.order_picking_requests;
CREATE POLICY "Clientes consultan solicitudes de su comercio" ON public.order_picking_requests
    FOR SELECT TO authenticated
    USING (
        (
            public.check_user_commerce(comercio)
            AND EXISTS (
                SELECT 1 FROM public.orders o
                WHERE o.id = order_picking_requests.order_id
                  AND LOWER(TRIM(COALESCE(o.comercio, ''))) = LOWER(TRIM(COALESCE(order_picking_requests.comercio, '')))
            )
        )
        OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'operario', 'picker', 'supervisor')
    );

DROP POLICY IF EXISTS "Clientes crean solicitudes para su comercio" ON public.order_picking_requests;
CREATE POLICY "Clientes crean solicitudes para su comercio" ON public.order_picking_requests
    FOR INSERT TO authenticated
    WITH CHECK (
        (
            public.check_user_commerce(comercio)
            AND EXISTS (
                SELECT 1 FROM public.orders o
                WHERE o.id = order_picking_requests.order_id
                  AND LOWER(TRIM(COALESCE(o.comercio, ''))) = LOWER(TRIM(COALESCE(order_picking_requests.comercio, '')))
            )
        )
        OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'operario', 'picker', 'supervisor')
    );

DROP POLICY IF EXISTS "Clientes actualizan solicitudes pendientes de su comercio" ON public.order_picking_requests;
CREATE POLICY "Clientes actualizan solicitudes pendientes de su comercio" ON public.order_picking_requests
    FOR UPDATE TO authenticated
    USING (
        (
            public.check_user_commerce(comercio)
            AND EXISTS (
                SELECT 1 FROM public.orders o
                WHERE o.id = order_picking_requests.order_id
                  AND LOWER(TRIM(COALESCE(o.comercio, ''))) = LOWER(TRIM(COALESCE(order_picking_requests.comercio, '')))
            )
        )
        OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'operario', 'picker', 'supervisor')
    )
    WITH CHECK (
        (
            public.check_user_commerce(comercio)
            AND EXISTS (
                SELECT 1 FROM public.orders o
                WHERE o.id = order_picking_requests.order_id
                  AND LOWER(TRIM(COALESCE(o.comercio, ''))) = LOWER(TRIM(COALESCE(order_picking_requests.comercio, '')))
            )
        )
        OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'operario', 'picker', 'supervisor')
    );


-- ==============================================================================
-- 5. VULN-24: Blindaje del Portal Público de Tracking (get_customer_tracking)
-- ==============================================================================

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
          'customer_name', CASE
            WHEN COALESCE(TRIM(o.customer_name), '') = '' THEN 'Cliente'
            WHEN split_part(TRIM(o.customer_name), ' ', 2) <> '' THEN
              split_part(TRIM(o.customer_name), ' ', 1) || ' ' || LEFT(split_part(TRIM(o.customer_name), ' ', 2), 1) || '.'
            ELSE split_part(TRIM(o.customer_name), ' ', 1)
          END,
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
            CASE WHEN COALESCE((o.raw_shopify_data->'wms_forced_tracking'->>'active')::boolean, false) IS TRUE
              THEN NULLIF(TRIM(o.raw_shopify_data->'wms_forced_tracking'->>'tracking_number'), '')
              ELSE NULL
            END,
            NULLIF(NULLIF(o.tracking_number, 'No informado'), ''),
            (SELECT eu.tracking FROM public.envios_unificados eu WHERE eu.pedido_referencia = o.external_order_number AND eu.tracking IS NOT NULL AND eu.tracking <> 'No informado' AND LOWER(COALESCE(eu.status, '')) NOT LIKE '%cancel%' LIMIT 1),
            o.tracking_number
          ),
          'tracking_url', COALESCE(
            CASE WHEN COALESCE((o.raw_shopify_data->'wms_forced_tracking'->>'active')::boolean, false) IS TRUE
              THEN NULLIF(TRIM(o.raw_shopify_data->'wms_forced_tracking'->>'tracking_url'), '')
              ELSE NULL
            END,
            o.tracking_url,
            (SELECT eu.tracking_url FROM public.envios_unificados eu WHERE eu.pedido_referencia = o.external_order_number AND eu.tracking_url IS NOT NULL AND eu.tracking_url <> '' AND LOWER(COALESCE(eu.status, '')) NOT LIKE '%cancel%' LIMIT 1)
          ),
          'courier', COALESCE(
            CASE WHEN COALESCE((o.raw_shopify_data->'wms_forced_tracking'->>'active')::boolean, false) IS TRUE
              THEN NULLIF(TRIM(o.raw_shopify_data->'wms_forced_tracking'->>'courier'), '')
              ELSE NULL
            END,
            o.courier,
            o.operador,
            'Stocka Same Day / Courier'
          ),
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
          'customer_name', CASE
            WHEN COALESCE(TRIM(o.customer_name), '') = '' THEN 'Cliente'
            WHEN split_part(TRIM(o.customer_name), ' ', 2) <> '' THEN
              split_part(TRIM(o.customer_name), ' ', 1) || ' ' || LEFT(split_part(TRIM(o.customer_name), ' ', 2), 1) || '.'
            ELSE split_part(TRIM(o.customer_name), ' ', 1)
          END,
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
            CASE WHEN COALESCE((o.raw_shopify_data->'wms_forced_tracking'->>'active')::boolean, false) IS TRUE
              THEN NULLIF(TRIM(o.raw_shopify_data->'wms_forced_tracking'->>'tracking_number'), '')
              ELSE NULL
            END,
            NULLIF(NULLIF(o.tracking_number, 'No informado'), ''),
            (SELECT eu.tracking FROM public.envios_unificados eu WHERE eu.pedido_referencia = o.external_order_number AND eu.tracking IS NOT NULL AND eu.tracking <> 'No informado' AND LOWER(COALESCE(eu.status, '')) NOT LIKE '%cancel%' LIMIT 1),
            o.tracking_number
          ),
          'tracking_url', COALESCE(
            CASE WHEN COALESCE((o.raw_shopify_data->'wms_forced_tracking'->>'active')::boolean, false) IS TRUE
              THEN NULLIF(TRIM(o.raw_shopify_data->'wms_forced_tracking'->>'tracking_url'), '')
              ELSE NULL
            END,
            o.tracking_url,
            (SELECT eu.tracking_url FROM public.envios_unificados eu WHERE eu.pedido_referencia = o.external_order_number AND eu.tracking_url IS NOT NULL AND eu.tracking_url <> '' AND LOWER(COALESCE(eu.status, '')) NOT LIKE '%cancel%' LIMIT 1)
          ),
          'courier', COALESCE(
            CASE WHEN COALESCE((o.raw_shopify_data->'wms_forced_tracking'->>'active')::boolean, false) IS TRUE
              THEN NULLIF(TRIM(o.raw_shopify_data->'wms_forced_tracking'->>'courier'), '')
              ELSE NULL
            END,
            o.courier,
            o.operador,
            'Stocka Same Day / Courier'
          ),
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

  -- Limpiar prefijo '#' y comodines SQL ('%', '_') si fueron ingresados
  IF LEFT(v_clean_order, 1) = '#' THEN
    v_clean_order := SUBSTRING(v_clean_order FROM 2);
  END IF;
  v_clean_order := regexp_replace(v_clean_order, '[%_\\]', '', 'g');
  v_clean_courier := regexp_replace(v_clean_courier, '[%_\\]', '', 'g');

  v_num_only := regexp_replace(v_clean_order, '[^0-9]', '', 'g');

  -- 1. Validación Cruzada Estricta (Orden + Correo)
  IF v_clean_email <> '' AND LENGTH(v_clean_order) >= 2 THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'order_number', COALESCE(o.external_order_number, o.id::text),
        'comercio', COALESCE(o.comercio, 'Tienda Asociada Stocka'),
        'customer_name', CASE
          WHEN COALESCE(TRIM(o.customer_name), '') = '' THEN 'Cliente'
          WHEN split_part(TRIM(o.customer_name), ' ', 2) <> '' THEN
            split_part(TRIM(o.customer_name), ' ', 1) || ' ' || LEFT(split_part(TRIM(o.customer_name), ' ', 2), 1) || '.'
          ELSE split_part(TRIM(o.customer_name), ' ', 1)
        END,
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
          CASE WHEN COALESCE((o.raw_shopify_data->'wms_forced_tracking'->>'active')::boolean, false) IS TRUE
            THEN NULLIF(TRIM(o.raw_shopify_data->'wms_forced_tracking'->>'tracking_number'), '')
            ELSE NULL
          END,
          NULLIF(NULLIF(o.tracking_number, 'No informado'), ''),
          (SELECT eu.tracking FROM public.envios_unificados eu WHERE eu.pedido_referencia = o.external_order_number AND eu.tracking IS NOT NULL AND eu.tracking <> 'No informado' AND LOWER(COALESCE(eu.status, '')) NOT LIKE '%cancel%' LIMIT 1),
          o.tracking_number
        ),
        'tracking_url', COALESCE(
          CASE WHEN COALESCE((o.raw_shopify_data->'wms_forced_tracking'->>'active')::boolean, false) IS TRUE
            THEN NULLIF(TRIM(o.raw_shopify_data->'wms_forced_tracking'->>'tracking_url'), '')
            ELSE NULL
          END,
          o.tracking_url,
          (SELECT eu.tracking_url FROM public.envios_unificados eu WHERE eu.pedido_referencia = o.external_order_number AND eu.tracking_url IS NOT NULL AND eu.tracking_url <> '' AND LOWER(COALESCE(eu.status, '')) NOT LIKE '%cancel%' LIMIT 1)
        ),
        'courier', COALESCE(
          CASE WHEN COALESCE((o.raw_shopify_data->'wms_forced_tracking'->>'active')::boolean, false) IS TRUE
            THEN NULLIF(TRIM(o.raw_shopify_data->'wms_forced_tracking'->>'courier'), '')
            ELSE NULL
          END,
          o.courier,
          o.operador,
          'Stocka Same Day / Courier'
        ),
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
              ELSE 'Pendiente'
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
        OR LOWER(TRIM(COALESCE(o.external_order_number, ''))) = '#' || LOWER(v_clean_order)
        OR (LENGTH(v_num_only) >= 3 AND regexp_replace(COALESCE(o.external_order_number, ''), '[^0-9]', '', 'g') = v_num_only)
        OR o.id::text = v_clean_order
      )
    LIMIT 5;

  -- 3. Solo Código de Courier (mínimo 5 caracteres sin comodines)
  ELSIF LENGTH(v_clean_courier) >= 5 THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'order_number', COALESCE(o.external_order_number, o.id::text),
        'comercio', COALESCE(o.comercio, 'Tienda Asociada Stocka'),
        'customer_name', CASE
          WHEN COALESCE(TRIM(o.customer_name), '') = '' THEN 'Cliente'
          WHEN split_part(TRIM(o.customer_name), ' ', 2) <> '' THEN
            split_part(TRIM(o.customer_name), ' ', 1) || ' ' || LEFT(split_part(TRIM(o.customer_name), ' ', 2), 1) || '.'
          ELSE split_part(TRIM(o.customer_name), ' ', 1)
        END,
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
          CASE WHEN COALESCE((o.raw_shopify_data->'wms_forced_tracking'->>'active')::boolean, false) IS TRUE
            THEN NULLIF(TRIM(o.raw_shopify_data->'wms_forced_tracking'->>'tracking_number'), '')
            ELSE NULL
          END,
          NULLIF(NULLIF(o.tracking_number, 'No informado'), ''),
          (SELECT eu.tracking FROM public.envios_unificados eu WHERE eu.pedido_referencia = o.external_order_number AND eu.tracking IS NOT NULL AND eu.tracking <> 'No informado' AND LOWER(COALESCE(eu.status, '')) NOT LIKE '%cancel%' LIMIT 1),
          o.tracking_number
        ),
        'tracking_url', COALESCE(
          CASE WHEN COALESCE((o.raw_shopify_data->'wms_forced_tracking'->>'active')::boolean, false) IS TRUE
            THEN NULLIF(TRIM(o.raw_shopify_data->'wms_forced_tracking'->>'tracking_url'), '')
            ELSE NULL
          END,
          o.tracking_url,
          (SELECT eu.tracking_url FROM public.envios_unificados eu WHERE eu.pedido_referencia = o.external_order_number AND eu.tracking_url IS NOT NULL AND eu.tracking_url <> '' AND LOWER(COALESCE(eu.status, '')) NOT LIKE '%cancel%' LIMIT 1)
        ),
        'courier', COALESCE(
          CASE WHEN COALESCE((o.raw_shopify_data->'wms_forced_tracking'->>'active')::boolean, false) IS TRUE
            THEN NULLIF(TRIM(o.raw_shopify_data->'wms_forced_tracking'->>'courier'), '')
            ELSE NULL
          END,
          o.courier,
          o.operador,
          'Stocka Same Day / Courier'
        ),
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
              ELSE 'Pendiente'
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
      OR LOWER(TRIM(COALESCE(o.raw_shopify_data->'wms_forced_tracking'->>'tracking_number', ''))) = LOWER(v_clean_courier)
    LIMIT 5;

  ELSE
    RETURN '[]'::jsonb;
  END IF;

  RETURN v_results;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_tracking(text, text, text, text) TO anon, authenticated;

COMMIT;
