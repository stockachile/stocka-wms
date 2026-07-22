-- 1. Tabla de campañas
CREATE TABLE IF NOT EXISTS public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comercio VARCHAR NOT NULL,
  name VARCHAR NOT NULL,
  active BOOLEAN DEFAULT TRUE NOT NULL,
  start_date TIMESTAMP WITH TIME ZONE,
  end_date TIMESTAMP WITH TIME ZONE,
  trigger_skus TEXT[], -- Array de SKUs que gatillan la campaña
  min_total_quantity INTEGER, -- Cantidad mínima de unidades en el pedido
  min_distinct_skus INTEGER, -- Cantidad mínima de SKUs distintos en el pedido
  gift_sku VARCHAR NOT NULL,
  gift_quantity INTEGER DEFAULT 1 NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Habilitar RLS
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

-- 3. Políticas RLS
DROP POLICY IF EXISTS "Clientes ven sus propias campanas" ON public.campaigns;
CREATE POLICY "Clientes ven sus propias campanas" ON public.campaigns
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(campaigns.comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );

DROP POLICY IF EXISTS "Clientes gestionan sus propias campanas" ON public.campaigns;
CREATE POLICY "Clientes gestionan sus propias campanas" ON public.campaigns
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(campaigns.comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );

-- 4. Función de evaluación de campañas
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

    -- Si cumple todas las condiciones de la regla, agregar el regalo
    INSERT INTO public.order_items (order_id, product_id, warehouse_id, quantity)
    VALUES (NEW.order_id, v_gift_product_id, NEW.warehouse_id, v_campaign.gift_quantity);

  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Trigger en order_items
DROP TRIGGER IF EXISTS on_order_item_after_insert ON public.order_items;
CREATE TRIGGER on_order_item_after_insert
  AFTER INSERT ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.evaluate_campaign_rules();
