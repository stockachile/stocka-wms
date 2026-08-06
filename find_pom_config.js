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

async function findPomConfig() {
  try {
    const { data: configs, error } = await supabase
      .from('comercios_adicional_config')
      .select('*')
      .eq('comercio', 'POM KIDS');
    
    if (error) throw error;
    console.log('--- CONFIGURACION DE POM KIDS ---');
    console.log(JSON.stringify(configs, null, 2));
  } catch (err) {
    console.error(err);
  }
}

findPomConfig();
