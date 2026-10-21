/**
 * theme.js
 * Handles the Dark/Light mode theme logic for the WMS STOCKA portal.
 */

// 0. Redirección forzosa al dominio corporativo oficial si el usuario entra por el subdominio de Netlify
if (window.location.hostname === 'stocka-wms.netlify.app') {
  window.location.replace('https://wms.stocka.cl' + window.location.pathname + window.location.search + window.location.hash);
}

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

    // =========================================================
    // 3. Sistema de Menú Compacto con Flyout Lateral + Favoritos
    // =========================================================
    const flyoutGroups = Array.from(sidebar.querySelectorAll('.sidebar-flyout-group'));
    if (flyoutGroups.length > 0) {
      const role = sidebar.getAttribute('data-sidebar-role') || (window.location.pathname.includes('admin') ? 'admin' : 'client');
      const favStorageKey = `stocka_sidebar_favs_${role}`;
      const defaultFavs = role === 'admin'
        ? ['orders_admin', 'inventory_admin', 'merchants_admin', 'billing_admin']
        : ['inventory', 'orders', 'shipments', 'cotizador'];
      const MAX_FAVS = 5;

      const getFavorites = () => {
        try {
          const saved = localStorage.getItem(favStorageKey);
          if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) return parsed.slice(0, MAX_FAVS);
          }
        } catch (err) {}
        return [...defaultFavs];
      };

      const saveFavorites = (favList) => {
        try {
          localStorage.setItem(favStorageKey, JSON.stringify(favList.slice(0, MAX_FAVS)));
        } catch (err) {}
      };

      // Posicionar el panel Flyout dinámicamente sin que se corte abajo ni arriba
      const positionFlyoutPanel = (group) => {
        if (window.innerWidth <= 768) return;
        const panel = group.querySelector('.sidebar-flyout-panel');
        const trigger = group.querySelector('.sidebar-group-trigger');
        if (!panel || !trigger) return;

        const sidebarRect = sidebar.getBoundingClientRect();
        const triggerRect = trigger.getBoundingClientRect();
        const panelHeight = panel.offsetHeight || 260;
        const viewportHeight = window.innerHeight;

        const clampedTop = Math.max(10, Math.min(triggerRect.top - 6, viewportHeight - panelHeight - 12));
        panel.style.left = `${Math.round(sidebarRect.right + 4)}px`;
        panel.style.top = `${Math.round(clampedTop)}px`;
      };

      window.positionSidebarFlyout = positionFlyoutPanel;

      // Inyectar botón de estrella (★/☆) junto a cada ítem dentro de los paneles Flyout
      const updatePinButtonsState = () => {
        const currentFavs = getFavorites();
        sidebar.querySelectorAll('.flyout-pin-btn').forEach(btn => {
          const view = btn.getAttribute('data-pin-view');
          const isPinned = currentFavs.includes(view);
          btn.classList.toggle('is-pinned', isPinned);
          btn.innerHTML = isPinned ? '<i class="ri-star-fill"></i>' : '<i class="ri-star-line"></i>';
          btn.setAttribute('title', isPinned ? 'Quitar de Favoritos Fijados' : 'Fijar en acceso rápido (máx. 5)');
        });
      };

      flyoutGroups.forEach(group => {
        const trigger = group.querySelector('.sidebar-group-trigger');
        const panel = group.querySelector('.sidebar-flyout-panel');
        const listItems = Array.from(group.querySelectorAll('.flyout-panel-list > li'));

        listItems.forEach(li => {
          const navLink = li.querySelector('.nav-item');
          if (!navLink || navLink.classList.contains('hidden-ticket-nav')) return;
          const view = navLink.getAttribute('data-view');
          if (!view) return;

          if (!li.querySelector('.flyout-pin-btn')) {
            const pinBtn = document.createElement('button');
            pinBtn.type = 'button';
            pinBtn.className = 'flyout-pin-btn';
            pinBtn.setAttribute('data-pin-view', view);
            pinBtn.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              let favs = getFavorites();
              if (favs.includes(view)) {
                favs = favs.filter(v => v !== view);
              } else {
                if (favs.length >= MAX_FAVS) {
                  favs.shift(); // Reemplaza el más antiguo para mantener 0 scroll
                }
                favs.push(view);
              }
              saveFavorites(favs);
              renderFavorites(true);
              updatePinButtonsState();
            });
            li.appendChild(pinBtn);
          }

          // Cerrar el flyout inmediatamente al seleccionar un módulo en Desktop
          navLink.addEventListener('click', () => {
            group.classList.remove('flyout-open');
            if (panel) {
              panel.style.pointerEvents = 'none';
              panel.style.opacity = '0';
              setTimeout(() => {
                panel.style.pointerEvents = '';
                panel.style.opacity = '';
              }, 220);
            }
          });
        });

        // Eventos Desktop (Hover) y Mobile (Acordeón Exclusivo)
        group.addEventListener('mouseenter', () => {
          if (window.innerWidth > 768) {
            positionFlyoutPanel(group);
          }
        });

        if (trigger) {
          trigger.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (window.innerWidth <= 768) {
              const wasOpen = group.classList.contains('mobile-open');
              flyoutGroups.forEach(g => g.classList.remove('mobile-open'));
              if (!wasOpen) group.classList.add('mobile-open');
            } else {
              const wasOpen = group.classList.contains('flyout-open');
              flyoutGroups.forEach(g => g.classList.remove('flyout-open'));
              if (!wasOpen) {
                positionFlyoutPanel(group);
                group.classList.add('flyout-open');
              }
            }
          });
        }
      });

      // Cerrar cualquier flyout abierto con click fuera
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.sidebar-flyout-group')) {
          flyoutGroups.forEach(g => g.classList.remove('flyout-open'));
        }
      });

      // Renderizar lista de Favoritos Fijados en el sidebar (solo cuando cambia la estructura)
      let lastRenderedKey = '';
      const renderFavorites = (force = false) => {
        const favBox = document.getElementById('sidebar-favorites-box');
        const favListEl = document.getElementById('sidebar-favorites-list');
        if (!favBox || !favListEl) return;

        const favViews = getFavorites();
        const visibleViews = favViews.filter(view => {
          const canonicalLink = sidebar.querySelector(`.flyout-panel-list .nav-item[data-view="${view}"]`);
          if (!canonicalLink) return false;
          const parentLi = canonicalLink.closest('li');
          if (parentLi && parentLi.style.display === 'none') return false;
          return true;
        });

        const renderKey = visibleViews.join(',');
        if (!force && renderKey === lastRenderedKey && favListEl.children.length === visibleViews.length) {
          syncFavoritesState();
          return;
        }
        lastRenderedKey = renderKey;

        favListEl.innerHTML = '';

        visibleViews.forEach(view => {
          const canonicalLink = sidebar.querySelector(`.flyout-panel-list .nav-item[data-view="${view}"]`);
          if (!canonicalLink) return;

          const iconEl = canonicalLink.querySelector('i');
          const iconClass = iconEl ? iconEl.className : 'ri-price-tag-3-line';
          const textEl = canonicalLink.querySelector('.nav-text');
          const label = textEl ? textEl.textContent.trim() : view;
          const isActive = canonicalLink.classList.contains('active');

          const li = document.createElement('li');
          li.className = 'sidebar-fav-li';
          li.setAttribute('data-fav-li-view', view);
          li.innerHTML = `
            <a href="#" class="sidebar-fav-item ${isActive ? 'active' : ''}" data-fav-view="${view}" title="${label}">
              <i class="${iconClass} fav-item-icon"></i>
              <span class="fav-text">${label}</span>
              <span class="menu-badge fav-item-badge" style="display: none;">0</span>
            </a>
            <button type="button" class="fav-unpin-btn" data-unpin-view="${view}" title="Quitar de favoritos">
              <i class="ri-close-line"></i>
            </button>
          `;

          favListEl.appendChild(li);
        });

        favBox.style.display = visibleViews.length > 0 ? '' : 'none';
        syncFavoritesState();
      };

      // Actualizar estado activo y badges de los favoritos in-place sin destruir nodos DOM
      const syncFavoritesState = () => {
        const favListEl = document.getElementById('sidebar-favorites-list');
        if (!favListEl) return;

        favListEl.querySelectorAll('.sidebar-fav-item').forEach(favAnchor => {
          const view = favAnchor.getAttribute('data-fav-view');
          const canonicalLink = sidebar.querySelector(`.flyout-panel-list .nav-item[data-view="${view}"]`);
          if (!canonicalLink) return;

          const isActive = canonicalLink.classList.contains('active');
          if (favAnchor.classList.contains('active') !== isActive) {
            favAnchor.classList.toggle('active', isActive);
          }

          const favBadge = favAnchor.querySelector('.fav-item-badge');
          const origBadge = canonicalLink.querySelector('.menu-badge');
          if (favBadge) {
            if (origBadge && origBadge.style.display !== 'none') {
              const badgeText = origBadge.textContent.trim();
              if (badgeText && badgeText !== '0') {
                if (favBadge.textContent !== badgeText) favBadge.textContent = badgeText;
                if (origBadge.style.backgroundColor && favBadge.style.backgroundColor !== origBadge.style.backgroundColor) {
                  favBadge.style.backgroundColor = origBadge.style.backgroundColor;
                }
                if (favBadge.style.display !== 'inline-block') favBadge.style.display = 'inline-block';
                return;
              }
            }
            if (favBadge.style.display !== 'none') favBadge.style.display = 'none';
          }
        });
      };

      // Delegación de eventos en la lista de Favoritos Fijados
      const favListContainer = document.getElementById('sidebar-favorites-list');
      if (favListContainer) {
        favListContainer.addEventListener('click', (e) => {
          const unpinBtn = e.target.closest('.fav-unpin-btn');
          if (unpinBtn) {
            e.preventDefault();
            e.stopPropagation();
            const view = unpinBtn.getAttribute('data-unpin-view');
            if (view) {
              const updated = getFavorites().filter(v => v !== view);
              saveFavorites(updated);
              renderFavorites(true);
              updatePinButtonsState();
            }
            return;
          }

          const favAnchor = e.target.closest('.sidebar-fav-item');
          if (favAnchor) {
            e.preventDefault();
            e.stopPropagation();
            const view = favAnchor.getAttribute('data-fav-view');
            const canonicalLink = sidebar.querySelector(`.flyout-panel-list .nav-item[data-view="${view}"]`);
            if (canonicalLink) {
              if (canonicalLink.getAttribute('target') === '_blank') {
                window.open(canonicalLink.getAttribute('href'), '_blank');
              } else {
                canonicalLink.click();
              }
            }
            closeMenu();
          }
        });
      }

      // Botón de Acceso Rápido fijo al Portal de Tracking (Cliente)
      const quickTrackerLi = document.getElementById('sidebar-quick-tracker-li');
      const quickTrackerBtn = document.getElementById('sidebar-quick-tracker-btn');
      if (quickTrackerBtn) {
        quickTrackerBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const targetView = quickTrackerBtn.getAttribute('data-quick-view') || 'tracking_widget';
          const canonicalLink = sidebar.querySelector(`.flyout-panel-list .nav-item[data-view="${targetView}"]`);
          if (canonicalLink) {
            canonicalLink.click();
          }
          closeMenu();
        });
      }

      // Sincronizar categoría activa y sumar badges de notificaciones por grupo (sin mutaciones redundantes)
      const syncFlyoutActiveAndBadges = () => {
        flyoutGroups.forEach(group => {
          const items = Array.from(group.querySelectorAll('.flyout-panel-list > li'));
          let hasActive = false;
          let badgeSum = 0;

          items.forEach(li => {
            if (li.style.display === 'none') return;
            const link = li.querySelector('.nav-item');
            if (!link || link.classList.contains('hidden-ticket-nav')) return;

            if (link.classList.contains('active')) {
              hasActive = true;
            }

            const badge = link.querySelector('.menu-badge');
            if (badge && badge.style.display !== 'none') {
              const num = parseInt(badge.textContent.trim(), 10);
              if (!isNaN(num) && num > 0) {
                badgeSum += num;
              }
            }
          });

          if (group.classList.contains('has-active-view') !== hasActive) {
            group.classList.toggle('has-active-view', hasActive);
          }

          const groupBadge = group.querySelector('.group-badge');
          if (groupBadge) {
            if (badgeSum > 0) {
              const newText = badgeSum > 99 ? '99+' : String(badgeSum);
              if (groupBadge.textContent !== newText) groupBadge.textContent = newText;
              if (groupBadge.style.display !== 'inline-block') groupBadge.style.display = 'inline-block';
            } else {
              if (groupBadge.textContent !== '0') groupBadge.textContent = '0';
              if (groupBadge.style.display !== 'none') groupBadge.style.display = 'none';
            }
          }
        });

        // Sincronizar estado activo y visibilidad del Acceso Rápido al Portal de Tracking
        if (quickTrackerBtn && quickTrackerLi) {
          const trackerLink = sidebar.querySelector('.flyout-panel-list .nav-item[data-view="tracking_widget"]');
          if (trackerLink) {
            const trackerParentLi = trackerLink.closest('li');
            const isTrackerAllowed = !trackerParentLi || trackerParentLi.style.display !== 'none';
            const targetDisplay = isTrackerAllowed ? '' : 'none';
            if (quickTrackerLi.style.display !== targetDisplay) {
              quickTrackerLi.style.display = targetDisplay;
            }
            const isTrackerActive = trackerLink.classList.contains('active');
            if (quickTrackerBtn.classList.contains('active') !== isTrackerActive) {
              quickTrackerBtn.classList.toggle('active', isTrackerActive);
            }
          }
        }
      };

      // Inicializar estados
      updatePinButtonsState();
      renderFavorites(true);
      syncFlyoutActiveAndBadges();

      // Observar únicamente las listas internas de ítems (.flyout-panel-list) y el botón superior Dashboard
      let syncRaf = null;
      const observer = new MutationObserver(() => {
        if (syncRaf) cancelAnimationFrame(syncRaf);
        syncRaf = requestAnimationFrame(() => {
          syncFlyoutActiveAndBadges();
          renderFavorites(false);
        });
      });

      sidebar.querySelectorAll('.flyout-panel-list, .sidebar-top-item').forEach(targetList => {
        observer.observe(targetList, {
          attributes: true,
          attributeFilter: ['class', 'style'],
          childList: true,
          characterData: true,
          subtree: true
        });
      });

      window.refreshSidebarFlyoutSystem = () => {
        updatePinButtonsState();
        renderFavorites(true);
        syncFlyoutActiveAndBadges();
      };
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

  // ==========================================
  // Calculadora Admin en Header
  // ==========================================
  const initAdminCalculator = () => {
    const calcBtn = document.getElementById('admin-calc-btn');
    const dropdown = document.getElementById('admin-calc-dropdown');
    if (!calcBtn || !dropdown) return;

    const displayEl = document.getElementById('admin-calc-display');
    const exprEl = document.getElementById('admin-calc-expression');
    const copyBtn = document.getElementById('admin-calc-copy-btn');
    const pinBtn = document.getElementById('admin-calc-pin-btn');
    const closeBtn = document.getElementById('admin-calc-close-btn');
    const historyBtn = document.getElementById('admin-calc-history-btn');
    const historyPanel = document.getElementById('admin-calc-history-panel');
    const historyList = document.getElementById('admin-calc-history-list');
    const historyClearBtn = document.getElementById('admin-calc-history-clear');

    const HISTORY_KEY = 'stocka_admin_calc_history';
    let currentInput = '0';
    let previousValue = null;
    let operator = null;
    let waitingForSecondOperand = false;
    let expressionText = '';
    let isPinned = false;

    const opSymbols = { '+': '+', '-': '−', '*': '×', '/': '÷' };

    const getLiveUfValue = () => {
      try {
        const cached = JSON.parse(localStorage.getItem('stocka-uf') || 'null');
        if (cached && cached.numericValue) return parseFloat(cached.numericValue);
      } catch (e) {}
      const ufEl = document.getElementById('uf-value');
      if (ufEl && ufEl.textContent) {
        const cleaned = ufEl.textContent.replace(/[^0-9]/g, '');
        if (cleaned) return parseFloat(cleaned);
      }
      const backup = localStorage.getItem('stocka-last-uf-backup');
      return backup ? parseFloat(backup) : 41179;
    };

    const formatNumberCL = (valStr) => {
      if (valStr === 'Error' || valStr === 'NaN' || valStr === 'Infinity' || valStr === '-Infinity') {
        return 'Error';
      }
      const isNeg = valStr.startsWith('-');
      const clean = isNeg ? valStr.slice(1) : valStr;
      const parts = clean.split('.');
      const intPart = parts[0] || '0';
      const decPart = parts.length > 1 ? parts[1] : null;
      const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      const sign = isNeg && (intPart !== '0' || (decPart && Number(decPart) > 0) || clean.includes('.')) ? '-' : '';
      return decPart !== null ? `${sign}${formattedInt},${decPart}` : `${sign}${formattedInt}`;
    };

    const normalizeFloat = (num, maxDecimals = 6) => {
      if (!Number.isFinite(num)) return 'Error';
      const factor = Math.pow(10, maxDecimals);
      const rounded = Math.round((num + Number.EPSILON) * factor) / factor;
      return String(rounded);
    };

    const updateUI = () => {
      const formatted = formatNumberCL(currentInput);
      displayEl.textContent = formatted;
      if (formatted.length > 13) {
        displayEl.classList.add('is-small');
      } else {
        displayEl.classList.remove('is-small');
      }
      exprEl.textContent = expressionText;

      dropdown.querySelectorAll('[data-calc-op]').forEach(btn => {
        const btnOp = btn.getAttribute('data-calc-op');
        if (waitingForSecondOperand && operator === btnOp) {
          btn.classList.add('active-op');
        } else {
          btn.classList.remove('active-op');
        }
      });
    };

    const loadHistory = () => {
      try {
        return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      } catch (e) {
        return [];
      }
    };

    const renderHistory = () => {
      if (!historyList) return;
      const items = loadHistory();
      if (!items.length) {
        historyList.innerHTML = '<div style="text-align: center; padding: 0.5rem; color: var(--color-text-muted); font-size: 0.75rem;">Sin cálculos recientes</div>';
        return;
      }
      historyList.innerHTML = items.map((item, idx) => `
        <div class="admin-calc-history-item" data-hist-idx="${idx}" title="Clic para usar este resultado">
          <span class="admin-calc-history-expr">${item.expr}</span>
          <span class="admin-calc-history-res">${formatNumberCL(String(item.result))}</span>
        </div>
      `).join('');
    };

    const addHistory = (expr, result) => {
      if (result === 'Error') return;
      const items = loadHistory();
      items.unshift({ expr, result: String(result), ts: Date.now() });
      const trimmed = items.slice(0, 15);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
      renderHistory();
    };

    const inputDigit = (digit) => {
      if (currentInput === 'Error') {
        currentInput = digit;
        waitingForSecondOperand = false;
        expressionText = '';
        updateUI();
        return;
      }
      if (waitingForSecondOperand) {
        currentInput = digit;
        waitingForSecondOperand = false;
      } else {
        const rawDigits = currentInput.replace(/[^0-9]/g, '');
        if (rawDigits.length >= 15) return;
        currentInput = currentInput === '0' ? digit : currentInput + digit;
      }
      updateUI();
    };

    const inputDecimal = () => {
      if (currentInput === 'Error') {
        currentInput = '0.';
        waitingForSecondOperand = false;
        expressionText = '';
        updateUI();
        return;
      }
      if (waitingForSecondOperand) {
        currentInput = '0.';
        waitingForSecondOperand = false;
        updateUI();
        return;
      }
      if (!currentInput.includes('.')) {
        currentInput += '.';
        updateUI();
      }
    };

    const clearAll = () => {
      currentInput = '0';
      previousValue = null;
      operator = null;
      waitingForSecondOperand = false;
      expressionText = '';
      updateUI();
    };

    const backspace = () => {
      if (waitingForSecondOperand || currentInput === 'Error') return;
      if (currentInput.length <= 1 || (currentInput.length === 2 && currentInput.startsWith('-'))) {
        currentInput = '0';
      } else {
        currentInput = currentInput.slice(0, -1);
      }
      updateUI();
    };

    const toggleSign = () => {
      if (currentInput === '0' || currentInput === 'Error') return;
      currentInput = currentInput.startsWith('-') ? currentInput.slice(1) : '-' + currentInput;
      updateUI();
    };

    const inputPercent = () => {
      const val = parseFloat(currentInput);
      if (Number.isNaN(val)) return;
      let res;
      if (previousValue !== null && (operator === '+' || operator === '-')) {
        res = previousValue * (val / 100);
      } else {
        res = val / 100;
      }
      currentInput = normalizeFloat(res);
      waitingForSecondOperand = false;
      updateUI();
    };

    const calculate = (first, second, op) => {
      switch (op) {
        case '+': return first + second;
        case '-': return first - second;
        case '*': return first * second;
        case '/': return second === 0 ? NaN : first / second;
        default: return second;
      }
    };

    const handleOperator = (nextOp) => {
      if (currentInput === 'Error') {
        clearAll();
        return;
      }
      const inputValue = parseFloat(currentInput);

      if (operator && waitingForSecondOperand) {
        operator = nextOp;
        expressionText = `${formatNumberCL(String(previousValue))} ${opSymbols[nextOp]}`;
        updateUI();
        return;
      }

      if (previousValue === null) {
        previousValue = inputValue;
      } else if (operator) {
        const rawResult = calculate(previousValue, inputValue, operator);
        const norm = normalizeFloat(rawResult);
        if (norm === 'Error') {
          currentInput = 'Error';
          previousValue = null;
          operator = null;
          waitingForSecondOperand = false;
          expressionText = '';
          updateUI();
          return;
        }
        addHistory(`${formatNumberCL(String(previousValue))} ${opSymbols[operator]} ${formatNumberCL(String(inputValue))}`, norm);
        currentInput = norm;
        previousValue = parseFloat(norm);
      }

      waitingForSecondOperand = true;
      operator = nextOp;
      expressionText = `${formatNumberCL(String(previousValue))} ${opSymbols[nextOp]}`;
      updateUI();
    };

    const handleEquals = () => {
      if (operator === null || previousValue === null) return;
      const inputValue = parseFloat(currentInput);
      const rawResult = calculate(previousValue, inputValue, operator);
      const norm = normalizeFloat(rawResult);
      const exprRecord = `${formatNumberCL(String(previousValue))} ${opSymbols[operator]} ${formatNumberCL(String(inputValue))}`;
      expressionText = `${exprRecord} =`;
      currentInput = norm;
      addHistory(exprRecord, norm);
      previousValue = null;
      operator = null;
      waitingForSecondOperand = true;
      updateUI();
    };

    const handleQuickAction = (type) => {
      if (currentInput === 'Error') clearAll();
      const val = parseFloat(currentInput);
      if (Number.isNaN(val) || val === 0) return;

      let resStr = '0';
      let exprStr = '';

      if (type === 'add-iva') {
        const res = Math.round(val * 1.19 * 100) / 100;
        const iva = Math.round((res - val) * 100) / 100;
        resStr = normalizeFloat(res, 2);
        exprStr = `${formatNumberCL(String(val))} + IVA ($${formatNumberCL(String(iva))})`;
      } else if (type === 'sub-iva') {
        const neto = Math.round((val / 1.19) * 100) / 100;
        const iva = Math.round((val - neto) * 100) / 100;
        resStr = normalizeFloat(neto, 2);
        exprStr = `${formatNumberCL(String(val))} Neto (IVA: $${formatNumberCL(String(iva))})`;
      } else if (type === 'uf-to-clp') {
        const uf = getLiveUfValue();
        const clp = Math.round(val * uf);
        resStr = String(clp);
        exprStr = `${formatNumberCL(String(val))} UF × $${formatNumberCL(String(uf))}`;
      } else if (type === 'clp-to-uf') {
        const uf = getLiveUfValue();
        const ufVal = Math.round((val / uf) * 10000) / 10000;
        resStr = normalizeFloat(ufVal, 4);
        exprStr = `$${formatNumberCL(String(val))} ÷ $${formatNumberCL(String(uf))} UF`;
      }

      expressionText = exprStr;
      currentInput = resStr;
      previousValue = null;
      operator = null;
      waitingForSecondOperand = true;
      addHistory(exprStr, resStr);
      updateUI();
    };

    const openCalc = () => {
      dropdown.style.display = 'block';
      calcBtn.classList.add('calc-active');
      const notifDropdown = document.getElementById('notification-dropdown');
      if (notifDropdown) notifDropdown.style.display = 'none';
      renderHistory();
      updateUI();
    };

    const closeCalc = () => {
      dropdown.style.display = 'none';
      calcBtn.classList.remove('calc-active');
    };

    calcBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dropdown.style.display === 'none') {
        openCalc();
      } else {
        closeCalc();
      }
    });

    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeCalc();
      });
    }

    if (pinBtn) {
      pinBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isPinned = !isPinned;
        pinBtn.classList.toggle('active', isPinned);
        pinBtn.title = isPinned ? 'Calculadora fijada (clic para desfijar)' : 'Fijar abierta al hacer clic fuera';
      });
    }

    if (historyBtn && historyPanel) {
      historyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = historyPanel.style.display === 'none';
        historyPanel.style.display = isHidden ? 'block' : 'none';
        historyBtn.classList.toggle('active', isHidden);
        if (isHidden) renderHistory();
      });
    }

    if (historyClearBtn) {
      historyClearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        localStorage.removeItem(HISTORY_KEY);
        renderHistory();
      });
    }

    if (historyList) {
      historyList.addEventListener('click', (e) => {
        e.stopPropagation();
        const itemEl = e.target.closest('.admin-calc-history-item');
        if (!itemEl) return;
        const idx = parseInt(itemEl.getAttribute('data-hist-idx'), 10);
        const items = loadHistory();
        if (items[idx]) {
          currentInput = String(items[idx].result);
          expressionText = items[idx].expr;
          waitingForSecondOperand = true;
          updateUI();
        }
      });
    }

    if (copyBtn) {
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentInput === 'Error') return;
        const textToCopy = currentInput.replace('.', ',');
        navigator.clipboard.writeText(textToCopy).then(() => {
          copyBtn.classList.add('copied');
          copyBtn.innerHTML = '<i class="ri-check-line"></i>';
          setTimeout(() => {
            copyBtn.classList.remove('copied');
            copyBtn.innerHTML = '<i class="ri-file-copy-line"></i>';
          }, 1200);
        }).catch(() => {});
      });
    }

    dropdown.addEventListener('click', (e) => {
      e.stopPropagation();
      const numBtn = e.target.closest('[data-calc-num]');
      if (numBtn) {
        inputDigit(numBtn.getAttribute('data-calc-num'));
        return;
      }
      const opBtn = e.target.closest('[data-calc-op]');
      if (opBtn) {
        handleOperator(opBtn.getAttribute('data-calc-op'));
        return;
      }
      const actBtn = e.target.closest('[data-calc-action]');
      if (actBtn) {
        const act = actBtn.getAttribute('data-calc-action');
        if (act === 'clear') clearAll();
        else if (act === 'backspace') backspace();
        else if (act === 'decimal') inputDecimal();
        else if (act === 'negate') toggleSign();
        else if (act === 'percent') inputPercent();
        else if (act === 'equals') handleEquals();
        return;
      }
      const quickBtn = e.target.closest('[data-calc-quick]');
      if (quickBtn) {
        handleQuickAction(quickBtn.getAttribute('data-calc-quick'));
      }
    });

    document.addEventListener('click', (e) => {
      if (dropdown.style.display !== 'none' && !isPinned) {
        if (!dropdown.contains(e.target) && e.target !== calcBtn && !calcBtn.contains(e.target)) {
          closeCalc();
        }
      }
    });

    document.addEventListener('keydown', (e) => {
      if (dropdown.style.display === 'none') return;
      const activeTag = document.activeElement ? document.activeElement.tagName : '';
      const isEditable = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT' || (document.activeElement && document.activeElement.isContentEditable);
      if (isEditable) return;

      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        inputDigit(e.key);
      } else if (e.key === '.' || e.key === ',') {
        e.preventDefault();
        inputDecimal();
      } else if (e.key === '+' || e.key === '-' || e.key === '*' || e.key === '/') {
        e.preventDefault();
        handleOperator(e.key);
      } else if (e.key === '%') {
        e.preventDefault();
        inputPercent();
      } else if (e.key === 'Enter' || e.key === '=') {
        e.preventDefault();
        handleEquals();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        backspace();
      } else if (e.key === 'Delete' || e.key === 'c' || e.key === 'C') {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          clearAll();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (currentInput !== '0' || previousValue !== null || expressionText !== '') {
          clearAll();
        } else {
          closeCalc();
        }
      }
    });
  };

  initAdminCalculator();

  // ==========================================================================
  // Controlador Interactivo para Nuevo Header Admin v2 (.admin-header-v2)
  // ==========================================================================
  const initAdminHeaderV2 = () => {
    const header = document.querySelector('.top-header.admin-header-v2');
    if (!header) return;

    const sidebar = document.querySelector('.sidebar');
    const viewTitleEl = document.getElementById('view-title');
    const viewIconEl = document.getElementById('admin-view-icon');
    const bcGroupEl = document.getElementById('admin-breadcrumb-group');

    // 1. Cerrar todos los popovers del Header Admin (exclusión mutua)
    const closeAllHeaderPopovers = (exceptId = null) => {
      const popovers = [
        { id: 'admin-cmd-dropdown', wrap: 'admin-cmd-container', openClass: 'cmd-open' },
        { id: 'admin-quick-dropdown', wrap: 'admin-quick-container', openClass: 'open' },
        { id: 'admin-sync-dropdown', wrap: 'admin-sync-container', openClass: 'open' },
        { id: 'admin-ops-dropdown', wrap: 'admin-ops-container', openClass: 'open', btn: 'admin-ops-btn' },
        { id: 'admin-profile-dropdown', wrap: 'admin-profile-container', openClass: 'open' },
        { id: 'notification-dropdown', btn: 'notification-btn' },
        { id: 'admin-calc-dropdown', btn: 'admin-calc-btn' }
      ];

      popovers.forEach(p => {
        if (p.id === exceptId) return;
        const el = document.getElementById(p.id);
        if (el && el.style.display !== 'none') {
          if (p.id === 'admin-calc-dropdown') {
            const pinBtn = document.getElementById('admin-calc-pin-btn');
            if (pinBtn && pinBtn.classList.contains('active')) return;
          }
          el.style.display = 'none';
        }
        if (p.wrap) {
          const wrapEl = document.getElementById(p.wrap);
          if (wrapEl) wrapEl.classList.remove(p.openClass || 'open');
        }
        if (p.btn) {
          const btnEl = document.getElementById(p.btn);
          if (btnEl) {
            btnEl.classList.remove('is-open', 'calc-active');
          }
        }
      });
    };

    // Si se abre Notificaciones o Calculadora, cerrar el resto de menús
    const notifBtn = document.getElementById('notification-btn');
    if (notifBtn) {
      notifBtn.addEventListener('click', () => closeAllHeaderPopovers('notification-dropdown'));
    }
    const calcBtn = document.getElementById('admin-calc-btn');
    if (calcBtn) {
      calcBtn.addEventListener('click', () => closeAllHeaderPopovers('admin-calc-dropdown'));
    }

    // Helper para navegar a cualquier módulo del WMS de forma canónica
    const navigateToAdminView = (viewName, searchQuery = '') => {
      closeAllHeaderPopovers();
      if (!viewName) return;

      const targetLink = (sidebar && sidebar.querySelector(`.nav-item[data-view="${viewName}"]`)) ||
                         document.querySelector(`.nav-item[data-view="${viewName}"]`);
      if (targetLink) {
        targetLink.click();
        if (searchQuery) {
          setTimeout(() => {
            const searchInput = document.querySelector(
              '#app-content input[type="search"], #app-content input[placeholder*="Buscar"], #app-content input[placeholder*="buscar"], #app-content input[id*="search"]'
            );
            if (searchInput) {
              searchInput.value = searchQuery;
              searchInput.focus();
              searchInput.dispatchEvent(new Event('input', { bubbles: true }));
              searchInput.dispatchEvent(new Event('keyup', { bubbles: true }));
            }
          }, 320);
        }
      }
    };

    // Delegación para botones [data-admin-nav]
    header.addEventListener('click', (e) => {
      const navTrigger = e.target.closest('[data-admin-nav]');
      if (navTrigger) {
        e.preventDefault();
        e.stopPropagation();
        const targetView = navTrigger.getAttribute('data-admin-nav');
        navigateToAdminView(targetView);
      }
    });

    // Cerrar menús al hacer clic en links .nav-item dentro de los dropdowns del header
    header.querySelectorAll('.nav-item[data-view]').forEach(link => {
      link.addEventListener('click', () => {
        setTimeout(() => closeAllHeaderPopovers(), 50);
      });
    });

    // 2. Sincronizar Breadcrumb e Ícono de Módulo según la vista activa
    const syncHeaderContext = () => {
      if (!viewIconEl || !bcGroupEl) return;
      const activeNav = sidebar ? sidebar.querySelector('.nav-item.active') : null;
      const titleText = viewTitleEl ? viewTitleEl.textContent.trim() : '';

      if (titleText === 'Mi Perfil') {
        viewIconEl.className = 'ri-user-settings-line';
        bcGroupEl.textContent = 'Cuenta Administrador';
        return;
      }
      if (titleText === 'Mi Inbox') {
        viewIconEl.className = 'ri-inbox-archive-line';
        bcGroupEl.textContent = 'Comunicaciones';
        return;
      }

      if (activeNav) {
        const icon = activeNav.querySelector('i');
        if (icon && icon.className) {
          viewIconEl.className = icon.className.replace('fav-item-icon', '').trim();
        }
        const flyoutGroup = activeNav.closest('.sidebar-flyout-group');
        if (flyoutGroup) {
          const groupTitle = flyoutGroup.querySelector('.group-title');
          bcGroupEl.textContent = groupTitle ? groupTitle.textContent.trim() : 'Módulos WMS';
        } else {
          bcGroupEl.textContent = 'Panel Principal';
        }
      }
    };

    if (viewTitleEl) {
      const titleObs = new MutationObserver(syncHeaderContext);
      titleObs.observe(viewTitleEl, { childList: true, characterData: true, subtree: true });
    }
    document.addEventListener('click', (e) => {
      if (e.target.closest('.nav-item')) {
        setTimeout(syncHeaderContext, 40);
      }
    });
    syncHeaderContext();

    // 3. Cápsula UF Interactiva (Clic para copiar valor UF)
    const ufChip = document.getElementById('uf-chip');
    const ufValEl = document.getElementById('uf-value');
    const ufCopyIcon = document.getElementById('uf-copy-icon');
    if (ufChip && ufValEl) {
      ufChip.addEventListener('click', (e) => {
        e.stopPropagation();
        const rawText = ufValEl.textContent.trim();
        if (!rawText || rawText === '—' || rawText === '¡Copiado!') return;
        const cleanDigits = rawText.replace(/[^0-9]/g, '');
        navigator.clipboard.writeText(cleanDigits || rawText).then(() => {
          const prevText = rawText;
          ufChip.classList.add('uf-copied');
          ufValEl.textContent = '¡Copiado!';
          if (ufCopyIcon) ufCopyIcon.className = 'ri-check-line uf-copy-icon';
          setTimeout(() => {
            ufChip.classList.remove('uf-copied');
            ufValEl.textContent = prevText;
            if (ufCopyIcon) ufCopyIcon.className = 'ri-file-copy-line uf-copy-icon';
          }, 1200);
        }).catch(() => {});
      });
    }

    // 4. Buscador Omnicanal (Command Palette Ctrl+K)
    const cmdContainer = document.getElementById('admin-cmd-container');
    const cmdBtn = document.getElementById('admin-cmd-btn');
    const cmdDropdown = document.getElementById('admin-cmd-dropdown');
    const cmdInput = document.getElementById('admin-cmd-input');
    const cmdClear = document.getElementById('admin-cmd-clear');
    const cmdResults = document.getElementById('admin-cmd-results');
    let selectedCmdIdx = 0;

    const getCatalogModules = () => {
      const list = [];
      if (sidebar) {
        sidebar.querySelectorAll('.sidebar-primary-list .nav-item[data-view]').forEach(a => {
          if (a.classList.contains('hidden-ticket-nav')) return;
          const parentLi = a.closest('li');
          if (parentLi && parentLi.style.display === 'none') return;
          const view = a.getAttribute('data-view');
          const label = a.querySelector('.nav-text')?.textContent.trim() || a.textContent.trim();
          const icon = a.querySelector('i')?.className || 'ri-apps-line';
          const group = a.closest('.sidebar-flyout-group')?.querySelector('.group-title')?.textContent.trim() || 'Principal';
          list.push({ view, label, icon, group });
        });
      }
      list.push(
        { view: 'tickets_admin', label: 'Gestión de Tickets y Soporte', icon: 'ri-customer-service-2-line', group: 'Comercios y CRM' },
        { view: 'profile', label: 'Mi Perfil y Seguridad', icon: 'ri-user-settings-line', group: 'Cuenta Admin' },
        { view: 'inbox', label: 'Mi Bandeja de Entrada (Inbox)', icon: 'ri-inbox-archive-line', group: 'Comunicaciones' }
      );
      // Evitar duplicados por view
      const seen = new Set();
      return list.filter(item => {
        if (seen.has(item.view)) return false;
        seen.add(item.view);
        return true;
      });
    };

    const renderCmdResults = (query = '') => {
      if (!cmdResults) return;
      const q = query.trim().toLowerCase();
      if (cmdClear) cmdClear.style.display = q.length > 0 ? 'flex' : 'none';

      const allModules = getCatalogModules();
      const matched = q
        ? allModules.filter(m => m.label.toLowerCase().includes(q) || m.group.toLowerCase().includes(q) || m.view.toLowerCase().includes(q))
        : allModules.slice(0, 8);

      let html = '';

      if (q.length >= 2) {
        const safeQ = query.trim().replace(/"/g, '&quot;');
        html += `<div class="cmd-group-label">Búsqueda Directa de Datos</div>`;
        html += `
          <button type="button" class="cmd-result-item" data-cmd-view="orders_admin" data-cmd-query="${safeQ}">
            <span class="cmd-result-left">
              <span class="cmd-result-icon"><i class="ri-search-eye-line"></i></span>
              <span class="cmd-result-text">
                <span class="cmd-result-title">Buscar "${safeQ}" en Gestor de Pedidos</span>
                <span class="cmd-result-sub">Filtrar por #pedido, destinatario, tracking o comercio</span>
              </span>
            </span>
            <span class="cmd-result-go">Buscar ↵</span>
          </button>
          <button type="button" class="cmd-result-item" data-cmd-view="inventory_admin" data-cmd-query="${safeQ}">
            <span class="cmd-result-left">
              <span class="cmd-result-icon"><i class="ri-database-2-line"></i></span>
              <span class="cmd-result-text">
                <span class="cmd-result-title">Buscar "${safeQ}" en Inventario General</span>
                <span class="cmd-result-sub">Filtrar por código SKU, producto o bodega</span>
              </span>
            </span>
            <span class="cmd-result-go">Buscar ↵</span>
          </button>
        `;
      }

      if (matched.length > 0) {
        html += `<div class="cmd-group-label">${q ? 'Módulos Coincidentes' : 'Módulos Frecuentes'}</div>`;
        matched.forEach(m => {
          html += `
            <button type="button" class="cmd-result-item" data-cmd-view="${m.view}">
              <span class="cmd-result-left">
                <span class="cmd-result-icon"><i class="${m.icon}"></i></span>
                <span class="cmd-result-text">
                  <span class="cmd-result-title">${m.label}</span>
                  <span class="cmd-result-sub">${m.group}</span>
                </span>
              </span>
              <span class="cmd-result-go">Ir →</span>
            </button>
          `;
        });
      } else if (q.length < 2) {
        html += `<div style="padding: 1rem; text-align: center; font-size: 0.78rem; color: var(--color-text-muted);">Sin módulos coincidentes.</div>`;
      }

      cmdResults.innerHTML = html;
      selectedCmdIdx = 0;
      const items = cmdResults.querySelectorAll('.cmd-result-item');
      if (items[0]) items[0].classList.add('is-selected');
    };

    const openCmdPalette = () => {
      closeAllHeaderPopovers('admin-cmd-dropdown');
      if (!cmdDropdown || !cmdContainer) return;
      cmdDropdown.style.display = 'block';
      cmdContainer.classList.add('cmd-open');
      renderCmdResults(cmdInput ? cmdInput.value : '');
      setTimeout(() => cmdInput && cmdInput.focus(), 20);
    };

    if (cmdBtn && cmdDropdown) {
      cmdBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (cmdDropdown.style.display === 'none') openCmdPalette();
        else closeAllHeaderPopovers();
      });
    }

    if (cmdInput) {
      cmdInput.addEventListener('input', () => renderCmdResults(cmdInput.value));
      cmdInput.addEventListener('keydown', (e) => {
        const items = Array.from(cmdResults.querySelectorAll('.cmd-result-item'));
        if (!items.length) return;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          items[selectedCmdIdx]?.classList.remove('is-selected');
          selectedCmdIdx = (selectedCmdIdx + 1) % items.length;
          items[selectedCmdIdx]?.classList.add('is-selected');
          items[selectedCmdIdx]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          items[selectedCmdIdx]?.classList.remove('is-selected');
          selectedCmdIdx = (selectedCmdIdx - 1 + items.length) % items.length;
          items[selectedCmdIdx]?.classList.add('is-selected');
          items[selectedCmdIdx]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
          e.preventDefault();
          items[selectedCmdIdx]?.click();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeAllHeaderPopovers();
        }
      });
    }

    if (cmdClear && cmdInput) {
      cmdClear.addEventListener('click', (e) => {
        e.stopPropagation();
        cmdInput.value = '';
        renderCmdResults('');
        cmdInput.focus();
      });
    }

    if (cmdResults) {
      cmdResults.addEventListener('click', (e) => {
        const item = e.target.closest('.cmd-result-item');
        if (!item) return;
        e.stopPropagation();
        const view = item.getAttribute('data-cmd-view');
        const query = item.getAttribute('data-cmd-query') || '';
        navigateToAdminView(view, query);
      });
    }

    // Atajo global Ctrl+K / Cmd+K
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (cmdDropdown && cmdDropdown.style.display !== 'none') {
          closeAllHeaderPopovers();
        } else {
          openCmdPalette();
        }
      }
    });

    // 5. Menú Desplegable: + Acción Rápida
    const quickContainer = document.getElementById('admin-quick-container');
    const quickBtn = document.getElementById('admin-quick-btn');
    const quickDropdown = document.getElementById('admin-quick-dropdown');
    if (quickBtn && quickDropdown && quickContainer) {
      quickBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = quickDropdown.style.display === 'none';
        closeAllHeaderPopovers('admin-quick-dropdown');
        quickDropdown.style.display = isHidden ? 'block' : 'none';
        quickContainer.classList.toggle('open', isHidden);
      });
    }

    // 6. Pulso de Sincronización & Monitores (MeLi + GitHub Labels)
    const syncContainer = document.getElementById('admin-sync-container');
    const syncBtn = document.getElementById('admin-sync-btn');
    const syncDropdown = document.getElementById('admin-sync-dropdown');
    const syncText = document.getElementById('admin-sync-text');
    const syncBadge = document.getElementById('admin-sync-badge');
    const syncStatusTag = document.getElementById('admin-sync-status-tag');
    const openMeliBtn = document.getElementById('header-open-meli-panel-btn');
    const triggerMeliBtn = document.getElementById('header-trigger-meli-sync-btn');
    const openWmsBtn = document.getElementById('header-open-wms-panel-btn');
    const hideFloatCb = document.getElementById('toggle-hide-floating-monitors');

    if (syncBtn && syncDropdown && syncContainer) {
      syncBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = syncDropdown.style.display === 'none';
        closeAllHeaderPopovers('admin-sync-dropdown');
        syncDropdown.style.display = isHidden ? 'block' : 'none';
        syncContainer.classList.toggle('open', isHidden);
      });
    }

    if (openMeliBtn) {
      openMeliBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllHeaderPopovers();
        const panel = document.getElementById('meli-monitor-panel');
        if (panel) panel.classList.add('opened-from-header');
        if (typeof window.toggleMeliMonitorPanel === 'function') {
          window.toggleMeliMonitorPanel();
        }
      });
    }

    if (triggerMeliBtn) {
      triggerMeliBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof window.triggerMeliSyncFromGlobe === 'function') {
          window.triggerMeliSyncFromGlobe(triggerMeliBtn);
        }
      });
    }

    if (openWmsBtn) {
      openWmsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllHeaderPopovers();
        const panel = document.getElementById('wms-monitor-panel');
        if (panel) panel.classList.add('opened-from-header');
        if (typeof window.toggleWmsMonitorPanel === 'function') {
          window.toggleWmsMonitorPanel();
        }
      });
    }

    // Preferencia de ocultar botones flotantes inferiores (por defecto activado para limpiar la vista)
    if (hideFloatCb) {
      const savedPref = localStorage.getItem('stocka_hide_floating_monitors');
      const shouldHide = savedPref === null ? true : savedPref === 'true';
      hideFloatCb.checked = shouldHide;
      document.body.classList.toggle('hide-floating-monitors', shouldHide);

      hideFloatCb.addEventListener('change', () => {
        const hide = hideFloatCb.checked;
        localStorage.setItem('stocka_hide_floating_monitors', String(hide));
        document.body.classList.toggle('hide-floating-monitors', hide);
      });
    }

    // Sincronizar estado visual del botón Sync con los monitores reales
    const syncMonitorStatusToHeader = () => {
      const meliBtn = document.getElementById('meli-monitor-btn');
      const wmsBtn = document.getElementById('wms-monitor-btn');
      const meliBadge = document.getElementById('meli-badge-count');
      if (!syncBtn || !syncText) return;

      const isError = (meliBtn && meliBtn.classList.contains('status-error')) ||
                      (wmsBtn && wmsBtn.classList.contains('status-error'));
      const isActive = (meliBtn && meliBtn.classList.contains('status-active')) ||
                       (wmsBtn && wmsBtn.classList.contains('status-active'));

      syncBtn.classList.remove('status-success', 'status-active', 'status-error');
      if (isError) {
        syncBtn.classList.add('status-error');
        syncText.textContent = 'Alerta Sync';
        if (syncStatusTag) {
          syncStatusTag.textContent = 'Revisar';
          syncStatusTag.className = 'sync-status-tag';
          syncStatusTag.style.background = 'rgba(239,68,68,0.15)';
          syncStatusTag.style.color = '#ef4444';
        }
      } else if (isActive) {
        syncBtn.classList.add('status-active');
        syncText.textContent = 'Sync Activo';
        if (syncStatusTag) {
          syncStatusTag.textContent = 'Sincronizando...';
          syncStatusTag.className = 'sync-status-tag';
          syncStatusTag.style.background = 'rgba(245,158,11,0.15)';
          syncStatusTag.style.color = '#d97706';
        }
      } else {
        syncBtn.classList.add('status-success');
        syncText.textContent = 'Sync OK';
        if (syncStatusTag) {
          syncStatusTag.textContent = 'En línea';
          syncStatusTag.className = 'sync-status-tag tag-ok';
          syncStatusTag.style.background = '';
          syncStatusTag.style.color = '';
        }
      }

      if (syncBadge && meliBadge) {
        const countTxt = meliBadge.textContent.trim();
        const show = meliBadge.style.display !== 'none' && countTxt && countTxt !== '0';
        syncBadge.textContent = countTxt;
        syncBadge.style.display = show ? 'inline-block' : 'none';
      }
    };

    const meliBtnEl = document.getElementById('meli-monitor-btn');
    const wmsBtnEl = document.getElementById('wms-monitor-btn');
    if (meliBtnEl || wmsBtnEl) {
      const monObs = new MutationObserver(syncMonitorStatusToHeader);
      if (meliBtnEl) monObs.observe(meliBtnEl, { attributes: true, subtree: true, childList: true });
      if (wmsBtnEl) monObs.observe(wmsBtnEl, { attributes: true, subtree: true, childList: true });
      syncMonitorStatusToHeader();
    }

    // 7. Radar de Atención Operativa (Suma de badges pendientes en tiempo real)
    const opsContainer = document.getElementById('admin-ops-container');
    const opsBtn = document.getElementById('admin-ops-btn');
    const opsDropdown = document.getElementById('admin-ops-dropdown');
    const opsBadge = document.getElementById('admin-ops-badge');
    const opsTotalLabel = document.getElementById('admin-ops-total-label');

    if (opsBtn && opsDropdown && opsContainer) {
      opsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = opsDropdown.style.display === 'none';
        closeAllHeaderPopovers('admin-ops-dropdown');
        opsDropdown.style.display = isHidden ? 'block' : 'none';
        opsContainer.classList.toggle('open', isHidden);
        opsBtn.classList.toggle('is-open', isHidden);
      });
    }

    const syncOperationalRadar = () => {
      const readBadge = (id) => {
        const el = document.getElementById(id);
        if (!el || el.style.display === 'none') return 0;
        const n = parseInt(el.textContent.trim(), 10);
        return isNaN(n) ? 0 : n;
      };

      const counts = {
        incidencias: readBadge('badge-incidencias-admin'),
        declarations: readBadge('badge-declarations'),
        tickets: readBadge('badge-tickets-sidebar') || readBadge('badge-tickets'),
        onboarding: readBadge('badge-onboarding'),
        billing: readBadge('badge-billing'),
        leads: readBadge('badge-leads-central')
      };

      let total = 0;
      Object.entries(counts).forEach(([key, val]) => {
        total += val;
        const pill = header.querySelector(`[data-ops-count="${key}"]`);
        if (pill) {
          pill.textContent = String(val);
          pill.classList.toggle('has-count', val > 0);
        }
      });

      if (opsBadge) {
        if (total > 0) {
          opsBadge.textContent = total > 99 ? '99+' : String(total);
          opsBadge.style.display = 'flex';
          if (opsBtn) opsBtn.classList.add('has-pending');
        } else {
          opsBadge.style.display = 'none';
          if (opsBtn) opsBtn.classList.remove('has-pending');
        }
      }

      if (opsTotalLabel) {
        opsTotalLabel.textContent = total > 0 ? `${total} pendientes` : 'Al día ✓';
      }
    };

    if (sidebar) {
      const opsObs = new MutationObserver(syncOperationalRadar);
      opsObs.observe(sidebar, { attributes: true, childList: true, characterData: true, subtree: true });
    }
    setInterval(syncOperationalRadar, 4000);
    setTimeout(syncOperationalRadar, 1200);

    // 8. Menú de Perfil Admin Interactivo + Iniciales Dinámicas
    const profileContainer = document.getElementById('admin-profile-container');
    const profileBtn = document.getElementById('admin-profile-btn');
    const profileDropdown = document.getElementById('admin-profile-dropdown');
    const userEmailSpan = document.getElementById('user-email');
    const avatarInitials = document.getElementById('admin-avatar-initials');
    const dropdownInitials = document.getElementById('admin-dropdown-initials');
    const dropdownName = document.getElementById('admin-dropdown-name');
    const dropdownEmail = document.getElementById('admin-dropdown-email');
    const headerLogoutBtn = document.getElementById('admin-header-logout-btn');

    if (profileBtn && profileDropdown && profileContainer) {
      profileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = profileDropdown.style.display === 'none';
        closeAllHeaderPopovers('admin-profile-dropdown');
        profileDropdown.style.display = isHidden ? 'block' : 'none';
        profileContainer.classList.toggle('open', isHidden);
      });
    }

    const syncAdminProfileDisplay = () => {
      if (!userEmailSpan) return;
      const raw = userEmailSpan.textContent.trim();
      if (!raw || raw === 'Cargando...') return;

      // Limpiar sufijo " (ADMIN)" ya que ahora existe la insignia dedicada .admin-role-pill
      if (raw.endsWith('(ADMIN)')) {
        const cleanName = raw.replace(/\s*\(ADMIN\)\s*$/i, '').trim();
        if (cleanName && userEmailSpan.textContent !== cleanName) {
          userEmailSpan.textContent = cleanName;
        }
      }

      const finalName = userEmailSpan.textContent.trim();
      const parts = finalName.split(/[\s._@-]+/).filter(Boolean);
      const initials = parts.length >= 2
        ? (parts[0][0] + parts[1][0]).toUpperCase()
        : finalName.slice(0, 2).toUpperCase();

      if (avatarInitials) avatarInitials.textContent = initials || 'AD';
      if (dropdownInitials) dropdownInitials.textContent = initials || 'AD';
      if (dropdownName) dropdownName.textContent = finalName;
      if (dropdownEmail && window.currentAdminUser?.email) {
        dropdownEmail.textContent = window.currentAdminUser.email;
      }
    };

    if (userEmailSpan) {
      const userObs = new MutationObserver(syncAdminProfileDisplay);
      userObs.observe(userEmailSpan, { childList: true, characterData: true, subtree: true });
      syncAdminProfileDisplay();
    }

    if (headerLogoutBtn) {
      headerLogoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        closeAllHeaderPopovers();
        const sidebarLogoutBtn = document.getElementById('logout-btn');
        if (sidebarLogoutBtn) {
          sidebarLogoutBtn.click();
        }
      });
    }

    // Cerrar cualquier popover al hacer clic fuera
    document.addEventListener('click', (e) => {
      if (!header.contains(e.target)) {
        closeAllHeaderPopovers('admin-calc-dropdown');
      }
    });
  };

  initAdminHeaderV2();
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
