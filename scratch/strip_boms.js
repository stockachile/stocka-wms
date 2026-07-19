const fs = require('fs');
const content = fs.readFileSync('js/app.js', 'utf8');
// Remove BOM characters from the file
const stripped = content.replace(/\uFEFF/g, '');
fs.writeFileSync('js/app.js', stripped, 'utf8');
console.log('BOMs stripped from js/app.js successfully!');
