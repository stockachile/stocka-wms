import supabase from './supabase.js';

// ==========================================
// HELPERS Y CONSTANTES COMPARTIDAS
// ==========================================

const SEVERITY_LEVELS = {
  'sugerencia': { label: 'Sugerencia', class: 'badge-sev-sugerencia', borderClass: 'border-sev-sugerencia' },
  'bajo': { label: 'Ajuste Bajo', class: 'badge-sev-bajo', borderClass: 'border-sev-bajo' },
  'medio': { label: 'Ajuste Medio', class: 'badge-sev-medio', borderClass: 'border-sev-medio' },
  'alto': { label: 'Ajuste Alto', class: 'badge-sev-alto', borderClass: 'border-sev-alto' },
  'critico': { label: 'Ajuste Crítico', class: 'badge-sev-critico', borderClass: 'border-sev-critico' }
};

const TYPES = {
  'integracion': { label: 'Integración', icon: 'ri-plug-line', class: 'type-integracion' },
  'pedido': { label: 'Problema con Pedido', icon: 'ri-shopping-cart-2-line', class: 'type-pedido' },
  'stock': { label: 'Falta de Stock', icon: 'ri-box-3-line', class: 'type-stock' },
  'otros': { label: 'Configuración / Otros', icon: 'ri-lightbulb-line', class: 'type-otros' }
};

const STATUSES = {
  'pendiente': { label: 'Pendiente', class: 'status-pendiente' },
  'resuelta': { label: 'Resuelta', class: 'status-resuelta' },
  'descartada': { label: 'Descartada', class: 'status-descartada' }
};

// Inyectar estilos CSS necesarios para el módulo
function injectStyles() {
  if (document.getElementById('incidencias-custom-styles')) return;

  const styleEl = document.createElement('style');
  styleEl.id = 'incidencias-custom-styles';
  styleEl.textContent = `
    /* Layout y contenedor principal */
    .incidencias-container {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      animation: fadeIn 0.3s ease-in-out;
    }
    
    /* Filtros y cabecera */
    .incidencias-header-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
      background: var(--color-surface);
      padding: 1.25rem;
      border-radius: var(--radius-md);
      border: 1px solid var(--color-border);
      box-shadow: var(--shadow-sm);
    }
    .incidencias-filters {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .incidencias-filter-select {
      background: var(--color-bg);
      color: var(--color-text-main);
      border: 1px solid var(--color-border);
      padding: 0.5rem 1rem;
      border-radius: var(--radius-sm);
      font-size: 0.85rem;
      outline: none;
      transition: border-color 0.2s;
    }
    .incidencias-filter-select:focus {
      border-color: var(--color-primary);
    }

    /* Listado y Tarjetas de Incidencias */
    .incidencias-list {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }
    .incidencia-card {
      background: var(--color-surface);
      border-radius: var(--radius-md);
      border: 1px solid var(--color-border);
      box-shadow: var(--shadow-sm);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .incidencia-card:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-md);
    }

    /* Bordes de Gravedad */
    .border-sev-sugerencia { border-left: 6px solid var(--color-success); }
    .border-sev-bajo { border-left: 6px solid var(--color-info); }
    .border-sev-medio { border-left: 6px solid var(--color-warning); }
    .border-sev-alto { border-left: 6px solid var(--color-danger); }
    .border-sev-critico { 
      border-left: 6px solid #7f1d1d; 
      box-shadow: 0 0 10px rgba(239, 68, 68, 0.1) inset;
    }

    /* Cabecera Tarjeta */
    .incidencia-card-header {
      padding: 1.25rem;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 1rem;
      border-bottom: 1px solid var(--color-border);
      background: rgba(0, 0, 0, 0.01);
    }
    .incidencia-card-meta {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .incidencia-title-area {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .incidencia-type-icon {
      font-size: 1.5rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: var(--radius-sm);
    }
    .type-integracion { background: rgba(37, 99, 235, 0.12); color: var(--color-primary); }
    .type-pedido { background: rgba(245, 158, 11, 0.12); color: var(--color-warning); }
    .type-stock { background: rgba(239, 68, 68, 0.12); color: var(--color-danger); }
    .type-otros { background: rgba(94, 23, 235, 0.12); color: var(--color-accent); }

    .incidencia-title {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--color-text-main);
    }
    .incidencia-badges {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      flex-wrap: wrap;
      margin-top: 0.25rem;
    }
    .incidencia-status-aside {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 0.5rem;
      font-size: 0.8rem;
    }

    /* Badges */
    .inc-badge {
      padding: 0.25rem 0.6rem;
      border-radius: var(--radius-full);
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    /* Severity Badges */
    .badge-sev-sugerencia { background: rgba(16, 185, 129, 0.12); color: #047857; }
    .badge-sev-bajo { background: rgba(59, 130, 246, 0.12); color: #1d4ed8; }
    .badge-sev-medio { background: rgba(245, 158, 11, 0.12); color: #b45309; }
    .badge-sev-alto { background: rgba(239, 68, 68, 0.12); color: #b91c1c; }
    .badge-sev-critico { 
      background: #7f1d1d; 
      color: #fff; 
      animation: pulseCritico 2s infinite; 
    }

    /* Status Badges */
    .status-pendiente { background: rgba(107, 114, 128, 0.12); color: #4b5563; }
    .status-resuelta { background: rgba(16, 185, 129, 0.15); color: #065f46; border: 1px solid rgba(16, 185, 129, 0.3); }
    .status-descartada { background: rgba(239, 68, 68, 0.15); color: #b91c1c; border: 1px solid rgba(239, 68, 68, 0.3); }

    /* Dias sin resolver alerta */
    .days-alert {
      color: var(--color-danger);
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.85rem;
      background: rgba(239, 68, 68, 0.08);
      padding: 0.25rem 0.5rem;
      border-radius: var(--radius-sm);
    }
    .days-info {
      color: var(--color-text-muted);
      display: flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.85rem;
    }

    /* Cuerpo Tarjeta */
    .incidencia-card-body {
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .incidencia-description-section {
      font-size: 0.95rem;
      color: var(--color-text-main);
      white-space: pre-wrap;
      line-height: 1.6;
    }
    .incidencia-solution-box {
      background: rgba(37, 99, 235, 0.05);
      border: 1px dashed rgba(37, 99, 235, 0.25);
      padding: 1rem;
      border-radius: var(--radius-md);
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .solution-box-title {
      font-weight: 700;
      font-size: 0.9rem;
      color: var(--color-primary);
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }
    .solution-box-content {
      font-size: 0.9rem;
      color: var(--color-text-muted);
      white-space: pre-wrap;
      line-height: 1.5;
    }

    /* Respuesta / Comentario del cliente */
    .incidencia-response-box {
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: 1rem;
      margin-top: 0.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .response-header {
      display: flex;
      justify-content: space-between;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--color-text-muted);
    }
    .response-content {
      font-size: 0.9rem;
      font-style: italic;
      color: var(--color-text-main);
    }

    /* Formulario de Acción para Clientes */
    .action-panel-trigger {
      display: flex;
      gap: 0.75rem;
      margin-top: 0.5rem;
    }
    .client-action-form {
      margin-top: 1rem;
      background: var(--color-bg);
      padding: 1.25rem;
      border-radius: var(--radius-md);
      border: 1px solid var(--color-border);
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      animation: slideDown 0.2s ease-out;
    }
    .action-title {
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--color-text-main);
    }

    /* Animaciones */
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes pulseCritico {
      0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
      70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
      100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
    }

    /* Modal Form Incidencias Admin */
    .modal-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      animation: fadeIn 0.25s ease-out;
    }
    .modal-content-styled {
      background: var(--color-surface);
      border-radius: var(--radius-lg);
      border: 1px solid var(--color-border);
      width: 95%;
      max-width: 650px;
      box-shadow: var(--shadow-lg);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .modal-header-styled {
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid var(--color-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(0, 0, 0, 0.02);
    }
    .modal-body-styled {
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      max-height: 70vh;
      overflow-y: auto;
    }
    .modal-footer-styled {
      padding: 1rem 1.5rem;
      border-top: 1px solid var(--color-border);
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      background: rgba(0, 0, 0, 0.02);
    }
    .form-group-styled {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .form-group-styled label {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--color-text-main);
    }
    .form-input-styled, .form-textarea-styled {
      background: var(--color-bg);
      color: var(--color-text-main);
      border: 1px solid var(--color-border);
      padding: 0.6rem 0.75rem;
      border-radius: var(--radius-sm);
      font-size: 0.9rem;
      outline: none;
      transition: border-color 0.2s;
      width: 100%;
    }
    .form-input-styled:focus, .form-textarea-styled:focus {
      border-color: var(--color-primary);
    }
    .form-grid-styled {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }
    @media (max-width: 600px) {
      .form-grid-styled {
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head.appendChild(styleEl);
}

// Formatear fechas
function formatDate(dateString) {
  if (!dateString) return '—';
  const date = new Date(dateString);
  return date.toLocaleDateString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Calcular días transcurridos
function calculateDaysElapsed(createdDateStr) {
  const createdDate = new Date(createdDateStr);
  const now = new Date();
  
  // Resetear horas para cálculo por días completos
  createdDate.setHours(0,0,0,0);
  now.setHours(0,0,0,0);
  
  const diffTime = Math.abs(now - createdDate);
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

// Escape de HTML
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Renderizar aviso de que falta la tabla en Supabase
function renderMigrationWarning(appContent, isClient = false) {
  const codeSql = `-- WMS STOCKA - Crear Tabla de Incidencias
CREATE TABLE IF NOT EXISTS public.incidencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  resolved_at TIMESTAMP WITH TIME ZONE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  comercio TEXT DEFAULT 'no asignado',
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  solution TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'integracion' CHECK (type IN ('integracion', 'pedido', 'stock', 'otros')),
  severity VARCHAR(50) DEFAULT 'sugerencia' CHECK (severity IN ('sugerencia', 'bajo', 'medio', 'alto', 'critico')),
  status VARCHAR(50) DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'resuelta', 'descartada')),
  comment TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.incidencias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins ven y gestionan todas las incidencias" ON public.incidencias FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);

CREATE POLICY "Clientes ven sus propias incidencias" ON public.incidencias FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Clientes actualizan sus incidencias para responder" ON public.incidencias FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid() AND status IN ('resuelta', 'descartada'));

GRANT ALL ON public.incidencias TO postgres, service_role;
GRANT ALL ON public.incidencias TO anon, authenticated;`;

  appContent.innerHTML = `
    <div class="card" style="max-width: 800px; margin: 2rem auto; padding: 2rem; border-left: 5px solid var(--color-warning);">
      <div style="display: flex; gap: 1rem; align-items: flex-start;">
        <i class="ri-error-warning-line" style="font-size: 2.5rem; color: var(--color-warning);"></i>
        <div>
          <h3 style="margin-top: 0; margin-bottom: 0.5rem; font-size: 1.25rem;">Módulo de Incidencias no inicializado</h3>
          <p style="color: var(--color-text-muted); margin-bottom: 1.5rem; font-size: 0.95rem;">
            La tabla <code>public.incidencias</code> no se encuentra en Supabase. 
            ${isClient 
              ? 'Por favor, ponte en contacto con el administrador del sistema para habilitar este módulo.' 
              : 'Como administrador, puedes copiar el siguiente script SQL y ejecutarlo en el <strong>Editor SQL de Supabase</strong> para habilitarlo:'}
          </p>
          
          ${!isClient ? `
            <pre style="background: var(--color-bg); padding: 1rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); font-size: 0.8rem; overflow: auto; max-height: 250px; font-family: monospace; white-space: pre; margin-bottom: 1.5rem;">${escapeHtml(codeSql)}</pre>
            <button id="btn-copy-migration" class="btn btn-primary">
              <i class="ri-file-copy-line" style="margin-right: 0.25rem;"></i> Copiar Código SQL
            </button>
          ` : ''}
        </div>
      </div>
    </div>
  `;

  if (!isClient) {
    const btn = document.getElementById('btn-copy-migration');
    if (btn) {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(codeSql);
        alert('¡Código de migración copiado al portapapeles!');
      });
    }
  }
}

// ==========================================
// VISTA CLIENTE (DASHBOARD)
// ==========================================

export async function renderIncidenciasClient(appContent) {
  if (!appContent) return;
  injectStyles();

  appContent.innerHTML = `<div style="display: flex; justify-content: center; padding: 3rem;"><i class="ri-loader-4-line ri-spin" style="font-size: 2rem; color: var(--color-primary);"></i></div>`;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    appContent.innerHTML = '<div class="alert alert-error">Sesión no activa. Por favor, inicia sesión.</div>';
    return;
  }

  const userId = session.user.id;
  let incidencias = [];
  let filterStatus = 'todos';
  let filterSeverity = 'todos';
  let userComercio = '';

  // Verificar si la tabla existe intentando consultar una fila
  try {
    const { error: testError } = await supabase.from('incidencias').select('id').limit(1);
    if (testError && (testError.code === '42P01' || testError.message.includes('does not exist'))) {
      renderMigrationWarning(appContent, true);
      return;
    }
  } catch (err) {
    console.error('Error al probar tabla incidencias:', err);
  }

  // Obtener perfil para saber el comercio del usuario
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('comercio')
      .eq('id', userId)
      .single();
    userComercio = profile?.comercio || 'no asignado';
  } catch (err) {
    console.error('Error al obtener perfil en renderIncidenciasClient:', err);
  }

  async function loadIncidencias() {
    try {
      let query = supabase
        .from('incidencias')
        .select('*');

      if (userComercio !== 'all') {
        const commerceList = userComercio.split(',').map(s => s.trim()).filter(Boolean);
        if (commerceList.length > 0) {
          query = query.in('comercio', commerceList);
        } else {
          query = query.eq('comercio', 'no asignado');
        }
      }

      query = query.order('created_at', { ascending: false });

      if (filterStatus !== 'todos') {
        query = query.eq('status', filterStatus);
      }
      if (filterSeverity !== 'todos') {
        query = query.eq('severity', filterSeverity);
      }

      const { data, error } = await query;
      if (error) throw error;
      incidencias = data || [];
      renderList();
    } catch (err) {
      console.error('Error al cargar incidencias del cliente:', err);
      appContent.innerHTML = `<div class="alert alert-error">Error al cargar incidencias: ${err.message}</div>`;
    }
  }

  function renderList() {
    let listHtml = '';
    if (incidencias.length === 0) {
      listHtml = `
        <div class="card" style="text-align: center; padding: 3rem; color: var(--color-text-muted);">
          <i class="ri-checkbox-circle-line" style="font-size: 3rem; color: var(--color-success); margin-bottom: 0.75rem; display: block;"></i>
          <p style="font-size: 1.05rem; font-weight: 500;">¡Todo al día!</p>
          <p style="font-size: 0.85rem; margin-top: 0.25rem;">No se han reportado problemas de integración ni sugerencias en este momento.</p>
        </div>
      `;
    } else {
      listHtml = `
        <div class="incidencias-list">
          ${incidencias.map(inc => {
            const severity = SEVERITY_LEVELS[inc.severity] || { label: inc.severity, class: '', borderClass: '' };
            const type = TYPES[inc.type] || { label: inc.type, icon: 'ri-question-line', class: '' };
            const status = STATUSES[inc.status] || { label: inc.status, class: '' };
            
            const isUnresolved = inc.status === 'pendiente';
            const daysOpen = isUnresolved ? calculateDaysElapsed(inc.created_at) : null;

            return `
              <div class="incidencia-card ${severity.borderClass}">
                <div class="incidencia-card-header">
                  <div class="incidencia-title-area">
                    <div class="incidencia-type-icon ${type.class}">
                      <i class="${type.icon}"></i>
                    </div>
                    <div class="incidencia-card-meta">
                      <div class="incidencia-title">${escapeHtml(inc.title)}</div>
                      <div class="incidencia-badges">
                        <span class="inc-badge ${severity.class}">${severity.label}</span>
                        <span class="inc-badge ${type.class}">${type.label}</span>
                        <span class="inc-badge ${status.class}">${status.label}</span>
                      </div>
                    </div>
                  </div>
                  <div class="incidencia-status-aside">
                    ${isUnresolved 
                      ? (daysOpen > 0 
                        ? `<span class="days-alert"><i class="ri-time-line"></i> ${daysOpen} ${daysOpen === 1 ? 'día' : 'días'} sin resolver</span>` 
                        : `<span class="days-info"><i class="ri-time-line"></i> Reportado hoy</span>`) 
                      : `<span class="days-info" style="color: var(--color-success);"><i class="ri-checkbox-circle-line"></i> Resuelta</span>`
                    }
                    <span style="color: var(--color-text-muted); font-size: 0.8rem;">Creado: ${formatDate(inc.created_at)}</span>
                  </div>
                </div>
                
                <div class="incidencia-card-body">
                  <div class="incidencia-description-section">
                    <strong>Descripción del problema:</strong>
                    <div style="margin-top: 0.25rem; color: var(--color-text-muted);">${escapeHtml(inc.description).replace(/\n/g, '<br>')}</div>
                  </div>
                  
                  <div class="incidencia-solution-box">
                    <div class="solution-box-title">
                      <i class="ri-lightbulb-flash-line"></i>
                      <span>🔧 Cómo Solucionar:</span>
                    </div>
                    <div class="solution-box-content">${escapeHtml(inc.solution).replace(/\n/g, '<br>')}</div>
                  </div>

                  ${inc.status !== 'pendiente' ? `
                    <div class="incidencia-response-box">
                      <div class="response-header">
                        <span>Respuesta del Cliente (${formatDate(inc.resolved_at)})</span>
                        <span style="text-transform: uppercase;">Marcado como: ${inc.status}</span>
                      </div>
                      <div class="response-content">
                        ${inc.comment ? escapeHtml(inc.comment).replace(/\n/g, '<br>') : 'Sin comentarios adicionales.'}
                      </div>
                    </div>
                  ` : `
                    <div id="action-panel-${inc.id}" style="margin-top: 0.5rem;">
                      <div class="action-panel-trigger">
                        <button class="btn btn-primary btn-resolve-trigger" data-id="${inc.id}" style="background: var(--color-success); border-color: var(--color-success); color: #fff;">
                          <i class="ri-checkbox-circle-line"></i> Marcar como Resuelta
                        </button>
                        <button class="btn btn-outline btn-discard-trigger" data-id="${inc.id}">
                          <i class="ri-close-circle-line"></i> Descartar / Rechazar
                        </button>
                      </div>
                    </div>
                  `}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    appContent.innerHTML = `
      <div class="incidencias-container">
        <div class="incidencias-header-actions">
          <div>
            <h3 style="font-size: 1.15rem; font-weight: 600; margin: 0 0 0.25rem 0;">Ajustes e Incidencias</h3>
            <p style="font-size: 0.85rem; color: var(--color-text-muted); margin: 0;">Incidencias de integración detectadas y sugerencias de configuración del sistema</p>
          </div>
          <div class="incidencias-filters">
            <select id="client-filter-status" class="incidencias-filter-select">
              <option value="todos" ${filterStatus === 'todos' ? 'selected' : ''}>Todos los estados</option>
              <option value="pendiente" ${filterStatus === 'pendiente' ? 'selected' : ''}>Pendientes</option>
              <option value="resuelta" ${filterStatus === 'resuelta' ? 'selected' : ''}>Resueltas</option>
              <option value="descartada" ${filterStatus === 'descartada' ? 'selected' : ''}>Descartadas</option>
            </select>
            <select id="client-filter-severity" class="incidencias-filter-select">
              <option value="todos" ${filterSeverity === 'todos' ? 'selected' : ''}>Todas las prioridades</option>
              <option value="sugerencia" ${filterSeverity === 'sugerencia' ? 'selected' : ''}>Sugerencias</option>
              <option value="bajo" ${filterSeverity === 'bajo' ? 'selected' : ''}>Bajo</option>
              <option value="medio" ${filterSeverity === 'medio' ? 'selected' : ''}>Medio</option>
              <option value="alto" ${filterSeverity === 'alto' ? 'selected' : ''}>Alto</option>
              <option value="critico" ${filterSeverity === 'critico' ? 'selected' : ''}>Crítico</option>
            </select>
          </div>
        </div>

        ${listHtml}
      </div>
    `;

    // Asignar listeners de filtros
    document.getElementById('client-filter-status').addEventListener('change', (e) => {
      filterStatus = e.target.value;
      loadIncidencias();
    });
    document.getElementById('client-filter-severity').addEventListener('change', (e) => {
      filterSeverity = e.target.value;
      loadIncidencias();
    });

    // Asignar listeners de acciones
    document.querySelectorAll('.btn-resolve-trigger').forEach(btn => {
      btn.addEventListener('click', () => showResponseForm(btn.getAttribute('data-id'), 'resuelta'));
    });
    document.querySelectorAll('.btn-discard-trigger').forEach(btn => {
      btn.addEventListener('click', () => showResponseForm(btn.getAttribute('data-id'), 'descartada'));
    });
  }

  // Mostrar el formulario de comentarios
  function showResponseForm(incId, targetStatus) {
    const actionPanel = document.getElementById(`action-panel-${incId}`);
    if (!actionPanel) return;

    const actionText = targetStatus === 'resuelta' ? 'Marcar como Resuelta' : 'Descartar / Rechazar';
    const actionColor = targetStatus === 'resuelta' ? 'var(--color-success)' : 'var(--color-danger)';
    const placeholderText = targetStatus === 'resuelta' 
      ? 'Explica brevemente cómo se resolvió (ej: "Se agregaron los SKUs faltantes", "Se configuró la API key correcta")...'
      : 'Ingresa el motivo del descarte u objeción...';

    actionPanel.innerHTML = `
      <div class="client-action-form">
        <div class="action-title" style="color: ${actionColor};">
          <i class="${targetStatus === 'resuelta' ? 'ri-checkbox-circle-line' : 'ri-close-circle-line'}"></i>
          Confirmar Acción: ${actionText}
        </div>
        <textarea id="comment-${incId}" class="form-textarea-styled" rows="3" placeholder="${placeholderText}" required style="resize: vertical;"></textarea>
        <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
          <button class="btn btn-outline btn-cancel-response" data-id="${incId}">Cancelar</button>
          <button class="btn btn-primary btn-submit-response" data-id="${incId}" data-status="${targetStatus}" style="background: ${actionColor}; border-color: ${actionColor}; color: #fff;">
            Confirmar e Enviar
          </button>
        </div>
      </div>
    `;

    // Listener de cancelar
    actionPanel.querySelector('.btn-cancel-response').addEventListener('click', () => {
      renderList(); // Recarga la lista original para restablecer los botones de acción
    });

    // Listener de envío
    actionPanel.querySelector('.btn-submit-response').addEventListener('click', async (e) => {
      const commentInput = document.getElementById(`comment-${incId}`);
      const commentVal = commentInput.value.trim();

      if (!commentVal) {
        alert('Por favor ingresa un comentario o explicación de la resolución.');
        commentInput.focus();
        return;
      }

      const statusVal = e.target.getAttribute('data-status');
      
      try {
        actionPanel.innerHTML = `<div style="text-align: center; padding: 1rem;"><i class="ri-loader-4-line ri-spin" style="font-size: 1.5rem; color: var(--color-primary);"></i> Enviando respuesta...</div>`;
        
        const { error } = await supabase
          .from('incidencias')
          .update({
            status: statusVal,
            comment: commentVal,
            resolved_at: new Date().toISOString()
          })
          .eq('id', incId);

        if (error) throw error;

        // Recargar incidencias
        await loadIncidencias();
        if (window.updateClientBadges) {
          window.updateClientBadges(userId, userComercio);
        }
      } catch (err) {
        console.error('Error al responder incidencia:', err);
        alert('Error al enviar la respuesta: ' + err.message);
        renderList(); // Restablece
      }
    });
  }

  await loadIncidencias();
}

// ==========================================
// VISTA ADMINISTRADOR (ADMIN PANEL)
// ==========================================

export async function renderIncidenciasAdmin(appContent) {
  if (!appContent) return;
  injectStyles();

  appContent.innerHTML = `<div style="display: flex; justify-content: center; padding: 3rem;"><i class="ri-loader-4-line ri-spin" style="font-size: 2rem; color: var(--color-primary);"></i></div>`;

  let incidencias = [];
  let filterStatus = 'todos';
  let filterSeverity = 'todos';
  let filterComercio = 'todos';
  let uniqueComercios = [];

  // Verificar si la tabla existe
  try {
    const { error: testError } = await supabase.from('incidencias').select('id').limit(1);
    if (testError && (testError.code === '42P01' || testError.message.includes('does not exist'))) {
      renderMigrationWarning(appContent, false);
      return;
    }
  } catch (err) {
    console.error('Error al probar tabla incidencias:', err);
  }

  // Cargar lista única de comercios con incidencias para filtros rápidos
  async function loadFilterComercios() {
    try {
      const { data, error } = await supabase
        .from('incidencias')
        .select('comercio');
      if (error) throw error;
      
      const set = new Set();
      (data || []).forEach(x => {
        if (x.comercio) set.add(x.comercio);
      });
      uniqueComercios = Array.from(set).sort();
    } catch (err) {
      console.error('Error al cargar comercios de incidencias:', err);
    }
  }

  async function loadAllIncidencias() {
    try {
      let query = supabase
        .from('incidencias')
        .select(`
          *,
          client:profiles!user_id(full_name, email, company_name, comercio)
        `)
        .order('created_at', { ascending: false });

      if (filterStatus !== 'todos') {
        query = query.eq('status', filterStatus);
      }
      if (filterSeverity !== 'todos') {
        query = query.eq('severity', filterSeverity);
      }
      if (filterComercio !== 'todos') {
        query = query.eq('comercio', filterComercio);
      }

      const { data, error } = await query;
      if (error) throw error;
      incidencias = data || [];
      
      await loadFilterComercios();
      renderListAdmin();
    } catch (err) {
      console.error('Error al cargar incidencias del admin:', err);
      appContent.innerHTML = `<div class="alert alert-error">Error al cargar incidencias: ${err.message}</div>`;
    }
  }

  function renderListAdmin() {
    let listHtml = '';
    if (incidencias.length === 0) {
      listHtml = `
        <div class="card" style="text-align: center; padding: 3rem; color: var(--color-text-muted);">
          <i class="ri-check-double-line" style="font-size: 3rem; color: var(--color-primary); margin-bottom: 0.75rem; display: block;"></i>
          <p style="font-size: 1.05rem; font-weight: 500;">No hay incidencias que coincidan</p>
          <p style="font-size: 0.85rem; margin-top: 0.25rem;">Usa el botón superior para crear una nueva incidencia o ajusta los filtros.</p>
        </div>
      `;
    } else {
      listHtml = `
        <div class="incidencias-list">
          ${incidencias.map(inc => {
            const severity = SEVERITY_LEVELS[inc.severity] || { label: inc.severity, class: '', borderClass: '' };
            const type = TYPES[inc.type] || { label: inc.type, icon: 'ri-question-line', class: '' };
            const status = STATUSES[inc.status] || { label: inc.status, class: '' };
            
            const isUnresolved = inc.status === 'pendiente';
            const daysOpen = isUnresolved ? calculateDaysElapsed(inc.created_at) : null;
            const clientName = inc.client?.full_name || 'Sin Nombre';
            const companyName = inc.client?.company_name || 'Desconocida';
            const commerceName = inc.comercio || 'no asignado';

            return `
              <div class="incidencia-card ${severity.borderClass}">
                <div class="incidencia-card-header">
                  <div class="incidencia-title-area">
                    <div class="incidencia-type-icon ${type.class}">
                      <i class="${type.icon}"></i>
                    </div>
                    <div class="incidencia-card-meta">
                      <div class="incidencia-title">${escapeHtml(inc.title)}</div>
                      <div style="font-size: 0.85rem; color: var(--color-primary); font-weight: 600; margin-top: 0.15rem;">
                        <i class="ri-store-2-line"></i> Comercio: ${escapeHtml(commerceName)} | ${escapeHtml(companyName)}
                      </div>
                      <div class="incidencia-badges">
                        <span class="inc-badge ${severity.class}">${severity.label}</span>
                        <span class="inc-badge ${type.class}">${type.label}</span>
                        <span class="inc-badge ${status.class}">${status.label}</span>
                      </div>
                    </div>
                  </div>
                  <div class="incidencia-status-aside">
                    ${isUnresolved 
                      ? (daysOpen > 0 
                        ? `<span class="days-alert"><i class="ri-time-line"></i> ${daysOpen} ${daysOpen === 1 ? 'día' : 'días'} abierto</span>` 
                        : `<span class="days-info"><i class="ri-time-line"></i> Creado hoy</span>`) 
                      : `<span class="days-info" style="color: var(--color-success);"><i class="ri-checkbox-circle-line"></i> Resuelto</span>`
                    }
                    <span style="color: var(--color-text-muted); font-size: 0.8rem;">Creado: ${formatDate(inc.created_at)}</span>
                  </div>
                </div>
                
                <div class="incidencia-card-body">
                  <div class="incidencia-description-section">
                    <strong>Descripción:</strong>
                    <div style="margin-top: 0.25rem; color: var(--color-text-muted);">${escapeHtml(inc.description).replace(/\n/g, '<br>')}</div>
                  </div>
                  
                  <div class="incidencia-solution-box" style="background: rgba(0, 0, 0, 0.02); border-color: var(--color-border);">
                    <div class="solution-box-title" style="color: var(--color-text-muted);">
                      <i class="ri-lightbulb-line"></i>
                      <span>🔧 Solución propuesta:</span>
                    </div>
                    <div class="solution-box-content">${escapeHtml(inc.solution).replace(/\n/g, '<br>')}</div>
                  </div>

                  ${inc.status !== 'pendiente' ? `
                    <div class="incidencia-response-box">
                      <div class="response-header">
                        <span>Respuesta del Cliente (${formatDate(inc.resolved_at)})</span>
                        <span style="text-transform: uppercase;">Estado: ${inc.status}</span>
                      </div>
                      <div class="response-content">
                        ${inc.comment ? escapeHtml(inc.comment).replace(/\n/g, '<br>') : 'Sin comentarios.'}
                      </div>
                    </div>
                  ` : `
                    <div style="text-align: right; margin-top: 0.5rem;">
                      <button class="btn btn-outline btn-delete-incidencia" data-id="${inc.id}" style="color: var(--color-danger); border-color: rgba(239, 68, 68, 0.3);">
                        <i class="ri-delete-bin-line"></i> Eliminar
                      </button>
                    </div>
                  `}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    appContent.innerHTML = `
      <div class="incidencias-container">
        <div class="incidencias-header-actions">
          <div>
            <h3 style="font-size: 1.15rem; font-weight: 600; margin: 0 0 0.25rem 0;">Gestión de Incidencias y Configuración</h3>
            <p style="font-size: 0.85rem; color: var(--color-text-muted); margin: 0;">Administra y reporta sugerencias o problemas de integración para cada comercio</p>
          </div>
          <button id="btn-new-incidencia" class="btn btn-primary">
            <i class="ri-add-line" style="margin-right: 0.25rem; font-size: 1.1rem; vertical-align: middle;"></i> Nueva Incidencia
          </button>
        </div>

        <div class="incidencias-header-actions" style="margin-top: -0.5rem; justify-content: flex-start; padding: 0.75rem 1.25rem;">
          <div class="incidencias-filters" style="width: 100%;">
            <select id="admin-filter-comercio" class="incidencias-filter-select">
              <option value="todos" ${filterComercio === 'todos' ? 'selected' : ''}>Todos los comercios</option>
              ${uniqueComercios.map(c => `<option value="${c}" ${filterComercio === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
            <select id="admin-filter-status" class="incidencias-filter-select">
              <option value="todos" ${filterStatus === 'todos' ? 'selected' : ''}>Todos los estados</option>
              <option value="pendiente" ${filterStatus === 'pendiente' ? 'selected' : ''}>Pendientes</option>
              <option value="resuelta" ${filterStatus === 'resuelta' ? 'selected' : ''}>Resueltas</option>
              <option value="descartada" ${filterStatus === 'descartada' ? 'selected' : ''}>Descartadas</option>
            </select>
            <select id="admin-filter-severity" class="incidencias-filter-select">
              <option value="todos" ${filterSeverity === 'todos' ? 'selected' : ''}>Todas las prioridades</option>
              <option value="sugerencia" ${filterSeverity === 'sugerencia' ? 'selected' : ''}>Sugerencias</option>
              <option value="bajo" ${filterSeverity === 'bajo' ? 'selected' : ''}>Bajo</option>
              <option value="medio" ${filterSeverity === 'medio' ? 'selected' : ''}>Medio</option>
              <option value="alto" ${filterSeverity === 'alto' ? 'selected' : ''}>Alto</option>
              <option value="critico" ${filterSeverity === 'critico' ? 'selected' : ''}>Crítico</option>
            </select>
          </div>
        </div>

        ${listHtml}
      </div>
    `;

    // Asignar listeners de filtros
    document.getElementById('admin-filter-comercio').addEventListener('change', (e) => {
      filterComercio = e.target.value;
      loadAllIncidencias();
    });
    document.getElementById('admin-filter-status').addEventListener('change', (e) => {
      filterStatus = e.target.value;
      loadAllIncidencias();
    });
    document.getElementById('admin-filter-severity').addEventListener('change', (e) => {
      filterSeverity = e.target.value;
      loadAllIncidencias();
    });

    // Nuevo Caso click listener
    document.getElementById('btn-new-incidencia').addEventListener('click', openCreateModal);

    // Borrar incidencias
    document.querySelectorAll('.btn-delete-incidencia').forEach(btn => {
      btn.addEventListener('click', async () => {
        const incId = btn.getAttribute('data-id');
        if (confirm('¿Estás seguro de que deseas eliminar esta incidencia?')) {
          try {
            const { error } = await supabase.from('incidencias').delete().eq('id', incId);
            if (error) throw error;
            await loadAllIncidencias();
            if (window.updateAdminBadges) {
              window.updateAdminBadges();
            }
          } catch (err) {
            console.error('Error al borrar incidencia:', err);
            alert('Error al borrar: ' + err.message);
          }
        }
      });
    });
  }

  // Abrir Modal de Creación
  async function openCreateModal() {
    // 1. Cargar comercios desde v_comercios_config
    let comercios = [];
    try {
      const { data, error } = await supabase
        .from('v_comercios_config')
        .select('id, nombre, sigla')
        .order('nombre', { ascending: true });
      if (error) throw error;
      comercios = data || [];
    } catch (err) {
      console.error('Error al cargar comercios desde v_comercios_config:', err);
      alert('Error al cargar la lista de comercios: ' + err.message);
      return;
    }

    // 2. Cargar perfiles de clientes para buscar a quién asignarle la incidencia
    let profiles = [];
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, company_name, comercio')
        .or('role.eq.client,role.eq.observer');
      if (error) throw error;
      profiles = data || [];
    } catch (err) {
      console.error('Error al cargar perfiles en modal:', err);
    }

    if (comercios.length === 0) {
      alert('No hay comercios configurados en comercios_config.');
      return;
    }

    // Mapear comercios con sus respectivos usuarios
    const comerciosWithProfiles = comercios.map(c => {
      // Buscar perfiles asociados con esta sigla
      const matchedProfiles = profiles.filter(p => {
        if (!p.comercio) return false;
        if (p.comercio === 'all') return true;
        const siglas = p.comercio.split(',').map(s => s.trim().toUpperCase());
        return siglas.includes(c.sigla.toUpperCase());
      });

      return {
        ...c,
        profileId: matchedProfiles.length > 0 ? matchedProfiles[0].id : null,
        companyName: matchedProfiles.length > 0 ? matchedProfiles[0].company_name : ''
      };
    });

    const modalId = 'modal-new-incidencia';
    let modal = document.getElementById(modalId);
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-content-styled">
        <div class="modal-header-styled">
          <h3 style="margin: 0; font-size: 1.1rem; display: flex; align-items: center; gap: 0.5rem;">
            <i class="ri-alert-line" style="color: var(--color-primary);"></i> Reportar Nueva Incidencia o Sugerencia
          </h3>
          <button id="modal-close-btn" class="btn btn-outline" style="border:none; font-size: 1.25rem; padding: 0.25rem 0.5rem; cursor: pointer; color: var(--color-text-muted);">&times;</button>
        </div>
        <form id="form-create-incidencia">
          <div class="modal-body-styled">
            
            <div class="form-group-styled">
              <label for="form-comercio">Comercio Asociado <span style="color: var(--color-danger);">*</span></label>
              <select id="form-comercio" class="form-input-styled" required>
                <option value="">-- Seleccionar Comercio --</option>
                ${comerciosWithProfiles.map(c => {
                  const labelSuffix = c.profileId ? ` (${c.sigla})` : ` (${c.sigla}) - [Sin Usuario Asociado]`;
                  return `<option value="${escapeHtml(c.sigla)}" data-user-id="${c.profileId || ''}" ${!c.profileId ? 'disabled' : ''}>${escapeHtml(c.nombre)}${labelSuffix}</option>`;
                }).join('')}
              </select>
            </div>

            <div class="form-grid-styled">
              <div class="form-group-styled">
                <label for="form-type">Tipo de Incidencia <span style="color: var(--color-danger);">*</span></label>
                <select id="form-type" class="form-input-styled" required>
                  <option value="integracion">Integración</option>
                  <option value="pedido">Problema con Pedido</option>
                  <option value="stock">Falta de Stock</option>
                  <option value="otros">Configuración / Otros</option>
                </select>
              </div>

              <div class="form-group-styled">
                <label for="form-severity">Nivel de Importancia <span style="color: var(--color-danger);">*</span></label>
                <select id="form-severity" class="form-input-styled" required>
                  <option value="sugerencia">Sugerencia</option>
                  <option value="bajo">Ajuste Bajo</option>
                  <option value="medio">Ajuste Medio</option>
                  <option value="alto">Ajuste Alto</option>
                  <option value="critico">Ajuste Crítico</option>
                </select>
              </div>
            </div>

            <div class="form-group-styled">
              <label for="form-title">Título de la Incidencia <span style="color: var(--color-danger);">*</span></label>
              <input type="text" id="form-title" class="form-input-styled" placeholder="Ej: Pedidos duplicados por WooCommerce o Falta SKU en Catálogo" required>
            </div>

            <div class="form-group-styled">
              <label for="form-description">Descripción Detallada <span style="color: var(--color-danger);">*</span></label>
              <textarea id="form-description" class="form-textarea-styled" rows="4" placeholder="Describe claramente el problema detectado o la sugerencia de configuración..." required style="resize: vertical;"></textarea>
            </div>

            <div class="form-group-styled">
              <label for="form-solution">Cómo Solucionar / Pasos Recomendados <span style="color: var(--color-danger);">*</span></label>
              <textarea id="form-solution" class="form-textarea-styled" rows="3" placeholder="Indica detalladamente los pasos que debe seguir el cliente para resolver el problema..." required style="resize: vertical;"></textarea>
            </div>

          </div>
          <div class="modal-footer-styled">
            <button type="button" id="modal-cancel-btn" class="btn btn-outline">Cancelar</button>
            <button type="submit" class="btn btn-primary" style="background: var(--color-primary); color: #000; font-weight: 600;">
              Guardar y Notificar
            </button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    // Cerrar modal
    const closeBtn = document.getElementById('modal-close-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');
    const closeModal = () => modal.remove();
    
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Envío del formulario
    const form = document.getElementById('form-create-incidencia');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const comercioSelect = document.getElementById('form-comercio');
      const selectedOption = comercioSelect.options[comercioSelect.selectedIndex];
      const comercioVal = comercioSelect.value;
      const userIdVal = selectedOption.getAttribute('data-user-id');

      if (!userIdVal) {
        alert('Este comercio no tiene un usuario de cliente asociado.');
        return;
      }
      
      const typeVal = document.getElementById('form-type').value;
      const severityVal = document.getElementById('form-severity').value;
      const titleVal = document.getElementById('form-title').value.trim();
      const descriptionVal = document.getElementById('form-description').value.trim();
      const solutionVal = document.getElementById('form-solution').value.trim();

      const { data: { session } } = await supabase.auth.getSession();
      const adminId = session?.user?.id || null;

      try {
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Guardando...';

        const { error } = await supabase
          .from('incidencias')
          .insert({
            user_id: userIdVal,
            comercio: comercioVal,
            title: titleVal,
            description: descriptionVal,
            solution: solutionVal,
            type: typeVal,
            severity: severityVal,
            status: 'pendiente',
            created_by: adminId
          });

        if (error) throw error;

        closeModal();
        await loadAllIncidencias();
        if (window.updateAdminBadges) {
          window.updateAdminBadges();
        }
      } catch (err) {
        console.error('Error al insertar incidencia:', err);
        alert('Error al guardar incidencia: ' + err.message);
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Guardar y Notificar';
      }
    });
  }

  await loadAllIncidencias();
}
