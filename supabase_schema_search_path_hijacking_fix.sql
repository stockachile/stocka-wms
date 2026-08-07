-- WMS STOCKA - SQL Migration to fix VULN-06 (Neutralize Search Path Hijacking in all SECURITY DEFINER functions)
-- Ejecuta este script completo en el SQL Editor de tu proyecto de Supabase.

-- Este script utiliza un bloque anónimo PL/pgSQL para auditar dinámicamente la base de datos,
-- identificar todas las funciones 'SECURITY DEFINER' en el esquema 'public',
-- y asegurar sus rutas de búsqueda (search_path) previniendo inyecciones de esquemas temporales.

DO $$
DECLARE
    r RECORD;
    v_sql TEXT;
    v_counter INT := 0;
BEGIN
    FOR r IN 
        SELECT 
            p.proname, 
            pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosecdef = true 
          AND n.nspname = 'public'
    LOOP
        v_sql := 'ALTER FUNCTION public.' || quote_ident(r.proname) || '(' || r.args || ') SET search_path = public, pg_temp;';
        RAISE NOTICE 'Asegurando función: public.%(%)', r.proname, r.args;
        EXECUTE v_sql;
        v_counter := v_counter + 1;
    END LOOP;
    
    RAISE NOTICE 'MIGRACIÓN COMPLETADA: Se aseguraron % funciones con SECURITY DEFINER.', v_counter;
END;
$$;
