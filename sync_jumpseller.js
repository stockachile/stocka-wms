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
async function syncJumpsellerData() {
  console.log('🔄 Iniciando sincronización con Jumpseller...');

  try {
    // 1. Obtener todas las integraciones activas de Jumpseller en Supabase
    const { data: integrations, error: intError } = await supabase
      .from('merchant_integrations')
      .select('*')
      .eq('platform', 'Jumpseller')
      .eq('is_active', true);

    if (intError) {
      console.error('❌ Error al obtener integraciones desde Supabase:', intError.message);
      return;
    }

    if (!integrations || integrations.length === 0) {
      console.log('ℹ️ No hay integraciones activas de Jumpseller configuradas.');
      return;
    }

    // 2. Procesar cada integración de forma independiente
    for (const integration of integrations) {
      console.log(`\n========================================`);
      console.log(`👤 Merchant ID: ${integration.merchant_id}`);
      console.log(`🔌 Plataforma: ${integration.platform}`);
      console.log(`🔗 URL Tienda: ${integration.shop_url}`);
      console.log(`========================================`);

      await syncMerchantJumpseller(integration);
    }

    console.log('\n🎉 Sincronización Jumpseller finalizada.');
  } catch (err) {
    console.error('❌ Error general durante la sincronización:', err.message);
  }
}

/**
 * Sincroniza productos y pedidos de una integración específica
 */
async function syncMerchantJumpseller(integration) {
  // A. Parsear credenciales desde el access_token
  let loginKey, authToken;
  try {
    const creds = JSON.parse(integration.access_token);
    loginKey = creds.login_key;
    authToken = creds.auth_token;
  } catch (e) {
    console.error(`❌ Error para Merchant ${integration.merchant_id}: Formato de access_token inválido. Debe ser un JSON conteniendo login_key y auth_token.`);
    return;
  }

  if (!loginKey || !authToken) {
    console.error(`❌ Error para Merchant ${integration.merchant_id}: Faltan login_key o auth_token en las credenciales guardadas.`);
    return;
  }

  // B. Obtener bodega por defecto para el cliente
  let warehouseId = null;
  const { data: whRel, error: whErr } = await supabase
    .from('merchants_warehouses')
    .select('warehouse_id')
    .eq('merchant_id', integration.merchant_id)
    .maybeSingle();

  if (whErr) {
    console.error('❌ Error al obtener bodega por defecto:', whErr.message);
  }
  
  warehouseId = whRel?.warehouse_id;
  if (!warehouseId) {
    console.warn('⚠️ Advertencia: No se encontró bodega por defecto asignada para este comercio. Se usará un valor nulo o se omitirá la inserción de ítems.');
  }

  const headers = {
    'X-LOGIN-KEY': loginKey,
    'X-AUTH-TOKEN': authToken,
    'Content-Type': 'application/json'
  };

  // C. Sincronizar Productos primero (para asegurar mapeos en órdenes)
  await syncProducts(integration, headers);

  // D. Sincronizar Pedidos
  await syncOrders(integration, headers, warehouseId);
}

/**
 * Sincroniza el catálogo de productos de Jumpseller
 */
async function syncProducts(integration, headers) {
  console.log('--> Extrayendo productos desde Jumpseller...');

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
      equivalences.filter(e => e.platform === 'Jumpseller').forEach(e => {
        if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
      });
    }
  } catch (err) {
    console.error('⚠️ Error al cargar equivalencias de SKU:', err.message);
  }

  // Obtenemos los productos de Jumpseller (límite máximo de 100 por API)
  const url = `https://api.jumpseller.com/v1/products.json?limit=100`;

  try {
    const response = await fetch(url, { method: 'GET', headers });
    if (!response.ok) {
      throw new Error(`Error en Jumpseller API: ${response.status} ${response.statusText}`);
    }

    const productsList = await response.json();
    console.log(`Se encontraron ${productsList.length} productos en Jumpseller.`);

    for (const item of productsList) {
      const p = item.product;

      // Un producto en Jumpseller puede o no tener variantes
      if (!p.variants || p.variants.length === 0) {
        let variantSku = p.sku || `JS-${p.id}`;
        let cleanSku = variantSku.trim().replace(/\s+/g, '');

        const productDataToSave = {
          comercio: integration.comercio,
          platform: 'Jumpseller',
          sku: cleanSku,
          name: p.name
        };

        const { error: insErr } = await supabase
          .from('synced_products')
          .upsert([productDataToSave], { onConflict: 'comercio,platform,sku' });

        if (insErr) console.error(`❌ Error al sincronizar SKU ${cleanSku} en synced_products:`, insErr.message);
        else console.log(`📥 Sincronizado SKU ${cleanSku} (Simple) en synced_products`);
      } else {
        // Si tiene variantes
        for (const variantWrapper of p.variants) {
          const v = variantWrapper.variant;
          let variantSku = v.sku || `JS-${p.id}-${v.id}`;
          let cleanSku = variantSku.trim().replace(/\s+/g, '');

          const productDataToSave = {
            comercio: integration.comercio,
            platform: 'Jumpseller',
            sku: cleanSku,
            name: `${p.name} - Variante ${v.id}`
          };

          const { error: insErr } = await supabase
            .from('synced_products')
            .upsert([productDataToSave], { onConflict: 'comercio,platform,sku' });

          if (insErr) console.error(`❌ Error al sincronizar SKU ${cleanSku} en synced_products:`, insErr.message);
          else console.log(`📥 Sincronizado SKU ${cleanSku} (Variante) en synced_products`);
        }
      }
    }
  } catch (error) {
    console.error(`❌ Error sincronizando productos para ${integration.shop_url}:`, error.message);
  }
}

/**
 * Sincroniza los pedidos de Jumpseller
 */
async function syncOrders(integration, headers, warehouseId) {
  console.log('--> Extrayendo pedidos desde Jumpseller...');

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
      equivalences.filter(e => e.platform === 'Jumpseller').forEach(e => {
        if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
      });
    }
  } catch (err) {
    console.error('⚠️ Error al cargar equivalencias de SKU:', err.message);
  }

  const url = `https://api.jumpseller.com/v1/orders.json?limit=50`;

  try {
    const response = await fetch(url, { method: 'GET', headers });
    if (!response.ok) {
      throw new Error(`Error en Jumpseller API Pedidos: ${response.status} ${response.statusText}`);
    }

    const ordersList = await response.json();
    console.log(`Se encontraron ${ordersList.length} pedidos.`);

    for (const item of ordersList) {
      const o = item.order;
      const orderNumber = `#JS-${o.id}`;
      const statusName = o.status; // 'Pending', 'Paid', 'Canceled', 'Abandoned', 'Open'

      console.log(`\nProcesando pedido Jumpseller ID: ${orderNumber} (Estado actual: ${statusName})`);

      // Clasificación de estados
      const isDelivered = o.shipment_status === 'shipped' || o.shipment_status === 'delivered';
      const isCancelled = ['Canceled', 'Abandoned', 'Open'].includes(statusName);
      const isActive = !isDelivered && !isCancelled;

      // Verificar si el pedido ya existe en el WMS
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('id, status')
        .eq('merchant_id', integration.merchant_id)
        .eq('external_order_number', orderNumber)
        .eq('external_platform', 'Jumpseller')
        .maybeSingle();

      // Mapear campos planos de la orden y cantidades de items
      const itemNames = [];
      const itemQuantities = {};

      if (o.products) {
        for (const op of o.products) {
          let sku = op.sku || `JS-${op.product_id}${op.variant_id ? '-' + op.variant_id : ''}`;
          sku = sku.trim().replace(/\s+/g, '');
          let mappedSku = skuMap[sku] || sku;

          itemQuantities[mappedSku] = (itemQuantities[mappedSku] || 0) + Number(op.quantity);
          if (op.name && !itemNames.includes(op.name)) {
            itemNames.push(op.name);
          }
        }
      }

      const flatSku = Object.keys(itemQuantities).join(', ');
      const flatItemName = itemNames.join(', ');
      const flatQuantity = Object.values(itemQuantities).reduce((sum, qty) => sum + qty, 0);
      const totalValue = Number(o.total || 0);

      const orderDataToSave = {
        merchant_id: integration.merchant_id,
        comercio: integration.comercio,
        external_order_number: orderNumber,
        external_platform: 'Jumpseller',
        payment_status: statusName === 'Paid' ? 'PAID' : 'PENDING',
        total_value: totalValue,
        customer_email: o.customer?.email || o.shipping_address?.email || o.billing_address?.email,
        customer_phone: o.customer?.phone || o.shipping_address?.phone || o.billing_address?.phone,
        customer_name: o.customer?.name || o.shipping_address?.name || o.billing_address?.name || 'Cliente Jumpseller',
        shipping_address: o.shipping_address?.address || o.billing_address?.address,
        shipping_city: o.shipping_address?.city || o.billing_address?.city,
        shipping_complement: o.shipping_address?.municipality || o.shipping_address?.region || '',
        raw_jumpseller_data: o,
        created_at: new Date(o.created_at).toISOString()
      };

      let localOrderId = null;
      let shouldInsertItems = false;

      if (existingOrder) {
        // Actualizar datos del pedido existente en el WMS
        await supabase
          .from('orders')
          .update(orderDataToSave)
          .eq('id', existingOrder.id);
        console.log(`📝 Actualizado pedido local ${orderNumber}`);
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
        console.log(`ℹ️ Pedido ${orderNumber} ignorado por estar en estado final (cancelado/entregado) y no existir en el WMS.`);
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
            const itemDetail = o.products.find(op => {
              let opSku = op.sku || `JS-${op.product_id}${op.variant_id ? '-' + op.variant_id : ''}`;
              let cleanItemSku = opSku.trim().replace(/\s+/g, '');
              let mappedItemSku = skuMap[cleanItemSku] || cleanItemSku;
              return mappedItemSku === sku;
            });

            // Auto-crear producto faltante en WMS
            const productName = itemDetail?.name || 'Producto Jumpseller ' + sku;
            const productPrice = Number(itemDetail?.price || 0);

            const { data: newProd, error: prodErr } = await supabase
              .from('products')
              .insert([{
                merchant_id: integration.merchant_id,
                comercio: integration.comercio,
                sku: sku,
                name: productName,
                price: productPrice,
                description: 'Creado automáticamente desde integración de Jumpseller (al procesar pedido)'
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

          if (product && warehouseId) {
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
            console.warn(`   ⚠️ SKU ${sku} no encontrado en base de datos o sin bodega por defecto. No se pudo registrar en la orden.`);
          }
        }
      }
    }
  } catch (error) {
    console.error(`❌ Error sincronizando pedidos para ${integration.shop_url}:`, error.message);
  }
}

// Ejecutar el script
syncJumpsellerData();
