-- ==============================================================================
-- WMS STOCKA - FORMULARIO PÚBLICO PLANIFICACIÓN CYBER 2026 (SUPABASE MIGRATION)
-- ==============================================================================
-- Ejecutar este script en el SQL Editor de Supabase (Dashboard -> SQL Editor -> New Query)

-- 1. Asegurar que las tablas de encuestas existen con sus tipos y campos requeridos
CREATE TABLE IF NOT EXISTS public.surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(50) DEFAULT 'operational' CHECK (category IN ('satisfaction', 'review', 'onboarding', 'operational', 'custom')),
  status VARCHAR(30) DEFAULT 'published' CHECK (status IN ('draft', 'published', 'closed')),
  target_type VARCHAR(50) DEFAULT 'all' CHECK (target_type IN ('all', 'specific_merchants', 'specific_users', 'public_link')),
  target_merchants JSONB DEFAULT '[]'::jsonb,
  target_users JSONB DEFAULT '[]'::jsonb,
  public_token VARCHAR(64) UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  pages JSONB NOT NULL DEFAULT '[]'::jsonb,
  settings JSONB DEFAULT '{}'::jsonb,
  expires_at TIMESTAMP WITH TIME ZONE NULL,
  is_active BOOLEAN DEFAULT true NOT NULL
);

CREATE TABLE IF NOT EXISTS public.survey_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  survey_id UUID REFERENCES public.surveys(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  comercio TEXT DEFAULT 'no asignado',
  user_email TEXT,
  user_name TEXT,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  rating_score NUMERIC(4,2) NULL,
  nps_score INTEGER NULL CHECK (nps_score BETWEEN 0 AND 10),
  nps_category VARCHAR(20) NULL CHECK (nps_category IN ('promoter', 'passive', 'detractor')),
  source VARCHAR(50) DEFAULT 'public_link',
  metadata JSONB DEFAULT '{}'::jsonb
);

-- 2. Habilitar RLS en ambas tablas
ALTER TABLE public.surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;

-- 3. Políticas RLS para lectura pública de encuestas publicadas
DROP POLICY IF EXISTS "Publico puede ver encuestas publicadas" ON public.surveys;
CREATE POLICY "Publico puede ver encuestas publicadas" ON public.surveys
  FOR SELECT TO anon, authenticated
  USING (status = 'published' AND is_active = true);

-- 4. Políticas RLS para inserción de respuestas públicas (Anon y Authenticated)
DROP POLICY IF EXISTS "Anonimos insertan respuestas publicas" ON public.survey_responses;
CREATE POLICY "Anonimos insertan respuestas publicas" ON public.survey_responses
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.surveys s
      WHERE s.id = survey_id
        AND s.status = 'published'
        AND s.is_active = true
    )
  );

-- Admins: control total sobre las respuestas
DROP POLICY IF EXISTS "Admins ven todas las respuestas" ON public.survey_responses;
CREATE POLICY "Admins ven todas las respuestas" ON public.survey_responses
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- 5. Otorgar permisos de ejecución y acceso
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON public.surveys TO anon, authenticated, service_role;
GRANT INSERT, SELECT ON public.survey_responses TO anon, authenticated, service_role;

-- 6. Función RPC Segura (SECURITY DEFINER) para inserción pública robusta
CREATE OR REPLACE FUNCTION public.submit_cyber_survey_response(
  p_survey_id UUID,
  p_comercio TEXT,
  p_user_name TEXT,
  p_user_email TEXT,
  p_answers JSONB,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_id UUID;
  v_active BOOLEAN;
BEGIN
  -- Verificar que la encuesta existe y está activa
  SELECT (status = 'published' AND is_active = true) INTO v_active
  FROM public.surveys
  WHERE id = p_survey_id;

  IF v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'La encuesta no se encuentra activa o no existe.';
  END IF;

  INSERT INTO public.survey_responses (
    survey_id,
    user_id,
    comercio,
    user_name,
    user_email,
    answers,
    source,
    metadata
  ) VALUES (
    p_survey_id,
    auth.uid(),
    COALESCE(NULLIF(TRIM(p_comercio), ''), 'Invitado'),
    p_user_name,
    p_user_email,
    p_answers,
    'public_link',
    p_metadata
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('success', true, 'id', v_new_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_cyber_survey_response(UUID, TEXT, TEXT, TEXT, JSONB, JSONB) TO anon, authenticated, service_role;

-- 7. Registrar / Actualizar la Encuesta Cyber con UUID fijo
INSERT INTO public.surveys (
  id,
  title,
  description,
  category,
  status,
  target_type,
  public_token,
  is_active,
  settings,
  pages
) VALUES (
  'c7be2026-0000-4000-8000-000000000001',
  'Planificación y Proyecciones Cyber (5-7 Octubre)',
  'Ayúdanos a dimensionar el equipo de bodega, turnos e insumos para que tus despachos salgan en tiempo récord este Cyber.',
  'operational',
  'published',
  'all',
  'cyber-2026-stocka-public-token',
  true,
  '{
    "allow_anonymous": true,
    "show_progress_bar": true,
    "submit_button_text": "Enviar Planificación Cyber",
    "success_title": "¡Planificación recibida con éxito!",
    "success_message": "Tu información ha sido registrada. Nuestro equipo de operaciones y bodega ya cuenta con tus proyecciones para coordinar turnos, insumos y asegurar una operación impecable.",
    "estimated_minutes": 2,
    "popup_on_login": true,
    "popup_frequency": "daily",
    "popup_message": "¡Se acerca el Cyber! Cuéntanos tus planes y proyecciones de venta para preparar la bodega y tus despachos."
  }'::jsonb,
  '[
    {
      "id": "page-contacto",
      "title": "Datos del Comercio y Contacto",
      "description": "Por favor indícanos a qué tienda o comercio representas",
      "blocks": [
        {
          "id": "b-comercio",
          "type": "text_short",
          "title": "Nombre de tu Empresa / Marca / Tienda",
          "description": "Escribe el nombre de tu marca registrada en Stocka",
          "required": true
        },
        {
          "id": "b-contacto-nombre",
          "type": "text_short",
          "title": "Nombre del Encargado / Responsable",
          "description": "Nombre y apellido de quien coordina la campaña",
          "required": true
        },
        {
          "id": "b-contacto-email",
          "type": "text_short",
          "title": "Correo Electrónico de Contacto",
          "description": "Para coordinaciones operativas y confirmación",
          "required": true
        },
        {
          "id": "b-contacto-telefono",
          "type": "text_short",
          "title": "Teléfono / WhatsApp de Contacto",
          "description": "Canal directo ante contingencias durante el evento",
          "required": true
        }
      ]
    },
    {
      "id": "page-planes",
      "title": "Planes y Campañas Cyber",
      "description": "Detalles de participación y fechas",
      "blocks": [
        {
          "id": "b-participaran",
          "type": "single_choice",
          "title": "¿Participarán en este Cyber?",
          "description": "Confírmanos si tu marca activará promociones u ofertas",
          "required": true,
          "options": [
            "Sí, participaremos activamente",
            "No participaremos en este evento",
            "Aún por definir / En evaluación"
          ]
        },
        {
          "id": "b-campanas",
          "type": "multiple_choice",
          "title": "¿Qué tipo de campañas o promociones activarán?",
          "description": "Selecciona todas las dinámicas que apliquen",
          "required": false,
          "options": [
            "Descuentos generales % en toda la tienda / catálogo",
            "Liquidación de temporadas anteriores / Zona Outlet",
            "Lanzamiento de nuevos productos o colecciones exclusivas",
            "Packs, Combos o promociones 2x1 / 3x2",
            "Envío Gratis (Free Shipping) o tarifas de envío bonificadas",
            "Ofertas Flash / Descuentos por horarios o días específicos",
            "Regalos o muestras gratis por compra (Gift with Purchase)",
            "Otra estrategia promocional"
          ]
        },
        {
          "id": "b-fechas-campana",
          "type": "single_choice",
          "title": "¿Entre qué fechas esperan realizar sus campañas?",
          "description": "Periodo de vigencia de las ofertas",
          "required": true,
          "options": [
            "Solo fechas oficiales (Lunes 5 al Miércoles 7 de Octubre)",
            "Adelantado: Desde fin de semana previo (Viernes 2 / Sábado 3 de Octubre)",
            "Cyber Week completo (Lunes 5 al Domingo 11 de Octubre)",
            "Fechas personalizadas"
          ]
        },
        {
          "id": "b-extenderan-ofertas",
          "type": "single_choice",
          "title": "¿Extenderán las ofertas más allá de la fecha oficial (5-7 de Octubre)?",
          "description": "Continuidad de ofertas post-miércoles 7",
          "required": true,
          "options": [
            "Sí, toda la semana (Cyber Week hasta el domingo)",
            "Sí, 1 a 2 días adicionales (Jueves 8 - Viernes 9)",
            "No, finalizaremos puntualmente el Miércoles 7 a las 23:59",
            "Aún por definir (dependerá de stock y resultados iniciales)"
          ]
        }
      ]
    },
    {
      "id": "page-volumen",
      "title": "Proyecciones y Bodega",
      "description": "Estimaciones de volumen y requerimientos logísticos",
      "blocks": [
        {
          "id": "b-aumento-ventas",
          "type": "single_choice",
          "title": "¿Cuánto esperan aumentar sus ventas / pedidos respecto a un mes habitual?",
          "description": "Proyección de incremento durante el evento",
          "required": true,
          "options": [
            "Moderado (+20% a +50% de pedidos sobre lo habitual)",
            "Significativo: 2x a 3x del volumen normal (+100% a +200%)",
            "Fuerte impacto: 3x a 5x del volumen normal (+200% a +400%)",
            "Masivo / Peak: Más de 5x del volumen normal (> 400%)"
          ]
        },
        {
          "id": "b-pedidos-estimados",
          "type": "text_short",
          "title": "Estimación aproximada de pedidos totales esperados durante el Cyber",
          "description": "Número orientativo para insumos de empaque y pickers",
          "required": false
        },
        {
          "id": "b-abastecimiento-previo",
          "type": "single_choice",
          "title": "¿Ingresarán mercadería previa de reposición antes del Cyber a bodega?",
          "description": "Recepción de stock previa al evento",
          "required": false,
          "options": [
            "Sí, enviaremos reposición de stock previa",
            "No, operaremos exclusivamente con el stock actual en bodega"
          ]
        },
        {
          "id": "b-comentarios-bodega",
          "type": "text_long",
          "title": "Requerimientos especiales, packaging o notas para la bodega",
          "description": "Flyers especiales, cintas con marca, cajas particulares, horario de corte o solicitudes clave",
          "required": false
        }
      ]
    }
  ]'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  is_active = EXCLUDED.is_active,
  settings = EXCLUDED.settings,
  pages = EXCLUDED.pages;
