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
  console.log('=== INSPECCIÓN DE ITEMS DEL PEDIDO SIM3479 ===\n');

  const { data: order } = await supabase
    .from('orders')
    .select('id, external_order_number')
    .eq('external_order_number', 'SIM3479')
    .eq('comercio', 'SIMPLEMENTE CAFE')
    .maybeSingle();

  if (!order) {
    console.log('Pedido SIM3479 no encontrado.');
    return;
  }

  const { data: items, error } = await supabase
    .from('order_items')
    .select(`
      id,
      product_id,
      warehouse_id,
      quantity,
      products (sku, name, comercio)
    `)
    .eq('order_id', order.id);

  if (error) {
    console.error('Error fetching items:', error.message);
    return;
  }

  console.log(`Ítems en order_items para SIM3479 (Total: ${items.length}):`);
  items.forEach(item => {
    console.log(`- ID: ${item.id} | SKU: ${item.products?.sku} | Nombre: ${item.products?.name} | Cantidad: ${item.quantity} | Comercio del Producto: ${item.products?.comercio}`);
  });
}

check();
