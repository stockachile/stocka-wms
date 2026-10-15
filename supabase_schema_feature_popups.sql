-- =========================================================================
-- SQL Migration Script: Popup Inferior Derecho de Nuevas Funcionalidades (Feature Dock)
-- =========================================================================
-- INSTRUCCIONES:
-- Copia todo este contenido y ejecútalo en el SQL Editor de tu consola de Supabase:
-- (https://supabase.com/dashboard/project/ejtjfaucnxbikrwjwwdu/sql/new)
-- =========================================================================

-- 1. Crear tabla principal para los Popups de Nuevas Funcionalidades (Feature Dock)
CREATE TABLE IF NOT EXISTS public.wms_feature_popups (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  subtitle VARCHAR(255),
  change_type VARCHAR(50) DEFAULT 'new_feature' NOT NULL, -- 'new_feature', 'improvement', 'fix', 'integration'
  module_key VARCHAR(100) NOT NULL,                       -- 'dashboard', 'inventory', 'orders', 'manifests', etc.
  module_label VARCHAR(100) NOT NULL,                     -- Nombre visible del módulo
  target_module VARCHAR(100) DEFAULT 'none',              -- data-view del módulo al que redirige el botón ('none' si no redirige)
  cta_text VARCHAR(120) DEFAULT 'Ir al módulo',           -- Texto personalizado del botón de redirección
  media_url TEXT,                                         -- URL de imagen o GIF representativo
  description TEXT NOT NULL,                              -- Descripción con formato enriquecido (HTML desde Quill)
  target_role VARCHAR(50) DEFAULT 'client',               -- 'client', 'all', 'admin'
  only_allowed_module_users BOOLEAN DEFAULT true,         -- Mostrar solo a clientes con permiso en ese módulo (allowed_modules)
  is_active BOOLEAN DEFAULT true,                         -- Estado activo/inactivo del popup
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Asegurar existencia de tabla de lecturas (user_notification_reads) si no existiera
CREATE TABLE IF NOT EXISTS public.user_notification_reads (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  entity_type VARCHAR(50) NOT NULL, -- 'banner', 'popup', 'news', 'feature_popup', 'feature_popup_click'
  entity_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wms_feature_popups_active ON public.wms_feature_popups(is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_notification_reads_lookup ON public.user_notification_reads(user_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_user_notification_reads_entity ON public.user_notification_reads(entity_type, entity_id);

-- 3. Habilitar Row Level Security (RLS)
ALTER TABLE public.wms_feature_popups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notification_reads ENABLE ROW LEVEL SECURITY;

-- 4. Políticas RLS para wms_feature_popups
DROP POLICY IF EXISTS "Usuarios pueden ver popups de funcionalidades según su rol" ON public.wms_feature_popups;
CREATE POLICY "Usuarios pueden ver popups de funcionalidades según su rol" ON public.wms_feature_popups
  FOR SELECT USING (
    (is_active = true AND (
      target_role = 'all' OR
      target_role = (SELECT role FROM public.profiles WHERE id = auth.uid())
    ))
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

DROP POLICY IF EXISTS "Admins pueden gestionar popups de funcionalidades" ON public.wms_feature_popups;
CREATE POLICY "Admins pueden gestionar popups de funcionalidades" ON public.wms_feature_popups
  FOR ALL USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

-- 5. Políticas RLS para user_notification_reads (lecturas y métricas para admin)
DROP POLICY IF EXISTS "Usuarios pueden ver sus propias lecturas o admins todas" ON public.user_notification_reads;
CREATE POLICY "Usuarios pueden ver sus propias lecturas o admins todas" ON public.user_notification_reads
  FOR SELECT USING (
    user_id = auth.uid() OR
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

DROP POLICY IF EXISTS "Usuarios pueden registrar sus propias lecturas" ON public.user_notification_reads;
CREATE POLICY "Usuarios pueden registrar sus propias lecturas" ON public.user_notification_reads
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
  );

COMMENT ON TABLE public.wms_feature_popups IS 'Popups inferiores derechos para anunciar nuevas funcionalidades y mejoras del WMS con redirección persistente a módulos.';
