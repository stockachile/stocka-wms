const fs = require('fs');
try {
  const envContent = fs.readFileSync('.env', 'utf-8');
  const keys = [];
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      keys.push(trimmed.substring(0, idx).trim());
    }
  });
  console.log('Variables de entorno definidas en .env:', keys);
} catch (e) {
  console.error('Error al leer .env:', e.message);
}
