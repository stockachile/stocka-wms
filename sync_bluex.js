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

  if (s.includes('DELIVERED') || s.includes('ENTREGAD') || s.includes('EXITOS')) {
    return 'entregado';
  }
  if (s.includes('TRANSIT') || s.includes('RUTA') || s.includes('REPARTO') || s.includes('CAMINO') || s.includes('DISTRIBUCION')) {
    return 'en tránsito';
  }
  if (s.includes('PICKUP') || s.includes('CREAD') || s.includes('EMITID') || s.includes('INGRESAD') || s.includes('RECEPCION') || s.includes('PROCESANDO')) {
    return 'preparado';
  }
  if (s.includes('CANCEL') || s.includes('ANULAD')) {
    return 'cancelado';
  }
  if (s.includes('FAIL') || s.includes('FALLID') || s.includes('DEVUELT') || s.includes('SINIESTRO') || s.includes('INCIDENCIA')) {
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

  try {
    console.log(`🌐 Navegando a ${TARGET_URL}...`);
    await page.goto(TARGET_URL, { timeout: 45000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    let currentUrl = page.url();

    // Si redirige a login y tenemos credenciales en .env, intentar login automático
    if (currentUrl.includes('login.blue.cl') || currentUrl.includes('/login')) {
      console.log('🔐 Sesión no activa o expirada.');
      if (BLUEX_USERNAME && BLUEX_PASSWORD) {
        console.log(`🔑 Intentando autenticación con usuario: ${BLUEX_USERNAME}...`);
        try {
          const emailInput = page.locator('input[type="email"], input[name="username"], input#username, input#email').first();
          await emailInput.waitFor({ state: 'visible', timeout: 10000 });
          await emailInput.fill(BLUEX_USERNAME);

          const passInput = page.locator('input[type="password"], input[name="password"], input#password').first();
          await passInput.fill(BLUEX_PASSWORD);

          const submitBtn = page.locator('button[type="submit"], button:has-text("Iniciar sesión"), button:has-text("Ingresar")').first();
          await submitBtn.click();

          console.log('⏳ Esperando redirección al dashboard...');
          await page.waitForURL('**/dashboard', { timeout: 30000 });
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

    // Si todo fue bien, actualizar bluex_state.json
    await context.storageState({ path: STATE_FILE });

  } catch (error) {
    console.error('❌ Error durante la navegación o consulta en Blue Express:', error);
  } finally {
    await browser.close();
  }

  if (allEmissions.length === 0) {
    console.log('ℹ️ No se encontraron envíos generados en el rango de fechas consultado.');
    return;
  }

  // ==========================================
  // PROCESAMIENTO Y ACTUALIZACIÓN EN SUPABASE
  // ==========================================
  console.log('\n====================================================');
  console.log('⚡ Procesando y vinculando pedidos con WMS STOCKA...');
  console.log('====================================================');

  const upsertBluexList = [];
  let updatedOrdersCount = 0;

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
      updated_at: new Date().toISOString()
    };
    upsertBluexList.push(bluexRecord);

    // --- Vinculación con pedidos en la tabla orders ---
    const candidates = buildOrderCandidates(osNumber, item.metadata?.reference || item.reference, receiverName);
    let matchedOrder = null;

    if (candidates.length > 0) {
      const filterStr = candidates.map(c => `"${c}"`).join(',');
      const { data: directOrders } = await supabase
        .from('orders')
        .select('id, status, external_order_number, tracking_number, courier, bluex_status, comercio')
        .or(`tracking_number.in.(${filterStr}),external_order_number.in.(${filterStr})`);

      if (directOrders && directOrders.length > 0) {
        matchedOrder = directOrders[0];
      }
    }

    // Fallback por teléfono destinatario (últimos 8 dígitos) si no hubo coincidencia directa
    if (!matchedOrder && receiverPhone) {
      const cleanPhone = String(receiverPhone).replace(/[^0-9]/g, '');
      if (cleanPhone.length >= 8) {
        const last8 = cleanPhone.slice(-8);
        let phoneQuery = supabase
          .from('orders')
          .select('id, status, external_order_number, tracking_number, courier, bluex_status, comercio')
          .ilike('customer_phone', `%${last8}`);

        if (resolvedComercio) {
          phoneQuery = phoneQuery.eq('comercio', resolvedComercio);
        }

        const { data: phoneOrders } = await phoneQuery;
        if (phoneOrders && phoneOrders.length > 0) {
          matchedOrder = phoneOrders[0];
        }
      }
    // Si se encontró la orden en el WMS, adoptar el comercio real de la orden para que coincida en AutoTrack y filtros
    if (matchedOrder && matchedOrder.comercio) {
      resolvedComercio = matchedOrder.comercio;
      bluexRecord.comercio = matchedOrder.comercio;
    }

    // Determinar el estado global (AutoTrack)
    let globalStatus = 'SIN MOVIMIENTO';
    const upperState = macroState.toUpperCase();
    if (upperState.includes('TRANSIT') || upperState.includes('DELIVER') || upperState.includes('OUT_FOR_DELIVERY') || upperState.includes('REPARTO') || upperState.includes('RUTA') || upperState.includes('ENTREGAD')) {
      globalStatus = 'DESPACHADO';
    } else if (upperState.includes('PICKUP') || upperState.includes('PREPARATION') || upperState.includes('CREAD') || upperState.includes('EMITID')) {
      globalStatus = 'SIN MOVIMIENTO';
    } else if (upperState.includes('CANCEL') || upperState.includes('FAIL') || upperState.includes('INCIDENCIA')) {
      globalStatus = 'ALERTA';
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
      pedido_referencia: matchedOrder?.external_order_number || osNumber,
      created_at: dateStr ? new Date(dateStr).toISOString() : new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    upsertUnificadosList.push(unificadoRecord);

    // Actualizar pedido en WMS si hubo coincidencia
    if (matchedOrder) {
      const updatePayload = {
        bluex_status: macroState,
        raw_bluex_data: bluexRecord
      };

      if (!matchedOrder.tracking_number) {
        updatePayload.tracking_number = osNumber;
      }
      if (!matchedOrder.tracking_url) {
        updatePayload.tracking_url = trackingUrl;
      }
      if (matchedOrder.courier !== 'BLUEXPRESS') {
        updatePayload.courier = 'BLUEXPRESS';
      }

      // Si Blue Express reporta movimiento activo (DESPACHADO) y la orden está en estado previo, avanzar a 'despachado'
      if (globalStatus === 'DESPACHADO' && ['para procesar', 'en preparación', 'preparado'].includes(matchedOrder.status)) {
        updatePayload.status = 'despachado';
      }

      const { error: updateError } = await supabase
        .from('orders')
        .update(updatePayload)
        .eq('id', matchedOrder.id);

      if (!updateError) {
        updatedOrdersCount++;
      } else {
        console.warn(`⚠️ No se pudo actualizar orden ${matchedOrder.id}:`, updateError.message);
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

  console.log('\n====================================================');
  console.log('✅ Sincronización completada con éxito:');
  console.log(`- Envíos registrados en bluex_envios: ${upsertedCount}`);
  console.log(`- Pedidos vinculados y actualizados en WMS orders: ${updatedOrdersCount}`);
  console.log('====================================================\n');
}

// Ejecución
syncBlueExpress().catch(err => {
  console.error('❌ Error fatal en syncBlueExpress:', err);
  process.exit(1);
});
