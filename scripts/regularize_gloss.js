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

async function regularizeGloss() {
  console.log('=== REGULARIZACIÓN DEL COMERCIO: JOYAS GLOSS ===\n');

  const orderId = '584920c5-6eb7-44f1-947b-a134be65e0fe';
  const orderNum = 'GLS27983';
  const date = '2026-10-04T22:37:26+00:00';
  const foreignMovId = 'fec21075-da76-4850-b55e-6d9e8f107648';
  const items = [
    { sku: 'COLZOCI21-LIB', qty: 1, whId: '973da888-8a63-4790-a08f-919e1af41a93' }
  ];

  console.log(`• Procesando orden ${orderNum} (${orderId})...`);

  // 1. Desvincular movimiento ajeno
  const { error: unErr } = await supabase
    .from('movements')
    .update({ order_id: null })
    .eq('id', foreignMovId);

  if (unErr) {
    console.error(`   Error desvinculando movimiento ${foreignMovId}:`, unErr);
  } else {
    console.log(`   ✔ Movimiento ajeno ${foreignMovId} desvinculado (order_id = null).`);
  }

  // 2. Obtener producto de JOYAS GLOSS
  for (const it of items) {
    const { data: prod, error: pErr } = await supabase
      .from('products')
      .select('id, name')
      .eq('sku', it.sku)
      .eq('comercio', 'JOYAS GLOSS')
      .single();

    if (!prod || pErr) {
      console.error(`   No se encontró producto con SKU ${it.sku} en JOYAS GLOSS:`, pErr);
      continue;
    }

    // 3. Insertar movimiento legítimo en Kardex
    const { data: insMov, error: insErr } = await supabase
      .from('movements')
      .insert([{
        product_id: prod.id,
        warehouse_id: it.whId,
        type: 'out',
        quantity: it.qty,
        date: date,
        reference_doc: `Pedido ${orderNum}`,
        order_id: orderId
      }])
      .select('id, quantity, reference_doc');

    if (insErr) {
      console.error(`   Error insertando movimiento para SKU ${it.sku}:`, insErr);
    } else {
      console.log(`   ✔ Movimiento de Kardex creado: ${insMov[0]?.reference_doc} (-${insMov[0]?.quantity} un. SKU ${it.sku})`);
    }

    // 4. Rebajar stock físico en inventory
    const { data: invRow } = await supabase
      .from('inventory')
      .select('id, quantity')
      .eq('product_id', prod.id)
      .eq('warehouse_id', it.whId)
      .maybeSingle();

    if (invRow) {
      const stockAntes = invRow.quantity || 0;
      const stockDespues = Math.max(0, stockAntes - it.qty);
      const { error: updErr } = await supabase
        .from('inventory')
        .update({
          quantity: stockDespues,
          updated_at: new Date().toISOString()
        })
        .eq('id', invRow.id);

      if (updErr) {
        console.error(`   Error actualizando inventario para ${it.sku}:`, updErr);
      } else {
        console.log(`   ✔ Inventario Matriz Ñuñoa actualizado: ${it.sku} | Antes: ${stockAntes} -> Después: ${stockDespues}`);
      }
    }
  }

  // 5. Asegurar orden consistente
  await supabase
    .from('orders')
    .update({
      status: 'despachado',
      estado_wms: 'Despachado',
      stock_descontado: true,
      stock_descontado_at: date
    })
    .eq('id', orderId);

  console.log('\n=============================================================');
  console.log('REGULARIZACIÓN DE JOYAS GLOSS FINALIZADA');
  console.log('=============================================================\n');
}

regularizeGloss().catch(console.error);
