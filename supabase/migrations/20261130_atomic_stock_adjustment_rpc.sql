-- =========================================================================================
-- AJUSTE ATÓMICO DE STOCK DE BODEGA + EDICIÓN DE MOVIMIENTOS MANUALES EN KARDEX
-- =========================================================================================
-- 1) public.adjust_inventory_stock_atomic:
--    Evita condiciones de carrera / descuadres cuando un ajuste manual coincide con
--    movimientos simultáneos (despachos, recepciones, traslados, webhooks, etc.).
--    Modos soportados:
--      - 'delta': suma o resta unidades sobre el stock real bloqueado en DB (FOR UPDATE).
--                 Soporta fecha personalizada opcional (p_movement_date, no futura).
--      - 'set'  : establece un nivel fijo de stock, calculando el delta real contra el stock
--                 actual bloqueado en DB para que el Kardex siempre cuadre con el saldo real.
--
-- 2) public.edit_manual_kardex_movement:
--    Permite a un Administrador editar fecha, comentario, tipo (in/out) y cantidad de un
--    movimiento creado MANUALMENTE (Ajuste: ...), bloqueando estrictamente movimientos de
--    sistema (pedidos, transferencias, ingresos, tomas de inventario, reversos).
--    Si cambia la cantidad o el tipo, ajusta inventory.quantity atómicamente bajo FOR UPDATE.
-- =========================================================================================

-- Eliminar firma anterior de 4 parámetros para evitar sobrecarga ambigua en PostgREST
DROP FUNCTION IF EXISTS public.adjust_inventory_stock_atomic(UUID, TEXT, JSONB, TEXT);

CREATE OR REPLACE FUNCTION public.adjust_inventory_stock_atomic(
  p_warehouse_id UUID,
  p_mode TEXT,
  p_items JSONB,
  p_comment TEXT,
  p_movement_date TIMESTAMPTZ DEFAULT NULL
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
  v_mov_date TIMESTAMPTZ := NOW();
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

  IF v_mode = 'delta' AND p_movement_date IS NOT NULL THEN
    IF p_movement_date > NOW() + INTERVAL '5 minutes' THEN
      RAISE EXCEPTION 'FECHA_FUTURA: La fecha del movimiento no puede ser futura.';
    END IF;
    v_mov_date := p_movement_date;
  ELSE
    v_mov_date := NOW();
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
      v_mov_date,
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
      'date', v_mov_date,
      'movement_id', v_mov_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'mode', v_mode,
    'movement_date', v_mov_date,
    'updated_count', COALESCE(array_length(v_modified_ids, 1), 0),
    'modified_product_ids', to_jsonb(v_modified_ids),
    'results', v_results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_inventory_stock_atomic(UUID, TEXT, JSONB, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_inventory_stock_atomic(UUID, TEXT, JSONB, TEXT, TIMESTAMPTZ) TO authenticated, service_role;


-- =========================================================================================
-- 2. RPC ATÓMICO: EDITAR MOVIMIENTO MANUAL EN KARDEX (EXCLUSIVO ADMIN)
--    Solo permite editar movimientos manuales ("Ajuste: ..."). Bloquea movimientos de
--    sistema (pedidos, transferencias, ingresos, tomas de inventario, reversos).
-- =========================================================================================
CREATE OR REPLACE FUNCTION public.edit_manual_kardex_movement(
  p_movement_id UUID,
  p_new_type TEXT,
  p_new_quantity INTEGER,
  p_new_date TIMESTAMPTZ,
  p_new_comment TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mov public.movements;
  v_mov_json JSONB;
  v_new_type TEXT := LOWER(TRIM(COALESCE(p_new_type, '')));
  v_clean_comment TEXT := TRIM(COALESCE(p_new_comment, ''));
  v_existing_ref TEXT;
  v_sku TEXT := 'SIN-SKU';
  v_inv_id UUID;
  v_prev_inv_qty INTEGER;
  v_new_inv_qty INTEGER;
  v_old_signed INTEGER;
  v_new_signed INTEGER;
  v_stock_diff INTEGER;
  v_final_ref TEXT;
BEGIN
  -- 1. Validar permisos de Administrador
  IF NOT public.is_admin()
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo un Administrador puede editar movimientos manuales del Kardex.';
  END IF;

  -- 2. Validar parámetros
  IF p_movement_id IS NULL THEN
    RAISE EXCEPTION 'MOVIMIENTO_REQUERIDO: Debes especificar el movimiento a editar.';
  END IF;

  IF v_new_type NOT IN ('in', 'out') THEN
    RAISE EXCEPTION 'TIPO_INVALIDO: El tipo de movimiento debe ser "in" (Entrada) o "out" (Salida).';
  END IF;

  IF p_new_quantity IS NULL OR p_new_quantity <= 0 THEN
    RAISE EXCEPTION 'CANTIDAD_INVALIDA: La cantidad debe ser un número entero mayor a 0.';
  END IF;

  IF p_new_date IS NULL THEN
    RAISE EXCEPTION 'FECHA_REQUERIDA: Debes indicar una fecha y hora válida.';
  END IF;

  IF p_new_date > NOW() + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'FECHA_FUTURA: La fecha del movimiento no puede ser futura.';
  END IF;

  -- Quitar prefijo "Ajuste:" si el cliente lo envió duplicado
  v_clean_comment := TRIM(REGEXP_REPLACE(v_clean_comment, '^\s*Ajuste:\s*', '', 'i'));
  IF LENGTH(v_clean_comment) = 0 THEN
    RAISE EXCEPTION 'COMENTARIO_REQUERIDO: Debes ingresar un comentario de referencia.';
  END IF;

  -- 3. Bloquear fila del movimiento
  SELECT * INTO v_mov
  FROM public.movements
  WHERE id = p_movement_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MOVIMIENTO_NO_ENCONTRADO: El movimiento solicitado no existe.';
  END IF;

  IF v_mov.product_id IS NULL OR v_mov.warehouse_id IS NULL THEN
    RAISE EXCEPTION 'MOVIMIENTO_INCOMPLETO: Este movimiento no tiene producto o bodega asignada.';
  END IF;

  -- 4. Verificar estrictamente que sea un movimiento MANUAL (no de sistema)
  --    Usamos to_jsonb(v_mov) para tolerar columnas opcionales si aún no existen en producción.
  v_mov_json := to_jsonb(v_mov);
  v_existing_ref := TRIM(COALESCE(v_mov.reference_doc, ''));

  IF NULLIF(TRIM(COALESCE(v_mov_json->>'order_id', '')), '') IS NOT NULL THEN
    RAISE EXCEPTION 'MOVIMIENTO_DE_SISTEMA: Este movimiento está vinculado a un pedido y no puede editarse.';
  END IF;

  IF NULLIF(TRIM(COALESCE(v_mov_json->>'transfer_id', '')), '') IS NOT NULL
     OR v_existing_ref ~* '\[#TRF-[A-Z0-9-]+\]' THEN
    RAISE EXCEPTION 'MOVIMIENTO_DE_SISTEMA: Este movimiento pertenece a una transferencia entre bodegas y no puede editarse.';
  END IF;

  IF NULLIF(TRIM(COALESCE(v_mov_json->>'reversed_at', '')), '') IS NOT NULL THEN
    RAISE EXCEPTION 'MOVIMIENTO_REVERSADO: Este movimiento ya fue reversado y no puede editarse.';
  END IF;

  IF NULLIF(TRIM(COALESCE(v_mov_json->>'reversed_from_movement_id', '')), '') IS NOT NULL THEN
    RAISE EXCEPTION 'MOVIMIENTO_DE_SISTEMA: Los contramovimientos de reverso no pueden editarse.';
  END IF;

  IF v_existing_ref !~* '^Ajuste:'
     OR v_existing_ref ~* '\[#ING-[A-Z0-9-]+\]'
     OR v_existing_ref ~* 'Folio\s+'
     OR v_existing_ref ~* 'Reverso\s+Kardex' THEN
    RAISE EXCEPTION 'MOVIMIENTO_DE_SISTEMA: Solo se pueden editar ajustes manuales creados desde "Ajustar Stock" (referencia "Ajuste: ...").';
  END IF;

  SELECT COALESCE(sku, 'SIN-SKU') INTO v_sku
  FROM public.products
  WHERE id = v_mov.product_id;

  -- 5. Calcular diferencia neta de stock y aplicar atómicamente si cambió tipo o cantidad
  v_old_signed := CASE WHEN v_mov.type = 'in' THEN COALESCE(v_mov.quantity, 0) ELSE -COALESCE(v_mov.quantity, 0) END;
  v_new_signed := CASE WHEN v_new_type = 'in' THEN p_new_quantity ELSE -p_new_quantity END;
  v_stock_diff := v_new_signed - v_old_signed;

  IF v_stock_diff <> 0 THEN
    INSERT INTO public.inventory (product_id, warehouse_id, quantity)
    VALUES (v_mov.product_id, v_mov.warehouse_id, 0)
    ON CONFLICT (product_id, warehouse_id) DO NOTHING;

    SELECT id, COALESCE(quantity, 0)
    INTO v_inv_id, v_prev_inv_qty
    FROM public.inventory
    WHERE product_id = v_mov.product_id
      AND warehouse_id = v_mov.warehouse_id
    FOR UPDATE;

    v_new_inv_qty := v_prev_inv_qty + v_stock_diff;
    IF v_new_inv_qty < 0 THEN
      RAISE EXCEPTION 'STOCK_INSUFICIENTE: No se puede aplicar esta edición al SKU % porque el stock físico actual en bodega es % y la diferencia (%) lo dejaría negativo (%).',
        v_sku, v_prev_inv_qty, v_stock_diff, v_new_inv_qty;
    END IF;

    UPDATE public.inventory
    SET quantity = v_new_inv_qty,
        updated_at = NOW()
    WHERE id = v_inv_id;
  ELSE
    SELECT COALESCE(quantity, 0)
    INTO v_new_inv_qty
    FROM public.inventory
    WHERE product_id = v_mov.product_id
      AND warehouse_id = v_mov.warehouse_id;
    v_prev_inv_qty := COALESCE(v_new_inv_qty, 0);
    v_new_inv_qty := v_prev_inv_qty;
  END IF;

  -- 6. Actualizar el movimiento en Kardex
  v_final_ref := 'Ajuste: ' || v_clean_comment;

  UPDATE public.movements
  SET type = v_new_type,
      quantity = p_new_quantity,
      date = p_new_date,
      reference_doc = v_final_ref
  WHERE id = v_mov.id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'movement_id', v_mov.id,
    'product_id', v_mov.product_id,
    'warehouse_id', v_mov.warehouse_id,
    'sku', v_sku,
    'old_type', v_mov.type,
    'new_type', v_new_type,
    'old_quantity', v_mov.quantity,
    'new_quantity', p_new_quantity,
    'stock_diff', v_stock_diff,
    'previous_inventory_quantity', v_prev_inv_qty,
    'new_inventory_quantity', v_new_inv_qty,
    'date', p_new_date,
    'reference_doc', v_final_ref
  );
END;
$$;

REVOKE ALL ON FUNCTION public.edit_manual_kardex_movement(UUID, TEXT, INTEGER, TIMESTAMPTZ, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edit_manual_kardex_movement(UUID, TEXT, INTEGER, TIMESTAMPTZ, TEXT) TO authenticated, service_role;
