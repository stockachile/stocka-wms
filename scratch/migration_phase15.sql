-- WMS STOCKA - Supabase Schema Phase 15: Opciones de Agenda y Operador + Fecha Procesamiento
-- Este script agrega la tabla wms_config_options para registrar las opciones disponibles 
-- de Agenda y Operador y agrega los nuevos campos requeridos a la tabla de orders.

-- 1. Crear la tabla de opciones de configuración
CREATE TABLE IF NOT EXISTS public.wms_config_options (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('agenda', 'operador')),
  value text NOT NULL UNIQUE,
  created_at timestamp with time zone DEFAULT now()
);

-- Habilitar RLS en la tabla de configuración
ALTER TABLE public.wms_config_options ENABLE ROW LEVEL SECURITY;

-- Crear políticas para permitir lectura a usuarios autenticados y escritura completa a administradores
DROP POLICY IF EXISTS "Permitir lectura de opciones a todos los autenticados" ON public.wms_config_options;
CREATE POLICY "Permitir lectura de opciones a todos los autenticados" 
  ON public.wms_config_options FOR SELECT 
  TO authenticated 
  USING (true);

DROP POLICY IF EXISTS "Permitir escritura de opciones a administradores" ON public.wms_config_options;
CREATE POLICY "Permitir escritura de opciones a administradores" 
  ON public.wms_config_options FOR ALL 
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- 2. Insertar valores semilla por defecto (si no existen)
INSERT INTO public.wms_config_options (type, value) VALUES
  ('agenda', 'RM'),
  ('agenda', 'STK'),
  ('agenda', 'REGION'),
  ('agenda', 'RETIRO'),
  ('agenda', 'FLEX'),
  ('agenda', 'CENTRO DE ENVIOS'),
  ('agenda', 'FALABELLA'),
  ('agenda', 'PARIS'),
  ('agenda', 'WALMART'),
  ('agenda', 'COLINA'),
  ('agenda', 'PENDIENTE'),
  ('agenda', 'CANCELA'),
  ('agenda', 'COMPRA EN BODEGA'),
  ('operador', 'STARKEN'),
  ('operador', 'BLUEXPRESS'),
  ('operador', 'CHILEXPRESS'),
  ('operador', 'ENVIAME'),
  ('operador', 'STOCKA X'),
  ('operador', 'ALPHA'),
  ('operador', 'SUCURSAL ÑUÑOA'),
  ('operador', 'FALABELLA'),
  ('operador', 'MERCADOLIBRE')
ON CONFLICT (value) DO NOTHING;

-- 3. Agregar columnas operador y fecha_procesamiento a orders si no existen
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS operador TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS fecha_procesamiento TEXT;
