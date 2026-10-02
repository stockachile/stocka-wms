-- =========================================================================
-- WMS STOCKA - Esquema y Políticas: Creación de Declaraciones por Admin y Trazabilidad
-- Ejecutar en el SQL Editor de Supabase
-- =========================================================================

-- 1. Agregar columnas de trazabilidad para registrar qué usuario creó la declaración
ALTER TABLE public.stock_declarations ADD COLUMN IF NOT EXISTS created_by_email TEXT;
ALTER TABLE public.stock_declarations ADD COLUMN IF NOT EXISTS created_by_name TEXT;
ALTER TABLE public.stock_declarations ADD COLUMN IF NOT EXISTS created_by_role TEXT;

COMMENT ON COLUMN public.stock_declarations.created_by_email IS 'Correo electrónico del usuario (cliente o admin) que creó la declaración';
COMMENT ON COLUMN public.stock_declarations.created_by_name IS 'Nombre completo o identificador del usuario que creó la declaración';
COMMENT ON COLUMN public.stock_declarations.created_by_role IS 'Rol del creador: admin, client, etc.';

-- 2. Asegurar que los Administradores puedan insertar declaraciones de ingreso para CUALQUIER comercio
DROP POLICY IF EXISTS "Admins crean declaraciones" ON public.stock_declarations;
DROP POLICY IF EXISTS "Admins crean declaraciones" ON stock_declarations;

CREATE POLICY "Admins crean declaraciones" ON public.stock_declarations
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- 3. Asegurar que la política de actualización de admins aplique sin restricciones
DROP POLICY IF EXISTS "Admins actualizan declaraciones" ON public.stock_declarations;
DROP POLICY IF EXISTS "Admins actualizan declaraciones" ON stock_declarations;

CREATE POLICY "Admins actualizan declaraciones" ON public.stock_declarations
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );
