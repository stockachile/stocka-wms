-- WMS STOCKA - Supabase Schema Phase 16: Tabla de Productos Sincronizados de Canales
-- Este script implementa la tabla synced_products para almacenar los catálogos externos.

-- 1. Crear Tabla de Productos Sincronizados
CREATE TABLE IF NOT EXISTS public.synced_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  comercio TEXT NOT NULL,
  platform TEXT NOT NULL, -- Ej: 'Shopify', 'MercadoLibre', 'Falabella', 'Paris', 'WooCommerce', 'Jumpseller'
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(comercio, platform, sku)
);

-- 2. Habilitar RLS (Row Level Security)
ALTER TABLE public.synced_products ENABLE ROW LEVEL SECURITY;

-- 3. Crear Políticas de Seguridad
DROP POLICY IF EXISTS "Clientes gestionan sus synced_products" ON public.synced_products;
CREATE POLICY "Clientes gestionan sus synced_products" ON public.synced_products
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(synced_products.comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );

-- 4. Migración de Datos Inicial
-- Copia los productos actuales provenientes de integraciones desde products hacia synced_products.
INSERT INTO public.synced_products (comercio, platform, sku, name, created_at)
SELECT 
  comercio,
  CASE 
    WHEN shopify_product_id IS NOT NULL THEN 'Shopify'
    WHEN meli_item_id IS NOT NULL THEN 'MercadoLibre'
    WHEN raw_falabella_data IS NOT NULL THEN 'Falabella'
    WHEN raw_paris_data IS NOT NULL THEN 'Paris'
    ELSE 'Todas'
  END as platform,
  sku,
  name,
  COALESCE(created_at, NOW())
FROM public.products
WHERE 
  shopify_product_id IS NOT NULL 
  OR meli_item_id IS NOT NULL 
  OR raw_falabella_data IS NOT NULL 
  OR raw_paris_data IS NOT NULL
ON CONFLICT (comercio, platform, sku) DO UPDATE 
SET name = EXCLUDED.name;

-- Comentarios explicativos
COMMENT ON TABLE public.synced_products IS 'Tabla para almacenar los listados de productos de los canales de venta integrados.';
COMMENT ON COLUMN public.synced_products.platform IS 'Canal de venta origen del producto (Shopify, MercadoLibre, Falabella, Paris, WooCommerce, Jumpseller).';
COMMENT ON COLUMN public.synced_products.sku IS 'SKU del producto en el canal externo de ventas.';
COMMENT ON COLUMN public.synced_products.name IS 'Nombre descriptivo del producto en el canal externo.';
