-- Migration: Add Invoice PDF columns to billing_records table
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS factura_fulfillment_pdf_url TEXT;
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS factura_enviame_pdf_url TEXT;
