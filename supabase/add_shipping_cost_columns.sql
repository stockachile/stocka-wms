-- Add shipping cost and tax columns to the orders table to track quoted shipping costs
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC(10, 2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS shipping_cost_tax NUMERIC(10, 2) DEFAULT 0.00;

COMMENT ON COLUMN public.orders.shipping_cost IS 'Costo neto de despacho cotizado para el pedido';
COMMENT ON COLUMN public.orders.shipping_cost_tax IS 'IVA del costo de despacho cotizado';
