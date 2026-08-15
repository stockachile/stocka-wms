import supabase from './supabase.js';

(function () {
  // Local catalog cache for the labels module
  let localCatalogProducts = [];

  // Active print queue for the bulk generator view
  let printQueue = [];

  /**
   * Helper to resolve the active merchant/commerce
   */
  function getActiveCommerce() {
    const isAdmin = window.location.pathname.includes('admin') || 
                    (typeof window.activeAdminComercio !== 'undefined');
    if (isAdmin) {
      return window.activeAdminComercio || '';
    }
    return window.activeIntegrationCommerce || 
           (window.currentCompany ? window.currentCompany.split(',')[0].trim() : '');
  }

  /**
   * Fetch products specifically for the selected commerce
   */
  async function ensureCatalogProducts() {
    const commerce = getActiveCommerce();
    if (!commerce) {
      localCatalogProducts = [];
      return;
    }
    try {
      // Use the global WMS helper to fetch all rows
      if (typeof window.fetchAllSupabaseRows === 'function') {
        localCatalogProducts = await window.fetchAllSupabaseRows(
          'products', 
          '*, inventory(quantity)', 
          q => q.eq('comercio', commerce).order('name')
        );
      } else {
        const { data } = await supabase
          .from('products')
          .select('*, inventory(quantity)')
          .eq('comercio', commerce)
          .order('name');
        localCatalogProducts = data || [];
      }
    } catch (err) {
      console.error("Error fetching catalog products for labels:", err);
      localCatalogProducts = [];
    }
  }

  /**
   * Generates a Code128 vector barcode SVG and returns its HTML string.
   * Utilizes JsBarcode.
   */
  window.generateBarcodeSVG = function (value, withText, size) {
    if (!value) return `<div style="color:var(--color-danger);font-size:0.75rem;">Sin código</div>`;
    
    // Create a temporary SVG element in memory
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    
    // Adjust scale, height, and margins based on label dimensions
    let barcodeWidth = 1.3;
    let barcodeHeight = 40;
    let fontSize = 10;
    
    if (size === '5x2.5') {
      barcodeWidth = 1.1;
      barcodeHeight = 28;
      fontSize = 9;
    } else if (size === '5x5') {
      barcodeWidth = 1.4;
      barcodeHeight = 55;
      fontSize = 11;
    } else if (size === '10x15') {
      barcodeWidth = 2.2;
      barcodeHeight = 110;
      fontSize = 14;
    }
    
    try {
      if (typeof JsBarcode === 'undefined') {
        return `<div style="font-size:0.75rem;padding:0.5rem;border:1px dashed var(--color-border);text-align:center;">JsBarcode no cargado</div>`;
      }
      
      JsBarcode(svg, value, {
        format: "CODE128",
        width: barcodeWidth,
        height: barcodeHeight,
        displayValue: withText,
        fontSize: fontSize,
        font: "'Inter', sans-serif",
        textMargin: 3,
        margin: 0
      });
      return svg.outerHTML;
    } catch (err) {
      console.error("Error rendering barcode with JsBarcode:", err);
      return `<div style="color:var(--color-danger);font-size:0.75rem;">Código incompatible</div>`;
    }
  };

  /**
   * Renders the bulk label generator panel in #app-content
   */
  window.renderLabelGenerator = async function () {
    const appContent = document.getElementById('app-content');
    if (!appContent) return;

    const isAdmin = window.location.pathname.includes('admin') || 
                    (typeof window.activeAdminComercio !== 'undefined');

    if (isAdmin) {
      // Render layout with the Selector container at the top
      appContent.innerHTML = `
        <div style="margin-bottom: 1.5rem; background: var(--color-surface); padding: 1.25rem 1.5rem; border-radius: var(--radius-lg); border: 1px solid var(--color-border); box-shadow: var(--shadow-sm);">
          <label class="form-label" style="font-weight: 600; display: block; margin-bottom: 0.5rem; color: var(--color-text-main); font-size: 0.95rem;">
            <i class="ri-user-settings-line" style="color: var(--color-primary); margin-right: 0.5rem;"></i>Seleccionar Cliente (Comercio)
          </label>
          <div id="label-admin-client-dropdown-container"></div>
        </div>
        <div id="label-generator-workspace">
        </div>
      `;

      try {
        const { data: configComercios, error: clientErr } = await supabase
          .from('v_comercios_config')
          .select('sigla, nombre')
          .order('nombre');

        if (clientErr) throw clientErr;

        const uniqueClients = [];
        const seen = new Set();
        if (configComercios) {
          configComercios.forEach(c => {
            if (c.nombre && !seen.has(c.nombre)) {
              seen.add(c.nombre);
              uniqueClients.push(c);
            }
          });
        }

        const options = uniqueClients.map(c => ({ value: c.nombre, label: `${c.nombre} (${c.sigla})` }));

        if (typeof window.initSearchableDropdown === 'function') {
          window.initSearchableDropdown(
            'label-admin-client-dropdown-container',
            options,
            window.activeAdminComercio,
            async (selectedComercio) => {
              window.activeAdminComercio = selectedComercio;
              if (selectedComercio) {
                await renderLabelGeneratorWorkspace();
              } else {
                renderEmptyWorkspace();
              }
            }
          );
        } else {
          // Fallback simple select if function is missing (should not happen)
          const selectHtml = `
            <select id="label-admin-client-select" class="form-input" style="width:100%;max-width:400px;height:42px;padding:0.5rem 0.75rem;background:var(--color-bg);color:var(--color-text-main);border:1px solid var(--color-border);border-radius:var(--radius-md);">
              <option value="">-- Seleccione un Cliente --</option>
              ${options.map(o => `<option value="${escapeHtml(o.value)}" ${o.value === window.activeAdminComercio ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
            </select>
          `;
          document.getElementById('label-admin-client-dropdown-container').innerHTML = selectHtml;
          document.getElementById('label-admin-client-select').addEventListener('change', async (e) => {
            const val = e.target.value;
            window.activeAdminComercio = val;
            if (val) {
              await renderLabelGeneratorWorkspace();
            } else {
              renderEmptyWorkspace();
            }
          });
        }

        if (window.activeAdminComercio) {
          await renderLabelGeneratorWorkspace();
        } else {
          renderEmptyWorkspace();
        }

      } catch (err) {
        console.error('Error loading admin client select in labels:', err);
        document.getElementById('label-generator-workspace').innerHTML = `<p style="padding:2rem;color:red;text-align:center;">Error al cargar los comercios: ${err.message}</p>`;
      }

    } else {
      // Client view: check if user has multiple assigned shops/comercios
      const assignedComercios = (window.currentCompany || '').split(',').map(c => c.trim()).filter(Boolean);
      const activeCommerce = window.activeIntegrationCommerce || assignedComercios[0] || '';
      
      if (assignedComercios.length > 1) {
        appContent.innerHTML = `
          <div style="margin-bottom: 1.5rem; background: var(--color-surface); padding: 1.25rem 1.5rem; border-radius: var(--radius-lg); border: 1px solid var(--color-border); box-shadow: var(--shadow-sm);">
            <label class="form-label" style="font-weight: 600; display: block; margin-bottom: 0.5rem; color: var(--color-text-main); font-size: 0.95rem;">
              <i class="ri-store-2-line" style="color: var(--color-primary); margin-right: 0.5rem;"></i>Seleccionar Comercio Activo
            </label>
            <select id="label-client-commerce-select" class="form-input" style="max-width: 400px; height: 42px; padding: 0.5rem 0.75rem; background: var(--color-bg); color: var(--color-text-main); border: 1px solid var(--color-border); border-radius: var(--radius-md);">
              ${assignedComercios.map(c => `<option value="${c}" ${c === activeCommerce ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
          <div id="label-generator-workspace"></div>
        `;
        
        document.getElementById('label-client-commerce-select').addEventListener('change', async (e) => {
          window.activeIntegrationCommerce = e.target.value;
          await renderLabelGeneratorWorkspace();
        });
      } else {
        appContent.innerHTML = `<div id="label-generator-workspace"></div>`;
      }
      
      await renderLabelGeneratorWorkspace();
    }
  };

  /**
   * Helper to render empty workspace state
   */
  function renderEmptyWorkspace() {
    const workspace = document.getElementById('label-generator-workspace');
    if (!workspace) return;
    workspace.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:250px;background:var(--color-surface);border-radius:var(--radius-lg);border:1px solid var(--color-border);padding:2rem;margin-top:1rem;">
        <i class="ri-store-2-line" style="font-size:2.5rem;color:var(--color-text-muted);margin-bottom:1rem;opacity:0.6;"></i>
        <h4 style="margin:0;color:var(--color-text-muted);font-weight:500;">Por favor selecciona un cliente (comercio) arriba para generar etiquetas.</h4>
      </div>
    `;
  }

  /**
   * Main workspace renderer once commerce is resolved
   */
  async function renderLabelGeneratorWorkspace() {
    const workspace = document.getElementById('label-generator-workspace');
    if (!workspace) return;

    // Show loading spinner
    workspace.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:300px;background:var(--color-surface);border-radius:var(--radius-lg);border:1px solid var(--color-border);padding:2rem;margin-top:1rem;">
        <i class="ri-loader-4-line ri-spin" style="font-size:2.5rem;color:var(--color-primary);margin-bottom:1rem;"></i>
        <h4 style="margin:0;color:var(--color-text-muted);">Cargando productos de catálogo...</h4>
      </div>
    `;

    // Ensure we have catalog products cached for the selected commerce
    await ensureCatalogProducts();

    // Reset local queue
    printQueue = [];

    // Resolve active commerce name
    const isAdmin = window.location.pathname.includes('admin') || (typeof window.activeAdminComercio !== 'undefined');
    const assignedComercios = (window.currentCompany || '').split(',').map(c => c.trim()).filter(Boolean);
    const activeCommerce = isAdmin ? window.activeAdminComercio : (window.activeIntegrationCommerce || assignedComercios[0] || '');

    // Fetch stock declarations/incomes for this commerce
    let declarations = [];
    try {
      const { data, error } = await supabase
        .from('stock_declarations')
        .select('*, warehouses (name)')
        .eq('comercio', activeCommerce)
        .order('created_at', { ascending: false });
      
      if (!error) {
        declarations = data || [];
      }
    } catch (err) {
      console.error("Error loading declarations for labels:", err);
    }

    // Render layout
    workspace.innerHTML = `
      <div class="label-generator-container" style="display: flex; gap: 1.5rem; flex-wrap: wrap; margin-top: 1rem; align-items: stretch; animation: fadeIn 0.25s ease;">
        <!-- Left Panel: Configurations -->
        <div class="card" style="flex: 1 1 300px; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
          <h3 style="margin: 0 0 0.5rem 0; font-size: 1.1rem; display: flex; align-items: center; gap: 0.5rem; color: var(--color-text-main);">
            <i class="ri-settings-3-line" style="color: var(--color-primary);"></i> Ajustes de Impresión
          </h3>
          
          <div>
            <label style="font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.85rem; color: var(--color-text-muted);">Tamaño de Etiqueta</label>
            <select id="global-label-size" class="form-input" style="width:100%; height:42px; padding:0.5rem 0.75rem; background:var(--color-bg); color:var(--color-text-main); border:1px solid var(--color-border); border-radius:var(--radius-md);">
              <option value="5x2.5" selected>5 x 2.5 cm (Horizontal chica)</option>
              <option value="5x5">5 x 5 cm (Cuadrada mediana)</option>
              <option value="10x15">10 x 15 cm (Vertical grande / Envíos)</option>
            </select>
          </div>
          
          <div>
            <label style="font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.85rem; color: var(--color-text-muted);">Componentes</label>
            <select id="global-label-template" class="form-input" style="width:100%; height:42px; padding:0.5rem 0.75rem; background:var(--color-bg); color:var(--color-text-main); border:1px solid var(--color-border); border-radius:var(--radius-md);">
              <option value="name+barcode" selected>Nombre + Código de barras</option>
              <option value="barcode">Sólo Código de barras</option>
            </select>
          </div>
          
          <div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 0.25rem;">
            <input type="checkbox" id="global-label-readable" checked style="width: auto; cursor: pointer;">
            <label for="global-label-readable" style="font-size: 0.85rem; cursor: pointer; user-select: none; color: var(--color-text-main);">Lectura humana (texto bajo las barras)</label>
          </div>
          
          <div>
            <label style="font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.85rem; color: var(--color-text-muted);">Origen del Código</label>
            <select id="global-label-source" class="form-input" style="width:100%; height:42px; padding:0.5rem 0.75rem; background:var(--color-bg); color:var(--color-text-main); border:1px solid var(--color-border); border-radius:var(--radius-md);">
              <option value="sku" selected>Usar SKU del Producto</option>
              <option value="barcode">Usar Campo "Código de Barras" del Catálogo</option>
            </select>
            <span style="font-size: 0.75rem; color: var(--color-text-muted); display: block; margin-top: 0.25rem;">
              * Si un producto no posee código de barra en catálogo, se utilizará su SKU.
            </span>
          </div>

          <div style="border-top: 1px dashed var(--color-border); padding-top: 1rem; margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.75rem;">
            <button id="btn-load-inventory-stock" class="btn btn-outline" style="width: 100%; justify-content: center; gap: 0.5rem; font-size: 0.85rem; border-color: var(--color-accent); color: var(--color-accent);">
              <i class="ri-box-3-line"></i> Cargar desde Stock Activo
            </button>
            <button id="btn-clear-print-queue" class="btn btn-outline" style="width: 100%; justify-content: center; gap: 0.5rem; font-size: 0.85rem; border-color: var(--color-danger); color: var(--color-danger);">
              <i class="ri-delete-bin-line"></i> Limpiar Cola de Impresión
            </button>
          </div>
        </div>

        <!-- Center Panel: Print Queue -->
        <div class="card" style="flex: 2 1 450px; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
          <h3 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main);">Cola de Impresión</h3>
          
          <!-- Search box with Autocomplete -->
          <div style="position: relative;">
            <i class="ri-search-line" style="position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%); color: var(--color-text-muted);"></i>
            <input type="text" id="label-search-input" class="form-input" placeholder="Buscar y agregar producto por SKU o nombre..." style="width: 100%; padding-left: 2.25rem; padding-right: 1rem; height: 42px; border-radius: var(--radius-md);">
            <div id="label-autocomplete-dropdown" style="display: none; position: absolute; top: 105%; left: 0; right: 0; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); box-shadow: var(--shadow-lg); z-index: 1000; max-height: 240px; overflow-y: auto;">
            </div>
          </div>

          <div style="flex: 1; min-height: 250px; max-height: 400px; overflow-y: auto; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg);">
            <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
              <thead>
                <tr style="background: var(--color-surface); border-bottom: 1px solid var(--color-border); text-align: left;">
                  <th style="padding: 0.6rem 0.8rem;">Producto</th>
                  <th style="padding: 0.6rem 0.8rem;">SKU</th>
                  <th style="padding: 0.6rem 0.8rem; text-align: center;">Código en barras</th>
                  <th style="padding: 0.6rem 0.8rem; text-align: center; width: 100px;">Copias</th>
                  <th style="padding: 0.6rem 0.8rem; text-align: center; width: 50px;"></th>
                </tr>
              </thead>
              <tbody id="label-queue-tbody">
                <!-- Dynamic rows -->
              </tbody>
            </table>
          </div>
        </div>

        <!-- Right Panel: Live Preview -->
        <div class="card" style="flex: 1 1 280px; padding: 1.25rem; display: flex; flex-direction: column; align-items: center; justify-content: space-between; min-height: 380px;">
          <h3 style="margin: 0 0 1rem 0; font-size: 1.1rem; width: 100%; text-align: left; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
            <i class="ri-eye-line" style="color: var(--color-primary);"></i> Vista Previa
          </h3>

          <!-- Aspect ratio simulation wrapper -->
          <div id="live-preview-box-wrapper" style="flex: 1; display: flex; align-items: center; justify-content: center; width: 100%; padding: 1rem; background: var(--color-bg); border-radius: var(--radius-md); border: 1px solid var(--color-border); margin-bottom: 1.25rem;">
            <!-- Rendered label goes here -->
          </div>

          <div style="display: flex; gap: 0.75rem; width: 100%;">
            <button id="btn-emit-bulk-labels" class="btn btn-primary" style="flex: 1; height: 46px; justify-content: center; font-size: 0.95rem; font-weight: 600; gap: 0.35rem; border-radius: var(--radius-md); box-shadow: 0 4px 12px rgba(37,99,235,0.25);">
              <i class="ri-printer-line"></i> Imprimir (<span id="bulk-total-count">0</span>)
            </button>
            <button id="btn-download-bulk-zpl" class="btn btn-outline" style="flex: 1; height: 46px; justify-content: center; font-size: 0.95rem; font-weight: 600; gap: 0.35rem; border-radius: var(--radius-md); border-color: var(--color-accent); color: var(--color-accent);">
              <i class="ri-download-2-line"></i> ZPL (<span id="bulk-total-count-zpl">0</span>)
            </button>
          </div>
        </div>
      </div>

      <!-- New Section: Stock Incomes -->
      <div class="card" style="margin-top: 1.5rem; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem; animation: fadeIn 0.3s ease;">
        <h3 style="margin: 0; font-size: 1.15rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
          <i class="ri-history-line" style="color: var(--color-primary);"></i> Ingresos de Stock del Comercio
        </h3>
        <p style="font-size: 0.85rem; color: var(--color-text-muted); margin: 0;">
          Selecciona una declaración de ingreso de stock para cargar automáticamente todos sus productos y cantidades declaradas/confirmadas directamente a la cola de impresión.
        </p>
        
        <div style="overflow-x: auto; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg);">
          <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left;">
            <thead>
              <tr style="background: var(--color-surface); border-bottom: 1px solid var(--color-border);">
                <th style="padding: 0.75rem 1rem;">ID / Código</th>
                <th style="padding: 0.75rem 1rem;">Título / Descripción</th>
                <th style="padding: 0.75rem 1rem;">Bodega</th>
                <th style="padding: 0.75rem 1rem;">Fecha Creación</th>
                <th style="padding: 0.75rem 1rem; text-align: center;">U. Declaradas</th>
                <th style="padding: 0.75rem 1rem; text-align: center;">U. Confirmadas</th>
                <th style="padding: 0.75rem 1rem;">Estado</th>
                <th style="padding: 0.75rem 1rem; text-align: center; width: 180px;">Acción</th>
              </tr>
            </thead>
            <tbody id="label-declarations-tbody">
              <!-- Dynamically populated -->
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Populate declarations list
    const declTbody = document.getElementById('label-declarations-tbody');
    if (declTbody) {
      if (declarations.length === 0) {
        declTbody.innerHTML = `
          <tr>
            <td colspan="8" style="padding: 2rem; text-align: center; color: var(--color-text-muted);">
              No se encontraron ingresos de stock para este comercio.
            </td>
          </tr>
        `;
      } else {
        declTbody.innerHTML = declarations.map(dec => {
          const formattedDate = new Date(dec.created_at).toLocaleDateString('es-CL') + ' ' + new Date(dec.created_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
          let statusBadge = '';
          switch (dec.status) {
            case 'Creada':
              statusBadge = '<span class="badge" style="background-color: var(--badge-neutral-bg); color: var(--badge-neutral-text);">Creada</span>';
              break;
            case 'Bodega Asignada':
              statusBadge = '<span class="badge" style="background-color: rgba(37, 99, 235, 0.1); color: var(--color-primary); border: 1px solid rgba(37, 99, 235, 0.2);">Bodega Asignada</span>';
              break;
            case 'En Recepción - Pendiente Conteo':
              statusBadge = '<span class="badge animate-pulse" style="background-color: var(--badge-info-bg); color: var(--badge-info-text);">Pendiente Conteo</span>';
              break;
            case 'En proceso de conteo/clasificación':
              statusBadge = '<span class="badge animate-pulse" style="background-color: var(--badge-warning-bg); color: var(--badge-warning-text); border: 1px solid rgba(245, 158, 11, 0.3);">Conteo/Clasificación</span>';
              break;
            case 'Recibido Conforme':
              statusBadge = '<span class="badge" style="background-color: var(--badge-success-bg); color: var(--badge-success-text);">Recibido Conforme</span>';
              break;
            case 'Recibido con Incidencias':
              statusBadge = '<span class="badge" style="background-color: var(--badge-danger-bg); color: var(--badge-danger-text); border: 1px solid rgba(239, 68, 68, 0.3);">Recibido con Incidencias</span>';
              break;
            default:
              statusBadge = `<span class="badge badge-neutral">${dec.status}</span>`;
          }

          return `
            <tr style="border-bottom: 1px solid var(--color-border); transition: background-color 0.2s;">
              <td style="padding: 0.75rem 1rem; font-family: monospace; font-weight: bold; color: var(--color-primary);">
                #${dec.id.substring(0, 8).toUpperCase()}
              </td>
              <td style="padding: 0.75rem 1rem; font-weight: 500;">
                ${escapeHtml(dec.title || 'Ingreso sin título')}
              </td>
              <td style="padding: 0.75rem 1rem; color: var(--color-text-muted);">
                ${escapeHtml(dec.warehouses?.name || 'No asignada')}
              </td>
              <td style="padding: 0.75rem 1rem; font-size: 0.78rem; color: var(--color-text-muted);">
                ${formattedDate}
              </td>
              <td style="padding: 0.75rem 1rem; text-align: center; font-weight: bold;">
                ${dec.quantity_declared || 0}
              </td>
              <td style="padding: 0.75rem 1rem; text-align: center; font-weight: bold; color: var(--color-success);">
                ${dec.quantity_received || 0}
              </td>
              <td style="padding: 0.75rem 1rem;">
                ${statusBadge}
              </td>
              <td style="padding: 0.75rem 1rem; text-align: center;">
                <button onclick="window.loadLabelQueueFromDeclaration('${dec.id}')" class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem; border-color: var(--color-primary); color: var(--color-primary); background: transparent; cursor: pointer; transition: all 0.2s;">
                  <i class="ri-play-list-add-line"></i> Cargar a Cola
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }
    }

    // Initialize layout event listeners
    initGeneratorListeners();
    updateQueueUI();
  }


  /**
   * Bind event listeners for the bulk label generator layout
   */
  function initGeneratorListeners() {
    const sizeSelect = document.getElementById('global-label-size');
    const templateSelect = document.getElementById('global-label-template');
    const readableCb = document.getElementById('global-label-readable');
    const sourceSelect = document.getElementById('global-label-source');
    
    const searchInput = document.getElementById('label-search-input');
    const dropdown = document.getElementById('label-autocomplete-dropdown');
    
    const btnLoadStock = document.getElementById('btn-load-inventory-stock');
    const btnClearQueue = document.getElementById('btn-clear-print-queue');
    const btnEmit = document.getElementById('btn-emit-bulk-labels');

    // Trigger update of preview on configurations change
    [sizeSelect, templateSelect, readableCb, sourceSelect].forEach(element => {
      element?.addEventListener('change', () => {
        updateQueueUI();
      });
    });

    // Autocomplete Search logic
    searchInput?.addEventListener('input', (e) => {
      const val = e.target.value.toLowerCase().trim();
      if (!val) {
        dropdown.style.display = 'none';
        return;
      }

      // Filter local catalog
      const matches = localCatalogProducts.filter(p => 
        (p.sku || '').toLowerCase().includes(val) || 
        (p.name || '').toLowerCase().includes(val)
      ).slice(0, 10); // Limit to top 10

      if (matches.length === 0) {
        dropdown.innerHTML = `<div style="padding:0.75rem;color:var(--color-text-muted);font-size:0.85rem;text-align:center;">No se encontraron productos</div>`;
      } else {
        dropdown.innerHTML = matches.map(p => {
          const qty = p.inventory && p.inventory[0] ? p.inventory[0].quantity : 0;
          return `
            <div class="label-search-item" data-id="${p.id}" style="padding:0.6rem 0.8rem;cursor:pointer;border-bottom:1px solid var(--color-border);display:flex;justify-content:space-between;align-items:center;transition:background 0.15s;font-size:0.85rem;">
              <div>
                <strong style="color:var(--color-text-main);">${escapeHtml(p.sku)}</strong>
                <span style="color:var(--color-text-muted);margin-left:0.5rem;font-size:0.8rem;">${escapeHtml(p.name)}</span>
              </div>
              <span class="badge" style="font-size:0.75rem;background:rgba(59,130,246,0.08);color:var(--color-primary);padding:0.15rem 0.4rem;border-radius:4px;">Stock: ${qty}</span>
            </div>
          `;
        }).join('');
      }
      dropdown.style.display = 'block';
    });

    // Add item selection from search dropdown
    dropdown?.addEventListener('click', (e) => {
      const item = e.target.closest('.label-search-item');
      if (!item) return;

      const prodId = item.getAttribute('data-id');
      const prod = localCatalogProducts.find(p => p.id === prodId);
      if (prod) {
        // Add to printQueue or increment quantity if already added
        const existing = printQueue.find(item => item.id === prodId);
        if (existing) {
          existing.qty += 1;
        } else {
          printQueue.push({
            id: prod.id,
            sku: prod.sku,
            name: prod.name,
            barcode: prod.barcode || '',
            qty: 1
          });
        }
        searchInput.value = '';
        dropdown.style.display = 'none';
        updateQueueUI();
      }
    });

    // Close autocomplete when clicking outside
    document.addEventListener('click', (e) => {
      if (searchInput && dropdown && !searchInput.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    });

    // Hover effect on dropdown items
    dropdown?.addEventListener('mouseover', (e) => {
      const item = e.target.closest('.label-search-item');
      if (item) {
        item.style.background = 'var(--color-bg)';
      }
    });
    dropdown?.addEventListener('mouseout', (e) => {
      const item = e.target.closest('.label-search-item');
      if (item) {
        item.style.background = 'transparent';
      }
    });

    // Load active inventory (stock > 0)
    btnLoadStock?.addEventListener('click', () => {
      const activeProducts = localCatalogProducts.filter(p => {
        const qty = p.inventory && p.inventory[0] ? parseInt(p.inventory[0].quantity, 10) : 0;
        return qty > 0;
      });

      if (activeProducts.length === 0) {
        Swal.fire('Catálogo Vacío', 'No hay productos con stock activo registrado en este momento.', 'warning');
        return;
      }

      Swal.fire({
        title: 'Cargar Stock Activo',
        text: `¿Estás seguro de cargar ${activeProducts.length} productos con stock activo a la cola de impresión? Esto reemplazará tu cola actual.`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Sí, cargar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: 'var(--color-accent)',
      }).then((result) => {
        if (result.isConfirmed) {
          printQueue = activeProducts.map(p => {
            const qty = p.inventory && p.inventory[0] ? parseInt(p.inventory[0].quantity, 10) : 1;
            return {
              id: p.id,
              sku: p.sku,
              name: p.name,
              barcode: p.barcode || '',
              qty: qty
            };
          });
          updateQueueUI();
        }
      });
    });

    // Clear queue
    btnClearQueue?.addEventListener('click', () => {
      if (printQueue.length === 0) return;
      printQueue = [];
      updateQueueUI();
    });

    // Trigger printing of queue
    btnEmit?.addEventListener('click', () => {
      if (printQueue.length === 0) {
        Swal.fire('Cola vacía', 'Agrega productos a la cola de impresión antes de emitir etiquetas.', 'warning');
        return;
      }

      const size = sizeSelect.value;
      const template = templateSelect.value;
      const withHumanReadable = readableCb.checked;
      const dataSource = sourceSelect.value;

      window.printLabels(printQueue, {
        size,
        template,
        withHumanReadable,
        dataSource
      });
    });

    // Trigger download of ZPL queue
    const btnDownloadZpl = document.getElementById('btn-download-bulk-zpl');
    btnDownloadZpl?.addEventListener('click', () => {
      if (printQueue.length === 0) {
        Swal.fire('Cola vacía', 'Agrega productos a la cola antes de generar el código ZPL.', 'warning');
        return;
      }

      const size = sizeSelect.value;
      const template = templateSelect.value;
      const withHumanReadable = readableCb.checked;
      const dataSource = sourceSelect.value;

      window.showZPLModal(printQueue, {
        size,
        template,
        withHumanReadable,
        dataSource
      });
    });
  }

  /**
   * Refreshes the HTML table rows and updates the Live Preview panel
   */
  function updateQueueUI() {
    const tbody = document.getElementById('label-queue-tbody');
    const totalCountSpan = document.getElementById('bulk-total-count');
    
    if (!tbody) return;

    const size = document.getElementById('global-label-size')?.value || '5x2.5';
    const template = document.getElementById('global-label-template')?.value || 'name+barcode';
    const withHumanReadable = document.getElementById('global-label-readable')?.checked || false;
    const dataSource = document.getElementById('global-label-source')?.value || 'sku';

    // Sum physical copies
    const totalCopies = printQueue.reduce((acc, item) => acc + item.qty, 0);
    if (totalCountSpan) {
      totalCountSpan.textContent = totalCopies;
    }
    const totalCountZplSpan = document.getElementById('bulk-total-count-zpl');
    if (totalCountZplSpan) {
      totalCountZplSpan.textContent = totalCopies;
    }

    if (printQueue.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align:center;padding:2.5rem;color:var(--color-text-muted);">
            <i class="ri-printer-line" style="font-size:2rem;display:block;margin-bottom:0.5rem;opacity:0.6;"></i>
            La cola de impresión está vacía.<br>Busca productos arriba para agregarlos.
          </td>
        </tr>
      `;
      // Render placeholder preview
      renderLivePreview(null, { size, template, withHumanReadable, dataSource });
      return;
    }

    // Render queue list rows
    tbody.innerHTML = printQueue.map((item, index) => {
      const codeVal = (dataSource === 'sku' || !item.barcode) ? item.sku : item.barcode;
      return `
        <tr style="border-bottom:1px solid var(--color-border);background:var(--color-surface);vertical-align:middle;">
          <td style="padding:0.75rem 0.8rem;font-weight:500;color:var(--color-text-main);">${escapeHtml(item.name)}</td>
          <td style="padding:0.75rem 0.8rem;color:var(--color-text-muted);font-family:monospace;font-size:0.8rem;">${escapeHtml(item.sku)}</td>
          <td style="padding:0.75rem 0.8rem;text-align:center;font-family:monospace;color:var(--color-primary);font-size:0.8rem;">
            ${escapeHtml(codeVal)}
            ${(!item.barcode && dataSource === 'barcode') ? ' <span style="font-size:0.7rem;color:var(--color-warning);">(SKU temporal)</span>' : ''}
          </td>
          <td style="padding:0.75rem 0.8rem;text-align:center;">
            <div style="display:inline-flex;align-items:center;gap:0.35rem;border:1px solid var(--color-border);border-radius:4px;padding:0.15rem 0.35rem;background:var(--color-bg);">
              <button onclick="window.decrementQueueItem(${index})" style="background:none;border:none;cursor:pointer;font-size:0.9rem;padding:0;color:var(--color-text-muted);display:flex;align-items:center;height:20px;width:20px;justify-content:center;"><i class="ri-subtract-line"></i></button>
              <span style="font-weight:600;min-width:24px;text-align:center;font-size:0.85rem;">${item.qty}</span>
              <button onclick="window.incrementQueueItem(${index})" style="background:none;border:none;cursor:pointer;font-size:0.9rem;padding:0;color:var(--color-text-muted);display:flex;align-items:center;height:20px;width:20px;justify-content:center;"><i class="ri-add-line"></i></button>
            </div>
          </td>
          <td style="padding:0.75rem 0.8rem;text-align:center;">
            <button onclick="window.removeFromQueue(${index})" style="background:none;border:none;cursor:pointer;color:var(--color-danger);font-size:1.1rem;display:flex;align-items:center;justify-content:center;" title="Quitar de la cola"><i class="ri-delete-bin-line"></i></button>
          </td>
        </tr>
      `;
    }).join('');

    // Render preview of the first element in queue
    renderLivePreview(printQueue[0], { size, template, withHumanReadable, dataSource });
  }

  // Exposed helper functions for row actions
  window.incrementQueueItem = function (index) {
    if (printQueue[index]) {
      printQueue[index].qty += 1;
      updateQueueUI();
    }
  };

  window.decrementQueueItem = function (index) {
    if (printQueue[index] && printQueue[index].qty > 1) {
      printQueue[index].qty -= 1;
      updateQueueUI();
    }
  };

  window.removeFromQueue = function (index) {
    if (printQueue[index]) {
      printQueue.splice(index, 1);
      updateQueueUI();
    }
  };

  /**
   * Renders the visual layout of a label inside the right side preview box
   */
  function renderLivePreview(item, options) {
    const previewWrapper = document.getElementById('live-preview-box-wrapper');
    if (!previewWrapper) return;

    if (!item) {
      previewWrapper.innerHTML = `
        <div style="color:var(--color-text-muted);font-size:0.85rem;text-align:center;padding:2rem;">
          <i class="ri-barcode-line" style="font-size:2.5rem;display:block;margin-bottom:0.5rem;opacity:0.3;color:var(--color-text-muted);"></i>
          Agrega productos para ver la previsualización
        </div>
      `;
      return;
    }

    const valueToEncode = (options.dataSource === 'sku' || !item.barcode) ? item.sku : item.barcode;
    const barcodeSVG = window.generateBarcodeSVG(valueToEncode, options.withHumanReadable, options.size);

    // Apply exact proportions for the simulated sticker inside the box
    let w = '200px';
    let h = '100px';
    let labelPadding = '6px';
    let nameFontSize = '7.5px';
    let maxNameHeight = '18px';

    if (options.size === '5x2.5') {
      w = '200px'; h = '100px'; // 2:1 Aspect Ratio
      labelPadding = '6px';
      nameFontSize = '7.5px';
      maxNameHeight = '18px';
    } else if (options.size === '5x5') {
      w = '160px'; h = '160px'; // 1:1 Aspect Ratio
      labelPadding = '10px';
      nameFontSize = '9px';
      maxNameHeight = '30px';
    } else if (options.size === '10x15') {
      w = '160px'; h = '240px'; // 2:3 Aspect Ratio
      labelPadding = '15px';
      nameFontSize = '11px';
      maxNameHeight = '42px';
    }

    // Safety length warning for EAN codes on small tags
    let warningHtml = '';
    if (options.size === '5x2.5' && valueToEncode.length > 15) {
      warningHtml = `
        <div style="position:absolute;top:2px;right:2px;background:rgba(245,158,11,0.15);color:var(--color-warning);border:1px solid rgba(245,158,11,0.3);border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:bold;" title="El código es muy largo para este tamaño. Podría desbordarse en la impresión física.">!</div>
      `;
    }

    previewWrapper.innerHTML = `
      <div class="sticker-preview" style="
        position: relative;
        width: ${w};
        height: ${h};
        background: white;
        color: black;
        border: 1px dashed var(--color-border);
        box-shadow: var(--shadow-md);
        border-radius: 4px;
        padding: ${labelPadding};
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        box-sizing: border-box;
        overflow: hidden;
      ">
        ${warningHtml}
        
        ${options.template === 'name+barcode' ? `
          <div class="label-name" style="
            font-size: ${nameFontSize};
            font-weight: 700;
            line-height: 1.1;
            margin-bottom: 4px;
            max-height: ${maxNameHeight};
            overflow: hidden;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            width: 100%;
            word-break: break-word;
            color: #000;
          ">${escapeHtml(item.name)}</div>
        ` : ''}

        <div style="width: 100%; display: flex; justify-content: center; align-items: center; flex: 1; overflow: hidden;">
          ${barcodeSVG}
        </div>

        ${options.size === '10x15' ? `
          <div style="font-size: 8px; color: #555; text-align: left; width: 100%; border-top: 1px dashed #ddd; padding-top: 4px; margin-top: 4px; display: flex; justify-content: space-between;">
            <span>SKU: ${escapeHtml(item.sku)}</span>
            <span>STOCKA WMS</span>
          </div>
        ` : ''}
      </div>
    `;
  }

  /**
   * Opens the SweetAlert2 configurations modal for printing a single product label
   */
  window.openIndividualLabelModal = async function (productId) {
    await ensureCatalogProducts();
    const product = localCatalogProducts.find(p => p.id === productId);
    if (!product) {
      Swal.fire('Error', 'No se encontró la información del producto.', 'error');
      return;
    }

    const defaultSku = product.sku || '';
    const defaultBarcode = product.barcode || '';

    // HTML Structure inside the SweetAlert2 modal
    const swalHtml = `
      <div style="text-align: left; font-size: 0.9rem; display: flex; flex-direction: column; gap: 0.85rem;">
        <p style="margin: 0; color: var(--color-text-muted); font-size: 0.85rem;">
          Configure el formato de emisión para: <strong style="color:var(--color-text-main);">${escapeHtml(product.name)}</strong>
        </p>

        <div>
          <label style="font-weight: 600; display: block; margin-bottom: 0.25rem;">Formato de Tamaño</label>
          <select id="swal-label-size" class="swal2-select" style="width: 100%; margin: 0; font-size: 0.875rem; height: 42px; padding:0.5rem 0.75rem; background:var(--color-bg); color:var(--color-text-main); border:1px solid var(--color-border); border-radius:var(--radius-md);">
            <option value="5x2.5" selected>5 x 2.5 cm (Horizontal chica)</option>
            <option value="5x5">5 x 5 cm (Cuadrada mediana)</option>
            <option value="10x15">10 x 15 cm (Vertical grande)</option>
          </select>
        </div>

        <div>
          <label style="font-weight: 600; display: block; margin-bottom: 0.25rem;">Componentes</label>
          <select id="swal-label-template" class="swal2-select" style="width: 100%; margin: 0; font-size: 0.875rem; height: 42px; padding:0.5rem 0.75rem; background:var(--color-bg); color:var(--color-text-main); border:1px solid var(--color-border); border-radius:var(--radius-md);">
            <option value="name+barcode" selected>Nombre + Código de barras</option>
            <option value="barcode">Sólo Código de barras</option>
          </select>
        </div>

        <div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 0.15rem;">
          <input type="checkbox" id="swal-label-readable" checked style="width: auto; cursor: pointer; margin: 0;">
          <label for="swal-label-readable" style="font-size: 0.85rem; cursor: pointer; user-select: none; color:var(--color-text-main);">Lectura humana (texto bajo barras)</label>
        </div>

        <div>
          <label style="font-weight: 600; display: block; margin-bottom: 0.25rem;">Origen del Código de Barras</label>
          <select id="swal-label-source" class="swal2-select" style="width: 100%; margin: 0; font-size: 0.875rem; height: 42px; padding:0.5rem 0.75rem; background:var(--color-bg); color:var(--color-text-main); border:1px solid var(--color-border); border-radius:var(--radius-md);">
            <option value="sku" selected>Usar SKU del Producto (${escapeHtml(defaultSku)})</option>
            <option value="barcode" ${!defaultBarcode ? 'disabled' : ''}>
              ${defaultBarcode ? `Usar Campo Código (${escapeHtml(defaultBarcode)})` : 'Código no definido en catálogo'}
            </option>
          </select>
        </div>

        <div style="display: flex; gap: 1rem; align-items: center;">
          <div style="flex: 1;">
            <label style="font-weight: 600; display: block; margin-bottom: 0.25rem;">Cantidad a Emitir</label>
            <input id="swal-label-qty" type="number" class="swal2-input" value="1" min="1" style="width: 100%; margin: 0; height: 42px; padding: 0.5rem 0.75rem; font-size: 0.875rem; background:var(--color-bg); color:var(--color-text-main); border:1px solid var(--color-border); border-radius:var(--radius-md);">
          </div>
        </div>

        <!-- Live preview box inside the modal -->
        <div>
          <label style="font-weight: 600; display: block; margin-bottom: 0.35rem;">Vista Previa de Impresión</label>
          <div id="swal-preview-wrapper" style="
            display: flex; 
            align-items: center; 
            justify-content: center; 
            background: var(--color-bg); 
            border: 1px solid var(--color-border); 
            border-radius: var(--radius-md); 
            padding: 1.25rem; 
            min-height: 180px;
          ">
            <!-- Simulated label -->
          </div>
        </div>
      </div>
    `;

    // Trigger sweetalert2 modal dialog
    const getSwalValues = () => {
      return {
        size: document.getElementById('swal-label-size').value,
        template: document.getElementById('swal-label-template').value,
        withHumanReadable: document.getElementById('swal-label-readable').checked,
        dataSource: document.getElementById('swal-label-source').value,
        qty: parseInt(document.getElementById('swal-label-qty').value, 10) || 1
      };
    };

    // Trigger sweetalert2 modal dialog
    Swal.fire({
      title: 'Emitir Etiqueta Individual',
      html: swalHtml,
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: '<i class="ri-printer-line" style="margin-right:0.25rem;"></i> Imprimir',
      denyButtonText: '<i class="ri-download-2-line" style="margin-right:0.25rem;"></i> Descargar ZPL',
      cancelButtonText: 'Cerrar',
      confirmButtonColor: 'var(--color-primary)',
      denyButtonColor: 'var(--color-accent)',
      focusConfirm: false,
      didOpen: () => {
        const modal = Swal.getHtmlContainer();
        const sizeSelect = modal.querySelector('#swal-label-size');
        const templateSelect = modal.querySelector('#swal-label-template');
        const readableCb = modal.querySelector('#swal-label-readable');
        const sourceSelect = modal.querySelector('#swal-label-source');
        const previewDiv = modal.querySelector('#swal-preview-wrapper');

        // Render preview inside swal dialog
        const updateSwalPreview = () => {
          const size = sizeSelect.value;
          const template = templateSelect.value;
          const withHumanReadable = readableCb.checked;
          const dataSource = sourceSelect.value;

          const codeVal = (dataSource === 'sku' || !defaultBarcode) ? defaultSku : defaultBarcode;
          const barcodeSVG = window.generateBarcodeSVG(codeVal, withHumanReadable, size);

          let w = '200px'; let h = '100px';
          let labelPadding = '6px';
          let nameFontSize = '7.5px';
          let maxNameHeight = '18px';

          if (size === '5x2.5') {
            w = '200px'; h = '100px'; labelPadding = '6px'; nameFontSize = '7.5px'; maxNameHeight = '18px';
          } else if (size === '5x5') {
            w = '140px'; h = '140px'; labelPadding = '8px'; nameFontSize = '9px'; maxNameHeight = '30px';
          } else if (size === '10x15') {
            w = '140px'; h = '210px'; labelPadding = '12px'; nameFontSize = '10.5px'; maxNameHeight = '42px';
          }

          let lengthWarning = '';
          if (size === '5x2.5' && codeVal.length > 15) {
            lengthWarning = `
              <div style="position:absolute;top:2px;right:2px;background:rgba(245,158,11,0.15);color:var(--color-warning);border:1px solid rgba(245,158,11,0.3);border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:bold;" title="El código de barras es muy largo y podría desembarcar en la etiqueta física.">!</div>
            `;
          }

          previewDiv.innerHTML = `
            <div style="
              position: relative;
              width: ${w};
              height: ${h};
              background: white;
              color: black;
              border: 1px dashed var(--color-border);
              padding: ${labelPadding};
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              box-shadow: var(--shadow-sm);
              box-sizing: border-box;
              overflow: hidden;
            ">
              ${lengthWarning}
              ${template === 'name+barcode' ? `
                <div style="
                  font-size: ${nameFontSize};
                  font-weight: 700;
                  line-height: 1.1;
                  margin-bottom: 4px;
                  max-height: ${maxNameHeight};
                  overflow: hidden;
                  display: -webkit-box;
                  -webkit-line-clamp: 2;
                  -webkit-box-orient: vertical;
                  width: 100%;
                  word-break: break-word;
                  color: #000;
                ">${escapeHtml(product.name)}</div>
              ` : ''}
              <div style="width: 100%; display: flex; justify-content: center; align-items: center; flex: 1; overflow: hidden;">
                ${barcodeSVG}
              </div>
              ${size === '10x15' ? `
                <div style="font-size: 8px; color: #555; text-align: left; width: 100%; border-top: 1px dashed #ddd; padding-top: 4px; margin-top: 4px; display: flex; justify-content: space-between;">
                  <span>SKU: ${escapeHtml(product.sku)}</span>
                  <span>STOCKA WMS</span>
                </div>
              ` : ''}
            </div>
          `;
        };

        // Attach listeners for live changes inside sweetalert
        [sizeSelect, templateSelect, readableCb, sourceSelect].forEach(el => {
          el?.addEventListener('change', updateSwalPreview);
        });

        // First render
        updateSwalPreview();
      },
      preConfirm: getSwalValues,
      preDeny: getSwalValues
    }).then((result) => {
      if (result.isConfirmed && result.value) {
        const opts = result.value;
        const singleQueue = [{
          id: product.id,
          sku: product.sku,
          name: product.name,
          barcode: product.barcode || '',
          qty: opts.qty
        }];
        window.printLabels(singleQueue, opts);
      } else if (result.isDenied && result.value) {
        const opts = result.value;
        const singleQueue = [{
          id: product.id,
          sku: product.sku,
          name: product.name,
          barcode: product.barcode || '',
          qty: opts.qty
        }];
        window.showZPLModal(singleQueue, opts);
      }
    });
  };

  /**
   * Compiles ZPL code for the given queue and configuration (at 203 DPI)
   */
  window.compileZPL = function (queue, options) {
    let zpl = '';
    
    let pw = 400; // print width
    let ll = 200; // label length
    let barcodeHeight = 60;
    let barcodeWidth = 2;
    
    if (options.size === '5x5') {
      pw = 400;
      ll = 400;
      barcodeHeight = 120;
    } else if (options.size === '10x15') {
      pw = 800;
      ll = 1200;
      barcodeHeight = 250;
      barcodeWidth = 3;
    }
    
    queue.forEach(item => {
      const codeVal = (options.dataSource === 'sku' || !item.barcode) ? item.sku : item.barcode;
      const isReadable = options.withHumanReadable ? 'Y' : 'N';
      
      const cleanName = (item.name || '').substring(0, 80).replace(/[\^\~]/g, ''); 
      const cleanSku = (item.sku || '').replace(/[\^\~]/g, '');
      const cleanCode = (codeVal || '').replace(/[\^\~]/g, '');
      
      for (let c = 0; c < item.qty; c++) {
        zpl += `^XA\n`;
        zpl += `^CI28\n`; // Enable UTF-8 encoding
        zpl += `^PW${pw}\n`;
        zpl += `^LL${ll}\n`;
        zpl += `^LH0,0\n`;
        
        if (options.size === '5x2.5') {
          if (options.template === 'name+barcode') {
            const line1 = cleanName.substring(0, 30);
            const line2 = cleanName.substring(30, 60);
            zpl += `^FO20,20^A0N,18,18^FD${line1}^FS\n`;
            if (line2) {
              zpl += `^FO20,40^A0N,18,18^FD${line2}^FS\n`;
            }
            zpl += `^BY${barcodeWidth},3,${barcodeHeight}^FT20,150^BCN,70,${isReadable},N,N^FD${cleanCode}^FS\n`;
          } else {
            zpl += `^BY${barcodeWidth},3,${barcodeHeight}^FT20,130^BCN,90,${isReadable},N,N^FD${cleanCode}^FS\n`;
          }
        } else if (options.size === '5x5') {
          if (options.template === 'name+barcode') {
            const line1 = cleanName.substring(0, 25);
            const line2 = cleanName.substring(25, 50);
            const line3 = cleanName.substring(50, 75);
            zpl += `^FO20,30^A0N,22,20^FD${line1}^FS\n`;
            if (line2) zpl += `^FO20,55^A0N,22,20^FD${line2}^FS\n`;
            if (line3) zpl += `^FO20,80^A0N,22,20^FD${line3}^FS\n`;
            zpl += `^BY${barcodeWidth},3,${barcodeHeight}^FT20,320^BCN,140,${isReadable},N,N^FD${cleanCode}^FS\n`;
          } else {
            zpl += `^BY${barcodeWidth},3,${barcodeHeight}^FT20,280^BCN,180,${isReadable},N,N^FD${cleanCode}^FS\n`;
          }
        } else if (options.size === '10x15') {
          if (options.template === 'name+barcode') {
            const line1 = cleanName.substring(0, 35);
            const line2 = cleanName.substring(35, 70);
            const line3 = cleanName.substring(70, 105);
            zpl += `^FO40,60^A0N,36,32^FD${line1}^FS\n`;
            if (line2) zpl += `^FO40,105^A0N,36,32^FD${line2}^FS\n`;
            if (line3) zpl += `^FO40,150^A0N,36,32^FD${line3}^FS\n`;
            zpl += `^BY${barcodeWidth},3,${barcodeHeight}^FT40,820^BCN,350,${isReadable},N,N^FD${cleanCode}^FS\n`;
          } else {
            zpl += `^BY${barcodeWidth},3,${barcodeHeight}^FT40,750^BCN,420,${isReadable},N,N^FD${cleanCode}^FS\n`;
          }
          zpl += `^FO40,1100^A0N,26,24^FDSKU: ${cleanSku} | WMS STOCKA^FS\n`;
        }
        
        zpl += `^XZ\n`;
      }
    });
    
    return zpl;
  };

  /**
   * Compiles and downloads a ZPL file
   */
  window.downloadZPLFile = function (queue, options) {
    const zplCode = window.compileZPL(queue, options);
    const blob = new Blob([zplCode], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `etiquetas_${options.size}_${Date.now()}.zpl`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /**
   * Compiles ZPL code and displays it in a copyable Swal modal.
   */
  window.showZPLModal = function (queue, options) {
    const zplCode = window.compileZPL(queue, options);
    
    Swal.fire({
      title: 'Código ZPL II Generado',
      html: `
        <div style="text-align: left; margin-bottom: 0.75rem;">
          <span style="font-size: 0.85rem; color: var(--color-text-muted);">Puedes copiar este código y pegarlo en Zebra Setup Utilities o en tu software de impresión local.</span>
        </div>
        <textarea id="swal-zpl-code-area" readonly style="
          width: 100%; 
          height: 180px; 
          font-family: monospace; 
          font-size: 0.8rem; 
          padding: 0.5rem; 
          background: var(--color-bg); 
          color: var(--color-text-main); 
          border: 1px solid var(--color-border); 
          border-radius: var(--radius-md); 
          resize: none;
          box-sizing: border-box;
        ">${escapeHtml(zplCode)}</textarea>
      `,
      showCancelButton: true,
      confirmButtonText: '<i class="ri-clipboard-line" style="margin-right:0.25rem;"></i> Copiar Código',
      cancelButtonText: 'Cerrar',
      denyButtonText: '<i class="ri-download-2-line" style="margin-right:0.25rem;"></i> Descargar Archivo',
      showDenyButton: true,
      confirmButtonColor: 'var(--color-success)',
      denyButtonColor: 'var(--color-primary)',
      focusConfirm: false,
      preConfirm: () => {
        const textarea = document.getElementById('swal-zpl-code-area');
        if (textarea) {
          textarea.select();
          document.execCommand('copy');
        }
        if (navigator.clipboard) {
          navigator.clipboard.writeText(zplCode);
        }
        return true;
      }
    }).then((result) => {
      if (result.isConfirmed) {
        Swal.fire({
          title: 'Copiado',
          text: 'Código ZPL copiado al portapapeles.',
          icon: 'success',
          timer: 1500,
          showConfirmButton: false
        });
      } else if (result.isDenied) {
        window.downloadZPLFile(queue, options);
      }
    });
  };

  /**
   * Main label compilation and physical printer mapping engine.
   * Compiles the label queue, styles CSS physical boundaries,
   * generates high-fidelity SVG codes, outputs to an iframe, and opens print dialog.
   */
  window.printLabels = function (queue, options) {
    if (!queue || queue.length === 0) return;

    // Build the compiled label pages (expanding quantities)
    let labelPagesHTML = '';

    queue.forEach(item => {
      const codeVal = (options.dataSource === 'sku' || !item.barcode) ? item.sku : item.barcode;
      const barcodeSVG = window.generateBarcodeSVG(codeVal, options.withHumanReadable, options.size);

      // Render copies for physical printing pages
      for (let c = 0; c < item.qty; c++) {
        labelPagesHTML += `
          <div class="label-page size-${options.size}">
            ${options.template === 'name+barcode' ? `
              <div class="label-name">${escapeHtml(item.name)}</div>
            ` : ''}

            <div class="barcode-container">
              ${barcodeSVG}
            </div>

            ${options.size === '10x15' ? `
              <div class="extra-info">
                <div style="display: flex; justify-content: space-between;">
                  <strong>SKU: ${escapeHtml(item.sku)}</strong>
                  <span>STOCKA WMS</span>
                </div>
              </div>
            ` : ''}
          </div>
        `;
      }
    });

    // Create print layout styling context
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Imprimir Etiquetas - WMS Stocka</title>
        <style>
          /* Core Print Styles */
          html, body {
            margin: 0;
            padding: 0;
            background: #fff;
            color: #000;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            -webkit-print-color-adjust: exact;
          }
          
          .label-page {
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            overflow: hidden;
            position: relative;
            background: #fff;
            page-break-after: always;
          }

          /* Remove page break on the very last sticker to prevent blank pages */
          .label-page:last-child {
            page-break-after: avoid;
          }

          /* 1. Size Format: 5x2.5 cm (horizontal) */
          .size-5x2-5 {
            width: 5cm;
            height: 2.5cm;
            padding: 0.2cm 0.25cm;
          }
          .size-5x2-5 .label-name {
            font-size: 7.5px;
            font-weight: 700;
            line-height: 1.15;
            margin-bottom: 2px;
            max-height: 18px; /* 1-2 lines max */
            width: 100%;
            overflow: hidden;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            word-break: break-all;
          }
          
          /* 2. Size Format: 5x5 cm (square) */
          .size-5x5 {
            width: 5cm;
            height: 5cm;
            padding: 0.35cm 0.35cm;
          }
          .size-5x5 .label-name {
            font-size: 10px;
            font-weight: 700;
            line-height: 1.2;
            margin-bottom: 4px;
            max-height: 38px;
            width: 100%;
            overflow: hidden;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            word-break: break-all;
          }

          /* 3. Size Format: 10x15 cm (large shipping) */
          .size-10x15 {
            width: 10cm;
            height: 15cm;
            padding: 0.7cm 0.8cm;
          }
          .size-10x15 .label-name {
            font-size: 18px;
            font-weight: 700;
            line-height: 1.25;
            margin-bottom: 12px;
            max-height: 90px;
            width: 100%;
            overflow: hidden;
            display: -webkit-box;
            -webkit-line-clamp: 4;
            -webkit-box-orient: vertical;
            word-break: break-word;
          }

          .barcode-container {
            width: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
            flex: 1;
            overflow: hidden;
          }

          .barcode-container svg {
            max-width: 100%;
            height: auto;
            display: block;
          }

          .extra-info {
            width: 100%;
            margin-top: 12px;
            padding-top: 6px;
            border-top: 1px dashed #333;
            font-size: 11px;
            text-align: left;
          }

          /* CSS Page margin and size rules based on selection */
          @page {
            size: ${options.size === '5x2.5' ? '5cm 2.5cm' : (options.size === '5x5' ? '5cm 5cm' : '10cm 15cm')};
            margin: 0;
          }
          
          @media print {
            body {
              background: #fff;
            }
          }
        </style>
      </head>
      <body>
        ${labelPagesHTML}
      </body>
      </html>
    `;

    // Deploy hidden print Frame
    const iframe = document.createElement('iframe');
    iframe.id = 'wms-print-labels-iframe';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    iframe.style.zIndex = '-9999';
    document.body.appendChild(iframe);

    // Ingress content
    const frameDoc = iframe.contentWindow.document || iframe.contentDocument;
    frameDoc.open();
    frameDoc.write(htmlContent);
    frameDoc.close();

    // Trigger printing dialog
    setTimeout(() => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (err) {
        console.error("Failed to open native print dialog:", err);
        Swal.fire('Error', 'No se pudo abrir el cuadro de impresión nativo del navegador.', 'error');
      } finally {
        // Clean up document body from hidden elements
        setTimeout(() => {
          const element = document.getElementById('wms-print-labels-iframe');
          if (element) element.remove();
        }, 1000);
      }
    }, 500);
  };

  /**
   * Helper to escape HTML characters
   */
  function escapeHtml(text) {
    if (!text) return '';
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.toString().replace(/[&<>"']/g, function (m) { return map[m]; });
  }

  window.showShippingLabelModal = async function(orderId) {
    if (typeof Swal === 'undefined') {
      alert("Error: SweetAlert2 no está cargado.");
      return;
    }

    Swal.fire({
      title: 'Cargando datos del pedido...',
      text: 'Por favor, espere mientras obtenemos los detalles del pedido.',
      allowOutsideClick: false,
      showConfirmButton: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    let order = null;
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          order_items (
            quantity,
            products (
              id,
              sku,
              name,
              price
            )
          )
        `)
        .eq('id', orderId)
        .single();
       
      if (error) throw error;
      order = data;
    } catch (err) {
      console.error("Error fetching order:", err);
      Swal.fire('Error', 'No se pudo cargar la información del pedido: ' + err.message, 'error');
      return;
    }

    if (!order) {
      Swal.fire('Error', 'Pedido no encontrado.', 'error');
      return;
    }

    // Determine fallback values for customer details
    let displayName = order.customer_name;
    if (!displayName || displayName === 'No registrado' || displayName.trim() === '') {
      if (order.raw_shopify_data) {
        const raw = order.raw_shopify_data;
        const billing = raw.billing_address;
        const cust = raw.customer;
        if (billing) displayName = `${billing.first_name || ''} ${billing.last_name || ''}`.trim();
        else if (cust) displayName = `${cust.first_name || ''} ${cust.last_name || ''}`.trim();
      }
      if (!displayName || displayName.trim() === '') displayName = 'No registrado';
    }

    let displayPhone = order.customer_phone;
    if (!displayPhone || displayPhone === 'No registrado' || displayPhone.trim() === '') {
      if (order.raw_shopify_data) {
        const raw = order.raw_shopify_data;
        displayPhone = raw.shipping_address?.phone || raw.billing_address?.phone || raw.customer?.phone || '';
      }
      if (!displayPhone || displayPhone.trim() === '') displayPhone = 'No registrado';
    }

    const modalHtml = `
      <div style="text-align: left; font-family: 'Inter', sans-serif;">
        <p style="margin-bottom: 1rem; font-size: 0.9rem; color: var(--color-text-muted);">
          Genera una etiqueta de despacho personalizada para el pedido <strong>#${order.external_order_number || order.id.split('-')[0]}</strong>.
        </p>
        
        <div class="form-group" style="margin-bottom: 1rem;">
          <label class="form-label" style="font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.85rem;">Formato de Etiqueta:</label>
          <select id="swal-label-size" class="form-input" style="width: 100%; height: 38px; padding: 0.35rem 0.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); color: var(--color-text-main);">
            <option value="10x15" selected>10 x 15 cm (Recomendado para Courier / Despacho)</option>
            <option value="5x5">5 x 5 cm (Formato Cuadrado Compacto)</option>
          </select>
        </div>

        <div class="form-group" style="margin-bottom: 1rem;">
          <label class="form-label" style="font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.85rem;">Courier / Operador:</label>
          <input type="text" id="swal-label-courier" class="form-input" value="${escapeHtml(order.courier || '')}" placeholder="Ej: Starken, Chilexpress, Starken por pagar" style="width: 100%; height: 38px; padding: 0.35rem 0.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); color: var(--color-text-main);" />
        </div>

        <div class="form-group" style="margin-bottom: 1rem;">
          <label class="form-label" style="font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.85rem;">Comentario de Cabecera (Head):</label>
          <input type="text" id="swal-label-head-comment" class="form-input" placeholder="Ej: ¡FRÁGIL! / ENTREGAR EN CONSERJERÍA" style="width: 100%; height: 38px; padding: 0.35rem 0.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); color: var(--color-text-main);" />
        </div>

        <div class="form-group" style="margin-bottom: 1rem;">
          <label class="form-label" style="font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.85rem;">Comentario de Pie (Footer):</label>
          <input type="text" id="swal-label-foot-comment" class="form-input" placeholder="Ej: Gracias por su compra / Entregar antes de las 18:00" style="width: 100%; height: 38px; padding: 0.35rem 0.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); color: var(--color-text-main);" />
        </div>
      </div>
    `;

    Swal.fire({
      title: '<i class="ri-printer-line" style="color:var(--color-primary); margin-right: 0.5rem;"></i>Etiqueta de Despacho Stocka',
      html: modalHtml,
      showCancelButton: true,
      confirmButtonText: '<i class="ri-printer-line" style="margin-right:0.25rem;"></i> Imprimir',
      cancelButtonText: 'Cancelar',
      customClass: {
        confirmButton: 'btn btn-primary',
        cancelButton: 'btn btn-outline'
      },
      preConfirm: () => {
        return {
          size: document.getElementById('swal-label-size').value,
          courier: document.getElementById('swal-label-courier').value.trim(),
          headComment: document.getElementById('swal-label-head-comment').value.trim(),
          footComment: document.getElementById('swal-label-foot-comment').value.trim()
        };
      }
    }).then((result) => {
      if (result.isConfirmed) {
        const { size, courier, headComment, footComment } = result.value;
        window.printCustomShippingLabel(order, displayName, displayPhone, { size, courier, headComment, footComment });
      }
    });
  };

  window.showBulkShippingLabelModal = async function(customIds) {
    if (typeof Swal === 'undefined') {
      alert("Error: SweetAlert2 no está cargado.");
      return;
    }

    const orderIds = customIds || Array.from(window.wmsSelectedOrderIds || []);
    if (orderIds.length === 0) {
      Swal.fire('Atención', 'No hay pedidos seleccionados.', 'warning');
      return;
    }

    Swal.fire({
      title: 'Cargando datos...',
      text: `Por favor, espere mientras obtenemos los detalles de los ${orderIds.length} pedidos.`,
      allowOutsideClick: false,
      showConfirmButton: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    let orders = [];
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          order_items (
            quantity,
            products (
              id,
              sku,
              name,
              price
            )
          )
        `)
        .in('id', orderIds);
       
      if (error) throw error;
      orders = data || [];
    } catch (err) {
      console.error("Error fetching orders:", err);
      Swal.fire('Error', 'No se pudieron cargar los pedidos: ' + err.message, 'error');
      return;
    }

    if (orders.length === 0) {
      Swal.fire('Error', 'No se encontraron los pedidos.', 'error');
      return;
    }

    const modalHtml = `
      <div style="text-align: left; font-family: 'Inter', sans-serif;">
        <p style="margin-bottom: 1rem; font-size: 0.9rem; color: var(--color-text-muted);">
          Genera etiquetas de despacho masivas para los <strong>${orders.length}</strong> pedidos seleccionados con la misma información de comentarios y courier.
        </p>
        
        <div class="form-group" style="margin-bottom: 1rem;">
          <label class="form-label" style="font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.85rem;">Formato de Etiquetas:</label>
          <select id="swal-bulk-label-size" class="form-input" style="width: 100%; height: 38px; padding: 0.35rem 0.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); color: var(--color-text-main);">
            <option value="10x15" selected>10 x 15 cm (Recomendado para Courier / Despacho)</option>
            <option value="5x5">5 x 5 cm (Formato Cuadrado Compacto)</option>
          </select>
        </div>

        <div class="form-group" style="margin-bottom: 1rem;">
          <label class="form-label" style="font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.85rem;">Courier / Operador (Opcional - Aplica a todos):</label>
          <input type="text" id="swal-bulk-label-courier" class="form-input" placeholder="Ej: Starken, Chilexpress, Starken por pagar" style="width: 100%; height: 38px; padding: 0.35rem 0.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); color: var(--color-text-main);" />
          <span style="font-size: 0.72rem; color: var(--color-text-muted);">Dejar vacío para usar el courier original de cada pedido.</span>
        </div>

        <div class="form-group" style="margin-bottom: 1rem;">
          <label class="form-label" style="font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.85rem;">Comentario de Cabecera (Head):</label>
          <input type="text" id="swal-bulk-label-head-comment" class="form-input" placeholder="Ej: ¡FRÁGIL! / ENTREGAR EN CONSERJERÍA" style="width: 100%; height: 38px; padding: 0.35rem 0.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); color: var(--color-text-main);" />
        </div>

        <div class="form-group" style="margin-bottom: 1rem;">
          <label class="form-label" style="font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.85rem;">Comentario de Pie (Footer):</label>
          <input type="text" id="swal-bulk-label-foot-comment" class="form-input" placeholder="Ej: Gracias por su compra / Entregar antes de las 18:00" style="width: 100%; height: 38px; padding: 0.35rem 0.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); color: var(--color-text-main);" />
        </div>
      </div>
    `;

    Swal.fire({
      title: '<i class="ri-printer-line" style="color:var(--color-primary); margin-right: 0.5rem;"></i>Etiquetas Masivas Stocka',
      html: modalHtml,
      showCancelButton: true,
      confirmButtonText: '<i class="ri-printer-line" style="margin-right:0.25rem;"></i> Imprimir',
      cancelButtonText: 'Cancelar',
      customClass: {
        confirmButton: 'btn btn-primary',
        cancelButton: 'btn btn-outline'
      },
      preConfirm: () => {
        return {
          size: document.getElementById('swal-bulk-label-size').value,
          courier: document.getElementById('swal-bulk-label-courier').value.trim(),
          headComment: document.getElementById('swal-bulk-label-head-comment').value.trim(),
          footComment: document.getElementById('swal-bulk-label-foot-comment').value.trim()
        };
      }
    }).then((result) => {
      if (result.isConfirmed) {
        const { size, courier, headComment, footComment } = result.value;
        window.printBulkCustomShippingLabels(orders, { size, courier, headComment, footComment });
      }
    });
  };

  window.printCustomShippingLabel = function (order, displayName, displayPhone, options) {
    const selectedSize = options.size || '10x15';
    
    // Generate barcode SVG for the external order number (fallback to id)
    const codeVal = order.external_order_number || order.id;
    // Generate barcode with JsBarcode
    const barcodeSVG = window.generateBarcodeSVG(codeVal, true, selectedSize);

    let labelContentHTML = '';
    const courierVal = options.courier || order.courier || 'POR DEFINIR';

    if (selectedSize === '10x15') {
      labelContentHTML = `
        <div class="label-page size-10x15">
          <!-- Cabecera -->
          <div class="header-section">
            <img src="https://cdn.shopify.com/s/files/1/0625/6141/9483/files/newlogotransp.png?v=1779852093" class="logo-img" alt="STOCKA">
            <div class="title-container">
              <div class="main-title">ETIQUETA DE DESPACHO</div>
              <div class="sub-title">STOCKA LOGÍSTICA WMS</div>
            </div>
          </div>

          ${options.headComment ? `<div class="head-comment-box">${escapeHtml(options.headComment)}</div>` : ''}

          <!-- Datos de Envío / Courier -->
          <div class="shipping-info-grid">
            <div class="info-block">
              <span class="block-title">COURIER / OPERADOR</span>
              <span class="block-value highlighted-courier">${escapeHtml(courierVal)}</span>
            </div>
            <div class="info-block">
              <span class="block-title">MÉTODO DE ENVÍO</span>
              <span class="block-value">${escapeHtml(order.shipping_method || 'ESTÁNDAR')}</span>
            </div>
          </div>

          <!-- Destinatario -->
          <div class="destinatario-section">
            <div class="section-title">DESTINATARIO</div>
            <div class="dest-name">${escapeHtml(displayName)}</div>
            <div class="dest-address">${escapeHtml(order.shipping_address || 'Sin dirección')} ${order.shipping_complement ? `, ${escapeHtml(order.shipping_complement)}` : ''}</div>
            <div class="dest-city-commune">${escapeHtml(order.shipping_city || 'Sin comuna')}</div>
            <div class="dest-contact">Teléfono: ${escapeHtml(displayPhone)}</div>
          </div>

          <!-- Remitente y Pedido -->
          <div class="origin-grid">
            <div class="info-block">
              <span class="block-title">REMITENTE (TIENDA)</span>
              <span class="block-value">${escapeHtml(order.comercio || 'STOCKA CLIENTE')}</span>
            </div>
            <div class="info-block">
              <span class="block-title">REFERENCIA PEDIDO</span>
              <span class="block-value">#${escapeHtml(order.external_order_number || order.id.split('-')[0])}</span>
            </div>
          </div>

          <!-- Barcode de Referencia -->
          <div class="barcode-wrapper">
            ${barcodeSVG}
          </div>

          <!-- Detalle de Productos -->
          <div class="items-section">
            <div class="section-title">DETALLE DE PRODUCTOS (PICKING & PACKING)</div>
            <table class="items-table">
              <thead>
                <tr>
                  <th style="width: 25%; text-align: left;">SKU</th>
                  <th style="width: 60%; text-align: left;">Producto</th>
                  <th style="width: 15%; text-align: center;">Cant</th>
                </tr>
              </thead>
              <tbody>
                ${order.order_items && order.order_items.length > 0 ? order.order_items.map(oi => `
                  <tr>
                    <td style="font-family: monospace; font-weight: bold;">${escapeHtml(oi.products?.sku || 'Sin SKU')}</td>
                    <td style="font-size: 9px; line-height: 1.1;">${escapeHtml(oi.products?.name || 'Sin nombre')}</td>
                    <td style="text-align: center; font-weight: bold; font-size: 11px;">${oi.quantity || 1}</td>
                  </tr>
                `).join('') : `
                  <tr>
                    <td style="font-family: monospace; font-weight: bold;">${escapeHtml(order.sku || 'Sin SKU')}</td>
                    <td style="font-size: 9px; line-height: 1.1;">${escapeHtml(order.item || 'Sin nombre')}</td>
                    <td style="text-align: center; font-weight: bold; font-size: 11px;">${order.cantidad || 1}</td>
                  </tr>
                `}
              </tbody>
            </table>
          </div>

          ${options.footComment ? `<div class="foot-comment-box">${escapeHtml(options.footComment)}</div>` : ''}

          <!-- Pie de Página -->
          <div class="footer-section">
            <span>Preparado y despachado desde Centro de Distribución STOCKA</span>
          </div>
        </div>
      `;
    } else {
      // 5x5 cm square format
      labelContentHTML = `
        <div class="label-page size-5x5">
          <div class="compact-header">
            <img src="https://cdn.shopify.com/s/files/1/0625/6141/9483/files/newlogotransp.png?v=1779852093" style="height: 14px; object-fit: contain;">
            <span style="font-size: 7px; font-weight: 800; color: #000; letter-spacing: 0.3px;">DESPACHO</span>
          </div>

          ${options.headComment ? `<div class="compact-comment">${escapeHtml(options.headComment)}</div>` : ''}

          <div class="compact-destinatario">
            <div style="font-size: 9px; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(displayName)}</div>
            <div style="font-size: 7px; line-height: 1.1; max-height: 22px; overflow: hidden;">
              ${escapeHtml(order.shipping_address || 'Sin dir.')}
            </div>
            <div style="font-size: 8px; font-weight: bold; margin-top: 1px;">
              ${escapeHtml(order.shipping_city || 'Sin comuna')}
            </div>
            <div style="font-size: 7px;">Tel: ${escapeHtml(displayPhone)}</div>
          </div>

          <div class="compact-order-info" style="display: flex; justify-content: space-between; font-size: 7px; border-top: 1px dashed #333; padding-top: 1px; margin-top: 2px;">
            <span>REF: #${escapeHtml(order.external_order_number || order.id.split('-')[0])}</span>
            <span style="font-weight: bold;">${escapeHtml(courierVal)}</span>
          </div>

          <!-- Barcode de Referencia -->
          <div class="compact-barcode-wrapper" style="margin: 2px 0;">
            ${barcodeSVG}
          </div>

          ${options.footComment ? `<div class="compact-comment foot">${escapeHtml(options.footComment)}</div>` : ''}

          <div class="compact-footer" style="font-size: 6px; text-align: center; color: #555; margin-top: auto;">
            STOCKA LOGÍSTICA WMS
          </div>
        </div>
      `;
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Imprimir Etiqueta Stocka - WMS</title>
        <style>
          /* Core Print Styles */
          html, body {
            margin: 0;
            padding: 0;
            background: #fff;
            color: #000;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            -webkit-print-color-adjust: exact;
          }
          
          .label-page {
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            position: relative;
            background: #fff;
            page-break-after: always;
          }

          .label-page:last-child {
            page-break-after: avoid;
          }

          /* Size: 10x15 cm */
          .size-10x15 {
            width: 10cm;
            height: 15cm;
            padding: 0.6cm 0.6cm;
            border: 1px solid #000;
          }
          
          @media print {
            .size-10x15, .size-5x5 {
              border: none !important;
            }
          }

          .size-10x15 .header-section {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 2px solid #000;
            padding-bottom: 6px;
            margin-bottom: 8px;
          }

          .size-10x15 .logo-img {
            height: 24px;
            max-width: 100px;
            object-fit: contain;
          }

          .size-10x15 .title-container {
            text-align: right;
          }

          .size-10x15 .main-title {
            font-size: 14px;
            font-weight: 900;
            letter-spacing: 0.5px;
          }

          .size-10x15 .sub-title {
            font-size: 9px;
            color: #444;
            font-weight: 600;
          }

          .head-comment-box {
            background: #000;
            color: #fff;
            text-align: center;
            font-weight: 800;
            font-size: 11px;
            padding: 4px;
            border-radius: 2px;
            margin-bottom: 8px;
            text-transform: uppercase;
          }

          .foot-comment-box {
            border: 2px dashed #000;
            text-align: center;
            font-weight: 700;
            font-size: 10px;
            padding: 4px;
            margin-top: 6px;
            margin-bottom: 6px;
            text-transform: uppercase;
          }

          .shipping-info-grid, .origin-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            border: 1px solid #000;
            margin-bottom: 8px;
          }

          .info-block {
            padding: 4px 6px;
            display: flex;
            flex-direction: column;
            justify-content: center;
          }

          .info-block:first-child {
            border-right: 1px solid #000;
          }

          .block-title {
            font-size: 7px;
            font-weight: bold;
            color: #555;
            text-transform: uppercase;
            margin-bottom: 2px;
          }

          .block-value {
            font-size: 10px;
            font-weight: bold;
          }

          .highlighted-courier {
            font-size: 13px !important;
            font-weight: 900 !important;
          }

          .destinatario-section {
            border: 2px solid #000;
            padding: 8px 10px;
            margin-bottom: 8px;
            background: #fdfdfd;
          }

          .section-title {
            font-size: 8px;
            font-weight: bold;
            color: #000;
            border-bottom: 1px solid #000;
            padding-bottom: 2px;
            margin-bottom: 4px;
            letter-spacing: 0.3px;
          }

          .dest-name {
            font-size: 14px;
            font-weight: 800;
            margin-bottom: 2px;
          }

          .dest-address {
            font-size: 11px;
            line-height: 1.2;
            margin-bottom: 2px;
          }

          .dest-city-commune {
            font-size: 13px;
            font-weight: 900;
            text-transform: uppercase;
            margin-bottom: 2px;
          }

          .dest-contact {
            font-size: 10px;
            font-weight: 600;
          }

          .barcode-wrapper {
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 8px 0;
            border: 1px solid #000;
            margin-bottom: 8px;
          }

          .barcode-wrapper svg {
            max-width: 100%;
            height: auto;
          }

          .items-section {
            border: 1px solid #000;
            padding: 6px;
            flex-grow: 1;
            display: flex;
            flex-direction: column;
          }

          .items-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10px;
          }

          .items-table th {
            font-size: 8px;
            color: #333;
            border-bottom: 1px solid #000;
            padding: 2px 4px;
          }

          .items-table td {
            border-bottom: 1px dashed #ccc;
            padding: 3px 4px;
            vertical-align: middle;
          }

          .items-table tr:last-child td {
            border-bottom: none;
          }

          .footer-section {
            border-top: 1px solid #000;
            padding-top: 4px;
            margin-top: 8px;
            font-size: 8px;
            text-align: center;
            font-weight: 600;
            color: #444;
          }

          /* Size: 5x5 cm */
          .size-5x5 {
            width: 5cm;
            height: 5cm;
            padding: 0.35cm 0.35cm;
            border: 1px dashed #000;
            display: flex;
            flex-direction: column;
          }

          .compact-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid #000;
            padding-bottom: 2px;
            margin-bottom: 2px;
          }

          .compact-comment {
            background: #000;
            color: #fff;
            text-align: center;
            font-weight: bold;
            font-size: 7px;
            padding: 2px;
            border-radius: 1px;
            text-transform: uppercase;
            margin: 1px 0;
          }

          .compact-comment.foot {
            background: transparent;
            color: #000;
            border: 1px dashed #000;
          }

          .compact-destinatario {
            text-align: left;
            margin-bottom: 2px;
          }

          .compact-barcode-wrapper {
            display: flex;
            justify-content: center;
            align-items: center;
          }

          .compact-barcode-wrapper svg {
            max-width: 100%;
            height: auto;
          }

          /* CSS Page margin and size rules based on selection */
          @page {
            size: ${selectedSize === '5x5' ? '5cm 5cm' : '10cm 15cm'};
            margin: 0;
          }
        </style>
      </head>
      <body>
        ${labelContentHTML}
      </body>
      </html>
    `;

    // Deploy hidden print Frame
    const iframe = document.createElement('iframe');
    iframe.id = 'wms-print-labels-iframe';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    iframe.style.zIndex = '-9999';
    document.body.appendChild(iframe);

    // Ingress content
    const frameDoc = iframe.contentWindow.document || iframe.contentDocument;
    frameDoc.open();
    frameDoc.write(htmlContent);
    frameDoc.close();

    // Trigger printing dialog after loaded
    const printWindow = iframe.contentWindow;
    const images = printWindow.document.getElementsByTagName('img');
    let loadedImages = 0;
    const totalImages = images.length;

    const proceedToPrint = () => {
      try {
        printWindow.focus();
        printWindow.print();
      } catch (err) {
        console.error("Failed to open native print dialog:", err);
        Swal.fire('Error', 'No se pudo abrir el cuadro de impresión nativo.', 'error');
      } finally {
        setTimeout(() => {
          iframe.remove();
        }, 1000);
      }
    };

    if (totalImages === 0) {
      setTimeout(proceedToPrint, 500);
    } else {
      let printed = false;
      // Safety timeout of 1.5 seconds in case image fails to load
      const safetyTimeout = setTimeout(() => {
        if (!printed) {
          printed = true;
          proceedToPrint();
        }
      }, 1500);

      Array.from(images).forEach(img => {
        if (img.complete) {
          loadedImages++;
          if (loadedImages === totalImages && !printed) {
            clearTimeout(safetyTimeout);
            printed = true;
            setTimeout(proceedToPrint, 300);
          }
        } else {
          img.onload = img.onerror = () => {
            loadedImages++;
            if (loadedImages === totalImages && !printed) {
              clearTimeout(safetyTimeout);
              printed = true;
              setTimeout(proceedToPrint, 300);
            }
          };
        }
      });
    }
  };

  window.printBulkCustomShippingLabels = function (orders, options) {
    const selectedSize = options.size || '10x15';
    let labelPagesHTML = '';

    orders.forEach(order => {
      // Determine fallback values for customer details
      let displayName = order.customer_name;
      if (!displayName || displayName === 'No registrado' || displayName.trim() === '') {
        if (order.raw_shopify_data) {
          const raw = order.raw_shopify_data;
          const billing = raw.billing_address;
          const cust = raw.customer;
          if (billing) displayName = `${billing.first_name || ''} ${billing.last_name || ''}`.trim();
          else if (cust) displayName = `${cust.first_name || ''} ${cust.last_name || ''}`.trim();
        }
        if (!displayName || displayName.trim() === '') displayName = 'No registrado';
      }

      let displayPhone = order.customer_phone;
      if (!displayPhone || displayPhone === 'No registrado' || displayPhone.trim() === '') {
        if (order.raw_shopify_data) {
          const raw = order.raw_shopify_data;
          displayPhone = raw.shipping_address?.phone || raw.billing_address?.phone || raw.customer?.phone || '';
        }
        if (!displayPhone || displayPhone.trim() === '') displayPhone = 'No registrado';
      }

      const codeVal = order.external_order_number || order.id;
      const barcodeSVG = window.generateBarcodeSVG(codeVal, true, selectedSize);
      const courierVal = options.courier || order.courier || 'POR DEFINIR';

      if (selectedSize === '10x15') {
        labelPagesHTML += `
          <div class="label-page size-10x15">
            <!-- Cabecera -->
            <div class="header-section">
              <img src="https://cdn.shopify.com/s/files/1/0625/6141/9483/files/newlogotransp.png?v=1779852093" class="logo-img" alt="STOCKA">
              <div class="title-container">
                <div class="main-title">ETIQUETA DE DESPACHO</div>
                <div class="sub-title">STOCKA LOGÍSTICA WMS</div>
              </div>
            </div>

            ${options.headComment ? `<div class="head-comment-box">${escapeHtml(options.headComment)}</div>` : ''}

            <!-- Datos de Envío / Courier -->
            <div class="shipping-info-grid">
              <div class="info-block">
                <span class="block-title">COURIER / OPERADOR</span>
                <span class="block-value highlighted-courier">${escapeHtml(courierVal)}</span>
              </div>
              <div class="info-block">
                <span class="block-title">MÉTODO DE ENVÍO</span>
                <span class="block-value">${escapeHtml(order.shipping_method || 'ESTÁNDAR')}</span>
              </div>
            </div>

            <!-- Destinatario -->
            <div class="destinatario-section">
              <div class="section-title">DESTINATARIO</div>
              <div class="dest-name">${escapeHtml(displayName)}</div>
              <div class="dest-address">${escapeHtml(order.shipping_address || 'Sin dirección')} ${order.shipping_complement ? `, ${escapeHtml(order.shipping_complement)}` : ''}</div>
              <div class="dest-city-commune">${escapeHtml(order.shipping_city || 'Sin comuna')}</div>
              <div class="dest-contact">Teléfono: ${escapeHtml(displayPhone)}</div>
            </div>

            <!-- Remitente y Pedido -->
            <div class="origin-grid">
              <div class="info-block">
                <span class="block-title">REMITENTE (TIENDA)</span>
                <span class="block-value">${escapeHtml(order.comercio || 'STOCKA CLIENTE')}</span>
              </div>
              <div class="info-block">
                <span class="block-title">REFERENCIA PEDIDO</span>
                <span class="block-value">#${escapeHtml(order.external_order_number || order.id.split('-')[0])}</span>
              </div>
            </div>

            <!-- Barcode de Referencia -->
            <div class="barcode-wrapper">
              ${barcodeSVG}
            </div>

            <!-- Detalle de Productos -->
            <div class="items-section">
              <div class="section-title">DETALLE DE PRODUCTOS (PICKING & PACKING)</div>
              <table class="items-table">
                <thead>
                  <tr>
                    <th style="width: 25%; text-align: left;">SKU</th>
                    <th style="width: 60%; text-align: left;">Producto</th>
                    <th style="width: 15%; text-align: center;">Cant</th>
                  </tr>
                </thead>
                <tbody>
                  ${order.order_items && order.order_items.length > 0 ? order.order_items.map(oi => `
                    <tr>
                      <td style="font-family: monospace; font-weight: bold;">${escapeHtml(oi.products?.sku || 'Sin SKU')}</td>
                      <td style="font-size: 9px; line-height: 1.1;">${escapeHtml(oi.products?.name || 'Sin nombre')}</td>
                      <td style="text-align: center; font-weight: bold; font-size: 11px;">${oi.quantity || 1}</td>
                    </tr>
                  `).join('') : `
                    <tr>
                      <td style="font-family: monospace; font-weight: bold;">${escapeHtml(order.sku || 'Sin SKU')}</td>
                      <td style="font-size: 9px; line-height: 1.1;">${escapeHtml(order.item || 'Sin nombre')}</td>
                      <td style="text-align: center; font-weight: bold; font-size: 11px;">${order.cantidad || 1}</td>
                    </tr>
                  `}
                </tbody>
              </table>
            </div>

            ${options.footComment ? `<div class="foot-comment-box">${escapeHtml(options.footComment)}</div>` : ''}

            <!-- Pie de Página -->
            <div class="footer-section">
              <span>Preparado y despachado desde Centro de Distribución STOCKA</span>
            </div>
          </div>
        `;
      } else {
        // 5x5 cm square format
        labelPagesHTML += `
          <div class="label-page size-5x5">
            <div class="compact-header">
              <img src="https://cdn.shopify.com/s/files/1/0625/6141/9483/files/newlogotransp.png?v=1779852093" style="height: 14px; object-fit: contain;">
              <span style="font-size: 7px; font-weight: 800; color: #000; letter-spacing: 0.3px;">DESPACHO</span>
            </div>

            ${options.headComment ? `<div class="compact-comment">${escapeHtml(options.headComment)}</div>` : ''}

            <div class="compact-destinatario">
              <div style="font-size: 9px; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(displayName)}</div>
              <div style="font-size: 7px; line-height: 1.1; max-height: 22px; overflow: hidden;">
                ${escapeHtml(order.shipping_address || 'Sin dir.')}
              </div>
              <div style="font-size: 8px; font-weight: bold; margin-top: 1px;">
                ${escapeHtml(order.shipping_city || 'Sin comuna')}
              </div>
              <div style="font-size: 7px;">Tel: ${escapeHtml(displayPhone)}</div>
            </div>

            <div class="compact-order-info" style="display: flex; justify-content: space-between; font-size: 7px; border-top: 1px dashed #333; padding-top: 1px; margin-top: 2px;">
              <span>REF: #${escapeHtml(order.external_order_number || order.id.split('-')[0])}</span>
              <span style="font-weight: bold;">${escapeHtml(courierVal)}</span>
            </div>

            <!-- Barcode de Referencia -->
            <div class="compact-barcode-wrapper" style="margin: 2px 0;">
              ${barcodeSVG}
            </div>

            ${options.footComment ? `<div class="compact-comment foot">${escapeHtml(options.footComment)}</div>` : ''}

            <div class="compact-footer" style="font-size: 6px; text-align: center; color: #555; margin-top: auto;">
              STOCKA LOGÍSTICA WMS
            </div>
          </div>
        `;
      }
    });

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Imprimir Etiquetas Stocka - WMS</title>
        <style>
          /* Core Print Styles */
          html, body {
            margin: 0;
            padding: 0;
            background: #fff;
            color: #000;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            -webkit-print-color-adjust: exact;
          }
          
          .label-page {
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            position: relative;
            background: #fff;
            page-break-after: always;
          }

          .label-page:last-child {
            page-break-after: avoid;
          }

          /* Size: 10x15 cm */
          .size-10x15 {
            width: 10cm;
            height: 15cm;
            padding: 0.6cm 0.6cm;
            border: 1px solid #000;
          }
          
          @media print {
            .size-10x15, .size-5x5 {
              border: none !important;
            }
          }

          .size-10x15 .header-section {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 2px solid #000;
            padding-bottom: 6px;
            margin-bottom: 8px;
          }

          .size-10x15 .logo-img {
            height: 24px;
            max-width: 100px;
            object-fit: contain;
          }

          .size-10x15 .title-container {
            text-align: right;
          }

          .size-10x15 .main-title {
            font-size: 14px;
            font-weight: 900;
            letter-spacing: 0.5px;
          }

          .size-10x15 .sub-title {
            font-size: 9px;
            color: #444;
            font-weight: 600;
          }

          .head-comment-box {
            background: #000;
            color: #fff;
            text-align: center;
            font-weight: 800;
            font-size: 11px;
            padding: 4px;
            border-radius: 2px;
            margin-bottom: 8px;
            text-transform: uppercase;
          }

          .foot-comment-box {
            border: 2px dashed #000;
            text-align: center;
            font-weight: 700;
            font-size: 10px;
            padding: 4px;
            margin-top: 6px;
            margin-bottom: 6px;
            text-transform: uppercase;
          }

          .shipping-info-grid, .origin-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            border: 1px solid #000;
            margin-bottom: 8px;
          }

          .info-block {
            padding: 4px 6px;
            display: flex;
            flex-direction: column;
            justify-content: center;
          }

          .info-block:first-child {
            border-right: 1px solid #000;
          }

          .block-title {
            font-size: 7px;
            font-weight: bold;
            color: #555;
            text-transform: uppercase;
            margin-bottom: 2px;
          }

          .block-value {
            font-size: 10px;
            font-weight: bold;
          }

          .highlighted-courier {
            font-size: 13px !important;
            font-weight: 900 !important;
          }

          .destinatario-section {
            border: 2px solid #000;
            padding: 8px 10px;
            margin-bottom: 8px;
            background: #fdfdfd;
          }

          .section-title {
            font-size: 8px;
            font-weight: bold;
            color: #000;
            border-bottom: 1px solid #000;
            padding-bottom: 2px;
            margin-bottom: 4px;
            letter-spacing: 0.3px;
          }

          .dest-name {
            font-size: 14px;
            font-weight: 800;
            margin-bottom: 2px;
          }

          .dest-address {
            font-size: 11px;
            line-height: 1.2;
            margin-bottom: 2px;
          }

          .dest-city-commune {
            font-size: 13px;
            font-weight: 900;
            text-transform: uppercase;
            margin-bottom: 2px;
          }

          .dest-contact {
            font-size: 10px;
            font-weight: 600;
          }

          .barcode-wrapper {
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 8px 0;
            border: 1px solid #000;
            margin-bottom: 8px;
          }

          .barcode-wrapper svg {
            max-width: 100%;
            height: auto;
          }

          .items-section {
            border: 1px solid #000;
            padding: 6px;
            flex-grow: 1;
            display: flex;
            flex-direction: column;
          }

          .items-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10px;
          }

          .items-table th {
            font-size: 8px;
            color: #333;
            border-bottom: 1px solid #000;
            padding: 2px 4px;
          }

          .items-table td {
            border-bottom: 1px dashed #ccc;
            padding: 3px 4px;
            vertical-align: middle;
          }

          .items-table tr:last-child td {
            border-bottom: none;
          }

          .footer-section {
            border-top: 1px solid #000;
            padding-top: 4px;
            margin-top: 8px;
            font-size: 8px;
            text-align: center;
            font-weight: 600;
            color: #444;
          }

          /* Size: 5x5 cm */
          .size-5x5 {
            width: 5cm;
            height: 5cm;
            padding: 0.35cm 0.35cm;
            border: 1px dashed #000;
            display: flex;
            flex-direction: column;
          }

          .compact-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid #000;
            padding-bottom: 2px;
            margin-bottom: 2px;
          }

          .compact-comment {
            background: #000;
            color: #fff;
            text-align: center;
            font-weight: bold;
            font-size: 7px;
            padding: 2px;
            border-radius: 1px;
            text-transform: uppercase;
            margin: 1px 0;
          }

          .compact-comment.foot {
            background: transparent;
            color: #000;
            border: 1px dashed #000;
          }

          .compact-destinatario {
            text-align: left;
            margin-bottom: 2px;
          }

          .compact-barcode-wrapper {
            display: flex;
            justify-content: center;
            align-items: center;
          }

          .compact-barcode-wrapper svg {
            max-width: 100%;
            height: auto;
          }

          /* CSS Page margin and size rules based on selection */
          @page {
            size: ${selectedSize === '5x5' ? '5cm 5cm' : '10cm 15cm'};
            margin: 0;
          }
        </style>
      </head>
      <body>
        ${labelPagesHTML}
      </body>
      </html>
    `;

    // Deploy hidden print Frame
    const iframe = document.createElement('iframe');
    iframe.id = 'wms-print-labels-iframe';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    iframe.style.zIndex = '-9999';
    document.body.appendChild(iframe);

    // Ingress content
    const frameDoc = iframe.contentWindow.document || iframe.contentDocument;
    frameDoc.open();
    frameDoc.write(htmlContent);
    frameDoc.close();

    // Trigger printing dialog after loaded
    const printWindow = iframe.contentWindow;
    const images = printWindow.document.getElementsByTagName('img');
    let loadedImages = 0;
    const totalImages = images.length;

    const proceedToPrint = () => {
      try {
        printWindow.focus();
        printWindow.print();
      } catch (err) {
        console.error("Failed to open native print dialog:", err);
        Swal.fire('Error', 'No se pudo abrir el cuadro de impresión nativo.', 'error');
      } finally {
        setTimeout(() => {
          iframe.remove();
        }, 1000);
      }
    };

    if (totalImages === 0) {
      setTimeout(proceedToPrint, 500);
    } else {
      let printed = false;
      // Safety timeout of 1.5 seconds in case image fails to load
      const safetyTimeout = setTimeout(() => {
        if (!printed) {
          printed = true;
          proceedToPrint();
        }
      }, 1500);

      Array.from(images).forEach(img => {
        if (img.complete) {
          loadedImages++;
          if (loadedImages === totalImages && !printed) {
            clearTimeout(safetyTimeout);
            printed = true;
            setTimeout(proceedToPrint, 300);
          }
        } else {
          img.onload = img.onerror = () => {
            loadedImages++;
            if (loadedImages === totalImages && !printed) {
              clearTimeout(safetyTimeout);
              printed = true;
              setTimeout(proceedToPrint, 300);
            }
          };
        }
      });
    }
  };

  function getDeclarationProducts(dec) {
    if (dec.products_list && Array.isArray(dec.products_list) && dec.products_list.length > 0) {
      return dec.products_list;
    }
    if (dec.file_base64 && typeof XLSX !== 'undefined') {
      try {
        const binaryString = window.atob(dec.file_base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const workbook = XLSX.read(bytes, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        const parsed = [];
        if (rows && rows.length > 1) {
          const headerRow = rows[0];
          const skuIdx = headerRow.findIndex(h => h && h.toString().trim().toLowerCase() === 'sku');
          const nameIdx = headerRow.findIndex(h => h && h.toString().trim().toLowerCase() === 'nombre producto');
          const qtyIdx = headerRow.findIndex(h => h && h.toString().trim().toLowerCase() === 'cantidad declarada');
          const barcodeIdx = headerRow.findIndex(h => h && h.toString().trim().toLowerCase() === 'codigo de barras');
          
          if (skuIdx !== -1 && qtyIdx !== -1) {
            for (let i = 1; i < rows.length; i++) {
              const row = rows[i];
              if (!row || row.length === 0) continue;
              const sku = (row[skuIdx] || '').toString().trim();
              const name = nameIdx !== -1 ? (row[nameIdx] || '').toString().trim() : '';
              const qty = parseInt(row[qtyIdx], 10) || 0;
              const barcode = barcodeIdx !== -1 ? (row[barcodeIdx] || '').toString().trim() : '';
              
              if (sku) {
                parsed.push({ sku, name, qty, barcode });
              }
            }
          }
        }
        return parsed;
      } catch (err) {
        console.error('Error parsing xlsx base64 for label generator:', err);
      }
    }
    return [];
  }

  window.loadLabelQueueFromDeclaration = async function(decId) {
    if (typeof Swal === 'undefined') {
      alert("Error: SweetAlert2 no está cargado.");
      return;
    }

    Swal.fire({
      title: 'Obteniendo declaración...',
      text: 'Por favor, espere mientras cargamos la lista de productos del ingreso.',
      allowOutsideClick: false,
      showConfirmButton: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    try {
      const { data: dec, error } = await supabase
        .from('stock_declarations')
        .select('*')
        .eq('id', decId)
        .single();

      if (error) throw error;

      const products = getDeclarationProducts(dec);
      if (!products || products.length === 0) {
        Swal.fire('Atención', 'Esta declaración no contiene productos válidos en su registro o planilla.', 'warning');
        return;
      }

      // Check if there are confirmed quantities
      const hasConfirmed = products.some(p => p.qty_confirmed !== undefined && p.qty_confirmed !== null);

      let optionsHtml = '';
      if (hasConfirmed) {
        optionsHtml = `
          <select id="swal-dec-qty-type" class="form-input" style="width: 100%; height: 38px; padding: 0.35rem 0.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); color: var(--color-text-main);">
            <option value="confirmed" selected>Usar Cantidad Confirmada/Recibida (Recomendado)</option>
            <option value="declared">Usar Cantidad Declarada Inicialmente</option>
          </select>
        `;
      } else {
        optionsHtml = `
          <select id="swal-dec-qty-type" class="form-input" style="width: 100%; height: 38px; padding: 0.35rem 0.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); color: var(--color-text-main);">
            <option value="declared" selected>Usar Cantidad Declarada Inicialmente (Única disponible)</option>
          </select>
        `;
      }

      Swal.fire({
        title: 'Cargar a Cola de Impresión',
        html: `
          <div style="text-align: left; font-family: 'Inter', sans-serif;">
            <p style="margin-bottom: 1rem; font-size: 0.85rem; color: var(--color-text-muted);">
              Se detectaron <strong>${products.length}</strong> productos en el ingreso <strong>#${decId.substring(0, 8).toUpperCase()}</strong>. Selecciona qué tipo de cantidad deseas cargar a la cola:
            </p>
            <div class="form-group" style="margin-bottom: 1rem;">
              <label class="form-label" style="font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.85rem;">Tipo de Cantidad:</label>
              ${optionsHtml}
            </div>
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 0.5rem;">
              <input type="checkbox" id="swal-dec-clear-queue" checked style="width: auto; cursor: pointer;">
              <label for="swal-dec-clear-queue" style="font-size: 0.85rem; cursor: pointer; user-select: none; color: var(--color-text-main); font-weight: 500;">Limpiar cola de impresión actual antes de cargar</label>
            </div>
          </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Cargar Productos',
        cancelButtonText: 'Cancelar',
        customClass: {
          confirmButton: 'btn btn-primary',
          cancelButton: 'btn btn-outline'
        },
        preConfirm: () => {
          return {
            qtyType: document.getElementById('swal-dec-qty-type').value,
            clearQueue: document.getElementById('swal-dec-clear-queue').checked
          };
        }
      }).then((result) => {
        if (result.isConfirmed) {
          const { qtyType, clearQueue } = result.value;

          if (clearQueue) {
            printQueue = [];
          }

          let addedCount = 0;
          products.forEach(p => {
            const rawQty = qtyType === 'confirmed' ? (p.qty_confirmed !== undefined ? p.qty_confirmed : p.qty) : p.qty;
            const targetQty = parseInt(rawQty, 10) || 0;
            if (targetQty <= 0) return;

            // Search for barcode or full name in catalog products if missing
            const catalogProd = localCatalogProducts.find(cp => (cp.sku || '').toUpperCase() === p.sku.toUpperCase());
            const finalName = p.name || (catalogProd ? catalogProd.name : 'Producto del Ingreso');
            const finalBarcode = p.barcode || (catalogProd ? catalogProd.barcode : '');
            const finalId = catalogProd ? catalogProd.id : p.sku;

            const existing = printQueue.find(item => item.sku.toUpperCase() === p.sku.toUpperCase());
            if (existing) {
              existing.qty += targetQty;
            } else {
              printQueue.push({
                id: finalId,
                sku: p.sku,
                name: finalName,
                barcode: finalBarcode,
                qty: targetQty
              });
            }
            addedCount++;
          });

          updateQueueUI();
          Swal.fire({
            title: '¡Cargado con éxito!',
            text: `Se agregaron ${addedCount} productos a la cola de impresión.`,
            icon: 'success',
            timer: 2000,
            showConfirmButton: false
          });
        }
      });

    } catch (err) {
      console.error("Error loading declaration items to queue:", err);
      Swal.fire('Error', 'No se pudieron cargar los productos del ingreso: ' + err.message, 'error');
    }
  };

  function escapeHtml(text) {
    if (!text) return '';
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.toString().replace(/[&<>"']/g, function (m) { return map[m]; });
  }

})();
