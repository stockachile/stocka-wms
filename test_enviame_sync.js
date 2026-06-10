const { createClient } = require('@supabase/supabase-js');

// ==========================================
// CONFIGURACIÓN DE PRUEBA
// ==========================================
const SUPABASE_URL = 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
// Asegúrate de tener configurada esta variable en tu terminal o pasarla aquí para la prueba:
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ ERROR: La variable de entorno SUPABASE_SERVICE_ROLE_KEY no está configurada.');
  console.error('Para ejecutar este test, puedes correr:');
  console.error('$env:SUPABASE_SERVICE_ROLE_KEY="tu_key_secreta"; node test_enviame_sync.js');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Simulación de los datos del webhook de Enviame
const mockEnviameWebhook = {
  idPedido: 'TEST-ORDER-123', // Puede ser un external_order_number o el UUID
  trackingReal: 'ENT-987654321',
  courier: 'Starken',
  status: 'Entregado con exito',
  tUrl: 'https://api.enviame.io/s2/companies/123/deliveries/ENT-987654321/tracking',
  lUrl: 'https://api.enviame.io/labels/label_pdf_example.pdf',
  idMaestro: '99998888'
};

async function testSync() {
  console.log('🧪 Iniciando test de sincronización Enviame -> Supabase...');

  // 1. Buscar o crear una orden de prueba en la BD para poder actualizarla
  console.log('1. Buscando pedido de prueba o creando uno nuevo...');
  
  let order = null;
  
  // Buscar si ya existe la orden con external_order_number 'TEST-ORDER-123'
  const { data: existingOrder, error: findError } = await supabase
    .from('orders')
    .select('*')
    .eq('external_order_number', mockEnviameWebhook.idPedido)
    .maybeSingle();

  if (findError) {
    console.error('❌ Error al buscar pedido:', findError.message);
    return;
  }

  if (existingOrder) {
    console.log(`✅ Pedido de prueba existente encontrado (ID: ${existingOrder.id})`);
    order = existingOrder;
  } else {
    // Si no existe, creamos uno nuevo. Necesitamos un merchant_id de la tabla profiles.
    const { data: profile, error: profErr } = await supabase.from('profiles').select('id').limit(1).single();
    
    if (profErr || !profile) {
      console.error('❌ Error: No se encontró ningún cliente en la tabla profiles para asociar el pedido de prueba.', profErr?.message);
      return;
    }

    console.log(`Creando nuevo pedido de prueba para el cliente ${profile.id}...`);
    const { data: newOrder, error: insertErr } = await supabase
      .from('orders')
      .insert([{
        merchant_id: profile.id,
        external_order_number: mockEnviameWebhook.idPedido,
        external_platform: 'Manual',
        status: 'para procesar'
      }])
      .select()
      .single();

    if (insertErr) {
      console.error('❌ Error al crear pedido de prueba:', insertErr.message);
      return;
    }

    console.log(`✅ Pedido de prueba creado exitosamente (ID: ${newOrder.id})`);
    order = newOrder;
  }

  // 2. Simular el mapeo de estados del Google Apps Script
  console.log('2. Simulando el mapeo de estados...');
  const mapStatus = (status) => {
    const s = status.toLowerCase().trim();
    if (s.includes('entregado')) return 'entregado';
    if (s.includes('transito') || s.includes('ruta') || s.includes('reparto')) return 'en tránsito';
    if (s.includes('recolectado') || s.includes('despachado')) return 'despachado';
    if (s.includes('cancelado')) return 'cancelado';
    return null;
  };

  const mappedStatus = mapStatus(mockEnviameWebhook.status);
  console.log(`   Estado original: "${mockEnviameWebhook.status}" -> Mapeado: "${mappedStatus}"`);

  // 3. Ejecutar la actualización en Supabase (tal como lo haría Google Apps Script)
  console.log('3. Actualizando datos de despacho en Supabase...');
  
  const updatePayload = {
    tracking_number: mockEnviameWebhook.trackingReal,
    tracking_url: mockEnviameWebhook.tUrl,
    label_url: mockEnviameWebhook.lUrl,
    courier: mockEnviameWebhook.courier,
    enviame_delivery_id: mockEnviameWebhook.idMaestro,
    enviame_status: mockEnviameWebhook.status
  };

  if (mappedStatus) {
    updatePayload.status = mappedStatus;
  }

  const { data: updatedOrders, error: updateError } = await supabase
    .from('orders')
    .update(updatePayload)
    .eq('id', order.id)
    .select();

  if (updateError) {
    console.error('❌ Error al actualizar Supabase:', updateError.message);
    console.error('⚠️ ¿Ejecutaste el script SQL "supabase_schema_enviame.sql" antes de esta prueba?');
    return;
  }

  if (!updatedOrders || updatedOrders.length === 0) {
    console.error('❌ No se actualizó ningún registro en Supabase.');
    return;
  }

  const updatedOrder = updatedOrders[0];
  console.log('✅ Pedido actualizado en Supabase:');
  console.log(`   - ID: ${updatedOrder.id}`);
  console.log(`   - External Order: ${updatedOrder.external_order_number}`);
  console.log(`   - Status: ${updatedOrder.status}`);
  console.log(`   - Tracking: ${updatedOrder.tracking_number} (${updatedOrder.courier})`);
  console.log(`   - Tracking URL: ${updatedOrder.tracking_url}`);
  console.log(`   - Label PDF URL: ${updatedOrder.label_url}`);
  console.log(`   - Enviame Status: ${updatedOrder.enviame_status}`);

  console.log('\n🎉 ¡Test de sincronización completado exitosamente!');
}

testSync();
