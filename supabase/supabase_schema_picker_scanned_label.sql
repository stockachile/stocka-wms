-- Migración WMS: Guardar lectura de etiqueta física del operario (picker_scanned_label)
-- Ejecutar en la base de datos de Supabase del WMS (ejtjfaucnxbikrwjwwdu):

ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS picker_scanned_label TEXT DEFAULT NULL;

COMMENT ON COLUMN public.orders.picker_scanned_label IS 'Lectura física escaneada por el operario del Picker sobre la etiqueta de despacho (código de barras, QR o DataMatrix).';
