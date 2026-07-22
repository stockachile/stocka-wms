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
  console.log("=== Finding WooCommerce orders with null commerce ===");
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, merchant_id, external_order_number, comercio')
    .eq('external_platform', 'WooCommerce');

  if (error) {
    console.error(error);
    return;
  }

  // Filter orders where commerce is null or string "null"
  const targetOrders = orders.filter(o => !o.comercio || o.comercio === 'null');
  console.log(`Found ${targetOrders.length} WooCommerce orders with null/invalid commerce.`);

  // Get merchant mappings
  const merchantIds = [...new Set(targetOrders.map(o => o.merchant_id))];
  const merchantComercios = {};

  for (const mId of merchantIds) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('comercio')
      .eq('id', mId)
      .single();
    
    if (profile) {
      merchantComercios[mId] = profile.comercio;
    }
  }

  console.log("Merchant mappings:", merchantComercios);

  for (const o of targetOrders) {
    const commerce = merchantComercios[o.merchant_id];
    if (commerce) {
      console.log(`Updating order ${o.external_order_number} to commerce "${commerce}"...`);
      const { error: updErr } = await supabase
        .from('orders')
        .update({ comercio: commerce })
        .eq('id', o.id);

      if (updErr) {
        console.error(`  Error updating order ${o.external_order_number}:`, updErr.message);
      } else {
        console.log(`  Successfully updated ${o.external_order_number}.`);
      }
    } else {
      console.warn(`  Could not find commerce mapping for merchant ID ${o.merchant_id}`);
    }
  }

  console.log("Database repair completed!");
}

run();
