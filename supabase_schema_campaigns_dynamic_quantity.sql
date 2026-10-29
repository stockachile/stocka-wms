-- ==============================================================================
-- MIGRACIÓN: CANTIDAD DINÁMICA EN CAMPAÑAS DE REGALO (WMS STOCKA)
-- Modos soportados en gift_quantity_mode:
--   - 'fixed': Cantidad fija definida en gift_quantity (por defecto)
--   - 'order_products_qty': Igual a la cantidad de productos del pedido (sin contar regalos de otras campañas)
--   - 'order_total_qty': Igual a la cantidad total de artículos del pedido (contando productos + regalos de otras campañas)
-- ==============================================================================

-- 1. Agregar columna gift_quantity_mode a public.campaigns
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS gift_quantity_mode VARCHAR(50) DEFAULT 'fixed' NOT NULL;

-- 2. Eliminar trigger redundante de actualización de cantidad si existe (handle_update_order_item ya gestiona el stock)
DROP TRIGGER IF EXISTS on_order_item_quantity_updated ON public.order_items;

-- 3. Función auxiliar para calcular la cantidad de unidades de regalo que corresponden a un pedido
CREATE OR REPLACE FUNCTION public.calculate_campaign_gift_quantity(
  p_order_id UUID,
  p_campaign_id UUID,
  p_override_mode VARCHAR DEFAULT NULL,
  p_override_qty INTEGER DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  v_campaign RECORD;
  v_mode VARCHAR(50);
  v_fixed_qty INTEGER;
  v_calculated_qty INTEGER := 0;
BEGIN
  SELECT * INTO v_campaign FROM public.campaigns WHERE id = p_campaign_id;
  IF v_campaign.id IS NULL THEN
    RETURN 0;
  END IF;

  v_mode := COALESCE(p_override_mode, v_campaign.gift_quantity_mode, 'fixed');
  v_fixed_qty := COALESCE(p_override_qty, v_campaign.gift_quantity, 1);

  IF v_mode = 'order_products_qty' THEN
    -- Suma solo artículos que son productos propios del pedido (excluye ítems añadidos por campañas)
    SELECT COALESCE(SUM(oi.quantity), 0) INTO v_calculated_qty
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND COALESCE(oi.is_gift, FALSE) = FALSE
      AND oi.campaign_id IS NULL
      AND COALESCE(oi.tag, '') != 'Campaña';

  ELSIF v_mode = 'order_total_qty' THEN
    -- Suma todos los artículos del pedido (productos + ítems añadidos por otras campañas),
    -- excluyendo únicamente el ítem de esta misma campaña
    SELECT COALESCE(SUM(oi.quantity), 0) INTO v_calculated_qty
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND (oi.campaign_id IS NULL OR oi.campaign_id != p_campaign_id);

  ELSE
    -- Modo 'fixed' (cantidad fija)
    v_calculated_qty := GREATEST(1, v_fixed_qty);
  END IF;

  RETURN GREATEST(0, COALESCE(v_calculated_qty, 0));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4. Actualizar expand_pack_order_items() para no fusionar regalos de campaña con ítems regulares ni entre campañas distintas
CREATE OR REPLACE FUNCTION public.expand_pack_order_items()
RETURNS trigger AS $$
DECLARE
  pack_member RECORD;
  is_product_pack BOOLEAN;
  v_existing_id UUID;
BEGIN
  -- Si es un regalo de campaña, consolidar únicamente si ya existe una fila para la MISMA campaña
  IF COALESCE(NEW.is_gift, FALSE) = TRUE OR NEW.campaign_id IS NOT NULL OR COALESCE(NEW.tag, '') = 'Campaña' THEN
    IF NEW.campaign_id IS NOT NULL THEN
      SELECT id INTO v_existing_id
      FROM public.order_items
      WHERE order_id = NEW.order_id
        AND product_id = NEW.product_id
        AND campaign_id = NEW.campaign_id
      LIMIT 1;

      IF v_existing_id IS NOT NULL THEN
        UPDATE public.order_items
        SET quantity = NEW.quantity
        WHERE id = v_existing_id;
        RETURN NULL;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- Verificar si el producto que se está insertando es un pack
  SELECT is_pack INTO is_product_pack
  FROM public.products
  WHERE id = NEW.product_id;

  IF is_product_pack = TRUE THEN
    -- Si es un pack, buscar todos sus componentes
    FOR pack_member IN 
      SELECT member_product_id, quantity 
      FROM public.product_pack_items 
      WHERE pack_product_id = NEW.product_id
    LOOP
      -- Verificar si ya existe una fila regular (no regalo) para este componente en la orden y bodega
      SELECT id INTO v_existing_id
      FROM public.order_items
      WHERE order_id = NEW.order_id
        AND product_id = pack_member.member_product_id
        AND (warehouse_id IS NOT DISTINCT FROM NEW.warehouse_id)
        AND COALESCE(is_gift, FALSE) = FALSE
        AND campaign_id IS NULL
      LIMIT 1;

      IF v_existing_id IS NOT NULL THEN
        UPDATE public.order_items
        SET quantity = quantity + (NEW.quantity * pack_member.quantity)
        WHERE id = v_existing_id;
      ELSE
        INSERT INTO public.order_items (order_id, product_id, warehouse_id, quantity)
        VALUES (NEW.order_id, pack_member.member_product_id, NEW.warehouse_id, NEW.quantity * pack_member.quantity);
      END IF;
    END LOOP;

    -- Retornar NULL para cancelar la inserción del producto pack en sí
    RETURN NULL;
  END IF;

  -- Si no es un pack, verificar si ya existía una fila regular (no regalo) para el mismo producto en la orden para consolidar
  SELECT id INTO v_existing_id
  FROM public.order_items
  WHERE order_id = NEW.order_id
    AND product_id = NEW.product_id
    AND (warehouse_id IS NOT DISTINCT FROM NEW.warehouse_id)
    AND COALESCE(is_gift, FALSE) = FALSE
    AND campaign_id IS NULL
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.order_items
    SET quantity = quantity + NEW.quantity
    WHERE id = v_existing_id;
    RETURN NULL;
  END IF;

  -- Proceder con la inserción normal
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 5. Actualizar validación de condiciones del pedido (evaluando productos del pedido en condiciones de cantidad/SKUs)
CREATE OR REPLACE FUNCTION public.order_matches_campaign_conditions(
  p_order_id UUID,
  p_campaign_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_campaign RECORD;
  v_order RECORD;
  v_total_quantity INTEGER;
  v_distinct_skus INTEGER;
  v_has_trigger_sku BOOLEAN;
  v_condition RECORD;
  v_field TEXT;
  v_op TEXT;
  v_val TEXT;
  v_actual_val TEXT;
  v_actual_numeric NUMERIC;
  v_val_numeric NUMERIC;
BEGIN
  -- Cargar campaña
  SELECT * INTO v_campaign FROM public.campaigns WHERE id = p_campaign_id;
  IF v_campaign.id IS NULL OR v_campaign.active = FALSE THEN
    RETURN FALSE;
  END IF;

  -- Cargar pedido
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Validar comercio
  IF LOWER(TRIM(v_order.comercio)) != LOWER(TRIM(v_campaign.comercio)) THEN
    RETURN FALSE;
  END IF;

  -- Validar fechas de vigencia contra fecha de creación del pedido
  IF v_campaign.start_date IS NOT NULL AND v_order.created_at < v_campaign.start_date THEN
    RETURN FALSE;
  END IF;
  IF v_campaign.end_date IS NOT NULL AND v_order.created_at > v_campaign.end_date THEN
    RETURN FALSE;
  END IF;

  -- Condición 1: SKUs disparadores (evaluando productos comprados del pedido)
  IF v_campaign.trigger_skus IS NOT NULL AND cardinality(v_campaign.trigger_skus) > 0 THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.order_items oi
      JOIN public.products p ON oi.product_id = p.id
      WHERE oi.order_id = p_order_id
        AND COALESCE(oi.is_gift, FALSE) = FALSE
        AND oi.campaign_id IS NULL
        AND LOWER(TRIM(p.sku)) = ANY (
          SELECT LOWER(TRIM(u)) FROM unnest(v_campaign.trigger_skus) u
        )
    ) INTO v_has_trigger_sku;

    IF NOT v_has_trigger_sku THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- Condición 2: Cantidad mínima total de unidades (de productos comprados)
  IF v_campaign.min_total_quantity IS NOT NULL AND v_campaign.min_total_quantity > 0 THEN
    SELECT COALESCE(SUM(quantity), 0) INTO v_total_quantity
    FROM public.order_items
    WHERE order_id = p_order_id
      AND COALESCE(is_gift, FALSE) = FALSE
      AND campaign_id IS NULL;

    IF v_total_quantity < v_campaign.min_total_quantity THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- Condición 3: Cantidad mínima de SKUs distintos (de productos comprados)
  IF v_campaign.min_distinct_skus IS NOT NULL AND v_campaign.min_distinct_skus > 0 THEN
    SELECT COUNT(DISTINCT product_id) INTO v_distinct_skus
    FROM public.order_items
    WHERE order_id = p_order_id
      AND COALESCE(is_gift, FALSE) = FALSE
      AND campaign_id IS NULL;

    IF v_distinct_skus < v_campaign.min_distinct_skus THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- Condición 4: Condiciones basadas en parámetros del pedido (JSONB conditions)
  IF v_campaign.conditions IS NOT NULL AND jsonb_array_length(v_campaign.conditions) > 0 THEN
    FOR v_condition IN SELECT * FROM jsonb_to_recordset(v_campaign.conditions) AS x(field TEXT, operator TEXT, value TEXT) LOOP
      v_field := v_condition.field;
      v_op := v_condition.operator;
      v_val := COALESCE(v_condition.value, '');

      IF v_field = 'customer_name' THEN
        v_actual_val := v_order.customer_name;
      ELSIF v_field = 'customer_email' THEN
        v_actual_val := v_order.customer_email;
      ELSIF v_field = 'customer_phone' THEN
        v_actual_val := v_order.customer_phone;
      ELSIF v_field = 'shipping_city' THEN
        v_actual_val := v_order.shipping_city;
      ELSIF v_field = 'shipping_address' THEN
        v_actual_val := v_order.shipping_address;
      ELSIF v_field = 'shipping_method' THEN
        v_actual_val := v_order.shipping_method;
      ELSIF v_field = 'external_platform' THEN
        v_actual_val := v_order.external_platform;
      ELSIF v_field = 'total_value' THEN
        v_actual_val := v_order.total_value::TEXT;
      ELSIF v_field = 'note' THEN
        v_actual_val := COALESCE(
          v_order.raw_shopify_data->>'note',
          v_order.raw_woocommerce_data->>'customer_note',
          v_order.raw_tiendanube_data->>'note',
          v_order.notas,
          ''
        );
      ELSE
        v_actual_val := '';
      END IF;

      v_actual_val := COALESCE(v_actual_val, '');

      -- Evaluación de operadores
      IF v_op = 'equals' THEN
        IF LOWER(v_actual_val) != LOWER(v_val) THEN
          RETURN FALSE;
        END IF;
      ELSIF v_op = 'not_equals' THEN
        IF LOWER(v_actual_val) = LOWER(v_val) THEN
          RETURN FALSE;
        END IF;
      ELSIF v_op = 'contains' THEN
        IF POSITION(LOWER(v_val) IN LOWER(v_actual_val)) = 0 THEN
          RETURN FALSE;
        END IF;
      ELSIF v_op = 'not_contains' THEN
        IF POSITION(LOWER(v_val) IN LOWER(v_actual_val)) > 0 THEN
          RETURN FALSE;
        END IF;
      ELSIF v_op = 'starts_with' THEN
        IF NOT starts_with(LOWER(v_actual_val), LOWER(v_val)) THEN
          RETURN FALSE;
        END IF;
      ELSIF v_op = 'ends_with' THEN
        IF NOT LOWER(v_actual_val) LIKE '%' || LOWER(v_val) THEN
          RETURN FALSE;
        END IF;
      ELSIF v_op = 'greater_than' THEN
        v_actual_numeric := CASE WHEN v_actual_val ~ '^([0-9]+(\.[0-9]+)?)$' THEN v_actual_val::numeric ELSE 0 END;
        v_val_numeric := CASE WHEN v_val ~ '^([0-9]+(\.[0-9]+)?)$' THEN v_val::numeric ELSE 0 END;
        IF v_actual_numeric <= v_val_numeric THEN
          RETURN FALSE;
        END IF;
      ELSIF v_op = 'less_than' THEN
        v_actual_numeric := CASE WHEN v_actual_val ~ '^([0-9]+(\.[0-9]+)?)$' THEN v_actual_val::numeric ELSE 0 END;
        v_val_numeric := CASE WHEN v_val ~ '^([0-9]+(\.[0-9]+)?)$' THEN v_val::numeric ELSE 0 END;
        IF v_actual_numeric >= v_val_numeric THEN
          RETURN FALSE;
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 6. Actualizar evaluate_campaign_rules() con soporte de cantidad dinámica y prioridad de ejecución
CREATE OR REPLACE FUNCTION public.evaluate_campaign_rules()
RETURNS trigger AS $$
DECLARE
  v_comercio VARCHAR;
  v_campaign RECORD;
  v_gift_product_id UUID;
  v_existing_campaign_item_id UUID;
  v_existing_campaign_qty INTEGER;
  v_gift_qty INTEGER;
BEGIN
  -- Si el ítem insertado/actualizado es un regalo de campaña, salir inmediatamente para evitar recursión
  IF COALESCE(NEW.is_gift, FALSE) = TRUE OR NEW.campaign_id IS NOT NULL OR COALESCE(NEW.tag, '') = 'Campaña' THEN
    RETURN NEW;
  END IF;

  -- Evitar recursión profunda (permitiendo nivel 2 para componentes expandidos desde packs)
  IF pg_trigger_depth() > 2 THEN
    RETURN NEW;
  END IF;

  SELECT comercio INTO v_comercio FROM public.orders WHERE id = NEW.order_id;
  IF v_comercio IS NULL THEN
    SELECT comercio INTO v_comercio FROM public.products WHERE id = NEW.product_id;
  END IF;
  IF v_comercio IS NULL THEN
    RETURN NEW;
  END IF;

  -- Iterar campañas activas del comercio en orden lógico:
  -- 1) Cantidad fija ('fixed')
  -- 2) Igual a cantidad de productos ('order_products_qty')
  -- 3) Igual a cantidad total incluyendo otras campañas ('order_total_qty')
  FOR v_campaign IN
    SELECT *
    FROM public.campaigns
    WHERE LOWER(TRIM(comercio)) = LOWER(TRIM(v_comercio))
      AND active = TRUE
    ORDER BY
      CASE COALESCE(gift_quantity_mode, 'fixed')
        WHEN 'fixed' THEN 1
        WHEN 'order_products_qty' THEN 2
        WHEN 'order_total_qty' THEN 3
        ELSE 1
      END ASC,
      created_at ASC
  LOOP
    -- Buscar producto de regalo
    SELECT id INTO v_gift_product_id
    FROM public.products
    WHERE LOWER(TRIM(sku)) = LOWER(TRIM(v_campaign.gift_sku))
      AND LOWER(TRIM(comercio)) = LOWER(TRIM(v_comercio))
      AND status = 'active'
    LIMIT 1;

    IF v_gift_product_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Buscar si este pedido ya tiene el ítem de regalo de esta campaña específica
    SELECT id, quantity INTO v_existing_campaign_item_id, v_existing_campaign_qty
    FROM public.order_items
    WHERE order_id = NEW.order_id
      AND campaign_id = v_campaign.id
    LIMIT 1;

    -- Si es una campaña de cantidad fija y ya fue aplicada, saltar
    IF v_existing_campaign_item_id IS NOT NULL AND COALESCE(v_campaign.gift_quantity_mode, 'fixed') = 'fixed' THEN
      CONTINUE;
    END IF;

    -- Evaluar condiciones de la campaña
    IF NOT public.order_matches_campaign_conditions(NEW.order_id, v_campaign.id) THEN
      CONTINUE;
    END IF;

    -- Calcular la cantidad de regalo según el modo configurado en la campaña
    v_gift_qty := public.calculate_campaign_gift_quantity(NEW.order_id, v_campaign.id);
    IF v_gift_qty <= 0 THEN
      CONTINUE;
    END IF;

    IF v_existing_campaign_item_id IS NOT NULL THEN
      -- Actualizar cantidad dinámica cuando se agregan o modifican ítems del pedido
      IF v_existing_campaign_qty IS DISTINCT FROM v_gift_qty THEN
        UPDATE public.order_items
        SET quantity = v_gift_qty
        WHERE id = v_existing_campaign_item_id;
      END IF;
    ELSE
      -- Insertar nueva línea de regalo
      INSERT INTO public.order_items (order_id, product_id, warehouse_id, quantity, tag, is_gift, campaign_id)
      VALUES (NEW.order_id, v_gift_product_id, NEW.warehouse_id, v_gift_qty, 'Campaña', TRUE, v_campaign.id);
    END IF;

  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-vincular el trigger en order_items para dispararse al insertar o actualizar cantidad de productos
DROP TRIGGER IF EXISTS on_order_item_after_insert ON public.order_items;
CREATE TRIGGER on_order_item_after_insert
  AFTER INSERT OR UPDATE OF quantity ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.evaluate_campaign_rules();


-- 7. Actualizar RPC preview_campaign_retroactive con cálculo dinámico por pedido
DROP FUNCTION IF EXISTS public.preview_campaign_retroactive(UUID, TEXT[]);
CREATE OR REPLACE FUNCTION public.preview_campaign_retroactive(
  p_campaign_id UUID,
  p_target_statuses TEXT[] DEFAULT ARRAY['para procesar', 'en preparación'],
  p_gift_quantity_mode VARCHAR DEFAULT NULL,
  p_gift_quantity INTEGER DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_campaign RECORD;
  v_gift_product RECORD;
  v_order RECORD;
  v_eligible_orders JSONB := '[]'::jsonb;
  v_order_count INTEGER := 0;
  v_total_units_required INTEGER := 0;
  v_order_gift_qty INTEGER := 0;
  v_available_stock INTEGER := 0;
  v_excluded_statuses TEXT[] := ARRAY['despachado', 'cancelado', 'entregado', 'retirado'];
  v_excluded_wms TEXT[] := ARRAY['Despachado', 'Cancelado', 'Archivado'];
  v_has_label BOOLEAN;
  v_already_applied BOOLEAN;
  v_clean_targets TEXT[];
BEGIN
  SELECT * INTO v_campaign FROM public.campaigns WHERE id = p_campaign_id;
  IF v_campaign.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Campaña no encontrada');
  END IF;

  SELECT * INTO v_gift_product 
  FROM public.products 
  WHERE LOWER(TRIM(sku)) = LOWER(TRIM(v_campaign.gift_sku))
    AND LOWER(TRIM(comercio)) = LOWER(TRIM(v_campaign.comercio))
  LIMIT 1;

  IF v_gift_product.id IS NULL THEN
    RETURN jsonb_build_object('error', 'El SKU de regalo no existe en los productos del comercio');
  END IF;

  -- Calcular stock disponible del regalo
  SELECT COALESCE(SUM(quantity - committed_quantity), 0) INTO v_available_stock
  FROM public.inventory
  WHERE product_id = v_gift_product.id;

  -- Normalizar estados objetivo
  IF p_target_statuses IS NULL OR cardinality(p_target_statuses) = 0 THEN
    v_clean_targets := ARRAY['para procesar', 'en preparación'];
  ELSE
    SELECT array_agg(LOWER(TRIM(s))) INTO v_clean_targets FROM unnest(p_target_statuses) s;
  END IF;

  -- Iterar pedidos candidatos
  FOR v_order IN
    SELECT o.id, o.external_order_number, o.created_at, o.status, o.estado_wms, o.tracking_number, o.label_base64
    FROM public.orders o
    WHERE LOWER(TRIM(o.comercio)) = LOWER(TRIM(v_campaign.comercio))
      AND (
        LOWER(TRIM(COALESCE(o.status, ''))) = ANY(v_clean_targets)
        OR LOWER(TRIM(COALESCE(o.estado_wms, ''))) = ANY(v_clean_targets)
      )
      AND NOT (LOWER(TRIM(COALESCE(o.status, ''))) = ANY(v_excluded_statuses))
      AND NOT (COALESCE(o.estado_wms, '') = ANY(v_excluded_wms))
      AND (v_campaign.start_date IS NULL OR o.created_at >= v_campaign.start_date)
      AND (v_campaign.end_date IS NULL OR o.created_at <= v_campaign.end_date)
    ORDER BY o.created_at DESC
  LOOP
    -- Excluir pedidos que ya tienen etiqueta generada
    v_has_label := (v_order.tracking_number IS NOT NULL AND TRIM(v_order.tracking_number) != '')
                   OR (v_order.label_base64 IS NOT NULL AND TRIM(v_order.label_base64) != '');
    IF v_has_label THEN
      CONTINUE;
    END IF;

    -- Verificar idempotencia (si ya recibió la campaña)
    SELECT EXISTS (
      SELECT 1 FROM public.order_items
      WHERE order_id = v_order.id
        AND campaign_id = v_campaign.id
    ) INTO v_already_applied;

    IF v_already_applied THEN
      CONTINUE;
    END IF;

    -- Validar condiciones de la campaña
    IF public.order_matches_campaign_conditions(v_order.id, v_campaign.id) THEN
      v_order_gift_qty := public.calculate_campaign_gift_quantity(v_order.id, v_campaign.id, p_gift_quantity_mode, p_gift_quantity);
      IF v_order_gift_qty > 0 THEN
        v_order_count := v_order_count + 1;
        v_total_units_required := v_total_units_required + v_order_gift_qty;
        IF v_order_count <= 50 THEN
          v_eligible_orders := v_eligible_orders || jsonb_build_object(
            'id', v_order.id,
            'order_number', COALESCE(v_order.external_order_number, v_order.id::text),
            'created_at', v_order.created_at,
            'status', COALESCE(v_order.estado_wms, v_order.status),
            'gift_quantity', v_order_gift_qty
          );
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'campaign_id', v_campaign.id,
    'campaign_name', v_campaign.name,
    'gift_sku', v_campaign.gift_sku,
    'gift_quantity', COALESCE(p_gift_quantity, v_campaign.gift_quantity),
    'gift_quantity_mode', COALESCE(p_gift_quantity_mode, v_campaign.gift_quantity_mode, 'fixed'),
    'eligible_orders_count', v_order_count,
    'total_units_required', v_total_units_required,
    'available_stock', v_available_stock,
    'sufficient_stock', (v_available_stock >= v_total_units_required),
    'sample_orders', v_eligible_orders
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 8. Actualizar RPC apply_campaign_retroactively con cálculo dinámico por pedido
CREATE OR REPLACE FUNCTION public.apply_campaign_retroactively(
  p_campaign_id UUID,
  p_target_statuses TEXT[] DEFAULT ARRAY['para procesar', 'en preparación'],
  p_merge_existing BOOLEAN DEFAULT TRUE
)
RETURNS JSONB AS $$
DECLARE
  v_campaign RECORD;
  v_gift_product RECORD;
  v_order RECORD;
  v_applied_count INTEGER := 0;
  v_total_units_applied INTEGER := 0;
  v_order_gift_qty INTEGER := 0;
  v_warehouse_id UUID;
  v_default_warehouse_id UUID;
  v_excluded_statuses TEXT[] := ARRAY['despachado', 'cancelado', 'entregado', 'retirado'];
  v_excluded_wms TEXT[] := ARRAY['Despachado', 'Cancelado', 'Archivado'];
  v_clean_targets TEXT[];
  v_has_label BOOLEAN;
  v_already_applied BOOLEAN;
  v_new_cantidad INTEGER;
  v_new_skus TEXT;
  v_new_items TEXT;
  v_dep_item RECORD;
  v_dep_qty INTEGER;
BEGIN
  -- Cargar campaña
  SELECT * INTO v_campaign FROM public.campaigns WHERE id = p_campaign_id;
  IF v_campaign.id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Campaña no encontrada');
  END IF;

  -- Cargar producto de regalo
  SELECT * INTO v_gift_product 
  FROM public.products 
  WHERE LOWER(TRIM(sku)) = LOWER(TRIM(v_campaign.gift_sku))
    AND LOWER(TRIM(comercio)) = LOWER(TRIM(v_campaign.comercio))
  LIMIT 1;

  IF v_gift_product.id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'El SKU de regalo no existe en los productos del comercio');
  END IF;

  -- Bodega por defecto en caso de que el pedido no tenga items previos
  SELECT id INTO v_default_warehouse_id FROM public.warehouses LIMIT 1;

  -- Normalizar estados objetivo
  IF p_target_statuses IS NULL OR cardinality(p_target_statuses) = 0 THEN
    v_clean_targets := ARRAY['para procesar', 'en preparación'];
  ELSE
    SELECT array_agg(LOWER(TRIM(s))) INTO v_clean_targets FROM unnest(p_target_statuses) s;
  END IF;

  -- Iterar pedidos candidatos
  FOR v_order IN
    SELECT o.id, o.external_order_number, o.created_at, o.status, o.estado_wms, o.tracking_number, o.label_base64
    FROM public.orders o
    WHERE LOWER(TRIM(o.comercio)) = LOWER(TRIM(v_campaign.comercio))
      AND (
        LOWER(TRIM(COALESCE(o.status, ''))) = ANY(v_clean_targets)
        OR LOWER(TRIM(COALESCE(o.estado_wms, ''))) = ANY(v_clean_targets)
      )
      AND NOT (LOWER(TRIM(COALESCE(o.status, ''))) = ANY(v_excluded_statuses))
      AND NOT (COALESCE(o.estado_wms, '') = ANY(v_excluded_wms))
      AND (v_campaign.start_date IS NULL OR o.created_at >= v_campaign.start_date)
      AND (v_campaign.end_date IS NULL OR o.created_at <= v_campaign.end_date)
    ORDER BY o.created_at ASC
  LOOP
    -- Excluir pedidos con etiqueta emitida
    v_has_label := (v_order.tracking_number IS NOT NULL AND TRIM(v_order.tracking_number) != '')
                   OR (v_order.label_base64 IS NOT NULL AND TRIM(v_order.label_base64) != '');
    IF v_has_label THEN
      CONTINUE;
    END IF;

    -- Verificar si ya tiene la campaña aplicada
    SELECT EXISTS (
      SELECT 1 FROM public.order_items
      WHERE order_id = v_order.id
        AND campaign_id = v_campaign.id
    ) INTO v_already_applied;

    IF v_already_applied THEN
      CONTINUE;
    END IF;

    -- Validar condiciones
    IF NOT public.order_matches_campaign_conditions(v_order.id, v_campaign.id) THEN
      CONTINUE;
    END IF;

    -- Calcular cantidad de regalo según modo de la campaña
    v_order_gift_qty := public.calculate_campaign_gift_quantity(v_order.id, v_campaign.id);
    IF v_order_gift_qty <= 0 THEN
      CONTINUE;
    END IF;

    -- Obtener la bodega del primer item físico del pedido
    SELECT warehouse_id INTO v_warehouse_id
    FROM public.order_items
    WHERE order_id = v_order.id AND warehouse_id IS NOT NULL
    LIMIT 1;

    IF v_warehouse_id IS NULL THEN
      v_warehouse_id := v_default_warehouse_id;
    END IF;

    -- Insertar fila de regalo de la campaña
    INSERT INTO public.order_items (order_id, product_id, warehouse_id, quantity, tag, is_gift, campaign_id)
    VALUES (v_order.id, v_gift_product.id, v_warehouse_id, v_order_gift_qty, 'Campaña', TRUE, v_campaign.id);

    -- Si existen otras campañas activas en modo 'order_total_qty' ya aplicadas a este pedido, recalcular su cantidad
    FOR v_dep_item IN
      SELECT oi.id, oi.quantity, oi.campaign_id
      FROM public.order_items oi
      JOIN public.campaigns c ON c.id = oi.campaign_id
      WHERE oi.order_id = v_order.id
        AND oi.campaign_id != v_campaign.id
        AND c.active = TRUE
        AND c.gift_quantity_mode = 'order_total_qty'
    LOOP
      v_dep_qty := public.calculate_campaign_gift_quantity(v_order.id, v_dep_item.campaign_id);
      IF v_dep_qty > 0 AND v_dep_qty IS DISTINCT FROM v_dep_item.quantity THEN
        UPDATE public.order_items
        SET quantity = v_dep_qty
        WHERE id = v_dep_item.id;
      END IF;
    END LOOP;

    -- Recalcular totales en la cabecera de orders
    SELECT COALESCE(SUM(quantity), 0) INTO v_new_cantidad
    FROM public.order_items WHERE order_id = v_order.id;

    SELECT string_agg(DISTINCT p.sku, ', ') INTO v_new_skus
    FROM public.order_items oi
    JOIN public.products p ON oi.product_id = p.id
    WHERE oi.order_id = v_order.id;

    SELECT string_agg(DISTINCT p.name, ', ') INTO v_new_items
    FROM public.order_items oi
    JOIN public.products p ON oi.product_id = p.id
    WHERE oi.order_id = v_order.id;

    UPDATE public.orders
    SET cantidad = v_new_cantidad,
        sku = v_new_skus,
        item = v_new_items
    WHERE id = v_order.id;

    v_applied_count := v_applied_count + 1;
    v_total_units_applied := v_total_units_applied + v_order_gift_qty;
  END LOOP;

  -- Actualizar registro en campaigns
  UPDATE public.campaigns
  SET is_retroactive = TRUE,
      retroactive_applied_at = timezone('utc'::text, now()),
      retroactive_target_statuses = v_clean_targets
  WHERE id = p_campaign_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'campaign_id', p_campaign_id,
    'applied_orders_count', v_applied_count,
    'total_units_applied', v_total_units_applied
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
