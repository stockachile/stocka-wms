const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Cargar .env manualmente
try {
  const envContent = fs.readFileSync('.env', 'utf-8');
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const key = trimmed.substring(0, idx).trim();
      const val = trimmed.substring(idx + 1).trim();
      process.env[key] = val;
    }
  });
} catch (e) {
  console.warn('Advertencia: No se pudo leer el archivo .env automáticamente:', e.message);
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Faltan credenciales de Supabase en el archivo .env o variables de entorno');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function verify() {
  try {
    console.log('=== VERIFICACIÓN DE CONFIGURACIÓN DE STOCK: MAGIC MAKEUP ===\n');

    // 1. Obtener la configuración de Magic Makeup
    const { data: config, error: configErr } = await supabase
      .from('comercios_adicional_config')
      .select('*')
      .eq('comercio', 'MAGIC MAKEUP')
      .maybeSingle();

    if (configErr) throw configErr;

    if (!config) {
      console.log('❌ No se encontró configuración adicional para el comercio "MAGIC MAKEUP".');
      return;
    }

    console.log('Configuración encontrada:');
    console.log(`- Seguimiento de Inventario: ${config.inventario_seguimiento ? 'ACTIVO (true)' : 'INACTIVO (false)'}`);
    console.log(`- Trae sigla: ${config.pedido_trae_sigla}`);
    console.log('- Pedidos de Inicio por Canal (JSONB):', JSON.stringify(config.inventario_inicio_pedidos, null, 2));
    console.log('\n--------------------------------------------------\n');

    // 2. Obtener pedidos recientes de MAGIC MAKEUP
    console.log('Obteniendo pedidos recientes de MAGIC MAKEUP...');
    const { data: orders, error: ordersErr } = await supabase
      .from('orders')
      .select('id, external_order_number, external_platform, status, created_at')
      .eq('comercio', 'MAGIC MAKEUP')
      .order('created_at', { ascending: false })
      .limit(15);

    if (ordersErr) throw ordersErr;

    if (!orders || orders.length === 0) {
      console.log('ℹ️ No se encontraron pedidos registrados para "MAGIC MAKEUP" en el sistema.');
      return;
    }

    console.log(`Se encontraron ${orders.length} pedidos recientes. Evaluando cada uno con public.should_process_order_stock():\n`);

    console.log(String('PLATAFORMA').padEnd(15) + ' | ' + 
                String('Nº PEDIDO').padEnd(15) + ' | ' + 
                String('FECHA/HORA').padEnd(25) + ' | ' + 
                String('PROCESAR STOCK?').padEnd(15));
    console.log('-'.repeat(80));

    for (const order of orders) {
      const platform = order.external_platform || 'Manual';
      const orderNum = order.external_order_number || 'N/A';
      const dateStr = order.created_at ? new Date(order.created_at).toISOString() : 'N/A';

      // Invocar should_process_order_stock mediante RPC
      const { data: shouldProcess, error: rpcErr } = await supabase.rpc('should_process_order_stock', {
        p_order_id: order.id
      });

      let rpcResult = '';
      if (rpcErr) {
        rpcResult = `ERROR: ${rpcErr.message}`;
      } else {
        rpcResult = shouldProcess ? '✅ SÍ (Procesar)' : '❌ NO (Ignorar)';
      }

      console.log(platform.padEnd(15) + ' | ' + 
                  orderNum.padEnd(15) + ' | ' + 
                  dateStr.padEnd(25) + ' | ' + 
                  rpcResult.padEnd(15));
    }

  } catch (err) {
    console.error('Error durante la verificación:', err);
  }
}

verify();
