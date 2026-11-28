-- WMS STOCKA - Soporte para Inventarios Internos (Ocultos al Comercio y Sin Notificaciones)
-- Ejecutar en el SQL Editor de Supabase

-- 1. Agregar columna is_internal a inventory_requests
ALTER TABLE public.inventory_requests
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;

-- 2. Backfill en caso de que ya existan solicitudes internas creadas antes de correr esta migración
UPDATE public.inventory_requests
SET is_internal = true
WHERE is_internal = false
  AND (
    UPPER(COALESCE(folio, '')) LIKE 'INT-INV-%'
    OR COALESCE(admin_notes, '') LIKE '%[INVENTARIO INTERNO]%'
  );

-- 3. Índice para filtrado eficiente
CREATE INDEX IF NOT EXISTS idx_inventory_requests_is_internal
  ON public.inventory_requests(is_internal);

-- 4. Actualizar políticas RLS de clientes para bloquear totalmente visibilidad/edición de inventarios internos
DROP POLICY IF EXISTS "Clientes ven sus solicitudes de inventario" ON public.inventory_requests;
CREATE POLICY "Clientes ven sus solicitudes de inventario" ON public.inventory_requests
  FOR SELECT
  USING (
    COALESCE(inventory_requests.is_internal, false) = false
    AND UPPER(COALESCE(inventory_requests.folio, '')) NOT LIKE 'INT-INV-%'
    AND (
      auth.uid() = merchant_id
      OR EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND (
            LOWER(profiles.comercio) = 'all'
            OR LOWER(inventory_requests.comercio) = ANY (
              SELECT TRIM(LOWER(token))
              FROM unnest(string_to_array(profiles.comercio, ',')) AS token
            )
          )
      )
    )
  );

DROP POLICY IF EXISTS "Clientes actualizan sus solicitudes de inventario pendientes" ON public.inventory_requests;
CREATE POLICY "Clientes actualizan sus solicitudes de inventario pendientes" ON public.inventory_requests
  FOR UPDATE
  USING (
    COALESCE(inventory_requests.is_internal, false) = false
    AND UPPER(COALESCE(inventory_requests.folio, '')) NOT LIKE 'INT-INV-%'
    AND (
      auth.uid() = merchant_id
      OR EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND (
            LOWER(profiles.comercio) = 'all'
            OR LOWER(inventory_requests.comercio) = ANY (
              SELECT TRIM(LOWER(token))
              FROM unnest(string_to_array(profiles.comercio, ',')) AS token
            )
          )
      )
    )
  );
