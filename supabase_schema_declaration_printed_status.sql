-- AGREGAR COLUMNAS DE TRAZABILIDAD DE IMPRESIÓN EN STOCK_DECLARATIONS
ALTER TABLE stock_declarations 
ADD COLUMN IF NOT EXISTS is_printed BOOLEAN DEFAULT FALSE;

ALTER TABLE stock_declarations 
ADD COLUMN IF NOT EXISTS printed_at TIMESTAMPTZ;

ALTER TABLE stock_declarations 
ADD COLUMN IF NOT EXISTS printed_by TEXT;

CREATE INDEX IF NOT EXISTS idx_stock_declarations_is_printed ON stock_declarations(is_printed);
