const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// 1. Cargar variables de entorno desde .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf-8');
  envConfig.split(/\r?\n/).forEach(line => {
    if (!line || line.startsWith('#')) return;
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      const value = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
      process.env[key.trim()] = value;
    }
  });
}

// Configuración
const BLUEX_USERNAME = process.env.BLUEX_USERNAME || '';
const BLUEX_PASSWORD = process.env.BLUEX_PASSWORD || '';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const STATE_FILE = path.join(__dirname, 'bluex_state.json');
const TARGET_URL = 'https://app.bluex.cl/dashboard';
const BLUEX_API_KEY = '7O0lIbXZCz4nvm5rgNLNf3ZsJk2CM5KW2U1ZXVQp';
const BLUEX_API_BASE = 'https://b2cc2x.api.blue.cl';

// Si se provee la sesión en variable de entorno (ej: GitHub Secrets BLUEX_STATE_JSON)
if (process.env.BLUEX_STATE_JSON && !fs.existsSync(STATE_FILE)) {
  try {
    fs.writeFileSync(STATE_FILE, process.env.BLUEX_STATE_JSON, 'utf-8');
    console.log('📂 Sesión cargada desde secreto de entorno BLUEX_STATE_JSON.');
  } catch (e) {
    console.warn('⚠️ No se pudo escribir BLUEX_STATE_JSON:', e.message);
  }
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ ERROR: La variable de entorno SUPABASE_SERVICE_ROLE_KEY no está configurada.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Homologa el estado o macroestado de Blue Express a los estados internos del WMS
 */
function mapBlueXStatusToWms(macroStateStr) {
  if (!macroStateStr) return null;
  const s = macroStateStr.trim().toUpperCase();

  if (
    (s.includes('DELIVERED') || s.includes('ENTREGAD') || s.includes('EXITOS')) &&
    !s.includes('NO ENTREGAD') &&
    !s.includes('FALLID') &&
    !s.includes('RECHAZAD') &&
    !s.includes('REMITENTE') &&
    !s.includes('DEVUEL') &&
    !s.includes('ORIGEN') &&
    !s.includes('DISPONIBLE PARA RETIRO')
  ) {
    return 'entregado';
  }
  if (s.includes('TRANSIT') || s.includes('RUTA') || s.includes('REPARTO') || s.includes('CAMINO') || s.includes('DISTRIBUCION') || s.includes('DISPONIBLE PARA RETIRO')) {
    return 'en tránsito';
  }
  if (s.includes('PICKUP') || s.includes('CREAD') || s.includes('EMITID') || s.includes('INGRESAD') || s.includes('RECEPCION') || s.includes('PROCESANDO')) {
    return 'preparado';
  }
  if (s.includes('CANCEL') || s.includes('ANULAD')) {
    return 'cancelado';
  }
  if (s.includes('FAIL') || s.includes('FALLID') || s.includes('NO ENTREGAD') || s.includes('DEVUELT') || s.includes('SINIESTRO') || s.includes('INCIDENCIA')) {
    return 'incidencia';
  }
  return null;
}

/**
 * Formatea una fecha como YYYY-MM-DD
 */
function formatDateISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Genera candidatos de búsqueda para vincular con las órdenes del WMS
 */
function buildOrderCandidates(osNumber, reference, receiverName) {
  const candidates = new Set();
  [osNumber, reference].forEach(val => {
    if (!val) return;
    const s = String(val).trim();
    if (!s) return;
    candidates.add(s);

    if (s.includes('#')) {
      candidates.add(s.replace(/#/g, ''));
    } else {
      candidates.add(`#${s}`);
    }

    const matchSiglaNum = s.match(/^([a-zA-Z]+)(\d+)$/);
    if (matchSiglaNum) {
      candidates.add(`${matchSiglaNum[1]}#${matchSiglaNum[2]}`);
      candidates.add(matchSiglaNum[2]);
    }

    const matchSiglaHashNum = s.match(/^([a-zA-Z]+)#(\d+)$/);
    if (matchSiglaHashNum) {
      candidates.add(`${matchSiglaHashNum[1]}${matchSiglaHashNum[2]}`);
      candidates.add(matchSiglaHashNum[2]);
    }
  });

  if (receiverName) {
    const r = String(receiverName).trim();
    // 1. Buscar si contiene almohadilla con número (ej: #6536)
    const hashMatch = r.match(/#(\d+)/);
    if (hashMatch) {
      candidates.add(`#${hashMatch[1]}`);
      candidates.add(hashMatch[1]);
    }

    // 2. Buscar si contiene SIGLA + NUMEROS (ej: B4L1672)
    const siglaNumMatch = r.match(/\b([a-zA-Z]{2,6})(\d{3,7})\b/);
    if (siglaNumMatch) {
      const sigla = siglaNumMatch[1].toUpperCase();
      const num = siglaNumMatch[2];
      candidates.add(`${sigla}${num}`);
      candidates.add(`${sigla}#${num}`);
      candidates.add(`#${num}`);
      candidates.add(num);
    }

    // 3. Buscar número aislado al final o entre espacios de 4 a 7 dígitos (ej: "Cristina Valdebenito 6549")
    const numMatches = r.match(/\b(\d{4,7})\b/g);
    if (numMatches) {
      numMatches.forEach(n => {
        candidates.add(n);
        candidates.add(`#${n}`);
      });
    }
  }

  return Array.from(candidates).filter(Boolean);
}

/**
 * Función principal de sincronización
 */
async function syncBlueExpress() {
  console.log('====================================================');
  console.log('🔄 Iniciando Sincronización Blue Express -> WMS STOCKA');
  console.log('====================================================');

  // Procesar argumentos de fecha (por defecto últimos 30 días)
  const args = process.argv.slice(2);
  let daysBack = 30;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days' && args[i + 1]) {
      daysBack = parseInt(args[i + 1], 10) || 30;
    }
  }

  // Consultar pedidos activos con tracking fijado explícitamente para monitoreo BlueX
  console.log('📌 Consultando trackings fijados con monitoreo BlueX en Supabase...');
  const pinnedOrdersByTracking = new Map();
  let totalPinnedOrders = 0;
  try {
    const { data: pinnedRows, error: pinnedErr } = await supabase
      .from('orders')
      .select('id, status, estado_wms, created_at, external_order_number, tracking_number, tracking_url, courier, bluex_status, comercio, categoria_entrega, raw_shopify_data')
      .in('estado_wms', ['En procesamiento', 'En preparación', 'Pickeado', 'Despachado', 'Incidencia'])
      .eq('raw_shopify_data->wms_forced_tracking->>sync_platform', 'bluex');

    if (pinnedErr) {
      console.warn('⚠️ Aviso consultando trackings fijados BlueX:', pinnedErr.message);
    } else if (pinnedRows && pinnedRows.length > 0) {
      const nowMs = Date.now();
      for (const ord of pinnedRows) {
        if (String(ord.categoria_entrega || '').toUpperCase().trim() === 'RETIRO') continue;
        const ft = ord.raw_shopify_data?.wms_forced_tracking;
        if (!ft || !ft.active) continue;
        const trk = String(ft?.tracking_number || ord.tracking_number || '').trim();
        if (!trk) continue;
        const key = trk.toUpperCase();
        if (!pinnedOrdersByTracking.has(key)) pinnedOrdersByTracking.set(key, []);
        pinnedOrdersByTracking.get(key).push(ord);
        totalPinnedOrders++;

        // Expandir ventana de fechas automáticamente si hay pedidos fijados más antiguos que daysBack
        if (ord.created_at) {
          const ageDays = Math.ceil((nowMs - new Date(ord.created_at).getTime()) / (1000 * 60 * 60 * 24));
          if (ageDays + 15 > daysBack) {
            daysBack = Math.min(120, ageDays + 15);
          }
        }
      }
    }
    console.log(`📌 ${totalPinnedOrders} pedido(s) activo(s) con tracking fijado BlueX (${pinnedOrdersByTracking.size} guía(s) única(s)).`);
  } catch (e) {
    console.warn('⚠️ Excepción consultando trackings fijados BlueX:', e.message);
  }

  const now = new Date();
  const startDateObj = new Date();
  startDateObj.setDate(now.getDate() - daysBack);
  const endDateObj = new Date();
  endDateObj.setDate(now.getDate() + 1); // +1 día para cubrir todo el día actual

  const startDate = formatDateISO(startDateObj);
  const endDate = formatDateISO(endDateObj);

  console.log(`📅 Rango de consulta: ${startDate} a ${endDate} (últimos ${daysBack} días)`);

  // Cargar configuración de comercios para mapeo
  console.log('📡 Consultando comercios registrados en Supabase...');
  const { data: configRows } = await supabase
    .from('v_comercios_config')
    .select('sigla, nombre');

  const configMap = {};
  if (configRows) {
    configRows.forEach(r => {
      if (r.sigla && r.nombre) {
        configMap[r.sigla.trim().toUpperCase()] = r.nombre.trim();
      }
    });
    console.log(`✅ ${Object.keys(configMap).length} comercios cargados para vinculación.`);
  }

  // Iniciar Playwright
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
    console.log('⚠️ No se encontró bluex_state.json. Iniciando contexto nuevo.');
    context = await browser.newContext();
  }

  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });

  let allEmissions = [];
  let querySucceeded = false;

  try {
    console.log(`🌐 Navegando a ${TARGET_URL}...`);
    await page.goto(TARGET_URL, { timeout: 45000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    let currentUrl = page.url();

    // Si redirige a login y tenemos credenciales en .env, intentar login automático (soporta flujo 1 y 2 pasos en login.blue.cl)
    if (currentUrl.includes('login.blue.cl') || currentUrl.includes('/login')) {
      console.log('🔐 Sesión no activa o expirada.');
      if (BLUEX_USERNAME && BLUEX_PASSWORD) {
        console.log(`🔑 Intentando autenticación con usuario: ${BLUEX_USERNAME}...`);
        try {
          const emailInput = page.locator('input[type="email"], input[name="username"], input#username, input#email, input[type="text"]').first();
          await emailInput.waitFor({ state: 'visible', timeout: 20000 });
          await emailInput.fill(BLUEX_USERNAME);

          const passInput = page.locator('input[type="password"], input[name="password"], input#password').first();
          if (await passInput.isVisible({ timeout: 2500 }).catch(() => false)) {
            await passInput.fill(BLUEX_PASSWORD);
            const submitBtn = page.locator('button[type="submit"], button:has-text("Iniciar sesión"), button:has-text("Ingresar"), button:has-text("Continuar")').first();
            await submitBtn.click();
          } else {
            // Flujo de 2 pasos: primero enviar correo, luego contraseña
            const nextBtn = page.locator('button[type="submit"], button:has-text("Continuar"), button:has-text("Siguiente"), button:has-text("Ingresar")').first();
            await nextBtn.click();
            await passInput.waitFor({ state: 'visible', timeout: 15000 });
            await passInput.fill(BLUEX_PASSWORD);
            const submitBtn = page.locator('button[type="submit"], button:has-text("Iniciar sesión"), button:has-text("Ingresar"), button:has-text("Continuar")').first();
            await submitBtn.click();
          }

          console.log('⏳ Esperando redirección al dashboard...');
          await page.waitForURL('**/dashboard**', { timeout: 35000 });
          await page.waitForTimeout(3000);

          await context.storageState({ path: STATE_FILE });
          console.log('💾 ¡Sesión renovada y guardada en bluex_state.json!');
        } catch (authError) {
          console.error('❌ No se pudo completar el login automático:', authError.message);
          console.log('💡 Sugerencia: Ejecuta `node login_bluex_interactive.js` para iniciar sesión con ventana visible.');
          await browser.close();
          process.exit(1);
        }
      } else {
        console.error('❌ No hay credenciales configuradas en .env ni sesión válida en bluex_state.json.');
        console.log('👉 Ejecuta primero: node login_bluex_interactive.js');
        await browser.close();
        process.exit(1);
      }
    }

    // Extraer token JWT de la sesión activa
    console.log('🔍 Extrayendo token de sesión...');
    const tokenData = await page.evaluate(() => {
      const rawAccessToken = localStorage.getItem('__accessToken');
      const rawUser = localStorage.getItem('__sessionUser');

      let token = null;
      if (rawAccessToken) {
        try {
          const decoded = atob(rawAccessToken);
          try {
            token = JSON.parse(decoded);
          } catch (e) {
            token = decoded;
          }
        } catch (e) {
          token = rawAccessToken;
        }
      }

      let user = null;
      if (rawUser) {
        try {
          user = JSON.parse(atob(rawUser));
        } catch (e) {}
      }

      return { token, user };
    });

    const accessToken = typeof tokenData.token === 'string' ? tokenData.token : (tokenData.token?.token || tokenData.token?.accessToken || null);

    if (!accessToken) {
      console.warn('⚠️ No se detectó __accessToken en localStorage directamente. Intentando consulta mediante contexto de página...');
    } else {
      console.log('🔑 Token de acceso obtenido con éxito.');
    }

    if (tokenData.user) {
      console.log(`👤 Usuario en sesión: ${tokenData.user.email || tokenData.user.name || 'OK'}`);
    }

    // Consultar pedidos a la API interna de Blue Express con paginación
    console.log('\n📥 Consultando pedidos en la API de Blue Express...');
    let pageNum = 1;
    const pageSize = 50;
    let hasMore = true;
    let totalItems = 0;

    while (hasMore) {
      console.log(`📄 Obteniendo página ${pageNum} (${pageSize} registros por página)...`);

      // Ejecutar la petición desde el contexto de la página (aprovechando origen y cookies)
      const pageResult = await page.evaluate(async ({ apiBase, apiKey, token, pNum, pSize, sDate, eDate }) => {
        const url = `${apiBase}/b2cc2x/svc/emissions-core/v2/private/emission?page=${pNum}&pageSize=${pSize}&startDate=${sDate}&endDate=${eDate}`;
        const headers = {
          'x-api-key': apiKey,
          'Content-Type': 'application/json'
        };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch(url, { method: 'GET', headers });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          return { error: `HTTP ${res.status}: ${errText}`, status: res.status };
        }
        const data = await res.json();
        return { data, status: res.status };
      }, {
        apiBase: BLUEX_API_BASE,
        apiKey: BLUEX_API_KEY,
        token: accessToken,
        pNum: pageNum,
        pSize: pageSize,
        sDate: startDate,
        eDate: endDate
      });

      if (pageResult.error) {
        console.error(`❌ Error en consulta de página ${pageNum}:`, pageResult.error);
        break;
      }

      const emissionsData = pageResult.data?.emissions || [];
      const pagination = pageResult.data?.pagination || {};
      totalItems = pagination.total || totalItems;

      if (emissionsData.length === 0) {
        hasMore = false;
      } else {
        allEmissions = allEmissions.concat(emissionsData);
        console.log(`   ↳ Recibidos ${emissionsData.length} envíos. (Total acumulado: ${allEmissions.length})`);

        if (pagination.pageCount && pageNum >= pagination.pageCount) {
          hasMore = false;
        } else if (emissionsData.length < pageSize) {
          hasMore = false;
        } else {
          pageNum++;
          await page.waitForTimeout(500); // Pequeña pausa de cortesía
        }
      }
    }

    console.log(`\n📊 Total de envíos recuperados desde Blue Express: ${allEmissions.length}`);
    querySucceeded = true;

    // Si todo fue bien, actualizar bluex_state.json
    await context.storageState({ path: STATE_FILE });

  } catch (error) {
    console.error('❌ Error durante la navegación o consulta en Blue Express:', error);
  } finally {
    await browser.close();
  }

  const checkedAtIso = new Date().toISOString();
  const foundPinnedOrderIds = new Set();

  if (allEmissions.length === 0) {
    console.log('ℹ️ No se encontraron envíos generados en el rango de fechas consultado.');
    if (querySucceeded && pinnedOrdersByTracking.size > 0) {
      for (const [, ordList] of pinnedOrdersByTracking.entries()) {
        for (const ord of ordList) {
          const baseRaw = (ord.raw_shopify_data && typeof ord.raw_shopify_data === 'object') ? { ...ord.raw_shopify_data } : {};
          if (baseRaw.wms_forced_tracking) {
            baseRaw.wms_forced_tracking = {
              ...baseRaw.wms_forced_tracking,
              last_checked_at: checkedAtIso,
              last_check_found: false
            };
            await supabase.from('orders').update({ raw_shopify_data: baseRaw }).eq('id', ord.id);
          }
        }
      }
    }
    return;
  }

  // ==========================================
  // PROCESAMIENTO Y ACTUALIZACIÓN EN SUPABASE
  // ==========================================
  console.log('\n====================================================');
  console.log('⚡ Procesando y vinculando pedidos con WMS STOCKA...');
  console.log('====================================================');

  const upsertBluexList = [];
  const upsertUnificadosList = [];
  const pendingStatusTransitions = [];
  let updatedOrdersCount = 0;
  let updatedPinnedCount = 0;

  for (const item of allEmissions) {
    const osNumber = String(item.os || '').trim();
    if (!osNumber) continue;

    const trackingUrl = `https://tracking-unificado.blue.cl/?n_seguimiento=${osNumber}`;
    const labelUrl = item.metadata?.labelUrl || null;
    const macroState = item.metadata?.macroState || 'CREADO';
    const wmsStatus = mapBlueXStatusToWms(macroState);
    const emitterName = item.emitter?.name || null;
    const receiverName = item.receiver?.name || null;
    const receiverPhone = item.receiver?.phone || item.receiver?.phone_number || null;
    const commune = item.destination?.commune?.name || (item.destination?.commune?.code ? String(item.destination?.commune?.code) : null);
    const region = item.destination?.region?.name || (item.destination?.region?.code ? String(item.destination?.region?.code) : null);
    const address = item.destination?.address || null;
    const amount = typeof item.shipping?.amount === 'number' ? item.shipping.amount : null;
    const paymentMethod = item.shipping?.paymentMethod || null;
    const dateStr = item.date || null;

    // Intentar resolver comercio por nombre emisor o sigla
    let resolvedComercio = emitterName;
    if (emitterName) {
      const upperName = emitterName.toUpperCase();
      for (const [sigla, nom] of Object.entries(configMap)) {
        if (upperName.includes(sigla) || upperName.includes(nom.toUpperCase())) {
          resolvedComercio = nom;
          break;
        }
      }
    }

    // Determinar el estado global (AutoTrack) y estado detallado UI
    let globalStatus = 'SIN MOVIMIENTO';
    let uiGlobalStatus = 'SIN MOVIMIENTO';
    const upperState = macroState.toUpperCase();
    if (wmsStatus === 'entregado') {
      globalStatus = 'DESPACHADO';
      uiGlobalStatus = 'ENTREGADO';
    } else if (upperState.includes('TRANSIT') || upperState.includes('DELIVER') || upperState.includes('OUT_FOR_DELIVERY') || upperState.includes('REPARTO') || upperState.includes('RUTA') || upperState.includes('ENTREGAD') || upperState.includes('DISPONIBLE PARA RETIRO')) {
      globalStatus = 'DESPACHADO';
      uiGlobalStatus = 'EN TRÁNSITO';
    } else if (upperState.includes('PICKUP') || upperState.includes('PREPARATION') || upperState.includes('CREAD') || upperState.includes('EMITID')) {
      globalStatus = 'SIN MOVIMIENTO';
      uiGlobalStatus = 'SIN MOVIMIENTO';
    } else if (upperState.includes('CANCEL') || upperState.includes('FAIL') || upperState.includes('INCIDENCIA') || upperState.includes('NO ENTREGAD')) {
      globalStatus = 'ALERTA';
      uiGlobalStatus = 'ALERTA';
    }

    // --- Vinculación con pedidos en la tabla orders ---
    // Prioridad 1: Pedidos que fijaron explícitamente este tracking para monitoreo en BlueX
    const pinnedMatches = pinnedOrdersByTracking.get(osNumber.toUpperCase()) || [];
    let matchedOrders = [...pinnedMatches];

    // Prioridad 2: Búsqueda automática por candidatos (respetando si el pedido ya tiene OTRO tracking fijado)
    if (matchedOrders.length === 0) {
      const candidates = buildOrderCandidates(osNumber, item.metadata?.reference || item.reference, receiverName);
      if (candidates.length > 0) {
        const filterStr = candidates.map(c => `"${c}"`).join(',');
        const { data: directOrders } = await supabase
          .from('orders')
          .select('id, status, estado_wms, external_order_number, tracking_number, tracking_url, courier, bluex_status, comercio, categoria_entrega, raw_shopify_data')
          .or(`tracking_number.in.(${filterStr}),external_order_number.in.(${filterStr})`);

        if (directOrders && directOrders.length > 0) {
          const validCandidate = directOrders.find(o => {
            if (String(o.categoria_entrega || '').toUpperCase().trim() === 'RETIRO') return false;
            const ft = o.raw_shopify_data?.wms_forced_tracking;
            if (ft && ft.active && ft.tracking_number && String(ft.tracking_number).trim().toUpperCase() !== osNumber.toUpperCase()) {
              return false; // No pisar un pedido que tiene otro tracking forzado distinto
            }
            return true;
          });
          if (validCandidate) matchedOrders.push(validCandidate);
        }
      }
    }

    const primaryOrder = matchedOrders[0] || null;
    if (primaryOrder && primaryOrder.comercio) {
      resolvedComercio = primaryOrder.comercio;
    }

    // Registro para la tabla bluex_envios
    const bluexRecord = {
      id: osNumber,
      tracking: osNumber,
      tracking_url: trackingUrl,
      label_url: labelUrl,
      courier: 'BLUEXPRESS',
      status: macroState,
      comercio: resolvedComercio,
      pyme_name: emitterName,
      nombre_destinatario: receiverName,
      telefono_destino: receiverPhone,
      direccion_destino: address,
      comuna_destino: commune,
      region_destino: region,
      valor_envio: amount,
      medio_pago: paymentMethod,
      fecha_creacion_bluex: dateStr ? new Date(dateStr).toISOString() : null,
      raw_data: item,
      updated_at: checkedAtIso
    };
    upsertBluexList.push(bluexRecord);

    // Si el pedido primario ya está cerrado en 'Entregado' o es 'Listo para retiro' / RETIRO, continuar tras registrar bluex_envios
    const openMatchedOrders = matchedOrders.filter(o =>
      !['Entregado', 'Listo para retiro'].includes(o.estado_wms) &&
      String(o.categoria_entrega || '').toUpperCase().trim() !== 'RETIRO'
    );
    if (matchedOrders.length > 0 && openMatchedOrders.length === 0) {
      continue;
    }

    // Registro para la tabla unificada de AutoTrack
    const unificadoRecord = {
      id: `bluex_envios:${osNumber}`,
      source_table: 'bluex_envios',
      source_id: osNumber,
      empresa_comercio_proveedor: resolvedComercio,
      tracking: osNumber,
      tracking_url: trackingUrl,
      courier: 'BLUEXPRESS',
      status: macroState,
      global_status: globalStatus,
      servicio_tipo_envio: 'ESTÁNDAR',
      nombre_destinatario: receiverName,
      telefono_destino: receiverPhone,
      direccion_destino: address,
      comuna_destino: commune,
      pedido_referencia: primaryOrder?.external_order_number || osNumber,
      created_at: dateStr ? new Date(dateStr).toISOString() : checkedAtIso,
      updated_at: checkedAtIso
    };
    upsertUnificadosList.push(unificadoRecord);

    // Fase 1 en orders: guardar metadatos de BlueX y estado actualizado de wms_forced_tracking ANTES del cierre inmutable
    for (const matchedOrder of openMatchedOrders) {
      const isPinnedTarget = pinnedMatches.some(p => p.id === matchedOrder.id);
      if (isPinnedTarget) {
        foundPinnedOrderIds.add(matchedOrder.id);
        console.log(`   📌 [BlueX Fijado] Pedido ${matchedOrder.external_order_number || matchedOrder.id} (${osNumber}) -> Estado: ${macroState} (${uiGlobalStatus})`);
      }

      const metaPayload = {
        bluex_status: macroState,
        raw_bluex_data: bluexRecord
      };

      if (!matchedOrder.tracking_number) {
        metaPayload.tracking_number = osNumber;
      }
      if (!matchedOrder.tracking_url) {
        metaPayload.tracking_url = trackingUrl;
      }
      if (matchedOrder.courier !== 'BLUEXPRESS') {
        metaPayload.courier = 'BLUEXPRESS';
      }

      const ft = matchedOrder.raw_shopify_data?.wms_forced_tracking;
      if (ft && ft.active && String(ft.tracking_number || '').trim().toUpperCase() === osNumber.toUpperCase()) {
        metaPayload.raw_shopify_data = {
          ...(matchedOrder.raw_shopify_data || {}),
          wms_forced_tracking: {
            ...ft,
            source_table: 'bluex_envios',
            status: macroState,
            global_status: uiGlobalStatus,
            last_checked_at: checkedAtIso,
            last_check_found: true,
            updated_at: checkedAtIso
          }
        };
      }

      const { error: metaErr } = await supabase
        .from('orders')
        .update(metaPayload)
        .eq('id', matchedOrder.id);

      if (!metaErr) {
        updatedOrdersCount++;
        if (isPinnedTarget) updatedPinnedCount++;
      } else {
        console.warn(`⚠️ No se pudo actualizar metadatos en orden ${matchedOrder.id}:`, metaErr.message);
      }

      if (wmsStatus === 'entregado' || wmsStatus === 'en tránsito' || globalStatus === 'DESPACHADO') {
        pendingStatusTransitions.push({ order: matchedOrder, wmsStatus, globalStatus });
      }
    }
  }

  // --- Upsert masivo en tabla bluex_envios ---
  console.log(`\n🚀 Guardando ${upsertBluexList.length} envíos en tabla 'bluex_envios'...`);
  const batchSize = 100;
  let upsertedCount = 0;

  for (let i = 0; i < upsertBluexList.length; i += batchSize) {
    const batch = upsertBluexList.slice(i, i + batchSize);
    const { error: upsertError } = await supabase
      .from('bluex_envios')
      .upsert(batch, { onConflict: 'id' });

    if (upsertError) {
      console.warn('⚠️ Error al subir lote masivo a bluex_envios, insertando uno a uno:', upsertError.message);
      for (const singleItem of batch) {
        const { error: sError } = await supabase
          .from('bluex_envios')
          .upsert([singleItem], { onConflict: 'id' });
        if (!sError) upsertedCount++;
      }
    } else {
      upsertedCount += batch.length;
    }
  }

  // --- Upsert masivo en tabla envios_unificados (AutoTrack) ---
  let unificadosCount = 0;
  if (upsertUnificadosList.length > 0) {
    console.log(`📡 Sincronizando ${upsertUnificadosList.length} registros en 'envios_unificados' para AutoTrack...`);
    for (let i = 0; i < upsertUnificadosList.length; i += batchSize) {
      const batch = upsertUnificadosList.slice(i, i + batchSize);
      const { error: uError } = await supabase
        .from('envios_unificados')
        .upsert(batch, { onConflict: 'id' });

      if (uError) {
        console.warn('ℹ️ Nota en envios_unificados (requiere ejecutar supabase_schema_bluex_unification.sql en Supabase):', uError.message);
        break;
      } else {
        unificadosCount += batch.length;
      }
    }
  }

  // --- Fase final: asegurar transición de estado_wms si el trigger no la había ejecutado aún ---
  for (const item of pendingStatusTransitions) {
    const { data: freshOrd } = await supabase
      .from('orders')
      .select('id, status, estado_wms, categoria_entrega')
      .eq('id', item.order.id)
      .maybeSingle();

    if (!freshOrd || ['Entregado', 'Listo para retiro', 'Cancelado', 'Archivado'].includes(freshOrd.estado_wms) || String(freshOrd.categoria_entrega || '').toUpperCase().trim() === 'RETIRO') continue;

    const stPayload = {};
    if (item.wmsStatus === 'entregado') {
      stPayload.status = 'entregado';
      stPayload.estado_wms = 'Entregado';
      stPayload.delivered_at = checkedAtIso;
      stPayload.closed_at = checkedAtIso;
      stPayload.closed_by_automation = 'auto-dispatch-delivered-to-entregado';
    } else if (item.wmsStatus === 'en tránsito' || item.globalStatus === 'DESPACHADO') {
      if (['para procesar', 'en preparación', 'preparado'].includes(freshOrd.status)) {
        stPayload.status = 'despachado';
      }
      if (freshOrd.estado_wms !== 'Despachado') {
        stPayload.estado_wms = 'Despachado';
      }
    }

    if (Object.keys(stPayload).length > 0) {
      await supabase.from('orders').update(stPayload).eq('id', freshOrd.id);
    }
  }

  // --- Sellar timestamp de revisión en pedidos fijados BlueX que aún no aparecen en las emisiones ---
  if (querySucceeded && pinnedOrdersByTracking.size > 0) {
    for (const [trkKey, ordList] of pinnedOrdersByTracking.entries()) {
      for (const ord of ordList) {
        if (foundPinnedOrderIds.has(ord.id)) continue;
        console.log(`   ⏳ [BlueX Fijado] Pedido ${ord.external_order_number || ord.id} (${trkKey}) consultado, aún sin registro en emisiones BlueX.`);
        const baseRaw = (ord.raw_shopify_data && typeof ord.raw_shopify_data === 'object') ? { ...ord.raw_shopify_data } : {};
        if (baseRaw.wms_forced_tracking) {
          baseRaw.wms_forced_tracking = {
            ...baseRaw.wms_forced_tracking,
            last_checked_at: checkedAtIso,
            last_check_found: false
          };
          await supabase.from('orders').update({ raw_shopify_data: baseRaw }).eq('id', ord.id);
        }
      }
    }
  }

  console.log('\n====================================================');
  console.log('✅ Sincronización completada con éxito:');
  console.log(`- Envíos registrados en bluex_envios: ${upsertedCount}`);
  console.log(`- Envíos sincronizados en envios_unificados: ${unificadosCount}`);
  console.log(`- Pedidos vinculados y actualizados en WMS orders: ${updatedOrdersCount} (fijados BlueX: ${updatedPinnedCount}/${totalPinnedOrders})`);
  console.log('====================================================\n');
}

// Ejecución
syncBlueExpress().catch(err => {
  console.error('❌ Error fatal en syncBlueExpress:', err);
  process.exit(1);
});
