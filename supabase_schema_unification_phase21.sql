-- WMS STOCKA - Supabase Schema Phase 21: Enhanced Merchant Resolution & Retroactive Clean-up
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Redefinir la función de resolución con lógica robusta y soporte para excepciones
CREATE OR REPLACE FUNCTION public.get_resolved_empresa(p_pedido_referencia TEXT, p_default_empresa TEXT)
RETURNS TEXT AS $$
DECLARE
  v_ref_clean TEXT;
  v_nombre TEXT;
  v_sigla TEXT;
BEGIN
  IF p_pedido_referencia IS NULL OR length(trim(p_pedido_referencia)) = 0 THEN
    -- Fallback a default si es válido, si no, 'no asignado'
    IF p_default_empresa IS NULL OR LOWER(trim(p_default_empresa)) IN ('stocka 1', 'stocka1', 'no asignado', 'no_asignado', 'ninguno asignado', '') THEN
      RETURN 'no asignado';
    END IF;
    RETURN p_default_empresa;
  END IF;

  -- Limpiar referencia: eliminar espacios, convertir a mayúsculas y quitar caracteres especiales iniciales como '#'
  v_ref_clean := UPPER(regexp_replace(trim(p_pedido_referencia), '^[^A-Z0-9]+', '', 'i'));

  -- Excepciones manuales para mapear formatos conocidos:
  -- A. Prefijos de BE NATIVE (BNA) como 'NTV', 'NTVA', o 'NAT'
  IF v_ref_clean LIKE 'NTV%' OR v_ref_clean LIKE 'NAT%' THEN
    SELECT nombre INTO v_nombre FROM public.v_comercios_config WHERE UPPER(sigla) = 'BNA' LIMIT 1;
    IF v_nombre IS NOT NULL THEN
      RETURN v_nombre;
    END IF;
  END IF;

  -- B. Prefijo de MMEDD (MME) como 'MMD'
  IF v_ref_clean LIKE 'MMD%' THEN
    SELECT nombre INTO v_nombre FROM public.v_comercios_config WHERE UPPER(sigla) = 'MME' LIMIT 1;
    IF v_nombre IS NOT NULL THEN
      RETURN v_nombre;
    END IF;
  END IF;

  -- C. Prefijo de B4LIFE (B4L) como 'B' seguido de dígitos
  IF v_ref_clean SIMILAR TO 'B[0-9]%' THEN
    SELECT nombre INTO v_nombre FROM public.v_comercios_config WHERE UPPER(sigla) = 'B4L' LIMIT 1;
    IF v_nombre IS NOT NULL THEN
      RETURN v_nombre;
    END IF;
  END IF;

  -- D. Prefijo de MARINA VITAL (MVI) como 'VIT'
  IF v_ref_clean LIKE 'VIT%' THEN
    SELECT nombre INTO v_nombre FROM public.v_comercios_config WHERE UPPER(sigla) = 'MVI' LIMIT 1;
    IF v_nombre IS NOT NULL THEN
      RETURN v_nombre;
    END IF;
  END IF;

  -- Resolución general usando los primeros 3 caracteres como sigla
  IF length(v_ref_clean) >= 3 THEN
    v_sigla := substring(v_ref_clean from 1 for 3);
    
    SELECT nombre INTO v_nombre
    FROM public.v_comercios_config
    WHERE UPPER(sigla) = v_sigla
    LIMIT 1;
    
    IF v_nombre IS NOT NULL THEN
      RETURN v_nombre;
    END IF;
  END IF;

  -- Si no se pudo resolver y el default es nulo o genérico, se retorna 'no asignado'
  IF p_default_empresa IS NULL OR LOWER(trim(p_default_empresa)) IN ('stocka 1', 'stocka1', 'no asignado', 'no_asignado', 'ninguno asignado', '') THEN
    RETURN 'no asignado';
  END IF;

  RETURN p_default_empresa;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- 2. Redefinir la función trigger para lightdata_envios -> envios_unificados
CREATE OR REPLACE FUNCTION public.sync_lightdata_to_unified()
RETURNS TRIGGER AS $$
DECLARE
  v_global_status TEXT;
  v_id TEXT := 'lightdata_envios:' || NEW.id;
  v_empresa_resuelta TEXT;
BEGIN
  v_global_status := public.get_global_status('lightdata_envios', NEW.status);
  
  -- Resolver el comercio correctamente usando la función unificada
  v_empresa_resuelta := public.get_resolved_empresa(NEW.tracking, NEW.empresa_comercio);

  INSERT INTO public.envios_unificados (
    id, source_table, source_id, empresa_comercio_proveedor, tracking, tracking_url, courier, status, global_status, created_at, updated_at, servicio_tipo_envio, nombre_destinatario, telefono_destino, email_cliente_destino, direccion_destino, complemento_destino, comuna_destino, pedido_referencia, raw_data
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- 3. Redefinir la función trigger para optiroute_orders -> envios_unificados
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

  -- Resolver el comercio correctamente usando la función unificada
  v_empresa_resuelta := public.get_resolved_empresa(v_pedido_ref, NEW.empresa_comercio_proveedor);

  INSERT INTO public.envios_unificados (
    id, source_table, source_id, empresa_comercio_proveedor, tracking, tracking_url, courier, status, global_status, created_at, updated_at, servicio_tipo_envio, nombre_destinatario, telefono_destino, email_cliente_destino, direccion_destino, complemento_destino, comuna_destino, pedido_referencia, raw_data
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- 4. Ejecutar actualizaciones retroactivas sobre los datos actuales
-- A. Actualizar envios_unificados
UPDATE public.envios_unificados
SET empresa_comercio_proveedor = public.get_resolved_empresa(pedido_referencia, empresa_comercio_proveedor)
WHERE empresa_comercio_proveedor IS NULL 
   OR LOWER(TRIM(empresa_comercio_proveedor)) IN ('stocka 1', 'stocka1', 'no asignado', 'no_asignado', 'ninguno asignado', '');

-- B. Actualizar la tabla origen de LightData
UPDATE public.lightdata_envios
SET comercio = public.get_resolved_empresa(tracking, empresa_comercio)
WHERE comercio IS NULL 
   OR LOWER(TRIM(comercio)) IN ('stocka 1', 'stocka1', 'no asignado', 'no_asignado', 'ninguno asignado', '');

-- C. Actualizar la tabla origen de Optiroute
UPDATE public.optiroute_orders
SET empresa_comercio_proveedor = public.get_resolved_empresa(referencia, empresa_comercio_proveedor)
WHERE empresa_comercio_proveedor IS NULL 
   OR LOWER(TRIM(empresa_comercio_proveedor)) IN ('stocka 1', 'stocka1', 'no asignado', 'no_asignado', 'ninguno asignado', '');
