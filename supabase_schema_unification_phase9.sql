-- WMS STOCKA - Supabase Schema Phase 9: Corregir permisos FDW en triggers con SECURITY DEFINER
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase para solucionar el error:
-- "user mapping not found for user 'service_role', server 'servidor_picker_stocka'"

-- 1. Redefinir función de sincronización para Enviame con SECURITY DEFINER y search_path seguro
CREATE OR REPLACE FUNCTION public.sync_enviame_to_unified()
RETURNS TRIGGER AS $$
DECLARE
  v_global_status TEXT;
  v_id TEXT := 'enviame_shipments:' || NEW.id;
  v_pedido_ref TEXT;
  v_empresa_resuelta TEXT;
BEGIN
  v_global_status := public.get_global_status('enviame_shipments', NEW.status);

  -- Resolver la referencia del pedido
  IF NEW.order_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT external_order_number INTO v_pedido_ref FROM public.orders WHERE id = NEW.order_id::uuid;
    IF v_pedido_ref IS NULL THEN
      v_pedido_ref := NEW.order_id;
    END IF;
  ELSE
    v_pedido_ref := NEW.order_id;
  END IF;

  v_empresa_resuelta := public.get_resolved_empresa(v_pedido_ref, NEW.seller_name);

  INSERT INTO public.envios_unificados (
    id, source_table, source_id, empresa_comercio_proveedor, tracking, tracking_url, courier, status, global_status, created_at, updated_at, servicio_tipo_envio, nombre_destinatario, telefono_destino, email_cliente_destino, direccion_destino, complemento_destino, comuna_destino, pedido_referencia
  ) VALUES (
    v_id,
    'enviame_shipments',
    NEW.id,
    v_empresa_resuelta,
    NEW.tracking_number,
    NEW.tracking_url,
    NEW.courier,
    NEW.status,
    v_global_status,
    COALESCE(NEW.enviame_created_at, NEW.created_at),
    COALESCE(NEW.enviame_updated_at, NEW.updated_at),
    NEW.service_type,
    NEW.recipient_name,
    NEW.recipient_phone,
    NEW.recipient_email,
    NEW.recipient_address,
    NEW.address_complement,
    NEW.commune,
    v_pedido_ref
  )
  ON CONFLICT (id) DO UPDATE SET
    empresa_comercio_proveedor = EXCLUDED.empresa_comercio_proveedor,
    tracking = EXCLUDED.tracking,
    tracking_url = EXCLUDED.tracking_url,
    courier = EXCLUDED.courier,
    status = EXCLUDED.status,
    global_status = EXCLUDED.global_status,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at,
    servicio_tipo_envio = EXCLUDED.servicio_tipo_envio,
    nombre_destinatario = EXCLUDED.nombre_destinatario,
    telefono_destino = EXCLUDED.telefono_destino,
    email_cliente_destino = EXCLUDED.email_cliente_destino,
    direccion_destino = EXCLUDED.direccion_destino,
    complemento_destino = EXCLUDED.complemento_destino,
    comuna_destino = EXCLUDED.comuna_destino,
    pedido_referencia = EXCLUDED.pedido_referencia;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- 2. Redefinir función de sincronización para Optiroute con SECURITY DEFINER y search_path seguro
CREATE OR REPLACE FUNCTION public.sync_optiroute_to_unified()
RETURNS TRIGGER AS $$
DECLARE
  v_global_status TEXT;
  v_id TEXT := 'optiroute_orders:' || NEW.id;
  v_pedido_ref TEXT;
  v_created_at TIMESTAMP WITH TIME ZONE;
  v_updated_at TIMESTAMP WITH TIME ZONE;
  v_empresa_resuelta TEXT;
BEGIN
  v_global_status := public.get_global_status('optiroute_orders', NEW.status);

  -- Resolver la referencia del pedido
  v_pedido_ref := NEW.referencia;
  IF v_pedido_ref IS NULL THEN
    v_pedido_ref := NEW.raw_data->>'reference';
  END IF;
  
  IF v_pedido_ref IS NULL THEN
    IF NEW.id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT external_order_number INTO v_pedido_ref FROM public.orders WHERE id = NEW.id::uuid;
    END IF;
    IF v_pedido_ref IS NULL THEN
      v_pedido_ref := NEW.id;
    END IF;
  END IF;

  -- Resolver fechas de plataforma desde raw_data
  IF NEW.raw_data->>'created_at' IS NOT NULL THEN
    v_created_at := (NEW.raw_data->>'created_at')::timestamp with time zone;
  ELSE
    v_created_at := NEW.created_at;
  END IF;

  IF NEW.raw_data->>'updated_at' IS NOT NULL THEN
    v_updated_at := (NEW.raw_data->>'updated_at')::timestamp with time zone;
  ELSE
    v_updated_at := NEW.updated_at;
  END IF;

  v_empresa_resuelta := public.get_resolved_empresa(v_pedido_ref, NEW.empresa_comercio_proveedor);

  INSERT INTO public.envios_unificados (
    id, source_table, source_id, empresa_comercio_proveedor, tracking, tracking_url, courier, status, global_status, created_at, updated_at, servicio_tipo_envio, nombre_destinatario, telefono_destino, email_cliente_destino, direccion_destino, complemento_destino, comuna_destino, pedido_referencia
  ) VALUES (
    v_id,
    'optiroute_orders',
    NEW.id,
    v_empresa_resuelta,
    NEW.tracking,
    NEW.tracking_url,
    NEW.courier,
    NEW.status,
    v_global_status,
    v_created_at,
    v_updated_at,
    NEW.servicio_tipo_envio,
    NEW.nombre_destinatario,
    NEW.telefono_destino,
    NEW.email_cliente_destino,
    NEW.direccion_destino,
    NEW.complemento_destino,
    NEW.comuna_destino,
    v_pedido_ref
  )
  ON CONFLICT (id) DO UPDATE SET
    empresa_comercio_proveedor = EXCLUDED.empresa_comercio_proveedor,
    tracking = EXCLUDED.tracking,
    tracking_url = EXCLUDED.tracking_url,
    courier = EXCLUDED.courier,
    status = EXCLUDED.status,
    global_status = EXCLUDED.global_status,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at,
    servicio_tipo_envio = EXCLUDED.servicio_tipo_envio,
    nombre_destinatario = EXCLUDED.nombre_destinatario,
    telefono_destino = EXCLUDED.telefono_destino,
    email_cliente_destino = EXCLUDED.email_cliente_destino,
    direccion_destino = EXCLUDED.direccion_destino,
    complemento_destino = EXCLUDED.complemento_destino,
    comuna_destino = EXCLUDED.comuna_destino,
    pedido_referencia = EXCLUDED.pedido_referencia;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
