const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/admin.html';
  const filePath = path.join(__dirname, '..', reqPath);

  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.json': 'application/json'
  };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    res.end(data);
  });
});

server.listen(3334, async () => {
  console.log('Admin test server listening on port 3334');
  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    // Configurar sesión admin simulada
    await page.addInitScript(() => {
      sessionStorage.setItem('wms_demo_mode', 'true');
      sessionStorage.setItem('sb-ejtjfaucnxbikrwjwwdu-auth-token', JSON.stringify({
        user: { id: 'demo-admin-id', email: 'admin@stocka.cl', user_metadata: { full_name: 'Admin Stocka' } }
      }));
    });
    
    await page.goto('http://localhost:3334/admin.html', { waitUntil: 'networkidle' });
    
    // Click on "Tarifas y Cotizador" menu item
    const pricingNavItem = page.locator('.nav-item[data-view="pricing_config_admin"]');
    if (await pricingNavItem.count() > 0) {
      console.log('Clicking on Tarifas y Cotizador menu item...');
      await pricingNavItem.click();
      await page.waitForTimeout(500);
      
      const title = await page.locator('#view-title').innerText();
      console.log('View Title:', title);
      
      const adminHeader = await page.locator('#app-content h2').innerText();
      console.log('Admin Header:', adminHeader);
      
      // Check inputs for Range 1
      const range1PickPack = await page.locator('input[name="range_0_pick_pack"]').inputValue();
      const range1Storage = await page.locator('input[name="range_0_storage_m3"]').inputValue();
      console.log('Rango 1 Pick & Pack:', range1PickPack, '| Storage m3:', range1Storage);
      
      // Save screenshot
      await page.screenshot({ path: path.resolve(__dirname, '../downloads/admin_pricing_verified.png'), fullPage: true });
      console.log('Admin screenshot saved to downloads/admin_pricing_verified.png');
    } else {
      console.log('Pricing nav item not found in current DOM state');
    }
    
    await browser.close();
    server.close();
    console.log('ADMIN PRICING TEST COMPLETED');
  } catch (err) {
    console.error('ADMIN TEST FAILED:', err);
    server.close();
    process.exit(1);
  }
});
