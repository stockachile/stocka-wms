import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// Configuración cliente Supabase (usando variables de entorno inyectadas por el entorno de Supabase)
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

serve(async (req) => {
  // Solo aceptamos POST
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // 1. Obtener cabeceras de Tiendanube obligatorias
    const signatureHeader = req.headers.get("x-linkedstore-signature") || "";
    const eventTopic = req.headers.get("x-linkedstore-event") || "";

    if (!eventTopic) {
      return new Response("Missing Tiendanube event header", { status: 400 });
    }

    // 2. Obtener merchant_id desde la URL (query parameter)
    const url = new URL(req.url);
    const merchantId = url.searchParams.get("merchant_id") || "";

    if (!merchantId) {
      console.error("Missing merchant_id in webhook URL query params");
      return new Response("Missing merchant_id", { status: 400 });
    }

    // 3. Obtener el secreto de webhook de la integración del merchant
    const { data: integration, error: intError } = await supabase
      .from("merchant_integrations")
      .select("webhook_secret, comercio")
      .eq("merchant_id", merchantId)
      .eq("platform", "Tiendanube")
      .maybeSingle();

    if (intError) {
      console.error("Error fetching merchant integration:", intError);
      return new Response("Internal Server Error", { status: 500 });
    }

    if (!integration) {
      console.error(`Integration not configured for merchant_id: ${merchantId}`);
      return new Response("Integration not configured", { status: 200 }); // Retornar 200 para evitar reintentos infinitos si el merchant se borró
    }

    const rawBody = await req.text();

    // 4. Verificación de Seguridad HMAC (solo si tiene webhook_secret configurado)
    if (integration.webhook_secret && signatureHeader) {
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
        return new Response("Unauthorized", { status: 401 });
      }
    } else {
      console.warn("Saltando verificación HMAC: Falta webhook_secret o cabecera x-linkedstore-signature");
    }

    // 5. Parsear el body JSON
    const payload = JSON.parse(rawBody);
    const orderNumber = payload.number ? payload.number.toString() : (payload.id ? payload.id.toString() : "N/A");
    console.log(`Recibido Webhook Tiendanube: ${eventTopic} para orden #${orderNumber} (Comercio: ${integration.comercio})`);

    // 6. Lógica según el Event Topic
    if (eventTopic === "order/created") {
      await handleOrderCreate(merchantId, integration.comercio, payload);
    } 
    else if (eventTopic === "order/updated") {
      await handleOrderUpdate(merchantId, integration.comercio, payload);
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
    .eq("external_order_number", finalOrderNumber)
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

    const name = item.name ? (item.name.es || item.name.pt || Object.values(item.name)[0] || "Producto") : "Producto";
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

  const customerName = addr 
    ? `${addr.first_name || ""} ${addr.last_name || ""}`.trim() 
    : (order.contact_name || order.customer?.name || "Cliente Tiendanube");

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

      const pName = itemDetail?.name 
        ? (itemDetail.name.es || itemDetail.name.pt || Object.values(itemDetail.name)[0] || "Producto Tiendanube " + sku) 
        : "Producto Tiendanube " + sku;
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
    .select("id, status, estado_wms")
    .eq("merchant_id", merchantId)
    .eq("external_order_number", finalOrderNumber)
    .maybeSingle();

  if (findErr || !existingOrder) {
    console.log(`Pedido ${finalOrderNumber} no encontrado en WMS, ignorando actualización.`);
    return;
  }

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

  const customerName = addr 
    ? `${addr.first_name || ""} ${addr.last_name || ""}`.trim() 
    : (order.contact_name || order.customer?.name || "Cliente Tiendanube");

  // Preparamos datos a actualizar
  const updatedData: Record<string, any> = {
    payment_status: paymentStatus === "paid" ? "PAID" : "PENDING",
    total_value: Number(order.total || 0),
    customer_phone: addr?.phone || order.contact_phone || "No especificado",
    customer_name: customerName,
    shipping_address: addressString,
    shipping_city: addr?.city || "No especificada",
    shipping_complement: complementString,
    shipping_method: order.shipping_option || "Por definir",
    raw_tiendanube_data: order
  };

  if (isCancelled) {
    updatedData.status = "cancelado";
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
    
    // 1. Eliminar ítems anteriores
    await supabase.from("order_items").delete().eq("order_id", existingOrder.id);

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

    // 3. Registrar ítems actualizados
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
        await supabase.from("order_items").insert([{
          order_id: existingOrder.id,
          product_id: product.id,
          warehouse_id: warehouseId,
          quantity: item.quantity
        }]);
      }
    }
    console.log(`Ítems actualizados con éxito para el pedido Tiendanube ${finalOrderNumber}`);
  }
}
