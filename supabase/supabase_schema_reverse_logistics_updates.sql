-- 1. Agregar columna de estado a reverse_logistics
ALTER TABLE public.reverse_logistics ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pendiente';

-- 2. Habilitar inserción para clientes y admins
DROP POLICY IF EXISTS "Usuarios pueden insertar devoluciones de su comercio" ON public.reverse_logistics;
CREATE POLICY "Usuarios pueden insertar devoluciones de su comercio" ON public.reverse_logistics
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(reverse_logistics.comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );

-- 3. Habilitar actualización para clientes y admins (requerido para procesar/confirmar)
DROP POLICY IF EXISTS "Usuarios pueden actualizar devoluciones de su comercio" ON public.reverse_logistics;
CREATE POLICY "Usuarios pueden actualizar devoluciones de su comercio" ON public.reverse_logistics
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(reverse_logistics.comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(reverse_logistics.comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );
