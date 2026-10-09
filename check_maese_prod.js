const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const [k, ...v] = l.split('=');
  return [k.trim(), v.join('=').trim().replace(/^['"]|['"]$/g, '')];
}));
const wms = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  const { data } = await wms.from('products').select('id, sku, name').eq('comercio', 'MAESE').or('sku.eq.5902444723161,barcode.eq.5902444723161');
  console.log('MAESE:', data);
}

test().finally(() => process.exit(0));
