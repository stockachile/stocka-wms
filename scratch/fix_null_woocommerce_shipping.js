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
  console.log("=== Repairing WooCommerce shipping methods in database ===");
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, external_order_number, raw_woocommerce_data')
    .eq('external_platform', 'WooCommerce');

  if (error) {
    console.error(error);
    return;
  }

  console.log(`Found ${orders.length} WooCommerce orders to inspect.`);

  for (const o of orders) {
    const raw = o.raw_woocommerce_data;
    if (!raw) continue;

    const shippingTitle = raw.shipping_lines?.[0]?.method_title || 'Por definir';
    console.log(`Order ${o.external_order_number}: shipping method from raw data is "${shippingTitle}"`);

    const { error: updErr } = await supabase
      .from('orders')
      .update({ shipping_method: shippingTitle })
      .eq('id', o.id);

    if (updErr) {
      console.error(`  Error updating order ${o.external_order_number}:`, updErr.message);
    } else {
      console.log(`  Successfully updated ${o.external_order_number} to "${shippingTitle}".`);
    }
  }

  console.log("Shipping method backfill completed!");
}

run();
