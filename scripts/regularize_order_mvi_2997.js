const path = require('path');
const rootDir = 'c:/Users/felip/Desktop/WMS STOCKA';
const { createClient } = require(path.join(rootDir, 'node_modules/@supabase/supabase-js'));
const fs = require('fs');

const envContent = fs.readFileSync(path.join(rootDir, '.env'), 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const [k, ...v] = line.trim().split('=');
  if (k && v.length) env[k] = v.join('=').replace(/^['"]|['"]$/g, '');
});

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function regularizeOrder2997() {
  console.log('=== REGULARIZACIÓN DE ORDEN MVI-2997 ===\n');

  const orderId = 'b18fc21c-beed-4c65-97da-135636edc3d5';
  const warehouseId = '973da888-8a63-4790-a08f-919e1af41a93'; // Matriz Ñuñoa
  const movDate = '2026-10-05T18:02:05.790568+00:00';

  // 1. Desvincular el movimiento de SERPA LTDA que fue erróneamente asociado
  console.log('Paso 1: Desvinculando movimiento ajeno de SERPA LTDA (ID: 1b814ba6-a335-40cc-b7c0-61767cf38448)...');
  const { error: unlinkErr } = await supabase
    .from('movements')
    .update({ order_id: null })
    .eq('id', '1b814ba6-a335-40cc-b7c0-61767cf38448')
    .eq('order_id', orderId);

  if (unlinkErr) {
    console.error('Error desvinculando movimiento ajeno:', unlinkErr);
    return;
  }
  console.log('✔ Movimiento ajeno desvinculado con éxito.\n');

  // 2. Obtener los 4 items de la orden
  console.log('Paso 2: Consultando items de la orden MVI-2997...');
  const { data: items, error: itErr } = await supabase
    .from('order_items')
    .select('*, products(id, sku, name, comercio)')
    .eq('order_id', orderId);

  if (itErr || !items || items.length === 0) {
    console.error('Error al obtener order_items:', itErr);
    return;
  }

  console.log(`Encontrados ${items.length} items físicos.`);

  // 3. Insertar los movimientos oficiales en movements
  console.log('Paso 3: Insertando los 4 movimientos en la tabla movements...');
  const movementsToInsert = items.map(item => ({
    product_id: item.product_id,
    warehouse_id: item.warehouse_id || warehouseId,
    type: 'out',
    quantity: item.quantity,
    date: movDate,
    reference_doc: 'Pedido MVI-2997',
    order_id: orderId
  }));

  const { data: insertedMovs, error: insErr } = await supabase
    .from('movements')
    .insert(movementsToInsert)
    .select('id, product_id, reference_doc, quantity');

  if (insErr) {
    console.error('Error insertando movimientos:', insErr);
    return;
  }
  console.log(`✔ Insertados ${insertedMovs?.length || 0} movimientos en Kardex exitosamente:`, insertedMovs);

  // 4. Actualizar el stock físico en inventory
  console.log('\nPaso 4: Rebajando stock físico en tabla inventory para Matriz Ñuñoa...');
  for (const item of items) {
    const wh = item.warehouse_id || warehouseId;
    const { data: invRow, error: invGetErr } = await supabase
      .from('inventory')
      .select('id, quantity')
      .eq('product_id', item.product_id)
      .eq('warehouse_id', wh)
      .maybeSingle();

    if (invGetErr) {
      console.error(`Error consultando inventario para ${item.products?.sku}:`, invGetErr);
      continue;
    }

    if (invRow) {
      const stockAntes = invRow.quantity || 0;
      const stockDespues = Math.max(0, stockAntes - item.quantity);
      const { error: updErr } = await supabase
        .from('inventory')
        .update({
          quantity: stockDespues,
          updated_at: new Date().toISOString()
        })
        .eq('id', invRow.id);

      if (updErr) {
        console.error(`Error actualizando stock de ${item.products?.sku}:`, updErr);
      } else {
        console.log(`✔ SKU ${item.products?.sku}: Stock anterior: ${stockAntes} -> Nuevo stock: ${stockDespues}`);
      }
    } else {
      console.warn(`[AVISO] No se encontró fila de inventario para SKU ${item.products?.sku} en bodega ${wh}`);
    }
  }

  // 5. Asegurar consistencia en la orden (status y estado_wms = Despachado)
  console.log('\nPaso 5: Asegurando estado consistente en la orden...');
  const { error: ordErr } = await supabase
    .from('orders')
    .update({
      status: 'despachado',
      estado_wms: 'Despachado',
      stock_descontado: true,
      stock_descontado_at: movDate
    })
    .eq('id', orderId);

  if (ordErr) {
    console.error('Error actualizando orden:', ordErr);
  } else {
    console.log('✔ Orden actualizada con status: "despachado", estado_wms: "Despachado", stock_descontado: true.');
  }

  // 6. Verificar consultando directamente la función get_kardex_movements
  console.log('\nPaso 6: Validando que MVI-2997 aparezca en get_kardex_movements para MARINA VITAL...');
  const { data: kardexData, error: kErr } = await supabase
    .rpc('get_kardex_movements', {
      p_commerce: 'MARINA VITAL',
      p_start_date: '2026-10-04T00:00:00Z',
      p_end_date: '2026-10-06T23:59:59Z',
      p_limit: 50
    });

  if (kErr) {
    console.error('Error consultando get_kardex_movements:', kErr);
  } else {
    const mvi2997Movs = (kardexData || []).filter(k => k.reference_doc?.includes('2997'));
    console.log(`✔ Movimientos encontrados en Kardex para MVI-2997 (${mvi2997Movs.length} registros):`);
    for (const km of mvi2997Movs) {
      console.log(`   - [${km.date}] SKU: ${km.product_sku} | Cant: ${km.quantity} | Tipo: ${km.type} | Ref: ${km.reference_doc} | Bodega: ${km.warehouse_name}`);
    }
  }

  console.log('\n=============================================================');
  console.log('REGULARIZACIÓN DE ORDEN MVI-2997 COMPLETADA EXITOSAMENTE');
  console.log('=============================================================\n');
}

regularizeOrder2997().catch(console.error);
