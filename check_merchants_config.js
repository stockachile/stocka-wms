const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const [k, ...v] = l.split('=');
  return [k.trim(), v.join('=').trim().replace(/^['"]|['"]$/g, '')];
}));
const wms = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  const { data: configs } = await wms
    .from('comercios_adicional_config')
    .select('*')
    .in('comercio', ['HIT GAMING', 'SERPA', 'SERPA LTDA', 'MAGIC MAKEUP', 'MAESE', 'B4LIFE']);
  console.log('Configs:', configs);
}

test().finally(() => process.exit(0));
