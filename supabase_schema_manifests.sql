-- WMS STOCKA - Supabase Schema: Centro de Manifiestos
-- Ejecutar en el SQL Editor de Supabase

-- 1. Tabla Principal de Manifiestos
CREATE TABLE IF NOT EXISTS public.manifests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,                                 -- Ej: MNF-2026-00001
  courier TEXT NOT NULL,                                     -- Ej: Starken, Blue Express, Chilexpress, PedidosYa, Optiroute, etc.
  merchant_name TEXT DEFAULT 'TODOS',                        -- Nombre de comercio o 'MÚLTIPLES COMERCIOS'
  driver_name TEXT NOT NULL,                                 -- Nombre del Conductor
  driver_rut TEXT,                                           -- RUT / Cédula del conductor
  vehicle_info TEXT,                                         -- Vehículo / Marca / Modelo
  license_plate TEXT NOT NULL,                               -- Patente del vehículo
  total_orders INTEGER DEFAULT 0,                            -- Total de pedidos incluidos
  total_packages INTEGER DEFAULT 0,                          -- Total de bultos/paquetes
  notes TEXT,                                                -- Observaciones
  signature_data TEXT,                                       -- Firma Base64 / Data URL
  status TEXT CHECK (status IN ('Generado', 'Firmado', 'Despachado', 'Anulado')) DEFAULT 'Generado',
  warehouse_name TEXT DEFAULT 'Bodega Central Santiago',     -- Bodega de origen
  created_by TEXT,                                           -- Usuario/Email que creó el manifiesto
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Índices de rendimiento
CREATE INDEX IF NOT EXISTS idx_manifests_code ON public.manifests(code);
CREATE INDEX IF NOT EXISTS idx_manifests_courier ON public.manifests(courier);
CREATE INDEX IF NOT EXISTS idx_manifests_created_at ON public.manifests(created_at);

-- 2. Tabla de Ítems / Pedidos del Manifiesto
CREATE TABLE IF NOT EXISTS public.manifest_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  manifest_id UUID REFERENCES public.manifests(id) ON DELETE CASCADE,
  unified_shipment_id TEXT,                                 -- ID original de envios_unificados u orders
  pedido_referencia TEXT NOT NULL,                           -- Referencia / Nº Pedido
  tracking TEXT,                                            -- Tracking del envío
  courier TEXT,                                             -- Courier asignado al pedido
  empresa_comercio_proveedor TEXT,                          -- Comercio dueño del pedido
  nombre_destinatario TEXT,                                 -- Cliente destinatario
  comuna_destino TEXT,                                      -- Comuna destino
  direccion_destino TEXT,                                   -- Dirección destino
  packages_count INTEGER DEFAULT 1,                          -- Cantidad de bultos/cajas del pedido
  products_summary TEXT,                                    -- Resumen corto de productos
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_manifest_items_manifest_id ON public.manifest_items(manifest_id);
CREATE INDEX IF NOT EXISTS idx_manifest_items_ref ON public.manifest_items(pedido_referencia);

-- 3. Habilitar RLS y Políticas
ALTER TABLE public.manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manifest_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin y usuarios autenticados gestionan manifiestos" ON public.manifests;
CREATE POLICY "Admin y usuarios autenticados gestionan manifiestos" ON public.manifests
  FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admin y usuarios autenticados gestionan items manifiesto" ON public.manifest_items;
CREATE POLICY "Admin y usuarios autenticados gestionan items manifiesto" ON public.manifest_items
  FOR ALL USING (auth.role() = 'authenticated');
