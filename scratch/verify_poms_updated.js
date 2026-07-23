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

async function verify() {
  const { count: prodCount } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('comercio', 'POM KIDS');

  const { count: orderCount } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('comercio', 'POM KIDS');

  const { count: configCount } = await supabase
    .from('comercios_adicional_config')
    .select('*', { count: 'exact', head: true })
    .eq('comercio', 'POM KIDS');

  console.log(`VERIFICATION RESULT:`);
  console.log(`Products with POM KIDS: ${prodCount}`);
  console.log(`Orders with POM KIDS: ${orderCount}`);
  console.log(`Configs with POM KIDS: ${configCount}`);
}

verify();
