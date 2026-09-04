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

function mapCourierToShopify(courier, operador) {
  const raw = `${courier || ''} ${operador || ''}`.toUpperCase();
  if (raw.includes('CHILEXPRESS')) return 'Chilexpress';
  if (raw.includes('STARKEN')) return 'Starken';
  if (raw.includes('BLUEXPRESS') || raw.includes('BLUE EXPRESS') || raw.includes('BLUE')) return 'Blue Express';
  if (raw.includes('CORREOS')) return 'Correos de Chile';
  if (raw.includes('LIGHTDATA') || raw.includes('ALPHA')) return 'LightData';
  if (raw.includes('ENVIAME') || raw.includes('ENVÍAME')) return 'Envíame';
  if (raw.includes('STOCKA')) return 'Stocka Logistics';
  return 'Other';
}

async function getValidShopifyToken(integration) {
  if (!integration.refresh_token) {
    return integration.access_token;
  }

  const clientSecret = SHOPIFY_CLIENT_SECRET || integration.webhook_secret;
  if (!clientSecret) {
    return integration.access_token;
  }

  const tokenUrl = `https://${integration.shop_url}/admin/oauth/access_token`;
  try {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
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
      .from('merchant_integrations')
      .update({
        access_token: data.access_token,
        refresh_token: data.refresh_token
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

      const validToken = await getValidShopifyToken(integration);
      integration.access_token = validToken;

      if (integration.granted_scopes && Array.isArray(integration.granted_scopes)) {
        if (!integration.granted_scopes.includes('write_fulfillments')) {
          const reason = "La tienda no ha otorgado el permiso 'write_fulfillments'. Requiere re-autorización.";
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

      if (item.action_type === 'set_in_progress') {
        await executeSetInProgress(item, integration);
      } else if (item.action_type === 'create_fulfillment') {
        await executeCreateFulfillment(item, integration);
      } else if (item.action_type === 'update_tracking') {
        await executeUpdateTracking(item, integration);
      }

      await delay(350);

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

  console.log('\nProcesamiento de cola finalizado.');
}

async function executeSetInProgress(item, integration) {
  const shop = integration.shop_url;
  const token = integration.access_token;
  const shopifyOrderId = item.shopify_order_id;

  try {
    const orderRes = await fetch(`https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}.json?fields=id,tags`, {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }
    });

    if (orderRes.ok) {
      const orderData = await orderRes.json();
      const currentTags = orderData.order?.tags || '';
      if (!currentTags.includes('Stocka: En Preparación')) {
        const newTags = currentTags ? `${currentTags}, Stocka: En Preparación` : 'Stocka: En Preparación';
        await fetch(`https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}.json`, {
          method: 'PUT',
          headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ order: { id: shopifyOrderId, tags: newTags } })
        });
        console.log(`Etiqueta 'Stocka: En Preparación' agregada a orden ${shopifyOrderId}`);
      }
    }
  } catch (tagErr) {
    console.warn(`Aviso actualizando tags:`, tagErr.message);
  }

  await supabase
    .from('shopify_fulfillment_queue')
    .update({ status: 'completed', processed_at: new Date().toISOString() })
    .eq('id', item.id);
}

async function executeCreateFulfillment(item, integration) {
  const shop = integration.shop_url;
  const token = integration.access_token;
  const shopifyOrderId = item.shopify_order_id;

  const foUrl = `https://${shop}/admin/api/2024-04/orders/${shopifyOrderId}/fulfillment_orders.json`;
  const foRes = await fetch(foUrl, {
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }
  });

  if (!foRes.ok) {
    const errText = await foRes.text();
    throw new Error(`Shopify API error fetching fulfillment_orders (${foRes.status}): ${errText}`);
  }

  const foData = await foRes.json();
  const fulfillmentOrders = foData.fulfillment_orders || [];

  const openFulfillmentOrders = fulfillmentOrders.filter(fo => fo.status === 'open' || fo.status === 'in_progress');

  if (openFulfillmentOrders.length === 0) {
    const closedFo = fulfillmentOrders.find(fo => fo.status === 'closed' && fo.fulfillments && fo.fulfillments.length > 0);
    if (closedFo && closedFo.fulfillments && closedFo.fulfillments.length > 0) {
      const existingId = closedFo.fulfillments[0].id.toString();
      console.log(`Orden ${shopifyOrderId} ya completada previamente con ID ${existingId}`);
      await supabase.from('orders').update({
        shopify_fulfillment_id: existingId,
        shopify_fulfillment_status: 'synced',
        shopify_sync_last_error: null
      }).eq('id', item.order_id);
      await supabase.from('shopify_fulfillment_queue').update({
        status: 'completed',
        shopify_fulfillment_id: existingId,
        processed_at: new Date().toISOString()
      }).eq('id', item.id);
      return existingId;
    }
    throw new Error(`No hay fulfillment_orders abiertos o en progreso para orden ${shopifyOrderId}`);
  }

  const lineItemsByFulfillmentOrder = openFulfillmentOrders.map(fo => ({ fulfillment_order_id: fo.id }));
  const companyName = mapCourierToShopify(item.courier, item.operador);
  const notifyCustomer = integration.notify_customer_on_fulfillment !== false;

  const trackingInfo = { number: item.tracking_number || 'N/A', company: companyName };
  if (item.tracking_url && item.tracking_url.startsWith('http')) {
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

  const createRes = await fetch(`https://${shop}/admin/api/2024-04/fulfillments.json`, {
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
    shopify_sync_last_error: null
  }).eq('id', item.order_id);

  await supabase.from('shopify_fulfillment_queue').update({
    status: 'completed',
    shopify_fulfillment_id: fulfillmentId,
    processed_at: new Date().toISOString()
  }).eq('id', item.id);

  console.log(`✅ Fulfillment creado exitosamente en Shopify con ID ${fulfillmentId} para orden ${shopifyOrderId}`);
  return fulfillmentId;
}

async function executeUpdateTracking(item, integration) {
  const shop = integration.shop_url;
  const token = integration.access_token;
  const fulfillmentId = item.shopify_fulfillment_id;

  if (!fulfillmentId) {
    throw new Error(`Falta shopify_fulfillment_id para actualizar tracking`);
  }

  const companyName = mapCourierToShopify(item.courier, item.operador);
  const notifyCustomer = integration.notify_customer_on_fulfillment !== false;

  const trackingInfo = { number: item.tracking_number || 'N/A', company: companyName };
  if (item.tracking_url && item.tracking_url.startsWith('http')) {
    trackingInfo.url = item.tracking_url;
  }

  const updateRes = await fetch(`https://${shop}/admin/api/2024-04/fulfillments/${fulfillmentId}/update_tracking.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fulfillment: { tracking_info: trackingInfo, notify_customer: notifyCustomer } })
  });

  if (!updateRes.ok) {
    const errText = await updateRes.text();
    throw new Error(`Shopify API error actualizando tracking (${updateRes.status}): ${errText}`);
  }

  await supabase.from('shopify_fulfillment_queue').update({
    status: 'completed',
    processed_at: new Date().toISOString()
  }).eq('id', item.id);

  console.log(`✅ Tracking actualizado en Shopify para fulfillment ID ${fulfillmentId}`);
}

// Ejecutar worker
processQueue();
