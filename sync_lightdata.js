const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Cargar archivo .env localmente de forma manual si existe
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

// ==========================================
// CONFIGURACIÓN DE LIGHTDATA, SUPABASE & ENTORNO
// ==========================================
const LIGHTDATA_USERNAME = process.env.LIGHTDATA_USERNAME;
const LIGHTDATA_PASSWORD = process.env.LIGHTDATA_PASSWORD;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const STATE_FILE = path.join(__dirname, 'lightdata_state.json');
const TARGET_URL = 'https://alphagroup.lightdata.com.ar/';

// Validar variables de entorno requeridas
if (!LIGHTDATA_USERNAME || !LIGHTDATA_PASSWORD) {
  console.error('❌ ERROR: Las variables de entorno LIGHTDATA_USERNAME y LIGHTDATA_PASSWORD no están configuradas.');
  process.exit(1);
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ ERROR: La variable de entorno SUPABASE_SERVICE_ROLE_KEY no está configurada.');
  process.exit(1);
}

// Inicializar cliente de Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Mapea los estados de envío de LightData a los estados internos del WMS STOCKA
 */
function mapLightDataStatusToWms(statusStr) {
  if (!statusStr) return null;
  const status = statusStr.trim().toLowerCase();

  switch (status) {
    case 'a retirar':
      return 'preparado';
    case 'en camino al destinatario':
      return 'en tránsito';
    case 'entregado':
    case 'entregado 2da visita':
      return 'entregado';
    case 'cancelado':
      return 'cancelado';
    default:
      // Si el estado es otro, retornamos null para no sobrescribir el del WMS
      return null;
  }
}

async function syncLightData() {
  console.log('🔄 Iniciando sincronización de LightData a Supabase...');

  // Determinar si corremos en segundo plano (headless)
  const isCI = !!process.env.GITHUB_ACTIONS;
  const browser = await chromium.launch({ 
    headless: isCI || process.env.HEADLESS === 'true',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  let context;

  // Cargar sesión guardada si existe
  if (fs.existsSync(STATE_FILE)) {
    console.log('Cargando sesión persistida desde:', STATE_FILE);
    context = await browser.newContext({ storageState: STATE_FILE });
  } else {
    console.log('No se encontró sesión previa. Iniciando nueva sesión.');
    context = await browser.newContext();
  }

  const page = await context.newPage();

  try {
    await page.setViewportSize({ width: 1280, height: 800 });

    console.log(`Navegando a: ${TARGET_URL}`);
    await page.goto(TARGET_URL);

    // Evaluar si es necesario iniciar sesión
    const isLoginPage = await page.locator('#username').isVisible().catch(() => false);

    if (isLoginPage) {
      console.log('🔐 Sesión no activa. Autenticando...');
      await page.fill('#username', LIGHTDATA_USERNAME);
      await page.fill('#password', LIGHTDATA_PASSWORD);

      await page.waitForTimeout(500);
      await page.click('#btnlogin');

      // Esperar a que el campo de inicio de sesión desaparezca
      await page.waitForSelector('#username', { state: 'hidden', timeout: 30000 });

      // Guardar el estado de la sesión
      await context.storageState({ path: STATE_FILE });
      console.log('💾 Sesión guardada con éxito.');
    } else {
      console.log('🔓 Sesión activa cargada con éxito.');
    }

    // Esperar a que cargue la lista de envíos inicial
    console.log('⏳ Esperando la tabla de envíos...');
    await page.waitForSelector('table tbody tr', { timeout: 15000 });

    // 1. Cambiar el filtro "Estados del envio" a "Todos" (valor '-1')
    console.log('🔍 Cambiando filtro "Estados del envio" a "Todos"...');
    await page.locator('select#envios_f_estado').first().selectOption('-1');
    
    // 2. Hacer clic en el botón FILTRAR
    console.log('🖱️ Aplicando filtros...');
    await page.locator('a.btnVioleta:has-text("FILTRAR")').first().click();

    // Esperar a que la tabla se recargue con los nuevos filtros
    await page.waitForTimeout(4000);
    await page.waitForSelector('table tbody tr', { timeout: 15000 });

    // 3. Cambiar la paginación a "Todos" (valor '-1')
    console.log('📋 Ajustando cantidad por página a "Todos"...');
    await page.locator('select#cantXPag').first().selectOption('-1');
    
    // Esperar a que la tabla cargue todos los registros
    await page.waitForTimeout(4000);
    await page.waitForSelector('table tbody tr', { timeout: 15000 });

    // Hacer scraping directo del DOM de la tabla
    console.log('🕵️‍♂️ Extrayendo registros de envíos de la tabla...');
    const shipments = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      return rows.map(row => {
        const cols = Array.from(row.querySelectorAll('td'));
        if (cols.length < 12) return null;

        // Intentar extraer el ID único (did) del QR data attribute
        const qrContainer = cols[0]?.querySelector('.containerIconQR');
        let did = null;
        if (qrContainer) {
          const dataQrStr = qrContainer.getAttribute('data-qr');
          if (dataQrStr) {
            try {
              const dataQrObj = JSON.parse(dataQrStr);
              did = dataQrObj.did ? String(dataQrObj.did) : null;
            } catch (e) {
              const match = dataQrStr.match(/"did"\s*:\s*"(\d+)"/);
              if (match) did = match[1];
            }
          }
        }

        return {
          id: did, // did único de LightData
          nombreFantasia: cols[1]?.innerText.trim(),
          idml: cols[2]?.innerText.trim(),
          origen: cols[3]?.innerText.trim(),
          trackingNumber: cols[4]?.innerText.trim(),
          fechaVenta: cols[5]?.innerText.trim(),
          fechaAlphaGroup: cols[6]?.innerText.trim(),
          destinoNombre: cols[7]?.innerText.trim(),
          comuna: cols[8]?.innerText.trim(),
          zonaEntrega: cols[9]?.innerText.trim(),
          zonaCosto: cols[10]?.innerText.trim(),
          estado: cols[11]?.innerText.trim()
        };
      }).filter(Boolean);
    });

    console.log(`📊 Se encontraron ${shipments.length} envíos totales en el panel de LightData.`);

    let matchingOrdersCount = 0;
    let dbUpsertCount = 0;

    for (const shipment of shipments) {
      // 1. Si no hay ID único, usamos el tracking_number como fallback para no perder el registro
      const shipmentId = shipment.id || shipment.trackingNumber;
      if (!shipmentId) continue;

      // 2. Guardar/Actualizar en la tabla dedicada lightdata_envios
      const shipmentPayload = {
        id: shipmentId,
        nombre_fantasia: shipment.nombreFantasia,
        idml: shipment.idml,
        origen: shipment.origen,
        tracking_number: shipment.trackingNumber,
        fecha_venta: shipment.fechaVenta,
        fecha_alphagroup: shipment.fechaAlphaGroup,
        destino_nombre: shipment.destinoNombre,
        comuna: shipment.comuna,
        zona_entrega: shipment.zonaEntrega,
        zona_costo: shipment.zonaCosto,
        estado: shipment.estado,
        raw_data: shipment,
        updated_at: new Date().toISOString()
      };

      const { error: upsertError } = await supabase
        .from('lightdata_envios')
        .upsert(shipmentPayload, { onConflict: 'id' });

      if (upsertError) {
        console.error(`   ❌ Error al insertar/actualizar envío ${shipmentId} en lightdata_envios:`, upsertError.message);
      } else {
        dbUpsertCount++;
      }

      // 3. Sincronizar y actualizar con la tabla principal de pedidos (orders)
      const { trackingNumber, idml, estado } = shipment;
      if (!trackingNumber && !idml) continue;

      let query = supabase
        .from('orders')
        .select('id, status, external_order_number, tracking_number, lightdata_status');

      if (trackingNumber) {
        query = query.or(`tracking_number.eq.${trackingNumber},external_order_number.eq.${trackingNumber}`);
      } else if (idml) {
        query = query.eq('external_order_number', idml);
      }

      const { data: dbOrders, error: findError } = await query;

      if (findError) {
        console.error(`   ❌ Error al buscar pedido '${trackingNumber || idml}' en orders:`, findError.message);
        continue;
      }

      if (dbOrders && dbOrders.length > 0) {
        matchingOrdersCount++;
        const dbOrder = dbOrders[0];
        const mappedWmsStatus = mapLightDataStatusToWms(estado);

        const updatePayload = {
          lightdata_status: estado,
          raw_lightdata_data: shipment
        };

        if (mappedWmsStatus && mappedWmsStatus !== dbOrder.status) {
          updatePayload.status = mappedWmsStatus;
        }

        if (trackingNumber && !dbOrder.tracking_number) {
          updatePayload.tracking_number = trackingNumber;
        }

        const hasStatusChange = mappedWmsStatus && mappedWmsStatus !== dbOrder.status;
        const hasLightDataStatusChange = dbOrder.lightdata_status !== estado;
        const needsUpdate = hasStatusChange || hasLightDataStatusChange || !dbOrder.tracking_number;

        if (needsUpdate) {
          const { error: updateError } = await supabase
            .from('orders')
            .update(updatePayload)
            .eq('id', dbOrder.id);

          if (updateError) {
            console.error(`      ❌ Error al actualizar pedido ${dbOrder.id} en orders:`, updateError.message);
          }
        }
      }
    }

    console.log(`\n========================================`);
    console.log(`Sincronización finalizada:`);
    console.log(`- Envíos upsertados en tabla dedicada (lightdata_envios): ${dbUpsertCount}`);
    console.log(`- Pedidos coincidentes actualizados en WMS (orders): ${matchingOrdersCount}`);
    console.log(`========================================`);

  } catch (error) {
    console.error('❌ Error durante la ejecución del script:', error);
  } finally {
    console.log('Cerrando navegador...');
    await browser.close();
  }
}

// Ejecutar
syncLightData();
