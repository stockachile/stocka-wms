-- WMS STOCKA - Supabase Schema Phase 11: Actualizar RLS para Soporte de Múltiples Comercios por Usuario
-- Ejecuta este script completo en el SQL Editor de Supabase para habilitar la visualización
-- agregada (sumatoria) de datos cuando un cliente tiene múltiples comercios asignados.

-- 1. Actualizar RLS para envios_unificados
DROP POLICY IF EXISTS "Clientes ven envios de su comercio asignado" ON public.envios_unificados;
CREATE POLICY "Clientes ven envios de su comercio asignado" ON public.envios_unificados
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(envios_unificados.empresa_comercio_proveedor) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );

-- 2. Actualizar RLS para store_pickups
DROP POLICY IF EXISTS "Clientes ven pickups de su comercio asignado" ON public.store_pickups;
CREATE POLICY "Clientes ven pickups de su comercio asignado" ON public.store_pickups
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(store_pickups.comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );

-- 3. Actualizar RLS para reverse_logistics
DROP POLICY IF EXISTS "Clientes ven devoluciones de su comercio asignado" ON public.reverse_logistics;
CREATE POLICY "Clientes ven devoluciones de su comercio asignado" ON public.reverse_logistics
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(reverse_logistics.comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );

-- 4. Actualizar RLS para store_sales
DROP POLICY IF EXISTS "Clientes ven ventas de su comercio asignado" ON public.store_sales;
CREATE POLICY "Clientes ven ventas de su comercio asignado" ON public.store_sales
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(store_sales.comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );
