import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const shopifyClientId = Deno.env.get("SHOPIFY_CLIENT_ID") ?? "4d04c58f432c53fb870d1fbcad92431c";
const shopifyClientSecret = Deno.env.get("SHOPIFY_CLIENT_SECRET") ?? "";

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getValidShopifyToken(integration: any, forceRefresh = false): Promise<string> {
  if (!integration.refresh_token) {
    return integration.access_token;
  }

  const shopKey = integration.shop_url;
  const cached = tokenCache.get(shopKey);
  const now = Date.now();

  if (!forceRefresh && cached && now < (cached.expiresAt - 5 * 60 * 1000)) {
    return cached.token;
  }

  const clientSecret = shopifyClientSecret || integration.webhook_secret;
  if (!clientSecret) {
    return integration.access_token;
  }

  console.log(`[Resync Shopify] Renovando token de acceso para ${integration.shop_url}...`);
  const tokenUrl = `https://${integration.shop_url}/admin/oauth/access_token`;
  try {
    const params = new URLSearchParams({
      client_id: shopifyClientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: integration.refresh_token
    });

    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: params.toString()
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[Resync Shopify] Error renovando token: ${res.status} - ${errorText}`);
      return integration.access_token;
    }

    const data = await res.json();
    console.log(`[Resync Shopify] Token renovado con éxito para ${integration.shop_url}. Expira en ${data.expires_in}s.`);

    const expiresInSec = Number(data.expires_in) || 3600;
    tokenCache.set(shopKey, {
      token: data.access_token,
      expiresAt: Date.now() + expiresInSec * 1000
    });

    integration.access_token = data.access_token;
    if (data.refresh_token) {
      integration.refresh_token = data.refresh_token;
    }

    await supabase
      .from("merchant_integrations")
      .update({
        access_token: data.access_token,
        refresh_token: data.refresh_token || integration.refresh_token,
        last_sync_at: new Date().toISOString()
      })
      .eq("id", integration.id);

    return data.access_token;
  } catch (err: any) {
    console.error("[Resync Shopify] Excepción renovando token:", err.message);
    return integration.access_token;
  }
}

const WHATSAPP_API_URL = Deno.env.get("WHATSAPP_API_URL") || "https://stocka-whatsapp-bot.onrender.com";
const WHATSAPP_API_KEY = Deno.env.get("WHATSAPP_API_KEY") || "stocka_wa_internal_secret_2026";
const GESTION_STOCKA_GROUP_JID = "120363413357945543@g.us"; // NOTIFICACIONES STOX

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function notifyWhatsAppGestion(message: string) {
  try {
    const res = await fetch(`${WHATSAPP_API_URL}/send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": WHATSAPP_API_KEY,
      },
      body: JSON.stringify({
        to: GESTION_STOCKA_GROUP_JID,
        message: message,
        withPrefix: false,
      }),
    });
    return await res.json();
  } catch (err: any) {
    console.error("[WhatsApp Bot] Error enviando mensaje:", err.message);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Validar autenticación JWT o Service Role (VULN-20)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado: Falta cabecera Authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    let isServiceOrAdmin = false;
    let allowedComercios: string[] = [];

    let isJwtServiceRole = false;
    try {
      const parts = authToken.split(".");
      if (parts.length === 3) {
        const payloadJson = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
        if (payloadJson?.ref === "ejtjfaucnxbikrwjwwdu" && payloadJson?.role === "service_role") {
          isJwtServiceRole = true;
        }
      }
    } catch (_) {}

    if ((supabaseServiceKey && authToken === supabaseServiceKey.trim()) || isJwtServiceRole) {
      isServiceOrAdmin = true;
    } else {
      const { data: { user }, error: authErr } = await supabase.auth.getUser(authToken);
      if (authErr || !user) {
        return new Response(JSON.stringify({ error: "No autorizado: Sesión inválida o expirada" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role, comercio")
        .eq("id", user.id)
        .maybeSingle();

      if (!profile) {
        return new Response(JSON.stringify({ error: "No autorizado: Perfil no encontrado" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const userComercioRaw = String(profile.comercio || "").trim();
      if (profile.role === "admin" || userComercioRaw.toLowerCase() === "all") {
        isServiceOrAdmin = true;
      } else {
        allowedComercios = userComercioRaw
          .split(",")
          .map((c: string) => c.trim().toLowerCase())
          .filter(Boolean);
      }
    }

    const { order_id, silent } = await req.json();
    if (!order_id) {
      return new Response(JSON.stringify({ error: "Parámetro 'order_id' es requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Obtener la orden de la base de datos
    const { data: order, error: ordErr } = await supabase
      .from("orders")
      .select("id, comercio, merchant_id, external_order_number, estado_wms, status, raw_shopify_data, total_value, shipping_method, payment_status, sku, item, cantidad")
      .eq("id", order_id)
      .maybeSingle();

    if (ordErr || !order) {
      return new Response(JSON.stringify({ error: "Pedido no encontrado en WMS" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verificar pertenencia al comercio para usuarios no administradores
    if (!isServiceOrAdmin) {
      if (!order.comercio || !allowedComercios.includes(String(order.comercio).trim().toLowerCase())) {
        return new Response(JSON.stringify({ error: "No tienes permisos sobre el comercio de este pedido" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Validar estado WMS
    const currentWms = (order.estado_wms || "").trim();
    if (currentWms === "Entregado") {
      return new Response(JSON.stringify({
        error: "Este pedido ya está finalizado en estado 'Entregado' con su trazabilidad sellada en base de datos. No requiere ni admite nuevas consultas externas salvo reapertura autorizada por Administración."
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (currentWms !== "En procesamiento") {
      return new Response(JSON.stringify({
        error: `El pedido se encuentra actualmente en estado '${currentWms}'. Para admitir y procesar los cambios de Shopify, debe devolver el pedido a 'En procesamiento' antes de sincronizar.`
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const existingRaw = (order.raw_shopify_data || {}) as Record<string, any>;
    const isWmsItemsEdited = existingRaw.wms_items_edited === true;
    const isWmsShippingEdited = existingRaw.wms_shipping_edited === true;

    // 2. Obtener integración activa de Shopify
    let integQuery = supabase
      .from("merchant_integrations")
      .select("*")
      .eq("platform", "Shopify")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (order.comercio) {
      integQuery = integQuery.eq("comercio", order.comercio);
    } else if (order.merchant_id) {
      integQuery = integQuery.eq("merchant_id", order.merchant_id);
    }

    const { data: integs } = await integQuery.limit(1);
    const integ = integs?.[0];

    if (!integ) {
      return new Response(JSON.stringify({ error: `No se encontró integración activa de Shopify para el comercio '${order.comercio}'` }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Consultar la API de Shopify desde el backend (sin restricciones de CORS)
    let shopifyOrder: any = null;
    let token = await getValidShopifyToken(integ);
    const rawId = order.raw_shopify_data?.id;

    if (rawId) {
      try {
        let resp = await fetch(`https://${integ.shop_url}/admin/api/2024-04/orders/${rawId}.json`, {
          headers: { "X-Shopify-Access-Token": token },
        });
        if (resp.status === 401 && integ.refresh_token) {
          console.warn("[Resync Shopify] HTTP 401 recibido, forzando renovación de token...");
          token = await getValidShopifyToken(integ, true);
          resp = await fetch(`https://${integ.shop_url}/admin/api/2024-04/orders/${rawId}.json`, {
            headers: { "X-Shopify-Access-Token": token },
          });
        }
        if (resp.ok) {
          const d = await resp.json();
          shopifyOrder = d.order;
        }
      } catch (fetchErr: any) {
        console.warn("Error consultando por ID a Shopify:", fetchErr.message);
      }
    }

    if (!shopifyOrder) {
      const orderNum = order.external_order_number || "";
      const cleanNum = orderNum.replace(/^[A-Z\s]+#/, "#");
      const encodedNum = encodeURIComponent(cleanNum || orderNum);
      let resp = await fetch(`https://${integ.shop_url}/admin/api/2024-04/orders.json?name=${encodedNum}&status=any`, {
        headers: { "X-Shopify-Access-Token": token },
      });
      if (resp.status === 401 && integ.refresh_token) {
        console.warn("[Resync Shopify] HTTP 401 recibido, forzando renovación de token...");
        token = await getValidShopifyToken(integ, true);
        resp = await fetch(`https://${integ.shop_url}/admin/api/2024-04/orders.json?name=${encodedNum}&status=any`, {
          headers: { "X-Shopify-Access-Token": token },
        });
      }
      if (resp.ok) {
        const d = await resp.json();
        if (d.orders && d.orders.length > 0) {
          shopifyOrder = d.orders[0];
        }
      }
    }

    if (!shopifyOrder) {
      return new Response(JSON.stringify({ error: `No fue posible encontrar el pedido en Shopify con referencia ${order.external_order_number}` }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Conciliar ítems de forma inteligente protegiendo ajustes manuales a nivel granular
    let deletedCount = 0;
    const deletedSkusSet = new Set<string>();
    const lineItems = shopifyOrder.line_items || [];

    // Obtener reglas de ediciones manuales si el pedido fue modificado en WMS
    let manualEdits: {
      deleted_skus: string[];
      added_skus: string[];
      modified_quantities: Record<string, number>;
    } = { deleted_skus: [], added_skus: [], modified_quantities: {} };

    if (isWmsItemsEdited) {
      if (existingRaw.wms_manual_edits) {
        manualEdits = {
          deleted_skus: existingRaw.wms_manual_edits.deleted_skus || [],
          added_skus: existingRaw.wms_manual_edits.added_skus || [],
          modified_quantities: existingRaw.wms_manual_edits.modified_quantities || {}
        };
      } else {
        // Fallback: parsear desde order_audit_logs para retrocompatibilidad
        try {
          const { data: logs } = await supabase
            .from("order_audit_logs")
            .select("details")
            .eq("order_id", order.id)
            .eq("action", "Modificación de Ítems")
            .order("created_at", { ascending: true });

          if (logs && logs.length > 0) {
            const delSet = new Set<string>();
            const addSet = new Set<string>();
            const modMap: Record<string, number> = {};

            logs.forEach((log: any) => {
              const changes = log.details?.changes || [];
              changes.forEach((ch: string) => {
                const delMatch = ch.match(/Eliminado SKU\s+([^:]+)/i);
                if (delMatch) {
                  const sku = delMatch[1].trim();
                  delSet.add(sku);
                  addSet.delete(sku);
                  delete modMap[sku];
                }
                const addMatch = ch.match(/Agregado SKU\s+([^:]+):.*\(Cant:\s*(\d+)\)/i);
                if (addMatch) {
                  const sku = addMatch[1].trim();
                  const qty = parseInt(addMatch[2], 10);
                  addSet.add(sku);
                  delSet.delete(sku);
                  modMap[sku] = qty;
                }
                const modMatch = ch.match(/Modificado SKU\s+([^:]+):.*de cantidad\s+\d+\s+a\s+(\d+)/i);
                if (modMatch) {
                  const sku = modMatch[1].trim();
                  const qty = parseInt(modMatch[2], 10);
                  modMap[sku] = qty;
                }
              });
            });

            manualEdits = {
              deleted_skus: Array.from(delSet),
              added_skus: Array.from(addSet),
              modified_quantities: modMap
            };
          }
        } catch (auditErr) {
          console.warn("Aviso consultando audit logs para manual edits:", auditErr);
        }
      }
    }

    const manualDeletedSet = new Set((manualEdits.deleted_skus || []).map((s: string) => s.trim().toLowerCase()));
    const manualAddedSet = new Set((manualEdits.added_skus || []).map((s: string) => s.trim().toLowerCase()));
    const protectedManualLogs: string[] = [];
    const appliedChangesLogs: string[] = [];

    const activeItems = lineItems.filter((item: any) => {
      const effectiveQty = item.current_quantity !== undefined ? item.current_quantity : item.quantity;
      if (effectiveQty <= 0) return false;
      const cleanSku = (item.sku || "").trim().toLowerCase();
      const fallbackSku = (item.variant_id?.toString() || item.id?.toString() || "").trim().toLowerCase();
      if (manualDeletedSet.has(cleanSku) || manualDeletedSet.has(fallbackSku)) {
        protectedManualLogs.push(`SKU ${item.sku || fallbackSku} (${item.title}) se mantiene eliminado por ajuste manual en WMS.`);
        return false;
      }
      return true;
    });

    // Cargar equivalencias de SKU para este comercio (con y sin espacios, multiplicador y master_product_id)
    const skuMap: Record<string, string> = {};
    const skuMultMap: Record<string, number> = {};
    const skuProdIdMap: Record<string, string> = {};
    try {
      let { data: equivalences, error: eqErr } = await supabase
        .from("sku_equivalences")
        .select("platform_sku, master_sku, platform, quantity_multiplier, master_product_id")
        .eq("comercio", order.comercio);
      if (eqErr) {
        ({ data: equivalences } = await supabase
          .from("sku_equivalences")
          .select("platform_sku, master_sku, platform")
          .eq("comercio", order.comercio));
      }
      if (equivalences) {
        equivalences.filter((e: any) => e.platform === "Todas").forEach((e: any) => {
          if (e.platform_sku && e.master_sku) {
            const pTrim = e.platform_sku.trim();
            const pClean = pTrim.replace(/\s+/g, "");
            const mTrim = e.master_sku.trim();
            const mult = Math.max(1, Number(e.quantity_multiplier || 1));
            const pid = e.master_product_id || "";
            [pTrim, pClean, pClean.toUpperCase()].forEach((k) => {
              skuMap[k] = mTrim;
              skuMultMap[k] = mult;
              if (pid) skuProdIdMap[k] = pid;
            });
          }
        });
        equivalences.filter((e: any) => e.platform === "Shopify").forEach((e: any) => {
          if (e.platform_sku && e.master_sku) {
            const pTrim = e.platform_sku.trim();
            const pClean = pTrim.replace(/\s+/g, "");
            const mTrim = e.master_sku.trim();
            const mult = Math.max(1, Number(e.quantity_multiplier || 1));
            const pid = e.master_product_id || "";
            [pTrim, pClean, pClean.toUpperCase()].forEach((k) => {
              skuMap[k] = mTrim;
              skuMultMap[k] = mult;
              if (pid) skuProdIdMap[k] = pid;
            });
          }
        });
      }
    } catch (_) {}

    // Identificar SKUs eliminados desde Shopify
    const deletedShopifyItems = lineItems.filter((item: any) => {
      const effectiveQty = item.current_quantity !== undefined ? item.current_quantity : item.quantity;
      return effectiveQty <= 0;
    });

    deletedShopifyItems.forEach((item: any) => {
      const sku = (item.sku || "").trim();
      if (sku) deletedSkusSet.add(sku);
      else if (item.title || item.name) deletedSkusSet.add((item.title || item.name).trim());
    });

    // Cargar bodega por defecto (priorizando default_warehouse_id del comercio)
    let warehouseId: string | null = null;
    if (order.comercio) {
      const { data: adicCfg } = await supabase
        .from("comercios_adicional_config")
        .select("default_warehouse_id")
        .eq("comercio", order.comercio)
        .maybeSingle();
      if (adicCfg?.default_warehouse_id) {
        warehouseId = adicCfg.default_warehouse_id;
      }
    }
    if (!warehouseId) {
      const { data: whRel } = await supabase
        .from("merchants_warehouses")
        .select("warehouse_id")
        .eq("merchant_id", order.merchant_id || integ.merchant_id)
        .limit(1)
        .maybeSingle();
      warehouseId = whRel?.warehouse_id || null;
    }

    // 1. Obtener order_items actuales en BD incluyendo SKU para identificar eliminados y agrupar por product_id (excluyendo regalos de campañas)
    const { data: existingOrderItems } = await supabase
      .from("order_items")
      .select("id, product_id, quantity, warehouse_id, is_gift, campaign_id, tag, products(sku, name, price)")
      .eq("order_id", order.id);

    const existingByProduct = new Map<string, any[]>();
    const existingGiftItems: any[] = [];
    (existingOrderItems || []).forEach((i: any) => {
      if (i.is_gift || i.campaign_id || i.tag === "Campaña") {
        existingGiftItems.push(i);
        return;
      }
      if (!existingByProduct.has(i.product_id)) existingByProduct.set(i.product_id, []);
      existingByProduct.get(i.product_id)!.push(i);
    });

    // Cargar relaciones de packs del catálogo para desglosar packs si corresponde
    const { data: packRelations } = await supabase
      .from("product_pack_items")
      .select("pack_product_id, member_product_id, quantity");
    const packMembersMap = new Map<string, Array<{ member_product_id: string; quantity: number }>>();
    (packRelations || []).forEach((pr: any) => {
      if (!packMembersMap.has(pr.pack_product_id)) packMembersMap.set(pr.pack_product_id, []);
      packMembersMap.get(pr.pack_product_id)!.push({
        member_product_id: pr.member_product_id,
        quantity: pr.quantity || 1
      });
    });

    // 2. Consolidar cantidades esperadas por product_id (agrupando líneas repetidas del mismo SKU)
    const manualQtyBySkuLower = new Map<string, number>();
    for (const [mSku, mQty] of Object.entries(manualEdits.modified_quantities || {})) {
      const key = String(mSku || "").trim().toLowerCase();
      const qtyNum = Number(mQty);
      if (key && Number.isFinite(qtyNum) && qtyNum > 0) {
        manualQtyBySkuLower.set(key, qtyNum);
      }
    }
    const appliedManualPackKeys = new Set<string>();

    const expectedQuantities = new Map<string, number>();
    const expectedPriceMeta = new Map<string, { unit_price: number; discount_amount: number; effective_unit_price: number }>();
    const productManualCandidates = new Map<string, Set<string>>();
    const productDisplaySku = new Map<string, string>();
    const registerProductCandidates = (prodId: string, displaySku: string | null | undefined, candidates: Array<string | null | undefined>) => {
      if (!productManualCandidates.has(prodId)) productManualCandidates.set(prodId, new Set<string>());
      const set = productManualCandidates.get(prodId)!;
      if (displaySku && !productDisplaySku.has(prodId)) productDisplaySku.set(prodId, displaySku);
      candidates.forEach((c) => {
        const norm = String(c || "").trim().toLowerCase();
        if (norm) set.add(norm);
      });
    };

    for (const item of activeItems) {
      const rawEffectiveQty = item.current_quantity !== undefined ? item.current_quantity : item.quantity;
      const fallbackSku = item.variant_id ? String(item.variant_id) : (item.id ? String(item.id) : "NO-SKU");
      const rawSku = (item.sku || fallbackSku).trim();
      const cleanSku = rawSku.replace(/\s+/g, "");
      const upperSku = cleanSku.toUpperCase();
      const mappedSku = skuMap[rawSku] || skuMap[cleanSku] || skuMap[upperSku] || rawSku;
      const eqMult = skuMultMap[rawSku] || skuMultMap[cleanSku] || skuMultMap[upperSku] || 1;
      const eqMasterProdId = skuProdIdMap[rawSku] || skuProdIdMap[cleanSku] || skuProdIdMap[upperSku] || "";
      const effectiveQty = rawEffectiveQty * eqMult;
      const hasEquivalence = !!(skuMap[rawSku] || skuMap[cleanSku] || skuMap[upperSku]);
      const searchSku = mappedSku || fallbackSku;

      const searchLower = searchSku.toLowerCase();
      const rawLower = rawSku.toLowerCase();
      const cleanLower = cleanSku.toLowerCase();
      const varLower = (item.variant_id?.toString() || '').toLowerCase();
      if (manualDeletedSet.has(searchLower) || manualDeletedSet.has(rawLower) || manualDeletedSet.has(cleanLower) || (varLower && manualDeletedSet.has(varLower))) {
        protectedManualLogs.push(`SKU ${searchSku} (${item.title}) se mantiene eliminado por ajuste manual en WMS.`);
        continue;
      }

      let prod: any = null;
      if (eqMasterProdId) {
        const { data: prodById } = await supabase
          .from("products")
          .select("id, sku, name, is_pack, barcode_wms, description")
          .eq("id", eqMasterProdId)
          .eq("comercio", order.comercio)
          .maybeSingle();
        if (prodById) prod = prodById;
      }

      if (!prod) {
        const productSkuCandidates = Array.from(new Set([
          searchSku,
          searchSku.replace(/\s+/g, "")
        ].filter(Boolean)));

        const { data: foundProducts } = await supabase
          .from("products")
          .select("id, sku, name, is_pack, barcode_wms, description")
          .in("sku", productSkuCandidates)
          .eq("comercio", order.comercio);

        if (foundProducts && foundProducts.length > 0) {
          prod =
            foundProducts.find((p: any) => p.barcode_wms && p.sku === searchSku) ||
            foundProducts.find((p: any) => p.barcode_wms) ||
            foundProducts.find((p: any) => p.sku === searchSku && !(p.description || "").startsWith("Creado automáticamente")) ||
            foundProducts.find((p: any) => p.sku === searchSku) ||
            foundProducts[0];
        }
      }

      if (!prod && searchSku) {
        const { data: ilikeProd } = await supabase
          .from("products")
          .select("id, sku, name, is_pack, barcode_wms, description")
          .eq("comercio", order.comercio)
          .ilike("sku", searchSku)
          .limit(1)
          .maybeSingle();
        if (ilikeProd) prod = ilikeProd;
      }

      if (!prod) {
        const targetSku = hasEquivalence ? mappedSku : (rawSku || fallbackSku);
        let catalogMerchantId = order.merchant_id || integ.merchant_id;
        try {
          const { data: siblingProd } = await supabase
            .from("products")
            .select("merchant_id")
            .eq("comercio", order.comercio)
            .not("barcode_wms", "is", null)
            .limit(1)
            .maybeSingle();
          if (siblingProd?.merchant_id) catalogMerchantId = siblingProd.merchant_id;
        } catch (_) {}

        const { data: newProd } = await supabase
          .from("products")
          .insert([{
            merchant_id: catalogMerchantId,
            comercio: order.comercio,
            sku: targetSku,
            name: `${item.title}${item.variant_title && item.variant_title !== "Default Title" ? " - " + item.variant_title : ""}`,
            price: item.price ? parseFloat(item.price) : 0,
            description: "Creado automáticamente desde sincronización de Shopify" + (hasEquivalence ? ` (Equivalencia de SKU: ${rawSku})` : ""),
            status: "active"
          }])
          .select("id, sku, name, is_pack")
          .single();
        prod = newProd;
      }

      if (prod) {
        const grossPrice = eqMult > 1 ? Math.round(Number(item.price || 0) / eqMult) : Math.round(Number(item.price || 0));
        const allocDisc = Array.isArray(item.discount_allocations)
          ? item.discount_allocations.reduce((s: number, a: any) => s + Number(a?.amount || 0), 0)
          : Number(item.total_discount || 0);
        const unitDisc = effectiveQty > 0 ? Math.round(allocDisc / effectiveQty) : 0;
        const effPrice = Math.max(0, grossPrice - unitDisc);

        const packMembers = packMembersMap.get(prod.id);
        if (prod.is_pack && packMembers && packMembers.length > 0) {
          const packCandidates = [prod.sku, searchLower, rawLower, cleanLower, varLower]
            .map((c) => String(c || "").trim().toLowerCase())
            .filter(Boolean);
          const matchedPackKey = packCandidates.find((k) => manualQtyBySkuLower.has(k));
          let packQty = effectiveQty;
          if (matchedPackKey) {
            if (appliedManualPackKeys.has(matchedPackKey)) {
              continue;
            }
            appliedManualPackKeys.add(matchedPackKey);
            packQty = manualQtyBySkuLower.get(matchedPackKey)!;
            protectedManualLogs.push(`Pack SKU ${prod.sku || searchSku} mantiene cantidad manual WMS (${packQty}) en lugar de Shopify (${effectiveQty}).`);
          }
          for (const pm of packMembers) {
            const currentQty = expectedQuantities.get(pm.member_product_id) || 0;
            expectedQuantities.set(pm.member_product_id, currentQty + (packQty * pm.quantity));
          }
        } else {
          const currentQty = expectedQuantities.get(prod.id) || 0;
          expectedQuantities.set(prod.id, currentQty + effectiveQty);
          registerProductCandidates(prod.id, prod.sku || searchSku, [prod.sku, searchSku, rawSku, cleanSku, varLower]);
          expectedPriceMeta.set(prod.id, {
            unit_price: grossPrice,
            discount_amount: unitDisc,
            effective_unit_price: effPrice
          });
        }
      }
    }

    // Aplicar overrides manuales de WMS una sola vez por producto consolidado (evita multiplicar si Shopify trae N líneas del mismo SKU)
    if (manualQtyBySkuLower.size > 0 || manualDeletedSet.size > 0) {
      const missingCandidateProdIds = Array.from(expectedQuantities.keys()).filter((pid) => !productManualCandidates.has(pid));
      if (missingCandidateProdIds.length > 0) {
        const { data: memberProds } = await supabase
          .from("products")
          .select("id, sku")
          .in("id", missingCandidateProdIds);
        (memberProds || []).forEach((mp: any) => {
          if (mp?.id && mp?.sku) registerProductCandidates(mp.id, mp.sku, [mp.sku]);
        });
      }

      for (const [prodId, shopifyQty] of Array.from(expectedQuantities.entries())) {
        const candidates = Array.from(productManualCandidates.get(prodId) || []);
        const displaySku = productDisplaySku.get(prodId) || candidates[0] || prodId;
        const matchedDel = candidates.find((k) => manualDeletedSet.has(k));
        if (matchedDel) {
          expectedQuantities.delete(prodId);
          protectedManualLogs.push(`SKU ${displaySku} se mantiene eliminado por ajuste manual en WMS.`);
          continue;
        }
        const matchedManualKey = candidates.find((k) => manualQtyBySkuLower.has(k));
        if (matchedManualKey) {
          const mQty = manualQtyBySkuLower.get(matchedManualKey)!;
          expectedQuantities.set(prodId, mQty);
          if (mQty !== shopifyQty) {
            protectedManualLogs.push(`SKU ${displaySku} mantiene cantidad manual WMS (${mQty}) en lugar de Shopify (${shopifyQty}).`);
          }
        }
      }
    }

    // Preservar productos agregados manualmente en WMS que no vienen en Shopify
    for (const [prodId, rows] of existingByProduct.entries()) {
      const pSku = (rows[0]?.products?.sku || "").trim();
      const pSkuLower = pSku.toLowerCase();
      if (manualAddedSet.has(pSkuLower) && !expectedQuantities.has(prodId)) {
        const manualQty = manualQtyBySkuLower.get(pSkuLower) ?? manualEdits.modified_quantities[pSku] ?? rows[0]?.quantity ?? 1;
        expectedQuantities.set(prodId, manualQty);
        protectedManualLogs.push(`Item "${rows[0]?.products?.name}" (SKU: ${pSku}) se preserva por haber sido agregado manualmente en WMS.`);
      }
    }

    // Identificar cambios aplicados desde Shopify vs existentes en WMS
    for (const [prodId, expQty] of expectedQuantities.entries()) {
      const rows = existingByProduct.get(prodId) || [];
      if (rows.length === 0) {
        appliedChangesLogs.push(`Añadido desde Shopify: ${expQty} ud(s)`);
      } else if (rows[0].quantity !== expQty) {
        appliedChangesLogs.push(`Cantidad actualizada: de ${rows[0].quantity} a ${expQty} ud(s)`);
      }
    }

    // 3. Conciliar contra existingOrderItems consolidando duplicados
    let hasTriggeredCampaignEval = false;
    for (const [prodId, expQty] of expectedQuantities.entries()) {
      const rows = existingByProduct.get(prodId) || [];
      const priceMeta = expectedPriceMeta.get(prodId);
      if (rows.length === 0) {
        await supabase
          .from("order_items")
          .insert([{
            order_id: order.id,
            product_id: prodId,
            warehouse_id: warehouseId,
            quantity: expQty,
            ...(priceMeta ? {
              unit_price: priceMeta.unit_price,
              discount_amount: priceMeta.discount_amount,
              effective_unit_price: priceMeta.effective_unit_price
            } : {})
          }]);
        hasTriggeredCampaignEval = true;
      } else {
        const primaryRow = rows[0];
        const shouldTouchForCampaigns = existingGiftItems.length === 0 && !hasTriggeredCampaignEval;
        if (primaryRow.quantity !== expQty || (warehouseId && primaryRow.warehouse_id !== warehouseId) || shouldTouchForCampaigns) {
          await supabase
            .from("order_items")
            .update({
              quantity: expQty,
              warehouse_id: warehouseId || primaryRow.warehouse_id,
            })
            .eq("id", primaryRow.id);
          hasTriggeredCampaignEval = true;
        }
        if (rows.length > 1) {
          for (let k = 1; k < rows.length; k++) {
            await supabase.from("order_items").delete().eq("id", rows[k].id);
          }
        }
      }
    }

    // 4. Eliminar de order_items aquellos productos que ya no están activos
    for (const [prodId, rows] of existingByProduct.entries()) {
      if (!expectedQuantities.has(prodId)) {
        for (const row of rows) {
          await supabase.from("order_items").delete().eq("id", row.id);
          deletedCount++;
          const pSku = row.products?.sku;
          if (pSku) {
            deletedSkusSet.add(pSku.trim());
            appliedChangesLogs.push(`Eliminado por Shopify: SKU ${pSku.trim()} (${row.quantity} ud)`);
          }
        }
      }
    }

    // Asegurar que deletedSkusSet no incluya SKUs que aún tienen unidades activas
    activeItems.forEach((item: any) => {
      const sku = (item.sku || "").trim();
      if (sku) deletedSkusSet.delete(sku);
      if (item.title || item.name) deletedSkusSet.delete((item.title || item.name).trim());
    });

    const deletedSkusList = Array.from(deletedSkusSet);
    const deletedSkusText = deletedSkusList.length > 0 
      ? `(SKU eliminados: ${deletedSkusList.join(", ")})` 
      : `(Sin SKU eliminados)`;

    let totalUpdatedUnits = 0;
    for (const qty of expectedQuantities.values()) {
      totalUpdatedUnits += qty;
    }

    // 5. Actualizar el pedido en orders respetando las ediciones manuales en WMS
    const newTotal = isWmsItemsEdited
      ? Number(order.total_value)
      : Number(shopifyOrder.current_total_price || shopifyOrder.total_price || order.total_value);

    const updatedPayload: Record<string, any> = {
      payment_status: shopifyOrder.financial_status || order.payment_status,
      cantidad: totalUpdatedUnits,
      raw_shopify_data: {
        ...shopifyOrder,
        line_items: isWmsItemsEdited ? (existingRaw.line_items || shopifyOrder.line_items) : shopifyOrder.line_items,
        shopify_original_line_items: shopifyOrder.line_items,
        ...(existingRaw.admin_notes ? { admin_notes: existingRaw.admin_notes } : {}),
        ...(existingRaw.wms_admin_notes ? { wms_admin_notes: existingRaw.wms_admin_notes } : {}),
        ...(existingRaw.wms_on_hold ? { wms_on_hold: existingRaw.wms_on_hold } : {}),
        ...(existingRaw.wms_forced_tracking ? { wms_forced_tracking: existingRaw.wms_forced_tracking } : {}),
        ...(existingRaw._is_consolidated !== undefined ? {
          _is_consolidated: existingRaw._is_consolidated,
          _consolidation_role: existingRaw._consolidation_role,
          _consolidated_into_order_id: existingRaw._consolidated_into_order_id,
          _consolidated_into_folio: existingRaw._consolidated_into_folio,
          _consolidated_children_ids: existingRaw._consolidated_children_ids,
          _consolidated_children_folios: existingRaw._consolidated_children_folios,
          _consolidated_at: existingRaw._consolidated_at,
          _consolidated_by: existingRaw._consolidated_by
        } : {}),
        ...(isWmsItemsEdited ? { wms_items_edited: true } : {}),
        ...(isWmsShippingEdited ? { wms_shipping_edited: true } : {}),
        ...((existingRaw.wms_custom_edited || isWmsItemsEdited || isWmsShippingEdited) ? { wms_custom_edited: true } : {}),
        ...(existingRaw.wms_manual_edits ? { wms_manual_edits: existingRaw.wms_manual_edits } : {})
      }
    };

    if (!isWmsItemsEdited) {
      updatedPayload.total_value = newTotal;
    }

    if (!isWmsShippingEdited) {
      updatedPayload.shipping_method = shopifyOrder.shipping_lines?.[0]?.title || order.shipping_method;
      if (shopifyOrder.shipping_address) {
        updatedPayload.shipping_address = shopifyOrder.shipping_address.address1;
        updatedPayload.shipping_city = shopifyOrder.shipping_address.city;
        updatedPayload.shipping_complement = shopifyOrder.shipping_address.address2;
        updatedPayload.customer_name = `${shopifyOrder.shipping_address.first_name || ''} ${shopifyOrder.shipping_address.last_name || ''}`.trim() || undefined;
        updatedPayload.customer_phone = shopifyOrder.shipping_address.phone || undefined;
      }
      if (shopifyOrder.contact_email || shopifyOrder.email) {
        updatedPayload.customer_email = shopifyOrder.contact_email || shopifyOrder.email;
      }
    }

    await supabase
      .from("orders")
      .update(updatedPayload)
      .eq("id", order.id);

    // 6. Notificar a WhatsApp grupo "Gestión Stocka"
    const formattedPrice = Number(order.total_value || newTotal).toLocaleString("es-CL");
    let waMsg = `ℹ️ *Pedido Re-sincronizado desde Shopify*\n\n` +
      `🏪 *Comercio:* ${order.comercio}\n` +
      `📦 *Pedido:* ${order.external_order_number || order.id}\n` +
      `🏷️ *Estado WMS:* En procesamiento\n` +
      `💰 *Total:* $${formattedPrice} (${totalUpdatedUnits} uds.)\n` +
      `🛒 *SKU activos:* ${expectedQuantities.size} ${deletedSkusText}\n\n`;

    if (appliedChangesLogs.length > 0) {
      waMsg += `📋 *Cambios aplicados desde Shopify:*\n` + appliedChangesLogs.map(c => `• ${c}`).join('\n') + '\n\n';
    }

    if (protectedManualLogs.length > 0) {
      waMsg += `🛡️ *Ajustes manuales WMS protegidos:*\n` + protectedManualLogs.map(p => `• ${p}`).join('\n') + '\n\n';
    }

    if (!silent) {
      notifyWhatsAppGestion(waMsg.trim()).catch(() => {});
    }

    let respMessage = `Pedido ${order.external_order_number || order.id} re-sincronizado exitosamente desde Shopify.`;
    if (protectedManualLogs.length > 0) {
      respMessage += ` Se protegieron los ajustes manuales previos de bodega.`;
    }

    return new Response(JSON.stringify({
      success: true,
      activeItemsCount: expectedQuantities.size,
      totalUnits: totalUpdatedUnits,
      deletedItemsCount: deletedCount,
      deletedSkus: deletedSkusList,
      totalValue: newTotal,
      paymentStatus: updatedPayload.payment_status,
      wmsItemsProtected: isWmsItemsEdited,
      protectedActions: protectedManualLogs,
      appliedChanges: appliedChangesLogs,
      message: respMessage
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err: any) {
    console.error("[Resync Shopify Order Error]:", err);
    return new Response(JSON.stringify({ error: err.message || "Error interno del servidor" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
