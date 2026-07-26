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
  const { data: prods } = await supabase
    .from('products')
    .select('id, sku')
    .eq('comercio', 'THE SKIN STORE');

  const prodIds = prods.map(p => p.id);

  console.log('--- Recent Movements ---');
  const { data: mv, error } = await supabase
    .from('movements')
    .select('*, warehouses(name)')
    .in('product_id', prodIds)
    .order('date', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Error fetching movements:', error);
  } else {
    console.log(JSON.stringify(mv.map(m => ({
      sku: prods.find(p => p.id === m.product_id)?.sku,
      type: m.type,
      quantity: m.quantity,
      warehouse: m.warehouses?.name,
      date: m.date,
      reference_doc: m.reference_doc
    })), null, 2));
  }
}

run();
