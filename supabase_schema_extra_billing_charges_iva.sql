-- Migration: Add iva_tipo column to extra_billing_charges table
ALTER TABLE public.extra_billing_charges ADD COLUMN IF NOT EXISTS iva_tipo TEXT CHECK (iva_tipo IN ('mas_iva', 'iva_incluido')) DEFAULT 'mas_iva';
