const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

// Cargar archivo .env localmente de forma manual
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

const LIGHTDATA_USERNAME = process.env.LIGHTDATA_USERNAME;
const LIGHTDATA_PASSWORD = process.env.LIGHTDATA_PASSWORD;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const STATE_FILE = path.join(__dirname, 'lightdata_state.json');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const TARGET_URL = 'https://alphagroup.lightdata.com.ar/';

if (!LIGHTDATA_USERNAME || !LIGHTDATA_PASSWORD || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ ERROR: Faltan variables de entorno requeridas en el archivo .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Obtener argumentos de consola
const args = {};
process.argv.slice(2).forEach(arg => {
  if (arg.startsWith('--')) {
    const [key, value] = arg.slice(2).split('=');
    args[key] = value || true;
  }
});

const mode = args.mode || 'individual'; // 'individual' o 'bulk'
const orderId = args.orderId;
const limit = parseInt(args.limit || '10', 10);

async function main() {
  try {
    // 1. Limpieza de etiquetas Base64 antiguas (> 7 días) para ahorrar espacio
    await runCleanup();

    if (mode === 'individual') {
      if (!orderId) {
        console.error('❌ ERROR: Se requiere el parámetro --orderId=<UUID> en modo individual.');
        process.exit(1);
      }
      await handleIndividualMode(orderId);
    } else if (mode === 'bulk') {
      await handleBulkMode(limit);
    } else {
      console.error(`❌ ERROR: Modo desconocido: ${mode}`);
    }
  } catch (err) {
    console.error('❌ Error en el proceso principal:', err);
    process.exit(1);
  }
}

/**
 * Limpia las etiquetas Base64 en Supabase que tengan más de 7 días de antigüedad
 */
async function runCleanup() {
  console.log('🧹 Ejecutando limpieza de etiquetas temporales antiguas (> 7 días)...');
  const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  
  const { data, error, count } = await supabase
    .from('orders')
    .update({ label_base64: null })
    .lt('created_at', cutoffDate)
    .not('label_base64', 'is', null);

  if (error) {
    console.error('⚠️ Error al limpiar etiquetas antiguas:', error.message);
  } else {
    console.log('✅ Limpieza de etiquetas antiguas completada con éxito.');
  }
}

/**
 * Modo Individual: Procesa un solo pedido mediante el alta individual en LightData
 */
async function handleIndividualMode(idPedido) {
  console.log(`🔍 Buscando pedido con ID: ${idPedido} en Supabase...`);
  
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('*')
    .eq('id', idPedido)
    .maybeSingle();

  if (orderError || !order) {
    console.error('❌ ERROR: No se encontró el pedido o hubo un error:', orderError?.message);
    return;
  }

  console.log(`📦 Procesando pedido ${order.external_order_number} para el comercio ${order.comercio}...`);

  // Obtener la sigla correspondiente del comercio
  const sigla = await getCommerceSigla(order.comercio);
  const cleanOrderNum = String(order.external_order_number || order.id).replace(/[^a-zA-Z0-9]/g, '');
  const trackingCode = `${sigla}${cleanOrderNum}`;
  
  console.log(`🏷️ Código de tracking generado: ${trackingCode}`);

  const isCI = !!process.env.GITHUB_ACTIONS;
  const browser = await chromium.launch({
    headless: isCI || process.env.HEADLESS === 'true',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = fs.existsSync(STATE_FILE)
    ? await browser.newContext({ storageState: STATE_FILE })
    : await browser.newContext();

  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });

  try {
    console.log(`Navegando a: ${TARGET_URL}`);
    await page.goto(TARGET_URL);

    const isLoginPage = await page.locator('#username').isVisible().catch(() => false);
    if (isLoginPage) {
      console.log('🔐 Iniciando sesión en LightData...');
      await page.fill('#username', LIGHTDATA_USERNAME);
      await page.fill('#password', LIGHTDATA_PASSWORD);
      await page.click('#btnlogin');
      await page.waitForSelector('#username', { state: 'hidden', timeout: 30000 });
      await context.storageState({ path: STATE_FILE });
      console.log('💾 Sesión guardada.');
    }

    console.log('⏳ Esperando carga de la app...');
    await page.waitForSelector('table tbody tr', { timeout: 15000 });

    console.log('📂 Abriendo formulario de Alta Individual...');
    await page.evaluate(() => appEnviosFlexIndividual.open());
    await page.waitForSelector('#envio_altaIndividual_destinatario_nombre', { state: 'visible', timeout: 5000 });

    // Rellenar formulario
    console.log('✏️ Rellenando campos del formulario...');
    
    // Formatear fecha de venta a DD/MM/YYYY
    const dateObj = order.created_at ? new Date(order.created_at) : new Date();
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();
    const dateVentaFormatted = `${day}/${month}/${year}`;
    
    await page.fill('#envio_altaIndividual_idml', order.external_order_number || '');
    await page.fill('#envio_altaIndividual_tracking', trackingCode);
    await page.fill('#envio_altaIndividual_fechaventa', dateVentaFormatted); // Campo obligatorio corregido
    await page.fill('#envio_altaIndividual_destinatario_nombre', order.customer_name || 'Sin Nombre');
    await page.fill('#envio_altaIndividual_destinatario_telefono', String(order.customer_phone || '').replace(/[^\d+]/g, ''));
    await page.fill('#envio_altaIndividual_destinatario_email', order.customer_email || 'correo@temp.com');
    await page.fill('#envio_altaIndividual_referencia', 'CARRIER EXTERNO');
    await page.fill('#envio_altaIndividual_observacion', order.shipping_complement || '');

    // Procesar dirección
    let address = order.shipping_address || '';
    let street = address;
    let number = 'S/N'; // Fallback a S/N
    const numMatch = address.match(/^(.*?)\s+(\d+)\s*(.*)$/);
    if (numMatch) {
      street = numMatch[1].trim();
      number = numMatch[2].trim();
      if (numMatch[3]) {
        street += ' ' + numMatch[3].trim();
      }
    }
    await page.fill('#envio_altaIndividual_direccion_calle', street);
    await page.fill('#envio_altaIndividual_direccion_numero', number);

    // Seleccionar Comuna
    const comunaName = order.shipping_city || '';
    console.log(`🏙️ Seleccionando comuna: ${comunaName}`);
    try {
      await page.selectOption('#envio_altaIndividual_direccion_localidad', { label: comunaName });
    } catch (e) {
      console.warn(`⚠️ Advertencia: No se pudo seleccionar la comuna "${comunaName}" exactamente. Buscando coincidencia parcial...`);
      const matchedValue = await page.evaluate((comuna) => {
        const select = document.querySelector('#envio_altaIndividual_direccion_localidad');
        if (!select) return null;
        const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        const target = norm(comuna);
        for (const opt of select.options) {
          if (norm(opt.text).includes(target) || target.includes(norm(opt.text))) {
            return opt.value;
          }
        }
        return null;
      }, comunaName);

      if (matchedValue) {
        await page.selectOption('#envio_altaIndividual_direccion_localidad', matchedValue);
        console.log(`✅ Comuna resuelta a opción valor: ${matchedValue}`);
      } else {
        console.warn(`❌ No se encontró coincidencia de comuna. Se deja la predeterminada.`);
      }
    }

    // Interceptar la respuesta del API de altaEnvio para atrapar el did generado
    let createdDid = null;
    page.on('response', async (response) => {
      if (response.url().includes('altaEnvio')) {
        try {
          const text = await response.text();
          console.log(`🌐 Interceptada respuesta de altaEnvio. Status: ${response.status()}`);
          console.log(`🌐 Contenido crudo de respuesta: ${text}`);
          
          let json;
          try {
            json = JSON.parse(text);
          } catch (e) {
            console.error('⚠️ Error al parsear JSON de respuesta:', e.message);
          }

          if (json) {
            if (json.estado) {
              createdDid = json.dids || json.did || (json.detalle && json.detalle.dids);
              console.log(`🌐 API altaEnvio respondió con éxito. did/dids capturado: ${createdDid}`);
            } else {
              console.error(`❌ API altaEnvio reportó error interno en JSON:`, json.mensaje || json.error || json);
            }
          }
        } catch (e) {
          console.error('⚠️ Error al leer respuesta de red:', e.message);
        }
      }
    });

    console.log('💾 Presionando guardar...');
    await page.click('#btnguardarrenvioI');
    
    // Esperar a que aparezca cualquier modal de alerta (SweetAlert)
    console.log('⏳ Esperando modal de SweetAlert...');
    const swalPopupSelector = '.swal2-popup, .swal-modal, .sweet-alert';
    await page.waitForSelector(swalPopupSelector, { state: 'visible', timeout: 5000 }).catch(() => {
      console.warn('⚠️ No se detectó SweetAlert visible en 5 segundos.');
    });

    // Leer el título y texto de la alerta para diagnóstico
    const swalTitle = await page.evaluate(() => {
      const el = document.querySelector('.swal2-title, .swal-title, .sweet-alert h2');
      return el ? el.innerText.trim() : null;
    });
    const swalText = await page.evaluate(() => {
      const el = document.querySelector('.swal2-html-container, .swal2-content, .swal-text, .sweet-alert p');
      return el ? el.innerText.trim() : null;
    });
    console.log(`💬 Alerta SweetAlert detectada: [Título: "${swalTitle}"] [Texto: "${swalText}"]`);

    if (args.dryRun) {
      console.log('🚫 [Dry Run] Cancelando subida para evitar crear envíos reales de prueba.');
      await page.click('button:has-text("Volver"), button.swal2-cancel, button.swal-button--cancel').catch(() => {});
      console.log('🏁 [Dry Run] Prueba individual finalizada con éxito (datos correctos y formulario rellenado).');
      return;
    }

    // Si es una alerta de advertencia o error, no continuar
    const isErrorOrWarning = swalTitle && (
      swalTitle.toLowerCase().includes('error') || 
      swalTitle.toLowerCase().includes('debe') || 
      swalTitle.toLowerCase().includes('vac') ||
      swalTitle.toLowerCase().includes('obligatorio')
    );
    if (isErrorOrWarning) {
      console.error(`❌ ERROR: El alta no pudo continuar debido a una validación fallida de LightData: "${swalTitle}" - "${swalText}"`);
      await page.click('button:has-text("Volver"), button:has-text("OK"), button.swal2-confirm').catch(() => {});
      return;
    }

    // Confirmar en el diálogo Swal si es confirmación
    console.log('🤝 Confirmando alerta SweetAlert...');
    const confirmButton = page.locator('button:has-text("Si, subir"), button.swal2-confirm, button.swal-button--confirm').first();
    if (await confirmButton.isVisible()) {
      await confirmButton.click();
    } else {
      console.warn('⚠️ No se encontró el botón de confirmación "Si, subir". Intentando hacer clic en el botón confirm predeterminado.');
      await page.click('button.swal2-confirm, button.swal-button--confirm').catch(() => {});
    }

    // Esperar un momento a que termine el AJAX
    console.log('⏳ Esperando respuesta de la creación (AJAX)...');
    await page.waitForTimeout(6000);

    if (!createdDid) {
      console.error('❌ ERROR: No se pudo capturar el ID de envío (did) desde la respuesta de red de altaEnvio.');
      // Imprimir el estado actual del DOM de SweetAlert por si cambió
      const postSwalTitle = await page.evaluate(() => {
        const el = document.querySelector('.swal2-title, .swal-title');
        return el ? el.innerText.trim() : null;
      });
      console.log(`💬 Estado final de alerta SweetAlert: [${postSwalTitle}]`);
      return;
    }

    // Descargar etiqueta usando el did capturado
    console.log(`📥 Descargando etiqueta para el did: ${createdDid}...`);
    
    if (!fs.existsSync(DOWNLOADS_DIR)){
      fs.mkdirSync(DOWNLOADS_DIR);
    }
    const pdfPath = path.join(DOWNLOADS_DIR, `label_${createdDid}.pdf`);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.evaluate((did) => {
        window.g_did = did;
        appEnvios.downloadEtiqueta();
      }, createdDid)
    ]);

    await download.saveAs(pdfPath);
    console.log(`💾 Etiqueta guardada localmente en: ${pdfPath}`);

    // Leer PDF y codificar en Base64
    const pdfBase64 = fs.readFileSync(pdfPath, 'base64');

    // Actualizar el pedido en Supabase
    console.log('📡 Actualizando pedido en Supabase...');
    const { error: updateError } = await supabase
      .from('orders')
      .update({
        tracking_number: trackingCode,
        courier: 'CARRIER EXTERNO',
        servicio_tipo_envio: 'SAME DAY/24 HRS',
        label_base64: pdfBase64,
        estado_wms: 'preparado'
      })
      .eq('id', idPedido);

    if (updateError) {
      console.error('❌ Error al guardar datos en Supabase:', updateError.message);
    } else {
      console.log('🎉 Sincronización individual completada con éxito.');
    }

    // Limpiar archivo temporal
    if (fs.existsSync(pdfPath)) {
      fs.unlinkSync(pdfPath);
    }

  } catch (err) {
    console.error('❌ Excepción durante handleIndividualMode:', err.message);
  } finally {
    await browser.close();
  }
}

/**
 * Modo Masivo: Obtiene órdenes pendientes de un comercio y realiza una carga masiva por Excel
 */
async function handleBulkMode(limiteCarga) {
  console.log(`🔄 Iniciando procesamiento masivo de envíos (límite: ${limiteCarga})...`);
  
  // Obtener pedidos en estado 'preparado' que tengan courier 'LIGHTDATA' o 'PENDIENTE_LIGHTDATA' y no tengan tracking ni etiqueta
  const { data: pendingOrders, error: fetchError } = await supabase
    .from('orders')
    .select('*')
    .or('courier.eq.LIGHTDATA,courier.eq.PENDIENTE_LIGHTDATA,operador.eq.ALPHA')
    .is('tracking_number', null)
    .is('label_base64', null)
    .eq('estado_wms', 'preparado')
    .limit(limiteCarga);

  if (fetchError) {
    console.error('❌ Error al recuperar pedidos pendientes:', fetchError.message);
    return;
  }

  if (!pendingOrders || pendingOrders.length === 0) {
    console.log('ℹ️ No hay pedidos pendientes de etiqueta en LightData.');
    return;
  }

  console.log(`📦 Encontrados ${pendingOrders.length} pedidos listos para procesar masivamente.`);

  // Generar Excel según la plantilla de importación
  const excelRows = [];
  
  // Cabeceras oficiales
  const headers = [
    'Numero de tracking',
    'Fecha de venta',
    'Valor declarado',
    'Peso declarado',
    'Destinatario',
    'Teléfono de contacto',
    'Dirección',
    'Comuna',
    'Observaciones',
    'Email',
    'Referencia',
    '4 Total a cobrar',
    '1 Logistica Inversa'
  ];

  excelRows.push(headers);

  // Mapear cada orden al formato
  for (const order of pendingOrders) {
    const sigla = await getCommerceSigla(order.comercio);
    const cleanOrderNum = String(order.external_order_number || order.id).replace(/[^a-zA-Z0-9]/g, '');
    const trackingCode = `${sigla}${cleanOrderNum}`;
    
    const street = order.shipping_address || '';
    const comuna = order.shipping_city || '';
    const phone = String(order.customer_phone || '').replace(/[^\d+]/g, '');
    const email = order.customer_email || 'correo@temp.com';

    // Rellenar fila
    excelRows.push([
      trackingCode,                                // Numero de tracking
      new Date(order.created_at).toLocaleDateString('es-CL'), // Fecha de venta (DD/MM/YYYY)
      order.total_value || 0,                      // Valor declarado
      1,                                           // Peso declarado (por defecto 1 kg)
      order.customer_name || 'Sin Nombre',         // Destinatario
      phone,                                       // Teléfono de contacto
      street,                                      // Dirección
      comuna,                                      // Comuna
      order.shipping_complement || '',             // Observaciones
      email,                                       // Email
      'CARRIER EXTERNO',                           // Referencia
      '',                                          // 4 Total a cobrar
      ''                                           // 1 Logistica Inversa
    ]);
  }

  // Escribir archivo Excel temporal
  if (!fs.existsSync(DOWNLOADS_DIR)){
    fs.mkdirSync(DOWNLOADS_DIR);
  }
  const excelPath = path.join(DOWNLOADS_DIR, `import_${Date.now()}.xlsx`);
  const ws = xlsx.utils.aoa_to_sheet(excelRows);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Importacion');
  xlsx.writeFile(wb, excelPath);

  console.log(`📄 Excel de importación creado en: ${excelPath}`);

  const isCI = !!process.env.GITHUB_ACTIONS;
  const browser = await chromium.launch({
    headless: isCI || process.env.HEADLESS === 'true',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = fs.existsSync(STATE_FILE)
    ? await browser.newContext({ storageState: STATE_FILE })
    : await browser.newContext();

  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });

  try {
    console.log(`Navegando a: ${TARGET_URL}`);
    await page.goto(TARGET_URL);

    const isLoginPage = await page.locator('#username').isVisible().catch(() => false);
    if (isLoginPage) {
      console.log('🔐 Iniciando sesión...');
      await page.fill('#username', LIGHTDATA_USERNAME);
      await page.fill('#password', LIGHTDATA_PASSWORD);
      await page.click('#btnlogin');
      await page.waitForSelector('#username', { state: 'hidden', timeout: 30000 });
      await context.storageState({ path: STATE_FILE });
    }

    console.log('⏳ Esperando carga de la app...');
    await page.waitForSelector('table tbody tr', { timeout: 15000 });

    console.log('📂 Abriendo importador masivo (NoFlex)...');
    await page.evaluate(() => appEnviosNoFlex.open());
    await page.waitForSelector('#fileInputSubirEnviosNoflex', { state: 'hidden' }).catch(() => {});
    
    // Cargar archivo
    console.log('📤 Subiendo archivo Excel a LightData...');
    await page.setInputFiles('#fileInputSubirEnviosNoflex', excelPath);

    // Esperar parseo del cliente
    await page.waitForTimeout(3000);

    // Interceptar llamadas AJAX del procesamiento masivo
    let createdDidsStr = '';
    page.on('response', async (response) => {
      if (response.url().includes('controlador.php')) {
        try {
          const text = await response.text();
          const json = JSON.parse(text);
          if (json && json.estado && json.dids) {
            createdDidsStr = json.dids;
            console.log(`🌐 Controlador masivo respondió con dids: ${createdDidsStr}`);
          }
        } catch (e) {}
      }
    });

    console.log('⚙️ Iniciando procesamiento...');
    // Hacer clic en Procesar
    await page.click('a.btnVioleta:has-text("Procesar")').catch(() => {});
    await page.waitForTimeout(2000);

    // Hacer clic en Subir / Guardar
    console.log('💾 Subiendo envíos...');
    await page.click('#btnguardarrenvioI');
    
    // Confirmar diálogo Swal
    console.log('🤝 Confirmando alerta SweetAlert...');
    await page.click('button:has-text("Si, subir"), button.swal2-confirm', { timeout: 5000 }).catch(() => {});

    // Esperar respuesta de inserción
    await page.waitForTimeout(5000);

    if (!createdDidsStr) {
      console.error('❌ ERROR: No se pudieron capturar los dids de la respuesta de subida.');
      return;
    }

    const listDids = createdDidsStr.split(',').filter(Boolean);
    console.log(`📥 Descargando etiquetas consolidadas para ${listDids.length} envíos...`);

    const consolidatedPdfPath = path.join(DOWNLOADS_DIR, `consolidated_${Date.now()}.pdf`);

    // Descargar PDF Consolidado
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.evaluate((dids) => {
        // Ejecutar descarga consolidada de etiquetas usando los dids creados
        const diaActual = moment().format('YYYY-MM-DD');
        let data = {
          "didEmpresa": 61,
          "didEnvios": dids.split(','),
          "tipoEtiqueta": 2,
          "calidad": 0,
          "quien": 108
        };
        
        // Llamar directamente al print server de la misma forma que lo hace la app
        $.ajax({
          url: "https://printserver.lightdata.app/print/etiqueta",
          type: 'POST',
          data: JSON.stringify(data),
          contentType: 'application/json',
          xhrFields: {
            responseType: 'blob'
          },
          success: function (response) {
            const blob = new Blob([response], { type: 'application/pdf' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.setAttribute('download', `consolidated_${diaActual}.pdf`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }
        });
      }, createdDidsStr)
    ]);

    await download.saveAs(consolidatedPdfPath);
    console.log(`💾 PDF Consolidado descargado en: ${consolidatedPdfPath}`);

    // Codificar en Base64
    const consolidatedBase64 = fs.readFileSync(consolidatedPdfPath, 'base64');

    // Actualizar todos los pedidos procesados en Supabase
    // Al ser una descarga consolidada, para simplificar y asegurar que todos los pedidos tengan la etiqueta disponible,
    // guardaremos la etiqueta consolidada completa en todos los registros procesados en este lote.
    console.log('📡 Actualizando pedidos en Supabase con sus números de tracking y etiqueta...');
    
    for (let index = 0; index < pendingOrders.length; index++) {
      const order = pendingOrders[index];
      const sigla = await getCommerceSigla(order.comercio);
      const cleanOrderNum = String(order.external_order_number || order.id).replace(/[^a-zA-Z0-9]/g, '');
      const trackingCode = `${sigla}${cleanOrderNum}`;

      const { error: updateError } = await supabase
        .from('orders')
        .update({
          tracking_number: trackingCode,
          courier: 'CARRIER EXTERNO',
          servicio_tipo_envio: 'SAME DAY/24 HRS',
          label_base64: consolidatedBase64, // Etiqueta base64 guardada
          estado_wms: 'preparado'
        })
        .eq('id', order.id);

      if (updateError) {
        console.error(`⚠️ Error al actualizar orden ${order.external_order_number}:`, updateError.message);
      }
    }

    console.log('🎉 Carga masiva y actualización completada con éxito.');

    // Limpiar archivos temporales
    if (fs.existsSync(excelPath)) fs.unlinkSync(excelPath);
    if (fs.existsSync(consolidatedPdfPath)) fs.unlinkSync(consolidatedPdfPath);

  } catch (err) {
    console.error('❌ Excepción durante handleBulkMode:', err.message);
  } finally {
    await browser.close();
  }
}

/**
 * Obtiene la sigla del comercio resolviéndola desde Supabase
 */
async function getCommerceSigla(comercioName) {
  if (!comercioName) return 'STK';
  
  const { data, error } = await supabase
    .from('v_comercios_config')
    .select('sigla')
    .eq('nombre', comercioName.trim())
    .maybeSingle();

  if (error || !data) {
    // Si no se encuentra, buscar por coincidencia parcial o retornar por defecto
    const { data: list } = await supabase.from('v_comercios_config').select('sigla, nombre');
    if (list) {
      const match = list.find(c => c.nombre.toLowerCase().includes(comercioName.toLowerCase()));
      if (match) return match.sigla.trim().toUpperCase();
    }
    return 'STK';
  }
  
  return data.sigla.trim().toUpperCase();
}

main();
