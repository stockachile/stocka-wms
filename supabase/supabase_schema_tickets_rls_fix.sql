-- WMS STOCKA - SQL Migration to fix RLS Policies for tickets and ticket_messages
-- Refuerzo de aislamiento multitenant por comercio (usando public.check_user_commerce)
--
-- Ejecutar este script en el Editor SQL de Supabase:
-- https://supabase.com/dashboard/project/ejtjfaucnxbikrwjwwdu/sql/new

-- 1. Asegurar que la función check_user_commerce existe
CREATE OR REPLACE FUNCTION public.check_user_commerce(p_comercio TEXT)
RETURNS BOOLEAN SECURITY DEFINER AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND (
        LOWER(profiles.comercio) = 'all'
        OR LOWER(p_comercio) = ANY (
          SELECT TRIM(LOWER(token))
          FROM unnest(string_to_array(profiles.comercio, ',')) AS token
        )
      )
  );
END;
$$ LANGUAGE plpgsql;

-- 2. Actualizar políticas RLS para la tabla public.tickets
DROP POLICY IF EXISTS "Clientes ven sus propios tickets" ON public.tickets;
DROP POLICY IF EXISTS "Clientes ven tickets de su comercio" ON public.tickets;

CREATE POLICY "Clientes ven tickets de su comercio" ON public.tickets
  FOR SELECT USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
    OR public.check_user_commerce(comercio)
    OR (user_id = auth.uid() AND (comercio IS NULL OR comercio = 'no asignado'))
  );

DROP POLICY IF EXISTS "Clientes crean sus propios tickets" ON public.tickets;
CREATE POLICY "Clientes crean sus propios tickets" ON public.tickets
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND
    (
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
      OR public.check_user_commerce(comercio)
      OR (comercio IS NULL OR comercio = 'no asignado')
    )
  );

DROP POLICY IF EXISTS "Clientes actualizan sus propios tickets para cerrarlos" ON public.tickets;
CREATE POLICY "Clientes actualizan sus propios tickets para cerrarlos" ON public.tickets
  FOR UPDATE USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
    OR public.check_user_commerce(comercio)
    OR user_id = auth.uid()
  ) WITH CHECK (
    status = 'cerrado'
  );

-- 3. Actualizar políticas RLS para la tabla public.ticket_messages
DROP POLICY IF EXISTS "Clientes ven mensajes no internos de sus tickets" ON public.ticket_messages;
CREATE POLICY "Clientes ven mensajes no internos de sus tickets" ON public.ticket_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tickets
      WHERE tickets.id = ticket_messages.ticket_id
        AND (
          (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
          OR public.check_user_commerce(tickets.comercio)
          OR tickets.user_id = auth.uid()
        )
    ) AND NOT is_internal
  );

DROP POLICY IF EXISTS "Clientes envían mensajes a sus tickets" ON public.ticket_messages;
CREATE POLICY "Clientes envían mensajes a sus tickets" ON public.ticket_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.tickets
      WHERE tickets.id = ticket_messages.ticket_id
        AND (
          (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
          OR public.check_user_commerce(tickets.comercio)
          OR tickets.user_id = auth.uid()
        )
    ) AND NOT is_internal
  );
