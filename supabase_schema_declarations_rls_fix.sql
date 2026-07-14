-- Migración: Corrección de Políticas RLS para Declaraciones de Ingreso de Stock
-- Ejecutar en el editor SQL de Supabase

-- 1. Habilitar RLS en la tabla
ALTER TABLE public.stock_declarations ENABLE ROW LEVEL SECURITY;

-- 2. Eliminar cualquier política de selección anterior
DROP POLICY IF EXISTS "Clientes ven sus declaraciones" ON public.stock_declarations;
DROP POLICY IF EXISTS "Clientes ven sus declaraciones" ON stock_declarations;
DROP POLICY IF EXISTS "Clientes ven sus declaraciones activas" ON public.stock_declarations;
DROP POLICY IF EXISTS "Clientes ven sus declaraciones activas" ON stock_declarations;
DROP POLICY IF EXISTS "Clientes ven declaraciones" ON public.stock_declarations;
DROP POLICY IF EXISTS "Clientes ven declaraciones" ON stock_declarations;

-- 3. Crear la política definitiva que permite a clientes ver sus propias declaraciones
-- O aquellas pertenecientes a los comercios a los que tienen acceso asignado en su perfil.
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

-- 4. Asegurar política de inserción limpia para el cliente
DROP POLICY IF EXISTS "Clientes crean sus declaraciones" ON public.stock_declarations;
DROP POLICY IF EXISTS "Clientes crean sus declaraciones" ON stock_declarations;
CREATE POLICY "Clientes crean sus declaraciones" ON public.stock_declarations
  FOR INSERT
  WITH CHECK (auth.uid() = merchant_id);

-- 5. Clientes pueden actualizar sus propias declaraciones o las de los comercios asignados
-- siempre que no hayan sido recibidas/finalizadas.
DROP POLICY IF EXISTS "Clientes actualizan sus declaraciones" ON public.stock_declarations;
DROP POLICY IF EXISTS "Clientes actualizan sus declaraciones" ON stock_declarations;
CREATE POLICY "Clientes actualizan sus declaraciones" ON public.stock_declarations
  FOR UPDATE
  USING (
    (
      auth.uid() = merchant_id
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND stock_declarations.comercio = ANY (
            SELECT trim(both ' ' from unnest(string_to_array(p.comercio, ',')))
          )
      )
    )
    AND status NOT IN ('Recibido Conforme', 'Recibido con Incidencias')
  );
