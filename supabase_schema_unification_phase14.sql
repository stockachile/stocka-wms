-- WMS STOCKA - Supabase Schema Phase 14: Equivalencias de SKU entre Plataformas

-- 1. Crear Tabla de Equivalencias de SKU
CREATE TABLE IF NOT EXISTS public.sku_equivalences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  comercio TEXT NOT NULL,
  master_sku TEXT NOT NULL,
  platform_sku TEXT NOT NULL,
  platform TEXT NOT NULL, -- Ej: 'Shopify', 'MercadoLibre', 'Falabella', 'Paris', 'WooCommerce', 'Todas'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(comercio, platform, platform_sku)
);

-- 2. Habilitar RLS (Row Level Security)
ALTER TABLE public.sku_equivalences ENABLE ROW LEVEL SECURITY;

-- 3. Crear Políticas de Seguridad
DROP POLICY IF EXISTS "Clientes gestionan sus equivalencias" ON public.sku_equivalences;
CREATE POLICY "Clientes gestionan sus equivalencias" ON public.sku_equivalences
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(sku_equivalences.comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );

-- Comentarios explicativos
COMMENT ON TABLE public.sku_equivalences IS 'Tabla para mapear SKUs externos de plataformas a SKUs maestros de WMS.';
COMMENT ON COLUMN public.sku_equivalences.master_sku IS 'SKU maestro en el WMS al que pertenece el producto físico.';
COMMENT ON COLUMN public.sku_equivalences.platform_sku IS 'SKU que llega desde la plataforma externa integrada.';
COMMENT ON COLUMN public.sku_equivalences.platform IS 'Nombre de la plataforma de origen o Todas para mapeo general.';
