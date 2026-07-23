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

async function findOther() {
  const tables = [
    'merchant_integrations',
    'synced_products',
    'sku_equivalences',
    'movements'
  ];

  for (const table of tables) {
    try {
      const { data, error } = await supabase.from(table).select('*').limit(1);
      if (error) {
        console.error(`Error querying table ${table}:`, error.message);
        continue;
      }
      if (!data || data.length === 0) continue;
      
      const keys = Object.keys(data[0]);
      if (keys.includes('comercio')) {
        const { count, error: countErr } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true })
          .eq('comercio', 'POMS KIDS');
        console.log(`Table: ${table} has 'comercio'. POMS KIDS count: ${count || 0}`);
      } else {
        console.log(`Table: ${table} has no 'comercio' column.`);
      }
    } catch (e) {
      console.error(`Exception in table ${table}:`, e.message);
    }
  }
}

findOther();
