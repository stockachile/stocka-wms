const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// ==========================================
// CARGAR ARCHIVO .ENV LOCALMENTE
// ==========================================
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf-8');
  envConfig.split(/\r?\n/).forEach(line => {
    if (!line || line.startsWith('#')) return;
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      const value = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
      process.env[key.trim()] = value;
    }
  });
}

// ==========================================
// CONFIGURACIÓN DE SUPABASE
// ==========================================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ ERROR: La variable de entorno SUPABASE_SERVICE_ROLE_KEY no está configurada.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ==========================================
// FUNCIÓN PRINCIPAL DE SINCRONIZACIÓN
// ==========================================
async function syncWooCommerceData() {
  console.log('🔄 Iniciando sincronización con WooCommerce...');

  try {
    // 1. Obtener todas las integraciones activas de WooCommerce en Supabase
    const { data: integrations, error: intError } = await supabase
      .from('merchant_integrations')
      .select('*')
      .eq('platform', 'WooCommerce')
      .eq('is_active', true);

    if (intError) {
      console.error('❌ Error al obtener integraciones desde Supabase:', intError.message);
      return;
    }

    if (!integrations || integrations.length === 0) {
      console.log('ℹ️ No hay integraciones activas de WooCommerce configuradas.');
      return;
    }

    // 1.5 Obtener comercios inactivos para omitirlos
    const inactiveSet = new Set();
    try {
      const { data: cfgs } = await supabase
        .from('comercios_adicional_config')
        .select('comercio, activo, onboarding_checklist');
      if (Array.isArray(cfgs)) {
        cfgs.forEach(c => {
          if (!c || !c.comercio) return;
          const isActive = c.activo !== false && c?.onboarding_checklist?.comercio_activo !== false;
          if (!isActive) inactiveSet.add(c.comercio.trim().toUpperCase());
        });
      }
    } catch (_e) {}

    // 2. Procesar cada integración de forma independiente
    for (const integration of integrations) {
      if (process.env.TARGET_COMERCIO && (!integration.comercio || integration.comercio.trim().toUpperCase() !== process.env.TARGET_COMERCIO.trim().toUpperCase())) {
        continue;
      }
      if (integration.comercio && inactiveSet.has(integration.comercio.trim().toUpperCase())) {
        console.log(`⏭️ Omitiendo comercio desactivado en WMS: ${integration.comercio}`);
        continue;
      }

      console.log(`\n========================================`);
      console.log(`👤 Merchant ID: ${integration.merchant_id}`);
      console.log(`🏢 Comercio: ${integration.comercio || 'N/A'}`);
      console.log(`🔌 Plataforma: ${integration.platform}`);
      console.log(`🔗 URL Tienda: ${integration.shop_url}`);
      console.log(`========================================`);

      integration.original_merchant_id = integration.merchant_id;

      // Resolver dinámicamente el merchant_id real usando productos del comercio
      let activeMerchantId = integration.merchant_id;
      try {
        const { data: siblingProd } = await supabase
          .from('products')
          .select('merchant_id')
          .eq('comercio', integration.comercio)
          .limit(1)
          .maybeSingle();
        if (siblingProd && siblingProd.merchant_id) {
          activeMerchantId = siblingProd.merchant_id;
        }
      } catch (err) {
        console.error('Error al resolver merchant_id activo:', err.message);
      }
      
      if (activeMerchantId !== integration.merchant_id) {
        console.log(`Resolved Client Merchant ID: ${activeMerchantId}`);
        integration.merchant_id = activeMerchantId;
      }

      try {
        await syncMerchantWooCommerce(integration);
        await supabase
          .from('merchant_integrations')
          .update({
            last_sync_at: new Date().toISOString(),
            last_sync_error: null
          })
          .eq('id', integration.id);
        console.log(`✅ Estado de sincronización de ${integration.comercio} actualizado.`);
      } catch (merchantErr) {
        console.error(`❌ Error sincronizando WooCommerce para ${integration.comercio}:`, merchantErr.message);
        await supabase
          .from('merchant_integrations')
          .update({
            last_sync_at: new Date().toISOString(),
            last_sync_error: merchantErr.message
          })
          .eq('id', integration.id);
      }
    }

    console.log('\n🎉 Sincronización WooCommerce finalizada.');
  } catch (err) {
    console.error('❌ Error general durante la sincronización:', err.message);
  }
}

/**
 * Sincroniza productos y pedidos de una integración específica
 */
async function syncMerchantWooCommerce(integration) {
  // A. Parsear credenciales desde el access_token
  let consumerKey, consumerSecret;
  try {
    const creds = JSON.parse(integration.access_token);
    consumerKey = creds.consumer_key;
    consumerSecret = creds.consumer_secret;
  } catch (e) {
    const msg = `Formato de access_token inválido. Debe ser un JSON conteniendo consumer_key y consumer_secret.`;
    console.error(`❌ Error para Merchant ${integration.merchant_id}: ${msg}`);
    throw new Error(msg);
  }

  if (!consumerKey || !consumerSecret) {
    const msg = `Faltan consumer_key o consumer_secret en las credenciales guardadas.`;
    console.error(`❌ Error para Merchant ${integration.merchant_id}: ${msg}`);
    throw new Error(msg);
  }

  // B. Obtener bodega por defecto para el cliente
  let warehouseId = null;
  if (integration.comercio) {
    const { data: adWh } = await supabase
      .from('comercios_adicional_config')
      .select('default_warehouse_id')
      .eq('comercio', integration.comercio)
      .maybeSingle();
    if (adWh && adWh.default_warehouse_id) {
      warehouseId = adWh.default_warehouse_id;
    }
  }

  if (!warehouseId) {
    const { data: whRel } = await supabase
      .from('merchants_warehouses')
      .select('warehouse_id')
      .eq('merchant_id', integration.merchant_id)
      .limit(1)
      .maybeSingle();

    if (whRel) {
      warehouseId = whRel.warehouse_id;
    } else {
      // Buscar la primera bodega disponible como fallback
      const { data: defaultWh } = await supabase.from('warehouses').select('id').limit(1).maybeSingle();
      if (defaultWh) {
        warehouseId = defaultWh.id;
      }
    }
  }

  if (!warehouseId) {
    const msg = `No hay ninguna bodega configurada en el WMS.`;
    console.error(`❌ Error para Merchant ${integration.merchant_id}: ${msg}`);
    throw new Error(msg);
  }

  // C. Normalizar URL base
  let baseUrl = integration.shop_url.trim();
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = 'https://' + baseUrl;
  }
  if (baseUrl.endsWith('/')) {
    baseUrl = baseUrl.slice(0, -1);
  }

  const authHeader = 'Basic ' + Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const headers = {
    'Authorization': authHeader,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  };

  // 0. Verificar y auto-reactivar/registrar Webhooks en WooCommerce (previene desactivación silenciosa tras 5 fallos)
  await ensureWooCommerceWebhooks(integration, baseUrl, headers);

  let syncErrors = [];

  // 1. Sincronizar Productos (ventana 2x/día para optimizar Disk IO; forzar con FORCE_PRODUCTS_SYNC=true)
  const nowUtc = new Date();
  const isScheduledCatalogWindow = (nowUtc.getUTCHours() === 6 || nowUtc.getUTCHours() === 18) && nowUtc.getUTCMinutes() < 30;
  const shouldSyncProducts =
    process.env.SKIP_PRODUCTS_SYNC !== 'true' &&
    (process.env.FORCE_PRODUCTS_SYNC === 'true' || !!process.env.TARGET_COMERCIO || isScheduledCatalogWindow);

  if (shouldSyncProducts) {
    try {
      await syncProducts(integration, baseUrl, headers);
    } catch (prodErr) {
      syncErrors.push(`Productos: ${prodErr.message}`);
    }
  } else {
    console.log('⏭️ Omitiendo syncProducts en esta corrida (ventana de catálogo 2x/día para optimizar Disk IO).');
  }

  // 2. Sincronizar Pedidos (Orders)
  try {
    await syncOrders(integration, baseUrl, headers, warehouseId);
  } catch (ordErr) {
    syncErrors.push(`Pedidos: ${ordErr.message}`);
  }

  if (syncErrors.length > 0) {
    throw new Error(syncErrors.join(' | '));
  }
}

/**
 * Realiza una petición a la API de WooCommerce y, si el firewall/Cloudflare de la tienda
 * bloquea la IP de GitHub Actions con HTTP 403, reintenta automáticamente a través del
 * puente seguro en Supabase Edge Functions (woocommerce-webhook).
 */
async function wcFetchWithProxyFallback(baseUrl, endpoint, options, integration) {
  const fullUrl = `${baseUrl}${endpoint}`;
  let res = null;
  let networkFailed = false;

  try {
    res = await fetch(fullUrl, options);
  } catch (fetchErr) {
    networkFailed = true;
    console.log(`🛡️ [WAF/Socket Bypass] ${integration.comercio} falló en conexión directa (${fetchErr.message}) para ${endpoint}. Enrutando vía Supabase Edge Function...`);
  }

  const contentType = res ? (res.headers.get('content-type') || '') : '';

  if (networkFailed || res.status === 403 || (res.ok && !contentType.includes('application/json'))) {
    if (!networkFailed) {
      console.log(`🛡️ [WAF Bypass] ${integration.comercio} devolvió ${res.status} en conexión directa (${endpoint}). Enrutando vía Supabase Edge Function...`);
    }
    const proxyRes = await fetch(`${SUPABASE_URL}/functions/v1/woocommerce-webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'x-region': 'sa-east-1'
      },
      body: JSON.stringify({
        action: 'proxy_wc_api',
        integration_id: integration.id,
        comercio: integration.comercio,
        endpoint,
        method: options.method || 'GET',
        body: options.body || undefined
      })
    });
    return proxyRes;
  }

  return res;
}

/**
 * Verifica que los webhooks de WooCommerce (order.created y order.updated) estén activos.
 * Si WooCommerce los pausó/desactivó automáticamente tras reintentos fallidos, los reactiva.
 */
async function ensureWooCommerceWebhooks(integration, baseUrl, headers) {
  try {
    const webhookMerchantId = integration.original_merchant_id || integration.merchant_id;
    const expectedWebhookUrl = `${SUPABASE_URL}/functions/v1/woocommerce-webhook?merchant_id=${webhookMerchantId}&comercio=${encodeURIComponent(integration.comercio || '')}`;
    const whRes = await wcFetchWithProxyFallback(baseUrl, '/wp-json/wc/v3/webhooks?per_page=100', { method: 'GET', headers }, integration);
    if (!whRes.ok) return;

    const webhooksList = await whRes.json();
    if (!Array.isArray(webhooksList)) return;

    const requiredTopics = [
      { topic: 'order.created', name: 'WMS STOCKA - Pedido Creado' },
      { topic: 'order.updated', name: 'WMS STOCKA - Pedido Actualizado' }
    ];

    for (const reqWh of requiredTopics) {
      const matching = webhooksList.filter(w =>
        w.delivery_url &&
        (w.delivery_url.includes('/functions/v1/woocommerce-webhook') || w.delivery_url.includes('supabase.co/functions')) &&
        (w.topic === reqWh.topic || (w.resource === 'order' && `${w.resource}.${w.event}` === reqWh.topic))
      );

      const activeOne = matching.find(w => w.status === 'active');
      if (activeOne) continue;

      const pausedOne = matching[0];
      if (pausedOne && pausedOne.id) {
        const reactivateRes = await wcFetchWithProxyFallback(baseUrl, `/wp-json/wc/v3/webhooks/${pausedOne.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ status: 'active' })
        }, integration);
        if (reactivateRes.ok) {
          console.log(`🛠️ [Auto-Heal] Webhook '${reqWh.topic}' estaba en estado '${pausedOne.status}' para ${integration.comercio}. Reactivado automáticamente.`);
        }
      } else {
        const createRes = await wcFetchWithProxyFallback(baseUrl, '/wp-json/wc/v3/webhooks', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: reqWh.name,
            topic: reqWh.topic,
            delivery_url: expectedWebhookUrl,
            status: 'active'
          })
        }, integration);
        if (createRes.ok) {
          console.log(`🛠️ [Auto-Heal] Webhook '${reqWh.topic}' registrado automáticamente para ${integration.comercio}.`);
        }
      }
    }
  } catch (err) {
    console.warn(`⚠️ No se pudieron verificar/reactivar webhooks de WooCommerce para ${integration.comercio}:`, err.message);
  }
}

/**
 * Sincroniza los productos desde WooCommerce
 */
async function syncProducts(integration, baseUrl, headers) {
  console.log('--> Extrayendo productos desde WooCommerce...');

  try {
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const response = await wcFetchWithProxyFallback(baseUrl, `/wp-json/wc/v3/products?per_page=100&page=${page}`, { method: 'GET', headers }, integration);
      if (!response.ok) {
        throw new Error(`Error en API WooCommerce Productos (página ${page}): Status ${response.status} ${response.statusText}`);
      }

      const products = await response.json();
      if (!Array.isArray(products) || products.length === 0) break;
      console.log(`Página ${page}: se encontraron ${products.length} productos base.`);

      for (const product of products) {
        if (product.type === 'variable') {
          console.log(`   Procesando producto variable: ${product.name} (ID: ${product.id}). Extrayendo variaciones...`);
          const varRes = await wcFetchWithProxyFallback(baseUrl, `/wp-json/wc/v3/products/${product.id}/variations?per_page=100`, { method: 'GET', headers }, integration);
          if (varRes.ok) {
            const variations = await varRes.json();
            for (const variation of variations) {
              await saveProductToDb(integration, product, variation);
            }
          } else {
            console.error(`   ❌ Error al extraer variaciones de producto ${product.id}`);
          }
        } else {
          await saveProductToDb(integration, product, null);
        }
      }

      if (products.length < 100) {
        hasMore = false;
      } else {
        page++;
      }
    }
  } catch (error) {
    console.error(`❌ Error sincronizando productos para ${integration.shop_url}:`, error.message);
    throw error;
  }
}

/**
 * Guarda o actualiza un producto/variación en la base de datos de Supabase
 */
async function saveProductToDb(integration, product, variation) {
  const isVariation = !!variation;
  const sku = (isVariation ? variation.sku : product.sku) || (isVariation ? `WC-${product.id}-${variation.id}` : `WC-${product.id}`);
  const cleanSku = sku.replace(/\s+/g, '');

  const productName = isVariation 
    ? `${product.name} - ${variation.attributes.map(a => a.option).join(' / ')}`
    : product.name;

  const imageUrl = (isVariation && variation.image?.src)
    ? variation.image.src
    : (product.images?.[0]?.src || null);

  const productDataToSave = {
    comercio: integration.comercio,
    platform: 'WooCommerce',
    sku: cleanSku,
    name: productName,
    image_url: imageUrl
  };

  const { error: insErr } = await supabase
    .from('synced_products')
    .upsert([productDataToSave], { onConflict: 'comercio,platform,sku' });

  if (insErr) {
    console.error(`   ❌ Error al sincronizar SKU ${cleanSku} en synced_products:`, insErr.message);
  } else {
    console.log(`   📥 Sincronizado SKU ${cleanSku} en synced_products`);
  }

  // Rellenar image_url en catálogo maestro products si existe sin foto
  if (imageUrl && integration.comercio) {
    await supabase
      .from('products')
      .update({ image_url: imageUrl })
      .eq('comercio', integration.comercio)
      .eq('sku', cleanSku)
      .or('image_url.is.null,image_url.eq.');
  }
}

/**
 * Sincroniza los pedidos desde WooCommerce
 */
async function syncOrders(integration, baseUrl, headers, warehouseId) {
  console.log('--> Extrayendo pedidos desde WooCommerce...');

  // Obtener sigla del comercio y configuración de prefijos por plataforma
  let siglaComercio = '';
  let prefijoOrigen = '';
  let agregarPrefijo = true;
  let hasPlatConfig = false;

  if (integration.comercio) {
    try {
      const { data: configData } = await supabase
        .from('v_comercios_config')
        .select('sigla')
        .eq('nombre', integration.comercio)
        .maybeSingle();

      if (configData && configData.sigla) {
        siglaComercio = configData.sigla.trim().toUpperCase();
      }

      const { data: adicionalConfig } = await supabase
        .from('comercios_adicional_config')
        .select('pedido_trae_sigla, plat_siglas_config')
        .eq('comercio', integration.comercio)
        .maybeSingle();

      if (adicionalConfig) {
        const platConfig = (adicionalConfig.plat_siglas_config || {})['WooCommerce'];
        if (platConfig) {
          hasPlatConfig = true;
          agregarPrefijo = platConfig.agregar_prefijo !== false;
          prefijoOrigen = (platConfig.prefijo_origen || '').trim().toUpperCase();
        } else {
          // Fallback legacy
          agregarPrefijo = !adicionalConfig.pedido_trae_sigla;
        }
      } else {
        // Fallback default
        agregarPrefijo = true;
      }
      console.log(`ℹ️ Configuración de prefijo para WooCommerce: Sigla="${siglaComercio}", HasPlatConfig=${hasPlatConfig}, AgregarPrefijo=${agregarPrefijo}, PrefijoOrigen="${prefijoOrigen}"`);
    } catch (err) {
      console.error('⚠️ Error al consultar configuración de sigla para el comercio:', err.message);
    }
  }
  
  // Cargar equivalencias de SKU para este comercio
  const skuMap = {};
  try {
    const { data: equivalences } = await supabase
      .from('sku_equivalences')
      .select('platform_sku, master_sku, platform')
      .eq('comercio', integration.comercio);
    
    if (equivalences) {
      equivalences.filter(e => e.platform === 'Todas').forEach(e => {
        if (e.platform_sku && e.master_sku) {
          const clean = e.platform_sku.trim().replace(/\s+/g, '');
          const mTrim = e.master_sku.trim();
          skuMap[clean] = mTrim;
          skuMap[clean.toUpperCase()] = mTrim;
        }
      });
      equivalences.filter(e => e.platform === 'WooCommerce').forEach(e => {
        if (e.platform_sku && e.master_sku) {
          const clean = e.platform_sku.trim().replace(/\s+/g, '');
          const mTrim = e.master_sku.trim();
          skuMap[clean] = mTrim;
          skuMap[clean.toUpperCase()] = mTrim;
        }
      });
    }
  } catch (err) {
    console.error('⚠️ Error al cargar equivalencias de SKU:', err.message);
  }

  // Extraemos pedidos de cualquier estado para mantener el WMS actualizado, pero nos enfocamos en procesarlos.
  try {
    const response = await wcFetchWithProxyFallback(baseUrl, '/wp-json/wc/v3/orders?per_page=100', { method: 'GET', headers }, integration);
    if (!response.ok) {
      throw new Error(`Error en API WooCommerce Pedidos: Status ${response.status} ${response.statusText}`);
    }

    const orders = await response.json();
    console.log(`Se encontraron ${orders.length} pedidos.`);
    const syncedWcIds = new Set();

    for (const order of orders) {
      const orderId = order.id.toString();
      syncedWcIds.add(orderId);
      let orderNumber = (order.number || orderId).toString().trim();

      // 1. Quitar prefijo de origen si coincide
      if (prefijoOrigen && orderNumber.toUpperCase().startsWith(prefijoOrigen)) {
        orderNumber = orderNumber.substring(prefijoOrigen.length).trim();
      }

      // 2. Aplicar prefijo del WMS si corresponde
      let finalOrderNumber = orderNumber;
      if (agregarPrefijo && siglaComercio) {
        if (!orderNumber.toUpperCase().startsWith(siglaComercio)) {
          finalOrderNumber = `${siglaComercio}${orderNumber}`;
        }
      }
      const statusName = order.status; // e.g. processing, completed, cancelled, on-hold

      console.log(`\nProcesando pedido WooCommerce ID: ${finalOrderNumber} (Estado actual: ${statusName})`);

      // Clasificación de estados
      const isDelivered = statusName === 'completed';
      const isCancelled = ['cancelled', 'failed', 'refunded', 'trash'].includes(statusName);
      const isActive = !isDelivered && !isCancelled;

      // Verificar si el pedido ya existe en el WMS
      let { data: existingOrder } = await supabase
        .from('orders')
        .select('id, external_order_number, status, estado_wms, operador, tracking_number, fecha_procesamiento, stock_descontado, raw_woocommerce_data, total_value, sku, item, cantidad, customer_name, customer_email, customer_phone, shipping_address, shipping_city, shipping_complement')
        .eq('comercio', integration.comercio)
        .eq('external_order_number', finalOrderNumber)
        .maybeSingle();

      // Detectar colisión de folio en origen (p. ej. restauración de backup en WooCommerce reutilizando el mismo número con distinto order_key)
      let isOrderKeyCollision = false;
      const existingOrderKey = existingOrder?.raw_woocommerce_data?.order_key;
      const incomingOrderKey = order.order_key;
      if (existingOrder && existingOrderKey && incomingOrderKey && existingOrderKey !== incomingOrderKey) {
        const baseCollisionPrefix = `${finalOrderNumber}-R`;
        const { data: collisionCandidates } = await supabase
          .from('orders')
          .select('id, external_order_number, status, estado_wms, operador, tracking_number, fecha_procesamiento, stock_descontado, raw_woocommerce_data, total_value, sku, item, cantidad, customer_name, customer_email, customer_phone, shipping_address, shipping_city, shipping_complement')
          .eq('comercio', integration.comercio)
          .ilike('external_order_number', `${baseCollisionPrefix}%`);

        const matchedCandidate = (collisionCandidates || []).find(
          c => c.raw_woocommerce_data?.order_key === incomingOrderKey
        );

        if (matchedCandidate) {
          existingOrder = matchedCandidate;
          finalOrderNumber = matchedCandidate.external_order_number;
          console.log(`ℹ️ Folio reutilizado detectado en WooCommerce; usando registro separado existente ${finalOrderNumber}`);
        } else {
          const takenSet = new Set((collisionCandidates || []).map(c => String(c.external_order_number).toUpperCase()));
          let suffixIdx = 1;
          let candidateNumber = baseCollisionPrefix;
          while (takenSet.has(candidateNumber.toUpperCase())) {
            suffixIdx += 1;
            candidateNumber = `${baseCollisionPrefix}${suffixIdx}`;
          }
          console.warn(`⚠️ [Colisión de Folio WooCommerce] ${finalOrderNumber} ya pertenece a order_key=${existingOrderKey}. Registrando nuevo pedido (order_key=${incomingOrderKey}) como ${candidateNumber}.`);
          finalOrderNumber = candidateNumber;
          existingOrder = null;
          isOrderKeyCollision = true;
        }
      }

      // Mapear campos planos de la orden
      const itemNames = [];
      const itemQuantities = {};
      
      for (const item of (order.line_items || [])) {
        let sku = item.sku || `WC-${item.product_id}${item.variation_id ? '-' + item.variation_id : ''}`;
        sku = sku.trim().replace(/\s+/g, '');
        // Aplicar equivalencia de SKU (case-insensitive)
        let mappedSku = skuMap[sku] || skuMap[sku.toUpperCase()] || sku;
        itemQuantities[mappedSku] = (itemQuantities[mappedSku] || 0) + Number(item.quantity);
        if (item.name && !itemNames.includes(item.name)) {
          itemNames.push(item.name);
        }
      }

      const flatSku = Object.keys(itemQuantities).join(', ');
      const flatItemName = itemNames.join(', ');
      const flatQuantity = Object.values(itemQuantities).reduce((sum, qty) => sum + qty, 0);
      const totalValue = Number(order.total || 0);

      const orderDataToSave = {
        merchant_id: integration.merchant_id,
        comercio: integration.comercio,
        external_order_number: finalOrderNumber,
        external_platform: 'WooCommerce',
        payment_status: order.date_paid ? 'PAID' : (statusName === 'processing' || statusName === 'completed' ? 'PAID' : 'PENDING'),
        total_value: totalValue,
        customer_email: order.billing?.email || 'no-email@woocommerce.cl',
        customer_phone: order.billing?.phone || order.shipping?.phone || 'No especificado',
        customer_name: `${order.billing?.first_name || order.shipping?.first_name || ''} ${order.billing?.last_name || order.shipping?.last_name || ''}`.trim() || 'Cliente WooCommerce',
        shipping_address: order.shipping?.address_1 || order.billing?.address_1 || 'No especificada',
        shipping_city: order.shipping?.city || order.billing?.city || 'No especificada',
        shipping_complement: [order.shipping?.address_2 || order.billing?.address_2, order.shipping?.state || order.billing?.state, order.shipping?.postcode || order.billing?.postcode].filter(Boolean).join(', ') || '',
        shipping_method: order.shipping_lines?.[0]?.method_title || 'Por definir',
        raw_woocommerce_data: order,
        origen: 'WooCommerce',
        item: flatItemName,
        cantidad: flatQuantity,
        sku: flatSku
      };

      let localOrderId = null;
      let shouldInsertItems = false;
      let existingItemsToReconcile = null;

      if (existingOrder) {
        if (existingOrder.estado_wms === 'Entregado') {
          continue;
        }
        const existingRaw = existingOrder.raw_woocommerce_data || {};
        const isWmsItemsEdited = existingOrder.wms_items_edited === true || existingRaw.wms_items_edited === true;
        const isWmsShippingEdited = existingOrder.wms_shipping_edited === true || existingRaw.wms_shipping_edited === true;
        const currentWmsState = (existingOrder.estado_wms || 'En procesamiento').trim().toLowerCase();
        const currentRawStatus = (existingOrder.status || '').trim().toLowerCase();
        const estadosWmsProtegidos = ['en preparación', 'pickeado', 'listo para retiro', 'despachado', 'incidencia', 'entregado', 'retirado', 'archivado'];
        const estadosInmutablesDespacho = ['listo para retiro', 'despachado', 'entregado', 'retirado', 'archivado'];
        const isClosedOrDispatched =
          ['listo para retiro', 'despachado', 'entregado', 'retirado', 'cancelado'].includes(currentRawStatus) ||
          ['listo para retiro', 'despachado', 'entregado', 'retirado', 'cancelado'].includes(currentWmsState);
        const wasCancelledInWms =
          currentRawStatus === 'cancelado' ||
          currentWmsState === 'cancelado';
        const wasManuallyProcessedInWms =
          Boolean(existingOrder.operador) ||
          Boolean(existingOrder.tracking_number) ||
          Boolean(existingOrder.fecha_procesamiento) ||
          Boolean(existingOrder.stock_descontado) ||
          existingRaw.wms_manually_cancelled === true;
        const willBeReactivated =
          !isCancelled && isActive && statusName !== 'pending' && wasCancelledInWms && !wasManuallyProcessedInWms && !estadosWmsProtegidos.includes(currentWmsState);

        const orderDataToUpdate = { ...orderDataToSave };

        // Proteger campos planos de ítems si fue editado en WMS o si ya está en estado operacional protegido/cerrado (evita desincronizar cabecera vs order_items)
        if (isWmsItemsEdited || (!willBeReactivated && (isClosedOrDispatched || estadosWmsProtegidos.includes(currentWmsState)))) {
          delete orderDataToUpdate.sku;
          delete orderDataToUpdate.item;
          delete orderDataToUpdate.cantidad;
          delete orderDataToUpdate.total_value;
        }

        // Proteger datos de envío/cliente si fueron editados en WMS o si el pedido ya fue despachado/cerrado
        if (isWmsShippingEdited || estadosInmutablesDespacho.includes(currentWmsState) || ['despachado', 'entregado', 'retirado'].includes(currentRawStatus)) {
          delete orderDataToUpdate.customer_name;
          delete orderDataToUpdate.customer_email;
          delete orderDataToUpdate.customer_phone;
          delete orderDataToUpdate.shipping_address;
          delete orderDataToUpdate.shipping_city;
          delete orderDataToUpdate.shipping_complement;
          delete orderDataToUpdate.shipping_method;
        }

        orderDataToUpdate.raw_woocommerce_data = {
          ...order,
          ...(existingRaw.admin_notes ? { admin_notes: existingRaw.admin_notes } : {}),
          ...(existingRaw.wms_admin_notes ? { wms_admin_notes: existingRaw.wms_admin_notes } : {}),
          ...(existingRaw.internal_notes ? { internal_notes: existingRaw.internal_notes } : {}),
          ...(existingRaw.wms_on_hold ? { wms_on_hold: existingRaw.wms_on_hold } : {}),
          ...(existingRaw.wms_manually_cancelled ? { wms_manually_cancelled: true } : {}),
          ...(isWmsItemsEdited ? { wms_items_edited: true } : {}),
          ...(isWmsShippingEdited ? { wms_shipping_edited: true } : {}),
          ...((existingRaw.wms_custom_edited || isWmsItemsEdited || isWmsShippingEdited) ? { wms_custom_edited: true } : {})
        };

        // Si el pedido se canceló en origen, actualizar su estado en WMS (protegiendo estados operacionales avanzados)
        if (isCancelled && existingOrder.status !== 'cancelado') {
          const cancelUpdate = { ...orderDataToUpdate, status: 'cancelado' };
          if (!estadosWmsProtegidos.includes(currentWmsState)) {
            cancelUpdate.estado_wms = 'Cancelado';
          }
          await supabase
            .from('orders')
            .update(cancelUpdate)
            .eq('id', existingOrder.id);
          console.log(`🚫 Pedido ${finalOrderNumber} cancelado en WooCommerce. Actualizado en el WMS (estado_wms: ${cancelUpdate.estado_wms || existingOrder.estado_wms}).`);
        } else if (willBeReactivated) {
          const reactivateUpdate = {
            ...orderDataToUpdate,
            status: 'para procesar',
            estado_wms: 'En procesamiento'
          };
          await supabase
            .from('orders')
            .update(reactivateUpdate)
            .eq('id', existingOrder.id);
          existingOrder.status = 'para procesar';
          existingOrder.estado_wms = 'En procesamiento';
          try {
            await supabase.rpc('recalculate_committed_stock');
          } catch (_e) {}
          console.log(`🔄 Pedido ${finalOrderNumber} reactivado automáticamente en el WMS tras cambiar a estado '${statusName}' en WooCommerce.`);
        } else {
          // Actualizar datos de pedido manteniendo el estado actual del WMS
          await supabase
            .from('orders')
            .update(orderDataToUpdate)
            .eq('id', existingOrder.id);
          console.log(`📝 Actualizado pedido local ${finalOrderNumber}`);
        }
        localOrderId = existingOrder.id;

        // Auto-recuperación (Healer): Validar si ya tiene ítems guardados o si requieren reconciliación (solo si no fue editado en WMS)
        if (!isWmsItemsEdited) {
          const { data: existingItems, error: itemsCheckErr } = await supabase
            .from('order_items')
            .select('id, product_id, quantity, warehouse_id, is_gift, campaign_id, tag')
            .eq('order_id', localOrderId);

          const rawStatusNow = (existingOrder.status || '').toLowerCase();
          const rawWmsStatusNow = (existingOrder.estado_wms || '').toLowerCase();
          const isNowClosedOrDispatched = ['listo para retiro', 'despachado', 'entregado', 'retirado', 'cancelado'].includes(rawStatusNow) ||
                                          ['listo para retiro', 'despachado', 'entregado', 'retirado', 'cancelado'].includes(rawWmsStatusNow);
          const wmsStatusNow = (existingOrder.estado_wms || existingOrder.status || 'En procesamiento').toLowerCase();
          const estadosCriticos = ['en preparación', 'pickeado', 'listo para retiro', 'despachado', 'incidencia', 'entregado', 'retirado', 'cancelado'];

          if (!itemsCheckErr && (!existingItems || existingItems.length === 0) && !isNowClosedOrDispatched && !estadosCriticos.includes(wmsStatusNow)) {
            console.log(`ℹ️ Pedido existente ${finalOrderNumber} no tiene ítems registrados. Se procederá a ingresarlos.`);
            shouldInsertItems = true;
          } else if (!itemsCheckErr && existingItems && existingItems.length > 0) {
            if (!isNowClosedOrDispatched && !estadosCriticos.includes(wmsStatusNow)) {
              existingItemsToReconcile = existingItems;
            }
          }
        }
      } else {
        // Insertar nuevo pedido en WMS
        const orderDate = order.date_created_gmt ? `${order.date_created_gmt}Z` : (order.date_created ? new Date(order.date_created).toISOString() : new Date().toISOString());
        const orderAgeHours = (Date.now() - new Date(orderDate).getTime()) / (1000 * 60 * 60);

        let initialStatus = 'para procesar';
        if (isCancelled) {
          initialStatus = 'cancelado';
        } else if (isDelivered && orderAgeHours > 48) {
          initialStatus = 'despachado';
        }

        const { data: newOrder, error: insErr } = await supabase
          .from('orders')
          .insert([{ 
            ...orderDataToSave, 
            status: initialStatus,
            ...(initialStatus === 'cancelado' ? { estado_wms: 'Cancelado' } : {}),
            created_at: orderDate
          }])
          .select('id')
          .single();

        if (insErr) {
          console.error(`❌ Error al insertar pedido local ${finalOrderNumber}:`, insErr.message);
          continue;
        }

        console.log(`📥 Insertado nuevo pedido local ${finalOrderNumber} con estado '${initialStatus}'`);
        localOrderId = newOrder.id;
        shouldInsertItems = true;

        if (isOrderKeyCollision) {
          try {
            await supabase.from('order_alerts').insert([{
              merchant_id: integration.merchant_id,
              comercio: integration.comercio,
              order_id: localOrderId,
              alert_type: 'COLISION_FOLIO_ORIGEN',
              message: `WooCommerce reutilizó un folio existente. Este pedido nuevo se registró como ${finalOrderNumber} para no sobrescribir el pedido histórico.`
            }]);
          } catch (_alertErr) {}
        }
      }

      // Registrar o reconciliar ítems en order_items (pre-expandiendo packs y consolidando cantidades por product_id)
      if (localOrderId && (shouldInsertItems || existingItemsToReconcile)) {
        const expectedQuantities = new Map();

        for (const [sku, qty] of Object.entries(itemQuantities)) {
          // Buscar detalle del item original usando mapeo inverso
          const itemDetail = (order.line_items || []).find(item => {
            let itemSku = item.sku || `WC-${item.product_id}${item.variation_id ? '-' + item.variation_id : ''}`;
            let cleanItemSku = itemSku.trim().replace(/\s+/g, '');
            let mappedItemSku = skuMap[cleanItemSku] || skuMap[cleanItemSku.toUpperCase()] || cleanItemSku;
            return mappedItemSku === sku;
          });
          const itemImageUrl = itemDetail?.image?.src || (typeof itemDetail?.image === 'string' ? itemDetail.image : null);

          // Buscar producto en la base de datos (exacto o case-insensitive)
          let { data: product } = await supabase
            .from('products')
            .select('id, is_pack, image_url')
            .eq('sku', sku)
            .eq('comercio', integration.comercio)
            .maybeSingle();

          if (!product && sku) {
            const { data: ilikeProd } = await supabase
              .from('products')
              .select('id, is_pack, image_url')
              .ilike('sku', sku)
              .eq('comercio', integration.comercio)
              .limit(1)
              .maybeSingle();
            if (ilikeProd) product = ilikeProd;
          }

          if (product && !product.image_url && itemImageUrl) {
            await supabase.from('products').update({ image_url: itemImageUrl }).eq('id', product.id);
            product.image_url = itemImageUrl;
          }

          if (!product) {
            // Auto-crear producto faltante
            const productName = itemDetail?.name || 'Producto WooCommerce ' + sku;
            const productPrice = Number(itemDetail?.price || 0);

            const { data: newProd, error: prodErr } = await supabase
              .from('products')
              .insert([{
                merchant_id: integration.merchant_id,
                comercio: integration.comercio,
                sku: sku,
                name: productName,
                price: productPrice,
                image_url: itemImageUrl,
                description: 'Creado automáticamente desde integración de WooCommerce (al procesar pedido)'
              }])
              .select('id, is_pack, image_url')
              .single();

            if (!prodErr && newProd) {
              console.log(`   * Creado automáticamente producto para SKU: ${sku} ("${productName}")`);
              product = newProd;
            } else {
              console.error(`   ❌ Error al crear producto para SKU ${sku}:`, prodErr?.message);
            }
          }

          if (product) {
            if (product.is_pack) {
              const { data: packMembers } = await supabase
                .from('product_pack_items')
                .select('member_product_id, quantity')
                .eq('pack_product_id', product.id);

              if (packMembers && packMembers.length > 0) {
                for (const pm of packMembers) {
                  const currentQty = expectedQuantities.get(pm.member_product_id) || 0;
                  expectedQuantities.set(pm.member_product_id, currentQty + (Number(pm.quantity || 1) * Number(qty)));
                }
              } else {
                const currentQty = expectedQuantities.get(product.id) || 0;
                expectedQuantities.set(product.id, currentQty + Number(qty));
              }
            } else {
              const currentQty = expectedQuantities.get(product.id) || 0;
              expectedQuantities.set(product.id, currentQty + Number(qty));
            }
          } else {
            console.warn(`   ⚠️ SKU ${sku} no encontrado en base de datos. No se pudo registrar en la orden.`);
          }
        }

        if (shouldInsertItems) {
          for (const [prodId, totalQty] of expectedQuantities.entries()) {
            const { error: itemErr } = await supabase
              .from('order_items')
              .insert([{
                order_id: localOrderId,
                product_id: prodId,
                warehouse_id: warehouseId,
                quantity: totalQty
              }]);

            if (itemErr) {
              console.error(`   ❌ Error al registrar ítem (product_id ${prodId}) para la orden:`, itemErr.message);
            } else {
              console.log(`   + Registrado ítem consolidado: product_id ${prodId} x ${totalQty} (Stock Reservado)`);
            }
          }
        } else if (existingItemsToReconcile) {
          const reconcilableItems = existingItemsToReconcile.filter(
            i => !i.is_gift && !i.campaign_id && i.tag !== 'Campaña'
          );
          const existingMap = new Map(reconcilableItems.map(i => [i.product_id, i]));
          const processedProductIds = new Set();

          for (const [prodId, totalQty] of expectedQuantities.entries()) {
            processedProductIds.add(prodId);
            const existing = existingMap.get(prodId);
            if (existing) {
              const targetWarehouseId = existing.warehouse_id || warehouseId;
              if (existing.quantity !== totalQty || (!existing.warehouse_id && warehouseId)) {
                await supabase
                  .from('order_items')
                  .update({
                    quantity: totalQty,
                    warehouse_id: targetWarehouseId
                  })
                  .eq('id', existing.id);
                console.log(`   🔄 Actualizada cantidad consolidada para product_id ${prodId}: ${existing.quantity} -> ${totalQty}`);
              }
            } else {
              await supabase
                .from('order_items')
                .insert([{
                  order_id: localOrderId,
                  product_id: prodId,
                  warehouse_id: warehouseId,
                  quantity: totalQty
                }]);
              console.log(`   + Agregado ítem faltante consolidado: product_id ${prodId} x ${totalQty}`);
            }
          }

          // Eliminar ítems removidos en WooCommerce (preservando ítems bonificados/campaña)
          for (const [prodId, existingItem] of existingMap.entries()) {
            if (!processedProductIds.has(prodId)) {
              await supabase
                .from('order_items')
                .delete()
                .eq('id', existingItem.id);
              console.log(`   🗑️ Eliminado ítem removido en WooCommerce: product_id ${prodId}`);
            }
          }
        }
      }
    }

    // Reconciliación de pedidos activos recientes que fueron eliminados permanentemente (404) o cancelados fuera de la primera página en WooCommerce
    try {
      const thirtyDaysAgoIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: activeWmsOrders } = await supabase
        .from('orders')
        .select('id, external_order_number, status, estado_wms, operador, tracking_number, fecha_procesamiento, stock_descontado, raw_woocommerce_data')
        .eq('comercio', integration.comercio)
        .eq('external_platform', 'WooCommerce')
        .eq('status', 'para procesar')
        .gte('created_at', thirtyDaysAgoIso)
        .limit(30);

      const candidatesToVerify = (activeWmsOrders || []).filter(o => {
        const rawId = o.raw_woocommerce_data?.id;
        if (!rawId || syncedWcIds.has(String(rawId))) return false;
        const wmsSt = (o.estado_wms || 'En procesamiento').trim().toLowerCase();
        if (wmsSt !== 'en procesamiento') return false;
        if (o.operador || o.tracking_number || o.fecha_procesamiento || o.stock_descontado) return false;
        if (o.raw_woocommerce_data?.wms_custom_edited) return false;
        return true;
      }).slice(0, 10);

      let cancelledGhostCount = 0;
      for (const ghostCandidate of candidatesToVerify) {
        const rawId = ghostCandidate.raw_woocommerce_data.id;
        const verifyRes = await wcFetchWithProxyFallback(baseUrl, `/wp-json/wc/v3/orders/${rawId}`, { method: 'GET', headers }, integration);
        if (verifyRes.status === 404) {
          const errBody = await verifyRes.json().catch(() => null);
          if (errBody && errBody.code === 'woocommerce_rest_shop_order_invalid_id') {
            await supabase
              .from('orders')
              .update({ status: 'cancelado', estado_wms: 'Cancelado' })
              .eq('id', ghostCandidate.id);
            cancelledGhostCount++;
            console.log(`🧹 Pedido fantasma ${ghostCandidate.external_order_number} (WC ID ${rawId} eliminado en origen) marcado como Cancelado.`);
          }
        } else if (verifyRes.ok) {
          const liveOrd = await verifyRes.json().catch(() => null);
          if (liveOrd && ['cancelled', 'failed', 'refunded', 'trash'].includes(liveOrd.status)) {
            await supabase
              .from('orders')
              .update({ status: 'cancelado', estado_wms: 'Cancelado' })
              .eq('id', ghostCandidate.id);
            cancelledGhostCount++;
            console.log(`🚫 Pedido ${ghostCandidate.external_order_number} fuera de ventana estaba '${liveOrd.status}' en WooCommerce. Marcado como Cancelado.`);
          }
        }
      }
      if (cancelledGhostCount > 0) {
        try {
          await supabase.rpc('recalculate_committed_stock');
        } catch (_e) {}
      }
    } catch (ghostErr) {
      console.warn(`⚠️ Advertencia al verificar pedidos huérfanos en WooCommerce para ${integration.comercio}:`, ghostErr.message);
    }
  } catch (error) {
    console.error(`❌ Error sincronizando pedidos para ${integration.shop_url}:`, error.message);
    throw error;
  }
}

// Ejecutar script
syncWooCommerceData();
