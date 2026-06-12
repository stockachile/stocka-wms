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

  // 3. Ejecutar la actualización en la nueva tabla 'enviame_shipments' (upsert)
  console.log('3. Realizando upsert del envío en la tabla enviame_shipments...');
  
  const upsertPayload = {
    id: mockEnviameWebhook.idMaestro, // enviame_delivery_id como PK
    order_id: 'Sag_16101', // Usamos un order_id crudo de texto para probar la ausencia de restricción FK
    tracking_number: mockEnviameWebhook.trackingReal,
    tracking_url: mockEnviameWebhook.tUrl,
    label_url: mockEnviameWebhook.lUrl,
    courier: mockEnviameWebhook.courier,
    status: mockEnviameWebhook.status,
    raw_payload: mockEnviameWebhook // Simula el payload de Enviame
  };

  const { data: upsertedShipments, error: upsertError } = await supabase
    .from('enviame_shipments')
    .upsert(upsertPayload, { onConflict: 'id' })
    .select();

  if (upsertError) {
    console.error('❌ Error al insertar/actualizar envío en Supabase:', upsertError.message);
    console.error('⚠️ ¿Ejecutaste el script SQL "supabase_schema_enviame_table.sql" antes de esta prueba?');
    return;
  }

  if (!upsertedShipments || upsertedShipments.length === 0) {
    console.error('❌ No se registró ningún envío en Supabase.');
    return;
  }

  const shipment = upsertedShipments[0];
  console.log('✅ Envío registrado/actualizado en Supabase (enviame_shipments):');
  console.log(`   - ID Envío: ${shipment.id}`);
  console.log(`   - ID Pedido Asociado: ${shipment.order_id}`);
  console.log(`   - Tracking: ${shipment.tracking_number} (${shipment.courier})`);
  console.log(`   - Tracking URL: ${shipment.tracking_url}`);
  console.log(`   - Label PDF URL: ${shipment.label_url}`);
  console.log(`   - Estado Courier: ${shipment.status}`);

  console.log('\n🎉 ¡Test de sincronización completado exitosamente!');
}

testSync();
