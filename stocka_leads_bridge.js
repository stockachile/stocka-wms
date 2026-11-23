/**
 * STOCKA WMS - Puente Local Unificado para Central de Leads (Puerto 3099)
 * 1. Sincronización HubSpot CRM Meetings + Notas de Gemini en Google Meet (/sync-hubspot, /find-gemini-notes)
 * 2. Integración WhatsApp Multi-Device vía Código QR (@whiskeysockets/baileys)
 * 3. Bandeja de Mensajes en Tiempo Real, Cola de Mensajes Programados y Motor de Automatizaciones
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const pino = require('pino');
const {
  default: makeWASocketDef,
  makeWASocket: makeWASocketNamed,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const makeWASocket = makeWASocketNamed || makeWASocketDef;
const PORT = 3099;

const DATA_DIR = path.join(__dirname, '.whatsapp_data');
const AUTH_DIR = path.join(DATA_DIR, 'session_auth');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages_store.json');
const SCHEDULED_FILE = path.join(DATA_DIR, 'scheduled_queue.json');
const AUTOMATIONS_FILE = path.join(DATA_DIR, 'automations_config.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

// ============================================================================
// UTILIDADES DE ARCHIVOS JSON Y NORMALIZACIÓN DE TELÉFONOS
// ============================================================================
function readJsonSafe(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn(`[Bridge] Error leyendo ${path.basename(filePath)}:`, e.message);
  }
  return fallback;
}

function writeJsonSafe(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.warn(`[Bridge] Error guardando ${path.basename(filePath)}:`, e.message);
  }
}

function normalizeChileanPhone(rawPhone) {
  let digits = String(rawPhone || '').replace(/\D/g, '');
  if (!digits) return '';
  // Quitar ceros iniciales
  digits = digits.replace(/^0+/, '');
  // Si tiene 8 dígitos (ej. 91234567 -> falta el 569 o 56)
  if (digits.length === 8) {
    digits = '569' + digits;
  } else if (digits.length === 9 && digits.startsWith('9')) {
    digits = '56' + digits;
  }
  return digits;
}

function extractPhoneFromJid(jid) {
  if (!jid) return '';
  const beforeAt = String(jid).split('@')[0];
  // Quitar sufijo de dispositivo ":12" si existe
  return beforeAt.split(':')[0].replace(/\D/g, '');
}

// ============================================================================
// ALMACENAMIENTO PERSISTENTE (MENSAJES, PROGRAMADOS Y AUTOMATIZACIONES)
// ============================================================================
let messagesStore = readJsonSafe(MESSAGES_FILE, []);
let scheduledQueue = readJsonSafe(SCHEDULED_FILE, []);
let automationsConfig = readJsonSafe(AUTOMATIONS_FILE, {
  auto_welcome_quote: {
    enabled: true,
    mode: 'schedule', // 'schedule' | 'draft'
    delayMinutes: 10,
    templateTone: 'consultivo',
    description: 'Programa un WhatsApp consultivo 10 min después de que un prospecto cotiza en el Cotizador 360'
  },
  auto_meeting_reminder: {
    enabled: true,
    mode: 'schedule',
    hoursBefore: 2,
    description: 'Programa un recordatorio automático por WhatsApp 2 horas antes de cada reunión agendada en Google Meet / HubSpot'
  },
  auto_followup_48h: {
    enabled: true,
    mode: 'schedule',
    hoursAfter: 48,
    description: 'Detecta prospectos cotizados hace +48 horas sin respuesta y agenda un mensaje de seguimiento consultivo'
  },
  auto_update_lead_status: {
    enabled: true,
    description: 'Actualiza automáticamente el estado del prospecto a "Contactado" cuando responde por WhatsApp'
  },
  processedLeadKeys: []
});

function saveMessagesStore() {
  if (messagesStore.length > 1500) {
    messagesStore = messagesStore.slice(-1500);
  }
  writeJsonSafe(MESSAGES_FILE, messagesStore);
}

function saveScheduledQueue() {
  writeJsonSafe(SCHEDULED_FILE, scheduledQueue);
}

function saveAutomationsConfig() {
  writeJsonSafe(AUTOMATIONS_FILE, automationsConfig);
}

function recordWhatsAppMessage(msgObj) {
  const cleanPhone = normalizeChileanPhone(msgObj.phone);
  if (!cleanPhone) return null;

  const id = msgObj.id || `wa_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const existingIdx = messagesStore.findIndex(m => m.id === id);
  const entry = {
    id,
    phone: cleanPhone,
    jid: msgObj.jid || `${cleanPhone}@s.whatsapp.net`,
    pushName: msgObj.pushName || '',
    leadEmail: msgObj.leadEmail || '',
    leadName: msgObj.leadName || msgObj.pushName || '',
    companyName: msgObj.companyName || '',
    direction: msgObj.direction === 'outbound' ? 'outbound' : 'inbound',
    text: String(msgObj.text || '').trim(),
    timestamp: msgObj.timestamp || new Date().toISOString(),
    read: msgObj.direction === 'outbound' ? true : Boolean(msgObj.read),
    source: msgObj.source || 'whatsapp_live'
  };

  if (!entry.text) return null;

  if (existingIdx >= 0) {
    messagesStore[existingIdx] = { ...messagesStore[existingIdx], ...entry };
  } else {
    messagesStore.push(entry);
  }
  saveMessagesStore();
  return entry;
}

// ============================================================================
// MOTOR WHATSAPP MULTI-DEVICE (@whiskeysockets/baileys)
// ============================================================================
let waSocket = null;
let waStatus = 'disconnected'; // 'disconnected' | 'connecting' | 'qr_ready' | 'connected'
let waQrDataUrl = '';
let waConnectedPhone = '';
let waConnectedName = '';
let waLastError = '';
let isInitializingWa = false;

async function initWhatsAppConnection(forceNewQr = false) {
  if (isInitializingWa) return;
  if (waStatus === 'connected' && waSocket && !forceNewQr) return;

  isInitializingWa = true;
  waLastError = '';

  try {
    if (forceNewQr && waSocket) {
      try {
        waSocket.ev.removeAllListeners();
        waSocket.end(undefined);
      } catch (e) {}
      waSocket = null;
    }

    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }

    waStatus = 'connecting';
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    let version = [2, 3000, 1015901307];
    try {
      const latest = await fetchLatestBaileysVersion();
      if (latest && latest.version) version = latest.version;
    } catch (verErr) {}

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['Stocka WMS CRM', 'Chrome', '122.0.0'],
      syncFullHistory: false,
      markOnlineOnConnect: false
    });

    waSocket = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          waQrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 1 });
          waStatus = 'qr_ready';
          console.log('[WhatsApp Bridge] Código QR listo para escanear desde el WMS.');
        } catch (qrErr) {
          console.error('[WhatsApp Bridge] Error generando QR DataURL:', qrErr.message);
        }
      }

      if (connection === 'open') {
        waStatus = 'connected';
        waQrDataUrl = '';
        waLastError = '';
        const me = sock.user || {};
        waConnectedPhone = extractPhoneFromJid(me.id || '');
        waConnectedName = me.name || me.verifiedName || 'WhatsApp Stocka';
        console.log(`[WhatsApp Bridge] Conectado exitosamente como +${waConnectedPhone} (${waConnectedName})`);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`[WhatsApp Bridge] Conexión cerrada (code=${statusCode}). Reintentar=${shouldReconnect}`);

        if (statusCode === DisconnectReason.loggedOut) {
          waStatus = 'disconnected';
          waQrDataUrl = '';
          waConnectedPhone = '';
          waConnectedName = '';
          try {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          } catch (e) {}
        } else if (shouldReconnect) {
          waStatus = 'connecting';
          setTimeout(() => {
            initWhatsAppConnection(false);
          }, 3500);
        } else {
          waStatus = 'disconnected';
        }
      }
    });

    // Escuchar mensajes entrantes y salientes en tiempo real
    sock.ev.on('messages.upsert', async (event) => {
      try {
        const msgs = event.messages || [];
        for (const m of msgs) {
          if (!m.message) continue;
          const remoteJid = m.key?.remoteJid || '';
          // Ignorar grupos, estados/broadcasts y newsletters
          if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast' || remoteJid.endsWith('@newsletter')) {
            continue;
          }

          const phone = extractPhoneFromJid(remoteJid);
          if (!phone || phone.length < 8) continue;

          const text =
            m.message.conversation ||
            m.message.extendedTextMessage?.text ||
            m.message.imageMessage?.caption ||
            m.message.videoMessage?.caption ||
            m.message.documentMessage?.caption ||
            m.message.buttonsResponseMessage?.selectedDisplayText ||
            m.message.listResponseMessage?.title ||
            '';

          if (!text || !String(text).trim()) continue;

          const isFromMe = Boolean(m.key?.fromMe);
          const msgTimestamp = m.messageTimestamp
            ? new Date(Number(m.messageTimestamp) * 1000).toISOString()
            : new Date().toISOString();

          recordWhatsAppMessage({
            id: m.key?.id || `wa_${Date.now()}`,
            phone,
            jid: remoteJid,
            pushName: isFromMe ? '' : (m.pushName || ''),
            direction: isFromMe ? 'outbound' : 'inbound',
            text: String(text).trim(),
            timestamp: msgTimestamp,
            read: isFromMe,
            source: 'whatsapp_live'
          });

          if (!isFromMe) {
            console.log(`[WhatsApp Inbound] Nuevo mensaje de +${phone} (${m.pushName || 'Lead'}): ${String(text).slice(0, 90)}`);
          }
        }
      } catch (msgErr) {
        console.warn('[WhatsApp Bridge] Error procesando mensaje entrante:', msgErr.message);
      }
    });
  } catch (err) {
    waStatus = 'disconnected';
    waLastError = err.message || 'Error iniciando WhatsApp';
    console.error('[WhatsApp Bridge] Error en initWhatsAppConnection:', err);
  } finally {
    isInitializingWa = false;
  }
}

// Si ya existe sesión guardada en disco, reconectar automáticamente al iniciar el servidor
if (fs.existsSync(path.join(AUTH_DIR, 'creds.json'))) {
  console.log('[WhatsApp Bridge] Sesión previa detectada en disco. Reconectando automáticamente...');
  initWhatsAppConnection(false);
}

// Función para enviar mensaje real por el socket de WhatsApp
async function sendWhatsAppTextMessage(rawPhone, text, metadata = {}) {
  const cleanPhone = normalizeChileanPhone(rawPhone);
  if (!cleanPhone || cleanPhone.length < 8) {
    throw new Error('Número de teléfono inválido. Ejemplo válido: +56912345678');
  }
  if (!text || !String(text).trim()) {
    throw new Error('El texto del mensaje no puede estar vacío.');
  }
  if (waStatus !== 'connected' || !waSocket) {
    throw new Error('Tu WhatsApp aún no está vinculado. Escanea el Código QR en la pestaña "Conexión QR" o usa el envío rápido por WhatsApp Web.');
  }

  let targetJid = `${cleanPhone}@s.whatsapp.net`;
  try {
    const checkResult = await waSocket.onWhatsApp(targetJid);
    if (Array.isArray(checkResult) && checkResult[0]?.jid) {
      targetJid = checkResult[0].jid;
    }
  } catch (checkErr) {
    // Continuar con targetJid estándar si onWhatsApp no responde
  }

  const sent = await waSocket.sendMessage(targetJid, { text: String(text).trim() });
  const saved = recordWhatsAppMessage({
    id: sent?.key?.id || `wa_out_${Date.now()}`,
    phone: cleanPhone,
    jid: targetJid,
    leadEmail: metadata.leadEmail || '',
    leadName: metadata.leadName || '',
    companyName: metadata.companyName || '',
    direction: 'outbound',
    text: String(text).trim(),
    timestamp: new Date().toISOString(),
    read: true,
    source: metadata.source || 'wms_crm'
  });

  // Marcar mensajes entrantes previos de este número como leídos
  let updatedRead = false;
  messagesStore.forEach(m => {
    if (m.phone === cleanPhone && m.direction === 'inbound' && !m.read) {
      m.read = true;
      updatedRead = true;
    }
  });
  if (updatedRead) saveMessagesStore();

  return saved;
}

// ============================================================================
// RELOJ DESPACHADOR DE MENSAJES PROGRAMADOS (CADA 15 SEGUNDOS)
// ============================================================================
let isProcessingQueue = false;
setInterval(async () => {
  if (isProcessingQueue || waStatus !== 'connected' || !waSocket) return;
  const now = Date.now();
  const dueItems = scheduledQueue.filter(item =>
    item.status === 'pending' &&
    item.scheduledAt &&
    new Date(item.scheduledAt).getTime() <= now
  );

  if (dueItems.length === 0) return;

  isProcessingQueue = true;
  try {
    for (const item of dueItems) {
      try {
        console.log(`[WhatsApp Scheduler] Enviando mensaje programado ${item.id} a +${item.phone} (${item.leadName || item.leadEmail})...`);
        await sendWhatsAppTextMessage(item.phone, item.text, {
          leadEmail: item.leadEmail,
          leadName: item.leadName,
          companyName: item.companyName,
          source: item.sourceRule ? `auto_${item.sourceRule}` : 'scheduled_queue'
        });
        item.status = 'sent';
        item.sentAt = new Date().toISOString();
        item.error = '';
        saveScheduledQueue();
        // Pausa de cortesía de 1.8s entre envíos para cuidar la cuenta de WhatsApp
        await new Promise(r => setTimeout(r, 1800));
      } catch (sendErr) {
        item.status = 'failed';
        item.error = sendErr.message || 'Error al enviar';
        saveScheduledQueue();
        console.warn(`[WhatsApp Scheduler] Falló envío programado ${item.id}:`, sendErr.message);
      }
    }
  } finally {
    isProcessingQueue = false;
  }
}, 15000);

// ============================================================================
// FUNCIONES EXISTENTES DE HUBSPOT Y GOOGLE MEET GEMINI NOTES
// ============================================================================
function stripHtml(html) {
  return String(html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanMeetingNotes(rawText) {
  const txt = stripHtml(rawText);
  if (!txt) return '';
  const isOnlyHubSpotBoilerplate =
    (txt.includes('rescheduleId=') || txt.includes('cancelId=') || txt.includes('¿Necesitas hacer cambios?')) &&
    txt.length < 420 &&
    !txt.toLowerCase().includes('resumen') &&
    !txt.toLowerCase().includes('gemini');

  if (isOnlyHubSpotBoilerplate) {
    return '';
  }

  return txt
    .replace(/Reunión de información de servicios de Stocka\.cl[\s\S]*?cancelId=[a-zA-Z0-9_-]+(&ms=\d+)?/gi, '')
    .replace(/¿Necesitas hacer cambios\?[\s\S]*?cancelId=[a-zA-Z0-9_-]+(&ms=\d+)?/gi, '')
    .trim();
}

function readBodyJson(req) {
  return new Promise((resolve, reject) => {
    let bodyStr = '';
    req.on('data', chunk => { bodyStr += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(bodyStr || '{}'));
      } catch (e) {
        reject(new Error('JSON inválido en el cuerpo de la solicitud'));
      }
    });
    req.on('error', reject);
  });
}

// ============================================================================
// SERVIDOR HTTP UNIFICADO (PUERTO 3099)
// ============================================================================
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  const sendJson = (statusCode, payload) => {
    res.writeHead(statusCode, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };

  // --------------------------------------------------------------------------
  // ENDPOINTS DE WHATSAPP CRM, BANDEJA DEL DÍA, PROGRAMADOR Y AUTOMATIZACIONES
  // --------------------------------------------------------------------------
  if (pathname === '/whatsapp/status' && req.method === 'GET') {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayIncomingCount = messagesStore.filter(m =>
      m.direction === 'inbound' && new Date(m.timestamp) >= startOfToday
    ).length;
    const unreadCount = messagesStore.filter(m => m.direction === 'inbound' && !m.read).length;
    const pendingScheduledCount = scheduledQueue.filter(s => s.status === 'pending').length;

    return sendJson(200, {
      ok: true,
      status: waStatus,
      qrDataUrl: waQrDataUrl,
      connectedPhone: waConnectedPhone,
      connectedName: waConnectedName,
      lastError: waLastError,
      todayIncomingCount,
      unreadCount,
      pendingScheduledCount,
      automations: automationsConfig
    });
  }

  if (pathname === '/whatsapp/connect' && req.method === 'POST') {
    try {
      const body = await readBodyJson(req);
      await initWhatsAppConnection(Boolean(body.forceNewQr));
      // Esperar hasta 2.8s si está generando el QR para devolverlo de inmediato
      let waited = 0;
      while (waStatus === 'connecting' && !waQrDataUrl && waited < 2800) {
        await new Promise(r => setTimeout(r, 250));
        waited += 250;
      }
      return sendJson(200, {
        ok: true,
        status: waStatus,
        qrDataUrl: waQrDataUrl,
        connectedPhone: waConnectedPhone,
        connectedName: waConnectedName,
        lastError: waLastError
      });
    } catch (err) {
      return sendJson(500, { ok: false, error: err.message });
    }
  }

  if (pathname === '/whatsapp/disconnect' && req.method === 'POST') {
    try {
      if (waSocket) {
        try {
          await waSocket.logout();
        } catch (e) {}
        try {
          waSocket.ev.removeAllListeners();
          waSocket.end(undefined);
        } catch (e) {}
        waSocket = null;
      }
      waStatus = 'disconnected';
      waQrDataUrl = '';
      waConnectedPhone = '';
      waConnectedName = '';
      try {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      } catch (e) {}
      return sendJson(200, { ok: true, status: 'disconnected' });
    } catch (err) {
      return sendJson(500, { ok: false, error: err.message });
    }
  }

  if (pathname === '/whatsapp/messages' && req.method === 'GET') {
    const filterPhone = normalizeChileanPhone(parsedUrl.searchParams.get('phone') || '');
    const onlyToday = parsedUrl.searchParams.get('today') === '1';
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    let list = [...messagesStore];
    if (filterPhone) {
      list = list.filter(m => m.phone === filterPhone || m.phone.endsWith(filterPhone.slice(-8)));
    }
    if (onlyToday) {
      list = list.filter(m => new Date(m.timestamp) >= startOfToday);
    }

    // Agrupar conversaciones por teléfono (últimos 8 dígitos como clave de cruce en Chile)
    const convMap = new Map();
    for (const m of messagesStore) {
      const key = m.phone.slice(-9);
      if (!convMap.has(key)) {
        convMap.set(key, {
          phone: m.phone,
          pushName: m.pushName || m.leadName || '',
          leadEmail: m.leadEmail || '',
          leadName: m.leadName || '',
          companyName: m.companyName || '',
          lastMessage: m.text,
          lastDirection: m.direction,
          lastTimestamp: m.timestamp,
          unreadCount: 0,
          messages: []
        });
      }
      const conv = convMap.get(key);
      if (m.pushName && !conv.pushName) conv.pushName = m.pushName;
      if (m.leadEmail && !conv.leadEmail) conv.leadEmail = m.leadEmail;
      if (m.leadName && !conv.leadName) conv.leadName = m.leadName;
      if (m.companyName && !conv.companyName) conv.companyName = m.companyName;
      if (new Date(m.timestamp) >= new Date(conv.lastTimestamp)) {
        conv.lastMessage = m.text;
        conv.lastDirection = m.direction;
        conv.lastTimestamp = m.timestamp;
      }
      if (m.direction === 'inbound' && !m.read) {
        conv.unreadCount += 1;
      }
      conv.messages.push(m);
    }

    const conversations = Array.from(convMap.values()).sort(
      (a, b) => new Date(b.lastTimestamp) - new Date(a.lastTimestamp)
    );

    return sendJson(200, {
      ok: true,
      status: waStatus,
      connectedPhone: waConnectedPhone,
      conversations,
      messages: list.slice(-300)
    });
  }

  if (pathname === '/whatsapp/mark-read' && req.method === 'POST') {
    try {
      const body = await readBodyJson(req);
      const cleanPhone = normalizeChileanPhone(body.phone || '');
      if (cleanPhone) {
        const suffix = cleanPhone.slice(-8);
        messagesStore.forEach(m => {
          if (m.phone.endsWith(suffix) && m.direction === 'inbound') {
            m.read = true;
          }
        });
        saveMessagesStore();
      }
      return sendJson(200, { ok: true });
    } catch (err) {
      return sendJson(500, { ok: false, error: err.message });
    }
  }

  if (pathname === '/whatsapp/send' && req.method === 'POST') {
    try {
      const body = await readBodyJson(req);
      const saved = await sendWhatsAppTextMessage(body.phone, body.text, {
        leadEmail: body.leadEmail,
        leadName: body.leadName,
        companyName: body.companyName,
        source: body.source || 'wms_direct'
      });
      return sendJson(200, { ok: true, message: saved });
    } catch (err) {
      return sendJson(400, { ok: false, error: err.message });
    }
  }

  if (pathname === '/whatsapp/log-incoming' && req.method === 'POST') {
    try {
      const body = await readBodyJson(req);
      const saved = recordWhatsAppMessage({
        phone: body.phone,
        pushName: body.leadName || body.pushName || '',
        leadEmail: body.leadEmail || '',
        leadName: body.leadName || '',
        companyName: body.companyName || '',
        direction: body.direction || 'inbound',
        text: body.text || '',
        timestamp: body.timestamp || new Date().toISOString(),
        read: false,
        source: body.source || 'manual_capture'
      });
      return sendJson(200, { ok: true, message: saved });
    } catch (err) {
      return sendJson(400, { ok: false, error: err.message });
    }
  }

  if (pathname === '/whatsapp/scheduled' && req.method === 'GET') {
    const sorted = [...scheduledQueue].sort(
      (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
    );
    return sendJson(200, { ok: true, scheduled: sorted });
  }

  if (pathname === '/whatsapp/schedule' && req.method === 'POST') {
    try {
      const body = await readBodyJson(req);
      const cleanPhone = normalizeChileanPhone(body.phone || '');
      if (!cleanPhone || cleanPhone.length < 8) {
        return sendJson(400, { ok: false, error: 'Ingresa un número de teléfono válido (+569...)' });
      }
      if (!body.text || !String(body.text).trim()) {
        return sendJson(400, { ok: false, error: 'El mensaje a programar no puede estar vacío' });
      }
      const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt).toISOString() : new Date(Date.now() + 3600000).toISOString();

      // Evitar duplicados exactos de la misma regla automática para el mismo lead
      if (body.dedupeKey) {
        const alreadyExists = scheduledQueue.some(item => item.dedupeKey === body.dedupeKey && item.status !== 'canceled');
        if (alreadyExists) {
          return sendJson(200, { ok: true, skippedDuplicate: true });
        }
      }

      const item = {
        id: `sched_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        phone: cleanPhone,
        leadEmail: (body.leadEmail || '').trim().toLowerCase(),
        leadName: (body.leadName || '').trim(),
        companyName: (body.companyName || '').trim(),
        text: String(body.text).trim(),
        scheduledAt,
        createdAt: new Date().toISOString(),
        status: 'pending', // 'pending' | 'sent' | 'failed' | 'canceled'
        sourceRule: body.sourceRule || 'manual',
        dedupeKey: body.dedupeKey || ''
      };

      scheduledQueue.push(item);
      saveScheduledQueue();
      return sendJson(200, { ok: true, scheduledItem: item });
    } catch (err) {
      return sendJson(500, { ok: false, error: err.message });
    }
  }

  if (pathname === '/whatsapp/cancel-scheduled' && req.method === 'POST') {
    try {
      const body = await readBodyJson(req);
      const id = body.id;
      const idx = scheduledQueue.findIndex(s => s.id === id);
      if (idx >= 0) {
        if (body.deletePermanently) {
          scheduledQueue.splice(idx, 1);
        } else {
          scheduledQueue[idx].status = 'canceled';
        }
        saveScheduledQueue();
      }
      return sendJson(200, { ok: true });
    } catch (err) {
      return sendJson(500, { ok: false, error: err.message });
    }
  }

  if (pathname === '/whatsapp/send-scheduled-now' && req.method === 'POST') {
    try {
      const body = await readBodyJson(req);
      const item = scheduledQueue.find(s => s.id === body.id);
      if (!item) {
        return sendJson(404, { ok: false, error: 'Mensaje programado no encontrado' });
      }
      const sentMsg = await sendWhatsAppTextMessage(item.phone, item.text, {
        leadEmail: item.leadEmail,
        leadName: item.leadName,
        companyName: item.companyName,
        source: 'scheduled_manual_trigger'
      });
      item.status = 'sent';
      item.sentAt = new Date().toISOString();
      item.error = '';
      saveScheduledQueue();
      return sendJson(200, { ok: true, message: sentMsg, scheduledItem: item });
    } catch (err) {
      return sendJson(400, { ok: false, error: err.message });
    }
  }

  if (pathname === '/whatsapp/automations' && req.method === 'GET') {
    return sendJson(200, { ok: true, automations: automationsConfig });
  }

  if (pathname === '/whatsapp/automations' && req.method === 'POST') {
    try {
      const body = await readBodyJson(req);
      automationsConfig = {
        ...automationsConfig,
        ...body,
        auto_welcome_quote: { ...automationsConfig.auto_welcome_quote, ...(body.auto_welcome_quote || {}) },
        auto_meeting_reminder: { ...automationsConfig.auto_meeting_reminder, ...(body.auto_meeting_reminder || {}) },
        auto_followup_48h: { ...automationsConfig.auto_followup_48h, ...(body.auto_followup_48h || {}) },
        auto_update_lead_status: { ...automationsConfig.auto_update_lead_status, ...(body.auto_update_lead_status || {}) }
      };
      saveAutomationsConfig();
      return sendJson(200, { ok: true, automations: automationsConfig });
    } catch (err) {
      return sendJson(500, { ok: false, error: err.message });
    }
  }

  // --------------------------------------------------------------------------
  // ENDPOINTS EXISTENTES DE HUBSPOT Y GOOGLE MEET GEMINI NOTES
  // --------------------------------------------------------------------------
  if (pathname.startsWith('/find-gemini-notes') && req.method === 'POST') {
    try {
      const body = await readBodyJson(req);
      const bridgeUrl = (body.bridgeUrl || '').trim();
      const leadEmail = (body.leadEmail || '').trim().toLowerCase();
      const leadName = (body.leadName || '').trim();
      const companyName = (body.companyName || '').trim();
      const meetingDate = (body.meetingDate || '').trim();

      if (!bridgeUrl) {
        return sendJson(400, { error: 'Falta bridgeUrl' });
      }

      const sep = bridgeUrl.includes('?') ? '&' : '?';
      const targetUrl = `${bridgeUrl}${sep}leadEmail=${encodeURIComponent(leadEmail)}&leadName=${encodeURIComponent(leadName)}&companyName=${encodeURIComponent(companyName)}&meetingDate=${encodeURIComponent(meetingDate)}&_t=${Date.now()}`;
      const gRes = await fetch(targetUrl, { redirect: 'follow' });
      const rawText = await gRes.text();

      let data = {};
      try {
        data = JSON.parse(rawText);
      } catch (parseErr) {
        return sendJson(200, {
          error: 'La respuesta del Google Apps Script no es JSON válido (verifica permisos de "Cualquier persona").',
          rawPreview: rawText.slice(0, 300)
        });
      }

      return sendJson(200, data);
    } catch (err) {
      return sendJson(500, { error: err.message });
    }
  }

  if (pathname.startsWith('/sync-hubspot') && req.method === 'POST') {
    try {
      const body = await readBodyJson(req);
      const hubspotToken = (body.hubspotToken || '').trim();
      const googleMeetBridgeUrl = (body.googleMeetBridgeUrl || '').trim();
      const byEmailMap = new Map();

      if (hubspotToken) {
        const searchUrl = 'https://api.hubapi.com/crm/v3/objects/meetings/search';
        const searchResp = await fetch(searchUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hubspotToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            limit: 50,
            properties: [
              'hs_meeting_title',
              'hs_meeting_body',
              'hs_internal_meeting_notes',
              'hs_meeting_start_time',
              'hs_meeting_end_time',
              'hs_meeting_outcome',
              'hs_meeting_external_url',
              'hs_createdate'
            ],
            sorts: [{ propertyName: 'hs_createdate', direction: 'DESCENDING' }]
          })
        });

        if (!searchResp.ok) {
          const errTxt = await searchResp.text();
          return sendJson(400, {
            error: `HubSpot API (${searchResp.status}): Verifica que tu Private App Token tenga el permiso crm.objects.contacts.read. Detalle: ${errTxt.slice(0, 220)}`
          });
        }

        const searchData = await searchResp.json();
        const rawMeetings = Array.isArray(searchData.results) ? searchData.results : [];

        for (const m of rawMeetings.slice(0, 35)) {
          const props = m.properties || {};
          const meetingId = String(m.id || '');
          let contactEmail = '';
          let contactName = '';
          let companyName = '';

          try {
            const assocUrl = `https://api.hubapi.com/crm/v3/objects/meetings/${meetingId}/associations/contacts`;
            const assocResp = await fetch(assocUrl, {
              headers: { 'Authorization': `Bearer ${hubspotToken}` }
            });
            if (assocResp.ok) {
              const assocData = await assocResp.json();
              const firstContactId = assocData?.results?.[0]?.id;
              if (firstContactId) {
                const contactUrl = `https://api.hubapi.com/crm/v3/objects/contacts/${firstContactId}?properties=email,firstname,lastname,company,phone`;
                const contactResp = await fetch(contactUrl, {
                  headers: { 'Authorization': `Bearer ${hubspotToken}` }
                });
                if (contactResp.ok) {
                  const contactData = await contactResp.json();
                  const cProps = contactData.properties || {};
                  contactEmail = (cProps.email || '').trim().toLowerCase();
                  contactName = [cProps.firstname, cProps.lastname].filter(Boolean).join(' ').trim();
                  companyName = (cProps.company || '').trim();
                }
              }
            }
          } catch (e) {}

          const rawFullText = stripHtml(props.hs_internal_meeting_notes || props.hs_meeting_body || '');
          if (!contactEmail && rawFullText) {
            const emailMatch = rawFullText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            if (emailMatch) contactEmail = emailMatch[0].toLowerCase();
          }
          if (!contactEmail) continue;

          const cleanedNotes = cleanMeetingNotes(props.hs_internal_meeting_notes || props.hs_meeting_body || '');
          const outcome = (props.hs_meeting_outcome || '').toUpperCase();
          const startTime = props.hs_meeting_start_time ? new Date(props.hs_meeting_start_time) : new Date();
          const isPast = startTime.getTime() < Date.now();
          let status = 'scheduled';
          if (outcome === 'COMPLETED' || (isPast && outcome !== 'CANCELED' && outcome !== 'NO_SHOW')) status = 'completed';
          else if (outcome === 'CANCELED') status = 'canceled';
          else if (outcome === 'NO_SHOW') status = 'no_show';
          else if (outcome === 'RESCHEDULED') status = 'rescheduled';

          const meetUrlMatch = (props.hs_meeting_external_url || rawFullText).match(/https:\/\/meet\.google\.com\/[a-z0-9-]+/i);

          if (!byEmailMap.has(contactEmail)) {
            byEmailMap.set(contactEmail, {
              hubspot_meeting_id: meetingId,
              lead_email: contactEmail,
              lead_name: contactName,
              company_name: companyName,
              meeting_title: props.hs_meeting_title || 'Reunión Comercial Stocka',
              meeting_status: status,
              meeting_start_at: startTime.toISOString(),
              meeting_end_at: props.hs_meeting_end_time ? new Date(props.hs_meeting_end_time).toISOString() : null,
              meet_url: meetUrlMatch ? meetUrlMatch[0] : (props.hs_meeting_external_url || ''),
              gemini_notes_raw: cleanedNotes,
              gemini_doc_url: '',
              source: 'hubspot_sync'
            });
          }
        }
      }

      if (googleMeetBridgeUrl) {
        try {
          const sep = googleMeetBridgeUrl.includes('?') ? '&' : '?';
          const bResp = await fetch(`${googleMeetBridgeUrl}${sep}_t=${Date.now()}`, { redirect: 'follow' });
          const rawBridgeText = await bResp.text();
          if (bResp.ok) {
            const bData = JSON.parse(rawBridgeText);
            if (Array.isArray(bData?.meetings)) {
              for (const gm of bData.meetings) {
                const email = (gm.lead_email || '').trim().toLowerCase();
                if (!email) continue;
                const cleanedGmNotes = cleanMeetingNotes(gm.gemini_notes_raw || gm.gemini_summary || '');
                const existing = byEmailMap.get(email);
                if (existing) {
                  if (cleanedGmNotes && (!existing.gemini_notes_raw || cleanedGmNotes.length > existing.gemini_notes_raw.length)) {
                    existing.gemini_notes_raw = cleanedGmNotes;
                  }
                  if (gm.gemini_doc_url) existing.gemini_doc_url = gm.gemini_doc_url;
                  if (gm.meet_url && !existing.meet_url) existing.meet_url = gm.meet_url;
                  existing.source = 'hubspot_and_google_meet';
                } else {
                  byEmailMap.set(email, {
                    ...gm,
                    lead_email: email,
                    gemini_notes_raw: cleanedGmNotes,
                    source: gm.source || 'google_calendar_gemini'
                  });
                }
              }
            }
          }
        } catch (e) {
          console.warn('Error consultando googleMeetBridgeUrl:', e.message);
        }
      }

      const syncedMeetings = Array.from(byEmailMap.values());
      return sendJson(200, { ok: true, count: syncedMeetings.length, meetings: syncedMeetings });
    } catch (err) {
      return sendJson(500, { error: err.message || 'Error interno en bridge local HubSpot' });
    }
  }

  return sendJson(200, {
    status: 'ok',
    service: 'stocka-leads-unified-bridge',
    whatsappStatus: waStatus,
    connectedPhone: waConnectedPhone
  });
});

server.listen(PORT, () => {
  console.log(`Stocka Leads Bridge (HubSpot + Google Meet + WhatsApp Multi-Device) running on http://localhost:${PORT}`);
});
