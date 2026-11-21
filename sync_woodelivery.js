/**
 * WMS STOCKA - Sincronización WooDelivery (Wodely / ALPHA) -> Supabase
 *
 * Estrategia de extracción eficiente por grupos hasta estado final:
 * 1. Consulta en Supabase la "Cola Abierta" de envíos Alpha (sin is_final = true).
 * 2. Autentica en https://app.woodelivery.com/ (sesión persistida en woodelivery_state.json / WOODELIVERY_STATE_JSON).
 * 3. Extrae tareas de entrega (TaskTypeId = 1) en 4 bloques JSON masivos vía POST /Task/ListTask:
 *    - ActiveTasks (activos + Failed 51 en reagendamiento)
 *    - CompletedTasks (ventana dinámica hasta el pedido abierto más antiguo; trae 50:Completed y 52:Returned)
 *    - FailedTasks
 *    - CancelledTasks
 * 4. Rescata rezagados de la cola abierta (o trackings fijados) mediante POST /Task/SearchTask (con cuota segura).
 * 5. Consolida multi-tareas por externalKey, aplica guardrails de choferes virtuales y congela estados finales (is_final = true).
 * 6. Captura fotos POD (/Task/ViewTask) y timeline limpio (/Task/TaskHistory) solo al llegar a 50/51/52 (con backoff anti-429).
 * 7. Hace upsert masivo en public.woodelivery_envios:
 *    - source_kind = 'lightdata' (5-8 dígitos): dispara triggers -> envios_unificados -> orders (autoridad exclusiva de entrega Alpha + enlace https://app.woodelivery.com/t?q={guid}).
 *    - source_kind = 'meli_flex' (9+ dígitos) / 'other': se almacena en woodelivery_envios solo para visibilidad/auditoría.
 *
 * Flags CLI:
 *   --dry-run        Ejecuta lectura, clasificación y auditoría sin escribir en Supabase
 *   --days N         Fuerza ventana de días hacia atrás (default dinámico entre 7 y 45 días)
 *   --skip-pod       Omite consultas /Task/ViewTask y /Task/TaskHistory
 *   --max-pod N      Máximo de tareas a enriquecer con POD/historial por corrida (default: 30)
 *   --max-search N   Máximo de búsquedas puntuales /Task/SearchTask por corrida (default: 15)
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ==========================================
// 1. CARGAR VARIABLES DE ENTORNO (.env)
// ==========================================
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf-8');
  envConfig.split(/\r?\n/).forEach(line => {
    if (!line || line.startsWith('#')) return;
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      const value = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key.trim()]) {
        process.env[key.trim()] = value;
      }
    }
  });
}

// ==========================================
// 2. CONFIGURACIÓN & ARGUMENTOS CLI
// ==========================================
const WOODELIVERY_EMAIL = process.env.WOODELIVERY_EMAIL;
const WOODELIVERY_PASSWORD = process.env.WOODELIVERY_PASSWORD;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const STATE_FILE = path.join(__dirname, 'woodelivery_state.json');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const BASE_URL = 'https://app.woodelivery.com';
const TASKS_URL = `${BASE_URL}/Task/Index`;

// Cargar sesión desde secreto CI si existe (WOODELIVERY_STATE_JSON)
if (process.env.WOODELIVERY_STATE_JSON && !fs.existsSync(STATE_FILE)) {
  try {
    fs.writeFileSync(STATE_FILE, process.env.WOODELIVERY_STATE_JSON, 'utf-8');
    console.log('📂 Sesión cargada desde secreto WOODELIVERY_STATE_JSON.');
  } catch (e) {
    console.warn('⚠️ No se pudo escribir woodelivery_state.json desde secreto:', e.message);
  }
}

if (!WOODELIVERY_EMAIL || !WOODELIVERY_PASSWORD) {
  console.error('❌ ERROR: Las variables WOODELIVERY_EMAIL y WOODELIVERY_PASSWORD no están configuradas.');
  process.exit(1);
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ ERROR: La variable SUPABASE_SERVICE_ROLE_KEY no está configurada.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Parsear argumentos CLI
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SKIP_POD = args.includes('--skip-pod');

function getIntArg(flag, defaultVal) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) {
    const parsed = parseInt(args[idx + 1], 10);
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  }
  return defaultVal;
}

const EXPLICIT_DAYS = getIntArg('--days', null);
const MAX_POD_CALLS = getIntArg('--max-pod', 30);
const MAX_SEARCH_CALLS = getIntArg('--max-search', 15);

// ==========================================
// 3. CATÁLOGOS, CLASIFICACIÓN Y HELPERS
// ==========================================
const FAILURE_REASON_MAP = {
  '10': 'Incidente de conductor / vehículo',
  '20': 'Destino inalcanzable',
  '30': 'Destinatario no disponible',
  '40': 'Rechazado (ítems incorrectos o faltantes)',
  '50': 'Rechazado (producto dañado)',
  '60': 'No se logra ubicar dirección',
  '71': 'Dirección o numeración incorrecta',
  '72': 'Paquete extraviado',
  '73': 'Demasiado tarde para enviar',
  '99': 'Otro motivo de fallo'
};

/**
 * Formatea fecha en YYYY-MM-DD HH:mm:ss (hora local Chile/Wodely)
 */
function formatWodelyDate(dateObj, endOfDay = false) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d} ${endOfDay ? '23:59:59' : '00:00:00'}`;
}

/**
 * Wodely /Task/ListTask entrega timestamps en UTC sin sufijo 'Z' (ej. "2026-11-17T21:10:37.947" = 18:10 Chile UTC-3).
 * Normalizamos a ISO UTC válido para Postgres TIMESTAMPTZ.
 */
function parseWodelyUtcDate(dtStr) {
  if (!dtStr) return null;
  const s = String(dtStr).trim();
  if (!s) return null;
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s) ? s : `${s}Z`;
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Clasifica el tipo de fuente según el patrón de externalKey:
 * - 5 a 8 dígitos: LightData did (Alpha directo)
 * - 9+ dígitos: Mercado Libre Flex (solo visibilidad/auditoría)
 * - otro: other (solo visibilidad/auditoría)
 */
function classifySourceKind(externalKey) {
  const k = String(externalKey || '').trim();
  if (/^\d{5,8}$/.test(k)) return 'lightdata';
  if (/^\d{9,}$/.test(k)) return 'meli_flex';
  return 'other';
}

/**
 * Detecta colas/choferes virtuales de Alpha que NUNCA representan una entrega real al cliente final.
 */
function isBlockingVirtualDriver(driverName) {
  const d = String(driverName || '').trim();
  if (!d) return false;
  return (
    /NO\s+RETIRAD/i.test(d) ||
    /RETORNAD/i.test(d) ||
    /^A\s+RETIRAR/i.test(d) ||
    /CENTRO\s+DE\s+DISTRIB/i.test(d) ||
    /^CD\s*-/i.test(d) ||
    /FUERA\s+DE\s+COBERTURA/i.test(d) ||
    /MOVIL\s+DE\s+PRUEBAS/i.test(d)
  );
}

function isReturnVirtualDriver(driverName) {
  const d = String(driverName || '').trim();
  return /RETORNAD|CENTRO\s+DE\s+DISTRIB|^CD\s*-|DEVOLUC/i.test(d);
}

function isAnyVirtualDriver(driverName) {
  const d = String(driverName || '').trim();
  if (!d) return false;
  return (
    isBlockingVirtualDriver(d) ||
    d.startsWith('-') ||
    /ALPHA\s+GROUP|CON\s+HORARIO\s+PRIORIDAD|^CD\s+ENTREGAS/i.test(d)
  );
}

function getFailureReasonText(code) {
  const c = String(code || '').trim();
  if (!c) return null;
  return FAILURE_REASON_MAP[c] || `Motivo código ${c}`;
}

/**
 * Elige la tarea ganadora cuando existen múltiples tareas en WooDelivery para el mismo externalKey.
 * Regla de precedencia:
 *   1. Completed (50) con chofer real (salvo que exista un Returned (52) con modifiedDateTime posterior)
 *   2. Tareas activas (30, 40, 28, 25, 20, 51, 10, 15) ordenadas por modifiedDateTime DESC
 *   3. Returned (52) ordenadas por modifiedDateTime DESC
 *   4. Cancelled (90) solo si TODAS las tareas del externalKey están canceladas
 */
function pickWinningTask(tasks) {
  if (!tasks || tasks.length === 0) return null;
  if (tasks.length === 1) return tasks[0];

  const tsOf = (t) => {
    const iso = parseWodelyUtcDate(t.modifiedDateTime || t.completedDateTime || t.createdDateTime);
    return iso ? new Date(iso).getTime() : 0;
  };

  const realCompleted = tasks
    .filter(t => Number(t.statusId) === 50 && !isBlockingVirtualDriver(t.driverName))
    .sort((a, b) => tsOf(b) - tsOf(a));

  const returned = tasks
    .filter(t => Number(t.statusId) === 52 || (Number(t.statusId) === 50 && isReturnVirtualDriver(t.driverName)))
    .sort((a, b) => tsOf(b) - tsOf(a));

  if (realCompleted.length > 0) {
    const bestComp = realCompleted[0];
    if (returned.length > 0 && tsOf(returned[0]) > tsOf(bestComp)) {
      return returned[0];
    }
    return bestComp;
  }

  const active = tasks
    .filter(t => ![50, 52, 90].includes(Number(t.statusId)))
    .sort((a, b) => tsOf(b) - tsOf(a));

  if (active.length > 0) {
    return active[0];
  }

  if (returned.length > 0) {
    return returned[0];
  }

  // Fallback: todas son 90:Cancelled o 50 con chofer virtual no-retorno
  return [...tasks].sort((a, b) => tsOf(b) - tsOf(a))[0];
}

/**
 * Clasifica una tarea ganadora en estado normalizado WMS, texto limpio en español y bandera is_final.
 */
function classifyTask(task) {
  const statusId = Number(task.statusId);
  const statusDesc = String(task.statusDesc || '').trim() || `Status ${statusId}`;
  const driverName = String(task.driverName || '').trim() || null;
  const tag2 = String(task.tag2 || '').trim();
  const blockingVirtual = isBlockingVirtualDriver(driverName);
  const returnVirtual = isReturnVirtualDriver(driverName);
  const anyVirtual = isAnyVirtualDriver(driverName);
  const frCode = String(task.taskFailedReason || '').trim() || null;
  const frText = getFailureReasonText(frCode);

  const modIso = parseWodelyUtcDate(task.modifiedDateTime || task.completedDateTime || task.createdDateTime);
  const ageHours = modIso ? (Date.now() - new Date(modIso).getTime()) / (1000 * 60 * 60) : 0;

  let statusNorm = 'SIN MOVIMIENTO';
  let statusDisplay = statusDesc;
  let isFinal = false;
  let finalReason = null;

  if (statusId === 50) {
    if (returnVirtual) {
      statusNorm = 'DEVOLUCIÓN';
      statusDisplay = 'Devuelto a origen';
      isFinal = true;
      finalReason = 'returned';
    } else if (blockingVirtual) {
      statusNorm = 'SIN MOVIMIENTO';
      statusDisplay = 'No retirado (Alpha)';
      isFinal = false;
    } else {
      statusNorm = 'ENTREGADO';
      statusDisplay = 'Entregado';
      isFinal = true;
      finalReason = 'completed_real';
    }
  } else if (statusId === 52) {
    statusNorm = 'DEVOLUCIÓN';
    statusDisplay = frText ? `Devuelto a origen (${frText})` : 'Devuelto a origen';
    isFinal = true;
    finalReason = 'returned';
  } else if (statusId === 51) {
    statusNorm = 'ALERTA';
    statusDisplay = frText ? `Intento fallido: ${frText}` : 'Intento fallido';
    // Failed (51) NO es final mientras Alpha pueda reagendar; solo congelar tras 30 días sin cambio
    if (ageHours >= 30 * 24) {
      isFinal = true;
      finalReason = 'failed_stale_30d';
    }
  } else if (statusId === 90) {
    statusNorm = 'ALERTA';
    statusDisplay = 'Cancelado en WooDelivery';
    // Congelar cancelados solo tras 48h sin recreación de nueva tarea
    if (ageHours >= 48) {
      isFinal = true;
      finalReason = 'cancelled_confirmed';
    }
  } else if (statusId === 40) {
    statusNorm = 'EN TRÁNSITO';
    statusDisplay = 'Chofer llegó a destino';
  } else if (statusId === 30) {
    statusNorm = 'EN TRÁNSITO';
    statusDisplay = 'En reparto';
  } else if (statusId === 28) {
    statusNorm = 'EN TRÁNSITO';
    statusDisplay = 'Cargado en vehículo';
  } else if (statusId === 25) {
    statusNorm = 'EN TRÁNSITO';
    statusDisplay = 'Procesado en planta';
  } else if (statusId === 20) {
    if (blockingVirtual) {
      statusNorm = 'SIN MOVIMIENTO';
      statusDisplay = 'Pendiente de retiro';
    } else if (/retirado|en planta|procesamiento/i.test(tag2)) {
      statusNorm = 'EN TRÁNSITO';
      statusDisplay = tag2;
    } else {
      statusNorm = 'SIN MOVIMIENTO';
      statusDisplay = 'Asignado a chofer';
    }
  } else {
    statusNorm = 'SIN MOVIMIENTO';
    statusDisplay = statusId === 15 ? 'Asignando chofer' : 'Pendiente de asignación';
  }

  return {
    statusId,
    statusDesc,
    statusDisplay,
    statusNorm,
    isFinal,
    finalReason,
    driverName,
    isVirtualDriver: blockingVirtual || anyVirtual,
    isBlockingVirtual: blockingVirtual,
    frCode,
    frText
  };
}

function resolveComercioFromSigla(myId, configMap) {
  if (!myId) return null;
  const clean = String(myId).trim().replace(/^[^A-Za-z0-9]+/, '');
  if (clean.length >= 3) {
    const sigla3 = clean.substring(0, 3).toUpperCase();
    if (configMap[sigla3]) return configMap[sigla3];
  }
  const matchAlpha = clean.match(/^([A-Za-z]{2,6})/);
  if (matchAlpha && configMap[matchAlpha[1].toUpperCase()]) {
    return configMap[matchAlpha[1].toUpperCase()];
  }
  return null;
}

/**
 * Limpia los eventos devueltos por /Task/TaskHistory (omite notificaciones automáticas internas logTypeId >= 100)
 */
function sanitizeHistoryEvents(rawLogs) {
  if (!Array.isArray(rawLogs)) return [];
  return rawLogs
    .filter(log => log && Number(log.logTypeId || 0) < 100)
    .map(log => ({
      at: parseWodelyUtcDate(log.logDateTime) || log.logDateTime || null,
      log_type_id: Number(log.logTypeId || 0),
      desc: String(log.logDesc || '').trim(),
      tooltip: String(log.statusToolTip || '').trim() || null,
      user: String(log.logUser || '').trim() || null
    }))
    .slice(0, 40);
}

/**
 * Extrae URLs únicas de fotos POD desde el HTML de /Task/ViewTask
 */
function extractPodImagesFromHtml(html) {
  if (!html) return [];
  const matches = html.match(/https:\/\/woodelivery\.blob\.core\.windows\.net\/(?:img-task|file-task)\/[^"'<>\s]+/gi) || [];
  return Array.from(new Set(matches));
}

// ==========================================
// 4. FLUJO PRINCIPAL DE SINCRONIZACIÓN
// ==========================================
async function syncWooDelivery() {
  const startedAt = Date.now();
  console.log('==========================================================');
  console.log(`🔄 Iniciando Sincronización WooDelivery (ALPHA) -> WMS STOCKA${DRY_RUN ? ' [DRY-RUN]' : ''}`);
  console.log('==========================================================');

  // 4.1 Cargar mapa de siglas de comercios
  const configMap = {};
  const { data: configRows } = await supabase.from('v_comercios_config').select('sigla, nombre');
  if (configRows) {
    for (const r of configRows) {
      if (r.sigla && r.nombre) configMap[r.sigla.trim().toUpperCase()] = r.nombre.trim();
    }
    console.log(`✅ Mapa de siglas cargado: ${Object.keys(configMap).length} comercios.`);
  }

  // 4.2 Cargar caché existente de woodelivery_envios (para delta-skip y preservación de POD)
  const existingWdMap = new Map();
  let wdTableAvailable = true;
  try {
    const since60d = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const { data: existingRows, error: wdErr } = await supabase
      .from('woodelivery_envios')
      .select('external_key, task_id, status_id, is_final, wd_modified_at, pod_fetched_at, pod_images, history_events, comercio, source_kind')
      .gte('updated_at', since60d)
      .limit(10000);

    if (wdErr) {
      wdTableAvailable = false;
      console.warn(`⚠️ Tabla woodelivery_envios no disponible aún (${wdErr.message}).${DRY_RUN ? ' Continuando en modo --dry-run.' : ''}`);
      if (!DRY_RUN) {
        console.error('❌ Aplica primero la migración supabase/migrations/20261127_woodelivery_integration.sql antes de ejecutar sin --dry-run.');
        process.exit(1);
      }
    } else if (existingRows) {
      for (const row of existingRows) {
        existingWdMap.set(String(row.external_key).trim(), row);
      }
      console.log(`📦 Caché previa woodelivery_envios cargada: ${existingWdMap.size} registro(s).`);
    }
  } catch (e) {
    wdTableAvailable = false;
    if (!DRY_RUN) throw e;
  }

  // 4.3 Construir "Cola Abierta" de pedidos Alpha en Supabase para calcular ventana dinámica y rescate
  const since45d = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
  const openQueueKeys = new Set();
  const pinnedAlphaKeys = new Set();
  let oldestOpenMs = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const { data: openAlphaOrders } = await supabase
    .from('orders')
    .select('id, external_order_number, tracking_number, estado_wms, operador, courier, comercio, categoria_entrega, created_at, raw_lightdata_data, raw_shopify_data')
    .or('operador.eq.ALPHA,courier.eq.LIGHTDATA,courier.eq.CARRIER EXTERNO,courier.eq.ALPHA')
    .not('estado_wms', 'in', '("Entregado","Cancelado","Archivado")')
    .gte('created_at', since45d)
    .limit(2000);

  if (openAlphaOrders && openAlphaOrders.length > 0) {
    for (const ord of openAlphaOrders) {
      if (String(ord.categoria_entrega || '').toUpperCase().trim() === 'RETIRO') continue;
      const ft = ord.raw_shopify_data?.wms_forced_tracking;
      const forcedTrk = (ft && ft.active && ft.tracking_number) ? String(ft.tracking_number).trim() : null;
      const did = forcedTrk || String(ord.raw_lightdata_data?.did || ord.raw_lightdata_data?.id || ord.tracking_number || '').trim();
      if (/^\d{5,8}$/.test(did)) {
        const prev = existingWdMap.get(did);
        if (!prev || !prev.is_final) {
          openQueueKeys.add(did);
          if (forcedTrk) pinnedAlphaKeys.add(did);
          if (ord.created_at) {
            const cMs = new Date(ord.created_at).getTime();
            if (!isNaN(cMs) && cMs < oldestOpenMs) oldestOpenMs = cMs;
          }
        }
      }
    }
  }

  // Calcular ventana dinámica de días (mín 7d, máx 45d, o --days explícito)
  const dynamicDays = Math.min(45, Math.max(7, Math.ceil((Date.now() - oldestOpenMs) / (1000 * 60 * 60 * 24)) + 2));
  const daysBack = EXPLICIT_DAYS !== null ? Math.max(1, EXPLICIT_DAYS) : dynamicDays;
  console.log(`🎯 Cola abierta Alpha pendiente de estado final: ${openQueueKeys.size} pedido(s) | Ventana de consulta: ${daysBack} día(s).`);

  // 4.4 Iniciar Playwright y autenticar en app.woodelivery.com
  const isCI = !!process.env.GITHUB_ACTIONS;
  const isHeadless = isCI || process.env.HEADLESS !== 'false';
  console.log(`🚀 Iniciando Chromium (${isHeadless ? 'Headless' : 'Con interfaz'})...`);

  const browser = await chromium.launch({
    headless: isHeadless,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  let context;
  if (fs.existsSync(STATE_FILE)) {
    console.log('📂 Cargando sesión persistida desde:', STATE_FILE);
    context = await browser.newContext({ storageState: STATE_FILE });
  } else {
    context = await browser.newContext();
  }

  const page = await context.newPage();
  let allRawTasks = [];
  let rescuedCount = 0;
  let podFetchedCount = 0;
  let podRateLimited = false;
  const podEnrichmentMap = new Map(); // taskId -> { pod_images, history_events, pod_fetched_at }

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    console.log(`🌐 Navegando a ${TASKS_URL}...`);
    await page.goto(TASKS_URL, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // Verificar si requiere login
    const isLoginPage = page.url().includes('/Identity/Account/Login') || await page.locator('#Input_UserName').isVisible().catch(() => false);
    if (isLoginPage) {
      // Guardrail anti-CAPTCHA: nunca intentar evadir un CAPTCHA si apareciera
      const hasCaptcha = await page.evaluate(() => {
        const html = (document.body?.innerHTML || '').toLowerCase();
        return html.includes('recaptcha') || html.includes('hcaptcha') || html.includes('turnstile') || html.includes('cf-challenge');
      });
      if (hasCaptcha) {
        throw new Error('Se detectó un desafío CAPTCHA en el login de WooDelivery. Intervención manual requerida.');
      }

      console.log('🔐 Sesión expirada o inexistente. Autenticando en WooDelivery...');
      await page.fill('#Input_UserName', WOODELIVERY_EMAIL);
      await page.fill('#Input_Password', WOODELIVERY_PASSWORD);
      await page.waitForTimeout(400);
      await page.click('button[type="submit"]');
      await page.waitForURL(u => !u.href.includes('/Identity/Account/Login'), { timeout: 35000 });
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

      await context.storageState({ path: STATE_FILE });
      console.log('💾 Sesión guardada correctamente en woodelivery_state.json.');

      if (!page.url().includes('/Task/Index')) {
        await page.goto(TASKS_URL, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
        await page.waitForTimeout(1500);
      }
    } else {
      console.log('🔓 Sesión activa cargada sin necesidad de re-login.');
    }

    // Obtener token anti-CSRF __RequestVerificationToken
    const csrfToken = await page.evaluate(() => {
      return document.querySelector('input[name="__RequestVerificationToken"]')?.value || '';
    });

    if (!csrfToken) {
      throw new Error('No se encontró __RequestVerificationToken en /Task/Index. Verificar sesión.');
    }

    // 4.5 Extracción en 4 bloques masivos (POST /Task/ListTask JSON, solo Delivery TaskTypeId=1)
    const now = new Date();
    const startCompleted = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    const startActive = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const endFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const startFailedCancelled = new Date(Date.now() - Math.max(14, daysBack) * 24 * 60 * 60 * 1000);

    const blocks = [
      { listType: 'ActiveTasks', start: formatWodelyDate(startActive, false), end: formatWodelyDate(endFuture, true) },
      { listType: 'CompletedTasks', start: formatWodelyDate(startCompleted, false), end: formatWodelyDate(now, true) },
      { listType: 'FailedTasks', start: formatWodelyDate(startFailedCancelled, false), end: formatWodelyDate(now, true) },
      { listType: 'CancelledTasks', start: formatWodelyDate(startFailedCancelled, false), end: formatWodelyDate(now, true) }
    ];

    console.log('\n📥 Consultando bloques JSON en /Task/ListTask (TaskTypeId = 1 Delivery)...');
    const byTaskId = new Map();

    for (const blk of blocks) {
      const res = await page.evaluate(async ({ listType, start, end, csrf }) => {
        const body = new URLSearchParams({
          ListType: listType,
          TimeZoneName: 'America/Santiago',
          FilterDateStart: start,
          FilterDateEnd: end,
          DriverUserId: '',
          TaskStatusId: '',
          TaskTypeId: '1',
          MerchantId: '',
          TeamId: '',
          __RequestVerificationToken: csrf
        });
        const resp = await fetch('/Task/ListTask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          body: body.toString()
        });
        if (!resp.ok) {
          return { ok: false, status: resp.status, error: (await resp.text()).slice(0, 200) };
        }
        const data = await resp.json();
        return { ok: true, status: resp.status, data: Array.isArray(data) ? data : [] };
      }, { ...blk, csrf: csrfToken });

      if (!res.ok) {
        console.error(`   ❌ Error en bloque ${blk.listType}: HTTP ${res.status} - ${res.error}`);
        continue;
      }

      for (const t of res.data) {
        if (t && t.id) byTaskId.set(t.id, t);
      }
      console.log(`   ✅ ${blk.listType}: ${res.data.length} tarea(s) (${blk.start.slice(0, 10)} → ${blk.end.slice(0, 10)})`);
    }

    // 4.6 Rescate puntual vía POST /Task/SearchTask para pedidos abiertos que no aparecieron en los bloques
    const seenExternalKeys = new Set();
    for (const t of byTaskId.values()) {
      const ek = String(t.externalKey || '').trim();
      if (ek) seenExternalKeys.add(ek);
    }

    // Priorizar pinned trackings primero, luego resto de cola abierta
    const missingFromBlocks = [
      ...Array.from(pinnedAlphaKeys).filter(k => !seenExternalKeys.has(k)),
      ...Array.from(openQueueKeys).filter(k => !pinnedAlphaKeys.has(k) && !seenExternalKeys.has(k))
    ];

    if (missingFromBlocks.length > 0 && MAX_SEARCH_CALLS > 0) {
      const toRescue = missingFromBlocks.slice(0, MAX_SEARCH_CALLS);
      console.log(`\n🔎 Rescatando ${toRescue.length} de ${missingFromBlocks.length} pedido(s) abierto(s) vía /Task/SearchTask...`);
      const rescueStart = formatWodelyDate(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), false);
      const rescueEnd = formatWodelyDate(now, true);

      for (const ek of toRescue) {
        const sRes = await page.evaluate(async ({ externalKey, start, end, csrf }) => {
          const body = new URLSearchParams({
            ListType: 'SearchTasks',
            TimeZoneName: 'America/Santiago',
            TaskGuid: '',
            ExternalKey: externalKey,
            Keyword: '',
            TypeId: '1',
            StatusId: '',
            DriverUserId: '',
            MerchantId: '',
            SearchDateStart: start,
            SearchDateEnd: end,
            OffsetRow: '0',
            IsSearch: 'true',
            __RequestVerificationToken: csrf
          });
          const resp = await fetch('/Task/SearchTask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: body.toString()
          });
          if (!resp.ok) return { ok: false, status: resp.status };
          const data = await resp.json().catch(() => []);
          return { ok: true, data: Array.isArray(data) ? data : [] };
        }, { externalKey: ek, start: rescueStart, end: rescueEnd, csrf: csrfToken });

        if (sRes.ok && sRes.data.length > 0) {
          for (const t of sRes.data) {
            if (t && t.id) byTaskId.set(t.id, t);
          }
          rescuedCount++;
        } else if (sRes.status === 429) {
          console.warn('   ⚠️ Rate limit 429 en /Task/SearchTask. Deteniendo rescates en esta corrida.');
          break;
        }
        await page.waitForTimeout(300);
      }
      console.log(`   ✅ Rescatados en SearchTask: ${rescuedCount}/${toRescue.length}.`);
    }

    allRawTasks = Array.from(byTaskId.values());
    console.log(`\n📊 Total tareas Delivery únicas obtenidas: ${allRawTasks.length}`);

    // 4.7 Agrupar por externalKey, consolidar multi-tarea y determinar qué tareas necesitan POD/Timeline
    const tasksByExternalKey = new Map();
    let skippedSystemCount = 0;

    for (const t of allRawTasks) {
      if (Number(t.typeId) !== 1) continue;
      const ek = String(t.externalKey || '').trim();
      if (!ek || /^(PICKUP|DEVOLUCION)$/i.test(ek)) {
        skippedSystemCount++;
        continue;
      }
      if (!tasksByExternalKey.has(ek)) tasksByExternalKey.set(ek, []);
      tasksByExternalKey.get(ek).push(t);
    }

    console.log(`🧩 Envíos únicos agrupados por externalKey: ${tasksByExternalKey.size} (omitidas sistema: ${skippedSystemCount})`);

    // Identificar candidatos para enriquecimiento POD + Timeline (solo source_kind='lightdata' en 50/51/52)
    const podCandidates = [];
    for (const [ek, taskList] of tasksByExternalKey.entries()) {
      if (classifySourceKind(ek) !== 'lightdata') continue;
      const winner = pickWinningTask(taskList);
      if (!winner) continue;
      const sid = Number(winner.statusId);
      if (![50, 51, 52].includes(sid)) continue;

      const existing = existingWdMap.get(ek);
      const winModIso = parseWodelyUtcDate(winner.modifiedDateTime || winner.completedDateTime || winner.createdDateTime);
      const existingModMs = existing?.wd_modified_at ? new Date(existing.wd_modified_at).getTime() : 0;
      const winModMs = winModIso ? new Date(winModIso).getTime() : 0;

      const needsPod = !existing || !existing.pod_fetched_at || (winModMs > existingModMs) || Number(existing.task_id) !== Number(winner.id);
      if (needsPod) {
        podCandidates.push({ ek, winner, sortMs: winModMs });
      }
    }

    // Ordenar más recientes primero para que entregas de hoy obtengan POD de inmediato
    podCandidates.sort((a, b) => b.sortMs - a.sortMs);

    if (!SKIP_POD && podCandidates.length > 0 && MAX_POD_CALLS > 0) {
      const podSlice = podCandidates.slice(0, MAX_POD_CALLS);
      console.log(`\n📸 Capturando fotos POD y timeline (/Task/ViewTask + /Task/TaskHistory) para ${podSlice.length} de ${podCandidates.length} envío(s) elegible(s)...`);

      for (const { ek, winner } of podSlice) {
        const detailRes = await page.evaluate(async ({ taskId, taskGuid, csrf }) => {
          const post = async (url, params) => {
            const res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
              body: new URLSearchParams({ ...params, __RequestVerificationToken: csrf }).toString()
            });
            const text = await res.text();
            return { status: res.status, text };
          };

          const vt = await post('/Task/ViewTask', { TaskId: String(taskId), id: String(taskId), guid: String(taskGuid || '') });
          if (vt.status === 429) return { rateLimited: true };

          const th = await post('/Task/TaskHistory', { Id: String(taskId), TaskId: String(taskId) });
          if (th.status === 429) return { rateLimited: true, vtHtml: vt.status === 200 ? vt.text : '' };

          let historyJson = [];
          try { historyJson = JSON.parse(th.text); } catch (_) {}

          return {
            rateLimited: false,
            vtStatus: vt.status,
            vtHtml: vt.status === 200 ? vt.text : '',
            thStatus: th.status,
            historyJson: Array.isArray(historyJson) ? historyJson : []
          };
        }, { taskId: winner.id, taskGuid: winner.guid, csrf: csrfToken });

        if (detailRes.rateLimited) {
          podRateLimited = true;
          console.warn(`   ⚠️ HTTP 429 detectado en tarea ${winner.id} (externalKey ${ek}). Pausando enriquecimiento POD hasta la próxima corrida.`);
          break;
        }

        const podImages = extractPodImagesFromHtml(detailRes.vtHtml);
        const historyEvents = sanitizeHistoryEvents(detailRes.historyJson);
        podEnrichmentMap.set(String(winner.id), {
          pod_images: podImages,
          history_events: historyEvents,
          pod_fetched_at: new Date().toISOString()
        });
        podFetchedCount++;
        await page.waitForTimeout(350);
      }

      console.log(`   ✅ POD + Timeline capturados: ${podFetchedCount} envío(s)${podRateLimited ? ' (detenido por 429 seguro)' : ''}.`);
    }

    // Guardar sesión actualizada si todo salió bien
    await context.storageState({ path: STATE_FILE });
  } catch (err) {
    console.error('❌ Error durante la sesión con WooDelivery:', err);
    try {
      if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
      await page.screenshot({ path: path.join(DOWNLOADS_DIR, 'woodelivery_error.png') });
      console.log('📸 Captura guardada en downloads/woodelivery_error.png');
    } catch (_) {}
    await browser.close();
    process.exit(1);
  } finally {
    await browser.close();
  }

  // ==========================================
  // 5. RESOLUCIÓN DE COMERCIOS Y ARMADO DE PAYLOADS
  // ==========================================
  const allExternalKeys = Array.from(
    new Set(
      allRawTasks
        .filter(t => Number(t.typeId) === 1 && t.externalKey && !/^(PICKUP|DEVOLUCION)$/i.test(String(t.externalKey).trim()))
        .map(t => String(t.externalKey).trim())
    )
  );

  // Consultar lightdata_envios en lotes para enriquecer comercio y auditar discrepancias
  const ldLookupKeys = allExternalKeys.filter(k => classifySourceKind(k) === 'lightdata');
  const lightdataMap = new Map();
  for (let i = 0; i < ldLookupKeys.length; i += 200) {
    const chunk = ldLookupKeys.slice(i, i + 200);
    const { data: ldRows } = await supabase
      .from('lightdata_envios')
      .select('id, tracking, comercio, status')
      .in('id', chunk);
    if (ldRows) {
      for (const r of ldRows) lightdataMap.set(String(r.id).trim(), r);
    }
  }

  // Reagrupar por externalKey
  const grouped = new Map();
  for (const t of allRawTasks) {
    if (Number(t.typeId) !== 1) continue;
    const ek = String(t.externalKey || '').trim();
    if (!ek || /^(PICKUP|DEVOLUCION)$/i.test(ek)) continue;
    if (!grouped.has(ek)) grouped.set(ek, []);
    grouped.get(ek).push(t);
  }

  const upsertPayloads = [];
  const stats = {
    totalUnique: grouped.size,
    lightdataCount: 0,
    meliFlexAuditCount: 0,
    otherAuditCount: 0,
    skippedFinalUnchanged: 0,
    toUpsert: 0,
    multiTaskMerged: 0,
    byNormStatus: {},
    byFinalReason: {},
    lightdataMatched: 0,
    discrepanciesVsLightdata: []
  };

  const nowIso = new Date().toISOString();

  for (const [ek, taskList] of grouped.entries()) {
    if (taskList.length > 1) stats.multiTaskMerged++;
    const sourceKind = classifySourceKind(ek);
    if (sourceKind === 'lightdata') stats.lightdataCount++;
    else if (sourceKind === 'meli_flex') stats.meliFlexAuditCount++;
    else stats.otherAuditCount++;

    const winner = pickWinningTask(taskList);
    if (!winner) continue;

    const cls = classifyTask(winner);
    stats.byNormStatus[cls.statusNorm] = (stats.byNormStatus[cls.statusNorm] || 0) + 1;
    if (cls.isFinal && cls.finalReason) {
      stats.byFinalReason[cls.finalReason] = (stats.byFinalReason[cls.finalReason] || 0) + 1;
    }

    const ldRow = lightdataMap.get(ek) || null;
    if (ldRow) {
      stats.lightdataMatched++;
      const ldLow = String(ldRow.status || '').trim().toLowerCase();
      const ldSaysDelivered = ldLow.includes('entregad');
      const wdSaysDelivered = cls.statusNorm === 'ENTREGADO';
      if (ldSaysDelivered !== wdSaysDelivered) {
        stats.discrepanciesVsLightdata.push({
          external_key: ek,
          tracking: ldRow.tracking || winner.tag3 || null,
          comercio: ldRow.comercio || null,
          lightdata_status: ldRow.status,
          woodelivery_status: `${cls.statusId}:${cls.statusDesc} -> ${cls.statusNorm}`,
          driver: cls.driverName,
          notes: (winner.completedNotes || '').trim().slice(0, 90)
        });
      }
    }

    const winCreatedIso = parseWodelyUtcDate(winner.createdDateTime);
    const winModIso = parseWodelyUtcDate(winner.modifiedDateTime);
    const winCompIso = parseWodelyUtcDate(winner.completedDateTime);
    const existing = existingWdMap.get(ek) || null;
    const enrichedPod = podEnrichmentMap.get(String(winner.id)) || null;

    // Delta-skip: si ya está congelado en estado final, misma tarea, misma modificación y no hay nuevo POD
    const sameTask = existing && Number(existing.task_id) === Number(winner.id);
    const sameMod = existing && existing.wd_modified_at && winModIso &&
      new Date(existing.wd_modified_at).getTime() === new Date(winModIso).getTime();
    if (existing && existing.is_final && sameTask && sameMod && !enrichedPod) {
      stats.skippedFinalUnchanged++;
      continue;
    }

    const myId = String(winner.tag3 || ldRow?.tracking || '').trim() || null;
    const comercio = ldRow?.comercio || existing?.comercio || resolveComercioFromSigla(myId, configMap) || null;
    const taskGuid = String(winner.guid || '').trim();
    const trackingUrl = taskGuid ? `${BASE_URL}/t?q=${encodeURIComponent(taskGuid)}` : null;

    const payload = {
      external_key: ek,
      source_kind: sourceKind,
      task_id: Number(winner.id),
      task_guid: taskGuid,
      tracking_url: trackingUrl,
      my_id: myId,
      comercio,
      courier: 'ALPHA',
      status_id: cls.statusId,
      status_desc: cls.statusDesc,
      status_display: cls.statusDisplay,
      status_wms_normalized: cls.statusNorm,
      is_final: cls.isFinal,
      final_reason: cls.finalReason,
      driver_name: cls.driverName,
      is_virtual_driver: cls.isVirtualDriver,
      tag2_alpha_stage: String(winner.tag2 || '').trim() || null,
      tag4_notes: String(winner.tag4 || '').trim() || null,
      failed_reason_code: cls.frCode,
      failed_reason_text: cls.frText,
      recipient_name: String(winner.recipientName || '').trim() || null,
      recipient_phone: String(winner.recipientPhone || '').trim() || null,
      recipient_email: String(winner.recipientEmail || '').trim() || null,
      destination_address: String(winner.destinationAddress || '').trim() || null,
      zone_name: String(winner.zoneName || '').trim() || null,
      completed_recipient_name: String(winner.completedRecipientName || '').trim() || null,
      completed_notes: String(winner.completedNotes || '').trim() || null,
      completed_coordinates: String(winner.completedCoordinates || '').trim() || null,
      pod_images: enrichedPod ? enrichedPod.pod_images : (existing?.pod_images || []),
      history_events: enrichedPod ? enrichedPod.history_events : (existing?.history_events || []),
      pod_fetched_at: enrichedPod ? enrichedPod.pod_fetched_at : (existing?.pod_fetched_at || null),
      wd_created_at: winCreatedIso,
      wd_modified_at: winModIso,
      wd_completed_at: winCompIso,
      related_task_ids: taskList.map(t => ({
        id: Number(t.id),
        guid: t.guid || null,
        status_id: Number(t.statusId),
        status_desc: t.statusDesc || null,
        driver: t.driverName || null,
        modified: parseWodelyUtcDate(t.modifiedDateTime)
      })),
      raw_data: winner,
      updated_at: nowIso
    };

    upsertPayloads.push(payload);
  }

  stats.toUpsert = upsertPayloads.length;

  // ==========================================
  // 6. ESCRITURA EN SUPABASE (o REPORTE DRY-RUN)
  // ==========================================
  let dbUpserted = 0;
  let dbErrors = 0;

  if (DRY_RUN) {
    console.log('\n🧪 [DRY-RUN] No se realizaron escrituras en Supabase.');
    const sampleWithPod = upsertPayloads.find(p => p.pod_images && p.pod_images.length > 0);
    if (sampleWithPod) {
      console.log('📸 Ejemplo payload con POD:', JSON.stringify({
        external_key: sampleWithPod.external_key,
        my_id: sampleWithPod.my_id,
        comercio: sampleWithPod.comercio,
        tracking_url: sampleWithPod.tracking_url,
        status_display: sampleWithPod.status_display,
        status_wms_normalized: sampleWithPod.status_wms_normalized,
        is_final: sampleWithPod.is_final,
        completed_recipient_name: sampleWithPod.completed_recipient_name,
        pod_images_count: sampleWithPod.pod_images.length,
        history_events_count: sampleWithPod.history_events.length
      }, null, 2));
    }
  } else if (upsertPayloads.length > 0) {
    console.log(`\n🚀 Upsertando ${upsertPayloads.length} registro(s) en public.woodelivery_envios...`);
    const batchSize = 100;
    for (let i = 0; i < upsertPayloads.length; i += batchSize) {
      const batch = upsertPayloads.slice(i, i + batchSize);
      const { error: upErr } = await supabase
        .from('woodelivery_envios')
        .upsert(batch, { onConflict: 'external_key' });

      if (upErr) {
        console.warn(`⚠️ Error en bloque ${i}-${i + batch.length}, reintentando individualmente:`, upErr.message);
        for (const item of batch) {
          const { error: singleErr } = await supabase
            .from('woodelivery_envios')
            .upsert([item], { onConflict: 'external_key' });
          if (singleErr) {
            dbErrors++;
            console.error(`   ❌ Error upsert external_key=${item.external_key}:`, singleErr.message);
          } else {
            dbUpserted++;
          }
        }
      } else {
        dbUpserted += batch.length;
      }
    }
  }

  // ==========================================
  // 7. RESUMEN FINAL DE AUDITORÍA
  // ==========================================
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('\n==========================================================');
  console.log(`🎉 Sincronización WooDelivery finalizada en ${elapsedSec}s${DRY_RUN ? ' [DRY-RUN]' : ''}`);
  console.log(`   - Envíos únicos procesados:    ${stats.totalUnique}`);
  console.log(`     · LightData (ALPHA):         ${stats.lightdataCount} (match lightdata_envios: ${stats.lightdataMatched}/${stats.lightdataCount})`);
  console.log(`     · MeLi Flex (solo auditoría):${stats.meliFlexAuditCount}`);
  console.log(`     · Otros (solo auditoría):    ${stats.otherAuditCount}`);
  console.log(`   - Multi-tareas consolidadas:   ${stats.multiTaskMerged}`);
  console.log(`   - Omitidos (final sin cambio): ${stats.skippedFinalUnchanged}`);
  console.log(`   - Listos/Upsertados BD:        ${DRY_RUN ? stats.toUpsert + ' (simulados)' : `${dbUpserted} OK / ${dbErrors} err`}`);
  console.log(`   - POD + Timeline capturados:   ${podFetchedCount}`);
  console.log(`   - Distribución normalizada:    ${JSON.stringify(stats.byNormStatus)}`);
  console.log(`   - Estados finales congelados:  ${JSON.stringify(stats.byFinalReason)}`);
  console.log(`   - Discrepancias vs LightData:  ${stats.discrepanciesVsLightdata.length}`);
  if (stats.discrepanciesVsLightdata.length > 0) {
    console.log('   📋 Detalle discrepancias (máx 15):');
    stats.discrepanciesVsLightdata.slice(0, 15).forEach(d => {
      console.log(`      · DID ${d.external_key} (${d.tracking || '-'} / ${d.comercio || '-'}): LD="${d.lightdata_status}" vs WD="${d.woodelivery_status}" [chofer: ${d.driver || '-'}] ${d.notes ? '— ' + d.notes : ''}`);
    });
  }
  console.log('==========================================================');

  if (!DRY_RUN && dbErrors > 0 && dbUpserted === 0) {
    process.exit(1);
  }
}

syncWooDelivery();
