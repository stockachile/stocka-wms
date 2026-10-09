const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const [k, ...v] = l.split('=');
  return [k.trim(), v.join('=').trim().replace(/^['"]|['"]$/g, '')];
}));
const wms = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  const { data: orders } = await wms.from('orders')
    .select('id, external_order_number, external_platform, comercio, created_at, status, estado_wms, tracking_number')
    .gte('created_at', '2026-01-29T00:00:00')
    .lte('created_at', '2026-01-31T23:59:59')
    .limit(20);
  console.log('Orders around 2026-01-30:', orders);

  // Check if there are other orders with 46367694400 tracking
  const { data: byTrack } = await wms.from('orders')
    .select('id, external_order_number, external_platform, comercio, created_at')
    .eq('tracking_number', '46367694400');
  console.log('Orders with tracking 46367694400:', byTrack);
}

test().finally(() => process.exit(0));
