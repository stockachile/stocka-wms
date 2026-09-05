-- WMS STOCKA - Esquema para Gestor de Facturación Automatizada
-- Ejecutar en Supabase SQL Editor

-- 1. Agregar columnas a billing_records para persistir el detalle del desglose generado
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS fulfillment_details JSONB;
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS fulfillment_volume NUMERIC(10, 4) DEFAULT 0;
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS fulfillment_orders_count INTEGER DEFAULT 0;
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS fulfillment_uf_value NUMERIC(10, 2);
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS fulfillment_calculated_at TIMESTAMPTZ;

-- 2. Asegurar índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_billing_records_period_comercio ON public.billing_records(period_id, comercio);
CREATE INDEX IF NOT EXISTS idx_orders_periodo_facturacion ON public.orders(periodo_facturacion);
CREATE INDEX IF NOT EXISTS idx_orders_comercio_periodo ON public.orders(comercio, periodo_facturacion);

-- 3. Asociar declaraciones de ingreso de stock a periodos de facturación
ALTER TABLE public.stock_declarations ADD COLUMN IF NOT EXISTS periodo_facturacion TEXT;
ALTER TABLE public.stock_declarations ADD COLUMN IF NOT EXISTS billing_period_id UUID REFERENCES public.billing_periods(id);
CREATE INDEX IF NOT EXISTS idx_stock_declarations_periodo ON public.stock_declarations(periodo_facturacion);
CREATE INDEX IF NOT EXISTS idx_stock_declarations_comercio_periodo ON public.stock_declarations(comercio, periodo_facturacion);

