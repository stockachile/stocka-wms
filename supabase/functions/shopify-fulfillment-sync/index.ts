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
    // Validar autenticación JWT o Service Role (VULN-20)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado: Falta cabecera Authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!supabaseServiceKey || token !== supabaseServiceKey.trim()) {
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) {
        return new Response(JSON.stringify({ error: "No autorizado: Token inválido o expirado" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    let body: any = {};
    if (req.method === "POST") {
      try {
        body = await req.json();
      } catch (_) {}
    }

    const specificOrderId = body.order_id || null;
    const specificQueueId = body.queue_id || null;
    const isManualRequest = body.manual === true || Boolean(specificQueueId);
    const batchLimit = Math.min(parseInt(body.limit || "20", 10), 50);

    // MODO DIRECTO: Consultar y sincronizar estado real en vivo desde Shopify para un pedido
    if (body.mode === "fetch_live_status" && specificOrderId) {
      const liveResult = await handleFetchLiveShopifyStatus(specificOrderId);
      return new Response(JSON.stringify(liveResult), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

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

        // Si el comercio tiene desactivada la sincronización inversa automática y NO fue una acción manual explícita, descartar
        if (integration.sync_tracking_enabled !== true && !isManualRequest) {
          await supabase
            .from("shopify_fulfillment_queue")
            .delete()
            .eq("id", item.id);
          results.push({ id: item.id, status: "skipped_disabled", action: item.action_type });
          continue;
        }

        // Obtener token válido (renovando si tiene refresh_token)
        const validToken = await getValidShopifyToken(integration);
        integration.access_token = validToken;

        // Comprobar scopes según el tipo de acción
        if (integration.granted_scopes && Array.isArray(integration.granted_scopes)) {
          if (item.action_type === "set_in_progress" || item.action_type === "revert_in_progress") {
            if (!integration.granted_scopes.includes("write_orders")) {
              await markQueueNeedsReauth(item.id, item.order_id, "La tienda no ha otorgado el permiso 'write_orders'. Requiere actualizar permisos en Shopify.");
              results.push({ id: item.id, status: "needs_reauth", error: "Missing write_orders scope" });
              continue;
            }
          } else {
            const hasFoScope =
              integration.granted_scopes.includes("write_fulfillments") &&
              integration.granted_scopes.includes("write_merchant_managed_fulfillment_orders");
            if (!hasFoScope) {
              await markQueueNeedsReauth(item.id, item.order_id, "La tienda requiere actualizar permisos en Shopify ('write_merchant_managed_fulfillment_orders').");
              results.push({ id: item.id, status: "needs_reauth", error: "Missing write_merchant_managed_fulfillment_orders scope" });
              continue;
            }
          }
        }

        // Ejecutar acción según action_type
        if (item.action_type === "set_in_progress") {
          await handleSetInProgress(item, integration);
          results.push({ id: item.id, status: "completed", action: "set_in_progress", shopify_order_status: "in_progress" });
        } else if (item.action_type === "set_ready_for_pickup") {
          await handleSetReadyForPickup(item, integration);
          results.push({ id: item.id, status: "completed", action: "set_ready_for_pickup", shopify_order_status: "ready_for_pickup" });
        } else if (item.action_type === "create_fulfillment") {
          const fulfillmentId = await handleCreateFulfillment(item, integration);
          results.push({ id: item.id, status: "completed", action: "create_fulfillment", fulfillment_id: fulfillmentId, shopify_order_status: "fulfilled" });
        } else if (item.action_type === "update_tracking") {
          await handleUpdateTracking(item, integration);
          results.push({ id: item.id, status: "completed", action: "update_tracking", shopify_order_status: "fulfilled" });
        } else if (item.action_type === "set_on_hold") {
          await handleSetOnHold(item, integration);
          results.push({ id: item.id, status: "completed", action: "set_on_hold", shopify_order_status: "on_hold" });
        } else if (item.action_type === "release_hold") {
          await handleReleaseHold(item, integration);
          results.push({ id: item.id, status: "completed", action: "release_hold", shopify_order_status: "unfulfilled" });
        } else if (item.action_type === "cancel_fulfillment") {
          await handleCancelFulfillment(item, integration);
          results.push({ id: item.id, status: "completed", action: "cancel_fulfillment", shopify_order_status: "unfulfilled" });
        } else if (item.action_type === "revert_in_progress") {
          await handleRevertInProgress(item, integration);
          results.push({ id: item.id, status: "completed", action: "revert_in_progress", shopify_order_status: "unfulfilled" });
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

  // 2. Actualizar estado Shopify en orders y marcar queue como completado
  await supabase
    .from("orders")
    .update({
      shopify_order_status: "in_progress",
      shopify_status_updated_at: new Date().toISOString(),
      shopify_sync_last_error: null
    })
    .eq("id", item.order_id);

  await supabase
    .from("shopify_fulfillment_queue")
    .update({
      status: "completed",
      processed_at: new Date().toISOString()
    })
    .eq("id", item.id);
}

/**
 * Marca un pedido de retiro como "Listo para retirar" (Ready for pickup) en Shopify
 * usando la mutación nativa GraphQL fulfillmentOrderLineItemsPreparedForPickup y etiqueta visual
 */
async function handleSetReadyForPickup(item: any, integration: any) {
  const shop = integration.shop_url;
  const token = integration.access_token;
  const shopifyOrderId = item.shopify_order_id;

  // 1. Obtener fulfillment_orders abiertos para marcarlos como preparados para retiro
  try {
    const foUrl = `https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}/fulfillment_orders.json`;
    const foRes = await fetch(foUrl, {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json"
      }
    });

    if (foRes.ok) {
      const foData = await foRes.json();
      const fulfillmentOrders = foData.fulfillment_orders || [];
      const openFulfillmentOrders = fulfillmentOrders.filter((fo: any) =>
        fo.status === "open" || fo.status === "in_progress"
      );

      if (openFulfillmentOrders.length > 0) {
        const lineItemsByFulfillmentOrder = openFulfillmentOrders.map((fo: any) => ({
          fulfillmentOrderId: `gid://shopify/FulfillmentOrder/${fo.id}`
        }));

        const graphqlQuery = `
          mutation fulfillmentOrderLineItemsPreparedForPickup($input: FulfillmentOrderLineItemsPreparedForPickupInput!) {
            fulfillmentOrderLineItemsPreparedForPickup(input: $input) {
              userErrors {
                field
                message
              }
            }
          }
        `;

        const gqlRes = await fetch(`https://${shop}/admin/api/2024-04/graphql.json`, {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": token,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            query: graphqlQuery,
            variables: {
              input: {
                lineItemsByFulfillmentOrder
              }
            }
          })
        });

        if (gqlRes.ok) {
          const gqlData = await gqlRes.json();
          const userErrors = gqlData?.data?.fulfillmentOrderLineItemsPreparedForPickup?.userErrors || [];
          if (userErrors.length > 0) {
            console.warn(`[ReadyForPickup] Aviso GraphQL en orden ${shopifyOrderId} (posible retiro configurado como tarifa de envío estándar):`, JSON.stringify(userErrors));
          } else {
            console.log(`✅ [ReadyForPickup] Orden ${shopifyOrderId} marcada nativamente como 'Listo para retirar' en Shopify.`);
          }
        }
      }
    }
  } catch (foErr) {
    console.warn(`Aviso al ejecutar fulfillmentOrderLineItemsPreparedForPickup en orden ${shopifyOrderId}:`, foErr);
  }

  // 2. Agregar etiqueta visual "Stocka: Listo para Retiro" en la orden de Shopify
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
      if (!currentTags.includes("Stocka: Listo para Retiro")) {
        const newTags = currentTags ? `${currentTags}, Stocka: Listo para Retiro` : "Stocka: Listo para Retiro";
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
    console.warn(`Aviso al actualizar tags de retiro en orden ${shopifyOrderId}:`, tagErr);
  }

  // 3. Actualizar estado Shopify en orders y marcar queue como completado
  await supabase
    .from("orders")
    .update({
      shopify_order_status: "ready_for_pickup",
      shopify_status_updated_at: new Date().toISOString(),
      shopify_sync_last_error: null
    })
    .eq("id", item.order_id);

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

  // Si algún fulfillment_order está en 'on_hold', liberarlo primero para poder crear el fulfillment
  const onHoldOrders = fulfillmentOrders.filter((fo: any) => fo.status === "on_hold");
  if (onHoldOrders.length > 0) {
    for (const holdFo of onHoldOrders) {
      try {
        const releaseMutation = `
          mutation fulfillmentOrderReleaseHold($id: ID!) {
            fulfillmentOrderReleaseHold(id: $id) {
              fulfillmentOrder { id status }
              userErrors { field message }
            }
          }
        `;
        await fetch(`https://${shop}/admin/api/2024-04/graphql.json`, {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": token,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            query: releaseMutation,
            variables: { id: `gid://shopify/FulfillmentOrder/${holdFo.id}` }
          })
        });
        holdFo.status = "open";
      } catch (relErr) {
        console.warn(`Aviso liberando hold previo a fulfillment en FO ${holdFo.id}:`, relErr);
      }
    }
  }

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
        shopify_order_status: "fulfilled",
        shopify_status_updated_at: new Date().toISOString(),
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

  // 3. Mapear Courier y Tracking Info (omitir tracking_info si es pedido de retiro sin tracking)
  const notifyCustomer = typeof item.notify_customer === "boolean"
    ? item.notify_customer
    : (integration.notify_customer_on_fulfillment !== false);
  const cleanTrack = (item.tracking_number || "").trim();
  const hasRealTracking = cleanTrack !== "" && cleanTrack.toUpperCase() !== "N/A" && cleanTrack.toUpperCase() !== "NO INFORMADO";
  const hasTrackUrl = Boolean(item.tracking_url && item.tracking_url.startsWith("http"));

  const fulfillmentObj: any = {
    line_items_by_fulfillment_order: lineItemsByFulfillmentOrder,
    notify_customer: notifyCustomer
  };

  if (hasRealTracking || hasTrackUrl) {
    const companyName = mapCourierToShopify(item.courier, item.operador);
    const trackingInfo: any = {
      number: hasRealTracking ? cleanTrack : "N/A",
      company: companyName
    };
    if (hasTrackUrl) {
      trackingInfo.url = item.tracking_url;
    }
    fulfillmentObj.tracking_info = trackingInfo;
  }

  const fulfillmentPayload = {
    fulfillment: fulfillmentObj
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
      shopify_order_status: "fulfilled",
      shopify_status_updated_at: new Date().toISOString(),
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
  let fulfillmentId = item.shopify_fulfillment_id;

  if (!fulfillmentId) {
    const { data: ordData } = await supabase
      .from("orders")
      .select("shopify_fulfillment_id, tracking_number, tracking_url, courier, operador")
      .eq("id", item.order_id)
      .maybeSingle();
    if (ordData?.shopify_fulfillment_id) {
      fulfillmentId = ordData.shopify_fulfillment_id;
    }
    if (ordData) {
      if (!item.tracking_number && ordData.tracking_number) item.tracking_number = ordData.tracking_number;
      if (!item.tracking_url && ordData.tracking_url) item.tracking_url = ordData.tracking_url;
      if (!item.courier && ordData.courier) item.courier = ordData.courier;
      if (!item.operador && ordData.operador) item.operador = ordData.operador;
    }
  }

  if (!fulfillmentId) {
    // Si aún no existe fulfillment_id, delegar a handleCreateFulfillment (que lo crea o recupera)
    await handleCreateFulfillment(item, integration);
    return;
  }

  const companyName = mapCourierToShopify(item.courier, item.operador);
  const notifyCustomer = typeof item.notify_customer === "boolean"
    ? item.notify_customer
    : (integration.notify_customer_on_fulfillment !== false);

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
    .from("orders")
    .update({
      shopify_fulfillment_id: fulfillmentId,
      shopify_fulfillment_status: "synced",
      shopify_order_status: "fulfilled",
      shopify_status_updated_at: new Date().toISOString(),
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

  console.log(`Tracking actualizado con éxito en Shopify para fulfillment ${fulfillmentId}`);
}

/**
 * Pone la orden de fulfillment en espera (ON_HOLD) en Shopify mediante GraphQL
 */
async function handleSetOnHold(item: any, integration: any) {
  const shop = integration.shop_url;
  const token = integration.access_token;
  const shopifyOrderId = item.shopify_order_id;
  const holdReason = item.hold_reason || "OTHER";
  const holdNotes = item.hold_notes || "Retenido en espera desde Stocka WMS";

  const foUrl = `https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}/fulfillment_orders.json`;
  const foRes = await fetch(foUrl, {
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" }
  });

  if (!foRes.ok) {
    const errText = await foRes.text();
    throw new Error(`Shopify API error fetching fulfillment_orders (${foRes.status}): ${errText}`);
  }

  const foData = await foRes.json();
  const fulfillmentOrders = foData.fulfillment_orders || [];
  const targetFos = fulfillmentOrders.filter((fo: any) => fo.status === "open" || fo.status === "in_progress");

  if (targetFos.length === 0) {
    const alreadyHold = fulfillmentOrders.find((fo: any) => fo.status === "on_hold");
    if (!alreadyHold) {
      throw new Error(`No hay fulfillment_orders abiertos para poner en espera en la orden ${shopifyOrderId}`);
    }
  } else {
    const holdMutation = `
      mutation fulfillmentOrderHold($fulfillmentHold: FulfillmentOrderHoldInput!, $id: ID!) {
        fulfillmentOrderHold(fulfillmentHold: $fulfillmentHold, id: $id) {
          fulfillmentOrder { id status }
          userErrors { field message }
        }
      }
    `;

    for (const fo of targetFos) {
      const gqlRes = await fetch(`https://${shop}/admin/api/2024-04/graphql.json`, {
        method: "POST",
        headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify({
          query: holdMutation,
          variables: {
            id: `gid://shopify/FulfillmentOrder/${fo.id}`,
            fulfillmentHold: {
              reason: holdReason,
              reasonNotes: holdNotes
            }
          }
        })
      });

      if (gqlRes.ok) {
        const gqlData = await gqlRes.json();
        const userErrors = gqlData?.data?.fulfillmentOrderHold?.userErrors || [];
        if (userErrors.length > 0) {
          throw new Error(`Shopify GraphQL error en fulfillmentOrderHold: ${JSON.stringify(userErrors)}`);
        }
      }
    }
  }

  // Añadir tag visual 'Stocka: En Espera'
  try {
    const orderRes = await fetch(`https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}.json?fields=id,tags`, {
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" }
    });
    if (orderRes.ok) {
      const orderData = await orderRes.json();
      const currentTags = orderData.order?.tags || "";
      if (!currentTags.includes("Stocka: En Espera")) {
        const newTags = currentTags ? `${currentTags}, Stocka: En Espera` : "Stocka: En Espera";
        await fetch(`https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}.json`, {
          method: "PUT",
          headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
          body: JSON.stringify({ order: { id: shopifyOrderId, tags: newTags } })
        });
      }
    }
  } catch (_) {}

  await supabase.from("orders").update({
    shopify_order_status: "on_hold",
    shopify_status_updated_at: new Date().toISOString(),
    shopify_sync_last_error: null
  }).eq("id", item.order_id);

  await supabase.from("shopify_fulfillment_queue").update({
    status: "completed",
    processed_at: new Date().toISOString()
  }).eq("id", item.id);
}

/**
 * Libera una orden que estaba en espera (ON_HOLD) en Shopify y la devuelve a No preparado
 */
async function handleReleaseHold(item: any, integration: any) {
  const shop = integration.shop_url;
  const token = integration.access_token;
  const shopifyOrderId = item.shopify_order_id;

  const foUrl = `https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}/fulfillment_orders.json`;
  const foRes = await fetch(foUrl, {
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" }
  });

  if (!foRes.ok) {
    const errText = await foRes.text();
    throw new Error(`Shopify API error fetching fulfillment_orders (${foRes.status}): ${errText}`);
  }

  const foData = await foRes.json();
  const fulfillmentOrders = foData.fulfillment_orders || [];
  const holdFos = fulfillmentOrders.filter((fo: any) => fo.status === "on_hold");

  const releaseMutation = `
    mutation fulfillmentOrderReleaseHold($id: ID!) {
      fulfillmentOrderReleaseHold(id: $id) {
        fulfillmentOrder { id status }
        userErrors { field message }
      }
    }
  `;

  for (const fo of holdFos) {
    const gqlRes = await fetch(`https://${shop}/admin/api/2024-04/graphql.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: releaseMutation,
        variables: { id: `gid://shopify/FulfillmentOrder/${fo.id}` }
      })
    });
    if (gqlRes.ok) {
      const gqlData = await gqlRes.json();
      const userErrors = gqlData?.data?.fulfillmentOrderReleaseHold?.userErrors || [];
      if (userErrors.length > 0) {
        throw new Error(`Shopify GraphQL error en fulfillmentOrderReleaseHold: ${JSON.stringify(userErrors)}`);
      }
    }
  }

  // Quitar tag 'Stocka: En Espera'
  try {
    const orderRes = await fetch(`https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}.json?fields=id,tags`, {
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" }
    });
    if (orderRes.ok) {
      const orderData = await orderRes.json();
      const currentTags = String(orderData.order?.tags || "");
      const cleanedTags = currentTags
        .split(",")
        .map((t: string) => t.trim())
        .filter((t: string) => t && t !== "Stocka: En Espera")
        .join(", ");
      await fetch(`https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}.json`, {
        method: "PUT",
        headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ order: { id: shopifyOrderId, tags: cleanedTags } })
      });
    }
  } catch (_) {}

  await supabase.from("orders").update({
    shopify_order_status: "unfulfilled",
    shopify_status_updated_at: new Date().toISOString(),
    shopify_sync_last_error: null
  }).eq("id", item.order_id);

  await supabase.from("shopify_fulfillment_queue").update({
    status: "completed",
    processed_at: new Date().toISOString()
  }).eq("id", item.id);
}

/**
 * Cancela un Fulfillment activo en Shopify para revertir el pedido de "Preparado" a "No preparado"
 */
async function handleCancelFulfillment(item: any, integration: any) {
  const shop = integration.shop_url;
  const token = integration.access_token;
  const shopifyOrderId = item.shopify_order_id;
  let fulfillmentId = item.shopify_fulfillment_id;

  if (!fulfillmentId) {
    const { data: ordData } = await supabase
      .from("orders")
      .select("shopify_fulfillment_id")
      .eq("id", item.order_id)
      .maybeSingle();
    if (ordData?.shopify_fulfillment_id) {
      fulfillmentId = ordData.shopify_fulfillment_id;
    }
  }

  if (!fulfillmentId) {
    // Consultar fulfillments activos directamente en la orden de Shopify
    const ordRes = await fetch(`https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}.json?fields=id,fulfillments`, {
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" }
    });
    if (ordRes.ok) {
      const ordJson = await ordRes.json();
      const activeFulfillments = (ordJson.order?.fulfillments || []).filter((f: any) => f.status !== "cancelled");
      if (activeFulfillments.length > 0) {
        fulfillmentId = String(activeFulfillments[0].id);
      }
    }
  }

  if (fulfillmentId) {
    const cancelRes = await fetch(`https://${shop}/admin/api/2024-04/fulfillments/${fulfillmentId}/cancel.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({})
    });

    if (!cancelRes.ok) {
      const errText = await cancelRes.text();
      throw new Error(`Shopify API error cancelando fulfillment ${fulfillmentId} (${cancelRes.status}): ${errText}`);
    }
  }

  // Limpiar tags de Stocka en la orden
  try {
    const orderRes = await fetch(`https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}.json?fields=id,tags`, {
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" }
    });
    if (orderRes.ok) {
      const orderData = await orderRes.json();
      const currentTags = String(orderData.order?.tags || "");
      const cleanedTags = currentTags
        .split(",")
        .map((t: string) => t.trim())
        .filter((t: string) => t && !["Stocka: En Preparación", "Stocka: Listo para Retiro", "Stocka: En Espera"].includes(t))
        .join(", ");
      await fetch(`https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}.json`, {
        method: "PUT",
        headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ order: { id: shopifyOrderId, tags: cleanedTags } })
      });
    }
  } catch (_) {}

  await supabase.from("orders").update({
    shopify_fulfillment_id: null,
    shopify_fulfillment_status: null,
    shopify_order_status: "unfulfilled",
    shopify_status_updated_at: new Date().toISOString(),
    shopify_sync_last_error: null
  }).eq("id", item.order_id);

  await supabase.from("shopify_fulfillment_queue").update({
    status: "completed",
    processed_at: new Date().toISOString()
  }).eq("id", item.id);
}

/**
 * Revierte un pedido que estaba en "En curso" o "Listo para retirar" de vuelta a "No preparado"
 */
async function handleRevertInProgress(item: any, integration: any) {
  const shop = integration.shop_url;
  const token = integration.access_token;
  const shopifyOrderId = item.shopify_order_id;

  try {
    const orderRes = await fetch(`https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}.json?fields=id,tags`, {
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" }
    });
    if (orderRes.ok) {
      const orderData = await orderRes.json();
      const currentTags = String(orderData.order?.tags || "");
      const cleanedTags = currentTags
        .split(",")
        .map((t: string) => t.trim())
        .filter((t: string) => t && !["Stocka: En Preparación", "Stocka: Listo para Retiro", "Stocka: En Espera"].includes(t))
        .join(", ");
      await fetch(`https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}.json`, {
        method: "PUT",
        headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ order: { id: shopifyOrderId, tags: cleanedTags } })
      });
    }
  } catch (err) {
    console.warn("Aviso limpiando tags en handleRevertInProgress:", err);
  }

  await supabase.from("orders").update({
    shopify_order_status: "unfulfilled",
    shopify_status_updated_at: new Date().toISOString(),
    shopify_sync_last_error: null
  }).eq("id", item.order_id);

  await supabase.from("shopify_fulfillment_queue").update({
    status: "completed",
    processed_at: new Date().toISOString()
  }).eq("id", item.id);
}

/**
 * Consulta en vivo en Shopify el estado real del pedido y sus FulfillmentOrders y actualiza la tabla orders
 */
async function handleFetchLiveShopifyStatus(orderId: string) {
  const { data: ord, error: ordErr } = await supabase
    .from("orders")
    .select("id, comercio, raw_shopify_data, shopify_order_status, shopify_fulfillment_id, shopify_fulfillment_order_id")
    .eq("id", orderId)
    .single();

  if (ordErr || !ord) {
    throw new Error("No se encontró el pedido en el WMS.");
  }

  const shopifyOrderId = ord.raw_shopify_data?.id ? String(ord.raw_shopify_data.id) : null;
  if (!shopifyOrderId) {
    throw new Error("El pedido no posee un ID de orden de Shopify en raw_shopify_data.");
  }

  const { data: integration } = await supabase
    .from("merchant_integrations")
    .select("*")
    .eq("platform", "Shopify")
    .eq("comercio", ord.comercio)
    .eq("is_active", true)
    .maybeSingle();

  if (!integration) {
    throw new Error(`No hay integración activa de Shopify para ${ord.comercio}.`);
  }

  const token = await getValidShopifyToken(integration);
  const shop = integration.shop_url;
  const scopes = Array.isArray(integration.granted_scopes) ? integration.granted_scopes : [];
  const hasFoScope = scopes.includes("write_fulfillments") && scopes.includes("write_merchant_managed_fulfillment_orders");

  // 1. Consultar la orden en Shopify
  const ordRes = await fetch(`https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}.json?fields=id,name,fulfillment_status,cancelled_at,tags,fulfillments`, {
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" }
  });

  if (!ordRes.ok) {
    const errTxt = await ordRes.text();
    throw new Error(`Error consultando orden en Shopify (${ordRes.status}): ${errTxt}`);
  }

  const ordJson = await ordRes.json();
  const shopifyOrder = ordJson.order || {};
  const activeFulfillments = (shopifyOrder.fulfillments || []).filter((f: any) => f.status !== "cancelled");
  let resolvedFulfillmentId = activeFulfillments.length > 0 ? String(activeFulfillments[0].id) : null;
  let resolvedFoId = ord.shopify_fulfillment_order_id || null;
  let foStatuses: string[] = [];

  // 2. Consultar fulfillment_orders si tiene permisos
  if (hasFoScope) {
    try {
      const foRes = await fetch(`https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}/fulfillment_orders.json`, {
        headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" }
      });
      if (foRes.ok) {
        const foData = await foRes.json();
        const fos = foData.fulfillment_orders || [];
        foStatuses = fos.map((f: any) => String(f.status || "").toLowerCase());
        const activeFo = fos.find((f: any) => f.status === "open" || f.status === "in_progress" || f.status === "on_hold") || fos[0];
        if (activeFo) {
          resolvedFoId = String(activeFo.id);
        }
      }
    } catch (_) {}
  }

  // 3. Determinar estado exacto
  let liveStatus = "unfulfilled";
  const tags = String(shopifyOrder.tags || "");
  if (shopifyOrder.cancelled_at) {
    liveStatus = "cancelled";
  } else if (shopifyOrder.fulfillment_status === "fulfilled" || activeFulfillments.length > 0) {
    liveStatus = "fulfilled";
  } else if (shopifyOrder.fulfillment_status === "partial") {
    liveStatus = "partial";
  } else if (foStatuses.includes("on_hold") || tags.includes("Stocka: En Espera")) {
    liveStatus = "on_hold";
  } else if (tags.includes("Stocka: Listo para Retiro") || ord.shopify_order_status === "ready_for_pickup") {
    liveStatus = "ready_for_pickup";
  } else if (foStatuses.includes("in_progress") || tags.includes("Stocka: En Preparación")) {
    liveStatus = "in_progress";
  }

  const nowIso = new Date().toISOString();
  await supabase
    .from("orders")
    .update({
      shopify_order_status: liveStatus,
      shopify_fulfillment_id: resolvedFulfillmentId,
      shopify_fulfillment_order_id: resolvedFoId,
      shopify_fulfillment_status: liveStatus === "fulfilled" ? "synced" : null,
      shopify_status_updated_at: nowIso
    })
    .eq("id", ord.id);

  return {
    success: true,
    order_id: ord.id,
    shopify_order_id: shopifyOrderId,
    shopify_order_status: liveStatus,
    shopify_fulfillment_id: resolvedFulfillmentId,
    shopify_fulfillment_order_id: resolvedFoId,
    shopify_status_updated_at: nowIso,
    has_fo_scope: hasFoScope,
    tags
  };
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
  if (raw.includes("RECIBELO") || raw.includes("RECÍBELO")) return "Recíbelo";
  if (raw.includes("SAMEDAY")) return "Sameday";
  if (raw.includes("LIGHTDATA") || raw.includes("ALPHA")) return "LightData";
  if (raw.includes("ENVIAME") || raw.includes("ENVÍAME")) return "Envíame";
  if (raw.includes("STOCKA") || raw.includes("CARRIER EXTERNO")) return "Stocka Logistics";
  return courier && courier.trim() ? courier.trim() : "Other";
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
      console.error(`[Shopify Sync] Error renovando token: ${res.status} - ${errorText}`);
      return integration.access_token;
    }

    const data = await res.json();
    console.log(`[Shopify Sync] Token renovado con éxito para ${integration.shop_url}. Expira en ${data.expires_in}s.`);

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
    console.error("[Shopify Sync] Excepción renovando token:", err.message);
    return integration.access_token;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
