const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function cropAvatar() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const srcFile = path.resolve('C:/Users/felip/.gemini/antigravity/brain/3b1302fa-26ae-4fd5-b239-473a34904ead/.user_uploaded/media_1787775055072.png');
  const buffer = fs.readFileSync(srcFile);
  const base64Src = buffer.toString('base64');
  
  await page.setContent(`
    <!DOCTYPE html>
    <html>
    <body>
      <img id="src" src="data:image/png;base64,${base64Src}" />
      <canvas id="cv"></canvas>
    </body>
    </html>
  `);
  
  await page.waitForSelector('#src');
  
  const base64Res = await page.evaluate(() => {
    const img = document.getElementById('src');
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    console.log('Image dimensions:', nw, nh);
    
    // In media_1787775055072.png (e.g. 586 x 503):
    // The circular avatar with Felipe is located at:
    // Left: ~141px / 586 = ~0.240 * nw
    // Top: ~258px / 503 = ~0.513 * nh
    // Width: ~50px / 586 = ~0.085 * nw
    // Height: ~50px / 503 = ~0.099 * nh
    const sx = Math.round(nw * (82 / 586));
    const sy = Math.round(nh * (258 / 503));
    const sW = Math.round(nw * (49 / 586));
    const sH = Math.round(nh * (49 / 503));
    
    const cv = document.getElementById('cv');
    cv.width = 240;
    cv.height = 240;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    ctx.drawImage(img, sx, sy, sW, sH, 0, 0, 240, 240);
    return cv.toDataURL('image/png').split(',')[1];
  });
  
  if (!fs.existsSync('images')) fs.mkdirSync('images');
  fs.writeFileSync('images/felipe_avatar.png', Buffer.from(base64Res, 'base64'));
  console.log('Saved images/felipe_avatar.png');
  await browser.close();
}

cropAvatar().catch(console.error);
