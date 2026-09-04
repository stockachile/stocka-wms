import supabase from './supabase.js';

(function () {
  // Local catalog cache for the labels module
  let localCatalogProducts = [];

  // Active print queue for the bulk generator view
  let printQueue = [];

  // Current active tab in the labels module: 'catalog' | 'fragile' | 'expiry'
  let currentLabelTab = 'catalog';

  // Fragile / Warning label generator options
  const fragileState = {
    size: '10x15', // '10x15' | '10x10' | '5x5' | '5x2.5'
    copiesPerSheet: 4, // 1 | 2 | 4 | 6
    format: 'text+icon', // 'text+icon' | 'text_only' | 'icon_only' | 'text+icon+sub'
    icon: 'glass', // 'glass' | 'hands' | 'arrows' | 'umbrella' | 'warning'
    mainText: 'FRÁGIL',
    subText: 'MANÉJESE CON CUIDADO',
    style: 'classic', // 'classic' | 'inverted' | 'hazard'
    includeCommerce: false,
    sheetsCount: 1
  };

  // Helper to compute initial default dates
  const _today = new Date();
  const _nextYear = new Date(_today.getFullYear() + 1, _today.getMonth(), _today.getDate());
  const _defaultExpStr = _nextYear.toISOString().split('T')[0];
  const _defaultElabStr = _today.toISOString().split('T')[0];

  // Expiry / Batch label generator options
  const expiryState = {
    size: '10x15', // '10x15' | '10x10' | '5x5' | '5x2.5'
    copiesPerSheet: 4, // 1 | 2 | 4 | 6 | 8 | 12
    expiryDate: _defaultExpStr,
    dateFormat: 'DD/MM/YYYY', // 'DD/MM/YYYY' | 'MM/YYYY' | 'DD-MMM-YYYY' | 'YYYY-MM-DD'
    expiryPrefix: 'VENCE:', // 'VENCE:' | 'F. VENC:' | 'EXP:' | 'CONSUMIR ANTES DE:' | 'USE BY:'
    includeElab: false,
    elabDate: _defaultElabStr,
    elabPrefix: 'ELAB:',
    includeLot: true,
    lotNumber: 'L' + _today.getFullYear().toString().slice(-2) + String(_today.getMonth() + 1).padStart(2, '0') + String(_today.getDate()).padStart(2, '0'),
    includeProduct: false,
    productName: '',
    productSku: '',
    barcodeType: 'none', // 'none' | 'sku' | 'lot'
    icon: 'calendar', // 'calendar' | 'hourglass' | 'clock' | 'warning' | 'none'
    style: 'classic', // 'classic' | 'badge' | 'compact'
    includeCommerce: false,
    sheetsCount: 1
  };

  // High-contrast vector SVGs for Fragile & Handling logistics symbols (ISO compliant)
  const FRAGILE_ICONS = {
    glass: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;max-height:100%;display:block;margin:auto;">
      <path d="M 28,14 L 72,14 C 72,42 54,54 53,62 L 53,82 L 68,82 C 70,82 71,85 71,87 L 71,88 C 71,90 70,91 68,91 L 32,91 C 30,91 29,90 29,88 L 29,87 C 29,85 30,82 32,82 L 47,82 L 47,62 C 46,54 28,42 28,14 Z" fill="currentColor"/>
      <path d="M 47,13 L 42,26 L 54,33 L 45,45 L 51,52 L 48,58" fill="none" stroke="var(--fragile-bg, #ffffff)" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,

    hands: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;max-height:100%;display:block;margin:auto;">
      <rect x="36" y="22" width="28" height="28" rx="2" fill="currentColor"/>
      <line x1="50" y1="22" x2="50" y2="50" stroke="var(--fragile-bg, #ffffff)" stroke-width="2.5"/>
      <line x1="36" y1="36" x2="64" y2="36" stroke="var(--fragile-bg, #ffffff)" stroke-width="2.5"/>
      <path d="M 16,74 C 18,60 26,50 34,48 C 36,47 37,50 35,52 C 29,56 25,64 25,74 C 25,78 28,82 34,82 C 40,82 43,76 43,70 L 43,62 C 43,59 46,59 46,62 L 46,72 C 46,82 38,90 28,90 C 18,90 14,82 16,74 Z" fill="currentColor"/>
      <path d="M 84,74 C 82,60 74,50 66,48 C 64,47 63,50 65,52 C 71,56 75,64 75,74 C 75,78 72,82 66,82 C 60,82 57,76 57,70 L 57,62 C 57,59 54,59 54,62 L 54,72 C 54,82 62,90 72,90 C 82,90 86,82 84,74 Z" fill="currentColor"/>
    </svg>`,

    arrows: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;max-height:100%;display:block;margin:auto;">
      <polygon points="32,15 16,40 26,40 26,74 38,74 38,40 48,40" fill="currentColor"/>
      <polygon points="68,15 52,40 62,40 62,74 74,74 74,40 84,40" fill="currentColor"/>
      <rect x="14" y="82" width="72" height="8" rx="2" fill="currentColor"/>
    </svg>`,

    umbrella: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;max-height:100%;display:block;margin:auto;">
      <path d="M 12,52 C 12,30 29,15 50,15 C 71,15 88,30 88,52 C 80,48 72,48 64,52 C 56,48 44,48 36,52 C 28,48 20,48 12,52 Z" fill="currentColor"/>
      <path d="M 47,15 L 53,15 L 53,74 C 53,80 57,84 62,84 C 67,84 71,80 71,75 C 71,73 74,73 74,75 C 74,83 68,89 61,89 C 53,89 47,83 47,74 Z" fill="currentColor"/>
      <rect x="48" y="9" width="4" height="7" rx="1" fill="currentColor"/>
      <line x1="24" y1="6" x2="20" y2="16" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
      <line x1="52" y1="2" x2="48" y2="10" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
      <line x1="78" y1="6" x2="74" y2="16" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
    </svg>`,

    warning: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;max-height:100%;display:block;margin:auto;">
      <path d="M 45.5,14 C 47.5,10.5 52.5,10.5 54.5,14 L 91.5,78 C 93.5,81.5 91,86 87,86 L 13,86 C 9,86 6.5,81.5 8.5,78 Z" fill="currentColor"/>
      <path d="M 50,34 L 50,58" stroke="var(--fragile-bg, #ffffff)" stroke-width="7" stroke-linecap="round"/>
      <circle cx="50" cy="72" r="4.5" fill="var(--fragile-bg, #ffffff)"/>
    </svg>`
  };

  // High-contrast vector SVGs for Expiry and Batch logistics symbols
  const EXPIRY_ICONS = {
    calendar: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;max-height:100%;display:block;margin:auto;">
      <rect x="18" y="24" width="64" height="60" rx="6" fill="none" stroke="currentColor" stroke-width="6"/>
      <line x1="18" y1="42" x2="82" y2="42" stroke="currentColor" stroke-width="6"/>
      <line x1="34" y1="16" x2="34" y2="28" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>
      <line x1="66" y1="16" x2="66" y2="28" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>
      <rect x="30" y="52" width="10" height="10" rx="2" fill="currentColor"/>
      <rect x="45" y="52" width="10" height="10" rx="2" fill="currentColor"/>
      <rect x="60" y="52" width="10" height="10" rx="2" fill="currentColor"/>
      <rect x="30" y="66" width="10" height="10" rx="2" fill="currentColor"/>
      <rect x="45" y="66" width="10" height="10" rx="2" fill="currentColor"/>
    </svg>`,

    hourglass: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;max-height:100%;display:block;margin:auto;">
      <path d="M 24,18 L 76,18 M 24,82 L 76,82" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>
      <path d="M 30,22 C 30,48 70,48 70,78 L 30,78 C 30,48 70,48 70,22 Z" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/>
      <path d="M 38,72 Q 50,65 62,72 Z" fill="currentColor"/>
      <circle cx="50" cy="50" r="3" fill="currentColor"/>
    </svg>`,

    clock: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;max-height:100%;display:block;margin:auto;">
      <circle cx="50" cy="50" r="36" fill="none" stroke="currentColor" stroke-width="6"/>
      <polyline points="50,28 50,52 66,52" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,

    warning: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;max-height:100%;display:block;margin:auto;">
      <path d="M 45.5,14 C 47.5,10.5 52.5,10.5 54.5,14 L 91.5,78 C 93.5,81.5 91,86 87,86 L 13,86 C 9,86 6.5,81.5 8.5,78 Z" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/>
      <line x1="50" y1="36" x2="50" y2="58" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>
      <circle cx="50" cy="72" r="4" fill="currentColor"/>
    </svg>`
  };

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

    // Render tabbed layout
    workspace.innerHTML = `
      <!-- Top Navigation Tabs for Labels Module -->
      <div style="display: flex; gap: 0.75rem; border-bottom: 2px solid var(--color-border); margin-bottom: 1.25rem; padding-bottom: 0.5rem; flex-wrap: wrap;">
        <button type="button" id="btn-label-tab-catalog" class="btn ${currentLabelTab === 'catalog' ? 'btn-primary' : 'btn-outline'}" style="padding: 0.6rem 1.25rem; font-weight: 600; font-size: 0.92rem; display: flex; align-items: center; gap: 0.5rem; border-radius: var(--radius-md); transition: all 0.2s;">
          <i class="ri-barcode-box-line" style="font-size: 1.1rem;"></i> Etiquetas de Catálogo / SKU
        </button>
        <button type="button" id="btn-label-tab-fragile" class="btn ${currentLabelTab === 'fragile' ? 'btn-primary' : 'btn-outline'}" style="padding: 0.6rem 1.25rem; font-weight: 600; font-size: 0.92rem; display: flex; align-items: center; gap: 0.5rem; border-radius: var(--radius-md); transition: all 0.2s;">
          <i class="ri-alert-line" style="font-size: 1.1rem; color: ${currentLabelTab === 'fragile' ? '#ffffff' : 'var(--color-warning)'};"></i> Etiquetas FRÁGIL / Advertencia
        </button>
        <button type="button" id="btn-label-tab-expiry" class="btn ${currentLabelTab === 'expiry' ? 'btn-primary' : 'btn-outline'}" style="padding: 0.6rem 1.25rem; font-weight: 600; font-size: 0.92rem; display: flex; align-items: center; gap: 0.5rem; border-radius: var(--radius-md); transition: all 0.2s;">
          <i class="ri-calendar-event-line" style="font-size: 1.1rem; color: ${currentLabelTab === 'expiry' ? '#ffffff' : 'var(--color-primary)'};"></i> Etiquetas con Vencimiento / Lote
        </button>
      </div>

      <!-- TAB 1: CATALOG PRODUCTS & STOCK INCOMES -->
      <div id="label-tab-catalog-content" style="display: ${currentLabelTab === 'catalog' ? 'block' : 'none'}; animation: fadeIn 0.2s ease;">
        <div class="label-generator-container" style="display: flex; gap: 1.5rem; flex-wrap: wrap; margin-top: 0.5rem; align-items: stretch;">
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

        <!-- Section: Stock Incomes -->
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
      </div>

      <!-- TAB 2: FRAGILE & WARNING LABELS -->
      <div id="label-tab-fragile-content" style="display: ${currentLabelTab === 'fragile' ? 'block' : 'none'}; animation: fadeIn 0.25s ease;">
        <div class="label-generator-container" style="display: flex; gap: 1.5rem; flex-wrap: wrap; margin-top: 0.5rem; align-items: stretch;">
          <!-- Left Panel: Fragile Settings -->
          <div class="card" style="flex: 1 1 350px; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
            <h3 style="margin: 0 0 0.25rem 0; font-size: 1.1rem; display: flex; align-items: center; gap: 0.5rem; color: var(--color-text-main);">
              <i class="ri-settings-4-line" style="color: var(--color-warning);"></i> Configuración de Etiqueta FRÁGIL
            </h3>

            <!-- 1. Label Size -->
            <div>
              <label style="font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.85rem; color: var(--color-text-muted);">
                <i class="ri-aspect-ratio-line" style="margin-right: 4px;"></i> Tamaño de Etiqueta Adhesiva (Física)
              </label>
              <select id="fragile-label-size" class="form-input" style="width:100%; height:40px; padding:0.4rem 0.75rem; background:var(--color-bg); color:var(--color-text-main); border:1px solid var(--color-border); border-radius:var(--radius-md); font-weight: 500;">
                <option value="10x15" ${fragileState.size === '10x15' ? 'selected' : ''}>10 x 15 cm (Vertical grande / Estándar Courier)</option>
                <option value="10x10" ${fragileState.size === '10x10' ? 'selected' : ''}>10 x 10 cm (Cuadrada grande)</option>
                <option value="5x5" ${fragileState.size === '5x5' ? 'selected' : ''}>5 x 5 cm (Cuadrada mediana)</option>
                <option value="5x2.5" ${fragileState.size === '5x2.5' ? 'selected' : ''}>5 x 2.5 cm (Horizontal chica)</option>
              </select>
            </div>

            <!-- 2. Multi-copies per Sheet / Grid -->
            <div>
              <label style="font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.85rem; color: var(--color-text-muted);">
                <i class="ri-grid-fill" style="margin-right: 4px;"></i> Copias dentro de una misma Etiqueta
              </label>
              <div id="fragile-copies-btn-group" style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
                <!-- Populated dynamically by renderCopiesButtonGroup -->
              </div>
              <span style="font-size: 0.72rem; color: var(--color-text-muted); display: block; margin-top: 0.35rem;">
                * Imprime 2, 4 o 6 sub-etiquetas con líneas de corte en el mismo adhesivo 10x10 o 10x15.
              </span>
            </div>

            <!-- 3. Format / Composition -->
            <div>
              <label style="font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.85rem; color: var(--color-text-muted);">
                <i class="ri-layout-masonry-line" style="margin-right: 4px;"></i> Formato de Composición
              </label>
              <select id="fragile-label-format" class="form-input" style="width:100%; height:40px; padding:0.4rem 0.75rem; background:var(--color-bg); color:var(--color-text-main); border:1px solid var(--color-border); border-radius:var(--radius-md); font-weight: 500;">
                <option value="text+icon" ${fragileState.format === 'text+icon' ? 'selected' : ''}>Ícono + Texto "FRÁGIL" (Recomendado)</option>
                <option value="text_only" ${fragileState.format === 'text_only' ? 'selected' : ''}>Sólo Texto ("FRÁGIL" Gigante)</option>
                <option value="icon_only" ${fragileState.format === 'icon_only' ? 'selected' : ''}>Sólo Ícono Representativo</option>
                <option value="text+icon+sub" ${fragileState.format === 'text+icon+sub' ? 'selected' : ''}>Ícono + FRÁGIL + Subtítulo de Cuidado</option>
              </select>
            </div>

            <!-- 4. Icon Selector -->
            <div id="fragile-icon-selector-section" style="${fragileState.format === 'text_only' ? 'display:none;' : ''}">
              <label style="font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.85rem; color: var(--color-text-muted);">
                <i class="ri-image-line" style="margin-right: 4px;"></i> Ícono de Advertencia (Vectorial ISO)
              </label>
              <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.35rem;">
                <button type="button" class="fragile-icon-opt-btn ${fragileState.icon === 'glass' ? 'active' : ''}" data-icon="glass" style="padding: 0.35rem 0.2rem; border-radius: var(--radius-md); border: 2px solid ${fragileState.icon === 'glass' ? 'var(--color-primary)' : 'var(--color-border)'}; background: ${fragileState.icon === 'glass' ? 'rgba(37,99,235,0.08)' : 'var(--color-bg)'}; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; transition: all 0.15s;" title="Copa de Cristal / Frágil">
                  <div style="width: 22px; height: 22px; color: var(--color-text-main);">${FRAGILE_ICONS.glass}</div>
                  <span style="font-size: 0.65rem; font-weight: 600; color: var(--color-text-muted);">Copa</span>
                </button>
                <button type="button" class="fragile-icon-opt-btn ${fragileState.icon === 'hands' ? 'active' : ''}" data-icon="hands" style="padding: 0.35rem 0.2rem; border-radius: var(--radius-md); border: 2px solid ${fragileState.icon === 'hands' ? 'var(--color-primary)' : 'var(--color-border)'}; background: ${fragileState.icon === 'hands' ? 'rgba(37,99,235,0.08)' : 'var(--color-bg)'}; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; transition: all 0.15s;" title="Manejar con cuidado / Manos">
                  <div style="width: 22px; height: 22px; color: var(--color-text-main);">${FRAGILE_ICONS.hands}</div>
                  <span style="font-size: 0.65rem; font-weight: 600; color: var(--color-text-muted);">Manos</span>
                </button>
                <button type="button" class="fragile-icon-opt-btn ${fragileState.icon === 'arrows' ? 'active' : ''}" data-icon="arrows" style="padding: 0.35rem 0.2rem; border-radius: var(--radius-md); border: 2px solid ${fragileState.icon === 'arrows' ? 'var(--color-primary)' : 'var(--color-border)'}; background: ${fragileState.icon === 'arrows' ? 'rgba(37,99,235,0.08)' : 'var(--color-bg)'}; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; transition: all 0.15s;" title="Hacia arriba / This side up">
                  <div style="width: 22px; height: 22px; color: var(--color-text-main);">${FRAGILE_ICONS.arrows}</div>
                  <span style="font-size: 0.65rem; font-weight: 600; color: var(--color-text-muted);">Arriba</span>
                </button>
                <button type="button" class="fragile-icon-opt-btn ${fragileState.icon === 'umbrella' ? 'active' : ''}" data-icon="umbrella" style="padding: 0.35rem 0.2rem; border-radius: var(--radius-md); border: 2px solid ${fragileState.icon === 'umbrella' ? 'var(--color-primary)' : 'var(--color-border)'}; background: ${fragileState.icon === 'umbrella' ? 'rgba(37,99,235,0.08)' : 'var(--color-bg)'}; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; transition: all 0.15s;" title="Mantener seco / Paraguas">
                  <div style="width: 22px; height: 22px; color: var(--color-text-main);">${FRAGILE_ICONS.umbrella}</div>
                  <span style="font-size: 0.65rem; font-weight: 600; color: var(--color-text-muted);">Seco</span>
                </button>
                <button type="button" class="fragile-icon-opt-btn ${fragileState.icon === 'warning' ? 'active' : ''}" data-icon="warning" style="padding: 0.35rem 0.2rem; border-radius: var(--radius-md); border: 2px solid ${fragileState.icon === 'warning' ? 'var(--color-primary)' : 'var(--color-border)'}; background: ${fragileState.icon === 'warning' ? 'rgba(37,99,235,0.08)' : 'var(--color-bg)'}; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; transition: all 0.15s;" title="Triángulo de Precaución">
                  <div style="width: 22px; height: 22px; color: var(--color-text-main);">${FRAGILE_ICONS.warning}</div>
                  <span style="font-size: 0.65rem; font-weight: 600; color: var(--color-text-muted);">Alerta</span>
                </button>
              </div>
            </div>

            <!-- 5. Main Text -->
            <div id="fragile-main-text-section" style="${fragileState.format === 'icon_only' ? 'display:none;' : ''}">
              <label style="font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.85rem; color: var(--color-text-muted);">
                <i class="ri-text" style="margin-right: 4px;"></i> Texto Principal
              </label>
              <input type="text" id="fragile-input-main-text" class="form-input" value="${escapeHtml(fragileState.mainText)}" placeholder="Ej: FRÁGIL" style="width: 100%; height: 38px; padding: 0.4rem 0.75rem; border-radius: var(--radius-md); font-weight: 700; text-transform: uppercase;">
              <div style="display: flex; gap: 0.3rem; flex-wrap: wrap; margin-top: 0.35rem;">
                <button type="button" class="fragile-preset-main-btn" data-val="FRÁGIL" style="font-size: 0.7rem; padding: 0.15rem 0.45rem; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-bg); cursor: pointer; color: var(--color-text-muted); transition: all 0.15s;">FRÁGIL</button>
                <button type="button" class="fragile-preset-main-btn" data-val="MUY FRÁGIL" style="font-size: 0.7rem; padding: 0.15rem 0.45rem; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-bg); cursor: pointer; color: var(--color-text-muted); transition: all 0.15s;">MUY FRÁGIL</button>
                <button type="button" class="fragile-preset-main-btn" data-val="FRAGILE" style="font-size: 0.7rem; padding: 0.15rem 0.45rem; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-bg); cursor: pointer; color: var(--color-text-muted); transition: all 0.15s;">FRAGILE</button>
                <button type="button" class="fragile-preset-main-btn" data-val="VIDRIO" style="font-size: 0.7rem; padding: 0.15rem 0.45rem; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-bg); cursor: pointer; color: var(--color-text-muted); transition: all 0.15s;">VIDRIO</button>
                <button type="button" class="fragile-preset-main-btn" data-val="THIS SIDE UP" style="font-size: 0.7rem; padding: 0.15rem 0.45rem; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-bg); cursor: pointer; color: var(--color-text-muted); transition: all 0.15s;">THIS SIDE UP</button>
              </div>
            </div>

            <!-- 6. Subtitle -->
            <div id="fragile-sub-text-section" style="${(fragileState.format === 'text+icon+sub' || fragileState.format === 'text_only') ? '' : 'display:none;'}">
              <label style="font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.85rem; color: var(--color-text-muted);">
                <i class="ri-subscript" style="margin-right: 4px;"></i> Subtítulo / Mensaje de Cuidado (Opcional)
              </label>
              <input type="text" id="fragile-input-sub-text" class="form-input" value="${escapeHtml(fragileState.subText)}" placeholder="Ej: MANÉJESE CON CUIDADO" style="width: 100%; height: 38px; padding: 0.4rem 0.75rem; border-radius: var(--radius-md); font-size: 0.82rem;">
              <div style="display: flex; gap: 0.3rem; flex-wrap: wrap; margin-top: 0.35rem;">
                <button type="button" class="fragile-preset-sub-btn" data-val="MANÉJESE CON CUIDADO" style="font-size: 0.68rem; padding: 0.15rem 0.4rem; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-bg); cursor: pointer; color: var(--color-text-muted); transition: all 0.15s;">MANÉJESE CON CUIDADO</button>
                <button type="button" class="fragile-preset-sub-btn" data-val="HANDLE WITH CARE" style="font-size: 0.68rem; padding: 0.15rem 0.4rem; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-bg); cursor: pointer; color: var(--color-text-muted); transition: all 0.15s;">HANDLE WITH CARE</button>
                <button type="button" class="fragile-preset-sub-btn" data-val="NO GOLPEAR NI BOTAR" style="font-size: 0.68rem; padding: 0.15rem 0.4rem; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-bg); cursor: pointer; color: var(--color-text-muted); transition: all 0.15s;">NO GOLPEAR NI BOTAR</button>
                <button type="button" class="fragile-preset-sub-btn" data-val="NO APILAR PESO ENCIMA" style="font-size: 0.68rem; padding: 0.15rem 0.4rem; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-bg); cursor: pointer; color: var(--color-text-muted); transition: all 0.15s;">NO APILAR PESO</button>
              </div>
            </div>

            <!-- 7. Visual Style -->
            <div>
              <label style="font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.85rem; color: var(--color-text-muted);">
                <i class="ri-palette-line" style="margin-right: 4px;"></i> Estilo de Advertencia
              </label>
              <select id="fragile-label-style" class="form-input" style="width:100%; height:40px; padding:0.4rem 0.75rem; background:var(--color-bg); color:var(--color-text-main); border:1px solid var(--color-border); border-radius:var(--radius-md); font-weight: 500;">
                <option value="classic" ${fragileState.style === 'classic' ? 'selected' : ''}>Clásico B&W Alto Contraste (Fondo blanco, marco y barra negra)</option>
                <option value="inverted" ${fragileState.style === 'inverted' ? 'selected' : ''}>Invertido Alto Impacto (Fondo negro, íconos y texto blanco)</option>
                <option value="hazard" ${fragileState.style === 'hazard' ? 'selected' : ''}>Franja Diagonal de Advertencia (Zebra Hazard)</option>
              </select>
            </div>

            <!-- 8. Options -->
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 0.1rem;">
              <input type="checkbox" id="fragile-include-commerce" ${fragileState.includeCommerce ? 'checked' : ''} style="width: auto; cursor: pointer;">
              <label for="fragile-include-commerce" style="font-size: 0.85rem; cursor: pointer; user-select: none; color: var(--color-text-main);">Incluir nombre del comercio en el pie de página</label>
            </div>

            <!-- 9. Sheets Count -->
            <div style="border-top: 1px dashed var(--color-border); padding-top: 0.75rem; margin-top: 0.25rem;">
              <label style="font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.85rem; color: var(--color-text-muted);">
                <i class="ri-file-copy-2-line" style="margin-right: 4px;"></i> Cantidad de Hojas Físicas a Imprimir
              </label>
              <input type="number" id="fragile-sheets-count" class="form-input" value="${fragileState.sheetsCount}" min="1" max="500" style="width: 100%; height: 40px; padding: 0.4rem 0.75rem; border-radius: var(--radius-md); font-weight: 600;">
            </div>
          </div>

          <!-- Right Panel: Live Preview & Emit Actions -->
          <div class="card" style="flex: 1 1 320px; padding: 1.25rem; display: flex; flex-direction: column; align-items: center; justify-content: space-between; min-height: 480px;">
            <div style="width: 100%;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                <h3 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
                  <i class="ri-eye-line" style="color: var(--color-primary);"></i> Vista Previa en Vivo
                </h3>
                <span id="fragile-total-stickers-badge" class="badge" style="background: rgba(37,99,235,0.1); color: var(--color-primary); font-weight: 700; font-size: 0.78rem; padding: 0.2rem 0.5rem; border-radius: 6px;">
                  4 pegatinas por hoja
                </span>
              </div>
              <p style="font-size: 0.8rem; color: var(--color-text-muted); margin: 0 0 1rem 0;">
                Previsualización exacta de la etiqueta física con guías de corte y proporciones reales.
              </p>
            </div>

            <!-- Aspect ratio simulation wrapper -->
            <div id="fragile-live-preview-box-wrapper" style="flex: 1; display: flex; align-items: center; justify-content: center; width: 100%; padding: 0.75rem; background: var(--color-bg); border-radius: var(--radius-md); border: 1px solid var(--color-border); margin-bottom: 1.25rem; min-height: 320px; overflow: hidden;">
              <!-- Rendered sheet goes here -->
            </div>

            <div style="display: flex; gap: 0.75rem; width: 100%;">
              <button id="btn-emit-fragile-labels" class="btn btn-primary" style="flex: 1; height: 46px; justify-content: center; font-size: 0.95rem; font-weight: 600; gap: 0.4rem; border-radius: var(--radius-md); box-shadow: 0 4px 12px rgba(37,99,235,0.25);">
                <i class="ri-printer-line" style="font-size: 1.1rem;"></i> Imprimir (<span id="fragile-btn-total-count">4</span>)
              </button>
              <button id="btn-download-fragile-zpl" class="btn btn-outline" style="flex: 1; height: 46px; justify-content: center; font-size: 0.95rem; font-weight: 600; gap: 0.4rem; border-radius: var(--radius-md); border-color: var(--color-accent); color: var(--color-accent);">
                <i class="ri-download-2-line" style="font-size: 1.1rem;"></i> ZPL (<span id="fragile-btn-zpl-count">4</span>)
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- TAB 3: EXPIRATION DATE & BATCH LABELS -->
      <div id="label-tab-expiry-content" style="display: ${currentLabelTab === 'expiry' ? 'block' : 'none'}; animation: fadeIn 0.25s ease;">
        <div class="label-generator-container" style="display: flex; gap: 1.5rem; flex-wrap: wrap; margin-top: 0.5rem; align-items: stretch;">
          <!-- Left Panel: Expiry Settings -->
          <div class="card" style="flex: 1 1 360px; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
            <h3 style="margin: 0 0 0.25rem 0; font-size: 1.1rem; display: flex; align-items: center; gap: 0.5rem; color: var(--color-text-main);">
              <i class="ri-calendar-check-line" style="color: var(--color-primary);"></i> Configuración de Etiqueta con Vencimiento
            </h3>

            <!-- 1. Label Size -->
            <div>
              <label style="font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.85rem; color: var(--color-text-muted);">
                <i class="ri-aspect-ratio-line" style="margin-right: 4px;"></i> Tamaño de Etiqueta Adhesiva (Física)
              </label>
              <select id="expiry-label-size" class="form-input" style="width:100%; height:40px; padding:0.4rem 0.75rem; background:var(--color-bg); color:var(--color-text-main); border:1px solid var(--color-border); border-radius:var(--radius-md); font-weight: 500;">
                <option value="10x15" ${expiryState.size === '10x15' ? 'selected' : ''}>10 x 15 cm (Vertical grande / Estándar Courier)</option>
                <option value="10x10" ${expiryState.size === '10x10' ? 'selected' : ''}>10 x 10 cm (Cuadrada grande)</option>
                <option value="5x5" ${expiryState.size === '5x5' ? 'selected' : ''}>5 x 5 cm (Cuadrada mediana / envases)</option>
                <option value="5x2.5" ${expiryState.size === '5x2.5' ? 'selected' : ''}>5 x 2.5 cm (Horizontal chica / cosméticos, frascos)</option>
              </select>
            </div>

            <!-- 2. Multi-copies per Sheet / Grid -->
            <div>
              <label style="font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.85rem; color: var(--color-text-muted);">
                <i class="ri-grid-fill" style="margin-right: 4px;"></i> Cantidad de Copias por Etiqueta Física
              </label>
              <div id="expiry-copies-btn-group" style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
                <!-- Populated dynamically by renderExpiryCopiesButtonGroup -->
              </div>
              <span style="font-size: 0.72rem; color: var(--color-text-muted); display: block; margin-top: 0.35rem;">
                * Divide el adhesivo en múltiples sub-pegatinas con guías de corte ✂ para rotular varias unidades.
              </span>
            </div>

            <!-- 3. Expiry Date & Format -->
            <div style="background: rgba(37,99,235,0.03); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.85rem; display: flex; flex-direction: column; gap: 0.75rem;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <label style="font-weight: 700; font-size: 0.88rem; color: var(--color-primary); margin: 0; display: flex; align-items: center; gap: 4px;">
                  <i class="ri-calendar-2-line"></i> Fecha de Vencimiento *
                </label>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                <div>
                  <label style="font-size: 0.78rem; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">Fecha</label>
                  <input type="date" id="expiry-date-input" class="form-input" value="${expiryState.expiryDate}" style="width: 100%; height: 38px; padding: 0.3rem 0.5rem; border-radius: var(--radius-md); font-weight: 600;">
                </div>
                <div>
                  <label style="font-size: 0.78rem; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">Formato de Fecha</label>
                  <select id="expiry-date-format" class="form-input" style="width: 100%; height: 38px; padding: 0.3rem 0.5rem; border-radius: var(--radius-md); font-size: 0.82rem; font-weight: 500;">
                    <option value="DD/MM/YYYY" ${expiryState.dateFormat === 'DD/MM/YYYY' ? 'selected' : ''}>DD/MM/AAAA (ej. 25/12/2026)</option>
                    <option value="MM/YYYY" ${expiryState.dateFormat === 'MM/YYYY' ? 'selected' : ''}>MM/AAAA (ej. 12/2026)</option>
                    <option value="DD-MMM-YYYY" ${expiryState.dateFormat === 'DD-MMM-YYYY' ? 'selected' : ''}>DD-MES-AAAA (ej. 25-DIC-2026)</option>
                    <option value="YYYY-MM-DD" ${expiryState.dateFormat === 'YYYY-MM-DD' ? 'selected' : ''}>AAAA-MM-DD (ISO)</option>
                  </select>
                </div>
              </div>

              <div>
                <label style="font-size: 0.78rem; color: var(--color-text-muted); display: block; margin-bottom: 0.25rem;">Texto / Prefijo de Vencimiento</label>
                <input type="text" id="expiry-prefix-input" class="form-input" value="${escapeHtml(expiryState.expiryPrefix)}" placeholder="Ej: VENCE:" style="width: 100%; height: 36px; padding: 0.3rem 0.6rem; border-radius: var(--radius-md); font-weight: 700; text-transform: uppercase;">
                <div style="display: flex; gap: 0.25rem; flex-wrap: wrap; margin-top: 0.35rem;">
                  <button type="button" class="expiry-preset-prefix-btn" data-val="VENCE:" style="font-size: 0.68rem; padding: 0.15rem 0.4rem; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-bg); cursor: pointer; color: var(--color-text-muted);">VENCE:</button>
                  <button type="button" class="expiry-preset-prefix-btn" data-val="F. VENC:" style="font-size: 0.68rem; padding: 0.15rem 0.4rem; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-bg); cursor: pointer; color: var(--color-text-muted);">F. VENC:</button>
                  <button type="button" class="expiry-preset-prefix-btn" data-val="EXP:" style="font-size: 0.68rem; padding: 0.15rem 0.4rem; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-bg); cursor: pointer; color: var(--color-text-muted);">EXP:</button>
                  <button type="button" class="expiry-preset-prefix-btn" data-val="CONSUMIR ANTES DE:" style="font-size: 0.68rem; padding: 0.15rem 0.4rem; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-bg); cursor: pointer; color: var(--color-text-muted);">CONSUMIR ANTES DE:</button>
                  <button type="button" class="expiry-preset-prefix-btn" data-val="BEST BEFORE:" style="font-size: 0.68rem; padding: 0.15rem 0.4rem; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-bg); cursor: pointer; color: var(--color-text-muted);">BEST BEFORE:</button>
                </div>
              </div>
            </div>

            <!-- 4. Elaboration Date (Optional) -->
            <div style="border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem;">
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <input type="checkbox" id="expiry-include-elab" ${expiryState.includeElab ? 'checked' : ''} style="cursor: pointer;">
                  <label for="expiry-include-elab" style="font-size: 0.85rem; font-weight: 600; cursor: pointer; color: var(--color-text-main);">
                    Incluir Fecha de Elaboración / Fabricación
                  </label>
                </div>
              </div>

              <div id="expiry-elab-section" style="${expiryState.includeElab ? 'display:flex;' : 'display:none;'} gap: 0.5rem;">
                <div style="flex: 1;">
                  <label style="font-size: 0.75rem; color: var(--color-text-muted); display: block; margin-bottom: 0.2rem;">Prefijo</label>
                  <input type="text" id="expiry-elab-prefix" class="form-input" value="${escapeHtml(expiryState.elabPrefix)}" style="width: 100%; height: 36px; padding: 0.3rem 0.5rem; border-radius: var(--radius-md); font-size: 0.82rem; font-weight: 600;">
                </div>
                <div style="flex: 2;">
                  <label style="font-size: 0.75rem; color: var(--color-text-muted); display: block; margin-bottom: 0.2rem;">Fecha de Elaboración</label>
                  <input type="date" id="expiry-elab-date" class="form-input" value="${expiryState.elabDate}" style="width: 100%; height: 36px; padding: 0.3rem 0.5rem; border-radius: var(--radius-md); font-size: 0.82rem;">
                </div>
              </div>
            </div>

            <!-- 5. Lot / Batch (Optional) -->
            <div style="border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem;">
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <input type="checkbox" id="expiry-include-lot" ${expiryState.includeLot ? 'checked' : ''} style="cursor: pointer;">
                  <label for="expiry-include-lot" style="font-size: 0.85rem; font-weight: 600; cursor: pointer; color: var(--color-text-main);">
                    Incluir Número de Lote / Batch
                  </label>
                </div>
              </div>

              <div id="expiry-lot-section" style="${expiryState.includeLot ? '' : 'display:none;'}">
                <input type="text" id="expiry-lot-input" class="form-input" value="${escapeHtml(expiryState.lotNumber)}" placeholder="Ej: L260904 o LOT-2026A" style="width: 100%; height: 36px; padding: 0.3rem 0.6rem; border-radius: var(--radius-md); font-size: 0.85rem; font-weight: 600; text-transform: uppercase;">
              </div>
            </div>

            <!-- 6. Product Association (Optional) -->
            <div style="border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem;">
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <input type="checkbox" id="expiry-include-product" ${expiryState.includeProduct ? 'checked' : ''} style="cursor: pointer;">
                  <label for="expiry-include-product" style="font-size: 0.85rem; font-weight: 600; cursor: pointer; color: var(--color-text-main);">
                    Asociar Producto / Nombre / SKU
                  </label>
                </div>
              </div>

              <div id="expiry-product-section" style="${expiryState.includeProduct ? '' : 'display:none;'} position: relative;">
                <input type="text" id="expiry-product-input" class="form-input" value="${escapeHtml(expiryState.productName)}" placeholder="Buscar producto en catálogo o escribir nombre..." style="width: 100%; height: 36px; padding: 0.3rem 0.6rem; border-radius: var(--radius-md); font-size: 0.85rem;">
                <div id="expiry-product-dropdown" style="display: none; position: absolute; top: 105%; left: 0; right: 0; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); box-shadow: var(--shadow-lg); z-index: 1000; max-height: 180px; overflow-y: auto;"></div>
                ${expiryState.productSku ? `
                  <div style="font-size: 0.72rem; color: var(--color-text-muted); margin-top: 0.25rem;">
                    SKU seleccionado: <strong style="color: var(--color-primary);">${escapeHtml(expiryState.productSku)}</strong>
                  </div>
                ` : ''}
              </div>
            </div>

            <!-- 7. Barcode Option -->
            <div>
              <label style="font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.85rem; color: var(--color-text-muted);">
                <i class="ri-barcode-line" style="margin-right: 4px;"></i> Código de Barras en Sub-Etiqueta
              </label>
              <select id="expiry-barcode-type" class="form-input" style="width:100%; height:40px; padding:0.4rem 0.75rem; background:var(--color-bg); color:var(--color-text-main); border:1px solid var(--color-border); border-radius:var(--radius-md); font-weight: 500;">
                <option value="none" ${expiryState.barcodeType === 'none' ? 'selected' : ''}>Sin código de barras (Solo texto y fecha)</option>
                <option value="sku" ${expiryState.barcodeType === 'sku' ? 'selected' : ''}>Código de Barras con SKU del Producto</option>
                <option value="lot" ${expiryState.barcodeType === 'lot' ? 'selected' : ''}>Código de Barras con Número de Lote</option>
              </select>
            </div>

            <!-- 8. Icon Selector -->
            <div>
              <label style="font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.85rem; color: var(--color-text-muted);">
                <i class="ri-image-line" style="margin-right: 4px;"></i> Ícono de Vencimiento
              </label>
              <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.35rem;">
                <button type="button" class="expiry-icon-opt-btn ${expiryState.icon === 'calendar' ? 'active' : ''}" data-icon="calendar" style="padding: 0.35rem 0.2rem; border-radius: var(--radius-md); border: 2px solid ${expiryState.icon === 'calendar' ? 'var(--color-primary)' : 'var(--color-border)'}; background: ${expiryState.icon === 'calendar' ? 'rgba(37,99,235,0.08)' : 'var(--color-bg)'}; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; transition: all 0.15s;" title="Calendario">
                  <div style="width: 22px; height: 22px; color: var(--color-text-main);">${EXPIRY_ICONS.calendar}</div>
                  <span style="font-size: 0.65rem; font-weight: 600; color: var(--color-text-muted);">Calendario</span>
                </button>
                <button type="button" class="expiry-icon-opt-btn ${expiryState.icon === 'hourglass' ? 'active' : ''}" data-icon="hourglass" style="padding: 0.35rem 0.2rem; border-radius: var(--radius-md); border: 2px solid ${expiryState.icon === 'hourglass' ? 'var(--color-primary)' : 'var(--color-border)'}; background: ${expiryState.icon === 'hourglass' ? 'rgba(37,99,235,0.08)' : 'var(--color-bg)'}; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; transition: all 0.15s;" title="Reloj de arena">
                  <div style="width: 22px; height: 22px; color: var(--color-text-main);">${EXPIRY_ICONS.hourglass}</div>
                  <span style="font-size: 0.65rem; font-weight: 600; color: var(--color-text-muted);">Reloj Arena</span>
                </button>
                <button type="button" class="expiry-icon-opt-btn ${expiryState.icon === 'clock' ? 'active' : ''}" data-icon="clock" style="padding: 0.35rem 0.2rem; border-radius: var(--radius-md); border: 2px solid ${expiryState.icon === 'clock' ? 'var(--color-primary)' : 'var(--color-border)'}; background: ${expiryState.icon === 'clock' ? 'rgba(37,99,235,0.08)' : 'var(--color-bg)'}; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; transition: all 0.15s;" title="Reloj de tiempo">
                  <div style="width: 22px; height: 22px; color: var(--color-text-main);">${EXPIRY_ICONS.clock}</div>
                  <span style="font-size: 0.65rem; font-weight: 600; color: var(--color-text-muted);">Reloj</span>
                </button>
                <button type="button" class="expiry-icon-opt-btn ${expiryState.icon === 'warning' ? 'active' : ''}" data-icon="warning" style="padding: 0.35rem 0.2rem; border-radius: var(--radius-md); border: 2px solid ${expiryState.icon === 'warning' ? 'var(--color-primary)' : 'var(--color-border)'}; background: ${expiryState.icon === 'warning' ? 'rgba(37,99,235,0.08)' : 'var(--color-bg)'}; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; transition: all 0.15s;" title="Alerta de caducidad">
                  <div style="width: 22px; height: 22px; color: var(--color-text-main);">${EXPIRY_ICONS.warning}</div>
                  <span style="font-size: 0.65rem; font-weight: 600; color: var(--color-text-muted);">Alerta</span>
                </button>
                <button type="button" class="expiry-icon-opt-btn ${expiryState.icon === 'none' ? 'active' : ''}" data-icon="none" style="padding: 0.35rem 0.2rem; border-radius: var(--radius-md); border: 2px solid ${expiryState.icon === 'none' ? 'var(--color-primary)' : 'var(--color-border)'}; background: ${expiryState.icon === 'none' ? 'rgba(37,99,235,0.08)' : 'var(--color-bg)'}; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; transition: all 0.15s;" title="Sin ícono">
                  <div style="width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; color: var(--color-text-muted);"><i class="ri-forbid-line"></i></div>
                  <span style="font-size: 0.65rem; font-weight: 600; color: var(--color-text-muted);">Sin Ícono</span>
                </button>
              </div>
            </div>

            <!-- 9. Visual Style -->
            <div>
              <label style="font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.85rem; color: var(--color-text-muted);">
                <i class="ri-palette-line" style="margin-right: 4px;"></i> Estilo Visual de la Etiqueta
              </label>
              <select id="expiry-label-style" class="form-input" style="width:100%; height:40px; padding:0.4rem 0.75rem; background:var(--color-bg); color:var(--color-text-main); border:1px solid var(--color-border); border-radius:var(--radius-md); font-weight: 500;">
                <option value="classic" ${expiryState.style === 'classic' ? 'selected' : ''}>Clásico (Marco negro fino, fecha destacada)</option>
                <option value="badge" ${expiryState.style === 'badge' ? 'selected' : ''}>Insignia / Badge (Encabezado negro de alto contraste)</option>
                <option value="compact" ${expiryState.style === 'compact' ? 'selected' : ''}>Ultra-Compacto (Optimizado para frascos y stickers chicos)</option>
              </select>
            </div>

            <!-- 10. Commerce footer -->
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <input type="checkbox" id="expiry-include-commerce" ${expiryState.includeCommerce ? 'checked' : ''} style="width: auto; cursor: pointer;">
              <label for="expiry-include-commerce" style="font-size: 0.85rem; cursor: pointer; user-select: none; color: var(--color-text-main);">Incluir nombre del comercio / STOCKA en el pie</label>
            </div>

            <!-- 11. Sheets Count -->
            <div style="border-top: 1px dashed var(--color-border); padding-top: 0.75rem; margin-top: 0.25rem;">
              <label style="font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.85rem; color: var(--color-text-muted);">
                <i class="ri-file-copy-2-line" style="margin-right: 4px;"></i> Cantidad de Hojas Físicas a Imprimir
              </label>
              <input type="number" id="expiry-sheets-count" class="form-input" value="${expiryState.sheetsCount}" min="1" max="500" style="width: 100%; height: 40px; padding: 0.4rem 0.75rem; border-radius: var(--radius-md); font-weight: 600;">
            </div>
          </div>

          <!-- Right Panel: Live Preview & Emit Actions -->
          <div class="card" style="flex: 1 1 320px; padding: 1.25rem; display: flex; flex-direction: column; align-items: center; justify-content: space-between; min-height: 480px;">
            <div style="width: 100%;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                <h3 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
                  <i class="ri-eye-line" style="color: var(--color-primary);"></i> Vista Previa en Vivo
                </h3>
                <span id="expiry-total-stickers-badge" class="badge" style="background: rgba(37,99,235,0.1); color: var(--color-primary); font-weight: 700; font-size: 0.78rem; padding: 0.2rem 0.5rem; border-radius: 6px;">
                  4 pegatinas por hoja
                </span>
              </div>
              <p style="font-size: 0.8rem; color: var(--color-text-muted); margin: 0 0 1rem 0;">
                Previsualización exacta de la hoja física de vencimiento con guías de corte y proporciones reales.
              </p>
            </div>

            <!-- Aspect ratio simulation wrapper -->
            <div id="expiry-live-preview-box-wrapper" style="flex: 1; display: flex; align-items: center; justify-content: center; width: 100%; padding: 0.75rem; background: var(--color-bg); border-radius: var(--radius-md); border: 1px solid var(--color-border); margin-bottom: 1.25rem; min-height: 320px; overflow: hidden;">
              <!-- Rendered sheet goes here -->
            </div>

            <div style="display: flex; gap: 0.75rem; width: 100%;">
              <button id="btn-emit-expiry-labels" class="btn btn-primary" style="flex: 1; height: 46px; justify-content: center; font-size: 0.95rem; font-weight: 600; gap: 0.4rem; border-radius: var(--radius-md); box-shadow: 0 4px 12px rgba(37,99,235,0.25);">
                <i class="ri-printer-line" style="font-size: 1.1rem;"></i> Imprimir (<span id="expiry-btn-total-count">4</span>)
              </button>
              <button id="btn-download-expiry-zpl" class="btn btn-outline" style="flex: 1; height: 46px; justify-content: center; font-size: 0.95rem; font-weight: 600; gap: 0.4rem; border-radius: var(--radius-md); border-color: var(--color-accent); color: var(--color-accent);">
                <i class="ri-download-2-line" style="font-size: 1.1rem;"></i> ZPL (<span id="expiry-btn-zpl-count">4</span>)
              </button>
            </div>
          </div>
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
    renderFragileLivePreview();
    renderExpiryLivePreview();
  }


  /**
   * Helper to get available copies per sheet based on label physical dimensions
   */
  function getAvailableCopiesForSize(size) {
    if (size === '10x15') return [1, 2, 4, 6];
    if (size === '10x10') return [1, 2, 4];
    if (size === '5x5') return [1, 2, 4];
    if (size === '5x2.5') return [1, 2];
    return [1, 2, 4];
  }

  /**
   * Renders the button group for copies per sheet
   */
  function renderCopiesButtonGroup() {
    const group = document.getElementById('fragile-copies-btn-group');
    if (!group) return;

    const available = getAvailableCopiesForSize(fragileState.size);
    if (!available.includes(fragileState.copiesPerSheet)) {
      fragileState.copiesPerSheet = available.includes(4) ? 4 : available[available.length - 1];
    }

    group.innerHTML = available.map(num => {
      const isActive = fragileState.copiesPerSheet === num;
      let label = `${num} por etiqueta`;
      if (num === 1) label = '1 (Etiqueta Completa)';
      else if (num === 2) label = '2 copias';
      else if (num === 4) label = '4 copias (2x2)';
      else if (num === 6) label = '6 copias (2x3)';

      return `
        <button type="button" class="fragile-copy-btn ${isActive ? 'active' : ''}" data-copies="${num}" style="
          padding: 0.35rem 0.75rem;
          font-size: 0.8rem;
          font-weight: 600;
          border-radius: var(--radius-md);
          border: 1px solid ${isActive ? 'var(--color-primary)' : 'var(--color-border)'};
          background: ${isActive ? 'var(--color-primary)' : 'var(--color-bg)'};
          color: ${isActive ? '#ffffff' : 'var(--color-text-main)'};
          cursor: pointer;
          transition: all 0.15s;
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
        ">
          ${num > 1 ? '<i class="ri-grid-line" style="font-size:0.85rem;"></i>' : '<i class="ri-square-line" style="font-size:0.85rem;"></i>'}
          ${label}
        </button>
      `;
    }).join('');

    // Attach click handlers
    group.querySelectorAll('.fragile-copy-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const val = parseInt(btn.getAttribute('data-copies'), 10) || 1;
        fragileState.copiesPerSheet = val;
        renderCopiesButtonGroup();
        renderFragileLivePreview();
      });
    });
  }

  /**
   * Generates HTML for a single fragile sub-sticker
   */
  function renderSingleFragileSubLabel(opts, isPrint) {
    const isClassic = opts.style === 'classic' || !opts.style;
    const isInverted = opts.style === 'inverted';
    const isHazard = opts.style === 'hazard';

    const bgColor = isInverted ? '#000000' : '#ffffff';
    const textColor = isInverted ? '#ffffff' : '#000000';
    const borderColor = '#000000';
    const subBg = isInverted ? '#000000' : '#ffffff';

    const commerceName = getActiveCommerce();
    const footerText = opts.includeCommerce && commerceName ? commerceName : 'STOCKA LOGISTICS';

    // Formats: 'text+icon' | 'text_only' | 'icon_only' | 'text+icon+sub'
    const showIcon = opts.format !== 'text_only';
    const showMainText = opts.format !== 'icon_only';
    const showSubText = (opts.format === 'text+icon+sub' || opts.format === 'text_only') && !!opts.subText;

    const iconSvg = FRAGILE_ICONS[opts.icon] || FRAGILE_ICONS.glass;

    // Header styling
    let headerHtml = '';
    if (isHazard) {
      headerHtml = `
        <div class="fragile-sub-header hazard-header" style="background: repeating-linear-gradient(45deg, #000, #000 8px, #f59e0b 8px, #f59e0b 16px); color: #fff; text-shadow: 0 1px 2px #000; font-weight: 900; font-size: 0.72em; text-align: center; padding: 2px 4px; text-transform: uppercase; width: 100%; box-sizing: border-box; letter-spacing: 1px;">
          PRECAUCIÓN / CAUTION
        </div>
      `;
    } else if (isInverted) {
      headerHtml = `
        <div class="fragile-sub-header" style="background: #ffffff; color: #000000; font-weight: 900; font-size: 0.72em; text-align: center; padding: 2px 4px; text-transform: uppercase; width: 100%; box-sizing: border-box; letter-spacing: 1px;">
          ★ ATENCIÓN / WARNING ★
        </div>
      `;
    } else {
      headerHtml = `
        <div class="fragile-sub-header" style="background: #000000; color: #ffffff; font-weight: 900; font-size: 0.72em; text-align: center; padding: 2px 4px; text-transform: uppercase; width: 100%; box-sizing: border-box; letter-spacing: 1px;">
          ★ MANEJAR CON CUIDADO ★
        </div>
      `;
    }

    return `
      <div class="fragile-sub-sticker" style="
        --fragile-bg: ${bgColor};
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        padding: 3px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        align-items: center;
        background: ${bgColor};
        color: ${textColor};
      ">
        <div class="fragile-inner-card" style="
          width: 100%;
          height: 100%;
          border: 2.5px solid ${borderColor};
          border-radius: 3px;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: space-between;
          padding: 0;
          overflow: hidden;
          background: ${bgColor};
        ">
          ${headerHtml}
          
          <div class="fragile-center-body" style="
            flex: 1;
            width: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 3px 4px;
            box-sizing: border-box;
            gap: 2px;
            overflow: hidden;
          ">
            ${showIcon ? `
              <div class="fragile-icon-wrap" style="
                flex: ${showMainText ? '1 1 auto' : '2 1 auto'};
                width: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                max-height: ${showMainText ? (showSubText ? '40%' : '50%') : '85%'};
                min-height: 20px;
                color: ${textColor};
              ">
                ${iconSvg}
              </div>
            ` : ''}

            ${showMainText ? `
              <div class="fragile-main-title" style="
                font-family: 'Impact', 'Arial Black', sans-serif, -apple-system;
                font-weight: 900;
                text-transform: uppercase;
                letter-spacing: 1px;
                line-height: 0.95;
                text-align: center;
                width: 100%;
                color: ${textColor};
                font-size: ${showIcon ? (opts.copiesPerSheet >= 4 ? '1.3em' : '2.0em') : (opts.copiesPerSheet >= 4 ? '1.8em' : '3.0em')};
                word-break: break-word;
              ">
                ${escapeHtml(opts.mainText || 'FRÁGIL')}
              </div>
            ` : ''}

            ${showSubText ? `
              <div class="fragile-subtitle-box" style="
                border: 1.2px solid ${textColor};
                border-radius: 2px;
                padding: 1px 3px;
                font-size: 0.62em;
                font-weight: 800;
                text-transform: uppercase;
                letter-spacing: 0.4px;
                text-align: center;
                background: ${subBg};
                color: ${textColor};
                width: 92%;
                max-width: 96%;
                margin-top: 1px;
                box-sizing: border-box;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
              ">
                ${escapeHtml(opts.subText || 'MANÉJESE CON CUIDADO')}
              </div>
            ` : ''}
          </div>

          ${opts.includeCommerce ? `
            <div class="fragile-footer-bar" style="
              border-top: 1px dashed ${textColor};
              font-size: 0.52em;
              font-weight: 700;
              text-align: center;
              padding: 1px 3px;
              width: 100%;
              box-sizing: border-box;
              letter-spacing: 0.5px;
              color: ${textColor};
              opacity: 0.85;
            ">
              ${escapeHtml(footerText)}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  /**
   * Generates the multi-copy grid layout inside a sheet
   */
  function renderFragileSheetHTML(opts, isPrint) {
    const copies = parseInt(opts.copiesPerSheet, 10) || 1;
    let gridCols = 1;
    let gridRows = 1;

    if (copies === 2) {
      if (opts.size === '5x2.5') {
        gridCols = 2; gridRows = 1;
      } else {
        gridCols = 1; gridRows = 2;
      }
    } else if (copies === 4) {
      gridCols = 2; gridRows = 2;
    } else if (copies === 6) {
      gridCols = 2; gridRows = 3;
    }

    let cellsHtml = '';
    for (let i = 0; i < copies; i++) {
      cellsHtml += `
        <div class="fragile-grid-cell" style="
          position: relative;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          overflow: hidden;
        ">
          ${renderSingleFragileSubLabel(opts, isPrint)}
        </div>
      `;
    }

    // Cut lines guide styling if multi-copy
    let cutGuidesHtml = '';
    if (copies > 1) {
      if (gridCols === 2) {
        cutGuidesHtml += `
          <div class="cut-guide-vertical" style="position: absolute; top: 0; bottom: 0; left: 50%; width: 0; border-left: 1px dashed #666; z-index: 10; pointer-events: none; transform: translateX(-50%);">
            <span style="position: absolute; top: 50%; left: -6px; transform: translateY(-50%); font-size: 9px; color: #444; background: #fff; padding: 0 1px; line-height: 1;">✂</span>
          </div>
        `;
      }
      if (gridRows === 2) {
        cutGuidesHtml += `
          <div class="cut-guide-horizontal" style="position: absolute; left: 0; right: 0; top: 50%; height: 0; border-top: 1px dashed #666; z-index: 10; pointer-events: none; transform: translateY(-50%);">
            <span style="position: absolute; left: 50%; top: -6px; transform: translateX(-50%); font-size: 9px; color: #444; background: #fff; padding: 0 1px; line-height: 1;">✂</span>
          </div>
        `;
      } else if (gridRows === 3) {
        cutGuidesHtml += `
          <div class="cut-guide-horizontal" style="position: absolute; left: 0; right: 0; top: 33.33%; height: 0; border-top: 1px dashed #666; z-index: 10; pointer-events: none;">
            <span style="position: absolute; left: 50%; top: -6px; transform: translateX(-50%); font-size: 9px; color: #444; background: #fff; padding: 0 1px; line-height: 1;">✂</span>
          </div>
          <div class="cut-guide-horizontal" style="position: absolute; left: 0; right: 0; top: 66.66%; height: 0; border-top: 1px dashed #666; z-index: 10; pointer-events: none;">
            <span style="position: absolute; left: 50%; top: -6px; transform: translateX(-50%); font-size: 9px; color: #444; background: #fff; padding: 0 1px; line-height: 1;">✂</span>
          </div>
        `;
      }
    }

    return `
      <div class="fragile-sheet-wrapper fragile-size-${opts.size}" style="
        position: relative;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        display: grid;
        grid-template-columns: repeat(${gridCols}, 1fr);
        grid-template-rows: repeat(${gridRows}, 1fr);
        background: #ffffff;
        overflow: hidden;
      ">
        ${cellsHtml}
        ${cutGuidesHtml}
      </div>
    `;
  }

  /**
   * Updates the Live Preview box for Fragile labels
   */
  function renderFragileLivePreview() {
    const previewWrapper = document.getElementById('fragile-live-preview-box-wrapper');
    const badge = document.getElementById('fragile-total-stickers-badge');
    const btnCount = document.getElementById('fragile-btn-total-count');
    const btnZplCount = document.getElementById('fragile-btn-zpl-count');

    if (!previewWrapper) return;

    const totalStickers = (parseInt(fragileState.sheetsCount, 10) || 1) * (parseInt(fragileState.copiesPerSheet, 10) || 1);
    const sheets = parseInt(fragileState.sheetsCount, 10) || 1;

    if (badge) {
      badge.textContent = `${fragileState.copiesPerSheet} por hoja (Total: ${totalStickers} sticker${totalStickers > 1 ? 's' : ''})`;
    }
    if (btnCount) btnCount.textContent = totalStickers;
    if (btnZplCount) btnZplCount.textContent = totalStickers;

    // Determine preview dimensions based on aspect ratio
    let w = '180px';
    let h = '270px';
    let fontSizeEm = '12px';

    if (fragileState.size === '10x15') {
      w = '180px'; h = '270px'; // 2:3 Aspect ratio
      fontSizeEm = '12px';
    } else if (fragileState.size === '10x10') {
      w = '220px'; h = '220px'; // 1:1 Aspect ratio
      fontSizeEm = '12px';
    } else if (fragileState.size === '5x5') {
      w = '160px'; h = '160px'; // 1:1 Aspect ratio
      fontSizeEm = '10px';
    } else if (fragileState.size === '5x2.5') {
      w = '240px'; h = '120px'; // 2:1 Aspect ratio
      fontSizeEm = '9px';
    }

    previewWrapper.innerHTML = `
      <div class="fragile-sticker-sheet-preview" style="
        position: relative;
        width: ${w};
        height: ${h};
        background: white;
        color: black;
        border: 1px solid var(--color-border);
        box-shadow: var(--shadow-md);
        border-radius: 4px;
        box-sizing: border-box;
        overflow: hidden;
        font-size: ${fontSizeEm};
      ">
        ${renderFragileSheetHTML(fragileState, false)}
      </div>
    `;
  }

  /**
   * Helper to get available copies per sheet for Expiry labels
   */
  function getAvailableCopiesForExpirySize(size) {
    if (size === '10x15') return [1, 2, 4, 6, 8, 12];
    if (size === '10x10') return [1, 2, 4, 6, 9];
    if (size === '5x5') return [1, 2, 4];
    if (size === '5x2.5') return [1, 2, 4];
    return [1, 2, 4];
  }

  /**
   * Renders the button group for copies per sheet for Expiry labels
   */
  function renderExpiryCopiesButtonGroup() {
    const group = document.getElementById('expiry-copies-btn-group');
    if (!group) return;

    const available = getAvailableCopiesForExpirySize(expiryState.size);
    if (!available.includes(expiryState.copiesPerSheet)) {
      expiryState.copiesPerSheet = available.includes(4) ? 4 : available[available.length - 1];
    }

    group.innerHTML = available.map(num => {
      const isActive = expiryState.copiesPerSheet === num;
      let label = `${num} por etiqueta`;
      if (num === 1) label = '1 (Etiqueta Completa)';
      else if (num === 2) label = '2 copias';
      else if (num === 4) label = '4 copias (2x2)';
      else if (num === 6) label = '6 copias';
      else if (num === 8) label = '8 copias (2x4)';
      else if (num === 9) label = '9 copias (3x3)';
      else if (num === 12) label = '12 copias (3x4)';

      return `
        <button type="button" class="expiry-copy-btn ${isActive ? 'active' : ''}" data-copies="${num}" style="
          padding: 0.35rem 0.65rem;
          font-size: 0.8rem;
          font-weight: 600;
          border-radius: var(--radius-md);
          border: 1px solid ${isActive ? 'var(--color-primary)' : 'var(--color-border)'};
          background: ${isActive ? 'var(--color-primary)' : 'var(--color-bg)'};
          color: ${isActive ? '#ffffff' : 'var(--color-text-main)'};
          cursor: pointer;
          transition: all 0.15s;
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
        ">
          ${num > 1 ? '<i class="ri-grid-line" style="font-size:0.85rem;"></i>' : '<i class="ri-square-line" style="font-size:0.85rem;"></i>'}
          ${label}
        </button>
      `;
    }).join('');

    // Attach click handlers
    group.querySelectorAll('.expiry-copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = parseInt(btn.getAttribute('data-copies'), 10) || 1;
        expiryState.copiesPerSheet = val;
        renderExpiryCopiesButtonGroup();
        renderExpiryLivePreview();
      });
    });
  }

  /**
   * Helper to format dates for label display
   */
  function formatDisplayDate(dateStr, format) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const [year, month, day] = parts;
    const monthsShort = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
    const mIdx = parseInt(month, 10) - 1;
    const mName = monthsShort[mIdx] || month;

    if (format === 'MM/YYYY') {
      return `${month}/${year}`;
    } else if (format === 'DD-MMM-YYYY') {
      return `${day}-${mName}-${year}`;
    } else if (format === 'YYYY-MM-DD') {
      return `${year}-${month}-${day}`;
    } else {
      // Default: DD/MM/YYYY
      return `${day}/${month}/${year}`;
    }
  }

  /**
   * Generates HTML for a single expiration sub-sticker
   */
  function renderSingleExpirySubLabel(opts, isPrint) {
    const isClassic = opts.style === 'classic' || !opts.style;
    const isBadge = opts.style === 'badge';
    const isCompact = opts.style === 'compact';

    const bgColor = '#ffffff';
    const textColor = '#000000';
    const borderColor = '#000000';

    const commerceName = getActiveCommerce();
    const footerText = opts.includeCommerce && commerceName ? commerceName : 'STOCKA WMS';

    const formattedExp = formatDisplayDate(opts.expiryDate, opts.dateFormat) || '25/12/2026';
    const formattedElab = formatDisplayDate(opts.elabDate, opts.dateFormat) || '';

    const showIcon = opts.icon && opts.icon !== 'none';
    const iconSvg = showIcon ? (EXPIRY_ICONS[opts.icon] || EXPIRY_ICONS.calendar) : '';

    // Header HTML
    let headerHtml = '';
    if (isBadge) {
      const headerTitle = (opts.includeProduct && opts.productName) 
        ? escapeHtml(opts.productName.toUpperCase()) 
        : '★ FECHA DE VENCIMIENTO ★';
      headerHtml = `
        <div class="expiry-sub-header" style="background: #000000; color: #ffffff; font-weight: 900; font-size: 0.72em; text-align: center; padding: 2px 4px; text-transform: uppercase; width: 100%; box-sizing: border-box; letter-spacing: 0.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${headerTitle}
        </div>
      `;
    } else if (opts.includeProduct && opts.productName) {
      headerHtml = `
        <div class="expiry-product-header" style="font-weight: 800; font-size: 0.72em; text-align: center; padding: 2px 4px; text-transform: uppercase; width: 100%; box-sizing: border-box; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-bottom: 1px solid #000;">
          ${escapeHtml(opts.productName.toUpperCase())}
          ${opts.productSku ? `<span style="font-size: 0.85em; font-weight: 600; color: #555; margin-left: 3px;">(${escapeHtml(opts.productSku)})</span>` : ''}
        </div>
      `;
    }

    // Secondary row (Elab / Lot)
    let secondaryHtml = '';
    const hasElab = opts.includeElab && formattedElab;
    const hasLot = opts.includeLot && opts.lotNumber;
    if (hasElab || hasLot) {
      secondaryHtml = `
        <div class="expiry-secondary-row" style="
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 6px;
          font-size: 0.65em;
          font-weight: 700;
          width: 95%;
          margin-top: 1px;
          color: #000;
          text-transform: uppercase;
          border-top: 1px dashed #444;
          padding-top: 1px;
        ">
          ${hasElab ? `<span>${escapeHtml(opts.elabPrefix || 'ELAB:')} ${formattedElab}</span>` : ''}
          ${hasElab && hasLot ? `<span>•</span>` : ''}
          ${hasLot ? `<span>LOTE: <strong>${escapeHtml(opts.lotNumber)}</strong></span>` : ''}
        </div>
      `;
    }

    // Barcode rendering if requested
    let barcodeHtml = '';
    if (opts.barcodeType === 'sku' && (opts.productSku || opts.productName)) {
      const bcVal = opts.productSku || opts.productName;
      barcodeHtml = `
        <div class="expiry-barcode-box" style="width: 90%; max-height: 22px; display: flex; justify-content: center; align-items: center; margin-top: 1px; overflow: hidden;">
          ${window.generateBarcodeSVG(bcVal, false, '5x2.5')}
        </div>
      `;
    } else if (opts.barcodeType === 'lot' && opts.lotNumber) {
      barcodeHtml = `
        <div class="expiry-barcode-box" style="width: 90%; max-height: 22px; display: flex; justify-content: center; align-items: center; margin-top: 1px; overflow: hidden;">
          ${window.generateBarcodeSVG(opts.lotNumber, false, '5x2.5')}
        </div>
      `;
    }

    // Dynamic sizing based on copies
    const isSmallCell = opts.copiesPerSheet >= 6 || opts.size === '5x2.5';
    const dateFontSize = isSmallCell ? '1.2em' : '1.75em';
    const iconSize = isSmallCell ? '20px' : '26px';

    return `
      <div class="expiry-sub-sticker" style="
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        padding: 3px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        align-items: center;
        background: ${bgColor};
        color: ${textColor};
      ">
        <div class="expiry-inner-card" style="
          width: 100%;
          height: 100%;
          border: ${isCompact ? '1.5px' : '2.5px'} solid ${borderColor};
          border-radius: 3px;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: space-between;
          padding: 0;
          overflow: hidden;
          background: ${bgColor};
        ">
          ${headerHtml}

          <div class="expiry-center-body" style="
            flex: 1;
            width: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 2px 4px;
            box-sizing: border-box;
            gap: 1px;
            overflow: hidden;
          ">
            <div class="expiry-main-row" style="display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 6px; width: 100%; box-sizing: border-box;">
              ${showIcon ? `
                <div class="expiry-icon-wrap" style="width: ${iconSize}; height: ${iconSize}; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: #000;">
                  ${iconSvg}
                </div>
              ` : ''}

              <div class="expiry-text-block" style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; line-height: 1;">
                <div class="expiry-prefix-label" style="
                  display: block;
                  width: 100%;
                  text-align: center;
                  clear: both;
                  font-size: 0.68em;
                  font-weight: 800;
                  text-transform: uppercase;
                  letter-spacing: 0.5px;
                  color: #000000;
                  margin: 0 0 2px 0;
                  padding: 0;
                  line-height: 1.1;
                ">
                  ${escapeHtml(opts.expiryPrefix || 'VENCE:')}
                </div>
                <div class="expiry-date-display" style="
                  display: block;
                  width: 100%;
                  text-align: center;
                  clear: both;
                  font-family: 'Impact', 'Arial Black', -apple-system, sans-serif;
                  font-weight: 900;
                  font-size: ${dateFontSize};
                  letter-spacing: 1px;
                  color: #000000;
                  margin: 0;
                  padding: 0;
                  line-height: 1;
                  white-space: nowrap;
                ">
                  ${escapeHtml(formattedExp)}
                </div>
              </div>
            </div>

            ${secondaryHtml}
            ${barcodeHtml}
          </div>

          ${opts.includeCommerce ? `
            <div class="expiry-footer-bar" style="
              border-top: 1px dashed #000;
              font-size: 0.52em;
              font-weight: 700;
              text-align: center;
              padding: 1px 3px;
              width: 100%;
              box-sizing: border-box;
              letter-spacing: 0.5px;
              color: #000;
              opacity: 0.85;
            ">
              ${escapeHtml(footerText)}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  /**
   * Generates the multi-copy grid layout inside a sheet for Expiry labels
   */
  function renderExpirySheetHTML(opts, isPrint) {
    const copies = parseInt(opts.copiesPerSheet, 10) || 1;
    let gridCols = 1;
    let gridRows = 1;

    if (copies === 2) {
      if (opts.size === '5x2.5') {
        gridCols = 2; gridRows = 1;
      } else {
        gridCols = 1; gridRows = 2;
      }
    } else if (copies === 4) {
      gridCols = 2; gridRows = 2;
    } else if (copies === 6) {
      if (opts.size === '10x15') {
        gridCols = 2; gridRows = 3;
      } else {
        gridCols = 3; gridRows = 2;
      }
    } else if (copies === 8) {
      gridCols = 2; gridRows = 4;
    } else if (copies === 9) {
      gridCols = 3; gridRows = 3;
    } else if (copies === 12) {
      gridCols = 3; gridRows = 4;
    }

    let cellsHtml = '';
    for (let i = 0; i < copies; i++) {
      cellsHtml += `
        <div class="expiry-grid-cell" style="
          position: relative;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          overflow: hidden;
        ">
          ${renderSingleExpirySubLabel(opts, isPrint)}
        </div>
      `;
    }

    // Cut lines guide styling if multi-copy
    let cutGuidesHtml = '';
    if (copies > 1) {
      if (gridCols > 1) {
        for (let c = 1; c < gridCols; c++) {
          const leftPct = (c / gridCols) * 100;
          cutGuidesHtml += `
            <div class="cut-guide-vertical" style="position: absolute; top: 0; bottom: 0; left: ${leftPct}%; width: 0; border-left: 1px dashed #666; z-index: 10; pointer-events: none; transform: translateX(-50%);">
              <span style="position: absolute; top: 50%; left: -6px; transform: translateY(-50%); font-size: 9px; color: #444; background: #fff; padding: 0 1px; line-height: 1;">✂</span>
            </div>
          `;
        }
      }
      if (gridRows > 1) {
        for (let r = 1; r < gridRows; r++) {
          const topPct = (r / gridRows) * 100;
          cutGuidesHtml += `
            <div class="cut-guide-horizontal" style="position: absolute; left: 0; right: 0; top: ${topPct}%; height: 0; border-top: 1px dashed #666; z-index: 10; pointer-events: none; transform: translateY(-50%);">
              <span style="position: absolute; left: 50%; top: -6px; transform: translateX(-50%); font-size: 9px; color: #444; background: #fff; padding: 0 1px; line-height: 1;">✂</span>
            </div>
          `;
        }
      }
    }

    return `
      <div class="expiry-sheet-wrapper expiry-size-${opts.size}" style="
        position: relative;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        display: grid;
        grid-template-columns: repeat(${gridCols}, 1fr);
        grid-template-rows: repeat(${gridRows}, 1fr);
        background: #ffffff;
        overflow: hidden;
      ">
        ${cellsHtml}
        ${cutGuidesHtml}
      </div>
    `;
  }

  /**
   * Updates the Live Preview box for Expiry labels
   */
  function renderExpiryLivePreview() {
    const previewWrapper = document.getElementById('expiry-live-preview-box-wrapper');
    const badge = document.getElementById('expiry-total-stickers-badge');
    const btnCount = document.getElementById('expiry-btn-total-count');
    const btnZplCount = document.getElementById('expiry-btn-zpl-count');

    if (!previewWrapper) return;

    const totalStickers = (parseInt(expiryState.sheetsCount, 10) || 1) * (parseInt(expiryState.copiesPerSheet, 10) || 1);

    if (badge) {
      badge.textContent = `${expiryState.copiesPerSheet} por hoja (Total: ${totalStickers} sticker${totalStickers > 1 ? 's' : ''})`;
    }
    if (btnCount) btnCount.textContent = totalStickers;
    if (btnZplCount) btnZplCount.textContent = totalStickers;

    // Determine preview dimensions based on aspect ratio
    let w = '180px';
    let h = '270px';
    let fontSizeEm = '12px';

    if (expiryState.size === '10x15') {
      w = '180px'; h = '270px'; // 2:3 Aspect ratio
      fontSizeEm = '12px';
    } else if (expiryState.size === '10x10') {
      w = '220px'; h = '220px'; // 1:1 Aspect ratio
      fontSizeEm = '12px';
    } else if (expiryState.size === '5x5') {
      w = '160px'; h = '160px'; // 1:1 Aspect ratio
      fontSizeEm = '10px';
    } else if (expiryState.size === '5x2.5') {
      w = '240px'; h = '120px'; // 2:1 Aspect ratio
      fontSizeEm = '9px';
    }

    previewWrapper.innerHTML = `
      <div class="expiry-sticker-sheet-preview" style="
        position: relative;
        width: ${w};
        height: ${h};
        background: white;
        color: black;
        border: 1px solid var(--color-border);
        box-shadow: var(--shadow-md);
        border-radius: 4px;
        box-sizing: border-box;
        overflow: hidden;
        font-size: ${fontSizeEm};
      ">
        ${renderExpirySheetHTML(expiryState, false)}
      </div>
    `;
  }

  /**
   * Bind event listeners for the bulk label generator layout
   */
  function initGeneratorListeners() {
    // 1. Tab Switching Listeners
    const btnTabCatalog = document.getElementById('btn-label-tab-catalog');
    const btnTabFragile = document.getElementById('btn-label-tab-fragile');
    const btnTabExpiry = document.getElementById('btn-label-tab-expiry');
    const tabCatalogContent = document.getElementById('label-tab-catalog-content');
    const tabFragileContent = document.getElementById('label-tab-fragile-content');
    const tabExpiryContent = document.getElementById('label-tab-expiry-content');

    const switchLabelTab = (tab) => {
      currentLabelTab = tab;

      // Update button visual styles
      const tabItems = [
        { btn: btnTabCatalog, id: 'catalog', activeColor: '#ffffff', inactiveColor: 'var(--color-primary)' },
        { btn: btnTabFragile, id: 'fragile', activeColor: '#ffffff', inactiveColor: 'var(--color-warning)' },
        { btn: btnTabExpiry, id: 'expiry', activeColor: '#ffffff', inactiveColor: 'var(--color-primary)' }
      ];

      tabItems.forEach(item => {
        if (item.btn) {
          const isCurrent = item.id === tab;
          item.btn.classList.toggle('btn-primary', isCurrent);
          item.btn.classList.toggle('btn-outline', !isCurrent);
          const icon = item.btn.querySelector('i');
          if (icon) {
            icon.style.color = isCurrent ? item.activeColor : item.inactiveColor;
          }
        }
      });

      // Toggle tab content panels
      if (tabCatalogContent) tabCatalogContent.style.display = (tab === 'catalog') ? 'block' : 'none';
      if (tabFragileContent) tabFragileContent.style.display = (tab === 'fragile') ? 'block' : 'none';
      if (tabExpiryContent) tabExpiryContent.style.display = (tab === 'expiry') ? 'block' : 'none';

      if (tab === 'catalog') {
        updateQueueUI();
      } else if (tab === 'fragile') {
        renderCopiesButtonGroup();
        renderFragileLivePreview();
      } else if (tab === 'expiry') {
        renderExpiryCopiesButtonGroup();
        renderExpiryLivePreview();
      }
    };

    btnTabCatalog?.addEventListener('click', () => switchLabelTab('catalog'));
    btnTabFragile?.addEventListener('click', () => switchLabelTab('fragile'));
    btnTabExpiry?.addEventListener('click', () => switchLabelTab('expiry'));

    // 2. Catalog Tab Listeners
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

    // 3. Fragile Tab Listeners
    renderCopiesButtonGroup();

    const fragileSizeSelect = document.getElementById('fragile-label-size');
    const fragileFormatSelect = document.getElementById('fragile-label-format');
    const fragileMainTextInput = document.getElementById('fragile-input-main-text');
    const fragileSubTextInput = document.getElementById('fragile-input-sub-text');
    const fragileStyleSelect = document.getElementById('fragile-label-style');
    const fragileCommerceCb = document.getElementById('fragile-include-commerce');
    const fragileSheetsCountInput = document.getElementById('fragile-sheets-count');

    const iconSelectorSec = document.getElementById('fragile-icon-selector-section');
    const mainTextSec = document.getElementById('fragile-main-text-section');
    const subTextSec = document.getElementById('fragile-sub-text-section');

    fragileSizeSelect?.addEventListener('change', (e) => {
      fragileState.size = e.target.value;
      renderCopiesButtonGroup();
      renderFragileLivePreview();
    });

    fragileFormatSelect?.addEventListener('change', (e) => {
      fragileState.format = e.target.value;
      if (iconSelectorSec) {
        iconSelectorSec.style.display = (e.target.value === 'text_only') ? 'none' : 'block';
      }
      if (mainTextSec) {
        mainTextSec.style.display = (e.target.value === 'icon_only') ? 'none' : 'block';
      }
      if (subTextSec) {
        subTextSec.style.display = (e.target.value === 'text+icon+sub' || e.target.value === 'text_only') ? 'block' : 'none';
      }
      renderFragileLivePreview();
    });

    // Icon button selections
    document.querySelectorAll('.fragile-icon-opt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const iconKey = btn.getAttribute('data-icon');
        fragileState.icon = iconKey;
        document.querySelectorAll('.fragile-icon-opt-btn').forEach(b => {
          const isTarget = b.getAttribute('data-icon') === iconKey;
          b.style.borderColor = isTarget ? 'var(--color-primary)' : 'var(--color-border)';
          b.style.background = isTarget ? 'rgba(37,99,235,0.08)' : 'var(--color-bg)';
        });
        renderFragileLivePreview();
      });
    });

    fragileMainTextInput?.addEventListener('input', (e) => {
      fragileState.mainText = e.target.value;
      renderFragileLivePreview();
    });

    // Preset chips for Main Text
    document.querySelectorAll('.fragile-preset-main-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.getAttribute('data-val');
        fragileState.mainText = val;
        if (fragileMainTextInput) fragileMainTextInput.value = val;
        renderFragileLivePreview();
      });
    });

    fragileSubTextInput?.addEventListener('input', (e) => {
      fragileState.subText = e.target.value;
      renderFragileLivePreview();
    });

    // Preset chips for Subtitle
    document.querySelectorAll('.fragile-preset-sub-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.getAttribute('data-val');
        fragileState.subText = val;
        if (fragileSubTextInput) fragileSubTextInput.value = val;
        renderFragileLivePreview();
      });
    });

    fragileStyleSelect?.addEventListener('change', (e) => {
      fragileState.style = e.target.value;
      renderFragileLivePreview();
    });

    fragileCommerceCb?.addEventListener('change', (e) => {
      fragileState.includeCommerce = e.target.checked;
      renderFragileLivePreview();
    });

    fragileSheetsCountInput?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10) || 1;
      fragileState.sheetsCount = Math.max(1, val);
      renderFragileLivePreview();
    });

    // Emit fragile labels button
    const btnEmitFragile = document.getElementById('btn-emit-fragile-labels');
    btnEmitFragile?.addEventListener('click', () => {
      window.printFragileLabels(fragileState);
    });

    // Download fragile ZPL button
    const btnDownloadFragileZpl = document.getElementById('btn-download-fragile-zpl');
    btnDownloadFragileZpl?.addEventListener('click', () => {
      window.showFragileZPLModal(fragileState);
    });

    // 4. Expiry Tab Listeners
    renderExpiryCopiesButtonGroup();

    const expirySizeSelect = document.getElementById('expiry-label-size');
    const expiryDateInput = document.getElementById('expiry-date-input');
    const expiryDateFormatSelect = document.getElementById('expiry-date-format');
    const expiryPrefixInput = document.getElementById('expiry-prefix-input');
    
    const expiryIncludeElabCb = document.getElementById('expiry-include-elab');
    const expiryElabSection = document.getElementById('expiry-elab-section');
    const expiryElabPrefixInput = document.getElementById('expiry-elab-prefix');
    const expiryElabDateInput = document.getElementById('expiry-elab-date');

    const expiryIncludeLotCb = document.getElementById('expiry-include-lot');
    const expiryLotSection = document.getElementById('expiry-lot-section');
    const expiryLotInput = document.getElementById('expiry-lot-input');

    const expiryIncludeProdCb = document.getElementById('expiry-include-product');
    const expiryProdSection = document.getElementById('expiry-product-section');
    const expiryProdInput = document.getElementById('expiry-product-input');
    const expiryProdDropdown = document.getElementById('expiry-product-dropdown');

    const expiryBarcodeSelect = document.getElementById('expiry-barcode-type');
    const expiryStyleSelect = document.getElementById('expiry-label-style');
    const expiryCommerceCb = document.getElementById('expiry-include-commerce');
    const expirySheetsCountInput = document.getElementById('expiry-sheets-count');

    // Size change
    expirySizeSelect?.addEventListener('change', (e) => {
      expiryState.size = e.target.value;
      renderExpiryCopiesButtonGroup();
      renderExpiryLivePreview();
    });

    // Date change
    expiryDateInput?.addEventListener('change', (e) => {
      expiryState.expiryDate = e.target.value;
      renderExpiryLivePreview();
    });

    // Date format change
    expiryDateFormatSelect?.addEventListener('change', (e) => {
      expiryState.dateFormat = e.target.value;
      renderExpiryLivePreview();
    });

    // Prefix input
    expiryPrefixInput?.addEventListener('input', (e) => {
      expiryState.expiryPrefix = e.target.value;
      renderExpiryLivePreview();
    });

    // Prefix preset buttons
    document.querySelectorAll('.expiry-preset-prefix-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.getAttribute('data-val');
        expiryState.expiryPrefix = val;
        if (expiryPrefixInput) expiryPrefixInput.value = val;
        renderExpiryLivePreview();
      });
    });

    // Elaboration date toggle & inputs
    expiryIncludeElabCb?.addEventListener('change', (e) => {
      expiryState.includeElab = e.target.checked;
      if (expiryElabSection) {
        expiryElabSection.style.display = e.target.checked ? 'flex' : 'none';
      }
      renderExpiryLivePreview();
    });

    expiryElabPrefixInput?.addEventListener('input', (e) => {
      expiryState.elabPrefix = e.target.value;
      renderExpiryLivePreview();
    });

    expiryElabDateInput?.addEventListener('change', (e) => {
      expiryState.elabDate = e.target.value;
      renderExpiryLivePreview();
    });

    // Lot toggle & input
    expiryIncludeLotCb?.addEventListener('change', (e) => {
      expiryState.includeLot = e.target.checked;
      if (expiryLotSection) {
        expiryLotSection.style.display = e.target.checked ? 'block' : 'none';
      }
      renderExpiryLivePreview();
    });

    expiryLotInput?.addEventListener('input', (e) => {
      expiryState.lotNumber = e.target.value;
      renderExpiryLivePreview();
    });

    // Product toggle, input & autocomplete
    expiryIncludeProdCb?.addEventListener('change', (e) => {
      expiryState.includeProduct = e.target.checked;
      if (expiryProdSection) {
        expiryProdSection.style.display = e.target.checked ? 'block' : 'none';
      }
      renderExpiryLivePreview();
    });

    expiryProdInput?.addEventListener('input', (e) => {
      const val = e.target.value.toLowerCase().trim();
      expiryState.productName = e.target.value;
      renderExpiryLivePreview();

      if (!val || !expiryProdDropdown) {
        if (expiryProdDropdown) expiryProdDropdown.style.display = 'none';
        return;
      }

      const matches = localCatalogProducts.filter(p => 
        (p.sku || '').toLowerCase().includes(val) || 
        (p.name || '').toLowerCase().includes(val)
      ).slice(0, 8);

      if (matches.length === 0) {
        expiryProdDropdown.innerHTML = `<div style="padding:0.6rem;color:var(--color-text-muted);font-size:0.8rem;text-align:center;">No se encontraron productos</div>`;
      } else {
        expiryProdDropdown.innerHTML = matches.map(p => `
          <div class="expiry-search-item" data-sku="${escapeHtml(p.sku)}" data-name="${escapeHtml(p.name)}" style="padding:0.5rem 0.7rem;cursor:pointer;border-bottom:1px solid var(--color-border);font-size:0.8rem;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <strong style="color:var(--color-primary);">${escapeHtml(p.sku)}</strong>
              <span style="color:var(--color-text-main);margin-left:0.4rem;">${escapeHtml(p.name)}</span>
            </div>
          </div>
        `).join('');
      }
      expiryProdDropdown.style.display = 'block';
    });

    expiryProdDropdown?.addEventListener('click', (e) => {
      const item = e.target.closest('.expiry-search-item');
      if (!item) return;

      const sku = item.getAttribute('data-sku');
      const name = item.getAttribute('data-name');
      expiryState.productSku = sku || '';
      expiryState.productName = name || '';

      if (expiryProdInput) expiryProdInput.value = name || sku;
      expiryProdDropdown.style.display = 'none';
      renderExpiryLivePreview();
    });

    document.addEventListener('click', (e) => {
      if (expiryProdInput && expiryProdDropdown && !expiryProdInput.contains(e.target) && !expiryProdDropdown.contains(e.target)) {
        expiryProdDropdown.style.display = 'none';
      }
    });

    // Barcode type
    expiryBarcodeSelect?.addEventListener('change', (e) => {
      expiryState.barcodeType = e.target.value;
      renderExpiryLivePreview();
    });

    // Icon button selections
    document.querySelectorAll('.expiry-icon-opt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const iconKey = btn.getAttribute('data-icon');
        expiryState.icon = iconKey;
        document.querySelectorAll('.expiry-icon-opt-btn').forEach(b => {
          const isTarget = b.getAttribute('data-icon') === iconKey;
          b.style.borderColor = isTarget ? 'var(--color-primary)' : 'var(--color-border)';
          b.style.background = isTarget ? 'rgba(37,99,235,0.08)' : 'var(--color-bg)';
        });
        renderExpiryLivePreview();
      });
    });

    // Visual style
    expiryStyleSelect?.addEventListener('change', (e) => {
      expiryState.style = e.target.value;
      renderExpiryLivePreview();
    });

    // Commerce footer
    expiryCommerceCb?.addEventListener('change', (e) => {
      expiryState.includeCommerce = e.target.checked;
      renderExpiryLivePreview();
    });

    // Sheets count
    expirySheetsCountInput?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10) || 1;
      expiryState.sheetsCount = Math.max(1, val);
      renderExpiryLivePreview();
    });

    // Emit expiry labels button
    const btnEmitExpiry = document.getElementById('btn-emit-expiry-labels');
    btnEmitExpiry?.addEventListener('click', () => {
      window.printExpiryLabels(expiryState);
    });

    // Download expiry ZPL button
    const btnDownloadExpiryZpl = document.getElementById('btn-download-expiry-zpl');
    btnDownloadExpiryZpl?.addEventListener('click', () => {
      window.showExpiryZPLModal(expiryState);
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
   * Main fragile label printing engine with exact physical boundaries and multi-copy support.
   */
  window.printFragileLabels = function (opts) {
    const sheetsCount = parseInt(opts.sheetsCount, 10) || 1;
    const selectedSize = opts.size || '10x15';

    let sizeCSS = '10cm 15cm';
    let sheetWidth = '10cm';
    let sheetHeight = '15cm';

    if (selectedSize === '10x10') {
      sizeCSS = '10cm 10cm';
      sheetWidth = '10cm';
      sheetHeight = '10cm';
    } else if (selectedSize === '5x5') {
      sizeCSS = '5cm 5cm';
      sheetWidth = '5cm';
      sheetHeight = '5cm';
    } else if (selectedSize === '5x2.5') {
      sizeCSS = '5cm 2.5cm';
      sheetWidth = '5cm';
      sheetHeight = '2.5cm';
    }

    let sheetsHTML = '';
    for (let s = 0; s < sheetsCount; s++) {
      sheetsHTML += `
        <div class="fragile-print-page size-${selectedSize}">
          ${renderFragileSheetHTML(opts, true)}
        </div>
      `;
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Imprimir Etiquetas Frágil - WMS Stocka</title>
        <style>
          html, body {
            margin: 0;
            padding: 0;
            background: #fff;
            color: #000;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          
          .fragile-print-page {
            box-sizing: border-box;
            width: ${sheetWidth};
            height: ${sheetHeight};
            position: relative;
            background: #fff;
            page-break-after: always;
            overflow: hidden;
            display: flex;
          }

          .fragile-print-page:last-child {
            page-break-after: avoid;
          }

          .fragile-sheet-wrapper {
            width: 100%;
            height: 100%;
            display: grid;
            box-sizing: border-box;
          }

          .fragile-sub-sticker {
            width: 100%;
            height: 100%;
            box-sizing: border-box;
            padding: 2mm;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }

          .fragile-inner-card {
            width: 100%;
            height: 100%;
            border: 2.5px solid #000;
            border-radius: 3px;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: space-between;
            overflow: hidden;
          }

          @page {
            size: ${sizeCSS};
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
        ${sheetsHTML}
      </body>
      </html>
    `;

    // Deploy hidden print Frame
    const iframe = document.createElement('iframe');
    iframe.id = 'wms-print-fragile-iframe';
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
        console.error("Failed to open native print dialog for fragile labels:", err);
        Swal.fire('Error', 'No se pudo abrir el cuadro de impresión nativo del navegador.', 'error');
      } finally {
        setTimeout(() => {
          const element = document.getElementById('wms-print-fragile-iframe');
          if (element) element.remove();
        }, 1000);
      }
    }, 400);
  };

  /**
   * Compiles Zebra ZPL II code for Fragile warning labels with multi-copy support.
   */
  window.compileFragileZPL = function (opts) {
    let zpl = '';
    let pw = 800; // print width in dots at 203 DPI
    let ll = 1200; // label length in dots

    if (opts.size === '10x10') {
      pw = 800;
      ll = 800;
    } else if (opts.size === '5x5') {
      pw = 400;
      ll = 400;
    } else if (opts.size === '5x2.5') {
      pw = 400;
      ll = 200;
    }

    const copies = parseInt(opts.copiesPerSheet, 10) || 1;
    const sheets = parseInt(opts.sheetsCount, 10) || 1;
    const cleanMain = (opts.mainText || 'FRAGIL').toUpperCase().replace(/[\^\~]/g, '');
    const cleanSub = (opts.subText || '').toUpperCase().replace(/[\^\~]/g, '');

    let cols = 1;
    let rows = 1;
    if (copies === 2) {
      if (opts.size === '5x2.5') { cols = 2; rows = 1; }
      else { cols = 1; rows = 2; }
    } else if (copies === 4) {
      cols = 2; rows = 2;
    } else if (copies === 6) {
      cols = 2; rows = 3;
    }

    const cellW = Math.floor(pw / cols);
    const cellH = Math.floor(ll / rows);

    for (let s = 0; s < sheets; s++) {
      zpl += `^XA\n`;
      zpl += `^CI28\n`; // UTF-8
      zpl += `^PW${pw}\n`;
      zpl += `^LL${ll}\n`;
      zpl += `^LH0,0\n`;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const ox = c * cellW;
          const oy = r * cellH;
          const pad = 12;
          const boxX = ox + pad;
          const boxY = oy + pad;
          const boxW = cellW - (pad * 2);
          const boxH = cellH - (pad * 2);

          // Outer border
          zpl += `^FO${boxX},${boxY}^GB${boxW},${boxH},6,B,0^FS\n`;

          // Header banner
          const headerH = Math.min(Math.floor(boxH * 0.2), 55);
          zpl += `^FO${boxX},${boxY}^GB${boxW},${headerH},${headerH},B,0^FS\n`;
          zpl += `^FO${boxX + 8},${boxY + 10}^A0N,${Math.floor(headerH * 0.65)},${Math.floor(headerH * 0.65)}^FR^FD*** CUIDADO / FRAGIL ***^FS\n`;

          // Main Text
          const fontH = Math.min(Math.floor(boxH * 0.28), Math.floor((boxW / Math.max(cleanMain.length, 1)) * 1.4), 100);
          const fontW = Math.floor(fontH * 0.85);
          const textY = boxY + headerH + Math.floor((boxH - headerH - fontH) / 2) - 10;
          zpl += `^FO${boxX + 10},${textY}^A0N,${fontH},${fontW}^FB${boxW - 20},1,0,C,0^FD${cleanMain}^FS\n`;

          // Subtitle
          if (cleanSub && boxH > 150) {
            const subH = Math.min(24, Math.floor(boxH * 0.1));
            const subY = boxY + boxH - subH - 16;
            zpl += `^FO${boxX + 10},${subY}^A0N,${subH},${Math.floor(subH * 0.85)}^FB${boxW - 20},1,0,C,0^FD${cleanSub}^FS\n`;
          }
        }
      }

      // Cut guidelines if multi-copy
      if (cols > 1) {
        for (let i = 1; i < cols; i++) {
          zpl += `^FO${i * cellW},0^GB2,${ll},2,B,0^FS\n`;
        }
      }
      if (rows > 1) {
        for (let i = 1; i < rows; i++) {
          zpl += `^FO0,${i * cellH}^GB${pw},2,2,B,0^FS\n`;
        }
      }

      zpl += `^XZ\n`;
    }

    return zpl;
  };

  /**
   * Compiles and downloads a ZPL file for Fragile labels.
   */
  window.downloadFragileZPLFile = function (opts) {
    const zplCode = window.compileFragileZPL(opts);
    const blob = new Blob([zplCode], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `etiquetas_fragil_${opts.size}_${Date.now()}.zpl`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /**
   * Shows a copyable & downloadable modal for Fragile ZPL code.
   */
  window.showFragileZPLModal = function (opts) {
    const zplCode = window.compileFragileZPL(opts);

    Swal.fire({
      title: 'Código ZPL II - Etiquetas FRÁGIL',
      html: `
        <div style="text-align: left; margin-bottom: 0.75rem;">
          <span style="font-size: 0.85rem; color: var(--color-text-muted);">Código listo para enviar a impresoras Zebra, Rollo o compatibles con ZPL II:</span>
        </div>
        <textarea id="swal-fragile-zpl-code-area" readonly style="
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
      denyButtonText: '<i class="ri-download-2-line" style="margin-right:0.25rem;"></i> Descargar ZPL',
      showDenyButton: true,
      confirmButtonColor: 'var(--color-success)',
      denyButtonColor: 'var(--color-primary)',
      focusConfirm: false,
      preConfirm: () => {
        const textarea = document.getElementById('swal-fragile-zpl-code-area');
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
          title: '¡Copiado!',
          text: 'Código ZPL copiado al portapapeles.',
          icon: 'success',
          timer: 1500,
          showConfirmButton: false
        });
      } else if (result.isDenied) {
        window.downloadFragileZPLFile(opts);
      }
    });
  };

  /**
   * Main expiration label printing engine with exact physical boundaries and multi-copy support.
   */
  window.printExpiryLabels = function (opts) {
    const sheetsCount = parseInt(opts.sheetsCount, 10) || 1;
    const selectedSize = opts.size || '10x15';

    let sizeCSS = '10cm 15cm';
    let sheetWidth = '10cm';
    let sheetHeight = '15cm';

    if (selectedSize === '10x10') {
      sizeCSS = '10cm 10cm';
      sheetWidth = '10cm';
      sheetHeight = '10cm';
    } else if (selectedSize === '5x5') {
      sizeCSS = '5cm 5cm';
      sheetWidth = '5cm';
      sheetHeight = '5cm';
    } else if (selectedSize === '5x2.5') {
      sizeCSS = '5cm 2.5cm';
      sheetWidth = '5cm';
      sheetHeight = '2.5cm';
    }

    let baseFontSize = '14px';
    if (selectedSize === '5x5') baseFontSize = '12px';
    else if (selectedSize === '5x2.5') baseFontSize = '10px';
    if (parseInt(opts.copiesPerSheet, 10) >= 8) baseFontSize = '11px';

    let sheetsHTML = '';
    for (let s = 0; s < sheetsCount; s++) {
      sheetsHTML += `
        <div class="expiry-print-page size-${selectedSize}">
          ${renderExpirySheetHTML(opts, true)}
        </div>
      `;
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Imprimir Etiquetas Vencimiento - WMS Stocka</title>
        <style>
          html, body {
            margin: 0;
            padding: 0;
            background: #fff;
            color: #000;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          
          .expiry-print-page {
            box-sizing: border-box;
            width: ${sheetWidth};
            height: ${sheetHeight};
            position: relative;
            background: #fff;
            page-break-after: always;
            overflow: hidden;
            display: flex;
            font-size: ${baseFontSize};
          }

          .expiry-print-page:last-child {
            page-break-after: avoid;
          }

          .expiry-sheet-wrapper {
            width: 100%;
            height: 100%;
            display: grid;
            box-sizing: border-box;
          }

          .expiry-sub-sticker {
            width: 100%;
            height: 100%;
            box-sizing: border-box;
            padding: 2mm;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }

          .expiry-inner-card {
            width: 100%;
            height: 100%;
            border: 2.5px solid #000;
            border-radius: 3px;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: space-between;
            overflow: hidden;
          }

          .expiry-center-body {
            flex: 1;
            width: 100%;
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 2px 4px;
            box-sizing: border-box;
            overflow: hidden;
          }

          .expiry-main-row {
            display: flex !important;
            flex-direction: row !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 6px !important;
            width: 100% !important;
            box-sizing: border-box;
          }

          .expiry-text-block {
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            justify-content: center !important;
            text-align: center !important;
            width: 100% !important;
          }

          .expiry-prefix-label {
            display: block !important;
            width: 100% !important;
            text-align: center !important;
            clear: both !important;
            margin: 0 0 2px 0 !important;
            padding: 0 !important;
            font-size: 0.68em !important;
            font-weight: 800 !important;
            text-transform: uppercase !important;
            letter-spacing: 0.5px !important;
            line-height: 1.1 !important;
          }

          .expiry-date-display {
            display: block !important;
            width: 100% !important;
            text-align: center !important;
            clear: both !important;
            margin: 0 !important;
            padding: 0 !important;
            font-family: 'Impact', 'Arial Black', -apple-system, sans-serif !important;
            font-weight: 900 !important;
            letter-spacing: 1px !important;
            line-height: 1 !important;
            white-space: nowrap !important;
          }

          @page {
            size: ${sizeCSS};
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
        ${sheetsHTML}
      </body>
      </html>
    `;

    // Deploy hidden print Frame
    const iframe = document.createElement('iframe');
    iframe.id = 'wms-print-expiry-iframe';
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
        console.error("Failed to open native print dialog for expiry labels:", err);
        Swal.fire('Error', 'No se pudo abrir el cuadro de impresión nativo del navegador.', 'error');
      } finally {
        setTimeout(() => {
          const element = document.getElementById('wms-print-expiry-iframe');
          if (element) element.remove();
        }, 1000);
      }
    }, 400);
  };

  /**
   * Compiles Zebra ZPL II code for Expiration warning labels with multi-copy support.
   */
  window.compileExpiryZPL = function (opts) {
    let zpl = '';
    let pw = 800; // print width in dots at 203 DPI
    let ll = 1200; // label length in dots

    if (opts.size === '10x10') {
      pw = 800;
      ll = 800;
    } else if (opts.size === '5x5') {
      pw = 400;
      ll = 400;
    } else if (opts.size === '5x2.5') {
      pw = 400;
      ll = 200;
    }

    const copies = parseInt(opts.copiesPerSheet, 10) || 1;
    const sheets = parseInt(opts.sheetsCount, 10) || 1;

    let cols = 1;
    let rows = 1;
    if (copies === 2) {
      if (opts.size === '5x2.5') { cols = 2; rows = 1; }
      else { cols = 1; rows = 2; }
    } else if (copies === 4) {
      cols = 2; rows = 2;
    } else if (copies === 6) {
      if (opts.size === '10x15') { cols = 2; rows = 3; }
      else { cols = 3; rows = 2; }
    } else if (copies === 8) {
      cols = 2; rows = 4;
    } else if (copies === 9) {
      cols = 3; rows = 3;
    } else if (copies === 12) {
      cols = 3; rows = 4;
    }

    const cellW = Math.floor(pw / cols);
    const cellH = Math.floor(ll / rows);

    const formattedExp = formatDisplayDate(opts.expiryDate, opts.dateFormat) || '25/12/2026';
    const cleanPrefix = (opts.expiryPrefix || 'VENCE:').toUpperCase().replace(/[\^\~]/g, '');
    const cleanProd = (opts.includeProduct && opts.productName ? opts.productName.toUpperCase() : '').replace(/[\^\~]/g, '');
    const cleanLot = (opts.includeLot && opts.lotNumber ? opts.lotNumber.toUpperCase() : '').replace(/[\^\~]/g, '');

    for (let s = 0; s < sheets; s++) {
      zpl += `^XA\n`;
      zpl += `^CI28\n`; // UTF-8
      zpl += `^PW${pw}\n`;
      zpl += `^LL${ll}\n`;
      zpl += `^LH0,0\n`;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const ox = c * cellW;
          const oy = r * cellH;
          const pad = 12;
          const boxX = ox + pad;
          const boxY = oy + pad;
          const boxW = cellW - (pad * 2);
          const boxH = cellH - (pad * 2);

          // Outer border
          zpl += `^FO${boxX},${boxY}^GB${boxW},${boxH},4,B,0^FS\n`;

          let currentY = boxY + 8;

          // Header banner or product title
          if (cleanProd && boxH > 120) {
            zpl += `^FO${boxX + 6},${currentY}^A0N,22,20^FB${boxW - 12},1,0,C,0^FD${cleanProd}^FS\n`;
            currentY += 28;
            zpl += `^FO${boxX},${currentY}^GB${boxW},2,2,B,0^FS\n`;
            currentY += 8;
          } else if (opts.style === 'badge' && boxH > 120) {
            const bannerH = 26;
            zpl += `^FO${boxX},${currentY}^GB${boxW},${bannerH},${bannerH},B,0^FS\n`;
            zpl += `^FO${boxX + 4},${currentY + 4}^A0N,18,18^FR^FB${boxW - 8},1,0,C,0^FD*** VENCIMIENTO ***^FS\n`;
            currentY += bannerH + 8;
          }

          // Main Expiration Display: 2 distinct vertical rows (Prefix on top, Date prominent below)
          const hasLotZpl = cleanLot && boxH > 130;
          const lotSpace = hasLotZpl ? 34 : 10;
          const availH = Math.max(40, boxH - (currentY - boxY) - lotSpace);

          // Row 1: Prefix label (smaller, clear)
          const prefixH = Math.max(14, Math.min(30, Math.floor(availH * 0.24)));
          const prefixW = Math.floor(prefixH * 0.82);

          // Row 2: Big Bold Expiry Date
          const maxDateHByWidth = Math.floor((boxW - 16) / Math.max(formattedExp.length, 1) * 1.55);
          const maxDateHByHeight = Math.floor(availH * 0.56);
          const dateFontH = Math.max(18, Math.min(maxDateHByHeight, maxDateHByWidth, 85));
          const dateFontW = Math.floor(dateFontH * 0.84);

          const spacing = Math.max(4, Math.floor(availH * 0.06));
          const totalContentH = prefixH + spacing + dateFontH;
          const startY = currentY + Math.max(0, Math.floor((availH - totalContentH) / 2));

          // 1. Prefix row (top)
          zpl += `^FO${boxX + 6},${startY}^A0N,${prefixH},${prefixW}^FB${boxW - 12},1,0,C,0^FD${cleanPrefix}^FS\n`;

          // 2. Date row (below prefix)
          const dateY = startY + prefixH + spacing;
          zpl += `^FO${boxX + 6},${dateY}^A0N,${dateFontH},${dateFontW}^FB${boxW - 12},1,0,C,0^FD${formattedExp}^FS\n`;

          // Secondary row (Lot)
          if (hasLotZpl) {
            const subY = boxY + boxH - 28;
            zpl += `^FO${boxX + 6},${subY}^A0N,20,18^FB${boxW - 12},1,0,C,0^FDLOTE: ${cleanLot}^FS\n`;
          }
        }
      }

      // Cut guidelines if multi-copy
      if (cols > 1) {
        for (let i = 1; i < cols; i++) {
          zpl += `^FO${i * cellW},0^GB2,${ll},2,B,0^FS\n`;
        }
      }
      if (rows > 1) {
        for (let i = 1; i < rows; i++) {
          zpl += `^FO0,${i * cellH}^GB${pw},2,2,B,0^FS\n`;
        }
      }

      zpl += `^XZ\n`;
    }

    return zpl;
  };

  /**
   * Compiles and downloads a ZPL file for Expiry labels.
   */
  window.downloadExpiryZPLFile = function (opts) {
    const zplCode = window.compileExpiryZPL(opts);
    const blob = new Blob([zplCode], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `etiquetas_vencimiento_${opts.size}_${Date.now()}.zpl`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /**
   * Shows a copyable & downloadable modal for Expiry ZPL code.
   */
  window.showExpiryZPLModal = function (opts) {
    const zplCode = window.compileExpiryZPL(opts);

    Swal.fire({
      title: 'Código ZPL II - Etiquetas con Vencimiento',
      html: `
        <div style="text-align: left; margin-bottom: 0.75rem;">
          <span style="font-size: 0.85rem; color: var(--color-text-muted);">Código listo para enviar a impresoras Zebra, Rollo o compatibles con ZPL II:</span>
        </div>
        <textarea id="swal-expiry-zpl-code-area" readonly style="
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
      denyButtonText: '<i class="ri-download-2-line" style="margin-right:0.25rem;"></i> Descargar ZPL',
      showDenyButton: true,
      confirmButtonColor: 'var(--color-success)',
      denyButtonColor: 'var(--color-primary)',
      focusConfirm: false,
      preConfirm: () => {
        const textarea = document.getElementById('swal-expiry-zpl-code-area');
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
          title: '¡Copiado!',
          text: 'Código ZPL copiado al portapapeles.',
          icon: 'success',
          timer: 1500,
          showConfirmButton: false
        });
      } else if (result.isDenied) {
        window.downloadExpiryZPLFile(opts);
      }
    });
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
