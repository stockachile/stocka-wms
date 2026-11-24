-- =========================================================================================
-- AJUSTE ATÓMICO DE STOCK DE BODEGA (POR MOVIMIENTO +/- Y POR NIVEL FIJO)
-- =========================================================================================
-- Evita condiciones de carrera / descuadres cuando un ajuste manual coincide con
-- movimientos simultáneos (despachos, recepciones, traslados, webhooks, etc.).
--
-- Modos soportados:
--   - 'delta': suma o resta unidades sobre el stock real bloqueado en DB (FOR UPDATE).
--              Ej: +2 unidades, -1 unidad por falla. Nunca sobrescribe movimientos paralelos.
--   - 'set'  : establece un nivel fijo de stock, calculando el delta real contra el stock
--              actual bloqueado en DB para que el Kardex siempre cuadre con el saldo real.
-- =========================================================================================

CREATE OR REPLACE FUNCTION public.adjust_inventory_stock_atomic(
  p_warehouse_id UUID,
  p_mode TEXT,
  p_items JSONB,
  p_comment TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode TEXT := LOWER(TRIM(COALESCE(p_mode, 'delta')));
  v_clean_comment TEXT := TRIM(COALESCE(p_comment, ''));
  v_caller_uid UUID := auth.uid();
  v_is_privileged BOOLEAN := FALSE;
  v_profile_comercio TEXT := '';
  v_wh_exists BOOLEAN := FALSE;
  v_item RECORD;
  v_prod RECORD;
  v_inv_id UUID;
  v_prev_qty INTEGER;
  v_delta INTEGER;
  v_new_qty INTEGER;
  v_mov_type TEXT;
  v_mov_id UUID;
  v_modified_ids UUID[] := ARRAY[]::UUID[];
  v_results JSONB := '[]'::JSONB;
BEGIN
  -- 1. Validaciones básicas de parámetros
  IF p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'BODEGA_REQUERIDA: Debes seleccionar una bodega destino.';
  END IF;

  IF v_mode NOT IN ('delta', 'set') THEN
    RAISE EXCEPTION 'MODO_INVALIDO: Modo de ajuste no soportado (%). Usa "delta" o "set".', v_mode;
  END IF;

  IF LENGTH(v_clean_comment) = 0 THEN
    RAISE EXCEPTION 'COMENTARIO_REQUERIDO: Debes ingresar un comentario de referencia.';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'ITEMS_REQUERIDOS: Debes incluir al menos un producto para ajustar.';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.warehouses WHERE id = p_warehouse_id) INTO v_wh_exists;
  IF NOT v_wh_exists THEN
    RAISE EXCEPTION 'BODEGA_NO_ENCONTRADA: La bodega seleccionada no existe.';
  END IF;

  -- 2. Validar autenticación y permisos del usuario (Admin o Comercio dueño del producto)
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
     OR current_user IN ('postgres', 'service_role') THEN
    v_is_privileged := TRUE;
  ELSE
    IF v_caller_uid IS NULL THEN
      RAISE EXCEPTION 'NO_AUTENTICADO: Debes iniciar sesión para ajustar el stock.';
    END IF;

    IF public.is_admin() THEN
      v_is_privileged := TRUE;
    END IF;

    SELECT COALESCE(comercio, '')
    INTO v_profile_comercio
    FROM public.profiles
    WHERE id = v_caller_uid;

    IF LOWER(TRIM(COALESCE(v_profile_comercio, ''))) = 'all' THEN
      v_is_privileged := TRUE;
    END IF;
  END IF;

  -- 3. Recorrer ítems en orden determinista por product_id para evitar deadlocks
  FOR v_item IN
    SELECT
      (elem->>'product_id')::UUID AS product_id,
      NULLIF(TRIM(COALESCE(elem->>'delta', '')), '')::INTEGER AS delta_val,
      NULLIF(TRIM(COALESCE(elem->>'target_quantity', '')), '')::INTEGER AS target_val
    FROM jsonb_array_elements(p_items) AS elem
    WHERE NULLIF(TRIM(COALESCE(elem->>'product_id', '')), '') IS NOT NULL
    ORDER BY (elem->>'product_id')::UUID
  LOOP
    -- Validar producto y autorización multi-comercio
    SELECT id, COALESCE(sku, 'SIN-SKU') AS sku, COALESCE(name, 'Producto') AS name, COALESCE(comercio, '') AS comercio
    INTO v_prod
    FROM public.products
    WHERE id = v_item.product_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCTO_NO_ENCONTRADO: El producto % no existe.', v_item.product_id;
    END IF;

    IF NOT v_is_privileged THEN
      IF NOT (
        LOWER(v_prod.comercio) = ANY (
          SELECT TRIM(LOWER(token))
          FROM unnest(string_to_array(COALESCE(v_profile_comercio, ''), ',')) AS token
        )
      ) THEN
        RAISE EXCEPTION 'ACCESO_DENEGADO: No tienes permisos para ajustar el stock del SKU %.', v_prod.sku;
      END IF;
    END IF;

    -- En modo delta, omitir ítems sin variación antes de tocar inventory
    IF v_mode = 'delta' AND COALESCE(v_item.delta_val, 0) = 0 THEN
      CONTINUE;
    END IF;
    IF v_mode = 'set' AND v_item.target_val IS NULL THEN
      CONTINUE;
    END IF;

    -- Asegurar fila en inventory y bloquearla atómicamente (FOR UPDATE)
    INSERT INTO public.inventory (product_id, warehouse_id, quantity)
    VALUES (v_prod.id, p_warehouse_id, 0)
    ON CONFLICT (product_id, warehouse_id) DO NOTHING;

    SELECT id, COALESCE(quantity, 0)
    INTO v_inv_id, v_prev_qty
    FROM public.inventory
    WHERE product_id = v_prod.id
      AND warehouse_id = p_warehouse_id
    FOR UPDATE;

    -- Calcular nuevo saldo y delta real bajo bloqueo
    IF v_mode = 'delta' THEN
      v_delta := COALESCE(v_item.delta_val, 0);
      IF v_delta = 0 THEN
        CONTINUE;
      END IF;

      v_new_qty := v_prev_qty + v_delta;
      IF v_new_qty < 0 THEN
        RAISE EXCEPTION 'STOCK_INSUFICIENTE: No se puede restar % un. al SKU % porque su stock actual en bodega es % (el stock no puede quedar negativo).',
          ABS(v_delta), v_prod.sku, v_prev_qty;
      END IF;
    ELSE
      IF v_item.target_val IS NULL THEN
        CONTINUE;
      END IF;

      v_new_qty := v_item.target_val;
      IF v_new_qty < 0 THEN
        RAISE EXCEPTION 'STOCK_NEGATIVO: El nuevo stock para el SKU % no puede ser negativo.', v_prod.sku;
      END IF;

      v_delta := v_new_qty - v_prev_qty;
      IF v_delta = 0 THEN
        CONTINUE;
      END IF;
    END IF;

    -- Actualizar saldo físico
    UPDATE public.inventory
    SET quantity = v_new_qty,
        updated_at = NOW()
    WHERE id = v_inv_id;

    -- Registrar movimiento exacto en Kardex
    v_mov_type := CASE WHEN v_delta > 0 THEN 'in' ELSE 'out' END;

    INSERT INTO public.movements (
      product_id,
      warehouse_id,
      type,
      quantity,
      date,
      reference_doc
    ) VALUES (
      v_prod.id,
      p_warehouse_id,
      v_mov_type,
      ABS(v_delta),
      NOW(),
      'Ajuste: ' || v_clean_comment
    )
    RETURNING id INTO v_mov_id;

    v_modified_ids := array_append(v_modified_ids, v_prod.id);
    v_results := v_results || jsonb_build_object(
      'product_id', v_prod.id,
      'sku', v_prod.sku,
      'previous_quantity', v_prev_qty,
      'delta', v_delta,
      'new_quantity', v_new_qty,
      'type', v_mov_type,
      'movement_id', v_mov_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'mode', v_mode,
    'updated_count', COALESCE(array_length(v_modified_ids, 1), 0),
    'modified_product_ids', to_jsonb(v_modified_ids),
    'results', v_results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_inventory_stock_atomic(UUID, TEXT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_inventory_stock_atomic(UUID, TEXT, JSONB, TEXT) TO authenticated, service_role;
