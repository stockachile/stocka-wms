-- WMS STOCKA - Corrección de Política RLS para Observaciones de Facturación
-- Ejecutar este archivo en el SQL Editor de Supabase para permitir a los clientes enviar apelaciones y observaciones.

DROP POLICY IF EXISTS "Clientes pueden actualizar observaciones de sus comercios" ON public.billing_records;

CREATE POLICY "Clientes pueden actualizar observaciones de sus comercios" ON public.billing_records 
FOR UPDATE 
USING (
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND (
            p.role = 'admin'
            OR p.comercio = 'all'
            OR public.billing_records.comercio = ANY (
                 ARRAY(SELECT trim(name) FROM unnest(string_to_array(p.comercio, ',')) AS name)
            )
            OR EXISTS (
                 SELECT 1 FROM public.billing_mappings bg
                 WHERE bg.billing_name = public.billing_records.comercio
                   AND bg.comercio_nombre = ANY (
                        ARRAY(SELECT trim(name) FROM unnest(string_to_array(p.comercio, ',')) AS name)
                   )
            )
          )
    )
) 
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND (
            p.role = 'admin'
            OR p.comercio = 'all'
            OR public.billing_records.comercio = ANY (
                 ARRAY(SELECT trim(name) FROM unnest(string_to_array(p.comercio, ',')) AS name)
            )
            OR EXISTS (
                 SELECT 1 FROM public.billing_mappings bg
                 WHERE bg.billing_name = public.billing_records.comercio
                   AND bg.comercio_nombre = ANY (
                        ARRAY(SELECT trim(name) FROM unnest(string_to_array(p.comercio, ',')) AS name)
                   )
            )
          )
    )
);

-- Recargar el caché de PostgREST
NOTIFY pgrst, 'reload schema';
