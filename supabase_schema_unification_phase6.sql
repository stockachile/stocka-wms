-- WMS STOCKA - Supabase Schema Phase 6: Ajuste de Fechas a Origen de Plataforma
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Redefinir función de sincronización para LightData
CREATE OR REPLACE FUNCTION sync_lightdata_to_unified()
RETURNS TRIGGER AS $$
DECLARE
  v_global_status TEXT;
  v_id TEXT := 'lightdata_envios:' || NEW.id;
BEGIN
  v_global_status := get_global_status('lightdata_envios', NEW.status);

  INSERT INTO envios_unificados (
    id, source_table, source_id, empresa_comercio_proveedor, tracking, tracking_url, courier, status, global_status, created_at, updated_at, servicio_tipo_envio, nombre_destinatario, telefono_destino, email_cliente_destino, direccion_destino, complemento_destino, comuna_destino, pedido_referencia
  ) VALUES (
    v_id,
    'lightdata_envios',
    NEW.id,
    NEW.empresa_comercio,
    NEW.tracking,
    NEW.tracking_url,
    NEW.courier,
    NEW.status,
    v_global_status,
    COALESCE(NEW.fecha_creacion_lightdata, NEW.created_at),
    COALESCE(NEW.fecha_actualizacion_lightdata, NEW.updated_at),
    NEW.servicio_tipo_envio,
    NEW.nombre_destinatario,
    NEW.telefono_destino,
    NEW.email_cliente_destino,
    NEW.direccion_destino,
    NEW.complemento_destino,
    NEW.comuna_destino,
    NEW.tracking
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
$$ LANGUAGE plpgsql;


-- 2. Redefinir función de sincronización para Enviame
CREATE OR REPLACE FUNCTION sync_enviame_to_unified()
RETURNS TRIGGER AS $$
DECLARE
  v_global_status TEXT;
  v_id TEXT := 'enviame_shipments:' || NEW.id;
  v_pedido_ref TEXT;
BEGIN
  v_global_status := get_global_status('enviame_shipments', NEW.status);

  -- Resolver la referencia del pedido
  IF NEW.order_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT external_order_number INTO v_pedido_ref FROM orders WHERE id = NEW.order_id::uuid;
    IF v_pedido_ref IS NULL THEN
      v_pedido_ref := NEW.order_id;
    END IF;
  ELSE
    v_pedido_ref := NEW.order_id;
  END IF;

  INSERT INTO envios_unificados (
    id, source_table, source_id, empresa_comercio_proveedor, tracking, tracking_url, courier, status, global_status, created_at, updated_at, servicio_tipo_envio, nombre_destinatario, telefono_destino, email_cliente_destino, direccion_destino, complemento_destino, comuna_destino, pedido_referencia
  ) VALUES (
    v_id,
    'enviame_shipments',
    NEW.id,
    NEW.seller_name,
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
$$ LANGUAGE plpgsql;


-- 3. Redefinir función de sincronización para Optiroute
CREATE OR REPLACE FUNCTION sync_optiroute_to_unified()
RETURNS TRIGGER AS $$
DECLARE
  v_global_status TEXT;
  v_id TEXT := 'optiroute_orders:' || NEW.id;
  v_pedido_ref TEXT;
  v_created_at TIMESTAMP WITH TIME ZONE;
  v_updated_at TIMESTAMP WITH TIME ZONE;
BEGIN
  v_global_status := get_global_status('optiroute_orders', NEW.status);

  -- Resolver la referencia del pedido
  v_pedido_ref := NEW.referencia;
  IF v_pedido_ref IS NULL THEN
    v_pedido_ref := NEW.raw_data->>'reference';
  END IF;
  
  IF v_pedido_ref IS NULL THEN
    IF NEW.id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT external_order_number INTO v_pedido_ref FROM orders WHERE id = NEW.id::uuid;
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

  INSERT INTO envios_unificados (
    id, source_table, source_id, empresa_comercio_proveedor, tracking, tracking_url, courier, status, global_status, created_at, updated_at, servicio_tipo_envio, nombre_destinatario, telefono_destino, email_cliente_destino, direccion_destino, complemento_destino, comuna_destino, pedido_referencia
  ) VALUES (
    v_id,
    'optiroute_orders',
    NEW.id,
    NEW.empresa_comercio_proveedor,
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
$$ LANGUAGE plpgsql;


-- 4. Migración retroactiva para corregir los registros ya consolidados en envios_unificados
-- A) Actualizar fechas de LightData
UPDATE envios_unificados u
SET 
  created_at = COALESCE(l.fecha_creacion_lightdata, l.created_at),
  updated_at = COALESCE(l.fecha_actualizacion_lightdata, l.updated_at)
FROM lightdata_envios l
WHERE u.id = 'lightdata_envios:' || l.id;

-- B) Actualizar fechas de Enviame
UPDATE envios_unificados u
SET 
  created_at = COALESCE(e.enviame_created_at, e.created_at),
  updated_at = COALESCE(e.enviame_updated_at, e.updated_at)
FROM enviame_shipments e
WHERE u.id = 'enviame_shipments:' || e.id;

-- C) Actualizar fechas de Optiroute
UPDATE envios_unificados u
SET 
  created_at = COALESCE((opt.raw_data->>'created_at')::timestamp with time zone, opt.created_at),
  updated_at = COALESCE((opt.raw_data->>'updated_at')::timestamp with time zone, opt.updated_at)
FROM optiroute_orders opt
WHERE u.id = 'optiroute_orders:' || opt.id;
