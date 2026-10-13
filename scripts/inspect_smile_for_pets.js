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

async function inspectSmile() {
  console.log('=== INSPECCIÓN SMILE FOR PETS ===\n');

  const { data: refOrder } = await supabase.from('orders').select('id, external_order_number, created_at').ilike('external_order_number', '%3576%').eq('comercio', 'SMILE FOR PETS').single();
  console.log('Cutoff order SFP#3576:', refOrder);

  const orderIds = [
    '16dbda66-e975-49f1-a634-5897f914500c',
    'ed692451-0997-423a-abd7-33a958257bfc',
    '13a87293-2d7d-4bbf-b106-967d20fc1464',
    'acf9f10d-4963-443f-af9f-010724357884',
    '5a57f7d6-f910-4b61-9a05-e2435a1818dc'
  ];

  for (const id of orderIds) {
    const { data: ord } = await supabase
      .from('orders')
      .select('id, external_order_number, status, estado_wms, stock_descontado, stock_descontado_at, sucursal_pickeo, created_at')
      .eq('id', id)
      .single();

    if (!ord) continue;

    console.log(`• Orden ${ord.external_order_number} (${ord.id}):`);
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

    for (const it of (items || [])) {
      if (!it.warehouse_id) continue;
      const { data: inv } = await supabase
        .from('inventory')
        .select('*')
        .eq('product_id', it.product_id)
        .eq('warehouse_id', it.warehouse_id)
        .maybeSingle();

      console.log(`    -> Stock actual en bodega ${it.warehouse_id} para ${it.products?.sku}: ${inv?.quantity}`);
    }
    console.log('--------------------------------------------------');
  }

  const { data: prods } = await supabase.from('products').select('id, sku').in('sku', ['GD005', 'TD006']).eq('comercio', 'SMILE FOR PETS');
  for (const p of prods) {
    const { data: movs } = await supabase.from('movements').select('id, date, type, quantity, reference_doc, order_id').eq('product_id', p.id).order('date', { ascending: false }).limit(6);
    console.log(`\nMovimientos recientes de ${p.sku}:`, movs);
  }
}

inspectSmile().catch(console.error);
