-- WMS STOCKA - Esquema y Migración: Soporte para 'Recepción Parcial' en Declaraciones de Ingreso
-- Ejecutar en el SQL Editor de Supabase

-- 1. Actualizar restricción CHECK en stock_declarations para incluir 'Recepción Parcial'
ALTER TABLE public.stock_declarations DROP CONSTRAINT IF EXISTS stock_declarations_status_check;

ALTER TABLE public.stock_declarations ADD CONSTRAINT stock_declarations_status_check 
  CHECK (status IN (
    'Creada', 
    'Bodega Asignada', 
    'En Recepción - Pendiente Conteo', 
    'En proceso de conteo/clasificación', 
    'Recepción Parcial', 
    'Recibido Conforme', 
    'Recibido con Incidencias'
  ));

-- 2. Asegurar que las políticas RLS permitan a los comercios visualizar sus ingresos en Recepción Parcial
DROP POLICY IF EXISTS "Clientes ven sus declaraciones" ON public.stock_declarations;
CREATE POLICY "Clientes ven sus declaraciones" ON public.stock_declarations
  FOR SELECT
  USING (
    auth.uid() = merchant_id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND stock_declarations.comercio = ANY (
          SELECT trim(both ' ' from unnest(string_to_array(p.comercio, ',')))
        )
    )
  );

-- 3. Notificación de éxito
DO $$
BEGIN
  RAISE NOTICE 'Constraint de estados de stock_declarations actualizado exitosamente con soporte para Recepción Parcial.';
END $$;
