-- WMS STOCKA - Supabase Schema Phase 12: Integraciones, Productos y Pedidos Centrados en el Comercio
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Agregar la columna 'comercio' a las tablas principales
ALTER TABLE public.merchant_integrations ADD COLUMN IF NOT EXISTS comercio TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS comercio TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS comercio TEXT;
ALTER TABLE public.order_alerts ADD COLUMN IF NOT EXISTS comercio TEXT;

-- 2. Migrar la información de comercio actual desde profiles usando merchant_id
-- Si el perfil tiene múltiples comercios, le asignamos el primero. Si es 'no asignado' o vacío, le asignamos 'STOCKA' como default.
UPDATE public.merchant_integrations mi
SET comercio = COALESCE(
  NULLIF(TRIM(split_part(p.comercio, ',', 1)), ''),
  'STOCKA'
)
FROM public.profiles p
WHERE mi.merchant_id = p.id;

UPDATE public.products pr
SET comercio = COALESCE(
  NULLIF(TRIM(split_part(p.comercio, ',', 1)), ''),
  'STOCKA'
)
FROM public.profiles p
WHERE pr.merchant_id = p.id;

UPDATE public.orders o
SET comercio = COALESCE(
  NULLIF(TRIM(split_part(p.comercio, ',', 1)), ''),
  'STOCKA'
)
FROM public.profiles p
WHERE o.merchant_id = p.id;

UPDATE public.order_alerts oa
SET comercio = COALESCE(
  NULLIF(TRIM(split_part(p.comercio, ',', 1)), ''),
  'STOCKA'
)
FROM public.profiles p
WHERE oa.merchant_id = p.id;

-- 3. Establecer 'STOCKA' por defecto para registros nulos en la columna comercio
UPDATE public.merchant_integrations SET comercio = 'STOCKA' WHERE comercio IS NULL;
UPDATE public.products SET comercio = 'STOCKA' WHERE comercio IS NULL;
UPDATE public.orders SET comercio = 'STOCKA' WHERE comercio IS NULL;
UPDATE public.order_alerts SET comercio = 'STOCKA' WHERE comercio IS NULL;

-- 4. Reemplazar la restricción de unicidad en merchant_integrations
ALTER TABLE public.merchant_integrations DROP CONSTRAINT IF EXISTS merchant_integrations_merchant_id_platform_key;
ALTER TABLE public.merchant_integrations ADD CONSTRAINT merchant_integrations_comercio_platform_key UNIQUE (comercio, platform);

-- 5. Recrear políticas de seguridad RLS basadas en el Comercio

-- A) merchant_integrations
DROP POLICY IF EXISTS "Clientes gestionan sus credenciales" ON public.merchant_integrations;
CREATE POLICY "Clientes gestionan sus credenciales" ON public.merchant_integrations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(merchant_integrations.comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );

-- B) products
DROP POLICY IF EXISTS "Clientes ven sus propios productos" ON public.products;
CREATE POLICY "Clientes ven sus propios productos" ON public.products
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(products.comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );

-- C) inventory
DROP POLICY IF EXISTS "Clientes ven inventario de sus productos" ON public.inventory;
CREATE POLICY "Clientes ven inventario de sus productos" ON public.inventory
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.products
      JOIN public.profiles ON profiles.id = auth.uid()
      WHERE products.id = inventory.product_id
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(products.comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );

-- D) movements
DROP POLICY IF EXISTS "Clientes ven movimientos de sus productos" ON public.movements;
CREATE POLICY "Clientes ven movimientos de sus productos" ON public.movements
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.products
      JOIN public.profiles ON profiles.id = auth.uid()
      WHERE products.id = movements.product_id
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(products.comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );

-- E) orders
DROP POLICY IF EXISTS "Clientes ven sus pedidos" ON public.orders;
CREATE POLICY "Clientes ven sus pedidos" ON public.orders
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(orders.comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );

-- F) order_items
DROP POLICY IF EXISTS "Clientes ven items de sus pedidos" ON public.order_items;
CREATE POLICY "Clientes ven items de sus pedidos" ON public.order_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.orders
      JOIN public.profiles ON profiles.id = auth.uid()
      WHERE orders.id = order_items.order_id
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(orders.comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );

-- G) order_alerts
DROP POLICY IF EXISTS "Clientes ven sus alertas" ON public.order_alerts;
CREATE POLICY "Clientes ven sus alertas" ON public.order_alerts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(order_alerts.comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );

DROP POLICY IF EXISTS "Clientes pueden marcar alertas leidas" ON public.order_alerts;
CREATE POLICY "Clientes pueden marcar alertas leidas" ON public.order_alerts
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(order_alerts.comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );

-- H) enviame_shipments
DROP POLICY IF EXISTS "Clientes ven sus propios envios" ON public.enviame_shipments;
CREATE POLICY "Clientes ven sus propios envios" ON public.enviame_shipments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.orders
      JOIN public.profiles ON profiles.id = auth.uid()
      WHERE (orders.external_order_number = enviame_shipments.order_id OR orders.id::text = enviame_shipments.order_id)
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(orders.comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );

-- I) optiroute_orders
DROP POLICY IF EXISTS "Clientes ven sus propios pedidos de Optiroute por referencia" ON public.optiroute_orders;
CREATE POLICY "Clientes ven sus propios pedidos de Optiroute por referencia" ON public.optiroute_orders
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.orders
      JOIN public.profiles ON profiles.id = auth.uid()
      WHERE (orders.external_order_number = optiroute_orders.id OR orders.id::text = optiroute_orders.id)
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(orders.comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );
