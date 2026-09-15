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
    const message = options.message || options.text || '';
    const duration = options.duration !== undefined ? options.duration : (options.timer !== undefined ? options.timer : 7000);
    const actionText = options.actionText || options.confirmButtonText || '';
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

    toast.innerHTML = `
      <div class="stocka-toast-icon-wrap">
        <i class="${iconClass}"></i>
      </div>
      <div class="stocka-toast-content">
        ${title ? `<div class="stocka-toast-title">${escapeHtml(title)}</div>` : ''}
        ${message ? `<div class="stocka-toast-message">${escapeHtml(message)}</div>` : ''}
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

  // Exportar globalmente
  window.showStockaNotification = showStockaNotification;
  window.stockaToast = showStockaNotification;
})();
