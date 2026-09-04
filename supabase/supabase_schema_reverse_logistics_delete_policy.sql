-- WMS STOCKA - Habilitar política DELETE para la tabla reverse_logistics
-- Permite que los administradores (comercio = 'all') y usuarios con acceso puedan eliminar registros.
-- Ejecuta este script en el Editor SQL de Supabase:
-- https://supabase.com/dashboard/project/ejtjfaucnxbikrwjwwdu/sql/new

DROP POLICY IF EXISTS "Usuarios pueden eliminar devoluciones de su comercio" ON public.reverse_logistics;

CREATE POLICY "Usuarios pueden eliminar devoluciones de su comercio" ON public.reverse_logistics
  FOR DELETE USING (
    public.check_user_commerce(comercio)
  );
