const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

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

async function main() {
  const { count: countNoS, error: errNoS } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('comercio', 'POM KIDS');

  const { count: countS, error: errS } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('comercio', 'POMS KIDS');

  console.log('Count for POM KIDS (no S):', countNoS);
  console.log('Count for POMS KIDS (with S):', countS);
}

main().catch(console.error);
