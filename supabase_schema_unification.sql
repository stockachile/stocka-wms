-- WMS STOCKA - Supabase Schema: Consolidación y Unificación de Envíos y Alertas
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Crear la tabla unificada para consolidar los despachos
CREATE TABLE IF NOT EXISTS envios_unificados (
  id TEXT PRIMARY KEY,                                     -- Formato: 'source_table:source_id'
  source_table TEXT NOT NULL CHECK (source_table IN ('lightdata_envios', 'enviame_shipments', 'optiroute_orders')),
  source_id TEXT NOT NULL,
  empresa_comercio_proveedor TEXT,                         -- EMPRESA/COMERCIO/PROVEEDOR
  tracking TEXT,                                           -- TRACKING
  tracking_url TEXT,                                       -- TRACKING URL
  courier TEXT,                                            -- COURIER
  status TEXT,                                             -- STATUS (original)
  global_status TEXT CHECK (global_status IN ('DESPACHADO', 'SIN MOVIMIENTO', 'ALERTA')), -- Estado global homogenizado
  created_at TIMESTAMP WITH TIME ZONE,                     -- CREATED AT
  updated_at TIMESTAMP WITH TIME ZONE,                     -- UPDATED AT
  servicio_tipo_envio TEXT,                                -- SERVICIO O TIPO DE ENVIO
  nombre_destinatario TEXT,                                -- NOMBRE DEL DESTINATARIO
  telefono_destino TEXT,                                   -- TELEFONO DESTINO
  email_cliente_destino TEXT,                              -- EMAIL CLIENTE DESTINO
  direccion_destino TEXT,                                  -- DIRECCION DESTINO
  complemento_destino TEXT,                                -- COMPLEMENTO DESTINO
  comuna_destino TEXT,                                     -- COMUNA DESTINO
  pedido_referencia TEXT,                                  -- Clave común de cruce (ej: SIM3362, DOR55015900)
  
  UNIQUE (source_table, source_id)
);

-- Índices para optimizar búsquedas por tracking, referencia y estados
CREATE INDEX IF NOT EXISTS idx_envios_unificados_tracking ON envios_unificados(tracking);
CREATE INDEX IF NOT EXISTS idx_envios_unificados_ref ON envios_unificados(pedido_referencia);
CREATE INDEX IF NOT EXISTS idx_envios_unificados_global_status ON envios_unificados(global_status);

-- 2. Función helper para traducir estados crudos de cada proveedor al estado global
CREATE OR REPLACE FUNCTION get_global_status(source_table TEXT, status_str TEXT)
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
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 3. Trigger y función para sincronizar: lightdata_envios -> envios_unificados
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
    NEW.created_at,
    NEW.updated_at,
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

DROP TRIGGER IF EXISTS trg_sync_lightdata ON lightdata_envios;
CREATE TRIGGER trg_sync_lightdata
  AFTER INSERT OR UPDATE ON lightdata_envios
  FOR EACH ROW EXECUTE FUNCTION sync_lightdata_to_unified();

CREATE OR REPLACE FUNCTION delete_lightdata_from_unified()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM envios_unificados WHERE id = 'lightdata_envios:' || OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_delete_lightdata ON lightdata_envios;
CREATE TRIGGER trg_delete_lightdata
  AFTER DELETE ON lightdata_envios
  FOR EACH ROW EXECUTE FUNCTION delete_lightdata_from_unified();


-- 4. Trigger y función para sincronizar: enviame_shipments -> envios_unificados
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
    NEW.created_at,
    NEW.updated_at,
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

DROP TRIGGER IF EXISTS trg_sync_enviame ON enviame_shipments;
CREATE TRIGGER trg_sync_enviame
  AFTER INSERT OR UPDATE ON enviame_shipments
  FOR EACH ROW EXECUTE FUNCTION sync_enviame_to_unified();

CREATE OR REPLACE FUNCTION delete_enviame_from_unified()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM envios_unificados WHERE id = 'enviame_shipments:' || OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_delete_enviame ON enviame_shipments;
CREATE TRIGGER trg_delete_enviame
  AFTER DELETE ON enviame_shipments
  FOR EACH ROW EXECUTE FUNCTION delete_enviame_from_unified();


-- 5. Trigger y función para sincronizar: optiroute_orders -> envios_unificados
CREATE OR REPLACE FUNCTION sync_optiroute_to_unified()
RETURNS TRIGGER AS $$
DECLARE
  v_global_status TEXT;
  v_id TEXT := 'optiroute_orders:' || NEW.id;
  v_pedido_ref TEXT;
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
    NEW.created_at,
    NEW.updated_at,
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

DROP TRIGGER IF EXISTS trg_sync_optiroute ON optiroute_orders;
CREATE TRIGGER trg_sync_optiroute
  AFTER INSERT OR UPDATE ON optiroute_orders
  FOR EACH ROW EXECUTE FUNCTION sync_optiroute_to_unified();

CREATE OR REPLACE FUNCTION delete_optiroute_from_unified()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM envios_unificados WHERE id = 'optiroute_orders:' || OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_delete_optiroute ON optiroute_orders;
CREATE TRIGGER trg_delete_optiroute
  AFTER DELETE ON optiroute_orders
  FOR EACH ROW EXECUTE FUNCTION delete_optiroute_from_unified();


-- 6. Crear la Vista de Alertas y Anomalías de Administración
CREATE OR REPLACE VIEW envios_alertas_admin AS
WITH stats_por_pedido AS (
  SELECT
    pedido_referencia,
    count(*) FILTER (WHERE global_status = 'DESPACHADO') AS despachados_count,
    count(*) FILTER (WHERE global_status = 'SIN MOVIMIENTO') AS sin_movimiento_count,
    count(*) AS total_tablas_registrado,
    array_agg(source_table) AS tablas_origen,
    array_agg(status) AS estados_originales
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
    WHEN sin_movimiento_count >= 3 THEN 'SIN_MOVIMIENTO_3_TABLAS'
    ELSE 'OK'
  END AS tipo_alerta,
  CASE
    WHEN despachados_count > 1 THEN 'El pedido figura como DESPACHADO en más de 1 canal de logística (' || array_to_string(tablas_origen, ', ') || ').'
    WHEN sin_movimiento_count >= 3 THEN 'El pedido figura SIN MOVIMIENTO en los 3 canales de logística.'
    ELSE 'Sin anomalías'
  END AS descripcion_alerta
FROM stats_por_pedido
WHERE 
  despachados_count > 1 
  OR sin_movimiento_count >= 3;


-- 7. Políticas de Seguridad RLS para envios_unificados
ALTER TABLE envios_unificados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin gestiona todo en unificados" ON envios_unificados;
CREATE POLICY "Admin gestiona todo en unificados" ON envios_unificados
  FOR ALL USING (is_admin());

DROP POLICY IF EXISTS "Clientes ven sus propios envios unificados" ON envios_unificados;
CREATE POLICY "Clientes ven sus propios envios unificados" ON envios_unificados
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE (orders.external_order_number = envios_unificados.pedido_referencia OR orders.id::text = envios_unificados.pedido_referencia)
        AND orders.merchant_id = auth.uid()
    )
  );


-- 8. Migración retroactiva: Insertar registros existentes de las 3 tablas en la tabla unificada
-- A) Migrar lightdata_envios
INSERT INTO envios_unificados (
  id, source_table, source_id, empresa_comercio_proveedor, tracking, tracking_url, courier, status, global_status, created_at, updated_at, servicio_tipo_envio, nombre_destinatario, telefono_destino, email_cliente_destino, direccion_destino, complemento_destino, comuna_destino, pedido_referencia
)
SELECT
  'lightdata_envios:' || id,
  'lightdata_envios',
  id,
  empresa_comercio,
  tracking,
  tracking_url,
  courier,
  status,
  get_global_status('lightdata_envios', status),
  created_at,
  updated_at,
  servicio_tipo_envio,
  nombre_destinatario,
  telefono_destino,
  email_cliente_destino,
  direccion_destino,
  complemento_destino,
  comuna_destino,
  tracking
FROM lightdata_envios
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

-- B) Migrar enviame_shipments
INSERT INTO envios_unificados (
  id, source_table, source_id, empresa_comercio_proveedor, tracking, tracking_url, courier, status, global_status, created_at, updated_at, servicio_tipo_envio, nombre_destinatario, telefono_destino, email_cliente_destino, direccion_destino, complemento_destino, comuna_destino, pedido_referencia
)
SELECT
  'enviame_shipments:' || e.id,
  'enviame_shipments',
  e.id,
  e.seller_name,
  e.tracking_number,
  e.tracking_url,
  e.courier,
  e.status,
  get_global_status('enviame_shipments', e.status),
  e.created_at,
  e.updated_at,
  e.service_type,
  e.recipient_name,
  e.recipient_phone,
  e.recipient_email,
  e.recipient_address,
  e.address_complement,
  e.commune,
  COALESCE(
    (SELECT o.external_order_number FROM orders o WHERE o.id::text = e.order_id),
    e.order_id
  )
FROM enviame_shipments e
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

-- C) Migrar optiroute_orders
INSERT INTO envios_unificados (
  id, source_table, source_id, empresa_comercio_proveedor, tracking, tracking_url, courier, status, global_status, created_at, updated_at, servicio_tipo_envio, nombre_destinatario, telefono_destino, email_cliente_destino, direccion_destino, complemento_destino, comuna_destino, pedido_referencia
)
SELECT
  'optiroute_orders:' || opt.id,
  'optiroute_orders',
  opt.id,
  opt.empresa_comercio_proveedor,
  opt.tracking,
  opt.tracking_url,
  opt.courier,
  opt.status,
  get_global_status('optiroute_orders', opt.status),
  opt.created_at,
  opt.updated_at,
  opt.servicio_tipo_envio,
  opt.nombre_destinatario,
  opt.telefono_destino,
  opt.email_cliente_destino,
  opt.direccion_destino,
  opt.complemento_destino,
  opt.comuna_destino,
  COALESCE(
    opt.referencia,
    opt.raw_data->>'reference',
    (SELECT o.external_order_number FROM orders o WHERE o.id::text = opt.id),
    opt.id
  )
FROM optiroute_orders opt
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
