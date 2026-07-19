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

-- 7. Modificar/Redefinir los triggers sobre order_items para manejar inserción, actualización y borrado

-- A. Trigger para nuevas inserciones (redefinido para seguridad de bodega no nula y estado activo)
CREATE OR REPLACE FUNCTION public.handle_new_order_item()
RETURNS trigger AS $$
DECLARE
  v_order_status TEXT;
BEGIN
  SELECT status INTO v_order_status FROM public.orders WHERE id = NEW.order_id;
  IF v_order_status IN ('despachado', 'cancelado', 'entregado', 'retirado') THEN
    RETURN NEW;
  END IF;

  IF NOT public.should_process_order_stock(NEW.order_id) THEN
    RETURN NEW;
  END IF;

  IF NEW.warehouse_id IS NOT NULL THEN
    UPDATE public.inventory
    SET committed_quantity = committed_quantity + NEW.quantity
    WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- B. Trigger para actualizaciones (ej. cuando se asigna bodega, cambia cantidad o producto)
CREATE OR REPLACE FUNCTION public.handle_update_order_item()
RETURNS trigger AS $$
DECLARE
  v_order_status TEXT;
  v_old_process BOOLEAN;
  v_new_process BOOLEAN;
BEGIN
  SELECT status INTO v_order_status FROM public.orders WHERE id = COALESCE(NEW.order_id, OLD.order_id);
  IF v_order_status IN ('despachado', 'cancelado', 'entregado', 'retirado') THEN
    RETURN NEW;
  END IF;

  v_old_process := public.should_process_order_stock(OLD.order_id);
  v_new_process := public.should_process_order_stock(NEW.order_id);

  -- Restar cantidad anterior si correspondía procesar y tenía bodega
  IF v_old_process AND OLD.warehouse_id IS NOT NULL THEN
    UPDATE public.inventory
    SET committed_quantity = GREATEST(0, committed_quantity - OLD.quantity)
    WHERE product_id = OLD.product_id AND warehouse_id = OLD.warehouse_id;
  END IF;

  -- Sumar cantidad nueva si corresponde procesar y tiene bodega
  IF v_new_process AND NEW.warehouse_id IS NOT NULL THEN
    UPDATE public.inventory
    SET committed_quantity = committed_quantity + NEW.quantity
    WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_order_item_updated ON public.order_items;
CREATE TRIGGER on_order_item_updated
  AFTER UPDATE ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_update_order_item();

-- C. Trigger para eliminaciones (ej. cuando se borra un ítem del pedido)
CREATE OR REPLACE FUNCTION public.handle_delete_order_item()
RETURNS trigger AS $$
DECLARE
  v_order_status TEXT;
BEGIN
  SELECT status INTO v_order_status FROM public.orders WHERE id = OLD.order_id;
  IF v_order_status IN ('despachado', 'cancelado', 'entregado', 'retirado') THEN
    RETURN OLD;
  END IF;

  IF public.should_process_order_stock(OLD.order_id) AND OLD.warehouse_id IS NOT NULL THEN
    UPDATE public.inventory
    SET committed_quantity = GREATEST(0, committed_quantity - OLD.quantity)
    WHERE product_id = OLD.product_id AND warehouse_id = OLD.warehouse_id;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_order_item_deleted ON public.order_items;
CREATE TRIGGER on_order_item_deleted
  AFTER DELETE ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_delete_order_item();

-- 8. Crear función administrativa para recalcular/sincronizar el stock comprometido
CREATE OR REPLACE FUNCTION public.recalculate_committed_stock()
RETURNS VOID AS $$
BEGIN
  -- 1. Resetear todos los comprometidos a 0
  UPDATE public.inventory SET committed_quantity = 0;

  -- 2. Recalcular e inyectar basándose en ítems de pedidos activos calificados
  UPDATE public.inventory inv
  SET committed_quantity = COALESCE(summary.total_committed, 0)
  FROM (
    SELECT 
      oi.product_id,
      oi.warehouse_id,
      SUM(oi.quantity)::INTEGER AS total_committed
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.status NOT IN ('despachado', 'cancelado', 'entregado', 'retirado')
      AND oi.warehouse_id IS NOT NULL
      AND public.should_process_order_stock(o.id)
    GROUP BY oi.product_id, oi.warehouse_id
  ) summary
  WHERE inv.product_id = summary.product_id
    AND inv.warehouse_id = summary.warehouse_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 9. Asignar Bodega Central por defecto a ítems de pedidos que no especifiquen una

CREATE OR REPLACE FUNCTION public.assign_default_warehouse()
RETURNS trigger AS $$
DECLARE
  v_default_warehouse_id UUID := 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09'; -- Bodega Central
BEGIN
  IF NEW.warehouse_id IS NULL THEN
    NEW.warehouse_id := v_default_warehouse_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_order_item_assign_default_warehouse ON public.order_items;
CREATE TRIGGER on_order_item_assign_default_warehouse
  BEFORE INSERT OR UPDATE ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_default_warehouse();


-- 10. Inicializar automáticamente el inventario en Bodega Central al crear nuevos productos

CREATE OR REPLACE FUNCTION public.handle_new_product_inventory()
RETURNS trigger AS $$
DECLARE
  v_default_warehouse_id UUID := 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09'; -- Bodega Central
BEGIN
  INSERT INTO public.inventory (product_id, warehouse_id, quantity, committed_quantity)
  VALUES (NEW.id, v_default_warehouse_id, 0, 0)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_product_inserted ON public.products;
CREATE TRIGGER on_product_inserted
  AFTER INSERT ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_product_inventory();


-- =========================================================================
-- MIGRACIÓN ÚNICA: EJECUTAR PARA APLICAR REGLAS A DATOS ANTIGUOS
-- =========================================================================
--
-- -- A. Asegurar filas en inventario para Bodega Central en todos los productos
-- INSERT INTO public.inventory (product_id, warehouse_id, quantity, committed_quantity)
-- SELECT p.id, 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09', 0, 0
-- FROM public.products p
-- WHERE NOT EXISTS (
--   SELECT 1 FROM public.inventory i 
--   WHERE i.product_id = p.id AND i.warehouse_id = 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09'
-- )
-- ON CONFLICT DO NOTHING;
--
-- -- B. Asignar Bodega Central a todos los ítems de pedidos anteriores con bodega nula
-- UPDATE public.order_items
-- SET warehouse_id = 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09'
-- WHERE warehouse_id IS NULL;
--
-- -- C. Recalcular stock comprometido global
-- SELECT public.recalculate_committed_stock();
-- =========================================================================


