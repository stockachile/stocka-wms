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

async function run() {
  console.log("=== Checking orders without items to backfill ===");
  // Fetch all Shopify orders in July for Felipe
  const { data: orders, error } = await supabase
    .from('orders')
    .select(`
      id,
      external_order_number,
      comercio,
      raw_shopify_data,
      order_items (id)
    `)
    .eq('external_platform', 'Shopify')
    .gte('created_at', '2026-07-01T00:00:00+00:00')
    .lte('created_at', '2026-07-20T23:59:59+00:00');

  if (error) {
    console.error("Error fetching orders:", error);
    return;
  }

  const emptyOrders = orders.filter(o => !o.order_items || o.order_items.length === 0);
  console.log(`Found ${emptyOrders.length} Shopify orders with no order items in the database.`);

  const warehouseId = 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09'; // Default warehouse

  for (const o of emptyOrders) {
    console.log(`Backfilling items for order ${o.external_order_number} (${o.comercio})...`);
    
    // Extract line items from raw_shopify_data
    const rawData = o.raw_shopify_data;
    if (!rawData || !rawData.line_items) {
      console.warn(`  No raw shopify data or line_items found for ${o.external_order_number}`);
      continue;
    }

    const lineItems = rawData.line_items;
    for (const item of lineItems) {
      const sku = (item.sku || item.variant_sku || '').trim();
      const qty = item.quantity || 1;
      console.log(`  - Item SKU: ${sku}, Qty: ${qty}`);

      let productId = null;
      if (sku) {
        const { data: products } = await supabase
          .from('products')
          .select('id')
          .eq('comercio', o.comercio)
          .ilike('sku', sku)
          .limit(1);

        if (products && products.length > 0) {
          productId = products[0].id;
        } else {
          console.warn(`    WARNING: Product SKU "${sku}" not found in catalog for ${o.comercio}.`);
        }
      }

      // Insert order item
      const { error: itemErr } = await supabase
        .from('order_items')
        .insert([{
          order_id: o.id,
          product_id: productId,
          warehouse_id: warehouseId,
          quantity: qty
        }]);

      if (itemErr) {
        console.error(`    Error inserting item ${sku}:`, itemErr);
      } else {
        console.log(`    Successfully inserted item ${sku}.`);
      }
    }
  }

  console.log("All missing order items backfilled!");
}

run();
