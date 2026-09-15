-- ==============================================================================
-- WMS STOCKA - MÓDULO DE ENCUESTAS, REVIEWS Y SATISFACCIÓN (SUPABASE SCHEMA)
-- ==============================================================================
-- Ejecutar este script en el SQL Editor de Supabase (Dashboard -> SQL Editor)

-- 1. Crear Tabla de Encuestas (public.surveys)
CREATE TABLE IF NOT EXISTS public.surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(50) DEFAULT 'satisfaction' CHECK (category IN ('satisfaction', 'review', 'onboarding', 'operational', 'custom')),
  status VARCHAR(30) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
  target_type VARCHAR(50) DEFAULT 'all' CHECK (target_type IN ('all', 'specific_merchants', 'specific_users', 'public_link')),
  target_merchants JSONB DEFAULT '[]'::jsonb, -- Array de nombres o siglas de comercios
  target_users JSONB DEFAULT '[]'::jsonb,      -- Array de IDs o correos de usuarios
  public_token VARCHAR(64) UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  pages JSONB NOT NULL DEFAULT '[]'::jsonb,   -- Estructura de páginas y bloques de preguntas
  settings JSONB DEFAULT '{
    "allow_anonymous": false,
    "show_progress_bar": true,
    "submit_button_text": "Enviar Encuesta",
    "success_title": "¡Muchas gracias!",
    "success_message": "Tus respuestas han sido recibidas y nos ayudan a seguir mejorando nuestro servicio.",
    "estimated_minutes": 2
  }'::jsonb,
  expires_at TIMESTAMP WITH TIME ZONE NULL,
  is_active BOOLEAN DEFAULT true NOT NULL
);

-- 2. Crear Tabla de Respuestas (public.survey_responses)
CREATE TABLE IF NOT EXISTS public.survey_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  survey_id UUID REFERENCES public.surveys(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  comercio TEXT DEFAULT 'no asignado',
  user_email TEXT,
  user_name TEXT,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb, -- Mapa clave-valor: { [block_id]: respuesta }
  rating_score NUMERIC(4,2) NULL,             -- Calificación promedio calculada (ej. 4.50)
  nps_score INTEGER NULL CHECK (nps_score BETWEEN 0 AND 10), -- NPS Score (0-10)
  nps_category VARCHAR(20) NULL CHECK (nps_category IN ('promoter', 'passive', 'detractor')),
  source VARCHAR(50) DEFAULT 'dashboard' CHECK (source IN ('dashboard', 'public_link', 'direct_url')),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- 3. Índices para acelerar consultas y métricas
CREATE INDEX IF NOT EXISTS idx_surveys_status ON public.surveys(status);
CREATE INDEX IF NOT EXISTS idx_surveys_category ON public.surveys(category);
CREATE INDEX IF NOT EXISTS idx_surveys_public_token ON public.surveys(public_token);
CREATE INDEX IF NOT EXISTS idx_survey_responses_survey_id ON public.survey_responses(survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_user_id ON public.survey_responses(user_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_comercio ON public.survey_responses(comercio);
CREATE INDEX IF NOT EXISTS idx_survey_responses_completed_at ON public.survey_responses(completed_at);

-- 4. Trigger automático para actualizar updated_at en surveys
CREATE OR REPLACE FUNCTION public.handle_survey_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_surveys_updated_at ON public.surveys;
CREATE TRIGGER tr_surveys_updated_at
  BEFORE UPDATE ON public.surveys
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_survey_updated_at();

-- 5. Habilitar Row Level Security (RLS)
ALTER TABLE public.surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;

-- 6. Políticas RLS para public.surveys
-- Admins: control total
DROP POLICY IF EXISTS "Admins gestionan todas las encuestas" ON public.surveys;
CREATE POLICY "Admins gestionan todas las encuestas" ON public.surveys
  FOR ALL USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

-- Clientes autenticados: pueden leer encuestas publicadas dirigidas a ellos
DROP POLICY IF EXISTS "Clientes ven encuestas asignadas" ON public.surveys;
CREATE POLICY "Clientes ven encuestas asignadas" ON public.surveys
  FOR SELECT USING (
    status = 'published' AND is_active = true AND (
      target_type = 'all'
      OR target_type = 'public_link'
      OR (
        target_type = 'specific_merchants' AND
        EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid()
          AND (
            target_merchants ? p.comercio
            OR target_merchants ? lower(p.comercio)
          )
        )
      )
      OR (
        target_type = 'specific_users' AND (
          target_users ? auth.uid()::text
          OR EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND (target_users ? p.email OR target_users ? lower(p.email))
          )
        )
      )
    )
  );

-- Anónimos / Públicos: pueden leer encuestas publicadas por token o públicas
DROP POLICY IF EXISTS "Publico puede ver encuestas publicadas" ON public.surveys;
CREATE POLICY "Publico puede ver encuestas publicadas" ON public.surveys
  FOR SELECT TO anon
  USING (
    status = 'published' AND is_active = true
  );

-- 7. Políticas RLS para public.survey_responses
-- Admins: control total sobre las respuestas
DROP POLICY IF EXISTS "Admins ven todas las respuestas" ON public.survey_responses;
CREATE POLICY "Admins ven todas las respuestas" ON public.survey_responses
  FOR ALL USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

-- Clientes autenticados: pueden insertar sus respuestas y ver las que ya enviaron
DROP POLICY IF EXISTS "Usuarios insertan sus respuestas" ON public.survey_responses;
CREATE POLICY "Usuarios insertan sus respuestas" ON public.survey_responses
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL AND (user_id = auth.uid() OR user_id IS NULL)
  );

DROP POLICY IF EXISTS "Usuarios ven sus propias respuestas" ON public.survey_responses;
CREATE POLICY "Usuarios ven sus propias respuestas" ON public.survey_responses
  FOR SELECT USING (
    auth.uid() IS NOT NULL AND (
      user_id = auth.uid()
      OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
    )
  );

-- Anónimos / Enlace externo: pueden enviar respuestas a encuestas públicas
DROP POLICY IF EXISTS "Anonimos insertan respuestas publicas" ON public.survey_responses;
CREATE POLICY "Anonimos insertan respuestas publicas" ON public.survey_responses
  FOR INSERT TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.surveys s
      WHERE s.id = survey_id
        AND s.status = 'published'
        AND s.is_active = true
    )
  );

-- 8. Otorgar permisos a roles de Supabase
GRANT ALL ON public.surveys TO postgres, service_role;
GRANT SELECT ON public.surveys TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.surveys TO authenticated;

GRANT ALL ON public.survey_responses TO postgres, service_role;
GRANT SELECT, INSERT ON public.survey_responses TO authenticated;
GRANT INSERT ON public.survey_responses TO anon;
