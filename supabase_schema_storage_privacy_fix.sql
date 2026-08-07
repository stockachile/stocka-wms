-- WMS STOCKA - SQL Migration to secure storage bucket payment_receipts
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Asegurar la existencia de la función helper is_admin()
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- 2. Cambiar el bucket payment_receipts a privado
UPDATE storage.buckets
SET public = false
WHERE id = 'payment_receipts';

-- En caso de que se intente crear nuevamente en el futuro, nos aseguramos que se mantenga privado (public = false)
INSERT INTO storage.buckets (id, name, public)
VALUES ('payment_receipts', 'payment_receipts', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- 3. Eliminar la política RLS insegura previa (que permitía acceso a cualquiera)
DROP POLICY IF EXISTS "Permitir ver comprobantes a cualquiera" ON storage.objects;

-- 4. Crear política RLS de descarga restringida y segura
-- Permitir descargar comprobantes si el usuario es el dueño (el cargador original del archivo) o es administrador
CREATE POLICY "Permitir ver comprobantes autorizados" ON storage.objects
    FOR SELECT TO authenticated
    USING (
      bucket_id = 'payment_receipts' 
      AND (
        auth.uid() = owner 
        OR is_admin()
      )
    );
