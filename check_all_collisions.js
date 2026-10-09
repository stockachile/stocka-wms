const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const [k, ...v] = l.split('=');
  return [k.trim(), v.join('=').trim().replace(/^['"]|['"]$/g, '')];
}));
const wms = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function checkAllCollisions() {
  const { data: allJanOrders, error } = await wms
    .from('orders')
    .select('id, external_order_number, comercio, estado_wms, status, created_at, tracking_number, raw_meli_data')
    .eq('external_platform', 'MercadoLibre')
    .gte('created_at', '2026-01-30T00:00:00+00:00')
    .lte('created_at', '2026-01-30T23:59:59+00:00');

  console.log(`Total pedidos creados el 2026-01-30 en MercadoLibre: ${allJanOrders?.length || 0}`);

  const collided = [];
  (allJanOrders || []).forEach(o => {
    const raw = o.raw_meli_data;
    const meliDate = raw?.shipping?.date_created || raw?.date_created || raw?.orders?.[0]?.date_created;
    const meliStatus = raw?.shipping?.status || raw?.shipping_status;
    if (meliDate && meliDate.startsWith('2026-10')) {
      collided.push({
        id: o.id,
        num: o.external_order_number,
        comercio: o.comercio,
        wms_estado: o.estado_wms,
        status: o.status,
        meliDate,
        meliStatus,
        shipping_id: raw?.shipping?.id
      });
    }
  });

  console.log(`Total colisiones detectadas (pedidos nuevos de Octubre que sobreescribieron registros viejos de Enero): ${collided.length}`);
  console.log(collided);
}

checkAllCollisions().finally(() => process.exit(0));
