const fs = require('fs');
const path = require('path');
const http = require('http');
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');

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

// Create a simple HTTP server to serve the workspace files
function startServer() {
  const server = http.createServer((req, res) => {
    // Basic file server
    let filePath = path.join(__dirname, '..', req.url.split('?')[0]);
    if (filePath === path.join(__dirname, '..', '/')) {
      filePath = path.join(__dirname, '..', 'index.html');
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      
      let ext = path.extname(filePath);
      let contentType = 'text/html';
      if (ext === '.js') contentType = 'text/javascript';
      else if (ext === '.css') contentType = 'text/css';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.svg') contentType = 'image/svg+xml';
      
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
  
  return new Promise((resolve) => {
    server.listen(8080, () => {
      console.log("Local HTTP server started at http://localhost:8080");
      resolve(server);
    });
  });
}

async function run() {
  console.log("=== Setting up test user and session ===");
  // 1. Delete test user if exists
  const { data: users } = await adminClient.auth.admin.listUsers();
  const existingUser = users.users.find(u => u.email === testEmail);
  if (existingUser) {
    await adminClient.auth.admin.deleteUser(existingUser.id);
  }

  // 2. Create test user
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

  // 3. Update profile
  await adminClient
    .from('profiles')
    .update({
      comercio: felipeComercios,
      role: 'client',
      full_name: 'Felipe Trujillo Test',
      allowed_modules: ['dashboard', 'inventory', 'orders', 'shipments']
    })
    .eq('id', userId);

  // 4. Log in
  const { data: sessionData, error: loginError } = await clientPortal.auth.signInWithPassword({
    email: testEmail,
    password: testPassword
  });
  if (loginError) {
    console.error("Login failed:", loginError);
    return;
  }
  const session = sessionData.session;
  console.log("Session obtained.");

  // 5. Start HTTP server
  const server = await startServer();

  // 6. Launch Playwright
  console.log("Launching headless browser...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Set up console logging
  page.on('console', msg => {
    console.log(`BROWSER LOG: ${msg.text()}`);
  });
  
  page.on('pageerror', err => {
    console.error(`BROWSER ERROR: ${err.message}`);
  });

  // 7. Inject session into localStorage before loading page
  await page.goto('http://localhost:8080/');
  await page.evaluate((sessionObj) => {
    const key = 'sb-ejtjfaucnxbikrwjwwdu-auth-token';
    localStorage.setItem(key, JSON.stringify(sessionObj));
  }, session);

  // 8. Go to dashboard.html
  console.log("Navigating to dashboard.html...");
  await page.goto('http://localhost:8080/dashboard.html');

  // Wait for the popup to show up
  await page.waitForTimeout(3000);

  // Dismiss system popup if it is present
  console.log("Checking for system popup...");
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const dismissBtn = buttons.find(b => b.textContent.includes('Entendido'));
    if (dismissBtn) {
      console.log("Found dismiss button, clicking it...");
      dismissBtn.click();
    }
  });

  await page.waitForTimeout(2000);

  // Let's click on the "Pedidos" sidebar item
  console.log("Navigating to WMS Orders module...");
  await page.evaluate(() => {
    const navItems = Array.from(document.querySelectorAll('.nav-item'));
    const ordersItem = navItems.find(item => item.textContent.includes('Pedidos'));
    if (ordersItem) {
      ordersItem.click();
    }
  });

  // Wait for filter selector to appear in DOM
  console.log("Waiting for origin filter dropdown selector...");
  const selectElement = await page.waitForSelector('#filter-client-origen', { timeout: 15000 });
  
  // Select "Shopify"
  console.log("Selecting Shopify in dropdown...");
  await selectElement.selectOption('Shopify');

  // Wait 6 seconds for filtering and rendering to complete
  console.log("Waiting 6 seconds for rendering...");
  await page.waitForTimeout(6000);

  // Take a screenshot of the rendered page
  console.log("Taking screenshot...");
  const screenshotPath = path.join(__dirname, '..', 'downloads', 'test_render.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Screenshot saved to ${screenshotPath}`);

  // Let's extract and print the table rows innerText
  const rowsText = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#client-orders-tbody tr.order-row'));
    return rows.map(r => r.querySelector('td:nth-child(3)').innerText);
  });
  console.log("Rendered rows with Shopify filter in browser:", rowsText);

  // 9. Clean up
  console.log("Shutting down browser and server...");
  await browser.close();
  server.close();
  
  console.log("Deleting test user...");
  await adminClient.auth.admin.deleteUser(userId);
  console.log("Done!");
}

run().catch(console.error);
