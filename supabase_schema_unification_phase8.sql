-- WMS STOCKA - Supabase Schema Phase 8: Corregir permisos FDW en get_resolved_empresa
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

CREATE OR REPLACE FUNCTION public.get_resolved_empresa(p_pedido_referencia TEXT, p_default_empresa TEXT)
RETURNS TEXT AS $$
DECLARE
  v_nombre TEXT;
  v_sigla TEXT;
BEGIN
  IF p_pedido_referencia IS NOT NULL AND length(trim(p_pedido_referencia)) >= 3 THEN
    v_sigla := UPPER(substring(trim(p_pedido_referencia) from 1 for 3));
    
    -- Consultar a través de la vista pública v_comercios_config para evitar problemas de mapeo de usuario FDW
    SELECT nombre INTO v_nombre
    FROM public.v_comercios_config
    WHERE UPPER(sigla) = v_sigla
    LIMIT 1;
    
    IF v_nombre IS NOT NULL THEN
      RETURN v_nombre;
    END IF;
  END IF;
  
  RETURN p_default_empresa;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
