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

const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');

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

// ---------------- ENDPOINTS API REST ----------------

// 1. Estado de conexión
app.get('/status', (req, res) => {
  res.json({
    status: connectionStatus,
    user: botUser,
    hasQR: !!currentQR,
    qrUrl: currentQR ? `http://localhost:${PORT}/qr` : null
  });
});

// 2. Visualizador amigable de código QR en navegador
app.get('/qr', async (req, res) => {
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
app.get('/groups', async (req, res) => {
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
app.post('/send-message', async (req, res) => {
  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({ error: 'Se requieren los campos "to" y "message"' });
  }

  if (connectionStatus !== 'CONNECTED' || !sock) {
    return res.status(503).json({ error: 'WhatsApp no está conectado' });
  }

  try {
    const jid = formatJid(to);
    const result = await sock.sendMessage(jid, { text: message });
    res.json({ success: true, jid, messageId: result?.key?.id });
  } catch (err) {
    console.error('[Error enviando mensaje]:', err);
    res.status(500).json({ error: 'Fallo al enviar mensaje: ' + err.message });
  }
});

// 5. Enviar Alerta Estructurada de Pedido con Retiro en Bodega
app.post('/send-pickup-alert', async (req, res) => {
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

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`[HTTP] Servidor WhatsApp iniciado en http://localhost:${PORT}`);
  connectToWhatsApp();
});
