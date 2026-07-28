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
  console.log("=== Checking warehouse_id in order_items for order MAG5609 ===");
  const { data: items, error } = await supabase
    .from('order_items')
    .select('id, product_id, warehouse_id, quantity')
    .eq('order_id', '32ec4695-aa13-4d68-ac7b-57c74b6709e5');
  
  if (error) {
    console.error(error);
    return;
  }
  console.log("Items:", items);
}

run();
