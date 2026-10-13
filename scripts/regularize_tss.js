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

async function regularizeTSS() {
  console.log('=== REGULARIZACIÓN DEL COMERCIO: THE SKIN STORE ===\n');

  const ordersToFix = [
    {
      orderId: 'f5aa173e-7829-4350-8327-67866149f5d4',
      orderNum: 'TSS1250',
      date: '2026-10-06T11:38:34+00:00',
      foreignMovIds: ['738f22e8-a66e-48a5-9eb9-6d9a0670fba8'],
      items: [
        { sku: 'DR0004', qty: 1, whId: '973da888-8a63-4790-a08f-919e1af41a93' }
      ]
    },
    {
      orderId: '71166ed5-e1cb-4c86-86ec-54d20c44063a',
      orderNum: 'TSS1083',
      date: '2026-07-28T13:29:07+00:00',
      foreignMovIds: [],
      items: [
        { sku: 'DR0004', qty: 1, whId: '973da888-8a63-4790-a08f-919e1af41a93' }
      ]
    }
  ];

  for (const o of ordersToFix) {
    console.log(`\n• Procesando orden ${o.orderNum} (${o.orderId})...`);

    // 1. Desvincular movimientos ajenos
    for (const fId of o.foreignMovIds) {
      const { error: unErr } = await supabase
        .from('movements')
        .update({ order_id: null })
        .eq('id', fId);
      if (unErr) console.error(`   Error desvinculando movimiento ${fId}:`, unErr);
      else console.log(`   ✔ Movimiento ajeno ${fId} desvinculado (order_id = null).`);
    }

    // 2. Obtener producto de THE SKIN STORE
    for (const it of o.items) {
      const { data: prod, error: pErr } = await supabase
        .from('products')
        .select('id, name')
        .eq('sku', it.sku)
        .eq('comercio', 'THE SKIN STORE')
        .single();

      if (!prod || pErr) {
        console.error(`   No se encontró producto con SKU ${it.sku} en THE SKIN STORE:`, pErr);
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
          date: o.date,
          reference_doc: `Pedido ${o.orderNum}`,
          order_id: o.orderId
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
        stock_descontado_at: o.date
      })
      .eq('id', o.orderId);
  }

  console.log('\n=============================================================');
  console.log('REGULARIZACIÓN DE THE SKIN STORE FINALIZADA');
  console.log('=============================================================\n');
}

regularizeTSS().catch(console.error);
