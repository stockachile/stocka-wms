-- ==============================================================================
-- Migración: Estado Activo / Inactivo General de Comercios
-- WMS STOCKA
-- Nota: Independiente de commerce_billing_status.al_dia (pausa por cobranza/mora)
-- ==============================================================================

-- 1. Agregar columnas de estado operativo del comercio a comercios_adicional_config
ALTER TABLE IF EXISTS public.comercios_adicional_config
ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS inactivado_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS motivo_inactivacion TEXT;

COMMENT ON COLUMN public.comercios_adicional_config.activo IS
'Indica si el comercio se encuentra activo en el WMS (true) o dado de baja/desactivado (false). Independiente de commerce_billing_status.al_dia.';

COMMENT ON COLUMN public.comercios_adicional_config.inactivado_at IS
'Fecha y hora en que el comercio fue desactivado.';

COMMENT ON COLUMN public.comercios_adicional_config.motivo_inactivacion IS
'Motivo opcional registrado al desactivar el comercio.';

-- 2. Sincronizar estado si existía previamente en onboarding_checklist JSONB
UPDATE public.comercios_adicional_config
SET
  activo = COALESCE((onboarding_checklist->>'comercio_activo')::boolean, true),
  inactivado_at = CASE
    WHEN onboarding_checklist->>'inactivado_at' IS NOT NULL AND onboarding_checklist->>'inactivado_at' <> ''
    THEN (onboarding_checklist->>'inactivado_at')::timestamptz
    ELSE inactivado_at
  END,
  motivo_inactivacion = COALESCE(onboarding_checklist->>'motivo_inactivacion', motivo_inactivacion)
WHERE onboarding_checklist IS NOT NULL
  AND onboarding_checklist ? 'comercio_activo';
