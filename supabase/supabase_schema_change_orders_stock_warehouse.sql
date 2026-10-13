-- ==============================================================================
-- WMS STOCKA - GESTIÓN Y CAMBIO DE BODEGAS DE STOCK CON CUADRATURA DE KARDEX E INVENTARIOS
-- ==============================================================================
-- Esta función permite cambiar la bodega de descuento de stock de uno o más pedidos,
-- garantizando la integridad referencial y cuadratura matemática:
-- 1. Actualiza warehouse_id en public.order_items.
-- 2. Si el pedido ya fue despachado (stock_descontado = true o estado_wms = 'Despachado'):
--    - Repone el stock físico en la bodega origen en public.inventory.
--    - Descuenta el stock físico en la bodega destino en public.inventory.
--    - Actualiza el warehouse_id de los movimientos 'out' en public.movements (Kardex).
-- 3. Si el pedido está pendiente o en preparación:
--    - Reubica el stock reservado / comprometido hacia la nueva bodega.
-- 4. Opcionalmente sincroniza la sucursal_pickeo del pedido si se indica p_sync_sucursal = true.
-- 5. Ejecuta recalculate_committed_stock() al finalizar para asegurar cuadratura absoluta.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.change_orders_stock_warehouse(
  p_order_ids UUID[],
  p_target_warehouse_id UUID, -- Si es NULL, alinea automáticamente con la sucursal_pickeo de cada orden
  p_sync_sucursal BOOLEAN DEFAULT false
)
RETURNS JSONB AS $$
DECLARE
  v_order_id UUID;
  v_target_wh UUID;
  v_old_wh UUID;
  v_sucursal_pickeo TEXT;
  v_estado_wms TEXT;
  v_stock_descontado BOOLEAN;
  v_item RECORD;
  v_target_sucursal_name TEXT;
  v_updated_orders_count INT := 0;
  v_updated_items_count INT := 0;
  v_adjusted_physical_count INT := 0;
  v_kardex_updated_count INT := 0;
BEGIN
  -- 1. Determinar nombre de sucursal física asociada si se solicita sincronización
  IF p_target_warehouse_id IS NOT NULL THEN
    IF p_target_warehouse_id = '973da888-8a63-4790-a08f-919e1af41a93' THEN
      v_target_sucursal_name := 'Sucursal Ñuñoa';
    ELSIF p_target_warehouse_id = '414605cb-f926-43d2-8bd2-d9509f7b458a' THEN
      v_target_sucursal_name := 'Sucursal La Reina';
    ELSIF p_target_warehouse_id = '1e3395fc-bc24-48e5-8c3c-04e8a0f7c32a' THEN
      v_target_sucursal_name := 'Sucursal Recoleta';
    ELSIF p_target_warehouse_id = 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09' THEN
      v_target_sucursal_name := 'Sucursal Virtual (Hub)';
    END IF;
  END IF;

  -- 2. Procesar cada orden solicitada
  FOREACH v_order_id IN ARRAY p_order_ids LOOP
    SELECT sucursal_pickeo, estado_wms, COALESCE(stock_descontado, false)
    INTO v_sucursal_pickeo, v_estado_wms, v_stock_descontado
    FROM public.orders
    WHERE id = v_order_id;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- Si target_warehouse_id es NULL (alineación automática), resolver por la sucursal de la orden
    IF p_target_warehouse_id IS NULL THEN
      IF LOWER(COALESCE(v_sucursal_pickeo, '')) LIKE '%ñuñoa%' THEN
        v_target_wh := '973da888-8a63-4790-a08f-919e1af41a93';
      ELSIF LOWER(COALESCE(v_sucursal_pickeo, '')) LIKE '%la reina%' THEN
        v_target_wh := '414605cb-f926-43d2-8bd2-d9509f7b458a';
      ELSIF LOWER(COALESCE(v_sucursal_pickeo, '')) LIKE '%recoleta%' THEN
        v_target_wh := '1e3395fc-bc24-48e5-8c3c-04e8a0f7c32a';
      ELSE
        v_target_wh := 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09';
      END IF;
    ELSE
      v_target_wh := p_target_warehouse_id;
    END IF;

    -- 3. Sincronizar sucursal en orders si fue solicitado
    IF p_sync_sucursal AND v_target_sucursal_name IS NOT NULL THEN
      UPDATE public.orders
      SET sucursal_pickeo = v_target_sucursal_name
      WHERE id = v_order_id AND (sucursal_pickeo IS DISTINCT FROM v_target_sucursal_name);
    END IF;

    -- 4. Procesar items de la orden
    FOR v_item IN 
      SELECT oi.id, oi.product_id, oi.warehouse_id, oi.quantity, COALESCE(p.is_virtual, false) as is_virtual
      FROM public.order_items oi
      LEFT JOIN public.products p ON p.id = oi.product_id
      WHERE oi.order_id = v_order_id
    LOOP
      v_old_wh := v_item.warehouse_id;

      -- Si ya está en la bodega destino, omitir
      IF v_old_wh IS NOT DISTINCT FROM v_target_wh THEN
        CONTINUE;
      END IF;

      -- Actualizar bodega del ítem
      UPDATE public.order_items
      SET warehouse_id = v_target_wh
      WHERE id = v_item.id;
      
      v_updated_items_count := v_updated_items_count + 1;

      -- Si es ítem virtual o sin product_id, no afecta inventario físico
      IF v_item.is_virtual OR v_item.product_id IS NULL THEN
        CONTINUE;
      END IF;

      -- A. CASO: Pedido YA DESPACHADO (stock ya descontado)
      IF v_estado_wms = 'Despachado' OR v_stock_descontado = true THEN
        -- 1. Reponer stock físico en la bodega origen
        IF v_old_wh IS NOT NULL THEN
          UPDATE public.inventory
          SET quantity = quantity + v_item.quantity
          WHERE product_id = v_item.product_id AND warehouse_id = v_old_wh;
        END IF;

        -- 2. Descontar stock físico en la nueva bodega destino
        INSERT INTO public.inventory (product_id, warehouse_id, quantity, committed_quantity, reserved_quantity)
        VALUES (v_item.product_id, v_target_wh, 0, 0, 0)
        ON CONFLICT (product_id, warehouse_id) DO NOTHING;

        UPDATE public.inventory
        SET quantity = GREATEST(0, quantity - v_item.quantity)
        WHERE product_id = v_item.product_id AND warehouse_id = v_target_wh;

        v_adjusted_physical_count := v_adjusted_physical_count + 1;

        -- 3. Actualizar Kardex oficial (movements) con la nueva bodega
        UPDATE public.movements
        SET warehouse_id = v_target_wh
        WHERE order_id = v_order_id 
          AND product_id = v_item.product_id 
          AND type = 'out';

        IF FOUND THEN
          v_kardex_updated_count := v_kardex_updated_count + 1;
        END IF;

      -- B. CASO: Pedido PENDIENTE O EN PREPARACIÓN (stock aún no descontado físicamente)
      ELSIF v_estado_wms IN ('En preparación', 'Pickeado') THEN
        IF v_old_wh IS NOT NULL THEN
          UPDATE public.inventory
          SET reserved_quantity = GREATEST(0, reserved_quantity - v_item.quantity)
          WHERE product_id = v_item.product_id AND warehouse_id = v_old_wh;
        END IF;

        INSERT INTO public.inventory (product_id, warehouse_id, quantity, committed_quantity, reserved_quantity)
        VALUES (v_item.product_id, v_target_wh, 0, 0, 0)
        ON CONFLICT (product_id, warehouse_id) DO NOTHING;

        UPDATE public.inventory
        SET reserved_quantity = reserved_quantity + v_item.quantity
        WHERE product_id = v_item.product_id AND warehouse_id = v_target_wh;

      ELSIF COALESCE(v_estado_wms, 'En procesamiento') = 'En procesamiento' THEN
        IF v_old_wh IS NOT NULL THEN
          UPDATE public.inventory
          SET committed_quantity = GREATEST(0, committed_quantity - v_item.quantity)
          WHERE product_id = v_item.product_id AND warehouse_id = v_old_wh;
        END IF;

        INSERT INTO public.inventory (product_id, warehouse_id, quantity, committed_quantity, reserved_quantity)
        VALUES (v_item.product_id, v_target_wh, 0, 0, 0)
        ON CONFLICT (product_id, warehouse_id) DO NOTHING;

        UPDATE public.inventory
        SET committed_quantity = committed_quantity + v_item.quantity
        WHERE product_id = v_item.product_id AND warehouse_id = v_target_wh;
      END IF;

    END LOOP;

    v_updated_orders_count := v_updated_orders_count + 1;
  END LOOP;

  -- 5. Sincronizar recálculo de stock comprometido y reservado global
  PERFORM public.recalculate_committed_stock();

  RETURN jsonb_build_object(
    'success', true,
    'orders_count', v_updated_orders_count,
    'items_count', v_updated_items_count,
    'physical_adjustments', v_adjusted_physical_count,
    'kardex_movements_updated', v_kardex_updated_count
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Permisos de ejecución
GRANT EXECUTE ON FUNCTION public.change_orders_stock_warehouse(UUID[], UUID, BOOLEAN) TO authenticated, service_role, anon;
