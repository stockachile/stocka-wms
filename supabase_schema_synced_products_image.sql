-- WMS STOCKA - SQL Migration to enable Product Image Sync
-- Run this script in the Supabase SQL Editor to add the image_url column to synced_products.

ALTER TABLE public.synced_products ADD COLUMN IF NOT EXISTS image_url TEXT;
COMMENT ON COLUMN public.synced_products.image_url IS 'URL de la imagen del producto sincronizada desde el canal externo';
