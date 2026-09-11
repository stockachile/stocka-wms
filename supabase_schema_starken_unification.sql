-- WMS STOCKA - Supabase Schema: Integración Starken Pro con Envios Unificados y AutoTrack
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Permitir 'starken_envios' como tabla de origen en envios_unificados
ALTER TABLE public.envios_unificados 
DROP CONSTRAINT IF EXISTS envios_unificados_source_table_check;

ALTER TABLE public.envios_unificados 
ADD CONSTRAINT envios_unificados_source_table_check 
CHECK (source_table IN ('lightdata_envios', 'enviame_shipments', 'optiroute_orders', 'bluex_envios', 'starken_envios'));

-- 2. Actualizar función get_global_status para clasificar estados de Starken Pro en DESPACHADO, SIN MOVIMIENTO y ALERTA
CREATE OR REPLACE FUNCTION public.get_global_status(source_table TEXT, status_str TEXT)
RETURNS TEXT AS $$
DECLARE
  s TEXT;
BEGIN
  IF status_str IS NULL THEN
    RETURN NULL;
  END IF;
  
  s := LOWER(TRIM(status_str));
  
  IF source_table = 'lightdata_envios' THEN
    IF s IN ('no retirado', 'a retirar') THEN
      RETURN 'SIN MOVIMIENTO';
    ELSIF s IN ('entregado', 'nadie') OR s LIKE '%camino%' THEN
      RETURN 'DESPACHADO';
    ELSIF s = 'cancelado' THEN
      RETURN 'ALERTA';
    END IF;
  ELSIF source_table = 'optiroute_orders' THEN
    IF s = 'reviewing' THEN
      RETURN 'SIN MOVIMIENTO';
    ELSIF s IN ('skipped', 'onroute', 'ongoing', 'delivered') THEN
      RETURN 'DESPACHADO';
    END IF;
  ELSIF source_table = 'enviame_shipments' THEN
    IF s IN ('creado', 'eliminado', 'rechazado por courier', 'listo para despacho - impreso', 'listo para despacho') THEN
      RETURN 'SIN MOVIMIENTO';
    ELSIF s IN ('devolucion', 'en reparto', 'en tránsito', 'entregado', 'no hay quien reciba', 'extraviado', 'expirado', 'entregado con exito') OR s LIKE '%planta%' THEN
      RETURN 'DESPACHADO';
    END IF;
  ELSIF source_table = 'bluex_envios' THEN
    IF s IN ('in_transit', 'out_for_delivery', 'delivered', 'entregado', 'en reparto', 'en ruta', 'en camino', 'en tránsito') 
       OR s LIKE '%transit%' OR s LIKE '%deliver%' OR s LIKE '%ruta%' OR s LIKE '%reparto%' THEN
      RETURN 'DESPACHADO';
    ELSIF s IN ('pickup', 'in_preparation', 'creado', 'emitido', 'ingresado', 'recepcionado', 'procesando') 
       OR s LIKE '%pickup%' OR s LIKE '%preparation%' THEN
      RETURN 'SIN MOVIMIENTO';
    ELSIF s IN ('cancelado', 'anulado', 'fallido', 'devuelto', 'siniestro', 'incidencia', 'failed') 
       OR s LIKE '%cancel%' OR s LIKE '%fail%' THEN
      RETURN 'ALERTA';
    END IF;
  ELSIF source_table = 'starken_envios' THEN
    -- Movimiento activo en Starken
    IF s IN ('transito', 'destino', 'reparto', 'entregados', 'entregado', 'redestino', 'redestinado', 'en transito', 'en destino', 'en reparto') 
       OR s LIKE '%transit%' OR s LIKE '%deliver%' OR s LIKE '%reparto%' OR s LIKE '%entregad%' OR s LIKE '%destino%' THEN
      RETURN 'DESPACHADO';
    -- En bodega inicial / origen
    ELSIF s IN ('origen', 'en origen', 'creado', 'emitido', 'ingresado', 'recepcionado', 'recepcion') 
       OR s LIKE '%origen%' THEN
      RETURN 'SIN MOVIMIENTO';
    -- Incidencias o cancelaciones
    ELSIF s IN ('excepciones', 'excepcion', 'cancelado', 'anulado', 'fallido', 'devuelto', 'siniestro', 'incidencia', 'failed') 
       OR s LIKE '%excepcion%' OR s LIKE '%cancel%' OR s LIKE '%fail%' THEN
      RETURN 'ALERTA';
    END IF;
  END IF;
  
  RETURN 'SIN MOVIMIENTO';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 3. Trigger y función para sincronizar automáticamente: starken_envios -> envios_unificados
CREATE OR REPLACE FUNCTION public.sync_starken_to_unified()
RETURNS TRIGGER AS $$
DECLARE
  v_global_status TEXT;
  v_id TEXT := 'starken_envios:' || NEW.id;
  v_ref TEXT := NEW.tracking;
BEGIN
  v_global_status := public.get_global_status('starken_envios', NEW.status);

  -- Buscar si existe una orden asociada para usar su número de pedido externo como referencia de cruce
  SELECT external_order_number INTO v_ref
  FROM public.orders
  WHERE tracking_number = NEW.tracking
  LIMIT 1;

  IF v_ref IS NULL THEN
    v_ref := COALESCE(NEW.numero_documento, NEW.tracking);
  END IF;

  INSERT INTO public.envios_unificados (
    id, source_table, source_id, empresa_comercio_proveedor, tracking, tracking_url, courier, status, global_status, created_at, updated_at, servicio_tipo_envio, nombre_destinatario, telefono_destino, direccion_destino, comuna_destino, pedido_referencia
  ) VALUES (
    v_id,
    'starken_envios',
    NEW.id,
    NEW.comercio,
    NEW.tracking,
    NEW.tracking_url,
    NEW.courier,
    NEW.status,
    v_global_status,
    COALESCE(NEW.fecha_emision_starken, NEW.created_at),
    NEW.updated_at,
    COALESCE(NEW.tipo_servicio, 'ESTÁNDAR'),
    NEW.nombre_destinatario,
    NEW.telefono_destino,
    NEW.direccion_destino,
    NEW.comuna_destino,
    v_ref
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
    direccion_destino = EXCLUDED.direccion_destino,
    comuna_destino = EXCLUDED.comuna_destino,
    pedido_referencia = EXCLUDED.pedido_referencia;

  -- Si el envío ya tiene movimiento en Starken y la orden está en preparación/preparado, avanzar a 'despachado'
  IF v_global_status = 'DESPACHADO' THEN
    UPDATE public.orders
    SET status = 'despachado'
    WHERE tracking_number = NEW.tracking
      AND status IN ('para procesar', 'en preparación', 'preparado');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_starken ON public.starken_envios;
CREATE TRIGGER trg_sync_starken
  AFTER INSERT OR UPDATE ON public.starken_envios
  FOR EACH ROW EXECUTE FUNCTION public.sync_starken_to_unified();

-- Trigger de borrado
CREATE OR REPLACE FUNCTION public.delete_starken_from_unified()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public.envios_unificados WHERE id = 'starken_envios:' || OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_delete_starken ON public.starken_envios;
CREATE TRIGGER trg_delete_starken
  AFTER DELETE ON public.starken_envios
  FOR EACH ROW EXECUTE FUNCTION public.delete_starken_from_unified();

-- 4. Poblar de inmediato todos los registros existentes de starken_envios hacia envios_unificados
INSERT INTO public.envios_unificados (
  id, source_table, source_id, empresa_comercio_proveedor, tracking, tracking_url, courier, status, global_status, created_at, updated_at, servicio_tipo_envio, nombre_destinatario, telefono_destino, direccion_destino, comuna_destino, pedido_referencia
)
SELECT DISTINCT ON (s.id)
  'starken_envios:' || s.id,
  'starken_envios',
  s.id,
  s.comercio,
  s.tracking,
  s.tracking_url,
  s.courier,
  s.status,
  public.get_global_status('starken_envios', s.status),
  COALESCE(s.fecha_emision_starken, s.created_at),
  s.updated_at,
  COALESCE(s.tipo_servicio, 'ESTÁNDAR'),
  s.nombre_destinatario,
  s.telefono_destino,
  s.direccion_destino,
  s.comuna_destino,
  COALESCE(o.external_order_number, s.numero_documento, s.tracking)
FROM public.starken_envios s
LEFT JOIN public.orders o ON o.tracking_number = s.tracking
ORDER BY s.id, o.created_at DESC NULLS LAST
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
  direccion_destino = EXCLUDED.direccion_destino,
  comuna_destino = EXCLUDED.comuna_destino,
  pedido_referencia = EXCLUDED.pedido_referencia;
