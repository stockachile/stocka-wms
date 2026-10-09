const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
envContent.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length >= 2) {
    const key = parts[0].trim();
    const val = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
    process.env[key] = val;
  }
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function regularize() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const targetComercio = args.find(a => !a.startsWith('--'));

  console.log('=== REGULARIZADOR DE MOVIMIENTOS FALTANTES EN KARDEX ===');
  console.log(`Modo: ${isDryRun ? 'DRY-RUN (Simulación sin cambios)' : 'APLICAR CAMBIOS REALES'}`);
  console.log(`Filtro comercio: ${targetComercio || 'TODOS LOS CONFIRMADOS POR COLISIÓN'}`);

  const reportPath = path.join(__dirname, 'instant_audit_report.json');
  if (!fs.existsSync(reportPath)) {
    console.error('No se encontró instant_audit_report.json. Ejecuta audit_system_instant.js primero.');
    return;
  }

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  let ordersToProcess = [];

  if (targetComercio) {
    ordersToProcess = report.byCommerce[targetComercio] || [];
  } else {
    // Si no se especifica comercio, procesar solo los que tienen colisión confirmada
    for (const [com, list] of Object.entries(report.byCommerce)) {
      ordersToProcess.push(...list.filter(o => o.collisionWith));
    }
  }

  console.log(`\nPedidos seleccionados para regularización: ${ordersToProcess.length}`);

  let movementsInserted = 0;
  let inventoryUpdates = 0;
  const localInvMap = new Map(); // key: `${product_id}_${warehouse_id}` -> current quantity

  for (const ord of ordersToProcess) {
    console.log(`\n• Procesando Pedido: ${ord.external_order_number} (${ord.comercio}) - Fecha: ${ord.created_at.substring(0, 10)}`);
    
    for (const item of ord.items) {
      if (!item.warehouse_id) {
        console.warn(`   [AVISO] Ítem ${item.sku} no tiene warehouse_id asignado. Omitiendo.`);
        continue;
      }

      // 1. Doble verificación en BD para evitar duplicados
      const { data: existingMov } = await supabase
        .from('movements')
        .select('id')
        .eq('order_id', ord.id)
        .eq('product_id', item.product_id)
        .eq('type', 'out')
        .limit(1);

      if (existingMov && existingMov.length > 0) {
        console.log(`   [SKIP] SKU ${item.sku} ya cuenta con movimiento en BD.`);
        continue;
      }

      // 2. Consultar stock actual en inventario
      const invKey = `${item.product_id}_${item.warehouse_id}`;
      let invRowId = null;
      let currentQty = 0;

      if (localInvMap.has(invKey)) {
        currentQty = localInvMap.get(invKey).quantity;
        invRowId = localInvMap.get(invKey).id;
      } else {
        const { data: invRow } = await supabase
          .from('inventory')
          .select('id, quantity')
          .eq('product_id', item.product_id)
          .eq('warehouse_id', item.warehouse_id)
          .maybeSingle();

        invRowId = invRow ? invRow.id : null;
        currentQty = invRow ? (invRow.quantity || 0) : 0;
      }

      const newQty = Math.max(0, currentQty - item.quantity);
      localInvMap.set(invKey, { id: invRowId, quantity: newQty });

      console.log(`   -> SKU: ${item.sku} | Qty a descontar: ${item.quantity} | Stock antes: ${currentQty} -> Stock después: ${newQty}`);

      if (!isDryRun) {
        // Insertar movimiento
        const { error: insErr } = await supabase
          .from('movements')
          .insert([{
            product_id: item.product_id,
            warehouse_id: item.warehouse_id,
            type: 'out',
            quantity: item.quantity,
            date: ord.created_at, // Mantener fecha histórica del pedido
            reference_doc: `Pedido ${ord.external_order_number || ord.id}`,
            order_id: ord.id
          }]);

        if (insErr) {
          console.error(`   [ERROR] Insertando movimiento para ${item.sku}:`, insErr);
        } else {
          movementsInserted++;
        }

        // Actualizar stock en inventory
        if (invRowId) {
          const { error: updInvErr } = await supabase
            .from('inventory')
            .update({ quantity: newQty })
            .eq('id', invRowId);
          
          if (updInvErr) console.error(`   [ERROR] Actualizando inventario para ${item.sku}:`, updInvErr);
          else inventoryUpdates++;
        }
      }
    }

    if (!isDryRun) {
      await supabase
        .from('orders')
        .update({
          stock_descontado: true,
          stock_descontado_at: ord.created_at
        })
        .eq('id', ord.id);
    }
  }

  console.log('\n========================================');
  console.log(`REGULARIZACIÓN ${isDryRun ? 'SIMULADA' : 'FINALIZADA'}:`);
  console.log(`Movimientos ${isDryRun ? 'a insertar' : 'insertados'}: ${isDryRun ? 'N/A' : movementsInserted}`);
  console.log(`Registros de inventario ${isDryRun ? 'a actualizar' : 'actualizados'}: ${isDryRun ? 'N/A' : inventoryUpdates}`);
  console.log('========================================\n');
}

regularize();
