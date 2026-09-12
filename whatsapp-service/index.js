const express = require('express');
const cors = require('cors');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const pino = require('pino');

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeInMemoryStore
} = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

let sock = null;
let currentQR = null;
let connectionStatus = 'INITIALIZING'; // 'QR_READY', 'CONNECTED', 'CONNECTING', 'DISCONNECTED'
let botUser = null;

const AUTH_DIR = process.env.AUTH_DIR || path.join(__dirname, 'auth_info_baileys');
if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

function getAutoPickupService() {
  const localPath = path.join(__dirname, 'services/auto_pickup_service.js');
  if (fs.existsSync(localPath)) return require(localPath);
  return require('../services/auto_pickup_service');
}

function getManualOrdersNotifier() {
  const localPath = path.join(__dirname, 'services/manual_orders_notifier.js');
  if (fs.existsSync(localPath)) return require(localPath);
  return require('../services/manual_orders_notifier');
}

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`[WhatsApp] Usando Baileys v${version.join('.')} (Latest: ${isLatest})`);

  sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }), // Silenciar logs internos excesivos
    printQRInTerminal: false,
    auth: state,
    generateHighQualityLinkPreview: true,
    browser: ['Stocka WMS Bot', 'Chrome', '1.0.0']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = qr;
      connectionStatus = 'QR_READY';
      console.log('\n======================================================');
      console.log('📌 NUEVO CÓDIGO QR GENERADO:');
      console.log('👉 Puedes escanearlo aquí abajo o abrir en tu navegador:');
      console.log(`🌐 http://localhost:${PORT}/qr`);
      console.log('======================================================\n');
      qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      connectionStatus = 'DISCONNECTED';
      botUser = null;
      console.log(`[WhatsApp] Conexión cerrada. Razón: ${lastDisconnect?.error?.message}. Reconectando: ${shouldReconnect}`);
      if (shouldReconnect) {
        setTimeout(connectToWhatsApp, 3000);
      } else {
        console.log('[WhatsApp] Sesión cerrada permanentemente. Borra la carpeta auth_info_baileys para nuevo QR.');
      }
    } else if (connection === 'open') {
      connectionStatus = 'CONNECTED';
      currentQR = null;
      botUser = sock.user;
      console.log('\n======================================================');
      console.log('✅ ¡WHATSAPP CONECTADO CON ÉXITO A STOCKA WMS!');
      console.log(`📱 Número conectado: ${sock.user?.id ? sock.user.id.split(':')[0] : 'Desconocido'}`);
      console.log(`🏷️ Nombre: ${sock.user?.name || 'Bot Stocka'}`);
      console.log('======================================================\n');
    }
  });

  // Escuchar mensajes entrantes (para comandos o interacción futura)
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      const from = msg.key.remoteJid;
      const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
      console.log(`[Mensaje Recibido de ${from}]: ${text}`);

      // Comando simple de prueba
      if (text.trim().toLowerCase() === '!ping') {
        await sock.sendMessage(from, { text: '🏓 ¡Pong! Bot de Stocka WMS activo y funcionando correctamente 🚀' });
      }
    }
  });
}

// Formatear destino (número chileno/internacional o ID de grupo)
function formatJid(target) {
  if (!target) return null;
  let cleaned = String(target).trim();

  // Si ya es un JID completo (grupo o usuario)
  if (cleaned.endsWith('@s.whatsapp.net') || cleaned.endsWith('@g.us')) {
    return cleaned;
  }

  // Limpiar caracteres no numéricos
  cleaned = cleaned.replace(/\D/g, '');

  // Formato número chileno típico si viene como 9XXXXXXXX (agregar 56)
  if (cleaned.length === 9 && cleaned.startsWith('9')) {
    cleaned = '56' + cleaned;
  }

  return `${cleaned}@s.whatsapp.net`;
}

const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY || 'stocka_wa_internal_secret_2026';

// Middleware de autenticación por API Key
function requireAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'] || 
                 (req.headers.authorization ? req.headers.authorization.replace(/^Bearer\s+/i, '') : null) || 
                 req.query.key;

  if (!apiKey || apiKey !== WHATSAPP_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Se requiere x-api-key válida para interactuar con WhatsApp.' });
  }
  next();
}

// ---------------- ENDPOINTS API REST ----------------

// 1. Estado de conexión
app.get('/status', requireAuth, (req, res) => {
  res.json({
    status: connectionStatus,
    user: botUser,
    hasQR: !!currentQR,
    qrUrl: currentQR ? `http://localhost:${PORT}/qr?key=${encodeURIComponent(WHATSAPP_API_KEY)}` : null
  });
});

// 2. Visualizador amigable de código QR en navegador
app.get('/qr', requireAuth, async (req, res) => {
  if (connectionStatus === 'CONNECTED') {
    return res.send(`
      <html>
        <head><title>Stocka WMS WhatsApp</title><meta charset="utf-8"></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f0fdf4;">
          <h1 style="color: #15803d;">✅ WhatsApp Conectado</h1>
          <p style="font-size: 1.2rem; color: #166534;">El bot de Stocka WMS ya está vinculado y listo para enviar notificaciones.</p>
          <p><strong>Número:</strong> ${botUser?.id ? botUser.id.split(':')[0] : ''}</p>
        </body>
      </html>
    `);
  }

  if (!currentQR) {
    return res.send(`
      <html>
        <head><title>Stocka WMS WhatsApp</title><meta charset="utf-8"><meta http-equiv="refresh" content="3"></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2>⏳ Generando código QR...</h2>
          <p>La página se recargará automáticamente.</p>
        </body>
      </html>
    `);
  }

  try {
    const qrDataUrl = await QRCode.toDataURL(currentQR, { width: 350 });
    res.send(`
      <html>
        <head>
          <title>Vincular WhatsApp - Stocka WMS</title>
          <meta charset="utf-8">
          <meta http-equiv="refresh" content="20">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 90vh; background: #f8fafc; margin: 0; }
            .card { background: white; padding: 30px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.08); text-align: center; max-width: 420px; width: 90%; }
            h2 { color: #0f172a; margin-top: 0; }
            p { color: #64748b; font-size: 0.95rem; line-height: 1.5; }
            .qr-container { padding: 15px; background: white; border: 2px dashed #cbd5e1; border-radius: 12px; display: inline-block; margin: 15px 0; }
            .badge { background: #e0e7ff; color: #4338ca; padding: 6px 12px; border-radius: 999px; font-weight: 600; font-size: 0.8rem; }
          </style>
        </head>
        <body>
          <div class="card">
            <span class="badge">STOCKA WMS BOT</span>
            <h2>Vincular WhatsApp</h2>
            <p>1. Abre WhatsApp en tu celular<br>2. Ve a <strong>Dispositivos vinculados</strong> &gt; <strong>Vincular un dispositivo</strong><br>3. Escanea este código:</p>
            <div class="qr-container">
              <img src="${qrDataUrl}" alt="QR WhatsApp" />
            </div>
            <p style="font-size: 0.8rem; color: #94a3b8;">El código expira en unos segundos y se actualiza automáticamente.</p>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send('Error generando QR: ' + err.message);
  }
});

// 3. Obtener listado de grupos en los que está el bot
app.get('/groups', requireAuth, async (req, res) => {
  if (connectionStatus !== 'CONNECTED' || !sock) {
    return res.status(503).json({ error: 'WhatsApp no está conectado todavía' });
  }

  try {
    const groups = await sock.groupFetchAllParticipating();
    const groupList = Object.values(groups).map(g => ({
      id: g.id,
      subject: g.subject,
      creation: g.creation,
      participantsCount: g.participants?.length || 0
    }));
    res.json({ success: true, count: groupList.length, groups: groupList });
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo grupos: ' + err.message });
  }
});

// 4. Enviar Mensaje de Texto Simple
app.post('/send-message', requireAuth, async (req, res) => {
  const { to, message, withPrefix = true } = req.body;

  if (!to || !message) {
    return res.status(400).json({ error: 'Se requieren los campos "to" y "message"' });
  }

  if (connectionStatus !== 'CONNECTED' || !sock) {
    return res.status(503).json({ error: 'WhatsApp no está conectado' });
  }

  try {
    const jid = formatJid(to);
    const finalMessage = (withPrefix === false || message.startsWith('🤖'))
      ? message
      : `🤖 *Stox:*\n${message}`;

    const result = await sock.sendMessage(jid, { text: finalMessage });
    res.json({ success: true, jid, messageId: result?.key?.id, sentMessage: finalMessage });
  } catch (err) {
    console.error('[Error enviando mensaje]:', err);
    res.status(500).json({ error: 'Fallo al enviar mensaje: ' + err.message });
  }
});

// 4.1 Enviar Archivo / Documento (PDF, etc.)
app.post('/send-document', requireAuth, async (req, res) => {
  const { to, fileBase64, fileName, caption, mimetype = 'application/pdf' } = req.body;

  if (!to || !fileBase64 || !fileName) {
    return res.status(400).json({ error: 'Se requieren los campos "to", "fileBase64" y "fileName"' });
  }

  if (connectionStatus !== 'CONNECTED' || !sock) {
    return res.status(503).json({ error: 'WhatsApp no está conectado' });
  }

  try {
    const jid = formatJid(to);
    const fileBuffer = Buffer.from(fileBase64, 'base64');
    const finalCaption = caption ? (caption.startsWith('🤖') ? caption : `🤖 *Stox:*\n${caption}`) : undefined;

    const result = await sock.sendMessage(jid, {
      document: fileBuffer,
      mimetype,
      fileName,
      caption: finalCaption
    });

    res.json({
      success: true,
      jid,
      messageId: result?.key?.id,
      fileName
    });
  } catch (err) {
    console.error('[Error enviando documento]:', err);
    res.status(500).json({ error: 'Fallo al enviar documento: ' + err.message });
  }
});

// 5. Enviar Alerta Estructurada de Pedido con Retiro en Bodega
app.post('/send-pickup-alert', requireAuth, async (req, res) => {
  const {
    to, // Puede ser JID de grupo o número de teléfono
    orderNumber,
    platform = 'Stocka WMS',
    customerName,
    customerPhone,
    items = [],
    pickupLocation = 'Bodega Principal Stocka',
    notes
  } = req.body;

  if (!to || !orderNumber) {
    return res.status(400).json({ error: 'Se requieren al menos los campos "to" y "orderNumber"' });
  }

  if (connectionStatus !== 'CONNECTED' || !sock) {
    return res.status(503).json({ error: 'WhatsApp no está conectado' });
  }

  try {
    const jid = formatJid(to);

    // Formatear lista de ítems
    let itemsText = 'No especificados';
    if (Array.isArray(items) && items.length > 0) {
      itemsText = items.map(item => {
        const qty = item.quantity || item.qty || 1;
        const name = item.name || item.title || item.sku || 'Producto';
        const sku = item.sku ? ` (SKU: ${item.sku})` : '';
        return `• ${qty}x ${name}${sku}`;
      }).join('\n');
    }

    const message = [
      `🤖 *Stox | NOTIFICACIÓN WMS*`,
      `🔔 *NUEVO PEDIDO - RETIRO EN BODEGA*`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `📦 *Orden:* #${orderNumber} (${platform})`,
      `👤 *Cliente:* ${customerName || 'No informado'}`,
      customerPhone ? `📞 *Teléfono:* ${customerPhone}` : null,
      `📍 *Punto de Retiro:* ${pickupLocation}`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `📋 *PRODUCTOS A PREPARAR:*`,
      itemsText,
      notes ? `━━━━━━━━━━━━━━━━━━━━\n📝 *Notas:* ${notes}` : null,
      `━━━━━━━━━━━━━━━━━━━━`,
      `🕒 _${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })}_`
    ].filter(Boolean).join('\n');

    const result = await sock.sendMessage(jid, { text: message });
    res.json({ success: true, jid, messageId: result?.key?.id, formattedMessage: message });
  } catch (err) {
    console.error('[Error enviando alerta de retiro]:', err);
    res.status(500).json({ error: 'Fallo al enviar alerta: ' + err.message });
  }
});

// 6. Endpoint para disparar el procesamiento automático de retiros
app.post('/run-auto-pickup', requireAuth, async (req, res) => {
  const { orderId, dryRun = false, targetGroup } = req.body;
  const { autoProcessSinglePickupOrder, processAllPendingPickups } = getAutoPickupService();

  try {
    if (orderId) {
      const result = await autoProcessSinglePickupOrder(orderId, { dryRun, targetGroup });
      return res.json(result);
    } else {
      const result = await processAllPendingPickups({ dryRun, targetGroup });
      return res.json(result);
    }
  } catch (err) {
    console.error('[Error en run-auto-pickup]:', err);
    res.status(500).json({ error: 'Error procesando retiros: ' + err.message });
  }
});

// 7. Endpoint para consultar estado de pedidos manuales pendientes y alerta del día
app.get('/manual-orders-status', requireAuth, async (req, res) => {
  try {
    const { getManualOrdersAlertStatus } = getManualOrdersNotifier();
    const status = await getManualOrdersAlertStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    console.error('[Error en GET /manual-orders-status]:', err);
    res.status(500).json({ error: 'Error obteniendo estado de pedidos manuales: ' + err.message });
  }
});

// 8. Endpoint para disparar notificación de pedidos manuales (manual o forzada)
app.post('/notify-manual-orders', requireAuth, async (req, res) => {
  const { force = false, dryRun = false, targetGroup } = req.body;
  try {
    const { checkAndNotifyPendingManualOrders } = getManualOrdersNotifier();
    const result = await checkAndNotifyPendingManualOrders({ force, dryRun, targetGroup });
    res.json(result);
  } catch (err) {
    console.error('[Error en POST /notify-manual-orders]:', err);
    res.status(500).json({ error: 'Error ejecutando alerta de pedidos manuales: ' + err.message });
  }
});

// Días feriados de Fiestas Patrias (17, 18 y 19 de Septiembre)
const HOLIDAYS_CHILE = ['2026-09-17', '2026-09-18', '2026-09-19'];

function isNonWorkingDayInChile(date = new Date()) {
  const dayOfWeek = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago',
    weekday: 'short'
  }).format(date);

  if (dayOfWeek === 'Sun') {
    return { isNonWorking: true, reason: 'Hoy es Domingo' };
  }

  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago'
  }).format(date);

  if (HOLIDAYS_CHILE.includes(dateStr)) {
    return { isNonWorking: true, reason: `Feriado Fiestas Patrias (${dateStr})` };
  }

  return { isNonWorking: false };
}

// Control persistente para saludo de Fiestas Patrias (18 de Septiembre 12:00 hrs)
function getGreetingsStateFilePath() {
  if (process.env.AUTH_DIR) {
    const parent = path.dirname(process.env.AUTH_DIR);
    if (fs.existsSync(parent)) {
      return path.join(parent, 'holiday_greetings_state.json');
    }
  }
  return path.join(__dirname, '../holiday_greetings_state.json');
}

function loadGreetingsState() {
  const file = getGreetingsStateFilePath();
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (err) {
    console.error('[Greetings] Error leyendo estado:', err.message);
  }
  return {};
}

function saveGreetingsState(state) {
  const file = getGreetingsStateFilePath();
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('[Greetings] Error guardando estado:', err.message);
  }
}

function getFiestasPatriasGreetingText() {
  return [
    `🤖 *Stox:*`,
    `🇨🇱 *¡TIKI TIKI TI! ¡FELICES FIESTAS PATRIAS A TODO EL EQUIPO STOCKA!* 🇨🇱`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🍷🥟 Hoy 18 de septiembre hago una pausa en mis circuitos y servidores para desearles a todos un merecido descanso y una tremenda celebración en familia.`,
    ``,
    `🥩 Que no falte el buen asado, las empanadas bien jugosas, el terremoto y una buena cueca zapateada.`,
    ``,
    `Recarguen al máximo las energías, disfruten con los suyos y celebren con orgullo este 18. ¡A la vuelta seguimos dándolo todo en el picking y despacho!`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🎉 *¡VIVA CHILE Y VIVA EL EQUIPO STOCKA!* 🇨🇱🤖✨`,
    `🕒 18-09-2026 12:00 hrs`
  ].join('\n');
}

async function checkAndSendFiestasPatriasGreeting() {
  if (connectionStatus !== 'CONNECTED' || !sock) return;

  const now = new Date();
  const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(now);
  const hourStr = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', hour: '2-digit', hourCycle: 'h23' }).format(now);
  const currentHour = parseInt(hourStr, 10);

  // Verificar si es 18 de Septiembre y son las 12:00 hrs o más
  if (dateStr === '2026-09-18' && currentHour >= 12) {
    const state = loadGreetingsState();
    if (!state.fiestasPatrias2026Sent) {
      console.log('🇨🇱 [Stox] ¡Llegó el 18 de Septiembre a las 12:00 hrs! Enviando saludo de Fiestas Patrias...');
      const targetGroup = process.env.TARGET_WA_GROUP || '120363043911687615@g.us'; // Coordinación Stocka
      const jid = formatJid(targetGroup);
      const greetingMessage = getFiestasPatriasGreetingText();

      try {
        await sock.sendMessage(jid, { text: greetingMessage });
        state.fiestasPatrias2026Sent = true;
        state.sentAt = new Date().toISOString();
        saveGreetingsState(state);
        console.log('✅ [Stox] Saludo de Fiestas Patrias enviado con éxito al grupo de Coordinación.');
      } catch (err) {
        console.error('❌ [Stox] Error enviando saludo de Fiestas Patrias:', err.message);
      }
    }
  }
}

// 9. Endpoint para previsualizar o probar el saludo de Fiestas Patrias
app.post('/test-fiestas-patrias-greeting', requireAuth, async (req, res) => {
  const { send = false, targetGroup } = req.body;
  const message = getFiestasPatriasGreetingText();

  if (!send) {
    return res.json({
      preview: true,
      message,
      targetGroup: targetGroup || process.env.TARGET_WA_GROUP || '120363043911687615@g.us',
      scheduledFor: '2026-09-18 12:00:00 (America/Santiago)'
    });
  }

  if (connectionStatus !== 'CONNECTED' || !sock) {
    return res.status(503).json({ error: 'WhatsApp no está conectado' });
  }

  try {
    const dest = targetGroup || process.env.TARGET_WA_GROUP || '120363043911687615@g.us';
    const jid = formatJid(dest);
    const result = await sock.sendMessage(jid, { text: message });
    res.json({ success: true, jid, messageId: result?.key?.id, sentMessage: message });
  } catch (err) {
    res.status(500).json({ error: 'Fallo al enviar saludo: ' + err.message });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`[HTTP] Servidor WhatsApp iniciado en http://localhost:${PORT}`);
  connectToWhatsApp();

  // Iniciar worker de fondo cada 60 segundos
  let syncCycleCounter = 0;
  setInterval(async () => {
    if (connectionStatus === 'CONNECTED') {
      syncCycleCounter++;

      // A. Saludo especial programado de Fiestas Patrias (18 de Septiembre a las 12:00 hrs)
      try {
        await checkAndSendFiestasPatriasGreeting();
      } catch (err) {
        console.error('[Greeting Worker Error]:', err.message);
      }

      // Los días Domingo y Feriados de Fiestas Patrias (17, 18, 19 Septiembre) no se envían alertas operativas
      const nonWorking = isNonWorkingDayInChile();

      if (!nonWorking.isNonWorking) {
        // B. Procesar retiros automáticos
        try {
          const { processAllPendingPickups } = getAutoPickupService();
          await processAllPendingPickups({ dryRun: false });
        } catch (err) {
          console.error('[AutoPickup Worker Error]:', err.message);
        }

        // C. Chequear pedidos manuales pendientes después de 12 hrs (1 mensaje al día)
        try {
          const { checkAndNotifyPendingManualOrders } = getManualOrdersNotifier();
          await checkAndNotifyPendingManualOrders({ force: false, dryRun: false });
        } catch (err) {
          console.error('[ManualOrders Worker Error]:', err.message);
        }
      }

      // D. Sincronización y auto-recuperación (Self-Healing) WMS <-> Picker cada 5 minutos
      if (syncCycleCounter % 5 === 0) {
        try {
          const syncPicker = require('../sync_to_picker');
          if (syncPicker && syncPicker.runSyncToPicker) {
            await syncPicker.runSyncToPicker();
          }
        } catch (err) {
          console.error('[SyncToPicker Worker Error]:', err.message);
        }
      }
    }
  }, 60000);
});

