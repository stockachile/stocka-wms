-- WMS STOCKA: Persistencia Absoluta de Modificaciones Manuales en WMS vs Sincronizaciones Externas

-- 1. Agregar columnas dedicadas a public.orders si no existen
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS wms_items_edited BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS wms_shipping_edited BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS wms_custom_edited BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Índices para acelerar búsquedas y filtros en sincronizaciones
CREATE INDEX IF NOT EXISTS idx_orders_wms_items_edited ON public.orders(wms_items_edited);
CREATE INDEX IF NOT EXISTS idx_orders_wms_custom_edited ON public.orders(wms_custom_edited);

-- 3. Comentarios explicativos en las columnas
COMMENT ON COLUMN public.orders.wms_items_edited IS 'Indica si los ítems, cantidades, SKU o totales del pedido fueron modificados manualmente en el WMS. Prevalece sobre cualquier sincronización externa.';
COMMENT ON COLUMN public.orders.wms_shipping_edited IS 'Indica si los datos de despacho (destinatario, dirección, comuna, teléfono) fueron modificados manualmente en el WMS.';
COMMENT ON COLUMN public.orders.wms_custom_edited IS 'Indica si el pedido ha recibido cualquier tipo de edición manual en el WMS.';

-- 4. Backfill de pedidos que ya poseían modificaciones en su historial o en raw_shopify_data
UPDATE public.orders
SET 
  wms_items_edited = TRUE,
  wms_custom_edited = TRUE
WHERE 
  id IN (
    SELECT DISTINCT order_id 
    FROM public.order_audit_logs 
    WHERE action = 'Modificación de Ítems'
  )
  OR (raw_shopify_data->>'wms_items_edited')::boolean = true;

-- 5. Backfill de pedidos con modificaciones de despacho
UPDATE public.orders
SET 
  wms_shipping_edited = TRUE,
  wms_custom_edited = TRUE
WHERE 
  id IN (
    SELECT DISTINCT order_id 
    FROM public.order_audit_logs 
    WHERE action IN ('Modificación de Datos de Despacho', 'Modificación de Comuna/Ciudad')
  );
