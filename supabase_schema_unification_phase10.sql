-- WMS STOCKA - Supabase Schema Phase 10: Corregir Políticas de RLS para Envios Unificados
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase para solucionar el problema
-- de visualización de pedidos en el módulo de envíos consolidados.

-- 1. Eliminar políticas anteriores de clientes en la tabla envios_unificados
DROP POLICY IF EXISTS "Clientes ven sus propios envios unificados" ON public.envios_unificados;
DROP POLICY IF EXISTS "Clientes ven envios de su comercio asignado" ON public.envios_unificados;

-- 2. Crear la nueva política basada en el comercio asignado al perfil del usuario
CREATE POLICY "Clientes ven envios de su comercio asignado" ON public.envios_unificados
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND LOWER(envios_unificados.empresa_comercio_proveedor) = LOWER(profiles.comercio)
    )
  );
