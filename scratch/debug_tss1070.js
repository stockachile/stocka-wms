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
  console.log("=== Debugging TSS1070 in envios_unificados ===");
  const { data: unified, error: unifiedErr } = await supabase
    .from('envios_unificados')
    .select('*')
    .or("pedido_referencia.eq.TSS1070,tracking.eq.TSS1070,tracking.eq.458117761");

  if (unifiedErr) {
    console.error(unifiedErr);
    return;
  }

  console.log("Found shipments in envios_unificados:", JSON.stringify(unified, null, 2));

  console.log("\n=== Debugging TSS1070 in orders ===");
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('*')
    .or("id.eq.TSS1070,external_order_number.eq.TSS1070");

  if (orderErr) {
    console.error(orderErr);
    return;
  }

  console.log("Found orders:", JSON.stringify(order, null, 2));
}

run();
