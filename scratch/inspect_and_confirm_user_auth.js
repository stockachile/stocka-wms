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
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function run() {
  const email = 'caviahue.chile@gmail.com';
  console.log(`=== CONSULTANDO USUARIO CON SUPABASE AUTH ADMIN API: ${email} ===`);

  const { data, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) {
    console.error("Error al listar los usuarios:", listErr);
    return;
  }

  const user = data.users.find(u => u.email.toLowerCase() === email.toLowerCase());

  if (!user) {
    console.error(`No se encontró ningún usuario con el correo ${email} en Supabase Auth.`);
    return;
  }

  console.log("Usuario encontrado:", {
    id: user.id,
    email: user.email,
    email_confirmed_at: user.email_confirmed_at,
    confirmed_at: user.confirmed_at,
    created_at: user.created_at,
    last_sign_in_at: user.last_sign_in_at,
    user_metadata: user.user_metadata,
    app_metadata: user.app_metadata
  });

  if (!user.email_confirmed_at) {
    console.log("\nConfirmando el correo electrónico del usuario...");
    
    const { data: updated, error: updateErr } = await supabase.auth.admin.updateUserById(user.id, {
      email_confirm: true
    });

    if (updateErr) {
      console.error("Error al actualizar y confirmar el usuario:", updateErr);
    } else {
      console.log("\n¡Éxito! El correo electrónico ha sido confirmado manualmente vía Auth Admin API:");
      console.log("Datos de actualización:", {
        id: updated.user.id,
        email: updated.user.email,
        email_confirmed_at: updated.user.email_confirmed_at
      });
    }
  } else {
    console.log("\nEl correo ya está confirmado en Supabase Auth.");
  }
}

run();
