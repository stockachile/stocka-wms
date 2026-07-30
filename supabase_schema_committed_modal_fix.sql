-- Redefinición de la función get_committed_order_details para soportar consultas globales (todas las bodegas) cuando p_warehouse_id es nulo.

CREATE OR REPLACE FUNCTION public.get_committed_order_details(p_product_id UUID, p_warehouse_id UUID DEFAULT NULL)
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
    AND (p_warehouse_id IS NULL OR oi.warehouse_id = p_warehouse_id)
    AND o.status NOT IN ('despachado', 'cancelado', 'entregado', 'retirado')
    AND public.should_process_order_stock(o.id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
