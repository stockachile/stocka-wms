-- ========================================================================
-- WMS STOCKA - Esquema para Separación de Pedidos y Envíos Parciales (Split Orders)
-- ========================================================================
-- Ejecutar este script en el Editor SQL de Supabase:
-- https://supabase.com/dashboard/project/ejtjfaucnxbikrwjwwdu/sql/new

-- 1. Agregar campos de jerarquía y trazabilidad a la tabla orders
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS parent_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS is_split BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS split_sequence INT DEFAULT 1,
ADD COLUMN IF NOT EXISTS split_reason TEXT;

-- 2. Crear índice para consultas rápidas de órdenes hijas / derivadas
CREATE INDEX IF NOT EXISTS idx_orders_parent_order_id ON public.orders(parent_order_id);

-- 3. Crear índice para consultar estado de partición
CREATE INDEX IF NOT EXISTS idx_orders_is_split ON public.orders(is_split) WHERE is_split = true;

-- 4. Notificar en consola de Supabase
DO $$
BEGIN
    RAISE NOTICE 'Esquema de Split Orders (parent_order_id, is_split, split_sequence, split_reason) aplicado correctamente.';
END $$;
