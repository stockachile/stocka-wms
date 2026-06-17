const { createClient } = require('@supabase/supabase-js');

// Old Database (PICKING DESARROLLO)
const OLD_SUPA_URL = 'https://hpomymtecmxujbjxqawu.supabase.co';
const OLD_SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ';

// New Database (WMS STOCKA)
const NEW_SUPA_URL = 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const NEW_SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzMTE4NSwiZXhwIjoyMDk1NDA3MTg1fQ.YX4okf4XNkkVQaU0XbbRtm4SNRTqvwEVNd7ubc4PGe8';

const oldClient = createClient(OLD_SUPA_URL, OLD_SUPA_KEY);
const newClient = createClient(NEW_SUPA_URL, NEW_SUPA_KEY);

async function run() {
  console.log("Extrayendo TODOS los datos históricos de punto_ventas...");

  const { data, error } = await oldClient.from('punto_ventas').select('*');
  if (error) {
    console.error("Error extrayendo datos:", error);
    return;
  }

  console.log(`Se encontraron ${data.length} registros. Insertando en WMS (store_sales)...`);

  const { error: insertError } = await newClient.from('store_sales').upsert(data);
  
  if (insertError) {
    console.error("Error insertando datos en WMS:", insertError);
  } else {
    console.log("¡Migración completada exitosamente!");
  }
}

run();
