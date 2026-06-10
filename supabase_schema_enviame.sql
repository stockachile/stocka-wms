-- WMS STOCKA - Supabase Schema Actualización: Integración Enviame
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Añadir columnas de seguimiento a la tabla de pedidos (orders)
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS tracking_number TEXT,
ADD COLUMN IF NOT EXISTS tracking_url TEXT,
ADD COLUMN IF NOT EXISTS label_url TEXT,
ADD COLUMN IF NOT EXISTS courier TEXT,
ADD COLUMN IF NOT EXISTS enviame_delivery_id TEXT,
ADD COLUMN IF NOT EXISTS enviame_status TEXT;

-- Opcional: Crear índices para mejorar la velocidad de búsqueda por tracking o ID de Enviame
CREATE INDEX IF NOT EXISTS idx_orders_tracking_number ON orders(tracking_number);
CREATE INDEX IF NOT EXISTS idx_orders_enviame_delivery_id ON orders(enviame_delivery_id);
CREATE INDEX IF NOT EXISTS idx_orders_external_order_number ON orders(external_order_number);
