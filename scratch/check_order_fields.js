const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
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

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data: order, error } = await supabase
    .from('orders')
    .select('id, sku, item, raw_shopify_data')
    .eq('external_order_number', 'MAG5585')
    .maybeSingle();

  if (error) {
    console.error(error);
  } else {
    console.log('Order SKU:', order.sku);
    console.log('Order Item:', order.item);
    if (order.raw_shopify_data) {
      console.log('Shopify Order Number:', order.raw_shopify_data.name);
      console.log('Shopify line items skus:', order.raw_shopify_data.line_items.map(li => li.sku));
    }
  }
}
check();
