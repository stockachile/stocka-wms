-- WMS STOCKA - SQL Migration to fix RLS Policies for order_items table
-- Run this script in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/ejtjfaucnxbikrwjwwdu/sql/new

-- 1. Ensure Row Level Security is enabled on public.order_items
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- 2. Drop any existing admin policies on public.order_items to avoid conflicts
DROP POLICY IF EXISTS "Admin can view and modify all order items" ON public.order_items;
DROP POLICY IF EXISTS "Admin can view and modify all order items" ON order_items;

-- 3. Create a clean, explicit policy for administrators (FOR ALL: SELECT, INSERT, UPDATE, DELETE)
-- It uses public.is_admin() to resolve the schema correctly, restricted TO authenticated users,
-- with matching USING and WITH CHECK constraints.
CREATE POLICY "Admin can view and modify all order items" ON public.order_items
  FOR ALL 
  TO authenticated 
  USING (public.is_admin()) 
  WITH CHECK (public.is_admin());
