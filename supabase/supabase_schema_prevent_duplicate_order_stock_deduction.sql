-- ==============================================================================
-- WMS STOCKA - MIGRACIÓN: REGLA DE DESCUENTO ÚNICO DE STOCK E IDEMPOTENCIA
-- 1. Añadir columnas de control en orders: stock_descontado y stock_descontado_at
-- 2. Añadir columna order_id en movements
-- 3. Vincular retrospectivamente movimientos con orders (backfill)
-- 4. Crear índice UNIQUE en movements (order_id, product_id) WHERE type = 'out'
-- 5. Actualizar handle_order_status_change() para blindar el despacho
-- ==============================================================================

-- 1. Columnas de control en orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS stock_descontado BOOLEAN DEFAULT false;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS stock_descontado_at TIMESTAMPTZ;

-- 2. Columna order_id en movements
ALTER TABLE public.movements ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL;

-- 3. Backfill order_id en movements
-- Coincidencia con UUID de orders
UPDATE public.movements m
SET order_id = o.id
FROM public.orders o
WHERE m.order_id IS NULL
  AND (
    m.reference_doc = 'Pedido ' || o.id::text
    OR m.reference_doc ILIKE 'Pedido ' || o.id::text || '%'
  );

-- Coincidencia con external_order_number de orders
UPDATE public.movements m
SET order_id = o.id
FROM public.orders o
WHERE m.order_id IS NULL
  AND o.external_order_number IS NOT NULL
  AND (
    m.reference_doc = 'Pedido ' || o.external_order_number
    OR m.reference_doc ILIKE 'Pedido ' || o.external_order_number || '%'
  );

-- 4. Backfill stock_descontado en orders
UPDATE public.orders o
SET stock_descontado = true,
    stock_descontado_at = NOW()
WHERE o.stock_descontado IS NOT TRUE
  AND (
    EXISTS (SELECT 1 FROM public.movements m WHERE m.order_id = o.id AND m.type = 'out')
    OR o.estado_wms = 'Despachado'
  );

-- 5. Crear UNIQUE INDEX en movements
CREATE UNIQUE INDEX IF NOT EXISTS idx_movements_unique_order_product_out
ON public.movements (order_id, product_id)
WHERE type = 'out' AND order_id IS NOT NULL;

-- 6. Redefinir la función handle_order_status_change() con blindaje estricto de idempotencia
CREATE OR REPLACE FUNCTION public.handle_order_status_change()
RETURNS trigger AS $$
DECLARE
  item RECORD;
  v_old_wms TEXT;
  v_new_wms TEXT;
  v_is_virtual BOOLEAN;
  v_order_num TEXT;
BEGIN
  -- Validar si el pedido califica para procesamiento de stock según reglas de corte
  IF NOT public.should_process_order_stock(NEW.id) THEN
    RETURN NEW;
  END IF;

  v_old_wms := COALESCE(OLD.estado_wms, 'En procesamiento');
  v_new_wms := COALESCE(NEW.estado_wms, 'En procesamiento');
  v_order_num := COALESCE(NEW.external_order_number, NEW.id::text);

  -- =========================================================================
  -- CASO 1: El pedido pasa a DESPACHADO (Únicamente cuando estado_wms = 'Despachado')
  -- =========================================================================
  IF v_new_wms = 'Despachado' AND v_old_wms != 'Despachado' THEN
    
    -- REGLA MÁXIMA DE IDEMPOTENCIA: Si ya descontó stock en su ciclo de vida, nunca descontar dos veces
    IF COALESCE(OLD.stock_descontado, false) = true THEN
      NEW.stock_descontado := true;
      RETURN NEW;
    END IF;

    -- Validación secundaria: verificar si ya existe al menos una salida previa para esta orden
    IF EXISTS (
      SELECT 1 FROM public.movements 
      WHERE order_id = NEW.id AND type = 'out'
    ) THEN
      NEW.stock_descontado := true;
      RETURN NEW;
    END IF;

    FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
      SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
      IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
        
        -- Blindaje adicional por ítem: asegurar que no exista ya una salida previa de este producto y orden
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

          -- Si venía directo de procesamiento (sin pasar por mesa): libera de comprometido y descuenta físico
          ELSE
            UPDATE public.inventory 
            SET quantity = GREATEST(0, quantity - item.quantity),
                committed_quantity = GREATEST(0, committed_quantity - item.quantity)
            WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
          END IF;
          
          -- Generar Log de Movimiento con order_id explícito y fecha exacta
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
        -- Si venía de estar comprometido en estante: liberar committed y sumar a reserved
        IF v_old_wms = 'En procesamiento' THEN
          UPDATE public.inventory 
          SET committed_quantity = GREATEST(0, committed_quantity - item.quantity),
              reserved_quantity = reserved_quantity + item.quantity
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        -- Si venía de Archivado o Cancelado: sumar directamente a reserved
        ELSIF v_old_wms IN ('Cancelado', 'Archivado') THEN
          UPDATE public.inventory 
          SET reserved_quantity = reserved_quantity + item.quantity
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        END IF;
      END IF;
    END LOOP;

  -- =========================================================================
  -- CASO 3: El pedido se DEVUELVE de mesa ("En preparación"/"Pickeado") o inactivo a "En procesamiento"
  -- =========================================================================
  ELSIF v_new_wms = 'En procesamiento' AND v_old_wms IN ('En preparación', 'Pickeado', 'Archivado', 'Cancelado') 
        AND v_old_wms != 'Despachado' THEN
    
    FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
      SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
      IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
        IF v_old_wms IN ('En preparación', 'Pickeado') THEN
          UPDATE public.inventory 
          SET reserved_quantity = GREATEST(0, reserved_quantity - item.quantity),
              committed_quantity = committed_quantity + item.quantity
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        ELSIF v_old_wms IN ('Archivado', 'Cancelado') THEN
          UPDATE public.inventory 
          SET committed_quantity = committed_quantity + item.quantity
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        END IF;
      END IF;
    END LOOP;

  -- =========================================================================
  -- CASO 4: El pedido se CANCELA o ARCHIVA en WMS (Liberación total de compromisos/reservas sin afectar físico)
  -- =========================================================================
  ELSIF v_new_wms IN ('Cancelado', 'Archivado') 
        AND v_old_wms NOT IN ('Cancelado', 'Archivado', 'Despachado') THEN
    
    FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
      SELECT COALESCE(is_virtual, false) INTO v_is_virtual FROM public.products WHERE id = item.product_id;
      IF NOT v_is_virtual AND item.warehouse_id IS NOT NULL THEN
        IF v_old_wms IN ('En preparación', 'Pickeado') THEN
          UPDATE public.inventory 
          SET reserved_quantity = GREATEST(0, reserved_quantity - item.quantity)
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        ELSE
          UPDATE public.inventory 
          SET committed_quantity = GREATEST(0, committed_quantity - item.quantity)
          WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;
        END IF;
      END IF;
    END LOOP;

  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
