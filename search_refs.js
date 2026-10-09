const fs = require('fs');

function search(file) {
  if (!fs.existsSync(file)) return;
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  lines.forEach((l, i) => {
    if (l.includes('active_orders')) {
      console.log(`${file}:${i + 1}: ${l.trim().slice(0, 100)}`);
    }
  });
}

search('dashboard.html');
search('admin.html');
search('sync_to_picker.js');
search('sync_meli.js');
process.exit(0);
