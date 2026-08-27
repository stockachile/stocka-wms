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
    '.jpg': 'image/jpeg',
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
  console.log('Mobile test server listening on port 3334');
  try {
    const browser = await chromium.launch({ headless: true });
    // Emulate iPhone 14 (390 x 844)
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
    });
    const page = await context.newPage();
    
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.error('PAGE ERROR:', err));
    
    console.log('Navigating to mobile view: http://localhost:3334/cotizaciones.html');
    await page.goto('http://localhost:3334/cotizaciones.html', { waitUntil: 'networkidle' });
    
    // Screenshot initial Light Mode
    await page.screenshot({ path: path.resolve(__dirname, '../downloads/cotizaciones_mobile_light.png'), fullPage: true });
    console.log('Saved mobile light screenshot');
    
    // Click theme toggle in header
    console.log('Toggling dark mode in header...');
    await page.click('.header-theme-toggle');
    await page.waitForTimeout(300);
    
    const isDark = await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'dark');
    console.log('Is dark theme active:', isDark);
    
    // Screenshot Dark Mode
    await page.screenshot({ path: path.resolve(__dirname, '../downloads/cotizaciones_mobile_dark.png'), fullPage: true });
    console.log('Saved mobile dark screenshot');
    
    await browser.close();
    server.close();
    console.log('MOBILE TEST COMPLETED SUCCESSFULLY');
  } catch (err) {
    console.error('MOBILE TEST FAILED:', err);
    server.close();
    process.exit(1);
  }
});
