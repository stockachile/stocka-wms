-- WMS STOCKA - Supabase Schema: Actualización de get_global_status para LightData
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Actualizar la función helper para traducir correctamente los nuevos estados de LightData
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
    ELSIF s IN ('entregado', 'nadie') 
       OR s LIKE '%camino%' 
       OR s LIKE '%planta%' 
       OR s LIKE '%recepcionado%' 
       OR s LIKE '%procesamiento%' 
       OR s LIKE '%clasificado%' 
       OR s LIKE '%entregado%' THEN
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
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. Recalcular e insertar el global_status corregido para los envíos de LightData ya registrados
UPDATE public.envios_unificados
SET global_status = public.get_global_status(source_table, status)
WHERE source_table = 'lightdata_envios';
