/**
 * Servicio de Envío y Reenvío Automático de Respuestas por WhatsApp (Stox)
 * para la Torre de Control de Stocka WMS.
 *
 * Funcionalidades:
 * 1. Registra cada mensaje enviado desde la Torre de Control vía Stox junto con su contexto
 *    (Contacto, Teléfono, Pedido, Comercio, Dirección, Mensaje enviado, Usuario emisor y Grupo destino).
 * 2. Escucha los mensajes entrantes en Baileys y detecta si provienen de un contacto al que
 *    se le escribió desde Stox.
 * 3. Acumula las respuestas entrantes en una ventana de 30 minutos (para evitar spam cuando
 *    el cliente escribe palabra por palabra) y envía un único resumen consolidado al grupo
 *    de WhatsApp configurado (por defecto NOTIFICACIONES STOX).
 * 4. Registra la trazabilidad en archivo persistente (sobrevive reinicios en Render) y en
 *    order_audit_logs de Supabase cuando hay un pedido asociado.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Cargar variables de entorno
const envPath = path.join(__dirname, '../../.env');
const localEnvPath = path.join(__dirname, '../.env');
let env = {};

function readEnv(p) {
  if (fs.existsSync(p)) {
    const content = fs.readFileSync(p, 'utf8');
    content.split('\n').forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        let value = match[2] || '';
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.substring(1, value.length - 1);
        }
        env[match[1]] = value.trim();
      }
    });
  }
}
readEnv(envPath);
readEnv(localEnvPath);

const SUPABASE_URL = process.env.SUPABASE_URL || env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzMTE4NSwiZXhwIjoyMDk1NDA3MTg1fQ.YX4okf4XNkkVQaU0XbbRtm4SNRTqvwEVNd7ubc4PGe8';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const NOTIFICACIONES_STOX_GROUP = '120363413357945543@g.us';

// Ventana de acumulación de respuestas antes de enviar un único mensaje consolidado al grupo (30 minutos por defecto)
const REPLY_BATCH_WINDOW_MINUTES = Number(process.env.STOX_REPLY_BATCH_MINUTES) || 30;
const inMemoryFlushTimers = new Map();

/**
 * Ruta del archivo persistente de seguimiento de contactos Stox
 */
function getStateFilePath() {
  if (process.env.AUTH_DIR) {
    const parent = path.dirname(process.env.AUTH_DIR);
    if (fs.existsSync(parent)) {
      return path.join(parent, 'stox_reply_forwarding_state.json');
    }
  }
  return path.join(__dirname, '../stox_reply_forwarding_state.json');
}

function loadForwardingState() {
  const file = getStateFilePath();
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return {
        contacts: parsed.contacts || {},
        history: Array.isArray(parsed.history) ? parsed.history : []
      };
    }
  } catch (err) {
    console.error('[StoxReplyForwarder] Error leyendo estado:', err.message);
  }
  return { contacts: {}, history: [] };
}

function saveForwardingState(state) {
  const file = getStateFilePath();
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (Array.isArray(state.history) && state.history.length > 200) {
      state.history = state.history.slice(0, 200);
    }
    fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('[StoxReplyForwarder] Error guardando estado:', err.message);
  }
}

/**
 * Normaliza un número de teléfono a formato chileno (569XXXXXXXX) o dígitos limpios
 */
function normalizePhoneDigits(phone) {
  if (!phone) return '';
  const raw = String(phone).split('@')[0].split(':')[0];
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 9 && digits.startsWith('9')) {
    digits = '56' + digits;
  } else if (digits.length === 8) {
    digits = '569' + digits;
  }
  return digits;
}

/**
 * Extrae el texto o descripción de contenido multimedia de un mensaje entrante de Baileys
 */
function extractIncomingMessageContent(msg) {
  if (!msg || !msg.message) return '';

  const m =
    msg.message.ephemeralMessage?.message ||
    msg.message.viewOnceMessage?.message ||
    msg.message.viewOnceMessageV2?.message ||
    msg.message.documentWithCaptionMessage?.message ||
    msg.message;

  if (m.conversation) return m.conversation.trim();
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text.trim();

  if (m.imageMessage) {
    const cap = m.imageMessage.caption ? m.imageMessage.caption.trim() : '';
    return cap ? `📷 [Imagen]: ${cap}` : '📷 [Imagen adjunta enviada por el contacto]';
  }
  if (m.videoMessage) {
    const cap = m.videoMessage.caption ? m.videoMessage.caption.trim() : '';
    return cap ? `🎥 [Video]: ${cap}` : '🎥 [Video adjunto enviado por el contacto]';
  }
  if (m.audioMessage) {
    return m.audioMessage.ptt
      ? '🎤 [Nota de voz enviada por el contacto]'
      : '🎵 [Audio enviado por el contacto]';
  }
  if (m.documentMessage) {
    const fileName = m.documentMessage.fileName || 'documento';
    const cap = m.documentMessage.caption ? ` - ${m.documentMessage.caption.trim()}` : '';
    return `📄 [Documento: ${fileName}]${cap}`;
  }
  if (m.locationMessage || m.liveLocationMessage) {
    const loc = m.locationMessage || m.liveLocationMessage;
    const lat = loc.degreesLatitude;
    const lng = loc.degreesLongitude;
    const name = loc.name || loc.address || '';
    const mapsUrl = (lat && lng) ? `https://maps.google.com/?q=${lat},${lng}` : '';
    return `📍 [Ubicación compartida${name ? `: ${name}` : ''}] ${mapsUrl}`.trim();
  }
  if (m.buttonsResponseMessage?.selectedDisplayText) {
    return m.buttonsResponseMessage.selectedDisplayText.trim();
  }
  if (m.listResponseMessage?.title) {
    return m.listResponseMessage.title.trim();
  }
  if (m.templateButtonReplyMessage?.selectedDisplayText) {
    return m.templateButtonReplyMessage.selectedDisplayText.trim();
  }
  if (m.contactMessage || m.contactsArrayMessage) {
    return '👤 [Tarjeta de contacto compartida]';
  }
  if (m.stickerMessage) {
    return '🏷️ [Sticker]';
  }

  return '';
}

/**
 * Registra un contacto al que se le acaba de enviar un mensaje desde Stox
 * para que sus respuestas sean reenviadas automáticamente al grupo de WhatsApp.
 */
function registerTrackedContact({
  to,
  jid,
  lid = null,
  messageId = null,
  message,
  contactName = '',
  orderId = null,
  orderNumber = '',
  comercio = '',
  shippingAddress = '',
  shippingCity = '',
  targetGroup = NOTIFICACIONES_STOX_GROUP,
  targetGroupName = 'NOTIFICACIONES STOX',
  sentBy = 'Torre de Control WMS',
  ttlHours = 168 // 7 días de escucha activa por defecto
}) {
  const phone = normalizePhoneDigits(to || jid);
  if (!phone || phone.length < 8) return null;

  const state = loadForwardingState();
  const now = new Date();
  const sentAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + (Number(ttlHours) || 168) * 3600 * 1000).toISOString();
  const existing = state.contacts[phone];

  const cleanMsg = String(message || '').replace(/^🤖\s*\*Stox:\*\n?/i, '').trim();

  const record = {
    id: `trk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    phone,
    last8: phone.slice(-8),
    jid: jid || `${phone}@s.whatsapp.net`,
    lid: lid || existing?.lid || null,
    messageId: messageId || existing?.messageId || null,
    contactName: contactName || existing?.contactName || 'Contacto',
    orderId: orderId || existing?.orderId || null,
    orderNumber: orderNumber || existing?.orderNumber || '',
    comercio: comercio || existing?.comercio || '',
    shippingAddress: shippingAddress || existing?.shippingAddress || '',
    shippingCity: shippingCity || existing?.shippingCity || '',
    sentMessage: cleanMsg,
    sentBy: sentBy || 'Torre de Control WMS',
    sentAt,
    expiresAt,
    targetGroup: targetGroup || NOTIFICACIONES_STOX_GROUP,
    targetGroupName: targetGroupName || 'NOTIFICACIONES STOX',
    active: true,
    batchWindowMinutes: REPLY_BATCH_WINDOW_MINUTES,
    pendingReplies: Array.isArray(existing?.pendingReplies) ? existing.pendingReplies : [],
    firstPendingAt: existing?.firstPendingAt || null,
    pendingFlushAt: existing?.pendingFlushAt || null,
    pushName: existing?.pushName || '',
    repliesCount: existing?.repliesCount || 0,
    lastReplyAt: existing?.lastReplyAt || null,
    lastReplyText: existing?.lastReplyText || null,
    replies: Array.isArray(existing?.replies) ? existing.replies.slice(-15) : []
  };

  state.contacts[phone] = record;

  state.history.unshift({
    type: 'OUTBOUND',
    id: record.id,
    phone,
    contactName: record.contactName,
    orderId: record.orderId,
    orderNumber: record.orderNumber,
    comercio: record.comercio,
    message: cleanMsg,
    targetGroup: record.targetGroup,
    targetGroupName: record.targetGroupName,
    sentBy: record.sentBy,
    timestamp: sentAt
  });

  saveForwardingState(state);
  return record;
}

/**
 * Sincroniza los envíos recientes registrados en order_audit_logs de Supabase
 * hacia el estado local de Stox y resuelve sus LIDs en Baileys v7 si está disponible.
 */
async function syncRecentAuditLogsToTrackedState(sock = null) {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { data: logs } = await supabase
      .from('order_audit_logs')
      .select('order_id, user_email, created_at, details')
      .eq('action', 'Mensaje WhatsApp Enviado (Stox)')
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false })
      .limit(50);

    if (!Array.isArray(logs) || logs.length === 0) return 0;

    const state = loadForwardingState();
    let added = 0;

    for (const row of logs) {
      const d = row.details || {};
      const phone = normalizePhoneDigits(d.phone || '');
      if (!phone || phone.length < 8) continue;

      let lid = state.contacts[phone]?.lid || null;
      if (!lid && sock?.signalRepository?.lidMapping?.getLIDForPN) {
        try {
          lid = await sock.signalRepository.lidMapping.getLIDForPN(`${phone}@s.whatsapp.net`);
        } catch (_) {}
      }

      if (!state.contacts[phone]) {
        registerTrackedContact({
          to: phone,
          jid: `${phone}@s.whatsapp.net`,
          lid,
          message: d.sent_message || '',
          contactName: d.contact_name || 'Cliente',
          orderId: row.order_id,
          orderNumber: d.order_number || '',
          comercio: d.comercio || '',
          shippingAddress: d.shipping_address || '',
          shippingCity: d.shipping_city || '',
          targetGroup: d.target_group || NOTIFICACIONES_STOX_GROUP,
          targetGroupName: d.target_group_name || 'NOTIFICACIONES STOX',
          sentBy: d.sent_by || row.user_email || 'Torre de Control WMS'
        });
        added++;
      } else if (lid && !state.contacts[phone].lid) {
        state.contacts[phone].lid = lid;
        saveForwardingState(state);
      }
    }
    return added;
  } catch (err) {
    console.warn('[StoxReplyForwarder] Error sincronizando order_audit_logs:', err.message);
    return 0;
  }
}

/**
 * Busca si un mensaje entrante corresponde a un contacto con seguimiento activo en Stox
 */
function findActiveTrackedContact(fromJid, altJids = [], stanzaId = null) {
  const state = loadForwardingState();
  const nowMs = Date.now();

  const allRawJids = [fromJid, ...(Array.isArray(altJids) ? altJids : [altJids])].filter(Boolean);
  const candidatePhones = allRawJids
    .filter(j => !String(j).endsWith('@lid') && !String(j).endsWith('@hosted.lid'))
    .map(j => normalizePhoneDigits(j))
    .filter(p => p && p.length >= 8);

  for (const cand of candidatePhones) {
    if (state.contacts[cand]) {
      const entry = state.contacts[cand];
      if (entry.active && (!entry.expiresAt || new Date(entry.expiresAt).getTime() > nowMs)) {
        return { entry, state, key: cand };
      }
    }
    const last8 = cand.slice(-8);
    for (const [k, entry] of Object.entries(state.contacts)) {
      if (!entry || !entry.active) continue;
      if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= nowMs) continue;
      if (entry.last8 === last8 || k.endsWith(last8)) {
        return { entry, state, key: k };
      }
    }
  }

  // Búsqueda por JID / LID exacto o por ID de mensaje citado (stanzaId)
  for (const [k, entry] of Object.entries(state.contacts)) {
    if (!entry || !entry.active) continue;
    if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= nowMs) continue;
    if (stanzaId && entry.messageId && entry.messageId === stanzaId) {
      return { entry, state, key: k };
    }
    for (const rawJid of allRawJids) {
      const baseRaw = String(rawJid).split(':')[0];
      const baseEntryLid = entry.lid ? String(entry.lid).split(':')[0] : '';
      if (entry.jid === rawJid || entry.lid === rawJid || (baseEntryLid && baseRaw.startsWith(baseEntryLid))) {
        return { entry, state, key: k };
      }
    }
  }

  return null;
}

/**
 * Procesa un mensaje entrante en Baileys y, si proviene de un contacto contactado
 * desde Stox, lo acumula en una ventana de 30 minutos para enviar un único resumen al grupo.
 */
async function handleIncomingTrackedReply(sock, msg, formatJid, resolveTargetWaGroup) {
  if (!sock || !msg || !msg.message || msg.key?.fromMe) return false;

  const fromJid = msg.key.remoteJid || '';
  if (!fromJid || fromJid.endsWith('@g.us') || fromJid === 'status@broadcast') {
    return false;
  }

  const incomingText = extractIncomingMessageContent(msg);
  if (!incomingText) return false;

  // Ignorar comandos internos del bot
  const lower = incomingText.trim().toLowerCase();
  if (
    lower === '!ping' ||
    lower === '!listo' ||
    lower === '!check' ||
    lower.startsWith('!posponer') ||
    lower.startsWith('!tarea ') ||
    lower.startsWith('!nota ') ||
    lower === '!pendientes' ||
    lower === '!mistareas' ||
    lower === '!mis tareas'
  ) {
    return false;
  }

  // Resolver todos los posibles identificadores de teléfono (incluyendo Baileys v7 remoteJidAlt y lidMapping)
  const altCandidates = [
    msg.key.remoteJidAlt,
    msg.key.participantAlt,
    msg.key.senderPn,
    msg.key.participant
  ].filter(Boolean);

  if (fromJid.endsWith('@lid') || fromJid.endsWith('@hosted.lid')) {
    try {
      const mappedPn = await sock.signalRepository?.lidMapping?.getPNForLID(fromJid);
      if (mappedPn) {
        altCandidates.unshift(mappedPn);
      }
    } catch (_) {}
  }

  const stanzaId =
    msg.message?.extendedTextMessage?.contextInfo?.stanzaId ||
    msg.message?.imageMessage?.contextInfo?.stanzaId ||
    msg.message?.videoMessage?.contextInfo?.stanzaId ||
    msg.message?.audioMessage?.contextInfo?.stanzaId ||
    msg.message?.documentMessage?.contextInfo?.stanzaId ||
    null;

  let matched = findActiveTrackedContact(fromJid, altCandidates, stanzaId);

  // Fallback a Supabase (order_audit_logs) en caso de reinicio o envío previo
  if (!matched) {
    await syncRecentAuditLogsToTrackedState(sock);
    matched = findActiveTrackedContact(fromJid, altCandidates, stanzaId);
  }

  if (!matched) return false;

  const { entry, state, key } = matched;
  const pushName = msg.pushName ? String(msg.pushName).trim() : '';
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const batchMinutes = Number(entry.batchWindowMinutes) || REPLY_BATCH_WINDOW_MINUTES;

  if (!Array.isArray(entry.pendingReplies)) {
    entry.pendingReplies = [];
  }

  // Si es el primer mensaje de esta ráfaga, iniciar ventana de 30 minutos desde este instante
  if (entry.pendingReplies.length === 0 || !entry.pendingFlushAt) {
    entry.firstPendingAt = nowIso;
    entry.pendingFlushAt = new Date(nowMs + batchMinutes * 60 * 1000).toISOString();
  }

  entry.pendingReplies.push({
    text: incomingText,
    pushName,
    receivedAt: nowIso
  });

  if (pushName) {
    entry.pushName = pushName;
  }

  // Actualizar vista previa en vivo del texto consolidado hasta el momento
  const currentCombined = entry.pendingReplies
    .map(r => String(r.text || '').trim())
    .filter(Boolean)
    .join(' ');

  entry.lastReplyAt = nowIso;
  entry.lastReplyText = currentCombined;
  state.contacts[key] = entry;
  saveForwardingState(state);

  const flushTimeStr = new Date(entry.pendingFlushAt).toLocaleTimeString('es-CL', {
    timeZone: 'America/Santiago',
    hour: '2-digit',
    minute: '2-digit'
  });

  console.log(
    `⏳ [StoxReplyForwarder] Mensaje #${entry.pendingReplies.length} acumulado de +${entry.phone} (${entry.contactName || pushName}). Se enviará resumen consolidado a las ${flushTimeStr} hrs (${batchMinutes} min).`
  );

  // Programar temporizador en memoria para disparar al cumplirse la ventana de 30 minutos
  scheduleBatchTimerForContact(key, entry.pendingFlushAt, sock, formatJid, resolveTargetWaGroup);

  return true;
}

/**
 * Programa un timer en memoria para despachar el resumen de un contacto exactamente al cumplirse su ventana
 */
function scheduleBatchTimerForContact(contactKey, pendingFlushAtIso, sock, formatJid, resolveTargetWaGroup) {
  if (!contactKey || !pendingFlushAtIso || inMemoryFlushTimers.has(contactKey)) return;

  const dueMs = new Date(pendingFlushAtIso).getTime() - Date.now();
  const delay = Math.max(1000, dueMs);

  const timer = setTimeout(async () => {
    inMemoryFlushTimers.delete(contactKey);
    try {
      await flushPendingRepliesForContact(contactKey, sock, formatJid, resolveTargetWaGroup, { force: true });
    } catch (err) {
      console.error(`[StoxReplyForwarder] Error en flush programado de ${contactKey}:`, err.message);
    }
  }, delay);

  if (typeof timer.unref === 'function') timer.unref();
  inMemoryFlushTimers.set(contactKey, timer);
}

/**
 * Consolida todos los mensajes pendientes de un contacto en un solo texto y lo envía al grupo de WhatsApp
 */
async function flushPendingRepliesForContact(contactKeyOrPhone, sock, formatJid, resolveTargetWaGroup, { force = false } = {}) {
  if (!sock) return { flushed: false, reason: 'Socket no disponible' };

  const state = loadForwardingState();
  const norm = normalizePhoneDigits(contactKeyOrPhone);
  const last8 = norm ? norm.slice(-8) : '';

  let targetKey = null;
  if (state.contacts[contactKeyOrPhone]) {
    targetKey = contactKeyOrPhone;
  } else if (norm && state.contacts[norm]) {
    targetKey = norm;
  } else if (last8) {
    targetKey = Object.keys(state.contacts).find(k => k.endsWith(last8) || state.contacts[k]?.last8 === last8);
  }

  if (!targetKey || !state.contacts[targetKey]) {
    return { flushed: false, reason: 'Contacto no encontrado' };
  }

  const entry = state.contacts[targetKey];
  const pending = Array.isArray(entry.pendingReplies) ? entry.pendingReplies : [];
  if (pending.length === 0) {
    return { flushed: false, reason: 'Sin mensajes pendientes por consolidar' };
  }

  const nowMs = Date.now();
  const flushAtMs = entry.pendingFlushAt ? new Date(entry.pendingFlushAt).getTime() : 0;
  if (!force && flushAtMs > nowMs) {
    return { flushed: false, reason: 'Aún dentro de la ventana de acumulación de 30 minutos' };
  }

  if (inMemoryFlushTimers.has(targetKey)) {
    clearTimeout(inMemoryFlushTimers.get(targetKey));
    inMemoryFlushTimers.delete(targetKey);
  }

  // Unificar todos los mensajes recibidos en un solo texto fluido
  const summarizedText = pending
    .map(r => String(r.text || '').trim())
    .filter(Boolean)
    .join(' ');

  const pushName = entry.pushName || pending[pending.length - 1]?.pushName || '';
  const contactLabel = entry.contactName && entry.contactName !== 'Contacto'
    ? (pushName && pushName.toLowerCase() !== entry.contactName.toLowerCase()
        ? `${entry.contactName} (~${pushName})`
        : entry.contactName)
    : (pushName || `+${entry.phone}`);

  const locationLine = [entry.shippingAddress, entry.shippingCity].filter(Boolean).join(', ');
  const originalExcerpt = String(entry.sentMessage || '').length > 280
    ? String(entry.sentMessage).slice(0, 280) + '...'
    : String(entry.sentMessage || '');

  const sentAtFormatted = entry.sentAt
    ? new Date(entry.sentAt).toLocaleString('es-CL', { timeZone: 'America/Santiago' })
    : '';

  const firstTimeStr = entry.firstPendingAt
    ? new Date(entry.firstPendingAt).toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit' })
    : '';
  const lastTimeStr = pending[pending.length - 1]?.receivedAt
    ? new Date(pending[pending.length - 1].receivedAt).toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit' })
    : '';
  const nowFormatted = new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' });

  const targetGroupRaw = typeof resolveTargetWaGroup === 'function'
    ? resolveTargetWaGroup(entry.targetGroup)
    : (entry.targetGroup || NOTIFICACIONES_STOX_GROUP);
  const groupJid = typeof formatJid === 'function' ? formatJid(targetGroupRaw) : targetGroupRaw;

  const forwardLines = [
    `🤖 *Stox | RESPUESTA RECIBIDA EN TORRE DE CONTROL*`,
    pending.length > 1
      ? `💬 *RESUMEN DE RESPUESTAS (${pending.length} mensajes consolidados)*`
      : `💬 *NUEVA RESPUESTA DE CONTACTO*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `👤 *Contacto:* ${contactLabel}`,
    `📞 *Teléfono:* +${entry.phone} (https://wa.me/${entry.phone})`,
    entry.orderNumber
      ? `📦 *Pedido:* #${entry.orderNumber}${entry.comercio ? ` (${entry.comercio})` : ''}`
      : (entry.comercio ? `🏪 *Comercio:* ${entry.comercio}` : null),
    locationLine ? `📍 *Destino:* ${locationLine}` : null,
    `━━━━━━━━━━━━━━━━━━━━`,
    `📩 *Respuesta consolidada:*`,
    `${summarizedText}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `📤 *En respuesta al mensaje de Stox:*`,
    `_"${originalExcerpt}"_`,
    `👤 *Enviado por:* ${entry.sentBy || 'Torre de Control'}${sentAtFormatted ? ` (${sentAtFormatted})` : ''}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    pending.length > 1 && firstTimeStr && lastTimeStr
      ? `🕒 _Recibido entre ${firstTimeStr} y ${lastTimeStr} hrs · Enviado al grupo: ${nowFormatted}_`
      : `🕒 _Recibido: ${nowFormatted}_`
  ].filter(Boolean);

  const forwardMessage = forwardLines.join('\n');

  try {
    await sock.sendMessage(groupJid, { text: forwardMessage });
    console.log(
      `✅ [StoxReplyForwarder] Resumen consolidado (${pending.length} msg) de +${entry.phone} (${contactLabel}) enviado al grupo ${groupJid}`
    );

    const nowIso = new Date().toISOString();
    entry.repliesCount = (entry.repliesCount || 0) + 1;
    entry.lastReplyAt = nowIso;
    entry.lastReplyText = summarizedText;
    entry.pendingReplies = [];
    entry.firstPendingAt = null;
    entry.pendingFlushAt = null;

    if (!Array.isArray(entry.replies)) entry.replies = [];
    entry.replies.push({
      text: summarizedText,
      messagesCount: pending.length,
      pushName,
      receivedAt: nowIso,
      forwardedTo: groupJid
    });
    state.contacts[targetKey] = entry;

    state.history.unshift({
      type: 'INBOUND_REPLY',
      id: `rep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      phone: entry.phone,
      contactName: contactLabel,
      orderId: entry.orderId,
      orderNumber: entry.orderNumber,
      comercio: entry.comercio,
      messagesCount: pending.length,
      message: summarizedText,
      originalMessage: entry.sentMessage,
      targetGroup: groupJid,
      targetGroupName: entry.targetGroupName || 'NOTIFICACIONES STOX',
      timestamp: nowIso
    });

    saveForwardingState(state);

    // Registrar el resumen consolidado en el historial de auditoría del pedido en Supabase
    if (entry.orderId) {
      try {
        await supabase.from('order_audit_logs').insert({
          order_id: entry.orderId,
          user_email: 'stox-whatsapp@stocka.cl',
          action: 'Respuesta WhatsApp Recibida (Stox)',
          details: {
            comment: `Respuesta consolidada (${pending.length} msg) de ${contactLabel} (+${entry.phone}) reenviada a ${entry.targetGroupName || 'NOTIFICACIONES STOX'}: "${summarizedText}"`,
            phone: entry.phone,
            messages_count: pending.length,
            reply_text: summarizedText,
            forwarded_group: groupJid
          }
        });
      } catch (auditErr) {
        console.warn('[StoxReplyForwarder] No se pudo insertar en order_audit_logs:', auditErr.message);
      }
    }

    return {
      flushed: true,
      phone: entry.phone,
      contactName: contactLabel,
      messagesCount: pending.length,
      summarizedText
    };
  } catch (err) {
    console.error('[StoxReplyForwarder] Error enviando resumen consolidado al grupo:', err.message);
    return { flushed: false, error: err.message };
  }
}

/**
 * Revisa periódicamente (cada 60s o al reconectar) todos los contactos con mensajes acumulados
 * cuya ventana de 30 minutos ya se cumplió, y envía el texto consolidado al grupo.
 */
async function processPendingReplyBatches(sock, formatJid, resolveTargetWaGroup, { forceAll = false } = {}) {
  if (!sock) return { flushedCount: 0, results: [] };

  const state = loadForwardingState();
  const nowMs = Date.now();
  const results = [];

  for (const [key, entry] of Object.entries(state.contacts)) {
    if (!entry || !Array.isArray(entry.pendingReplies) || entry.pendingReplies.length === 0) {
      continue;
    }

    const flushAtMs = entry.pendingFlushAt ? new Date(entry.pendingFlushAt).getTime() : 0;
    if (forceAll || !flushAtMs || nowMs >= flushAtMs) {
      const res = await flushPendingRepliesForContact(key, sock, formatJid, resolveTargetWaGroup, { force: true });
      if (res.flushed) results.push(res);
    } else {
      // Asegurar que exista timer en memoria (por ejemplo tras un reinicio del servidor)
      scheduleBatchTimerForContact(key, entry.pendingFlushAt, sock, formatJid, resolveTargetWaGroup);
    }
  }

  return { flushedCount: results.length, results };
}

/**
 * Obtiene el listado de contactos en seguimiento activo y el historial reciente
 */
function getTrackedMessagesSummary() {
  const state = loadForwardingState();
  const nowMs = Date.now();
  const activeContacts = Object.values(state.contacts)
    .filter(c => c && c.active && (!c.expiresAt || new Date(c.expiresAt).getTime() > nowMs))
    .sort((a, b) => new Date(b.sentAt || 0).getTime() - new Date(a.sentAt || 0).getTime());

  return {
    activeCount: activeContacts.length,
    activeContacts,
    history: (state.history || []).slice(0, 80)
  };
}

/**
 * Desactiva el seguimiento de respuestas para un número de teléfono
 */
function deactivateTrackedContact(phoneOrJid) {
  const phone = normalizePhoneDigits(phoneOrJid);
  if (!phone) return false;
  const state = loadForwardingState();
  const last8 = phone.slice(-8);
  let found = false;

  for (const [k, entry] of Object.entries(state.contacts)) {
    if (k === phone || k.endsWith(last8) || entry?.last8 === last8) {
      entry.active = false;
      found = true;
    }
  }

  if (found) saveForwardingState(state);
  return found;
}

module.exports = {
  registerTrackedContact,
  handleIncomingTrackedReply,
  flushPendingRepliesForContact,
  processPendingReplyBatches,
  syncRecentAuditLogsToTrackedState,
  getTrackedMessagesSummary,
  deactivateTrackedContact,
  normalizePhoneDigits,
  REPLY_BATCH_WINDOW_MINUTES
};
