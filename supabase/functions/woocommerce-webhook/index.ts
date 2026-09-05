import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// Configuración cliente Supabase
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-wc-webhook-topic, x-wc-webhook-resource, x-wc-webhook-event, x-wc-webhook-signature, x-wc-webhook-id, x-wc-webhook-delivery-id, x-wc-webhook-source",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
};

serve(async (req) => {
  // Manejo de pre-flight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const rawBody = await req.text();
    const url = new URL(req.url);
    const merchantId = url.searchParams.get("merchant_id") || "";
    const queryComercio = url.searchParams.get("comercio") || "";
    const queryAction = url.searchParams.get("action") || "";

    let payload: any = {};
    try {
      payload = JSON.parse(rawBody);
    } catch (_e) {
      payload = {};
    }

    const action = payload.action || queryAction;

    // =========================================================================
    // ACCIÓN: VERIFICAR CONEXIÓN Y ESTADO DE WEBHOOKS
    // =========================================================================
    if (action === "verify_connection") {
      return await handleVerifyConnection(merchantId, queryComercio, payload);
    }

    // =========================================================================
    // PROCESAMIENTO REGULAR DE WEBHOOKS DE WOOCOMMERCE
    // =========================================================================
    const topicHeader = req.headers.get("x-wc-webhook-topic") || "";
    const resourceHeader = req.headers.get("x-wc-webhook-resource") || "";
    const eventHeader = req.headers.get("x-wc-webhook-event") || "";
    const signatureHeader = req.headers.get("x-wc-webhook-signature") || "";
    const shopSource = req.headers.get("x-wc-webhook-source") || "";

    // 1. Buscar integración activa
    let integration: any = null;

    if (merchantId) {
      const { data } = await supabase
        .from("merchant_integrations")
        .select("*")
        .eq("merchant_id", merchantId)
        .eq("platform", "WooCommerce")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1);
      if (data && data.length > 0) integration = data[0];
    }

    if (!integration && queryComercio) {
      const { data } = await supabase
        .from("merchant_integrations")
        .select("*")
        .eq("comercio", queryComercio)
        .eq("platform", "WooCommerce")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1);
      if (data && data.length > 0) integration = data[0];
    }

    if (!integration && shopSource) {
      const cleanSource = shopSource.replace(/^https?:\/\//, "").replace(/\/$/, "");
      const { data } = await supabase
        .from("merchant_integrations")
        .select("*")
        .ilike("shop_url", `%${cleanSource}%`)
        .eq("platform", "WooCommerce")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1);
      if (data && data.length > 0) integration = data[0];
    }

    // 2. Verificación de Seguridad HMAC (obligatoria si la integración tiene webhook_secret)
    if (integration && integration.webhook_secret) {
      if (!signatureHeader) {
        console.error("❌ Falta cabecera x-wc-webhook-signature en petición de WooCommerce");
        return new Response("Missing signature header", { status: 401, headers: corsHeaders });
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
      const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));

      if (signatureBase64 !== signatureHeader) {
        console.error("❌ Firma HMAC inválida para WooCommerce webhook");
        return new Response("Unauthorized: Invalid signature", { status: 401, headers: corsHeaders });
      }
    }

    // Detectar si es un Ping de prueba / Handshake de WooCommerce al guardar el webhook
    const isPingOrEmpty = !!payload.webhook_id || (!payload.id && !payload.number) || Object.keys(payload).length === 0;
    if (isPingOrEmpty) {
      console.log(`ℹ️ Webhook Ping / Handshake de WooCommerce recibido con éxito. Evento: ${topicHeader || 'ping'}`);
      return new Response(JSON.stringify({ success: true, message: "Webhook ping received successfully" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (!integration) {
      console.error("❌ No se encontró integración activa de WooCommerce para merchant:", merchantId || queryComercio || shopSource);
      return new Response(JSON.stringify({ error: "Integration not configured" }), { status: 200, headers: corsHeaders });
    }

    const effectiveMerchantId = integration.merchant_id;
    const effectiveComercio = integration.comercio;

    const topic = topicHeader || (resourceHeader && eventHeader ? `${resourceHeader}.${eventHeader}` : "order.created");
    console.log(`📥 [WooCommerce Webhook] Evento: ${topic} para ${effectiveComercio} (Ref: ${payload.number || payload.id || "N/A"})`);

    // Procesar eventos según el topic
    if (topic === "order.created" || topic === "action.woocommerce_new_order") {
      await handleWooOrderCreate(effectiveMerchantId, effectiveComercio, payload);
    } 
    else if (topic === "order.updated" || topic === "action.woocommerce_update_order") {
      await handleWooOrderUpdate(effectiveMerchantId, effectiveComercio, payload);
    } 
    else if (topic === "order.deleted") {
      await handleWooOrderDelete(effectiveMerchantId, effectiveComercio, payload);
    }
    else if (topic.startsWith("product.")) {
      await handleWooProductSave(effectiveMerchantId, effectiveComercio, payload);
    }

    return new Response(JSON.stringify({ success: true, message: "Webhook processed" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("❌ Error en Edge Function woocommerce-webhook:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});

// =============================================================================
// FUNCIÓN DE VERIFICACIÓN DE CONEXIÓN Y DIAGNÓSTICO
// =============================================================================

async function handleVerifyConnection(merchantIdQuery: string, comercioQuery: string, payload: any) {
  try {
    const targetComercio = payload.comercio || comercioQuery;
    const targetMerchantId = payload.merchant_id || merchantIdQuery;

    let shopUrl = payload.shop_url;
    let consumerKey = payload.consumer_key;
    let consumerSecret = payload.consumer_secret;
    let effectiveMerchantId = targetMerchantId;

    // Si no vienen en el payload, buscar en base de datos
    if (!shopUrl || !consumerKey || !consumerSecret) {
      let query = supabase.from("merchant_integrations").select("*").eq("platform", "WooCommerce");
      if (targetComercio) {
        query = query.eq("comercio", targetComercio);
      } else if (targetMerchantId) {
        query = query.eq("merchant_id", targetMerchantId);
      }

      const { data: intList, error: intErr } = await query.limit(1);
      if (intErr || !intList || intList.length === 0) {
        return new Response(JSON.stringify({
          success: false,
          api_connected: false,
          error: "No se encontró ninguna configuración guardada de WooCommerce para este comercio."
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const dbInt = intList[0];
      shopUrl = dbInt.shop_url;
      effectiveMerchantId = dbInt.merchant_id;

      try {
        const creds = JSON.parse(dbInt.access_token);
        consumerKey = creds.consumer_key;
        consumerSecret = creds.consumer_secret;
      } catch (_e) {
        return new Response(JSON.stringify({
          success: false,
          api_connected: false,
          error: "Las credenciales guardadas en el sistema tienen un formato inválido."
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    if (!shopUrl || !consumerKey || !consumerSecret) {
      return new Response(JSON.stringify({
        success: false,
        api_connected: false,
        error: "Faltan la URL de la tienda, Consumer Key o Consumer Secret."
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Normalizar URL
    let baseUrl = shopUrl.trim();
    if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
      baseUrl = "https://" + baseUrl;
    }
    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, -1);
    }

    const authHeader = "Basic " + btoa(`${consumerKey.trim()}:${consumerSecret.trim()}`);
    const headers = {
      "Authorization": authHeader,
      "Accept": "application/json",
      "Content-Type": "application/json"
    };

    // 1. Probar conectividad API REST con WooCommerce
    let apiConnected = false;
    let storeName = "";
    let wcVersion = "";
    let ordersCount = 0;
    let apiError = "";

    try {
      const ordersRes = await fetch(`${baseUrl}/wp-json/wc/v3/orders?per_page=1`, { method: "GET", headers });
      if (ordersRes.ok) {
        apiConnected = true;
        const ordersData = await ordersRes.json();
        ordersCount = Array.isArray(ordersData) ? ordersData.length : 0;
      } else {
        const errText = await ordersRes.text();
        apiError = `Error HTTP ${ordersRes.status}: ${errText.substring(0, 150)}`;
      }
    } catch (err: any) {
      apiError = `No se pudo conectar con la tienda: ${err.message}`;
    }

    if (!apiConnected) {
      return new Response(JSON.stringify({
        success: false,
        api_connected: false,
        shop_url: baseUrl,
        error: apiError || "Credenciales de API inválidas o URL inaccesible."
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 2. Verificar Webhooks existentes en WooCommerce
    const expectedWebhookUrl = `https://ejtjfaucnxbikrwjwwdu.supabase.co/functions/v1/woocommerce-webhook?merchant_id=${effectiveMerchantId}`;
    let webhooksList: any[] = [];
    let hasOrderCreatedWebhook = false;
    let hasOrderUpdatedWebhook = false;
    let writePermissions = true;
    let autoRegistered = false;

    try {
      const whRes = await fetch(`${baseUrl}/wp-json/wc/v3/webhooks?per_page=100`, { method: "GET", headers });
      if (whRes.ok) {
        webhooksList = await whRes.json();
        if (Array.isArray(webhooksList)) {
          hasOrderCreatedWebhook = webhooksList.some((w: any) => 
            w.status === "active" && 
            w.delivery_url && (w.delivery_url.includes("/functions/v1/woocommerce-webhook") || w.delivery_url.includes("supabase.co/functions")) && 
            (w.topic === "order.created" || (w.resource === "order" && w.event === "created"))
          );

          hasOrderUpdatedWebhook = webhooksList.some((w: any) => 
            w.status === "active" && 
            w.delivery_url && (w.delivery_url.includes("/functions/v1/woocommerce-webhook") || w.delivery_url.includes("supabase.co/functions")) && 
            (w.topic === "order.updated" || (w.resource === "order" && w.event === "updated"))
          );
        }
      }
    } catch (err: any) {
      console.warn("Error consultando webhooks de WooCommerce:", err.message);
    }

    // 3. Si faltan webhooks, intentar auto-registrarlos si se solicita o de manera proactiva
    if ((!hasOrderCreatedWebhook || !hasOrderUpdatedWebhook) && payload.auto_register !== false) {
      try {
        if (!hasOrderCreatedWebhook) {
          const createRes = await fetch(`${baseUrl}/wp-json/wc/v3/webhooks`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              name: "WMS STOCKA - Pedido Creado",
              topic: "order.created",
              delivery_url: expectedWebhookUrl,
              status: "active"
            })
          });
          if (createRes.ok) {
            hasOrderCreatedWebhook = true;
            autoRegistered = true;
          } else if (createRes.status === 401) {
            writePermissions = false;
          }
        }

        if (!hasOrderUpdatedWebhook && writePermissions) {
          const updateRes = await fetch(`${baseUrl}/wp-json/wc/v3/webhooks`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              name: "WMS STOCKA - Pedido Actualizado",
              topic: "order.updated",
              delivery_url: expectedWebhookUrl,
              status: "active"
            })
          });
          if (updateRes.ok) {
            hasOrderUpdatedWebhook = true;
            autoRegistered = true;
          } else if (updateRes.status === 401) {
            writePermissions = false;
          }
        }
      } catch (_e) {
        // Ignorar si no se pudo auto-registrar
      }
    }

    const allHealthy = apiConnected && hasOrderCreatedWebhook && hasOrderUpdatedWebhook;

    return new Response(JSON.stringify({
      success: true,
      api_connected: true,
      shop_url: baseUrl,
      merchant_id: effectiveMerchantId,
      expected_webhook_url: expectedWebhookUrl,
      write_permissions: writePermissions,
      webhooks: {
        order_created: hasOrderCreatedWebhook,
        order_updated: hasOrderUpdatedWebhook
      },
      auto_registered: autoRegistered,
      all_healthy: allHealthy,
      message: allHealthy 
        ? "¡Excelente! La API y los Webhooks en tiempo real están 100% operativos." 
        : (apiConnected && !writePermissions
            ? "API conectada (Solo Lectura). Para que los pedidos lleguen al instante, debes crear los Webhooks manualmente en WooCommerce."
            : "API conectada, pero faltan los Webhooks en tiempo real.")
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({
      success: false,
      api_connected: false,
      error: `Error interno de verificación: ${err.message}`
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}

// ==========================================
// FUNCIONES DE MANEJO DE PEDIDOS
// ==========================================

async function resolveWooOrderNumber(comercio: string, rawNumber: string | number): Promise<{ finalNumber: string, sigla: string }> {
  let orderNumber = String(rawNumber || "").trim();
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
        const platConfig = (adicionalConfig.plat_siglas_config || {})["WooCommerce"];
        if (platConfig) {
          agregarPrefijo = platConfig.agregar_prefijo !== false;
          prefijoOrigen = (platConfig.prefijo_origen || "").trim().toUpperCase();
        } else {
          agregarPrefijo = !adicionalConfig.pedido_trae_sigla;
        }
      }
    } catch (err: any) {
      console.error("⚠️ Error consultando sigla de comercio para WooCommerce:", err.message);
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

  return { finalNumber: finalOrderNumber, sigla: siglaComercio };
}

async function handleWooOrderCreate(merchantId: string, comercio: string, order: any) {
  if (!order || (!order.id && !order.number)) {
    console.log(`ℹ️ Payload de orden de WooCommerce sin número ni ID válido. Omitiendo.`);
    return;
  }

  const orderId = String(order.id || "");
  const baseNumber = String(order.number || orderId).trim();
  const { finalNumber: finalOrderNumber } = await resolveWooOrderNumber(comercio, baseNumber);

  console.log(`[WooCommerce Webhook] Procesando nuevo pedido: ${baseNumber} -> ${finalOrderNumber}`);

  const statusName = order.status || "processing";
  const isDelivered = statusName === "completed";
  const isCancelled = ["cancelled", "failed", "refunded"].includes(statusName);
  const isActive = !isDelivered && !isCancelled;

  // Cargar equivalencias de SKU
  const skuMap: Record<string, string> = {};
  try {
    const { data: equivalences } = await supabase
      .from("sku_equivalences")
      .select("platform_sku, master_sku, platform")
      .eq("comercio", comercio);

    if (equivalences) {
      equivalences.filter((e: any) => e.platform === "Todas" || e.platform === "WooCommerce").forEach((e: any) => {
        if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, "")] = e.master_sku.trim();
      });
    }
  } catch (err: any) {
    console.error("⚠️ Error cargando equivalencias de SKU:", err.message);
  }

  // Verificar si el pedido ya existe en el WMS
  const { data: existingOrder } = await supabase
    .from("orders")
    .select("id, status")
    .eq("comercio", comercio)
    .in("external_order_number", [baseNumber, finalOrderNumber])
    .maybeSingle();

  if (existingOrder) {
    console.log(`ℹ️ Pedido ${finalOrderNumber} ya existe en WMS. Derivando a actualización.`);
    return await handleWooOrderUpdate(merchantId, comercio, order);
  }

  if (!isActive) {
    console.log(`ℹ️ Pedido ${finalOrderNumber} ignorado por estar en estado no activo (${statusName}) y no existir en WMS.`);
    return;
  }

  // Mapear campos planos de la orden
  const itemNames: string[] = [];
  const itemQuantities: Record<string, number> = {};

  if (order.line_items && Array.isArray(order.line_items)) {
    for (const item of order.line_items) {
      let sku = item.sku || `WC-${item.product_id}${item.variation_id ? "-" + item.variation_id : ""}`;
      sku = sku.replace(/\s+/g, "");
      const mappedSku = skuMap[sku] || sku;
      itemQuantities[mappedSku] = (itemQuantities[mappedSku] || 0) + Number(item.quantity || 1);
      if (item.name && !itemNames.includes(item.name)) {
        itemNames.push(item.name);
      }
    }
  }

  const flatSku = Object.keys(itemQuantities).join(", ");
  const flatItemName = itemNames.join(", ");
  const flatQuantity = Object.values(itemQuantities).reduce((sum, qty) => sum + qty, 0);
  const totalValue = Number(order.total || 0);

  const orderDataToSave = {
    merchant_id: merchantId,
    comercio: comercio,
    external_order_number: finalOrderNumber,
    external_platform: "WooCommerce",
    payment_status: order.date_paid ? "PAID" : (order.status === "processing" || order.status === "completed" ? "PAID" : "PENDING"),
    total_value: totalValue,
    customer_email: order.billing?.email || "no-email@woocommerce.cl",
    customer_phone: order.billing?.phone || order.shipping?.phone || "No especificado",
    customer_name: `${order.shipping?.first_name || order.billing?.first_name || ""} ${order.shipping?.last_name || order.billing?.last_name || ""}`.trim() || "Cliente WooCommerce",
    shipping_address: order.shipping?.address_1 || order.billing?.address_1 || "No especificada",
    shipping_city: order.shipping?.city || order.billing?.city || "No especificada",
    shipping_complement: [order.shipping?.address_2 || order.billing?.address_2, order.shipping?.state || order.billing?.state, order.shipping?.postcode || order.billing?.postcode].filter(Boolean).join(", ") || "",
    shipping_method: order.shipping_lines?.[0]?.method_title || "Por definir",
    raw_woocommerce_data: order,
    origen: "WooCommerce",
    item: flatItemName,
    cantidad: flatQuantity,
    sku: flatSku,
    status: "para procesar"
  };

  // 1. Insertar orden en Supabase
  const { data: newOrder, error: insErr } = await supabase
    .from("orders")
    .insert([orderDataToSave])
    .select("id")
    .single();

  if (insErr || !newOrder) {
    console.error(`❌ Error al insertar pedido local ${finalOrderNumber}:`, insErr?.message);
    return;
  }

  console.log(`📥 Insertado nuevo pedido WooCommerce ${finalOrderNumber} con ID: ${newOrder.id}`);

  // 2. Obtener bodega por defecto
  let warehouseId = null;
  const { data: whRel } = await supabase
    .from("merchants_warehouses")
    .select("warehouse_id")
    .eq("merchant_id", merchantId)
    .limit(1)
    .maybeSingle();

  if (whRel) {
    warehouseId = whRel.warehouse_id;
  } else {
    const { data: defaultWh } = await supabase.from("warehouses").select("id").limit(1).maybeSingle();
    if (defaultWh) warehouseId = defaultWh.id;
  }

  // 3. Registrar ítems en order_items
  for (const [sku, qty] of Object.entries(itemQuantities)) {
    let { data: product } = await supabase
      .from("products")
      .select("id")
      .eq("sku", sku)
      .eq("comercio", comercio)
      .maybeSingle();

    if (!product) {
      const itemDetail = order.line_items?.find((item: any) => {
        let itemSku = item.sku || `WC-${item.product_id}${item.variation_id ? "-" + item.variation_id : ""}`;
        let cleanItemSku = itemSku.replace(/\s+/g, "");
        let mappedItemSku = skuMap[cleanItemSku] || cleanItemSku;
        return mappedItemSku === sku;
      });

      const productName = itemDetail?.name || "Producto WooCommerce " + sku;
      const productPrice = Number(itemDetail?.price || 0);

      const { data: newProd, error: prodErr } = await supabase
        .from("products")
        .insert([{
          merchant_id: merchantId,
          comercio: comercio,
          sku: sku,
          name: productName,
          price: productPrice,
          description: "Creado automáticamente desde webhook de WooCommerce"
        }])
        .select("id")
        .single();

      if (!prodErr && newProd) {
        console.log(`   * Creado automáticamente producto para SKU: ${sku} ("${productName}")`);
        product = newProd;
      } else {
        console.error(`   ❌ Error al crear producto para SKU ${sku}:`, prodErr?.message);
      }
    }

    if (product && warehouseId) {
      const { error: itemErr } = await supabase
        .from("order_items")
        .insert([{
          order_id: newOrder.id,
          product_id: product.id,
          warehouse_id: warehouseId,
          quantity: qty
        }]);

      if (itemErr) {
        console.error(`   ❌ Error al registrar ítem SKU ${sku} para la orden:`, itemErr.message);
      } else {
        console.log(`   + Registrado ítem: SKU ${sku} x ${qty}`);
      }
    }
  }
}

async function handleWooOrderUpdate(merchantId: string, comercio: string, order: any) {
  if (!order || (!order.id && !order.number)) {
    console.log(`ℹ️ Payload de actualización de orden sin número ni ID válido. Omitiendo.`);
    return;
  }

  const orderId = String(order.id || "");
  const baseNumber = String(order.number || orderId).trim();
  const { finalNumber: finalOrderNumber } = await resolveWooOrderNumber(comercio, baseNumber);

  console.log(`[WooCommerce Webhook] Actualizando pedido: ${finalOrderNumber}`);

  const statusName = order.status || "";
  const isCancelled = ["cancelled", "failed", "refunded"].includes(statusName);

  // Buscar pedido en BD
  const { data: existingOrder } = await supabase
    .from("orders")
    .select("id, status, estado_wms, raw_woocommerce_data, total_value, sku, item, cantidad, customer_name, customer_email, customer_phone, shipping_address, shipping_city, shipping_complement")
    .eq("comercio", comercio)
    .in("external_order_number", [baseNumber, finalOrderNumber])
    .maybeSingle();

  if (!existingOrder) {
    console.log(`ℹ️ Pedido ${finalOrderNumber} no existía en WMS. Creándolo...`);
    return await handleWooOrderCreate(merchantId, comercio, order);
  }

  const existingRaw = (existingOrder as any).raw_woocommerce_data || {};
  const isWmsItemsEdited = (existingOrder as any).wms_items_edited === true || existingRaw.wms_items_edited === true;
  const isWmsShippingEdited = (existingOrder as any).wms_shipping_edited === true || existingRaw.wms_shipping_edited === true;

  const updatedData: Record<string, any> = {
    payment_status: order.date_paid ? "PAID" : (order.status === "processing" || order.status === "completed" ? "PAID" : "PENDING"),
    shipping_method: order.shipping_lines?.[0]?.method_title || "Por definir",
    raw_woocommerce_data: {
      ...order,
      ...(isWmsItemsEdited ? { wms_items_edited: true } : {}),
      ...(isWmsShippingEdited ? { wms_shipping_edited: true } : {}),
      ...((existingRaw.wms_custom_edited || isWmsItemsEdited || isWmsShippingEdited) ? { wms_custom_edited: true } : {})
    }
  };

  if (!isWmsItemsEdited) {
    updatedData.total_value = Number(order.total || 0);
  }

  if (!isWmsShippingEdited) {
    updatedData.customer_phone = order.billing?.phone || order.shipping?.phone || "No especificado";
    updatedData.customer_name = `${order.shipping?.first_name || order.billing?.first_name || ""} ${order.shipping?.last_name || order.billing?.last_name || ""}`.trim() || "Cliente WooCommerce";
    updatedData.shipping_address = order.shipping?.address_1 || order.billing?.address_1 || "No especificada";
    updatedData.shipping_city = order.shipping?.city || order.billing?.city || "No especificada";
    updatedData.shipping_complement = [order.shipping?.address_2 || order.billing?.address_2, order.shipping?.state || order.billing?.state, order.shipping?.postcode || order.billing?.postcode].filter(Boolean).join(", ") || "";
  }

  if (isCancelled && existingOrder.status !== "cancelado") {
    updatedData.status = "cancelado";
  }

  await supabase
    .from("orders")
    .update(updatedData)
    .eq("id", existingOrder.id);

  // Alertas críticas si el pedido ya está en preparación o posterior
  const rawStatus = (existingOrder.status || "").toLowerCase();
  const rawWmsStatus = (existingOrder.estado_wms || "").toLowerCase();
  const isClosedOrDispatched = ["despachado", "entregado", "retirado", "cancelado"].includes(rawStatus) ||
                               ["despachado", "entregado", "retirado", "cancelado"].includes(rawWmsStatus);
  const wmsStatus = existingOrder.estado_wms || existingOrder.status || "En procesamiento";
  const estadosCriticos = ["en preparación", "pickeado", "despachado", "incidencia", "entregado", "retirado", "cancelado"];

  if (isClosedOrDispatched || estadosCriticos.includes(wmsStatus.toLowerCase())) {
    if (isCancelled) {
      await supabase.from("order_alerts").insert([{
        merchant_id: merchantId,
        order_id: existingOrder.id,
        alert_type: "CANCELADO_EN_PREPARACION",
        message: `¡CRÍTICO! El pedido ${finalOrderNumber} ha sido CANCELADO en WooCommerce, pero en WMS tiene estado: ${wmsStatus}. Detener preparación de inmediato.`
      }]);
    }
  } else {
    // Smart Diffing de ítems si no ha sido editado manualmente en WMS
    if (!isWmsItemsEdited && order.line_items && Array.isArray(order.line_items)) {
      // Cargar equivalencias
      const skuMap: Record<string, string> = {};
      try {
        const { data: equivalences } = await supabase
          .from("sku_equivalences")
          .select("platform_sku, master_sku, platform")
          .eq("comercio", comercio);

        if (equivalences) {
          equivalences.filter((e: any) => e.platform === "Todas" || e.platform === "WooCommerce").forEach((e: any) => {
            if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, "")] = e.master_sku.trim();
          });
        }
      } catch (err: any) {
        console.error("⚠️ Error cargando equivalencias:", err.message);
      }

      const itemQuantities: Record<string, number> = {};
      for (const item of order.line_items) {
        let sku = item.sku || `WC-${item.product_id}${item.variation_id ? "-" + item.variation_id : ""}`;
        sku = sku.replace(/\s+/g, "");
        const mappedSku = skuMap[sku] || sku;
        itemQuantities[mappedSku] = (itemQuantities[mappedSku] || 0) + Number(item.quantity || 1);
      }

      const { data: existingItems } = await supabase
        .from("order_items")
        .select("id, product_id, quantity, warehouse_id")
        .eq("order_id", existingOrder.id);

      const existingMap = new Map((existingItems || []).map((i: any) => [i.product_id, i]));
      const processedProductIds = new Set();

      let warehouseId = null;
      const { data: whRel } = await supabase
        .from("merchants_warehouses")
        .select("warehouse_id")
        .eq("merchant_id", merchantId)
        .limit(1)
        .maybeSingle();

      if (whRel) warehouseId = whRel.warehouse_id;
      else {
        const { data: defaultWh } = await supabase.from("warehouses").select("id").limit(1).maybeSingle();
        if (defaultWh) warehouseId = defaultWh.id;
      }

      for (const [sku, qty] of Object.entries(itemQuantities)) {
        let { data: product } = await supabase
          .from("products")
          .select("id")
          .eq("sku", sku)
          .eq("comercio", comercio)
          .maybeSingle();

        if (product && warehouseId) {
          processedProductIds.add(product.id);
          const existing = existingMap.get(product.id);

          if (existing) {
            if (existing.quantity !== (qty as number) || existing.warehouse_id !== warehouseId) {
              await supabase.from("order_items").update({
                quantity: qty as number,
                warehouse_id: warehouseId
              }).eq("id", existing.id);
            }
          } else {
            await supabase.from("order_items").insert([{
              order_id: existingOrder.id,
              product_id: product.id,
              warehouse_id: warehouseId,
              quantity: qty as number
            }]);
          }
        }
      }

      // Eliminar ítems removidos
      for (const [prodId, existingItem] of existingMap.entries()) {
        if (!processedProductIds.has(prodId)) {
          await supabase.from("order_items").delete().eq("id", (existingItem as any).id);
        }
      }
      console.log(`Ítems actualizados para pedido ${finalOrderNumber}`);
    }
  }
}

async function handleWooOrderDelete(_merchantId: string, comercio: string, order: any) {
  const orderId = String(order.id || "");
  const baseNumber = String(order.number || orderId).trim();
  const { finalNumber: finalOrderNumber } = await resolveWooOrderNumber(comercio, baseNumber);

  console.log(`[WooCommerce Webhook] Pedido eliminado en tienda: ${finalOrderNumber}`);

  const { data: existingOrder } = await supabase
    .from("orders")
    .select("id, estado_wms, status")
    .eq("comercio", comercio)
    .in("external_order_number", [baseNumber, finalOrderNumber])
    .maybeSingle();

  if (existingOrder) {
    await supabase
      .from("orders")
      .update({ status: "cancelado" })
      .eq("id", existingOrder.id);
  }
}

async function handleWooProductSave(merchantId: string, comercio: string, product: any) {
  console.log(`[WooCommerce Webhook] Guardando producto ID ${product.id} ("${product.name}")`);

  const sku = (product.sku || `WC-${product.id}`).replace(/\s+/g, "");
  const productData = {
    merchant_id: merchantId,
    comercio: comercio,
    sku: sku,
    name: product.name,
    price: Number(product.price || 0),
    description: "Sincronizado vía webhook de WooCommerce",
    woocommerce_product_id: String(product.id),
    raw_woocommerce_data: product
  };

  await supabase
    .from("products")
    .upsert(productData, { onConflict: "comercio,sku" });
}
