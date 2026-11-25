

function extractTiendanubeCustomerName(order) {
  const addr = order.shipping_address;
  let name = '';
  if (addr) {
    if (addr.name && addr.name.trim()) {
      name = addr.name.trim();
    } else if (addr.recipient_name && addr.recipient_name.trim()) {
      name = addr.recipient_name.trim();
    } else {
      const combined = `${addr.first_name || ''} ${addr.last_name || ''}`.trim();
      if (combined) name = combined;
    }
  }

  if (!name) {
    if (order.contact_name && order.contact_name.trim()) {
      name = order.contact_name.trim();
    } else if (order.customer?.name && order.customer.name.trim()) {
      name = order.customer.name.trim();
    } else {
      const custCombined = `${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`.trim();
      if (custCombined) name = custCombined;
    }
  }

  if (!name && order.billing_address) {
    if (typeof order.billing_address === 'object' && order.billing_address.name && order.billing_address.name.trim()) {
      name = order.billing_address.name.trim();
    }
  }

  return name || 'Cliente Tiendanube';
}

function extractTiendanubeName(rawName, fallback = 'Producto Tiendanube') {
  if (!rawName) return fallback;
  if (typeof rawName === 'string') return rawName.trim();
  if (typeof rawName === 'object') {
    return rawName.es || rawName.pt || Object.values(rawName)[0] || fallback;
  }
  return String(rawName);
}

function extractTiendanubeVariantValues(variantValues) {
  if (!variantValues) return [];
  const parts = [];
  if (Array.isArray(variantValues)) {
    for (const item of variantValues) {
      if (!item) continue;
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (trimmed) parts.push(trimmed);
      } else if (typeof item === 'object') {
        const val = item.es || item.pt || item.en || Object.values(item)[0];
        if (val && typeof val === 'string') {
          const trimmed = val.trim();
          if (trimmed) parts.push(trimmed);
        }
      }
    }
  } else if (typeof variantValues === 'object') {
    for (const k of Object.keys(variantValues)) {
      const item = variantValues[k];
      if (!item) continue;
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (trimmed) parts.push(trimmed);
      } else if (typeof item === 'object') {
        const val = item.es || item.pt || item.en || Object.values(item)[0];
        if (val && typeof val === 'string') {
          const trimmed = val.trim();
          if (trimmed) parts.push(trimmed);
        }
      }
    }
  } else if (typeof variantValues === 'string') {
    const trimmed = variantValues.trim();
    if (trimmed) parts.push(trimmed);
  }
  return parts;
}
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
async function syncTiendanubeData() {
  console.log('🔄 Iniciando sincronización con Tiendanube...');

  try {
    // 1. Obtener todas las integraciones activas de Tiendanube en Supabase
    const { data: integrations, error: intError } = await supabase
      .from('merchant_integrations')
      .select('*')
      .eq('platform', 'Tiendanube')
      .eq('is_active', true);

    if (intError) {
      console.error('❌ Error al obtener integraciones desde Supabase:', intError.message);
      return;
    }

    if (!integrations || integrations.length === 0) {
      console.log('ℹ️ No hay integraciones activas de Tiendanube configuradas.');
      return;
    }

    // 2. Procesar cada integración de forma independiente
    for (const integration of integrations) {
      if (process.env.TARGET_COMERCIO && (!integration.comercio || integration.comercio.trim().toUpperCase() !== process.env.TARGET_COMERCIO.trim().toUpperCase())) {
        continue;
      }
      console.log(`\n========================================`);
      console.log(`👤 Merchant ID: ${integration.merchant_id}`);
      console.log(`🔌 Plataforma: ${integration.platform}`);
      console.log(`🔗 Store ID / Shop URL: ${integration.shop_url}`);
      console.log(`========================================`);

      // Resolver dinámicamente el merchant_id real usando productos del comercio
      integration.original_merchant_id = integration.merchant_id;
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
        await syncMerchantTiendanube(integration);
        await supabase
          .from('merchant_integrations')
          .update({
            last_sync_at: new Date().toISOString(),
            last_sync_error: null
          })
          .eq('id', integration.id);
      } catch (merchantErr) {
        console.error(`❌ Error sincronizando Tiendanube para ${integration.comercio}:`, merchantErr.message);
        await supabase
          .from('merchant_integrations')
          .update({
            last_sync_at: new Date().toISOString(),
            last_sync_error: merchantErr.message
          })
          .eq('id', integration.id);
      }
    }

    console.log('\n🎉 Sincronización Tiendanube finalizada.');
  } catch (err) {
    console.error('❌ Error general durante la sincronización:', err.message);
  }
}

/**
 * Sincroniza productos y pedidos de una integración específica
 */
async function syncMerchantTiendanube(integration) {
  // A. Obtener Store ID (limpiar URL para extraer solo números si el usuario ingresó una URL)
  const storeId = integration.shop_url.trim().replace(/[^0-9]/g, '');
  if (!storeId) {
    console.error(`❌ Error para Merchant ${integration.merchant_id}: No se pudo determinar el Store ID de Tiendanube desde "${integration.shop_url}". Debe ser numérico.`);
    return;
  }

  const accessToken = integration.access_token.trim();
  if (!accessToken) {
    console.error(`❌ Error para Merchant ${integration.merchant_id}: Falta el Access Token de Tiendanube.`);
    return;
  }

  // B. Obtener bodega por defecto para el cliente (priorizando comercios_adicional_config)
  let warehouseId = null;
  if (integration.comercio) {
    const { data: adicCfg } = await supabase
      .from('comercios_adicional_config')
      .select('default_warehouse_id')
      .eq('comercio', integration.comercio)
      .maybeSingle();
    if (adicCfg?.default_warehouse_id) {
      warehouseId = adicCfg.default_warehouse_id;
    }
  }

  if (!warehouseId && integration.merchant_id) {
    const { data: whRel } = await supabase
      .from('merchants_warehouses')
      .select('warehouse_id')
      .eq('merchant_id', integration.merchant_id)
      .limit(1)
      .maybeSingle();

    if (whRel?.warehouse_id) {
      warehouseId = whRel.warehouse_id;
    }
  }

  if (!warehouseId) {
    // Buscar la primera bodega disponible como fallback
    const { data: defaultWh } = await supabase.from('warehouses').select('id').limit(1).maybeSingle();
    if (defaultWh) {
      warehouseId = defaultWh.id;
    }
  }

  if (!warehouseId) {
    console.error(`❌ Error para Merchant ${integration.merchant_id}: No hay ninguna bodega configurada en el WMS.`);
    return;
  }

  // C. Definir cabeceras obligatorias (Tiendanube exige User-Agent descriptivo)
  const headers = {
    'Authentication': `bearer ${accessToken}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'StockaWMS (integraciones@stocka.cl)'
  };

  // 0. Asegurar que los webhooks de pedidos y productos estén registrados en Tiendanube
  await ensureTiendanubeWebhooks(integration, storeId, headers);

  // 1. Sincronizar Productos (ventana 2x/día para optimizar Disk IO; forzar con FORCE_PRODUCTS_SYNC=true)
  const nowUtc = new Date();
  const isScheduledCatalogWindow = (nowUtc.getUTCHours() === 6 || nowUtc.getUTCHours() === 18) && nowUtc.getUTCMinutes() < 30;
  const shouldSyncProducts =
    process.env.SKIP_PRODUCTS_SYNC !== 'true' &&
    (process.env.FORCE_PRODUCTS_SYNC === 'true' || !!process.env.TARGET_COMERCIO || isScheduledCatalogWindow);

  if (shouldSyncProducts) {
    await syncProducts(integration, storeId, headers);
  } else {
    console.log('⏭️ Omitiendo syncProducts en esta corrida (ventana de catálogo 2x/día para optimizar Disk IO).');
  }

  // 2. Sincronizar Pedidos (Orders)
  await syncOrders(integration, storeId, headers, warehouseId);
}

/**
 * Registra automáticamente en Tiendanube los webhooks de pedidos y productos hacia Supabase Edge Functions
 */
async function ensureTiendanubeWebhooks(integration, storeId, headers) {
  try {
    const webhookMerchantId = integration.original_merchant_id || integration.merchant_id;
    const comercioQuery = integration.comercio ? `&comercio=${encodeURIComponent(integration.comercio.trim())}` : '';
    const targetUrl = `${SUPABASE_URL}/functions/v1/tiendanube-webhook?merchant_id=${webhookMerchantId}${comercioQuery}`;
    const requiredEvents = ['order/created', 'order/updated', 'product/created', 'product/updated'];

    const listRes = await fetch(`https://api.tiendanube.com/v1/${storeId}/webhooks`, {
      method: 'GET',
      headers
    });

    if (!listRes.ok) {
      return;
    }

    const existingWebhooks = await listRes.json();
    const existingList = Array.isArray(existingWebhooks) ? existingWebhooks : [];

    for (const ev of requiredEvents) {
      const alreadyRegistered = existingList.some(
        w => w.event === ev && typeof w.url === 'string' && w.url.includes('/functions/v1/tiendanube-webhook')
      );
      if (!alreadyRegistered) {
        const createRes = await fetch(`https://api.tiendanube.com/v1/${storeId}/webhooks`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ event: ev, url: targetUrl })
        });
        if (createRes.ok) {
          console.log(`🔔 Webhook Tiendanube registrado automáticamente: ${ev}`);
        }
      }
    }
  } catch (err) {
    console.warn(`⚠️ Aviso al verificar/registrar webhooks de Tiendanube (${storeId}):`, err.message);
  }
}

/**
 * Sincroniza los productos desde Tiendanube
 */
async function syncProducts(integration, storeId, headers) {
  console.log('--> Extrayendo productos desde Tiendanube...');

  try {
    let page = 1;
    const allProducts = [];
    while (true) {
      const url = `https://api.tiendanube.com/v1/${storeId}/products?per_page=100&page=${page}`;
      const response = await fetch(url, { method: 'GET', headers });
      if (!response.ok) {
        throw new Error(`Error en API Tiendanube Productos: Status ${response.status} ${response.statusText}`);
      }
      const products = await response.json();
      if (!products || products.length === 0) break;
      allProducts.push(...products);
      if (products.length < 100) break;
      page++;
    }

    console.log(`Se encontraron ${allProducts.length} productos base.`);

    const seenSkus = new Set();
    const productsToUpsert = [];
    const masterVariantsData = [];

    for (const product of allProducts) {
      const mainImageUrl = product.images && product.images.length > 0 ? product.images[0].src : null;
      const status = product.published ? 'published' : 'hidden';

      for (const variant of (product.variants || [])) {
        let variantSku = variant.sku || '';
        let cleanSku = variantSku.trim().replace(/\s+/g, '');
        if (!cleanSku) {
          cleanSku = `TN-${product.id}-${variant.id}`;
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

        let imageUrl = mainImageUrl;
        if (variant.image_id && product.images) {
          const matchedImg = product.images.find(img => img.id === variant.image_id);
          if (matchedImg && matchedImg.src) {
            imageUrl = matchedImg.src;
          }
        }

        const variantNameParts = extractTiendanubeVariantValues(variant.values);
        const productName = extractTiendanubeName(product.name, 'Producto sin nombre');
        const finalName = variantNameParts.length > 0 ? `${productName} - ${variantNameParts.join(' / ')}` : productName;
        const cleanBarcode = variant.barcode ? String(variant.barcode).trim() : null;
        const variantPrice = parseFloat(variant.price) || 0;

        productsToUpsert.push({
          comercio: integration.comercio,
          platform: 'Tiendanube',
          sku: cleanSku,
          name: finalName,
          image_url: imageUrl,
          status: status,
          price: variantPrice,
          barcode: cleanBarcode
        });

        const largo = parseFloat(variant.depth) || 10;
        const ancho = parseFloat(variant.width) || 10;
        const alto = parseFloat(variant.height) || 10;
        const volumen = (largo * ancho * alto) / 1000000 || 0.0001;
        const weightKg = parseFloat(variant.weight) || null;

        masterVariantsData.push({
          sku: cleanSku,
          name: finalName,
          price: variantPrice,
          barcode: cleanBarcode,
          image_url: imageUrl,
          largo,
          ancho,
          alto,
          volumen,
          weight: weightKg,
          tiendanube_product_id: String(product.id),
          tiendanube_variant_id: String(variant.id),
          raw_tiendanube_data: variant
        });
      }
    }

    if (productsToUpsert.length > 0) {
      for (let i = 0; i < productsToUpsert.length; i += 100) {
        const batch = productsToUpsert.slice(i, i + 100);
        const { error: upsertErr } = await supabase
          .from('synced_products')
          .upsert(batch, { onConflict: 'comercio,platform,sku' });

        if (upsertErr) throw upsertErr;
      }
      console.log(`📥 Se han sincronizado ${productsToUpsert.length} variantes de Tiendanube en synced_products.`);

      // Rellenar image_url en productos existentes del catálogo maestro (products) que aún no tengan foto
      if (integration.comercio) {
        for (const item of masterVariantsData) {
          if (!item.image_url) continue;
          await supabase
            .from('products')
            .update({ image_url: item.image_url })
            .eq('comercio', integration.comercio)
            .ilike('sku', item.sku)
            .or('image_url.is.null,image_url.eq.');
        }
      }

      // Verificar si Tiendanube es la plataforma principal del comercio (o única activa) para auto-crear nuevos productos en el catálogo maestro (products)
      // En Catálogo V2 (catalog_v2_enabled = true), las integraciones externas solo sincronizan a synced_products (bandeja unificada) y nunca auto-crean en products.
      let shouldAutoCreateInMaster = true;
      try {
        const { data: v2Cfg } = await supabase
          .from('comercios_adicional_config')
          .select('catalog_v2_enabled')
          .eq('comercio', integration.comercio)
          .maybeSingle();
        if (v2Cfg?.catalog_v2_enabled === true) {
          shouldAutoCreateInMaster = false;
        }
      } catch (_) {}

      if (shouldAutoCreateInMaster) {
        try {
          const { data: activeInts } = await supabase
            .from('merchant_integrations')
            .select('platform, is_main')
            .eq('comercio', integration.comercio)
            .eq('is_active', true);

          const salesInts = (activeInts || []).filter(i => i.platform !== 'Optiroute');
          const explicitMain = salesInts.find(i => i.is_main);
          if (explicitMain && explicitMain.platform !== 'Tiendanube') {
            shouldAutoCreateInMaster = false;
          }
        } catch (err) {
          console.warn('⚠️ Aviso al verificar plataforma principal para auto-creación:', err.message);
        }
      }

      if (shouldAutoCreateInMaster && integration.comercio) {
        // Obtener todos los SKUs existentes en products para este comercio (paginado)
        const existingMasterSkus = new Set();
        let fromIdx = 0;
        const pageSize = 1000;
        while (true) {
          const { data: existingBatch, error: exErr } = await supabase
            .from('products')
            .select('sku')
            .eq('comercio', integration.comercio)
            .range(fromIdx, fromIdx + pageSize - 1);

          if (exErr || !existingBatch || existingBatch.length === 0) break;
          existingBatch.forEach(p => {
            if (p.sku) existingMasterSkus.add(String(p.sku).trim().toUpperCase());
          });
          if (existingBatch.length < pageSize) break;
          fromIdx += pageSize;
        }

        // Considerar equivalencias de SKU configuradas para evitar duplicar productos ya mapeados
        const skuMap = {};
        try {
          const { data: equivalences } = await supabase
            .from('sku_equivalences')
            .select('platform_sku, master_sku, platform')
            .eq('comercio', integration.comercio);

          if (equivalences) {
            equivalences.filter(e => e.platform === 'Todas' || e.platform === 'Tiendanube').forEach(e => {
              if (e.platform_sku && e.master_sku) {
                skuMap[e.platform_sku.trim().replace(/\s+/g, '').toUpperCase()] = e.master_sku.trim().toUpperCase();
              }
            });
          }
        } catch (_) {}

        const newMasterProducts = [];
        for (const item of masterVariantsData) {
          const upperSku = item.sku.toUpperCase();
          const mappedUpperSku = skuMap[upperSku] || upperSku;
          if (!existingMasterSkus.has(upperSku) && !existingMasterSkus.has(mappedUpperSku)) {
            existingMasterSkus.add(upperSku);
            newMasterProducts.push({
              merchant_id: integration.merchant_id,
              comercio: integration.comercio,
              sku: item.sku,
              name: item.name,
              price: item.price,
              barcode: item.barcode,
              image_url: item.image_url,
              volumen: item.volumen,
              largo: item.largo,
              ancho: item.ancho,
              alto: item.alto,
              weight: item.weight,
              status: 'active',
              description: 'Importado automáticamente de Tiendanube',
              tiendanube_product_id: item.tiendanube_product_id,
              tiendanube_variant_id: item.tiendanube_variant_id,
              raw_tiendanube_data: item.raw_tiendanube_data
            });
          }
        }

        if (newMasterProducts.length > 0) {
          for (let i = 0; i < newMasterProducts.length; i += 100) {
            const batch = newMasterProducts.slice(i, i + 100);
            const { error: masterInsErr } = await supabase
              .from('products')
              .upsert(batch, { onConflict: 'comercio,sku', ignoreDuplicates: true });

            if (masterInsErr) {
              console.error('❌ Error al auto-insertar nuevos productos de Tiendanube en products:', masterInsErr.message);
            }
          }
          console.log(`✨ Se crearon automáticamente ${newMasterProducts.length} nuevos productos de Tiendanube en el catálogo maestro (products).`);
        }
      }
    }
  } catch (error) {
    console.error(`❌ Error sincronizando productos para Tiendanube (${storeId}):`, error.message);
    throw error;
  }
}

/**
 * Sincroniza los pedidos desde Tiendanube
 */
async function syncOrders(integration, storeId, headers, warehouseId) {
  console.log('--> Extrayendo pedidos desde Tiendanube...');

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
        const platConfig = (adicionalConfig.plat_siglas_config || {})['Tiendanube'];
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
      console.log(`ℹ️ Configuración de prefijo para Tiendanube: Sigla="${siglaComercio}", HasPlatConfig=${hasPlatConfig}, AgregarPrefijo=${agregarPrefijo}, PrefijoOrigen="${prefijoOrigen}"`);
    } catch (err) {
      console.error('⚠️ Error al consultar configuración de sigla para el comercio:', err.message);
    }
  }
  
  // Cargar equivalencias de SKU para este comercio (con soporte de multiplicador)
  const skuMap = {};
  const skuMultMap = {};
  try {
    let { data: equivalences, error: eqErr } = await supabase
      .from('sku_equivalences')
      .select('platform_sku, master_sku, platform, quantity_multiplier')
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
          const clean = e.platform_sku.trim().replace(/\s+/g, '');
          const mult = Math.max(1, Number(e.quantity_multiplier || 1));
          skuMap[clean] = e.master_sku.trim();
          skuMap[clean.toUpperCase()] = e.master_sku.trim();
          skuMultMap[clean] = mult;
          skuMultMap[clean.toUpperCase()] = mult;
        }
      });
      equivalences.filter(e => e.platform === 'Tiendanube').forEach(e => {
        if (e.platform_sku && e.master_sku) {
          const clean = e.platform_sku.trim().replace(/\s+/g, '');
          const mult = Math.max(1, Number(e.quantity_multiplier || 1));
          skuMap[clean] = e.master_sku.trim();
          skuMap[clean.toUpperCase()] = e.master_sku.trim();
          skuMultMap[clean] = mult;
          skuMultMap[clean.toUpperCase()] = mult;
        }
      });
    }
  } catch (err) {
    console.error('⚠️ Error al cargar equivalencias de SKU:', err.message);
  }

  // Traer los pedidos recientes
  const url = `https://api.tiendanube.com/v1/${storeId}/orders?per_page=50`;

  try {
    const response = await fetch(url, { method: 'GET', headers });
    if (!response.ok) {
      if (response.status === 404) {
        try {
          const errData = await response.clone().json();
          if (errData && errData.description === 'Last page is 0') {
            console.log('ℹ️ No hay pedidos registrados en la tienda (la API retornó Last page is 0).');
            return;
          }
        } catch (e) {
          // Si no es JSON o no tiene la descripción, continuar al error regular
        }
      }
      throw new Error(`Error en API Tiendanube Pedidos: Status ${response.status} ${response.statusText}`);
    }

    const orders = await response.json();
    console.log(`Se encontraron ${orders.length} pedidos.`);

    for (const order of orders) {
      const orderId = order.id.toString();
      let orderNumber = (order.number ? order.number.toString() : orderId).trim();

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
      
      // Mapeo de estados en Tiendanube
      // status: open, closed, cancelled
      // payment_status: pending, paid, unpaid, abandoned, voided, refunded
      const statusName = order.status; 
      const paymentStatus = order.payment_status;

      console.log(`\nProcesando pedido Tiendanube ID: ${finalOrderNumber} (Estado: ${statusName}, Pago: ${paymentStatus})`);

      const isDelivered = order.shipping_status === 'delivered';
      const isCancelled = statusName === 'cancelled' || ['voided', 'refunded'].includes(paymentStatus);

      // Verificar si el pedido ya existe en el WMS
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('id, status, estado_wms, raw_tiendanube_data, total_value, sku, item, cantidad, customer_name, customer_email, customer_phone, shipping_address, shipping_city, shipping_complement')
        .eq('comercio', integration.comercio)
        .in('external_order_number', [orderNumber, finalOrderNumber])
        .limit(1)
        .maybeSingle();

      // Mapear campos planos de la orden
      const itemNames = [];
      const itemQuantities = {};
      const itemDetailsBySku = {};
      
      for (const item of (order.products || [])) {
        let sku = item.sku || `TN-${item.product_id}${item.variant_id ? '-' + item.variant_id : ''}`;
        sku = String(sku).trim().replace(/\s+/g, '');
        // Aplicar equivalencia de SKU y multiplicador
        const mappedSku = skuMap[sku] || skuMap[sku.toUpperCase()] || sku;
        const eqMult = skuMultMap[sku] || skuMultMap[sku.toUpperCase()] || 1;
        const qty = Number(item.quantity || 0) * eqMult;
        if (qty <= 0) continue;

        itemQuantities[mappedSku] = (itemQuantities[mappedSku] || 0) + qty;
        if (!itemDetailsBySku[mappedSku]) {
          itemDetailsBySku[mappedSku] = item;
        }

        const name = extractTiendanubeName(item.name, 'Producto');
        if (name && !itemNames.includes(name)) {
          itemNames.push(name);
        }
      }

      const flatSku = Object.keys(itemQuantities).join(', ');
      const flatItemName = itemNames.join(', ');
      const flatQuantity = Object.values(itemQuantities).reduce((sum, qty) => sum + qty, 0);
      const totalValue = Number(order.total || 0);

      // Direcciones en Tiendanube
      const addr = order.shipping_address;
      let addressString = 'No especificada';
      let complementString = '';
      if (addr) {
        addressString = `${addr.address || ''} ${addr.number || ''}`.trim() || 'No especificada';
        complementString = [addr.floor, addr.locality, addr.province, addr.zipcode].filter(Boolean).join(', ');
      }

      const customerName = extractTiendanubeCustomerName(order);

      const orderDataToSave = {
        merchant_id: integration.merchant_id,
        comercio: integration.comercio,
        external_order_number: finalOrderNumber,
        external_platform: 'Tiendanube',
        payment_status: paymentStatus === 'paid' ? 'PAID' : 'PENDING',
        total_value: totalValue,
        customer_email: order.contact_email || order.customer?.email || 'no-email@tiendanube.com',
        customer_phone: addr?.phone || order.contact_phone || 'No especificado',
        customer_name: customerName,
        shipping_address: addressString,
        shipping_city: addr?.city || 'No especificada',
        shipping_complement: complementString,
        shipping_method: order.shipping_option || 'Por definir',
        raw_tiendanube_data: order,
        origen: 'Tiendanube',
        item: flatItemName,
        cantidad: flatQuantity,
        sku: flatSku
      };

      let localOrderId = null;
      let shouldReconcileItems = false;

      if (existingOrder) {
        if (existingOrder.estado_wms === 'Entregado') {
          continue;
        }
        const existingRaw = existingOrder.raw_tiendanube_data || {};
        const isWmsItemsEdited = existingOrder.wms_items_edited === true || existingRaw.wms_items_edited === true;
        const isWmsShippingEdited = existingOrder.wms_shipping_edited === true || existingRaw.wms_shipping_edited === true;
        const currentWmsState = (existingOrder.estado_wms || 'En procesamiento').trim().toLowerCase();
        const estadosWmsProtegidos = ['en preparación', 'pickeado', 'listo para retiro', 'despachado', 'incidencia', 'entregado', 'retirado', 'archivado'];
        const isProtectedState = estadosWmsProtegidos.includes(currentWmsState);

        const orderDataToUpdate = { ...orderDataToSave };

        if (isWmsItemsEdited || isProtectedState) {
          delete orderDataToUpdate.sku;
          delete orderDataToUpdate.item;
          delete orderDataToUpdate.cantidad;
          delete orderDataToUpdate.total_value;
        }

        if (isWmsShippingEdited || isProtectedState) {
          delete orderDataToUpdate.customer_name;
          delete orderDataToUpdate.customer_email;
          delete orderDataToUpdate.customer_phone;
          delete orderDataToUpdate.shipping_address;
          delete orderDataToUpdate.shipping_city;
          delete orderDataToUpdate.shipping_complement;
        }

        orderDataToUpdate.raw_tiendanube_data = {
          ...order,
          ...(existingRaw.line_items ? { line_items: existingRaw.line_items } : {}),
          ...(existingRaw.wms_manual_edits ? { wms_manual_edits: existingRaw.wms_manual_edits } : {}),
          ...(isWmsItemsEdited ? { wms_items_edited: true } : {}),
          ...(isWmsShippingEdited ? { wms_shipping_edited: true } : {}),
          ...((existingRaw.wms_custom_edited || isWmsItemsEdited || isWmsShippingEdited) ? { wms_custom_edited: true } : {})
        };

        // Si el pedido se canceló, actualizar estado en WMS (protegiendo estados operacionales avanzados)
        if (isCancelled && existingOrder.status !== 'cancelado') {
          const cancelUpdate = { ...orderDataToUpdate, status: 'cancelado' };
          if (!isProtectedState) {
            cancelUpdate.estado_wms = 'Cancelado';
          }
          await supabase
            .from('orders')
            .update(cancelUpdate)
            .eq('id', existingOrder.id);
          console.log(`🚫 Pedido ${finalOrderNumber} cancelado en Tiendanube. Actualizado en WMS (estado_wms: ${cancelUpdate.estado_wms || existingOrder.estado_wms}).`);
        } else {
          // Actualizar datos generales manteniendo el estado WMS actual
          await supabase
            .from('orders')
            .update(orderDataToUpdate)
            .eq('id', existingOrder.id);
          console.log(`📝 Actualizado pedido local ${finalOrderNumber}`);
        }
        localOrderId = existingOrder.id;

        // Reconciliación / auto-sanación de ítems:
        // - Si el pedido está activo en 'En procesamiento' y no fue editado manualmente en WMS, reconciliar cantidades y eliminar duplicados.
        // - Si está en estado protegido o cancelado, solo insertar si quedó vacío sin ningún ítem.
        if (!isWmsItemsEdited) {
          if (!isCancelled && !isProtectedState) {
            shouldReconcileItems = true;
          } else {
            const { data: existingItems, error: itemsCheckErr } = await supabase
              .from('order_items')
              .select('id')
              .eq('order_id', localOrderId);

            if (!itemsCheckErr && (!existingItems || existingItems.length === 0)) {
              console.log(`ℹ️ Pedido existente ${finalOrderNumber} no tiene ítems registrados. Se ingresarán.`);
              shouldReconcileItems = true;
            }
          }
        }
      } else {
        // Insertar pedido en WMS respetando su estado en Tiendanube
        let initialStatus = 'para procesar';
        let initialEstadoWms = 'En procesamiento';

        if (isCancelled) {
          initialStatus = 'cancelado';
          initialEstadoWms = 'Cancelado';
        } else if (isDelivered || statusName === 'closed') {
          initialStatus = 'despachado';
          initialEstadoWms = 'Despachado';
        }

        const { data: newOrder, error: insErr } = await supabase
          .from('orders')
          .insert([{ ...orderDataToSave, status: initialStatus, estado_wms: initialEstadoWms }])
          .select('id')
          .single();

        if (insErr) {
          console.error(`❌ Error al insertar pedido local ${finalOrderNumber}:`, insErr.message);
          continue;
        }

        console.log(`📥 Insertado nuevo pedido local ${finalOrderNumber} con status "${initialStatus}" / estado_wms "${initialEstadoWms}"`);
        localOrderId = newOrder.id;
        shouldReconcileItems = true;
      }

      // Reconciliar de forma idempotente y segura ante concurrencia los ítems en order_items
      if (localOrderId && shouldReconcileItems) {
        const expectedQuantities = new Map();

        for (const [sku, qty] of Object.entries(itemQuantities)) {
          const itemDetail = itemDetailsBySku[sku];
          const itemImageUrl = itemDetail?.image?.src || (typeof itemDetail?.image === 'string' ? itemDetail.image : null);

          // Buscar producto en la base de datos por comercio y sku
          let { data: product } = await supabase
            .from('products')
            .select('id, is_pack, image_url')
            .eq('sku', sku)
            .eq('comercio', integration.comercio)
            .limit(1)
            .maybeSingle();

          if (!product) {
            const { data: ilikeProd } = await supabase
              .from('products')
              .select('id, is_pack, image_url')
              .eq('comercio', integration.comercio)
              .ilike('sku', sku)
              .limit(1)
              .maybeSingle();
            if (ilikeProd) product = ilikeProd;
          }

          if (product && !product.image_url && itemImageUrl) {
            await supabase.from('products').update({ image_url: itemImageUrl }).eq('id', product.id);
            product.image_url = itemImageUrl;
          }

          if (!product) {
            const pName = extractTiendanubeName(itemDetail?.name, 'Producto Tiendanube ' + sku);
            const productPrice = Number(itemDetail?.price || 0);

            const { data: newProd, error: prodErr } = await supabase
              .from('products')
              .insert([{
                merchant_id: integration.merchant_id,
                comercio: integration.comercio,
                sku: sku,
                name: pName,
                price: productPrice,
                image_url: itemImageUrl,
                description: 'Creado automáticamente desde integración de Tiendanube (al procesar pedido)'
              }])
              .select('id, is_pack, image_url')
              .single();

            if (!prodErr && newProd) {
              console.log(`   * Creado automáticamente producto para SKU: ${sku} ("${pName}")`);
              product = newProd;
            } else {
              const { data: retryProd } = await supabase
                .from('products')
                .select('id, is_pack')
                .eq('comercio', integration.comercio)
                .ilike('sku', sku)
                .limit(1)
                .maybeSingle();
              if (retryProd) {
                product = retryProd;
              } else {
                console.error(`   ❌ Error al crear producto para SKU ${sku}:`, prodErr?.message);
              }
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
                  const cur = expectedQuantities.get(pm.member_product_id) || 0;
                  expectedQuantities.set(pm.member_product_id, cur + Number(pm.quantity || 1) * Number(qty));
                }
              } else {
                const cur = expectedQuantities.get(product.id) || 0;
                expectedQuantities.set(product.id, cur + Number(qty));
              }
            } else {
              const cur = expectedQuantities.get(product.id) || 0;
              expectedQuantities.set(product.id, cur + Number(qty));
            }
          } else {
            console.warn(`   ⚠️ SKU ${sku} no encontrado en base de datos. No se pudo registrar en la orden.`);
          }
        }

        const { data: existingItems } = await supabase
          .from('order_items')
          .select('id, product_id, quantity, warehouse_id, is_gift, campaign_id, tag')
          .eq('order_id', localOrderId);

        const existingByProduct = new Map();
        for (const item of (existingItems || [])) {
          if (item.is_gift || item.campaign_id || item.tag === 'Campaña' || item.tag === 'Eliminado') continue;
          if (!existingByProduct.has(item.product_id)) {
            existingByProduct.set(item.product_id, []);
          }
          existingByProduct.get(item.product_id).push(item);
        }

        for (const [prodId, expQty] of expectedQuantities.entries()) {
          const rows = existingByProduct.get(prodId) || [];

          if (rows.length > 0) {
            const primaryRow = rows[0];
            const targetWh = primaryRow.warehouse_id || warehouseId;
            if (Number(primaryRow.quantity) !== expQty || (!primaryRow.warehouse_id && warehouseId)) {
              const prevQty = primaryRow.quantity;
              await supabase
                .from('order_items')
                .update({ quantity: expQty, warehouse_id: targetWh })
                .eq('id', primaryRow.id);
              if (Number(prevQty) !== expQty) {
                console.log(`   🔧 Corregida cantidad de ítem product_id ${prodId}: ${prevQty} -> ${expQty}`);
              }
            }
            if (rows.length > 1) {
              for (let k = 1; k < rows.length; k++) {
                await supabase.from('order_items').delete().eq('id', rows[k].id);
                console.log(`   🧹 Eliminada fila duplicada de order_items (${rows[k].id}) para product_id ${prodId}`);
              }
            }
          } else {
            const { error: itemErr } = await supabase
              .from('order_items')
              .insert([{
                order_id: localOrderId,
                product_id: prodId,
                warehouse_id: warehouseId,
                quantity: expQty
              }]);

            if (itemErr) {
              console.error(`   ❌ Error al registrar ítem product_id ${prodId}:`, itemErr.message);
            } else {
              console.log(`   + Registrado ítem product_id ${prodId} x ${expQty}`);
            }
          }
        }

        // Eliminar ítems regulares que ya no existan en la orden de Tiendanube
        for (const [prodId, rows] of existingByProduct.entries()) {
          if (!expectedQuantities.has(prodId)) {
            for (const r of rows) {
              await supabase.from('order_items').delete().eq('id', r.id);
              console.log(`   ➖ Eliminado ítem removido en Tiendanube (${r.id})`);
            }
          }
        }

        // Verificación post-escritura ante concurrencia simultánea con webhook y trigger expand_pack_order_items()
        const { data: postRows } = await supabase
          .from('order_items')
          .select('id, product_id, quantity, is_gift, campaign_id, tag')
          .eq('order_id', localOrderId);

        const postByProduct = new Map();
        for (const r of (postRows || [])) {
          if (r.is_gift || r.campaign_id || r.tag === 'Campaña' || r.tag === 'Eliminado') continue;
          if (!postByProduct.has(r.product_id)) postByProduct.set(r.product_id, []);
          postByProduct.get(r.product_id).push(r);
        }

        for (const [prodId, rows] of postByProduct.entries()) {
          const expQty = expectedQuantities.get(prodId);
          if (expQty === undefined) {
            for (const r of rows) {
              await supabase.from('order_items').delete().eq('id', r.id);
            }
          } else {
            if (Number(rows[0].quantity) !== expQty) {
              await supabase.from('order_items').update({ quantity: expQty }).eq('id', rows[0].id);
            }
            for (let k = 1; k < rows.length; k++) {
              await supabase.from('order_items').delete().eq('id', rows[k].id);
            }
          }
        }
      }
    }
  } catch (error) {
    console.error(`❌ Error sincronizando pedidos para Tiendanube (${storeId}):`, error.message);
    throw error;
  }
}

// Ejecutar script si se corre directamente
if (require.main === module) {
  syncTiendanubeData();
}
