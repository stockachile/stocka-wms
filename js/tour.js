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

    // Event Listeners de botones
    const closeBtn = document.getElementById('tour-btn-close');
    const backBtn = document.getElementById('tour-btn-back');
    const skipBtn = document.getElementById('tour-btn-skip');
    const nextBtn = document.getElementById('tour-btn-next');

    if (closeBtn) closeBtn.onclick = () => this.finish(true);
    if (skipBtn) skipBtn.onclick = () => this.finish(true);
    if (backBtn) backBtn.onclick = () => this.prev();
    if (nextBtn) nextBtn.onclick = () => isLast ? this.finish() : this.next();

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
