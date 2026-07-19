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

async function debug() {
  const targetSkus = ['MAGIC029', 'MAGIC042', 'MAGIC041', 'MAGIC043', 'MAGIC044'];

  console.log('=== INVESTIGANDO CANTIDADES COMPROMETIDAS ===\n');

  for (const sku of targetSkus) {
    console.log(`Analizando SKU: ${sku}`);
    
    // Buscar producto
    const { data: prod } = await supabase
      .from('products')
      .select('id, name')
      .eq('sku', sku)
      .eq('comercio', 'MAGIC MAKEUP')
      .maybeSingle();

    if (!prod) {
      console.log(`❌ Producto con SKU ${sku} no encontrado para MAGIC MAKEUP.`);
      continue;
    }

    // Buscar todos los order_items correspondientes a este product_id en órdenes activas
    const { data: items, error } = await supabase
      .from('order_items')
      .select(`
        quantity,
        warehouse_id,
        order_id,
        orders (
          id,
          external_order_number,
          external_platform,
          status,
          created_at,
          comercio
        )
      `)
      .eq('product_id', prod.id);

    if (error) {
      console.error('Error fetching order items:', error.message);
      continue;
    }

    let activeItems = [];
    let inactiveItems = [];

    for (const item of items) {
      const order = item.orders;
      if (!order) continue;

      const isTerminal = ['despachado', 'cancelado', 'entregado', 'retirado'].includes(order.status?.toLowerCase().trim());
      
      // Evaluar should_process_order_stock
      const { data: shouldProcess } = await supabase.rpc('should_process_order_stock', {
        p_order_id: order.id
      });

      const info = {
        order_id: order.id,
        order_num: order.external_order_number || order.id,
        platform: order.external_platform || 'Manual',
        status: order.status,
        comercio: order.comercio,
        qty: item.quantity,
        created_at: order.created_at,
        shouldProcess: shouldProcess,
        isTerminal: isTerminal
      };

      if (!isTerminal && shouldProcess) {
        activeItems.push(info);
      } else {
        inactiveItems.push(info);
      }
    }

    console.log(`  Pedidos ACTIVO + PROCESABLE (Comprometen stock) [Total: ${activeItems.length} pedidos]:`);
    let sumQty = 0;
    activeItems.forEach(ai => {
      sumQty += ai.qty;
      console.log(`    - Pedido: ${ai.order_num} | Plataforma: ${ai.platform} | Comercio: ${ai.comercio} | Cantidad: ${ai.qty} | Estado: ${ai.status} | Creado: ${ai.created_at}`);
    });
    console.log(`  Suma total calculada para comprometido de ${sku}: ${sumQty}`);
    
    // Ver valor en la tabla inventory
    const { data: inv } = await supabase
      .from('inventory')
      .select('quantity, committed_quantity')
      .eq('product_id', prod.id)
      .eq('warehouse_id', 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09')
      .maybeSingle();

    console.log(`  Valor en tabla inventory para Bodega Central: Físico=${inv ? inv.quantity : 'N/A'}, Comprometido=${inv ? inv.committed_quantity : 'N/A'}`);
    console.log('\n------------------------------------------------------------\n');
  }
}

debug();
