import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// Configuración de Supabase
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Bodega Central por defecto en WMS Stocka
const DEFAULT_WAREHOUSE_ID = "ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PATCH, DELETE"
};

// =========================================================================
// HELPER DE RESPUESTAS JSON
// =========================================================================
function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

// =========================================================================
// MAPEO DE ESTADOS WMS -> ESTADOS API
// =========================================================================
function mapWmsStatus(estadoWms: string | null, status: string | null): string {
  const normWms = (estadoWms || "").trim().toLowerCase();
  const normStatus = (status || "").trim().toLowerCase();

  if (normWms === "despachado" || normStatus === "despachado") {
    return "despachado";
  }
  if (normWms === "cancelado" || normStatus === "cancelado") {
    return "cancelado";
  }
  if (["en preparación", "en preparacion", "pickeado"].includes(normWms)) {
    return "en_preparacion";
  }
  return "recibido";
}

// =========================================================================
// FIRMA HMAC SHA-256 PARA WEBHOOKS SALIENTES
// =========================================================================
async function generateHmacSignature(secret: string, bodyText: string): Promise<string> {
  const keyBuf = new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBuf,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const dataBuf = new TextEncoder().encode(bodyText);
  const signature = await crypto.subtle.sign("HMAC", key, dataBuf);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// =========================================================================
// SERVIDOR PRINCIPAL
// =========================================================================
serve(async (req: Request) => {
  // Manejo de pre-flight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const rawPath = url.pathname;
    
    // Normalizar sub-ruta: remover prefijo de funciones
    // Soporta llamadas como /functions/v1/floractive-api/orders o /floractive-api/orders o /orders
    let path = rawPath
      .replace(/^\/functions\/v1\/floractive-api\/?/, "")
      .replace(/^\/floractive-api\/?/, "")
      .replace(/^\//, "");

    // Si viene por query param ?action=...
    const queryAction = url.searchParams.get("action") || "";
    if (!path && queryAction) {
      path = queryAction;
    }

    // =========================================================================
    // 1. AUTENTICACIÓN POR API KEY
    // =========================================================================
    const apiKey = 
      req.headers.get("x-api-key") || 
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || 
      url.searchParams.get("api_key") || 
      "";

    if (!apiKey) {
      return jsonResponse({
        success: false,
        error: "Unauthorized",
        message: "Falta la cabecera 'x-api-key' con tu API Key autorizada."
      }, 401);
    }

    // Validar API Key en client_api_keys
    const { data: clientAuth, error: authErr } = await supabase
      .from("client_api_keys")
      .select("id, merchant_id, comercio, webhook_url, webhook_secret, is_active")
      .eq("api_key", apiKey)
      .eq("is_active", true)
      .maybeSingle();

    if (authErr || !clientAuth) {
      return jsonResponse({
        success: false,
        error: "Forbidden",
        message: "API Key inválida o inactiva."
      }, 403);
    }

    const { merchant_id: merchantId, comercio } = clientAuth;

    // Actualizar asíncronamente fecha de último uso
    supabase
      .from("client_api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", clientAuth.id)
      .then();

    // =========================================================================
    // 2. ENRUTAMIENTO DE ENDPOINTS
    // =========================================================================

    // -------------------------------------------------------------------------
    // RUTA: GET / o GET /health
    // -------------------------------------------------------------------------
    if (req.method === "GET" && (path === "" || path === "health")) {
      return jsonResponse({
        success: true,
        service: "WMS Stocka - Client Integration API",
        comercio: comercio,
        merchant_id: merchantId,
        status: "active",
        timestamp: new Date().toISOString(),
        endpoints: {
          stock: "GET /stock (opcional: ?sku=XYZ)",
          crear_pedido: "POST /orders",
          consultar_pedido: "GET /orders/:numero_pedido"
        }
      });
    }

    // -------------------------------------------------------------------------
    // RUTA: GET /stock (Consulta de stock físico y disponible)
    // -------------------------------------------------------------------------
    if (req.method === "GET" && path === "stock") {
      const skuFilter = url.searchParams.get("sku")?.trim() || "";
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "1000", 10), 5000);
      const offset = parseInt(url.searchParams.get("offset") || "0", 10);

      // 1. Consultar productos del comercio
      let prodQuery = supabase
        .from("products")
        .select("id, sku, name, barcode, is_virtual, created_at")
        .eq("comercio", comercio)
        .order("sku", { ascending: true })
        .range(offset, offset + limit - 1);

      if (skuFilter) {
        prodQuery = prodQuery.eq("sku", skuFilter);
      }

      const { data: products, error: prodErr } = await prodQuery;

      if (prodErr) {
        console.error("Error consultando productos:", prodErr);
        return jsonResponse({ success: false, error: prodErr.message }, 500);
      }

      if (!products || products.length === 0) {
        return jsonResponse({
          success: true,
          comercio: comercio,
          total: 0,
          data: []
        });
      }

      // 2. Consultar inventario de esos productos
      const productIds = products.map(p => p.id);
      const { data: inventoryData, error: invErr } = await supabase
        .from("inventory")
        .select("product_id, warehouse_id, quantity, committed_quantity, reserved_quantity, updated_at")
        .in("product_id", productIds);

      if (invErr) {
        console.error("Error consultando inventario:", invErr);
        return jsonResponse({ success: false, error: invErr.message }, 500);
      }

      // 3. Mapear y consolidar cantidades
      const invMap: Record<string, { physical: number; committed: number; reserved: number; updatedAt: string }> = {};

      (inventoryData || []).forEach(inv => {
        const pid = inv.product_id;
        if (!invMap[pid]) {
          invMap[pid] = { physical: 0, committed: 0, reserved: 0, updatedAt: inv.updated_at || "" };
        }
        invMap[pid].physical += (inv.quantity || 0);
        invMap[pid].committed += (inv.committed_quantity || 0);
        invMap[pid].reserved += (inv.reserved_quantity || 0);
        if (inv.updated_at && (!invMap[pid].updatedAt || inv.updated_at > invMap[pid].updatedAt)) {
          invMap[pid].updatedAt = inv.updated_at;
        }
      });

      const responseData = products.map(p => {
        const inv = invMap[p.id] || { physical: 0, committed: 0, reserved: 0, updatedAt: p.created_at || "" };
        const available = Math.max(0, inv.physical - (inv.committed + inv.reserved));

        return {
          sku: p.sku,
          nombre: p.name,
          barcode: p.barcode || null,
          es_virtual: !!p.is_virtual,
          stock_fisico: inv.physical,
          stock_comprometido: inv.committed,
          stock_reservado: inv.reserved,
          stock_disponible: available,
          actualizado_al: inv.updatedAt || new Date().toISOString()
        };
      });

      return jsonResponse({
        success: true,
        comercio: comercio,
        total: responseData.length,
        data: responseData
      });
    }

    // -------------------------------------------------------------------------
    // RUTA: GET /orders/:numero_pedido o GET /orders?numero_pedido=...
    // -------------------------------------------------------------------------
    if (req.method === "GET" && (path.startsWith("orders/") || (path === "orders" && url.searchParams.get("numero_pedido")))) {
      let orderNumber = "";
      if (path.startsWith("orders/")) {
        orderNumber = decodeURIComponent(path.replace(/^orders\//, "")).trim();
      } else {
        orderNumber = (url.searchParams.get("numero_pedido") || "").trim();
      }

      if (!orderNumber) {
        return jsonResponse({
          success: false,
          error: "Bad Request",
          message: "Debes especificar el número de pedido en la URL (/orders/:numero_pedido)"
        }, 400);
      }

      const { data: order, error: ordErr } = await supabase
        .from("orders")
        .select("id, external_order_number, status, estado_wms, courier, tracking_number, tracking_url, customer_name, total_value, created_at, item, cantidad, sku")
        .eq("comercio", comercio)
        .eq("external_order_number", orderNumber)
        .maybeSingle();

      if (ordErr) {
        return jsonResponse({ success: false, error: ordErr.message }, 500);
      }

      if (!order) {
        return jsonResponse({
          success: false,
          error: "Not Found",
          message: `El pedido '${orderNumber}' no fue encontrado en WMS Stocka para la cuenta ${comercio}.`
        }, 404);
      }

      return jsonResponse({
        success: true,
        order_id: order.id,
        numero_pedido: order.external_order_number,
        estado: mapWmsStatus(order.estado_wms, order.status),
        estado_wms: order.estado_wms || "En procesamiento",
        courier: order.courier || null,
        tracking_number: order.tracking_number || null,
        tracking_url: order.tracking_url || null,
        cliente: order.customer_name,
        resumen_items: order.item,
        total_unidades: order.cantidad,
        fecha_creacion: order.created_at
      });
    }

    // -------------------------------------------------------------------------
    // RUTA: POST /orders (Creación de pedidos pagados en WMS)
    // -------------------------------------------------------------------------
    if (req.method === "POST" && (path === "orders" || path === "")) {
      const rawText = await req.text();
      let payload: any = {};
      try {
        payload = JSON.parse(rawText);
      } catch (_e) {
        return jsonResponse({
          success: false,
          error: "Bad Request",
          message: "El cuerpo de la petición debe ser un JSON válido."
        }, 400);
      }

      // 1. Validar campos obligatorios
      const rawOrderNumber = payload.numero_pedido || payload.order_number || payload.external_order_number || "";
      const numeroPedido = String(rawOrderNumber).trim();

      if (!numeroPedido) {
        return jsonResponse({
          success: false,
          error: "Bad Request",
          message: "El campo 'numero_pedido' es obligatorio."
        }, 400);
      }

      const rawItems = payload.items || payload.line_items || [];
      if (!Array.isArray(rawItems) || rawItems.length === 0) {
        return jsonResponse({
          success: false,
          error: "Bad Request",
          message: "El pedido debe contener al menos un ítem en la lista 'items'."
        }, 400);
      }

      // Validar cada ítem
      for (let i = 0; i < rawItems.length; i++) {
        const it = rawItems[i];
        if (!it.sku || typeof it.sku !== "string" || !it.sku.trim()) {
          return jsonResponse({
            success: false,
            error: "Bad Request",
            message: `El ítem en la posición ${i} no tiene un 'sku' válido.`
          }, 400);
        }
        const qty = Number(it.cantidad ?? it.quantity ?? 1);
        if (isNaN(qty) || qty <= 0) {
          return jsonResponse({
            success: false,
            error: "Bad Request",
            message: `La cantidad del ítem '${it.sku}' debe ser un número entero mayor a 0.`
          }, 400);
        }
      }

      // 2. IDEMPOTENCIA: Verificar si el pedido ya existe en Stocka
      const { data: existingOrder } = await supabase
        .from("orders")
        .select("id, external_order_number, status, estado_wms, courier, tracking_number, created_at")
        .eq("comercio", comercio)
        .eq("external_order_number", numeroPedido)
        .maybeSingle();

      if (existingOrder) {
        return jsonResponse({
          success: true,
          already_exists: true,
          message: "El pedido ya fue registrado previamente en WMS Stocka.",
          order_id: existingOrder.id,
          numero_pedido: existingOrder.external_order_number,
          estado: mapWmsStatus(existingOrder.estado_wms, existingOrder.status),
          estado_wms: existingOrder.estado_wms || "En procesamiento",
          courier: existingOrder.courier || null,
          tracking_number: existingOrder.tracking_number || null,
          fecha_creacion: existingOrder.created_at
        }, 200);
      }

      // 3. Extraer y formatear datos del cliente
      const cliente = payload.cliente || payload.customer || {};
      const customerName = (
        cliente.nombre || 
        cliente.name || 
        `${cliente.first_name || ""} ${cliente.last_name || ""}`.trim() || 
        "Cliente Floractive"
      ).trim();
      const customerEmail = (cliente.email || "no-email@floractive.cl").trim();
      const customerPhone = (cliente.telefono || cliente.phone || "No especificado").trim();

      // 4. Tipo de entrega y dirección
      const tipoEntregaRaw = String(payload.tipo_entrega || payload.shipping_type || "despacho").toLowerCase();
      const isPickup = tipoEntregaRaw.includes("retiro") || tipoEntregaRaw.includes("pickup");

      const dirData = payload.direccion_entrega || payload.shipping_address || payload.direccion || {};
      let shippingAddress = "No especificada";
      let shippingCity = "Santiago";
      let shippingComplement = "";

      if (isPickup) {
        shippingAddress = "Retiro en Bodega Central (WMS Stocka)";
        shippingCity = "Santiago";
        shippingComplement = "RETIRO EN BODEGA";
      } else {
        shippingAddress = (dirData.direccion || dirData.address_1 || dirData.calle || "No especificada").trim();
        shippingCity = (dirData.comuna || dirData.ciudad || dirData.city || "Santiago").trim();
        
        const complementParts = [
          dirData.departamento || dirData.depto || dirData.address_2 || dirData.complemento,
          dirData.region || dirData.state,
          payload.notas || payload.notes
        ].filter(Boolean);

        shippingComplement = complementParts.join(" | ");
      }

      // 5. Documento tributario (Boleta o Factura)
      const doc = payload.documento || payload.invoice || {};
      const docTipo = String(doc.tipo || doc.type || (doc.rut ? "factura" : "boleta")).toUpperCase();
      let docText = `[DOC: ${docTipo}]`;
      if (doc.rut) docText += ` RUT: ${doc.rut}`;
      if (doc.razon_social) docText += ` Razón: ${doc.razon_social}`;
      if (doc.giro) docText += ` Giro: ${doc.giro}`;

      if (docText) {
        shippingComplement = shippingComplement ? `${shippingComplement} // ${docText}` : docText;
      }

      // 6. Consolidar ítems y totales
      const itemNames: string[] = [];
      const itemQuantities: Record<string, number> = {};
      let calculatedTotal = 0;

      for (const item of rawItems) {
        const skuClean = String(item.sku).trim();
        const qty = Number(item.cantidad ?? item.quantity ?? 1);
        const price = Number(item.precio_unitario ?? item.precio ?? item.price ?? 0);

        itemQuantities[skuClean] = (itemQuantities[skuClean] || 0) + qty;
        calculatedTotal += price * qty;

        const itemName = item.nombre || item.name || `Producto ${skuClean}`;
        if (!itemNames.includes(itemName)) {
          itemNames.push(itemName);
        }
      }

      const flatSku = Object.keys(itemQuantities).join(", ");
      const flatItemName = itemNames.join(", ");
      const flatQuantity = Object.values(itemQuantities).reduce((sum, q) => sum + q, 0);
      const finalTotalValue = Number(payload.total ?? payload.total_value ?? calculatedTotal);

      // 7. Insertar orden en public.orders
      const orderInsertData: Record<string, any> = {
        merchant_id: merchantId,
        comercio: comercio,
        external_order_number: numeroPedido,
        external_platform: "Floractive API",
        payment_status: "PAID",
        total_value: finalTotalValue,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        shipping_address: shippingAddress,
        shipping_city: shippingCity,
        shipping_complement: shippingComplement,
        shipping_method: isPickup ? "Retiro en Bodega" : (dirData.courier_preferido || "Despacho a Domicilio"),
        origen: "Floractive API",
        item: flatItemName,
        cantidad: flatQuantity,
        sku: flatSku,
        status: "para procesar",
        estado_wms: "En procesamiento",
        categoria_entrega: isPickup ? "RETIRO" : "DISTRIBUCIÓN",
        raw_shopify_data: payload // Guarda copia del payload completo para trazabilidad
      };

      const { data: newOrder, error: insErr } = await supabase
        .from("orders")
        .insert([orderInsertData])
        .select("id, created_at")
        .single();

      if (insErr || !newOrder) {
        console.error("❌ Error al insertar pedido en WMS:", insErr);
        return jsonResponse({
          success: false,
          error: "Database Error",
          message: `No se pudo registrar el pedido en WMS: ${insErr?.message}`
        }, 500);
      }

      console.log(`✅ [Floractive API] Nuevo pedido ${numeroPedido} registrado con ID: ${newOrder.id}`);

      // 8. Insertar ítems en order_items y asegurar productos
      // Nota: Al insertar en order_items, el trigger de Supabase incrementa automáticamente committed_quantity
      for (const [sku, qty] of Object.entries(itemQuantities)) {
        let { data: product } = await supabase
          .from("products")
          .select("id")
          .eq("sku", sku)
          .eq("comercio", comercio)
          .maybeSingle();

        if (!product) {
          // Si el SKU no está registrado aún en WMS, lo creamos
          const itemDetail = rawItems.find((it: any) => String(it.sku).trim() === sku);
          const productName = itemDetail?.nombre || itemDetail?.name || `Producto Floractive ${sku}`;
          const productPrice = Number(itemDetail?.precio_unitario ?? itemDetail?.precio ?? itemDetail?.price ?? 0);

          const { data: newProd, error: prodErr } = await supabase
            .from("products")
            .insert([{
              merchant_id: merchantId,
              comercio: comercio,
              sku: sku,
              name: productName,
              price: productPrice
            }])
            .select("id")
            .single();

          if (prodErr || !newProd) {
            console.error(`⚠️ Error creando producto ${sku}:`, prodErr);
          } else {
            product = newProd;
          }
        }

        if (product) {
          const { error: itemErr } = await supabase
            .from("order_items")
            .insert([{
              order_id: newOrder.id,
              product_id: product.id,
              warehouse_id: DEFAULT_WAREHOUSE_ID,
              quantity: qty
            }]);

          if (itemErr) {
            console.error(`⚠️ Error insertando order_item para SKU ${sku}:`, itemErr);
          }
        }
      }

      // 9. Respuesta exitosa
      return jsonResponse({
        success: true,
        message: "Pedido recibido exitosamente en WMS Stocka",
        order_id: newOrder.id,
        numero_pedido: numeroPedido,
        estado: "recibido",
        estado_wms: "En procesamiento",
        fecha_creacion: newOrder.created_at
      }, 201);
    }

    // -------------------------------------------------------------------------
    // RUTA: POST /webhook-test (Probar entrega de Webhooks hacia Floractive)
    // -------------------------------------------------------------------------
    if (req.method === "POST" && path === "webhook-test") {
      if (!clientAuth.webhook_url) {
        return jsonResponse({
          success: false,
          error: "Webhook Not Configured",
          message: "No tienes una URL de webhook configurada en Stocka."
        }, 400);
      }

      const testPayload = {
        event: "test.ping",
        message: "Ping de prueba desde WMS Stocka",
        timestamp: new Date().toISOString()
      };

      const payloadText = JSON.stringify(testPayload);
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };

      if (clientAuth.webhook_secret) {
        headers["x-stocka-signature"] = await generateHmacSignature(clientAuth.webhook_secret, payloadText);
      }

      try {
        const destRes = await fetch(clientAuth.webhook_url, {
          method: "POST",
          headers,
          body: payloadText
        });

        return jsonResponse({
          success: true,
          webhook_url: clientAuth.webhook_url,
          response_status: destRes.status,
          response_status_text: destRes.statusText
        });
      } catch (err: any) {
        return jsonResponse({
          success: false,
          error: "Webhook Delivery Failed",
          message: err.message
        }, 502);
      }
    }

    // Ruta no encontrada
    return jsonResponse({
      success: false,
      error: "Not Found",
      message: `Ruta '${path}' no encontrada para el método ${req.method}.`
    }, 404);

  } catch (err: any) {
    console.error("❌ Excepción no controlada en floractive-api:", err);
    return jsonResponse({
      success: false,
      error: "Internal Server Error",
      message: err.message || "Error interno al procesar la solicitud"
    }, 500);
  }
});
