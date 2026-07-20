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
  console.log("=== Checking products with null SKU ===");
  const { data: products, error } = await supabase
    .from('products')
    .select('id, sku, name, is_pack, comercio')
    .or('sku.is.null,sku.eq.""');
  
  if (error) {
    console.error(error);
    return;
  }
  console.log(`Found ${products.length} products with null or empty SKU.`);
  if (products.length > 0) {
    console.log(products);
  }
}

run();
