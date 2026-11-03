-- =============================================================================
-- MIGRACIÓN: SOPORTE PARA CONSOLIDADO DE PEDIDOS (<24H MISMO CLIENTE + DIRECCIÓN)
-- =============================================================================
-- Agrega columnas opcionales a public.orders para vincular pedidos consolidados
-- que se envían en un único paquete físico (1 envío facturado + N preparaciones).
-- Nota: El módulo js/consolidate_orders.js utiliza además raw_shopify_data
-- (_is_consolidated, _consolidation_role, _consolidated_into_order_id, etc.)
-- como respaldo inmediato compatible sin requerir bloqueo de esquema.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS consolidated_into_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_consolidated BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_orders_consolidated_into_order_id
  ON public.orders(consolidated_into_order_id)
  WHERE consolidated_into_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_is_consolidated
  ON public.orders(is_consolidated)
  WHERE is_consolidated = TRUE;

COMMENT ON COLUMN public.orders.consolidated_into_order_id IS 'ID del Pedido Principal (Ancla del Envío) en el cual se consolida este pedido secundario para despacho conjunto.';
COMMENT ON COLUMN public.orders.is_consolidated IS 'Indica si este pedido forma parte de un grupo de consolidación de envío (ya sea como pedido principal o secundario).';
