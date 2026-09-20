-- Agregar columnas para Código de Barras WMS (CBAR WMS) y control de envío al picker
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS barcode_wms TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS send_barcode_wms_to_picker BOOLEAN DEFAULT true;

COMMENT ON COLUMN public.products.barcode_wms IS 'Código de barras especial asignado por el WMS para uso interno y escaneo en el sistema Picker.';
COMMENT ON COLUMN public.products.send_barcode_wms_to_picker IS 'Indica si se envía el CBAR WMS al Picker (por defecto true cuando barcode_wms tiene valor).';
