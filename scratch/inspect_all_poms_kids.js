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
  const { data: poms, error } = await supabase
    .from('products')
    .select('id, commerce:comercio, sku, name, price, shopify_product_id, image_url')
    .or('comercio.eq.POM KIDS,comercio.eq.POMS KIDS');

  if (error) throw error;
  console.log(`Found ${poms.length} products total.`);
  poms.forEach(p => {
    console.log(`ID: ${p.id}, Comercio: ${p.commerce}, SKU: ${p.sku}, Name: ${p.name}, Price: ${p.price}, Shopify ID: ${p.shopify_product_id}, Image: ${p.image_url}`);
  });
}

main().catch(console.error);
