const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf-8');
  envConfig.split(/\r?\n/).forEach(line => {
    if (!line || line.startsWith('#')) return;
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      const value = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
      process.env[key.trim()] = value;
    }
  });
}

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  console.log('=== CHECKING MAPPINGS FOR MAGIC MAKEUP ===');
  const { data: mappings, error } = await supabase
    .from('sku_equivalences')
    .select('*')
    .eq('comercio', 'MAGIC MAKEUP')
    .in('platform_sku', ['MAGIC046', 'MAGIC050', 'MAGIC041']);

  if (error) {
    console.error(error);
  } else {
    console.log('Mappings:', mappings);
  }
}
check();
