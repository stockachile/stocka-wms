-- WMS Database Migrations
-- Ejecutar en la base de datos de Supabase del WMS:

-- 1. Agregar columna picking_match_strict a la tabla products
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS picking_match_strict BOOLEAN DEFAULT false;

-- 2. Agregar columna picking_match_strict a la tabla comercios_adicional_config
ALTER TABLE public.comercios_adicional_config ADD COLUMN IF NOT EXISTS picking_match_strict BOOLEAN DEFAULT false;

-- Picker Database Migrations
-- Ejecutar en la base de datos de Supabase del Picker (hpomymtecmxujbjxqawu):

-- 3. Agregar columna picking_match_strict a la tabla active_orders
ALTER TABLE public.active_orders ADD COLUMN IF NOT EXISTS picking_match_strict BOOLEAN DEFAULT false;
