-- ==============================================================================
-- TABLA DEDICADA: optiroute_intermediate_points
-- Permite persistir paradas y pedidos intermedios de rutas Optiroute de forma
-- totalmente aislada e independiente de las actualizaciones/sincronizaciones de la API.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.optiroute_intermediate_points (
    id TEXT PRIMARY KEY,
    route_plan_id TEXT NOT NULL,
    route_name TEXT,
    order_num NUMERIC NOT NULL,
    reference TEXT NOT NULL,
    supplier TEXT DEFAULT 'STOCKA',
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT NOT NULL,
    complemento TEXT,
    comuna TEXT NOT NULL,
    driver TEXT,
    vehicle TEXT,
    note TEXT,
    status TEXT DEFAULT 'Ingresado (Punto Intermedio)',
    raw_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Índices para alto rendimiento y consultas instantáneas
CREATE INDEX IF NOT EXISTS idx_optiroute_intermediate_route_plan ON public.optiroute_intermediate_points(route_plan_id);
CREATE INDEX IF NOT EXISTS idx_optiroute_intermediate_reference ON public.optiroute_intermediate_points(reference);

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.optiroute_intermediate_points ENABLE ROW LEVEL SECURITY;

-- Políticas de acceso
DROP POLICY IF EXISTS "Allow select optiroute_intermediate_points" ON public.optiroute_intermediate_points;
CREATE POLICY "Allow select optiroute_intermediate_points"
ON public.optiroute_intermediate_points FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Allow insert optiroute_intermediate_points" ON public.optiroute_intermediate_points;
CREATE POLICY "Allow insert optiroute_intermediate_points"
ON public.optiroute_intermediate_points FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update optiroute_intermediate_points" ON public.optiroute_intermediate_points;
CREATE POLICY "Allow update optiroute_intermediate_points"
ON public.optiroute_intermediate_points FOR UPDATE
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete optiroute_intermediate_points" ON public.optiroute_intermediate_points;
CREATE POLICY "Allow delete optiroute_intermediate_points"
ON public.optiroute_intermediate_points FOR DELETE
USING (true);
