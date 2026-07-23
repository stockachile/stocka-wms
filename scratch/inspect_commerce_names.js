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
  console.log('--- v_comercios_config ---');
  const { data: viewData, error: viewErr } = await supabase.from('v_comercios_config').select('*');
  if (viewErr) console.error(viewErr);
  else console.log(viewData);

  console.log('--- comercios_adicional_config ---');
  const { data: configData, error: configErr } = await supabase.from('comercios_adicional_config').select('*');
  if (configErr) console.error(configErr);
  else console.log(configData);

  console.log('--- Unique comercio names in products ---');
  const { data: prodData, error: prodErr } = await supabase.rpc('get_exposed_functions'); // wait, let's just query products select
  const { data: prods, error: prodsErr } = await supabase.from('products').select('comercio');
  if (prodsErr) console.error(prodsErr);
  else {
    const set = new Set(prods.map(p => p.comercio));
    console.log(Array.from(set));
  }

  console.log('--- Unique comercio names in orders ---');
  const { data: ords, error: ordsErr } = await supabase.from('orders').select('comercio');
  if (ordsErr) console.error(ordsErr);
  else {
    const set = new Set(ords.map(o => o.comercio));
    console.log(Array.from(set));
  }

  console.log('--- Unique comercio names in stock_declarations ---');
  const { data: decs, error: decsErr } = await supabase.from('stock_declarations').select('comercio');
  if (decsErr) console.error(decsErr);
  else {
    const set = new Set(decs.map(d => d.comercio));
    console.log(Array.from(set));
  }
}

inspect();
