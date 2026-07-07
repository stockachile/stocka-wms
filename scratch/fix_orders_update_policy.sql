-- WMS STOCKA - SQL Script to Fix Admin Order Updates
-- Run this script in the SQL Editor of your Supabase Dashboard:
-- https://supabase.com/dashboard/project/ejtjfaucnxbikrwjwwdu/sql/new

-- 1. Ensure the is_admin() function is correctly defined
CREATE OR REPLACE FUNCTION public.is_admin() 
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- 2. Drop any existing admin policies on public.orders
DROP POLICY IF EXISTS "Admin can view and modify all orders" ON public.orders;
DROP POLICY IF EXISTS "Admin puede gestionar todos los pedidos" ON public.orders;
DROP POLICY IF EXISTS "Admin gestiona todos los pedidos" ON public.orders;

-- 3. Create a clean, explicit policy for administrators (FOR ALL: SELECT, INSERT, UPDATE, DELETE)
CREATE POLICY "Admin can view and modify all orders" ON public.orders
  FOR ALL 
  TO authenticated 
  USING (public.is_admin()) 
  WITH CHECK (public.is_admin());

-- 4. Verify RLS is enabled on public.orders
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
