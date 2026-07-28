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
  console.log("\n=== Debugging TSS1078 in envios_unificados ===");
  const { data: envUnif, error: envUnifErr } = await supabase
    .from('envios_unificados')
    .select('*')
    .eq('tracking', 'TSS1078');

  if (envUnifErr) {
    console.error(envUnifErr);
    return;
  }

  console.log("Found envios_unificados count:", envUnif ? envUnif.length : 0);
  if (envUnif && envUnif.length > 0) {
    envUnif.forEach((item, idx) => {
      console.log(`\nenvios_unificados Record ${idx + 1}:`);
      console.log("  ID:", item.id);
      console.log("  Pedido Referencia:", item.pedido_referencia);
      console.log("  Tracking:", item.tracking);
      console.log("  Status (originally s.status):", item.status);
      console.log("  Global Status:", item.global_status);
      console.log("  Updated At:", item.updated_at);
      console.log("  Raw Data exists:", item.raw_data ? "yes" : "no");
      if (item.raw_data) {
        console.log("  Raw Data Status (idx 23):", item.raw_data[23]);
        console.log("  Raw Data timestamp (idx 25):", item.raw_data[25]);
      }
    });
  }
}

run();
