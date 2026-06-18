-- WMS STOCKA - Supabase Schema Phase 12: Corregir permisos FDW en trigger de LightData con SECURITY DEFINER
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase para solucionar el problema
-- de replicación de datos desde lightdata_envios hacia envios_unificados.

-- 1. Redefinir la función de sincronización para LightData con SECURITY DEFINER y search_path seguro
CREATE OR REPLACE FUNCTION public.sync_lightdata_to_unified()
RETURNS TRIGGER AS $$
DECLARE
  v_global_status TEXT;
  v_id TEXT := 'lightdata_envios:' || NEW.id;
  v_empresa_resuelta TEXT;
BEGIN
  v_global_status := public.get_global_status('lightdata_envios', NEW.status);
  v_empresa_resuelta := public.get_resolved_empresa(NEW.tracking, NEW.empresa_comercio);

  INSERT INTO public.envios_unificados (
    id, source_table, source_id, empresa_comercio_proveedor, tracking, tracking_url, courier, status, global_status, created_at, updated_at, servicio_tipo_envio, nombre_destinatario, telefono_destino, email_cliente_destino, direccion_destino, complemento_destino, comuna_destino, pedido_referencia
  ) VALUES (
    v_id,
    'lightdata_envios',
    NEW.id,
    v_empresa_resuelta,
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- 2. Redefinir la función de eliminación para LightData con SECURITY DEFINER y search_path seguro
CREATE OR REPLACE FUNCTION public.delete_lightdata_from_unified()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public.envios_unificados WHERE id = 'lightdata_envios:' || OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- 3. Asegurar que los triggers estén vinculados correctamente
DROP TRIGGER IF EXISTS trg_sync_lightdata ON public.lightdata_envios;
CREATE TRIGGER trg_sync_lightdata
  AFTER INSERT OR UPDATE ON public.lightdata_envios
  FOR EACH ROW EXECUTE FUNCTION public.sync_lightdata_to_unified();

DROP TRIGGER IF EXISTS trg_delete_lightdata ON public.lightdata_envios;
CREATE TRIGGER trg_delete_lightdata
  AFTER DELETE ON public.lightdata_envios
  FOR EACH ROW EXECUTE FUNCTION public.delete_lightdata_from_unified();


-- 4. Migración manual de registros faltantes/desactualizados por si hubo bloqueos previos
INSERT INTO public.envios_unificados (
  id, source_table, source_id, empresa_comercio_proveedor, tracking, tracking_url, courier, status, global_status, created_at, updated_at, servicio_tipo_envio, nombre_destinatario, telefono_destino, email_cliente_destino, direccion_destino, complemento_destino, comuna_destino, pedido_referencia
)
SELECT
  'lightdata_envios:' || l.id,
  'lightdata_envios',
  l.id,
  public.get_resolved_empresa(l.tracking, l.empresa_comercio),
  l.tracking,
  l.tracking_url,
  l.courier,
  l.status,
  public.get_global_status('lightdata_envios', l.status),
  COALESCE(l.fecha_creacion_lightdata, l.created_at),
  COALESCE(l.fecha_actualizacion_lightdata, l.updated_at),
  l.servicio_tipo_envio,
  l.nombre_destinatario,
  l.telefono_destino,
  l.email_cliente_destino,
  l.direccion_destino,
  l.complemento_destino,
  l.comuna_destino,
  l.tracking
FROM public.lightdata_envios l
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
