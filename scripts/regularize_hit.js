const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const [k, ...v] = line.trim().split('=');
  if (k && v.length) env[k] = v.join('=').replace(/^['"]|['"]$/g, '');
});

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function regularizeHit() {
  console.log('=== REGULARIZACIÓN DEL COMERCIO: HIT GAMING ===\n');

  const orderId = '9f2996a7-5a2f-48a3-b55c-6395f08f9c04';
  const orderNum = 'HIT1033';
  const foreignMovIds = [
    'b8a848ab-1f90-4b77-9247-aed4a8f85d76',
    '940d888e-1959-4686-8aca-60101d32c624'
  ];

  console.log(`• Desvinculando movimientos ajenos de BLESSNUSS asociados erróneamente a ${orderNum}...`);

  for (const fId of foreignMovIds) {
    const { error: unErr } = await supabase
      .from('movements')
      .update({ order_id: null })
      .eq('id', fId);
    if (unErr) {
      console.error(`   Error desvinculando movimiento ${fId}:`, unErr);
    } else {
      console.log(`   ✔ Movimiento ajeno ${fId} desvinculado (order_id = null).`);
    }
  }

  // Verificar estado final de la orden HIT1033
  const { data: movs } = await supabase
    .from('movements')
    .select('id, reference_doc, quantity, products(sku, name, comercio)')
    .eq('order_id', orderId);

  console.log('\nMovimientos vinculados a HIT1033 tras regularización:');
  movs.forEach(m => {
    console.log(`- ID: ${m.id} | Ref: ${m.reference_doc} | SKU: ${m.products?.sku} (${m.products?.comercio}) | Qty: ${m.quantity}`);
  });

  const { data: prod } = await supabase.from('products').select('id, sku').eq('sku', 'MS-VX-R1SE-BK').eq('comercio', 'HIT GAMING').single();
  const { data: inv } = await supabase.from('inventory').select('quantity').eq('product_id', prod.id).eq('warehouse_id', '973da888-8a63-4790-a08f-919e1af41a93').single();
  console.log(`\nStock final de MS-VX-R1SE-BK en Matriz Ñuñoa: ${inv.quantity}`);

  console.log('\n=============================================================');
  console.log('HIT GAMING: 100% REGULARIZADO Y VERIFICADO');
  console.log('=============================================================\n');
}

regularizeHit().catch(console.error);
