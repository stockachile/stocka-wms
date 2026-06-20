/**
 * theme.js
 * Handles the Dark/Light mode theme logic for the WMS STOCKA portal.
 */

// 1. Get preferred theme
const getPreferredTheme = () => {
  const savedTheme = localStorage.getItem('stocka-theme');
  if (savedTheme) {
    return savedTheme;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

// 2. Apply theme immediately to prevent FOUC
const setTheme = (theme) => {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  localStorage.setItem('stocka-theme', theme);
};

let currentTheme = getPreferredTheme();
setTheme(currentTheme);

// Initialize UI toggles once DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const themeToggleBtns = document.querySelectorAll('.theme-toggle-btn:not(#notification-btn)');

  // 4. Toggle function
  const handleToggle = () => {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    setTheme(currentTheme);
  };

  // 5. Attach event listeners
  themeToggleBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      handleToggle();
    });
  });

  // Listen for system theme changes if no local storage is strictly overriding
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem('stocka-theme')) {
      const newTheme = e.matches ? 'dark' : 'light';
      currentTheme = newTheme;
      setTheme(newTheme);
    }
  });
  // Expand the clickable area of date inputs to trigger calendar picker anywhere on the input
  document.addEventListener('click', (e) => {
    if (e.target.matches('input[type="date"]')) {
      try { e.target.showPicker(); } catch(err) {}
    }
  });

  // Fetch UF del día desde mindicador.cl
  const ufValueEl = document.getElementById('uf-value');
  if (ufValueEl) {
    // Intentar desde caché primero (dura el mismo día)
    const cached = JSON.parse(localStorage.getItem('stocka-uf') || 'null');
    const today = new Date().toISOString().slice(0, 10);
    if (cached && cached.date === today) {
      ufValueEl.textContent = cached.value;
    } else {
      fetch('https://mindicador.cl/api/uf')
        .then(r => r.json())
        .then(data => {
          const val = data?.serie?.[0]?.valor;
          if (val) {
            const formatted = val.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            ufValueEl.textContent = `$${formatted}`;
            localStorage.setItem('stocka-uf', JSON.stringify({ date: today, value: `$${formatted}` }));
          }
        })
        .catch(() => { ufValueEl.textContent = 'N/D'; });
    }
  }

  // Renderizar fecha del día en español
  const dayNumEl  = document.getElementById('date-day-num');
  const dateRestEl = document.getElementById('date-rest');
  if (dayNumEl && dateRestEl) {
    const now = new Date();
    const dayNum = now.getDate();
    const monthName = now.toLocaleDateString('es-CL', { month: 'short' });
    const weekday  = now.toLocaleDateString('es-CL', { weekday: 'short' });
    const year     = now.getFullYear();
    // Capitaliza primera letra
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1).replace('.','');
    dayNumEl.textContent  = dayNum;
    dateRestEl.textContent = `${cap(weekday)} ${cap(monthName)} ${year}`;
  }
});
