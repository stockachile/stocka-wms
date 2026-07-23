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

async function findTables() {
  // We want to find which tables contain 'POMS KIDS' or have a 'comercio' column
  const tables = [
    'products',
    'orders',
    'stock_declarations',
    'comercios_adicional_config',
    'movements',
    'campaigns',
    'history',
    'notification_settings',
    'envios_unificados',
    'profiles'
  ];

  for (const table of tables) {
    try {
      const { data, error } = await supabase.from(table).select('*').limit(1);
      if (error) {
        // Table might not exist or error
        continue;
      }
      if (data && data.length > 0) {
        const keys = Object.keys(data[0]);
        if (keys.includes('comercio')) {
          const { count, error: countErr } = await supabase
            .from(table)
            .select('*', { count: 'exact', head: true })
            .eq('comercio', 'POMS KIDS');
          
          const { count: countNew, error: countNewErr } = await supabase
            .from(table)
            .select('*', { count: 'exact', head: true })
            .eq('comercio', 'POM KIDS');

          console.log(`Table: ${table} has 'comercio' column. Count of 'POMS KIDS': ${count || 0}, Count of 'POM KIDS': ${countNew || 0}`);
        }
      }
    } catch (err) {
      console.error(`Error inspecting table ${table}:`, err.message);
    }
  }
}

findTables();
