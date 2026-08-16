-- Agregar columnas para alias de producto y control de envío al picker
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS alias TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS send_alias_to_picker BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.products.alias IS 'Nombre alternativo/abreviado que se envía opcionalmente al Picker';
COMMENT ON COLUMN public.products.send_alias_to_picker IS 'Indica si se debe usar el alias en lugar del nombre del producto al sincronizar con el Picker';
