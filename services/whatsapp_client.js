/**
 * Cliente de Notificaciones WhatsApp para Stocka WMS
 * Compatible con Baileys local o Evolution API remota.
 */

const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL || 'https://stocka-whatsapp-bot.onrender.com';
const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY || 'stocka_wa_internal_secret_2026';

const getHeaders = () => ({
  'Content-Type': 'application/json',
  'x-api-key': WHATSAPP_API_KEY
});

async function checkWhatsAppStatus() {
  try {
    const response = await fetch(`${WHATSAPP_API_URL}/status`, {
      headers: getHeaders()
    });
    return await response.json();
  } catch (error) {
    return { status: 'OFFLINE', error: error.message };
  }
}

async function sendWhatsAppMessage(to, message) {
  try {
    const response = await fetch(`${WHATSAPP_API_URL}/send-message`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ to, message })
    });
    return await response.json();
  } catch (error) {
    console.error('[WhatsApp Client] Error enviando mensaje:', error);
    return { success: false, error: error.message };
  }
}

async function sendPickupAlert({
  to,
  orderNumber,
  platform = 'Stocka WMS',
  customerName,
  customerPhone,
  items = [],
  pickupLocation = 'Bodega Principal Stocka',
  notes = ''
}) {
  try {
    const response = await fetch(`${WHATSAPP_API_URL}/send-pickup-alert`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        to,
        orderNumber,
        platform,
        customerName,
        customerPhone,
        items,
        pickupLocation,
        notes
      })
    });
    return await response.json();
  } catch (error) {
    console.error('[WhatsApp Client] Error enviando alerta de retiro:', error);
    return { success: false, error: error.message };
  }
}

async function listBotGroups() {
  try {
    const response = await fetch(`${WHATSAPP_API_URL}/groups`, {
      headers: getHeaders()
    });
    return await response.json();
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  checkWhatsAppStatus,
  sendWhatsAppMessage,
  sendPickupAlert,
  listBotGroups
};
