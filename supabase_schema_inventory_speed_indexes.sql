-- ==============================================================================
-- WMS STOCKA - OPTIMIZACIÓN DE RENDIMIENTO: INVENTARIO Y PRODUCTOS
-- ==============================================================================
-- Ejecuta este script en el Supabase SQL Editor para acelerar las consultas de
-- productos e inventario (ej. comercios de alto volumen como JOYAS GLOSS) y
-- eliminar el error "canceling statement due to statement timeout" (código 57014).

-- ------------------------------------------------------------------------------
-- 1. ÍNDICES DE ALTO RENDIMIENTO SOBRE PRODUCTS E INVENTORY
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_products_comercio ON public.products (comercio);
CREATE INDEX IF NOT EXISTS idx_products_comercio_name ON public.products (comercio, name);
CREATE INDEX IF NOT EXISTS idx_inventory_product_id ON public.inventory (product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_warehouse_id ON public.inventory (warehouse_id);

-- ------------------------------------------------------------------------------
-- 2. FUNCIÓN STABLE PARA EVALUAR ADMIN UNA SOLA VEZ POR CONSULTA (InitPlan)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin_or_all()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND (role = 'admin' OR LOWER(comercio) = 'all')
  );
$$;

-- ------------------------------------------------------------------------------
-- 3. POLÍTICAS RLS OPTIMIZADAS PARA PRODUCTS E INVENTORY
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Clientes ven sus propios productos" ON public.products;
CREATE POLICY "Clientes ven sus propios productos" ON public.products
  FOR SELECT USING (
    (SELECT public.is_admin_or_all())
    OR
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND LOWER(products.comercio) = ANY (
          SELECT TRIM(LOWER(token))
          FROM unnest(string_to_array(profiles.comercio, ',')) AS token
        )
    )
  );

DROP POLICY IF EXISTS "inventory_select_policy" ON public.inventory;
DROP POLICY IF EXISTS "Clientes ven inventario de sus productos" ON public.inventory;
CREATE POLICY "inventory_select_policy" ON public.inventory
  FOR SELECT USING (
    (SELECT public.is_admin_or_all())
    OR
    EXISTS (
      SELECT 1 FROM public.products
      JOIN public.profiles ON profiles.id = auth.uid()
      WHERE products.id = inventory.product_id
        AND LOWER(products.comercio) = ANY (
          SELECT TRIM(LOWER(token))
          FROM unnest(string_to_array(profiles.comercio, ',')) AS token
        )
    )
  );
