-- ==============================================================================
-- TABLA DEDICADA: optiroute_route_records
-- Registro y métricas mensuales de rutas, vehículos y conductores de Optiroute
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.optiroute_route_records (
    id TEXT PRIMARY KEY,                       -- e.g. route_{route_id}
    route_id TEXT NOT NULL,                    -- ID único de web-route en Optiroute
    route_plan_id TEXT NOT NULL,               -- ID de plan de rutas
    route_plan_name TEXT,                      -- Nombre del plan de ruta (ej: STK 10-10-26 EE)
    route_date DATE,                           -- Fecha de salida (ej: 2026-10-10)
    vehicle_id TEXT,                           -- ID del vehículo en Optiroute
    vehicle_name TEXT,                         -- Nombre del vehículo (ej: OPEL COMBO)
    vehicle_plate TEXT,                        -- Patente del vehículo (ej: SVVP43)
    driver_id TEXT,                            -- ID del conductor en Optiroute
    driver_name TEXT,                          -- Conductor establecido (ej: Sebastián H. / N2)
    driver_optiroute_name TEXT,                -- Conductor original de Optiroute
    driver_assigned_by TEXT,                   -- Admin que estableció el conductor
    driver_assigned_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    started_at TIMESTAMP WITH TIME ZONE,       -- Inicio efectivo de la ruta
    completed_at TIMESTAMP WITH TIME ZONE,     -- Término efectivo de la ruta
    duration_seconds NUMERIC DEFAULT 0,        -- Duración total en segundos
    distance_km NUMERIC DEFAULT 0,             -- Kilómetros recorridos
    total_points INTEGER DEFAULT 0,            -- Total de puntos de clientes
    delivered_points INTEGER DEFAULT 0,        -- Puntos entregados con éxito
    skipped_points INTEGER DEFAULT 0,          -- Puntos saltados / cancelados
    pending_points INTEGER DEFAULT 0,          -- Puntos pendientes / en ruta
    delivery_rate NUMERIC DEFAULT 0,           -- % de éxito de entrega (tasa de entrega)
    speed_minutes_per_package NUMERIC DEFAULT 0, -- Minutos por paquete entregado
    packages_per_hour NUMERIC DEFAULT 0,       -- Paquetes entregados por hora
    status INTEGER DEFAULT 0,                  -- Estado en Optiroute (2 = completado)
    notes TEXT,                                -- Notas u observaciones operativas
    kpis JSONB DEFAULT '{}'::jsonb,            -- KPIs detallados
    raw_data JSONB DEFAULT '{}'::jsonb,        -- Payload para auditoría
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Índices para búsquedas ultra rápidas
CREATE INDEX IF NOT EXISTS idx_optiroute_records_route_id ON public.optiroute_route_records(route_id);
CREATE INDEX IF NOT EXISTS idx_optiroute_records_route_date ON public.optiroute_route_records(route_date);
CREATE INDEX IF NOT EXISTS idx_optiroute_records_driver ON public.optiroute_route_records(driver_name);
CREATE INDEX IF NOT EXISTS idx_optiroute_records_vehicle ON public.optiroute_route_records(vehicle_name);
CREATE INDEX IF NOT EXISTS idx_optiroute_records_plan ON public.optiroute_route_records(route_plan_id);

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.optiroute_route_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow select optiroute_route_records" ON public.optiroute_route_records;
CREATE POLICY "Allow select optiroute_route_records" ON public.optiroute_route_records FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert optiroute_route_records" ON public.optiroute_route_records;
CREATE POLICY "Allow insert optiroute_route_records" ON public.optiroute_route_records FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update optiroute_route_records" ON public.optiroute_route_records;
CREATE POLICY "Allow update optiroute_route_records" ON public.optiroute_route_records FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete optiroute_route_records" ON public.optiroute_route_records;
CREATE POLICY "Allow delete optiroute_route_records" ON public.optiroute_route_records FOR DELETE USING (true);
