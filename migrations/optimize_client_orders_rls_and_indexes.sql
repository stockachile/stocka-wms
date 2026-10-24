-- =================================================================================
-- OPTIMIZACIÓN DE ÍNDICES Y POLÍTICAS RLS PARA MÓDULO DE PEDIDOS DE CLIENTES (SELLERS)
-- Previene "canceling statement due to statement timeout" (código 57014) en cuentas
-- multi-comercio o de alto volumen (ej. DORMILONES, RELAJARTE, BACK IN TIME).
-- =================================================================================

-- 1. Índices compuestos críticos para consultas de pedidos e ítems anidados
CREATE INDEX IF NOT EXISTS idx_orders_comercio_created_at_desc
  ON public.orders (comercio, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_created_at_desc
  ON public.orders (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id
  ON public.order_items (order_id);

CREATE INDEX IF NOT EXISTS idx_order_items_product_id
  ON public.order_items (product_id);

CREATE INDEX IF NOT EXISTS idx_products_comercio
  ON public.products (comercio);

-- 2. Optimizar is_admin() como STABLE para que PostgreSQL lo evalúe una sola vez por consulta (InitPlan)
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid()) AND role = 'admin'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- 3. Función STABLE para obtener los comercios autorizados del usuario una sola vez por consulta
CREATE OR REPLACE FUNCTION public.get_my_comercio_tokens() RETURNS text[] AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT TRIM(LOWER(token))
      FROM public.profiles p,
           unnest(string_to_array(p.comercio, ',')) AS token
      WHERE p.id = (SELECT auth.uid())
    ),
    ARRAY[]::text[]
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- 4. Actualizar políticas RLS de lectura para usar evaluación STABLE (sin subconsultas correlacionadas por fila)
DROP POLICY IF EXISTS "Clientes ven sus pedidos" ON public.orders;
CREATE POLICY "Clientes ven sus pedidos" ON public.orders
  FOR SELECT USING (
    'all' = ANY (SELECT public.get_my_comercio_tokens())
    OR LOWER(orders.comercio) = ANY (SELECT public.get_my_comercio_tokens())
  );

DROP POLICY IF EXISTS "Clientes ven items de sus pedidos" ON public.order_items;
CREATE POLICY "Clientes ven items de sus pedidos" ON public.order_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE orders.id = order_items.order_id
        AND (
          'all' = ANY (SELECT public.get_my_comercio_tokens())
          OR LOWER(orders.comercio) = ANY (SELECT public.get_my_comercio_tokens())
        )
    )
  );
