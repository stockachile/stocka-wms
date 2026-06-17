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
    console.log("⏳ Obteniendo registros históricos desde el proyecto de Picking...");
    const { data, error } = await oldClient.from('logistica_inversa').select('*');
    
    if (error) {
        console.error("❌ Error obteniendo datos antiguos:", error);
        return;
    }
    
    console.log(`📦 Se encontraron ${data.length} registros. Iniciando migración directa...`);
    
    let successCount = 0;
    for (const record of data) {
        try {
            let productosParseados = [];
            try { productosParseados = JSON.parse(record.producto_devuelto || "[]"); } catch(e) {}

            const newRecord = {
                tipo_movimiento: record.tipo_movimiento,
                comercio: record.comercio,
                transporte: record.transporte,
                referencia_pedido: record.referencia_pedido,
                referencia_transporte: record.referencia_transporte,
                productos: productosParseados,
                cantidad_total: record.cantidad,
                comentarios: record.comentarios,
                sucursal: record.sucursal,
                creado_por: record.creado_por
            };

            const { error: insertErr } = await newClient.from('reverse_logistics').insert([newRecord]);
            
            if (!insertErr) {
                successCount++;
                process.stdout.write('✅');
            } else {
                console.error(`\n❌ Error insertando registro ID ${record.id}:`, insertErr.message);
            }
        } catch(e) {
            console.error(`\n❌ Excepción en registro ID ${record.id}:`, e);
        }
    }
    
    console.log(`\n🎉 Migración directa finalizada. Enviados exitosamente: ${successCount}/${data.length}`);
}

run();
