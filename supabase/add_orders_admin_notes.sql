-- ==========================================================================
-- WMS STOCKA: Columna para Notas Internas de Administración en Pedidos
-- Permite almacenar anotaciones privadas visibles únicamente para administradores
-- en la Torre de Control, sin exponerlas a clientes ni sincronizaciones externas.
-- ==========================================================================

ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS admin_notes TEXT;

COMMENT ON COLUMN public.orders.admin_notes IS 'Notas internas exclusivas para administradores en Torre de Control. No visibles por clientes ni enviadas a plataformas externas.';

CREATE INDEX IF NOT EXISTS idx_orders_admin_notes ON public.orders USING btree (id) WHERE admin_notes IS NOT NULL;
