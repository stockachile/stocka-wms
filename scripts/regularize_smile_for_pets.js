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

async function regularizeSmile() {
  console.log('=== REGULARIZACIÓN DEL COMERCIO: SMILE FOR PETS ===\n');

  const ordersToFix = [
    {
      orderId: '16dbda66-e975-49f1-a634-5897f914500c',
      orderNum: 'SFPFAC550',
      date: '2026-10-03T15:07:00+00:00',
      foreignMovIds: ['6c8192fe-b3ab-4038-b40b-4a8b68e6f866'],
      items: [
        { sku: 'GD005', qty: 12, whId: '973da888-8a63-4790-a08f-919e1af41a93' }
      ]
    },
    {
      orderId: 'ed692451-0997-423a-abd7-33a958257bfc',
      orderNum: 'FAC543',
      date: '2026-09-30T15:27:52+00:00',
      foreignMovIds: ['061f993b-cfb3-4eac-a803-0eb64dfb076f'],
      items: [
        { sku: 'GD005', qty: 132, whId: '973da888-8a63-4790-a08f-919e1af41a93' },
        { sku: 'TD006', qty: 48, whId: '973da888-8a63-4790-a08f-919e1af41a93' }
      ]
    },
    {
      orderId: '13a87293-2d7d-4bbf-b106-967d20fc1464',
      orderNum: 'SFPFAC541',
      date: '2026-09-25T19:36:25+00:00',
      foreignMovIds: ['5bc0858d-86fa-4954-9134-765ab1da7a24'],
      items: [
        { sku: 'TD006', qty: 12, whId: '973da888-8a63-4790-a08f-919e1af41a93' },
        { sku: 'GD005', qty: 12, whId: '973da888-8a63-4790-a08f-919e1af41a93' }
      ]
    },
    {
      orderId: 'acf9f10d-4963-443f-af9f-010724357884',
      orderNum: 'SFP#3748',
      date: '2026-10-02T17:52:52+00:00',
      foreignMovIds: [
        '6a1bb5a3-4261-4e63-88b5-ebbb21d8f4d4',
        '53b451ce-0cff-483f-807a-ee9028b1a39d'
      ],
      items: [
        { sku: 'GD005', qty: 1, whId: '973da888-8a63-4790-a08f-919e1af41a93' }
      ]
    },
    {
      orderId: '5a57f7d6-f910-4b61-9a05-e2435a1818dc',
      orderNum: 'SFPCOT142',
      date: '2026-10-03T15:04:08+00:00',
      foreignMovIds: ['ad87ee15-e8fb-4044-b71f-3a7659193dca'],
      items: [
        { sku: 'PD001', qty: 6, whId: '973da888-8a63-4790-a08f-919e1af41a93' },
        { sku: 'TD006', qty: 6, whId: '973da888-8a63-4790-a08f-919e1af41a93' },
        { sku: 'GD009', qty: 6, whId: '973da888-8a63-4790-a08f-919e1af41a93' }
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

    // 2. Obtener producto de SMILE FOR PETS
    for (const it of o.items) {
      const { data: prod, error: pErr } = await supabase
        .from('products')
        .select('id, name')
        .eq('sku', it.sku)
        .eq('comercio', 'SMILE FOR PETS')
        .single();

      if (!prod || pErr) {
        console.error(`   No se encontró producto con SKU ${it.sku} en SMILE FOR PETS:`, pErr);
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
  console.log('REGULARIZACIÓN DE SMILE FOR PETS FINALIZADA');
  console.log('=============================================================\n');
}

regularizeSmile().catch(console.error);
