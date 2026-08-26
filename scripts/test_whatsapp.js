/**
 * Script de prueba para el Bot de WhatsApp de Stocka WMS
 * Uso: node scripts/test_whatsapp.js [numero_o_jid_grupo]
 */

const { checkWhatsAppStatus, sendWhatsAppMessage, sendPickupAlert, listBotGroups } = require('../services/whatsapp_client');

async function run() {
  console.log('🔍 1. Verificando estado del servicio WhatsApp...');
  const status = await checkWhatsAppStatus();
  console.log('Estado:', status);

  if (status.status !== 'CONNECTED') {
    console.log('\n⚠️ WhatsApp no está conectado todavía.');
    if (status.qrUrl) {
      console.log(`👉 Abre tu navegador en: ${status.qrUrl} para escanear el código QR.`);
    }
    return;
  }

  const target = process.argv[2];

  if (!target) {
    console.log('\n📋 Grupos disponibles en los que está el bot:');
    const groups = await listBotGroups();
    console.log(JSON.stringify(groups, null, 2));

    console.log('\n💡 Para enviar un mensaje de prueba ejecuta:');
    console.log('node scripts/test_whatsapp.js <numero_con_codigo_pais_ej_56912345678_o_jid_de_grupo>');
    return;
  }

  console.log(`\n🚀 Enviando alerta de prueba de RETIRO EN BODEGA a: ${target}...`);

  const result = await sendPickupAlert({
    to: target,
    orderNumber: 'STK-9842',
    platform: 'Shopify / Stocka WMS',
    customerName: 'Rodrigo González',
    customerPhone: '+56 9 8765 4321',
    items: [
      { name: 'Zapatilla Deportiva Running Pro', sku: 'ZAP-RUN-42', quantity: 1 },
      { name: 'Calcetines Técnicos Pack x3', sku: 'CALC-TEC-01', quantity: 2 }
    ],
    pickupLocation: 'Bodega Stocka - Pudahuel (Módulo Retiro B3)',
    notes: 'Cliente retira hoy a las 17:00 hrs. Presentar cédula de identidad.'
  });

  console.log('\nResultado del envío:', result);
}

run();
