const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Parse .env manually
const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');

const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    const key = match[1];
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.substring(1, value.length - 1);
    }
    env[key] = value.trim();
  }
});

const supabaseUrl = env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MzExODUsImV4cCI6MjA5NTQwNzE4NX0.cnuyxOpbqr-182Q3MJFJu0prtFSvwk1RgbiVBhjYUak';

const adminClient = createClient(supabaseUrl, supabaseKey);
const clientPortal = createClient(supabaseUrl, anonKey);

const testEmail = 'shopify_temp_sync@stockachile.cl';
const testPassword = 'SyncPassword123!';

async function run() {
  console.log("1. Setting up temporary admin user...");
  // Delete user if exists
  const { data: users } = await adminClient.auth.admin.listUsers();
  const existingUser = users.users.find(u => u.email === testEmail);
  if (existingUser) {
    await adminClient.auth.admin.deleteUser(existingUser.id);
  }

  // Create user
  const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true
  });
  if (createError) {
    console.error("Error creating user:", createError);
    return;
  }
  const userId = createData.user.id;

  // Set role to admin
  await adminClient
    .from('profiles')
    .update({
      role: 'admin',
      full_name: 'Shopify Sync Admin'
    })
    .eq('id', userId);

  console.log("2. Logging in to get JWT session...");
  const { data: sessionData, error: loginError } = await clientPortal.auth.signInWithPassword({
    email: testEmail,
    password: testPassword
  });
  if (loginError) {
    console.error("Login failed:", loginError);
    return;
  }
  const jwtToken = sessionData.session.access_token;
  console.log("JWT Token obtained.");

  console.log("3. Triggering shopify-oauth POST to refresh token for HIT GAMING...");
  const oauthRes = await fetch(`${supabaseUrl}/functions/v1/shopify-oauth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwtToken}`
    },
    body: JSON.stringify({ comercio: 'HIT GAMING' })
  });

  if (!oauthRes.ok) {
    console.error(`OAuth trigger failed: ${oauthRes.status} - ${await oauthRes.text()}`);
  } else {
    const resData = await oauthRes.json();
    console.log("OAuth trigger response:", resData);
  }

  console.log("4. Fetching the updated access token from database...");
  const { data: integration } = await adminClient
    .from('merchant_integrations')
    .select('*')
    .eq('comercio', 'HIT GAMING')
    .eq('platform', 'Shopify')
    .single();

  console.log("Updated access token is:", integration.access_token);
  console.log("Updated refresh token is:", integration.refresh_token);

  console.log("5. Cleaning up temporary admin user...");
  await adminClient.auth.admin.deleteUser(userId);
  console.log("Cleanup complete!");
}

run().catch(console.error);
