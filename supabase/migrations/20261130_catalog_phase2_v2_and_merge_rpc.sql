-- ==============================================================================
-- WMS STOCKA - FASE 2: CATÁLOGO MAESTRO AGNÓSTICO, INTEGRIDAD REFERENCIAL Y MERGE RPC
-- ==============================================================================
-- Contenido:
--   1. Integridad referencial en public.sku_equivalences:
--      - master_product_id UUID REFERENCES public.products(id) ON DELETE RESTRICT
--      - quantity_multiplier INTEGER NOT NULL DEFAULT 1 (soporte multipack 1:N)
--      - updated_at / updated_by para trazabilidad
--      - Backfill automático de master_product_id en registros existentes válidos
--      - Triggers actualizados para mantener master_product_id y master_sku siempre sincronizados
--   2. Bandeja Unificada en public.synced_products:
--      - is_ignored, ignored_reason, ignored_at, ignored_by (persistentes entre syncs)
--      - Índice compuesto (comercio, platform)
--   3. Protección en prevent_destructive_product_delete() para advertir si existen
--      equivalencias activas apuntando al producto.
--   4. RPC transaccional atómico public.merge_duplicate_products(...) (solo Admin / service_role):
--      - Consolida order_items, movements, kardex_audit_logs, product_locations,
--        inventory_count_items, stock_transfer_items, product_pack_items, pack_audit_logs,
--        campaigns, inventory (todas las columnas de stock) y sku_equivalences.
--      - Recalcula committed_quantity y reserved_quantity exactos del producto destino.
--      - Crea automáticamente la equivalencia source_sku -> target_sku y elimina el duplicado.
--   5. Activación piloto de catalog_v2_enabled = true para 'HIT GAMING'
--      (manteniendo catalog_strict_orders = false hasta concluir el saneamiento).
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- 1. EVOLUCIÓN DE public.sku_equivalences (master_product_id + quantity_multiplier)
-- ==============================================================================
ALTER TABLE public.sku_equivalences
  ADD COLUMN IF NOT EXISTS master_product_id UUID REFERENCES public.products(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS quantity_multiplier INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.sku_equivalences
  DROP CONSTRAINT IF EXISTS sku_equivalences_quantity_multiplier_check;
ALTER TABLE public.sku_equivalences
  ADD CONSTRAINT sku_equivalences_quantity_multiplier_check CHECK (quantity_multiplier >= 1);

CREATE INDEX IF NOT EXISTS idx_sku_equivalences_master_product_id
  ON public.sku_equivalences (master_product_id)
  WHERE master_product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sku_equivalences_comercio_platform
  ON public.sku_equivalences (comercio, platform);

COMMENT ON COLUMN public.sku_equivalences.master_product_id IS
  'Referencia FK al UUID del producto maestro en public.products (integridad referencial fuerte).';
COMMENT ON COLUMN public.sku_equivalences.quantity_multiplier IS
  'Cantidad de unidades del producto maestro que descuenta cada 1 unidad vendida del SKU externo (ej. 2 para Pack x2).';

-- Backfill de master_product_id para equivalencias existentes cuyo master_sku existe en products
-- (las equivalencias huérfanas previas quedan con master_product_id = NULL para visibilidad/limpieza en UI)
WITH matched AS (
  SELECT DISTINCT ON (eq.id)
    eq.id AS eq_id,
    p.id AS prod_id,
    p.sku AS prod_sku
  FROM public.sku_equivalences eq
  JOIN public.products p
    ON LOWER(TRIM(p.comercio)) = LOWER(TRIM(eq.comercio))
   AND UPPER(REGEXP_REPLACE(TRIM(p.sku), '\s+', '', 'g')) = UPPER(REGEXP_REPLACE(TRIM(eq.master_sku), '\s+', '', 'g'))
  WHERE eq.master_product_id IS NULL
  ORDER BY eq.id, (p.sku = eq.master_sku) DESC, (p.barcode_wms IS NOT NULL) DESC, p.created_at ASC
)
UPDATE public.sku_equivalences eq
SET master_product_id = matched.prod_id,
    master_sku = matched.prod_sku,
    updated_at = NOW()
FROM matched
WHERE eq.id = matched.eq_id;

-- Trigger BEFORE INSERT OR UPDATE: exigir producto maestro válido y poblar master_product_id + master_sku canónico
CREATE OR REPLACE FUNCTION public.validate_and_normalize_sku_equivalence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prod_id UUID;
  v_canonical_master_sku TEXT;
BEGIN
  NEW.comercio := TRIM(COALESCE(NEW.comercio, ''));
  NEW.platform := TRIM(COALESCE(NEW.platform, ''));
  NEW.platform_sku := TRIM(COALESCE(NEW.platform_sku, ''));
  NEW.master_sku := TRIM(COALESCE(NEW.master_sku, ''));
  NEW.quantity_multiplier := GREATEST(1, COALESCE(NEW.quantity_multiplier, 1));
  NEW.updated_at := NOW();
  IF auth.uid() IS NOT NULL THEN
    NEW.updated_by := auth.uid();
  END IF;

  IF NEW.platform_sku = '' THEN
    RAISE EXCEPTION 'El SKU externo (platform_sku) es obligatorio.';
  END IF;

  -- Si vino master_product_id explícito y no se cambió master_sku hacia otro producto distinto, validar por ID
  IF NEW.master_product_id IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR OLD.master_product_id IS DISTINCT FROM NEW.master_product_id
       OR OLD.master_sku IS NOT DISTINCT FROM NEW.master_sku
     ) THEN
    SELECT p.id, p.sku INTO v_prod_id, v_canonical_master_sku
    FROM public.products p
    WHERE p.id = NEW.master_product_id
      AND LOWER(TRIM(p.comercio)) = LOWER(NEW.comercio)
    LIMIT 1;

    IF v_prod_id IS NOT NULL THEN
      NEW.master_product_id := v_prod_id;
      NEW.master_sku := v_canonical_master_sku;
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.master_sku = '' THEN
    RAISE EXCEPTION 'El SKU maestro (master_sku) es obligatorio.';
  END IF;

  SELECT p.id, p.sku INTO v_prod_id, v_canonical_master_sku
  FROM public.products p
  WHERE LOWER(TRIM(p.comercio)) = LOWER(NEW.comercio)
    AND UPPER(REGEXP_REPLACE(TRIM(p.sku), '\s+', '', 'g')) = UPPER(REGEXP_REPLACE(NEW.master_sku, '\s+', '', 'g'))
  ORDER BY (p.sku = NEW.master_sku) DESC, (p.barcode_wms IS NOT NULL) DESC, p.created_at ASC
  LIMIT 1;

  IF v_prod_id IS NULL THEN
    RAISE EXCEPTION 'El SKU maestro "%" no existe en el Catálogo Master de "%". Crea o selecciona un SKU maestro válido antes de guardar la equivalencia.', NEW.master_sku, NEW.comercio;
  END IF;

  NEW.master_product_id := v_prod_id;
  NEW.master_sku := v_canonical_master_sku;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_and_normalize_sku_equivalence ON public.sku_equivalences;
CREATE TRIGGER trg_validate_and_normalize_sku_equivalence
  BEFORE INSERT OR UPDATE ON public.sku_equivalences
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_and_normalize_sku_equivalence();

-- Trigger AFTER UPDATE OF sku ON products: propagar cambio de SKU por master_product_id o texto legacy
CREATE OR REPLACE FUNCTION public.sync_sku_equivalences_on_master_sku_rename()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.sku IS DISTINCT FROM NEW.sku AND TRIM(COALESCE(NEW.sku, '')) <> '' THEN
    UPDATE public.sku_equivalences
    SET master_sku = NEW.sku,
        master_product_id = NEW.id,
        updated_at = NOW()
    WHERE master_product_id = NEW.id
       OR (
         LOWER(TRIM(comercio)) = LOWER(TRIM(NEW.comercio))
         AND UPPER(REGEXP_REPLACE(TRIM(master_sku), '\s+', '', 'g')) = UPPER(REGEXP_REPLACE(TRIM(OLD.sku), '\s+', '', 'g'))
       );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_sku_equivalences_on_master_sku_rename ON public.products;
CREATE TRIGGER trg_sync_sku_equivalences_on_master_sku_rename
  AFTER UPDATE OF sku ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_sku_equivalences_on_master_sku_rename();


-- ==============================================================================
-- 2. BANDEJA UNIFICADA DE CANALES EN public.synced_products (ESTADO IGNORADO)
-- ==============================================================================
ALTER TABLE public.synced_products
  ADD COLUMN IF NOT EXISTS is_ignored BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ignored_reason TEXT,
  ADD COLUMN IF NOT EXISTS ignored_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ignored_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_synced_products_comercio_platform
  ON public.synced_products (comercio, platform);

COMMENT ON COLUMN public.synced_products.is_ignored IS
  'Marca una publicación de canal como no gestionada por WMS (ej. Mercado Envíos FULL, publicación obsoleta o digital). Persiste entre sincronizaciones.';
COMMENT ON COLUMN public.synced_products.ignored_reason IS
  'Motivo opcional por el cual el SKU externo fue marcado como ignorado (ej. Meli FULL, Descontinuado, Dropshipping).';

-- RPC segura para marcar/desmarcar una publicación de canal como ignorada (No gestionada por WMS).
-- Permite que tanto Admins como Clientes dueños del comercio marquen publicaciones (ej. Meli FULL)
-- sin abrir UPDATE directo sobre columnas sincronizadas (sku, name, price, platform).
CREATE OR REPLACE FUNCTION public.set_synced_product_ignored(
  p_comercio TEXT,
  p_platform TEXT,
  p_sku TEXT,
  p_is_ignored BOOLEAN,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_company TEXT;
  v_comercio TEXT;
  v_comercio_tokens TEXT[] := ARRAY[]::TEXT[];
  v_allowed BOOLEAN := false;
  v_clean_comercio TEXT := TRIM(COALESCE(p_comercio, ''));
  v_clean_platform TEXT := TRIM(COALESCE(p_platform, ''));
  v_clean_sku TEXT := TRIM(COALESCE(p_sku, ''));
  v_updated_count INTEGER := 0;
BEGIN
  IF v_clean_comercio = '' OR v_clean_platform = '' OR v_clean_sku = '' THEN
    RAISE EXCEPTION 'Debes indicar comercio, plataforma y SKU externo.';
  END IF;

  IF COALESCE(auth.role(), '') = 'service_role' THEN
    v_allowed := true;
  ELSIF v_uid IS NOT NULL THEN
    SELECT role, company_name, comercio INTO v_role, v_company, v_comercio
    FROM public.profiles
    WHERE id = v_uid;

    IF COALESCE(v_role, '') = 'observer' THEN
      RAISE EXCEPTION 'El perfil observador es de solo lectura.';
    END IF;

    SELECT COALESCE(ARRAY(
      SELECT TRIM(LOWER(t))
      FROM unnest(string_to_array(COALESCE(v_comercio, '') || ',' || COALESCE(v_company, ''), ',')) AS t
      WHERE TRIM(t) <> ''
    ), ARRAY[]::TEXT[]) INTO v_comercio_tokens;

    IF public.is_admin() OR COALESCE(v_role, '') IN ('admin', 'operario', 'supervisor') THEN
      v_allowed := true;
    ELSIF LOWER(v_clean_comercio) = ANY (v_comercio_tokens)
       OR 'all' = ANY (v_comercio_tokens) THEN
      v_allowed := true;
    END IF;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'No tienes permisos para modificar el estado de publicaciones para el comercio "%".', v_clean_comercio;
  END IF;

  UPDATE public.synced_products
  SET
    is_ignored = COALESCE(p_is_ignored, false),
    ignored_reason = CASE
      WHEN COALESCE(p_is_ignored, false) THEN NULLIF(TRIM(COALESCE(p_reason, '')), '')
      ELSE NULL
    END,
    ignored_at = CASE
      WHEN COALESCE(p_is_ignored, false) THEN NOW()
      ELSE NULL
    END,
    ignored_by = CASE
      WHEN COALESCE(p_is_ignored, false) THEN v_uid
      ELSE NULL
    END
  WHERE comercio = v_clean_comercio
    AND platform = v_clean_platform
    AND sku = v_clean_sku;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'No se encontró la publicación sincronizada (% / %) en el comercio "%".', v_clean_platform, v_clean_sku, v_clean_comercio;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'comercio', v_clean_comercio,
    'platform', v_clean_platform,
    'sku', v_clean_sku,
    'is_ignored', COALESCE(p_is_ignored, false),
    'ignored_reason', CASE WHEN COALESCE(p_is_ignored, false) THEN NULLIF(TRIM(COALESCE(p_reason, '')), '') ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_synced_product_ignored(TEXT, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_synced_product_ignored(TEXT, TEXT, TEXT, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_synced_product_ignored(TEXT, TEXT, TEXT, BOOLEAN, TEXT) TO service_role;


-- ==============================================================================
-- 3. ACTUALIZAR TRIGGER ANTI-BORRADO EN public.products (INCLUIR EQUIVALENCIAS)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.prevent_destructive_product_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_stock BOOLEAN := false;
  v_has_orders BOOLEAN := false;
  v_has_movements BOOLEAN := false;
  v_has_pack_refs BOOLEAN := false;
  v_has_eq_refs BOOLEAN := false;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.inventory
    WHERE product_id = OLD.id
      AND (
        COALESCE(quantity, 0) <> 0
        OR COALESCE(committed_quantity, 0) <> 0
        OR COALESCE(reserved_quantity, 0) <> 0
        OR COALESCE(quarantine_quantity, 0) <> 0
        OR COALESCE(transfer_reserved_quantity, 0) <> 0
        OR COALESCE(in_transit_quantity, 0) <> 0
      )
  ) INTO v_has_stock;

  IF v_has_stock THEN
    RAISE EXCEPTION 'No se puede eliminar el producto "%" porque tiene stock físico, comprometido, reservado o en tránsito. Cambia su estado a "Archivado" en su lugar.', OLD.sku;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.order_items WHERE product_id = OLD.id
  ) INTO v_has_orders;

  IF v_has_orders THEN
    RAISE EXCEPTION 'No se puede eliminar el producto "%" porque tiene pedidos asociados. Cambia su estado a "Archivado" en su lugar.', OLD.sku;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.movements WHERE product_id = OLD.id
  ) INTO v_has_movements;

  IF v_has_movements THEN
    RAISE EXCEPTION 'No se puede eliminar el producto "%" porque tiene historial de movimientos (kardex). Cambia su estado a "Archivado" en su lugar.', OLD.sku;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.product_pack_items
    WHERE pack_product_id = OLD.id OR member_product_id = OLD.id
  ) INTO v_has_pack_refs;

  IF v_has_pack_refs THEN
    RAISE EXCEPTION 'No se puede eliminar el producto "%" porque forma parte de un Pack/Combo. Retíralo del pack o archiva el producto.', OLD.sku;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.sku_equivalences
    WHERE master_product_id = OLD.id
  ) INTO v_has_eq_refs;

  IF v_has_eq_refs THEN
    RAISE EXCEPTION 'No se puede eliminar el producto "%" porque tiene equivalencias de canales apuntando a él. Reasigna o elimina esas equivalencias primero, o utiliza "Fusionar SKUs Duplicados".', OLD.sku;
  END IF;

  RETURN OLD;
END;
$$;


-- ==============================================================================
-- 4. RPC TRANSACCIONAL ATÓMICO: public.merge_duplicate_products(...)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.merge_duplicate_products(
  p_comercio TEXT,
  p_source_sku TEXT,
  p_target_sku TEXT,
  p_platform TEXT DEFAULT 'Todas',
  p_quantity_multiplier INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source public.products%ROWTYPE;
  v_target public.products%ROWTYPE;
  v_oi RECORD;
  v_existing_oi_id UUID;
  v_inv RECORD;
  v_target_inv RECORD;
  v_pack_rel RECORD;
  v_sti RECORD;
  v_existing_sti_id UUID;
  v_merged_options JSONB;
  v_alt_barcodes JSONB;
  v_src_barcode TEXT;
  v_tgt_barcode TEXT;
  v_moved_order_items INTEGER := 0;
  v_moved_movements INTEGER := 0;
  v_moved_locations INTEGER := 0;
  v_moved_counts INTEGER := 0;
  v_moved_transfers INTEGER := 0;
  v_merged_warehouses INTEGER := 0;
  v_repointed_equivalences INTEGER := 0;
  v_mult INTEGER := GREATEST(1, COALESCE(p_quantity_multiplier, 1));
  v_platform TEXT := COALESCE(NULLIF(TRIM(p_platform), ''), 'Todas');
  v_wh RECORD;
  v_calc_committed INTEGER;
  v_calc_reserved INTEGER;
BEGIN
  -- 0. Autorización: exclusivamente Admin o service_role
  IF NOT public.is_admin()
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Acceso denegado: Solo Administradores pueden fusionar SKUs duplicados.';
  END IF;

  IF TRIM(COALESCE(p_comercio, '')) = '' OR TRIM(COALESCE(p_source_sku, '')) = '' OR TRIM(COALESCE(p_target_sku, '')) = '' THEN
    RAISE EXCEPTION 'Debes indicar comercio, SKU origen (duplicado) y SKU destino (maestro).';
  END IF;

  -- 1. Resolver ambos productos dentro del comercio (con bloqueo FOR UPDATE en orden determinista para evitar deadlocks)
  SELECT * INTO v_source
  FROM public.products
  WHERE LOWER(TRIM(comercio)) = LOWER(TRIM(p_comercio))
    AND UPPER(REGEXP_REPLACE(TRIM(sku), '\s+', '', 'g')) = UPPER(REGEXP_REPLACE(TRIM(p_source_sku), '\s+', '', 'g'))
  ORDER BY (sku = TRIM(p_source_sku)) DESC, created_at ASC
  LIMIT 1;

  IF v_source.id IS NULL THEN
    RAISE EXCEPTION 'El SKU origen "%" no existe en el Catálogo Master de "%".', p_source_sku, p_comercio;
  END IF;

  SELECT * INTO v_target
  FROM public.products
  WHERE LOWER(TRIM(comercio)) = LOWER(TRIM(p_comercio))
    AND UPPER(REGEXP_REPLACE(TRIM(sku), '\s+', '', 'g')) = UPPER(REGEXP_REPLACE(TRIM(p_target_sku), '\s+', '', 'g'))
  ORDER BY (sku = TRIM(p_target_sku)) DESC, created_at ASC
  LIMIT 1;

  IF v_target.id IS NULL THEN
    RAISE EXCEPTION 'El SKU maestro destino "%" no existe en el Catálogo Master de "%".', p_target_sku, p_comercio;
  END IF;

  IF v_source.id = v_target.id THEN
    RAISE EXCEPTION 'El SKU origen y el SKU destino corresponden al mismo producto ("%").', v_target.sku;
  END IF;

  -- Bloquear ambas filas en orden por UUID
  PERFORM 1 FROM public.products WHERE id IN (v_source.id, v_target.id) ORDER BY id FOR UPDATE;

  -- 2. Re-vincular order_items (consolidando líneas duplicadas en la misma orden/bodega/campaña)
  FOR v_oi IN
    SELECT * FROM public.order_items WHERE product_id = v_source.id
  LOOP
    SELECT id INTO v_existing_oi_id
    FROM public.order_items
    WHERE order_id = v_oi.order_id
      AND product_id = v_target.id
      AND (warehouse_id IS NOT DISTINCT FROM v_oi.warehouse_id)
      AND COALESCE(is_gift, false) = COALESCE(v_oi.is_gift, false)
      AND (campaign_id IS NOT DISTINCT FROM v_oi.campaign_id)
    LIMIT 1;

    IF v_existing_oi_id IS NOT NULL THEN
      UPDATE public.order_items
      SET quantity = quantity + v_oi.quantity
      WHERE id = v_existing_oi_id;
      DELETE FROM public.order_items WHERE id = v_oi.id;
    ELSE
      UPDATE public.order_items
      SET product_id = v_target.id
      WHERE id = v_oi.id;
    END IF;
    v_moved_order_items := v_moved_order_items + 1;
  END LOOP;

  -- 3. Re-vincular movements y kardex_audit_logs
  UPDATE public.movements SET product_id = v_target.id WHERE product_id = v_source.id;
  GET DIAGNOSTICS v_moved_movements = ROW_COUNT;

  IF to_regclass('public.kardex_audit_logs') IS NOT NULL THEN
    UPDATE public.kardex_audit_logs SET product_id = v_target.id WHERE product_id = v_source.id;
  END IF;

  -- 4. Re-vincular ubicaciones físicas y conteos de inventario
  UPDATE public.product_locations
  SET product_id = v_target.id, sku = v_target.sku, updated_at = NOW()
  WHERE product_id = v_source.id;
  GET DIAGNOSTICS v_moved_locations = ROW_COUNT;

  UPDATE public.inventory_count_items
  SET product_id = v_target.id, sku = v_target.sku, updated_at = NOW()
  WHERE product_id = v_source.id;
  GET DIAGNOSTICS v_moved_counts = ROW_COUNT;

  -- 5. Re-vincular stock_transfer_items (respetando UNIQUE(transfer_id, product_id))
  IF to_regclass('public.stock_transfer_items') IS NOT NULL THEN
    FOR v_sti IN
      SELECT * FROM public.stock_transfer_items WHERE product_id = v_source.id
    LOOP
      SELECT id INTO v_existing_sti_id
      FROM public.stock_transfer_items
      WHERE transfer_id = v_sti.transfer_id AND product_id = v_target.id
      LIMIT 1;

      IF v_existing_sti_id IS NOT NULL THEN
        UPDATE public.stock_transfer_items
        SET quantity_requested = quantity_requested + v_sti.quantity_requested,
            quantity_sent = quantity_sent + v_sti.quantity_sent,
            quantity_received = quantity_received + v_sti.quantity_received,
            quantity_returned_origin = quantity_returned_origin + v_sti.quantity_returned_origin,
            updated_at = NOW()
        WHERE id = v_existing_sti_id;
        DELETE FROM public.stock_transfer_items WHERE id = v_sti.id;
      ELSE
        UPDATE public.stock_transfer_items
        SET product_id = v_target.id, sku = v_target.sku, updated_at = NOW()
        WHERE id = v_sti.id;
      END IF;
      v_moved_transfers := v_moved_transfers + 1;
    END LOOP;
  END IF;

  -- 6. Re-vincular product_pack_items (evitando auto-referencias y violaciones de UNIQUE) y pack_audit_logs
  DELETE FROM public.product_pack_items
  WHERE (pack_product_id = v_source.id AND member_product_id = v_target.id)
     OR (pack_product_id = v_target.id AND member_product_id = v_source.id);

  FOR v_pack_rel IN
    SELECT * FROM public.product_pack_items WHERE pack_product_id = v_source.id
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.product_pack_items
      WHERE pack_product_id = v_target.id AND member_product_id = v_pack_rel.member_product_id
    ) THEN
      UPDATE public.product_pack_items
      SET quantity = quantity + v_pack_rel.quantity
      WHERE pack_product_id = v_target.id AND member_product_id = v_pack_rel.member_product_id;
      DELETE FROM public.product_pack_items WHERE id = v_pack_rel.id;
    ELSE
      UPDATE public.product_pack_items SET pack_product_id = v_target.id WHERE id = v_pack_rel.id;
    END IF;
  END LOOP;

  FOR v_pack_rel IN
    SELECT * FROM public.product_pack_items WHERE member_product_id = v_source.id
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.product_pack_items
      WHERE pack_product_id = v_pack_rel.pack_product_id AND member_product_id = v_target.id
    ) THEN
      UPDATE public.product_pack_items
      SET quantity = quantity + v_pack_rel.quantity
      WHERE pack_product_id = v_pack_rel.pack_product_id AND member_product_id = v_target.id;
      DELETE FROM public.product_pack_items WHERE id = v_pack_rel.id;
    ELSE
      UPDATE public.product_pack_items SET member_product_id = v_target.id WHERE id = v_pack_rel.id;
    END IF;
  END LOOP;

  IF to_regclass('public.pack_audit_logs') IS NOT NULL THEN
    UPDATE public.pack_audit_logs SET pack_product_id = v_target.id WHERE pack_product_id = v_source.id;
  END IF;

  -- 7. Actualizar referencias por texto en campaigns (gift_sku y trigger_skus)
  IF to_regclass('public.campaigns') IS NOT NULL THEN
    UPDATE public.campaigns
    SET gift_sku = v_target.sku
    WHERE LOWER(TRIM(comercio)) = LOWER(TRIM(v_target.comercio))
      AND UPPER(REGEXP_REPLACE(TRIM(gift_sku), '\s+', '', 'g')) = UPPER(REGEXP_REPLACE(TRIM(v_source.sku), '\s+', '', 'g'));

    UPDATE public.campaigns
    SET trigger_skus = ARRAY(
      SELECT DISTINCT
        CASE
          WHEN UPPER(REGEXP_REPLACE(TRIM(s), '\s+', '', 'g')) = UPPER(REGEXP_REPLACE(TRIM(v_source.sku), '\s+', '', 'g'))
          THEN v_target.sku
          ELSE s
        END
      FROM unnest(trigger_skus) AS s
    )
    WHERE LOWER(TRIM(comercio)) = LOWER(TRIM(v_target.comercio))
      AND trigger_skus IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM unnest(trigger_skus) AS s
        WHERE UPPER(REGEXP_REPLACE(TRIM(s), '\s+', '', 'g')) = UPPER(REGEXP_REPLACE(TRIM(v_source.sku), '\s+', '', 'g'))
      );
  END IF;

  -- 8. Consolidar inventario por bodega (sumando físico, cuarentena, traslados y tránsito)
  FOR v_inv IN
    SELECT * FROM public.inventory WHERE product_id = v_source.id
  LOOP
    SELECT * INTO v_target_inv
    FROM public.inventory
    WHERE product_id = v_target.id AND warehouse_id = v_inv.warehouse_id
    LIMIT 1;

    IF v_target_inv.id IS NOT NULL THEN
      UPDATE public.inventory
      SET quantity = COALESCE(quantity, 0) + COALESCE(v_inv.quantity, 0),
          quarantine_quantity = COALESCE(quarantine_quantity, 0) + COALESCE(v_inv.quarantine_quantity, 0),
          transfer_reserved_quantity = COALESCE(transfer_reserved_quantity, 0) + COALESCE(v_inv.transfer_reserved_quantity, 0),
          in_transit_quantity = COALESCE(in_transit_quantity, 0) + COALESCE(v_inv.in_transit_quantity, 0),
          updated_at = NOW()
      WHERE id = v_target_inv.id;

      DELETE FROM public.inventory WHERE id = v_inv.id;
    ELSE
      UPDATE public.inventory
      SET product_id = v_target.id, updated_at = NOW()
      WHERE id = v_inv.id;
    END IF;
    v_merged_warehouses := v_merged_warehouses + 1;
  END LOOP;

  -- 8b. Recalcular committed_quantity y reserved_quantity exactos para v_target en todas sus bodegas
  FOR v_wh IN
    SELECT id, warehouse_id FROM public.inventory WHERE product_id = v_target.id
  LOOP
    IF COALESCE(v_target.is_virtual, false) THEN
      v_calc_committed := 0;
      v_calc_reserved := 0;
    ELSE
      SELECT COALESCE(SUM(oi.quantity), 0)::INTEGER INTO v_calc_committed
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE oi.product_id = v_target.id
        AND oi.warehouse_id = v_wh.warehouse_id
        AND COALESCE(o.estado_wms, 'En procesamiento') NOT IN ('En preparación', 'Pickeado', 'Listo para retiro', 'Despachado', 'Entregado', 'Retirado', 'Cancelado', 'Archivado')
        AND public.should_process_order_stock(o.id);

      SELECT COALESCE(SUM(oi.quantity), 0)::INTEGER INTO v_calc_reserved
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE oi.product_id = v_target.id
        AND oi.warehouse_id = v_wh.warehouse_id
        AND o.estado_wms IN ('En preparación', 'Pickeado', 'Listo para retiro')
        AND public.should_process_order_stock(o.id);
    END IF;

    UPDATE public.inventory
    SET committed_quantity = v_calc_committed,
        reserved_quantity = v_calc_reserved,
        updated_at = NOW()
    WHERE id = v_wh.id;
  END LOOP;

  -- 9. Re-apuntar equivalencias existentes que apuntaban a v_source hacia v_target (evitar cadenas rotas)
  UPDATE public.sku_equivalences
  SET master_product_id = v_target.id,
      master_sku = v_target.sku,
      updated_at = NOW()
  WHERE master_product_id = v_source.id
     OR (
       LOWER(TRIM(comercio)) = LOWER(TRIM(v_target.comercio))
       AND UPPER(REGEXP_REPLACE(TRIM(master_sku), '\s+', '', 'g')) = UPPER(REGEXP_REPLACE(TRIM(v_source.sku), '\s+', '', 'g'))
     );
  GET DIAGNOSTICS v_repointed_equivalences = ROW_COUNT;

  -- 10. Consolidar atributos físicos/operativos faltantes en v_target (preservando códigos de barras previos como alternativos)
  v_merged_options := COALESCE(v_target.options, '{}'::jsonb);
  v_src_barcode := NULLIF(TRIM(COALESCE(v_source.barcode, '')), '');
  v_tgt_barcode := NULLIF(TRIM(COALESCE(v_target.barcode, '')), '');
  IF v_src_barcode IS NOT NULL AND v_tgt_barcode IS NOT NULL AND UPPER(v_src_barcode) <> UPPER(v_tgt_barcode) THEN
    v_alt_barcodes := COALESCE(v_merged_options->'alternate_barcodes', '[]'::jsonb);
    IF jsonb_typeof(v_alt_barcodes) <> 'array' THEN
      v_alt_barcodes := '[]'::jsonb;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_alt_barcodes) AS elem
      WHERE UPPER(TRIM(elem)) = UPPER(v_src_barcode)
    ) THEN
      v_alt_barcodes := v_alt_barcodes || to_jsonb(v_src_barcode);
      v_merged_options := jsonb_set(v_merged_options, '{alternate_barcodes}', v_alt_barcodes, true);
    END IF;
  END IF;

  UPDATE public.products
  SET name = COALESCE(NULLIF(TRIM(v_target.name), ''), v_source.name),
      alias = COALESCE(NULLIF(TRIM(v_target.alias), ''), NULLIF(TRIM(v_source.alias), ''), CASE WHEN v_source.name IS DISTINCT FROM v_target.name THEN v_source.name ELSE NULL END),
      image_url = COALESCE(NULLIF(TRIM(v_target.image_url), ''), v_source.image_url),
      price = CASE WHEN COALESCE(v_target.price, 0) > 0 THEN v_target.price ELSE COALESCE(v_source.price, 0) END,
      barcode = COALESCE(v_tgt_barcode, v_src_barcode),
      barcode_wms = COALESCE(NULLIF(TRIM(v_target.barcode_wms), ''), NULLIF(TRIM(v_source.barcode_wms), '')),
      shopify_product_id = COALESCE(v_target.shopify_product_id, v_source.shopify_product_id),
      shopify_variant_id = COALESCE(v_target.shopify_variant_id, v_source.shopify_variant_id),
      meli_item_id = COALESCE(v_target.meli_item_id, v_source.meli_item_id),
      meli_variation_id = COALESCE(v_target.meli_variation_id, v_source.meli_variation_id),
      length = COALESCE(NULLIF(v_target.length, 0), v_source.length),
      width = COALESCE(NULLIF(v_target.width, 0), v_source.width),
      height = COALESCE(NULLIF(v_target.height, 0), v_source.height),
      largo = COALESCE(NULLIF(v_target.largo, 0), v_source.largo),
      ancho = COALESCE(NULLIF(v_target.ancho, 0), v_source.ancho),
      alto = COALESCE(NULLIF(v_target.alto, 0), v_source.alto),
      volumen = COALESCE(NULLIF(v_target.volumen, 0), v_source.volumen),
      weight = COALESCE(NULLIF(v_target.weight, 0), v_source.weight),
      options = v_merged_options
  WHERE id = v_target.id;

  -- 11. Eliminar el producto duplicado (ahora con 0 stock, 0 pedidos, 0 movimientos, 0 packs y 0 equivalencias entrantes)
  DELETE FROM public.products WHERE id = v_source.id;

  -- 12. Registrar la equivalencia source_sku -> target_sku (con master_product_id y multiplicador)
  INSERT INTO public.sku_equivalences (comercio, platform, platform_sku, master_sku, master_product_id, quantity_multiplier)
  VALUES (v_target.comercio, v_platform, v_source.sku, v_target.sku, v_target.id, v_mult)
  ON CONFLICT (comercio, platform, platform_sku) DO UPDATE
  SET master_sku = EXCLUDED.master_sku,
      master_product_id = EXCLUDED.master_product_id,
      quantity_multiplier = EXCLUDED.quantity_multiplier,
      updated_at = NOW();

  RETURN jsonb_build_object(
    'ok', true,
    'comercio', v_target.comercio,
    'source_sku', v_source.sku,
    'target_sku', v_target.sku,
    'target_product_id', v_target.id,
    'platform', v_platform,
    'quantity_multiplier', v_mult,
    'moved_order_items', v_moved_order_items,
    'moved_movements', v_moved_movements,
    'moved_locations', v_moved_locations,
    'moved_counts', v_moved_counts,
    'moved_transfers', v_moved_transfers,
    'merged_warehouses', v_merged_warehouses,
    'repointed_equivalences', v_repointed_equivalences
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_duplicate_products(TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_products(TEXT, TEXT, TEXT, TEXT, INTEGER) TO authenticated, service_role;


-- ==============================================================================
-- 5. ACTIVAR PILOTO FASE 2 PARA 'HIT GAMING'
-- ==============================================================================
-- Se habilita catalog_v2_enabled = true para HIT GAMING (Bandeja Unificada + Catálogo Agnóstico).
-- catalog_strict_orders se mantiene en false hasta finalizar el saneamiento de sus SKUs y equivalencias.
UPDATE public.comercios_adicional_config
SET catalog_v2_enabled = true
WHERE LOWER(TRIM(comercio)) = 'hit gaming';

COMMIT;
