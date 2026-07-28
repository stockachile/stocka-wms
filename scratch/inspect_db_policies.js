const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Parse .env manually
const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');

const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    const key = match[1];
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.substring(1, value.length - 1);
    }
    env[key] = value.trim();
  }
});

const supabaseUrl = env.SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log("=== Querying pg_policies for envios_unificados ===");
  try {
    const { data: policiesData, error: polErr } = await supabase.rpc('exec_sql', { 
      sql: `SELECT json_agg(t)::text FROM (SELECT policyname, tablename, roles, cmd, qual, with_check FROM pg_policies WHERE tablename = 'envios_unificados') t` 
    });
    if (polErr) {
      console.error("Error query policies:", polErr);
    } else {
      console.log("Policies:", policiesData);
    }

    console.log("=== Checking if RLS is enabled for envios_unificados ===");
    const { data: rlsData, error: rlsErr } = await supabase.rpc('exec_sql', {
      sql: `SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'envios_unificados'`
    });
    if (rlsErr) {
      console.error("Error checking RLS:", rlsErr);
    } else {
      console.log("RLS Info:", rlsData);
    }
  } catch (e) {
    console.error("Exception:", e);
  }
}

run();
