-- WMS STOCKA - Infraestructura de Notificaciones Web Push (PWA)
-- Fecha: 2026-11-26
-- Incluye:
-- 1. Tabla public.push_subscriptions (suscripciones por usuario y dispositivo con RLS)
-- 2. Tabla public.push_notification_logs (auditoría de envíos Web Push)
-- 3. Columnas de preferencias Push en public.notification_settings
-- 4. Helper async pg_net (dispatch_web_push_async) + Triggers en tickets, ticket_messages e incidencias

-- ============================================================================
-- 1. TABLA: public.push_subscriptions
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  portal TEXT NOT NULL DEFAULT 'client' CHECK (portal IN ('client', 'admin')),
  device_label TEXT,
  user_agent TEXT,
  is_standalone BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_active
  ON public.push_subscriptions(user_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_portal_active
  ON public.push_subscriptions(portal)
  WHERE is_active = true;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users manage own push subscriptions"
  ON public.push_subscriptions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins read push subscription stats" ON public.push_subscriptions;
CREATE POLICY "Admins read push subscription stats"
  ON public.push_subscriptions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

GRANT ALL ON public.push_subscriptions TO postgres, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_push_subscriptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_push_subscriptions_updated_at ON public.push_subscriptions;
CREATE TRIGGER tr_push_subscriptions_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_push_subscriptions_updated_at();

-- ============================================================================
-- 2. TABLA: public.push_notification_logs
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.push_notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL DEFAULT 'general',
  title TEXT NOT NULL,
  body TEXT,
  target_summary TEXT,
  url TEXT,
  attempted_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  expired_cleaned INTEGER NOT NULL DEFAULT 0,
  triggered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_push_notification_logs_created_at
  ON public.push_notification_logs(created_at DESC);

ALTER TABLE public.push_notification_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read push notification logs" ON public.push_notification_logs;
CREATE POLICY "Admins read push notification logs"
  ON public.push_notification_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

GRANT ALL ON public.push_notification_logs TO postgres, service_role;
GRANT SELECT ON public.push_notification_logs TO authenticated;

-- ============================================================================
-- 3. PREFERENCIAS PUSH EN public.notification_settings
-- ============================================================================
ALTER TABLE public.notification_settings
  ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS push_billing BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS push_tickets BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS push_inbounds BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS push_incidents BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS push_stock_alerts BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS push_announcements BOOLEAN NOT NULL DEFAULT true;

-- ============================================================================
-- 4. HELPER ASÍNCRONO pg_net PARA DISPARAR send-web-push DESDE TRIGGERS SQL
-- ============================================================================
CREATE OR REPLACE FUNCTION public.dispatch_web_push_async(p_payload JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'web_push_internal_secret'
  LIMIT 1;

  IF v_secret IS NULL OR TRIM(v_secret) = '' THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://ejtjfaucnxbikrwjwwdu.supabase.co/functions/v1/send-web-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', v_secret
    ),
    body := p_payload,
    timeout_milliseconds := 10000
  );
EXCEPTION WHEN OTHERS THEN
  -- Nunca bloquear transacciones principales de negocio si falla un aviso push
  RAISE WARNING 'dispatch_web_push_async error: %', SQLERRM;
END;
$$;

-- ============================================================================
-- 5. TRIGGERS AUTOMÁTICOS EN TICKETS, MENSAJES DE TICKETS E INCIDENCIAS
-- ============================================================================

-- 5A. Nuevo Ticket -> Push a Administradores
CREATE OR REPLACE FUNCTION public.tr_fn_push_on_ticket_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comercio TEXT;
  v_short_id TEXT;
BEGIN
  v_short_id := LEFT(NEW.id::TEXT, 6);
  v_comercio := COALESCE(NULLIF(TRIM(NEW.comercio), ''), 'Comercio');

  PERFORM public.dispatch_web_push_async(jsonb_build_object(
    'role', 'admin',
    'category', 'tickets',
    'title', '🎫 Nuevo Ticket #' || v_short_id || ' (' || v_comercio || ')',
    'body', LEFT(COALESCE(NEW.subject, 'Nueva consulta de soporte'), 140),
    'url', '/admin/tickets',
    'tag', 'ticket-new-' || NEW.id::TEXT,
    'requireInteraction', (NEW.priority = 'urgente')
  ));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_push_on_ticket_insert ON public.tickets;
CREATE TRIGGER trigger_push_on_ticket_insert
  AFTER INSERT ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.tr_fn_push_on_ticket_insert();

-- 5B. Nuevo Mensaje en Ticket (no interno) -> Push a Cliente o Admin
CREATE OR REPLACE FUNCTION public.tr_fn_push_on_ticket_message_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_role TEXT;
  v_sender_name TEXT;
  v_ticket RECORD;
  v_short_id TEXT;
  v_preview TEXT;
BEGIN
  IF COALESCE(NEW.is_internal, false) = true THEN
    RETURN NEW;
  END IF;

  SELECT role, COALESCE(NULLIF(TRIM(full_name), ''), company_name, email)
    INTO v_sender_role, v_sender_name
  FROM public.profiles
  WHERE id = NEW.sender_id;

  SELECT id, user_id, assigned_to, comercio, subject
    INTO v_ticket
  FROM public.tickets
  WHERE id = NEW.ticket_id;

  IF v_ticket.id IS NULL THEN
    RETURN NEW;
  END IF;

  v_short_id := LEFT(v_ticket.id::TEXT, 6);
  v_preview := LEFT(REGEXP_REPLACE(COALESCE(NEW.message, ''), E'[\\r\\n]+', ' ', 'g'), 140);

  IF v_sender_role = 'admin' THEN
    -- Respuesta de soporte -> Notificar al dueño del ticket (y comercio asociado)
    PERFORM public.dispatch_web_push_async(jsonb_build_object(
      'user_ids', jsonb_build_array(v_ticket.user_id),
      'comercio', CASE WHEN v_ticket.comercio IS NOT NULL AND v_ticket.comercio <> 'no asignado' THEN v_ticket.comercio ELSE NULL END,
      'exclude_user_id', NEW.sender_id,
      'category', 'tickets',
      'title', '💬 Respuesta en Ticket #' || v_short_id,
      'body', COALESCE(v_ticket.subject, 'Soporte Stocka') || ': ' || v_preview,
      'url', '/panel/tickets',
      'tag', 'ticket-reply-' || v_ticket.id::TEXT,
      'renotify', true
    ));
  ELSE
    -- Respuesta de cliente -> Notificar al admin asignado o a todos los admins
    IF v_ticket.assigned_to IS NOT NULL THEN
      PERFORM public.dispatch_web_push_async(jsonb_build_object(
        'user_ids', jsonb_build_array(v_ticket.assigned_to),
        'exclude_user_id', NEW.sender_id,
        'category', 'tickets',
        'title', '💬 Respuesta de ' || COALESCE(NULLIF(TRIM(v_ticket.comercio), ''), v_sender_name, 'Cliente') || ' (#' || v_short_id || ')',
        'body', v_preview,
        'url', '/admin/tickets',
        'tag', 'ticket-client-reply-' || v_ticket.id::TEXT,
        'renotify', true
      ));
    ELSE
      PERFORM public.dispatch_web_push_async(jsonb_build_object(
        'role', 'admin',
        'exclude_user_id', NEW.sender_id,
        'category', 'tickets',
        'title', '💬 Respuesta en Ticket #' || v_short_id || ' (' || COALESCE(NULLIF(TRIM(v_ticket.comercio), ''), 'Cliente') || ')',
        'body', v_preview,
        'url', '/admin/tickets',
        'tag', 'ticket-client-reply-' || v_ticket.id::TEXT,
        'renotify', true
      ));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_push_on_ticket_message_insert ON public.ticket_messages;
CREATE TRIGGER trigger_push_on_ticket_message_insert
  AFTER INSERT ON public.ticket_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.tr_fn_push_on_ticket_message_insert();

-- 5C. Nueva Incidencia -> Push a Cliente / Comercio
CREATE OR REPLACE FUNCTION public.tr_fn_push_on_incidencia_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sev_icon TEXT;
BEGIN
  v_sev_icon := CASE NEW.severity
    WHEN 'critico' THEN '🚨'
    WHEN 'alto' THEN '⚠️'
    ELSE '📋'
  END;

  PERFORM public.dispatch_web_push_async(jsonb_build_object(
    'user_ids', CASE WHEN NEW.user_id IS NOT NULL THEN jsonb_build_array(NEW.user_id) ELSE '[]'::jsonb END,
    'comercio', CASE WHEN NEW.comercio IS NOT NULL AND NEW.comercio <> 'no asignado' THEN NEW.comercio ELSE NULL END,
    'exclude_user_id', NEW.created_by,
    'category', 'incidents',
    'title', v_sev_icon || ' Nueva incidencia en tu operación',
    'body', LEFT(COALESCE(NEW.title, 'Revisa el detalle en el módulo de Incidencias'), 140),
    'url', '/panel/incidencias',
    'tag', 'incidencia-' || NEW.id::TEXT,
    'requireInteraction', (NEW.severity IN ('critico', 'alto'))
  ));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_push_on_incidencia_insert ON public.incidencias;
CREATE TRIGGER trigger_push_on_incidencia_insert
  AFTER INSERT ON public.incidencias
  FOR EACH ROW
  EXECUTE FUNCTION public.tr_fn_push_on_incidencia_insert();
