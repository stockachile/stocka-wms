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
      // Si el estado es otro (ej: "Nadie", "En planta", "Devolviendo"),
      // retornamos null para no sobrescribir el estado principal del WMS,
      // pero igual guardaremos el detalle del estado de LightData en la columna específica.
      return null;
  }
}

async function syncLightData() {
  console.log('🔄 Iniciando sincronización de LightData a Supabase...');

  // Determinar si corremos en segundo plano (headless)
  // En GitHub Actions u otros servidores siempre correrá en modo headless
  const isCI = !!process.env.GITHUB_ACTIONS;
  const browser = await chromium.launch({ 
    headless: isCI || process.env.HEADLESS === 'true',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  let context;

  // Cargar sesión guardada si existe para ahorrar tiempo y peticiones
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

      // Esperar a que el campo de inicio de sesión desaparezca (indica login exitoso)
      await page.waitForSelector('#username', { state: 'hidden', timeout: 30000 });

      // Guardar el estado de la sesión
      await context.storageState({ path: STATE_FILE });
      console.log('💾 Sesión guardada con éxito.');
    } else {
      console.log('🔓 Sesión activa cargada con éxito.');
    }

    // Esperar a que cargue la lista de envíos
    console.log('⏳ Esperando la tabla de envíos...');
    await page.waitForSelector('table tbody tr', { timeout: 15000 });

    // Cambiar la paginación a "Todos" para procesar todos los registros de una vez
    console.log('📋 Ajustando cantidad por página a "Todos"...');
    await page.locator('select#cantXPag').first().selectOption('-1');
    
    // Esperar un momento a que la tabla se recargue
    await page.waitForTimeout(4000);

    // Hacer scraping directo del DOM de la tabla
    console.log('🕵️‍♂️ Extrayendo registros de envíos de la tabla...');
    const shipments = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      return rows.map(row => {
        const cols = Array.from(row.querySelectorAll('td'));
        if (cols.length < 12) return null;
        return {
          idml: cols[2]?.innerText.trim(),
          origen: cols[3]?.innerText.trim(),
          trackingNumber: cols[4]?.innerText.trim(),
          fechaVenta: cols[5]?.innerText.trim(),
          fechaAlphaGroup: cols[6]?.innerText.trim(),
          destinoNombre: cols[7]?.innerText.trim(),
          comuna: cols[8]?.innerText.trim(),
          zonaEntrega: cols[9]?.innerText.trim(),
          estadoRaw: cols[11]?.innerText.trim()
        };
      }).filter(Boolean);
    });

    console.log(`📊 Se encontraron ${shipments.length} envíos en el panel de LightData.`);

    let matchingCount = 0;
    let updateCount = 0;

    for (const shipment of shipments) {
      const { idml, trackingNumber, estadoRaw } = shipment;

      if (!trackingNumber && !idml) continue;

      // Buscar coincidencia en Supabase
      // Buscamos tanto por tracking_number como por external_order_number (IDML)
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
        console.error(`   ❌ Error al buscar pedido '${trackingNumber || idml}' en Supabase:`, findError.message);
        continue;
      }

      if (!dbOrders || dbOrders.length === 0) {
        // Pedido no coincide con nuestra base de datos del WMS, omitimos silenciosamente
        continue;
      }

      matchingCount++;
      const dbOrder = dbOrders[0];
      const mappedWmsStatus = mapLightDataStatusToWms(estadoRaw);

      // Preparar campos para actualizar
      const updatePayload = {
        lightdata_status: estadoRaw,
        raw_lightdata_data: shipment
      };

      // Si el estado mapeado es válido y difiere del actual en el WMS, lo actualizamos
      if (mappedWmsStatus && mappedWmsStatus !== dbOrder.status) {
        updatePayload.status = mappedWmsStatus;
      }

      // Si no tenemos el número de seguimiento guardado y LightData nos lo da, lo guardamos
      if (trackingNumber && !dbOrder.tracking_number) {
        updatePayload.tracking_number = trackingNumber;
      }

      // Verificar si hay cambios reales en los datos
      const hasStatusChange = mappedWmsStatus && mappedWmsStatus !== dbOrder.status;
      const hasLightDataStatusChange = dbOrder.lightdata_status !== estadoRaw;
      const needsUpdate = hasStatusChange || hasLightDataStatusChange || !dbOrder.tracking_number;

      if (needsUpdate) {
        const oldStatus = dbOrder.status;
        const newStatus = updatePayload.status || oldStatus;

        console.log(`   📝 Pedido coincidente '${dbOrder.external_order_number || dbOrder.id}':`);
        if (hasStatusChange) console.log(`      - Estado WMS: "${oldStatus}" -> "${newStatus}"`);
        if (hasLightDataStatusChange) console.log(`      - Estado LightData: "${dbOrder.lightdata_status || 'N/A'}" -> "${estadoRaw}"`);

        const { error: updateError } = await supabase
          .from('orders')
          .update(updatePayload)
          .eq('id', dbOrder.id);

        if (updateError) {
          console.error(`      ❌ Error al actualizar Supabase:`, updateError.message);
        } else {
          updateCount++;
          console.log(`      ✅ Sincronizado.`);
        }
      }
    }

    console.log(`\n========================================`);
    console.log(`Sincronización finalizada:`);
    console.log(`- Envíos coincidentes con WMS: ${matchingCount}`);
    console.log(`- Pedidos actualizados en Supabase: ${updateCount}`);
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
