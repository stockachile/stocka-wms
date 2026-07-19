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
  const num = 'MAG5592';
  const { data: o } = await supabase
    .from('orders')
    .select('raw_shopify_data')
    .eq('external_order_number', num)
    .eq('comercio', 'MAGIC MAKEUP')
    .maybeSingle();

  if (!o) {
    console.log('Order not found');
    return;
  }

  console.log(`=== RAW SHOPIFY LINE ITEMS FOR ${num} ===`);
  const raw = o.raw_shopify_data;
  if (!raw || !raw.line_items) {
    console.log('No raw line items');
    return;
  }

  console.log(`Total raw line items: ${raw.line_items.length}`);
  raw.line_items.forEach((item, idx) => {
    console.log(`[#${idx + 1}] SKU: ${item.sku} | Cantidad: ${item.quantity} | Título: ${item.title}`);
  });
}

check();
