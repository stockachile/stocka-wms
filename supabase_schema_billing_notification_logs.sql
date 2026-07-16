-- WMS STOCKA - Historial de Notificaciones de Facturación
-- Ejecutar en el SQL Editor de Supabase

-- 1. Crear tabla de logs de notificaciones
CREATE TABLE IF NOT EXISTS public.billing_notification_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    record_id UUID REFERENCES public.billing_records(id) ON DELETE SET NULL,
    comercio TEXT NOT NULL,
    periodo_nombre TEXT NOT NULL DEFAULT 'General',
    email_type TEXT NOT NULL, -- 'billing_summary', 'invoice_uploaded', 'suspension_warning', 'payment_overdue', 'service_paused', 'service_restored', 'payment_received'
    sent_to TEXT[] NOT NULL DEFAULT '{}'::text[],
    sent_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar RLS
ALTER TABLE public.billing_notification_logs ENABLE ROW LEVEL SECURITY;

-- Admins pueden gestionar todo el historial
DROP POLICY IF EXISTS "Admins gestionan logs de notificaciones" ON public.billing_notification_logs;
CREATE POLICY "Admins gestionan logs de notificaciones" ON public.billing_notification_logs 
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
    );

GRANT ALL ON public.billing_notification_logs TO postgres, service_role;
GRANT SELECT ON public.billing_notification_logs TO authenticated;

-- 2. Retroalimentar con registros históricos existentes
-- A) Para avisos de plazo vencido que ya fueron enviados
INSERT INTO public.billing_notification_logs (record_id, comercio, periodo_nombre, email_type, sent_to, sent_at)
SELECT 
    r.id as record_id,
    r.comercio,
    COALESCE(p.name, 'Periodo Anterior') as periodo_nombre,
    'payment_overdue' as email_type,
    ARRAY[COALESCE(c.email, 'cliente@stocka.cl')]::text[] as sent_to,
    COALESCE(r.last_notified_at, r.updated_at) as sent_at
FROM public.billing_records r
LEFT JOIN public.billing_periods p ON r.period_id = p.id
LEFT JOIN LATERAL (
    SELECT email FROM public.billing_contacts WHERE billing_contacts.comercio = r.comercio AND billing_contacts.activo = true LIMIT 1
) c ON true
WHERE r.overdue_notified = true
ON CONFLICT DO NOTHING;

-- B) Para correos de pago recibido ya enviados desde la cola
INSERT INTO public.billing_notification_logs (record_id, comercio, periodo_nombre, email_type, sent_to, sent_at)
SELECT 
    q.record_id,
    r.comercio,
    COALESCE(p.name, 'Periodo Anterior') as periodo_nombre,
    'payment_received' as email_type,
    ARRAY[COALESCE(c.email, 'cliente@stocka.cl')]::text[] as sent_to,
    q.sent_at
FROM public.billing_email_queue q
JOIN public.billing_records r ON q.record_id = r.id
LEFT JOIN public.billing_periods p ON r.period_id = p.id
LEFT JOIN LATERAL (
    SELECT email FROM public.billing_contacts WHERE billing_contacts.comercio = r.comercio AND billing_contacts.activo = true LIMIT 1
) c ON true
WHERE q.sent_at IS NOT NULL
ON CONFLICT DO NOTHING;
