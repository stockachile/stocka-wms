-- WMS STOCKA - Storage bucket payment_receipts configuration
-- Asegurar que el bucket payment_receipts existe y es publico para lectura de desgloses,
-- reportes interactivos, planillas Excel y facturas emitidas.

-- 1. Asegurar la existencia de la función helper is_admin()
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- 2. Asegurar que el bucket payment_receipts es público para lectura de URLs directas
UPDATE storage.buckets
SET public = true
WHERE id = 'payment_receipts';

INSERT INTO storage.buckets (id, name, public)
VALUES ('payment_receipts', 'payment_receipts', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 3. Eliminar políticas previas restrictivas
DROP POLICY IF EXISTS "Permitir ver comprobantes autorizados" ON storage.objects;
DROP POLICY IF EXISTS "Permitir ver comprobantes a cualquiera" ON storage.objects;

-- 4. Permitir lectura pública de objetos en payment_receipts
CREATE POLICY "Permitir ver comprobantes a cualquiera" ON storage.objects
    FOR SELECT TO public
    USING (bucket_id = 'payment_receipts');

