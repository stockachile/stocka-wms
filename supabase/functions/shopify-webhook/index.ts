import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// Configuración cliente Supabase (usando variables de entorno inyectadas por Supabase)
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const globalShopifyClientSecret = Deno.env.get("SHOPIFY_CLIENT_SECRET") ?? "";

serve(async (req) => {
  // Solo aceptamos POST
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // 1. Obtener cabeceras de Shopify obligatorias
    const hmacHeader = req.headers.get("x-shopify-hmac-sha256") || "";
    const topic = req.headers.get("x-shopify-topic") || "";
    const shopDomain = req.headers.get("x-shopify-shop-domain") || "";

    if (!hmacHeader || !topic) {
      return new Response("Missing Shopify headers", { status: 400 });
    }

    // 2. Obtener merchant_id desde la URL (query parameter opcional)
    const url = new URL(req.url);
    const merchantId = url.searchParams.get("merchant_id") || "";

    // 3. Obtener el secreto del webhook del cliente
    let integration = null;
    if (merchantId) {
      const { data } = await supabase
        .from("merchant_integrations")
        .select("webhook_secret, comercio")
        .eq("merchant_id", merchantId)
        .eq("platform", "Shopify")
        .maybeSingle();
      integration = data;
    }

    // Usar el secreto del cliente o el secreto global de la app como fallback
    const webhookSecret = integration?.webhook_secret || globalShopifyClientSecret;

    if (!webhookSecret) {
      console.error("Missing webhook secret for signature verification");
      return new Response("Webhook secret not configured", { status: 200 }); 
    }

    // 4. Verificación de Seguridad HMAC (Shopify)
    const rawBody = await req.text();
    
    // Verificación HMAC nativa con Web Crypto API para evitar empaquetar librerías externas
    const keyBuf = new TextEncoder().encode(webhookSecret);
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

    if (signatureBase64 !== hmacHeader) {
      console.error("Firma HMAC inválida");
      return new Response("Unauthorized", { status: 401 });
    }

    // 5. Manejar webhooks de cumplimiento obligatorio GDPR
    if (topic.includes("redact") || topic.includes("data_request")) {
      console.log(`Recibido Webhook de cumplimiento GDPR: ${topic} para ${shopDomain}`);
      return new Response("GDPR Webhook received and processed successfully", { status: 200 });
    }

    // Verificar que la integración exista para temas que no sean de cumplimiento
    if (!merchantId || !integration) {
      console.error("Integración no encontrada para procesamiento de pedidos/productos:", merchantId);
      return new Response("Integration not configured", { status: 200 });
    }

    // 6. Parsear el body JSON
    const payload = JSON.parse(rawBody);
    const identifier = payload.name || payload.title || payload.id || "N/A";
    console.log(`Recibido Webhook: ${topic} para la tienda ${shopDomain} (ID/Ref: ${identifier})`);

    // 7. Lógica según el Topic
    if (topic === "orders/create") {
      await handleOrderCreate(merchantId, integration.comercio, payload);
    } 
    else if (topic === "orders/updated" || topic === "orders/cancelled") {
      await handleOrderUpdate(merchantId, integration.comercio, payload, topic);
    }
    else if (topic === "products/create" || topic === "products/update") {
      await handleProductSave(merchantId, integration.comercio, payload);
    }
    else if (topic === "products/delete") {
      await handleProductDelete(merchantId, integration.comercio, payload);
    }

    return new Response("Webhook processed", { status: 200 });

  } catch (error) {
    console.error("Error procesando webhook:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
});


// ==========================================
// FUNCIONES DE MANEJO DE ORDENES
// ==========================================

async function handleOrderCreate(merchantId, comercio, order) {
  // Preparamos los datos del pedido principal
  const orderData = {
    merchant_id: merchantId,
    comercio: comercio,
    external_order_number: order.name,
    external_platform: "Shopify",
    payment_status: order.financial_status,
    total_value: order.current_total_price,
    customer_email: order.contact_email || order.email,
    customer_phone: order.shipping_address?.phone,
    customer_name: order.shipping_address ? `${order.shipping_address.first_name} ${order.shipping_address.last_name}` : "",
    shipping_address: order.shipping_address?.address1,
    shipping_city: order.shipping_address?.city,
    shipping_complement: order.shipping_address?.address2,
    shipping_method: order.shipping_lines && order.shipping_lines.length > 0 ? order.shipping_lines[0].title : null,
    raw_shopify_data: order,
    created_at: new Date(order.created_at).toISOString(),
    status: "para procesar"
  };

  // Verificamos que no exista
  const { data: existing } = await supabase
    .from("orders")
    .select("id")
    .eq("merchant_id", merchantId)
    .eq("external_order_number", order.name)
    .maybeSingle();

  if (existing) {
    console.log(`El pedido ${order.name} ya existe en WMS, omitiendo inserción.`);
    return;
  }

  // Insertar la cabecera del pedido
  const { data: newOrder, error: orderErr } = await supabase
    .from("orders")
    .insert([orderData])
    .select("id")
    .single();

  if (orderErr || !newOrder) {
    console.error("Error creando pedido:", orderErr);
    return;
  }

  console.log(`Creado pedido cabecera ${order.name} con ID: ${newOrder.id}`);

  // Buscar la primera bodega asignada al comerciante para guardarla en los items
  const { data: whRelation } = await supabase
    .from("merchants_warehouses")
    .select("warehouse_id")
    .eq("merchant_id", merchantId)
    .limit(1)
    .maybeSingle();
    
  const warehouseId = whRelation?.warehouse_id || null;

  // Registrar cada item del pedido
  const lineItems = order.line_items || [];
  for (const item of lineItems) {
    let product = null;

    // Buscar si existe equivalencia para el SKU en Shopify o Todas las plataformas
    let cleanSku = (item.sku || "").trim().replace(/\s+/g, '');
    let mappedSku = cleanSku;
    let hasEquivalence = false;

    if (cleanSku) {
      const { data: eqData } = await supabase
        .from("sku_equivalences")
        .select("master_sku, platform")
        .eq("comercio", comercio)
        .eq("platform_sku", cleanSku)
        .in("platform", ["Shopify", "Todas"]);

      if (eqData && eqData.length > 0) {
        const exactMatch = eqData.find((e: any) => e.platform === "Shopify");
        mappedSku = exactMatch ? exactMatch.master_sku : eqData[0].master_sku;
        hasEquivalence = true;
      }
    }

    // Buscar el producto en el catálogo por shopify_variant_id o SKU
    let query = supabase.from("products").select("id");
    if (hasEquivalence) {
      query = query.eq("sku", mappedSku).eq("comercio", comercio);
    } else if (item.variant_id) {
      query = query.eq("shopify_variant_id", item.variant_id.toString());
    } else {
      query = query.eq("sku", cleanSku).eq("comercio", comercio);
    }
    
    const { data: foundProduct } = await query.maybeSingle();
    product = foundProduct;

    // Auto-crear producto si no existe en el catálogo
    if (!product) {
      const targetSku = hasEquivalence ? mappedSku : (item.sku || item.variant_id.toString());
      const { data: newProd, error: prodErr } = await supabase
        .from("products")
        .insert([{
          merchant_id: merchantId,
          comercio: comercio,
          sku: targetSku,
          name: `${item.title}${item.variant_title && item.variant_title !== "Default Title" ? " - " + item.variant_title : ""}`,
          price: item.price ? parseFloat(item.price) : 0,
          description: "Creado automáticamente desde webhook de Shopify" + (hasEquivalence ? ` (Equivalencia de SKU: ${cleanSku})` : ""),
          shopify_product_id: item.product_id?.toString() || null,
          shopify_variant_id: item.variant_id?.toString() || null,
          shopify_stock: 0,
          status: "active"
        }])
        .select("id")
        .single();

      if (!prodErr && newProd) {
        console.log(`Creado producto faltante SKU ${targetSku} en catálogo.`);
        product = newProd;
      } else {
        console.error(`Error auto-creando producto SKU ${targetSku}:`, prodErr);
      }
    }

    if (product) {
      // Registrar el item en order_items
      const { error: itemErr } = await supabase
        .from("order_items")
        .insert([{
          order_id: newOrder.id,
          product_id: product.id,
          warehouse_id: warehouseId,
          quantity: item.quantity
        }]);

      if (itemErr) {
        console.error(`Error insertando item SKU ${item.sku} en order_items:`, itemErr);
      } else {
        console.log(`Registrado item SKU ${item.sku} x ${item.quantity} para el pedido.`);
      }
    }
  }
}

async function handleOrderUpdate(merchantId, comercio, order, topic) {
  // Buscamos el estado actual del pedido en WMS
  const { data: existingOrder, error: findErr } = await supabase
    .from("orders")
    .select("id, status, estado_wms")
    .eq("merchant_id", merchantId)
    .eq("external_order_number", order.name)
    .maybeSingle();

  if (findErr || !existingOrder) {
    console.log("Pedido no encontrado en WMS, ignorando actualización.");
    return;
  }

  // Preparamos datos a actualizar (puede que haya cambiado dirección o estado de pago)
  const updatedData = {
    payment_status: order.financial_status,
    total_value: order.current_total_price,
    shipping_address: order.shipping_address?.address1,
    shipping_city: order.shipping_address?.city,
    shipping_complement: order.shipping_address?.address2,
    shipping_method: order.shipping_lines && order.shipping_lines.length > 0 ? order.shipping_lines[0].title : null,
    raw_shopify_data: order
  };

  // Si es cancelación, forzamos estado (opcional: o solo emitimos alerta y dejamos que operario cancele)
  if (topic === "orders/cancelled") {
      updatedData.status = "cancelado";
  }

  // Actualizamos en BD
  const { error: upErr } = await supabase
    .from("orders")
    .update(updatedData)
    .eq("id", existingOrder.id);

  if (upErr) {
    console.error("Error actualizando pedido:", upErr);
    return;
  }

  // Lógica de Alertas Condicionales
  // Estados críticos del WMS: 'En preparación', 'Pickeado', 'Despachado', 'Incidencia'
  const wmsStatus = existingOrder.estado_wms || 'En procesamiento';
  const estadosCriticos = ['En preparación', 'Pickeado', 'Despachado', 'Incidencia'];
  
  if (estadosCriticos.includes(wmsStatus)) {
    let alertMessage = `El pedido ${order.name} ha sido modificado en Shopify mientras estaba en WMS con estado: ${wmsStatus}.`;
    let alertType = 'MODIFICADO_EN_PREPARACION';

    if (topic === "orders/cancelled") {
        alertMessage = `¡CRÍTICO! El pedido ${order.name} ha sido CANCELADO en Shopify, pero aquí se encuentra en WMS con estado: ${wmsStatus}. Detener despacho de inmediato.`;
        alertType = 'CANCELADO_EN_PREPARACION';
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
      
    if (alertErr) console.error("Error creando alerta:", alertErr);
  } else {
    // Si NO está en un estado crítico (ej: está 'para procesar'), sincronizamos los items del pedido
    // para mantener el WMS actualizado antes de que comience la preparación.
    
    // 1. Eliminar ítems anteriores
    await supabase.from("order_items").delete().eq("order_id", existingOrder.id);

    // 2. Obtener primera bodega asignada al comerciante
    const { data: whRelation } = await supabase
      .from("merchants_warehouses")
      .select("warehouse_id")
      .eq("merchant_id", merchantId)
      .limit(1)
      .maybeSingle();
      
    const warehouseId = whRelation?.warehouse_id || null;

    // 3. Registrar ítems actualizados
    const lineItems = order.line_items || [];
    for (const item of lineItems) {
      let product = null;

      // Buscar si existe equivalencia para el SKU en Shopify o Todas las plataformas
      let cleanSku = (item.sku || "").trim().replace(/\s+/g, '');
      let mappedSku = cleanSku;
      let hasEquivalence = false;

      if (cleanSku) {
        const { data: eqData } = await supabase
          .from("sku_equivalences")
          .select("master_sku, platform")
          .eq("comercio", comercio)
          .eq("platform_sku", cleanSku)
          .in("platform", ["Shopify", "Todas"]);

        if (eqData && eqData.length > 0) {
          const exactMatch = eqData.find((e: any) => e.platform === "Shopify");
          mappedSku = exactMatch ? exactMatch.master_sku : eqData[0].master_sku;
          hasEquivalence = true;
        }
      }

      // Buscar el producto en el catálogo
      let query = supabase.from("products").select("id");
      if (hasEquivalence) {
        query = query.eq("sku", mappedSku).eq("comercio", comercio);
      } else if (item.variant_id) {
        query = query.eq("shopify_variant_id", item.variant_id.toString());
      } else {
        query = query.eq("sku", cleanSku).eq("comercio", comercio);
      }
      
      const { data: foundProduct } = await query.maybeSingle();
      product = foundProduct;

      // Auto-crear producto si no existe
      if (!product) {
        const targetSku = hasEquivalence ? mappedSku : (item.sku || item.variant_id.toString());
        const { data: newProd } = await supabase
          .from("products")
          .insert([{
            merchant_id: merchantId,
            comercio: comercio,
            sku: targetSku,
            name: `${item.title}${item.variant_title && item.variant_title !== "Default Title" ? " - " + item.variant_title : ""}`,
            price: item.price ? parseFloat(item.price) : 0,
            description: "Creado automáticamente desde webhook de Shopify al actualizar" + (hasEquivalence ? ` (Equivalencia de SKU: ${cleanSku})` : ""),
            shopify_product_id: item.product_id?.toString() || null,
            shopify_variant_id: item.variant_id?.toString() || null,
            shopify_stock: 0,
            status: "active"
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
    console.log(`Ítems actualizados con éxito para el pedido ${order.name} en estado no crítico.`);
  }
}

// ==========================================
// FUNCIONES DE MANEJO DE PRODUCTOS (REAL-TIME SYNC)
// ==========================================

async function handleProductSave(merchantId, comercio, product) {
  console.log(`Guardando variantes del producto ID ${product.id} ("${product.title}") vía Webhook`);
  const productStatus = product.status || "active";

  for (const variant of product.variants) {
    // Intentar obtener la imagen asociada a la variante o la primera del producto como fallback
    let imageUrl = "";
    if (product.images && product.images.length > 0) {
      const variantImage = product.images.find((img: any) => img.variant_ids && img.variant_ids.includes(variant.id));
      imageUrl = variantImage ? variantImage.src : product.images[0].src;
    }

    const productDataToUpsert = {
      merchant_id: merchantId,
      comercio: comercio,
      sku: variant.sku || variant.id.toString(),
      name: `${product.title} ${variant.title !== "Default Title" ? "- " + variant.title : ""}`,
      description: product.body_html || "",
      barcode: variant.barcode || null,
      price: variant.price ? parseFloat(variant.price) : 0.0,
      weight: variant.weight || null,
      shopify_product_id: product.id.toString(),
      shopify_variant_id: variant.id.toString(),
      image_url: imageUrl || null,
      shopify_stock: variant.inventory_quantity ?? 0,
      status: productStatus,
      raw_shopify_data: variant
    };

    const { error } = await supabase
      .from("products")
      .upsert(productDataToUpsert, { onConflict: "comercio,sku" });

    if (error) {
      console.error(`Error al insertar/actualizar variante de producto SKU ${variant.sku}:`, error);
    } else {
      console.log(`Variante SKU ${variant.sku} sincronizada con éxito en tiempo real.`);
    }
  }
}

async function handleProductDelete(merchantId, comercio, payload) {
  const shopifyProductId = payload.id?.toString();
  if (!shopifyProductId) return;

  console.log(`Marcando variantes del producto ID ${shopifyProductId} como archivadas (eliminado en Shopify)`);
  
  const { error } = await supabase
    .from("products")
    .update({ status: "archived" })
    .eq("merchant_id", merchantId)
    .eq("shopify_product_id", shopifyProductId);

  if (error) {
    console.error(`Error archivando variantes para producto ${shopifyProductId}:`, error);
  } else {
    console.log(`Variantes archivadas con éxito para el producto ID ${shopifyProductId}.`);
  }
}
