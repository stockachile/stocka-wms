const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Parse .env manually
const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');

const env = {};
envContent.split('\n').forEach(line => {
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

const supabaseUrl = env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const COMERCIO_CONFIGS = {
  'RELAJARTE': { prefix: 'REL7' },
  'DORMILONES': { prefix: 'DOR550' },
  'BACK IN TIME': { prefix: 'BIT110' }
};

// Felipe Trujillo's Merchant ID
const merchantId = '7eb032ed-5717-426c-9dca-35fcdd48f0e8';

async function backfillCommerce(comercioName) {
  console.log(`\n=== Backfilling Shopify orders for ${comercioName} ===`);
  const config = COMERCIO_CONFIGS[comercioName];
  if (!config) {
    console.error(`No config for commerce ${comercioName}`);
    return;
  }

  // 1. Fetch integration details
  const { data: integrations, error: intError } = await supabase
    .from('merchant_integrations')
    .select('*')
    .eq('platform', 'Shopify')
    .eq('comercio', comercioName)
    .eq('is_active', true);

  if (intError || !integrations || integrations.length === 0) {
    console.error(`Active Shopify integration not found for ${comercioName}`);
    return;
  }

  const integration = integrations[0];
  const { shop_url, access_token } = integration;
  console.log(`Shop URL: ${shop_url}`);

  // 2. Fetch recent orders from Shopify
  let shopifyOrders = [];
  try {
    const response = await fetch(`https://${shop_url}/admin/api/2024-04/orders.json?status=any&created_at_min=2026-07-15T00:00:00-04:00&limit=100`, {
      headers: {
        "X-Shopify-Access-Token": access_token
      }
    });

    if (!response.ok) {
      console.log(`Shopify API error: ${response.status} ${response.statusText}`);
      const text = await response.text();
      console.log(`Response: ${text}`);
      return;
    }

    const data = await response.json();
    shopifyOrders = data.orders || [];
    console.log(`Fetched ${shopifyOrders.length} orders from Shopify since July 15th.`);
  } catch (err) {
    console.error(`Request to Shopify failed:`, err);
    return;
  }

  if (shopifyOrders.length === 0) {
    console.log("No orders to process.");
    return;
  }

  // 3. Fetch existing orders in DB to avoid duplicates
  const extNumbers = shopifyOrders.map(o => `${config.prefix}${o.order_number}`);
  const { data: existingDbOrders, error: dbErr } = await supabase
    .from('orders')
    .select('external_order_number')
    .in('external_order_number', extNumbers);

  if (dbErr) {
    console.error("Error checking existing orders in DB:", dbErr);
    return;
  }

  const existingSet = new Set(existingDbOrders.map(o => o.external_order_number));
  console.log(`Found ${existingSet.size} orders already present in database.`);

  const missingOrders = shopifyOrders.filter(o => !existingSet.has(`${config.prefix}${o.order_number}`));
  console.log(`Found ${missingOrders.length} missing orders that need to be imported.`);

  // 4. Import missing orders
  for (const o of missingOrders) {
    const extOrderNum = `${config.prefix}${o.order_number}`;
    console.log(`Importing order ${extOrderNum} (Shopify ID: ${o.id}, Created: ${o.created_at})...`);

    // Map shipping details
    const shipping = o.shipping_address || {};
    const billing = o.billing_address || {};
    const customerName = shipping.name || billing.name || `${o.customer?.first_name || ''} ${o.customer?.last_name || ''}`.trim() || 'Cliente Shopify';
    const customerPhone = shipping.phone || billing.phone || o.customer?.phone || o.phone || '';
    const customerEmail = o.email || o.contact_email || o.customer?.email || '';
    const shippingAddress = shipping.address1 || '';
    const shippingCity = shipping.city || '';
    const shippingComplement = shipping.address2 || '';
    const shippingMethod = o.shipping_lines?.[0]?.title || 'Envío Estándar';

    // Map WMS status
    let wmsStatus = 'para procesar';
    if (o.cancelled_at) {
      wmsStatus = 'cancelado';
    } else if (o.fulfillment_status === 'fulfilled') {
      wmsStatus = 'despachado';
    }

    const { data: newOrder, error: insertErr } = await supabase
      .from('orders')
      .insert([{
        merchant_id: merchantId,
        comercio: comercioName,
        external_order_number: extOrderNum,
        external_platform: 'Shopify',
        status: wmsStatus,
        estado_wms: wmsStatus === 'despachado' ? 'Despachado' : 'En procesamiento',
        created_at: o.created_at,
        total_value: parseFloat(o.total_price) || 0,
        payment_status: o.financial_status || 'pending',
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        shipping_address: shippingAddress,
        shipping_city: shippingCity,
        shipping_complement: shippingComplement,
        shipping_method: shippingMethod,
        raw_shopify_data: o,
        shopify_exported: false
      }])
      .select('id')
      .single();

    if (insertErr) {
      console.error(`Error inserting order ${extOrderNum}:`, insertErr);
      continue;
    }

    const orderId = newOrder.id;

    // 5. Import order items
    const lineItems = o.line_items || [];
    for (const item of lineItems) {
      const sku = (item.sku || item.variant_sku || '').trim();
      const qty = item.quantity || 1;
      console.log(`  - Item SKU: ${sku}, Qty: ${qty}`);

      // Look up product in database
      let productId = null;
      let warehouseId = 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09'; // Default warehouse
      
      if (sku) {
        const { data: products } = await supabase
          .from('products')
          .select('id')
          .eq('comercio', comercioName)
          .ilike('sku', sku)
          .limit(1);

        if (products && products.length > 0) {
          productId = products[0].id;
        } else {
          console.warn(`    WARNING: Product with SKU "${sku}" not found in catalog.`);
        }
      }

      // Insert order item
      const { error: itemErr } = await supabase
        .from('order_items')
        .insert([{
          order_id: orderId,
          product_id: productId, // Can be null if not found
          warehouse_id: warehouseId,
          quantity: qty
        }]);

      if (itemErr) {
        console.error(`    Error inserting item ${sku}:`, itemErr);
      }
    }
  }

  console.log(`Backfill finished for ${comercioName}.`);
}

async function run() {
  await backfillCommerce('RELAJARTE');
  await backfillCommerce('DORMILONES');
}

run();
