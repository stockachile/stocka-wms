/**
 * Servicio de Notificación de Pedidos Manuales Pendientes para Stocka WMS
 * 
 * Reglas de Negocio:
 * 1. Monitorea pedidos manuales en estado WMS 'En procesamiento'.
 * 2. Horario: Todos los días a partir de las 12:00 hrs (hora de Chile, America/Santiago).
 * 3. Frecuencia: Un solo mensaje al día al grupo de coordinación por este concepto.
 * 4. Destino por defecto: Grupo de Coordinación Stocka (120363043911687615@g.us).
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { sendWhatsAppMessage } = require('./whatsapp_client');

// Cargar variables de entorno si existen
const envPath = path.join(__dirname, '../.env');
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

const WMS_URL = process.env.SUPABASE_URL || env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const WMS_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzMTE4NSwiZXhwIjoyMDk1NDA3MTg1fQ.YX4okf4XNkkVQaU0XbbRtm4SNRTqvwEVNd7ubc4PGe8';

const wmsClient = createClient(WMS_URL, WMS_KEY);

const DEFAULT_COORDINACION_GROUP = process.env.TARGET_WA_GROUP || 
                                   process.env.COORDINACION_WA_GROUP || 
                                   '120363043911687615@g.us';

// Archivo persistente para controlar el envío único diario
function getAlertStateFilePath() {
  if (process.env.AUTH_DIR) {
    const parent = path.dirname(process.env.AUTH_DIR);
    if (fs.existsSync(parent)) {
      return path.join(parent, 'manual_orders_daily_alert.json');
    }
  }
  return path.join(__dirname, '../manual_orders_daily_alert.json');
}

function loadAlertState() {
  const file = getAlertStateFilePath();
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (err) {
    console.error('[ManualOrdersNotifier] Error leyendo estado de alertas:', err.message);
  }
  return { lastNotifiedDate: null, history: [] };
}

function saveAlertState(state) {
  const file = getAlertStateFilePath();
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('[ManualOrdersNotifier] Error guardando estado de alertas:', err.message);
  }
}

/**
 * Obtiene la fecha actual en formato YYYY-MM-DD según zona horaria de Santiago
 */
function getSantiagoDateStr(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(date);
}

/**
 * Obtiene la hora actual (0-23) según zona horaria de Santiago
 */
function getSantiagoHour(date = new Date()) {
  const hourStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Santiago',
    hour: '2-digit',
    hourCycle: 'h23'
  }).format(date);
  return parseInt(hourStr, 10);
}

/**
 * Consulta en Supabase todos los pedidos manuales en estado WMS 'En procesamiento'
 */
async function fetchPendingManualOrders() {
  try {
    const { data, error } = await wmsClient
      .from('orders')
      .select('id, external_order_number, comercio, customer_name, customer_phone, origen, external_platform, status, estado_wms, created_at, shipping_method, operador, cantidad, sku, item')
      .or('origen.ilike.%manual%,external_platform.ilike.%manual%')
      .ilike('estado_wms', '%procesamiento%')
      .not('status', 'in', '("cancelado","anulado")')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[ManualOrdersNotifier] Error consultando pedidos manuales en Supabase:', error.message);
      return { error: error.message, orders: [] };
    }

    return { orders: data || [], count: (data || []).length };
  } catch (err) {
    console.error('[ManualOrdersNotifier] Excepción consultando pedidos manuales:', err.message);
    return { error: err.message, orders: [] };
  }
}

/**
 * Genera el cuerpo formateado del mensaje de Stox para WhatsApp
 */
function formatManualOrdersAlertMessage(orders) {
  const count = orders.length;
  const nowFormatted = new Date().toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const lines = [
    `🤖 *Stox | CONTROL PEDIDOS MANUALES*`,
    `⚠️ *ALERTA COORDINACIÓN - REVISIÓN 12:00 HRS*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `Hola equipo de Coordinación, se detectaron *${count} pedido(s) manual(es)* en estado *En procesamiento* (WMS) pendientes de ser revisados:`,
    ``
  ];

  orders.slice(0, 12).forEach((o, index) => {
    const orderNo = o.external_order_number || o.id?.slice(0, 8) || 'S/N';
    const comm = o.comercio || 'Comercio no asignado';
    const cust = o.customer_name ? `\n   👤 *Cliente:* ${o.customer_name}` : '';
    const dateStr = o.created_at ? new Date(o.created_at).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' }) : '';
    const dateDisplay = dateStr ? `\n   📅 *Ingreso:* ${dateStr}` : '';
    const method = (o.shipping_method || o.operador) ? `\n   🚚 *Despacho:* ${o.shipping_method || o.operador}` : '';
    
    lines.push(`*${index + 1}. Orden:* #${orderNo} (${comm})${cust}${dateDisplay}${method}`);
  });

  if (orders.length > 12) {
    lines.push(`\n... y *${orders.length - 12} pedido(s) más* en cola.`);
  }

  lines.push(
    `━━━━━━━━━━━━━━━━━━━━`,
    `👉 *Acción requerida:* Por favor ingresar al *Gestor de Pedidos* del WMS para validar y preparar.`,
    `🕒 _${nowFormatted}_`
  );

  return lines.join('\n');
}

/**
 * Evalúa y ejecuta la notificación diaria a coordinación
 * @param {Object} options
 * @param {boolean} options.force - Forzar envío aunque no sean las 12 o ya se haya enviado hoy
 * @param {boolean} options.dryRun - Simular sin enviar mensaje WhatsApp
 * @param {string} options.targetGroup - Sobreescribir grupo de WhatsApp
 */
async function checkAndNotifyPendingManualOrders(options = {}) {
  const force = !!options.force;
  const dryRun = !!options.dryRun;
  const targetGroup = options.targetGroup || DEFAULT_COORDINACION_GROUP;

  const todayStr = getSantiagoDateStr();
  const currentHour = getSantiagoHour();
  const state = loadAlertState();

  // 1. Validar horario: después de 12:00 hrs
  if (!force && currentHour < 12) {
    return {
      skipped: true,
      reason: `Aún no son las 12:00 hrs en Chile (Hora actual: ${currentHour}:00 hrs aprox). Programado para después de 12 hrs.`,
      currentHour,
      lastNotifiedDate: state.lastNotifiedDate
    };
  }

  // 2. Validar que sea un solo mensaje al día por este tema
  if (!force && state.lastNotifiedDate === todayStr) {
    return {
      skipped: true,
      reason: `Ya se envió la notificación diaria de pedidos manuales hoy (${todayStr}). Máximo 1 mensaje al día por este tema.`,
      lastNotifiedDate: state.lastNotifiedDate
    };
  }

  // 3. Consultar pedidos manuales pendientes
  const { orders, error, count } = await fetchPendingManualOrders();
  if (error) {
    return { success: false, error };
  }

  if (!orders || orders.length === 0) {
    console.log(`[ManualOrdersNotifier] ✅ No hay pedidos manuales en 'En procesamiento' hoy (${todayStr}).`);
    return {
      success: true,
      skipped: true,
      reason: 'No hay pedidos manuales pendientes de procesar.',
      count: 0
    };
  }

  console.log(`[ManualOrdersNotifier] ⚠️ Encontrados ${count} pedidos manuales pendientes. Preparando alerta...`);

  // 4. Formatear mensaje
  const formattedMessage = formatManualOrdersAlertMessage(orders);

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      count,
      targetGroup,
      message: formattedMessage,
      orders: orders.map(o => ({ orderNo: o.external_order_number, comercio: o.comercio }))
    };
  }

  // 5. Enviar mensaje por WhatsApp
  console.log(`[ManualOrdersNotifier] Enviando mensaje WhatsApp a grupo Coordinación (${targetGroup})...`);
  const waResult = await sendWhatsAppMessage(targetGroup, formattedMessage);

  // 6. Actualizar estado persistente para no repetir hoy
  const nowIso = new Date().toISOString();
  state.lastNotifiedDate = todayStr;
  state.lastNotifiedAt = nowIso;
  state.history = state.history || [];
  state.history.unshift({
    date: todayStr,
    timestamp: nowIso,
    count,
    targetGroup,
    success: waResult?.success !== false,
    orderNumbers: orders.map(o => o.external_order_number || o.id)
  });
  if (state.history.length > 30) state.history = state.history.slice(0, 30);
  saveAlertState(state);

  return {
    success: true,
    count,
    targetGroup,
    whatsappResult: waResult,
    sentAt: nowIso
  };
}

/**
 * Obtiene el estado actual de la alerta del día
 */
async function getManualOrdersAlertStatus() {
  const todayStr = getSantiagoDateStr();
  const currentHour = getSantiagoHour();
  const state = loadAlertState();
  const { orders, count, error } = await fetchPendingManualOrders();

  const isSentToday = state.lastNotifiedDate === todayStr;

  return {
    today: todayStr,
    currentHour,
    isAfter12: currentHour >= 12,
    isSentToday,
    lastNotifiedAt: state.lastNotifiedAt || null,
    pendingOrdersCount: count || 0,
    targetGroup: DEFAULT_COORDINACION_GROUP,
    pendingOrders: orders || [],
    error: error || null
  };
}

module.exports = {
  fetchPendingManualOrders,
  formatManualOrdersAlertMessage,
  checkAndNotifyPendingManualOrders,
  getManualOrdersAlertStatus,
  loadAlertState,
  saveAlertState,
  DEFAULT_COORDINACION_GROUP
};
