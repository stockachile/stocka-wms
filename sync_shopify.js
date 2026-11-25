const { createClient } = require('@supabase/supabase-js');

// ==========================================
// CONFIGURACIÓN DE SUPABASE
// ==========================================
const fs = require('fs');

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

const tokenCache = new Map();

// Renueva de forma proactiva el token de acceso de Shopify usando el refresh token con caché inteligente
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
    console.error(`[Shopify Sync] No hay client_secret disponible para ${integration.shop_url}`);
    return integration.access_token;
  }

  console.log(`[Shopify Sync] Renovando token de acceso para ${integration.shop_url}...`);
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
      console.error(`[Shopify Sync] Error al renovar token de Shopify: ${res.status} - ${errorText}`);
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
    console.error(`[Shopify Sync] Excepción al renovar token de Shopify:`, err.message);
    return integration.access_token;
  }
}

async function syncShopifyData() {
  console.log('Iniciando sincronización con Shopify...');

  // 1. Obtener todas las integraciones activas de Shopify
  const { data: integrations, error: intError } = await supabase
    .from('merchant_integrations')
    .select('*')
    .eq('platform', 'Shopify')
    .eq('is_active', true);

  if (intError) {
    console.error('Error al obtener integraciones:', intError);
    return;
  }

  if (!integrations || integrations.length === 0) {
    console.log('No hay integraciones activas de Shopify configuradas.');
    return;
  }

  // Obtener comercios inactivos para omitirlos
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

  for (const integration of integrations) {
    if (process.env.TARGET_COMERCIO && (!integration.comercio || integration.comercio.trim().toUpperCase() !== process.env.TARGET_COMERCIO.trim().toUpperCase())) {
      continue;
    }
    if (integration.comercio && inactiveSet.has(integration.comercio.trim().toUpperCase())) {
      console.log(`⏭️ Omitiendo comercio desactivado en WMS: ${integration.comercio}`);
      continue;
    }

    console.log(`\n================================`);
    console.log(`Procesando tienda: ${integration.shop_url}`);
    console.log(`Original Merchant ID: ${integration.merchant_id}`);
    
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
    console.log(`================================`);

    // Renovar token si es necesario
    const accessToken = await getValidShopifyToken(integration);
    integration.access_token = accessToken;

    let syncError = null;

    // 2. Extraer y Guardar Pedidos (Orders)
    try {
      await syncOrders(integration);
    } catch (ordErr) {
      syncError = `Pedidos: ${ordErr.message}`;
    }
    
    // 3. Extraer y Guardar Productos (2 veces al día por defecto para evitar saturar Disk IO; forzar con FORCE_PRODUCTS_SYNC=true)
    const nowUtc = new Date();
    const isScheduledCatalogWindow = (nowUtc.getUTCHours() === 6 || nowUtc.getUTCHours() === 18) && nowUtc.getUTCMinutes() < 30;
    const shouldSyncProducts =
      process.env.SKIP_PRODUCTS_SYNC !== 'true' &&
      (process.env.FORCE_PRODUCTS_SYNC === 'true' || !!process.env.TARGET_COMERCIO || isScheduledCatalogWindow);

    if (shouldSyncProducts) {
      try {
        await syncProducts(integration);
      } catch (prodErr) {
        syncError = syncError ? `${syncError} | Productos: ${prodErr.message}` : `Productos: ${prodErr.message}`;
      }
    } else {
      console.log('⏭️ Omitiendo syncProducts en esta corrida (ventana de catálogo 2x/día para optimizar Disk IO).');
    }

    try {
      await supabase
        .from('merchant_integrations')
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_error: syncError
        })
        .eq('id', integration.id);
    } catch (_e) {}
  }

  console.log('\nSincronización finalizada.');
}

async function syncOrders(integration) {
  console.log('--> Extrayendo pedidos...');
  const lookbackHours = Number(process.env.SHOPIFY_LOOKBACK_HOURS || 6);
  const isFullSync = process.env.FULL_SYNC === 'true';
  const updatedAtMinParam = (!isFullSync && lookbackHours > 0)
    ? `&updated_at_min=${encodeURIComponent(new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString())}`
    : '';
  const url = `https://${integration.shop_url}/admin/api/2024-04/orders.json?status=any&limit=250${updatedAtMinParam}`;

  // Obtener sigla del comercio y configuración de prefijos por plataforma
  let siglaComercio = '';
  let prefijoOrigen = '';
  let agregarPrefijo = false; // Shopify default fallback is false
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
        .select('pedido_trae_sigla, plat_siglas_config, default_warehouse_id')
        .eq('comercio', integration.comercio)
        .maybeSingle();

      if (adicionalConfig) {
        if (adicionalConfig.default_warehouse_id) {
          integration._defaultWarehouseId = adicionalConfig.default_warehouse_id;
        }
        const platConfig = (adicionalConfig.plat_siglas_config || {})['Shopify'];
        if (platConfig) {
          hasPlatConfig = true;
          agregarPrefijo = platConfig.agregar_prefijo !== false;
          prefijoOrigen = (platConfig.prefijo_origen || '').trim().toUpperCase();
        } else {
          // Fallback legacy for Shopify
          agregarPrefijo = false;
        }
      } else {
        // Fallback default
        agregarPrefijo = false;
      }
      console.log(`ℹ️ Configuración de prefijo para Shopify: Sigla="${siglaComercio}", HasPlatConfig=${hasPlatConfig}, AgregarPrefijo=${agregarPrefijo}, PrefijoOrigen="${prefijoOrigen}"`);
    } catch (err) {
      console.error('⚠️ Error al consultar configuración de sigla para el comercio:', err.message);
    }
  }

  // Cargar primera bodega asignada al comerciante (priorizando default_warehouse_id del comercio)
  let warehouseId = integration._defaultWarehouseId || null;
  if (!warehouseId) {
    const { data: whRelation } = await supabase
      .from('merchants_warehouses')
      .select('warehouse_id')
      .eq('merchant_id', integration.merchant_id)
      .limit(1)
      .maybeSingle();
    warehouseId = whRelation?.warehouse_id || null;
  }

  // Cargar equivalencias de SKU (soportando coincidencia exacta, sin espacios, case-insensitive, multiplicador y master_product_id)
  const skuMap = {};
  const skuMultMap = {};
  const skuProdIdMap = {};
  try {
    let { data: equivalences, error: eqErr } = await supabase
      .from('sku_equivalences')
      .select('platform_sku, master_sku, platform, quantity_multiplier, master_product_id')
      .eq('comercio', integration.comercio);
    if (eqErr) {
      ({ data: equivalences } = await supabase
        .from('sku_equivalences')
        .select('platform_sku, master_sku, platform')
        .eq('comercio', integration.comercio));
    }
    
    if (equivalences) {
      equivalences.filter(e => e.platform === 'Todas').forEach(e => {
        if (e.platform_sku && e.master_sku) {
          const pTrim = e.platform_sku.trim();
          const pClean = pTrim.replace(/\s+/g, '');
          const mTrim = e.master_sku.trim();
          const mult = Math.max(1, Number(e.quantity_multiplier || 1));
          const pid = e.master_product_id || null;
          [pTrim, pClean, pClean.toUpperCase()].forEach(k => {
            skuMap[k] = mTrim;
            skuMultMap[k] = mult;
            if (pid) skuProdIdMap[k] = pid;
          });
        }
      });
      equivalences.filter(e => e.platform === 'Shopify').forEach(e => {
        if (e.platform_sku && e.master_sku) {
          const pTrim = e.platform_sku.trim();
          const pClean = pTrim.replace(/\s+/g, '');
          const mTrim = e.master_sku.trim();
          const mult = Math.max(1, Number(e.quantity_multiplier || 1));
          const pid = e.master_product_id || null;
          [pTrim, pClean, pClean.toUpperCase()].forEach(k => {
            skuMap[k] = mTrim;
            skuMultMap[k] = mult;
            if (pid) skuProdIdMap[k] = pid;
          });
        }
      });
    }
  } catch (err) {
    console.error('⚠️ Error al cargar equivalencias de SKU:', err.message);
  }

  try {
    let response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': integration.access_token,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 401 && integration.refresh_token) {
      console.warn(`[Shopify Sync] HTTP 401 recibido en syncOrders, renovando token...`);
      integration.access_token = await getValidShopifyToken(integration, true);
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-Shopify-Access-Token': integration.access_token,
          'Content-Type': 'application/json'
        }
      });
    }

    if (!response.ok) {
      throw new Error(`Error en Shopify API: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const orders = data.orders;
    console.log(`Se encontraron ${orders.length} pedidos.`);

    for (const order of orders) {
      let orderNumber = (order.name || '').toString().trim();

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

      // Intentar buscar si el pedido ya existe en nuestra BD (por ID interno de Shopify o por número con/sin prefijo)
      const shopifyOrderIdStr = (order.id || '').toString();
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('id, comercio, external_order_number, status, estado_wms, raw_shopify_data, total_value, sku, item, cantidad, customer_name, customer_email, customer_phone, shipping_address, shipping_city, shipping_complement')
        .eq('comercio', integration.comercio)
        .in('external_platform', ['Shopify', 'Punto de Venta'])
        .or(`raw_shopify_data->>id.eq.${shopifyOrderIdStr},external_order_number.eq.${order.name},external_order_number.eq.${finalOrderNumber}`)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      const orderDataToSave = {
        merchant_id: integration.merchant_id,
        comercio: integration.comercio,
        external_order_number: finalOrderNumber, // Ej: #1001
        external_platform: 'Shopify',
        payment_status: order.financial_status,
        total_value: order.current_total_price,
        customer_email: order.contact_email || order.email || order.customer?.email || null,
        customer_phone: order.shipping_address?.phone || order.billing_address?.phone || order.customer?.phone || null,
        customer_name: (order.shipping_address ? `${order.shipping_address.first_name || ''} ${order.shipping_address.last_name || ''}`.trim() : null) || 
                       (order.billing_address ? `${order.billing_address.first_name || ''} ${order.billing_address.last_name || ''}`.trim() : null) ||
                       (order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() : null) || 'No registrado',
        shipping_address: order.shipping_address?.address1,
        shipping_city: order.shipping_address?.city,
        shipping_complement: order.shipping_address?.address2,
        shipping_method: order.shipping_lines && order.shipping_lines.length > 0 ? order.shipping_lines[0].title : null,
        raw_shopify_data: order, // GUARDAMOS EL PAYLOAD COMPLETO AQUI
        created_at: new Date(order.created_at).toISOString()
      };

      const isFulfilledInShopify = order.fulfillment_status === 'fulfilled' || (order.fulfillments && order.fulfillments.length > 0);
      const isCancelledInShopify = !!order.cancelled_at;
      const orderDate = new Date(order.created_at);
      const orderAgeDays = (Date.now() - orderDate.getTime()) / (1000 * 60 * 60 * 24);

      if (isCancelledInShopify) {
        orderDataToSave.status = 'cancelado';
        orderDataToSave.estado_wms = 'Cancelado';
      } else if (isFulfilledInShopify && orderAgeDays > 60) {
        // Solo pedidos históricos muy antiguos (> 60 días) que ya venían cerrados antes de integrar WMS
        orderDataToSave.status = 'despachado';
        orderDataToSave.estado_wms = 'Despachado';
        orderDataToSave.stock_descontado = true;
      } else {
        orderDataToSave.status = 'para procesar';
        orderDataToSave.estado_wms = 'En procesamiento';
        orderDataToSave.stock_descontado = false;
      }

      let orderId;
      if (existingOrder) {
        if (existingOrder.estado_wms === 'Entregado') {
          continue;
        }
        const existingRaw = existingOrder.raw_shopify_data || {};
        const currentExtNum = (existingOrder.external_order_number || '').toString().trim();
        const hasPrefixToFix = (
          currentExtNum === (order.name || '').toString().trim() ||
          currentExtNum === orderNumber
        ) && currentExtNum !== finalOrderNumber;
        const isAlreadyCancelled = (existingOrder.status || '').toLowerCase().trim() === 'cancelado';
        const needsCancelSync = isCancelledInShopify && !isAlreadyCancelled;
        const hasItems = (existingOrder.cantidad || 0) > 0;

        if (
          order.updated_at &&
          existingRaw.updated_at &&
          order.updated_at === existingRaw.updated_at &&
          !hasPrefixToFix &&
          !needsCancelSync &&
          hasItems
        ) {
          continue;
        }

        const isWmsItemsEdited = existingOrder.wms_items_edited === true || existingRaw.wms_items_edited === true;
        const isWmsShippingEdited = existingOrder.wms_shipping_edited === true || existingRaw.wms_shipping_edited === true;
        const orderDataToUpdate = { ...orderDataToSave };

        // Preservar external_order_number existente si ya tiene prefijo o sufijo (ej. split -1),
        // actualizándolo a finalOrderNumber únicamente si había quedado sin prefijo (igual a order.name / orderNumber).
        if (currentExtNum && currentExtNum !== (order.name || '').toString().trim() && currentExtNum !== orderNumber) {
          delete orderDataToUpdate.external_order_number;
        }

        // Preservar siempre stock_descontado en pedidos existentes
        delete orderDataToUpdate.stock_descontado;

        // Preservar estado operacional en WMS:
        // Si NO está cancelado en Shopify, no sobrescribir status ni estado_wms.
        // Si SÍ está cancelado en Shopify, reflejar status='cancelado', pero SOLO pasar estado_wms a 'Cancelado'
        // si el pedido aún está en procesamiento (NUNCA si ya está En preparación, Pickeado o Despachado).
        if (!isCancelledInShopify) {
          delete orderDataToUpdate.status;
          delete orderDataToUpdate.estado_wms;
        } else {
          const currentWmsState = (existingOrder.estado_wms || 'En procesamiento').trim().toLowerCase();
          const estadosWmsProtegidos = ['en preparación', 'pickeado', 'listo para retiro', 'despachado', 'incidencia', 'entregado', 'retirado', 'archivado'];
          if (estadosWmsProtegidos.includes(currentWmsState)) {
            delete orderDataToUpdate.estado_wms;
          }
        }
        
        // Si el pedido fue editado manualmente en WMS, no sobrescribir SKU, item, cantidad ni total_value
        if (isWmsItemsEdited) {
          delete orderDataToUpdate.sku;
          delete orderDataToUpdate.item;
          delete orderDataToUpdate.cantidad;
          delete orderDataToUpdate.total_value;
        }

        // Si los datos de despacho fueron editados en WMS, no sobrescribir dirección ni datos de contacto
        if (isWmsShippingEdited) {
          delete orderDataToUpdate.customer_name;
          delete orderDataToUpdate.customer_email;
          delete orderDataToUpdate.customer_phone;
          delete orderDataToUpdate.shipping_address;
          delete orderDataToUpdate.shipping_city;
          delete orderDataToUpdate.shipping_complement;
        }

        // Preservar las banderas dentro de raw_shopify_data para que no se borren en sincronizaciones
        orderDataToUpdate.raw_shopify_data = {
          ...order,
          ...(existingRaw.admin_notes ? { admin_notes: existingRaw.admin_notes } : {}),
          ...(existingRaw.wms_admin_notes ? { wms_admin_notes: existingRaw.wms_admin_notes } : {}),
          ...(existingRaw.internal_notes ? { internal_notes: existingRaw.internal_notes } : {}),
          ...(existingRaw.wms_on_hold ? { wms_on_hold: existingRaw.wms_on_hold } : {}),
          ...(isWmsItemsEdited ? { wms_items_edited: true } : {}),
          ...(isWmsShippingEdited ? { wms_shipping_edited: true } : {}),
          ...((existingRaw.wms_custom_edited || isWmsItemsEdited || isWmsShippingEdited) ? { wms_custom_edited: true } : {}),
          ...(existingRaw.wms_manual_edits ? { wms_manual_edits: existingRaw.wms_manual_edits } : {})
        };

        // Actualizar pedido existente
        await supabase
          .from('orders')
          .update(orderDataToUpdate)
          .eq('id', existingOrder.id);
        orderId = existingOrder.id;
        console.log(`Actualizado pedido ${order.name}`);

        // Si el pedido ya está en preparación/despachado/etc, NO tocar sus order_items por seguridad operacional
        const currentWmsStatus = (existingOrder.estado_wms || '').toLowerCase().trim();
        const currentStatus = (existingOrder.status || '').toLowerCase().trim();
        const isProtectedStatus = ['en preparación', 'pickeado', 'despachado', 'entregado', 'retirado', 'cancelado', 'incidencia'].includes(currentWmsStatus) ||
                                  (currentWmsStatus === 'archivado' && (existingOrder.cantidad || 0) > 0) ||
                                  ['despachado', 'entregado', 'retirado', 'cancelado'].includes(currentStatus);

        if (isProtectedStatus) {
          console.log(`Omite sync de ítems para pedido ${order.name} (${existingOrder.estado_wms || existingOrder.status})`);
          continue;
        }
      } else {
        // Insertar nuevo pedido (lo ponemos como "para procesar" o su equivalente)
        const { data: newOrder, error: insErr } = await supabase
          .from('orders')
          .insert([{ 
            ...orderDataToSave, 
            status: orderDataToSave.status || 'para procesar',
            estado_wms: orderDataToSave.estado_wms || 'En procesamiento'
          }])
          .select('id')
          .single();
          
        if(insErr || !newOrder) {
            console.error(`Error al insertar pedido ${order.name}:`, insErr ? insErr.message : 'No se retornaron datos');
            continue;
        } else {
            orderId = newOrder.id;
            console.log(`Insertado nuevo pedido ${order.name}`);
        }
      }

      // Sincronizar ítems de la orden de forma inteligente (Smart Diffing)
      const { data: existingItems } = await supabase
        .from('order_items')
        .select('id, product_id, quantity, warehouse_id, is_gift, campaign_id, tag, products(sku, name)')
        .eq('order_id', orderId);

      // Cargar relaciones de packs del catálogo para desglosar packs de forma precisa
      const { data: packRelations } = await supabase
        .from('product_pack_items')
        .select('pack_product_id, member_product_id, quantity');
      
      const packMembersMap = new Map();
      (packRelations || []).forEach(pr => {
        if (!packMembersMap.has(pr.pack_product_id)) packMembersMap.set(pr.pack_product_id, []);
        packMembersMap.get(pr.pack_product_id).push({
          member_product_id: pr.member_product_id,
          quantity: pr.quantity || 1
        });
      });

      // Obtener reglas de ediciones manuales si el pedido fue modificado en WMS
      let manualEdits = { deleted_skus: [], added_skus: [], modified_quantities: {} };
      const existingRaw = existingOrder?.raw_shopify_data || {};
      const isItemsEdited = existingOrder?.wms_items_edited === true || existingRaw.wms_items_edited === true;

      if (isItemsEdited) {
        if (existingRaw.wms_manual_edits) {
          manualEdits = {
            deleted_skus: existingRaw.wms_manual_edits.deleted_skus || [],
            added_skus: existingRaw.wms_manual_edits.added_skus || [],
            modified_quantities: existingRaw.wms_manual_edits.modified_quantities || {}
          };
        } else {
          // Fallback: consultar order_audit_logs
          try {
            const { data: logs } = await supabase
              .from('order_audit_logs')
              .select('details')
              .eq('order_id', orderId)
              .eq('action', 'Modificación de Ítems')
              .order('created_at', { ascending: true });

            if (logs && logs.length > 0) {
              const delSet = new Set();
              const addSet = new Set();
              const modMap = {};

              logs.forEach(log => {
                (log.details?.changes || []).forEach(ch => {
                  const delMatch = ch.match(/Eliminado SKU\s+([^:]+)/i);
                  if (delMatch) {
                    const sku = delMatch[1].trim();
                    delSet.add(sku);
                    addSet.delete(sku);
                    delete modMap[sku];
                  }
                  const addMatch = ch.match(/Agregado SKU\s+([^:]+):.*\(Cant:\s*(\d+)\)/i);
                  if (addMatch) {
                    const sku = addMatch[1].trim();
                    const qty = parseInt(addMatch[2], 10);
                    addSet.add(sku);
                    delSet.delete(sku);
                    modMap[sku] = qty;
                  }
                  const modMatch = ch.match(/Modificado SKU\s+([^:]+):.*de cantidad\s+\d+\s+a\s+(\d+)/i);
                  if (modMatch) {
                    const sku = modMatch[1].trim();
                    const qty = parseInt(modMatch[2], 10);
                    modMap[sku] = qty;
                  }
                });
              });

              manualEdits = {
                deleted_skus: Array.from(delSet),
                added_skus: Array.from(addSet),
                modified_quantities: modMap
              };
            }
          } catch (err) {
            console.warn(`Aviso leyendo audit logs para pedido ${order.name}:`, err.message);
          }
        }
      }

      const manualDeletedSet = new Set((manualEdits.deleted_skus || []).map(s => s.trim().toLowerCase()));
      const manualAddedSet = new Set((manualEdits.added_skus || []).map(s => s.trim().toLowerCase()));
      const manualQtyBySkuLower = new Map();
      for (const [mSku, mQty] of Object.entries(manualEdits.modified_quantities || {})) {
        const key = String(mSku || '').trim().toLowerCase();
        const qtyNum = Number(mQty);
        if (key && Number.isFinite(qtyNum) && qtyNum > 0) {
          manualQtyBySkuLower.set(key, qtyNum);
        }
      }
      const appliedManualPackKeys = new Set();

      // 1. Calcular el desglose total de productos físicos esperados para la orden
      const expectedQuantities = new Map(); // product_id -> total_quantity
      const productManualCandidates = new Map(); // product_id -> Set<string> (skus/variant_ids normalizados)
      const registerProductCandidates = (prodId, candidates) => {
        if (!productManualCandidates.has(prodId)) productManualCandidates.set(prodId, new Set());
        const set = productManualCandidates.get(prodId);
        candidates.forEach(c => {
          const norm = String(c || '').trim().toLowerCase();
          if (norm) set.add(norm);
        });
      };
      const lineItems = order.line_items || [];

      for (const item of lineItems) {
        const rawEffectiveQty = item.current_quantity !== undefined ? item.current_quantity : item.quantity;
        if (rawEffectiveQty <= 0) {
          console.log(`[Shopify Sync] Omitiendo ítem SKU ${item.sku} porque fue eliminado en Shopify (cant: 0).`);
          continue;
        }

        const fallbackSku = item.variant_id ? String(item.variant_id) : (item.id ? String(item.id) : 'NO-SKU');
        const rawSku = (item.sku || fallbackSku).trim();
        const cleanSku = rawSku.replace(/\s+/g, '');
        const upperSku = cleanSku.toUpperCase();
        const mappedSku = skuMap[rawSku] || skuMap[cleanSku] || skuMap[upperSku] || rawSku;
        const eqMult = skuMultMap[rawSku] || skuMultMap[cleanSku] || skuMultMap[upperSku] || 1;
        const eqMasterProdId = skuProdIdMap[rawSku] || skuProdIdMap[cleanSku] || skuProdIdMap[upperSku] || null;
        let effectiveQty = rawEffectiveQty * eqMult;
        const hasEquivalence = !!(skuMap[rawSku] || skuMap[cleanSku] || skuMap[upperSku]);
        const searchSku = mappedSku || fallbackSku;

        // Omitir si fue eliminado manualmente en WMS
        const searchLower = searchSku.toLowerCase();
        const rawLower = rawSku.toLowerCase();
        const cleanLower = cleanSku.toLowerCase();
        const varLower = (item.variant_id ? String(item.variant_id) : '').toLowerCase();
        if (manualDeletedSet.has(searchLower) || manualDeletedSet.has(rawLower) || manualDeletedSet.has(cleanLower) || (varLower && manualDeletedSet.has(varLower))) {
          console.log(`[Shopify Sync] Omitiendo SKU ${searchSku} (${item.title}) por protección de eliminación manual en WMS.`);
          continue;
        }

        let product = null;
        if (eqMasterProdId) {
          const { data: prodById } = await supabase.from('products')
            .select('id, sku, is_pack, barcode_wms, description')
            .eq('id', eqMasterProdId)
            .eq('comercio', integration.comercio)
            .maybeSingle();
          if (prodById) product = prodById;
        }

        // Buscar producto en catálogo por comercio y sku (exacto con espacios o versión sin espacios)
        if (!product) {
          const productSkuCandidates = Array.from(new Set([
            searchSku,
            searchSku.replace(/\s+/g, '')
          ].filter(Boolean)));

          const { data: foundProducts } = await supabase.from('products')
            .select('id, sku, is_pack, barcode_wms, description')
            .in('sku', productSkuCandidates)
            .eq('comercio', integration.comercio);

          if (foundProducts && foundProducts.length > 0) {
            product =
              foundProducts.find(p => p.barcode_wms && p.sku === searchSku) ||
              foundProducts.find(p => p.barcode_wms) ||
              foundProducts.find(p => p.sku === searchSku && !(p.description || '').startsWith('Creado automáticamente')) ||
              foundProducts.find(p => p.sku === searchSku) ||
              foundProducts[0];
          }
        }

        if (!product && searchSku) {
          const { data: ilikeProd } = await supabase.from('products')
            .select('id, sku, is_pack, barcode_wms, description')
            .eq('comercio', integration.comercio)
            .ilike('sku', searchSku)
            .limit(1)
            .maybeSingle();
          if (ilikeProd) product = ilikeProd;
        }

        // Auto-crear producto si no existe
        if (!product) {
          const targetSku = hasEquivalence ? mappedSku : (rawSku || fallbackSku);
          const { data: newProd, error: prodErr } = await supabase
            .from('products')
            .insert([{
              merchant_id: integration.merchant_id,
              comercio: integration.comercio,
              sku: targetSku,
              name: `${item.title}${item.variant_title && item.variant_title !== 'Default Title' ? ' - ' + item.variant_title : ''}`,
              price: item.price ? parseFloat(item.price) : 0,
              description: 'Creado automáticamente desde sincronización de Shopify' + (hasEquivalence ? ` (Equivalencia de SKU: ${rawSku})` : ''),
              status: 'active'
            }])
            .select('id, sku, is_pack')
            .single();

          if (!prodErr && newProd) {
            product = newProd;
          } else {
            console.error(`Error auto-creando producto SKU ${targetSku}:`, prodErr ? prodErr.message : 'Error desconocido');
          }
        }

        if (product) {
          const packMembers = packMembersMap.get(product.id);
          if (product.is_pack && packMembers && packMembers.length > 0) {
            const packCandidates = [product.sku, searchLower, rawLower, cleanLower, varLower]
              .map(c => String(c || '').trim().toLowerCase())
              .filter(Boolean);
            const matchedPackKey = packCandidates.find(k => manualQtyBySkuLower.has(k));
            let packQty = effectiveQty;
            if (matchedPackKey) {
              if (appliedManualPackKeys.has(matchedPackKey)) {
                continue;
              }
              appliedManualPackKeys.add(matchedPackKey);
              packQty = manualQtyBySkuLower.get(matchedPackKey);
              console.log(`[Shopify Sync] Pack SKU ${searchSku} mantiene cantidad manual WMS (${packQty})`);
            }
            for (const pm of packMembers) {
              const currentQty = expectedQuantities.get(pm.member_product_id) || 0;
              expectedQuantities.set(pm.member_product_id, currentQty + (packQty * pm.quantity));
            }
          } else {
            const currentQty = expectedQuantities.get(product.id) || 0;
            expectedQuantities.set(product.id, currentQty + effectiveQty);
            registerProductCandidates(product.id, [product.sku, searchSku, rawSku, cleanSku, varLower]);
          }
        }
      }

      // Aplicar overrides manuales de WMS una sola vez por producto consolidado (evita multiplicar si Shopify trae N líneas del mismo SKU)
      if (manualQtyBySkuLower.size > 0 || manualDeletedSet.size > 0) {
        const missingCandidateProdIds = Array.from(expectedQuantities.keys()).filter(pid => !productManualCandidates.has(pid));
        if (missingCandidateProdIds.length > 0) {
          const { data: memberProds } = await supabase
            .from('products')
            .select('id, sku')
            .in('id', missingCandidateProdIds);
          (memberProds || []).forEach(mp => {
            if (mp?.id && mp?.sku) registerProductCandidates(mp.id, [mp.sku]);
          });
        }

        for (const [prodId, shopifyQty] of Array.from(expectedQuantities.entries())) {
          const candidates = Array.from(productManualCandidates.get(prodId) || []);
          const matchedDel = candidates.find(k => manualDeletedSet.has(k));
          if (matchedDel) {
            expectedQuantities.delete(prodId);
            console.log(`[Shopify Sync] Omitiendo producto consolidado (${matchedDel}) por protección de eliminación manual en WMS.`);
            continue;
          }
          const matchedManualKey = candidates.find(k => manualQtyBySkuLower.has(k));
          if (matchedManualKey) {
            const mQty = manualQtyBySkuLower.get(matchedManualKey);
            expectedQuantities.set(prodId, mQty);
            if (mQty !== shopifyQty) {
              console.log(`[Shopify Sync] SKU ${matchedManualKey.toUpperCase()} mantiene cantidad manual WMS (${mQty}) en lugar de Shopify (${shopifyQty})`);
            }
          }
        }
      }

      // Preservar productos agregados manualmente en WMS que no vienen en Shopify
      // (excluyendo regalos automáticos de campañas para no eliminarlos ni mezclarlos con ítems comprados)
      const existingByProduct = new Map(); // product_id -> Array<existingItem>
      const existingGiftItems = [];
      (existingItems || []).forEach(i => {
        if (i.is_gift || i.campaign_id || i.tag === 'Campaña') {
          existingGiftItems.push(i);
          return;
        }
        if (!existingByProduct.has(i.product_id)) existingByProduct.set(i.product_id, []);
        existingByProduct.get(i.product_id).push(i);
      });

      for (const [prodId, rows] of existingByProduct.entries()) {
        const pSku = (rows[0]?.products?.sku || "").trim().toLowerCase();
        if (manualAddedSet.has(pSku) && !expectedQuantities.has(prodId)) {
          const manualQty = manualQtyBySkuLower.get(pSku) ?? manualEdits.modified_quantities[rows[0]?.products?.sku] ?? rows[0]?.quantity ?? 1;
          expectedQuantities.set(prodId, manualQty);
          console.log(`[Shopify Sync] Preservando SKU ${rows[0]?.products?.sku} por haber sido agregado manualmente en WMS.`);
        }
      }

      // 2. Conciliar contra existingItems consolidando duplicados
      let hasTriggeredCampaignEval = false;
      for (const [prodId, expQty] of expectedQuantities.entries()) {
        const rows = existingByProduct.get(prodId) || [];
        if (rows.length === 0) {
          // No existe, insertar
          await supabase.from('order_items').insert([{
            order_id: orderId,
            product_id: prodId,
            warehouse_id: warehouseId,
            quantity: expQty
          }]);
          hasTriggeredCampaignEval = true;
        } else {
          // Si existe una o más filas, mantener solo la primera con la cantidad total esperada y eliminar duplicados
          // Si el pedido aún no tiene ítems de campaña evaluados, tocar la primera fila para disparar evaluate_campaign_rules()
          const primaryRow = rows[0];
          const shouldTouchForCampaigns = existingGiftItems.length === 0 && !hasTriggeredCampaignEval;
          if (primaryRow.quantity !== expQty || (warehouseId && primaryRow.warehouse_id !== warehouseId) || shouldTouchForCampaigns) {
            await supabase.from('order_items').update({
              quantity: expQty,
              warehouse_id: warehouseId || primaryRow.warehouse_id
            }).eq('id', primaryRow.id);
            hasTriggeredCampaignEval = true;
          }
          if (rows.length > 1) {
            for (let k = 1; k < rows.length; k++) {
              await supabase.from('order_items').delete().eq('id', rows[k].id);
            }
          }
        }
      }

      // 3. Eliminar productos en la BD que ya no están en expectedQuantities
      for (const [prodId, rows] of existingByProduct.entries()) {
        if (!expectedQuantities.has(prodId)) {
          for (const r of rows) {
            await supabase.from('order_items').delete().eq('id', r.id);
          }
        }
      }

      // Si los regalos de campaña existentes no tenían bodega asignada, asegurar su warehouse_id
      if (warehouseId && existingGiftItems.length > 0 && expectedQuantities.size > 0) {
        for (const giftRow of existingGiftItems) {
          if (!giftRow.warehouse_id) {
            await supabase.from('order_items').update({ warehouse_id: warehouseId }).eq('id', giftRow.id);
          }
        }
      }

      let totalUpdatedUnits = 0;
      for (const qty of expectedQuantities.values()) {
        totalUpdatedUnits += qty;
      }
      if (!existingOrder || existingOrder.cantidad !== totalUpdatedUnits) {
        await supabase
          .from('orders')
          .update({ cantidad: totalUpdatedUnits })
          .eq('id', orderId);
      }
    }
  } catch (error) {
    console.error(`Error sincronizando pedidos para ${integration.shop_url}:`, error.message);
    throw error;
  }
}

async function syncProducts(integration) {
  console.log('--> Extrayendo productos...');

  let url = `https://${integration.shop_url}/admin/api/2024-04/products.json?limit=250`;
  const seenSkus = new Set();
  const productsToUpsert = [];
  const orphanVariantIdsToClean = [];
  let pageCount = 0;

  try {
    while (url) {
      pageCount++;
      console.log(`[Shopify Product Sync] Cargando página ${pageCount}...`);
      let response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-Shopify-Access-Token': integration.access_token,
          'Content-Type': 'application/json'
        }
      });

      if (response.status === 401 && integration.refresh_token) {
        console.warn(`[Shopify Sync] HTTP 401 recibido en syncProducts, renovando token...`);
        integration.access_token = await getValidShopifyToken(integration, true);
        response = await fetch(url, {
          method: 'GET',
          headers: {
            'X-Shopify-Access-Token': integration.access_token,
            'Content-Type': 'application/json'
          }
        });
      }

      if (!response.ok) {
        throw new Error(`Error en Shopify API: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const products = data.products || [];
      console.log(`Se encontraron ${products.length} productos base en la página ${pageCount}.`);

      for (const product of products) {
        // Intentar obtener la imagen principal del producto
        let imageUrl = null;
        if (product.image && product.image.src) {
          imageUrl = product.image.src;
        } else if (product.images && product.images.length > 0) {
          imageUrl = product.images[0].src;
        }

        for (const variant of product.variants) {
          const rawSku = (variant.sku || '').trim();
          const variantIdStr = variant.id ? String(variant.id) : '';
          let cleanSku = rawSku || variantIdStr;
          if (!cleanSku) continue;

          // Si la variante tiene SKU real asignado, marcar el ID de variante para limpieza de registros provisionales
          if (rawSku && variantIdStr && rawSku !== variantIdStr) {
            orphanVariantIdsToClean.push(variantIdStr);
          }

          const upperSku = cleanSku.toUpperCase();
          if (seenSkus.has(upperSku)) {
            let suffixIndex = 1;
            let newSku = `${cleanSku}-DUP-${suffixIndex}`;
            while (seenSkus.has(newSku.toUpperCase())) {
              suffixIndex++;
              newSku = `${cleanSku}-DUP-${suffixIndex}`;
            }
            cleanSku = newSku;
          }
          seenSkus.add(cleanSku.toUpperCase());

          // Si la variante tiene una imagen específica, la usamos, si no usamos la del producto principal
          let varImageUrl = imageUrl;
          if (product.images && variant.image_id) {
            const matchedImg = product.images.find(img => img.id === variant.image_id);
            if (matchedImg && matchedImg.src) {
              varImageUrl = matchedImg.src;
            }
          }

          productsToUpsert.push({
            comercio: integration.comercio,
            platform: 'Shopify',
            sku: cleanSku,
            name: `${product.title}${variant.title !== 'Default Title' ? ' - ' + variant.title : ''}`,
            image_url: varImageUrl,
            status: product.status,
            price: parseFloat(variant.price) || 0,
            barcode: variant.barcode || null
          });
        }
      }

      // Revisar encabezado Link para la siguiente página
      const linkHeader = response.headers.get('link');
      url = null;
      if (linkHeader) {
        const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        if (nextMatch) {
          url = nextMatch[1];
        }
      }
    }

    // Limpiar huérfanos con SKU de ID de variante previo
    if (orphanVariantIdsToClean.length > 0) {
      console.log(`Verificando y limpiando posibles SKUs provisionales huérfanos (${orphanVariantIdsToClean.length})...`);
      for (let i = 0; i < orphanVariantIdsToClean.length; i += 100) {
        const chunk = orphanVariantIdsToClean.slice(i, i + 100);
        await supabase
          .from('synced_products')
          .delete()
          .eq('comercio', integration.comercio)
          .eq('platform', 'Shopify')
          .in('sku', chunk);

        const { data: ghosts } = await supabase
          .from('products')
          .select('id, sku')
          .eq('comercio', integration.comercio)
          .in('sku', chunk);

        if (ghosts && ghosts.length > 0) {
          const ghostIds = ghosts.map(g => g.id);
          const { data: invs } = await supabase
            .from('inventory')
            .select('product_id, quantity')
            .in('product_id', ghostIds);

          const stockMap = new Map();
          (invs || []).forEach(inv => {
            stockMap.set(inv.product_id, (stockMap.get(inv.product_id) || 0) + (inv.quantity || 0));
          });

          const idsToDelete = ghostIds.filter(id => (stockMap.get(id) || 0) <= 0);
          if (idsToDelete.length > 0) {
            await supabase.from('inventory').delete().in('product_id', idsToDelete);
            await supabase.from('products').delete().in('id', idsToDelete);
            console.log(`   🧹 Limpiados ${idsToDelete.length} productos huérfanos con SKU provisional en products.`);
          }
        }
      }
    }

    if (productsToUpsert.length > 0) {
      const batchSize = 500;
      for (let i = 0; i < productsToUpsert.length; i += batchSize) {
        const batch = productsToUpsert.slice(i, i + batchSize);
        const { error: upsertErr } = await supabase
          .from('synced_products')
          .upsert(batch, { onConflict: 'comercio,platform,sku' });

        if (upsertErr) throw upsertErr;
      }
      console.log(`Se han sincronizado ${productsToUpsert.length} variantes en synced_products.`);

      if (integration.comercio) {
        const { data: missingImgProds } = await supabase
          .from('products')
          .select('id, sku')
          .eq('comercio', integration.comercio)
          .or('image_url.is.null,image_url.eq.');
        if (missingImgProds && missingImgProds.length > 0) {
          const imgMap = new Map();
          productsToUpsert.forEach(sp => {
            if (sp.sku && sp.image_url) imgMap.set(String(sp.sku).trim().toUpperCase(), sp.image_url);
          });
          for (const mp of missingImgProds) {
            const foundUrl = imgMap.get(String(mp.sku || '').trim().toUpperCase());
            if (foundUrl) {
              await supabase.from('products').update({ image_url: foundUrl }).eq('id', mp.id);
            }
          }
        }
      }
    }

  } catch (error) {
    console.error(`Error sincronizando productos para ${integration.shop_url}:`, error.message);
    throw error;
  }
}

// Ejecutar el script
syncShopifyData();
