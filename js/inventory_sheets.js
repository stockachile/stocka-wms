// js/inventory_sheets.js - Generador de Hojas de Conteo de Inventario Físico (PDF & Excel) para STOCKA WMS

/**
 * Enriquece la lista de productos de una solicitud de inventario con sus códigos de barra
 * desde memoria o consultando Supabase si faltaban al momento de emitir la solicitud.
 * @param {Object} req - Objeto con los datos de la solicitud de inventario
 * @returns {Promise<Array>} Lista de productos enriquecidos
 */
window.enrichInventoryProductsBarcodes = async function(req) {
  if (!req) return [];
  const products = Array.isArray(req.products_list) ? req.products_list : [];
  if (products.length === 0) return products;

  // Verificar si hay productos que carecen de código de barras
  const needsEnrich = products.some(p => !p.barcode || p.barcode === '-' || String(p.barcode).trim() === '');
  if (!needsEnrich) return products;

  try {
    const barcodeMap = new Map();

    // 1. Revisar cachés locales en memoria si están disponibles
    const localCaches = [
      window.cachedInventoryProducts,
      window.cachedActiveProducts,
      window.decCatalogProductsCache,
      window.cachedAdminProducts
    ];

    localCaches.forEach(cache => {
      if (Array.isArray(cache)) {
        cache.forEach(item => {
          const bc = item.barcode || item.codigo_barra || item.codebar;
          if (bc && String(bc).trim() && String(bc).trim() !== '-') {
            const clean = String(bc).trim();
            if (item.id) barcodeMap.set(String(item.id), clean);
            if (item.sku) barcodeMap.set(String(item.sku).toUpperCase().trim(), clean);
          }
        });
      }
    });

    // Asignar desde cachés en memoria
    products.forEach(p => {
      if (!p.barcode || p.barcode === '-' || String(p.barcode).trim() === '') {
        const fromCache = (p.id && barcodeMap.get(String(p.id))) || (p.sku && barcodeMap.get(String(p.sku).toUpperCase().trim()));
        if (fromCache) {
          p.barcode = fromCache;
        }
      }
    });

    // 2. Para los que aún falten, consultar directamente a la base de datos Supabase
    const stillMissing = products.filter(p => !p.barcode || p.barcode === '-' || String(p.barcode).trim() === '');
    if (stillMissing.length > 0 && typeof supabase !== 'undefined') {
      const idsToQuery = stillMissing.map(p => p.id).filter(Boolean);
      const skusToQuery = stillMissing.map(p => p.sku).filter(Boolean);

      let query = supabase.from('products').select('id, sku, barcode, barcode_wms');
      if (req.comercio && req.comercio !== 'Todos' && req.comercio !== 'no asignado') {
        query = query.ilike('comercio', req.comercio.trim());
      }

      if (idsToQuery.length > 0) {
        query = query.in('id', idsToQuery);
      } else if (skusToQuery.length > 0) {
        query = query.in('sku', skusToQuery);
      }

      const { data: dbProds, error: dbErr } = await query;
      if (!dbErr && Array.isArray(dbProds)) {
        dbProds.forEach(item => {
          const bc = item.barcode || item.barcode_wms;
          if (bc && String(bc).trim() && String(bc).trim() !== '-') {
            const clean = String(bc).trim();
            if (item.id) barcodeMap.set(String(item.id), clean);
            if (item.sku) barcodeMap.set(String(item.sku).toUpperCase().trim(), clean);
          }
        });
      }

      // Si quedan sin coincidencia por id, reintentar por SKU
      const remainingMissing = products.filter(p => !p.barcode || p.barcode === '-' || String(p.barcode).trim() === '');
      if (remainingMissing.length > 0 && skusToQuery.length > 0) {
        let skuQuery = supabase.from('products').select('id, sku, barcode, barcode_wms').in('sku', skusToQuery);
        if (req.comercio && req.comercio !== 'Todos' && req.comercio !== 'no asignado') {
          skuQuery = skuQuery.ilike('comercio', req.comercio.trim());
        }
        const { data: skuData } = await skuQuery;
        if (Array.isArray(skuData)) {
          skuData.forEach(item => {
            const bc = item.barcode || item.barcode_wms;
            if (bc && String(bc).trim() && String(bc).trim() !== '-') {
              const clean = String(bc).trim();
              if (item.sku) barcodeMap.set(String(item.sku).toUpperCase().trim(), clean);
              if (item.id) barcodeMap.set(String(item.id), clean);
            }
          });
        }
      }

      // Aplicar códigos encontrados a los productos
      products.forEach(p => {
        if (!p.barcode || p.barcode === '-' || String(p.barcode).trim() === '') {
          const found = (p.id && barcodeMap.get(String(p.id))) || (p.sku && barcodeMap.get(String(p.sku).toUpperCase().trim()));
          if (found) {
            p.barcode = found;
          }
        }
      });
    }
  } catch (err) {
    console.warn('[enrichInventoryProductsBarcodes] Error al enriquecer códigos de barra:', err);
  }

  return products;
};

/**
 * Obtiene la lista de bodegas distintas presentes en una solicitud de inventario
 * @param {Object} req - Solicitud de inventario
 * @returns {Array<{id: string|null, name: string, count: number}>}
 */
window.getRequestDistinctWarehouses = function(req) {
  if (!req || !Array.isArray(req.products_list)) return [];
  const whMap = new Map();
  req.products_list.forEach(p => {
    const whName = (p.warehouse_name || req.warehouse_name || 'Bodega Principal').trim();
    if (!whMap.has(whName)) {
      whMap.set(whName, { id: p.warehouse_id || null, name: whName, count: 0 });
    }
    whMap.get(whName).count++;
  });
  return Array.from(whMap.values());
};

/**
 * Genera y descarga la Hoja Oficial de Toma de Inventario Físico en formato PDF
 * Diseñada específicamente con cuadrícula y espacio para conteo manual en terreno.
 * Permite emitir el documento Consolidado o individual por Bodega física.
 * @param {Object} req - Objeto con los datos de la solicitud de inventario
 * @param {string|Object|null} targetWarehouse - Filtro opcional de bodega ('all', objeto {id, name} o string de nombre)
 */
window.generateInventoryCountPdf = async function(req, targetWarehouse = null) {
  if (!req) {
    alert('Error: Datos de solicitud de inventario no disponibles.');
    return;
  }

  // Enriquecer códigos de barra faltantes antes de generar la hoja
  if (typeof window.enrichInventoryProductsBarcodes === 'function') {
    await window.enrichInventoryProductsBarcodes(req);
  }

  const folio = req.folio || `REQ-INV-${(req.id || '').substring(0, 6).toUpperCase()}`;
  const comercio = req.comercio || 'Todos';
  const reason = req.reason || 'Auditoría / Cuadratura Periódica';
  const priority = req.priority || 'Normal';
  const typeStr = (req.type === 'selectivo' || req.type === 'parcial') ? 'Inventario Selectivo (Parcial)' : 'Inventario Completo (General)';
  const requestedBy = req.requested_by || 'Cliente WMS';
  const notes = req.notes || 'Sin observaciones adicionales.';
  const allProducts = Array.isArray(req.products_list) ? req.products_list : [];

  let products = allProducts;
  let isFilteredWh = false;
  let filterWhName = '';

  if (targetWarehouse && targetWarehouse !== 'all') {
    filterWhName = typeof targetWarehouse === 'string' ? targetWarehouse : (targetWarehouse.name || '');
    products = allProducts.filter(p => {
      if (typeof targetWarehouse === 'object' && targetWarehouse.id && p.warehouse_id) {
        return String(p.warehouse_id) === String(targetWarehouse.id);
      }
      return (p.warehouse_name || '').toLowerCase().trim() === filterWhName.toLowerCase().trim();
    });
    isFilteredWh = true;
  }

  const warehouseName = isFilteredWh ? filterWhName : (req.warehouse_name || 'Todas las bodegas');
  const warehouseDisplay = isFilteredWh ? `${filterWhName} (Hoja Exclusiva de Bodega)` : `${warehouseName} (Consolidado)`;
  const sheetHeaderTitle = isFilteredWh ? `Hoja de Toma de Inventario - ${filterWhName}` : `Hoja de Toma de Inventario Físico (Consolidado)`;

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
        <td colspan="9" style="text-align: center; padding: 20px; color: #64748b; font-style: italic;">
          No se especificaron productos individuales en la solicitud.
        </td>
      </tr>
    `;
  } else {
    products.forEach((p, idx) => {
      const isEven = idx % 2 === 0;
      const bg = isEven ? '#ffffff' : '#f8fafc';
      const barcode = p.barcode || p.codigo_barra || '';
      const whName = p.warehouse_name || warehouseName || 'Principal';
      const sysQty = (p.system_qty !== undefined && p.system_qty !== null) ? p.system_qty : (p.quantity || 0);

      const barcodeHtml = (barcode && barcode !== '-')
        ? `<div style="font-family: 'Courier New', monospace; color: #475569; font-size: 7.5pt; line-height: 1.2; margin-top: 3px; word-break: break-all;">
             <span style="color: #64748b; font-size: 6.5pt; font-weight: 700; text-transform: uppercase;">CB:</span> ${barcode}
           </div>`
        : `<div style="font-family: 'Courier New', monospace; color: #94a3b8; font-size: 7pt; line-height: 1.2; margin-top: 2px; font-style: italic;">Sin cód. barras</div>`;

      rowsHtml += `
        <tr style="background-color: ${bg}; border-bottom: 1px solid #e2e8f0; page-break-inside: avoid;">
          <td style="padding: 6px 4px; text-align: center; font-weight: 600; color: #64748b; font-size: 8pt; border-right: 1px solid #e2e8f0;">${idx + 1}</td>
          <!-- SKU y Código de Barras juntos en la misma columna (uno sobre el otro) -->
          <td style="padding: 5px 6px; border-right: 1px solid #e2e8f0; vertical-align: middle;">
            <div style="font-family: 'Courier New', monospace; font-weight: 700; color: #0f172a; font-size: 8.5pt; line-height: 1.2; word-break: break-all;">${p.sku || '-'}</div>
            ${barcodeHtml}
          </td>
          <td style="padding: 6px 6px; color: #0f172a; font-size: 8.5pt; font-weight: 500; border-right: 1px solid #e2e8f0; line-height: 1.25;">${p.name || 'Sin nombre'}</td>
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
            <h1 style="margin: 0; font-size: 13.5pt; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; text-transform: uppercase;">
              ${sheetHeaderTitle}
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
            <td style="padding: 3px 6px; width: 36%; font-weight: 700; color: ${isFilteredWh ? '#1e40af' : '#0f172a'};">${warehouseDisplay}</td>
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
            <th style="padding: 6px 6px; width: 105px; border-right: 1px solid #334155;">SKU / Cód. Barras</th>
            <th style="padding: 6px 6px; border-right: 1px solid #334155;">Descripción del Producto</th>
            <th style="padding: 6px 4px; width: 70px; text-align: center; border-right: 1px solid #334155;">Bodega</th>
            <th style="padding: 6px 4px; width: 48px; text-align: center; background-color: #1e3a8a; border-right: 1px solid #334155;">Sist.</th>
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
    const safeWh = isFilteredWh ? filterWhName.replace(/[^a-zA-Z0-9_-]/g, '_') : 'Consolidado';
    const filename = `Hoja_Inventario_${safeFolio}_${safeWh}_${safeCommerce}.pdf`;

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
 * Permite emitir el documento Consolidado o individual por Bodega física.
 * @param {Object} req - Objeto con los datos de la solicitud de inventario
 * @param {string|Object|null} targetWarehouse - Filtro opcional de bodega ('all', objeto {id, name} o string de nombre)
 */
window.generateInventoryCountExcel = async function(req, targetWarehouse = null) {
  if (!req) {
    alert('Error: Datos de solicitud de inventario no disponibles.');
    return;
  }

  if (typeof XLSX === 'undefined') {
    alert('Error: Librería de exportación Excel (XLSX) no disponible.');
    return;
  }

  // Enriquecer códigos de barra faltantes antes de generar la planilla
  if (typeof window.enrichInventoryProductsBarcodes === 'function') {
    await window.enrichInventoryProductsBarcodes(req);
  }

  const folio = req.folio || `REQ-INV-${(req.id || '').substring(0, 6).toUpperCase()}`;
  const comercio = req.comercio || 'Todos';
  const reason = req.reason || 'Auditoría / Cuadratura Periódica';
  const priority = req.priority || 'Normal';
  const notes = req.notes || '';
  const allProducts = Array.isArray(req.products_list) ? req.products_list : [];

  let products = allProducts;
  let isFilteredWh = false;
  let filterWhName = '';

  if (targetWarehouse && targetWarehouse !== 'all') {
    filterWhName = typeof targetWarehouse === 'string' ? targetWarehouse : (targetWarehouse.name || '');
    products = allProducts.filter(p => {
      if (typeof targetWarehouse === 'object' && targetWarehouse.id && p.warehouse_id) {
        return String(p.warehouse_id) === String(targetWarehouse.id);
      }
      return (p.warehouse_name || '').toLowerCase().trim() === filterWhName.toLowerCase().trim();
    });
    isFilteredWh = true;
  }

  const warehouseName = isFilteredWh ? `${filterWhName} (Exclusiva)` : (req.warehouse_name || 'Todas las bodegas (Consolidado)');
  const formattedDate = req.created_at ? new Date(req.created_at).toLocaleString('es-CL') : new Date().toLocaleString('es-CL');

  // Construir filas del libro Excel
  const excelRows = [
    [isFilteredWh ? `STOCKA WMS - HOJA DE CONTEO FÍSICO (${filterWhName.toUpperCase()})` : 'STOCKA WMS - HOJA DE CONTEO FÍSICO (CONSOLIDADO)'],
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

  XLSX.utils.book_append_sheet(wb, ws, isFilteredWh ? filterWhName.substring(0, 31) : 'Toma Consolidada');

  const safeCommerce = comercio.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeFolio = folio.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeWh = isFilteredWh ? filterWhName.replace(/[^a-zA-Z0-9_-]/g, '_') : 'Consolidado';
  const filename = `Planilla_Toma_Inventario_${safeFolio}_${safeWh}_${safeCommerce}.xlsx`;

  XLSX.writeFile(wb, filename);
};

/**
 * Modal interactivo para seleccionar la emisión de Hojas de Inventario (PDF y Excel):
 * Permite descargar el documento Consolidado o la hoja individual de cada bodega física.
 * @param {Object} req - Solicitud de inventario
 * @param {string} defaultFormat - 'pdf' o 'excel'
 */
window.openInventoryPdfOptionsModal = function(req, defaultFormat = 'pdf') {
  if (!req) return;
  const distinctWhs = window.getRequestDistinctWarehouses(req);
  if (distinctWhs.length <= 1) {
    if (defaultFormat === 'excel') {
      window.generateInventoryCountExcel(req);
    } else {
      window.generateInventoryCountPdf(req);
    }
    return;
  }

  let existingModal = document.getElementById('modal-inventory-pdf-options');
  if (existingModal) existingModal.remove();

  const folio = req.folio || req.id?.substring(0, 8) || 'S/F';
  const totalSkus = (req.products_list || []).length;

  const modal = document.createElement('div');
  modal.id = 'modal-inventory-pdf-options';
  modal.className = 'modal-overlay active';
  modal.style.zIndex = '10005';

  modal.innerHTML = `
    <div class="modal-content" style="max-width: 620px; padding: 0; display: flex; flex-direction: column; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); box-shadow: 0 20px 45px rgba(0,0,0,0.35); overflow: hidden;">
      <div class="modal-header" style="padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--color-border); background: var(--color-bg); display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h3 style="margin: 0; font-size: 1.15rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
            <i class="ri-file-copy-2-line" style="color: #6366f1;"></i> Hojas de Inventario por Bodega
          </h3>
          <p style="margin: 0.25rem 0 0 0; font-size: 0.8rem; color: var(--color-text-muted);">
            Folio: <strong style="color: #6366f1; font-family: monospace;">${folio}</strong> • Comercio: <strong>${req.comercio}</strong>
          </p>
        </div>
        <button type="button" class="modal-close" onclick="document.getElementById('modal-inventory-pdf-options').remove()">&times;</button>
      </div>

      <div class="modal-body" style="padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; max-height: 72vh; overflow-y: auto;">
        <div style="background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: var(--radius-md); padding: 0.85rem 1.1rem; font-size: 0.85rem; color: var(--color-text-main); line-height: 1.45;">
          Esta solicitud incluye <strong>${totalSkus} SKUs</strong> distribuidos en <strong>${distinctWhs.length} bodegas físicas</strong>. Puedes descargar el <strong>documento consolidado</strong> o la <strong>hoja de terreno de cada bodega</strong> para enviarla directamente a su respectiva cuadrilla:
        </div>

        <!-- Tarjeta Documento Consolidado -->
        <div style="background: var(--color-bg); border: 1.5px solid #6366f1; border-radius: var(--radius-md); padding: 1rem 1.25rem; display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;">
          <div>
            <div style="font-weight: 700; color: #4338ca; font-size: 0.95rem; display: flex; align-items: center; gap: 0.4rem;">
              <i class="ri-file-list-3-fill"></i> Documento Consolidado (Todas las bodegas)
            </div>
            <div style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 3px;">
              Incluye las ${distinctWhs.length} bodegas completas (${totalSkus} artículos)
            </div>
          </div>
          <div style="display: flex; gap: 0.45rem;">
            <button type="button" class="btn btn-primary btn-sm btn-download-consolidated-pdf" style="background: #6366f1; border-color: #6366f1; display: inline-flex; align-items: center; gap: 0.3rem; font-weight: 600; cursor: pointer;">
              <i class="ri-file-pdf-line"></i> PDF Consolidado
            </button>
            <button type="button" class="btn btn-outline btn-sm btn-download-consolidated-excel" style="border-color: #10b981; color: #10b981; display: inline-flex; align-items: center; gap: 0.3rem; font-weight: 600; cursor: pointer;">
              <i class="ri-file-excel-line"></i> Excel
            </button>
          </div>
        </div>

        <!-- Hojas Individuales por Bodega -->
        <div style="display: flex; flex-direction: column; gap: 0.6rem; margin-top: 0.25rem;">
          <h4 style="margin: 0.25rem 0 0.15rem 0; font-size: 0.825rem; font-weight: 700; text-transform: uppercase; color: var(--color-text-muted); letter-spacing: 0.5px;">
            Hojas Operativas Individuales por Bodega:
          </h4>
          ${distinctWhs.map(wh => `
            <div style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.75rem 1rem; display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
              <div>
                <div style="font-weight: 700; color: var(--color-text-main); font-size: 0.9rem; display: flex; align-items: center; gap: 0.4rem;">
                  <i class="ri-store-2-line" style="color: #6366f1;"></i> ${wh.name}
                </div>
                <div style="font-size: 0.78rem; color: var(--color-text-muted); margin-top: 2px;">
                  ${wh.count} artículos físicos a contar en este recinto
                </div>
              </div>
              <div style="display: flex; gap: 0.4rem;">
                <button type="button" class="btn btn-outline btn-sm btn-wh-pdf" data-wh-name="${wh.name}" data-wh-id="${wh.id || ''}" style="border-color: #ef4444; color: #ef4444; display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.8rem; font-weight: 600; cursor: pointer;">
                  <i class="ri-file-pdf-line"></i> PDF Hoja
                </button>
                <button type="button" class="btn btn-outline btn-sm btn-wh-excel" data-wh-name="${wh.name}" data-wh-id="${wh.id || ''}" style="border-color: #059669; color: #059669; display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.8rem; font-weight: 600; cursor: pointer;">
                  <i class="ri-file-excel-line"></i> Excel
                </button>
              </div>
            </div>
          `).join('')}
        </div>

        <!-- Botón Ráfaga Descargar Todo -->
        <div style="margin-top: 0.5rem; background: var(--color-bg); padding: 0.85rem 1rem; border-radius: var(--radius-md); border: 1px dashed var(--color-border); text-align: center;">
          <div style="font-size: 0.8rem; color: var(--color-text-muted); margin-bottom: 0.5rem;">
            ¿Necesitas imprimir todas las hojas a la vez para despachar a terreno?
          </div>
          <button type="button" class="btn btn-outline btn-sm btn-download-all-burst" style="border-color: #6366f1; color: #6366f1; background: rgba(99, 102, 241, 0.06); font-weight: 700; display: inline-flex; align-items: center; gap: 0.35rem; cursor: pointer;">
            <i class="ri-download-cloud-2-line"></i> Descargar Todo en Ráfaga (Consolidado + Cada Bodega)
          </button>
        </div>
      </div>

      <div class="modal-footer" style="padding: 1rem 1.5rem; border-top: 1px solid var(--color-border); background: var(--color-bg); display: flex; justify-content: flex-end;">
        <button type="button" class="btn btn-outline" onclick="document.getElementById('modal-inventory-pdf-options').remove()">Cerrar</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Listeners
  modal.querySelector('.btn-download-consolidated-pdf').addEventListener('click', () => {
    window.generateInventoryCountPdf(req, 'all');
  });

  modal.querySelector('.btn-download-consolidated-excel').addEventListener('click', () => {
    window.generateInventoryCountExcel(req, 'all');
  });

  modal.querySelectorAll('.btn-wh-pdf').forEach(btn => {
    btn.addEventListener('click', () => {
      const whName = btn.getAttribute('data-wh-name');
      const whId = btn.getAttribute('data-wh-id');
      window.generateInventoryCountPdf(req, { id: whId, name: whName });
    });
  });

  modal.querySelectorAll('.btn-wh-excel').forEach(btn => {
    btn.addEventListener('click', () => {
      const whName = btn.getAttribute('data-wh-name');
      const whId = btn.getAttribute('data-wh-id');
      window.generateInventoryCountExcel(req, { id: whId, name: whName });
    });
  });

  modal.querySelector('.btn-download-all-burst').addEventListener('click', async () => {
    const burstBtn = modal.querySelector('.btn-download-all-burst');
    burstBtn.disabled = true;
    burstBtn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Generando archivos...';

    try {
      // 1. Consolidado
      await window.generateInventoryCountPdf(req, 'all');
      
      // 2. Cada bodega
      for (const wh of distinctWhs) {
        await new Promise(r => setTimeout(r, 650));
        await window.generateInventoryCountPdf(req, wh);
      }
      burstBtn.innerHTML = '<i class="ri-check-line"></i> ¡Todas las hojas generadas!';
      setTimeout(() => {
        burstBtn.disabled = false;
        burstBtn.innerHTML = '<i class="ri-download-cloud-2-line"></i> Descargar Todo en Ráfaga (Consolidado + Cada Bodega)';
      }, 3000);
    } catch (e) {
      console.error(e);
      burstBtn.disabled = false;
      burstBtn.innerHTML = '<i class="ri-download-cloud-2-line"></i> Descargar Todo en Ráfaga (Consolidado + Cada Bodega)';
    }
  });
};

/**
 * Helper unificado para descargar la hoja de inventario (PDF o Excel).
 * Si la solicitud es multibodega, despliega el modal interactivo con opciones por bodega y consolidado.
 * Si es bodega única, inicia la descarga directa en el formato solicitado.
 */
window.downloadInventoryRequestSheet = function(req, format = 'pdf') {
  if (!req) return;
  const distinct = window.getRequestDistinctWarehouses ? window.getRequestDistinctWarehouses(req) : [];
  if (distinct.length > 1 && typeof window.openInventoryPdfOptionsModal === 'function') {
    window.openInventoryPdfOptionsModal(req, format);
  } else {
    if (format === 'excel') {
      window.generateInventoryCountExcel(req);
    } else {
      window.generateInventoryCountPdf(req);
    }
  }
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

  // Enriquecer códigos de barra faltantes antes de generar el informe
  if (typeof window.enrichInventoryProductsBarcodes === 'function') {
    await window.enrichInventoryProductsBarcodes(req);
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
      const barcode = p.barcode || p.codigo_barra || '';
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

      const barcodeHtml = (barcode && barcode !== '-')
        ? `<div style="font-family: 'Courier New', monospace; color: #475569; font-size: 7pt; line-height: 1.2; margin-top: 2px; word-break: break-all;">
             <span style="color: #64748b; font-size: 6pt; font-weight: 700; text-transform: uppercase;">CB:</span> ${barcode}
           </div>`
        : `<div style="font-family: 'Courier New', monospace; color: #94a3b8; font-size: 6.5pt; line-height: 1.2; margin-top: 2px; font-style: italic;">Sin CB</div>`;

      rowsHtml += `
        <tr style="background-color: ${bg}; border-bottom: 1px solid #e2e8f0; page-break-inside: avoid;">
          <td style="padding: 5px 4px; text-align: center; font-weight: 600; color: #64748b; font-size: 8pt; border-right: 1px solid #e2e8f0;">${idx + 1}</td>
          <!-- SKU y Código de Barras en una misma columna (uno sobre el otro) -->
          <td style="padding: 5px 6px; border-right: 1px solid #e2e8f0; vertical-align: middle;">
            <div style="font-family: 'Courier New', monospace; font-weight: 700; color: #0f172a; font-size: 8pt; line-height: 1.2; word-break: break-all;">${p.sku || '-'}</div>
            ${barcodeHtml}
          </td>
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
            <th style="padding: 5px 6px; width: 95px; border-right: 1px solid #334155;">SKU / Cód. Barras</th>
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
            <td colspan="4" style="padding: 5px 6px; text-align: right; color: #0f172a;">TOTALES CONSOLIDADOS:</td>
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
      ${(() => {
        const isClientSigned = !!(req.signed_at || req.signed_by);
        const clientSignedDate = req.signed_at ? new Date(req.signed_at).toLocaleString('es-CL', {
          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        }) : '';
        const clientSignerName = req.signed_by || comercio;
        const clientSignerRut = req.signed_rut ? ` • RUT: ${req.signed_rut}` : '';
        const clientSignerRole = req.signed_role ? ` • Cargo: ${req.signed_role}` : '';
        const clientSigImg = (req.signed_signature_data && req.signed_signature_data.startsWith('data:image/'))
          ? `<div style="text-align: center; margin: 4px 0;"><img src="${req.signed_signature_data}" style="max-height: 38px; max-width: 180px; object-fit: contain;" alt="Firma Digital Cliente"></div>`
          : '';

        const isAdminSigned = !!(req.admin_signed_at || req.admin_signed_by);
        const adminSignedDate = req.admin_signed_at ? new Date(req.admin_signed_at).toLocaleString('es-CL', {
          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        }) : formattedCompletedDate;
        const adminSignerName = req.admin_signed_by || completedBy;
        const adminSigImg = (req.admin_signature_data && req.admin_signature_data.startsWith('data:image/'))
          ? `<div style="text-align: center; margin: 4px 0;"><img src="${req.admin_signature_data}" style="max-height: 38px; max-width: 180px; object-fit: contain;" alt="Firma Digital Supervisor"></div>`
          : '';

        return `
        <div style="page-break-inside: avoid; border-top: 1px solid #cbd5e1; padding-top: 8px; margin-top: 8px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 7.5pt;">
            <tr>
              <!-- Recuadro Supervisor STOCKA -->
              <td style="width: 48%; padding: 8px 10px; border: 1px solid ${isAdminSigned ? '#10b981' : '#cbd5e1'}; border-radius: 5px; vertical-align: top; background-color: ${isAdminSigned ? '#f0fdf4' : '#ffffff'};">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid ${isAdminSigned ? '#a7f3d0' : '#e2e8f0'}; padding-bottom: 3px; margin-bottom: 8px;">
                  <span style="font-weight: 700; color: #0f172a; text-transform: uppercase; font-size: 7pt;">Supervisor de Bodega / Auditor STOCKA</span>
                  ${isAdminSigned ? '<span style="background: #dcfce7; color: #15803d; font-size: 6.5pt; font-weight: 800; padding: 1px 5px; border-radius: 3px; border: 1px solid #86efac;">✓ CERTIFICADO DIGITAL</span>' : ''}
                </div>
                <div style="display: flex; flex-direction: column; gap: 3px; color: #475569; font-size: 7pt;">
                  <div>Nombre: <strong>${adminSignerName}</strong></div>
                  <div>Fecha Validación: <strong>${adminSignedDate}</strong></div>
                  ${isAdminSigned ? `
                    ${adminSigImg}
                    <div style="font-size: 6.5pt; color: #166534; font-family: monospace; margin-top: 4px; border-top: 1px dashed #86efac; padding-top: 2px;">
                      V°B° STOCKA Validado Electrónicamente (ID: ${folio})
                    </div>
                  ` : `
                    <div style="margin-top: 14px;">Firma V°B°: _________________________________________</div>
                  `}
                </div>
              </td>
              <td style="width: 4%;"></td>
              <!-- Recuadro Cliente / Comercio -->
              <td style="width: 48%; padding: 8px 10px; border: 1px solid ${isClientSigned ? '#059669' : '#cbd5e1'}; border-radius: 5px; vertical-align: top; background-color: ${isClientSigned ? '#ecfdf5' : '#ffffff'};">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid ${isClientSigned ? '#a7f3d0' : '#e2e8f0'}; padding-bottom: 3px; margin-bottom: 8px;">
                  <span style="font-weight: 700; color: #0f172a; text-transform: uppercase; font-size: 7pt;">Representante / Administración del Comercio</span>
                  ${isClientSigned ? '<span style="background: #10b981; color: #ffffff; font-size: 6.5pt; font-weight: 800; padding: 1px 6px; border-radius: 3px;">✓ FIRMA ELECTRÓNICA VÁLIDA</span>' : ''}
                </div>
                <div style="display: flex; flex-direction: column; gap: 3px; color: #475569; font-size: 7pt;">
                  <div>Nombre / Comercio: <strong>${comercio}</strong></div>
                  ${isClientSigned ? `
                    <div>Firmante: <strong>${clientSignerName}</strong>${clientSignerRut}${clientSignerRole}</div>
                    <div>Fecha y Hora Firma: <strong>${clientSignedDate}</strong></div>
                    ${clientSigImg}
                    <div style="font-size: 6.5pt; color: #047857; font-family: monospace; margin-top: 4px; border-top: 1px dashed #6ee7b7; padding-top: 2px;">
                      Conformidad Aprobada: Hito definitivo de trazabilidad acordado.
                    </div>
                  ` : `
                    <div>Fecha Recepción: ____/____/________</div>
                    <div style="margin-top: 14px;">Firma Conforme: ______________________________________</div>
                  `}
                </div>
              </td>
            </tr>
          </table>
          
          <div style="text-align: center; margin-top: 8px; font-size: 6.8pt; color: #94a3b8;">
            STOCKA WMS • Informe Oficial de Auditoría y Cuadratura de Inventario Físico • Generado electrónicamente
          </div>
        </div>
        `;
      })()}
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
window.generateInventoryReportExcel = async function(req) {
  if (!req) {
    alert('Error: Datos de solicitud de inventario no disponibles.');
    return;
  }

  if (typeof XLSX === 'undefined') {
    alert('Error: Librería de exportación Excel (XLSX) no disponible.');
    return;
  }

  // Enriquecer códigos de barra faltantes antes de generar la planilla
  if (typeof window.enrichInventoryProductsBarcodes === 'function') {
    await window.enrichInventoryProductsBarcodes(req);
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

/**
 * Modal interactivo para la Firma Electrónica Digital de Actas de Inventario Físico
 * Permite firma manuscrita sobre canvas táctil/mouse o certificación con RUT y Cargo.
 * @param {Object} options
 * @param {Object} options.req - Objeto de solicitud de inventario
 * @param {string} [options.signerType='client'] - 'client' | 'admin'
 * @param {Function} [options.onSigned] - Callback tras firma exitosa
 */
window.openInventoryDigitalSignatureModal = function(options = {}) {
  const { req, signerType = 'client', onSigned } = options;
  if (!req) {
    alert('Error: Datos de la solicitud no especificados.');
    return;
  }

  let modal = document.getElementById('modal-inventory-digital-signature');
  if (modal) modal.remove();

  const folio = req.folio || `REQ-INV-${(req.id || '').substring(0, 8)}`;
  const comercio = req.comercio || 'Comercio';
  const isAdmin = signerType === 'admin';

  let defaultName = '';
  if (isAdmin) {
    defaultName = req.completed_by || window.currentUserName || window.currentUserEmail || 'Supervisor STOCKA';
  } else {
    defaultName = req.signed_by || req.requested_by || window.currentUserName || window.currentUserEmail || '';
  }

  modal = document.createElement('div');
  modal.id = 'modal-inventory-digital-signature';
  modal.className = 'modal-overlay active';
  modal.style.zIndex = '100000';

  modal.innerHTML = `
    <div class="modal-content" style="max-width: 620px; padding: 0; display: flex; flex-direction: column; background: var(--color-surface, #ffffff); border: 1px solid var(--color-border, #e2e8f0); border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2); overflow: hidden; max-height: 90vh;">
      
      <!-- HEADER -->
      <div style="padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--color-border, #e2e8f0); background: ${isAdmin ? 'linear-gradient(135deg, #1e1b4b, #312e81)' : 'linear-gradient(135deg, #064e3b, #059669)'}; color: #ffffff; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.75rem; text-transform: uppercase; font-weight: 800; background: rgba(255,255,255,0.18); padding: 2px 8px; border-radius: 4px; letter-spacing: 0.5px; margin-bottom: 4px;">
            <i class="ri-shield-check-line"></i> Firma Electrónica Oficial
          </div>
          <h3 style="margin: 0; font-size: 1.15rem; font-weight: 800; display: flex; align-items: center; gap: 0.5rem;">
            ${isAdmin ? 'Certificación de Cierre de Inventario' : 'Firma de Conformidad de Inventario'}
          </h3>
          <p style="margin: 2px 0 0 0; font-size: 0.8rem; opacity: 0.9;">
            Folio <strong>${folio}</strong> • ${comercio}
          </p>
        </div>
        <button type="button" class="modal-close" style="color: #ffffff; font-size: 1.5rem; background: none; border: none; cursor: pointer; line-height: 1;" onclick="document.getElementById('modal-inventory-digital-signature').remove()">&times;</button>
      </div>

      <!-- BODY -->
      <div style="padding: 1.25rem 1.5rem; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 1rem; font-size: 0.85rem; color: var(--color-text-main, #1e293b);">
        
        <!-- DECLARACIÓN LEGAL / HITO DE TRAZABILIDAD -->
        <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid #10b981; border-radius: 8px; padding: 0.85rem 1rem; font-size: 0.8rem; line-height: 1.45; color: #065f46;">
          <strong style="display: flex; align-items: center; gap: 0.35rem; margin-bottom: 0.25rem; font-size: 0.85rem;">
            <i class="ri-scales-3-line" style="font-size: 1rem;"></i> Cláusula de Validez y Trazabilidad Vinculante:
          </strong>
          ${isAdmin ? `
            "Al firmar como Supervisor/Auditor de STOCKA, certifico que la toma física ha sido ejecutada de acuerdo con los protocolos de bodega, registrando fielmente las existencias reales para la cuadratura del sistema."
          ` : `
            "Al firmar electrónicamente, el solicitante/comercio declara su total conformidad con los resultados del conteo físico, acordando que esta acta constituye el <strong>último punto e hito oficial de inventario para efectos de trazabilidad</strong> en WMS STOCKA, considerándose todo lo previo como <strong>saldado y aprobado</strong>."
          `}
        </div>

        <!-- DATOS DEL FIRMANTE -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem;">
          <div>
            <label style="display: block; font-weight: 700; font-size: 0.75rem; text-transform: uppercase; color: var(--color-text-muted, #64748b); margin-bottom: 0.25rem;">
              Nombre Completo *
            </label>
            <input type="text" id="sig-input-name" class="form-control" value="${defaultName}" placeholder="Nombre y Apellidos" style="width: 100%; box-sizing: border-box; padding: 0.5rem 0.65rem; font-size: 0.85rem; border: 1px solid var(--color-border, #cbd5e1); border-radius: 6px;">
          </div>
          <div>
            <label style="display: block; font-weight: 700; font-size: 0.75rem; text-transform: uppercase; color: var(--color-text-muted, #64748b); margin-bottom: 0.25rem;">
              RUT / Documento de Identidad
            </label>
            <input type="text" id="sig-input-rut" class="form-control" value="${req.signed_rut || ''}" placeholder="Ej: 12.345.678-9" style="width: 100%; box-sizing: border-box; padding: 0.5rem 0.65rem; font-size: 0.85rem; border: 1px solid var(--color-border, #cbd5e1); border-radius: 6px;">
          </div>
          <div style="grid-column: 1 / -1;">
            <label style="display: block; font-weight: 700; font-size: 0.75rem; text-transform: uppercase; color: var(--color-text-muted, #64748b); margin-bottom: 0.25rem;">
              Cargo / Relación con el Comercio
            </label>
            <input type="text" id="sig-input-role" class="form-control" value="${req.signed_role || (isAdmin ? 'Supervisor de Bodega STOCKA' : 'Representante / Operaciones')}" placeholder="Ej: Representante Legal / Encargado de Bodega" style="width: 100%; box-sizing: border-box; padding: 0.5rem 0.65rem; font-size: 0.85rem; border: 1px solid var(--color-border, #cbd5e1); border-radius: 6px;">
          </div>
        </div>

        <!-- CANVAS DE FIRMA DIGITAL -->
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
            <label style="font-weight: 700; font-size: 0.75rem; text-transform: uppercase; color: var(--color-text-muted, #64748b);">
              Trazar Firma Manuscrita (Táctil o Mouse)
            </label>
            <button type="button" id="btn-clear-inv-signature" class="btn btn-outline btn-sm" style="padding: 0.15rem 0.5rem; font-size: 0.75rem; border-color: #cbd5e1; color: #64748b; background: transparent; cursor: pointer;">
              <i class="ri-eraser-line"></i> Limpiar
            </button>
          </div>
          <div style="position: relative; border: 2px dashed #94a3b8; border-radius: 8px; background: #fafafa; overflow: hidden; height: 140px; display: flex; align-items: center; justify-content: center;">
            <canvas id="inv-signature-pad" width="560" height="140" style="width: 100%; height: 140px; cursor: crosshair; touch-action: none; display: block;"></canvas>
            <span id="inv-signature-placeholder" style="position: absolute; color: #94a3b8; font-size: 0.85rem; pointer-events: none; user-select: none;">
              <i class="ri-edit-line"></i> Dibuja tu firma aquí usando el dedo o mouse
            </span>
          </div>
          <small style="color: var(--color-text-muted, #64748b); font-size: 0.75rem; margin-top: 0.25rem; display: block;">
            * Si prefieres validación con sello electrónico sin trazo manual, completa tu Nombre y RUT arriba.
          </small>
        </div>

        <!-- CHECKBOX OBLIGATORIO DE CONFORMIDAD -->
        <div style="display: flex; align-items: flex-start; gap: 0.6rem; padding: 0.65rem; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0;">
          <input type="checkbox" id="sig-check-accept" style="margin-top: 0.2rem; cursor: pointer; width: 16px; height: 16px;">
          <label for="sig-check-accept" style="cursor: pointer; font-size: 0.8rem; line-height: 1.4; color: var(--color-text-main, #1e293b); font-weight: 500;">
            He revisado los resultados del inventario físico y confirmo electrónicamente mi conformidad con el acta emitida.
          </label>
        </div>

      </div>

      <!-- FOOTER -->
      <div style="padding: 1rem 1.5rem; border-top: 1px solid var(--color-border, #e2e8f0); background: var(--color-surface, #ffffff); display: flex; justify-content: space-between; align-items: center;">
        <button type="button" class="btn btn-outline" onclick="document.getElementById('modal-inventory-digital-signature').remove()" style="padding: 0.5rem 1rem; font-size: 0.85rem;">
          Cancelar
        </button>
        <button type="button" id="btn-submit-inv-digital-signature" class="btn btn-primary" style="background: #059669; border-color: #059669; color: #ffffff; padding: 0.5rem 1.25rem; font-weight: 700; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 0.4rem; cursor: pointer;">
          <i class="ri-quill-pen-line"></i> Firmar y Registrar Conformidad
        </button>
      </div>

    </div>
  `;

  document.body.appendChild(modal);

  // Inicializar Canvas
  const canvas = modal.querySelector('#inv-signature-pad');
  const placeholder = modal.querySelector('#inv-signature-placeholder');
  const btnClear = modal.querySelector('#btn-clear-inv-signature');
  const btnSubmit = modal.querySelector('#btn-submit-inv-digital-signature');
  let isDrawing = false;
  let hasDrawn = false;

  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    function getCoords(e) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
      };
    }

    function onStart(e) {
      isDrawing = true;
      hasDrawn = true;
      if (placeholder) placeholder.style.display = 'none';
      const pos = getCoords(e);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      if (e.touches && e.cancelable) e.preventDefault();
    }

    function onMove(e) {
      if (!isDrawing) return;
      if (e.touches && e.cancelable) e.preventDefault();
      const pos = getCoords(e);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }

    function onEnd() {
      if (isDrawing) {
        isDrawing = false;
      }
    }

    canvas.addEventListener('mousedown', onStart);
    canvas.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);

    canvas.addEventListener('touchstart', onStart, { passive: false });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);

    if (btnClear) {
      btnClear.addEventListener('click', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        hasDrawn = false;
        if (placeholder) placeholder.style.display = 'block';
      });
    }
  }

  // Submit Listener
  if (btnSubmit) {
    btnSubmit.addEventListener('click', async () => {
      const name = (modal.querySelector('#sig-input-name')?.value || '').trim();
      const rut = (modal.querySelector('#sig-input-rut')?.value || '').trim();
      const role = (modal.querySelector('#sig-input-role')?.value || '').trim();
      const accepted = modal.querySelector('#sig-check-accept')?.checked;

      if (!name) {
        alert('Por favor ingresa tu Nombre Completo.');
        return;
      }

      if (!accepted) {
        alert('Debes marcar la casilla confirmando tu conformidad con el acta para poder firmar.');
        return;
      }

      btnSubmit.disabled = true;
      btnSubmit.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Registrando firma...';

      try {
        const nowIso = new Date().toISOString();
        let sigData = null;
        if (hasDrawn && canvas) {
          sigData = canvas.toDataURL('image/png');
        }

        // Armar payload según sea admin o cliente
        let updatePayload = { updated_at: nowIso };
        if (isAdmin) {
          updatePayload.admin_signed_at = nowIso;
          updatePayload.admin_signed_by = name;
          if (sigData) updatePayload.admin_signature_data = sigData;
        } else {
          updatePayload.signed_at = nowIso;
          updatePayload.signed_by = name;
          updatePayload.signed_rut = rut;
          updatePayload.signed_role = role;
          if (sigData) updatePayload.signed_signature_data = sigData;
        }

        const supabaseClient = (typeof supabase !== 'undefined' && supabase.from) ? supabase : (window.supabaseClient || null);
        if (!supabaseClient) {
          throw new Error('Cliente de base de datos no disponible.');
        }

        let { data: updatedData, error: updErr } = await supabaseClient
          .from('inventory_requests')
          .update(updatePayload)
          .eq('id', req.id)
          .select()
          .single();

        if (updErr) {
          console.warn('[DigitalSignature] Fallback al guardar firma:', updErr);
          // Fallback en admin_notes si las columnas extendidas no estuviesen disponibles
          const sigNote = `[FIRMA DIGITAL ${isAdmin ? 'SUPERVISOR' : 'CLIENTE'} ${new Date().toLocaleString('es-CL')}]: Firmado por ${name} (${role || 'Titular'}, RUT: ${rut || 'N/A'})`;
          const combinedNotes = `${req.admin_notes || ''}\n${sigNote}`.trim();
          
          const fallbackPayload = {
            admin_notes: combinedNotes,
            signed_at: nowIso,
            signed_by: name,
            updated_at: nowIso
          };

          const fallbackRes = await supabaseClient
            .from('inventory_requests')
            .update(fallbackPayload)
            .eq('id', req.id)
            .select()
            .single();

          if (fallbackRes.error) throw fallbackRes.error;
          updatedData = fallbackRes.data || { ...req, ...fallbackPayload };
        }

        const finalReq = updatedData || { ...req, ...updatePayload };

        // Enviar notificación por correo
        if (window.sendInventoryRequestNotification) {
          await window.sendInventoryRequestNotification({
            event: 'act_signed',
            req: finalReq
          }).catch(e => console.warn('[DigitalSignature] Error enviando correo de firma:', e));
        }

        modal.remove();

        // Diálogo de éxito con opción de descargar PDF firmado de inmediato
        if (typeof Swal !== 'undefined') {
          Swal.fire({
            icon: 'success',
            title: '¡Acta Firmada Exitosamente!',
            html: `
              <div style="font-size: 0.9rem; text-align: left; margin-top: 0.5rem;">
                <p><strong>Folio:</strong> <code style="color: #059669; font-weight: bold;">${folio}</code></p>
                <p><strong>Firmante:</strong> ${name} ${rut ? `(${rut})` : ''}</p>
                <p><strong>Fecha y Hora:</strong> ${new Date(nowIso).toLocaleString('es-CL')}</p>
                <p style="color: #047857; background: #ecfdf5; padding: 10px; border-radius: 6px; border: 1px solid #a7f3d0; font-size: 0.8rem; margin-top: 0.75rem;">
                  ✓ El hito de trazabilidad ha sido suscrito de conformidad y el PDF oficial ahora contiene tu firma electrónica.
                </p>
              </div>
            `,
            showCancelButton: true,
            confirmButtonText: '<i class="ri-file-chart-line"></i> Descargar PDF Firmado',
            cancelButtonText: 'Cerrar',
            confirmButtonColor: '#059669'
          }).then((res) => {
            if (res.isConfirmed && typeof window.generateInventoryReportPdf === 'function') {
              window.generateInventoryReportPdf(finalReq);
            }
          });
        } else {
          alert('¡Acta firmada exitosamente de conformidad!');
        }

        if (typeof onSigned === 'function') {
          onSigned(finalReq);
        }

      } catch (err) {
        console.error('[DigitalSignature] Error al firmar acta:', err);
        alert('Error al registrar la firma digital: ' + (err.message || err));
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = '<i class="ri-quill-pen-line"></i> Firmar y Registrar Conformidad';
      }
    });
  }
};

