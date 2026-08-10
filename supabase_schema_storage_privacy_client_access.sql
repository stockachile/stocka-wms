-- WMS STOCKA - SQL Migration to allow clients to download their own invoices and billing documents from private payment_receipts bucket
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Crear o reemplazar la función helper con SECURITY DEFINER para verificar acceso
CREATE OR REPLACE FUNCTION public.check_storage_access(object_name TEXT, auth_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  is_adm BOOLEAN;
  user_comercio TEXT;
BEGIN
  -- A. Si el usuario es administrador, permitir acceso inmediato
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth_id AND role = 'admin'
  ) INTO is_adm;
  
  IF is_adm THEN
    RETURN TRUE;
  END IF;

  -- Obtener el/los comercios asociados al perfil del usuario
  SELECT comercio INTO user_comercio FROM public.profiles WHERE id = auth_id;
  
  IF user_comercio IS NULL THEN
    RETURN FALSE;
  END IF;

  -- B. Si el usuario tiene acceso a todos los comercios ('all')
  IF user_comercio = 'all' THEN
    RETURN TRUE;
  END IF;

  -- C. Verificar si el archivo está referenciado en algún registro de facturación al que el cliente tiene acceso
  IF EXISTS (
    SELECT 1 FROM public.billing_records r
    WHERE (
      r.fulfillment_pdf_url LIKE '%' || object_name
      OR r.factura_fulfillment_pdf_url LIKE '%' || object_name
      OR r.factura_enviame_pdf_url LIKE '%' || object_name
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(r.enviame_pdfs, '[]'::jsonb)) AS pdf
        WHERE pdf->>'url' LIKE '%' || object_name
      )
    )
    AND (
      r.comercio = ANY (
        ARRAY(SELECT trim(name) FROM unnest(string_to_array(user_comercio, ',')) AS name)
      )
      OR EXISTS (
        SELECT 1 FROM public.billing_mappings bg
        WHERE bg.billing_name = r.comercio
          AND bg.comercio_nombre = ANY (
            ARRAY(SELECT trim(name) FROM unnest(string_to_array(user_comercio, ',')) AS name)
          )
      )
    )
  ) THEN
    RETURN TRUE;
  END IF;

  -- D. Verificar si el archivo está referenciado en algún reporte de pago al que el cliente tiene acceso
  IF EXISTS (
    SELECT 1 FROM public.payment_reports rep
    WHERE rep.comprobante_url LIKE '%' || object_name
    AND rep.comercio = ANY (
      ARRAY(SELECT trim(name) FROM unnest(string_to_array(user_comercio, ',')) AS name)
    )
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Eliminar la política SELECT previa y reemplazarla con la nueva que implementa la función helper
DROP POLICY IF EXISTS "Permitir ver comprobantes autorizados" ON storage.objects;

CREATE POLICY "Permitir ver comprobantes autorizados" ON storage.objects
    FOR SELECT TO authenticated
    USING (
      bucket_id = 'payment_receipts' 
      AND (
        auth.uid() = owner 
        OR public.check_storage_access(name, auth.uid())
      )
    );
