-- WMS STOCKA - Actualización de Estados de Solicitudes de Alta (Onboarding)
-- Ejecutar en Supabase SQL Editor para permitir estados personalizados en la tabla onboarding_requests.

-- 1. Eliminar la restricción CHECK existente en la columna status si existe
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE table_name = 'onboarding_requests' 
          AND constraint_name = 'onboarding_requests_status_check'
    ) THEN
        ALTER TABLE public.onboarding_requests DROP CONSTRAINT onboarding_requests_status_check;
    END IF;
END $$;

-- 2. Asegurar que la columna status acepte cualquier texto válido
ALTER TABLE public.onboarding_requests 
    ALTER COLUMN status SET DEFAULT 'pending';

-- 3. Notificar finalización
COMMENT ON COLUMN public.onboarding_requests.status IS 'Estado de la solicitud de onboarding: pending, approved, rejected o cualquier estado personalizado configurado por el administrador.';
