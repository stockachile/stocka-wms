import supabase from './supabase.js?v=1.0.3';

// --- CONFIGURACIÓN Y ESTILOS ---
function injectImporterStyles() {
  if (document.getElementById('enviame-importer-styles')) return;
  const style = document.createElement('style');
  style.id = 'enviame-importer-styles';
  style.innerHTML = `
    .importer-drag-drop {
      border: 2px dashed var(--color-border);
      border-radius: var(--radius-md);
      padding: 2rem;
      text-align: center;
      background: var(--color-surface-hover);
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
    }
    .importer-drag-drop:hover, .importer-drag-drop.dragover {
      border-color: #9c27b0;
      background: rgba(156, 39, 176, 0.03);
    }
    .importer-preview-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .importer-preview-table th, .importer-preview-table td {
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--color-border);
      text-align: left;
    }
    .importer-preview-table th {
      background: var(--color-surface-hover);
      font-weight: 700;
      color: var(--color-text-main);
    }
    .importer-alert-warning {
      background: rgba(217, 119, 6, 0.1);
      border: 1px solid #d97706;
      color: #d97706;
      border-radius: var(--radius-md);
      padding: 0.75rem 1rem;
      font-size: 0.8rem;
      margin-bottom: 1rem;
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
    }
    
    /* Estilos para simular hoja A4 de factura */
    .invoice-preview-paper {
      width: 210mm;
      min-height: 297mm;
      padding: 15mm;
      background: white;
      box-shadow: 0 0 15px rgba(0,0,0,0.15);
      margin: 1rem auto;
      box-sizing: border-box;
      font-family: 'Outfit', 'Inter', sans-serif;
      color: #333;
      text-align: left;
    }
    .invoice-table-header {
      background: #00D2C8 !important;
      color: white !important;
      font-weight: bold;
      text-transform: uppercase;
      font-size: 0.75rem;
    }
    .invoice-banner-purple {
      background: #5B00E4;
      color: white;
      text-align: center;
      font-weight: bold;
      padding: 0.4rem;
      text-transform: uppercase;
      font-size: 0.85rem;
      margin: 1rem 0;
    }
    .invoice-banner-cyan {
      background: #00D2C8;
      color: white;
      font-weight: bold;
      padding: 0.4rem 1rem;
      font-size: 0.85rem;
      display: flex;
      justify-content: space-between;
      margin-bottom: 1rem;
    }
  `;
  document.head.appendChild(style);
}

// --- HELPERS BÁSICOS ---
function formatCLP(val) {
  const num = Math.round(Number(val) || 0);
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(num).replace(',00', '');
}

// Formatear pesos con punto y sin signo para inputs de edición rápida
function formatCLPRaw(val) {
  const num = Math.round(Number(val) || 0);
  return new Intl.NumberFormat('es-CL').format(num);
}

function formatWeight(val) {
  const num = Number(val) || 0;
  return num.toFixed(2).replace('.', ',');
}

function addBusinessDays(startDateStr, days) {
  const date = new Date(startDateStr + 'T12:00:00');
  let added = 0;
  while (added < days) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) { // Excluir Domingo (0) y Sábado (6)
      added++;
    }
  }
  return date.toISOString().split('T')[0];
}

// Buscar claves ignorando mayúsculas y caracteres especiales
function getRowValue(row, possibleKeys) {
  const rowKeys = Object.keys(row);
  for (let pk of possibleKeys) {
    const cleanPk = pk.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (let rk of rowKeys) {
      const cleanRk = rk.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleanPk === cleanRk) {
        return row[rk];
      }
    }
  }
  return null;
}

// --- INICIO MÓDULO IMPORTADOR ---
window.openEnviameImporterModal = async function(periodId, periodName) {
  injectImporterStyles();
  
  // Pre-load historical analytics data for PDF comparative views
  fetch('js/historical_enviame_data.json')
    .then(res => res.json())
    .then(async (data) => {
      window.historicalEnviameData = data.global || data;
      window.commerceHistoricalEnviameData = data.byCommerce || {};
      
      // Load confirmed stats from the cloud (Supabase Storage)
      try {
        const { data: records, error } = await supabase
          .from('billing_records')
          .select('period_id');
        if (!error && records && records.length > 0) {
          const uniquePeriodIds = [...new Set(records.map(r => r.period_id))];
          const fetchPromises = uniquePeriodIds.map(async (pId) => {
            try {
              const storagePath = `billing_files/${pId}_enviame_confirmed_stats.json`;
              const { data: statsBlob, error: downloadErr } = await supabase.storage
                .from('payment_receipts')
                .download(storagePath);
              if (!downloadErr && statsBlob) {
                const text = await statsBlob.text();
                const periodStats = JSON.parse(text);
                window.mergeConfirmedPeriodStats(periodStats);
              }
            } catch (e) {
              // Ignore individual fetch errors (file might not exist yet)
            }
          });
          await Promise.all(fetchPromises);
        }
      } catch (err) {
        console.warn("Could not load cloud confirmed stats:", err);
      }
    })
    .catch(err => {
      console.warn("Could not pre-fetch historical enviame data:", err);
      window.commerceHistoricalEnviameData = {};
    });
  
  window.importerIndemnifications = []; // Initialize empty indemnifications list
  
  let modal = document.getElementById('modal-enviame-importer');
  if (modal) modal.remove();
  
  modal = document.createElement('div');
  modal.id = 'modal-enviame-importer';
  modal.className = 'modal-overlay active';
  modal.style.zIndex = '10000';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.background = 'rgba(0, 0, 0, 0.5)';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100vw';
  modal.style.height = '100vh';
  
  const todayStr = new Date().toISOString().split('T')[0];
  const defaultDeadlineStr = addBusinessDays(todayStr, 3);
  
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 1000px; width: 95%; max-height: 90vh; overflow-y: auto; background: var(--color-surface); border-radius: var(--radius-lg); padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; box-shadow: var(--shadow-lg); border: 1px solid var(--color-border);">
      
      <!-- Cabecera -->
      <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--color-border); padding-bottom: 0.75rem; margin-bottom: 0.5rem;">
        <h3 style="margin: 0; font-size: 1.15rem; color: var(--color-text-main); font-weight: 700; display: flex; align-items: center; gap: 0.5rem;">
          <i class="ri-file-excel-2-line" style="color: #9c27b0; font-size: 1.4rem;"></i>
          Importar Cobros Envíame - Periodo: ${periodName}
        </h3>
        <button onclick="document.getElementById('modal-enviame-importer').remove()" class="btn-close" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--color-text-muted); padding: 0.2rem;"><i class="ri-close-line"></i></button>
      </div>

      <!-- Configuración Inicial del Formulario -->
      <div id="importer-form-section" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; background: var(--color-bg); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
        <div>
          <label style="display: block; font-size: 0.75rem; font-weight: 600; color: var(--color-text-muted); margin-bottom: 0.25rem;">FECHA DE EMISIÓN PDF</label>
          <input type="date" id="importer-fecha-emision" class="form-input" value="${todayStr}" onchange="document.getElementById('importer-fecha-limite').value = addBusinessDays(this.value, 3)" style="width: 100%; box-sizing: border-box;">
        </div>
        <div>
          <label style="display: block; font-size: 0.75rem; font-weight: 600; color: var(--color-text-muted); margin-bottom: 0.25rem;">FECHA LÍMITE DE PAGO</label>
          <input type="date" id="importer-fecha-limite" class="form-input" value="${defaultDeadlineStr}" style="width: 100%; box-sizing: border-box;">
        </div>
        <div>
          <label style="display: block; font-size: 0.75rem; font-weight: 600; color: var(--color-text-muted); margin-bottom: 0.25rem;">ESTADO DE PAGO</label>
          <select id="importer-pago-status" class="form-input" style="width: 100%; box-sizing: border-box;">
            <option value="En espera" selected>En espera</option>
            <option value="Por solicitar">Por solicitar</option>
            <option value="Recibido">Recibido</option>
          </select>
        </div>
        <div>
          <label style="display: block; font-size: 0.75rem; font-weight: 600; color: var(--color-text-muted); margin-bottom: 0.25rem;">ESTADO DE FACTURA</label>
          <select id="importer-factura-status" class="form-input" style="width: 100%; box-sizing: border-box;">
            <option value="Esperando" selected>Esperando</option>
            <option value="Facturar">Facturar</option>
            <option value="Emitida">Emitida</option>
            <option value="No se factura">No se factura</option>
          </select>
        </div>
      </div>

      <!-- Zona de Carga de Archivo -->
      <div id="importer-upload-section">
        <div id="importer-dropzone" class="importer-drag-drop">
          <i class="ri-upload-cloud-2-line" style="font-size: 2.5rem; color: #9c27b0;"></i>
          <span style="font-weight: 600; color: var(--color-text-main); font-size: 0.9rem;">Arrastra y suelta tu planilla Excel o CSV aquí</span>
          <span style="font-size: 0.75rem; color: var(--color-text-muted);">o haz clic para buscar el archivo en tu equipo</span>
          <input type="file" id="importer-file-input" accept=".xlsx, .xls, .csv" style="display: none;">
        </div>
      </div>

      <!-- Spinner de Procesamiento de Carga -->
      <div id="importer-loading-section" style="display: none; text-align: center; padding: 2rem;">
        <i class="ri-loader-4-line spin" style="font-size: 2.5rem; color: #9c27b0; display: block; margin-bottom: 0.75rem;"></i>
        <span id="importer-loading-text" style="font-size: 0.85rem; color: var(--color-text-muted); font-weight: 500;">Leyendo y validando planilla de cobros...</span>
      </div>

      <!-- Sección de Resultados del Análisis -->
      <div id="importer-results-section" style="display: none; flex-direction: column; gap: 1rem;">
        
        <!-- Alertas / IDs no configurados -->
        <div id="importer-warnings-container" style="display: none;"></div>

        <!-- Tabla Resumen -->
        <div class="card" style="border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface);">
          <div class="card-header" style="padding: 0.75rem 1rem; border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center;">
            <h4 style="margin: 0; font-size: 0.9rem; font-weight: 600; color: var(--color-text-main);"><i class="ri-list-check" style="margin-right: 0.25rem;"></i> Comercios Detectados en la Planilla</h4>
            <span id="importer-total-summary-badge" class="badge badge-neutral" style="font-size: 0.75rem;">0 despachos detectados</span>
          </div>
          <div class="table-responsive" style="max-height: 250px; overflow-y: auto;">
            <table class="importer-preview-table">
              <thead>
                <tr>
                  <th style="width: 40px; text-align: center;">
                    <input type="checkbox" id="importer-select-all" checked style="width: 15px; height: 15px; cursor: pointer; accent-color: #9c27b0;">
                  </th>
                  <th>Comercio</th>
                  <th>Razón Social</th>
                  <th>RUT</th>
                  <th style="text-align: right;">Cantidad</th>
                  <th style="text-align: right;">Neto</th>
                  <th style="text-align: right;">IVA (19%)</th>
                  <th style="text-align: right;">Total Factura</th>
                  <th style="text-align: right;">Indemnizaciones</th>
                  <th style="text-align: right;">Total a Pagar</th>
                  <th style="text-align: center; width: 120px;">Acciones</th>
                </tr>
              </thead>
              <tbody id="importer-results-tbody"></tbody>
            </table>
          </div>
        </div>

        <!-- Sección de Conglomerados -->
        <div id="importer-groups-card" class="card" style="display: none; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); margin-top: 0.5rem;">
          <div class="card-header" style="padding: 0.75rem 1rem; border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center; background: rgba(91, 0, 228, 0.03);">
            <h4 style="margin: 0; font-size: 0.875rem; font-weight: 600; color: #5B00E4; display: flex; align-items: center; gap: 0.35rem;">
              <i class="ri-government-line" style="font-size: 1.1rem;"></i>
              Resumen de Conglomerados (Holding / Cuentas Consolidadas)
            </h4>
            <span id="importer-groups-badge" class="badge" style="background: #5B00E4; color: white; font-size: 0.75rem;">0 conglomerados</span>
          </div>
          <div class="table-responsive" style="max-height: 200px; overflow-y: auto;">
            <table class="importer-preview-table" style="font-size: 0.8rem;">
              <thead>
                <tr>
                  <th>Conglomerado (Razón Social)</th>
                  <th>Comercios Asociados</th>
                  <th style="text-align: right;">Cantidad Total</th>
                  <th style="text-align: right;">Neto Consolidado</th>
                  <th style="text-align: right;">Descuentos</th>
                  <th style="text-align: right;">Total a Pagar</th>
                  <th style="text-align: center; width: 170px;">Acciones</th>
                </tr>
              </thead>
              <tbody id="importer-groups-tbody"></tbody>
            </table>
          </div>
        </div>

        <!-- Sección de Derivación Manual de ID 8326 -->
        <div id="importer-manual-derivation-card" class="card" style="display: none; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); margin-top: 0.5rem;">
          <div class="card-header" style="padding: 0.75rem 1rem; border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center; background: var(--color-surface-hover);">
            <h4 style="margin: 0; font-size: 0.875rem; font-weight: 600; color: var(--color-text-main); display: flex; align-items: center; gap: 0.35rem;">
              <i class="ri-git-branch-line" style="color: #9c27b0; font-size: 1.1rem;"></i>
              Derivación Manual de Envíos (ID Envíame 8326 - Cuenta Stocka)
            </h4>
            <span id="importer-manual-derivation-badge" class="badge badge-warning" style="font-size: 0.75rem;">0 envíos para derivar</span>
          </div>
          <div class="table-responsive" style="max-height: 250px; overflow-y: auto; padding: 0.5rem 1rem;">
            <table class="importer-preview-table" style="font-size: 0.75rem;">
              <thead>
                <tr>
                  <th>ID Pedido</th>
                  <th>Tracking</th>
                  <th>Destino</th>
                  <th>Courier</th>
                  <th style="text-align: right; width: 100px;">Neto</th>
                  <th style="width: 250px;">Derivar a Comercio</th>
                </tr>
              </thead>
              <tbody id="importer-manual-derivation-tbody"></tbody>
            </table>
          </div>
        </div>

        <!-- Sección de Indemnizaciones y Descuentos Manuales -->
        <div class="card" style="border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); margin-top: 0.5rem;">
          <div class="card-header" style="padding: 0.75rem 1rem; border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center; background: var(--color-surface-hover);">
            <h4 style="margin: 0; font-size: 0.875rem; font-weight: 600; color: var(--color-text-main); display: flex; align-items: center; gap: 0.35rem;">
              <i class="ri-refund-2-line" style="color: #e53935; font-size: 1.1rem;"></i>
              Indemnizaciones y Descuentos Manuales
            </h4>
            <button type="button" class="btn btn-primary btn-sm" onclick="window.addImporterIndemnificationRow('${periodId}')" style="background: #e53935; border-color: #e53935; padding: 0.25rem 0.6rem; height: auto; font-size: 0.75rem;">
              <i class="ri-add-line"></i> Agregar Indemnización
            </button>
          </div>
          <div class="table-responsive" style="padding: 0.5rem 1rem;">
            <table class="importer-preview-table" style="font-size: 0.75rem;">
              <thead>
                <tr>
                  <th style="width: 200px;">Comercio</th>
                  <th>Pedido</th>
                  <th>Operador / Courier</th>
                  <th>Razón / Concepto</th>
                  <th style="width: 130px; text-align: right;">Monto Neto ($)</th>
                  <th style="width: 70px; text-align: center;">Acción</th>
                </tr>
              </thead>
              <tbody id="importer-indemnifications-tbody">
                <tr><td colspan="6" style="text-align: center; color: var(--color-text-muted); padding: 1rem;">No se han agregado indemnizaciones para este periodo.</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Acciones Finales -->
        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--color-border); padding-top: 1rem;">
          <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; font-weight: 600; color: var(--color-text-main); cursor: pointer;">
            <input type="checkbox" id="importer-send-notification" style="width: 16px; height: 16px; accent-color: #9c27b0;">
            ¿Enviar notificaciones por correo automáticamente al registrar?
          </label>
          <div style="display: flex; gap: 0.5rem;">
            <button onclick="document.getElementById('modal-enviame-importer').remove()" class="btn btn-outline">Cancelar</button>
            <button id="btn-importer-process" onclick="window.processSelectedEnviameImports('${periodId}')" class="btn btn-primary" style="background: #9c27b0; border-color: #9c27b0;"><i class="ri-checkbox-circle-line"></i> Procesar y Registrar Seleccionados</button>
          </div>
        </div>
      </div>
      <datalist id="importer-comercios-datalist"></datalist>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Registrar manejadores del file input
  const fileInput = document.getElementById('importer-file-input');
  const dropzone = document.getElementById('importer-dropzone');
  
  dropzone.onclick = () => fileInput.click();
  
  dropzone.ondragover = (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  };
  
  dropzone.ondragleave = () => {
    dropzone.classList.remove('dragover');
  };
  
  dropzone.ondrop = (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleSelectedFile(e.dataTransfer.files[0], periodId);
    }
  };
  
  fileInput.onchange = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleSelectedFile(e.target.files[0], periodId);
    }
  };
};

// --- ANÁLISIS DE PLANILLA ---
async function handleSelectedFile(file, periodId) {
  const formSection = document.getElementById('importer-form-section');
  const uploadSection = document.getElementById('importer-upload-section');
  const loadingSection = document.getElementById('importer-loading-section');
  const resultsSection = document.getElementById('importer-results-section');
  
  formSection.style.display = 'none';
  uploadSection.style.display = 'none';
  loadingSection.style.display = 'block';
  window.importerIndemnifications = []; // Reset indemnifications array on file load
  
  try {
    const reader = new FileReader();
    reader.onload = async function(e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        
        if (workbook.SheetNames.length === 0) {
          throw new Error("El archivo no tiene hojas de cálculo legibles.");
        }
        
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        
        if (rows.length === 0) {
          throw new Error("La planilla cargada está vacía.");
        }
        
        document.getElementById('importer-loading-text').textContent = "Consultando comercios y mapeos en base de datos...";
        
        // 1. Obtener configuraciones de comercios
        const { data: configs, error: configsErr } = await supabase
          .from('comercios_adicional_config')
          .select('comercio, enviame_id, rut, razon_social');
        if (configsErr) throw configsErr;
        
        // 2. Obtener mapeos de facturación agrupados
        const { data: mappings, error: mappingsErr } = await supabase
          .from('billing_mappings')
          .select('comercio_nombre, billing_name');

        // Obtener siglas de v_comercios_config para pre-completar derivaciones manuales
        const { data: vComercios, error: vComerciosErr } = await supabase
          .from('v_comercios_config')
          .select('nombre, sigla');
        
        const commerceToSiglaMap = {};
        if (!vComerciosErr && vComercios) {
          vComercios.forEach(vc => {
            if (vc.nombre) {
              commerceToSiglaMap[vc.nombre.trim()] = (vc.sigla || '').trim().toUpperCase();
            }
          });
        }
        
        const enviameIdToCommerceMap = {};
        window.commerceToCorporateInfo = {};
        window.commerceToBillingGroup = {};
        window.allComerciosList = [];
        
        // Cargar mapas y listado general
        (configs || []).forEach(c => {
          window.allComerciosList.push(c.comercio);
          if (c.enviame_id) {
            const ids = c.enviame_id.split(',').map(id => id.trim().replace(/^ID\s*:?\s*/i, ''));
            ids.forEach(id => {
              if (id) {
                enviameIdToCommerceMap[id] = c.comercio;
              }
            });
          }
          window.commerceToCorporateInfo[c.comercio] = {
            rut: c.rut || 'Falta configurar',
            razon_social: c.razon_social || c.comercio
          };
          window.commerceToBillingGroup[c.comercio] = c.comercio; // por defecto se mapea a sí mismo
        });
        
        window.allComerciosList.sort();
        
        (mappings || []).forEach(m => {
          window.commerceToBillingGroup[m.comercio_nombre] = m.billing_name;
          if (!window.commerceToCorporateInfo[m.billing_name] && window.commerceToCorporateInfo[m.comercio_nombre]) {
            window.commerceToCorporateInfo[m.billing_name] = window.commerceToCorporateInfo[m.comercio_nombre];
          }
        });
        
        // 3. Procesar filas de la planilla de forma cruda en memoria
        window.rawParsedShipments = [];
        window.unrecognizedIds = {};
        
        // Mapeo de columnas posibles
        const cols = {
          company_id: ['company_id', 'companyid', 'id_compania', 'company_identifier'],
          id: ['id', 'enviame_id', 'shipment_id', 'id_envio'],
          imported_id: ['imported_id', 'importedid', 'id_pedido', 'order_id', 'referencia'],
          tracking: ['tracking_number', 'tracking', 'numero_tracking', 'carrier_tracking_number'],
          carrier: ['carrier', 'courier', 'transportista'],
          status: ['status', 'estado', 'status_name'],
          comune: ['com_destino', 'comuna_destino', 'comuna', 'county', 'commune'],
          peso: ['peso informado por carrier', 'peso_informado_por_carrier', 'peso', 'weight', 'peso_carrier'],
          neto: ['total', 'precio', 'valor_neto', 'neto', 'price', 'net_price']
        };

        // Helper para deducir el comercio por el prefijo del pedido (sigla o nombre)
        const findCommerceByOrderId = (orderId, siglaMap, allComercios) => {
          if (!orderId) return null;
          const orderPrefix = orderId.toString().match(/^[A-Za-z]+/)?.[0]?.toUpperCase() || '';
          if (!orderPrefix) return null;

          // 1. Coincidencia exacta de Sigla:
          for (const commerce of allComercios) {
            const sigla = siglaMap[commerce];
            if (sigla && (orderPrefix === sigla || orderPrefix.startsWith(sigla) || sigla.startsWith(orderPrefix))) {
              return commerce;
            }
          }

          // 2. Coincidencia por inicio del Nombre del comercio (mínimo 3 caracteres):
          for (const commerce of allComercios) {
            const cleanComm = commerce.toUpperCase().replace(/\s+/g, '');
            if (cleanComm.startsWith(orderPrefix) || orderPrefix.startsWith(cleanComm.substring(0, 3))) {
              return commerce;
            }
          }

          // 3. Coincidencia de 2 letras (Fuzzy / Fallback):
          if (orderPrefix.length >= 2) {
            const twoLetters = orderPrefix.substring(0, 2);
            const candidates = allComercios.filter(commerce => {
              const sigla = siglaMap[commerce] || '';
              return sigla.startsWith(twoLetters) || commerce.toUpperCase().startsWith(twoLetters);
            });
            if (candidates.length === 1) {
              return candidates[0];
            }
          }

          return null;
        };
        
        rows.forEach(row => {
          const rawCompId = getRowValue(row, cols.company_id);
          const compId = rawCompId ? rawCompId.toString().trim() : null;
          
          if (!compId) return; // Si no tiene company_id, ignorar
          
          const resolvedCommerce = enviameIdToCommerceMap[compId];
          
          const shipmentId = getRowValue(row, cols.id) || '';
          const orderId = getRowValue(row, cols.imported_id) || '';
          const tracking = getRowValue(row, cols.tracking) || '';
          const carrier = getRowValue(row, cols.carrier) || '';
          const status = getRowValue(row, cols.status) || 'N/A';
          const commune = getRowValue(row, cols.comune) || '';
          const rawPeso = getRowValue(row, cols.peso);
          const peso = rawPeso ? parseFloat(rawPeso) : 0.0;
          const rawNeto = getRowValue(row, cols.neto);
          const neto = rawNeto ? Math.round(Number(rawNeto)) : 0;
          
          const isManualDerivation = (compId === '8326');
          
          let assignedCommerce = isManualDerivation ? null : resolvedCommerce;
          if (isManualDerivation && orderId) {
            assignedCommerce = findCommerceByOrderId(orderId, commerceToSiglaMap, window.allComerciosList) || null;
          }
          
          const shipmentData = {
            company_id: compId,
            shipmentId,
            orderId,
            tracking,
            carrier,
            status,
            commune,
            peso,
            neto,
            isManualDerivation,
            assignedCommerce
          };
          
          if (resolvedCommerce || isManualDerivation) {
            window.rawParsedShipments.push(shipmentData);
          } else {
            if (!window.unrecognizedIds[compId]) {
              window.unrecognizedIds[compId] = 0;
            }
            window.unrecognizedIds[compId]++;
          }
        });
        
        // 4. Agregar y renderizar los datos
        window.aggregateAndRender(periodId);
        
        loadingSection.style.display = 'none';
        resultsSection.style.display = 'flex';
        formSection.style.display = 'grid';
        
      } catch (err) {
        console.error("Error al procesar planilla en FileReader:", err);
        Swal.fire({
          icon: 'error',
          title: 'Error de Lectura',
          text: err.message,
          confirmButtonColor: '#9c27b0'
        });
        loadingSection.style.display = 'none';
        uploadSection.style.display = 'block';
        formSection.style.display = 'grid';
      }
    };
    reader.readAsArrayBuffer(file);
  } catch (err) {
    console.error("Error al cargar planilla:", err);
    Swal.fire({
      icon: 'error',
      title: 'Error al Cargar',
      text: err.message,
      confirmButtonColor: '#9c27b0'
    });
    loadingSection.style.display = 'none';
    uploadSection.style.display = 'block';
    formSection.style.display = 'grid';
  }
}

// --- FUNCIÓN CENTRAL DE AGREGACIÓN Y RENDERIZADO DINAÁMICO ---
window.aggregateAndRender = function(periodId) {
  const commerceShipments = {};
  let totalCount = 0;
  
  // Agrupar los envíos en base al assignedCommerce actual
  window.rawParsedShipments.forEach(s => {
    const commerce = s.assignedCommerce;
    if (!commerce) return; // Omitir huérfanos sin comercio asignado
    
    if (!commerceShipments[commerce]) {
      commerceShipments[commerce] = [];
    }
    commerceShipments[commerce].push(s);
    totalCount++;
  });
  
  // Agrupar indemnizaciones por comercio
  const commerceIndemnificationsMap = {};
  (window.importerIndemnifications || []).forEach(ind => {
    if (!ind.comercio) return;
    if (!commerceIndemnificationsMap[ind.comercio]) {
      commerceIndemnificationsMap[ind.comercio] = [];
    }
    commerceIndemnificationsMap[ind.comercio].push(ind);
  });
  
  // 1. Mostrar advertencias si hay IDs no reconocidos
  const warningContainer = document.getElementById('importer-warnings-container');
  const unrecognizedList = Object.keys(window.unrecognizedIds || {});
  if (unrecognizedList.length > 0) {
    warningContainer.style.display = 'block';
    const listHtml = unrecognizedList.map(id => `<strong>${id}</strong> (${window.unrecognizedIds[id]} envíos)`).join(', ');
    warningContainer.innerHTML = `
      <div class="importer-alert-warning">
        <i class="ri-alert-line" style="font-size: 1.15rem; margin-top: 0.1rem;"></i>
        <div>
          <span style="font-weight:700;">Atención:</span> Se detectaron envíos de Envíame IDs que no están configurados en Stocka: ${listHtml}. 
          Estos envíos serán omitidos. Regístralos en la configuración de comercios si deseas facturarlos.
        </div>
      </div>
    `;
  } else {
    warningContainer.style.display = 'none';
  }
  
  // 2. Renderizar tabla de resultados agrupados
  const tbody = document.getElementById('importer-results-tbody');
  tbody.innerHTML = '';
  
  window.importerParsedData = []; // Limpiar y repoblar
  
  // Combinar comercios que tienen envíos o que tienen indemnizaciones registradas
  const allDetectedKeys = new Set([
    ...Object.keys(commerceShipments),
    ...Object.keys(commerceIndemnificationsMap)
  ]);
  const detectedCommerces = Array.from(allDetectedKeys).sort();
  
  if (detectedCommerces.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">No se detectó ningún comercio con ID Envíame o descuento registrado.</td></tr>`;
    document.getElementById('btn-importer-process').disabled = true;
  } else {
    document.getElementById('btn-importer-process').disabled = false;
    
    detectedCommerces.forEach((comm, idx) => {
      const shipments = commerceShipments[comm] || [];
      const indList = commerceIndemnificationsMap[comm] || [];
      
      const netSum = shipments.reduce((sum, s) => sum + s.neto, 0);
      const iva = Math.round(netSum * 0.19);
      const total = netSum + iva;
      const indemnizacionesSum = indList.reduce((sum, ind) => sum + (ind.monto || 0), 0);
      const totalAPagar = total - indemnizacionesSum;
      
      const corp = window.commerceToCorporateInfo[comm] || { rut: 'Falta configurar', razon_social: comm };
      const billingGroup = window.commerceToBillingGroup[comm] || comm;
      
      window.importerParsedData.push({
        commerce: comm,
        billingGroup,
        rut: corp.rut,
        razon_social: corp.razon_social,
        shipments,
        indemnifications: indList,
        totals: {
          quantity: shipments.length,
          net: netSum,
          iva,
          total,
          indemnizaciones: indemnizacionesSum,
          totalAPagar
        }
      });
      
      tbody.innerHTML += `
        <tr>
          <td style="text-align: center; vertical-align: middle;">
            <input type="checkbox" class="importer-row-select" data-idx="${idx}" checked style="width: 15px; height: 15px; cursor: pointer; accent-color: #9c27b0;">
          </td>
          <td style="font-weight: 600; color: var(--color-text-main); vertical-align: middle;">${comm}</td>
          <td style="vertical-align: middle; color: var(--color-text-muted); font-size: 0.75rem;">${billingGroup}</td>
          <td style="vertical-align: middle; font-family: monospace; font-size: 0.75rem;">${corp.rut}</td>
          <td style="text-align: right; font-weight: 600; vertical-align: middle;">${shipments.length}</td>
          <td style="text-align: right; vertical-align: middle;">${formatCLP(netSum)}</td>
          <td style="text-align: right; color: var(--color-text-muted); vertical-align: middle;">${formatCLP(iva)}</td>
          <td style="text-align: right; font-weight: 600; vertical-align: middle;">${formatCLP(total)}</td>
          <td style="text-align: right; color: #ef4444; vertical-align: middle; font-weight: 600;">-${formatCLP(indemnizacionesSum)}</td>
          <td style="text-align: right; font-weight: 700; color: #5B00E4; vertical-align: middle;">${formatCLP(totalAPagar)}</td>
          <td style="text-align: center; vertical-align: middle;">
            <div style="display: inline-flex; gap: 0.35rem;">
              <button type="button" class="btn btn-outline btn-sm" onclick="window.previewEnviameBreakdownPDF(${idx})" style="padding: 0.2rem 0.4rem; font-size: 0.725rem; height: auto;" title="Ver Vista Previa"><i class="ri-eye-line"></i> Previsualizar</button>
            </div>
          </td>
        </tr>
      `;
    });
  }
  
  // 3. Renderizar sección de derivación manual (ID 8326)
  const manualShipments = window.rawParsedShipments.filter(s => s.isManualDerivation === true);
  const manualCard = document.getElementById('importer-manual-derivation-card');
  const manualTbody = document.getElementById('importer-manual-derivation-tbody');
  
  if (manualShipments.length > 0 && manualCard && manualTbody) {
    manualCard.style.display = 'block';
    document.getElementById('importer-manual-derivation-badge').textContent = `${manualShipments.length} envíos para derivar`;
    
    manualTbody.innerHTML = '';
    
    // Obtener el índice real de cada envío en el array global
    window.rawParsedShipments.forEach((s, globalIdx) => {
      if (s.isManualDerivation !== true) return;
      
      manualTbody.innerHTML += `
        <tr>
          <td style="font-weight: 600; color: var(--color-text-main); font-family: monospace;">${s.orderId || s.shipmentId || 'N/A'}</td>
          <td style="font-family: monospace; font-size: 0.75rem;">${s.tracking || 'N/A'}</td>
          <td style="color: var(--color-text-muted); font-size: 0.725rem;">${s.commune || 'N/A'}</td>
          <td><span style="background: rgba(16, 185, 129, 0.1); color: #10b981; padding: 0.1rem 0.35rem; border-radius: 4px; font-weight: 600; font-size: 0.65rem; text-transform: uppercase;">${s.carrier}</span></td>
          <td style="text-align: right; font-weight: 500;">${formatCLP(s.neto)}</td>
          <td>
            <input list="importer-comercios-datalist" class="form-input" onfocus="this.select()" onchange="window.reassignShipmentCommerce(${globalIdx}, this.value, '${periodId}')" style="padding: 0.15rem 0.35rem; font-size: 0.75rem; margin: 0; width: 100%; box-sizing: border-box; font-family: Outfit, sans-serif;" placeholder="Buscar comercio..." value="${s.assignedCommerce || ''}">
          </td>
        </tr>
      `;
    });
  } else if (manualCard) {
    manualCard.style.display = 'none';
  }
  
  // Agrupar y renderizar conglomerados
  const groupCard = document.getElementById('importer-groups-card');
  const groupTbody = document.getElementById('importer-groups-tbody');
  
  if (groupCard && groupTbody) {
    const groupsMap = {};
    window.importerParsedData.forEach((c, idx) => {
      if (!groupsMap[c.billingGroup]) {
        groupsMap[c.billingGroup] = {
          billingGroup: c.billingGroup,
          commerces: []
        };
      }
      groupsMap[c.billingGroup].commerces.push({ ...c, originalIndex: idx });
    });
    
    // Filtramos grupos que tienen más de 1 comercio, o que su razón social sea distinta a su marca única
    const conglomerateGroups = Object.values(groupsMap).filter(g => 
      g.commerces.length > 1 || g.commerces[0].commerce !== g.billingGroup
    );
    
    if (conglomerateGroups.length > 0) {
      groupCard.style.display = 'block';
      document.getElementById('importer-groups-badge').textContent = `${conglomerateGroups.length} conglomerados`;
      groupTbody.innerHTML = '';
      
      conglomerateGroups.forEach(g => {
        const subNames = g.commerces.map(c => c.commerce).join(', ');
        const totalQty = g.commerces.reduce((sum, c) => sum + c.totals.quantity, 0);
        const totalNet = g.commerces.reduce((sum, c) => sum + c.totals.net, 0);
        const totalInd = g.commerces.reduce((sum, c) => sum + c.totals.indemnizaciones, 0);
        const totalPay = g.commerces.reduce((sum, c) => sum + c.totals.totalAPagar, 0);
        
        groupTbody.innerHTML += `
          <tr>
            <td style="font-weight: 600; color: #5B00E4; vertical-align: middle;">${g.billingGroup}</td>
            <td style="vertical-align: middle; color: var(--color-text-muted); font-size: 0.725rem; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${subNames}">${subNames}</td>
            <td style="text-align: right; font-weight: 600; vertical-align: middle;">${totalQty}</td>
            <td style="text-align: right; vertical-align: middle;">${formatCLP(totalNet)}</td>
            <td style="text-align: right; color: #ef4444; vertical-align: middle; font-weight: 600;">-${formatCLP(totalInd)}</td>
            <td style="text-align: right; font-weight: 700; color: #5B00E4; vertical-align: middle;">${formatCLP(totalPay)}</td>
            <td style="text-align: center; vertical-align: middle;">
              <button type="button" class="btn btn-outline btn-sm" onclick="window.previewEnviameGroupBreakdownPDF('${g.billingGroup}', '${periodId}')" style="padding: 0.2rem 0.4rem; font-size: 0.725rem; height: auto;"><i class="ri-eye-line"></i> Previsualizar Consolidado</button>
            </td>
          </tr>
        `;
      });
    } else {
      groupCard.style.display = 'none';
    }
  }

  // Re-registrar el checkbox maestro
  const selectAllCheckbox = document.getElementById('importer-select-all');
  if (selectAllCheckbox) {
    selectAllCheckbox.checked = true;
    selectAllCheckbox.onchange = (el) => {
      const checkboxes = tbody.querySelectorAll('.importer-row-select');
      checkboxes.forEach(cb => cb.checked = el.target.checked);
    };
  }
  
  document.getElementById('importer-total-summary-badge').textContent = `${totalCount} despachos y ${detectedCommerces.length} comercios detectados`;
  
  // Sincronizar el datalist de comercios
  const datalist = document.getElementById('importer-comercios-datalist');
  if (datalist && window.allComerciosList) {
    datalist.innerHTML = window.allComerciosList.map(c => `<option value="${c}">`).join('');
  }
  
  // Renderizar y sincronizar tabla de indemnizaciones manuales
  window.renderIndemnificationsTable(periodId);
};

// Reasignar comercio de un envío derivado de Envíame
window.reassignShipmentCommerce = function(globalIndex, newCommerce, periodId) {
  if (window.rawParsedShipments[globalIndex]) {
    const trimmed = (newCommerce || '').trim();
    if (trimmed === "") {
      window.rawParsedShipments[globalIndex].assignedCommerce = null;
      window.aggregateAndRender(periodId);
      return;
    }
    if (!window.allComerciosList.includes(trimmed)) {
      Swal.fire({
        icon: 'error',
        title: 'Comercio No Válido',
        text: `El comercio "${trimmed}" no existe en el sistema.`,
        confirmButtonColor: '#9c27b0'
      });
      window.aggregateAndRender(periodId);
      return;
    }
    window.rawParsedShipments[globalIndex].assignedCommerce = trimmed;
    window.aggregateAndRender(periodId);
  }
};

// --- LOGICA DE INDEMNIZACIONES Y DESCUENTOS ---
window.addImporterIndemnificationRow = function(periodId) {
  if (!window.importerIndemnifications) window.importerIndemnifications = [];
  window.importerIndemnifications.push({
    comercio: '',
    pedido: '',
    operador: '',
    razon: '',
    monto: 0
  });
  window.renderIndemnificationsTable(periodId);
};

window.updateIndemnificationField = function(idx, field, value, periodId) {
  if (window.importerIndemnifications[idx]) {
    if (field === 'comercio') {
      const trimmed = (value || '').trim();
      if (trimmed === "") {
        window.importerIndemnifications[idx].comercio = '';
        window.aggregateAndRender(periodId);
        return;
      }
      if (!window.allComerciosList.includes(trimmed)) {
        Swal.fire({
          icon: 'error',
          title: 'Comercio No Válido',
          text: `El comercio "${trimmed}" no existe en el sistema.`,
          confirmButtonColor: '#9c27b0'
        });
        window.aggregateAndRender(periodId);
        return;
      }
      window.importerIndemnifications[idx].comercio = trimmed;
      window.aggregateAndRender(periodId);
      return;
    }
    window.importerIndemnifications[idx][field] = value;
    if (field === 'monto') {
      window.aggregateAndRender(periodId);
    }
  }
};

window.removeImporterIndemnification = function(idx, periodId) {
  if (window.importerIndemnifications) {
    window.importerIndemnifications.splice(idx, 1);
    window.aggregateAndRender(periodId);
  }
};

window.renderIndemnificationsTable = function(periodId) {
  const tbody = document.getElementById('importer-indemnifications-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  if (!window.importerIndemnifications || window.importerIndemnifications.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--color-text-muted); padding: 1rem;">No se han agregado indemnizaciones para este periodo.</td></tr>`;
    return;
  }
  
  window.importerIndemnifications.forEach((ind, idx) => {
    tbody.innerHTML += `
      <tr>
        <td>
          <input list="importer-comercios-datalist" class="form-input" onfocus="this.select()" onchange="window.updateIndemnificationField(${idx}, 'comercio', this.value, '${periodId}')" style="padding: 0.15rem 0.35rem; font-size: 0.75rem; margin: 0; width: 100%; box-sizing: border-box; font-family: Outfit, sans-serif;" placeholder="Buscar comercio..." value="${ind.comercio || ''}">
        </td>
        <td>
          <input type="text" class="form-input" style="padding: 0.15rem 0.35rem; font-size: 0.75rem; margin: 0; width: 100%; box-sizing: border-box; font-family: Outfit, sans-serif;" value="${ind.pedido || ''}" onchange="window.updateIndemnificationField(${idx}, 'pedido', this.value, '${periodId}')" placeholder="Ej: BIT1023">
        </td>
        <td>
          <input type="text" class="form-input" style="padding: 0.15rem 0.35rem; font-size: 0.75rem; margin: 0; width: 100%; box-sizing: border-box; font-family: Outfit, sans-serif;" value="${ind.operador || ''}" onchange="window.updateIndemnificationField(${idx}, 'operador', this.value, '${periodId}')" placeholder="Ej: Chilexpress">
        </td>
        <td>
          <input type="text" class="form-input" style="padding: 0.15rem 0.35rem; font-size: 0.75rem; margin: 0; width: 100%; box-sizing: border-box; font-family: Outfit, sans-serif;" value="${ind.razon || ''}" onchange="window.updateIndemnificationField(${idx}, 'razon', this.value, '${periodId}')" placeholder="Ej: Pérdida">
        </td>
        <td>
          <input type="number" class="form-input" style="padding: 0.15rem 0.35rem; font-size: 0.75rem; margin: 0; width: 100%; text-align: right; box-sizing: border-box; font-family: Outfit, sans-serif;" value="${ind.monto || ''}" onchange="window.updateIndemnificationField(${idx}, 'monto', Number(this.value), '${periodId}')" placeholder="0">
        </td>
        <td style="text-align: center;">
          <button type="button" class="btn btn-outline btn-sm" onclick="window.removeImporterIndemnification(${idx}, '${periodId}')" style="padding: 0.15rem 0.35rem; font-size: 0.75rem; height: auto; border-color: #ef4444; color: #ef4444;"><i class="ri-delete-bin-line"></i></button>
        </td>
      </tr>
    `;
  });
};

// --- RENDERIZADOR HTML TEMPLATE (PDF) ---
window.renderEnviameBreakdownHtml = function(commerceName, shipments, totals, emissionDate, deadlineDate, periodName) {
  const formatFecha = (dStr) => {
    if (!dStr) return '';
    const parts = dStr.split('-');
    if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
    return dStr;
  };
  
  const emissionFormatted = formatFecha(emissionDate);
  const deadlineFormatted = formatFecha(deadlineDate);
  
  const stats = window.calculateEnviameStatistics(shipments, totals.net);
  
  // Resolve period keys for MoM/YoY comparisons
  const monthMapping = {
    'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04', 'mayo': '05', 'junio': '06',
    'julio': '07', 'agosto': '08', 'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
  };
  const parts = (periodName || '').split(' ');
  const spanishMonthName = parts[0] ? parts[0].toLowerCase() : '';
  const yearStr = parts[1] || '';
  const monthNum = monthMapping[spanishMonthName];
  const currentPeriodKey = monthNum && yearStr ? `${yearStr}-${monthNum}` : null;
  
  const getPrecedingPeriodKey = (key) => {
    if (!key) return null;
    const [y, m] = key.split('-').map(Number);
    let newM = m - 1; let newY = y;
    if (newM === 0) { newM = 12; newY = y - 1; }
    return `${newY}-${newM.toString().padStart(2, '0')}`;
  };
  
  const getPreviousYearPeriodKey = (key) => {
    if (!key) return null;
    const [y, m] = key.split('-');
    return `${Number(y) - 1}-${m}`;
  };
  
  const historyKey = totals.billingGroup || commerceName;
  const history = window.commerceHistoricalEnviameData ? window.commerceHistoricalEnviameData[historyKey] : null;
  const findInHistory = (key) => {
    if (!history || !key) return null;
    return history.find(h => h.periodKey === key) || null;
  };
  
  const precedingKey = getPrecedingPeriodKey(currentPeriodKey);
  const prevYearKey = getPreviousYearPeriodKey(currentPeriodKey);
  const precedingStats = findInHistory(precedingKey);
  const prevYearStats = findInHistory(prevYearKey);
  
  function formatComparisonRow(metricName, currentVal, prevValVal, prevYearVal, isCurrency = false, isWeight = false) {
    const formatVal = (v) => {
      if (v === null || v === undefined) return 'N/A';
      if (isCurrency) return formatCLP(Math.round(v));
      if (isWeight) return formatWeight(v) + ' Kg';
      return v.toLocaleString('es-CL');
    };
    
    const getChangePct = (curr, prev) => {
      if (curr === null || curr === undefined || prev === null || prev === undefined || prev === 0) return 'N/A';
      const diff = curr - prev;
      const pct = ((diff / prev) * 100).toFixed(1);
      const pctNum = parseFloat(pct);
      
      let isPositiveBetter = true;
      if (metricName.toLowerCase().includes('costo') || metricName.toLowerCase().includes('tarifa') || metricName.toLowerCase().includes('peso')) {
        isPositiveBetter = false; // decrease is good
      }
      
      if (pctNum === 0) return '<span style="color: #6b7280; font-weight:600;">0%</span>';
      if (pctNum > 0) {
        const color = isPositiveBetter ? '#10b981' : '#ef4444';
        return `<span style="color: ${color}; font-weight:600;"><i class="ri-arrow-up-line"></i>+${pct}%</span>`;
      } else {
        const color = isPositiveBetter ? '#ef4444' : '#10b981';
        return `<span style="color: ${color}; font-weight:600;"><i class="ri-arrow-down-line"></i>${pct}%</span>`;
      }
    };

    let prevVal = null;
    if (prevValVal) {
      if (metricName.includes('Costo')) prevVal = prevValVal.totalNet;
      else if (metricName.includes('Tarifa')) prevVal = prevValVal.avgRate;
      else if (metricName.includes('Peso')) prevVal = prevValVal.avgWeight;
      else prevVal = prevValVal.totalShipments;
    }

    let prevYear = null;
    if (prevYearVal) {
      if (metricName.includes('Costo')) prevYear = prevYearVal.totalNet;
      else if (metricName.includes('Tarifa')) prevYear = prevYearVal.avgRate;
      else if (metricName.includes('Peso')) prevYear = prevYearVal.avgWeight;
      else prevYear = prevYearVal.totalShipments;
    }

    return `
      <tr style="border-bottom: 1px solid #e5e7eb; font-size: 0.725rem;">
        <td style="padding: 0.45rem 0.5rem; font-weight: 700; color: #111827;">${metricName}</td>
        <td style="padding: 0.45rem 0.5rem; text-align: right; font-weight: 700; color: #5B00E4;">${formatVal(currentVal)}</td>
        <td style="padding: 0.45rem 0.5rem; text-align: right; color: #4b5563;">${formatVal(prevVal)}</td>
        <td style="padding: 0.45rem 0.5rem; text-align: right;">${getChangePct(currentVal, prevVal)}</td>
        <td style="padding: 0.45rem 0.5rem; text-align: right; color: #4b5563;">${formatVal(prevYear)}</td>
        <td style="padding: 0.45rem 0.5rem; text-align: right;">${getChangePct(currentVal, prevYear)}</td>
      </tr>
    `;
  }
  
  const comparisonPage = history && history.length > 0 ? `
    <!-- PÁGINA 3: ANÁLISIS COMPARATIVO HISTÓRICO -->
    <div style="width: 210mm; padding: 15mm; box-sizing: border-box; display: flex; flex-direction: column; justify-content: flex-start; min-height: 297mm; page-break-before: always; position: relative;">
      
      <!-- Cabecera de Página -->
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #5B00E4; padding-bottom: 0.5rem; margin-bottom: 1.25rem;">
        <div style="font-weight: 800; color: #111827; font-size: 1.1rem; letter-spacing: -0.01em;">Análisis Comparativo e Histórico</div>
        <div style="font-size: 0.75rem; color: #5B00E4; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Fulfillment Stocka</div>
      </div>
      
      <!-- Tabla de Comparación Temporal -->
      <div style="margin-bottom: 1.5rem;">
        <div style="background: #5B00E4; color: white; padding: 0.4rem 0.75rem; font-weight: 700; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; border-radius: 4px; margin-bottom: 0.5rem;">
          Comparación de Rendimiento Temporal
        </div>
        <table style="width: 100%; border-collapse: collapse; background: white; border: 1px solid #e5e7eb; border-radius: 4px; overflow: hidden;">
          <thead>
            <tr style="background: #f3f4f6; color: #111827; font-weight: bold; font-size: 0.65rem; text-transform: uppercase; text-align: left;">
              <th style="padding: 0.4rem 0.5rem;">Indicador / Métrica</th>
              <th style="padding: 0.4rem 0.5rem; text-align: right;">Este Mes (${periodName})</th>
              <th style="padding: 0.4rem 0.5rem; text-align: right;">Mes Anterior</th>
              <th style="padding: 0.4rem 0.5rem; text-align: right;">Var %</th>
              <th style="padding: 0.4rem 0.5rem; text-align: right;">Año Anterior</th>
              <th style="padding: 0.4rem 0.5rem; text-align: right;">Var %</th>
            </tr>
          </thead>
          <tbody>
            ${formatComparisonRow('Cantidad de Envíos', shipments.length, precedingStats, prevYearStats, false, false)}
            ${formatComparisonRow('Costo Neto Total ($)', totals.net, precedingStats, prevYearStats, true, false)}
            ${formatComparisonRow('Peso Promedio Paquete', stats.avgWeight, precedingStats, prevYearStats, false, true)}
            ${formatComparisonRow('Tarifa Promedio Neto ($)', stats.avgRate, precedingStats, prevYearStats, true, false)}
          </tbody>
        </table>
      </div>
      
      <!-- Gráficos de Evolución Histórica (Últimos 12 Meses) -->
      <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1rem; flex-grow: 1;">
        <div>
          <div style="background: #111827; color: white; padding: 0.35rem 0.75rem; font-weight: 700; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; border-radius: 4px; margin-bottom: 0.35rem;">
            Evolución Facturación y Envíos (Últimos 12 Meses)
          </div>
          <div style="width: 100%; height: 140px; display: flex; justify-content: center; align-items: center; background: #fafafa; border: 1px solid #e5e7eb; border-radius: 6px; padding: 0.25rem; box-sizing: border-box;">
            <canvas id="pdf-chart-trends-${historyKey.replace(/\s+/g, '-')}" style="width: 600px; height: 130px;"></canvas>
          </div>
        </div>
        <div>
          <div style="background: #111827; color: white; padding: 0.35rem 0.75rem; font-weight: 700; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; border-radius: 4px; margin-bottom: 0.35rem;">
            Evolución Peso y Tarifa Promedio (Últimos 12 Meses)
          </div>
          <div style="width: 100%; height: 140px; display: flex; justify-content: center; align-items: center; background: #fafafa; border: 1px solid #e5e7eb; border-radius: 6px; padding: 0.25rem; box-sizing: border-box;">
            <canvas id="pdf-chart-averages-${historyKey.replace(/\s+/g, '-')}" style="width: 600px; height: 130px;"></canvas>
          </div>
        </div>
      </div>
      
      <!-- Nota de Pie de Página -->
      <div style="font-size: 0.65rem; color: #9ca3af; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 0.5rem; margin-top: auto;">
        * La información histórica mostrada se basa en las planillas consolidadas mensuales procesadas en el WMS Stocka.
      </div>
      
    </div>
  ` : '';
  
  // Courier list rows
  let courierRows = '';
  stats.couriers.forEach((c, idx) => {
    const isPreferred = idx === 0;
    const badge = isPreferred ? '<span style="background: rgba(91, 0, 228, 0.1); color: #5B00E4; padding: 0.1rem 0.35rem; border-radius: 4px; font-weight: 700; font-size: 0.6rem; margin-left: 0.3rem;"><i class="ri-star-fill"></i> Preferido</span>' : '';
    courierRows += `
      <tr style="border-bottom: 1px solid #e5e7eb; font-size: 0.725rem;">
        <td style="padding: 0.45rem 0.5rem; font-weight: 600; color: #111827;">${c.name}${badge}</td>
        <td style="padding: 0.45rem 0.5rem; text-align: right;">${c.count} (${c.percentage}%)</td>
        <td style="padding: 0.45rem 0.5rem; text-align: right;">${formatWeight(c.avgWeight)} Kg</td>
        <td style="padding: 0.45rem 0.5rem; text-align: right; font-weight: 600; color: #111827;">${formatCLP(Math.round(c.avgRate))}</td>
      </tr>
    `;
  });
  
  // Destination list rows
  let destRows = '';
  stats.destinations.forEach((d) => {
    destRows += `
      <tr style="border-bottom: 1px solid #e5e7eb; font-size: 0.725rem;">
        <td style="padding: 0.45rem 0.5rem; font-weight: 600; color: #4b5563; text-transform: uppercase;">${d.name}</td>
        <td style="padding: 0.45rem 0.5rem; text-align: right;">${d.count}</td>
        <td style="padding: 0.45rem 0.5rem; text-align: right; font-weight: 600; color: #5B00E4;">${d.percentage}%</td>
      </tr>
    `;
  });

  const statsPage = `
    <!-- PÁGINA 2: ESTADÍSTICAS Y ANÁLISIS DE ENVÍOS -->
    <div style="width: 210mm; padding: 15mm; box-sizing: border-box; display: flex; flex-direction: column; justify-content: flex-start; min-height: 297mm; page-break-before: always; page-break-after: always; position: relative;">
      <!-- Cabecera de Página -->
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #5B00E4; padding-bottom: 0.5rem; margin-bottom: 1.25rem;">
        <div style="font-weight: 800; color: #111827; font-size: 1.1rem; letter-spacing: -0.01em;">Estadísticas e Indicadores del Periodo</div>
        <div style="font-size: 0.75rem; color: #5B00E4; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Fulfillment Stocka</div>
      </div>
      
      <!-- Grid de Indicadores Clave -->
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 1.5rem;">
        <div style="border: 1px solid #e5e7eb; border-radius: 8px; background: #fafafa; padding: 0.75rem; text-align: center; box-shadow: 0 1px 2px rgba(0,0,0,0.01);">
          <div style="font-size: 0.65rem; font-weight: 700; color: #4b5563; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">Peso Promedio General</div>
          <div style="font-size: 1.35rem; font-weight: 800; color: #5B00E4;">${formatWeight(stats.avgWeight)} Kg</div>
          <div style="font-size: 0.6rem; color: #4b5563; margin-top: 0.15rem;">Por paquete facturado</div>
        </div>
        
        <div style="border: 1px solid #e5e7eb; border-radius: 8px; background: #fafafa; padding: 0.75rem; text-align: center; box-shadow: 0 1px 2px rgba(0,0,0,0.01);">
          <div style="font-size: 0.65rem; font-weight: 700; color: #4b5563; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">Tarifa Promedio General</div>
          <div style="font-size: 1.35rem; font-weight: 800; color: #00D2C8;">${formatCLP(Math.round(stats.avgRate))}</div>
          <div style="font-size: 0.6rem; color: #4b5563; margin-top: 0.15rem;">Costo neto prom. por envío</div>
        </div>
        
        <div style="border: 1px solid #e5e7eb; border-radius: 8px; background: #fafafa; padding: 0.75rem; text-align: center; box-shadow: 0 1px 2px rgba(0,0,0,0.01);">
          <div style="font-size: 0.65rem; font-weight: 700; color: #4b5563; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">Courier Preferido</div>
          <div style="font-size: 1.25rem; font-weight: 800; color: #111827; text-transform: uppercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${stats.preferredCourier}</div>
          <div style="font-size: 0.6rem; color: #4b5563; margin-top: 0.15rem;">Mayor volumen de envíos</div>
        </div>
      </div>
      
      <!-- Distribución por Courier -->
      <div style="margin-bottom: 1.5rem;">
        <div style="background: #5B00E4; color: white; padding: 0.4rem 0.75rem; font-weight: 700; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; border-radius: 4px; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.35rem;">
          <i class="ri-truck-line"></i> Distribución y Costos por Operador / Courier
        </div>
        <table style="width: 100%; border-collapse: collapse; background: white; border: 1px solid #e5e7eb; border-radius: 4px; overflow: hidden;">
          <thead>
            <tr style="background: #f3f4f6; color: #111827; font-weight: bold; font-size: 0.65rem; text-transform: uppercase; text-align: left;">
              <th style="padding: 0.4rem 0.5rem;">Courier</th>
              <th style="padding: 0.4rem 0.5rem; text-align: right;">Envíos (Cant / %)</th>
              <th style="padding: 0.4rem 0.5rem; text-align: right;">Peso Promedio</th>
              <th style="padding: 0.4rem 0.5rem; text-align: right;">Tarifa Prom. Neto</th>
            </tr>
          </thead>
          <tbody>
            ${courierRows}
          </tbody>
        </table>
      </div>
      
      <!-- Top Destinos -->
      <div>
        <div style="background: #111827; color: white; padding: 0.4rem 0.75rem; font-weight: 700; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; border-radius: 4px; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.35rem;">
          <i class="ri-map-pin-line"></i> Top 5 Comunas con Mayor Frecuencia de Envíos
        </div>
        <table style="width: 100%; border-collapse: collapse; background: white; border: 1px solid #e5e7eb; border-radius: 4px; overflow: hidden;">
          <thead>
            <tr style="background: #f3f4f6; color: #111827; font-weight: bold; font-size: 0.65rem; text-transform: uppercase; text-align: left;">
              <th style="padding: 0.4rem 0.5rem;">Comuna de Destino</th>
              <th style="padding: 0.4rem 0.5rem; text-align: right;">Cantidad de Envíos</th>
              <th style="padding: 0.4rem 0.5rem; text-align: right;">Porcentaje del Total</th>
            </tr>
          </thead>
          <tbody>
            ${destRows}
          </tbody>
        </table>
      </div>
    </div>
  `;
  
  // Detalle de Indemnizaciones
  let indemnificationsRows = '';
  const commerceInds = totals.indemnifications || [];
  if (commerceInds.length > 0) {
    commerceInds.forEach((ind, idx) => {
      indemnificationsRows += `
        <tr style="background: ${idx % 2 === 0 ? 'white' : '#f9fafb'}; font-size: 0.725rem;">
          <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid #e5e7eb; font-weight: 600;">${ind.pedido || 'N/A'}</td>
          <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid #e5e7eb; text-transform: uppercase; font-size: 0.675rem;"><span style="background: rgba(229, 57, 53, 0.1); color: #e53935; padding: 0.1rem 0.35rem; border-radius: 4px; font-weight: 600;">${ind.operador || 'N/A'}</span></td>
          <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid #e5e7eb; color: #4b5563;">${ind.razon || 'N/A'}</td>
          <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600; color: #ef4444;">-${formatCLP(ind.monto)}</td>
        </tr>
      `;
    });
  }
  
  const indemnificationsSection = indemnificationsRows ? `
    <!-- PÁGINA INDEMNIZACIONES -->
    <div style="width: 210mm; padding: 15mm; box-sizing: border-box; display: flex; flex-direction: column; justify-content: flex-start; min-height: 297mm; page-break-before: always; position: relative;">
      <div style="background: #e53935; color: white; text-align: center; font-weight: bold; padding: 0.5rem; text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.05em; border-radius: 4px; margin-bottom: 0.75rem;">
        Detalle de Descuentos e Indemnizaciones Aplicadas
      </div>
      
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 1rem; font-size: 0.725rem;">
        <thead>
          <tr style="background: #f3f4f6; color: #111827; font-weight: bold; text-transform: uppercase; text-align: left;">
            <th style="padding: 0.5rem; font-size: 0.65rem; border-radius: 4px 0 0 4px;">ID Pedido</th>
            <th style="padding: 0.5rem; font-size: 0.65rem;">Operador / Courier</th>
            <th style="padding: 0.5rem; font-size: 0.65rem;">Razón / Concepto</th>
            <th style="padding: 0.5rem; font-size: 0.65rem; text-align: right; border-radius: 0 4px 4px 0;">Monto Descuento</th>
          </tr>
        </thead>
        <tbody>
          ${indemnificationsRows}
        </tbody>
      </table>
    </div>
  ` : '';
  
  let detailRows = '';
  shipments.forEach((s, idx) => {
    detailRows += `
      <tr style="background: ${idx % 2 === 0 ? 'white' : '#f9fafb'}; font-size: 0.725rem;">
        <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid #e5e7eb; font-weight: 500;">${s.orderId || s.shipmentId || 'N/A'}</td>
        <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid #e5e7eb; font-family: monospace; font-size: 0.7rem;">${idx + 1}</td>
        <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid #e5e7eb; font-family: monospace; font-size: 0.7rem;">${s.tracking || 'N/A'}</td>
        <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid #e5e7eb; text-transform: uppercase; font-size: 0.675rem;"><span style="background: rgba(16, 185, 129, 0.1); color: #10b981; padding: 0.1rem 0.35rem; border-radius: 4px; font-weight: 600;">${s.carrier}</span></td>
        <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid #e5e7eb; color: #4b5563;">${s.status}</td>
        <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid #e5e7eb; color: #4b5563; font-size: 0.675rem;">${s.commune}</td>
        <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid #e5e7eb; text-align: right;">${formatWeight(s.peso)}</td>
        <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600; color: #111827;">${formatCLP(s.neto)}</td>
      </tr>
    `;
  });
  
  return `
    <div style="background: white; color: #333; font-family: 'Outfit', 'Inter', sans-serif;">
      
      <!-- PÁGINA 1: PORTADA / RESUMEN -->
      <div style="width: 210mm; min-height: 297mm; padding: 15mm; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; page-break-after: always; position: relative;">
        <div>
          <!-- Cabecera / Logos e Info -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem;">
            <div style="display: flex; align-items: center;">
              <img src="data:image/png;base64,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" style="height: 52px; width: auto; display: block;" alt="Stocka Logo">
            </div>
            
            <div style="text-align: right; font-size: 0.8rem; color: #4b5563; line-height: 1.5;">
              <div style="font-weight: 800; color: #111827; font-size: 1.15rem; margin-bottom: 0.25rem; letter-spacing: -0.01em;">Detalle de Cobros</div>
              <div>Fecha Emisión: <strong style="color: #111827;">${emissionFormatted}</strong></div>
              <div>Plazo de Pago: <strong style="color: #5B00E4; font-weight: 700;">${deadlineFormatted}</strong></div>
            </div>
          </div>
          
          <!-- Bloque de Razón Social / Direcciones -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem; font-size: 0.8rem;">
            <div style="border: 1px solid #e5e7eb; border-radius: 8px; background: #fafafa; padding: 0.85rem; line-height: 1.5; color: #4b5563;">
              <div style="font-weight: 800; color: #5B00E4; font-size: 0.8rem; margin-bottom: 0.35rem; text-transform: uppercase; letter-spacing: 0.08em;">EMISOR</div>
              <strong style="color: #111827; font-size: 0.9rem;">STOCKA SPA</strong><br>
              <strong>RUT: 77.524.557-3</strong><br>
              Almacenamiento y Fulfillment<br>
              Campo de Deportes 405, Ñuñoa<br>
              <span style="color: #5B00E4; font-weight: 600;">www.stocka.cl</span>
            </div>
            
            <div style="border: 1px solid #e5e7eb; border-radius: 8px; background: #fafafa; padding: 0.85rem; line-height: 1.5; color: #4b5563;">
              <div style="font-weight: 800; color: #00D2C8; font-size: 0.8rem; margin-bottom: 0.35rem; text-transform: uppercase; letter-spacing: 0.08em;">CLIENTE / FACTURACIÓN</div>
              <strong style="color: #111827; font-size: 0.9rem;">${totals.razon_social || totals.billingGroup || commerceName}</strong><br>
              <strong>RUT: ${totals.rut || 'N/A'}</strong><br>
              Dirección comercial asociada al comercio
            </div>
          </div>
          
          <div style="background: #5B00E4; color: white; text-align: center; font-weight: 700; padding: 0.5rem; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.08em; border-radius: 6px; margin-bottom: 0.75rem;">
            Despachos mediante integración Envíame
          </div>
          
          <div style="background: #00D2C8; color: white; font-weight: 800; padding: 0.6rem 1rem; font-size: 0.85rem; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; letter-spacing: 0.05em;">
            <span>COMERCIO:</span>
            <span style="font-size: 1.1rem; text-transform: uppercase; font-weight: 900; letter-spacing: 0.02em;">${commerceName}</span>
          </div>
          
          <!-- Tabla de Resumen Premium -->
          <div style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.02); margin-bottom: 1.25rem;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
              <tbody>
                <tr style="border-bottom: 1px solid #f3f4f6;">
                  <td style="padding: 0.75rem 1rem; font-weight: 600; color: #4b5563;">Periodo de facturación</td>
                  <td style="padding: 0.75rem 1rem; text-align: right; font-weight: 700; color: #111827;">${periodName}</td>
                </tr>
                <tr style="background: #f9fafb; border-bottom: 1px solid #f3f4f6;">
                  <td style="padding: 0.75rem 1rem; font-weight: 600; color: #4b5563;">Cantidad de despachos facturados</td>
                  <td style="padding: 0.75rem 1rem; text-align: right; font-weight: 700; color: #111827;">${totals.quantity}</td>
                </tr>
                <tr style="border-bottom: 1px solid #f3f4f6;">
                  <td style="padding: 0.75rem 1rem; font-weight: 600; color: #4b5563;">Costo Neto de despachos</td>
                  <td style="padding: 0.75rem 1rem; text-align: right; font-weight: 700; color: #111827;">${formatCLP(totals.net)}</td>
                </tr>
                <tr style="background: #f9fafb; border-bottom: 1px solid #f3f4f6;">
                  <td style="padding: 0.75rem 1rem; font-weight: 600; color: #4b5563;">IVA (19%)</td>
                  <td style="padding: 0.75rem 1rem; text-align: right; font-weight: 700; color: #111827;">${formatCLP(totals.iva)}</td>
                </tr>
                <tr style="border-bottom: 1px solid #f3f4f6; background: rgba(0, 210, 200, 0.03);">
                  <td style="padding: 0.75rem 1rem; font-weight: 700; color: #00A69E;">TOTAL A FACTURAR</td>
                  <td style="padding: 0.75rem 1rem; text-align: right; font-weight: 800; color: #111827;">${formatCLP(totals.total)}</td>
                </tr>
                <tr style="background: #fff; border-bottom: none;">
                  <td style="padding: 0.75rem 1rem; font-weight: 600; color: #4b5563;">DESCUENTOS - INDEMNIZACIONES</td>
                  <td style="padding: 0.75rem 1rem; text-align: right; font-weight: 700; color: #ef4444;">-${formatCLP(totals.indemnizaciones || 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Banner de Destacado de Pago Final -->
          <div style="background: linear-gradient(135deg, #5B00E4, #7c22e4); color: white; border-radius: 8px; padding: 1.15rem; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 10px rgba(91, 0, 228, 0.12); margin-bottom: 1.5rem;">
            <div>
              <span style="font-size: 0.725rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.85;">Detalle de Cobro</span>
              <div style="font-size: 0.9rem; font-weight: 600; margin-top: 0.2rem; opacity: 0.9;">
                Neto: ${formatCLP(totals.totalAPagar ? Math.round(totals.totalAPagar / 1.19) : 0)} + IVA: ${formatCLP(totals.totalAPagar ? Math.round(totals.totalAPagar - (totals.totalAPagar / 1.19)) : 0)}
              </div>
            </div>
            <div style="text-align: right;">
              <span style="font-size: 0.725rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.85;">Total a Pagar</span>
              <div style="font-size: 1.7rem; font-weight: 900; margin-top: 0.1rem; font-family: 'Outfit', sans-serif; letter-spacing: -0.01em;">${formatCLP(totals.totalAPagar || totals.total || 0)}</div>
            </div>
          </div>
            </tbody>
          </table>
        </div>
        
        <div>
          <div style="background: #111827; color: white; text-align: center; font-weight: bold; padding: 0.45rem; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.08em; border-radius: 4px 4px 0 0;">
            Instrucciones de Pago
          </div>
          <div style="border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 6px 6px; padding: 0.75rem; background: #fafafa; font-size: 0.725rem; line-height: 1.45; color: #4b5563;">
            <p style="margin: 0 0 0.5rem 0; font-weight: 500;">
              El detalle presentado cuenta, desde la fecha de entrega, con un <strong>plazo de 3 días hábiles para su pago</strong> a Stocka SpA. El no pago de este detalle puede implicar una pausa en el servicio de Fulfillment a su comercio, con la consecuente paralización de despachos de paquetería procesada Stocka.
            </p>
            <p style="margin: 0 0 0.5rem 0; font-weight: 600; color: #111827;">
              Agradecemos realizar el pago del servicio a la siguiente cuenta bancaria:
            </p>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; background: white; border: 1px solid #e5e7eb; padding: 0.45rem 0.6rem; border-radius: 4px;">
              <div>Razón Social: <strong style="color:#111827;">STOCKA SPA</strong></div>
              <div>RUT: <strong style="color:#111827;">77.524.557-3</strong></div>
              <div>Banco: <strong style="color:#111827;">Scotiabank</strong></div>
              <div>Tipo Cuenta: <strong style="color:#111827;">Corriente</strong></div>
              <div>N° Cuenta: <strong style="color:#111827;">992369965</strong></div>
              <div>Correo: <strong style="color:#5B00E4; font-weight:700;">finanzas@stocka.cl</strong></div>
            </div>
          </div>
        </div>
      </div>
      
      ${statsPage}
      ${comparisonPage}
      
      <!-- PÁGINA 2+: DETALLE DE DESPACHOS -->
      <div style="width: 210mm; padding: 15mm; box-sizing: border-box; display: flex; flex-direction: column; justify-content: flex-start; min-height: 297mm; position: relative;">
        <div style="background: #111827; color: white; text-align: center; font-weight: bold; padding: 0.5rem; text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.05em; border-radius: 4px; margin-bottom: 0.75rem;">
          Detalle de Despachos Facturados por Envíame
        </div>
        
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 1rem; font-size: 0.725rem;">
          <thead>
            <tr style="background: #00D2C8; color: white; font-weight: bold; text-transform: uppercase; text-align: left;">
              <th style="padding: 0.5rem; font-size: 0.65rem; border-radius: 4px 0 0 4px;">ID Pedido</th>
              <th style="padding: 0.5rem; font-size: 0.65rem;">#</th>
              <th style="padding: 0.5rem; font-size: 0.65rem;">Tracking</th>
              <th style="padding: 0.5rem; font-size: 0.65rem;">Carrier</th>
              <th style="padding: 0.5rem; font-size: 0.65rem;">Estado</th>
              <th style="padding: 0.5rem; font-size: 0.65rem;">Destino</th>
              <th style="padding: 0.5rem; font-size: 0.65rem; text-align: right;">Peso (Kg)</th>
              <th style="padding: 0.5rem; font-size: 0.65rem; text-align: right; border-radius: 0 4px 4px 0;">Valor Neto</th>
            </tr>
          </thead>
          <tbody>
            ${detailRows}
          </tbody>
        </table>
      </div>
      ${indemnificationsSection}
    </div>
  `;
};

// --- PREVISUALIZADOR PDF EN MODAL ---
window.previewEnviameBreakdownPDF = function(index) {
  const data = window.importerParsedData[index];
  if (!data) return;
  
  const emissionDate = document.getElementById('importer-fecha-emision').value;
  const deadlineDate = document.getElementById('importer-fecha-limite').value;
  const periodName = document.querySelector('#modal-enviame-importer h3').textContent.split('- Periodo: ')[1]?.trim() || '';
  
  let modal = document.getElementById('modal-enviame-preview');
  if (modal) modal.remove();
  
  modal = document.createElement('div');
  modal.id = 'modal-enviame-preview';
  modal.className = 'modal-overlay active';
  modal.style.zIndex = '11000';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.background = 'rgba(0, 0, 0, 0.6)';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100vw';
  modal.style.height = '100vh';
  
  const pdfHtml = window.renderEnviameBreakdownHtml(data.commerce, data.shipments, {
    ...data.totals,
    rut: data.rut,
    razon_social: data.razon_social,
    billingGroup: data.billingGroup,
    indemnifications: data.indemnifications
  }, emissionDate, deadlineDate, periodName);
  
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 950px; width: 95%; height: 90vh; background: var(--color-surface); border-radius: var(--radius-lg); padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; box-shadow: var(--shadow-lg); border: 1px solid var(--color-border);">
      
      <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--color-border); padding-bottom: 0.5rem;">
        <h3 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main); font-weight: 700;">
          <i class="ri-eye-line" style="color: #9c27b0; margin-right: 0.25rem;"></i>
          Vista Previa Desglose - ${data.commerce}
        </h3>
        <button onclick="document.getElementById('modal-enviame-preview').remove()" class="btn-close" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--color-text-muted); padding: 0.2rem;"><i class="ri-close-line"></i></button>
      </div>
      
      <div style="flex-grow: 1; overflow-y: auto; background: var(--color-bg); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); text-align: center;">
        <div id="pdf-visual-container" style="display: inline-block; transform-origin: top center; transform: scale(0.95); margin-bottom: 2rem;">
          ${pdfHtml}
        </div>
      </div>
      
      <div style="display: flex; justify-content: flex-end; gap: 0.5rem; border-top: 1px solid var(--color-border); padding-top: 0.75rem;">
        <button onclick="document.getElementById('modal-enviame-preview').remove()" class="btn btn-outline">Cerrar Vista Previa</button>
        <button onclick="window.downloadTestPDF(${index})" class="btn btn-primary" style="background: #9c27b0; border-color: #9c27b0;"><i class="ri-download-2-line"></i> Descargar PDF de Prueba</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Draw the comparative charts inside the preview modal
  loadEnviameAnalyticsChartJS().then(() => {
    const stats = window.calculateEnviameStatistics(data.shipments, data.totals.net);
    window.drawEnviamePDFCharts(modal, data.commerce, periodName, {
      ...data.totals,
      billingGroup: data.billingGroup
    }, stats);
  });
};

// Descargar PDF localmente desde la previsualización
window.downloadTestPDF = function(index) {
  const data = window.importerParsedData[index];
  if (!data) return;
  const container = document.querySelector('#pdf-visual-container');
  if (!container) return;
  
  const emissionDate = document.getElementById('importer-fecha-emision').value;
  const periodName = document.querySelector('#modal-enviame-importer h3').textContent.split('- Periodo: ')[1]?.trim() || '';
  
  const opt = {
    margin:       0,
    filename:     `prueba_desglose_enviame_${data.commerce.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${periodName}.pdf`,
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { scale: 2, useCORS: true, scrollY: 0, scrollX: 0 },
    jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
  };
  
  Swal.fire({
    title: 'Generando PDF',
    text: 'Compilando e iniciando descarga local...',
    allowOutsideClick: false,
    didOpen: () => {
      Swal.showLoading();
    }
  });
  
  html2pdf().from(container).set(opt).save().then(() => {
    Swal.close();
  }).catch(err => {
    console.error(err);
    Swal.fire({
      icon: 'error',
      title: 'Error al generar PDF',
      text: err.message
    });
  });
};

// --- PROCESAMIENTO Y ENVÍO A BD ---
function generateExcelBlobForBreakdown(commData, periodName) {
  if (typeof XLSX === 'undefined') {
    console.error('SheetJS (XLSX) is not loaded.');
    return null;
  }
  const wb = XLSX.utils.book_new();

  // Hoja 1: Resumen
  const resumenData = [
    ["RESUMEN DE COBROS - INTEGRACIÓN ENVÍAME"],
    [],
    ["EMISOR", "STOCKA SPA"],
    ["RUT EMISOR", "77.524.557-3"],
    ["DIRECCIÓN EMISOR", "Campo de Deportes 405, Ñuñoa"],
    [],
    ["CLIENTE / COMERCIO", commData.commerce],
    ["RAZÓN SOCIAL", commData.razon_social || commData.commerce],
    ["RUT CLIENTE", commData.rut || "N/A"],
    [],
    ["Periodo de facturación", periodName],
    ["Cantidad de despachos facturados", commData.totals.quantity],
    ["Costo Neto de despachos", commData.totals.net],
    ["IVA (19%)", commData.totals.iva],
    ["TOTAL A FACTURAR", commData.totals.total],
    ["DESCUENTOS - INDEMNIZACIONES", commData.totals.indemnizaciones],
    ["TOTAL A PAGAR", commData.totals.totalAPagar]
  ];
  const wsResumen = XLSX.utils.aoa_to_sheet(resumenData);
  wsResumen['!cols'] = [{ wch: 32 }, { wch: 32 }];
  XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");

  // Hoja 2: Detalle de Despachos
  const despachosHeaders = [["ID Pedido", "Tracking / Guía", "Comuna Destino", "Courier", "Peso Carrier (kg)", "Precio Neto ($)"]];
  const despachosRows = (commData.shipments || []).map(s => [
    s.orderId || s.shipmentId || "N/A",
    s.tracking || "N/A",
    s.commune || "N/A",
    s.carrier || "N/A",
    s.weight || 0,
    s.neto || 0
  ]);
  const wsDespachos = XLSX.utils.aoa_to_sheet(despachosHeaders.concat(despachosRows));
  wsDespachos['!cols'] = [{ wch: 18 }, { wch: 18 }, { wch: 22 }, { wch: 15 }, { wch: 18 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsDespachos, "Detalle Despachos");

  // Hoja 3: Indemnizaciones (si existen)
  if (commData.indemnifications && commData.indemnifications.length > 0) {
    const indHeaders = [["ID Pedido", "Operador / Courier", "Razón / Concepto", "Monto Neto ($)"]];
    const indRows = commData.indemnifications.map(ind => [
      ind.pedido || "N/A",
      ind.operador || "N/A",
      ind.razon || "N/A",
      ind.monto || 0
    ]);
    const wsInd = XLSX.utils.aoa_to_sheet(indHeaders.concat(indRows));
    wsInd['!cols'] = [{ wch: 18 }, { wch: 20 }, { wch: 30 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsInd, "Indemnizaciones");
  }

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

window.processSelectedEnviameImports = async function(periodId) {
  const tbody = document.getElementById('importer-results-tbody');
  const checkedBoxes = tbody.querySelectorAll('.importer-row-select:checked');
  
  if (checkedBoxes.length === 0) {
    Swal.fire({
      icon: 'warning',
      title: 'Sin selecciones',
      text: 'Por favor, selecciona al menos un comercio para registrar.',
      confirmButtonColor: '#9c27b0'
    });
    return;
  }
  
  const emissionDate = document.getElementById('importer-fecha-emision').value;
  const deadlineDate = document.getElementById('importer-fecha-limite').value;
  const defaultPagoStatus = document.getElementById('importer-pago-status').value;
  const defaultFacturaStatus = document.getElementById('importer-factura-status').value;
  const notifyClient = document.getElementById('importer-send-notification').checked;
  const periodName = document.querySelector('#modal-enviame-importer h3').textContent.split('- Periodo: ')[1]?.trim() || '';
  
  const indexesToProcess = Array.from(checkedBoxes).map(cb => parseInt(cb.getAttribute('data-idx')));
  const batchSize = indexesToProcess.length;
  
  const modalContent = document.querySelector('#modal-enviame-importer .modal-content');
  const originalHtml = modalContent.innerHTML;
  
  modalContent.innerHTML = `
    <div style="text-align: center; padding: 4rem 2rem;">
      <i class="ri-loader-4-line spin" style="font-size: 3rem; color: #9c27b0; display: block; margin-bottom: 1.5rem;"></i>
      <h3 style="margin: 0 0 0.5rem 0; font-size: 1.2rem; color: var(--color-text-main);">Procesando Desgloses Envíame</h3>
      <p id="importer-batch-progress" style="font-size: 0.9rem; color: var(--color-text-muted); font-weight: 500;">Generando PDF y subiendo a Storage 1 de ${batchSize}...</p>
      <div style="width: 100%; height: 6px; background: var(--color-border); border-radius: 3px; margin: 1.5rem 0; overflow: hidden; position: relative;">
        <div id="importer-progress-bar" style="width: 0%; height: 100%; background: #9c27b0; transition: width 0.3s;"></div>
      </div>
    </div>
  `;
  
  const selectedCommerces = indexesToProcess.map(idx => window.importerParsedData[idx]);
  
  const groupsToUpdate = {};
  selectedCommerces.forEach(c => {
    if (!groupsToUpdate[c.billingGroup]) {
      groupsToUpdate[c.billingGroup] = {
        billingGroup: c.billingGroup,
        commerces: []
      };
    }
    groupsToUpdate[c.billingGroup].commerces.push(c);
  });
  
  let successCount = 0;
  let emailNotice = '';
  
  try {
    const keys = Object.keys(groupsToUpdate);
    let currentTaskIndex = 0;
    const modalOverlay = document.getElementById('modal-enviame-importer');
    
    for (let billingGroupName of keys) {
      const groupData = groupsToUpdate[billingGroupName];
      
      const { data: existingRecord, error: rError } = await supabase
        .from('billing_records')
        .select('id, enviame, enviame_pdfs')
        .eq('period_id', periodId)
        .eq('comercio', billingGroupName)
        .maybeSingle();
        
      if (rError) throw rError;
      
      let recordId = existingRecord ? existingRecord.id : null;
      let currentPdfs = existingRecord?.enviame_pdfs || [];
      
      for (let commData of groupData.commerces) {
        currentTaskIndex++;
        const percent = Math.round((currentTaskIndex / batchSize) * 100);
        document.getElementById('importer-progress-bar').style.width = `${percent}%`;
        document.getElementById('importer-batch-progress').textContent = `Generando y subiendo Reporte/Excel para ${commData.commerce} (${currentTaskIndex} de ${batchSize})...`;
        
        const sanitizedCommerceName = commData.commerce.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const storagePathJson = `billing_files/${periodId}_enviame_${Date.now()}_reporte_${sanitizedCommerceName}.json`;
        const storagePathXlsx = `billing_files/${periodId}_enviame_${Date.now()}_detalle_${sanitizedCommerceName}.xlsx`;
        
        // Generar Estadísticas
        const stats = window.calculateEnviameStatistics(commData.shipments, commData.totals.net);
        
        // Generar JSON Reporte
        const reportData = {
          commerceName: commData.commerce,
          billingGroup: commData.billingGroup,
          rut: commData.rut,
          razon_social: commData.razon_social,
          periodName,
          emissionDate,
          deadlineDate,
          totals: commData.totals,
          shipments: commData.shipments,
          indemnifications: commData.indemnifications,
          stats
        };
        
        const jsonBlob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
        const { error: uploadErrJson } = await supabase.storage
          .from('payment_receipts')
          .upload(storagePathJson, jsonBlob);
          
        if (uploadErrJson) throw uploadErrJson;
        
        const { data: urlDataJson } = supabase.storage
          .from('payment_receipts')
          .getPublicUrl(storagePathJson);
          
        const filePublicUrlJson = urlDataJson.publicUrl;
        
        // Generar y Subir Excel
        let filePublicUrlXlsx = null;
        const excelBlob = generateExcelBlobForBreakdown(commData, periodName);
        if (excelBlob) {
          const { error: uploadErrXlsx } = await supabase.storage
            .from('payment_receipts')
            .upload(storagePathXlsx, excelBlob);
            
          if (!uploadErrXlsx) {
            const { data: urlDataXlsx } = supabase.storage
              .from('payment_receipts')
              .getPublicUrl(storagePathXlsx);
            filePublicUrlXlsx = urlDataXlsx?.publicUrl;
          }
        }
        
        // Limpiar registros antiguos de este comercio para evitar duplicados
        const oldName = `Desglose Envíame - ${commData.commerce}`;
        const pdfName = `Desglose Envíame (PDF) - ${commData.commerce}`;
        const xlsxName = `Detalle Envíame (Excel) - ${commData.commerce}`;
        const newXlsxName = `Detalle Excel - ${commData.commerce}`;
        const reportName = `Reporte Interactivo - ${commData.commerce}`;
        const oldReportName = `Reporte Interactivo`; // Limpiar el genérico antiguo
        
        currentPdfs = currentPdfs.filter(p => 
          p.name !== oldName && 
          p.name !== pdfName && 
          p.name !== xlsxName && 
          p.name !== newXlsxName && 
          p.name !== reportName &&
          p.name !== oldReportName
        );
        
        // Registrar Excel en listado (lleva el monto para la suma de facturación)
        if (filePublicUrlXlsx) {
          currentPdfs.push({
            name: newXlsxName,
            url: filePublicUrlXlsx,
            net_amount: commData.totals.totalAPagar
          });
        }
        
        // Registrar Reporte Interactivo en listado
        if (filePublicUrlJson) {
          currentPdfs.push({
            name: reportName,
            url: filePublicUrlJson,
            net_amount: 0
          });
        }
        
        successCount++;
      }
      
      // Si el grupo tiene más de 1 comercio, generamos y subimos el JSON Reporte Consolidado del Conglomerado
      if (groupData.commerces.length > 1) {
        document.getElementById('importer-batch-progress').textContent = `Generando y subiendo Reporte Consolidado para ${billingGroupName}...`;
        
        const totalNet = groupData.commerces.reduce((sum, c) => sum + c.totals.net, 0);
        const allShipments = groupData.commerces.reduce((acc, c) => acc.concat(c.shipments), []);
        const stats = window.calculateEnviameStatistics(allShipments, totalNet);
        const totalIva = Math.round(totalNet * 0.19);
        const totalFactura = totalNet + totalIva;
        const totalIndemnizaciones = groupData.commerces.reduce((sum, c) => sum + c.totals.indemnizaciones, 0);
        const totalAPagar = totalFactura - totalIndemnizaciones;
        
        const groupReportData = {
          isGroup: true,
          billingGroupName,
          periodName,
          emissionDate,
          deadlineDate,
          totals: {
            quantity: allShipments.length,
            net: totalNet,
            iva: totalIva,
            total: totalFactura,
            indemnizaciones: totalIndemnizaciones,
            totalAPagar
          },
          commerces: groupData.commerces.map(c => ({
            commerce: c.commerce,
            totals: c.totals,
            shipments: c.shipments,
            indemnifications: c.indemnifications
          })),
          stats
        };
        
        const sanitizedGroupName = billingGroupName.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const storagePathGroupJson = `billing_files/${periodId}_enviame_${Date.now()}_reporte_consolidado_${sanitizedGroupName}.json`;
        
        const groupJsonBlob = new Blob([JSON.stringify(groupReportData, null, 2)], { type: 'application/json' });
        const { error: uploadErrGroupJson } = await supabase.storage
          .from('payment_receipts')
          .upload(storagePathGroupJson, groupJsonBlob);
          
        if (!uploadErrGroupJson) {
          const { data: urlDataGroupJson } = supabase.storage
            .from('payment_receipts')
            .getPublicUrl(storagePathGroupJson);
            
          const filePublicUrlGroupJson = urlDataGroupJson?.publicUrl;
          if (filePublicUrlGroupJson) {
            const groupReportName = `Reporte Consolidado`;
            const oldGroupPdfName = `Desglose Envíame Consolidado (PDF) - ${billingGroupName}`;
            
            // Limpiar registro antiguo consolidado si existe
            currentPdfs = currentPdfs.filter(p => p.name !== groupReportName && p.name !== oldGroupPdfName);
            
            currentPdfs.push({
              name: groupReportName,
              url: filePublicUrlGroupJson,
              net_amount: 0 // Evitamos duplicar sumando en base de datos
            });
          }
        }
      }
      
      let newEnviameTotal = 0;
      currentPdfs.forEach(pdf => {
        newEnviameTotal += (pdf.net_amount || 0);
      });
      
      const updates = {
        enviame: newEnviameTotal,
        fecha_limite_enviame: deadlineDate,
        pago_enviame: defaultPagoStatus,
        factura_enviame: defaultFacturaStatus,
        enviame_pdfs: currentPdfs,
        updated_at: new Date().toISOString()
      };
      
      if (recordId) {
        const { error: updateErr } = await supabase
          .from('billing_records')
          .update(updates)
          .eq('id', recordId);
        if (updateErr) throw updateErr;
      } else {
        const insertPayload = {
          period_id: periodId,
          comercio: billingGroupName,
          ...updates
        };
        const { data: inserted, error: insertErr } = await supabase
          .from('billing_records')
          .insert(insertPayload)
          .select('id')
          .single();
        if (insertErr) throw insertErr;
        recordId = inserted.id;
      }
      
      if (notifyClient && recordId) {
        const { data: contacts } = await supabase
          .from('billing_contacts')
          .select('email')
          .eq('comercio', billingGroupName)
          .eq('activo', true);
          
        const emails = (contacts || []).map(c => c.email);
        if (emails.length > 0) {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            const response = await fetch(`https://ejtjfaucnxbikrwjwwdu.supabase.co/functions/v1/send-billing-email`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
              },
              body: JSON.stringify({
                recordId,
                serviceType: 'enviame',
                emails,
                customMessage: 'Se ha registrado y generado un nuevo desglose de cobros de Envíame.',
                emailType: 'billing_summary'
              })
            });
            
            if (response.ok) {
              await supabase
                .from('billing_records')
                .update({ last_notified_at: new Date().toISOString() })
                .eq('id', recordId);
              emailNotice = ' y notificaciones enviadas por correo';
            } else {
              console.warn('Fallo el envío del correo por Edge Function.');
              emailNotice = ' (algunos correos de aviso fallaron al enviarse)';
            }
          }
        } else {
          emailNotice = ' (no hay contactos de cobranza configurados para algunos comercios)';
        }
      }
    }
    
    // --- COMPILAR Y SUBIR ESTADÍSTICAS CONFIRMADAS AL CLOUD (SUPABASE STORAGE) ---
    try {
      const monthMapping = {
        'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04', 'mayo': '05', 'junio': '06',
        'julio': '07', 'agosto': '08', 'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
      };
      const parts = (periodName || '').split(' ');
      const spanishMonthName = parts[0] ? parts[0].toLowerCase() : '';
      const yearStr = parts[1] || '';
      const monthNum = monthMapping[spanishMonthName];
      const pKey = monthNum && yearStr ? `${yearStr}-${monthNum}` : null;
      
      if (pKey) {
        document.getElementById('importer-batch-progress').textContent = `Guardando base de datos de estadísticas del periodo...`;
        const allShipmentsGlobal = selectedCommerces.reduce((acc, c) => acc.concat(c.shipments), []);
        const totalNetGlobal = selectedCommerces.reduce((sum, c) => sum + c.totals.net, 0);
        const statsGlobal = window.calculateEnviameStatistics(allShipmentsGlobal, totalNetGlobal);
        
        const globalStatsObject = {
          periodKey: pKey,
          periodLabel: periodName,
          totalShipments: allShipmentsGlobal.length,
          totalNet: totalNetGlobal,
          avgWeight: statsGlobal.avgWeight,
          avgRate: statsGlobal.avgRate,
          preferredCourier: statsGlobal.preferredCourier || 'N/A',
          couriers: statsGlobal.couriers,
          destinations: statsGlobal.destinations
        };
        
        const byCommerceStatsObject = {};
        Object.entries(groupsToUpdate).forEach(([billingGroupName, groupData]) => {
          const allShipmentsGroup = groupData.commerces.reduce((acc, c) => acc.concat(c.shipments), []);
          const totalNetGroup = groupData.commerces.reduce((sum, c) => sum + c.totals.net, 0);
          const statsGroup = window.calculateEnviameStatistics(allShipmentsGroup, totalNetGroup);
          
          byCommerceStatsObject[billingGroupName] = {
            periodKey: pKey,
            periodLabel: periodName,
            totalShipments: allShipmentsGroup.length,
            totalNet: totalNetGroup,
            avgWeight: statsGroup.avgWeight,
            avgRate: statsGroup.avgRate,
            preferredCourier: statsGroup.preferredCourier || 'N/A',
            couriers: statsGroup.couriers,
            destinations: statsGroup.destinations
          };
        });
        
        const statsPayload = {
          periodKey: pKey,
          periodLabel: periodName,
          global: globalStatsObject,
          byCommerce: byCommerceStatsObject
        };
        
        const statsBlob = new Blob([JSON.stringify(statsPayload, null, 2)], { type: 'application/json' });
        const statsStoragePath = `billing_files/${periodId}_enviame_confirmed_stats.json`;
        
        const { error: uploadStatsErr } = await supabase.storage
          .from('payment_receipts')
          .upload(statsStoragePath, statsBlob, { upsert: true });
          
        if (!uploadStatsErr) {
          console.log("Confirmed stats successfully uploaded to cloud.");
          // Merge in-memory immediately for real-time dashboard updates without page refresh
          window.mergeConfirmedPeriodStats(statsPayload);
        } else {
          console.warn("Could not save confirmed stats to cloud storage:", uploadStatsErr);
        }
      }
    } catch (statsErr) {
      console.warn("Could not save confirmed stats to cloud:", statsErr);
    }
    
    document.getElementById('modal-enviame-importer').remove();
    
    Swal.fire({
      icon: 'success',
      title: 'Procesamiento Exitoso',
      text: `Se registraron con éxito los desgloses de Envíame para ${successCount} comercios en base de datos${emailNotice}.`,
      confirmButtonColor: '#9c27b0'
    });
    
    if (typeof window.loadBillingPeriods === 'function') {
      await window.loadBillingPeriods();
    }
    
  } catch (err) {
    console.error("Error al procesar desgloses:", err);
    Swal.fire({
      icon: 'error',
      title: 'Error de Procesamiento',
      text: err.message,
      confirmButtonColor: '#9c27b0'
    });
    
    modalContent.innerHTML = originalHtml;
  }
};

// --- RENDERIZACIÓN DE PDF CONSOLIDADO DE CONGLOMERADOS ---
window.renderEnviameGroupBreakdownHtml = function(groupName, comerces, emissionDate, deadlineDate, periodName) {
  const formatFecha = (dStr) => {
    if (!dStr) return '';
    const parts = dStr.split('-');
    if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
    return dStr;
  };
  
  const emissionFormatted = formatFecha(emissionDate);
  const deadlineFormatted = formatFecha(deadlineDate);
  
  // Calcular totales consolidados
  const totalQty = comerces.reduce((sum, c) => sum + c.totals.quantity, 0);
  const totalNet = comerces.reduce((sum, c) => sum + c.totals.net, 0);
  const totalIva = Math.round(totalNet * 0.19);
  const totalFactura = totalNet + totalIva;
  const totalIndemnizaciones = comerces.reduce((sum, c) => sum + c.totals.indemnizaciones, 0);
  const totalAPagar = totalFactura - totalIndemnizaciones;
  
  const firstComm = comerces[0] || { rut: 'Falta configurar', razon_social: groupName };
  const groupRut = firstComm.rut || 'N/A';
  const groupRazonSocial = firstComm.razon_social || groupName;
  
  const allShipments = comerces.reduce((acc, c) => acc.concat(c.shipments), []);
  const stats = window.calculateEnviameStatistics(allShipments, totalNet);
  
  // Resolve period keys for MoM/YoY comparisons
  const monthMapping = {
    'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04', 'mayo': '05', 'junio': '06',
    'julio': '07', 'agosto': '08', 'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
  };
  const parts = (periodName || '').split(' ');
  const spanishMonthName = parts[0] ? parts[0].toLowerCase() : '';
  const yearStr = parts[1] || '';
  const monthNum = monthMapping[spanishMonthName];
  const currentPeriodKey = monthNum && yearStr ? `${yearStr}-${monthNum}` : null;
  
  const getPrecedingPeriodKey = (key) => {
    if (!key) return null;
    const [y, m] = key.split('-').map(Number);
    let newM = m - 1; let newY = y;
    if (newM === 0) { newM = 12; newY = y - 1; }
    return `${newY}-${newM.toString().padStart(2, '0')}`;
  };
  
  const getPreviousYearPeriodKey = (key) => {
    if (!key) return null;
    const [y, m] = key.split('-');
    return `${Number(y) - 1}-${m}`;
  };
  
  const history = window.commerceHistoricalEnviameData ? window.commerceHistoricalEnviameData[groupName] : null;
  const findInHistory = (key) => {
    if (!history || !key) return null;
    return history.find(h => h.periodKey === key) || null;
  };
  
  const precedingKey = getPrecedingPeriodKey(currentPeriodKey);
  const prevYearKey = getPreviousYearPeriodKey(currentPeriodKey);
  const precedingStats = findInHistory(precedingKey);
  const prevYearStats = findInHistory(prevYearKey);
  
  function formatComparisonRow(metricName, currentVal, prevValVal, prevYearVal, isCurrency = false, isWeight = false) {
    const formatVal = (v) => {
      if (v === null || v === undefined) return 'N/A';
      if (isCurrency) return formatCLP(Math.round(v));
      if (isWeight) return formatWeight(v) + ' Kg';
      return v.toLocaleString('es-CL');
    };
    
    const getChangePct = (curr, prev) => {
      if (curr === null || curr === undefined || prev === null || prev === undefined || prev === 0) return 'N/A';
      const diff = curr - prev;
      const pct = ((diff / prev) * 100).toFixed(1);
      const pctNum = parseFloat(pct);
      
      let isPositiveBetter = true;
      if (metricName.toLowerCase().includes('costo') || metricName.toLowerCase().includes('tarifa') || metricName.toLowerCase().includes('peso')) {
        isPositiveBetter = false; // decrease is good
      }
      
      if (pctNum === 0) return '<span style="color: #6b7280; font-weight:600;">0%</span>';
      if (pctNum > 0) {
        const color = isPositiveBetter ? '#10b981' : '#ef4444';
        return `<span style="color: ${color}; font-weight:600;"><i class="ri-arrow-up-line"></i>+${pct}%</span>`;
      } else {
        const color = isPositiveBetter ? '#ef4444' : '#10b981';
        return `<span style="color: ${color}; font-weight:600;"><i class="ri-arrow-down-line"></i>${pct}%</span>`;
      }
    };

    let prevVal = null;
    if (prevValVal) {
      if (metricName.includes('Costo')) prevVal = prevValVal.totalNet;
      else if (metricName.includes('Tarifa')) prevVal = prevValVal.avgRate;
      else if (metricName.includes('Peso')) prevVal = prevValVal.avgWeight;
      else prevVal = prevValVal.totalShipments;
    }

    let prevYear = null;
    if (prevYearVal) {
      if (metricName.includes('Costo')) prevYear = prevYearVal.totalNet;
      else if (metricName.includes('Tarifa')) prevYear = prevYearVal.avgRate;
      else if (metricName.includes('Peso')) prevYear = prevYearVal.avgWeight;
      else prevYear = prevYearVal.totalShipments;
    }

    return `
      <tr style="border-bottom: 1px solid #e5e7eb; font-size: 0.725rem;">
        <td style="padding: 0.45rem 0.5rem; font-weight: 700; color: #111827;">${metricName}</td>
        <td style="padding: 0.45rem 0.5rem; text-align: right; font-weight: 700; color: #5B00E4;">${formatVal(currentVal)}</td>
        <td style="padding: 0.45rem 0.5rem; text-align: right; color: #4b5563;">${formatVal(prevVal)}</td>
        <td style="padding: 0.45rem 0.5rem; text-align: right;">${getChangePct(currentVal, prevVal)}</td>
        <td style="padding: 0.45rem 0.5rem; text-align: right; color: #4b5563;">${formatVal(prevYear)}</td>
        <td style="padding: 0.45rem 0.5rem; text-align: right;">${getChangePct(currentVal, prevYear)}</td>
      </tr>
    `;
  }
  
  const comparisonPage = history && history.length > 0 ? `
    <!-- PÁGINA 3: ANÁLISIS COMPARATIVO HISTÓRICO CONSOLIDADO -->
    <div style="width: 210mm; padding: 15mm; box-sizing: border-box; display: flex; flex-direction: column; justify-content: flex-start; min-height: 297mm; page-break-before: always; position: relative;">
      
      <!-- Cabecera de Página -->
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #5B00E4; padding-bottom: 0.5rem; margin-bottom: 1.25rem;">
        <div style="font-weight: 800; color: #111827; font-size: 1.1rem; letter-spacing: -0.01em;">Análisis Comparativo e Histórico Consolidado</div>
        <div style="font-size: 0.75rem; color: #5B00E4; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Fulfillment Stocka</div>
      </div>
      
      <!-- Tabla de Comparación Temporal -->
      <div style="margin-bottom: 1.5rem;">
        <div style="background: #5B00E4; color: white; padding: 0.4rem 0.75rem; font-weight: 700; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; border-radius: 4px; margin-bottom: 0.5rem;">
          Comparación de Rendimiento Temporal Consolidado
        </div>
        <table style="width: 100%; border-collapse: collapse; background: white; border: 1px solid #e5e7eb; border-radius: 4px; overflow: hidden;">
          <thead>
            <tr style="background: #f3f4f6; color: #111827; font-weight: bold; font-size: 0.65rem; text-transform: uppercase; text-align: left;">
              <th style="padding: 0.4rem 0.5rem;">Indicador / Métrica</th>
              <th style="padding: 0.4rem 0.5rem; text-align: right;">Este Mes (${periodName})</th>
              <th style="padding: 0.4rem 0.5rem; text-align: right;">Mes Anterior</th>
              <th style="padding: 0.4rem 0.5rem; text-align: right;">Var %</th>
              <th style="padding: 0.4rem 0.5rem; text-align: right;">Año Anterior</th>
              <th style="padding: 0.4rem 0.5rem; text-align: right;">Var %</th>
            </tr>
          </thead>
          <tbody>
            ${formatComparisonRow('Cantidad de Envíos', allShipments.length, precedingStats, prevYearStats, false, false)}
            ${formatComparisonRow('Costo Neto Total ($)', totalNet, precedingStats, prevYearStats, true, false)}
            ${formatComparisonRow('Peso Promedio Paquete', stats.avgWeight, precedingStats, prevYearStats, false, true)}
            ${formatComparisonRow('Tarifa Promedio Neto ($)', stats.avgRate, precedingStats, prevYearStats, true, false)}
          </tbody>
        </table>
      </div>
      
      <!-- Gráficos de Evolución Histórica (Últimos 12 Meses) -->
      <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1rem; flex-grow: 1;">
        <div>
          <div style="background: #111827; color: white; padding: 0.35rem 0.75rem; font-weight: 700; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; border-radius: 4px; margin-bottom: 0.35rem;">
            Evolución Facturación y Envíos (Últimos 12 Meses)
          </div>
          <div style="width: 100%; height: 140px; display: flex; justify-content: center; align-items: center; background: #fafafa; border: 1px solid #e5e7eb; border-radius: 6px; padding: 0.25rem; box-sizing: border-box;">
            <canvas id="pdf-chart-trends-${groupName.replace(/\s+/g, '-')}" style="width: 600px; height: 130px;"></canvas>
          </div>
        </div>
        <div>
          <div style="background: #111827; color: white; padding: 0.35rem 0.75rem; font-weight: 700; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; border-radius: 4px; margin-bottom: 0.35rem;">
            Evolución Peso y Tarifa Promedio (Últimos 12 Meses)
          </div>
          <div style="width: 100%; height: 140px; display: flex; justify-content: center; align-items: center; background: #fafafa; border: 1px solid #e5e7eb; border-radius: 6px; padding: 0.25rem; box-sizing: border-box;">
            <canvas id="pdf-chart-averages-${groupName.replace(/\s+/g, '-')}" style="width: 600px; height: 130px;"></canvas>
          </div>
        </div>
      </div>
      
      <!-- Nota de Pie de Página -->
      <div style="font-size: 0.65rem; color: #9ca3af; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 0.5rem; margin-top: auto;">
        * La información histórica mostrada se basa en las planillas consolidadas mensuales procesadas en el WMS Stocka.
      </div>
      
    </div>
  ` : '';
  
  // Courier list rows
  let courierRows = '';
  stats.couriers.forEach((c, idx) => {
    const isPreferred = idx === 0;
    const badge = isPreferred ? '<span style="background: rgba(91, 0, 228, 0.1); color: #5B00E4; padding: 0.1rem 0.35rem; border-radius: 4px; font-weight: 700; font-size: 0.6rem; margin-left: 0.3rem;"><i class="ri-star-fill"></i> Preferido</span>' : '';
    courierRows += `
      <tr style="border-bottom: 1px solid #e5e7eb; font-size: 0.725rem;">
        <td style="padding: 0.45rem 0.5rem; font-weight: 600; color: #111827;">${c.name}${badge}</td>
        <td style="padding: 0.45rem 0.5rem; text-align: right;">${c.count} (${c.percentage}%)</td>
        <td style="padding: 0.45rem 0.5rem; text-align: right;">${formatWeight(c.avgWeight)} Kg</td>
        <td style="padding: 0.45rem 0.5rem; text-align: right; font-weight: 600; color: #111827;">${formatCLP(Math.round(c.avgRate))}</td>
      </tr>
    `;
  });
  
  // Destination list rows
  let destRows = '';
  stats.destinations.forEach((d) => {
    destRows += `
      <tr style="border-bottom: 1px solid #e5e7eb; font-size: 0.725rem;">
        <td style="padding: 0.45rem 0.5rem; font-weight: 600; color: #4b5563; text-transform: uppercase;">${d.name}</td>
        <td style="padding: 0.45rem 0.5rem; text-align: right;">${d.count}</td>
        <td style="padding: 0.45rem 0.5rem; text-align: right; font-weight: 600; color: #5B00E4;">${d.percentage}%</td>
      </tr>
    `;
  });

  const statsPage = `
    <!-- PÁGINA 2: ESTADÍSTICAS Y ANÁLISIS DE ENVÍOS CONSOLIDADO -->
    <div style="width: 210mm; padding: 15mm; box-sizing: border-box; display: flex; flex-direction: column; justify-content: flex-start; min-height: 297mm; page-break-before: always; page-break-after: always; position: relative;">
      <!-- Cabecera de Página -->
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #5B00E4; padding-bottom: 0.5rem; margin-bottom: 1.25rem;">
        <div style="font-weight: 800; color: #111827; font-size: 1.1rem; letter-spacing: -0.01em;">Estadísticas e Indicadores Consolidados</div>
        <div style="font-size: 0.75rem; color: #5B00E4; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Fulfillment Stocka</div>
      </div>
      
      <!-- Grid de Indicadores Clave -->
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 1.5rem;">
        <div style="border: 1px solid #e5e7eb; border-radius: 8px; background: #fafafa; padding: 0.75rem; text-align: center; box-shadow: 0 1px 2px rgba(0,0,0,0.01);">
          <div style="font-size: 0.65rem; font-weight: 700; color: #4b5563; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">Peso Promedio General</div>
          <div style="font-size: 1.35rem; font-weight: 800; color: #5B00E4;">${formatWeight(stats.avgWeight)} Kg</div>
          <div style="font-size: 0.6rem; color: #4b5563; margin-top: 0.15rem;">Por paquete facturado</div>
        </div>
        
        <div style="border: 1px solid #e5e7eb; border-radius: 8px; background: #fafafa; padding: 0.75rem; text-align: center; box-shadow: 0 1px 2px rgba(0,0,0,0.01);">
          <div style="font-size: 0.65rem; font-weight: 700; color: #4b5563; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">Tarifa Promedio General</div>
          <div style="font-size: 1.35rem; font-weight: 800; color: #00D2C8;">${formatCLP(Math.round(stats.avgRate))}</div>
          <div style="font-size: 0.6rem; color: #4b5563; margin-top: 0.15rem;">Costo neto prom. por envío</div>
        </div>
        
        <div style="border: 1px solid #e5e7eb; border-radius: 8px; background: #fafafa; padding: 0.75rem; text-align: center; box-shadow: 0 1px 2px rgba(0,0,0,0.01);">
          <div style="font-size: 0.65rem; font-weight: 700; color: #4b5563; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">Courier Preferido</div>
          <div style="font-size: 1.25rem; font-weight: 800; color: #111827; text-transform: uppercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${stats.preferredCourier}</div>
          <div style="font-size: 0.6rem; color: #4b5563; margin-top: 0.15rem;">Mayor volumen de envíos</div>
        </div>
      </div>
      
      <!-- Distribución por Courier -->
      <div style="margin-bottom: 1.5rem;">
        <div style="background: #5B00E4; color: white; padding: 0.4rem 0.75rem; font-weight: 700; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; border-radius: 4px; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.35rem;">
          <i class="ri-truck-line"></i> Distribución y Costos por Operador / Courier
        </div>
        <table style="width: 100%; border-collapse: collapse; background: white; border: 1px solid #e5e7eb; border-radius: 4px; overflow: hidden;">
          <thead>
            <tr style="background: #f3f4f6; color: #111827; font-weight: bold; font-size: 0.65rem; text-transform: uppercase; text-align: left;">
              <th style="padding: 0.4rem 0.5rem;">Courier</th>
              <th style="padding: 0.4rem 0.5rem; text-align: right;">Envíos (Cant / %)</th>
              <th style="padding: 0.4rem 0.5rem; text-align: right;">Peso Promedio</th>
              <th style="padding: 0.4rem 0.5rem; text-align: right;">Tarifa Prom. Neto</th>
            </tr>
          </thead>
          <tbody>
            ${courierRows}
          </tbody>
        </table>
      </div>
      
      <!-- Top Destinos -->
      <div>
        <div style="background: #111827; color: white; padding: 0.4rem 0.75rem; font-weight: 700; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; border-radius: 4px; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.35rem;">
          <i class="ri-map-pin-line"></i> Top 5 Comunas con Mayor Frecuencia de Envíos
        </div>
        <table style="width: 100%; border-collapse: collapse; background: white; border: 1px solid #e5e7eb; border-radius: 4px; overflow: hidden;">
          <thead>
            <tr style="background: #f3f4f6; color: #111827; font-weight: bold; font-size: 0.65rem; text-transform: uppercase; text-align: left;">
              <th style="padding: 0.4rem 0.5rem;">Comuna de Destino</th>
              <th style="padding: 0.4rem 0.5rem; text-align: right;">Cantidad de Envíos</th>
              <th style="padding: 0.4rem 0.5rem; text-align: right;">Porcentaje del Total</th>
            </tr>
          </thead>
          <tbody>
            ${destRows}
          </tbody>
        </table>
      </div>
    </div>
  `;
  
  // Generar páginas de detalles para cada comercio
  let pagesHtml = '';
  comerces.forEach((c) => {
    // Tabla de Despachos del comercio
    let detailRows = '';
    c.shipments.forEach((s, idx) => {
      detailRows += `
        <tr style="background: ${idx % 2 === 0 ? 'white' : '#f9fafb'}; font-size: 0.725rem;">
          <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid #e5e7eb; font-weight: 500;">${s.orderId || s.shipmentId || 'N/A'}</td>
          <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid #e5e7eb; font-family: monospace; font-size: 0.7rem;">${idx + 1}</td>
          <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid #e5e7eb; font-family: monospace; font-size: 0.7rem;">${s.tracking || 'N/A'}</td>
          <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid #e5e7eb; text-transform: uppercase; font-size: 0.675rem;"><span style="background: rgba(16, 124, 65, 0.1); color: #10b981; padding: 0.1rem 0.35rem; border-radius: 4px; font-weight: 600;">${s.carrier}</span></td>
          <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid #e5e7eb; color: #4b5563;">${s.status}</td>
          <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid #e5e7eb; color: #4b5563; font-size: 0.675rem;">${s.commune}</td>
          <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid #e5e7eb; text-align: right;">${formatWeight(s.peso)}</td>
          <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600; color: #111827;">${formatCLP(s.neto)}</td>
        </tr>
      `;
    });
    
    pagesHtml += `
      <!-- DETALLE DESPACHOS - ${c.commerce} -->
      <div style="width: 210mm; padding: 15mm; box-sizing: border-box; display: flex; flex-direction: column; justify-content: flex-start; min-height: 297mm; page-break-before: always; position: relative;">
        <div style="background: #5B00E4; color: white; text-align: center; font-weight: bold; padding: 0.5rem; text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.05em; border-radius: 4px; margin-bottom: 0.75rem;">
          Detalle de Despachos: ${c.commerce}
        </div>
        
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 1rem; font-size: 0.725rem;">
          <thead>
            <tr style="background: #00D2C8; color: white; font-weight: bold; text-transform: uppercase; text-align: left;">
              <th style="padding: 0.5rem; font-size: 0.65rem; border-radius: 4px 0 0 4px;">ID Pedido</th>
              <th style="padding: 0.5rem; font-size: 0.65rem;">#</th>
              <th style="padding: 0.5rem; font-size: 0.65rem;">Tracking</th>
              <th style="padding: 0.5rem; font-size: 0.65rem;">Courier</th>
              <th style="padding: 0.5rem; font-size: 0.65rem;">Estado</th>
              <th style="padding: 0.5rem; font-size: 0.65rem;">Destino</th>
              <th style="padding: 0.5rem; font-size: 0.65rem; text-align: right;">Peso (Kg)</th>
              <th style="padding: 0.5rem; font-size: 0.65rem; text-align: right; border-radius: 0 4px 4px 0;">Valor Neto</th>
            </tr>
          </thead>
          <tbody>
            ${detailRows}
          </tbody>
        </table>
      </div>
    `;
    
    // Indemnizaciones del comercio
    if (c.indemnifications && c.indemnifications.length > 0) {
      let indRows = '';
      c.indemnifications.forEach((ind, idx) => {
        indRows += `
          <tr style="background: ${idx % 2 === 0 ? 'white' : '#f9fafb'}; font-size: 0.725rem;">
            <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid #e5e7eb; font-weight: 600;">${ind.pedido || 'N/A'}</td>
            <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid #e5e7eb; text-transform: uppercase; font-size: 0.675rem;"><span style="background: rgba(229, 57, 53, 0.1); color: #e53935; padding: 0.1rem 0.35rem; border-radius: 4px; font-weight: 600;">${ind.operador || 'N/A'}</span></td>
            <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid #e5e7eb; color: #4b5563;">${ind.razon || 'N/A'}</td>
            <td style="padding: 0.4rem 0.5rem; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600; color: #ef4444;">-${formatCLP(ind.monto)}</td>
          </tr>
        `;
      });
      
      pagesHtml += `
        <!-- DETALLE INDEMNIZACIONES - ${c.commerce} -->
        <div style="width: 210mm; padding: 15mm; box-sizing: border-box; display: flex; flex-direction: column; justify-content: flex-start; min-height: 297mm; page-break-before: always; position: relative;">
          <div style="background: #e53935; color: white; text-align: center; font-weight: bold; padding: 0.5rem; text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.05em; border-radius: 4px; margin-bottom: 0.75rem;">
            Descuentos e Indemnizaciones: ${c.commerce}
          </div>
          
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 1rem; font-size: 0.725rem;">
            <thead>
              <tr style="background: #f3f4f6; color: #111827; font-weight: bold; text-transform: uppercase; text-align: left;">
                <th style="padding: 0.5rem; font-size: 0.65rem; border-radius: 4px 0 0 4px;">ID Pedido</th>
                <th style="padding: 0.5rem; font-size: 0.65rem;">Operador / Courier</th>
                <th style="padding: 0.5rem; font-size: 0.65rem;">Razón / Concepto</th>
                <th style="padding: 0.5rem; font-size: 0.65rem; text-align: right; border-radius: 0 4px 4px 0;">Monto Descuento</th>
              </tr>
            </thead>
            <tbody>
              ${indRows}
            </tbody>
          </table>
        </div>
      `;
    }
  });

  return `
    <div style="background: white; color: #333; font-family: 'Outfit', 'Inter', sans-serif;">
      
      <!-- PÁGINA 1: PORTADA / RESUMEN CONSOLIDADO -->
      <div style="width: 210mm; min-height: 297mm; padding: 15mm; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; page-break-after: always; position: relative;">
        <div>
          <!-- Cabecera / Logos e Info -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem;">
            <div style="display: flex; align-items: center;">
              <img src="data:image/png;base64,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" style="height: 52px; width: auto; display: block;" alt="Stocka Logo">
            </div>
            
            <div style="text-align: right; font-size: 0.8rem; color: #4b5563; line-height: 1.5;">
              <div style="font-weight: 800; color: #111827; font-size: 1.15rem; margin-bottom: 0.25rem; letter-spacing: -0.01em;">Detalle de Cobros Consolidado</div>
              <div>Fecha Emisión: <strong style="color: #111827;">${emissionFormatted}</strong></div>
              <div>Plazo de Pago: <strong style="color: #5B00E4; font-weight: 700;">${deadlineFormatted}</strong></div>
            </div>
          </div>
          
          <!-- Bloque de Razón Social / Direcciones -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem; font-size: 0.8rem;">
            <div style="border: 1px solid #e5e7eb; border-radius: 8px; background: #fafafa; padding: 0.85rem; line-height: 1.5; color: #4b5563;">
              <div style="font-weight: 800; color: #5B00E4; font-size: 0.8rem; margin-bottom: 0.35rem; text-transform: uppercase; letter-spacing: 0.08em;">EMISOR</div>
              <strong style="color: #111827; font-size: 0.9rem;">STOCKA SPA</strong><br>
              <strong>RUT: 77.524.557-3</strong><br>
              Almacenamiento y Fulfillment<br>
              Campo de Deportes 405, Ñuñoa<br>
              <span style="color: #5B00E4; font-weight: 600;">www.stocka.cl</span>
            </div>
            
            <div style="border: 1px solid #e5e7eb; border-radius: 8px; background: #fafafa; padding: 0.85rem; line-height: 1.5; color: #4b5563;">
              <div style="font-weight: 800; color: #00D2C8; font-size: 0.8rem; margin-bottom: 0.35rem; text-transform: uppercase; letter-spacing: 0.08em;">CLIENTE / FACTURACIÓN</div>
              <strong style="color: #111827; font-size: 0.9rem;">${groupRazonSocial}</strong><br>
              <strong>RUT: ${groupRut}</strong><br>
              Dirección comercial asociada al holding
            </div>
          </div>
          
          <div style="background: #00D2C8; color: white; font-weight: 800; padding: 0.6rem 1rem; font-size: 0.85rem; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; letter-spacing: 0.05em;">
            <span>CONGLOMERADO:</span>
            <span style="font-size: 1.1rem; text-transform: uppercase; font-weight: 900; letter-spacing: 0.02em;">${groupName}</span>
          </div>

          <!-- Resumen por Comercio -->
          <div style="margin-bottom: 1rem;">
            <div style="font-weight: 700; color: #111827; font-size: 0.75rem; margin-bottom: 0.35rem; text-transform: uppercase; letter-spacing: 0.05em;">Desglose por Comercio</div>
            <table style="width: 100%; border-collapse: collapse; font-size: 0.725rem; border: 1px solid #e5e7eb; border-radius: 4px; overflow: hidden; background: white;">
              <thead>
                <tr style="background: #f3f4f6; color: #111827; font-weight: bold; text-align: left; font-size: 0.65rem; text-transform: uppercase;">
                  <th style="padding: 0.4rem 0.6rem;">Comercio</th>
                  <th style="padding: 0.4rem 0.6rem; text-align: right;">Cantidad</th>
                  <th style="padding: 0.4rem 0.6rem; text-align: right;">Costo Neto</th>
                  <th style="padding: 0.4rem 0.6rem; text-align: right;">Descuentos</th>
                  <th style="padding: 0.4rem 0.6rem; text-align: right;">Total a Pagar</th>
                </tr>
              </thead>
              <tbody>
                ${comerces.map(c => `
                  <tr style="border-bottom: 1px solid #e5e7eb;">
                    <td style="padding: 0.4rem 0.6rem; font-weight: 600; color: #4b5563;">${c.commerce}</td>
                    <td style="padding: 0.4rem 0.6rem; text-align: right; font-weight: 500;">${c.totals.quantity}</td>
                    <td style="padding: 0.4rem 0.6rem; text-align: right; font-weight: 500;">${formatCLP(c.totals.net)}</td>
                    <td style="padding: 0.4rem 0.6rem; text-align: right; color: #ef4444;">-${formatCLP(c.totals.indemnizaciones)}</td>
                    <td style="padding: 0.4rem 0.6rem; text-align: right; font-weight: 700; color: #5B00E4;">${formatCLP(c.totals.totalAPagar)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          
          <!-- Tabla de Resumen Premium -->
          <div style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.02); margin-bottom: 1rem;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.825rem;">
              <tbody>
                <tr style="border-bottom: 1px solid #f3f4f6;">
                  <td style="padding: 0.6rem 0.75rem; font-weight: 600; color: #4b5563;">Periodo de facturación</td>
                  <td style="padding: 0.6rem 0.75rem; text-align: right; font-weight: 700; color: #111827;">${periodName}</td>
                </tr>
                <tr style="background: #f9fafb; border-bottom: 1px solid #f3f4f6;">
                  <td style="padding: 0.6rem 0.75rem; font-weight: 600; color: #4b5563;">Cantidad consolidada de despachos</td>
                  <td style="padding: 0.6rem 0.75rem; text-align: right; font-weight: 700; color: #111827;">${totalQty}</td>
                </tr>
                <tr style="border-bottom: 1px solid #f3f4f6;">
                  <td style="padding: 0.6rem 0.75rem; font-weight: 600; color: #4b5563;">Costo Neto consolidado</td>
                  <td style="padding: 0.6rem 0.75rem; text-align: right; font-weight: 700; color: #111827;">${formatCLP(totalNet)}</td>
                </tr>
                <tr style="background: #f9fafb; border-bottom: 1px solid #f3f4f6;">
                  <td style="padding: 0.6rem 0.75rem; font-weight: 600; color: #4b5563;">IVA consolidado (19%)</td>
                  <td style="padding: 0.6rem 0.75rem; text-align: right; font-weight: 700; color: #111827;">${formatCLP(totalIva)}</td>
                </tr>
                <tr style="border-bottom: 1px solid #f3f4f6; background: rgba(0, 210, 200, 0.03);">
                  <td style="padding: 0.6rem 0.75rem; font-weight: 700; color: #00A69E;">TOTAL CONSOLIDADO A FACTURAR</td>
                  <td style="padding: 0.6rem 0.75rem; text-align: right; font-weight: 800; color: #111827;">${formatCLP(totalFactura)}</td>
                </tr>
                <tr style="background: #fff; border-bottom: none;">
                  <td style="padding: 0.6rem 0.75rem; font-weight: 600; color: #4b5563;">DESCUENTOS - INDEMNIZACIONES CONSOLIDADAS</td>
                  <td style="padding: 0.6rem 0.75rem; text-align: right; font-weight: 700; color: #ef4444;">-${formatCLP(totalIndemnizaciones)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Banner de Destacado de Pago Final -->
          <div style="background: linear-gradient(135deg, #5B00E4, #7c22e4); color: white; border-radius: 8px; padding: 1rem; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 10px rgba(91, 0, 228, 0.12); margin-bottom: 1rem;">
            <div>
              <span style="font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.85;">Total Neto a Cobrar</span>
              <div style="font-size: 0.85rem; font-weight: 600; margin-top: 0.15rem; opacity: 0.9;">
                Neto: ${formatCLP(totalAPagar ? Math.round(totalAPagar / 1.19) : 0)} + IVA: ${formatCLP(totalAPagar ? Math.round(totalAPagar - (totalAPagar / 1.19)) : 0)}
              </div>
            </div>
            <div style="text-align: right;">
              <span style="font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.85;">Monto Total Consolidado a Pagar</span>
              <div style="font-size: 1.65rem; font-weight: 900; margin-top: 0.1rem; font-family: 'Outfit', sans-serif; letter-spacing: -0.01em;">${formatCLP(totalAPagar)}</div>
            </div>
          </div>
        </div>
        
        <div>
          <div style="background: #111827; color: white; text-align: center; font-weight: bold; padding: 0.45rem; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.08em; border-radius: 4px 4px 0 0;">
            Instrucciones de Pago
          </div>
          <div style="border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 6px 6px; padding: 0.75rem; background: #fafafa; font-size: 0.725rem; line-height: 1.45; color: #4b5563;">
            <p style="margin: 0 0 0.5rem 0; font-weight: 500;">
              El detalle presentado cuenta, desde la fecha de entrega, con un <strong>plazo de 3 días hábiles para su pago</strong> a Stocka SpA. El no pago de este detalle puede implicar una pausa en el servicio de Fulfillment a su comercio, con la consecuente paralización de despachos de paquetería procesada Stocka.
            </p>
            <p style="margin: 0 0 0.5rem 0; font-weight: 600; color: #111827;">
              Agradecemos realizar el pago del servicio a la siguiente cuenta bancaria:
            </p>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; background: white; border: 1px solid #e5e7eb; padding: 0.45rem 0.6rem; border-radius: 4px;">
              <div>Razón Social: <strong style="color:#111827;">STOCKA SPA</strong></div>
              <div>RUT: <strong style="color:#111827;">77.524.557-3</strong></div>
              <div>Banco: <strong style="color:#111827;">Scotiabank</strong></div>
              <div>Tipo Cuenta: <strong style="color:#111827;">Corriente</strong></div>
              <div>N° Cuenta: <strong style="color:#111827;">992369965</strong></div>
              <div>Correo: <strong style="color:#5B00E4; font-weight:700;">finanzas@stocka.cl</strong></div>
            </div>
          </div>
        </div>
      </div>
      
      ${statsPage}
      ${comparisonPage}
      
      <!-- DETALLES DETALLADOS POR COMERCIO -->
      ${pagesHtml}
    </div>
  `;
};

window.previewEnviameGroupBreakdownPDF = function(groupName, periodId) {
  const emissionDate = document.getElementById('importer-fecha-emision').value;
  const deadlineDate = document.getElementById('importer-fecha-limite').value;
  const periodName = document.querySelector('#modal-enviame-importer h3').textContent.split('- Periodo: ')[1]?.trim() || '';
  
  // Encontrar todos los comercios del grupo
  const groupComerces = window.importerParsedData.filter(c => c.billingGroup === groupName);
  if (groupComerces.length === 0) return;
  
  let modal = document.getElementById('modal-enviame-preview');
  if (modal) modal.remove();
  
  modal = document.createElement('div');
  modal.id = 'modal-enviame-preview';
  modal.className = 'modal-overlay active';
  modal.style.zIndex = '11000';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.background = 'rgba(0, 0, 0, 0.6)';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100vw';
  modal.style.height = '100vh';
  
  const pdfHtml = window.renderEnviameGroupBreakdownHtml(
    groupName,
    groupComerces,
    emissionDate,
    deadlineDate,
    periodName
  );
  
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 950px; width: 95%; height: 90vh; background: var(--color-surface); border-radius: var(--radius-lg); padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; box-shadow: var(--shadow-lg); border: 1px solid var(--color-border);">
      
      <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--color-border); padding-bottom: 0.5rem;">
        <h3 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main); font-weight: 700;">
          <i class="ri-government-line" style="color: #5B00E4; margin-right: 0.25rem;"></i>
          Vista Previa Desglose Consolidado - ${groupName}
        </h3>
        <button onclick="document.getElementById('modal-enviame-preview').remove()" class="btn-close" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--color-text-muted); padding: 0.2rem;"><i class="ri-close-line"></i></button>
      </div>
      
      <div style="flex-grow: 1; overflow-y: auto; background: var(--color-bg); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); text-align: center;">
        <div id="pdf-visual-container" style="display: inline-block; transform-origin: top center; transform: scale(0.95); margin-bottom: 2rem;">
          ${pdfHtml}
        </div>
      </div>
      
      <div style="display: flex; justify-content: flex-end; gap: 0.5rem; border-top: 1px solid var(--color-border); padding-top: 0.75rem;">
        <button onclick="document.getElementById('modal-enviame-preview').remove()" class="btn btn-outline">Cerrar Vista Previa</button>
        <button onclick="window.downloadTestGroupPDF('${groupName}')" class="btn btn-primary" style="background: #5B00E4; border-color: #5B00E4;"><i class="ri-download-2-line"></i> Descargar PDF Consolidado de Prueba</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Draw the comparative charts inside the preview modal
  const totalNet = groupComerces.reduce((sum, c) => sum + c.totals.net, 0);
  const allShipments = groupComerces.reduce((acc, c) => acc.concat(c.shipments), []);
  const stats = window.calculateEnviameStatistics(allShipments, totalNet);
  
  loadEnviameAnalyticsChartJS().then(() => {
    window.drawEnviamePDFCharts(modal, groupName, periodName, { quantity: allShipments.length, net: totalNet, billingGroup: groupName }, stats);
  });
};

window.downloadTestGroupPDF = function(groupName) {
  const container = document.querySelector('#pdf-visual-container');
  if (!container) return;
  const periodName = document.querySelector('#modal-enviame-importer h3').textContent.split('- Periodo: ')[1]?.trim() || '';
  
  const opt = {
    margin:       0,
    filename:     `prueba_desglose_consolidado_enviame_${groupName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${periodName}.pdf`,
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { scale: 2, useCORS: true, scrollY: 0, scrollX: 0 },
    jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
  };
  
  Swal.fire({
    title: 'Generando PDF Consolidado',
    text: 'Compilando e iniciando descarga local...',
    allowOutsideClick: false,
    didOpen: () => {
      Swal.showLoading();
    }
  });
  
  html2pdf().from(container).set(opt).save().then(() => {
    Swal.close();
  }).catch(err => {
    console.error(err);
    Swal.fire({
      icon: 'error',
      title: 'Error al generar PDF',
      text: err.message
    });
  });
};

// --- CÁLCULO DE ESTADÍSTICAS DE ENVÍOS PARA EL PERIODO ---
window.calculateEnviameStatistics = function(shipments, totalNet) {
  if (!shipments || shipments.length === 0) {
    return {
      avgWeight: 0,
      avgRate: 0,
      couriers: [],
      destinations: [],
      preferredCourier: 'N/A'
    };
  }
  
  const totalWeight = shipments.reduce((sum, s) => sum + (s.peso || 0), 0);
  const avgWeight = totalWeight / shipments.length;
  const avgRate = totalNet / shipments.length;
  
  // Agrupamiento por Courier
  const courierGroups = {};
  shipments.forEach(s => {
    const carrier = s.carrier || 'Desconocido';
    if (!courierGroups[carrier]) {
      courierGroups[carrier] = { name: carrier, count: 0, totalWeight: 0, totalNet: 0 };
    }
    courierGroups[carrier].count++;
    courierGroups[carrier].totalWeight += (s.peso || 0);
    courierGroups[carrier].totalNet += (s.neto || 0);
  });
  
  const couriers = Object.values(courierGroups).map(c => ({
    name: c.name,
    count: c.count,
    percentage: ((c.count / shipments.length) * 100).toFixed(1),
    avgWeight: c.totalWeight / c.count,
    avgRate: c.totalNet / c.count
  })).sort((a, b) => b.count - a.count);
  
  const preferredCourier = couriers[0] ? couriers[0].name : 'N/A';
  
  // Agrupamiento por comuna
  const destGroups = {};
  shipments.forEach(s => {
    const commune = s.commune || 'Sin especificar';
    if (!destGroups[commune]) {
      destGroups[commune] = 0;
    }
    destGroups[commune]++;
  });
  
  const destinations = Object.entries(destGroups).map(([name, count]) => ({
    name,
    count,
    percentage: ((count / shipments.length) * 100).toFixed(1)
  })).sort((a, b) => b.count - a.count).slice(0, 5);
  
  return {
    avgWeight,
    avgRate,
    couriers,
    destinations,
    preferredCourier
  };
};

// --- RENDERIZADO DE GRÁFICOS EN PDF ---
window.drawEnviamePDFCharts = function(container, commerceName, currentPeriodName, currentTotals, currentStats) {
  const historyKey = (currentTotals && currentTotals.billingGroup) ? currentTotals.billingGroup : commerceName;
  const trendsCanvas = container.querySelector('#pdf-chart-trends-' + historyKey.replace(/\s+/g, '-'));
  const averagesCanvas = container.querySelector('#pdf-chart-averages-' + historyKey.replace(/\s+/g, '-'));
  if (!trendsCanvas && !averagesCanvas) return;
  
  // Resolve current period key
  const monthMapping = {
    'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04', 'mayo': '05', 'junio': '06',
    'julio': '07', 'agosto': '08', 'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
  };
  const parts = (currentPeriodName || '').split(' ');
  const spanishMonth = parts[0] ? parts[0].toLowerCase() : '';
  const year = parts[1] || '';
  const monthNum = monthMapping[spanishMonth];
  const currentKey = monthNum && year ? `${year}-${monthNum}` : null;
  
  let history = window.commerceHistoricalEnviameData ? window.commerceHistoricalEnviameData[historyKey] : null;
  if (!history) history = [];
  
  // Clone history and insert current period if not already present
  let chartData = [...history];
  const hasCurrent = chartData.some(h => h.periodKey === currentKey);
  if (!hasCurrent && currentKey) {
    chartData.push({
      periodKey: currentKey,
      periodLabel: currentPeriodName,
      totalShipments: currentTotals.quantity,
      totalNet: currentTotals.net,
      avgWeight: currentStats.avgWeight,
      avgRate: currentStats.avgRate
    });
  }
  
  // Sort chronologically and take last 12 months
  chartData.sort((a, b) => a.periodKey.localeCompare(b.periodKey));
  if (chartData.length > 12) {
    chartData = chartData.slice(chartData.length - 12);
  }
  
  const labels = chartData.map(h => h.periodLabel);
  
  if (trendsCanvas) {
    const shipmentCounts = chartData.map(h => h.totalShipments);
    const netAmounts = chartData.map(h => h.totalNet);
    
    new Chart(trendsCanvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Cantidad de Envíos',
            data: shipmentCounts,
            backgroundColor: 'rgba(91, 0, 228, 0.75)',
            borderColor: 'rgba(91, 0, 228, 1)',
            borderWidth: 1,
            yAxisID: 'y-shipments',
            order: 2
          },
          {
            label: 'Facturación Neta ($)',
            data: netAmounts,
            type: 'line',
            fill: false,
            borderColor: '#00D2C8',
            borderWidth: 2.5,
            pointBackgroundColor: '#00D2C8',
            pointRadius: 3,
            tension: 0.25,
            yAxisID: 'y-net',
            order: 1
          }
        ]
      },
      options: {
        animation: false,
        responsive: false,
        width: 600,
        height: 180,
        plugins: {
          legend: {
            position: 'top',
            labels: {
              boxWidth: 10,
              padding: 8,
              font: { size: 9, weight: '600' }
            }
          }
        },
        scales: {
          'y-shipments': {
            type: 'linear',
            position: 'left',
            ticks: { font: { size: 8 } }
          },
          'y-net': {
            type: 'linear',
            position: 'right',
            ticks: {
              font: { size: 8 },
              callback: function(value) {
                return '$' + (value / 1000) + 'K';
              }
            },
            grid: { drawOnChartArea: false }
          },
          x: {
            ticks: { font: { size: 7.5 } }
          }
        }
      }
    });
  }
  
  if (averagesCanvas) {
    const avgWeights = chartData.map(h => h.avgWeight);
    const avgRates = chartData.map(h => h.avgRate);
    
    new Chart(averagesCanvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Tarifa Prom. Neto ($)',
            data: avgRates,
            borderColor: '#9c27b0',
            backgroundColor: '#9c27b0',
            borderWidth: 2.5,
            pointBackgroundColor: '#9c27b0',
            pointRadius: 3,
            tension: 0.25,
            yAxisID: 'y-rate'
          },
          {
            label: 'Peso Promedio (Kg)',
            data: avgWeights,
            borderColor: '#10b981',
            backgroundColor: '#10b981',
            borderWidth: 2.5,
            pointBackgroundColor: '#10b981',
            pointRadius: 3,
            tension: 0.25,
            yAxisID: 'y-weight'
          }
        ]
      },
      options: {
        animation: false,
        responsive: false,
        width: 600,
        height: 180,
        plugins: {
          legend: {
            position: 'top',
            labels: {
              boxWidth: 10,
              padding: 8,
              font: { size: 9, weight: '600' }
            }
          }
        },
        scales: {
          'y-rate': {
            type: 'linear',
            position: 'left',
            ticks: {
              font: { size: 8 },
              callback: function(value) {
                return '$' + value.toLocaleString('es-CL');
              }
            }
          },
          'y-weight': {
            type: 'linear',
            position: 'right',
            ticks: {
              font: { size: 8 },
              callback: function(value) {
                return value.toFixed(1) + ' Kg';
              }
            },
            grid: { drawOnChartArea: false }
          },
          x: {
            ticks: { font: { size: 7.5 } }
          }
        }
      }
    });
  }
};

// --- FUNCIÓN PARA FUSIONAR ESTADÍSTICAS DEL CLOUD ---
window.mergeConfirmedPeriodStats = function(periodStats) {
  if (!periodStats) return;
  const { periodKey, periodLabel, global, byCommerce } = periodStats;
  if (!periodKey) return;
  
  // 1. Integrar al histórico global
  if (global) {
    window.historicalEnviameData = (window.historicalEnviameData || []).filter(h => h.periodKey !== periodKey);
    window.historicalEnviameData.push(global);
    window.historicalEnviameData.sort((a, b) => a.periodKey.localeCompare(b.periodKey));
  }
  
  // 2. Integrar al histórico por comercio
  if (byCommerce) {
    if (!window.commerceHistoricalEnviameData) {
      window.commerceHistoricalEnviameData = {};
    }
    Object.entries(byCommerce).forEach(([commerceName, commerceStats]) => {
      if (!window.commerceHistoricalEnviameData[commerceName]) {
        window.commerceHistoricalEnviameData[commerceName] = [];
      }
      window.commerceHistoricalEnviameData[commerceName] = window.commerceHistoricalEnviameData[commerceName].filter(h => h.periodKey !== periodKey);
      window.commerceHistoricalEnviameData[commerceName].push(commerceStats);
      window.commerceHistoricalEnviameData[commerceName].sort((a, b) => a.periodKey.localeCompare(b.periodKey));
    });
  }
};

// --- ANALÍTICAS HISTÓRICAS DE ENVÍAME ---
let trendsChartInstance = null;
let averagesChartInstance = null;
let couriersChartInstance = null;

function loadEnviameAnalyticsChartJS() {
  return new Promise((resolve) => {
    if (window.Chart) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
    script.onload = () => resolve();
    document.head.appendChild(script);
  });
}

function calculateMoM(currentVal, previousVal, type) {
  if (previousVal === undefined || previousVal === null || previousVal === 0) {
    return `<span style="font-size: 0.75rem; color: var(--color-text-muted); font-weight: 500;">Sin comparativa</span>`;
  }
  const diff = currentVal - previousVal;
  const pct = ((diff / previousVal) * 100).toFixed(1);
  
  let isPositiveBetter = true;
  if (type === 'cost' || type === 'weight' || type === 'rate') {
    isPositiveBetter = false; // drop is green, rise is red
  }
  
  const pctNum = parseFloat(pct);
  if (pctNum === 0) {
    return `<span style="font-size: 0.75rem; color: var(--color-text-muted); font-weight: 600;"><i class="ri-arrow-right-line"></i> 0% vs mes ant.</span>`;
  } else if (pctNum > 0) {
    const color = isPositiveBetter ? '#10b981' : '#ef4444';
    const icon = '<i class="ri-arrow-up-line"></i>';
    return `<span style="font-size: 0.75rem; color: ${color}; font-weight: 600; display: inline-flex; align-items: center; gap: 0.15rem;">${icon} +${pct}% vs mes ant.</span>`;
  } else {
    const color = isPositiveBetter ? '#ef4444' : '#10b981';
    const icon = '<i class="ri-arrow-down-line"></i>';
    return `<span style="font-size: 0.75rem; color: ${color}; font-weight: 600; display: inline-flex; align-items: center; gap: 0.15rem;">${icon} ${pct}% vs mes ant.</span>`;
  }
}

window.renderEnviameAnalytics = async function() {
  const appContent = document.getElementById('app-content');
  if (!appContent) return;
  
  appContent.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 5rem; gap: 1rem;">
      <div style="width: 2.5rem; height: 2.5rem; border: 4px solid var(--color-border); border-top-color: var(--color-primary); border-radius: 50%; animation: spin 1s linear infinite;"></div>
      <span style="font-size: 0.85rem; color: var(--color-text-muted); font-weight: 500;">Cargando analíticas históricas de Envíame...</span>
      <style>
        @keyframes spin { to { transform: rotate(360deg); } }
      </style>
    </div>
  `;
  
  try {
    const res = await fetch('js/historical_enviame_data.json');
    if (!res.ok) throw new Error("No se pudo cargar la base de datos de analíticas.");
    const data = await res.json();
    
    if (!data || (!data.global && !Array.isArray(data))) {
      appContent.innerHTML = `
        <div style="padding: 2rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); text-align: center; max-width: 500px; margin: 3rem auto;">
          <i class="ri-alert-line" style="font-size: 2.5rem; color: #ff9800; display: block; margin-bottom: 1rem;"></i>
          <h4 style="margin: 0 0 0.5rem 0; font-size: 1.1rem; color: var(--color-text-main);">Sin Datos Históricos</h4>
          <p style="font-size: 0.85rem; color: var(--color-text-muted); line-height: 1.4; margin: 0 0 1.25rem 0;">No se han encontrado registros en el historial de analíticas de Envíame. Por favor, asegúrate de colocar las planillas mensuales en la carpeta <code>historico enviame</code>.</p>
        </div>
      `;
      return;
    }
    
    window.historicalEnviameData = data.global || data;
    window.commerceHistoricalEnviameData = data.byCommerce || {};
    
    // Load confirmed stats from the cloud (Supabase Storage)
    try {
      const { data: records, error } = await supabase
        .from('billing_records')
        .select('period_id');
      if (!error && records && records.length > 0) {
        const uniquePeriodIds = [...new Set(records.map(r => r.period_id))];
        const fetchPromises = uniquePeriodIds.map(async (pId) => {
          try {
            const storagePath = `billing_files/${pId}_enviame_confirmed_stats.json`;
            const { data: statsBlob, error: downloadErr } = await supabase.storage
              .from('payment_receipts')
              .download(storagePath);
            if (!downloadErr && statsBlob) {
              const text = await statsBlob.text();
              const periodStats = JSON.parse(text);
              window.mergeConfirmedPeriodStats(periodStats);
            }
          } catch (e) {
            // Ignore individual fetch errors
          }
        });
        await Promise.all(fetchPromises);
      }
    } catch (err) {
      console.warn("Could not load cloud confirmed stats:", err);
    }
    
    await renderAnalyticsDashboardUI();
    
  } catch (err) {
    console.error(err);
    appContent.innerHTML = `
      <div style="padding: 2rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); text-align: center; max-width: 550px; margin: 3rem auto;">
        <i class="ri-error-warning-line" style="font-size: 2.5rem; color: #ef4444; display: block; margin-bottom: 1rem;"></i>
        <h4 style="margin: 0 0 0.5rem 0; font-size: 1.1rem; color: var(--color-text-main);">Error al cargar Analíticas</h4>
        <p style="font-size: 0.85rem; color: var(--color-text-muted); line-height: 1.4; margin: 0 0 1.25rem 0;">${err.message}</p>
        <p style="font-size: 0.75rem; color: var(--color-text-muted);">
          Asegúrate de ejecutar primero el script compilador desde tu consola:<br>
          <code style="background: rgba(0,0,0,0.05); padding: 0.15rem 0.35rem; border-radius: 4px; display: inline-block; margin-top: 0.25rem; font-family: monospace;">node scripts/compile_enviame_history.js</code>
        </p>
      </div>
    `;
  }
};

async function renderAnalyticsDashboardUI() {
  const appContent = document.getElementById('app-content');
  const data = window.historicalEnviameData;
  
  // Build Period Options
  const periodOptionsHtml = data.map((h, idx) => {
    const isSelected = idx === data.length - 1 ? 'selected' : '';
    return `<option value="${h.periodKey}" ${isSelected}>${h.periodLabel}</option>`;
  }).join('');
  
  appContent.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 1.5rem;">
      <!-- Selector y Resumen General -->
      <div style="background: var(--color-surface); border: 1px solid var(--color-border); padding: 1.25rem; border-radius: var(--radius-md); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
        <div>
          <h4 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main); font-weight: 700;">Visualizador de Métricas Históricas</h4>
          <p style="margin: 0.25rem 0 0 0; font-size: 0.8rem; color: var(--color-text-muted);">Selecciona un periodo mensual para analizar sus métricas y compararlo con el mes previo.</p>
        </div>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <label for="analytics-period-select" style="font-size: 0.8rem; font-weight: 600; color: var(--color-text-muted); margin: 0;">Periodo:</label>
          <select id="analytics-period-select" class="form-control" style="width: 220px; display: inline-block; padding: 0.4rem 0.5rem; border-radius: 6px; border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main); font-size: 0.85rem; font-weight: 600;" onchange="window.updateEnviameAnalyticsPeriod()">
          </select>
        </div>
      </div>
      
      <!-- Grid de Tarjetas KPI -->
      <div class="analytics-kpi-grid" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 1.25rem; flex-wrap: wrap;">
      </div>
      
      <!-- Fila de Gráficos -->
      <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 1.5rem; flex-wrap: wrap;">
        <!-- Gráficos de tendencias (Línea de envíos y barra de montos) -->
        <div style="background: var(--color-surface); border: 1px solid var(--color-border); padding: 1.25rem; border-radius: var(--radius-md); box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
          <h5 style="margin: 0 0 1rem 0; font-size: 0.9rem; font-weight: 700; color: var(--color-text-main); display: flex; align-items: center; gap: 0.35rem;"><i class="ri-line-chart-line" style="color: var(--color-primary);"></i> Evolución de Envíos y Facturación (Últimos 12 Meses)</h5>
          <div style="position: relative; height: 320px;">
            <canvas id="enviame-trends-chart"></canvas>
          </div>
        </div>
        
        <!-- Distribución de Courier -->
        <div style="background: var(--color-surface); border: 1px solid var(--color-border); padding: 1.25rem; border-radius: var(--radius-md); box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
          <h5 style="margin: 0 0 1rem 0; font-size: 0.9rem; font-weight: 700; color: var(--color-text-main); display: flex; align-items: center; gap: 0.35rem;"><i class="ri-pie-chart-line" style="color: #ff9800;"></i> Participación de Courier</h5>
          <div style="position: relative; height: 320px;">
            <canvas id="enviame-couriers-chart"></canvas>
          </div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
        <!-- Gráfico de tarifa promedio y peso promedio -->
        <div style="background: var(--color-surface); border: 1px solid var(--color-border); padding: 1.25rem; border-radius: var(--radius-md); box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
          <h5 style="margin: 0 0 1rem 0; font-size: 0.9rem; font-weight: 700; color: var(--color-text-main); display: flex; align-items: center; gap: 0.35rem;"><i class="ri-scales-3-line" style="color: #10b981;"></i> Evolución de Peso y Tarifa Promedio</h5>
          <div style="position: relative; height: 260px;">
            <canvas id="enviame-averages-chart"></canvas>
          </div>
        </div>
        
        <!-- Tabla del Top 5 Comunas en el periodo seleccionado -->
        <div style="background: var(--color-surface); border: 1px solid var(--color-border); padding: 1.25rem; border-radius: var(--radius-md); display: flex; flex-direction: column; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
          <h5 style="margin: 0 0 0.75rem 0; font-size: 0.9rem; font-weight: 700; color: var(--color-text-main); display: flex; align-items: center; gap: 0.35rem;"><i class="ri-map-pin-line" style="color: #ef4444;"></i> Top Destinos Frecuentes del Periodo</h5>
          <div style="flex-grow: 1; overflow-y: auto; max-height: 260px;">
            <table class="table table-hover" style="width: 100%; font-size: 0.8rem; border-collapse: collapse; margin-bottom: 0;">
              <thead>
                <tr style="border-bottom: 2px solid var(--color-border); text-align: left; font-weight: 700; color: var(--color-text-muted); font-size: 0.75rem;">
                  <th style="padding: 0.5rem; text-transform: uppercase;">Comuna de Destino</th>
                  <th style="padding: 0.5rem; text-align: right; text-transform: uppercase;">Cantidad de Envíos</th>
                  <th style="padding: 0.5rem; text-align: right; text-transform: uppercase;">Porcentaje del Total</th>
                </tr>
              </thead>
              <tbody id="analytics-destinations-tbody">
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
  
  await loadEnviameAnalyticsChartJS();
  
  const periodSelect = document.getElementById('analytics-period-select');
  if (periodSelect) {
    periodSelect.innerHTML = periodOptionsHtml;
  }
  
  buildTrendsChart(data);
  buildAveragesChart(data);
  
  window.updateEnviameAnalyticsPeriod();
}

window.updateEnviameAnalyticsPeriod = function() {
  const periodSelect = document.getElementById('analytics-period-select');
  if (!periodSelect) return;
  const selectedKey = periodSelect.value;
  
  const data = window.historicalEnviameData;
  const idx = data.findIndex(h => h.periodKey === selectedKey);
  if (idx === -1) return;
  
  const current = data[idx];
  const previous = idx > 0 ? data[idx - 1] : null;
  
  // Render KPI cards
  const kpiGrid = document.querySelector('.analytics-kpi-grid');
  if (kpiGrid) {
    kpiGrid.innerHTML = `
      <div style="background: var(--color-surface); border: 1px solid var(--color-border); padding: 1.15rem 1rem; border-radius: var(--radius-md); box-shadow: 0 1px 3px rgba(0,0,0,0.02); display: flex; flex-direction: column; gap: 0.35rem; transition: transform 0.2s; cursor: default;">
        <span style="font-size: 0.65rem; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Total Envíos</span>
        <strong style="font-size: 1.5rem; color: var(--color-text-main); font-weight: 800; line-height: 1.15;">${current.totalShipments.toLocaleString('es-CL')}</strong>
        ${calculateMoM(current.totalShipments, previous ? previous.totalShipments : null, 'shipments')}
      </div>
      
      <div style="background: var(--color-surface); border: 1px solid var(--color-border); padding: 1.15rem 1rem; border-radius: var(--radius-md); box-shadow: 0 1px 3px rgba(0,0,0,0.02); display: flex; flex-direction: column; gap: 0.35rem; transition: transform 0.2s; cursor: default;">
        <span style="font-size: 0.65rem; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Facturación Neta</span>
        <strong style="font-size: 1.5rem; color: var(--color-primary); font-weight: 800; line-height: 1.15;">${formatCLP(current.totalNet)}</strong>
        ${calculateMoM(current.totalNet, previous ? previous.totalNet : null, 'cost')}
      </div>
      
      <div style="background: var(--color-surface); border: 1px solid var(--color-border); padding: 1.15rem 1rem; border-radius: var(--radius-md); box-shadow: 0 1px 3px rgba(0,0,0,0.02); display: flex; flex-direction: column; gap: 0.35rem; transition: transform 0.2s; cursor: default;">
        <span style="font-size: 0.65rem; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Peso Promedio</span>
        <strong style="font-size: 1.5rem; color: #00D2C8; font-weight: 800; line-height: 1.15;">${formatWeight(current.avgWeight)} Kg</strong>
        ${calculateMoM(current.avgWeight, previous ? previous.avgWeight : null, 'weight')}
      </div>
      
      <div style="background: var(--color-surface); border: 1px solid var(--color-border); padding: 1.15rem 1rem; border-radius: var(--radius-md); box-shadow: 0 1px 3px rgba(0,0,0,0.02); display: flex; flex-direction: column; gap: 0.35rem; transition: transform 0.2s; cursor: default;">
        <span style="font-size: 0.65rem; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Tarifa Prom. Neto</span>
        <strong style="font-size: 1.5rem; color: #9c27b0; font-weight: 800; line-height: 1.15;">${formatCLP(Math.round(current.avgRate))}</strong>
        ${calculateMoM(current.avgRate, previous ? previous.avgRate : null, 'rate')}
      </div>
      
      <div style="background: var(--color-surface); border: 1px solid var(--color-border); padding: 1.15rem 1rem; border-radius: var(--radius-md); box-shadow: 0 1px 3px rgba(0,0,0,0.02); display: flex; flex-direction: column; gap: 0.35rem; transition: transform 0.2s; cursor: default;">
        <span style="font-size: 0.65rem; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Courier Preferido</span>
        <strong style="font-size: 1.3rem; color: var(--color-text-main); font-weight: 800; line-height: 1.15; text-transform: uppercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${current.preferredCourier}</strong>
        <span style="font-size: 0.75rem; color: var(--color-text-muted); font-weight: 600;">Participación: ${(current.couriers[0] ? current.couriers[0].percentage : 0)}%</span>
      </div>
    `;
  }
  
  // Render Destinations Table
  const tbody = document.getElementById('analytics-destinations-tbody');
  if (tbody) {
    tbody.innerHTML = current.destinations.slice(0, 5).map(d => `
      <tr style="border-bottom: 1px solid var(--color-border); font-size: 0.8rem;">
        <td style="padding: 0.55rem 0.5rem; color: var(--color-text-main); font-weight: 600; text-transform: uppercase;">${d.name}</td>
        <td style="padding: 0.55rem 0.5rem; text-align: right; color: var(--color-text-main);">${d.count}</td>
        <td style="padding: 0.55rem 0.5rem; text-align: right; color: var(--color-primary); font-weight: 600;">${d.percentage}%</td>
      </tr>
    `).join('');
  }
  
  // Render Courier Pie Chart for the selected month
  updateCouriersChart(current);
};

function buildTrendsChart(data) {
  const ctx = document.getElementById('enviame-trends-chart');
  if (!ctx) return;
  
  if (trendsChartInstance) {
    trendsChartInstance.destroy();
  }
  
  const labels = data.map(h => h.periodLabel);
  const shipmentCounts = data.map(h => h.totalShipments);
  const netAmounts = data.map(h => h.totalNet);
  
  trendsChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Cantidad de Envíos',
          data: shipmentCounts,
          backgroundColor: 'rgba(91, 0, 228, 0.65)',
          borderColor: 'rgba(91, 0, 228, 1)',
          borderWidth: 1,
          yAxisID: 'y-shipments',
          order: 2
        },
        {
          label: 'Facturación Neta ($)',
          data: netAmounts,
          type: 'line',
          fill: false,
          borderColor: '#00D2C8',
          borderWidth: 3,
          pointBackgroundColor: '#00D2C8',
          pointRadius: 4,
          tension: 0.3,
          yAxisID: 'y-net',
          order: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: 'var(--color-text-main)',
            font: { family: 'inherit', size: 11, weight: '600' }
          }
        }
      },
      scales: {
        'y-shipments': {
          type: 'linear',
          position: 'left',
          title: {
            display: true,
            text: 'Cantidad de Envíos',
            color: 'var(--color-text-muted)',
            font: { family: 'inherit', weight: '700' }
          },
          grid: {
            color: 'var(--color-border)'
          },
          ticks: {
            color: 'var(--color-text-muted)'
          }
        },
        'y-net': {
          type: 'linear',
          position: 'right',
          title: {
            display: true,
            text: 'Monto Neto ($)',
            color: 'var(--color-text-muted)',
            font: { family: 'inherit', weight: '700' }
          },
          grid: {
            drawOnChartArea: false
          },
          ticks: {
            color: 'var(--color-text-muted)',
            callback: function(value) {
              return '$' + (value / 1e6).toFixed(1) + 'M';
            }
          }
        },
        x: {
          grid: {
            color: 'var(--color-border)'
          },
          ticks: {
            color: 'var(--color-text-muted)'
          }
        }
      }
    }
  });
}

function buildAveragesChart(data) {
  const ctx = document.getElementById('enviame-averages-chart');
  if (!ctx) return;
  
  if (averagesChartInstance) {
    averagesChartInstance.destroy();
  }
  
  const labels = data.map(h => h.periodLabel);
  const avgWeights = data.map(h => h.avgWeight);
  const avgRates = data.map(h => h.avgRate);
  
  averagesChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Tarifa Prom. Neto ($)',
          data: avgRates,
          borderColor: '#9c27b0',
          backgroundColor: '#9c27b0',
          borderWidth: 2.5,
          pointRadius: 3.5,
          tension: 0.2,
          yAxisID: 'y-rate'
        },
        {
          label: 'Peso Promedio (Kg)',
          data: avgWeights,
          borderColor: '#10b981',
          backgroundColor: '#10b981',
          borderWidth: 2.5,
          pointRadius: 3.5,
          tension: 0.2,
          yAxisID: 'y-weight'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: 'var(--color-text-main)',
            font: { family: 'inherit', size: 11, weight: '600' }
          }
        }
      },
      scales: {
        'y-rate': {
          type: 'linear',
          position: 'left',
          title: {
            display: true,
            text: 'Tarifa Promedio ($)',
            color: 'var(--color-text-muted)',
            font: { family: 'inherit', weight: '700' }
          },
          grid: {
            color: 'var(--color-border)'
          },
          ticks: {
            color: 'var(--color-text-muted)',
            callback: function(value) {
              return '$' + value.toLocaleString('es-CL');
            }
          }
        },
        'y-weight': {
          type: 'linear',
          position: 'right',
          title: {
            display: true,
            text: 'Peso Promedio (Kg)',
            color: 'var(--color-text-muted)',
            font: { family: 'inherit', weight: '700' }
          },
          grid: {
            drawOnChartArea: false
          },
          ticks: {
            color: 'var(--color-text-muted)',
            callback: function(value) {
              return value.toFixed(2) + ' Kg';
            }
          }
        },
        x: {
          grid: {
            color: 'var(--color-border)'
          },
          ticks: {
            color: 'var(--color-text-muted)'
          }
        }
      }
    }
  });
}

function updateCouriersChart(currentPeriod) {
  const ctx = document.getElementById('enviame-couriers-chart');
  if (!ctx) return;
  
  if (couriersChartInstance) {
    couriersChartInstance.destroy();
  }
  
  const couriers = currentPeriod.couriers;
  const labels = couriers.map(c => c.name.toUpperCase());
  const counts = couriers.map(c => c.count);
  
  const colors = [
    '#5B00E4',
    '#00D2C8',
    '#ff9800',
    '#9c27b0',
    '#e51c23',
    '#4caf50',
    '#9e9e9e'
  ];
  
  couriersChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [
        {
          data: counts,
          backgroundColor: colors.slice(0, couriers.length),
          borderWidth: 1.5,
          borderColor: 'var(--color-surface)'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 10,
            padding: 8,
            color: 'var(--color-text-main)',
            font: { family: 'inherit', size: 10, weight: '600' }
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const count = context.raw;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = ((count / total) * 100).toFixed(1);
              return ` ${context.label}: ${count.toLocaleString('es-CL')} (${percentage}%)`;
            }
          }
        }
      },
      cutout: '65%'
    }
  });
}

window.openInteractiveEnviameReportModal = async function(url, name) {
  injectImporterStyles();
  Swal.fire({
    title: 'Cargando Reporte Interactivo',
    text: 'Obteniendo datos de facturación desde la nube...',
    allowOutsideClick: false,
    didOpen: () => {
      Swal.showLoading();
    }
  });

  try {
    let reportData;
    if (url && url.includes('payment_receipts')) {
      const parts = url.split('/payment_receipts/');
      if (parts.length > 1) {
        const storagePath = decodeURIComponent(parts[1].split('?')[0]);
        const { data: fileData, error: downloadErr } = await supabase.storage
          .from('payment_receipts')
          .download(storagePath);
        if (!downloadErr && fileData) {
          const text = await fileData.text();
          reportData = JSON.parse(text);
        }
      }
    }
    
    if (!reportData) {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Error al descargar el archivo de reporte.');
      reportData = await response.json();
    }
    
    Swal.close();

    let pdfHtml = '';
    if (reportData.isGroup) {
      pdfHtml = window.renderEnviameGroupBreakdownHtml(
        reportData.billingGroupName,
        reportData.commerces,
        reportData.emissionDate,
        reportData.deadlineDate,
        reportData.periodName
      );
    } else {
      pdfHtml = window.renderEnviameBreakdownHtml(
        reportData.commerceName,
        reportData.shipments,
        {
          ...reportData.totals,
          rut: reportData.rut || reportData.totals?.rut,
          razon_social: reportData.razon_social || reportData.totals?.razon_social,
          billingGroup: reportData.billingGroup || reportData.totals?.billingGroup,
          indemnifications: reportData.indemnifications || reportData.totals?.indemnifications
        },
        reportData.emissionDate,
        reportData.deadlineDate,
        reportData.periodName
      );
    }

    let modal = document.getElementById('modal-interactive-report');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'modal-interactive-report';
    modal.className = 'modal-overlay active';
    modal.style.zIndex = '11000';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.background = 'rgba(0, 0, 0, 0.6)';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100vw';
    modal.style.height = '100vh';

    const contentName = reportData.isGroup ? reportData.billingGroupName : reportData.commerceName;

    modal.innerHTML = `
      <div class="modal-content" style="max-width: 950px; width: 95%; height: 90vh; background: var(--color-surface); border-radius: var(--radius-lg); padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; box-shadow: var(--shadow-lg); border: 1px solid var(--color-border);">
        
        <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--color-border); padding-bottom: 0.5rem; flex-shrink: 0;">
          <h3 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main); font-weight: 700; display: flex; align-items: center; gap: 0.35rem;">
            <i class="ri-line-chart-line" style="color: #9c27b0;"></i>
            Reporte Interactivo Envíame - ${contentName}
          </h3>
          <button onclick="document.getElementById('modal-interactive-report').remove()" class="btn-close" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--color-text-muted); padding: 0.2rem;"><i class="ri-close-line"></i></button>
        </div>
        
        <div style="flex-grow: 1; overflow-y: auto; background: var(--color-bg); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); text-align: center;">
          <div id="interactive-report-container" style="display: inline-block; width: 100%; max-width: 800px; text-align: left; background: white; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border-radius: 8px; padding: 1.5rem; border: 1px solid #e2e8f0;">
            ${pdfHtml}
          </div>
        </div>
        
        <div style="display: flex; justify-content: flex-end; gap: 0.5rem; border-top: 1px solid var(--color-border); padding-top: 0.75rem; flex-shrink: 0;">
          <button onclick="document.getElementById('modal-interactive-report').remove()" class="btn btn-outline">Cerrar</button>
          <button id="btn-print-interactive-report" class="btn btn-primary" style="background: #9c27b0; border-color: #9c27b0; color: white;"><i class="ri-printer-line"></i> Imprimir Reporte</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Draw the comparative charts inside the modal container
    if (reportData.isGroup) {
      const totalNet = reportData.commerces.reduce((sum, c) => sum + c.totals.net, 0);
      const allShipments = reportData.commerces.reduce((acc, c) => acc.concat(c.shipments), []);
      const stats = reportData.stats || window.calculateEnviameStatistics(allShipments, totalNet);
      
      await loadEnviameAnalyticsChartJS();
      window.drawEnviamePDFCharts(
        modal,
        reportData.billingGroupName,
        reportData.periodName,
        { quantity: allShipments.length, net: totalNet, billingGroup: reportData.billingGroupName },
        stats
      );
    } else {
      await loadEnviameAnalyticsChartJS();
      window.drawEnviamePDFCharts(
        modal,
        reportData.commerceName,
        reportData.periodName,
        {
          ...reportData.totals,
          billingGroup: reportData.billingGroup || reportData.totals?.billingGroup
        },
        reportData.stats
      );
    }

    modal.querySelector('#btn-print-interactive-report').addEventListener('click', () => {
      window.printInteractiveReport();
    });

  } catch (error) {
    console.error(error);
    Swal.fire('Error', 'No se pudo cargar el reporte interactivo.', 'error');
  }
};

window.printInteractiveReport = function() {
  const container = document.getElementById('interactive-report-container');
  if (!container) return;

  const clone = container.cloneNode(true);
  const origCanvases = container.querySelectorAll('canvas');
  const cloneCanvases = clone.querySelectorAll('canvas');
  
  for (let i = 0; i < origCanvases.length; i++) {
    const orig = origCanvases[i];
    const cln = cloneCanvases[i];
    try {
      const img = document.createElement('img');
      img.src = orig.toDataURL('image/png');
      img.style.cssText = orig.style.cssText;
      img.style.width = '100%';
      img.style.height = 'auto';
      img.style.maxHeight = '250px';
      img.style.objectFit = 'contain';
      cln.parentNode.replaceChild(img, cln);
    } catch (e) {
      console.error('Error converting canvas to image:', e);
    }
  }

  const printWindow = window.open('', '_blank', 'width=900,height=800');
  if (!printWindow) {
    Swal.fire('Bloqueador de ventanas', 'Por favor permite las ventanas emergentes para poder imprimir el reporte.', 'warning');
    return;
  }

  let stylesHtml = '';
  document.querySelectorAll('link[rel="stylesheet"], style').forEach(el => {
    stylesHtml += el.outerHTML;
  });

  printWindow.document.write(`
    <html>
      <head>
        <title>Reporte Envíame</title>
        ${stylesHtml}
        <style>
          body {
            background: white !important;
            color: black !important;
            padding: 10mm !important;
            margin: 0 !important;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          }
          #interactive-report-container {
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
            margin: 0 !important;
            width: 100% !important;
            max-width: none !important;
          }
          @page {
            size: A4;
            margin: 10mm;
          }
          @media print {
            body {
              padding: 0 !important;
            }
          }
        </style>
      </head>
      <body>
        <div id="interactive-report-container">
          ${clone.innerHTML}
        </div>
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
              window.close();
            }, 600);
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
};
