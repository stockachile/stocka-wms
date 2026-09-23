-- WMS STOCKA - Esquema y Políticas para Conteos de Inventario Móvil Colaborativo
-- Ejecutar en el SQL Editor de Supabase (https://supabase.com/dashboard)

-- 1. Tabla de Sesiones de Conteo de Inventario Físico
CREATE TABLE IF NOT EXISTS public.inventory_count_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folio TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  comercio TEXT NOT NULL DEFAULT 'Todos',
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  warehouse_name TEXT NOT NULL DEFAULT 'Todas las bodegas',
  inventory_request_id UUID REFERENCES public.inventory_requests(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'activa' CHECK (status IN ('activa', 'pausada', 'finalizada', 'cancelada')),
  created_by TEXT NOT NULL DEFAULT 'Admin',
  creator_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes TEXT,
  total_scans INTEGER NOT NULL DEFAULT 0 CHECK (total_scans >= 0),
  total_units INTEGER NOT NULL DEFAULT 0 CHECK (total_units >= 0),
  unique_skus INTEGER NOT NULL DEFAULT 0 CHECK (unique_skus >= 0),
  settings JSONB NOT NULL DEFAULT '{"require_expiry": false, "auto_increment": false, "allow_unknown": true}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  closed_at TIMESTAMP WITH TIME ZONE
);

-- Índices de búsqueda y orden para sesiones
CREATE INDEX IF NOT EXISTS idx_inv_count_sessions_status ON public.inventory_count_sessions(status);
CREATE INDEX IF NOT EXISTS idx_inv_count_sessions_comercio ON public.inventory_count_sessions(comercio);
CREATE INDEX IF NOT EXISTS idx_inv_count_sessions_created_at ON public.inventory_count_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_count_sessions_req_id ON public.inventory_count_sessions(inventory_request_id);

-- 2. Tabla de Lecturas / Ítems de Conteo Físico
CREATE TABLE IF NOT EXISTS public.inventory_count_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.inventory_count_sessions(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  sku TEXT NOT NULL,
  barcode TEXT,
  product_name TEXT NOT NULL,
  comercio TEXT NOT NULL DEFAULT 'no asignado',
  warehouse_name TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  expiry_date DATE, -- Fecha de vencimiento (opcional / solo si aplica)
  lot_number TEXT,  -- Lote del producto (opcional)
  location TEXT,    -- Ubicación en bodega: Pasillo, Rack, Nivel (opcional)
  operator_name TEXT NOT NULL DEFAULT 'Operador Móvil',
  device_id TEXT,   -- Identificador único del dispositivo / teléfono
  device_info TEXT, -- Modelo o User Agent resumido
  notes TEXT,       -- Observaciones: dañado, empaque abierto, etc.
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Índices de alto rendimiento para consultas y agregaciones en tiempo real
CREATE INDEX IF NOT EXISTS idx_inv_count_items_session_id ON public.inventory_count_items(session_id);
CREATE INDEX IF NOT EXISTS idx_inv_count_items_sku ON public.inventory_count_items(sku);
CREATE INDEX IF NOT EXISTS idx_inv_count_items_barcode ON public.inventory_count_items(barcode);
CREATE INDEX IF NOT EXISTS idx_inv_count_items_created_at ON public.inventory_count_items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_count_items_operator ON public.inventory_count_items(operator_name);

-- 3. Habilitar Row Level Security (RLS)
ALTER TABLE public.inventory_count_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_count_items ENABLE ROW LEVEL SECURITY;

-- 4. Políticas de Seguridad (RLS) para Sesiones
DROP POLICY IF EXISTS "Usuarios autorizados ven sesiones de conteo" ON public.inventory_count_sessions;
CREATE POLICY "Usuarios autorizados ven sesiones de conteo" ON public.inventory_count_sessions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (
          profiles.role = 'admin'
          OR LOWER(profiles.comercio) = 'all'
          OR LOWER(inventory_count_sessions.comercio) = 'todos'
          OR LOWER(inventory_count_sessions.comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );

DROP POLICY IF EXISTS "Admins y operarios crean sesiones de conteo" ON public.inventory_count_sessions;
CREATE POLICY "Admins y operarios crean sesiones de conteo" ON public.inventory_count_sessions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins y operarios actualizan sesiones de conteo" ON public.inventory_count_sessions;
CREATE POLICY "Admins y operarios actualizan sesiones de conteo" ON public.inventory_count_sessions
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins eliminan sesiones de conteo" ON public.inventory_count_sessions;
CREATE POLICY "Admins eliminan sesiones de conteo" ON public.inventory_count_sessions
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- 5. Políticas de Seguridad (RLS) para Ítems / Lecturas
DROP POLICY IF EXISTS "Usuarios autorizados ven lecturas de conteo" ON public.inventory_count_items;
CREATE POLICY "Usuarios autorizados ven lecturas de conteo" ON public.inventory_count_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.inventory_count_sessions s
      WHERE s.id = inventory_count_items.session_id
    )
  );

DROP POLICY IF EXISTS "Operarios insertan lecturas de conteo" ON public.inventory_count_items;
CREATE POLICY "Operarios insertan lecturas de conteo" ON public.inventory_count_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Operarios actualizan sus lecturas de conteo" ON public.inventory_count_items;
CREATE POLICY "Operarios actualizan sus lecturas de conteo" ON public.inventory_count_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Operarios y admins eliminan lecturas de conteo" ON public.inventory_count_items;
CREATE POLICY "Operarios y admins eliminan lecturas de conteo" ON public.inventory_count_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
    )
  );

-- 6. Trigger para actualizar totales de la sesión automáticamente
CREATE OR REPLACE FUNCTION public.fn_sync_inventory_count_session_totals()
RETURNS TRIGGER AS $$
DECLARE
  v_session_id UUID;
  v_scans INT;
  v_units INT;
  v_skus INT;
BEGIN
  v_session_id := COALESCE(NEW.session_id, OLD.session_id);

  SELECT 
    COUNT(*), 
    COALESCE(SUM(quantity), 0), 
    COUNT(DISTINCT UPPER(TRIM(sku)))
  INTO v_scans, v_units, v_skus
  FROM public.inventory_count_items
  WHERE session_id = v_session_id;

  UPDATE public.inventory_count_sessions
  SET 
    total_scans = v_scans,
    total_units = v_units,
    unique_skus = v_skus,
    updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_session_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_inventory_count_totals ON public.inventory_count_items;
CREATE TRIGGER trg_sync_inventory_count_totals
AFTER INSERT OR UPDATE OR DELETE ON public.inventory_count_items
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_inventory_count_session_totals();

-- 7. Habilitar Replicación en Supabase Realtime (Colaboración en Vivo Multi-teléfono)
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_count_sessions;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_count_items;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
