const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const dbPassword = 'V97VoP8utl6o71T9';
const connectionString = `postgresql://postgres:${dbPassword}@db.ejtjfaucnxbikrwjwwdu.supabase.co:5432/postgres`;

const sqlPath = path.join(__dirname, '..', 'supabase_schema_unification_phase20.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

async function main() {
  const client = new Client({ connectionString });
  try {
    console.log("Connecting to database...");
    await client.connect();
    console.log("Connected. Running migration SQL...");
    const res = await client.query(sql);
    console.log("SUCCESS! Migration executed successfully.");
  } catch (err) {
    console.error("FAIL: Migration failed:", err.message);
  } finally {
    await client.end();
  }
}

main();
