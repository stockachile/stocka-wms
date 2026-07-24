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

  // Check si ya hay sesión activa
  const checkSession = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      // Fetch role and redirect
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
      const role = profile ? profile.role : 'client';
      window.location.href = role === 'admin' ? 'admin.html' : 'dashboard.html';
    }
  };

  checkSession();

  // Handle Login
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();

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

      if (password.length < 6) {
        showAlert('La contraseña debe tener al menos 6 caracteres.');
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
});
