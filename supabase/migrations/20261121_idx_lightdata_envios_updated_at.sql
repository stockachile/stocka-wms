-- Índice para acelerar las consultas de monitoreo reciente y detección de volcados en lightdata_envios
-- Evita Sequential Scans y statement timeouts (57014) en el panel de monitoreo WMS
CREATE INDEX IF NOT EXISTS idx_lightdata_envios_updated_at
  ON public.lightdata_envios (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_lightdata_envios_updated_at_with_tracking
  ON public.lightdata_envios (updated_at DESC)
  WHERE tracking IS NOT NULL;
