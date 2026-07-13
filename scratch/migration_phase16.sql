-- WMS STOCKA - Supabase Schema Phase 16: Historial de Envíos de Notificaciones de Cobros
-- Este script agrega la columna last_notified_at a la tabla billing_records.

ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS last_notified_at timestamp with time zone;
