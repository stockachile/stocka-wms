-- WMS STOCKA - Esquema y Políticas para Respuestas a Solicitudes de Toma de Inventario Físico
-- Ejecutar en el SQL Editor de Supabase (https://supabase.com/dashboard)

-- 1. Actualizar la restricción CHECK de estados para admitir el ciclo completo de respuesta
ALTER TABLE public.inventory_requests DROP CONSTRAINT IF EXISTS inventory_requests_status_check;
ALTER TABLE public.inventory_requests ADD CONSTRAINT inventory_requests_status_check
  CHECK (status IN ('Pendiente', 'En Conteo', 'Aceptada', 'Requiere Información', 'Rechazada', 'Finalizada', 'Cancelada'));

-- 2. Agregar columnas para la comunicación bidireccional si no existen
ALTER TABLE public.inventory_requests ADD COLUMN IF NOT EXISTS admin_response TEXT;
ALTER TABLE public.inventory_requests ADD COLUMN IF NOT EXISTS admin_response_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.inventory_requests ADD COLUMN IF NOT EXISTS client_reply TEXT;
ALTER TABLE public.inventory_requests ADD COLUMN IF NOT EXISTS client_reply_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.inventory_requests ADD COLUMN IF NOT EXISTS communication_history JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.inventory_requests ADD COLUMN IF NOT EXISTS signed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.inventory_requests ADD COLUMN IF NOT EXISTS signed_by TEXT;

-- 3. Índices adicionales
CREATE INDEX IF NOT EXISTS idx_inventory_requests_admin_response_at ON public.inventory_requests(admin_response_at);

-- 4. Notificar a PostgREST para recargar el schema cache
NOTIFY pgrst, 'reload schema';
