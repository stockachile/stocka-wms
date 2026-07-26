const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

try {
  const envContent = fs.readFileSync('.env', 'utf-8');
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const key = trimmed.substring(0, idx).trim();
      const val = trimmed.substring(idx + 1).trim();
      process.env[key] = val;
    }
  });
} catch (e) {
  console.warn('Advertencia: No se pudo leer el archivo .env:', e.message);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log('--- THE SKIN STORE Products in database ---');
  const { data: prods, error: prodErr } = await supabase
    .from('products')
    .select('id, sku, name, comercio')
    .eq('comercio', 'THE SKIN STORE');

  if (prodErr) {
    console.error('Error fetching products:', prodErr);
    return;
  }
  
  console.log(`Found ${prods.length} products:`);
  console.log(JSON.stringify(prods, null, 2));

  console.log('\n--- THE SKIN STORE Inventory records in database ---');
  const { data: inv, error: invErr } = await supabase
    .from('inventory')
    .select('*, warehouses(name)')
    .in('product_id', prods.map(p => p.id));

  if (invErr) {
    console.error('Error fetching inventory:', invErr);
    return;
  }
  
  console.log(`Found ${inv.length} inventory rows:`);
  console.log(JSON.stringify(inv, null, 2));
}

run();
