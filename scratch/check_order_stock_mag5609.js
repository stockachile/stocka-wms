const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Cargar archivo .env
const envPath = path.join(__dirname, '..', '.env');
let env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split(/\r?\n/).forEach(line => {
    if (!line || line.startsWith('#')) return;
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      env[key.trim()] = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
    }
  });
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log("=== Checking stock for items in order MAG5609 ===");
  
  // 1. Get order items
  const { data: items, error: itemsErr } = await supabase
    .from('order_items')
    .select('product_id, quantity, products(sku, name)')
    .eq('order_id', '32ec4695-aa13-4d68-ac7b-57c74b6709e5');
  
  if (itemsErr) {
    console.error("Error fetching order items:", itemsErr);
    return;
  }

  console.log("Order items found:", JSON.stringify(items, null, 2));

  // 2. For each product, check its stock levels in the inventory table
  for (const item of items) {
    const { data: inv, error: invErr } = await supabase
      .from('inventory')
      .select('warehouse_id, quantity, committed_quantity')
      .eq('product_id', item.product_id);
    
    if (invErr) {
      console.error(`Error fetching inventory for product ${item.product_id}:`, invErr);
      continue;
    }

    console.log(`Inventory levels for product ${item.products?.sku || item.product_id} (${item.products?.name}):`, inv);
  }
}

run();
