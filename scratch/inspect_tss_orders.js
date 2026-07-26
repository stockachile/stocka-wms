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
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, external_order_number, created_at, order_items(*)')
    .eq('comercio', 'THE SKIN STORE')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Error fetching orders:', error);
    return;
  }

  console.log(`Checking ${orders.length} orders:`);
  for (const o of orders) {
    console.log(`\nOrder ${o.external_order_number || o.id} (Created at: ${o.created_at})`);
    for (const item of o.order_items || []) {
      console.log(` - Item ID: ${item.id}`);
      console.log(`   Product ID: ${item.product_id}`);
      console.log(`   Sku: ${item.sku}`);
      console.log(`   Quantity: ${item.quantity}`);
      console.log(`   Warehouse ID: ${item.warehouse_id}`);
      
      // Fetch product record
      if (item.product_id) {
        const { data: prod } = await supabase
          .from('products')
          .select('*')
          .eq('id', item.product_id)
          .maybeSingle();
        console.log(`   Resolved Product:`, prod ? `${prod.sku} - ${prod.name}` : 'Not found in products table');
      } else {
        console.log(`   Resolved Product: Product ID is NULL`);
      }
    }
  }
}

run();
