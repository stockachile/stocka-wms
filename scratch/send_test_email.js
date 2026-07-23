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

async function sendEmail(emailType, commerceName, additional = {}) {
  console.log(`Enviando correo de prueba de tipo "${emailType}" a felipe.trup@gmail.com...`);
  
  const { data, error } = await supabase.functions.invoke('send-billing-email', {
    body: {
      emails: ['felipe.trup@gmail.com'],
      emailType: emailType,
      commerceName: commerceName,
      ...additional
    }
  });

  if (error) {
    console.error(`Error enviando ${emailType}:`, error);
  } else {
    try {
      const responseText = typeof data === 'string' ? data : JSON.stringify(data);
      console.log(`Éxito enviando ${emailType}:`, responseText);
    } catch {
      console.log(`Éxito enviando ${emailType}`);
    }
  }
}

async function run() {
  console.log("=== INICIANDO PRUEBA DE ENVÍO DE CORREOS ===");
  
  // 1. Probar correo de Onboarding Aprobado (con instrucciones de planilla)
  await sendEmail('onboarding_approved', 'CAVIAHUE');

  // Esperar 3 segundos
  await new Promise(r => setTimeout(r, 3000));

  // 2. Probar correo de Servicio Restablecido (que contiene tus modificaciones de saldos pendientes)
  await sendEmail('status_restablecido', 'CAVIAHUE');
  
  console.log("=== PRUEBA FINALIZADA ===");
}

run();
