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

async function find() {
  console.log('=== BUSCANDO EN TODA LA DB ===\n');

  // 1. Listar comercios únicos en la tabla products
  const { data: prods } = await supabase
    .from('products')
    .select('comercio')
    .limit(100);
  
  const distinctComercios = [...new Set((prods || []).map(p => p.comercio))];
  console.log('Comercios detectados en products:', distinctComercios);

  // 2. Buscar producto SKU '2-1'
  const { data: foundProds } = await supabase
    .from('products')
    .select('*')
    .eq('sku', '2-1');
  console.log('\nProductos con SKU "2-1":', foundProds);

  // 3. Buscar pedido SIM3479
  const { data: foundOrders } = await supabase
    .from('orders')
    .select('*')
    .ilike('external_order_number', '%SIM3479%');
  console.log('\nPedidos que contienen "SIM3479":', foundOrders);
}

find();
