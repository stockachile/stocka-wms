const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Parse .env manually
const envPath = '.env';
let env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
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
}

const supabaseUrl = env.SUPABASE_URL;
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testPackaging() {
  console.log("=== Checking if 'embalaje_config' column exists in 'comercios_adicional_config' ===");
  
  const { data, error } = await supabase
    .from('comercios_adicional_config')
    .select('comercio, embalaje_config')
    .limit(1);

  if (error) {
    console.error("FAIL: Could not query 'embalaje_config'. Please execute the SQL migration script first.");
    console.error("Details:", error.message);
  } else {
    console.log("SUCCESS: 'embalaje_config' column is accessible in the database!");
    console.log("Sample Row:", data);
  }
}

testPackaging();
