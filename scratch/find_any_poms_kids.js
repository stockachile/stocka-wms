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

async function findAnyRef() {
  // Query list of all tables and columns from information_schema
  const { data: cols, error: colsErr } = await supabase.rpc('get_exposed_functions'); // let's just run custom query or inspect manually
  
  // Since we don't have direct sql execution, we can query information_schema if we have an RPC, 
  // or we can just list tables we know.
  // Let's write a simple query using postgres function if possible.
  // Wait, let's check what tables are in our schema by reading sql files or running a query.
  // Let's list the known tables:
  const tables = [
    'products',
    'orders',
    'stock_declarations',
    'comercios_adicional_config',
    'profiles',
    'movements',
    'campaigns',
    'history',
    'notification_settings',
    'envios_unificados',
    'recepciones',
    'incidencias',
    'pedidos'
  ];

  for (const table of tables) {
    try {
      const { data, error } = await supabase.from(table).select('*').limit(1);
      if (error) continue;
      if (!data || data.length === 0) continue;
      const textColumns = Object.keys(data[0]).filter(k => typeof data[0][k] === 'string');
      for (const col of textColumns) {
        const { data: matches, error: matchErr } = await supabase
          .from(table)
          .select('*')
          .eq(col, 'POMS KIDS');
        if (matches && matches.length > 0) {
          console.log(`FOUND POMS KIDS in table: ${table}, column: ${col}, count: ${matches.length}`);
        }
      }
    } catch (e) {
      // ignore
    }
  }
}

findAnyRef();
