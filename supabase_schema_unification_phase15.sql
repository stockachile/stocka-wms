-- WMS STOCKA - Supabase Schema Phase 15: Configuración de Plataforma Principal

-- 1. Añadir columna is_main a la tabla merchant_integrations
ALTER TABLE public.merchant_integrations 
ADD COLUMN IF NOT EXISTS is_main BOOLEAN DEFAULT false;

-- 2. Crear índice único parcial para asegurar que solo una integración por comercio sea la principal
DROP INDEX IF EXISTS unique_main_platform_per_comercio;
CREATE UNIQUE INDEX unique_main_platform_per_comercio 
ON public.merchant_integrations (comercio) 
WHERE (is_main = true);

-- Comentario explicativo
COMMENT ON COLUMN public.merchant_integrations.is_main IS 'Indica si esta integración es la plataforma principal de ventas y catálogo para el comercio.';
