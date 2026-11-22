-- =========================================================================
-- SQL Migration: Soporte nativo de Borradores en Comunicaciones WMS
-- =========================================================================
-- Agrega columna `status` ('draft' | 'published') a noticias, eventos y
-- notificaciones, y refuerza políticas RLS para que solo admins vean borradores.
-- Nota: El frontend también codifica target_role = 'draft:<rol>' como capa de
-- seguridad compatible con las políticas RLS actuales incluso antes de correr
-- esta migración.
-- =========================================================================

ALTER TABLE public.dashboard_news
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'published' NOT NULL;

ALTER TABLE public.dashboard_events
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'published' NOT NULL;

ALTER TABLE public.dashboard_notifications
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'published' NOT NULL;

-- Reforzar RLS de lectura en dashboard_news
DROP POLICY IF EXISTS "Todos pueden ver noticias según rol" ON public.dashboard_news;
CREATE POLICY "Todos pueden ver noticias según rol" ON public.dashboard_news
  FOR SELECT USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
    OR (
      status = 'published'
      AND target_role NOT LIKE 'draft:%'
      AND (
        target_role = 'all' OR
        target_role = (SELECT role FROM public.profiles WHERE id = auth.uid())
      )
    )
  );

-- Reforzar RLS de lectura en dashboard_events
DROP POLICY IF EXISTS "Todos pueden ver eventos según rol" ON public.dashboard_events;
CREATE POLICY "Todos pueden ver eventos según rol" ON public.dashboard_events
  FOR SELECT USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
    OR (
      status = 'published'
      AND target_role NOT LIKE 'draft:%'
      AND (
        target_role = 'all' OR
        target_role = (SELECT role FROM public.profiles WHERE id = auth.uid())
      )
    )
  );

-- Reforzar RLS de lectura en dashboard_notifications
DROP POLICY IF EXISTS "Usuarios ven sus notificaciones o las generales" ON public.dashboard_notifications;
CREATE POLICY "Usuarios ven sus notificaciones o las generales" ON public.dashboard_notifications
  FOR SELECT USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
    OR (
      status = 'published'
      AND target_role NOT LIKE 'draft:%'
      AND created_at <= timezone('utc'::text, now())
      AND (
        user_id = auth.uid() OR
        (user_id IS NULL AND (target_role = 'all' OR target_role = (SELECT role FROM public.profiles WHERE id = auth.uid())))
      )
    )
  );
