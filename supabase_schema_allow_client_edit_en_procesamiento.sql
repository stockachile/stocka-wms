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
    )
  );

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
