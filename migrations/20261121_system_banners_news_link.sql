-- =========================================================================
-- SQL Migration: Enlace directo a Noticias y Logo en system_banners
-- =========================================================================
-- Opcional (el frontend WMS incluye fallback compatible si no se ejecuta aún),
-- pero recomendado para trazabilidad limpia en Supabase.
-- =========================================================================

ALTER TABLE public.system_banners
  ADD COLUMN IF NOT EXISTS link_news_id UUID REFERENCES public.dashboard_news(id) ON DELETE SET NULL;

ALTER TABLE public.system_banners
  ADD COLUMN IF NOT EXISTS link_label VARCHAR(120) DEFAULT 'Ver detalle completo';

ALTER TABLE public.system_banners
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

COMMENT ON COLUMN public.system_banners.link_news_id IS 'ID de la noticia en dashboard_news que se abrirá al hacer clic en el botón del banner superior.';
COMMENT ON COLUMN public.system_banners.link_label IS 'Texto del botón/enlace mostrado en el banner superior cuando hay una noticia enlazada.';
COMMENT ON COLUMN public.system_banners.logo_url IS 'Ruta o URL opcional del logo a mostrar a la izquierda del banner superior (reemplaza el icono).';
