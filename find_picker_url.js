const fs = require('fs');
const path = require('path');

function searchFiles(dir) {
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f === 'node_modules' || f === '.git' || f === '.system_generated') continue;
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        searchFiles(full);
      } else if (/\.(js|ts|html|json|py)$/i.test(f)) {
        const txt = fs.readFileSync(full, 'utf8');
        if (txt.includes('hpomymtecmxujbjxqawu')) {
          console.log('hpomymtecmxujbjxqawu in:', full);
        }
      }
    }
  } catch (e) {}
}

searchFiles('.');
process.exit(0);
