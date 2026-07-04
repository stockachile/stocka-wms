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
    // El webhook debe configurarse en Jumpseller como:
    // https://[PROYECTO].supabase.co/functions/v1/jumpseller-webhook?merchant_id=TU-UUID
    const url = new URL(req.url);
    const merchantId = url.searchParams.get("merchant_id");

    if (!merchantId) {
      return new Response("Missing merchant_id in URL", { status: 400 });
    }

    // 2. Obtener la integración y su webhook_secret (Hooks Token) de Jumpseller
    const { data: integration, error: intError } = await supabase
      .from("merchant_integrations")
      .select("webhook_secret, comercio")
      .eq("merchant_id", merchantId)
      .eq("platform", "Jumpseller")
      .maybeSingle();

    if (intError || !integration || !integration.webhook_secret) {
      console.error("Integración o webhook_secret no encontrado para:", merchantId);
      // Retornar 200 para que Jumpseller no reintente indefinitely
      return new Response("Integration not fully configured", { status: 200 }); 
    }

    // 3. Verificación de Seguridad HMAC (Jumpseller envía la firma en Base64)
    const hmacHeader = req.headers.get("jumpseller-hmac-sha256");
    const eventTopic = req.headers.get("jumpseller-event");

    if (!hmacHeader || !eventTopic) {
      return new Response("Missing Jumpseller headers", { status: 400 });
    }

    // Leemos el raw body como texto para verificar la firma
    const rawBody = await req.text();
    
    // Verificación HMAC nativa con Web Crypto API
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
      console.error("Firma HMAC inválida de Jumpseller");
      return new Response("Unauthorized", { status: 401 });
    }

    // 4. Parsear el body JSON
    const payload = JSON.parse(rawBody);

    // Jumpseller a veces envuelve el objeto en una clave raíz ('order' o 'product')
    const order = payload.order ? payload.order : (eventTopic.startsWith("order_") ? payload : null);
    const product = payload.product ? payload.product : (eventTopic.startsWith("product_") ? payload : null);

    console.log(`Recibido Webhook Jumpseller: ${eventTopic} (Merchant: ${merchantId})`);

    // 5. Lógica según el Evento
    if (eventTopic.startsWith("order_")) {
      if (!order) {
        return new Response("Invalid order payload", { status: 400 });
      }

      const statusName = order.status; // 'Pending', 'Paid', 'Canceled', 'Abandoned', 'Open'
      const isCancelled = ['Canceled', 'Abandoned', 'Open'].includes(statusName);

      if (eventTopic === "order_canceled" || isCancelled) {
        await handleOrderCancel(merchantId, integration.comercio, order);
      } else {
        // order_pending, order_paid, order_updated, etc.
        await handleOrderSave(merchantId, integration.comercio, order);
      }
    } 
    else if (eventTopic.startsWith("product_")) {
      if (!product) {
        return new Response("Invalid product payload", { status: 400 });
      }

      if (eventTopic === "product_deleted") {
        await handleProductDelete(merchantId, product);
      } else {
        // product_created, product_updated
        await handleProductSave(merchantId, integration.comercio, product);
      }
    }

    return new Response("Webhook processed", { status: 200 });

  } catch (error) {
    console.error("Error procesando webhook Jumpseller:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
});

// ==========================================
// FUNCIONES DE MANEJO DE PEDIDOS
// ==========================================

async function handleOrderSave(merchantId: string, comercio: string, order: any) {
  const orderNumber = `#JS-${order.id}`;
  const statusName = order.status; // 'Pending', 'Paid', etc.

  // Clasificación de estados
  const isDelivered = order.shipment_status === 'shipped' || order.shipment_status === 'delivered';
  const isCancelled = ['Canceled', 'Abandoned', 'Open'].includes(statusName);
  const isActive = !isDelivered && !isCancelled;

  // Cargar equivalencias de SKU
  const skuMap: Record<string, string> = {};
  try {
    const { data: equivalences } = await supabase
      .from('sku_equivalences')
      .select('platform_sku, master_sku, platform')
      .eq('comercio', comercio);
    
    if (equivalences) {
      equivalences.filter((e: any) => e.platform === 'Todas').forEach((e: any) => {
        if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
      });
      equivalences.filter((e: any) => e.platform === 'Jumpseller').forEach((e: any) => {
        if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
      });
    }
  } catch (err) {
    console.error('⚠️ Error al cargar equivalencias de SKU:', err.message);
  }

  // Verificar si existe el pedido
  const { data: existingOrder } = await supabase
    .from('orders')
    .select('id, status, estado_wms')
    .eq('merchant_id', merchantId)
    .eq('external_order_number', orderNumber)
    .eq('external_platform', 'Jumpseller')
    .maybeSingle();

  // Calcular ítems de la orden
  const itemNames: string[] = [];
  const itemQuantities: Record<string, number> = {};

  if (order.products) {
    for (const op of order.products) {
      let sku = op.sku || `JS-${op.product_id}${op.variant_id ? '-' + op.variant_id : ''}`;
      sku = sku.trim().replace(/\s+/g, '');
      let mappedSku = skuMap[sku] || sku;

      itemQuantities[mappedSku] = (itemQuantities[mappedSku] || 0) + Number(op.quantity);
      if (op.name && !itemNames.includes(op.name)) {
        itemNames.push(op.name);
      }
    }
  }

  const totalValue = Number(order.total || 0);

  const orderData = {
    merchant_id: merchantId,
    comercio: comercio,
    external_order_number: orderNumber,
    external_platform: 'Jumpseller',
    payment_status: statusName === 'Paid' ? 'PAID' : 'PENDING',
    total_value: totalValue,
    customer_email: order.customer?.email || order.shipping_address?.email || order.billing_address?.email,
    customer_phone: order.customer?.phone || order.shipping_address?.phone || order.billing_address?.phone,
    customer_name: order.customer?.name || order.shipping_address?.name || order.billing_address?.name || 'Cliente Jumpseller',
    shipping_address: order.shipping_address?.address || order.billing_address?.address,
    shipping_city: order.shipping_address?.city || order.billing_address?.city,
    shipping_complement: order.shipping_address?.municipality || order.shipping_address?.region || '',
    raw_jumpseller_data: order,
    created_at: new Date(order.created_at).toISOString()
  };

  let localOrderId = null;
  let shouldInsertItems = false;

  if (existingOrder) {
    // Si ya existe, actualizamos cabecera
    await supabase.from('orders').update(orderData).eq('id', existingOrder.id);
    localOrderId = existingOrder.id;

    // Alertas críticas si el pedido ya está siendo preparado
    const wmsStatus = existingOrder.estado_wms || 'En procesamiento';
    const estadosCriticos = ['En preparación', 'Pickeado', 'Despachado', 'Incidencia'];

    if (estadosCriticos.includes(wmsStatus)) {
      await supabase.from("order_alerts").insert([{
        merchant_id: merchantId,
        order_id: existingOrder.id,
        alert_type: 'MODIFICADO_EN_PREPARACION',
        message: `El pedido ${orderNumber} ha sido modificado en Jumpseller mientras estaba en WMS con estado: ${wmsStatus}.`
      }]);
      console.log(`Alerta emitida para pedido modificado en WMS: ${orderNumber}`);
    } else {
      // Si no es crítico, actualizamos ítems (borrar viejos, insertar nuevos)
      await supabase.from("order_items").delete().eq("order_id", localOrderId);
      shouldInsertItems = true;
    }
  } else if (isActive) {
    // Si no existe y está activo, lo creamos
    const { data: newOrder, error: insErr } = await supabase
      .from('orders')
      .insert([{ ...orderData, status: 'para procesar' }])
      .select('id')
      .single();

    if (insErr || !newOrder) {
      console.error(`❌ Error al crear orden ${orderNumber}:`, insErr?.message);
      return;
    }
    localOrderId = newOrder.id;
    shouldInsertItems = true;
    console.log(`Pedido ${orderNumber} ingresado en WMS con éxito.`);
  }

  // Insertar ítems
  if (localOrderId && shouldInsertItems) {
    const { data: whRel } = await supabase
      .from('merchants_warehouses')
      .select('warehouse_id')
      .eq('merchant_id', merchantId)
      .limit(1)
      .maybeSingle();
    const warehouseId = whRel?.warehouse_id || null;

    for (const [sku, qty] of Object.entries(itemQuantities)) {
      let { data: product } = await supabase
        .from('products')
        .select('id')
        .eq('merchant_id', merchantId)
        .eq('sku', sku)
        .maybeSingle();

      if (!product) {
        // Auto-crear producto si falta en catálogo
        const itemDetail = order.products?.find((op: any) => {
          let opSku = op.sku || `JS-${op.product_id}${op.variant_id ? '-' + op.variant_id : ''}`;
          let cleanItemSku = opSku.trim().replace(/\s+/g, '');
          let mappedItemSku = skuMap[cleanItemSku] || cleanItemSku;
          return mappedItemSku === sku;
        });

        const productName = itemDetail?.name || 'Producto Jumpseller ' + sku;
        const productPrice = Number(itemDetail?.price || 0);

        const { data: newProd } = await supabase
          .from('products')
          .insert([{
            merchant_id: merchantId,
            comercio: comercio,
            sku: sku,
            name: productName,
            price: productPrice,
            description: 'Creado automáticamente desde webhook de Jumpseller',
            jumpseller_product_id: itemDetail ? itemDetail.product_id.toString() : null,
            jumpseller_variant_id: itemDetail && itemDetail.variant_id ? itemDetail.variant_id.toString() : null,
            raw_jumpseller_data: itemDetail || null
          }])
          .select('id')
          .single();

        product = newProd;
      }

      if (product && warehouseId) {
        await supabase.from('order_items').insert([{
          order_id: localOrderId,
          product_id: product.id,
          warehouse_id: warehouseId,
          quantity: qty
        }]);
      }
    }
    console.log(`Ítems sincronizados con éxito para la orden ${orderNumber}.`);
  }
}

async function handleOrderCancel(merchantId: string, comercio: string, order: any) {
  const orderNumber = `#JS-${order.id}`;

  const { data: existingOrder } = await supabase
    .from('orders')
    .select('id, status, estado_wms')
    .eq('merchant_id', merchantId)
    .eq('external_order_number', orderNumber)
    .eq('external_platform', 'Jumpseller')
    .maybeSingle();

  if (!existingOrder) {
    console.log(`Pedido cancelado ${orderNumber} no existía en WMS. Nada que hacer.`);
    return;
  }

  // Si está en estado crítico en WMS, emitir alerta en lugar de cancelar a ciegas
  const wmsStatus = existingOrder.estado_wms || 'En procesamiento';
  const estadosCriticos = ['En preparación', 'Pickeado', 'Despachado', 'Incidencia'];

  if (estadosCriticos.includes(wmsStatus)) {
    await supabase.from("order_alerts").insert([{
      merchant_id: merchantId,
      order_id: existingOrder.id,
      alert_type: 'CANCELADO_EN_PREPARACION',
      message: `¡CRÍTICO! El pedido ${orderNumber} ha sido CANCELADO en Jumpseller, pero se encuentra en WMS en estado: ${wmsStatus}. Detener preparación de inmediato.`
    }]);
    console.log(`Alerta de cancelación emitida para pedido en WMS: ${orderNumber}`);
  }

  // De todos modos, actualizamos el estado del pedido a cancelado en la BD
  await supabase
    .from('orders')
    .update({ status: 'cancelado', raw_jumpseller_data: order })
    .eq('id', existingOrder.id);
  
  console.log(`Pedido ${orderNumber} marcado como cancelado.`);
}

// ==========================================
// FUNCIONES DE MANEJO DE PRODUCTOS
// ==========================================

async function handleProductSave(merchantId: string, comercio: string, product: any) {
  console.log(`Sincronizando producto Jumpseller ID: ${product.id} ("${product.name}") vía Webhook`);

  // Cargar equivalencias de SKU
  const skuMap: Record<string, string> = {};
  try {
    const { data: equivalences } = await supabase
      .from('sku_equivalences')
      .select('platform_sku, master_sku, platform')
      .eq('comercio', comercio);
    
    if (equivalences) {
      equivalences.filter((e: any) => e.platform === 'Todas').forEach((e: any) => {
        if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
      });
      equivalences.filter((e: any) => e.platform === 'Jumpseller').forEach((e: any) => {
        if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
      });
    }
  } catch (err) {
    console.error('⚠️ Error al cargar equivalencias de SKU:', err.message);
  }

  // Si no tiene variantes
  if (!product.variants || product.variants.length === 0) {
    let variantSku = product.sku || `JS-${product.id}`;
    let cleanSku = variantSku.trim().replace(/\s+/g, '');
    let mappedSku = skuMap[cleanSku] || cleanSku;

    const productData = {
      merchant_id: merchantId,
      comercio: comercio,
      sku: mappedSku,
      name: product.name,
      description: product.description || "",
      price: product.price || 0,
      jumpseller_product_id: product.id.toString(),
      jumpseller_variant_id: null,
      raw_jumpseller_data: product
    };

    const { error } = await supabase
      .from("products")
      .upsert(productData, { onConflict: "comercio,sku" });

    if (error) console.error(`Error al guardar producto SKU ${mappedSku}:`, error);
    else console.log(`Producto SKU ${mappedSku} (Simple) sincronizado.`);
  } else {
    // Si tiene variantes, guardamos cada una de ellas
    for (const vItem of product.variants) {
      const v = vItem.variant;
      let variantSku = v.sku || `JS-${product.id}-${v.id}`;
      let cleanSku = variantSku.trim().replace(/\s+/g, '');
      let mappedSku = skuMap[cleanSku] || cleanSku;

      const productData = {
        merchant_id: merchantId,
        comercio: comercio,
        sku: mappedSku,
        name: `${product.name} - Variante ${v.id}`,
        description: product.description || "",
        price: v.price || product.price || 0,
        jumpseller_product_id: product.id.toString(),
        jumpseller_variant_id: v.id.toString(),
        raw_jumpseller_data: v
      };

      const { error } = await supabase
        .from("products")
        .upsert(productData, { onConflict: "comercio,sku" });

      if (error) console.error(`Error al guardar variante SKU ${mappedSku}:`, error);
      else console.log(`Variante SKU ${mappedSku} sincronizada.`);
    }
  }
}

async function handleProductDelete(merchantId: string, product: any) {
  const jumpsellerProductId = product.id?.toString();
  if (!jumpsellerProductId) return;

  const { error } = await supabase
    .from("products")
    .delete()
    .eq("merchant_id", merchantId)
    .eq("jumpseller_product_id", jumpsellerProductId);

  if (error) {
    console.error(`Error al borrar producto Jumpseller ID ${jumpsellerProductId}:`, error);
  } else {
    console.log(`Producto Jumpseller ID ${jumpsellerProductId} borrado del catálogo WMS.`);
  }
}
