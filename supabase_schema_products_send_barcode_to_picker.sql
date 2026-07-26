-- Añadir columna para configurar el envío de código de barras al picker
ALTER TABLE products ADD COLUMN IF NOT EXISTS send_barcode_to_picker BOOLEAN DEFAULT false;
