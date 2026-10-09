const fs = require('fs');

function checkFile(file) {
  const content = fs.readFileSync(file, 'utf8');
  content.split('\n').forEach((line, i) => {
    if (line.includes('active_orders') || line.includes('sync_to_picker') || line.includes('Sucursal Virtual')) {
      console.log(`${file}:${i + 1}: ${line.trim().slice(0, 140)}`);
    }
  });
}

checkFile('js/admin.js');
checkFile('js/agendas_grid.js');
checkFile('js/app.js');
process.exit(0);
