const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

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

async function main() {
  const { data: products } = await supabase.from('products').select('comercio');
  const { data: synced } = await supabase.from('synced_products').select('comercio');

  const pCom = new Set(products.map(p => p.comercio));
  const sCom = new Set(synced.map(s => s.comercio));

  console.log('Comercios in products:', Array.from(pCom));
  console.log('Comercios in synced_products:', Array.from(sCom));
}

main().catch(console.error);
