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

async function repairCatalog() {
  const commerce = 'POMS KIDS'; // Note the S in the DB
  console.log(`=== Repairing products for ${commerce} ===`);

  // 1. Fetch synced products (which contain images and platform)
  const { data: synced, error: syncErr } = await supabase
    .from('synced_products')
    .select('sku, image_url, platform')
    .eq('comercio', commerce);

  if (syncErr) {
    console.error('Error fetching synced products:', syncErr);
    return;
  }

  console.log(`Found ${synced.length} synced products.`);

  // Create a map by SKU
  const syncedMap = {};
  synced.forEach(sp => {
    syncedMap[sp.sku.toUpperCase().trim()] = sp;
  });

  // 2. Fetch master products
  const { data: products, error: prodErr } = await supabase
    .from('products')
    .select('id, sku')
    .eq('comercio', commerce);

  if (prodErr) {
    console.error('Error fetching master products:', prodErr);
    return;
  }

  console.log(`Found ${products.length} master products. Repairing...`);

  let count = 0;
  for (const prod of products) {
    const cleanSku = prod.sku.toUpperCase().trim();
    const matched = syncedMap[cleanSku];

    if (matched) {
      const updateData = {
        image_url: matched.image_url || null
      };

      if (matched.platform === 'Shopify') {
        updateData.shopify_product_id = 'imported';
      } else if (matched.platform === 'MercadoLibre') {
        updateData.raw_meli_data = {};
      } else if (matched.platform === 'Falabella') {
        updateData.raw_falabella_data = {};
      } else if (matched.platform === 'Paris') {
        updateData.raw_paris_data = {};
      } else if (matched.platform === 'WooCommerce') {
        updateData.raw_woocommerce_data = {};
      } else if (matched.platform === 'Jumpseller') {
        updateData.raw_jumpseller_data = {};
      } else if (matched.platform === 'Walmart') {
        updateData.raw_walmart_data = {};
      }

      const { error: updErr } = await supabase
        .from('products')
        .update(updateData)
        .eq('id', prod.id);

      if (updErr) {
        console.error(`Error updating product SKU ${prod.sku}:`, updErr);
      } else {
        count++;
      }
    }
  }

  console.log(`Finished! Repaired ${count} products for ${commerce}.`);
}

repairCatalog();
