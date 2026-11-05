-- ==============================================================================
-- WMS STOCKA - SISTEMA DE TRANSFERENCIAS DE STOCK ENTRE BODEGAS (TRAZABILIDAD 360°)
-- ==============================================================================
-- Ejecutar este script en el SQL Editor de Supabase.
--
-- Características:
-- 1. Crea las tablas public.stock_transfers (cabecera) y public.stock_transfer_items (detalle).
-- 2. Agrega transfer_reserved_quantity e in_transit_quantity a public.inventory.
-- 3. Agrega transfer_id y created_by_name a public.movements (Kardex).
-- 4. Políticas RLS estrictas: solo usuarios con rol 'admin' pueden crear, editar,
--    despachar, recepcionar o corregir transferencias entre bodegas.
-- 5. Funciones transaccionales RPC para creación, despacho a ruta, recepción con
--    manejo de discrepancias, edición según estado y corrección post-recepción.
-- ==============================================================================

-- 1. Secuencia para folios correlativos legibles (TRF-1001, TRF-1002, ...)
CREATE SEQUENCE IF NOT EXISTS public.stock_transfers_folio_seq START WITH 1001 INCREMENT BY 1;

-- 2. Tabla Cabecera de Transferencias entre Bodegas
CREATE TABLE IF NOT EXISTS public.stock_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folio TEXT UNIQUE NOT NULL DEFAULT ('TRF-' || nextval('public.stock_transfers_folio_seq')::TEXT),
  comercio TEXT NOT NULL,
  merchant_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  source_warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  source_warehouse_name TEXT NOT NULL,
  dest_warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  dest_warehouse_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Solicitada' CHECK (
    status IN ('Solicitada', 'En Tránsito', 'Recepcionada', 'Con Diferencias', 'Cancelada')
  ),
  priority TEXT NOT NULL DEFAULT 'Normal' CHECK (
    priority IN ('Baja', 'Normal', 'Alta', 'Urgente')
  ),
  execution_mode TEXT NOT NULL DEFAULT 'standard' CHECK (
    execution_mode IN ('standard', 'direct_hub')
  ),
  title TEXT,
  notes TEXT,
  reception_notes TEXT,
  carrier_info TEXT,
  package_count INTEGER NOT NULL DEFAULT 1 CHECK (package_count >= 0),
  discrepancy_policy TEXT NOT NULL DEFAULT 'return_origin' CHECK (
    discrepancy_policy IN ('return_origin', 'incident_loss')
  ),
  total_skus INTEGER NOT NULL DEFAULT 0 CHECK (total_skus >= 0),
  total_requested INTEGER NOT NULL DEFAULT 0 CHECK (total_requested >= 0),
  total_sent INTEGER NOT NULL DEFAULT 0 CHECK (total_sent >= 0),
  total_received INTEGER NOT NULL DEFAULT 0 CHECK (total_received >= 0),
  -- Trazabilidad de responsables
  requested_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  requested_by_name TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dispatched_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  dispatched_by_name TEXT,
  dispatched_at TIMESTAMPTZ,
  received_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  received_by_name TEXT,
  received_at TIMESTAMPTZ,
  last_edited_by_name TEXT,
  last_edited_at TIMESTAMPTZ,
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT stock_transfers_different_warehouses CHECK (source_warehouse_id <> dest_warehouse_id)
);

-- 3. Tabla Detalle de Ítems por Transferencia
CREATE TABLE IF NOT EXISTS public.stock_transfer_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity_requested INTEGER NOT NULL DEFAULT 0 CHECK (quantity_requested >= 0),
  quantity_sent INTEGER NOT NULL DEFAULT 0 CHECK (quantity_sent >= 0),
  quantity_received INTEGER NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  quantity_returned_origin INTEGER NOT NULL DEFAULT 0 CHECK (quantity_returned_origin >= 0),
  discrepancy_type TEXT NOT NULL DEFAULT 'none' CHECK (
    discrepancy_type IN ('none', 'return_origin', 'incident_loss')
  ),
  discrepancy_notes TEXT,
  dest_location_hint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(transfer_id, product_id)
);

-- 4. Columnas en public.inventory para Reserva de Traslado y Stock en Tránsito
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS transfer_reserved_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS in_transit_quantity INTEGER NOT NULL DEFAULT 0;

-- 5. Columnas en public.movements para vínculo directo con el Folio de Transferencia
ALTER TABLE public.movements
  ADD COLUMN IF NOT EXISTS transfer_id UUID REFERENCES public.stock_transfers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by_name TEXT;

-- 6. Índices de alto rendimiento
CREATE INDEX IF NOT EXISTS idx_stock_transfers_folio ON public.stock_transfers(folio);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_comercio ON public.stock_transfers(comercio);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_status ON public.stock_transfers(status);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_source_wh ON public.stock_transfers(source_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_dest_wh ON public.stock_transfers(dest_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_created_at ON public.stock_transfers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer_id ON public.stock_transfer_items(transfer_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_product_id ON public.stock_transfer_items(product_id);
CREATE INDEX IF NOT EXISTS idx_movements_transfer_id ON public.movements(transfer_id) WHERE transfer_id IS NOT NULL;

-- 7. Trigger automático de updated_at
CREATE OR REPLACE FUNCTION public.set_stock_transfers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_transfers_updated_at ON public.stock_transfers;
CREATE TRIGGER trg_stock_transfers_updated_at
  BEFORE UPDATE ON public.stock_transfers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_stock_transfers_updated_at();

DROP TRIGGER IF EXISTS trg_stock_transfer_items_updated_at ON public.stock_transfer_items;
CREATE TRIGGER trg_stock_transfer_items_updated_at
  BEFORE UPDATE ON public.stock_transfer_items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_stock_transfers_updated_at();

-- 8. Seguridad RLS (Exclusivo Administradores para gestión de transferencias)
ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Solo administradores gestionan stock_transfers" ON public.stock_transfers;
CREATE POLICY "Solo administradores gestionan stock_transfers" ON public.stock_transfers
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Solo administradores gestionan stock_transfer_items" ON public.stock_transfer_items;
CREATE POLICY "Solo administradores gestionan stock_transfer_items" ON public.stock_transfer_items
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- ==============================================================================
-- 9. FUNCIÓN DE SINCRONIZACIÓN Y CUADRATURA DE RESERVAS Y TRÁNSITO DE TRASLADOS
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.recalculate_transfer_stock_balances()
RETURNS void AS $$
DECLARE
  r RECORD;
BEGIN
  -- Resetear contadores de traslado a 0
  UPDATE public.inventory
  SET transfer_reserved_quantity = 0,
      in_transit_quantity = 0
  WHERE id IS NOT NULL;

  -- 1. Sumar transfer_reserved_quantity en bodega de origen para traslados en estado 'Solicitada'
  FOR r IN
    SELECT st.source_warehouse_id AS warehouse_id, sti.product_id, SUM(sti.quantity_requested)::INTEGER AS total_req
    FROM public.stock_transfer_items sti
    JOIN public.stock_transfers st ON st.id = sti.transfer_id
    WHERE st.status = 'Solicitada' AND sti.quantity_requested > 0
    GROUP BY st.source_warehouse_id, sti.product_id
  LOOP
    INSERT INTO public.inventory (product_id, warehouse_id, quantity, committed_quantity, reserved_quantity, transfer_reserved_quantity, in_transit_quantity)
    VALUES (r.product_id, r.warehouse_id, 0, 0, 0, r.total_req, 0)
    ON CONFLICT (product_id, warehouse_id) DO UPDATE
    SET transfer_reserved_quantity = EXCLUDED.transfer_reserved_quantity;
  END LOOP;

  -- 2. Sumar in_transit_quantity en bodega de destino para traslados en estado 'En Tránsito'
  FOR r IN
    SELECT st.dest_warehouse_id AS warehouse_id, sti.product_id, SUM(sti.quantity_sent)::INTEGER AS total_sent
    FROM public.stock_transfer_items sti
    JOIN public.stock_transfers st ON st.id = sti.transfer_id
    WHERE st.status = 'En Tránsito' AND sti.quantity_sent > 0
    GROUP BY st.dest_warehouse_id, sti.product_id
  LOOP
    INSERT INTO public.inventory (product_id, warehouse_id, quantity, committed_quantity, reserved_quantity, transfer_reserved_quantity, in_transit_quantity)
    VALUES (r.product_id, r.warehouse_id, 0, 0, 0, 0, r.total_sent)
    ON CONFLICT (product_id, warehouse_id) DO UPDATE
    SET in_transit_quantity = EXCLUDED.in_transit_quantity;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.recalculate_transfer_stock_balances() TO authenticated, service_role;
