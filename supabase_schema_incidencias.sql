-- WMS STOCKA - Tablas de Incidencias, RLS y Políticas de Seguridad

-- 1. Crear Tabla de Incidencias
CREATE TABLE IF NOT EXISTS public.incidencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  resolved_at TIMESTAMP WITH TIME ZONE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL, -- Cliente asignado
  comercio TEXT DEFAULT 'no asignado',
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  solution TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'integracion' CHECK (type IN ('integracion', 'pedido', 'stock', 'otros')),
  severity VARCHAR(50) DEFAULT 'sugerencia' CHECK (severity IN ('sugerencia', 'bajo', 'medio', 'alto', 'critico')),
  status VARCHAR(50) DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'resuelta', 'descartada')),
  comment TEXT, -- Comentario del cliente al resolver o descartar
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL -- Administrador que la crea
);

-- 2. Crear Índices para Optimizar Búsquedas
CREATE INDEX IF NOT EXISTS idx_incidencias_user_id ON public.incidencias(user_id);
CREATE INDEX IF NOT EXISTS idx_incidencias_status ON public.incidencias(status);
CREATE INDEX IF NOT EXISTS idx_incidencias_comercio ON public.incidencias(comercio);

-- 3. Habilitar Row Level Security (RLS)
ALTER TABLE public.incidencias ENABLE ROW LEVEL SECURITY;

-- 4. Políticas RLS para la tabla incidencias

-- A) Admins tienen acceso total para gestionar todas las incidencias
DROP POLICY IF EXISTS "Admins ven y gestionan todas las incidencias" ON public.incidencias;
CREATE POLICY "Admins ven y gestionan todas las incidencias" ON public.incidencias
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- B) Clientes ven sus propias incidencias asignadas
DROP POLICY IF EXISTS "Clientes ven sus propias incidencias" ON public.incidencias;
CREATE POLICY "Clientes ven sus propias incidencias" ON public.incidencias
  FOR SELECT USING (
    user_id = auth.uid()
  );

-- C) Clientes actualizan únicamente para resolver o descartar con un comentario
DROP POLICY IF EXISTS "Clientes actualizan sus incidencias para responder" ON public.incidencias;
CREATE POLICY "Clientes actualizan sus incidencias para responder" ON public.incidencias
  FOR UPDATE USING (
    user_id = auth.uid()
  ) WITH CHECK (
    user_id = auth.uid() AND status IN ('resuelta', 'descartada')
  );

-- 5. Otorgar permisos sobre la tabla
GRANT ALL ON public.incidencias TO postgres, service_role;
GRANT ALL ON public.incidencias TO anon, authenticated;
