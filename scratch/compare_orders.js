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
  const { data: dor } = await supabase.from('orders').select('*').eq('external_order_number', 'DOR55018401').single();
  const { data: rel } = await supabase.from('orders').select('*').eq('external_order_number', 'REL716792').single();

  console.log("=== Comparing DOR55018401 and REL716792 ===");
  const keys = Object.keys(dor).sort();
  keys.forEach(k => {
    if (k.startsWith('raw_')) return; // Skip raw json data for brevity
    console.log(`${k.padEnd(25)} | DOR: ${JSON.stringify(dor[k])} | REL: ${JSON.stringify(rel[k])}`);
  });
}

run();
