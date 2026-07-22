const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

try {
  const envContent = fs.readFileSync('.env', 'utf-8');
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const key = trimmed.substring(0, idx).trim();
      const val = trimmed.substring(idx + 1).trim();
      process.env[key] = val;
    }
  });
} catch (e) {
  console.warn('Advertencia: No se pudo leer el archivo .env:', e.message);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const runFix = process.argv.includes('--execute');

async function replay() {
  console.log('=== VERIFICANDO PEDIDOS DESPACHADOS SIN MOVIMIENTO DE STOCK ===\n');

  // 1. Obtener todas las órdenes despachadas
  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, external_order_number, comercio, created_at, status');

  if (ordersErr) {
    console.error('Error al obtener órdenes:', ordersErr.message);
    return;
  }

  console.log(`Analizando ${orders.length} pedidos despachados...`);

  let skippedCount = 0;

  for (const o of orders) {
    // A. Evaluar si debe procesar stock
    const { data: shouldProcess, error: rpcErr } = await supabase.rpc('should_process_order_stock', {
      p_order_id: o.id
    });

    if (rpcErr) {
      console.error(`Error evaluando should_process para ${o.external_order_number}:`, rpcErr.message);
      continue;
    }

    if (!shouldProcess) continue;

    // B. Buscar si ya existe un movimiento asociado
    const { data: movs, error: movsErr } = await supabase
      .from('movements')
      .select('id')
      .eq('reference_doc', `Pedido ${o.id}`);

    if (movsErr) {
      console.error(`Error buscando movimientos para ${o.external_order_number}:`, movsErr.message);
      continue;
    }

    if (movs && movs.length > 0) {
      // Ya tiene movimientos, está todo bien
      continue;
    }

    // C. Si debería procesar stock pero no tiene movimiento
    skippedCount++;
    console.log(`\n⚠️  PEDIDO SKIPPED DETECTADO:`);
    console.log(`- Comercio: ${o.comercio}`);
    console.log(`- Pedido: ${o.external_order_number}`);
    console.log(`- ID: ${o.id}`);
    console.log(`- Creado: ${o.created_at}`);

    // Obtener los ítems para ver qué stock deberíamos descontar
    const { data: items } = await supabase
      .from('order_items')
      .select(`
        *,
        products (sku, name)
      `)
      .eq('order_id', o.id);

    if (!items || items.length === 0) {
      console.log('  (Sin ítems en el pedido)');
      continue;
    }

    for (const item of items) {
      console.log(`  -> Ítem SKU: ${item.products?.sku} | Nombre: ${item.products?.name} | Cantidad: ${item.quantity} | Bodega ID: ${item.warehouse_id}`);
      
      if (runFix) {
        console.log(`  [EJECUTANDO] Descontando stock del inventario...`);
        const { data: currentInv } = await supabase
          .from('inventory')
          .select('quantity')
          .eq('product_id', item.product_id)
          .eq('warehouse_id', item.warehouse_id)
          .maybeSingle();

        const newQty = (currentInv?.quantity || 0) - item.quantity;

        const { error: invErr } = await supabase
          .from('inventory')
          .update({ quantity: newQty })
          .eq('product_id', item.product_id)
          .eq('warehouse_id', item.warehouse_id);

        if (invErr) {
          console.error(`  ❌ Error actualizando inventario:`, invErr.message);
          continue;
        }

        // Insertar movimiento
        const { error: insertErr } = await supabase
          .from('movements')
          .insert({
            product_id: item.product_id,
            warehouse_id: item.warehouse_id,
            type: 'out',
            quantity: item.quantity,
            reference_doc: `Pedido ${o.id}`
          });

        if (insertErr) {
          console.error(`  ❌ Error insertando movimiento:`, insertErr.message);
        } else {
          console.log(`  ✅ Stock descontado e insertado movimiento de salida.`);
        }
      }
    }
  }

  console.log(`\n=== Fin del Análisis ===`);
  console.log(`Total pedidos omitidos encontrados: ${skippedCount}`);
  if (!runFix && skippedCount > 0) {
    console.log('\nEjecuta el script con la opción --execute para aplicar las correcciones.');
  }
}

replay();
