const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Cargar archivo .env
const envPath = path.join(__dirname, '..', '.env');
let env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split(/\r?\n/).forEach(line => {
    if (!line || line.startsWith('#')) return;
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      env[key.trim()] = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
    }
  });
}

const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function inspect() {
  console.log('🔍 Inspeccionando datos para TSS1062 en Supabase...\n');

  // 1. Buscar en orders
  const { data: orders, error: oErr } = await supabase
    .from('orders')
    .select('*')
    .eq('external_order_number', 'TSS1062');
  
  console.log('=== TABLA orders ===');
  if (oErr) console.error('Error:', oErr.message);
  else console.log(orders);

  // 2. Buscar en optiroute_orders
  const { data: opti, error: optiErr } = await supabase
    .from('optiroute_orders')
    .select('*')
    .eq('referencia', 'TSS1062');
  
  console.log('\n=== TABLA optiroute_orders ===');
  if (optiErr) console.error('Error:', optiErr.message);
  else console.log(opti);

  // 3. Buscar en envios_unificados
  const { data: unified, error: uniErr } = await supabase
    .from('envios_unificados')
    .select('*')
    .eq('pedido_referencia', 'TSS1062');
  
  console.log('\n=== TABLA envios_unificados ===');
  if (uniErr) console.error('Error:', uniErr.message);
  else console.log(unified);
}

inspect();
