/**
 * pricing_admin.js - Módulo de Administración de Tarifas y Reglas del Cotizador
 * STOCKA WMS
 */

import supabase from './supabase.js?v=1.0.3';
import { 
  loadPricingConfig, 
  savePricingConfig, 
  resetPricingConfigToDefaults, 
  DEFAULT_PRICING_CONFIG, 
  formatCLP 
} from './pricing_manager.js';

let activeTab = 'ranges'; // 'ranges' | 'storage_rules' | 'pickpack_shipping' | 'leads'

export async function renderPricingConfigAdmin() {
  const appContent = document.getElementById('app-content');
  if (!appContent) return;

  appContent.innerHTML = `
    <div style="text-align: center; padding: 3rem;">
      <i class="ri-loader-4-line ri-spin" style="font-size: 2rem; color: var(--color-accent);"></i>
      <p style="margin-top: 0.5rem; color: var(--color-text-muted);">Cargando configuración de tarifas...</p>
    </div>
  `;

  try {
    const config = await loadPricingConfig(supabase);

    // Cargar leads de cotizaciones (Supabase + Respaldo Local)
    let leads = [];
    try {
      const { data, error } = await supabase
        .from('quote_leads')
        .select('*')
        .order('created_at', { ascending: false });
      if (!error && data && data.length > 0) {
        leads = data;
      }
    } catch (e) {
      console.warn("No se pudieron cargar quote_leads de Supabase:", e);
    }

    // Merge con respaldo de localStorage
    try {
      const localLeads = JSON.parse(localStorage.getItem('stocka_wms_quote_leads_cache') || '[]');
      if (localLeads.length > 0) {
        const existingSignatures = new Set(leads.map(l => `${l.email}_${new Date(l.created_at).getTime()}`));
        localLeads.forEach(ll => {
          const sig = `${ll.email}_${new Date(ll.created_at).getTime()}`;
          if (!existingSignatures.has(sig)) {
            leads.push(ll);
          }
        });
        leads.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      }
    } catch (lsErr) {
      console.warn("Error leyendo quote_leads de localStorage:", lsErr);
    }

    renderAdminUI(config, leads);
  } catch (err) {
    console.error("Error al renderizar módulo de tarifas:", err);
    appContent.innerHTML = `
      <div class="alert alert-danger" style="margin: 2rem;">
        <i class="ri-error-warning-line"></i> Error al cargar la configuración de tarifas: ${err.message}
      </div>
    `;
  }
}

function renderAdminUI(config, leads) {
  const appContent = document.getElementById('app-content');
  if (!appContent) return;

  appContent.innerHTML = `
    <div style="max-width: 1300px; margin: 0 auto; padding-bottom: 3rem;">
      
      <!-- Top Action Header -->
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem; background: var(--color-surface); padding: 1.25rem 1.5rem; border-radius: var(--radius-lg); border: 1px solid var(--color-border);">
        <div>
          <h2 style="font-size: 1.35rem; font-weight: 800; color: var(--color-text-main); margin: 0; display: flex; align-items: center; gap: 0.5rem;">
            <i class="ri-price-tag-3-line" style="color: var(--color-accent);"></i> Configuración de Tarifario & Cotizador 360
          </h2>
          <p style="font-size: 0.85rem; color: var(--color-text-muted); margin: 0.25rem 0 0 0;">
            Versión activa: <strong>${config.version || '1.2'}</strong> | Última actualización: <strong>${config.updated_at ? new Date(config.updated_at).toLocaleDateString() : 'Oficial'}</strong>
          </p>
        </div>

        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
          <a href="./cotizaciones.html" target="_blank" class="btn btn-outline" style="font-size: 0.82rem; display: inline-flex; align-items: center; gap: 0.35rem; border-color: var(--color-border); color: var(--color-text-main);">
            <i class="ri-external-link-line"></i> Abrir Cotizador
          </a>
          <button type="button" id="btn-copy-quote-link" class="btn btn-outline" style="font-size: 0.82rem; display: inline-flex; align-items: center; gap: 0.35rem; border-color: var(--color-border); color: var(--color-text-main);">
            <i class="ri-file-copy-line"></i> Copiar Enlace Público
          </button>
          <button type="button" id="btn-reset-pricing" class="btn btn-outline" style="font-size: 0.82rem; color: var(--color-danger); border-color: rgba(239,68,68,0.3);">
            <i class="ri-restart-line"></i> Restablecer Oficial
          </button>
          <button type="button" id="btn-save-pricing" class="btn btn-primary" style="font-size: 0.82rem; background: var(--color-accent); border-color: var(--color-accent); font-weight: 700;">
            <i class="ri-save-3-line"></i> Guardar Tarifas
          </button>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div style="display: flex; gap: 0.5rem; margin-bottom: 1.5rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.5rem; overflow-x: auto;">
        <button type="button" class="btn-tab-admin ${activeTab === 'ranges' ? 'active' : ''}" data-tab="ranges">
          <i class="ri-bar-chart-grouped-line"></i> 1. Rangos de Pedidos y Almacenamiento
        </button>
        <button type="button" class="btn-tab-admin ${activeTab === 'storage_rules' ? 'active' : ''}" data-tab="storage_rules">
          <i class="ri-archive-line"></i> 2. Descuentos por Volumen & Costos Fijos
        </button>
        <button type="button" class="btn-tab-admin ${activeTab === 'pickpack_shipping' ? 'active' : ''}" data-tab="pickpack_shipping">
          <i class="ri-truck-line"></i> 3. Pick & Pack, Recargos y Despachos
        </button>
        <button type="button" class="btn-tab-admin ${activeTab === 'leads' ? 'active' : ''}" data-tab="leads">
          <i class="ri-user-star-line"></i> 4. Leads de Cotizaciones (${leads.length})
        </button>
        <button type="button" class="btn-tab-admin ${activeTab === 'presentations' ? 'active' : ''}" data-tab="presentations">
          <i class="ri-slideshow-3-line"></i> 5. Presentaciones del Servicio
        </button>
      </div>

      <!-- Form Container -->
      <form id="admin-pricing-form">
        
        <!-- PESTAÑA 1: RANGOS DE PEDIDOS -->
        <div id="tab-content-ranges" class="admin-pricing-tab-content" style="display: ${activeTab === 'ranges' ? 'block' : 'none'};">
          <div class="card" style="padding: 1.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg);">
            <div style="margin-bottom: 1.25rem;">
              <h3 style="font-size: 1.05rem; font-weight: 700; color: var(--color-text-main); margin: 0 0 0.25rem 0;">Tabla de Pedidos Procesados (Rangos 1 al 7)</h3>
              <p style="font-size: 0.8rem; color: var(--color-text-muted); margin: 0;">Define la tarifa base de preparación (Pick & Pack) y el costo por metro cúbico (m³) para cada tramo de pedidos mensuales.</p>
            </div>

            <div class="table-responsive">
              <table class="data-table" style="width: 100%; font-size: 0.85rem;">
                <thead>
                  <tr>
                    <th style="width: 8%;">Rango</th>
                    <th style="width: 25%;">Tramo de Ventas</th>
                    <th style="width: 33%;">Pick & Pack Base ($ + IVA / pedido)</th>
                    <th style="width: 34%;">Almacenamiento ($ + IVA / m³)</th>
                  </tr>
                </thead>
                <tbody>
                  ${config.order_ranges.map((r, idx) => `
                    <tr>
                      <td style="font-weight: 700; text-align: center; color: var(--color-accent);">${r.id}</td>
                      <td>
                        <strong>${r.label}</strong>
                        <div style="font-size: 0.72rem; color: var(--color-text-muted);">
                          Min: <input type="number" class="form-input-sm" name="range_${idx}_min" value="${r.min}" style="width: 55px; display: inline-block; padding: 2px 4px; font-size: 0.75rem;"> 
                          Max: <input type="number" class="form-input-sm" name="range_${idx}_max" value="${r.max}" style="width: 65px; display: inline-block; padding: 2px 4px; font-size: 0.75rem;">
                        </div>
                      </td>
                      <td>
                        <div style="display: flex; align-items: center; gap: 0.35rem;">
                          <span>$</span>
                          <input type="number" class="form-input" name="range_${idx}_pick_pack" value="${r.pick_pack_base}" required style="font-weight: 700; width: 120px;">
                        </div>
                      </td>
                      <td>
                        <div style="display: flex; align-items: center; gap: 0.35rem;">
                          <span>$</span>
                          <input type="number" class="form-input" name="range_${idx}_storage_m3" value="${r.storage_m3}" required style="font-weight: 700; width: 120px;">
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- PESTAÑA 2: DESCUENTOS Y COSTOS FIJOS -->
        <div id="tab-content-storage_rules" class="admin-pricing-tab-content" style="display: ${activeTab === 'storage_rules' ? 'block' : 'none'};">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
            
            <!-- Descuentos por Volumen de Almacenamiento -->
            <div class="card" style="padding: 1.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg);">
              <h3 style="font-size: 1.05rem; font-weight: 700; color: var(--color-text-main); margin-bottom: 0.5rem;">
                <i class="ri-percent-line" style="color: var(--color-success);"></i> Descuentos por Volumen (> 10 m³)
              </h3>
              <p style="font-size: 0.8rem; color: var(--color-text-muted); margin-bottom: 1rem;">Descuento porcentual automático aplicado al costo de almacenamiento según m³.</p>

              <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                ${config.storage_discounts.map((d, idx) => `
                  <div style="display: flex; justify-content: space-between; align-items: center; background: var(--color-bg); padding: 0.75rem 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
                    <span style="font-weight: 600; font-size: 0.85rem;">${d.min} a ${d.max === 999999 ? '+60' : d.max} m³</span>
                    <div style="display: flex; align-items: center; gap: 0.35rem;">
                      <input type="number" class="form-input" name="discount_${idx}_pct" value="${d.discount_pct}" min="0" max="100" style="width: 70px; text-align: right; font-weight: 700;">
                      <span style="font-weight: 700;">%</span>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>

            <!-- Costos Fijos y Valor UF -->
            <div class="card" style="padding: 1.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg);">
              <h3 style="font-size: 1.05rem; font-weight: 700; color: var(--color-text-main); margin-bottom: 0.5rem;">
                <i class="ri-shield-line" style="color: var(--color-accent);"></i> Reglas de Costo Fijo & UF
              </h3>
              <p style="font-size: 0.8rem; color: var(--color-text-muted); margin-bottom: 1rem;">Criterios para aplicar costo fijo mensual a clientes de bajo volumen.</p>

              <div class="form-group">
                <label class="form-label">Valor UF de Referencia (CLP)</label>
                <div style="display: flex; align-items: center; gap: 0.35rem;">
                  <span>$</span>
                  <input type="number" class="form-input" id="input-admin-uf" name="uf_value" value="${config.uf_value || 38500}" required style="font-weight: 700;">
                </div>
              </div>

              <div class="form-grid-2" style="margin-top: 1rem;">
                <div class="form-group">
                  <label class="form-label">Mín. Pedidos Exención ($0)</label>
                  <input type="number" class="form-input" name="fixed_min_orders" value="${config.fixed_service_fee.exemption_min_orders || 75}">
                  <small style="font-size: 0.72rem; color: var(--color-text-muted);">Si pedidos >= este valor -> $0</small>
                </div>
                <div class="form-group">
                  <label class="form-label">Mín. m³ Exención ($0)</label>
                  <input type="number" class="form-input" step="0.1" name="fixed_min_volume" value="${config.fixed_service_fee.exemption_min_volume || 1.5}">
                  <small style="font-size: 0.72rem; color: var(--color-text-muted);">Si m³ >= este valor -> $0</small>
                </div>
              </div>

              <div class="form-grid-2" style="margin-top: 1rem;">
                <div class="form-group">
                  <label class="form-label">Tramo 1 (< 50 ped. y < 1 m³)</label>
                  <div style="display: flex; align-items: center; gap: 0.35rem;">
                    <input type="number" step="0.1" class="form-input" name="fixed_tier1_uf" value="${config.fixed_service_fee.tier1_fee_uf || 1.5}">
                    <span style="font-weight: 700;">UF</span>
                  </div>
                </div>
                <div class="form-group">
                  <label class="form-label">Tramo 2 (< 75 ped. o < 1.5 m³)</label>
                  <div style="display: flex; align-items: center; gap: 0.35rem;">
                    <input type="number" step="0.1" class="form-input" name="fixed_tier2_uf" value="${config.fixed_service_fee.tier2_fee_uf || 0.9}">
                    <span style="font-weight: 700;">UF</span>
                  </div>
                </div>
              </div>

            </div>

          </div>
        </div>

        <!-- PESTAÑA 3: RECARGOS, DESPACHOS Y EXTRAS -->
        <div id="tab-content-pickpack_shipping" class="admin-pricing-tab-content" style="display: ${activeTab === 'pickpack_shipping' ? 'block' : 'none'};">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
            
            <!-- Recargos Pick & Pack -->
            <div class="card" style="padding: 1.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg);">
              <h3 style="font-size: 1.05rem; font-weight: 700; color: var(--color-text-main); margin-bottom: 0.5rem;">
                <i class="ri-box-3-line" style="color: var(--color-accent);"></i> Condiciones y Recargos de Preparación
              </h3>
              
              <div class="form-group" style="margin-top: 1rem;">
                <label class="form-label">Tarifa Venta Protegida (&lt; $10.000 ticket)</label>
                <div style="display: flex; align-items: center; gap: 0.35rem;">
                  <span>$</span>
                  <input type="number" class="form-input" name="protected_ticket_base_rate" value="${config.pick_pack_rules.protected_ticket_base_rate || 650}">
                </div>
              </div>

              <div class="form-grid-2">
                <div class="form-group">
                  <label class="form-label">Recargo por SKU extra (&gt; 3 SKU)</label>
                  <div style="display: flex; align-items: center; gap: 0.35rem;">
                    <span>$</span>
                    <input type="number" class="form-input" name="surcharge_extra_sku" value="${config.pick_pack_rules.surcharge_extra_sku || 100}">
                  </div>
                </div>
                <div class="form-group">
                  <label class="form-label">Recargo por Unidad extra (&gt; 10 unid)</label>
                  <div style="display: flex; align-items: center; gap: 0.35rem;">
                    <span>$</span>
                    <input type="number" class="form-input" name="surcharge_extra_unit" value="${config.pick_pack_rules.surcharge_extra_unit || 50}">
                  </div>
                </div>
              </div>

              <div class="form-grid-2" style="margin-top: 0.5rem;">
                <div class="form-group">
                  <label class="form-label">Recargo Colecta Marketplace</label>
                  <div style="display: flex; align-items: center; gap: 0.35rem;">
                    <span>$</span>
                    <input type="number" class="form-input" name="surcharge_marketplace_collect" value="${config.pick_pack_rules.surcharge_marketplace_collect || 100}">
                  </div>
                </div>
                <div class="form-group">
                  <label class="form-label">Recargo Catálogo &gt; 100 SKU</label>
                  <div style="display: flex; align-items: center; gap: 0.35rem;">
                    <span>$</span>
                    <input type="number" class="form-input" name="surcharge_catalogue_over_100_sku" value="${config.pick_pack_rules.surcharge_catalogue_over_100_sku || 100}">
                  </div>
                </div>
              </div>
            </div>

            <!-- Tarifas de Despacho y Extras -->
            <div class="card" style="padding: 1.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg);">
              <h3 style="font-size: 1.05rem; font-weight: 700; color: var(--color-text-main); margin-bottom: 0.5rem;">
                <i class="ri-truck-line" style="color: var(--color-primary);"></i> Tarifas de Despacho y Sucursal
              </h3>

              <div class="form-grid-2" style="margin-top: 1rem;">
                <div class="form-group">
                  <label class="form-label">Despacho RM Same Day / Flex</label>
                  <div style="display: flex; align-items: center; gap: 0.35rem;">
                    <span>$</span>
                    <input type="number" class="form-input" name="shipping_same_day_rm" value="${config.shipping.same_day_rm || 3200}" style="font-weight: 700;">
                  </div>
                </div>
                <div class="form-group">
                  <label class="form-label">Despacho a Colina</label>
                  <div style="display: flex; align-items: center; gap: 0.35rem;">
                    <span>$</span>
                    <input type="number" class="form-input" name="shipping_colina" value="${config.shipping.colina || 3490}">
                  </div>
                </div>
              </div>

              <div class="form-grid-2" style="margin-top: 0.5rem;">
                <div class="form-group">
                  <label class="form-label">Cargo Integración Envíame / orden</label>
                  <div style="display: flex; align-items: center; gap: 0.35rem;">
                    <span>$</span>
                    <input type="number" class="form-input" name="shipping_enviame_fee" value="${config.shipping.enviame_integration_fee || 35}">
                  </div>
                </div>
                <div class="form-group">
                  <label class="form-label">Retiro Express Sucursal Base</label>
                  <div style="display: flex; align-items: center; gap: 0.35rem;">
                    <span>$</span>
                    <input type="number" class="form-input" name="shipping_pickup_express" value="${config.shipping.pickup_express_base || 1490}">
                  </div>
                </div>
              </div>

              <hr style="border: 0; border-top: 1px dashed var(--color-border); margin: 1.25rem 0;">
              
              <div class="form-grid-2">
                <div class="form-group">
                  <label class="form-label">Punto de Venta POS (UF/mes)</label>
                  <input type="number" step="0.1" class="form-input" name="service_pos_uf" value="${config.services.pos_monthly_uf || 0.2}">
                </div>
                <div class="form-group">
                  <label class="form-label">Vitrina Exhibición (UF/mes)</label>
                  <input type="number" step="0.1" class="form-input" name="service_vitrina_uf" value="${config.services.vitrina_monthly_uf || 0.6}">
                </div>
              </div>

            </div>

          </div>
        </div>

        <!-- PESTAÑA 4: LEADS DE COTIZACIONES -->
        <div id="tab-content-leads" class="admin-pricing-tab-content" style="display: ${activeTab === 'leads' ? 'block' : 'none'};">
          <div class="card" style="padding: 1.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg);">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1.25rem;">
              <div>
                <h3 style="font-size: 1.05rem; font-weight: 700; color: var(--color-text-main); margin: 0;">Leads y Cotizaciones de Usuarios Públicos</h3>
                <p style="font-size: 0.8rem; color: var(--color-text-muted); margin: 0.25rem 0 0 0;">Personas y marcas que han simulado y solicitado su cotización desde el portal web.</p>
              </div>
              <div style="display: flex; gap: 0.5rem;">
                <button type="button" id="btn-refresh-leads" class="btn btn-outline" style="font-size: 0.78rem; padding: 0.35rem 0.75rem;">
                  <i class="ri-refresh-line"></i> Actualizar Leads
                </button>
              </div>
            </div>

            ${leads.length === 0 ? `
              <div style="text-align: center; padding: 3rem 1rem; color: var(--color-text-muted);">
                <i class="ri-inbox-line" style="font-size: 2.5rem; display: block; margin-bottom: 0.5rem;"></i>
                Aún no hay cotizaciones registradas por usuarios públicos.
              </div>
            ` : `
              <div class="table-responsive">
                <table class="data-table" style="width: 100%; font-size: 0.82rem;">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Comercio / Empresa</th>
                      <th>Contacto</th>
                      <th>Email / Teléfono</th>
                      <th>Pedidos/mes</th>
                      <th>Volumen m³</th>
                      <th>Total Neto Cotizado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${leads.map(lead => `
                      <tr>
                        <td>${new Date(lead.created_at).toLocaleDateString()} ${new Date(lead.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                        <td style="font-weight: 700; color: var(--color-text-main);">${lead.company_name || '—'}</td>
                        <td>${lead.contact_name || '—'}</td>
                        <td>
                          <div><i class="ri-mail-line"></i> ${lead.email || '—'}</div>
                          <div style="color: var(--color-text-muted); font-size: 0.75rem;"><i class="ri-phone-line"></i> ${lead.phone || '—'}</div>
                        </td>
                        <td style="text-align: center; font-weight: 700;">${lead.monthly_orders || 0}</td>
                        <td style="text-align: center; font-weight: 700;">${parseFloat(lead.estimated_volume || 0).toFixed(2)} m³</td>
                        <td style="font-weight: 700; color: var(--color-accent);">${formatCLP(lead.estimated_monthly_net)}</td>
                        <td>
                          ${lead.phone ? `
                            <a href="https://wa.me/${lead.phone.replace(/[^0-9]/g, '')}" target="_blank" class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; color: #15803d; border-color: #22c55e;" title="Contactar por WhatsApp">
                              <i class="ri-whatsapp-line"></i> Contactar
                            </a>
                          ` : ''}
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>
        </div>

        <!-- PESTAÑA 5: PRESENTACIONES DEL SERVICIO -->
        <div id="tab-content-presentations" class="admin-pricing-tab-content" style="display: ${activeTab === 'presentations' ? 'block' : 'none'};">
          <div class="card" style="padding: 1.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg);">
            <div style="margin-bottom: 1.25rem;">
              <h3 style="font-size: 1.05rem; font-weight: 700; color: var(--color-text-main); margin: 0 0 0.25rem 0;">Presentaciones Oficiales del Servicio (Adjuntas en Email y Cotizador)</h3>
              <p style="font-size: 0.8rem; color: var(--color-text-muted); margin: 0;">Gestiona los enlaces o archivos PDF que reciben los clientes cuando cotizan por correo o descargan desde el cotizador web.</p>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.5rem;">
              <!-- Fulfillment 360 -->
              <div style="padding: 1.25rem; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                  <h4 style="margin: 0; font-size: 0.95rem; font-weight: 700; color: #5e17eb; display: flex; align-items: center; gap: 0.35rem;">
                    <i class="ri-box-3-fill"></i> 1. Presentación Fulfillment 360
                  </h4>
                  <a href="${config.presentations?.fulfillment_url || 'https://wms.stocka.cl/downloads/presentacion_fulfillment_360.pdf'}" target="_blank" class="btn btn-outline" style="padding: 0.2rem 0.5rem; font-size: 0.75rem; color: #5e17eb; border-color: #5e17eb;">
                    <i class="ri-file-pdf-fill"></i> Ver PDF
                  </a>
                </div>
                <div class="form-group">
                  <label class="form-label" style="font-size: 0.78rem;">URL del Documento / PDF:</label>
                  <input type="url" class="form-input" name="pres_fulfillment_url" value="${config.presentations?.fulfillment_url || ''}" placeholder="https://..." style="font-size: 0.8rem;">
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                  <label class="form-label" style="font-size: 0.78rem;">Cargar nuevo archivo PDF:</label>
                  <input type="file" id="pricing-admin-fulfillment-file" accept=".pdf" class="form-input" style="font-size: 0.78rem; padding: 0.35rem 0.5rem;">
                </div>
              </div>

              <!-- Despachos RM -->
              <div style="padding: 1.25rem; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                  <h4 style="margin: 0; font-size: 0.95rem; font-weight: 700; color: #2563eb; display: flex; align-items: center; gap: 0.35rem;">
                    <i class="ri-truck-fill"></i> 2. Presentación Despachos RM
                  </h4>
                  <a href="${config.presentations?.despachos_rm_url || 'https://wms.stocka.cl/downloads/presentacion_despachos_rm.pdf'}" target="_blank" class="btn btn-outline" style="padding: 0.2rem 0.5rem; font-size: 0.75rem; color: #2563eb; border-color: #2563eb;">
                    <i class="ri-file-pdf-fill"></i> Ver PDF
                  </a>
                </div>
                <div class="form-group">
                  <label class="form-label" style="font-size: 0.78rem;">URL del Documento / PDF:</label>
                  <input type="url" class="form-input" name="pres_despachos_rm_url" value="${config.presentations?.despachos_rm_url || ''}" placeholder="https://..." style="font-size: 0.8rem;">
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                  <label class="form-label" style="font-size: 0.78rem;">Cargar nuevo archivo PDF:</label>
                  <input type="file" id="pricing-admin-despachos-file" accept=".pdf" class="form-input" style="font-size: 0.78rem; padding: 0.35rem 0.5rem;">
                </div>
              </div>
            </div>

            <p style="margin-top: 1rem; font-size: 0.75rem; color: var(--color-text-muted);">
              💡 <em>Nota: También puedes subir y reemplazar estos archivos directamente desde la sección <strong>Documentación del Servicio</strong> en el menú lateral.</em>
            </p>
          </div>
        </div>

      </form>

    </div>
  `;

  // Estilos de tabs en la cabecera
  const tabStyles = document.createElement('style');
  tabStyles.innerHTML = `
    .btn-tab-admin {
      padding: 0.6rem 1.1rem;
      font-size: 0.85rem;
      font-weight: 600;
      border-radius: var(--radius-md);
      border: 1px solid var(--color-border);
      background: var(--color-surface);
      color: var(--color-text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.4rem;
      transition: all 0.2s ease;
      white-space: nowrap;
    }
    .btn-tab-admin:hover {
      background: var(--color-surface-hover);
      color: var(--color-text-main);
    }
    .btn-tab-admin.active {
      background: var(--color-accent);
      color: #ffffff;
      border-color: var(--color-accent);
      box-shadow: var(--shadow-glow-accent);
    }
  `;
  document.head.appendChild(tabStyles);

  // Event Listeners de Tabs
  document.querySelectorAll('.btn-tab-admin').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      activeTab = tab;
      document.querySelectorAll('.btn-tab-admin').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.admin-pricing-tab-content').forEach(c => c.style.display = 'none');
      const targetContent = document.getElementById(`tab-content-${tab}`);
      if (targetContent) targetContent.style.display = 'block';
    });
  });

  // Copiar Enlace Público
  const btnCopy = document.getElementById('btn-copy-quote-link');
  if (btnCopy) {
    btnCopy.addEventListener('click', () => {
      const url = `${window.location.origin}/cotizaciones.html`;
      navigator.clipboard.writeText(url).then(() => {
        if (window.Swal) {
          window.Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'success',
            title: 'Enlace público copiado',
            text: url,
            showConfirmButton: false,
            timer: 2500
          });
        } else {
          alert(`Enlace copiado: ${url}`);
        }
      });
    });
  }

  // Refrescar Leads
  const btnRefreshLeads = document.getElementById('btn-refresh-leads');
  if (btnRefreshLeads) {
    btnRefreshLeads.addEventListener('click', () => {
      activeTab = 'leads';
      renderPricingConfigAdmin();
    });
  }

  // Restablecer Valores Oficiales
  const btnReset = document.getElementById('btn-reset-pricing');
  if (btnReset) {
    btnReset.addEventListener('click', async () => {
      if (confirm('¿Estás seguro de restablecer todas las tarifas a los valores oficiales del Tarifario 2024-2025 v1.2?')) {
        await resetPricingConfigToDefaults(supabase);
        if (window.Swal) {
          window.Swal.fire({ icon: 'success', title: 'Tarifario Restablecido', text: 'Se han restaurado los valores por defecto oficiales.', timer: 2000 });
        }
        renderPricingConfigAdmin();
      }
    });
  }

  // Guardar Cambios
  const btnSave = document.getElementById('btn-save-pricing');
  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      const form = document.getElementById('admin-pricing-form');
      if (!form) return;

      const formData = new FormData(form);
      const updatedConfig = JSON.parse(JSON.stringify(config));

      // Actualizar rangos
      updatedConfig.order_ranges.forEach((r, idx) => {
        r.min = parseInt(formData.get(`range_${idx}_min`), 10) || r.min;
        r.max = parseInt(formData.get(`range_${idx}_max`), 10) || r.max;
        r.pick_pack_base = parseInt(formData.get(`range_${idx}_pick_pack`), 10) || r.pick_pack_base;
        r.storage_m3 = parseInt(formData.get(`range_${idx}_storage_m3`), 10) || r.storage_m3;
      });

      // Actualizar descuentos
      updatedConfig.storage_discounts.forEach((d, idx) => {
        d.discount_pct = parseInt(formData.get(`discount_${idx}_pct`), 10) || d.discount_pct;
      });

      // Actualizar UF y Costos Fijos
      updatedConfig.uf_value = parseFloat(formData.get('uf_value')) || 38500;
      updatedConfig.fixed_service_fee.exemption_min_orders = parseInt(formData.get('fixed_min_orders'), 10) || 75;
      updatedConfig.fixed_service_fee.exemption_min_volume = parseFloat(formData.get('fixed_min_volume')) || 1.5;
      updatedConfig.fixed_service_fee.tier1_fee_uf = parseFloat(formData.get('fixed_tier1_uf')) || 1.5;
      updatedConfig.fixed_service_fee.tier2_fee_uf = parseFloat(formData.get('fixed_tier2_uf')) || 0.9;

      // Actualizar Pick & Pack
      updatedConfig.pick_pack_rules.protected_ticket_base_rate = parseInt(formData.get('protected_ticket_base_rate'), 10) || 650;
      updatedConfig.pick_pack_rules.surcharge_extra_sku = parseInt(formData.get('surcharge_extra_sku'), 10) || 100;
      updatedConfig.pick_pack_rules.surcharge_extra_unit = parseInt(formData.get('surcharge_extra_unit'), 10) || 50;
      updatedConfig.pick_pack_rules.surcharge_marketplace_collect = parseInt(formData.get('surcharge_marketplace_collect'), 10) || 100;
      updatedConfig.pick_pack_rules.surcharge_catalogue_over_100_sku = parseInt(formData.get('surcharge_catalogue_over_100_sku'), 10) || 100;

      // Actualizar Despachos
      updatedConfig.shipping.same_day_rm = parseInt(formData.get('shipping_same_day_rm'), 10) || 3200;
      updatedConfig.shipping.colina = parseInt(formData.get('shipping_colina'), 10) || 3490;
      updatedConfig.shipping.enviame_integration_fee = parseInt(formData.get('shipping_enviame_fee'), 10) || 35;
      updatedConfig.shipping.pickup_express_base = parseInt(formData.get('shipping_pickup_express'), 10) || 1490;

      // Actualizar Servicios
      updatedConfig.services.pos_monthly_uf = parseFloat(formData.get('service_pos_uf')) || 0.2;
      updatedConfig.services.vitrina_monthly_uf = parseFloat(formData.get('service_vitrina_uf')) || 0.6;

      // Actualizar Presentaciones
      if (!updatedConfig.presentations) updatedConfig.presentations = {};
      const presFulfillmentUrl = formData.get('pres_fulfillment_url');
      const presDespachosUrl = formData.get('pres_despachos_rm_url');
      if (presFulfillmentUrl) updatedConfig.presentations.fulfillment_url = presFulfillmentUrl.trim();
      if (presDespachosUrl) updatedConfig.presentations.despachos_rm_url = presDespachosUrl.trim();

      // Procesar archivo Fulfillment si se seleccionó
      const fileFulfillment = document.getElementById('pricing-admin-fulfillment-file')?.files[0];
      if (fileFulfillment && supabase) {
        try {
          const timestamp = Date.now();
          const path = `presentations/presentacion_fulfillment_360_${timestamp}.pdf`;
          const { error: upErr } = await supabase.storage.from('service_docs').upload(path, fileFulfillment, { upsert: true });
          if (!upErr) {
            const { data: urlData } = supabase.storage.from('service_docs').getPublicUrl(path);
            updatedConfig.presentations.fulfillment_url = urlData.publicUrl;
            updatedConfig.presentations.fulfillment_storage_path = path;
            updatedConfig.presentations.fulfillment_updated_at = new Date().toLocaleDateString('es-CL');
          }
        } catch (e) {
          console.warn('Error subiendo archivo fulfillment desde pricing admin:', e);
        }
      }

      // Procesar archivo Despachos si se seleccionó
      const fileDespachos = document.getElementById('pricing-admin-despachos-file')?.files[0];
      if (fileDespachos && supabase) {
        try {
          const timestamp = Date.now();
          const path = `presentations/presentacion_despachos_rm_${timestamp}.pdf`;
          const { error: upErr } = await supabase.storage.from('service_docs').upload(path, fileDespachos, { upsert: true });
          if (!upErr) {
            const { data: urlData } = supabase.storage.from('service_docs').getPublicUrl(path);
            updatedConfig.presentations.despachos_rm_url = urlData.publicUrl;
            updatedConfig.presentations.despachos_rm_storage_path = path;
            updatedConfig.presentations.despachos_rm_updated_at = new Date().toLocaleDateString('es-CL');
          }
        } catch (e) {
          console.warn('Error subiendo archivo despachos desde pricing admin:', e);
        }
      }

      btnSave.disabled = true;
      btnSave.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> Guardando...`;

      const saveRes = await savePricingConfig(updatedConfig, supabase);
      btnSave.disabled = false;
      btnSave.innerHTML = `<i class="ri-save-3-line"></i> Guardar Tarifas`;

      if (saveRes.success) {
        if (window.Swal) {
          window.Swal.fire({
            icon: 'success',
            title: '¡Tarifas Guardadas!',
            text: 'La configuración de precios ha sido actualizada exitosamente para el cotizador.',
            timer: 2000
          });
        } else {
          alert("Tarifas guardadas exitosamente.");
        }
      } else {
        alert(`Error al guardar tarifas: ${saveRes.error}`);
      }
    });
  }
}
