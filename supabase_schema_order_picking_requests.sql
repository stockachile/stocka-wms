-- ========================================================================
-- WMS STOCKA - Esquema de Solicitudes Especiales de Picking (Picking Requests)
-- ========================================================================
-- Ejecutar este script en el Editor SQL de Supabase:
-- https://supabase.com/dashboard/project/ejtjfaucnxbikrwjwwdu/sql/new

-- 1. Agregar campos de trazabilidad rápida a la tabla orders
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS has_picking_request BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS picking_request_status TEXT DEFAULT NULL;

-- Índices en orders para optimizar búsquedas y filtros en Torre de Control y Portal
CREATE INDEX IF NOT EXISTS idx_orders_has_picking_request ON public.orders(has_picking_request) 
WHERE has_picking_request = TRUE;

CREATE INDEX IF NOT EXISTS idx_orders_picking_request_status ON public.orders(picking_request_status) 
WHERE picking_request_status IS NOT NULL;

-- 2. Crear tabla principal: order_picking_requests
CREATE TABLE IF NOT EXISTS public.order_picking_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
    external_order_number TEXT NOT NULL,
    comercio TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendiente' 
        CHECK (status IN ('pendiente', 'en_preparacion', 'completada', 'parcial', 'rechazada')),
    -- Listado estructurado de necesidades:
    -- [ { "id": "req_1", "text": "Incluir muestra gratis", "checked": false, "checked_at": null, "checked_by": null } ]
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    general_notes TEXT DEFAULT NULL,
    warning_acknowledged BOOLEAN DEFAULT FALSE, -- Flag de aceptación de advertencia en caso de estado Pickeado
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_by_email TEXT DEFAULT NULL,
    completed_by_operator TEXT DEFAULT NULL,
    completed_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Asegurar restricción UNIQUE en order_id por si la tabla ya existía sin ella
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'unique_order_picking_requests_order_id'
    ) THEN
        ALTER TABLE public.order_picking_requests 
        ADD CONSTRAINT unique_order_picking_requests_order_id UNIQUE (order_id);
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_picking_req_order_id ON public.order_picking_requests(order_id);
CREATE INDEX IF NOT EXISTS idx_picking_req_comercio ON public.order_picking_requests(comercio);
CREATE INDEX IF NOT EXISTS idx_picking_req_status ON public.order_picking_requests(status);
CREATE INDEX IF NOT EXISTS idx_picking_req_ext_num ON public.order_picking_requests(external_order_number);

-- 3. Habilitar Row Level Security (RLS)
ALTER TABLE public.order_picking_requests ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS
DROP POLICY IF EXISTS "Admins y Operarios acceso total a solicitudes de picking" ON public.order_picking_requests;
CREATE POLICY "Admins y Operarios acceso total a solicitudes de picking" ON public.order_picking_requests
    FOR ALL USING (
        (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'operario', 'picker', 'supervisor')
        OR auth.jwt() ->> 'role' = 'service_role'
    );

DROP POLICY IF EXISTS "Clientes consultan solicitudes de su comercio" ON public.order_picking_requests;
CREATE POLICY "Clientes consultan solicitudes de su comercio" ON public.order_picking_requests
    FOR SELECT USING (
        public.check_user_commerce(comercio)
        OR created_by = auth.uid()
        OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
    );

DROP POLICY IF EXISTS "Clientes crean solicitudes para su comercio" ON public.order_picking_requests;
CREATE POLICY "Clientes crean solicitudes para su comercio" ON public.order_picking_requests
    FOR INSERT WITH CHECK (
        public.check_user_commerce(comercio)
        OR created_by = auth.uid()
        OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
    );

DROP POLICY IF EXISTS "Clientes actualizan solicitudes pendientes de su comercio" ON public.order_picking_requests;
CREATE POLICY "Clientes actualizan solicitudes pendientes de su comercio" ON public.order_picking_requests
    FOR UPDATE USING (
        public.check_user_commerce(comercio)
        OR created_by = auth.uid()
        OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'operario', 'picker')
    );

-- 4. Función y Trigger para mantener sincronizado orders.has_picking_request y picking_request_status
CREATE OR REPLACE FUNCTION public.sync_order_picking_request_status()
RETURNS TRIGGER AS $$
DECLARE
    target_order_id UUID;
    req_status TEXT;
    all_completed BOOLEAN;
    any_completed BOOLEAN;
BEGIN
    IF TG_OP = 'DELETE' THEN
        target_order_id := OLD.order_id;
    ELSE
        target_order_id := NEW.order_id;
    END IF;

    -- Verificar si quedan solicitudes activas para la orden
    IF EXISTS (SELECT 1 FROM public.order_picking_requests WHERE order_id = target_order_id) THEN
        -- Obtener estado global más representativo
        SELECT 
            CASE 
                WHEN bool_and(status = 'completada') THEN 'completada'
                WHEN bool_or(status = 'en_preparacion' OR status = 'parcial') THEN 'en_preparacion'
                ELSE 'pendiente'
            END INTO req_status
        FROM public.order_picking_requests
        WHERE order_id = target_order_id;

        UPDATE public.orders 
        SET 
            has_picking_request = TRUE,
            picking_request_status = COALESCE(req_status, 'pendiente')
        WHERE id = target_order_id;
    ELSE
        UPDATE public.orders 
        SET 
            has_picking_request = FALSE,
            picking_request_status = NULL
        WHERE id = target_order_id;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_order_picking_request ON public.order_picking_requests;
CREATE TRIGGER trg_sync_order_picking_request
    AFTER INSERT OR UPDATE OR DELETE ON public.order_picking_requests
    FOR EACH ROW EXECUTE FUNCTION public.sync_order_picking_request_status();

-- 5. Comentarios explicativos
COMMENT ON TABLE public.order_picking_requests IS 'Solicitudes especiales e indicaciones de picking creadas por usuarios cliente para un pedido.';
COMMENT ON COLUMN public.order_picking_requests.items IS 'Listado JSONB de requerimientos con estado de verificación (check) por el picker.';
COMMENT ON COLUMN public.orders.has_picking_request IS 'Booleano que indica si el pedido cuenta con una solicitud especial de picking activa.';
COMMENT ON COLUMN public.orders.picking_request_status IS 'Estado de la solicitud de picking (pendiente, en_preparacion, completada, parcial).';
