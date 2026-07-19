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

async function check() {
  const targetSkus = ['MAGIC029', 'MAGIC048', 'MAGIC042', 'MAGIC041', 'MAGIC043', 'MAGIC045'];
  
  console.log('=== CANTIDADES EN PEDIDOS DE SHOPIFY ===');

  for (const sku of targetSkus) {
    const { data: prod } = await supabase
      .from('products')
      .select('id')
      .eq('sku', sku)
      .eq('comercio', 'MAGIC MAKEUP')
      .maybeSingle();

    if (!prod) continue;

    const { data: items } = await supabase
      .from('order_items')
      .select(`
        quantity,
        order_id,
        orders (
          id,
          external_order_number,
          external_platform,
          status
        )
      `)
      .eq('product_id', prod.id);

    console.log(`\nSKU: ${sku}`);
    let sumTotal = 0;
    
    for (const item of items) {
      const order = item.orders;
      if (!order) continue;
      if (order.external_platform !== 'Shopify') continue;
      
      const isTerminal = ['despachado', 'cancelado', 'entregado', 'retirado'].includes(order.status?.toLowerCase().trim());
      if (isTerminal) continue;

      const { data: shouldProcess } = await supabase.rpc('should_process_order_stock', {
        p_order_id: order.id
      });
      
      console.log(`  - Pedido: ${order.external_order_number} | Cantidad: ${item.quantity} | Estado: ${order.status} | Tracked: ${shouldProcess}`);
      sumTotal += item.quantity;
    }
    console.log(`  Suma total en Shopify activos: ${sumTotal}`);
  }
}

check();
