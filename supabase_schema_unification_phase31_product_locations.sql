-- =========================================================================
-- WMS STOCKA - Supabase Schema Phase 31: Sistema de Ubicaciones Físicas
-- Ejecuta este script en el SQL Editor de tu proyecto Supabase (WMS).
-- =========================================================================

-- 1. Crear tabla de ubicaciones físicas de productos
CREATE TABLE IF NOT EXISTS public.product_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  comercio TEXT,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  bodega_nombre TEXT NOT NULL,          -- Ej: 'Matriz Ñuñoa', 'CDD La Reina', 'CDD Recoleta', 'Bodega Central'
  zona TEXT NOT NULL,                   -- Ej: 'Salón', 'Subterráneo', 'Bodega Alta' (personalizable)
  espacio TEXT NOT NULL,                -- Ej: 'Estante 1', 'Mesón principal', 'Rack A' (personalizable)
  posicion TEXT DEFAULT '',             -- Ej: 'Bandeja 1', 'Nivel 4', 'Suelo' (opcional, personalizable)
  stock INTEGER DEFAULT 1,              -- Stock o capacidad estimada en la ubicación
  is_zero_stock BOOLEAN DEFAULT FALSE,  -- True si fue marcada con 0 stock desde el Picker
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Índices de rendimiento para búsquedas inmediatas
CREATE INDEX IF NOT EXISTS idx_prod_locations_sku ON public.product_locations(sku);
CREATE INDEX IF NOT EXISTS idx_prod_locations_comercio ON public.product_locations(comercio);
CREATE INDEX IF NOT EXISTS idx_prod_locations_bodega ON public.product_locations(bodega_nombre);
CREATE INDEX IF NOT EXISTS idx_prod_locations_zero_stock ON public.product_locations(is_zero_stock);

-- 3. Habilitar RLS (Row Level Security)
ALTER TABLE public.product_locations ENABLE ROW LEVEL SECURITY;

-- 4. Políticas de acceso RLS
DROP POLICY IF EXISTS "Autenticados pueden ver ubicaciones" ON public.product_locations;
CREATE POLICY "Autenticados pueden ver ubicaciones" ON public.product_locations
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Autenticados pueden insertar ubicaciones" ON public.product_locations;
CREATE POLICY "Autenticados pueden insertar ubicaciones" ON public.product_locations
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Autenticados pueden actualizar ubicaciones" ON public.product_locations;
CREATE POLICY "Autenticados pueden actualizar ubicaciones" ON public.product_locations
  FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Autenticados pueden eliminar ubicaciones" ON public.product_locations;
CREATE POLICY "Autenticados pueden eliminar ubicaciones" ON public.product_locations
  FOR DELETE USING (true);

-- 5. Trigger para actualizar automáticamente 'updated_at'
CREATE OR REPLACE FUNCTION public.set_product_locations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_product_locations_updated_at ON public.product_locations;
CREATE TRIGGER trg_set_product_locations_updated_at
  BEFORE UPDATE ON public.product_locations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_product_locations_updated_at();

-- 6. Agregar columnas informativas en orders si se requiere histórico de ubicaciones
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS picker_location_info TEXT;
