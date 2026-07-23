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

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectPomsKids() {
  const commerce = 'POMS KIDS'; // Note the S
  console.log(`=== Inspecting products for POMS KIDS (with S) ===`);

  // Count products
  const { count: prodCount } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('comercio', commerce);

  console.log(`Products in public.products: ${prodCount}`);

  if (prodCount > 0) {
    const { data: products } = await supabase
      .from('products')
      .select('id, sku, name, shopify_product_id, image_url, description')
      .eq('comercio', commerce)
      .limit(5);

    console.log('Sample products:');
    console.table(products);
  }

  // Count synced products
  const { count: syncedCount } = await supabase
    .from('synced_products')
    .select('*', { count: 'exact', head: true })
    .eq('comercio', commerce);

  console.log(`Synced products in public.synced_products: ${syncedCount}`);

  if (syncedCount > 0) {
    const { data: synced } = await supabase
      .from('synced_products')
      .select('id, sku, name, platform, image_url')
      .eq('comercio', commerce)
      .limit(5);

    console.log('Sample synced products:');
    console.table(synced);
  }
}

inspectPomsKids();
