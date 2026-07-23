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
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('comercio')
    .eq('id', '7eb032ed-5717-426c-9dca-35fcdd48f0e8')
    .single();

  if (error) throw error;
  
  const assigned = profile.comercio
    .split(',')
    .map(c => c.trim())
    .filter(c => c && c.toLowerCase() !== 'no asignado');

  console.log('Assigned comercios for user:', assigned);
}

main().catch(console.error);
