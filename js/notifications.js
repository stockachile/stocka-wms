import supabase from './supabase.js';

export async function renderNotifications(targetContainer) {
  const container = targetContainer || document.getElementById('app-content');
  if (!container) return;

  // Inyectar estilos específicos de la sección
  injectStyles();

  // Mostrar spinner de carga
  container.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 250px; padding: 2rem; background: transparent;">
      <style>
        @keyframes wms-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
      <div style="width: 40px; height: 40px; border: 3px solid rgba(120, 120, 120, 0.15); border-top-color: var(--color-primary); border-radius: 50%; animation: wms-spin 1s linear infinite; margin-bottom: 1rem;"></div>
      <h4 style="margin: 0; color: var(--color-text-main); font-weight: 600; font-size: 0.95rem;">Cargando preferencias...</h4>
    </div>
  `;

  // Obtener sesión del usuario
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    container.innerHTML = '<div class="alert alert-error">Sesión no activa. Por favor, inicia sesión de nuevo.</div>';
    return;
  }

  const userId = session.user.id;

  // Cargar preferencias desde la base de datos
  let settings = null;
  try {
    const { data, error } = await supabase
      .from('notification_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    settings = data;
  } catch (err) {
    console.error('Error al cargar preferencias:', err);
    container.innerHTML = `<div class="alert alert-error">Error al conectar con el servidor: ${err.message || err}</div>`;
    return;
  }

  // Si no existen configuraciones previas, usar valores por defecto
  const defaultSettings = {
    user_id: userId,
    notify_out_of_stock: false,
    report_critical_stock: false,
    report_critical_stock_frequency: 7,
    report_critical_stock_day: 1,
    notify_incidents: false,
    notify_volume_levels: false,
    volume_min_level: '',
    volume_max_level: '',
    report_weekly_sales: false,
    report_monthly_activity: false,
    notify_order_no_stock: false,
    order_no_stock_timing: 'instant'
  };

  const currentSettings = settings || defaultSettings;

  // Generar HTML de la interfaz de usuario para insertar en la pestaña de perfil
  container.innerHTML = `
    <div class="notifications-container">
      <div style="margin-bottom: 1rem; padding: 0.25rem 0.5rem;">
        <h4 style="margin: 0 0 0.25rem 0; font-size: 1.1rem; font-weight: 700; color: var(--color-text-main);">Preferencias de Alertas y Reportes</h4>
        <p style="margin: 0; font-size: 0.85rem; color: var(--color-text-muted);">Configura los correos automáticos que deseas recibir. Todos los envíos se realizan desde <strong>info@stocka.cl</strong>.</p>
      </div>

      <form id="notifications-form" class="notifications-form">
        
        <!-- Alertas de Stock e Inventario -->
        <div class="section-card">
          <div class="section-card-header">
            <i class="ri-box-3-line"></i>
            <div>
              <h3>Inventario y Stock Crítico</h3>
              <p>Monitoreo automático de tus productos y niveles de volumen</p>
            </div>
          </div>
          <div class="section-card-body">
            
            <!-- Toggle: Producto Agotado -->
            <div class="setting-row">
              <div class="setting-info">
                <label class="setting-title">Notificación de productos agotados</label>
                <span class="setting-desc">Recibe un correo inmediato cuando el stock disponible de cualquier producto llegue a 0.</span>
              </div>
              <div class="setting-control">
                <label class="switch">
                  <input type="checkbox" id="notify_out_of_stock" ${currentSettings.notify_out_of_stock ? 'checked' : ''}>
                  <span class="slider"></span>
                </label>
              </div>
            </div>

            <!-- Toggle: Reporte de Críticos -->
            <div class="setting-row">
              <div class="setting-info">
                <label class="setting-title">Reporte de stock crítico y agotados</label>
                <span class="setting-desc">Resumen periódico con productos agotados y aquellos por debajo del stock crítico definido.</span>
              </div>
              <div class="setting-control">
                <label class="switch">
                  <input type="checkbox" id="report_critical_stock" ${currentSettings.report_critical_stock ? 'checked' : ''}>
                  <span class="slider"></span>
                </label>
              </div>
            </div>

            <!-- Campos condicionales para Reporte de Críticos -->
            <div id="critical-stock-options" class="conditional-fields" style="display: ${currentSettings.report_critical_stock ? 'block' : 'none'};">
              <div class="alert-info-box">
                <i class="ri-information-line"></i>
                <div class="alert-info-text">
                  <strong>Configuración de Stock Crítico:</strong> Para recibir este reporte de manera útil, asegúrate de haber definido el <em>Stock Crítico</em> de tus productos en el <a href="#" onclick="window.navigateToView('inventory'); return false;">módulo de Inventario</a> (editando la información del producto correspondiente).
                </div>
              </div>
              
              <div class="fields-row">
                <div class="form-group">
                  <label class="form-label" for="report_critical_stock_frequency">Frecuencia de envío</label>
                  <select id="report_critical_stock_frequency" class="form-select">
                    <option value="7" ${currentSettings.report_critical_stock_frequency == 7 ? 'selected' : ''}>Cada 7 días</option>
                    <option value="14" ${currentSettings.report_critical_stock_frequency == 14 ? 'selected' : ''}>Cada 14 días</option>
                    <option value="28" ${currentSettings.report_critical_stock_frequency == 28 ? 'selected' : ''}>Cada 28 días</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label" for="report_critical_stock_day">Día de envío</label>
                  <select id="report_critical_stock_day" class="form-select">
                    <option value="1" ${currentSettings.report_critical_stock_day == 1 ? 'selected' : ''}>Lunes</option>
                    <option value="2" ${currentSettings.report_critical_stock_day == 2 ? 'selected' : ''}>Martes</option>
                    <option value="3" ${currentSettings.report_critical_stock_day == 3 ? 'selected' : ''}>Miércoles</option>
                    <option value="4" ${currentSettings.report_critical_stock_day == 4 ? 'selected' : ''}>Jueves</option>
                    <option value="5" ${currentSettings.report_critical_stock_day == 5 ? 'selected' : ''}>Viernes</option>
                    <option value="6" ${currentSettings.report_critical_stock_day == 6 ? 'selected' : ''}>Sábado</option>
                    <option value="7" ${currentSettings.report_critical_stock_day == 7 ? 'selected' : ''}>Domingo</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Toggle: Aviso de Niveles de Volumen -->
            <div class="setting-row" style="border-top: 1px solid var(--color-border); padding-top: 1.5rem;">
              <div class="setting-info">
                <label class="setting-title">Aviso de niveles de volumen de stock</label>
                <span class="setting-desc">Recibe alertas si el volumen total de tu inventario almacenado sobrepasa un máximo o disminuye de un mínimo.</span>
              </div>
              <div class="setting-control">
                <label class="switch">
                  <input type="checkbox" id="notify_volume_levels" ${currentSettings.notify_volume_levels ? 'checked' : ''}>
                  <span class="slider"></span>
                </label>
              </div>
            </div>

            <!-- Campos condicionales para Niveles de Volumen -->
            <div id="volume-options" class="conditional-fields" style="display: ${currentSettings.notify_volume_levels ? 'block' : 'none'};">
              <div class="fields-row">
                <div class="form-group">
                  <label class="form-label" for="volume_min_level">Volumen Mínimo de Stock (m³)</label>
                  <input type="number" id="volume_min_level" class="form-input" placeholder="Ej. 10" step="0.01" min="0" value="${currentSettings.volume_min_level !== null ? currentSettings.volume_min_level : ''}">
                </div>
                <div class="form-group">
                  <label class="form-label" for="volume_max_level">Volumen Máximo de Stock (m³)</label>
                  <input type="number" id="volume_max_level" class="form-input" placeholder="Ej. 150" step="0.01" min="0" value="${currentSettings.volume_max_level !== null ? currentSettings.volume_max_level : ''}">
                </div>
              </div>
            </div>

          </div>
        </div>

        <!-- Pedidos e Incidencias -->
        <div class="section-card">
          <div class="section-card-header">
            <i class="ri-shopping-cart-2-line"></i>
            <div>
              <h3>Pedidos y Operaciones</h3>
              <p>Seguimiento de pedidos sin stock e incidencias registradas en la bodega</p>
            </div>
          </div>
          <div class="section-card-body">
            
            <!-- Toggle: Incidencias -->
            <div class="setting-row">
              <div class="setting-info">
                <label class="setting-title">Reporte de incidencias en portal</label>
                <span class="setting-desc">Recibe avisos inmediatos cuando se registre una incidencia con tus pedidos o ingresos en el portal WMS.</span>
              </div>
              <div class="setting-control">
                <label class="switch">
                  <input type="checkbox" id="notify_incidents" ${currentSettings.notify_incidents ? 'checked' : ''}>
                  <span class="slider"></span>
                </label>
              </div>
            </div>

            <!-- Toggle: Pedidos sin Stock -->
            <div class="setting-row" style="border-top: 1px solid var(--color-border); padding-top: 1.5rem;">
              <div class="setting-info">
                <label class="setting-title">Reporte de pedidos sin stock</label>
                <span class="setting-desc">Entérate cuando ingresen pedidos desde tus integraciones que no puedan ser procesados por falta de stock.</span>
              </div>
              <div class="setting-control">
                <label class="switch">
                  <input type="checkbox" id="notify_order_no_stock" ${currentSettings.notify_order_no_stock ? 'checked' : ''}>
                  <span class="slider"></span>
                </label>
              </div>
            </div>

            <!-- Campos condicionales para Pedido sin Stock -->
            <div id="order-no-stock-options" class="conditional-fields" style="display: ${currentSettings.notify_order_no_stock ? 'block' : 'none'};">
              <div class="form-group">
                <label class="form-label">Preferencia de envío</label>
                <div class="radio-group">
                  <label class="radio-label">
                    <input type="radio" name="order_no_stock_timing" value="instant" ${currentSettings.order_no_stock_timing === 'instant' ? 'checked' : ''}>
                    <span>Al instante en que se genera la alerta</span>
                  </label>
                  <label class="radio-label" style="margin-top: 0.5rem;">
                    <input type="radio" name="order_no_stock_timing" value="daily" ${currentSettings.order_no_stock_timing === 'daily' ? 'checked' : ''}>
                    <span>Consolidado al final del día (18:00 hrs)</span>
                  </label>
                </div>
              </div>
            </div>

          </div>
        </div>

        <!-- Reportes Ejecutivos de Rendimiento -->
        <div class="section-card">
          <div class="section-card-header">
            <i class="ri-line-chart-line"></i>
            <div>
              <h3>Reportes Ejecutivos</h3>
              <p>Resúmenes de ventas e indicadores operacionales semanales y mensuales</p>
            </div>
          </div>
          <div class="section-card-body">
            
            <!-- Toggle: Reporte Ventas Semanales -->
            <div class="setting-row">
              <div class="setting-info">
                <label class="setting-title">Reporte de cantidad de ventas semanales</label>
                <span class="setting-desc">Un resumen semanal de ventas procesadas, desglosado detalladamente por canales de venta de origen (Shopify, Mercado Libre, etc.).</span>
              </div>
              <div class="setting-control">
                <label class="switch">
                  <input type="checkbox" id="report_weekly_sales" ${currentSettings.report_weekly_sales ? 'checked' : ''}>
                  <span class="slider"></span>
                </label>
              </div>
            </div>

            <!-- Toggle: Resumen Mensual de Despachos y Devoluciones -->
            <div class="setting-row" style="border-top: 1px solid var(--color-border); padding-top: 1.5rem;">
              <div class="setting-info">
                <label class="setting-title">Resumen mensual de despachos y devoluciones</label>
                <span class="setting-desc">Balance mensual consolidado que detalla el total de envíos despachados con éxito y la logística inversa gestionada.</span>
              </div>
              <div class="setting-control">
                <label class="switch">
                  <input type="checkbox" id="report_monthly_activity" ${currentSettings.report_monthly_activity ? 'checked' : ''}>
                  <span class="slider"></span>
                </label>
              </div>
            </div>

          </div>
        </div>

        <!-- Botón de Guardar -->
        <div class="form-actions-bar">
          <button type="submit" id="save-settings-btn" class="btn btn-primary">
            <i class="ri-save-line"></i> Guardar Configuración
          </button>
        </div>

      </form>
    </div>
  `;

  // --- LÓGICA DE INTERACCIONES Y EVENTOS ---

  // 1. Mostrar/Ocultar secciones condicionales con animación suave
  const reportCriticalStockCheck = document.getElementById('report_critical_stock');
  const criticalStockOptions = document.getElementById('critical-stock-options');
  reportCriticalStockCheck.addEventListener('change', (e) => {
    criticalStockOptions.style.display = e.target.checked ? 'block' : 'none';
  });

  const notifyVolumeLevelsCheck = document.getElementById('notify_volume_levels');
  const volumeOptions = document.getElementById('volume-options');
  notifyVolumeLevelsCheck.addEventListener('change', (e) => {
    volumeOptions.style.display = e.target.checked ? 'block' : 'none';
  });

  const notifyOrderNoStockCheck = document.getElementById('notify_order_no_stock');
  const orderNoStockOptions = document.getElementById('order-no-stock-options');
  notifyOrderNoStockCheck.addEventListener('change', (e) => {
    orderNoStockOptions.style.display = e.target.checked ? 'block' : 'none';
  });

  // 2. Manejar envío de formulario (Guardar cambios)
  const form = document.getElementById('notifications-form');
  const saveBtn = document.getElementById('save-settings-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Deshabilitar botón para evitar doble click
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Guardando...';

    // Obtener valores de la interfaz
    const notify_out_of_stock = document.getElementById('notify_out_of_stock').checked;
    const report_critical_stock = document.getElementById('report_critical_stock').checked;
    const report_critical_stock_frequency = parseInt(document.getElementById('report_critical_stock_frequency').value, 10);
    const report_critical_stock_day = parseInt(document.getElementById('report_critical_stock_day').value, 10);
    const notify_incidents = document.getElementById('notify_incidents').checked;
    const notify_volume_levels = document.getElementById('notify_volume_levels').checked;
    
    const minVolRaw = document.getElementById('volume_min_level').value;
    const maxVolRaw = document.getElementById('volume_max_level').value;
    const volume_min_level = notify_volume_levels && minVolRaw !== '' ? parseFloat(minVolRaw) : null;
    const volume_max_level = notify_volume_levels && maxVolRaw !== '' ? parseFloat(maxVolRaw) : null;
    
    const report_weekly_sales = document.getElementById('report_weekly_sales').checked;
    const report_monthly_activity = document.getElementById('report_monthly_activity').checked;
    const notify_order_no_stock = document.getElementById('notify_order_no_stock').checked;
    
    const orderNoStockTimingEl = document.querySelector('input[name="order_no_stock_timing"]:checked');
    const order_no_stock_timing = orderNoStockTimingEl ? orderNoStockTimingEl.value : 'instant';

    try {
      const payload = {
        user_id: userId,
        notify_out_of_stock,
        report_critical_stock,
        report_critical_stock_frequency,
        report_critical_stock_day,
        notify_incidents,
        notify_volume_levels,
        volume_min_level,
        volume_max_level,
        report_weekly_sales,
        report_monthly_activity,
        notify_order_no_stock,
        order_no_stock_timing,
        updated_at: new Date().toISOString()
      };

      const { error: upsertErr } = await supabase
        .from('notification_settings')
        .upsert(payload, { onConflict: 'user_id' });

      if (upsertErr) throw upsertErr;

      if (window.Swal) {
        window.Swal.fire({
          icon: 'success',
          title: 'Configuración guardada',
          text: 'Tus preferencias de notificaciones automáticas se han guardado de manera exitosa.',
          confirmButtonColor: 'var(--color-primary)'
        });
      } else {
        alert('Tus preferencias de notificaciones automáticas se han guardado exitosamente.');
      }
    } catch (err) {
      console.error('Error al guardar configuración de notificaciones:', err);
      if (window.Swal) {
        window.Swal.fire({
          icon: 'error',
          title: 'Error al guardar',
          text: `Ocurrió un error inesperado al intentar guardar los cambios: ${err.message || err}`,
          confirmButtonColor: 'var(--color-primary)'
        });
      } else {
        alert(`Error al guardar cambios: ${err.message || err}`);
      }
    } finally {
      // Re-habilitar botón
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="ri-save-line"></i> Guardar Configuración';
    }
  });
}

// Permitir que el link del banner/alerta cambie de vista
window.navigateToView = function(viewName) {
  const targetNav = document.querySelector(`.sidebar-nav .nav-item[data-view="${viewName}"]`);
  if (targetNav) {
    targetNav.click();
  }
};

// Inyectar estilos CSS específicos para esta sección (diseño premium responsivo)
function injectStyles() {
  const styleId = 'wms-notifications-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .notifications-container {
      max-width: 100%;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      animation: fadeIn 0.4s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .section-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-sm);
      overflow: hidden;
      transition: var(--transition-theme);
    }

    .section-card-header {
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid var(--color-border);
      display: flex;
      align-items: center;
      gap: 1rem;
      background: rgba(0, 0, 0, 0.01);
    }

    .section-card-header i {
      font-size: 1.8rem;
      color: var(--color-primary);
    }

    .section-card-header h3 {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 600;
      color: var(--color-text-main);
    }

    .section-card-header p {
      margin: 2px 0 0 0;
      font-size: 0.85rem;
      color: var(--color-text-muted);
    }

    .section-card-body {
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .setting-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 2rem;
    }

    .setting-info {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .setting-title {
      font-weight: 600;
      font-size: 1rem;
      color: var(--color-text-main);
    }

    .setting-desc {
      font-size: 0.85rem;
      color: var(--color-text-muted);
      line-height: 1.4;
    }

    /* Switch toggle premium style */
    .switch {
      position: relative;
      display: inline-block;
      width: 48px;
      height: 24px;
      flex-shrink: 0;
    }

    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: var(--color-border);
      transition: .3s;
      border-radius: 34px;
    }

    .slider:before {
      position: absolute;
      content: "";
      height: 18px;
      width: 18px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: .3s;
      border-radius: 50%;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
    }

    input:checked + .slider {
      background-color: var(--color-primary);
    }

    input:checked + .slider:before {
      transform: translateX(24px);
    }

    /* Conditional fields styling */
    .conditional-fields {
      background: var(--color-bg);
      border-radius: var(--radius-md);
      padding: 1.25rem;
      border: 1px dashed var(--color-border);
      margin-top: -0.5rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
      animation: slideDown 0.25s ease-out;
    }

    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .alert-info-box {
      background-color: rgba(59, 130, 246, 0.08);
      color: var(--color-text-main);
      border: 1px solid rgba(59, 130, 246, 0.15);
      padding: 0.75rem 1rem;
      border-radius: var(--radius-sm);
      display: flex;
      gap: 0.75rem;
      font-size: 0.85rem;
      line-height: 1.5;
    }

    .alert-info-box i {
      font-size: 1.2rem;
      color: var(--color-primary);
      flex-shrink: 0;
      margin-top: 1px;
    }

    .alert-info-box a {
      color: var(--color-primary);
      text-decoration: underline;
      font-weight: 600;
    }

    .fields-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .form-label {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--color-text-main);
    }

    .form-select, .form-input {
      padding: 0.6rem 0.8rem;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      color: var(--color-text-main);
      font-size: 0.9rem;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    .form-select:focus, .form-input:focus {
      border-color: var(--color-primary);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
    }

    .radio-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 4px;
    }

    .radio-label {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.9rem;
      color: var(--color-text-main);
      cursor: pointer;
    }

    .radio-label input {
      accent-color: var(--color-primary);
      width: 16px;
      height: 16px;
    }

    .form-actions-bar {
      display: flex;
      justify-content: flex-end;
      padding: 1rem 0;
    }

    .form-actions-bar button {
      min-width: 180px;
      font-size: 0.95rem;
      font-weight: 600;
      padding: 0.75rem 1.5rem;
      border-radius: var(--radius-md);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
    }

    @media (max-width: 768px) {
      .fields-row {
        grid-template-columns: 1fr;
      }
      .setting-row {
        flex-direction: column;
        align-items: flex-start;
        gap: 1rem;
      }
      .setting-control {
        align-self: flex-end;
      }
    }
  `;
  document.head.appendChild(style);
}
