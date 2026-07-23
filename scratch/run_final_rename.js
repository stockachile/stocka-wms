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

async function runFinal() {
  console.log('--- RUNNING FINAL RENAME ---');

  // Update orders
  const { data: updatedOrders, error: orderErr } = await supabase
    .from('orders')
    .update({ comercio: 'POM KIDS' })
    .eq('comercio', 'POMS KIDS')
    .select();

  if (orderErr) {
    console.error('Error updating orders:', orderErr.message);
  } else {
    console.log(`Updated orders count: ${updatedOrders ? updatedOrders.length : 0}`);
  }

  // Update products (just in case)
  const { data: updatedProducts, error: prodErr } = await supabase
    .from('products')
    .update({ comercio: 'POM KIDS' })
    .eq('comercio', 'POMS KIDS')
    .select();

  if (prodErr) {
    console.error('Error updating products:', prodErr.message);
  } else {
    console.log(`Updated products count: ${updatedProducts ? updatedProducts.length : 0}`);
  }

  // Print final counts
  const tables = [
    'products',
    'orders',
    'stock_declarations',
    'comercios_adicional_config',
    'profiles',
    'merchant_integrations',
    'synced_products',
    'sku_equivalences',
    'incidencias',
    'recepciones'
  ];

  console.log('\n--- FINAL COUNTS CHECKS ---');
  for (const table of tables) {
    try {
      const { data, error } = await supabase.from(table).select('*').limit(1);
      if (error) continue;
      if (!data || data.length === 0) continue;
      const keys = Object.keys(data[0]);
      if (keys.includes('comercio')) {
        const { count: oldK } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true })
          .eq('comercio', 'POMS KIDS');

        const { count: newK } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true })
          .eq('comercio', 'POM KIDS');

        console.log(`Table ${table}: POMS KIDS = ${oldK || 0}, POM KIDS = ${newK || 0}`);
      }
    } catch (e) {
      console.error(e.message);
    }
  }
}

runFinal();
