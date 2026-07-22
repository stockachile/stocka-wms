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
  console.log('=== DIAGNÓSTICO SIMPLEMENTE CAFE ===\n');

  // 1. Obtener comercio config
  const { data: config } = await supabase
    .from('comercios_adicional_config')
    .select('*')
    .eq('comercio', 'SIMPLEMENTE CAFE')
    .maybeSingle();

  console.log('Configuración de Comercio:', JSON.stringify(config, null, 2));

  // 2. Obtener producto
  const { data: product } = await supabase
    .from('products')
    .select('*')
    .eq('sku', '2-1')
    .eq('comercio', 'SIMPLEMENTE CAFE')
    .maybeSingle();

  console.log('\nProducto sku "2-1":', product);

  if (product) {
    const { data: inv } = await supabase
      .from('inventory')
      .select('*')
      .eq('product_id', product.id);
    console.log('Inventario del Producto:', inv);
  }

  // 3. Obtener pedido SIM3479
  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('external_order_number', 'SIM3479')
    .eq('comercio', 'SIMPLEMENTE CAFE')
    .maybeSingle();

  console.log('\nPedido SIM3479:', order);

  if (order) {
    const { data: items } = await supabase
      .from('order_items')
      .select(`
        *,
        products (sku, name)
      `)
      .eq('order_id', order.id);
    console.log('Ítems del Pedido:', items);

    // Evaluar RPC should_process_order_stock
    const { data: shouldProcess, error: rpcErr } = await supabase.rpc('should_process_order_stock', {
      p_order_id: order.id
    });
    console.log('should_process_order_stock para este pedido:', shouldProcess, rpcErr ? rpcErr.message : '');

    // Veamos también si tiene movimientos
    const { data: movements } = await supabase
      .from('movements')
      .select('*')
      .eq('product_id', product.id);
    console.log('Movimientos registrados para el producto:', movements);
  }
}

check();
