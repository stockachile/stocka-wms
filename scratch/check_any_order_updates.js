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
  const { data: counts, error } = await supabase
    .from('orders')
    .select('estado_wms, status');

  if (error) {
    console.error('Error:', error);
    return;
  }

  const wmsStats = {};
  const statusStats = {};

  counts.forEach(o => {
    wmsStats[o.estado_wms] = (wmsStats[o.estado_wms] || 0) + 1;
    statusStats[o.status] = (statusStats[o.status] || 0) + 1;
  });

  console.log('WMS STATUS STATS IN DB:', wmsStats);
  console.log('ORIGIN STATUS STATS IN DB:', statusStats);
}
check();
