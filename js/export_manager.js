// js/export_manager.js - Módulo Integral de Exportación Avanzada para STOCKA WMS
// Soporta Excel (.xlsx), PDF Oficial y CSV para los módulos de Inventario y Catálogo (Clientes y Admins)

(function () {
  'use strict';

  // Inyectar estilos visuales para dropdowns, modal y documentos generados
  function injectExportStyles() {
    if (document.getElementById('wms-export-styles')) return;
    const style = document.createElement('style');
    style.id = 'wms-export-styles';
    style.textContent = `
      /* Dropdown de Exportación */
      .wms-export-dropdown {
        position: relative;
        display: inline-block;
      }
      .wms-export-btn {
        height: 38px;
        display: inline-flex;
        align-items: center;
        gap: 0.45rem;
        padding: 0 0.95rem;
        font-size: 0.84rem;
        font-weight: 600;
        border-radius: var(--radius-md, 8px);
        background: linear-gradient(135deg, rgba(37, 99, 235, 0.08) 0%, rgba(94, 23, 235, 0.08) 100%);
        border: 1px solid rgba(37, 99, 235, 0.35);
        color: var(--color-primary, #2563eb);
        cursor: pointer;
        transition: all 0.2s ease;
        user-select: none;
      }
      .wms-export-btn:hover {
        background: linear-gradient(135deg, rgba(37, 99, 235, 0.15) 0%, rgba(94, 23, 235, 0.15) 100%);
        border-color: var(--color-primary, #2563eb);
        transform: translateY(-1px);
        box-shadow: 0 3px 8px rgba(37, 99, 235, 0.18);
      }
      .wms-export-btn i.ri-arrow-down-s-line {
        transition: transform 0.2s ease;
        font-size: 0.95rem;
      }
      .wms-export-dropdown.open .wms-export-btn i.ri-arrow-down-s-line {
        transform: rotate(180deg);
      }

      /* Menú Desplegable */
      .wms-export-menu {
        display: none;
        position: absolute;
        right: 0;
        top: calc(100% + 6px);
        background: var(--color-surface, #ffffff);
        min-width: 260px;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
        border-radius: 10px;
        border: 1px solid var(--color-border, #cbd5e1);
        padding: 0.5rem;
        z-index: 1050;
        animation: wmsExportFadeIn 0.18s ease-out;
      }
      @keyframes wmsExportFadeIn {
        from { opacity: 0; transform: translateY(-6px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .wms-export-dropdown.open .wms-export-menu {
        display: block;
      }
      .wms-export-section-title {
        font-size: 0.72rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-text-muted, #64748b);
        padding: 0.4rem 0.65rem 0.25rem 0.65rem;
        display: flex;
        align-items: center;
        gap: 0.35rem;
      }
      .wms-export-item {
        width: 100%;
        text-align: left;
        padding: 0.45rem 0.65rem;
        border: none;
        background: transparent;
        cursor: pointer;
        border-radius: 6px;
        color: var(--color-text-main, #0f172a);
        font-size: 0.825rem;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 0.55rem;
        transition: all 0.15s ease;
      }
      .wms-export-item:hover {
        background: var(--color-bg, #f1f5f9);
        color: var(--color-primary, #2563eb);
      }
      .wms-export-item i {
        font-size: 1.05rem;
        flex-shrink: 0;
      }
      .wms-export-divider {
        height: 1px;
        background: var(--color-border, #e2e8f0);
        margin: 0.35rem 0;
      }
      .wms-export-item.highlight-custom {
        background: rgba(99, 102, 241, 0.06);
        color: var(--color-primary, #2563eb);
        font-weight: 600;
        border: 1px dashed rgba(99, 102, 241, 0.35);
        margin-top: 0.25rem;
      }
      .wms-export-item.highlight-custom:hover {
        background: rgba(99, 102, 241, 0.12);
      }

      /* Modal de Exportación Personalizada */
      .wms-custom-export-modal {
        display: none;
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(15, 23, 42, 0.55);
        backdrop-filter: blur(4px);
        z-index: 2100;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
      }
      .wms-custom-export-modal.active {
        display: flex;
      }
      .wms-custom-export-dialog {
        background: var(--color-surface, #ffffff);
        border-radius: 14px;
        max-width: 680px;
        width: 100%;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 20px 35px -5px rgba(0, 0, 0, 0.25);
        border: 1px solid var(--color-border, #cbd5e1);
        overflow: hidden;
        animation: wmsExportModalZoom 0.2s ease-out;
      }
      @keyframes wmsExportModalZoom {
        from { opacity: 0; transform: scale(0.96); }
        to { opacity: 1; transform: scale(1); }
      }
      .wms-custom-export-header {
        padding: 1.25rem 1.5rem;
        background: var(--color-surface, #ffffff);
        border-bottom: 1px solid var(--color-border, #cbd5e1);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .wms-custom-export-header h3 {
        margin: 0;
        font-size: 1.15rem;
        font-weight: 700;
        color: var(--color-text-main, #0f172a);
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .wms-custom-export-body {
        padding: 1.5rem;
        overflow-y: auto;
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
      }
      .wms-custom-export-footer {
        padding: 1rem 1.5rem;
        border-top: 1px solid var(--color-border, #cbd5e1);
        background: var(--color-bg, #f8fafc);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .wms-format-cards {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.75rem;
      }
      .wms-format-card {
        border: 2px solid var(--color-border, #cbd5e1);
        border-radius: 10px;
        padding: 0.85rem 0.75rem;
        text-align: center;
        cursor: pointer;
        transition: all 0.2s ease;
        background: var(--color-surface, #ffffff);
      }
      .wms-format-card:hover {
        border-color: var(--color-primary, #2563eb);
        background: rgba(37, 99, 235, 0.03);
      }
      .wms-format-card.selected {
        border-color: var(--color-primary, #2563eb);
        background: rgba(37, 99, 235, 0.08);
        box-shadow: 0 0 0 1px var(--color-primary, #2563eb);
      }
      .wms-format-card i {
        font-size: 1.6rem;
        display: block;
        margin-bottom: 0.35rem;
      }
      .wms-format-card .format-title {
        font-weight: 700;
        font-size: 0.9rem;
        color: var(--color-text-main, #0f172a);
      }
      .wms-format-card .format-desc {
        font-size: 0.75rem;
        color: var(--color-text-muted, #64748b);
        margin-top: 0.15rem;
      }

      /* Chips de selección de columnas */
      .wms-columns-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 0.5rem;
        max-height: 240px;
        overflow-y: auto;
        padding: 0.65rem;
        background: var(--color-bg, #f8fafc);
        border: 1px solid var(--color-border, #e2e8f0);
        border-radius: 8px;
      }
      .wms-column-checkbox-label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.4rem 0.55rem;
        background: var(--color-surface, #ffffff);
        border: 1px solid var(--color-border, #e2e8f0);
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.82rem;
        font-weight: 500;
        color: var(--color-text-main, #1e293b);
        user-select: none;
        transition: background 0.15s ease;
      }
      .wms-column-checkbox-label:hover {
        border-color: var(--color-primary, #2563eb);
      }
      .wms-column-checkbox-label input[type="checkbox"] {
        accent-color: var(--color-primary, #2563eb);
        width: 15px;
        height: 15px;
        cursor: pointer;
      }

      /* Opciones de alcance (Scope) */
      .wms-scope-options {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
      }
      .wms-scope-label {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        cursor: pointer;
        font-size: 0.84rem;
        font-weight: 500;
        color: var(--color-text-main, #1e293b);
        padding: 0.35rem 0.65rem;
        border-radius: 6px;
        border: 1px solid var(--color-border, #cbd5e1);
        background: var(--color-surface, #ffffff);
        transition: all 0.15s ease;
      }
      .wms-scope-label:hover {
        border-color: var(--color-primary, #2563eb);
      }
      .wms-scope-label input[type="radio"] {
        accent-color: var(--color-primary, #2563eb);
      }
    `;
    document.head.appendChild(style);
  }

  // Esquema de Campos de Inventario
  const INVENTORY_SCHEMA = {
    title: 'Inventario de Stock',
    filenamePrefix: 'inventario_stocka',
    fields: [
      { id: 'sku', label: 'SKU', defaultSimple: true, defaultFull: true },
      { id: 'name', label: 'Producto', defaultSimple: true, defaultFull: true },
      { id: 'barcode', label: 'Código de Barras', defaultSimple: false, defaultFull: true },
      { id: 'warehouse', label: 'Bodega', defaultSimple: true, defaultFull: true },
      { id: 'shelfPhysical', label: 'En Estante (Físico libre)', defaultSimple: false, defaultFull: true },
      { id: 'reserved', label: 'En Mesa (Reservado picking)', defaultSimple: false, defaultFull: true },
      { id: 'committed', label: 'Comprometido (Pedidos)', defaultSimple: true, defaultFull: true },
      { id: 'pending', label: 'Pendiente de Ingreso', defaultSimple: false, defaultFull: true },
      { id: 'available', label: 'Disp. en Bodega', defaultSimple: true, defaultFull: true },
      { id: 'totalAvailable', label: 'Disp. Total Multitienda', defaultSimple: true, defaultFull: true },
      { id: 'physical', label: 'Físico Total Bodega', defaultSimple: true, defaultFull: true },
      { id: 'stock_critico', label: 'Stock Crítico', defaultSimple: false, defaultFull: true },
      { id: 'status', label: 'Estado de Stock', defaultSimple: true, defaultFull: true },
      { id: 'product_type', label: 'Tipo de Producto', defaultSimple: false, defaultFull: true },
      { id: 'comercio', label: 'Comercio', defaultSimple: false, defaultFull: true }
    ],
    // Normalizador de fila
    normalizeRow: (r, commerce = '') => {
      const phys = Number(r.physical || 0);
      const res = Number(r.reserved || 0);
      const shelf = r.shelfPhysical !== undefined ? Number(r.shelfPhysical) : Math.max(0, phys - res);
      const comm = Number(r.committed || 0);
      const pend = Number(r.pending || 0);
      const avail = r.available !== undefined ? Number(r.available) : (phys - comm - res);
      const totAvail = r.totalAvailable !== undefined ? Number(r.totalAvailable) : avail;
      const crit = Number(r.stock_critico || 0);
      const status = r.status || (totAvail <= 0 ? 'Agotado' : (totAvail <= crit ? 'Bajo Stock' : 'En Stock'));
      const pType = r.product_type || (r.is_virtual ? 'Virtual' : (r.is_pack ? 'Pack' : 'Físico'));
      const wh = r.warehouse || (r.warehouses?.name) || 'Todas las bodegas';

      return {
        sku: String(r.sku || '').trim(),
        name: String(r.name || '').trim(),
        barcode: String(r.barcode || r.codigo_barra || '-').trim(),
        warehouse: wh,
        shelfPhysical: shelf,
        reserved: res,
        committed: comm,
        pending: pend,
        available: avail,
        totalAvailable: totAvail,
        physical: phys,
        stock_critico: crit,
        status: status,
        product_type: pType,
        comercio: String(r.comercio || commerce || '').trim()
      };
    }
  };

  // Esquema de Campos de Catálogo
  const CATALOG_SCHEMA = {
    title: 'Catálogo Maestro de Productos',
    filenamePrefix: 'catalogo_stocka',
    fields: [
      { id: 'sku', label: 'SKU', defaultSimple: true, defaultFull: true },
      { id: 'name', label: 'Nombre del Producto', defaultSimple: true, defaultFull: true },
      { id: 'description', label: 'Descripción', defaultSimple: false, defaultFull: true },
      { id: 'alias', label: 'Alias (Picker)', defaultSimple: false, defaultFull: true },
      { id: 'barcode', label: 'Cód. Barras Tienda', defaultSimple: true, defaultFull: true },
      { id: 'barcode_wms', label: 'Cód. Barras WMS', defaultSimple: false, defaultFull: true },
      { id: 'price', label: 'Precio ($ CLP)', defaultSimple: true, defaultFull: true },
      { id: 'initial_stock', label: 'Stock Inicial', defaultSimple: false, defaultFull: true },
      { id: 'current_stock', label: 'Stock Físico Actual', defaultSimple: true, defaultFull: true },
      { id: 'status', label: 'Estado', defaultSimple: true, defaultFull: true },
      { id: 'product_type', label: 'Tipo (Físico / Pack / Online)', defaultSimple: true, defaultFull: true },
      { id: 'dimensions', label: 'Medidas (L x An x Al cm)', defaultSimple: false, defaultFull: true },
      { id: 'volumen', label: 'Volumen (m³)', defaultSimple: false, defaultFull: true },
      { id: 'weight', label: 'Peso (kg)', defaultSimple: false, defaultFull: true },
      { id: 'expiration_date', label: 'Fecha Vencimiento', defaultSimple: false, defaultFull: true },
      { id: 'lot_number', label: 'Número de Lote', defaultSimple: false, defaultFull: true },
      { id: 'variants', label: 'Variantes', defaultSimple: false, defaultFull: true },
      { id: 'origin', label: 'Origen / Integración', defaultSimple: true, defaultFull: true },
      { id: 'comercio', label: 'Comercio', defaultSimple: false, defaultFull: true },
      { id: 'created_at', label: 'Fecha Registro', defaultSimple: false, defaultFull: true }
    ],
    // Normalizador de fila
    normalizeRow: (p, commerce = '') => {
      // Calcular stock actual sumando su inventario
      let currentStock = 0;
      if (Array.isArray(p.inventory)) {
        currentStock = p.inventory.reduce((acc, inv) => acc + Number(inv.quantity || 0), 0);
      } else if (p.current_stock !== undefined) {
        currentStock = Number(p.current_stock || 0);
      }

      // Stock inicial
      const initialStock = (window.catalogInitialStockMap && window.catalogInitialStockMap[p.id]) !== undefined
        ? Number(window.catalogInitialStockMap[p.id])
        : (p.initial_stock !== undefined ? Number(p.initial_stock) : '-');

      // Dimensiones
      const hasDims = p.length || p.width || p.height;
      const dimsStr = hasDims ? `${p.length || 0} x ${p.width || 0} x ${p.height || 0} cm` : 'No def.';

      // Origen
      let orig = 'Manual';
      if (p.shopify_product_id) orig = 'Shopify';
      else if (p.raw_meli_data) orig = 'MercadoLibre';
      else if (p.raw_falabella_data) orig = 'Falabella';
      else if (p.raw_paris_data) orig = 'Paris';
      else if (p.raw_ripley_data) orig = 'Ripley';
      else if (p.raw_woocommerce_data) orig = 'WooCommerce';
      else if (p.raw_jumpseller_data) orig = 'Jumpseller';
      else if (p.raw_tiendanube_data) orig = 'Tiendanube';

      // Variantes
      const varParts = [];
      if (p.color) varParts.push(`Color: ${p.color}`);
      if (p.talla) varParts.push(`Talla: ${p.talla}`);
      if (p.var1) varParts.push(`Var1: ${p.var1}`);
      if (p.var2) varParts.push(`Var2: ${p.var2}`);
      const varStr = varParts.length > 0 ? varParts.join(' | ') : 'Sin variante';

      // Tipo
      const typeStr = p.is_virtual ? 'Virtual/Online' : (p.is_pack ? 'Pack/Combo' : 'Físico');

      // Fecha
      let createdStr = '-';
      if (p.created_at) {
        try {
          createdStr = new Date(p.created_at).toLocaleDateString('es-CL');
        } catch (e) {
          createdStr = String(p.created_at).slice(0, 10);
        }
      }

      return {
        sku: String(p.sku || '').trim(),
        name: String(p.name || '').trim(),
        description: String(p.description || '').trim(),
        alias: String(p.alias || '').trim(),
        barcode: String(p.barcode || p.codigo_barra || '-').trim(),
        barcode_wms: String(p.barcode_wms || '-').trim(),
        price: Number(p.price || 0),
        initial_stock: initialStock,
        current_stock: currentStock,
        status: p.status === 'archived' ? 'Archivado' : 'Activo',
        product_type: typeStr,
        dimensions: dimsStr,
        volumen: Number(p.volumen || 0),
        weight: Number(p.weight || 0),
        expiration_date: String(p.expiration_date || '-').trim(),
        lot_number: String(p.lot_number || '-').trim(),
        variants: varStr,
        origin: orig,
        comercio: String(p.comercio || commerce || '').trim(),
        created_at: createdStr
      };
    }
  };

  /**
   * Genera archivo Excel (.xlsx) con SheetJS formateado y auto-ajustado
   */
  function exportToExcel({ title, commerce, columns, rows, filename }) {
    if (typeof XLSX === 'undefined') {
      Swal.fire('Error', 'La librería XLSX (SheetJS) no está disponible en este momento.', 'error');
      return;
    }

    const wb = XLSX.utils.book_new();
    const currentDate = new Date().toLocaleString('es-CL', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    // Construcción del bloque de encabezado ejecutivo
    const excelAoa = [
      ['STOCKA WMS - SISTEMA DE GESTIÓN Y FULFILLMENT'],
      [`Reporte: ${title}`],
      [`Comercio: ${commerce || 'Todos los Comercios'}`, '', `Fecha de Emisión: ${currentDate}`, '', `Total Registros: ${rows.length}`],
      [] // Fila vacía de separación
    ];

    // Fila de encabezados de columna
    const headerRow = columns.map(col => col.label);
    excelAoa.push(headerRow);

    // Filas de datos
    rows.forEach(item => {
      const row = columns.map(col => {
        const val = item[col.id];
        return val !== undefined && val !== null ? val : '';
      });
      excelAoa.push(row);
    });

    const ws = XLSX.utils.aoa_to_sheet(excelAoa);

    // Ajustar anchos automáticos de columna
    const colWidths = columns.map((col, cIdx) => {
      let maxLen = col.label.length;
      for (let r = 5; r < excelAoa.length; r++) {
        const val = excelAoa[r][cIdx];
        if (val !== undefined && val !== null) {
          const str = String(val);
          if (str.length > maxLen) maxLen = Math.min(str.length, 50);
        }
      }
      return { wch: Math.max(maxLen + 3, 10) };
    });
    ws['!cols'] = colWidths;

    // Congelar paneles en la fila de encabezados (fila 5 -> índice 4)
    ws['!freeze'] = { ySplit: 5, xSplit: 0 };

    // Auto-filtro en los datos
    const lastColLetter = XLSX.utils.encode_col(columns.length - 1);
    ws['!autofilter'] = { ref: `A5:${lastColLetter}${excelAoa.length}` };

    XLSX.utils.book_append_sheet(wb, ws, 'Datos');
    XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
  }

  /**
   * Genera archivo PDF oficial con html2pdf.js con diseño corporativo STOCKA
   */
  async function exportToPdf({ title, commerce, columns, rows, filename, orientation = 'auto' }) {
    if (typeof html2pdf === 'undefined') {
      Swal.fire('Error', 'La librería html2pdf no está disponible.', 'error');
      return;
    }

    const safeDate = new Date().toLocaleString('es-CL', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    // Determinar orientación si es auto: si son más de 6 columnas -> landscape
    const finalOrientation = orientation === 'auto'
      ? (columns.length > 6 ? 'landscape' : 'portrait')
      : orientation;

    // Calcular KPIs resumen
    let totalItems = rows.length;
    let kpi1Label = 'Total Registros';
    let kpi1Val = totalItems;
    let kpi2Label = 'Total Unidades Físicas';
    let kpi2Val = 0;
    let kpi3Label = 'Disponibles Venta';
    let kpi3Val = 0;

    rows.forEach(r => {
      if (r.physical !== undefined) kpi2Val += Number(r.physical || 0);
      else if (r.current_stock !== undefined) kpi2Val += Number(r.current_stock || 0);

      if (r.totalAvailable !== undefined) kpi3Val += Number(r.totalAvailable || 0);
      else if (r.status === 'Activo' || r.status === 'En Stock') kpi3Val++;
    });

    if (rows[0] && rows[0].price !== undefined) {
      kpi3Label = 'Artículos Activos';
    }

    // Crear contenedor temporal fuera de pantalla
    const container = document.createElement('div');
    container.id = 'wms-export-pdf-temp';
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '0';
    container.style.width = finalOrientation === 'landscape' ? '1120px' : '820px';
    container.style.background = '#ffffff';
    container.style.color = '#0f172a';
    container.style.fontFamily = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    container.style.padding = '20px 25px';

    // Generar badges de estado en HTML
    const renderCellContent = (colId, val) => {
      if (val === undefined || val === null || val === '') return '<span style="color: #94a3b8;">-</span>';

      if (colId === 'status') {
        const s = String(val).toLowerCase();
        let bg = '#f1f5f9', fg = '#475569';
        if (s.includes('en stock') || s.includes('activo')) { bg = '#dcfce7'; fg = '#15803d'; }
        else if (s.includes('bajo stock')) { bg = '#fef3c7'; fg = '#b45309'; }
        else if (s.includes('agotado') || s.includes('archivado')) { bg = '#fee2e2'; fg = '#b91c1c'; }
        return `<span style="display: inline-block; padding: 2px 7px; border-radius: 9999px; font-size: 7pt; font-weight: 700; background: ${bg}; color: ${fg}; text-transform: uppercase;">${val}</span>`;
      }

      if (colId === 'price' && typeof val === 'number') {
        return `$${val.toLocaleString('es-CL')}`;
      }

      if (colId === 'sku') {
        return `<code style="font-family: monospace; font-size: 7.8pt; font-weight: 700; color: #1e293b; background: #f8fafc; padding: 1px 4px; border-radius: 4px; border: 1px solid #e2e8f0;">${val}</code>`;
      }

      return String(val);
    };

    // Construir tabla HTML
    const tableHeadersHtml = columns.map(c => `
      <th style="padding: 7px 6px; text-align: left; font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #334155; border-bottom: 2px solid #cbd5e1; background: #f1f5f9;">
        ${c.label}
      </th>
    `).join('');

    const tableRowsHtml = rows.map((r, idx) => {
      const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
      const cells = columns.map(c => `
        <td style="padding: 5px 6px; font-size: 7.5pt; color: #1e293b; border-bottom: 1px solid #e2e8f0; vertical-align: middle;">
          ${renderCellContent(c.id, r[c.id])}
        </td>
      `).join('');
      return `<tr style="background: ${bg}; page-break-inside: avoid;">${cells}</tr>`;
    }).join('');

    container.innerHTML = `
      <div style="width: 100%; box-sizing: border-box;">
        <!-- Header Corporativo -->
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #2563eb; padding-bottom: 12px; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <img src="assets/logo.png" onerror="this.src='https://cdn.shopify.com/s/files/1/0625/6141/9483/files/Stocka_1300_x_500_px_519_x_200_px_5.png?v=1779650350'" alt="STOCKA" style="height: 38px; object-fit: contain;">
            <div>
              <h2 style="margin: 0; font-size: 13pt; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.02em;">${title}</h2>
              <div style="font-size: 8pt; color: #64748b; margin-top: 2px;">STOCKA WMS • Logística y Gestión de Bodega Inteligente</div>
            </div>
          </div>
          <div style="text-align: right; font-size: 7.8pt; color: #475569;">
            <div><strong style="color: #0f172a;">Comercio:</strong> ${commerce || 'Todos'}</div>
            <div><strong>Emisión:</strong> ${safeDate}</div>
            <div><strong>Orientación:</strong> ${finalOrientation === 'landscape' ? 'Horizontal (Apaisada)' : 'Vertical'}</div>
          </div>
        </div>

        <!-- Tarjetas Resumen KPIs -->
        <div style="display: flex; gap: 12px; margin-bottom: 14px;">
          <div style="flex: 1; padding: 8px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;">
            <div style="font-size: 7pt; font-weight: 700; text-transform: uppercase; color: #64748b;">${kpi1Label}</div>
            <div style="font-size: 11pt; font-weight: 800; color: #2563eb; margin-top: 2px;">${kpi1Val.toLocaleString('es-CL')}</div>
          </div>
          <div style="flex: 1; padding: 8px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;">
            <div style="font-size: 7pt; font-weight: 700; text-transform: uppercase; color: #64748b;">${kpi2Label}</div>
            <div style="font-size: 11pt; font-weight: 800; color: #10b981; margin-top: 2px;">${kpi2Val.toLocaleString('es-CL')}</div>
          </div>
          <div style="flex: 1; padding: 8px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;">
            <div style="font-size: 7pt; font-weight: 700; text-transform: uppercase; color: #64748b;">${kpi3Label}</div>
            <div style="font-size: 11pt; font-weight: 800; color: #6366f1; margin-top: 2px;">${kpi3Val.toLocaleString('es-CL')}</div>
          </div>
        </div>

        <!-- Tabla Principal -->
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #cbd5e1; margin-bottom: 14px;">
          <thead>
            <tr>${tableHeadersHtml}</tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
        </table>

        <!-- Footer -->
        <div style="border-top: 1px solid #e2e8f0; padding-top: 8px; font-size: 7pt; color: #94a3b8; display: flex; justify-content: space-between; align-items: center;">
          <span>STOCKA WMS • Documento oficial generado digitalmente • Validez para auditoría física y de catálogo</span>
          <span>Página 1 de 1</span>
        </div>
      </div>
    `;

    document.body.appendChild(container);

    const safeFilename = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
    const opt = {
      margin: [7, 8, 7, 8],
      filename: safeFilename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: finalOrientation },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };

    Swal.fire({
      title: 'Generando Reporte PDF...',
      text: 'Por favor espera un momento mientras se renderiza el documento de alta resolución...',
      allowOutsideClick: false,
      didOpen: () => { Swal.showLoading(); }
    });

    try {
      await html2pdf().from(container).set(opt).save();
      Swal.close();
    } catch (err) {
      console.error('Error generando PDF:', err);
      Swal.fire('Error', 'No se pudo generar el documento PDF: ' + err.message, 'error');
    } finally {
      container.remove();
    }
  }

  /**
   * Genera archivo CSV con BOM UTF-8 para apertura directa en Excel en español
   */
  function exportToCsv({ columns, rows, filename }) {
    if (rows.length === 0) {
      Swal.fire('Aviso', 'No hay registros para exportar.', 'info');
      return;
    }

    const csvHeaders = columns.map(c => `"${c.label.replace(/"/g, '""')}"`);
    const csvLines = [csvHeaders.join(';')];

    rows.forEach(item => {
      const line = columns.map(col => {
        let val = item[col.id];
        if (val === undefined || val === null) val = '';
        const str = String(val);
        return `"${str.replace(/"/g, '""')}"`;
      });
      csvLines.push(line.join(';'));
    });

    // BOM UTF-8 (\ufeff)
    const csvContent = '\ufeff' + csvLines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeFilename = filename.endsWith('.csv') ? filename : `${filename}.csv`;
    link.setAttribute('href', url);
    link.setAttribute('download', safeFilename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * Objeto Singleton WmsExportManager expuesto globalmente
   */
  const WmsExportManager = {
    INVENTORY_SCHEMA,
    CATALOG_SCHEMA,

    init() {
      injectExportStyles();
      this.bindGlobalEvents();
    },

    bindGlobalEvents() {
      // Cerrar dropdowns al hacer clic fuera
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.wms-export-dropdown')) {
          document.querySelectorAll('.wms-export-dropdown.open').forEach(el => el.classList.remove('open'));
        }
      });
    },

    /**
     * Construye e inyecta el botón Dropdown de exportación en el contenedor especificado
     */
    renderDropdown(containerId, options) {
      injectExportStyles();
      const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
      if (!container) return;

      const moduleType = options.moduleType; // 'inventory' | 'catalog'
      const schema = moduleType === 'inventory' ? INVENTORY_SCHEMA : CATALOG_SCHEMA;

      container.innerHTML = `
        <div class="wms-export-dropdown" id="dropdown-${moduleType}-export">
          <button type="button" class="wms-export-btn" id="btn-${moduleType}-export-toggle" title="Exportar información en Excel, PDF o CSV">
            <i class="ri-download-2-line"></i>
            <span>Exportar</span>
            <i class="ri-arrow-down-s-line"></i>
          </button>
          <div class="wms-export-menu">
            <div class="wms-export-section-title">
              <i class="ri-file-excel-2-line" style="color: #107c41;"></i> Excel (.xlsx)
            </div>
            <button type="button" class="wms-export-item" data-action="export" data-format="xlsx" data-mode="simple">
              <i class="ri-file-excel-line" style="color: #107c41;"></i> Exportar Simple (Básico)
            </button>
            <button type="button" class="wms-export-item" data-action="export" data-format="xlsx" data-mode="full">
              <i class="ri-file-excel-2-fill" style="color: #107c41;"></i> Exportar Completo (Todo)
            </button>

            <div class="wms-export-divider"></div>
            <div class="wms-export-section-title">
              <i class="ri-file-pdf-line" style="color: #e11d48;"></i> Documento PDF Oficial
            </div>
            <button type="button" class="wms-export-item" data-action="export" data-format="pdf" data-mode="simple">
              <i class="ri-file-pdf-line" style="color: #e11d48;"></i> Reporte Simple (PDF)
            </button>
            <button type="button" class="wms-export-item" data-action="export" data-format="pdf" data-mode="full">
              <i class="ri-file-pdf-fill" style="color: #e11d48;"></i> Reporte Completo (PDF)
            </button>

            <div class="wms-export-divider"></div>
            <div class="wms-export-section-title">
              <i class="ri-file-text-line" style="color: #64748b;"></i> CSV (Separado por ;)
            </div>
            <button type="button" class="wms-export-item" data-action="export" data-format="csv" data-mode="simple">
              <i class="ri-file-text-line"></i> CSV Simple
            </button>
            <button type="button" class="wms-export-item" data-action="export" data-format="csv" data-mode="full">
              <i class="ri-file-list-3-line"></i> CSV Completo
            </button>

            <div class="wms-export-divider"></div>
            <button type="button" class="wms-export-item highlight-custom" data-action="open-custom-modal">
              <i class="ri-equalizer-line"></i> Personalizar Columnas...
            </button>
          </div>
        </div>
      `;

      const dropdownEl = container.querySelector('.wms-export-dropdown');
      const toggleBtn = container.querySelector('.wms-export-btn');

      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = dropdownEl.classList.contains('open');
        document.querySelectorAll('.wms-export-dropdown.open').forEach(el => el.classList.remove('open'));
        if (!isOpen) dropdownEl.classList.add('open');
      });

      // Delegación de acciones de exportación rápida y modal
      const menu = container.querySelector('.wms-export-menu');
      menu.addEventListener('click', (e) => {
        const item = e.target.closest('.wms-export-item');
        if (!item) return;

        dropdownEl.classList.remove('open');
        const action = item.getAttribute('data-action');

        if (action === 'open-custom-modal') {
          this.openCustomExportModal(options);
        } else if (action === 'export') {
          const format = item.getAttribute('data-format');
          const mode = item.getAttribute('data-mode'); // 'simple' | 'full'
          this.executeQuickExport(options, format, mode);
        }
      });
    },

    /**
     * Ejecuta una exportación rápida con preset Simple o Full
     */
    executeQuickExport(options, format, mode) {
      const moduleType = options.moduleType;
      const schema = moduleType === 'inventory' ? INVENTORY_SCHEMA : CATALOG_SCHEMA;
      const commerce = options.getCommerce ? options.getCommerce() : 'comercio';

      // Obtener datos (por defecto los filtrados actualmente o todos)
      let rawData = [];
      if (typeof options.getFilteredData === 'function') {
        rawData = options.getFilteredData();
      }
      if ((!rawData || rawData.length === 0) && typeof options.getAllData === 'function') {
        rawData = options.getAllData();
      }

      if (!rawData || rawData.length === 0) {
        Swal.fire('Sin registros', 'No hay registros disponibles para exportar con los filtros actuales.', 'info');
        return;
      }

      // Normalizar filas
      const normalizedRows = rawData.map(r => schema.normalizeRow(r, commerce));

      // Seleccionar columnas según preset
      const columns = schema.fields.filter(f => mode === 'full' ? f.defaultFull : f.defaultSimple);

      const dateTag = new Date().toISOString().slice(0, 10);
      const safeCommerce = (commerce || 'comercio').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
      const filename = `${schema.filenamePrefix}_${mode}_${safeCommerce}_${dateTag}`;

      if (format === 'xlsx') {
        exportToExcel({
          title: `${schema.title} (${mode === 'full' ? 'Completo' : 'Básico'})`,
          commerce,
          columns,
          rows: normalizedRows,
          filename
        });
      } else if (format === 'pdf') {
        exportToPdf({
          title: `${schema.title} (${mode === 'full' ? 'Completo' : 'Básico'})`,
          commerce,
          columns,
          rows: normalizedRows,
          filename,
          orientation: 'auto'
        });
      } else if (format === 'csv') {
        exportToCsv({
          columns,
          rows: normalizedRows,
          filename
        });
      }
    },

    /**
     * Abre el modal interactivo de exportación personalizada ("A pedido del usuario")
     */
    openCustomExportModal(options) {
      const moduleType = options.moduleType;
      const schema = moduleType === 'inventory' ? INVENTORY_SCHEMA : CATALOG_SCHEMA;
      const commerce = options.getCommerce ? options.getCommerce() : 'comercio';

      let modal = document.getElementById('wms-custom-export-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'wms-custom-export-modal';
        modal.className = 'wms-custom-export-modal';
        document.body.appendChild(modal);
      }

      // Conteo de registros disponibles
      const allData = typeof options.getAllData === 'function' ? (options.getAllData() || []) : [];
      const filteredData = typeof options.getFilteredData === 'function' ? (options.getFilteredData() || []) : [];
      const selectedData = typeof options.getSelectedData === 'function' ? (options.getSelectedData() || []) : [];

      const totalCount = allData.length;
      const filteredCount = filteredData.length;
      const selectedCount = selectedData.length;

      // HTML de checkboxes de columnas
      const columnsCheckboxesHtml = schema.fields.map(col => `
        <label class="wms-column-checkbox-label">
          <input type="checkbox" class="wms-export-col-cb" data-col-id="${col.id}" ${col.defaultSimple ? 'checked' : ''}>
          <span>${col.label}</span>
        </label>
      `).join('');

      modal.innerHTML = `
        <div class="wms-custom-export-dialog">
          <div class="wms-custom-export-header">
            <h3>
              <i class="ri-settings-4-line" style="color: var(--color-primary, #2563eb);"></i>
              Exportación a Pedido (${schema.title})
            </h3>
            <button type="button" class="btn-close-modal" id="btn-close-custom-export" style="background:none; border:none; font-size: 1.5rem; cursor:pointer; color: var(--color-text-muted);">&times;</button>
          </div>

          <div class="wms-custom-export-body">
            <!-- 1. Formato de Salida -->
            <div>
              <label style="display: block; font-weight: 700; font-size: 0.88rem; margin-bottom: 0.5rem; color: var(--color-text-main);">
                1. Formato de Archivo
              </label>
              <div class="wms-format-cards">
                <div class="wms-format-card selected" data-format="xlsx">
                  <i class="ri-file-excel-2-fill" style="color: #107c41;"></i>
                  <div class="format-title">Excel (.xlsx)</div>
                  <div class="format-desc">Planilla con membrete y filtros</div>
                </div>
                <div class="wms-format-card" data-format="pdf">
                  <i class="ri-file-pdf-fill" style="color: #e11d48;"></i>
                  <div class="format-title">PDF Oficial</div>
                  <div class="format-desc">Reporte corporativo imprimible</div>
                </div>
                <div class="wms-format-card" data-format="csv">
                  <i class="ri-file-text-fill" style="color: #64748b;"></i>
                  <div class="format-title">CSV (UTF-8)</div>
                  <div class="format-desc">Texto plano compatible</div>
                </div>
              </div>
            </div>

            <!-- 2. Alcance de Filas -->
            <div>
              <label style="display: block; font-weight: 700; font-size: 0.88rem; margin-bottom: 0.5rem; color: var(--color-text-main);">
                2. Alcance de Registros
              </label>
              <div class="wms-scope-options">
                <label class="wms-scope-label">
                  <input type="radio" name="export-scope" value="filtered" checked>
                  <span>Filtrados actualmente (<strong>${filteredCount}</strong>)</span>
                </label>
                <label class="wms-scope-label">
                  <input type="radio" name="export-scope" value="all">
                  <span>Todos del catálogo/inventario (<strong>${totalCount}</strong>)</span>
                </label>
                <label class="wms-scope-label ${selectedCount === 0 ? 'disabled' : ''}" style="${selectedCount === 0 ? 'opacity: 0.5;' : ''}">
                  <input type="radio" name="export-scope" value="selected" ${selectedCount === 0 ? 'disabled' : ''}>
                  <span>Solo seleccionados con casilla (<strong>${selectedCount}</strong>)</span>
                </label>
              </div>
            </div>

            <!-- 3. Selector de Columnas -->
            <div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.45rem;">
                <label style="font-weight: 700; font-size: 0.88rem; margin: 0; color: var(--color-text-main);">
                  3. Selección de Columnas
                </label>
                <div style="display: flex; gap: 0.4rem;">
                  <button type="button" id="btn-preset-simple" style="padding: 2px 8px; font-size: 0.75rem; border: 1px solid var(--color-border); background: var(--color-surface); border-radius: 4px; cursor: pointer;">Preset Básico</button>
                  <button type="button" id="btn-preset-full" style="padding: 2px 8px; font-size: 0.75rem; border: 1px solid var(--color-border); background: var(--color-surface); border-radius: 4px; cursor: pointer;">Seleccionar Todo</button>
                  <button type="button" id="btn-preset-none" style="padding: 2px 8px; font-size: 0.75rem; border: 1px solid var(--color-border); background: var(--color-surface); border-radius: 4px; cursor: pointer;">Deseleccionar</button>
                </div>
              </div>
              <div class="wms-columns-grid">
                ${columnsCheckboxesHtml}
              </div>
            </div>

            <!-- 4. Opciones de PDF -->
            <div id="wms-pdf-options-container" style="display: none; background: rgba(225, 29, 72, 0.04); border: 1px solid rgba(225, 29, 72, 0.2); border-radius: 8px; padding: 0.75rem;">
              <label style="font-size: 0.82rem; font-weight: 600; color: #9f1239; margin-bottom: 0.35rem; display: block;">
                Orientación de Página PDF:
              </label>
              <div style="display: flex; gap: 1rem;">
                <label style="font-size: 0.8rem; cursor: pointer;">
                  <input type="radio" name="pdf-orientation" value="auto" checked> Automática (Recomendada)
                </label>
                <label style="font-size: 0.8rem; cursor: pointer;">
                  <input type="radio" name="pdf-orientation" value="landscape"> Horizontal (Apaisada)
                </label>
                <label style="font-size: 0.8rem; cursor: pointer;">
                  <input type="radio" name="pdf-orientation" value="portrait"> Vertical
                </label>
              </div>
            </div>
          </div>

          <div class="wms-custom-export-footer">
            <span id="wms-export-summary-count" style="font-size: 0.8rem; color: var(--color-text-muted);">
              Columnas seleccionadas: <strong id="lbl-selected-cols-count">0</strong>
            </span>
            <div style="display: flex; gap: 0.5rem;">
              <button type="button" class="btn btn-outline" id="btn-cancel-custom-export" style="height: 38px; padding: 0 1rem; border-radius: 6px; cursor: pointer;">
                Cancelar
              </button>
              <button type="button" class="btn btn-primary" id="btn-execute-custom-export" style="height: 38px; padding: 0 1.25rem; font-weight: 600; border-radius: 6px; display: inline-flex; align-items: center; gap: 0.4rem; cursor: pointer;">
                <i class="ri-download-2-line"></i> Descargar Archivo
              </button>
            </div>
          </div>
        </div>
      `;

      modal.classList.add('active');

      // Control de selección de formato
      let selectedFormat = 'xlsx';
      const formatCards = modal.querySelectorAll('.wms-format-card');
      const pdfOptions = modal.querySelector('#wms-pdf-options-container');

      formatCards.forEach(card => {
        card.addEventListener('click', () => {
          formatCards.forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
          selectedFormat = card.getAttribute('data-format');
          if (selectedFormat === 'pdf') {
            pdfOptions.style.display = 'block';
          } else {
            pdfOptions.style.display = 'none';
          }
        });
      });

      // Actualizar contador de columnas
      const updateColsCount = () => {
        const count = modal.querySelectorAll('.wms-export-col-cb:checked').length;
        const lbl = modal.querySelector('#lbl-selected-cols-count');
        if (lbl) lbl.textContent = count;
      };
      updateColsCount();

      modal.querySelectorAll('.wms-export-col-cb').forEach(cb => {
        cb.addEventListener('change', updateColsCount);
      });

      // Presets
      modal.querySelector('#btn-preset-simple')?.addEventListener('click', () => {
        modal.querySelectorAll('.wms-export-col-cb').forEach(cb => {
          const colId = cb.getAttribute('data-col-id');
          const f = schema.fields.find(x => x.id === colId);
          cb.checked = !!(f && f.defaultSimple);
        });
        updateColsCount();
      });

      modal.querySelector('#btn-preset-full')?.addEventListener('click', () => {
        modal.querySelectorAll('.wms-export-col-cb').forEach(cb => cb.checked = true);
        updateColsCount();
      });

      modal.querySelector('#btn-preset-none')?.addEventListener('click', () => {
        modal.querySelectorAll('.wms-export-col-cb').forEach(cb => cb.checked = false);
        updateColsCount();
      });

      // Cerrar modal
      const closeModal = () => modal.classList.remove('active');
      modal.querySelector('#btn-close-custom-export')?.addEventListener('click', closeModal);
      modal.querySelector('#btn-cancel-custom-export')?.addEventListener('click', closeModal);

      // Ejecutar descarga personalizada
      modal.querySelector('#btn-execute-custom-export')?.addEventListener('click', () => {
        const checkedBoxes = Array.from(modal.querySelectorAll('.wms-export-col-cb:checked'));
        if (checkedBoxes.length === 0) {
          Swal.fire('Atención', 'Debes seleccionar al menos una columna para exportar.', 'warning');
          return;
        }

        const selectedColIds = new Set(checkedBoxes.map(cb => cb.getAttribute('data-col-id')));
        const chosenColumns = schema.fields.filter(f => selectedColIds.has(f.id));

        // Obtener filas según alcance (Scope)
        const scopeRadio = modal.querySelector('input[name="export-scope"]:checked');
        const scopeVal = scopeRadio ? scopeRadio.value : 'filtered';

        let targetRawData = [];
        if (scopeVal === 'selected' && selectedData.length > 0) {
          targetRawData = selectedData;
        } else if (scopeVal === 'all' && allData.length > 0) {
          targetRawData = allData;
        } else {
          targetRawData = filteredData.length > 0 ? filteredData : allData;
        }

        if (targetRawData.length === 0) {
          Swal.fire('Sin registros', 'No se encontraron registros para el alcance seleccionado.', 'info');
          return;
        }

        const normalizedRows = targetRawData.map(r => schema.normalizeRow(r, commerce));
        const dateTag = new Date().toISOString().slice(0, 10);
        const safeCommerce = (commerce || 'comercio').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
        const filename = `${schema.filenamePrefix}_custom_${safeCommerce}_${dateTag}`;

        closeModal();

        if (selectedFormat === 'xlsx') {
          exportToExcel({
            title: `${schema.title} (Personalizado)`,
            commerce,
            columns: chosenColumns,
            rows: normalizedRows,
            filename
          });
        } else if (selectedFormat === 'pdf') {
          const orientRadio = modal.querySelector('input[name="pdf-orientation"]:checked');
          const orientation = orientRadio ? orientRadio.value : 'auto';
          exportToPdf({
            title: `${schema.title} (Personalizado)`,
            commerce,
            columns: chosenColumns,
            rows: normalizedRows,
            filename,
            orientation
          });
        } else if (selectedFormat === 'csv') {
          exportToCsv({
            columns: chosenColumns,
            rows: normalizedRows,
            filename
          });
        }
      });
    }
  };

  // Exponer globalmente en window
  window.WmsExportManager = WmsExportManager;
  document.addEventListener('DOMContentLoaded', () => WmsExportManager.init());
  WmsExportManager.init();
})();
