-- ==============================================================================
-- WMS STOCKA - CORRECCIÓN DE TRIGGER: validate_order_stock_before_dispatch()
-- ==============================================================================
-- Problema detectado:
-- Cuando un pedido ya había descontado su última unidad de stock en el WMS
-- (stock_descontado = true / movimiento 'out' ya existente en movements, quedando
-- inventory.quantity = 0) pero su columna de origen (orders.status) seguía en
-- 'para procesar', cualquier actualización posterior a orders.status = 'despachado'
-- (por ejemplo, desde sync_meli.js cuando el envío figuraba como entregado, o desde
-- el modal de edición del pedido) disparaba validate_order_stock_before_dispatch().
--
-- Al no verificar si el pedido ya tenía stock_descontado = true o un movimiento 'out'
-- previo, el trigger veía inventory.quantity = 0 < 1, asumía erróneamente falta de
-- stock y revertía forzosamente el pedido a:
--   NEW.status := 'para procesar';
--   NEW.estado_wms := 'En procesamiento';
--
-- Solución:
-- Si el pedido ya tiene stock_descontado = true, ya estaba en estado_wms = 'Despachado',
-- o ya posee su movimiento de salida ('out') en public.movements, omitir la validación
-- de stock disponible y permitir el cierre normal del pedido.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.validate_order_stock_before_dispatch()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  item RECORD;
  v_available_qty INTEGER;
  v_insufficient BOOLEAN := FALSE;
  v_user_id UUID;
  v_missing_sku TEXT;
  v_missing_qty INTEGER;
  v_wh_name TEXT;
  v_order_num TEXT;
BEGIN
  -- 0. REGLA DE IDEMPOTENCIA: Si el pedido ya descontó su stock previamente o ya estaba Despachado en WMS,
  --    nunca bloquear ni revertir su estado a "para procesar" / "En procesamiento".
  v_order_num := COALESCE(NEW.external_order_number, NEW.id::text);
  IF COALESCE(OLD.stock_descontado, FALSE) = TRUE
     OR COALESCE(NEW.stock_descontado, FALSE) = TRUE
     OR COALESCE(OLD.estado_wms, '') = 'Despachado'
     OR EXISTS (SELECT 1 FROM public.movements WHERE order_id = NEW.id AND type = 'out')
     OR EXISTS (
          SELECT 1 FROM public.movements m
          JOIN public.order_items oi ON oi.order_id = NEW.id AND oi.product_id = m.product_id
          WHERE m.order_id IS NULL
            AND m.type = 'out'
            AND (m.reference_doc = 'Pedido ' || v_order_num
                 OR m.reference_doc = 'Pedido #' || v_order_num
                 OR m.reference_doc = 'Pedido ' || NEW.id::text)
     )
  THEN
    RETURN NEW;
  END IF;

  -- 1. Validar únicamente cuando pasa por primera vez a 'despachado', 'en preparación' o WMS 'En preparación'
  IF (NEW.status IN ('despachado', 'en preparación') AND COALESCE(OLD.status, '') NOT IN ('despachado', 'en preparación'))
     OR (NEW.estado_wms = 'En preparación' AND COALESCE(OLD.estado_wms, '') != 'En preparación') THEN

      -- 2. Si no califica para procesar stock, no hacemos nada
      IF NOT public.should_process_order_stock(NEW.id) THEN
        RETURN NEW;
      END IF;

      -- 3. Verificar stock disponible para cada ítem del pedido
      FOR item IN
        SELECT oi.*, p.sku, p.name AS prod_name, p.is_virtual, w.name AS wh_name
        FROM public.order_items oi
        JOIN public.products p ON p.id = oi.product_id
        JOIN public.warehouses w ON w.id = oi.warehouse_id
        WHERE oi.order_id = NEW.id
      LOOP
        -- Si es virtual, no descontamos ni controlamos stock
        IF COALESCE(item.is_virtual, FALSE) THEN
          CONTINUE;
        END IF;

        -- Si es Bodega Central (Default/Virtual), omitir control de stock en esta etapa
        IF item.warehouse_id = 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09' THEN
          CONTINUE;
        END IF;

        -- Obtener cantidad física disponible en la bodega asignada
        SELECT COALESCE(quantity, 0) INTO v_available_qty
        FROM public.inventory
        WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;

        -- Si no hay suficiente stock físico
        IF v_available_qty < item.quantity THEN
          v_insufficient := TRUE;
          v_missing_sku := item.sku;
          v_missing_qty := item.quantity - v_available_qty;
          v_wh_name := item.wh_name;
          EXIT; -- Salimos del loop al detectar la primera insuficiencia
        END IF;
      END LOOP;

      -- 4. Si hay insuficiencia de stock, prevenimos el cambio y revertimos a "para procesar" / "En procesamiento"
      IF v_insufficient THEN
        NEW.status := 'para procesar';
        NEW.estado_wms := 'En procesamiento';

        -- Buscar user_id del perfil para asociar la incidencia
        SELECT id INTO v_user_id FROM public.profiles WHERE comercio ILIKE '%' || NEW.comercio || '%' LIMIT 1;

        -- Insertar la incidencia crítica si no existe ya una activa para este pedido
        IF NOT EXISTS (
          SELECT 1 FROM public.incidencias
          WHERE comercio = NEW.comercio
            AND status = 'pendiente'
            AND title = 'Falta de stock crítico - Pedido ' || NEW.external_order_number
        ) THEN
          INSERT INTO public.incidencias (
            user_id,
            comercio,
            title,
            description,
            type,
            severity,
            status,
            solution
          ) VALUES (
            COALESCE(v_user_id, NEW.merchant_id),
            NEW.comercio,
            'Falta de stock crítico - Pedido ' || NEW.external_order_number,
            'El pedido ' || NEW.external_order_number || ' no se pudo despachar/procesar por falta de stock del SKU ' || v_missing_sku || ' en la bodega ' || v_wh_name || ' (Faltan ' || v_missing_qty || ' un.).',
            'stock',
            'critico',
            'pendiente',
            ''
          );
        END IF;
      END IF;
  END IF;

  RETURN NEW;
END;
$function$;
