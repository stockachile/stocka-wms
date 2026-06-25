-- WMS STOCKA - Esquema para Bodegas de Ingreso y Asignación
-- Ejecutar en el SQL Editor de Supabase

-- 1. Crear o alterar la Tabla de Bodegas
CREATE TABLE IF NOT EXISTS public.warehouses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Asegurar que las columnas nuevas existan
ALTER TABLE public.warehouses ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT 'No especificada';
ALTER TABLE public.warehouses ADD COLUMN IF NOT EXISTS comuna TEXT NOT NULL DEFAULT 'No especificada';
ALTER TABLE public.warehouses ADD COLUMN IF NOT EXISTS operating_days TEXT NOT NULL DEFAULT 'Lunes a Viernes';
ALTER TABLE public.warehouses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW());

-- Hacer que name sea único
ALTER TABLE public.warehouses DROP CONSTRAINT IF EXISTS warehouses_name_key;
ALTER TABLE public.warehouses ADD CONSTRAINT warehouses_name_key UNIQUE (name);

-- Habilitar RLS en la tabla de Bodegas
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas antiguas para recrearlas
DROP POLICY IF EXISTS "Cualquiera autenticado puede ver bodegas" ON public.warehouses;
DROP POLICY IF EXISTS "Solo administradores gestionan bodegas" ON public.warehouses;
DROP POLICY IF EXISTS "Autenticados pueden ver bodegas" ON public.warehouses;
DROP POLICY IF EXISTS "Admin can modify warehouses" ON public.warehouses;

-- Crear políticas RLS para Bodegas
CREATE POLICY "Cualquiera autenticado puede ver bodegas" ON public.warehouses
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Solo administradores gestionan bodegas" ON public.warehouses
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- 2. Agregar Columna warehouse_id a la Tabla de Declaraciones
ALTER TABLE public.stock_declarations ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL;

-- 3. Actualizar la restricción del CHECK del estado de declaraciones para incluir 'Bodega Asignada'
ALTER TABLE public.stock_declarations DROP CONSTRAINT IF EXISTS stock_declarations_status_check;
ALTER TABLE public.stock_declarations ADD CONSTRAINT stock_declarations_status_check 
  CHECK (status IN ('Creada', 'Bodega Asignada', 'En Recepción - Pendiente Conteo', 'En proceso de conteo/clasificación', 'Recibido Conforme', 'Recibido con Incidencias'));

-- 4. Insertar 3 Bodegas Iniciales por defecto o actualizarlas si ya existen
INSERT INTO public.warehouses (name, address, comuna, operating_days)
VALUES 
  ('Bodega Central Santiago', 'Av. Vitacura 1234', 'Vitacura', 'Lunes a Viernes 09:00 - 18:00, Sábado 09:00 - 13:00'),
  ('Bodega Norte Pudahuel', 'Camino Lo Boza 550', 'Pudahuel', 'Lunes a Viernes 08:30 - 17:30'),
  ('Bodega Sur San Bernardo', 'Panamericana Sur km 18', 'San Bernardo', 'Lunes a Viernes 09:00 - 18:00')
ON CONFLICT (name) DO UPDATE 
SET address = EXCLUDED.address,
    comuna = EXCLUDED.comuna,
    operating_days = EXCLUDED.operating_days;

