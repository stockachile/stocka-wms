/**
 * pricing_admin.js - Módulo de Administración de Tarifas y Reglas del Cotizador
 * STOCKA WMS
 */

import supabase from './supabase.js';
import { 
  loadPricingConfig, 
  savePricingConfig, 
  resetPricingConfigToDefaults, 
  getLiveUfValue,
  DEFAULT_PRICING_CONFIG, 
  formatCLP 
} from './pricing_manager.js';

let activeTab = 'ranges'; // 'ranges' | 'storage_rules' | 'pickpack_shipping' | 'leads' | 'presentations'
let currentAdminConfig = null;
let currentAdminLeads = [];

function parseIntSafe(val, fallback) {
  if (val === null || val === undefined || String(val).trim() === '') return fallback;
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

function parseFloatSafe(val, fallback) {
  if (val === null || val === undefined || String(val).trim() === '') return fallback;
  const normalized = String(val).replace(',', '.');
  const n = parseFloat(normalized);
  return isNaN(n) ? fallback : n;
}

function buildOrderRangeLabel(min, max) {
  const minFmt = Number(min || 0).toLocaleString('es-CL');
  if (max >= 999999) {
    return `+${Number(Math.max(0, (min || 1) - 1)).toLocaleString('es-CL')} pedidos`;
  }
  const maxFmt = Number(max || 0).toLocaleString('es-CL');
  return `${minFmt} a ${maxFmt} pedidos`;
}

function buildDiscountRangeLabel(min, max, pct) {
  if (max >= 999999) {
    return `+${Math.floor(min || 60)} m³ (${pct}%)`;
  }
  return `${min} - ${max} m³ (${pct}%)`;
}

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

    currentAdminConfig = JSON.parse(JSON.stringify(config));
    currentAdminLeads = leads;
    renderAdminUI(currentAdminConfig, currentAdminLeads);
  } catch (err) {
    console.error("Error al renderizar módulo de tarifas:", err);
    appContent.innerHTML = `
      <div class="alert alert-danger" style="margin: 2rem;">
        <i class="ri-error-warning-line"></i> Error al cargar la configuración de tarifas: ${err.message}
      </div>
    `;
  }
}

/**
 * Sincroniza los valores actuales de los inputs del formulario hacia currentAdminConfig
 * antes de agregar/eliminar filas dinámicas para no perder ediciones en curso.
 */
function syncFormIntoConfigState(config) {
  const form = document.getElementById('admin-pricing-form');
  if (!form || !config) return config;

  const formData = new FormData(form);

  // 1. Rangos de pedidos
  if (Array.isArray(config.order_ranges)) {
    config.order_ranges.forEach((r, idx) => {
      const newMin = parseIntSafe(formData.get(`range_${idx}_min`), r.min);
      const newMax = parseIntSafe(formData.get(`range_${idx}_max`), r.max);
      const rawLabel = formData.get(`range_${idx}_label`);
      const autoPrevLabel = buildOrderRangeLabel(r.min, r.max);

      r.id = idx + 1;
      r.min = newMin;
      r.max = newMax;
      if (rawLabel !== null && rawLabel.trim() !== '') {
        // Si el usuario no cambió manualmente el label pero sí cambió min/max, actualizar etiqueta automáticamente
        if (rawLabel.trim() === r.label && r.label === autoPrevLabel) {
          r.label = buildOrderRangeLabel(newMin, newMax);
        } else {
          r.label = rawLabel.trim();
        }
      } else {
        r.label = buildOrderRangeLabel(newMin, newMax);
      }
      r.pick_pack_base = parseIntSafe(formData.get(`range_${idx}_pick_pack`), r.pick_pack_base);
      r.storage_m3 = parseIntSafe(formData.get(`range_${idx}_storage_m3`), r.storage_m3);
    });
  }

  // 2. Descuentos por volumen de almacenamiento
  if (Array.isArray(config.storage_discounts)) {
    config.storage_discounts.forEach((d, idx) => {
      const minVal = parseFloatSafe(formData.get(`discount_${idx}_min`), d.min);
      const isUnlimited = form.querySelector(`input[name="discount_${idx}_unlimited"]`)?.checked;
      const maxInputVal = parseFloatSafe(formData.get(`discount_${idx}_max`), d.max);
      const maxVal = isUnlimited ? 999999 : maxInputVal;
      const pctVal = parseFloatSafe(formData.get(`discount_${idx}_pct`), d.discount_pct);

      d.min = minVal;
      d.max = maxVal;
      d.discount_pct = pctVal;
      d.label = buildDiscountRangeLabel(minVal, maxVal, pctVal);
    });
  }

  // 3. UF y Reglas de Costo Fijo
  const ufInputVal = parseFloatSafe(formData.get('uf_value'), config.uf_value || 40867);
  if (ufInputVal !== config.uf_value) {
    config.uf_is_manual = true;
  }
  config.uf_value = ufInputVal;

  if (!config.fixed_service_fee) config.fixed_service_fee = {};
  config.fixed_service_fee.exemption_min_orders = parseIntSafe(formData.get('fixed_min_orders'), config.fixed_service_fee.exemption_min_orders ?? 75);
  config.fixed_service_fee.exemption_min_volume = parseFloatSafe(formData.get('fixed_min_volume'), config.fixed_service_fee.exemption_min_volume ?? 1.5);
  config.fixed_service_fee.tier1_max_orders = parseIntSafe(formData.get('fixed_tier1_max_orders'), config.fixed_service_fee.tier1_max_orders ?? 50);
  config.fixed_service_fee.tier1_max_volume = parseFloatSafe(formData.get('fixed_tier1_max_volume'), config.fixed_service_fee.tier1_max_volume ?? 1.0);
  config.fixed_service_fee.tier1_fee_uf = parseFloatSafe(formData.get('fixed_tier1_uf'), config.fixed_service_fee.tier1_fee_uf ?? 1.5);
  config.fixed_service_fee.tier2_max_orders = parseIntSafe(formData.get('fixed_tier2_max_orders'), config.fixed_service_fee.tier2_max_orders ?? 75);
  config.fixed_service_fee.tier2_max_volume = parseFloatSafe(formData.get('fixed_tier2_max_volume'), config.fixed_service_fee.tier2_max_volume ?? 1.5);
  config.fixed_service_fee.tier2_fee_uf = parseFloatSafe(formData.get('fixed_tier2_uf'), config.fixed_service_fee.tier2_fee_uf ?? 0.9);

  // 4. Reglas y Recargos de Pick & Pack
  if (!config.pick_pack_rules) config.pick_pack_rules = {};
  config.pick_pack_rules.protected_ticket_threshold = parseIntSafe(formData.get('protected_ticket_threshold'), config.pick_pack_rules.protected_ticket_threshold ?? 10000);
  config.pick_pack_rules.protected_ticket_base_rate = parseIntSafe(formData.get('protected_ticket_base_rate'), config.pick_pack_rules.protected_ticket_base_rate ?? 650);
  config.pick_pack_rules.base_included_sku = parseIntSafe(formData.get('base_included_sku'), config.pick_pack_rules.base_included_sku ?? 3);
  config.pick_pack_rules.surcharge_extra_sku = parseIntSafe(formData.get('surcharge_extra_sku'), config.pick_pack_rules.surcharge_extra_sku ?? 100);
  config.pick_pack_rules.base_included_units = parseIntSafe(formData.get('base_included_units'), config.pick_pack_rules.base_included_units ?? 10);
  config.pick_pack_rules.surcharge_extra_unit = parseIntSafe(formData.get('surcharge_extra_unit'), config.pick_pack_rules.surcharge_extra_unit ?? 50);
  config.pick_pack_rules.surcharge_marketplace_collect = parseIntSafe(formData.get('surcharge_marketplace_collect'), config.pick_pack_rules.surcharge_marketplace_collect ?? 100);
  config.pick_pack_rules.catalogue_sku_threshold = parseIntSafe(formData.get('catalogue_sku_threshold'), config.pick_pack_rules.catalogue_sku_threshold ?? 100);
  config.pick_pack_rules.catalogue_exempt_max_units = parseIntSafe(formData.get('catalogue_exempt_max_units'), config.pick_pack_rules.catalogue_exempt_max_units ?? 2);
  config.pick_pack_rules.surcharge_catalogue_over_100_sku = parseIntSafe(formData.get('surcharge_catalogue_over_100_sku'), config.pick_pack_rules.surcharge_catalogue_over_100_sku ?? 100);
  config.pick_pack_rules.surcharge_ml_full_labeling = parseIntSafe(formData.get('surcharge_ml_full_labeling'), config.pick_pack_rules.surcharge_ml_full_labeling ?? 100);

  // 5. Despachos
  if (!config.shipping) config.shipping = {};
  config.shipping.same_day_rm = parseIntSafe(formData.get('shipping_same_day_rm'), config.shipping.same_day_rm ?? 3200);
  config.shipping.colina = parseIntSafe(formData.get('shipping_colina'), config.shipping.colina ?? 3490);
  config.shipping.enviame_integration_fee = parseIntSafe(formData.get('shipping_enviame_fee'), config.shipping.enviame_integration_fee ?? 35);
  config.shipping.pickup_express_base = parseIntSafe(formData.get('shipping_pickup_express'), config.shipping.pickup_express_base ?? 1490);

  // 6. Tarifas Promedio a Regiones por Rango de Peso
  if (!config.regional_shipping) config.regional_shipping = {};
  if (!Array.isArray(config.regional_shipping.weight_brackets)) {
    config.regional_shipping.weight_brackets = JSON.parse(JSON.stringify(DEFAULT_PRICING_CONFIG.regional_shipping.weight_brackets));
  }
  config.regional_shipping.weight_brackets.forEach((wb, idx) => {
    const lbl = formData.get(`regional_wb_${idx}_label`);
    if (lbl && lbl.trim()) wb.label = lbl.trim();
    wb.avg_rate = parseIntSafe(formData.get(`regional_wb_${idx}_rate`), wb.avg_rate);
    const courier = formData.get(`regional_wb_${idx}_courier`);
    if (courier && courier.trim()) wb.cheapest_courier = courier.trim();
  });

  // 7. Insumos, Cajas por Tamaño y Plástico Burbuja (Costo Lineal por cm)
  if (!config.supplies) config.supplies = {};
  if (!config.supplies.bubble_wrap_roll) {
    config.supplies.bubble_wrap_roll = {
      roll_cost: 36000,
      roll_width_cm: 100,
      roll_length_m: 100,
      cost_per_linear_cm: 3.6,
      cost_per_linear_m: 360,
      cost_per_sqm: 360
    };
  }
  const rollCost = Math.max(0, parseFloatSafe(formData.get('bubble_roll_cost'), config.supplies.bubble_wrap_roll.roll_cost ?? 36000));
  const rollWidthCm = Math.max(1, parseFloatSafe(formData.get('bubble_roll_width_cm'), config.supplies.bubble_wrap_roll.roll_width_cm ?? 100));
  const rollLengthM = Math.max(0.1, parseFloatSafe(formData.get('bubble_roll_length_m'), config.supplies.bubble_wrap_roll.roll_length_m ?? 100));
  const totalLinearCm = rollLengthM * 100;
  const costPerLinearCm = Number((rollCost / totalLinearCm).toFixed(4));
  const costPerLinearM = Number((costPerLinearCm * 100).toFixed(2));
  const totalSqm = rollLengthM * (rollWidthCm / 100);
  const costPerSqm = totalSqm > 0 ? Math.round(rollCost / totalSqm) : 360;

  config.supplies.bubble_wrap_roll = {
    roll_cost: rollCost,
    roll_width_cm: rollWidthCm,
    roll_length_m: rollLengthM,
    cost_per_linear_cm: costPerLinearCm,
    cost_per_linear_m: costPerLinearM,
    cost_per_sqm: costPerSqm
  };
  config.supplies.bubble_wrap_linear_cm = costPerLinearCm;
  config.supplies.bubble_wrap_sqm = costPerSqm;

  // Catálogo dinámico de cajas por tamaño y unidad
  if (!Array.isArray(config.supplies.boxes)) {
    config.supplies.boxes = JSON.parse(JSON.stringify(DEFAULT_PRICING_CONFIG.supplies.boxes));
  }
  config.supplies.boxes.forEach((bx, idx) => {
    const rawName = formData.get(`box_${idx}_name`);
    if (rawName !== null && rawName.trim()) bx.name = rawName.trim();
    bx.length_cm = Math.max(1, parseFloatSafe(formData.get(`box_${idx}_length`), bx.length_cm || 20));
    bx.width_cm = Math.max(1, parseFloatSafe(formData.get(`box_${idx}_width`), bx.width_cm || 20));
    bx.height_cm = Math.max(1, parseFloatSafe(formData.get(`box_${idx}_height`), bx.height_cm || 20));
    bx.unit_price = Math.max(0, parseIntSafe(formData.get(`box_${idx}_price`), bx.unit_price || 0));
  });

  // Mantener sincronizados campos legacy de cajas
  const foundXs = config.supplies.boxes.find(b => b.id === 'box_xs');
  const foundS = config.supplies.boxes.find(b => b.id === 'box_s') || config.supplies.boxes[0];
  const foundM = config.supplies.boxes.find(b => b.id === 'box_m');
  if (foundXs) config.supplies.box_xs = foundXs.unit_price;
  if (foundS) config.supplies.box_s = foundS.unit_price;
  if (foundM) config.supplies.box_m = foundM.unit_price;

  if (!config.services) config.services = {};
  config.services.pos_monthly_uf = parseFloatSafe(formData.get('service_pos_uf'), config.services.pos_monthly_uf ?? 0.2);
  config.services.vitrina_monthly_uf = parseFloatSafe(formData.get('service_vitrina_uf'), config.services.vitrina_monthly_uf ?? 0.6);
  config.services.unloading_service_uf_per_m3 = parseFloatSafe(formData.get('service_unloading_uf_m3'), config.services.unloading_service_uf_per_m3 ?? 0.1);
  config.services.unloading_service_cap_uf = parseFloatSafe(formData.get('service_unloading_cap_uf'), config.services.unloading_service_cap_uf ?? 2.0);

  // 8. Presentaciones
  if (!config.presentations) config.presentations = {};
  const presFulfillmentUrl = formData.get('pres_fulfillment_url');
  const presDespachosUrl = formData.get('pres_despachos_rm_url');
  const presCourierFolderUrl = formData.get('pres_courier_folder_url');
  const presCotizadorUrl = formData.get('pres_cotizador_url');
  if (presFulfillmentUrl !== null && presFulfillmentUrl.trim()) config.presentations.fulfillment_url = presFulfillmentUrl.trim();
  if (presDespachosUrl !== null && presDespachosUrl.trim()) config.presentations.despachos_rm_url = presDespachosUrl.trim();
  if (presCourierFolderUrl !== null && presCourierFolderUrl.trim()) config.presentations.courier_folder_url = presCourierFolderUrl.trim();
  if (presCotizadorUrl !== null && presCotizadorUrl.trim()) config.presentations.cotizador_url = presCotizadorUrl.trim();

  return config;
}

function renderAdminUI(config, leads) {
  const appContent = document.getElementById('app-content');
  if (!appContent) return;

  const firstDiscountMin = config.storage_discounts?.[0]?.min ?? 10;

  appContent.innerHTML = `
    <div class="pricing-admin-wrapper" style="max-width: 1320px; margin: 0 auto; padding-bottom: 3rem;">
      
      <!-- Top Action Header -->
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem; background: var(--color-surface); padding: 1.25rem 1.5rem; border-radius: var(--radius-lg); border: 1px solid var(--color-border);">
        <div>
          <h2 style="font-size: 1.35rem; font-weight: 800; color: var(--color-text-main); margin: 0; display: flex; align-items: center; gap: 0.5rem;">
            <i class="ri-price-tag-3-line" style="color: var(--color-accent);"></i> Configuración de Tarifario & Cotizador 360
          </h2>
          <p style="font-size: 0.85rem; color: var(--color-text-muted); margin: 0.25rem 0 0 0;">
            Versión activa: <strong>${config.version || '1.2'}</strong> | Última actualización: <strong>${config.updated_at ? new Date(config.updated_at).toLocaleDateString('es-CL') : 'Oficial'}</strong>
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
      <div style="display: flex; gap: 0.45rem; margin-bottom: 1.5rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.65rem; flex-wrap: wrap;">
        <button type="button" class="btn-tab-admin ${activeTab === 'ranges' ? 'active' : ''}" data-tab="ranges">
          <i class="ri-bar-chart-grouped-line"></i> 1. Rangos de Pedidos y Almacenamiento
        </button>
        <button type="button" class="btn-tab-admin ${activeTab === 'storage_rules' ? 'active' : ''}" data-tab="storage_rules">
          <i class="ri-archive-line"></i> 2. Descuentos por Volumen & Costos Fijos
        </button>
        <button type="button" class="btn-tab-admin ${activeTab === 'pickpack_shipping' ? 'active' : ''}" data-tab="pickpack_shipping">
          <i class="ri-truck-line"></i> 3. Pick & Pack, Recargos y Despachos
        </button>
        <button type="button" class="btn-tab-admin ${activeTab === 'materials' ? 'active' : ''}" data-tab="materials">
          <i class="ri-box-1-line"></i> 4. Materiales y Embalaje (Cajas / Burbuja)
        </button>
        <button type="button" class="btn-tab-admin ${activeTab === 'leads' ? 'active' : ''}" data-tab="leads">
          <i class="ri-user-star-line"></i> 5. Leads de Cotizaciones (${leads.length})
        </button>
        <button type="button" class="btn-tab-admin ${activeTab === 'presentations' ? 'active' : ''}" data-tab="presentations">
          <i class="ri-slideshow-3-line"></i> 6. Presentaciones del Servicio
        </button>
      </div>

      <!-- Form Container -->
      <form id="admin-pricing-form">
        
        <!-- PESTAÑA 1: RANGOS DE PEDIDOS -->
        <div id="tab-content-ranges" class="admin-pricing-tab-content" style="display: ${activeTab === 'ranges' ? 'block' : 'none'};">
          <div class="card" style="padding: 1.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg);">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1.25rem;">
              <div>
                <h3 style="font-size: 1.05rem; font-weight: 700; color: var(--color-text-main); margin: 0 0 0.25rem 0;">
                  Tabla de Pedidos Procesados (Rangos 1 al ${config.order_ranges.length})
                </h3>
                <p style="font-size: 0.8rem; color: var(--color-text-muted); margin: 0;">
                  Edita los rangos de pedidos mensuales (mínimo y máximo), el nombre del tramo, la tarifa base de preparación (Pick & Pack) y el costo por m³ de almacenamiento.
                </p>
              </div>
              <button type="button" id="btn-add-order-range" class="btn btn-outline" style="font-size: 0.8rem; border-color: var(--color-accent); color: var(--color-accent); font-weight: 700; display: inline-flex; align-items: center; gap: 0.35rem;">
                <i class="ri-add-line"></i> Agregar Rango
              </button>
            </div>

            <div class="table-responsive">
              <table class="data-table" style="width: 100%; font-size: 0.85rem;">
                <thead>
                  <tr>
                    <th style="width: 6%; text-align: center;">Rango</th>
                    <th style="width: 24%;">Etiqueta del Tramo</th>
                    <th style="width: 24%;">Rango de Pedidos / Mes (Mín - Máx)</th>
                    <th style="width: 20%;">Pick & Pack Base ($ + IVA / pedido)</th>
                    <th style="width: 20%;">Almacenamiento ($ + IVA / m³)</th>
                    <th style="width: 6%; text-align: center;">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  ${config.order_ranges.map((r, idx) => `
                    <tr>
                      <td style="font-weight: 800; text-align: center; color: var(--color-accent); font-size: 0.95rem;">#${idx + 1}</td>
                      <td>
                        <input type="text" class="form-input admin-editable-input" name="range_${idx}_label" data-range-label="${idx}" value="${r.label || buildOrderRangeLabel(r.min, r.max)}" placeholder="Ej: 0 a 25 pedidos" style="font-weight: 600; font-size: 0.82rem; padding: 0.45rem 0.65rem;">
                      </td>
                      <td>
                        <div style="display: flex; align-items: center; gap: 0.4rem;">
                          <div style="flex: 1;">
                            <small style="display: block; font-size: 0.68rem; color: var(--color-text-muted); margin-bottom: 2px;">Mínimo</small>
                            <input type="number" class="form-input admin-editable-input" name="range_${idx}_min" data-range-min="${idx}" value="${r.min}" min="0" style="padding: 0.4rem 0.5rem; font-size: 0.84rem; font-weight: 700; text-align: center;">
                          </div>
                          <span style="color: var(--color-text-muted); font-weight: 700; margin-top: 14px;">a</span>
                          <div style="flex: 1;">
                            <small style="display: block; font-size: 0.68rem; color: var(--color-text-muted); margin-bottom: 2px;">Máximo ${r.max >= 999999 ? '(Sin tope)' : ''}</small>
                            <input type="number" class="form-input admin-editable-input" name="range_${idx}_max" data-range-max="${idx}" value="${r.max}" min="0" style="padding: 0.4rem 0.5rem; font-size: 0.84rem; font-weight: 700; text-align: center;">
                          </div>
                        </div>
                      </td>
                      <td>
                        <div style="display: flex; align-items: center; gap: 0.35rem;">
                          <span style="font-weight: 700; color: var(--color-text-muted);">$</span>
                          <input type="number" class="form-input admin-editable-input" name="range_${idx}_pick_pack" value="${r.pick_pack_base}" min="0" required style="font-weight: 700; padding: 0.45rem 0.65rem;">
                        </div>
                      </td>
                      <td>
                        <div style="display: flex; align-items: center; gap: 0.35rem;">
                          <span style="font-weight: 700; color: var(--color-text-muted);">$</span>
                          <input type="number" class="form-input admin-editable-input" name="range_${idx}_storage_m3" value="${r.storage_m3}" min="0" required style="font-weight: 700; padding: 0.45rem 0.65rem;">
                        </div>
                      </td>
                      <td style="text-align: center;">
                        ${config.order_ranges.length > 1 ? `
                          <button type="button" class="btn-remove-order-range" data-idx="${idx}" title="Eliminar este rango" style="background: rgba(239,68,68,0.1); color: #ef4444; border: 1px solid rgba(239,68,68,0.25); border-radius: 6px; width: 32px; height: 32px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;">
                            <i class="ri-delete-bin-line"></i>
                          </button>
                        ` : '—'}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
            <p style="margin: 0.85rem 0 0 0; font-size: 0.75rem; color: var(--color-text-muted);">
              <i class="ri-information-line"></i> Tip: Para el último tramo sin límite superior (ej. <em>+2.500 pedidos</em>), puedes usar <strong>999999</strong> como valor Máximo.
            </p>
          </div>
        </div>

        <!-- PESTAÑA 2: DESCUENTOS Y COSTOS FIJOS -->
        <div id="tab-content-storage_rules" class="admin-pricing-tab-content" style="display: ${activeTab === 'storage_rules' ? 'block' : 'none'};">
          <div class="admin-two-col-grid">
            
            <!-- Descuentos por Volumen de Almacenamiento -->
            <div class="card" style="padding: 1.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg);">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.5rem; flex-wrap: wrap;">
                <div>
                  <h3 style="font-size: 1.05rem; font-weight: 700; color: var(--color-text-main); margin: 0 0 0.25rem 0;">
                    <i class="ri-percent-line" style="color: var(--color-success);"></i> Descuentos por Volumen (&gt; ${firstDiscountMin} m³)
                  </h3>
                  <p style="font-size: 0.8rem; color: var(--color-text-muted); margin: 0;">Edita tanto los rangos de metros cúbicos (Mín. y Máx. m³) como el porcentaje de descuento automático.</p>
                </div>
                <button type="button" id="btn-add-storage-discount" class="btn btn-outline" style="font-size: 0.76rem; padding: 0.35rem 0.65rem; border-color: var(--color-accent); color: var(--color-accent); font-weight: 700; display: inline-flex; align-items: center; gap: 0.25rem;">
                  <i class="ri-add-line"></i> Agregar Tramo
                </button>
              </div>

              <div style="display: flex; flex-direction: column; gap: 0.65rem; margin-top: 1rem;">
                <!-- Encabezado de columnas -->
                <div style="display: grid; grid-template-columns: 1fr 1fr 110px 95px 34px; gap: 0.5rem; padding: 0 0.5rem; font-size: 0.72rem; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase;">
                  <span>Desde (m³)</span>
                  <span>Hasta (m³)</span>
                  <span style="text-align: center;">Sin Tope (+)</span>
                  <span style="text-align: right;">Descuento</span>
                  <span></span>
                </div>

                ${config.storage_discounts.map((d, idx) => {
                  const isUnlimited = d.max >= 999999;
                  return `
                    <div style="display: grid; grid-template-columns: 1fr 1fr 110px 95px 34px; gap: 0.5rem; align-items: center; background: var(--color-bg); padding: 0.65rem 0.75rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
                      <div style="display: flex; align-items: center; gap: 0.3rem;">
                        <input type="number" step="0.01" min="0" class="form-input admin-editable-input" name="discount_${idx}_min" value="${d.min}" style="padding: 0.4rem 0.5rem; font-size: 0.85rem; font-weight: 700; text-align: center;">
                        <span style="font-size: 0.75rem; color: var(--color-text-muted); font-weight: 600;">m³</span>
                      </div>

                      <div style="display: flex; align-items: center; gap: 0.3rem;">
                        <input type="number" step="0.01" min="0" class="form-input admin-editable-input" id="discount_${idx}_max_input" name="discount_${idx}_max" value="${isUnlimited ? 999999 : d.max}" ${isUnlimited ? 'readonly' : ''} style="padding: 0.4rem 0.5rem; font-size: 0.85rem; font-weight: 700; text-align: center; ${isUnlimited ? 'opacity: 0.55;' : ''}">
                        <span style="font-size: 0.75rem; color: var(--color-text-muted); font-weight: 600;">m³</span>
                      </div>

                      <label style="display: flex; align-items: center; justify-content: center; gap: 0.3rem; font-size: 0.75rem; font-weight: 600; color: var(--color-text-muted); cursor: pointer; user-select: none; margin: 0;">
                        <input type="checkbox" class="chk-discount-unlimited" data-idx="${idx}" name="discount_${idx}_unlimited" ${isUnlimited ? 'checked' : ''} style="accent-color: var(--color-accent); width: 15px; height: 15px; cursor: pointer;">
                        <span>+ Sin límite</span>
                      </label>

                      <div style="display: flex; align-items: center; justify-content: flex-end; gap: 0.25rem;">
                        <input type="number" step="0.1" class="form-input admin-editable-input" name="discount_${idx}_pct" value="${d.discount_pct}" min="0" max="100" style="width: 68px; padding: 0.4rem 0.45rem; text-align: right; font-weight: 800; font-size: 0.88rem; color: var(--color-accent);">
                        <span style="font-weight: 700; font-size: 0.85rem;">%</span>
                      </div>

                      <div style="text-align: center;">
                        ${config.storage_discounts.length > 1 ? `
                          <button type="button" class="btn-remove-storage-discount" data-idx="${idx}" title="Eliminar tramo de descuento" style="background: rgba(239,68,68,0.1); color: #ef4444; border: 1px solid rgba(239,68,68,0.25); border-radius: 6px; width: 30px; height: 30px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;">
                            <i class="ri-delete-bin-line"></i>
                          </button>
                        ` : ''}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>

            <!-- Costos Fijos y Valor UF -->
            <div class="card" style="padding: 1.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg);">
              <h3 style="font-size: 1.05rem; font-weight: 700; color: var(--color-text-main); margin: 0 0 0.25rem 0;">
                <i class="ri-shield-line" style="color: var(--color-accent);"></i> Reglas de Costo Fijo & UF
              </h3>
              <p style="font-size: 0.8rem; color: var(--color-text-muted); margin: 0 0 1rem 0;">Configura el valor UF, los umbrales de exención ($0) y los rangos y tarifas en UF de los Tramos 1 y 2.</p>

              <!-- Valor UF -->
              <div class="form-group" style="margin-bottom: 1rem;">
                <label class="form-label" style="font-size: 0.82rem; font-weight: 700;">Valor UF de Referencia (CLP)</label>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <div style="display: flex; align-items: center; gap: 0.35rem; flex: 1;">
                    <span style="font-weight: 700; color: var(--color-text-muted);">$</span>
                    <input type="number" step="1" class="form-input admin-editable-input" id="input-admin-uf" name="uf_value" value="${config.uf_value || 40867}" required style="font-weight: 800; font-size: 0.95rem;">
                  </div>
                  <button type="button" id="btn-sync-live-uf" class="btn btn-outline btn-sm" style="white-space: nowrap; font-size: 0.78rem; padding: 0.55rem 0.85rem; border-color: var(--color-accent); color: var(--color-accent); font-weight: 700;">
                    <i class="ri-refresh-line"></i> Sincronizar UF en Vivo
                  </button>
                </div>
              </div>

              <!-- Exención Costo Fijo ($0) -->
              <div style="background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.9rem 1rem; margin-bottom: 0.85rem;">
                <div style="font-size: 0.78rem; font-weight: 800; color: var(--color-success); text-transform: uppercase; margin-bottom: 0.6rem; display: flex; align-items: center; gap: 0.35rem;">
                  <i class="ri-checkbox-circle-line"></i> Regla de Exención ($0 Costo Fijo)
                </div>
                <div class="admin-grid-2">
                  <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label" style="font-size: 0.78rem; font-weight: 600;">Mín. Pedidos Exención ($0)</label>
                    <div style="display: flex; align-items: center; gap: 0.35rem;">
                      <input type="number" min="0" class="form-input admin-editable-input" name="fixed_min_orders" value="${config.fixed_service_fee.exemption_min_orders ?? 75}" style="font-weight: 700;">
                      <span style="font-size: 0.75rem; color: var(--color-text-muted); font-weight: 600; white-space: nowrap;">ped.</span>
                    </div>
                    <small style="font-size: 0.7rem; color: var(--color-text-muted);">Si pedidos &ge; este valor &rarr; $0</small>
                  </div>
                  <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label" style="font-size: 0.78rem; font-weight: 600;">Mín. m³ Exención ($0)</label>
                    <div style="display: flex; align-items: center; gap: 0.35rem;">
                      <input type="number" step="0.1" min="0" class="form-input admin-editable-input" name="fixed_min_volume" value="${config.fixed_service_fee.exemption_min_volume ?? 1.5}" style="font-weight: 700;">
                      <span style="font-size: 0.75rem; color: var(--color-text-muted); font-weight: 600;">m³</span>
                    </div>
                    <small style="font-size: 0.7rem; color: var(--color-text-muted);">Si m³ &ge; este valor &rarr; $0</small>
                  </div>
                </div>
              </div>

              <!-- Tramo 1 Costo Fijo -->
              <div style="background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.9rem 1rem; margin-bottom: 0.85rem;">
                <div style="font-size: 0.78rem; font-weight: 800; color: var(--color-accent); text-transform: uppercase; margin-bottom: 0.6rem; display: flex; align-items: center; justify-content: space-between;">
                  <span><i class="ri-Numbers-line"></i> Tramo 1 (Bajo Volumen y Pedidos)</span>
                  <span style="font-size: 0.7rem; color: var(--color-text-muted); font-weight: 600; text-transform: none;">Aplica si cumple ambas condiciones (&lt; ped. Y &lt; m³)</span>
                </div>
                <div class="admin-grid-3">
                  <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label" style="font-size: 0.75rem; font-weight: 600;">Menos de (Pedidos)</label>
                    <div style="display: flex; align-items: center; gap: 0.3rem;">
                      <span style="font-weight: 700; color: var(--color-text-muted);">&lt;</span>
                      <input type="number" min="0" class="form-input admin-editable-input" name="fixed_tier1_max_orders" value="${config.fixed_service_fee.tier1_max_orders ?? 50}" style="font-weight: 700;">
                      <span style="font-size: 0.75rem; color: var(--color-text-muted);">ped.</span>
                    </div>
                  </div>
                  <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label" style="font-size: 0.75rem; font-weight: 600;">Y menos de (Volumen)</label>
                    <div style="display: flex; align-items: center; gap: 0.3rem;">
                      <span style="font-weight: 700; color: var(--color-text-muted);">&lt;</span>
                      <input type="number" step="0.1" min="0" class="form-input admin-editable-input" name="fixed_tier1_max_volume" value="${config.fixed_service_fee.tier1_max_volume ?? 1.0}" style="font-weight: 700;">
                      <span style="font-size: 0.75rem; color: var(--color-text-muted);">m³</span>
                    </div>
                  </div>
                  <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label" style="font-size: 0.75rem; font-weight: 700; color: var(--color-accent);">Tarifa Tramo 1</label>
                    <div style="display: flex; align-items: center; gap: 0.3rem;">
                      <input type="number" step="0.1" min="0" class="form-input admin-editable-input" name="fixed_tier1_uf" value="${config.fixed_service_fee.tier1_fee_uf ?? 1.5}" style="font-weight: 800; color: var(--color-accent);">
                      <span style="font-weight: 800; font-size: 0.82rem;">UF</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Tramo 2 Costo Fijo -->
              <div style="background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.9rem 1rem;">
                <div style="font-size: 0.78rem; font-weight: 800; color: var(--color-primary); text-transform: uppercase; margin-bottom: 0.6rem; display: flex; align-items: center; justify-content: space-between;">
                  <span><i class="ri-Numbers-line"></i> Tramo 2 (Intermedio hacia Exención)</span>
                  <span style="font-size: 0.7rem; color: var(--color-text-muted); font-weight: 600; text-transform: none;">Aplica si no alcanza la exención (&lt; ped. y &lt; m³)</span>
                </div>
                <div class="admin-grid-3">
                  <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label" style="font-size: 0.75rem; font-weight: 600;">Menos de (Pedidos)</label>
                    <div style="display: flex; align-items: center; gap: 0.3rem;">
                      <span style="font-weight: 700; color: var(--color-text-muted);">&lt;</span>
                      <input type="number" min="0" class="form-input admin-editable-input" name="fixed_tier2_max_orders" value="${config.fixed_service_fee.tier2_max_orders ?? config.fixed_service_fee.exemption_min_orders ?? 75}" style="font-weight: 700;">
                      <span style="font-size: 0.75rem; color: var(--color-text-muted);">ped.</span>
                    </div>
                  </div>
                  <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label" style="font-size: 0.75rem; font-weight: 600;">O menos de (Volumen)</label>
                    <div style="display: flex; align-items: center; gap: 0.3rem;">
                      <span style="font-weight: 700; color: var(--color-text-muted);">&lt;</span>
                      <input type="number" step="0.1" min="0" class="form-input admin-editable-input" name="fixed_tier2_max_volume" value="${config.fixed_service_fee.tier2_max_volume ?? config.fixed_service_fee.exemption_min_volume ?? 1.5}" style="font-weight: 700;">
                      <span style="font-size: 0.75rem; color: var(--color-text-muted);">m³</span>
                    </div>
                  </div>
                  <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label" style="font-size: 0.75rem; font-weight: 700; color: var(--color-primary);">Tarifa Tramo 2</label>
                    <div style="display: flex; align-items: center; gap: 0.3rem;">
                      <input type="number" step="0.1" min="0" class="form-input admin-editable-input" name="fixed_tier2_uf" value="${config.fixed_service_fee.tier2_fee_uf ?? 0.9}" style="font-weight: 800; color: var(--color-primary);">
                      <span style="font-weight: 800; font-size: 0.82rem;">UF</span>
                    </div>
                  </div>
                </div>
              </div>

            </div>

          </div>
        </div>

        <!-- PESTAÑA 3: RECARGOS, DESPACHOS Y EXTRAS -->
        <div id="tab-content-pickpack_shipping" class="admin-pricing-tab-content" style="display: ${activeTab === 'pickpack_shipping' ? 'block' : 'none'};">
          <div class="admin-two-col-grid">
            
            <!-- Recargos Pick & Pack -->
            <div class="card" style="padding: 1.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg);">
              <h3 style="font-size: 1.05rem; font-weight: 700; color: var(--color-text-main); margin: 0 0 0.35rem 0;">
                <i class="ri-box-3-line" style="color: var(--color-accent);"></i> Condiciones, Rangos y Recargos de Preparación
              </h3>
              <p style="font-size: 0.8rem; color: var(--color-text-muted); margin: 0 0 1rem 0;">Edita tanto los límites incluidos en la tarifa base como los montos de recargo.</p>
              
              <!-- Venta Protegida -->
              <div style="background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.85rem 1rem; margin-bottom: 0.85rem;">
                <div style="font-size: 0.78rem; font-weight: 800; color: var(--color-accent); text-transform: uppercase; margin-bottom: 0.5rem;">
                  Venta Protegida (Ticket Bajo)
                </div>
                <div class="admin-grid-2">
                  <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label" style="font-size: 0.76rem;">Tope Ticket Venta (&lt; $ CLP)</label>
                    <div style="display: flex; align-items: center; gap: 0.35rem;">
                      <span>$</span>
                      <input type="number" class="form-input admin-editable-input" name="protected_ticket_threshold" value="${config.pick_pack_rules.protected_ticket_threshold ?? 10000}" style="font-weight: 700;">
                    </div>
                  </div>
                  <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label" style="font-size: 0.76rem;">Tarifa Base Venta Protegida ($)</label>
                    <div style="display: flex; align-items: center; gap: 0.35rem;">
                      <span>$</span>
                      <input type="number" class="form-input admin-editable-input" name="protected_ticket_base_rate" value="${config.pick_pack_rules.protected_ticket_base_rate ?? 650}" style="font-weight: 700;">
                    </div>
                  </div>
                </div>
              </div>

              <!-- Límites y Recargos de SKU y Unidades -->
              <div style="background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.85rem 1rem; margin-bottom: 0.85rem;">
                <div style="font-size: 0.78rem; font-weight: 800; color: var(--color-text-main); text-transform: uppercase; margin-bottom: 0.5rem;">
                  Rangos Incluidos y Recargos por SKU / Unidades
                </div>
                <div class="admin-grid-2" style="margin-bottom: 0.65rem;">
                  <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label" style="font-size: 0.76rem;">SKU Incluidos en Base (Hasta)</label>
                    <div style="display: flex; align-items: center; gap: 0.35rem;">
                      <input type="number" min="1" class="form-input admin-editable-input" name="base_included_sku" value="${config.pick_pack_rules.base_included_sku ?? 3}" style="font-weight: 700;">
                      <span style="font-size: 0.75rem; color: var(--color-text-muted);">SKU</span>
                    </div>
                  </div>
                  <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label" style="font-size: 0.76rem;">Recargo por SKU Extra ($)</label>
                    <div style="display: flex; align-items: center; gap: 0.35rem;">
                      <span>$</span>
                      <input type="number" min="0" class="form-input admin-editable-input" name="surcharge_extra_sku" value="${config.pick_pack_rules.surcharge_extra_sku ?? 100}" style="font-weight: 700;">
                    </div>
                  </div>
                </div>

                <div class="admin-grid-2">
                  <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label" style="font-size: 0.76rem;">Unidades Incluidas en Base (Hasta)</label>
                    <div style="display: flex; align-items: center; gap: 0.35rem;">
                      <input type="number" min="1" class="form-input admin-editable-input" name="base_included_units" value="${config.pick_pack_rules.base_included_units ?? 10}" style="font-weight: 700;">
                      <span style="font-size: 0.75rem; color: var(--color-text-muted);">unid.</span>
                    </div>
                  </div>
                  <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label" style="font-size: 0.76rem;">Recargo por Unidad Extra ($)</label>
                    <div style="display: flex; align-items: center; gap: 0.35rem;">
                      <span>$</span>
                      <input type="number" min="0" class="form-input admin-editable-input" name="surcharge_extra_unit" value="${config.pick_pack_rules.surcharge_extra_unit ?? 50}" style="font-weight: 700;">
                    </div>
                  </div>
                </div>
              </div>

              <!-- Catálogo Amplio, Colecta y Etiquetado -->
              <div style="background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.85rem 1rem;">
                <div style="font-size: 0.78rem; font-weight: 800; color: var(--color-text-main); text-transform: uppercase; margin-bottom: 0.5rem;">
                  Catálogo Amplio, Colecta Marketplace y FULL
                </div>
                <div class="admin-grid-3" style="margin-bottom: 0.65rem;">
                  <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label" style="font-size: 0.74rem;">Umbral Catálogo (&gt; SKU)</label>
                    <input type="number" min="1" class="form-input admin-editable-input" name="catalogue_sku_threshold" value="${config.pick_pack_rules.catalogue_sku_threshold ?? 100}" style="font-weight: 700;">
                  </div>
                  <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label" style="font-size: 0.74rem;">Exento hasta (Unid.)</label>
                    <input type="number" min="0" class="form-input admin-editable-input" name="catalogue_exempt_max_units" value="${config.pick_pack_rules.catalogue_exempt_max_units ?? 2}" style="font-weight: 700;">
                  </div>
                  <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label" style="font-size: 0.74rem;">Recargo Catálogo ($)</label>
                    <div style="display: flex; align-items: center; gap: 0.25rem;">
                      <span>$</span>
                      <input type="number" min="0" class="form-input admin-editable-input" name="surcharge_catalogue_over_100_sku" value="${config.pick_pack_rules.surcharge_catalogue_over_100_sku ?? 100}" style="font-weight: 700;">
                    </div>
                  </div>
                </div>

                <div class="admin-grid-2">
                  <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label" style="font-size: 0.76rem;">Recargo Colecta Marketplace ($)</label>
                    <div style="display: flex; align-items: center; gap: 0.35rem;">
                      <span>$</span>
                      <input type="number" min="0" class="form-input admin-editable-input" name="surcharge_marketplace_collect" value="${config.pick_pack_rules.surcharge_marketplace_collect ?? 100}" style="font-weight: 700;">
                    </div>
                  </div>
                  <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label" style="font-size: 0.76rem;">Etiquetado Envíos FULL ($/ítem)</label>
                    <div style="display: flex; align-items: center; gap: 0.35rem;">
                      <span>$</span>
                      <input type="number" min="0" class="form-input admin-editable-input" name="surcharge_ml_full_labeling" value="${config.pick_pack_rules.surcharge_ml_full_labeling ?? 100}" style="font-weight: 700;">
                    </div>
                  </div>
                </div>
              </div>

              <hr style="border: 0; border-top: 1px dashed var(--color-border); margin: 1.15rem 0;">

              <!-- Acceso Rápido a Materiales y Embalaje -->
              <div style="background: rgba(94, 23, 235, 0.05); border: 1px dashed rgba(94, 23, 235, 0.35); border-radius: var(--radius-md); padding: 0.85rem 1rem; display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
                <div>
                  <h4 style="font-size: 0.88rem; font-weight: 700; color: var(--color-text-main); margin: 0 0 0.2rem 0; display: flex; align-items: center; gap: 0.35rem;">
                    <i class="ri-box-1-line" style="color: var(--color-accent);"></i> Materiales: Cajas por Tamaño y Plástico Burbuja
                  </h4>
                  <p style="font-size: 0.75rem; color: var(--color-text-muted); margin: 0;">
                    Configura cajas (${(config.supplies?.boxes || []).length} tamaños activos) y el rollo de plástico burbuja ($${Number(config.supplies?.bubble_wrap_roll?.cost_per_linear_cm ?? 3.6).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 4 })} / cm lineal).
                  </p>
                </div>
                <button type="button" id="btn-jump-to-materials-tab" class="btn btn-outline" style="font-size: 0.78rem; padding: 0.4rem 0.75rem; border-color: var(--color-accent); color: var(--color-accent); font-weight: 700;">
                  <i class="ri-settings-3-line"></i> Configurar Cajas y Burbuja
                </button>
              </div>
            </div>

            <!-- Tarifas de Despacho y Extras -->
            <div class="card" style="padding: 1.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg);">
              <h3 style="font-size: 1.05rem; font-weight: 700; color: var(--color-text-main); margin: 0 0 0.5rem 0;">
                <i class="ri-truck-line" style="color: var(--color-primary);"></i> Tarifas de Despacho y Sucursal
              </h3>

              <div class="admin-grid-2" style="margin-top: 0.75rem;">
                <div class="form-group" style="margin-bottom: 0.65rem;">
                  <label class="form-label" style="font-size: 0.78rem;">Despacho RM Same Day / Flex</label>
                  <div style="display: flex; align-items: center; gap: 0.35rem;">
                    <span>$</span>
                    <input type="number" class="form-input admin-editable-input" name="shipping_same_day_rm" value="${config.shipping.same_day_rm ?? 3200}" style="font-weight: 700;">
                  </div>
                </div>
                <div class="form-group" style="margin-bottom: 0.65rem;">
                  <label class="form-label" style="font-size: 0.78rem;">Despacho a Colina</label>
                  <div style="display: flex; align-items: center; gap: 0.35rem;">
                    <span>$</span>
                    <input type="number" class="form-input admin-editable-input" name="shipping_colina" value="${config.shipping.colina ?? 3490}" style="font-weight: 700;">
                  </div>
                </div>
              </div>

              <div class="admin-grid-2">
                <div class="form-group" style="margin-bottom: 0;">
                  <label class="form-label" style="font-size: 0.78rem;">Cargo Integración Envíame / orden</label>
                  <div style="display: flex; align-items: center; gap: 0.35rem;">
                    <span>$</span>
                    <input type="number" class="form-input admin-editable-input" name="shipping_enviame_fee" value="${config.shipping.enviame_integration_fee ?? 35}" style="font-weight: 700;">
                  </div>
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                  <label class="form-label" style="font-size: 0.78rem;">Retiro Express Sucursal Base</label>
                  <div style="display: flex; align-items: center; gap: 0.35rem;">
                    <span>$</span>
                    <input type="number" class="form-input admin-editable-input" name="shipping_pickup_express" value="${config.shipping.pickup_express_base ?? 1490}" style="font-weight: 700;">
                  </div>
                </div>
              </div>

              <hr style="border: 0; border-top: 1px dashed var(--color-border); margin: 1.15rem 0;">

              <!-- Tarifas Promedio a Regiones por Peso (Vía Envíame / Starken) -->
              <div style="margin-bottom: 1rem;">
                <h4 style="font-size: 0.92rem; font-weight: 700; color: var(--color-primary); margin: 0 0 0.25rem 0; display: flex; align-items: center; gap: 0.35rem;">
                  <i class="ri-road-map-fill"></i> Tarifas Promedio a Regiones por Rango de Peso
                </h4>
                <p style="font-size: 0.76rem; color: var(--color-text-muted); margin: 0 0 0.75rem 0;">Edita el nombre del rango de peso, la tarifa promedio ($) y el courier referencial.</p>

                <div style="display: flex; flex-direction: column; gap: 0.55rem;">
                  ${(config.regional_shipping?.weight_brackets || DEFAULT_PRICING_CONFIG.regional_shipping.weight_brackets).map((wb, idx) => `
                    <div style="display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 0.5rem; align-items: center; background: var(--color-bg); padding: 0.55rem 0.7rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
                      <div>
                        <small style="display: block; font-size: 0.66rem; color: var(--color-text-muted);">Rango de Peso / Etiqueta</small>
                        <input type="text" class="form-input admin-editable-input" name="regional_wb_${idx}_label" value="${wb.label}" style="font-size: 0.78rem; font-weight: 600; padding: 0.35rem 0.5rem;">
                      </div>
                      <div>
                        <small style="display: block; font-size: 0.66rem; color: var(--color-text-muted);">Tarifa Promedio ($)</small>
                        <div style="display: flex; align-items: center; gap: 0.25rem;">
                          <span>$</span>
                          <input type="number" min="0" class="form-input admin-editable-input" name="regional_wb_${idx}_rate" value="${wb.avg_rate}" style="font-size: 0.82rem; font-weight: 700; padding: 0.35rem 0.5rem;">
                        </div>
                      </div>
                      <div>
                        <small style="display: block; font-size: 0.66rem; color: var(--color-text-muted);">Courier Ref.</small>
                        <input type="text" class="form-input admin-editable-input" name="regional_wb_${idx}_courier" value="${wb.cheapest_courier || 'Starken / Envíame'}" style="font-size: 0.76rem; padding: 0.35rem 0.5rem;">
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>

              <hr style="border: 0; border-top: 1px dashed var(--color-border); margin: 1.15rem 0;">
              
              <h4 style="font-size: 0.92rem; font-weight: 700; color: var(--color-text-main); margin: 0 0 0.6rem 0; display: flex; align-items: center; gap: 0.35rem;">
                <i class="ri-store-3-line" style="color: var(--color-accent);"></i> Servicios en Sucursal y Descarga (UF)
              </h4>
              <div class="admin-grid-2">
                <div class="form-group" style="margin-bottom: 0.5rem;">
                  <label class="form-label" style="font-size: 0.76rem;">Punto de Venta POS (UF/mes)</label>
                  <input type="number" step="0.1" min="0" class="form-input admin-editable-input" name="service_pos_uf" value="${config.services?.pos_monthly_uf ?? 0.2}" style="font-weight: 700;">
                </div>
                <div class="form-group" style="margin-bottom: 0.5rem;">
                  <label class="form-label" style="font-size: 0.76rem;">Vitrina Exhibición (UF/mes)</label>
                  <input type="number" step="0.1" min="0" class="form-input admin-editable-input" name="service_vitrina_uf" value="${config.services?.vitrina_monthly_uf ?? 0.6}" style="font-weight: 700;">
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                  <label class="form-label" style="font-size: 0.76rem;">Descarga Camión / Prov. (UF/m³)</label>
                  <input type="number" step="0.05" min="0" class="form-input admin-editable-input" name="service_unloading_uf_m3" value="${config.services?.unloading_service_uf_per_m3 ?? 0.1}" style="font-weight: 700;">
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                  <label class="form-label" style="font-size: 0.76rem;">Tope Descarga (UF máx.)</label>
                  <input type="number" step="0.1" min="0" class="form-input admin-editable-input" name="service_unloading_cap_uf" value="${config.services?.unloading_service_cap_uf ?? 2.0}" style="font-weight: 700;">
                </div>
              </div>

            </div>

          </div>
        </div>

        <!-- PESTAÑA 4: MATERIALES Y EMBALAJE (CAJAS DE DISTINTO TAMAÑO Y PLÁSTICO BURBUJA) -->
        <div id="tab-content-materials" class="admin-pricing-tab-content" style="display: ${activeTab === 'materials' ? 'block' : 'none'};">
          <div class="admin-two-col-grid" style="align-items: start;">

            <!-- COLUMNA IZQUIERDA: PLÁSTICO BURBUJA (ROLLO -> COSTO LINEAL POR CM) -->
            <div class="card" style="padding: 1.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg);">
              <div style="margin-bottom: 1rem;">
                <h3 style="font-size: 1.05rem; font-weight: 700; color: var(--color-text-main); margin: 0 0 0.25rem 0; display: flex; align-items: center; gap: 0.4rem;">
                  <i class="ri-stack-line" style="color: var(--color-accent);"></i> Plástico Burbuja (Cálculo por Centímetro Lineal)
                </h3>
                <p style="font-size: 0.8rem; color: var(--color-text-muted); margin: 0;">
                  Define el costo del rollo, su ancho y los metros totales para obtener automáticamente el costo lineal por centímetro (<strong>$ / cm</strong>), por metro lineal y por m².
                </p>
              </div>

              ${(() => {
                const bwRoll = config.supplies?.bubble_wrap_roll || { roll_cost: 36000, roll_width_cm: 100, roll_length_m: 100 };
                const rCost = parseFloat(bwRoll.roll_cost) || 36000;
                const rWidthCm = parseFloat(bwRoll.roll_width_cm) || 100;
                const rLengthM = parseFloat(bwRoll.roll_length_m) || 100;
                const totalCm = Math.round(rLengthM * 100);
                const costPerCm = totalCm > 0 ? (rCost / totalCm) : 0;
                const costPerM = costPerCm * 100;
                const totalSqm = rLengthM * (rWidthCm / 100);
                const costPerSqm = totalSqm > 0 ? (rCost / totalSqm) : 0;

                return `
                  <div style="background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1rem; margin-bottom: 1rem;">
                    <div style="font-size: 0.76rem; font-weight: 800; color: var(--color-text-muted); text-transform: uppercase; margin-bottom: 0.75rem;">
                      Parámetros del Rollo de Plástico Burbuja
                    </div>

                    <div class="form-group" style="margin-bottom: 0.85rem;">
                      <label class="form-label" style="font-size: 0.8rem; font-weight: 700;">1. Costo del Rollo ($ CLP + IVA)</label>
                      <div style="display: flex; align-items: center; gap: 0.4rem;">
                        <span style="font-weight: 800; color: var(--color-text-muted);">$</span>
                        <input type="number" min="0" step="100" id="input-bubble-roll-cost" name="bubble_roll_cost" class="form-input admin-editable-input" value="${rCost}" style="font-weight: 800; font-size: 0.95rem;">
                      </div>
                    </div>

                    <div class="admin-grid-2">
                      <div class="form-group" style="margin-bottom: 0;">
                        <label class="form-label" style="font-size: 0.8rem; font-weight: 700;">2. Ancho del Rollo (cm)</label>
                        <div style="display: flex; align-items: center; gap: 0.35rem;">
                          <input type="number" min="1" step="1" id="input-bubble-roll-width" name="bubble_roll_width_cm" class="form-input admin-editable-input" value="${rWidthCm}" style="font-weight: 700;">
                          <span style="font-size: 0.8rem; font-weight: 700; color: var(--color-text-muted);">cm</span>
                        </div>
                        <small style="font-size: 0.7rem; color: var(--color-text-muted);">Equivale a <span id="lbl-bubble-width-m">${(rWidthCm / 100).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> m de ancho</small>
                      </div>

                      <div class="form-group" style="margin-bottom: 0;">
                        <label class="form-label" style="font-size: 0.8rem; font-weight: 700;">3. Metros Totales del Rollo (m)</label>
                        <div style="display: flex; align-items: center; gap: 0.35rem;">
                          <input type="number" min="1" step="1" id="input-bubble-roll-length" name="bubble_roll_length_m" class="form-input admin-editable-input" value="${rLengthM}" style="font-weight: 700;">
                          <span style="font-size: 0.8rem; font-weight: 700; color: var(--color-text-muted);">m</span>
                        </div>
                        <small style="font-size: 0.7rem; color: var(--color-text-muted);">Total: <strong id="lbl-bubble-total-cm">${totalCm.toLocaleString('es-CL')}</strong> cm lineales</small>
                      </div>
                    </div>
                  </div>

                  <!-- Tarjeta de Resultado de Costo Lineal por Centímetro -->
                  <div style="background: linear-gradient(135deg, rgba(94, 23, 235, 0.08), rgba(16, 185, 129, 0.08)); border: 1.5px solid rgba(94, 23, 235, 0.3); border-radius: var(--radius-md); padding: 1rem 1.15rem; margin-bottom: 1rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.65rem;">
                      <div>
                        <div style="font-size: 0.74rem; font-weight: 800; text-transform: uppercase; color: var(--color-accent);">
                          Costo Lineal por Centímetro (Ancho <span id="res-bubble-width-badge">${rWidthCm}</span> cm)
                        </div>
                        <div style="font-size: 0.72rem; color: var(--color-text-muted);">
                          Fórmula: Costo Rollo &divide; (<span id="res-bubble-formula-cm">${totalCm.toLocaleString('es-CL')}</span> cm lineales)
                        </div>
                      </div>
                      <div style="text-align: right;">
                        <span id="res-bubble-cost-per-cm" style="font-size: 1.45rem; font-weight: 900; color: var(--color-accent);">
                          $${costPerCm.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                        </span>
                        <span style="font-size: 0.82rem; font-weight: 700; color: var(--color-text-main);"> / cm lineal</span>
                      </div>
                    </div>

                    <div class="admin-grid-3" style="border-top: 1px solid rgba(94, 23, 235, 0.18); padding-top: 0.65rem; font-size: 0.78rem;">
                      <div>
                        <span style="color: var(--color-text-muted); display: block; font-size: 0.7rem;">Cada 10 cm lineales:</span>
                        <strong id="res-bubble-cost-10cm" style="color: var(--color-text-main); font-size: 0.88rem;">$${(costPerCm * 10).toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</strong>
                      </div>
                      <div>
                        <span style="color: var(--color-text-muted); display: block; font-size: 0.7rem;">Metro lineal (100 cm):</span>
                        <strong id="res-bubble-cost-per-m" style="color: var(--color-text-main); font-size: 0.88rem;">$${Math.round(costPerM).toLocaleString('es-CL')} / m</strong>
                      </div>
                      <div>
                        <span style="color: var(--color-text-muted); display: block; font-size: 0.7rem;">Costo por m² (${totalSqm.toFixed(1)} m²):</span>
                        <strong id="res-bubble-cost-per-sqm" style="color: var(--color-text-main); font-size: 0.88rem;">$${Math.round(costPerSqm).toLocaleString('es-CL')} / m²</strong>
                      </div>
                    </div>
                  </div>

                  <!-- Simulador Rápido de Corte por Pedido -->
                  <div style="background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.85rem 1rem;">
                    <div style="font-size: 0.75rem; font-weight: 800; color: var(--color-text-main); text-transform: uppercase; margin-bottom: 0.45rem; display: flex; align-items: center; gap: 0.35rem;">
                      <i class="ri-scissors-cut-line" style="color: var(--color-accent);"></i> Simulador Rápido de Consumo por Corte (cm)
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;">
                      <div style="display: flex; align-items: center; gap: 0.4rem;">
                        <span style="font-size: 0.8rem; color: var(--color-text-muted);">Largo de corte usado:</span>
                        <input type="number" id="sim-bubble-cut-cm" class="form-input admin-editable-input" value="50" min="1" step="5" style="width: 85px; font-weight: 800; text-align: center; padding: 0.35rem 0.5rem;">
                        <span style="font-size: 0.8rem; font-weight: 700;">cm</span>
                      </div>
                      <div style="font-size: 0.85rem;">
                        Costo del tramo: <strong id="sim-bubble-cut-result" style="font-size: 1rem; color: var(--color-success); font-weight: 800;">$${Math.round(50 * costPerCm).toLocaleString('es-CL')} + IVA</strong>
                      </div>
                    </div>
                  </div>
                `;
              })()}
            </div>

            <!-- COLUMNA DERECHA: CAJAS DE DISTINTO TAMAÑO (POR UNIDAD Y TAMAÑOS) -->
            <div class="card" style="padding: 1.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg);">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap;">
                <div>
                  <h3 style="font-size: 1.05rem; font-weight: 700; color: var(--color-text-main); margin: 0 0 0.25rem 0; display: flex; align-items: center; gap: 0.4rem;">
                    <i class="ri-box-3-line" style="color: var(--color-primary);"></i> Tarifas de Cajas por Tamaño y Unidad
                  </h3>
                  <p style="font-size: 0.8rem; color: var(--color-text-muted); margin: 0;">
                    Configura las cajas disponibles definiendo su nombre, medidas en cm (Largo &times; Ancho &times; Alto) y tarifa unitaria.
                  </p>
                </div>
                <button type="button" id="btn-add-box-size" class="btn btn-outline" style="font-size: 0.78rem; padding: 0.4rem 0.75rem; border-color: var(--color-accent); color: var(--color-accent); font-weight: 700; display: inline-flex; align-items: center; gap: 0.3rem;">
                  <i class="ri-add-line"></i> Agregar Tamaño de Caja
                </button>
              </div>

              <div style="display: flex; flex-direction: column; gap: 0.65rem;">
                <!-- Encabezado de tabla de cajas -->
                <div style="display: grid; grid-template-columns: 1.15fr 1.6fr 1fr 34px; gap: 0.5rem; padding: 0 0.5rem; font-size: 0.72rem; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase;">
                  <span>Nombre / Tipo</span>
                  <span>Medidas: Largo &times; Ancho &times; Alto (cm)</span>
                  <span style="text-align: right;">Precio / Unidad</span>
                  <span></span>
                </div>

                ${(config.supplies?.boxes || DEFAULT_PRICING_CONFIG.supplies.boxes).map((bx, idx) => {
                  const volLiters = ((bx.length_cm * bx.width_cm * bx.height_cm) / 1000).toFixed(1);
                  return `
                    <div class="box-size-row" data-box-idx="${idx}" style="display: grid; grid-template-columns: 1.15fr 1.6fr 1fr 34px; gap: 0.5rem; align-items: center; background: var(--color-bg); padding: 0.65rem 0.75rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
                      <div>
                        <input type="text" class="form-input admin-editable-input" name="box_${idx}_name" value="${bx.name}" placeholder="Ej: Caja S" style="font-weight: 700; font-size: 0.84rem; padding: 0.4rem 0.55rem;">
                        <small class="box-dims-summary" data-box-summary="${idx}" style="display: block; font-size: 0.68rem; color: var(--color-text-muted); margin-top: 2px;">
                          ${bx.length_cm}&times;${bx.width_cm}&times;${bx.height_cm} cm (${volLiters} L)
                        </small>
                      </div>

                      <div style="display: flex; align-items: center; gap: 0.25rem;">
                        <input type="number" min="1" step="1" class="form-input admin-editable-input input-box-dim" data-box-idx="${idx}" name="box_${idx}_length" value="${bx.length_cm}" title="Largo (cm)" style="padding: 0.4rem 0.3rem; font-size: 0.82rem; font-weight: 700; text-align: center;">
                        <span style="font-size: 0.75rem; color: var(--color-text-muted);">&times;</span>
                        <input type="number" min="1" step="1" class="form-input admin-editable-input input-box-dim" data-box-idx="${idx}" name="box_${idx}_width" value="${bx.width_cm}" title="Ancho (cm)" style="padding: 0.4rem 0.3rem; font-size: 0.82rem; font-weight: 700; text-align: center;">
                        <span style="font-size: 0.75rem; color: var(--color-text-muted);">&times;</span>
                        <input type="number" min="1" step="1" class="form-input admin-editable-input input-box-dim" data-box-idx="${idx}" name="box_${idx}_height" value="${bx.height_cm}" title="Alto (cm)" style="padding: 0.4rem 0.3rem; font-size: 0.82rem; font-weight: 700; text-align: center;">
                        <span style="font-size: 0.72rem; color: var(--color-text-muted); font-weight: 600;">cm</span>
                      </div>

                      <div style="display: flex; align-items: center; justify-content: flex-end; gap: 0.25rem;">
                        <span style="font-weight: 700; color: var(--color-text-muted); font-size: 0.82rem;">$</span>
                        <input type="number" min="0" step="10" class="form-input admin-editable-input" name="box_${idx}_price" value="${bx.unit_price}" style="width: 82px; padding: 0.4rem 0.5rem; font-weight: 800; font-size: 0.88rem; text-align: right; color: var(--color-primary);">
                        <span style="font-size: 0.7rem; color: var(--color-text-muted);">c/u</span>
                      </div>

                      <div style="text-align: center;">
                        ${(config.supplies?.boxes || []).length > 1 ? `
                          <button type="button" class="btn-remove-box-size" data-idx="${idx}" title="Eliminar esta caja" style="background: rgba(239,68,68,0.1); color: #ef4444; border: 1px solid rgba(239,68,68,0.25); border-radius: 6px; width: 30px; height: 30px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;">
                            <i class="ri-delete-bin-line"></i>
                          </button>
                        ` : ''}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>

              <p style="margin: 0.85rem 0 0 0; font-size: 0.74rem; color: var(--color-text-muted);">
                <i class="ri-information-line"></i> Estas cajas y tarifas unitarias quedan disponibles automáticamente en el <strong>Cotizador 360</strong> y en el selector de <strong>Insumos de Facturación</strong>.
              </p>
            </div>

          </div>
        </div>

        <!-- PESTAÑA 5: LEADS DE COTIZACIONES -->
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
                  <input type="url" class="form-input admin-editable-input" name="pres_fulfillment_url" value="${config.presentations?.fulfillment_url || ''}" placeholder="https://..." style="font-size: 0.8rem;">
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                  <label class="form-label" style="font-size: 0.78rem;">Cargar nuevo archivo PDF:</label>
                  <input type="file" id="pricing-admin-fulfillment-file" accept=".pdf" class="form-input admin-editable-input" style="font-size: 0.78rem; padding: 0.35rem 0.5rem;">
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
                  <input type="url" class="form-input admin-editable-input" name="pres_despachos_rm_url" value="${config.presentations?.despachos_rm_url || ''}" placeholder="https://..." style="font-size: 0.8rem;">
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                  <label class="form-label" style="font-size: 0.78rem;">Cargar nuevo archivo PDF:</label>
                  <input type="file" id="pricing-admin-despachos-file" accept=".pdf" class="form-input admin-editable-input" style="font-size: 0.78rem; padding: 0.35rem 0.5rem;">
                </div>
              </div>

              <!-- Carpeta Tarifas Courier Chile (Drive) -->
              <div style="padding: 1.25rem; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                  <h4 style="margin: 0; font-size: 0.95rem; font-weight: 700; color: #7c3aed; display: flex; align-items: center; gap: 0.35rem;">
                    <i class="ri-folder-shared-fill"></i> 3. Carpeta Tarifas Courier Chile (Drive)
                  </h4>
                  <a href="${config.presentations?.courier_folder_url || 'https://drive.google.com/drive/folders/1670M-vkABh7Qiyce4pH1YvL_67KZTfMH'}" target="_blank" class="btn btn-outline" style="padding: 0.2rem 0.5rem; font-size: 0.75rem; color: #7c3aed; border-color: #7c3aed;">
                    <i class="ri-external-link-line"></i> Abrir Drive
                  </a>
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                  <label class="form-label" style="font-size: 0.78rem;">Enlace a Carpeta Online en Google Drive:</label>
                  <input type="url" class="form-input admin-editable-input" name="pres_courier_folder_url" value="${config.presentations?.courier_folder_url || 'https://drive.google.com/drive/folders/1670M-vkABh7Qiyce4pH1YvL_67KZTfMH'}" placeholder="https://drive.google.com/..." style="font-size: 0.8rem;">
                </div>
              </div>

              <!-- Cotizador Online en Vivo -->
              <div style="padding: 1.25rem; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                  <h4 style="margin: 0; font-size: 0.95rem; font-weight: 700; color: #10b981; display: flex; align-items: center; gap: 0.35rem;">
                    <i class="ri-calculator-fill"></i> 4. Cotizador Online en Vivo
                  </h4>
                  <a href="${config.presentations?.cotizador_url || 'https://stocka.cl/pages/cotizaserviciofulfillment'}" target="_blank" class="btn btn-outline" style="padding: 0.2rem 0.5rem; font-size: 0.75rem; color: #10b981; border-color: #10b981;">
                    <i class="ri-external-link-line"></i> Probar Simulador
                  </a>
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                  <label class="form-label" style="font-size: 0.78rem;">URL Pública del Simulador Interactivo:</label>
                  <input type="url" class="form-input admin-editable-input" name="pres_cotizador_url" value="${config.presentations?.cotizador_url || 'https://stocka.cl/pages/cotizaserviciofulfillment'}" placeholder="https://stocka.cl/..." style="font-size: 0.8rem;">
                </div>
              </div>
            </div>

            <p style="margin-top: 1rem; font-size: 0.75rem; color: var(--color-text-muted);">
              💡 <em>Nota: Estos documentos y enlaces se sincronizan automáticamente con el cotizador público, el correo formal de cotización y los correos comerciales enviados desde el Centro de Leads.</em>
            </p>
          </div>
        </div>

      </form>

    </div>
  `;

  // Estilos del módulo de administración de tarifas
  let tabStyles = document.getElementById('pricing-admin-custom-styles');
  if (!tabStyles) {
    tabStyles = document.createElement('style');
    tabStyles.id = 'pricing-admin-custom-styles';
    document.head.appendChild(tabStyles);
  }
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
    .admin-two-col-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
    }
    .admin-grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.85rem;
    }
    .admin-grid-3 {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 0.75rem;
    }
    @media (max-width: 980px) {
      .admin-two-col-grid {
        grid-template-columns: 1fr;
      }
    }
    @media (max-width: 640px) {
      .admin-grid-2, .admin-grid-3 {
        grid-template-columns: 1fr;
      }
    }
    .pricing-admin-wrapper .admin-editable-input {
      background-color: var(--color-surface) !important;
      border: 1.5px solid var(--color-border) !important;
      color: var(--color-text-main) !important;
      border-radius: 8px !important;
      padding: 0.5rem 0.75rem;
      font-size: 0.88rem;
      transition: border-color 0.18s ease, box-shadow 0.18s ease;
    }
    .pricing-admin-wrapper .admin-editable-input:hover:not([readonly]) {
      border-color: rgba(94, 23, 235, 0.45) !important;
    }
    .pricing-admin-wrapper .admin-editable-input:focus {
      outline: none !important;
      border-color: var(--color-accent) !important;
      box-shadow: 0 0 0 3px rgba(94, 23, 235, 0.15) !important;
    }
  `;

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

  // Auto-actualizar etiqueta de Rango de Pedidos al cambiar Min o Max
  config.order_ranges.forEach((r, idx) => {
    const minEl = document.querySelector(`input[data-range-min="${idx}"]`);
    const maxEl = document.querySelector(`input[data-range-max="${idx}"]`);
    const lblEl = document.querySelector(`input[data-range-label="${idx}"]`);
    if (minEl && maxEl && lblEl) {
      let lastAutoLabel = buildOrderRangeLabel(r.min, r.max);
      const onRangeChange = () => {
        const currentMin = parseIntSafe(minEl.value, 0);
        const currentMax = parseIntSafe(maxEl.value, 0);
        const newAuto = buildOrderRangeLabel(currentMin, currentMax);
        if (!lblEl.value.trim() || lblEl.value.trim() === lastAutoLabel || lblEl.value.trim() === r.label) {
          lblEl.value = newAuto;
        }
        lastAutoLabel = newAuto;
      };
      minEl.addEventListener('input', onRangeChange);
      maxEl.addEventListener('input', onRangeChange);
    }
  });

  // Agregar Rango de Pedidos
  const btnAddOrderRange = document.getElementById('btn-add-order-range');
  if (btnAddOrderRange) {
    btnAddOrderRange.addEventListener('click', () => {
      syncFormIntoConfigState(config);
      const last = config.order_ranges[config.order_ranges.length - 1] || { min: 0, max: 100, storage_m3: 26500, pick_pack_base: 850 };
      const prevMin = last.min || 0;
      if (last.max >= 999999) {
        last.max = prevMin + 999;
        last.label = buildOrderRangeLabel(last.min, last.max);
      }
      const nextMin = (last.max || 0) + 1;
      const nextMax = 999999;
      config.order_ranges.push({
        id: config.order_ranges.length + 1,
        min: nextMin,
        max: nextMax,
        label: buildOrderRangeLabel(nextMin, nextMax),
        pick_pack_base: Math.max(500, (last.pick_pack_base || 850) - 50),
        storage_m3: Math.max(15000, (last.storage_m3 || 26500) - 1500)
      });
      renderAdminUI(config, leads);
    });
  }

  // Eliminar Rango de Pedidos
  document.querySelectorAll('.btn-remove-order-range').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      if (isNaN(idx) || config.order_ranges.length <= 1) return;
      syncFormIntoConfigState(config);
      config.order_ranges.splice(idx, 1);
      config.order_ranges.forEach((r, i) => { r.id = i + 1; });
      renderAdminUI(config, leads);
    });
  });

  // Checkbox Sin Límite en Descuentos por Volumen
  document.querySelectorAll('.chk-discount-unlimited').forEach(chk => {
    chk.addEventListener('change', () => {
      const idx = chk.getAttribute('data-idx');
      const maxInput = document.getElementById(`discount_${idx}_max_input`);
      if (!maxInput) return;
      if (chk.checked) {
        maxInput.dataset.prevMax = maxInput.value !== '999999' ? maxInput.value : '100';
        maxInput.value = '999999';
        maxInput.readOnly = true;
        maxInput.style.opacity = '0.55';
      } else {
        const minInput = document.querySelector(`input[name="discount_${idx}_min"]`);
        const baseMin = parseFloatSafe(minInput?.value, 60);
        maxInput.value = maxInput.dataset.prevMax || (baseMin + 20);
        maxInput.readOnly = false;
        maxInput.style.opacity = '1';
      }
    });
  });

  // Agregar Tramo de Descuento por Volumen
  const btnAddDiscount = document.getElementById('btn-add-storage-discount');
  if (btnAddDiscount) {
    btnAddDiscount.addEventListener('click', () => {
      syncFormIntoConfigState(config);
      const last = config.storage_discounts[config.storage_discounts.length - 1] || { min: 10, max: 15, discount_pct: 18 };
      if (last.max >= 999999) {
        last.max = Math.round((last.min + 20) * 100) / 100;
        last.label = buildDiscountRangeLabel(last.min, last.max, last.discount_pct);
      }
      const nextMin = Number((last.max + 0.01).toFixed(2));
      const nextMax = 999999;
      const nextPct = Math.min(100, (last.discount_pct || 18) + 3);
      config.storage_discounts.push({
        min: nextMin,
        max: nextMax,
        discount_pct: nextPct,
        label: buildDiscountRangeLabel(nextMin, nextMax, nextPct)
      });
      renderAdminUI(config, leads);
    });
  }

  // Eliminar Tramo de Descuento por Volumen
  document.querySelectorAll('.btn-remove-storage-discount').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      if (isNaN(idx) || config.storage_discounts.length <= 1) return;
      syncFormIntoConfigState(config);
      config.storage_discounts.splice(idx, 1);
      renderAdminUI(config, leads);
    });
  });

  // Botón de salto rápido desde Pestaña 3 hacia Pestaña 4 (Materiales y Embalaje)
  const btnJumpMaterials = document.getElementById('btn-jump-to-materials-tab');
  if (btnJumpMaterials) {
    btnJumpMaterials.addEventListener('click', () => {
      const matTabBtn = document.querySelector('.btn-tab-admin[data-tab="materials"]');
      if (matTabBtn) matTabBtn.click();
    });
  }

  // Cálculo reactivo en vivo para el Rollo de Plástico Burbuja -> Costo Lineal por Centímetro
  const inputBubbleCost = document.getElementById('input-bubble-roll-cost');
  const inputBubbleWidth = document.getElementById('input-bubble-roll-width');
  const inputBubbleLength = document.getElementById('input-bubble-roll-length');
  const simBubbleCutCm = document.getElementById('sim-bubble-cut-cm');

  const updateBubbleLiveCalc = () => {
    const rCost = Math.max(0, parseFloatSafe(inputBubbleCost?.value, 0));
    const rWidthCm = Math.max(1, parseFloatSafe(inputBubbleWidth?.value, 100));
    const rLengthM = Math.max(0.1, parseFloatSafe(inputBubbleLength?.value, 100));
    const totalCm = Math.round(rLengthM * 100);
    const costPerCm = totalCm > 0 ? (rCost / totalCm) : 0;
    const costPerM = costPerCm * 100;
    const totalSqm = rLengthM * (rWidthCm / 100);
    const costPerSqm = totalSqm > 0 ? (rCost / totalSqm) : 0;

    const elWidthM = document.getElementById('lbl-bubble-width-m');
    const elTotalCm = document.getElementById('lbl-bubble-total-cm');
    const elWidthBadge = document.getElementById('res-bubble-width-badge');
    const elFormulaCm = document.getElementById('res-bubble-formula-cm');
    const elCostPerCm = document.getElementById('res-bubble-cost-per-cm');
    const elCost10Cm = document.getElementById('res-bubble-cost-10cm');
    const elCostPerM = document.getElementById('res-bubble-cost-per-m');
    const elCostPerSqm = document.getElementById('res-bubble-cost-per-sqm');
    const elSimResult = document.getElementById('sim-bubble-cut-result');

    if (elWidthM) elWidthM.textContent = (rWidthCm / 100).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (elTotalCm) elTotalCm.textContent = totalCm.toLocaleString('es-CL');
    if (elWidthBadge) elWidthBadge.textContent = rWidthCm;
    if (elFormulaCm) elFormulaCm.textContent = totalCm.toLocaleString('es-CL');
    if (elCostPerCm) elCostPerCm.textContent = `$${costPerCm.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
    if (elCost10Cm) elCost10Cm.textContent = `$${(costPerCm * 10).toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    if (elCostPerM) elCostPerM.textContent = `$${Math.round(costPerM).toLocaleString('es-CL')} / m`;
    if (elCostPerSqm) elCostPerSqm.textContent = `$${Math.round(costPerSqm).toLocaleString('es-CL')} / m²`;

    const cutCm = Math.max(0, parseFloatSafe(simBubbleCutCm?.value, 50));
    if (elSimResult) {
      elSimResult.textContent = `$${Math.round(cutCm * costPerCm).toLocaleString('es-CL')} + IVA`;
    }
  };

  [inputBubbleCost, inputBubbleWidth, inputBubbleLength, simBubbleCutCm].forEach(el => {
    if (el) el.addEventListener('input', updateBubbleLiveCalc);
  });

  // Actualizar resumen de medidas y litros de cada caja en vivo
  document.querySelectorAll('.input-box-dim').forEach(inp => {
    inp.addEventListener('input', () => {
      const idx = inp.getAttribute('data-box-idx');
      const l = Math.max(1, parseFloatSafe(document.querySelector(`input[name="box_${idx}_length"]`)?.value, 10));
      const w = Math.max(1, parseFloatSafe(document.querySelector(`input[name="box_${idx}_width"]`)?.value, 10));
      const h = Math.max(1, parseFloatSafe(document.querySelector(`input[name="box_${idx}_height"]`)?.value, 10));
      const summaryEl = document.querySelector(`[data-box-summary="${idx}"]`);
      if (summaryEl) {
        const liters = ((l * w * h) / 1000).toFixed(1);
        summaryEl.innerHTML = `${l}&times;${w}&times;${h} cm (${liters} L)`;
      }
    });
  });

  // Agregar nuevo tamaño de caja
  const btnAddBoxSize = document.getElementById('btn-add-box-size');
  if (btnAddBoxSize) {
    btnAddBoxSize.addEventListener('click', () => {
      syncFormIntoConfigState(config);
      if (!Array.isArray(config.supplies.boxes)) config.supplies.boxes = [];
      const nextNum = config.supplies.boxes.length + 1;
      config.supplies.boxes.push({
        id: `box_custom_${Date.now()}`,
        name: `Caja #${nextNum}`,
        length_cm: 25,
        width_cm: 20,
        height_cm: 15,
        unit_price: 590
      });
      renderAdminUI(config, leads);
    });
  }

  // Eliminar tamaño de caja
  document.querySelectorAll('.btn-remove-box-size').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      if (isNaN(idx) || !Array.isArray(config.supplies?.boxes) || config.supplies.boxes.length <= 1) return;
      syncFormIntoConfigState(config);
      config.supplies.boxes.splice(idx, 1);
      renderAdminUI(config, leads);
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
      if (confirm('¿Estás seguro de restablecer todas las tarifas y rangos a los valores oficiales del Tarifario 2024-2025 v1.2?')) {
        await resetPricingConfigToDefaults(supabase);
        if (window.Swal) {
          window.Swal.fire({ icon: 'success', title: 'Tarifario Restablecido', text: 'Se han restaurado los valores y rangos por defecto oficiales.', timer: 2000 });
        }
        renderPricingConfigAdmin();
      }
    });
  }

  // Guardar Cambios
  const btnSave = document.getElementById('btn-save-pricing');
  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      const updatedConfig = syncFormIntoConfigState(JSON.parse(JSON.stringify(config)));

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
        currentAdminConfig = updatedConfig;
        renderAdminUI(currentAdminConfig, currentAdminLeads);
        if (window.Swal) {
          window.Swal.fire({
            icon: 'success',
            title: '¡Tarifas y Rangos Guardados!',
            text: 'La configuración de precios y rangos ha sido actualizada exitosamente para el cotizador y facturación.',
            timer: 2200
          });
        } else {
          alert("Tarifas y rangos guardados exitosamente.");
        }
      } else {
        alert(`Error al guardar tarifas: ${saveRes.error}`);
      }
    });
  }

  // Sincronizar UF en vivo al hacer click
  const btnSyncUf = document.getElementById('btn-sync-live-uf');
  if (btnSyncUf) {
    btnSyncUf.addEventListener('click', async () => {
      btnSyncUf.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Consultando...';
      try {
        const liveUf = await getLiveUfValue();
        const inputUf = document.getElementById('input-admin-uf');
        if (inputUf && liveUf) {
          inputUf.value = liveUf;
          config.uf_value = liveUf;
          config.uf_is_manual = false;
        }
        btnSyncUf.innerHTML = `<i class="ri-check-line"></i> $${liveUf.toLocaleString('es-CL')}`;
        setTimeout(() => {
          btnSyncUf.innerHTML = '<i class="ri-refresh-line"></i> Sincronizar UF en Vivo';
        }, 2500);
      } catch (e) {
        btnSyncUf.innerHTML = '<i class="ri-error-warning-line"></i> Error';
      }
    });
  }
}
