-- ==========================================================
-- WMS STOCKA - Punto de Ventas (POS Sucursal) para Administradores
-- ==========================================================

-- 1. Asegurar secuencia auto-incrementable para ID de store_sales
CREATE SEQUENCE IF NOT EXISTS store_sales_id_seq;
SELECT setval('store_sales_id_seq', COALESCE((SELECT MAX(id) FROM public.store_sales), 0) + 1, false);
ALTER TABLE public.store_sales ALTER COLUMN id SET DEFAULT nextval('store_sales_id_seq');

-- 2. Agregar columnas para vincular pedidos del gestor y bodegas en store_sales
ALTER TABLE public.store_sales ADD COLUMN IF NOT EXISTS wms_order_id UUID NULL REFERENCES public.orders(id) ON DELETE SET NULL;
ALTER TABLE public.store_sales ADD COLUMN IF NOT EXISTS warehouse_id UUID NULL REFERENCES public.warehouses(id) ON DELETE SET NULL;

-- 3. Asegurar RLS en store_sales
ALTER TABLE public.store_sales ENABLE ROW LEVEL SECURITY;

-- 4. Política para que los administradores tengan control total (SELECT, INSERT, UPDATE, DELETE)
DROP POLICY IF EXISTS "Admins tienen acceso total a store_sales" ON public.store_sales;
CREATE POLICY "Admins tienen acceso total a store_sales" ON public.store_sales
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- 5. Mantener la política de lectura para los clientes en su comercio
DROP POLICY IF EXISTS "Clientes ven ventas de su comercio asignado" ON public.store_sales;
CREATE POLICY "Clientes ven ventas de su comercio asignado" ON public.store_sales
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(store_sales.comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );

-- 6. Otorgar permisos
GRANT ALL ON public.store_sales TO postgres, service_role;
GRANT ALL ON public.store_sales TO authenticated;
GRANT SELECT ON public.store_sales TO anon;

-- 7. Índices para optimizar búsquedas por comercio, fecha y orden
CREATE INDEX IF NOT EXISTS idx_store_sales_comercio ON public.store_sales(comercio);
CREATE INDEX IF NOT EXISTS idx_store_sales_created_at ON public.store_sales(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_sales_wms_order_id ON public.store_sales(wms_order_id);
