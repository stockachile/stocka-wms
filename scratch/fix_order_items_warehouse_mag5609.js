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
  console.log("=== Updating order_items warehouse_id to Matriz Ñuñoa ===");
  const orderId = '32ec4695-aa13-4d68-ac7b-57c74b6709e5';
  const nunoaWarehouseId = '973da888-8a63-4790-a08f-919e1af41a93';

  const { data, error } = await supabase
    .from('order_items')
    .update({ warehouse_id: nunoaWarehouseId })
    .eq('order_id', orderId);
  
  if (error) {
    console.error("Error updating warehouse_id:", error);
    return;
  }
  
  console.log("Successfully updated warehouse_id for order items of MAG5609 to Matriz Ñuñoa.");
}

run();
