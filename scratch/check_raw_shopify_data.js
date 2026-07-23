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
    .select('id, sku, name, price, raw_shopify_data')
    .eq('comercio', 'POMS KIDS')
    .limit(5);

  if (error) throw error;
  console.log('Products sample raw_shopify_data:');
  products.forEach(p => {
    console.log(`SKU: ${p.sku}, Name: ${p.name}, Current Price: ${p.price}`);
    console.log('Raw Shopify Data keys/sample:', p.raw_shopify_data ? Object.keys(p.raw_shopify_data) : 'null');
    if (p.raw_shopify_data) {
      console.log('Raw Shopify Data detail (first 200 chars):', JSON.stringify(p.raw_shopify_data).substring(0, 500));
    }
    console.log('---');
  });
}

main().catch(console.error);
