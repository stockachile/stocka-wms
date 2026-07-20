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
  console.log("=== Querying pg_policies directly via exec_sql ===");
  try {
    const { data, error } = await supabase.rpc('exec_sql', { 
      sql: `SELECT json_agg(t)::text FROM (SELECT policyname, roles, cmd, qual, with_check FROM pg_policies WHERE tablename = 'orders') t` 
    });
    if (error) {
      console.error("Error executing query:", error);
    } else {
      console.log("Result:", data);
    }
  } catch (e) {
    console.error("Exception occurred:", e);
  }
}

run();
