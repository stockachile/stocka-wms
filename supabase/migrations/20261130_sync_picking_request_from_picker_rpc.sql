-- Migration: 20261130_sync_picking_request_from_picker_rpc.sql
-- Permite al cliente Picker (rol anon) sincronizar de forma segura el estado de verificación
-- de Solicitudes Especiales de Picking hacia order_picking_requests y orders en WMS,
-- propagando automáticamente la confirmación a todos los pedidos hermanos consolidados.

CREATE OR REPLACE FUNCTION public.sync_picking_request_from_picker(
  p_external_order_numbers text[],
  p_items jsonb,
  p_status text,
  p_operator text DEFAULT NULL,
  p_completed_at timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_ids uuid[];
  v_req record;
  v_updated_items jsonb;
  v_eff_completed_at timestamptz := COALESCE(p_completed_at, now());
BEGIN
  IF p_external_order_numbers IS NULL OR array_length(p_external_order_numbers, 1) IS NULL THEN
    RETURN;
  END IF;

  -- 1. Resolver IDs de órdenes directas y de cualquier pedido hermano consolidado
  SELECT array_agg(DISTINCT o.id)
  INTO v_order_ids
  FROM public.orders o
  WHERE o.external_order_number = ANY(p_external_order_numbers)
     OR ltrim(o.external_order_number, '#') = ANY(p_external_order_numbers)
     OR o.consolidated_into_order_id IN (
          SELECT p.id FROM public.orders p
          WHERE p.external_order_number = ANY(p_external_order_numbers)
             OR ltrim(p.external_order_number, '#') = ANY(p_external_order_numbers)
        );

  IF v_order_ids IS NULL OR array_length(v_order_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  -- 2. Actualizar cada solicitud de picking asociada
  FOR v_req IN
    SELECT id, order_id, external_order_number, items
    FROM public.order_picking_requests
    WHERE order_id = ANY(v_order_ids)
       OR external_order_number = ANY(p_external_order_numbers)
  LOOP
    IF p_status = 'completada' AND jsonb_typeof(v_req.items) = 'array' AND jsonb_array_length(v_req.items) > 0 THEN
      -- Marcar todos los ítems de la solicitud (incluyendo los de pedidos secundarios consolidados) como verificados
      SELECT jsonb_agg(
        CASE
          WHEN COALESCE((elem->>'discarded')::boolean, false) THEN elem
          ELSE elem || jsonb_build_object(
            'checked', true,
            'checked_by', COALESCE(NULLIF(elem->>'checked_by', ''), COALESCE(p_operator, 'Picker')),
            'checked_at', COALESCE(NULLIF(elem->>'checked_at', ''), to_jsonb(v_eff_completed_at)#>>'{}')
          )
        END
      )
      INTO v_updated_items
      FROM jsonb_array_elements(v_req.items) AS elem;
    ELSE
      v_updated_items := COALESCE(p_items, v_req.items);
    END IF;

    UPDATE public.order_picking_requests
    SET items = COALESCE(v_updated_items, items),
        status = p_status,
        completed_by_operator = CASE WHEN p_status = 'completada' THEN COALESCE(p_operator, completed_by_operator) ELSE completed_by_operator END,
        completed_at = CASE WHEN p_status = 'completada' THEN COALESCE(v_eff_completed_at, completed_at) ELSE completed_at END,
        updated_at = now()
    WHERE id = v_req.id;
  END LOOP;

  -- 3. Actualizar columna resumen en orders
  UPDATE public.orders
  SET picking_request_status = p_status
  WHERE id = ANY(v_order_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_picking_request_from_picker(text[], jsonb, text, text, timestamptz) TO anon, authenticated, service_role;

-- =====================================================================================
-- Trigger en public.orders: Propagación automática desde Pedido Ancla (Principal)
-- hacia Pedidos Secundarios Consolidados cuando se actualizan por crons/webhooks/UI
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.fn_propagate_consolidated_primary_to_children()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Evitar recursión infinita y actuar solo cuando el pedido actualizado es un Pedido Principal Consolidado
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.is_consolidated IS TRUE AND NEW.consolidated_into_order_id IS NULL THEN
    IF (NEW.tracking_number IS DISTINCT FROM OLD.tracking_number)
       OR (NEW.tracking_url IS DISTINCT FROM OLD.tracking_url)
       OR (NEW.courier IS DISTINCT FROM OLD.courier)
       OR (NEW.operador IS DISTINCT FROM OLD.operador)
       OR (NEW.agenda IS DISTINCT FROM OLD.agenda)
       OR (NEW.sucursal_pickeo IS DISTINCT FROM OLD.sucursal_pickeo)
       OR (NEW.estado_wms IS DISTINCT FROM OLD.estado_wms)
       OR (NEW.status IS DISTINCT FROM OLD.status)
       OR (NEW.delivered_at IS DISTINCT FROM OLD.delivered_at)
       OR (NEW.closed_at IS DISTINCT FROM OLD.closed_at)
    THEN
      UPDATE public.orders
      SET tracking_number     = COALESCE(NEW.tracking_number, tracking_number),
          tracking_url        = COALESCE(NEW.tracking_url, tracking_url),
          courier             = COALESCE(NEW.courier, courier),
          operador            = COALESCE(NEW.operador, operador),
          agenda              = COALESCE(NEW.agenda, agenda),
          sucursal_pickeo     = COALESCE(NEW.sucursal_pickeo, sucursal_pickeo),
          estado_wms          = COALESCE(NEW.estado_wms, estado_wms),
          status              = COALESCE(NEW.status, status),
          stock_descontado    = COALESCE(NEW.stock_descontado, stock_descontado),
          ready_for_pickup_at = COALESCE(NEW.ready_for_pickup_at, ready_for_pickup_at),
          delivered_at        = COALESCE(NEW.delivered_at, delivered_at),
          closed_at           = COALESCE(NEW.closed_at, closed_at)
      WHERE consolidated_into_order_id = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_consolidated_primary_to_children ON public.orders;
CREATE TRIGGER trg_propagate_consolidated_primary_to_children
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_propagate_consolidated_primary_to_children();
