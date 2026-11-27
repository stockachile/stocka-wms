-- Soporte de estado de pago 'PAGO AL RETIRAR' para pedidos WooCommerce COD (contra entrega / pago al retirar)
-- Regla: Los pedidos con payment_status = 'PAGO AL RETIRAR' siguen comprometiendo stock en estante normalmente.

CREATE OR REPLACE FUNCTION public.is_order_stock_eligible(p_order public.orders)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
AS $function$
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

  v_status := LOWER(TRIM(COALESCE(p_order.status, '')));
  v_wms := COALESCE(p_order.estado_wms, 'En procesamiento');

  IF v_status IN ('cancelado', 'devolución', 'devolucion') THEN
    RETURN FALSE;
  END IF;

  IF v_wms IN ('Cancelado', 'Archivado', 'Listo para retiro', 'Despachado', 'Entregado') THEN
    RETURN FALSE;
  END IF;

  IF p_order.raw_shopify_data IS NOT NULL THEN
    IF p_order.raw_shopify_data->>'cancelled_at' IS NOT NULL THEN
      RETURN FALSE;
    END IF;
    IF COALESCE((p_order.raw_shopify_data->>'confirmed')::boolean, true) = false THEN
      RETURN FALSE;
    END IF;
  END IF;

  v_pay_status := LOWER(TRIM(COALESCE(p_order.payment_status, '')));
  v_shop_fin := LOWER(TRIM(COALESCE(p_order.raw_shopify_data->>'financial_status', '')));
  v_platform := COALESCE(p_order.external_platform, p_order.origen, 'Manual');
  v_is_marketplace := v_platform IN ('Falabella', 'MercadoLibre', 'Mercado Libre', 'Paris', 'Ripley', 'Walmart');

  IF v_pay_status IN ('pending', 'pendiente', 'unpaid', 'no pagado', 'por_pagar', 'por pagar')
     OR v_shop_fin IN ('pending', 'pendiente', 'unpaid', 'no pagado', 'por_pagar', 'por pagar') THEN
    RETURN FALSE;
  END IF;

  IF v_pay_status IN ('refunded', 'reembolsado', 'partially_refunded', 'parcialmente_reembolsado', 'voided', 'anulado')
     OR v_shop_fin IN ('refunded', 'reembolsado', 'partially_refunded', 'parcialmente_reembolsado', 'voided', 'anulado') THEN
    RETURN FALSE;
  END IF;

  IF v_pay_status IN ('paid', 'pagado', 'completed', 'confirmed', 'approved', 'cobrado', 'pago al retirar', 'pago_al_retirar')
     OR v_shop_fin IN ('paid', 'pagado', 'completed', 'confirmed', 'approved', 'cobrado', 'pago al retirar', 'pago_al_retirar') THEN
    RETURN TRUE;
  END IF;

  IF v_is_marketplace THEN
    RETURN TRUE;
  END IF;

  IF v_platform IN ('Manual', 'Punto de Venta', 'Logística Inversa', 'Logistica Inversa') THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$function$;

-- Actualizar pedidos WooCommerce COD sin fecha de pago (date_paid IS NULL) que quedaron marcados como PAID
UPDATE public.orders
SET payment_status = 'PAGO AL RETIRAR'
WHERE external_platform = 'WooCommerce'
  AND LOWER(TRIM(COALESCE(raw_woocommerce_data->>'payment_method', ''))) = 'cod'
  AND NULLIF(TRIM(COALESCE(raw_woocommerce_data->>'date_paid', '')), '') IS NULL
  AND LOWER(TRIM(COALESCE(raw_woocommerce_data->>'status', ''))) NOT IN ('cancelled', 'failed', 'refunded', 'trash')
  AND UPPER(TRIM(COALESCE(payment_status, ''))) IS DISTINCT FROM 'PAGO AL RETIRAR';
