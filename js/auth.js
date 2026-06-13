import supabase from './supabase.js';

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const alertContainer = document.getElementById('alert-container');
  const loginBtn = document.getElementById('login-btn');

  // Función para mostrar alertas
  const showAlert = (message, type = 'error') => {
    alertContainer.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
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
    loginBtn.textContent = 'Ingresando...';

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: password,
      });

      if (error) throw error;

      if (data.session) {
        const { data: profile } = await supabase.from('profiles').select('role').eq('id', data.session.user.id).single();
        const role = profile ? profile.role : 'client';
        
        showAlert('Inicio de sesión exitoso. Redirigiendo...', 'success');
        setTimeout(() => {
          window.location.href = role === 'admin' ? 'admin.html' : 'dashboard.html';
        }, 1000);
      }
    } catch (error) {
      showAlert(error.message || 'Error al iniciar sesión. Verifica tus credenciales.');
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
        showAlert(error.message || 'Error al registrar usuario. Inténtalo de nuevo.');
      } finally {
        registerBtn.disabled = false;
        registerBtn.textContent = 'Crear Cuenta';
      }
    });
  }
});
