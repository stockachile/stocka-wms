-- Tabla para almacenar el historial de correos de Información Comercial y Presentación de Servicios enviados a leads
CREATE TABLE IF NOT EXISTS public.lead_info_email_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    recipient_email TEXT NOT NULL,
    contact_name TEXT,
    commerce_name TEXT,
    cc_emails TEXT,
    subject TEXT,
    sent_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    message_id TEXT,
    status TEXT DEFAULT 'delivered',
    notes TEXT
);

-- Habilitar RLS en lead_info_email_logs
ALTER TABLE public.lead_info_email_logs ENABLE ROW LEVEL SECURITY;

-- Política de lectura para administradores
DROP POLICY IF EXISTS "Admin Select Lead Info Email Logs" ON public.lead_info_email_logs;
CREATE POLICY "Admin Select Lead Info Email Logs"
ON public.lead_info_email_logs
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND (profiles.role = 'admin' OR profiles.role = 'all')
    )
);

-- Política de inserción para usuarios autenticados / servicio
DROP POLICY IF EXISTS "Authenticated Insert Lead Info Email Logs" ON public.lead_info_email_logs;
CREATE POLICY "Authenticated Insert Lead Info Email Logs"
ON public.lead_info_email_logs
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Política de actualización para administradores
DROP POLICY IF EXISTS "Admin Update Lead Info Email Logs" ON public.lead_info_email_logs;
CREATE POLICY "Admin Update Lead Info Email Logs"
ON public.lead_info_email_logs
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND (profiles.role = 'admin' OR profiles.role = 'all')
    )
);

-- Índices para búsquedas rápidas por destinatario y fecha
CREATE INDEX IF NOT EXISTS idx_lead_info_email_logs_recipient ON public.lead_info_email_logs(recipient_email);
CREATE INDEX IF NOT EXISTS idx_lead_info_email_logs_sent_at ON public.lead_info_email_logs(sent_at DESC);
