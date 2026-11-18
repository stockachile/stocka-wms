-- =========================================================================================
-- WMS STOCKA - MIGRACIÓN: BLOQUEO OPERATIVO "EN ESPERA" EN TORRE DE CONTROL
-- Permite establecer que un pedido en estado "En procesamiento" quede EN ESPERA,
-- mostrando aviso visual en Torre de Control y bloqueando estrictamente su avance
-- hacia "En preparación" (y estados posteriores de despacho/preparación) hasta liberar la espera.
-- Fecha: 2026-11-20
-- =========================================================================================

-- 1. Columnas dedicadas en public.orders para trazabilidad y bloqueo rápido
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS wms_on_hold BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS wms_on_hold_reason TEXT,
  ADD COLUMN IF NOT EXISTS wms_on_hold_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS wms_on_hold_by TEXT;

COMMENT ON COLUMN public.orders.wms_on_hold IS
  'Indica si el pedido está retenido EN ESPERA en Torre de Control y tiene bloqueado su avance desde "En procesamiento" hacia "En preparación" o estados posteriores.';

COMMENT ON COLUMN public.orders.wms_on_hold_reason IS
  'Motivo operativo registrado al poner el pedido en espera en Torre de Control.';

COMMENT ON COLUMN public.orders.wms_on_hold_at IS
  'Fecha y hora en que se activó el bloqueo de espera en Torre de Control.';

COMMENT ON COLUMN public.orders.wms_on_hold_by IS
  'Correo o identificador del administrador que estableció el pedido en espera.';

CREATE INDEX IF NOT EXISTS idx_orders_wms_on_hold
  ON public.orders (estado_wms, created_at DESC)
  WHERE wms_on_hold = TRUE;

-- 2. Backfill inicial en caso de pedidos que ya tengan la marca en JSONB raw_*_data
UPDATE public.orders
SET
  wms_on_hold = TRUE,
  wms_on_hold_reason = COALESCE(
    wms_on_hold_reason,
    raw_shopify_data->'wms_on_hold'->>'reason',
    raw_woocommerce_data->'wms_on_hold'->>'reason',
    raw_meli_data->'wms_on_hold'->>'reason',
    raw_falabella_data->'wms_on_hold'->>'reason',
    raw_jumpseller_data->'wms_on_hold'->>'reason',
    raw_tiendanube_data->'wms_on_hold'->>'reason',
    raw_paris_data->'wms_on_hold'->>'reason',
    raw_ripley_data->'wms_on_hold'->>'reason',
    raw_walmart_data->'wms_on_hold'->>'reason'
  ),
  wms_on_hold_by = COALESCE(
    wms_on_hold_by,
    raw_shopify_data->'wms_on_hold'->>'set_by',
    raw_woocommerce_data->'wms_on_hold'->>'set_by',
    raw_meli_data->'wms_on_hold'->>'set_by',
    raw_falabella_data->'wms_on_hold'->>'set_by',
    raw_jumpseller_data->'wms_on_hold'->>'set_by',
    raw_tiendanube_data->'wms_on_hold'->>'set_by',
    raw_paris_data->'wms_on_hold'->>'set_by',
    raw_ripley_data->'wms_on_hold'->>'set_by',
    raw_walmart_data->'wms_on_hold'->>'set_by'
  )
WHERE wms_on_hold = FALSE
  AND (
    COALESCE((raw_shopify_data->'wms_on_hold'->>'active')::boolean, FALSE)
    OR COALESCE((raw_woocommerce_data->'wms_on_hold'->>'active')::boolean, FALSE)
    OR COALESCE((raw_meli_data->'wms_on_hold'->>'active')::boolean, FALSE)
    OR COALESCE((raw_falabella_data->'wms_on_hold'->>'active')::boolean, FALSE)
    OR COALESCE((raw_jumpseller_data->'wms_on_hold'->>'active')::boolean, FALSE)
    OR COALESCE((raw_tiendanube_data->'wms_on_hold'->>'active')::boolean, FALSE)
    OR COALESCE((raw_paris_data->'wms_on_hold'->>'active')::boolean, FALSE)
    OR COALESCE((raw_ripley_data->'wms_on_hold'->>'active')::boolean, FALSE)
    OR COALESCE((raw_walmart_data->'wms_on_hold'->>'active')::boolean, FALSE)
  );

-- 3. Función y Trigger BEFORE UPDATE para bloquear el avance desde "En procesamiento"
--    hacia "En preparación" (o estados posteriores de armado/despacho) cuando wms_on_hold = TRUE
CREATE OR REPLACE FUNCTION public.enforce_wms_on_hold_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_wms TEXT := COALESCE(OLD.estado_wms, 'En procesamiento');
  v_new_wms TEXT := COALESCE(NEW.estado_wms, 'En procesamiento');
  v_is_releasing BOOLEAN := (COALESCE(OLD.wms_on_hold, FALSE) = TRUE AND COALESCE(NEW.wms_on_hold, FALSE) = FALSE);
  v_json_hold BOOLEAN := FALSE;
  v_effective_hold BOOLEAN := FALSE;
  v_reason TEXT := '';
BEGIN
  IF NOT v_is_releasing THEN
    v_json_hold := (
      COALESCE((NEW.raw_shopify_data->'wms_on_hold'->>'active')::boolean, FALSE)
      OR COALESCE((NEW.raw_woocommerce_data->'wms_on_hold'->>'active')::boolean, FALSE)
      OR COALESCE((NEW.raw_meli_data->'wms_on_hold'->>'active')::boolean, FALSE)
      OR COALESCE((NEW.raw_falabella_data->'wms_on_hold'->>'active')::boolean, FALSE)
      OR COALESCE((NEW.raw_jumpseller_data->'wms_on_hold'->>'active')::boolean, FALSE)
      OR COALESCE((NEW.raw_tiendanube_data->'wms_on_hold'->>'active')::boolean, FALSE)
      OR COALESCE((NEW.raw_paris_data->'wms_on_hold'->>'active')::boolean, FALSE)
      OR COALESCE((NEW.raw_ripley_data->'wms_on_hold'->>'active')::boolean, FALSE)
      OR COALESCE((NEW.raw_walmart_data->'wms_on_hold'->>'active')::boolean, FALSE)
    );
  END IF;

  v_effective_hold := COALESCE(NEW.wms_on_hold, FALSE) OR v_json_hold;

  IF v_effective_hold
     AND v_old_wms = 'En procesamiento'
     AND v_new_wms IN ('En preparación', 'Pickeado', 'Listo para retiro', 'Despachado', 'Entregado')
  THEN
    v_reason := COALESCE(
      NULLIF(TRIM(COALESCE(NEW.wms_on_hold_reason, '')), ''),
      NULLIF(TRIM(COALESCE(NEW.raw_shopify_data->'wms_on_hold'->>'reason', '')), ''),
      NULLIF(TRIM(COALESCE(NEW.raw_woocommerce_data->'wms_on_hold'->>'reason', '')), ''),
      NULLIF(TRIM(COALESCE(NEW.raw_meli_data->'wms_on_hold'->>'reason', '')), ''),
      NULLIF(TRIM(COALESCE(NEW.raw_falabella_data->'wms_on_hold'->>'reason', '')), ''),
      NULLIF(TRIM(COALESCE(NEW.raw_jumpseller_data->'wms_on_hold'->>'reason', '')), ''),
      NULLIF(TRIM(COALESCE(NEW.raw_tiendanube_data->'wms_on_hold'->>'reason', '')), ''),
      ''
    );

    RAISE EXCEPTION 'PEDIDO_EN_ESPERA_BLOQUEADO: El pedido % está establecido EN ESPERA en Torre de Control y no debe avanzar de "En procesamiento" hacia "%"% Libera primero la espera para poder prepararlo.',
      COALESCE(OLD.external_order_number, OLD.id::text),
      v_new_wms,
      CASE WHEN v_reason <> '' THEN ' (Motivo: ' || v_reason || ').' ELSE '.' END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ab_03_enforce_wms_on_hold_block ON public.orders;
CREATE TRIGGER ab_03_enforce_wms_on_hold_block
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_wms_on_hold_block();
