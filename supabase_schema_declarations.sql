-- WMS STOCKA - Esquema para Declaraciones de Ingreso de Stock
-- Ejecutar en el SQL Editor de Supabase

-- 1. Crear la Tabla de Declaraciones
CREATE TABLE IF NOT EXISTS public.stock_declarations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  comercio TEXT NOT NULL DEFAULT 'no asignado',
  title TEXT NOT NULL,
  estimated_arrival_type TEXT NOT NULL CHECK (estimated_arrival_type IN ('exact', 'estimate')),
  estimated_arrival_date DATE, -- Para fecha exacta
  estimated_arrival_period TEXT, -- Para plazo estimado (ej. "3 semanas", "2 meses")
  quantity_declared INTEGER NOT NULL CHECK (quantity_declared >= 0),
  quantity_received INTEGER DEFAULT 0 CHECK (quantity_received >= 0),
  quantity_incidents INTEGER DEFAULT 0 CHECK (quantity_incidents >= 0),
  package_count INTEGER NOT NULL CHECK (package_count >= 0),
  package_type TEXT NOT NULL CHECK (package_type IN ('Cajas', 'Pallets', 'Contenedores', 'Mixto')),
  delivery_method TEXT NOT NULL CHECK (delivery_method IN ('Transporte vía courier', 'Desde proveedor', 'Transporte particular', 'Solicita retiro (solo dentro de Santiago)')),
  contact_info TEXT,
  carrier_info TEXT,
  notes TEXT, -- Comentarios del cliente
  admin_notes TEXT, -- Comentarios del administrador al recepcionar
  status TEXT NOT NULL CHECK (status IN ('Creada', 'En Recepción', 'Conteo/Clasificación en curso', 'Recibido', 'Recepción con incidencias')) DEFAULT 'Creada',
  file_name TEXT NOT NULL,
  file_base64 TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Asegurar que la columna comercio existe en instalaciones previas
ALTER TABLE public.stock_declarations ADD COLUMN IF NOT EXISTS comercio TEXT NOT NULL DEFAULT 'no asignado';


-- 2. Habilitar RLS (Row Level Security)
ALTER TABLE public.stock_declarations ENABLE ROW LEVEL SECURITY;

-- 3. Crear Políticas de Seguridad RLS

-- A) Clientes pueden ver sus propias declaraciones
CREATE POLICY "Clientes ven sus declaraciones" ON public.stock_declarations
  FOR SELECT
  USING (auth.uid() = merchant_id);

-- B) Clientes pueden crear sus propias declaraciones
CREATE POLICY "Clientes crean sus declaraciones" ON public.stock_declarations
  FOR INSERT
  WITH CHECK (auth.uid() = merchant_id);

-- C) Administradores pueden ver todas las declaraciones
CREATE POLICY "Admins ven todas las declaraciones" ON public.stock_declarations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- D) Administradores pueden actualizar todas las declaraciones (para cambiar estado, cantidades, etc.)
CREATE POLICY "Admins actualizan declaraciones" ON public.stock_declarations
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- E) Administradores pueden eliminar declaraciones si fuera necesario
CREATE POLICY "Admins eliminan declaraciones" ON public.stock_declarations
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );
