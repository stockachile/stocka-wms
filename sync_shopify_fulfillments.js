const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// ==========================================
// CONFIGURACIÓN DE SUPABASE Y SHOPIFY
// ==========================================
const envPath = '.env';
let env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1);
      }
      env[key] = value.trim();
    }
  });
}

const SUPABASE_URL = env.SUPABASE_URL || process.env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHOPIFY_CLIENT_ID = env.SHOPIFY_CLIENT_ID || process.env.SHOPIFY_CLIENT_ID || '4d04c58f432c53fb870d1fbcad92431c';
const SHOPIFY_CLIENT_SECRET = env.SHOPIFY_CLIENT_SECRET || process.env.SHOPIFY_CLIENT_SECRET;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: La variable de entorno SUPABASE_SERVICE_ROLE_KEY no está configurada.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function shopifyFetch(url, options = {}, maxRetries = 4) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, options);
    if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
      if (attempt < maxRetries) {
        const retryAfterHeader = res.headers.get('Retry-After');
        const retryWaitMs = retryAfterHeader ? Math.ceil(parseFloat(retryAfterHeader) * 1000) : (1400 * attempt);
        console.warn(`[Shopify Rate Limit/Retry] HTTP ${res.status} en ${url}. Reintentando en ${retryWaitMs}ms (intento ${attempt}/${maxRetries})...`);
        await delay(Math.max(retryWaitMs, 1000));
        continue;
      }
    }
    return res;
  }
  return fetch(url, options);
}

function mapCourierToShopify(courier, operador) {
  const raw = `${courier || ''} ${operador || ''}`.toUpperCase();
  if (raw.includes('CHILEXPRESS')) return 'Chilexpress';
  if (raw.includes('STARKEN')) return 'Starken';
  if (raw.includes('BLUEXPRESS') || raw.includes('BLUE EXPRESS') || raw.includes('BLUE')) return 'Blue Express';
  if (raw.includes('CORREOS')) return 'Correos de Chile';
  if (raw.includes('RECIBELO') || raw.includes('RECÍBELO')) return 'Recíbelo';
  if (raw.includes('SAMEDAY')) return 'Sameday';
  if (raw.includes('LIGHTDATA') || raw.includes('ALPHA')) return 'LightData';
  if (raw.includes('ENVIAME') || raw.includes('ENVÍAME')) return 'Envíame';
  if (raw.includes('STOCKA') || raw.includes('CARRIER EXTERNO')) return 'Stocka Logistics';
  return courier && courier.trim() ? courier.trim() : 'Other';
}

const tokenCache = new Map();

async function getValidShopifyToken(integration, forceRefresh = false) {
  if (!integration.refresh_token) {
    return integration.access_token;
  }

  const shopKey = integration.shop_url;
  const cached = tokenCache.get(shopKey);
  const now = Date.now();

  if (!forceRefresh && cached && now < (cached.expiresAt - 5 * 60 * 1000)) {
    return cached.token;
  }

  const clientSecret = SHOPIFY_CLIENT_SECRET || integration.webhook_secret;
  if (!clientSecret) {
    return integration.access_token;
  }

  const tokenUrl = `https://${integration.shop_url}/admin/oauth/access_token`;
  try {
    const params = new URLSearchParams({
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: integration.refresh_token
    });

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
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
      .from('merchant_integrations')
      .update({
        access_token: data.access_token,
        refresh_token: data.refresh_token || integration.refresh_token,
        last_sync_at: new Date().toISOString()
      })
      .eq('id', integration.id);

    return data.access_token;
  } catch (err) {
    console.error('[Shopify Sync] Excepción renovando token:', err.message);
    return integration.access_token;
  }
}

async function processQueue() {
  console.log('Iniciando procesamiento de cola de fulfillments Shopify...');

  const { data: queueItems, error: qErr } = await supabase
    .from('shopify_fulfillment_queue')
    .select('*')
    .in('status', ['pending', 'processing'])
    .order('created_at', { ascending: true })
    .limit(30);

  if (qErr) {
    console.error('Error al consultar cola:', qErr.message);
    return;
  }

  if (!queueItems || queueItems.length === 0) {
    console.log('No hay elementos pendientes en la cola de Shopify.');
    return;
  }

  console.log(`Se encontraron ${queueItems.length} elementos pendientes en la cola.`);

  const integrationCache = new Map();

  for (const item of queueItems) {
    console.log(`\n--- Procesando registro cola ID ${item.id} (Comercio: ${item.comercio}, Pedido: ${item.shopify_order_id}) ---`);

    await supabase
      .from('shopify_fulfillment_queue')
      .update({
        status: 'processing',
        attempts: (item.attempts || 0) + 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', item.id);

    try {
      let integration = integrationCache.get(item.comercio);
      if (!integration) {
        const { data: intData } = await supabase
          .from('merchant_integrations')
          .select('*')
          .eq('platform', 'Shopify')
          .eq('comercio', item.comercio)
          .eq('is_active', true)
          .maybeSingle();

        if (intData) {
          integration = intData;
          integrationCache.set(item.comercio, intData);
        }
      }

      if (!integration) {
        throw new Error(`Integración activa no encontrada para ${item.comercio}`);
      }

      if (integration.sync_tracking_enabled !== true) {
        console.log(`⏭️ Comercio ${item.comercio} tiene sync_tracking_enabled = false. Descartando item ${item.id}.`);
        await supabase
          .from('shopify_fulfillment_queue')
          .delete()
          .eq('id', item.id);
        continue;
      }

      const validToken = await getValidShopifyToken(integration);
      integration.access_token = validToken;

      if (integration.granted_scopes && Array.isArray(integration.granted_scopes)) {
        if (item.action_type === 'set_in_progress') {
          if (!integration.granted_scopes.includes('write_orders')) {
            const reason = "La tienda no ha otorgado el permiso 'write_orders'. Requiere actualizar permisos en Shopify.";
            console.warn(`⚠️ ${reason}`);
            await supabase
              .from('shopify_fulfillment_queue')
              .update({ status: 'needs_reauth', last_error: reason, updated_at: new Date().toISOString() })
              .eq('id', item.id);
            continue;
          }
        } else {
          const hasFoScope =
            integration.granted_scopes.includes('write_fulfillments') &&
            integration.granted_scopes.includes('write_merchant_managed_fulfillment_orders');
          if (!hasFoScope) {
            const reason = "La tienda requiere actualizar permisos en Shopify ('write_merchant_managed_fulfillment_orders').";
            console.warn(`⚠️ ${reason}`);
            await supabase
              .from('shopify_fulfillment_queue')
              .update({ status: 'needs_reauth', last_error: reason, updated_at: new Date().toISOString() })
              .eq('id', item.id);
            await supabase
              .from('orders')
              .update({ shopify_fulfillment_status: 'error', shopify_sync_last_error: reason })
              .eq('id', item.order_id);
            continue;
          }
        }
      }

      if (item.action_type === 'set_in_progress') {
        await executeSetInProgress(item, integration);
      } else if (item.action_type === 'set_ready_for_pickup') {
        await executeSetReadyForPickup(item, integration);
      } else if (item.action_type === 'create_fulfillment') {
        await executeCreateFulfillment(item, integration);
      } else if (item.action_type === 'update_tracking') {
        await executeUpdateTracking(item, integration);
      } else if (['set_in_transit', 'set_delivered', 'set_on_hold', 'release_hold', 'cancel_fulfillment', 'revert_in_progress'].includes(item.action_type)) {
        await fetch(`${SUPABASE_URL}/functions/v1/shopify-fulfillment-sync`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
          },
          body: JSON.stringify({ queue_id: item.id, manual: true })
        });
      }

      await delay(500);

    } catch (err) {
      console.error(`❌ Error procesando cola item ${item.id}:`, err.message);

      const isForbidden = err.message.includes('403') || err.message.includes('scope');
      const newStatus = isForbidden ? 'needs_reauth' : (item.attempts + 1 >= (item.max_attempts || 5) ? 'failed' : 'pending');

      await supabase
        .from('shopify_fulfillment_queue')
        .update({
          status: newStatus,
          last_error: err.message,
          updated_at: new Date().toISOString()
        })
        .eq('id', item.id);

      await supabase
        .from('orders')
        .update({
          shopify_fulfillment_status: 'error',
          shopify_sync_last_error: err.message
        })
        .eq('id', item.order_id);
    }
  }

  console.log('\nProcesamiento de lote finalizado.');
}

async function executeSetInProgress(item, integration) {
  const shop = integration.shop_url;
  const token = integration.access_token;
  const shopifyOrderId = item.shopify_order_id;
  let alreadyFulfilled = false;

  try {
    const foUrl = `https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}/fulfillment_orders.json`;
    const foRes = await shopifyFetch(foUrl, {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }
    });

    if (foRes.ok) {
      const foData = await foRes.json();
      const fulfillmentOrders = foData.fulfillment_orders || [];
      const openFos = fulfillmentOrders.filter(fo => fo.status === 'open');

      if (openFos.length > 0) {
        const progressMutation = `
          mutation fulfillmentOrderReportProgress($id: ID!, $progressReport: FulfillmentOrderReportProgressInput) {
            fulfillmentOrderReportProgress(id: $id, progressReport: $progressReport) {
              fulfillmentOrder { id status }
              userErrors { field message }
            }
          }
        `;
        for (const fo of openFos) {
          const gqlRes = await shopifyFetch(`https://${shop}/admin/api/2026-04/graphql.json`, {
            method: 'POST',
            headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: progressMutation,
              variables: {
                id: `gid://shopify/FulfillmentOrder/${fo.id}`,
                progressReport: {
                  reasonNotes: 'Pedido en preparación en Stocka WMS'
                }
              }
            })
          });
          if (gqlRes.ok) {
            const gqlData = await gqlRes.json();
            const userErrors = gqlData?.data?.fulfillmentOrderReportProgress?.userErrors || [];
            if (userErrors.length > 0) {
              console.warn(`⚠️ [SetInProgress] Aviso GraphQL en FO ${fo.id}:`, JSON.stringify(userErrors));
            } else {
              console.log(`✅ [SetInProgress] FO ${fo.id} de orden ${shopifyOrderId} pasado nativamente a IN_PROGRESS ("En curso").`);
            }
          }
        }
      } else if (fulfillmentOrders.length > 0 && fulfillmentOrders.every(fo => fo.status === 'closed')) {
        alreadyFulfilled = true;
      }
    }
  } catch (foErr) {
    console.warn(`Aviso al reportar progreso de FulfillmentOrder en orden ${shopifyOrderId}:`, foErr.message);
  }

  if (!alreadyFulfilled) {
    try {
      const orderRes = await shopifyFetch(`https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}.json?fields=id,tags,fulfillment_status`, {
        headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }
      });

      if (orderRes.ok) {
        const orderData = await orderRes.json();
        if (orderData.order?.fulfillment_status === 'fulfilled') {
          alreadyFulfilled = true;
        } else {
          const currentTags = orderData.order?.tags || '';
          if (!currentTags.includes('Stocka: En Preparación')) {
            const newTags = currentTags ? `${currentTags}, Stocka: En Preparación` : 'Stocka: En Preparación';
            await shopifyFetch(`https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}.json`, {
              method: 'PUT',
              headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
              body: JSON.stringify({ order: { id: shopifyOrderId, tags: newTags } })
            });
            console.log(`Etiqueta 'Stocka: En Preparación' agregada a orden ${shopifyOrderId}`);
          }
        }
      }
    } catch (tagErr) {
      console.warn(`Aviso actualizando tags:`, tagErr.message);
    }
  }

  await supabase
    .from('orders')
    .update({
      shopify_order_status: alreadyFulfilled ? 'fulfilled' : 'in_progress',
      shopify_status_updated_at: new Date().toISOString(),
      shopify_sync_last_error: null
    })
    .eq('id', item.order_id);

  await supabase
    .from('shopify_fulfillment_queue')
    .update({ status: 'completed', last_error: null, processed_at: new Date().toISOString() })
    .eq('id', item.id);
}

async function executeSetReadyForPickup(item, integration) {
  const shop = integration.shop_url;
  const token = integration.access_token;
  const shopifyOrderId = item.shopify_order_id;
  let alreadyFulfilled = false;

  try {
    const foUrl = `https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}/fulfillment_orders.json`;
    const foRes = await shopifyFetch(foUrl, {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }
    });

    if (foRes.ok) {
      const foData = await foRes.json();
      const fulfillmentOrders = foData.fulfillment_orders || [];
      const openFulfillmentOrders = fulfillmentOrders.filter(fo => fo.status === 'open' || fo.status === 'in_progress');

      if (openFulfillmentOrders.length > 0) {
        const lineItemsByFulfillmentOrder = openFulfillmentOrders.map(fo => ({
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

        const gqlRes = await shopifyFetch(`https://${shop}/admin/api/2024-04/graphql.json`, {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: graphqlQuery,
            variables: { input: { lineItemsByFulfillmentOrder } }
          })
        });

        if (gqlRes.ok) {
          const gqlData = await gqlRes.json();
          const userErrors = gqlData?.data?.fulfillmentOrderLineItemsPreparedForPickup?.userErrors || [];
          if (userErrors.length > 0) {
            console.warn(`⚠️ [ReadyForPickup] Aviso GraphQL en orden ${shopifyOrderId}:`, JSON.stringify(userErrors));
          } else {
            console.log(`✅ [ReadyForPickup] Orden ${shopifyOrderId} marcada nativamente como 'Listo para retirar' en Shopify.`);
          }
        }
      } else if (fulfillmentOrders.length > 0 && fulfillmentOrders.every(fo => fo.status === 'closed')) {
        alreadyFulfilled = true;
      }
    }
  } catch (foErr) {
    console.warn(`Aviso en executeSetReadyForPickup para orden ${shopifyOrderId}:`, foErr.message);
  }

  if (!alreadyFulfilled) {
    try {
      const orderRes = await shopifyFetch(`https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}.json?fields=id,tags,fulfillment_status`, {
        headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }
      });

      if (orderRes.ok) {
        const orderData = await orderRes.json();
        if (orderData.order?.fulfillment_status === 'fulfilled') {
          alreadyFulfilled = true;
        } else {
          const currentTags = orderData.order?.tags || '';
          if (!currentTags.includes('Stocka: Listo para Retiro')) {
            const newTags = currentTags ? `${currentTags}, Stocka: Listo para Retiro` : 'Stocka: Listo para Retiro';
            await shopifyFetch(`https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}.json`, {
              method: 'PUT',
              headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
              body: JSON.stringify({ order: { id: shopifyOrderId, tags: newTags } })
            });
            console.log(`Etiqueta 'Stocka: Listo para Retiro' agregada a orden ${shopifyOrderId}`);
          }
        }
      }
    } catch (tagErr) {
      console.warn(`Aviso actualizando tags de retiro:`, tagErr.message);
    }
  }

  await supabase
    .from('orders')
    .update({
      shopify_order_status: alreadyFulfilled ? 'fulfilled' : 'ready_for_pickup',
      shopify_status_updated_at: new Date().toISOString(),
      shopify_sync_last_error: null
    })
    .eq('id', item.order_id);

  await supabase
    .from('shopify_fulfillment_queue')
    .update({ status: 'completed', last_error: null, processed_at: new Date().toISOString() })
    .eq('id', item.id);
}

async function executeCreateFulfillment(item, integration) {
  const shop = integration.shop_url;
  const token = integration.access_token;
  const shopifyOrderId = item.shopify_order_id;

  const cleanTrack = (item.tracking_number || '').trim();
  const isTempAlpha = /^46\d{6,}$/.test(cleanTrack);
  const hasRealTracking = cleanTrack !== '' && cleanTrack.toUpperCase() !== 'N/A' && cleanTrack.toUpperCase() !== 'S/N' && cleanTrack.toUpperCase() !== 'NO INFORMADO' && !isTempAlpha;
  const cLower = `${item.courier || ''} ${item.operador || ''}`.toLowerCase();
  const isOptiroute = cLower.includes('optiroute') || cLower.includes('stocka x') || (item.tracking_url && String(item.tracking_url).toLowerCase().includes('optiroute.cl'));
  if (isOptiroute && (item.order_id || hasRealTracking)) {
    item.tracking_url = `https://wms.stocka.cl/seguimiento.html?t=${encodeURIComponent(item.order_id || cleanTrack)}`;
  }
  const hasTrackUrl = Boolean(item.tracking_url && item.tracking_url.startsWith('http'));

  const foUrl = `https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}/fulfillment_orders.json`;
  const foRes = await shopifyFetch(foUrl, {
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }
  });

  if (!foRes.ok) {
    const errText = await foRes.text();
    throw new Error(`Shopify API error fetching fulfillment_orders (${foRes.status}): ${errText}`);
  }

  const foData = await foRes.json();
  const fulfillmentOrders = foData.fulfillment_orders || [];

  const onHoldOrders = fulfillmentOrders.filter(fo => fo.status === 'on_hold');
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
        await shopifyFetch(`https://${shop}/admin/api/2024-04/graphql.json`, {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: releaseMutation,
            variables: { id: `gid://shopify/FulfillmentOrder/${holdFo.id}` }
          })
        });
        holdFo.status = 'open';
      } catch (_) {}
    }
  }

  const openFulfillmentOrders = fulfillmentOrders.filter(fo => fo.status === 'open' || fo.status === 'in_progress');

  if (openFulfillmentOrders.length === 0) {
    const hasClosedFo = fulfillmentOrders.some(fo => fo.status === 'closed');
    const allCancelledFo = fulfillmentOrders.length > 0 && fulfillmentOrders.every(fo => fo.status === 'cancelled');

    let existingFulfillmentId = null;
    let existingTrackingNumber = null;
    let isOrderFulfilled = hasClosedFo;
    let isOrderCancelled = allCancelledFo;

    try {
      const ordCheckRes = await shopifyFetch(`https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}.json?fields=id,name,fulfillment_status,cancelled_at,fulfillments`, {
        headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }
      });

      if (ordCheckRes.ok) {
        const ordCheckData = await ordCheckRes.json();
        const ordObj = ordCheckData.order || {};
        const activeFulfillments = (ordObj.fulfillments || []).filter(f => f.status !== 'cancelled');
        if (activeFulfillments.length > 0) {
          existingFulfillmentId = String(activeFulfillments[0].id);
          existingTrackingNumber = activeFulfillments[0].tracking_number || null;
          isOrderFulfilled = true;
        } else if (ordObj.fulfillment_status === 'fulfilled') {
          isOrderFulfilled = true;
        }
        if (ordObj.cancelled_at) {
          isOrderCancelled = true;
        }
      } else if (ordCheckRes.status === 404) {
        isOrderCancelled = true;
      }
    } catch (checkErr) {
      console.warn(`Aviso verificando estado de orden cerrada ${shopifyOrderId}:`, checkErr.message);
    }

    if (isOrderFulfilled) {
      const resolvedId = existingFulfillmentId || 'already_fulfilled';
      console.log(`✅ Orden ${shopifyOrderId} ya se encontraba preparada en Shopify (fulfillment ID: ${resolvedId})`);

      if (existingFulfillmentId && !existingTrackingNumber && (hasRealTracking || hasTrackUrl)) {
        try {
          const companyName = mapCourierToShopify(item.courier, item.operador);
          const trackingInfo = { number: hasRealTracking ? cleanTrack : 'N/A', company: companyName };
          if (hasTrackUrl) trackingInfo.url = item.tracking_url;
          await shopifyFetch(`https://${shop}/admin/api/2024-04/fulfillments/${existingFulfillmentId}/update_tracking.json`, {
            method: 'POST',
            headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ fulfillment: { tracking_info: trackingInfo, notify_customer: false } })
          });
        } catch (_) {}
      }

      await supabase.from('orders').update({
        shopify_fulfillment_id: resolvedId,
        shopify_fulfillment_status: 'synced',
        shopify_order_status: 'fulfilled',
        shopify_status_updated_at: new Date().toISOString(),
        shopify_sync_last_error: null
      }).eq('id', item.order_id);

      await supabase.from('shopify_fulfillment_queue').update({
        status: 'completed',
        shopify_fulfillment_id: resolvedId,
        last_error: null,
        processed_at: new Date().toISOString()
      }).eq('id', item.id);

      return resolvedId;
    }

    if (isOrderCancelled) {
      console.log(`⚠️ Orden ${shopifyOrderId} se encuentra cancelada/eliminada en Shopify.`);
      await supabase.from('orders').update({
        shopify_order_status: 'cancelled',
        shopify_fulfillment_status: null,
        shopify_status_updated_at: new Date().toISOString(),
        shopify_sync_last_error: null
      }).eq('id', item.order_id);

      await supabase.from('shopify_fulfillment_queue').update({
        status: 'completed',
        last_error: 'Pedido cancelado en Shopify',
        processed_at: new Date().toISOString()
      }).eq('id', item.id);

      return 'cancelled';
    }

    throw new Error(`No hay fulfillment_orders abiertos o en progreso para orden ${shopifyOrderId}`);
  }

  const lineItemsByFulfillmentOrder = openFulfillmentOrders.map(fo => ({ fulfillment_order_id: fo.id }));
  let notifyCustomer = integration.notify_customer_on_fulfillment !== false;
  if (!hasRealTracking && !hasTrackUrl) {
    try {
      const { data: ordState } = await supabase
        .from('orders')
        .select('status')
        .eq('id', item.order_id)
        .maybeSingle();
      if (String(ordState?.status || '').toLowerCase() === 'pickeado') {
        notifyCustomer = false;
      }
    } catch (_) {}
  }

  const fulfillmentObj = {
    line_items_by_fulfillment_order: lineItemsByFulfillmentOrder,
    notify_customer: notifyCustomer
  };

  if (hasRealTracking || hasTrackUrl) {
    const companyName = mapCourierToShopify(item.courier, item.operador);
    const trackingInfo = { number: hasRealTracking ? cleanTrack : 'N/A', company: companyName };
    if (hasTrackUrl) {
      trackingInfo.url = item.tracking_url;
    }
    fulfillmentObj.tracking_info = trackingInfo;
  }

  const fulfillmentPayload = {
    fulfillment: fulfillmentObj
  };

  console.log(`Enviando fulfillment a Shopify para orden ${shopifyOrderId}:`, JSON.stringify(fulfillmentPayload));

  const createRes = await shopifyFetch(`https://${shop}/admin/api/2024-04/fulfillments.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify(fulfillmentPayload)
  });

  if (!createRes.ok) {
    const createErrText = await createRes.text();
    throw new Error(`Shopify API error creando fulfillment (${createRes.status}): ${createErrText}`);
  }

  const createData = await createRes.json();
  const fulfillmentId = (createData.fulfillment?.id || '').toString();

  await supabase.from('orders').update({
    shopify_fulfillment_id: fulfillmentId,
    shopify_fulfillment_status: 'synced',
    shopify_order_status: 'fulfilled',
    shopify_status_updated_at: new Date().toISOString(),
    shopify_sync_last_error: null
  }).eq('id', item.order_id);

  await supabase.from('shopify_fulfillment_queue').update({
    status: 'completed',
    shopify_fulfillment_id: fulfillmentId,
    last_error: null,
    processed_at: new Date().toISOString()
  }).eq('id', item.id);

  console.log(`✅ Fulfillment creado exitosamente en Shopify con ID ${fulfillmentId} para orden ${shopifyOrderId}`);
  return fulfillmentId;
}

async function executeUpdateTracking(item, integration) {
  const shop = integration.shop_url;
  const token = integration.access_token;
  let fulfillmentId = item.shopify_fulfillment_id;

  const { data: ordData } = await supabase
    .from('orders')
    .select('shopify_fulfillment_id, external_order_number, tracking_number, tracking_url, courier, operador')
    .eq('id', item.order_id)
    .maybeSingle();
  if (!fulfillmentId && ordData?.shopify_fulfillment_id) {
    fulfillmentId = ordData.shopify_fulfillment_id;
  }
  if (ordData) {
    if (!item.tracking_number && ordData.tracking_number) item.tracking_number = ordData.tracking_number;
    if (!item.tracking_url && ordData.tracking_url) item.tracking_url = ordData.tracking_url;
    if (!item.courier && ordData.courier) item.courier = ordData.courier;
    if (!item.operador && ordData.operador) item.operador = ordData.operador;
    item._external_order_number = ordData.external_order_number;
  }

  if (!fulfillmentId) {
    await executeCreateFulfillment(item, integration);
    return;
  }

  const cleanTrack = String(item.tracking_number || '').trim();
  const isTempAlpha = /^46\d{6,}$/.test(cleanTrack);
  const isOrderRef = Boolean(item._external_order_number && cleanTrack === String(item._external_order_number).trim());
  if (!cleanTrack || ['N/A', 'S/N', 'NO INFORMADO', 'NOINFORMADO', 'NULL', '-'].includes(cleanTrack.toUpperCase()) || isTempAlpha || isOrderRef) {
    await supabase.from('shopify_fulfillment_queue').update({
      status: 'completed',
      shopify_fulfillment_id: fulfillmentId,
      last_error: 'Omitido: tracking temporal o inválido para update_tracking',
      processed_at: new Date().toISOString()
    }).eq('id', item.id);
    return;
  }

  if (item.notify_customer !== true) {
    const { data: prevSent } = await supabase
      .from('shopify_fulfillment_queue')
      .select('id')
      .eq('order_id', item.order_id)
      .in('action_type', ['create_fulfillment', 'update_tracking'])
      .eq('status', 'completed')
      .eq('tracking_number', cleanTrack)
      .neq('id', item.id)
      .limit(1);

    if (prevSent && prevSent.length > 0) {
      console.log(`⏭️ [UpdateTracking] Tracking ${cleanTrack} ya había sido enviado a Shopify para orden ${item.shopify_order_id}. Omitiendo re-envío.`);
      await supabase.from('shopify_fulfillment_queue').update({
        status: 'completed',
        shopify_fulfillment_id: fulfillmentId,
        last_error: null,
        processed_at: new Date().toISOString()
      }).eq('id', item.id);
      return;
    }
  }

  const companyName = mapCourierToShopify(item.courier, item.operador);
  const notifyCustomer = item.notify_customer === true;

  const cLowerUpd = `${item.courier || ''} ${item.operador || ''}`.toLowerCase();
  const isOptirouteUpd = cLowerUpd.includes('optiroute') || cLowerUpd.includes('stocka x') || (item.tracking_url && String(item.tracking_url).toLowerCase().includes('optiroute.cl'));
  if (isOptirouteUpd && (item.order_id || item.tracking_number)) {
    item.tracking_url = `https://wms.stocka.cl/seguimiento.html?t=${encodeURIComponent(item.order_id || item.tracking_number)}`;
  }

  const trackingInfo = { number: item.tracking_number || 'N/A', company: companyName };
  if (item.tracking_url && item.tracking_url.startsWith('http')) {
    trackingInfo.url = item.tracking_url;
  }

  const updateRes = await shopifyFetch(`https://${shop}/admin/api/2024-04/fulfillments/${fulfillmentId}/update_tracking.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fulfillment: { tracking_info: trackingInfo, notify_customer: notifyCustomer } })
  });

  if (!updateRes.ok) {
    const errText = await updateRes.text();
    throw new Error(`Shopify API error actualizando tracking (${updateRes.status}): ${errText}`);
  }

  await supabase.from('orders').update({
    shopify_fulfillment_id: fulfillmentId,
    shopify_fulfillment_status: 'synced',
    shopify_order_status: 'fulfilled',
    shopify_status_updated_at: new Date().toISOString(),
    shopify_sync_last_error: null
  }).eq('id', item.order_id);

  await supabase.from('shopify_fulfillment_queue').update({
    status: 'completed',
    shopify_fulfillment_id: fulfillmentId,
    last_error: null,
    processed_at: new Date().toISOString()
  }).eq('id', item.id);

  console.log(`✅ Tracking actualizado en Shopify para fulfillment ID ${fulfillmentId}`);
}

// Ejecutar worker en lotes hasta vaciar la cola pendiente
async function drainQueue() {
  for (let batch = 1; batch <= 15; batch++) {
    const { count } = await supabase
      .from('shopify_fulfillment_queue')
      .select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'processing']);
    if (!count || count === 0) {
      console.log('🎉 Cola de Shopify completamente sincronizada (0 pendientes).');
      break;
    }
    console.log(`\n=== LOTE ${batch} (Pendientes restantes: ${count}) ===`);
    await processQueue();
  }
}

drainQueue();
