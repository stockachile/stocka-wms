-- WMS STOCKA - Registro de Volumen Diario de Comercios
-- Ejecutar en el SQL Editor de Supabase

-- 1. Crear la Tabla de Registro de Volumen Diario
CREATE TABLE IF NOT EXISTS public.comercios_volumen_diario (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comercio TEXT NOT NULL,                                -- Nombre del comercio
    comercio_id UUID,                                      -- ID del comercio (de v_comercios_config)
    fecha DATE NOT NULL,                                   -- Fecha del registro
    volumen NUMERIC(12, 6) NOT NULL DEFAULT 0,            -- Volumen total registrado en m³
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    UNIQUE(comercio, fecha)                                -- Un registro por comercio por día
);

-- 2. Crear la Vista Segura para Obtener el Volumen Actual en Tiempo Real
-- Habilitamos security_invoker = true para heredar las políticas RLS del invocador sobre products e inventory
CREATE OR REPLACE VIEW public.v_comercios_volumen_actual 
WITH (security_invoker = true) AS
SELECT 
  cac.comercio,
  cac.comercio_id,
  COALESCE(SUM(COALESCE(p.volumen, 0) * COALESCE(i.quantity, 0)), 0) as volumen_actual
FROM public.comercios_adicional_config cac
LEFT JOIN public.products p ON LOWER(p.comercio) = LOWER(cac.comercio)
LEFT JOIN public.inventory i ON p.id = i.product_id
WHERE cac.inventario_seguimiento = true
GROUP BY cac.comercio, cac.comercio_id;

-- 3. Habilitar RLS (Row Level Security) en la tabla comercios_volumen_diario
ALTER TABLE public.comercios_volumen_diario ENABLE ROW LEVEL SECURITY;

-- 4. Crear Políticas de Acceso para la Tabla
DROP POLICY IF EXISTS "Admins gestionan volumen diario" ON public.comercios_volumen_diario;
CREATE POLICY "Admins gestionan volumen diario" ON public.comercios_volumen_diario
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
    );

DROP POLICY IF EXISTS "Usuarios ven volumen de sus comercios" ON public.comercios_volumen_diario;
CREATE POLICY "Usuarios ven volumen de sus comercios" ON public.comercios_volumen_diario
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND (
                p.comercio = 'all'
                OR LOWER(public.comercios_volumen_diario.comercio) = ANY (
                     SELECT LOWER(TRIM(name)) FROM unnest(string_to_array(p.comercio, ',')) AS name
                )
              )
        )
    );

-- Otorgar Permisos de Acceso a Roles de Supabase
GRANT ALL ON public.comercios_volumen_diario TO postgres, service_role;
GRANT ALL ON public.comercios_volumen_diario TO anon, authenticated;
GRANT SELECT ON public.v_comercios_volumen_actual TO anon, authenticated;

-- 5. Crear Función para Registrar el Volumen Automáticamente a la 1:00 AM Chile
CREATE OR REPLACE FUNCTION public.registrar_volumen_diario_comercios()
RETURNS void AS $$
DECLARE
  v_chile_hour INT;
  v_chile_date DATE;
BEGIN
  -- Obtener la hora actual en Chile (America/Santiago)
  v_chile_hour := EXTRACT(HOUR FROM timezone('America/Santiago', now()));
  
  -- Solo ejecutar si es la hora 1 (01:00 - 01:59 Chile)
  IF v_chile_hour = 1 THEN
    v_chile_date := (timezone('America/Santiago', now()))::DATE;
    
    INSERT INTO public.comercios_volumen_diario (comercio, comercio_id, fecha, volumen)
    SELECT 
      cac.comercio,
      cac.comercio_id,
      v_chile_date,
      COALESCE(SUM(COALESCE(p.volumen, 0) * COALESCE(i.quantity, 0)), 0) as total_volume
    FROM public.comercios_adicional_config cac
    LEFT JOIN public.products p ON LOWER(p.comercio) = LOWER(cac.comercio)
    LEFT JOIN public.inventory i ON p.id = i.product_id
    WHERE cac.inventario_seguimiento = true
    GROUP BY cac.comercio, cac.comercio_id
    ON CONFLICT (comercio, fecha) 
    DO UPDATE SET 
      volumen = EXCLUDED.volumen,
      comercio_id = EXCLUDED.comercio_id,
      updated_at = TIMEZONE('utc', NOW());
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 6. Crear Función para Forzar el Registro Manual (Solo para Administradores)
CREATE OR REPLACE FUNCTION public.forzar_registro_volumen_diario(p_fecha DATE)
RETURNS void AS $$
BEGIN
  -- Seguridad: Verificar que sea Administrador
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Acceso denegado: Se requieren permisos de Administrador.';
  END IF;

  -- Insertar o actualizar para la fecha dada
  INSERT INTO public.comercios_volumen_diario (comercio, comercio_id, fecha, volumen)
  SELECT 
    cac.comercio,
    cac.comercio_id,
    p_fecha,
    COALESCE(SUM(COALESCE(p.volumen, 0) * COALESCE(i.quantity, 0)), 0) as total_volume
  FROM public.comercios_adicional_config cac
  LEFT JOIN public.products p ON LOWER(p.comercio) = LOWER(cac.comercio)
  LEFT JOIN public.inventory i ON p.id = i.product_id
  WHERE cac.inventario_seguimiento = true
  GROUP BY cac.comercio, cac.comercio_id
  ON CONFLICT (comercio, fecha) 
  DO UPDATE SET 
    volumen = EXCLUDED.volumen,
    comercio_id = EXCLUDED.comercio_id,
    updated_at = TIMEZONE('utc', NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 7. Programar el Cron Job de ejecución cada hora (se ejecutará al minuto 0)
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.unschedule('registrar-volumen-diario-job') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'registrar-volumen-diario-job');
SELECT cron.schedule('registrar-volumen-diario-job', '0 * * * *', 'SELECT public.registrar_volumen_diario_comercios()');
