-- WMS STOCKA - SQL Migration to fix RLS Policies for Products and Pack Items
-- Run this script in the Supabase SQL Editor.

-- 1. Enable row level security (just in case)
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_pack_items ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing restrictive policies on products
DROP POLICY IF EXISTS "Clientes pueden insertar sus propios productos" ON public.products;
DROP POLICY IF EXISTS "Clientes pueden actualizar sus propios productos" ON public.products;
DROP POLICY IF EXISTS "Clientes pueden eliminar sus propios productos" ON public.products;

-- 3. Create INSERT, UPDATE, and DELETE policies for products based on comercio match
CREATE POLICY "Clientes pueden insertar sus propios productos" ON public.products
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );

CREATE POLICY "Clientes pueden actualizar sus propios productos" ON public.products
  FOR UPDATE USING (
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
  ) WITH CHECK (
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

CREATE POLICY "Clientes pueden eliminar sus propios productos" ON public.products
  FOR DELETE USING (
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

-- 4. Update policies for product_pack_items to match products access control
DROP POLICY IF EXISTS "Clientes ven componentes de sus propios packs" ON public.product_pack_items;
CREATE POLICY "Clientes ven componentes de sus propios packs" ON public.product_pack_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.products
      WHERE products.id = product_pack_items.pack_product_id
    )
  );

DROP POLICY IF EXISTS "Clientes gestionan componentes de sus propios packs" ON public.product_pack_items;
CREATE POLICY "Clientes gestionan componentes de sus propios packs" ON public.product_pack_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.products
      JOIN public.profiles ON profiles.id = auth.uid()
      WHERE products.id = product_pack_items.pack_product_id
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(products.comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );
