-- WMS STOCKA - Configuración de Notificaciones Automáticas por Usuario
-- Ejecutar en el SQL Editor de Supabase

-- 1. Crear la Tabla de Configuración de Notificaciones
CREATE TABLE IF NOT EXISTS public.notification_settings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    notify_out_of_stock BOOLEAN NOT NULL DEFAULT false,
    
    report_critical_stock BOOLEAN NOT NULL DEFAULT false,
    report_critical_stock_frequency INTEGER NOT NULL DEFAULT 7 CHECK (report_critical_stock_frequency IN (7, 14, 28)),
    report_critical_stock_day INTEGER NOT NULL DEFAULT 1 CHECK (report_critical_stock_day BETWEEN 1 AND 7),
    
    notify_incidents BOOLEAN NOT NULL DEFAULT false,
    
    notify_volume_levels BOOLEAN NOT NULL DEFAULT false,
    volume_min_level NUMERIC DEFAULT NULL,
    volume_max_level NUMERIC DEFAULT NULL,
    
    report_weekly_sales BOOLEAN NOT NULL DEFAULT false,
    report_monthly_activity BOOLEAN NOT NULL DEFAULT false,
    
    notify_order_no_stock BOOLEAN NOT NULL DEFAULT false,
    order_no_stock_timing TEXT NOT NULL DEFAULT 'instant' CHECK (order_no_stock_timing IN ('instant', 'daily')),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 2. Habilitar RLS (Row Level Security)
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

-- 3. Crear Políticas de Acceso
-- Cada usuario puede gestionar (leer/escribir) únicamente su propia fila de configuración
DROP POLICY IF EXISTS "Los usuarios pueden leer su propia configuración de notificaciones" ON public.notification_settings;
CREATE POLICY "Los usuarios pueden leer su propia configuración de notificaciones" ON public.notification_settings
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Los usuarios pueden actualizar/insertar su propia configuración de notificaciones" ON public.notification_settings;
CREATE POLICY "Los usuarios pueden actualizar/insertar su propia configuración de notificaciones" ON public.notification_settings
    FOR ALL USING (auth.uid() = user_id);

-- 4. Otorgar Permisos de Acceso a Roles de Supabase
GRANT ALL ON public.notification_settings TO postgres, service_role;
GRANT ALL ON public.notification_settings TO anon, authenticated;

-- Trigger para actualizar automaticamente updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = TIMEZONE('utc', NOW());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_notification_settings_updated_at ON public.notification_settings;
CREATE TRIGGER tr_notification_settings_updated_at
    BEFORE UPDATE ON public.notification_settings
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
