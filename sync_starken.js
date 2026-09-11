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
const STARKEN_USERNAME = process.env.STARKEN_USERNAME || '';
const STARKEN_PASSWORD = process.env.STARKEN_PASSWORD || '';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const STATE_FILE = path.join(__dirname, 'starken_state.json');
const TARGET_URL = 'https://www.starkenpro.cl/';
const STARKEN_API_BASE = 'https://apiprod.starkenpro.cl';

// Si se provee la sesión en variable de entorno (ej: GitHub Secrets STARKEN_STATE_JSON)
if (process.env.STARKEN_STATE_JSON && !fs.existsSync(STATE_FILE)) {
  try {
    fs.writeFileSync(STATE_FILE, process.env.STARKEN_STATE_JSON, 'utf-8');
    console.log('📂 Sesión cargada desde secreto de entorno STARKEN_STATE_JSON.');
  } catch (e) {
    console.warn('⚠️ No se pudo escribir STARKEN_STATE_JSON:', e.message);
  }
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ ERROR: La variable de entorno SUPABASE_SERVICE_ROLE_KEY no está configurada.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Homologa el estado de Starken a los estados internos del WMS
 */
function mapStarkenStatusToWms(starkenStatus) {
  if (!starkenStatus) return null;
  const s = String(starkenStatus).trim().toUpperCase();

  if (s.includes('ENTREGAD') || s.includes('EXITOS') || s.includes('DELIVERED')) {
    return 'entregado';
  }
  if (s.includes('TRANSIT') || s.includes('DESTINO') || s.includes('REPARTO') || s.includes('RUTA') || s.includes('CAMINO') || s.includes('REDESTIN')) {
    return 'en tránsito';
  }
  if (s.includes('ORIGEN') || s.includes('CREAD') || s.includes('EMIS') || s.includes('RECEPCION') || s.includes('INGRESAD')) {
    return 'preparado';
  }
  if (s.includes('CANCEL') || s.includes('ANULAD')) {
    return 'cancelado';
  }
  if (s.includes('EXCEPCION') || s.includes('FALL') || s.includes('DEVUELT') || s.includes('SINIESTRO') || s.includes('INCIDENCIA')) {
    return 'incidencia';
  }
  return null;
}

/**
 * Determina el estado global para AutoTrack (DESPACHADO, SIN MOVIMIENTO, ALERTA)
 */
function getGlobalStatus(starkenStatus) {
  if (!starkenStatus) return 'SIN MOVIMIENTO';
  const s = String(starkenStatus).trim().toUpperCase();

  if (s.includes('TRANSIT') || s.includes('DESTINO') || s.includes('REPARTO') || s.includes('ENTREGAD') || s.includes('REDESTIN') || s.includes('RUTA') || s.includes('CAMINO')) {
    return 'DESPACHADO';
  }
  if (s.includes('ORIGEN') || s.includes('CREAD') || s.includes('EMIS') || s.includes('RECEPCION')) {
    return 'SIN MOVIMIENTO';
  }
  if (s.includes('EXCEPCION') || s.includes('CANCEL') || s.includes('ANULAD') || s.includes('FALL') || s.includes('DEVUELT') || s.includes('SINIESTRO') || s.includes('INCIDENCIA')) {
    return 'ALERTA';
  }
  return 'SIN MOVIMIENTO';
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
function buildOrderCandidates(ofNumber, documentNumber, observation, receiverName) {
  const candidates = new Set();
  [ofNumber, documentNumber, observation].forEach(val => {
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
async function syncStarkenPro() {
  console.log('====================================================');
  console.log('🔄 Iniciando Sincronización Starken Pro -> WMS STOCKA');
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
  endDateObj.setDate(now.getDate() + 1); // +1 día para asegurar todo el día actual

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
    console.log('⚠️ No se encontró starken_state.json. Iniciando contexto nuevo.');
    context = await browser.newContext();
  }

  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });

  let allShipments = [];

  try {
    console.log(`🌐 Navegando a ${TARGET_URL}...`);
    await page.goto(TARGET_URL, { timeout: 45000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    let currentUrl = page.url();

    // Si redirige a login y tenemos credenciales en .env, intentar login automático
    if (currentUrl.includes('/login')) {
      console.log('🔐 Sesión no activa o expirada.');
      if (STARKEN_USERNAME && STARKEN_PASSWORD) {
        console.log(`🔑 Intentando autenticación con usuario: ${STARKEN_USERNAME}...`);
        try {
          // Intentar primero login directo vía API interna
          const loginApiResult = await page.evaluate(async ({ apiBase, user, pass }) => {
            const cleanUser = user.trim();
            const payload = {
              user: {
                rut: cleanUser,
                email: cleanUser,
                password: pass
              }
            };
            const res = await fetch(`${apiBase}/authentication/auth/login`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => null);
            return { ok: res.ok, status: res.status, data };
          }, { apiBase: STARKEN_API_BASE, user: STARKEN_USERNAME, pass: STARKEN_PASSWORD });

          if (loginApiResult.ok && loginApiResult.data && loginApiResult.data.token) {
            console.log('✨ Autenticación API exitosa en Starken Pro.');
            await page.evaluate((d) => {
              localStorage.setItem('token', d.token);
              if (d.user) localStorage.setItem('user', JSON.stringify(d.user));
              if (d.master) localStorage.setItem('master', JSON.stringify(d.master));
            }, loginApiResult.data);
            await context.storageState({ path: STATE_FILE });
          } else {
            // Intentar por formulario web
            console.log('⚠️ Intento de API devolvió:', loginApiResult.status, 'Intentando formulario...');
            const userInput = page.locator('input[type="text"], input[name="rut"], input#rut, input[name="email"], input#email').first();
            await userInput.waitFor({ state: 'visible', timeout: 10000 });
            await userInput.fill(STARKEN_USERNAME);

            const passInput = page.locator('input[type="password"], input[name="password"], input#password').first();
            await passInput.fill(STARKEN_PASSWORD);

            const submitBtn = page.locator('button[type="submit"], button:has-text("Ingresar"), button:has-text("Iniciar sesión")').first();
            await submitBtn.click();

            await page.waitForTimeout(5000);
            await context.storageState({ path: STATE_FILE });
          }
          console.log('💾 ¡Sesión renovada y guardada en starken_state.json!');
        } catch (authError) {
          console.error('❌ No se pudo completar el login automático:', authError.message);
          console.log('💡 Sugerencia: Ejecuta `node login_starken_interactive.js` para iniciar sesión con ventana visible.');
          await browser.close();
          process.exit(1);
        }
      } else {
        console.error('❌ No hay credenciales configuradas en .env ni sesión válida en starken_state.json.');
        console.log('👉 Ejecuta primero: node login_starken_interactive.js');
        await browser.close();
        process.exit(1);
      }
    }

    // Extraer token JWT de la sesión activa
    console.log('🔍 Extrayendo token de sesión...');
    const sessionData = await page.evaluate(() => {
      const token = localStorage.getItem('token');
      const rawUser = localStorage.getItem('user');
      const rawMaster = localStorage.getItem('master');

      let user = null;
      if (rawUser) {
        try { user = JSON.parse(rawUser); } catch (e) {}
      }
      let master = null;
      if (rawMaster) {
        try { master = JSON.parse(rawMaster); } catch (e) {}
      }

      return { token, user, master };
    });

    const accessToken = sessionData.token;
    if (!accessToken) {
      console.warn('⚠️ No se detectó token en localStorage. Intentando refrescar página...');
      await page.reload();
      await page.waitForTimeout(3000);
    } else {
      console.log('🔑 Token de acceso obtenido con éxito.');
    }

    if (sessionData.user) {
      console.log(`👤 Usuario en sesión: ${sessionData.user.name || sessionData.user.full_name || sessionData.user.email || sessionData.user.rut || 'OK'}`);
      if (sessionData.user.category) {
        console.log(`🏷️ Categoría de cuenta: ${sessionData.user.category}`);
      }
    }

    // Estados clave a consultar en Starken Pro
    const statusesToQuery = [
      'ORIGEN',
      'TRANSITO',
      'DESTINO',
      'REPARTO',
      'EXCEPCIONES',
      'ENTREGADOS',
      'OTROS'
    ];

    console.log('\n📥 Consultando despachos en la API de Starken Pro...');

    const seenOfs = new Set();

    for (const statusName of statusesToQuery) {
      console.log(`🔍 Consultando estado: ${statusName}...`);

      const queryResult = await page.evaluate(async ({ apiBase, token, status, sDate, eDate }) => {
        const url = `${apiBase}/mystarken/dashboard/resumen-data?status=${encodeURIComponent(status)}&fdesde=${encodeURIComponent(sDate)}&fhasta=${encodeURIComponent(eDate)}`;
        const headers = {
          'Content-Type': 'application/json'
        };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        try {
          const res = await fetch(url, { method: 'GET', headers });
          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            return { error: `HTTP ${res.status}: ${errText}`, status: res.status };
          }
          const data = await res.json();
          return { data, status: res.status };
        } catch (err) {
          return { error: err.message };
        }
      }, {
        apiBase: STARKEN_API_BASE,
        token: accessToken,
        status: statusName,
        sDate: startDate,
        eDate: endDate
      });

      if (queryResult.error) {
        console.warn(`   ⚠️ Estado ${statusName}: ${queryResult.error}`);
        continue;
      }

      // La respuesta de resumen-data suele ser { data: [ ... ] } o un arreglo directo
      const rawList = Array.isArray(queryResult.data) ? queryResult.data : (queryResult.data?.data || queryResult.data?.response || []);
      let addedInStatus = 0;

      for (const item of rawList) {
        const ofNumber = String(item.ODFLCODIGO || item.odflcodigo || item.orden_flete || item.OF || item.id || '').trim();
        if (!ofNumber) continue;

        if (!seenOfs.has(ofNumber)) {
          seenOfs.add(ofNumber);
          item._starkenQueryStatus = statusName; // Guardar el estado bajo el cual fue consultado
          allShipments.push(item);
          addedInStatus++;
        }
      }

      console.log(`   ↳ Recibidos ${rawList.length} registros (${addedInStatus} nuevos). Total acumulado: ${allShipments.length}`);
      await page.waitForTimeout(400); // Pequeña pausa entre consultas
    }

    console.log(`\n📊 Total de envíos recuperados desde Starken Pro: ${allShipments.length}`);

    // Actualizar storageState
    await context.storageState({ path: STATE_FILE });

  } catch (error) {
    console.error('❌ Error durante la navegación o consulta en Starken Pro:', error);
  } finally {
    await browser.close();
  }

  if (allShipments.length === 0) {
    console.log('ℹ️ No se encontraron envíos generados en el rango de fechas consultado.');
    return;
  }

  // ==========================================
  // PROCESAMIENTO Y ACTUALIZACIÓN EN SUPABASE
  // ==========================================
  console.log('\n====================================================');
  console.log('⚡ Procesando y vinculando pedidos con WMS STOCKA...');
  console.log('====================================================');

  const upsertStarkenList = [];
  const upsertUnificadosList = [];
  let updatedOrdersCount = 0;

  for (const item of allShipments) {
    const ofNumber = String(item.ODFLCODIGO || item.odflcodigo || item.orden_flete || item.OF || item.id || '').trim();
    if (!ofNumber) continue;

    const trackingUrl = `https://www.starken.cl/seguimiento?codigo=${ofNumber}`;
    const status = item.ESTADO ? String(item.ESTADO).trim() : (item.estado || item._starkenQueryStatus || 'EMITIDO');
    const wmsStatus = mapStarkenStatusToWms(status);
    const globalStatus = getGlobalStatus(status);

    let docNumber = item.NUMERO_DOCUMENTO ?? item.numero_documento ?? item.orderid ?? item.ORDERID_EMISION ?? null;
    if (docNumber === 0 || docNumber === '0') docNumber = null;
    if (docNumber) docNumber = String(docNumber).trim();

    const observation = item.OBS_ANULACION || item.observacion_cliente || item.observacion || item.observaciones || null;
    let receiverName = item.DESTINATARIO || item.destinatario || item.nombre_destinatario || item.nombre || null;
    if (receiverName) receiverName = String(receiverName).trim().replace(/\s+\.$/, '');

    const receiverPhone = item.DESTINATARIO_TELEFONO || item.telefono_destinatario || item.telefono || item.phone || null;
    const address = item.DESTINATARIO_DIRECCION || item.direccion_destino || item.direccion || null;
    const commune = item.DESTINATARIO_COMUNA || item.comuna_destino || item.comuna || null;
    const city = item.CIUDAD_DESTINO || item.ciudad_destino || null;
    const agency = item.TIPO_ENTREGA === 'AGENCIA' ? (commune || 'AGENCIA') : (item.agencia_destino || item.agencia || null);
    const serviceType = item.TIPO_ENTREGA || item.TIPO_SERVICIO || item.tipo_servicio || (address ? 'DOMICILIO' : 'AGENCIA');
    const amount = typeof item.total_tarifa === 'number' ? item.total_tarifa : (parseFloat(item.TOTAL_TARIFA ?? item.total_tarifa) || null);
    const declaredValue = typeof item.valor_declarado === 'number' ? item.valor_declarado : (parseFloat(item.VALOR_DECLARADO ?? item.valor_declarado) || null);
    const emissionDate = item.FECHA_EMISION || item.fecha_emision || item.fecha_creacion || null;
    const receptionDate = item.FECHA_RECEPCION_STARKEN || item.fecha_recepcion_starken || null;
    const commitmentDate = item.FECHA_ESTIMADA_ENTREGA || item.fecha_compromiso || null;
    const pymeName = item.REMITENTE || item.remitente || item.pyme || item.razon_social || null;

    // Intentar resolver comercio emisor
    let resolvedComercio = pymeName;
    if (pymeName) {
      const upperName = pymeName.toUpperCase();
      for (const [sigla, nom] of Object.entries(configMap)) {
        if (upperName.includes(sigla) || upperName.includes(nom.toUpperCase())) {
          resolvedComercio = nom;
          break;
        }
      }
    }

    // Registro para la tabla starken_envios
    const starkenRecord = {
      id: ofNumber,
      tracking: ofNumber,
      tracking_url: trackingUrl,
      label_url: item.imprimir_etiqueta || null,
      courier: 'STARKEN',
      status: status,
      comercio: resolvedComercio,
      pyme_name: pymeName,
      nombre_destinatario: receiverName,
      telefono_destino: receiverPhone,
      direccion_destino: address,
      comuna_destino: commune,
      ciudad_destino: city,
      agencia_destino: agency,
      tipo_servicio: serviceType,
      valor_envio: amount,
      valor_declarado: declaredValue,
      numero_documento: docNumber,
      fecha_emision_starken: emissionDate ? new Date(emissionDate).toISOString() : null,
      fecha_recepcion_starken: receptionDate ? new Date(receptionDate).toISOString() : null,
      fecha_compromiso: commitmentDate ? new Date(commitmentDate).toISOString() : null,
      raw_data: item,
      updated_at: new Date().toISOString()
    };
    upsertStarkenList.push(starkenRecord);

    // --- Vinculación con pedidos en la tabla orders ---
    const candidates = buildOrderCandidates(ofNumber, docNumber, observation, receiverName);
    let matchedOrder = null;

    if (candidates.length > 0) {
      const filterStr = candidates.map(c => `"${c}"`).join(',');
      const { data: directOrders } = await supabase
        .from('orders')
        .select('id, status, external_order_number, tracking_number, courier, starken_status, comercio')
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
          .select('id, status, external_order_number, tracking_number, courier, starken_status, comercio')
          .ilike('customer_phone', `%${last8}`);

        if (resolvedComercio) {
          phoneQuery = phoneQuery.eq('comercio', resolvedComercio);
        }

        const { data: phoneOrders } = await phoneQuery;
        if (phoneOrders && phoneOrders.length > 0) {
          matchedOrder = phoneOrders[0];
        }
      }
    }

    // Si se encontró la orden en el WMS, adoptar el comercio real de la orden
    if (matchedOrder && matchedOrder.comercio) {
      resolvedComercio = matchedOrder.comercio;
      starkenRecord.comercio = matchedOrder.comercio;
    }

    // Registro para la tabla unificada de AutoTrack (envios_unificados)
    const unificadoRecord = {
      id: `starken_envios:${ofNumber}`,
      source_table: 'starken_envios',
      source_id: ofNumber,
      empresa_comercio_proveedor: resolvedComercio,
      tracking: ofNumber,
      tracking_url: trackingUrl,
      courier: 'STARKEN',
      status: status,
      global_status: globalStatus,
      servicio_tipo_envio: serviceType || 'ESTÁNDAR',
      nombre_destinatario: receiverName,
      telefono_destino: receiverPhone,
      direccion_destino: address,
      comuna_destino: commune,
      pedido_referencia: matchedOrder?.external_order_number || docNumber || ofNumber,
      created_at: emissionDate ? new Date(emissionDate).toISOString() : new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    upsertUnificadosList.push(unificadoRecord);

    // Actualizar pedido en WMS si hubo coincidencia
    if (matchedOrder) {
      const updatePayload = {
        starken_status: status,
        raw_starken_data: starkenRecord
      };

      if (!matchedOrder.tracking_number) {
        updatePayload.tracking_number = ofNumber;
      }
      if (!matchedOrder.tracking_url) {
        updatePayload.tracking_url = trackingUrl;
      }
      if (matchedOrder.courier !== 'STARKEN') {
        updatePayload.courier = 'STARKEN';
      }

      // Si Starken reporta movimiento activo (DESPACHADO) y la orden está en estado previo, avanzar a 'despachado'
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

  // --- Upsert masivo en tabla starken_envios ---
  console.log(`\n🚀 Guardando ${upsertStarkenList.length} envíos en tabla 'starken_envios'...`);
  const batchSize = 100;
  let upsertedCount = 0;

  for (let i = 0; i < upsertStarkenList.length; i += batchSize) {
    const batch = upsertStarkenList.slice(i, i + batchSize);
    const { error: upsertError } = await supabase
      .from('starken_envios')
      .upsert(batch, { onConflict: 'id' });

    if (upsertError) {
      console.warn('⚠️ Error al subir lote masivo a starken_envios, insertando uno a uno:', upsertError.message);
      for (const singleItem of batch) {
        const { error: sError } = await supabase
          .from('starken_envios')
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
        console.warn('ℹ️ Nota en envios_unificados (asegúrate de haber ejecutado supabase_schema_starken_unification.sql en Supabase):', uError.message);
        break;
      } else {
        unificadosCount += batch.length;
      }
    }
  }

  console.log('\n====================================================');
  console.log('✅ Sincronización completada con éxito:');
  console.log(`- Envíos registrados en starken_envios: ${upsertedCount}`);
  console.log(`- Pedidos vinculados y actualizados en WMS orders: ${updatedOrdersCount}`);
  console.log('====================================================\n');
}

// Ejecución
syncStarkenPro().catch(err => {
  console.error('❌ Error fatal en syncStarkenPro:', err);
  process.exit(1);
});
