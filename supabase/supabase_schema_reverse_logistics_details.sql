-- Agregar columnas adicionales de datos de cliente y costeo de envío
ALTER TABLE public.reverse_logistics 
  ADD COLUMN IF NOT EXISTS customer_name TEXT,
  ADD COLUMN IF NOT EXISTS customer_email TEXT,
  ADD COLUMN IF NOT EXISTS customer_phone TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address TEXT,
  ADD COLUMN IF NOT EXISTS shipping_city TEXT,
  ADD COLUMN IF NOT EXISTS shipping_complement TEXT,
  ADD COLUMN IF NOT EXISTS responsable_pago TEXT DEFAULT 'comercio',
  ADD COLUMN IF NOT EXISTS modo_entrega TEXT DEFAULT 'sucursal',
  ADD COLUMN IF NOT EXISTS costo_envio NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS origen_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wms_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL;
