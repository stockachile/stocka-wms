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

async function regularizeCollisions() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const targetCommerce = args.find(a => !a.startsWith('--'));

  console.log('================================================================');
  console.log('REGULARIZADOR DE ÓRDENES CON COLISIÓN CRUZADA DE KARDEX');
  console.log(`Modo: ${isApply ? 'APLICAR CAMBIOS EN BASE DE DATOS' : 'DRY-RUN (Simulación sin cambios)'}`);
  if (targetCommerce) console.log(`Filtro comercio: "${targetCommerce}"`);
  console.log('================================================================\n');

  const reportPath = path.join(__dirname, 'kardex_integrity_report.json');
  if (!fs.existsSync(reportPath)) {
    console.error('No se encontró scripts/kardex_integrity_report.json. Ejecuta scripts/audit_kardex_integrity.js primero.');
    return;
  }

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  let collisionCases = report.mismatchedOrders || [];

  if (targetCommerce) {
    collisionCases = collisionCases.filter(c => c.order.comercio?.toUpperCase() === targetCommerce.toUpperCase());
  }

  console.log(`Total casos con colisión cruzada a procesar: ${collisionCases.length}\n`);

  let unlinkedCount = 0;
  let movementsInsertedCount = 0;
  let inventoryDeductionsCount = 0;

  for (const item of collisionCases) {
    const ord = item.order;
    console.log(`\n• Procesando: ${ord.external_order_number || ord.id} (${ord.comercio}) - Fecha: ${ord.created_at?.substring(0, 10)}`);

    // A. Desvincular movimientos ajenos
    for (const bm of item.badMovements) {
      console.log(`   [DESVINCULAR] Mov ajeno ID ${bm.id} ("${bm.reference_doc}" | ${bm.products?.comercio})`);
      if (isApply) {
        const { error: unErr } = await supabase
          .from('movements')
          .update({ order_id: null })
          .eq('id', bm.id);
        if (unErr) console.error(`   Error desvinculando mov ${bm.id}:`, unErr);
        else unlinkedCount++;
      } else {
        unlinkedCount++;
      }
    }

    // B. Consultar items reales de la orden
    const { data: realItems, error: itemsErr } = await supabase
      .from('order_items')
      .select('id, product_id, quantity, warehouse_id, products(id, sku, name, is_virtual)')
      .eq('order_id', ord.id);

    if (itemsErr || !realItems) {
      console.error(`   Error obteniendo order_items para ${ord.id}:`, itemsErr);
      continue;
    }

    const physicalItems = realItems.filter(i => i.products && !i.products.is_virtual && i.quantity > 0);

    for (const it of physicalItems) {
      // Verificar si ya tiene un movimiento real insertado
      const { data: existingMov } = await supabase
        .from('movements')
        .select('id')
        .eq('order_id', ord.id)
        .eq('product_id', it.product_id)
        .eq('type', 'out')
        .limit(1);

      if (existingMov && existingMov.length > 0) {
        console.log(`   [SKIP] SKU ${it.products?.sku} ya tiene movimiento oficial registrado.`);
        continue;
      }

      console.log(`   -> SKU: ${it.products?.sku} | Cantidad a descontar: ${it.quantity} | Bodega: ${it.warehouse_id}`);

      if (isApply) {
        // Insertar movimiento oficial
        const { error: insErr } = await supabase
          .from('movements')
          .insert([{
            product_id: it.product_id,
            warehouse_id: it.warehouse_id,
            type: 'out',
            quantity: it.quantity,
            date: ord.stock_descontado_at || ord.created_at || new Date().toISOString(),
            reference_doc: `Pedido ${ord.external_order_number || ord.id}`,
            order_id: ord.id
          }]);

        if (insErr) {
          console.error(`   Error insertando movimiento para SKU ${it.products?.sku}:`, insErr);
        } else {
          movementsInsertedCount++;
        }

        // Rebajar stock en inventory
        if (it.warehouse_id) {
          const { data: invRow } = await supabase
            .from('inventory')
            .select('id, quantity')
            .eq('product_id', it.product_id)
            .eq('warehouse_id', it.warehouse_id)
            .maybeSingle();

          if (invRow) {
            const newQty = Math.max(0, (invRow.quantity || 0) - it.quantity);
            const { error: updInvErr } = await supabase
              .from('inventory')
              .update({ quantity: newQty, updated_at: new Date().toISOString() })
              .eq('id', invRow.id);

            if (updInvErr) console.error(`   Error rebajando inventario para ${it.products?.sku}:`, updInvErr);
            else inventoryDeductionsCount++;
          }
        }
      } else {
        movementsInsertedCount++;
        inventoryDeductionsCount++;
      }
    }
  }

  console.log('\n================================================================');
  console.log(`RESUMEN DE REGULARIZACIÓN (${isApply ? 'EJECUTADO EN BASE DE DATOS' : 'SIMULADO - DRY RUN'}):`);
  console.log(`- Movimientos ajenos desvinculados: ${unlinkedCount}`);
  console.log(`- Movimientos legítimos insertados en Kardex: ${movementsInsertedCount}`);
  console.log(`- Registros de stock físico actualizados: ${inventoryDeductionsCount}`);
  console.log('================================================================\n');
}

regularizeCollisions().catch(console.error);
