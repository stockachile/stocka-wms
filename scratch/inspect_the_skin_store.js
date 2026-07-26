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

async function run() {
  console.log('--- Checking Comercio config ---');
  const { data: config, error: configErr } = await supabase
    .from('comercios_adicional_config')
    .select('*')
    .eq('comercio', 'THE SKIN STORE')
    .maybeSingle();

  if (configErr) {
    console.error('Error fetching config:', configErr);
  } else {
    console.log('Config:', JSON.stringify(config, null, 2));
  }

  console.log('\n--- Fetching Recent Orders ---');
  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('*, order_items(*, products(*))')
    .eq('comercio', 'THE SKIN STORE')
    .order('created_at', { ascending: false })
    .limit(5);

  if (ordersErr) {
    console.error('Error fetching orders:', ordersErr);
    return;
  }

  for (const order of orders) {
    console.log(`\nOrder: ${order.external_order_number || order.id} (WMS: ${order.estado_wms}, Status: ${order.status})`);
    for (const item of order.order_items || []) {
      const prod = item.products || {};
      console.log(` - SKU: ${prod.sku} | Name: ${prod.name} | Qty needed: ${item.quantity} | Is Virtual: ${prod.is_virtual}`);
      
      // Query inventory for this product
      const { data: inv } = await supabase
        .from('inventory')
        .select('*, warehouses(name)')
        .eq('product_id', item.product_id);
      
      console.log('   Inventory:');
      if (!inv || inv.length === 0) {
        console.log('     No inventory records found for this product.');
      } else {
        inv.forEach(i => {
          console.log(`     Bodega: ${i.warehouses?.name} | Physical: ${i.quantity} | Committed: ${i.committed_quantity}`);
        });
      }
    }
  }
}

run();
