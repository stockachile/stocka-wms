-- WMS STOCKA - SQL Migration to fix INSERT RLS Policy for Products table
-- Run this script in the Supabase SQL Editor to authorize product catalog insertions for clients with multiple comercios.

DROP POLICY IF EXISTS "Clientes pueden insertar sus propios productos" ON public.products;

CREATE POLICY "Clientes pueden insertar sus propios productos" ON public.products
  FOR INSERT WITH CHECK (
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
