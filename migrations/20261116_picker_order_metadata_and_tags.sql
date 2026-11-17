-- Migration: Add platform, shipping_method, payment_status, coverage, order_tags, and order_sla to Picker DB
ALTER TABLE public.active_orders
  ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS platform_logo TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS shipping_method TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS coverage TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS order_tags JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS order_sla TEXT DEFAULT NULL;

ALTER TABLE public.archived_orders
  ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS platform_logo TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS shipping_method TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS coverage TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS order_tags JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS order_sla TEXT DEFAULT NULL;

CREATE OR REPLACE FUNCTION public.archive_deleted_order()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.archived_orders (
        id, created_at, sucursal, order_number, agenda, quantity, sku, name, color, color_bg, color_text, talla, manga, cuello,
        client_name, tracking, operator, totu, sheet_status, observation, fecha,
        contact_data_q, contact_data_r, contact_data_s, contact_data_t, contact_data_u, extra_col_v, comercio, created_by, edited, scanned_label,
        platform, platform_logo, shipping_method, payment_status, coverage, order_tags, order_sla
    )
    VALUES (
        OLD.id, OLD.created_at, OLD.sucursal, OLD.order_number, OLD.agenda, OLD.quantity, OLD.sku, OLD.name, OLD.color, OLD.color_bg, OLD.color_text, OLD.talla, OLD.manga, OLD.cuello,
        OLD.client_name, OLD.tracking, OLD.operator, OLD.totu, OLD.sheet_status, OLD.observation, OLD.fecha,
        OLD.contact_data_q, OLD.contact_data_r, OLD.contact_data_s, OLD.contact_data_t, OLD.contact_data_u, OLD.extra_col_v, OLD.comercio, OLD.created_by, OLD.edited, OLD.scanned_label,
        OLD.platform, OLD.platform_logo, OLD.shipping_method, OLD.payment_status, OLD.coverage, OLD.order_tags, OLD.order_sla
    );
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';
