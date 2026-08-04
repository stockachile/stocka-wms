-- WMS STOCKA - SQL Migration to fix INSERT RLS Policies for orders and order_items tables
-- Run this script in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/ejtjfaucnxbikrwjwwdu/sql/new

-- 1. Ensure Row Level Security is enabled on public.orders and public.order_items
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing insert policies if they exist to avoid duplication
DROP POLICY IF EXISTS "Clientes pueden crear sus propios pedidos" ON public.orders;
DROP POLICY IF EXISTS "Clientes pueden insertar items en sus pedidos" ON public.order_items;

-- 3. Create INSERT policy for orders
-- Authorizes users to create orders where merchant_id is their own auth user ID and
-- the comercio belongs to their allowed comercios from profiles.
CREATE POLICY "Clientes pueden crear sus propios pedidos" ON public.orders
  FOR INSERT WITH CHECK (
    orders.merchant_id = auth.uid()
    AND EXISTS (
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

-- 4. Create INSERT policy for order_items
-- Authorizes users to insert items only into orders that they own.
CREATE POLICY "Clientes pueden insertar items en sus pedidos" ON public.order_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE orders.id = order_items.order_id
        AND orders.merchant_id = auth.uid()
    )
  );
