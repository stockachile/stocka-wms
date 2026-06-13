-- WMS STOCKA - Supabase Schema Phase 3: Actualización de Alertas de Sin Movimiento
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

CREATE OR REPLACE VIEW envios_alertas_admin AS
WITH stats_por_pedido AS (
  SELECT
    pedido_referencia,
    count(*) FILTER (WHERE global_status = 'DESPACHADO' AND is_resolved = FALSE) AS despachados_count,
    count(*) FILTER (WHERE global_status = 'SIN MOVIMIENTO' AND is_resolved = FALSE) AS sin_movimiento_count,
    count(*) FILTER (WHERE is_resolved = FALSE) AS total_tablas_registrado,
    array_agg(source_table) FILTER (WHERE is_resolved = FALSE) AS tablas_origen,
    array_agg(status) FILTER (WHERE is_resolved = FALSE) AS estados_originales
  FROM envios_unificados
  WHERE pedido_referencia IS NOT NULL AND pedido_referencia != ''
  GROUP BY pedido_referencia
)
SELECT
  pedido_referencia,
  despachados_count,
  sin_movimiento_count,
  total_tablas_registrado,
  tablas_origen,
  estados_originales,
  CASE
    WHEN despachados_count > 1 THEN 'MULTI_DESPACHADO'
    WHEN sin_movimiento_count = total_tablas_registrado AND total_tablas_registrado >= 1 THEN 'SIN_MOVIMIENTO'
    ELSE 'OK'
  END AS tipo_alerta,
  CASE
    WHEN despachados_count > 1 THEN 'El pedido figura como DESPACHADO en más de 1 canal de logística (' || array_to_string(tablas_origen, ', ') || ').'
    WHEN sin_movimiento_count = total_tablas_registrado AND total_tablas_registrado >= 1 THEN 'El pedido figura SIN MOVIMIENTO en todos sus canales registrados (' || array_to_string(tablas_origen, ', ') || ').'
    ELSE 'Sin anomalías'
  END AS descripcion_alerta
FROM stats_por_pedido
WHERE 
  despachados_count > 1 
  OR (sin_movimiento_count = total_tablas_registrado AND total_tablas_registrado >= 1);
