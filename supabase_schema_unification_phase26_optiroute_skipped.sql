-- WMS STOCKA - Supabase Schema Phase 26: Corrección de Mapeo de Estado SKIPPED para OptiRoute
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Actualizar función get_global_status para clasificar SKIPPED en SIN MOVIMIENTO
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
    IF s IN ('reviewing', 'scheduled', 'skipped') THEN
      RETURN 'SIN MOVIMIENTO';
    ELSIF s IN ('onroute', 'ongoing', 'arrived', 'delivered', 'en ruta') THEN
      RETURN 'DESPACHADO';
    ELSIF s IN ('cancelled', 'canceled', 'deleted') THEN
      RETURN 'ALERTA';
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

-- 2. Recalcular y actualizar envíos unificados históricos de OptiRoute con estado SKIPPED
UPDATE public.envios_unificados
SET global_status = 'SIN MOVIMIENTO'
WHERE source_table = 'optiroute_orders'
  AND LOWER(TRIM(status)) IN ('skipped', 'reviewing', 'scheduled');

-- 3. Notificar a PostgREST para recargar el schema cache
NOTIFY pgrst, 'reload schema';
