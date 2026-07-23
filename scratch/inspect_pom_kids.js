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
  const { data: products, error } = await supabase
    .from('products')
    .select('comercio, sku, name')
    .ilike('comercio', '%POM%');

  if (error) throw error;
  
  console.log(`Found ${products.length} products matching %POM% in products table.`);
  if (products.length > 0) {
    console.log('Sample:', products.slice(0, 5));
    const uniqueComercios = new Set(products.map(p => p.comercio));
    console.log('Unique comercios:', Array.from(uniqueComercios));
  }
}

main().catch(console.error);
