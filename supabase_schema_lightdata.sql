-- WMS STOCKA - Supabase Schema Actualización: Integración LightData
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Añadir columnas de seguimiento de LightData a la tabla de pedidos (orders)
-- Al igual que con Optiroute, la actualización de estos estados no afecta el stock directamente
-- excepto cuando se mapean a los estados finales definidos en el WMS.
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS lightdata_status TEXT,
ADD COLUMN IF NOT EXISTS raw_lightdata_data JSONB;

-- 2. Crear índices si no existen para mejorar la velocidad de búsqueda
CREATE INDEX IF NOT EXISTS idx_orders_lightdata_status ON orders(lightdata_status);
