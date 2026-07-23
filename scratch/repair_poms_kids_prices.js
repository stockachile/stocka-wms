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
  const commerce = 'POMS KIDS';
  console.log(`Starting catalog price repair for commerce: ${commerce}...`);

  // 1. Fetch synced products for POMS KIDS
  const { data: syncedProds, error: syncedErr } = await supabase
    .from('synced_products')
    .select('sku, price')
    .eq('comercio', commerce)
    .eq('platform', 'Shopify');

  if (syncedErr) throw syncedErr;
  console.log(`Found ${syncedProds.length} synced products with prices.`);

  const priceMap = {};
  syncedProds.forEach(sp => {
    if (sp.sku && sp.price !== null && sp.price !== undefined) {
      priceMap[sp.sku.toUpperCase()] = parseFloat(sp.price);
    }
  });

  // 2. Fetch master products for POMS KIDS
  const { data: masterProds, error: masterErr } = await supabase
    .from('products')
    .select('id, sku, name, price')
    .eq('comercio', commerce);

  if (masterErr) throw masterErr;
  console.log(`Found ${masterProds.length} products in master catalog.`);

  let updatedCount = 0;
  for (const prod of masterProds) {
    const cleanSku = prod.sku ? prod.sku.toUpperCase() : '';
    if (priceMap[cleanSku] !== undefined) {
      const shopifyPrice = priceMap[cleanSku];
      if (prod.price !== shopifyPrice) {
        console.log(`Updating SKU ${prod.sku} (${prod.name}): ${prod.price} -> ${shopifyPrice}`);
        const { error: updateErr } = await supabase
          .from('products')
          .update({ price: shopifyPrice })
          .eq('id', prod.id);

        if (updateErr) {
          console.error(`Error updating SKU ${prod.sku}:`, updateErr.message);
        } else {
          updatedCount++;
        }
      }
    }
  }

  console.log(`Repair completed successfully. Updated ${updatedCount} product prices.`);
}

main().catch(console.error);
