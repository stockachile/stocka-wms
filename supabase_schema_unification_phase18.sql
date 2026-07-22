-- WMS STOCKA - Supabase Schema Phase 18: Validación de stock al iniciar preparación (estado_wms = 'En preparación')
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

CREATE OR REPLACE FUNCTION public.validate_order_stock_before_dispatch()
RETURNS trigger AS $$
DECLARE
  item RECORD;
  v_available_qty INTEGER;
  v_insufficient BOOLEAN := FALSE;
  v_user_id UUID;
  v_missing_sku TEXT;
  v_missing_qty INTEGER;
  v_wh_name TEXT;
BEGIN
  -- 1. Validar cuando pasa a 'despachado', 'en preparación' o WMS 'En preparación'
  IF (NEW.status IN ('despachado', 'en preparación') AND COALESCE(OLD.status, '') NOT IN ('despachado', 'en preparación'))
     OR (NEW.estado_wms = 'En preparación' AND COALESCE(OLD.estado_wms, '') != 'En preparación') THEN
     
     -- 2. Si no califica para procesar stock, no hacemos nada
     IF NOT public.should_process_order_stock(NEW.id) THEN
       RETURN NEW;
     END IF;

     -- 3. Verificar stock disponible para cada ítem del pedido
     FOR item IN 
       SELECT oi.*, p.sku, p.name AS prod_name, p.is_virtual, w.name AS wh_name
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       JOIN warehouses w ON w.id = oi.warehouse_id
       WHERE oi.order_id = NEW.id
     LOOP
       -- Si es virtual, no descontamos ni controlamos stock
       IF COALESCE(item.is_virtual, FALSE) THEN
         CONTINUE;
       END IF;

       -- Obtener cantidad física disponible en la bodega asignada
       SELECT COALESCE(quantity, 0) INTO v_available_qty
       FROM inventory
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-vincular el trigger para cualquier cambio en la tabla orders (no solo status)
DROP TRIGGER IF EXISTS on_order_before_dispatch ON public.orders;
CREATE TRIGGER on_order_before_dispatch
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_order_stock_before_dispatch();
