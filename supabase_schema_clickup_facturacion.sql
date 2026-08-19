-- Schema para la extracción y almacenamiento del Espacio FACTURACION de ClickUp
CREATE TABLE IF NOT EXISTS public.clickup_facturacion (
  task_id TEXT PRIMARY KEY,
  task_name TEXT NOT NULL,
  list_id TEXT NOT NULL,
  list_name TEXT NOT NULL,
  space_id TEXT NOT NULL,
  space_name TEXT NOT NULL,
  status TEXT,
  status_color TEXT,
  comercio TEXT,
  mes TEXT,
  fecha_limite TIMESTAMPTZ,
  desglose_fulfillment TEXT,
  total_fulf NUMERIC(15,2),
  abonos_fulf NUMERIC(15,2),
  pago_fulfillment TEXT,
  factura_fulfillment TEXT,
  n_fact TEXT,
  enviame NUMERIC(15,2),
  abono_env NUMERIC(15,2),
  pago_enviame TEXT,
  fact_enviame TEXT,
  n_fact_env TEXT,
  total NUMERIC(15,2),
  total_fact NUMERIC(15,2),
  monto NUMERIC(15,2),
  ultimo_desglose TIMESTAMPTZ,
  alpha TEXT,
  dif_s TEXT,
  time_formula TEXT,
  date_created TIMESTAMPTZ,
  date_updated TIMESTAMPTZ,
  date_closed TIMESTAMPTZ,
  url TEXT,
  raw_custom_fields JSONB,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_clickup_facturacion_list_name ON public.clickup_facturacion(list_name);
CREATE INDEX IF NOT EXISTS idx_clickup_facturacion_comercio ON public.clickup_facturacion(comercio);
CREATE INDEX IF NOT EXISTS idx_clickup_facturacion_status ON public.clickup_facturacion(status);

-- Habilitar RLS y políticas por defecto para acceso authenticated y service_role
ALTER TABLE public.clickup_facturacion ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'clickup_facturacion' AND policyname = 'Allow all access to authenticated and service_role'
  ) THEN
    CREATE POLICY "Allow all access to authenticated and service_role" 
    ON public.clickup_facturacion 
    FOR ALL 
    TO authenticated, service_role 
    USING (true) 
    WITH CHECK (true);
  END IF;
END $$;
