import supabaseInstance from './supabase.js';

/**
 * WMS STOCKA - Módulo de Punto de Ventas (POS Sucursal Ñuñoa) para Administradores
 * 
 * Permite registrar ventas presenciales de cualquier comercio en la sucursal física de Ñuñoa,
 * integrando catálogo de productos, validación de stock disponible, generación de orden en el
 * gestor de pedidos, descuento de inventario físico y trazabilidad de movimientos.
 */

// Asegurar instancia de cliente Supabase de la aplicación con fallback seguro
const supabase = (supabaseInstance && typeof supabaseInstance.from === 'function')
  ? supabaseInstance
  : (window.supabaseClient && typeof window.supabaseClient.from === 'function' ? window.supabaseClient : supabaseInstance);

// Variables de Estado Global
let posCurrentPage = 1;
const posPageSize = 50;
window.posCatalogProducts = [];
window.posSelectedCommerceConfig = null;
window.posCurrentStep = 1;

// ID y Datos de la Sucursal Física Matriz Ñuñoa
const SUCURSAL_NUNOA_WH_ID = '973da888-8a63-4790-a08f-919e1af41a93';
const SUCURSAL_NUNOA_NAME = 'Matriz Ñuñoa';
const SUCURSAL_NUNOA_ADDRESS = 'Campo de Deportes 405, Ñuñoa';

// Helper de formateo de moneda CLP
function formatCLP(amount) {
  if (amount === undefined || amount === null || isNaN(amount)) return '$0';
  return '$' + Math.round(amount).toLocaleString('es-CL');
}

// Helper para escapar HTML
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ====== HELPERS VISUALES Y CONTRASTE PARA COLOR Y MÁQUINA DE PUNTO DE VENTA (POS) ======
if (!window.getPosColorLuminance) {
  window.getPosColorLuminance = function(hex) {
    if (!hex) return 0.5;
    let c = String(hex).replace('#', '').trim();
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    if (c.length !== 6) return 0.5;
    const num = parseInt(c, 16);
    if (isNaN(num)) return 0.5;
    const r = ((num >> 16) & 255) / 255;
    const g = ((num >> 8) & 255) / 255;
    const b = (num & 255) / 255;
    const a = [r, g, b].map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
  };
}

if (!window.getPosContrastTextColor) {
  window.getPosContrastTextColor = function(hex) {
    const lum = (typeof window.getPosColorLuminance === 'function') ? window.getPosColorLuminance(hex) : 0.5;
    return lum > 0.38 ? '#0f172a' : '#ffffff';
  };
}

if (!window.getPosReadableTextColor) {
  window.getPosReadableTextColor = function(hex) {
    if (!hex) return '#2563eb';
    const lum = (typeof window.getPosColorLuminance === 'function') ? window.getPosColorLuminance(hex) : 0.5;
    if (lum < 0.30) return hex;

    let c = String(hex).replace('#', '').trim();
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    if (c.length !== 6) return '#1e293b';
    const num = parseInt(c, 16);
    if (isNaN(num)) return '#1e293b';
    let r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;

    const rawDiff = Math.max(r, g, b) - Math.min(r, g, b);
    if (rawDiff <= 25) return '#334155';

    const rNorm = r / 255, gNorm = g / 255, bNorm = b / 255;
    const max = Math.max(rNorm, gNorm, bNorm), min = Math.min(rNorm, gNorm, bNorm);
    const d = max - min;
    let h = 0;
    if (d > 0) {
      if (max === rNorm) h = ((gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)) / 6;
      else if (max === gNorm) h = ((bNorm - rNorm) / d + 2) / 6;
      else h = ((rNorm - gNorm) / d + 4) / 6;
    }

    let targetL = 0.30;
    if (h > 0.10 && h < 0.45) targetL = 0.24;

    const s = 0.85;
    const q = targetL < 0.5 ? targetL * (1 + s) : targetL + s - targetL * s;
    const p = 2 * targetL - q;
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const rFinal = Math.round(hue2rgb(p, q, h + 1/3) * 255);
    const gFinal = Math.round(hue2rgb(p, q, h) * 255);
    const bFinal = Math.round(hue2rgb(p, q, h - 1/3) * 255);

    return '#' + [rFinal, gFinal, bFinal].map(x => x.toString(16).padStart(2, '0')).join('');
  };
}

// Helper para generar icono SVG de máquina POS con color dinámico y contraste automático
window.getPosMachineSvg = function(colorHex = '#2563eb', size = 24) {
  const safeColor = (colorHex || '#2563eb').trim();
  const lum = (typeof window.getPosColorLuminance === 'function') ? window.getPosColorLuminance(safeColor) : 0.5;
  const isLight = lum > 0.40;

  const strokeColor = isLight ? 'rgba(0, 0, 0, 0.28)' : 'rgba(15, 23, 42, 0.85)';
  const slotColor = isLight ? '#0f172a' : '#ffffff';
  const slotOpacity = isLight ? '0.35' : '0.6';
  const keypadDotFill = isLight ? '#0f172a' : '#ffffff';
  const keypadDotOpacity = isLight ? '0.75' : '0.9';
  const bottomSlotOpacity = isLight ? '0.30' : '0.5';

  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: inline-block; vertical-align: middle; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.18)); flex-shrink: 0;">
    <!-- POS Terminal Main Body with chosen color -->
    <rect x="4.5" y="1.5" width="15" height="21" rx="2.8" fill="${safeColor}" stroke="${strokeColor}" stroke-width="0.8" />
    
    <!-- Top Receipt/Card slot indicator -->
    <rect x="7" y="2.5" width="10" height="0.8" rx="0.4" fill="${slotColor}" fill-opacity="${slotOpacity}" />
    
    <!-- Digital Screen -->
    <rect x="6.8" y="4.2" width="10.4" height="6.6" rx="1.2" fill="#0f172a" />
    <!-- Screen Glass Shine / Reflection -->
    <rect x="7.4" y="4.8" width="9.2" height="5.4" rx="0.8" fill="#1e293b" />
    <!-- Screen Content: Amount line & Card reader indicator -->
    <rect x="8.5" y="5.8" width="4.5" height="1.1" rx="0.55" fill="#38bdf8" />
    <rect x="8.5" y="7.5" width="7" height="1.6" rx="0.6" fill="#10b981" />
    
    <!-- Keypad Matrix (3x3 numeric keypad) -->
    <circle cx="8.2" cy="12.6" r="0.75" fill="${keypadDotFill}" fill-opacity="${keypadDotOpacity}" />
    <circle cx="12" cy="12.6" r="0.75" fill="${keypadDotFill}" fill-opacity="${keypadDotOpacity}" />
    <circle cx="15.8" cy="12.6" r="0.75" fill="${keypadDotFill}" fill-opacity="${keypadDotOpacity}" />
    <circle cx="8.2" cy="14.6" r="0.75" fill="${keypadDotFill}" fill-opacity="${keypadDotOpacity}" />
    <circle cx="12" cy="14.6" r="0.75" fill="${keypadDotFill}" fill-opacity="${keypadDotOpacity}" />
    <circle cx="15.8" cy="14.6" r="0.75" fill="${keypadDotFill}" fill-opacity="${keypadDotOpacity}" />
    <circle cx="8.2" cy="16.6" r="0.75" fill="${keypadDotFill}" fill-opacity="${keypadDotOpacity}" />
    <circle cx="12" cy="16.6" r="0.75" fill="${keypadDotFill}" fill-opacity="${keypadDotOpacity}" />
    <circle cx="15.8" cy="16.6" r="0.75" fill="${keypadDotFill}" fill-opacity="${keypadDotOpacity}" />
    
    <!-- POS Function Buttons (Red Cancel, Yellow Clear, Green OK/Enter) -->
    <rect x="7.2" y="18.4" width="2.6" height="1.1" rx="0.5" fill="#ef4444" />
    <rect x="10.7" y="18.4" width="2.6" height="1.1" rx="0.5" fill="#eab308" />
    <rect x="14.2" y="18.4" width="2.6" height="1.1" rx="0.5" fill="#22c55e" />
    
    <!-- Bottom Chip Card Insertion Slot -->
    <rect x="8" y="20.7" width="8" height="0.7" rx="0.35" fill="${slotColor}" fill-opacity="${bottomSlotOpacity}" />
  </svg>`;
};

// Helper para resolver color de máquina POS
if (!window.resolvePosMachineColor) {
  window.resolvePosMachineColor = function(colorStr, colorHexStr) {
    if (colorHexStr && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(colorHexStr.trim())) {
      return colorHexStr.trim();
    }
    if (colorStr && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(colorStr.trim())) {
      return colorStr.trim();
    }
    const clean = (colorStr || '').trim().toLowerCase();
    if (!clean) return '#2563eb';

    const colorMap = [
      { keys: ['rojo', 'red', 'granate', 'carmesi'], hex: '#dc2626' },
      { keys: ['azul', 'blue', 'marino', 'navy'], hex: '#2563eb' },
      { keys: ['celeste', 'cyan', 'turquesa', 'sky'], hex: '#0284c7' },
      { keys: ['naranja', 'orange', 'anaranjado'], hex: '#ea580c' },
      { keys: ['negro', 'black', 'oscuro'], hex: '#1e293b' },
      { keys: ['verde', 'green', 'oliva', 'lima'], hex: '#16a34a' },
      { keys: ['amarillo', 'yellow', 'dorado', 'gold'], hex: '#ca8a04' },
      { keys: ['morado', 'purple', 'violeta', 'purpura', 'lila'], hex: '#7c3aed' },
      { keys: ['rosa', 'rosado', 'pink', 'fucsia', 'magenta'], hex: '#db2777' },
      { keys: ['gris', 'plomo', 'gray', 'grey', 'plateado', 'silver'], hex: '#64748b' },
      { keys: ['blanco', 'white', 'crema', 'claro'], hex: '#f8fafc' }
    ];

    for (const entry of colorMap) {
      if (entry.keys.some(k => clean === k || clean.includes(k))) {
        return entry.hex;
      }
    }
    return '#2563eb';
  };
}

// Listado maestro de medios de pago POS y helper de medios activos por comercio (por defecto todos activos)
if (!window.POS_PAYMENT_METHODS_LIST) {
  window.POS_PAYMENT_METHODS_LIST = [
    { id: 'debito', value: 'Tarjeta de Débito', label: 'Tarjeta de Débito', subtitle: 'Redcompra POS', icon: 'ri-bank-card-line' },
    { id: 'credito', value: 'Tarjeta de Crédito', label: 'Tarjeta de Crédito', subtitle: 'Cuotas / POS', icon: 'ri-bank-card-2-line' },
    { id: 'efectivo', value: 'Efectivo', label: 'Efectivo', subtitle: 'Pago en caja física', icon: 'ri-money-dollar-circle-line' },
    { id: 'transferencia', value: 'Transferencia', label: 'Transferencia', subtitle: 'Comprobante bancario', icon: 'ri-exchange-dollar-line' }
  ];
}

if (!window.getMerchantActivePosPaymentMethods) {
  window.getMerchantActivePosPaymentMethods = function(onboardingChecklist) {
    const allValues = (window.POS_PAYMENT_METHODS_LIST || []).map(m => m.value);
    const configured = onboardingChecklist?.pos_payment_methods;
    if (Array.isArray(configured) && configured.length > 0) {
      const valid = allValues.filter(v => configured.includes(v));
      if (valid.length > 0) return valid;
    }
    return allValues;
  };
}

window.resolvePosCommerceConfig = function(commerceName) {
  const clean = (commerceName || document.getElementById('pos-select-commerce')?.value || '').trim();
  if (!clean) return null;
  if (window.posSelectedCommerceConfig && (!window.posSelectedCommerceConfig.comercio || window.posSelectedCommerceConfig.comercio.trim().toLowerCase() === clean.toLowerCase())) {
    return window.posSelectedCommerceConfig;
  }
  if (window.posCommerceConfigsMap) {
    const foundKey = Object.keys(window.posCommerceConfigsMap).find(k => k.trim().toLowerCase() === clean.toLowerCase());
    if (foundKey) return window.posCommerceConfigsMap[foundKey];
  }
  if (window.loadedCommerceConfigsMap) {
    const foundKey = Object.keys(window.loadedCommerceConfigsMap).find(k => k.trim().toLowerCase() === clean.toLowerCase());
    if (foundKey) return window.loadedCommerceConfigsMap[foundKey];
  }
  if (window.cachedAdminMerchants) {
    const foundM = window.cachedAdminMerchants.find(m => (m.nombre || '').trim().toLowerCase() === clean.toLowerCase());
    if (foundM) {
      return {
        comercio: foundM.nombre,
        inventario_seguimiento: Boolean(foundM.inventario_seguimiento),
        onboarding_checklist: foundM.onboarding_checklist || {}
      };
    }
  }
  return window.posSelectedCommerceConfig || null;
};

// ====== MOTOR DE CÁLCULO POS: MÁQUINA DE PAGO, COMISIONES (+IVA), PAGO SELLER Y PERIODO ABONO ======
window.POS_MONTH_NAMES_ES = [
  'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
];

window.derivePosPeriodFromDate = function(dateVal) {
  const d = dateVal ? new Date(dateVal) : new Date();
  if (isNaN(d.getTime())) {
    const now = new Date();
    return `${window.POS_MONTH_NAMES_ES[now.getMonth()]} ${now.getFullYear()}`;
  }
  return `${window.POS_MONTH_NAMES_ES[d.getMonth()]} ${d.getFullYear()}`;
};

window.cleanPosSaleComments = function(rawComments) {
  if (!rawComments) return '';
  return String(rawComments)
    .replace(/\[WMS-ORD:\s*[^\]]+\]/gi, '')
    .replace(/\[Terminal:\s*[^\]]+\]/gi, '')
    .replace(/\[ABONO-PER:\s*[^\]]+\]/gi, '')
    .replace(/\[TX-CODE:\s*[^\]]+\]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

window.sanitizePosTransactionCode = function(rawCode) {
  return String(rawCode || '').replace(/\s+/g, '').trim().toUpperCase();
};

window.resolvePosSaleTransactionCode = function(sale, linkedOrder = null) {
  if (sale?.codigo_transaccion && String(sale.codigo_transaccion).trim()) {
    return window.sanitizePosTransactionCode(sale.codigo_transaccion);
  }
  const match = String(sale?.comentarios || '').match(/\[TX-CODE:\s*([^\]]+)\]/i);
  if (match && match[1]) {
    return window.sanitizePosTransactionCode(match[1]);
  }
  if (linkedOrder?.raw_shopify_data?.pos_tx_code) {
    return window.sanitizePosTransactionCode(linkedOrder.raw_shopify_data.pos_tx_code);
  }
  return '';
};

window.buildPosSaleCommentsWithTags = function(cleanComment, existingRawComment, overrides = {}) {
  const raw = String(existingRawComment || '');
  const baseClean = (cleanComment !== undefined && cleanComment !== null)
    ? window.cleanPosSaleComments(cleanComment)
    : window.cleanPosSaleComments(raw);

  const ordMatch = raw.match(/\[WMS-ORD:\s*([^\]]+)\]/i);
  const termMatch = raw.match(/\[Terminal:\s*([^\]]+)\]/i);
  const abonoMatch = raw.match(/\[ABONO-PER:\s*([^\]]+)\]/i);
  const txMatch = raw.match(/\[TX-CODE:\s*([^\]]+)\]/i);

  const wmsOrdOverride = overrides.wmsOrderId !== undefined ? overrides.wmsOrderId : overrides.orderId;
  const termOverride = overrides.terminal !== undefined ? overrides.terminal : overrides.terminalLabel;
  const txOverride = overrides.txCode !== undefined ? overrides.txCode : overrides.transactionCode;

  const wmsOrd = wmsOrdOverride !== undefined ? wmsOrdOverride : (ordMatch ? ordMatch[1].trim() : '');
  const terminal = termOverride !== undefined ? termOverride : (termMatch ? termMatch[1].trim() : '');
  const abonoPeriod = overrides.abonoPeriod !== undefined ? overrides.abonoPeriod : (abonoMatch ? abonoMatch[1].trim() : '');
  const txCode = txOverride !== undefined ? window.sanitizePosTransactionCode(txOverride) : (txMatch ? window.sanitizePosTransactionCode(txMatch[1]) : '');

  const tags = [];
  if (wmsOrd) tags.push(`[WMS-ORD: ${wmsOrd}]`);
  if (terminal) tags.push(`[Terminal: ${terminal}]`);
  if (abonoPeriod) tags.push(`[ABONO-PER: ${abonoPeriod}]`);
  if (txCode) tags.push(`[TX-CODE: ${txCode}]`);

  return [baseClean, ...tags].filter(Boolean).join(' ').trim();
};

// Verificar si un código de transacción ya fue utilizado en otra venta POS (único e irrepetible)
window.checkPosTransactionCodeDuplicate = async function(rawCode, excludeSaleId = null) {
  const cleanCode = window.sanitizePosTransactionCode(rawCode);
  if (!cleanCode) {
    return { isDuplicate: false, conflictingSale: null, cleanCode: '' };
  }

  // 1. Revisar en memoria primero (posAllLoadedSales y posSalesCache)
  const memoryCandidates = [];
  if (Array.isArray(window.posAllLoadedSales)) {
    memoryCandidates.push(...window.posAllLoadedSales);
  }
  if (window.posSalesCache && typeof window.posSalesCache.values === 'function') {
    for (const s of window.posSalesCache.values()) {
      if (s && s.id) memoryCandidates.push(s);
    }
  }

  const seenIds = new Set();
  for (const s of memoryCandidates) {
    if (!s || !s.id || seenIds.has(String(s.id))) continue;
    seenIds.add(String(s.id));
    if (excludeSaleId !== null && excludeSaleId !== undefined && String(s.id) === String(excludeSaleId)) continue;
    const existingTx = window.resolvePosSaleTransactionCode(s);
    if (existingTx && existingTx.toUpperCase() === cleanCode) {
      return { isDuplicate: true, conflictingSale: s, cleanCode };
    }
  }

  // 2. Consultar en base de datos store_sales para garantizar unicidad global histórica
  try {
    const { data: dbMatches } = await supabase
      .from('store_sales')
      .select('id, codigo_venta, comercio, created_at, comentarios, monto_total, nombre_cliente')
      .ilike('comentarios', `%[TX-CODE:%`);

    if (Array.isArray(dbMatches)) {
      for (const row of dbMatches) {
        if (!row || !row.id) continue;
        if (excludeSaleId !== null && excludeSaleId !== undefined && String(row.id) === String(excludeSaleId)) continue;
        const rowTx = window.resolvePosSaleTransactionCode(row);
        if (rowTx && rowTx.toUpperCase() === cleanCode) {
          return { isDuplicate: true, conflictingSale: row, cleanCode };
        }
      }
    }
  } catch (err) {
    console.warn('Aviso consultando unicidad de código de transacción POS:', err);
  }

  return { isDuplicate: false, conflictingSale: null, cleanCode };
};

// Resolver máquina POS utilizada según comercio, pedido vinculado y comentarios
window.resolvePosSaleMachineInfo = function(sale, commerceConfigsMap = null, linkedOrder = null) {
  const comercio = String(sale?.comercio || '').trim();
  const cfgMap = commerceConfigsMap || window.posCommerceConfigsMap || window.loadedCommerceConfigsMap || {};
  let commCfg = null;

  if (comercio) {
    const key = Object.keys(cfgMap).find(k => k.trim().toLowerCase() === comercio.toLowerCase());
    if (key) commCfg = cfgMap[key];
    if (!commCfg && typeof window.resolvePosCommerceConfig === 'function') {
      commCfg = window.resolvePosCommerceConfig(comercio);
    }
  }

  const cfgMachine = commCfg?.onboarding_checklist?.pos_machine || {};
  const ordMachine = linkedOrder?.raw_shopify_data?.pos_machine || {};
  const termMatch = String(sale?.comentarios || '').match(/\[Terminal:\s*([^\]]+)\]/i);
  const termTag = termMatch ? termMatch[1].trim() : '';

  let brand = cfgMachine.brand || ordMachine.brand || '';
  let model = String(cfgMachine.model || ordMachine.model || '').replace(/^#+/, '').trim();
  let color = cfgMachine.color || ordMachine.color || '';
  let colorHex = cfgMachine.color_hex || ordMachine.color_hex || '';
  let owner = cfgMachine.owner || ordMachine.owner || '';
  let notes = cfgMachine.notes || ordMachine.notes || '';

  if (!brand && termTag) {
    const parts = termTag.split(/\s+/);
    brand = parts[0] || 'STOCKA POS';
    if (!model && parts.length > 1) {
      model = parts.slice(1).join(' ').replace(/^#+/, '').trim();
    }
  }

  const modoPago = String(sale?.modo_pago || '').trim();
  const modoLower = modoPago.toLowerCase();
  const isCredit = modoLower.includes('crédito') || modoLower.includes('credito');
  const isDebit = !isCredit && (modoLower.includes('débito') || modoLower.includes('debito') || modoLower.includes('tarjeta') || modoLower.includes('redcompra'));
  const isCardPayment = isCredit || isDebit;
  const isTransferPayment = modoLower.includes('transferencia');
  const isCashPayment = modoLower.includes('efectivo');

  const ownerUpper = String(owner || '').toUpperCase();
  const brandUpper = String(brand || '').toUpperCase();

  let isStockaMachine = true;
  if (ownerUpper) {
    if (ownerUpper.includes('STOCKA')) {
      isStockaMachine = true;
    } else if (
      ownerUpper.includes('PROPIEDAD DE') ||
      ownerUpper.includes('COMERCIO') ||
      ownerUpper.includes('PROPIO') ||
      ownerUpper.includes('CLIENTE') ||
      (comercio && ownerUpper.includes(comercio.toUpperCase()))
    ) {
      isStockaMachine = false;
    }
  } else if (brandUpper.includes('STOCKA')) {
    isStockaMachine = true;
  }

  const ownerLabel = owner
    ? owner
    : (isStockaMachine ? 'Propiedad de STOCKA' : `Propiedad de ${comercio || 'Comercio'}`);

  const resolvedHex = (typeof window.resolvePosMachineColor === 'function')
    ? window.resolvePosMachineColor(color, colorHex)
    : '#2563eb';

  const displayBrand = brand || (isStockaMachine ? 'POS STOCKA' : `POS ${comercio || 'Comercio'}`);
  const displayModel = model ? `#${model}` : '';
  const fullLabel = [displayBrand, displayModel, color ? `(${color})` : ''].filter(Boolean).join(' ');

  return {
    comercio,
    brand: displayBrand,
    rawBrand: brand,
    model: model,
    displayModel,
    color: color || '',
    colorHex: resolvedHex,
    owner: ownerLabel,
    isStockaMachine,
    isStockaOwned: isStockaMachine,
    notes,
    posActive: Boolean(commCfg?.onboarding_checklist?.pos_active ?? true),
    isCardPayment,
    isCardSale: isCardPayment,
    isCredit,
    isDebit,
    isTransferPayment,
    isCashPayment,
    fullLabel
  };
};

// Calcular comisión POS (+ IVA) y pago/abono neto al seller
window.calculatePosSaleFinancials = function(sale, machineInfo = null, pricingConfig = null) {
  const mInfo = machineInfo || window.resolvePosSaleMachineInfo(sale);
  const grossAmount = Math.max(0, Math.round(Number(sale?.monto_total) || 0));

  const servicesCfg = pricingConfig?.services || window.posPricingServicesConfig || {};
  const debitPct = Number(servicesCfg.pos_fee_debit_pct ?? 2.5);
  const creditPct = Number(servicesCfg.pos_fee_credit_pct ?? 3.5);
  const monthlyUf = Number(servicesCfg.pos_monthly_uf ?? 0.2);

  const isCard = Boolean(mInfo.isCardPayment);
  const isCredit = Boolean(mInfo.isCredit);
  const isDebit = Boolean(mInfo.isDebit);
  const isStockaMachine = Boolean(mInfo.isStockaMachine);

  // Cuando la máquina es propiedad de STOCKA y el cobro es con tarjeta, aplica comisión vigente (+ IVA)
  const appliesStockaCommission = isStockaMachine && isCard;
  const commissionPct = appliesStockaCommission ? (isCredit ? creditPct : debitPct) : 0;
  const commissionNet = appliesStockaCommission ? Math.round(grossAmount * (commissionPct / 100)) : 0;
  const commissionIva = appliesStockaCommission ? Math.round(commissionNet * 0.19) : 0;
  const commissionTotal = commissionNet + commissionIva;
  const sellerPayout = Math.max(0, grossAmount - commissionTotal);

  let reasonLabel = 'Pago al Seller / Abono Fulfillment';
  if (!appliesStockaCommission) {
    reasonLabel = !isCard
      ? `Recaudación Directa (${sale?.modo_pago || 'Efectivo / Transferencia'})`
      : `Terminal Propio (${mInfo.comercio || 'Seller'})`;
  }

  return {
    grossAmount,
    montoTotal: grossAmount,
    isCard,
    isCredit,
    isDebit,
    isStockaMachine,
    appliesStockaCommission,
    appliesStockaPosSettlement: appliesStockaCommission,
    commissionPct,
    feePct: commissionPct,
    commissionTypeLabel: isCredit ? 'Crédito' : (isDebit ? 'Débito' : (sale?.modo_pago || 'Otro')),
    commissionNet,
    commissionIva,
    commissionTotal,
    sellerPayout,
    reasonLabel,
    debitPct,
    creditPct,
    monthlyUf
  };
};

// Resolver el periodo de facturación en que la venta POS se considera como abono al servicio de fulfillment
window.resolvePosSaleAbonoPeriod = function(sale, linkedOrder = null, machineInfo = null, financials = null) {
  const mInfo = machineInfo || window.resolvePosSaleMachineInfo(sale, null, linkedOrder);
  const fin = financials || window.calculatePosSaleFinancials(sale, mInfo);

  // 1. Revisar si tiene asignación explícita en columna, comentario [ABONO-PER: ...] o raw_shopify_data
  let explicitVal = '';
  if (sale?.periodo_abono && String(sale.periodo_abono).trim()) {
    explicitVal = String(sale.periodo_abono).trim();
  } else {
    const match = String(sale?.comentarios || '').match(/\[ABONO-PER:\s*([^\]]+)\]/i);
    if (match && match[1]) {
      explicitVal = match[1].trim();
    } else if (linkedOrder?.raw_shopify_data?.pos_abono_period) {
      explicitVal = String(linkedOrder.raw_shopify_data.pos_abono_period).trim();
    }
  }

  const upperExp = explicitVal.toUpperCase();
  if (upperExp === 'PAGO_DIRECTO' || upperExp === 'SIN_ABONO' || upperExp === 'NO_ABONAR') {
    return {
      period: 'PAGO_DIRECTO',
      label: 'Pago Directo Seller (Sin Abono)',
      isAbono: false,
      isExplicit: true
    };
  }
  if (upperExp === 'RECAUDACION_COMERCIO' || upperExp === 'MAQUINA_PROPIA') {
    return {
      period: 'RECAUDACION_COMERCIO',
      label: 'Recaudación Directa Comercio',
      isAbono: false,
      isExplicit: true
    };
  }
  if (upperExp === 'SIN_ASIGNAR' || upperExp === 'PENDIENTE') {
    return {
      period: 'SIN_ASIGNAR',
      label: 'Pendiente de Asignar',
      isAbono: false,
      isExplicit: true
    };
  }
  if (upperExp) {
    return {
      period: upperExp,
      label: upperExp,
      isAbono: true,
      isExplicit: true
    };
  }

  // 2. Por defecto: si la máquina es propiedad de STOCKA y fue cobrado con tarjeta, el monto recaudado se considera abono en el periodo de la venta
  if (mInfo.isStockaMachine && fin.isCard) {
    const ordPeriod = String(linkedOrder?.periodo_facturacion || '').trim().toUpperCase();
    const derivedPeriod = ordPeriod || window.derivePosPeriodFromDate(sale?.created_at);
    return {
      period: derivedPeriod,
      label: derivedPeriod,
      isAbono: true,
      isExplicit: false
    };
  }

  // Si la máquina es propia del comercio o pago en efectivo/transferencia directa al comercio
  return {
    period: 'RECAUDACION_COMERCIO',
    label: mInfo.isStockaMachine ? 'Cobro Directo Comercio' : `Terminal Propio (${mInfo.comercio || 'Seller'})`,
    isAbono: false,
    isExplicit: false
  };
};

// Cargar configuraciones POS de comercios y lista de periodos oficiales de facturación
window.ensurePosMetadataLoaded = async function(forceRefresh = false) {
  if (!forceRefresh && window.posCommerceConfigsMap && Object.keys(window.posCommerceConfigsMap).length > 0 && Array.isArray(window.posBillingPeriodsList) && window.posBillingPeriodsList.length > 0) {
    return {
      commerceConfigsMap: window.posCommerceConfigsMap,
      billingPeriodsList: window.posBillingPeriodsList
    };
  }

  window.posCommerceConfigsMap = window.posCommerceConfigsMap || {};
  window.posBillingPeriodsList = window.posBillingPeriodsList || [];

  try {
    const [cacRes, bpRes] = await Promise.all([
      supabase.from('comercios_adicional_config').select('comercio, sigla, rut, razon_social, inventario_seguimiento, onboarding_checklist'),
      supabase.from('billing_periods').select('id, name, period_month, period_year, status, created_at').order('period_year', { ascending: false }).order('period_month', { ascending: false })
    ]);

    if (cacRes.data && Array.isArray(cacRes.data)) {
      cacRes.data.forEach(row => {
        if (row.comercio) {
          window.posCommerceConfigsMap[row.comercio.trim()] = row;
          window.posCommerceConfigsMap[row.comercio.trim().toUpperCase()] = row;
        }
      });
    }

    if (bpRes.data && Array.isArray(bpRes.data)) {
      window.posBillingPeriodsList = bpRes.data;
    }
  } catch (e) {
    console.warn('Aviso cargando metadatos POS (comercios / periodos):', e);
  }

  return {
    commerceConfigsMap: window.posCommerceConfigsMap,
    billingPeriodsList: window.posBillingPeriodsList
  };
};

// Obtener lista de nombres de periodos disponibles (oficiales + derivados)
window.getAvailablePosBillingPeriodNames = function(extraPeriods = []) {
  const set = new Set();
  const now = new Date();
  const currentPeriodName = `${window.POS_MONTH_NAMES_ES[now.getMonth()]} ${now.getFullYear()}`;
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevPeriodName = `${window.POS_MONTH_NAMES_ES[prevDate.getMonth()]} ${prevDate.getFullYear()}`;

  (window.posBillingPeriodsList || []).forEach(p => {
    if (p && p.name) set.add(String(p.name).trim().toUpperCase());
  });
  set.add(currentPeriodName);
  set.add(prevPeriodName);
  (extraPeriods || []).forEach(ep => {
    if (ep && ep !== 'PAGO_DIRECTO' && ep !== 'RECAUDACION_COMERCIO' && ep !== 'SIN_ASIGNAR') {
      set.add(String(ep).trim().toUpperCase());
    }
  });

  return Array.from(set);
};

// Actualizar el Periodo de Facturación (Abono) de una venta POS en Supabase
window.updatePosSaleAbonoPeriod = async function(saleId, newPeriodValue, options = {}) {
  const { silent = false, skipRefresh = false } = options;
  try {
    let sale = window.posSalesCache?.get(String(saleId));
    if (!sale) {
      const { data: fetchedSale } = await supabase.from('store_sales').select('*').eq('id', saleId).maybeSingle();
      sale = fetchedSale;
    }
    if (!sale) throw new Error('No se encontró la venta POS seleccionada.');

    const cleanPeriod = String(newPeriodValue || '').trim().toUpperCase() || 'SIN_ASIGNAR';
    const updatedComments = window.buildPosSaleCommentsWithTags(null, sale.comentarios, {
      abonoPeriod: cleanPeriod
    });

    // 1. Actualizar store_sales (intentando también columna periodo_abono si existe, con fallback a comentarios)
    let updatedRow = null;
    try {
      const { data: d1, error: e1 } = await supabase
        .from('store_sales')
        .update({ comentarios: updatedComments, periodo_abono: cleanPeriod })
        .eq('id', sale.id)
        .select()
        .maybeSingle();
      if (e1) throw e1;
      updatedRow = d1;
    } catch (_) {
      const { data: d2, error: e2 } = await supabase
        .from('store_sales')
        .update({ comentarios: updatedComments })
        .eq('id', sale.id)
        .select()
        .maybeSingle();
      if (e2) throw e2;
      updatedRow = d2;
    }

    const finalSaleObj = { ...sale, ...(updatedRow || {}), comentarios: updatedComments, periodo_abono: cleanPeriod };
    sale.comentarios = updatedComments;
    sale.periodo_abono = cleanPeriod;

    // 2. Sincronizar también en el pedido vinculado en public.orders (raw_shopify_data.pos_abono_period)
    const ordMatch = String(sale.comentarios || '').match(/\[WMS-ORD:\s*([a-zA-Z0-9-]+)\]/i);
    const linkedOrdId = sale.wms_order_id || (ordMatch ? ordMatch[1].trim() : null);

    try {
      let ordRow = null;
      if (linkedOrdId) {
        const { data: oData } = await supabase.from('orders').select('id, raw_shopify_data, periodo_facturacion').eq('id', linkedOrdId).maybeSingle();
        ordRow = oData;
      } else if (sale.codigo_venta) {
        const { data: oData } = await supabase.from('orders').select('id, raw_shopify_data, periodo_facturacion').eq('external_order_number', sale.codigo_venta).maybeSingle();
        ordRow = oData;
      }

      if (ordRow) {
        const nextRaw = {
          ...(ordRow.raw_shopify_data || {}),
          pos_abono_period: cleanPeriod
        };
        const isRealPeriod = !['PAGO_DIRECTO', 'RECAUDACION_COMERCIO', 'SIN_ASIGNAR'].includes(cleanPeriod);
        const ordUpdatePayload = {
          raw_shopify_data: nextRaw,
          ...(isRealPeriod && !ordRow.periodo_facturacion ? { periodo_facturacion: cleanPeriod } : {})
        };
        await supabase.from('orders').update(ordUpdatePayload).eq('id', ordRow.id);
        if (window.posLinkedOrdersMap) {
          window.posLinkedOrdersMap.set(String(ordRow.id), { ...ordRow, ...ordUpdatePayload });
          if (sale.codigo_venta) window.posLinkedOrdersMap.set(String(sale.codigo_venta), { ...ordRow, ...ordUpdatePayload });
        }
      }
    } catch (ordSyncErr) {
      console.warn('Aviso sincronizando pos_abono_period en orders:', ordSyncErr);
    }

    if (!skipRefresh) {
      await window.syncPosSaleInMemoryAndDOM(finalSaleObj, { updatedField: 'period' });
    } else if (window.posSalesCache) {
      window.posSalesCache.set(String(sale.id), finalSaleObj);
      if (sale.codigo_venta) window.posSalesCache.set(String(sale.codigo_venta), finalSaleObj);
    }

    if (!silent && typeof Swal !== 'undefined') {
      const labelDisplay = cleanPeriod === 'PAGO_DIRECTO'
        ? 'Pago Directo al Seller (Sin abono)'
        : (cleanPeriod === 'RECAUDACION_COMERCIO'
          ? 'Recaudación Directa Comercio'
          : (cleanPeriod === 'SIN_ASIGNAR' ? 'Pendiente de Asignar' : `Abono en ${cleanPeriod}`));

      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: `Venta ${sale.codigo_venta || '#' + sale.id}`,
        text: `Periodo guardado: ${labelDisplay}`,
        showConfirmButton: false,
        returnFocus: false,
        timer: 2000
      });
    }

    return true;
  } catch (err) {
    console.error('Error actualizando periodo de abono POS:', err);
    if (!silent && typeof Swal !== 'undefined') {
      Swal.fire('Error', 'No se pudo actualizar el periodo de abono: ' + err.message, 'error');
    }
    return false;
  }
};

// Helpers de renderizado por celda para actualización in-place sin recargar la tabla
window.getPosPaymentSelectColors = function(modoPago) {
  const pagoLower = String(modoPago || '').toLowerCase();
  if (pagoLower.includes('efectivo')) {
    return {
      border: 'rgba(16, 185, 129, 0.45)',
      bg: 'rgba(16, 185, 129, 0.12)',
      color: '#047857'
    };
  }
  if (pagoLower.includes('crédito') || pagoLower.includes('credito')) {
    return {
      border: 'rgba(79, 70, 229, 0.4)',
      bg: 'rgba(79, 70, 229, 0.1)',
      color: '#4338ca'
    };
  }
  if (pagoLower.includes('tarjeta') || pagoLower.includes('débito') || pagoLower.includes('debito')) {
    return {
      border: 'rgba(37, 99, 235, 0.4)',
      bg: 'rgba(37, 99, 235, 0.1)',
      color: '#1d4ed8'
    };
  }
  if (pagoLower.includes('transferencia')) {
    return {
      border: 'rgba(245, 158, 11, 0.48)',
      bg: 'rgba(245, 158, 11, 0.14)',
      color: '#b45309'
    };
  }
  return {
    border: 'var(--color-border)',
    bg: 'var(--color-surface)',
    color: 'var(--color-text-main)'
  };
};

window.renderPosPaymentSelectHtml = function(sale) {
  const currentModo = String(sale?.modo_pago || 'Tarjeta de Débito').trim();
  const stdMethods = ['Tarjeta de Débito', 'Tarjeta de Crédito', 'Efectivo', 'Transferencia'];
  const allMethods = stdMethods.includes(currentModo) ? stdMethods : [currentModo, ...stdMethods];
  const st = window.getPosPaymentSelectColors(currentModo);

  const iconForMethod = (m) => {
    const ml = m.toLowerCase();
    if (ml.includes('efectivo')) return '💵 ';
    if (ml.includes('transferencia')) return '🏦 ';
    return '💳 ';
  };

  return `
    <select
      id="pos-payment-select-${sale.id}"
      class="form-input"
      onchange="window.updatePosSalePaymentMethod('${sale.id}', this.value)"
      style="height: 26px; padding: 0 0.45rem; font-size: 0.72rem; font-weight: 800; border-radius: 999px; border: 1px solid ${st.border}; background: ${st.bg}; color: ${st.color}; cursor: pointer; width: auto; max-width: 155px;"
      title="Cambiar método de pago (recalcula automáticamente máquina, comisión POS y abono sin mover la vista)"
    >
      ${allMethods.map(m => `
        <option value="${escapeHtml(m)}" ${currentModo === m ? 'selected' : ''}>${iconForMethod(m)}${escapeHtml(m)}</option>
      `).join('')}
    </select>
  `;
};

window.renderPosMachineColHtml = function(mInfo) {
  if (mInfo.isCardPayment) {
    const dotColor = mInfo.colorHex || '#2563eb';
    const readableColor = (typeof window.getPosReadableTextColor === 'function') ? window.getPosReadableTextColor(dotColor) : dotColor;
    const ownerBadge = mInfo.isStockaMachine
      ? `<span style="font-size: 0.68rem; font-weight: 800; color: #1d4ed8; background: rgba(37, 99, 235, 0.1); border: 1px solid rgba(37, 99, 235, 0.25); padding: 1px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px; width: fit-content;">
          <i class="ri-shield-star-line"></i> Propiedad de STOCKA
         </span>`
      : `<span style="font-size: 0.68rem; font-weight: 800; color: #6d28d9; background: rgba(139, 92, 246, 0.1); border: 1px solid rgba(139, 92, 246, 0.25); padding: 1px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px; width: fit-content;">
          <i class="ri-store-2-line"></i> ${escapeHtml(mInfo.owner)}
         </span>`;

    return `
      <div style="display: flex; align-items: center; gap: 0.5rem;">
        <div style="width: 30px; height: 30px; border-radius: 7px; background: ${dotColor}15; border: 1px solid ${dotColor}45; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
          ${window.getPosMachineSvg(dotColor, 20)}
        </div>
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
            <strong style="font-size: 0.8rem; color: var(--color-text-main);">${escapeHtml(mInfo.brand)}</strong>
            ${mInfo.displayModel ? `<span style="font-family: monospace; font-size: 0.78rem; font-weight: 900; color: ${readableColor}; background: ${dotColor}18; border: 1px solid ${dotColor}40; padding: 0 5px; border-radius: 4px;">${escapeHtml(mInfo.displayModel)}</span>` : ''}
            ${mInfo.color ? `<span style="font-size: 0.68rem; color: var(--color-text-muted); font-weight: 600;">(${escapeHtml(mInfo.color)})</span>` : ''}
          </div>
          ${ownerBadge}
        </div>
      </div>
    `;
  }
  if (mInfo.isTransferPayment) {
    return `
      <div style="display: flex; flex-direction: column; gap: 2px;">
        <span style="font-size: 0.78rem; font-weight: 700; color: #4f46e5; display: inline-flex; align-items: center; gap: 4px;">
          <i class="ri-bank-line"></i> Transferencia Bancaria
        </span>
        <span style="font-size: 0.68rem; color: var(--color-text-muted);">Cuenta directa / comprobante</span>
      </div>
    `;
  }
  return `
    <div style="display: flex; flex-direction: column; gap: 2px;">
      <span style="font-size: 0.78rem; font-weight: 700; color: #059669; display: inline-flex; align-items: center; gap: 4px;">
        <i class="ri-money-dollar-circle-line"></i> Caja Efectivo Ñuñoa
      </span>
      <span style="font-size: 0.68rem; color: var(--color-text-muted);">Retiro por comercio</span>
    </div>
  `;
};

window.renderPosSellerPayoutColHtml = function(fin) {
  if (fin.appliesStockaCommission) {
    const tooltipText = `Venta Bruta: ${formatCLP(fin.grossAmount)} | Comisión POS ${fin.commissionTypeLabel} (${fin.commissionPct}% Neto): -${formatCLP(fin.commissionNet)} | IVA Comisión (19%): -${formatCLP(fin.commissionIva)} | Total Comisión + IVA: -${formatCLP(fin.commissionTotal)} | Pago/Abono Neto al Seller: ${formatCLP(fin.sellerPayout)}`;
    return `
      <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 2px;" title="${escapeHtml(tooltipText)}">
        <strong style="color: #059669; font-size: 0.98rem; font-weight: 800; background: rgba(16, 185, 129, 0.1); padding: 1px 7px; border-radius: 5px; border: 1px solid rgba(16, 185, 129, 0.3);">
          ${formatCLP(fin.sellerPayout)}
        </strong>
        <span style="font-size: 0.7rem; color: #d97706; font-weight: 700; white-space: nowrap;">
          -${formatCLP(fin.commissionTotal)} <span style="color: var(--color-text-muted); font-weight: 600;">(${fin.commissionPct}% + IVA)</span>
        </span>
        <span style="font-size: 0.65rem; color: #047857; font-weight: 700;">
          <i class="ri-hand-coin-line"></i> Abono Fulfillment
        </span>
      </div>
    `;
  }
  return `
    <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 2px;" title="Cobro procesado directamente en máquina o cuenta del comercio. Sin comisión POS de Stocka.">
      <span style="font-size: 0.82rem; font-weight: 700; color: var(--color-text-muted);">
        ${formatCLP(fin.grossAmount)}
      </span>
      <span style="font-size: 0.68rem; color: #64748b; background: var(--color-bg); border: 1px solid var(--color-border); padding: 1px 6px; border-radius: 4px; font-weight: 600;">
        Recaudación Directa Seller
      </span>
    </div>
  `;
};

window.renderPosPeriodColHtml = function(s, linkedOrd, mInfo, fin, abonoInfo, availablePeriods = null) {
  const periodsList = availablePeriods || window.getAvailablePosBillingPeriodNames([abonoInfo.isAbono ? abonoInfo.period : null]);
  const txCode = window.resolvePosSaleTransactionCode(s, linkedOrd);
  const txInlineControlHtml = `
    <div style="display: flex; align-items: center; gap: 4px; margin-top: 2px;">
      <div style="position: relative; flex: 1; min-width: 135px;">
        <i id="pos-tx-icon-${s.id}" class="ri-hashtag" style="position: absolute; left: 6px; top: 50%; transform: translateY(-50%); font-size: 0.72rem; color: ${txCode ? '#0284c7' : '#94a3b8'}; pointer-events: none;"></i>
        <input
          type="text"
          id="pos-tx-input-${s.id}"
          value="${escapeHtml(txCode)}"
          data-original="${escapeHtml(txCode)}"
          placeholder="Cód. Transacción..."
          autocomplete="off"
          oninput="this.value = this.value.replace(/\\s+/g, '').toUpperCase();"
          onchange="window.saveInlinePosTxCode('${s.id}')"
          onkeydown="if(event.key === 'Enter'){ event.preventDefault(); this.blur(); }"
          style="width: 100%; height: 26px; padding: 0 6px 0 19px; font-family: monospace; font-size: 0.73rem; font-weight: 800; border-radius: 5px; border: 1px solid ${txCode ? 'rgba(2, 132, 199, 0.45)' : 'var(--color-border)'}; background: ${txCode ? 'rgba(2, 132, 199, 0.08)' : 'var(--color-surface)'}; color: ${txCode ? '#0369a1' : 'var(--color-text-main)'}; letter-spacing: 0.3px;"
          title="Código de transacción único e irrepetible (sin espacios). Se guarda automáticamente al presionar Enter, Tab o el botón."
        >
      </div>
      <button
        type="button"
        id="pos-tx-save-btn-${s.id}"
        onclick="window.saveInlinePosTxCode('${s.id}')"
        style="height: 26px; width: 26px; border-radius: 5px; border: 1px solid ${txCode ? 'rgba(2, 132, 199, 0.4)' : 'rgba(16, 185, 129, 0.45)'}; background: ${txCode ? 'rgba(2, 132, 199, 0.12)' : 'rgba(16, 185, 129, 0.12)'}; color: ${txCode ? '#0284c7' : '#059669'}; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; font-size: 0.82rem; transition: all 0.2s;"
        title="${txCode ? 'Actualizar código de transacción' : 'Guardar código de transacción único'}"
      >
        <i class="ri-save-3-line"></i>
      </button>
    </div>
  `;

  if (mInfo.isStockaMachine || abonoInfo.isAbono) {
    const allSelectPeriods = Array.from(new Set([...periodsList, ...(abonoInfo.isAbono ? [abonoInfo.period] : [])]));
    const selectBorderColor = abonoInfo.isAbono ? 'rgba(16, 185, 129, 0.55)' : 'var(--color-border)';
    const selectBg = abonoInfo.isAbono ? 'rgba(16, 185, 129, 0.08)' : 'var(--color-surface)';
    const selectColor = abonoInfo.isAbono ? '#047857' : 'var(--color-text-muted)';

    return `
      <div style="display: flex; flex-direction: column; gap: 3px; min-width: 195px;">
        <select id="pos-period-select-${s.id}" class="form-input" onchange="window.updatePosSaleAbonoPeriod('${s.id}', this.value)" style="height: 29px; padding: 0 0.45rem; font-size: 0.74rem; font-weight: 800; border-radius: 6px; border-color: ${selectBorderColor}; background: ${selectBg}; color: ${selectColor}; cursor: pointer;" title="Seleccionar periodo de facturación en el que se considera como abono al servicio de fulfillment">
          ${allSelectPeriods.map(pName => `
            <option value="${escapeHtml(pName)}" ${abonoInfo.period === pName ? 'selected' : ''}>📅 Abono: ${escapeHtml(pName)}</option>
          `).join('')}
          <option value="PAGO_DIRECTO" ${abonoInfo.period === 'PAGO_DIRECTO' ? 'selected' : ''}>💸 Pago Directo Seller</option>
          <option value="SIN_ASIGNAR" ${abonoInfo.period === 'SIN_ASIGNAR' ? 'selected' : ''}>⏳ Sin Asignar</option>
        </select>
        ${txInlineControlHtml}
        <div id="pos-period-link-wrap-${s.id}">
          ${abonoInfo.isAbono ? `
            <span onclick="window.openPosCommerceInBillingManager('${escapeHtml(s.comercio)}', '${escapeHtml(abonoInfo.period)}')" style="cursor: pointer; font-size: 0.67rem; color: #5f06fa; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;" title="Ir al desglose de ${escapeHtml(s.comercio)} en ${escapeHtml(abonoInfo.period)}">
              <i class="ri-links-line"></i> Ver en Facturación <i class="ri-arrow-right-up-line"></i>
            </span>
          ` : ''}
        </div>
      </div>
    `;
  }

  return `
    <div style="display: flex; flex-direction: column; gap: 3px; min-width: 195px;">
      <span style="font-size: 0.72rem; color: var(--color-text-muted); background: var(--color-bg); border: 1px dashed var(--color-border); padding: 2px 7px; border-radius: 5px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; width: fit-content;">
        <i class="ri-store-2-line"></i> No aplica abono (Terminal Seller)
      </span>
      ${txInlineControlHtml}
      <div id="pos-period-link-wrap-${s.id}"></div>
    </div>
  `;
};

// Sincronizar en memoria, KPIs y DOM de la fila sin recargar la tabla ni mover el scroll
window.syncPosSaleInMemoryAndDOM = async function(updatedSale, options = {}) {
  if (!updatedSale || !updatedSale.id) return;
  const saleIdStr = String(updatedSale.id);

  // 1. Actualizar en cache y en lista completa en memoria
  if (window.posSalesCache) {
    window.posSalesCache.set(saleIdStr, updatedSale);
    if (updatedSale.codigo_venta) {
      window.posSalesCache.set(String(updatedSale.codigo_venta), updatedSale);
    }
  }
  if (Array.isArray(window.posAllLoadedSales)) {
    const idx = window.posAllLoadedSales.findIndex(s => String(s.id) === saleIdStr);
    if (idx >= 0) {
      window.posAllLoadedSales[idx] = { ...window.posAllLoadedSales[idx], ...updatedSale };
    }
  }

  // 2. Actualizar elementos de la fila en el DOM in-place (sin reconstruir tbody)
  const linkedOrd = window.posLinkedOrdersMap?.get(String(updatedSale.codigo_venta)) || null;
  const mInfo = window.resolvePosSaleMachineInfo(updatedSale, window.posCommerceConfigsMap, linkedOrd);
  const fin = window.calculatePosSaleFinancials(updatedSale, mInfo);
  const abonoInfo = window.resolvePosSaleAbonoPeriod(updatedSale, linkedOrd, mInfo, fin);
  const txCode = window.resolvePosSaleTransactionCode(updatedSale, linkedOrd);

  // Actualizar selector de método de pago en la fila
  const paymentSelectEl = document.getElementById(`pos-payment-select-${saleIdStr}`);
  if (paymentSelectEl) {
    if (paymentSelectEl.value !== updatedSale.modo_pago) {
      paymentSelectEl.value = updatedSale.modo_pago;
    }
    const st = window.getPosPaymentSelectColors(updatedSale.modo_pago);
    paymentSelectEl.style.borderColor = st.border;
    paymentSelectEl.style.background = st.bg;
    paymentSelectEl.style.color = st.color;
  }

  // Si se actualizó el método de pago, refrescar las celdas de Máquina POS, Pago al Seller y Periodo de esa fila
  if (options.updatedField === 'paymentMethod') {
    const machineCell = document.getElementById(`pos-machine-cell-${saleIdStr}`);
    if (machineCell) machineCell.innerHTML = window.renderPosMachineColHtml(mInfo);

    const payoutCell = document.getElementById(`pos-payout-cell-${saleIdStr}`);
    if (payoutCell) payoutCell.innerHTML = window.renderPosSellerPayoutColHtml(fin);

    const periodCell = document.getElementById(`pos-period-cell-${saleIdStr}`);
    if (periodCell) periodCell.innerHTML = window.renderPosPeriodColHtml(updatedSale, linkedOrd, mInfo, fin, abonoInfo);
  }

  // Actualizar selector de periodo en la fila
  const periodSelectEl = document.getElementById(`pos-period-select-${saleIdStr}`);
  if (periodSelectEl) {
    if (periodSelectEl.value !== abonoInfo.period) {
      periodSelectEl.value = abonoInfo.period;
    }
    periodSelectEl.style.borderColor = abonoInfo.isAbono ? 'rgba(16, 185, 129, 0.55)' : 'var(--color-border)';
    periodSelectEl.style.background = abonoInfo.isAbono ? 'rgba(16, 185, 129, 0.08)' : 'var(--color-surface)';
    periodSelectEl.style.color = abonoInfo.isAbono ? '#047857' : 'var(--color-text-muted)';
  }

  // Actualizar link "Ver en Facturación" en la fila
  const linkWrapEl = document.getElementById(`pos-period-link-wrap-${saleIdStr}`);
  if (linkWrapEl) {
    if (abonoInfo.isAbono) {
      linkWrapEl.innerHTML = `
        <span onclick="window.openPosCommerceInBillingManager('${escapeHtml(updatedSale.comercio)}', '${escapeHtml(abonoInfo.period)}')" style="cursor: pointer; font-size: 0.67rem; color: #5f06fa; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;" title="Ir al desglose de ${escapeHtml(updatedSale.comercio)} en ${escapeHtml(abonoInfo.period)}">
          <i class="ri-links-line"></i> Ver en Facturación <i class="ri-arrow-right-up-line"></i>
        </span>
      `;
    } else {
      linkWrapEl.innerHTML = '';
    }
  }

  // Actualizar input y botón de código de transacción en la fila y en modal de detalle (si está abierto)
  const txInputs = [
    document.getElementById(`pos-tx-input-${saleIdStr}`),
    document.getElementById(`pos-detail-tx-input-${saleIdStr}`)
  ].filter(Boolean);

  txInputs.forEach(inp => {
    inp.value = txCode;
    inp.dataset.original = txCode;
    inp.style.borderColor = txCode ? 'rgba(2, 132, 199, 0.45)' : 'var(--color-border)';
    inp.style.background = txCode ? 'rgba(2, 132, 199, 0.08)' : 'var(--color-surface)';
    inp.style.color = txCode ? '#0369a1' : 'var(--color-text-main)';
  });

  const txIconEl = document.getElementById(`pos-tx-icon-${saleIdStr}`);
  if (txIconEl) {
    txIconEl.style.color = txCode ? '#0284c7' : '#94a3b8';
  }

  const txBtnEl = document.getElementById(`pos-tx-save-btn-${saleIdStr}`);
  if (txBtnEl) {
    if (options.updatedField === 'txCode') {
      txBtnEl.style.borderColor = '#10b981';
      txBtnEl.style.background = 'rgba(16, 185, 129, 0.18)';
      txBtnEl.style.color = '#059669';
      txBtnEl.innerHTML = '<i class="ri-check-line"></i>';
      setTimeout(() => {
        if (!txBtnEl.isConnected) return;
        txBtnEl.style.borderColor = txCode ? 'rgba(2, 132, 199, 0.4)' : 'rgba(16, 185, 129, 0.45)';
        txBtnEl.style.background = txCode ? 'rgba(2, 132, 199, 0.12)' : 'rgba(16, 185, 129, 0.12)';
        txBtnEl.style.color = txCode ? '#0284c7' : '#059669';
        txBtnEl.innerHTML = '<i class="ri-save-3-line"></i>';
      }, 1500);
    } else {
      txBtnEl.style.borderColor = txCode ? 'rgba(2, 132, 199, 0.4)' : 'rgba(16, 185, 129, 0.45)';
      txBtnEl.style.background = txCode ? 'rgba(2, 132, 199, 0.12)' : 'rgba(16, 185, 129, 0.12)';
      txBtnEl.style.color = txCode ? '#0284c7' : '#059669';
    }
  }

  // 3. Actualizar KPIs y banner de comercio sin tocar tbody ni mover scroll
  if (Array.isArray(window.posAllLoadedSales)) {
    const allFilteredSales = applyClientSidePosFilters(window.posAllLoadedSales);
    await updatePosKpis(allFilteredSales);
    const selectedCommerce = document.getElementById('filter-pos-commerce')?.value || '';
    renderSelectedCommercePosBanner(selectedCommerce, allFilteredSales);
  }
};

// Actualizar Método de Pago de una venta POS directamente desde la tabla o modal de detalle (sin mover el scroll)
window.updatePosSalePaymentMethod = async function(saleId, newPaymentMethod, options = {}) {
  const { silent = false, skipRefresh = false, fromDetailModal = false } = options;
  try {
    let sale = window.posSalesCache?.get(String(saleId));
    if (!sale) {
      const { data: fetchedSale } = await supabase.from('store_sales').select('*').eq('id', saleId).maybeSingle();
      sale = fetchedSale;
    }
    if (!sale) throw new Error('No se encontró la venta POS seleccionada.');

    const cleanModo = String(newPaymentMethod || '').trim();
    if (!cleanModo || cleanModo === sale.modo_pago) return true;

    const { data: updatedRow, error: updErr } = await supabase
      .from('store_sales')
      .update({ modo_pago: cleanModo })
      .eq('id', sale.id)
      .select()
      .maybeSingle();

    if (updErr) throw updErr;

    const finalSaleObj = { ...sale, ...(updatedRow || {}), modo_pago: cleanModo };
    sale.modo_pago = cleanModo;

    // Recalcular máquina y liquidación con el nuevo método de pago
    const linkedOrd = window.posLinkedOrdersMap?.get(String(sale.codigo_venta)) || null;
    const mInfo = window.resolvePosSaleMachineInfo(finalSaleObj, window.posCommerceConfigsMap, linkedOrd);
    const fin = window.calculatePosSaleFinancials(finalSaleObj, mInfo);

    // Sincronizar también en el pedido vinculado en public.orders (raw_shopify_data.payment_method y pos_financials)
    const ordMatch = String(sale.comentarios || '').match(/\[WMS-ORD:\s*([a-zA-Z0-9-]+)\]/i);
    const linkedOrdId = sale.wms_order_id || (ordMatch ? ordMatch[1].trim() : null);

    try {
      let ordRow = null;
      if (linkedOrdId) {
        const { data: oData } = await supabase.from('orders').select('id, raw_shopify_data').eq('id', linkedOrdId).maybeSingle();
        ordRow = oData;
      } else if (sale.codigo_venta) {
        const { data: oData } = await supabase.from('orders').select('id, raw_shopify_data').eq('external_order_number', sale.codigo_venta).maybeSingle();
        ordRow = oData;
      }

      if (ordRow) {
        const nextRaw = {
          ...(ordRow.raw_shopify_data || {}),
          payment_method: cleanModo,
          pos_financials: {
            monto_total: fin.montoTotal,
            fee_pct: fin.feePct,
            commission_net: fin.commissionNet,
            commission_iva: fin.commissionIva,
            commission_total: fin.commissionTotal,
            seller_payout: fin.sellerPayout,
            applies_stocka_settlement: fin.appliesStockaPosSettlement
          }
        };
        await supabase.from('orders').update({ raw_shopify_data: nextRaw }).eq('id', ordRow.id);
        if (window.posLinkedOrdersMap) {
          window.posLinkedOrdersMap.set(String(ordRow.id), { ...ordRow, raw_shopify_data: nextRaw });
          if (sale.codigo_venta) window.posLinkedOrdersMap.set(String(sale.codigo_venta), { ...ordRow, raw_shopify_data: nextRaw });
        }
      }
    } catch (ordSyncErr) {
      console.warn('Aviso sincronizando payment_method en orders:', ordSyncErr);
    }

    if (!skipRefresh) {
      await window.syncPosSaleInMemoryAndDOM(finalSaleObj, { updatedField: 'paymentMethod' });
    }

    if (fromDetailModal && document.getElementById('modal-pos-detail')?.classList.contains('active')) {
      window.openPosSaleDetail(finalSaleObj.id);
    }

    if (!silent && typeof Swal !== 'undefined') {
      const subMsg = fin.appliesStockaCommission
        ? `Comisión ${fin.commissionPct}%+IVA (-${formatCLP(fin.commissionTotal)}) · Abono: ${formatCLP(fin.sellerPayout)}`
        : `Recaudación directa (${formatCLP(fin.grossAmount)}, $0 comisión)`;
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: `Pago actualizado: ${cleanModo}`,
        text: subMsg,
        showConfirmButton: false,
        returnFocus: false,
        timer: 2200
      });
    }

    return true;
  } catch (err) {
    console.error('Error actualizando método de pago POS:', err);
    if (!silent && typeof Swal !== 'undefined') {
      Swal.fire('Error', 'No se pudo actualizar el método de pago: ' + err.message, 'error');
    }
    return false;
  }
};

// Actualizar y validar Código de Transacción único e irrepetible (sin espacios) para una venta POS
window.updatePosSaleTransactionCode = async function(saleId, rawCode, options = {}) {
  const { silent = false, skipRefresh = false, inputEl = null } = options;
  try {
    let sale = window.posSalesCache?.get(String(saleId));
    if (!sale) {
      const { data: fetchedSale } = await supabase.from('store_sales').select('*').eq('id', saleId).maybeSingle();
      sale = fetchedSale;
    }
    if (!sale) throw new Error('No se encontró la venta POS seleccionada.');

    const prevTxCode = window.resolvePosSaleTransactionCode(sale);

    // Validar que no tenga espacios y limpiar
    if (/\s/.test(String(rawCode || ''))) {
      if (inputEl) inputEl.value = window.sanitizePosTransactionCode(rawCode);
    }
    const cleanCode = window.sanitizePosTransactionCode(rawCode);

    // Si no cambió respecto al código actual, no hacer nada
    if (cleanCode === prevTxCode) {
      return true;
    }

    // Validar unicidad si se está ingresando un código no vacío
    if (cleanCode) {
      const dupCheck = await window.checkPosTransactionCodeDuplicate(cleanCode, sale.id);
      if (dupCheck.isDuplicate) {
        const conf = dupCheck.conflictingSale || {};
        const confDate = conf.created_at ? new Date(conf.created_at).toLocaleDateString('es-CL') : '';
        if (inputEl) {
          inputEl.value = prevTxCode || '';
          inputEl.style.borderColor = '#ef4444';
          setTimeout(() => {
            if (inputEl) inputEl.style.borderColor = prevTxCode ? 'rgba(2, 132, 199, 0.45)' : 'var(--color-border)';
          }, 2200);
        }
        if (typeof Swal !== 'undefined') {
          Swal.fire({
            icon: 'error',
            title: 'Código de Transacción Duplicado',
            html: `
              <div style="text-align: left; font-size: 0.88rem; line-height: 1.5;">
                <p style="margin-bottom: 0.65rem;">El código de transacción <strong style="font-family: monospace; color: #dc2626; background: rgba(239,68,68,0.1); padding: 2px 6px; border-radius: 4px;">${escapeHtml(cleanCode)}</strong> ya fue registrado anteriormente y no puede repetirse.</p>
                <div style="background: var(--color-bg, #f8fafc); border: 1px solid var(--color-border, #e2e8f0); border-radius: 8px; padding: 0.65rem 0.85rem; font-size: 0.82rem;">
                  <div><strong>Venta asociada:</strong> <span style="font-family: monospace;">${escapeHtml(conf.codigo_venta || '#' + conf.id)}</span></div>
                  <div><strong>Comercio:</strong> ${escapeHtml(conf.comercio || 'N/A')}</div>
                  ${conf.nombre_cliente ? `<div><strong>Cliente:</strong> ${escapeHtml(conf.nombre_cliente)}</div>` : ''}
                  ${confDate ? `<div><strong>Fecha:</strong> ${escapeHtml(confDate)}</div>` : ''}
                </div>
              </div>
            `,
            confirmButtonText: 'Entendido',
            confirmButtonColor: '#ef4444'
          });
        }
        return false;
      }
    }

    const updatedComments = window.buildPosSaleCommentsWithTags(null, sale.comentarios, {
      txCode: cleanCode
    });

    const { data: updatedRow, error: updErr } = await supabase
      .from('store_sales')
      .update({ comentarios: updatedComments })
      .eq('id', sale.id)
      .select()
      .maybeSingle();

    if (updErr) throw updErr;

    const finalSaleObj = { ...sale, ...(updatedRow || {}), comentarios: updatedComments, codigo_transaccion: cleanCode };
    sale.comentarios = updatedComments;
    sale.codigo_transaccion = cleanCode;

    // Sincronizar también en el pedido vinculado en public.orders (raw_shopify_data.pos_tx_code)
    const ordMatch = String(sale.comentarios || '').match(/\[WMS-ORD:\s*([a-zA-Z0-9-]+)\]/i);
    const linkedOrdId = sale.wms_order_id || (ordMatch ? ordMatch[1].trim() : null);

    try {
      let ordRow = null;
      if (linkedOrdId) {
        const { data: oData } = await supabase.from('orders').select('id, raw_shopify_data').eq('id', linkedOrdId).maybeSingle();
        ordRow = oData;
      } else if (sale.codigo_venta) {
        const { data: oData } = await supabase.from('orders').select('id, raw_shopify_data').eq('external_order_number', sale.codigo_venta).maybeSingle();
        ordRow = oData;
      }

      if (ordRow) {
        const nextRaw = {
          ...(ordRow.raw_shopify_data || {}),
          pos_tx_code: cleanCode
        };
        await supabase.from('orders').update({ raw_shopify_data: nextRaw }).eq('id', ordRow.id);
        if (window.posLinkedOrdersMap) {
          window.posLinkedOrdersMap.set(String(ordRow.id), { ...ordRow, raw_shopify_data: nextRaw });
          if (sale.codigo_venta) window.posLinkedOrdersMap.set(String(sale.codigo_venta), { ...ordRow, raw_shopify_data: nextRaw });
        }
      }
    } catch (ordSyncErr) {
      console.warn('Aviso sincronizando pos_tx_code en orders:', ordSyncErr);
    }

    if (!skipRefresh) {
      await window.syncPosSaleInMemoryAndDOM(finalSaleObj, { updatedField: 'txCode' });
    } else if (window.posSalesCache) {
      window.posSalesCache.set(String(sale.id), finalSaleObj);
      if (sale.codigo_venta) window.posSalesCache.set(String(sale.codigo_venta), finalSaleObj);
    }

    if (!silent && typeof Swal !== 'undefined') {
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: `Venta ${sale.codigo_venta || '#' + sale.id}`,
        text: cleanCode ? `Código de transacción guardado: ${cleanCode}` : 'Código de transacción eliminado',
        showConfirmButton: false,
        returnFocus: false,
        timer: 2000
      });
    }

    return true;
  } catch (err) {
    console.error('Error actualizando código de transacción POS:', err);
    if (!silent && typeof Swal !== 'undefined') {
      Swal.fire('Error', 'No se pudo guardar el código de transacción: ' + err.message, 'error');
    }
    return false;
  }
};

window._posSavingTxLocks = window._posSavingTxLocks || new Set();
window.saveInlinePosTxCode = async function(saleId, inputElementId = null) {
  const lockKey = String(saleId);
  if (window._posSavingTxLocks.has(lockKey)) return false;

  const inputEl = document.getElementById(inputElementId || `pos-tx-input-${saleId}`);
  if (!inputEl) return false;
  const cleaned = window.sanitizePosTransactionCode(inputEl.value);
  inputEl.value = cleaned;

  const originalVal = window.sanitizePosTransactionCode(inputEl.dataset.original || '');
  if (cleaned === originalVal) {
    return true;
  }

  window._posSavingTxLocks.add(lockKey);
  const btnEl = document.getElementById(`pos-tx-save-btn-${saleId}`);
  const prevBtnHtml = btnEl ? btnEl.innerHTML : '';
  if (btnEl) {
    btnEl.innerHTML = '<i class="ri-loader-4-line spin"></i>';
    btnEl.disabled = true;
  }

  try {
    return await window.updatePosSaleTransactionCode(saleId, cleaned, { inputEl });
  } finally {
    window._posSavingTxLocks.delete(lockKey);
    if (btnEl) {
      btnEl.disabled = false;
      if (btnEl.innerHTML.includes('ri-loader-4-line')) {
        btnEl.innerHTML = prevBtnHtml || '<i class="ri-save-3-line"></i>';
      }
    }
  }
};

let _posTxStep3ValidationTimer = null;
window.validatePosStep3TxCodeInput = function() {
  const inputEl = document.getElementById('pos-tx-code-input');
  const msgEl = document.getElementById('pos-tx-code-validation-msg');
  if (!inputEl || !msgEl) return;

  const cleanCode = window.sanitizePosTransactionCode(inputEl.value);
  if (inputEl.value !== cleanCode) {
    inputEl.value = cleanCode;
  }

  if (_posTxStep3ValidationTimer) clearTimeout(_posTxStep3ValidationTimer);

  if (!cleanCode) {
    inputEl.style.borderColor = '';
    inputEl.dataset.txDuplicate = 'false';
    msgEl.style.color = 'var(--color-text-muted)';
    msgEl.innerHTML = 'Código único e irrepetible de la operación POS/pago (no admite espacios ni duplicados).';
    return;
  }

  msgEl.style.color = '#64748b';
  msgEl.innerHTML = '<i class="ri-loader-4-line spin"></i> Verificando unicidad del código...';

  _posTxStep3ValidationTimer = setTimeout(async () => {
    const res = await window.checkPosTransactionCodeDuplicate(cleanCode, null);
    if (inputEl.value !== cleanCode) return;
    if (res.isDuplicate) {
      const conf = res.conflictingSale || {};
      inputEl.style.borderColor = '#ef4444';
      inputEl.dataset.txDuplicate = 'true';
      msgEl.style.color = '#dc2626';
      msgEl.innerHTML = `<i class="ri-error-warning-fill"></i> <strong>Código ya utilizado</strong> en venta <code>${escapeHtml(conf.codigo_venta || '#' + conf.id)}</code> (${escapeHtml(conf.comercio || '')}). Ingresa un código diferente.`;
    } else {
      inputEl.style.borderColor = '#10b981';
      inputEl.dataset.txDuplicate = 'false';
      msgEl.style.color = '#059669';
      msgEl.innerHTML = `<i class="ri-checkbox-circle-fill"></i> Código <strong>${escapeHtml(cleanCode)}</strong> disponible y único.`;
    }
  }, 220);
};

// Asignación masiva de Periodo de Facturación (Abono) para las ventas filtradas
window.openBulkAssignPosPeriodModal = async function() {
  await window.ensurePosMetadataLoaded();
  const availablePeriods = window.getAvailablePosBillingPeriodNames();

  let query = supabase.from('store_sales').select('*').order('created_at', { ascending: false });
  query = buildPosSalesQuery(query);
  const { data: rawSales, error } = await query;
  if (error) {
    Swal.fire('Error', 'No se pudieron obtener las ventas actuales: ' + error.message, 'error');
    return;
  }

  const filteredSales = applyClientSidePosFilters(rawSales || []);
  const stockaSales = filteredSales.filter(s => {
    const mInfo = window.resolvePosSaleMachineInfo(s);
    return mInfo.isStockaMachine && mInfo.isCardPayment;
  });

  if (filteredSales.length === 0) {
    Swal.fire('Sin ventas', 'No hay ventas en la vista actual para asignar periodo.', 'info');
    return;
  }

  const totalNetAbono = stockaSales.reduce((acc, s) => {
    const mInfo = window.resolvePosSaleMachineInfo(s);
    const fin = window.calculatePosSaleFinancials(s, mInfo);
    return acc + fin.sellerPayout;
  }, 0);

  const periodOptionsHtml = [
    ...availablePeriods.map(p => `<option value="${escapeHtml(p)}">📅 Abonar en Periodo: ${escapeHtml(p)}</option>`),
    `<option value="PAGO_DIRECTO">💸 Pago Directo al Seller (No abonar en factura)</option>`,
    `<option value="SIN_ASIGNAR">⏳ Dejar Pendiente / Sin Asignar</option>`
  ].join('');

  const { value: formValues } = await Swal.fire({
    title: '<div style="display:flex;align-items:center;justify-content:center;gap:0.45rem;font-size:1.15rem;"><i class="ri-calendar-check-line" style="color:#10b981;"></i><span>Asignar Periodo de Abono POS</span></div>',
    width: '540px',
    html: `
      <div style="text-align: left; font-size: 0.88rem; line-height: 1.45; color: var(--color-text-main);">
        <p style="margin: 0 0 0.85rem 0; color: var(--color-text-muted);">
          Selecciona el periodo de facturación en el cual las ventas seleccionadas se descontarán como <strong>Abono al servicio de Fulfillment</strong>.
        </p>

        <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 1rem;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
            <span style="color: var(--color-text-muted); font-weight: 600;">Ventas en vista actual:</span>
            <strong>${filteredSales.length} venta(s)</strong>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
            <span style="color: var(--color-text-muted); font-weight: 600;">Ventas con Máquina STOCKA:</span>
            <strong style="color: #2563eb;">${stockaSales.length} venta(s)</strong>
          </div>
          <div style="display: flex; justify-content: space-between; border-top: 1px dashed rgba(16, 185, 129, 0.35); padding-top: 0.35rem; margin-top: 0.35rem;">
            <span style="color: #047857; font-weight: 700;">Total Neto a Abonar al Seller (-Com. + IVA):</span>
            <strong style="color: #059669; font-size: 1rem;">${formatCLP(totalNetAbono)}</strong>
          </div>
        </div>

        <label style="font-size: 0.75rem; font-weight: 800; color: var(--color-text-muted); text-transform: uppercase; display: block; margin-bottom: 0.3rem;">
          1. Alcance de la Asignación:
        </label>
        <select id="swal-bulk-pos-scope" class="form-input" style="width: 100%; margin-bottom: 0.85rem; font-weight: 600;">
          <option value="stocka_only" selected>Solo ventas con Máquina STOCKA (${stockaSales.length} ventas)</option>
          <option value="all_filtered">Todas las ventas filtradas en pantalla (${filteredSales.length} ventas)</option>
        </select>

        <label style="font-size: 0.75rem; font-weight: 800; color: var(--color-text-muted); text-transform: uppercase; display: block; margin-bottom: 0.3rem;">
          2. Periodo de Facturación Destino:
        </label>
        <select id="swal-bulk-pos-period" class="form-input" style="width: 100%; font-weight: 700; color: #0f172a;">
          ${periodOptionsHtml}
        </select>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: '<i class="ri-check-double-line"></i> Aplicar Periodo',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#10b981',
    preConfirm: () => {
      const scope = document.getElementById('swal-bulk-pos-scope')?.value || 'stocka_only';
      const period = document.getElementById('swal-bulk-pos-period')?.value || '';
      if (!period) {
        Swal.showValidationMessage('Selecciona un periodo válido.');
        return false;
      }
      return { scope, period };
    }
  });

  if (!formValues) return;

  const targetList = formValues.scope === 'stocka_only' ? stockaSales : filteredSales;
  if (targetList.length === 0) {
    Swal.fire('Atención', 'No hay ventas que cumplan con el alcance seleccionado.', 'warning');
    return;
  }

  Swal.fire({
    title: 'Actualizando Periodo de Abono...',
    text: `Procesando ${targetList.length} venta(s)...`,
    allowOutsideClick: false,
    didOpen: () => { Swal.showLoading(); }
  });

  let updatedCount = 0;
  for (const s of targetList) {
    const ok = await window.updatePosSaleAbonoPeriod(s.id, formValues.period, { silent: true, skipRefresh: true });
    if (ok) updatedCount++;
  }

  await fetchAndRenderPosData();

  Swal.fire({
    icon: 'success',
    title: 'Periodo de Abono Actualizado',
    text: `Se asignó "${formValues.period}" a ${updatedCount} venta(s) correctamente.`,
    timer: 2600,
    showConfirmButton: false
  });
};

// Abrir el Gestor de Facturación directamente en el comercio y periodo seleccionados
window.openPosCommerceInBillingManager = function(commerceName, periodName = '') {
  const navBilling = document.querySelector('.nav-item[data-view="facturacion_admin"]') || document.querySelector('[data-view="facturacion_admin"]');
  const targetPeriod = (window.posBillingPeriodsList || []).find(p => String(p.name || '').trim().toUpperCase() === String(periodName || '').trim().toUpperCase());
  const periodId = targetPeriod?.id || null;

  if (navBilling) {
    navBilling.click();
    setTimeout(() => {
      if (typeof window.openBillingGeneratorFromOverview === 'function') {
        window.openBillingGeneratorFromOverview(commerceName, periodId);
      } else if (typeof window.renderBillingGeneratorAdmin === 'function') {
        window.renderBillingGeneratorAdmin('tab-generator-content', commerceName, periodId);
      }
    }, 350);
  } else if (typeof window.openBillingGeneratorFromOverview === 'function') {
    window.openBillingGeneratorFromOverview(commerceName, periodId);
  }
};

// Helper para generar código único de venta (siempre incluye 6 dígitos numéricos para cumplir unique_orders_comercio_clean_number)
window.generatePosSaleCode = function(prefix) {
  const cleanPrefix = (prefix || 'POS').replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase();
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const l1 = letters.charAt(Math.floor(Math.random() * letters.length));
  const l2 = letters.charAt(Math.floor(Math.random() * letters.length));
  const timePart = String(Date.now()).slice(-3);
  const randPart = String(Math.floor(100 + Math.random() * 900));
  return `${cleanPrefix}-${l1}${l2}${timePart}${randPart}`;
};

window.regeneratePosCode = function() {
  const commerceSelect = document.getElementById('pos-select-commerce');
  let sigla = 'POS';
  if (commerceSelect && commerceSelect.value && window.cachedAdminMerchants) {
    const c = window.cachedAdminMerchants.find(m => m.nombre === commerceSelect.value);
    if (c && c.sigla && c.sigla !== 'SIN SIGLA') {
      sigla = c.sigla;
    }
  }
  const codeInput = document.getElementById('pos-codigo-venta');
  if (codeInput) {
    codeInput.value = window.generatePosSaleCode(sigla);
  }
  if (document.getElementById('pos-modo-pago')?.value === 'Transferencia') {
    window.updatePosPaymentMachineBanner();
  }
};

// ====== 1. VISTA PRINCIPAL (TABLA Y KPIS) ======
async function renderPosAdmin() {
  window.renderPosAdmin = renderPosAdmin;
  const content = document.getElementById('app-content');
  if (!content) return;

  await window.ensurePosMetadataLoaded();

  content.innerHTML = `
    <div style="margin-bottom: 1.35rem; display: flex; flex-wrap: wrap; gap: 1rem; justify-content: space-between; align-items: flex-end;">
      <div>
        <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; margin-bottom: 0.25rem;">
          <span style="background: rgba(37, 99, 235, 0.1); color: #2563eb; border: 1px solid rgba(37, 99, 235, 0.25); font-size: 0.72rem; font-weight: 800; padding: 0.2rem 0.65rem; border-radius: 999px; display: inline-flex; align-items: center; gap: 0.3rem;">
            <i class="ri-store-3-line"></i> SUCURSAL FÍSICA ÑUÑOA · CAMPO DE DEPORTES 405
          </span>
          <span style="background: rgba(16, 185, 129, 0.1); color: #059669; border: 1px solid rgba(16, 185, 129, 0.25); font-size: 0.72rem; font-weight: 700; padding: 0.2rem 0.65rem; border-radius: 999px; display: inline-flex; align-items: center; gap: 0.3rem;" title="Comisiones POS vigentes sobre máquinas Stocka (+ IVA)">
            <i class="ri-bank-card-line"></i> Tarifa POS Stocka: Débito 2.5% + IVA · Crédito 3.5% + IVA · Mantención 0.2 UF + IVA
          </span>
        </div>
        <p style="color: var(--color-text-muted); font-size: 0.92rem; max-width: 860px; line-height: 1.5; margin: 0;">
          Control de ventas presenciales, trazabilidad de <strong>Máquina POS utilizada</strong>, liquidación de <strong>Pago al Seller / Abono Fulfillment (-Comisión + IVA)</strong> y asignación de <strong>Periodo de Facturación</strong>.
        </p>
      </div>
      <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
        <button id="btn-open-create-pos-sale" onclick="window.openCreatePosSaleModal()" class="btn btn-primary" style="background-color: var(--color-primary); color: white; display: flex; align-items: center; gap: 0.35rem; font-weight: 700; box-shadow: 0 2px 6px rgba(59, 130, 246, 0.25); cursor: pointer;">
          <i class="ri-shopping-cart-2-line"></i> Registrar Venta
        </button>
        <button id="btn-pos-bulk-period" onclick="window.openBulkAssignPosPeriodModal()" class="btn btn-outline" style="background: rgba(16, 185, 129, 0.08); color: #047857; border-color: rgba(16, 185, 129, 0.45); display: flex; align-items: center; gap: 0.35rem; font-weight: 700; cursor: pointer;" title="Asignar o cambiar masivamente el periodo de facturación para abono">
          <i class="ri-calendar-check-line"></i> Asignar Periodo Abono
        </button>
        <button id="btn-pos-branch-exchange-receipt" onclick="window.openQuickBranchExchangeReceiptModal()" class="btn btn-primary" style="background: linear-gradient(135deg, #4f46e5, #7c3aed); color: white; display: flex; align-items: center; gap: 0.35rem; font-weight: 700; box-shadow: 0 2px 6px rgba(79, 70, 229, 0.25); cursor: pointer;" title="Crear o imprimir comprobante de cambio o recepción realizado en Sucursal Ñuñoa">
          <i class="ri-file-list-3-line"></i> Comprobante Cambio
        </button>
        <button id="btn-pos-export-csv" class="btn btn-outline" style="background-color: transparent; color: #10b981; border-color: #10b981; display: flex; align-items: center; gap: 0.25rem; font-weight: 600;">
          <i class="ri-file-text-line"></i> CSV
        </button>
        <button id="btn-pos-export-excel" class="btn btn-outline" style="background-color: transparent; color: #059669; border-color: #059669; display: flex; align-items: center; gap: 0.25rem; font-weight: 600;">
          <i class="ri-file-excel-2-line"></i> Excel
        </button>
      </div>
    </div>

    <!-- Tarjetas de Métricas KPI (Dinámicas según filtros activos) -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(215px, 1fr)); gap: 0.9rem; margin-bottom: 1.25rem;">
      <div class="card" style="padding: 1.1rem 1.2rem; display: flex; align-items: center; gap: 0.9rem; border-left: 4px solid var(--color-primary);">
        <div style="width: 44px; height: 44px; border-radius: 12px; background: rgba(59, 130, 246, 0.1); display: flex; align-items: center; justify-content: center; color: var(--color-primary); font-size: 1.4rem; flex-shrink: 0;">
          <i class="ri-shopping-bag-3-line"></i>
        </div>
        <div style="min-width: 0; flex: 1;">
          <span id="pos-kpi-label-count" style="font-size: 0.72rem; color: var(--color-text-muted); text-transform: uppercase; font-weight: 700; letter-spacing: 0.4px; display: block;">Ventas Registradas</span>
          <div style="display: flex; align-items: baseline; gap: 0.45rem; flex-wrap: wrap;">
            <strong id="pos-kpi-total-month" style="font-size: 1.45rem; color: var(--color-text-main); line-height: 1.2;">0</strong>
            <span id="pos-kpi-sub-units" style="font-size: 0.73rem; color: var(--color-text-muted); font-weight: 600;">0 un.</span>
          </div>
          <span id="pos-kpi-today-badge" style="font-size: 0.7rem; color: #2563eb; font-weight: 600; display: block; margin-top: 2px;">Hoy: <strong id="pos-kpi-today-count">0</strong></span>
        </div>
      </div>

      <div class="card" style="padding: 1.1rem 1.2rem; display: flex; align-items: center; gap: 0.9rem; border-left: 4px solid #0ea5e9;">
        <div style="width: 44px; height: 44px; border-radius: 12px; background: rgba(14, 165, 233, 0.1); display: flex; align-items: center; justify-content: center; color: #0284c7; font-size: 1.4rem; flex-shrink: 0;">
          <i class="ri-money-dollar-circle-line"></i>
        </div>
        <div style="min-width: 0; flex: 1;">
          <span id="pos-kpi-label-monto" style="font-size: 0.72rem; color: var(--color-text-muted); text-transform: uppercase; font-weight: 700; letter-spacing: 0.4px; display: block;">Monto Bruto Ventas</span>
          <strong id="pos-kpi-monto-month" style="font-size: 1.45rem; color: #0284c7; line-height: 1.2; display: block;">$0</strong>
          <span id="pos-kpi-sub-monto" style="font-size: 0.7rem; color: var(--color-text-muted); display: block; margin-top: 2px;">Total pagado por clientes</span>
        </div>
      </div>

      <div class="card" style="padding: 1.1rem 1.2rem; display: flex; align-items: center; gap: 0.9rem; border-left: 4px solid #f59e0b;">
        <div style="width: 44px; height: 44px; border-radius: 12px; background: rgba(245, 158, 11, 0.12); display: flex; align-items: center; justify-content: center; color: #d97706; font-size: 1.4rem; flex-shrink: 0;">
          <i class="ri-percent-line"></i>
        </div>
        <div style="min-width: 0; flex: 1;">
          <span style="font-size: 0.72rem; color: var(--color-text-muted); text-transform: uppercase; font-weight: 700; letter-spacing: 0.4px; display: block;">Comisión POS Stocka (+IVA)</span>
          <strong id="pos-kpi-comisiones-stocka" style="font-size: 1.45rem; color: #d97706; line-height: 1.2; display: block;">$0</strong>
          <span id="pos-kpi-sub-comisiones" style="font-size: 0.7rem; color: var(--color-text-muted); display: block; margin-top: 2px;">Déb. 2.5% · Créd. 3.5% (+IVA)</span>
        </div>
      </div>

      <div class="card" style="padding: 1.1rem 1.2rem; display: flex; align-items: center; gap: 0.9rem; border-left: 4px solid #10b981; background: linear-gradient(135deg, rgba(16, 185, 129, 0.04) 0%, var(--color-surface) 100%);">
        <div style="width: 44px; height: 44px; border-radius: 12px; background: rgba(16, 185, 129, 0.14); display: flex; align-items: center; justify-content: center; color: #059669; font-size: 1.4rem; flex-shrink: 0;">
          <i class="ri-hand-coin-line"></i>
        </div>
        <div style="min-width: 0; flex: 1;">
          <span style="font-size: 0.72rem; color: #047857; text-transform: uppercase; font-weight: 800; letter-spacing: 0.4px; display: block;">Pago Seller / Abono Fulfillment</span>
          <strong id="pos-kpi-abono-seller" style="font-size: 1.45rem; color: #059669; line-height: 1.2; display: block;">$0</strong>
          <span id="pos-kpi-sub-abono" style="font-size: 0.7rem; color: #047857; font-weight: 600; display: block; margin-top: 2px;">Recaudado neto en Máquina Stocka</span>
        </div>
      </div>

      <div class="card" style="padding: 1.1rem 1.2rem; display: flex; align-items: center; gap: 0.9rem; border-left: 4px solid #8b5cf6;">
        <div style="width: 44px; height: 44px; border-radius: 12px; background: rgba(139, 92, 246, 0.1); display: flex; align-items: center; justify-content: center; color: #7c3aed; font-size: 1.4rem; flex-shrink: 0;">
          <i class="ri-store-2-line"></i>
        </div>
        <div style="min-width: 0; flex: 1;">
          <span style="font-size: 0.72rem; color: var(--color-text-muted); text-transform: uppercase; font-weight: 700; letter-spacing: 0.4px; display: block;">Comercios con Ventas</span>
          <strong id="pos-kpi-active-merchants" style="font-size: 1.45rem; color: var(--color-text-main); line-height: 1.2; display: block;">0</strong>
          <span id="pos-kpi-sub-merchants" style="font-size: 0.7rem; color: var(--color-text-muted); display: block; margin-top: 2px;">Terminales activos en sucursal</span>
        </div>
      </div>
    </div>

    <!-- Banner Contextual del Comercio Seleccionado (Máquina POS, Propietario y Acceso a Facturación) -->
    <div id="pos-selected-commerce-summary-banner" style="display: none; margin-bottom: 1.25rem;"></div>

    <!-- Filtros -->
    <div class="card" style="margin-bottom: 1.25rem;">
      <div class="card-body" style="display: flex; flex-wrap: wrap; gap: 0.85rem; align-items: flex-end; padding: 1rem 1.25rem;">
        <div class="form-group" style="flex: 1.2; min-width: 175px; margin-bottom: 0;">
          <label class="form-label" style="font-size: 0.76rem; font-weight: 700;">Comercio</label>
          <select id="filter-pos-commerce" class="form-input">
            <option value="">Todos los Comercios</option>
          </select>
        </div>

        <div class="form-group" style="flex: 1.2; min-width: 175px; margin-bottom: 0;">
          <label class="form-label" style="font-size: 0.76rem; font-weight: 700; color: #047857;">
            <i class="ri-calendar-check-line"></i> Periodo Facturación (Abono)
          </label>
          <select id="filter-pos-period" class="form-input" style="border-color: rgba(16, 185, 129, 0.4); font-weight: 600;">
            <option value="">Todos los Periodos</option>
          </select>
        </div>

        <div class="form-group" style="flex: 1; min-width: 155px; margin-bottom: 0;">
          <label class="form-label" style="font-size: 0.76rem; font-weight: 700;">Propiedad Máquina POS</label>
          <select id="filter-pos-machine-owner" class="form-input">
            <option value="">Todas las Máquinas</option>
            <option value="STOCKA">Propiedad de STOCKA (Con Abono)</option>
            <option value="COMERCIO">Propiedad del Comercio (Directo)</option>
          </select>
        </div>

        <div class="form-group" style="flex: 1; min-width: 145px; margin-bottom: 0;">
          <label class="form-label" style="font-size: 0.76rem; font-weight: 700;">Modo de Pago</label>
          <select id="filter-pos-payment" class="form-input">
            <option value="">Todos los Modos</option>
            <option value="Tarjeta de Débito">Tarjeta de Débito</option>
            <option value="Tarjeta de Crédito">Tarjeta de Crédito</option>
            <option value="Efectivo">Efectivo</option>
            <option value="Transferencia">Transferencia</option>
          </select>
        </div>

        <div class="form-group" style="flex: 0.8; min-width: 120px; margin-bottom: 0;">
          <label class="form-label" style="font-size: 0.76rem; font-weight: 700;">Documento</label>
          <select id="filter-pos-doc" class="form-input">
            <option value="">Todos</option>
            <option value="BOLETA">Boleta</option>
            <option value="FACTURA">Factura</option>
          </select>
        </div>

        <div class="form-group" style="flex: 1.4; min-width: 190px; margin-bottom: 0;">
          <label class="form-label" style="font-size: 0.76rem; font-weight: 700;">Buscador General</label>
          <input type="text" id="filter-pos-search" class="form-input" placeholder="Código, transacción, cliente, terminal...">
        </div>

        <div class="form-group" style="flex: 0.9; min-width: 128px; margin-bottom: 0;">
          <label class="form-label" style="font-size: 0.76rem; font-weight: 700;">Desde Fecha</label>
          <input type="date" id="filter-pos-date-from" class="form-input">
        </div>

        <div class="form-group" style="flex: 0.9; min-width: 128px; margin-bottom: 0;">
          <label class="form-label" style="font-size: 0.76rem; font-weight: 700;">Hasta Fecha</label>
          <input type="date" id="filter-pos-date-to" class="form-input">
        </div>
      </div>
    </div>

    <!-- Data Table -->
    <div class="card">
      <div class="card-body table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Fecha y Hora</th>
              <th>Código Venta</th>
              <th>Comercio</th>
              <th>Cliente</th>
              <th>Productos</th>
              <th style="text-align: right;">Total Pagado</th>
              <th>Pago y Documento</th>
              <th>Máquina de Pago</th>
              <th style="text-align: right;">Pago al Seller / Abono (+IVA)</th>
              <th>Periodo Facturación (Abono) / Cód. Transacción</th>
              <th>Pedido Gestor</th>
              <th style="text-align: center;">Acciones</th>
            </tr>
          </thead>
          <tbody id="pos-admin-tbody">
            <tr><td colspan="12" class="text-center" style="padding: 2rem;">Cargando ventas...</td></tr>
          </tbody>
        </table>
      </div>
      <div class="card-footer" style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; flex-wrap: wrap; gap: 0.75rem;">
        <div id="pos-pagination-info" style="font-size: 0.85rem; color: var(--color-text-muted);">
          Mostrando 0 registros
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button id="btn-pos-prev-page" class="btn btn-outline" style="padding: 0.25rem 0.75rem;" disabled>Anterior</button>
          <button id="btn-pos-next-page" class="btn btn-outline" style="padding: 0.25rem 0.75rem;" disabled>Siguiente</button>
        </div>
      </div>
    </div>
  `;

  // Inicializar selectores de comercio y periodos en filtro
  await populateFilterCommerces();
  populateFilterPeriods();

  // Listeners de Filtros
  const filters = [
    'filter-pos-commerce',
    'filter-pos-period',
    'filter-pos-machine-owner',
    'filter-pos-payment',
    'filter-pos-doc',
    'filter-pos-date-from',
    'filter-pos-date-to'
  ];
  filters.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        posCurrentPage = 1;
        fetchAndRenderPosData();
      });
    }
  });

  let searchTimeout;
  const searchInput = document.getElementById('filter-pos-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        posCurrentPage = 1;
        fetchAndRenderPosData();
      }, 350);
    });
  }

  // Paginación
  const btnPrev = document.getElementById('btn-pos-prev-page');
  const btnNext = document.getElementById('btn-pos-next-page');
  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      if (posCurrentPage > 1) {
        posCurrentPage--;
        fetchAndRenderPosData();
      }
    });
  }
  if (btnNext) {
    btnNext.addEventListener('click', () => {
      posCurrentPage++;
      fetchAndRenderPosData();
    });
  }

  // Exportaciones
  document.getElementById('btn-pos-export-csv')?.addEventListener('click', () => exportPosSales('csv'));
  document.getElementById('btn-pos-export-excel')?.addEventListener('click', () => exportPosSales('excel'));

  // Abrir modal de registro
  document.getElementById('btn-open-create-pos-sale')?.addEventListener('click', () => {
    window.openCreatePosSaleModal();
  });

  // Cargar datos
  posCurrentPage = 1;
  await fetchAndRenderPosData();
}

function populateFilterPeriods() {
  const select = document.getElementById('filter-pos-period');
  if (!select) return;
  const currentVal = select.value || '';
  const periodNames = window.getAvailablePosBillingPeriodNames();

  select.innerHTML = `<option value="">Todos los Periodos</option>`;
  periodNames.forEach(pName => {
    const opt = document.createElement('option');
    opt.value = pName;
    opt.textContent = `📅 ${pName}`;
    select.appendChild(opt);
  });

  const extraOpts = [
    { value: 'CON_ABONO', label: '✅ Todas con Abono a Fulfillment' },
    { value: 'PAGO_DIRECTO', label: '💸 Pago Directo al Seller (Sin Abono)' },
    { value: 'RECAUDACION_COMERCIO', label: '🏪 Recaudación Directa Comercio' },
    { value: 'SIN_ASIGNAR', label: '⏳ Pendiente de Asignar' }
  ];
  extraOpts.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    select.appendChild(opt);
  });

  if (currentVal) select.value = currentVal;
}

// Helper unificado para obtener listado limpio de comercios individuales (sin cadenas combinadas)
window.getPosUniqueMerchantsList = async function(options = {}) {
  const onlyActive = options && options.onlyActive === true;
  const commercesSet = new Set();
  const inactiveSet = onlyActive && typeof window.fetchInactiveMerchantsSet === 'function'
    ? await window.fetchInactiveMerchantsSet()
    : new Set();

  // 1. Comercios cacheados en admin (desagregando cadenas con coma si existieran)
  if (window.cachedAdminMerchants && window.cachedAdminMerchants.length > 0) {
    window.cachedAdminMerchants.forEach(m => {
      if (onlyActive && m.activo === false) return;
      if (m.nombre) {
        m.nombre.split(',').forEach(part => {
          const trimmed = part.trim();
          if (trimmed && trimmed.toLowerCase() !== 'all' && trimmed.toLowerCase() !== 'no asignado' && (!onlyActive || !inactiveSet.has(trimmed.toUpperCase()))) {
            commercesSet.add(trimmed);
          }
        });
      }
    });
  }

  // 2. Consultar comercios_adicional_config (fuente canónica de comercios en el WMS)
  try {
    const { data: cacList } = await supabase
      .from('comercios_adicional_config')
      .select('*')
      .order('comercio');
    if (cacList) {
      cacList.forEach(c => {
        const isCfgActive = c.activo !== false && c?.onboarding_checklist?.comercio_activo !== false;
        if (onlyActive && !isCfgActive) {
          if (c.comercio) inactiveSet.add(c.comercio.trim().toUpperCase());
          return;
        }
        if (c.comercio) {
          c.comercio.split(',').forEach(part => {
            const trimmed = part.trim();
            if (trimmed && trimmed.toLowerCase() !== 'all' && trimmed.toLowerCase() !== 'no asignado' && (!onlyActive || !inactiveSet.has(trimmed.toUpperCase()))) {
              commercesSet.add(trimmed);
            }
          });
        }
      });
    }
  } catch (e) {
    console.warn('Aviso consultando comercios_adicional_config:', e);
  }

  // 3. Consultar profiles desagregando cadenas combinadas por usuario
  try {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('comercio')
      .neq('role', 'admin');
    if (profiles) {
      profiles.forEach(p => {
        if (p.comercio) {
          p.comercio.split(',').forEach(c => {
            const trimmed = c.trim();
            if (trimmed && trimmed.toLowerCase() !== 'all' && trimmed.toLowerCase() !== 'no asignado' && (!onlyActive || !inactiveSet.has(trimmed.toUpperCase()))) {
              commercesSet.add(trimmed);
            }
          });
        }
      });
    }
  } catch (e) {
    console.warn('Aviso consultando profiles:', e);
  }

  return Array.from(commercesSet).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
};

// Helper para poblar dropdown de comercios en el filtro
async function populateFilterCommerces() {
  const select = document.getElementById('filter-pos-commerce');
  if (!select) return;

  try {
    const list = await window.getPosUniqueMerchantsList();
    list.forEach(cName => {
      const opt = document.createElement('option');
      opt.value = cName;
      opt.textContent = cName;
      select.appendChild(opt);
    });
  } catch (e) {
    console.warn('Error poblando comercios en filtro POS:', e);
  }
}

// ====== 2. CONSULTA Y RENDER DE DATOS ======
function buildPosSalesQuery(query) {
  const fCommerce = document.getElementById('filter-pos-commerce')?.value;
  const fPayment = document.getElementById('filter-pos-payment')?.value;
  const fDoc = document.getElementById('filter-pos-doc')?.value;
  const fSearch = document.getElementById('filter-pos-search')?.value.trim();
  const fFrom = document.getElementById('filter-pos-date-from')?.value;
  const fTo = document.getElementById('filter-pos-date-to')?.value;

  if (fCommerce) query = query.eq('comercio', fCommerce);
  if (fPayment) query = query.eq('modo_pago', fPayment);
  if (fDoc) query = query.eq('documento_tipo', fDoc);
  if (fSearch) {
    query = query.or(`codigo_venta.ilike.%${fSearch}%,nombre_cliente.ilike.%${fSearch}%,correo_cliente.ilike.%${fSearch}%,comentarios.ilike.%${fSearch}%,comercio.ilike.%${fSearch}%`);
  }
  if (fFrom) query = query.gte('created_at', fFrom + 'T00:00:00.000Z');
  if (fTo) query = query.lte('created_at', fTo + 'T23:59:59.999Z');

  return query;
}

function applyClientSidePosFilters(salesList) {
  const fPeriod = document.getElementById('filter-pos-period')?.value || '';
  const fOwner = document.getElementById('filter-pos-machine-owner')?.value || '';
  if (!fPeriod && !fOwner) return salesList || [];

  return (salesList || []).filter(s => {
    const linkedOrd = window.posLinkedOrdersMap?.get(String(s.codigo_venta)) || null;
    const mInfo = window.resolvePosSaleMachineInfo(s, window.posCommerceConfigsMap, linkedOrd);
    const fin = window.calculatePosSaleFinancials(s, mInfo);
    const abInfo = window.resolvePosSaleAbonoPeriod(s, linkedOrd, mInfo, fin);

    if (fOwner === 'STOCKA' && !mInfo.isStockaMachine) return false;
    if (fOwner === 'COMERCIO' && mInfo.isStockaMachine) return false;

    if (fPeriod) {
      if (fPeriod === 'CON_ABONO') {
        if (!abInfo.isAbono) return false;
      } else if (abInfo.period !== fPeriod) {
        return false;
      }
    }
    return true;
  });
}

function renderSelectedCommercePosBanner(selectedCommerce, filteredSales) {
  const bannerEl = document.getElementById('pos-selected-commerce-summary-banner');
  if (!bannerEl) return;

  if (!selectedCommerce) {
    bannerEl.style.display = 'none';
    bannerEl.innerHTML = '';
    return;
  }

  const mInfo = window.resolvePosSaleMachineInfo({ comercio: selectedCommerce, modo_pago: 'Tarjeta de Débito' }, window.posCommerceConfigsMap);
  const dotColor = mInfo.colorHex || '#2563eb';
  const readableColor = (typeof window.getPosReadableTextColor === 'function') ? window.getPosReadableTextColor(dotColor) : dotColor;
  const posSvg = window.getPosMachineSvg(dotColor, 34);

  let totalGross = 0;
  let totalComm = 0;
  let totalNetAbono = 0;
  const periodTotalsMap = {};

  (filteredSales || []).forEach(s => {
    const linkedOrd = window.posLinkedOrdersMap?.get(String(s.codigo_venta)) || null;
    const sMach = window.resolvePosSaleMachineInfo(s, window.posCommerceConfigsMap, linkedOrd);
    const fin = window.calculatePosSaleFinancials(s, sMach);
    const ab = window.resolvePosSaleAbonoPeriod(s, linkedOrd, sMach, fin);

    totalGross += fin.grossAmount;
    totalComm += fin.commissionTotal;
    if (sMach.isStockaMachine && fin.isCard) {
      totalNetAbono += fin.sellerPayout;
    }
    if (ab.isAbono && ab.period) {
      periodTotalsMap[ab.period] = (periodTotalsMap[ab.period] || 0) + fin.sellerPayout;
    }
  });

  const topPeriod = Object.keys(periodTotalsMap)[0] || '';
  const periodPillsHtml = Object.entries(periodTotalsMap).map(([pName, amt]) => `
    <span onclick="window.openPosCommerceInBillingManager('${escapeHtml(selectedCommerce)}', '${escapeHtml(pName)}')" style="cursor: pointer; background: rgba(16, 185, 129, 0.12); color: #047857; border: 1px solid rgba(16, 185, 129, 0.35); padding: 0.22rem 0.65rem; border-radius: 6px; font-size: 0.75rem; font-weight: 800; display: inline-flex; align-items: center; gap: 0.3rem;" title="Abrir ${escapeHtml(pName)} en Gestor de Facturación">
      <i class="ri-calendar-check-line"></i> ${escapeHtml(pName)}: ${formatCLP(amt)} <i class="ri-external-link-line" style="font-size: 0.72rem;"></i>
    </span>
  `).join('');

  bannerEl.style.display = 'block';
  bannerEl.innerHTML = `
    <div style="background: linear-gradient(135deg, ${dotColor}10 0%, var(--color-surface) 100%); border: 1.5px solid ${dotColor}45; border-left: 5px solid ${dotColor}; border-radius: 12px; padding: 1rem 1.25rem; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1rem; box-shadow: 0 2px 10px rgba(0,0,0,0.04);">
      <div style="display: flex; align-items: center; gap: 0.9rem; flex-wrap: wrap;">
        <div style="width: 46px; height: 46px; border-radius: 10px; background: #ffffff; border: 1.5px solid ${dotColor}55; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 2px 6px rgba(0,0,0,0.06);">
          ${posSvg}
        </div>
        <div>
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <strong style="font-size: 1rem; color: var(--color-text-main);">${escapeHtml(selectedCommerce)}</strong>
            <span style="background: ${dotColor}18; color: ${readableColor}; border: 1px solid ${dotColor}45; font-size: 0.74rem; font-weight: 800; padding: 0.15rem 0.55rem; border-radius: 6px; font-family: monospace;">
              ${escapeHtml(mInfo.brand)} ${mInfo.displayModel ? escapeHtml(mInfo.displayModel) : ''} ${mInfo.color ? '· ' + escapeHtml(mInfo.color) : ''}
            </span>
            ${mInfo.isStockaMachine ? `
              <span style="background: rgba(37, 99, 235, 0.12); color: #1d4ed8; border: 1px solid rgba(37, 99, 235, 0.3); font-size: 0.72rem; font-weight: 800; padding: 0.15rem 0.55rem; border-radius: 999px; display: inline-flex; align-items: center; gap: 0.25rem;">
                <i class="ri-shield-star-line"></i> Propiedad de STOCKA (Aplica Abono Fulfillment)
              </span>
            ` : `
              <span style="background: rgba(139, 92, 246, 0.12); color: #6d28d9; border: 1px solid rgba(139, 92, 246, 0.3); font-size: 0.72rem; font-weight: 800; padding: 0.15rem 0.55rem; border-radius: 999px; display: inline-flex; align-items: center; gap: 0.25rem;">
                <i class="ri-store-2-line"></i> ${escapeHtml(mInfo.owner)} (Recaudación Directa Comercio)
              </span>
            `}
          </div>
          <div style="font-size: 0.78rem; color: var(--color-text-muted); margin-top: 0.3rem; display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
            <span><strong>Ventas filtradas:</strong> ${(filteredSales || []).length} (${formatCLP(totalGross)} bruto)</span>
            ${mInfo.isStockaMachine ? `
              <span>· <strong>Comisión POS (+IVA):</strong> <span style="color: #d97706; font-weight: 700;">-${formatCLP(totalComm)}</span></span>
              <span>· <strong>Abono Neto al Seller:</strong> <span style="color: #059669; font-weight: 800;">${formatCLP(totalNetAbono)}</span></span>
            ` : `
              <span>· <strong>Comisión POS Stocka:</strong> $0 (Terminal propio del seller)</span>
            `}
          </div>
        </div>
      </div>

      <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
        ${periodPillsHtml}
        <button type="button" class="btn btn-sm btn-primary" onclick="window.openPosCommerceInBillingManager('${escapeHtml(selectedCommerce)}', '${escapeHtml(topPeriod)}')" style="background: #5f06fa; border-color: #5f06fa; font-size: 0.76rem; font-weight: 700; display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.4rem 0.8rem; border-radius: 8px;">
          <i class="ri-calculator-line"></i> Ver Abono en Gestor de Facturación
        </button>
      </div>
    </div>
  `;
}

async function fetchAndRenderPosData(options = {}) {
  const tbody = document.getElementById('pos-admin-tbody');
  const btnPrev = document.getElementById('btn-pos-prev-page');
  const btnNext = document.getElementById('btn-pos-next-page');
  const info = document.getElementById('pos-pagination-info');

  if (!tbody) return;
  const hadExistingRows = tbody.querySelectorAll('tr').length > 1;
  const savedWindowScrollY = window.scrollY;
  const mainContainer = document.querySelector('.main-content') || document.scrollingElement;
  const savedMainScrollTop = mainContainer ? mainContainer.scrollTop : 0;

  if (!hadExistingRows && !options.preserveScroll) {
    tbody.innerHTML = '<tr><td colspan="12" class="text-center" style="padding: 2rem;"><i class="ri-loader-4-line spin" style="font-size: 1.5rem; display: inline-block;"></i> Cargando ventas...</td></tr>';
  }
  if (btnPrev) btnPrev.disabled = true;
  if (btnNext) btnNext.disabled = true;

  try {
    await window.ensurePosMetadataLoaded();

    // 1. Consultar todas las ventas que coinciden con los filtros de BD para calcular KPIs exactos y filtrar por periodo/máquina
    let query = supabase.from('store_sales').select('*').order('created_at', { ascending: false });
    query = buildPosSalesQuery(query);

    const { data: rawSales, error } = await query;
    if (error) throw error;

    // 2. Consultar pedidos vinculados en public.orders por external_order_number para enriquecer periodo_facturacion y pos_machine
    window.posLinkedOrdersMap = window.posLinkedOrdersMap || new Map();
    const saleCodes = Array.from(new Set((rawSales || []).map(s => s.codigo_venta).filter(Boolean)));
    if (saleCodes.length > 0) {
      try {
        const { data: linkedOrders } = await supabase
          .from('orders')
          .select('id, external_order_number, periodo_facturacion, raw_shopify_data')
          .in('external_order_number', saleCodes);
        (linkedOrders || []).forEach(o => {
          if (o.id) window.posLinkedOrdersMap.set(String(o.id), o);
          if (o.external_order_number) window.posLinkedOrdersMap.set(String(o.external_order_number), o);
        });
      } catch (eOrd) {
        console.warn('Aviso consultando pedidos vinculados POS:', eOrd);
      }
    }

    // 3. Aplicar filtros de Periodo de Abono y Propiedad de Máquina POS
    window.posAllLoadedSales = rawSales || [];
    const allFilteredSales = applyClientSidePosFilters(rawSales || []);
    const count = allFilteredSales.length;

    // Paginar en memoria sobre el resultado filtrado
    const from = (posCurrentPage - 1) * posPageSize;
    const to = from + posPageSize;
    const sales = allFilteredSales.slice(from, to);

    // 4. Guardar en cache para acceso instantáneo por ID o código
    window.posSalesCache = window.posSalesCache || new Map();
    window.posSalesCache.clear();
    allFilteredSales.forEach(s => {
      window.posSalesCache.set(String(s.id), s);
      if (s.codigo_venta) window.posSalesCache.set(String(s.codigo_venta), s);
    });

    // 5. Actualizar KPIs dinámicos y Banner de Comercio Seleccionado
    await updatePosKpis(allFilteredSales);
    const selectedCommerce = document.getElementById('filter-pos-commerce')?.value || '';
    renderSelectedCommercePosBanner(selectedCommerce, allFilteredSales);

    const availablePeriods = window.getAvailablePosBillingPeriodNames(
      allFilteredSales.map(s => {
        const lOrd = window.posLinkedOrdersMap?.get(String(s.codigo_venta)) || null;
        return window.resolvePosSaleAbonoPeriod(s, lOrd).period;
      })
    );

    // 6. Renderizar filas
    let html = '';
    if (!sales || sales.length === 0) {
      html = '<tr><td colspan="12" class="text-center" style="padding: 2.5rem; color: var(--color-text-muted);">No se encontraron ventas con los filtros aplicados.</td></tr>';
    } else {
      sales.forEach(s => {
        const d = new Date(s.created_at);
        const dateStr = d.toLocaleDateString('es-CL') + ' ' + d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
        const montoFmt = formatCLP(s.monto_total);

        const linkedOrd = window.posLinkedOrdersMap?.get(String(s.codigo_venta)) || null;
        const mInfo = window.resolvePosSaleMachineInfo(s, window.posCommerceConfigsMap, linkedOrd);
        const fin = window.calculatePosSaleFinancials(s, mInfo);
        const abonoInfo = window.resolvePosSaleAbonoPeriod(s, linkedOrd, mInfo, fin);

        // Desglose de productos
        let prodSummary = 'Sin ítems';
        let totalQty = 0;
        if (s.productos) {
          try {
            let parsed = s.productos;
            if (typeof parsed === 'string') parsed = JSON.parse(parsed);
            if (Array.isArray(parsed)) {
              totalQty = parsed.reduce((sum, p) => sum + (parseInt(p.cantidad, 10) || 1), 0);
              const itemsList = parsed.map(p => `${p.cantidad || 1}x ${escapeHtml(p.producto || p.name || 'Ítem')}`);
              if (itemsList.length <= 2) {
                prodSummary = itemsList.join('<br>');
              } else {
                prodSummary = `${itemsList[0]}<br><small class="text-muted">+ ${itemsList.length - 1} producto(s) más (${totalQty} un)</small>`;
              }
            }
          } catch(e) {}
        }

        // Selector inline de Método de Pago y Badge de Documento
        const paymentSelectHtml = window.renderPosPaymentSelectHtml(s);
        const docBadge = (s.documento_tipo === 'FACTURA')
          ? `<span class="badge" style="background: rgba(139, 92, 246, 0.12); color: #7c3aed; border: 1px solid rgba(139, 92, 246, 0.3); font-size: 0.72rem;"><i class="ri-file-paper-2-line"></i> Factura</span>`
          : `<span class="badge" style="background: rgba(59, 130, 246, 0.1); color: #2563eb; border: 1px solid rgba(59, 130, 246, 0.25); font-size: 0.72rem;"><i class="ri-bill-line"></i> Boleta</span>`;

        // Columnas dinámicas: Máquina de Pago, Pago al Seller y Periodo / Código de Transacción
        const machineColHtml = window.renderPosMachineColHtml(mInfo);
        const sellerPayoutColHtml = window.renderPosSellerPayoutColHtml(fin);
        const periodColHtml = window.renderPosPeriodColHtml(s, linkedOrd, mInfo, fin, abonoInfo, availablePeriods);

        // Badge de Orden WMS
        let orderBadge = `<span class="text-muted" style="font-size: 0.8rem; font-style: italic;">Sin vincular</span>`;
        const ordMatch = (s.comentarios || '').match(/\[WMS-ORD:\s*([a-zA-Z0-9-]+)\]/);
        const wmsOrdId = s.wms_order_id || (ordMatch ? ordMatch[1] : (linkedOrd?.id || null));
        if (wmsOrdId) {
          orderBadge = `<span class="badge badge-info" style="cursor: pointer;" onclick="window.filterOrderInGestor('${wmsOrdId}', '${escapeHtml(s.codigo_venta)}')" title="Ver en Gestor de Pedidos"><i class="ri-box-3-line"></i> #${escapeHtml(s.codigo_venta)}</span>`;
        }

        html += `
          <tr id="pos-row-${s.id}" style="transition: background-color 0.2s;">
            <td style="white-space: nowrap; font-size: 0.82rem;">
              <i class="ri-calendar-line" style="color: var(--color-text-muted); margin-right: 0.25rem;"></i>${dateStr}
              <div style="font-size: 0.7rem; color: var(--color-text-muted); margin-top: 1px;">
                <i class="ri-map-pin-line" style="color: var(--color-primary);"></i> ${escapeHtml(s.sucursal || SUCURSAL_NUNOA_NAME)}
              </div>
            </td>
            <td>
              <span style="font-family: monospace; font-size: 0.82rem; font-weight: 700; background: var(--color-bg); padding: 0.2rem 0.45rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); letter-spacing: 0.4px; white-space: nowrap;">
                ${escapeHtml(s.codigo_venta || 'N/A')}
              </span>
            </td>
            <td>
              <strong style="color: var(--color-text-main); font-size: 0.84rem;">${escapeHtml(s.comercio || 'N/A')}</strong>
            </td>
            <td>
              <div style="font-size: 0.84rem; font-weight: 600; color: var(--color-text-main);">${escapeHtml(s.nombre_cliente || 'Consumidor Final')}</div>
              ${s.correo_cliente ? `<div style="font-size: 0.73rem; color: var(--color-text-muted);"><i class="ri-mail-line"></i> ${escapeHtml(s.correo_cliente)}</div>` : ''}
            </td>
            <td style="font-size: 0.82rem; line-height: 1.35; max-width: 240px;">
              ${prodSummary}
            </td>
            <td style="text-align: right; white-space: nowrap;">
              <strong style="color: #0284c7; font-size: 0.96rem;">${montoFmt}</strong>
            </td>
            <td>
              <div style="display: flex; flex-direction: column; gap: 0.25rem; align-items: flex-start;">
                ${paymentSelectHtml}
                ${docBadge}
              </div>
            </td>
            <td id="pos-machine-cell-${s.id}">
              ${machineColHtml}
            </td>
            <td id="pos-payout-cell-${s.id}" style="text-align: right; white-space: nowrap;">
              ${sellerPayoutColHtml}
            </td>
            <td id="pos-period-cell-${s.id}">
              ${periodColHtml}
            </td>
            <td>
              ${orderBadge}
            </td>
            <td style="text-align: center; white-space: nowrap;">
              <div style="display: flex; gap: 0.35rem; justify-content: center;">
                <button class="btn btn-outline btn-sm" onclick="window.openPosSaleDetail('${s.id}')" style="padding: 0.3rem 0.55rem; font-size: 0.76rem;" title="Ver Detalle y Liquidación POS">
                  <i class="ri-search-eye-line" style="color: var(--color-primary);"></i> Detalle
                </button>
                <button class="btn btn-outline btn-sm" onclick="window.printPosTicket('${s.id}')" style="padding: 0.3rem 0.55rem; font-size: 0.76rem;" title="Imprimir Comprobante Térmico">
                  <i class="ri-printer-line"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
      });
    }

    tbody.innerHTML = html;

    if (hadExistingRows || options.preserveScroll) {
      if (mainContainer && savedMainScrollTop > 0) mainContainer.scrollTop = savedMainScrollTop;
      if (savedWindowScrollY > 0) window.scrollTo(0, savedWindowScrollY);
    }

    const currentEnd = Math.min(from + posPageSize, count || 0);
    if (info) {
      info.textContent = `Mostrando ${count === 0 ? 0 : from + 1} a ${currentEnd} de ${count || 0} registros`;
    }

    if (btnPrev) btnPrev.disabled = posCurrentPage <= 1;
    if (btnNext) btnNext.disabled = currentEnd >= (count || 0);

  } catch (err) {
    console.error('Error cargando ventas POS:', err);
    tbody.innerHTML = `<tr><td colspan="12" class="text-center text-danger" style="padding: 2rem;">Error al cargar ventas: ${err.message}</td></tr>`;
  }
}

// Función para actualizar tarjetas KPI superiores (dinámicas según filtros activos)
async function updatePosKpis(filteredSalesList = null) {
  try {
    let list = filteredSalesList;
    if (!Array.isArray(list)) {
      const { data: allSales } = await supabase.from('store_sales').select('*').order('created_at', { ascending: false });
      list = applyClientSidePosFilters(allSales || []);
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    let totalSalesCount = list.length;
    let totalUnits = 0;
    let totalGross = 0;
    let totalCommStocka = 0;
    let totalNetAbonoStocka = 0;
    let stockaSalesCount = 0;
    let todayCount = 0;
    const uniqueCommerces = new Set();

    list.forEach(s => {
      const createdTime = new Date(s.created_at).getTime();
      if (createdTime >= todayStart) todayCount++;
      if (s.comercio) uniqueCommerces.add(s.comercio.trim().toUpperCase());

      if (s.productos) {
        try {
          const parsed = typeof s.productos === 'string' ? JSON.parse(s.productos) : s.productos;
          if (Array.isArray(parsed)) {
            totalUnits += parsed.reduce((acc, p) => acc + (parseInt(p.cantidad, 10) || 1), 0);
          }
        } catch (_) {}
      }

      const linkedOrd = window.posLinkedOrdersMap?.get(String(s.codigo_venta)) || null;
      const mInfo = window.resolvePosSaleMachineInfo(s, window.posCommerceConfigsMap, linkedOrd);
      const fin = window.calculatePosSaleFinancials(s, mInfo);

      totalGross += fin.grossAmount;
      if (fin.appliesStockaCommission) {
        totalCommStocka += fin.commissionTotal;
        totalNetAbonoStocka += fin.sellerPayout;
        stockaSalesCount++;
      } else if (mInfo.isStockaMachine) {
        totalNetAbonoStocka += fin.sellerPayout;
        stockaSalesCount++;
      }
    });

    const fCommerce = document.getElementById('filter-pos-commerce')?.value || '';
    const fPeriod = document.getElementById('filter-pos-period')?.value || '';
    const hasFilter = Boolean(
      fCommerce ||
      fPeriod ||
      document.getElementById('filter-pos-machine-owner')?.value ||
      document.getElementById('filter-pos-payment')?.value ||
      document.getElementById('filter-pos-doc')?.value ||
      document.getElementById('filter-pos-search')?.value?.trim() ||
      document.getElementById('filter-pos-date-from')?.value ||
      document.getElementById('filter-pos-date-to')?.value
    );

    const kpiCount = document.getElementById('pos-kpi-total-month');
    const kpiUnits = document.getElementById('pos-kpi-sub-units');
    const kpiLabelCount = document.getElementById('pos-kpi-label-count');
    const kpiMonto = document.getElementById('pos-kpi-monto-month');
    const kpiSubMonto = document.getElementById('pos-kpi-sub-monto');
    const kpiComm = document.getElementById('pos-kpi-comisiones-stocka');
    const kpiSubComm = document.getElementById('pos-kpi-sub-comisiones');
    const kpiAbono = document.getElementById('pos-kpi-abono-seller');
    const kpiSubAbono = document.getElementById('pos-kpi-sub-abono');
    const kpiCommerces = document.getElementById('pos-kpi-active-merchants');
    const kpiToday = document.getElementById('pos-kpi-today-count');

    if (kpiLabelCount) kpiLabelCount.textContent = hasFilter ? 'Ventas Filtradas' : 'Total Ventas POS';
    if (kpiCount) kpiCount.textContent = totalSalesCount;
    if (kpiUnits) kpiUnits.textContent = `(${totalUnits} un.)`;
    if (kpiMonto) kpiMonto.textContent = formatCLP(totalGross);
    if (kpiSubMonto) kpiSubMonto.textContent = fCommerce ? `Comercio: ${fCommerce}` : (fPeriod ? `Periodo: ${fPeriod}` : 'Total bruto acumulado');
    if (kpiComm) kpiComm.textContent = formatCLP(totalCommStocka);
    if (kpiSubComm) kpiSubComm.textContent = `${stockaSalesCount} venta(s) en Máquina Stocka`;
    if (kpiAbono) kpiAbono.textContent = formatCLP(totalNetAbonoStocka);
    if (kpiSubAbono) kpiSubAbono.textContent = fPeriod && !['PAGO_DIRECTO', 'RECAUDACION_COMERCIO', 'SIN_ASIGNAR'].includes(fPeriod)
      ? `Abono para ${fPeriod}`
      : 'Monto neto a abonar al seller';
    if (kpiCommerces) kpiCommerces.textContent = uniqueCommerces.size;
    if (kpiToday) kpiToday.textContent = todayCount;

  } catch (e) {
    console.warn('Error calculando KPIs de POS:', e);
  }
}

// Helper para filtrar orden en el Gestor de Pedidos
window.filterOrderInGestor = function(orderId, orderCode) {
  const navGestor = document.querySelector('.nav-item[data-view="orders_admin"]');
  if (navGestor) {
    navGestor.click();
    setTimeout(() => {
      const searchInput = document.getElementById('search-orders');
      if (searchInput) {
        searchInput.value = orderCode || orderId;
        searchInput.dispatchEvent(new Event('input'));
      }
    }, 300);
  }
};

// ====== 3. MODAL WIZARD: REGISTRO DE VENTA EN SUCURSAL ======

window.openCreatePosSaleModal = async function() {
  const modal = document.getElementById('modal-pos-sale');
  if (!modal) {
    console.error('Modal #modal-pos-sale no encontrado en el DOM');
    return;
  }

  // 1. Mostrar modal inmediatamente para feedback instantáneo
  modal.classList.add('active');

  // 2. Resetear Wizard al paso 1
  window.goToPosStep(1);

  // 3. Resetear formulario y datos del cliente de forma segura
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };
  setVal('pos-customer-name', '');
  setVal('pos-customer-email', '');
  setVal('pos-customer-phone', '');
  setVal('pos-customer-phone-number', '');
  const phoneCountrySel = document.getElementById('pos-customer-phone-country');
  if (phoneCountrySel) {
    phoneCountrySel.value = '+56';
    if (typeof window.handlePosPhoneCountryChange === 'function') {
      window.handlePosPhoneCountryChange();
    }
  }
  const phoneNumInput = document.getElementById('pos-customer-phone-number');
  if (phoneNumInput) {
    phoneNumInput.oninput = () => {
      if (typeof window.handlePosPhoneInput === 'function') {
        window.handlePosPhoneInput();
      }
    };
  }
  const phoneValMsg = document.getElementById('pos-phone-validation-msg');
  if (phoneValMsg) phoneValMsg.style.display = 'none';

  setVal('pos-comments', '');
  setVal('pos-tx-code-input', '');
  const txInputEl = document.getElementById('pos-tx-code-input');
  if (txInputEl) {
    txInputEl.style.borderColor = '';
    txInputEl.dataset.txDuplicate = 'false';
  }
  const txValMsg = document.getElementById('pos-tx-code-validation-msg');
  if (txValMsg) {
    txValMsg.style.color = 'var(--color-text-muted)';
    txValMsg.innerHTML = 'Código único e irrepetible de la operación POS/pago (no admite espacios ni duplicados).';
  }
  setVal('pos-factura-rut', '');
  setVal('pos-factura-razon-social', '');
  setVal('pos-factura-giro', '');
  setVal('pos-factura-direccion', '');

  const badgesContainer = document.getElementById('pos-commerce-badges-container');
  if (badgesContainer) badgesContainer.innerHTML = '';

  // 4. Resetear documento a Boleta
  window.selectPosDocTipo('BOLETA');

  // 5. Resetear medios de pago disponibles y selección inicial
  window.posSelectedCommerceConfig = null;
  window.updatePosAvailablePaymentMethods();
  window.selectPosModoPago('Tarjeta de Débito');

  // 6. Generar código de venta inicial
  window.regeneratePosCode();

  // 7. Limpiar filas de productos y resumen
  const tbody = document.getElementById('pos-products-tbody');
  if (tbody) tbody.innerHTML = '';
  window.calculatePosTotals();

  // 8. Poblar selector de comercios
  const commerceSelect = document.getElementById('pos-select-commerce');
  if (commerceSelect) {
    commerceSelect.innerHTML = '<option value="">Selecciona comercio...</option>';
    try {
      const list = await window.getPosUniqueMerchantsList({ onlyActive: true });
      list.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        commerceSelect.appendChild(opt);
      });
    } catch (e) {
      console.warn('Aviso cargando comercios individuales para modal POS:', e);
    }

    commerceSelect.onchange = async () => {
      const selected = commerceSelect.value;
      if (selected) {
        await window.loadPosCommerceCatalog(selected);
        window.regeneratePosCode();
        window.updatePosAvailablePaymentMethods();
        window.updatePosPaymentMachineBanner();
      } else {
        window.posSelectedCommerceConfig = null;
        if (badgesContainer) badgesContainer.innerHTML = '';
        if (tbody) tbody.innerHTML = '';
        window.calculatePosTotals();
        window.updatePosAvailablePaymentMethods();
        window.updatePosPaymentMachineBanner();
      }
    };
  }

  // 9. Configurar listener de cambio de modo manual
  const manualCheckbox = document.getElementById('pos-manual-mode');
  if (manualCheckbox) {
    manualCheckbox.onchange = () => {
      if (tbody) tbody.innerHTML = '';
      window.addPosRow(manualCheckbox.checked);
      window.calculatePosTotals();
    };
  }

  // 10. Configurar listener para actualizar banner de transferencia si cambia el código
  const codeInput = document.getElementById('pos-codigo-venta');
  if (codeInput) {
    codeInput.oninput = () => {
      if (document.getElementById('pos-modo-pago')?.value === 'Transferencia') {
        window.updatePosPaymentMachineBanner();
      }
    };
  }
};

// Navegación entre pasos del Wizard
window.goToPosStep = function(targetStep) {
  const currentStep = window.posCurrentStep || 1;

  // Validaciones si se avanza
  if (targetStep > currentStep) {
    if (currentStep === 1) {
      const commerce = document.getElementById('pos-select-commerce')?.value;
      if (!commerce) {
        Swal.fire({
          icon: 'warning',
          title: 'Comercio Requerido',
          text: 'Por favor selecciona el comercio para el cual se registra la venta.',
          confirmButtonColor: 'var(--color-primary)'
        });
        return;
      }

      // Validar si el comercio tiene activo el Punto de Venta (POS)
      if (window.posSelectedCommerceConfig?.onboarding_checklist?.pos_active !== true) {
        Swal.fire({
          icon: 'error',
          title: 'Punto de Venta Deshabilitado',
          text: `El comercio "${commerce}" tiene deshabilitada la opción de Punto de Venta en la configuración de comercios. Por favor actívalo en Admin > Comercios para registrar ventas presenciales.`,
          confirmButtonColor: 'var(--color-primary)'
        });
        return;
      }

      const clientName = document.getElementById('pos-customer-name')?.value.trim();
      if (!clientName) {
        Swal.fire({
          icon: 'warning',
          title: 'Cliente Requerido',
          text: 'Por favor ingresa el nombre del cliente.',
          confirmButtonColor: 'var(--color-primary)'
        });
        document.getElementById('pos-customer-name')?.focus();
        return;
      }

      const clientEmail = document.getElementById('pos-customer-email')?.value.trim();
      if (!clientEmail || !clientEmail.includes('@')) {
        Swal.fire({
          icon: 'warning',
          title: 'Email Válido Requerido',
          text: 'Por favor ingresa un correo electrónico válido para el envío de información del pedido.',
          confirmButtonColor: 'var(--color-primary)'
        });
        document.getElementById('pos-customer-email')?.focus();
        return;
      }

      // Validar formato del teléfono según el país seleccionado (si se ingresó)
      if (typeof window.validatePosCustomerPhone === 'function') {
        const phoneValidation = window.validatePosCustomerPhone();
        if (!phoneValidation.isValid) {
          Swal.fire({
            icon: 'warning',
            title: 'Teléfono Inválido',
            text: phoneValidation.message,
            confirmButtonColor: 'var(--color-primary)'
          });
          document.getElementById('pos-customer-phone-number')?.focus();
          return;
        }
      }

      // Validar datos de factura si corresponde
      const docTipo = document.getElementById('pos-documento-tipo')?.value;
      if (docTipo === 'FACTURA') {
        const fRut = document.getElementById('pos-factura-rut')?.value.trim();
        const fRazon = document.getElementById('pos-factura-razon-social')?.value.trim();
        if (!fRut || !fRazon) {
          Swal.fire({
            icon: 'warning',
            title: 'Datos de Facturación Incompletos',
            text: 'Para emitir Factura Electrónica debes ingresar al menos el RUT y la Razón Social.',
            confirmButtonColor: 'var(--color-primary)'
          });
          return;
        }
      }
    }

    if (currentStep === 2) {
      const rows = document.querySelectorAll('#pos-products-tbody tr');
      if (rows.length === 0) {
        Swal.fire({
          icon: 'warning',
          title: 'Agrega al menos un producto',
          text: 'Debes agregar al menos un producto para completar la venta.',
          confirmButtonColor: 'var(--color-primary)'
        });
        return;
      }

      // Validar que todas las filas tengan SKU/Nombre, cantidad > 0 y precio >= 0
      let hasError = false;
      let errorMsg = '';
      const isManual = document.getElementById('pos-manual-mode')?.checked;

      rows.forEach((row, idx) => {
        if (hasError) return;
        const qty = parseInt(row.querySelector('.pos-row-qty')?.value, 10) || 0;
        const price = parseInt(row.querySelector('.pos-row-price')?.value, 10) || 0;

        if (qty <= 0) {
          hasError = true;
          errorMsg = `La cantidad en la fila #${idx + 1} debe ser mayor a 0.`;
          return;
        }

        if (price <= 0) {
          hasError = true;
          errorMsg = `Por favor ingresa el Precio Unitario en la fila #${idx + 1}. Debes usar estrictamente el valor vigente dado por el comercio en su web o el precio autorizado por el mismo comercio.`;
          return;
        }

        if (isManual) {
          const sku = row.querySelector('.pos-row-sku')?.value.trim();
          const name = row.querySelector('.pos-row-name')?.value.trim();
          if (!sku || !name) {
            hasError = true;
            errorMsg = `Por favor completa el SKU y el Nombre del producto en la fila #${idx + 1}.`;
            return;
          }
        } else {
          const prodInput = row.querySelector('.pos-row-catalog-input')?.value.trim();
          if (!prodInput) {
            hasError = true;
            errorMsg = `Por favor selecciona un producto del catálogo en la fila #${idx + 1}.`;
            return;
          }

          // Validar stock disponible si el comercio tiene seguimiento activo
          if (window.posSelectedCommerceConfig?.inventario_seguimiento) {
            const availStock = parseInt(row.dataset.stock, 10) || 0;
            if (qty > availStock) {
              hasError = true;
              errorMsg = `La cantidad (${qty} un) supera el stock disponible en Ñuñoa (${availStock} un) para "${prodInput}".`;
              return;
            }
          }
        }
      });

      if (hasError) {
        Swal.fire({
          icon: 'warning',
          title: 'Verificar Productos',
          text: errorMsg,
          confirmButtonColor: 'var(--color-primary)'
        });
        return;
      }

      // Actualizar resumen en Paso 3
      const commerceName = document.getElementById('pos-select-commerce')?.value;
      const clientName = document.getElementById('pos-customer-name')?.value;
      const totalAmount = document.getElementById('pos-summary-total')?.textContent;
      const totalQty = Array.from(rows).reduce((acc, r) => acc + (parseInt(r.querySelector('.pos-row-qty')?.value, 10) || 0), 0);

      document.getElementById('pos-confirm-commerce').textContent = commerceName || '-';
      document.getElementById('pos-confirm-client').textContent = `Cliente: ${clientName || '-'}`;
      document.getElementById('pos-confirm-total').textContent = totalAmount || '$0';
      document.getElementById('pos-confirm-items-count').textContent = `${totalQty} unidades (${rows.length} producto${rows.length > 1 ? 's' : ''})`;

      // Actualizar opciones de pago activas para el comercio y recuadro notorio de máquina de cobro asignada
      window.updatePosAvailablePaymentMethods();
      window.updatePosPaymentMachineBanner();
    }
  }

  // Cambiar pestaña activa
  window.posCurrentStep = targetStep;

  // Actualizar indicadores de pasos
  [1, 2, 3].forEach(step => {
    const tab = document.getElementById(`pos-wizard-tab-${step}`);
    const container = document.getElementById(`pos-wizard-step-${step}`);
    const line = document.getElementById(`pos-wizard-line-${step}`);

    if (container) {
      container.style.display = (step === targetStep) ? 'block' : 'none';
    }

    if (tab) {
      const numSpan = tab.querySelector('.step-num');
      if (step === targetStep) {
        tab.style.color = 'var(--color-primary)';
        if (numSpan) {
          numSpan.style.background = 'var(--color-primary)';
          numSpan.style.color = 'white';
          numSpan.style.boxShadow = '0 0 0 4px rgba(59, 130, 246, 0.15)';
        }
      } else if (step < targetStep) {
        tab.style.color = '#10b981';
        if (numSpan) {
          numSpan.style.background = '#10b981';
          numSpan.style.color = 'white';
          numSpan.style.boxShadow = 'none';
        }
      } else {
        tab.style.color = 'var(--color-text-muted)';
        if (numSpan) {
          numSpan.style.background = 'var(--color-bg-dark, #cbd5e1)';
          numSpan.style.color = 'var(--color-text-muted)';
          numSpan.style.boxShadow = 'none';
        }
      }
    }

    if (line) {
      line.style.background = (step < targetStep) ? '#10b981' : 'var(--color-border)';
    }
  });

  // Botones footer
  const btnPrev = document.getElementById('btn-pos-prev');
  const btnNext = document.getElementById('btn-pos-next');
  const btnSave = document.getElementById('btn-pos-save');

  if (btnPrev) btnPrev.style.display = (targetStep > 1) ? 'inline-flex' : 'none';
  if (btnNext) btnNext.style.display = (targetStep < 3) ? 'inline-flex' : 'none';
  if (btnSave) btnSave.style.display = (targetStep === 3) ? 'inline-flex' : 'none';
};

// Delegación de eventos global para controles del modal y wizard POS
document.addEventListener('click', (e) => {
  // Cerrar menús de búsqueda de productos al hacer clic fuera
  if (!e.target.closest('.pos-product-search-wrapper')) {
    document.querySelectorAll('.pos-product-dropdown-list').forEach(d => {
      d.style.display = 'none';
    });
    document.querySelectorAll('.pos-dropdown-arrow').forEach(a => {
      a.style.transform = 'rotate(0deg)';
    });
  }

  // 1. Abrir modal registrar venta
  if (e.target.closest('#btn-open-create-pos-sale')) {
    e.preventDefault();
    window.openCreatePosSaleModal();
    return;
  }

  // 2. Tabs del wizard
  const tab = e.target.closest('.pos-wizard-step-tab');
  if (tab && tab.id) {
    const stepMatch = tab.id.match(/pos-wizard-tab-(\d+)/);
    if (stepMatch) {
      e.preventDefault();
      window.goToPosStep(parseInt(stepMatch[1], 10));
      return;
    }
  }

  // 3. Botón Volver
  if (e.target.closest('#btn-pos-prev')) {
    e.preventDefault();
    if (window.posCurrentStep > 1) window.goToPosStep(window.posCurrentStep - 1);
    return;
  }

  // 4. Botón Siguiente
  if (e.target.closest('#btn-pos-next')) {
    e.preventDefault();
    if (window.posCurrentStep < 3) window.goToPosStep(window.posCurrentStep + 1);
    return;
  }

  // 5. Botón Agregar Producto
  if (e.target.closest('#btn-pos-add-row')) {
    e.preventDefault();
    const isManual = document.getElementById('pos-manual-mode')?.checked || false;
    window.addPosRow(isManual);
    return;
  }

  // 6. Eliminar fila de producto
  const btnRemove = e.target.closest('.btn-remove-pos-row');
  if (btnRemove) {
    e.preventDefault();
    const tr = btnRemove.closest('tr');
    if (tr) {
      tr.remove();
      window.calculatePosTotals();
    }
    return;
  }

  // 7. Cerrar modales al hacer clic fuera del contenido o en botón de cierre
  const isPosSaleCloseBtn = e.target.closest('#btn-close-pos-sale') || e.target.closest('[data-close="modal-pos-sale"]');
  if (isPosSaleCloseBtn || e.target.id === 'modal-pos-sale') {
    e.preventDefault();
    e.stopPropagation();
    window.confirmAndClosePosModal();
    return;
  }

  if (e.target.id === 'modal-pos-detail') {
    e.target.classList.remove('active');
    return;
  }
});

// Helper para verificar si hay trabajo o datos sin guardar en el modal POS
window.hasPosSaleWorkInProgress = function() {
  const modal = document.getElementById('modal-pos-sale');
  if (!modal || !modal.classList.contains('active')) return false;

  // 1. Comercio seleccionado
  const commerce = document.getElementById('pos-select-commerce')?.value;
  if (commerce) return true;

  // 2. Datos de cliente ingresados
  const custName = document.getElementById('pos-customer-name')?.value.trim();
  const custEmail = document.getElementById('pos-customer-email')?.value.trim();
  const custPhone = document.getElementById('pos-customer-phone')?.value.trim();
  if (custName || custEmail || custPhone) return true;

  // 3. Productos en la tabla
  const rows = document.querySelectorAll('#pos-products-tbody tr');
  for (const r of rows) {
    if (r.dataset.productId || r.dataset.sku) return true;
    const catalogInput = r.querySelector('.pos-row-catalog-input')?.value.trim();
    if (catalogInput) return true;
    const sku = r.querySelector('.pos-row-sku')?.value.trim();
    const name = r.querySelector('.pos-row-name')?.value.trim();
    if (sku || name) return true;
    const price = r.querySelector('.pos-row-price')?.value.trim();
    if (price && price !== '0') return true;
  }

  // 4. Datos factura o comentarios
  const fRut = document.getElementById('pos-factura-rut')?.value.trim();
  const comments = document.getElementById('pos-comments')?.value.trim();
  if (fRut || comments) return true;

  return false;
};

// Cierre seguro con confirmación para evitar pérdida involuntaria de trabajo
window.confirmAndClosePosModal = async function() {
  const modal = document.getElementById('modal-pos-sale');
  if (!modal) return;

  if (window.hasPosSaleWorkInProgress()) {
    const result = await Swal.fire({
      title: '¿Deseas salir del Punto de Venta?',
      html: `
        <div style="text-align: center; font-size: 0.92rem; color: var(--color-text-main); line-height: 1.5;">
          <p style="margin-bottom: 0.6rem;">Tienes una venta en progreso con información ingresada.</p>
          <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 8px; padding: 0.75rem; color: #dc2626; font-size: 0.84rem; font-weight: 600;">
            <i class="ri-alert-line"></i> Si sales ahora, se perderán los productos cargados y los datos de la venta.
          </div>
        </div>
      `,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, Salir y Descartar',
      cancelButtonText: 'Continuar con la Venta',
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#2563eb',
      reverseButtons: true,
      focusCancel: true
    });

    if (result.isConfirmed) {
      modal.classList.remove('active');
    }
  } else {
    modal.classList.remove('active');
  }
};

// Listener global para envío del formulario
document.addEventListener('submit', (e) => {
  if (e.target.id === 'form-pos-sale') {
    e.preventDefault();
    window.savePosSale(e);
  }
});

// Selector de Tipo de Documento: Boleta vs Factura
window.selectPosDocTipo = function(tipo) {
  const hiddenInput = document.getElementById('pos-documento-tipo');
  if (hiddenInput) hiddenInput.value = tipo;

  const cardBoleta = document.getElementById('lbl-pos-doc-boleta');
  const cardFactura = document.getElementById('lbl-pos-doc-factura');
  const facturaFields = document.getElementById('pos-factura-fields');

  if (tipo === 'FACTURA') {
    if (cardFactura) {
      cardFactura.style.border = '2px solid var(--color-primary)';
      cardFactura.style.background = 'rgba(59, 130, 246, 0.05)';
      cardFactura.querySelector('div:first-child').style.background = 'rgba(59, 130, 246, 0.1)';
      cardFactura.querySelector('div:first-child').style.color = 'var(--color-primary)';
    }
    if (cardBoleta) {
      cardBoleta.style.border = '1px solid var(--color-border)';
      cardBoleta.style.background = 'var(--color-surface)';
      cardBoleta.querySelector('div:first-child').style.background = 'var(--color-bg)';
      cardBoleta.querySelector('div:first-child').style.color = 'var(--color-text-muted)';
    }
    if (facturaFields) facturaFields.style.display = 'block';
  } else {
    if (cardBoleta) {
      cardBoleta.style.border = '2px solid var(--color-primary)';
      cardBoleta.style.background = 'rgba(59, 130, 246, 0.05)';
      cardBoleta.querySelector('div:first-child').style.background = 'rgba(59, 130, 246, 0.1)';
      cardBoleta.querySelector('div:first-child').style.color = 'var(--color-primary)';
    }
    if (cardFactura) {
      cardFactura.style.border = '1px solid var(--color-border)';
      cardFactura.style.background = 'var(--color-surface)';
      cardFactura.querySelector('div:first-child').style.background = 'var(--color-bg)';
      cardFactura.querySelector('div:first-child').style.color = 'var(--color-text-muted)';
    }
    if (facturaFields) facturaFields.style.display = 'none';
  }
};

// Actualiza las tarjetas de métodos de pago disponibles en el Paso 3 según la configuración del comercio
window.updatePosAvailablePaymentMethods = function() {
  const commerceName = (document.getElementById('pos-select-commerce')?.value || '').trim();
  const config = commerceName ? window.resolvePosCommerceConfig(commerceName) : null;
  const ob = config?.onboarding_checklist || {};
  const activeMethods = window.getMerchantActivePosPaymentMethods(ob);

  const cardsMap = {
    'Tarjeta de Débito': 'lbl-pos-pago-debito',
    'Tarjeta de Crédito': 'lbl-pos-pago-credito',
    'Efectivo': 'lbl-pos-pago-efectivo',
    'Transferencia': 'lbl-pos-pago-transferencia'
  };

  Object.entries(cardsMap).forEach(([methodName, cardId]) => {
    const card = document.getElementById(cardId);
    if (!card) return;
    const isEnabled = activeMethods.includes(methodName);
    card.style.display = isEnabled ? 'flex' : 'none';
    card.dataset.disabled = isEnabled ? 'false' : 'true';
  });

  const hintEl = document.getElementById('pos-payment-methods-hint');
  if (hintEl) {
    if (!commerceName) {
      hintEl.innerHTML = '';
    } else if (activeMethods.length < 4) {
      hintEl.innerHTML = `
        <span style="display: inline-flex; align-items: center; gap: 0.3rem; background: rgba(37, 99, 235, 0.08); color: var(--color-primary); border: 1px solid rgba(37, 99, 235, 0.25); padding: 0.18rem 0.6rem; border-radius: 999px; font-weight: 700; font-size: 0.72rem;">
          <i class="ri-shield-check-line"></i> Medios habilitados para ${escapeHtml(commerceName)}: ${activeMethods.map(m => escapeHtml(m)).join(', ')}
        </span>
      `;
    } else {
      hintEl.innerHTML = `
        <span style="display: inline-flex; align-items: center; gap: 0.25rem; color: var(--color-text-muted); font-size: 0.72rem; font-weight: 600;">
          <i class="ri-checkbox-circle-line" style="color: #10b981;"></i> Todos los medios de pago habilitados
        </span>
      `;
    }
  }

  const hiddenInput = document.getElementById('pos-modo-pago');
  const currentModo = hiddenInput?.value || 'Tarjeta de Débito';
  if (!activeMethods.includes(currentModo) && activeMethods.length > 0) {
    window.selectPosModoPago(activeMethods[0]);
  } else {
    window.selectPosModoPago(currentModo);
  }
};

// Selector de Modo de Pago
window.selectPosModoPago = function(modo) {
  const commerceName = (document.getElementById('pos-select-commerce')?.value || '').trim();
  if (commerceName) {
    const config = window.resolvePosCommerceConfig(commerceName);
    const activeMethods = window.getMerchantActivePosPaymentMethods(config?.onboarding_checklist || {});
    if (!activeMethods.includes(modo) && activeMethods.length > 0) {
      modo = activeMethods[0];
    }
  }

  const hiddenInput = document.getElementById('pos-modo-pago');
  if (hiddenInput) hiddenInput.value = modo;

  const cardsMap = {
    'Tarjeta de Débito': 'lbl-pos-pago-debito',
    'Tarjeta de Crédito': 'lbl-pos-pago-credito',
    'Efectivo': 'lbl-pos-pago-efectivo',
    'Transferencia': 'lbl-pos-pago-transferencia'
  };

  Object.entries(cardsMap).forEach(([m, cardId]) => {
    const card = document.getElementById(cardId);
    if (!card) return;
    if (m === modo) {
      card.style.border = '2px solid var(--color-primary)';
      card.style.background = 'rgba(59, 130, 246, 0.05)';
      card.querySelector('i').style.color = 'var(--color-primary)';
    } else {
      card.style.border = '1px solid var(--color-border)';
      card.style.background = 'var(--color-surface)';
      card.querySelector('i').style.color = 'var(--color-text-muted)';
    }
  });

  window.updatePosPaymentMachineBanner();
};

// ====== HELPERS PARA TRANSFERENCIAS BANCARIAS Y WHATSAPP EN POS ======

window.posBankQrMode = 'whatsapp';

window.handlePosPhoneCountryChange = function() {
  const select = document.getElementById('pos-customer-phone-country');
  const input = document.getElementById('pos-customer-phone-number');
  const hint = document.getElementById('pos-phone-format-hint');
  if (!select || !input) return;

  const opt = select.options[select.selectedIndex];
  const ph = opt?.getAttribute('data-placeholder') || '9 1234 5678';
  const hintText = opt?.getAttribute('data-hint') || '';
  input.placeholder = ph;
  if (hint) hint.textContent = hintText;

  window.handlePosPhoneInput();
};

window.handlePosPhoneInput = function() {
  const select = document.getElementById('pos-customer-phone-country');
  const input = document.getElementById('pos-customer-phone-number');
  const hidden = document.getElementById('pos-customer-phone');
  const msg = document.getElementById('pos-phone-validation-msg');
  if (!select || !input || !hidden) return;

  const country = select.value || '';
  let raw = input.value;
  let digits = raw.replace(/\D/g, '');

  if (!digits) {
    hidden.value = '';
    if (msg) msg.style.display = 'none';
    input.style.borderColor = '';
    return;
  }

  if (country === '+56') {
    if (digits.startsWith('56') && digits.length > 9) {
      digits = digits.slice(2);
    }
    digits = digits.slice(0, 9);
    if (digits.length > 5) {
      input.value = `${digits.slice(0, 1)} ${digits.slice(1, 5)} ${digits.slice(5)}`;
    } else if (digits.length > 1) {
      input.value = `${digits.slice(0, 1)} ${digits.slice(1)}`;
    } else {
      input.value = digits;
    }
    hidden.value = `+56 ${input.value}`;

    if (digits.length === 9 && digits.startsWith('9')) {
      input.style.borderColor = 'var(--color-success, #10b981)';
      if (msg) msg.style.display = 'none';
    } else if (digits.length === 9 && !digits.startsWith('9')) {
      input.style.borderColor = 'var(--color-danger, #ef4444)';
      if (msg) {
        msg.style.display = 'block';
        msg.style.color = '#ef4444';
        msg.textContent = 'En Chile el número móvil debe comenzar con el dígito 9.';
      }
    } else {
      input.style.borderColor = '';
      if (msg) msg.style.display = 'none';
    }
  } else if (country) {
    hidden.value = `${country} ${digits}`;
    input.style.borderColor = '';
    if (msg) msg.style.display = 'none';
  } else {
    hidden.value = raw.trim();
    input.style.borderColor = '';
    if (msg) msg.style.display = 'none';
  }
};

window.validatePosCustomerPhone = function() {
  const select = document.getElementById('pos-customer-phone-country');
  const input = document.getElementById('pos-customer-phone-number');
  const hidden = document.getElementById('pos-customer-phone');
  if (!input) return { isValid: true, phone: '' };

  const raw = input.value.trim();
  if (!raw) {
    if (hidden) hidden.value = '';
    return { isValid: true, phone: '' };
  }

  const country = select?.value || '+56';
  let digits = raw.replace(/\D/g, '');

  if (country === '+56') {
    if (digits.startsWith('56') && digits.length > 9) digits = digits.slice(2);
    if (digits.length !== 9) {
      return {
        isValid: false,
        message: 'El teléfono para Chile debe contener exactamente 9 dígitos (ej: 9 1234 5678).'
      };
    }
    if (!digits.startsWith('9')) {
      return {
        isValid: false,
        message: 'En Chile los números móviles deben comenzar con el dígito 9 (ej: 9 1234 5678).'
      };
    }
    const formatted = `+56 ${digits.slice(0, 1)} ${digits.slice(1, 5)} ${digits.slice(5)}`;
    if (hidden) hidden.value = formatted;
    return { isValid: true, phone: formatted };
  }

  const opt = select?.options[select?.selectedIndex];
  const expDigits = opt?.getAttribute('data-digits');
  if (expDigits && expDigits !== 'any') {
    const expected = parseInt(expDigits, 10);
    if (digits.length !== expected) {
      return {
        isValid: false,
        message: `El número de teléfono para ${opt.text} debe tener ${expected} dígitos.`
      };
    }
  } else {
    if (digits.length < 7) {
      return {
        isValid: false,
        message: 'Por favor ingresa un número de teléfono válido.'
      };
    }
  }

  const finalFormatted = country ? `${country} ${digits}` : raw;
  if (hidden) hidden.value = finalFormatted;
  return { isValid: true, phone: finalFormatted };
};

window.getPosCustomerFormattedPhone = function() {
  const hiddenVal = document.getElementById('pos-customer-phone')?.value || '';
  const numInputVal = document.getElementById('pos-customer-phone-number')?.value || '';
  const selectVal = document.getElementById('pos-customer-phone-country')?.value || '+56';

  let raw = hiddenVal || numInputVal;
  if (!raw) return '';

  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  const countryCode = selectVal.replace(/\D/g, '');
  if (digits.startsWith(countryCode) && digits.length > 9) {
    return digits;
  }
  return `${countryCode}${digits}`;
};

window.copyPosText = async function(text, label = 'Dato') {
  if (!text) return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    if (typeof Swal !== 'undefined') {
      const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 1800,
        timerProgressBar: true
      });
      Toast.fire({
        icon: 'success',
        title: `${label} copiado`
      });
    }
  } catch (err) {
    console.error('Error al copiar:', err);
  }
};

window.renderPosBankQrToCanvas = function(canvasEl, text, sizePx = 130) {
  if (!canvasEl || !text) return;
  try {
    if (typeof qrcode === 'function') {
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      const count = qr.getModuleCount();
      const margin = 2;
      const cellSize = Math.max(2, Math.floor(sizePx / (count + margin * 2)));
      const actualSize = (count + margin * 2) * cellSize;

      canvasEl.width = actualSize;
      canvasEl.height = actualSize;
      const ctx = canvasEl.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, actualSize, actualSize);
      ctx.fillStyle = '#1e293b';

      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          if (qr.isDark(r, c)) {
            ctx.fillRect((c + margin) * cellSize, (r + margin) * cellSize, cellSize, cellSize);
          }
        }
      }
      return;
    }
  } catch (e) {
    console.warn('Error con qrcode-generator:', e);
  }

  // Fallback a API de códigos QR
  try {
    const ctx = canvasEl.getContext('2d');
    canvasEl.width = sizePx;
    canvasEl.height = sizePx;
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      ctx.drawImage(img, 0, 0, sizePx, sizePx);
    };
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=${sizePx}x${sizePx}&data=${encodeURIComponent(text)}`;
  } catch (err) {
    console.error('Error generando fallback QR:', err);
  }
};

window.getPosBankTransferData = function() {
  const commerceName = (document.getElementById('pos-select-commerce')?.value || '').trim();
  let config = window.posSelectedCommerceConfig;
  if (!config && window.loadedCommerceConfigsMap) {
    const foundKey = Object.keys(window.loadedCommerceConfigsMap).find(k => k.trim().toLowerCase() === commerceName.toLowerCase());
    if (foundKey) config = window.loadedCommerceConfigsMap[foundKey];
  }
  if (!config && window.cachedAdminMerchants) {
    const foundM = window.cachedAdminMerchants.find(m => (m.nombre || '').trim().toLowerCase() === commerceName.toLowerCase());
    if (foundM) {
      config = {
        comercio: foundM.nombre,
        inventario_seguimiento: Boolean(foundM.inventario_seguimiento),
        onboarding_checklist: foundM.onboarding_checklist || {}
      };
    }
  }

  const ob = config?.onboarding_checklist || {};
  const bt = ob.pos_bank_transfer || {};
  const saleCode = (document.getElementById('pos-codigo-venta')?.value || '').trim();
  const totalAmount = (document.getElementById('pos-confirm-total')?.textContent || document.getElementById('pos-summary-total')?.textContent || '$0').trim();

  return {
    commerceName,
    bank: bt.bank || '',
    accountType: bt.account_type || 'Cuenta Corriente',
    accountNumber: bt.account_number || '',
    holderName: bt.holder_name || commerceName,
    holderRut: bt.holder_rut || '',
    email: bt.email || '',
    notes: bt.notes || '',
    saleCode,
    totalAmount
  };
};

window.getPosBankFormattedText = function() {
  const d = window.getPosBankTransferData();
  const lines = [
    `DATOS DE TRANSFERENCIA BANCARIA`,
    `Comercio: ${d.commerceName}`,
    d.bank ? `Banco: ${d.bank}` : null,
    d.accountType ? `Tipo de Cuenta: ${d.accountType}` : null,
    d.accountNumber ? `N° Cuenta: ${d.accountNumber}` : null,
    d.holderRut ? `RUT: ${d.holderRut}` : null,
    d.holderName ? `Titular: ${d.holderName}` : null,
    d.email ? `Correo: ${d.email}` : null,
    d.totalAmount && d.totalAmount !== '$0' ? `Monto a Transferir: ${d.totalAmount}` : null,
    d.saleCode ? `Referencia / Asunto: ${d.saleCode}` : null,
    d.notes ? `Nota: ${d.notes}` : null
  ].filter(Boolean);

  return lines.join('\n');
};

window.getPosBankWhatsAppMessage = function() {
  const d = window.getPosBankTransferData();
  const lines = [
    `*DATOS DE TRANSFERENCIA BANCARIA*`,
    `🏪 *Comercio:* ${d.commerceName}`,
    ``,
    d.bank ? `🏦 *Banco:* ${d.bank}` : null,
    d.accountType ? `💳 *Tipo de Cuenta:* ${d.accountType}` : null,
    d.accountNumber ? `🔢 *N° de Cuenta:* \`${d.accountNumber}\`` : null,
    d.holderRut ? `🆔 *RUT Titular:* \`${d.holderRut}\`` : null,
    d.holderName ? `👤 *Titular:* ${d.holderName}` : null,
    d.email ? `✉️ *Correo:* ${d.email}` : null,
    ``,
    d.totalAmount && d.totalAmount !== '$0' ? `💰 *Total a Transferir:* *${d.totalAmount}*` : null,
    d.saleCode ? `🏷️ *Referencia / Asunto:* \`${d.saleCode}\`` : null,
    d.notes ? `ℹ️ *Nota:* _${d.notes}_` : null,
    ``,
    `_Por favor envía el comprobante a este correo o muéstralo al cajero para completar tu compra._`
  ].filter(l => l !== null);

  return lines.join('\n');
};

window.posBankQrMode = 'whatsapp';

window.getPosBankQrPayload = function(mode = window.posBankQrMode || 'whatsapp') {
  if (mode === 'whatsapp') {
    const phone = window.getPosCustomerFormattedPhone();
    const msg = window.getPosBankWhatsAppMessage();
    const encoded = encodeURIComponent(msg);
    if (phone) {
      return `https://api.whatsapp.com/send?phone=${phone}&text=${encoded}`;
    }
    return `https://api.whatsapp.com/send?text=${encoded}`;
  }
  return window.getPosBankFormattedText();
};

window.setPosBankQrMode = function(mode, context = 'banner') {
  window.posBankQrMode = mode;
  const isWa = mode === 'whatsapp';

  const btnWa = document.getElementById('pos-qr-toggle-wa');
  const btnTxt = document.getElementById('pos-qr-toggle-txt');
  const caption = document.getElementById('pos-qr-caption');
  if (btnWa && btnTxt) {
    btnWa.style.background = isWa ? '#25D366' : 'transparent';
    btnWa.style.color = isWa ? '#ffffff' : 'var(--color-text-muted)';
    btnTxt.style.background = !isWa ? '#4f46e5' : 'transparent';
    btnTxt.style.color = !isWa ? '#ffffff' : 'var(--color-text-muted)';
  }
  if (caption) {
    caption.textContent = isWa ? 'Abre mensaje en WhatsApp' : 'Copia texto al escanear';
    caption.style.color = isWa ? '#059669' : '#4f46e5';
  }

  const mBtnWa = document.getElementById('pos-modal-qr-toggle-wa');
  const mBtnTxt = document.getElementById('pos-modal-qr-toggle-txt');
  const mCaption = document.getElementById('pos-modal-qr-caption');
  if (mBtnWa && mBtnTxt) {
    mBtnWa.style.background = isWa ? '#25D366' : 'transparent';
    mBtnWa.style.color = isWa ? '#ffffff' : 'var(--color-text-muted)';
    mBtnTxt.style.background = !isWa ? '#4f46e5' : 'transparent';
    mBtnTxt.style.color = !isWa ? '#ffffff' : 'var(--color-text-muted)';
  }
  if (mCaption) {
    mCaption.textContent = isWa ? 'Al escanear abre todos los datos en WhatsApp' : 'Al escanear copia el texto en el teléfono';
    mCaption.style.color = isWa ? '#059669' : '#4f46e5';
  }

  const payload = window.getPosBankQrPayload(mode);
  const canvas = document.getElementById('pos-bank-qr-canvas');
  if (canvas) {
    window.renderPosBankQrToCanvas(canvas, payload, 125);
  }
  const modalCanvas = document.getElementById('pos-bank-qr-modal-canvas');
  if (modalCanvas) {
    window.renderPosBankQrToCanvas(modalCanvas, payload, 220);
  }
};

window.sendPosBankViaWhatsApp = function() {
  const phone = window.getPosCustomerFormattedPhone();
  const msg = window.getPosBankWhatsAppMessage();
  const encodedText = encodeURIComponent(msg);

  if (phone) {
    const url = `https://api.whatsapp.com/send?phone=${phone}&text=${encodedText}`;
    window.open(url, '_blank');
    if (typeof Swal !== 'undefined') {
      const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 2500,
        timerProgressBar: true
      });
      Toast.fire({
        icon: 'success',
        title: `Abriendo WhatsApp para +${phone}`
      });
    }
  } else {
    Swal.fire({
      title: '<span style="font-size: 1.15rem; font-weight: 700; color: #1e293b;"><i class="ri-whatsapp-line" style="color: #25D366; vertical-align: middle;"></i> Enviar Datos por WhatsApp</span>',
      html: `
        <div style="text-align: left; font-size: 0.85rem; padding: 0.25rem 0;">
          <p style="margin-bottom: 0.75rem; color: var(--color-text-main); line-height: 1.4;">
            No se ingresó teléfono en el Paso 1. Ingresa el número de WhatsApp del cliente para enviarle los datos directamente:
          </p>
          <div style="display: flex; gap: 0.4rem; align-items: center; margin-bottom: 0.75rem;">
            <select id="swal-wa-country" class="form-input" style="width: 105px; height: 38px; padding: 0.3rem 0.5rem; font-size: 0.82rem;">
              <option value="+56" selected>🇨🇱 +56</option>
              <option value="+54">🇦🇷 +54</option>
              <option value="+51">🇵🇪 +51</option>
              <option value="+57">🇨🇴 +57</option>
              <option value="+52">🇲🇽 +52</option>
              <option value="+1">🇺🇸 +1</option>
              <option value="+34">🇪🇸 +34</option>
              <option value="">🌍 Otro</option>
            </select>
            <input type="tel" id="swal-wa-phone" class="form-input" placeholder="9 1234 5678" style="flex: 1; height: 38px; font-size: 0.9rem;">
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '<i class="ri-send-plane-fill"></i> Enviar al Cliente',
      cancelButtonText: '<i class="ri-share-forward-line"></i> Elegir Contacto',
      confirmButtonColor: '#25D366',
      cancelButtonColor: '#4f46e5',
      focusConfirm: false,
      didOpen: () => {
        const swalInput = document.getElementById('swal-wa-phone');
        if (swalInput) {
          swalInput.focus();
          swalInput.addEventListener('input', () => {
            const raw = swalInput.value.replace(/\D/g, '');
            if (raw.length > 5) {
              swalInput.value = `${raw.slice(0,1)} ${raw.slice(1,5)} ${raw.slice(5,9)}`;
            } else if (raw.length > 1) {
              swalInput.value = `${raw.slice(0,1)} ${raw.slice(1)}`;
            }
          });
        }
      },
      preConfirm: () => {
        const country = (document.getElementById('swal-wa-country')?.value || '').replace(/\D/g, '');
        const num = (document.getElementById('swal-wa-phone')?.value || '').replace(/\D/g, '');
        if (!num) {
          Swal.showValidationMessage('Ingresa un número o haz clic en "Elegir Contacto"');
          return false;
        }
        return `${country}${num}`;
      }
    }).then((result) => {
      if (result.isConfirmed && result.value) {
        window.open(`https://api.whatsapp.com/send?phone=${result.value}&text=${encodedText}`, '_blank');
      } else if (result.dismiss === Swal.DismissReason.cancel) {
        window.open(`https://api.whatsapp.com/send?text=${encodedText}`, '_blank');
      }
    });
  }
};

window.copyPosBankField = function(field, label) {
  const d = window.getPosBankTransferData();
  let val = '';
  switch(field) {
    case 'bank': val = d.bank; break;
    case 'account_type': val = d.accountType; break;
    case 'account_number': val = d.accountNumber; break;
    case 'holder_rut': val = d.holderRut; break;
    case 'holder_name': val = d.holderName; break;
    case 'email': val = d.email; break;
    case 'total_amount': val = (d.totalAmount || '').replace(/[^0-9]/g, '') || d.totalAmount; break;
    case 'sale_code': val = d.saleCode; break;
    default: val = '';
  }
  if (val) {
    window.copyPosText(val, label || 'Dato');
  }
};

window.copyPosBankDetails = function() {
  const text = window.getPosBankFormattedText();
  window.copyPosText(text, 'Datos de transferencia');
};

window.openPosBankQrModal = function() {
  const d = window.getPosBankTransferData();
  const isWa = (window.posBankQrMode === 'whatsapp');

  if (typeof Swal !== 'undefined') {
    Swal.fire({
      title: `<span style="font-size: 1.15rem; font-weight: 700; color: #1e293b;"><i class="ri-qr-code-line" style="color: #4f46e5; vertical-align: middle;"></i> Código QR de Pago</span>`,
      html: `
        <div style="text-align: center; padding: 0.25rem 0;">
          <div style="font-size: 0.95rem; font-weight: 700; color: #4f46e5; margin-bottom: 0.25rem;">
            ${escapeHtml(d.commerceName)}
          </div>
          <div style="font-size: 1.25rem; font-weight: 800; color: #065f46; margin-bottom: 0.65rem; background: rgba(16,185,129,0.1); padding: 0.35rem 0.8rem; border-radius: 6px; display: inline-block;">
            Total: ${escapeHtml(d.totalAmount)}
          </div>

          <div style="display: flex; justify-content: center; margin-bottom: 0.65rem;">
            <div style="display: inline-flex; background: rgba(0,0,0,0.06); border-radius: 20px; padding: 2px; font-size: 0.72rem; font-weight: 700;">
              <button type="button" id="pos-modal-qr-toggle-wa" onclick="window.setPosBankQrMode('whatsapp', 'modal')" style="border: none; border-radius: 16px; padding: 4px 12px; cursor: pointer; background: ${isWa ? '#25D366' : 'transparent'}; color: ${isWa ? '#ffffff' : 'var(--color-text-muted)'}; display: flex; align-items: center; gap: 4px; font-weight: 700; transition: all 0.2s;">
                <i class="ri-whatsapp-line"></i> WhatsApp QR
              </button>
              <button type="button" id="pos-modal-qr-toggle-txt" onclick="window.setPosBankQrMode('texto', 'modal')" style="border: none; border-radius: 16px; padding: 4px 12px; cursor: pointer; background: ${!isWa ? '#4f46e5' : 'transparent'}; color: ${!isWa ? '#ffffff' : 'var(--color-text-muted)'}; display: flex; align-items: center; gap: 4px; font-weight: 700; transition: all 0.2s;">
                <i class="ri-file-text-line"></i> Texto Directo
              </button>
            </div>
          </div>

          <div style="display: flex; justify-content: center; margin-bottom: 0.65rem;">
            <canvas id="pos-bank-qr-modal-canvas" style="background: #ffffff; padding: 10px; border-radius: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.12); border: 1.5px solid rgba(99, 102, 241, 0.25);"></canvas>
          </div>

          <p id="pos-modal-qr-caption" style="font-size: 0.78rem; color: #059669; font-weight: 600; max-width: 340px; margin: 0 auto 0.85rem auto; line-height: 1.35;">
            ${isWa ? 'Al escanear abre todos los datos en WhatsApp' : 'Al escanear copia el texto en el teléfono'}
          </p>

          <div style="display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap;">
            <button type="button" class="btn btn-sm" onclick="window.sendPosBankViaWhatsApp()" style="background: #25D366; color: #ffffff; border: none; font-size: 0.8rem; font-weight: 700; padding: 0.45rem 0.9rem; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 0.35rem; box-shadow: 0 2px 6px rgba(37, 211, 102, 0.3);">
              <i class="ri-whatsapp-line"></i> Enviar por WhatsApp
            </button>
            <button type="button" class="btn btn-primary btn-sm" onclick="window.copyPosBankDetails()" style="background: #4f46e5; color: #ffffff; border: none; font-size: 0.8rem; font-weight: 600; padding: 0.45rem 0.9rem; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 0.35rem; box-shadow: 0 2px 6px rgba(79, 70, 229, 0.25);">
              <i class="ri-file-copy-line"></i> Copiar datos
            </button>
          </div>
        </div>
      `,
      showConfirmButton: true,
      confirmButtonText: 'Cerrar',
      confirmButtonColor: '#64748b',
      didOpen: () => {
        const modalCanvas = document.getElementById('pos-bank-qr-modal-canvas');
        if (modalCanvas) {
          const payload = window.getPosBankQrPayload(window.posBankQrMode || 'whatsapp');
          window.renderPosBankQrToCanvas(modalCanvas, payload, 220);
        }
      }
    });
  }
};

// Actualización del recuadro notorio de Máquina de Pagos para Tarjetas (Paso 3)
window.updatePosPaymentMachineBanner = function() {
  const banner = document.getElementById('pos-payment-machine-banner');
  if (!banner) return;

  const commerceName = (document.getElementById('pos-select-commerce')?.value || '').trim();
  const modoPago = document.getElementById('pos-modo-pago')?.value || 'Tarjeta de Débito';

  if (!commerceName) {
    banner.innerHTML = '';
    return;
  }

  // Buscar configuración del comercio (desde cache activa o fallback global)
  let config = window.posSelectedCommerceConfig;
  if (!config && window.loadedCommerceConfigsMap) {
    const foundKey = Object.keys(window.loadedCommerceConfigsMap).find(k => k.trim().toLowerCase() === commerceName.toLowerCase());
    if (foundKey) config = window.loadedCommerceConfigsMap[foundKey];
  }
  if (!config && window.cachedAdminMerchants) {
    const foundM = window.cachedAdminMerchants.find(m => (m.nombre || '').trim().toLowerCase() === commerceName.toLowerCase());
    if (foundM) {
      config = {
        comercio: foundM.nombre,
        inventario_seguimiento: Boolean(foundM.inventario_seguimiento),
        onboarding_checklist: foundM.onboarding_checklist || {}
      };
    }
  }

  const ob = config?.onboarding_checklist || {};
  const isPosActive = ob.pos_active === true;
  const machine = ob.pos_machine || {};
  const bankTransfer = ob.pos_bank_transfer || {};
  const isCard = (modoPago === 'Tarjeta de Débito' || modoPago === 'Tarjeta de Crédito');

  if (!isPosActive) {
    banner.innerHTML = `
      <div style="background: rgba(239, 68, 68, 0.08); border: 2px solid #ef4444; border-radius: var(--radius-md); padding: 1rem 1.25rem; display: flex; align-items: center; gap: 0.85rem;">
        <i class="ri-forbid-2-line" style="color: #dc2626; font-size: 1.6rem; flex-shrink: 0;"></i>
        <div>
          <strong style="color: #dc2626; font-size: 0.88rem; display: block; margin-bottom: 0.2rem;">PUNTO DE VENTA DESHABILITADO PARA ${escapeHtml(commerceName)}</strong>
          <span style="font-size: 0.8rem; color: var(--color-text-main); line-height: 1.4;">
            Este comercio tiene la opción de POS inactiva en la configuración de comercios. Para operar presencialmente, habilítalo en la sección de Comercios.
          </span>
        </div>
      </div>
    `;
    return;
  }

  if (isCard) {
    const hasMachineConfig = Boolean(machine.brand || machine.model || machine.color || machine.owner);

    if (hasMachineConfig) {
      const dotColor = window.resolvePosMachineColor(machine.color, machine.color_hex);
      const isLightColor = (typeof window.getPosColorLuminance === 'function') ? (window.getPosColorLuminance(dotColor) > 0.38) : false;
      const badgeTextColor = (typeof window.getPosContrastTextColor === 'function') ? window.getPosContrastTextColor(dotColor) : '#ffffff';
      const readableTextColor = (typeof window.getPosReadableTextColor === 'function') ? window.getPosReadableTextColor(dotColor) : dotColor;
      const borderAccentColor = isLightColor ? readableTextColor : dotColor;

      const posSvgIconLarge = window.getPosMachineSvg(dotColor, 44);
      const posSvgIconMini = window.getPosMachineSvg(dotColor, 18);

      banner.innerHTML = `
        <div style="background: linear-gradient(135deg, ${dotColor}12 0%, #ffffff 100%); border: 2.5px solid ${borderAccentColor}; border-radius: var(--radius-md); padding: 1.15rem 1.35rem; box-shadow: 0 4px 16px ${isLightColor ? 'rgba(0,0,0,0.10)' : dotColor + '25'}; position: relative; overflow: hidden;">
          <div style="position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: ${borderAccentColor};"></div>
          
          <div style="display: flex; align-items: flex-start; gap: 1.1rem;">
            <div style="width: 52px; height: 52px; border-radius: 12px; background: rgba(255, 255, 255, 0.95); border: 2px solid ${borderAccentColor}; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px ${isLightColor ? 'rgba(0,0,0,0.08)' : dotColor + '35'}; padding: 2px;">
              ${posSvgIconLarge}
            </div>
            
            <div style="flex: 1; min-width: 0;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.65rem; flex-wrap: wrap; margin-bottom: 0.45rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                  <span style="background: ${dotColor}; color: ${badgeTextColor}; border: ${isLightColor ? '1px solid rgba(0,0,0,0.22)' : 'none'}; font-size: 0.72rem; font-weight: 800; letter-spacing: 0.6px; text-transform: uppercase; padding: 0.22rem 0.6rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 0.35rem; box-shadow: 0 2px 6px ${isLightColor ? 'rgba(0,0,0,0.12)' : dotColor + '40'};">
                    ${window.getPosMachineSvg(badgeTextColor, 13)} MÁQUINA DE PAGO OBLIGATORIA
                  </span>
                  <span style="font-size: 0.92rem; font-weight: 700; color: var(--color-text-main);">
                    Cobro con Tarjeta para <span style="color: ${readableTextColor}; font-weight: 800;">${escapeHtml(commerceName)}</span>
                  </span>
                </div>
                ${machine.model ? `
                  <div style="background: ${dotColor}; color: ${badgeTextColor}; border: ${isLightColor ? '2px solid rgba(0,0,0,0.28)' : '2px solid rgba(255,255,255,0.25)'}; padding: 0.3rem 0.9rem; border-radius: 8px; display: inline-flex; align-items: center; gap: 0.45rem; box-shadow: 0 4px 12px ${isLightColor ? 'rgba(0,0,0,0.15)' : dotColor + '50'};">
                    <span style="font-size: 0.68rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; opacity: 0.92;">TOMAR MÁQUINA</span>
                    <span style="font-family: monospace; font-size: 1.35rem; font-weight: 900; letter-spacing: 1px; line-height: 1;">#${escapeHtml(machine.model)}</span>
                  </div>
                ` : ''}
              </div>
              
              <div style="font-size: 0.84rem; color: var(--color-text-main); margin-bottom: 0.75rem; line-height: 1.4;">
                Para evitar errores de recaudación o abonos a cuentas erróneas, realiza el cobro exclusivamente en este equipo físico:
              </div>
              
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); gap: 0.65rem; margin-bottom: ${machine.notes ? '0.65rem' : '0'}; align-items: stretch;">
                <div style="background: rgba(255, 255, 255, 0.95); border: 1px solid rgba(0,0,0,0.08); border-top: 2.5px solid ${borderAccentColor}; border-radius: 8px; padding: 0.55rem 0.75rem; box-shadow: 0 1px 3px rgba(0,0,0,0.04); display: flex; flex-direction: column; justify-content: center;">
                  <span style="font-size: 0.68rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700; display: block;">Marca / Proveedor</span>
                  <strong style="font-size: 1.05rem; color: #1e293b; display: flex; align-items: center; gap: 0.3rem; margin-top: 0.2rem;">
                    <i class="ri-terminal-box-line" style="color: ${readableTextColor};"></i> ${escapeHtml(machine.brand || 'No asignada')}
                  </strong>
                </div>

                <div style="background: rgba(255, 255, 255, 0.95); border: 1.5px solid ${isLightColor ? readableTextColor + '55' : dotColor + '66'}; border-top: 2.5px solid ${borderAccentColor}; border-radius: 8px; padding: 0.55rem 0.75rem; box-shadow: 0 1px 3px rgba(0,0,0,0.04); display: flex; flex-direction: column; justify-content: center;">
                  <span style="font-size: 0.68rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700; display: block;">Color / Distintivo</span>
                  <strong style="font-size: 1.05rem; color: #1e293b; display: flex; align-items: center; gap: 0.4rem; margin-top: 0.2rem;">
                    <span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; background: ${dotColor}25; border: 1px solid ${isLightColor ? 'rgba(0,0,0,0.18)' : dotColor + '40'};">
                      ${posSvgIconMini}
                    </span>
                    <span style="color: ${readableTextColor}; font-weight: 800;">${escapeHtml(machine.color || 'No especificado')}</span>
                  </strong>
                </div>

                <div style="background: linear-gradient(135deg, ${isLightColor ? 'rgba(15,23,42,0.06)' : dotColor + '20'} 0%, rgba(255, 255, 255, 0.98) 100%); border: 2.5px solid ${borderAccentColor}; border-top: 4px solid ${borderAccentColor}; border-radius: 10px; padding: 0.55rem 0.9rem; box-shadow: 0 4px 12px ${isLightColor ? 'rgba(0,0,0,0.08)' : dotColor + '28'}; display: flex; flex-direction: column; justify-content: center; position: relative;">
                  <span style="font-size: 0.7rem; text-transform: uppercase; color: ${readableTextColor}; font-weight: 800; letter-spacing: 0.5px; display: flex; align-items: center; justify-content: space-between; gap: 0.25rem;">
                    <span>N° Máquina / Terminal</span>
                    <i class="ri-price-tag-3-fill" style="font-size: 0.85rem; opacity: 0.85;"></i>
                  </span>
                  <strong style="font-size: 1.75rem; line-height: 1.1; font-weight: 900; font-family: monospace; color: ${readableTextColor}; display: flex; align-items: center; gap: 0.15rem; margin-top: 0.15rem; letter-spacing: 1px; text-shadow: 0 1px 2px rgba(0,0,0,0.06);">
                    <i class="ri-hashtag" style="font-size: 1.45rem; font-weight: 900;"></i>${escapeHtml(machine.model || 'S/N')}
                  </strong>
                </div>

                <div style="background: rgba(255, 255, 255, 0.95); border: 1px solid rgba(0,0,0,0.08); border-top: 2.5px solid ${borderAccentColor}; border-radius: 8px; padding: 0.55rem 0.75rem; box-shadow: 0 1px 3px rgba(0,0,0,0.04); display: flex; flex-direction: column; justify-content: center;">
                  <span style="font-size: 0.68rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700; display: block;">Propiedad</span>
                  <strong style="font-size: 0.9rem; color: #1e293b; display: flex; align-items: center; gap: 0.3rem; margin-top: 0.2rem;">
                    <i class="ri-building-line" style="color: #7c3aed;"></i> ${escapeHtml(machine.owner || 'STOCKA')}
                  </strong>
                </div>
              </div>

              ${machine.notes ? `
                <div style="background: rgba(255, 255, 255, 0.95); border-left: 4px solid #f59e0b; border: 1px solid rgba(245, 158, 11, 0.35); border-left-width: 4px; border-left-color: #f59e0b; padding: 0.55rem 0.85rem; border-radius: 6px; font-size: 0.82rem; color: var(--color-text-main);">
                  <strong style="color: #d97706;"><i class="ri-error-warning-fill"></i> Nota / Instrucción para Cajero:</strong> ${escapeHtml(machine.notes)}
                </div>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    } else {
      banner.innerHTML = `
        <div style="background: rgba(245, 158, 11, 0.08); border: 2px dashed #f59e0b; border-radius: var(--radius-md); padding: 1rem 1.25rem; display: flex; align-items: center; gap: 0.85rem;">
          <div style="width: 46px; height: 46px; border-radius: 10px; background: rgba(245, 158, 11, 0.15); border: 1.5px solid #f59e0b; display: flex; align-items: center; justify-content: center; flex-shrink: 0; padding: 2px;">
            ${window.getPosMachineSvg('#f59e0b', 38)}
          </div>
          <div>
            <div style="font-size: 0.75rem; text-transform: uppercase; font-weight: 800; color: #d97706; margin-bottom: 0.15rem;">
              MÁQUINA GENERAL DE STOCKA
            </div>
            <div style="font-size: 0.85rem; color: var(--color-text-main);">
              El comercio <strong>${escapeHtml(commerceName)}</strong> no tiene un terminal exclusivo registrado. Utiliza el terminal POS general de <strong>STOCKA</strong> para procesar el cobro con tarjeta.
            </div>
          </div>
        </div>
      `;
    }
  } else if (modoPago === 'Efectivo') {
    banner.innerHTML = `
      <div style="background: rgba(16, 185, 129, 0.08); border: 1.5px solid rgba(16, 185, 129, 0.3); border-radius: var(--radius-md); padding: 0.85rem 1.15rem; display: flex; align-items: center; gap: 0.75rem;">
        <div style="width: 36px; height: 36px; border-radius: 8px; background: #10b981; color: #ffffff; display: flex; align-items: center; justify-content: center; font-size: 1.3rem; flex-shrink: 0;">
          <i class="ri-money-dollar-circle-fill"></i>
        </div>
        <div>
          <div style="font-size: 0.75rem; text-transform: uppercase; font-weight: 800; color: #059669; margin-bottom: 0.15rem;">
            Cobro en Efectivo
          </div>
          <div style="font-size: 0.83rem; color: var(--color-text-main);">
            Recibe el dinero en efectivo del cliente, ingrésalo en la gaveta física de caja y entrega el comprobante correspondiente.
          </div>
        </div>
      </div>
    `;
  } else if (modoPago === 'Transferencia') {
    const hasBankData = Boolean(bankTransfer.bank || bankTransfer.account_number || bankTransfer.holder_rut);
    const saleCode = (document.getElementById('pos-codigo-venta')?.value || '').trim();
    const totalAmount = (document.getElementById('pos-confirm-total')?.textContent || document.getElementById('pos-summary-total')?.textContent || '$0').trim();
    const isWa = (window.posBankQrMode !== 'texto');

    if (hasBankData) {
      banner.innerHTML = `
        <div style="background: linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, #ffffff 100%); border: 2.5px solid #6366f1; border-radius: var(--radius-md); padding: 1.15rem 1.35rem; box-shadow: 0 4px 16px rgba(99, 102, 241, 0.12); position: relative; overflow: hidden;">
          <div style="position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: #6366f1;"></div>
          
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.85rem;">
            <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;">
              <span style="background: #6366f1; color: #ffffff; font-size: 0.72rem; font-weight: 800; letter-spacing: 0.6px; text-transform: uppercase; padding: 0.25rem 0.65rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 0.35rem; box-shadow: 0 2px 4px rgba(99, 102, 241, 0.3);">
                <i class="ri-bank-card-line"></i> DATOS DE TRANSFERENCIA BANCARIA
              </span>
              <span style="font-size: 0.92rem; font-weight: 700; color: var(--color-text-main);">
                Cuenta de destino para <span style="color: #4f46e5; font-weight: 800;">${escapeHtml(commerceName)}</span>
              </span>
            </div>
            
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <button type="button" class="btn btn-sm" onclick="window.sendPosBankViaWhatsApp()" style="background: #25D366; color: #ffffff; border: none; font-size: 0.78rem; font-weight: 700; padding: 0.35rem 0.75rem; display: inline-flex; align-items: center; gap: 0.35rem; cursor: pointer; border-radius: 6px; box-shadow: 0 2px 4px rgba(37, 211, 102, 0.25);" title="Enviar datos de pago por WhatsApp">
                <i class="ri-whatsapp-line"></i> Enviar por WhatsApp
              </button>
              <button type="button" class="btn btn-sm btn-primary" onclick="window.copyPosBankDetails()" style="background: #4f46e5; color: #ffffff; border: none; font-size: 0.78rem; font-weight: 600; padding: 0.35rem 0.75rem; display: inline-flex; align-items: center; gap: 0.35rem; cursor: pointer; border-radius: 6px; box-shadow: 0 2px 4px rgba(79, 70, 229, 0.25);">
                <i class="ri-file-copy-line"></i> Copiar todo
              </button>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr auto; gap: 1.15rem; align-items: center;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.55rem;">
              
              <div style="background: rgba(255, 255, 255, 0.95); border: 1px solid rgba(0,0,0,0.08); border-top: 2.5px solid #6366f1; border-radius: 6px; padding: 0.45rem 0.65rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
                <div style="min-width: 0;">
                  <span style="font-size: 0.65rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700; display: block;">Banco Destino</span>
                  <strong style="font-size: 0.85rem; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">${escapeHtml(bankTransfer.bank || 'No especificado')}</strong>
                </div>
                ${bankTransfer.bank ? `<button type="button" onclick="window.copyPosBankField('bank', 'Banco')" title="Copiar Banco" style="background: none; border: none; color: #6366f1; cursor: pointer; padding: 2px 4px; font-size: 0.9rem;"><i class="ri-file-copy-line"></i></button>` : ''}
              </div>

              <div style="background: rgba(255, 255, 255, 0.95); border: 1px solid rgba(0,0,0,0.08); border-top: 2.5px solid #6366f1; border-radius: 6px; padding: 0.45rem 0.65rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
                <div style="min-width: 0;">
                  <span style="font-size: 0.65rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700; display: block;">Tipo de Cuenta</span>
                  <strong style="font-size: 0.85rem; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">${escapeHtml(bankTransfer.account_type || 'Cuenta Corriente')}</strong>
                </div>
                ${bankTransfer.account_type ? `<button type="button" onclick="window.copyPosBankField('account_type', 'Tipo de cuenta')" title="Copiar Tipo de Cuenta" style="background: none; border: none; color: #6366f1; cursor: pointer; padding: 2px 4px; font-size: 0.9rem;"><i class="ri-file-copy-line"></i></button>` : ''}
              </div>

              <div style="background: rgba(255, 255, 255, 0.95); border: 1.5px solid rgba(99, 102, 241, 0.4); border-top: 2.5px solid #4f46e5; border-radius: 6px; padding: 0.45rem 0.65rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
                <div style="min-width: 0;">
                  <span style="font-size: 0.65rem; text-transform: uppercase; color: #4f46e5; font-weight: 800; display: block;">N° de Cuenta</span>
                  <strong style="font-size: 0.92rem; font-family: monospace; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">${escapeHtml(bankTransfer.account_number || 'No especificado')}</strong>
                </div>
                ${bankTransfer.account_number ? `<button type="button" onclick="window.copyPosBankField('account_number', 'N° de cuenta')" title="Copiar N° de cuenta" style="background: none; border: none; color: #4f46e5; cursor: pointer; padding: 2px 4px; font-size: 0.9rem;"><i class="ri-file-copy-line"></i></button>` : ''}
              </div>

              <div style="background: rgba(255, 255, 255, 0.95); border: 1px solid rgba(0,0,0,0.08); border-top: 2.5px solid #6366f1; border-radius: 6px; padding: 0.45rem 0.65rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
                <div style="min-width: 0;">
                  <span style="font-size: 0.65rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700; display: block;">RUT Titular</span>
                  <strong style="font-size: 0.85rem; font-family: monospace; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">${escapeHtml(bankTransfer.holder_rut || 'No especificado')}</strong>
                </div>
                ${bankTransfer.holder_rut ? `<button type="button" onclick="window.copyPosBankField('holder_rut', 'RUT')" title="Copiar RUT" style="background: none; border: none; color: #6366f1; cursor: pointer; padding: 2px 4px; font-size: 0.9rem;"><i class="ri-file-copy-line"></i></button>` : ''}
              </div>

              <div style="background: rgba(255, 255, 255, 0.95); border: 1px solid rgba(0,0,0,0.08); border-top: 2.5px solid #6366f1; border-radius: 6px; padding: 0.45rem 0.65rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
                <div style="min-width: 0;">
                  <span style="font-size: 0.65rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700; display: block;">Nombre / Razón Social</span>
                  <strong style="font-size: 0.85rem; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">${escapeHtml(bankTransfer.holder_name || commerceName)}</strong>
                </div>
                <button type="button" onclick="window.copyPosBankField('holder_name', 'Titular')" title="Copiar Titular" style="background: none; border: none; color: #6366f1; cursor: pointer; padding: 2px 4px; font-size: 0.9rem;"><i class="ri-file-copy-line"></i></button>
              </div>

              <div style="background: rgba(255, 255, 255, 0.95); border: 1px solid rgba(0,0,0,0.08); border-top: 2.5px solid #6366f1; border-radius: 6px; padding: 0.45rem 0.65rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
                <div style="min-width: 0;">
                  <span style="font-size: 0.65rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700; display: block;">Correo Comprobantes</span>
                  <strong style="font-size: 0.85rem; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">${escapeHtml(bankTransfer.email || 'No especificado')}</strong>
                </div>
                ${bankTransfer.email ? `<button type="button" onclick="window.copyPosBankField('email', 'Correo')" title="Copiar Correo" style="background: none; border: none; color: #6366f1; cursor: pointer; padding: 2px 4px; font-size: 0.9rem;"><i class="ri-file-copy-line"></i></button>` : ''}
              </div>

              <div style="background: rgba(16, 185, 129, 0.08); border: 1.5px solid rgba(16, 185, 129, 0.4); border-top: 2.5px solid #10b981; border-radius: 6px; padding: 0.45rem 0.65rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
                <div style="min-width: 0;">
                  <span style="font-size: 0.65rem; text-transform: uppercase; color: #047857; font-weight: 800; display: block;">Monto a Transferir</span>
                  <strong style="font-size: 0.95rem; color: #065f46; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">${escapeHtml(totalAmount)}</strong>
                </div>
                <button type="button" onclick="window.copyPosBankField('total_amount', 'Monto numérico')" title="Copiar Monto numérico" style="background: none; border: none; color: #047857; cursor: pointer; padding: 2px 4px; font-size: 0.9rem;"><i class="ri-file-copy-line"></i></button>
              </div>

              <div style="background: rgba(255, 255, 255, 0.95); border: 1px solid rgba(0,0,0,0.08); border-top: 2.5px solid #6366f1; border-radius: 6px; padding: 0.45rem 0.65rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
                <div style="min-width: 0;">
                  <span style="font-size: 0.65rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700; display: block;">Referencia / Asunto</span>
                  <strong style="font-size: 0.85rem; font-family: monospace; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">${escapeHtml(saleCode || '-')}</strong>
                </div>
                ${saleCode ? `<button type="button" onclick="window.copyPosBankField('sale_code', 'Código de venta')" title="Copiar Código" style="background: none; border: none; color: #6366f1; cursor: pointer; padding: 2px 4px; font-size: 0.9rem;"><i class="ri-file-copy-line"></i></button>` : ''}
              </div>

            </div>

            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; background: #ffffff; border: 1.5px solid rgba(99, 102, 241, 0.25); border-radius: 10px; padding: 0.65rem 0.75rem; box-shadow: 0 2px 8px rgba(0,0,0,0.05); min-width: 155px; text-align: center;">
              <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; margin-bottom: 0.35rem;">
                <span style="font-size: 0.68rem; font-weight: 700; color: #4f46e5; text-transform: uppercase; display: flex; align-items: center; gap: 0.25rem;">
                  <i class="ri-qr-code-line"></i> QR para pago
                </span>
                <span id="pos-qr-caption" style="font-size: 0.62rem; color: ${isWa ? '#059669' : '#4f46e5'}; font-weight: 700;">
                  ${isWa ? 'Abre WhatsApp' : 'Texto directo'}
                </span>
              </div>
              
              <div style="display: inline-flex; background: rgba(0,0,0,0.06); border-radius: 14px; padding: 2px; font-size: 0.66rem; font-weight: 700; margin-bottom: 0.4rem; width: 100%;">
                <button type="button" id="pos-qr-toggle-wa" onclick="window.setPosBankQrMode('whatsapp')" style="flex: 1; border: none; border-radius: 12px; padding: 2px 6px; cursor: pointer; background: ${isWa ? '#25D366' : 'transparent'}; color: ${isWa ? '#ffffff' : 'var(--color-text-muted)'}; display: flex; align-items: center; justify-content: center; gap: 3px; font-weight: 700; transition: all 0.2s;">
                  <i class="ri-whatsapp-line"></i> WhatsApp
                </button>
                <button type="button" id="pos-qr-toggle-txt" onclick="window.setPosBankQrMode('texto')" style="flex: 1; border: none; border-radius: 12px; padding: 2px 6px; cursor: pointer; background: ${!isWa ? '#4f46e5' : 'transparent'}; color: ${!isWa ? '#ffffff' : 'var(--color-text-muted)'}; display: flex; align-items: center; justify-content: center; gap: 3px; font-weight: 700; transition: all 0.2s;">
                  <i class="ri-file-text-line"></i> Texto
                </button>
              </div>

              <div style="background: #ffffff; padding: 3px; border-radius: 6px; cursor: pointer;" onclick="window.openPosBankQrModal()" title="Clic para agrandar QR">
                <canvas id="pos-bank-qr-canvas" style="display: block; border-radius: 4px;"></canvas>
              </div>
              <button type="button" onclick="window.openPosBankQrModal()" class="btn btn-outline btn-sm" style="margin-top: 0.45rem; font-size: 0.7rem; padding: 0.2rem 0.5rem; width: 100%; border-color: rgba(99, 102, 241, 0.3); color: #4f46e5; display: inline-flex; align-items: center; justify-content: center; gap: 0.25rem;">
                <i class="ri-fullscreen-line"></i> Agrandar
              </button>
            </div>
          </div>

          ${bankTransfer.notes ? `
            <div style="margin-top: 0.75rem; background: rgba(255, 255, 255, 0.95); border-left: 4px solid #6366f1; border: 1px solid rgba(99, 102, 241, 0.25); border-left-width: 4px; border-left-color: #6366f1; padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.8rem; color: var(--color-text-main);">
              <strong style="color: #4f46e5;"><i class="ri-information-line"></i> Nota de Transferencia:</strong> ${escapeHtml(bankTransfer.notes)}
            </div>
          ` : ''}
        </div>
      `;

      setTimeout(() => {
        const canvas = document.getElementById('pos-bank-qr-canvas');
        if (canvas) {
          const payload = window.getPosBankQrPayload(window.posBankQrMode || 'whatsapp');
          window.renderPosBankQrToCanvas(canvas, payload, 125);
        }
      }, 30);

    } else {
      banner.innerHTML = `
        <div style="background: rgba(99, 102, 241, 0.08); border: 1.5px dashed #6366f1; border-radius: var(--radius-md); padding: 1rem 1.25rem; display: flex; align-items: center; gap: 0.85rem;">
          <div style="width: 42px; height: 42px; border-radius: 10px; background: rgba(99, 102, 241, 0.15); border: 1.5px solid #6366f1; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; color: #4f46e5; flex-shrink: 0;">
            <i class="ri-bank-card-line"></i>
          </div>
          <div>
            <div style="font-size: 0.75rem; text-transform: uppercase; font-weight: 800; color: #4f46e5; margin-bottom: 0.15rem;">
              TRANSFERENCIA BANCARIA - SIN CUENTA CONFIGURADA
            </div>
            <div style="font-size: 0.84rem; color: var(--color-text-main); line-height: 1.4;">
              El comercio <strong>${escapeHtml(commerceName)}</strong> no tiene registrada su cuenta bancaria para el POS. Puedes configurarla en <strong>Administración > Comercios > Editar Comercio > Datos de Transferencia Bancaria</strong>.
            </div>
          </div>
        </div>
      `;
    }
  } else {
    banner.innerHTML = '';
  }

  if (typeof window.updatePosStep3AbonoPreview === 'function') {
    window.updatePosStep3AbonoPreview();
  }
};

window.updatePosStep3AbonoPreview = function() {
  const commerceName = (document.getElementById('pos-select-commerce')?.value || '').trim();
  const modoPago = document.getElementById('pos-modo-pago')?.value || 'Tarjeta de Débito';
  const periodSelect = document.getElementById('pos-abono-period-select');
  const previewEl = document.getElementById('pos-step3-financial-preview');
  const abonoBox = document.getElementById('pos-step3-abono-period-box');

  if (!commerceName) {
    if (previewEl) previewEl.innerHTML = '';
    return;
  }

  // Calcular monto bruto actual de las filas
  const rows = document.querySelectorAll('#pos-products-tbody tr');
  let totalAmount = 0;
  rows.forEach(r => {
    const qty = parseInt(r.querySelector('.pos-row-qty')?.value, 10) || 0;
    const priceVal = r.querySelector('.pos-row-price')?.value;
    const price = (priceVal !== '' && !isNaN(priceVal)) ? Math.max(0, parseInt(priceVal, 10)) : 0;
    totalAmount += Math.max(0, qty * price);
  });

  const dummySale = {
    comercio: commerceName,
    modo_pago: modoPago,
    monto_total: totalAmount,
    created_at: new Date().toISOString()
  };

  const machineInfo = window.resolvePosSaleMachineInfo(dummySale, window.loadedCommerceConfigsMap, null);
  const fin = window.calculatePosSaleFinancials(dummySale, machineInfo, window.posCachedPricingConfig);
  const currentDefaultPeriod = window.derivePosPeriodFromDate(new Date());
  const availablePeriods = window.getAvailablePosBillingPeriodNames([currentDefaultPeriod]);

  if (periodSelect) {
    const prevValue = periodSelect.value;
    const shouldDefaultSinAbono = !fin.appliesStockaPosSettlement;
    periodSelect.innerHTML = `
      ${availablePeriods.map(p => `<option value="${escapeHtml(p)}">📅 Abonar en Facturación: ${escapeHtml(p)}</option>`).join('')}
      <option value="SIN_ABONO">🚫 Pago Directo Seller / Excluir de Abono Fulfillment</option>
    `;

    const lastModo = periodSelect.dataset.lastModo || '';
    const lastComm = periodSelect.dataset.lastCommerce || '';
    if (lastModo !== modoPago || lastComm !== commerceName || !prevValue) {
      periodSelect.value = shouldDefaultSinAbono ? 'SIN_ABONO' : currentDefaultPeriod;
      periodSelect.dataset.lastModo = modoPago;
      periodSelect.dataset.lastCommerce = commerceName;
    } else if (Array.from(periodSelect.options).some(o => o.value === prevValue)) {
      periodSelect.value = prevValue;
    }
    periodSelect.onchange = () => window.updatePosStep3AbonoPreview();
  }

  const selectedPeriod = periodSelect ? periodSelect.value : (fin.appliesStockaPosSettlement ? currentDefaultPeriod : 'SIN_ABONO');

  if (abonoBox) {
    abonoBox.style.borderColor = (selectedPeriod !== 'SIN_ABONO' && fin.appliesStockaPosSettlement)
      ? 'rgba(16, 185, 129, 0.4)'
      : 'rgba(100, 116, 139, 0.3)';
    abonoBox.style.background = (selectedPeriod !== 'SIN_ABONO' && fin.appliesStockaPosSettlement)
      ? 'rgba(16, 185, 129, 0.06)'
      : 'rgba(100, 116, 139, 0.05)';
  }

  if (previewEl) {
    if (fin.appliesStockaPosSettlement) {
      previewEl.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); gap: 0.55rem; background: #ffffff; border: 1px solid rgba(16, 185, 129, 0.28); border-radius: 8px; padding: 0.65rem 0.8rem;">
          <div>
            <span style="font-size: 0.66rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700; display: block;">Máquina Utilizada</span>
            <strong style="font-size: 0.82rem; color: #0f172a;">${escapeHtml(machineInfo.brand)}${machineInfo.model ? ' #' + escapeHtml(machineInfo.model) : ''}</strong>
            <span style="font-size: 0.66rem; color: #2563eb; font-weight: 700; display: block;">Propiedad de STOCKA</span>
          </div>
          <div>
            <span style="font-size: 0.66rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700; display: block;">Monto Bruto Venta</span>
            <strong style="font-size: 0.92rem; color: #0f172a;">${formatCLP(fin.montoTotal)}</strong>
            <span style="font-size: 0.66rem; color: var(--color-text-muted); display: block;">${escapeHtml(modoPago)}</span>
          </div>
          <div>
            <span style="font-size: 0.66rem; text-transform: uppercase; color: #dc2626; font-weight: 700; display: block;">Comisión POS (${fin.feePct.toFixed(2)}% + IVA)</span>
            <strong style="font-size: 0.9rem; color: #dc2626;">-${formatCLP(fin.commissionTotal)}</strong>
            <span style="font-size: 0.65rem; color: var(--color-text-muted); display: block;">Neto ${formatCLP(fin.commissionNet)} + IVA ${formatCLP(fin.commissionIva)}</span>
          </div>
          <div style="background: rgba(16, 185, 129, 0.08); border-radius: 6px; padding: 0.35rem 0.55rem; border: 1px solid rgba(16, 185, 129, 0.25);">
            <span style="font-size: 0.66rem; text-transform: uppercase; color: #047857; font-weight: 800; display: block;">Pago al Seller (Abono)</span>
            <strong style="font-size: 1rem; color: #059669; font-weight: 900;">${formatCLP(fin.sellerPayout)}</strong>
            <span style="font-size: 0.65rem; color: #047857; font-weight: 700; display: block;">${selectedPeriod !== 'SIN_ABONO' ? 'Abona en ' + escapeHtml(selectedPeriod) : 'Excluido de abono'}</span>
          </div>
        </div>
      `;
    } else {
      previewEl.innerHTML = `
        <div style="background: #ffffff; border: 1px solid rgba(100, 116, 139, 0.25); border-radius: 8px; padding: 0.6rem 0.8rem; font-size: 0.78rem; color: #475569; display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;">
          <span><i class="ri-information-line" style="color: #7c3aed;"></i> <strong>${escapeHtml(fin.reasonLabel)}:</strong> El comercio recibe el 100% directo (${formatCLP(fin.montoTotal)}) sin comisión POS de Stocka ($0).</span>
          <span style="font-size: 0.72rem; font-weight: 700; color: #64748b;">Estado: ${selectedPeriod === 'SIN_ABONO' ? 'Recaudación Directa Seller' : 'Abono Manual en ' + escapeHtml(selectedPeriod)}</span>
        </div>
      `;
    }
  }
};

// ====== 4. CARGA DE CATÁLOGO E INVENTARIO POR COMERCIO ======

window.loadPosCommerceCatalog = async function(commerceName) {
  const badgesContainer = document.getElementById('pos-commerce-badges-container');
  if (badgesContainer) {
    badgesContainer.innerHTML = '<span class="text-muted" style="font-size: 0.75rem;"><i class="ri-loader-4-line spin"></i> Verificando catálogo e inventario...</span>';
  }

  window.posCatalogProducts = [];
  window.posSelectedCommerceConfig = null;

  try {
    // 1. Obtener configuración adicional del comercio (evitando solicitar columnas inexistentes como sigla)
    let cac = null;
    try {
      const { data: cacRes, error: cacErr } = await supabase
        .from('comercios_adicional_config')
        .select('comercio, inventario_seguimiento, onboarding_checklist')
        .ilike('comercio', commerceName.trim())
        .maybeSingle();

      if (!cacErr && cacRes) {
        cac = cacRes;
      }
    } catch (e) {
      console.warn('Aviso consultando comercios_adicional_config:', e);
    }

    // Fallbacks robustos con las cachés globales cargadas en Admin
    if (!cac && window.loadedCommerceConfigsMap) {
      const foundKey = Object.keys(window.loadedCommerceConfigsMap).find(k => k.trim().toLowerCase() === commerceName.trim().toLowerCase());
      if (foundKey) {
        cac = window.loadedCommerceConfigsMap[foundKey];
      }
    }
    if (!cac && window.cachedAdminMerchants) {
      const foundM = window.cachedAdminMerchants.find(m => (m.nombre || '').trim().toLowerCase() === commerceName.trim().toLowerCase());
      if (foundM) {
        cac = {
          comercio: foundM.nombre,
          inventario_seguimiento: foundM.inventario_seguimiento !== undefined ? Boolean(foundM.inventario_seguimiento) : false,
          onboarding_checklist: foundM.onboarding_checklist || {}
        };
      }
    }

    window.posSelectedCommerceConfig = cac || {
      inventario_seguimiento: false,
      onboarding_checklist: {}
    };

    const hasStockTracking = Boolean(window.posSelectedCommerceConfig?.inventario_seguimiento);
    const isCatalogConfigured = Boolean(window.posSelectedCommerceConfig?.onboarding_checklist?.catalog_ready);

    // 2. Obtener productos del catálogo con su inventario en Matriz Ñuñoa e imagen (sin límite de 1.000 filas)
    let products = [];
    if (typeof window.fetchAllSupabaseRows === 'function') {
      products = await window.fetchAllSupabaseRows(
        'products',
        'id, sku, name, price, image_url, is_pack, is_virtual, inventory(quantity, committed_quantity, reserved_quantity, warehouse_id)',
        q => q.eq('comercio', commerceName).neq('status', 'archived').order('name')
      );
    } else {
      const { data: pData, error: prodErr } = await supabase
        .from('products')
        .select('id, sku, name, price, image_url, is_pack, is_virtual, inventory(quantity, committed_quantity, reserved_quantity, warehouse_id)')
        .eq('comercio', commerceName)
        .neq('status', 'archived')
        .order('name');
      if (prodErr) throw prodErr;
      products = pData || [];
    }

    const rawProds = (products || []).filter(p => !p.is_pack && !p.is_virtual);

    // Mapear productos calculando stock disponible en Matriz Ñuñoa y desglose completo
    window.posCatalogProducts = rawProds.map(p => {
      const invList = p.inventory || [];
      const nunoaInv = invList.find(inv => inv.warehouse_id === SUCURSAL_NUNOA_WH_ID);
      const nunoaQty = nunoaInv ? (nunoaInv.quantity || 0) : 0;
      const nunoaCommitted = nunoaInv ? (nunoaInv.committed_quantity || 0) : 0;
      const nunoaReserved = nunoaInv ? (nunoaInv.reserved_quantity || 0) : 0;
      const availableInNunoa = Math.max(0, nunoaQty - nunoaCommitted - nunoaReserved);

      const totalPhysical = invList.reduce((acc, inv) => acc + (inv.quantity || 0), 0);
      const totalCommitted = invList.reduce((acc, inv) => acc + (inv.committed_quantity || 0), 0);
      const totalReserved = invList.reduce((acc, inv) => acc + (inv.reserved_quantity || 0), 0);
      const totalAvailable = Math.max(0, totalPhysical - totalCommitted - totalReserved);

      return {
        id: p.id,
        sku: p.sku || '',
        name: p.name || '',
        price: p.price || 0,
        image_url: p.image_url || '',
        nunoa_physical: nunoaQty,
        nunoa_committed: nunoaCommitted,
        nunoa_reserved: nunoaReserved,
        available_nunoa: availableInNunoa,
        total_physical: totalPhysical,
        total_committed: totalCommitted,
        total_reserved: totalReserved,
        available_total: totalAvailable
      };
    });

    const hasCatalogItems = window.posCatalogProducts.length > 0;

    // 3. Renderizar badges de estado en el Paso 1
    if (badgesContainer) {
      const isPosActive = window.posSelectedCommerceConfig?.onboarding_checklist?.pos_active === true;
      const machineInfo = window.posSelectedCommerceConfig?.onboarding_checklist?.pos_machine;
      const mColor = window.resolvePosMachineColor(machineInfo?.color, machineInfo?.color_hex);
      const mReadable = (typeof window.getPosReadableTextColor === 'function') ? window.getPosReadableTextColor(mColor) : mColor;
      const machineSnippet = (machineInfo?.brand || machineInfo?.model) 
        ? ` (${escapeHtml(machineInfo.brand || '')}${machineInfo.color ? ' ' + escapeHtml(machineInfo.color) : ''}${machineInfo.model ? ' · <strong style="font-family:monospace;font-size:0.82rem;">#' + escapeHtml(machineInfo.model) + '</strong>' : ''})` 
        : '';

      const posBadge = isPosActive
        ? `<span class="badge" style="background: ${mColor}18; color: ${mReadable}; border: 1.5px solid ${mColor}55; font-size: 0.75rem; display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 700;">
            ${window.getPosMachineSvg(mColor, 16)} POS Activo${machineSnippet}
          </span>`
        : `<span class="badge" style="background: rgba(239, 68, 68, 0.1); color: #dc2626; border: 1px solid rgba(239, 68, 68, 0.3); font-size: 0.75rem;"><i class="ri-forbid-line"></i> POS Deshabilitado</span>`;

      const activePaymentMethods = window.getMerchantActivePosPaymentMethods(window.posSelectedCommerceConfig?.onboarding_checklist || {});
      const paymentBadge = (isPosActive && activePaymentMethods.length < 4)
        ? `<span class="badge" style="background: rgba(37, 99, 235, 0.1); color: #1d4ed8; border: 1px solid rgba(37, 99, 235, 0.3); font-size: 0.75rem;"><i class="ri-bank-card-line"></i> Pagos habilitados: ${activePaymentMethods.map(m => escapeHtml(m)).join(', ')}</span>`
        : '';

      const catalogBadge = (hasCatalogItems || isCatalogConfigured)
        ? `<span class="badge" style="background: rgba(16, 185, 129, 0.1); color: #059669; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.75rem;"><i class="ri-checkbox-circle-line"></i> Catálogo Activo (${window.posCatalogProducts.length} productos)</span>`
        : `<span class="badge" style="background: rgba(245, 158, 11, 0.1); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.75rem;"><i class="ri-alert-line"></i> Sin Catálogo (Modo Manual)</span>`;

      const stockBadge = hasStockTracking
        ? `<span class="badge" style="background: rgba(59, 130, 246, 0.1); color: #2563eb; border: 1px solid rgba(59, 130, 246, 0.3); font-size: 0.75rem;"><i class="ri-database-2-line"></i> Seguimiento de Stock Activo (Descuenta en Ñuñoa)</span>`
        : `<span class="badge badge-neutral" style="font-size: 0.75rem;"><i class="ri-information-line"></i> Sin Seguimiento de Stock</span>`;

      badgesContainer.innerHTML = `${posBadge} ${paymentBadge} ${catalogBadge} ${stockBadge}`;
    }

    // Actualizar medios de pago disponibles según la configuración del comercio cargado
    window.updatePosAvailablePaymentMethods();

    // 4. Ajustar modo manual y filas de la tabla de productos
    const manualCheckbox = document.getElementById('pos-manual-mode');
    const manualWrapper = document.getElementById('pos-manual-mode-wrapper');

    if (hasCatalogItems) {
      if (manualCheckbox) manualCheckbox.checked = false;
      if (manualWrapper) manualWrapper.style.display = 'flex';
    } else {
      if (manualCheckbox) manualCheckbox.checked = true;
      if (manualWrapper) manualWrapper.style.display = 'flex';
    }

    // 5. Poblar primera fila de productos
    const tbody = document.getElementById('pos-products-tbody');
    tbody.innerHTML = '';
    window.addPosRow(!hasCatalogItems);
    window.calculatePosTotals();

  } catch (err) {
    console.error('Error cargando catálogo del comercio para POS:', err);
    if (badgesContainer) {
      badgesContainer.innerHTML = `<span class="text-danger" style="font-size: 0.75rem;"><i class="ri-error-warning-line"></i> Error al cargar catálogo: ${err.message}</span>`;
    }
  }
};

// Helper para abrir imagen en grande (lightbox / confirmación visual)
window.openPosImageLightbox = function(imageUrl, productName) {
  if (!imageUrl) return;
  if (typeof Swal !== 'undefined') {
    Swal.fire({
      title: productName || 'Vista previa del producto',
      imageUrl: imageUrl,
      imageAlt: productName || 'Producto',
      imageMaxHeight: 450,
      showCloseButton: true,
      confirmButtonText: 'Cerrar',
      confirmButtonColor: 'var(--color-primary)'
    });
  } else {
    window.open(imageUrl, '_blank');
  }
};

// ====== 5. TABLA DINÁMICA DE PRODUCTOS ======

// Renderizador del buscador interactivo con desglose de stock (Físico, Mesa/Reservado, Comprometido, Disp. Ñuñoa)
window.renderPosRowDropdown = function(tr, query = '') {
  const dropdown = tr.querySelector('.pos-product-dropdown-list');
  if (!dropdown) return;

  const catalog = window.posCatalogProducts || [];
  const q = (query || '').toLowerCase().trim();

  let filtered = [];
  if (!q) {
    filtered = catalog.slice(0, 40);
  } else {
    const tokens = q.split(/\s+/).filter(Boolean);
    filtered = catalog.filter(p => {
      const target = `${p.sku || ''} ${p.name || ''}`.toLowerCase();
      return tokens.every(tok => target.includes(tok));
    }).slice(0, 40);
  }

  if (filtered.length === 0) {
    dropdown.innerHTML = `
      <div style="padding: 1.25rem 1rem; text-align: center; color: var(--color-text-muted); font-size: 0.85rem;">
        <i class="ri-search-line" style="font-size: 1.4rem; display: block; margin-bottom: 0.35rem; color: #94a3b8;"></i>
        No se encontraron productos para "<strong>${escapeHtml(query)}</strong>"
      </div>
    `;
    dropdown.style.display = 'block';
    return;
  }

  let html = '';
  filtered.forEach(p => {
    const isOutOfStock = (p.available_nunoa || 0) <= 0;
    const availBadge = isOutOfStock
      ? `<span style="background: rgba(239, 68, 68, 0.12); color: #dc2626; border: 1px solid rgba(239, 68, 68, 0.3); padding: 1.5px 7px; border-radius: 4px; font-weight: 700; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 0.25rem;">
          <i class="ri-alert-line"></i> Disp Ñuñoa: 0 un
        </span>`
      : `<span style="background: rgba(16, 185, 129, 0.12); color: #059669; border: 1px solid rgba(16, 185, 129, 0.3); padding: 1.5px 7px; border-radius: 4px; font-weight: 700; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 0.25rem;">
          <i class="ri-checkbox-circle-line"></i> Disp Ñuñoa: ${p.available_nunoa} un
        </span>`;

    html += `
      <div class="pos-product-search-item" data-id="${p.id}" style="padding: 0.6rem 0.8rem; cursor: pointer; border-bottom: 1px solid var(--color-border); color: var(--color-text-main); transition: background-color 0.15s; display: flex; flex-direction: column; gap: 0.3rem;" onmouseover="this.style.backgroundColor='var(--color-bg, #f8fafc)'" onmouseout="this.style.backgroundColor='transparent'">
        <div style="display: flex; gap: 0.65rem; align-items: center;">
          ${p.image_url ? `
            <img src="${escapeHtml(p.image_url)}" alt="" style="width: 38px; height: 38px; object-fit: cover; border-radius: 6px; border: 1px solid var(--color-border); flex-shrink: 0;" onerror="this.style.display='none'">
          ` : `
            <div style="width: 38px; height: 38px; border-radius: 6px; border: 1px solid var(--color-border); background: var(--color-bg); display: flex; align-items: center; justify-content: center; color: var(--color-text-muted); flex-shrink: 0;"><i class="ri-image-line" style="font-size: 1.2rem;"></i></div>
          `}
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem;">
              <span style="font-weight: 700; color: var(--color-primary, #2563eb); font-size: 0.88rem; font-family: monospace;">${escapeHtml(p.sku)}</span>
              <span style="color: var(--color-text-muted); font-weight: 600; font-size: 0.82rem;">${formatCLP(p.price || 0)}</span>
            </div>
            <div style="font-size: 0.82rem; color: var(--color-text-main); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(p.name)}">
              ${escapeHtml(p.name)}
            </div>
          </div>
        </div>

        <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.4rem; font-size: 0.73rem; background: rgba(0,0,0,0.025); padding: 0.3rem 0.55rem; border-radius: 4px; border: 1px dashed var(--color-border);">
          <div style="display: flex; gap: 0.6rem; color: var(--color-text-muted); align-items: center; font-size: 0.73rem;">
            <span title="Stock físico total en Ñuñoa" style="display: inline-flex; align-items: center; gap: 0.25rem;">
              <i class="ri-box-3-line" style="color: var(--color-primary); font-size: 0.85rem;"></i> Fís: <strong style="color: var(--color-text-main);">${p.nunoa_physical}</strong>
            </span>
            <span style="opacity: 0.35;">|</span>
            <span title="Stock en mesa de preparación / reservado" style="display: inline-flex; align-items: center; gap: 0.25rem;">
              <i class="ri-archive-drawer-line" style="color: #f59e0b; font-size: 0.85rem;"></i> Mesa: <strong style="color: #d97706;">${p.nunoa_reserved}</strong>
            </span>
            <span style="opacity: 0.35;">|</span>
            <span title="Stock comprometido en pedidos en proceso" style="display: inline-flex; align-items: center; gap: 0.25rem;">
              <i class="ri-time-line" style="color: #3b82f6; font-size: 0.85rem;"></i> Comp: <strong style="color: #3b82f6;">${p.nunoa_committed}</strong>
            </span>
            ${p.available_total > p.available_nunoa ? `
              <span style="opacity: 0.35;">|</span>
              <span title="Stock disponible en toda la red STOCKA" style="color: var(--color-text-muted);">
                Red: <strong style="color: var(--color-text-main);">${p.available_total}</strong>
              </span>
            ` : ''}
          </div>
          <div>
            ${availBadge}
          </div>
        </div>
      </div>
    `;
  });

  dropdown.innerHTML = html;
  dropdown.style.display = 'block';

  dropdown.querySelectorAll('.pos-product-search-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const pid = item.getAttribute('data-id');
      window.selectPosRowProduct(tr, pid);
    });
  });
};

// Selección de producto en la fila POS
window.selectPosRowProduct = function(tr, productId) {
  const p = (window.posCatalogProducts || []).find(prod => prod.id === productId);
  if (!p) return;

  tr.dataset.productId = p.id;
  tr.dataset.sku = p.sku;
  tr.dataset.name = p.name;
  tr.dataset.stock = p.available_nunoa;
  tr.dataset.nunoaPhysical = p.nunoa_physical;
  tr.dataset.nunoaReserved = p.nunoa_reserved;
  tr.dataset.nunoaCommitted = p.nunoa_committed;
  tr.dataset.imageUrl = p.image_url || '';

  const input = tr.querySelector('.pos-row-catalog-input');
  if (input) input.value = `${p.sku} - ${p.name}`;

  const dropdown = tr.querySelector('.pos-product-dropdown-list');
  if (dropdown) dropdown.style.display = 'none';

  const arrow = tr.querySelector('.pos-dropdown-arrow');
  if (arrow) arrow.style.transform = 'rotate(0deg)';

  // Vista previa de imagen
  const imgPreview = tr.querySelector('.pos-product-img-preview');
  if (imgPreview) {
    if (p.image_url) {
      imgPreview.innerHTML = `
        <img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.name)}" 
             style="width: 100%; height: 100%; object-fit: cover; display: block; border-radius: 4px;" 
             onerror="this.outerHTML='<i class=\\'ri-image-line\\' style=\\'color:var(--color-text-muted);font-size:1.25rem;\\'></i>'">
      `;
      imgPreview.style.borderColor = 'var(--color-primary)';
      imgPreview.style.cursor = 'pointer';
      imgPreview.title = `${p.name} (Click para ampliar)`;
      imgPreview.onclick = () => window.openPosImageLightbox(p.image_url, p.name);
    } else {
      imgPreview.innerHTML = `<i class="ri-image-line" style="color: var(--color-text-muted); font-size: 1.25rem;"></i>`;
      imgPreview.style.borderColor = 'var(--color-border)';
      imgPreview.style.cursor = 'default';
      imgPreview.title = 'Sin imagen disponible';
      imgPreview.onclick = null;
    }
  }

  // Actualizar columna de stock con badges y niveles de stock idéntico a pedido manual
  const stockContainer = tr.querySelector('.pos-row-stock-container') || tr.querySelector('td:nth-child(2)');
  if (stockContainer) {
    const isOutOfStock = (p.available_nunoa <= 0);
    stockContainer.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;">
        <span class="pos-row-stock-badge badge ${isOutOfStock ? 'badge-danger' : 'badge-success'}" style="font-size: 0.78rem; font-weight: 700;">
          <i class="${isOutOfStock ? 'ri-close-line' : 'ri-check-line'}"></i> ${p.available_nunoa} un
        </span>
        <div style="font-size: 0.68rem; color: var(--color-text-muted); white-space: nowrap; line-height: 1.2;" title="Stock Físico en Ñuñoa: ${p.nunoa_physical} | En Mesa (Reservado): ${p.nunoa_reserved} | Comprometido: ${p.nunoa_committed}">
          Fís:${p.nunoa_physical} · Mesa:${p.nunoa_reserved} · Comp:${p.nunoa_committed}
        </div>
      </div>
    `;
  }

  // Si el comercio tiene seguimiento estricto, limitar max
  if (window.posSelectedCommerceConfig?.inventario_seguimiento) {
    const qtyInput = tr.querySelector('.pos-row-qty');
    if (qtyInput) qtyInput.max = p.available_nunoa;
  }

  window.calculatePosTotals();

  // Enfocar precio unitario para agilizar el cobro
  const priceInput = tr.querySelector('.pos-row-price');
  if (priceInput) {
    priceInput.focus();
  }
};

window.addPosRow = function(isManual) {
  const tbody = document.getElementById('pos-products-tbody');
  if (!tbody) return;

  const tr = document.createElement('tr');
  tr.className = 'pos-product-row';

  const rowId = Math.random().toString(36).substr(2, 9);

  let prodCellHtml = '';
  if (isManual) {
    tr.dataset.manual = 'true';
    prodCellHtml = `
      <div style="display: flex; align-items: center; gap: 0.65rem;">
        <div class="pos-product-img-preview" style="width: 44px; height: 44px; min-width: 44px; border-radius: var(--radius-sm, 6px); border: 1px dashed var(--color-border); background: var(--color-bg); display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0;" title="Ingreso manual">
          <i class="ri-edit-line" style="color: var(--color-text-muted); font-size: 1.15rem;"></i>
        </div>
        <div style="display: flex; gap: 0.5rem; flex: 1; min-width: 0;">
          <input type="text" class="form-input pos-row-sku" placeholder="SKU" required style="width: 35%;">
          <input type="text" class="form-input pos-row-name" placeholder="Nombre del Producto" required style="width: 65%;">
        </div>
      </div>
    `;
  } else {
    tr.dataset.manual = 'false';
    prodCellHtml = `
      <div style="display: flex; align-items: center; gap: 0.65rem;">
        <div class="pos-product-img-preview" style="width: 44px; height: 44px; min-width: 44px; border-radius: var(--radius-sm, 6px); border: 1px solid var(--color-border); background: var(--color-bg); display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0; box-shadow: var(--shadow-sm); transition: all 0.2s;" title="Vista previa del producto">
          <i class="ri-image-line" style="color: var(--color-text-muted); font-size: 1.25rem;"></i>
        </div>
        <div style="flex: 1; min-width: 0; position: relative;" class="pos-product-search-wrapper">
          <div style="position: relative; display: flex; align-items: center;">
            <input type="text" class="form-input pos-row-catalog-input" placeholder="🔍 Escribe para buscar SKU o nombre..." autocomplete="off" required style="width: 100%; padding-right: 2rem;">
            <i class="ri-arrow-down-s-line pos-dropdown-arrow" style="position: absolute; right: 0.65rem; color: var(--color-text-muted); pointer-events: none; transition: transform 0.2s;"></i>
          </div>
          <div class="pos-product-dropdown-list" style="display: none; position: absolute; top: calc(100% + 4px); left: 0; min-width: 440px; max-width: 600px; max-height: 290px; overflow-y: auto; background: var(--color-surface, #ffffff); border: 1px solid var(--color-border); border-radius: var(--radius-sm, 6px); box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.15); z-index: 1200;">
          </div>
        </div>
      </div>
    `;
  }

  tr.innerHTML = `
    <td>${prodCellHtml}</td>
    <td style="text-align: center; vertical-align: middle;">
      <div class="pos-row-stock-container" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;">
        <span class="pos-row-stock-badge badge badge-neutral" style="font-size: 0.78rem;">
          ${isManual ? 'Manual' : '-'}
        </span>
      </div>
    </td>
    <td style="text-align: center;">
      <input type="number" class="form-input pos-row-qty" min="1" value="1" required style="width: 100%; text-align: center;">
    </td>
    <td style="text-align: right;">
      <div style="display: flex; align-items: center; justify-content: flex-end; gap: 0.25rem;">
        <span style="color: var(--color-text-muted);">$</span>
        <input type="number" class="form-input pos-row-price" min="0" value="" placeholder="Ingresa $" step="10" required style="width: 115px; text-align: right; font-weight: 600;" title="Ingresa estrictamente el valor dado por el comercio en su web o autorizado">
      </div>
    </td>
    <td style="text-align: right; font-weight: 700; color: #10b981; font-size: 0.95rem;">
      <span class="pos-row-subtotal">$0</span>
    </td>
    <td style="text-align: center;">
      <button type="button" class="btn-remove-pos-row" style="background: none; border: none; color: var(--color-danger, #ef4444); cursor: pointer; font-size: 1.15rem;" title="Eliminar ítem">
        <i class="ri-delete-bin-line"></i>
      </button>
    </td>
  `;

  tbody.appendChild(tr);

  // Listener para autocomplete de catálogo y actualización de vista previa de imagen
  if (!isManual) {
    const input = tr.querySelector('.pos-row-catalog-input');
    const dropdown = tr.querySelector('.pos-product-dropdown-list');
    const arrow = tr.querySelector('.pos-dropdown-arrow');

    input.addEventListener('focus', () => {
      document.querySelectorAll('.pos-product-dropdown-list').forEach(d => {
        if (d !== dropdown) d.style.display = 'none';
      });
      document.querySelectorAll('.pos-dropdown-arrow').forEach(a => {
        if (a !== arrow) a.style.transform = 'rotate(0deg)';
      });
      if (arrow) arrow.style.transform = 'rotate(180deg)';
      window.renderPosRowDropdown(tr, input.value);
    });

    input.addEventListener('input', () => {
      if (arrow) arrow.style.transform = 'rotate(180deg)';
      window.renderPosRowDropdown(tr, input.value);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (dropdown) dropdown.style.display = 'none';
        if (arrow) arrow.style.transform = 'rotate(0deg)';
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const first = dropdown?.querySelector('.pos-product-search-item');
        if (first) {
          first.click();
        }
      }
    });

    input.addEventListener('change', () => {
      const val = input.value.trim();
      if (!val) {
        delete tr.dataset.productId;
        delete tr.dataset.sku;
        delete tr.dataset.name;
        delete tr.dataset.stock;
        delete tr.dataset.imageUrl;

        const imgPreview = tr.querySelector('.pos-product-img-preview');
        if (imgPreview) {
          imgPreview.innerHTML = `<i class="ri-image-line" style="color: var(--color-text-muted); font-size: 1.25rem;"></i>`;
          imgPreview.style.borderColor = 'var(--color-border)';
          imgPreview.style.cursor = 'default';
          imgPreview.title = 'Vista previa del producto';
          imgPreview.onclick = null;
        }

        const stockContainer = tr.querySelector('.pos-row-stock-container');
        if (stockContainer) {
          stockContainer.innerHTML = `<span class="pos-row-stock-badge badge badge-neutral" style="font-size: 0.78rem;">-</span>`;
        }
        window.calculatePosTotals();
      }
    });
  }

  // Listeners de cálculo en tiempo real
  const qtyInput = tr.querySelector('.pos-row-qty');
  const priceInput = tr.querySelector('.pos-row-price');

  const updateLineSubtotal = () => {
    const qty = parseInt(qtyInput?.value, 10) || 0;
    const priceVal = priceInput?.value;
    const price = (priceVal !== '' && !isNaN(priceVal)) ? Math.max(0, parseInt(priceVal, 10)) : 0;
    const subtotal = Math.max(0, qty * price);
    const subtotalSpan = tr.querySelector('.pos-row-subtotal');
    if (subtotalSpan) subtotalSpan.textContent = formatCLP(subtotal);
    window.calculatePosTotals();
  };

  qtyInput?.addEventListener('input', updateLineSubtotal);
  priceInput?.addEventListener('input', updateLineSubtotal);

  // Listener para eliminar fila
  tr.querySelector('.btn-remove-pos-row')?.addEventListener('click', () => {
    tr.remove();
    window.calculatePosTotals();
  });

  updateLineSubtotal();
};

// Cálculo general de montos totales
window.calculatePosTotals = function() {
  const rows = document.querySelectorAll('#pos-products-tbody tr');
  let total = 0;

  rows.forEach(r => {
    const qty = parseInt(r.querySelector('.pos-row-qty')?.value, 10) || 0;
    const priceVal = r.querySelector('.pos-row-price')?.value;
    const price = (priceVal !== '' && !isNaN(priceVal)) ? Math.max(0, parseInt(priceVal, 10)) : 0;
    total += Math.max(0, qty * price);
  });

  const neto = Math.round(total / 1.19);
  const iva = total - neto;

  const netoSpan = document.getElementById('pos-summary-neto');
  const ivaSpan = document.getElementById('pos-summary-iva');
  const totalSpan = document.getElementById('pos-summary-total');

  if (netoSpan) netoSpan.textContent = formatCLP(neto);
  if (ivaSpan) ivaSpan.textContent = formatCLP(iva);
  if (totalSpan) totalSpan.textContent = formatCLP(total);

  const confirmTotal = document.getElementById('pos-confirm-total');
  if (confirmTotal) confirmTotal.textContent = formatCLP(total);

  if (typeof window.updatePosStep3AbonoPreview === 'function') {
    window.updatePosStep3AbonoPreview();
  }
};

// ====== 6. GUARDAR VENTA, CREAR PEDIDO Y DESCONTAR STOCK ======

window.savePosSale = async function(e) {
  if (e) e.preventDefault();

  const btnSave = document.getElementById('btn-pos-save');
  const commerce = document.getElementById('pos-select-commerce')?.value;
  const customerName = document.getElementById('pos-customer-name')?.value.trim();
  const customerEmail = document.getElementById('pos-customer-email')?.value.trim();
  const customerPhone = document.getElementById('pos-customer-phone')?.value.trim();
  const docTipo = document.getElementById('pos-documento-tipo')?.value || 'BOLETA';
  const modoPago = document.getElementById('pos-modo-pago')?.value || 'Tarjeta de Débito';
  let codigoVenta = document.getElementById('pos-codigo-venta')?.value.trim().toUpperCase();
  if (!codigoVenta || codigoVenta.replace(/[^0-9]/g, '').length < 4) {
    const prefixPart = (codigoVenta && codigoVenta.includes('-')) ? codigoVenta.split('-')[0] : 'POS';
    codigoVenta = window.generatePosSaleCode(prefixPart);
    const codeInputEl = document.getElementById('pos-codigo-venta');
    if (codeInputEl) codeInputEl.value = codigoVenta;
  }
  const comments = document.getElementById('pos-comments')?.value.trim();

  // Datos factura
  const fRut = document.getElementById('pos-factura-rut')?.value.trim();
  const fRazon = document.getElementById('pos-factura-razon-social')?.value.trim();
  const fGiro = document.getElementById('pos-factura-giro')?.value.trim();
  const fDireccion = document.getElementById('pos-factura-direccion')?.value.trim();

  // Ítems de la venta
  const rows = document.querySelectorAll('#pos-products-tbody tr');
  if (rows.length === 0) {
    Swal.fire({
      icon: 'warning',
      title: 'Sin Productos',
      text: 'Debes agregar al menos un producto.',
      confirmButtonColor: 'var(--color-primary)'
    });
    return;
  }

  const isManual = document.getElementById('pos-manual-mode')?.checked;
  const itemsPayload = [];
  let totalAmount = 0;
  let totalUnits = 0;

  for (const r of rows) {
    const qty = parseInt(r.querySelector('.pos-row-qty')?.value, 10) || 1;
    const price = parseInt(r.querySelector('.pos-row-price')?.value, 10) || 0;
    const subtotal = qty * price;
    totalAmount += subtotal;
    totalUnits += qty;

    let sku = '';
    let name = '';
    let productId = null;

    if (isManual) {
      sku = r.querySelector('.pos-row-sku')?.value.trim() || 'SKU-MANUAL';
      name = r.querySelector('.pos-row-name')?.value.trim() || 'Producto Manual';
    } else {
      productId = r.dataset.productId || null;
      sku = r.dataset.sku || '';
      name = r.dataset.name || r.querySelector('.pos-row-catalog-input')?.value.trim() || 'Producto';
    }

    itemsPayload.push({
      sku: sku,
      producto: name,
      product_id: productId,
      cantidad: qty,
      precio: price,
      subtotal: subtotal,
      image_url: r.dataset.imageUrl || null
    });
  }

  // Validar que el medio de pago esté activo para el comercio
  const activePaymentMethods = window.getMerchantActivePosPaymentMethods(window.resolvePosCommerceConfig(commerce)?.onboarding_checklist || {});
  if (!activePaymentMethods.includes(modoPago)) {
    Swal.fire({
      icon: 'error',
      title: 'Medio de Pago No Habilitado',
      text: `El medio de pago "${modoPago}" no está habilitado para ${commerce}. Medios activos: ${activePaymentMethods.join(', ')}.`,
      confirmButtonColor: 'var(--color-primary)'
    });
    window.updatePosAvailablePaymentMethods();
    return;
  }

  const assignedPosMachine = window.resolvePosCommerceConfig(commerce)?.onboarding_checklist?.pos_machine || {};
  const isCardSale = (modoPago === 'Tarjeta de Débito' || modoPago === 'Tarjeta de Crédito');
  const selectedAbonoPeriodVal = document.getElementById('pos-abono-period-select')?.value || window.derivePosPeriodFromDate(new Date());
  const rawTxCodeVal = document.getElementById('pos-tx-code-input')?.value || '';
  const txCodeVal = window.sanitizePosTransactionCode(rawTxCodeVal);
  const txInputEl = document.getElementById('pos-tx-code-input');
  if (txInputEl && txInputEl.value !== txCodeVal) {
    txInputEl.value = txCodeVal;
  }

  // Validar unicidad del código de transacción antes de continuar si fue ingresado
  if (txCodeVal) {
    const dupCheck = await window.checkPosTransactionCodeDuplicate(txCodeVal, null);
    if (dupCheck.isDuplicate) {
      const conf = dupCheck.conflictingSale || {};
      const confDate = conf.created_at ? new Date(conf.created_at).toLocaleDateString('es-CL') : '';
      if (txInputEl) {
        txInputEl.style.borderColor = '#ef4444';
        txInputEl.focus();
      }
      Swal.fire({
        icon: 'error',
        title: 'Código de Transacción Duplicado',
        html: `
          <div style="text-align: left; font-size: 0.88rem; line-height: 1.5;">
            <p style="margin-bottom: 0.65rem;">El código de transacción <strong style="font-family: monospace; color: #dc2626; background: rgba(239,68,68,0.1); padding: 2px 6px; border-radius: 4px;">${escapeHtml(txCodeVal)}</strong> ya fue ingresado anteriormente y no puede repetirse.</p>
            <div style="background: var(--color-bg, #f8fafc); border: 1px solid var(--color-border, #e2e8f0); border-radius: 8px; padding: 0.65rem 0.85rem; font-size: 0.82rem;">
              <div><strong>Venta existente:</strong> <span style="font-family: monospace;">${escapeHtml(conf.codigo_venta || '#' + conf.id)}</span></div>
              <div><strong>Comercio:</strong> ${escapeHtml(conf.comercio || 'N/A')}</div>
              ${conf.nombre_cliente ? `<div><strong>Cliente:</strong> ${escapeHtml(conf.nombre_cliente)}</div>` : ''}
              ${confDate ? `<div><strong>Fecha:</strong> ${escapeHtml(confDate)}</div>` : ''}
            </div>
          </div>
        `,
        confirmButtonText: 'Corregir Código',
        confirmButtonColor: '#ef4444'
      });
      return;
    }
  }

  const previewSaleObj = { comercio: commerce, modo_pago: modoPago, monto_total: totalAmount, created_at: new Date().toISOString() };
  const previewMachineInfo = window.resolvePosSaleMachineInfo(previewSaleObj, window.loadedCommerceConfigsMap, null);
  const previewFin = window.calculatePosSaleFinancials(previewSaleObj, previewMachineInfo, window.posCachedPricingConfig);

  const confirmMachineHtml = (isCardSale && (assignedPosMachine.brand || assignedPosMachine.model))
    ? `<div style="margin-top: 0.65rem; padding: 0.6rem 0.85rem; background: rgba(37, 99, 235, 0.08); border: 1.5px solid rgba(37, 99, 235, 0.35); border-radius: 8px; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">
         <span style="font-size: 0.82rem; font-weight: 700; color: #1e293b;">Máquina POS (${escapeHtml(assignedPosMachine.brand || 'POS')}${assignedPosMachine.color ? ' · ' + escapeHtml(assignedPosMachine.color) : ''}):</span>
         <span style="font-family: monospace; font-size: 1.25rem; font-weight: 900; color: #1d4ed8;">#${escapeHtml(assignedPosMachine.model || 'S/N')}</span>
       </div>`
    : '';

  const confirmSettlementHtml = previewFin.appliesStockaPosSettlement
    ? `<div style="margin-top: 0.55rem; padding: 0.6rem 0.85rem; background: rgba(16, 185, 129, 0.08); border: 1.5px solid rgba(16, 185, 129, 0.35); border-radius: 8px; font-size: 0.8rem;">
         <div style="display: flex; justify-content: space-between;"><span>Comisión POS (${previewFin.feePct.toFixed(2)}% + IVA):</span><strong style="color: #dc2626;">-${formatCLP(previewFin.commissionTotal)}</strong></div>
         <div style="display: flex; justify-content: space-between; margin-top: 2px;"><span>Pago Neto Seller (Abono):</span><strong style="color: #059669;">${formatCLP(previewFin.sellerPayout)}</strong></div>
         <div style="display: flex; justify-content: space-between; margin-top: 2px;"><span>Periodo Facturación (Abono):</span><strong style="color: #047857;">${selectedAbonoPeriodVal === 'SIN_ABONO' ? 'Excluido de Abono' : escapeHtml(selectedAbonoPeriodVal)}</strong></div>
         ${txCodeVal ? `<div style="display: flex; justify-content: space-between; margin-top: 2px;"><span>Cód. Transacción:</span><strong style="color: #0284c7; font-family: monospace;">#${escapeHtml(txCodeVal)}</strong></div>` : ''}
       </div>`
    : `<div style="margin-top: 0.55rem; padding: 0.55rem 0.85rem; background: rgba(100, 116, 139, 0.08); border: 1px solid rgba(100, 116, 139, 0.25); border-radius: 8px; font-size: 0.78rem; color: #475569;">
         <strong>${escapeHtml(previewFin.reasonLabel)}:</strong> Recaudación directa por el comercio ($0 comisión Stocka).
         ${txCodeVal ? `<div style="margin-top: 2px;"><strong>Cód. Transacción:</strong> <span style="font-family: monospace; color: #0284c7;">#${escapeHtml(txCodeVal)}</span></div>` : ''}
       </div>`;

  // Confirmación previa
  const confirmResult = await Swal.fire({
    title: '¿Confirmar y Registrar Venta?',
    html: `
      <div style="text-align: left; font-size: 0.9rem; line-height: 1.5;">
        <p style="margin-bottom: 0.5rem;"><strong>Comercio:</strong> ${escapeHtml(commerce)}</p>
        <p style="margin-bottom: 0.5rem;"><strong>Cliente:</strong> ${escapeHtml(customerName)}</p>
        <p style="margin-bottom: 0.5rem;"><strong>Total a Cobrar:</strong> <span style="color: #10b981; font-weight: 700; font-size: 1.1rem;">${formatCLP(totalAmount)}</span></p>
        <p style="margin-bottom: 0.5rem;"><strong>Medio de Pago:</strong> ${escapeHtml(modoPago)} (${docTipo})</p>
        <p style="margin-bottom: 0.25rem;"><strong>Artículos:</strong> ${totalUnits} unidad(es)</p>
        ${confirmMachineHtml}
        ${confirmSettlementHtml}
      </div>
    `,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Sí, Registrar Venta',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#10b981',
    cancelButtonColor: '#6b7280'
  });

  if (!confirmResult.isConfirmed) return;

  btnSave.disabled = true;
  btnSave.innerHTML = '<i class="ri-loader-4-line spin"></i> Procesando venta...';

  try {
    const posCreatorMeta = typeof window.getCurrentWmsUserCreatorMeta === 'function'
      ? await window.getCurrentWmsUserCreatorMeta('Punto de Venta (POS) · Sucursal Ñuñoa')
      : {
          created_by_user_id: window.currentAdminUser?.id || window.currentUserProfile?.id || null,
          created_by_email: window.currentAdminProfile?.email || window.currentAdminUser?.email || window.currentUserProfile?.email || 'Administrador WMS',
          created_by_name: window.currentAdminProfile?.full_name || window.currentUserProfile?.full_name || 'Administrador WMS',
          created_by_role: 'admin',
          created_from: 'Punto de Venta (POS) · Sucursal Ñuñoa'
        };
    const adminUser = posCreatorMeta.created_by_email || posCreatorMeta.created_by_name || 'Administrador WMS';

    // 1. OBTENER MERCHANT_ID PARA VINCULAR EN ORDERS
    let merchantId = null;
    try {
      const { data: prof } = await supabase
        .from('profiles')
        .select('merchant_id')
        .ilike('comercio', `%${commerce}%`)
        .limit(1)
        .maybeSingle();
      if (prof) merchantId = prof.merchant_id;
    } catch (e) {
      console.warn('No se pudo obtener merchant_id:', e);
    }

    // 2. CREAR PEDIDO EN EL GESTOR (orders)
    const skusString = itemsPayload.map(i => i.sku).filter(Boolean).join(', ');
    const namesString = itemsPayload.map(i => `${i.cantidad}x ${i.producto}`).join(', ');
    const effectiveOrderPeriod = (selectedAbonoPeriodVal && selectedAbonoPeriodVal !== 'SIN_ABONO')
      ? selectedAbonoPeriodVal
      : window.derivePosPeriodFromDate(new Date());

    const orderPayload = {
      merchant_id: merchantId,
      comercio: commerce,
      status: 'despachado',
      estado_wms: 'Despachado',
      customer_name: customerName,
      customer_email: customerEmail || null,
      customer_phone: customerPhone || null,
      shipping_address: `${SUCURSAL_NUNOA_ADDRESS} (Venta Presencial)`,
      shipping_city: 'Ñuñoa',
      shipping_method: 'Venta Presencial Sucursal Ñuñoa',
      operador: 'SUCURSAL ÑUÑOA',
      courier: 'STOCKA',
      origen: 'Punto de Venta',
      external_platform: 'Punto de Venta',
      external_order_number: codigoVenta,
      cantidad: totalUnits,
      sku: skusString || 'POS-SKU',
      item: namesString || 'Venta POS',
      total_value: totalAmount,
      sucursal_pickeo: SUCURSAL_NUNOA_NAME,
      agenda: 'POS',
      periodo_facturacion: effectiveOrderPeriod,
      raw_shopify_data: {
        is_pos_sale: true,
        pos_sale_code: codigoVenta,
        payment_method: modoPago,
        document_type: docTipo,
        recorded_by: adminUser,
        ...posCreatorMeta,
        pos_abono_period: selectedAbonoPeriodVal,
        pos_tx_code: txCodeVal || null,
        pos_financials: {
          monto_total: previewFin.montoTotal,
          fee_pct: previewFin.feePct,
          commission_net: previewFin.commissionNet,
          commission_iva: previewFin.commissionIva,
          commission_total: previewFin.commissionTotal,
          seller_payout: previewFin.sellerPayout,
          applies_stocka_settlement: previewFin.appliesStockaPosSettlement
        },
        pos_machine: (modoPago.includes('Tarjeta') || modoPago.includes('Débito') || modoPago.includes('Crédito'))
          ? (window.posSelectedCommerceConfig?.onboarding_checklist?.pos_machine || { brand: 'STOCKA POS', owner: 'STOCKA' })
          : null
      }
    };

    let insertedOrder = null;
    let lastOrderErr = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: ordData, error: ordErr } = await supabase
        .from('orders')
        .insert([orderPayload])
        .select()
        .single();

      if (!ordErr && ordData) {
        insertedOrder = ordData;
        lastOrderErr = null;
        break;
      }

      lastOrderErr = ordErr;
      const errMsg = String(ordErr?.message || '');
      if (ordErr?.code === '23505' || errMsg.includes('unique_orders_comercio_clean_number')) {
        const prefixPart = (codigoVenta && codigoVenta.includes('-')) ? codigoVenta.split('-')[0] : 'POS';
        codigoVenta = window.generatePosSaleCode(prefixPart);
        orderPayload.external_order_number = codigoVenta;
        if (orderPayload.raw_shopify_data) {
          orderPayload.raw_shopify_data.pos_sale_code = codigoVenta;
        }
        const codeInputEl = document.getElementById('pos-codigo-venta');
        if (codeInputEl) codeInputEl.value = codigoVenta;
        continue;
      }
      break;
    }

    if (lastOrderErr) throw lastOrderErr;

    // 3. CREAR ORDER_ITEMS
    const orderItemsPayload = [];
    for (const item of itemsPayload) {
      orderItemsPayload.push({
        order_id: insertedOrder.id,
        product_id: item.product_id,
        warehouse_id: SUCURSAL_NUNOA_WH_ID,
        quantity: item.cantidad
      });
    }

    if (orderItemsPayload.length > 0) {
      try {
        await supabase.from('order_items').insert(orderItemsPayload);
      } catch (oiErr) {
        console.warn('Aviso insertando order_items:', oiErr);
      }
    }

    // 4. INSERTAR VENTA EN STORE_SALES
    // Obtener siguiente ID disponible para store_sales si la secuencia no tiene default en BD
    let nextSaleId = null;
    try {
      const { data: maxRow } = await supabase
        .from('store_sales')
        .select('id')
        .order('id', { ascending: false })
        .limit(1);
      if (maxRow && maxRow.length > 0 && maxRow[0].id) {
        nextSaleId = parseInt(maxRow[0].id, 10) + 1;
      }
    } catch (e) {
      console.warn('Aviso calculando nextSaleId para store_sales:', e);
    }

    const assignedMachine = window.posSelectedCommerceConfig?.onboarding_checklist?.pos_machine;
    const isCard = modoPago.includes('Tarjeta') || modoPago.includes('Débito') || modoPago.includes('Crédito');
    const terminalTagStr = isCard
      ? ((assignedMachine?.brand || 'STOCKA') + (assignedMachine?.model ? ' ' + assignedMachine.model : ''))
      : null;

    const fullCommentsWithTags = window.buildPosSaleCommentsWithTags(comments, '', {
      orderId: insertedOrder.id,
      terminalLabel: terminalTagStr,
      abonoPeriod: selectedAbonoPeriodVal,
      txCode: txCodeVal
    });

    const salePayload = {
      ...(nextSaleId ? { id: nextSaleId } : {}),
      codigo_venta: codigoVenta,
      comercio: commerce,
      nombre_cliente: customerName,
      correo_cliente: customerEmail || null,
      telefono_cliente: customerPhone || null,
      productos: JSON.stringify(itemsPayload),
      monto_total: totalAmount,
      modo_pago: modoPago,
      documento_tipo: docTipo,
      rut_facturacion: docTipo === 'FACTURA' ? fRut : null,
      giro_facturacion: docTipo === 'FACTURA' ? fGiro : null,
      razon_social_facturacion: docTipo === 'FACTURA' ? fRazon : null,
      direccion_facturacion: docTipo === 'FACTURA' ? fDireccion : null,
      comentarios: fullCommentsWithTags,
      sucursal: 'Ñuñoa',
      creado_por: adminUser
    };

    // Intentar insertar con wms_order_id si la columna existe
    let insertedSale = null;
    try {
      const saleWithOrd = { ...salePayload, wms_order_id: insertedOrder.id, warehouse_id: SUCURSAL_NUNOA_WH_ID };
      const { data: sData, error: sErr } = await supabase.from('store_sales').insert([saleWithOrd]).select().single();
      if (sErr) throw sErr;
      insertedSale = sData;
    } catch (_) {
      // Fallback sin columnas nuevas si la migración aún no se ejecuta
      const { data: fallbackData, error: fallbackErr } = await supabase.from('store_sales').insert([salePayload]).select().single();
      if (fallbackErr) throw fallbackErr;
      insertedSale = fallbackData;
    }

    // 5. DESCUENTO DE STOCK Y MOVIMIENTOS (Si tiene seguimiento activo)
    const hasStockTracking = Boolean(window.posSelectedCommerceConfig?.inventario_seguimiento);
    if (hasStockTracking) {
      console.log(`📦 Descontando inventario en ${SUCURSAL_NUNOA_NAME} para ${commerce}...`);

      for (const item of itemsPayload) {
        if (item.product_id) {
          try {
            // A. Consultar inventario actual en Ñuñoa
            const { data: invRecord } = await supabase
              .from('inventory')
              .select('id, quantity')
              .eq('product_id', item.product_id)
              .eq('warehouse_id', SUCURSAL_NUNOA_WH_ID)
              .maybeSingle();

            if (invRecord) {
              const newQty = Math.max(0, (invRecord.quantity || 0) - item.cantidad);
              await supabase
                .from('inventory')
                .update({ quantity: newQty })
                .eq('id', invRecord.id);
            } else {
              await supabase
                .from('inventory')
                .insert([{
                  product_id: item.product_id,
                  warehouse_id: SUCURSAL_NUNOA_WH_ID,
                  quantity: 0
                }]);
            }

            // B. Registrar movimiento de salida en movements
            await supabase
              .from('movements')
              .insert([{
                product_id: item.product_id,
                warehouse_id: SUCURSAL_NUNOA_WH_ID,
                type: 'out',
                quantity: item.cantidad,
                reference_doc: `Venta POS Ñuñoa [${codigoVenta}]`,
                order_id: insertedOrder.id
              }]);

          } catch (invErr) {
            console.error(`Error actualizando stock para SKU ${item.sku}:`, invErr);
          }
        }
      }
    }

    // 6. SINCRONIZACIÓN ASÍNCRONA SEGURA CON PICKER (punto_ventas)
    Promise.resolve().then(async () => {
      try {
        const pickerClient = window.supabasePicker || null;
        if (pickerClient) {
          await pickerClient.from('punto_ventas').upsert([salePayload]);
        }
      } catch (pickSyncErr) {
        console.warn('Aviso sincronizando venta con Picker auxiliar:', pickSyncErr);
      }
    });

    // 7. MENSAJE DE ÉXITO Y ACCIONES
    document.getElementById('modal-pos-sale')?.classList.remove('active');

    Swal.fire({
      title: '¡Venta Registrada Exitosamente!',
      html: `
        <div style="text-align: center; line-height: 1.6; margin-top: 0.5rem;">
          <p style="font-size: 1.1rem; margin-bottom: 0.5rem;">
            Código de Venta: <strong style="font-family: monospace; color: var(--color-primary);">${escapeHtml(codigoVenta)}</strong>
          </p>
          <p style="color: #10b981; font-weight: 700; font-size: 1.3rem; margin-bottom: 0.75rem;">
            ${formatCLP(totalAmount)}
          </p>
          <div style="background: var(--color-bg); padding: 0.75rem; border-radius: var(--radius-md); font-size: 0.85rem; text-align: left; margin-bottom: 1rem; border: 1px solid var(--color-border);">
            <div><strong>Pedido WMS:</strong> Generado con estado <em>Despachado</em>.</div>
            <div><strong>Inventario:</strong> ${hasStockTracking ? 'Stock descontado en Sucursal Ñuñoa.' : 'Sin seguimiento de stock físico.'}</div>
            <div><strong>Portal Cliente:</strong> Disponible en tiempo real para el comercio.</div>
          </div>
        </div>
      `,
      icon: 'success',
      showCancelButton: true,
      confirmButtonText: '<i class="ri-printer-line"></i> Imprimir Comprobante',
      cancelButtonText: 'Cerrar',
      confirmButtonColor: 'var(--color-primary)',
      cancelButtonColor: '#6b7280'
    }).then(res => {
      if (res.isConfirmed && insertedSale) {
        window.printPosTicket(insertedSale);
      }
    });

    // Refrescar tabla y KPIs
    await fetchAndRenderPosData();

  } catch (err) {
    console.error('Error registrando venta POS:', err);
    Swal.fire({
      title: 'Error al Registrar Venta',
      text: err.message || 'Ocurrió un problema inesperado al guardar la venta.',
      icon: 'error',
      confirmButtonText: 'Entendido',
      confirmButtonColor: 'var(--color-danger)'
    });
  } finally {
    btnSave.disabled = false;
    btnSave.innerHTML = 'Confirmar y Registrar Venta <i class="ri-check-line"></i>';
  }
};

// ====== 7. MODAL DE DETALLE DE VENTA ======

window.openPosSaleDetail = function(idOrData) {
  try {
    let data = null;
    if (typeof idOrData === 'object' && idOrData !== null) {
      data = idOrData;
    } else if (window.posSalesCache && window.posSalesCache.has(String(idOrData))) {
      data = window.posSalesCache.get(String(idOrData));
    } else {
      try {
        data = JSON.parse(decodeURIComponent(idOrData));
      } catch (e) {
        console.warn('Aviso parseando detalle de venta:', e);
      }
    }

    if (!data) {
      console.error('No se encontraron datos para la venta:', idOrData);
      return;
    }

    const modal = document.getElementById('modal-pos-detail');
    const container = document.getElementById('pos-detail-content');
    if (!modal || !container) return;

    // Parsear ítems
    let items = [];
    if (data.productos) {
      try {
        let p = data.productos;
        if (typeof p === 'string') p = JSON.parse(p);
        if (Array.isArray(p)) items = p;
      } catch (e) {}
    }

    let itemsTableHtml = `
      <table class="data-table" style="font-size: 0.85rem; width: 100%;">
        <thead>
          <tr>
            <th style="width: 15%; text-align: center;">Cantidad</th>
            <th style="width: 45%;">Producto</th>
            <th style="width: 20%; text-align: right;">Precio Unit.</th>
            <th style="width: 20%; text-align: right;">Subtotal</th>
          </tr>
        </thead>
        <tbody>
    `;

    if (items.length === 0) {
      itemsTableHtml += `<tr><td colspan="4" class="text-center text-muted" style="padding: 1rem;">Sin detalle de productos</td></tr>`;
    } else {
      items.forEach(i => {
        const qty = parseInt(i.cantidad, 10) || 1;
        const price = parseInt(i.precio, 10) || 0;
        const subtotal = i.subtotal !== undefined ? i.subtotal : (qty * price);
        itemsTableHtml += `
          <tr>
            <td style="text-align: center; font-weight: 700;">${qty}x</td>
            <td>
              <div style="display: flex; align-items: center; gap: 0.65rem;">
                ${i.image_url ? `
                  <img src="${escapeHtml(i.image_url)}" alt="" style="width: 36px; height: 36px; object-fit: cover; border-radius: 4px; border: 1px solid var(--color-border); flex-shrink: 0; cursor: pointer;" onclick="window.openPosImageLightbox('${escapeHtml(i.image_url)}', '${escapeHtml(i.producto || i.name || '')}')" onerror="this.style.display='none'">
                ` : ''}
                <div>
                  <strong style="color: var(--color-text-main);">${escapeHtml(i.producto || i.name || 'N/A')}</strong>
                  ${i.sku ? `<div style="font-family: monospace; font-size: 0.75rem; color: var(--color-text-muted);">SKU: ${escapeHtml(i.sku)}</div>` : ''}
                </div>
              </div>
            </td>
            <td style="text-align: right;">${formatCLP(price)}</td>
            <td style="text-align: right; font-weight: 700; color: #10b981;">${formatCLP(subtotal)}</td>
          </tr>
        `;
      });
    }
    itemsTableHtml += `</tbody></table>`;

    // Datos de Facturación
    let factHtml = '';
    if (data.documento_tipo === 'FACTURA') {
      factHtml = `
        <div style="background: rgba(139, 92, 246, 0.05); border: 1px solid rgba(139, 92, 246, 0.25); padding: 1.25rem; border-radius: var(--radius-md); margin-top: 1rem;">
          <h4 style="margin: 0 0 0.75rem 0; color: #7c3aed; font-size: 0.9rem; display: flex; align-items: center; gap: 0.35rem;">
            <i class="ri-file-paper-2-line"></i> Datos Fiscales de Facturación
          </h4>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem; font-size: 0.85rem;">
            <div><span style="color: var(--color-text-muted); font-size: 0.75rem; display: block;">RUT Empresa</span><strong style="color: var(--color-text-main);">${escapeHtml(data.rut_facturacion || '-')}</strong></div>
            <div><span style="color: var(--color-text-muted); font-size: 0.75rem; display: block;">Razón Social</span><strong style="color: var(--color-text-main);">${escapeHtml(data.razon_social_facturacion || '-')}</strong></div>
            <div><span style="color: var(--color-text-muted); font-size: 0.75rem; display: block;">Giro Comercial</span><strong style="color: var(--color-text-main);">${escapeHtml(data.giro_facturacion || '-')}</strong></div>
            <div style="grid-column: 1 / -1;"><span style="color: var(--color-text-muted); font-size: 0.75rem; display: block;">Dirección Fiscal</span><strong style="color: var(--color-text-main);">${escapeHtml(data.direccion_facturacion || '-')}</strong></div>
          </div>
        </div>
      `;
    }

    const d = new Date(data.created_at);
    const dateStr = d.toLocaleDateString('es-CL') + ' ' + d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

    // Resolver Máquina POS, Comisiones (+IVA), Periodo de Abono y Código de Transacción
    const linkedOrder = (window.posLinkedOrdersBySaleCodeMap && data.codigo_venta && window.posLinkedOrdersBySaleCodeMap.get(String(data.codigo_venta).trim().toUpperCase())) || (window.posLinkedOrdersMap && data.codigo_venta && window.posLinkedOrdersMap.get(String(data.codigo_venta))) || null;
    const machineInfo = data._posMachineInfo || window.resolvePosSaleMachineInfo(data, window.loadedCommerceConfigsMap, linkedOrder);
    const fin = data._posFinancials || window.calculatePosSaleFinancials(data, machineInfo, window.posCachedPricingConfig);
    const abonoInfo = data._posAbonoInfo || window.resolvePosSaleAbonoPeriod(data, linkedOrder, machineInfo, fin);
    const txCodeDetail = window.resolvePosSaleTransactionCode(data, linkedOrder);
    const cleanObs = window.cleanPosSaleComments(data.comentarios);
    const availablePeriods = window.getAvailablePosBillingPeriodNames([abonoInfo.period !== 'SIN_ABONO' ? abonoInfo.period : null]);

    const dotColor = window.resolvePosMachineColor(machineInfo.color, machineInfo.colorHex);
    const readableColor = window.getPosReadableTextColor(dotColor);

    const posSettlementDetailHtml = `
      <div style="background: linear-gradient(135deg, ${fin.appliesStockaPosSettlement ? 'rgba(16, 185, 129, 0.06)' : 'rgba(100, 116, 139, 0.05)'} 0%, #ffffff 100%); border: 1.5px solid ${fin.appliesStockaPosSettlement ? 'rgba(16, 185, 129, 0.35)' : 'rgba(100, 116, 139, 0.25)'}; border-radius: var(--radius-md); padding: 1rem 1.15rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.85rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.55rem;">
          <h4 style="margin: 0; font-size: 0.88rem; color: #0f172a; font-weight: 800; display: flex; align-items: center; gap: 0.45rem;">
            <i class="ri-scales-3-line" style="color: ${fin.appliesStockaPosSettlement ? '#059669' : '#64748b'}; font-size: 1.05rem;"></i>
            Máquina de Pago, Comisiones POS y Liquidación / Abono Fulfillment
          </h4>
          <button type="button" class="btn btn-sm btn-outline" onclick="document.getElementById('modal-pos-detail')?.classList.remove('active'); window.openPosCommerceInBillingManager('${escapeHtml(data.comercio || '')}', '${escapeHtml(abonoInfo.period !== 'SIN_ABONO' ? abonoInfo.period : '')}');" style="font-size: 0.74rem; padding: 0.25rem 0.65rem; border-color: rgba(16, 185, 129, 0.4); color: #047857; font-weight: 700;">
            <i class="ri-file-list-3-line"></i> Ver en Gestor de Facturación
          </button>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(175px, 1fr)); gap: 0.75rem;">
          <div style="background: #ffffff; border: 1px solid var(--color-border); border-left: 3.5px solid ${readableColor}; border-radius: 8px; padding: 0.65rem 0.8rem;">
            <span style="font-size: 0.68rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700; display: block;">Máquina de Pago Utilizada</span>
            <div style="display: flex; align-items: center; gap: 0.4rem; margin-top: 0.25rem;">
              ${machineInfo.isCardSale ? window.getPosMachineSvg(dotColor, 20) : `<i class="ri-bank-card-line" style="color:${dotColor};font-size:1.1rem;"></i>`}
              <strong style="font-size: 0.9rem; color: #0f172a;">${escapeHtml(machineInfo.brand)}${machineInfo.model ? ' #' + escapeHtml(machineInfo.model) : ''}</strong>
            </div>
            <span style="display: inline-block; margin-top: 0.25rem; font-size: 0.68rem; font-weight: 800; padding: 0.1rem 0.45rem; border-radius: 4px; background: ${machineInfo.isStockaOwned ? 'rgba(37, 99, 235, 0.1)' : 'rgba(124, 58, 237, 0.1)'}; color: ${machineInfo.isStockaOwned ? '#1d4ed8' : '#6d28d9'};">
              ${machineInfo.isCardSale ? (machineInfo.isStockaOwned ? 'Propiedad de STOCKA' : 'Propiedad de ' + escapeHtml(machineInfo.owner)) : escapeHtml(machineInfo.owner)}
            </span>
          </div>

          <div style="background: #ffffff; border: 1px solid var(--color-border); border-left: 3.5px solid #dc2626; border-radius: 8px; padding: 0.65rem 0.8rem;">
            <span style="font-size: 0.68rem; text-transform: uppercase; color: var(--color-text-muted); font-weight: 700; display: block;">Comisión POS (${fin.appliesStockaPosSettlement ? fin.feePct.toFixed(2) + '% + IVA' : '0%'})</span>
            <strong style="font-size: 1.05rem; color: ${fin.appliesStockaPosSettlement ? '#dc2626' : '#64748b'}; display: block; margin-top: 0.2rem;">
              ${fin.appliesStockaPosSettlement ? '-' + formatCLP(fin.commissionTotal) : '$0'}
            </strong>
            <span style="font-size: 0.7rem; color: var(--color-text-muted);">
              ${fin.appliesStockaPosSettlement ? `Neto: ${formatCLP(fin.commissionNet)} + IVA: ${formatCLP(fin.commissionIva)}` : escapeHtml(fin.reasonLabel)}
            </span>
          </div>

          <div style="background: ${fin.appliesStockaPosSettlement ? 'rgba(16, 185, 129, 0.08)' : '#ffffff'}; border: 1px solid ${fin.appliesStockaPosSettlement ? 'rgba(16, 185, 129, 0.35)' : 'var(--color-border)'}; border-left: 3.5px solid #10b981; border-radius: 8px; padding: 0.65rem 0.8rem;">
            <span style="font-size: 0.68rem; text-transform: uppercase; color: #047857; font-weight: 800; display: block;">Pago al Seller / Abono Fulfillment</span>
            <strong style="font-size: 1.15rem; color: #059669; font-weight: 900; display: block; margin-top: 0.15rem;">
              ${formatCLP(fin.sellerPayout)}
            </strong>
            <span style="font-size: 0.69rem; color: #047857; font-weight: 600;">
              ${fin.appliesStockaPosSettlement ? 'Monto neto recaudado por Stocka' : 'Recaudado directo por Seller'}
            </span>
          </div>

          <div style="background: #ffffff; border: 1px solid var(--color-border); border-left: 3.5px solid #4f46e5; border-radius: 8px; padding: 0.65rem 0.8rem;">
            <span style="font-size: 0.68rem; text-transform: uppercase; color: #4f46e5; font-weight: 800; display: block; margin-bottom: 0.25rem;">Periodo Facturación (Abono)</span>
            <select class="form-control" style="padding: 0.28rem 0.45rem; font-size: 0.76rem; font-weight: 800; height: auto;" onchange="window.updatePosSaleAbonoPeriod('${escapeHtml(String(data.id))}', this.value)">
              ${availablePeriods.map(p => `<option value="${escapeHtml(p)}" ${abonoInfo.period === p ? 'selected' : ''}>📅 Abono: ${escapeHtml(p)}</option>`).join('')}
              <option value="PAGO_DIRECTO" ${!abonoInfo.isAbono || abonoInfo.period === 'PAGO_DIRECTO' ? 'selected' : ''}>💸 Pago Directo Seller</option>
              <option value="SIN_ASIGNAR" ${abonoInfo.period === 'SIN_ASIGNAR' ? 'selected' : ''}>⏳ Sin Asignar</option>
            </select>
            <div style="margin-top: 0.45rem;">
              <span style="font-size: 0.66rem; text-transform: uppercase; color: #0284c7; font-weight: 800; display: block; margin-bottom: 0.2rem;">Código de Transacción (Único)</span>
              <div style="display: flex; align-items: center; gap: 4px;">
                <input
                  type="text"
                  id="pos-detail-tx-input-${escapeHtml(String(data.id))}"
                  value="${escapeHtml(txCodeDetail)}"
                  placeholder="Sin espacios..."
                  autocomplete="off"
                  oninput="this.value = this.value.replace(/\\s+/g, '').toUpperCase();"
                  onkeydown="if(event.key === 'Enter'){ event.preventDefault(); window.saveInlinePosTxCode('${escapeHtml(String(data.id))}', 'pos-detail-tx-input-${escapeHtml(String(data.id))}'); }"
                  style="flex: 1; height: 28px; padding: 0 8px; font-family: monospace; font-size: 0.76rem; font-weight: 800; border-radius: 5px; border: 1px solid ${txCodeDetail ? 'rgba(2, 132, 199, 0.45)' : 'var(--color-border)'}; background: ${txCodeDetail ? 'rgba(2, 132, 199, 0.08)' : '#ffffff'}; color: ${txCodeDetail ? '#0369a1' : '#0f172a'};"
                >
                <button type="button" onclick="window.saveInlinePosTxCode('${escapeHtml(String(data.id))}', 'pos-detail-tx-input-${escapeHtml(String(data.id))}')" style="height: 28px; padding: 0 8px; border-radius: 5px; border: 1px solid rgba(2, 132, 199, 0.4); background: rgba(2, 132, 199, 0.12); color: #0284c7; font-size: 0.74rem; font-weight: 700; cursor: pointer;">
                  <i class="ri-save-3-line"></i> Guardar
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        
        <!-- Header con Totales -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; background: var(--color-surface-hover); padding: 1.25rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
          <div>
            <span style="font-size: 0.75rem; text-transform: uppercase; color: var(--color-text-muted); letter-spacing: 0.5px; display: block; margin-bottom: 0.25rem;">Código de Venta</span>
            <span style="font-family: monospace; font-size: 1.35rem; font-weight: 800; color: var(--color-primary);">${escapeHtml(data.codigo_venta || '-')}</span>
            <div style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.25rem;">
              <i class="ri-calendar-line"></i> ${dateStr}
            </div>
          </div>
          <div style="text-align: right;">
            <span style="font-size: 0.75rem; text-transform: uppercase; color: var(--color-text-muted); letter-spacing: 0.5px; display: block; margin-bottom: 0.25rem;">Total Pagado (Bruto)</span>
            <span style="font-size: 1.6rem; font-weight: 800; color: #10b981;">${formatCLP(data.monto_total)}</span>
            <div style="font-size: 0.85rem; font-weight: 600; color: var(--color-text-main); margin-top: 0.35rem; display: flex; align-items: center; justify-content: flex-end; gap: 0.4rem; flex-wrap: wrap;">
              <select class="form-input" onchange="window.updatePosSalePaymentMethod('${escapeHtml(String(data.id))}', this.value, { fromDetailModal: true })" style="height: 28px; padding: 0 0.5rem; font-size: 0.78rem; font-weight: 700; width: auto;">
                ${['Tarjeta de Débito', 'Tarjeta de Crédito', 'Efectivo', 'Transferencia'].map(m => `<option value="${escapeHtml(m)}" ${data.modo_pago === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
              </select>
              <small class="text-muted">(${data.documento_tipo || 'BOLETA'})</small>
            </div>
          </div>
        </div>

        ${posSettlementDetailHtml}

        <!-- Origen y Destinatario -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
          <div style="background: var(--color-surface); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
            <h4 style="margin: 0 0 0.5rem 0; font-size: 0.85rem; color: var(--color-text-muted); border-bottom: 1px solid var(--color-border); padding-bottom: 0.35rem;">
              <i class="ri-store-2-line"></i> Origen y Vendedor
            </h4>
            <div style="display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.85rem; margin-top: 0.5rem;">
              <div><span style="color: var(--color-text-muted); font-size: 0.75rem; display: block;">Comercio</span><strong>${escapeHtml(data.comercio || '-')}</strong></div>
              <div><span style="color: var(--color-text-muted); font-size: 0.75rem; display: block;">Sucursal Física</span><strong>${escapeHtml(data.sucursal || SUCURSAL_NUNOA_NAME)}</strong></div>
              <div><span style="color: var(--color-text-muted); font-size: 0.75rem; display: block;">Registrado Por</span><span style="color: var(--color-primary); font-weight: 500;">${escapeHtml(data.creado_por || '-')}</span></div>
            </div>
          </div>

          <div style="background: var(--color-surface); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
            <h4 style="margin: 0 0 0.5rem 0; font-size: 0.85rem; color: var(--color-text-muted); border-bottom: 1px solid var(--color-border); padding-bottom: 0.35rem;">
              <i class="ri-user-smile-line"></i> Cliente Final
            </h4>
            <div style="display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.85rem; margin-top: 0.5rem;">
              <div><span style="color: var(--color-text-muted); font-size: 0.75rem; display: block;">Nombre Completo</span><strong>${escapeHtml(data.nombre_cliente || 'Consumidor Final')}</strong></div>
              <div><span style="color: var(--color-text-muted); font-size: 0.75rem; display: block;">Correo Electrónico</span><span>${escapeHtml(data.correo_cliente || 'Sin correo')}</span></div>
              <div><span style="color: var(--color-text-muted); font-size: 0.75rem; display: block;">Teléfono</span><span>${escapeHtml(data.telefono_cliente || 'Sin teléfono')}</span></div>
            </div>
          </div>
        </div>

        ${factHtml}

        <!-- Tabla de Productos -->
        <div style="background: var(--color-surface); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
          <h4 style="margin: 0 0 0.5rem 0; font-size: 0.85rem; color: var(--color-text-muted); border-bottom: 1px solid var(--color-border); padding-bottom: 0.35rem;">
            <i class="ri-shopping-cart-2-line"></i> Productos Vendidos
          </h4>
          <div style="margin-top: 0.5rem;">
            ${itemsTableHtml}
          </div>
        </div>

        <!-- Comentarios y Enlace al Gestor -->
        ${cleanObs ? `
          <div style="background: rgba(245, 158, 11, 0.05); border: 1px solid rgba(245, 158, 11, 0.2); padding: 0.85rem 1rem; border-radius: var(--radius-md); font-size: 0.85rem;">
            <strong style="color: #d97706; display: block; margin-bottom: 0.25rem;"><i class="ri-message-3-line"></i> Observaciones / Voucher:</strong>
            ${escapeHtml(cleanObs)}
          </div>
        ` : ''}

      </div>
    `;

    // Botón de imprimir comprobante en el modal
    const printBtn = document.getElementById('btn-pos-print-ticket');
    if (printBtn) {
      printBtn.onclick = () => window.printPosTicket(data);
    }

    modal.classList.add('active');

  } catch (e) {
    console.error('Error abriendo detalle de venta POS:', e);
    alert('No se pudo abrir el detalle de la venta.');
  }
};

// ====== 8. IMPRESIÓN DE TICKET TÉRMICO (80MM) ======

window.printPosTicket = function(idOrData) {
  try {
    let data = null;
    if (typeof idOrData === 'object' && idOrData !== null) {
      data = idOrData;
    } else if (window.posSalesCache && window.posSalesCache.has(String(idOrData))) {
      data = window.posSalesCache.get(String(idOrData));
    } else {
      try {
        data = typeof idOrData === 'string' ? JSON.parse(decodeURIComponent(idOrData)) : idOrData;
      } catch (e) {
        console.warn('Aviso parseando ticket POS:', e);
      }
    }

    if (!data) {
      console.error('No se encontraron datos para imprimir ticket:', idOrData);
      return;
    }

    const printWindow = window.open('', '_blank', 'width=450,height=650');
    if (!printWindow) {
      alert('Por favor habilita las ventanas emergentes en tu navegador para imprimir.');
      return;
    }

    let items = [];
    if (data.productos) {
      try {
        let p = data.productos;
        if (typeof p === 'string') p = JSON.parse(p);
        if (Array.isArray(p)) items = p;
      } catch (e) {}
    }

    const d = new Date(data.created_at || new Date());
    const dateStr = d.toLocaleDateString('es-CL') + ' ' + d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

    let itemsRows = '';
    items.forEach(i => {
      const qty = parseInt(i.cantidad, 10) || 1;
      const price = parseInt(i.precio, 10) || 0;
      const subtotal = i.subtotal !== undefined ? i.subtotal : (qty * price);
      itemsRows += `
        <tr>
          <td style="padding: 4px 0; vertical-align: top;">${qty}x</td>
          <td style="padding: 4px 0; vertical-align: top;">
            ${escapeHtml(i.producto || i.name || 'Ítem')}
            ${i.sku ? `<br><small style="font-size: 9px; color: #555;">SKU: ${escapeHtml(i.sku)}</small>` : ''}
          </td>
          <td style="padding: 4px 0; text-align: right; vertical-align: top;">${formatCLP(subtotal)}</td>
        </tr>
      `;
    });

    const ticketHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Comprobante Venta ${escapeHtml(data.codigo_venta || '')}</title>
        <style>
          @page { size: 80mm auto; margin: 0; }
          body {
            font-family: 'Courier New', Courier, monospace;
            font-size: 11px;
            color: #000;
            background: #fff;
            margin: 0;
            padding: 12px;
            width: 76mm;
            box-sizing: border-box;
          }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .bold { font-weight: bold; }
          hr { border: 0; border-top: 1px dashed #000; margin: 8px 0; }
          table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
          .logo { max-width: 140px; height: auto; margin-bottom: 4px; }
        </style>
      </head>
      <body>
        <div class="text-center">
          <h2 style="margin: 0 0 2px 0; font-size: 16px; font-weight: 800;">STOCKA CHILE</h2>
          <p style="margin: 0; font-size: 10px;">Sucursal Física Ñuñoa</p>
          <p style="margin: 0; font-size: 9px; color: #444;">${SUCURSAL_NUNOA_ADDRESS}</p>
          <p style="margin: 2px 0 0 0; font-size: 10px; font-weight: bold;">COMERCIO: ${escapeHtml(data.comercio || 'STOCKA')}</p>
        </div>

        <hr>

        <div>
          <div><strong>CÓDIGO:</strong> ${escapeHtml(data.codigo_venta || '-')}</div>
          <div><strong>FECHA:</strong> ${dateStr}</div>
          <div><strong>DOCUMENTO:</strong> ${data.documento_tipo || 'BOLETA'}</div>
          <div><strong>CLIENTE:</strong> ${escapeHtml(data.nombre_cliente || 'Consumidor Final')}</div>
          ${data.correo_cliente ? `<div><strong>EMAIL:</strong> ${escapeHtml(data.correo_cliente)}</div>` : ''}
          ${data.documento_tipo === 'FACTURA' ? `
            <div style="margin-top: 4px; font-size: 10px; border-top: 1px dotted #888; padding-top: 3px;">
              <div><strong>RUT:</strong> ${escapeHtml(data.rut_facturacion || '-')}</div>
              <div><strong>RAZÓN:</strong> ${escapeHtml(data.razon_social_facturacion || '-')}</div>
              <div><strong>GIRO:</strong> ${escapeHtml(data.giro_facturacion || '-')}</div>
            </div>
          ` : ''}
        </div>

        <hr>

        <table>
          <thead>
            <tr style="border-bottom: 1px solid #000;">
              <th style="text-align: left; width: 15%; padding-bottom: 3px;">Cant</th>
              <th style="text-align: left; width: 55%; padding-bottom: 3px;">Detalle</th>
              <th style="text-align: right; width: 30%; padding-bottom: 3px;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows}
          </tbody>
        </table>

        <hr>

        <div style="font-size: 12px;">
          <div style="display: flex; justify-content: space-between; font-weight: 800; font-size: 14px;">
            <span>TOTAL:</span>
            <span>${formatCLP(data.monto_total)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 10px; margin-top: 3px;">
            <span>Medio de Pago:</span>
            <span>${escapeHtml(data.modo_pago || 'Tarjeta')}</span>
          </div>
        </div>

        <hr>

        <div class="text-center" style="font-size: 9px; color: #555; line-height: 1.3;">
          <p style="margin: 0;">¡Gracias por tu compra en Stocka!</p>
          <p style="margin: 2px 0 0 0;">Atendido por: ${escapeHtml(data.creado_por || 'Mesón Ñuñoa')}</p>
          <p style="margin: 4px 0 0 0;">www.stocka.cl</p>
        </div>

        <script>
          window.onload = function() {
            window.print();
            setTimeout(function() { window.close(); }, 800);
          };
        </script>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(ticketHtml);
    printWindow.document.close();

  } catch (e) {
    console.error('Error al imprimir ticket térmico:', e);
    alert('No se pudo generar el ticket de impresión.');
  }
};

// ====== 9. EXPORTACIÓN DE DATOS (CSV Y EXCEL) ======

window.exportPosSales = async function(format) {
  try {
    await window.ensurePosMetadataLoaded();
    let query = supabase.from('store_sales').select('*').order('created_at', { ascending: false });
    query = buildPosSalesQuery(query);

    const { data, error } = await query;
    if (error) throw error;

    const filteredData = applyClientSidePosFilters(data || [], window.posLinkedOrdersBySaleCodeMap || new Map());

    if (!filteredData || filteredData.length === 0) {
      alert('No hay datos para exportar con los filtros seleccionados.');
      return;
    }

    const rows = filteredData.map(s => {
      const d = new Date(s.created_at);
      const dateStr = d.toLocaleDateString('es-CL') + ' ' + d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

      const linkedOrder = (window.posLinkedOrdersBySaleCodeMap && s.codigo_venta && window.posLinkedOrdersBySaleCodeMap.get(String(s.codigo_venta).trim().toUpperCase())) || null;
      const machineInfo = s._posMachineInfo || window.resolvePosSaleMachineInfo(s, window.loadedCommerceConfigsMap, linkedOrder);
      const fin = s._posFinancials || window.calculatePosSaleFinancials(s, machineInfo, window.posCachedPricingConfig);
      const abonoInfo = s._posAbonoInfo || window.resolvePosSaleAbonoPeriod(s, linkedOrder, machineInfo, fin);
      const txCodeExport = window.resolvePosSaleTransactionCode(s, linkedOrder);
      const cleanComments = window.cleanPosSaleComments(s.comentarios);

      let prodStr = '';
      if (s.productos) {
        try {
          let p = s.productos;
          if (typeof p === 'string') p = JSON.parse(p);
          if (Array.isArray(p)) {
            prodStr = p.map(item => `${item.cantidad || 1}x ${item.producto || item.name || 'N/A'}`).join(' || ');
          }
        } catch (e) {}
      }

      return {
        'Código Venta': s.codigo_venta,
        'Fecha Venta': dateStr,
        'Comercio': s.comercio,
        'Sucursal': s.sucursal || SUCURSAL_NUNOA_NAME,
        'Total Pagado Bruto ($)': fin.montoTotal,
        'Modo Pago': s.modo_pago,
        'Documento': s.documento_tipo,
        'Máquina POS': machineInfo.brand,
        'N° Terminal': machineInfo.model ? `#${machineInfo.model}` : '',
        'Color Máquina': machineInfo.color || '',
        'Propiedad Máquina': machineInfo.isCardSale ? (machineInfo.isStockaOwned ? 'Propiedad de STOCKA' : `Propiedad de ${machineInfo.owner}`) : machineInfo.owner,
        '% Comisión POS': fin.appliesStockaPosSettlement ? `${fin.feePct.toFixed(2)}%` : '0%',
        'Comisión Neta ($)': fin.commissionNet,
        'IVA Comisión ($)': fin.commissionIva,
        'Comisión Total + IVA ($)': fin.commissionTotal,
        'Pago al Seller / Abono Neto ($)': fin.sellerPayout,
        'Periodo Facturación (Abono)': abonoInfo.isAbono ? abonoInfo.period : 'SIN ABONO (Pago Directo Seller)',
        'Código Transacción': txCodeExport || '',
        'Cliente': s.nombre_cliente,
        'Email Cliente': s.correo_cliente,
        'Teléfono': s.telefono_cliente,
        'Productos': prodStr,
        'Vendedor': s.creado_por,
        'Comentarios': cleanComments,
        'RUT Factura': s.rut_facturacion || '',
        'Razón Social Factura': s.razon_social_facturacion || '',
        'Giro Factura': s.giro_facturacion || '',
        'Dirección Factura': s.direccion_facturacion || '',
        'ID Orden WMS': linkedOrder?.id || s.wms_order_id || ''
      };
    });

    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `ventas_sucursal_nunoa_${timestamp}`;

    if (format === 'csv') {
      const headers = Object.keys(rows[0]);
      const csvRows = rows.map(r => headers.map(h => `"${(r[h] || '').toString().replace(/"/g, '""')}"`).join(','));
      const csvContent = '\ufeff' + [headers.join(','), ...csvRows].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `${filename}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } else if (format === 'excel') {
      if (typeof XLSX === 'undefined') {
        alert('Librería SheetJS (XLSX) no disponible.');
        return;
      }
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Ventas POS Ñuñoa');
      XLSX.writeFile(workbook, `${filename}.xlsx`);
    }

  } catch (err) {
    console.error('Error al exportar ventas POS:', err);
    alert('Error al exportar: ' + err.message);
  }
};

window.renderPosAdmin = renderPosAdmin;

export { renderPosAdmin };
export default renderPosAdmin;
