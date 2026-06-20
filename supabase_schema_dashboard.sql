-- Tabla para Eventos del Calendario
CREATE TABLE dashboard_events (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  event_date TIMESTAMP WITH TIME ZONE NOT NULL,
  color_type VARCHAR(50) DEFAULT 'info', -- 'success', 'warning', 'danger', 'info'
  target_role VARCHAR(50) DEFAULT 'all', -- 'all', 'client', 'admin', 'observer'
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Tabla para Noticias
CREATE TABLE dashboard_news (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  subtitle VARCHAR(255),
  body TEXT NOT NULL,
  target_role VARCHAR(50) DEFAULT 'all', -- 'all', 'client', 'admin', 'observer'
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Tabla para Notificaciones
CREATE TABLE dashboard_notifications (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id), -- Puede ser NULL si es para todos
  target_role VARCHAR(50) DEFAULT 'all', -- 'all', 'client', 'admin', 'observer' (usado si user_id es null)
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Políticas de Seguridad RLS
ALTER TABLE dashboard_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_news ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_notifications ENABLE ROW LEVEL SECURITY;

-- Políticas Eventos (Todos pueden ver, solo admin crea)
CREATE POLICY "Todos pueden ver eventos según rol" ON dashboard_events
  FOR SELECT USING (
    target_role = 'all' OR 
    target_role = (SELECT role FROM profiles WHERE id = auth.uid()) OR
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Admins pueden gestionar eventos" ON dashboard_events
  FOR ALL USING ( (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin' );

-- Políticas Noticias
CREATE POLICY "Todos pueden ver noticias según rol" ON dashboard_news
  FOR SELECT USING (
    target_role = 'all' OR 
    target_role = (SELECT role FROM profiles WHERE id = auth.uid()) OR
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Admins pueden gestionar noticias" ON dashboard_news
  FOR ALL USING ( (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin' );

-- Políticas Notificaciones
CREATE POLICY "Usuarios ven sus notificaciones o las generales" ON dashboard_notifications
  FOR SELECT USING (
    user_id = auth.uid() OR 
    (user_id IS NULL AND (target_role = 'all' OR target_role = (SELECT role FROM profiles WHERE id = auth.uid()))) OR
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Admins pueden gestionar notificaciones" ON dashboard_notifications
  FOR ALL USING ( (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin' );
  
-- Política para que el usuario pueda marcar como leída su notificación (UPDATE)
CREATE POLICY "Usuarios pueden actualizar sus propias notificaciones" ON dashboard_notifications
  FOR UPDATE USING (
    user_id = auth.uid()
  );
