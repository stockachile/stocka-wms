import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// Configuración cliente Supabase (usando variables de entorno inyectadas por Supabase)
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

serve(async (req) => {
  // Solo aceptamos POST
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // 1. Obtener merchant_id desde la URL (query parameter)
    // El webhook debe configurarse en Shopify como: https://[PROYECTO].supabase.co/functions/v1/shopify-webhook?merchant_id=TU-UUID
    const url = new URL(req.url);
    const merchantId = url.searchParams.get("merchant_id");

    if (!merchantId) {
      return new Response("Missing merchant_id in URL", { status: 400 });
    }

    // 2. Obtener el secreto del webhook del cliente
    const { data: integration, error: intError } = await supabase
      .from("merchant_integrations")
      .select("webhook_secret, comercio")
      .eq("merchant_id", merchantId)
      .eq("platform", "Shopify")
      .maybeSingle();

    if (intError || !integration || !integration.webhook_secret) {
      console.error("Integración o webhook_secret no encontrado para:", merchantId);
      // Retornar 200 para que Shopify no reintente si no tenemos el secreto configurado aún
      return new Response("Integration not fully configured", { status: 200 }); 
    }

    // 3. Verificación de Seguridad HMAC (Shopify)
    const hmacHeader = req.headers.get("x-shopify-hmac-sha256");
    const topic = req.headers.get("x-shopify-topic");
    const shopDomain = req.headers.get("x-shopify-shop-domain");

    if (!hmacHeader || !topic) {
      return new Response("Missing Shopify headers", { status: 400 });
    }

    // Leemos el raw body como texto para verificar la firma
    const rawBody = await req.text();
    
    // Verificación HMAC nativa con Web Crypto API para evitar empaquetar librerías externas
    const keyBuf = new TextEncoder().encode(integration.webhook_secret);
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

    // 4. Parsear el body JSON
    const payload = JSON.parse(rawBody);
    console.log(`Recibido Webhook: ${topic} para la tienda ${shopDomain} (Order: ${payload.name})`);

    // 5. Lógica según el Topic
    if (topic === "orders/create") {
      await handleOrderCreate(merchantId, integration.comercio, payload);
    } 
    else if (topic === "orders/updated" || topic === "orders/cancelled") {
      await handleOrderUpdate(merchantId, integration.comercio, payload, topic);
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

    // Buscar el producto en el catálogo por shopify_variant_id o SKU
    let query = supabase.from("products").select("id");
    if (item.variant_id) {
      query = query.eq("shopify_variant_id", item.variant_id.toString());
    } else {
      query = query.eq("sku", item.sku).eq("comercio", comercio);
    }
    
    const { data: foundProduct } = await query.maybeSingle();
    product = foundProduct;

    // Auto-crear producto si no existe en el catálogo
    if (!product) {
      const { data: newProd, error: prodErr } = await supabase
        .from("products")
        .insert([{
          merchant_id: merchantId,
          comercio: comercio,
          sku: item.sku || item.variant_id.toString(),
          name: `${item.title}${item.variant_title && item.variant_title !== "Default Title" ? " - " + item.variant_title : ""}`,
          price: item.price ? parseFloat(item.price) : 0,
          description: "Creado automáticamente desde webhook de Shopify",
          shopify_product_id: item.product_id?.toString() || null,
          shopify_variant_id: item.variant_id?.toString() || null,
          shopify_stock: 0,
          status: "active"
        }])
        .select("id")
        .single();

      if (!prodErr && newProd) {
        console.log(`Creado producto faltante SKU ${item.sku} en catálogo.`);
        product = newProd;
      } else {
        console.error(`Error auto-creando producto SKU ${item.sku}:`, prodErr);
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
    .select("id, status")
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
  // Estados críticos: 'en preparación', 'preparado', 'despachado'
  const estadosCriticos = ['en preparación', 'preparado', 'despachado'];
  
  if (estadosCriticos.includes(existingOrder.status)) {
    let alertMessage = `El pedido ${order.name} ha sido modificado en Shopify mientras estaba en estado: ${existingOrder.status}.`;
    let alertType = 'MODIFICADO_EN_PREPARACION';

    if (topic === "orders/cancelled") {
        alertMessage = `¡CRÍTICO! El pedido ${order.name} ha sido CANCELADO en Shopify, pero aquí se encuentra en estado: ${existingOrder.status}. Detener despacho de inmediato.`;
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
  }
}
