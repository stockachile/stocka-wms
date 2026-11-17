-- =========================================================================
-- WMS STOCKA - INTEGRACIÓN FACTURACIÓN ELECTRÓNICA LIOREN API (DTE 33/34/61)
-- =========================================================================

-- 1. Extender datos tributarios del receptor en public.comercios_adicional_config
ALTER TABLE public.comercios_adicional_config ADD COLUMN IF NOT EXISTS giro_facturacion TEXT;
ALTER TABLE public.comercios_adicional_config ADD COLUMN IF NOT EXISTS direccion_facturacion TEXT;
ALTER TABLE public.comercios_adicional_config ADD COLUMN IF NOT EXISTS comuna_facturacion TEXT;
ALTER TABLE public.comercios_adicional_config ADD COLUMN IF NOT EXISTS ciudad_facturacion TEXT;
ALTER TABLE public.comercios_adicional_config ADD COLUMN IF NOT EXISTS lioren_comuna_id INTEGER;
ALTER TABLE public.comercios_adicional_config ADD COLUMN IF NOT EXISTS lioren_ciudad_id INTEGER;
ALTER TABLE public.comercios_adicional_config ADD COLUMN IF NOT EXISTS email_facturacion TEXT;

-- 2. Poblar automáticamente giro, dirección, comuna y email desde onboarding_requests cuando estén vacíos
WITH latest_onboarding AS (
  SELECT DISTINCT ON (LOWER(TRIM(nombre_fantasia)))
    nombre_fantasia,
    razon_social,
    rut_empresa,
    giro_comercio,
    direccion_facturacion,
    comuna,
    email_facturacion
  FROM public.onboarding_requests
  ORDER BY LOWER(TRIM(nombre_fantasia)), created_at DESC
)
UPDATE public.comercios_adicional_config cac
SET
  razon_social = COALESCE(NULLIF(TRIM(cac.razon_social), ''), NULLIF(TRIM(ob.razon_social), '')),
  rut = COALESCE(NULLIF(TRIM(cac.rut), ''), NULLIF(TRIM(ob.rut_empresa), '')),
  giro_facturacion = COALESCE(NULLIF(TRIM(cac.giro_facturacion), ''), NULLIF(TRIM(ob.giro_comercio), '')),
  direccion_facturacion = COALESCE(NULLIF(TRIM(cac.direccion_facturacion), ''), NULLIF(TRIM(ob.direccion_facturacion), '')),
  comuna_facturacion = COALESCE(NULLIF(TRIM(cac.comuna_facturacion), ''), NULLIF(TRIM(ob.comuna), '')),
  email_facturacion = COALESCE(NULLIF(TRIM(cac.email_facturacion), ''), NULLIF(TRIM(ob.email_facturacion), ''))
FROM latest_onboarding ob
WHERE (
  LOWER(TRIM(cac.comercio)) = LOWER(TRIM(ob.nombre_fantasia))
  OR (
    NULLIF(REGEXP_REPLACE(LOWER(COALESCE(cac.rut, '')), '[^0-9k]', '', 'g'), '') IS NOT NULL
    AND REGEXP_REPLACE(LOWER(COALESCE(cac.rut, '')), '[^0-9k]', '', 'g') = REGEXP_REPLACE(LOWER(COALESCE(ob.rut_empresa, '')), '[^0-9k]', '', 'g')
  )
);

-- 3. Extender trazabilidad DTE Lioren en public.billing_records (Fulfillment + Envíame)
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS lioren_dte_id_fulfillment BIGINT;
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS lioren_sii_status_fulfillment TEXT;
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS lioren_track_id_fulfillment TEXT;
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS factura_fulfillment_xml_url TEXT;
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS lioren_nc_folio_fulfillment INTEGER;
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS lioren_nc_pdf_url_fulfillment TEXT;

ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS lioren_dte_id_enviame BIGINT;
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS lioren_sii_status_enviame TEXT;
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS lioren_track_id_enviame TEXT;
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS factura_enviame_xml_url TEXT;
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS lioren_nc_folio_enviame INTEGER;
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS lioren_nc_pdf_url_enviame TEXT;

-- 4. Crear bitácora de auditoría de documentos emitidos en Lioren
CREATE TABLE IF NOT EXISTS public.lioren_dte_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID REFERENCES public.billing_records(id) ON DELETE SET NULL,
  period_id UUID REFERENCES public.billing_periods(id) ON DELETE SET NULL,
  comercio TEXT NOT NULL,
  service_type TEXT NOT NULL CHECK (service_type IN ('fulfillment', 'enviame', 'otro')),
  tipodoc TEXT NOT NULL,
  folio INTEGER NOT NULL,
  lioren_dte_id BIGINT,
  environment TEXT NOT NULL DEFAULT 'production',
  receptor_rut TEXT NOT NULL,
  receptor_rs TEXT NOT NULL,
  receptor_giro TEXT,
  receptor_direccion TEXT,
  receptor_comuna_id INTEGER,
  receptor_ciudad_id INTEGER,
  glosa TEXT NOT NULL,
  monto_neto INTEGER NOT NULL DEFAULT 0,
  monto_iva INTEGER NOT NULL DEFAULT 0,
  monto_total INTEGER NOT NULL DEFAULT 0,
  pdf_url TEXT,
  xml_url TEXT,
  sii_status TEXT DEFAULT 'pendiente',
  track_id TEXT,
  ref_folio INTEGER,
  idempotency_key TEXT,
  emitted_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lioren_dte_logs_record_id ON public.lioren_dte_logs(record_id);
CREATE INDEX IF NOT EXISTS idx_lioren_dte_logs_folio_tipodoc ON public.lioren_dte_logs(tipodoc, folio);

ALTER TABLE public.lioren_dte_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins gestionan lioren_dte_logs" ON public.lioren_dte_logs;
CREATE POLICY "Admins gestionan lioren_dte_logs" ON public.lioren_dte_logs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (profiles.role IN ('admin', 'all') OR profiles.is_colaborador = true OR profiles.allowed_modules = 'all')
    )
  );

GRANT ALL ON public.lioren_dte_logs TO postgres, service_role;
GRANT SELECT, INSERT, UPDATE ON public.lioren_dte_logs TO authenticated;
