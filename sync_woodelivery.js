const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Cargar archivo .env localmente de forma manual si existe
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf-8');
  envConfig.split(/\r?\n/).forEach(line => {
    // Evitar líneas vacías o comentarios
    if (!line || line.startsWith('#')) return;
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      const value = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
      process.env[key.trim()] = value;
    }
  });
}

// ==========================================
// CONFIGURACIÓN DE WOODELIVERY & VARIABLES ENTORNO
// ==========================================
const WOODELIVERY_EMAIL = process.env.WOODELIVERY_EMAIL || 'TU_CORREO@ejemplo.com';
const WOODELIVERY_PASSWORD = process.env.WOODELIVERY_PASSWORD || 'TU_CONTRASEÑA';
const STATE_FILE = path.join(__dirname, 'woodelivery_state.json');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

// URLs de la plataforma
const LOGIN_URL = 'https://app.wodely.com/';
const ORDERS_URL = 'https://app.wodely.com/'; // Wodely redirige al dashboard tras iniciar sesión

async function syncWooDelivery() {
  console.log('Iniciando proceso de automatización con Woodelivery/Wodely...');

  if (WOODELIVERY_EMAIL === 'TU_CORREO@ejemplo.com' || WOODELIVERY_PASSWORD === 'TU_CONTRASEÑA') {
    console.warn('\n[ADVERTENCIA]: Estás usando las credenciales por defecto. Por favor configure las variables de entorno:');
    console.warn('WOODELIVERY_EMAIL y WOODELIVERY_PASSWORD\n');
  }

  // 1. Lanzar el navegador.
  // headless: false permite ver visualmente la ventana del navegador. Cambia a true para producción/background.
  const browser = await chromium.launch({ 
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  let context;

  // 2. Intentar cargar la sesión/cookies previa para no loguearse de nuevo
  if (fs.existsSync(STATE_FILE)) {
    console.log('Cargando sesión persistida desde:', STATE_FILE);
    context = await browser.newContext({ storageState: STATE_FILE });
  } else {
    console.log('No se encontró sesión previa. Se creará una sesión nueva.');
    context = await browser.newContext();
  }

  const page = await context.newPage();

  try {
    // Ajustar el tamaño de la pantalla
    await page.setViewportSize({ width: 1280, height: 800 });

    console.log(`Navegando a la página de Wodely: ${ORDERS_URL}`);
    await page.goto(ORDERS_URL);

    // 3. Evaluar si necesitamos iniciar sesión
    // Si la URL actual nos redirigió a la pantalla de login o vemos el campo de usuario
    const isLoginPage = page.url().includes('/Identity/Account/Login') || await page.locator('#Input_UserName').isVisible().catch(() => false);

    if (isLoginPage) {
      console.log('Sesión no activa. Procediendo a iniciar sesión...');

      // --- IMPORTANTE: Usando selectores reales de app.wodely.com ---
      console.log('Escribiendo credenciales...');
      await page.fill('#Input_UserName', WOODELIVERY_EMAIL);
      await page.fill('#Input_Password', WOODELIVERY_PASSWORD);

      // Esperar brevemente para simular comportamiento humano
      await page.waitForTimeout(500);

      // Hacer click en el botón de ingresar
      console.log('Enviando formulario...');
      await page.click('button[type="submit"]');

      // Esperar a salir de la pantalla de login y entrar a una URL interna segura
      console.log('Esperando redirección post-login...');
      await page.waitForURL((url) => !url.href.includes('/Identity/Account/Login'), { timeout: 60000 });

      // Guardar el estado de sesión actual para evitar hacer login la próxima vez
      await context.storageState({ path: STATE_FILE });
      console.log('¡Inicio de sesión exitoso! Estado guardado en:', STATE_FILE);
    } else {
      console.log('¡Sesión válida cargada con éxito! Evitamos el proceso de login.');
    }

    // 4. Asegurar que la página de datos haya cargado
    // Esperamos a que algún selector clave de la tabla o contenedor esté listo
    console.log('Esperando la carga de elementos en la página de pedidos...');
    // Reemplaza '.table' o similar con un selector representativo de Woodelivery
    await page.waitForSelector('body', { state: 'visible' }); 

    // Asegurarse de que exista el directorio de descargas
    if (!fs.existsSync(DOWNLOADS_DIR)){
        fs.mkdirSync(DOWNLOADS_DIR);
    }

    // 5. Simular el clic en el botón de Exportar (CSV / Excel)
    console.log('Buscando botón de exportación de datos...');
    
    // --- EJEMPLO DE DESCARGA DE ARCHIVO ---
    // NOTA: Debes reemplazar 'button#exportar-datos' con el selector real del botón.
    // Si no tiene ID único, puedes buscar por texto: "button:has-text('Export')" o "a:has-text('Descargar')"
    const exportButtonSelector = "button:has-text('Export'), a:has-text('Exportar'), button.btn-export";
    
    const isExportButtonVisible = await page.locator(exportButtonSelector).first().isVisible().catch(() => false);
    
    if (isExportButtonVisible) {
      console.log('Botón de exportar detectado. Iniciando descarga...');
      
      const [download] = await Promise.all([
        page.waitForEvent('download'), // Espera a que se dispare la descarga
        page.locator(exportButtonSelector).first().click() // Ejecuta el click
      ]);

      const filename = `woodelivery_export_${Date.now()}.csv`;
      const finalPath = path.join(DOWNLOADS_DIR, filename);
      await download.saveAs(finalPath);
      console.log(`¡Archivo descargado con éxito! Guardado en: ${finalPath}`);
    } else {
      console.log('No se pudo ubicar un botón de exportar visible con los selectores por defecto.');
      console.log('Intenta analizar el HTML de Woodelivery y actualizar el selector "exportButtonSelector" en este script.');
      
      // --- EJEMPLO ALTERNATIVO: Extraer datos del HTML (Scraping básico de tabla) ---
      console.log('Intentando extraer datos directamente de la tabla en pantalla (Scraping HTML)...');
      const tableData = await page.evaluate(() => {
        // Esto corre dentro del contexto del navegador
        const rows = Array.from(document.querySelectorAll('table tbody tr'));
        return rows.map(row => {
          const cols = Array.from(row.querySelectorAll('td'));
          return cols.map(col => col.innerText.trim());
        });
      });
      
      if (tableData.length > 0) {
        console.log(`Se extrajeron ${tableData.length} filas desde la vista actual.`);
        console.log('Ejemplo de datos extraídos (primeras 3 filas):', tableData.slice(0, 3));
      } else {
        console.log('No se encontraron tablas o filas de datos en el selector estándar.');
      }
    }

    // Pausa interactiva para permitir inspeccionar selectores en modo de prueba
    console.log('\n[INFO]: El navegador se mantendrá abierto para que puedas inspeccionar los elementos.');
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise(resolve => rl.question('Presiona ENTER en esta terminal para cerrar el navegador...', () => {
      rl.close();
      resolve();
    }));

  } catch (error) {
    console.error('Ha ocurrido un error durante la ejecución de Playwright:', error);
  } finally {
    // 6. Cerrar el navegador al finalizar
    console.log('Cerrando navegador...');
    await browser.close();
  }
}

// Ejecutar
syncWooDelivery();
