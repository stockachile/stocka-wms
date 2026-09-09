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
  const ufValueEls = document.querySelectorAll('#uf-value, #uf-display-val, .uf-display-text');
  if (ufValueEls.length > 0) {
    const updateAllUfDisplays = (text, title = '') => {
      ufValueEls.forEach(el => {
        el.textContent = text;
        if (title) el.title = title;
      });
    };

    // Intentar desde caché primero (dura el mismo día)
    const cached = JSON.parse(localStorage.getItem('stocka-uf') || 'null');
    const today = new Date().toISOString().slice(0, 10);
    if (cached && cached.date === today && cached.value) {
      updateAllUfDisplays(cached.value);
    } else {
      fetch('https://mindicador.cl/api/uf')
        .then(r => r.json())
        .then(data => {
          const val = data?.serie?.[0]?.valor;
          if (val) {
            const formatted = Math.round(parseFloat(val)).toLocaleString('es-CL');
            const displayStr = `$${formatted}`;
            updateAllUfDisplays(displayStr);
            localStorage.setItem('stocka-uf', JSON.stringify({ 
              date: today, 
              value: displayStr,
              numericValue: Math.round(parseFloat(val))
            }));
            localStorage.setItem('stocka-last-uf-backup', Math.round(parseFloat(val)).toString());
          } else {
            throw new Error('Datos no válidos');
          }
        })
        .catch(() => {
          // Si falla, usar la última UF conocida de respaldo
          const backupVal = localStorage.getItem('stocka-last-uf-backup');
          if (backupVal) {
            const valNum = parseFloat(backupVal);
            const formatted = Math.round(valNum).toLocaleString('es-CL');
            updateAllUfDisplays(`$${formatted}*`, 'Valor de respaldo (última UF conocida offline)');
          } else {
            updateAllUfDisplays('$40.867*');
          }
        });
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

  // Configuración de menú responsive para móviles
  const topHeader = document.querySelector('.top-header');
  const sidebar = document.querySelector('.sidebar');
  
  if (topHeader && sidebar) {
    // 1. Inyectar botón hamburguesa
    const mobileToggle = document.createElement('button');
    mobileToggle.id = 'mobile-menu-toggle';
    mobileToggle.className = 'header-icon-btn mobile-menu-toggle';
    mobileToggle.setAttribute('aria-label', 'Abrir menú');
    mobileToggle.innerHTML = '<i class="ri-menu-line"></i>';
    
    const headerTitle = topHeader.querySelector('.header-title');
    if (headerTitle) {
      topHeader.insertBefore(mobileToggle, headerTitle);
    } else {
      topHeader.prepend(mobileToggle);
    }
    
    // 2. Inyectar overlay/backdrop
    const overlay = document.createElement('div');
    overlay.id = 'sidebar-overlay';
    overlay.className = 'sidebar-overlay';
    
    const layout = document.querySelector('.dashboard-layout');
    if (layout) {
      layout.insertBefore(overlay, sidebar.nextSibling);
    }

    // Funciones de control
    const openMenu = () => {
      sidebar.classList.add('mobile-active');
      overlay.classList.add('active');
    };

    const closeMenu = () => {
      sidebar.classList.remove('mobile-active');
      overlay.classList.remove('active');
    };

    // Eventos
    mobileToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      openMenu();
    });

    overlay.addEventListener('click', closeMenu);

    // Cerrar al hacer click en cualquier opción de navegación
    const navLinks = sidebar.querySelectorAll('.sidebar-nav a.nav-item');
    navLinks.forEach(link => {
      link.addEventListener('click', () => {
        closeMenu();
      });
    });

    // Asegurar que el botón colapsar original cierre en móvil
    const innerCloseBtn = document.getElementById('toggle-sidebar');
    if (innerCloseBtn) {
      innerCloseBtn.addEventListener('click', (e) => {
        if (sidebar.classList.contains('mobile-active')) {
          e.stopPropagation();
          closeMenu();
        }
      });
    }
  }

  // ==========================================
  // Botón Flotante para Subir (Scroll to Top)
  // ==========================================
  const initScrollToTop = () => {
    let btn = document.getElementById('scroll-to-top-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'scroll-to-top-btn';
      btn.className = 'scroll-to-top-btn';
      btn.setAttribute('aria-label', 'Volver arriba');
      btn.setAttribute('title', 'Volver arriba');
      btn.innerHTML = '<i class="ri-arrow-up-line"></i>';
      document.body.appendChild(btn);
    }

    const updateSupportOffset = () => {
      const hasSupportBtn = !!document.querySelector('.floating-support-btn');
      if (hasSupportBtn) {
        btn.classList.add('has-support-btn');
      } else {
        btn.classList.remove('has-support-btn');
      }
    };
    updateSupportOffset();

    let lastScrolledContainer = null;
    let isTicking = false;

    const checkScrollPosition = () => {
      const contentArea = document.getElementById('app-content') || document.querySelector('.content-area');
      const contentScroll = contentArea ? contentArea.scrollTop : 0;
      const winScroll = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
      const lastContainerScroll = (lastScrolledContainer && lastScrolledContainer !== contentArea && typeof lastScrolledContainer.scrollTop === 'number')
        ? lastScrolledContainer.scrollTop
        : 0;

      const maxScroll = Math.max(contentScroll, winScroll, lastContainerScroll);

      if (maxScroll > 200) {
        btn.classList.add('visible');
      } else {
        btn.classList.remove('visible');
      }
      updateSupportOffset();
    };

    const handleScrollEvent = (e) => {
      if (e && e.target && e.target !== document && e.target !== window && typeof e.target.scrollTop === 'number') {
        lastScrolledContainer = e.target;
      }
      if (!isTicking) {
        window.requestAnimationFrame(() => {
          checkScrollPosition();
          isTicking = false;
        });
        isTicking = true;
      }
    };

    window.addEventListener('scroll', handleScrollEvent, { capture: true, passive: true });
    window.addEventListener('resize', checkScrollPosition, { passive: true });

    btn.addEventListener('click', (e) => {
      e.preventDefault();

      const contentArea = document.getElementById('app-content') || document.querySelector('.content-area');
      if (contentArea && contentArea.scrollTop > 0) {
        try {
          contentArea.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
          contentArea.scrollTop = 0;
        }
      }

      const winScroll = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
      if (winScroll > 0) {
        try {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
          window.scrollTo(0, 0);
        }
      }

      if (lastScrolledContainer && lastScrolledContainer !== contentArea && typeof lastScrolledContainer.scrollTop === 'number' && lastScrolledContainer.scrollTop > 0) {
        try {
          lastScrolledContainer.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
          lastScrolledContainer.scrollTop = 0;
        }
      }
    });

    document.addEventListener('click', (e) => {
      if (e.target.closest('.nav-item')) {
        setTimeout(checkScrollPosition, 150);
      }
    });

    checkScrollPosition();
  };

  initScrollToTop();
});

window.getUfValueForDate = async function(dateStr) {
  // dateStr format: DD-MM-YYYY
  const cacheKey = `stocka-uf-${dateStr}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    return parseFloat(cached);
  }

  try {
    const res = await fetch(`https://mindicador.cl/api/uf/${dateStr}`);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    if (data && data.serie && data.serie[0]) {
      const val = parseFloat(data.serie[0].valor);
      localStorage.setItem(cacheKey, val.toString());
      return val;
    }
  } catch (err) {
    console.error(`Error fetching UF for date ${dateStr}:`, err);
  }

  const todayCached = JSON.parse(localStorage.getItem('stocka-uf') || 'null');
  const backupVal = localStorage.getItem('stocka-last-uf-backup');
  return (todayCached && todayCached.numericValue) || (backupVal ? parseFloat(backupVal) : 37500);
};
