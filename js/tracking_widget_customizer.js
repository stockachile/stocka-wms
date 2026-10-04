// js/tracking_widget_customizer.js - Panel de Personalización de Tracking para Sellers
import supabase from './supabase.js';

// Valores por defecto
function getDefaultConfig(commerceName) {
  return {
    primary_color: '#5c24ff',
    background_color: 'transparent',
    brand_name: commerceName || '',
    logo_url: '',
    support_wa: '',
    support_email: '',
    show_picking: true,
    show_courier_link: true
  };
}

// Cargar configuración guardada
export async function loadTrackingWidgetConfig(commerceName) {
  const normName = (commerceName || '').trim();
  let localData = null;
  try {
    const raw = localStorage.getItem('stocka_tw_config_' + normName);
    if (raw) localData = JSON.parse(raw);
  } catch (e) {}

  try {
    const { data, error } = await supabase
      .from('merchant_integrations')
      .select('*')
      .eq('platform', 'TrackingWidget')
      .ilike('comercio', normName)
      .maybeSingle();

    if (!error && data && data.access_token) {
      const parsed = JSON.parse(data.access_token);
      return { ...getDefaultConfig(normName), ...parsed, id: data.id };
    }
  } catch (err) {
    console.warn("Aviso consultando configuración de tracking en Supabase:", err);
  }

  return localData ? { ...getDefaultConfig(normName), ...localData } : getDefaultConfig(normName);
}

// Guardar configuración
export async function saveTrackingWidgetConfig(commerceName, config) {
  const normName = (commerceName || '').trim();
  try {
    localStorage.setItem('stocka_tw_config_' + normName, JSON.stringify(config));
  } catch (e) {}

  try {
    const { data: userAuth } = await supabase.auth.getUser();
    const merchantId = userAuth?.user?.id || null;

    const { data: existing } = await supabase
      .from('merchant_integrations')
      .select('id')
      .eq('platform', 'TrackingWidget')
      .ilike('comercio', normName)
      .maybeSingle();

    const payload = {
      platform: 'TrackingWidget',
      comercio: normName,
      access_token: JSON.stringify(config),
      is_active: true
    };

    if (existing && existing.id) {
      const { error } = await supabase
        .from('merchant_integrations')
        .update(payload)
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      if (merchantId) payload.merchant_id = merchantId;
      const { error } = await supabase
        .from('merchant_integrations')
        .insert([payload]);
      if (error) throw error;
    }
    return { success: true };
  } catch (err) {
    console.error("Error guardando configuración de tracking:", err);
    throw err;
  }
}

// Renderizar la vista principal del personalizador
export async function renderTrackingWidgetCustomizer() {
  const appContent = document.getElementById('app-content');
  if (!appContent) return;

  const currentCompany = window.currentCompany || window.currentUserProfile?.comercio || window.currentUserProfile?.company_name || '';
  const assignedComercios = currentCompany
    .split(',')
    .map(c => c.trim())
    .filter(c => c && c.toLowerCase() !== 'no asignado');

  if (assignedComercios.length === 0) {
    appContent.innerHTML = `
      <div class="alert alert-warning" style="display: block; margin: 2rem;">
        <i class="ri-error-warning-line"></i> No tienes comercios asociados para personalizar el portal de tracking.
      </div>
    `;
    return;
  }

  if (!window.activeTrackingCommerce || !assignedComercios.includes(window.activeTrackingCommerce)) {
    window.activeTrackingCommerce = assignedComercios[0];
  }

  appContent.innerHTML = `
    <div style="display: flex; justify-content: center; align-items: center; min-height: 350px;">
      <div style="text-align: center;">
        <i class="ri-loader-4-line ri-spin" style="font-size: 2.5rem; color: var(--color-primary);"></i>
        <p style="margin-top: 1rem; color: var(--color-text-muted);">Cargando personalizador de tracking...</p>
      </div>
    </div>
  `;

  const config = await loadTrackingWidgetConfig(window.activeTrackingCommerce);
  renderCustomizerUI(appContent, assignedComercios, config);
}

function renderCustomizerUI(container, comerciosList, initialConfig) {
  let state = { ...initialConfig };

  const commerceOptions = comerciosList.map(c => 
    `<option value="${escapeHtml(c)}" ${c === window.activeTrackingCommerce ? 'selected' : ''}>${escapeHtml(c)}</option>`
  ).join('');

  container.innerHTML = `
    <div class="tw-customizer-wrap" id="tracking-customizer-app" style="max-width: 1400px; margin: 0 auto; padding: 1.5rem 0.5rem 3rem 0.5rem;">
      
      <!-- Top Title and Selector Header -->
      <div style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg, 12px); padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: var(--shadow-sm);">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
          <div>
            <div style="display: inline-flex; align-items: center; gap: 0.5rem; background: rgba(92, 36, 255, 0.1); color: #5c24ff; padding: 0.3rem 0.75rem; border-radius: 99px; font-size: 0.8rem; font-weight: 700; margin-bottom: 0.5rem;">
              <i class="ri-palette-line"></i> White-Label Customizer
            </div>
            <h2 style="font-size: 1.5rem; font-weight: 800; color: var(--color-text-main); margin: 0;">Portal de Seguimiento para tu Tienda</h2>
            <p style="color: var(--color-text-muted); font-size: 0.9rem; margin-top: 0.25rem;">
              Personaliza los colores, logotipo, mensajes y botones del tracking para que se integre 100% al diseño de tu web (Shopify, WooCommerce, etc.).
            </p>
          </div>
          
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <label style="font-weight: 700; font-size: 0.85rem; color: var(--color-text-main);">Tienda:</label>
            <select id="tw-select-commerce" class="form-input" style="padding: 0.5rem 1rem; font-weight: 600; min-width: 220px; border-radius: 8px;">
              ${commerceOptions}
            </select>
          </div>
        </div>
      </div>

      <!-- Main 2-Columns Layout: Form Controls (Left) & Live Preview (Right) -->
      <div style="display: grid; grid-template-columns: minmax(360px, 1.1fr) minmax(380px, 1.2fr); gap: 1.5rem; align-items: start;">
        
        <!-- Left: Configuration Controls -->
        <div style="display: flex; flex-direction: column; gap: 1.25rem;">
          
          <!-- Card 1: Colors & Visual Identity -->
          <div style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; padding: 1.5rem; box-shadow: var(--shadow-sm);">
            <h3 style="font-size: 1.05rem; font-weight: 800; color: var(--color-text-main); margin-bottom: 1.25rem; display: flex; align-items: center; gap: 0.5rem;">
              <i class="ri-paint-brush-line" style="color: var(--color-primary);"></i> 1. Identidad Visual y Colores
            </h3>

            <!-- Color Primario -->
            <div class="form-group" style="margin-bottom: 1.25rem;">
              <label class="form-label" style="font-weight: 700;">Color Primario de tu Marca (Botones y Pasos):</label>
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                <input type="color" id="tw-color-picker" value="${state.primary_color || '#5c24ff'}" style="width: 46px; height: 42px; border: 1px solid var(--color-border); border-radius: 8px; cursor: pointer; padding: 2px;">
                <input type="text" id="tw-color-hex" value="${state.primary_color || '#5c24ff'}" maxlength="7" class="form-input" style="font-family: monospace; font-weight: 700; width: 130px;">
                <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                  <button type="button" class="tw-preset-btn" data-color="#5c24ff" title="Stocka Púrpura" style="background: #5c24ff; width: 26px; height: 26px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.2); cursor: pointer;"></button>
                  <button type="button" class="tw-preset-btn" data-color="#e11d48" title="Rosa Fucsia" style="background: #e11d48; width: 26px; height: 26px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.2); cursor: pointer;"></button>
                  <button type="button" class="tw-preset-btn" data-color="#059669" title="Esmeralda" style="background: #059669; width: 26px; height: 26px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.2); cursor: pointer;"></button>
                  <button type="button" class="tw-preset-btn" data-color="#2563eb" title="Azul Royal" style="background: #2563eb; width: 26px; height: 26px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.2); cursor: pointer;"></button>
                  <button type="button" class="tw-preset-btn" data-color="#0f172a" title="Negro Ébano" style="background: #0f172a; width: 26px; height: 26px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.2); cursor: pointer;"></button>
                  <button type="button" class="tw-preset-btn" data-color="#ea580c" title="Naranja" style="background: #ea580c; width: 26px; height: 26px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.2); cursor: pointer;"></button>
                </div>
              </div>
              <span style="font-size: 0.75rem; color: var(--color-text-muted); display: block; margin-top: 0.35rem;">Define el color del botón "Consultar Estado", insignias y pasos activos.</span>
            </div>

            <!-- Fondo del Widget -->
            <div class="form-group" style="margin-bottom: 1.25rem;">
              <label class="form-label" style="font-weight: 700;">Color de Fondo del Widget:</label>
              <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
                <label style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.5rem 0.85rem; border: 1px solid var(--color-border); border-radius: 8px; cursor: pointer; background: var(--color-surface); font-size: 0.85rem; font-weight: 600;">
                  <input type="radio" name="tw-bg-choice" value="transparent" ${state.background_color === 'transparent' ? 'checked' : ''}>
                  <span>Transparente (Recomendado para Shopify)</span>
                </label>
                <label style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.5rem 0.85rem; border: 1px solid var(--color-border); border-radius: 8px; cursor: pointer; background: var(--color-surface); font-size: 0.85rem; font-weight: 600;">
                  <input type="radio" name="tw-bg-choice" value="#ffffff" ${state.background_color === '#ffffff' ? 'checked' : ''}>
                  <span>Blanco Puro</span>
                </label>
                <label style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.5rem 0.85rem; border: 1px solid var(--color-border); border-radius: 8px; cursor: pointer; background: var(--color-surface); font-size: 0.85rem; font-weight: 600;">
                  <input type="radio" name="tw-bg-choice" value="#f8fafc" ${state.background_color === '#f8fafc' ? 'checked' : ''}>
                  <span>Gris Suave (#f8fafc)</span>
                </label>
              </div>
            </div>

            <!-- Nombre de Marca -->
            <div class="form-group" style="margin-bottom: 1.25rem;">
              <label class="form-label" style="font-weight: 700;">Nombre Comercial de tu Tienda:</label>
              <input type="text" id="tw-brand-name" value="${escapeHtml(state.brand_name || '')}" class="form-input" placeholder="Ej: Joyas Gloss Crystal">
              <span style="font-size: 0.75rem; color: var(--color-text-muted); display: block; margin-top: 0.35rem;">Se mostrará en el encabezado de seguimiento para tus clientes.</span>
            </div>

            <!-- URL del Logotipo -->
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label" style="font-weight: 700;">URL del Logotipo de tu Tienda (PNG / SVG transparente):</label>
              <input type="url" id="tw-logo-url" value="${escapeHtml(state.logo_url || '')}" class="form-input" placeholder="https://mitienda.cl/cdn/logo.png">
              <span style="font-size: 0.75rem; color: var(--color-text-muted); display: block; margin-top: 0.35rem;">Aparecerá en la parte superior del portal en modo embebido.</span>
            </div>
          </div>

          <!-- Card 2: Support Channels -->
          <div style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; padding: 1.5rem; box-shadow: var(--shadow-sm);">
            <h3 style="font-size: 1.05rem; font-weight: 800; color: var(--color-text-main); margin-bottom: 1.25rem; display: flex; align-items: center; gap: 0.5rem;">
              <i class="ri-customer-service-2-line" style="color: #10b981;"></i> 2. Canales de Atención Directa
            </h3>

            <!-- WhatsApp de Soporte -->
            <div class="form-group" style="margin-bottom: 1.25rem;">
              <label class="form-label" style="font-weight: 700;">WhatsApp de Atención a Clientes (Opcional):</label>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span style="padding: 0.75rem; background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; border-radius: 8px; font-weight: 700; font-size: 0.9rem;">
                  <i class="ri-whatsapp-fill"></i> +56
                </span>
                <input type="tel" id="tw-support-wa" value="${escapeHtml(state.support_wa || '')}" class="form-input" placeholder="912345678" style="flex: 1;">
              </div>
              <span style="font-size: 0.75rem; color: var(--color-text-muted); display: block; margin-top: 0.35rem;">
                Añadirá un botón verde destacado <em>"¿Dudas con tu pedido? Chatea con nosotros por WhatsApp"</em> en la pantalla de consulta.
              </span>
            </div>

            <!-- Email de Soporte -->
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label" style="font-weight: 700;">Email de Contacto / Post-Venta:</label>
              <input type="email" id="tw-support-email" value="${escapeHtml(state.support_email || '')}" class="form-input" placeholder="soporte@mitienda.cl">
            </div>
          </div>

          <!-- Card 3: Display Toggles -->
          <div style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; padding: 1.5rem; box-shadow: var(--shadow-sm);">
            <h3 style="font-size: 1.05rem; font-weight: 800; color: var(--color-text-main); margin-bottom: 1.25rem; display: flex; align-items: center; gap: 0.5rem;">
              <i class="ri-toggle-line" style="color: #6366f1;"></i> 3. Preferencias de Visualización
            </h3>

            <div style="display: flex; flex-direction: column; gap: 1rem;">
              <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 0.5rem 0;">
                <div>
                  <div style="font-weight: 700; font-size: 0.9rem; color: var(--color-text-main);">Mostrar Detalle de Preparación en Bodega</div>
                  <div style="font-size: 0.78rem; color: var(--color-text-muted);">Muestra el acordeón con el empaque, unidades verificadas y sucursal de armado.</div>
                </div>
                <input type="checkbox" id="tw-show-picking" ${state.show_picking !== false ? 'checked' : ''} style="width: 20px; height: 20px; accent-color: var(--color-primary); cursor: pointer;">
              </label>

              <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 0.5rem 0; border-top: 1px solid var(--color-border);">
                <div>
                  <div style="font-weight: 700; font-size: 0.9rem; color: var(--color-text-main);">Botón de Rastreo Courier Externo</div>
                  <div style="font-size: 0.78rem; color: var(--color-text-muted);">Permite al cliente hacer clic para ver el seguimiento en Starken, Blue Express o Chilexpress.</div>
                </div>
                <input type="checkbox" id="tw-show-courier" ${state.show_courier_link !== false ? 'checked' : ''} style="width: 20px; height: 20px; accent-color: var(--color-primary); cursor: pointer;">
              </label>
            </div>
          </div>

          <!-- Save Button -->
          <div style="display: flex; gap: 1rem;">
            <button type="button" id="btn-save-tw-settings" class="btn btn-primary" style="flex: 1; padding: 0.9rem 1.5rem; font-size: 1rem; font-weight: 800; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; box-shadow: var(--shadow-md);">
              <i class="ri-save-3-line"></i> Guardar Configuración de Tracking
            </button>
          </div>

        </div>

        <!-- Right: Real-time Live Preview & Code Generator -->
        <div style="position: sticky; top: 90px; display: flex; flex-direction: column; gap: 1.25rem;">
          
          <!-- Live Preview Window -->
          <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 14px; overflow: hidden; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.1);">
            
            <!-- Window Header (Mac style browser bar) -->
            <div style="background: #f1f5f9; padding: 0.65rem 1rem; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; gap: 0.5rem;">
              <span style="width: 10px; height: 10px; border-radius: 50%; background: #ef4444; display: inline-block;"></span>
              <span style="width: 10px; height: 10px; border-radius: 50%; background: #f59e0b; display: inline-block;"></span>
              <span style="width: 10px; height: 10px; border-radius: 50%; background: #10b981; display: inline-block;"></span>
              <span id="tw-preview-url-bar" style="margin-left: 0.5rem; background: #ffffff; padding: 0.25rem 0.75rem; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 0.75rem; font-family: monospace; color: #64748b; flex: 1;">
                mitienda.cl/pages/seguimiento-de-tu-pedido
              </span>
              <span style="font-size: 0.75rem; font-weight: 700; color: #5c24ff; background: #ede9fe; padding: 2px 8px; border-radius: 99px;">
                Vista Previa en Vivo
              </span>
            </div>

            <!-- Preview Canvas (Simulated Tracking Widget) -->
            <div id="tw-preview-canvas" style="padding: 1.5rem; background: ${state.background_color === 'transparent' ? '#ffffff' : state.background_color}; min-height: 440px; transition: all 0.3s ease;">
              
              <!-- Brand Logo / Name Preview -->
              <div id="tw-prev-logo-wrap" style="text-align: center; margin-bottom: 1rem; ${state.logo_url ? '' : 'display: none;'}">
                <img id="tw-prev-logo-img" src="${escapeHtml(state.logo_url || '')}" alt="Logo" style="max-height: 42px; max-width: 200px; object-fit: contain; margin: 0 auto;">
              </div>

              <!-- Header Preview -->
              <div style="text-align: center; margin-bottom: 1.5rem;">
                <div id="tw-prev-badge" style="display: inline-flex; align-items: center; gap: 0.35rem; background: rgba(92, 36, 255, 0.1); color: ${state.primary_color || '#5c24ff'}; padding: 0.25rem 0.65rem; border-radius: 99px; font-size: 0.72rem; font-weight: 700; text-transform: uppercase;">
                  <i class="ri-radar-line"></i> <span id="tw-prev-badge-text">${escapeHtml(state.brand_name || 'Mi Tienda Online')}</span>
                </div>
                <h4 style="font-size: 1.2rem; font-weight: 800; color: #0f172a; margin: 0.4rem 0 0.2rem 0;">Seguimiento de tu Pedido</h4>
                <p id="tw-prev-subtitle" style="font-size: 0.78rem; color: #64748b; margin: 0;">
                  Consulta el estado en vivo de tu compra en ${escapeHtml(state.brand_name || 'nuestra tienda')}.
                </p>
              </div>

              <!-- Search Card Preview -->
              <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.25rem; box-shadow: 0 4px 12px rgba(0,0,0,0.03); margin-bottom: 1.25rem;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 0.85rem;">
                  <div>
                    <label style="font-size: 0.75rem; font-weight: 700; color: #334155; margin-bottom: 4px; display: block;">Número de Pedido</label>
                    <input type="text" value="#BIT11048374" readonly style="width: 100%; padding: 0.45rem 0.75rem; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.8rem; background: #f8fafc;">
                  </div>
                  <div>
                    <label style="font-size: 0.75rem; font-weight: 700; color: #334155; margin-bottom: 4px; display: block;">Correo de Compra</label>
                    <input type="email" value="cliente@correo.com" readonly style="width: 100%; padding: 0.45rem 0.75rem; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.8rem; background: #f8fafc;">
                  </div>
                </div>
                <button type="button" id="tw-prev-btn-search" style="width: 100%; padding: 0.65rem; background: ${state.primary_color || '#5c24ff'}; color: #ffffff; border: none; border-radius: 8px; font-weight: 800; font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.4rem; transition: background 0.2s ease;">
                  <i class="ri-search-line"></i> Consultar Estado
                </button>
              </div>

              <!-- Stepper Preview Result -->
              <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.25rem; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #f1f5f9; padding-bottom: 0.65rem;">
                  <span style="font-size: 0.8rem; font-weight: 800; color: #0f172a;">Orden #BIT11048374</span>
                  <span id="tw-prev-status-badge" style="background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; padding: 3px 8px; border-radius: 99px; font-size: 0.72rem; font-weight: 700;">
                    Preparado / Esperando Retiro de Courier
                  </span>
                </div>

                <!-- 4 Steps Stepper Mini -->
                <div style="display: flex; justify-content: space-between; position: relative; margin-bottom: 1.25rem;">
                  <!-- Step 1 -->
                  <div style="text-align: center; flex: 1;">
                    <div style="width: 24px; height: 24px; border-radius: 50%; background: #10b981; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 800;">
                      <i class="ri-check-line"></i>
                    </div>
                    <div style="font-size: 0.68rem; font-weight: 700; color: #0f172a; margin-top: 2px;">1. Confirmado</div>
                  </div>
                  <!-- Step 2 -->
                  <div style="text-align: center; flex: 1;">
                    <div style="width: 24px; height: 24px; border-radius: 50%; background: #10b981; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 800;">
                      <i class="ri-check-line"></i>
                    </div>
                    <div style="font-size: 0.68rem; font-weight: 700; color: #0f172a; margin-top: 2px;">2. Preparación</div>
                  </div>
                  <!-- Step 3 -->
                  <div style="text-align: center; flex: 1;">
                    <div id="tw-prev-step3-circle" style="width: 24px; height: 24px; border-radius: 50%; background: #fff; border: 2px solid ${state.primary_color || '#5c24ff'}; color: ${state.primary_color || '#5c24ff'}; display: inline-flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 800;">
                      <i class="ri-truck-line"></i>
                    </div>
                    <div style="font-size: 0.68rem; font-weight: 700; color: #0f172a; margin-top: 2px;">3. Despacho</div>
                  </div>
                  <!-- Step 4 -->
                  <div style="text-align: center; flex: 1;">
                    <div style="width: 24px; height: 24px; border-radius: 50%; background: #f1f5f9; border: 2px solid #cbd5e1; color: #94a3b8; display: inline-flex; align-items: center; justify-content: center; font-size: 0.75rem;">
                      <i class="ri-flag-2-line"></i>
                    </div>
                    <div style="font-size: 0.68rem; font-weight: 600; color: #94a3b8; margin-top: 2px;">4. Entrega</div>
                  </div>
                </div>

                <!-- Courier row preview -->
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.65rem 0.85rem; display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem;">
                  <div>
                    <span style="color: #64748b;">Transporte:</span> <strong>STARKEN</strong>
                  </div>
                  <div id="tw-prev-courier-btn-wrap" style="${state.show_courier_link !== false ? '' : 'display: none;'}">
                    <span id="tw-prev-courier-btn" style="background: ${state.primary_color || '#5c24ff'}; color: #fff; padding: 3px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 700;">
                      Ver Rastreo
                    </span>
                  </div>
                </div>

                <!-- WhatsApp Support preview -->
                <div id="tw-prev-wa-wrap" style="margin-top: 0.85rem; text-align: center; ${state.support_wa ? '' : 'display: none;'}">
                  <span style="display: inline-flex; align-items: center; gap: 0.35rem; background: #25d366; color: #ffffff; padding: 0.45rem 1rem; border-radius: 99px; font-weight: 700; font-size: 0.75rem;">
                    <i class="ri-whatsapp-line"></i> ¿Dudas? Chatea con nosotros por WhatsApp
                  </span>
                </div>

              </div>

            </div>
          </div>

          <!-- Bottom: Code Generator Box -->
          <div style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; padding: 1.25rem; box-shadow: var(--shadow-sm);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
              <span style="font-weight: 800; font-size: 0.95rem; color: var(--color-text-main);">
                📋 Código de Inserción para tu Tienda
              </span>
              <button type="button" id="btn-copy-tw-code" class="btn btn-primary" style="padding: 0.4rem 0.85rem; font-size: 0.8rem; font-weight: 700; border-radius: 6px; display: inline-flex; align-items: center; gap: 0.35rem;">
                <i class="ri-file-copy-line"></i> Copiar Código
              </button>
            </div>
            
            <textarea id="tw-generated-code" readonly style="width: 100%; height: 110px; font-family: monospace; font-size: 0.75rem; background: #0f172a; color: #38bdf8; border: 1px solid #334155; border-radius: 8px; padding: 0.75rem; resize: none;"></textarea>
            
            <div style="display: flex; gap: 0.5rem; margin-top: 0.65rem; font-size: 0.75rem; color: var(--color-text-muted);">
              <span>💡 <strong>Shopify:</strong> Crea una Página > Botón &lt;&gt; (HTML) > Pega este código.</span>
            </div>
          </div>

        </div>

      </div>

    </div>
  `;

  // Attach interactive listeners
  attachCustomizerEvents(container, state);
}

function attachCustomizerEvents(container, state) {
  const colorPicker = container.querySelector('#tw-color-picker');
  const colorHex = container.querySelector('#tw-color-hex');
  const brandInput = container.querySelector('#tw-brand-name');
  const logoInput = container.querySelector('#tw-logo-url');
  const waInput = container.querySelector('#tw-support-wa');
  const emailInput = container.querySelector('#tw-support-email');
  const pickingCb = container.querySelector('#tw-show-picking');
  const courierCb = container.querySelector('#tw-show-courier');
  const bgRadios = container.querySelectorAll('input[name="tw-bg-choice"]');
  const commerceSelect = container.querySelector('#tw-select-commerce');
  const saveBtn = container.querySelector('#btn-save-tw-settings');
  const copyBtn = container.querySelector('#btn-copy-tw-code');

  function updateStateAndPreview() {
    state.primary_color = colorHex.value.trim() || '#5c24ff';
    state.brand_name = brandInput.value.trim();
    state.logo_url = logoInput.value.trim();
    state.support_wa = waInput.value.trim();
    state.support_email = emailInput.value.trim();
    state.show_picking = pickingCb.checked;
    state.show_courier_link = courierCb.checked;

    const selBg = container.querySelector('input[name="tw-bg-choice"]:checked');
    state.background_color = selBg ? selBg.value : 'transparent';

    // 1. Update Preview Buttons & Elements
    const prevBtn = container.querySelector('#tw-prev-btn-search');
    if (prevBtn) prevBtn.style.background = state.primary_color;

    const prevStep3 = container.querySelector('#tw-prev-step3-circle');
    if (prevStep3) {
      prevStep3.style.borderColor = state.primary_color;
      prevStep3.style.color = state.primary_color;
    }

    const prevCourierBtn = container.querySelector('#tw-prev-courier-btn');
    if (prevCourierBtn) prevCourierBtn.style.background = state.primary_color;

    const prevBadge = container.querySelector('#tw-prev-badge');
    if (prevBadge) prevBadge.style.color = state.primary_color;

    const prevBadgeText = container.querySelector('#tw-prev-badge-text');
    if (prevBadgeText) prevBadgeText.textContent = state.brand_name || 'Mi Tienda Online';

    const prevSub = container.querySelector('#tw-prev-subtitle');
    if (prevSub) prevSub.textContent = `Consulta el estado en vivo de tu compra en ${state.brand_name || 'nuestra tienda'}.`;

    // 2. Background Canvas
    const canvas = container.querySelector('#tw-preview-canvas');
    if (canvas) {
      canvas.style.background = state.background_color === 'transparent' ? '#ffffff' : state.background_color;
    }

    // 3. Logo Preview
    const logoWrap = container.querySelector('#tw-prev-logo-wrap');
    const logoImg = container.querySelector('#tw-prev-logo-img');
    if (logoWrap && logoImg) {
      if (state.logo_url) {
        logoImg.src = state.logo_url;
        logoWrap.style.display = 'block';
      } else {
        logoWrap.style.display = 'none';
      }
    }

    // 4. WhatsApp Support Preview
    const waWrap = container.querySelector('#tw-prev-wa-wrap');
    if (waWrap) {
      waWrap.style.display = state.support_wa ? 'block' : 'none';
    }

    // 5. Courier Button Preview
    const courierBtnWrap = container.querySelector('#tw-prev-courier-btn-wrap');
    if (courierBtnWrap) {
      courierBtnWrap.style.display = state.show_courier_link ? 'block' : 'none';
    }

    // 6. Generate Embed Code
    generateEmbedSnippet(state);
  }

  function generateEmbedSnippet(st) {
    const codeArea = container.querySelector('#tw-generated-code');
    if (!codeArea) return;

    const params = new URLSearchParams();
    params.set('embed', '1');
    if (window.activeTrackingCommerce) params.set('comercio', window.activeTrackingCommerce);
    if (st.primary_color && st.primary_color !== '#5c24ff') params.set('color', st.primary_color.replace('#', ''));
    if (st.background_color && st.background_color !== 'transparent') params.set('bg', st.background_color.replace('#', ''));
    if (st.brand_name) params.set('brand', st.brand_name);
    if (st.logo_url) params.set('logo', st.logo_url);
    if (st.support_wa) params.set('wa', st.support_wa.replace(/[^0-9]/g, ''));
    if (st.show_picking === false) params.set('picking', '0');
    if (st.show_courier_link === false) params.set('courier_link', '0');

    const iframeUrl = `https://wms.stocka.cl/seguimiento.html?${params.toString()}`;

    const snippet = `<div style="width: 100%; max-width: 900px; margin: 0 auto; min-height: 520px;">
  <iframe id="stocka-tracking-frame" src="${iframeUrl}" width="100%" height="650" frameborder="0" scrolling="no" style="border: none; width: 100%; display: block; overflow: hidden; background: transparent;" allow="clipboard-write"></iframe>
</div>
<script>
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'stocka-tracking-resize') {
      var frame = document.getElementById('stocka-tracking-frame');
      if (frame && e.data.height) { frame.style.height = (e.data.height + 20) + 'px'; }
    }
  });
</script>`;

    codeArea.value = snippet;
  }

  // Color picker sync
  colorPicker.addEventListener('input', (e) => {
    colorHex.value = e.target.value;
    updateStateAndPreview();
  });

  colorHex.addEventListener('input', (e) => {
    let val = e.target.value.trim();
    if (!val.startsWith('#')) val = '#' + val;
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      colorPicker.value = val;
      updateStateAndPreview();
    }
  });

  // Preset buttons
  container.querySelectorAll('.tw-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = btn.getAttribute('data-color');
      colorPicker.value = c;
      colorHex.value = c;
      updateStateAndPreview();
    });
  });

  // Text inputs
  [brandInput, logoInput, waInput, emailInput].forEach(inp => {
    inp.addEventListener('input', updateStateAndPreview);
  });

  // Radios and Checkboxes
  bgRadios.forEach(r => r.addEventListener('change', updateStateAndPreview));
  pickingCb.addEventListener('change', updateStateAndPreview);
  courierCb.addEventListener('change', updateStateAndPreview);

  // Commerce selector change
  if (commerceSelect) {
    commerceSelect.addEventListener('change', async (e) => {
      window.activeTrackingCommerce = e.target.value;
      const newCfg = await loadTrackingWidgetConfig(window.activeTrackingCommerce);
      const appContent = document.getElementById('app-content');
      renderCustomizerUI(appContent, window.currentCompany.split(',').map(c => c.trim()), newCfg);
    });
  }

  // Save Settings Button
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    const origHtml = saveBtn.innerHTML;
    saveBtn.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> Guardando...`;

    try {
      await saveTrackingWidgetConfig(window.activeTrackingCommerce, state);
      if (window.Swal) {
        window.Swal.fire({
          icon: 'success',
          title: '¡Configuración Guardada!',
          text: `La personalización de tracking para ${window.activeTrackingCommerce} se guardó exitosamente. Todos los pedidos asociados aplicarán estos colores y logotipo.`,
          confirmButtonColor: state.primary_color || '#5c24ff'
        });
      } else {
        alert('Configuración guardada exitosamente.');
      }
    } catch (err) {
      if (window.Swal) {
        window.Swal.fire({
          icon: 'error',
          title: 'Error al Guardar',
          text: err.message || 'No se pudo guardar la configuración.'
        });
      } else {
        alert('Error al guardar: ' + err.message);
      }
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = origHtml;
    }
  });

  // Copy Code Button
  copyBtn.addEventListener('click', () => {
    const codeArea = container.querySelector('#tw-generated-code');
    if (!codeArea) return;
    navigator.clipboard.writeText(codeArea.value).then(() => {
      const origHtml = copyBtn.innerHTML;
      copyBtn.innerHTML = `<i class="ri-check-line" style="color: #10b981;"></i> ¡Copiado!`;
      setTimeout(() => { copyBtn.innerHTML = origHtml; }, 2500);
      if (window.Swal) {
        const Toast = window.Swal.mixin({
          toast: true,
          position: 'top-end',
          showConfirmButton: false,
          timer: 3000,
          timerProgressBar: true
        });
        Toast.fire({
          icon: 'success',
          title: 'Código copiado al portapapeles. ¡Listo para pegar en Shopify!'
        });
      }
    }).catch(err => {
      console.error("Error al copiar:", err);
    });
  });

  // Initialize Code snippet
  generateEmbedSnippet(state);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
