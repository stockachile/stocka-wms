const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/cotizaciones.html';
  const filePath = path.join(__dirname, '..', reqPath);
  const ext = path.extname(filePath);
  const mimes = { 
    '.html': 'text/html', 
    '.css': 'text/css', 
    '.js': 'application/javascript', 
    '.png': 'image/png', 
    '.jpg': 'image/jpeg',
    '.json': 'application/json'
  };
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mimes[ext] || 'text/plain' });
    res.end(data);
  });
});

server.listen(3344, async () => {
  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') console.log('PAGE ERROR LOG:', msg.text());
    });
    page.on('pageerror', err => {
      console.error('PAGE UNCAUGHT EXCEPTION:', err);
      errors.push(err);
    });
    
    console.log('--- 1. Navigating to cotizaciones.html ---');
    await page.goto('http://localhost:3344/cotizaciones.html', { waitUntil: 'networkidle' });
    
    // Initial check
    const initialOrders = await page.$eval('#input-orders-number', el => el.value);
    const initialBadge = await page.$eval('#badge-current-range', el => el.textContent.trim());
    const initialSubtotal = await page.$eval('#summary-net-total', el => el.textContent.trim());
    console.log(`Initial: Orders=${initialOrders}, Badge="${initialBadge}", Subtotal=${initialSubtotal}`);
    
    // Presets check
    const presets = [
      { selector: '.preset-btn[data-orders="20"]', expectedOrders: '20', expectedRange: 'Rango 1' },
      { selector: '.preset-btn[data-orders="150"]', expectedOrders: '150', expectedRange: 'Rango 3' },
      { selector: '.preset-btn[data-orders="350"]', expectedOrders: '350', expectedRange: 'Rango 4' },
      { selector: '.preset-btn[data-orders="800"]', expectedOrders: '800', expectedRange: 'Rango 5' },
      { selector: '.preset-btn[data-orders="2600"]', expectedOrders: '2600', expectedRange: 'Rango 7' },
      { selector: '.preset-btn[data-orders="60"]', expectedOrders: '60', expectedRange: 'Rango 2' }
    ];
    
    console.log('--- 2. Testing Preset Buttons ---');
    for (const p of presets) {
      await page.click(p.selector);
      await page.waitForTimeout(200);
      const orders = await page.$eval('#input-orders-number', el => el.value);
      const badge = await page.$eval('#badge-current-range', el => el.textContent.trim());
      const subtotal = await page.$eval('#summary-net-total', el => el.textContent.trim());
      const pickPackVal = await page.$eval('#summary-pickpack-val', el => el.textContent.trim());
      const bannerName = await page.$eval('#tier-banner-name', el => el.textContent.trim());
      console.log(`Preset -> Orders=${orders} (expected ${p.expectedOrders}), Badge="${badge}" (expected ${p.expectedRange}), Banner="${bannerName}", PickPack=${pickPackVal}, Subtotal=${subtotal}`);
      if (!badge.includes(p.expectedRange)) {
        throw new Error(`Range mismatch for preset ${p.expectedOrders}: got ${badge}`);
      }
    }
    
    console.log('--- 3. Testing Direct Input Typing (2600 orders) ---');
    await page.fill('#input-orders-number', '2600');
    await page.dispatchEvent('#input-orders-number', 'input');
    await page.waitForTimeout(200);
    const enterpriseBadge = await page.$eval('#badge-current-range', el => el.textContent.trim());
    const enterpriseBanner = await page.$eval('#tier-banner-name', el => el.textContent.trim());
    const enterprisePickPack = await page.$eval('#summary-pickpack-subtext', el => el.textContent.trim());
    const enterpriseTotal = await page.$eval('#summary-net-total', el => el.textContent.trim());
    console.log(`Enterprise Result -> Badge: "${enterpriseBadge}", Banner: "${enterpriseBanner}", P&P: "${enterprisePickPack}", Total: "${enterpriseTotal}"`);
    
    if (!enterpriseBadge.includes('Rango 7')) {
      throw new Error(`Enterprise badge should be Rango 7, got ${enterpriseBadge}`);
    }
    
    console.log('--- 4. Testing Storage Tabs ---');
    // Tab Pallets
    await page.click('.mode-tab-btn[data-mode="pallets"]');
    await page.waitForTimeout(200);
    const palletsActive = await page.$eval('#storage-mode-pallets', el => getComputedStyle(el).display !== 'none');
    console.log('Pallets tab displayed:', palletsActive);
    
    // Tab Direct
    await page.click('.mode-tab-btn[data-mode="direct"]');
    await page.waitForTimeout(200);
    const directActive = await page.$eval('#storage-mode-direct', el => getComputedStyle(el).display !== 'none');
    console.log('Direct tab displayed:', directActive);
    
    // Back to Didactic / Cajas
    await page.click('.mode-tab-btn[data-mode="didactic"]');
    await page.waitForTimeout(200);
    const didacticActive = await page.$eval('#storage-mode-didactic', el => getComputedStyle(el).display !== 'none');
    console.log('Didactic tab displayed:', didacticActive);
    
    // Take screenshot of Enterprise state
    await page.screenshot({ path: path.join(__dirname, '..', 'downloads', 'cotizador_enterprise_verified.png'), fullPage: true });
    console.log('Screenshot saved to downloads/cotizador_enterprise_verified.png');
    
    if (errors.length > 0) {
      console.error('Errors encountered:', errors);
      process.exit(1);
    } else {
      console.log('ALL TESTS PASSED WITH 0 ERRORS!');
    }
    
    await browser.close();
    server.close();
  } catch (err) {
    console.error('Test failed:', err);
    server.close();
    process.exit(1);
  }
});
