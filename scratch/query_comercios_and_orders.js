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
  console.log("=== Checking current database records for MAG5609 ===");
  
  const { data: orders } = await supabase
    .from('orders')
    .select('id, external_order_number, status, estado_wms, courier, tracking_number')
    .eq('external_order_number', 'MAG5609');
  
  console.log("Order state in DB:", orders);

  const { data: shipments } = await supabase
    .from('envios_unificados')
    .select('id, status, global_status, updated_at')
    .eq('pedido_referencia', 'MAG5609');
  
  console.log("Shipment state in DB:", shipments);
}

run();
