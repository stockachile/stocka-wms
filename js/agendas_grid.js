// js/agendas_grid.js - Módulo de Gestión de Agendas con Grilla Interactiva Estilo Excel para WMS STOCKA

(function() {
  'use strict';

  // ==========================================================================
  // 1. Estado Global de la Grilla de Agendas
  // ==========================================================================
  window.agendasGridState = {
    activeCell: null,           // { rowIndex, colKey, orderId, value }
    dragState: {
      isDragging: false,
      startRowIndex: -1,
      currentEndRowIndex: -1,
      colKey: null,
      sourceValue: null
    },
    columnFilters: {},          // { colKey: Set of allowed string values }
    searchQuery: '',
    filteredOrders: [],
    sortConfig: { colKey: 'fecha_hora', direction: 'desc' },
    isSaving: false
  };

  // Definición de las 11 Columnas requeridas
  const COLUMN_DEFS = [
    { key: 'numero_pedido', label: 'N° Pedido', letter: 'A', width: '130px', editable: false, align: 'left' },
    { key: 'comercio', label: 'Comercio', letter: 'B', width: '140px', editable: false, align: 'left' },
    { key: 'fecha_hora', label: 'Fecha y Hora', letter: 'C', width: '130px', editable: false, align: 'center' },
    { key: 'cliente_direccion', label: 'Cliente y Dirección', letter: 'D', width: '260px', editable: false, align: 'left' },
    { key: 'comuna', label: 'Comuna', letter: 'E', width: '130px', editable: false, align: 'left' },
    { key: 'estado_pago', label: 'Estado Pago Origen', letter: 'F', width: '145px', editable: false, align: 'center' },
    { key: 'valor_total', label: 'Valor Total', letter: 'G', width: '110px', editable: false, align: 'right' },
    { key: 'metodo_envio', label: 'Método de Envío', letter: 'H', width: '160px', editable: false, align: 'left' },
    { key: 'canal_ventas', label: 'Canal de Ventas', letter: 'I', width: '130px', editable: false, align: 'center' },
    { key: 'agenda', label: 'AGENDA', letter: 'J', width: '140px', editable: true, align: 'center', isSpecial: true },
    { key: 'operador', label: 'OPERADOR', letter: 'K', width: '150px', editable: true, align: 'center', isSpecial: true }
  ];

  // ==========================================================================
  // 2. Extracción y Formateo de Datos por Columna
  // ==========================================================================
  function getOrderFieldValue(order, colKey) {
    if (!order) return '';
    switch (colKey) {
      case 'numero_pedido':
        return String(order.external_order_number || order.id || '').trim();

      case 'comercio':
        return String(order.comercio || 'Desconocido').trim();

      case 'fecha_hora': {
        const rawDate = order.fecha_pedido || order.created_at;
        if (!rawDate) return '';
        const d = new Date(rawDate);
        if (isNaN(d.getTime())) return String(rawDate);
        const datePart = d.toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });
        const timePart = d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' });
        return `${datePart} ${timePart}`;
      }

      case 'cliente_direccion': {
        let name = order.customer_name || '';
        if (!name || name === 'No registrado') {
          if (order.raw_shopify_data?.billing_address) {
            const b = order.raw_shopify_data.billing_address;
            name = `${b.first_name || ''} ${b.last_name || ''}`.trim();
          } else if (order.raw_shopify_data?.customer) {
            const c = order.raw_shopify_data.customer;
            name = `${c.first_name || ''} ${c.last_name || ''}`.trim();
          }
        }
        if (!name) name = 'No registrado';

        const address = order.shipping_address || order.address || '';
        const complement = order.shipping_complement || order.address_additional || order.depto || '';
        const fullAddr = [address, complement].filter(Boolean).join(', ');
        return fullAddr ? `${name} - ${fullAddr}` : name;
      }

      case 'comuna':
        return String(order.shipping_city || order.comuna || 'Por definir').trim();

      case 'estado_pago': {
        let rawFin = String(order.raw_shopify_data?.financial_status || order.payment_status || '').toLowerCase().trim();
        const isMarketplace = ['Falabella', 'MercadoLibre', 'Paris', 'Ripley', 'Walmart'].includes(order.external_platform || order.origen);
        if (isMarketplace && order.status !== 'cancelado') {
          if (!['refunded', 'reembolsado', 'partially_refunded', 'parcialmente_reembolsado', 'voided'].includes(rawFin)) {
            rawFin = 'paid';
          }
        }
        if (['paid', 'pagado', 'completed', 'approved'].includes(rawFin)) return 'PAGADO';
        if (['pending', 'pendiente', 'unpaid', 'no pagado'].includes(rawFin)) return 'PENDIENTE';
        if (['partially_refunded', 'parcialmente_reembolsado'].includes(rawFin)) return 'PARCIALMENTE REEMBOLSADO';
        if (['refunded', 'reembolsado'].includes(rawFin)) return 'REEMBOLSADO';
        if (['partially_paid', 'parcialmente_pagado'].includes(rawFin)) return 'PARCIALMENTE PAGADO';
        if (['authorized', 'autorizado'].includes(rawFin)) return 'AUTORIZADO';
        if (['voided', 'anulado', 'cancelado'].includes(rawFin)) return 'ANULADO';
        return rawFin ? rawFin.toUpperCase() : 'PENDIENTE';
      }

      case 'valor_total': {
        const rawVal = order.total_amount || order.total || order.raw_shopify_data?.total_price || 0;
        const num = parseFloat(rawVal) || 0;
        return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(num);
      }

      case 'metodo_envio':
        return String(order.shipping_method || '-').trim();

      case 'canal_ventas':
        return String(order.origen || order.external_platform || 'Manual').trim();

      case 'agenda':
        return String(order.agenda || '').trim().toUpperCase();

      case 'operador':
        return String(order.operador || '').trim().toUpperCase();

      default:
        return '';
    }
  }

  // ==========================================================================
  // 3. Renderizado de Celda HTML
  // ==========================================================================
  function renderCellHtml(order, col, rowIndex) {
    const rawVal = getOrderFieldValue(order, col.key);
    const orderId = order.id;

    if (col.key === 'agenda') {
      const displayVal = rawVal || '-';
      const badgeClass = rawVal ? 'excel-badge-agenda' : '';
      return `
        <div class="excel-cell-content" style="text-align: center;">
          ${rawVal ? `<span class="${badgeClass}">${displayVal}</span>` : `<span style="color: var(--color-text-muted);">-</span>`}
        </div>
      `;
    }

    if (col.key === 'operador') {
      const displayVal = rawVal || '-';
      const badgeClass = rawVal ? 'excel-badge-operador' : '';
      return `
        <div class="excel-cell-content" style="text-align: center;">
          ${rawVal ? `<span class="${badgeClass}">${displayVal}</span>` : `<span style="color: var(--color-text-muted);">-</span>`}
        </div>
      `;
    }

    if (col.key === 'estado_pago') {
      let bg = '#e5e7eb';
      let color = '#374151';
      if (rawVal === 'PAGADO') { bg = '#d1fae5'; color = '#065f46'; }
      else if (rawVal === 'PENDIENTE') { bg = '#fef3c7'; color = '#92400e'; }
      else if (rawVal.includes('REEMBOLSADO')) { bg = '#fee2e2'; color = '#991b1b'; }
      else if (rawVal === 'AUTORIZADO') { bg = '#e0f2fe'; color = '#0369a1'; }

      return `
        <div class="excel-cell-content" style="text-align: center;">
          <span style="background:${bg}; color:${color}; padding: 0.12rem 0.45rem; border-radius: 4px; font-weight: 700; font-size: 0.7rem; letter-spacing: 0.02em;">
            ${rawVal}
          </span>
        </div>
      `;
    }

    if (col.key === 'canal_ventas') {
      const platformLower = (rawVal.toLowerCase() === 'manual' || rawVal.toLowerCase() === 'logística inversa') ? 'stocka.cap' : rawVal.toLowerCase();
      return `
        <div class="excel-cell-content" style="text-align: center; display: flex; align-items: center; justify-content: center; gap: 0.35rem;">
          <img src="./img/${platformLower}.png" alt="${rawVal}" style="height: 18px; max-width: 50px; object-fit: contain;" onerror="this.style.display='none';" />
          <span style="font-size: 0.72rem; font-weight: 600;">${rawVal}</span>
        </div>
      `;
    }

    if (col.key === 'numero_pedido') {
      return `
        <div class="excel-cell-content" style="font-family: monospace; font-weight: 700; color: var(--color-primary);" title="${rawVal}">
          ${rawVal}
        </div>
      `;
    }

    if (col.key === 'valor_total') {
      return `
        <div class="excel-cell-content" style="text-align: right; font-weight: 600; font-family: monospace;">
          ${rawVal}
        </div>
      `;
    }

    return `
      <div class="excel-cell-content" style="text-align: ${col.align};" title="${String(rawVal).replace(/"/g, '&quot;')}">
        ${rawVal}
      </div>
    `;
  }

  // ==========================================================================
  // 4. Filtrado y Ordenamiento de Datos
  // ==========================================================================
  function computeFilteredOrders() {
    const allOrders = window.loadedOrders || [];
    const { searchQuery, columnFilters } = window.agendasGridState;
    const queryNorm = (searchQuery || '').toLowerCase().trim();

    return allOrders.filter(order => {
      // 1. Buscador Global
      if (queryNorm) {
        const idStr = String(order.external_order_number || order.id || '').toLowerCase();
        const clientStr = String(order.customer_name || '').toLowerCase();
        const commStr = String(order.comercio || '').toLowerCase();
        const cityStr = String(order.shipping_city || order.comuna || '').toLowerCase();
        const matchGlobal = idStr.includes(queryNorm) || clientStr.includes(queryNorm) || commStr.includes(queryNorm) || cityStr.includes(queryNorm);
        if (!matchGlobal) return false;
      }

      // 2. Filtros por Columna
      for (const [colKey, allowedSet] of Object.entries(columnFilters)) {
        if (!allowedSet || allowedSet.size === 0) continue;
        const val = getOrderFieldValue(order, colKey);
        if (!allowedSet.has(val)) {
          return false;
        }
      }

      return true;
    });
  }

  // ==========================================================================
  // 5. Renderizado Principal de la Vista
  // ==========================================================================
  window.renderAgendasGrid = function() {
    const container = document.getElementById('subview-agendas-grid');
    if (!container) return;

    window.agendasGridState.filteredOrders = computeFilteredOrders();
    const visibleOrders = window.agendasGridState.filteredOrders;
    const totalLoaded = (window.loadedOrders || []).length;

    // Actualizar badge en la pestaña
    const tabCountBadge = document.getElementById('agendas-tab-count');
    if (tabCountBadge) {
      tabCountBadge.textContent = totalLoaded;
    }

    container.innerHTML = `
      <!-- Barra Superior de Herramientas de Planilla -->
      <div class="agendas-toolbar-card">
        <div class="agendas-toolbar-left">
          <div class="agendas-search-box">
            <i class="ri-search-line"></i>
            <input type="text" id="agendas-search-input" class="agendas-search-input" placeholder="Buscar por N° pedido, cliente, comercio..." value="${window.agendasGridState.searchQuery || ''}" />
            <button type="button" id="agendas-clear-search-btn" class="agendas-clear-search" onclick="window.clearAgendasSearch()"><i class="ri-close-line"></i></button>
          </div>
          <span style="font-size: 0.8rem; font-weight: 600; color: var(--color-text-muted);">
            Mostrando <strong style="color: var(--color-primary);">${visibleOrders.length}</strong> de ${totalLoaded} pedidos
          </span>
          ${hasActiveColumnFilters() ? `
            <button type="button" class="btn btn-outline" onclick="window.clearAllAgendasColumnFilters()" style="padding: 0.25rem 0.6rem; font-size: 0.75rem; color: #ef4444; border-color: #fca5a5; display: inline-flex; align-items: center; gap: 0.3rem;">
              <i class="ri-filter-off-line"></i> Limpiar filtros
            </button>
          ` : ''}
        </div>

        <div class="agendas-toolbar-right">
          <!-- Indicador de Guardado -->
          <div id="agendas-save-indicator" class="agendas-save-status">
            <i class="ri-check-double-line"></i>
            <span>Todos los cambios guardados</span>
          </div>

          <!-- Botón Gestionar Opciones (Agenda y Operador) -->
          <button type="button" class="btn btn-outline" onclick="window.manageWmsConfigOptions()" style="padding: 0.35rem 0.7rem; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 0.3rem;" title="Gestionar catálogo de opciones">
            <i class="ri-settings-3-line"></i> Opciones
          </button>

          <!-- Botón Exportar a Excel -->
          <button type="button" class="btn btn-outline" onclick="window.exportAgendasToExcel()" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; border-color: #10b981; color: #059669; background: rgba(16, 185, 129, 0.05); display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 600;" title="Descargar como archivo Excel">
            <i class="ri-file-excel-2-line" style="font-size: 1rem;"></i> Exportar Excel
          </button>

          <!-- Botón Refrescar -->
          <button type="button" class="btn btn-primary" onclick="window.refreshAgendasGrid()" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 600;" title="Actualizar datos con Torre de Control">
            <i class="ri-refresh-line"></i> Sincronizar
          </button>
        </div>
      </div>

      <!-- Grilla Excel Principal -->
      <div class="agendas-grid-wrapper">
        <div class="agendas-grid-scroll-area" id="agendas-scroll-container">
          <table class="agendas-excel-table" id="agendas-excel-table">
            <thead>
              <tr>
                <th class="th-row-index">#</th>
                ${COLUMN_DEFS.map(col => {
                  const isFiltered = window.agendasGridState.columnFilters[col.key]?.size > 0;
                  return `
                    <th style="width: ${col.width}; min-width: ${col.width}; text-align: ${col.align};" data-col-key="${col.key}">
                      <div class="th-content">
                        <span><span class="th-col-letter">${col.letter}</span>${col.label}</span>
                        <button type="button" class="th-filter-btn ${isFiltered ? 'filter-active' : ''}" onclick="window.openAgendasColFilter(event, '${col.key}', '${col.label}')" title="Filtrar ${col.label}">
                          <i class="ri-filter-3-line"></i>
                        </button>
                      </div>
                    </th>
                  `;
                }).join('')}
              </tr>
            </thead>
            <tbody id="agendas-grid-tbody">
              ${renderTableRowsHtml(visibleOrders)}
            </tbody>
          </table>
        </div>

        <!-- Barra Inferior de Atajos y Ayuda -->
        <div class="agendas-footer-bar">
          <div class="agendas-shortcuts-tip">
            <span><i class="ri-keyboard-line"></i> <strong>Atajos Excel:</strong></span>
            <span><kbd>Ctrl+C</kbd> Copiar celda</span>
            <span><kbd>Ctrl+V</kbd> Pegar</span>
            <span><kbd>Arrastrar esquina</kbd> Copiar en serie hacia abajo</span>
            <span><kbd>Enter</kbd> / <kbd>Tab</kbd> Navegar</span>
          </div>
          <div>
            <span style="font-weight: 600; color: var(--color-primary);"><i class="ri-links-line"></i> Sincronizado en tiempo real con Torre de Control</span>
          </div>
        </div>
      </div>
    `;

    // Vincular buscador
    const searchInput = document.getElementById('agendas-search-input');
    const clearSearchBtn = document.getElementById('agendas-clear-search-btn');
    if (searchInput) {
      if (searchInput.value) clearSearchBtn.style.display = 'flex';
      searchInput.addEventListener('input', (e) => {
        window.agendasGridState.searchQuery = e.target.value;
        clearSearchBtn.style.display = e.target.value ? 'flex' : 'none';
        refreshTableBodyOnly();
      });
    }

    // Inicializar manejadores de celdas
    attachGridCellEvents();
  };

  function renderTableRowsHtml(orders) {
    if (!orders || orders.length === 0) {
      return `
        <tr>
          <td colspan="12" style="text-align: center; padding: 4rem; color: var(--color-text-muted);">
            <div style="display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
              <i class="ri-inbox-line" style="font-size: 2.2rem; opacity: 0.5;"></i>
              <span style="font-weight: 600; font-size: 0.95rem;">No hay pedidos con los filtros aplicados</span>
              <button class="btn btn-outline" onclick="window.clearAllAgendasColumnFilters()" style="margin-top: 0.5rem; font-size: 0.8rem;">Restablecer filtros</button>
            </div>
          </td>
        </tr>
      `;
    }

    return orders.map((order, index) => {
      const rowNum = index + 1;
      return `
        <tr data-row-index="${index}" data-order-id="${order.id}">
          <td class="excel-cell-row-index">${rowNum}</td>
          ${COLUMN_DEFS.map(col => {
            const isEditable = col.editable;
            return `
              <td class="excel-cell ${isEditable ? 'excel-cell-editable' : ''}" 
                  data-row-index="${index}" 
                  data-col-key="${col.key}" 
                  data-order-id="${order.id}" 
                  tabindex="0">
                ${renderCellHtml(order, col, index)}
              </td>
            `;
          }).join('')}
        </tr>
      `;
    }).join('');
  }

  function refreshTableBodyOnly() {
    window.agendasGridState.filteredOrders = computeFilteredOrders();
    const visibleOrders = window.agendasGridState.filteredOrders;
    const tbody = document.getElementById('agendas-grid-tbody');
    if (tbody) {
      tbody.innerHTML = renderTableRowsHtml(visibleOrders);
      attachGridCellEvents();
    }
  }

  function hasActiveColumnFilters() {
    return Object.values(window.agendasGridState.columnFilters).some(set => set && set.size > 0);
  }

  window.clearAgendasSearch = function() {
    const searchInput = document.getElementById('agendas-search-input');
    if (searchInput) searchInput.value = '';
    window.agendasGridState.searchQuery = '';
    document.getElementById('agendas-clear-search-btn').style.display = 'none';
    refreshTableBodyOnly();
  };

  window.clearAllAgendasColumnFilters = function() {
    window.agendasGridState.columnFilters = {};
    window.agendasGridState.searchQuery = '';
    window.renderAgendasGrid();
  };

  // ==========================================================================
  // 6. Manejo de Selección de Celda y Fill Handle (Arrastre en Serie)
  // ==========================================================================
  function setActiveCell(cellElement) {
    if (!cellElement) return;

    // Remover celda activa anterior
    const prevActive = document.querySelector('.excel-cell-active');
    if (prevActive) {
      prevActive.classList.remove('excel-cell-active');
      const oldHandle = prevActive.querySelector('.excel-fill-handle');
      if (oldHandle) oldHandle.remove();
    }

    // Activar nueva celda
    cellElement.classList.add('excel-cell-active');
    const rowIndex = parseInt(cellElement.getAttribute('data-row-index'), 10);
    const colKey = cellElement.getAttribute('data-col-key');
    const orderId = cellElement.getAttribute('data-order-id');
    const order = window.agendasGridState.filteredOrders[rowIndex];
    const val = order ? getOrderFieldValue(order, colKey) : '';

    window.agendasGridState.activeCell = {
      element: cellElement,
      rowIndex,
      colKey,
      orderId,
      value: val
    };

    // Añadir manejador de arrastre (Fill Handle) si es columna editable
    const colDef = COLUMN_DEFS.find(c => c.key === colKey);
    if (colDef && colDef.editable) {
      const handle = document.createElement('div');
      handle.className = 'excel-fill-handle';
      handle.title = 'Arrastra hacia abajo para copiar en serie';
      handle.addEventListener('mousedown', initFillDrag);
      cellElement.appendChild(handle);
    }
  }

  function attachGridCellEvents() {
    const cells = document.querySelectorAll('.agendas-excel-table tbody .excel-cell');
    cells.forEach(cell => {
      cell.addEventListener('click', (e) => {
        // Evitar reiniciar si se hace click en el fill handle
        if (e.target.classList.contains('excel-fill-handle')) return;
        setActiveCell(cell);
      });

      // Doble clic para abrir selector en celda editable
      cell.addEventListener('dblclick', () => {
        const colKey = cell.getAttribute('data-col-key');
        if (colKey === 'agenda' || colKey === 'operador') {
          openCellInlineEditor(cell);
        }
      });
    });
  }

  // ==========================================================================
  // 7. Motor de Arrastre en Serie (Fill Handle)
  // ==========================================================================
  function initFillDrag(e) {
    e.preventDefault();
    e.stopPropagation();

    const active = window.agendasGridState.activeCell;
    if (!active) return;

    window.agendasGridState.dragState = {
      isDragging: true,
      startRowIndex: active.rowIndex,
      currentEndRowIndex: active.rowIndex,
      colKey: active.colKey,
      sourceValue: active.value
    };

    document.addEventListener('mousemove', onFillDragMove);
    document.addEventListener('mouseup', onFillDragEnd);
  }

  function onFillDragMove(e) {
    const dragState = window.agendasGridState.dragState;
    if (!dragState.isDragging) return;

    // Buscar celda bajo el cursor
    const elementUnderCursor = document.elementFromPoint(e.clientX, e.clientY);
    const targetCell = elementUnderCursor ? elementUnderCursor.closest('.excel-cell') : null;
    if (!targetCell) return;

    const targetRowIndex = parseInt(targetCell.getAttribute('data-row-index'), 10);
    const targetColKey = targetCell.getAttribute('data-col-key');

    // Solo permitir arrastrar verticalmente en la misma columna y hacia abajo
    if (targetColKey !== dragState.colKey || isNaN(targetRowIndex)) return;
    if (targetRowIndex < dragState.startRowIndex) return;

    dragState.currentEndRowIndex = targetRowIndex;
    highlightDragRange(dragState.startRowIndex, targetRowIndex, dragState.colKey);
  }

  function highlightDragRange(startRow, endRow, colKey) {
    // Limpiar highlights previos
    document.querySelectorAll('.excel-cell-in-drag').forEach(el => {
      el.classList.remove('excel-cell-in-drag', 'excel-cell-in-drag-last');
    });

    const tbody = document.getElementById('agendas-grid-tbody');
    if (!tbody) return;

    for (let r = startRow + 1; r <= endRow; r++) {
      const cell = tbody.querySelector(`.excel-cell[data-row-index="${r}"][data-col-key="${colKey}"]`);
      if (cell) {
        cell.classList.add('excel-cell-in-drag');
        if (r === endRow) cell.classList.add('excel-cell-in-drag-last');
      }
    }
  }

  async function onFillDragEnd(e) {
    document.removeEventListener('mousemove', onFillDragMove);
    document.removeEventListener('mouseup', onFillDragEnd);

    const dragState = window.agendasGridState.dragState;
    if (!dragState.isDragging) return;
    dragState.isDragging = false;

    // Limpiar clases visuales de arrastre
    document.querySelectorAll('.excel-cell-in-drag').forEach(el => {
      el.classList.remove('excel-cell-in-drag', 'excel-cell-in-drag-last');
    });

    const { startRowIndex, currentEndRowIndex, colKey, sourceValue } = dragState;
    if (currentEndRowIndex <= startRowIndex) return;

    const visibleOrders = window.agendasGridState.filteredOrders;
    const updates = [];

    for (let r = startRowIndex + 1; r <= currentEndRowIndex; r++) {
      const order = visibleOrders[r];
      if (order) {
        updates.push({
          orderId: order.id,
          field: colKey,
          value: sourceValue
        });
      }
    }

    if (updates.length > 0) {
      await window.batchUpdateAgendasOrders(updates);
    }
  }

  // ==========================================================================
  // 8. Editor En Línea para AGENDA y OPERADOR
  // ==========================================================================
  function openCellInlineEditor(cellElement) {
    const colKey = cellElement.getAttribute('data-col-key');
    const orderId = cellElement.getAttribute('data-order-id');
    const rowIndex = parseInt(cellElement.getAttribute('data-row-index'), 10);
    const order = window.agendasGridState.filteredOrders[rowIndex];
    if (!order) return;

    const currentValue = getOrderFieldValue(order, colKey);
    const options = colKey === 'agenda' ? (window.agendaOptions || []) : (window.operadorOptions || []);

    cellElement.classList.add('editing');
    cellElement.innerHTML = `
      <select class="excel-select-editor" id="active-inline-select">
        <option value="">(Vacío)</option>
        ${options.map(opt => `<option value="${opt}" ${opt === currentValue ? 'selected' : ''}>${opt}</option>`).join('')}
      </select>
    `;

    const selectEl = cellElement.querySelector('select');
    if (selectEl) {
      selectEl.focus();
      
      const commitChange = async () => {
        const newVal = selectEl.value;
        cellElement.classList.remove('editing');
        await window.batchUpdateAgendasOrders([{
          orderId,
          field: colKey,
          value: newVal
        }]);
      };

      selectEl.addEventListener('change', commitChange);
      selectEl.addEventListener('blur', () => {
        cellElement.classList.remove('editing');
        const colDef = COLUMN_DEFS.find(c => c.key === colKey);
        cellElement.innerHTML = renderCellHtml(order, colDef, rowIndex);
        setActiveCell(cellElement);
      });
      selectEl.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          cellElement.classList.remove('editing');
          const colDef = COLUMN_DEFS.find(c => c.key === colKey);
          cellElement.innerHTML = renderCellHtml(order, colDef, rowIndex);
          setActiveCell(cellElement);
        } else if (e.key === 'Enter') {
          selectEl.blur();
        }
      });
    }
  }

  // ==========================================================================
  // 9. Motor de Copiar y Pegar (Clipboard Engine)
  // ==========================================================================
  async function handleGridCopy(e) {
    const active = window.agendasGridState.activeCell;
    if (!active) return;

    // Solo interceptar si el foco no está en un input de texto
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

    e.preventDefault();
    try {
      await navigator.clipboard.writeText(active.value || '');
      const toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 1200
      });
      toast.fire({
        icon: 'info',
        title: `Copiado: "${active.value || '(vacío)'}"`
      });
    } catch (err) {
      console.warn('Error al copiar al portapapeles:', err);
    }
  }

  async function handleGridPaste(e) {
    const active = window.agendasGridState.activeCell;
    if (!active) return;
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

    // Solo permitir pegar en columnas editables (agenda u operador)
    if (active.colKey !== 'agenda' && active.colKey !== 'operador') {
      const toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 1800
      });
      toast.fire({
        icon: 'warning',
        title: 'Solo se puede pegar en AGENDA u OPERADOR'
      });
      return;
    }

    e.preventDefault();
    let pasteText = '';
    if (e.clipboardData) {
      pasteText = e.clipboardData.getData('text');
    } else if (navigator.clipboard) {
      pasteText = await navigator.clipboard.readText();
    }

    if (!pasteText) return;

    // Separar por líneas (permite copiar de Excel externo o Google Sheets)
    const lines = pasteText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return;

    const visibleOrders = window.agendasGridState.filteredOrders;
    const updates = [];

    lines.forEach((lineVal, offset) => {
      const targetRow = active.rowIndex + offset;
      if (targetRow < visibleOrders.length) {
        const order = visibleOrders[targetRow];
        // Extraer primera celda si venía tab-delimited
        const cellVal = lineVal.split('\t')[0].trim().toUpperCase();
        updates.push({
          orderId: order.id,
          field: active.colKey,
          value: cellVal
        });
      }
    });

    if (updates.length > 0) {
      await window.batchUpdateAgendasOrders(updates);
    }
  }

  // ==========================================================================
  // 10. Persistencia en Base de Datos y Sincronización
  // ==========================================================================
  window.batchUpdateAgendasOrders = async function(updates) {
    if (!updates || updates.length === 0) return;

    const saveIndicator = document.getElementById('agendas-save-indicator');
    if (saveIndicator) {
      saveIndicator.className = 'agendas-save-status saving';
      saveIndicator.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> <span>Guardando ${updates.length} cambio(s)...</span>`;
    }

    try {
      // 1. Agrupar por par (campo, valor) para hacer consultas masivas con `.in('id', ids)`
      const groups = new Map();
      updates.forEach(u => {
        const key = `${u.field}:::${u.value}`;
        if (!groups.has(key)) {
          groups.set(key, { field: u.field, value: u.value, ids: [] });
        }
        groups.get(key).ids.push(u.orderId);
      });

      // 2. Ejecutar updates agrupados en Supabase
      const promises = [];
      for (const grp of groups.values()) {
        const payload = {};
        payload[grp.field] = grp.value || null;

        promises.push(
          supabase
            .from('orders')
            .update(payload)
            .in('id', grp.ids)
        );
      }

      await Promise.all(promises);

      // 3. Sincronizar en memoria en `window.loadedOrders`
      const updatesMap = new Map();
      updates.forEach(u => {
        if (!updatesMap.has(u.orderId)) updatesMap.set(u.orderId, {});
        updatesMap.get(u.orderId)[u.field] = u.value;
      });

      (window.loadedOrders || []).forEach(o => {
        if (updatesMap.has(o.id)) {
          Object.assign(o, updatesMap.get(o.id));
          // Propagar al picker si está en preparación
          if (o.estado_wms === 'En preparación' && typeof window.propagateOrderUpdateToPicker === 'function') {
            window.propagateOrderUpdateToPicker(o).catch(err => console.warn('Picker prop error:', err));
          }
        }
      });

      // 4. Actualizar celdas en la grilla visualmente
      updates.forEach(u => {
        const cell = document.querySelector(`.excel-cell[data-order-id="${u.orderId}"][data-col-key="${u.field}"]`);
        if (cell) {
          const colDef = COLUMN_DEFS.find(c => c.key === u.field);
          const order = (window.loadedOrders || []).find(o => o.id === u.orderId);
          if (order && colDef) {
            cell.innerHTML = renderCellHtml(order, colDef, parseInt(cell.getAttribute('data-row-index'), 10));
          }
        }
      });

      // 5. Restablecer indicador
      if (saveIndicator) {
        saveIndicator.className = 'agendas-save-status';
        saveIndicator.innerHTML = `<i class="ri-check-double-line"></i> <span>Todos los cambios guardados (${updates.length} actualizados)</span>`;
      }

      // Notificación toast amigable
      const toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 2000,
        timerProgressBar: true
      });
      toast.fire({
        icon: 'success',
        title: updates.length === 1 ? 'Campo actualizado' : `${updates.length} pedidos actualizados en serie`
      });

    } catch (err) {
      console.error('Error al guardar cambios de agendas en lote:', err);
      if (saveIndicator) {
        saveIndicator.className = 'agendas-save-status saving';
        saveIndicator.innerHTML = `<i class="ri-error-warning-line" style="color: #ef4444;"></i> <span style="color: #ef4444;">Error al guardar</span>`;
      }
      Swal.fire('Error', 'No se pudieron guardar los cambios: ' + err.message, 'error');
    }
  };

  // ==========================================================================
  // 11. Motor de Filtros por Columna Estilo Excel
  // ==========================================================================
  window.openAgendasColFilter = function(event, colKey, colLabel) {
    event.stopPropagation();

    // Cerrar cualquier popover existente
    const existing = document.getElementById('agendas-col-popover');
    if (existing) existing.remove();

    const allOrders = window.loadedOrders || [];
    const valueCounts = new Map();

    allOrders.forEach(o => {
      const val = getOrderFieldValue(o, colKey);
      valueCounts.set(val, (valueCounts.get(val) || 0) + 1);
    });

    const activeSet = window.agendasGridState.columnFilters[colKey] || null;

    const sortedValues = Array.from(valueCounts.keys()).sort((a, b) => {
      if (a === '') return -1;
      if (b === '') return 1;
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });

    const popover = document.createElement('div');
    popover.id = 'agendas-col-popover';
    popover.className = 'agendas-col-popover';

    // Posicionamiento inteligente bajo el botón
    const triggerRect = event.currentTarget.getBoundingClientRect();
    popover.style.top = `${triggerRect.bottom + 6}px`;
    popover.style.left = `${Math.max(10, Math.min(window.innerWidth - 340, triggerRect.left - 120))}px`;

    const itemsHtml = sortedValues.map(val => {
      const count = valueCounts.get(val) || 0;
      const displayVal = val === '' ? '(Vacío)' : val;
      const isChecked = !activeSet || activeSet.has(val);
      const safeVal = val.replace(/"/g, '&quot;');
      const safeText = `${displayVal} ${val}`.toLowerCase();

      return `
        <label class="popover-item" data-text="${safeText}">
          <div style="display: flex; align-items: center; gap: 0.45rem; min-width: 0; flex: 1;">
            <input type="checkbox" class="agendas-filter-cb" data-value="${safeVal}" ${isChecked ? 'checked' : ''} style="width: 14px; height: 14px; accent-color: var(--color-primary); cursor: pointer;" />
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${displayVal}">${displayVal}</span>
          </div>
          <span style="font-size: 0.68rem; color: var(--color-text-muted); background: rgba(0,0,0,0.05); padding: 0.05rem 0.35rem; border-radius: 99px; font-weight: 600;">${count}</span>
        </label>
      `;
    }).join('');

    popover.innerHTML = `
      <div class="popover-header">
        <span>Filtrar ${colLabel}</span>
        <i class="ri-close-line" onclick="document.getElementById('agendas-col-popover').remove()"></i>
      </div>
      <div class="popover-search-container">
        <i class="ri-search-line"></i>
        <input type="text" id="agendas-popover-search" class="popover-search-input" placeholder="Buscar valores..." autocomplete="off" />
      </div>
      <div class="popover-actions">
        <div style="display: flex; gap: 0.35rem;">
          <button type="button" class="popover-quick-btn" onclick="window.setAllAgendasFilterCbs(true)">Todos</button>
          <button type="button" class="popover-quick-btn" onclick="window.setAllAgendasFilterCbs(false)">Ninguno</button>
        </div>
        <span id="agendas-popover-counter" style="font-size: 0.7rem; color: var(--color-text-muted); font-weight: 600;">${sortedValues.length} valores</span>
      </div>
      <div class="popover-list" id="agendas-popover-list">
        ${itemsHtml}
      </div>
      <div class="popover-footer">
        <button type="button" class="btn btn-outline" style="padding: 0.25rem 0.55rem; font-size: 0.75rem;" onclick="window.clearSingleColFilter('${colKey}')">Limpiar</button>
        <button type="button" class="btn btn-primary" style="padding: 0.25rem 0.75rem; font-size: 0.75rem; color: white;" onclick="window.applyAgendasColFilter('${colKey}')">Aplicar</button>
      </div>
    `;

    document.body.appendChild(popover);

    // Auto-focus buscador
    const searchInput = document.getElementById('agendas-popover-search');
    if (searchInput) {
      setTimeout(() => searchInput.focus(), 40);
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        const items = popover.querySelectorAll('.popover-item');
        let matches = 0;
        items.forEach(it => {
          const text = it.getAttribute('data-text') || '';
          if (!query || text.includes(query)) {
            it.style.display = 'flex';
            matches++;
          } else {
            it.style.display = 'none';
          }
        });
        document.getElementById('agendas-popover-counter').textContent = `${matches} coincidencias`;
      });
    }

    // Cerrar al hacer clic fuera
    setTimeout(() => {
      const clickOutsideHandler = (e) => {
        if (!popover.contains(e.target) && e.target !== event.currentTarget) {
          popover.remove();
          document.removeEventListener('click', clickOutsideHandler);
        }
      };
      document.addEventListener('click', clickOutsideHandler);
    }, 0);
  };

  window.setAllAgendasFilterCbs = function(checked) {
    const popover = document.getElementById('agendas-col-popover');
    if (!popover) return;
    popover.querySelectorAll('.popover-item').forEach(it => {
      if (it.style.display !== 'none') {
        const cb = it.querySelector('.agendas-filter-cb');
        if (cb) cb.checked = checked;
      }
    });
  };

  window.applyAgendasColFilter = function(colKey) {
    const popover = document.getElementById('agendas-col-popover');
    if (!popover) return;

    const checkedValues = new Set();
    let totalItems = 0;

    popover.querySelectorAll('.agendas-filter-cb').forEach(cb => {
      totalItems++;
      if (cb.checked) {
        checkedValues.add(cb.getAttribute('data-value'));
      }
    });

    popover.remove();

    // Si todos están marcados, equivale a no tener filtro
    if (checkedValues.size === totalItems) {
      delete window.agendasGridState.columnFilters[colKey];
    } else {
      window.agendasGridState.columnFilters[colKey] = checkedValues;
    }

    window.renderAgendasGrid();
  };

  window.clearSingleColFilter = function(colKey) {
    const popover = document.getElementById('agendas-col-popover');
    if (popover) popover.remove();
    delete window.agendasGridState.columnFilters[colKey];
    window.renderAgendasGrid();
  };

  // ==========================================================================
  // 12. Exportación a Excel (.xlsx) con SheetJS
  // ==========================================================================
  window.exportAgendasToExcel = function() {
    if (typeof XLSX === 'undefined') {
      Swal.fire('Error', 'La biblioteca XLSX no se encuentra disponible.', 'error');
      return;
    }

    const visibleOrders = window.agendasGridState.filteredOrders || [];
    if (visibleOrders.length === 0) {
      Swal.fire('Atención', 'No hay pedidos visibles para exportar.', 'info');
      return;
    }

    const dataToExport = visibleOrders.map((order, i) => {
      const row = { 'N° Fila': i + 1 };
      COLUMN_DEFS.forEach(col => {
        row[col.label] = getOrderFieldValue(order, col.key);
      });
      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Gestion_Agendas');

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `Gestion_Agendas_STOCKA_${dateStr}.xlsx`);
  };

  // ==========================================================================
  // 13. Sincronización Manual
  // ==========================================================================
  window.refreshAgendasGrid = function() {
    window.renderAgendasGrid();
    const toast = Swal.mixin({
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 1500
    });
    toast.fire({
      icon: 'success',
      title: 'Datos sincronizados con éxito'
    });
  };

  // ==========================================================================
  // 14. Eventos Globales de Teclado (Navegación, Copiar, Pegar)
  // ==========================================================================
  document.addEventListener('keydown', (e) => {
    // Si no estamos en la pestaña de agendas, omitir
    const agendasContainer = document.getElementById('subview-agendas-grid');
    if (!agendasContainer || agendasContainer.style.display === 'none') return;

    // Atajo Copiar (Ctrl+C / Cmd+C)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      handleGridCopy(e);
      return;
    }

    // Atajo Pegar (Ctrl+V / Cmd+V)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      handleGridPaste(e);
      return;
    }

    // Navegación con teclado en la grilla
    const active = window.agendasGridState.activeCell;
    if (!active) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

    const visibleOrders = window.agendasGridState.filteredOrders;
    const maxRows = visibleOrders.length;
    const currentColIndex = COLUMN_DEFS.findIndex(c => c.key === active.colKey);

    let nextRow = active.rowIndex;
    let nextCol = currentColIndex;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      nextRow = Math.min(maxRows - 1, active.rowIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      nextRow = Math.max(0, active.rowIndex - 1);
    } else if (e.key === 'ArrowRight' || e.key === 'Tab') {
      e.preventDefault();
      nextCol = (currentColIndex + 1) % COLUMN_DEFS.length;
      if (e.key === 'Tab' && nextCol === 0) {
        nextRow = Math.min(maxRows - 1, active.rowIndex + 1);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      nextCol = Math.max(0, currentColIndex - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (COLUMN_DEFS[currentColIndex]?.editable) {
        openCellInlineEditor(active.element);
      } else {
        nextRow = Math.min(maxRows - 1, active.rowIndex + 1);
      }
    }

    if (nextRow !== active.rowIndex || nextCol !== currentColIndex) {
      const nextColKey = COLUMN_DEFS[nextCol].key;
      const targetCell = document.querySelector(`.excel-cell[data-row-index="${nextRow}"][data-col-key="${nextColKey}"]`);
      if (targetCell) {
        setActiveCell(targetCell);
        targetCell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
  });

})();
