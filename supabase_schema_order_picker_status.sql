-- Migration: Agregar campos de estado de Picker a la tabla orders en WMS
-- Permite identificar el estado y operario reportado por el sistema Picker

ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS picker_status TEXT DEFAULT NULL;

ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS picker_operator TEXT DEFAULT NULL;

ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS picker_last_synced_at TIMESTAMPTZ DEFAULT NULL;

-- Índice para optimizar búsquedas y filtros por estado de Picker
CREATE INDEX IF NOT EXISTS idx_orders_picker_status ON public.orders (picker_status);

COMMENT ON COLUMN public.orders.picker_status IS 'Último estado reportado por el sistema Picker (ej: EN PREPARACIÓN, Completado, Parcial, Pendiente (Obs), etc.)';
COMMENT ON COLUMN public.orders.picker_operator IS 'Operario del Picker asignado o que completó el pedido';
COMMENT ON COLUMN public.orders.picker_last_synced_at IS 'Fecha y hora de la última sincronización con el sistema Picker';
