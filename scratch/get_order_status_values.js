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

async function inspect() {
  const { data: statusData } = await supabase.from('orders').select('status, estado_wms');
  const statuses = new Set();
  const estadosWms = new Set();

  (statusData || []).forEach(o => {
    if (o.status) statuses.add(o.status);
    if (o.estado_wms) estadosWms.add(o.estado_wms);
  });

  console.log('Unique status values in orders table:', Array.from(statuses));
  console.log('Unique estado_wms values in orders table:', Array.from(estadosWms));
}

inspect();
