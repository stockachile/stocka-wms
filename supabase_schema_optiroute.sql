-- WMS STOCKA - Supabase Schema Actualización: Integración Optiroute
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Modificar la restricción CHECK en la columna 'platform' de merchant_integrations
-- Esto nos permite guardar configuraciones con el valor 'Optiroute'.
ALTER TABLE merchant_integrations DROP CONSTRAINT IF EXISTS merchant_integrations_platform_check;
ALTER TABLE merchant_integrations ADD CONSTRAINT merchant_integrations_platform_check CHECK (platform IN ('Shopify', 'WooCommerce', 'Jumpseller', 'Tiendanube', 'Optiroute'));

-- 2. Añadir columnas de seguimiento de Optiroute a la tabla de pedidos (orders)
-- Nota: La actualización de estos estados NO afecta el stock en el sistema. El stock
-- sigue descontándose únicamente cuando el pedido se marca como 'despachado' o 'retirado'.
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS optiroute_id TEXT,
ADD COLUMN IF NOT EXISTS optiroute_status TEXT,
ADD COLUMN IF NOT EXISTS raw_optiroute_data JSONB;

-- 3. Crear índices para mejorar la velocidad de búsqueda por ID de Optiroute
CREATE INDEX IF NOT EXISTS idx_orders_optiroute_id ON orders(optiroute_id);
