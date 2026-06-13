const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
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
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
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

/**
 * Helper para parsear la fecha de LightData "DD/MM/YYYY HH:mm" a formato ISO para Postgres TIMESTAMPTZ
 */
function parseAlphaGroupDate(dateStr) {
  if (!dateStr) return null;
  try {
    const parts = String(dateStr).trim().split(' ');
    const dateParts = parts[0].split('/');
    const day = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10) - 1; // 0-indexed
    const year = parseInt(dateParts[2], 10);
    
    let hour = 0;
    let minute = 0;
    if (parts[1]) {
      const timeParts = parts[1].split(':');
      hour = parseInt(timeParts[0], 10);
      minute = parseInt(timeParts[1], 10);
    }
    
    const date = new Date(year, month, day, hour, minute);
    return isNaN(date.getTime()) ? null : date.toISOString();
  } catch (e) {
    return null;
  }
}

async function syncLightData() {
  console.log('🔄 Iniciando sincronización de LightData a Supabase vía Excel...');

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

    // Asegurarse de que exista el directorio de descargas
    if (!fs.existsSync(DOWNLOADS_DIR)){
      fs.mkdirSync(DOWNLOADS_DIR);
    }

    const excelPath = path.join(DOWNLOADS_DIR, 'lightdata_temp.xlsx');

    // 3. Descargar el Excel
    console.log('📥 Iniciando descarga del archivo Excel...');
    const downloadButtonSelector = 'a[onclick="appEnviosListados.downloadExcel();"]';
    
    // Esperar que el botón de descarga esté visible
    await page.locator(downloadButtonSelector).first().waitFor({ state: 'visible', timeout: 15000 });

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 45000 }), // Esperar inicio descarga
      page.locator(downloadButtonSelector).first().click()
    ]);

    await download.saveAs(excelPath);
    console.log('💾 Archivo Excel descargado y guardado temporalmente.');

    // 4. Leer y procesar el Excel con xlsx
    console.log('📖 Leyendo datos desde el Excel...');
    const workbook = xlsx.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convertir a JSON crudo (array de arrays) para controlar las filas de metadatos
    const rawRows = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
    
    // Las filas 1-4 son filtros/metadatos del reporte. La fila 5 son los headers.
    // La data útil comienza en la fila 6 (índice 5 en el array).
    const dataRows = rawRows.slice(5);
    console.log(`📊 Se encontraron ${dataRows.length} envíos en el archivo Excel.`);

    let dbUpsertCount = 0;
    let matchingOrdersCount = 0;
    const upsertPayloads = [];

    for (const row of dataRows) {
      // Omitir filas vacías
      if (!row || row.length === 0) continue;

      const id = String(row[0] || '').trim(); // ID (Interno)
      const tracking = String(row[1] || '').trim(); // Número Tracking
      const idml = String(row[2] || '').trim(); // ID venta ML

      if (!id) continue;

      const rawDateStr = row[6]; // Fecha AlphaGroup
      const isoDate = parseAlphaGroupDate(rawDateStr);

      const shipmentPayload = {
        id: id,
        empresa_comercio: String(row[10] || '').trim() || null, // Nombre Fantasia
        tracking: tracking || null,
        tracking_url: String(row[30] || '').trim() || null, // URL Tracking
        courier: 'CARRIER EXTERNO',
        status: String(row[22] || '').trim() || null, // Estado
        servicio_tipo_envio: 'SAME DAY/24 HRS',
        nombre_destinatario: String(row[12] || '').trim() || null, // Nombre Destinatario
        telefono_destino: String(row[13] || '').trim() || null, // Tel. Destinatario
        email_cliente_destino: String(row[14] || '').trim() || null, // Email Destinatario
        direccion_destino: String(row[16] || '').trim() || null, // Dirección
        complemento_destino: String(row[29] || '').trim() || null, // Observaciones
        comuna_destino: String(row[18] || '').trim() || null, // Localidad
        raw_data: row,
        created_at: isoDate,
        updated_at: new Date().toISOString()
      };

      upsertPayloads.push(shipmentPayload);

      // --- Sincronizar en paralelo con la tabla principal de pedidos (orders) ---
      const matchKey = tracking || idml;
      if (matchKey) {
        let query = supabase
          .from('orders')
          .select('id, status, external_order_number, tracking_number, courier, lightdata_status');

        if (tracking) {
          query = query.or(`tracking_number.eq.${tracking},external_order_number.eq.${tracking}`);
        } else if (idml) {
          query = query.eq('external_order_number', idml);
        }

        const { data: dbOrders, error: findError } = await query;

        if (!findError && dbOrders && dbOrders.length > 0) {
          matchingOrdersCount++;
          const dbOrder = dbOrders[0];
          const mappedWmsStatus = mapLightDataStatusToWms(shipmentPayload.status);

          const updatePayload = {
            lightdata_status: shipmentPayload.status,
            raw_lightdata_data: shipmentPayload
          };

          if (mappedWmsStatus && mappedWmsStatus !== dbOrder.status) {
            updatePayload.status = mappedWmsStatus;
          }

          if (tracking && !dbOrder.tracking_number) {
            updatePayload.tracking_number = tracking;
          }

          if (tracking && !dbOrder.tracking_url && shipmentPayload.tracking_url) {
            updatePayload.tracking_url = shipmentPayload.tracking_url;
          }

          if (dbOrder.courier !== 'CARRIER EXTERNO') {
            updatePayload.courier = 'CARRIER EXTERNO';
          }

          const hasStatusChange = mappedWmsStatus && mappedWmsStatus !== dbOrder.status;
          const hasLightDataStatusChange = dbOrder.lightdata_status !== shipmentPayload.status;
          const hasCourierChange = dbOrder.courier !== 'CARRIER EXTERNO';
          const needsUpdate = hasStatusChange || hasLightDataStatusChange || hasCourierChange || !dbOrder.tracking_number;

          if (needsUpdate) {
            await supabase
              .from('orders')
              .update(updatePayload)
              .eq('id', dbOrder.id);
          }
        }
      }
    }

    // Realizar la inserción/actualización masiva en la tabla dedicada lightdata_envios
    if (upsertPayloads.length > 0) {
      console.log(`🚀 Subiendo ${upsertPayloads.length} registros a la tabla lightdata_envios...`);
      // Hacemos el upsert en lotes de 100 para no saturar la API en caso de payloads muy grandes
      const batchSize = 100;
      for (let i = 0; i < upsertPayloads.length; i += batchSize) {
        const batch = upsertPayloads.slice(i, i + batchSize);
        const { error: upsertError } = await supabase
          .from('lightdata_envios')
          .upsert(batch, { onConflict: 'id' });

        if (upsertError) {
          console.error(`❌ Error al subir lote de envíos en lightdata_envios:`, upsertError.message);
        } else {
          dbUpsertCount += batch.length;
        }
      }
    }

    // 5. Eliminar el archivo Excel temporal
    if (fs.existsSync(excelPath)) {
      fs.unlinkSync(excelPath);
      console.log('🗑️ Archivo Excel temporal eliminado.');
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
