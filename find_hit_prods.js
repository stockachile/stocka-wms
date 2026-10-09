const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const [k, ...v] = l.split('=');
  return [k.trim(), v.join('=').trim().replace(/^['"]|['"]$/g, '')];
}));
const wms = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function findProds() {
  const itemIds = ['MLC3555668990', 'MLC3555720612', 'MLC4472210444', 'MLC4491480054', 'MLC4138515008'];
  const { data: prodsByMeli } = await wms
    .from('products')
    .select('id, sku, name, meli_item_id, barcode')
    .eq('comercio', 'HIT GAMING')
    .in('meli_item_id', itemIds);
  console.log('Prods by meli_item_id:', prodsByMeli);

  // Also search by text
  const { data: allHitProds } = await wms
    .from('products')
    .select('id, sku, name, meli_item_id, barcode')
    .eq('comercio', 'HIT GAMING');
  console.log(`Total HIT GAMING products in catalog: ${allHitProds.length}`);

  ['Ajazz', 'Virtuoso', 'A9 2.0', 'Vxe R1'].forEach(term => {
    const matches = allHitProds.filter(p => p.name.toLowerCase().includes(term.toLowerCase()) || p.sku.toLowerCase().includes(term.toLowerCase()));
    console.log(`Matches for "${term}":`, matches.map(m => ({ id: m.id, sku: m.sku, name: m.name, meli: m.meli_item_id })));
  });
}

findProds().finally(() => process.exit(0));
