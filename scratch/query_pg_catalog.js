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

async function run() {
  // Let's try querying information_schema.triggers or pg_trigger via RPC or direct select
  console.log('Querying information_schema.columns via direct REST...');
  const { data, error } = await supabase
    .from('columns') // usually fails because columns is not exposed in public
    .select('*')
    .limit(5);

  console.log('Result:', data, 'Error:', error ? error.message : null);
}

run();
