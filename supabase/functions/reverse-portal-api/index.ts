import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false }
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-buyer-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normKey(s: string): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ñ/g, "n")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ");
}

function sanitizePathSegment(s: string): string {
  return String(s || "general")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]/g, "_")
    .slice(0, 48) || "general";
}

function getBaseModelKey(p: any): string {
  if (p?.shopify_product_id) return `shp_${p.shopify_product_id}`;
  if (p?.woocommerce_product_id) return `woo_${p.woocommerce_product_id}`;
  const rawName = String(p?.name || "").trim();
  const base = rawName.includes(" - ") ? rawName.split(" - ")[0].trim() : rawName;
  return `name_${normKey(base)}`;
}

async function requireBuyerSession(req: Request, body: any) {
  const rawToken = String(req.headers.get("x-buyer-session") || body?.session_token || "").trim();
  if (!rawToken) {
    throw { status: 401, message: "Sesión expirada. Por favor ingresa nuevamente con tu correo." };
  }
  const tokenHash = await sha256Hex(rawToken);
  const { data: sess } = await supabase
    .from("buyer_portal_sessions")
    .select("*")
    .eq("session_token_hash", tokenHash)
    .maybeSingle();

  if (!sess || sess.revoked_at || new Date(sess.expires_at).getTime() <= Date.now()) {
    throw { status: 401, message: "Tu sesión ha expirado por seguridad. Vuelve a validar tu correo." };
  }
  return sess;
}

async function loadEffectiveCommerceConfig(comercio: string) {
  const { data: rpcCfg } = await supabase.rpc("get_public_return_portal_config", {
    p_comercio_or_slug: comercio
  });
  // También consultar fila completa en seller_return_portal_configs para tarifas internas
  const { data: rowCfg } = await supabase
    .from("seller_return_portal_configs")
    .select("*")
    .ilike("comercio", comercio.trim())
    .maybeSingle();

  return {
    ...(rpcCfg || {}),
    rm_shipping_fee_clp: rowCfg?.rm_shipping_fee_clp ?? 3500,
    rm_swap_fee_clp: rowCfg?.rm_swap_fee_clp ?? 4500,
    regiones_fee_mode: rowCfg?.regiones_fee_mode ?? "table_rate",
    regiones_flat_fee_clp: rowCfg?.regiones_flat_fee_clp ?? 5990,
    free_shipping_on_fault: rowCfg?.free_shipping_on_fault ?? true,
    require_delivered_status: rowCfg?.require_delivered_status ?? false,
    excluded_skus: Array.isArray(rowCfg?.excluded_skus) ? rowCfg.excluded_skus : [],
    reservation_ttl_days: rowCfg?.reservation_ttl_days ?? 7
  };
}

function resolveOrderItemsWithPrices(
  order: any,
  dbOrderItems: any[],
  productsById: Map<string, any>,
  productsByCommSku: Map<string, any>,
  syncedByCommSku: Map<string, any>
) {
  const commLower = String(order.comercio || "").trim().toLowerCase();
  const rawShop = order.raw_shopify_data && typeof order.raw_shopify_data === "object" ? order.raw_shopify_data : null;
  const rawWoo = order.raw_woocommerce_data && typeof order.raw_woocommerce_data === "object" ? order.raw_woocommerce_data : null;

  const shopLineItems: any[] = Array.isArray(rawShop?.line_items) ? rawShop.line_items : [];
  const wooLineItems: any[] = Array.isArray(rawWoo?.line_items) ? rawWoo.line_items : [];

  function findRawPriceAndImage(sku: string, prod: any) {
    const skuClean = String(sku || "").trim().toLowerCase();
    const shpVarId = prod?.shopify_variant_id ? String(prod.shopify_variant_id) : "";
    const wooVarId = prod?.woocommerce_variation_id ? String(prod.woocommerce_variation_id) : "";
    const wooProdId = prod?.woocommerce_product_id ? String(prod.woocommerce_product_id) : "";

    // 1. Shopify raw line_items
    if (shopLineItems.length > 0) {
      const match = shopLineItems.find((li: any) => {
        const liSku = String(li.sku || "").trim().toLowerCase();
        const liVar = li.variant_id ? String(li.variant_id) : "";
        return (skuClean && liSku === skuClean) || (shpVarId && liVar === shpVarId) || (skuClean && liVar === skuClean);
      });
      if (match) {
        const qty = Math.max(1, Number(match.quantity) || 1);
        const gross = Math.round(parseFloat(match.price || "0") || 0);
        const totalDisc = Array.isArray(match.discount_allocations)
          ? match.discount_allocations.reduce((s: number, d: any) => s + (parseFloat(d.amount || "0") || 0), 0)
          : (parseFloat(match.total_discount || "0") || 0);
        const paid = Math.max(0, Math.round(gross - totalDisc / qty));
        return { gross_unit_price: gross, paid_unit_price: paid, raw_image: null, raw_title: match.name || match.title };
      }
    }

    // 2. WooCommerce raw line_items
    if (wooLineItems.length > 0) {
      const match = wooLineItems.find((li: any) => {
        const liSku = String(li.sku || "").trim().toLowerCase();
        const liVar = li.variation_id ? String(li.variation_id) : "";
        const liProd = li.product_id ? String(li.product_id) : "";
        return (skuClean && liSku === skuClean) || (wooVarId && liVar === wooVarId) || (wooProdId && liProd === wooProdId);
      });
      if (match) {
        const qty = Math.max(1, Number(match.quantity) || 1);
        const subtotal = (parseFloat(match.subtotal || "0") || 0) + (parseFloat(match.subtotal_tax || "0") || 0);
        const total = (parseFloat(match.total || "0") || 0) + (parseFloat(match.total_tax || "0") || 0);
        const gross = Math.round(subtotal / qty) || Math.round(parseFloat(match.price || "0") || 0);
        const paid = Math.max(0, Math.round(total / qty) || gross);
        const rawImg = match.image?.src || null;
        return { gross_unit_price: gross, paid_unit_price: paid, raw_image: rawImg, raw_title: match.name };
      }
    }

    return null;
  }

  const results: any[] = [];

  if (dbOrderItems && dbOrderItems.length > 0) {
    for (const oi of dbOrderItems) {
      if (oi.is_gift) continue;
      const prod = oi.product_id ? productsById.get(oi.product_id) : null;
      const sku = String(prod?.sku || "").trim();
      const synced = sku ? syncedByCommSku.get(`${commLower}::${sku.toLowerCase()}`) : null;
      const rawMatch = findRawPriceAndImage(sku, prod);

      const fallbackCatalogPrice = Math.round(Number(prod?.price || synced?.price || 0));
      const grossPrice = oi.unit_price != null
        ? Math.round(Number(oi.unit_price))
        : (rawMatch?.gross_unit_price ?? fallbackCatalogPrice);
      const paidPrice = oi.effective_unit_price != null
        ? Math.round(Number(oi.effective_unit_price))
        : (rawMatch?.paid_unit_price ?? grossPrice);

      const imageUrl = oi.image_url || prod?.image_url || synced?.image_url || rawMatch?.raw_image || "";

      results.push({
        order_item_id: oi.id,
        product_id: prod?.id || oi.product_id || null,
        sku: sku || "SIN-SKU",
        name: prod?.name || rawMatch?.raw_title || "Producto",
        image_url: imageUrl,
        talla: prod?.talla || "",
        color: prod?.color || "",
        variable_1: prod?.variable_1 || "",
        variable_2: prod?.variable_2 || "",
        weight_kg: Number(prod?.weight) > 0 ? Number(prod.weight) : 0.5,
        base_model_key: getBaseModelKey(prod || { name: rawMatch?.raw_title || "Producto" }),
        shopify_product_id: prod?.shopify_product_id || null,
        shopify_variant_id: prod?.shopify_variant_id || null,
        woocommerce_product_id: prod?.woocommerce_product_id || null,
        woocommerce_variation_id: prod?.woocommerce_variation_id || null,
        quantity: Math.max(1, Number(oi.quantity) || 1),
        gross_unit_price: grossPrice,
        paid_unit_price: paidPrice
      });
    }
  } else if (shopLineItems.length > 0 || wooLineItems.length > 0) {
    // Fallback para pedidos históricos sin filas en order_items
    const sourceLines = shopLineItems.length > 0 ? shopLineItems : wooLineItems;
    for (const li of sourceLines) {
      const qty = Math.max(0, Number(li.current_quantity ?? li.quantity ?? 0));
      if (qty <= 0) continue;
      const sku = String(li.sku || li.variant_id || li.variation_id || li.product_id || "").trim();
      const prod = sku ? productsByCommSku.get(`${commLower}::${sku.toLowerCase()}`) : null;
      const synced = sku ? syncedByCommSku.get(`${commLower}::${sku.toLowerCase()}`) : null;
      const rawMatch = findRawPriceAndImage(sku, prod);

      const fallbackCatalogPrice = Math.round(Number(prod?.price || synced?.price || li.price || 0));
      const grossPrice = rawMatch?.gross_unit_price ?? fallbackCatalogPrice;
      const paidPrice = rawMatch?.paid_unit_price ?? grossPrice;

      results.push({
        order_item_id: null,
        product_id: prod?.id || null,
        sku: prod?.sku || sku || "SIN-SKU",
        name: prod?.name || li.name || li.title || "Producto",
        image_url: prod?.image_url || synced?.image_url || li.image?.src || "",
        talla: prod?.talla || "",
        color: prod?.color || "",
        variable_1: prod?.variable_1 || "",
        variable_2: prod?.variable_2 || "",
        weight_kg: Number(prod?.weight) > 0 ? Number(prod.weight) : 0.5,
        base_model_key: getBaseModelKey(prod || { name: li.name || li.title || "Producto" }),
        shopify_product_id: prod?.shopify_product_id || null,
        shopify_variant_id: prod?.shopify_variant_id || (li.variant_id ? String(li.variant_id) : null),
        woocommerce_product_id: prod?.woocommerce_product_id || (li.product_id ? String(li.product_id) : null),
        woocommerce_variation_id: prod?.woocommerce_variation_id || (li.variation_id ? String(li.variation_id) : null),
        quantity: qty,
        gross_unit_price: grossPrice,
        paid_unit_price: paidPrice
      });
    }
  } else if (order.sku || order.item) {
    // Fallback para pedidos manuales planos
    const sku = String(order.sku || "").split(",")[0].trim();
    const prod = sku ? productsByCommSku.get(`${commLower}::${sku.toLowerCase()}`) : null;
    const synced = sku ? syncedByCommSku.get(`${commLower}::${sku.toLowerCase()}`) : null;
    const qty = Math.max(1, Number(order.cantidad) || 1);
    const unitVal = Number(order.total_value) > 0
      ? Math.round(Number(order.total_value) / qty)
      : Math.round(Number(prod?.price || synced?.price || 0));

    results.push({
      order_item_id: null,
      product_id: prod?.id || null,
      sku: prod?.sku || sku || "MANUAL",
      name: prod?.name || order.item || "Producto",
      image_url: prod?.image_url || synced?.image_url || "",
      talla: prod?.talla || "",
      color: prod?.color || "",
      variable_1: prod?.variable_1 || "",
      variable_2: prod?.variable_2 || "",
      weight_kg: Number(prod?.weight) > 0 ? Number(prod.weight) : 0.5,
      base_model_key: getBaseModelKey(prod || { name: order.item || "Producto" }),
      shopify_product_id: prod?.shopify_product_id || null,
      shopify_variant_id: prod?.shopify_variant_id || null,
      woocommerce_product_id: prod?.woocommerce_product_id || null,
      woocommerce_variation_id: prod?.woocommerce_variation_id || null,
      quantity: qty,
      gross_unit_price: unitVal,
      paid_unit_price: unitVal
    });
  }

  return results;
}

function getWeightBracket(weightKg: number): string {
  const w = Math.max(0.1, Number(weightKg) || 0.8);
  if (w <= 1) return "0-1";
  if (w <= 3) return "1-3";
  if (w <= 6) return "3-6";
  if (w <= 9) return "6-9";
  if (w <= 12) return "9-12";
  if (w <= 15) return "12-15";
  return "15-18";
}

function computeLogisticsOptionsForOrder(
  cfg: any,
  communeRow: any | null,
  resolutionType: string,
  hasFaultReason: boolean,
  totalWeightKg: number
) {
  const enabled = cfg.enabled_methods || {
    sucursal_nunoa: true,
    rm_simultaneous_swap: true,
    rm_pickup: true,
    regiones_courier: true,
    user_own_shipping: true
  };
  const isFreeByFault = Boolean(hasFaultReason && cfg.free_shipping_on_fault !== false);
  const isRmFleet = Boolean(communeRow?.is_rm_stocka_fleet);
  const options: any[] = [];

  // 1. Sucursal Stocka Ñuñoa (exclusiva según definición)
  if (enabled.sucursal_nunoa !== false) {
    options.push({
      id: "sucursal_nunoa",
      title: "En Sucursal Punto Stocka Ñuñoa",
      subtitle: "Av. Campo de Deportes 405, Ñuñoa · Entrega presencial con código QR/PIN",
      schedule: "Lunes a Viernes 10:30 a 17:00 hrs · Sábado 10:30 a 14:00 hrs",
      fee_clp: 0,
      couriers: ["STOCKA SUCURSAL ÑUÑOA"],
      badge: "Gratis · Atención Inmediata"
    });
  }

  // 2. Transporte RM Urbano (Flota Stocka X)
  if (communeRow && isRmFleet) {
    if (resolutionType === "exchange" && enabled.rm_simultaneous_swap !== false) {
      const fee = isFreeByFault ? 0 : Math.max(0, Number(cfg.rm_swap_fee_clp ?? cfg.rm_shipping_fee_clp ?? 4500));
      options.push({
        id: "rm_simultaneous_swap",
        title: "Cambio Simultáneo a Domicilio RM (Flota Stocka X)",
        subtitle: `Recibimos tu producto devuelto y te entregamos el cambio en la misma visita en ${communeRow.comuna}.`,
        schedule: "24 a 48 hrs hábiles tras aprobación",
        fee_clp: fee,
        couriers: ["STOCKA X"],
        badge: isFreeByFault ? "Gratis por garantía" : "1 sola visita puerta a puerta"
      });
    }
    if (enabled.rm_pickup !== false) {
      const fee = isFreeByFault ? 0 : Math.max(0, Number(cfg.rm_shipping_fee_clp ?? 3500));
      options.push({
        id: "rm_pickup",
        title: resolutionType === "exchange"
          ? "Retiro y Despacho RM en 2 Etapas (Stocka X)"
          : "Retiro a Domicilio RM (Flota Stocka X)",
        subtitle: `Retiramos el producto en tu dirección de ${communeRow.comuna} para ingreso e inspección en bodega.`,
        schedule: "Retiro en 24 a 48 hrs hábiles",
        fee_clp: fee,
        couriers: ["STOCKA X"],
        badge: isFreeByFault ? "Gratis por garantía" : "Cobertura RM Directa"
      });
    }
  }

  // 3. Transporte Regiones y RM Rural según cobertura de comuna
  if (communeRow && (!isRmFleet || enabled.regiones_courier !== false)) {
    if (!isRmFleet && enabled.regiones_courier !== false) {
      const bracket = getWeightBracket(totalWeightKg);
      const bracketRates = communeRow.rates?.[bracket] || communeRow.rates?.["0-1"] || {};
      const transit = communeRow.transit_days || {};

      const availableCouriers: { code: string; label: string; rate_net: number; transit_days: number | null }[] = [];
      if (bracketRates.bluexpress) {
        availableCouriers.push({
          code: "BLUEXPRESS",
          label: "Blue Express / Puntos Blue Copec",
          rate_net: Number(bracketRates.bluexpress),
          transit_days: transit.bluexpress || 3
        });
      }
      if (bracketRates.starken) {
        availableCouriers.push({
          code: "STARKEN",
          label: "Starken",
          rate_net: Number(bracketRates.starken),
          transit_days: transit.starken || 3
        });
      }
      if (bracketRates.chilexpress) {
        availableCouriers.push({
          code: "CHILEXPRESS",
          label: "Chilexpress",
          rate_net: Number(bracketRates.chilexpress),
          transit_days: transit.chilexpress || 2
        });
      }

      if (availableCouriers.length > 0) {
        availableCouriers.sort((a, b) => a.rate_net - b.rate_net);
        const minNet = availableCouriers[0].rate_net;
        // En cambio regional hay tramo retorno + tramo reenvío si lo asume el comprador, o tarifa plana del seller
        let baseFee = cfg.regiones_fee_mode === "flat_rate"
          ? Math.max(0, Number(cfg.regiones_flat_fee_clp ?? 5990))
          : Math.round(minNet * 1.19);
        if (resolutionType === "exchange" && cfg.regiones_fee_mode !== "flat_rate") {
          // Tarifa preferencial ida + vuelta o tramo único según configuración; usamos 1.6x del tramo simple para ida+vuelta competitivo
          baseFee = Math.round(minNet * 1.19 * 1.6);
        }
        const finalFee = isFreeByFault ? 0 : baseFee;

        options.push({
          id: "regiones_courier",
          title: `Transporte Courier a ${communeRow.comuna} (${communeRow.region})`,
          subtitle: `Cobertura validada vía ${availableCouriers.map((c) => c.label.split(" /")[0]).join(", ")}. Etiqueta de envío pre-generada tras aprobación.`,
          schedule: `Tránsito estimado: ${availableCouriers[0].transit_days || 3} días hábiles`,
          fee_clp: finalFee,
          couriers: availableCouriers.map((c) => c.code),
          courier_details: availableCouriers,
          badge: isFreeByFault ? "Gratis por garantía" : "Guía Digital / Puntos Drop-off"
        });
      }
    }
  }

  // 4. Transporte Propio del Usuario
  if (enabled.user_own_shipping !== false) {
    // Si es un cambio y el cliente envía por su cuenta el retorno, el reenvío puede requerir despacho si es región, o $0 si retira/coordina
    let returnOutboundFee = 0;
    if (resolutionType === "exchange" && communeRow && !isFreeByFault) {
      if (isRmFleet) {
        returnOutboundFee = Math.max(0, Number(cfg.rm_shipping_fee_clp ?? 3500));
      } else {
        const bracket = getWeightBracket(totalWeightKg);
        const bracketRates = communeRow.rates?.[bracket] || communeRow.rates?.["0-1"] || {};
        const candidates = [bracketRates.bluexpress, bracketRates.starken, bracketRates.chilexpress].filter(Boolean).map(Number);
        if (candidates.length > 0) {
          returnOutboundFee = cfg.regiones_fee_mode === "flat_rate"
            ? Math.max(0, Number(cfg.regiones_flat_fee_clp ?? 5990))
            : Math.round(Math.min(...candidates) * 1.19);
        }
      }
    }

    options.push({
      id: "user_own_shipping",
      title: "Transporte Propio del Comprador",
      subtitle: resolutionType === "exchange" && returnOutboundFee > 0
        ? "Envías el producto por tu cuenta (pagado en origen) hacia Bodega Stocka Ñuñoa; el monto indicado cubre el despacho de tu nuevo producto."
        : "Envías o entregas el paquete por tu cuenta (pagado en origen) hacia nuestra Bodega en Ñuñoa e ingresas el N° de seguimiento en este portal.",
      schedule: "Recepción Lunes a Viernes en Av. Campo de Deportes 405, Ñuñoa",
      fee_clp: returnOutboundFee,
      couriers: ["PROPIO DEL CLIENTE"],
      badge: "Libre elección de courier"
    });
  }

  return options;
}

async function signMediaPathIfNeeded(pathOrUrl: string | null | undefined): Promise<string> {
  if (!pathOrUrl) return "";
  const str = String(pathOrUrl).trim();
  if (!str) return "";
  if (str.startsWith("http://") || str.startsWith("https://")) return str;
  const { data } = await supabase.storage
    .from("reverse-logistics-media")
    .createSignedUrl(str, 3600);
  return data?.signedUrl || "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "").trim();

    // =========================================================================
    // 1. BOOTSTRAP PÚBLICO DEL PORTAL (TEMA + CONFIG + LISTA DE COMUNAS)
    // =========================================================================
    if (action === "get_portal_bootstrap") {
      const rawCommerceOrSlug = String(body.comercio_or_slug || body.comercio || "").trim();
      const { data: portalCfg } = await supabase.rpc("get_public_return_portal_config", {
        p_comercio_or_slug: rawCommerceOrSlug || null
      });

      const { data: communes } = await supabase
        .from("shipping_coverage_rates")
        .select("comuna_key, comuna, region, is_rm_stocka_fleet")
        .order("comuna", { ascending: true });

      return new Response(JSON.stringify({
        success: true,
        config: portalCfg,
        communes: communes || []
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Todas las acciones siguientes exigen sesión verificada por OTP
    const sess = await requireBuyerSession(req, body);

    // =========================================================================
    // 2. LISTAR COMPRAS E HISTORIAL RMA DEL COMPRADOR
    // =========================================================================
    if (action === "list_my_orders_and_rmas") {
      let ordersQuery = supabase
        .from("orders")
        .select("id, comercio, external_order_number, external_platform, origen, status, estado_wms, total_value, customer_name, customer_email, customer_phone, shipping_address, shipping_city, shipping_complement, courier, tracking_number, created_at, dispatched_at, delivered_at, raw_shopify_data, raw_woocommerce_data")
        .ilike("customer_email", sess.email)
        .neq("origen", "Logística Inversa")
        .neq("status", "cancelado")
        .neq("estado_wms", "Cancelado")
        .order("created_at", { ascending: false })
        .limit(50);

      if (sess.scope_comercio) {
        ordersQuery = ordersQuery.ilike("comercio", sess.scope_comercio);
      }

      const { data: rawOrders, error: ordErr } = await ordersQuery;
      if (ordErr) throw ordErr;

      let rmasQuery = supabase
        .from("reverse_logistics")
        .select("*")
        .ilike("customer_email", sess.email)
        .order("created_at", { ascending: false })
        .limit(50);

      if (sess.scope_comercio) {
        rmasQuery = rmasQuery.ilike("comercio", sess.scope_comercio);
      }

      const { data: rawRmas } = await rmasQuery;
      const rmasList = rawRmas || [];
      const ordersList = (rawOrders || []).filter((o: any) => !o.raw_shopify_data?.is_reverse_logistics);

      // Cargar order_items y productos en lote
      const orderIds = ordersList.map((o: any) => o.id);
      const orderItemsByOrder = new Map<string, any[]>();
      const productIdsSet = new Set<string>();
      const comerciosSet = new Set<string>();

      ordersList.forEach((o: any) => {
        if (o.comercio) comerciosSet.add(String(o.comercio).trim());
      });

      if (orderIds.length > 0) {
        const { data: ois } = await supabase
          .from("order_items")
          .select("id, order_id, product_id, quantity, is_gift, unit_price, discount_amount, effective_unit_price, image_url")
          .in("order_id", orderIds);

        (ois || []).forEach((oi: any) => {
          if (!orderItemsByOrder.has(oi.order_id)) orderItemsByOrder.set(oi.order_id, []);
          orderItemsByOrder.get(oi.order_id)!.push(oi);
          if (oi.product_id) productIdsSet.add(oi.product_id);
        });
      }

      const productsById = new Map<string, any>();
      const productsByCommSku = new Map<string, any>();
      const syncedByCommSku = new Map<string, any>();

      const comerciosArr = Array.from(comerciosSet);
      if (comerciosArr.length > 0) {
        const { data: prods } = await supabase
          .from("products")
          .select("id, comercio, sku, name, price, image_url, weight, talla, color, variable_1, variable_2, shopify_product_id, shopify_variant_id, woocommerce_product_id, woocommerce_variation_id")
          .in("comercio", comerciosArr);

        (prods || []).forEach((p: any) => {
          productsById.set(p.id, p);
          if (p.comercio && p.sku) {
            productsByCommSku.set(`${String(p.comercio).trim().toLowerCase()}::${String(p.sku).trim().toLowerCase()}`, p);
          }
        });

        const { data: synced } = await supabase
          .from("synced_products")
          .select("comercio, sku, price, image_url")
          .in("comercio", comerciosArr);

        (synced || []).forEach((sp: any) => {
          if (sp.comercio && sp.sku) {
            syncedByCommSku.set(`${String(sp.comercio).trim().toLowerCase()}::${String(sp.sku).trim().toLowerCase()}`, sp);
          }
        });
      }

      // Cargar configuraciones de portal por cada comercio presente
      const commerceConfigsMap = new Map<string, any>();
      for (const comm of comerciosArr) {
        const cfg = await loadEffectiveCommerceConfig(comm);
        commerceConfigsMap.set(comm.toLowerCase(), cfg);
      }

      // Contabilizar unidades ya comprometidas en solicitudes RMA activas/aprobadas/completadas
      const usedQtyByOrderAndItem = new Map<string, number>();
      for (const rma of rmasList) {
        const wf = String(rma.workflow_status || rma.status || "").toLowerCase();
        if (["rechazado", "cancelado", "expirado"].includes(wf)) continue;
        const origId = rma.origen_order_id;
        if (!origId) continue;

        const rItems = Array.isArray(rma.return_items) && rma.return_items.length > 0
          ? rma.return_items
          : (Array.isArray(rma.productos) ? rma.productos : []);

        for (const it of rItems) {
          const pId = it.product_id || it.id_devuelto || "";
          const sku = String(it.sku || "").trim().toLowerCase();
          const qty = Number(it.qty ?? it.qty_devuelto ?? it.cantidad ?? 0);
          if (qty <= 0) continue;
          if (pId) {
            const k1 = `${origId}::pid::${pId}`;
            usedQtyByOrderAndItem.set(k1, (usedQtyByOrderAndItem.get(k1) || 0) + qty);
          }
          if (sku) {
            const k2 = `${origId}::sku::${sku}`;
            usedQtyByOrderAndItem.set(k2, (usedQtyByOrderAndItem.get(k2) || 0) + qty);
          }
        }
      }

      // Enriquecer órdenes para el portal
      const enrichedOrders = ordersList.map((o: any) => {
        const commKey = String(o.comercio || "").trim().toLowerCase();
        const cfg = commerceConfigsMap.get(commKey) || {};
        const resolvedItems = resolveOrderItemsWithPrices(
          o,
          orderItemsByOrder.get(o.id) || [],
          productsById,
          productsByCommSku,
          syncedByCommSku
        );

        const excludedSet = new Set((cfg.excluded_skus || []).map((s: string) => String(s).trim().toLowerCase()));

        const itemsWithEligibility = resolvedItems.map((it: any) => {
          const usedByPid = it.product_id ? (usedQtyByOrderAndItem.get(`${o.id}::pid::${it.product_id}`) || 0) : 0;
          const usedBySku = it.sku ? (usedQtyByOrderAndItem.get(`${o.id}::sku::${String(it.sku).toLowerCase()}`) || 0) : 0;
          const alreadyRequested = Math.max(usedByPid, usedBySku);
          const isExcludedSku = excludedSet.has(String(it.sku || "").toLowerCase());
          const eligibleQty = isExcludedSku ? 0 : Math.max(0, it.quantity - alreadyRequested);

          return {
            ...it,
            already_requested_qty: alreadyRequested,
            is_excluded_sku: isExcludedSku,
            eligible_qty: eligibleQty
          };
        });

        const anchorDateStr = o.delivered_at || o.dispatched_at || o.created_at;
        const daysElapsed = anchorDateStr
          ? Math.floor((Date.now() - new Date(anchorDateStr).getTime()) / (1000 * 60 * 60 * 24))
          : 0;

        const isDelivered = String(o.estado_wms || "").toLowerCase() === "entregado" ||
                            String(o.status || "").toLowerCase().includes("entreg") ||
                            String(o.status || "").toLowerCase().includes("retirado");

        const withinExchangeWindow = daysElapsed <= Number(cfg.exchange_window_days ?? 30);
        const withinReturnWindow = daysElapsed <= Number(cfg.return_window_days ?? 10);
        const hasEligibleUnits = itemsWithEligibility.some((i: any) => i.eligible_qty > 0);
        const blockedByDelivery = Boolean(cfg.require_delivered_status && !isDelivered);

        const canExchange = Boolean(cfg.enable_exchanges !== false && withinExchangeWindow && hasEligibleUnits && !blockedByDelivery);
        const canReturn = Boolean(cfg.enable_returns !== false && withinReturnWindow && hasEligibleUnits && !blockedByDelivery);
        const canStoreCredit = Boolean(cfg.enable_store_credit === true && withinExchangeWindow && hasEligibleUnits && !blockedByDelivery);

        let ineligibleReason = "";
        if (blockedByDelivery) {
          ineligibleReason = "Este pedido aún está en preparación o tránsito. Podrás gestionar cambios apenas sea entregado.";
        } else if (!hasEligibleUnits) {
          ineligibleReason = "Todas las unidades de este pedido ya registran una solicitud activa o procesada.";
        } else if (!withinExchangeWindow && !withinReturnWindow) {
          ineligibleReason = `Se superó el plazo máximo de postventa (${cfg.exchange_window_days ?? 30} días).`;
        }

        return {
          id: o.id,
          comercio: o.comercio,
          brand_name: cfg.brand_name || o.comercio,
          logo_url: cfg.logo_url || "",
          primary_color: cfg.primary_color || "#5c24ff",
          order_number: o.external_order_number || o.id.slice(0, 8),
          platform: o.external_platform || "Tienda Online",
          status_label: isDelivered ? "Entregado" : (o.estado_wms || o.status || "En proceso"),
          is_delivered: isDelivered,
          created_at: o.created_at,
          delivered_at: o.delivered_at,
          days_elapsed: Math.max(0, daysElapsed),
          customer_name: o.customer_name || "",
          customer_phone: o.customer_phone || "",
          shipping_address: o.shipping_address || "",
          shipping_city: o.shipping_city || "",
          shipping_complement: o.shipping_complement || "",
          items: itemsWithEligibility,
          eligibility: {
            can_exchange: canExchange,
            can_return: canReturn,
            can_store_credit: canStoreCredit,
            any_allowed: canExchange || canReturn || canStoreCredit,
            ineligible_reason: ineligibleReason,
            return_window_days: cfg.return_window_days ?? 10,
            exchange_window_days: cfg.exchange_window_days ?? 30
          },
          portal_config: cfg
        };
      });

      // Cargar órdenes de reemplazo vinculadas a las RMAs del comprador
      const repIds = rmasList.map((r: any) => r.replacement_order_id).filter(Boolean);
      const repOrdersMap = new Map<string, any>();
      if (repIds.length > 0) {
        const { data: repOrders } = await supabase
          .from("orders")
          .select("id, external_order_number, status, estado_wms, hold_reason, courier, tracking_number, tracking_url, sucursal_pickeo, delivered_at")
          .in("id", repIds);
        (repOrders || []).forEach((ro: any) => repOrdersMap.set(ro.id, ro));
      }

      const enrichedRmas = await Promise.all(rmasList.map(async (r: any) => {
        const receiptSigned = await signMediaPathIfNeeded(r.payment_receipt_url);
        const commCfg = r.comercio ? (commerceConfigsMap.get(String(r.comercio).trim().toLowerCase()) || await loadEffectiveCommerceConfig(r.comercio)) : {};
        return {
          id: r.id,
          rma_number: r.rma_number || `LI-${String(r.id).slice(0, 6).toUpperCase()}`,
          comercio: r.comercio,
          brand_name: commCfg?.brand_name || r.comercio,
          logo_url: commCfg?.logo_url || "",
          tipo_movimiento: r.tipo_movimiento,
          resolution_type: r.resolution_type || (r.tipo_movimiento === "CAMBIO" ? "exchange" : "return"),
          referencia_pedido: r.referencia_pedido,
          workflow_status: r.workflow_status || r.status || "pendiente",
          status: r.status,
          return_items: r.return_items || [],
          exchange_items: r.exchange_items || [],
          productos_legacy: r.productos || [],
          financial_summary: r.financial_summary || {},
          payment_status: r.payment_status || "not_required",
          payment_receipt_signed_url: receiptSigned,
          payment_instructions: commCfg?.payment_instructions || "",
          payment_link_url: commCfg?.payment_link_url || "",
          logistics_option: r.logistics_option || r.modo_entrega,
          transporte: r.transporte,
          sucursal: r.sucursal,
          inbound_courier: r.inbound_courier,
          inbound_tracking_number: r.inbound_tracking_number || (r.referencia_transporte !== "N/A" ? r.referencia_transporte : ""),
          inbound_tracking_url: r.inbound_tracking_url || "",
          inbound_label_url: r.inbound_label_url || "",
          qr_branch_token: r.qr_branch_token || "",
          rejection_reason: r.rejection_reason || "",
          seller_notes: r.seller_notes || "",
          created_at: r.created_at,
          replacement_order: r.replacement_order_id ? (repOrdersMap.get(r.replacement_order_id) || null) : null
        };
      }));

      return new Response(JSON.stringify({
        success: true,
        email: sess.email,
        scope_comercio: sess.scope_comercio,
        orders: enrichedOrders,
        rmas: enrichedRmas
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // =========================================================================
    // 3. OBTENER CATÁLOGO DE PRODUCTOS CON STOCK REAL PARA CAMBIO
    // =========================================================================
    if (action === "get_exchange_catalog") {
      const orderId = String(body.order_id || "").trim();
      if (!orderId) {
        return new Response(JSON.stringify({ error: "Falta order_id" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { data: order } = await supabase
        .from("orders")
        .select("id, comercio, customer_email")
        .eq("id", orderId)
        .maybeSingle();

      if (!order || String(order.customer_email || "").trim().toLowerCase() !== sess.email) {
        return new Response(JSON.stringify({ error: "Pedido no autorizado." }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (sess.scope_comercio && String(order.comercio || "").trim().toLowerCase() !== sess.scope_comercio.toLowerCase()) {
        return new Response(JSON.stringify({ error: "Pedido fuera del alcance de esta tienda." }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const cfg = await loadEffectiveCommerceConfig(order.comercio);
      const excludedSet = new Set((cfg.excluded_skus || []).map((s: string) => String(s).trim().toLowerCase()));

      const { data: prods } = await supabase
        .from("products")
        .select("id, sku, name, price, image_url, status, is_pack, is_virtual, weight, talla, color, variable_1, variable_2, shopify_product_id, shopify_variant_id, woocommerce_product_id, woocommerce_variation_id, inventory(quantity, committed_quantity, reserved_quantity)")
        .eq("comercio", order.comercio)
        .neq("status", "archived")
        .order("name", { ascending: true });

      const { data: synced } = await supabase
        .from("synced_products")
        .select("sku, price, image_url, status")
        .eq("comercio", order.comercio);

      const syncedMap = new Map<string, any>();
      (synced || []).forEach((s: any) => {
        if (s.sku) syncedMap.set(String(s.sku).trim().toLowerCase(), s);
      });

      const catalog = (prods || [])
        .filter((p: any) => !p.is_virtual && !p.is_pack && !excludedSet.has(String(p.sku || "").trim().toLowerCase()))
        .map((p: any) => {
          const sp = syncedMap.get(String(p.sku || "").trim().toLowerCase());
          if (sp?.status === "archived" || sp?.status === "draft") return null;

          const availableStock = (p.inventory || []).reduce((sum: number, inv: any) => {
            const avail = (Number(inv.quantity) || 0) - (Number(inv.committed_quantity) || 0) - (Number(inv.reserved_quantity) || 0);
            return sum + Math.max(0, avail);
          }, 0);

          const unitPrice = Math.round(Number(p.price || sp?.price || 0));

          return {
            id: p.id,
            sku: p.sku,
            name: p.name,
            price: unitPrice,
            image_url: p.image_url || sp?.image_url || "",
            talla: p.talla || "",
            color: p.color || "",
            variable_1: p.variable_1 || "",
            variable_2: p.variable_2 || "",
            weight_kg: Number(p.weight) > 0 ? Number(p.weight) : 0.5,
            base_model_key: getBaseModelKey(p),
            shopify_product_id: p.shopify_product_id || null,
            shopify_variant_id: p.shopify_variant_id || null,
            woocommerce_product_id: p.woocommerce_product_id || null,
            woocommerce_variation_id: p.woocommerce_variation_id || null,
            available_stock: availableStock
          };
        })
        .filter(Boolean);

      return new Response(JSON.stringify({
        success: true,
        allow_even_variant_exchange: cfg.allow_even_variant_exchange !== false,
        allow_catalog_exchange: cfg.allow_catalog_exchange !== false,
        catalog
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // =========================================================================
    // 4. GENERAR SIGNED UPLOAD URL PARA FOTOS, VIDEOS CORTOS O COMPROBANTES
    // =========================================================================
    if (action === "create_media_upload_url") {
      const fileName = String(body.file_name || "evidencia.jpg").trim();
      const mimeType = String(body.mime_type || "image/jpeg").trim().toLowerCase();
      const fileSize = Number(body.file_size_bytes || 0);
      const orderId = String(body.order_id || body.rma_id || "general").trim();

      const allowedPrefixes = ["image/", "video/", "application/pdf"];
      if (!allowedPrefixes.some((pref) => mimeType.startsWith(pref))) {
        return new Response(JSON.stringify({ error: "Formato no permitido. Sube imágenes, videos MP4/MOV o PDF." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const maxBytes = mimeType.startsWith("video/") ? 45 * 1024 * 1024 : 15 * 1024 * 1024;
      if (fileSize > maxBytes) {
        return new Response(JSON.stringify({
          error: mimeType.startsWith("video/")
            ? "El video supera el tamaño máximo de 45 MB (aprox. 30 seg)."
            : "El archivo supera el máximo permitido de 15 MB."
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const extMatch = fileName.match(/\.([a-zA-Z0-9]{2,5})$/);
      const ext = extMatch ? extMatch[1].toLowerCase() : (mimeType.startsWith("video/") ? "mp4" : "jpg");
      const folder = sanitizePathSegment(sess.scope_comercio || "multimarca");
      const subFolder = sanitizePathSegment(orderId);
      const uniqueId = crypto.randomUUID();
      const storagePath = `${folder}/${subFolder}/${Date.now()}_${uniqueId}.${ext}`;

      const { data, error } = await supabase.storage
        .from("reverse-logistics-media")
        .createSignedUploadUrl(storagePath);

      if (error || !data) {
        console.error("[reverse-portal-api] Error SignedUploadUrl:", error);
        return new Response(JSON.stringify({ error: "No se pudo preparar la subida segura del archivo." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({
        success: true,
        upload_url: data.signedUrl,
        token: data.token,
        storage_path: storagePath,
        bucket: "reverse-logistics-media"
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // =========================================================================
    // 5. COTIZAR OPCIONES LOGÍSTICAS SEGÚN COMUNA Y TIPO DE SOLICITUD
    // =========================================================================
    if (action === "quote_logistics_options") {
      const orderId = String(body.order_id || "").trim();
      const comunaRaw = String(body.comuna || "").trim();
      const resolutionType = String(body.resolution_type || "exchange").trim();
      const hasFaultReason = Boolean(body.has_fault_reason);
      const totalWeightKg = Math.max(0.2, Number(body.estimated_weight_kg) || 0.8);

      const { data: order } = await supabase
        .from("orders")
        .select("id, comercio, customer_email, shipping_city")
        .eq("id", orderId)
        .maybeSingle();

      if (!order || String(order.customer_email || "").trim().toLowerCase() !== sess.email) {
        return new Response(JSON.stringify({ error: "Pedido no autorizado." }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const cfg = await loadEffectiveCommerceConfig(order.comercio);
      const targetComunaKey = normKey(comunaRaw || order.shipping_city || "");

      let communeRow = null;
      if (targetComunaKey) {
        const { data: exactRow } = await supabase
          .from("shipping_coverage_rates")
          .select("*")
          .eq("comuna_key", targetComunaKey)
          .maybeSingle();
        communeRow = exactRow;

        if (!communeRow) {
          const { data: fuzzyRows } = await supabase
            .from("shipping_coverage_rates")
            .select("*")
            .ilike("comuna_key", `%${targetComunaKey}%`)
            .limit(1);
          if (fuzzyRows && fuzzyRows[0]) communeRow = fuzzyRows[0];
        }
      }

      const options = computeLogisticsOptionsForOrder(
        cfg,
        communeRow,
        resolutionType,
        hasFaultReason,
        totalWeightKg
      );

      return new Response(JSON.stringify({
        success: true,
        matched_commune: communeRow ? {
          comuna_key: communeRow.comuna_key,
          comuna: communeRow.comuna,
          region: communeRow.region,
          is_rm_stocka_fleet: communeRow.is_rm_stocka_fleet
        } : null,
        options
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // =========================================================================
    // 6. ENVIAR SOLICITUD DE CAMBIO / DEVOLUCIÓN / CRÉDITO EN TIENDA
    // =========================================================================
    if (action === "submit_rma_request") {
      const orderId = String(body.order_id || "").trim();
      const resolutionType = String(body.resolution_type || "exchange").trim(); // 'exchange' | 'return' | 'store_credit'
      const requestedReturnItems: any[] = Array.isArray(body.return_items) ? body.return_items : [];
      const requestedExchangeItems: any[] = Array.isArray(body.exchange_items) ? body.exchange_items : [];
      const requestFormAnswers = body.request_form_answers && typeof body.request_form_answers === "object"
        ? body.request_form_answers
        : {};
      const logisticsOptionId = String(body.logistics_option || "sucursal_nunoa").trim();
      const preferredCourier = String(body.preferred_courier || "").trim();
      const shippingInfo = body.shipping_info && typeof body.shipping_info === "object" ? body.shipping_info : {};
      const buyerComments = String(body.comments || "").trim();

      if (!orderId || requestedReturnItems.length === 0) {
        return new Response(JSON.stringify({ error: "Debes seleccionar al menos un producto de tu compra." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (resolutionType === "exchange" && requestedExchangeItems.length === 0) {
        return new Response(JSON.stringify({ error: "Debes seleccionar al menos un producto de reemplazo para el cambio." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { data: order } = await supabase
        .from("orders")
        .select("*")
        .eq("id", orderId)
        .maybeSingle();

      if (!order || String(order.customer_email || "").trim().toLowerCase() !== sess.email) {
        return new Response(JSON.stringify({ error: "Pedido no autorizado." }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (sess.scope_comercio && String(order.comercio || "").trim().toLowerCase() !== sess.scope_comercio.toLowerCase()) {
        return new Response(JSON.stringify({ error: "Pedido fuera del alcance de este portal." }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const cfg = await loadEffectiveCommerceConfig(order.comercio);
      if (resolutionType === "store_credit" && !cfg.enable_store_credit) {
        return new Response(JSON.stringify({ error: "La opción de crédito en tienda no está habilitada para este comercio." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Cargar ítems reales de la orden para recalcular precios pagados en servidor
      const { data: dbOis } = await supabase
        .from("order_items")
        .select("id, order_id, product_id, quantity, is_gift, unit_price, discount_amount, effective_unit_price, image_url")
        .eq("order_id", order.id);

      const { data: commProds } = await supabase
        .from("products")
        .select("id, comercio, sku, name, price, image_url, weight, talla, color, variable_1, variable_2, shopify_product_id, shopify_variant_id, woocommerce_product_id, woocommerce_variation_id, inventory(quantity, committed_quantity, reserved_quantity)")
        .eq("comercio", order.comercio);

      const { data: commSynced } = await supabase
        .from("synced_products")
        .select("comercio, sku, price, image_url")
        .eq("comercio", order.comercio);

      const productsById = new Map<string, any>();
      const productsByCommSku = new Map<string, any>();
      const syncedByCommSku = new Map<string, any>();

      (commProds || []).forEach((p: any) => {
        productsById.set(p.id, p);
        if (p.sku) productsByCommSku.set(`${String(order.comercio).trim().toLowerCase()}::${String(p.sku).trim().toLowerCase()}`, p);
      });
      (commSynced || []).forEach((s: any) => {
        if (s.sku) syncedByCommSku.set(`${String(order.comercio).trim().toLowerCase()}::${String(s.sku).trim().toLowerCase()}`, s);
      });

      const canonicalOrderItems = resolveOrderItemsWithPrices(
        order,
        dbOis || [],
        productsById,
        productsByCommSku,
        syncedByCommSku
      );

      const reasonsList: any[] = Array.isArray(cfg.custom_reasons) ? cfg.custom_reasons : [];
      let hasFaultReason = false;
      let creditTotal = 0;
      let totalReturnWeightKg = 0;

      const validatedReturnItems: any[] = [];
      const returnedModelPool: { base_model_key: string; paid_unit_price: number; remaining_qty: number }[] = [];

      for (const reqItem of requestedReturnItems) {
        const qty = Math.max(0, parseInt(String(reqItem.qty || 0), 10));
        if (qty <= 0) continue;

        const matchedOrig = canonicalOrderItems.find((ci: any) =>
          (reqItem.product_id && ci.product_id === reqItem.product_id) ||
          (reqItem.sku && String(ci.sku).toLowerCase() === String(reqItem.sku).trim().toLowerCase())
        );

        if (!matchedOrig || qty > matchedOrig.quantity) {
          return new Response(JSON.stringify({
            error: `Cantidad inválida para el producto ${reqItem.name || reqItem.sku || "seleccionado"}.`
          }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const reasonObj = reasonsList.find((r: any) => r.id === reqItem.reason_id);
        if (reasonObj?.is_fault) hasFaultReason = true;

        const paidUnit = Number(matchedOrig.paid_unit_price) || 0;
        creditTotal += paidUnit * qty;
        totalReturnWeightKg += (Number(matchedOrig.weight_kg) || 0.5) * qty;

        returnedModelPool.push({
          base_model_key: matchedOrig.base_model_key,
          paid_unit_price: paidUnit,
          remaining_qty: qty
        });

        validatedReturnItems.push({
          product_id: matchedOrig.product_id,
          sku: matchedOrig.sku,
          name: matchedOrig.name,
          image_url: matchedOrig.image_url,
          qty,
          gross_unit_price: matchedOrig.gross_unit_price,
          paid_unit_price: paidUnit,
          line_credit_total: paidUnit * qty,
          base_model_key: matchedOrig.base_model_key,
          shopify_variant_id: matchedOrig.shopify_variant_id,
          woocommerce_variation_id: matchedOrig.woocommerce_variation_id,
          reason_id: reqItem.reason_id || "otro",
          reason_label: reasonObj?.label || reqItem.reason_label || "Solicitud de postventa",
          is_fault: Boolean(reasonObj?.is_fault),
          return_to_stock: !Boolean(reasonObj?.is_fault),
          custom_fields_answers: reqItem.custom_fields_answers || {},
          media_files: Array.isArray(reqItem.media_files) ? reqItem.media_files : []
        });
      }

      if (validatedReturnItems.length === 0) {
        return new Response(JSON.stringify({ error: "No hay unidades válidas seleccionadas." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Validar ítems de cambio y calcular subtotal (aplicando Even Variant Exchange si está activo)
      const validatedExchangeItems: any[] = [];
      let exchangeSubtotal = 0;
      let evenExchangeApplied = false;
      let totalExchangeWeightKg = 0;

      if (resolutionType === "exchange") {
        for (const exReq of requestedExchangeItems) {
          const qty = Math.max(0, parseInt(String(exReq.qty || 0), 10));
          if (qty <= 0) continue;

          const prod = exReq.product_id ? productsById.get(exReq.product_id) : null;
          if (!prod) {
            return new Response(JSON.stringify({ error: "Uno de los productos de cambio seleccionados no existe." }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          const availStock = (prod.inventory || []).reduce((sum: number, inv: any) => {
            return sum + Math.max(0, (Number(inv.quantity) || 0) - (Number(inv.committed_quantity) || 0) - (Number(inv.reserved_quantity) || 0));
          }, 0);

          if (qty > availStock) {
            return new Response(JSON.stringify({
              error: `El producto "${prod.name}" solo cuenta con ${availStock} unidad(es) disponibles en este momento.`
            }), {
              status: 409,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          const sp = prod.sku ? syncedByCommSku.get(`${String(order.comercio).trim().toLowerCase()}::${String(prod.sku).trim().toLowerCase()}`) : null;
          const catalogUnitPrice = Math.round(Number(prod.price || sp?.price || 0));
          const exBaseKey = getBaseModelKey(prod);

          // Evaluar unidades elegibles para cambio paritario de variante (mismo modelo base)
          let remainingToPrice = qty;
          let lineSubtotal = 0;

          if (cfg.allow_even_variant_exchange !== false) {
            for (const poolItem of returnedModelPool) {
              if (remainingToPrice <= 0) break;
              if (poolItem.base_model_key === exBaseKey && poolItem.remaining_qty > 0) {
                const matchedUnits = Math.min(remainingToPrice, poolItem.remaining_qty);
                lineSubtotal += poolItem.paid_unit_price * matchedUnits;
                poolItem.remaining_qty -= matchedUnits;
                remainingToPrice -= matchedUnits;
                if (poolItem.paid_unit_price !== catalogUnitPrice) {
                  evenExchangeApplied = true;
                }
              }
            }
          }

          if (remainingToPrice > 0) {
            lineSubtotal += catalogUnitPrice * remainingToPrice;
          }

          exchangeSubtotal += lineSubtotal;
          totalExchangeWeightKg += (Number(prod.weight) > 0 ? Number(prod.weight) : 0.5) * qty;

          validatedExchangeItems.push({
            product_id: prod.id,
            sku: prod.sku,
            name: prod.name,
            image_url: prod.image_url || sp?.image_url || "",
            talla: prod.talla || "",
            color: prod.color || "",
            qty,
            catalog_unit_price: catalogUnitPrice,
            effective_unit_price: Math.round(lineSubtotal / qty),
            line_total: lineSubtotal,
            shopify_variant_id: prod.shopify_variant_id || null,
            woocommerce_product_id: prod.woocommerce_product_id || null,
            woocommerce_variation_id: prod.woocommerce_variation_id || null
          });
        }
      }

      // Resolver comuna y costo logístico en servidor
      const finalCustomerName = String(shippingInfo.customer_name || order.customer_name || "Cliente").trim();
      const finalCustomerPhone = String(shippingInfo.customer_phone || order.customer_phone || "").trim();
      const finalComuna = logisticsOptionId === "sucursal_nunoa"
        ? "Ñuñoa"
        : String(shippingInfo.comuna || order.shipping_city || "").trim();
      const finalAddress = logisticsOptionId === "sucursal_nunoa"
        ? "Punto de Retiro Stocka Ñuñoa (Av. Campo de Deportes 405)"
        : String(shippingInfo.address || order.shipping_address || "").trim();
      const finalComplement = String(shippingInfo.complement ?? order.shipping_complement ?? "").trim();

      let communeRow = null;
      if (finalComuna) {
        const cKey = normKey(finalComuna);
        const { data: cExact } = await supabase
          .from("shipping_coverage_rates")
          .select("*")
          .eq("comuna_key", cKey)
          .maybeSingle();
        communeRow = cExact;
      }

      const maxWeight = Math.max(totalReturnWeightKg, totalExchangeWeightKg, 0.5);
      const validLogisticsList = computeLogisticsOptionsForOrder(
        cfg,
        communeRow,
        resolutionType,
        hasFaultReason,
        maxWeight
      );
      const chosenLogistics = validLogisticsList.find((o: any) => o.id === logisticsOptionId) || validLogisticsList[0];
      if (!chosenLogistics) {
        return new Response(JSON.stringify({ error: "No hay cobertura logística disponible para la opción seleccionada." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const shippingFeeBuyer = Math.max(0, Number(chosenLogistics.fee_clp) || 0);
      const bonusPct = resolutionType === "store_credit" ? Math.max(0, Number(cfg.store_credit_bonus_pct) || 0) : 0;
      const bonusCreditAmount = resolutionType === "store_credit" ? Math.round(creditTotal * (bonusPct / 100)) : 0;

      // Balance financiero:
      // net_difference > 0 => Comprador debe pagar diferencia (producto más caro y/o costo de envío)
      // net_difference < 0 => Saldo a favor del comprador
      let netDifference = 0;
      if (resolutionType === "exchange") {
        netDifference = (exchangeSubtotal - creditTotal) + shippingFeeBuyer;
      } else if (resolutionType === "store_credit") {
        netDifference = -(creditTotal + bonusCreditAmount) + shippingFeeBuyer;
      } else {
        // Devolución de dinero: el neto a reembolsar es creditTotal - shippingFeeBuyer
        netDifference = -Math.max(0, creditTotal - shippingFeeBuyer);
      }

      const { data: generatedRmaNum } = await supabase.rpc("generate_next_rma_number");
      const rmaNumber = generatedRmaNum || `RMA-${Date.now().toString().slice(-6)}`;
      const qrBranchToken = `STK-${rmaNumber}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

      // Construir arreglo legacy `productos` para 100% compatibilidad con vistas actuales de app.js / admin.js
      const maxLen = Math.max(validatedReturnItems.length, validatedExchangeItems.length);
      const legacyProductos: any[] = [];
      for (let i = 0; i < maxLen; i++) {
        const inc = validatedReturnItems[i] || null;
        const out = validatedExchangeItems[i] || null;
        legacyProductos.push({
          producto_devuelto: inc ? `[${inc.sku}] ${inc.name}` : null,
          id_devuelto: inc ? inc.product_id : null,
          product_id: inc ? inc.product_id : null,
          sku: inc ? inc.sku : null,
          qty_devuelto: inc ? inc.qty : 0,
          regresar_a_inventario: inc ? inc.return_to_stock : false,
          producto_reemplazo: out ? `[${out.sku}] ${out.name}` : null,
          id_reemplazo: out ? out.product_id : null,
          qty_reemplazo: out ? out.qty : 0,
          cantidad: inc ? inc.qty : (out ? out.qty : 1),
          comentario: inc ? `${inc.reason_label}` : ""
        });
      }

      const totalUnits = validatedReturnItems.reduce((s, i) => s + i.qty, 0);
      const tipoMovimiento = resolutionType === "exchange" ? "CAMBIO" : "DEVOLUCION";

      let modoEntregaLegacy = "sucursal";
      if (chosenLogistics.id === "rm_simultaneous_swap" || chosenLogistics.id === "rm_pickup") {
        modoEntregaLegacy = "domicilio_rm";
      } else if (chosenLogistics.id === "regiones_courier" || chosenLogistics.id === "user_own_shipping") {
        modoEntregaLegacy = communeRow?.is_rm_stocka_fleet ? "domicilio_rm" : "regiones";
      }

      const selectedCourierCode = preferredCourier || (chosenLogistics.couriers?.[0] || "STOCKA");
      const financialSummary = {
        currency: "CLP",
        credit_total: creditTotal,
        exchange_subtotal: exchangeSubtotal,
        bonus_credit_pct: bonusPct,
        bonus_credit_amount: bonusCreditAmount,
        store_credit_final: resolutionType === "store_credit" ? Math.max(0, creditTotal + bonusCreditAmount - shippingFeeBuyer) : 0,
        refund_final: resolutionType === "return" ? Math.max(0, creditTotal - shippingFeeBuyer) : 0,
        shipping_fee_buyer: shippingFeeBuyer,
        net_difference: netDifference,
        buyer_owes_amount: netDifference > 0 ? netDifference : 0,
        buyer_favor_amount: netDifference < 0 ? Math.abs(netDifference) : 0,
        even_exchange_applied: evenExchangeApplied
      };

      const insertPayload = {
        rma_number: rmaNumber,
        portal_origin: sess.scope_comercio ? "seller_portal" : "stocka_global_portal",
        tipo_movimiento: tipoMovimiento,
        resolution_type: resolutionType,
        comercio: order.comercio,
        referencia_pedido: order.external_order_number || order.id.slice(0, 8),
        origen_order_id: order.id,
        status: "pendiente",
        workflow_status: "solicitado",
        productos: legacyProductos,
        return_items: validatedReturnItems,
        exchange_items: validatedExchangeItems,
        form_schema_snapshot: cfg.form_schema || [],
        request_form_answers: requestFormAnswers,
        financial_summary: financialSummary,
        payment_status: netDifference > 0 ? "pending" : "not_required",
        cantidad_total: totalUnits,
        logistics_option: chosenLogistics.id,
        modo_entrega: modoEntregaLegacy,
        transporte: `${chosenLogistics.title}${selectedCourierCode ? ` (${selectedCourierCode})` : ""}`,
        inbound_courier: selectedCourierCode,
        referencia_transporte: String(shippingInfo.user_tracking_number || "").trim() || "Pendiente Aprobación",
        inbound_tracking_number: String(shippingInfo.user_tracking_number || "").trim() || null,
        sucursal: chosenLogistics.id === "sucursal_nunoa" ? "Punto Físico Ñuñoa" : (finalComuna || "Punto Físico Ñuñoa"),
        responsable_pago: shippingFeeBuyer > 0 ? "usuario_final" : "comercio",
        costo_envio: shippingFeeBuyer,
        customer_name: finalCustomerName,
        customer_email: sess.email,
        customer_phone: finalCustomerPhone,
        shipping_address: finalAddress,
        shipping_city: finalComuna,
        shipping_complement: finalComplement || null,
        qr_branch_token: qrBranchToken,
        comentarios: buyerComments || validatedReturnItems.map((i) => `${i.sku}: ${i.reason_label}`).join(" | "),
        creado_por: `Portal Público (${sess.email})`
      };

      const { data: createdRma, error: insErr } = await supabase
        .from("reverse_logistics")
        .insert([insertPayload])
        .select("*")
        .single();

      if (insErr) {
        console.error("[reverse-portal-api] Error insertando RMA:", insErr);
        return new Response(JSON.stringify({ error: "No pudimos registrar tu solicitud: " + insErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Disparar notificación por correo al comprador y al seller en background
      fetch(`${supabaseUrl}/functions/v1/reverse-channel-sync`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${supabaseServiceKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "notify_new_portal_rma",
          rl_id: createdRma.id
        })
      }).catch((e) => console.warn("[reverse-portal-api] Aviso notificando nuevo RMA:", e));

      return new Response(JSON.stringify({
        success: true,
        rma: {
          id: createdRma.id,
          rma_number: createdRma.rma_number,
          workflow_status: createdRma.workflow_status,
          resolution_type: createdRma.resolution_type,
          financial_summary: createdRma.financial_summary,
          payment_status: createdRma.payment_status,
          qr_branch_token: createdRma.qr_branch_token
        }
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // =========================================================================
    // 7. ACTUALIZAR RMA POR EL COMPRADOR (COMPROBANTE DE PAGO / TRACKING RETORNO / CANCELAR)
    // =========================================================================
    if (action === "buyer_update_rma") {
      const rmaId = String(body.rma_id || "").trim();
      const subAction = String(body.sub_action || "").trim();

      const { data: rma } = await supabase
        .from("reverse_logistics")
        .select("*")
        .eq("id", rmaId)
        .maybeSingle();

      if (!rma || String(rma.customer_email || "").trim().toLowerCase() !== sess.email) {
        return new Response(JSON.stringify({ error: "Solicitud no encontrada o no autorizada." }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (subAction === "upload_payment_receipt") {
        const receiptPath = String(body.payment_receipt_path || "").trim();
        const paymentNotes = String(body.payment_notes || "").trim();
        if (!receiptPath) {
          return new Response(JSON.stringify({ error: "Debes adjuntar el comprobante de pago." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        await supabase
          .from("reverse_logistics")
          .update({
            payment_receipt_url: receiptPath,
            payment_notes: paymentNotes || null,
            payment_status: "receipt_uploaded",
            updated_at: new Date().toISOString()
          })
          .eq("id", rma.id);

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (subAction === "submit_inbound_tracking") {
        const courier = String(body.inbound_courier || "").trim();
        const tracking = String(body.inbound_tracking_number || "").trim();
        if (!courier || !tracking) {
          return new Response(JSON.stringify({ error: "Indica la empresa de transporte y el número de seguimiento." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const nextWf = ["aprobado_esperando_retorno", "solicitado"].includes(rma.workflow_status)
          ? "en_transito_retorno"
          : rma.workflow_status;

        await supabase
          .from("reverse_logistics")
          .update({
            inbound_courier: courier,
            inbound_tracking_number: tracking,
            referencia_transporte: tracking,
            workflow_status: nextWf,
            updated_at: new Date().toISOString()
          })
          .eq("id", rma.id);

        return new Response(JSON.stringify({ success: true, workflow_status: nextWf }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (subAction === "cancel_request") {
        if (rma.workflow_status !== "solicitado") {
          return new Response(JSON.stringify({
            error: "Solo puedes cancelar solicitudes que aún no han sido procesadas por la tienda."
          }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        await supabase
          .from("reverse_logistics")
          .update({
            workflow_status: "cancelado",
            status: "cancelado",
            updated_at: new Date().toISOString()
          })
          .eq("id", rma.id);

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ error: "Sub-acción inválida." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ error: "Acción desconocida" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err: any) {
    const status = err?.status || 500;
    const msg = err?.message || "Error interno procesando la solicitud.";
    if (status >= 500) console.error("[reverse-portal-api] Error:", err);
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
