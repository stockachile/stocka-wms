const { createClient } = require('@supabase/supabase-js');

// ==========================================
// CONFIGURACIÓN DE SUPABASE
// ==========================================
// TODO: Reemplaza estas variables con tus datos de Supabase
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // Usamos la key de servicio para poder hacer bypass al RLS desde el backend

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: La variable de entorno SUPABASE_SERVICE_ROLE_KEY no está configurada.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
        raw_shopify_data: order // GUARDAMOS EL PAYLOAD COMPLETO AQUI
      };

      if (existingOrder) {
        // Actualizar pedido existente
        await supabase
          .from('orders')
          .update(orderDataToSave)
          .eq('id', existingOrder.id);
        console.log(`Actualizado pedido ${order.name}`);
      } else {
        // Insertar nuevo pedido (lo ponemos como "para procesar" o su equivalente)
        const { error: insErr } = await supabase
          .from('orders')
          .insert([{ ...orderDataToSave, status: 'para procesar' }]);
          
        if(insErr) {
            console.error(`Error al insertar pedido ${order.name}:`, insErr);
        } else {
            console.log(`Insertado nuevo pedido ${order.name}`);
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

    for (const product of products) {
        // Iteramos por las variantes (ya que en Shopify las variantes son los SKUs reales)
        for (const variant of product.variants) {
            
            // Verificamos si la variante (SKU) ya existe de forma global por merchant_id
            const { data: existingProduct } = await supabase
                .from('products')
                .select('id')
                .eq('merchant_id', integration.merchant_id)
                .eq('sku', variant.sku || variant.id.toString())
                .maybeSingle();

            const productDataToSave = {
                merchant_id: integration.merchant_id,
                comercio: integration.comercio,
                sku: variant.sku || variant.id.toString(), // Si no tiene SKU, usamos el ID como fallback
                name: `${product.title} ${variant.title !== 'Default Title' ? '- ' + variant.title : ''}`,
                description: product.body_html,
                barcode: variant.barcode,
                price: variant.price,
                weight: variant.weight,
                shopify_product_id: product.id.toString(),
                shopify_variant_id: variant.id.toString(),
                raw_shopify_data: variant // GUARDAMOS TODO PARA DESCARTAR DESPUES
            };

            if (existingProduct) {
                await supabase.from('products').update(productDataToSave).eq('id', existingProduct.id);
                console.log(`Actualizado SKU ${productDataToSave.sku}`);
            } else {
                const { error: insErr } = await supabase.from('products').insert([productDataToSave]);
                if(insErr) console.error(`Error al insertar SKU ${productDataToSave.sku}:`, insErr);
                else console.log(`Insertado nuevo SKU ${productDataToSave.sku}`);
            }
        }
    }
  } catch (error) {
    console.error(`Error sincronizando productos para ${integration.shop_url}:`, error.message);
  }
}

// Ejecutar el script
syncShopifyData();
