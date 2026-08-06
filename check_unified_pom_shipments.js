const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envPath = 'c:/Users/felip/Desktop/WMS STOCKA/.env';
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
      process.env[key] = val;
    }
  });
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkUnified() {
  try {
    const ids = ['enviame_shipments:458476063', 'enviame_shipments:458476064', 'enviame_shipments:458250222', 'enviame_shipments:458250225'];
    const { data: unified, error } = await supabase
      .from('envios_unificados')
      .select('*')
      .in('id', ids);
    
    if (error) throw error;
    console.log('--- ENVIOS_UNIFICADOS PARA ESTOS ENVIOS ---');
    console.log(JSON.stringify(unified, null, 2));

  } catch (err) {
    console.error(err);
  }
}

checkUnified();
