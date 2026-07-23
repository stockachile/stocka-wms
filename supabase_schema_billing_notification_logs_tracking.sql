-- Migration: Add message tracking columns to billing_notification_logs table
ALTER TABLE public.billing_notification_logs ADD COLUMN IF NOT EXISTS message_id TEXT;
ALTER TABLE public.billing_notification_logs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'enviado';

-- Create index on message_id for fast lookup from webhook
CREATE INDEX IF NOT EXISTS idx_billing_notification_logs_message_id ON public.billing_notification_logs(message_id);
