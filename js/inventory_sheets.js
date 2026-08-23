// js/inventory_sheets.js - Generador de Hojas de Conteo de Inventario Físico (PDF & Excel) para STOCKA WMS

/**
 * Genera y descarga la Hoja Oficial de Toma de Inventario Físico en formato PDF
 * Diseñada específicamente con cuadrícula y espacio para conteo manual en terreno
 * @param {Object} req - Objeto con los datos de la solicitud de inventario
 */
window.generateInventoryCountPdf = async function(req) {
  if (!req) {
    alert('Error: Datos de solicitud de inventario no disponibles.');
    return;
  }

  const folio = req.folio || `REQ-INV-${(req.id || '').substring(0, 6).toUpperCase()}`;
  const comercio = req.comercio || 'Todos';
  const warehouseName = req.warehouse_name || 'Todas las bodegas';
  const reason = req.reason || 'Auditoría / Cuadratura Periódica';
  const priority = req.priority || 'Normal';
  const typeStr = (req.type === 'selectivo' || req.type === 'parcial') ? 'Inventario Selectivo (Parcial)' : 'Inventario Completo (General)';
  const requestedBy = req.requested_by || 'Cliente WMS';
  const notes = req.notes || 'Sin observaciones adicionales.';
  const products = Array.isArray(req.products_list) ? req.products_list : [];
  
  const formattedDate = req.created_at ? new Date(req.created_at).toLocaleString('es-CL', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }) : new Date().toLocaleString('es-CL');

  // Crear contenedor temporal fuera de pantalla para maquetación exacta
  const container = document.createElement('div');
  container.id = 'inventory-sheet-pdf-container';
  container.style.position = 'fixed';
  container.style.top = '-99999px';
  container.style.left = '-99999px';
  container.style.width = '210mm'; // Formato A4
  container.style.backgroundColor = '#ffffff';
  container.style.color = '#1e293b';
  container.style.fontFamily = "'Inter', Arial, sans-serif";
  container.style.padding = '12mm 15mm';
  container.style.boxSizing = 'border-box';
  container.style.fontSize = '9pt';
  container.style.lineHeight = '1.3';

  // Renderizar filas de productos
  let rowsHtml = '';
  if (products.length === 0) {
    rowsHtml = `
      <tr>
        <td colspan="10" style="text-align: center; padding: 20px; color: #64748b; font-style: italic;">
          No se especificaron productos individuales en la solicitud.
        </td>
      </tr>
    `;
  } else {
    products.forEach((p, idx) => {
      const isEven = idx % 2 === 0;
      const bg = isEven ? '#ffffff' : '#f8fafc';
      const barcode = p.barcode || p.codigo_barra || '-';
      const whName = p.warehouse_name || warehouseName || 'Principal';
      const sysQty = (p.system_qty !== undefined && p.system_qty !== null) ? p.system_qty : (p.quantity || 0);

      rowsHtml += `
        <tr style="background-color: ${bg}; border-bottom: 1px solid #e2e8f0; page-break-inside: avoid;">
          <td style="padding: 6px 4px; text-align: center; font-weight: 600; color: #64748b; font-size: 8pt; border-right: 1px solid #e2e8f0;">${idx + 1}</td>
          <td style="padding: 6px 6px; font-family: 'Courier New', monospace; font-weight: 700; color: #0f172a; font-size: 8.5pt; border-right: 1px solid #e2e8f0; white-space: nowrap;">${p.sku || '-'}</td>
          <td style="padding: 6px 6px; font-family: 'Courier New', monospace; color: #475569; font-size: 8pt; border-right: 1px solid #e2e8f0;">${barcode}</td>
          <td style="padding: 6px 6px; color: #0f172a; font-size: 8.5pt; font-weight: 500; border-right: 1px solid #e2e8f0; line-height: 1.2;">${p.name || 'Sin nombre'}</td>
          <td style="padding: 6px 4px; color: #475569; font-size: 7.5pt; text-align: center; border-right: 1px solid #e2e8f0;">${whName}</td>
          <td style="padding: 6px 4px; text-align: center; font-weight: 700; color: #1e40af; font-size: 9pt; background-color: #f1f5f9; border-right: 1px solid #cbd5e1;">${sysQty}</td>
          <!-- Casilla 1er Conteo -->
          <td style="padding: 4px; text-align: center; border-right: 1px solid #cbd5e1; width: 50px; background-color: #ffffff;">
            <div style="border: 1.5px solid #94a3b8; border-radius: 3px; height: 22px; width: 100%; box-sizing: border-box; background: #fff;"></div>
          </td>
          <!-- Casilla 2do Conteo -->
          <td style="padding: 4px; text-align: center; border-right: 1px solid #cbd5e1; width: 50px; background-color: #ffffff;">
            <div style="border: 1.5px solid #94a3b8; border-radius: 3px; height: 22px; width: 100%; box-sizing: border-box; background: #fff;"></div>
          </td>
          <!-- Casilla Diferencia -->
          <td style="padding: 4px; text-align: center; border-right: 1px solid #cbd5e1; width: 45px; background-color: #ffffff;">
            <div style="border: 1.5px dashed #cbd5e1; border-radius: 3px; height: 22px; width: 100%; box-sizing: border-box; background: #fff;"></div>
          </td>
          <!-- Casilla Observaciones / Estado -->
          <td style="padding: 4px 6px; width: 95px; background-color: #ffffff;">
            <div style="border-bottom: 1px dotted #94a3b8; height: 18px; margin-top: 2px;"></div>
          </td>
        </tr>
      `;
    });
  }

  // Prioridad con color de insignia
  let priorityColor = '#2563eb';
  let priorityBg = '#eff6ff';
  if (priority === 'Alta' || priority === 'Urgente') {
    priorityColor = '#dc2626';
    priorityBg = '#fef2f2';
  } else if (priority === 'Media') {
    priorityColor = '#d97706';
    priorityBg = '#fffbeb';
  }

  container.innerHTML = `
    <div id="pdf-printable-area" style="width: 100%;">
      <!-- ENCABEZADO INSTITUCIONAL -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 14px;">
          <img src="img/newlogotransp.png" alt="STOCKA Logo" style="height: 42px; width: auto; object-fit: contain;" onerror="this.onerror=null; this.src='https://cdn.shopify.com/s/files/1/0625/6141/9483/files/newlogotransp.png?v=1779852093';">
          <div>
            <h1 style="margin: 0; font-size: 14pt; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; text-transform: uppercase;">
              Hoja de Toma de Inventario Físico
            </h1>
            <p style="margin: 2px 0 0 0; font-size: 8pt; color: #64748b; font-weight: 500;">
              STOCKA WMS & Fulfillment • Control Operativo de Bodega y Cuadratura de Stock
            </p>
          </div>
        </div>
        <div style="text-align: right;">
          <div style="display: inline-block; background-color: #0f172a; color: #ffffff; padding: 4px 10px; border-radius: 4px; font-weight: 800; font-size: 10pt; font-family: monospace; letter-spacing: 0.5px;">
            ${folio}
          </div>
          <div style="font-size: 7.5pt; color: #64748b; margin-top: 4px;">
            Emisión: <strong>${formattedDate}</strong>
          </div>
        </div>
      </div>

      <!-- METADATOS DE LA SOLICITUD (TABLA DE RESUMEN) -->
      <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px 12px; margin-bottom: 12px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 8.5pt;">
          <tr>
            <td style="padding: 3px 6px; width: 14%; font-weight: 700; color: #475569;">Cliente / Comercio:</td>
            <td style="padding: 3px 6px; width: 36%; font-weight: 700; color: #0f172a; font-size: 9pt;">${comercio}</td>
            <td style="padding: 3px 6px; width: 14%; font-weight: 700; color: #475569;">Bodega Asignada:</td>
            <td style="padding: 3px 6px; width: 36%; font-weight: 600; color: #0f172a;">${warehouseName}</td>
          </tr>
          <tr>
            <td style="padding: 3px 6px; font-weight: 700; color: #475569;">Tipo Conteo:</td>
            <td style="padding: 3px 6px; font-weight: 600; color: #0f172a;">${typeStr}</td>
            <td style="padding: 3px 6px; font-weight: 700; color: #475569;">Prioridad:</td>
            <td style="padding: 3px 6px;">
              <span style="background-color: ${priorityBg}; color: ${priorityColor}; padding: 2px 8px; border-radius: 10px; font-size: 7.5pt; font-weight: 700; border: 1px solid ${priorityColor};">
                ${priority.toUpperCase()}
              </span>
            </td>
          </tr>
          <tr>
            <td style="padding: 3px 6px; font-weight: 700; color: #475569;">Motivo Solicitud:</td>
            <td style="padding: 3px 6px; color: #1e293b;">${reason}</td>
            <td style="padding: 3px 6px; font-weight: 700; color: #475569;">Total Artículos:</td>
            <td style="padding: 3px 6px; font-weight: 700; color: #0f172a;">${products.length} SKUs a verificar</td>
          </tr>
          <tr>
            <td style="padding: 3px 6px; font-weight: 700; color: #475569;">Corte Pedidos:</td>
            <td colspan="3" style="padding: 3px 6px; color: #0f172a; font-size: 8pt; background-color: #f1f5f9; border-radius: 4px;">
              <span style="display: inline-block; background-color: #1e293b; color: #ffffff; padding: 1px 6px; border-radius: 3px; font-size: 7pt; font-family: monospace; margin-right: 6px; font-weight: 700;">ÚLTIMO PREPARADO:</span>
              <strong style="color: #4338ca; font-size: 8.5pt;">${req.cutoff_order || 'Sin corte especificado (Todo en estante)'}</strong>
              <span style="font-size: 7.5pt; color: #64748b; font-weight: normal; margin-left: 6px;">(Items retirados físicamente de estante hasta este pedido)</span>
            </td>
          </tr>
          ${notes ? `
          <tr>
            <td style="padding: 3px 6px; font-weight: 700; color: #475569; vertical-align: top;">Instrucciones / Notas:</td>
            <td colspan="3" style="padding: 3px 6px; color: #334155; font-style: italic; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 4px;">
              ${notes}
            </td>
          </tr>
          ` : ''}
        </table>
      </div>

      <!-- GUÍA OPERATIVA PARA LA CUADRILLA -->
      <div style="background-color: #f1f5f9; border-left: 4px solid #2563eb; padding: 6px 10px; margin-bottom: 12px; font-size: 7.8pt; color: #334155; border-radius: 0 4px 4px 0;">
        <strong style="color: #1e40af;">Instrucciones Operativas para Bodega:</strong>
        1. Realizar conteo físico pieza por pieza en el pasillo/rack.
        2. Registrar en <strong>1er Conteo</strong>. En caso de descuadre, realizar <strong>2do Conteo</strong> de verificación.
        3. Anotar en <em>Observaciones</em> si se detecta producto dañado, merma, empaque abierto o sin código de barras.
        4. Al finalizar, firmar la hoja y entregar al supervisor de turno para ingresar los datos en el sistema WMS.
      </div>

      <!-- TABLA PRINCIPAL DE CONTEO FÍSICO -->
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #cbd5e1; font-size: 8pt; margin-bottom: 15px;">
        <thead>
          <tr style="background-color: #0f172a; color: #ffffff; text-align: left; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.5px;">
            <th style="padding: 6px 4px; width: 22px; text-align: center; border-right: 1px solid #334155;">#</th>
            <th style="padding: 6px 6px; width: 85px; border-right: 1px solid #334155;">SKU</th>
            <th style="padding: 6px 6px; width: 85px; border-right: 1px solid #334155;">Cód. Barras</th>
            <th style="padding: 6px 6px; border-right: 1px solid #334155;">Descripción del Producto</th>
            <th style="padding: 6px 4px; width: 70px; text-align: center; border-right: 1px solid #334155;">Bodega</th>
            <th style="padding: 6px 4px; width: 50px; text-align: center; background-color: #1e3a8a; border-right: 1px solid #334155;">Sist.</th>
            <th style="padding: 6px 4px; width: 50px; text-align: center; background-color: #047857; border-right: 1px solid #334155;">1° Conteo</th>
            <th style="padding: 6px 4px; width: 50px; text-align: center; background-color: #047857; border-right: 1px solid #334155;">2° Conteo</th>
            <th style="padding: 6px 4px; width: 45px; text-align: center; background-color: #475569; border-right: 1px solid #334155;">Dif. (±)</th>
            <th style="padding: 6px 6px; width: 95px; text-align: center;">Estado / Notas</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <!-- SECCIÓN DE FIRMAS Y CIERRE DE TOMA DE INVENTARIO -->
      <div style="page-break-inside: avoid; border-top: 1px solid #cbd5e1; padding-top: 10px; margin-top: 10px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 8pt;">
          <tr>
            <td style="width: 48%; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 6px; vertical-align: top; background-color: #ffffff;">
              <div style="font-weight: 700; color: #0f172a; margin-bottom: 25px; text-transform: uppercase; font-size: 7.5pt; border-bottom: 1px solid #e2e8f0; padding-bottom: 3px;">
                Responsable del Conteo (Bodeguero / Operador)
              </div>
              <div style="display: flex; flex-direction: column; gap: 4px; color: #475569; font-size: 7.5pt;">
                <div>Nombre: _____________________________________________</div>
                <div>RUT: _______________________ Fecha: ____/____/________</div>
                <div style="margin-top: 15px;">Firma: ______________________________________________</div>
              </div>
            </td>
            <td style="width: 4%;"></td>
            <td style="width: 48%; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 6px; vertical-align: top; background-color: #ffffff;">
              <div style="font-weight: 700; color: #0f172a; margin-bottom: 25px; text-transform: uppercase; font-size: 7.5pt; border-bottom: 1px solid #e2e8f0; padding-bottom: 3px;">
                Validación y Cierre (Supervisor WMS STOCKA)
              </div>
              <div style="display: flex; flex-direction: column; gap: 4px; color: #475569; font-size: 7.5pt;">
                <div>Nombre: _____________________________________________</div>
                <div>Hora Inicio: _____:_____ &nbsp;&nbsp;|&nbsp;&nbsp; Hora Fin: _____:_____</div>
                <div style="margin-top: 15px;">Firma V°B°: _________________________________________</div>
              </div>
            </td>
          </tr>
        </table>
        
        <div style="text-align: center; margin-top: 10px; font-size: 7pt; color: #94a3b8;">
          STOCKA WMS • Documento Oficial de Control y Auditoría Físico-Sistémica de Inventario • Página 1 de 1
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(container);

  try {
    const printableArea = container.querySelector('#pdf-printable-area');
    const safeCommerce = comercio.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeFolio = folio.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Hoja_Inventario_${safeFolio}_${safeCommerce}.pdf`;

    const opt = {
      margin:       [8, 10, 8, 10], // Margen en mm [top, left, bottom, right]
      filename:     filename,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true, scrollY: 0, scrollX: 0, logging: false },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
    };

    if (typeof html2pdf !== 'undefined') {
      await html2pdf().from(printableArea).set(opt).save();
    } else {
      window.print();
    }
  } catch (err) {
    console.error('Error al generar PDF de inventario:', err);
    alert('Error al generar el archivo PDF: ' + err.message);
  } finally {
    container.remove();
  }
};

/**
 * Genera y descarga la planilla Excel (XLSX) con la estructura de conteo de inventario
 * @param {Object} req - Objeto con los datos de la solicitud de inventario
 */
window.generateInventoryCountExcel = function(req) {
  if (!req) {
    alert('Error: Datos de solicitud de inventario no disponibles.');
    return;
  }

  if (typeof XLSX === 'undefined') {
    alert('Error: Librería de exportación Excel (XLSX) no disponible.');
    return;
  }

  const folio = req.folio || `REQ-INV-${(req.id || '').substring(0, 6).toUpperCase()}`;
  const comercio = req.comercio || 'Todos';
  const warehouseName = req.warehouse_name || 'Todas las bodegas';
  const reason = req.reason || 'Auditoría / Cuadratura Periódica';
  const priority = req.priority || 'Normal';
  const notes = req.notes || '';
  const products = Array.isArray(req.products_list) ? req.products_list : [];

  const formattedDate = req.created_at ? new Date(req.created_at).toLocaleString('es-CL') : new Date().toLocaleString('es-CL');

  // Construir filas del libro Excel
  const excelRows = [
    ['STOCKA WMS - HOJA DE TOMA DE INVENTARIO FÍSICO'],
    ['Folio Solicitud:', folio, '', 'Fecha Emisión:', formattedDate],
    ['Comercio:', comercio, '', 'Bodega:', warehouseName],
    ['Motivo:', reason, '', 'Prioridad:', priority],
    ['Corte Último Pedido Preparado:', req.cutoff_order || 'Sin corte especificado (Todo en estante)', '', 'Total SKUs:', products.length],
    ['Instrucciones:', notes || 'Realizar conteo físico minucioso y registrar discrepancias.'],
    [], // Fila en blanco
    [
      'N°',
      'SKU',
      'Código de Barras',
      'Producto / Descripción',
      'Bodega Asignada',
      'Stock Teórico (Sistema)',
      '1er Conteo Físico',
      '2do Conteo (Revisión)',
      'Diferencia (Físico - Sistema)',
      'Estado / Observaciones de Bodega'
    ]
  ];

  products.forEach((p, idx) => {
    const sysQty = (p.system_qty !== undefined && p.system_qty !== null) ? p.system_qty : (p.quantity || 0);
    const counted = (p.counted_qty !== undefined && p.counted_qty !== null) ? p.counted_qty : '';
    const diff = (p.difference !== undefined && p.difference !== null) ? p.difference : '';
    const pNotes = p.notes || '';

    excelRows.push([
      idx + 1,
      p.sku || '',
      p.barcode || p.codigo_barra || '',
      p.name || '',
      p.warehouse_name || warehouseName || '',
      sysQty,
      counted,
      '', // Espacio para 2do conteo
      diff,
      pNotes
    ]);
  });

  // Fila de resumen / pie de conteo
  excelRows.push([]);
  excelRows.push(['', '', '', '', 'TOTAL UNIDADES SISTEMA:', { f: `SUM(F8:F${7 + products.length})` }, { f: `SUM(G8:G${7 + products.length})` }, '', { f: `SUM(I8:I${7 + products.length})` }, '']);
  excelRows.push([]);
  excelRows.push(['Responsable Conteo:', '___________________________', 'Firma:', '___________________________', 'Fecha:', '____/____/________']);
  excelRows.push(['Supervisor Bodega:', '___________________________', 'Firma V°B°:', '___________________________', 'Fecha:', '____/____/________']);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(excelRows);

  // Configuración de anchos de columnas
  ws['!cols'] = [
    { wch: 6 },  // N°
    { wch: 18 }, // SKU
    { wch: 18 }, // Código de Barras
    { wch: 40 }, // Producto
    { wch: 20 }, // Bodega
    { wch: 16 }, // Stock Sistema
    { wch: 16 }, // 1er Conteo
    { wch: 16 }, // 2do Conteo
    { wch: 18 }, // Diferencia
    { wch: 35 }  // Observaciones
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Toma de Inventario');

  const safeCommerce = comercio.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeFolio = folio.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `Planilla_Toma_Inventario_${safeFolio}_${safeCommerce}.xlsx`;

  XLSX.writeFile(wb, filename);
};

/**
 * Genera y descarga el INFORME OFICIAL DE RESULTADOS DE INVENTARIO FÍSICO en formato PDF
 * Muestra el conteo real realizado, discrepancias (faltantes/sobrantes), KPIs y firmas de validación
 * @param {Object} req - Objeto con los datos y resultados de la solicitud de inventario
 */
window.generateInventoryReportPdf = async function(req) {
  if (!req) {
    alert('Error: Datos de solicitud de inventario no disponibles.');
    return;
  }

  const folio = req.folio || `REQ-INV-${(req.id || '').substring(0, 6).toUpperCase()}`;
  const comercio = req.comercio || 'Todos';
  const warehouseName = req.warehouse_name || 'Todas las bodegas';
  const reason = req.reason || 'Auditoría / Cuadratura Periódica';
  const priority = req.priority || 'Normal';
  const typeStr = (req.type === 'selectivo' || req.type === 'parcial') ? 'Inventario Selectivo (Parcial)' : 'Inventario Completo (General)';
  const requestedBy = req.requested_by || 'Cliente WMS';
  const completedBy = req.completed_by || 'Supervisor de Bodega STOCKA';
  const notes = req.notes || '';
  const adminNotes = req.admin_notes || '';
  const status = req.status || 'Finalizada';
  const products = Array.isArray(req.products_list) ? req.products_list : [];

  const formattedCreatedDate = req.created_at ? new Date(req.created_at).toLocaleString('es-CL', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }) : new Date().toLocaleString('es-CL');

  const formattedCompletedDate = req.completed_at ? new Date(req.completed_at).toLocaleString('es-CL', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }) : new Date().toLocaleString('es-CL');

  // Cálculos estadísticos y KPIs de Cuadratura
  const totalSkus = products.length;
  let matchedSkus = 0;
  let surplusSkus = 0;
  let deficitSkus = 0;
  let totalSysUnits = 0;
  let totalCountedUnits = 0;

  products.forEach(p => {
    const sys = Number(p.system_qty) || 0;
    const counted = (p.counted_qty !== undefined && p.counted_qty !== null) ? Number(p.counted_qty) : sys;
    const diff = (p.difference !== undefined && p.difference !== null) ? Number(p.difference) : (counted - sys);

    totalSysUnits += sys;
    totalCountedUnits += counted;

    if (diff === 0) matchedSkus++;
    else if (diff > 0) surplusSkus++;
    else if (diff < 0) deficitSkus++;
  });

  const netDiffUnits = totalCountedUnits - totalSysUnits;
  const accuracyPct = totalSkus > 0 ? ((matchedSkus / totalSkus) * 100).toFixed(1) : '100.0';

  // Crear contenedor temporal fuera de pantalla
  const container = document.createElement('div');
  container.id = 'inventory-report-pdf-container';
  container.style.position = 'fixed';
  container.style.top = '-99999px';
  container.style.left = '-99999px';
  container.style.width = '210mm'; // A4
  container.style.backgroundColor = '#ffffff';
  container.style.color = '#1e293b';
  container.style.fontFamily = "'Inter', Arial, sans-serif";
  container.style.padding = '10mm 13mm';
  container.style.boxSizing = 'border-box';
  container.style.fontSize = '8.5pt';
  container.style.lineHeight = '1.3';

  // Renderizar filas de la tabla de resultados
  let rowsHtml = '';
  if (products.length === 0) {
    rowsHtml = `<tr><td colspan="9" style="text-align: center; padding: 20px; color: #64748b; font-style: italic;">No hay artículos registrados en la solicitud.</td></tr>`;
  } else {
    products.forEach((p, idx) => {
      const isEven = idx % 2 === 0;
      const bg = isEven ? '#ffffff' : '#f8fafc';
      const barcode = p.barcode || p.codigo_barra || '-';
      const whName = p.warehouse_name || warehouseName || 'Principal';
      const sysQty = (p.system_qty !== undefined && p.system_qty !== null) ? Number(p.system_qty) : 0;
      const counted = (p.counted_qty !== undefined && p.counted_qty !== null) ? Number(p.counted_qty) : sysQty;
      const diff = (p.difference !== undefined && p.difference !== null) ? Number(p.difference) : (counted - sysQty);
      const pNotes = p.notes || '-';

      let diffTag = '';
      let statusTag = '';

      if (diff === 0) {
        diffTag = `<span style="font-weight: 700; color: #059669;">0</span>`;
        statusTag = `<span style="background-color: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 7pt; display: inline-block;">✓ CUADRADO</span>`;
      } else if (diff > 0) {
        diffTag = `<span style="font-weight: 700; color: #059669;">+${diff}</span>`;
        statusTag = `<span style="background-color: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 7pt; display: inline-block;">▲ SOBRANTE (+${diff})</span>`;
      } else {
        diffTag = `<span style="font-weight: 700; color: #dc2626;">${diff}</span>`;
        statusTag = `<span style="background-color: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 7pt; display: inline-block;">▼ FALTANTE (${diff})</span>`;
      }

      rowsHtml += `
        <tr style="background-color: ${bg}; border-bottom: 1px solid #e2e8f0; page-break-inside: avoid;">
          <td style="padding: 5px 4px; text-align: center; font-weight: 600; color: #64748b; font-size: 8pt; border-right: 1px solid #e2e8f0;">${idx + 1}</td>
          <td style="padding: 5px 6px; font-family: 'Courier New', monospace; font-weight: 700; color: #0f172a; font-size: 8pt; border-right: 1px solid #e2e8f0; white-space: nowrap;">${p.sku || '-'}</td>
          <td style="padding: 5px 6px; font-family: 'Courier New', monospace; color: #475569; font-size: 7.5pt; border-right: 1px solid #e2e8f0;">${barcode}</td>
          <td style="padding: 5px 6px; color: #0f172a; font-size: 8pt; font-weight: 500; border-right: 1px solid #e2e8f0; line-height: 1.2;">${p.name || 'Sin nombre'}</td>
          <td style="padding: 5px 4px; color: #475569; font-size: 7.5pt; text-align: center; border-right: 1px solid #e2e8f0;">${whName}</td>
          <td style="padding: 5px 4px; text-align: center; font-weight: 700; color: #1e40af; font-size: 8.5pt; background-color: #f1f5f9; border-right: 1px solid #cbd5e1;">${sysQty}</td>
          <td style="padding: 5px 4px; text-align: center; font-weight: 800; color: #0f172a; font-size: 8.5pt; background-color: #ffffff; border-right: 1px solid #cbd5e1;">${counted}</td>
          <td style="padding: 5px 4px; text-align: center; font-size: 8.5pt; border-right: 1px solid #cbd5e1; background-color: #ffffff;">${diffTag}</td>
          <td style="padding: 4px 6px; text-align: center; border-right: 1px solid #cbd5e1;">${statusTag}</td>
          <td style="padding: 5px 6px; font-size: 7.5pt; color: #475569;">${pNotes}</td>
        </tr>
      `;
    });
  }

  container.innerHTML = `
    <div id="pdf-printable-area" style="width: 100%;">
      <!-- ENCABEZADO INSTITUCIONAL -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2.5px solid #0f172a; padding-bottom: 8px; margin-bottom: 10px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <img src="img/newlogotransp.png" alt="STOCKA Logo" style="height: 40px; width: auto; object-fit: contain;" onerror="this.onerror=null; this.src='https://cdn.shopify.com/s/files/1/0625/6141/9483/files/newlogotransp.png?v=1779852093';">
          <div>
            <div style="display: inline-block; background-color: #059669; color: #ffffff; padding: 2px 7px; border-radius: 3px; font-size: 7pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">
              Acta Oficial de Auditoría y Cuadratura
            </div>
            <h1 style="margin: 0; font-size: 13pt; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; text-transform: uppercase;">
              Informe de Resultados de Inventario Físico
            </h1>
            <p style="margin: 1px 0 0 0; font-size: 7.5pt; color: #64748b; font-weight: 500;">
              STOCKA WMS & Fulfillment • Control de Existencias, Discrepancias y Ajustes de Stock
            </p>
          </div>
        </div>
        <div style="text-align: right;">
          <div style="display: inline-block; background-color: #0f172a; color: #ffffff; padding: 4px 10px; border-radius: 4px; font-weight: 800; font-size: 9.5pt; font-family: monospace; letter-spacing: 0.5px;">
            ${folio}
          </div>
          <div style="font-size: 7.5pt; color: #64748b; margin-top: 3px;">
            Cierre: <strong>${formattedCompletedDate}</strong>
          </div>
          <div style="font-size: 7pt; color: #059669; font-weight: 700; margin-top: 1px;">
            ESTADO: ${status.toUpperCase()}
          </div>
        </div>
      </div>

      <!-- TARJETA DE METADATOS Y RESPONSABLES -->
      <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; margin-bottom: 10px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 8pt;">
          <tr>
            <td style="padding: 2.5px 4px; width: 14%; font-weight: 700; color: #475569;">Cliente / Comercio:</td>
            <td style="padding: 2.5px 4px; width: 36%; font-weight: 700; color: #0f172a; font-size: 8.5pt;">${comercio}</td>
            <td style="padding: 2.5px 4px; width: 14%; font-weight: 700; color: #475569;">Bodega Asignada:</td>
            <td style="padding: 2.5px 4px; width: 36%; font-weight: 600; color: #0f172a;">${warehouseName}</td>
          </tr>
          <tr>
            <td style="padding: 2.5px 4px; font-weight: 700; color: #475569;">Tipo Conteo:</td>
            <td style="padding: 2.5px 4px; font-weight: 600; color: #0f172a;">${typeStr}</td>
            <td style="padding: 2.5px 4px; font-weight: 700; color: #475569;">Motivo Auditoría:</td>
            <td style="padding: 2.5px 4px; color: #1e293b;">${reason}</td>
          </tr>
          <tr>
            <td style="padding: 2.5px 4px; font-weight: 700; color: #475569;">Corte Último Pedido:</td>
            <td style="padding: 2.5px 4px; color: #4338ca; font-weight: 700; font-family: monospace;">${req.cutoff_order || 'Sin corte especificado (Todo en estante)'}</td>
            <td style="padding: 2.5px 4px; font-weight: 700; color: #475569;">Supervisor Validación:</td>
            <td style="padding: 2.5px 4px; font-weight: 700; color: #0f172a;">${completedBy}</td>
          </tr>
          <tr>
            <td style="padding: 2.5px 4px; font-weight: 700; color: #475569;">Solicitado Por:</td>
            <td style="padding: 2.5px 4px; color: #334155;">${requestedBy} (${formattedCreatedDate})</td>
            <td style="padding: 2.5px 4px; font-weight: 700; color: #475569;">Fecha Cierre:</td>
            <td style="padding: 2.5px 4px; color: #334155;">${formattedCompletedDate}</td>
          </tr>
          ${adminNotes ? `
          <tr>
            <td style="padding: 3px 4px; font-weight: 700; color: #065f46; vertical-align: top;">Obs. Cuadratura:</td>
            <td colspan="3" style="padding: 3px 6px; color: #064e3b; font-style: italic; background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 4px; font-size: 7.5pt;">
              ${adminNotes}
            </td>
          </tr>
          ` : ''}
          ${notes ? `
          <tr>
            <td style="padding: 2.5px 4px; font-weight: 700; color: #475569; vertical-align: top;">Notas Cliente:</td>
            <td colspan="3" style="padding: 2.5px 6px; color: #475569; font-style: italic; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 7.5pt;">
              ${notes}
            </td>
          </tr>
          ` : ''}
        </table>
      </div>

      <!-- RESUMEN EJECUTIVO / TARJETAS DE INDICADORES (KPIS) -->
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px;">
        <div style="background-color: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 5px; padding: 6px 8px; text-align: center;">
          <div style="font-size: 7pt; font-weight: 700; color: #475569; text-transform: uppercase;">Total SKUs Auditados</div>
          <div style="font-size: 13pt; font-weight: 800; color: #0f172a; margin-top: 1px;">${totalSkus}</div>
          <div style="font-size: 6.5pt; color: #64748b;">Líneas de producto</div>
        </div>

        <div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 5px; padding: 6px 8px; text-align: center;">
          <div style="font-size: 7pt; font-weight: 700; color: #065f46; text-transform: uppercase;">SKUs Exactos (100% OK)</div>
          <div style="font-size: 13pt; font-weight: 800; color: #059669; margin-top: 1px;">${matchedSkus}</div>
          <div style="font-size: 6.5pt; color: #047857; font-weight: 600;">${accuracyPct}% Exactitud (IRA)</div>
        </div>

        <div style="background-color: ${surplusSkus + deficitSkus === 0 ? '#f8fafc' : '#fffbeb'}; border: 1px solid ${surplusSkus + deficitSkus === 0 ? '#cbd5e1' : '#fde68a'}; border-radius: 5px; padding: 6px 8px; text-align: center;">
          <div style="font-size: 7pt; font-weight: 700; color: #92400e; text-transform: uppercase;">SKUs con Descuadre</div>
          <div style="font-size: 13pt; font-weight: 800; color: ${surplusSkus + deficitSkus === 0 ? '#059669' : '#d97706'}; margin-top: 1px;">${surplusSkus + deficitSkus}</div>
          <div style="font-size: 6.5pt; color: #b45309;">+${surplusSkus} Sobrantes &nbsp;|&nbsp; -${deficitSkus} Faltantes</div>
        </div>

        <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 5px; padding: 6px 8px; text-align: center;">
          <div style="font-size: 7pt; font-weight: 700; color: #1e40af; text-transform: uppercase;">Diferencia Neta Unidades</div>
          <div style="font-size: 13pt; font-weight: 800; color: ${netDiffUnits === 0 ? '#059669' : (netDiffUnits > 0 ? '#2563eb' : '#dc2626')}; margin-top: 1px;">
            ${netDiffUnits > 0 ? '+' : ''}${netDiffUnits}
          </div>
          <div style="font-size: 6.5pt; color: #1d4ed8;">Físico: ${totalCountedUnits} / Sist: ${totalSysUnits}</div>
        </div>
      </div>

      <!-- TABLA DETALLADA DE RESULTADOS DE CONTEO -->
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #cbd5e1; font-size: 7.8pt; margin-bottom: 12px;">
        <thead>
          <tr style="background-color: #0f172a; color: #ffffff; text-align: left; font-size: 7.2pt; text-transform: uppercase; letter-spacing: 0.5px;">
            <th style="padding: 5px 4px; width: 20px; text-align: center; border-right: 1px solid #334155;">#</th>
            <th style="padding: 5px 6px; width: 80px; border-right: 1px solid #334155;">SKU</th>
            <th style="padding: 5px 6px; width: 80px; border-right: 1px solid #334155;">Cód. Barras</th>
            <th style="padding: 5px 6px; border-right: 1px solid #334155;">Descripción del Producto</th>
            <th style="padding: 5px 4px; width: 65px; text-align: center; border-right: 1px solid #334155;">Bodega</th>
            <th style="padding: 5px 4px; width: 48px; text-align: center; background-color: #1e3a8a; border-right: 1px solid #334155;">Sist.</th>
            <th style="padding: 5px 4px; width: 50px; text-align: center; background-color: #065f46; border-right: 1px solid #334155;">Conteo</th>
            <th style="padding: 5px 4px; width: 45px; text-align: center; background-color: #334155; border-right: 1px solid #334155;">Dif.</th>
            <th style="padding: 5px 6px; width: 105px; text-align: center; border-right: 1px solid #334155;">Resultado</th>
            <th style="padding: 5px 6px; width: 90px;">Observaciones</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
        <tfoot>
          <tr style="background-color: #f1f5f9; border-top: 2px solid #0f172a; font-weight: 800; font-size: 8pt;">
            <td colspan="5" style="padding: 5px 6px; text-align: right; color: #0f172a;">TOTALES CONSOLIDADOS:</td>
            <td style="padding: 5px 4px; text-align: center; color: #1e40af; border-right: 1px solid #cbd5e1;">${totalSysUnits}</td>
            <td style="padding: 5px 4px; text-align: center; color: #0f172a; border-right: 1px solid #cbd5e1;">${totalCountedUnits}</td>
            <td style="padding: 5px 4px; text-align: center; color: ${netDiffUnits === 0 ? '#059669' : (netDiffUnits > 0 ? '#2563eb' : '#dc2626')}; border-right: 1px solid #cbd5e1;">
              ${netDiffUnits > 0 ? '+' : ''}${netDiffUnits}
            </td>
            <td colspan="2" style="padding: 5px 6px; font-size: 7pt; color: #475569;">
              ${matchedSkus} de ${totalSkus} SKUs Cuadrados Exactos
            </td>
          </tr>
        </tfoot>
      </table>

      <!-- DECLARACIÓN DE CERTIFICACIÓN Y AJUSTES -->
      <div style="background-color: #f8fafc; border-left: 3.5px solid #059669; padding: 6px 10px; margin-bottom: 12px; font-size: 7.2pt; color: #334155; border-radius: 0 4px 4px 0;">
        <strong>Certificación y Ajuste de Stock en Sistema:</strong>
        El presente documento certifica la ejecución y cierre formal de la toma física de inventario. Los conteos registrados representan la existencia física real en bodega al momento del corte. En caso de discrepancias validadas, los ajustes correspondientes han sido procesados en el sistema WMS STOCKA para asegurar la fidelidad del catálogo.
      </div>

      <!-- SECCIÓN DE FIRMAS Y VISTO BUENO -->
      <div style="page-break-inside: avoid; border-top: 1px solid #cbd5e1; padding-top: 8px; margin-top: 8px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 7.5pt;">
          <tr>
            <td style="width: 48%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 5px; vertical-align: top; background-color: #ffffff;">
              <div style="font-weight: 700; color: #0f172a; margin-bottom: 22px; text-transform: uppercase; font-size: 7pt; border-bottom: 1px solid #e2e8f0; padding-bottom: 2px;">
                Supervisor de Bodega / Auditor STOCKA
              </div>
              <div style="display: flex; flex-direction: column; gap: 3px; color: #475569; font-size: 7pt;">
                <div>Nombre: <strong>${completedBy}</strong></div>
                <div>Fecha Validación: <strong>${formattedCompletedDate}</strong></div>
                <div style="margin-top: 12px;">Firma V°B°: _________________________________________</div>
              </div>
            </td>
            <td style="width: 4%;"></td>
            <td style="width: 48%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 5px; vertical-align: top; background-color: #ffffff;">
              <div style="font-weight: 700; color: #0f172a; margin-bottom: 22px; text-transform: uppercase; font-size: 7pt; border-bottom: 1px solid #e2e8f0; padding-bottom: 2px;">
                Representante / Administración del Comercio
              </div>
              <div style="display: flex; flex-direction: column; gap: 3px; color: #475569; font-size: 7pt;">
                <div>Nombre / Comercio: <strong>${comercio}</strong></div>
                <div>Fecha Recepción: ____/____/________</div>
                <div style="margin-top: 12px;">Firma Conforme: ______________________________________</div>
              </div>
            </td>
          </tr>
        </table>
        
        <div style="text-align: center; margin-top: 8px; font-size: 6.8pt; color: #94a3b8;">
          STOCKA WMS • Informe Oficial de Auditoría y Cuadratura de Inventario Físico • Generado electrónicamente
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(container);

  try {
    const printableArea = container.querySelector('#pdf-printable-area');
    const safeCommerce = comercio.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeFolio = folio.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Informe_Resultados_Inventario_${safeFolio}_${safeCommerce}.pdf`;

    const opt = {
      margin:       [6, 8, 6, 8],
      filename:     filename,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true, scrollY: 0, scrollX: 0, logging: false },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
    };

    if (typeof html2pdf !== 'undefined') {
      await html2pdf().from(printableArea).set(opt).save();
    } else {
      window.print();
    }
  } catch (err) {
    console.error('Error al generar PDF de informe de inventario:', err);
    alert('Error al generar el archivo PDF del informe: ' + err.message);
  } finally {
    container.remove();
  }
};

/**
 * Genera y descarga el INFORME OFICIAL DE RESULTADOS DE INVENTARIO FÍSICO en formato Excel (XLSX)
 * @param {Object} req - Objeto con los datos y resultados de la solicitud de inventario
 */
window.generateInventoryReportExcel = function(req) {
  if (!req) {
    alert('Error: Datos de solicitud de inventario no disponibles.');
    return;
  }

  if (typeof XLSX === 'undefined') {
    alert('Error: Librería de exportación Excel (XLSX) no disponible.');
    return;
  }

  const folio = req.folio || `REQ-INV-${(req.id || '').substring(0, 6).toUpperCase()}`;
  const comercio = req.comercio || 'Todos';
  const warehouseName = req.warehouse_name || 'Todas las bodegas';
  const reason = req.reason || 'Auditoría / Cuadratura Periódica';
  const priority = req.priority || 'Normal';
  const completedBy = req.completed_by || 'Supervisor de Bodega';
  const notes = req.notes || '';
  const adminNotes = req.admin_notes || '';
  const status = req.status || 'Finalizada';
  const products = Array.isArray(req.products_list) ? req.products_list : [];

  const formattedCreatedDate = req.created_at ? new Date(req.created_at).toLocaleString('es-CL') : new Date().toLocaleString('es-CL');
  const formattedCompletedDate = req.completed_at ? new Date(req.completed_at).toLocaleString('es-CL') : new Date().toLocaleString('es-CL');

  // Estadísticas
  let totalSysUnits = 0;
  let totalCountedUnits = 0;
  let matchedSkus = 0;
  let surplusSkus = 0;
  let deficitSkus = 0;

  products.forEach(p => {
    const sys = Number(p.system_qty) || 0;
    const counted = (p.counted_qty !== undefined && p.counted_qty !== null) ? Number(p.counted_qty) : sys;
    const diff = (p.difference !== undefined && p.difference !== null) ? Number(p.difference) : (counted - sys);

    totalSysUnits += sys;
    totalCountedUnits += counted;

    if (diff === 0) matchedSkus++;
    else if (diff > 0) surplusSkus++;
    else if (diff < 0) deficitSkus++;
  });

  const netDiffUnits = totalCountedUnits - totalSysUnits;
  const accuracyPct = products.length > 0 ? ((matchedSkus / products.length) * 100).toFixed(1) + '%' : '100.0%';

  const excelRows = [
    ['STOCKA WMS - INFORME OFICIAL DE RESULTADOS DE INVENTARIO Y CUADRATURA'],
    ['Folio Solicitud:', folio, '', 'Estado Auditoría:', status.toUpperCase()],
    ['Comercio:', comercio, '', 'Bodega:', warehouseName],
    ['Motivo Auditoría:', reason, '', 'Prioridad:', priority],
    ['Corte Último Pedido:', req.cutoff_order || 'Sin corte especificado (Todo en estante)', '', 'Supervisor Validación:', completedBy],
    ['Fecha Solicitud:', formattedCreatedDate, '', 'Fecha Cierre:', formattedCompletedDate],
    ['Observaciones Cuadratura:', adminNotes || 'Cuadratura finalizada y validada sin observaciones adicionales.'],
    ['Instrucciones Iniciales:', notes || '-'],
    [],
    ['--- RESUMEN EJECUTIVO DE CUADRATURA ---'],
    ['Total SKUs Auditados:', products.length, '', 'SKUs Cuadrados (100% OK):', matchedSkus, '', 'Índice Exactitud (IRA):', accuracyPct],
    ['Unidades Stock Sistema:', totalSysUnits, '', 'Unidades Conteo Físico:', totalCountedUnits, '', 'Diferencia Neta Unidades:', netDiffUnits],
    ['SKUs con Sobrante (+):', surplusSkus, '', 'SKUs con Faltante (-):', deficitSkus],
    [], // Fila en blanco
    [
      'N°',
      'SKU',
      'Código de Barras',
      'Producto / Descripción',
      'Bodega',
      'Stock Teórico (Sistema)',
      'Conteo Físico Real',
      'Diferencia (Físico - Sistema)',
      'Resultado Cuadratura',
      'Observaciones / Causa'
    ]
  ];

  const dataStartRow = excelRows.length + 1; // 1-indexed

  products.forEach((p, idx) => {
    const sysQty = (p.system_qty !== undefined && p.system_qty !== null) ? Number(p.system_qty) : 0;
    const counted = (p.counted_qty !== undefined && p.counted_qty !== null) ? Number(p.counted_qty) : sysQty;
    const diff = (p.difference !== undefined && p.difference !== null) ? Number(p.difference) : (counted - sysQty);
    const pNotes = p.notes || '';

    let resStr = 'CUADRADO (OK)';
    if (diff > 0) resStr = `SOBRANTE (+${diff})`;
    else if (diff < 0) resStr = `FALTANTE (${diff})`;

    excelRows.push([
      idx + 1,
      p.sku || '',
      p.barcode || p.codigo_barra || '',
      p.name || '',
      p.warehouse_name || warehouseName || '',
      sysQty,
      counted,
      diff,
      resStr,
      pNotes
    ]);
  });

  const dataEndRow = dataStartRow + products.length - 1;

  // Fila de totales
  excelRows.push([]);
  excelRows.push([
    '', '', '', '', 'TOTALES CONSOLIDADOS:',
    { f: `SUM(F${dataStartRow}:F${dataEndRow})` },
    { f: `SUM(G${dataStartRow}:G${dataEndRow})` },
    { f: `SUM(H${dataStartRow}:H${dataEndRow})` },
    `${matchedSkus} de ${products.length} SKUs Cuadrados`,
    ''
  ]);

  excelRows.push([]);
  excelRows.push(['Supervisor Bodega:', completedBy, 'Firma V°B°:', '___________________________', 'Fecha:', formattedCompletedDate]);
  excelRows.push(['Representante Comercio:', comercio, 'Firma Conforme:', '___________________________', 'Fecha:', '____/____/________']);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(excelRows);

  ws['!cols'] = [
    { wch: 6 },  // N°
    { wch: 18 }, // SKU
    { wch: 18 }, // Código de Barras
    { wch: 40 }, // Producto
    { wch: 20 }, // Bodega
    { wch: 18 }, // Stock Sistema
    { wch: 18 }, // Conteo Real
    { wch: 18 }, // Diferencia
    { wch: 22 }, // Resultado
    { wch: 35 }  // Observaciones
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Informe Resultados');

  const safeCommerce = comercio.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeFolio = folio.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `Informe_Resultados_Inventario_${safeFolio}_${safeCommerce}.xlsx`;

  XLSX.writeFile(wb, filename);
};

/**
 * Genera y descarga la HOJA OFICIAL DE LEVANTAMIENTO DE DIMENSIONES, PESO Y CUBICAJE en formato PDF
 * Diseñada en orientación horizontal (Landscape) con cuadrículas para medición física en bodega
 * @param {Object} options - Parámetros de la solicitud de dimensiones
 */
window.generateProductDimensionsPdf = async function(options) {
  if (!options) {
    alert('Error: Datos de solicitud de dimensiones no disponibles.');
    return;
  }

  const folio = options.folio || `DIM-${new Date().toISOString().slice(2,10).replace(/-/g,'')}-${Math.floor(100 + Math.random() * 900)}`;
  const comercio = options.comercio || 'Todos los Comercios';
  const warehouseName = options.warehouseName || 'Todas las bodegas';
  const scopeLabel = options.scopeLabel || 'Catálogo de Productos';
  const requestedBy = options.requestedBy || 'Administración WMS';
  const notes = options.notes || 'Medir largo, ancho y alto en centímetros del empaque cerrado final. Pesar en balanza en kilogramos.';
  const products = Array.isArray(options.products) ? options.products : [];

  const formattedDate = new Date().toLocaleString('es-CL', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  // Crear contenedor temporal fuera de pantalla (A4 Landscape = 297mm x 210mm)
  const container = document.createElement('div');
  container.id = 'product-dimensions-pdf-container';
  container.style.position = 'fixed';
  container.style.top = '-99999px';
  container.style.left = '-99999px';
  container.style.width = '297mm'; // A4 Landscape
  container.style.backgroundColor = '#ffffff';
  container.style.color = '#1e293b';
  container.style.fontFamily = "'Inter', Arial, sans-serif";
  container.style.padding = '10mm 12mm';
  container.style.boxSizing = 'border-box';
  container.style.fontSize = '8.5pt';
  container.style.lineHeight = '1.25';

  // Renderizar filas de productos
  let rowsHtml = '';
  if (products.length === 0) {
    rowsHtml = `
      <tr>
        <td colspan="11" style="text-align: center; padding: 25px; color: #64748b; font-style: italic;">
          No se encontraron productos para los criterios seleccionados.
        </td>
      </tr>
    `;
  } else {
    products.forEach((p, idx) => {
      const isEven = idx % 2 === 0;
      const bg = isEven ? '#ffffff' : '#f8fafc';
      const barcode = p.barcode || p.codigo_barra || '-';
      const pCommerce = p.comercio || comercio;
      const curL = (p.length !== undefined && p.length !== null && p.length > 0) ? p.length : '';
      const curW = (p.width !== undefined && p.width !== null && p.width > 0) ? p.width : '';
      const curH = (p.height !== undefined && p.height !== null && p.height > 0) ? p.height : '';
      const curKg = (p.weight !== undefined && p.weight !== null && p.weight > 0) ? p.weight : '';
      const curVol = (p.volumen !== undefined && p.volumen !== null && p.volumen > 0) ? Number(p.volumen).toFixed(5) : '';
      const curPkg = p.packaging_type || p.embalaje || '';

      rowsHtml += `
        <tr style="background-color: ${bg}; border-bottom: 1px solid #cbd5e1; page-break-inside: avoid;">
          <td style="padding: 5px 3px; text-align: center; font-weight: 600; color: #64748b; font-size: 8pt; border-right: 1px solid #e2e8f0;">${idx + 1}</td>
          <td style="padding: 5px 6px; font-family: 'Courier New', monospace; font-weight: 700; color: #0f172a; font-size: 8pt; border-right: 1px solid #e2e8f0; white-space: nowrap;">${p.sku || '-'}</td>
          <td style="padding: 5px 6px; font-family: 'Courier New', monospace; color: #475569; font-size: 7.5pt; border-right: 1px solid #e2e8f0;">${barcode}</td>
          <td style="padding: 5px 6px; color: #0f172a; font-size: 8pt; font-weight: 500; border-right: 1px solid #e2e8f0; line-height: 1.2;">
            ${p.name || 'Sin nombre'}
            ${options.comercio === 'Todos los Comercios' && pCommerce ? `<div style="font-size: 7pt; color: #64748b; font-weight: 600;">[${pCommerce}]</div>` : ''}
          </td>
          <!-- Casilla Largo (cm) -->
          <td style="padding: 3px 4px; text-align: center; border-right: 1px solid #cbd5e1; width: 62px; background-color: #ffffff;">
            <div style="border: 1.5px solid #64748b; border-radius: 3px; height: 22px; width: 100%; box-sizing: border-box; display: flex; align-items: center; justify-content: center; font-weight: 700; color: #0f172a; font-size: 8pt; background: #fff;">
              ${curL}
            </div>
          </td>
          <!-- Casilla Ancho (cm) -->
          <td style="padding: 3px 4px; text-align: center; border-right: 1px solid #cbd5e1; width: 62px; background-color: #ffffff;">
            <div style="border: 1.5px solid #64748b; border-radius: 3px; height: 22px; width: 100%; box-sizing: border-box; display: flex; align-items: center; justify-content: center; font-weight: 700; color: #0f172a; font-size: 8pt; background: #fff;">
              ${curW}
            </div>
          </td>
          <!-- Casilla Alto (cm) -->
          <td style="padding: 3px 4px; text-align: center; border-right: 1px solid #cbd5e1; width: 62px; background-color: #ffffff;">
            <div style="border: 1.5px solid #64748b; border-radius: 3px; height: 22px; width: 100%; box-sizing: border-box; display: flex; align-items: center; justify-content: center; font-weight: 700; color: #0f172a; font-size: 8pt; background: #fff;">
              ${curH}
            </div>
          </td>
          <!-- Casilla Peso (kg) -->
          <td style="padding: 3px 4px; text-align: center; border-right: 1px solid #cbd5e1; width: 65px; background-color: #ffffff;">
            <div style="border: 1.5px solid #059669; border-radius: 3px; height: 22px; width: 100%; box-sizing: border-box; display: flex; align-items: center; justify-content: center; font-weight: 700; color: #065f46; font-size: 8pt; background: #ecfdf5;">
              ${curKg}
            </div>
          </td>
          <!-- Casilla Volumen Calc (m3) -->
          <td style="padding: 3px 4px; text-align: center; border-right: 1px solid #cbd5e1; width: 70px; background-color: #f8fafc;">
            <div style="border: 1.5px dashed #cbd5e1; border-radius: 3px; height: 22px; width: 100%; box-sizing: border-box; display: flex; align-items: center; justify-content: center; font-size: 7.5pt; color: #475569; font-family: monospace;">
              ${curVol}
            </div>
          </td>
          <!-- Casilla Tipo Embalaje -->
          <td style="padding: 3px 5px; width: 85px; border-right: 1px solid #cbd5e1; background-color: #ffffff;">
            <div style="border-bottom: 1px dotted #64748b; height: 18px; font-size: 7.5pt; color: #334155; padding-top: 2px;">
              ${curPkg}
            </div>
          </td>
          <!-- Casilla Observaciones -->
          <td style="padding: 3px 6px; width: 110px; background-color: #ffffff;">
            <div style="border-bottom: 1px dotted #94a3b8; height: 18px; margin-top: 2px; font-size: 7pt; color: #64748b;">
              ${p.notes || ''}
            </div>
          </td>
        </tr>
      `;
    });
  }

  container.innerHTML = `
    <div id="pdf-dimensions-area" style="width: 100%;">
      <!-- ENCABEZADO INSTITUCIONAL -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2.5px solid #0f172a; padding-bottom: 8px; margin-bottom: 10px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <img src="img/newlogotransp.png" alt="STOCKA Logo" style="height: 40px; width: auto; object-fit: contain;" onerror="this.onerror=null; this.src='https://cdn.shopify.com/s/files/1/0625/6141/9483/files/newlogotransp.png?v=1779852093';">
          <div>
            <div style="display: inline-block; background-color: #059669; color: #ffffff; padding: 2px 7px; border-radius: 3px; font-size: 7pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">
              Control Físico y Cubicaje de Catálogo
            </div>
            <h1 style="margin: 0; font-size: 13pt; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; text-transform: uppercase;">
              Hoja de Toma de Dimensiones, Peso y Embalaje
            </h1>
            <p style="margin: 1px 0 0 0; font-size: 7.5pt; color: #64748b; font-weight: 500;">
              STOCKA WMS & Fulfillment • Registro de Medidas Maestras para Cubicaje y Costeo de Despachos
            </p>
          </div>
        </div>
        <div style="text-align: right;">
          <div style="display: inline-block; background-color: #0f172a; color: #ffffff; padding: 4px 10px; border-radius: 4px; font-weight: 800; font-size: 9.5pt; font-family: monospace; letter-spacing: 0.5px;">
            ${folio}
          </div>
          <div style="font-size: 7.5pt; color: #64748b; margin-top: 3px;">
            Emisión: <strong>${formattedDate}</strong>
          </div>
          <div style="font-size: 7pt; color: #059669; font-weight: 700; margin-top: 1px;">
            TOTAL: ${products.length} ARTÍCULOS
          </div>
        </div>
      </div>

      <!-- METADATOS DEL LEVANTAMIENTO -->
      <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px 10px; margin-bottom: 9px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 8pt;">
          <tr>
            <td style="padding: 2px 4px; width: 12%; font-weight: 700; color: #475569;">Cliente / Comercio:</td>
            <td style="padding: 2px 4px; width: 38%; font-weight: 700; color: #0f172a; font-size: 8.5pt;">${comercio}</td>
            <td style="padding: 2px 4px; width: 12%; font-weight: 700; color: #475569;">Bodega Asignada:</td>
            <td style="padding: 2px 4px; width: 38%; font-weight: 600; color: #0f172a;">${warehouseName}</td>
          </tr>
          <tr>
            <td style="padding: 2px 4px; font-weight: 700; color: #475569;">Alcance / Filtro:</td>
            <td style="padding: 2px 4px; font-weight: 600; color: #0f172a;">${scopeLabel}</td>
            <td style="padding: 2px 4px; font-weight: 700; color: #475569;">Solicitado Por:</td>
            <td style="padding: 2px 4px; color: #1e293b;">${requestedBy}</td>
          </tr>
          ${notes ? `
          <tr>
            <td style="padding: 2px 4px; font-weight: 700; color: #475569; vertical-align: top;">Instrucciones Bodega:</td>
            <td colspan="3" style="padding: 2px 6px; color: #334155; font-style: italic; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 7.5pt;">
              ${notes}
            </td>
          </tr>
          ` : ''}
        </table>
      </div>

      <!-- GUÍA OPERATIVA RÁPIDA -->
      <div style="background-color: #ecfdf5; border-left: 3.5px solid #059669; padding: 5px 8px; margin-bottom: 9px; font-size: 7.2pt; color: #065f46; border-radius: 0 4px 4px 0; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <strong>Norma de Medición:</strong> 
          1. <strong>Dimensiones:</strong> Medir con huincha en <strong>Centímetros (cm)</strong> el empaque final cerrado (Largo x Ancho x Alto). &nbsp;|&nbsp; 
          2. <strong>Peso:</strong> Pesar en balanza en <strong>Kilogramos (kg)</strong> con 3 decimales (ej: 0.350 kg). &nbsp;|&nbsp; 
          3. <strong>Embalaje:</strong> Indicar <em>Caja (CJ), Sobre (SB), Bolsa (BL), Tubo (TB) o Granel (GR)</em>.
        </div>
      </div>

      <!-- TABLA PRINCIPAL DE REGISTRO DE DIMENSIONES -->
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #cbd5e1; font-size: 7.8pt; margin-bottom: 10px;">
        <thead>
          <tr style="background-color: #0f172a; color: #ffffff; text-align: left; font-size: 7.2pt; text-transform: uppercase; letter-spacing: 0.5px;">
            <th style="padding: 5px 3px; width: 20px; text-align: center; border-right: 1px solid #334155;">#</th>
            <th style="padding: 5px 6px; width: 85px; border-right: 1px solid #334155;">SKU</th>
            <th style="padding: 5px 6px; width: 85px; border-right: 1px solid #334155;">Cód. Barras</th>
            <th style="padding: 5px 6px; border-right: 1px solid #334155;">Descripción del Producto</th>
            <th style="padding: 5px 4px; width: 62px; text-align: center; background-color: #1e3a8a; border-right: 1px solid #334155;">Largo (cm)</th>
            <th style="padding: 5px 4px; width: 62px; text-align: center; background-color: #1e3a8a; border-right: 1px solid #334155;">Ancho (cm)</th>
            <th style="padding: 5px 4px; width: 62px; text-align: center; background-color: #1e3a8a; border-right: 1px solid #334155;">Alto (cm)</th>
            <th style="padding: 5px 4px; width: 65px; text-align: center; background-color: #065f46; border-right: 1px solid #334155;">Peso (kg)</th>
            <th style="padding: 5px 4px; width: 70px; text-align: center; background-color: #334155; border-right: 1px solid #334155;">Vol. (m³)</th>
            <th style="padding: 5px 5px; width: 85px; text-align: center; border-right: 1px solid #334155;">Embalaje</th>
            <th style="padding: 5px 6px; width: 110px;">Notas / Frágil</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <!-- SECCIÓN DE FIRMAS Y VISTO BUENO -->
      <div style="page-break-inside: avoid; border-top: 1px solid #cbd5e1; padding-top: 6px; margin-top: 6px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 7.5pt;">
          <tr>
            <td style="width: 48%; padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 5px; vertical-align: top; background-color: #ffffff;">
              <div style="font-weight: 700; color: #0f172a; margin-bottom: 20px; text-transform: uppercase; font-size: 7pt; border-bottom: 1px solid #e2e8f0; padding-bottom: 2px;">
                Responsable del Levantamiento / Pesaje (Bodega)
              </div>
              <div style="display: flex; flex-direction: column; gap: 2px; color: #475569; font-size: 7pt;">
                <div>Nombre: _____________________________________________</div>
                <div>RUT: _______________________ Fecha: ____/____/________</div>
                <div style="margin-top: 10px;">Firma: ______________________________________________</div>
              </div>
            </td>
            <td style="width: 4%;"></td>
            <td style="width: 48%; padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 5px; vertical-align: top; background-color: #ffffff;">
              <div style="font-weight: 700; color: #0f172a; margin-bottom: 20px; text-transform: uppercase; font-size: 7pt; border-bottom: 1px solid #e2e8f0; padding-bottom: 2px;">
                Validación y Carga en Sistema (Supervisor WMS STOCKA)
              </div>
              <div style="display: flex; flex-direction: column; gap: 2px; color: #475569; font-size: 7pt;">
                <div>Nombre: _____________________________________________</div>
                <div>Hora Inicio: _____:_____ &nbsp;&nbsp;|&nbsp;&nbsp; Hora Fin: _____:_____</div>
                <div style="margin-top: 10px;">Firma V°B°: _________________________________________</div>
              </div>
            </td>
          </tr>
        </table>
        
        <div style="text-align: center; margin-top: 6px; font-size: 6.8pt; color: #94a3b8;">
          STOCKA WMS • Documento Oficial de Levantamiento de Medidas, Peso y Cubicaje • Impreso para uso en bodega
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(container);

  try {
    const printableArea = container.querySelector('#pdf-dimensions-area');
    const safeCommerce = comercio.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeFolio = folio.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Hoja_Dimensiones_${safeFolio}_${safeCommerce}.pdf`;

    const opt = {
      margin:       [6, 8, 6, 8],
      filename:     filename,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true, scrollY: 0, scrollX: 0, logging: false },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'landscape' },
      pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
    };

    if (typeof html2pdf !== 'undefined') {
      await html2pdf().from(printableArea).set(opt).save();
    } else {
      window.print();
    }
  } catch (err) {
    console.error('Error al generar PDF de dimensiones:', err);
    alert('Error al generar el archivo PDF: ' + err.message);
  } finally {
    container.remove();
  }
};

/**
 * Genera y descarga la PLANILLA EXCEL (XLSX) para el levantamiento y carga masiva de dimensiones
 * @param {Object} options - Parámetros de la solicitud de dimensiones
 */
window.generateProductDimensionsExcel = function(options) {
  if (!options) {
    alert('Error: Datos de solicitud de dimensiones no disponibles.');
    return;
  }

  if (typeof XLSX === 'undefined') {
    alert('Error: Librería de exportación Excel (XLSX) no disponible.');
    return;
  }

  const folio = options.folio || `DIM-${new Date().toISOString().slice(2,10).replace(/-/g,'')}-${Math.floor(100 + Math.random() * 900)}`;
  const comercio = options.comercio || 'Todos los Comercios';
  const warehouseName = options.warehouseName || 'Todas las bodegas';
  const scopeLabel = options.scopeLabel || 'Catálogo de Productos';
  const notes = options.notes || 'Completar las columnas Largo_cm, Ancho_cm, Alto_cm y Peso_kg para actualizar el catálogo maestro.';
  const products = Array.isArray(options.products) ? options.products : [];

  const formattedDate = new Date().toLocaleString('es-CL');

  // Construir filas del libro Excel
  const excelRows = [
    ['STOCKA WMS - PLANILLA DE LEVANTAMIENTO Y CARGA DE DIMENSIONES DE PRODUCTOS'],
    ['Folio Solicitud:', folio, '', 'Fecha Emisión:', formattedDate],
    ['Comercio:', comercio, '', 'Bodega Asignada:', warehouseName],
    ['Alcance Catálogo:', scopeLabel, '', 'Total SKUs:', products.length],
    ['Instrucciones:', notes],
    [], // Fila en blanco
    [
      'N°',
      'SKU',
      'Codigo_Barras',
      'Producto_Nombre',
      'Comercio',
      'Largo_cm',
      'Ancho_cm',
      'Alto_cm',
      'Peso_kg',
      'Volumen_m3',
      'Tipo_Embalaje',
      'Observaciones'
    ]
  ];

  const dataStartRow = excelRows.length + 1; // 1-indexed

  products.forEach((p, idx) => {
    const rowIdx = dataStartRow + idx;
    const curL = (p.length !== undefined && p.length !== null && p.length > 0) ? Number(p.length) : '';
    const curW = (p.width !== undefined && p.width !== null && p.width > 0) ? Number(p.width) : '';
    const curH = (p.height !== undefined && p.height !== null && p.height > 0) ? Number(p.height) : '';
    const curKg = (p.weight !== undefined && p.weight !== null && p.weight > 0) ? Number(p.weight) : '';
    const curPkg = p.packaging_type || p.embalaje || '';
    const pCommerce = p.comercio || comercio;

    // Fórmula de Excel para cálculo de volumen en m3 a partir de F(Largo), G(Ancho), H(Alto)
    const volFormula = { f: `IF(AND(F${rowIdx}>0, G${rowIdx}>0, H${rowIdx}>0), ROUND((F${rowIdx}*G${rowIdx}*H${rowIdx})/1000000, 6), "")` };

    excelRows.push([
      idx + 1,
      p.sku || '',
      p.barcode || p.codigo_barra || '',
      p.name || '',
      pCommerce,
      curL,
      curW,
      curH,
      curKg,
      volFormula,
      curPkg,
      p.notes || ''
    ]);
  });

  excelRows.push([]);
  excelRows.push(['Responsable Medición:', '___________________________', 'Firma:', '___________________________', 'Fecha:', '____/____/________']);
  excelRows.push(['Supervisor Validación:', '___________________________', 'Firma V°B°:', '___________________________', 'Fecha:', '____/____/________']);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(excelRows);

  ws['!cols'] = [
    { wch: 6 },  // N°
    { wch: 18 }, // SKU
    { wch: 18 }, // Codigo_Barras
    { wch: 40 }, // Producto_Nombre
    { wch: 20 }, // Comercio
    { wch: 14 }, // Largo_cm
    { wch: 14 }, // Ancho_cm
    { wch: 14 }, // Alto_cm
    { wch: 14 }, // Peso_kg
    { wch: 16 }, // Volumen_m3
    { wch: 18 }, // Tipo_Embalaje
    { wch: 30 }  // Observaciones
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Dimensiones Productos');

  const safeCommerce = comercio.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeFolio = folio.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `Planilla_Dimensiones_${safeFolio}_${safeCommerce}.xlsx`;

  XLSX.writeFile(wb, filename);
};
