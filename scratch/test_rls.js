const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

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

const supabaseUrl = env.SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MzExODUsImV4cCI6MjA5NTQwNzE4NX0.cnuyxOpbqr-182Q3MJFJu0prtFSvwk1RgbiVBhjYUak';

// Service role client to manage users/profiles
const adminClient = createClient(supabaseUrl, supabaseKey);

// Anon client to simulate the client portal
const clientPortal = createClient(supabaseUrl, anonKey);

const testEmail = 'test_client_rls@stockachile.cl';
const testPassword = 'TestPassword123!';

const felipeComercios = 'BE NATIVE, DORMILONES, HIT GAMING, JOYAS GLOSS, RCT CHILE, RELAJARTE, SIMPLEMENTE CAFE, SMILE FOR PETS, BACK IN TIME, LAQU & COMPANY, STOCKA STORE TEST, MAGIC MAKEUP';

async function run() {
  console.log("=== Setting up test client user ===");
  
  // 1. Delete test user if exists
  const { data: users, error: listError } = await adminClient.auth.admin.listUsers();
  if (listError) {
    console.error("Error listing users:", listError);
    return;
  }
  const existingUser = users.users.find(u => u.email === testEmail);
  if (existingUser) {
    console.log("Deleting existing test user...");
    await adminClient.auth.admin.deleteUser(existingUser.id);
  }

  // 2. Create new user
  console.log("Creating new test user...");
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
  console.log(`User created. ID: ${userId}`);

  // 3. Update profile
  console.log("Updating profile in DB...");
  const { error: profileError } = await adminClient
    .from('profiles')
    .update({
      comercio: felipeComercios,
      role: 'client',
      full_name: 'Test RLS Client'
    })
    .eq('id', userId);

  if (profileError) {
    console.error("Error updating profile:", profileError);
    return;
  }

  // 4. Log in as test user with the client client
  console.log("Logging in via client client...");
  const { data: sessionData, error: loginError } = await clientPortal.auth.signInWithPassword({
    email: testEmail,
    password: testPassword
  });

  if (loginError) {
    console.error("Login failed:", loginError);
    return;
  }
  console.log("Login successful! Session token obtained.");

  // 5. Query orders table using client client
  console.log("Querying orders table via client client...");
  const startOfMonth = '2026-07-01T00:00:00+00:00';
  const companyList = felipeComercios.split(',').map(c => c.trim()).filter(Boolean);
  
  const { data: orders, error: queryError } = await clientPortal
    .from('orders')
    .select('id, external_order_number, comercio, created_at, status, estado_wms, external_platform, origen')
    .in('comercio', companyList)
    .gte('created_at', startOfMonth)
    .order('created_at', { ascending: false });

  if (queryError) {
    console.error("Query failed:", queryError);
  } else {
    console.log(`Query successful! Returned ${orders.length} orders.`);
    
    // Group by commerce
    const counts = {};
    orders.forEach(o => {
      counts[o.comercio] = (counts[o.comercio] || 0) + 1;
    });
    console.log("Orders count by commerce returned via RLS:", counts);

    // Print first 5
    console.log("First 5 orders returned:");
    console.log(orders.slice(0, 5));
  }

  // Clean up
  console.log("Cleaning up test user...");
  await adminClient.auth.admin.deleteUser(userId);
}

run();
