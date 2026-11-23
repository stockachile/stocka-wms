-- ==============================================================================
-- WMS STOCKA - FASE 1: BLINDAJE DE CATÁLOGO, GOBERNANZA Y FLAGS DE TRANSICIÓN
-- ==============================================================================
-- Contenido:
--   1. Flags por comercio en comercios_adicional_config (catalog_v2_enabled, catalog_strict_orders)
--      para habilitar migración ordenada comercio por comercio (piloto: HIT GAMING).
--   2. Cierre de DELETE de clientes sobre public.products + trigger anti-borrado destructivo
--      cuando el SKU posee inventario, movimientos de kardex, packs o pedidos asociados.
--   3. Triggers BEFORE INSERT / BEFORE UPDATE en public.products para bloquear modificación
--      de campos operativos/financieros por rol client (SKU, medidas, volumen, peso,
--      barcode_wms, flags de Picker, is_virtual, estado, metadatos crudos de integración).
--   4. Trigger BEFORE UPDATE en public.merchant_integrations para impedir que clientes
--      alteren is_main (Plataforma Principal).
--   5. Integridad de sku_equivalences:
--      - Validación y canonización automática de master_sku contra public.products.
--      - Propagación en cascada cuando un Admin renombra products.sku.
--   6. Protección del trigger expand_pack_order_items() para no descartar ítems si un pack
--      no tiene componentes configurados.
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- 1. FLAGS DE TRANSICIÓN POR COMERCIO EN comercios_adicional_config
-- ==============================================================================
ALTER TABLE public.comercios_adicional_config
  ADD COLUMN IF NOT EXISTS catalog_v2_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS catalog_strict_orders BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.comercios_adicional_config.catalog_v2_enabled IS
  'Habilita el nuevo sistema de Catálogo Maestro Agnóstico y Bandeja Unificada de Canales (Fase 2) para este comercio.';
COMMENT ON COLUMN public.comercios_adicional_config.catalog_strict_orders IS
  'Si es true, pedidos con SKUs no mapeados entran en cuarentena en lugar de auto-crear productos en public.products (Fase 3).';


-- ==============================================================================
-- 2. RESTRICCIÓN DE DELETE EN public.products (RLS + TRIGGER ANTI-DESTRUCCIÓN)
-- ==============================================================================
-- Revocar permiso de eliminación directa a clientes
DROP POLICY IF EXISTS "Clientes pueden eliminar sus propios productos" ON public.products;

-- Asegurar política explícita de DELETE solo para administradores
DROP POLICY IF EXISTS "Admins pueden eliminar productos" ON public.products;
CREATE POLICY "Admins pueden eliminar productos" ON public.products
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- Trigger BEFORE DELETE: impedir borrado físico si el SKU tiene historial operativo o stock
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
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.inventory
    WHERE product_id = OLD.id
      AND (
        COALESCE(quantity, 0) <> 0
        OR COALESCE(committed_quantity, 0) <> 0
        OR COALESCE(reserved_quantity, 0) <> 0
      )
  ) INTO v_has_stock;

  IF v_has_stock THEN
    RAISE EXCEPTION 'No se puede eliminar el producto "%" porque tiene stock físico, comprometido o reservado. Cambia su estado a "Archivado" en su lugar.', OLD.sku;
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

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_destructive_product_delete ON public.products;
CREATE TRIGGER trg_prevent_destructive_product_delete
  BEFORE DELETE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_destructive_product_delete();


-- ==============================================================================
-- 3. PROTECCIÓN DE COLUMNAS SENSIBLES DE public.products PARA ROL CLIENTE
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.protect_products_sensitive_columns_on_client_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF COALESCE(auth.role(), '') = 'authenticated' AND auth.uid() IS NOT NULL THEN
    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();

    IF COALESCE(v_role, '') NOT IN ('admin', 'operario', 'picker', 'supervisor') AND NOT public.is_admin() THEN
      -- Identidad y pertenencia inmutables para sellers
      NEW.merchant_id := OLD.merchant_id;
      NEW.comercio := OLD.comercio;
      NEW.sku := OLD.sku;
      NEW.created_at := OLD.created_at;
      NEW.status := OLD.status;

      -- Medidas, volumen y peso (impactan cobro de almacenaje y couriers)
      NEW.length := OLD.length;
      NEW.width := OLD.width;
      NEW.height := OLD.height;
      NEW.largo := OLD.largo;
      NEW.ancho := OLD.ancho;
      NEW.alto := OLD.alto;
      NEW.volumen := OLD.volumen;
      NEW.weight := OLD.weight;

      -- Parámetros operativos de bodega / Picker / control de stock
      NEW.barcode_wms := OLD.barcode_wms;
      NEW.send_barcode_wms_to_picker := OLD.send_barcode_wms_to_picker;
      NEW.send_barcode_to_picker := OLD.send_barcode_to_picker;
      NEW.picking_match_strict := OLD.picking_match_strict;
      NEW.is_virtual := OLD.is_virtual;

      -- Referencias crudas de integraciones externas
      NEW.shopify_product_id := OLD.shopify_product_id;
      NEW.shopify_variant_id := OLD.shopify_variant_id;
      NEW.shopify_stock := OLD.shopify_stock;
      NEW.raw_shopify_data := OLD.raw_shopify_data;
      NEW.meli_item_id := OLD.meli_item_id;
      NEW.meli_variation_id := OLD.meli_variation_id;
      NEW.raw_meli_data := OLD.raw_meli_data;
      NEW.raw_falabella_data := OLD.raw_falabella_data;
      NEW.raw_paris_data := OLD.raw_paris_data;
      NEW.raw_ripley_data := OLD.raw_ripley_data;
      NEW.woocommerce_product_id := OLD.woocommerce_product_id;
      NEW.woocommerce_variation_id := OLD.woocommerce_variation_id;
      NEW.raw_woocommerce_data := OLD.raw_woocommerce_data;
      NEW.jumpseller_product_id := OLD.jumpseller_product_id;
      NEW.jumpseller_variant_id := OLD.jumpseller_variant_id;
      NEW.raw_jumpseller_data := OLD.raw_jumpseller_data;
      NEW.raw_walmart_data := OLD.raw_walmart_data;
      NEW.tiendanube_product_id := OLD.tiendanube_product_id;
      NEW.tiendanube_variant_id := OLD.tiendanube_variant_id;
      NEW.raw_tiendanube_data := OLD.raw_tiendanube_data;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_products_sensitive_columns_update ON public.products;
CREATE TRIGGER trg_protect_products_sensitive_columns_update
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_products_sensitive_columns_on_client_update();

-- Sanitización al insertar producto desde portal cliente (sin permitir inyectar medidas/volumen/CBAR/virtual)
CREATE OR REPLACE FUNCTION public.protect_products_sensitive_columns_on_client_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF COALESCE(auth.role(), '') = 'authenticated' AND auth.uid() IS NOT NULL THEN
    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();

    IF COALESCE(v_role, '') NOT IN ('admin', 'operario', 'picker', 'supervisor') AND NOT public.is_admin() THEN
      NEW.sku := TRIM(COALESCE(NEW.sku, ''));
      NEW.status := 'active';
      NEW.is_virtual := FALSE;
      NEW.length := NULL;
      NEW.width := NULL;
      NEW.height := NULL;
      NEW.largo := NULL;
      NEW.ancho := NULL;
      NEW.alto := NULL;
      NEW.volumen := NULL;
      NEW.weight := NULL;
      NEW.barcode_wms := NULL;
      NEW.send_barcode_wms_to_picker := TRUE;
      NEW.send_barcode_to_picker := FALSE;
      NEW.picking_match_strict := FALSE;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_products_sensitive_columns_insert ON public.products;
CREATE TRIGGER trg_protect_products_sensitive_columns_insert
  BEFORE INSERT ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_products_sensitive_columns_on_client_insert();


-- ==============================================================================
-- 4. PROTECCIÓN DE merchant_integrations.is_main PARA ROL CLIENTE
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.protect_merchant_integrations_is_main()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF COALESCE(auth.role(), '') = 'authenticated' AND auth.uid() IS NOT NULL THEN
    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();

    IF COALESCE(v_role, '') NOT IN ('admin', 'operario', 'picker', 'supervisor') AND NOT public.is_admin() THEN
      NEW.is_main := OLD.is_main;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_merchant_integrations_is_main ON public.merchant_integrations;
CREATE TRIGGER trg_protect_merchant_integrations_is_main
  BEFORE UPDATE ON public.merchant_integrations
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_merchant_integrations_is_main();


-- ==============================================================================
-- 5. INTEGRIDAD DE sku_equivalences (VALIDACIÓN + CASCADA AL RENOMBRAR SKU)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.validate_and_normalize_sku_equivalence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical_master_sku TEXT;
BEGIN
  NEW.comercio := TRIM(COALESCE(NEW.comercio, ''));
  NEW.platform := TRIM(COALESCE(NEW.platform, ''));
  NEW.platform_sku := TRIM(COALESCE(NEW.platform_sku, ''));
  NEW.master_sku := TRIM(COALESCE(NEW.master_sku, ''));

  IF NEW.platform_sku = '' OR NEW.master_sku = '' THEN
    RAISE EXCEPTION 'Tanto el SKU externo (platform_sku) como el SKU maestro (master_sku) son obligatorios.';
  END IF;

  -- Validar que el master_sku exista en el catálogo maestro del comercio y canonizar su escritura exacta
  SELECT p.sku INTO v_canonical_master_sku
  FROM public.products p
  WHERE LOWER(TRIM(p.comercio)) = LOWER(NEW.comercio)
    AND UPPER(REGEXP_REPLACE(TRIM(p.sku), '\s+', '', 'g')) = UPPER(REGEXP_REPLACE(NEW.master_sku, '\s+', '', 'g'))
  ORDER BY (p.sku = NEW.master_sku) DESC, (p.barcode_wms IS NOT NULL) DESC, p.created_at ASC
  LIMIT 1;

  IF v_canonical_master_sku IS NULL THEN
    RAISE EXCEPTION 'El SKU maestro "%" no existe en el Catálogo Master de "%". Crea o selecciona un SKU maestro válido antes de guardar la equivalencia.', NEW.master_sku, NEW.comercio;
  END IF;

  NEW.master_sku := v_canonical_master_sku;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_and_normalize_sku_equivalence ON public.sku_equivalences;
CREATE TRIGGER trg_validate_and_normalize_sku_equivalence
  BEFORE INSERT OR UPDATE ON public.sku_equivalences
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_and_normalize_sku_equivalence();

-- Propagar en cascada cuando un Admin renombra el SKU de un producto maestro
CREATE OR REPLACE FUNCTION public.sync_sku_equivalences_on_master_sku_rename()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.sku IS DISTINCT FROM NEW.sku AND TRIM(COALESCE(NEW.sku, '')) <> '' THEN
    UPDATE public.sku_equivalences
    SET master_sku = NEW.sku
    WHERE LOWER(TRIM(comercio)) = LOWER(TRIM(NEW.comercio))
      AND UPPER(REGEXP_REPLACE(TRIM(master_sku), '\s+', '', 'g')) = UPPER(REGEXP_REPLACE(TRIM(OLD.sku), '\s+', '', 'g'));
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
-- 6. PROTECCIÓN DEL TRIGGER expand_pack_order_items() ANTE PACKS SIN COMPONENTES
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.expand_pack_order_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pack_member RECORD;
  is_product_pack BOOLEAN;
  v_pack_comp_count INTEGER := 0;
  v_existing_id UUID;
BEGIN
  -- Si es un regalo de campaña, consolidar únicamente si ya existe una fila para la MISMA campaña
  IF COALESCE(NEW.is_gift, FALSE) = TRUE OR NEW.campaign_id IS NOT NULL OR COALESCE(NEW.tag, '') = 'Campaña' THEN
    IF NEW.campaign_id IS NOT NULL THEN
      SELECT id INTO v_existing_id
      FROM public.order_items
      WHERE order_id = NEW.order_id
        AND product_id = NEW.product_id
        AND campaign_id = NEW.campaign_id
      LIMIT 1;

      IF v_existing_id IS NOT NULL THEN
        UPDATE public.order_items
        SET quantity = NEW.quantity,
            is_picking_request = COALESCE(NEW.is_picking_request, is_picking_request, FALSE)
        WHERE id = v_existing_id;
        RETURN NULL;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- Verificar si el producto que se está insertando es un pack
  SELECT is_pack INTO is_product_pack
  FROM public.products
  WHERE id = NEW.product_id;

  IF is_product_pack = TRUE THEN
    -- Verificar que el pack tenga al menos 1 componente configurado antes de expandir
    SELECT COUNT(*) INTO v_pack_comp_count
    FROM public.product_pack_items
    WHERE pack_product_id = NEW.product_id;

    IF v_pack_comp_count > 0 THEN
      FOR pack_member IN
        SELECT member_product_id, quantity
        FROM public.product_pack_items
        WHERE pack_product_id = NEW.product_id
      LOOP
        SELECT id INTO v_existing_id
        FROM public.order_items
        WHERE order_id = NEW.order_id
          AND product_id = pack_member.member_product_id
          AND (warehouse_id IS NOT DISTINCT FROM NEW.warehouse_id)
          AND COALESCE(is_gift, FALSE) = FALSE
          AND campaign_id IS NULL
        LIMIT 1;

        IF v_existing_id IS NOT NULL THEN
          UPDATE public.order_items
          SET quantity = quantity + (NEW.quantity * pack_member.quantity)
          WHERE id = v_existing_id;
        ELSE
          INSERT INTO public.order_items (order_id, product_id, warehouse_id, quantity)
          VALUES (NEW.order_id, pack_member.member_product_id, NEW.warehouse_id, NEW.quantity * pack_member.quantity);
        END IF;
      END LOOP;

      -- Cancelar inserción del producto pack una vez expandidos sus componentes
      RETURN NULL;
    END IF;
    -- Si el pack tiene 0 componentes configurados, conservar la línea del pack en el pedido
    -- en vez de descartar silenciosamente el ítem.
  END IF;

  -- Si no es un pack (o es un pack sin componentes), consolidar si ya existía fila regular para el mismo producto y bodega
  SELECT id INTO v_existing_id
  FROM public.order_items
  WHERE order_id = NEW.order_id
    AND product_id = NEW.product_id
    AND (warehouse_id IS NOT DISTINCT FROM NEW.warehouse_id)
    AND COALESCE(is_gift, FALSE) = FALSE
    AND campaign_id IS NULL
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.order_items
    SET quantity = quantity + NEW.quantity
    WHERE id = v_existing_id;
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
