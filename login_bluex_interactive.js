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

const BLUEX_USERNAME = process.env.BLUEX_USERNAME || '';
const BLUEX_PASSWORD = process.env.BLUEX_PASSWORD || '';
const STATE_FILE = path.join(__dirname, 'bluex_state.json');
const TARGET_URL = 'https://app.bluex.cl/dashboard';

async function interactiveLogin() {
  console.log('====================================================');
  console.log('🚀 Asistente de Inicio de Sesión Blue Express');
  console.log('====================================================');
  console.log('Abriendo Google Chrome real en modo seguro para permitir');
  console.log('el inicio de sesión con Google o con correo/contraseña.');
  console.log('====================================================\n');

  // Lanzar Chrome real sin banderas de automatización para que Google no lo bloquee
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

  // Ocultar marcas de webdriver para que Google OAuth permita iniciar sesión
  await context.addInitScript(() => {
    delete navigator.__proto__.webdriver;
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    // Chrome runtime mock
    window.chrome = {
      runtime: {}
    };
  });

  const page = await context.newPage();

  console.log(`🌐 Navegando a ${TARGET_URL}...`);
  await page.goto(TARGET_URL);

  console.log('\n👉 Por favor, inicia sesión con Google o con tu correo en la ventana de Chrome abierta.');
  console.log('⏳ Esperando inicio de sesión exitoso...');

  // Esperar a que el usuario complete el login y llegue a app.bluex.cl con token
  let authenticated = false;
  const maxWaitMs = 300000; // 5 minutos para dar tiempo a 2FA o Google
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      if (page.url().includes('app.bluex.cl')) {
        const hasToken = await page.evaluate(() => {
          const token = localStorage.getItem('__accessToken');
          const user = localStorage.getItem('__sessionUser');
          return !!(token || user);
        }).catch(() => false);

        if (hasToken) {
          console.log('✨ ¡Sesión activa detectada en app.bluex.cl!');
          authenticated = true;
          break;
        }
      }
    } catch (e) {
      // Ventana navegando
    }

    await page.waitForTimeout(2000);
  }

  if (!authenticated) {
    console.error('❌ Tiempo de espera agotado o ventana cerrada sin iniciar sesión.');
    await browser.close().catch(() => {});
    process.exit(1);
  }

  // Esperar 2 segundos para asegurar almacenamiento de todos los tokens
  await page.waitForTimeout(2000);

  // Guardar storageState completo (cookies y localStorage)
  await context.storageState({ path: STATE_FILE });
  console.log(`\n💾 ¡Sesión guardada con éxito en ${STATE_FILE}!`);

  try {
    const userInfo = await page.evaluate(() => {
      const rawUser = localStorage.getItem('__sessionUser');
      if (!rawUser) return null;
      try {
        return JSON.parse(atob(rawUser));
      } catch (e) {
        return null;
      }
    });

    if (userInfo) {
      console.log(`👤 Usuario conectado: ${userInfo.email || userInfo.name || userInfo.username || 'Identificado'}`);
      if (userInfo.pyme) {
        console.log(`🏢 Pyme asociada: ${userInfo.pyme.name || userInfo.pyme.razon_social || ''}`);
      }
    }
  } catch (e) {}

  console.log('\n====================================================');
  console.log('🎉 ¡Listo! Ya puedes ejecutar:');
  console.log('   npm run sync:bluex');
  console.log('====================================================');

  await browser.close();
}

interactiveLogin().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
