-- ==============================================================================
-- WMS STOCKA - MIGRACIÓN: EXCLUSIÓN DE DEVOLUCIONES DE LOGÍSTICA INVERSA EN DESCUENTO DE STOCK
-- Las devoluciones de logística inversa representan mercadería que entra desde el cliente
-- hacia la bodega. Por lo tanto, NUNCA deben descontar stock de salida ni comprometerlo en WMS.
-- El reingreso al inventario se realiza al confirmar la recepción física en Logística Inversa.
-- ==============================================================================

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

  -- B. REGLA LOGÍSTICA INVERSA:
  -- Si el pedido corresponde a una DEVOLUCIÓN, nunca debe descontar ni comprometer stock de salida en WMS.
  IF v_order.origen = 'Logística Inversa' AND (
     COALESCE(v_order.raw_shopify_data->>'rl_type', '') = 'DEVOLUCION'
     OR COALESCE(v_order.raw_shopify_data->>'no_stock_deduction', 'false') = 'true'
     OR v_order.shipping_method ILIKE '%DEVOLUCION%'
  ) THEN
    RETURN FALSE;
  END IF;

  -- C. Obtener configuración adicional del comercio
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
        IF v_order.id = v_start_order_id OR v_order.external_order_number = v_start_order_num THEN
          RETURN FALSE;
        END IF;
        RETURN v_order.created_at > v_start_ts;
      END IF;
    ELSE
      v_start_val := regexp_replace(v_start_order_num, '[^0-9]', '', 'g')::BIGINT;
      v_order_val := regexp_replace(v_order.external_order_number, '[^0-9]', '', 'g')::BIGINT;

      IF v_start_val IS NULL OR v_order_val IS NULL THEN
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
