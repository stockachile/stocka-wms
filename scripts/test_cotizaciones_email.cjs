const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

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

server.listen(3335, async () => {
  console.log('Test server listening on port 3335');
  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.error('PAGE ERROR:', err));
    
    await page.goto('http://localhost:3335/cotizaciones.html', { waitUntil: 'networkidle' });
    
    // Open email modal
    await page.click('#btn-open-email-modal');
    await page.waitForTimeout(300);
    
    // Fill contact fields
    await page.fill('#lead-company', 'Tienda Test Playwright');
    await page.fill('#lead-name', 'Felipe Trujillo');
    await page.fill('#lead-email', 'felipe.tp@stocka.cl');
    await page.fill('#lead-phone', '+56 9 3924 7487');
    
    // Submit form
    console.log('Submitting email quotation form...');
    await page.click('#lead-quote-form button[type="submit"]');
    
    // Wait for success alert
    await page.waitForSelector('#lead-modal-alert .alert-success', { timeout: 10000 });
    const alertText = await page.locator('#lead-modal-alert .alert-success').innerText();
    console.log('Success Alert text:', alertText);
    
    await page.screenshot({ path: path.resolve(__dirname, '../downloads/cotizacion_email_sent.png') });
    console.log('Screenshot saved to downloads/cotizacion_email_sent.png');
    
    await browser.close();
    server.close();
    console.log('EMAIL MODAL TEST PASSED SUCCESSFULLY');
  } catch (err) {
    console.error('EMAIL MODAL TEST FAILED:', err);
    server.close();
    process.exit(1);
  }
});
