-- ========================================================================
-- Migración: Agregar columna estado_ruta_optiroute a la tabla orders
-- Propósito: Rastrear si un pedido en WMS ha sido asignado a una ruta en Optiroute:
--            - 'creado': parte de una ruta que se está creando / planificando
--            - 'confirmado': asignado a la ruta de un conductor
--            - 'descartado': no considerado en ninguna ruta de conductor
-- ========================================================================

-- 1. Agregar columna si no existe
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS estado_ruta_optiroute TEXT;

-- 2. Añadir comentario para documentación en el catálogo de PostgreSQL
COMMENT ON COLUMN public.orders.estado_ruta_optiroute IS 
'Estado de asignación en ruta Optiroute: creado, confirmado, descartado';

-- 3. Crear índice para optimizar filtros y búsquedas en la grilla de agendas
CREATE INDEX IF NOT EXISTS idx_orders_estado_ruta_optiroute 
ON public.orders (estado_ruta_optiroute);

-- 4. Backfill inicial inteligente desde la tabla optiroute_orders (si existen registros previos)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'optiroute_orders'
  ) THEN
    -- Actualizar descartados (pedidos omitidos o cancelados en la optimización)
    UPDATE public.orders o
    SET estado_ruta_optiroute = 'descartado'
    FROM public.optiroute_orders oo
    WHERE (o.external_order_number = oo.referencia OR o.id::text = oo.referencia)
      AND UPPER(TRIM(oo.status)) IN ('SKIPPED', 'CANCELLED', 'DELETED', 'RECHAZADO')
      AND (o.estado_ruta_optiroute IS NULL OR o.estado_ruta_optiroute = '');

    -- Actualizar confirmados (con conductor asignado o en viaje/entregado)
    UPDATE public.orders o
    SET estado_ruta_optiroute = 'confirmado'
    FROM public.optiroute_orders oo
    WHERE (o.external_order_number = oo.referencia OR o.id::text = oo.referencia)
      AND (
        UPPER(TRIM(oo.status)) IN ('ONROUTE', 'ONGOING', 'ARRIVED', 'DELIVERED', 'COMPLETED')
        OR (oo.raw_data->>'assigned_driver') IS NOT NULL
        OR (oo.raw_data->>'driver') IS NOT NULL
      )
      AND (o.estado_ruta_optiroute IS NULL OR o.estado_ruta_optiroute = '');

    -- Actualizar creados (en revisión o planificación)
    UPDATE public.orders o
    SET estado_ruta_optiroute = 'creado'
    FROM public.optiroute_orders oo
    WHERE (o.external_order_number = oo.referencia OR o.id::text = oo.referencia)
      AND UPPER(TRIM(oo.status)) IN ('REVIEWING', 'SCHEDULED', 'IMPORTED', 'CREATED', 'CREADO', 'PENDING')
      AND (o.estado_ruta_optiroute IS NULL OR o.estado_ruta_optiroute = '');
  END IF;
END $$;
