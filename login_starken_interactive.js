const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Cargar archivo .env localmente si existe
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

const STARKEN_USERNAME = process.env.STARKEN_USERNAME || '';
const STARKEN_PASSWORD = process.env.STARKEN_PASSWORD || '';
const STATE_FILE = path.join(__dirname, 'starken_state.json');
const TARGET_URL = 'https://www.starkenpro.cl/login';

async function interactiveLogin() {
  console.log('====================================================');
  console.log('🚀 Asistente de Inicio de Sesión Starken Pro');
  console.log('====================================================');
  console.log('Abriendo Google Chrome en modo seguro...');
  console.log('====================================================\n');

  // Lanzar Chrome real sin marcas de automatización
  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--start-maximized'
    ]
  });

  let context;
  if (fs.existsSync(STATE_FILE)) {
    console.log('📂 Cargando sesión previa desde:', STATE_FILE);
    try {
      context = await browser.newContext({
        storageState: STATE_FILE,
        viewport: null,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
      });
    } catch (e) {
      context = await browser.newContext({
        viewport: null,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
      });
    }
  } else {
    context = await browser.newContext({
      viewport: null,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    });
  }

  // Ocultar webdriver
  await context.addInitScript(() => {
    delete navigator.__proto__.webdriver;
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    window.chrome = {
      runtime: {}
    };
  });

  const page = await context.newPage();

  console.log(`🌐 Navegando a ${TARGET_URL}...`);
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Si tenemos credenciales en .env, intentar autocompletar los campos para ahorrar tiempo
  if (STARKEN_USERNAME && STARKEN_PASSWORD) {
    try {
      console.log(`🔑 Intentando autocompletar credenciales de .env (${STARKEN_USERNAME})...`);
      const userInputs = page.locator('input[type="text"], input[name="rut"], input#rut, input[name="email"], input#email, input[placeholder*="RUT"], input[placeholder*="rut"]').first();
      const passInputs = page.locator('input[type="password"], input[name="password"], input#password').first();

      if (await userInputs.isVisible({ timeout: 4000 })) {
        await userInputs.fill(STARKEN_USERNAME);
      }
      if (await passInputs.isVisible({ timeout: 4000 })) {
        await passInputs.fill(STARKEN_PASSWORD);
      }
      console.log('✅ Credenciales ingresadas en el formulario.');
    } catch (e) {
      // Continuar normalmente si no los encuentra de inmediato
    }
  }

  console.log('\n👉 Por favor, revisa o ingresa tus credenciales y presiona "Ingresar" en la ventana de Chrome.');
  console.log('⏳ Esperando inicio de sesión exitoso...');

  let authenticated = false;
  const maxWaitMs = 300000; // 5 minutos
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const hasToken = await page.evaluate(() => {
        const token = localStorage.getItem('token');
        const user = localStorage.getItem('user');
        return !!(token && user);
      }).catch(() => false);

      if (hasToken) {
        console.log('\n✨ ¡Sesión activa y token detectados en Starken Pro!');
        authenticated = true;
        break;
      }
    } catch (e) {
      // Ventana navegando o recargando
    }

    await page.waitForTimeout(2000);
  }

  if (!authenticated) {
    console.error('\n❌ Tiempo de espera agotado o ventana cerrada sin iniciar sesión.');
    await browser.close().catch(() => {});
    process.exit(1);
  }

  // Esperar 2 segundos para estabilizar almacenamiento
  await page.waitForTimeout(2000);

  // Guardar storageState completo (cookies y localStorage)
  await context.storageState({ path: STATE_FILE });
  console.log(`💾 ¡Sesión guardada con éxito en ${STATE_FILE}!`);

  try {
    const userInfo = await page.evaluate(() => {
      const rawUser = localStorage.getItem('user');
      if (!rawUser) return null;
      try {
        return JSON.parse(rawUser);
      } catch (e) {
        return null;
      }
    });

    if (userInfo) {
      console.log(`👤 Usuario conectado: ${userInfo.name || userInfo.full_name || userInfo.email || userInfo.rut || 'Identificado'}`);
      if (userInfo.category) {
        console.log(`🏷️ Categoría: ${userInfo.category}`);
      }
    }
  } catch (e) {}

  console.log('\n====================================================');
  console.log('🎉 ¡Listo! Ya puedes ejecutar:');
  console.log('   npm run sync:starken');
  console.log('====================================================');

  await browser.close();
}

interactiveLogin().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
