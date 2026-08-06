-- WMS STOCKA - SQL Migration for Strict Picking Match Support
-- Run this script in the WMS Supabase SQL Editor.

-- 1. Add picking_match_strict column to products table
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS picking_match_strict BOOLEAN DEFAULT FALSE;
COMMENT ON COLUMN public.products.picking_match_strict IS 'Indica si el producto requiere escaneo estricto (coincidencia exacta de SKU) durante el picking';
