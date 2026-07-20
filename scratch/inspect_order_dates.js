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
  const comercios = ['DORMILONES', 'RELAJARTE', 'BACK IN TIME'];
  for (const c of comercios) {
    console.log(`=== Newest 5 orders for ${c} ===`);
    const { data: orders, error } = await supabase
      .from('orders')
      .select('id, external_order_number, created_at, status, estado_wms, external_platform, origen')
      .eq('comercio', c)
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) {
      console.error(error);
    } else {
      console.log(orders);
    }
  }
}

run();
