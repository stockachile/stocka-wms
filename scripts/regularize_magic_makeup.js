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

async function regularizeMagicMakeup() {
  console.log('=== REGULARIZACIÓN DEL COMERCIO: MAGIC MAKEUP ===\n');

  const ordersToFix = [
    {
      orderId: '07f3c593-1afc-426c-b00a-7a0bd476ed5c',
      orderNum: 'MAG5695',
      date: '2026-10-06T15:23:44+00:00',
      foreignMovIds: ['3a4821d5-0402-4fc4-b3fd-df986ffd7816'],
      items: [
        { sku: 'MAGIC006', qty: 2, whId: '973da888-8a63-4790-a08f-919e1af41a93' },
        { sku: 'MAGIC007', qty: 1, whId: '973da888-8a63-4790-a08f-919e1af41a93' }
      ]
    },
    {
      orderId: '54109dba-591c-40e3-bbac-685b8de04c5e',
      orderNum: 'MAG5686',
      date: '2026-10-05T20:12:00+00:00',
      foreignMovIds: ['a5010fa0-ba96-4563-8bcf-16d7a2d4ee4b'],
      items: [
        { sku: 'MAGIC034', qty: 1, whId: '973da888-8a63-4790-a08f-919e1af41a93' }
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

    // 2. Obtener producto de MAGIC MAKEUP
    for (const it of o.items) {
      const { data: prod, error: pErr } = await supabase
        .from('products')
        .select('id, name')
        .eq('sku', it.sku)
        .eq('comercio', 'MAGIC MAKEUP')
        .single();

      if (!prod || pErr) {
        console.error(`   No se encontró producto con SKU ${it.sku} en MAGIC MAKEUP:`, pErr);
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
  console.log('REGULARIZACIÓN DE MAGIC MAKEUP FINALIZADA');
  console.log('=============================================================\n');
}

regularizeMagicMakeup().catch(console.error);
