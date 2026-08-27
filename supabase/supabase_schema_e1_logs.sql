-- Tabla para almacenar el historial de correos E1 (Instrucciones de Onboarding) enviados
CREATE TABLE IF NOT EXISTS public.e1_email_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    recipient_email TEXT NOT NULL,
    contact_name TEXT,
    commerce_name TEXT,
    cc_emails TEXT,
    sent_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    message_id TEXT,
    status TEXT DEFAULT 'delivered',
    notes TEXT
);

-- Habilitar RLS en e1_email_logs
ALTER TABLE public.e1_email_logs ENABLE ROW LEVEL SECURITY;

-- Política de lectura para administradores
CREATE POLICY "Admin Select E1 Email Logs"
ON public.e1_email_logs
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
);

-- Política de inserción para usuarios autenticados / servicio
CREATE POLICY "Authenticated Insert E1 Email Logs"
ON public.e1_email_logs
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Política de actualización para administradores
CREATE POLICY "Admin Update E1 Email Logs"
ON public.e1_email_logs
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
);

-- Índice para búsquedas rápidas por destinatario
CREATE INDEX IF NOT EXISTS idx_e1_email_logs_recipient ON public.e1_email_logs(recipient_email);
CREATE INDEX IF NOT EXISTS idx_e1_email_logs_sent_at ON public.e1_email_logs(sent_at DESC);
