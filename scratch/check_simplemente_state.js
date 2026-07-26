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
  console.log('Fetching products for SIMPLEMENTE CAFE...');
  const { data: prods, error: prodErr } = await supabase
    .from('products')
    .select('id, sku, name')
    .eq('comercio', 'SIMPLEMENTE CAFE');

  if (prodErr) {
    console.error('Error fetching products:', prodErr);
    return;
  }

  const prodIds = prods.map(p => p.id);
  const prodMap = {};
  prods.forEach(p => {
    prodMap[p.id] = p;
  });

  console.log('\n--- Inventory ---');
  const { data: inv, error: invErr } = await supabase
    .from('inventory')
    .select('*')
    .in('product_id', prodIds);
  
  if (invErr) {
    console.error('Error fetching inventory:', invErr);
  } else if (inv) {
    inv.forEach(i => {
      const prod = prodMap[i.product_id];
      console.log(`SKU: ${prod.sku} | Name: ${prod.name} | Qty: ${i.quantity} | Committed: ${i.committed_quantity}`);
    });
  }

  console.log('\n--- Movements ---');
  const { data: movs, error: movsErr } = await supabase
    .from('movements')
    .select('*')
    .in('product_id', prodIds)
    .order('date', { ascending: false });

  if (movsErr) {
    console.error('Error fetching movements:', movsErr);
  } else if (movs) {
    movs.forEach(m => {
      const prod = prodMap[m.product_id];
      console.log(`Date: ${m.date} | SKU: ${prod ? prod.sku : 'Unknown'} | Type: ${m.type} | Qty: ${m.quantity} | Ref: ${m.reference_doc}`);
    });
  }
}

run();
