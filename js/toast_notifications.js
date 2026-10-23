/**
 * Stocka WMS - Sistema de Notificaciones Flotantes Autónomas (StockaToast)
 * Diseñado para ser 100% no invasivo:
 * - Sin bloqueo de pantalla (pointer-events: none en el contenedor general).
 * - Sin backdrop oscuro ni desenfoque que afecte la visibilidad.
 * - No interfiere ni cierra modales abiertos ni deselecciona elementos.
 * - Soporte avanzado para textos largos con jerarquía limpia, botón de acción y pausa al pasar el cursor.
 */

(function () {
  'use strict';

  const ICONS = {
    success: 'ri-checkbox-circle-fill',
    error: 'ri-error-warning-fill',
    warning: 'ri-alert-fill',
    info: 'ri-information-fill'
  };

  let container = null;

  function getOrCreateContainer() {
    if (!container || !document.body.contains(container)) {
      container = document.getElementById('stocka-toast-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'stocka-toast-container';
        container.className = 'stocka-toast-container';
        container.setAttribute('aria-live', 'polite');
        container.setAttribute('aria-atomic', 'true');
        document.body.appendChild(container);
      }
    }
    return container;
  }

  /**
   * Muestra una notificación flotante en el sector superior derecho.
   *
   * @param {Object} options
   * @param {'success'|'error'|'warning'|'info'} [options.type='info'] Tipo de notificación
   * @param {string} options.title Título de la notificación
   * @param {string} [options.message] Texto o descripción detallada
   * @param {string} [options.text] Alias para message
   * @param {number} [options.duration=7000] Tiempo en ms antes de auto-cerrarse (0 para persistente)
   * @param {string} [options.actionText] Texto para el botón de acción opcional (ej: 'Ver')
   * @param {Function} [options.onAction] Callback al hacer clic en el botón de acción
   * @param {Function} [options.onClick] Callback al hacer clic en cualquier parte de la tarjeta
   * @param {boolean} [options.showClose=true] Mostrar botón de cerrar (✕)
   * @param {boolean} [options.showProgress=true] Mostrar barra de progreso
   * @returns {Object} Instancia con método .close()
   */
  function showStockaNotification(options = {}) {
    // Normalizar opciones
    const type = options.type || options.icon || 'info';
    const title = options.title || '';
    const htmlContent = options.html || '';
    const message = options.message || options.text || '';
    const duration = options.duration !== undefined ? options.duration : (options.timer !== undefined ? options.timer : 7000);
    const actionText = options.actionText || (options.showConfirmButton ? (options.confirmButtonText || '') : '');
    const onAction = options.onAction || options.onConfirm || null;
    const onClick = options.onClick || null;
    const showClose = options.showClose !== false;
    const showProgress = options.showProgress !== false && duration > 0;

    const cont = getOrCreateContainer();

    // Crear elemento toast
    const toast = document.createElement('div');
    toast.className = `stocka-toast stocka-toast-${type}`;
    toast.setAttribute('role', 'alert');

    const iconClass = ICONS[type] || ICONS.info;

    // Estructura interna
    let actionsHtml = '';
    if (actionText) {
      actionsHtml += `<button type="button" class="stocka-toast-action-btn">${escapeHtml(actionText)}</button>`;
    }
    if (showClose) {
      actionsHtml += `
        <button type="button" class="stocka-toast-close-btn" aria-label="Cerrar notificación" title="Cerrar">
          <i class="ri-close-line"></i>
        </button>
      `;
    }

    const bodyMessageHtml = htmlContent
      ? `<div class="stocka-toast-message">${htmlContent}</div>`
      : (message ? `<div class="stocka-toast-message">${escapeHtml(message)}</div>` : '');

    toast.innerHTML = `
      <div class="stocka-toast-icon-wrap">
        <i class="${iconClass}"></i>
      </div>
      <div class="stocka-toast-content">
        ${title ? `<div class="stocka-toast-title">${escapeHtml(title)}</div>` : ''}
        ${bodyMessageHtml}
      </div>
      ${actionsHtml ? `<div class="stocka-toast-actions">${actionsHtml}</div>` : ''}
      ${showProgress ? `<div class="stocka-toast-progress"><div class="stocka-toast-progress-bar"></div></div>` : ''}
    `;

    // Manejo de eventos de interacción
    let isDismissed = false;
    let timeoutId = null;
    let startTime = Date.now();
    let remainingTime = duration;
    let progressBar = toast.querySelector('.stocka-toast-progress-bar');

    function startTimer(ms) {
      if (ms <= 0) return;
      startTime = Date.now();
      if (progressBar) {
        progressBar.style.transition = `width ${ms}ms linear`;
        progressBar.style.width = '0%';
      }
      timeoutId = setTimeout(() => {
        dismiss();
      }, ms);
    }

    function pauseTimer() {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
        const elapsed = Date.now() - startTime;
        remainingTime = Math.max(0, remainingTime - elapsed);
        if (progressBar) {
          const computedWidth = window.getComputedStyle(progressBar).width;
          progressBar.style.transition = 'none';
          progressBar.style.width = computedWidth;
        }
      }
    }

    function resumeTimer() {
      if (remainingTime > 0 && !isDismissed) {
        startTimer(remainingTime);
      }
    }

    function dismiss() {
      if (isDismissed) return;
      isDismissed = true;
      if (timeoutId) clearTimeout(timeoutId);

      toast.classList.add('stocka-toast-closing');

      // Esperar a que concluya la animación de salida
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 260);
    }

    // Pausar y reanudar al posar el cursor
    if (duration > 0) {
      toast.addEventListener('mouseenter', pauseTimer);
      toast.addEventListener('mouseleave', resumeTimer);
      startTimer(duration);
    }

    // Botón de acción
    const actionBtn = toast.querySelector('.stocka-toast-action-btn');
    if (actionBtn) {
      actionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dismiss();
        if (typeof onAction === 'function') {
          try { onAction(); } catch (err) { console.error('[StockaToast action error]:', err); }
        }
      });
    }

    // Botón de cierre
    const closeBtn = toast.querySelector('.stocka-toast-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dismiss();
      });
    }

    // Clic en la tarjeta completa (si está configurado)
    if (typeof onClick === 'function') {
      toast.style.cursor = 'pointer';
      toast.addEventListener('click', (e) => {
        if (e.target.closest('.stocka-toast-action-btn') || e.target.closest('.stocka-toast-close-btn')) return;
        dismiss();
        try { onClick(); } catch (err) { console.error('[StockaToast click error]:', err); }
      });
    }

    // Insertar al inicio para que las nuevas notificaciones aparezcan arriba
    cont.insertBefore(toast, cont.firstChild);

    return {
      close: dismiss,
      element: toast
    };
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return String(str || '');
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Detector global de modales abiertos (SweetAlert2 o modales DOM personalizados)
  function hasAnyOpenModal() {
    try {
      if (typeof window.Swal !== 'undefined' && typeof window.Swal.isVisible === 'function' && window.Swal.isVisible()) {
        return true;
      }
      if (document.querySelector('.swal2-container.swal2-shown, .swal2-popup.swal2-show')) {
        return true;
      }
      if (document.querySelector('.modal-overlay.active, .modal.show, .fullscreen-declaration-overlay.active, .agendas-modal-overlay.active, [id^="modal-"][style*="display: flex"], [id^="modal-"][style*="display: block"], .agendas-modal-overlay[style*="display: flex"]')) {
        return true;
      }
    } catch (_) {}
    return false;
  }

  // Detector global de interacción activa del usuario (modal abierto, input/select en tabla o menú desplegable abierto)
  function isUserBusyWithModalOrInput() {
    if (hasAnyOpenModal()) return true;
    try {
      const activeEl = document.activeElement;
      if (activeEl && activeEl !== document.body) {
        const tag = (activeEl.tagName || '').toUpperCase();
        const isEditable = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || activeEl.isContentEditable;
        if (isEditable && activeEl.closest('#orders-tbody, #agendas-grid-tbody, .modal-overlay, .swal2-popup, .order-details-row')) {
          return true;
        }
      }
      if (document.querySelector('.wms-col-filter-dropdown.open, .table-action-menu-content.show, .multiselect-dropdown.show, .searchable-select-dropdown.open')) {
        return true;
      }
    } catch (_) {}
    return false;
  }

  let pendingRenderTimer = null;

  function schedulePendingRenderFlush() {
    if (pendingRenderTimer) return;
    pendingRenderTimer = setInterval(() => {
      if (!window._pendingWmsRenderAfterModal) {
        clearInterval(pendingRenderTimer);
        pendingRenderTimer = null;
        return;
      }
      if (!isUserBusyWithModalOrInput()) {
        window._pendingWmsRenderAfterModal = false;
        clearInterval(pendingRenderTimer);
        pendingRenderTimer = null;
        if (typeof window.applyWmsFiltersAndRender === 'function') {
          try {
            window.applyWmsFiltersAndRender();
          } catch (e) {
            console.warn('[StockaToast] Error al ejecutar re-render diferido:', e);
          }
        }
      }
    }, 1200);
  }

  // Solicita un re-render de la tabla WMS desde tareas en segundo plano sin interrumpir modales ni inputs activos
  function requestSafeWmsTableRender() {
    if (isUserBusyWithModalOrInput()) {
      window._pendingWmsRenderAfterModal = true;
      schedulePendingRenderFlush();
      return false;
    }
    window._pendingWmsRenderAfterModal = false;
    if (typeof window.applyWmsFiltersAndRender === 'function') {
      window.applyWmsFiltersAndRender();
      return true;
    }
    return false;
  }

  // Interceptor global para SweetAlert2: convierte cualquier llamada con `toast: true`
  // en una notificación flotante autónoma (StockaToast) para que NUNCA cierre un modal Swal.fire abierto.
  function convertSwalToastArgs(baseOpts, arg1, arg2, arg3) {
    const merged = Object.assign({}, baseOpts || {});
    if (typeof arg1 === 'string' || typeof arg1 === 'number') {
      merged.title = String(arg1);
      if (arg2 !== undefined) merged.text = String(arg2);
      if (arg3 !== undefined) merged.icon = String(arg3);
    } else if (arg1 && typeof arg1 === 'object') {
      Object.assign(merged, arg1);
    }
    return merged;
  }

  function fireStockaToastAsSwalPromise(opts) {
    return new Promise((resolve) => {
      let resolved = false;
      const hasConfirmBtn = Boolean(opts.showConfirmButton && (opts.confirmButtonText || opts.actionText));
      const instance = showStockaNotification({
        type: opts.icon || opts.type || 'info',
        title: opts.title || '',
        html: opts.html || '',
        message: opts.text || opts.message || '',
        duration: opts.timer !== undefined ? opts.timer : (opts.duration !== undefined ? opts.duration : 4000),
        actionText: hasConfirmBtn ? (opts.confirmButtonText || opts.actionText) : '',
        showProgress: opts.timerProgressBar !== false,
        onAction: () => {
          if (typeof opts.onAction === 'function') {
            try { opts.onAction(); } catch (e) {}
          }
          if (!resolved) {
            resolved = true;
            resolve({ isConfirmed: true, isDenied: false, isDismissed: false, value: true });
          }
        }
      });

      if (typeof opts.didOpen === 'function' && instance && instance.element) {
        try { opts.didOpen(instance.element); } catch (e) {}
      }

      if (!hasConfirmBtn) {
        resolved = true;
        resolve({ isConfirmed: false, isDenied: false, isDismissed: true, dismiss: 'timer' });
      } else {
        const waitMs = (opts.timer !== undefined ? opts.timer : 7000) + 350;
        if (waitMs > 0) {
          setTimeout(() => {
            if (!resolved) {
              resolved = true;
              resolve({ isConfirmed: false, isDenied: false, isDismissed: true, dismiss: 'timer' });
            }
          }, waitMs);
        }
      }
    });
  }

  function installSwalToastInterceptor() {
    if (!window.Swal || window.Swal._stockaToastPatched) return;

    const origFire = window.Swal.fire.bind(window.Swal);
    const origMixin = typeof window.Swal.mixin === 'function' ? window.Swal.mixin.bind(window.Swal) : null;

    window.Swal.fire = function (arg1, arg2, arg3) {
      if (arg1 && typeof arg1 === 'object' && arg1.toast === true) {
        return fireStockaToastAsSwalPromise(arg1);
      }
      return origFire(arg1, arg2, arg3);
    };

    if (origMixin) {
      window.Swal.mixin = function (mixinOpts = {}) {
        const BaseMixin = origMixin(mixinOpts);
        if (mixinOpts && mixinOpts.toast === true) {
          const origMixinFire = BaseMixin.fire.bind(BaseMixin);
          BaseMixin.fire = function (arg1, arg2, arg3) {
            const merged = convertSwalToastArgs(mixinOpts, arg1, arg2, arg3);
            if (merged.toast === true) {
              return fireStockaToastAsSwalPromise(merged);
            }
            return origMixinFire(arg1, arg2, arg3);
          };
        }
        return BaseMixin;
      };
    }

    window.Swal._stockaToastPatched = true;
  }

  installSwalToastInterceptor();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installSwalToastInterceptor);
  }
  window.addEventListener('load', installSwalToastInterceptor);

  // Exportar globalmente
  window.showStockaNotification = showStockaNotification;
  window.stockaToast = showStockaNotification;
  window.hasAnyOpenModal = hasAnyOpenModal;
  window.isUserBusyWithModalOrInput = isUserBusyWithModalOrInput;
  window.requestSafeWmsTableRender = requestSafeWmsTableRender;
})();
