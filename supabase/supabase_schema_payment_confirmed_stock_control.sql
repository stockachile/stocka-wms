-- ==============================================================================
-- WMS STOCKA - MIGRACIÓN: CONTROL DE STOCK COMPROMETIDO EXCLUSIVO POR PAGO CONFIRMADO
-- Regla:
-- 1. Los pedidos con estado de pago PENDIENTE no se consideran para stock comprometido.
-- 2. Solo comprometen stock cuando el pedido está CONFIRMADO (no cancelado/archivado)
--    y el pago está CONFIRMADO (paid, pagado, completed, approved, cobrado, o marketplace).
-- ==============================================================================

-- 1. Función auxiliar para validar si un pedido califica para comprometer stock
CREATE OR REPLACE FUNCTION public.is_order_stock_eligible(p_order public.orders)
RETURNS BOOLEAN AS $$
DECLARE
  v_status TEXT;
  v_wms TEXT;
  v_pay_status TEXT;
  v_shop_fin TEXT;
  v_platform TEXT;
  v_is_marketplace BOOLEAN;
BEGIN
  IF p_order.id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- A. Regla de Pedido Confirmado:
  v_status := LOWER(TRIM(COALESCE(p_order.status, '')));
  v_wms := COALESCE(p_order.estado_wms, 'En procesamiento');

  -- Pedido cancelado o en devolución: NO compromete stock
  IF v_status IN ('cancelado', 'devolución', 'devolucion') THEN
    RETURN FALSE;
  END IF;

  -- Pedido en estado terminal o inactivo en WMS: NO compromete stock en estante
  IF v_wms IN ('Cancelado', 'Archivado', 'Despachado') THEN
    RETURN FALSE;
  END IF;

  -- Si el payload de Shopify registra cancelación o falta de confirmación: NO compromete stock
  IF p_order.raw_shopify_data IS NOT NULL THEN
    IF p_order.raw_shopify_data->>'cancelled_at' IS NOT NULL THEN
      RETURN FALSE;
    END IF;
    IF COALESCE((p_order.raw_shopify_data->>'confirmed')::boolean, true) = false THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- B. Regla de Pago Confirmado / No Pendiente:
  v_pay_status := LOWER(TRIM(COALESCE(p_order.payment_status, '')));
  v_shop_fin := LOWER(TRIM(COALESCE(p_order.raw_shopify_data->>'financial_status', '')));
  v_platform := COALESCE(p_order.external_platform, p_order.origen, 'Manual');
  v_is_marketplace := v_platform IN ('Falabella', 'MercadoLibre', 'Mercado Libre', 'Paris', 'Ripley', 'Walmart');

  -- Si el estado de pago es explícitamente pendiente o no pagado, NO compromete stock
  IF v_pay_status IN ('pending', 'pendiente', 'unpaid', 'no pagado', 'por_pagar', 'por pagar')
     OR v_shop_fin IN ('pending', 'pendiente', 'unpaid', 'no pagado', 'por_pagar', 'por pagar') THEN
    RETURN FALSE;
  END IF;

  -- Si el pago está anulado o reembolsado, NO compromete stock
  IF v_pay_status IN ('refunded', 'reembolsado', 'partially_refunded', 'parcialmente_reembolsado', 'voided', 'anulado')
     OR v_shop_fin IN ('refunded', 'reembolsado', 'partially_refunded', 'parcialmente_reembolsado', 'voided', 'anulado') THEN
    RETURN FALSE;
  END IF;

  -- Si el pago está explícitamente confirmado/pagado
  IF v_pay_status IN ('paid', 'pagado', 'completed', 'confirmed', 'approved', 'cobrado')
     OR v_shop_fin IN ('paid', 'pagado', 'completed', 'confirmed', 'approved', 'cobrado') THEN
    RETURN TRUE;
  END IF;

  -- Canales de Marketplace (Falabella, Paris, Mercado Libre, Ripley, Walmart):
  -- Los pedidos generados ya están confirmados por el marketplace salvo que estén reembolsados/anulados
  IF v_is_marketplace THEN
    RETURN TRUE;
  END IF;

  -- Pedidos Manuales / Punto de Venta generados directamente en WMS para despacho:
  -- Se consideran confirmados salvo que tengan un estado de pago pendiente explícito
  IF v_platform IN ('Manual', 'Punto de Venta') THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;


-- 2. Sobrecarga por UUID para consultas y triggers externos
CREATE OR REPLACE FUNCTION public.is_order_stock_eligible(p_order_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_ord public.orders;
BEGIN
  SELECT * INTO v_ord FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  RETURN public.is_order_stock_eligible(v_ord);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;


-- 3. Redefinir handle_new_order_item() para verificar pedido confirmado y pago confirmado
CREATE OR REPLACE FUNCTION public.handle_new_order_item()
RETURNS trigger AS $$
DECLARE
  v_order public.orders;
  v_wms_status TEXT;
  v_is_virtual BOOLEAN;
  v_should_process BOOLEAN;
  v_is_eligible BOOLEAN;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = NEW.order_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_wms_status := COALESCE(v_order.estado_wms, 'En procesamiento');
  
  v_should_process := public.should_process_order_stock(NEW.order_id);
  IF NOT v_should_process THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = NEW.product_id;
  IF v_is_virtual THEN
    RETURN NEW;
  END IF;

  -- Si la orden está finalizada, cancelada o archivada en WMS, nunca alterar stock
  IF v_wms_status IN ('Despachado', 'Cancelado', 'Archivado') THEN
    RETURN NEW;
  END IF;

  -- Si la orden está en preparación/mesa: actualizar reserved_quantity
  IF v_wms_status IN ('En preparación', 'Pickeado') THEN
    IF NEW.warehouse_id IS NOT NULL AND LOWER(COALESCE(v_order.status, '')) NOT IN ('cancelado', 'devolución', 'devolucion') THEN
      UPDATE public.inventory
      SET reserved_quantity = reserved_quantity + NEW.quantity
      WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
    END IF;
  -- Si la orden está en procesamiento/estante: actualizar committed_quantity SOLO si pedido y pago están confirmados
  ELSE
    v_is_eligible := public.is_order_stock_eligible(v_order);
    IF v_is_eligible AND NEW.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET committed_quantity = committed_quantity + NEW.quantity
      WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4. Redefinir handle_delete_order_item()
CREATE OR REPLACE FUNCTION public.handle_delete_order_item()
RETURNS trigger AS $$
DECLARE
  v_order public.orders;
  v_wms_status TEXT;
  v_is_virtual BOOLEAN;
  v_should_process BOOLEAN;
  v_was_eligible BOOLEAN;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = OLD.order_id;
  IF NOT FOUND THEN
    RETURN OLD;
  END IF;

  v_should_process := public.should_process_order_stock(OLD.order_id);
  IF NOT v_should_process THEN
    RETURN OLD;
  END IF;

  SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = OLD.product_id;
  IF v_is_virtual THEN
    RETURN OLD;
  END IF;

  v_wms_status := COALESCE(v_order.estado_wms, 'En procesamiento');
  IF v_wms_status IN ('Despachado', 'Cancelado', 'Archivado') THEN
    RETURN OLD;
  END IF;

  -- Si la orden estaba en preparación/mesa: liberar reserved_quantity
  IF v_wms_status IN ('En preparación', 'Pickeado') THEN
    IF OLD.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET reserved_quantity = GREATEST(0, reserved_quantity - OLD.quantity)
      WHERE product_id = OLD.product_id AND warehouse_id = OLD.warehouse_id;
    END IF;
  -- Si la orden estaba en procesamiento/estante: liberar committed_quantity SOLO si estaba comprometiendo
  ELSE
    v_was_eligible := public.is_order_stock_eligible(v_order);
    IF v_was_eligible AND OLD.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET committed_quantity = GREATEST(0, committed_quantity - OLD.quantity)
      WHERE product_id = OLD.product_id AND warehouse_id = OLD.warehouse_id;
    END IF;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 5. Redefinir handle_update_order_item()
CREATE OR REPLACE FUNCTION public.handle_update_order_item()
RETURNS trigger AS $$
DECLARE
  v_order public.orders;
  v_old_process BOOLEAN;
  v_new_process BOOLEAN;
  v_old_is_virtual BOOLEAN;
  v_new_is_virtual BOOLEAN;
  v_qty_diff INTEGER;
  v_wms_status TEXT;
  v_is_eligible BOOLEAN;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = NEW.order_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_old_process := public.should_process_order_stock(OLD.order_id);
  v_new_process := public.should_process_order_stock(NEW.order_id);

  IF NOT v_old_process AND NOT v_new_process THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(is_virtual, false) INTO v_old_is_virtual FROM public.products WHERE id = OLD.product_id;
  SELECT COALESCE(is_virtual, false) INTO v_new_is_virtual FROM public.products WHERE id = NEW.product_id;

  v_wms_status := COALESCE(v_order.estado_wms, 'En procesamiento');
  IF v_wms_status IN ('Despachado', 'Cancelado', 'Archivado') THEN
    RETURN NEW;
  END IF;

  v_is_eligible := public.is_order_stock_eligible(v_order);

  -- Si está en preparación/mesa: actualizar reserved_quantity
  IF v_wms_status IN ('En preparación', 'Pickeado') THEN
    IF OLD.product_id != NEW.product_id OR OLD.warehouse_id != NEW.warehouse_id THEN
      IF v_old_process AND OLD.warehouse_id IS NOT NULL AND NOT v_old_is_virtual THEN
        UPDATE public.inventory
        SET reserved_quantity = GREATEST(0, reserved_quantity - OLD.quantity)
        WHERE product_id = OLD.product_id AND warehouse_id = OLD.warehouse_id;
      END IF;
      IF v_new_process AND NEW.warehouse_id IS NOT NULL AND NOT v_new_is_virtual THEN
        UPDATE public.inventory
        SET reserved_quantity = reserved_quantity + NEW.quantity
        WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
      END IF;
    ELSE
      v_qty_diff := NEW.quantity - OLD.quantity;
      IF v_qty_diff != 0 AND NEW.warehouse_id IS NOT NULL AND NOT v_new_is_virtual THEN
        UPDATE public.inventory
        SET reserved_quantity = GREATEST(0, reserved_quantity + v_qty_diff)
        WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
      END IF;
    END IF;

  -- Si está en estante ('En procesamiento'): actualizar committed_quantity SOLO si es elegible
  ELSE
    IF OLD.product_id != NEW.product_id OR OLD.warehouse_id != NEW.warehouse_id THEN
      IF v_old_process AND OLD.warehouse_id IS NOT NULL AND NOT v_old_is_virtual AND v_is_eligible THEN
        UPDATE public.inventory
        SET committed_quantity = GREATEST(0, committed_quantity - OLD.quantity)
        WHERE product_id = OLD.product_id AND warehouse_id = OLD.warehouse_id;
      END IF;
      IF v_new_process AND NEW.warehouse_id IS NOT NULL AND NOT v_new_is_virtual AND v_is_eligible THEN
        UPDATE public.inventory
        SET committed_quantity = committed_quantity + NEW.quantity
        WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
      END IF;
    ELSE
      v_qty_diff := NEW.quantity - OLD.quantity;
      IF v_qty_diff != 0 AND NEW.warehouse_id IS NOT NULL AND NOT v_new_is_virtual AND v_is_eligible THEN
        UPDATE public.inventory
        SET committed_quantity = GREATEST(0, committed_quantity + v_qty_diff)
        WHERE product_id = NEW.product_id AND warehouse_id = NEW.warehouse_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 6. Redefinir handle_order_status_change() para reaccionar a cambios de pago y confirmación
CREATE OR REPLACE FUNCTION public.handle_order_status_change()
RETURNS trigger AS $$
DECLARE
  item RECORD;
  v_old_wms TEXT;
  v_new_wms TEXT;
  v_is_virtual BOOLEAN;
  v_order_num TEXT;
  v_clean_num TEXT;
  v_was_eligible BOOLEAN;
  v_is_eligible BOOLEAN;
BEGIN
  -- Validar si el pedido califica para procesamiento de stock según reglas de corte
  IF NOT public.should_process_order_stock(NEW.id) THEN
    RETURN NEW;
  END IF;

  v_old_wms := COALESCE(OLD.estado_wms, 'En procesamiento');
  v_new_wms := COALESCE(NEW.estado_wms, 'En procesamiento');
  v_order_num := COALESCE(NEW.external_order_number, NEW.id::text);
  v_clean_num := regexp_replace(v_order_num, '[^0-9]', '', 'g');

  v_was_eligible := public.is_order_stock_eligible(OLD);
  v_is_eligible := public.is_order_stock_eligible(NEW);

  -- =========================================================================
  -- CASO 1: El pedido pasa a DESPACHADO (Únicamente cuando estado_wms = 'Despachado')
  -- =========================================================================
  IF v_new_wms = 'Despachado' AND v_old_wms != 'Despachado' THEN
    
    -- REGLA MÁXIMA DE IDEMPOTENCIA: Si ya descontó stock en su ciclo de vida o existe movimiento previo
    IF COALESCE(OLD.stock_descontado, false) = true 
       OR EXISTS (SELECT 1 FROM public.movements WHERE order_id = NEW.id AND type = 'out')
       OR (length(v_clean_num) >= 3 AND EXISTS (SELECT 1 FROM public.movements WHERE reference_doc ILIKE '%' || v_clean_num || '%' AND type = 'out'))
    THEN
      IF length(v_clean_num) >= 3 THEN
        UPDATE public.movements 
        SET order_id = NEW.id 
        WHERE order_id IS NULL AND type = 'out' AND reference_doc ILIKE '%' || v_clean_num || '%';
      END IF;

      -- Liberar compromisos o reservas en estante/mesa sin afectar stock físico
      FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
        SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
        IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
          IF v_old_wms IN ('En preparación', 'Pickeado') THEN
            UPDATE public.inventory 
            SET reserved_quantity = GREATEST(0, reserved_quantity - item.quantity)
            WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
          ELSIF v_old_wms = 'En procesamiento' AND v_was_eligible THEN
            UPDATE public.inventory 
            SET committed_quantity = GREATEST(0, committed_quantity - item.quantity)
            WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
          END IF;
        END IF;
      END LOOP;

      NEW.stock_descontado := true;
      NEW.stock_descontado_at := COALESCE(NEW.stock_descontado_at, NOW());
      RETURN NEW;
    END IF;

    FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
      SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
      IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
        
        IF NOT EXISTS (
          SELECT 1 FROM public.movements 
          WHERE order_id = NEW.id AND product_id = item.product_id AND type = 'out'
        ) THEN
          -- Si venía de preparación/mesa (En preparación o Pickeado): libera de reservado y descuenta físico
          IF v_old_wms IN ('En preparación', 'Pickeado') THEN
            UPDATE public.inventory 
            SET quantity = GREATEST(0, quantity - item.quantity),
                reserved_quantity = GREATEST(0, reserved_quantity - item.quantity)
            WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
          
          -- Si venía de Archivado o Cancelado: descuenta directamente del stock físico
          ELSIF v_old_wms IN ('Cancelado', 'Archivado') THEN
            UPDATE public.inventory 
            SET quantity = GREATEST(0, quantity - item.quantity)
            WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;

          -- Si venía directo de procesamiento: libera de comprometido (si correspondía) y descuenta físico
          ELSE
            UPDATE public.inventory 
            SET quantity = GREATEST(0, quantity - item.quantity),
                committed_quantity = CASE WHEN v_was_eligible THEN GREATEST(0, committed_quantity - item.quantity) ELSE committed_quantity END
            WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
          END IF;
          
          INSERT INTO public.movements (product_id, warehouse_id, type, quantity, date, reference_doc, order_id)
          VALUES (item.product_id, item.warehouse_id, 'out', item.quantity, NOW(), 'Pedido ' || v_order_num, NEW.id);
        END IF;

      END IF;
    END LOOP;

    NEW.stock_descontado := true;
    NEW.stock_descontado_at := NOW();

  -- =========================================================================
  -- CASO 2: El pedido pasa a "En preparación" o "Pickeado" (Sale del estante hacia la mesa)
  -- =========================================================================
  ELSIF v_new_wms IN ('En preparación', 'Pickeado') AND v_old_wms NOT IN ('En preparación', 'Pickeado') 
        AND v_old_wms != 'Despachado' THEN
    
    FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
      SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
      IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
        IF v_old_wms = 'En procesamiento' AND v_was_eligible THEN
          UPDATE public.inventory 
          SET committed_quantity = GREATEST(0, committed_quantity - item.quantity),
              reserved_quantity = reserved_quantity + item.quantity
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        ELSE
          UPDATE public.inventory 
          SET reserved_quantity = reserved_quantity + item.quantity
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        END IF;
      END IF;
    END LOOP;

  -- =========================================================================
  -- CASO 3: El pedido se DEVUELVE de mesa ("En preparación"/"Pickeado") a "En procesamiento"
  -- =========================================================================
  ELSIF v_new_wms = 'En procesamiento' AND v_old_wms IN ('En preparación', 'Pickeado') 
        AND v_old_wms != 'Despachado' THEN
    
    FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
      SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
      IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
        UPDATE public.inventory 
        SET reserved_quantity = GREATEST(0, reserved_quantity - item.quantity)
        WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;

        IF v_is_eligible THEN
          UPDATE public.inventory 
          SET committed_quantity = committed_quantity + item.quantity
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        END IF;
      END IF;
    END LOOP;

  -- =========================================================================
  -- CASO 4: El pedido se CANCELA o ARCHIVA en WMS (o se cancela en status de plataforma)
  -- =========================================================================
  ELSIF (v_new_wms IN ('Cancelado', 'Archivado') AND v_old_wms NOT IN ('Cancelado', 'Archivado', 'Despachado'))
        OR (LOWER(COALESCE(NEW.status, '')) = 'cancelado' AND LOWER(COALESCE(OLD.status, '')) != 'cancelado') THEN
    
    FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
      SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
      IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
        IF v_old_wms IN ('En preparación', 'Pickeado') THEN
          UPDATE public.inventory 
          SET reserved_quantity = GREATEST(0, reserved_quantity - item.quantity)
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        ELSIF v_was_eligible THEN
          UPDATE public.inventory 
          SET committed_quantity = GREATEST(0, committed_quantity - item.quantity)
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        END IF;
      END IF;
    END LOOP;

  -- =========================================================================
  -- CASO 5: Transición de Elegibilidad de Stock en Estante ('En procesamiento')
  -- (Ej: Pago confirmado de pendiente -> pagado, o pedido cancelado / reembolsado)
  -- =========================================================================
  ELSIF v_new_wms = 'En procesamiento' AND v_old_wms = 'En procesamiento' THEN
    -- A) Si antes NO comprometía y AHORA SÍ compromete (pago y pedido confirmados):
    IF NOT v_was_eligible AND v_is_eligible THEN
      FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
        SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
        IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
          UPDATE public.inventory 
          SET committed_quantity = committed_quantity + item.quantity
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        END IF;
      END LOOP;

    -- B) Si antes SÍ comprometía y AHORA YA NO compromete (pasó a pendiente, reembolsado, o cancelado):
    ELSIF v_was_eligible AND NOT v_is_eligible THEN
      FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
        SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
        IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
          UPDATE public.inventory 
          SET committed_quantity = GREATEST(0, committed_quantity - item.quantity)
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        END IF;
      END LOOP;
    END IF;

  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 7. Actualizar el trigger en orders para activarse con cambios de WMS, payment_status, status y raw_shopify_data
DROP TRIGGER IF EXISTS on_order_wms_status_change ON public.orders;
DROP TRIGGER IF EXISTS on_order_stock_change ON public.orders;

CREATE TRIGGER on_order_stock_change
  BEFORE UPDATE OF estado_wms, payment_status, status, raw_shopify_data ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_order_status_change();


-- 8. Actualizar función de recálculo oficial (recalculate_committed_stock)
CREATE OR REPLACE FUNCTION public.recalculate_committed_stock()
RETURNS void AS $$
DECLARE
  r RECORD;
BEGIN
  -- Resetear committed_quantity y reserved_quantity a 0
  UPDATE public.inventory 
  SET committed_quantity = 0, 
      reserved_quantity = 0
  WHERE id IS NOT NULL;

  -- Recalcular committed_quantity:
  -- Solo pedidos en estante ('En procesamiento' o sin estado wms terminal),
  -- que califiquen en should_process_order_stock Y que tengan pedido confirmado y pago confirmado
  FOR r IN 
    SELECT oi.product_id, oi.warehouse_id, SUM(oi.quantity) as total_committed
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE COALESCE(o.estado_wms, 'En procesamiento') NOT IN ('En preparación', 'Pickeado', 'Despachado', 'Cancelado', 'Archivado')
      AND public.should_process_order_stock(o.id)
      AND public.is_order_stock_eligible(o)
    GROUP BY oi.product_id, oi.warehouse_id
  LOOP
    IF r.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET committed_quantity = r.total_committed
      WHERE product_id = r.product_id AND warehouse_id = r.warehouse_id;
    END IF;
  END LOOP;

  -- Recalcular reserved_quantity:
  -- Pedidos activos en mesa de preparación ('En preparación' o 'Pickeado')
  FOR r IN 
    SELECT oi.product_id, oi.warehouse_id, SUM(oi.quantity) as total_reserved
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.estado_wms IN ('En preparación', 'Pickeado')
      AND public.should_process_order_stock(o.id)
      AND LOWER(COALESCE(o.status, '')) NOT IN ('cancelado', 'devolución', 'devolucion')
    GROUP BY oi.product_id, oi.warehouse_id
  LOOP
    IF r.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET reserved_quantity = r.total_reserved
      WHERE product_id = r.product_id AND warehouse_id = r.warehouse_id;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 9. Ejecutar recálculo inmediato para limpiar stock comprometido de pedidos pendientes
SELECT public.recalculate_committed_stock();
