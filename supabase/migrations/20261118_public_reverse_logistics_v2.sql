-- =========================================================================================
-- WMS STOCKA - MIGRACIÓN INTEGRAL: SISTEMA PÚBLICO DE LOGÍSTICA INVERSA 360° (RMA v2)
-- Fecha: 2026-11-18
-- Incluye:
--   1. Buckets de Storage (reverse-logistics-media privado + reverse-portal-guides público)
--   2. Tabla seller_return_portal_configs (White-Label, Reglas y Constructor Dinámico Form Builder)
--   3. Tablas aisladas de Autenticación OTP para Compradores (buyer_otp_challenges, buyer_portal_sessions)
--   4. Extensión de inventory (quarantine_quantity), orders (hold_reason), order_items (precios/fotos)
--   5. Evolución retrocompatible de reverse_logistics (RMA v2, estados, multimedia, finanzas, canales)
--   6. Saneamiento del trigger handle_reverse_logistics_to_entregado_func y should_process_order_stock
--   7. RPC público seguro get_public_return_portal_config para carga instantánea de tema/formulario
-- =========================================================================================

-- =========================================================================================
-- 1. STORAGE BUCKETS PARA EVIDENCIAS MULTIMEDIA (FOTOS/VIDEOS) Y GUÍAS DE REFERENCIA
-- =========================================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'reverse-logistics-media',
  'reverse-logistics-media',
  FALSE,
  47185920, -- 45 MB máx por archivo (videos cortos MP4/MOV/WebM y fotos)
  ARRAY[
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif',
    'video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp', 'video/x-m4v',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'reverse-portal-guides',
  'reverse-portal-guides',
  TRUE,
  10485760, -- 10 MB máx para imágenes guía del seller
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public = TRUE,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Políticas Storage para reverse-portal-guides
DROP POLICY IF EXISTS "Lectura publica guias logistica inversa" ON storage.objects;
CREATE POLICY "Lectura publica guias logistica inversa" ON storage.objects
  FOR SELECT USING (bucket_id = 'reverse-portal-guides');

DROP POLICY IF EXISTS "Usuarios autenticados suben guias logistica inversa" ON storage.objects;
CREATE POLICY "Usuarios autenticados suben guias logistica inversa" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'reverse-portal-guides');

DROP POLICY IF EXISTS "Usuarios autenticados actualizan guias logistica inversa" ON storage.objects;
CREATE POLICY "Usuarios autenticados actualizan guias logistica inversa" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'reverse-portal-guides');

DROP POLICY IF EXISTS "Usuarios autenticados eliminan guias logistica inversa" ON storage.objects;
CREATE POLICY "Usuarios autenticados eliminan guias logistica inversa" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'reverse-portal-guides');

-- Políticas Storage para reverse-logistics-media (lectura autenticada para sellers/admins en WMS; subida de compradores vía Signed URL de service_role)
DROP POLICY IF EXISTS "Autenticados leen evidencias reverse logistics" ON storage.objects;
CREATE POLICY "Autenticados leen evidencias reverse logistics" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'reverse-logistics-media');

DROP POLICY IF EXISTS "Autenticados suben evidencias reverse logistics" ON storage.objects;
CREATE POLICY "Autenticados suben evidencias reverse logistics" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'reverse-logistics-media');


-- =========================================================================================
-- 2. SECUENCIA Y GENERADOR DE FOLIOS RMA (Ej: RMA-2026-0001)
-- =========================================================================================
CREATE SEQUENCE IF NOT EXISTS public.rma_number_seq START WITH 1001 INCREMENT BY 1;

CREATE OR REPLACE FUNCTION public.generate_next_rma_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq BIGINT;
  v_year TEXT;
BEGIN
  v_seq := nextval('public.rma_number_seq');
  v_year := EXTRACT(YEAR FROM NOW() AT TIME ZONE 'America/Santiago')::TEXT;
  RETURN 'RMA-' || v_year || '-' || LPAD(v_seq::TEXT, 4, '0');
END;
$$;


-- =========================================================================================
-- 3. TABLA DE CONFIGURACIÓN DEL PORTAL Y FORM BUILDER POR SELLER (seller_return_portal_configs)
-- =========================================================================================
CREATE TABLE IF NOT EXISTS public.seller_return_portal_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comercio TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,

  -- Identidad Visual / White-Label
  brand_name TEXT,
  logo_url TEXT,
  primary_color TEXT NOT NULL DEFAULT '#5c24ff',
  background_color TEXT NOT NULL DEFAULT 'transparent',
  hero_title TEXT NOT NULL DEFAULT 'Cambios y Devoluciones',
  hero_subtitle TEXT NOT NULL DEFAULT 'Gestiona el cambio o devolución de tus productos de forma simple y segura.',
  policy_summary_text TEXT,
  support_wa TEXT,
  support_email TEXT,

  -- Reglas de Resolución y Elegibilidad
  enable_exchanges BOOLEAN NOT NULL DEFAULT TRUE,
  enable_returns BOOLEAN NOT NULL DEFAULT TRUE,
  enable_store_credit BOOLEAN NOT NULL DEFAULT FALSE, -- Opcional a criterio del seller
  store_credit_bonus_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  return_window_days INTEGER NOT NULL DEFAULT 10,
  exchange_window_days INTEGER NOT NULL DEFAULT 30,
  require_delivered_status BOOLEAN NOT NULL DEFAULT FALSE,
  allow_even_variant_exchange BOOLEAN NOT NULL DEFAULT TRUE,
  allow_catalog_exchange BOOLEAN NOT NULL DEFAULT TRUE,
  excluded_skus JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Motivos Personalizables y Constructor Dinámico de Formulario (Form Builder)
  custom_reasons JSONB NOT NULL DEFAULT '[
    {"id": "talla_pequena", "label": "La talla me quedó pequeña", "applies_to": ["exchange", "return", "store_credit"], "is_fault": false, "active": true},
    {"id": "talla_grande", "label": "La talla me quedó grande", "applies_to": ["exchange", "return", "store_credit"], "is_fault": false, "active": true},
    {"id": "cambio_modelo_color", "label": "Prefiero otro color o modelo", "applies_to": ["exchange", "store_credit"], "is_fault": false, "active": true},
    {"id": "no_esperado", "label": "No era lo que esperaba / Retracto", "applies_to": ["exchange", "return", "store_credit"], "is_fault": false, "active": true},
    {"id": "falla_producto", "label": "Producto presenta falla o defecto de fábrica", "applies_to": ["exchange", "return", "store_credit"], "is_fault": true, "active": true},
    {"id": "producto_incorrecto", "label": "Recibí un producto distinto al comprado", "applies_to": ["exchange", "return", "store_credit"], "is_fault": true, "active": true}
  ]'::jsonb,

  form_schema JSONB NOT NULL DEFAULT '[
    {
      "id": "fld_default_photo_estado",
      "type": "photo_upload",
      "scope": "per_item",
      "label": "Fotos del estado actual del producto",
      "instructions": "Sube entre 1 y 3 fotos nítidas donde se aprecie el producto completo, su empaque y etiqueta original.",
      "reference_image_url": "",
      "required": true,
      "min_files": 1,
      "max_files": 3,
      "max_mb": 15,
      "options": [],
      "show_when": {
        "resolution_types": ["exchange", "return", "store_credit"],
        "reason_ids": []
      }
    },
    {
      "id": "fld_default_video_falla",
      "type": "video_upload",
      "scope": "per_item",
      "label": "Video corto mostrando el detalle o falla",
      "instructions": "Si tu producto presenta un desperfecto, graba un video breve (máx. 30 seg) mostrando claramente el problema.",
      "reference_image_url": "",
      "required": false,
      "min_files": 0,
      "max_files": 1,
      "max_mb": 35,
      "options": [],
      "show_when": {
        "resolution_types": ["exchange", "return", "store_credit"],
        "reason_ids": ["falla_producto", "producto_incorrecto"]
      }
    },
    {
      "id": "fld_default_condicion_chk",
      "type": "checkbox_confirm",
      "scope": "per_request",
      "label": "Declaración de estado para recepción en bodega",
      "instructions": "Confirmo que los productos enviados cumplen con las políticas de cambio/devolución de la tienda (sin uso indebido y correctamente embalados para transporte).",
      "reference_image_url": "",
      "required": true,
      "options": [],
      "show_when": {
        "resolution_types": ["exchange", "return", "store_credit"],
        "reason_ids": []
      }
    },
    {
      "id": "fld_default_bank_refund",
      "type": "bank_details_cl",
      "scope": "per_request",
      "label": "Datos bancarios de respaldo para reembolso",
      "instructions": "En caso de que tu medio de pago original requiera devolución vía transferencia electrónica, indícanos la cuenta del titular.",
      "reference_image_url": "",
      "required": true,
      "options": [],
      "show_when": {
        "resolution_types": ["return"],
        "reason_ids": []
      }
    }
  ]'::jsonb,

  -- Medios Logísticos y Tarifas (Sucursal Ñuñoa exclusiva como sucursal física Stocka)
  enabled_methods JSONB NOT NULL DEFAULT '{
    "sucursal_nunoa": true,
    "rm_simultaneous_swap": true,
    "rm_pickup": true,
    "regiones_courier": true,
    "user_own_shipping": true
  }'::jsonb,
  rm_shipping_fee_clp INTEGER NOT NULL DEFAULT 3500,
  rm_swap_fee_clp INTEGER NOT NULL DEFAULT 4500,
  regiones_fee_mode TEXT NOT NULL DEFAULT 'table_rate', -- 'table_rate' o 'flat_rate'
  regiones_flat_fee_clp INTEGER NOT NULL DEFAULT 5990,
  free_shipping_on_fault BOOLEAN NOT NULL DEFAULT TRUE,
  auto_generate_enviame_label BOOLEAN NOT NULL DEFAULT TRUE,

  -- Gestión de Cobro de Diferencias por el Seller
  payment_instructions TEXT,
  payment_link_url TEXT,

  -- Sincronización Opcional con Canales de Venta (Shopify / WooCommerce)
  channel_sync_mode TEXT NOT NULL DEFAULT 'ask_on_approve', -- 'none', 'ask_on_approve', 'auto_on_approve'
  shopify_create_return BOOLEAN NOT NULL DEFAULT TRUE,
  shopify_create_exchange_order BOOLEAN NOT NULL DEFAULT FALSE,
  woocommerce_create_refund BOOLEAN NOT NULL DEFAULT TRUE,
  woocommerce_create_replacement_order BOOLEAN NOT NULL DEFAULT FALSE,
  woocommerce_add_order_notes BOOLEAN NOT NULL DEFAULT TRUE,

  reservation_ttl_days INTEGER NOT NULL DEFAULT 7,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seller_return_portal_slug ON public.seller_return_portal_configs(LOWER(slug));
CREATE INDEX IF NOT EXISTS idx_seller_return_portal_comercio ON public.seller_return_portal_configs(LOWER(comercio));

ALTER TABLE public.seller_return_portal_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Sellers y Admins leen config portal reversa" ON public.seller_return_portal_configs;
CREATE POLICY "Sellers y Admins leen config portal reversa" ON public.seller_return_portal_configs
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role = 'admin'
          OR LOWER(COALESCE(p.comercio, '')) = 'all'
          OR LOWER(TRIM(seller_return_portal_configs.comercio)) = ANY (
            SELECT TRIM(LOWER(tok)) FROM unnest(string_to_array(COALESCE(p.comercio, ''), ',')) AS tok
          )
        )
    )
  );

DROP POLICY IF EXISTS "Sellers y Admins insertan config portal reversa" ON public.seller_return_portal_configs;
CREATE POLICY "Sellers y Admins insertan config portal reversa" ON public.seller_return_portal_configs
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role = 'admin'
          OR LOWER(COALESCE(p.comercio, '')) = 'all'
          OR LOWER(TRIM(seller_return_portal_configs.comercio)) = ANY (
            SELECT TRIM(LOWER(tok)) FROM unnest(string_to_array(COALESCE(p.comercio, ''), ',')) AS tok
          )
        )
    )
  );

DROP POLICY IF EXISTS "Sellers y Admins actualizan config portal reversa" ON public.seller_return_portal_configs;
CREATE POLICY "Sellers y Admins actualizan config portal reversa" ON public.seller_return_portal_configs
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role = 'admin'
          OR LOWER(COALESCE(p.comercio, '')) = 'all'
          OR LOWER(TRIM(seller_return_portal_configs.comercio)) = ANY (
            SELECT TRIM(LOWER(tok)) FROM unnest(string_to_array(COALESCE(p.comercio, ''), ',')) AS tok
          )
        )
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role = 'admin'
          OR LOWER(COALESCE(p.comercio, '')) = 'all'
          OR LOWER(TRIM(seller_return_portal_configs.comercio)) = ANY (
            SELECT TRIM(LOWER(tok)) FROM unnest(string_to_array(COALESCE(p.comercio, ''), ',')) AS tok
          )
        )
    )
  );


-- =========================================================================================
-- 4. TABLAS AISLADAS DE AUTENTICACIÓN OTP Y SESIONES DEL COMPRADOR
--    (100% separadas de auth.users para jamás disparar on_auth_user_created en profiles)
-- =========================================================================================
CREATE TABLE IF NOT EXISTS public.buyer_otp_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  scope_comercio TEXT, -- NULL si inició en Portal Global Multimarca Stocka
  otp_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  ip_address TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_buyer_otp_email_created ON public.buyer_otp_challenges(LOWER(email), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_buyer_otp_ip_created ON public.buyer_otp_challenges(ip_address, created_at DESC);

ALTER TABLE public.buyer_otp_challenges ENABLE ROW LEVEL SECURITY;
-- Sin políticas para anon ni authenticated: acceso exclusivo vía service_role en Edge Functions.

CREATE TABLE IF NOT EXISTS public.buyer_portal_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  scope_comercio TEXT, -- Si tiene valor, restringe todas las consultas estrictamente a ese comercio
  ip_address TEXT,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_buyer_sessions_token_hash ON public.buyer_portal_sessions(session_token_hash);
CREATE INDEX IF NOT EXISTS idx_buyer_sessions_email ON public.buyer_portal_sessions(LOWER(email));

ALTER TABLE public.buyer_portal_sessions ENABLE ROW LEVEL SECURITY;
-- Sin políticas para anon ni authenticated: acceso exclusivo vía service_role en Edge Functions.


-- =========================================================================================
-- 5. EXTENSIÓN DE TABLAS CORE: inventory, orders, order_items y reverse_logistics
-- =========================================================================================

-- 5.1 Stock en cuarentena / merma de logística inversa (separado de stock vendible quantity)
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS quarantine_quantity INTEGER NOT NULL DEFAULT 0;

-- 5.2 Motivo de retención en orders (ej: 'awaiting_return_receipt', 'awaiting_buyer_payment')
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS hold_reason TEXT;

-- 5.3 Precios pagados reales e imagen en order_items
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS effective_unit_price NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 5.4 Columnas RMA v2 en reverse_logistics (100% retrocompatible con UI existente)
ALTER TABLE public.reverse_logistics
  ADD COLUMN IF NOT EXISTS rma_number TEXT,
  ADD COLUMN IF NOT EXISTS portal_origin TEXT DEFAULT 'wms_internal',
  ADD COLUMN IF NOT EXISTS workflow_status TEXT DEFAULT 'pendiente',
  ADD COLUMN IF NOT EXISTS resolution_type TEXT,
  ADD COLUMN IF NOT EXISTS return_items JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS exchange_items JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS form_schema_snapshot JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS request_form_answers JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS financial_summary JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS payment_receipt_url TEXT,
  ADD COLUMN IF NOT EXISTS payment_confirmed_by TEXT,
  ADD COLUMN IF NOT EXISTS payment_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_notes TEXT,
  ADD COLUMN IF NOT EXISTS logistics_option TEXT,
  ADD COLUMN IF NOT EXISTS inbound_courier TEXT,
  ADD COLUMN IF NOT EXISTS inbound_tracking_number TEXT,
  ADD COLUMN IF NOT EXISTS inbound_tracking_url TEXT,
  ADD COLUMN IF NOT EXISTS inbound_label_url TEXT,
  ADD COLUMN IF NOT EXISTS inbound_enviame_id TEXT,
  ADD COLUMN IF NOT EXISTS qr_branch_token TEXT,
  ADD COLUMN IF NOT EXISTS replacement_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inventory_restocked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS channel_sync_options JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS channel_sync_result JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS seller_reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS seller_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS seller_notes TEXT,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS qc_inspected_by TEXT,
  ADD COLUMN IF NOT EXISTS qc_inspected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qc_notes TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_reverse_logistics_rma_number ON public.reverse_logistics(rma_number) WHERE rma_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reverse_logistics_customer_email ON public.reverse_logistics(LOWER(customer_email));
CREATE INDEX IF NOT EXISTS idx_reverse_logistics_origen_order ON public.reverse_logistics(origen_order_id) WHERE origen_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reverse_logistics_replacement_order ON public.reverse_logistics(replacement_order_id) WHERE replacement_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reverse_logistics_workflow_status ON public.reverse_logistics(workflow_status);
CREATE INDEX IF NOT EXISTS idx_orders_customer_email_lower ON public.orders(LOWER(TRIM(customer_email)));


-- =========================================================================================
-- 6. CORRECCIÓN DE should_process_order_stock Y handle_reverse_logistics_to_entregado_func
-- =========================================================================================

-- 6.1 Asegurar que órdenes de reemplazo aprobadas (force_wms_stock_control) procesen su reserva/descuento limpiamente
CREATE OR REPLACE FUNCTION public.should_process_order_stock(p_order_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_order RECORD;
  v_config RECORD;
  v_platform TEXT;
  v_start_config JSONB;
  v_start_order_num TEXT;
  v_include BOOLEAN;
  v_start_ts TIMESTAMP WITH TIME ZONE;
  v_start_order_id UUID;
  v_start_val BIGINT;
  v_order_val BIGINT;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Regla Logística Inversa: Devoluciones entrantes NUNCA descuentan ni comprometen stock de salida
  IF v_order.origen = 'Logística Inversa' AND (
     COALESCE(v_order.raw_shopify_data->>'rl_type', '') = 'DEVOLUCION'
     OR COALESCE(v_order.raw_shopify_data->>'no_stock_deduction', 'false') = 'true'
     OR v_order.shipping_method ILIKE '%DEVOLUCION%'
  ) THEN
    RETURN FALSE;
  END IF;

  -- Si es una orden de reemplazo de Logística Inversa v2 marcada explícitamente para control WMS
  IF v_order.origen = 'Logística Inversa'
     AND COALESCE(v_order.raw_shopify_data->>'force_wms_stock_control', 'false') = 'true' THEN
    RETURN TRUE;
  END IF;

  SELECT * INTO v_config FROM public.comercios_adicional_config WHERE comercio = v_order.comercio;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF NOT v_config.inventario_seguimiento THEN
    RETURN FALSE;
  END IF;

  IF v_config.inventario_inicio_pedidos IS NULL OR jsonb_typeof(v_config.inventario_inicio_pedidos) != 'object' THEN
    RETURN TRUE;
  END IF;

  v_platform := COALESCE(v_order.external_platform, 'Manual');
  v_start_config := v_config.inventario_inicio_pedidos->v_platform;

  IF v_start_config IS NULL OR v_start_config = 'null'::jsonb THEN
    RETURN TRUE;
  END IF;

  v_start_order_num := v_start_config->>'external_order_number';
  v_include := COALESCE((v_start_config->>'incluir')::BOOLEAN, TRUE);

  IF v_start_order_num IS NOT NULL AND v_start_order_num != '' THEN
    SELECT id, created_at INTO v_start_order_id, v_start_ts
    FROM public.orders
    WHERE comercio = v_order.comercio
      AND COALESCE(external_platform, 'Manual') = v_platform
      AND external_order_number = v_start_order_num
    LIMIT 1;

    IF v_start_ts IS NOT NULL THEN
      IF v_include THEN
        RETURN v_order.created_at >= v_start_ts;
      ELSE
        IF v_order.id = v_start_order_id OR v_order.external_order_number = v_start_order_num THEN
          RETURN FALSE;
        END IF;
        RETURN v_order.created_at > v_start_ts;
      END IF;
    ELSE
      v_start_val := regexp_replace(v_start_order_num, '[^0-9]', '', 'g')::BIGINT;
      v_order_val := regexp_replace(v_order.external_order_number, '[^0-9]', '', 'g')::BIGINT;

      IF v_start_val IS NULL OR v_order_val IS NULL THEN
        IF v_include THEN
          RETURN v_order.external_order_number >= v_start_order_num;
        ELSE
          RETURN v_order.external_order_number > v_start_order_num;
        END IF;
      ELSE
        IF v_include THEN
          RETURN v_order_val >= v_start_val;
        ELSE
          RETURN v_order_val > v_start_val;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 6.2 Saneamiento integral del Trigger de Recepción de Logística Inversa:
--   - Soporta tanto return_items (v2) como productos (legacy: id_devuelto/qty_devuelto y product_id/cantidad)
--   - Reingresa unidades aptas a inventory.quantity + Kardex movements ('in') de forma idempotente (inventory_restocked)
--   - Contabiliza unidades dañadas/merma en inventory.quarantine_quantity sin inflar stock vendible
--   - NO cierra prematuramente órdenes de reemplazo en Cambios a Domicilio/Regiones; en su lugar libera su hold_reason
CREATE OR REPLACE FUNCTION public.handle_reverse_logistics_to_entregado_func()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_st TEXT := LOWER(TRIM(COALESCE(NEW.status, NEW.estado, '')));
  v_wf TEXT := LOWER(TRIM(COALESCE(NEW.workflow_status, '')));
  v_order public.orders;
  v_rep_order public.orders;
  v_target_wh UUID := '973da888-8a63-4790-a08f-919e1af41a93'; -- Matriz Ñuñoa
  v_items_source JSONB;
  v_elem JSONB;
  v_prod_id UUID;
  v_raw_id TEXT;
  v_sku TEXT;
  v_qty INT;
  v_restock BOOLEAN;
  v_ref_order_id UUID;
  v_ref_label TEXT;
BEGIN
  -- Activar solo cuando se confirma recepción física ('procesado' o estados post-recepción QC en v2)
  IF v_st <> 'procesado' AND v_wf NOT IN ('reemplazo_en_preparacion', 'completado') THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_automation_rule_enabled('auto-reverse-logistics-to-entregado') THEN
    RETURN NEW;
  END IF;

  IF NEW.wms_order_id IS NOT NULL THEN
    SELECT * INTO v_order FROM public.orders WHERE id = NEW.wms_order_id LIMIT 1;
  END IF;

  IF NEW.replacement_order_id IS NOT NULL THEN
    SELECT * INTO v_rep_order FROM public.orders WHERE id = NEW.replacement_order_id LIMIT 1;
  END IF;

  -- Resolver bodega receptora (por defecto Matriz Ñuñoa)
  IF COALESCE(NEW.sucursal, v_order.sucursal_pickeo) IS NOT NULL THEN
    SELECT id INTO v_target_wh
    FROM public.warehouses
    WHERE LOWER(name) LIKE '%' || LOWER(REPLACE(REPLACE(COALESCE(NEW.sucursal, v_order.sucursal_pickeo), 'Punto Físico ', ''), 'Sucursal ', '')) || '%'
    LIMIT 1;
    v_target_wh := COALESCE(v_target_wh, '973da888-8a63-4790-a08f-919e1af41a93');
  END IF;

  v_ref_order_id := COALESCE(NEW.wms_order_id, NEW.origen_order_id, NEW.replacement_order_id);
  v_ref_label := COALESCE(NEW.rma_number, NEW.referencia_pedido, v_order.external_order_number, 'RMA');

  -- A. Procesar reingreso a stock / cuarentena (y reconciliar si se editaron productos en un registro procesado)
  IF COALESCE(NEW.inventory_restocked, FALSE) IS FALSE
     OR (TG_OP = 'UPDATE' AND (OLD.productos IS DISTINCT FROM NEW.productos OR OLD.return_items IS DISTINCT FROM NEW.return_items)) THEN
    IF NEW.return_items IS NOT NULL AND jsonb_typeof(NEW.return_items) = 'array' AND jsonb_array_length(NEW.return_items) > 0 THEN
      v_items_source := NEW.return_items;
    ELSIF NEW.productos IS NOT NULL AND jsonb_typeof(NEW.productos) = 'array' THEN
      v_items_source := NEW.productos;
    ELSE
      v_items_source := '[]'::jsonb;
    END IF;

    FOR v_elem IN SELECT * FROM jsonb_array_elements(v_items_source) LOOP
      v_prod_id := NULL;
      v_raw_id := COALESCE(NULLIF(TRIM(v_elem->>'product_id'), ''), NULLIF(TRIM(v_elem->>'id_devuelto'), ''));
      IF v_raw_id IS NOT NULL AND v_raw_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        v_prod_id := v_raw_id::uuid;
      END IF;

      v_sku := NULLIF(TRIM(COALESCE(v_elem->>'sku', '')), '');
      -- Si viene en formato legacy "[SKU] Nombre" o "SKU - Nombre" en producto_devuelto
      IF v_prod_id IS NULL AND v_sku IS NULL AND (v_elem->>'producto_devuelto') IS NOT NULL THEN
        IF (v_elem->>'producto_devuelto') ~ '^\[([^\]]+)\]' THEN
          v_sku := SUBSTRING((v_elem->>'producto_devuelto') FROM '^\[([^\]]+)\]');
        ELSIF POSITION(' - ' IN (v_elem->>'producto_devuelto')) > 1 THEN
          v_sku := SPLIT_PART((v_elem->>'producto_devuelto'), ' - ', 1);
        END IF;
      END IF;

      IF v_prod_id IS NULL AND v_sku IS NOT NULL THEN
        SELECT id INTO v_prod_id
        FROM public.products
        WHERE sku = TRIM(v_sku)
          AND (NEW.comercio IS NULL OR LOWER(TRIM(comercio)) = LOWER(TRIM(NEW.comercio)))
        LIMIT 1;
      END IF;

      v_qty := COALESCE(
        NULLIF((v_elem->>'qty')::int, 0),
        NULLIF((v_elem->>'qty_devuelto')::int, 0),
        NULLIF((v_elem->>'cantidad')::int, 0),
        NULLIF((v_elem->>'quantity')::int, 0),
        0
      );

      -- En filas legacy de CAMBIO donde una fila solo tenía producto_reemplazo sin producto_devuelto, saltar
      IF v_prod_id IS NULL OR v_qty <= 0 THEN
        CONTINUE;
      END IF;

      v_restock := COALESCE(
        (v_elem->>'return_to_stock')::boolean,
        (v_elem->>'regresar_a_inventario')::boolean,
        TRUE
      );

      IF v_restock THEN
        IF v_ref_order_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.movements
          WHERE order_id = v_ref_order_id AND product_id = v_prod_id AND type = 'in'
        ) THEN
          IF EXISTS (SELECT 1 FROM public.inventory WHERE product_id = v_prod_id AND warehouse_id = v_target_wh) THEN
            UPDATE public.inventory
            SET quantity = COALESCE(quantity, 0) + v_qty,
                quarantine_quantity = CASE
                  WHEN COALESCE(NEW.inventory_restocked, FALSE) IS TRUE THEN GREATEST(0, COALESCE(quarantine_quantity, 0) - v_qty)
                  ELSE COALESCE(quarantine_quantity, 0)
                END,
                updated_at = NOW()
            WHERE product_id = v_prod_id AND warehouse_id = v_target_wh;
          ELSE
            INSERT INTO public.inventory (product_id, warehouse_id, quantity)
            VALUES (v_prod_id, v_target_wh, v_qty);
          END IF;

          INSERT INTO public.movements (product_id, warehouse_id, type, quantity, date, order_id, reference_doc)
          VALUES (
            v_prod_id,
            v_target_wh,
            'in',
            v_qty,
            NOW(),
            v_ref_order_id,
            COALESCE(NEW.tipo_movimiento, 'Devolución') || ' [' || v_ref_label || ']'
          );
        END IF;
      ELSE
        -- Si ya tenía un movimiento 'in' en Kardex porque antes estaba como regresar_a_inventario = true y ahora pasó a Merma: revertirlo
        IF v_ref_order_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.movements
          WHERE order_id = v_ref_order_id AND product_id = v_prod_id AND type = 'in'
        ) THEN
          DELETE FROM public.movements
          WHERE order_id = v_ref_order_id AND product_id = v_prod_id AND type = 'in';

          UPDATE public.inventory
          SET quantity = GREATEST(0, COALESCE(quantity, 0) - v_qty),
              quarantine_quantity = COALESCE(quarantine_quantity, 0) + v_qty,
              updated_at = NOW()
          WHERE product_id = v_prod_id AND warehouse_id = v_target_wh;
        ELSIF COALESCE(NEW.inventory_restocked, FALSE) IS FALSE THEN
          -- Producto marcado como Merma / Dañado desde el inicio -> suma a quarantine_quantity (no disponible para venta)
          IF EXISTS (SELECT 1 FROM public.inventory WHERE product_id = v_prod_id AND warehouse_id = v_target_wh) THEN
            UPDATE public.inventory
            SET quarantine_quantity = COALESCE(quarantine_quantity, 0) + v_qty,
                updated_at = NOW()
            WHERE product_id = v_prod_id AND warehouse_id = v_target_wh;
          ELSE
            INSERT INTO public.inventory (product_id, warehouse_id, quantity, quarantine_quantity)
            VALUES (v_prod_id, v_target_wh, 0, v_qty);
          END IF;
        END IF;
      END IF;
    END LOOP;

    -- Marcar inventory_restocked = true sin causar recursión infinita
    IF COALESCE(NEW.inventory_restocked, FALSE) IS FALSE THEN
      UPDATE public.reverse_logistics
      SET inventory_restocked = TRUE,
          updated_at = NOW()
      WHERE id = NEW.id AND inventory_restocked = FALSE;
    END IF;
  END IF;

  -- B. Gestión inteligente de la Orden WMS vinculada:
  -- B1. Si existe replacement_order_id (orden de salida de reemplazo v2):
  IF v_rep_order.id IS NOT NULL THEN
    -- Si la orden de reemplazo estaba retenida esperando recepción del retorno (y el pago no está pendiente), liberarla a 'para procesar'
    IF v_rep_order.hold_reason = 'awaiting_return_receipt'
       AND COALESCE(NEW.payment_status, 'not_required') IN ('not_required', 'paid', 'waived')
       AND COALESCE(v_rep_order.estado_wms, '') NOT IN ('Listo para retiro', 'Despachado', 'Entregado', 'Cancelado', 'Archivado') THEN
      UPDATE public.orders
      SET hold_reason = NULL,
          status = CASE WHEN status = 'en espera' THEN 'para procesar' ELSE status END
      WHERE id = v_rep_order.id;
    END IF;
  END IF;

  -- B2. Si existe wms_order_id (orden de devolución entrante, o cambio presencial en sucursal):
  IF v_order.id IS NOT NULL AND (v_rep_order.id IS NULL OR v_order.id <> v_rep_order.id) THEN
    -- Solo cerrar automáticamente en 'Entregado' si es DEVOLUCION o si es un CAMBIO presencial en sucursal ya entregado en mesón
    IF COALESCE(NEW.tipo_movimiento, 'DEVOLUCION') = 'DEVOLUCION'
       OR COALESCE(NEW.modo_entrega, '') = 'sucursal'
       OR COALESCE(NEW.logistics_option, '') = 'sucursal_nunoa' THEN
      IF COALESCE(v_order.estado_wms, '') NOT IN ('Entregado', 'Cancelado', 'Archivado') THEN
        PERFORM set_config('app.physical_carrier_transition', 'true', true);

        UPDATE public.orders
        SET
          estado_wms = 'Entregado',
          status = 'entregado',
          hold_reason = NULL,
          stock_descontado = TRUE,
          stock_descontado_at = COALESCE(stock_descontado_at, NOW()),
          transport_status_normalized = 'ENTREGADO',
          delivered_at = COALESCE(delivered_at, NOW()),
          closed_at = NOW(),
          closed_by_automation = 'auto-reverse-logistics-to-entregado'
        WHERE id = v_order.id;

        PERFORM public.log_automation_execution(
          'auto-reverse-logistics-to-entregado',
          v_order.id,
          v_order.external_order_number,
          v_order.comercio,
          COALESCE(v_order.estado_wms, 'En procesamiento'),
          'Entregado',
          'reverse_logistics',
          'Logística Inversa recepcionada y procesada en bodega (' || v_ref_label || ')',
          FALSE
        );
      END IF;
    ELSIF v_order.hold_reason = 'awaiting_return_receipt' THEN
      UPDATE public.orders
      SET hold_reason = NULL,
          status = CASE WHEN status = 'en espera' THEN 'para procesar' ELSE status END
      WHERE id = v_order.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_reverse_logistics_to_entregado ON public.reverse_logistics;
CREATE TRIGGER trg_auto_reverse_logistics_to_entregado
  AFTER INSERT OR UPDATE ON public.reverse_logistics
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_reverse_logistics_to_entregado_func();


-- =========================================================================================
-- 7. RPC PÚBLICO SEGURO: get_public_return_portal_config
--    Devuelve únicamente el branding, textos, motivos y esquema de formulario de un comercio
--    por slug o nombre (o configuración global de Stocka si no se especifica comercio).
-- =========================================================================================
CREATE OR REPLACE FUNCTION public.get_public_return_portal_config(
  p_comercio_or_slug TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key TEXT := LOWER(TRIM(COALESCE(p_comercio_or_slug, '')));
  v_cfg public.seller_return_portal_configs;
  v_tw_desc TEXT;
  v_tw_json JSONB := '{}'::jsonb;
  v_matched_comercio TEXT;
BEGIN
  IF v_key = '' THEN
    RETURN jsonb_build_object(
      'mode', 'stocka_global',
      'is_enabled', TRUE,
      'comercio', NULL,
      'slug', NULL,
      'brand_name', 'Stocka Logistics',
      'logo_url', '',
      'primary_color', '#5c24ff',
      'background_color', '#f8fafc',
      'hero_title', 'Centro de Cambios y Devoluciones',
      'hero_subtitle', 'Ingresa con tu correo para gestionar cambios o devoluciones en cualquiera de nuestras tiendas adheridas.',
      'sucursal_info', jsonb_build_object(
        'name', 'Punto STOCKA Ñuñoa',
        'address', 'Av. Campo de Deportes 405, Ñuñoa, Región Metropolitana',
        'hours', 'Lunes a Viernes de 10:30 a 17:00 hrs · Sábado 10:30 a 14:00 hrs'
      )
    );
  END IF;

  SELECT * INTO v_cfg
  FROM public.seller_return_portal_configs
  WHERE LOWER(TRIM(slug)) = v_key
     OR LOWER(TRIM(comercio)) = v_key
  LIMIT 1;

  IF v_cfg.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'mode', 'seller',
      'is_enabled', v_cfg.is_enabled,
      'comercio', v_cfg.comercio,
      'slug', v_cfg.slug,
      'brand_name', COALESCE(NULLIF(TRIM(v_cfg.brand_name), ''), v_cfg.comercio),
      'logo_url', COALESCE(v_cfg.logo_url, ''),
      'primary_color', COALESCE(v_cfg.primary_color, '#5c24ff'),
      'background_color', COALESCE(v_cfg.background_color, 'transparent'),
      'hero_title', COALESCE(v_cfg.hero_title, 'Cambios y Devoluciones'),
      'hero_subtitle', COALESCE(v_cfg.hero_subtitle, ''),
      'policy_summary_text', COALESCE(v_cfg.policy_summary_text, ''),
      'support_wa', COALESCE(v_cfg.support_wa, ''),
      'support_email', COALESCE(v_cfg.support_email, ''),
      'enable_exchanges', v_cfg.enable_exchanges,
      'enable_returns', v_cfg.enable_returns,
      'enable_store_credit', v_cfg.enable_store_credit,
      'store_credit_bonus_pct', v_cfg.store_credit_bonus_pct,
      'return_window_days', v_cfg.return_window_days,
      'exchange_window_days', v_cfg.exchange_window_days,
      'allow_even_variant_exchange', v_cfg.allow_even_variant_exchange,
      'allow_catalog_exchange', v_cfg.allow_catalog_exchange,
      'custom_reasons', v_cfg.custom_reasons,
      'form_schema', v_cfg.form_schema,
      'enabled_methods', v_cfg.enabled_methods,
      'payment_instructions', COALESCE(v_cfg.payment_instructions, ''),
      'payment_link_url', COALESCE(v_cfg.payment_link_url, ''),
      'sucursal_info', jsonb_build_object(
        'name', 'Punto STOCKA Ñuñoa',
        'address', 'Av. Campo de Deportes 405, Ñuñoa, Región Metropolitana',
        'hours', 'Lunes a Viernes de 10:30 a 17:00 hrs · Sábado 10:30 a 14:00 hrs'
      )
    );
  END IF;

  -- Fallback inteligente: si el comercio aún no guarda configuración de reversa, heredar su tema del Tracking Widget si existe
  SELECT DISTINCT comercio INTO v_matched_comercio
  FROM public.orders
  WHERE LOWER(TRIM(comercio)) = v_key
     OR LOWER(REGEXP_REPLACE(TRIM(comercio), '[^a-zA-Z0-9]+', '-', 'g')) = v_key
  LIMIT 1;

  IF v_matched_comercio IS NULL THEN
    SELECT comercio INTO v_matched_comercio
    FROM public.comercios_adicional_config
    WHERE LOWER(TRIM(comercio)) = v_key
       OR LOWER(REGEXP_REPLACE(TRIM(comercio), '[^a-zA-Z0-9]+', '-', 'g')) = v_key
    LIMIT 1;
  END IF;

  IF v_matched_comercio IS NOT NULL THEN
    BEGIN
      SELECT description INTO v_tw_desc
      FROM public.qr_codes
      WHERE type = 'system_badge' AND LOWER(TRIM(title)) = LOWER(TRIM(v_matched_comercio)) AND status = 'active'
      LIMIT 1;
      IF v_tw_desc IS NOT NULL THEN
        v_tw_json := v_tw_desc::jsonb;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_tw_json := '{}'::jsonb;
    END;

    RETURN jsonb_build_object(
      'mode', 'seller',
      'is_enabled', TRUE,
      'comercio', v_matched_comercio,
      'slug', LOWER(REGEXP_REPLACE(TRIM(v_matched_comercio), '[^a-zA-Z0-9]+', '-', 'g')),
      'brand_name', COALESCE(NULLIF(TRIM(v_tw_json->>'brand_name'), ''), v_matched_comercio),
      'logo_url', COALESCE(v_tw_json->>'logo_url', ''),
      'primary_color', COALESCE(v_tw_json->>'primary_color', '#5c24ff'),
      'background_color', COALESCE(v_tw_json->>'background_color', 'transparent'),
      'hero_title', 'Cambios y Devoluciones',
      'hero_subtitle', 'Gestiona el cambio o devolución de tus compras en ' || v_matched_comercio || '.',
      'policy_summary_text', '',
      'support_wa', COALESCE(v_tw_json->>'support_wa', ''),
      'support_email', COALESCE(v_tw_json->>'support_email', ''),
      'enable_exchanges', TRUE,
      'enable_returns', TRUE,
      'enable_store_credit', FALSE,
      'store_credit_bonus_pct', 0,
      'return_window_days', 10,
      'exchange_window_days', 30,
      'allow_even_variant_exchange', TRUE,
      'allow_catalog_exchange', TRUE,
      'custom_reasons', '[
        {"id": "talla_pequena", "label": "La talla me quedó pequeña", "applies_to": ["exchange", "return", "store_credit"], "is_fault": false, "active": true},
        {"id": "talla_grande", "label": "La talla me quedó grande", "applies_to": ["exchange", "return", "store_credit"], "is_fault": false, "active": true},
        {"id": "cambio_modelo_color", "label": "Prefiero otro color o modelo", "applies_to": ["exchange", "store_credit"], "is_fault": false, "active": true},
        {"id": "no_esperado", "label": "No era lo que esperaba / Retracto", "applies_to": ["exchange", "return", "store_credit"], "is_fault": false, "active": true},
        {"id": "falla_producto", "label": "Producto presenta falla o defecto de fábrica", "applies_to": ["exchange", "return", "store_credit"], "is_fault": true, "active": true},
        {"id": "producto_incorrecto", "label": "Recibí un producto distinto al comprado", "applies_to": ["exchange", "return", "store_credit"], "is_fault": true, "active": true}
      ]'::jsonb,
      'form_schema', '[
        {
          "id": "fld_default_photo_estado",
          "type": "photo_upload",
          "scope": "per_item",
          "label": "Fotos del estado actual del producto",
          "instructions": "Sube entre 1 y 3 fotos nítidas donde se aprecie el producto completo, su empaque y etiqueta original.",
          "reference_image_url": "",
          "required": true,
          "min_files": 1,
          "max_files": 3,
          "max_mb": 15,
          "options": [],
          "show_when": { "resolution_types": ["exchange", "return", "store_credit"], "reason_ids": [] }
        },
        {
          "id": "fld_default_condicion_chk",
          "type": "checkbox_confirm",
          "scope": "per_request",
          "label": "Declaración de estado del producto",
          "instructions": "Confirmo que el producto se encuentra sin uso indebido y debidamente protegido para su recepción.",
          "reference_image_url": "",
          "required": true,
          "options": [],
          "show_when": { "resolution_types": ["exchange", "return", "store_credit"], "reason_ids": [] }
        }
      ]'::jsonb,
      'enabled_methods', '{"sucursal_nunoa": true, "rm_simultaneous_swap": true, "rm_pickup": true, "regiones_courier": true, "user_own_shipping": true}'::jsonb,
      'payment_instructions', '',
      'payment_link_url', '',
      'sucursal_info', jsonb_build_object(
        'name', 'Punto STOCKA Ñuñoa',
        'address', 'Av. Campo de Deportes 405, Ñuñoa, Región Metropolitana',
        'hours', 'Lunes a Viernes de 10:30 a 17:00 hrs · Sábado 10:30 a 14:00 hrs'
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'mode', 'not_found',
    'is_enabled', FALSE,
    'error', 'Tienda no encontrada'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_return_portal_config(TEXT) TO anon, authenticated, service_role;


-- =========================================================================================
-- 8. TABLA DE COBERTURA Y TARIFAS POR COMUNA (RM FLOTA STOCKA X Y REGIONES MULTICOURIER)
-- =========================================================================================
CREATE TABLE IF NOT EXISTS public.shipping_coverage_rates (
  comuna_key TEXT PRIMARY KEY,
  region TEXT NOT NULL,
  comuna TEXT NOT NULL,
  is_rm_stocka_fleet BOOLEAN NOT NULL DEFAULT FALSE,
  transit_days JSONB NOT NULL DEFAULT '{}'::jsonb,
  rates JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.shipping_coverage_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura publica tarifas cobertura" ON public.shipping_coverage_rates;
CREATE POLICY "Lectura publica tarifas cobertura" ON public.shipping_coverage_rates
  FOR SELECT USING (true);

-- Permisos explícitos de tabla para PostgREST y recarga de caché de esquema
GRANT SELECT, INSERT, UPDATE ON public.seller_return_portal_configs TO authenticated, service_role;
GRANT ALL ON public.buyer_otp_challenges TO service_role;
GRANT ALL ON public.buyer_portal_sessions TO service_role;
GRANT SELECT ON public.shipping_coverage_rates TO anon, authenticated, service_role;
GRANT ALL ON public.shipping_coverage_rates TO service_role;

NOTIFY pgrst, 'reload schema';
