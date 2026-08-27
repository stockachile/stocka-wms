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

server.listen(3335, async () => {
  console.log('Mobile audit server listening on port 3335');
  try {
    const browser = await chromium.launch({ headless: true });
    // Emulate iPhone (390 x 844)
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
    });
    const page = await context.newPage();
    
    console.log('Navigating to mobile view...');
    await page.goto('http://localhost:3335/cotizaciones.html', { waitUntil: 'networkidle' });
    
    // Check horizontal overflow
    const overflowReport = await page.evaluate(() => {
      const docWidth = document.documentElement.clientWidth;
      const docScrollWidth = document.documentElement.scrollWidth;
      const bodyScrollWidth = document.body.scrollWidth;
      
      const overflowingElements = [];
      const allElements = document.querySelectorAll('*');
      allElements.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.right > docWidth + 1) { // 1px tolerance
          overflowingElements.push({
            tag: el.tagName,
            id: el.id,
            className: el.className,
            width: rect.width,
            right: rect.right,
            excess: rect.right - docWidth
          });
        }
      });
      
      return {
        docWidth,
        docScrollWidth,
        bodyScrollWidth,
        hasHorizontalScroll: docScrollWidth > docWidth || bodyScrollWidth > docWidth,
        overflowingElementsCount: overflowingElements.length,
        overflowingElements: overflowingElements.slice(0, 10)
      };
    });
    
    console.log('Overflow Report:', JSON.stringify(overflowReport, null, 2));
    
    // Screenshot
    await page.screenshot({ path: path.resolve(__dirname, '../downloads/cotizaciones_mobile_audited.png'), fullPage: true });
    console.log('Saved audited mobile screenshot');
    
    await browser.close();
    server.close();
    
    if (overflowReport.hasHorizontalScroll) {
      console.error('FAIL: Page still has horizontal scroll!');
      process.exit(1);
    } else {
      console.log('SUCCESS: ZERO horizontal scroll detected!');
    }
  } catch (err) {
    console.error('AUDIT ERROR:', err);
    server.close();
    process.exit(1);
  }
});
