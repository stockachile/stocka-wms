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

    // 2. Procesar cada integración de forma independiente
    for (const integration of integrations) {
      console.log(`\n========================================`);
      console.log(`👤 Merchant ID: ${integration.merchant_id}`);
      console.log(`🔌 Plataforma: ${integration.platform}`);
      console.log(`🔗 URL Tienda: ${integration.shop_url}`);
      console.log(`========================================`);

      await syncMerchantWooCommerce(integration);
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
    console.error(`❌ Error para Merchant ${integration.merchant_id}: Formato de access_token inválido. Debe ser un JSON conteniendo consumer_key y consumer_secret.`);
    return;
  }

  if (!consumerKey || !consumerSecret) {
    console.error(`❌ Error para Merchant ${integration.merchant_id}: Faltan consumer_key o consumer_secret en las credenciales guardadas.`);
    return;
  }

  // B. Obtener bodega por defecto para el cliente
  let warehouseId = null;
  const { data: whRel, error: whErr } = await supabase
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

  if (!warehouseId) {
    console.error(`❌ Error para Merchant ${integration.merchant_id}: No hay ninguna bodega configurada en el WMS.`);
    return;
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
    'Content-Type': 'application/json'
  };

  // 1. Sincronizar Productos primero (recomendado para mapear SKUs correctamente)
  await syncProducts(integration, baseUrl, headers);

  // 2. Sincronizar Pedidos (Orders)
  await syncOrders(integration, baseUrl, headers, warehouseId);
}

/**
 * Sincroniza los productos desde WooCommerce
 */
async function syncProducts(integration, baseUrl, headers) {
  console.log('--> Extrayendo productos desde WooCommerce...');
  const url = `${baseUrl}/wp-json/wc/v3/products?per_page=100`;

  try {
    const response = await fetch(url, { method: 'GET', headers });
    if (!response.ok) {
      throw new Error(`Error en API WooCommerce Productos: Status ${response.status} ${response.statusText}`);
    }

    const products = await response.json();
    console.log(`Se encontraron ${products.length} productos base.`);

    for (const product of products) {
      // WooCommerce soporta productos simples y variables
      if (product.type === 'variable') {
        console.log(`   Procesando producto variable: ${product.name} (ID: ${product.id}). Extrayendo variaciones...`);
        const varUrl = `${baseUrl}/wp-json/wc/v3/products/${product.id}/variations?per_page=100`;
        const varRes = await fetch(varUrl, { method: 'GET', headers });
        if (varRes.ok) {
          const variations = await varRes.json();
          for (const variation of variations) {
            await saveProductToDb(integration, product, variation);
          }
        } else {
          console.error(`   ❌ Error al extraer variaciones de producto ${product.id}`);
        }
      } else {
        // Producto simple
        await saveProductToDb(integration, product, null);
      }
    }
  } catch (error) {
    console.error(`❌ Error sincronizando productos para ${integration.shop_url}:`, error.message);
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

  const productDataToSave = {
    comercio: integration.comercio,
    platform: 'WooCommerce',
    sku: cleanSku,
    name: productName
  };

  const { error: insErr } = await supabase
    .from('synced_products')
    .upsert([productDataToSave], { onConflict: 'comercio,platform,sku' });

  if (insErr) {
    console.error(`   ❌ Error al sincronizar SKU ${cleanSku} en synced_products:`, insErr.message);
  } else {
    console.log(`   📥 Sincronizado SKU ${cleanSku} en synced_products`);
  }
}

/**
 * Sincroniza los pedidos desde WooCommerce
 */
async function syncOrders(integration, baseUrl, headers, warehouseId) {
  console.log('--> Extrayendo pedidos desde WooCommerce...');
  
  // Cargar equivalencias de SKU para este comercio
  const skuMap = {};
  try {
    const { data: equivalences } = await supabase
      .from('sku_equivalences')
      .select('platform_sku, master_sku, platform')
      .eq('comercio', integration.comercio);
    
    if (equivalences) {
      equivalences.filter(e => e.platform === 'Todas').forEach(e => {
        if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
      });
      equivalences.filter(e => e.platform === 'WooCommerce').forEach(e => {
        if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
      });
    }
  } catch (err) {
    console.error('⚠️ Error al cargar equivalencias de SKU:', err.message);
  }

  // Extraemos pedidos de cualquier estado para mantener el WMS actualizado, pero nos enfocamos en procesarlos.
  const url = `${baseUrl}/wp-json/wc/v3/orders?per_page=100`;

  try {
    const response = await fetch(url, { method: 'GET', headers });
    if (!response.ok) {
      throw new Error(`Error en API WooCommerce Pedidos: Status ${response.status} ${response.statusText}`);
    }

    const orders = await response.json();
    console.log(`Se encontraron ${orders.length} pedidos.`);

    for (const order of orders) {
      const orderId = order.id.toString();
      const orderNumber = order.number || orderId;
      const statusName = order.status; // e.g. processing, completed, cancelled, on-hold

      console.log(`\nProcesando pedido WooCommerce ID: ${orderNumber} (Estado actual: ${statusName})`);

      // Clasificación de estados
      const isDelivered = statusName === 'completed';
      const isCancelled = ['cancelled', 'failed', 'refunded'].includes(statusName);
      const isActive = !isDelivered && !isCancelled;

      // Verificar si el pedido ya existe en el WMS
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('id, status')
        .eq('merchant_id', integration.merchant_id)
        .eq('external_order_number', orderNumber)
        .maybeSingle();

      // Mapear campos planos de la orden
      const itemNames = [];
      const itemQuantities = {};
      
      for (const item of order.line_items) {
        let sku = item.sku || `WC-${item.product_id}${item.variation_id ? '-' + item.variation_id : ''}`;
        sku = sku.replace(/\s+/g, '');
        // Aplicar equivalencia de SKU
        let mappedSku = skuMap[sku] || sku;
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
        external_order_number: orderNumber,
        external_platform: 'WooCommerce',
        payment_status: order.date_paid ? 'PAID' : 'PENDING',
        total_value: totalValue,
        customer_email: order.billing?.email || 'no-email@woocommerce.cl',
        customer_phone: order.billing?.phone || 'No especificado',
        customer_name: `${order.billing?.first_name || ''} ${order.billing?.last_name || ''}`.trim() || 'Cliente WooCommerce',
        shipping_address: order.shipping?.address_1 || order.billing?.address_1 || 'No especificada',
        shipping_city: order.shipping?.city || order.billing?.city || 'No especificada',
        shipping_complement: [order.shipping?.address_2, order.shipping?.state, order.shipping?.postcode].filter(Boolean).join(', ') || '',
        raw_woocommerce_data: order,
        origen: 'WooCommerce',
        item: flatItemName,
        cantidad: flatQuantity,
        sku: flatSku
      };

      let localOrderId = null;
      let shouldInsertItems = false;

      if (existingOrder) {
        // Si el pedido se canceló en origen, actualizar su estado en WMS
        if (isCancelled && existingOrder.status !== 'cancelado') {
          await supabase
            .from('orders')
            .update({ ...orderDataToSave, status: 'cancelado' })
            .eq('id', existingOrder.id);
          console.log(`🚫 Pedido ${orderNumber} cancelado en WooCommerce. Actualizado en el WMS.`);
        } else {
          // Actualizar datos de pedido manteniendo el estado actual del WMS
          await supabase
            .from('orders')
            .update(orderDataToSave)
            .eq('id', existingOrder.id);
          console.log(`📝 Actualizado pedido local ${orderNumber}`);
        }
        localOrderId = existingOrder.id;

        // Auto-recuperación (Healer): Validar si ya tiene ítems guardados
        const { data: existingItems, error: itemsCheckErr } = await supabase
          .from('order_items')
          .select('id')
          .eq('order_id', localOrderId);

        if (!itemsCheckErr && (!existingItems || existingItems.length === 0)) {
          console.log(`ℹ️ Pedido existente ${orderNumber} no tiene ítems registrados. Se procederá a ingresarlos.`);
          shouldInsertItems = true;
        }
      } else if (isActive) {
        // Insertar nuevo pedido activo en WMS con estado 'para procesar'
        const { data: newOrder, error: insErr } = await supabase
          .from('orders')
          .insert([{ ...orderDataToSave, status: 'para procesar' }])
          .select('id')
          .single();

        if (insErr) {
          console.error(`❌ Error al insertar pedido local ${orderNumber}:`, insErr.message);
          continue;
        }

        console.log(`📥 Insertado nuevo pedido local ${orderNumber} con estado 'para procesar'`);
        localOrderId = newOrder.id;
        shouldInsertItems = true;
      } else {
        console.log(`ℹ️ Pedido ${orderNumber} ignorado por estar en estado final (cancelado/entregado) y no existir en WMS.`);
      }

      // Registrar ítems en order_items
      if (localOrderId && shouldInsertItems) {
        for (const [sku, qty] of Object.entries(itemQuantities)) {
          // Buscar producto en la base de datos
          let { data: product } = await supabase
            .from('products')
            .select('id')
            .eq('sku', sku)
            .eq('comercio', integration.comercio)
            .maybeSingle();

          if (!product) {
            // Buscar detalle del item original usando mapeo inverso
            const itemDetail = order.line_items.find(item => {
              let itemSku = item.sku || `WC-${item.product_id}${item.variation_id ? '-' + item.variation_id : ''}`;
              let cleanItemSku = itemSku.replace(/\s+/g, '');
              let mappedItemSku = skuMap[cleanItemSku] || cleanItemSku;
              return mappedItemSku === sku;
            });

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
                description: 'Creado automáticamente desde integración de WooCommerce (al procesar pedido)'
              }])
              .select('id')
              .single();

            if (!prodErr && newProd) {
              console.log(`   * Creado automáticamente producto para SKU: ${sku} ("${productName}")`);
              product = newProd;
            } else {
              console.error(`   ❌ Error al crear producto para SKU ${sku}:`, prodErr?.message);
            }
          }

          if (product) {
            const { error: itemErr } = await supabase
              .from('order_items')
              .insert([{
                order_id: localOrderId,
                product_id: product.id,
                warehouse_id: warehouseId,
                quantity: qty
              }]);

            if (itemErr) {
              console.error(`   ❌ Error al registrar ítem SKU ${sku} para la orden:`, itemErr.message);
            } else {
              console.log(`   + Registrado ítem: SKU ${sku} x ${qty} (Stock Reservado)`);
            }
          } else {
            console.warn(`   ⚠️ SKU ${sku} no encontrado en base de datos. No se pudo registrar en la orden.`);
          }
        }
      }
    }
  } catch (error) {
    console.error(`❌ Error sincronizando pedidos para ${integration.shop_url}:`, error.message);
  }
}

// Ejecutar script
syncWooCommerceData();
