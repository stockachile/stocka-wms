/**
 * STOCKA WMS — PWA Install & Web Push Onboarding Module (js/pwa_setup.js)
 * Gestiona:
 * 1. Registro temprano de /sw.js y captura de beforeinstallprompt.
 * 2. Modal guiado de 2 pasos: "Configura STOCKA en este dispositivo" (Instalar App + Activar Avisos).
 * 3. Suscripción PushManager con VAPID y sincronización en tabla Supabase public.push_subscriptions.
 * 4. Deep-linking en vivo cuando el usuario toca una notificación Web Push.
 * 5. Bloque reutilizable de gestión de dispositivos Push para la pestaña de Perfil / Notificaciones.
 */

(function () {
  'use strict';

  const SUPABASE_URL = 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
  const VAPID_PUBLIC_KEY = 'BF-Oh6HB1f1oOrbmuaQR7wZmyqm8viFjAhPCeWfznJ-6FjpBXVSPl7_kACPvzZCaYaP6OpPJZInwdeQWKwfzLrA';
  const SNOOZE_DAYS = 7;

  const state = {
    initialized: false,
    portal: 'client', // 'client' | 'admin'
    supabase: null,
    user: null,
    profile: null,
    swRegistration: null,
    deferredPrompt: null,
    isInstalled: false,
    isIos: false,
    isSafariDesktop: false,
    isFirefox: false,
    supportsPush: false,
    notificationPermission: 'default',
    currentSubscription: null,
    autoPromptScheduled: false,
    modalEl: null,
  };

  function detectEnvironment() {
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    const isIpadOs = platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    state.isIos = /iPad|iPhone|iPod/i.test(ua) || isIpadOs;
    state.isFirefox = /Firefox\//i.test(ua);
    state.isSafariDesktop = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua) && !state.isIos;
    state.isInstalled = Boolean(
      (window.matchMedia && (
        window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: window-controls-overlay)').matches
      )) ||
      window.navigator.standalone === true
    );
    state.supportsPush = Boolean(
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
    state.notificationPermission = ('Notification' in window) ? Notification.permission : 'unsupported';
  }

  function detectPortalFromPage() {
    if (window.StockaRouter && typeof window.StockaRouter.detectRole === 'function') {
      return window.StockaRouter.detectRole();
    }
    const path = (window.location.pathname || '').toLowerCase();
    return (path.startsWith('/admin') || path === '/conteo' || path === '/inventario-movil') ? 'admin' : 'client';
  }

  function getDeviceLabel() {
    const ua = navigator.userAgent || '';
    let browser = 'Navegador';
    if (/Edg\//i.test(ua)) browser = 'Edge';
    else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
    else if (/CriOS|Chrome\//i.test(ua)) browser = 'Chrome';
    else if (/Firefox|FxiOS/i.test(ua)) browser = 'Firefox';
    else if (/Safari/i.test(ua)) browser = 'Safari';

    let os = 'Equipo';
    if (/iPhone/i.test(ua)) os = 'iPhone';
    else if (/iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) os = 'iPad';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/Windows/i.test(ua)) os = 'Windows';
    else if (/Mac OS X/i.test(ua)) os = 'macOS';
    else if (/Linux/i.test(ua)) os = 'Linux';

    return `${browser} en ${os}${state.isInstalled ? ' (App)' : ''}`;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  function arrayBufferToBase64Url(buffer) {
    if (!buffer) return '';
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function getSnoozeKey() {
    return `stocka_pwa_snooze_until_${state.portal}`;
  }

  function isSnoozed() {
    try {
      const raw = localStorage.getItem(getSnoozeKey());
      if (!raw) return false;
      return Date.now() < Number(raw);
    } catch (_) {
      return false;
    }
  }

  function setSnooze(days = SNOOZE_DAYS) {
    try {
      localStorage.setItem(getSnoozeKey(), String(Date.now() + days * 24 * 60 * 60 * 1000));
    } catch (_) {}
  }

  function getSupabaseClient() {
    return state.supabase || window.supabaseClient || null;
  }

  async function ensureServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;
    if (state.swRegistration) return state.swRegistration;

    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      state.swRegistration = reg;
      // Esperar a que esté listo si aún está instalando
      try {
        const readyReg = await navigator.serviceWorker.ready;
        if (readyReg) state.swRegistration = readyReg;
      } catch (_) {}
      return state.swRegistration;
    } catch (err) {
      console.warn('[StockaPWA] No se pudo registrar /sw.js:', err);
      return null;
    }
  }

  async function getActiveSubscription() {
    try {
      const reg = await ensureServiceWorker();
      if (!reg || !reg.pushManager) return null;
      const sub = await reg.pushManager.getSubscription();
      state.currentSubscription = sub;
      return sub;
    } catch (_) {
      return null;
    }
  }

  async function syncSubscriptionToDb(subscription) {
    const client = getSupabaseClient();
    if (!client || !state.user || !subscription) return false;
    if (sessionStorage.getItem('wms_demo_mode') === 'true') return false;

    const json = typeof subscription.toJSON === 'function' ? subscription.toJSON() : null;
    const endpoint = subscription.endpoint;
    const p256dh = json?.keys?.p256dh || arrayBufferToBase64Url(subscription.getKey && subscription.getKey('p256dh'));
    const auth = json?.keys?.auth || arrayBufferToBase64Url(subscription.getKey && subscription.getKey('auth'));

    if (!endpoint || !p256dh || !auth) return false;

    try {
      const { error } = await client
        .from('push_subscriptions')
        .upsert(
          {
            user_id: state.user.id,
            endpoint,
            p256dh,
            auth,
            portal: state.portal,
            device_label: getDeviceLabel(),
            user_agent: (navigator.userAgent || '').slice(0, 350),
            is_standalone: state.isInstalled,
            is_active: true,
            last_seen_at: new Date().toISOString(),
            last_error: null,
          },
          { onConflict: 'endpoint' }
        );
      if (error) {
        console.warn('[StockaPWA] Error guardando suscripción push:', error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('[StockaPWA] Excepción guardando suscripción push:', err);
      return false;
    }
  }

  async function subscribePush() {
    detectEnvironment();
    if (!state.supportsPush) {
      if (state.isIos && !state.isInstalled) {
        return {
          ok: false,
          reason: 'ios_requires_install',
          message: 'En iPhone/iPad primero debes añadir la app a tu pantalla de inicio (Paso 1) y abrirla desde ese ícono.'
        };
      }
      return {
        ok: false,
        reason: 'unsupported',
        message: 'Este navegador no soporta notificaciones Web Push.'
      };
    }

    if (Notification.permission === 'denied') {
      state.notificationPermission = 'denied';
      updateModalUI();
      updateHeaderIndicator();
      return {
        ok: false,
        reason: 'denied',
        message: 'Las notificaciones están bloqueadas en tu navegador. Habilítalas desde el ícono junto a la URL y recarga.'
      };
    }

    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();

    state.notificationPermission = permission;

    if (permission !== 'granted') {
      updateModalUI();
      updateHeaderIndicator();
      return {
        ok: false,
        reason: permission,
        message: permission === 'denied'
          ? 'Permiso bloqueado. Puedes habilitarlo desde la configuración del sitio en tu navegador.'
          : 'No se otorgó el permiso de avisos. Puedes intentarlo nuevamente cuando quieras.'
      };
    }

    const reg = await ensureServiceWorker();
    if (!reg || !reg.pushManager) {
      return { ok: false, reason: 'no_sw', message: 'El Service Worker no está disponible en este contexto (requiere HTTPS).' };
    }

    try {
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }
      state.currentSubscription = sub;
      const saved = await syncSubscriptionToDb(sub);
      updateModalUI();
      updateHeaderIndicator();
      document.dispatchEvent(new CustomEvent('stocka:pwa-state-changed'));
      if (!saved) {
        return {
          ok: true,
          warning: true,
          message: 'Permiso otorgado en el navegador, pero no se pudo sincronizar con la nube todavía.'
        };
      }
      return {
        ok: true,
        subscription: sub,
        message: '¡Avisos activados! Recibirás alertas en tiempo real incluso con la app cerrada.'
      };
    } catch (err) {
      console.error('[StockaPWA] Error al suscribir PushManager:', err);
      return {
        ok: false,
        reason: 'subscribe_error',
        message: `No se pudo activar la suscripción push: ${err.message || err}`
      };
    }
  }

  async function unsubscribePush() {
    const client = getSupabaseClient();
    const sub = await getActiveSubscription();
    try {
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => {});
        if (client && state.user) {
          await client
            .from('push_subscriptions')
            .delete()
            .eq('user_id', state.user.id)
            .eq('endpoint', endpoint);
        }
      }
      state.currentSubscription = null;
      updateModalUI();
      updateHeaderIndicator();
      document.dispatchEvent(new CustomEvent('stocka:pwa-state-changed'));
      return { ok: true };
    } catch (err) {
      console.warn('[StockaPWA] Error al desuscribir:', err);
      return { ok: false, error: err.message };
    }
  }

  async function invokePushEdgeFunction(payload) {
    const client = getSupabaseClient();
    if (!client) return { ok: false, error: 'Supabase no inicializado' };
    if (sessionStorage.getItem('wms_demo_mode') === 'true') {
      return { ok: false, error: 'No disponible en modo demo' };
    }

    const { data: { session } } = await client.auth.getSession();
    if (!session?.access_token) {
      return { ok: false, error: 'Sesión no activa' };
    }

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-web-push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, status: res.status, error: data.error || `HTTP ${res.status}` };
      }
      return { ok: true, ...data };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  async function sendTestPush() {
    if (!state.currentSubscription) {
      const subRes = await subscribePush();
      if (!subRes.ok) return subRes;
    }
    return await invokePushEdgeFunction({
      test_self: true,
      portal: state.portal,
      title: state.portal === 'admin' ? '✅ Avisos Admin activos en STOCKA' : '✅ Avisos activos en STOCKA WMS',
      body: state.portal === 'admin'
        ? '¡Listo! Recibirás alertas de tickets, ingresos y operación en este dispositivo.'
        : '¡Listo! Te avisaremos al instante de facturas, pagos, ingresos y respuestas a tus tickets.',
      url: state.portal === 'admin' ? '/admin' : '/panel',
    });
  }

  async function triggerInstallPrompt() {
    if (state.isInstalled) {
      return { ok: true, outcome: 'already_installed' };
    }
    if (!state.deferredPrompt) {
      return { ok: false, outcome: 'unavailable' };
    }

    try {
      const promptEvent = state.deferredPrompt;
      state.deferredPrompt = null;
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice && choice.outcome === 'accepted') {
        state.isInstalled = true;
        updateModalUI();
        updateHeaderIndicator();
        document.dispatchEvent(new CustomEvent('stocka:pwa-state-changed'));
        return { ok: true, outcome: 'accepted' };
      }
      updateModalUI();
      return { ok: false, outcome: 'dismissed' };
    } catch (err) {
      console.warn('[StockaPWA] Error al lanzar prompt de instalación:', err);
      return { ok: false, outcome: 'error', error: err.message };
    }
  }

  function isPushReady() {
    return state.notificationPermission === 'granted' && Boolean(state.currentSubscription);
  }

  function isEverythingReady() {
    const installDoneOrNotApplicable = state.isInstalled || (!state.deferredPrompt && !state.isIos);
    return installDoneOrNotApplicable && isPushReady();
  }

  function updateHeaderIndicator() {
    const dot = document.getElementById('pwa-header-dot');
    const btn = document.getElementById('pwa-setup-header-btn');
    if (!btn) return;

    const pushOk = isPushReady();
    const allOk = state.isInstalled && pushOk;

    if (dot) {
      if (allOk) {
        dot.style.display = 'block';
        dot.classList.add('is-ready');
      } else if (state.deferredPrompt || !pushOk) {
        dot.style.display = 'block';
        dot.classList.remove('is-ready');
      } else {
        dot.style.display = 'none';
      }
    }

    btn.title = allOk
      ? 'STOCKA App instalada y avisos activos'
      : 'Configurar app en este dispositivo y activar avisos';
  }

  function showModalFeedback(type, text) {
    if (!state.modalEl) return;
    const box = state.modalEl.querySelector('#stocka-pwa-feedback');
    if (!box) return;
    if (!text) {
      box.className = 'stocka-pwa-feedback';
      box.innerHTML = '';
      return;
    }
    const icon = type === 'success'
      ? 'ri-checkbox-circle-fill'
      : type === 'error'
        ? 'ri-error-warning-fill'
        : 'ri-information-fill';
    box.className = `stocka-pwa-feedback is-visible stocka-pwa-feedback--${type}`;
    box.innerHTML = `<i class="${icon}" style="font-size: 1rem; flex-shrink: 0; margin-top: 1px;"></i><span>${escapeHtml(text)}</span>`;
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildModalIfNeeded() {
    if (state.modalEl && document.body.contains(state.modalEl)) return state.modalEl;

    const isAdmin = state.portal === 'admin';
    const appName = isAdmin ? 'STOCKA Admin' : 'STOCKA WMS';
    const urlDisplay = isAdmin ? 'wms.stocka.cl/admin' : 'wms.stocka.cl/panel';
    const notifPreviewTitle = isAdmin
      ? '🎫 Nuevo ticket urgente'
      : '🧾 Tu factura está lista';
    const notifPreviewBody = isAdmin
      ? 'Soporte · Comercio abrió un caso prioritario. Revísalo en un clic.'
      : 'Fulfillment · revísala y gestiona tu pago en un clic.';

    const backdrop = document.createElement('div');
    backdrop.id = 'stocka-pwa-modal-backdrop';
    backdrop.className = 'stocka-pwa-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-labelledby', 'stocka-pwa-modal-title');

    backdrop.innerHTML = `
      <div class="stocka-pwa-modal">
        <button type="button" class="stocka-pwa-close" id="stocka-pwa-close-btn" aria-label="Cerrar">
          <i class="ri-close-line"></i>
        </button>

        <div class="stocka-pwa-header">
          <img src="/img/pwa/icon-192.png" alt="${appName}" class="stocka-pwa-app-icon">
          <div>
            <h3 id="stocka-pwa-modal-title" class="stocka-pwa-title">Configura ${appName} en este dispositivo</h3>
            <p class="stocka-pwa-subtitle">
              ${isAdmin
                ? 'Dos pasos para tener el centro de control a mano: instala la app y activa los avisos.'
                : 'Dos pasos para tener tu operación a mano: instala la app y activa los avisos.'}
            </p>
          </div>
        </div>

        <div class="stocka-pwa-steps">
          <!-- PASO 1: INSTALA LA APP -->
          <div class="stocka-pwa-step-card" id="stocka-pwa-step1-card">
            <div class="stocka-pwa-step-top">
              <div class="stocka-pwa-step-heading">
                <span class="stocka-pwa-step-num" id="stocka-pwa-step1-num">1</span>
                <span class="stocka-pwa-step-title">Instala la app</span>
              </div>
              <span class="stocka-pwa-pill stocka-pwa-pill--pending" id="stocka-pwa-step1-pill">Pendiente</span>
            </div>

            <div id="stocka-pwa-step1-visual">
              <div class="stocka-pwa-browser-mock">
                <div class="stocka-pwa-urlbar">
                  <div class="stocka-pwa-urlpill">${urlDisplay}</div>
                  <div class="stocka-pwa-url-install-dot" title="Instalar app">
                    <i class="ri-download-line"></i>
                  </div>
                </div>
                <div class="stocka-pwa-native-dialog">
                  <div class="stocka-pwa-native-dialog-row">
                    <img src="/img/pwa/icon-192.png" alt="${appName}" class="stocka-pwa-native-dialog-icon">
                    <div>
                      <div class="stocka-pwa-native-dialog-title">¿Instalar la app?</div>
                      <div class="stocka-pwa-native-dialog-sub">${appName}</div>
                    </div>
                  </div>
                  <div class="stocka-pwa-native-dialog-actions">
                    <span class="stocka-pwa-native-install-chip">Instalar</span>
                  </div>
                </div>
              </div>
            </div>

            <p class="stocka-pwa-step-desc" id="stocka-pwa-step1-desc">
              Con el botón de abajo se abre la ventana para instalarla: confirma con «Instalar». Queda con su ícono en el escritorio o en el inicio del celular.
            </p>
          </div>

          <!-- PASO 2: ACTIVA LOS AVISOS -->
          <div class="stocka-pwa-step-card" id="stocka-pwa-step2-card">
            <div class="stocka-pwa-step-top">
              <div class="stocka-pwa-step-heading">
                <span class="stocka-pwa-step-num" id="stocka-pwa-step2-num">2</span>
                <span class="stocka-pwa-step-title">Activa los avisos</span>
              </div>
              <span class="stocka-pwa-pill stocka-pwa-pill--pending" id="stocka-pwa-step2-pill">Pendiente</span>
            </div>

            <div class="stocka-pwa-notif-mock">
              <img src="/img/pwa/icon-192.png" alt="${appName}" class="stocka-pwa-notif-mock-icon">
              <div>
                <div class="stocka-pwa-notif-mock-title">${notifPreviewTitle}</div>
                <div class="stocka-pwa-notif-mock-body">${notifPreviewBody}</div>
              </div>
            </div>

            <p class="stocka-pwa-step-desc" id="stocka-pwa-step2-desc">
              ${isAdmin
                ? 'Te avisamos al instante de nuevos tickets, respuestas de clientes, ingresos declarados y alertas críticas, aunque tengas la app cerrada. El navegador te pedirá permiso: elige «Permitir».'
                : 'Te avisamos al instante de facturas, pagos, ingresos de stock, incidencias y respuestas a tus tickets, aunque tengas la app cerrada. El navegador te pedirá permiso: elige «Permitir».'}
            </p>

            <div class="stocka-pwa-step-inline-action" id="stocka-pwa-step2-inline" style="display: none;">
              <button type="button" class="stocka-pwa-link-btn" id="stocka-pwa-only-push-btn">
                <i class="ri-notification-3-line"></i> Solo activar avisos ahora
              </button>
            </div>
          </div>
        </div>

        <div id="stocka-pwa-feedback" class="stocka-pwa-feedback"></div>

        <div class="stocka-pwa-footer">
          <button type="button" id="stocka-pwa-primary-btn" class="stocka-pwa-primary-btn">
            Instalar y activar avisos
          </button>
          <button type="button" id="stocka-pwa-later-btn" class="stocka-pwa-later-btn">
            Más tarde
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    state.modalEl = backdrop;

    // Eventos del modal
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal(false);
    });

    backdrop.querySelector('#stocka-pwa-close-btn').addEventListener('click', () => closeModal(false));
    backdrop.querySelector('#stocka-pwa-later-btn').addEventListener('click', () => {
      setSnooze(SNOOZE_DAYS);
      closeModal(true);
    });

    backdrop.querySelector('#stocka-pwa-only-push-btn').addEventListener('click', async () => {
      await handleActivatePushOnly();
    });

    backdrop.querySelector('#stocka-pwa-primary-btn').addEventListener('click', async () => {
      await handlePrimaryAction();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.modalEl && state.modalEl.classList.contains('is-open')) {
        closeModal(false);
      }
    });

    return backdrop;
  }

  function updateModalUI() {
    if (!state.modalEl) return;
    detectEnvironment();

    const step1Card = state.modalEl.querySelector('#stocka-pwa-step1-card');
    const step1Num = state.modalEl.querySelector('#stocka-pwa-step1-num');
    const step1Pill = state.modalEl.querySelector('#stocka-pwa-step1-pill');
    const step1Visual = state.modalEl.querySelector('#stocka-pwa-step1-visual');
    const step1Desc = state.modalEl.querySelector('#stocka-pwa-step1-desc');

    const step2Card = state.modalEl.querySelector('#stocka-pwa-step2-card');
    const step2Num = state.modalEl.querySelector('#stocka-pwa-step2-num');
    const step2Pill = state.modalEl.querySelector('#stocka-pwa-step2-pill');
    const step2Desc = state.modalEl.querySelector('#stocka-pwa-step2-desc');
    const step2Inline = state.modalEl.querySelector('#stocka-pwa-step2-inline');

    const primaryBtn = state.modalEl.querySelector('#stocka-pwa-primary-btn');
    const laterBtn = state.modalEl.querySelector('#stocka-pwa-later-btn');

    const pushOk = isPushReady();
    const pushDenied = state.notificationPermission === 'denied';
    const hasNativePrompt = Boolean(state.deferredPrompt);
    const isAdmin = state.portal === 'admin';
    const appName = isAdmin ? 'STOCKA Admin' : 'STOCKA WMS';
    const urlDisplay = isAdmin ? 'wms.stocka.cl/admin' : 'wms.stocka.cl/panel';

    // --- PASO 1: INSTALACIÓN ---
    step1Card.classList.remove('is-done', 'is-blocked');
    if (state.isInstalled) {
      step1Card.classList.add('is-done');
      step1Num.innerHTML = '<i class="ri-check-line"></i>';
      step1Pill.className = 'stocka-pwa-pill stocka-pwa-pill--done';
      step1Pill.innerHTML = '<i class="ri-check-line"></i> Listo';
      step1Visual.style.display = 'none';
      step1Desc.textContent = `¡Excelente! ${appName} ya está instalada y ejecutándose como aplicación en este dispositivo.`;
    } else if (state.isIos) {
      step1Num.textContent = '1';
      step1Pill.className = 'stocka-pwa-pill stocka-pwa-pill--pending';
      step1Pill.textContent = 'Pendiente';
      step1Visual.style.display = 'block';
      step1Visual.innerHTML = `
        <div class="stocka-pwa-ios-guide">
          <span>1. Toca</span>
          <span class="stocka-pwa-ios-chip"><i class="ri-share-box-line"></i> Compartir</span>
          <span>→ 2. Elige</span>
          <span class="stocka-pwa-ios-chip"><i class="ri-add-box-line"></i> Añadir a inicio</span>
        </div>
      `;
      step1Desc.textContent = 'En Safari (iPhone/iPad) agrega la app desde el menú Compartir. Luego ábrela desde el ícono en tu pantalla de inicio para activar los avisos.';
    } else {
      step1Num.textContent = '1';
      step1Visual.style.display = 'block';
      step1Visual.innerHTML = `
        <div class="stocka-pwa-browser-mock">
          <div class="stocka-pwa-urlbar">
            <div class="stocka-pwa-urlpill">${urlDisplay}</div>
            <div class="stocka-pwa-url-install-dot" title="Instalar app">
              <i class="ri-download-line"></i>
            </div>
          </div>
          <div class="stocka-pwa-native-dialog">
            <div class="stocka-pwa-native-dialog-row">
              <img src="/img/pwa/icon-192.png" alt="${appName}" class="stocka-pwa-native-dialog-icon">
              <div>
                <div class="stocka-pwa-native-dialog-title">¿Instalar la app?</div>
                <div class="stocka-pwa-native-dialog-sub">${appName}</div>
              </div>
            </div>
            <div class="stocka-pwa-native-dialog-actions">
              <span class="stocka-pwa-native-install-chip">Instalar</span>
            </div>
          </div>
        </div>
      `;

      if (hasNativePrompt) {
        step1Pill.className = 'stocka-pwa-pill stocka-pwa-pill--pending';
        step1Pill.textContent = 'Pendiente';
        step1Desc.textContent = 'Con el botón de abajo se abre la ventana para instalarla: confirma con «Instalar». Queda con su ícono en el escritorio o en el inicio del celular.';
      } else if (state.isSafariDesktop) {
        step1Pill.className = 'stocka-pwa-pill stocka-pwa-pill--info';
        step1Pill.textContent = 'Desde Safari';
        step1Desc.textContent = 'En Safari para Mac puedes fijarla desde el menú superior: Archivo → Agregar al Dock.';
      } else if (state.isFirefox) {
        step1Pill.className = 'stocka-pwa-pill stocka-pwa-pill--info';
        step1Pill.textContent = 'Opcional';
        step1Desc.textContent = 'Firefox no incluye instalación directa en escritorio, pero sí puedes activar los avisos en el Paso 2.';
      } else {
        step1Pill.className = 'stocka-pwa-pill stocka-pwa-pill--info';
        step1Pill.textContent = 'Desde navegador';
        step1Desc.textContent = 'Si ya la instalaste antes, ábrela desde tu escritorio o menú de apps. Si no, usa el ícono de instalar en la barra superior de Chrome/Edge.';
      }
    }

    // --- PASO 2: AVISOS PUSH ---
    step2Card.classList.remove('is-done', 'is-blocked');
    step2Inline.style.display = 'none';

    if (pushOk) {
      step2Card.classList.add('is-done');
      step2Num.innerHTML = '<i class="ri-check-line"></i>';
      step2Pill.className = 'stocka-pwa-pill stocka-pwa-pill--done';
      step2Pill.innerHTML = '<i class="ri-check-line"></i> Listo';
      step2Desc.textContent = '¡Avisos activos en este dispositivo! Recibirás alertas instantáneas incluso con la app cerrada.';
    } else if (pushDenied) {
      step2Card.classList.add('is-blocked');
      step2Num.innerHTML = '<i class="ri-close-line"></i>';
      step2Pill.className = 'stocka-pwa-pill stocka-pwa-pill--blocked';
      step2Pill.textContent = 'Bloqueado';
      step2Desc.textContent = 'El navegador tiene bloqueados los avisos para wms.stocka.cl. Haz clic en el ícono de configuración junto a la dirección web → Notificaciones → Permitir y recarga.';
    } else if (state.isIos && !state.isInstalled) {
      step2Num.textContent = '2';
      step2Pill.className = 'stocka-pwa-pill stocka-pwa-pill--pending';
      step2Pill.textContent = 'Tras paso 1';
      step2Desc.textContent = 'En iPhone/iPad los avisos se habilitan apenas abras STOCKA WMS desde el ícono añadido a tu pantalla de inicio.';
    } else {
      step2Num.textContent = '2';
      step2Pill.className = 'stocka-pwa-pill stocka-pwa-pill--pending';
      step2Pill.textContent = 'Pendiente';
      step2Desc.textContent = isAdmin
        ? 'Te avisamos al instante de nuevos tickets, respuestas de clientes, ingresos declarados y alertas críticas, aunque tengas la app cerrada. El navegador te pedirá permiso: elige «Permitir».'
        : 'Te avisamos al instante de facturas, pagos, ingresos de stock, incidencias y respuestas a tus tickets, aunque tengas la app cerrada. El navegador te pedirá permiso: elige «Permitir».';

      if (hasNativePrompt && !state.isInstalled) {
        step2Inline.style.display = 'flex';
      }
    }

    // --- BOTÓN PRINCIPAL DINÁMICO ---
    primaryBtn.disabled = false;
    primaryBtn.classList.remove('stocka-pwa-primary-btn--success');
    laterBtn.textContent = 'Más tarde';

    if (pushOk && (state.isInstalled || !hasNativePrompt)) {
      primaryBtn.classList.add('stocka-pwa-primary-btn--success');
      primaryBtn.innerHTML = '<i class="ri-notification-badge-line"></i> Enviar aviso de prueba';
      laterBtn.textContent = 'Cerrar';
    } else if (!state.isInstalled && hasNativePrompt && !pushOk && !pushDenied) {
      primaryBtn.innerHTML = 'Instalar y activar avisos';
    } else if (!state.isInstalled && hasNativePrompt && (pushOk || pushDenied)) {
      primaryBtn.innerHTML = '<i class="ri-install-line"></i> Instalar la app';
    } else if (state.isIos && !state.isInstalled) {
      primaryBtn.innerHTML = '<i class="ri-check-line"></i> Entendido';
    } else if (!pushOk && !pushDenied && state.supportsPush) {
      primaryBtn.innerHTML = '<i class="ri-notification-3-line"></i> Activar avisos';
    } else {
      primaryBtn.innerHTML = '<i class="ri-check-line"></i> Entendido';
      laterBtn.textContent = 'Cerrar';
    }
  }

  async function handleActivatePushOnly() {
    const primaryBtn = state.modalEl?.querySelector('#stocka-pwa-primary-btn');
    if (primaryBtn) primaryBtn.disabled = true;
    showModalFeedback('info', 'Esperando confirmación en el cuadro de permiso del navegador...');

    const res = await subscribePush();
    if (res.ok) {
      showModalFeedback('success', res.message || '¡Avisos activados correctamente!');
    } else {
      showModalFeedback(res.reason === 'denied' ? 'error' : 'info', res.message);
    }
    updateModalUI();
  }

  async function handlePrimaryAction() {
    const primaryBtn = state.modalEl?.querySelector('#stocka-pwa-primary-btn');
    const pushOk = isPushReady();
    const pushDenied = state.notificationPermission === 'denied';
    const hasNativePrompt = Boolean(state.deferredPrompt);

    // Caso 1: Todo listo -> enviar notificación push de prueba real
    if (pushOk && (state.isInstalled || !hasNativePrompt)) {
      if (primaryBtn) {
        primaryBtn.disabled = true;
        primaryBtn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Enviando prueba...';
      }
      const res = await sendTestPush();
      if (res.ok && res.sent > 0) {
        showModalFeedback('success', '¡Aviso de prueba enviado! Deberías verlo aparecer ahora mismo en tu dispositivo.');
      } else if (res.ok) {
        showModalFeedback('info', 'Solicitud procesada. Si no ves el aviso, verifica que "No molestar" esté desactivado en tu sistema.');
      } else {
        showModalFeedback('error', `No se pudo enviar el aviso de prueba: ${res.error || 'Error de conexión'}`);
      }
      updateModalUI();
      return;
    }

    // Caso 2: iOS sin instalar aún -> cerrar guiando
    if (state.isIos && !state.isInstalled) {
      closeModal(false);
      return;
    }

    // Caso 3: Hay prompt de instalación nativo disponible
    if (!state.isInstalled && hasNativePrompt) {
      if (primaryBtn) {
        primaryBtn.disabled = true;
        primaryBtn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Abriendo instalador...';
      }
      const installRes = await triggerInstallPrompt();
      if (installRes.ok) {
        if (!pushOk && !pushDenied && state.supportsPush) {
          showModalFeedback('success', '¡App instalada! Ahora confirma el Paso 2 para activar los avisos.');
          // Intentar encadenar permiso push si el navegador conservó el user gesture; si no, el botón quedó listo en "Activar avisos"
          try {
            const pushRes = await subscribePush();
            if (pushRes.ok) {
              showModalFeedback('success', '¡Todo listo! App instalada y avisos activados en este dispositivo.');
            }
          } catch (_) {
            showModalFeedback('success', '¡App instalada! Haz clic en «Activar avisos» para completar el Paso 2.');
          }
        } else {
          showModalFeedback('success', '¡App instalada correctamente en tu dispositivo!');
        }
      } else {
        showModalFeedback('info', 'Instalación cancelada. Puedes intentarlo nuevamente o activar solo los avisos.');
      }
      updateModalUI();
      return;
    }

    // Caso 4: Activar avisos Push
    if (!pushOk && !pushDenied && state.supportsPush) {
      await handleActivatePushOnly();
      return;
    }

    closeModal(false);
  }

  function openModal(options = {}) {
    detectEnvironment();
    const modal = buildModalIfNeeded();
    showModalFeedback('', '');
    updateModalUI();
    requestAnimationFrame(() => {
      modal.classList.add('is-open');
    });
    if (options.onOpen) options.onOpen();
  }

  function closeModal(snoozed = false) {
    if (!state.modalEl) return;
    state.modalEl.classList.remove('is-open');
    if (snoozed) updateHeaderIndicator();
  }

  function hasBlockingOverlayOpen() {
    if (window.Swal && typeof window.Swal.isVisible === 'function' && window.Swal.isVisible()) return true;
    if (document.querySelector('.swal2-container, .tour-welcome-modal, .tour-overlay, #stocka-tour-overlay')) return true;
    if (document.querySelector('.modal-overlay.active, .modal-overlay[style*="display: flex"]')) return true;
    return false;
  }

  function scheduleAutoPrompt() {
    if (state.autoPromptScheduled) return;
    if (sessionStorage.getItem('wms_demo_mode') === 'true') return;
    if (isSnoozed()) return;

    state.autoPromptScheduled = true;

    let attempts = 0;
    const tryShow = async () => {
      attempts++;
      detectEnvironment();
      await getActiveSubscription();
      updateHeaderIndicator();

      const needsPush = state.supportsPush && state.notificationPermission === 'default' && !state.currentSubscription;
      const needsInstall = !state.isInstalled && (Boolean(state.deferredPrompt) || state.isIos);

      if (!needsPush && !needsInstall) return;
      if (isSnoozed()) return;

      if (hasBlockingOverlayOpen()) {
        if (attempts < 8) {
          setTimeout(tryShow, 5000);
        }
        return;
      }

      openModal({ auto: true });
    };

    setTimeout(tryShow, 4200);
  }

  /**
   * Renderiza el bloque de administración de PWA y Push en Perfil / Notificaciones
   */
  async function renderDevicePushCard(targetContainer) {
    if (!targetContainer) return;
    detectEnvironment();
    await getActiveSubscription();

    const pushOk = isPushReady();
    const pushDenied = state.notificationPermission === 'denied';
    const isAdmin = state.portal === 'admin';
    const appName = isAdmin ? 'STOCKA Admin' : 'STOCKA WMS';

    let devices = [];
    const client = getSupabaseClient();
    if (client && state.user && sessionStorage.getItem('wms_demo_mode') !== 'true') {
      try {
        const { data } = await client
          .from('push_subscriptions')
          .select('id, device_label, portal, is_standalone, last_seen_at, endpoint')
          .eq('user_id', state.user.id)
          .eq('is_active', true)
          .order('last_seen_at', { ascending: false });
        devices = data || [];
      } catch (_) {}
    }

    const currentEndpoint = state.currentSubscription?.endpoint || '';

    const devicesHtml = devices.length > 0
      ? `
        <div class="pwa-devices-list">
          <div style="font-size: 0.8rem; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.04em;">
            Dispositivos vinculados (${devices.length})
          </div>
          ${devices.map(d => {
            const isThis = currentEndpoint && d.endpoint === currentEndpoint;
            const dateStr = d.last_seen_at
              ? new Date(d.last_seen_at).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
              : '';
            return `
              <div class="pwa-device-row" data-sub-id="${escapeHtml(d.id)}">
                <div style="display: flex; align-items: center; gap: 0.6rem; min-width: 0;">
                  <i class="${d.is_standalone ? 'ri-smartphone-line' : 'ri-computer-line'}" style="font-size: 1.1rem; color: var(--color-primary);"></i>
                  <div style="min-width: 0;">
                    <div style="font-weight: 600; color: var(--color-text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                      ${escapeHtml(d.device_label || 'Dispositivo')} ${isThis ? '<span style="color: #10b981; font-size: 0.72rem; font-weight: 700;">(Este dispositivo)</span>' : ''}
                    </div>
                    <div style="font-size: 0.75rem; color: var(--color-text-muted);">
                      Portal ${d.portal === 'admin' ? 'Admin' : 'Cliente'} · Última actividad: ${escapeHtml(dateStr)}
                    </div>
                  </div>
                </div>
                <button type="button" class="btn btn-outline btn-sm pwa-remove-device-btn" data-sub-id="${escapeHtml(d.id)}" data-is-this="${isThis ? '1' : '0'}" style="padding: 0.25rem 0.6rem; font-size: 0.75rem; color: var(--color-danger); border-color: rgba(239,68,68,0.35);">
                  <i class="ri-delete-bin-line"></i> Quitar
                </button>
              </div>
            `;
          }).join('')}
        </div>
      `
      : '';

    targetContainer.innerHTML = `
      <div class="pwa-profile-card">
        <div class="section-card-header" style="padding: 1.15rem 1.35rem; border-bottom: 1px solid var(--color-border); display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 0.85rem;">
            <img src="/img/pwa/icon-192.png" alt="${appName}" style="width: 38px; height: 38px; border-radius: 10px; flex-shrink: 0;">
            <div>
              <h3 style="margin: 0; font-size: 1.05rem; font-weight: 700; color: var(--color-text-main);">App en este Dispositivo y Avisos Push</h3>
              <p style="margin: 2px 0 0; font-size: 0.83rem; color: var(--color-text-muted);">Instala ${appName} en tu escritorio o celular y recibe alertas instantáneas aunque tengas el navegador cerrado.</p>
            </div>
          </div>
          <button type="button" class="btn btn-outline btn-sm" id="pwa-profile-open-wizard-btn" style="display: inline-flex; align-items: center; gap: 0.4rem; white-space: nowrap;">
            <i class="ri-smartphone-line"></i> Asistente de configuración
          </button>
        </div>

        <div style="padding: 1.25rem 1.35rem;">
          <div class="pwa-profile-status-grid">
            <div class="pwa-profile-stat-box">
              <div>
                <div style="font-size: 0.78rem; color: var(--color-text-muted); font-weight: 600;">Aplicación instalada</div>
                <div style="font-size: 0.92rem; font-weight: 700; color: var(--color-text-main); margin-top: 2px;">
                  ${state.isInstalled ? 'Instalada (App)' : 'Usando en navegador'}
                </div>
              </div>
              <span class="stocka-pwa-pill ${state.isInstalled ? 'stocka-pwa-pill--done' : 'stocka-pwa-pill--pending'}">
                ${state.isInstalled ? 'Listo' : 'Pendiente'}
              </span>
            </div>

            <div class="pwa-profile-stat-box">
              <div>
                <div style="font-size: 0.78rem; color: var(--color-text-muted); font-weight: 600;">Avisos Push en este equipo</div>
                <div style="font-size: 0.92rem; font-weight: 700; color: var(--color-text-main); margin-top: 2px;">
                  ${pushOk ? 'Activos' : pushDenied ? 'Bloqueados en navegador' : 'Inactivos'}
                </div>
              </div>
              <span class="stocka-pwa-pill ${pushOk ? 'stocka-pwa-pill--done' : pushDenied ? 'stocka-pwa-pill--blocked' : 'stocka-pwa-pill--pending'}">
                ${pushOk ? 'Activo' : pushDenied ? 'Bloqueado' : 'Pendiente'}
              </span>
            </div>
          </div>

          <div class="pwa-profile-actions">
            ${!pushOk && !pushDenied ? `
              <button type="button" class="btn btn-primary btn-sm" id="pwa-profile-enable-push-btn" style="display: inline-flex; align-items: center; gap: 0.4rem;">
                <i class="ri-notification-3-line"></i> Activar avisos en este dispositivo
              </button>
            ` : ''}
            ${pushOk ? `
              <button type="button" class="btn btn-primary btn-sm" id="pwa-profile-test-push-btn" style="display: inline-flex; align-items: center; gap: 0.4rem;">
                <i class="ri-send-plane-line"></i> Enviar aviso de prueba
              </button>
              <button type="button" class="btn btn-outline btn-sm" id="pwa-profile-disable-push-btn" style="display: inline-flex; align-items: center; gap: 0.4rem;">
                <i class="ri-notification-off-line"></i> Desactivar en este equipo
              </button>
            ` : ''}
            ${!state.isInstalled && state.deferredPrompt ? `
              <button type="button" class="btn btn-outline btn-sm" id="pwa-profile-install-btn" style="display: inline-flex; align-items: center; gap: 0.4rem;">
                <i class="ri-download-cloud-2-line"></i> Instalar ${appName}
              </button>
            ` : ''}
          </div>

          <div id="pwa-profile-msg" style="margin-top: 0.75rem; font-size: 0.82rem; display: none;"></div>
          ${devicesHtml}
        </div>
      </div>
    `;

    const msgEl = targetContainer.querySelector('#pwa-profile-msg');
    const setMsg = (text, color = 'var(--color-primary)') => {
      if (!msgEl) return;
      msgEl.textContent = text;
      msgEl.style.color = color;
      msgEl.style.display = 'block';
    };

    targetContainer.querySelector('#pwa-profile-open-wizard-btn')?.addEventListener('click', () => openModal({ force: true }));

    targetContainer.querySelector('#pwa-profile-install-btn')?.addEventListener('click', async () => {
      await triggerInstallPrompt();
      renderDevicePushCard(targetContainer);
    });

    targetContainer.querySelector('#pwa-profile-enable-push-btn')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      const res = await subscribePush();
      await renderDevicePushCard(targetContainer);
      const nextMsg = targetContainer.querySelector('#pwa-profile-msg');
      if (nextMsg) {
        nextMsg.textContent = res.message || (res.ok ? '¡Avisos activados!' : 'No se pudieron activar los avisos.');
        nextMsg.style.color = res.ok ? 'var(--color-success)' : 'var(--color-danger)';
        nextMsg.style.display = 'block';
      }
    });

    targetContainer.querySelector('#pwa-profile-test-push-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Enviando...';
      const res = await sendTestPush();
      btn.disabled = false;
      btn.innerHTML = '<i class="ri-send-plane-line"></i> Enviar aviso de prueba';
      if (res.ok && res.sent > 0) {
        setMsg('¡Aviso de prueba enviado! Revisa la notificación de tu sistema.', 'var(--color-success)');
      } else {
        setMsg(res.error || 'No se pudo entregar el aviso de prueba.', 'var(--color-danger)');
      }
    });

    targetContainer.querySelector('#pwa-profile-disable-push-btn')?.addEventListener('click', async () => {
      await unsubscribePush();
      await renderDevicePushCard(targetContainer);
    });

    targetContainer.querySelectorAll('.pwa-remove-device-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const subId = btn.getAttribute('data-sub-id');
        const isThis = btn.getAttribute('data-is-this') === '1';
        btn.disabled = true;
        if (isThis) {
          await unsubscribePush();
        } else if (client && state.user && subId) {
          await client.from('push_subscriptions').delete().eq('id', subId).eq('user_id', state.user.id);
        }
        await renderDevicePushCard(targetContainer);
      });
    });
  }

  function setupServiceWorkerMessageBridge() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('message', async (event) => {
      const data = event.data || {};
      if (data.type === 'STOCKA_PUSH_RESUBSCRIBE') {
        if (Notification.permission === 'granted' && state.user) {
          await subscribePush();
        }
      } else if (data.type === 'STOCKA_PUSH_NAVIGATE' && data.pathname) {
        try {
          if (window.StockaRouter) {
            const role = window.StockaRouter.detectRole();
            const cleanSegments = String(data.pathname).split('/').filter(Boolean);
            const slug = cleanSegments[1] || '';
            const targetLink = slug
              ? document.querySelector(`.sidebar-nav .nav-item[href$="/${slug}"]`)
              : document.querySelector(`.sidebar-nav .nav-item[data-view="dashboard"]`);
            if (targetLink) {
              targetLink.click();
            }
          }
        } catch (_) {}
      } else if (data.type === 'STOCKA_PUSH_RECEIVED' && data.payload) {
        if (typeof window.showStockaNotification === 'function') {
          window.showStockaNotification({
            type: 'info',
            title: data.payload.title || 'STOCKA WMS',
            message: data.payload.body || '',
            duration: 6000,
          });
        }
      }
    });
  }

  function bindGlobalListeners() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      state.deferredPrompt = e;
      updateModalUI();
      updateHeaderIndicator();
      document.dispatchEvent(new CustomEvent('stocka:pwa-state-changed'));
    });

    window.addEventListener('appinstalled', () => {
      state.isInstalled = true;
      state.deferredPrompt = null;
      if (state.currentSubscription) {
        syncSubscriptionToDb(state.currentSubscription);
      }
      updateModalUI();
      updateHeaderIndicator();
      document.dispatchEvent(new CustomEvent('stocka:pwa-state-changed'));
    });

    // Botones del header / menú de cuenta
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('#pwa-setup-header-btn, [data-open-pwa-setup]');
      if (trigger) {
        e.preventDefault();
        // Cerrar dropdown de perfil si estaba abierto
        document.querySelectorAll('#client-profile-dropdown, #admin-profile-dropdown').forEach((dd) => {
          dd.style.display = 'none';
        });
        openModal({ force: true });
      }
    });
  }

  async function init(options = {}) {
    detectEnvironment();
    state.portal = options.portal || detectPortalFromPage();
    if (options.supabase) state.supabase = options.supabase;
    if (options.user) state.user = options.user;
    if (options.profile) state.profile = options.profile;

    await ensureServiceWorker();
    const existingSub = await getActiveSubscription();
    if (existingSub && state.user) {
      await syncSubscriptionToDb(existingSub);
    }

    updateHeaderIndicator();

    if (!state.initialized) {
      state.initialized = true;
      scheduleAutoPrompt();
    }
  }

  // Inicialización temprana de listeners y registro del Service Worker
  detectEnvironment();
  state.portal = detectPortalFromPage();
  bindGlobalListeners();
  setupServiceWorkerMessageBridge();
  ensureServiceWorker();

  // API pública global
  window.StockaPWA = {
    VAPID_PUBLIC_KEY,
    init,
    openModal,
    closeModal,
    subscribePush,
    unsubscribePush,
    sendTestPush,
    sendPush: invokePushEdgeFunction,
    triggerInstallPrompt,
    renderDevicePushCard,
    getState: () => ({
      portal: state.portal,
      isInstalled: state.isInstalled,
      isIos: state.isIos,
      supportsPush: state.supportsPush,
      permission: state.notificationPermission,
      hasSubscription: Boolean(state.currentSubscription),
      canInstallNatively: Boolean(state.deferredPrompt),
    }),
  };
})();
