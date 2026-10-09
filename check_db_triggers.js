const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
  const [k, ...v] = l.split('=');
  return [k.trim(), v.join('=').trim().replace(/^['"]|['"]$/g, '')];
}));
const wms = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function checkTriggers() {
  // Check if there are webhooks in supabase
  const { data, error } = await wms.rpc('pg_stat_activity'); // might not exist
  // We can query information_schema.triggers via rpc if exists, or check sql files
}

checkTriggers().catch(() => {}).finally(() => process.exit(0));
