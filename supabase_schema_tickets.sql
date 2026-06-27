-- WMS STOCKA - Tablas de Tickets, Soporte y Triggers de Notificación

-- 1. Crear Tabla de Tickets (relacionada con public.profiles)
CREATE TABLE IF NOT EXISTS public.tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL, -- Clave foránea a profiles
  comercio TEXT DEFAULT 'no asignado',
  subject VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL, -- 'facturacion', 'incidencia', 'pedidos', 'otros'
  priority VARCHAR(50) DEFAULT 'media' CHECK (priority IN ('baja', 'media', 'alta', 'urgente')),
  status VARCHAR(50) DEFAULT 'abierto' CHECK (status IN ('abierto', 'en_proceso', 'resuelto', 'cerrado')),
  description TEXT NOT NULL,
  order_id VARCHAR(255), -- ID de pedido referenciado (opcional)
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL -- Administrador asignado
);

-- 2. Crear Tabla de Mensajes / Conversaciones de Tickets (relacionada con public.profiles)
CREATE TABLE IF NOT EXISTS public.ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  sender_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL, -- Clave foránea a profiles
  message TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT false NOT NULL -- Notas internas exclusivas para admins
);

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;

-- 3. Políticas RLS para la tabla tickets
DROP POLICY IF EXISTS "Admins ven todos los tickets" ON public.tickets;
CREATE POLICY "Admins ven todos los tickets" ON public.tickets
  FOR ALL USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

DROP POLICY IF EXISTS "Clientes ven sus propios tickets" ON public.tickets;
CREATE POLICY "Clientes ven sus propios tickets" ON public.tickets
  FOR SELECT USING (
    user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Clientes crean sus propios tickets" ON public.tickets;
CREATE POLICY "Clientes crean sus propios tickets" ON public.tickets
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('client', 'observer')
  );

DROP POLICY IF EXISTS "Clientes actualizan sus propios tickets para cerrarlos" ON public.tickets;
CREATE POLICY "Clientes actualizan sus propios tickets para cerrarlos" ON public.tickets
  FOR UPDATE USING (
    user_id = auth.uid()
  ) WITH CHECK (
    user_id = auth.uid() AND status = 'cerrado'
  );


-- 4. Políticas RLS para la tabla ticket_messages
DROP POLICY IF EXISTS "Admins ven todos los mensajes" ON public.ticket_messages;
CREATE POLICY "Admins ven todos los mensajes" ON public.ticket_messages
  FOR ALL USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

DROP POLICY IF EXISTS "Clientes ven mensajes no internos de sus tickets" ON public.ticket_messages;
CREATE POLICY "Clientes ven mensajes no internos de sus tickets" ON public.ticket_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tickets
      WHERE tickets.id = ticket_messages.ticket_id AND tickets.user_id = auth.uid()
    ) AND NOT is_internal
  );

DROP POLICY IF EXISTS "Clientes envían mensajes a sus tickets" ON public.ticket_messages;
CREATE POLICY "Clientes envían mensajes a sus tickets" ON public.ticket_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.tickets
      WHERE tickets.id = ticket_messages.ticket_id AND tickets.user_id = auth.uid()
    ) AND NOT is_internal
  );


-- 5. Disparadores (Triggers) y Funciones

-- A) Trigger para actualizar timestamp updated_at del Ticket
CREATE OR REPLACE FUNCTION public.handle_ticket_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_handle_ticket_update ON public.tickets;
CREATE TRIGGER trigger_handle_ticket_update
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.handle_ticket_update();


-- B) Trigger para notificar al Admin cuando se crea un Ticket
CREATE OR REPLACE FUNCTION public.handle_ticket_insert_notification()
RETURNS TRIGGER AS $$
DECLARE
  v_company_name TEXT;
BEGIN
  SELECT company_name INTO v_company_name FROM public.profiles WHERE id = NEW.user_id;

  INSERT INTO public.dashboard_notifications (user_id, target_role, title, message, is_read, created_at)
  VALUES (
    NULL,
    'admin',
    'Nuevo Ticket: ' || NEW.subject,
    'El cliente "' || COALESCE(v_company_name, 'Sin Nombre') || '" ha abierto un caso en la categoría "' || NEW.category || '".',
    false,
    now()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_ticket_insert_notification ON public.tickets;
CREATE TRIGGER trigger_ticket_insert_notification
  AFTER INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.handle_ticket_insert_notification();


-- C) Trigger para notificar al cliente o al administrador asignado cuando se añade un mensaje
CREATE OR REPLACE FUNCTION public.handle_message_insert_notification()
RETURNS TRIGGER AS $$
DECLARE
  v_sender_role TEXT;
  v_sender_name TEXT;
  v_ticket_owner UUID;
  v_assigned_to UUID;
  v_subject TEXT;
BEGIN
  -- Si el mensaje es una nota interna, no notificar al cliente
  IF NEW.is_internal THEN
    RETURN NEW;
  END IF;

  -- Obtener info del remitente
  SELECT role, full_name INTO v_sender_role, v_sender_name FROM public.profiles WHERE id = NEW.sender_id;
  -- Obtener info del ticket
  SELECT user_id, assigned_to, subject INTO v_ticket_owner, v_assigned_to, v_subject FROM public.tickets WHERE id = NEW.ticket_id;

  IF v_sender_role = 'admin' THEN
    -- Notificar al cliente
    INSERT INTO public.dashboard_notifications (user_id, target_role, title, message, is_read, created_at)
    VALUES (
      v_ticket_owner,
      'client',
      'Nueva respuesta en ticket: ' || v_subject,
      'El equipo de soporte ha respondido a tu caso: "' || SUBSTRING(NEW.message FROM 1 FOR 65) || '..."',
      false,
      now()
    );
  ELSE
    -- Notificar al admin asignado o a todos los admins
    IF v_assigned_to IS NOT NULL THEN
      INSERT INTO public.dashboard_notifications (user_id, target_role, title, message, is_read, created_at)
      VALUES (
        v_assigned_to,
        'admin',
        'Nueva respuesta en ticket asignado: ' || v_subject,
        COALESCE(v_sender_name, 'El cliente') || ' respondió: "' || SUBSTRING(NEW.message FROM 1 FOR 65) || '..."',
        false,
        now()
      );
    ELSE
      INSERT INTO public.dashboard_notifications (user_id, target_role, title, message, is_read, created_at)
      VALUES (
        NULL,
        'admin',
        'Nueva respuesta en ticket sin asignar: ' || v_subject,
        COALESCE(v_sender_name, 'El cliente') || ' respondió: "' || SUBSTRING(NEW.message FROM 1 FOR 65) || '..."',
        false,
        now()
      );
    END IF;
  END IF;

  -- Actualizar la fecha de modificación del ticket padre
  UPDATE public.tickets SET updated_at = now() WHERE id = NEW.ticket_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_message_insert_notification ON public.ticket_messages;
CREATE TRIGGER trigger_message_insert_notification
  AFTER INSERT ON public.ticket_messages
  FOR EACH ROW EXECUTE FUNCTION public.handle_message_insert_notification();
