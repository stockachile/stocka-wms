-- WMS STOCKA - Fix check_estado_wms constraint
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase (https://supabase.com/dashboard)

-- 1. Eliminar la restricción CHECK anterior si existe
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS check_estado_wms;

-- 2. Volver a crear la restricción CHECK incluyendo el estado 'Cancelado'
ALTER TABLE public.orders ADD CONSTRAINT check_estado_wms 
  CHECK (estado_wms IN ('En procesamiento', 'En preparación', 'Pickeado', 'Despachado', 'Incidencia', 'Cancelado'));
