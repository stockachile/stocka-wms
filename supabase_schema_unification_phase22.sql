-- WMS STOCKA - Supabase Schema Phase 22: Dynamic Enviame ID Configuration
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Agregar columna enviame_id a la tabla de configuración adicional
ALTER TABLE public.comercios_adicional_config 
ADD COLUMN IF NOT EXISTS enviame_id TEXT;

-- 2. Redefinir get_resolved_empresa para resolver por ID de Enviame
CREATE OR REPLACE FUNCTION public.get_resolved_empresa(p_pedido_referencia TEXT, p_default_empresa TEXT)
RETURNS TEXT AS $$
DECLARE
  v_ref_clean TEXT;
  v_nombre TEXT;
  v_sigla TEXT;
  v_enviame_id_clean TEXT;
BEGIN
  -- Intentar resolver primero por ID de Enviame si el default tiene formato de ID (ej: 'ID: 191053' o '191053')
  IF p_default_empresa IS NOT NULL AND length(trim(p_default_empresa)) > 0 THEN
    v_enviame_id_clean := trim(regexp_replace(UPPER(p_default_empresa), '^ID\s*:?\s*', '', 'i'));
    
    IF v_enviame_id_clean ~ '^[0-9]+$' THEN
      SELECT comercio INTO v_nombre
      FROM public.comercios_adicional_config
      WHERE trim(enviame_id) = v_enviame_id_clean
      LIMIT 1;
      
      IF v_nombre IS NOT NULL THEN
        RETURN v_nombre;
      END IF;
    END IF;
  END IF;

  -- Si no se resuelve por ID de Enviame, proceder con la referencia del pedido
  IF p_pedido_referencia IS NULL OR length(trim(p_pedido_referencia)) = 0 THEN
    IF p_default_empresa IS NULL OR LOWER(trim(p_default_empresa)) IN ('stocka 1', 'stocka1', 'no asignado', 'no_asignado', 'ninguno asignado', '') THEN
      RETURN 'no asignado';
    END IF;
    RETURN p_default_empresa;
  END IF;

  v_ref_clean := UPPER(regexp_replace(trim(p_pedido_referencia), '^[^A-Z0-9]+', '', 'i'));

  -- Excepciones manuales
  IF v_ref_clean LIKE 'NTV%' OR v_ref_clean LIKE 'NAT%' THEN
    SELECT nombre INTO v_nombre FROM public.v_comercios_config WHERE UPPER(sigla) = 'BNA' LIMIT 1;
    IF v_nombre IS NOT NULL THEN
      RETURN v_nombre;
    END IF;
  END IF;

  IF v_ref_clean LIKE 'MMD%' THEN
    SELECT nombre INTO v_nombre FROM public.v_comercios_config WHERE UPPER(sigla) = 'MME' LIMIT 1;
    IF v_nombre IS NOT NULL THEN
      RETURN v_nombre;
    END IF;
  END IF;

  IF v_ref_clean SIMILAR TO 'B[0-9]%' THEN
    SELECT nombre INTO v_nombre FROM public.v_comercios_config WHERE UPPER(sigla) = 'B4L' LIMIT 1;
    IF v_nombre IS NOT NULL THEN
      RETURN v_nombre;
    END IF;
  END IF;

  IF v_ref_clean LIKE 'VIT%' THEN
    SELECT nombre INTO v_nombre FROM public.v_comercios_config WHERE UPPER(sigla) = 'MVI' LIMIT 1;
    IF v_nombre IS NOT NULL THEN
      RETURN v_nombre;
    END IF;
  END IF;

  -- Resolución general por sigla
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

  IF p_default_empresa IS NULL OR LOWER(trim(p_default_empresa)) IN ('stocka 1', 'stocka1', 'no asignado', 'no_asignado', 'ninguno asignado', '') THEN
    RETURN 'no asignado';
  END IF;

  RETURN p_default_empresa;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
