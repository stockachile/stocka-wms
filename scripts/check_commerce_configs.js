const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const [k, ...v] = line.trim().split('=');
  if (k && v.length) env[k] = v.join('=').replace(/^['"]|['"]$/g, '');
});

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function checkConfigs() {
  const { data: configs } = await supabase.from('comercios_adicional_config').select('*');
  console.log('Comercios configurados:');
  for (const c of (configs || [])) {
    if (c.inventario_seguimiento) {
      console.log(`• ${c.comercio}: ACTIVO | Corte:`, c.inventario_inicio_pedidos || 'Sin corte');
    } else {
      console.log(`• ${c.comercio}: INACTIVO`);
    }
  }
}

checkConfigs().catch(console.error);
