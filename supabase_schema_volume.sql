-- WMS STOCKA - Migración de columnas de Volumen y Costo para Declaraciones
-- Ejecutar en el SQL Editor de Supabase

-- 1. Agregar columna de Volumen Declarado por el Cliente
ALTER TABLE public.stock_declarations 
  ADD COLUMN IF NOT EXISTS volume_declared NUMERIC DEFAULT 0 CHECK (volume_declared >= 0);

-- 2. Agregar columna de Volumen Confirmado/Recepcionado por el Admin
ALTER TABLE public.stock_declarations 
  ADD COLUMN IF NOT EXISTS volume_confirmed NUMERIC DEFAULT 0 CHECK (volume_confirmed >= 0);

-- 3. Agregar columna para el Costo Estimado del Ingreso (en UF)
ALTER TABLE public.stock_declarations 
  ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC DEFAULT 0 CHECK (estimated_cost >= 0);
