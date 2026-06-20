const { createClient } = require('@supabase/supabase-js');

const OLD_SUPA_URL = 'https://hpomymtecmxujbjxqawu.supabase.co';
const OLD_SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ';

const NEW_SUPA_URL = 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const NEW_SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzMTE4NSwiZXhwIjoyMDk1NDA3MTg1fQ.YX4okf4XNkkVQaU0XbbRtm4SNRTqvwEVNd7ubc4PGe8';

const oldClient = createClient(OLD_SUPA_URL, OLD_SUPA_KEY);
const newClient = createClient(NEW_SUPA_URL, NEW_SUPA_KEY);

async function run() {
  console.log("Extrayendo TODOS los datos históricos de logistica_inversa...");

  const { data, error } = await oldClient.from('logistica_inversa').select('*');
  if (error) {
    console.error("Error extrayendo datos:", error);
    return;
  }

  const wmsData = data.map(payload => {
    let productosParseados = [];
    try {
      productosParseados = JSON.parse(payload.producto_devuelto || "[]");
    } catch(e) {}

    return {
      tipo_movimiento: payload.tipo_movimiento,
      comercio: payload.comercio,
      transporte: payload.transporte,
      referencia_pedido: payload.referencia_pedido || 'N/A',
      referencia_transporte: payload.referencia_transporte,
      productos: productosParseados,
      cantidad_total: payload.cantidad || 0,
      comentarios: payload.comentarios,
      sucursal: payload.sucursal,
      creado_por: payload.creado_por,
      created_at: payload.created_at
    };
  });

  console.log(`Borrando registros antiguos en WMS (reverse_logistics)...`);
  await newClient.from('reverse_logistics').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  console.log(`Insertando ${wmsData.length} registros en WMS (reverse_logistics)...`);

  const { error: insertError } = await newClient.from('reverse_logistics').insert(wmsData);
  
  if (insertError) {
    console.error("Error insertando datos en WMS:", insertError);
  } else {
    console.log("¡Migración completada exitosamente!");
  }
}

run();
