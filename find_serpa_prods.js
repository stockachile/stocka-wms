const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const [k, ...v] = l.split('=');
  return [k.trim(), v.join('=').trim().replace(/^['"]|['"]$/g, '')];
}));
const wms = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function findSerpaProds() {
  const itemIds = ['MLC1553071279', 'MLC2981218350', 'MLC2978408912', 'MLC1601452773', 'MLC1764322677'];
  const { data: prodsByMeli } = await wms
    .from('products')
    .select('id, sku, name, meli_item_id, barcode')
    .ilike('comercio', '%SERPA%')
    .in('meli_item_id', itemIds);
  console.log('SERPA Prods by meli_item_id:', prodsByMeli);

  const { data: allSerpa } = await wms
    .from('products')
    .select('id, sku, name, meli_item_id, barcode')
    .ilike('comercio', '%SERPA%');
  console.log(`Total SERPA products: ${allSerpa.length}`);
}

findSerpaProds().finally(() => process.exit(0));
