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

async function renamePhase2() {
  console.log('Starting Phase 2 rename from POMS KIDS to POM KIDS...');

  // 1. Update merchant_integrations
  const { error: intErr } = await supabase
    .from('merchant_integrations')
    .update({ comercio: 'POM KIDS' })
    .eq('comercio', 'POMS KIDS');

  if (intErr) console.error('Error updating merchant_integrations:', intErr.message);
  else console.log('Updated merchant_integrations successfully.');

  // 2. Update synced_products
  const { error: syncErr } = await supabase
    .from('synced_products')
    .update({ comercio: 'POM KIDS' })
    .eq('comercio', 'POMS KIDS');

  if (syncErr) console.error('Error updating synced_products:', syncErr.message);
  else console.log('Updated synced_products successfully.');

  // 3. Double check all counts
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

  for (const table of tables) {
    try {
      const { data, error } = await supabase.from(table).select('*').limit(1);
      if (error) continue;
      if (!data || data.length === 0) continue;
      const keys = Object.keys(data[0]);
      if (keys.includes('comercio')) {
        const { count } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true })
          .eq('comercio', 'POMS KIDS');
        if (count > 0) {
          console.log(`WARNING: Table ${table} still has ${count} records with POMS KIDS!`);
        } else {
          console.log(`Table ${table}: 0 records with POMS KIDS.`);
        }
      }
    } catch (e) {
      console.error(e.message);
    }
  }

  console.log('Phase 2 migration finished.');
}

renamePhase2();
