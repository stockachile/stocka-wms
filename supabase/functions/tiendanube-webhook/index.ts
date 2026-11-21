import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// Configuración cliente Supabase (usando variables de entorno inyectadas por el entorno de Supabase)
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);


function extractTiendanubeCustomerName(order: any): string {
  const addr = order.shipping_address;
  let name = "";
  if (addr) {
    if (addr.name && addr.name.trim()) {
      name = addr.name.trim();
    } else if (addr.recipient_name && addr.recipient_name.trim()) {
      name = addr.recipient_name.trim();
    } else {
      const combined = `${addr.first_name || ""} ${addr.last_name || ""}`.trim();
      if (combined) name = combined;
    }
  }

  if (!name) {
    if (order.contact_name && order.contact_name.trim()) {
      name = order.contact_name.trim();
    } else if (order.customer?.name && order.customer.name.trim()) {
      name = order.customer.name.trim();
    } else {
      const custCombined = `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim();
      if (custCombined) name = custCombined;
    }
  }

  if (!name && order.billing_address) {
    if (typeof order.billing_address === "object" && order.billing_address.name && order.billing_address.name.trim()) {
      name = order.billing_address.name.trim();
    }
  }

  return name || "Cliente Tiendanube";
}

function extractTiendanubeName(rawName: any, fallback = "Producto Tiendanube"): string {
  if (!rawName) return fallback;
  if (typeof rawName === "string") return rawName.trim();
  if (typeof rawName === "object") {
    return String(rawName.es || rawName.pt || Object.values(rawName)[0] || fallback).trim();
  }
  return String(rawName);
}

function extractTiendanubeVariantValues(variantValues: any): string[] {
  if (!variantValues) return [];
  const parts: string[] = [];
  if (Array.isArray(variantValues)) {
    for (const item of variantValues) {
      if (!item) continue;
      if (typeof item === "string") {
        const trimmed = item.trim();
        if (trimmed) parts.push(trimmed);
      } else if (typeof item === "object") {
        const val = item.es || item.pt || item.en || Object.values(item)[0];
        if (val && typeof val === "string") {
          const trimmed = val.trim();
          if (trimmed) parts.push(trimmed);
        }
      }
    }
  } else if (typeof variantValues === "object") {
    for (const k of Object.keys(variantValues)) {
      const item = variantValues[k];
      if (!item) continue;
      if (typeof item === "string") {
        const trimmed = item.trim();
        if (trimmed) parts.push(trimmed);
      } else if (typeof item === "object") {
        const val = item.es || item.pt || item.en || Object.values(item)[0];
        if (val && typeof val === "string") {
          const trimmed = val.trim();
          if (trimmed) parts.push(trimmed);
        }
      }
    }
  } else if (typeof variantValues === "string") {
    const trimmed = variantValues.trim();
    if (trimmed) parts.push(trimmed);
  }
  return parts;
}

serve(async (req) => {
  // Solo aceptamos POST
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const rawBody = await req.text();
    let payload: any = {};
    try {
      payload = JSON.parse(rawBody);
    } catch (_e) {
      return new Response("Invalid JSON body", { status: 400 });
    }

    // 1. Obtener cabeceras de Tiendanube (o evento desde el payload)
    const signatureHeader = req.headers.get("x-linkedstore-hmac-sha256") || req.headers.get("x-linkedstore-signature") || "";
    const eventTopic = req.headers.get("x-linkedstore-event") || payload.event || "";

    if (!eventTopic) {
      return new Response("Missing Tiendanube event header", { status: 400 });
    }

    // 2. Resolver la integración priorizando ?comercio= y payload.store_id (soporte multi-comercio/conglomerado)
    const url = new URL(req.url);
    let merchantId = (url.searchParams.get("merchant_id") || "").trim();
    const comercioParam = (url.searchParams.get("comercio") || "").trim();
    const storeIdFromPayload = payload.store_id ? String(payload.store_id).replace(/[^0-9]/g, "").trim() : "";

    let integration: any = null;

    if (comercioParam) {
      const { data: intByCom } = await supabase
        .from("merchant_integrations")
        .select("merchant_id, webhook_secret, comercio, access_token, shop_url, is_main")
        .ilike("comercio", comercioParam)
        .eq("platform", "Tiendanube")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1);
      if (intByCom && intByCom.length > 0) {
        integration = intByCom[0];
        merchantId = integration.merchant_id || merchantId;
      }
    }

    if (!integration && storeIdFromPayload) {
      const { data: intByStoreList } = await supabase
        .from("merchant_integrations")
        .select("merchant_id, webhook_secret, comercio, access_token, shop_url, is_main")
        .eq("platform", "Tiendanube")
        .eq("is_active", true)
        .ilike("shop_url", `%${storeIdFromPayload}%`)
        .limit(10);

      if (intByStoreList && intByStoreList.length > 0) {
        const exactStoreMatch = intByStoreList.find(
          (row: any) => String(row.shop_url || "").replace(/[^0-9]/g, "") === storeIdFromPayload
        );
        const chosen = exactStoreMatch || (intByStoreList.length === 1 ? intByStoreList[0] : null);
        if (chosen) {
          integration = chosen;
          merchantId = chosen.merchant_id || merchantId;
        }
      }
    }

    if (!integration && merchantId) {
      // Fallback legacy por merchant_id solo cuando NO hay ambigüedad (única tienda Tiendanube activa)
      const { data: intList, error: intError } = await supabase
        .from("merchant_integrations")
        .select("merchant_id, webhook_secret, comercio, access_token, shop_url, is_main")
        .eq("merchant_id", merchantId)
        .eq("platform", "Tiendanube")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(2);

      if (intError) {
        console.error("Error fetching merchant integration:", intError);
        return new Response("Internal Server Error", { status: 500 });
      }
      if (intList && intList.length === 1) {
        integration = intList[0];
      } else if (intList && intList.length > 1) {
        console.error(`[Tiendanube Webhook] Ambigüedad: merchant_id ${merchantId} tiene múltiples tiendas Tiendanube activas y no se pudo resolver por ?comercio= ni store_id (${storeIdFromPayload || "vacío"}).`);
      }
    }

    if (!integration) {
      console.error(`Integration not configured for comercio: ${comercioParam} / merchant_id: ${merchantId} / store_id: ${storeIdFromPayload}`);
      return new Response("Integration not configured", { status: 200 }); // Retornar 200 para evitar reintentos infinitos si el merchant se borró
    }

    // 4. Verificación de Seguridad HMAC (obligatoria si la integración tiene webhook_secret)
    if (integration.webhook_secret) {
      if (!signatureHeader) {
        console.error("Falta cabecera de firma HMAC en petición de Tiendanube");
        return new Response("Missing signature header", { status: 401 });
      }

      const keyBuf = new TextEncoder().encode(integration.webhook_secret.trim());
      const key = await crypto.subtle.importKey(
        "raw",
        keyBuf,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const dataBuf = new TextEncoder().encode(rawBody);
      const signature = await crypto.subtle.sign("HMAC", key, dataBuf);
      const signatureHex = Array.from(new Uint8Array(signature))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      if (signatureHex !== signatureHeader.toLowerCase()) {
        console.error("Firma HMAC inválida para Tiendanube webhook");
        return new Response("Unauthorized: Invalid signature", { status: 401 });
      }
    }

    // Resolver dinámicamente el merchant_id real del comercio si ya tiene productos creados
    let activeMerchantId = merchantId;
    if (integration.comercio) {
      try {
        const { data: siblingProd } = await supabase
          .from("products")
          .select("merchant_id")
          .eq("comercio", integration.comercio)
          .limit(1)
          .maybeSingle();
        if (siblingProd && siblingProd.merchant_id) {
          activeMerchantId = siblingProd.merchant_id;
        }
      } catch (_) {}
    }

    const storeId = storeIdFromPayload || String(integration.shop_url || "").replace(/[^0-9]/g, "");
    const accessToken = (integration.access_token || "").trim();
    const apiHeaders = {
      "Authentication": `bearer ${accessToken}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
      "User-Agent": "StockaWMS (integraciones@stocka.cl)"
    };

    const resourceId = payload.id ? payload.id.toString() : "N/A";
    console.log(`Recibido Webhook Tiendanube: ${eventTopic} para ID #${resourceId} (Comercio: ${integration.comercio})`);

    // 6. Lógica según el Event Topic
    if (eventTopic.startsWith("order/")) {
      let fullOrder = payload;
      if (!Array.isArray(fullOrder.products) && payload.id && storeId && accessToken) {
        const orderRes = await fetch(`https://api.tiendanube.com/v1/${storeId}/orders/${payload.id}`, {
          method: "GET",
          headers: apiHeaders
        });
        if (orderRes.ok) {
          fullOrder = await orderRes.json();
        }
      }

      if (eventTopic === "order/created") {
        await handleOrderCreate(activeMerchantId, integration.comercio, fullOrder);
      } else {
        await handleOrderUpdate(activeMerchantId, integration.comercio, fullOrder);
      }
    } 
    else if (eventTopic === "product/created" || eventTopic === "product/updated") {
      let fullProduct = payload;
      if (!Array.isArray(fullProduct.variants) && payload.id && storeId && accessToken) {
        const prodRes = await fetch(`https://api.tiendanube.com/v1/${storeId}/products/${payload.id}`, {
          method: "GET",
          headers: apiHeaders
        });
        if (prodRes.ok) {
          fullProduct = await prodRes.json();
        }
      }

      if (fullProduct && Array.isArray(fullProduct.variants)) {
        await handleProductSave(activeMerchantId, integration.comercio, fullProduct);
      }
    }

    return new Response("Webhook processed", { status: 200 });

  } catch (error) {
    console.error("Error procesando webhook Tiendanube:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
});


// ==========================================
// FUNCIONES DE MANEJO DE ORDENES
// ==========================================

async function resolveTiendanubeOrderNumber(comercio: string, rawOrderNumber: string): Promise<{ orderNumber: string; finalOrderNumber: string }> {
  let orderNumber = (rawOrderNumber || "").toString().trim();
  let siglaComercio = "";
  let prefijoOrigen = "";
  let agregarPrefijo = true;

  if (comercio) {
    try {
      const { data: configData } = await supabase
        .from("v_comercios_config")
        .select("sigla")
        .eq("nombre", comercio)
        .maybeSingle();

      if (configData && configData.sigla) {
        siglaComercio = configData.sigla.trim().toUpperCase();
      }

      const { data: adicionalConfig } = await supabase
        .from("comercios_adicional_config")
        .select("pedido_trae_sigla, plat_siglas_config")
        .eq("comercio", comercio)
        .maybeSingle();

      if (adicionalConfig) {
        const platConfig = (adicionalConfig.plat_siglas_config || {})["Tiendanube"];
        if (platConfig) {
          agregarPrefijo = platConfig.agregar_prefijo !== false;
          prefijoOrigen = (platConfig.prefijo_origen || "").trim().toUpperCase();
        } else {
          agregarPrefijo = !adicionalConfig.pedido_trae_sigla;
        }
      }
    } catch (err: any) {
      console.error("⚠️ Error consultando sigla de comercio en Tiendanube:", err.message);
    }
  }

  if (prefijoOrigen && orderNumber.toUpperCase().startsWith(prefijoOrigen)) {
    orderNumber = orderNumber.substring(prefijoOrigen.length).trim();
  }

  let finalOrderNumber = orderNumber;
  if (agregarPrefijo && siglaComercio) {
    if (!orderNumber.toUpperCase().startsWith(siglaComercio)) {
      finalOrderNumber = `${siglaComercio}${orderNumber}`;
    }
  }

  return { orderNumber, finalOrderNumber };
}

async function loadTiendanubeSkuMap(comercio: string): Promise<Record<string, string>> {
  const skuMap: Record<string, string> = {};
  if (!comercio) return skuMap;
  try {
    const { data: equivalences } = await supabase
      .from("sku_equivalences")
      .select("platform_sku, master_sku, platform")
      .eq("comercio", comercio);

    if (equivalences) {
      equivalences
        .filter((e: any) => e.platform === "Todas")
        .forEach((e: any) => {
          if (e.platform_sku && e.master_sku) {
            const clean = e.platform_sku.trim().replace(/\s+/g, "");
            skuMap[clean] = e.master_sku.trim();
            skuMap[clean.toUpperCase()] = e.master_sku.trim();
          }
        });
      equivalences
        .filter((e: any) => e.platform === "Tiendanube")
        .forEach((e: any) => {
          if (e.platform_sku && e.master_sku) {
            const clean = e.platform_sku.trim().replace(/\s+/g, "");
            skuMap[clean] = e.master_sku.trim();
            skuMap[clean.toUpperCase()] = e.master_sku.trim();
          }
        });
    }
  } catch (err: any) {
    console.error("⚠️ Error cargando equivalencias de SKU:", err.message);
  }
  return skuMap;
}

async function resolveMerchantWarehouseId(comercio: string, merchantId: string): Promise<string | null> {
  if (comercio) {
    const { data: adicCfg } = await supabase
      .from("comercios_adicional_config")
      .select("default_warehouse_id")
      .eq("comercio", comercio)
      .maybeSingle();
    if (adicCfg?.default_warehouse_id) {
      return adicCfg.default_warehouse_id;
    }
  }

  if (merchantId) {
    const { data: whRelation } = await supabase
      .from("merchants_warehouses")
      .select("warehouse_id")
      .eq("merchant_id", merchantId)
      .limit(1)
      .maybeSingle();
    if (whRelation?.warehouse_id) {
      return whRelation.warehouse_id;
    }
  }

  const { data: defaultWh } = await supabase
    .from("warehouses")
    .select("id")
    .limit(1)
    .maybeSingle();
  return defaultWh?.id || null;
}

function buildTiendanubeFlatOrderItems(orderProducts: any[], skuMap: Record<string, string>) {
  const itemNames: string[] = [];
  const itemQuantities: Record<string, number> = {};
  const itemDetailsBySku: Record<string, any> = {};

  for (const item of (orderProducts || [])) {
    let rawSku = item.sku || `TN-${item.product_id}${item.variant_id ? "-" + item.variant_id : ""}`;
    rawSku = String(rawSku).trim().replace(/\s+/g, "");
    const mappedSku = skuMap[rawSku] || skuMap[rawSku.toUpperCase()] || rawSku;
    const qty = Number(item.quantity || 0);
    if (qty <= 0) continue;

    itemQuantities[mappedSku] = (itemQuantities[mappedSku] || 0) + qty;
    if (!itemDetailsBySku[mappedSku]) {
      itemDetailsBySku[mappedSku] = item;
    }

    const name = extractTiendanubeName(item.name, "Producto");
    if (name && !itemNames.includes(name)) {
      itemNames.push(name);
    }
  }

  return {
    itemQuantities,
    itemDetailsBySku,
    flatSku: Object.keys(itemQuantities).join(", "),
    flatItemName: itemNames.join(", "),
    flatQuantity: Object.values(itemQuantities).reduce((sum, qty) => sum + qty, 0)
  };
}

/**
 * Sincroniza y reconcilia de forma idempotente y segura ante concurrencia los order_items
 * de un pedido Tiendanube, evitando duplicación por carrera entre order/created y order/updated
 * con el trigger expand_pack_order_items().
 */
async function reconcileTiendanubeOrderItems(
  orderId: string,
  merchantId: string,
  comercio: string,
  orderProducts: any[],
  skuMap: Record<string, string>
) {
  const { itemQuantities, itemDetailsBySku } = buildTiendanubeFlatOrderItems(orderProducts, skuMap);
  const warehouseId = await resolveMerchantWarehouseId(comercio, merchantId);

  const expectedQuantities = new Map<string, number>();

  for (const [sku, qty] of Object.entries(itemQuantities)) {
    let { data: product } = await supabase
      .from("products")
      .select("id, is_pack")
      .eq("sku", sku)
      .eq("comercio", comercio)
      .limit(1)
      .maybeSingle();

    if (!product) {
      const { data: ilikeProd } = await supabase
        .from("products")
        .select("id, is_pack, image_url")
        .eq("comercio", comercio)
        .ilike("sku", sku)
        .limit(1)
        .maybeSingle();
      if (ilikeProd) product = ilikeProd;
    }

    const itemDetail = itemDetailsBySku[sku];
    const itemImageUrl = itemDetail?.image?.src || (typeof itemDetail?.image === "string" ? itemDetail.image : null);

    if (product && !(product as any).image_url && itemImageUrl) {
      await supabase.from("products").update({ image_url: itemImageUrl }).eq("id", product.id);
      (product as any).image_url = itemImageUrl;
    }

    if (!product) {
      const pName = extractTiendanubeName(itemDetail?.name, "Producto Tiendanube " + sku);
      const productPrice = Number(itemDetail?.price || 0);

      const { data: newProd, error: prodErr } = await supabase
        .from("products")
        .insert([{
          merchant_id: merchantId,
          comercio: comercio,
          sku: sku,
          name: pName,
          price: productPrice,
          image_url: itemImageUrl,
          status: "active",
          description: "Creado automáticamente desde webhook de Tiendanube"
        }])
        .select("id, is_pack, image_url")
        .single();

      if (!prodErr && newProd) {
        console.log(`Creado producto faltante SKU ${sku} en catálogo.`);
        product = newProd;
      } else {
        // Si otro webhook concurrente acaba de crear el mismo SKU, recuperarlo
        const { data: retryProd } = await supabase
          .from("products")
          .select("id, is_pack")
          .eq("comercio", comercio)
          .ilike("sku", sku)
          .limit(1)
          .maybeSingle();
        if (retryProd) {
          product = retryProd;
        } else {
          console.error(`Error auto-creando producto SKU ${sku}:`, prodErr);
        }
      }
    }

    if (product) {
      if (product.is_pack) {
        const { data: packMembers } = await supabase
          .from("product_pack_items")
          .select("member_product_id, quantity")
          .eq("pack_product_id", product.id);

        if (packMembers && packMembers.length > 0) {
          for (const pm of packMembers) {
            const cur = expectedQuantities.get(pm.member_product_id) || 0;
            expectedQuantities.set(pm.member_product_id, cur + Number(pm.quantity || 1) * Number(qty));
          }
        } else {
          const cur = expectedQuantities.get(product.id) || 0;
          expectedQuantities.set(product.id, cur + Number(qty));
        }
      } else {
        const cur = expectedQuantities.get(product.id) || 0;
        expectedQuantities.set(product.id, cur + Number(qty));
      }
    }
  }

  // Leer ítems actuales agrupando TODAS las filas regulares por product_id (para detectar y limpiar duplicados)
  const { data: existingItems } = await supabase
    .from("order_items")
    .select("id, product_id, quantity, warehouse_id, is_gift, campaign_id, tag")
    .eq("order_id", orderId);

  const existingByProduct = new Map<string, any[]>();
  for (const item of (existingItems || [])) {
    if (item.is_gift || item.campaign_id || item.tag === "Campaña" || item.tag === "Eliminado") continue;
    if (!existingByProduct.has(item.product_id)) {
      existingByProduct.set(item.product_id, []);
    }
    existingByProduct.get(item.product_id)!.push(item);
  }

  for (const [prodId, expQty] of expectedQuantities.entries()) {
    const rows = existingByProduct.get(prodId) || [];

    if (rows.length > 0) {
      const primaryRow = rows[0];
      const targetWh = primaryRow.warehouse_id || warehouseId;
      if (Number(primaryRow.quantity) !== expQty || (!primaryRow.warehouse_id && warehouseId)) {
        await supabase
          .from("order_items")
          .update({
            quantity: expQty,
            warehouse_id: targetWh
          })
          .eq("id", primaryRow.id);
      }
      if (rows.length > 1) {
        for (let k = 1; k < rows.length; k++) {
          await supabase.from("order_items").delete().eq("id", rows[k].id);
        }
      }
    } else {
      const { error: itemErr } = await supabase
        .from("order_items")
        .insert([{
          order_id: orderId,
          product_id: prodId,
          warehouse_id: warehouseId,
          quantity: expQty
        }]);

      if (itemErr) {
        console.error(`Error insertando item product_id ${prodId} en order_items:`, itemErr);
      }
    }
  }

  // Eliminar ítems regulares que ya no estén presentes en la orden de Tiendanube
  for (const [prodId, rows] of existingByProduct.entries()) {
    if (!expectedQuantities.has(prodId)) {
      for (const r of rows) {
        await supabase.from("order_items").delete().eq("id", r.id);
      }
    }
  }

  // Verificación post-escritura: si un webhook simultáneo disparó la suma del trigger
  // expand_pack_order_items() o insertó una fila paralela en el mismo milisegundo, consolidar a expQty exacto
  const { data: postRows } = await supabase
    .from("order_items")
    .select("id, product_id, quantity, is_gift, campaign_id, tag")
    .eq("order_id", orderId);

  const postByProduct = new Map<string, any[]>();
  for (const r of (postRows || [])) {
    if (r.is_gift || r.campaign_id || r.tag === "Campaña" || r.tag === "Eliminado") continue;
    if (!postByProduct.has(r.product_id)) postByProduct.set(r.product_id, []);
    postByProduct.get(r.product_id)!.push(r);
  }

  for (const [prodId, rows] of postByProduct.entries()) {
    const expQty = expectedQuantities.get(prodId);
    if (expQty === undefined) {
      for (const r of rows) {
        await supabase.from("order_items").delete().eq("id", r.id);
      }
    } else {
      if (Number(rows[0].quantity) !== expQty) {
        await supabase.from("order_items").update({ quantity: expQty }).eq("id", rows[0].id);
      }
      for (let k = 1; k < rows.length; k++) {
        await supabase.from("order_items").delete().eq("id", rows[k].id);
      }
    }
  }
}

async function handleOrderCreate(merchantId: string, comercio: string, order: any) {
  const orderId = order.id.toString();
  const rawOrderNumber = order.number ? order.number.toString() : orderId;
  const { orderNumber, finalOrderNumber } = await resolveTiendanubeOrderNumber(comercio, rawOrderNumber);

  // Verificamos que no exista (buscando por comercio para evitar colisiones multicuentas)
  const { data: existing } = await supabase
    .from("orders")
    .select("id")
    .eq("comercio", comercio)
    .in("external_order_number", [orderNumber, finalOrderNumber])
    .limit(1)
    .maybeSingle();

  if (existing) {
    console.log(`El pedido Tiendanube ${finalOrderNumber} ya existe en WMS, omitiendo inserción.`);
    return;
  }

  const skuMap = await loadTiendanubeSkuMap(comercio);
  const { flatSku, flatItemName, flatQuantity } = buildTiendanubeFlatOrderItems(order.products || [], skuMap);
  const totalValue = Number(order.total || 0);

  const addr = order.shipping_address;
  let addressString = "No especificada";
  let complementString = "";
  if (addr) {
    addressString = `${addr.address || ""} ${addr.number || ""}`.trim() || "No especificada";
    complementString = [addr.floor, addr.locality, addr.province, addr.zipcode].filter(Boolean).join(", ");
  }

  const customerName = extractTiendanubeCustomerName(order);
  const statusName = order.status;
  const paymentStatus = order.payment_status;
  const isDelivered = order.shipping_status === "delivered";
  const isCancelled = statusName === "cancelled" || ["voided", "refunded"].includes(paymentStatus);

  let initialStatus = "para procesar";
  let initialEstadoWms = "En procesamiento";
  if (isCancelled) {
    initialStatus = "cancelado";
    initialEstadoWms = "Cancelado";
  } else if (isDelivered || statusName === "closed") {
    initialStatus = "despachado";
    initialEstadoWms = "Despachado";
  }

  const orderData = {
    merchant_id: merchantId,
    comercio: comercio,
    external_order_number: finalOrderNumber,
    external_platform: "Tiendanube",
    payment_status: paymentStatus === "paid" ? "PAID" : "PENDING",
    total_value: totalValue,
    customer_email: order.contact_email || order.customer?.email || "no-email@tiendanube.com",
    customer_phone: addr?.phone || order.contact_phone || "No especificado",
    customer_name: customerName,
    shipping_address: addressString,
    shipping_city: addr?.city || "No especificada",
    shipping_complement: complementString,
    shipping_method: order.shipping_option || "Por definir",
    raw_tiendanube_data: order,
    origen: "Tiendanube",
    item: flatItemName,
    cantidad: flatQuantity,
    sku: flatSku,
    status: initialStatus,
    estado_wms: initialEstadoWms
  };

  // Insertar la cabecera del pedido
  const { data: newOrder, error: orderErr } = await supabase
    .from("orders")
    .insert([orderData])
    .select("id")
    .single();

  if (orderErr || !newOrder) {
    console.error("Error creando pedido Tiendanube:", orderErr);
    return;
  }

  console.log(`Creado pedido cabecera Tiendanube ${finalOrderNumber} con ID: ${newOrder.id}`);

  await reconcileTiendanubeOrderItems(newOrder.id, merchantId, comercio, order.products || [], skuMap);
}

async function handleOrderUpdate(merchantId: string, comercio: string, order: any) {
  const orderId = order.id.toString();
  const rawOrderNumber = order.number ? order.number.toString() : orderId;
  const { orderNumber, finalOrderNumber } = await resolveTiendanubeOrderNumber(comercio, rawOrderNumber);

  // Buscamos el estado actual del pedido en WMS por comercio
  const { data: existingOrder, error: findErr } = await supabase
    .from("orders")
    .select("id, status, estado_wms, raw_tiendanube_data, total_value, sku, item, cantidad, customer_name, customer_email, customer_phone, shipping_address, shipping_city, shipping_complement")
    .eq("comercio", comercio)
    .in("external_order_number", [orderNumber, finalOrderNumber])
    .limit(1)
    .maybeSingle();

  if (findErr || !existingOrder) {
    console.log(`Pedido ${finalOrderNumber} no encontrado en WMS, ignorando actualización.`);
    return;
  }

  const existingRaw = (existingOrder as any).raw_tiendanube_data || {};
  const isWmsItemsEdited = (existingOrder as any).wms_items_edited === true || existingRaw.wms_items_edited === true;
  const isWmsShippingEdited = (existingOrder as any).wms_shipping_edited === true || existingRaw.wms_shipping_edited === true;

  const statusName = order.status;
  const paymentStatus = order.payment_status;
  const isCancelled = statusName === "cancelled" || ["voided", "refunded"].includes(paymentStatus);

  const currentWmsState = (existingOrder.estado_wms || "En procesamiento").trim().toLowerCase();
  const estadosWmsProtegidos = ["en preparación", "pickeado", "listo para retiro", "despachado", "incidencia", "entregado", "retirado", "archivado"];
  const isProtectedState = estadosWmsProtegidos.includes(currentWmsState);

  const addr = order.shipping_address;
  let addressString = "No especificada";
  let complementString = "";
  if (addr) {
    addressString = `${addr.address || ""} ${addr.number || ""}`.trim() || "No especificada";
    complementString = [addr.floor, addr.locality, addr.province, addr.zipcode].filter(Boolean).join(", ");
  }

  const customerName = extractTiendanubeCustomerName(order);
  const skuMap = await loadTiendanubeSkuMap(comercio);
  const { flatSku, flatItemName, flatQuantity } = buildTiendanubeFlatOrderItems(order.products || [], skuMap);

  // Preparamos datos a actualizar protegiendo modificaciones manuales del WMS
  const updatedData: Record<string, any> = {
    payment_status: paymentStatus === "paid" ? "PAID" : "PENDING",
    shipping_method: order.shipping_option || "Por definir",
    raw_tiendanube_data: {
      ...order,
      ...(existingRaw.line_items ? { line_items: existingRaw.line_items } : {}),
      ...(existingRaw.wms_manual_edits ? { wms_manual_edits: existingRaw.wms_manual_edits } : {}),
      ...(isWmsItemsEdited ? { wms_items_edited: true } : {}),
      ...(isWmsShippingEdited ? { wms_shipping_edited: true } : {}),
      ...((existingRaw.wms_custom_edited || isWmsItemsEdited || isWmsShippingEdited) ? { wms_custom_edited: true } : {})
    }
  };

  if (!isWmsItemsEdited && !isProtectedState) {
    updatedData.total_value = Number(order.total || 0);
    updatedData.sku = flatSku;
    updatedData.item = flatItemName;
    updatedData.cantidad = flatQuantity;
  }

  if (!isWmsShippingEdited && !isProtectedState) {
    updatedData.customer_phone = addr?.phone || order.contact_phone || "No especificado";
    updatedData.customer_name = customerName;
    updatedData.shipping_address = addressString;
    updatedData.shipping_city = addr?.city || "No especificada";
    updatedData.shipping_complement = complementString;
  }

  if (isCancelled) {
    updatedData.status = "cancelado";
    if (!isProtectedState) {
      updatedData.estado_wms = "Cancelado";
    }
  }

  // Actualizamos en BD
  const { error: upErr } = await supabase
    .from("orders")
    .update(updatedData)
    .eq("id", existingOrder.id);

  if (upErr) {
    console.error("Error actualizando pedido Tiendanube:", upErr);
    return;
  }

  if (isWmsItemsEdited) {
    console.log(`Pedido Tiendanube ${finalOrderNumber} fue editado manualmente en WMS. Omitiendo sobrescritura de order_items.`);
    return;
  }

  // Lógica de Alertas de Pedido (WMS ya preparando o despachando)
  const wmsStatus = existingOrder.estado_wms || "En procesamiento";
  const estadosCriticos = ["en preparación", "pickeado", "listo para retiro", "despachado", "incidencia"];

  if (estadosCriticos.includes(currentWmsState)) {
    let alertMessage = `El pedido Tiendanube ${finalOrderNumber} ha sido modificado en la tienda mientras estaba en WMS con estado: ${wmsStatus}.`;
    let alertType = "MODIFICADO_EN_PREPARACION";

    if (isCancelled) {
      alertMessage = `¡CRÍTICO! El pedido Tiendanube ${finalOrderNumber} ha sido CANCELADO en la tienda, pero en el WMS tiene estado: ${wmsStatus}. Detener despacho de inmediato.`;
      alertType = "CANCELADO_EN_PREPARACION";
    }

    const { error: alertErr } = await supabase
      .from("order_alerts")
      .insert([{
        merchant_id: merchantId,
        order_id: existingOrder.id,
        alert_type: alertType,
        message: alertMessage
      }]);

    if (alertErr) console.error("Error creando alerta de pedido:", alertErr);
  } else if (!isCancelled && !isProtectedState) {
    await reconcileTiendanubeOrderItems(existingOrder.id, merchantId, comercio, order.products || [], skuMap);
    console.log(`Ítems reconciliados con éxito para el pedido Tiendanube ${finalOrderNumber}`);
  }
}

// ==========================================
// FUNCIONES DE MANEJO DE PRODUCTOS (REAL-TIME)
// ==========================================

async function handleProductSave(merchantId: string, comercio: string, product: any) {
  const productName = extractTiendanubeName(product.name, "Producto sin nombre");
  console.log(`Sincronizando producto Tiendanube ID ${product.id} ("${productName}") vía Webhook para ${comercio}`);

  const mainImageUrl = product.images && product.images.length > 0 ? product.images[0].src : null;
  const status = product.published ? "published" : "hidden";

  // Verificar si Tiendanube es el catálogo principal del comercio (o única plataforma activa)
  let shouldSyncToMasterCatalog = true;
  try {
    const { data: activeInts } = await supabase
      .from("merchant_integrations")
      .select("platform, is_main")
      .eq("comercio", comercio)
      .eq("is_active", true);

    const salesInts = (activeInts || []).filter((i: any) => i.platform !== "Optiroute");
    const explicitMain = salesInts.find((i: any) => i.is_main);
    if (explicitMain && explicitMain.platform !== "Tiendanube") {
      shouldSyncToMasterCatalog = false;
    }
  } catch (err: any) {
    console.warn("⚠️ Aviso al verificar plataforma principal en webhook Tiendanube:", err.message);
  }

  // Cargar equivalencias de SKU
  const skuMap: Record<string, string> = {};
  try {
    const { data: equivalences } = await supabase
      .from("sku_equivalences")
      .select("platform_sku, master_sku, platform")
      .eq("comercio", comercio);

    if (equivalences) {
      equivalences
        .filter((e: any) => e.platform === "Todas" || e.platform === "Tiendanube")
        .forEach((e: any) => {
          if (e.platform_sku && e.master_sku) {
            skuMap[e.platform_sku.trim().replace(/\s+/g, "").toUpperCase()] = e.master_sku.trim();
          }
        });
    }
  } catch (_) {}

  const seenSkus = new Set<string>();
  const syncedRows: any[] = [];

  for (const variant of (product.variants || [])) {
    let variantSku = variant.sku || "";
    let cleanSku = String(variantSku).trim().replace(/\s+/g, "");
    if (!cleanSku) {
      cleanSku = `TN-${product.id}-${variant.id}`;
    }

    const upperSku = cleanSku.toUpperCase();
    if (seenSkus.has(upperSku)) {
      let suffixIndex = 1;
      let newSku = `${cleanSku}-DUP-${suffixIndex}`;
      while (seenSkus.has(newSku.toUpperCase())) {
        suffixIndex++;
        newSku = `${cleanSku}-DUP-${suffixIndex}`;
      }
      cleanSku = newSku;
    }
    seenSkus.add(cleanSku.toUpperCase());

    let imageUrl = mainImageUrl;
    if (variant.image_id && Array.isArray(product.images)) {
      const matchedImg = product.images.find((img: any) => img.id === variant.image_id);
      if (matchedImg && matchedImg.src) {
        imageUrl = matchedImg.src;
      }
    }

    const variantNameParts = extractTiendanubeVariantValues(variant.values);
    const finalName = variantNameParts.length > 0 ? `${productName} - ${variantNameParts.join(" / ")}` : productName;
    const cleanBarcode = variant.barcode ? String(variant.barcode).trim() : null;
    const variantPrice = parseFloat(variant.price) || 0;

    syncedRows.push({
      comercio,
      platform: "Tiendanube",
      sku: cleanSku,
      name: finalName,
      image_url: imageUrl,
      status,
      price: variantPrice,
      barcode: cleanBarcode
    });

    if (shouldSyncToMasterCatalog && comercio) {
      const targetSku = skuMap[cleanSku.toUpperCase()] || cleanSku;
      const { data: existingProd } = await supabase
        .from("products")
        .select("id, image_url")
        .eq("comercio", comercio)
        .ilike("sku", targetSku)
        .limit(1)
        .maybeSingle();

      if (existingProd && !existingProd.image_url && imageUrl) {
        await supabase.from("products").update({ image_url: imageUrl }).eq("id", existingProd.id);
      }

      if (!existingProd) {
        const largo = parseFloat(variant.depth) || 10;
        const ancho = parseFloat(variant.width) || 10;
        const alto = parseFloat(variant.height) || 10;
        const volumen = (largo * ancho * alto) / 1000000 || 0.0001;
        const weightKg = parseFloat(variant.weight) || null;

        const { error: prodInsErr } = await supabase
          .from("products")
          .insert([{
            merchant_id: merchantId,
            comercio,
            sku: targetSku,
            name: finalName,
            price: variantPrice,
            barcode: cleanBarcode,
            image_url: imageUrl,
            volumen,
            largo,
            ancho,
            alto,
            weight: weightKg,
            status: "active",
            description: "Importado automáticamente de Tiendanube",
            tiendanube_product_id: String(product.id),
            tiendanube_variant_id: String(variant.id),
            raw_tiendanube_data: variant
          }]);

        if (prodInsErr) {
          console.error(`Error al auto-crear producto SKU ${targetSku} en products:`, prodInsErr);
        } else {
          console.log(`✨ Producto nuevo SKU ${targetSku} creado automáticamente en products vía Webhook Tiendanube.`);
        }
      }
    }
  }

  if (syncedRows.length > 0) {
    const { error: syncErr } = await supabase
      .from("synced_products")
      .upsert(syncedRows, { onConflict: "comercio,platform,sku" });

    if (syncErr) {
      console.error("Error actualizando synced_products desde webhook Tiendanube:", syncErr);
    } else {
      console.log(`📥 ${syncedRows.length} variante(s) actualizadas en synced_products vía Webhook Tiendanube.`);
    }
  }
}
