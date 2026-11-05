-- ========================================================================
-- WMS STOCKA - Permitir a Usuarios Clientes Editar Pedidos en "En procesamiento"
-- ========================================================================
-- Este script habilita a los usuarios comerciales modificar cantidades,
-- eliminar y agregar productos a sus pedidos cuando se encuentran estrictamente
-- en estado "En procesamiento" (antes de que bodega inicie preparación).
--
-- Ejecutar en Supabase SQL Editor:
-- https://supabase.com/dashboard/project/ejtjfaucnxbikrwjwwdu/sql/new
-- ========================================================================

-- 1. Permitir a clientes actualizar pedidos en estado 'En procesamiento'
DROP POLICY IF EXISTS "Clientes pueden editar sus pedidos en procesamiento" ON public.orders;
CREATE POLICY "Clientes pueden editar sus pedidos en procesamiento" ON public.orders
  FOR UPDATE
  TO authenticated
  USING (
    LOWER(TRIM(estado_wms)) = 'en procesamiento'
    AND (
      public.check_user_commerce(comercio)
      OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'operario', 'supervisor')
    )
  )
  WITH CHECK (
    LOWER(TRIM(estado_wms)) = 'en procesamiento'
    AND (
      public.check_user_commerce(comercio)
      OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'operario', 'supervisor')
    )
  );

-- 2. Permitir a clientes modificar items de sus pedidos en estado 'En procesamiento'
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

-- 2b. Proteger columnas sensibles de public.orders frente a actualizaciones directas de clientes
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

-- 3. Permitir a clientes registrar trazabilidad de auditoría de sus pedidos
DROP POLICY IF EXISTS "Clientes pueden registrar auditoria de sus pedidos" ON public.order_audit_logs;
CREATE POLICY "Clientes pueden registrar auditoria de sus pedidos" ON public.order_audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE orders.id = order_audit_logs.order_id
        AND (
          public.check_user_commerce(orders.comercio)
          OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'operario', 'supervisor')
        )
    )
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'operario', 'supervisor')
  );
