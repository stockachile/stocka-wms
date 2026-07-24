-- 1. Añadir columna conditions a la tabla public.campaigns
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS conditions JSONB DEFAULT '[]'::jsonb;

-- 2. Actualizar la función de evaluación de campañas
CREATE OR REPLACE FUNCTION public.evaluate_campaign_rules()
RETURNS trigger AS $$
DECLARE
  v_comercio VARCHAR;
  v_order_created_at TIMESTAMP WITH TIME ZONE;
  v_campaign RECORD;
  v_gift_product_id UUID;
  v_total_quantity INTEGER;
  v_distinct_skus INTEGER;
  v_has_trigger_sku BOOLEAN;
  v_already_has_gift BOOLEAN;
BEGIN
  -- Evitar recursión infinita en disparadores anidados
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- Obtener el comercio y fecha del pedido
  SELECT comercio, created_at INTO v_comercio, v_order_created_at
  FROM public.orders
  WHERE id = NEW.order_id;

  IF v_comercio IS NULL THEN
    SELECT comercio INTO v_comercio
    FROM public.products
    WHERE id = NEW.product_id;
  END IF;

  IF v_comercio IS NULL THEN
    RETURN NEW;
  END IF;

  -- Iterar sobre campañas activas
  FOR v_campaign IN
    SELECT *
    FROM public.campaigns
    WHERE comercio = v_comercio
      AND active = TRUE
      AND (start_date IS NULL OR start_date <= v_order_created_at)
      AND (end_date IS NULL OR end_date >= v_order_created_at)
  LOOP
    -- Buscar el ID del producto de regalo
    SELECT id INTO v_gift_product_id
    FROM public.products
    WHERE sku = v_campaign.gift_sku
      AND comercio = v_comercio
      AND status = 'active'
    LIMIT 1;

    IF v_gift_product_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Verificar si ya se agregó este regalo al pedido
    SELECT EXISTS (
      SELECT 1 
      FROM public.order_items 
      WHERE order_id = NEW.order_id 
        AND product_id = v_gift_product_id
    ) INTO v_already_has_gift;

    IF v_already_has_gift THEN
      CONTINUE;
    END IF;

    -- Evaluar Condición 1: SKUs específicos disparadores
    IF v_campaign.trigger_skus IS NOT NULL AND cardinality(v_campaign.trigger_skus) > 0 THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.order_items oi
        JOIN public.products p ON oi.product_id = p.id
        WHERE oi.order_id = NEW.order_id
          AND LOWER(TRIM(p.sku)) = ANY (
            SELECT LOWER(TRIM(u)) FROM unnest(v_campaign.trigger_skus) u
          )
      ) INTO v_has_trigger_sku;
      
      IF NOT v_has_trigger_sku THEN
        CONTINUE;
      END IF;
    END IF;

    -- Evaluar Condición 2: Cantidad mínima total de unidades
    IF v_campaign.min_total_quantity IS NOT NULL AND v_campaign.min_total_quantity > 0 THEN
      SELECT SUM(quantity) INTO v_total_quantity
      FROM public.order_items
      WHERE order_id = NEW.order_id;

      IF v_total_quantity < v_campaign.min_total_quantity THEN
        CONTINUE;
      END IF;
    END IF;

    -- Evaluar Condición 3: Cantidad mínima de SKUs distintos
    IF v_campaign.min_distinct_skus IS NOT NULL AND v_campaign.min_distinct_skus > 0 THEN
      SELECT COUNT(DISTINCT product_id) INTO v_distinct_skus
      FROM public.order_items
      WHERE order_id = NEW.order_id;

      IF v_distinct_skus < v_campaign.min_distinct_skus THEN
        CONTINUE;
      END IF;
    END IF;

    -- Evaluar Condición 4: Condiciones basadas en parámetros del pedido (JSON)
    IF v_campaign.conditions IS NOT NULL AND jsonb_array_length(v_campaign.conditions) > 0 THEN
      DECLARE
        v_condition RECORD;
        v_cond_ok BOOLEAN := TRUE;
        v_field TEXT;
        v_op TEXT;
        v_val TEXT;
        v_actual_val TEXT;
        v_actual_numeric NUMERIC;
        v_val_numeric NUMERIC;
        v_order RECORD;
      BEGIN
        -- Cargar los datos del pedido
        SELECT * INTO v_order FROM public.orders WHERE id = NEW.order_id;
        
        FOR v_condition IN SELECT * FROM jsonb_to_recordset(v_campaign.conditions) AS x(field TEXT, operator TEXT, value TEXT) LOOP
          v_field := v_condition.field;
          v_op := v_condition.operator;
          v_val := v_condition.value;
          
          -- Obtener el valor actual del campo del pedido
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
              ''
            );
          ELSE
            v_actual_val := '';
          END IF;
          
          v_actual_val := COALESCE(v_actual_val, '');
          
          -- Evaluar según el operador
          IF v_op = 'equals' THEN
            IF LOWER(v_actual_val) != LOWER(v_val) THEN
              v_cond_ok := FALSE;
              EXIT;
            END IF;
          ELSIF v_op = 'not_equals' THEN
            IF LOWER(v_actual_val) = LOWER(v_val) THEN
              v_cond_ok := FALSE;
              EXIT;
            END IF;
          ELSIF v_op = 'contains' THEN
            IF POSITION(LOWER(v_val) IN LOWER(v_actual_val)) = 0 THEN
              v_cond_ok := FALSE;
              EXIT;
            END IF;
          ELSIF v_op = 'not_contains' THEN
            IF POSITION(LOWER(v_val) IN LOWER(v_actual_val)) > 0 THEN
              v_cond_ok := FALSE;
              EXIT;
            END IF;
          ELSIF v_op = 'starts_with' THEN
            IF NOT starts_with(LOWER(v_actual_val), LOWER(v_val)) THEN
              v_cond_ok := FALSE;
              EXIT;
            END IF;
          ELSIF v_op = 'ends_with' THEN
            IF NOT LOWER(v_actual_val) LIKE '%' || LOWER(v_val) THEN
              v_cond_ok := FALSE;
              EXIT;
            END IF;
          ELSIF v_op = 'greater_than' THEN
            -- Validación y conversión numérica segura
            v_actual_numeric := case when v_actual_val ~ '^([0-9]+(\.[0-9]+)?)$' then v_actual_val::numeric else 0 end;
            v_val_numeric := case when v_val ~ '^([0-9]+(\.[0-9]+)?)$' then v_val::numeric else 0 end;
            IF v_actual_numeric <= v_val_numeric THEN
              v_cond_ok := FALSE;
              EXIT;
            END IF;
          ELSIF v_op = 'less_than' THEN
            v_actual_numeric := case when v_actual_val ~ '^([0-9]+(\.[0-9]+)?)$' then v_actual_val::numeric else 0 end;
            v_val_numeric := case when v_val ~ '^([0-9]+(\.[0-9]+)?)$' then v_val::numeric else 0 end;
            IF v_actual_numeric >= v_val_numeric THEN
              v_cond_ok := FALSE;
              EXIT;
            END IF;
          END IF;
        END LOOP;
        
        IF NOT v_cond_ok THEN
          CONTINUE;
        END IF;
      END;
    END IF;

    -- Si cumple todas las condiciones de la regla, agregar el regalo
    INSERT INTO public.order_items (order_id, product_id, warehouse_id, quantity)
    VALUES (NEW.order_id, v_gift_product_id, NEW.warehouse_id, v_campaign.gift_quantity);

  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
