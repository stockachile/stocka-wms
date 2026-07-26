-- Migration: Add tipo column to extra_billing_charges to support discounts
ALTER TABLE public.extra_billing_charges ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'cargo';
