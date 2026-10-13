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

async function regularizeNomad() {
  console.log('=== REGULARIZACIÓN DEL COMERCIO: NOMAD ===\n');

  const ordersToFix = [
    {
      orderId: 'bbebcc57-b8df-4519-bfa4-ccab6d04ad2a',
      orderNum: 'NOM#1067',
      date: '2026-10-05T00:32:13+00:00',
      foreignMovIds: ['0def8c48-34d0-45a1-b18e-4801d0d605eb'],
      items: [
        { sku: '43626884497614', qty: 1, whId: '973da888-8a63-4790-a08f-919e1af41a93' }
      ]
    },
    {
      orderId: 'e59fedb7-47d3-4996-80a9-8b14e4d487a6',
      orderNum: 'NOM#1047',
      date: '2026-10-02T21:38:05+00:00',
      foreignMovIds: [
        '5436740c-6d21-467d-9d26-4fcf8f455b87',
        '5a2322e4-48b1-4421-b2d9-e7e2338d54c2',
        '06b504bb-20bb-436b-b631-c811f4b16510'
      ],
      items: [
        { sku: '43626884497614', qty: 2, whId: '973da888-8a63-4790-a08f-919e1af41a93' }
      ]
    },
    {
      orderId: 'a18faf06-0f90-434a-9bea-e0bb769d6ae1',
      orderNum: 'NOM#1039',
      date: '2026-10-01T14:15:22+00:00',
      foreignMovIds: ['575e2583-328f-4329-8f94-10ef24179c03'],
      items: [
        { sku: '43626884464846', qty: 2, whId: '973da888-8a63-4790-a08f-919e1af41a93' }
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
      else console.log(`   ✔ Movimiento ajeno ${fId} desvinculado.`);
    }

    // 2. Obtener product_id para cada SKU
    for (const it of o.items) {
      const { data: prod } = await supabase
        .from('products')
        .select('id, name')
        .eq('sku', it.sku)
        .eq('comercio', 'NOMAD')
        .single();

      if (!prod) {
        console.error(`   No se encontró producto con SKU ${it.sku} en NOMAD`);
        continue;
      }

      // 3. Insertar movimiento en Kardex
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
        console.log(`   ✔ Movimiento de Kardex creado: ${insMov[0]?.reference_doc} (-${insMov[0]?.quantity} un.)`);
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
  console.log('REGULARIZACIÓN DE NOMAD FINALIZADA');
  console.log('=============================================================\n');
}

regularizeNomad().catch(console.error);
