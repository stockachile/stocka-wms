const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Parsear variables del archivo .env
const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    env[match[1]] = (match[2] || '').replace(/^"|"$/g, '').trim();
  }
});

const supabaseUrl = env.SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log("Buscando el registro de onboarding para 'CAVIAHUE'...");
  
  // Buscar por nombre de fantasía o razón social
  const { data: records, error: searchErr } = await supabase
    .from('onboarding_requests')
    .select('*')
    .or('nombre_fantasia.ilike.%caviahue%,razon_social.ilike.%caviahue%');

  if (searchErr) {
    console.error("Error al buscar en onboarding_requests:", searchErr);
    return;
  }

  if (!records || records.length === 0) {
    console.error("No se encontró ningún registro para 'CAVIAHUE'.");
    return;
  }

  const record = records[0];
  const targetEmail = record.email;
  const commerceName = record.nombre_fantasia || 'CAVIAHUE';

  console.log(`Encontrado comercio: ${commerceName}`);
  console.log(`Correo asociado: ${targetEmail}`);

  console.log(`Enviando correo de onboarding_approved a ${targetEmail}...`);

  const { data, error } = await supabase.functions.invoke('send-billing-email', {
    body: {
      emails: [targetEmail],
      emailType: 'onboarding_approved',
      commerceName: commerceName
    }
  });

  if (error) {
    console.error("Error al enviar el correo:", error);
  } else {
    console.log("Correo enviado con éxito!", data);
  }
}

run();
