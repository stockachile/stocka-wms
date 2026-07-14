-- WMS STOCKA - Supabase Schema Phase 17: Periodo de Facturación para Pedidos WMS
-- Este script agrega la columna periodo_facturacion a la tabla orders.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS periodo_facturacion TEXT;
