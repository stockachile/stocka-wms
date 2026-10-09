const fs = require('fs');
['js/admin.js', 'js/app.js', 'sync_to_picker.js'].forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  content.split('\n').forEach((l, i) => {
    if (l.includes("'Pendiente'") || l.includes('"Pendiente"')) {
      console.log(file, i + 1, l.trim().slice(0, 100));
    }
  });
});
process.exit(0);
