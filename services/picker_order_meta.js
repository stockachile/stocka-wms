/**
 * Shared helper for building Picker metadata, tags, coverage, payment status,
 * platform logo, customer shipping method, and multi-source product image URLs.
 */

const ALPHA_COBERTURA_36 = new Set([
  'cerrillos', 'cerro navia', 'conchali', 'el bosque', 'estacion central',
  'huechuraba', 'independencia', 'la cisterna', 'la florida', 'la granja',
  'la pintana', 'la reina', 'las condes', 'lo barnechea', 'lo espejo',
  'lo prado', 'macul', 'maipu', 'nunoa', 'pedro aguirre cerda',
  'penalolen', 'providencia', 'pudahuel', 'puente alto', 'quilicura',
  'quinta normal', 'recoleta', 'renca', 'san bernardo', 'san joaquin',
  'san miguel', 'san ramon', 'santiago', 'vitacura', 'padre hurtado',
  'colina'
]);

const COMMON_COMUNA_ALIASES = {
  'santiago centro': 'santiago',
  'stgo': 'santiago',
  'stgo centro': 'santiago',
  'valpo': 'valparaiso',
  'vina': 'vina del mar',
  'vina del mar': 'vina del mar',
  'vina mar': 'vina del mar',
  'la calera': 'calera',
  'la serena centro': 'la serena',
  'san felipe centro': 'san felipe',
  'san bernardo centro': 'san bernardo',
  'puente alto centro': 'puente alto',
  'pto montt': 'puerto montt',
  'pto varas': 'puerto varas',
  'antofa': 'antofagasta',
  'rancagua centro': 'rancagua',
  'conce': 'concepcion',
  'talca centro': 'talca',
  'temuco centro': 'temuco',
  'llay llay': 'llaillay',
  'llayllay': 'llaillay',
  'til til': 'tiltil',
  'ohiggins': 'ohiggins',
  'padre las casas centro': 'padre las casas'
};

const CHILE_ALL_COMUNAS_SET = new Set([
  "algarrobo","alhue","alto biobio","alto del carmen","alto hospicio","ancud","andacollo","angol","antartica","antofagasta","antuco","arauco","arica","aysen","buin","bulnes","cabildo","cabo de hornos","cabrero","calama","calbuco","caldera","calera","calera de tango","calle larga","camarones","camina","canela","canete","carahue","cartagena","casablanca","castro","catemu","cauquenes","cerrillos","cerro navia","chaiten","chanaral","chanco","chepica","chiguayante","chile chico","chillan","chillan viejo","chimbarongo","cholchol","chonchi","cisnes","cobquecura","cochamo","cochrane","codegua","coelemu","coihueco","coinco","colbun","colchane","colina","collipulli","coltauco","combarbala","concepcion","conchali","concon","constitucion","contulmo","copiapo","coquimbo","coronel","corral","coyhaique","cunco","curacautin","curacavi","curaco de velez","curanilahue","curarrehue","curepto","curico","dalcahue","diego de almagro","donihue","el bosque","el carmen","el monte","el quisco","el tabo","empedrado","ercilla","estacion central","florida","freire","freirina","fresia","frutillar","futaleufu","futrono","galvarino","general lagos","gorbea","graneros","guaitecas","hijuelas","hualaihue","hualane","hualpen","hualqui","huara","huasco","huechuraba","illapel","independencia","iquique","isla de maipo","isla de pascua","juan fernandez","la cisterna","la cruz","la estrella","la florida","la granja","la higuera","la ligua","la pintana","la reina","la serena","la union","lago ranco","lago verde","laguna blanca","laja","lampa","lanco","las cabras","las condes","lautaro","lebu","licanten","limache","linares","litueche","llaillay","llanquihue","lo barnechea","lo espejo","lo prado","lolol","loncoche","longavi","lonquimay","los alamos","los andes","los angeles","los lagos","los muermos","los sauces","los vilos","lota","lumaco","machali","macul","mafil","maipu","malloa","marchihue","maria elena","maria pinto","mariquina","maule","maullin","mejillones","melipeuco","melipilla","molina","monte patria","mostazal","mulchen","nacimiento","nancagua","natales","navidad","negrete","ninhue","niquen","nogales","nueva imperial","nunoa","ohiggins","olivar","ollague","olmue","osorno","ovalle","padre hurtado","padre las casas","paiguano","paillaco","paine","palena","palmilla","panguipulli","panquehue","papudo","paredones","parral","pedro aguirre cerda","pelarco","pelluhue","pemuco","penaflor","penalolen","pencahue","penco","peralillo","perquenco","petorca","peumo","pica","pichidegua","pichilemu","pinto","pirque","pitrufquen","placilla","portezuelo","porvenir","pozo almonte","primavera","providencia","puchuncavi","pucon","pudahuel","puente alto","puerto montt","puerto octay","puerto varas","pumanque","punitaqui","punta arenas","puqueldon","puren","purranque","putaendo","putre","puyehue","queilen","quellon","quemchi","quilaco","quilicura","quilleco","quillon","quillota","quilpue","quinchao","quinta de tilcoco","quinta normal","quintero","quirihue","rancagua","ranquil","rauco","recoleta","renaico","renca","rengo","requinoa","retiro","rinconada","rio bueno","rio claro","rio hurtado","rio ibanez","rio negro","rio verde","romeral","saavedra","sagrada familia","salamanca","san antonio","san bernardo","san carlos","san clemente","san esteban","san fabian","san felipe","san fernando","san gregorio","san ignacio","san javier","san joaquin","san jose de maipo","san juan de la costa","san miguel","san nicolas","san pablo","san pedro","san pedro de atacama","san pedro de la paz","san rafael","san ramon","san rosendo","san vicente","santa barbara","santa cruz","santa juana","santa maria","santiago","santo domingo","sierra gorda","talagante","talca","talcahuano","taltal","temuco","teno","teodoro schmidt","tierra amarilla","tiltil","timaukel","tirua","tocopilla","tolten","tome","torres del paine","tortel","traiguen","treguaco","tucapel","valdivia","vallenar","valparaiso","vichuquen","victoria","vicuna","vilcun","villa alegre","villa alemana","villarrica","vina del mar","vitacura","yerbas buenas","yumbel","yungay","zapallar"
]);

function normalizeComunaKey(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveComunaAlias(str) {
  const norm = normalizeComunaKey(str);
  return COMMON_COMUNA_ALIASES[norm] || norm;
}

function resolveOrderPlatform(order) {
  if (!order) {
    return { platform: 'Manual', platformLogo: 'img/stocka.cap.png' };
  }
  const raw = String(order.external_platform || order.origen || '').trim();
  const low = raw.toLowerCase();
  const extNo = String(order.external_order_number || '').trim().toUpperCase();
  const rawShop = order.raw_shopify_data || {};

  if (rawShop.is_reverse_logistics === true || extNo.startsWith('LI-') || low.includes('inversa')) {
    return { platform: 'Logística Inversa', platformLogo: 'img/stocka.cap.png' };
  }
  if (rawShop.is_pos_sale === true || extNo.startsWith('POS-') || extNo.startsWith('VTA-') || low === 'punto de venta' || low === 'pos' || low.includes('shop point')) {
    return { platform: 'Punto de Venta', platformLogo: 'img/stocka.cap.png' };
  }
  if (rawShop.manual_order === true || low === 'manual' || low === 'stocka' || low === 'wms') {
    return { platform: 'Manual', platformLogo: 'img/stocka.cap.png' };
  }
  if (low.includes('meli') || low.includes('mercado') || order.raw_meli_data) {
    return { platform: 'MercadoLibre', platformLogo: 'img/mercadolibre.png' };
  }
  if (low.includes('falabella') || order.raw_falabella_data) {
    return { platform: 'Falabella', platformLogo: 'img/falabella.png' };
  }
  if (low.includes('paris') || low.includes('parís') || order.raw_paris_data) {
    return { platform: 'Paris', platformLogo: 'img/paris.png' };
  }
  if (low.includes('walmart') || order.raw_walmart_data) {
    return { platform: 'Walmart', platformLogo: 'img/walmart.png' };
  }
  if (low.includes('ripley') || order.raw_ripley_data) {
    return { platform: 'Ripley', platformLogo: 'img/ripley.png' };
  }
  if (low.includes('woo') || order.raw_woocommerce_data) {
    return { platform: 'WooCommerce', platformLogo: 'img/woocommerce.png' };
  }
  if (low.includes('tiendanube') || low.includes('tienda nube') || order.raw_tiendanube_data) {
    return { platform: 'Tiendanube', platformLogo: 'img/tiendanube.png' };
  }
  if (low.includes('jumpseller') || order.raw_jumpseller_data) {
    return { platform: 'Jumpseller', platformLogo: 'img/jumpseller.png' };
  }
  if (low.includes('shopify') || order.raw_shopify_data) {
    return { platform: 'Shopify', platformLogo: 'img/shopify.png' };
  }
  const opAgendaProbe = `${order.operador || ''} ${order.agenda || ''}`.toUpperCase();
  if (/^2000\d{10,}$/.test(extNo) || opAgendaProbe.includes('MELI') || opAgendaProbe.includes('MERCADOLIBRE') || opAgendaProbe.includes('FLEX') || opAgendaProbe.includes('CENTRO DE ENVIO')) {
    return { platform: 'MercadoLibre', platformLogo: 'img/mercadolibre.png' };
  }
  if (opAgendaProbe.includes('FALABELLA')) return { platform: 'Falabella', platformLogo: 'img/falabella.png' };
  if (opAgendaProbe.includes('PARIS')) return { platform: 'Paris', platformLogo: 'img/paris.png' };
  if (opAgendaProbe.includes('WALMART') || opAgendaProbe.includes('LIDER')) return { platform: 'Walmart', platformLogo: 'img/walmart.png' };
  return { platform: raw || 'Manual', platformLogo: 'img/stocka.cap.png' };
}

function formatDateInSantiagoForSla(rawDate, fallbackTimeRaw = null) {
  if (!rawDate) return null;
  try {
    const val = (typeof rawDate === 'number' || /^\d{11,}$/.test(String(rawDate).trim()))
      ? Number(rawDate)
      : String(rawDate).trim();
    // Si es solo fecha YYYY-MM-DD sin hora, no aplicar desfase UTC->Santiago que retrocedería al día anterior
    if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
      const [y, m, d] = val.split('-');
      return `${d}/${m}/${y.slice(-2)}`;
    }
    const isoCandidate = typeof val === 'string' && /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(val)
      ? val.replace(' ', 'T')
      : val;
    const dObj = new Date(isoCandidate);
    if (isNaN(dObj.getTime())) return null;

    // Si venía como fecha local sin zona horaria (ej. Falabella "2026-11-17T12:00:00"), tomar componentes directos
    if (typeof isoCandidate === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(isoCandidate) && !/[zZ]|[+\-]\d{2}:?\d{2}$/.test(isoCandidate)) {
      const dd = String(dObj.getDate()).padStart(2, '0');
      const mm = String(dObj.getMonth() + 1).padStart(2, '0');
      const yy = String(dObj.getFullYear()).slice(-2);
      const hh = String(dObj.getHours()).padStart(2, '0');
      const mi = String(dObj.getMinutes()).padStart(2, '0');
      return (hh === '00' && mi === '00') ? `${dd}/${mm}/${yy}` : `${dd}/${mm}/${yy} ${hh}:${mi}`;
    }

    const formatter = new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
    const parts = formatter.formatToParts(dObj);
    const dd = parts.find(p => p.type === 'day')?.value;
    const mm = parts.find(p => p.type === 'month')?.value;
    const yy = parts.find(p => p.type === 'year')?.value;
    let hh = parts.find(p => p.type === 'hour')?.value;
    let mi = parts.find(p => p.type === 'minute')?.value;

    if (fallbackTimeRaw && (!hh || hh === '00')) {
      try {
        const fbDate = new Date(fallbackTimeRaw);
        if (!isNaN(fbDate.getTime())) {
          const fbParts = formatter.formatToParts(fbDate);
          const fbH = fbParts.find(p => p.type === 'hour')?.value;
          const fbM = fbParts.find(p => p.type === 'minute')?.value;
          if (fbH && fbM && (fbH !== '00' || fbM !== '00')) {
            hh = fbH;
            mi = fbM;
          }
        }
      } catch (_) {}
    }

    if (!dd || !mm || !yy) return null;
    if (hh && mi && (hh !== '00' || mi !== '00')) {
      return `${dd}/${mm}/${yy} ${hh}:${mi}`;
    }
    return `${dd}/${mm}/${yy}`;
  } catch (_) {
    return null;
  }
}

function stripSlaSuffixFromMethod(str) {
  if (!str) return '';
  return String(str)
    .replace(/\s*\((?:L[íi]mite|Limite|SLA)[\s:][^)]*\)/gi, '')
    .replace(/\s*-\s*(?:L[íi]mite|Limite|SLA)[\s:][^)]*$/gi, '')
    .replace(/\s*-\s*\d{1,4}[\/\-]\d{1,2}[\/\-]\d{2,4}(?:\s+\d{1,2}:\d{2})?(?:\s*:\d{2})?$/gi, '')
    .replace(/\s*-\s*$/, '')
    .trim();
}

function parseSlaTextString(str) {
  if (!str) return null;
  const s = String(str).trim();
  const dmyRegex = /(?:L[íi]mite|Limite|SLA)[\s:]+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/i;
  const ymdRegex = /(?:L[íi]mite|Limite|SLA)[\s:]+(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/i;
  const dashYmdRegex = /\s+-\s+(?:SLA[\s:]*)?(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?(?:\s*:\d{2})?$/i;
  const dashDmyRegex = /\s+-\s+(?:SLA[\s:]*)?(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?(?:\s*:\d{2})?$/i;

  let m = s.match(dmyRegex);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    const yy = m[3].length === 4 ? m[3].slice(-2) : m[3];
    const time = (m[4] && m[5]) ? ` ${m[4].padStart(2, '0')}:${m[5].padStart(2, '0')}` : '';
    return `${dd}/${mm}/${yy}${time}`;
  }
  m = s.match(ymdRegex) || s.match(dashYmdRegex);
  if (m) {
    const yy = m[1].length === 4 ? m[1].slice(-2) : m[1];
    const mm = m[2].padStart(2, '0');
    const dd = m[3].padStart(2, '0');
    const time = (m[4] && m[5]) ? ` ${m[4].padStart(2, '0')}:${m[5].padStart(2, '0')}` : '';
    return `${dd}/${mm}/${yy}${time}`;
  }
  m = s.match(dashDmyRegex);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    const yy = m[3].length === 4 ? m[3].slice(-2) : m[3];
    const time = (m[4] && m[5]) ? ` ${m[4].padStart(2, '0')}:${m[5].padStart(2, '0')}` : '';
    return `${dd}/${mm}/${yy}${time}`;
  }
  return null;
}

function resolveOrderSla(order) {
  if (!order) return { hasSla: false, orderSla: 'Sin info' };

  // 1. Texto explícito en shipping_method u operador
  const fromShip = parseSlaTextString(order.shipping_method);
  if (fromShip) return { hasSla: true, orderSla: fromShip };

  const fromOp = parseSlaTextString(order.operador);
  if (fromOp) return { hasSla: true, orderSla: fromOp };

  // 2. Tags del pedido (ej. "SLA: 17-11-26 14:00")
  const rawTags = [
    ...(Array.isArray(order.tags) ? order.tags : String(order.tags || '').split(',')),
    ...String(order.raw_shopify_data?.tags || '').split(',')
  ].map(t => String(t).trim()).filter(Boolean);
  for (const t of rawTags) {
    const fromTag = parseSlaTextString(t);
    if (fromTag) return { hasSla: true, orderSla: fromTag };
  }

  // 3. Falabella: PromisedShippingTime
  if (order.raw_falabella_data?.PromisedShippingTime) {
    const fmt = formatDateInSantiagoForSla(order.raw_falabella_data.PromisedShippingTime);
    if (fmt) return { hasSla: true, orderSla: fmt };
  }

  // 4. MercadoLibre: expected_date / shipping_option
  if (order.raw_meli_data) {
    const rm = Array.isArray(order.raw_meli_data) ? order.raw_meli_data[0] : order.raw_meli_data;
    const sh = rm?.shipping || (Array.isArray(rm?.orders) ? rm.orders[0]?.shipping : null);
    const expDate = rm?.expected_date
      || sh?.expected_date
      || sh?.shipping_option?.estimated_delivery_limit?.date
      || sh?.shipping_option?.estimated_delivery_time?.date;
    const payBefore = sh?.shipping_option?.estimated_delivery_time?.pay_before || null;
    if (expDate) {
      const fmt = formatDateInSantiagoForSla(expDate, payBefore);
      if (fmt) return { hasSla: true, orderSla: fmt };
    }
  }

  // 5. Paris: subOrders[0].dispatchDate / arrivalDateEnd / arrivalDate
  if (order.raw_paris_data?.subOrders?.[0]) {
    const so = order.raw_paris_data.subOrders[0];
    const pDate = so.dispatchDate || so.arrivalDateEnd || so.arrivalDate;
    if (pDate) {
      const fmt = formatDateInSantiagoForSla(pDate);
      if (fmt) return { hasSla: true, orderSla: fmt };
    }
  }

  // 6. Walmart: shippingInfo.estimatedShipDate / estimatedDeliveryDate
  if (order.raw_walmart_data?.shippingInfo) {
    const wDate = order.raw_walmart_data.shippingInfo.estimatedShipDate || order.raw_walmart_data.shippingInfo.estimatedDeliveryDate;
    if (wDate) {
      const fmt = formatDateInSantiagoForSla(wDate);
      if (fmt) return { hasSla: true, orderSla: fmt };
    }
  }

  // 7. Ripley: shipping_deadline
  if (order.raw_ripley_data?.shipping_deadline) {
    const fmt = formatDateInSantiagoForSla(order.raw_ripley_data.shipping_deadline);
    if (fmt) return { hasSla: true, orderSla: fmt };
  }

  return { hasSla: false, orderSla: 'Sin info' };
}

function resolveCustomerShippingMethod(order) {
  if (!order) return '';
  const direct = stripSlaSuffixFromMethod(String(order.shipping_method || '').trim());
  if (direct && direct !== '-' && direct.toLowerCase() !== 'por definir' && direct.toLowerCase() !== 'no informado') {
    return direct;
  }

  if (order.raw_shopify_data?.shipping_lines?.length) {
    const t = order.raw_shopify_data.shipping_lines.map(s => s?.title || s?.code).filter(Boolean).join(', ').trim();
    if (t) return t;
  }
  if (order.raw_woocommerce_data?.shipping_lines?.length) {
    const t = order.raw_woocommerce_data.shipping_lines.map(s => s?.method_title || s?.method_id).filter(Boolean).join(', ').trim();
    if (t) return t;
  }
  if (order.raw_tiendanube_data) {
    const t = String(order.raw_tiendanube_data.shipping_option || order.raw_tiendanube_data.shipping_pickup_details?.name || '').trim();
    if (t) return t;
  }
  if (order.raw_jumpseller_data) {
    const t = String(order.raw_jumpseller_data.shipping_method_name || order.raw_jumpseller_data.external_shipping_rate_description || order.raw_jumpseller_data.shipping_option || '').trim();
    if (t) return t;
  }
  if (order.raw_falabella_data?.ShippingType) {
    return String(order.raw_falabella_data.ShippingType).trim();
  }
  if (order.raw_paris_data?.subOrders?.[0]) {
    const so = order.raw_paris_data.subOrders[0];
    const t = String(so.deliveryOption?.translate || so.deliveryOption?.name || so.carrier || '').trim();
    if (t) return t;
  }
  if (order.raw_walmart_data?.shippingInfo?.methodCode) {
    return String(order.raw_walmart_data.shippingInfo.methodCode).trim();
  }
  if (order.raw_ripley_data) {
    const t = String(order.raw_ripley_data.shipping_type_label || order.raw_ripley_data.shipping_company || '').trim();
    if (t) return t;
  }
  return direct || '';
}

function resolveEffectiveCategoriaEntrega(order) {
  if (!order) return 'DISTRIBUCIÓN';
  const cat = String(order.categoria_entrega || '').toUpperCase().trim();
  const extNo = String(order.external_order_number || '').toUpperCase().trim();
  const agendaUpper = String(order.agenda || '').toUpperCase().trim();
  const plat = resolveOrderPlatform(order).platform;

  if (cat === 'SHOP POINT (POS)' || cat === 'SHOP POINT' || cat === 'POS' || plat === 'Punto de Venta' || agendaUpper === 'COMPRA EN BODEGA' || extNo.startsWith('POS-') || extNo.startsWith('VTA-')) {
    return 'SHOP POINT (POS)';
  }
  if (cat === 'LOGÍSTICA INVERSA' || cat === 'LOGISTICA INVERSA' || plat === 'Logística Inversa' || extNo.startsWith('LI-')) {
    return 'LOGÍSTICA INVERSA';
  }
  if (cat === 'RETIRO' || agendaUpper === 'RETIRO') {
    return 'RETIRO';
  }
  const shipLower = resolveCustomerShippingMethod(order).toLowerCase();
  if (shipLower.includes('punto de venta') || shipLower.includes('compra en bodega') || shipLower.includes('venta presencial')) {
    return 'SHOP POINT (POS)';
  }
  if (shipLower.includes('retiro en tienda') || shipLower.includes('retiro en sucursal') || shipLower.includes('retiro en punto') || shipLower === 'retiro' || shipLower === 'store_pickup') {
    return 'RETIRO';
  }
  return 'DISTRIBUCIÓN';
}

function resolveOrderPaymentInfo(order) {
  if (!order) return { paymentStatus: 'NO PAGADO', isPorPagar: false };

  const opUpper = String(order.operador || '').toUpperCase().trim();
  const curUpper = String(order.courier || '').toUpperCase().trim();
  const shipUpper = String(order.shipping_method || '').toUpperCase().trim();
  const rawFin = String(order.raw_shopify_data?.financial_status || order.payment_status || '').toLowerCase().trim();

  const isPorPagar =
    opUpper.includes('POR PAGAR') ||
    curUpper.includes('POR PAGAR') ||
    shipUpper.includes('POR PAGAR') ||
    rawFin === 'por_pagar' ||
    rawFin === 'por pagar';

  const { platform } = resolveOrderPlatform(order);
  const isMarketplace = ['Falabella', 'MercadoLibre', 'Paris', 'Walmart', 'Ripley'].includes(platform);
  const orderStatusLower = String(order.status || '').toLowerCase().trim();

  const refundedOrVoided = [
    'refunded', 'reembolsado', 'reembolsada',
    'partially_refunded', 'parcialmente_reembolsado',
    'voided', 'anulado', 'cancelled', 'canceled'
  ];

  if (isMarketplace && orderStatusLower !== 'cancelado' && !refundedOrVoided.includes(rawFin)) {
    return { paymentStatus: 'PAGADO', isPorPagar };
  }

  const unpaidStates = new Set([
    ...refundedOrVoided,
    'pending', 'pendiente', 'unpaid', 'no pagado', 'por_pagar', 'por pagar',
    'partially_paid', 'parcialmente_pagado', 'abandoned', 'abandonado',
    'open', 'failed', 'waiting_debit_payment', 'waiting_acceptance'
  ]);
  if (unpaidStates.has(rawFin)) {
    return { paymentStatus: 'NO PAGADO', isPorPagar };
  }

  const paidStates = new Set([
    'paid', 'pagado', 'completed', 'confirmed', 'approved', 'cobrado',
    'authorized', 'autorizado', 'shipped', 'delivered', 'acknowledged',
    'created', 'shipping', 'packing', 'waiting_shipping', 'processing'
  ]);
  if (paidStates.has(rawFin)) {
    return { paymentStatus: 'PAGADO', isPorPagar };
  }

  if (order.raw_woocommerce_data) {
    const wcSt = String(order.raw_woocommerce_data.status || '').toLowerCase();
    if (wcSt === 'processing' || wcSt === 'completed' || order.raw_woocommerce_data.date_paid) {
      return { paymentStatus: 'PAGADO', isPorPagar };
    }
  }

  if (['Manual', 'Punto de Venta', 'Logística Inversa'].includes(platform)) {
    return { paymentStatus: 'PAGADO', isPorPagar };
  }

  return { paymentStatus: 'NO PAGADO', isPorPagar };
}

function resolveOrderCoverage(order) {
  if (!order) return null;
  const rawCity = String(order.shipping_city || order.comuna_destino || '').trim();
  const candidates = [];
  if (rawCity && rawCity.toLowerCase() !== 'no especificada' && rawCity.toLowerCase() !== 'sin comuna') {
    candidates.push(rawCity);
    rawCity.split(/[,/\-()]+/).forEach(part => {
      const t = part.trim();
      if (t) candidates.push(t);
    });
  }

  for (const cand of candidates) {
    const resolved = resolveComunaAlias(cand);
    if (!resolved) continue;
    if (ALPHA_COBERTURA_36.has(resolved)) return 'RM';
    if (CHILE_ALL_COMUNAS_SET.has(resolved)) return 'REGIONES';
  }

  const agendaUpper = String(order.agenda || '').toUpperCase().trim();
  if (agendaUpper === 'RM' || agendaUpper === 'RM-STK') return 'RM';
  if (agendaUpper.includes('REGION')) return 'REGIONES';

  return null;
}

function buildOrderTagsForPicker(order) {
  if (!order) return [];
  const tags = [];
  const addTag = (t) => {
    if (t && !tags.includes(t)) tags.push(t);
  };

  const { platform } = resolveOrderPlatform(order);
  const shipMethod = resolveCustomerShippingMethod(order);
  const shipUpper = shipMethod.toUpperCase();
  const agendaUpper = String(order.agenda || '').toUpperCase().trim();
  const opUpper = String(order.operador || '').toUpperCase().trim();
  const curUpper = String(order.courier || '').toUpperCase().trim();
  const catEntrega = resolveEffectiveCategoriaEntrega(order);
  const { paymentStatus, isPorPagar } = resolveOrderPaymentInfo(order);
  const coverage = resolveOrderCoverage(order);

  // 1. Pagado / No Pagado (colores fuertes) + Por Pagar
  addTag(paymentStatus); // 'PAGADO' o 'NO PAGADO'
  if (isPorPagar) {
    addTag('POR PAGAR');
  }

  // 2. Modalidades logísticas y Marketplaces solicitados
  const rawMeliObj = Array.isArray(order.raw_meli_data) ? order.raw_meli_data[0] : order.raw_meli_data;
  const rawMeliLogistic = String(
    rawMeliObj?.shipping?.logistic_type ||
    rawMeliObj?.orders?.[0]?.shipping?.logistic_type ||
    order.shipping_type ||
    ''
  ).toLowerCase().trim();

  const isMeli = platform === 'MercadoLibre' || !!order.raw_meli_data;
  const isFalabella = platform === 'Falabella' || !!order.raw_falabella_data || agendaUpper.includes('FALABELLA') || opUpper.includes('FALABELLA') || curUpper.includes('FALABELLA');
  const isParis = platform === 'Paris' || !!order.raw_paris_data || agendaUpper.includes('PARIS') || opUpper.includes('PARIS') || curUpper.includes('PARIS');
  const isWalmart = platform === 'Walmart' || !!order.raw_walmart_data || agendaUpper.includes('WALMART') || opUpper.includes('WALMART') || curUpper.includes('WALMART');

  const isExplicitCentroEnvio =
    shipUpper.includes('CENTRO DE ENVIO') ||
    shipUpper.includes('CENTRO DE ENVÍO') ||
    shipUpper.includes('CENTRO ENVIO') ||
    shipUpper.includes('CENTRO ENVÍO') ||
    agendaUpper.includes('CENTRO DE ENVIO') ||
    agendaUpper.includes('CENTRO DE ENVÍOS') ||
    opUpper.includes('CENTRO DE ENVIO') ||
    opUpper.includes('CENTRO DE ENVÍOS') ||
    opUpper.includes('AGENCIA') ||
    (isMeli && (
      rawMeliLogistic === 'cross_docking' ||
      rawMeliLogistic === 'drop_off' ||
      rawMeliLogistic === 'xd_drop_off' ||
      rawMeliLogistic === 'xd' ||
      shipUpper.includes('COLECTA') ||
      shipUpper.includes('PLACES') ||
      shipUpper.includes('MERCADO ENV')
    )) ||
    (isFalabella && (
      shipUpper.includes('OWN WAREHOUSE') ||
      shipUpper.includes('CROSSDOCK') ||
      shipUpper.includes('CROSS DOCK') ||
      shipUpper.includes('CROSS-DOCK') ||
      shipUpper.includes('FBF')
    ));

  const isFlex =
    rawMeliLogistic === 'self_service' ||
    rawMeliLogistic === 'flex' ||
    shipUpper.includes('FLEX') ||
    opUpper.includes('FLEX') ||
    curUpper.includes('FLEX') ||
    (!isExplicitCentroEnvio && agendaUpper.includes('FLEX'));

  if (isExplicitCentroEnvio) addTag('CENTRO DE ENVÍO');
  if (isFlex) addTag('FLEX');
  if (isFalabella) addTag('FALABELLA');
  if (isParis) addTag('PARIS');
  if (isWalmart) addTag('WALMART');

  // 3. Retiro vs Distribución
  if (catEntrega === 'RETIRO' || agendaUpper === 'RETIRO') {
    addTag('RETIRO');
  } else if (catEntrega === 'DISTRIBUCIÓN' && agendaUpper !== 'INGRESO') {
    addTag('DISTRIBUCIÓN');
  }

  // 4. Cobertura (RM, REGIONES)
  if (coverage === 'RM' || coverage === 'REGIONES') {
    addTag(coverage);
  }

  return tags;
}

function normalizeImageUrl(url, ripleyBaseUrl = '') {
  if (!url || typeof url !== 'string') return '';
  let clean = url.trim();
  if (!clean) return '';
  if (clean.startsWith('//')) clean = 'https:' + clean;
  if (clean.startsWith('http://http2.mlstatic.com')) {
    clean = clean.replace(/^http:\/\//i, 'https://');
  }
  if (clean.startsWith('/') && ripleyBaseUrl) {
    clean = ripleyBaseUrl.replace(/\/$/, '') + clean;
  }
  return clean;
}

function resolveProductImageForPicker(prod, order, syncedImagesMap = null) {
  // 1. Direct image_url on WMS master product
  if (prod?.image_url && String(prod.image_url).trim()) {
    return normalizeImageUrl(prod.image_url);
  }

  const skuClean = String(prod?.sku || '').trim();
  const skuUpper = skuClean.toUpperCase();
  const comercioUpper = String(order?.comercio || prod?.comercio || '').trim().toUpperCase();

  // 2. synced_products lookup map (if provided)
  if (syncedImagesMap && skuUpper) {
    const byComm = comercioUpper ? syncedImagesMap.get(`${comercioUpper}__${skuUpper}`) : null;
    if (byComm) return normalizeImageUrl(byComm);
    const bySku = syncedImagesMap.get(skuUpper);
    if (bySku) return normalizeImageUrl(bySku);
  }

  // 3. Raw product metadata on products table
  if (prod?.raw_paris_data) {
    const pImg = prod.raw_paris_data.imagePath || prod.raw_paris_data.imageUrl || prod.raw_paris_data.thumbnail;
    if (pImg) return normalizeImageUrl(pImg);
  }
  if (prod?.raw_falabella_data) {
    const rf = prod.raw_falabella_data;
    const fImg = rf.MainImage || rf.ProductMainImage || (Array.isArray(rf.Images?.Image) ? rf.Images.Image[0] : rf.Images?.Image);
    if (fImg) return normalizeImageUrl(fImg);
    if (rf.ShopSku) {
      const baseShopSku = String(rf.ShopSku).trim().split('_')[0];
      if (baseShopSku) return `https://media.falabella.com/falabellaCL/${baseShopSku}_01`;
    }
  }
  if (prod?.raw_jumpseller_data) {
    const rj = prod.raw_jumpseller_data;
    const jImg = (typeof rj.image === 'string' ? rj.image : rj.image?.url) || rj.images?.[0]?.url;
    if (jImg) return normalizeImageUrl(jImg);
  }
  if (prod?.raw_tiendanube_data) {
    const rt = prod.raw_tiendanube_data;
    const tImg = rt.image?.src || (typeof rt.image === 'string' ? rt.image : '') || rt.images?.[0]?.src;
    if (tImg) return normalizeImageUrl(tImg);
  }
  if (prod?.raw_woocommerce_data) {
    const rw = prod.raw_woocommerce_data;
    const wImg = rw.image?.src || rw.images?.[0]?.src;
    if (wImg) return normalizeImageUrl(wImg);
  }
  if (prod?.raw_meli_data) {
    const rm = prod.raw_meli_data;
    const mImg = rm.secure_thumbnail || rm.pictures?.[0]?.secure_url || rm.pictures?.[0]?.url || rm.thumbnail;
    if (mImg) return normalizeImageUrl(mImg);
  }
  if (prod?.raw_ripley_data) {
    const rr = prod.raw_ripley_data;
    const rImg = rr.product_medias?.[0]?.media_url || rr.image_url;
    if (rImg) return normalizeImageUrl(rImg, 'https://ripley-prod.mirakl.net');
  }

  if (!order) return '';

  const matchSku = (candidate) => {
    if (!candidate || !skuUpper) return false;
    const c = String(candidate).trim().replace(/\s+/g, '').toUpperCase();
    return c === skuUpper || c.includes(skuUpper) || skuUpper.includes(c);
  };

  // 4. Raw order line items fallback
  if (Array.isArray(order.raw_woocommerce_data?.line_items)) {
    const items = order.raw_woocommerce_data.line_items;
    const hit = items.find(li => matchSku(li?.sku) || (prod?.woocommerce_variation_id && String(li?.variation_id) === String(prod.woocommerce_variation_id)) || (prod?.woocommerce_product_id && String(li?.product_id) === String(prod.woocommerce_product_id)))
      || (items.length === 1 ? items[0] : null);
    const src = hit?.image?.src || (typeof hit?.image === 'string' ? hit.image : '');
    if (src) return normalizeImageUrl(src);
  }

  if (Array.isArray(order.raw_tiendanube_data?.products)) {
    const items = order.raw_tiendanube_data.products;
    const hit = items.find(li => matchSku(li?.sku) || (prod?.tiendanube_variant_id && String(li?.variant_id) === String(prod.tiendanube_variant_id)) || (prod?.tiendanube_product_id && String(li?.product_id) === String(prod.tiendanube_product_id)))
      || (items.length === 1 ? items[0] : null);
    const src = hit?.image?.src || (typeof hit?.image === 'string' ? hit.image : '');
    if (src) return normalizeImageUrl(src);
  }

  if (Array.isArray(order.raw_jumpseller_data?.products)) {
    const items = order.raw_jumpseller_data.products;
    const hit = items.find(li => matchSku(li?.sku) || (prod?.jumpseller_variant_id && String(li?.variant_id) === String(prod.jumpseller_variant_id)) || (prod?.jumpseller_product_id && String(li?.product_id || li?.id) === String(prod.jumpseller_product_id)))
      || (items.length === 1 ? items[0] : null);
    const src = typeof hit?.image === 'string' ? hit.image : hit?.image?.url;
    if (src) return normalizeImageUrl(src);
  }

  if (Array.isArray(order.raw_paris_data?.subOrders)) {
    const allItems = [];
    order.raw_paris_data.subOrders.forEach(so => {
      if (Array.isArray(so?.items)) allItems.push(...so.items);
    });
    const hit = allItems.find(li => matchSku(li?.sellerSku) || matchSku(li?.sku))
      || (allItems.length === 1 ? allItems[0] : null);
    const src = hit?.imagePath || hit?.imageUrl || hit?.thumbnail;
    if (src) return normalizeImageUrl(src);
  }

  if (Array.isArray(order.raw_ripley_data?.order_lines)) {
    const items = order.raw_ripley_data.order_lines;
    const hit = items.find(li => matchSku(li?.offer_sku) || matchSku(li?.product_sku))
      || (items.length === 1 ? items[0] : null);
    const src = hit?.product_medias?.[0]?.media_url || hit?.image_url;
    if (src) return normalizeImageUrl(src, 'https://ripley-prod.mirakl.net');
  }

  if (order.raw_meli_data) {
    const rawM = order.raw_meli_data;
    const mOrders = Array.isArray(rawM) ? rawM : (Array.isArray(rawM.orders) ? rawM.orders : [rawM]);
    const mItems = [];
    mOrders.forEach(mo => {
      if (Array.isArray(mo?.order_items)) mItems.push(...mo.order_items);
    });
    const hit = mItems.find(oi => matchSku(oi?.item?.seller_sku) || matchSku(oi?.item?.seller_custom_field) || matchSku(oi?.item?.id))
      || (mItems.length === 1 ? mItems[0] : null);
    const src = hit?.item?.secure_thumbnail || hit?.item?.thumbnail || '';
    if (src) return normalizeImageUrl(src);
  }

  return '';
}

function buildPickerOrderMeta(order) {
  const { platform, platformLogo } = resolveOrderPlatform(order);
  const shippingMethod = resolveCustomerShippingMethod(order);
  const { paymentStatus, isPorPagar } = resolveOrderPaymentInfo(order);
  const coverage = resolveOrderCoverage(order);
  const orderTags = buildOrderTagsForPicker(order);
  const { orderSla, hasSla } = resolveOrderSla(order);

  return {
    platform: String(platform || 'Manual').slice(0, 100),
    platform_logo: String(platformLogo || 'img/stocka.cap.png').slice(0, 500),
    shipping_method: String(shippingMethod || '').slice(0, 500),
    payment_status: String(paymentStatus || 'NO PAGADO').slice(0, 50),
    coverage: coverage ? String(coverage).slice(0, 50) : null,
    order_tags: orderTags,
    order_sla: String(orderSla || 'Sin info').slice(0, 120),
    hasSla,
    isPorPagar
  };
}

module.exports = {
  ALPHA_COBERTURA_36,
  CHILE_ALL_COMUNAS_SET,
  resolveOrderPlatform,
  resolveOrderSla,
  resolveCustomerShippingMethod,
  resolveEffectiveCategoriaEntrega,
  resolveOrderPaymentInfo,
  resolveOrderCoverage,
  buildOrderTagsForPicker,
  resolveProductImageForPicker,
  buildPickerOrderMeta
};
