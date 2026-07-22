const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

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
  console.warn('Advertencia: No se pudo leer el archivo .env:', e.message);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log('=== RESTAURANDO STOCK Y ESTADO PARA SIM3479 ===\n');

  // 1. Obtener producto y bodega
  const { data: product } = await supabase
    .from('products')
    .select('id, name, comercio')
    .eq('sku', '2-1')
    .eq('comercio', 'SIMPLEMENTE CAFE')
    .maybeSingle();

  if (!product) {
    console.error('Producto SKU 2-1 no encontrado.');
    return;
  }

  const warehouseId = 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09'; // Bodega Central

  // 2. Restablecer el stock a 1
  const { error: invErr } = await supabase
    .from('inventory')
    .update({ quantity: 1 })
    .eq('product_id', product.id)
    .eq('warehouse_id', warehouseId);

  if (invErr) {
    console.error('Error al restaurar inventario:', invErr.message);
  } else {
    console.log('✅ Stock restablecido a 1 unidad.');
  }

  // 3. Eliminar el movimiento de salida
  const { error: delErr } = await supabase
    .from('movements')
    .delete()
    .eq('product_id', product.id)
    .eq('warehouse_id', warehouseId)
    .eq('type', 'out')
    .ilike('reference_doc', '%bd90e249-c585-4eb8-8026-788253acb48c%');

  if (delErr) {
    console.error('Error al eliminar movimiento:', delErr.message);
  } else {
    console.log('✅ Movimiento de salida eliminado.');
  }

  // 4. Cambiar estado del pedido SIM3479 a 'para procesar' y 'En procesamiento'
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .update({ 
      status: 'para procesar',
      estado_wms: 'En procesamiento'
    })
    .eq('external_order_number', 'SIM3479')
    .eq('comercio', 'SIMPLEMENTE CAFE')
    .select()
    .maybeSingle();

  if (orderErr) {
    console.error('Error al actualizar pedido:', orderErr.message);
  } else {
    console.log('✅ Pedido SIM3479 actualizado a "para procesar" / "En procesamiento".');
  }

  // 5. Crear la incidencia crítica
  if (order) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('comercio', 'SIMPLEMENTE CAFE')
      .maybeSingle();

    const userId = profile?.id || order.merchant_id;

    const { error: incErr } = await supabase
      .from('incidencias')
      .insert({
        user_id: userId,
        comercio: 'SIMPLEMENTE CAFE',
        title: 'Falta de stock crítico - Pedido SIM3479',
        description: 'El pedido SIM3479 no se pudo despachar por falta de stock del SKU 2-1 en la Bodega Central (Faltan 1 un.).',
        type: 'stock',
        severity: 'critico',
        status: 'pendiente',
        solution: ''
      });

    if (incErr) {
      console.error('Error al insertar incidencia:', incErr.message);
    } else {
      console.log('✅ Incidencia crítica creada con éxito.');
    }
  }
}

run();
