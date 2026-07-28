-- WMS STOCKA - Habilitar lectura pública de documentos para el sitio web
-- Este script permite que los visitantes anónimos de la web www.stocka.cl 
-- puedan listar y descargar archivos que hayan sido marcados para la web o generales.

-- 1. Crear una política que permita SELECT a cualquier usuario anónimo (público)
--    Filtramos opcionalmente para que solo tengan acceso a carpetas no confidenciales
--    o a todos los registros según se requiera (en este caso permitimos todos los documentos
--    de servicio que son de carácter público como tarifarios, instructivos, etc.)
DROP POLICY IF EXISTS "Cualquier usuario anonimo puede ver documentos de servicio" ON public.service_docs;
CREATE POLICY "Cualquier usuario anonimo puede ver documentos de servicio" ON public.service_docs
  FOR SELECT TO anon USING (true);

-- 2. Asegurar que las políticas de storage del bucket 'service_docs' 
--    permitan la descarga pública de los archivos (esto ya está público en el bucket, 
--    pero este comando asegura el acceso de lectura a nivel de base de datos de los metadatos)
GRANT SELECT ON public.service_docs TO anon;
