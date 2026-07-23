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

async function testUpdate() {
  console.log('Testing direct update on products table...');
  const { data, error, status } = await supabase
    .from('products')
    .update({ comercio: 'POM KIDS' })
    .eq('comercio', 'POMS KIDS')
    .select();

  console.log('Status:', status);
  console.log('Error:', error);
  console.log('Updated Rows:', data ? data.length : 0);
  if (data && data.length > 0) {
    console.log('Sample updated product:', data[0]);
  }
}

testUpdate();
