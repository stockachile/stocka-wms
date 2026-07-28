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
  console.log("=== Inspecting unique statuses from lightdata_envios ===");
  const { data, error } = await supabase
    .from('lightdata_envios')
    .select('status')
    .limit(1000);
  
  if (error) {
    console.error(error);
    return;
  }
  
  const counts = {};
  data.forEach(row => {
    const s = row.status || 'NULL';
    counts[s] = (counts[s] || 0) + 1;
  });
  
  console.log("Status Counts in lightdata_envios:", counts);

  console.log("\n=== Checking global_status in envios_unificados for LightData ===");
  const { data: unified, error: unifiedErr } = await supabase
    .from('envios_unificados')
    .select('status, global_status')
    .eq('source_table', 'lightdata_envios')
    .limit(1000);

  if (unifiedErr) {
    console.error(unifiedErr);
    return;
  }

  const unifiedCounts = {};
  unified.forEach(row => {
    const key = `${row.status} -> ${row.global_status}`;
    unifiedCounts[key] = (unifiedCounts[key] || 0) + 1;
  });

  console.log("Mapping counts in envios_unificados:", unifiedCounts);
}

run();
