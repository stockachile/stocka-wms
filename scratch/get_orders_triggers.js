const fs = require('fs');
const { Client } = require('pg');

let connectionString = process.env.DATABASE_URL;

try {
  const envContent = fs.readFileSync('.env', 'utf-8');
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const key = trimmed.substring(0, idx).trim();
      const val = trimmed.substring(idx + 1).trim();
      if (key === 'DATABASE_URL' || key === 'DIRECT_URL') {
        connectionString = val;
      }
    }
  });
} catch (e) {
  console.warn('Advertencia: No se pudo leer el archivo .env:', e.message);
}

if (!connectionString) {
  console.error('No se encontró DATABASE_URL o DIRECT_URL en el archivo .env');
  process.exit(1);
}

if (connectionString.startsWith('"') && connectionString.endsWith('"')) {
  connectionString = connectionString.substring(1, connectionString.length - 1);
}

async function run() {
  const client = new Client({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    const res = await client.query(`
      SELECT 
        trigger_name, 
        event_manipulation, 
        event_object_table, 
        action_statement, 
        action_timing
      FROM information_schema.triggers
      WHERE event_object_table = 'orders';
    `);
    console.log('=== TRIGGERS ON "orders" TABLE ===');
    console.log(res.rows);
  } catch (err) {
    console.error('Error querying triggers:', err.message);
  } finally {
    await client.end();
  }
}

run();
