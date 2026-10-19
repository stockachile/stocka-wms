-- WMS STOCKA - Migración para Multi-Código de Barras por Producto (SKU)
-- Ejecutar en el SQL Editor de Supabase

-- 1. Agregar columna alternate_barcodes a la tabla products
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS alternate_barcodes TEXT[] DEFAULT '{}';

COMMENT ON COLUMN public.products.alternate_barcodes IS 'Lista de códigos de barra adicionales o históricos válidos para este SKU (multi-código para recepción y picking)';

-- 2. Índice GIN para búsquedas rápidas sobre el arreglo de códigos de barra alternativos
CREATE INDEX IF NOT EXISTS idx_products_alternate_barcodes ON public.products USING GIN (alternate_barcodes);
