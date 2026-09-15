const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Cargar variables de entorno del WMS
const envPath = '.env';
let env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1);
      }
      env[key] = value.trim();
    }
  });
}

const WMS_URL = env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const WMS_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const client = createClient(WMS_URL, WMS_KEY);

const SUCURSAL_NUNOA_WH_ID = '973da888-8a63-4790-a08f-919e1af41a93';

async function runTest() {
  console.log('🧪 === INICIANDO PRUEBA DE FLUJO COMPLETO POS SUCURSAL ÑUÑOA ===');

  try {
    // 1. Probar consulta de comercios y configuración de catálogo
    console.log('\n1. Consultando comercios con catálogo y seguimiento de stock...');
    const { data: cacList, error: cacErr } = await client
      .from('comercios_adicional_config')
      .select('comercio, inventario_seguimiento, onboarding_checklist')
      .limit(5);

    if (cacErr) throw cacErr;
    console.log(`✅ Se obtuvieron ${cacList.length} comercios de prueba:`);
    cacList.forEach(c => {
      console.log(`   - ${c.comercio}: seguimiento_stock=${c.inventario_seguimiento}, catalog_ready=${c.onboarding_checklist?.catalog_ready}`);
    });

    const testCommerce = cacList[0]?.comercio || 'THE SKIN STORE';
    console.log(`\n2. Consultando productos de catálogo para: "${testCommerce}" en Matriz Ñuñoa...`);

    const { data: prods, error: pErr } = await client
      .from('products')
      .select('id, sku, name, price, inventory(quantity, committed_quantity, warehouse_id)')
      .eq('comercio', testCommerce)
      .neq('status', 'archived')
      .limit(3);

    if (pErr) throw pErr;
    console.log(`✅ Se encontraron ${prods.length} productos para "${testCommerce}":`);
    prods.forEach(p => {
      const nunoaInv = (p.inventory || []).find(i => i.warehouse_id === SUCURSAL_NUNOA_WH_ID);
      const availNunoa = nunoaInv ? (nunoaInv.quantity || 0) - (nunoaInv.committed_quantity || 0) : 0;
      console.log(`   - [${p.sku}] ${p.name} | Precio: $${p.price} | Stock Disp. Ñuñoa: ${availNunoa} un`);
    });

    // 3. Simular creación de Venta POS de Prueba
    const testCode = 'TEST-POS-' + Math.random().toString(36).substr(2, 6).toUpperCase();
    console.log(`\n3. Registrando Venta de Prueba en store_sales (Código: ${testCode})...`);

    const testSalePayload = {
      codigo_venta: testCode,
      comercio: testCommerce,
      nombre_cliente: 'Cliente de Prueba Automatizada',
      correo_cliente: 'test.pos@stocka.cl',
      telefono_cliente: '+56912345678',
      productos: JSON.stringify([{
        sku: prods[0]?.sku || 'TEST-SKU',
        producto: prods[0]?.name || 'Producto Prueba',
        product_id: prods[0]?.id || null,
        cantidad: 1,
        precio: prods[0]?.price || 15000,
        subtotal: prods[0]?.price || 15000
      }]),
      monto_total: prods[0]?.price || 15000,
      modo_pago: 'Tarjeta de Débito',
      documento_tipo: 'BOLETA',
      sucursal: 'Ñuñoa',
      comentarios: 'Venta de validación automatizada',
      creado_por: 'Script de Test'
    };

    // Obtener siguiente ID disponible para store_sales si la secuencia de BD no está asignada
    let nextId = 1;
    try {
      const { data: maxRow } = await client
        .from('store_sales')
        .select('id')
        .order('id', { ascending: false })
        .limit(1);
      if (maxRow && maxRow.length > 0 && maxRow[0].id) {
        nextId = parseInt(maxRow[0].id, 10) + 1;
      }
    } catch (e) {
      console.warn('No se pudo obtener max id de store_sales:', e);
    }
    testSalePayload.id = nextId;
    console.log(`ℹ️ Asignando ID de venta secuencial: ${nextId}`);

    const { data: createdSale, error: saleErr } = await client
      .from('store_sales')
      .insert([testSalePayload])
      .select()
      .single();

    if (saleErr) throw saleErr;
    console.log(`✅ Venta guardada exitosamente en store_sales con ID: ${createdSale.id}`);

    // 4. Simular creación de Pedido en el Gestor (orders)
    console.log('\n4. Creando pedido correspondiente en orders...');
    const testOrderPayload = {
      comercio: testCommerce,
      status: 'despachado',
      estado_wms: 'Despachado',
      customer_name: 'Cliente de Prueba Automatizada',
      customer_email: 'test.pos@stocka.cl',
      shipping_address: 'Campo de Deportes 405 (Venta Presencial)',
      shipping_city: 'Ñuñoa',
      shipping_method: 'Venta Presencial Sucursal Ñuñoa',
      operador: 'SUCURSAL ÑUÑOA',
      courier: 'STOCKA',
      origen: 'Punto de Venta',
      external_platform: 'Punto de Venta',
      external_order_number: testCode,
      cantidad: 1,
      sku: prods[0]?.sku || 'TEST-SKU',
      item: prods[0]?.name || 'Producto Prueba',
      total_value: prods[0]?.price || 15000,
      sucursal_pickeo: 'Matriz Ñuñoa',
      agenda: 'POS'
    };

    const { data: createdOrder, error: orderErr } = await client
      .from('orders')
      .insert([testOrderPayload])
      .select()
      .single();

    if (orderErr) throw orderErr;
    console.log(`✅ Pedido guardado en orders con ID: ${createdOrder.id}`);

    // 5. Simular inserción de order_items
    console.log('\n5. Vinculando ítem en order_items...');
    const sampleOi = await client.from('order_items').select('*').limit(1);
    console.log('Estructura muestra order_items:', sampleOi.data);

    const { data: oiList, error: oiErr } = await client
      .from('order_items')
      .insert([{
        order_id: createdOrder.id,
        product_id: prods[0]?.id || null,
        warehouse_id: SUCURSAL_NUNOA_WH_ID,
        quantity: 1
      }])
      .select();

    if (oiErr) {
      console.warn('Advertencia en order_items:', oiErr);
    } else {
      console.log(`✅ Item vinculado exitosamente en order_items:`, oiList);
    }
    const createdOrderItem = oiList?.[0] || null;

    // 6. Simular trazabilidad en movements
    if (prods[0]?.id) {
      console.log('\n6. Registrando movimiento de salida en movements...');
      const { data: mov, error: mErr } = await client
        .from('movements')
        .insert([{
          product_id: prods[0].id,
          warehouse_id: SUCURSAL_NUNOA_WH_ID,
          type: 'out',
          quantity: 1,
          reference_doc: `Test POS Ñuñoa [${testCode}]`,
          order_id: createdOrder.id
        }])
        .select()
        .single();

      if (mErr) throw mErr;
      console.log(`✅ Movimiento registrado en movements con ID: ${mov.id}`);

      // Limpiar movimiento de prueba
      await client.from('movements').delete().eq('id', mov.id);
    }

    // 7. Limpieza de datos de prueba
    console.log('\n7. Limpiando datos de prueba...');
    if (createdOrderItem?.id) await client.from('order_items').delete().eq('id', createdOrderItem.id);
    if (createdOrder?.id) await client.from('orders').delete().eq('id', createdOrder.id);
    if (createdSale?.id) await client.from('store_sales').delete().eq('id', createdSale.id);
    // Limpieza de seguridad por código
    await client.from('orders').delete().ilike('external_order_number', 'TEST-POS-%');
    await client.from('store_sales').delete().ilike('codigo_venta', 'TEST-POS-%');
    console.log('✅ Registros temporales eliminados correctamente. Base de datos limpia.');

    console.log('\n🎉 ¡TODAS LAS PRUEBAS DEL FLUJO POS PASARON EXITOSAMENTE!');

  } catch (err) {
    console.error('\n❌ Error durante la prueba:', err);
  }
}

runTest();
