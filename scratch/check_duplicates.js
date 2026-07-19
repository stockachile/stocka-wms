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
  const orders = ['MAG5592', 'MAG5593', 'MAG5588'];
  
  for (const num of orders) {
    const { data: o } = await supabase.from('orders').select('id').eq('external_order_number', num).eq('comercio', 'MAGIC MAKEUP').maybeSingle();
    if (!o) {
      console.log(`Orden ${num} no encontrada.`);
      continue;
    }
    
    const { data: items } = await supabase.from('order_items').select('id, product_id, quantity, warehouse_id, products(sku)').eq('order_id', o.id);
    console.log(`=== ITEMS EN LA DB PARA ORDEN ${num} (ID: ${o.id}) ===`);
    console.log(`Total rows in order_items for this order: ${items.length}`);
    
    // Contar duplicados por SKU
    const countMap = {};
    items.forEach(item => {
      const sku = item.products?.sku || 'N/A';
      if (!countMap[sku]) countMap[sku] = [];
      countMap[sku].push(item.id);
    });
    
    Object.keys(countMap).forEach(sku => {
      console.log(`  SKU: ${sku} -> Encontrado ${countMap[sku].length} veces. IDs de las filas:`);
      console.log(`    ${countMap[sku].slice(0, 5).join(', ')}${countMap[sku].length > 5 ? ' ...' : ''}`);
    });
    console.log('\n');
  }
}

check();
