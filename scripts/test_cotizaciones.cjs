const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Servidor estático local para servir los módulos ES
const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/cotizaciones.html';
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

server.listen(3333, async () => {
  console.log('Test server listening on port 3333');
  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.error('PAGE ERROR:', err));
    
    console.log('Navigating to: http://localhost:3333/cotizaciones.html');
    await page.goto('http://localhost:3333/cotizaciones.html', { waitUntil: 'networkidle' });
    
    const title = await page.title();
    console.log('Title:', title);
    
    const initialNet = await page.locator('#summary-net-total').innerText();
    const initialVol = await page.locator('#display-total-volume').innerText();
    console.log('Initial Volume:', initialVol, '| Initial Net:', initialNet);
    
    // Change orders input to 150
    await page.fill('#input-orders-number', '150');
    await page.dispatchEvent('#input-orders-number', 'input');
    await page.waitForTimeout(200);
    
    const tierBadge = await page.locator('#badge-current-range').innerText();
    const netAfter150 = await page.locator('#summary-net-total').innerText();
    console.log('After 150 orders -> Range Badge:', tierBadge, '| Net Total:', netAfter150);
    
    // Switch to Pallets tab
    await page.click('button[data-mode="pallets"]');
    await page.waitForTimeout(200);
    
    // Add 8 pallets
    const palletCard = page.locator('.didactic-item-card[data-item-id="pallet"]');
    await palletCard.locator('.item-qty-input').fill('8');
    await palletCard.locator('.item-qty-input').dispatchEvent('input');
    await page.waitForTimeout(200);
    
    const volAfterPallets = await page.locator('#display-total-volume').innerText();
    const discountBadge = await page.locator('#badge-storage-discount').innerText();
    const netAfterPallets = await page.locator('#summary-net-total').innerText();
    console.log('After 8 Pallets -> Volume:', volAfterPallets, '| Discount:', discountBadge, '| Net:', netAfterPallets);
    
    // Save screenshot
    await page.screenshot({ path: path.resolve(__dirname, '../downloads/cotizaciones_verified.png'), fullPage: true });
    console.log('Screenshot saved to downloads/cotizaciones_verified.png');
    
    await browser.close();
    server.close();
    console.log('TEST COMPLETED SUCCESSFULLY');
  } catch (err) {
    console.error('TEST FAILED:', err);
    server.close();
    process.exit(1);
  }
});
