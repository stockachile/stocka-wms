-- WMS STOCKA - Esquema para Solicitudes de Toma de Inventario Físico
-- Ejecutar en el SQL Editor de Supabase

-- 1. Crear la Tabla de Solicitudes de Inventario
CREATE TABLE IF NOT EXISTS public.inventory_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  folio TEXT NOT NULL,
  merchant_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  comercio TEXT NOT NULL DEFAULT 'no asignado',
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  warehouse_name TEXT NOT NULL DEFAULT 'Todas las bodegas',
  type TEXT NOT NULL DEFAULT 'completo' CHECK (type IN ('completo', 'selectivo')),
  reason TEXT NOT NULL DEFAULT 'Auditoría / Cuadratura Periódica',
  priority TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Baja', 'Normal', 'Media', 'Alta', 'Urgente')),
  cutoff_order TEXT, -- Último pedido preparado/procesado (punto de corte para items sacados de estante)
  notes TEXT, -- Comentarios / instrucciones del cliente
  admin_notes TEXT, -- Observaciones del supervisor / equipo de bodega
  status TEXT NOT NULL DEFAULT 'Pendiente' CHECK (status IN ('Pendiente', 'En Conteo', 'Finalizada', 'Cancelada')),
  total_skus INTEGER DEFAULT 0 CHECK (total_skus >= 0),
  products_list JSONB NOT NULL DEFAULT '[]'::jsonb,
  requested_by TEXT, -- Nombre o email del solicitante
  completed_by TEXT, -- Supervisor o bodeguero que cerró el conteo
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Si la tabla ya existe, agregar la columna cutoff_order si no está presente:
ALTER TABLE public.inventory_requests ADD COLUMN IF NOT EXISTS cutoff_order TEXT;

-- Índices para búsquedas y filtros de alto rendimiento
CREATE INDEX IF NOT EXISTS idx_inventory_requests_comercio ON public.inventory_requests(comercio);
CREATE INDEX IF NOT EXISTS idx_inventory_requests_status ON public.inventory_requests(status);
CREATE INDEX IF NOT EXISTS idx_inventory_requests_created_at ON public.inventory_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_requests_merchant_id ON public.inventory_requests(merchant_id);

-- 2. Habilitar RLS (Row Level Security)
ALTER TABLE public.inventory_requests ENABLE ROW LEVEL SECURITY;

-- 3. Crear Políticas RLS

-- A) Clientes pueden ver las solicitudes de sus comercios asignados o creadas por ellos
DROP POLICY IF EXISTS "Clientes ven sus solicitudes de inventario" ON public.inventory_requests;
CREATE POLICY "Clientes ven sus solicitudes de inventario" ON public.inventory_requests
  FOR SELECT
  USING (
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
  );

-- B) Clientes pueden crear solicitudes para sus comercios
DROP POLICY IF EXISTS "Clientes crean solicitudes de inventario" ON public.inventory_requests;
CREATE POLICY "Clientes crean solicitudes de inventario" ON public.inventory_requests
  FOR INSERT
  WITH CHECK (
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
  );

-- C) Clientes pueden actualizar sus solicitudes si están en estado Pendiente (ej. cancelar o editar notas)
DROP POLICY IF EXISTS "Clientes actualizan sus solicitudes de inventario pendientes" ON public.inventory_requests;
CREATE POLICY "Clientes actualizan sus solicitudes de inventario pendientes" ON public.inventory_requests
  FOR UPDATE
  USING (
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
  );

-- D) Administradores tienen control total sobre todas las solicitudes
DROP POLICY IF EXISTS "Admins ven todas las solicitudes de inventario" ON public.inventory_requests;
CREATE POLICY "Admins ven todas las solicitudes de inventario" ON public.inventory_requests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins insertan solicitudes de inventario" ON public.inventory_requests;
CREATE POLICY "Admins insertan solicitudes de inventario" ON public.inventory_requests
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins actualizan solicitudes de inventario" ON public.inventory_requests;
CREATE POLICY "Admins actualizan solicitudes de inventario" ON public.inventory_requests
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins eliminan solicitudes de inventario" ON public.inventory_requests;
CREATE POLICY "Admins eliminan solicitudes de inventario" ON public.inventory_requests
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );
