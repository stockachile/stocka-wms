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

// Renueva de forma proactiva el token de acceso de Shopify usando el refresh token
async function getValidShopifyToken(integration) {
  if (!integration.refresh_token) {
    return integration.access_token;
  }

  console.log(`[Shopify Sync] Renovando token de acceso para ${integration.shop_url}...`);
  const tokenUrl = `https://${integration.shop_url}/admin/oauth/access_token`;
  try {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: integration.refresh_token
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[Shopify Sync] Error al renovar token de Shopify: ${res.status} - ${errorText}`);
      return integration.access_token;
    }

    const data = await res.json();
    console.log(`[Shopify Sync] Token renovado con éxito.`);

    await supabase
      .from('merchant_integrations')
      .update({
        access_token: data.access_token,
        refresh_token: data.refresh_token
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

  for (const integration of integrations) {
    console.log(`\n================================`);
    console.log(`Procesando tienda: ${integration.shop_url}`);
    console.log(`Merchant ID: ${integration.merchant_id}`);
    console.log(`================================`);

    // Renovar token si es necesario
    const accessToken = await getValidShopifyToken(integration);
    integration.access_token = accessToken;

    // 2. Extraer y Guardar Pedidos (Orders)
    await syncOrders(integration);
    
    // 3. Extraer y Guardar Productos (Opcional por ahora, pero recomendado)
    await syncProducts(integration);
  }

  console.log('\nSincronización finalizada.');
}

async function syncOrders(integration) {
  console.log('--> Extrayendo pedidos...');
  const url = `https://${integration.shop_url}/admin/api/2024-04/orders.json?status=any`;

  // Cargar primera bodega asignada al comerciante
  const { data: whRelation } = await supabase
    .from('merchants_warehouses')
    .select('warehouse_id')
    .eq('merchant_id', integration.merchant_id)
    .limit(1)
    .maybeSingle();
  const warehouseId = whRelation?.warehouse_id || null;

  // Cargar equivalencias de SKU
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
      equivalences.filter(e => e.platform === 'Shopify').forEach(e => {
        if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
      });
    }
  } catch (err) {
    console.error('⚠️ Error al cargar equivalencias de SKU:', err.message);
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': integration.access_token,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Error en Shopify API: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const orders = data.orders;
    console.log(`Se encontraron ${orders.length} pedidos.`);

    for (const order of orders) {
      // Intentar buscar si el pedido ya existe en nuestra BD
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('id, comercio')
        .eq('merchant_id', integration.merchant_id)
        .eq('external_order_number', order.name)
        .eq('external_platform', 'Shopify')
        .maybeSingle();

      const orderDataToSave = {
        merchant_id: integration.merchant_id,
        comercio: integration.comercio,
        external_order_number: order.name, // Ej: #1001
        external_platform: 'Shopify',
        payment_status: order.financial_status,
        total_value: order.current_total_price,
        customer_email: order.contact_email || order.email,
        customer_phone: order.shipping_address?.phone,
        customer_name: order.shipping_address ? `${order.shipping_address.first_name} ${order.shipping_address.last_name}` : '',
        shipping_address: order.shipping_address?.address1,
        shipping_city: order.shipping_address?.city,
        shipping_complement: order.shipping_address?.address2,
        shipping_method: order.shipping_lines && order.shipping_lines.length > 0 ? order.shipping_lines[0].title : null,
        raw_shopify_data: order, // GUARDAMOS EL PAYLOAD COMPLETO AQUI
        created_at: new Date(order.created_at).toISOString()
      };

      let orderId;
      if (existingOrder) {
        // Actualizar pedido existente
        await supabase
          .from('orders')
          .update(orderDataToSave)
          .eq('id', existingOrder.id);
        orderId = existingOrder.id;
        console.log(`Actualizado pedido ${order.name}`);
      } else {
        // Insertar nuevo pedido (lo ponemos como "para procesar" o su equivalente)
        const { data: newOrder, error: insErr } = await supabase
          .from('orders')
          .insert([{ ...orderDataToSave, status: 'para procesar' }])
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

      // Sincronizar ítems de la orden
      await supabase.from('order_items').delete().eq('order_id', orderId);
      const lineItems = order.line_items || [];
      for (const item of lineItems) {
        let product = null;
        let cleanSku = (item.sku || "").trim().replace(/\s+/g, '');
        let mappedSku = skuMap[cleanSku] || cleanSku;
        let hasEquivalence = !!skuMap[cleanSku];

        // Buscar producto en catálogo
        let query = supabase.from('products')
          .select('id')
          .eq('sku', mappedSku)
          .eq('comercio', integration.comercio);

        const { data: foundProduct } = await query.maybeSingle();
        product = foundProduct;

        // Auto-crear producto si no existe
        if (!product) {
          const targetSku = hasEquivalence ? mappedSku : (item.sku || item.variant_id.toString());
          const { data: newProd, error: prodErr } = await supabase
            .from('products')
            .insert([{
              merchant_id: integration.merchant_id,
              comercio: integration.comercio,
              sku: targetSku,
              name: `${item.title}${item.variant_title && item.variant_title !== 'Default Title' ? ' - ' + item.variant_title : ''}`,
              price: item.price ? parseFloat(item.price) : 0,
              description: 'Creado automáticamente desde sincronización de Shopify' + (hasEquivalence ? ` (Equivalencia de SKU: ${cleanSku})` : ''),
              status: 'active'
            }])
            .select('id')
            .single();

          if (!prodErr && newProd) {
            product = newProd;
          } else {
            console.error(`Error auto-creando producto SKU ${targetSku}:`, prodErr ? prodErr.message : 'Error desconocido');
          }
        }

        if (product) {
          const { error: itemErr } = await supabase
            .from('order_items')
            .insert([{
              order_id: orderId,
              product_id: product.id,
              warehouse_id: warehouseId,
              quantity: item.quantity
            }]);

          if (itemErr) {
            console.error(`Error insertando item SKU ${item.sku} en order_items:`, itemErr.message);
          }
        }
      }
    }
  } catch (error) {
    console.error(`Error sincronizando pedidos para ${integration.shop_url}:`, error.message);
  }
}

async function syncProducts(integration) {
  console.log('--> Extrayendo productos...');

  const url = `https://${integration.shop_url}/admin/api/2024-04/products.json`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': integration.access_token,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Error en Shopify API: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const products = data.products;
    console.log(`Se encontraron ${products.length} productos base.`);

    const productsToUpsert = [];
    for (const product of products) {
      for (const variant of product.variants) {
        let variantSku = variant.sku || variant.id.toString();
        let cleanSku = variantSku.trim();
        if (!cleanSku) continue;

        productsToUpsert.push({
          comercio: integration.comercio,
          platform: 'Shopify',
          sku: cleanSku,
          name: `${product.title}${variant.title !== 'Default Title' ? ' - ' + variant.title : ''}`
        });
      }
    }

    if (productsToUpsert.length > 0) {
      const { error: upsertErr } = await supabase
        .from('synced_products')
        .upsert(productsToUpsert, { onConflict: 'comercio,platform,sku' });

      if (upsertErr) throw upsertErr;
      console.log(`Se han sincronizado ${productsToUpsert.length} variantes en synced_products.`);
    }

  } catch (error) {
    console.error(`Error sincronizando productos para ${integration.shop_url}:`, error.message);
  }
}

// Ejecutar el script
syncShopifyData();
