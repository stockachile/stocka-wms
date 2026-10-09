const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const [k, ...v] = l.split('=');
  return [k.trim(), v.join('=').trim().replace(/^['"]|['"]$/g, '')];
}));
const wms = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  const { data: o } = await wms.from('orders').select('*').eq('id', '0233a496-214e-4cd1-8d7f-05358e510b8d').single();
  console.log('Order:');
  console.log({
    id: o.id,
    external_order_number: o.external_order_number,
    tracking_number: o.tracking_number,
    customer_name: o.customer_name,
    customer_phone: o.customer_phone,
    customer_email: o.customer_email,
    shipping_address: o.shipping_address,
    shipping_city: o.shipping_city,
    shipping_complement: o.shipping_complement,
    status: o.status,
    estado_wms: o.estado_wms,
    created_at: o.created_at,
    fecha_procesamiento: o.fecha_procesamiento,
    item: o.item,
    sku: o.sku,
    cantidad: o.cantidad
  });

  const { data: items } = await wms.from('order_items').select('*').eq('order_id', o.id);
  console.log('Order items count:', items.length);
  console.log('Order items IDs and quantities:', items.map(i => ({ id: i.id, product_id: i.product_id, quantity: i.quantity })));
}

test().finally(() => process.exit(0));
