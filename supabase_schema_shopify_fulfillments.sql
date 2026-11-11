-- ==============================================================================
-- WMS STOCKA - Supabase Schema: Sincronización Bidireccional con Shopify
-- (Fulfillment, Tracking, Enlaces de Seguimiento y Estado "En curso")
-- ==============================================================================
-- Ejecutar en el Editor SQL de Supabase (https://supabase.com/dashboard)

-- 1. Ampliar tabla merchant_integrations con configuraciones de retorno
ALTER TABLE public.merchant_integrations 
ADD COLUMN IF NOT EXISTS sync_tracking_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS notify_customer_on_fulfillment BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS sync_intermediate_statuses BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS granted_scopes TEXT[] DEFAULT ARRAY['read_products', 'read_orders'];

-- Comentarios explicativos
COMMENT ON COLUMN public.merchant_integrations.sync_tracking_enabled IS 'Indica si se envía el despacho y tracking de vuelta a Shopify';
COMMENT ON COLUMN public.merchant_integrations.notify_customer_on_fulfillment IS 'Si es true, Shopify envía el correo nativo con tracking al comprador final';
COMMENT ON COLUMN public.merchant_integrations.sync_intermediate_statuses IS 'Si es true, marca la orden en curso (in_progress) en Shopify al pasar a preparación/pickeado';
COMMENT ON COLUMN public.merchant_integrations.granted_scopes IS 'Lista de scopes OAuth confirmados por la tienda en Shopify';

-- 2. Ampliar tabla orders con campos de auditoría y estado real de Shopify
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS shopify_fulfillment_id TEXT,
ADD COLUMN IF NOT EXISTS shopify_fulfillment_status TEXT, -- 'pending', 'synced', 'error'
ADD COLUMN IF NOT EXISTS shopify_sync_last_error TEXT,
ADD COLUMN IF NOT EXISTS shopify_order_status TEXT DEFAULT 'unfulfilled', -- 'unfulfilled', 'in_progress', 'on_hold', 'ready_for_pickup', 'partial', 'fulfilled', 'cancelled'
ADD COLUMN IF NOT EXISTS shopify_fulfillment_order_id TEXT,
ADD COLUMN IF NOT EXISTS shopify_status_updated_at TIMESTAMP WITH TIME ZONE;

-- 3. Crear Tabla de Cola Asíncrona: shopify_fulfillment_queue
CREATE TABLE IF NOT EXISTS public.shopify_fulfillment_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    merchant_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    comercio TEXT NOT NULL,
    shopify_order_id TEXT,
    tracking_number TEXT,
    tracking_url TEXT,
    courier TEXT,
    operador TEXT,
    action_type TEXT NOT NULL CHECK (action_type IN ('create_fulfillment', 'update_tracking', 'set_in_progress', 'set_ready_for_pickup')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'needs_reauth')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    last_error TEXT,
    shopify_fulfillment_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    processed_at TIMESTAMP WITH TIME ZONE
);

-- Índices de alto rendimiento para procesamiento ágil
CREATE INDEX IF NOT EXISTS idx_shopify_queue_status_created 
ON public.shopify_fulfillment_queue(status, created_at);

CREATE INDEX IF NOT EXISTS idx_shopify_queue_order_id 
ON public.shopify_fulfillment_queue(order_id);

CREATE INDEX IF NOT EXISTS idx_shopify_queue_comercio 
ON public.shopify_fulfillment_queue(comercio);

-- 4. Seguridad a Nivel de Fila (RLS)
ALTER TABLE public.shopify_fulfillment_queue ENABLE ROW LEVEL SECURITY;

-- Admins tienen acceso completo
DROP POLICY IF EXISTS "Admins gestionan cola de shopify" ON public.shopify_fulfillment_queue;
CREATE POLICY "Admins gestionan cola de shopify" ON public.shopify_fulfillment_queue
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
    );

-- Comercios pueden visualizar el estado de sus registros
DROP POLICY IF EXISTS "Comercios ven su cola de shopify" ON public.shopify_fulfillment_queue;
CREATE POLICY "Comercios ven su cola de shopify" ON public.shopify_fulfillment_queue
    FOR SELECT USING (auth.uid() = merchant_id);

-- Acceso total a roles de servicio
GRANT ALL ON public.shopify_fulfillment_queue TO postgres, service_role;
GRANT SELECT ON public.shopify_fulfillment_queue TO authenticated;


-- Asegurar columnas adicionales de control manual y constraint de action_type en shopify_fulfillment_queue
ALTER TABLE public.shopify_fulfillment_queue
ADD COLUMN IF NOT EXISTS hold_reason TEXT,
ADD COLUMN IF NOT EXISTS hold_notes TEXT,
ADD COLUMN IF NOT EXISTS notify_customer BOOLEAN;

ALTER TABLE public.shopify_fulfillment_queue
DROP CONSTRAINT IF EXISTS shopify_fulfillment_queue_action_type_check;

ALTER TABLE public.shopify_fulfillment_queue
ADD CONSTRAINT shopify_fulfillment_queue_action_type_check
CHECK (action_type IN (
    'create_fulfillment',
    'update_tracking',
    'set_in_progress',
    'set_ready_for_pickup',
    'set_in_transit',
    'set_delivered',
    'set_on_hold',
    'release_hold',
    'cancel_fulfillment',
    'revert_in_progress'
));

-- 5. Trigger No-Bloqueante en orders para encolar eventos automáticamente
CREATE OR REPLACE FUNCTION public.enqueue_shopify_fulfillment_trigger_func()
RETURNS TRIGGER AS $$
DECLARE
    v_integration RECORD;
    v_shopify_order_id TEXT;
    v_action TEXT;
    v_existing_queue_id UUID;
    v_has_tracking BOOLEAN;
    v_is_dispatched BOOLEAN;
    v_was_dispatched BOOLEAN;
    v_is_delivered BOOLEAN;
    v_was_delivered BOOLEAN;
    v_is_in_transit BOOLEAN;
    v_was_in_transit BOOLEAN;
    v_tracking_changed BOOLEAN;
    v_is_preparing BOOLEAN;
    v_is_picked BOOLEAN;
    v_was_picked BOOLEAN;
    v_is_pickup BOOLEAN;
BEGIN
    -- 1. Filtrar solo pedidos de la plataforma Shopify
    IF NEW.external_platform IS NULL OR UPPER(NEW.external_platform) != 'SHOPIFY' THEN
        RETURN NEW;
    END IF;

    -- En UPDATE, ignorar si no hubo ningún cambio real en estado o tracking (evita re-encolar en syncs periódicos)
    IF TG_OP = 'UPDATE' THEN
        IF (OLD.estado_wms IS NOT DISTINCT FROM NEW.estado_wms)
           AND (OLD.status IS NOT DISTINCT FROM NEW.status)
           AND (OLD.lightdata_status IS NOT DISTINCT FROM NEW.lightdata_status)
           AND (OLD.estado_ruta_optiroute IS NOT DISTINCT FROM NEW.estado_ruta_optiroute)
           AND (OLD.tracking_number IS NOT DISTINCT FROM NEW.tracking_number)
           AND (OLD.tracking_url IS NOT DISTINCT FROM NEW.tracking_url)
           AND (OLD.courier IS NOT DISTINCT FROM NEW.courier) THEN
            RETURN NEW;
        END IF;
    END IF;

    -- 2. Consultar si el comercio tiene integración activa y con sincronización habilitada
    SELECT 
        id, merchant_id, sync_tracking_enabled, sync_intermediate_statuses, granted_scopes
    INTO v_integration
    FROM public.merchant_integrations
    WHERE platform = 'Shopify'
      AND is_active = true
      AND UPPER(TRIM(comercio)) = UPPER(TRIM(NEW.comercio))
    LIMIT 1;

    -- Si no existe integración activa o tiene la sincronización inversa apagada, salir sin hacer nada
    IF v_integration.id IS NULL OR COALESCE(v_integration.sync_tracking_enabled, false) = false THEN
        RETURN NEW;
    END IF;

    -- Extraer el ID numérico de Shopify desde raw_shopify_data
    BEGIN
        v_shopify_order_id := NEW.raw_shopify_data->>'id';
    EXCEPTION WHEN OTHERS THEN
        v_shopify_order_id := NULL;
    END;

    IF v_shopify_order_id IS NULL OR v_shopify_order_id = '' THEN
        RETURN NEW;
    END IF;

    -- Analizar condiciones de estado, retiro y tracking
    v_is_pickup := (UPPER(TRIM(COALESCE(NEW.categoria_entrega, ''))) = 'RETIRO')
                   OR (UPPER(TRIM(COALESCE(NEW.agenda, ''))) = 'RETIRO')
                   OR (UPPER(TRIM(COALESCE(NEW.operador, ''))) LIKE 'SUCURSAL%')
                   OR (LOWER(COALESCE(NEW.shipping_method, '')) LIKE '%retiro%');

    v_is_delivered := (LOWER(TRIM(COALESCE(NEW.status, ''))) IN ('entregado', 'delivered'))
                      OR (LOWER(TRIM(COALESCE(NEW.estado_wms, ''))) = 'entregado')
                      OR (LOWER(COALESCE(NEW.lightdata_status, '')) LIKE '%entregad%')
                      OR (LOWER(COALESCE(NEW.lightdata_status, '')) LIKE '%delivered%')
                      OR (LOWER(COALESCE(NEW.estado_ruta_optiroute, '')) LIKE '%entregad%')
                      OR (LOWER(COALESCE(NEW.estado_ruta_optiroute, '')) LIKE '%deliver%');
    v_was_delivered := CASE WHEN TG_OP = 'UPDATE' THEN
        (LOWER(TRIM(COALESCE(OLD.status, ''))) IN ('entregado', 'delivered'))
        OR (LOWER(TRIM(COALESCE(OLD.estado_wms, ''))) = 'entregado')
        OR (LOWER(COALESCE(OLD.lightdata_status, '')) LIKE '%entregad%')
        OR (LOWER(COALESCE(OLD.lightdata_status, '')) LIKE '%delivered%')
        OR (LOWER(COALESCE(OLD.estado_ruta_optiroute, '')) LIKE '%entregad%')
        OR (LOWER(COALESCE(OLD.estado_ruta_optiroute, '')) LIKE '%deliver%')
    ELSE false END;

    v_is_in_transit := (LOWER(TRIM(COALESCE(NEW.status, ''))) IN ('en tránsito', 'en transito', 'in_transit', 'en reparto'))
                       OR (LOWER(COALESCE(NEW.lightdata_status, '')) ~ '(camino|planta|recepcionado|clasificado|reparto|tránsito|transito|ruta)')
                       OR (LOWER(COALESCE(NEW.estado_ruta_optiroute, '')) ~ '(route|ruta|camino|onroute|ongoing|arrived)');
    v_was_in_transit := CASE WHEN TG_OP = 'UPDATE' THEN
        (LOWER(TRIM(COALESCE(OLD.status, ''))) IN ('en tránsito', 'en transito', 'in_transit', 'en reparto'))
        OR (LOWER(COALESCE(OLD.lightdata_status, '')) ~ '(camino|planta|recepcionado|clasificado|reparto|tránsito|transito|ruta)')
        OR (LOWER(COALESCE(OLD.estado_ruta_optiroute, '')) ~ '(route|ruta|camino|onroute|ongoing|arrived)')
    ELSE false END;

    v_is_dispatched := (LOWER(COALESCE(NEW.estado_wms, '')) = 'despachado') OR (LOWER(COALESCE(NEW.status, '')) IN ('despachado', 'retirado'));
    v_was_dispatched := CASE WHEN TG_OP = 'UPDATE' THEN
        (LOWER(COALESCE(OLD.estado_wms, '')) = 'despachado') OR (LOWER(COALESCE(OLD.status, '')) IN ('despachado', 'retirado'))
    ELSE false END;

    v_has_tracking := (NEW.tracking_number IS NOT NULL AND TRIM(NEW.tracking_number) != '');
    v_tracking_changed := CASE WHEN TG_OP = 'UPDATE' THEN
        (OLD.tracking_number IS DISTINCT FROM NEW.tracking_number)
        OR (OLD.tracking_url IS DISTINCT FROM NEW.tracking_url)
        OR (OLD.courier IS DISTINCT FROM NEW.courier)
    ELSE v_has_tracking END;

    v_is_preparing := (LOWER(TRIM(COALESCE(NEW.estado_wms, ''))) = 'en preparación');
    v_is_picked := (LOWER(TRIM(COALESCE(NEW.estado_wms, ''))) = 'pickeado') OR (LOWER(TRIM(COALESCE(NEW.status, ''))) = 'listo para retiro');
    v_was_picked := CASE WHEN TG_OP = 'UPDATE' THEN
        (LOWER(TRIM(COALESCE(OLD.estado_wms, ''))) = 'pickeado') OR (LOWER(TRIM(COALESCE(OLD.status, ''))) = 'listo para retiro')
    ELSE false END;

    -- =========================================================================
    -- CASO 0: Pedido con transporte ENTREGADO -> "Entregado" (set_delivered) en Shopify
    -- =========================================================================
    IF v_is_delivered AND NOT v_was_delivered AND NOT v_is_pickup THEN
        SELECT id INTO v_existing_queue_id
        FROM public.shopify_fulfillment_queue
        WHERE order_id = NEW.id
          AND action_type = 'set_delivered'
          AND status IN ('pending', 'processing', 'completed', 'needs_reauth')
        LIMIT 1;

        IF v_existing_queue_id IS NULL THEN
            INSERT INTO public.shopify_fulfillment_queue (
                order_id, merchant_id, comercio, shopify_order_id,
                tracking_number, tracking_url, courier, operador,
                shopify_fulfillment_id, action_type, status
            ) VALUES (
                NEW.id, v_integration.merchant_id, NEW.comercio, v_shopify_order_id,
                NEW.tracking_number, NEW.tracking_url, NEW.courier, NEW.operador,
                NEW.shopify_fulfillment_id, 'set_delivered', 'pending'
            );
        END IF;
        RETURN NEW;
    END IF;

    -- =========================================================================
    -- CASO 0.5: Pedido con transporte EN TRÁNSITO -> "En tránsito" (set_in_transit) en Shopify
    -- =========================================================================
    IF v_is_in_transit AND NOT v_was_in_transit AND NOT v_is_pickup AND NOT v_is_delivered THEN
        SELECT id INTO v_existing_queue_id
        FROM public.shopify_fulfillment_queue
        WHERE order_id = NEW.id
          AND action_type = 'set_in_transit'
          AND status IN ('pending', 'processing', 'completed', 'needs_reauth')
        LIMIT 1;

        IF v_existing_queue_id IS NULL THEN
            INSERT INTO public.shopify_fulfillment_queue (
                order_id, merchant_id, comercio, shopify_order_id,
                tracking_number, tracking_url, courier, operador,
                shopify_fulfillment_id, action_type, status
            ) VALUES (
                NEW.id, v_integration.merchant_id, NEW.comercio, v_shopify_order_id,
                NEW.tracking_number, NEW.tracking_url, NEW.courier, NEW.operador,
                NEW.shopify_fulfillment_id, 'set_in_transit', 'pending'
            );
        END IF;
        RETURN NEW;
    END IF;

    -- =========================================================================
    -- CASO A: Pedido Despachado (o actualización de tracking en pedido Pickeado/Despachado)
    -- =========================================================================
    IF (v_is_dispatched AND (NOT v_was_dispatched OR v_tracking_changed))
       OR (v_is_picked AND NOT v_is_pickup AND v_tracking_changed AND NEW.shopify_fulfillment_id IS NOT NULL) THEN
        IF NEW.shopify_fulfillment_id IS NOT NULL AND TRIM(NEW.shopify_fulfillment_id) != '' THEN
            v_action := 'update_tracking';
        ELSE
            v_action := 'create_fulfillment';
        END IF;

        SELECT id INTO v_existing_queue_id
        FROM public.shopify_fulfillment_queue
        WHERE order_id = NEW.id
          AND action_type = v_action
          AND status IN ('pending', 'needs_reauth')
        LIMIT 1;

        IF v_existing_queue_id IS NOT NULL THEN
            UPDATE public.shopify_fulfillment_queue
            SET
                tracking_number = NEW.tracking_number,
                tracking_url = NEW.tracking_url,
                courier = NEW.courier,
                operador = NEW.operador,
                shopify_fulfillment_id = NEW.shopify_fulfillment_id,
                status = 'pending',
                updated_at = NOW()
            WHERE id = v_existing_queue_id;
        ELSE
            INSERT INTO public.shopify_fulfillment_queue (
                order_id, merchant_id, comercio, shopify_order_id,
                tracking_number, tracking_url, courier, operador,
                shopify_fulfillment_id, action_type, status
            ) VALUES (
                NEW.id, v_integration.merchant_id, NEW.comercio, v_shopify_order_id,
                NEW.tracking_number, NEW.tracking_url, NEW.courier, NEW.operador,
                NEW.shopify_fulfillment_id, v_action, 'pending'
            );
        END IF;

        RETURN NEW;
    END IF;

    -- =========================================================================
    -- CASO B1: Pedido de DISTRIBUCIÓN completado en Picker ('Pickeado' -> "Preparado" / create_fulfillment en Shopify)
    -- =========================================================================
    IF v_is_picked
       AND (NOT v_is_pickup)
       AND (NOT v_was_picked)
       AND (NEW.shopify_fulfillment_id IS NULL OR TRIM(NEW.shopify_fulfillment_id) = '') THEN

        SELECT id INTO v_existing_queue_id
        FROM public.shopify_fulfillment_queue
        WHERE order_id = NEW.id
          AND action_type = 'create_fulfillment'
          AND status IN ('pending', 'processing', 'completed', 'needs_reauth')
        LIMIT 1;

        IF v_existing_queue_id IS NULL THEN
            INSERT INTO public.shopify_fulfillment_queue (
                order_id, merchant_id, comercio, shopify_order_id,
                tracking_number, tracking_url, courier, operador,
                action_type, status
            ) VALUES (
                NEW.id, v_integration.merchant_id, NEW.comercio, v_shopify_order_id,
                NEW.tracking_number, NEW.tracking_url, NEW.courier, NEW.operador,
                'create_fulfillment', 'pending'
            );
        END IF;

        RETURN NEW;
    END IF;

    -- =========================================================================
    -- CASO B2: Pedido de RETIRO completado en Picker ('Pickeado' -> "Listo para retirar" en Shopify)
    -- =========================================================================
    IF v_is_picked
       AND v_is_pickup
       AND (NOT v_was_picked)
       AND (NEW.shopify_fulfillment_id IS NULL) THEN

        SELECT id INTO v_existing_queue_id
        FROM public.shopify_fulfillment_queue
        WHERE order_id = NEW.id
          AND action_type = 'set_ready_for_pickup'
          AND status IN ('pending', 'processing', 'completed', 'needs_reauth')
        LIMIT 1;

        IF v_existing_queue_id IS NULL THEN
            INSERT INTO public.shopify_fulfillment_queue (
                order_id, merchant_id, comercio, shopify_order_id,
                action_type, status
            ) VALUES (
                NEW.id, v_integration.merchant_id, NEW.comercio, v_shopify_order_id,
                'set_ready_for_pickup', 'pending'
            );
        END IF;

        RETURN NEW;
    END IF;

    -- =========================================================================
    -- CASO C: Pedido en Preparación (Marcar "En curso" / set_in_progress en Shopify)
    -- =========================================================================
    IF v_is_preparing 
       AND (COALESCE(v_integration.sync_intermediate_statuses, true) = true)
       AND (NEW.shopify_fulfillment_id IS NULL)
       AND (TG_OP = 'INSERT' OR LOWER(COALESCE(OLD.estado_wms, '')) NOT IN ('en preparación', 'pickeado', 'despachado')) THEN

        SELECT id INTO v_existing_queue_id
        FROM public.shopify_fulfillment_queue
        WHERE order_id = NEW.id
          AND action_type = 'set_in_progress'
          AND status IN ('pending', 'processing', 'completed', 'needs_reauth')
        LIMIT 1;

        IF v_existing_queue_id IS NULL THEN
            INSERT INTO public.shopify_fulfillment_queue (
                order_id, merchant_id, comercio, shopify_order_id,
                action_type, status
            ) VALUES (
                NEW.id, v_integration.merchant_id, NEW.comercio, v_shopify_order_id,
                'set_in_progress', 'pending'
            );
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Regla de Oro: Si cualquier error ocurre en el trigger, jamás frenar el despacho de WMS
    RAISE WARNING 'Aviso en enqueue_shopify_fulfillment_trigger_func: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enlazar el trigger a la tabla orders
DROP TRIGGER IF EXISTS trg_enqueue_shopify_fulfillment ON public.orders;
CREATE TRIGGER trg_enqueue_shopify_fulfillment
AFTER INSERT OR UPDATE OF status, estado_wms, lightdata_status, estado_ruta_optiroute, tracking_number, tracking_url, courier
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_shopify_fulfillment_trigger_func();

-- 5B. Trigger No-Bloqueante en tablas de transporte (enviame_shipments, lightdata_envios, bluex_envios, starken_envios, optiroute_orders)
-- para detectar cuando un paquete pasa a EN TRÁNSITO o ENTREGADO y encolar automáticamente set_in_transit / set_delivered hacia Shopify
CREATE OR REPLACE FUNCTION public.enqueue_shopify_shipment_status_trigger_func()
RETURNS TRIGGER AS $$
DECLARE
    v_new_json JSONB;
    v_raw_status TEXT;
    v_old_status TEXT;
    v_target_action TEXT;
    v_tracking TEXT;
    v_order_uuid UUID;
    v_order RECORD;
    v_integration RECORD;
    v_shopify_order_id TEXT;
    v_existing_queue_id UUID;
BEGIN
    v_raw_status := LOWER(TRIM(COALESCE(NEW.status, '')));
    IF v_raw_status = '' THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        v_old_status := LOWER(TRIM(COALESCE(OLD.status, '')));
        IF v_old_status = v_raw_status THEN
            RETURN NEW;
        END IF;
    END IF;

    -- Clasificar estado de transporte en Entregado o En Tránsito
    IF v_raw_status ~ '(entregad|delivered)' AND v_raw_status !~ '(no entregad|fallid|rechazad)' THEN
        v_target_action := 'set_delivered';
    ELSIF v_raw_status ~ '(tránsito|transito|reparto|camino|ruta|planta|admitid|transit|delivery|onroute|ongoing|arrived|recepcionado|clasificado|redestin|disponible para retiro)'
      AND v_raw_status !~ '(cread|listo para despacho|impres|eliminad|cancelad|rechazado por courier|skipped|reviewing|scheduled|a retirar|no retirado)' THEN
        v_target_action := 'set_in_transit';
    ELSE
        RETURN NEW;
    END IF;

    v_new_json := to_jsonb(NEW);
    v_tracking := TRIM(COALESCE(v_new_json->>'tracking_number', v_new_json->>'tracking', ''));

    -- Buscar el pedido de Shopify correspondiente
    IF (v_new_json->>'order_id') IS NOT NULL AND (v_new_json->>'order_id') != '' THEN
        BEGIN
            v_order_uuid := (v_new_json->>'order_id')::UUID;
            SELECT id, comercio, external_platform, raw_shopify_data, tracking_number, tracking_url, courier, operador, shopify_fulfillment_id, shopify_order_status, categoria_entrega, agenda
            INTO v_order
            FROM public.orders
            WHERE id = v_order_uuid
            LIMIT 1;
        EXCEPTION WHEN OTHERS THEN
            v_order := NULL;
        END;
    END IF;

    IF v_order.id IS NULL AND v_tracking != '' AND UPPER(v_tracking) NOT IN ('N/A', 'NO INFORMADO', '-') THEN
        SELECT id, comercio, external_platform, raw_shopify_data, tracking_number, tracking_url, courier, operador, shopify_fulfillment_id, shopify_order_status, categoria_entrega, agenda
        INTO v_order
        FROM public.orders
        WHERE tracking_number = v_tracking
          AND UPPER(COALESCE(external_platform, '')) = 'SHOPIFY'
        ORDER BY created_at DESC
        LIMIT 1;
    END IF;

    IF v_order.id IS NULL OR UPPER(COALESCE(v_order.external_platform, '')) != 'SHOPIFY' THEN
        RETURN NEW;
    END IF;

    -- Omitir pedidos de retiro en tienda
    IF UPPER(TRIM(COALESCE(v_order.categoria_entrega, ''))) = 'RETIRO' OR UPPER(TRIM(COALESCE(v_order.agenda, ''))) = 'RETIRO' THEN
        RETURN NEW;
    END IF;

    -- Si ya está en delivered en Shopify, no retroceder a in_transit
    IF v_order.shopify_order_status = 'delivered' THEN
        RETURN NEW;
    END IF;
    IF v_target_action = 'set_in_transit' AND v_order.shopify_order_status = 'in_transit' THEN
        RETURN NEW;
    END IF;

    -- Verificar integración activa con bidirección habilitada
    SELECT id, merchant_id, sync_tracking_enabled
    INTO v_integration
    FROM public.merchant_integrations
    WHERE platform = 'Shopify'
      AND is_active = true
      AND UPPER(TRIM(comercio)) = UPPER(TRIM(v_order.comercio))
    LIMIT 1;

    IF v_integration.id IS NULL OR COALESCE(v_integration.sync_tracking_enabled, false) = false THEN
        RETURN NEW;
    END IF;

    v_shopify_order_id := v_order.raw_shopify_data->>'id';
    IF v_shopify_order_id IS NULL OR v_shopify_order_id = '' THEN
        RETURN NEW;
    END IF;

    SELECT id INTO v_existing_queue_id
    FROM public.shopify_fulfillment_queue
    WHERE order_id = v_order.id
      AND action_type = v_target_action
      AND status IN ('pending', 'processing', 'completed', 'needs_reauth')
    LIMIT 1;

    IF v_existing_queue_id IS NULL THEN
        INSERT INTO public.shopify_fulfillment_queue (
            order_id, merchant_id, comercio, shopify_order_id,
            tracking_number, tracking_url, courier, operador,
            shopify_fulfillment_id, action_type, status
        ) VALUES (
            v_order.id, v_integration.merchant_id, v_order.comercio, v_shopify_order_id,
            COALESCE(v_order.tracking_number, v_tracking),
            COALESCE(v_order.tracking_url, v_new_json->>'tracking_url'),
            COALESCE(v_order.courier, v_new_json->>'courier'),
            v_order.operador,
            v_order.shopify_fulfillment_id,
            v_target_action,
            'pending'
        );
    END IF;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Aviso en enqueue_shopify_shipment_status_trigger_func: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_shopify_shipment_status_enviame ON public.enviame_shipments;
CREATE TRIGGER trg_shopify_shipment_status_enviame
AFTER INSERT OR UPDATE OF status ON public.enviame_shipments
FOR EACH ROW EXECUTE FUNCTION public.enqueue_shopify_shipment_status_trigger_func();

DROP TRIGGER IF EXISTS trg_shopify_shipment_status_lightdata ON public.lightdata_envios;
CREATE TRIGGER trg_shopify_shipment_status_lightdata
AFTER INSERT OR UPDATE OF status ON public.lightdata_envios
FOR EACH ROW EXECUTE FUNCTION public.enqueue_shopify_shipment_status_trigger_func();

DROP TRIGGER IF EXISTS trg_shopify_shipment_status_bluex ON public.bluex_envios;
CREATE TRIGGER trg_shopify_shipment_status_bluex
AFTER INSERT OR UPDATE OF status ON public.bluex_envios
FOR EACH ROW EXECUTE FUNCTION public.enqueue_shopify_shipment_status_trigger_func();

DROP TRIGGER IF EXISTS trg_shopify_shipment_status_starken ON public.starken_envios;
CREATE TRIGGER trg_shopify_shipment_status_starken
AFTER INSERT OR UPDATE OF status ON public.starken_envios
FOR EACH ROW EXECUTE FUNCTION public.enqueue_shopify_shipment_status_trigger_func();

DROP TRIGGER IF EXISTS trg_shopify_shipment_status_optiroute ON public.optiroute_orders;
CREATE TRIGGER trg_shopify_shipment_status_optiroute
AFTER INSERT OR UPDATE OF status ON public.optiroute_orders
FOR EACH ROW EXECUTE FUNCTION public.enqueue_shopify_shipment_status_trigger_func();


-- 6. Backfill inicial de shopify_order_status para pedidos de Shopify existentes
UPDATE public.orders o
SET shopify_order_status = CASE
    WHEN (o.raw_shopify_data->>'cancelled_at') IS NOT NULL AND (o.raw_shopify_data->>'cancelled_at') != '' THEN 'cancelled'
    WHEN o.shopify_fulfillment_status = 'synced'
      OR (o.shopify_fulfillment_id IS NOT NULL AND TRIM(o.shopify_fulfillment_id) != '')
      OR LOWER(COALESCE(o.raw_shopify_data->>'fulfillment_status', '')) = 'fulfilled' THEN 'fulfilled'
    WHEN LOWER(COALESCE(o.raw_shopify_data->>'fulfillment_status', '')) = 'partial' THEN 'partial'
    WHEN EXISTS (
        SELECT 1 FROM public.shopify_fulfillment_queue q
        WHERE q.order_id = o.id AND q.action_type = 'set_ready_for_pickup' AND q.status = 'completed'
    ) OR COALESCE(o.raw_shopify_data->>'tags', '') ILIKE '%Stocka: Listo para Retiro%' THEN 'ready_for_pickup'
    WHEN EXISTS (
        SELECT 1 FROM public.shopify_fulfillment_queue q
        WHERE q.order_id = o.id AND q.action_type = 'set_in_progress' AND q.status = 'completed'
    ) OR COALESCE(o.raw_shopify_data->>'tags', '') ILIKE '%Stocka: En Preparación%' THEN 'in_progress'
    ELSE 'unfulfilled'
END
WHERE (UPPER(COALESCE(o.external_platform, '')) = 'SHOPIFY' OR o.raw_shopify_data IS NOT NULL)
  AND (o.shopify_order_status IS NULL OR o.shopify_order_status = 'unfulfilled');
