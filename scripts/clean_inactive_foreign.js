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

async function cleanInactiveForeign() {
  console.log('=== DESVINCULAR MOVIMIENTOS AJENOS EN COMERCIOS INACTIVOS ===\n');

  const movIds = [
    { id: 'e0a8646a-98a9-480a-9e9b-c4f66976d269', com: 'LIVROS (LVR#JS-1280)', origin: 'SERPA LTDA' },
    { id: 'f8170a7e-45bf-4888-a352-8425a1eb6b13', com: 'MMEDD (MME1176)', origin: 'HIT GAMING' }
  ];

  for (const m of movIds) {
    const { error } = await supabase
      .from('movements')
      .update({ order_id: null })
      .eq('id', m.id);

    if (error) {
      console.error(`Error desvinculando ${m.id}:`, error);
    } else {
      console.log(`✔ Movimiento ${m.id} (${m.origin}) desvinculado de ${m.com}.`);
    }
  }

  const { data: ord } = await supabase.from('orders').select('*').eq('id', 'e793d7ec-aef3-4f00-a85e-1639145847e3').single();
  const { data: items } = await supabase.from('order_items').select('*, products(*)').eq('order_id', ord.id);
  const { data: movs } = await supabase.from('movements').select('*, products(*)').eq('order_id', ord.id);
  console.log('\nOrder AQUALAT:', { id: ord.id, com: ord.comercio, num: ord.external_order_number, created_at: ord.created_at });
  console.log('Items:', items?.map(i => ({ sku: i.products?.sku, com: i.products?.comercio })));
  console.log('Movs:', movs?.map(m => ({ id: m.id, sku: m.products?.sku, com: m.products?.comercio, ref: m.reference_doc })));
}

cleanInactiveForeign().catch(console.error);
