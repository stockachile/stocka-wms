-- WMS STOCKA - Configuración de Control de Inventario y Stock Crítico
-- Ejecutar en el SQL Editor de Supabase

-- 1. Agregar columna de inicio de pedidos por canal en comercios_adicional_config
ALTER TABLE public.comercios_adicional_config 
ADD COLUMN IF NOT EXISTS inventario_inicio_pedidos JSONB DEFAULT '{}'::jsonb;

-- 2. Agregar columna de stock crítico en products
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS stock_critico INTEGER DEFAULT 0 CHECK (stock_critico >= 0);

-- 3. Crear función para evaluar si un pedido debe descontar stock
CREATE OR REPLACE FUNCTION public.should_process_order_stock(p_order_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_order RECORD;
  v_config RECORD;
  v_platform TEXT;
  v_start_config JSONB;
  v_start_order_num TEXT;
  v_include BOOLEAN;
  v_start_ts TIMESTAMP WITH TIME ZONE;
  v_start_order_id UUID;
  v_start_val BIGINT;
  v_order_val BIGINT;
BEGIN
  -- A. Obtener datos del pedido
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- B. Obtener configuración adicional del comercio
  SELECT * INTO v_config FROM public.comercios_adicional_config WHERE comercio = v_order.comercio;
  IF NOT FOUND THEN
    -- Si no hay configuración para este comercio, por defecto no hacemos seguimiento
    RETURN FALSE;
  END IF;

  -- Si el seguimiento general está deshabilitado, no procesamos stock
  IF NOT v_config.inventario_seguimiento THEN
    RETURN FALSE;
  END IF;

  -- Si no hay configuración de inicio de pedidos, por defecto procesamos todo
  IF v_config.inventario_inicio_pedidos IS NULL OR jsonb_typeof(v_config.inventario_inicio_pedidos) != 'object' THEN
    RETURN TRUE;
  END IF;

  v_platform := COALESCE(v_order.external_platform, 'Manual');
  v_start_config := v_config.inventario_inicio_pedidos->v_platform;

  -- Si este canal no tiene configuración específica de inicio, se asume que se procesa todo
  IF v_start_config IS NULL OR v_start_config = 'null'::jsonb THEN
    RETURN TRUE;
  END IF;

  -- Extraer el número de orden de inicio (ej: "1024" o "#1024")
  v_start_order_num := v_start_config->>'external_order_number';
  
  -- Leer flag de incluir (si no existe, por defecto es TRUE)
  v_include := COALESCE((v_start_config->>'incluir')::BOOLEAN, TRUE);

  IF v_start_order_num IS NOT NULL AND v_start_order_num != '' THEN
    -- Intentar buscar el pedido en la base de datos para extraer su created_at e ID
    SELECT id, created_at INTO v_start_order_id, v_start_ts
    FROM public.orders
    WHERE comercio = v_order.comercio
      AND COALESCE(external_platform, 'Manual') = v_platform
      AND external_order_number = v_start_order_num
    LIMIT 1;

    IF v_start_ts IS NOT NULL THEN
      IF v_include THEN
        RETURN v_order.created_at >= v_start_ts;
      ELSE
        -- Si no se incluye, descartamos explícitamente el pedido de inicio por ID o número de orden
        IF v_order.id = v_start_order_id OR v_order.external_order_number = v_start_order_num THEN
          RETURN FALSE;
        END IF;
        RETURN v_order.created_at > v_start_ts;
      END IF;
    ELSE
      -- Si el pedido no se encuentra en la base de datos, realizamos comparación numérica del número de orden
      v_start_val := regexp_replace(v_start_order_num, '[^0-9]', '', 'g')::BIGINT;
      v_order_val := regexp_replace(v_order.external_order_number, '[^0-9]', '', 'g')::BIGINT;

      IF v_start_val IS NULL OR v_order_val IS NULL THEN
        -- Si no son puramente numéricos, usar comparación de texto lexicográfica
        IF v_include THEN
          RETURN v_order.external_order_number >= v_start_order_num;
        ELSE
          RETURN v_order.external_order_number > v_start_order_num;
        END IF;
      ELSE
        IF v_include THEN
          RETURN v_order_val >= v_start_val;
        ELSE
          RETURN v_order_val > v_start_val;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Modificar el trigger handle_new_order_item para incorporar la regla
CREATE OR REPLACE FUNCTION public.handle_new_order_item()
RETURNS trigger AS $$
BEGIN
  -- Validar si el pedido debe descontar/comprometer stock
  IF NOT public.should_process_order_stock(NEW.order_id) THEN
    RETURN NEW;
  END IF;

  UPDATE inventory
  SET committed_quantity = committed_quantity + NEW.quantity
  WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Modificar el trigger handle_order_status_change para incorporar la regla
CREATE OR REPLACE FUNCTION public.handle_order_status_change()
RETURNS trigger AS $$
DECLARE
  item RECORD;
BEGIN
  -- Validar si el pedido debe descontar/comprometer stock
  IF NOT public.should_process_order_stock(NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Si pasa a "despachado": descontar stock físico y comprometido, y generar movimiento "out"
  IF NEW.status = 'despachado' AND OLD.status != 'despachado' THEN
    FOR item IN SELECT * FROM order_items WHERE order_id = NEW.id LOOP
      -- Actualizar Inventario
      UPDATE inventory 
      SET quantity = quantity - item.quantity,
          committed_quantity = committed_quantity - item.quantity
      WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
      
      -- Generar Log de Movimiento
      INSERT INTO movements (product_id, warehouse_id, type, quantity, reference_doc)
      VALUES (item.product_id, item.warehouse_id, 'out', item.quantity, 'Pedido ' || NEW.id);
    END LOOP;
  END IF;

  -- Si pasa a "cancelado": liberar el stock comprometido
  IF NEW.status = 'cancelado' AND OLD.status != 'cancelado' AND OLD.status != 'despachado' THEN
    FOR item IN SELECT * FROM order_items WHERE order_id = NEW.id LOOP
      UPDATE inventory 
      SET committed_quantity = committed_quantity - item.quantity
      WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Crear función para obtener el desglose de pedidos comprometidos aplicando las reglas de inicio
CREATE OR REPLACE FUNCTION public.get_committed_order_details(p_product_id UUID, p_warehouse_id UUID)
RETURNS TABLE (
  quantity INTEGER,
  order_id UUID,
  external_order_number TEXT,
  external_platform TEXT,
  status TEXT,
  created_at TIMESTAMP WITH TIME ZONE,
  customer_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    oi.quantity,
    o.id AS order_id,
    o.external_order_number,
    o.external_platform,
    o.status,
    o.created_at,
    o.customer_name
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE oi.product_id = p_product_id
    AND oi.warehouse_id = p_warehouse_id
    AND o.status NOT IN ('despachado', 'cancelado', 'entregado', 'retirado')
    AND public.should_process_order_stock(o.id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
