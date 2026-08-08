import supabase from './supabase.js';

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const alertContainer = document.getElementById('alert-container');
  const loginBtn = document.getElementById('login-btn');

  // Función para mostrar alertas con animación de error (shake)
  const showAlert = (message, type = 'error') => {
    alertContainer.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
    if (type === 'error') {
      const authCard = document.querySelector('.auth-card');
      if (authCard) {
        authCard.classList.remove('shake');
        void authCard.offsetWidth; // Trigger reflow to restart animation
        authCard.classList.add('shake');
        setTimeout(() => authCard.classList.remove('shake'), 600);
      }
    }
    setTimeout(() => {
      alertContainer.innerHTML = '';
    }, 5000);
  };

  // Elementos de Registro
  const registerForm = document.getElementById('register-form');
  const regNameInput = document.getElementById('reg-name');
  const regCompanyInput = document.getElementById('reg-company');
  const regEmailInput = document.getElementById('reg-email');
  const regPasswordInput = document.getElementById('reg-password');
  const registerBtn = document.getElementById('register-btn');

  // Enlaces de Alternancia
  const toggleToRegister = document.getElementById('toggle-to-register');
  const toggleToLogin = document.getElementById('toggle-to-login');
  
  const authTitle = document.querySelector('.auth-title');
  const authSubtitle = document.querySelector('.auth-subtitle');

  // Alternar a Registro
  if (toggleToRegister) {
    toggleToRegister.addEventListener('click', (e) => {
      e.preventDefault();
      alertContainer.innerHTML = '';
      loginForm.style.display = 'none';
      registerForm.style.display = 'block';
      registerForm.classList.add('auth-fade-in');
      authTitle.textContent = 'Crear Cuenta';
      authSubtitle.textContent = 'Regístrate para comenzar a gestionar tu inventario y despachos.';
    });
  }

  // Alternar a Login
  if (toggleToLogin) {
    toggleToLogin.addEventListener('click', (e) => {
      e.preventDefault();
      alertContainer.innerHTML = '';
      registerForm.style.display = 'none';
      loginForm.style.display = 'block';
      loginForm.classList.add('auth-fade-in');
      authTitle.textContent = 'Bienvenido';
      authSubtitle.textContent = 'Ingresa tus credenciales para acceder a tu bodega online.';
    });
  }

  // Detectar si venimos de un redireccionamiento de autenticación (PKCE o Hash)
  const isAuthRedirect = new URLSearchParams(window.location.search).has('code') || 
                         window.location.hash.includes('type=recovery') || 
                         window.location.href.includes('type=recovery');

  // Check si ya hay sesión activa
  const checkSession = async () => {
    // Si venimos de un flujo de autenticación (como confirmación o recovery), no redireccionar inmediatamente.
    // Dejamos que onAuthStateChange maneje el flujo correspondiente de forma asíncrona.
    if (isAuthRedirect) {
      console.log('Flujo de redireccionamiento de autenticación detectado. Esperando eventos de Supabase...');
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      // Fetch role and redirect
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
      const role = profile ? profile.role : 'client';
      window.location.href = role === 'admin' ? 'admin.html' : 'dashboard.html';
    }
  };

  // Probar si el servidor de Supabase está activo
  const checkSupabaseStatus = async () => {
    const banner = document.getElementById('db-status-banner');
    if (!banner) return;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout

      const res = await fetch('https://ejtjfaucnxbikrwjwwdu.supabase.co/rest/v1/', {
        method: 'GET',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.status >= 500) {
        banner.style.display = 'flex';
      } else {
        banner.style.display = 'none';
      }
    } catch (err) {
      console.warn('Supabase status check: offline/error detected', err);
      banner.style.display = 'flex';
    }
  };

  checkSupabaseStatus();
  checkSession();

  const showResetForm = () => {
    alertContainer.innerHTML = '';
    loginForm.style.display = 'none';
    if (registerForm) registerForm.style.display = 'none';
    forgotForm.style.display = 'none';
    const resetForm = document.getElementById('reset-form');
    if (resetForm) {
      resetForm.style.display = 'block';
      resetForm.classList.add('auth-fade-in');
    }
    authTitle.textContent = 'Restablecer Contraseña';
    authSubtitle.textContent = 'Ingresa tu nueva contraseña para actualizar tu cuenta.';
  };

  // Escuchar cambios en el estado de autenticación (esencial para flujos asíncronos como PKCE)
  supabase.auth.onAuthStateChange(async (event, session) => {
    console.log('Evento de autenticación detectado:', event);
    if (event === 'PASSWORD_RECOVERY') {
      window.isRecoveryMode = true;
      showResetForm();
    }
  });

  // Handle Demo Registration Toggle
  const demoLoginBtn = document.getElementById('demo-login-btn');
  const toggleToLoginFromDemo = document.getElementById('toggle-to-login-from-demo');
  const demoRegisterForm = document.getElementById('demo-register-form');
  const demoRegNameInput = document.getElementById('demo-reg-name');
  const demoRegEmailInput = document.getElementById('demo-reg-email');
  const demoRegPasswordInput = document.getElementById('demo-reg-password');
  const demoRegisterSubmitBtn = document.getElementById('demo-register-btn');

  if (demoLoginBtn) {
    demoLoginBtn.addEventListener('click', (e) => {
      e.preventDefault();
      alertContainer.innerHTML = '';
      loginForm.style.display = 'none';
      if (registerForm) registerForm.style.display = 'none';
      if (forgotForm) forgotForm.style.display = 'none';
      if (demoRegisterForm) {
        demoRegisterForm.style.display = 'block';
        demoRegisterForm.classList.add('auth-fade-in');
      }
      authTitle.textContent = 'Solicitar Demo';
      authSubtitle.textContent = 'Ingresa tus datos para registrar tu cuenta de prueba. Recibirás un enlace de confirmación por correo electrónico.';
    });
  }

  // Alternar de Demo a Login
  if (toggleToLoginFromDemo) {
    toggleToLoginFromDemo.addEventListener('click', (e) => {
      e.preventDefault();
      alertContainer.innerHTML = '';
      if (demoRegisterForm) demoRegisterForm.style.display = 'none';
      loginForm.style.display = 'block';
      loginForm.classList.add('auth-fade-in');
      authTitle.textContent = 'Bienvenido';
      authSubtitle.textContent = 'Ingresa tus credenciales para acceder a tu bodega online.';
    });
  }

  // Handle Demo Register Submit
  if (demoRegisterForm) {
    demoRegisterForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const name = demoRegNameInput.value.trim();
      const email = demoRegEmailInput.value.trim();
      const password = demoRegPasswordInput.value.trim();

      if (!name || !email || !password) {
        showAlert('Por favor, completa todos los campos.');
        return;
      }

      if (password.length < 8) {
        showAlert('La contraseña debe tener al menos 8 caracteres.');
        return;
      }

      demoRegisterSubmitBtn.disabled = true;
      demoRegisterSubmitBtn.textContent = 'Enviando solicitud...';

      try {
        // Registrar usuario real en Supabase marcado como demo user
        const { data, error } = await supabase.auth.signUp({
          email: email,
          password: password,
          options: {
            data: {
              full_name: name,
              company_name: 'Demo - ' + name,
              is_demo_user: true
            }
          }
        });

        if (error) throw error;

        showAlert('¡Registro de demo exitoso! Te hemos enviado un enlace de confirmación a tu correo. Por favor, confírmalo para poder ingresar.', 'success');
        
        // Limpiar y volver a login después de unos segundos
        setTimeout(() => {
          demoRegisterForm.reset();
          if (toggleToLoginFromDemo) toggleToLoginFromDemo.click();
        }, 5000);

      } catch (error) {
        let msg = error.message;
        if (typeof msg === 'object') msg = JSON.stringify(msg);
        if (msg === '{}' || msg === '[object Object]') msg = '';
        showAlert(msg || 'Error al registrar la demo. Inténtalo de nuevo.');
      } finally {
        demoRegisterSubmitBtn.disabled = false;
        demoRegisterSubmitBtn.textContent = 'Solicitar Acceso Demo';
      }
    });
  }

  // Handle Login
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();

    if (email.toLowerCase() === 'demo@stocka.cl') {
      loginBtn.disabled = true;
      loginBtn.innerHTML = '<i class="ri-loader-4-line" style="display: inline-block; animation: spin 1s linear infinite; margin-right: 0.35rem;"></i> Ingresando...';
      
      // Activar modo demo en sessionStorage
      sessionStorage.setItem('wms_demo_mode', 'true');
      
      // Loader de transición premium a pantalla completa
      const loader = document.createElement('div');
      loader.id = 'premium-login-loader';
      loader.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(15, 23, 42, 0.92); backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        z-index: 9999; opacity: 0; transition: opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        font-family: 'Inter', sans-serif;
      `;
      loader.innerHTML = `
        <div style="position: relative; display: flex; align-items: center; justify-content: center; margin-bottom: 2rem;">
          <div style="width: 86px; height: 86px; border: 4px solid rgba(94, 23, 235, 0.1); border-top-color: var(--color-accent); border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
          <div style="position: absolute; width: 60px; height: 60px; background: rgba(94, 23, 235, 0.08); border-radius: 50%; display: flex; align-items: center; justify-content: center; animation: pulse 1.4s ease-in-out infinite;">
            <img src="https://cdn.shopify.com/s/files/1/0625/6141/9483/files/newlogotransp.png?v=1779852093" style="width: 26px; height: 26px; object-fit: contain;" alt="Logo">
          </div>
        </div>
        <h3 style="color: #fff; font-size: 1.25rem; font-weight: 700; margin: 0 0 0.5rem 0; letter-spacing: -0.01em; text-align: center;">Preparando Entorno Demo</h3>
        <p style="color: rgba(255, 255, 255, 0.5); font-size: 0.85rem; margin: 0; animation: fadePulse 1.4s ease-in-out infinite; text-align: center;">Cargando base de datos ficticia segura...</p>
      `;
      document.body.appendChild(loader);
      
      void loader.offsetWidth;
      loader.style.opacity = '1';
      
      setTimeout(() => {
        window.location.href = 'dashboard.html';
      }, 1300);
      return;
    }

    if (!email || !password) {
      showAlert('Por favor, ingresa correo y contraseña.');
      return;
    }

    loginBtn.disabled = true;
    loginBtn.innerHTML = '<i class="ri-loader-4-line" style="display: inline-block; animation: spin 1s linear infinite; margin-right: 0.35rem;"></i> Ingresando...';

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: password,
      });

      if (error) throw error;

      if (data.session) {
        const { data: profile } = await supabase.from('profiles').select('role').eq('id', data.session.user.id).single();
        const role = profile ? profile.role : 'client';
        
        // Loader de transición premium a pantalla completa
        const loader = document.createElement('div');
        loader.id = 'premium-login-loader';
        loader.style.cssText = `
          position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
          background: rgba(15, 23, 42, 0.92); backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          z-index: 9999; opacity: 0; transition: opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          font-family: 'Inter', sans-serif;
        `;
        loader.innerHTML = `
          <div style="position: relative; display: flex; align-items: center; justify-content: center; margin-bottom: 2rem;">
            <!-- Outer progress circle -->
            <div style="width: 86px; height: 86px; border: 4px solid rgba(94, 23, 235, 0.1); border-top-color: var(--color-accent); border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
            <!-- Inner glowing logo pulse -->
            <div style="position: absolute; width: 60px; height: 60px; background: rgba(94, 23, 235, 0.08); border-radius: 50%; display: flex; align-items: center; justify-content: center; animation: pulse 1.4s ease-in-out infinite;">
              <img src="https://cdn.shopify.com/s/files/1/0625/6141/9483/files/newlogotransp.png?v=1779852093" style="width: 26px; height: 26px; object-fit: contain;" alt="Logo">
            </div>
          </div>
          <h3 style="color: #fff; font-size: 1.25rem; font-weight: 700; margin: 0 0 0.5rem 0; letter-spacing: -0.01em; text-align: center;">Preparando tu Bodega</h3>
          <p style="color: rgba(255, 255, 255, 0.5); font-size: 0.85rem; margin: 0; animation: fadePulse 1.4s ease-in-out infinite; text-align: center;">Estableciendo conexión segura...</p>
        `;
        document.body.appendChild(loader);
        
        // Forzar reflow e iniciar fade-in de la transición
        void loader.offsetWidth;
        loader.style.opacity = '1';
        
        setTimeout(() => {
          window.location.href = role === 'admin' ? 'admin.html' : 'dashboard.html';
        }, 1300);
      }
    } catch (error) {
      let msg = error.message;
      if (typeof msg === 'object') msg = JSON.stringify(msg);
      if (msg === '{}' || msg === '[object Object]') msg = '';
      showAlert(msg || 'Error al iniciar sesión. Verifica tus credenciales.');
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Ingresar';
    }
  });

  // Handle Register
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const name = regNameInput.value.trim();
      const company = regCompanyInput.value.trim();
      const email = regEmailInput.value.trim();
      const password = regPasswordInput.value.trim();

      if (!name || !company || !email || !password) {
        showAlert('Por favor, completa todos los campos.');
        return;
      }

      if (password.length < 8) {
        showAlert('La contraseña debe tener al menos 8 caracteres.');
        return;
      }

      registerBtn.disabled = true;
      registerBtn.textContent = 'Creando cuenta...';

      try {
        const { data, error } = await supabase.auth.signUp({
          email: email,
          password: password,
          options: {
            data: {
              full_name: name,
              company_name: company
            }
          }
        });

        if (error) throw error;

        // Si la confirmación de email está desactivada en Supabase, signUp inicia sesión automáticamente
        if (data.session) {
          showAlert('¡Registro exitoso! Iniciando sesión...', 'success');
          setTimeout(() => {
            window.location.href = 'dashboard.html';
          }, 1500);
        } else {
          // Si requiere confirmación por email
          showAlert('¡Registro exitoso! Por favor revisa tu correo electrónico para confirmar tu cuenta.', 'success');
          // Limpiar formulario y alternar a login
          setTimeout(() => {
            registerForm.reset();
            toggleToLogin.click();
          }, 4000);
        }
      } catch (error) {
        let msg = error.message;
        if (typeof msg === 'object') msg = JSON.stringify(msg);
        if (msg === '{}' || msg === '[object Object]') msg = '';
        showAlert(msg || 'Error al registrar usuario. Inténtalo de nuevo.');
      } finally {
        registerBtn.disabled = false;
        registerBtn.textContent = 'Crear Cuenta';
      }
    });
  }

  // ── Forgot Password ──

  const forgotForm = document.getElementById('forgot-form');
  const forgotEmailInput = document.getElementById('forgot-email');
  const forgotBtn = document.getElementById('forgot-btn');
  const toggleToForgot = document.getElementById('toggle-to-forgot');
  const toggleToLoginFromForgot = document.getElementById('toggle-to-login-from-forgot');

  // Alternar a Forgot Password
  if (toggleToForgot) {
    toggleToForgot.addEventListener('click', (e) => {
      e.preventDefault();
      alertContainer.innerHTML = '';
      loginForm.style.display = 'none';
      registerForm.style.display = 'none';
      forgotForm.style.display = 'block';
      forgotForm.classList.add('auth-fade-in');
      authTitle.textContent = 'Recuperar Contraseña';
      authSubtitle.textContent = 'Ingresa tu correo y te enviaremos un enlace para restablecer tu contraseña.';
    });
  }

  // Alternar de Forgot a Login
  if (toggleToLoginFromForgot) {
    toggleToLoginFromForgot.addEventListener('click', (e) => {
      e.preventDefault();
      alertContainer.innerHTML = '';
      forgotForm.style.display = 'none';
      loginForm.style.display = 'block';
      loginForm.classList.add('auth-fade-in');
      authTitle.textContent = 'Bienvenido';
      authSubtitle.textContent = 'Ingresa tus credenciales para acceder a tu bodega online.';
    });
  }

  // Handle Forgot Password
  if (forgotForm) {
    forgotForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const email = forgotEmailInput.value.trim();

      if (!email) {
        showAlert('Por favor, ingresa tu correo electrónico.');
        return;
      }

      forgotBtn.disabled = true;
      forgotBtn.textContent = 'Enviando...';

      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + '/index.html'
        });

        if (error) throw error;

        showAlert('¡Enlace enviado! Revisa tu bandeja de entrada y sigue las instrucciones.', 'success');
        forgotForm.reset();
      } catch (error) {
        let msg = error.message;
        if (typeof msg === 'object') msg = JSON.stringify(msg);
        if (msg === '{}' || msg === '[object Object]') msg = '';
        showAlert(msg || 'Error al enviar el enlace. Inténtalo de nuevo.');
      } finally {
        forgotBtn.disabled = false;
        forgotBtn.textContent = 'Enviar enlace de recuperación';
      }
    });
  }

  // ── Reset Password ──

  const resetForm = document.getElementById('reset-form');
  const resetPasswordInput = document.getElementById('reset-password');
  const resetConfirmPasswordInput = document.getElementById('reset-confirm-password');
  const resetBtn = document.getElementById('reset-btn');
  const toggleToLoginFromReset = document.getElementById('toggle-to-login-from-reset');

  // Alternar de Reset a Login
  if (toggleToLoginFromReset) {
    toggleToLoginFromReset.addEventListener('click', (e) => {
      e.preventDefault();
      alertContainer.innerHTML = '';
      if (resetForm) resetForm.style.display = 'none';
      loginForm.style.display = 'block';
      loginForm.classList.add('auth-fade-in');
      authTitle.textContent = 'Bienvenido';
      authSubtitle.textContent = 'Ingresa tus credenciales para acceder a tu bodega online.';
      // Limpiar hash de la URL
      window.location.hash = '';
    });
  }

  // Handle Reset Password Submit
  if (resetForm) {
    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const newPassword = resetPasswordInput.value.trim();
      const confirmPassword = resetConfirmPasswordInput.value.trim();

      if (!newPassword || !confirmPassword) {
        showAlert('Por favor, ingresa y confirma tu nueva contraseña.');
        return;
      }

      if (newPassword.length < 8) {
        showAlert('La contraseña debe tener al menos 8 caracteres.');
        return;
      }

      if (newPassword !== confirmPassword) {
        showAlert('Las contraseñas no coinciden.');
        return;
      }

      resetBtn.disabled = true;
      resetBtn.innerHTML = '<i class="ri-loader-4-line" style="display: inline-block; animation: spin 1s linear infinite; margin-right: 0.35rem;"></i> Actualizando...';

      try {
        const { error } = await supabase.auth.updateUser({
          password: newPassword
        });

        if (error) throw error;

        showAlert('¡Contraseña restablecida con éxito! Redirigiendo a tu bodega...', 'success');
        
        // Limpiar hash
        window.location.hash = '';

        // Esperar transición
        setTimeout(() => {
          window.location.href = 'dashboard.html';
        }, 1500);

      } catch (error) {
        let msg = error.message;
        if (typeof msg === 'object') msg = JSON.stringify(msg);
        if (msg === '{}' || msg === '[object Object]') msg = '';
        showAlert(msg || 'Error al restablecer la contraseña. Vuelve a intentarlo.');
      } finally {
        resetBtn.disabled = false;
        resetBtn.textContent = 'Actualizar Contraseña';
      }
    });
  }

  // Detectar y notificar vinculación pendiente tras retornar de Shopify OAuth
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('integration') === 'success' && urlParams.get('shop')) {
    const shop = urlParams.get('shop');
    localStorage.setItem('pending_shopify_shop', shop);
    localStorage.setItem('pending_shopify_link', 'true');
    
    // Mostrar alerta de éxito persistente en la pantalla de Login
    setTimeout(() => {
      if (alertContainer) {
        alertContainer.innerHTML = `
          <div class="alert alert-success" style="background: rgba(16, 185, 129, 0.1); border: 1px solid var(--color-success); color: var(--color-success); padding: 0.75rem; border-radius: var(--radius-sm); font-size: 0.85rem; margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.5rem; text-align: left; line-height: 1.4;">
            <i class="ri-checkbox-circle-line" style="font-size: 1.25rem; flex-shrink: 0; color: #10b981;"></i> 
            <span><strong>¡Tienda conectada!</strong> Por favor inicia sesión o crea una cuenta para asociar la tienda <strong>${shop}</strong> a tu cuenta de WMS Stocka.</span>
          </div>
        `;
      }
    }, 200);
  }

  // WMS Client Feature Slide Control Logic
  const slides = document.querySelectorAll('.auth-slide');
  const dots = document.querySelectorAll('.auth-slider-dot');
  let currentSlide = 0;
  let slideInterval;

  function showSlide(index) {
    if (!slides.length || !dots.length) return;
    slides.forEach(s => s.classList.remove('active'));
    dots.forEach(d => d.classList.remove('active'));
    
    slides[index].classList.add('active');
    dots[index].classList.add('active');
    currentSlide = index;
  }

  function nextSlide() {
    if (!slides.length) return;
    let next = (currentSlide + 1) % slides.length;
    showSlide(next);
  }

  function startSlideShow() {
    if (!slides.length) return;
    slideInterval = setInterval(nextSlide, 5000);
  }

  function stopSlideShow() {
    clearInterval(slideInterval);
  }

  if (dots.length) {
    dots.forEach((dot, index) => {
      dot.addEventListener('click', () => {
        stopSlideShow();
        showSlide(index);
        startSlideShow();
      });
    });
  }

  // Initialize Slideshow
  if (slides.length) {
    startSlideShow();
  }
});

