/**
 * WMS STOCKA - Agente Guardián de Salud de Integraciones (Healthcheck & Auto-Healer)
 *
 * Ejecuta una auditoría preventiva y auto-reparación sobre todas las integraciones activas:
 * 1. Conectividad API y validación de credenciales / tokens (con User-Agent anti-bloqueo WAF/Cloudflare).
 * 2. Verificación y auto-reactivación de Webhooks desactivados o pausados (WooCommerce, Jumpseller, Tiendanube, Shopify).
 * 3. Reconciliación Tienda vs. WMS (últimas 72h):
 *    - Reactiva pedidos pagados en tienda que hayan quedado como 'Cancelado' en WMS (caso pago fallido -> pagado).
 *    - Corrige order_items sin bodega asignada o con bodega distinta a default_warehouse_id.
 *    - Detecta pedidos pagados en tienda (>45 min) que falten en el WMS o no tengan order_items y dispara re-sincronización.
 * 4. Actualiza last_sync_at y last_sync_error en merchant_integrations (alimentando el Radar de Comercios y Centro de Integraciones).
 * 5. Envía reporte ejecutivo por correo (Brevo) cuando detecta fallas críticas, aplica auto-reparaciones o en el resumen matutino.
 */

const { createClient } = require('@supabase/supabase-js');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ==========================================
// 1. CARGAR ARCHIVO .ENV LOCALMENTE
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

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID || 'd3dc79b2f5caf3ca7adebe3feb02d86e';
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || '';
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const ALERT_TO_EMAIL = process.env.ALERT_TO_EMAIL || 'stockachile@gmail.com';

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ ERROR: La variable de entorno SUPABASE_SERVICE_ROLE_KEY no está configurada.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const ESTADOS_WMS_PROTEGIDOS = ['en preparación', 'pickeado', 'despachado', 'incidencia', 'entregado', 'retirado', 'archivado'];

// ==========================================
// 2. UTILIDADES DE RED Y CORREO
// ==========================================
async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function sendGuardianEmailReport(subject, htmlContent) {
  if (!BREVO_API_KEY) {
    console.log('ℹ️ BREVO_API_KEY no configurada. Se omite envío de correo.');
    return;
  }

  try {
    const res = await fetchWithTimeout('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: 'Guardián WMS STOCKA', email: 'no-reply@stocka.cl' },
        to: [{ email: ALERT_TO_EMAIL, name: 'Operaciones Stocka' }],
        subject,
        htmlContent
      })
    }, 15000);

    if (!res.ok) {
      const errText = await res.text();
      console.error(`⚠️ Error enviando reporte por Brevo: ${res.status} - ${errText}`);
    } else {
      console.log(`✉️ Reporte del Guardián enviado a ${ALERT_TO_EMAIL}`);
    }
  } catch (err) {
    console.error('⚠️ Excepción enviando correo Brevo:', err.message);
  }
}

function buildMiraklSignedUrl(baseUrl, apiKey, userId, action, extraParams = {}) {
  const timestamp = new Date().toISOString().split('.')[0] + 'Z';
  const params = {
    Action: action,
    Format: 'JSON',
    Timestamp: timestamp,
    UserID: userId,
    Version: '1.0',
    ...extraParams
  };
  const queryString = Object.keys(params)
    .sort()
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');
  const signature = crypto.createHmac('sha256', apiKey).update(queryString).digest('hex');

  let finalBaseUrl = String(baseUrl || '').trim();
  if (!finalBaseUrl.startsWith('http://') && !finalBaseUrl.startsWith('https://')) {
    finalBaseUrl = 'https://' + finalBaseUrl;
  }
  if (!finalBaseUrl.endsWith('/')) finalBaseUrl += '/';
  return `${finalBaseUrl}?${queryString}&Signature=${signature}`;
}

function formatExpectedOrderNumbers(rawOrderNum, platform, siglaComercio, adicionalConfig) {
  const baseStr = String(rawOrderNum || '').trim();
  if (!baseStr) return [];

  let agregarPrefijo = platform === 'WooCommerce' || platform === 'Tiendanube';
  let prefijoOrigen = '';

  if (adicionalConfig) {
    const platConfig = (adicionalConfig.plat_siglas_config || {})[platform];
    if (platConfig) {
      agregarPrefijo = platConfig.agregar_prefijo !== false;
      prefijoOrigen = (platConfig.prefijo_origen || '').trim().toUpperCase();
    } else if (platform === 'WooCommerce') {
      agregarPrefijo = !adicionalConfig.pedido_trae_sigla;
    }
  }

  let cleanNum = baseStr;
  if (prefijoOrigen && cleanNum.toUpperCase().startsWith(prefijoOrigen)) {
    cleanNum = cleanNum.substring(prefijoOrigen.length).trim();
  }

  const candidates = new Set([baseStr, cleanNum]);
  if (platform === 'Jumpseller') {
    const numOnly = cleanNum.replace(/^#?JS-/i, '');
    candidates.add(`#JS-${numOnly}`);
    candidates.add(`JS-${numOnly}`);
    if (siglaComercio) {
      candidates.add(`${siglaComercio}#JS-${numOnly}`);
      candidates.add(`${siglaComercio}JS-${numOnly}`);
      candidates.add(`${siglaComercio}-${numOnly}`);
    }
  }
  if (siglaComercio) {
    if (!cleanNum.toUpperCase().startsWith(siglaComercio)) {
      candidates.add(`${siglaComercio}${cleanNum}`);
      candidates.add(`${siglaComercio}-${cleanNum}`);
    }
    if (agregarPrefijo && !cleanNum.toUpperCase().startsWith(siglaComercio)) {
      candidates.add(`${siglaComercio}${cleanNum}`);
    }
  }
  return Array.from(candidates).filter(Boolean);
}

// ==========================================
// 3. AUDITORÍA PRINCIPAL
// ==========================================
async function runIntegrationsGuardian() {
  const startedAt = new Date();
  console.log('🛡️ ========================================================');
  console.log(`🛡️ INICIANDO AGENTE GUARDIÁN DE INTEGRACIONES WMS STOCKA`);
  console.log(`🕒 Fecha/Hora: ${startedAt.toLocaleString('es-CL', { timeZone: 'America/Santiago' })}`);
  console.log('🛡️ ========================================================\n');

  // 1. Cargar metadatos globales de comercios, siglas y bodegas
  const [
    { data: integrations, error: intErr },
    { data: adicionalConfigs },
    { data: comerciosConfigs },
    { data: merchantWarehouses },
    { data: allWarehouses }
  ] = await Promise.all([
    supabase
      .from('merchant_integrations')
      .select('*')
      .eq('is_active', true)
      .neq('platform', 'Optiroute')
      .order('comercio', { ascending: true }),
    supabase.from('comercios_adicional_config').select('*'),
    supabase.from('v_comercios_config').select('nombre, sigla'),
    supabase.from('merchants_warehouses').select('merchant_id, warehouse_id'),
    supabase.from('warehouses').select('id, name').limit(5)
  ]);

  if (intErr) {
    console.error('❌ Error crítico consultando merchant_integrations:', intErr.message);
    process.exit(1);
  }

  const inactiveMerchants = new Set();
  const adicionalMap = new Map();
  (adicionalConfigs || []).forEach(cfg => {
    if (!cfg || !cfg.comercio) return;
    const upper = cfg.comercio.trim().toUpperCase();
    adicionalMap.set(upper, cfg);
    const isActive = cfg.activo !== false && cfg?.onboarding_checklist?.comercio_activo !== false;
    if (!isActive) inactiveMerchants.add(upper);
  });

  const siglaMap = new Map();
  (comerciosConfigs || []).forEach(c => {
    if (c && c.nombre && c.sigla) {
      siglaMap.set(c.nombre.trim().toUpperCase(), c.sigla.trim().toUpperCase());
    }
  });

  const warehouseByMerchantId = new Map();
  (merchantWarehouses || []).forEach(mw => {
    if (mw.merchant_id && mw.warehouse_id && !warehouseByMerchantId.has(mw.merchant_id)) {
      warehouseByMerchantId.set(mw.merchant_id, mw.warehouse_id);
    }
  });
  const fallbackWarehouseId = allWarehouses?.[0]?.id || null;

  const activeIntegrations = (integrations || []).filter(int => {
    if (!int.comercio) return false;
    const upper = int.comercio.trim().toUpperCase();
    if (inactiveMerchants.has(upper)) {
      console.log(`⏭️ Omitiendo integración ${int.platform} de comercio inactivo: ${int.comercio}`);
      return false;
    }
    return true;
  });

  console.log(`🔍 Total de integraciones activas a auditar: ${activeIntegrations.length}\n`);

  const results = {
    healthy: [],
    autoHealed: [],
    warnings: [],
    critical: []
  };

  const merchantsToResync = [];
  const seenResyncKeys = new Set();
  const addMerchantForResync = (plat, com) => {
    const key = `${plat}::${com.toUpperCase()}`;
    if (!seenResyncKeys.has(key)) {
      seenResyncKeys.add(key);
      merchantsToResync.push({ platform: plat, comercio: com });
    }
  };
  const iso72hAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const cutoffMissingMs = 45 * 60 * 1000; // 45 minutos de gracia para que corra el cron de 30m

  for (const integration of activeIntegrations) {
    const comercio = (integration.comercio || '').trim();
    const upperComercio = comercio.toUpperCase();
    const platform = (integration.platform || '').trim();
    const adicionalCfg = adicionalMap.get(upperComercio) || null;
    const sigla = siglaMap.get(upperComercio) || '';

    // Resolver bodega esperada para este comercio
    const expectedWarehouseId =
      adicionalCfg?.default_warehouse_id ||
      (adicionalCfg?.comercio_id ? warehouseByMerchantId.get(adicionalCfg.comercio_id) : null) ||
      warehouseByMerchantId.get(integration.merchant_id) ||
      fallbackWarehouseId;

    console.log(`--------------------------------------------------------`);
    console.log(`🏢 [${comercio}] Plataforma: ${platform} (${integration.shop_url || integration.username || 'API'})`);

    const healedActions = [];
    const warningsList = [];
    let criticalError = null;
    let storeActiveOrders72h = []; // [{ rawNumber, statusLabel, createdAt, isPaidActive }]

    try {
      // ========================================================
      // A. AUDITORÍA POR PLATAFORMA (API + WEBHOOKS + PEDIDOS 72H)
      // ========================================================
      if (platform === 'WooCommerce') {
        const wcResult = await auditWooCommerceIntegration(integration, iso72hAgo, healedActions, warningsList);
        storeActiveOrders72h = wcResult.activeOrders;
      } else if (platform === 'Jumpseller') {
        const jsResult = await auditJumpsellerIntegration(integration, iso72hAgo, healedActions, warningsList);
        storeActiveOrders72h = jsResult.activeOrders;
      } else if (platform === 'Shopify') {
        const shResult = await auditShopifyIntegration(integration, iso72hAgo, healedActions, warningsList);
        storeActiveOrders72h = shResult.activeOrders;
      } else if (platform === 'Tiendanube') {
        const tnResult = await auditTiendanubeIntegration(integration, iso72hAgo, healedActions, warningsList);
        storeActiveOrders72h = tnResult.activeOrders;
      } else if (platform === 'MercadoLibre') {
        await auditMercadoLibreIntegration(integration, healedActions, warningsList);
      } else if (platform === 'Falabella' || platform === 'Ripley' || platform === 'Paris' || platform === 'Walmart') {
        await auditMarketplaceIntegration(integration, platform, healedActions, warningsList);
      }

      // ========================================================
      // B. RECONCILIACIÓN TIENDA VS WMS (ÚLTIMAS 72 HORAS)
      // ========================================================
      if (storeActiveOrders72h.length > 0) {
        const { data: wmsOrders } = await supabase
          .from('orders')
          .select('id, external_order_number, status, estado_wms, operador, tracking_number, fecha_procesamiento, stock_descontado, raw_woocommerce_data, raw_jumpseller_data, raw_shopify_data')
          .eq('comercio', comercio)
          .gte('created_at', new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString());

        const wmsMap = new Map();
        (wmsOrders || []).forEach(o => {
          if (o.external_order_number) {
            wmsMap.set(String(o.external_order_number).trim().toUpperCase(), o);
          }
        });

        const missingOrderNums = [];
        let reactivatedCount = 0;

        for (const storeOrd of storeActiveOrders72h) {
          const candidates = formatExpectedOrderNumbers(storeOrd.rawNumber, platform, sigla, adicionalCfg);
          let matchedWmsOrder = null;
          for (const cand of candidates) {
            const found = wmsMap.get(cand.toUpperCase());
            if (found) {
              matchedWmsOrder = found;
              break;
            }
          }

          if (!matchedWmsOrder) {
            const ageMs = Date.now() - new Date(storeOrd.createdAt).getTime();
            if (ageMs > cutoffMissingMs) {
              missingOrderNums.push(candidates[candidates.length - 1] || storeOrd.rawNumber);
            }
          } else if (storeOrd.isPaidActive) {
            // Verificar si está falsamente Cancelado en el WMS (Caso Pago Fallido -> Pagado)
            const currentWmsState = String(matchedWmsOrder.estado_wms || 'En procesamiento').trim().toLowerCase();
            const wasCancelledInWms =
              String(matchedWmsOrder.status || '').toLowerCase() === 'cancelado' ||
              currentWmsState === 'cancelado';
            const existingRaw = matchedWmsOrder.raw_woocommerce_data || matchedWmsOrder.raw_jumpseller_data || matchedWmsOrder.raw_shopify_data || {};
            const wasManuallyProcessed =
              Boolean(matchedWmsOrder.operador) ||
              Boolean(matchedWmsOrder.tracking_number) ||
              Boolean(matchedWmsOrder.fecha_procesamiento) ||
              Boolean(matchedWmsOrder.stock_descontado) ||
              existingRaw.wms_manually_cancelled === true;

            if (wasCancelledInWms && !wasManuallyProcessed && !ESTADOS_WMS_PROTEGIDOS.includes(currentWmsState)) {
              const { error: reactErr } = await supabase
                .from('orders')
                .update({
                  status: 'para procesar',
                  estado_wms: 'En procesamiento'
                })
                .eq('id', matchedWmsOrder.id);

              if (!reactErr) {
                reactivatedCount++;
                healedActions.push(`Pedido ${matchedWmsOrder.external_order_number} reactivado automáticamente (estaba Cancelado en WMS pero activo/pagado en ${platform})`);
              }
            }
          }
        }

        if (reactivatedCount > 0) {
          try {
            await supabase.rpc('recalculate_committed_stock');
          } catch (_e) {}
        }

        if (missingOrderNums.length > 0) {
          const sample = missingOrderNums.slice(0, 5).join(', ');
          healedActions.push(`Detectados ${missingOrderNums.length} pedido(s) pagados en ${platform} no presentes en WMS (${sample}). Se programó re-sincronización inmediata.`);
          addMerchantForResync(platform, comercio);
        }
      }

      // ========================================================
      // C. AUDITORÍA DE ÍTEMS Y BODEGA EN PEDIDOS ACTIVOS (72H)
      // ========================================================
      const { data: recentActiveWmsOrders } = await supabase
        .from('orders')
        .select('id, external_order_number, status, estado_wms, stock_descontado')
        .eq('comercio', comercio)
        .eq('external_platform', platform)
        .in('estado_wms', ['En procesamiento', 'En preparación'])
        .gte('created_at', iso72hAgo);

      if (Array.isArray(recentActiveWmsOrders) && recentActiveWmsOrders.length > 0) {
        const orderIds = recentActiveWmsOrders.map(o => o.id);
        const { data: orderItems } = await supabase
          .from('order_items')
          .select('id, order_id, warehouse_id')
          .in('order_id', orderIds);

        const itemsByOrder = new Map();
        (orderItems || []).forEach(oi => {
          if (!itemsByOrder.has(oi.order_id)) itemsByOrder.set(oi.order_id, []);
          itemsByOrder.get(oi.order_id).push(oi);
        });

        let ordersWithoutItems = 0;
        let fixedWarehouseItemsCount = 0;

        for (const ord of recentActiveWmsOrders) {
          const items = itemsByOrder.get(ord.id) || [];
          if (items.length === 0) {
            ordersWithoutItems++;
          } else if (expectedWarehouseId && !ord.stock_descontado) {
            for (const item of items) {
              if (!item.warehouse_id || (adicionalCfg?.default_warehouse_id && item.warehouse_id !== adicionalCfg.default_warehouse_id)) {
                const { error: whUpdErr } = await supabase
                  .from('order_items')
                  .update({ warehouse_id: expectedWarehouseId })
                  .eq('id', item.id);
                if (!whUpdErr) fixedWarehouseItemsCount++;
              }
            }
          }
        }

        if (fixedWarehouseItemsCount > 0) {
          healedActions.push(`Corregida la bodega por defecto en ${fixedWarehouseItemsCount} línea(s) de pedido (order_items)`);
        }
        if (ordersWithoutItems > 0) {
          healedActions.push(`Detectados ${ordersWithoutItems} pedido(s) activos sin ítems cargados. Se programó re-sincronización de ${platform}.`);
          addMerchantForResync(platform, comercio);
        }
      }

      // Actualizar estado saludable en merchant_integrations
      await supabase
        .from('merchant_integrations')
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_error: null
        })
        .eq('id', integration.id);

    } catch (err) {
      criticalError = err.message || String(err);
      console.error(`   ❌ [CRÍTICO] ${comercio} (${platform}): ${criticalError}`);

      await supabase
        .from('merchant_integrations')
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_error: criticalError
        })
        .eq('id', integration.id);
    }

    if (criticalError) {
      results.critical.push({ comercio, platform, shopUrl: integration.shop_url, error: criticalError });
    } else if (healedActions.length > 0) {
      console.log(`   🛠️ [AUTO-HEALED] ${comercio} (${platform}): ${healedActions.join(' | ')}`);
      results.autoHealed.push({ comercio, platform, shopUrl: integration.shop_url, actions: healedActions });
    } else if (warningsList.length > 0) {
      console.log(`   ⚠️ [ADVERTENCIA] ${comercio} (${platform}): ${warningsList.join(' | ')}`);
      results.warnings.push({ comercio, platform, shopUrl: integration.shop_url, warnings: warningsList });
    } else {
      console.log(`   ✅ [OK] ${comercio} (${platform}) saludable.`);
      results.healthy.push({ comercio, platform, shopUrl: integration.shop_url });
    }
  }

  // ========================================================
  // 4. EJECUTAR RE-SINCRONIZACIÓN AUTOMÁTICA SI SE DETECTARON PEDIDOS FALTANTES
  // ========================================================
  const syncScriptByPlatform = {
    WooCommerce: 'sync_woocommerce.js',
    Jumpseller: 'sync_jumpseller.js',
    Shopify: 'sync_shopify.js',
    Tiendanube: 'sync_tiendanube.js'
  };

  for (const item of merchantsToResync) {
    const scriptName = syncScriptByPlatform[item.platform];
    if (!scriptName) continue;
    const scriptPath = path.join(__dirname, scriptName);
    if (!fs.existsSync(scriptPath)) continue;

    console.log(`\n🔄 [Auto-Heal] Ejecutando ${scriptName} para comercio "${item.comercio}" (solo pedidos)...`);
    try {
      execFileSync(process.execPath, [scriptPath], {
        stdio: 'inherit',
        timeout: 2 * 60 * 1000,
        env: {
          ...process.env,
          TARGET_COMERCIO: item.comercio,
          SKIP_PRODUCTS_SYNC: 'true'
        }
      });
      console.log(`✅ [Auto-Heal] ${scriptName} completado para "${item.comercio}".`);
    } catch (syncExecErr) {
      console.error(`⚠️ [Auto-Heal] Error al ejecutar ${scriptName} para "${item.comercio}":`, syncExecErr.message);
    }
  }

  // ========================================================
  // 5. RESUMEN FINAL Y ENVÍO DE REPORTE POR CORREO
  // ========================================================
  console.log('\n🛡️ ========================================================');
  console.log('🛡️ RESUMEN DEL GUARDIÁN DE INTEGRACIONES');
  console.log(`   🟢 Saludables:      ${results.healthy.length}`);
  console.log(`   🟡 Auto-reparadas:  ${results.autoHealed.length}`);
  console.log(`   🟠 Advertencias:    ${results.warnings.length}`);
  console.log(`   🔴 Errores Críticos:${results.critical.length}`);
  console.log('🛡️ ========================================================\n');

  const forceSummary = process.env.FORCE_DAILY_SUMMARY === 'true';
  const shouldSendEmail =
    results.critical.length > 0 ||
    results.autoHealed.length > 0 ||
    results.warnings.length > 0 ||
    forceSummary;

  if (shouldSendEmail) {
    const statusEmoji = results.critical.length > 0 ? '🔴 ALERTA CRÍTICA' : (results.autoHealed.length > 0 ? '🟡 AUTO-REPARACIÓN APLICADA' : '🟢 REPORTE DIARIO OK');
    const subject = `${statusEmoji} | Guardián de Integraciones WMS STOCKA (${results.critical.length} fallas, ${results.autoHealed.length} reparadas, ${results.healthy.length} OK)`;
    const html = buildGuardianEmailHtml(results, startedAt);
    await sendGuardianEmailReport(subject, html);
  }
}

// ==========================================
// 4. AUDITORES ESPECÍFICOS POR PLATAFORMA
// ==========================================

async function wcFetchWithProxyFallback(baseUrl, endpoint, options, integration) {
  const fullUrl = `${baseUrl}${endpoint}`;
  const res = await fetchWithTimeout(fullUrl, options);
  const contentType = res.headers.get('content-type') || '';

  if (res.status === 403 || (res.ok && !contentType.includes('application/json'))) {
    console.log(`   🛡️ [WAF Bypass] ${integration.comercio} devolvió ${res.status} en conexión directa (${endpoint}). Enrutando vía Supabase Edge Function...`);
    const proxyRes = await fetchWithTimeout(`${SUPABASE_URL}/functions/v1/woocommerce-webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        action: 'proxy_wc_api',
        integration_id: integration.id,
        comercio: integration.comercio,
        endpoint,
        method: options.method || 'GET',
        body: options.body || undefined
      })
    });
    return proxyRes;
  }

  return res;
}

async function auditWooCommerceIntegration(integration, iso72hAgo, healedActions, warningsList) {
  let consumerKey, consumerSecret;
  try {
    const creds = JSON.parse(integration.access_token);
    consumerKey = creds.consumer_key?.trim();
    consumerSecret = creds.consumer_secret?.trim();
  } catch (_e) {
    throw new Error('Formato de credenciales WooCommerce inválido en access_token (JSON requerido).');
  }

  if (!consumerKey || !consumerSecret || !integration.shop_url) {
    throw new Error('Faltan consumer_key, consumer_secret o shop_url en la integración de WooCommerce.');
  }

  let baseUrl = integration.shop_url.trim();
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = 'https://' + baseUrl;
  }
  if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);

  const authHeader = 'Basic ' + Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const headers = {
    'Authorization': authHeader,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': BROWSER_USER_AGENT
  };

  // 1. Consultar pedidos de las últimas 72h (con fallback automático vía Edge Function si el WAF bloquea la IP de GitHub Actions)
  const ordersEndpoint = `/wp-json/wc/v3/orders?per_page=50&after=${encodeURIComponent(iso72hAgo)}`;
  const res = await wcFetchWithProxyFallback(baseUrl, ordersEndpoint, { method: 'GET', headers }, integration);
  const contentType = res.headers.get('content-type') || '';

  if (!res.ok) {
    const bodyPreview = (await res.text()).substring(0, 140).replace(/\s+/g, ' ');
    if (res.status === 403 || bodyPreview.toLowerCase().includes('cloudflare') || bodyPreview.toLowerCase().includes('just a moment')) {
      throw new Error(`Bloqueo HTTP ${res.status} (WAF/Cloudflare) o permisos denegados en ${baseUrl}`);
    }
    throw new Error(`Error API WooCommerce HTTP ${res.status}: ${bodyPreview}`);
  }

  if (!contentType.includes('application/json')) {
    throw new Error(`Respuesta inválida de WooCommerce (${contentType}): posible bloqueo de seguridad o redirección en ${baseUrl}`);
  }

  const orders = await res.json();
  const activeOrders = [];
  if (Array.isArray(orders)) {
    for (const o of orders) {
      const st = String(o.status || '').toLowerCase().trim();
      const isCancelled = ['cancelled', 'failed', 'refunded', 'trash', 'checkout-draft'].includes(st);
      const isPaidActive = ['processing', 'completed'].includes(st);
      if (!isCancelled && st !== 'pending') {
        activeOrders.push({
          rawNumber: String(o.number || o.id).trim(),
          statusLabel: st,
          createdAt: o.date_created_gmt ? `${o.date_created_gmt}Z` : (o.date_created || new Date().toISOString()),
          isPaidActive
        });
      }
    }
  }

  // 2. Auditar y auto-reactivar Webhooks en WooCommerce
  try {
    const whRes = await wcFetchWithProxyFallback(baseUrl, '/wp-json/wc/v3/webhooks?per_page=100', { method: 'GET', headers }, integration);
    if (whRes.ok) {
      const webhooksList = await whRes.json();
      if (Array.isArray(webhooksList)) {
        const expectedWebhookUrl = `${SUPABASE_URL}/functions/v1/woocommerce-webhook?merchant_id=${integration.merchant_id}&comercio=${encodeURIComponent(integration.comercio || '')}`;
        const requiredTopics = [
          { topic: 'order.created', name: 'WMS STOCKA - Pedido Creado' },
          { topic: 'order.updated', name: 'WMS STOCKA - Pedido Actualizado' }
        ];

        for (const reqWh of requiredTopics) {
          const matching = webhooksList.filter(w =>
            w.delivery_url &&
            (w.delivery_url.includes('/functions/v1/woocommerce-webhook') || w.delivery_url.includes('supabase.co/functions')) &&
            (w.topic === reqWh.topic || (w.resource === 'order' && `${w.resource}.${w.event}` === reqWh.topic))
          );

          const activeOne = matching.find(w => w.status === 'active');
          if (activeOne) continue;

          const pausedOne = matching[0];
          if (pausedOne && pausedOne.id) {
            const reactRes = await wcFetchWithProxyFallback(baseUrl, `/wp-json/wc/v3/webhooks/${pausedOne.id}`, {
              method: 'PUT',
              headers,
              body: JSON.stringify({ status: 'active' })
            }, integration);
            if (reactRes.ok) {
              healedActions.push(`Webhook WooCommerce '${reqWh.topic}' estaba '${pausedOne.status}' y fue reactivado automáticamente`);
            } else {
              warningsList.push(`Webhook '${reqWh.topic}' está '${pausedOne.status}' y no pudo reactivarse (HTTP ${reactRes.status})`);
            }
          } else {
            const createRes = await wcFetchWithProxyFallback(baseUrl, '/wp-json/wc/v3/webhooks', {
              method: 'POST',
              headers,
              body: JSON.stringify({
                name: reqWh.name,
                topic: reqWh.topic,
                delivery_url: expectedWebhookUrl,
                status: 'active'
              })
            }, integration);
            if (createRes.ok) {
              healedActions.push(`Webhook WooCommerce '${reqWh.topic}' no existía y fue creado automáticamente`);
            } else {
              warningsList.push(`Falta webhook '${reqWh.topic}' y la API Key no permitió crearlo (HTTP ${createRes.status})`);
            }
          }
        }
      }
    }
  } catch (whErr) {
    warningsList.push(`No se pudieron auditar webhooks WooCommerce: ${whErr.message}`);
  }

  return { activeOrders };
}

async function auditJumpsellerIntegration(integration, iso72hAgo, healedActions, warningsList) {
  let loginKey, authToken;
  try {
    const creds = JSON.parse(integration.access_token);
    loginKey = creds.login_key?.trim();
    authToken = creds.auth_token?.trim();
  } catch (_e) {
    throw new Error('Formato de credenciales Jumpseller inválido en access_token.');
  }

  if (!loginKey || !authToken) {
    throw new Error('Faltan login_key o auth_token en credenciales de Jumpseller.');
  }

  const basicAuth = Buffer.from(`${loginKey}:${authToken}`).toString('base64');
  const headers = {
    'X-LOGIN-KEY': loginKey,
    'X-AUTH-TOKEN': authToken,
    'Authorization': `Basic ${basicAuth}`,
    'Content-Type': 'application/json',
    'User-Agent': BROWSER_USER_AGENT
  };

  const res = await fetchWithTimeout('https://api.jumpseller.com/v1/orders.json?limit=50', { method: 'GET', headers });
  if (!res.ok) {
    const errText = (await res.text()).substring(0, 140);
    throw new Error(`Error API Jumpseller HTTP ${res.status}: ${errText}`);
  }

  const ordersList = await res.json();
  const activeOrders = [];
  const cutoffTs = new Date(iso72hAgo).getTime();

  if (Array.isArray(ordersList)) {
    for (const wrapper of ordersList) {
      const o = wrapper?.order || wrapper;
      if (!o || !o.id) continue;
      const appCode = String(o.source?.created_from_app_code || '').toLowerCase();
      if (appCode === 'mercadolibre') continue;

      const createdAt = o.created_at || new Date().toISOString();
      if (new Date(createdAt).getTime() < cutoffTs) continue;

      const st = String(o.status || '').toLowerCase().trim();
      const isCancelled = ['canceled', 'cancelled', 'abandoned', 'pending payment', 'pending_payment'].includes(st);
      const isPaidActive = st === 'paid';
      if (!isCancelled) {
        activeOrders.push({
          rawNumber: `#JS-${String(o.id).trim()}`,
          statusLabel: st,
          createdAt,
          isPaidActive
        });
      }
    }
  }

  // Verificar Webhooks en Jumpseller
  try {
    const hooksRes = await fetchWithTimeout('https://api.jumpseller.com/v1/hooks.json', { method: 'GET', headers });
    if (hooksRes.ok) {
      const hooksList = await hooksRes.json();
      if (Array.isArray(hooksList)) {
        const hasStockaHook = hooksList.some(h => {
          const hook = h?.hook || h;
          return hook?.url && (hook.url.includes('jumpseller-webhook') || hook.url.includes('supabase.co/functions'));
        });
        if (!hasStockaHook) {
          const expectedUrl = `${SUPABASE_URL}/functions/v1/jumpseller-webhook?merchant_id=${integration.merchant_id}&comercio=${encodeURIComponent(integration.comercio || '')}`;
          for (const eventName of ['order_paid', 'order_updated', 'order_canceled']) {
            await fetchWithTimeout('https://api.jumpseller.com/v1/hooks.json', {
              method: 'POST',
              headers,
              body: JSON.stringify({ hook: { url: expectedUrl, event: eventName } })
            });
          }
          healedActions.push('Webhooks de Jumpseller (order_paid, order_updated, order_canceled) registrados automáticamente');
        }
      }
    }
  } catch (_e) {}

  return { activeOrders };
}

async function auditShopifyIntegration(integration, iso72hAgo, healedActions, warningsList) {
  if (!integration.shop_url || !integration.access_token) {
    throw new Error('Faltan shop_url o access_token en integración de Shopify.');
  }

  let accessToken = integration.access_token;

  // Intentar probar API o renovar token si devuelve 401
  const ordersUrl = `https://${integration.shop_url}/admin/api/2024-04/orders.json?status=any&limit=50&created_at_min=${encodeURIComponent(iso72hAgo)}`;
  let res = await fetchWithTimeout(ordersUrl, {
    method: 'GET',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json'
    }
  });

  if (res.status === 401 && integration.refresh_token) {
    const clientSecret = SHOPIFY_CLIENT_SECRET || integration.webhook_secret;
    if (clientSecret) {
      const params = new URLSearchParams({
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: integration.refresh_token
      });
      const tokenRes = await fetchWithTimeout(`https://${integration.shop_url}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: params.toString()
      });

      if (tokenRes.ok) {
        const tokenData = await tokenRes.json();
        accessToken = tokenData.access_token;
        await supabase
          .from('merchant_integrations')
          .update({
            access_token: accessToken,
            refresh_token: tokenData.refresh_token || integration.refresh_token
          })
          .eq('id', integration.id);
        healedActions.push('Token de acceso de Shopify renovado automáticamente (rotación OAuth)');

        res = await fetchWithTimeout(ordersUrl, {
          method: 'GET',
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json'
          }
        });
      }
    }
  }

  if (!res.ok) {
    const errText = (await res.text()).substring(0, 140);
    throw new Error(`Error API Shopify HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const orders = data?.orders || [];
  const activeOrders = [];

  for (const o of orders) {
    const finStatus = String(o.financial_status || '').toLowerCase();
    const isCancelled = Boolean(o.cancelled_at) || ['voided', 'refunded'].includes(finStatus);
    const isPaidActive = !isCancelled && ['paid', 'partially_paid', 'partially_refunded'].includes(finStatus);
    if (isPaidActive) {
      activeOrders.push({
        rawNumber: String(o.name || o.order_number || o.id).trim(),
        statusLabel: finStatus,
        createdAt: o.created_at || new Date().toISOString(),
        isPaidActive: true
      });
    }
  }

  return { activeOrders };
}

async function auditTiendanubeIntegration(integration, iso72hAgo, healedActions, warningsList) {
  const storeId = String(integration.shop_url || '').trim().replace(/[^0-9]/g, '');
  const accessToken = String(integration.access_token || '').trim();
  if (!storeId || !accessToken) {
    throw new Error('Faltan Store ID numérico o Access Token en Tiendanube.');
  }

  const headers = {
    'Authentication': `bearer ${accessToken}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'StockaWMS (integraciones@stocka.cl)'
  };

  const ordersUrl = `https://api.tiendanube.com/v1/${storeId}/orders?per_page=50&created_at_min=${encodeURIComponent(iso72hAgo)}`;
  const res = await fetchWithTimeout(ordersUrl, { method: 'GET', headers });

  if (res.status !== 404 && !res.ok) {
    const errText = (await res.text()).substring(0, 140);
    throw new Error(`Error API Tiendanube HTTP ${res.status}: ${errText}`);
  }

  const orders = res.status === 404 ? [] : await res.json();
  const activeOrders = [];
  if (Array.isArray(orders)) {
    for (const o of orders) {
      const st = String(o.status || '').toLowerCase();
      const paySt = String(o.payment_status || '').toLowerCase();
      const isCancelled = st === 'cancelled' || ['voided', 'refunded', 'abandoned'].includes(paySt);
      const isPaidActive = !isCancelled && paySt === 'paid';
      if (isPaidActive) {
        activeOrders.push({
          rawNumber: String(o.number || o.id).trim(),
          statusLabel: paySt,
          createdAt: o.created_at || new Date().toISOString(),
          isPaidActive: true
        });
      }
    }
  }

  return { activeOrders };
}

async function auditMercadoLibreIntegration(integration, healedActions, warningsList) {
  if (!integration.refresh_token && !integration.access_token) {
    throw new Error('Faltan credenciales OAuth en integración de MercadoLibre.');
  }

  // Verificar si tiene un error registrado o si el token funciona consultando /users/me
  let accessToken = integration.access_token;
  let meRes = await fetchWithTimeout('https://api.mercadolibre.com/users/me', {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });

  if (!meRes.ok && integration.refresh_token && integration.client_id && integration.client_secret) {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: integration.client_id,
      client_secret: integration.client_secret,
      refresh_token: integration.refresh_token
    });
    const tokenRes = await fetchWithTimeout('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    if (!tokenRes.ok) {
      const errText = (await tokenRes.text()).substring(0, 140);
      throw new Error(`Error renovando token MercadoLibre HTTP ${tokenRes.status}: ${errText}`);
    }
    const tokenData = await tokenRes.json();
    accessToken = tokenData.access_token;
    await supabase
      .from('merchant_integrations')
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || integration.refresh_token
      })
      .eq('id', integration.id);
    healedActions.push('Token OAuth de MercadoLibre renovado exitosamente');
  } else if (!meRes.ok) {
    const errText = (await meRes.text()).substring(0, 140);
    throw new Error(`Token MercadoLibre inválido (HTTP ${meRes.status}): ${errText}`);
  }
}

async function auditMarketplaceIntegration(integration, platform, healedActions, warningsList) {
  if (platform === 'Falabella' || platform === 'Ripley') {
    if (!integration.shop_url || !integration.access_token || !integration.username) {
      throw new Error(`Faltan shop_url, username o API Key en integración de ${platform}.`);
    }
    const url = buildMiraklSignedUrl(integration.shop_url, integration.access_token, integration.username, 'GetOrders', {
      Limit: '1'
    });
    const res = await fetchWithTimeout(url, { method: 'GET' });
    if (!res.ok) {
      throw new Error(`Error conectando con ${platform} Seller Center: HTTP ${res.status}`);
    }
    const json = await res.json().catch(() => null);
    if (json?.ErrorResponse?.Head?.ErrorMessage) {
      throw new Error(`Error API ${platform}: ${json.ErrorResponse.Head.ErrorMessage}`);
    }
  } else if (platform === 'Paris') {
    if (!integration.access_token) {
      throw new Error('Falta API Key / Access Token en integración de Paris.');
    }
  } else if (platform === 'Walmart') {
    if (!integration.client_id || !integration.client_secret) {
      throw new Error('Faltan client_id o client_secret en integración de Walmart.');
    }
  }
}

function buildGuardianEmailHtml(results, startedAt) {
  const dateStr = startedAt.toLocaleString('es-CL', { timeZone: 'America/Santiago' });

  const criticalRows = results.critical.map(c => `
    <tr>
      <td style="padding: 8px 10px; border-bottom: 1px solid #fee2e2; font-weight: 700; color: #991b1b;">${c.comercio}</td>
      <td style="padding: 8px 10px; border-bottom: 1px solid #fee2e2;">${c.platform}</td>
      <td style="padding: 8px 10px; border-bottom: 1px solid #fee2e2; font-family: monospace; font-size: 12px; color: #b91c1c;">${c.error}</td>
    </tr>
  `).join('');

  const healedRows = results.autoHealed.map(h => `
    <tr>
      <td style="padding: 8px 10px; border-bottom: 1px solid #fef3c7; font-weight: 700; color: #92400e;">${h.comercio}</td>
      <td style="padding: 8px 10px; border-bottom: 1px solid #fef3c7;">${h.platform}</td>
      <td style="padding: 8px 10px; border-bottom: 1px solid #fef3c7; font-size: 12px; color: #78350f;">${h.actions.join('<br>• ')}</td>
    </tr>
  `).join('');

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 720px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; color: #1e293b;">
      <h2 style="margin-top: 0; color: #0f172a;">🛡️ Reporte del Agente Guardián de Integraciones WMS STOCKA</h2>
      <p style="color: #64748b; font-size: 14px; margin-bottom: 20px;">Ejecutado el <strong>${dateStr}</strong> (Hora Chile)</p>

      <div style="display: flex; gap: 12px; margin-bottom: 24px;">
        <div style="flex: 1; background: #f0fdf4; border: 1px solid #bbf7d0; padding: 12px; border-radius: 8px; text-align: center;">
          <div style="font-size: 22px; font-weight: 800; color: #15803d;">${results.healthy.length}</div>
          <div style="font-size: 12px; color: #166534; font-weight: 600;">Saludables</div>
        </div>
        <div style="flex: 1; background: #fffbeb; border: 1px solid #fde68a; padding: 12px; border-radius: 8px; text-align: center;">
          <div style="font-size: 22px; font-weight: 800; color: #b45309;">${results.autoHealed.length}</div>
          <div style="font-size: 12px; color: #92400e; font-weight: 600;">Auto-Reparadas</div>
        </div>
        <div style="flex: 1; background: #fef2f2; border: 1px solid #fecaca; padding: 12px; border-radius: 8px; text-align: center;">
          <div style="font-size: 22px; font-weight: 800; color: #dc2626;">${results.critical.length}</div>
          <div style="font-size: 12px; color: #991b1b; font-weight: 600;">Con Error Crítico</div>
        </div>
      </div>

      ${results.critical.length > 0 ? `
        <h3 style="color: #b91c1c; margin-bottom: 8px;">🔴 Integraciones con Error Crítico (Acción Requerida)</h3>
        <table style="width: 100%; border-collapse: collapse; background: #fef2f2; border-radius: 8px; overflow: hidden; margin-bottom: 20px;">
          <thead>
            <tr style="background: #fee2e2; text-align: left; font-size: 12px; color: #7f1d1d;">
              <th style="padding: 8px 10px;">Comercio</th>
              <th style="padding: 8px 10px;">Plataforma</th>
              <th style="padding: 8px 10px;">Diagnóstico</th>
            </tr>
          </thead>
          <tbody>${criticalRows}</tbody>
        </table>
      ` : ''}

      ${results.autoHealed.length > 0 ? `
        <h3 style="color: #b45309; margin-bottom: 8px;">🟡 Integraciones Auto-Reparadas por el Guardián</h3>
        <table style="width: 100%; border-collapse: collapse; background: #fffbeb; border-radius: 8px; overflow: hidden; margin-bottom: 20px;">
          <thead>
            <tr style="background: #fef3c7; text-align: left; font-size: 12px; color: #78350f;">
              <th style="padding: 8px 10px;">Comercio</th>
              <th style="padding: 8px 10px;">Plataforma</th>
              <th style="padding: 8px 10px;">Acción Aplicada</th>
            </tr>
          </thead>
          <tbody>${healedRows}</tbody>
        </table>
      ` : ''}

      <p style="font-size: 12px; color: #64748b; margin-top: 20px; border-top: 1px solid #e2e8f0; padding-top: 12px;">
        Todos los estados han sido actualizados en tiempo real en el <strong>Radar de Comercios</strong> y en el <strong>Centro de Integraciones WMS</strong>.
      </p>
    </div>
  `;
}

if (require.main === module) {
  runIntegrationsGuardian().catch(err => {
    console.error('❌ Error fatal en el Agente Guardián:', err);
    process.exit(1);
  });
}

module.exports = { runIntegrationsGuardian };
