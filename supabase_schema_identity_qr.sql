-- WMS STOCKA - Sistema de Tarjetas Virtuales, Códigos QR Dinámicos y Control de Accesos Futuro

-- 1. Ampliación de la tabla public.profiles para Tarjeta de Presentación Virtual
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS job_title TEXT DEFAULT 'Equipo Stocka';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS work_phone TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS linkedin_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS whatsapp_number TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio_summary TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS profile_public_enabled BOOLEAN DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_colaborador BOOLEAN DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS public_email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS custom_company TEXT;

-- Marcar automáticamente a los 4 colaboradores oficiales de Stocka
UPDATE public.profiles 
SET is_colaborador = true 
WHERE LOWER(email) IN (
  'felipe.trup@gmail.com',
  'fratruper@gmail.com',
  'kyria.oyarcep@gmail.com',
  'stockachile@gmail.com'
);

-- 2. Crear Tabla public.qr_codes
CREATE TABLE IF NOT EXISTS public.qr_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token VARCHAR(64) UNIQUE NOT NULL,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    type VARCHAR(32) NOT NULL DEFAULT 'vcard' CHECK (type IN ('vcard', 'access_pass', 'action_authorization', 'system_badge')),
    title VARCHAR(120) NOT NULL,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired', 'suspended')),
    expires_at TIMESTAMPTZ,
    allowed_actions JSONB DEFAULT '[]'::jsonb,
    security_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Crear Tabla public.qr_visit_logs (Analítica y registro de escaneos)
CREATE TABLE IF NOT EXISTS public.qr_visit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    qr_code_id UUID NOT NULL REFERENCES public.qr_codes(id) ON DELETE CASCADE,
    user_agent TEXT,
    device_type VARCHAR(20) DEFAULT 'desktop',
    ip_hash TEXT,
    referrer TEXT,
    scanned_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Crear Tabla public.qr_notifications (Notificaciones de aviso interno en perfil Admin)
CREATE TABLE IF NOT EXISTS public.qr_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    qr_code_id UUID REFERENCES public.qr_codes(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Crear Índices de Alto Rendimiento
CREATE INDEX IF NOT EXISTS idx_qr_codes_token ON public.qr_codes(token);
CREATE INDEX IF NOT EXISTS idx_qr_codes_user_id ON public.qr_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_qr_codes_status ON public.qr_codes(status);
CREATE INDEX IF NOT EXISTS idx_qr_visit_logs_qr_id ON public.qr_visit_logs(qr_code_id);
CREATE INDEX IF NOT EXISTS idx_qr_visit_logs_scanned_at ON public.qr_visit_logs(scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_qr_notifications_read ON public.qr_notifications(read, created_at DESC);

-- 6. Otorgar permisos sobre tablas
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qr_codes TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qr_visit_logs TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qr_notifications TO anon, authenticated;

-- 7. Configuración de Políticas Row Level Security (RLS)
ALTER TABLE public.qr_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qr_visit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qr_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Read Active QR Codes" ON public.qr_codes;
CREATE POLICY "Public Read Active QR Codes" ON public.qr_codes 
    FOR SELECT USING (status = 'active' OR auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Public Insert QR Visit Logs" ON public.qr_visit_logs;
CREATE POLICY "Public Insert QR Visit Logs" ON public.qr_visit_logs 
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Public Read Visit Logs for Auth" ON public.qr_visit_logs;
CREATE POLICY "Public Read Visit Logs for Auth" ON public.qr_visit_logs 
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Manage QR Codes Policy" ON public.qr_codes;
CREATE POLICY "Manage QR Codes Policy" ON public.qr_codes 
    FOR ALL USING (true);

DROP POLICY IF EXISTS "Manage QR Notifications Policy" ON public.qr_notifications;
CREATE POLICY "Manage QR Notifications Policy" ON public.qr_notifications 
    FOR ALL USING (true);

-- 8. Función RPC para Validación Futura de Accesos y Autorizaciones mediante QR
CREATE OR REPLACE FUNCTION public.authorize_qr_token(
    p_token TEXT,
    p_required_action TEXT DEFAULT 'vcard'
)
RETURNS JSONB AS $$
DECLARE
    v_qr public.qr_codes%ROWTYPE;
    v_user public.profiles%ROWTYPE;
BEGIN
    SELECT * INTO v_qr FROM public.qr_codes WHERE token = p_token;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'Código QR no encontrado o inválido.');
    END IF;
    
    IF v_qr.status != 'active' THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'El código QR se encuentra inactivo o revocado.');
    END IF;
    
    IF v_qr.expires_at IS NOT NULL AND v_qr.expires_at < now() THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'El código QR ha expirado.');
    END IF;
    
    IF p_required_action != 'vcard' AND NOT (v_qr.allowed_actions @> jsonb_build_array(p_required_action)) THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'El QR no posee permisos para ejecutar esta acción.');
    END IF;
    
    SELECT * INTO v_user FROM public.profiles WHERE id = v_qr.user_id;
    
    RETURN jsonb_build_object(
        'authorized', true,
        'token', v_qr.token,
        'user_id', v_user.id,
        'full_name', v_user.full_name,
        'job_title', v_user.job_title,
        'email', v_user.email,
        'comercio', v_user.comercio,
        'role', v_user.role,
        'type', v_qr.type,
        'allowed_actions', v_qr.allowed_actions
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Política RLS de lectura pública para profiles en Supabase (requerido para lectura anónima desde móviles)
DROP POLICY IF EXISTS "Public Read Profiles for VCard" ON public.profiles;
CREATE POLICY "Public Read Profiles for VCard" ON public.profiles 
FOR SELECT 
TO anon, authenticated 
USING (profile_public_enabled = true OR is_colaborador = true);

GRANT EXECUTE ON FUNCTION public.authorize_qr_token(TEXT, TEXT) TO anon, authenticated;
