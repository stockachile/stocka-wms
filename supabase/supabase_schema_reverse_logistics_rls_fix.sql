-- WMS STOCKA - SQL Migration to fix RLS Policies for reverse_logistics table
-- Run this script in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/ejtjfaucnxbikrwjwwdu/sql/new

-- 1. Create a SECURITY DEFINER function to check user commerce access.
-- This bypasses RLS on the profiles table and avoids recursion or select policy issues.
CREATE OR REPLACE FUNCTION public.check_user_commerce(p_comercio TEXT)
RETURNS BOOLEAN SECURITY DEFINER AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND (
        LOWER(profiles.comercio) = 'all'
        OR LOWER(p_comercio) = ANY (
          SELECT TRIM(LOWER(token))
          FROM unnest(string_to_array(profiles.comercio, ',')) AS token
        )
      )
  );
END;
$$ LANGUAGE plpgsql;

-- 2. Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Clientes ven devoluciones de su comercio asignado" ON public.reverse_logistics;
DROP POLICY IF EXISTS "Usuarios pueden insertar devoluciones de su comercio" ON public.reverse_logistics;
DROP POLICY IF EXISTS "Usuarios pueden actualizar devoluciones de su comercio" ON public.reverse_logistics;

-- 3. Create updated RLS policies using the helper function
CREATE POLICY "Clientes ven devoluciones de su comercio asignado" ON public.reverse_logistics
  FOR SELECT USING (
    public.check_user_commerce(comercio)
  );

CREATE POLICY "Usuarios pueden insertar devoluciones de su comercio" ON public.reverse_logistics
  FOR INSERT WITH CHECK (
    public.check_user_commerce(comercio)
  );

CREATE POLICY "Usuarios pueden actualizar devoluciones de su comercio" ON public.reverse_logistics
  FOR UPDATE USING (
    public.check_user_commerce(comercio)
  ) WITH CHECK (
    public.check_user_commerce(comercio)
  );
