-- ========================================================
-- WMS STOCKA: ACTUALIZACIÓN CALENDARIO, FERIADOS Y GOOGLE CALENDAR
-- ========================================================

-- 1. Agregar columnas a dashboard_events para tipificación y sincronización
DO $$ 
BEGIN
  -- Tipo de evento / clasificación operativa ('general', 'holiday', 'non_operational')
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dashboard_events' AND column_name = 'event_type') THEN
    ALTER TABLE dashboard_events ADD COLUMN event_type VARCHAR(50) DEFAULT 'general';
  END IF;

  -- Indicador explícito si el día es no operativo para el WMS
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dashboard_events' AND column_name = 'is_non_operational') THEN
    ALTER TABLE dashboard_events ADD COLUMN is_non_operational BOOLEAN DEFAULT false;
  END IF;

  -- Indicador de feriado oficial
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dashboard_events' AND column_name = 'is_holiday') THEN
    ALTER TABLE dashboard_events ADD COLUMN is_holiday BOOLEAN DEFAULT false;
  END IF;

  -- Pausar bot de WhatsApp en esta fecha
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dashboard_events' AND column_name = 'pause_whatsapp_bot') THEN
    ALTER TABLE dashboard_events ADD COLUMN pause_whatsapp_bot BOOLEAN DEFAULT true;
  END IF;

  -- ID del evento creado en Google Calendar
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dashboard_events' AND column_name = 'gcal_event_id') THEN
    ALTER TABLE dashboard_events ADD COLUMN gcal_event_id TEXT DEFAULT NULL;
  END IF;

  -- Estado de sincronización con Google Calendar
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dashboard_events' AND column_name = 'google_synced') THEN
    ALTER TABLE dashboard_events ADD COLUMN google_synced BOOLEAN DEFAULT false;
  END IF;
END $$;

-- 2. Actualizar eventos históricos para marcarlos como feriados / no operativos según su título
UPDATE dashboard_events
SET 
  event_type = CASE 
    WHEN LOWER(title) LIKE '%feriado%' THEN 'holiday'
    WHEN LOWER(title) LIKE '%sin operacion%' THEN 'non_operational'
    ELSE COALESCE(event_type, 'general')
  END,
  is_non_operational = CASE
    WHEN LOWER(title) LIKE '%sin operacion%' OR LOWER(title) LIKE '%feriado%' THEN true
    ELSE COALESCE(is_non_operational, false)
  END,
  is_holiday = CASE
    WHEN LOWER(title) LIKE '%feriado%' THEN true
    ELSE COALESCE(is_holiday, false)
  END,
  pause_whatsapp_bot = CASE
    WHEN LOWER(title) LIKE '%sin operacion%' OR LOWER(title) LIKE '%feriado%' THEN true
    ELSE COALESCE(pause_whatsapp_bot, true)
  END
WHERE event_type IS NULL OR event_type = 'general';

-- 3. Tabla para almacenar credenciales y configuración de Google Calendar
CREATE TABLE IF NOT EXISTS calendar_integration_settings (
  id VARCHAR(50) PRIMARY KEY DEFAULT 'default',
  google_client_id TEXT,
  google_calendar_id TEXT DEFAULT 'primary',
  auto_sync_gcal BOOLEAN DEFAULT true,
  auto_pause_whatsapp BOOLEAN DEFAULT true,
  bot_out_of_office_message TEXT DEFAULT 'Hola, te escribe Stox de Stocka WMS. Hoy nuestras operaciones se encuentran cerradas por feriado/día no operativo. Retomaremos la atención habitual en el próximo día hábil.',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Políticas RLS para calendar_integration_settings
ALTER TABLE calendar_integration_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Todos autenticados pueden ver configuración calendario" ON calendar_integration_settings;
CREATE POLICY "Todos autenticados pueden ver configuración calendario" ON calendar_integration_settings
  FOR SELECT USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admins pueden modificar configuración calendario" ON calendar_integration_settings;
CREATE POLICY "Admins pueden modificar configuración calendario" ON calendar_integration_settings
  FOR ALL USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin' OR auth.role() = 'service_role');

-- Insertar fila de configuración por defecto si no existe
INSERT INTO calendar_integration_settings (id, google_calendar_id, auto_sync_gcal, auto_pause_whatsapp)
VALUES ('default', 'primary', true, true)
ON CONFLICT (id) DO NOTHING;

-- Crear índice para agilizar consultas por fecha
CREATE INDEX IF NOT EXISTS idx_dashboard_events_date_type ON dashboard_events(event_date, event_type, is_non_operational);
