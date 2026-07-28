-- WMS STOCKA - Supabase Schema: Agregar raw_data a envios_unificados y sincronizar en triggers
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Agregar columna raw_data a la tabla envios_unificados si no existe
ALTER TABLE public.envios_unificados 
ADD COLUMN IF NOT EXISTS raw_data JSONB;

-- 2. Actualizar función y trigger de sincronización para lightdata_envios -> envios_unificados
CREATE OR REPLACE FUNCTION public.sync_lightdata_to_unified()
RETURNS TRIGGER AS $$
DECLARE
  v_global_status TEXT;
  v_id TEXT := 'lightdata_envios:' || NEW.id;
BEGIN
  v_global_status := public.get_global_status('lightdata_envios', NEW.status);

  INSERT INTO public.envios_unificados (
    id, source_table, source_id, empresa_comercio_proveedor, tracking, tracking_url, courier, status, global_status, created_at, updated_at, servicio_tipo_envio, nombre_destinatario, telefono_destino, email_cliente_destino, direccion_destino, complemento_destino, comuna_destino, pedido_referencia, raw_data
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
    NEW.created_at,
    NEW.updated_at,
    NEW.servicio_tipo_envio,
    NEW.nombre_destinatario,
    NEW.telefono_destino,
    NEW.email_cliente_destino,
    NEW.direccion_destino,
    NEW.complemento_destino,
    NEW.comuna_destino,
    NEW.tracking,
    NEW.raw_data
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
    pedido_referencia = EXCLUDED.pedido_referencia,
    raw_data = EXCLUDED.raw_data;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Actualizar función y trigger de sincronización para optiroute_orders -> envios_unificados
CREATE OR REPLACE FUNCTION public.sync_optiroute_to_unified()
RETURNS TRIGGER AS $$
DECLARE
  v_global_status TEXT;
  v_id TEXT := 'optiroute_orders:' || NEW.id;
  v_pedido_ref TEXT;
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

  INSERT INTO public.envios_unificados (
    id, source_table, source_id, empresa_comercio_proveedor, tracking, tracking_url, courier, status, global_status, created_at, updated_at, servicio_tipo_envio, nombre_destinatario, telefono_destino, email_cliente_destino, direccion_destino, complemento_destino, comuna_destino, pedido_referencia, raw_data
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
    NEW.created_at,
    NEW.updated_at,
    NEW.servicio_tipo_envio,
    NEW.nombre_destinatario,
    NEW.telefono_destino,
    NEW.email_cliente_destino,
    NEW.direccion_destino,
    NEW.complemento_destino,
    NEW.comuna_destino,
    v_pedido_ref,
    NEW.raw_data
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
    pedido_referencia = EXCLUDED.pedido_referencia,
    raw_data = EXCLUDED.raw_data;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Migrar/Retroalimentar los datos existentes
UPDATE public.envios_unificados u
SET raw_data = l.raw_data
FROM public.lightdata_envios l
WHERE u.source_table = 'lightdata_envios' AND u.source_id = l.id;

UPDATE public.envios_unificados u
SET raw_data = o.raw_data
FROM public.optiroute_orders o
WHERE u.source_table = 'optiroute_orders' AND u.source_id = o.id;
