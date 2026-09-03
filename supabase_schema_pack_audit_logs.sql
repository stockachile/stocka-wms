-- ==============================================================================
-- TABLA DE AUDITORÍA Y REGISTRO DE CAMBIOS PARA PACKS / COMBOS DEL CATÁLOGO
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.pack_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pack_product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    pack_sku TEXT,
    pack_name TEXT,
    comercio TEXT NOT NULL,
    user_id UUID,
    user_email TEXT,
    user_name TEXT,
    user_role TEXT DEFAULT 'merchant',
    previous_components JSONB DEFAULT '[]'::jsonb,
    new_components JSONB DEFAULT '[]'::jsonb,
    change_summary TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_pack_audit_logs_pack_id ON public.pack_audit_logs(pack_product_id);
CREATE INDEX IF NOT EXISTS idx_pack_audit_logs_comercio ON public.pack_audit_logs(comercio);
CREATE INDEX IF NOT EXISTS idx_pack_audit_logs_created_at ON public.pack_audit_logs(created_at DESC);

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.pack_audit_logs ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS
DROP POLICY IF EXISTS "Todos los usuarios autenticados pueden ver logs de su comercio" ON public.pack_audit_logs;
CREATE POLICY "Todos los usuarios autenticados pueden ver logs de su comercio"
ON public.pack_audit_logs
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Usuarios autenticados pueden insertar logs de auditoría" ON public.pack_audit_logs;
CREATE POLICY "Usuarios autenticados pueden insertar logs de auditoría"
ON public.pack_audit_logs
FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir acceso completo a service_role" ON public.pack_audit_logs;
CREATE POLICY "Permitir acceso completo a service_role"
ON public.pack_audit_logs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
