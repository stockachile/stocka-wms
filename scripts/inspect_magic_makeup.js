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

async function inspectMagicMakeup() {
  console.log('=== INSPECCIÓN MAGIC MAKEUP ===\n');

  const orderNums = ['MAG5695', 'MAG5686'];
  for (const num of orderNums) {
    const { data: ord } = await supabase
      .from('orders')
      .select('id, external_order_number, status, estado_wms, stock_descontado, stock_descontado_at, sucursal_pickeo, created_at')
      .ilike('external_order_number', `%${num}%`)
      .eq('comercio', 'MAGIC MAKEUP')
      .single();

    if (!ord) {
      console.log(`Orden ${num} no encontrada.`);
      continue;
    }

    console.log(`• Orden ${ord.external_order_number} (${ord.id}):`);
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

    // Check stock actual de los productos de esta orden en Matriz Ñuñoa
    for (const it of (items || [])) {
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
}

inspectMagicMakeup().catch(console.error);
