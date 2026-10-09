const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const [k, ...v] = l.split('=');
  return [k.trim(), v.join('=').trim().replace(/^['"]|['"]$/g, '')];
}));
const wms = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  const { data: recentHit } = await wms
    .from('orders')
    .select('id, external_order_number, sucursal_pickeo, order_items(warehouse_id)')
    .eq('comercio', 'HIT GAMING')
    .eq('estado_wms', 'En preparación')
    .limit(3);

  console.log('Recent HIT GAMING En preparación:', JSON.stringify(recentHit, null, 2));
}

test().finally(() => process.exit(0));
