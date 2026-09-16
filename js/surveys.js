import supabase from './supabase.js';

// ==============================================================================
// MÓDULO DE ENCUESTAS, REVIEWS Y SATISFACCIÓN - WMS STOCKA
// ==============================================================================

export const SURVEY_CATEGORIES = {
  satisfaction: {
    label: 'Satisfacción y CSAT',
    icon: 'ri-emotion-happy-line',
    color: '#10b981',
    bgColor: 'rgba(16, 185, 129, 0.12)',
    desc: 'Medición de CSAT, NPS y percepción del servicio'
  },
  review: {
    label: 'Review de Servicio / Bodega',
    icon: 'ri-star-smile-line',
    color: '#f59e0b',
    bgColor: 'rgba(245, 158, 11, 0.12)',
    desc: 'Calificación de preparación, empaque y despachos'
  },
  onboarding: {
    label: 'Incorporación / Onboarding',
    icon: 'ri-rocket-line',
    color: '#3b82f6',
    bgColor: 'rgba(59, 130, 246, 0.12)',
    desc: 'Evaluación del proceso de bienvenida e integración'
  },
  operational: {
    label: 'Operaciones e Inventario',
    icon: 'ri-box-3-line',
    color: '#8b5cf6',
    bgColor: 'rgba(139, 92, 246, 0.12)',
    desc: 'Evaluación de solicitudes de stock y logística'
  },
  custom: {
    label: 'Encuesta Personalizada',
    icon: 'ri-survey-line',
    color: '#06b6d4',
    bgColor: 'rgba(6, 182, 212, 0.12)',
    desc: 'Encuesta general o investigación a medida'
  }
};

export const BLOCK_TYPES = {
  rating_stars: {
    label: 'Calificación 1-5 Estrellas',
    icon: 'ri-star-fill',
    group: 'rating',
    desc: 'Escala visual de 5 estrellas interactivas'
  },
  rating_csat_emojis: {
    label: 'Satisfacción con Emojis (CSAT)',
    icon: 'ri-emotion-line',
    group: 'rating',
    desc: '5 caritas: Muy insatisfecho a Muy satisfecho'
  },
  rating_nps: {
    label: 'Net Promoter Score (NPS 0-10)',
    icon: 'ri-dashboard-3-line',
    group: 'rating',
    desc: 'Escala 0 al 10 con clasificación automática'
  },
  rating_numeric: {
    label: 'Escala Numérica (1 a 5 o 1 a 10)',
    icon: 'ri-numbers-line',
    group: 'rating',
    desc: 'Puntuación con etiquetas de extremos mín/máx'
  },
  single_choice: {
    label: 'Opción Única (Radio)',
    icon: 'ri-radio-button-line',
    group: 'question',
    desc: 'El encuestado elige exactamente una alternativa'
  },
  multiple_choice: {
    label: 'Selección Múltiple (Checkboxes)',
    icon: 'ri-checkbox-line',
    group: 'question',
    desc: 'El encuestado puede marcar varias opciones'
  },
  text_short: {
    label: 'Texto Corto',
    icon: 'ri-input-field',
    group: 'question',
    desc: 'Campo de texto de una sola línea'
  },
  text_long: {
    label: 'Texto Largo / Comentarios',
    icon: 'ri-file-text-line',
    group: 'question',
    desc: 'Área de texto para comentarios y opiniones libres'
  },
  boolean: {
    label: 'Sí / No',
    icon: 'ri-toggle-line',
    group: 'question',
    desc: 'Pregunta binaria con botones atractivos'
  },
  dropdown: {
    label: 'Menú Desplegable',
    icon: 'ri-arrow-down-s-line',
    group: 'question',
    desc: 'Lista desplegable para seleccionar una opción'
  },
  text_header: {
    label: 'Encabezado / Título de Sección',
    icon: 'ri-heading',
    group: 'content',
    desc: 'Texto grande para organizar bloques o separar temas'
  },
  text_paragraph: {
    label: 'Párrafo Informativo / Instrucciones',
    icon: 'ri-paragraph',
    group: 'content',
    desc: 'Texto de lectura o aclaraciones sin respuesta'
  },
  text_callout: {
    label: 'Caja de Aviso / Alerta',
    icon: 'ri-information-line',
    group: 'content',
    desc: 'Destaca un mensaje importante con icono y color'
  },
  divider: {
    label: 'Separador Visual',
    icon: 'ri-separator',
    group: 'content',
    desc: 'Línea divisoria decorativa entre preguntas'
  }
};

const STATUS_MAP = {
  draft: { label: 'Borrador', badgeClass: 'badge-warning', icon: 'ri-draft-line' },
  published: { label: 'Publicada / Activa', badgeClass: 'badge-success', icon: 'ri-checkbox-circle-line' },
  closed: { label: 'Finalizada / Cerrada', badgeClass: 'badge-danger', icon: 'ri-lock-line' }
};

const CSAT_EMOJIS = [
  { value: 1, emoji: '😡', label: 'Muy insatisfecho', color: '#ef4444' },
  { value: 2, emoji: '🙁', label: 'Insatisfecho', color: '#f97316' },
  { value: 3, emoji: '😐', label: 'Neutral', color: '#eab308' },
  { value: 4, emoji: '🙂', label: 'Satisfecho', color: '#3b82f6' },
  { value: 5, emoji: '😃', label: 'Muy satisfecho', color: '#10b981' }
];

const STAR_LABELS = ['Muy deficiente', 'Deficiente', 'Aceptable', 'Bueno', 'Excelente'];

// ==============================================================================
// ESTILOS DINÁMICOS CSS PARA ENCUESTAS
// ==============================================================================
function injectSurveyStyles() {
  if (document.getElementById('wms-survey-styles')) return;
  const style = document.createElement('style');
  style.id = 'wms-survey-styles';
  style.innerHTML = `
    /* Surveys Module Common Styles */
    .survey-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: 1.5rem;
      transition: all 0.25s ease;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: relative;
    }
    .survey-card:hover {
      box-shadow: var(--shadow-md);
      border-color: var(--color-primary);
      transform: translateY(-2px);
    }
    .survey-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.25rem 0.65rem;
      border-radius: var(--radius-full);
      font-size: 0.75rem;
      font-weight: 600;
    }

    /* Interactive Star Rating */
    .star-rating-group {
      display: inline-flex;
      flex-direction: row-reverse;
      gap: 0.4rem;
      align-items: center;
    }
    .star-rating-group input {
      display: none;
    }
    .star-rating-group label {
      cursor: pointer;
      font-size: 2rem;
      color: #cbd5e1;
      transition: color 0.15s ease, transform 0.15s ease;
    }
    .star-rating-group label:hover,
    .star-rating-group label:hover ~ label,
    .star-rating-group input:checked ~ label {
      color: #f59e0b;
      transform: scale(1.15);
    }

    /* CSAT Emojis Group */
    .csat-emojis-container {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
      margin-top: 0.75rem;
    }
    .csat-emoji-btn {
      flex: 1;
      min-width: 90px;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 0.85rem 0.5rem;
      background: var(--color-bg);
      border: 2px solid var(--color-border);
      border-radius: var(--radius-md);
      cursor: pointer;
      transition: all 0.2s ease;
      user-select: none;
    }
    .csat-emoji-btn .emoji-char {
      font-size: 2rem;
      margin-bottom: 0.35rem;
      transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .csat-emoji-btn .emoji-label {
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--color-text-muted);
      text-align: center;
    }
    .csat-emoji-btn:hover {
      border-color: var(--color-primary);
      transform: translateY(-2px);
    }
    .csat-emoji-btn:hover .emoji-char {
      transform: scale(1.25);
    }
    .csat-emoji-btn.active {
      border-color: var(--color-primary);
      background: rgba(37, 99, 235, 0.08);
    }
    .csat-emoji-btn.active .emoji-char {
      transform: scale(1.3);
    }
    .csat-emoji-btn.active .emoji-label {
      color: var(--color-primary);
      font-weight: 700;
    }

    /* NPS Scale Group */
    .nps-container {
      display: flex;
      gap: 0.35rem;
      flex-wrap: wrap;
      margin-top: 0.75rem;
    }
    .nps-btn {
      flex: 1;
      min-width: 38px;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1rem;
      font-weight: 700;
      border: 2px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-bg);
      color: var(--color-text-main);
      cursor: pointer;
      transition: all 0.15s ease;
      user-select: none;
    }
    .nps-btn:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-sm);
    }
    .nps-btn.detractor:hover, .nps-btn.detractor.active {
      background: #ef4444;
      border-color: #ef4444;
      color: #fff;
    }
    .nps-btn.passive:hover, .nps-btn.passive.active {
      background: #f59e0b;
      border-color: #f59e0b;
      color: #fff;
    }
    .nps-btn.promoter:hover, .nps-btn.promoter.active {
      background: #10b981;
      border-color: #10b981;
      color: #fff;
    }

    /* Choice Options Pills / Cards */
    .survey-choice-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      background: var(--color-bg);
      border: 2px solid var(--color-border);
      border-radius: var(--radius-md);
      margin-bottom: 0.5rem;
      cursor: pointer;
      transition: all 0.2s ease;
      user-select: none;
    }
    .survey-choice-item:hover {
      border-color: var(--color-primary);
      background: rgba(37, 99, 235, 0.04);
    }
    .survey-choice-item.selected {
      border-color: var(--color-primary);
      background: rgba(37, 99, 235, 0.1);
      color: var(--color-primary);
      font-weight: 600;
    }

    /* Progress Bar */
    .survey-progress-bar-wrap {
      width: 100%;
      height: 8px;
      background: var(--color-border);
      border-radius: 9999px;
      overflow: hidden;
      margin: 1rem 0;
    }
    .survey-progress-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--color-primary), var(--color-accent));
      transition: width 0.3s ease;
    }

    /* Form inputs and controls overhaul */
    .survey-input,
    .survey-form-control,
    .form-control,
    .form-input {
      width: 100% !important;
      box-sizing: border-box !important;
      padding: 0.75rem 1rem !important;
      background: var(--color-surface) !important;
      border: 1.5px solid var(--color-border) !important;
      border-radius: var(--radius-md) !important;
      color: var(--color-text-main) !important;
      font-family: inherit !important;
      font-size: 0.95rem !important;
      transition: all 0.2s ease !important;
    }
    .survey-input:focus,
    .survey-form-control:focus,
    .form-control:focus,
    .form-input:focus {
      outline: none !important;
      border-color: var(--color-primary) !important;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.25) !important;
    }
    select.survey-input,
    select.survey-form-control,
    select.form-control {
      width: 100% !important;
      box-sizing: border-box !important;
      padding: 0.75rem 2.5rem 0.75rem 1rem !important;
      background: var(--color-surface) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E") no-repeat right 1rem center !important;
      appearance: none !important;
      -webkit-appearance: none !important;
      border: 1.5px solid var(--color-border) !important;
      border-radius: var(--radius-md) !important;
      color: var(--color-text-main) !important;
      cursor: pointer !important;
    }
    textarea.survey-input,
    textarea.survey-form-control,
    textarea.form-control {
      width: 100% !important;
      box-sizing: border-box !important;
      min-height: 85px !important;
      line-height: 1.5 !important;
      resize: vertical !important;
    }

    /* Palette Block Action Chips */
    .survey-palette-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.6rem 0.95rem;
      background: var(--color-surface);
      border: 1.5px solid var(--color-border);
      border-radius: var(--radius-md);
      color: var(--color-text-main);
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      user-select: none;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    }
    .survey-palette-btn:hover {
      border-color: var(--color-primary);
      background: rgba(37, 99, 235, 0.08);
      color: var(--color-primary);
      transform: translateY(-2px);
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.15);
    }
    .survey-palette-btn i {
      font-size: 1.1rem;
    }

    /* Page Tabs in Builder */
    .builder-pages-tabs-wrapper {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      overflow-x: auto;
      overflow-y: hidden;
      white-space: nowrap;
      padding: 0.25rem 0.1rem;
      scrollbar-width: none;
    }
    .builder-pages-tabs-wrapper::-webkit-scrollbar {
      display: none;
    }
    .builder-page-tab {
      padding: 0.55rem 1.15rem;
      border-radius: var(--radius-full);
      border: 1.5px solid var(--color-border);
      background: var(--color-surface);
      color: var(--color-text-muted);
      cursor: pointer;
      font-weight: 600;
      font-size: 0.85rem;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.2s ease;
      user-select: none;
      white-space: nowrap;
    }
    .builder-page-tab:hover {
      border-color: var(--color-primary);
      color: var(--color-text-main);
      background: rgba(255, 255, 255, 0.04);
    }
    .builder-page-tab.active {
      background: var(--color-primary);
      color: #ffffff;
      border-color: var(--color-primary);
      box-shadow: 0 2px 8px rgba(37, 99, 235, 0.4);
    }
    .builder-page-tab .tab-count-badge {
      background: rgba(255, 255, 255, 0.2);
      color: inherit;
      padding: 0.15rem 0.45rem;
      border-radius: var(--radius-full);
      font-size: 0.72rem;
      font-weight: 700;
    }
    .builder-page-tab:not(.active) .tab-count-badge {
      background: var(--color-bg);
      color: var(--color-text-muted);
      border: 1px solid var(--color-border);
    }

    /* Audience Selectable Cards */
    .audience-card {
      background: var(--color-surface);
      border: 1.5px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: 1rem;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: flex-start;
      gap: 0.85rem;
      user-select: none;
    }
    .audience-card:hover {
      border-color: var(--color-primary);
      transform: translateY(-2px);
      box-shadow: var(--shadow-sm);
    }
    .audience-card.active {
      border-color: var(--color-primary);
      background: rgba(37, 99, 235, 0.08);
      box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.3);
    }
    .audience-card .audience-icon {
      width: 38px;
      height: 38px;
      border-radius: var(--radius-md);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.25rem;
      background: var(--color-bg);
      color: var(--color-text-muted);
      transition: all 0.2s ease;
      flex-shrink: 0;
    }
    .audience-card.active .audience-icon {
      background: var(--color-primary);
      color: #ffffff;
    }

    /* Block Cards Enhancement */
    .builder-block-card {
      background: var(--color-surface);
      border: 1.5px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: 1.5rem;
      margin-bottom: 1.25rem;
      box-shadow: var(--shadow-sm);
      position: relative;
      transition: all 0.25s ease;
    }
    .builder-block-card:hover {
      border-color: var(--color-primary);
      box-shadow: var(--shadow-md);
    }
    .builder-block-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.25rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--color-border);
      flex-wrap: wrap;
      gap: 0.75rem;
    }
    .block-num-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 26px;
      height: 26px;
      padding: 0 6px;
      border-radius: var(--radius-full);
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      color: var(--color-text-muted);
      font-size: 0.78rem;
      font-weight: 700;
    }
    .survey-required-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.3rem 0.75rem;
      border-radius: var(--radius-full);
      border: 1px solid var(--color-border);
      background: var(--color-bg);
      color: var(--color-text-muted);
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
      user-select: none;
      transition: all 0.2s ease;
    }
    .survey-required-pill:hover {
      border-color: var(--color-primary);
      color: var(--color-text-main);
    }
    .survey-required-pill.active {
      background: rgba(37, 99, 235, 0.12);
      border-color: var(--color-primary);
      color: var(--color-primary);
    }
    .btn-block-action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border-radius: var(--radius-sm);
      border: none;
      background: transparent;
      color: var(--color-text-muted);
      cursor: pointer;
      font-size: 0.95rem;
      transition: all 0.15s ease;
    }
    .btn-block-action:hover:not(:disabled) {
      background: var(--color-surface);
      color: var(--color-text-main);
    }
    .btn-block-action:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }
    .btn-block-action.btn-block-delete:hover:not(:disabled) {
      background: rgba(239, 68, 68, 0.15);
      color: var(--color-danger);
    }

    /* Popup Modal Styles */
    @keyframes surveyModalFadeIn {
      from { opacity: 0; transform: scale(0.95) translateY(12px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    @keyframes surveyFloatIcon {
      0%, 100% { transform: translateY(0px) rotate(0deg); }
      50% { transform: translateY(-6px) rotate(3deg); }
    }
    .survey-login-popup-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      width: 100vw; height: 100vh;
      background: rgba(0, 0, 0, 0.72);
      backdrop-filter: blur(5px);
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.25rem;
      overflow-y: auto;
    }
    .survey-login-popup-card {
      background: var(--color-surface);
      border: 1.5px solid var(--color-border);
      border-radius: var(--radius-xl, 18px);
      max-width: 530px;
      width: 100%;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.45);
      position: relative;
      animation: surveyModalFadeIn 0.28s cubic-bezier(0.16, 1, 0.3, 1);
      overflow: hidden;
    }
  `;
  document.head.appendChild(style);
}

// ==============================================================================
// VISTA ADMINISTRADOR (renderSurveysAdmin)
// ==============================================================================

export async function renderSurveysAdmin(targetContainer) {
  const container = targetContainer || document.getElementById('app-content');
  if (!container) return;

  injectSurveyStyles();

  // Estado local del módulo Admin
  let surveys = [];
  let currentFilter = 'all';
  let currentCategory = 'all';
  let searchQuery = '';
  let activeTab = 'list'; // 'list' | 'builder' | 'results'
  let activeSurveyForAction = null;

  async function loadData() {
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 320px;">
        <i class="ri-loader-4-line ri-spin" style="font-size: 2.5rem; color: var(--color-primary); margin-bottom: 1rem;"></i>
        <p style="color: var(--color-text-muted); font-size: 0.95rem;">Cargando Encuestas y Reviews...</p>
      </div>
    `;

    try {
      const { data, error } = await supabase
        .from('surveys')
        .select(`
          *,
          survey_responses(count)
        `)
        .order('created_at', { ascending: false });

      if (error) {
        if (error.message && error.message.includes('relation "public.surveys" does not exist')) {
          renderDatabaseSetupPrompt();
          return;
        }
        throw error;
      }

      surveys = data || [];
      renderMainAdminView();
    } catch (err) {
      console.error('Error al cargar encuestas:', err);
      container.innerHTML = `
        <div class="card" style="padding: 2.5rem; text-align: center; max-width: 650px; margin: 2rem auto;">
          <i class="ri-error-warning-line" style="font-size: 3rem; color: var(--color-danger); margin-bottom: 1rem;"></i>
          <h3 style="margin-bottom: 0.5rem;">Error al conectar con la base de datos</h3>
          <p style="color: var(--color-text-muted); margin-bottom: 1.5rem;">${err.message || 'Error desconocido'}</p>
          <button id="btn-retry-surveys" class="btn btn-primary">Reintentar</button>
        </div>
      `;
      document.getElementById('btn-retry-surveys')?.addEventListener('click', loadData);
    }
  }

  function renderDatabaseSetupPrompt() {
    container.innerHTML = `
      <div class="card" style="padding: 2.5rem; max-width: 750px; margin: 2rem auto; text-align: center;">
        <div style="width: 64px; height: 64px; background: rgba(245, 158, 11, 0.15); color: #f59e0b; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem auto; font-size: 2rem;">
          <i class="ri-database-2-line"></i>
        </div>
        <h2 style="font-size: 1.5rem; margin-bottom: 0.75rem; color: var(--color-text-main);">Inicialización de Tablas de Encuestas</h2>
        <p style="color: var(--color-text-muted); font-size: 0.95rem; margin-bottom: 1.5rem; line-height: 1.6;">
          Para activar el nuevo módulo de <strong>Encuestas, Reviews y Satisfacción</strong>, ejecuta el script SQL preparado en el SQL Editor de tu panel de Supabase.
        </p>
        <div style="background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1rem; text-align: left; font-family: monospace; font-size: 0.85rem; margin-bottom: 1.5rem; overflow-x: auto; max-height: 180px;">
          -- Archivo generado en la raíz del proyecto: supabase_schema_surveys.sql<br>
          CREATE TABLE public.surveys (...);<br>
          CREATE TABLE public.survey_responses (...);
        </div>
        <div style="display: flex; justify-content: center; gap: 1rem;">
          <button id="btn-copy-sql-path" class="btn btn-outline" style="border-color: var(--color-primary); color: var(--color-primary);">
            <i class="ri-file-copy-line"></i> Archivo: supabase_schema_surveys.sql
          </button>
          <button id="btn-reload-after-sql" class="btn btn-primary">
            <i class="ri-refresh-line"></i> Ya ejecuté el script, Recargar
          </button>
        </div>
      </div>
    `;
    document.getElementById('btn-reload-after-sql')?.addEventListener('click', loadData);
    document.getElementById('btn-copy-sql-path')?.addEventListener('click', () => {
      if (window.Swal) {
        window.Swal.fire({
          icon: 'info',
          title: 'Script SQL Listo',
          text: 'Encuentra el archivo "supabase_schema_surveys.sql" en la carpeta del proyecto y cópialo al SQL Editor de Supabase.',
          confirmButtonColor: 'var(--color-primary)'
        });
      }
    });
  }

  function renderMainAdminView() {
    // Calcular estadísticas
    const totalSurveys = surveys.length;
    const publishedCount = surveys.filter(s => s.status === 'published').length;
    let totalResponses = 0;
    surveys.forEach(s => {
      if (s.survey_responses && s.survey_responses.length > 0) {
        totalResponses += s.survey_responses[0].count || 0;
      }
    });

    container.innerHTML = `
      <div style="max-width: 1400px; margin: 0 auto; padding-bottom: 2rem;">
        
        <!-- Header con Título y Acción Principal -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem;">
          <div>
            <h1 style="font-size: 1.6rem; font-weight: 700; color: var(--color-text-main); margin-bottom: 0.25rem;">
              <i class="ri-survey-line" style="color: var(--color-primary); margin-right: 0.5rem;"></i>Encuestas & Reviews
            </h1>
            <p style="color: var(--color-text-muted); font-size: 0.9rem; margin: 0;">
              Diseña encuestas de satisfacción, valoraciones de bodega y feedback para tus clientes.
            </p>
          </div>
          <button id="btn-new-survey" class="btn btn-primary" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.65rem 1.25rem; font-size: 0.95rem;">
            <i class="ri-add-circle-line" style="font-size: 1.15rem;"></i> Crear Nueva Encuesta
          </button>
        </div>

        <!-- Tarjetas Métricas Superiores -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1.75rem;">
          <div class="card" style="padding: 1.25rem; display: flex; align-items: center; gap: 1rem;">
            <div style="width: 48px; height: 48px; border-radius: var(--radius-md); background: rgba(37, 99, 235, 0.12); color: var(--color-primary); display: flex; align-items: center; justify-content: center; font-size: 1.5rem;">
              <i class="ri-folder-chart-line"></i>
            </div>
            <div>
              <div style="font-size: 0.8rem; color: var(--color-text-muted); font-weight: 500;">Total Encuestas</div>
              <div style="font-size: 1.5rem; font-weight: 700; color: var(--color-text-main);">${totalSurveys}</div>
            </div>
          </div>

          <div class="card" style="padding: 1.25rem; display: flex; align-items: center; gap: 1rem;">
            <div style="width: 48px; height: 48px; border-radius: var(--radius-md); background: rgba(16, 185, 129, 0.12); color: #10b981; display: flex; align-items: center; justify-content: center; font-size: 1.5rem;">
              <i class="ri-checkbox-circle-line"></i>
            </div>
            <div>
              <div style="font-size: 0.8rem; color: var(--color-text-muted); font-weight: 500;">Activas / Publicadas</div>
              <div style="font-size: 1.5rem; font-weight: 700; color: var(--color-text-main);">${publishedCount}</div>
            </div>
          </div>

          <div class="card" style="padding: 1.25rem; display: flex; align-items: center; gap: 1rem;">
            <div style="width: 48px; height: 48px; border-radius: var(--radius-md); background: rgba(245, 158, 11, 0.12); color: #f59e0b; display: flex; align-items: center; justify-content: center; font-size: 1.5rem;">
              <i class="ri-chat-check-line"></i>
            </div>
            <div>
              <div style="font-size: 0.8rem; color: var(--color-text-muted); font-weight: 500;">Respuestas Totales</div>
              <div style="font-size: 1.5rem; font-weight: 700; color: var(--color-text-main);">${totalResponses}</div>
            </div>
          </div>

          <div class="card" style="padding: 1.25rem; display: flex; align-items: center; gap: 1rem;">
            <div style="width: 48px; height: 48px; border-radius: var(--radius-md); background: rgba(139, 92, 246, 0.12); color: #8b5cf6; display: flex; align-items: center; justify-content: center; font-size: 1.5rem;">
              <i class="ri-user-smile-line"></i>
            </div>
            <div>
              <div style="font-size: 0.8rem; color: var(--color-text-muted); font-weight: 500;">Canal de Respuestas</div>
              <div style="font-size: 1rem; font-weight: 700; color: var(--color-text-main);">Dashboard & Enlace QR</div>
            </div>
          </div>
        </div>

        <!-- Filtros y Búsqueda -->
        <div class="card" style="padding: 1rem 1.25rem; margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
          
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <span style="font-size: 0.85rem; font-weight: 600; color: var(--color-text-muted); margin-right: 0.5rem;">Estado:</span>
            <button class="filter-btn btn btn-outline btn-sm ${currentFilter === 'all' ? 'active' : ''}" data-filter="all">Todas</button>
            <button class="filter-btn btn btn-outline btn-sm ${currentFilter === 'published' ? 'active' : ''}" data-filter="published">Publicadas</button>
            <button class="filter-btn btn btn-outline btn-sm ${currentFilter === 'draft' ? 'active' : ''}" data-filter="draft">Borradores</button>
            <button class="filter-btn btn btn-outline btn-sm ${currentFilter === 'closed' ? 'active' : ''}" data-filter="closed">Cerradas</button>
          </div>

          <div style="display: flex; align-items: center; gap: 0.75rem; flex: 1; max-width: 400px; min-width: 250px;">
            <div style="position: relative; width: 100%;">
              <i class="ri-search-line" style="position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%); color: var(--color-text-muted);"></i>
              <input type="text" id="survey-search-input" placeholder="Buscar por título..." value="${escapeHtmlAttr(searchQuery)}" class="survey-form-control" style="padding-left: 2.25rem; font-size: 0.85rem; width: 100%; border-radius: var(--radius-md);">
            </div>
          </div>
        </div>

        <!-- Contenedor de Listado de Encuestas -->
        <div id="surveys-cards-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 1.25rem;">
          <!-- Se inyecta dinámicamente -->
        </div>

      </div>
    `;

    // Eventos
    document.getElementById('btn-new-survey')?.addEventListener('click', () => {
      openSurveyBuilder(null);
    });

    container.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        renderFilteredCards();
      });
    });

    document.getElementById('survey-search-input')?.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      renderFilteredCards();
    });

    renderFilteredCards();
  }

  function renderFilteredCards() {
    const grid = document.getElementById('surveys-cards-grid');
    if (!grid) return;

    let filtered = surveys.filter(s => {
      if (currentFilter !== 'all' && s.status !== currentFilter) return false;
      if (searchQuery && !s.title.toLowerCase().includes(searchQuery)) return false;
      return true;
    });

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="card" style="grid-column: 1 / -1; padding: 3.5rem 1.5rem; text-align: center;">
          <i class="ri-inbox-line" style="font-size: 3rem; color: var(--color-text-muted); opacity: 0.6; margin-bottom: 1rem;"></i>
          <h3 style="font-size: 1.15rem; color: var(--color-text-main); margin-bottom: 0.5rem;">No se encontraron encuestas</h3>
          <p style="color: var(--color-text-muted); font-size: 0.85rem; max-width: 450px; margin: 0 auto 1.25rem auto;">
            ${searchQuery || currentFilter !== 'all' ? 'Prueba ajustando los filtros de búsqueda.' : 'Crea tu primera encuesta para recopilar reviews y medir la satisfacción de tus clientes.'}
          </p>
          <button id="btn-create-first-survey" class="btn btn-primary btn-sm">
            <i class="ri-add-line"></i> Crear Nueva Encuesta
          </button>
        </div>
      `;
      document.getElementById('btn-create-first-survey')?.addEventListener('click', () => openSurveyBuilder(null));
      return;
    }

    grid.innerHTML = filtered.map(s => {
      const cat = SURVEY_CATEGORIES[s.category] || SURVEY_CATEGORIES.custom;
      const statusInfo = STATUS_MAP[s.status] || STATUS_MAP.draft;
      const responseCount = s.survey_responses && s.survey_responses.length > 0 ? (s.survey_responses[0].count || 0) : 0;
      const pagesCount = Array.isArray(s.pages) ? s.pages.length : 1;
      let totalQuestions = 0;
      if (Array.isArray(s.pages)) {
        s.pages.forEach(p => {
          if (Array.isArray(p.blocks)) {
            totalQuestions += p.blocks.filter(b => b.group !== 'content' && !b.type.startsWith('text_') && b.type !== 'divider').length;
          }
        });
      }

      // Target description
      let targetDesc = 'Todos los Comercios';
      if (s.target_type === 'specific_merchants') {
        const count = Array.isArray(s.target_merchants) ? s.target_merchants.length : 0;
        targetDesc = `${count} Comercios específicos`;
      } else if (s.target_type === 'specific_users') {
        const count = Array.isArray(s.target_users) ? s.target_users.length : 0;
        targetDesc = `${count} Usuarios específicos`;
      } else if (s.target_type === 'public_link') {
        targetDesc = 'Público con Enlace';
      }

      return `
        <div class="survey-card" data-id="${s.id}">
          <div>
            <!-- Header de tarjeta -->
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.75rem;">
              <span class="survey-badge" style="background: ${cat.bgColor}; color: ${cat.color};">
                <i class="${cat.icon}"></i> ${cat.label}
              </span>
              <span class="survey-badge ${statusInfo.badgeClass}">
                <i class="${statusInfo.icon}"></i> ${statusInfo.label}
              </span>
            </div>

            <!-- Título y Descripción -->
            <h3 style="font-size: 1.1rem; font-weight: 700; color: var(--color-text-main); margin-bottom: 0.4rem; line-height: 1.35;">
              ${escapeHtml(s.title)}
            </h3>
            <p style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 1rem; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
              ${escapeHtml(s.description || 'Sin descripción.')}
            </p>

            <!-- Metadatos (Páginas, Preguntas, Audiencia) -->
            <div style="background: var(--color-bg); border-radius: var(--radius-md); padding: 0.65rem 0.85rem; font-size: 0.78rem; color: var(--color-text-muted); display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 1.25rem;">
              <div><i class="ri-file-copy-2-line" style="color: var(--color-primary);"></i> <strong>${pagesCount}</strong> ${pagesCount === 1 ? 'página' : 'páginas'}</div>
              <div><i class="ri-questionnaire-line" style="color: var(--color-accent);"></i> <strong>${totalQuestions}</strong> preguntas</div>
              <div style="grid-column: 1 / -1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                <i class="ri-user-shared-line" style="color: #10b981;"></i> Audiencia: <strong>${targetDesc}</strong>
              </div>
            </div>
          </div>

          <!-- Footer con Acciones y Contador de Respuestas -->
          <div>
            <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 0.75rem; border-top: 1px solid var(--color-border); margin-bottom: 0.75rem;">
              <div style="font-size: 0.85rem; font-weight: 600; color: var(--color-text-main);">
                <i class="ri-chat-check-line" style="color: #10b981; margin-right: 0.25rem;"></i>
                <span>${responseCount}</span> <span style="font-weight: 400; color: var(--color-text-muted); font-size: 0.78rem;">${responseCount === 1 ? 'respuesta' : 'respuestas'}</span>
              </div>
              <div style="display: flex; gap: 0.35rem;">
                <button class="btn-copy-link btn btn-outline btn-sm" title="Copiar Enlace Directo" data-id="${s.id}" data-token="${s.public_token || s.id}" style="padding: 0.35rem 0.6rem;">
                  <i class="ri-link"></i>
                </button>
                <button class="btn-preview-survey btn btn-outline btn-sm" title="Vista Previa en Vivo" data-id="${s.id}" style="padding: 0.35rem 0.6rem;">
                  <i class="ri-eye-line"></i>
                </button>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
              <button class="btn-view-results btn btn-outline btn-sm" data-id="${s.id}" style="font-weight: 600; border-color: var(--color-border);">
                <i class="ri-bar-chart-2-line"></i> Resultados
              </button>
              <button class="btn-edit-survey btn btn-primary btn-sm" data-id="${s.id}" style="font-weight: 600;">
                <i class="ri-edit-line"></i> Editar
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Listeners en tarjetas
    grid.querySelectorAll('.btn-edit-survey').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const survey = surveys.find(s => s.id === id);
        if (survey) openSurveyBuilder(survey);
      });
    });

    grid.querySelectorAll('.btn-view-results').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const survey = surveys.find(s => s.id === id);
        if (survey) openSurveyResults(survey);
      });
    });

    grid.querySelectorAll('.btn-preview-survey').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const survey = surveys.find(s => s.id === id);
        if (survey) openLivePreviewModal(survey);
      });
    });

    grid.querySelectorAll('.btn-copy-link').forEach(btn => {
      btn.addEventListener('click', () => {
        const token = btn.dataset.token;
        const id = btn.dataset.id;
        const currentOrigin = window.location.origin;
        const surveyUrl = `${currentOrigin}/encuesta.html?id=${id}`;
        
        navigator.clipboard.writeText(surveyUrl).then(() => {
          if (window.Swal) {
            window.Swal.fire({
              icon: 'success',
              title: '¡Enlace Copiado!',
              html: `Enlace directo copiado al portapapeles:<br><strong style="font-size: 0.85rem; word-break: break-all;">${surveyUrl}</strong>`,
              timer: 2500,
              showConfirmButton: false
            });
          } else {
            alert(`Enlace copiado: ${surveyUrl}`);
          }
        }).catch(() => {
          prompt('Copia este enlace directo:', surveyUrl);
        });
      });
    });
  }

  // ==============================================================================
  // BUILDER DE ENCUESTAS (VISUAL INTERACTIVO CON PÁGINAS Y BLOQUES)
  // ==============================================================================
  async function openSurveyBuilder(surveyToEdit) {
    // Si no es edición, inicializar encuesta por defecto con 1 página y bloques de muestra
    let survey = surveyToEdit ? JSON.parse(JSON.stringify(surveyToEdit)) : {
      id: null,
      title: 'Nueva Encuesta de Satisfacción',
      description: 'Tu opinión es muy importante para nosotros. Por favor, califica tu experiencia.',
      category: 'satisfaction',
      status: 'draft',
      target_type: 'all',
      target_merchants: [],
      target_users: [],
      settings: {
        allow_anonymous: false,
        show_progress_bar: true,
        submit_button_text: 'Enviar Encuesta',
        success_title: '¡Muchas gracias por tu tiempo!',
        success_message: 'Tus respuestas han sido recibidas y nos ayudan a optimizar nuestro servicio.',
        estimated_minutes: 2,
        popup_on_login: false,
        popup_frequency: 'daily',
        popup_message: ''
      },
      pages: [
        {
          id: 'page-1',
          title: 'Evaluación del Servicio',
          description: 'Queremos conocer tu opinión sobre el cumplimiento y calidad',
          blocks: [
            {
              id: 'block-' + Date.now() + '-1',
              type: 'rating_stars',
              title: '¿Cómo calificarías la calidad general de nuestro servicio?',
              description: 'Selecciona de 1 a 5 estrellas',
              required: true,
              settings: { max_stars: 5 }
            },
            {
              id: 'block-' + Date.now() + '-2',
              type: 'rating_csat_emojis',
              title: '¿Cuál es tu nivel de satisfacción con los tiempos de despacho?',
              description: 'Elige la carita que mejor represente tu experiencia',
              required: true
            },
            {
              id: 'block-' + Date.now() + '-3',
              type: 'text_long',
              title: '¿Tienes alguna sugerencia o comentario para mejorar?',
              description: 'Escribe aquí cualquier observación o detalle',
              required: false,
              settings: { placeholder: 'Cuéntanos tu opinión...' }
            }
          ]
        }
      ]
    };

    // Asegurar estructura de páginas y settings
    if (!survey.settings) survey.settings = {};
    if (survey.settings.popup_on_login === undefined) survey.settings.popup_on_login = false;
    if (!survey.settings.popup_frequency) survey.settings.popup_frequency = 'daily';
    if (!survey.settings.popup_message) survey.settings.popup_message = '';

    if (!Array.isArray(survey.pages) || survey.pages.length === 0) {
      survey.pages = [{ id: 'page-1', title: 'Página 1', description: '', blocks: [] }];
    }

    let activePageIndex = 0;

    // Obtener lista de comercios para selector de audiencia
    let comerciosList = [];
    try {
      const { data: coms } = await supabase.from('v_comercios_config').select('nombre, sigla').order('nombre');
      if (coms) comerciosList = coms;
    } catch (e) {
      console.warn('No se pudo cargar v_comercios_config:', e);
    }

    container.innerHTML = `
      <div style="max-width: 1100px; margin: 0 auto; padding-bottom: 3rem;">
        
        <!-- Header del Builder -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem; position: sticky; top: 0; background: var(--color-bg); z-index: 20; padding: 0.75rem 0; border-bottom: 1px solid var(--color-border);">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <button id="btn-back-to-list" class="btn btn-outline btn-sm" style="padding: 0.5rem 0.75rem;">
              <i class="ri-arrow-left-line"></i> Volver
            </button>
            <div>
              <h2 style="font-size: 1.35rem; font-weight: 700; color: var(--color-text-main); margin: 0;">
                ${survey.id ? 'Editar Encuesta' : 'Diseñar Nueva Encuesta'}
              </h2>
            </div>
          </div>

          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <button id="btn-preview-builder" class="btn btn-outline" style="display: flex; align-items: center; gap: 0.4rem;">
              <i class="ri-eye-line"></i> Vista Previa
            </button>
            <button id="btn-save-draft" class="btn btn-outline" style="border-color: var(--color-primary); color: var(--color-primary); display: flex; align-items: center; gap: 0.4rem;">
              <i class="ri-save-line"></i> Guardar Borrador
            </button>
            <button id="btn-publish-survey" class="btn btn-primary" style="display: flex; align-items: center; gap: 0.4rem;">
              <i class="ri-checkbox-circle-line"></i> ${survey.status === 'published' ? 'Guardar y Publicar' : 'Publicar Encuesta'}
            </button>
          </div>
        </div>

        <!-- Parámetros Generales de la Encuesta -->
        <div class="card" style="padding: 1.75rem; margin-bottom: 1.75rem;">
          <h4 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 1.25rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.6rem;">
            <div style="width: 34px; height: 34px; border-radius: var(--radius-md); background: rgba(37, 99, 235, 0.12); color: var(--color-primary); display: flex; align-items: center; justify-content: center; font-size: 1.15rem;">
              <i class="ri-settings-4-line"></i>
            </div>
            Configuración General
          </h4>

          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 1.25rem; margin-bottom: 1.25rem;">
            <div>
              <label class="form-label" style="font-weight: 600; font-size: 0.88rem; margin-bottom: 0.4rem;">Título de la Encuesta <span style="color: var(--color-danger);">*</span></label>
              <input type="text" id="builder-survey-title" class="survey-form-control" value="${escapeHtmlAttr(survey.title)}" placeholder="Ej: Encuesta de Satisfacción Mensual..." style="font-weight: 600; font-size: 1rem;">
            </div>
            <div>
              <label class="form-label" style="font-weight: 600; font-size: 0.88rem; margin-bottom: 0.4rem;">Tipo / Categoría <span style="color: var(--color-danger);">*</span></label>
              <select id="builder-survey-category" class="survey-form-control">
                ${Object.entries(SURVEY_CATEGORIES).map(([key, cat]) => `
                  <option value="${key}" ${survey.category === key ? 'selected' : ''}>${cat.label}</option>
                `).join('')}
              </select>
            </div>
          </div>

          <div style="margin-bottom: 1.5rem;">
            <label class="form-label" style="font-weight: 600; font-size: 0.88rem; margin-bottom: 0.4rem;">Descripción o Mensaje Introductorio</label>
            <textarea id="builder-survey-desc" class="survey-form-control" rows="2" placeholder="Explica a los encuestados el objetivo de esta consulta...">${escapeHtml(survey.description || '')}</textarea>
          </div>

          <!-- Audiencia Objetivo con Tarjetas Seleccionables -->
          <div style="border-top: 1px solid var(--color-border); padding-top: 1.25rem;">
            <label class="form-label" style="font-weight: 600; font-size: 0.88rem; margin-bottom: 0.75rem; display: block;">
              <i class="ri-user-shared-line" style="color: #10b981; margin-right: 0.35rem;"></i> Audiencia y Destinatarios
            </label>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; margin-bottom: 0.75rem;">
              
              <div class="audience-card ${survey.target_type === 'all' ? 'active' : ''}" data-type="all">
                <input type="radio" name="builder-target-type" value="all" ${survey.target_type === 'all' ? 'checked' : ''} style="display: none;">
                <div class="audience-icon"><i class="ri-global-line"></i></div>
                <div>
                  <div style="font-weight: 700; font-size: 0.92rem; color: var(--color-text-main); margin-bottom: 0.2rem;">Todos los Comercios</div>
                  <div style="font-size: 0.78rem; color: var(--color-text-muted); line-height: 1.35;">Visible para todos los clientes en su Dashboard</div>
                </div>
              </div>

              <div class="audience-card ${survey.target_type === 'specific_merchants' ? 'active' : ''}" data-type="specific_merchants">
                <input type="radio" name="builder-target-type" value="specific_merchants" ${survey.target_type === 'specific_merchants' ? 'checked' : ''} style="display: none;">
                <div class="audience-icon"><i class="ri-store-3-line"></i></div>
                <div>
                  <div style="font-weight: 700; font-size: 0.92rem; color: var(--color-text-main); margin-bottom: 0.2rem;">Comercios Específicos</div>
                  <div style="font-size: 0.78rem; color: var(--color-text-muted); line-height: 1.35;">Selecciona tiendas o razones sociales específicas</div>
                </div>
              </div>

              <div class="audience-card ${survey.target_type === 'public_link' ? 'active' : ''}" data-type="public_link">
                <input type="radio" name="builder-target-type" value="public_link" ${survey.target_type === 'public_link' ? 'checked' : ''} style="display: none;">
                <div class="audience-icon"><i class="ri-links-line"></i></div>
                <div>
                  <div style="font-weight: 700; font-size: 0.92rem; color: var(--color-text-main); margin-bottom: 0.2rem;">Enlace Público / Abierto</div>
                  <div style="font-size: 0.78rem; color: var(--color-text-muted); line-height: 1.35;">Acceso libre mediante link directo o código QR</div>
                </div>
              </div>

            </div>

            <!-- Panel selección comercios específicos -->
            <div id="builder-merchants-panel" style="display: ${survey.target_type === 'specific_merchants' ? 'block' : 'none'}; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1.25rem; margin-top: 0.75rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                <p style="font-size: 0.85rem; font-weight: 600; color: var(--color-text-main); margin: 0;">Marca los comercios que podrán responder:</p>
                <button type="button" id="btn-toggle-all-merchants" style="background: none; border: none; color: var(--color-primary); font-size: 0.8rem; font-weight: 600; cursor: pointer;">Seleccionar todos</button>
              </div>
              <div style="max-height: 180px; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.5rem; padding-right: 0.5rem;">
                ${comerciosList.map(c => `
                  <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; cursor: pointer; background: var(--color-surface); padding: 0.5rem 0.75rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
                    <input type="checkbox" class="merchant-target-check" value="${escapeHtmlAttr(c.nombre)}" ${(survey.target_merchants || []).includes(c.nombre) ? 'checked' : ''} style="accent-color: var(--color-primary); width: 16px; height: 16px;">
                    <span style="font-weight: 500;">${escapeHtml(c.nombre)}</span>
                  </label>
                `).join('')}
              </div>
            </div>
          </div>

          <!-- Automatización de Popup al Iniciar Sesión -->
          <div style="border-top: 1px solid var(--color-border); padding-top: 1.25rem; margin-top: 1.25rem;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap;">
              <div>
                <label style="font-weight: 700; font-size: 0.92rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.45rem; cursor: pointer; user-select: none;">
                  <input type="checkbox" id="builder-popup-login" ${survey.settings?.popup_on_login ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: var(--color-primary); cursor: pointer;">
                  <span>🔔 Mostrar Popup automático al iniciar sesión</span>
                </label>
                <p style="font-size: 0.8rem; color: var(--color-text-muted); margin: 0.25rem 0 0 1.6rem; max-width: 620px; line-height: 1.4;">
                  Muestra una ventana emergente a los usuarios/comercios destinatarios cuando entran a su Dashboard, invitándolos a responder la encuesta hasta que la completen.
                </p>
              </div>

              <button type="button" id="btn-test-popup" class="btn btn-outline btn-sm" style="display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.8rem; padding: 0.4rem 0.8rem;">
                <i class="ri-play-circle-line" style="color: var(--color-primary); font-size: 1.05rem;"></i> Probar Popup
              </button>
            </div>

            <div id="builder-popup-options" style="display: ${survey.settings?.popup_on_login ? 'grid' : 'none'}; grid-template-columns: 1fr 2fr; gap: 1.25rem; margin-top: 1rem; background: var(--color-bg); padding: 1.15rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
              <div>
                <label class="form-label" style="font-weight: 600; font-size: 0.82rem; margin-bottom: 0.35rem;">Frecuencia del Popup</label>
                <select id="builder-popup-frequency" class="survey-form-control" style="font-size: 0.88rem;">
                  <option value="daily" ${survey.settings?.popup_frequency === 'daily' || !survey.settings?.popup_frequency ? 'selected' : ''}>Diario (1 vez al día hasta completar)</option>
                  <option value="every_login" ${survey.settings?.popup_frequency === 'every_login' ? 'selected' : ''}>En cada inicio de sesión hasta completar</option>
                </select>
              </div>

              <div>
                <label class="form-label" style="font-weight: 600; font-size: 0.82rem; margin-bottom: 0.35rem;">Mensaje / Frase de Invitación (Opcional)</label>
                <input type="text" id="builder-popup-message" class="survey-form-control" value="${escapeHtmlAttr(survey.settings?.popup_message || '')}" placeholder="Ej: ¡Hola! Tu opinión nos ayuda a optimizar los despachos de tus pedidos. ¿Tienes 2 minutos?" style="font-size: 0.88rem;">
              </div>
            </div>
          </div>

        </div>

        <!-- Gestor de Páginas (Pestañas Superiores) -->
        <div style="margin-bottom: 1.25rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 0.85rem 1.25rem; display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 0.75rem; overflow-x: auto; max-width: 100%;">
            <span style="font-size: 0.85rem; font-weight: 700; color: var(--color-text-main); display: inline-flex; align-items: center; gap: 0.4rem; white-space: nowrap;">
              <i class="ri-file-list-3-line" style="color: var(--color-primary);"></i> Páginas:
            </span>
            <div id="builder-pages-tabs" class="builder-pages-tabs-wrapper">
              <!-- Pestañas de páginas renderizadas dinámicamente -->
            </div>
          </div>
          <button id="btn-add-page" class="btn btn-outline btn-sm" style="border: 1.5px solid var(--color-primary); color: var(--color-primary); font-weight: 700; display: inline-flex; align-items: center; gap: 0.35rem; border-radius: var(--radius-full); padding: 0.45rem 1rem; white-space: nowrap;">
            <i class="ri-add-line"></i> Añadir Página
          </button>
        </div>

        <!-- Contenido de la Página Activa -->
        <div class="card" style="padding: 1.75rem; margin-bottom: 2rem;">
          
          <!-- Encabezado de la Página Activa -->
          <div style="background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1.25rem; margin-bottom: 1.5rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <span id="page-badge-indicator" class="survey-badge" style="background: rgba(37, 99, 235, 0.12); color: var(--color-primary); font-size: 0.8rem; font-weight: 700;">
                <i class="ri-file-edit-line"></i> Página 1
              </span>
              <button id="btn-delete-page" class="btn btn-outline btn-sm" style="color: var(--color-danger); border-color: rgba(239, 68, 68, 0.3); padding: 0.35rem 0.75rem; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 0.35rem;" title="Eliminar esta página">
                <i class="ri-delete-bin-line"></i> Eliminar Página
              </button>
            </div>

            <div style="display: flex; flex-direction: column; gap: 0.75rem;">
              <div>
                <label class="form-label" style="font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">Título de esta Página <span style="color: var(--color-danger);">*</span></label>
                <input type="text" id="builder-page-title" class="survey-form-control" placeholder="Ej: Evaluación de Tiempos de Entrega y Empaque" style="font-weight: 700; font-size: 1.05rem;" value="">
              </div>
              <div>
                <label class="form-label" style="font-weight: 500; font-size: 0.82rem; color: var(--color-text-muted); margin-bottom: 0.35rem;">Descripción o Instrucciones de la Página (Opcional)</label>
                <input type="text" id="builder-page-desc" class="survey-form-control" placeholder="Ej: Califica los siguientes aspectos de la preparación de tus pedidos..." style="font-size: 0.88rem;" value="">
              </div>
            </div>
          </div>

          <!-- Paleta para Añadir Bloques Rediseñada -->
          <div style="background: var(--color-surface); border: 1.5px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem 1.5rem; margin-bottom: 1.75rem; box-shadow: var(--shadow-sm);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <div style="font-size: 0.85rem; font-weight: 700; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem; text-transform: uppercase; letter-spacing: 0.5px;">
                <i class="ri-add-circle-fill" style="color: var(--color-primary); font-size: 1.1rem;"></i> Añadir Elementos a esta Página:
              </div>
              <span style="font-size: 0.75rem; color: var(--color-text-muted);">Haz clic en un elemento para agregarlo</span>
            </div>
            
            <div style="display: flex; flex-direction: column; gap: 0.85rem;">
              
              <!-- Fila 1: Calificación -->
              <div style="display: flex; align-items: center; gap: 0.65rem; flex-wrap: wrap;">
                <span style="font-size: 0.78rem; font-weight: 700; color: #f59e0b; width: 110px; display: inline-flex; align-items: center; gap: 0.3rem;">
                  <i class="ri-star-line"></i> Calificación:
                </span>
                <button type="button" class="survey-palette-btn btn-add-block" data-type="rating_stars"><i class="ri-star-fill" style="color: #f59e0b;"></i> Estrellas 1-5</button>
                <button type="button" class="survey-palette-btn btn-add-block" data-type="rating_csat_emojis"><i class="ri-emotion-line" style="color: #10b981;"></i> Emojis CSAT</button>
                <button type="button" class="survey-palette-btn btn-add-block" data-type="rating_nps"><i class="ri-dashboard-3-line" style="color: #3b82f6;"></i> NPS 0-10</button>
                <button type="button" class="survey-palette-btn btn-add-block" data-type="rating_numeric"><i class="ri-numbers-line" style="color: #8b5cf6;"></i> Escala Numérica</button>
              </div>

              <!-- Fila 2: Preguntas -->
              <div style="display: flex; align-items: center; gap: 0.65rem; flex-wrap: wrap;">
                <span style="font-size: 0.78rem; font-weight: 700; color: var(--color-primary); width: 110px; display: inline-flex; align-items: center; gap: 0.3rem;">
                  <i class="ri-questionnaire-line"></i> Preguntas:
                </span>
                <button type="button" class="survey-palette-btn btn-add-block" data-type="single_choice"><i class="ri-radio-button-line" style="color: var(--color-primary);"></i> Opción Única</button>
                <button type="button" class="survey-palette-btn btn-add-block" data-type="multiple_choice"><i class="ri-checkbox-line" style="color: #10b981;"></i> Selección Múltiple</button>
                <button type="button" class="survey-palette-btn btn-add-block" data-type="text_short"><i class="ri-input-field" style="color: #06b6d4;"></i> Texto Corto</button>
                <button type="button" class="survey-palette-btn btn-add-block" data-type="text_long"><i class="ri-file-text-line" style="color: #8b5cf6;"></i> Texto Largo</button>
                <button type="button" class="survey-palette-btn btn-add-block" data-type="boolean"><i class="ri-toggle-line" style="color: #f59e0b;"></i> Sí / No</button>
                <button type="button" class="survey-palette-btn btn-add-block" data-type="dropdown"><i class="ri-arrow-down-s-line" style="color: #ec4899;"></i> Desplegable</button>
              </div>

              <!-- Fila 3: Contenido -->
              <div style="display: flex; align-items: center; gap: 0.65rem; flex-wrap: wrap;">
                <span style="font-size: 0.78rem; font-weight: 700; color: var(--color-text-muted); width: 110px; display: inline-flex; align-items: center; gap: 0.3rem;">
                  <i class="ri-layout-line"></i> Contenido:
                </span>
                <button type="button" class="survey-palette-btn btn-add-block" data-type="text_header"><i class="ri-heading" style="color: var(--color-text-main);"></i> Encabezado</button>
                <button type="button" class="survey-palette-btn btn-add-block" data-type="text_paragraph"><i class="ri-paragraph" style="color: var(--color-text-muted);"></i> Párrafo</button>
                <button type="button" class="survey-palette-btn btn-add-block" data-type="text_callout"><i class="ri-information-line" style="color: #3b82f6;"></i> Aviso / Callout</button>
                <button type="button" class="survey-palette-btn btn-add-block" data-type="divider"><i class="ri-separator" style="color: var(--color-text-muted);"></i> Separador</button>
              </div>

            </div>
          </div>

          <!-- Lista de Bloques en la Página Activa -->
          <div id="builder-blocks-list">
            <!-- Renderizado dinámico de bloques -->
          </div>
        </div>

      </div>
    `;

    // Sincronizar datos iniciales de la página activa
    function refreshPageTabs() {
      const tabsContainer = document.getElementById('builder-pages-tabs');
      if (!tabsContainer) return;

      tabsContainer.innerHTML = survey.pages.map((p, idx) => `
        <button type="button" class="builder-page-tab ${idx === activePageIndex ? 'active' : ''}" data-index="${idx}">
          <i class="ri-file-list-line"></i> Página ${idx + 1}
          <span class="tab-count-badge">${p.blocks ? p.blocks.length : 0}</span>
        </button>
      `).join('');

      tabsContainer.querySelectorAll('.builder-page-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          saveCurrentPageInputs();
          activePageIndex = parseInt(tab.dataset.index, 10);
          refreshPageContent();
          refreshPageTabs();
        });
      });

      // Actualizar visibilidad de botón eliminar página (no permitir eliminar si queda 1)
      const delBtn = document.getElementById('btn-delete-page');
      if (delBtn) {
        delBtn.style.display = survey.pages.length > 1 ? 'inline-flex' : 'none';
      }
    }

    function refreshPageContent() {
      const page = survey.pages[activePageIndex];
      if (!page) return;

      const pageBadge = document.getElementById('page-badge-indicator');
      if (pageBadge) {
        pageBadge.innerHTML = `<i class="ri-file-edit-line"></i> Página ${activePageIndex + 1} de ${survey.pages.length}`;
      }

      const pageTitleInput = document.getElementById('builder-page-title');
      const pageDescInput = document.getElementById('builder-page-desc');
      if (pageTitleInput) pageTitleInput.value = page.title || '';
      if (pageDescInput) pageDescInput.value = page.description || '';

      renderBlocksList();
    }

    function saveCurrentPageInputs() {
      const page = survey.pages[activePageIndex];
      if (!page) return;

      const pageTitleInput = document.getElementById('builder-page-title');
      const pageDescInput = document.getElementById('builder-page-desc');
      if (pageTitleInput) page.title = pageTitleInput.value.trim() || `Página ${activePageIndex + 1}`;
      if (pageDescInput) page.description = pageDescInput.value.trim();
    }

    function renderBlocksList() {
      const blocksContainer = document.getElementById('builder-blocks-list');
      if (!blocksContainer) return;

      const page = survey.pages[activePageIndex];
      if (!page.blocks || page.blocks.length === 0) {
        blocksContainer.innerHTML = `
          <div style="text-align: center; padding: 2.5rem 1rem; color: var(--color-text-muted); border: 1px dashed var(--color-border); border-radius: var(--radius-md);">
            <i class="ri-drag-drop-line" style="font-size: 2.5rem; opacity: 0.5; margin-bottom: 0.5rem; display: inline-block;"></i>
            <p style="font-size: 0.9rem; margin: 0;">Esta página no tiene preguntas ni bloques aún. Usa los botones superiores para añadir elementos.</p>
          </div>
        `;
        return;
      }

      blocksContainer.innerHTML = page.blocks.map((block, bIdx) => {
        const typeInfo = BLOCK_TYPES[block.type] || { label: block.type, icon: 'ri-question-line' };
        const isQuestion = typeInfo.group !== 'content';

        return `
          <div class="builder-block-card" data-index="${bIdx}">
            
            <div class="builder-block-header">
              <div style="display: flex; align-items: center; gap: 0.65rem;">
                <span class="block-num-badge">#${bIdx + 1}</span>
                <span class="survey-badge" style="background: rgba(37, 99, 235, 0.1); color: var(--color-primary); border: 1px solid rgba(37, 99, 235, 0.25); font-weight: 600; padding: 0.35rem 0.65rem;">
                  <i class="${typeInfo.icon}"></i> ${typeInfo.label}
                </span>
              </div>
              
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                ${isQuestion ? `
                  <label class="survey-required-pill ${block.required ? 'active' : ''}" data-index="${bIdx}">
                    <input type="checkbox" class="block-required-toggle" data-index="${bIdx}" ${block.required ? 'checked' : ''} style="display: none;">
                    <i class="${block.required ? 'ri-checkbox-circle-fill' : 'ri-checkbox-blank-circle-line'}"></i>
                    <span>${block.required ? 'Obligatoria' : 'Opcional'}</span>
                  </label>
                ` : ''}
                <div style="display: inline-flex; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 2px;">
                  <button type="button" class="btn-block-action btn-block-move-up" data-index="${bIdx}" title="Mover arriba" ${bIdx === 0 ? 'disabled' : ''}>
                    <i class="ri-arrow-up-line"></i>
                  </button>
                  <button type="button" class="btn-block-action btn-block-move-down" data-index="${bIdx}" title="Mover abajo" ${bIdx === page.blocks.length - 1 ? 'disabled' : ''}>
                    <i class="ri-arrow-down-line"></i>
                  </button>
                  <button type="button" class="btn-block-action btn-block-duplicate" data-index="${bIdx}" title="Duplicar bloque">
                    <i class="ri-file-copy-line"></i>
                  </button>
                  <button type="button" class="btn-block-action btn-block-delete" data-index="${bIdx}" title="Eliminar bloque" style="color: var(--color-danger);">
                    <i class="ri-delete-bin-line"></i>
                  </button>
                </div>
              </div>
            </div>

            <!-- Cuerpo del Bloque -->
            <div style="display: flex; flex-direction: column; gap: 0.85rem;">
              <div>
                <label class="form-label" style="font-size: 0.82rem; font-weight: 600; margin-bottom: 0.35rem;">
                  ${isQuestion ? 'Título / Enunciado de la Pregunta <span style="color: var(--color-danger);">*</span>' : 'Título o Encabezado <span style="color: var(--color-danger);">*</span>'}
                </label>
                <input type="text" class="block-title-input survey-form-control" data-index="${bIdx}" value="${escapeHtmlAttr(block.title || '')}" placeholder="Escribe aquí el título..." style="font-weight: 600; font-size: 0.95rem;">
              </div>

              ${block.type !== 'divider' ? `
                <div>
                  <label class="form-label" style="font-size: 0.78rem; color: var(--color-text-muted); margin-bottom: 0.35rem;">Descripción auxiliar o texto explicativo (opcional)</label>
                  <input type="text" class="block-desc-input survey-form-control" data-index="${bIdx}" value="${escapeHtmlAttr(block.description || '')}" placeholder="Texto secundario o ayuda..." style="font-size: 0.85rem;">
                </div>
              ` : ''}

              <!-- Opciones dinámicas para single_choice, multiple_choice y dropdown -->
              ${['single_choice', 'multiple_choice', 'dropdown'].includes(block.type) ? `
                <div style="background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.85rem; margin-top: 0.25rem;">
                  <div style="font-size: 0.82rem; font-weight: 600; color: var(--color-text-main); margin-bottom: 0.65rem; display: flex; justify-content: space-between; align-items: center;">
                    <span style="display: flex; align-items: center; gap: 0.35rem;"><i class="ri-list-check-2" style="color: var(--color-primary);"></i> Opciones de respuesta:</span>
                    <button type="button" class="btn-add-option btn btn-outline btn-sm" data-index="${bIdx}" style="padding: 0.25rem 0.65rem; font-size: 0.78rem; display: inline-flex; align-items: center; gap: 0.3rem;">
                      <i class="ri-add-line"></i> Añadir Opción
                    </button>
                  </div>
                  <div class="block-options-container" data-index="${bIdx}" style="display: flex; flex-direction: column; gap: 0.5rem;">
                    ${(block.options || ['Opción 1', 'Opción 2']).map((opt, oIdx) => `
                      <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span style="font-size: 0.78rem; font-weight: 600; color: var(--color-text-muted); width: 22px; text-align: right;">${oIdx + 1}.</span>
                        <input type="text" class="block-option-input survey-form-control" data-block-idx="${bIdx}" data-option-idx="${oIdx}" value="${escapeHtmlAttr(opt)}" style="font-size: 0.88rem; padding: 0.45rem 0.75rem;">
                        <button type="button" class="btn-del-option btn btn-outline btn-sm" data-block-idx="${bIdx}" data-option-idx="${oIdx}" title="Eliminar opción" style="color: var(--color-danger); border-color: var(--color-border); padding: 0.45rem 0.6rem; flex-shrink: 0;">
                          <i class="ri-close-line"></i>
                        </button>
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}

            </div>

          </div>
        `;
      }).join('');

      // Listeners de inputs y controles de bloques
      blocksContainer.querySelectorAll('.block-title-input').forEach(inp => {
        inp.addEventListener('input', (e) => {
          const idx = parseInt(e.target.dataset.index, 10);
          page.blocks[idx].title = e.target.value;
        });
      });

      blocksContainer.querySelectorAll('.block-desc-input').forEach(inp => {
        inp.addEventListener('input', (e) => {
          const idx = parseInt(e.target.dataset.index, 10);
          page.blocks[idx].description = e.target.value;
        });
      });

      blocksContainer.querySelectorAll('.survey-required-pill').forEach(pill => {
        pill.addEventListener('click', (e) => {
          e.preventDefault();
          const idx = parseInt(pill.dataset.index, 10);
          page.blocks[idx].required = !page.blocks[idx].required;
          const isReq = page.blocks[idx].required;
          pill.classList.toggle('active', isReq);
          const icon = pill.querySelector('i');
          const span = pill.querySelector('span');
          if (icon) icon.className = isReq ? 'ri-checkbox-circle-fill' : 'ri-checkbox-blank-circle-line';
          if (span) span.textContent = isReq ? 'Obligatoria' : 'Opcional';
        });
      });

      blocksContainer.querySelectorAll('.btn-block-move-up').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.index, 10);
          if (idx > 0) {
            const item = page.blocks.splice(idx, 1)[0];
            page.blocks.splice(idx - 1, 0, item);
            renderBlocksList();
          }
        });
      });

      blocksContainer.querySelectorAll('.btn-block-move-down').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.index, 10);
          if (idx < page.blocks.length - 1) {
            const item = page.blocks.splice(idx, 1)[0];
            page.blocks.splice(idx + 1, 0, item);
            renderBlocksList();
          }
        });
      });

      blocksContainer.querySelectorAll('.btn-block-duplicate').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.index, 10);
          const cloned = JSON.parse(JSON.stringify(page.blocks[idx]));
          cloned.id = 'block-' + Date.now();
          cloned.title = (cloned.title || '') + ' (Copia)';
          page.blocks.splice(idx + 1, 0, cloned);
          renderBlocksList();
        });
      });

      blocksContainer.querySelectorAll('.btn-block-delete').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.index, 10);
          page.blocks.splice(idx, 1);
          renderBlocksList();
          refreshPageTabs();
        });
      });

      // Opciones dinámicas
      blocksContainer.querySelectorAll('.btn-add-option').forEach(btn => {
        btn.addEventListener('click', () => {
          const bIdx = parseInt(btn.dataset.index, 10);
          if (!page.blocks[bIdx].options) page.blocks[bIdx].options = [];
          page.blocks[bIdx].options.push(`Opción ${page.blocks[bIdx].options.length + 1}`);
          renderBlocksList();
        });
      });

      blocksContainer.querySelectorAll('.block-option-input').forEach(inp => {
        inp.addEventListener('input', (e) => {
          const bIdx = parseInt(e.target.dataset.blockIdx, 10);
          const oIdx = parseInt(e.target.dataset.optionIdx, 10);
          page.blocks[bIdx].options[oIdx] = e.target.value;
        });
      });

      blocksContainer.querySelectorAll('.btn-del-option').forEach(btn => {
        btn.addEventListener('click', () => {
          const bIdx = parseInt(btn.dataset.blockIdx, 10);
          const oIdx = parseInt(btn.dataset.optionIdx, 10);
          if (page.blocks[bIdx].options.length > 1) {
            page.blocks[bIdx].options.splice(oIdx, 1);
            renderBlocksList();
          }
        });
      });
    }

    // Inicializar pestañas y bloques
    refreshPageTabs();
    refreshPageContent();

    // Eventos de la barra superior del Builder
    document.getElementById('btn-back-to-list')?.addEventListener('click', () => {
      renderMainAdminView();
    });

    document.getElementById('btn-add-page')?.addEventListener('click', () => {
      saveCurrentPageInputs();
      survey.pages.push({
        id: 'page-' + Date.now(),
        title: `Página ${survey.pages.length + 1}`,
        description: '',
        blocks: []
      });
      activePageIndex = survey.pages.length - 1;
      refreshPageTabs();
      refreshPageContent();
    });

    document.getElementById('btn-delete-page')?.addEventListener('click', () => {
      if (survey.pages.length <= 1) return;
      if (confirm(`¿Estás seguro de eliminar la Página ${activePageIndex + 1}?`)) {
        survey.pages.splice(activePageIndex, 1);
        activePageIndex = Math.max(0, activePageIndex - 1);
        refreshPageTabs();
        refreshPageContent();
      }
    });

    // Añadir bloques desde la paleta
    container.querySelectorAll('.btn-add-block').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        const page = survey.pages[activePageIndex];
        if (!page.blocks) page.blocks = [];

        let newBlock = {
          id: 'block-' + Date.now(),
          type: type,
          title: '',
          description: '',
          required: true,
          settings: {}
        };

        if (type === 'rating_stars') {
          newBlock.title = '¿Cómo calificarías este aspecto del servicio?';
          newBlock.settings = { max_stars: 5 };
        } else if (type === 'rating_csat_emojis') {
          newBlock.title = '¿Qué tan satisfecho te encuentras con nuestro servicio?';
        } else if (type === 'rating_nps') {
          newBlock.title = '¿Qué tan probable es que recomiendes WMS STOCKA a un colega o conocido?';
        } else if (type === 'rating_numeric') {
          newBlock.title = 'En una escala del 1 al 10, ¿cómo calificarías nuestra rapidez?';
          newBlock.settings = { min: 1, max: 10, min_label: 'Muy lento', max_label: 'Muy rápido' };
        } else if (['single_choice', 'dropdown'].includes(type)) {
          newBlock.title = 'Por favor selecciona una alternativa:';
          newBlock.options = ['Excelente', 'Bueno', 'Regular', 'Deficiente'];
        } else if (type === 'multiple_choice') {
          newBlock.title = '¿Cuáles de los siguientes servicios utilizas habitualmente?';
          newBlock.options = ['Almacenamiento', 'Picking & Packing', 'Despachos SameDay / Flex', 'Logística Inversa'];
        } else if (type === 'text_short') {
          newBlock.title = 'Nombre de contacto o referencia:';
        } else if (type === 'text_long') {
          newBlock.title = 'Comentarios adicionales o sugerencias:';
          newBlock.required = false;
        } else if (type === 'boolean') {
          newBlock.title = '¿Recibiste la notificación de despacho a tiempo?';
        } else if (type === 'text_header') {
          newBlock.title = 'Información sobre el servicio de logística';
          newBlock.required = false;
        } else if (type === 'text_paragraph') {
          newBlock.title = 'Por favor responde las siguientes preguntas para continuar optimizando los tiempos en bodega.';
          newBlock.required = false;
        } else if (type === 'text_callout') {
          newBlock.title = 'Recuerda que tus respuestas son confidenciales y se procesan para auditoría de calidad.';
          newBlock.required = false;
        } else if (type === 'divider') {
          newBlock.title = 'Separador';
          newBlock.required = false;
        }

        page.blocks.push(newBlock);
        renderBlocksList();
        refreshPageTabs();
      });
    });

    // Manejo de selección de audiencia con tarjetas
    container.querySelectorAll('.audience-card').forEach(card => {
      card.addEventListener('click', () => {
        const type = card.dataset.type;
        survey.target_type = type;
        
        container.querySelectorAll('.audience-card').forEach(c => {
          const isActive = c.dataset.type === type;
          c.classList.toggle('active', isActive);
          const radio = c.querySelector('input[type="radio"]');
          if (radio) radio.checked = isActive;
        });

        const panel = document.getElementById('builder-merchants-panel');
        if (panel) {
          panel.style.display = survey.target_type === 'specific_merchants' ? 'block' : 'none';
        }
      });
    });

    // Botón seleccionar / deseleccionar todos los comercios
    document.getElementById('btn-toggle-all-merchants')?.addEventListener('click', (e) => {
      e.preventDefault();
      const checkboxes = container.querySelectorAll('.merchant-target-check');
      const allChecked = Array.from(checkboxes).every(c => c.checked);
      checkboxes.forEach(c => { c.checked = !allChecked; });
      e.target.textContent = allChecked ? 'Seleccionar todos' : 'Deseleccionar todos';
    });

    // Toggle visibilidad opciones del popup
    const popupToggle = document.getElementById('builder-popup-login');
    const popupOptions = document.getElementById('builder-popup-options');
    popupToggle?.addEventListener('change', (e) => {
      if (popupOptions) {
        popupOptions.style.display = e.target.checked ? 'grid' : 'none';
      }
    });

    // Probar popup desde el builder
    document.getElementById('btn-test-popup')?.addEventListener('click', () => {
      saveCurrentPageInputs();
      const tempSurvey = JSON.parse(JSON.stringify(survey));
      tempSurvey.title = document.getElementById('builder-survey-title')?.value.trim() || tempSurvey.title;
      tempSurvey.description = document.getElementById('builder-survey-desc')?.value.trim() || tempSurvey.description;
      tempSurvey.category = document.getElementById('builder-survey-category')?.value || tempSurvey.category;
      tempSurvey.settings = tempSurvey.settings || {};
      tempSurvey.settings.popup_on_login = true;
      tempSurvey.settings.popup_frequency = document.getElementById('builder-popup-frequency')?.value || 'daily';
      tempSurvey.settings.popup_message = document.getElementById('builder-popup-message')?.value.trim() || '';

      showSurveyLoginModal(tempSurvey, null, null, { isTest: true });
    });

    // Guardar borrador o publicar
    async function saveSurvey(newStatus) {
      saveCurrentPageInputs();
      const titleInput = document.getElementById('builder-survey-title');
      const descInput = document.getElementById('builder-survey-desc');
      const catInput = document.getElementById('builder-survey-category');

      const title = titleInput ? titleInput.value.trim() : '';
      if (!title) {
        if (window.Swal) {
          window.Swal.fire({ icon: 'warning', title: 'Título Requerido', text: 'Por favor ingresa un título para la encuesta.' });
        } else {
          alert('Por favor ingresa un título para la encuesta.');
        }
        return;
      }

      survey.title = title;
      survey.description = descInput ? descInput.value.trim() : '';
      survey.category = catInput ? catInput.value : 'satisfaction';
      if (newStatus) survey.status = newStatus;

      // Actualizar settings del popup
      survey.settings = survey.settings || {};
      const popupCheck = document.getElementById('builder-popup-login');
      const popupFreq = document.getElementById('builder-popup-frequency');
      const popupMsg = document.getElementById('builder-popup-message');
      if (popupCheck) survey.settings.popup_on_login = popupCheck.checked;
      if (popupFreq) survey.settings.popup_frequency = popupFreq.value;
      if (popupMsg) survey.settings.popup_message = popupMsg.value.trim();

      // Obtener comercios seleccionados si aplica
      if (survey.target_type === 'specific_merchants') {
        const checked = Array.from(container.querySelectorAll('.merchant-target-check:checked')).map(c => c.value);
        survey.target_merchants = checked;
      } else {
        survey.target_merchants = [];
      }

      // Validar que al menos haya 1 pregunta en alguna página
      let totalQ = 0;
      survey.pages.forEach(p => {
        if (p.blocks) totalQ += p.blocks.length;
      });
      if (totalQ === 0) {
        if (window.Swal) {
          window.Swal.fire({ icon: 'warning', title: 'Sin Preguntas', text: 'Agrega al menos una pregunta o bloque antes de guardar.' });
        } else {
          alert('Agrega al menos una pregunta o bloque antes de guardar.');
        }
        return;
      }

      const saveBtn = newStatus === 'published' ? document.getElementById('btn-publish-survey') : document.getElementById('btn-save-draft');
      const originalHtml = saveBtn ? saveBtn.innerHTML : '';
      if (saveBtn) saveBtn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Guardando...';

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const payload = {
          title: survey.title,
          description: survey.description,
          category: survey.category,
          status: survey.status,
          target_type: survey.target_type,
          target_merchants: survey.target_merchants,
          target_users: survey.target_users || [],
          pages: survey.pages,
          settings: survey.settings,
          created_by: session ? session.user.id : null
        };

        let result;
        if (survey.id) {
          result = await supabase.from('surveys').update(payload).eq('id', survey.id).select().single();
        } else {
          result = await supabase.from('surveys').insert(payload).select().single();
        }

        if (result.error) throw result.error;

        if (window.Swal) {
          window.Swal.fire({
            icon: 'success',
            title: newStatus === 'published' ? '¡Encuesta Publicada!' : '¡Borrador Guardado!',
            text: newStatus === 'published' 
              ? 'La encuesta ya está disponible para que los comercios respondan.' 
              : 'Los cambios se han guardado con éxito.',
            timer: 2000,
            showConfirmButton: false
          });
        }

        await loadData();
      } catch (err) {
        console.error('Error al guardar encuesta:', err);
        if (window.Swal) {
          window.Swal.fire({ icon: 'error', title: 'Error al Guardar', text: err.message || err });
        } else {
          alert('Error al guardar: ' + (err.message || err));
        }
        if (saveBtn) saveBtn.innerHTML = originalHtml;
      }
    }

    document.getElementById('btn-save-draft')?.addEventListener('click', () => saveSurvey('draft'));
    document.getElementById('btn-publish-survey')?.addEventListener('click', () => saveSurvey('published'));
    document.getElementById('btn-preview-builder')?.addEventListener('click', () => {
      saveCurrentPageInputs();
      survey.title = document.getElementById('builder-survey-title')?.value || survey.title;
      survey.description = document.getElementById('builder-survey-desc')?.value || survey.description;
      openLivePreviewModal(survey);
    });
  }

  // ==============================================================================
  // MODAL DE VISTA PREVIA EN VIVO
  // ==============================================================================
  function openLivePreviewModal(survey) {
    const existingModal = document.getElementById('survey-preview-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'survey-preview-modal';
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(4px);
      z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 1rem;
    `;

    modal.innerHTML = `
      <div style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); width: 100%; max-width: 780px; max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: var(--shadow-lg);">
        <div style="padding: 1rem 1.25rem; border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center; background: var(--color-bg);">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span class="survey-badge" style="background: rgba(37, 99, 235, 0.12); color: var(--color-primary); font-size: 0.75rem;">
              <i class="ri-eye-line"></i> Modo Vista Previa
            </span>
            <span style="font-size: 0.85rem; color: var(--color-text-muted);">(Las respuestas aquí no se guardarán)</span>
          </div>
          <button id="btn-close-preview" style="background: transparent; border: none; font-size: 1.25rem; cursor: pointer; color: var(--color-text-muted);">&times;</button>
        </div>

        <div id="preview-wizard-container" style="padding: 1.5rem; overflow-y: auto; flex: 1;">
          <!-- Se inyecta el wizard interactivo -->
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('btn-close-preview')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    renderSurveyWizard(survey, document.getElementById('preview-wizard-container'), {
      isPreview: true,
      onComplete: () => {
        if (window.Swal) {
          window.Swal.fire({
            icon: 'success',
            title: '¡Simulación Completada!',
            text: 'Así es exactamente como tus clientes verán y responderán esta encuesta.',
            confirmButtonColor: 'var(--color-primary)'
          });
        }
        modal.remove();
      }
    });
  }

  // ==============================================================================
  // VISTA DE ANALÍTICA Y RESULTADOS DE ENCUESTA
  // ==============================================================================
  async function openSurveyResults(survey) {
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 350px;">
        <i class="ri-loader-4-line ri-spin" style="font-size: 2.5rem; color: var(--color-primary); margin-bottom: 1rem;"></i>
        <p style="color: var(--color-text-muted);">Cargando analítica de respuestas...</p>
      </div>
    `;

    try {
      const { data: responses, error } = await supabase
        .from('survey_responses')
        .select('*')
        .eq('survey_id', survey.id)
        .order('completed_at', { ascending: false });

      if (error) throw error;

      renderResultsView(survey, responses || []);
    } catch (err) {
      console.error('Error al cargar respuestas:', err);
      container.innerHTML = `
        <div class="card" style="padding: 2rem; text-align: center; max-width: 600px; margin: 2rem auto;">
          <i class="ri-error-warning-line" style="font-size: 2.5rem; color: var(--color-danger); margin-bottom: 0.75rem;"></i>
          <h3>Error al cargar resultados</h3>
          <p style="color: var(--color-text-muted);">${err.message || err}</p>
          <button id="btn-back-from-err" class="btn btn-outline" style="margin-top: 1rem;">Volver al Listado</button>
        </div>
      `;
      document.getElementById('btn-back-from-err')?.addEventListener('click', () => renderMainAdminView());
    }
  }

  function renderResultsView(survey, responses) {
    const totalResponses = responses.length;

    // Calcular métricas agregadas
    let sumScore = 0;
    let scoreCount = 0;
    let promoters = 0;
    let passives = 0;
    let detractors = 0;
    let npsTotal = 0;

    responses.forEach(r => {
      if (r.rating_score !== null && r.rating_score !== undefined) {
        sumScore += Number(r.rating_score);
        scoreCount++;
      }
      if (r.nps_score !== null && r.nps_score !== undefined) {
        npsTotal++;
        if (r.nps_score >= 9) promoters++;
        else if (r.nps_score >= 7) passives++;
        else detractors++;
      }
    });

    const avgScore = scoreCount > 0 ? (sumScore / scoreCount).toFixed(1) : '—';
    const npsScore = npsTotal > 0 ? Math.round(((promoters - detractors) / npsTotal) * 100) : null;

    container.innerHTML = `
      <div style="max-width: 1300px; margin: 0 auto; padding-bottom: 3rem;">
        
        <!-- Header de Resultados -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <button id="btn-back-to-surveys" class="btn btn-outline btn-sm" style="padding: 0.5rem 0.75rem;">
              <i class="ri-arrow-left-line"></i> Volver
            </button>
            <div>
              <h2 style="font-size: 1.4rem; font-weight: 700; color: var(--color-text-main); margin: 0;">
                Resultados: ${escapeHtml(survey.title)}
              </h2>
              <span style="font-size: 0.82rem; color: var(--color-text-muted);">
                ${totalResponses} ${totalResponses === 1 ? 'respuesta registrada' : 'respuestas registradas'}
              </span>
            </div>
          </div>

          <div style="display: flex; gap: 0.5rem;">
            <button id="btn-export-excel" class="btn btn-outline" style="border-color: #10b981; color: #10b981; display: flex; align-items: center; gap: 0.4rem;">
              <i class="ri-file-excel-2-line"></i> Exportar a Excel (.xlsx)
            </button>
          </div>
        </div>

        <!-- KPIs de la Encuesta -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1.75rem;">
          
          <div class="card" style="padding: 1.25rem;">
            <div style="font-size: 0.8rem; color: var(--color-text-muted); font-weight: 500;">Respuestas Completadas</div>
            <div style="font-size: 1.8rem; font-weight: 700; color: var(--color-text-main); margin-top: 0.25rem;">
              ${totalResponses}
            </div>
            <div style="font-size: 0.75rem; color: #10b981; margin-top: 0.25rem;"><i class="ri-check-line"></i> 100% Finalizadas</div>
          </div>

          <div class="card" style="padding: 1.25rem;">
            <div style="font-size: 0.8rem; color: var(--color-text-muted); font-weight: 500;">Calificación Promedio</div>
            <div style="font-size: 1.8rem; font-weight: 700; color: #f59e0b; margin-top: 0.25rem; display: flex; align-items: center; gap: 0.35rem;">
              ${avgScore} <i class="ri-star-fill" style="font-size: 1.4rem;"></i>
            </div>
            <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.25rem;">Escala 1 a 5 estrellas</div>
          </div>

          ${npsScore !== null ? `
            <div class="card" style="padding: 1.25rem;">
              <div style="font-size: 0.8rem; color: var(--color-text-muted); font-weight: 500;">Net Promoter Score (NPS)</div>
              <div style="font-size: 1.8rem; font-weight: 700; color: ${npsScore > 50 ? '#10b981' : npsScore > 0 ? '#3b82f6' : '#ef4444'}; margin-top: 0.25rem;">
                ${npsScore > 0 ? '+' : ''}${npsScore}
              </div>
              <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.25rem;">
                ${promoters} Promotores (${Math.round((promoters/npsTotal)*100)}%) | ${detractors} Detractores (${Math.round((detractors/npsTotal)*100)}%)
              </div>
            </div>
          ` : `
            <div class="card" style="padding: 1.25rem;">
              <div style="font-size: 0.8rem; color: var(--color-text-muted); font-weight: 500;">Estado de la Encuesta</div>
              <div style="font-size: 1.2rem; font-weight: 700; color: var(--color-text-main); margin-top: 0.5rem;">
                <span class="survey-badge ${STATUS_MAP[survey.status]?.badgeClass || 'badge-success'}">
                  ${STATUS_MAP[survey.status]?.label || survey.status}
                </span>
              </div>
            </div>
          `}

          <div class="card" style="padding: 1.25rem;">
            <div style="font-size: 0.8rem; color: var(--color-text-muted); font-weight: 500;">Comercios Participantes</div>
            <div style="font-size: 1.8rem; font-weight: 700; color: var(--color-primary); margin-top: 0.25rem;">
              ${new Set(responses.map(r => r.comercio).filter(Boolean)).size}
            </div>
            <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.25rem;">Comercios únicos</div>
          </div>

        </div>

        <!-- Desglose por Preguntas -->
        <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--color-text-main); margin-bottom: 1rem;">
          <i class="ri-pie-chart-line" style="color: var(--color-primary);"></i> Desglose de Respuestas por Pregunta
        </h3>

        <div id="survey-questions-breakdown" style="display: flex; flex-direction: column; gap: 1rem; margin-bottom: 2.5rem;">
          <!-- Inyección de desglose -->
        </div>

        <!-- Tabla de Respuestas Individuales -->
        <div class="card" style="padding: 1.5rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.75rem;">
            <h3 style="font-size: 1.1rem; font-weight: 700; color: var(--color-text-main); margin: 0;">
              <i class="ri-table-line" style="color: var(--color-accent);"></i> Registro de Respuestas Individuales
            </h3>
            <input type="text" id="filter-responses-input" placeholder="Buscar por comercio o correo..." class="survey-form-control" style="max-width: 300px; font-size: 0.85rem;">
          </div>

          <div class="table-responsive">
            <table class="data-table" style="width: 100%; font-size: 0.85rem;">
              <thead>
                <tr>
                  <th>Fecha y Hora</th>
                  <th>Comercio</th>
                  <th>Usuario / Contacto</th>
                  <th style="text-align: center;">Calificación</th>
                  <th style="text-align: center;">NPS</th>
                  <th style="text-align: right;">Acciones</th>
                </tr>
              </thead>
              <tbody id="survey-responses-tbody">
                <!-- Filas de respuestas -->
              </tbody>
            </table>
          </div>
        </div>

      </div>
    `;

    document.getElementById('btn-back-to-surveys')?.addEventListener('click', () => renderMainAdminView());

    // Renderizar Desglose por Pregunta
    renderBreakdownBlocks(survey, responses);

    // Renderizar Tabla de Respuestas
    renderResponsesTable(survey, responses);

    // Exportar a Excel
    document.getElementById('btn-export-excel')?.addEventListener('click', () => {
      exportResponsesToExcel(survey, responses);
    });
  }

  function renderBreakdownBlocks(survey, responses) {
    const breakdownContainer = document.getElementById('survey-questions-breakdown');
    if (!breakdownContainer) return;

    if (responses.length === 0) {
      breakdownContainer.innerHTML = `
        <div class="card" style="padding: 2.5rem; text-align: center; color: var(--color-text-muted);">
          Aún no hay respuestas registradas para esta encuesta.
        </div>
      `;
      return;
    }

    // Extraer todos los bloques de preguntas de todas las páginas
    const questionBlocks = [];
    if (Array.isArray(survey.pages)) {
      survey.pages.forEach(p => {
        if (Array.isArray(p.blocks)) {
          p.blocks.forEach(b => {
            if (!['text_header', 'text_paragraph', 'text_callout', 'divider'].includes(b.type)) {
              questionBlocks.push(b);
            }
          });
        }
      });
    }

    breakdownContainer.innerHTML = questionBlocks.map((b, idx) => {
      const typeInfo = BLOCK_TYPES[b.type] || { label: b.type };

      // Analizar respuestas para este bloque
      const answersForBlock = responses.map(r => r.answers ? r.answers[b.id] : null).filter(v => v !== null && v !== undefined && v !== '');

      let contentHtml = '';

      if (['rating_stars', 'rating_csat_emojis'].includes(b.type)) {
        // Conteo 1 a 5
        const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        let sum = 0;
        answersForBlock.forEach(v => {
          const num = parseInt(v, 10);
          if (counts[num] !== undefined) {
            counts[num]++;
            sum += num;
          }
        });
        const avg = answersForBlock.length > 0 ? (sum / answersForBlock.length).toFixed(1) : 0;

        contentHtml = `
          <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;">
            <div style="font-size: 2.2rem; font-weight: 800; color: #f59e0b;">${avg}</div>
            <div>
              <div style="font-size: 0.85rem; font-weight: 600; color: var(--color-text-main);">Promedio de puntuación</div>
              <div style="font-size: 0.75rem; color: var(--color-text-muted);">${answersForBlock.length} votos en total</div>
            </div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 0.4rem;">
            ${[5, 4, 3, 2, 1].map(star => {
              const count = counts[star];
              const pct = answersForBlock.length > 0 ? Math.round((count / answersForBlock.length) * 100) : 0;
              const emojiChar = b.type === 'rating_csat_emojis' ? CSAT_EMOJIS[star - 1]?.emoji : '★';
              return `
                <div style="display: flex; align-items: center; gap: 0.75rem; font-size: 0.82rem;">
                  <span style="width: 80px; display: flex; align-items: center; gap: 0.25rem;">
                    <strong>${star}</strong> <span style="color: #f59e0b;">${emojiChar}</span>
                  </span>
                  <div style="flex: 1; height: 10px; background: var(--color-bg); border-radius: 99px; overflow: hidden;">
                    <div style="width: ${pct}%; height: 100%; background: #f59e0b; border-radius: 99px;"></div>
                  </div>
                  <span style="width: 65px; text-align: right; color: var(--color-text-muted); font-size: 0.78rem;">${count} (${pct}%)</span>
                </div>
              `;
            }).join('')}
          </div>
        `;
      } else if (b.type === 'rating_nps') {
        const counts = Array(11).fill(0);
        answersForBlock.forEach(v => {
          const num = parseInt(v, 10);
          if (num >= 0 && num <= 10) counts[num]++;
        });
        contentHtml = `
          <div style="display: grid; grid-template-columns: repeat(11, 1fr); gap: 0.25rem; margin-top: 0.75rem;">
            ${counts.map((cnt, n) => {
              const isDetractor = n <= 6;
              const isPassive = n >= 7 && n <= 8;
              const color = isDetractor ? '#ef4444' : isPassive ? '#f59e0b' : '#10b981';
              return `
                <div style="text-align: center;">
                  <div style="font-size: 0.75rem; font-weight: 700; color: ${color}; margin-bottom: 0.25rem;">${cnt}</div>
                  <div style="height: 32px; background: ${color}; color: #fff; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 0.85rem; font-weight: 700;">
                    ${n}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;
      } else if (['single_choice', 'multiple_choice', 'dropdown', 'boolean'].includes(b.type)) {
        const optionCounts = {};
        const opts = b.options || (b.type === 'boolean' ? ['Sí', 'No'] : []);
        opts.forEach(o => optionCounts[o] = 0);

        answersForBlock.forEach(v => {
          if (Array.isArray(v)) {
            v.forEach(subV => {
              optionCounts[subV] = (optionCounts[subV] || 0) + 1;
            });
          } else {
            optionCounts[v] = (optionCounts[v] || 0) + 1;
          }
        });

        const totalVotes = Object.values(optionCounts).reduce((a, b) => a + b, 0);

        contentHtml = `
          <div style="display: flex; flex-direction: column; gap: 0.5rem;">
            ${Object.entries(optionCounts).map(([opt, cnt]) => {
              const pct = totalVotes > 0 ? Math.round((cnt / totalVotes) * 100) : 0;
              return `
                <div style="display: flex; flex-direction: column; gap: 0.2rem;">
                  <div style="display: flex; justify-content: space-between; font-size: 0.82rem; font-weight: 500;">
                    <span>${escapeHtml(opt)}</span>
                    <span style="color: var(--color-text-muted);">${cnt} votos (${pct}%)</span>
                  </div>
                  <div style="height: 8px; background: var(--color-bg); border-radius: 99px; overflow: hidden;">
                    <div style="width: ${pct}%; height: 100%; background: var(--color-primary); border-radius: 99px;"></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;
      } else {
        // Texto libre / comentarios
        contentHtml = `
          <div style="max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem;">
            ${answersForBlock.length > 0 ? answersForBlock.slice(0, 10).map(txt => `
              <div style="background: var(--color-bg); padding: 0.65rem 0.85rem; border-radius: var(--radius-md); font-size: 0.85rem; border-left: 3px solid var(--color-primary);">
                "${escapeHtml(String(txt))}"
              </div>
            `).join('') : '<span style="color: var(--color-text-muted); font-size: 0.8rem;">Sin respuestas de texto escritas.</span>'}
          </div>
        `;
      }

      return `
        <div class="card" style="padding: 1.25rem;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;">
            <div>
              <span class="survey-badge" style="background: var(--color-bg); color: var(--color-primary); font-size: 0.75rem; margin-bottom: 0.35rem;">
                ${typeInfo.label}
              </span>
              <h4 style="font-size: 1rem; font-weight: 700; color: var(--color-text-main); margin: 0;">
                #${idx + 1}. ${escapeHtml(b.title)}
              </h4>
            </div>
            <span style="font-size: 0.75rem; color: var(--color-text-muted);">${answersForBlock.length} respuestas</span>
          </div>
          ${contentHtml}
        </div>
      `;
    }).join('');
  }

  function renderResponsesTable(survey, responses) {
    const tbody = document.getElementById('survey-responses-tbody');
    if (!tbody) return;

    if (responses.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">
            No hay respuestas disponibles.
          </td>
        </tr>
      `;
      return;
    }

    function renderRows(items) {
      tbody.innerHTML = items.map(r => {
        const dateStr = new Date(r.completed_at || r.created_at).toLocaleString('es-CL', {
          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        const ratingDisplay = r.rating_score !== null && r.rating_score !== undefined
          ? `<span style="color: #f59e0b; font-weight: 700;"><i class="ri-star-fill"></i> ${r.rating_score}</span>`
          : '—';

        let npsDisplay = '—';
        if (r.nps_score !== null && r.nps_score !== undefined) {
          const color = r.nps_score >= 9 ? '#10b981' : r.nps_score >= 7 ? '#f59e0b' : '#ef4444';
          npsDisplay = `<span style="background: ${color}; color: #fff; padding: 0.15rem 0.45rem; border-radius: 4px; font-weight: 700; font-size: 0.75rem;">${r.nps_score}</span>`;
        }

        return `
          <tr>
            <td style="font-size: 0.8rem; color: var(--color-text-muted); white-space: nowrap;">${dateStr}</td>
            <td style="font-weight: 600; color: var(--color-text-main);">${escapeHtml(r.comercio || 'Invitado')}</td>
            <td>
              <div style="font-weight: 500;">${escapeHtml(r.user_name || 'Anónimo')}</div>
              <div style="font-size: 0.75rem; color: var(--color-text-muted);">${escapeHtml(r.user_email || '—')}</div>
            </td>
            <td style="text-align: center;">${ratingDisplay}</td>
            <td style="text-align: center;">${npsDisplay}</td>
            <td style="text-align: right;">
              <button class="btn-inspect-response btn btn-outline btn-sm" data-id="${r.id}" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;">
                <i class="ri-eye-line"></i> Ver Respuestas
              </button>
            </td>
          </tr>
        `;
      }).join('');

      tbody.querySelectorAll('.btn-inspect-response').forEach(btn => {
        btn.addEventListener('click', () => {
          const respId = btn.dataset.id;
          const found = responses.find(r => r.id === respId);
          if (found) openResponseInspectorModal(survey, found);
        });
      });
    }

    renderRows(responses);

    document.getElementById('filter-responses-input')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      const filtered = responses.filter(r => {
        return (r.comercio && r.comercio.toLowerCase().includes(q)) ||
               (r.user_name && r.user_name.toLowerCase().includes(q)) ||
               (r.user_email && r.user_email.toLowerCase().includes(q));
      });
      renderRows(filtered);
    });
  }

  function openResponseInspectorModal(survey, response) {
    const existingModal = document.getElementById('response-inspect-modal');
    if (existingModal) existingModal.remove();

    const dateStr = new Date(response.completed_at || response.created_at).toLocaleString('es-CL');

    const modal = document.createElement('div');
    modal.id = 'response-inspect-modal';
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(4px);
      z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 1rem;
    `;

    // Extraer preguntas
    const allQuestions = [];
    if (Array.isArray(survey.pages)) {
      survey.pages.forEach(p => {
        if (Array.isArray(p.blocks)) {
          p.blocks.forEach(b => {
            if (!['text_header', 'text_paragraph', 'text_callout', 'divider'].includes(b.type)) {
              allQuestions.push(b);
            }
          });
        }
      });
    }

    modal.innerHTML = `
      <div style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); width: 100%; max-width: 680px; max-height: 85vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: var(--shadow-lg);">
        <div style="padding: 1rem 1.25rem; border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center; background: var(--color-bg);">
          <div>
            <h4 style="margin: 0; font-size: 1.05rem; font-weight: 700; color: var(--color-text-main);">
              Detalle de Respuesta Individual
            </h4>
            <span style="font-size: 0.75rem; color: var(--color-text-muted);">
              ${escapeHtml(response.comercio)} • ${dateStr}
            </span>
          </div>
          <button id="btn-close-inspect" style="background: transparent; border: none; font-size: 1.25rem; cursor: pointer; color: var(--color-text-muted);">&times;</button>
        </div>

        <div style="padding: 1.25rem; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 1rem;">
          ${allQuestions.map((q, idx) => {
            const ans = response.answers ? response.answers[q.id] : null;
            let displayAns = '<em>Sin respuesta</em>';
            if (ans !== null && ans !== undefined && ans !== '') {
              if (Array.isArray(ans)) displayAns = ans.join(', ');
              else if (q.type === 'rating_stars') displayAns = `<strong style="color: #f59e0b;">★ ${ans} / 5</strong>`;
              else if (q.type === 'rating_csat_emojis') {
                const em = CSAT_EMOJIS[parseInt(ans, 10) - 1];
                displayAns = `<span style="font-size: 1.2rem;">${em?.emoji || ''}</span> <strong>${em?.label || ans}</strong>`;
              } else if (q.type === 'rating_nps') {
                displayAns = `<strong>${ans} / 10</strong>`;
              } else {
                displayAns = `<strong>${escapeHtml(String(ans))}</strong>`;
              }
            }

            return `
              <div style="background: var(--color-bg); padding: 0.85rem 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
                <div style="font-size: 0.78rem; font-weight: 600; color: var(--color-text-muted); margin-bottom: 0.25rem;">
                  Pregunta #${idx + 1}: ${escapeHtml(q.title)}
                </div>
                <div style="font-size: 0.9rem; color: var(--color-text-main); margin-top: 0.25rem;">
                  ${displayAns}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('btn-close-inspect')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  function exportResponsesToExcel(survey, responses) {
    if (!window.XLSX) {
      alert('La librería SheetJS (XLSX) no está cargada.');
      return;
    }

    const questionBlocks = [];
    if (Array.isArray(survey.pages)) {
      survey.pages.forEach(p => {
        if (Array.isArray(p.blocks)) {
          p.blocks.forEach(b => {
            if (!['text_header', 'text_paragraph', 'text_callout', 'divider'].includes(b.type)) {
              questionBlocks.push(b);
            }
          });
        }
      });
    }

    const rows = responses.map((r, rIdx) => {
      const row = {
        '#': rIdx + 1,
        'Fecha': new Date(r.completed_at || r.created_at).toLocaleString('es-CL'),
        'Comercio': r.comercio || 'Invitado',
        'Nombre': r.user_name || 'Anónimo',
        'Email': r.user_email || '—',
        'Puntuación Global': r.rating_score || '',
        'NPS Score': r.nps_score !== null ? r.nps_score : ''
      };

      questionBlocks.forEach(q => {
        const val = r.answers ? r.answers[q.id] : '';
        row[q.title] = Array.isArray(val) ? val.join(', ') : (val !== null && val !== undefined ? String(val) : '');
      });

      return row;
    });

    const worksheet = window.XLSX.utils.json_to_sheet(rows);
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Respuestas');

    const cleanTitle = (survey.title || 'Encuesta').replace(/[^a-zA-Z0-9_\-]/g, '_').substring(0, 30);
    const fileName = `Encuesta_${cleanTitle}_${new Date().toISOString().split('T')[0]}.xlsx`;

    window.XLSX.writeFile(workbook, fileName);
  }

  // Carga inicial
  await loadData();
}

// ==============================================================================
// VISTA CLIENTE (renderSurveysClient - En Dashboard de Comercios)
// ==============================================================================

export async function renderSurveysClient(targetContainer) {
  const container = targetContainer || document.getElementById('app-content');
  if (!container) return;

  injectSurveyStyles();

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 300px;">
      <i class="ri-loader-4-line ri-spin" style="font-size: 2.2rem; color: var(--color-primary); margin-bottom: 0.75rem;"></i>
      <p style="color: var(--color-text-muted); font-size: 0.9rem;">Cargando tus encuestas...</p>
    </div>
  `;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      container.innerHTML = '<div class="alert alert-danger">Debes iniciar sesión para ver tus encuestas.</div>';
      return;
    }

    // Obtener perfil del usuario para comercio
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, email, full_name, comercio, role')
      .eq('id', session.user.id)
      .single();

    const userCommerce = profile ? profile.comercio : 'no asignado';
    const userId = session.user.id;

    // Obtener encuestas publicadas
    const { data: surveysData, error: surveysErr } = await supabase
      .from('surveys')
      .select('*')
      .eq('status', 'published')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (surveysErr) throw surveysErr;

    // Obtener respuestas previas del usuario/comercio
    const { data: myResponses, error: respErr } = await supabase
      .from('survey_responses')
      .select('id, survey_id, completed_at')
      .or(`user_id.eq.${userId},comercio.eq.${userCommerce}`);

    const answeredSurveyIds = new Set((myResponses || []).map(r => r.survey_id));

    // Filtrar encuestas que aplican al usuario
    const applicableSurveys = (surveysData || []).filter(s => {
      if (s.target_type === 'all' || s.target_type === 'public_link') return true;
      if (s.target_type === 'specific_merchants') {
        const merchants = Array.isArray(s.target_merchants) ? s.target_merchants : [];
        return merchants.some(m => m.toLowerCase() === userCommerce.toLowerCase());
      }
      if (s.target_type === 'specific_users') {
        const users = Array.isArray(s.target_users) ? s.target_users : [];
        return users.includes(userId) || (profile?.email && users.includes(profile.email.toLowerCase()));
      }
      return false;
    });

    const pendingSurveys = applicableSurveys.filter(s => !answeredSurveyIds.has(s.id));
    const completedSurveys = applicableSurveys.filter(s => answeredSurveyIds.has(s.id));

    container.innerHTML = `
      <div style="max-width: 1000px; margin: 0 auto; padding-bottom: 2.5rem;">
        
        <div style="margin-bottom: 1.5rem;">
          <h1 style="font-size: 1.5rem; font-weight: 700; color: var(--color-text-main); margin-bottom: 0.25rem;">
            <i class="ri-survey-line" style="color: var(--color-primary); margin-right: 0.5rem;"></i>Encuestas & Feedback
          </h1>
          <p style="color: var(--color-text-muted); font-size: 0.9rem; margin: 0;">
            Tu opinión nos permite mejorar constantemente el empaque, almacenamiento y despacho de tus pedidos.
          </p>
        </div>

        <!-- Pestañas de estado -->
        <div style="display: flex; gap: 0.5rem; border-bottom: 1px solid var(--color-border); margin-bottom: 1.5rem;">
          <button id="tab-client-pending" class="filter-btn btn btn-outline active" style="border-radius: var(--radius-md) var(--radius-md) 0 0; border-bottom: none; font-weight: 600;">
            Pendientes (${pendingSurveys.length})
          </button>
          <button id="tab-client-completed" class="filter-btn btn btn-outline" style="border-radius: var(--radius-md) var(--radius-md) 0 0; border-bottom: none; font-weight: 600;">
            Respondidas (${completedSurveys.length})
          </button>
        </div>

        <!-- Contenedor de encuestas de cliente -->
        <div id="client-surveys-list">
          <!-- Renderizado dinámico -->
        </div>

      </div>
    `;

    function renderList(listType) {
      const listContainer = document.getElementById('client-surveys-list');
      if (!listContainer) return;

      const items = listType === 'pending' ? pendingSurveys : completedSurveys;

      if (items.length === 0) {
        listContainer.innerHTML = `
          <div class="card" style="padding: 3rem; text-align: center;">
            <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(16, 185, 129, 0.12); color: #10b981; display: flex; align-items: center; justify-content: center; font-size: 1.8rem; margin: 0 auto 1rem auto;">
              <i class="ri-checkbox-circle-line"></i>
            </div>
            <h3 style="font-size: 1.15rem; color: var(--color-text-main); margin-bottom: 0.4rem;">
              ${listType === 'pending' ? '¡Estás al día!' : 'No tienes encuestas respondidas aún'}
            </h3>
            <p style="color: var(--color-text-muted); font-size: 0.85rem; max-width: 450px; margin: 0 auto;">
              ${listType === 'pending' ? 'No tienes encuestas de satisfacción pendientes en este momento.' : 'Cuando completes encuestas, aparecerán registradas en este historial.'}
            </p>
          </div>
        `;
        return;
      }

      listContainer.innerHTML = items.map(s => {
        const cat = SURVEY_CATEGORIES[s.category] || SURVEY_CATEGORIES.custom;
        const isDone = answeredSurveyIds.has(s.id);
        const estMins = s.settings?.estimated_minutes || 2;

        return `
          <div class="card" style="padding: 1.5rem; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
            <div style="flex: 1; min-width: 260px;">
              <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                <span class="survey-badge" style="background: ${cat.bgColor}; color: ${cat.color};">
                  <i class="${cat.icon}"></i> ${cat.label}
                </span>
                <span style="font-size: 0.78rem; color: var(--color-text-muted);">
                  <i class="ri-time-line"></i> ~${estMins} min
                </span>
              </div>
              <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--color-text-main); margin-bottom: 0.35rem;">
                ${escapeHtml(s.title)}
              </h3>
              <p style="font-size: 0.85rem; color: var(--color-text-muted); margin: 0; line-height: 1.4;">
                ${escapeHtml(s.description || 'Sin descripción.')}
              </p>
            </div>

            <div>
              ${isDone ? `
                <span class="survey-badge badge-success" style="padding: 0.4rem 0.85rem; font-size: 0.85rem;">
                  <i class="ri-checkbox-circle-fill"></i> Respondida
                </span>
              ` : `
                <button class="btn-respond-survey btn btn-primary" data-id="${s.id}" style="display: flex; align-items: center; gap: 0.4rem; padding: 0.6rem 1.2rem;">
                  <span>Responder</span> <i class="ri-arrow-right-line"></i>
                </button>
              `}
            </div>
          </div>
        `;
      }).join('');

      listContainer.querySelectorAll('.btn-respond-survey').forEach(btn => {
        btn.addEventListener('click', () => {
          const sId = btn.dataset.id;
          const survey = pendingSurveys.find(s => s.id === sId);
          if (survey) {
            startClientSurveyWizard(survey, profile);
          }
        });
      });
    }

    renderList('pending');

    const tabPending = document.getElementById('tab-client-pending');
    const tabCompleted = document.getElementById('tab-client-completed');

    tabPending?.addEventListener('click', () => {
      tabPending.classList.add('active');
      tabCompleted.classList.remove('active');
      renderList('pending');
    });

    tabCompleted?.addEventListener('click', () => {
      tabCompleted.classList.add('active');
      tabPending.classList.remove('active');
      renderList('completed');
    });

  } catch (err) {
    console.error('Error al cargar encuestas de cliente:', err);
    container.innerHTML = `<div class="alert alert-danger">Error: ${err.message || err}</div>`;
  }
}

function startClientSurveyWizard(survey, profile) {
  const container = document.getElementById('app-content');
  if (!container) return;

  renderSurveyWizard(survey, container, {
    isPreview: false,
    userProfile: profile,
    onComplete: () => {
      renderSurveysClient(container);
    }
  });
}

// ==============================================================================
// WIZARD INTERACTIVO MULTI-PÁGINA (UTILIZADO EN PREVIEW, CLIENTE Y STANDALONE)
// ==============================================================================

export function renderSurveyWizard(survey, container, options = {}) {
  const isPreview = options.isPreview || false;
  const userProfile = options.userProfile || null;
  const onComplete = options.onComplete || (() => {});

  const pages = Array.isArray(survey.pages) && survey.pages.length > 0 
    ? survey.pages 
    : [{ id: 'p-default', title: survey.title, description: survey.description, blocks: [] }];

  let currentPageIdx = 0;
  const answers = {};

  function renderCurrentPage() {
    const page = pages[currentPageIdx];
    const totalPages = pages.length;
    const progressPct = Math.round(((currentPageIdx + 1) / totalPages) * 100);

    container.innerHTML = `
      <div style="max-width: 720px; margin: 0 auto;">
        
        <!-- Progreso y Cabecera de Página -->
        ${survey.settings?.show_progress_bar !== false ? `
          <div style="margin-bottom: 1.5rem;">
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem; font-weight: 600; color: var(--color-text-muted); margin-bottom: 0.35rem;">
              <span>Paso ${currentPageIdx + 1} de ${totalPages}: ${escapeHtml(page.title || '')}</span>
              <span>${progressPct}%</span>
            </div>
            <div class="survey-progress-bar-wrap" style="margin: 0;">
              <div class="survey-progress-bar-fill" style="width: ${progressPct}%;"></div>
            </div>
          </div>
        ` : ''}

        <!-- Título y Descripción de la Página Actual -->
        <div style="margin-bottom: 1.75rem;">
          <h2 style="font-size: 1.35rem; font-weight: 700; color: var(--color-text-main); margin-bottom: 0.35rem;">
            ${escapeHtml(page.title || survey.title)}
          </h2>
          ${page.description ? `
            <p style="color: var(--color-text-muted); font-size: 0.9rem; margin: 0; line-height: 1.4;">
              ${escapeHtml(page.description)}
            </p>
          ` : ''}
        </div>

        <!-- Renderizado de Bloques de la Página -->
        <div id="wizard-blocks-container" style="display: flex; flex-direction: column; gap: 1.25rem; margin-bottom: 2rem;">
          ${(page.blocks || []).map((b, bIdx) => renderBlockInput(b, answers[b.id])).join('')}
        </div>

        <!-- Botones de Navegación del Wizard -->
        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--color-border); padding-top: 1.25rem;">
          <button type="button" id="btn-survey-wizard-prev" class="btn btn-outline" ${currentPageIdx === 0 ? 'disabled' : ''} style="display: flex; align-items: center; gap: 0.4rem; cursor: ${currentPageIdx === 0 ? 'not-allowed' : 'pointer'};">
            <i class="ri-arrow-left-line"></i> Anterior
          </button>

          ${currentPageIdx < totalPages - 1 ? `
            <button type="button" id="btn-survey-wizard-next" class="btn btn-primary" style="display: flex; align-items: center; gap: 0.4rem; padding: 0.6rem 1.5rem; cursor: pointer;">
              Siguiente <i class="ri-arrow-right-line"></i>
            </button>
          ` : `
            <button type="button" id="btn-survey-wizard-submit" class="btn btn-primary" style="display: flex; align-items: center; gap: 0.4rem; padding: 0.6rem 1.5rem; background: #10b981; border-color: #10b981; cursor: pointer;">
              <i class="ri-send-plane-fill"></i> ${escapeHtml(survey.settings?.submit_button_text || 'Enviar Encuesta')}
            </button>
          `}
        </div>

      </div>
    `;

    // Conectar interactividad de los bloques en esta página
    attachBlockEvents(page.blocks || []);

    // Botones de navegación con selección scoped al contenedor
    container.querySelector('#btn-survey-wizard-prev')?.addEventListener('click', () => {
      saveInputsToAnswers(page.blocks || []);
      if (currentPageIdx > 0) {
        currentPageIdx--;
        renderCurrentPage();
        scrollWizardTop();
      }
    });

    container.querySelector('#btn-survey-wizard-next')?.addEventListener('click', () => {
      saveInputsToAnswers(page.blocks || []);
      if (validateCurrentPage(page.blocks || [])) {
        currentPageIdx++;
        renderCurrentPage();
        scrollWizardTop();
      }
    });

    container.querySelector('#btn-survey-wizard-submit')?.addEventListener('click', async () => {
      saveInputsToAnswers(page.blocks || []);
      if (!validateCurrentPage(page.blocks || [])) return;
      await submitSurveyAnswers();
    });
  }

  function scrollWizardTop() {
    const parentScroll = container.closest('#survey-wizard-modal-inner') || container;
    if (parentScroll && parentScroll.scrollTop !== undefined) {
      parentScroll.scrollTop = 0;
    }
  }

  function renderBlockInput(block, currentValue) {
    const isRequired = block.required;

    let inputHtml = '';

    if (block.type === 'rating_stars') {
      const currentStar = currentValue ? parseInt(currentValue, 10) : 0;
      inputHtml = `
        <div class="star-rating-group" data-block-id="${block.id}">
          ${[5, 4, 3, 2, 1].map(n => `
            <input type="radio" id="star-${block.id}-${n}" name="rating-${block.id}" value="${n}" ${currentStar === n ? 'checked' : ''}>
            <label for="star-${block.id}-${n}" title="${STAR_LABELS[n-1]}">★</label>
          `).join('')}
        </div>
        <div class="star-label-feedback" data-block-id="${block.id}" style="font-size: 0.8rem; font-weight: 600; color: #f59e0b; height: 18px; margin-top: 0.25rem;">
          ${currentStar > 0 ? STAR_LABELS[currentStar - 1] : ''}
        </div>
      `;
    } else if (block.type === 'rating_csat_emojis') {
      const currentVal = currentValue ? parseInt(currentValue, 10) : 0;
      inputHtml = `
        <div class="csat-emojis-container" data-block-id="${block.id}">
          ${CSAT_EMOJIS.map(em => `
            <div class="csat-emoji-btn ${currentVal === em.value ? 'active' : ''}" data-value="${em.value}">
              <span class="emoji-char">${em.emoji}</span>
              <span class="emoji-label">${em.label}</span>
            </div>
          `).join('')}
        </div>
      `;
    } else if (block.type === 'rating_nps') {
      const currentVal = currentValue !== undefined && currentValue !== null ? parseInt(currentValue, 10) : -1;
      inputHtml = `
        <div class="nps-container" data-block-id="${block.id}">
          ${Array.from({ length: 11 }, (_, i) => {
            const catClass = i <= 6 ? 'detractor' : i <= 8 ? 'passive' : 'promoter';
            return `
              <div class="nps-btn ${catClass} ${currentVal === i ? 'active' : ''}" data-value="${i}">
                ${i}
              </div>
            `;
          }).join('')}
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.4rem;">
          <span>0 = Nada probable</span>
          <span>10 = Totalmente probable</span>
        </div>
      `;
    } else if (block.type === 'rating_numeric') {
      const min = block.settings?.min || 1;
      const max = block.settings?.max || 10;
      const count = max - min + 1;
      inputHtml = `
        <div class="nps-container" data-block-id="${block.id}">
          ${Array.from({ length: count }, (_, i) => {
            const val = min + i;
            return `
              <div class="nps-btn ${currentValue === val ? 'active' : ''}" data-value="${val}">
                ${val}
              </div>
            `;
          }).join('')}
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.4rem;">
          <span>${escapeHtml(block.settings?.min_label || 'Mínimo')}</span>
          <span>${escapeHtml(block.settings?.max_label || 'Máximo')}</span>
        </div>
      `;
    } else if (block.type === 'single_choice') {
      const opts = block.options || ['Opción 1', 'Opción 2'];
      inputHtml = `
        <div class="survey-choices-group" data-block-id="${block.id}" style="display: flex; flex-direction: column; gap: 0.4rem;">
          ${opts.map(o => `
            <div class="survey-choice-item ${currentValue === o ? 'selected' : ''}" data-value="${escapeHtmlAttr(o)}">
              <i class="${currentValue === o ? 'ri-checkbox-circle-fill' : 'ri-checkbox-blank-circle-line'}" style="font-size: 1.1rem;"></i>
              <span>${escapeHtml(o)}</span>
            </div>
          `).join('')}
        </div>
      `;
    } else if (block.type === 'multiple_choice') {
      const opts = block.options || ['Opción 1', 'Opción 2'];
      const selectedSet = new Set(Array.isArray(currentValue) ? currentValue : []);
      inputHtml = `
        <div class="survey-multi-group" data-block-id="${block.id}" style="display: flex; flex-direction: column; gap: 0.4rem;">
          ${opts.map(o => {
            const isSelected = selectedSet.has(o);
            return `
              <div class="survey-choice-item ${isSelected ? 'selected' : ''}" data-value="${escapeHtmlAttr(o)}">
                <i class="${isSelected ? 'ri-checkbox-fill' : 'ri-checkbox-blank-line'}" style="font-size: 1.1rem;"></i>
                <span>${escapeHtml(o)}</span>
              </div>
            `;
          }).join('')}
        </div>
      `;
    } else if (block.type === 'text_short') {
      inputHtml = `
        <input type="text" class="wizard-text-input survey-form-control" data-block-id="${block.id}" value="${escapeHtmlAttr(currentValue || '')}" placeholder="${escapeHtmlAttr(block.settings?.placeholder || 'Escribe tu respuesta...')}" style="font-size: 0.95rem; padding: 0.65rem 0.85rem;">
      `;
    } else if (block.type === 'text_long') {
      inputHtml = `
        <textarea class="wizard-textarea-input survey-form-control" data-block-id="${block.id}" rows="3" placeholder="${escapeHtmlAttr(block.settings?.placeholder || 'Escribe tus observaciones o comentarios detallados...')}" style="font-size: 0.95rem; padding: 0.65rem 0.85rem;">${escapeHtml(currentValue || '')}</textarea>
      `;
    } else if (block.type === 'boolean') {
      inputHtml = `
        <div class="survey-boolean-group" data-block-id="${block.id}" style="display: flex; gap: 0.75rem;">
          <div class="survey-choice-item ${currentValue === 'Sí' ? 'selected' : ''}" data-value="Sí" style="flex: 1; justify-content: center; font-weight: 600;">
            <i class="ri-thumb-up-line"></i> Sí
          </div>
          <div class="survey-choice-item ${currentValue === 'No' ? 'selected' : ''}" data-value="No" style="flex: 1; justify-content: center; font-weight: 600;">
            <i class="ri-thumb-down-line"></i> No
          </div>
        </div>
      `;
    } else if (block.type === 'dropdown') {
      const opts = block.options || ['Opción 1', 'Opción 2'];
      inputHtml = `
        <select class="wizard-select-input survey-form-control" data-block-id="${block.id}" style="font-size: 0.95rem; padding: 0.65rem 0.85rem;">
          <option value="">-- Selecciona una opción --</option>
          ${opts.map(o => `
            <option value="${escapeHtmlAttr(o)}" ${currentValue === o ? 'selected' : ''}>${escapeHtml(o)}</option>
          `).join('')}
        </select>
      `;
    } else if (block.type === 'text_header') {
      return `
        <div style="margin-top: 0.5rem;">
          <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--color-text-main); margin-bottom: 0.25rem;">
            ${escapeHtml(block.title)}
          </h3>
          ${block.description ? `<p style="font-size: 0.85rem; color: var(--color-text-muted); margin: 0;">${escapeHtml(block.description)}</p>` : ''}
        </div>
      `;
    } else if (block.type === 'text_paragraph') {
      return `
        <div style="font-size: 0.9rem; color: var(--color-text-muted); line-height: 1.5; background: var(--color-bg); padding: 0.85rem 1rem; border-radius: var(--radius-md);">
          ${escapeHtml(block.title)}
        </div>
      `;
    } else if (block.type === 'text_callout') {
      return `
        <div style="background: rgba(37, 99, 235, 0.08); border-left: 4px solid var(--color-primary); padding: 0.85rem 1rem; border-radius: 0 var(--radius-md) var(--radius-md) 0; display: flex; gap: 0.75rem; align-items: flex-start;">
          <i class="ri-information-line" style="font-size: 1.25rem; color: var(--color-primary); margin-top: 0.1rem;"></i>
          <div>
            <div style="font-size: 0.9rem; font-weight: 600; color: var(--color-text-main);">${escapeHtml(block.title)}</div>
            ${block.description ? `<div style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.2rem;">${escapeHtml(block.description)}</div>` : ''}
          </div>
        </div>
      `;
    } else if (block.type === 'divider') {
      return `<hr style="border: none; border-top: 1px solid var(--color-border); margin: 1rem 0;">`;
    }

    return `
      <div class="card" style="padding: 1.25rem; border-radius: var(--radius-md); box-shadow: var(--shadow-sm);" id="field-wrapper-${block.id}">
        <div style="margin-bottom: 0.75rem;">
          <label style="font-size: 0.98rem; font-weight: 600; color: var(--color-text-main); display: block; margin-bottom: 0.25rem;">
            ${escapeHtml(block.title)} ${isRequired ? '<span style="color: var(--color-danger);" title="Obligatorio">*</span>' : ''}
          </label>
          ${block.description ? `
            <div style="font-size: 0.82rem; color: var(--color-text-muted);">${escapeHtml(block.description)}</div>
          ` : ''}
        </div>
        ${inputHtml}
        <div class="block-error-msg" data-block-id="${block.id}" style="color: var(--color-danger); font-size: 0.78rem; font-weight: 600; margin-top: 0.4rem; display: none;">
          Esta pregunta es obligatoria. Por favor selecciona o escribe tu respuesta.
        </div>
      </div>
    `;
  }

  function attachBlockEvents(blocks) {
    blocks.forEach(b => {
      // Estrellas
      if (b.type === 'rating_stars') {
        const group = container.querySelector(`.star-rating-group[data-block-id="${b.id}"]`);
        const feedback = container.querySelector(`.star-label-feedback[data-block-id="${b.id}"]`);
        if (group) {
          group.querySelectorAll('input').forEach(radio => {
            radio.addEventListener('change', () => {
              const val = parseInt(radio.value, 10);
              answers[b.id] = val;
              if (feedback) feedback.textContent = STAR_LABELS[val - 1] || '';
              clearBlockError(b.id);
            });
          });
        }
      }

      // CSAT Emojis
      if (b.type === 'rating_csat_emojis') {
        const btns = container.querySelectorAll(`.csat-emojis-container[data-block-id="${b.id}"] .csat-emoji-btn`);
        btns.forEach(btn => {
          btn.addEventListener('click', () => {
            btns.forEach(o => o.classList.remove('active'));
            btn.classList.add('active');
            answers[b.id] = parseInt(btn.dataset.value, 10);
            clearBlockError(b.id);
          });
        });
      }

      // NPS & Numeric
      if (['rating_nps', 'rating_numeric'].includes(b.type)) {
        const btns = container.querySelectorAll(`.nps-container[data-block-id="${b.id}"] .nps-btn`);
        btns.forEach(btn => {
          btn.addEventListener('click', () => {
            btns.forEach(o => o.classList.remove('active'));
            btn.classList.add('active');
            answers[b.id] = parseInt(btn.dataset.value, 10);
            clearBlockError(b.id);
          });
        });
      }

      // Single Choice & Boolean
      if (['single_choice', 'boolean'].includes(b.type)) {
        const items = container.querySelectorAll(`.survey-choices-group[data-block-id="${b.id}"] .survey-choice-item, .survey-boolean-group[data-block-id="${b.id}"] .survey-choice-item`);
        items.forEach(item => {
          item.addEventListener('click', () => {
            items.forEach(o => {
              o.classList.remove('selected');
              const icon = o.querySelector('i');
              if (icon && b.type === 'single_choice') icon.className = 'ri-checkbox-blank-circle-line';
            });
            item.classList.add('selected');
            const icon = item.querySelector('i');
            if (icon && b.type === 'single_choice') icon.className = 'ri-checkbox-circle-fill';

            answers[b.id] = item.dataset.value;
            clearBlockError(b.id);
          });
        });
      }

      // Multiple Choice
      if (b.type === 'multiple_choice') {
        const items = container.querySelectorAll(`.survey-multi-group[data-block-id="${b.id}"] .survey-choice-item`);
        items.forEach(item => {
          item.addEventListener('click', () => {
            item.classList.toggle('selected');
            const icon = item.querySelector('i');
            const isSel = item.classList.contains('selected');
            if (icon) icon.className = isSel ? 'ri-checkbox-fill' : 'ri-checkbox-blank-line';

            if (!Array.isArray(answers[b.id])) answers[b.id] = [];
            const val = item.dataset.value;
            if (isSel) {
              if (!answers[b.id].includes(val)) answers[b.id].push(val);
            } else {
              answers[b.id] = answers[b.id].filter(x => x !== val);
            }
            clearBlockError(b.id);
          });
        });
      }

      // Text Short & Text Long
      if (['text_short', 'text_long'].includes(b.type)) {
        const inp = container.querySelector(`.wizard-text-input[data-block-id="${b.id}"], .wizard-textarea-input[data-block-id="${b.id}"]`);
        if (inp) {
          inp.addEventListener('input', (e) => {
            answers[b.id] = e.target.value.trim();
            if (answers[b.id]) clearBlockError(b.id);
          });
        }
      }

      // Dropdown
      if (b.type === 'dropdown') {
        const sel = container.querySelector(`select[data-block-id="${b.id}"]`);
        if (sel) {
          sel.addEventListener('change', (e) => {
            answers[b.id] = e.target.value;
            if (answers[b.id]) clearBlockError(b.id);
          });
        }
      }
    });
  }

  function saveInputsToAnswers(blocks) {
    blocks.forEach(b => {
      if (['text_short', 'text_long'].includes(b.type)) {
        const inp = container.querySelector(`.wizard-text-input[data-block-id="${b.id}"], .wizard-textarea-input[data-block-id="${b.id}"]`);
        if (inp) {
          answers[b.id] = inp.value.trim();
        }
      } else if (b.type === 'dropdown') {
        const sel = container.querySelector(`select[data-block-id="${b.id}"]`);
        if (sel) {
          answers[b.id] = sel.value;
        }
      }
    });
  }

  function clearBlockError(blockId) {
    const err = container.querySelector(`.block-error-msg[data-block-id="${blockId}"]`);
    if (err) err.style.display = 'none';
    const wrapper = container.querySelector(`#field-wrapper-${blockId}`);
    if (wrapper) wrapper.style.borderColor = 'var(--color-border)';
  }

  function validateCurrentPage(blocks) {
    saveInputsToAnswers(blocks);
    let isValid = true;
    blocks.forEach(b => {
      if (b.required && !['text_header', 'text_paragraph', 'text_callout', 'divider'].includes(b.type)) {
        const val = answers[b.id];
        const isEmpty = val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0);
        if (isEmpty) {
          isValid = false;
          const err = container.querySelector(`.block-error-msg[data-block-id="${b.id}"]`);
          if (err) err.style.display = 'block';
          const wrapper = container.querySelector(`#field-wrapper-${b.id}`);
          if (wrapper) wrapper.style.borderColor = 'var(--color-danger)';
        }
      }
    });

    if (!isValid) {
      const firstErr = container.querySelector('.block-error-msg[style*="display: block"]');
      if (firstErr) firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    return isValid;
  }

  async function submitSurveyAnswers() {
    if (isPreview) {
      onComplete();
      return;
    }

    const submitBtn = container.querySelector('#btn-survey-wizard-submit');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Enviando...';
    }

    try {
      // Calcular rating promedio y nps
      let ratingSum = 0;
      let ratingCount = 0;
      let npsScore = null;
      let npsCat = null;

      Object.entries(answers).forEach(([bId, val]) => {
        const num = Number(val);
        if (!isNaN(num) && num >= 1 && num <= 5) {
          ratingSum += num;
          ratingCount++;
        }
        // Buscar si es bloque NPS
        let foundNpsBlock = false;
        pages.forEach(p => {
          (p.blocks || []).forEach(b => {
            if (b.id === bId && b.type === 'rating_nps') {
              foundNpsBlock = true;
            }
          });
        });

        if (foundNpsBlock && !isNaN(num) && num >= 0 && num <= 10) {
          npsScore = num;
          if (num >= 9) npsCat = 'promoter';
          else if (num >= 7) npsCat = 'passive';
          else npsCat = 'detractor';
        }
      });

      const avgRating = ratingCount > 0 ? (ratingSum / ratingCount).toFixed(2) : null;

      const payload = {
        survey_id: survey.id,
        user_id: userProfile?.id || null,
        comercio: userProfile?.comercio || 'Invitado',
        user_email: userProfile?.email || null,
        user_name: userProfile?.full_name || null,
        answers: answers,
        rating_score: avgRating,
        nps_score: npsScore,
        nps_category: npsCat,
        source: userProfile ? 'dashboard' : 'public_link'
      };

      const { error } = await supabase.from('survey_responses').insert(payload);
      if (error) throw error;

      // Pantalla de agradecimiento
      renderSuccessScreen();
    } catch (err) {
      console.error('Error al enviar respuestas:', err);
      if (window.Swal) {
        window.Swal.fire({
          icon: 'error',
          title: 'Error al Enviar',
          text: err.message || err
        });
      } else {
        alert('Error al enviar respuestas: ' + (err.message || err));
      }
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="ri-send-plane-fill"></i> Enviar Encuesta';
      }
    }
  }

  function renderSuccessScreen() {
    const successTitle = survey.settings?.success_title || '¡Muchas gracias por tu tiempo!';
    const successMsg = survey.settings?.success_message || 'Tus respuestas han sido recibidas y nos ayudan a optimizar nuestro servicio.';

    container.innerHTML = `
      <div style="max-width: 600px; margin: 3rem auto; text-align: center; padding: 2rem;">
        <div style="width: 72px; height: 72px; border-radius: 50%; background: rgba(16, 185, 129, 0.15); color: #10b981; display: flex; align-items: center; justify-content: center; font-size: 2.5rem; margin: 0 auto 1.5rem auto; animation: pulse-warning 2s infinite;">
          <i class="ri-checkbox-circle-line"></i>
        </div>
        <h2 style="font-size: 1.6rem; font-weight: 800; color: var(--color-text-main); margin-bottom: 0.75rem;">
          ${escapeHtml(successTitle)}
        </h2>
        <p style="color: var(--color-text-muted); font-size: 0.95rem; line-height: 1.6; margin-bottom: 2rem;">
          ${escapeHtml(successMsg)}
        </p>
        <button id="btn-success-done" class="btn btn-primary" style="padding: 0.65rem 1.75rem; font-size: 0.95rem;">
          Finalizar
        </button>
      </div>
    `;

    container.querySelector('#btn-success-done')?.addEventListener('click', () => {
      onComplete();
    });
  }

  renderCurrentPage();
}

// Helpers para escape HTML seguro
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlAttr(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ==============================================================================
// POPUP AUTOMÁTICO EN INICIO DE SESIÓN
// ==============================================================================

/**
 * Muestra el modal popup de invitación a responder la encuesta
 */
export function showSurveyLoginModal(survey, user, profile, options = {}) {
  const existing = document.getElementById('survey-login-popup-modal');
  if (existing) existing.remove();

  injectSurveyStyles();

  const isTest = !!options.isTest;
  const userId = user?.id || (isTest ? 'test_user' : null);
  const cat = SURVEY_CATEGORIES[survey.category] || SURVEY_CATEGORIES.satisfaction;
  const estMins = survey.settings?.estimated_minutes || 2;
  const customMsg = survey.settings?.popup_message || survey.description || 'Tu opinión sobre el empaque, almacenamiento y rapidez de despacho es esencial para optimizar la operación de tu cuenta.';

  const modal = document.createElement('div');
  modal.id = 'survey-login-popup-modal';
  modal.className = 'survey-login-popup-overlay';

  modal.innerHTML = `
    <div class="survey-login-popup-card">
      
      <!-- Header con gradiente suave y badge -->
      <div style="background: linear-gradient(135deg, rgba(37, 99, 235, 0.14) 0%, rgba(16, 185, 129, 0.1) 100%); border-bottom: 1px solid var(--color-border); padding: 1.5rem; position: relative;">
        <button id="btn-close-login-popup" style="position: absolute; top: 1rem; right: 1rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-full); width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--color-text-muted); font-size: 1.15rem; transition: all 0.2s ease;" title="Cerrar y recordar más tarde">
          <i class="ri-close-line"></i>
        </button>

        <div style="display: flex; align-items: center; gap: 0.9rem;">
          <div style="width: 52px; height: 52px; border-radius: 16px; background: var(--color-surface); border: 1.5px solid var(--color-border); display: flex; align-items: center; justify-content: center; font-size: 1.75rem; color: var(--color-primary); box-shadow: var(--shadow-sm); animation: surveyFloatIcon 3s ease-in-out infinite; flex-shrink: 0;">
            <i class="${cat.icon}"></i>
          </div>
          <div>
            <div style="display: flex; align-items: center; gap: 0.45rem; margin-bottom: 0.25rem; flex-wrap: wrap;">
              <span class="survey-badge" style="background: ${cat.bgColor}; color: ${cat.color}; font-weight: 700; font-size: 0.74rem;">
                ${cat.label}
              </span>
              <span class="survey-badge" style="background: rgba(37, 99, 235, 0.12); color: var(--color-primary); font-size: 0.72rem; font-weight: 600;">
                <i class="ri-time-line"></i> ~${estMins} min
              </span>
              ${isTest ? `<span class="survey-badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; font-size: 0.72rem; font-weight: 700;">Vista de Prueba</span>` : ''}
            </div>
            <h3 style="font-size: 1.18rem; font-weight: 700; color: var(--color-text-main); margin: 0; line-height: 1.35;">
              ${escapeHtml(survey.title)}
            </h3>
          </div>
        </div>
      </div>

      <!-- Cuerpo del popup -->
      <div style="padding: 1.5rem;">
        <p style="font-size: 0.92rem; color: var(--color-text-main); line-height: 1.55; margin: 0 0 1.25rem 0;">
          ${escapeHtml(customMsg)}
        </p>

        <div style="background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.85rem 1rem; margin-bottom: 1.5rem; display: flex; flex-direction: column; gap: 0.5rem;">
          <div style="display: flex; align-items: center; gap: 0.6rem; font-size: 0.82rem; color: var(--color-text-muted);">
            <i class="ri-checkbox-circle-fill" style="color: #10b981;"></i>
            <span>Solo te tomará un par de minutos</span>
          </div>
          <div style="display: flex; align-items: center; gap: 0.6rem; font-size: 0.82rem; color: var(--color-text-muted);">
            <i class="ri-shield-check-fill" style="color: var(--color-primary);"></i>
            <span>Tus respuestas son confidenciales y se procesan con seguridad</span>
          </div>
          <div style="display: flex; align-items: center; gap: 0.6rem; font-size: 0.82rem; color: var(--color-text-muted);">
            <i class="ri-heart-pulse-fill" style="color: #ec4899;"></i>
            <span>Ayuda directa a optimizar la preparación y tiempos de entrega</span>
          </div>
        </div>

        <!-- Botones de Acción -->
        <div style="display: flex; flex-direction: column; gap: 0.65rem;">
          <button type="button" id="btn-popup-respond-now" class="btn btn-primary" style="width: 100%; padding: 0.85rem 1.25rem; font-size: 0.98rem; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 0.5rem; box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35);">
            <span>Responder Encuesta Ahora</span>
            <i class="ri-arrow-right-line" style="font-size: 1.15rem;"></i>
          </button>

          <button type="button" id="btn-popup-remind-later" class="btn btn-outline" style="width: 100%; padding: 0.65rem 1rem; font-size: 0.85rem; color: var(--color-text-muted); border-color: transparent;">
            Recordar más tarde
          </button>
        </div>
      </div>

    </div>
  `;

  document.body.appendChild(modal);

  function dismissModal() {
    if (!isTest && userId && survey.id) {
      const todayStr = new Date().toISOString().slice(0, 10);
      try {
        localStorage.setItem(`stocka_survey_popup_${survey.id}_${userId}`, todayStr);
      } catch (e) {}
    }
    modal.style.opacity = '0';
    modal.style.transition = 'opacity 0.2s ease';
    setTimeout(() => modal.remove(), 200);
  }

  document.getElementById('btn-close-login-popup')?.addEventListener('click', dismissModal);
  document.getElementById('btn-popup-remind-later')?.addEventListener('click', dismissModal);

  document.getElementById('btn-popup-respond-now')?.addEventListener('click', () => {
    modal.remove();
    openSurveyWizardModal(survey, user, profile, { isTest });
  });
}

/**
 * Abre el asistente interactivo de encuesta dentro de un modal superpuesto
 */
export function openSurveyWizardModal(survey, user, profile, options = {}) {
  const existing = document.getElementById('survey-wizard-overlay-modal');
  if (existing) existing.remove();

  injectSurveyStyles();

  const isTest = !!options.isTest;
  const modal = document.createElement('div');
  modal.id = 'survey-wizard-overlay-modal';
  modal.className = 'survey-login-popup-overlay';

  modal.innerHTML = `
    <div style="background: var(--color-surface); border: 1.5px solid var(--color-border); border-radius: var(--radius-xl, 18px); max-width: 820px; width: 100%; max-height: 92vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 25px 60px rgba(0,0,0,0.5); position: relative; animation: surveyModalFadeIn 0.25s ease;">
      
      <!-- Top Bar -->
      <div style="padding: 0.9rem 1.25rem; border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center; background: var(--color-bg);">
        <div style="display: flex; align-items: center; gap: 0.5rem; overflow: hidden;">
          <i class="ri-survey-line" style="color: var(--color-primary); font-size: 1.25rem; flex-shrink: 0;"></i>
          <span style="font-size: 0.95rem; font-weight: 700; color: var(--color-text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${escapeHtml(survey.title)}
          </span>
          ${isTest ? `<span class="survey-badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; font-size: 0.72rem; font-weight: 700;">Modo Prueba</span>` : ''}
        </div>
        <button id="btn-close-survey-wizard-modal" style="background: transparent; border: none; font-size: 1.35rem; cursor: pointer; color: var(--color-text-muted); display: flex; align-items: center;" title="Cerrar y posponer">&times;</button>
      </div>

      <!-- Body Container -->
      <div id="survey-wizard-modal-inner" style="padding: 1.5rem; overflow-y: auto; flex: 1;">
        <!-- Se inyecta renderSurveyWizard -->
      </div>

    </div>
  `;

  document.body.appendChild(modal);

  const innerContainer = modal.querySelector('#survey-wizard-modal-inner');

  renderSurveyWizard(survey, innerContainer, {
    isPreview: isTest,
    userProfile: profile,
    onComplete: () => {
      if (!isTest && user?.id && survey.id) {
        try {
          localStorage.setItem(`stocka_survey_completed_${survey.id}_${user.id}`, 'true');
        } catch (e) {}
      }

      // Actualizar contador del badge en el sidebar si está en el DOM
      const badge = document.getElementById('badge-surveys-client');
      if (badge) {
        const count = parseInt(badge.textContent || '1', 10);
        if (count <= 1) badge.style.display = 'none';
        else badge.textContent = count - 1;
      }

      setTimeout(() => {
        modal.style.opacity = '0';
        modal.style.transition = 'opacity 0.3s ease';
        setTimeout(() => modal.remove(), 300);
      }, 2500);
    }
  });

  document.getElementById('btn-close-survey-wizard-modal')?.addEventListener('click', () => {
    if (confirm('¿Deseas pausar esta encuesta? Te la recordaremos en tu próximo ingreso.')) {
      if (!isTest && user?.id && survey.id) {
        const todayStr = new Date().toISOString().slice(0, 10);
        try {
          localStorage.setItem(`stocka_survey_popup_${survey.id}_${user.id}`, todayStr);
        } catch (e) {}
      }
      modal.remove();
    }
  });
}

/**
 * Comprueba si hay encuestas dirigidas al usuario que requieran popup al iniciar sesión
 */
export async function checkAndShowSurveyLoginPopup(user, profile) {
  if (!user || !user.id) return;

  try {
    const userCommerce = (profile?.comercio || '').split(',')[0].trim();
    const userId = user.id;

    // 1. Obtener encuestas publicadas
    const { data: surveys, error } = await supabase
      .from('surveys')
      .select('*')
      .eq('status', 'published')
      .order('created_at', { ascending: false });

    if (error || !surveys || surveys.length === 0) return;

    // Filtrar aquellas con popup_on_login activado en settings
    const popupSurveys = surveys.filter(s => {
      return s.settings && (s.settings.popup_on_login === true || s.settings.popup_on_login === 'true');
    });

    if (popupSurveys.length === 0) return;

    // 2. Filtrar por audiencia aplicable
    const applicable = popupSurveys.filter(s => {
      if (s.target_type === 'all' || s.target_type === 'public_link') return true;
      if (s.target_type === 'specific_merchants') {
        const merchants = Array.isArray(s.target_merchants) ? s.target_merchants : [];
        return merchants.some(m => m.toLowerCase() === userCommerce.toLowerCase());
      }
      if (s.target_type === 'specific_users') {
        const users = Array.isArray(s.target_users) ? s.target_users : [];
        return users.includes(userId) || (profile?.email && users.includes(profile.email.toLowerCase()));
      }
      return false;
    });

    if (applicable.length === 0) return;

    // 3. Revisar cada encuesta aplicable
    for (const survey of applicable) {
      // Verificar si ya fue respondida en Supabase
      const { data: responses, error: rErr } = await supabase
        .from('survey_responses')
        .select('id')
        .eq('survey_id', survey.id)
        .or(`user_id.eq.${userId},comercio.eq.${userCommerce}`)
        .limit(1);

      if (!rErr && responses && responses.length > 0) {
        // Ya completada, pasar a la siguiente
        continue;
      }

      // Verificar regla de localStorage según frecuencia
      const key = `stocka_survey_popup_${survey.id}_${userId}`;
      const lastShown = localStorage.getItem(key);
      const todayStr = new Date().toISOString().slice(0, 10);
      const frequency = survey.settings?.popup_frequency || 'daily';

      if (frequency === 'daily' && lastShown === todayStr) {
        // Ya se mostró hoy, omitir
        continue;
      }

      // Mostrar popup tras 1.2 segundos para asegurar renderizado del dashboard
      setTimeout(() => {
        showSurveyLoginModal(survey, user, profile);
      }, 1200);

      // Limitar a un popup por inicio de sesión
      break;
    }
  } catch (err) {
    console.warn('Error al verificar popups de encuesta en inicio de sesión:', err);
  }
}

