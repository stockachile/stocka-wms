const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const [k, ...v] = l.split('=');
  return [k.trim(), v.join('=').trim().replace(/^['"]|['"]$/g, '')];
}));
const wms = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function inspect() {
  const { data: o } = await wms.from('orders').select('*').eq('id', '0233a496-214e-4cd1-8d7f-05358e510b8d').single();
  console.log('Order base fields:', {
    id: o.id,
    external_order_number: o.external_order_number,
    comercio: o.comercio,
    status: o.status,
    estado_wms: o.estado_wms,
    created_at: o.created_at,
    fecha_procesamiento: o.fecha_procesamiento,
    tracking_number: o.tracking_number,
    courier: o.courier,
    operador: o.operador,
    sucursal_pickeo: o.sucursal_pickeo
  });
  console.log('raw_meli_data shipping:', o.raw_meli_data?.shipping);
  console.log('raw_meli_data orders summary:', (o.raw_meli_data?.orders || []).map(ord => ({
    id: ord.id,
    date_created: ord.date_created,
    order_items: ord.order_items?.map(i => ({ item: i.item?.id, title: i.item?.title, seller_sku: i.item?.seller_sku, qty: i.quantity }))
  })));
}

inspect().catch(console.error);
