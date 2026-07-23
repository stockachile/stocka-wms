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
  const oldCommerce = 'POM KIDS';
  const newCommerce = 'POMS KIDS';

  console.log(`=== ALIGNING COMMERCE NAMES: "${oldCommerce}" -> "${newCommerce}" ===`);

  // 1. Update comercio in products table
  const { data: updatedProds, error: prodErr } = await supabase
    .from('products')
    .update({ comercio: newCommerce })
    .eq('comercio', oldCommerce)
    .select('id, sku, name');

  if (prodErr) throw prodErr;
  console.log(`Updated ${updatedProds.length} products to "${newCommerce}".`);

  // 2. Update comercio in incidencias table
  const { data: updatedIncs, error: incErr } = await supabase
    .from('incidencias')
    .update({ comercio: newCommerce })
    .eq('comercio', oldCommerce)
    .select('id');

  if (incErr) {
    console.log('No incidencias table updates or error:', incErr.message);
  } else {
    console.log(`Updated ${updatedIncs.length} incidencias to "${newCommerce}".`);
  }

  // 3. Update comercio in orders table
  const { data: updatedOrders, error: orderErr } = await supabase
    .from('orders')
    .update({ comercio: newCommerce })
    .eq('comercio', oldCommerce)
    .select('id');

  if (orderErr) {
    console.log('No orders table updates or error:', orderErr.message);
  } else {
    console.log(`Updated ${updatedOrders.length} orders to "${newCommerce}".`);
  }

  // 4. Fetch synced products for POMS KIDS (which has the prices)
  const { data: syncedProds, error: syncedErr } = await supabase
    .from('synced_products')
    .select('sku, price')
    .eq('comercio', newCommerce)
    .eq('platform', 'Shopify');

  if (syncedErr) throw syncedErr;
  console.log(`Found ${syncedProds.length} synced products with prices.`);

  const priceMap = {};
  syncedProds.forEach(sp => {
    if (sp.sku && sp.price !== null && sp.price !== undefined) {
      priceMap[sp.sku.toUpperCase().trim()] = parseFloat(sp.price);
    }
  });

  // 5. Fetch master products for POMS KIDS (just updated)
  const { data: masterProds, error: masterErr } = await supabase
    .from('products')
    .select('id, sku, name, price')
    .eq('comercio', newCommerce);

  if (masterErr) throw masterErr;
  console.log(`Found ${masterProds.length} products in master catalog.`);

  let updatedCount = 0;
  for (const prod of masterProds) {
    const cleanSku = prod.sku ? prod.sku.toUpperCase().trim() : '';
    if (priceMap[cleanSku] !== undefined) {
      const shopifyPrice = priceMap[cleanSku];
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

  console.log(`=== Alignment and repair completed successfully. Updated ${updatedCount} product prices. ===`);
}

main().catch(console.error);
