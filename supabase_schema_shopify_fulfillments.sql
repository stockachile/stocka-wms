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

-- 2. Ampliar tabla orders con campos de auditoría de Shopify
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS shopify_fulfillment_id TEXT,
ADD COLUMN IF NOT EXISTS shopify_fulfillment_status TEXT, -- 'pending', 'synced', 'error'
ADD COLUMN IF NOT EXISTS shopify_sync_last_error TEXT;

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
    action_type TEXT NOT NULL CHECK (action_type IN ('create_fulfillment', 'update_tracking', 'set_in_progress')),
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
    v_is_preparing BOOLEAN;
BEGIN
    -- 1. Filtrar solo pedidos de la plataforma Shopify
    IF NEW.external_platform IS NULL OR UPPER(NEW.external_platform) != 'SHOPIFY' THEN
        RETURN NEW;
    END IF;

    -- 2. Consultar si el comercio tiene integración activa y con sincronización habilitada
    SELECT 
        id, merchant_id, sync_tracking_enabled, sync_intermediate_statuses, granted_scopes
    INTO v_integration
    FROM public.merchant_integrations
    WHERE platform = 'Shopify'
      AND is_active = true
      AND comercio = NEW.comercio
    LIMIT 1;

    -- Si no existe integración activa, continuar sin hacer nada
    IF v_integration.id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Extraer el ID numérico de Shopify desde raw_shopify_data
    BEGIN
        v_shopify_order_id := NEW.raw_shopify_data->>'id';
    EXCEPTION WHEN OTHERS THEN
        v_shopify_order_id := NULL;
    END;

    IF v_shopify_order_id IS NULL OR v_shopify_order_id = '' THEN
        -- Si aún no está el ID numérico en raw_data, no podemos llamar a la API de Shopify
        RETURN NEW;
    END IF;

    -- Analizar condiciones de estado y tracking
    v_is_dispatched := (LOWER(COALESCE(NEW.estado_wms, '')) = 'despachado') OR (LOWER(COALESCE(NEW.status, '')) = 'despachado');
    v_has_tracking := (NEW.tracking_number IS NOT NULL AND TRIM(NEW.tracking_number) != '');
    v_is_preparing := (LOWER(COALESCE(NEW.estado_wms, '')) IN ('en preparación', 'pickeado'));

    -- =========================================================================
    -- CASO A: Pedido Despachado o con Tracking Asignado (Prioridad Alta)
    -- =========================================================================
    IF (v_is_dispatched OR v_has_tracking) AND (v_integration.sync_tracking_enabled = true) THEN
        IF NEW.shopify_fulfillment_id IS NOT NULL AND TRIM(NEW.shopify_fulfillment_id) != '' THEN
            v_action := 'update_tracking';
        ELSE
            v_action := 'create_fulfillment';
        END IF;

        -- Verificar si ya hay una solicitud idéntica en estado 'pending' para este pedido
        SELECT id INTO v_existing_queue_id
        FROM public.shopify_fulfillment_queue
        WHERE order_id = NEW.id
          AND action_type = v_action
          AND status = 'pending'
        LIMIT 1;

        IF v_existing_queue_id IS NOT NULL THEN
            -- Actualizar los datos del registro pendiente existente
            UPDATE public.shopify_fulfillment_queue
            SET
                tracking_number = NEW.tracking_number,
                tracking_url = NEW.tracking_url,
                courier = NEW.courier,
                operador = NEW.operador,
                updated_at = NOW()
            WHERE id = v_existing_queue_id;
        ELSE
            -- Insertar nuevo registro en la cola
            INSERT INTO public.shopify_fulfillment_queue (
                order_id,
                merchant_id,
                comercio,
                shopify_order_id,
                tracking_number,
                tracking_url,
                courier,
                operador,
                action_type,
                status
            ) VALUES (
                NEW.id,
                v_integration.merchant_id,
                NEW.comercio,
                v_shopify_order_id,
                NEW.tracking_number,
                NEW.tracking_url,
                NEW.courier,
                NEW.operador,
                v_action,
                'pending'
            );
        END IF;

        RETURN NEW;
    END IF;

    -- =========================================================================
    -- CASO B: Pedido en Preparación / Pickeado (Marcar "En curso")
    -- =========================================================================
    IF v_is_preparing 
       AND (v_integration.sync_intermediate_statuses = true)
       AND (NEW.shopify_fulfillment_id IS NULL)
       AND (OLD.estado_wms IS NULL OR LOWER(OLD.estado_wms) NOT IN ('en preparación', 'pickeado')) THEN

        -- Verificar que no haya ya una solicitud de este tipo completada o pendiente
        SELECT id INTO v_existing_queue_id
        FROM public.shopify_fulfillment_queue
        WHERE order_id = NEW.id
          AND action_type = 'set_in_progress'
          AND status IN ('pending', 'completed')
        LIMIT 1;

        IF v_existing_queue_id IS NULL THEN
            INSERT INTO public.shopify_fulfillment_queue (
                order_id,
                merchant_id,
                comercio,
                shopify_order_id,
                action_type,
                status
            ) VALUES (
                NEW.id,
                v_integration.merchant_id,
                NEW.comercio,
                v_shopify_order_id,
                'set_in_progress',
                'pending'
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
AFTER INSERT OR UPDATE OF status, estado_wms, tracking_number, tracking_url, courier
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_shopify_fulfillment_trigger_func();
