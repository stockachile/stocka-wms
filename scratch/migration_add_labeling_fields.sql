-- WMS STOCKA - SQL Migration to add barcode labeling preference columns
-- Execute this query in the Supabase SQL Editor

ALTER TABLE public.stock_declarations 
ADD COLUMN IF NOT EXISTS labeling_type TEXT NOT NULL DEFAULT 'completely' CHECK (labeling_type IN ('completely', 'partially', 'none')),
ADD COLUMN IF NOT EXISTS labeling_qty_requested INTEGER NOT NULL DEFAULT 0 CHECK (labeling_qty_requested >= 0),
ADD COLUMN IF NOT EXISTS labeling_qty_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (labeling_qty_confirmed >= 0);
