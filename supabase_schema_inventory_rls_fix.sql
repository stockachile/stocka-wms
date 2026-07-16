-- WMS STOCKA - SQL Migration to fix RLS Policies for Inventory and Movements
-- Run this script in the Supabase SQL Editor to authorize updates on inventory levels and tracking history.

-- 1. Enable Row Level Security (just in case)
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movements ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing restrictive policies
DROP POLICY IF EXISTS "Clientes ven inventario de sus productos" ON public.inventory;
DROP POLICY IF EXISTS "Clientes gestionan inventario de sus productos" ON public.inventory;
DROP POLICY IF EXISTS "Clientes actualizan inventario de sus productos" ON public.inventory;
DROP POLICY IF EXISTS "Clientes eliminan inventario de sus productos" ON public.inventory;

DROP POLICY IF EXISTS "Clientes ven movimientos de sus productos" ON public.movements;
DROP POLICY IF EXISTS "Clientes gestionan movimientos de sus productos" ON public.movements;
DROP POLICY IF EXISTS "Clientes actualizan movimientos de sus productos" ON public.movements;
DROP POLICY IF EXISTS "Clientes eliminan movimientos de sus productos" ON public.movements;


-- 3. Create policies for the INVENTORY table
-- Users (Clients and Admins) can read inventory of products they are authorized to manage
CREATE POLICY "inventory_select_policy" ON public.inventory
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      JOIN public.products ON products.id = inventory.product_id
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

-- Users can insert inventory records for products they manage
CREATE POLICY "inventory_insert_policy" ON public.inventory
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      JOIN public.products ON products.id = inventory.product_id
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

-- Users can update inventory records for products they manage
CREATE POLICY "inventory_update_policy" ON public.inventory
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      JOIN public.products ON products.id = inventory.product_id
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
      JOIN public.products ON products.id = inventory.product_id
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

-- Users can delete inventory records for products they manage
CREATE POLICY "inventory_delete_policy" ON public.inventory
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      JOIN public.products ON products.id = inventory.product_id
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


-- 4. Create policies for the MOVEMENTS table
-- Users can read movements of products they manage
CREATE POLICY "movements_select_policy" ON public.movements
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      JOIN public.products ON products.id = movements.product_id
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

-- Users can insert movements for products they manage
CREATE POLICY "movements_insert_policy" ON public.movements
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      JOIN public.products ON products.id = movements.product_id
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

-- Users can update movements for products they manage
CREATE POLICY "movements_update_policy" ON public.movements
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      JOIN public.products ON products.id = movements.product_id
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
      JOIN public.products ON products.id = movements.product_id
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

-- Users can delete movements for products they manage
CREATE POLICY "movements_delete_policy" ON public.movements
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      JOIN public.products ON products.id = movements.product_id
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
