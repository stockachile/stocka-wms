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
});
