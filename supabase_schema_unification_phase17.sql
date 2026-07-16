-- WMS STOCKA - Supabase Schema Phase 17: Corrección de resolución de comercios para LightData
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Redefinir la función trigger con lógica robusta y orden de resolución de comercio
CREATE OR REPLACE FUNCTION sync_lightdata_to_unified()
RETURNS TRIGGER AS $$
DECLARE
  v_global_status TEXT;
  v_id TEXT := 'lightdata_envios:' || NEW.id;
  v_empresa_resuelta TEXT;
BEGIN
  v_global_status := get_global_status('lightdata_envios', NEW.status);
  
  -- Resolver comercio priorizando el campo 'comercio' (resuelto en JS)
  -- y cayendo en get_resolved_empresa (SQL) con prefijo de esquema public para evitar problemas de path
  v_empresa_resuelta := COALESCE(
    NULLIF(TRIM(NEW.comercio), ''),
    public.get_resolved_empresa(NEW.tracking, NEW.empresa_comercio)
  );

  INSERT INTO envios_unificados (
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
$$ LANGUAGE plpgsql;

-- 2. Actualizar retroactivamente los registros existentes en envios_unificados
UPDATE envios_unificados
SET empresa_comercio_proveedor = public.get_resolved_empresa(tracking, empresa_comercio_proveedor)
WHERE source_table = 'lightdata_envios' AND empresa_comercio_proveedor = 'Stocka 1';

-- 3. Actualizar retroactivamente los registros existentes en la tabla dedicada lightdata_envios
UPDATE lightdata_envios
SET comercio = public.get_resolved_empresa(tracking, empresa_comercio)
WHERE empresa_comercio = 'Stocka 1';
