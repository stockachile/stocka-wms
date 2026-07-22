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
  const query = `
    SELECT 
      tgname AS trigger_name,
      proname AS function_name,
      prosrc AS function_source
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE c.relname = 'orders';
  `;

  const { data, error } = await supabase.rpc('exec_sql', { sql: query });
  if (error) {
    console.error('Error fetching triggers:', error);
  } else {
    console.log('=== TRIGGERS ON "orders" ===');
    data.forEach(row => {
      console.log(`Trigger: ${row.trigger_name} -> Function: ${row.function_name}`);
    });
  }
}

run();
