-- WMS STOCKA - SQL Migration to fix VULN-05 & VULN-06 (Secure RPC functions)
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Recrear recalculate_committed_stock con chequeo de rol y search_path seguro
CREATE OR REPLACE FUNCTION public.recalculate_committed_stock()
RETURNS VOID AS $$
BEGIN
  -- Seguridad: Verificar que el usuario que ejecuta es administrador
  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role = 'admin'
    ) THEN
      RAISE EXCEPTION 'Acceso denegado: Se requieren permisos de Administrador.';
    END IF;
  END IF;

  -- 1. Resetear todos los comprometidos a 0
  UPDATE public.inventory SET committed_quantity = 0;

  -- 2. Recalcular e inyectar basándose en ítems de pedidos activos calificados (excluyendo productos virtuales)
  UPDATE public.inventory inv
  SET committed_quantity = COALESCE(summary.total_committed, 0)
  FROM (
    SELECT 
      oi.product_id,
      oi.warehouse_id,
      SUM(oi.quantity)::INTEGER AS total_committed
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.products p ON p.id = oi.product_id
    WHERE o.status NOT IN ('despachado', 'cancelado', 'entregado', 'retirado')
      AND oi.warehouse_id IS NOT NULL
      AND public.should_process_order_stock(o.id)
      AND COALESCE(p.is_virtual, false) = false
    GROUP BY oi.product_id, oi.warehouse_id
  ) summary
  WHERE inv.product_id = summary.product_id
    AND inv.warehouse_id = summary.warehouse_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;


-- 2. Recrear check_overdue_payments con chequeo de rol y search_path seguro
CREATE OR REPLACE FUNCTION public.check_overdue_payments()
RETURNS void AS $$
DECLARE
    r_record RECORD;
    r_user RECORD;
    v_msg TEXT;
    v_title TEXT;
BEGIN
    -- Seguridad: Verificar que el usuario que ejecuta es administrador (o proceso interno)
    IF auth.uid() IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role = 'admin'
      ) THEN
        RAISE EXCEPTION 'Acceso denegado: Se requieren permisos de Administrador.';
      END IF;
    END IF;

    -- Vencimiento de Fulfillment
    UPDATE public.billing_records
    SET pago_fulfillment = 'Atrasado'
    WHERE fecha_limite < CURRENT_DATE
      AND pago_fulfillment NOT IN ('Recibido', 'abono', 'aprobado', 'Atrasado', 'Sin movimientos');

    -- Vencimiento de Envíame
    UPDATE public.billing_records
    SET pago_enviame = 'Atrasado'
    WHERE fecha_limite_enviame < CURRENT_DATE
      AND pago_enviame NOT IN ('Recibido', 'abono', 'aprobado', 'Atrasado', 'Sin movimientos');

    -- Generar notificaciones diarias para registros con pagos atrasados
    FOR r_record IN
        SELECT id, comercio, pago_fulfillment, pago_enviame
        FROM public.billing_records
        WHERE pago_fulfillment = 'Atrasado' OR pago_enviame = 'Atrasado'
    LOOP
        -- Construir el mensaje según el servicio atrasado
        IF r_record.pago_fulfillment = 'Atrasado' AND r_record.pago_enviame = 'Atrasado' THEN
            v_title := 'Servicios Fulfillment y Envíame Atrasados - ' || r_record.comercio;
            v_msg := 'Tus pagos de Fulfillment y Envíame se encuentran atrasados. Por favor regularizar a la brevedad para evitar la pausa de los servicios. Contáctanos a finanzas@stocka.cl.';
        ELSIF r_record.pago_fulfillment = 'Atrasado' THEN
            v_title := 'Servicio Fulfillment Atrasado - ' || r_record.comercio;
            v_msg := 'Tu pago de Fulfillment se encuentra atrasado. Por favor regularizar a la brevedad para evitar la pausa del servicio. Contáctanos a finanzas@stocka.cl.';
        ELSE
            v_title := 'Servicio Envíame Atrasado - ' || r_record.comercio;
            v_msg := 'Tu pago de Envíame se encuentra atrasado. Por favor regularizar a la brevedad para evitar la pausa del servicio. Contáctanos a finanzas@stocka.cl.';
        END IF;

        -- Buscar los usuarios asociados a este comercio
        FOR r_user IN
            SELECT id FROM public.profiles
            WHERE role = 'client'
              AND (
                comercio = 'all'
                OR r_record.comercio = ANY (ARRAY(SELECT trim(name) FROM unnest(string_to_array(comercio, ',')) AS name))
                OR EXISTS (
                    SELECT 1 FROM public.billing_mappings bg
                    WHERE bg.billing_name = r_record.comercio
                      AND bg.comercio_nombre = ANY (ARRAY(SELECT trim(name) FROM unnest(string_to_array(comercio, ',')) AS name))
                )
              )
        LOOP
            -- Insertar sólo si no se ha notificado hoy para este comercio y usuario
            IF NOT EXISTS (
                SELECT 1 FROM public.dashboard_notifications
                WHERE user_id = r_user.id
                  AND title = v_title
                  AND created_at::date = CURRENT_DATE
            ) THEN
                INSERT INTO public.dashboard_notifications (
                    user_id, target_role, title, message, is_read, created_at
                ) VALUES (
                    r_user.id, 'client', v_title, v_msg, false, timezone('utc'::text, now())
                );
            END IF;
        END LOOP;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;


-- 3. Recrear clean_old_receipts con chequeo de rol y search_path seguro
CREATE OR REPLACE FUNCTION public.clean_old_receipts()
RETURNS void AS $$
BEGIN
    -- Seguridad: Verificar que el usuario que ejecuta es administrador
    IF auth.uid() IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role = 'admin'
      ) THEN
        RAISE EXCEPTION 'Acceso denegado: Se requieren permisos de Administrador.';
      END IF;
    END IF;

    DELETE FROM storage.objects
    WHERE bucket_id = 'payment_receipts'
      AND created_at < (NOW() - INTERVAL '7 days');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
