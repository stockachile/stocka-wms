const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

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

const supabaseUrl = env.SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log("=== Checking Dormilones orders with items ===");
  const { data: orders, error } = await supabase
    .from('orders')
    .select(`
      id,
      external_order_number,
      created_at,
      order_items (id)
    `)
    .eq('comercio', 'DORMILONES')
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  orders.forEach(o => {
    const hasItems = o.order_items && o.order_items.length > 0;
    console.log(`Order: ${o.external_order_number}, CreatedAt: ${o.created_at}, HasItems: ${hasItems}`);
  });
}

run();
