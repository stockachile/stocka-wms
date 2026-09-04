import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const shopifyClientId = Deno.env.get("SHOPIFY_CLIENT_ID") ?? "4d04c58f432c53fb870d1fbcad92431c";
const shopifyClientSecret = Deno.env.get("SHOPIFY_CLIENT_SECRET") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    let body: any = {};
    if (req.method === "POST") {
      try {
        body = await req.json();
      } catch (_) {}
    }

    const specificOrderId = body.order_id || null;
    const specificQueueId = body.queue_id || null;
    const batchLimit = Math.min(parseInt(body.limit || "20", 10), 50);

    console.log(`[Shopify Fulfillment Sync] Iniciando procesamiento (order_id: ${specificOrderId}, queue_id: ${specificQueueId}, limit: ${batchLimit})`);

    // 1. Obtener registros pendientes de la cola
    let queueQuery = supabase
      .from("shopify_fulfillment_queue")
      .select("*")
      .in("status", ["pending", "processing"])
      .order("created_at", { ascending: true })
      .limit(batchLimit);

    if (specificQueueId) {
      queueQuery = supabase
        .from("shopify_fulfillment_queue")
        .select("*")
        .eq("id", specificQueueId);
    } else if (specificOrderId) {
      queueQuery = supabase
        .from("shopify_fulfillment_queue")
        .select("*")
        .eq("order_id", specificOrderId)
        .in("status", ["pending", "processing"]);
    }

    const { data: queueItems, error: queueErr } = await queueQuery;

    if (queueErr) {
      console.error("Error al consultar cola:", queueErr);
      return new Response(JSON.stringify({ error: queueErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (!queueItems || queueItems.length === 0) {
      return new Response(JSON.stringify({ message: "No pending items in queue", processed: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const results = [];

    // Cache local de integraciones para no re-consultar la misma tienda en el mismo lote
    const integrationCache = new Map<string, any>();

    for (const item of queueItems) {
      // Marcar item como 'processing' e incrementar contador de intentos
      await supabase
        .from("shopify_fulfillment_queue")
        .update({
          status: "processing",
          attempts: (item.attempts || 0) + 1,
          updated_at: new Date().toISOString()
        })
        .eq("id", item.id);

      try {
        // Cargar o recuperar de cache la integración de la tienda
        let integration = integrationCache.get(item.comercio);
        if (!integration) {
          const { data: intData } = await supabase
            .from("merchant_integrations")
            .select("*")
            .eq("platform", "Shopify")
            .eq("comercio", item.comercio)
            .eq("is_active", true)
            .maybeSingle();

          if (intData) {
            integration = intData;
            integrationCache.set(item.comercio, intData);
          }
        }

        if (!integration) {
          throw new Error(`Integración activa no encontrada para el comercio ${item.comercio}`);
        }

        // Obtener token válido (renovando si tiene refresh_token)
        const validToken = await getValidShopifyToken(integration);
        integration.access_token = validToken;

        // Comprobar scopes si están registrados
        if (integration.granted_scopes && Array.isArray(integration.granted_scopes)) {
          if (!integration.granted_scopes.includes("write_fulfillments")) {
            await markQueueNeedsReauth(item.id, item.order_id, "La tienda no ha otorgado el permiso 'write_fulfillments'. Requiere re-autorización.");
            results.push({ id: item.id, status: "needs_reauth", error: "Missing write_fulfillments scope" });
            continue;
          }
        }

        // Ejecutar acción según action_type
        if (item.action_type === "set_in_progress") {
          await handleSetInProgress(item, integration);
          results.push({ id: item.id, status: "completed", action: "set_in_progress" });
        } else if (item.action_type === "create_fulfillment") {
          const fulfillmentId = await handleCreateFulfillment(item, integration);
          results.push({ id: item.id, status: "completed", action: "create_fulfillment", fulfillment_id: fulfillmentId });
        } else if (item.action_type === "update_tracking") {
          await handleUpdateTracking(item, integration);
          results.push({ id: item.id, status: "completed", action: "update_tracking" });
        }

        // Delay de cortesía de 300ms entre llamadas para respetar Rate Limits de Shopify (2 req/s)
        await delay(300);

      } catch (err: any) {
        console.error(`Error procesando item ${item.id} (Orden: ${item.order_id}):`, err.message);

        const isForbidden = err.message.includes("403") || err.message.includes("scope");
        const newStatus = isForbidden 
          ? "needs_reauth" 
          : (item.attempts + 1 >= (item.max_attempts || 5) ? "failed" : "pending");

        await supabase
          .from("shopify_fulfillment_queue")
          .update({
            status: newStatus,
            last_error: err.message,
            updated_at: new Date().toISOString()
          })
          .eq("id", item.id);

        await supabase
          .from("orders")
          .update({
            shopify_fulfillment_status: "error",
            shopify_sync_last_error: err.message
          })
          .eq("id", item.order_id);

        results.push({ id: item.id, status: newStatus, error: err.message });
      }
    }

    return new Response(JSON.stringify({ success: true, processed: results.length, results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (globalErr: any) {
    console.error("Error global en shopify-fulfillment-sync:", globalErr);
    return new Response(JSON.stringify({ error: globalErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});


// =============================================================================
// LOGICA DE ACCIONES DE SHOPIFY (FULFILLMENT ORDERS API)
// =============================================================================

/**
 * Pasa la orden a estado "En curso" y agrega tag interno a la orden en Shopify
 */
async function handleSetInProgress(item: any, integration: any) {
  const shop = integration.shop_url;
  const token = integration.access_token;
  const shopifyOrderId = item.shopify_order_id;

  // 1. Obtener tags actuales de la orden para añadir etiqueta visual
  try {
    const orderRes = await fetch(`https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}.json?fields=id,tags`, {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json"
      }
    });

    if (orderRes.ok) {
      const orderData = await orderRes.json();
      const currentTags = orderData.order?.tags || "";
      if (!currentTags.includes("Stocka: En Preparación")) {
        const newTags = currentTags ? `${currentTags}, Stocka: En Preparación` : "Stocka: En Preparación";
        await fetch(`https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}.json`, {
          method: "PUT",
          headers: {
            "X-Shopify-Access-Token": token,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            order: {
              id: shopifyOrderId,
              tags: newTags
            }
          })
        });
      }
    }
  } catch (tagErr) {
    console.warn(`Aviso al actualizar tags en orden ${shopifyOrderId}:`, tagErr);
  }

  // 2. Marcar queue como completado
  await supabase
    .from("shopify_fulfillment_queue")
    .update({
      status: "completed",
      processed_at: new Date().toISOString()
    })
    .eq("id", item.id);
}

/**
 * Crea el fulfillment en Shopify con número de seguimiento y link
 */
async function handleCreateFulfillment(item: any, integration: any): Promise<string> {
  const shop = integration.shop_url;
  const token = integration.access_token;
  const shopifyOrderId = item.shopify_order_id;

  // 1. Consultar fulfillment orders asociados al pedido
  const foUrl = `https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}/fulfillment_orders.json`;
  const foRes = await fetch(foUrl, {
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json"
    }
  });

  if (!foRes.ok) {
    const errText = await foRes.text();
    throw new Error(`Shopify API error fetching fulfillment_orders (${foRes.status}): ${errText}`);
  }

  const foData = await foRes.json();
  const fulfillmentOrders = foData.fulfillment_orders || [];

  // Filtrar fulfillment orders abiertos o en progreso
  const openFulfillmentOrders = fulfillmentOrders.filter((fo: any) => 
    fo.status === "open" || fo.status === "in_progress"
  );

  // Si ya no hay órdenes de fulfillment abiertas, verificar si ya fue completado
  if (openFulfillmentOrders.length === 0) {
    const closedFo = fulfillmentOrders.find((fo: any) => fo.status === "closed" && fo.fulfillments && fo.fulfillments.length > 0);
    if (closedFo && closedFo.fulfillments && closedFo.fulfillments.length > 0) {
      const existingFulfillmentId = closedFo.fulfillments[0].id.toString();
      console.log(`La orden ${shopifyOrderId} ya fue cumplida previamente con fulfillment ID ${existingFulfillmentId}`);
      
      await supabase.from("orders").update({
        shopify_fulfillment_id: existingFulfillmentId,
        shopify_fulfillment_status: "synced",
        shopify_sync_last_error: null
      }).eq("id", item.order_id);

      await supabase.from("shopify_fulfillment_queue").update({
        status: "completed",
        shopify_fulfillment_id: existingFulfillmentId,
        processed_at: new Date().toISOString()
      }).eq("id", item.id);

      return existingFulfillmentId;
    }

    throw new Error(`No se encontraron fulfillment_orders en estado abierto o en progreso para el pedido ${shopifyOrderId}`);
  }

  // 2. Construir desglose de fulfillment orders
  const lineItemsByFulfillmentOrder = openFulfillmentOrders.map((fo: any) => ({
    fulfillment_order_id: fo.id
  }));

  // 3. Mapear Courier y Tracking Info
  const companyName = mapCourierToShopify(item.courier, item.operador);
  const notifyCustomer = integration.notify_customer_on_fulfillment !== false;

  const trackingInfo: any = {
    number: item.tracking_number || "N/A",
    company: companyName
  };

  if (item.tracking_url && item.tracking_url.startsWith("http")) {
    trackingInfo.url = item.tracking_url;
  }

  const fulfillmentPayload = {
    fulfillment: {
      line_items_by_fulfillment_order: lineItemsByFulfillmentOrder,
      tracking_info: trackingInfo,
      notify_customer: notifyCustomer
    }
  };

  console.log(`Enviando fulfillment a Shopify para orden ${shopifyOrderId}:`, JSON.stringify(fulfillmentPayload));

  // 4. Crear Fulfillment en Shopify
  const createRes = await fetch(`https://${shop}/admin/api/2024-04/fulfillments.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(fulfillmentPayload)
  });

  if (!createRes.ok) {
    const createErrText = await createRes.text();
    throw new Error(`Shopify API error creando fulfillment (${createRes.status}): ${createErrText}`);
  }

  const createData = await createRes.json();
  const createdFulfillment = createData.fulfillment;
  const fulfillmentId = (createdFulfillment?.id || "").toString();

  // 5. Actualizar orden en WMS y registro de cola
  await supabase
    .from("orders")
    .update({
      shopify_fulfillment_id: fulfillmentId,
      shopify_fulfillment_status: "synced",
      shopify_sync_last_error: null
    })
    .eq("id", item.order_id);

  await supabase
    .from("shopify_fulfillment_queue")
    .update({
      status: "completed",
      shopify_fulfillment_id: fulfillmentId,
      processed_at: new Date().toISOString()
    })
    .eq("id", item.id);

  console.log(`Fulfillment creado exitosamente en Shopify con ID ${fulfillmentId} para orden ${shopifyOrderId}`);
  return fulfillmentId;
}

/**
 * Actualiza el tracking de un fulfillment ya existente en Shopify
 */
async function handleUpdateTracking(item: any, integration: any) {
  const shop = integration.shop_url;
  const token = integration.access_token;
  const fulfillmentId = item.shopify_fulfillment_id;

  if (!fulfillmentId) {
    throw new Error(`No se puede actualizar tracking: falta shopify_fulfillment_id para item ${item.id}`);
  }

  const companyName = mapCourierToShopify(item.courier, item.operador);
  const notifyCustomer = integration.notify_customer_on_fulfillment !== false;

  const trackingInfo: any = {
    number: item.tracking_number || "N/A",
    company: companyName
  };

  if (item.tracking_url && item.tracking_url.startsWith("http")) {
    trackingInfo.url = item.tracking_url;
  }

  const updatePayload = {
    fulfillment: {
      tracking_info: trackingInfo,
      notify_customer: notifyCustomer
    }
  };

  const updateRes = await fetch(`https://${shop}/admin/api/2024-04/fulfillments/${fulfillmentId}/update_tracking.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(updatePayload)
  });

  if (!updateRes.ok) {
    const errText = await updateRes.text();
    throw new Error(`Shopify API error actualizando tracking (${updateRes.status}): ${errText}`);
  }

  await supabase
    .from("shopify_fulfillment_queue")
    .update({
      status: "completed",
      processed_at: new Date().toISOString()
    })
    .eq("id", item.id);

  console.log(`Tracking actualizado con éxito en Shopify para fulfillment ${fulfillmentId}`);
}


// =============================================================================
// FUNCIONES AUXILIARES
// =============================================================================

function mapCourierToShopify(courier: string, operador: string): string {
  const raw = `${courier || ""} ${operador || ""}`.toUpperCase();
  if (raw.includes("CHILEXPRESS")) return "Chilexpress";
  if (raw.includes("STARKEN")) return "Starken";
  if (raw.includes("BLUEXPRESS") || raw.includes("BLUE EXPRESS") || raw.includes("BLUE")) return "Blue Express";
  if (raw.includes("CORREOS")) return "Correos de Chile";
  if (raw.includes("LIGHTDATA") || raw.includes("ALPHA")) return "LightData";
  if (raw.includes("ENVIAME") || raw.includes("ENVÍAME")) return "Envíame";
  if (raw.includes("STOCKA")) return "Stocka Logistics";
  return "Other";
}

async function markQueueNeedsReauth(queueId: string, orderId: string, reason: string) {
  await supabase
    .from("shopify_fulfillment_queue")
    .update({
      status: "needs_reauth",
      last_error: reason,
      updated_at: new Date().toISOString()
    })
    .eq("id", queueId);

  await supabase
    .from("orders")
    .update({
      shopify_fulfillment_status: "error",
      shopify_sync_last_error: reason
    })
    .eq("id", orderId);
}

async function getValidShopifyToken(integration: any): Promise<string> {
  if (!integration.refresh_token) {
    return integration.access_token;
  }

  const clientSecret = shopifyClientSecret || integration.webhook_secret;
  if (!clientSecret) {
    return integration.access_token;
  }

  const tokenUrl = `https://${integration.shop_url}/admin/oauth/access_token`;
  try {
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: shopifyClientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: integration.refresh_token
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[Shopify Sync] Error renovando token: ${res.status} - ${errorText}`);
      return integration.access_token;
    }

    const data = await res.json();
    console.log(`[Shopify Sync] Token renovado con éxito para ${integration.shop_url}`);

    await supabase
      .from("merchant_integrations")
      .update({
        access_token: data.access_token,
        refresh_token: data.refresh_token
      })
      .eq("id", integration.id);

    return data.access_token;
  } catch (err: any) {
    console.error("[Shopify Sync] Excepción renovando token:", err.message);
    return integration.access_token;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
