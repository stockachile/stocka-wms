const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const [k, ...v] = l.split('=');
  return [k.trim(), v.join('=').trim().replace(/^['"]|['"]$/g, '')];
}));
const wms = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  const { data: ordersWithOldTrack } = await wms
    .from('orders')
    .select('id, external_order_number, comercio, estado_wms, status, created_at, tracking_number, raw_meli_data')
    .eq('tracking_number', '46367694400');

  console.log(`Total con tracking 46367694400: ${ordersWithOldTrack.length}`);
  const recentMeli = [];
  ordersWithOldTrack.forEach(o => {
    const raw = o.raw_meli_data;
    const meliDate = raw?.shipping?.date_created || raw?.date_created || raw?.orders?.[0]?.date_created;
    if (meliDate && !meliDate.startsWith('2026-01')) {
      recentMeli.push({
        num: o.external_order_number,
        comercio: o.comercio,
        meliDate,
        track: raw?.shipping?.id || raw?.shipping?.tracking_number
      });
    }
  });
  console.log(`De ellos, cuántos tienen datos recientes en raw_meli_data: ${recentMeli.length}`);
  console.log(recentMeli);
}

test().finally(() => process.exit(0));
