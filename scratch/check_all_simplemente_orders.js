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
  console.log('=== ÓRDENES Y MOVIMIENTOS DE SIMPLEMENTE CAFE ===\n');

  // 1. Obtener todos los pedidos despachados
  const { data: orders } = await supabase
    .from('orders')
    .select('*')
    .eq('comercio', 'SIMPLEMENTE CAFE')
    .eq('status', 'despachado');

  console.log(`Se encontraron ${orders.length} pedidos despachados:\n`);

  for (const o of orders) {
    console.log(`Pedido ID: ${o.id} | Número: ${o.external_order_number} | Creado: ${o.created_at}`);
    
    // Buscar movimientos para este pedido (la referencia tiene 'Pedido ' + id)
    const { data: movs } = await supabase
      .from('movements')
      .select('*')
      .eq('reference_doc', `Pedido ${o.id}`);

    console.log(`- Movimientos registrados:`, movs);
  }
}

check();
