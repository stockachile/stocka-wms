/**
 * WMS STOCKA - Tour Guiado Interactivo (Product Tour & Onboarding)
 * Inspirado en el diseño UX de Seller Center Falabella
 */

// Pasos del recorrido guiado para el cliente
const TOUR_STEPS = [
  {
    selector: 'a.nav-item[data-view="dashboard"]',
    tag: 'Centro de Control',
    icon: 'ri-dashboard-line',
    title: 'Dashboard General',
    description: 'Aquí tienes la visión general de tu operación en tiempo real: pedidos procesados hoy, envíos en tránsito, órdenes atrasadas y accesos directos rápidos.',
    position: 'right'
  },
  {
    selector: 'a.nav-item[data-view="inventory"]',
    tag: 'Stock en Bodega',
    icon: 'ri-box-3-line',
    title: 'Gestión de Inventario',
    description: 'Consulta tus existencias físicas exactas. Revisa el stock disponible para la venta, reservado y comprometido por SKU, evitando quiebres de inventario.',
    position: 'right'
  },
  {
    selector: 'a.nav-item[data-view="declarations"]',
    tag: 'Recepción',
    icon: 'ri-inbox-archive-line',
    title: 'Ingresos de Stock (DDI)',
    description: 'Crea tu Declaración de Ingreso antes de despachar mercadería a STOCKA. Así nuestro equipo de bodega sabe exactamente qué recibir, verificar y almacenar.',
    position: 'right'
  },
  {
    selector: 'a.nav-item[data-view="orders"]',
    tag: 'Fulfillment',
    icon: 'ri-shopping-cart-2-line',
    title: 'Pedidos Sincronizados',
    description: 'Tus ventas de Shopify, Mercado Libre, Falabella, Ripley, etc., se sincronizan automáticamente. Sigue el estado del picking y empaque de cada orden.',
    position: 'right'
  },
  {
    selector: 'a.nav-item[data-view="shipments"]',
    tag: 'Última Milla',
    icon: 'ri-truck-line',
    title: 'Despachos y Seguimiento',
    description: 'Rastrea los envíos entregados a couriers (Blue Express, Chilexpress, Starken, etc.). Visualiza números de orden de transporte y estados de entrega.',
    position: 'right'
  },
  {
    selector: 'a.nav-item[data-view="billing"]',
    tag: 'Finanzas',
    icon: 'ri-bill-line',
    title: 'Facturación Transparente',
    description: 'Revisa de forma clara y detallada todos los cargos de tu cuenta: costos por m³ de bodegaje, preparación de pedidos (picking/packing) y fletes.',
    position: 'right'
  },
  {
    selector: 'a.nav-item[data-view="integrations"]',
    tag: 'Canales de Venta',
    icon: 'ri-plug-line',
    title: 'Integraciones Ecommerce',
    description: 'Conecta tus tiendas para que tus pedidos, catálogo y despachos se sincronicen de inmediato con el WMS. Mira los ejemplos:',
    position: 'right',
    isIntegrationStep: true
  },
  {
    selector: '#sidebar-support-btn, a.nav-item[data-view="tickets"]',
    tag: 'Atención 24/7',
    icon: 'ri-customer-service-2-line',
    title: 'Soporte y Mesa de Ayuda',
    description: '¿Tienes alguna duda con un envío o necesitas ayuda operativa? Crea un ticket directo para que nuestro equipo te asista con máxima prioridad.',
    position: 'right'
  }
];

class GuidedTour {
  constructor() {
    this.steps = [];
    this.currentIndex = 0;
    this.active = false;
    this.spotlightEl = null;
    this.beaconEl = null;
    this.popoverEl = null;
    this.boundHandleKeyDown = this.handleKeyDown.bind(this);
    this.boundHandleResize = this.handleResize.bind(this);

    this.initElements();
  }

  initElements() {
    // Spotlight
    this.spotlightEl = document.getElementById('tour-spotlight');
    if (!this.spotlightEl) {
      this.spotlightEl = document.createElement('div');
      this.spotlightEl.id = 'tour-spotlight';
      document.body.appendChild(this.spotlightEl);
    }

    // Beacon pulsante
    this.beaconEl = document.getElementById('tour-beacon');
    if (!this.beaconEl) {
      this.beaconEl = document.createElement('div');
      this.beaconEl.id = 'tour-beacon';
      document.body.appendChild(this.beaconEl);
    }

    // Popover flotante
    this.popoverEl = document.getElementById('tour-popover');
    if (!this.popoverEl) {
      this.popoverEl = document.createElement('div');
      this.popoverEl.id = 'tour-popover';
      document.body.appendChild(this.popoverEl);
    }
  }

  // Filtrar pasos que existan y estén visibles en el DOM
  getAvailableSteps() {
    return TOUR_STEPS.filter(step => {
      const el = document.querySelector(step.selector);
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      // Verificar también el li contenedor en el sidebar
      const parentLi = el.closest('li');
      if (parentLi && window.getComputedStyle(parentLi).display === 'none') return false;
      return true;
    });
  }

  start(stepIndex = 0) {
    this.steps = this.getAvailableSteps();
    if (this.steps.length === 0) {
      console.warn('[Tour] No hay módulos visibles para mostrar.');
      return;
    }

    this.active = true;
    this.currentIndex = Math.max(0, Math.min(stepIndex, this.steps.length - 1));

    document.addEventListener('keydown', this.boundHandleKeyDown);
    window.addEventListener('resize', this.boundHandleResize);
    window.addEventListener('scroll', this.boundHandleResize, true);

    this.renderStep();
  }

  renderStep() {
    if (!this.active) return;

    const step = this.steps[this.currentIndex];
    const targetEl = document.querySelector(step.selector);

    if (!targetEl) {
      // Si el elemento no se encuentra, avanzar al siguiente
      if (this.currentIndex < this.steps.length - 1) {
        this.next();
      } else {
        this.finish();
      }
      return;
    }

    // Asegurar que el elemento esté a la vista (scroll suave si está en menú largo)
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });

    // Pequeño timeout para permitir que termine el scroll si hubo
    setTimeout(() => {
      this.updatePositions(targetEl, step);
    }, 50);

    // Contenido del Popover
    const isFirst = this.currentIndex === 0;
    const isLast = this.currentIndex === this.steps.length - 1;
    const stepNum = this.currentIndex + 1;
    const totalSteps = this.steps.length;

    // Dots indicator
    let dotsHtml = '<div class="tour-dots-indicator">';
    for (let i = 0; i < totalSteps; i++) {
      dotsHtml += `<span class="tour-dot ${i === this.currentIndex ? 'active' : ''}"></span>`;
    }
    dotsHtml += '</div>';

    // Contenido extra interactivo para el paso de integraciones
    let extraHtml = '';
    if (step.isIntegrationStep) {
      this.popoverEl.classList.add('tour-popover-wide');
      extraHtml = `
        <div class="tour-integration-container">
          <div class="tour-plat-selector">
            <button type="button" class="tour-plat-tab active" data-plat="shopify">
              <i class="ri-shopping-bag-3-line" style="color: #10b981;"></i> Shopify
            </button>
            <button type="button" class="tour-plat-tab" data-plat="meli">
              <i class="ri-store-2-line" style="color: #f59e0b;"></i> MercadoLibre
            </button>
          </div>

          <div class="tour-plat-card" id="tour-card-shopify">
            <div class="tour-plat-step-item">
              <span class="step-badge">1</span>
              <div><strong>URL de la tienda:</strong> Ingresa <code>mitienda.myshopify.com</code> y pulsa <em>Conectar</em>.</div>
            </div>
            <div class="tour-plat-step-item">
              <span class="step-badge">2</span>
              <div><strong>Instalar App:</strong> Aprueba los permisos en 1 clic en tu panel de Shopify.</div>
            </div>
            <div class="tour-plat-step-item">
              <span class="step-badge">3</span>
              <div><strong>PIN Partner:</strong> Pega tu PIN de 4 dígitos para sincronizar guías y tracking.</div>
            </div>
          </div>

          <div class="tour-plat-card" id="tour-card-meli" style="display: none;">
            <div class="tour-plat-step-item">
              <span class="step-badge">1</span>
              <div><strong>Obtener Código:</strong> Autoriza la app con tu cuenta de Mercado Libre.</div>
            </div>
            <div class="tour-plat-step-item">
              <span class="step-badge">2</span>
              <div><strong>Pegar Código:</strong> Copia el código completo <code>TG-...</code> de la URL al WMS.</div>
            </div>
            <div class="tour-plat-step-item">
              <span class="step-badge">3</span>
              <div><strong>Colaborador:</strong> Agrega el correo de Stocka para imprimir etiquetas Flex y Envíos.</div>
            </div>
          </div>

          <div class="tour-integration-actions">
            <button type="button" class="tour-btn-open-guide" id="tour-btn-detail-guide">
              <i class="ri-book-open-line"></i> Guía Detallada
            </button>
            <button type="button" class="tour-btn-open-view" id="tour-btn-open-module">
              <i class="ri-external-link-line"></i> Abrir Módulo
            </button>
          </div>
        </div>
      `;
    } else {
      this.popoverEl.classList.remove('tour-popover-wide');
    }

    this.popoverEl.innerHTML = `
      <div class="tour-arrow" id="tour-arrow"></div>
      <div class="tour-header">
        <div class="tour-meta-left">
          <span class="tour-badge">${step.tag || 'Módulo'}</span>
          <span class="tour-step-counter">${stepNum} de ${totalSteps}</span>
        </div>
        <button type="button" class="tour-close-btn" id="tour-btn-close" title="Cerrar tour">&times;</button>
      </div>

      <h3 class="tour-title">
        <i class="${step.icon}"></i>
        <span>${step.title}</span>
      </h3>
      <p class="tour-description">${step.description}</p>

      ${extraHtml}

      ${dotsHtml}

      <div class="tour-footer">
        <button type="button" class="tour-btn-back" id="tour-btn-back" ${isFirst ? 'disabled' : ''}>
          Volver
        </button>
        <div class="tour-actions-right">
          <button type="button" class="tour-btn-skip" id="tour-btn-skip">
            Omitir
          </button>
          <button type="button" class="tour-btn-next ${isLast ? 'finish-btn' : ''}" id="tour-btn-next">
            ${isLast ? 'Finalizar <i class="ri-check-line"></i>' : 'Siguiente <i class="ri-arrow-right-line"></i>'}
          </button>
        </div>
      </div>
    `;

    // Event Listeners de botones de navegación
    const closeBtn = document.getElementById('tour-btn-close');
    const backBtn = document.getElementById('tour-btn-back');
    const skipBtn = document.getElementById('tour-btn-skip');
    const nextBtn = document.getElementById('tour-btn-next');

    if (closeBtn) closeBtn.onclick = () => this.finish(true);
    if (skipBtn) skipBtn.onclick = () => this.finish(true);
    if (backBtn) backBtn.onclick = () => this.prev();
    if (nextBtn) nextBtn.onclick = () => isLast ? this.finish() : this.next();

    // Event Listeners para la sección interactiva de integraciones
    if (step.isIntegrationStep) {
      const platTabs = this.popoverEl.querySelectorAll('.tour-plat-tab');
      const cardShopify = document.getElementById('tour-card-shopify');
      const cardMeli = document.getElementById('tour-card-meli');
      platTabs.forEach(tab => {
        tab.onclick = () => {
          platTabs.forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          const plat = tab.getAttribute('data-plat');
          if (plat === 'shopify') {
            if (cardShopify) cardShopify.style.display = 'flex';
            if (cardMeli) cardMeli.style.display = 'none';
          } else {
            if (cardShopify) cardShopify.style.display = 'none';
            if (cardMeli) cardMeli.style.display = 'flex';
          }
          this.updatePositions(targetEl, step);
        };
      });

      const btnDetailGuide = document.getElementById('tour-btn-detail-guide');
      if (btnDetailGuide) {
        btnDetailGuide.onclick = () => {
          const activeTab = this.popoverEl.querySelector('.tour-plat-tab.active');
          const activePlat = activeTab ? activeTab.getAttribute('data-plat') : 'shopify';
          showIntegrationsDetailModal(activePlat);
        };
      }

      const btnOpenModule = document.getElementById('tour-btn-open-module');
      if (btnOpenModule) {
        btnOpenModule.onclick = () => {
          const activeTab = this.popoverEl.querySelector('.tour-plat-tab.active');
          const activePlat = activeTab ? activeTab.getAttribute('data-plat') : 'shopify';
          openIntegrationsViewFromTour(activePlat);
        };
      }
    }

    // Activar clases
    this.spotlightEl.classList.add('active');
    this.beaconEl.classList.add('active');
    this.popoverEl.classList.add('active');
  }

  updatePositions(targetEl, step) {
    const rect = targetEl.getBoundingClientRect();
    const padX = 8;
    const padY = 6;

    // 1. Spotlight
    this.spotlightEl.style.top = `${Math.max(0, rect.top - padY)}px`;
    this.spotlightEl.style.left = `${Math.max(0, rect.left - padX)}px`;
    this.spotlightEl.style.width = `${rect.width + padX * 2}px`;
    this.spotlightEl.style.height = `${rect.height + padY * 2}px`;

    // 2. Beacon Pulsante (ubicado en el extremo derecho del elemento o del spotlight)
    const beaconSize = 18;
    const beaconTop = rect.top + rect.height / 2 - beaconSize / 2;
    const beaconLeft = rect.right + padX - beaconSize / 2;
    this.beaconEl.style.top = `${beaconTop}px`;
    this.beaconEl.style.left = `${beaconLeft}px`;

    // 3. Popover
    const popoverRect = this.popoverEl.getBoundingClientRect();
    const popWidth = popoverRect.width || 360;
    const popHeight = popoverRect.height || 220;

    let popTop = 0;
    let popLeft = 0;
    let arrowClass = 'tour-arrow-left';

    const gap = 16;
    const isMobile = window.innerWidth <= 640;

    if (isMobile) {
      // En móvil, fijado abajo
      return;
    }

    // Por defecto posición a la derecha
    popLeft = rect.right + padX + gap;
    popTop = rect.top + rect.height / 2 - popHeight / 2;

    // Verificar si se sale por la derecha
    if (popLeft + popWidth > window.innerWidth - 16) {
      // Cambiar a la izquierda o abajo
      if (rect.left - popWidth - gap > 16) {
        popLeft = rect.left - padX - popWidth - gap;
        arrowClass = 'tour-arrow-right';
      } else {
        popLeft = Math.max(16, (window.innerWidth - popWidth) / 2);
        popTop = rect.bottom + padY + gap;
        arrowClass = 'tour-arrow-top';
      }
    }

    // Ajustar límites verticales
    if (popTop < 20) {
      popTop = 20;
    } else if (popTop + popHeight > window.innerHeight - 20) {
      popTop = window.innerHeight - popHeight - 20;
    }

    this.popoverEl.style.top = `${popTop}px`;
    this.popoverEl.style.left = `${popLeft}px`;

    // Ajustar flecha
    const arrowEl = document.getElementById('tour-arrow');
    if (arrowEl) {
      arrowEl.className = 'tour-arrow ' + arrowClass;
      // Centrar la flecha con respecto al target
      if (arrowClass === 'tour-arrow-left' || arrowClass === 'tour-arrow-right') {
        const arrowTopOffset = Math.max(16, Math.min(popHeight - 26, (rect.top + rect.height / 2) - popTop - 6));
        arrowEl.style.top = `${arrowTopOffset}px`;
      }
    }
  }

  next() {
    if (this.currentIndex < this.steps.length - 1) {
      this.currentIndex++;
      this.renderStep();
    } else {
      this.finish();
    }
  }

  prev() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.renderStep();
    }
  }

  finish(skipped = false) {
    this.active = false;

    if (this.spotlightEl) this.spotlightEl.classList.remove('active');
    if (this.beaconEl) this.beaconEl.classList.remove('active');
    if (this.popoverEl) this.popoverEl.classList.remove('active');

    document.removeEventListener('keydown', this.boundHandleKeyDown);
    window.removeEventListener('resize', this.boundHandleResize);
    window.removeEventListener('scroll', this.boundHandleResize, true);

    // Guardar en localStorage para no molestar nuevamente
    try {
      localStorage.setItem('stocka_guided_tour_seen', 'true');
    } catch (e) {
      console.warn(e);
    }

    // Feedback visual si completó el tour
    if (!skipped && window.Swal) {
      window.Swal.fire({
        title: '¡Recorrido Completado!',
        text: 'Ya conoces los módulos principales. Si deseas volver a ver esta guía en cualquier momento, haz clic en "Tour guiado" en la barra superior.',
        icon: 'success',
        confirmButtonText: '¡Entendido!',
        confirmButtonColor: 'var(--color-primary)'
      });
    }
  }

  handleKeyDown(e) {
    if (!this.active) return;
    if (e.key === 'Escape') {
      this.finish(true);
    } else if (e.key === 'ArrowRight') {
      this.next();
    } else if (e.key === 'ArrowLeft') {
      this.prev();
    }
  }

  handleResize() {
    if (!this.active) return;
    const step = this.steps[this.currentIndex];
    if (!step) return;
    const targetEl = document.querySelector(step.selector);
    if (targetEl) {
      this.updatePositions(targetEl, step);
    }
  }
}

// Instancia única
let tourInstance = null;

export function getTourInstance() {
  if (!tourInstance) {
    tourInstance = new GuidedTour();
  }
  return tourInstance;
}

export function startGuidedTour(stepIndex = 0) {
  const tour = getTourInstance();
  tour.start(stepIndex);
}

// Exponer globalmente
window.startGuidedTour = startGuidedTour;

// Modal de Bienvenida e Invitación al Tour
export function openTourWelcomeModal() {
  if (!window.Swal) {
    startGuidedTour(0);
    return;
  }

  window.Swal.fire({
    html: `
      <div class="tour-welcome-modal">
        <div class="tour-welcome-banner">
          <img src="./img/stocka_tour_welcome.jpg" alt="Bienvenido a STOCKA" class="tour-welcome-img">
          <div class="tour-welcome-overlay"></div>
          <div class="tour-welcome-badge">
            <i class="ri-sparkling-fill"></i> Tour Guiado
          </div>
          <div class="tour-welcome-slogan-badge">
            Fulfillment 360°
          </div>
        </div>
        <div class="tour-welcome-body">
          <h2 class="tour-welcome-title">¡Te damos la bienvenida a STOCKA!</h2>
          <div class="tour-welcome-subtitle">Tú solo vendes. Nosotros almacenamos, preparamos y despachamos.</div>
          <p class="tour-welcome-desc">
            Queremos que aproveches al máximo tu plataforma. Te invitamos a un breve recorrido interactivo de <strong>1 minuto</strong> por los módulos más importantes de tu operación.
          </p>
          <div class="tour-welcome-pills">
            <span class="tour-welcome-pill"><i class="ri-box-3-line"></i> Inventario</span>
            <span class="tour-welcome-pill"><i class="ri-inbox-archive-line"></i> Recepción</span>
            <span class="tour-welcome-pill"><i class="ri-shopping-cart-2-line"></i> Pedidos</span>
            <span class="tour-welcome-pill"><i class="ri-truck-line"></i> Despachos</span>
          </div>
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: '<i class="ri-compass-3-line"></i> Comenzar Tour (1 min)',
    cancelButtonText: 'Explorar por mi cuenta',
    customClass: {
      popup: 'tour-swal-popup',
      confirmButton: 'tour-swal-confirm-btn',
      cancelButton: 'tour-swal-cancel-btn',
      actions: 'tour-swal-actions'
    },
    buttonsStyling: false,
    showCloseButton: true,
    focusConfirm: true,
    width: '520px',
    backdrop: 'rgba(15, 23, 42, 0.72)'
  }).then((result) => {
    if (result.isConfirmed) {
      startGuidedTour(0);
    } else {
      try {
        localStorage.setItem('stocka_guided_tour_seen', 'postponed');
      } catch (e) {
        console.warn(e);
      }
    }
  });
}

// Exponer modal de bienvenida globalmente
window.openTourWelcomeModal = openTourWelcomeModal;

// Comprobación para nuevos usuarios (primera vez)
export function checkFirstTimeTour() {
  try {
    const tourSeen = localStorage.getItem('stocka_guided_tour_seen');
    if (!tourSeen) {
      // Esperar 1.8 segundos a que la interfaz cargue completamente
      setTimeout(() => {
        openTourWelcomeModal();
      }, 1800);
    }
  } catch (err) {
    console.warn('[Tour] Error en checkFirstTimeTour:', err);
  }
}

// Abrir vista de integraciones desde el tour
export function openIntegrationsViewFromTour(platform = 'shopify') {
  const tour = getTourInstance();
  if (tour && tour.active) {
    tour.finish(true);
  }

  const navItem = document.querySelector('a.nav-item[data-view="integrations"]');
  if (navItem) {
    navItem.click();
    setTimeout(() => {
      const tabTarget = platform === 'meli' ? 'tab-meli' : 'tab-shopify';
      const tabBtn = document.querySelector(`.integration-tab[data-tab="${tabTarget}"]`);
      if (tabBtn) {
        tabBtn.click();
        tabBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 450);
  }
}

// Modal interactivo detallado de integraciones (Shopify & Mercado Libre)
export function showIntegrationsDetailModal(initialPlatform = 'shopify') {
  if (!window.Swal) return;

  let currentPlat = initialPlatform;

  const buildHtml = (plat) => {
    const isShopify = plat === 'shopify';
    return `
      <div style="text-align: left; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;">
        <!-- Selector superior de plataforma -->
        <div style="display: flex; gap: 0.5rem; margin-bottom: 1.25rem; background: var(--color-bg, #f1f5f9); padding: 4px; border-radius: 10px; border: 1px solid var(--color-border, #cbd5e1);">
          <button type="button" id="swal-tab-shopify" style="flex: 1; padding: 0.55rem 1rem; border-radius: 8px; font-weight: 700; font-size: 0.85rem; border: none; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; transition: all 0.2s; ${isShopify ? 'background: var(--color-surface, #ffffff); color: var(--color-primary, #2563eb); box-shadow: 0 2px 5px rgba(0,0,0,0.1);' : 'background: transparent; color: var(--color-text-muted, #64748b);'}">
            <i class="ri-shopping-bag-3-line" style="color: #10b981; font-size: 1.1rem;"></i> Integración Shopify
          </button>
          <button type="button" id="swal-tab-meli" style="flex: 1; padding: 0.55rem 1rem; border-radius: 8px; font-weight: 700; font-size: 0.85rem; border: none; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; transition: all 0.2s; ${!isShopify ? 'background: var(--color-surface, #ffffff); color: var(--color-primary, #2563eb); box-shadow: 0 2px 5px rgba(0,0,0,0.1);' : 'background: transparent; color: var(--color-text-muted, #64748b);'}">
            <i class="ri-store-2-line" style="color: #f59e0b; font-size: 1.1rem;"></i> Integración Mercado Libre
          </button>
        </div>

        <!-- Contenedor Shopify -->
        <div id="swal-panel-shopify" style="display: ${isShopify ? 'block' : 'none'};">
          <div style="background: rgba(16, 185, 129, 0.08); border-left: 4px solid #10b981; padding: 0.85rem 1rem; border-radius: 0 8px 8px 0; margin-bottom: 1.25rem;">
            <strong style="color: #065f46; display: flex; align-items: center; gap: 0.35rem; font-size: 0.92rem;">
              <i class="ri-checkbox-circle-fill" style="color: #10b981;"></i> Conexión Directa en 3 Pasos
            </strong>
            <p style="margin: 0.25rem 0 0; font-size: 0.82rem; color: #047857; line-height: 1.45;">
              Sincroniza tus pedidos automáticamente con WMS STOCKA. Cuando empaquetemos tu orden, el estado de envío y el enlace del courier se reflejarán de inmediato en tu panel de Shopify.
            </p>
          </div>

          <div style="display: flex; flex-direction: column; gap: 1rem;">
            <div style="display: flex; gap: 0.85rem; align-items: flex-start;">
              <span style="width: 26px; height: 26px; border-radius: 50%; background: #2563eb; color: #ffffff; font-weight: 700; font-size: 0.82rem; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px;">1</span>
              <div>
                <strong style="font-size: 0.88rem; color: var(--color-text-main);">Escribe la URL de tu Tienda</strong>
                <p style="margin: 0.2rem 0 0; font-size: 0.82rem; color: var(--color-text-muted); line-height: 1.45;">
                  Ingresa tu dominio (ej: <code>mitienda.myshopify.com</code>) y pulsa el botón <strong>Conectar Tienda Shopify</strong>.
                </p>
              </div>
            </div>

            <div style="display: flex; gap: 0.85rem; align-items: flex-start;">
              <span style="width: 26px; height: 26px; border-radius: 50%; background: #2563eb; color: #ffffff; font-weight: 700; font-size: 0.82rem; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px;">2</span>
              <div>
                <strong style="font-size: 0.88rem; color: var(--color-text-main);">Instala la App Oficial de STOCKA</strong>
                <p style="margin: 0.2rem 0 0; font-size: 0.82rem; color: var(--color-text-muted); line-height: 1.45;">
                  Se abrirá tu tienda Shopify. Haz clic en <strong>Instalar aplicación</strong> para otorgar los permisos de sincronización de pedidos y existencias.
                </p>
              </div>
            </div>

            <div style="display: flex; gap: 0.85rem; align-items: flex-start;">
              <span style="width: 26px; height: 26px; border-radius: 50%; background: #2563eb; color: #ffffff; font-weight: 700; font-size: 0.82rem; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px;">3</span>
              <div>
                <strong style="font-size: 0.88rem; color: var(--color-text-main);">PIN de Colaborador (Shopify Partners)</strong>
                <p style="margin: 0.2rem 0 0; font-size: 0.82rem; color: var(--color-text-muted); line-height: 1.45;">
                  En tu Shopify ve a <em>Configuración &gt; Usuarios / Permisos &gt; Seguridad</em>. Copia tu <strong>PIN de 4 dígitos</strong> y guárdalo en el WMS para que nuestro equipo pueda vincular tu cuenta partner.
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- Contenedor MercadoLibre -->
        <div id="swal-panel-meli" style="display: ${!isShopify ? 'block' : 'none'};">
          <div style="background: rgba(245, 158, 11, 0.08); border-left: 4px solid #f59e0b; padding: 0.85rem 1rem; border-radius: 0 8px 8px 0; margin-bottom: 1.25rem;">
            <strong style="color: #92400e; display: flex; align-items: center; gap: 0.35rem; font-size: 0.92rem;">
              <i class="ri-flashlight-fill" style="color: #f59e0b;"></i> Sincronización Flex, Envíos y FULL
            </strong>
            <p style="margin: 0.25rem 0 0; font-size: 0.82rem; color: #b45309; line-height: 1.45;">
              Permite procesar tus ventas con Flex ($3.200 + IVA en 36 comunas de Santiago), MercadoEnvíos oficial con generación de etiquetas de transporte y preparación para Full.
            </p>
          </div>

          <div style="display: flex; flex-direction: column; gap: 1rem;">
            <div style="display: flex; gap: 0.85rem; align-items: flex-start;">
              <span style="width: 26px; height: 26px; border-radius: 50%; background: #f59e0b; color: #ffffff; font-weight: 700; font-size: 0.82rem; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px;">1</span>
              <div>
                <strong style="font-size: 0.88rem; color: var(--color-text-main);">Obtener Código de Autorización</strong>
                <p style="margin: 0.2rem 0 0; font-size: 0.82rem; color: var(--color-text-muted); line-height: 1.45;">
                  En la pestaña de MercadoLibre haz clic en <strong>👉 Obtener Código de Autorización</strong> e inicia sesión con tu cuenta de vendedor.
                </p>
              </div>
            </div>

            <div style="display: flex; gap: 0.85rem; align-items: flex-start;">
              <span style="width: 26px; height: 26px; border-radius: 50%; background: #f59e0b; color: #ffffff; font-weight: 700; font-size: 0.82rem; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px;">2</span>
              <div>
                <strong style="font-size: 0.88rem; color: var(--color-text-main);">Pegar el Código TG Completo</strong>
                <p style="margin: 0.2rem 0 0; font-size: 0.82rem; color: var(--color-text-muted); line-height: 1.45;">
                  Copia el código que aparece tras <code>code=</code> en tu navegador (ej: <code>TG-xxxxxxxxx-xxxxxxxxxx</code>). Pégalo en el WMS y haz clic en <strong>Conectar MercadoLibre API</strong>.
                </p>
              </div>
            </div>

            <div style="display: flex; gap: 0.85rem; align-items: flex-start;">
              <span style="width: 26px; height: 26px; border-radius: 50%; background: #f59e0b; color: #ffffff; font-weight: 700; font-size: 0.82rem; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px;">3</span>
              <div>
                <strong style="font-size: 0.88rem; color: var(--color-text-main);">Invitación a Colaborador</strong>
                <p style="margin: 0.2rem 0 0; font-size: 0.82rem; color: var(--color-text-muted); line-height: 1.45;">
                  En Mercado Libre ve a <em>Colaboradores</em> y envía la invitación al correo que figura en la tarjeta de tu comercio en WMS para imprimir etiquetas al empacar.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  };

  window.Swal.fire({
    title: 'Guía de Integración Ecommerce',
    html: buildHtml(currentPlat),
    width: '560px',
    showCancelButton: true,
    confirmButtonText: '<i class="ri-external-link-line"></i> Ir al Módulo de Integraciones',
    cancelButtonText: 'Cerrar',
    confirmButtonColor: 'var(--color-primary, #2563eb)',
    cancelButtonColor: '#64748b',
    didOpen: () => {
      const modal = window.Swal.getHtmlContainer();
      if (!modal) return;

      const btnShopify = modal.querySelector('#swal-tab-shopify');
      const btnMeli = modal.querySelector('#swal-tab-meli');
      const panelShopify = modal.querySelector('#swal-panel-shopify');
      const panelMeli = modal.querySelector('#swal-panel-meli');

      if (btnShopify && btnMeli) {
        btnShopify.onclick = () => {
          currentPlat = 'shopify';
          panelShopify.style.display = 'block';
          panelMeli.style.display = 'none';
          btnShopify.style.background = 'var(--color-surface, #ffffff)';
          btnShopify.style.color = 'var(--color-primary, #2563eb)';
          btnShopify.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
          btnMeli.style.background = 'transparent';
          btnMeli.style.color = 'var(--color-text-muted, #64748b)';
          btnMeli.style.boxShadow = 'none';
        };

        btnMeli.onclick = () => {
          currentPlat = 'meli';
          panelShopify.style.display = 'none';
          panelMeli.style.display = 'block';
          btnMeli.style.background = 'var(--color-surface, #ffffff)';
          btnMeli.style.color = 'var(--color-primary, #2563eb)';
          btnMeli.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
          btnShopify.style.background = 'transparent';
          btnShopify.style.color = 'var(--color-text-muted, #64748b)';
          btnShopify.style.boxShadow = 'none';
        };
      }
    }
  }).then((res) => {
    if (res.isConfirmed) {
      openIntegrationsViewFromTour(currentPlat);
    }
  });
}

// Exponer globalmente
window.showIntegrationsDetailModal = showIntegrationsDetailModal;
window.openIntegrationsViewFromTour = openIntegrationsViewFromTour;

// Inicializar eventos al cargar el documento
document.addEventListener('DOMContentLoaded', () => {
  const tourHeaderBtn = document.getElementById('guided-tour-btn');
  if (tourHeaderBtn) {
    tourHeaderBtn.addEventListener('click', (e) => {
      e.preventDefault();
      startGuidedTour(0);
    });
  }

  checkFirstTimeTour();
});
