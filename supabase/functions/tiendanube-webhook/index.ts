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

    // 2. Obtener merchant_id desde la URL (query parameter) o buscar por store_id
    const url = new URL(req.url);
    let merchantId = url.searchParams.get("merchant_id") || "";
    const storeIdFromPayload = payload.store_id ? String(payload.store_id).trim() : "";

    let integration: any = null;
    if (merchantId) {
      const { data: intData, error: intError } = await supabase
        .from("merchant_integrations")
        .select("merchant_id, webhook_secret, comercio, access_token, shop_url, is_main")
        .eq("merchant_id", merchantId)
        .eq("platform", "Tiendanube")
        .eq("is_active", true)
        .maybeSingle();

      if (intError) {
        console.error("Error fetching merchant integration:", intError);
        return new Response("Internal Server Error", { status: 500 });
      }
      integration = intData;
    }

    if (!integration && storeIdFromPayload) {
      const { data: intByStore } = await supabase
        .from("merchant_integrations")
        .select("merchant_id, webhook_secret, comercio, access_token, shop_url, is_main")
        .eq("platform", "Tiendanube")
        .eq("is_active", true)
        .ilike("shop_url", `%${storeIdFromPayload}%`)
        .limit(1)
        .maybeSingle();

      if (intByStore) {
        integration = intByStore;
        merchantId = intByStore.merchant_id;
      }
    }

    if (!integration) {
      console.error(`Integration not configured for merchant_id: ${merchantId} / store_id: ${storeIdFromPayload}`);
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

async function handleOrderCreate(merchantId: string, comercio: string, order: any) {
  // Obtener prefijo de sigla del comercio
  let prefix = "";
  try {
    const { data: configData } = await supabase
      .from("v_comercios_config")
      .select("sigla")
      .eq("nombre", comercio)
      .maybeSingle();

    const { data: adicionalConfig } = await supabase
      .from("comercios_adicional_config")
      .select("pedido_trae_sigla")
      .eq("comercio", comercio)
      .maybeSingle();

    const traeSigla = adicionalConfig ? adicionalConfig.pedido_trae_sigla : false;
    if (configData && configData.sigla && !traeSigla) {
      prefix = configData.sigla.trim().toUpperCase();
    }
  } catch (err: any) {
    console.error("⚠️ Error consultando sigla de comercio:", err.message);
  }

  const orderId = order.id.toString();
  const orderNumber = order.number ? order.number.toString() : orderId;
  const finalOrderNumber = prefix ? `${prefix}${orderNumber}` : orderNumber;

  // Verificamos que no exista
  const { data: existing } = await supabase
    .from("orders")
    .select("id")
    .eq("merchant_id", merchantId)
    .in("external_order_number", [orderNumber, finalOrderNumber])
    .maybeSingle();

  if (existing) {
    console.log(`El pedido Tiendanube ${finalOrderNumber} ya existe en WMS, omitiendo inserción.`);
    return;
  }

  // Cargar equivalencias de SKU
  const skuMap: Record<string, string> = {};
  try {
    const { data: equivalences } = await supabase
      .from("sku_equivalences")
      .select("platform_sku, master_sku, platform")
      .eq("comercio", comercio);
    
    if (equivalences) {
      equivalences.filter((e: any) => e.platform === "Todas").forEach((e: any) => {
        if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, "")] = e.master_sku.trim();
      });
      equivalences.filter((e: any) => e.platform === "Tiendanube").forEach((e: any) => {
        if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, "")] = e.master_sku.trim();
      });
    }
  } catch (err: any) {
    console.error("⚠️ Error cargando equivalencias de SKU:", err.message);
  }

  // Preparamos datos planos
  const itemNames: string[] = [];
  const itemQuantities: Record<string, number> = {};
  
  for (const item of order.products) {
    let sku = item.sku || `TN-${item.product_id}${item.variant_id ? '-' + item.variant_id : ''}`;
    sku = sku.trim().replace(/\s+/g, "");
    let mappedSku = skuMap[sku] || sku;
    itemQuantities[mappedSku] = (itemQuantities[mappedSku] || 0) + Number(item.quantity);

    const name = typeof item.name === "string" ? item.name.trim() : (item.name?.es || item.name?.pt || (typeof item.name === "object" && item.name ? Object.values(item.name)[0] : "Producto") || "Producto");
    if (name && !itemNames.includes(name)) {
      itemNames.push(name);
    }
  }

  const flatSku = Object.keys(itemQuantities).join(", ");
  const flatItemName = itemNames.join(", ");
  const flatQuantity = Object.values(itemQuantities).reduce((sum, qty) => sum + qty, 0);
  const totalValue = Number(order.total || 0);

  const addr = order.shipping_address;
  let addressString = "No especificada";
  let complementString = "";
  if (addr) {
    addressString = `${addr.address || ''} ${addr.number || ''}`.trim() || "No especificada";
    complementString = [addr.floor, addr.locality, addr.province, addr.zipcode].filter(Boolean).join(", ");
  }

  const customerName = extractTiendanubeCustomerName(order);

  const orderData = {
    merchant_id: merchantId,
    comercio: comercio,
    external_order_number: finalOrderNumber,
    external_platform: "Tiendanube",
    payment_status: order.payment_status === "paid" ? "PAID" : "PENDING",
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
    status: "para procesar"
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

  // Buscar la primera bodega asignada al comerciante
  const { data: whRelation } = await supabase
    .from("merchants_warehouses")
    .select("warehouse_id")
    .eq("merchant_id", merchantId)
    .limit(1)
    .maybeSingle();
    
  const warehouseId = whRelation?.warehouse_id || null;

  // Registrar cada item del pedido
  for (const [sku, qty] of Object.entries(itemQuantities)) {
    let product = null;

    // Buscar el producto en el catálogo por SKU
    const { data: foundProduct } = await supabase.from("products")
      .select("id")
      .eq("sku", sku)
      .eq("comercio", comercio)
      .maybeSingle();
    
    product = foundProduct;

    // Auto-crear producto si no existe
    if (!product) {
      const itemDetail = order.products.find((item: any) => {
        let itemSku = item.sku || `TN-${item.product_id}${item.variant_id ? '-' + item.variant_id : ''}`;
        let cleanItemSku = itemSku.trim().replace(/\s+/g, "");
        let mappedItemSku = skuMap[cleanItemSku] || cleanItemSku;
        return mappedItemSku === sku;
      });

      const pName = typeof itemDetail?.name === "string" ? itemDetail.name.trim() : (itemDetail?.name?.es || itemDetail?.name?.pt || (typeof itemDetail?.name === "object" && itemDetail?.name ? Object.values(itemDetail.name)[0] : "Producto Tiendanube " + sku) || "Producto Tiendanube " + sku);
      const productPrice = Number(itemDetail?.price || 0);

      const { data: newProd, error: prodErr } = await supabase
        .from("products")
        .insert([{
          merchant_id: merchantId,
          comercio: comercio,
          sku: sku,
          name: pName,
          price: productPrice,
          description: "Creado automáticamente desde webhook de Tiendanube"
        }])
        .select("id")
        .single();

      if (!prodErr && newProd) {
        console.log(`Creado producto faltante SKU ${sku} en catálogo.`);
        product = newProd;
      } else {
        console.error(`Error auto-creando producto SKU ${sku}:`, prodErr);
      }
    }

    if (product) {
      const { error: itemErr } = await supabase
        .from("order_items")
        .insert([{
          order_id: newOrder.id,
          product_id: product.id,
          warehouse_id: warehouseId,
          quantity: qty
        }]);

      if (itemErr) {
        console.error(`Error insertando item SKU ${sku} en order_items:`, itemErr);
      }
    }
  }
}

async function handleOrderUpdate(merchantId: string, comercio: string, order: any) {
  // Obtener prefijo de sigla del comercio
  let prefix = "";
  try {
    const { data: configData } = await supabase
      .from("v_comercios_config")
      .select("sigla")
      .eq("nombre", comercio)
      .maybeSingle();

    const { data: adicionalConfig } = await supabase
      .from("comercios_adicional_config")
      .select("pedido_trae_sigla")
      .eq("comercio", comercio)
      .maybeSingle();

    const traeSigla = adicionalConfig ? adicionalConfig.pedido_trae_sigla : false;
    if (configData && configData.sigla && !traeSigla) {
      prefix = configData.sigla.trim().toUpperCase();
    }
  } catch (err: any) {
    console.error("⚠️ Error consultando sigla de comercio:", err.message);
  }

  const orderId = order.id.toString();
  const orderNumber = order.number ? order.number.toString() : orderId;
  const finalOrderNumber = prefix ? `${prefix}${orderNumber}` : orderNumber;

  // Buscamos el estado actual del pedido en WMS
  const { data: existingOrder, error: findErr } = await supabase
    .from("orders")
    .select("id, status, estado_wms, raw_tiendanube_data, total_value, sku, item, cantidad, customer_name, customer_email, customer_phone, shipping_address, shipping_city, shipping_complement")
    .eq("merchant_id", merchantId)
    .eq("external_order_number", finalOrderNumber)
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

  const addr = order.shipping_address;
  let addressString = "No especificada";
  let complementString = "";
  if (addr) {
    addressString = `${addr.address || ''} ${addr.number || ''}`.trim() || "No especificada";
    complementString = [addr.floor, addr.locality, addr.province, addr.zipcode].filter(Boolean).join(", ");
  }

  const customerName = extractTiendanubeCustomerName(order);

  // Preparamos datos a actualizar protegiendo modificaciones manuales del WMS
  const updatedData: Record<string, any> = {
    payment_status: paymentStatus === "paid" ? "PAID" : "PENDING",
    shipping_method: order.shipping_option || "Por definir",
    raw_tiendanube_data: {
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
    updatedData.customer_phone = addr?.phone || order.contact_phone || "No especificado";
    updatedData.customer_name = customerName;
    updatedData.shipping_address = addressString;
    updatedData.shipping_city = addr?.city || "No especificada";
    updatedData.shipping_complement = complementString;
  }

  if (isCancelled) {
    updatedData.status = "cancelado";
    const currentWmsState = (existingOrder.estado_wms || "En procesamiento").trim().toLowerCase();
    const estadosWmsProtegidos = ["en preparación", "pickeado", "despachado", "incidencia", "entregado", "retirado", "archivado"];
    if (!estadosWmsProtegidos.includes(currentWmsState)) {
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
  const estadosCriticos = ["En preparación", "Pickeado", "Despachado", "Incidencia"];
  
  if (estadosCriticos.includes(wmsStatus)) {
    let alertMessage = `El pedido Tiendanube ${finalOrderNumber} ha sido modificado en la tienda mientras estaba en WMS con estado: ${wmsStatus}.`;
    let alertType = "MODIFICADO_EN_PREPARACION";

    if (isCancelled) {
        alertMessage = `¡CRÍTICO! El pedido Tiendanube ${finalOrderNumber} ha sido CANCELADO en la tienda, pero en el WMS tiene estado: ${wmsStatus}. Detener despacho de inmediato.`;
        alertType = "CANCELADO_EN_PREPARACION";
    }

    // Insertar alerta
    const { error: alertErr } = await supabase
      .from("order_alerts")
      .insert([{
        merchant_id: merchantId,
        order_id: existingOrder.id,
        alert_type: alertType,
        message: alertMessage
      }]);
      
    if (alertErr) console.error("Error creando alerta de pedido:", alertErr);
  } else if (!isCancelled) {
    // Si no está preparando y no está cancelado, podemos re-sincronizar los ítems en caso de cambios en la orden
    
    // 1. Obtener ítems existentes para Smart Diffing (excluyendo regalos de campañas)
    const { data: existingItems } = await supabase
      .from("order_items")
      .select("id, product_id, quantity, warehouse_id, is_gift, campaign_id, tag")
      .eq("order_id", existingOrder.id);

    const existingMap = new Map(
      (existingItems || [])
        .filter((i: any) => !i.is_gift && !i.campaign_id && i.tag !== "Campaña")
        .map((i: any) => [i.product_id, i])
    );
    const processedProductIds = new Set();

    // 2. Cargar equivalencias de SKU
    const skuMap: Record<string, string> = {};
    try {
      const { data: equivalences } = await supabase
        .from("sku_equivalences")
        .select("platform_sku, master_sku, platform")
        .eq("comercio", comercio);
      
      if (equivalences) {
        equivalences.filter((e: any) => e.platform === "Todas").forEach((e: any) => {
          if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, "")] = e.master_sku.trim();
        });
        equivalences.filter((e: any) => e.platform === "Tiendanube").forEach((e: any) => {
          if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, "")] = e.master_sku.trim();
        });
      }
    } catch (err: any) {
      console.error("⚠️ Error cargando equivalencias:", err.message);
    }

    // 3. Registrar ítems actualizados de forma inteligente
    const { data: whRelation } = await supabase
      .from("merchants_warehouses")
      .select("warehouse_id")
      .eq("merchant_id", merchantId)
      .limit(1)
      .maybeSingle();
      
    const warehouseId = whRelation?.warehouse_id || null;

    for (const item of order.products) {
      let sku = item.sku || `TN-${item.product_id}${item.variant_id ? '-' + item.variant_id : ''}`;
      sku = sku.trim().replace(/\s+/g, "");
      let mappedSku = skuMap[sku] || sku;

      let product = null;
      const { data: foundProduct } = await supabase.from("products")
        .select("id")
        .eq("sku", mappedSku)
        .eq("comercio", comercio)
        .maybeSingle();
      
      product = foundProduct;

      if (!product) {
        const pName = item.name 
          ? (item.name.es || item.name.pt || Object.values(item.name)[0] || "Producto Tiendanube " + sku) 
          : "Producto Tiendanube " + sku;
        const productPrice = Number(item.price || 0);

        const { data: newProd } = await supabase
          .from("products")
          .insert([{
            merchant_id: merchantId,
            comercio: comercio,
            sku: mappedSku,
            name: pName,
            price: productPrice,
            description: "Creado automáticamente desde webhook de Tiendanube al actualizar"
          }])
          .select("id")
          .single();

        product = newProd;
      }

      if (product) {
        processedProductIds.add(product.id);
        const existing = existingMap.get(product.id);

        if (existing) {
          if (existing.quantity !== item.quantity || (warehouseId && existing.warehouse_id !== warehouseId)) {
            await supabase.from("order_items").update({
              quantity: item.quantity,
              warehouse_id: warehouseId || existing.warehouse_id
            }).eq("id", existing.id);
          }
        } else {
          await supabase.from("order_items").insert([{
            order_id: existingOrder.id,
            product_id: product.id,
            warehouse_id: warehouseId,
            quantity: item.quantity
          }]);
        }
      }
    }

    // 4. Eliminar únicamente los ítems que ya no están en la orden
    for (const [prodId, existingItem] of existingMap.entries()) {
      if (!processedProductIds.has(prodId)) {
        await supabase.from("order_items").delete().eq("id", (existingItem as any).id);
      }
    }
    console.log(`Ítems actualizados con éxito para el pedido Tiendanube ${finalOrderNumber}`);
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
        .select("id")
        .eq("comercio", comercio)
        .ilike("sku", targetSku)
        .limit(1)
        .maybeSingle();

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
