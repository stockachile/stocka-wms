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

async function check() {
  const { data, error } = await supabase.from('merchant_integrations').select('*');
  if (error) {
    console.error('Error fetching merchant_integrations:', error.message);
    return;
  }
  console.log(`=== INTEGRACIONES ENCONTRADAS (Total: ${data.length}) ===`);
  data.forEach((item, index) => {
    console.log(`[#${index + 1}] ID: ${item.id} | Plataforma: ${item.platform} | Shop URL: ${item.shop_url} | Comercio: ${item.comercio} | Activo: ${item.is_active}`);
  });
}

check();
