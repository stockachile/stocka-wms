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

async function inspectDormilones() {
  console.log('=== INSPECCIÓN DORMILONES ===\n');

  const { data: refOrder } = await supabase
    .from('orders')
    .select('id, external_order_number, created_at')
    .ilike('external_order_number', '%DOR55018597%')
    .eq('comercio', 'DORMILONES')
    .single();

  console.log('Corte Shopify DOR55018597:', refOrder);

  const orderIds = [
    'ac5115c3-9709-45a8-8464-9b1032b8e684',
    'df716593-b2f7-4824-be35-c7085e9e3d98',
    '8d76a647-f4ab-43ff-a696-b21eefdd1d78',
    'c12389e0-43a5-489e-89be-aaf6ba32e24b',
    '49c532e6-35c6-4b8c-9889-c3494ce537e0'
  ];

  for (const id of orderIds) {
    const { data: ord } = await supabase
      .from('orders')
      .select('id, external_order_number, status, estado_wms, stock_descontado, stock_descontado_at, sucursal_pickeo, created_at')
      .eq('id', id)
      .single();

    if (!ord) continue;

    console.log(`\n• Orden ${ord.external_order_number} (${ord.id}):`);
    console.log(`  Creado el: ${ord.created_at}`);
    console.log(`  Estado: status=${ord.status}, estado_wms=${ord.estado_wms}, stock_descontado=${ord.stock_descontado}, sucursal=${ord.sucursal_pickeo}`);

    const { data: items } = await supabase
      .from('order_items')
      .select('id, product_id, quantity, warehouse_id, products(sku, name, comercio)')
      .eq('order_id', ord.id);

    console.log('  Items reales:');
    items?.forEach(i => {
      console.log(`    - SKU: ${i.products?.sku} | Qty: ${i.quantity} | Wh: ${i.warehouse_id} | Name: ${i.products?.name}`);
    });

    const { data: movs } = await supabase
      .from('movements')
      .select('id, reference_doc, quantity, products(sku, name, comercio)')
      .eq('order_id', ord.id);

    console.log('  Movimientos vinculados actualmente:');
    movs?.forEach(m => {
      console.log(`    - Mov ID: ${m.id} | Ref: ${m.reference_doc} | Dueño: ${m.products?.comercio} | SKU: ${m.products?.sku}`);
    });
  }

  const { data: prods } = await supabase.from('products').select('*').in('sku', ['1605202321352', '1605202321351']);
  console.log('\nProductos con estos SKUs:', prods?.map(p => ({ id: p.id, sku: p.sku, name: p.name, comercio: p.comercio })));
}

inspectDormilones().catch(console.error);
