/**
 * Cliente de Notificaciones WhatsApp para Stocka WMS
 * Compatible con Baileys local o Evolution API remota.
 */

const fs = require('fs');
const path = require('path');

// Cargar variables desde .env si existe y no están en process.env
let localEnv = {};
try {
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (m) {
        let v = (m[2] || '').trim();
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        localEnv[m[1]] = v;
      }
    });
  }
} catch (_) {}

const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL || localEnv.WHATSAPP_API_URL || 'https://stocka-whatsapp-bot.onrender.com';
const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY || localEnv.WHATSAPP_API_KEY || '';

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

async function sendWhatsAppMessage(to, message, options = {}) {
  try {
    const response = await fetch(`${WHATSAPP_API_URL}/send-message`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ to, message, ...options })
    });
    return await response.json();
  } catch (error) {
    console.error('[WhatsApp Client] Error enviando mensaje:', error);
    return { success: false, error: error.message };
  }
}

async function sendTrackedWhatsAppMessage(payload) {
  try {
    const response = await fetch(`${WHATSAPP_API_URL}/send-tracked-message`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload)
    });
    return await response.json();
  } catch (error) {
    console.error('[WhatsApp Client] Error enviando mensaje con seguimiento:', error);
    return { success: false, error: error.message };
  }
}

async function getTrackedMessages() {
  try {
    const response = await fetch(`${WHATSAPP_API_URL}/tracked-messages`, {
      headers: getHeaders()
    });
    return await response.json();
  } catch (error) {
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

async function notifyManualOrdersAlert({ force = false, dryRun = false, targetGroup } = {}) {
  try {
    const response = await fetch(`${WHATSAPP_API_URL}/notify-manual-orders`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ force, dryRun, targetGroup })
    });
    return await response.json();
  } catch (error) {
    console.error('[WhatsApp Client] Error disparando alerta de pedidos manuales:', error);
    return { success: false, error: error.message };
  }
}

async function sendWhatsAppDocument({ to, fileBuffer, fileBase64, fileName, caption, mimetype = 'application/pdf' }) {
  try {
    let base64Content = fileBase64;
    if (!base64Content && fileBuffer) {
      base64Content = Buffer.isBuffer(fileBuffer) ? fileBuffer.toString('base64') : Buffer.from(fileBuffer).toString('base64');
    }

    const response = await fetch(`${WHATSAPP_API_URL}/send-document`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        to,
        fileBase64: base64Content,
        fileName,
        caption,
        mimetype
      })
    });
    return await response.json();
  } catch (error) {
    console.error('[WhatsApp Client] Error enviando documento:', error);
    return { success: false, error: error.message };
  }
}

async function checkCalendarStatus(date) {
  try {
    const url = date ? `${WHATSAPP_API_URL}/calendar/status?date=${encodeURIComponent(date)}` : `${WHATSAPP_API_URL}/calendar/status`;
    const response = await fetch(url, { method: 'GET' });
    return await response.json();
  } catch (error) {
    console.error('[WhatsApp Client] Error consultando estado de calendario:', error);
    return { success: false, error: error.message };
  }
}

async function syncCalendarCache() {
  try {
    const response = await fetch(`${WHATSAPP_API_URL}/calendar/sync-cache`, {
      method: 'POST',
      headers: getHeaders()
    });
    return await response.json();
  } catch (error) {
    console.error('[WhatsApp Client] Error sincronizando caché de calendario:', error);
    return { success: false, error: error.message };
  }
}

async function importChileHolidays(year = 2026) {
  try {
    const response = await fetch(`${WHATSAPP_API_URL}/calendar/import-holidays`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ year })
    });
    return await response.json();
  } catch (error) {
    console.error('[WhatsApp Client] Error importando feriados chilenos:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  checkWhatsAppStatus,
  sendWhatsAppMessage,
  sendTrackedWhatsAppMessage,
  getTrackedMessages,
  sendWhatsAppDocument,
  sendPickupAlert,
  listBotGroups,
  notifyManualOrdersAlert,
  checkCalendarStatus,
  syncCalendarCache,
  importChileHolidays
};

