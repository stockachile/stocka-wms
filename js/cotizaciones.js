/**
 * Cotizaciones.js - Lógica interactiva del Cotizador Público de Fulfillment 360
 * STOCKA WMS
 */

import { 
  loadPricingConfig, 
  calculateQuotation, 
  formatCLP, 
  generateWhatsAppLink,
  sendQuoteEmailViaBrevo
} from './pricing_manager.js?v=1.3';

let currentPricingConfig = null;
let currentQuoteResult = null;
let activeStorageMode = 'didactic'; // 'didactic' | 'pallets' | 'direct'

// Elementos del DOM
const elOrdersSlider = document.getElementById('input-orders-slider');
const elOrdersNumber = document.getElementById('input-orders-number');
const elVolumeSlider = document.getElementById('input-volume-slider');
const elVolumeNumber = document.getElementById('input-volume-number');

// Inicialización
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Cargar configuración de tarifas
  const supabaseClient = window.supabaseClient || (window.supabase ? window.supabase.createClient('https://ejtjfaucnxbikrwjwwdu.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MzExODUsImV4cCI6MjA5NTQwNzE4NX0.cnuyxOpbqr-182Q3MJFJu0prtFSvwk1RgbiVBhjYUak') : null);
  
  currentPricingConfig = await loadPricingConfig(supabaseClient);
  
  // Mostrar UF configurada
  if (currentPricingConfig && currentPricingConfig.uf_value) {
    const ufDisplay = document.getElementById('uf-display-val');
    if (ufDisplay) ufDisplay.textContent = formatCLP(currentPricingConfig.uf_value);
  }

  // 2. Comprobar parámetros de URL si existen (?pedidos=X&volumen=Y)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('pedidos')) {
    const initialOrders = parseInt(urlParams.get('pedidos'), 10);
    if (!isNaN(initialOrders) && initialOrders >= 0) {
      if (elOrdersSlider) elOrdersSlider.value = initialOrders;
      if (elOrdersNumber) elOrdersNumber.value = initialOrders;
    }
  }
  if (urlParams.has('volumen')) {
    const initialVol = parseFloat(urlParams.get('volumen'));
    if (!isNaN(initialVol) && initialVol >= 0) {
      if (elVolumeSlider) elVolumeSlider.value = initialVol;
      if (elVolumeNumber) elVolumeNumber.value = initialVol;
    }
  }

  // 3. Registrar Event Listeners
  setupEventListeners();

  // 4. Primer cálculo y render inicial
  recalculateAndRender();
});

/**
 * Configuración de Eventos de la Interfaz
 */
function setupEventListeners() {
  // Sincronización Slider y Number input de Pedidos
  if (elOrdersSlider && elOrdersNumber) {
    elOrdersSlider.addEventListener('input', () => {
      elOrdersNumber.value = elOrdersSlider.value;
      highlightActivePreset(parseInt(elOrdersSlider.value, 10));
      recalculateAndRender();
    });

    elOrdersNumber.addEventListener('input', () => {
      elOrdersSlider.value = Math.min(3000, Math.max(0, parseInt(elOrdersNumber.value, 10) || 0));
      highlightActivePreset(parseInt(elOrdersNumber.value, 10));
      recalculateAndRender();
    });
  }

  // Botones de presets rápidos de pedidos
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const orders = parseInt(btn.getAttribute('data-orders'), 10);
      if (!isNaN(orders)) {
        if (elOrdersSlider) elOrdersSlider.value = orders;
        if (elOrdersNumber) elOrdersNumber.value = orders;
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        recalculateAndRender();
      }
    });
  });

  // Toggle de opciones avanzadas de pedido
  const btnToggleAdv = document.getElementById('btn-toggle-advanced-orders');
  const contentAdv = document.getElementById('content-advanced-orders');
  const iconAdv = document.getElementById('icon-advanced-orders');
  if (btnToggleAdv && contentAdv) {
    btnToggleAdv.addEventListener('click', () => {
      contentAdv.classList.toggle('open');
      if (iconAdv) {
        iconAdv.className = contentAdv.classList.contains('open') ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line';
      }
    });
  }

  // Checkboxes de Canales de Venta
  document.querySelectorAll('.channel-card input[type="checkbox"]').forEach(chk => {
    chk.addEventListener('change', () => {
      const card = chk.closest('.channel-card');
      if (card) {
        if (chk.checked) card.classList.add('selected');
        else card.classList.remove('selected');
      }
      recalculateAndRender();
    });
  });

  // Switches y Parámetros avanzados
  const advInputs = [
    'input-sku-per-order',
    'input-units-per-order',
    'switch-protected-sale',
    'switch-catalogue-100',
    'switch-marketplace-collect',
    'input-shipments-sameday',
    'input-shipments-courier',
    'select-regional-weight',
    'input-pickups-express',
    'input-bubble-wrap',
    'input-box-s',
    'check-pos-service',
    'check-vitrina-service',
    'input-unloading-m3'
  ];

  advInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', recalculateAndRender);
      el.addEventListener('change', recalculateAndRender);
    }
  });

  // TABS DE MODO DE ALMACENAMIENTO
  document.querySelectorAll('.mode-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-mode');
      activeStorageMode = mode;

      document.querySelectorAll('.mode-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.storage-tab-content').forEach(content => {
        content.style.display = 'none';
        content.classList.remove('active');
      });

      const activeContent = document.getElementById(`storage-mode-${mode}`);
      if (activeContent) {
        activeContent.style.display = 'block';
        activeContent.classList.add('active');
      }

      // Si pasa a directo o pallets, sincronizar el volumen actual
      syncStorageVolumeFromActiveMode();
      recalculateAndRender();
    });
  });

  // Contadores didácticos de cajas (+ / - e input directo)
  document.querySelectorAll('.didactic-item-card').forEach(card => {
    const btnMinus = card.querySelector('.btn-minus');
    const btnPlus = card.querySelector('.btn-plus');
    const inputQty = card.querySelector('.item-qty-input');
    const vol = parseFloat(card.getAttribute('data-vol')) || 0;

    const updateItemSubtotal = () => {
      const qty = Math.max(0, parseInt(inputQty.value, 10) || 0);
      inputQty.value = qty;
      const subtotalM3 = (qty * vol).toFixed(2);
      const subEl = card.querySelector('.didactic-item-subtotal strong');
      if (subEl) subEl.textContent = `${subtotalM3} m³`;
      syncStorageVolumeFromActiveMode();
      recalculateAndRender();
    };

    if (btnMinus && inputQty) {
      btnMinus.addEventListener('click', () => {
        let val = parseInt(inputQty.value, 10) || 0;
        if (val > 0) {
          inputQty.value = val - (val > 50 ? 10 : 1);
          updateItemSubtotal();
        }
      });
    }

    if (btnPlus && inputQty) {
      btnPlus.addEventListener('click', () => {
        let val = parseInt(inputQty.value, 10) || 0;
        inputQty.value = val + (val >= 50 ? 10 : 1);
        updateItemSubtotal();
      });
    }

    if (inputQty) {
      inputQty.addEventListener('input', updateItemSubtotal);
      inputQty.addEventListener('change', updateItemSubtotal);
    }
  });

  // Slider y Number Input de Volumen Directo
  if (elVolumeSlider && elVolumeNumber) {
    elVolumeSlider.addEventListener('input', () => {
      elVolumeNumber.value = elVolumeSlider.value;
      recalculateAndRender();
    });

    elVolumeNumber.addEventListener('input', () => {
      elVolumeSlider.value = Math.min(40, Math.max(0.1, parseFloat(elVolumeNumber.value) || 0.1));
      recalculateAndRender();
    });
  }

  // Calculadora de Caja Personalizada
  const btnApplyCustom = document.getElementById('btn-apply-custom-box');
  if (btnApplyCustom) {
    btnApplyCustom.addEventListener('click', () => {
      const l = parseFloat(document.getElementById('calc-custom-length')?.value) || 0;
      const w = parseFloat(document.getElementById('calc-custom-width')?.value) || 0;
      const h = parseFloat(document.getElementById('calc-custom-height')?.value) || 0;
      const qty = parseInt(document.getElementById('calc-custom-qty')?.value, 10) || 0;

      if (l > 0 && w > 0 && h > 0 && qty > 0) {
        const customM3 = ((l * w * h) / 1000000) * qty;
        if (elVolumeNumber) elVolumeNumber.value = customM3.toFixed(2);
        if (elVolumeSlider) elVolumeSlider.value = Math.min(40, customM3.toFixed(2));
        recalculateAndRender();
        alert(`Se han añadido ${customM3.toFixed(2)} m³ correspondientes a ${qty} cajas de ${l}×${w}×${h} cm.`);
      }
    });
  }

  // Modal de Envío de Cotización por Correo
  const btnOpenModal = document.getElementById('btn-open-email-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const modal = document.getElementById('email-quote-modal');
  const formLead = document.getElementById('lead-quote-form');

  if (btnOpenModal && modal) {
    btnOpenModal.addEventListener('click', () => {
      modal.classList.add('open');
    });
  }

  if (btnCloseModal && modal) {
    btnCloseModal.addEventListener('click', () => {
      modal.classList.remove('open');
    });
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('open');
    });
  }

  if (formLead) {
    formLead.addEventListener('submit', handleLeadSubmission);
  }

  // Botón Imprimir / PDF
  const btnPrint = document.getElementById('btn-print-quote');
  if (btnPrint) {
    btnPrint.addEventListener('click', () => {
      window.print();
    });
  }

  // Botón Solicitar Alta con Cotización
  const btnOnboarding = document.getElementById('btn-go-onboarding-with-quote');
  if (btnOnboarding) {
    btnOnboarding.addEventListener('click', (e) => {
      e.preventDefault();
      const orders = elOrdersNumber ? elOrdersNumber.value : '60';
      const volume = getCalculatedStorageVolume().toFixed(2);
      const selectedChannels = Array.from(document.querySelectorAll('input[name="sales_channel"]:checked'))
        .map(c => c.value)
        .join(',');
      
      const targetUrl = `./onboarding.html?pedidos=${encodeURIComponent(orders)}&volumen=${encodeURIComponent(volume)}&canales=${encodeURIComponent(selectedChannels)}`;
      window.location.href = targetUrl;
    });
  }
}

/**
 * Calcula el volumen de almacenamiento sumado según el modo activo
 */
function getCalculatedStorageVolume() {
  if (activeStorageMode === 'direct') {
    return Math.max(0.1, parseFloat(elVolumeNumber?.value) || 0.1);
  }

  let totalM3 = 0;
  const containerId = activeStorageMode === 'pallets' ? 'storage-mode-pallets' : 'storage-mode-didactic';
  const container = document.getElementById(containerId);
  
  if (container) {
    container.querySelectorAll('.didactic-item-card').forEach(card => {
      const vol = parseFloat(card.getAttribute('data-vol')) || 0;
      const qty = parseInt(card.querySelector('.item-qty-input')?.value, 10) || 0;
      totalM3 += (vol * qty);
    });
  }

  return Math.max(0.1, parseFloat(totalM3.toFixed(2)) || 0.1);
}

/**
 * Sincroniza los valores entre modos cuando el usuario cambia de tab
 */
function syncStorageVolumeFromActiveMode() {
  const vol = getCalculatedStorageVolume();
  if (elVolumeNumber) elVolumeNumber.value = vol.toFixed(2);
  if (elVolumeSlider) elVolumeSlider.value = Math.min(40, vol.toFixed(2));
}

/**
 * Destaca el botón preset activo
 */
function highlightActivePreset(orders) {
  document.querySelectorAll('.preset-btn').forEach(btn => {
    const val = parseInt(btn.getAttribute('data-orders'), 10);
    if (val === orders) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

/**
 * Recalcula todas las tarifas y actualiza el DOM
 */
function recalculateAndRender() {
  const monthlyOrders = parseInt(elOrdersNumber?.value, 10) || 0;
  const storageVolumeM3 = getCalculatedStorageVolume();

  const inputs = {
    monthlyOrders,
    storageVolumeM3,
    skuPerOrder: parseInt(document.getElementById('input-sku-per-order')?.value, 10) || 1,
    unitsPerOrder: parseInt(document.getElementById('input-units-per-order')?.value, 10) || 1,
    isProtectedSale: document.getElementById('switch-protected-sale')?.checked || false,
    hasOver100SkuCatalogue: document.getElementById('switch-catalogue-100')?.checked || false,
    isMarketplaceCollect: document.getElementById('switch-marketplace-collect')?.checked || false,
    shipmentsSameDay: parseInt(document.getElementById('input-shipments-sameday')?.value, 10) || 0,
    shipmentsCourier: parseInt(document.getElementById('input-shipments-courier')?.value, 10) || 0,
    regionalWeightBracket: document.getElementById('select-regional-weight')?.value || '1_3kg',
    pickupsExpress: parseInt(document.getElementById('input-pickups-express')?.value, 10) || 0,
    bubbleWrapSqm: parseFloat(document.getElementById('input-bubble-wrap')?.value) || 0,
    boxesS: parseInt(document.getElementById('input-box-s')?.value, 10) || 0,
    hasPosService: document.getElementById('check-pos-service')?.checked || false,
    hasVitrinaService: document.getElementById('check-vitrina-service')?.checked || false,
    unloadingVolumeM3: parseFloat(document.getElementById('input-unloading-m3')?.value) || 0
  };

  currentQuoteResult = calculateQuotation(inputs, currentPricingConfig);
  renderQuotation(currentQuoteResult);
}

/**
 * Renderiza los resultados en el DOM
 */
function renderQuotation(res) {
  // 1. Rango actual y Tarifas Base
  const badgeCurrentRange = document.getElementById('badge-current-range');
  if (badgeCurrentRange) {
    badgeCurrentRange.textContent = `Rango ${res.activeRange.id} (${res.activeRange.label})`;
  }

  const tierBannerName = document.getElementById('tier-banner-name');
  if (tierBannerName) {
    tierBannerName.textContent = `Rango ${res.activeRange.id}: ${res.activeRange.label}`;
  }

  const tierBannerPickPack = document.getElementById('tier-banner-pickpack');
  if (tierBannerPickPack) {
    const baseText = res.pickPack.isProtectedSale ? `${formatCLP(res.pickPack.baseRate)} (Venta Protegida)` : formatCLP(res.pickPack.baseRate);
    tierBannerPickPack.textContent = `${baseText} + IVA`;
  }

  const tierBannerStorage = document.getElementById('tier-banner-storage');
  if (tierBannerStorage) {
    tierBannerStorage.textContent = `${formatCLP(res.activeRange.storage_m3)} + IVA / m³`;
  }

  // Barra al siguiente rango
  const nextTierBar = document.getElementById('next-tier-bar-container');
  const nextTierText = document.getElementById('next-tier-text');
  if (nextTierBar && nextTierText) {
    if (res.nextRange && res.ordersToNextRange > 0) {
      nextTierBar.style.display = 'flex';
      nextTierText.innerHTML = `¡Agrega <strong>${res.ordersToNextRange} pedidos</strong> más para desbloquear el Rango ${res.nextRange.id} y pagar <strong>${formatCLP(res.nextRange.pick_pack_base)}</strong> por pedido!`;
    } else {
      nextTierBar.style.display = 'none';
    }
  }

  // 2. Almacenamiento y Equivalencia Didáctica
  const displayTotalVolume = document.getElementById('display-total-volume');
  if (displayTotalVolume) {
    displayTotalVolume.textContent = `${res.storage.volumeM3.toFixed(2)} m³`;
  }

  const displayEquivalence = document.getElementById('display-volume-equivalence');
  if (displayEquivalence) {
    const approxPallets = Math.max(1, Math.round(res.storage.volumeM3 / 1.8));
    const approxRacks = Math.max(1, Math.round(res.storage.volumeM3 / 1.0));
    displayEquivalence.innerHTML = `💡 Tu mercadería equivale aproximadamente a <strong>~${approxPallets} pallet${approxPallets > 1 ? 's' : ''} estándar</strong> o <strong>~${approxRacks} estante${approxRacks > 1 ? 's' : ''}</strong> de bodega.`;
  }

  // Badge de Descuento por Almacenamiento
  const badgeStorageDiscount = document.getElementById('badge-storage-discount');
  const labelDiscountScaleStatus = document.getElementById('label-discount-scale-status');
  if (badgeStorageDiscount) {
    if (res.storage.discountPct > 0) {
      badgeStorageDiscount.style.display = 'inline-flex';
      badgeStorageDiscount.innerHTML = `<i class="ri-percent-line"></i> ${res.storage.discountPct}% Descuento Aplicado (${formatCLP(res.storage.discountAmount)} ahorro)`;
      if (labelDiscountScaleStatus) {
        labelDiscountScaleStatus.textContent = `🎉 ¡${res.storage.discountPct}% de descuento activo!`;
        labelDiscountScaleStatus.style.color = 'var(--color-success)';
      }
    } else {
      badgeStorageDiscount.style.display = 'none';
      if (labelDiscountScaleStatus) {
        const needed = (10 - res.storage.volumeM3).toFixed(1);
        labelDiscountScaleStatus.textContent = `Alcanza 10 m³ (te faltan ${needed} m³) para 18% OFF`;
        labelDiscountScaleStatus.style.color = 'var(--color-accent)';
      }
    }
  }

  // 3. Resumen Sticky (Columna Derecha)
  const summaryTierBadge = document.getElementById('summary-tier-badge');
  if (summaryTierBadge) summaryTierBadge.textContent = `Rango ${res.activeRange.id}`;

  // Desglose Almacenamiento
  const summaryStorageSub = document.getElementById('summary-storage-subtext');
  const summaryStorageVal = document.getElementById('summary-storage-val');
  if (summaryStorageSub) {
    const discountInfo = res.storage.discountPct > 0 ? ` (-${res.storage.discountPct}%)` : '';
    summaryStorageSub.textContent = `${res.storage.volumeM3.toFixed(2)} m³ × ${formatCLP(res.storage.baseRatePerM3)}${discountInfo}`;
  }
  if (summaryStorageVal) summaryStorageVal.textContent = formatCLP(res.storage.netCost);

  // Desglose Pick & Pack
  const summaryPickPackSub = document.getElementById('summary-pickpack-subtext');
  const summaryPickPackVal = document.getElementById('summary-pickpack-val');
  if (summaryPickPackSub) {
    summaryPickPackSub.textContent = `${res.pickPack.monthlyOrders} pedidos × ${formatCLP(res.pickPack.unitCost)}`;
  }
  if (summaryPickPackVal) summaryPickPackVal.textContent = formatCLP(res.pickPack.totalCost);

  // Desglose Costo Fijo
  const rowFixedFee = document.getElementById('row-fixed-fee');
  const summaryFixedFeeSub = document.getElementById('summary-fixedfee-subtext');
  const summaryFixedFeeVal = document.getElementById('summary-fixedfee-val');
  if (rowFixedFee && summaryFixedFeeSub && summaryFixedFeeVal) {
    if (res.fixedFee.isExempt) {
      rowFixedFee.classList.add('exempt');
      summaryFixedFeeSub.textContent = res.fixedFee.reason;
      summaryFixedFeeVal.textContent = '$0 (Exento)';
    } else {
      rowFixedFee.classList.remove('exempt');
      summaryFixedFeeSub.textContent = `${res.fixedFee.uf} UF (${res.fixedFee.reason})`;
      summaryFixedFeeVal.textContent = formatCLP(res.fixedFee.clp);
    }
  }

  // Actualizar Badge de Tarifa Regional Estimada
  const badgeRegionalRate = document.getElementById('badge-regional-courier-rate');
  if (badgeRegionalRate && res.shipping.regionalAvgCourierRate) {
    badgeRegionalRate.textContent = `Tarifa promedio: ~${formatCLP(res.shipping.regionalAvgCourierRate)} + IVA / envío (${res.shipping.activeWeightBracket?.cheapest_courier || 'Starken'})`;
  }

  // Desglose Despachos
  const rowShipping = document.getElementById('row-shipping');
  const summaryShippingSub = document.getElementById('summary-shipping-subtext');
  const summaryShippingVal = document.getElementById('summary-shipping-val');
  if (rowShipping && summaryShippingSub && summaryShippingVal) {
    if (res.shipping.totalCost > 0) {
      rowShipping.style.display = 'flex';
      const parts = [];
      if (res.shipping.shipmentsSameDay > 0) {
        parts.push(`${res.shipping.shipmentsSameDay} RM Same Day`);
      }
      if (res.shipping.shipmentsCourier > 0) {
        parts.push(`${res.shipping.shipmentsCourier} Regiones (${res.shipping.activeWeightBracket?.label || '1 a 3 kg'})`);
      }
      if (res.shipping.pickupsExpress > 0) {
        parts.push(`${res.shipping.pickupsExpress} Retiros Express`);
      }
      summaryShippingSub.textContent = parts.join(' + ') || 'Envíos RM y Couriers proyectados';
      summaryShippingVal.textContent = formatCLP(res.shipping.totalCost);
    } else {
      rowShipping.style.display = 'none';
    }
  }

  // Desglose Extras
  const rowExtras = document.getElementById('row-extras');
  const summaryExtrasSub = document.getElementById('summary-extras-subtext');
  const summaryExtrasVal = document.getElementById('summary-extras-val');
  if (rowExtras && summaryExtrasSub && summaryExtrasVal) {
    if (res.extras.totalCost > 0) {
      rowExtras.style.display = 'flex';
      summaryExtrasSub.textContent = `Insumos y servicios sucursal`;
      summaryExtrasVal.textContent = formatCLP(res.extras.totalCost);
    } else {
      rowExtras.style.display = 'none';
    }
  }

  // Totales
  const summaryNetTotal = document.getElementById('summary-net-total');
  if (summaryNetTotal) summaryNetTotal.textContent = formatCLP(res.totals.netMonthly);

  const summaryIvaGross = document.getElementById('summary-iva-gross-text');
  if (summaryIvaGross) {
    summaryIvaGross.innerHTML = `+ IVA 19% (${formatCLP(res.totals.ivaMonthly)}) = <strong>${formatCLP(res.totals.grossMonthly)} IVA Inc.</strong>`;
  }

  const summaryCostPerOrder = document.getElementById('summary-cost-per-order');
  if (summaryCostPerOrder) {
    summaryCostPerOrder.textContent = `${formatCLP(res.totals.costPerOrderNet)} + IVA`;
  }

  // Enlace de WhatsApp
  const btnWhatsApp = document.getElementById('btn-quote-whatsapp');
  if (btnWhatsApp) {
    btnWhatsApp.href = generateWhatsAppLink(res);
  }

  // Enlaces a Presentaciones Oficiales
  const btnPresFulfillment = document.getElementById('btn-pres-fulfillment-link');
  if (btnPresFulfillment) {
    btnPresFulfillment.href = res.presentations?.fulfillment_url || 'https://wms.stocka.cl/downloads/presentacion_fulfillment_360.pdf';
  }

  const btnPresDespachos = document.getElementById('btn-pres-despachos-link');
  if (btnPresDespachos) {
    btnPresDespachos.href = res.presentations?.despachos_rm_url || 'https://wms.stocka.cl/downloads/presentacion_despachos_rm.pdf';
  }
}

/**
 * Envío de lead y cotización a Supabase
 */
async function handleLeadSubmission(e) {
  e.preventDefault();
  const alertContainer = document.getElementById('lead-modal-alert');
  const btnSubmit = e.target.querySelector('button[type="submit"]');

  const company = document.getElementById('lead-company')?.value.trim();
  const name = document.getElementById('lead-name')?.value.trim();
  const email = document.getElementById('lead-email')?.value.trim();
  const phone = document.getElementById('lead-phone')?.value.trim();

  if (!company || !name || !email || !phone) {
    if (alertContainer) {
      alertContainer.innerHTML = `<div class="alert alert-danger" style="padding: 0.5rem; margin-top: 0.5rem; font-size: 0.82rem;">Por favor, completa todos los campos requeridos.</div>`;
    }
    return;
  }

  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> Generando y enviando cotización...`;
  }

  try {
    const contactObj = { name, company, email, phone };

    // 1. Enviar correo formal con Brevo API
    let emailSent = false;
    try {
      if (btnSubmit) btnSubmit.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> Enviando correo a ${email}...`;
      await sendQuoteEmailViaBrevo(currentQuoteResult, contactObj);
      emailSent = true;
      console.log('✅ Correo de cotización enviado exitosamente vía Brevo');
    } catch (mailErr) {
      console.warn("Aviso al enviar correo vía Brevo:", mailErr);
    }

    // 2. Guardar registro en Supabase (si la tabla está disponible)
    try {
      const supabaseClient = window.supabaseClient || (window.supabase ? window.supabase.createClient('https://ejtjfaucnxbikrwjwwdu.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MzExODUsImV4cCI6MjA5NTQwNzE4NX0.cnuyxOpbqr-182Q3MJFJu0prtFSvwk1RgbiVBhjYUak') : null);

      const leadPayload = {
        company_name: company,
        contact_name: name,
        email: email,
        phone: phone,
        monthly_orders: currentQuoteResult?.pickPack?.monthlyOrders || 0,
        estimated_volume: currentQuoteResult?.storage?.volumeM3 || 0,
        quote_data: currentQuoteResult || {},
        estimated_monthly_net: currentQuoteResult?.totals?.netMonthly || 0,
        status: 'nuevo'
      };

      // Guardar en localStorage como respaldo inmediato
      try {
        const localLeads = JSON.parse(localStorage.getItem('stocka_wms_quote_leads_cache') || '[]');
        localLeads.unshift({
          ...leadPayload,
          id: 'lead_' + Date.now(),
          created_at: new Date().toISOString()
        });
        localStorage.setItem('stocka_wms_quote_leads_cache', JSON.stringify(localLeads.slice(0, 100)));
      } catch (lsErr) {
        console.warn("Aviso guardando en localStorage:", lsErr);
      }

      if (supabaseClient) {
        await supabaseClient.from('quote_leads').insert([leadPayload]);
      }
    } catch (dbErr) {
      console.warn("Aviso guardando en quote_leads:", dbErr);
    }

    // 3. Actualizar enlace de WhatsApp con los datos del contacto
    const btnWhatsApp = document.getElementById('btn-quote-whatsapp');
    if (btnWhatsApp && currentQuoteResult) {
      btnWhatsApp.href = generateWhatsAppLink(currentQuoteResult, contactObj);
    }

    if (alertContainer) {
      alertContainer.innerHTML = `
        <div class="alert alert-success" style="padding: 0.85rem; margin-top: 0.75rem; font-size: 0.85rem; border-radius: var(--radius-md); line-height: 1.4;">
          <i class="ri-checkbox-circle-fill" style="font-size: 1.1rem; vertical-align: middle;"></i> <strong>¡Cotización enviada exitosamente!</strong><br>
          Hemos enviado el desglose formal a <strong>${email}</strong>.<br>
          <small style="color: var(--color-text-muted);">Revisa tu bandeja de entrada (y la carpeta de spam o promociones si no lo ves de inmediato).</small>
        </div>
      `;
    }

    setTimeout(() => {
      const modal = document.getElementById('email-quote-modal');
      if (modal) modal.classList.remove('open');
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = `<i class="ri-send-plane-fill"></i> Guardar y Enviar Cotización`;
      }
    }, 4000);

  } catch (err) {
    console.error("Error general en proceso de cotización:", err);
    if (alertContainer) {
      alertContainer.innerHTML = `<div class="alert alert-danger" style="padding: 0.5rem; margin-top: 0.5rem; font-size: 0.82rem;">Hubo un problema al procesar el envío: ${err.message}. También puedes contactarnos directo por WhatsApp.</div>`;
    }
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = `<i class="ri-send-plane-fill"></i> Guardar y Enviar Cotización`;
    }
  }
}
