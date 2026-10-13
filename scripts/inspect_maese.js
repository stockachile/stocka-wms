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

async function inspectMaese() {
  console.log('=== INSPECCIÓN MAESE ===\n');

  const { data: ord } = await supabase
    .from('orders')
    .select('id, external_order_number, status, estado_wms, stock_descontado, stock_descontado_at, sucursal_pickeo, created_at')
    .eq('id', 'c47721eb-d838-4920-ad55-13f0c539a6f9')
    .single();

  console.log('Orden MSE#JS-1079:', ord);

  const { data: items } = await supabase
    .from('order_items')
    .select('id, product_id, quantity, warehouse_id, products(sku, name, comercio)')
    .eq('order_id', ord.id);

  console.log('Items reales:');
  items?.forEach(i => {
    console.log(`  - SKU: ${i.products?.sku} | Qty: ${i.quantity} | Wh: ${i.warehouse_id} | Name: ${i.products?.name}`);
  });

  const { data: movs } = await supabase
    .from('movements')
    .select('id, reference_doc, quantity, products(sku, name, comercio)')
    .eq('order_id', ord.id);

  console.log('Movimientos vinculados actualmente:');
  movs?.forEach(m => {
    console.log(`  - Mov ID: ${m.id} | Ref: ${m.reference_doc} | Dueño: ${m.products?.comercio} | SKU: ${m.products?.sku}`);
  });

  for (const it of (items || [])) {
    if (!it.warehouse_id) continue;
    const { data: inv } = await supabase
      .from('inventory')
      .select('*')
      .eq('product_id', it.product_id)
      .eq('warehouse_id', it.warehouse_id)
      .maybeSingle();

    console.log(`  -> Stock actual en bodega ${it.warehouse_id} para ${it.products?.sku}: ${inv?.quantity}`);
  }
}

inspectMaese().catch(console.error);
