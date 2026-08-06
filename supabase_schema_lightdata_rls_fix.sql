-- WMS STOCKA - SQL Migration to fix VULN-01 (Enable RLS on lightdata_envios)
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Asegurar que la función helper is_admin() existe
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- 2. Habilitar Row Level Security (RLS) en la tabla lightdata_envios
ALTER TABLE public.lightdata_envios ENABLE ROW LEVEL SECURITY;

-- 3. Eliminar políticas previas si existen para evitar duplicados
DROP POLICY IF EXISTS "Admin gestiona todo en lightdata" ON public.lightdata_envios;
DROP POLICY IF EXISTS "Clientes ven sus propios envios en lightdata" ON public.lightdata_envios;

-- 4. Crear Política para Administradores (Acceso Completo)
CREATE POLICY "Admin gestiona todo en lightdata" ON public.lightdata_envios
  FOR ALL USING (is_admin());

-- 5. Crear Política para Clientes (Lectura de envíos asociados a su comercio)
CREATE POLICY "Clientes ven sus propios envios en lightdata" ON public.lightdata_envios
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(lightdata_envios.comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );

-- 6. Otorgar los accesos correspondientes a los roles de Supabase
GRANT ALL ON public.lightdata_envios TO postgres, service_role;
GRANT SELECT ON public.lightdata_envios TO anon, authenticated;
