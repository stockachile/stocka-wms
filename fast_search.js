const fs = require('fs');
const path = require('path');

function searchDir(dir) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    if (f === 'node_modules' || f === '.git') continue;
    const full = path.join(dir, f);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      searchDir(full);
    } else if (f.endsWith('.js') || f.endsWith('.html')) {
      const content = fs.readFileSync(full, 'utf8');
      if (content.includes('Sucursal Virtual')) {
        console.log('Match Sucursal Virtual in:', full);
      }
      if (content.includes('active_orders') && !full.includes('sync_to_picker.js') && !full.includes('scratch')) {
        console.log('Match active_orders in:', full);
      }
    }
  }
}

searchDir('.');
process.exit(0);
