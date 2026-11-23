// js/returns_widget_customizer.js - Constructor White-Label y Form Builder de Logística Inversa para Sellers y Admins
import supabase from './supabase.js';

const PORTAL_PUBLIC_ORIGIN = 'https://wms.stocka.cl';

function slugifyCommerce(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'tienda';
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export const INDUSTRY_FORM_PRESETS = {
  estandar: {
    name: 'Estándar E-Commerce',
    icon: 'ri-shopping-bag-3-line',
    description: 'Fotos generales del estado del producto, video en fallas, declaración sin uso y datos bancarios en devoluciones.',
    reasons: [
      { id: 'talla_pequena', label: 'La talla me quedó pequeña', applies_to: ['exchange', 'return', 'store_credit'], is_fault: false, active: true },
      { id: 'talla_grande', label: 'La talla me quedó grande', applies_to: ['exchange', 'return', 'store_credit'], is_fault: false, active: true },
      { id: 'cambio_modelo_color', label: 'Prefiero otro color o modelo', applies_to: ['exchange', 'store_credit'], is_fault: false, active: true },
      { id: 'no_esperado', label: 'No era lo que esperaba / Retracto', applies_to: ['exchange', 'return', 'store_credit'], is_fault: false, active: true },
      { id: 'falla_producto', label: 'Producto presenta falla o defecto de fábrica', applies_to: ['exchange', 'return', 'store_credit'], is_fault: true, active: true },
      { id: 'producto_incorrecto', label: 'Recibí un producto distinto al comprado', applies_to: ['exchange', 'return', 'store_credit'], is_fault: true, active: true }
    ],
    schema: [
      {
        id: 'fld_default_photo_estado',
        type: 'photo_upload',
        scope: 'per_item',
        label: 'Fotos del estado actual del producto',
        instructions: 'Sube entre 1 y 3 fotos nítidas donde se aprecie el producto completo, su empaque y etiqueta original.',
        reference_image_url: '',
        required: true,
        min_files: 1,
        max_files: 3,
        max_mb: 15,
        options: [],
        show_when: { resolution_types: ['exchange', 'return', 'store_credit'], reason_ids: [] }
      },
      {
        id: 'fld_default_video_falla',
        type: 'video_upload',
        scope: 'per_item',
        label: 'Video corto mostrando el detalle o falla',
        instructions: 'Graba un video breve (máx. 30 seg) mostrando claramente el desperfecto o producto recibido por error.',
        reference_image_url: '',
        required: true,
        min_files: 0,
        max_files: 1,
        max_mb: 35,
        options: [],
        show_when: { resolution_types: ['exchange', 'return', 'store_credit'], reason_ids: ['falla_producto', 'producto_incorrecto'] }
      },
      {
        id: 'fld_default_condicion_chk',
        type: 'checkbox_confirm',
        scope: 'per_request',
        label: 'Confirmo que el producto está sin uso indebido, limpio y con su embalaje y etiquetas originales.',
        instructions: 'Al ingresar a Punto Stocka Ñuñoa realizaremos la revisión de control de calidad.',
        reference_image_url: '',
        required: true,
        options: [],
        show_when: { resolution_types: ['exchange', 'return', 'store_credit'], reason_ids: [] }
      },
      {
        id: 'fld_default_bank_refund',
        type: 'bank_details_cl',
        scope: 'per_request',
        label: 'Datos bancarios de respaldo para reembolso',
        instructions: 'Completa la cuenta del titular en caso de que tu medio de pago requiera devolución por transferencia.',
        reference_image_url: '',
        required: true,
        options: [],
        show_when: { resolution_types: ['return'], reason_ids: [] }
      }
    ]
  },
  moda_calzado: {
    name: 'Moda, Ropa y Calzado',
    icon: 'ri-t-shirt-2-line',
    description: 'Pide foto de etiqueta colgante, suela sin roce, foto midiendo con huincha en fallas de calce y datos bancarios.',
    reasons: [
      { id: 'talla_chica', label: 'Me quedó chico / ajustado', applies_to: ['exchange', 'return', 'store_credit'], is_fault: false, active: true },
      { id: 'talla_grande', label: 'Me quedó grande / holgado', applies_to: ['exchange', 'return', 'store_credit'], is_fault: false, active: true },
      { id: 'cambio_color_modelo', label: 'Quiero cambiar color o modelo', applies_to: ['exchange', 'store_credit'], is_fault: false, active: true },
      { id: 'medida_defectuosa', label: 'La talla etiquetada no coincide con la tabla de medidas', applies_to: ['exchange', 'return', 'store_credit'], is_fault: true, active: true },
      { id: 'falla_costura_material', label: 'Falla de costura, cierre o material', applies_to: ['exchange', 'return', 'store_credit'], is_fault: true, active: true }
    ],
    schema: [
      {
        id: 'fld_foto_prenda_etiqueta',
        type: 'photo_upload',
        scope: 'per_item',
        label: 'Foto frontal de la prenda/calzado con etiqueta puesta',
        instructions: 'Asegúrate de que se vea la etiqueta colgante sin cortar y, si es calzado, incluye foto de la suela limpia y la caja sin cintas pegadas directo al cartón.',
        reference_image_url: '',
        required: true,
        min_files: 1,
        max_files: 3,
        max_mb: 15,
        options: [],
        show_when: { resolution_types: ['exchange', 'return', 'store_credit'], reason_ids: [] }
      },
      {
        id: 'fld_foto_huincha',
        type: 'photo_upload',
        scope: 'per_item',
        label: 'Sube una foto midiendo la prenda con huincha de medir',
        instructions: 'Extiende la prenda sobre una mesa plana y sube una foto midiendo el ancho de pecho o largo total en centímetros.',
        reference_image_url: '',
        required: true,
        min_files: 1,
        max_files: 2,
        max_mb: 15,
        options: [],
        show_when: { resolution_types: ['exchange', 'return', 'store_credit'], reason_ids: ['medida_defectuosa'] }
      },
      {
        id: 'fld_video_costura',
        type: 'video_upload',
        scope: 'per_item',
        label: 'Video corto mostrando la costura o cierre',
        instructions: 'Adjunta un video breve mostrando el detalle reportado en la prenda.',
        reference_image_url: '',
        required: false,
        min_files: 0,
        max_files: 1,
        max_mb: 35,
        options: [],
        show_when: { resolution_types: ['exchange', 'return', 'store_credit'], reason_ids: ['falla_costura_material'] }
      },
      {
        id: 'fld_check_sin_uso_moda',
        type: 'checkbox_confirm',
        scope: 'per_request',
        label: 'Confirmo que la prenda no tiene uso, manchas, olores ni lavados, y conserva sus etiquetas.',
        instructions: '',
        reference_image_url: '',
        required: true,
        options: [],
        show_when: { resolution_types: ['exchange', 'return', 'store_credit'], reason_ids: [] }
      },
      {
        id: 'fld_banco_moda',
        type: 'bank_details_cl',
        scope: 'per_request',
        label: 'Cuenta bancaria para devolución de dinero',
        instructions: 'Ingresa tus datos bancarios para procesar el reembolso una vez recepcionada la prenda en bodega.',
        reference_image_url: '',
        required: true,
        options: [],
        show_when: { resolution_types: ['return'], reason_ids: [] }
      }
    ]
  },
  electronica: {
    name: 'Electrónica, Audio y Gaming',
    icon: 'ri-gamepad-line',
    description: 'Exige número de serie (S/N), video obligatorio encendiendo/mostrando la falla y sello intacto para retracto.',
    reasons: [
      { id: 'falla_tecnica', label: 'El equipo no enciende o presenta falla técnica', applies_to: ['exchange', 'return', 'store_credit'], is_fault: true, active: true },
      { id: 'producto_incompleto', label: 'Faltan piezas o llegó dañado en transporte', applies_to: ['exchange', 'return', 'store_credit'], is_fault: true, active: true },
      { id: 'incompatibilidad', label: 'Compré el modelo/conector equivocado (sellado)', applies_to: ['exchange', 'store_credit'], is_fault: false, active: true },
      { id: 'retracto_sellado', label: 'Arrepentimiento de compra (caja 100% sellada)', applies_to: ['return', 'store_credit'], is_fault: false, active: true }
    ],
    schema: [
      {
        id: 'fld_numero_serie',
        type: 'text',
        scope: 'per_item',
        label: 'Número de Serie (S/N) del equipo',
        instructions: 'Escribe el código S/N impreso en la base del producto o en la etiqueta blanca de la caja.',
        reference_image_url: '',
        required: true,
        options: [],
        show_when: { resolution_types: ['exchange', 'return', 'store_credit'], reason_ids: [] }
      },
      {
        id: 'fld_foto_sellos_caja',
        type: 'photo_upload',
        scope: 'per_item',
        label: 'Fotos del producto, número de serie y sellos de la caja',
        instructions: 'Sube fotos claras mostrando sellos de seguridad o todos los cables/manuales incluidos.',
        reference_image_url: '',
        required: true,
        min_files: 1,
        max_files: 4,
        max_mb: 15,
        options: [],
        show_when: { resolution_types: ['exchange', 'return', 'store_credit'], reason_ids: [] }
      },
      {
        id: 'fld_video_falla_tech',
        type: 'video_upload',
        scope: 'per_item',
        label: 'Video demostrando la falla técnica',
        instructions: 'Conecta o enciende el dispositivo en un video continuo (máx 35 MB) mostrando exactamente el síntoma reportado.',
        reference_image_url: '',
        required: true,
        min_files: 1,
        max_files: 1,
        max_mb: 35,
        options: [],
        show_when: { resolution_types: ['exchange', 'return', 'store_credit'], reason_ids: ['falla_tecnica', 'producto_incompleto'] }
      },
      {
        id: 'fld_banco_tech',
        type: 'bank_details_cl',
        scope: 'per_request',
        label: 'Datos bancarios para reembolso',
        instructions: 'Requerido en caso de devolución aprobada por servicio técnico.',
        reference_image_url: '',
        required: true,
        options: [],
        show_when: { resolution_types: ['return'], reason_ids: [] }
      }
    ]
  },
  cosmetica_joyas: {
    name: 'Joyería, Belleza y Accesorios',
    icon: 'ri-sparkling-2-line',
    description: 'Enfocado en sellos higiénicos intactos, código de lote y evidencia visual de recepción.',
    reasons: [
      { id: 'cambio_talla_anillo', label: 'Cambio de medida / largo (sin uso)', applies_to: ['exchange', 'store_credit'], is_fault: false, active: true },
      { id: 'dano_transporte', label: 'Llegó roto, derramado o dañado', applies_to: ['exchange', 'return', 'store_credit'], is_fault: true, active: true },
      { id: 'producto_equivocado', label: 'Me llegó otro tono o referencia', applies_to: ['exchange', 'return', 'store_credit'], is_fault: true, active: true },
      { id: 'devolucion_sellado', label: 'Devolución con sello higiénico intacto', applies_to: ['return', 'store_credit'], is_fault: false, active: true }
    ],
    schema: [
      {
        id: 'fld_banner_higiene',
        type: 'info_banner',
        scope: 'per_request',
        label: 'Importante: Sello de Higiene y Estuche Original',
        instructions: 'Por normativa sanitaria, solo podemos aceptar cambios o devoluciones voluntarias si el sello termoencogible o precinto de seguridad no ha sido abierto.',
        reference_image_url: '',
        required: false,
        options: [],
        show_when: { resolution_types: ['exchange', 'return', 'store_credit'], reason_ids: ['cambio_talla_anillo', 'devolucion_sellado'] }
      },
      {
        id: 'fld_fotos_sello_joya',
        type: 'photo_upload',
        scope: 'per_item',
        label: 'Fotos de cerca del sello / estuche y etiqueta',
        instructions: 'Toma 2 fotos con buena luz donde se vea el estado del envase o pieza.',
        reference_image_url: '',
        required: true,
        min_files: 1,
        max_files: 3,
        max_mb: 15,
        options: [],
        show_when: { resolution_types: ['exchange', 'return', 'store_credit'], reason_ids: [] }
      },
      {
        id: 'fld_banco_joyas',
        type: 'bank_details_cl',
        scope: 'per_request',
        label: 'Datos bancarios para devolución',
        instructions: 'Ingresa la cuenta donde deseas recibir el abono.',
        reference_image_url: '',
        required: true,
        options: [],
        show_when: { resolution_types: ['return'], reason_ids: [] }
      }
    ]
  }
};

export function getDefaultReturnPortalConfig(commerceName) {
  const cleanName = String(commerceName || '').trim();
  const preset = INDUSTRY_FORM_PRESETS.estandar;
  return {
    comercio: cleanName,
    slug: slugifyCommerce(cleanName),
    is_enabled: true,
    brand_name: cleanName,
    logo_url: '',
    primary_color: '#5c24ff',
    background_color: 'transparent',
    hero_title: 'Cambios y Devoluciones',
    hero_subtitle: 'Gestiona el cambio o devolución de tus productos validando tu correo en segundos.',
    policy_summary_text: 'Los productos deben presentarse sin uso, limpios, con etiquetas y embalaje original.',
    support_wa: '',
    support_email: '',
    enable_exchanges: true,
    enable_returns: true,
    enable_store_credit: false,
    store_credit_bonus_pct: 10,
    return_window_days: 10,
    exchange_window_days: 30,
    require_delivered_status: false,
    allow_even_variant_exchange: true,
    allow_catalog_exchange: true,
    excluded_skus: [],
    enabled_methods: {
      sucursal_nunoa: true,
      rm_simultaneous_swap: true,
      rm_pickup: true,
      regiones_courier: true,
      user_own_shipping: true
    },
    rm_shipping_fee_clp: 3500,
    rm_swap_fee_clp: 4500,
    regiones_fee_mode: 'table_rate',
    regiones_flat_fee_clp: 5990,
    free_shipping_on_fault: true,
    auto_generate_enviame_label: true,
    payment_instructions: '',
    payment_link_url: '',
    channel_sync_mode: 'ask_on_approve',
    shopify_create_return: true,
    shopify_create_exchange_order: false,
    woocommerce_create_refund: true,
    woocommerce_create_replacement_order: false,
    woocommerce_add_order_notes: true,
    reservation_ttl_days: 7,
    custom_reasons: JSON.parse(JSON.stringify(preset.reasons)),
    form_schema: JSON.parse(JSON.stringify(preset.schema))
  };
}

export async function loadReturnPortalConfig(commerceName) {
  const norm = String(commerceName || '').trim();
  const defaults = getDefaultReturnPortalConfig(norm);
  if (!norm) return defaults;

  try {
    const { data, error } = await supabase
      .from('seller_return_portal_configs')
      .select('*')
      .ilike('comercio', norm)
      .maybeSingle();

    if (error) throw error;
    if (data) {
      return {
        ...defaults,
        ...data,
        comercio: data.comercio || norm,
        slug: data.slug || slugifyCommerce(norm),
        enabled_methods: {
          ...defaults.enabled_methods,
          ...(typeof data.enabled_methods === 'object' && data.enabled_methods ? data.enabled_methods : {})
        },
        excluded_skus: Array.isArray(data.excluded_skus) ? data.excluded_skus : [],
        custom_reasons: Array.isArray(data.custom_reasons) && data.custom_reasons.length > 0
          ? data.custom_reasons
          : defaults.custom_reasons,
        form_schema: Array.isArray(data.form_schema)
          ? data.form_schema
          : defaults.form_schema
      };
    }
  } catch (err) {
    console.warn('Aviso consultando seller_return_portal_configs:', err);
  }
  return defaults;
}

export async function saveReturnPortalConfig(commerceName, config) {
  const norm = String(commerceName || config.comercio || '').trim();
  if (!norm) throw new Error('Nombre de comercio inválido.');

  const payload = {
    comercio: norm,
    slug: slugifyCommerce(config.slug || norm),
    is_enabled: Boolean(config.is_enabled),
    brand_name: String(config.brand_name || norm).trim(),
    logo_url: String(config.logo_url || '').trim(),
    primary_color: String(config.primary_color || '#5c24ff').trim(),
    background_color: String(config.background_color || 'transparent').trim(),
    hero_title: String(config.hero_title || 'Cambios y Devoluciones').trim(),
    hero_subtitle: String(config.hero_subtitle || '').trim(),
    policy_summary_text: String(config.policy_summary_text || '').trim(),
    support_wa: String(config.support_wa || '').trim(),
    support_email: String(config.support_email || '').trim(),
    return_window_days: Math.max(1, parseInt(config.return_window_days, 10) || 10),
    exchange_window_days: Math.max(1, parseInt(config.exchange_window_days, 10) || 30),
    enable_exchanges: Boolean(config.enable_exchanges),
    enable_returns: Boolean(config.enable_returns),
    enable_store_credit: Boolean(config.enable_store_credit),
    store_credit_bonus_pct: Math.max(0, Math.min(100, Number(config.store_credit_bonus_pct) || 0)),
    require_delivered_status: Boolean(config.require_delivered_status),
    allow_even_variant_exchange: Boolean(config.allow_even_variant_exchange),
    allow_catalog_exchange: Boolean(config.allow_catalog_exchange),
    excluded_skus: Array.isArray(config.excluded_skus)
      ? config.excluded_skus.map(s => String(s).trim()).filter(Boolean)
      : String(config.excluded_skus || '').split(',').map(s => s.trim()).filter(Boolean),
    enabled_methods: {
      sucursal_nunoa: Boolean(config.enabled_methods?.sucursal_nunoa),
      rm_simultaneous_swap: Boolean(config.enabled_methods?.rm_simultaneous_swap),
      rm_pickup: Boolean(config.enabled_methods?.rm_pickup),
      regiones_courier: Boolean(config.enabled_methods?.regiones_courier),
      user_own_shipping: Boolean(config.enabled_methods?.user_own_shipping)
    },
    rm_shipping_fee_clp: Math.max(0, Math.round(Number(config.rm_shipping_fee_clp) || 0)),
    rm_swap_fee_clp: Math.max(0, Math.round(Number(config.rm_swap_fee_clp) || 0)),
    regiones_fee_mode: config.regiones_fee_mode === 'flat_rate' ? 'flat_rate' : 'table_rate',
    regiones_flat_fee_clp: Math.max(0, Math.round(Number(config.regiones_flat_fee_clp) || 0)),
    auto_generate_enviame_label: Boolean(config.auto_generate_enviame_label),
    free_shipping_on_fault: Boolean(config.free_shipping_on_fault),
    payment_instructions: String(config.payment_instructions || '').trim(),
    payment_link_url: String(config.payment_link_url || '').trim(),
    channel_sync_mode: ['none', 'ask_on_approve', 'auto_on_approve'].includes(config.channel_sync_mode)
      ? config.channel_sync_mode
      : 'ask_on_approve',
    shopify_create_return: Boolean(config.shopify_create_return),
    shopify_create_exchange_order: Boolean(config.shopify_create_exchange_order),
    woocommerce_create_refund: Boolean(config.woocommerce_create_refund),
    woocommerce_create_replacement_order: Boolean(config.woocommerce_create_replacement_order),
    woocommerce_add_order_notes: Boolean(config.woocommerce_add_order_notes),
    reservation_ttl_days: Math.max(1, parseInt(config.reservation_ttl_days, 10) || 7),
    custom_reasons: Array.isArray(config.custom_reasons) ? config.custom_reasons : [],
    form_schema: Array.isArray(config.form_schema) ? config.form_schema : [],
    updated_at: new Date().toISOString()
  };

  const { data: existing } = await supabase
    .from('seller_return_portal_configs')
    .select('id, comercio')
    .ilike('comercio', norm)
    .maybeSingle();

  if (existing && existing.id) {
    payload.comercio = existing.comercio;
    const { data, error } = await supabase
      .from('seller_return_portal_configs')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        throw new Error(`El identificador corto (slug) "${payload.slug}" ya está en uso por otra tienda. Elige otro en la pestaña Diseño.`);
      }
      throw error;
    }
    return data;
  } else {
    const { data, error } = await supabase
      .from('seller_return_portal_configs')
      .insert([payload])
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        throw new Error(`El identificador corto (slug) "${payload.slug}" ya está en uso por otra tienda. Elige otro en la pestaña Diseño.`);
      }
      throw error;
    }
    return data;
  }
}

async function uploadGuideAsset(commerceSlug, file, subfolder = 'guides') {
  if (!file) throw new Error('Selecciona una imagen válida.');
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('La imagen supera el máximo permitido de 10 MB.');
  }
  const safeExt = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${subfolder}/${slugifyCommerce(commerceSlug)}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${safeExt}`;

  const { error } = await supabase.storage
    .from('reverse-portal-guides')
    .upload(path, file, { cacheControl: '3600', upsert: true, contentType: file.type || 'image/jpeg' });

  if (error) throw error;

  const { data } = supabase.storage.from('reverse-portal-guides').getPublicUrl(path);
  return data?.publicUrl || '';
}

async function resolveAvailableComercios(explicitCommerce) {
  const role = String(window.currentUserProfile?.role || '').toLowerCase();
  const isAdmin = role === 'admin' || role === 'operator' || Boolean(document.getElementById('admin-sidebar') || window.location.pathname.includes('admin'));

  if (isAdmin) {
    const set = new Set();
    if (explicitCommerce) set.add(String(explicitCommerce).trim());
    try {
      const [{ data: profs }, { data: cfgs }] = await Promise.all([
        supabase.from('profiles').select('comercio, company_name').not('comercio', 'is', null).limit(500),
        supabase.from('seller_return_portal_configs').select('comercio').limit(300)
      ]);
      (profs || []).forEach(p => {
        String(p.comercio || p.company_name || '')
          .split(',')
          .map(s => s.trim())
          .filter(s => s && s.toLowerCase() !== 'no asignado' && s.toLowerCase() !== 'stocka' && s.toLowerCase() !== 'all')
          .forEach(s => set.add(s));
      });
      (cfgs || []).forEach(c => {
        if (c.comercio) set.add(String(c.comercio).trim());
      });
    } catch (e) {
      console.warn('Error cargando lista de comercios para Admin:', e);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }

  const currentCompany = explicitCommerce || window.currentCompany || window.currentUserProfile?.comercio || window.currentUserProfile?.company_name || '';
  return currentCompany
    .split(',')
    .map(c => c.trim())
    .filter(c => c && c.toLowerCase() !== 'no asignado');
}

export async function renderReturnsWidgetCustomizer(options = {}) {
  const targetContainer = options.container || document.getElementById('app-content');
  if (!targetContainer) return;

  targetContainer.innerHTML = `
    <div style="display: flex; justify-content: center; align-items: center; min-height: 360px;">
      <div style="text-align: center;">
        <i class="ri-loader-4-line ri-spin" style="font-size: 2.5rem; color: var(--color-primary, #5c24ff);"></i>
        <p style="margin-top: 0.85rem; color: var(--color-text-muted, #64748b); font-weight: 600;">Cargando Constructor de Portal de Cambios y Devoluciones...</p>
      </div>
    </div>
  `;

  const comercios = await resolveAvailableComercios(options.comercio);
  if (comercios.length === 0) {
    targetContainer.innerHTML = `
      <div class="alert alert-warning" style="display: block; margin: 2rem; padding: 1.25rem; border-radius: 12px;">
        <i class="ri-error-warning-line"></i> No tienes comercios asociados para configurar el Portal Público de Cambios y Devoluciones.
      </div>
    `;
    return;
  }

  if (options.comercio && comercios.includes(options.comercio)) {
    window.activeReturnsCommerce = options.comercio;
  } else if (!window.activeReturnsCommerce || !comercios.includes(window.activeReturnsCommerce)) {
    window.activeReturnsCommerce = comercios[0];
  }

  const initialConfig = await loadReturnPortalConfig(window.activeReturnsCommerce);
  mountReturnsCustomizerUI(targetContainer, comercios, initialConfig, options);
}

const FIELD_TYPE_META = {
  photo_upload: { label: 'Subida de Fotos (1 a 5 imágenes)', icon: 'ri-camera-lens-line', color: '#5c24ff' },
  video_upload: { label: 'Subida de Video Corto (MP4/MOV)', icon: 'ri-video-upload-line', color: '#db2777' },
  info_banner: { label: 'Instrucción / Guía Visual con Imagen Ejemplo', icon: 'ri-information-line', color: '#2563eb' },
  checkbox_confirm: { label: 'Casilla de Confirmación / Declaración', icon: 'ri-checkbox-line', color: '#059669' },
  text: { label: 'Texto Corto (ej. N° Serie, Lote)', icon: 'ri-input-method-line', color: '#475569' },
  textarea: { label: 'Comentario / Detalle Extendido', icon: 'ri-file-text-line', color: '#475569' },
  number: { label: 'Número / Medida (ej. cm)', icon: 'ri-hashtag', color: '#0284c7' },
  select: { label: 'Lista Desplegable de Opciones', icon: 'ri-list-check-2', color: '#7c3aed' },
  bank_details_cl: { label: 'Datos Bancarios Chile (con validador RUT)', icon: 'ri-bank-card-line', color: '#0d9488' },
  file_pdf: { label: 'Adjunto Documento / Boleta (PDF o Imagen)', icon: 'ri-file-pdf-2-line', color: '#ea580c' }
};

function mountReturnsCustomizerUI(container, comerciosList, initialConfig, options = {}) {
  let state = JSON.parse(JSON.stringify(initialConfig));
  let activeTab = options.initialTab || 'design';
  let previewMode = 'form';

  const injectStylesOnce = () => {
    if (document.getElementById('rw-customizer-styles')) return;
    const style = document.createElement('style');
    style.id = 'rw-customizer-styles';
    style.textContent = `
      .rw-wrap { max-width: 1440px; margin: 0 auto; padding: 1.25rem 0.5rem 3.5rem; }
      .rw-grid { display: grid; grid-template-columns: minmax(420px, 1.25fr) minmax(380px, 1fr); gap: 1.5rem; align-items: start; }
      @media (max-width: 1080px) { .rw-grid { grid-template-columns: 1fr; } }
      .rw-tabs { display: flex; gap: 0.4rem; flex-wrap: wrap; background: var(--color-surface, #fff); padding: 0.5rem; border: 1px solid var(--color-border, #e2e8f0); border-radius: 12px; margin-bottom: 1.15rem; }
      .rw-tab-btn { border: none; background: transparent; color: var(--color-text-muted, #64748b); font-weight: 700; font-size: 0.82rem; padding: 0.58rem 0.9rem; border-radius: 9px; cursor: pointer; display: inline-flex; align-items: center; gap: 0.42rem; transition: all 0.16s ease; }
      .rw-tab-btn:hover { background: rgba(92, 36, 255, 0.06); color: var(--color-text-main, #0f172a); }
      .rw-tab-btn.active { background: #5c24ff; color: #ffffff; box-shadow: 0 3px 10px rgba(92, 36, 255, 0.22); }
      .rw-card { background: var(--color-surface, #fff); border: 1px solid var(--color-border, #e2e8f0); border-radius: 14px; padding: 1.35rem; box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.04)); margin-bottom: 1.1rem; }
      .rw-card-title { font-size: 1rem; font-weight: 800; color: var(--color-text-main, #0f172a); margin: 0 0 1rem 0; display: flex; align-items: center; gap: 0.5rem; }
      .rw-row-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.9rem; }
      .rw-toggle-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding: 0.85rem 1rem; border: 1px solid var(--color-border, #e2e8f0); border-radius: 10px; background: rgba(248, 250, 252, 0.65); margin-bottom: 0.7rem; }
      .rw-field-card { border: 1px solid var(--color-border, #cbd5e1); border-radius: 12px; padding: 1rem; background: var(--color-surface, #fff); margin-bottom: 0.85rem; transition: border-color 0.15s; }
      .rw-field-card:hover { border-color: #8b5cf6; }
      .rw-preset-card { border: 1px solid var(--color-border, #e2e8f0); border-radius: 10px; padding: 0.75rem 0.9rem; background: var(--color-surface, #fff); cursor: pointer; text-align: left; transition: all 0.15s; }
      .rw-preset-card:hover { border-color: #5c24ff; background: rgba(92, 36, 255, 0.04); transform: translateY(-1px); }
      .rw-mini-btn { border: 1px solid var(--color-border, #cbd5e1); background: #fff; color: #334155; border-radius: 7px; padding: 0.3rem 0.55rem; font-size: 0.76rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 0.25rem; }
      .rw-mini-btn:hover { border-color: #5c24ff; color: #5c24ff; }
      .rw-mini-btn.danger:hover { border-color: #ef4444; color: #ef4444; background: #fef2f2; }
    `;
    document.head.appendChild(style);
  };
  injectStylesOnce();

  function getDirectStoreUrl() {
    const slug = slugifyCommerce(state.slug || state.comercio);
    return `${PORTAL_PUBLIC_ORIGIN}/cambios?s=${encodeURIComponent(slug)}`;
  }

  function getEmbedHtmlSnippet() {
    const url = `${getDirectStoreUrl()}&embed=1`;
    return `<!-- Portal de Cambios y Devoluciones Stocka (${escapeHtml(state.brand_name || state.comercio)}) -->
<iframe
  id="stocka-returns-iframe"
  src="${url}"
  style="width: 100%; min-height: 760px; border: none; border-radius: 16px; overflow: hidden;"
  allow="camera; clipboard-write"
  loading="lazy"
  title="Portal de Cambios y Devoluciones - ${escapeHtml(state.brand_name || state.comercio)}"
></iframe>
<script>
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'stocka-returns-resize') {
      var ifr = document.getElementById('stocka-returns-iframe');
      if (ifr && e.data.height) ifr.style.height = (Number(e.data.height) + 28) + 'px';
    }
  });
</script>`;
  }

  function renderFullLayout() {
    const commerceOptions = comerciosList.map(c =>
      `<option value="${escapeHtml(c)}" ${c === window.activeReturnsCommerce ? 'selected' : ''}>${escapeHtml(c)}</option>`
    ).join('');

    container.innerHTML = `
      <div class="rw-wrap" id="returns-customizer-app">
        <div class="rw-card" style="padding: 1.35rem 1.5rem; margin-bottom: 1.15rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
            <div>
              <div style="display: inline-flex; align-items: center; gap: 0.45rem; background: rgba(92, 36, 255, 0.1); color: #5c24ff; padding: 0.28rem 0.75rem; border-radius: 99px; font-size: 0.76rem; font-weight: 800; margin-bottom: 0.45rem;">
                <i class="ri-arrow-left-right-line"></i> Portal Público White-Label + Form Builder
              </div>
              <h2 style="font-size: 1.4rem; font-weight: 800; color: var(--color-text-main, #0f172a); margin: 0;">
                Portal de Cambios y Devoluciones para tu Sitio Web
              </h2>
              <p style="color: var(--color-text-muted, #64748b); font-size: 0.86rem; margin: 0.25rem 0 0;">
                Personaliza diseño, reglas de cambio, medios de transporte (Punto Ñuñoa, RM y Regiones) y construye el formulario exacto con fotos, videos e instrucciones para tus compradores.
              </p>
            </div>

            <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
              ${options.onBackToReturns ? `
                <button type="button" id="rw-btn-back-returns" class="btn btn-outline" style="padding: 0.52rem 0.9rem; font-weight: 700; font-size: 0.82rem;">
                  <i class="ri-arrow-left-line"></i> Volver a Logística Inversa
                </button>
              ` : ''}
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <label style="font-weight: 700; font-size: 0.82rem; color: var(--color-text-main);">Comercio:</label>
                <select id="rw-select-commerce" class="form-input" style="padding: 0.48rem 0.85rem; font-weight: 700; min-width: 205px; border-radius: 9px;">
                  ${commerceOptions}
                </select>
              </div>
              <button type="button" id="rw-btn-save-top" class="btn btn-primary" style="background: #5c24ff; border-color: #5c24ff; padding: 0.58rem 1.15rem; font-weight: 800; font-size: 0.85rem; border-radius: 9px; display: inline-flex; align-items: center; gap: 0.45rem;">
                <i class="ri-save-3-line"></i> Guardar Configuración
              </button>
            </div>
          </div>
        </div>

        <div class="rw-tabs">
          <button type="button" class="rw-tab-btn ${activeTab === 'design' ? 'active' : ''}" data-rw-tab="design">
            <i class="ri-palette-line"></i> 1. Diseño y Marca
          </button>
          <button type="button" class="rw-tab-btn ${activeTab === 'rules' ? 'active' : ''}" data-rw-tab="rules">
            <i class="ri-scales-3-line"></i> 2. Reglas, Crédito y Pagos
          </button>
          <button type="button" class="rw-tab-btn ${activeTab === 'logistics' ? 'active' : ''}" data-rw-tab="logistics">
            <i class="ri-truck-line"></i> 3. Transporte y Canales (Shopify/Woo)
          </button>
          <button type="button" class="rw-tab-btn ${activeTab === 'form' ? 'active' : ''}" data-rw-tab="form">
            <i class="ri-list-settings-line"></i> 4. Formulario Dinámico (${(state.form_schema || []).length})
          </button>
          <button type="button" class="rw-tab-btn ${activeTab === 'embed' ? 'active' : ''}" data-rw-tab="embed">
            <i class="ri-code-s-slash-line"></i> 5. Instalar Link / Iframe
          </button>
        </div>

        <div class="rw-grid">
          <div id="rw-left-pane"></div>
          <div id="rw-right-pane" style="position: sticky; top: 1rem;"></div>
        </div>
      </div>
    `;

    renderLeftTab();
    renderRightPreview();
    bindShellEvents();
  }

  function renderLeftTab() {
    const left = container.querySelector('#rw-left-pane');
    if (!left) return;

    if (activeTab === 'design') {
      left.innerHTML = `
        <div class="rw-card">
          <h3 class="rw-card-title"><i class="ri-paint-brush-line" style="color:#5c24ff;"></i> Identidad White-Label de tu Portal</h3>

          <div class="rw-toggle-row">
            <div>
              <div style="font-weight: 800; font-size: 0.88rem; color: var(--color-text-main);">Portal Público Habilitado</div>
              <div style="font-size: 0.76rem; color: var(--color-text-muted);">Permite que tus compradores inicien solicitudes de cambio o devolución con validación de correo OTP.</div>
            </div>
            <input type="checkbox" id="rw-is-enabled" ${state.is_enabled ? 'checked' : ''} style="width: 20px; height: 20px; accent-color: #5c24ff; cursor: pointer;">
          </div>

          <div class="rw-row-2" style="margin-top: 0.95rem;">
            <div class="form-group">
              <label class="form-label" style="font-weight: 700; font-size: 0.82rem;">Nombre Visible de tu Marca</label>
              <input type="text" id="rw-brand-name" class="form-input" value="${escapeHtml(state.brand_name)}" placeholder="Ej: Mi Tienda Oficial">
            </div>
            <div class="form-group">
              <label class="form-label" style="font-weight: 700; font-size: 0.82rem;">Identificador de Enlace Corto (Slug)</label>
              <div style="display: flex; align-items: center; gap: 0.35rem;">
                <span style="font-size: 0.74rem; color: #64748b; font-family: monospace; white-space: nowrap;">/cambios?s=</span>
                <input type="text" id="rw-slug" class="form-input" value="${escapeHtml(state.slug)}" style="font-family: monospace; font-weight: 700;">
              </div>
            </div>
          </div>

          <div class="form-group" style="margin-top: 0.85rem;">
            <label class="form-label" style="font-weight: 700; font-size: 0.82rem;">Logotipo de tu Tienda (URL o subir imagen)</label>
            <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
              <input type="url" id="rw-logo-url" class="form-input" style="flex: 1; min-width: 220px;" value="${escapeHtml(state.logo_url)}" placeholder="https://tutienda.cl/logo.png">
              <label class="rw-mini-btn" style="padding: 0.52rem 0.85rem; cursor: pointer;">
                <i class="ri-upload-2-line"></i> Subir Logo
                <input type="file" id="rw-logo-upload-file" accept="image/*" style="display: none;">
              </label>
            </div>
          </div>

          <div class="rw-row-2" style="margin-top: 0.95rem;">
            <div class="form-group">
              <label class="form-label" style="font-weight: 700; font-size: 0.82rem;">Color Corporativo Principal</label>
              <div style="display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap;">
                <input type="color" id="rw-primary-color" value="${escapeHtml(state.primary_color || '#5c24ff')}" style="width: 44px; height: 38px; border-radius: 8px; border: 1px solid #cbd5e1; cursor: pointer; padding: 2px;">
                <input type="text" id="rw-primary-hex" class="form-input" value="${escapeHtml(state.primary_color || '#5c24ff')}" maxlength="7" style="width: 105px; font-family: monospace; font-weight: 700;">
                <div style="display: flex; gap: 5px;">
                  ${['#5c24ff', '#0f172a', '#e11d48', '#059669', '#2563eb', '#d97706'].map(c =>
                    `<button type="button" class="rw-color-swatch" data-color="${c}" style="width: 22px; height: 22px; border-radius: 50%; background: ${c}; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.25); cursor: pointer;"></button>`
                  ).join('')}
                </div>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" style="font-weight: 700; font-size: 0.82rem;">Fondo del Widget / Página</label>
              <select id="rw-bg-color" class="form-input">
                <option value="transparent" ${state.background_color === 'transparent' ? 'selected' : ''}>Transparente (Ideal para Iframe)</option>
                <option value="#f8fafc" ${state.background_color === '#f8fafc' ? 'selected' : ''}>Gris Claro Suave (#f8fafc)</option>
                <option value="#ffffff" ${state.background_color === '#ffffff' ? 'selected' : ''}>Blanco Puro (#ffffff)</option>
              </select>
            </div>
          </div>

          <div class="form-group" style="margin-top: 0.9rem;">
            <label class="form-label" style="font-weight: 700; font-size: 0.82rem;">Título Principal del Portal</label>
            <input type="text" id="rw-hero-title" class="form-input" value="${escapeHtml(state.hero_title)}">
          </div>

          <div class="form-group" style="margin-top: 0.8rem;">
            <label class="form-label" style="font-weight: 700; font-size: 0.82rem;">Subtítulo de Bienvenida</label>
            <textarea id="rw-hero-subtitle" class="form-input" rows="2">${escapeHtml(state.hero_subtitle)}</textarea>
          </div>

          <div class="form-group" style="margin-top: 0.8rem;">
            <label class="form-label" style="font-weight: 700; font-size: 0.82rem;">Resumen de Política Visible para el Comprador</label>
            <textarea id="rw-policy-text" class="form-input" rows="2" placeholder="Ej: Tienes 30 días desde la recepción. Prendas deben estar sin uso y con etiquetas originales.">${escapeHtml(state.policy_summary_text || '')}</textarea>
          </div>

          <div class="rw-row-2" style="margin-top: 0.85rem;">
            <div class="form-group">
              <label class="form-label" style="font-weight: 700; font-size: 0.82rem;">WhatsApp Soporte Tienda (Opcional)</label>
              <input type="text" id="rw-support-wa" class="form-input" value="${escapeHtml(state.support_wa || '')}" placeholder="56912345678">
            </div>
            <div class="form-group">
              <label class="form-label" style="font-weight: 700; font-size: 0.82rem;">Email Atención Clientes (Opcional)</label>
              <input type="email" id="rw-support-email" class="form-input" value="${escapeHtml(state.support_email || '')}" placeholder="postventa@tutienda.cl">
            </div>
          </div>
        </div>
      `;
      bindDesignEvents();
      return;
    }

    if (activeTab === 'rules') {
      left.innerHTML = `
        <div class="rw-card">
          <h3 class="rw-card-title"><i class="ri-exchange-dollar-line" style="color:#5c24ff;"></i> Tipos de Resolución y Ventanas de Tiempo</h3>

          <div class="rw-toggle-row">
            <div>
              <div style="font-weight: 800; font-size: 0.88rem;">Habilitar Cambios de Producto / Talla</div>
              <div style="font-size: 0.76rem; color: var(--color-text-muted);">Muestra el explorador de catálogo con stock disponible en tiempo real de WMS Stocka.</div>
            </div>
            <input type="checkbox" id="rw-enable-exchange" ${state.enable_exchanges ? 'checked' : ''} style="width: 20px; height: 20px; accent-color: #5c24ff;">
          </div>

          <div class="rw-toggle-row">
            <div>
              <div style="font-weight: 800; font-size: 0.88rem;">Habilitar Devolución de Dinero</div>
              <div style="font-size: 0.76rem; color: var(--color-text-muted);">Permite solicitar reembolso por los ítems seleccionados tras la recepción en bodega.</div>
            </div>
            <input type="checkbox" id="rw-enable-return" ${state.enable_returns ? 'checked' : ''} style="width: 20px; height: 20px; accent-color: #5c24ff;">
          </div>

          <div class="rw-toggle-row" style="background: rgba(16, 185, 129, 0.05); border-color: rgba(16, 185, 129, 0.25);">
            <div style="flex: 1;">
              <div style="font-weight: 800; font-size: 0.88rem; color: #065f46; display: flex; align-items: center; gap: 0.4rem;">
                <i class="ri-gift-2-line"></i> Opción Crédito / Cupón en Tienda (Opcional por Seller)
              </div>
              <div style="font-size: 0.76rem; color: #047857; margin-top: 2px;">
                Incentiva retener la venta ofreciendo un cupón automático en Shopify o WooCommerce con un % extra de bonificación.
              </div>
              ${state.enable_store_credit ? `
                <div style="margin-top: 0.65rem; display: flex; align-items: center; gap: 0.5rem;">
                  <label style="font-size: 0.78rem; font-weight: 700; color: #065f46;">Bonificación Extra (%):</label>
                  <input type="number" id="rw-credit-bonus" class="form-input" min="0" max="50" step="1" value="${Number(state.store_credit_bonus_pct) || 0}" style="width: 90px; padding: 0.35rem 0.6rem; font-weight: 800;">
                </div>
              ` : ''}
            </div>
            <input type="checkbox" id="rw-enable-credit" ${state.enable_store_credit ? 'checked' : ''} style="width: 20px; height: 20px; accent-color: #10b981;">
          </div>

          <div class="rw-row-2" style="margin-top: 0.9rem;">
            <div class="form-group">
              <label class="form-label" style="font-weight: 700; font-size: 0.82rem;">Plazo Máx. para Cambios (Días corridos)</label>
              <input type="number" id="rw-exchange-days" class="form-input" min="1" max="365" value="${state.exchange_window_days}">
            </div>
            <div class="form-group">
              <label class="form-label" style="font-weight: 700; font-size: 0.82rem;">Plazo Máx. para Devoluciones (Días corridos)</label>
              <input type="number" id="rw-return-days" class="form-input" min="1" max="365" value="${state.return_window_days}">
            </div>
          </div>

          <div class="rw-toggle-row" style="margin-top: 0.85rem;">
            <div>
              <div style="font-weight: 800; font-size: 0.85rem;">Cambio de Variante/Talla a Costo $0 (Even Exchange)</div>
              <div style="font-size: 0.75rem; color: var(--color-text-muted);">Si compró con descuento/Cyber y cambia por otra talla del mismo artículo, se respeta el cambio mano a mano sin cobrar diferencia por el producto.</div>
            </div>
            <input type="checkbox" id="rw-even-variant" ${state.allow_even_variant_exchange ? 'checked' : ''} style="width: 19px; height: 19px; accent-color: #5c24ff;">
          </div>

          <div class="rw-toggle-row">
            <div>
              <div style="font-weight: 800; font-size: 0.85rem;">Permitir Cambio Abierto por Otros Productos del Catálogo</div>
              <div style="font-size: 0.75rem; color: var(--color-text-muted);">Permite elegir cualquier otro SKU disponible en tu inventario Stocka calculando automáticamente la diferencia respecto al valor pagado.</div>
            </div>
            <input type="checkbox" id="rw-catalog-exchange" ${state.allow_catalog_exchange ? 'checked' : ''} style="width: 19px; height: 19px; accent-color: #5c24ff;">
          </div>

          <div class="rw-toggle-row">
            <div>
              <div style="font-weight: 800; font-size: 0.85rem;">Exigir Pedido Entregado para Habilitar Solicitud</div>
              <div style="font-size: 0.75rem; color: var(--color-text-muted);">Impide abrir solicitudes sobre pedidos que aún no figuren como Entregados.</div>
            </div>
            <input type="checkbox" id="rw-require-delivered" ${state.require_delivered_status ? 'checked' : ''} style="width: 19px; height: 19px; accent-color: #5c24ff;">
          </div>

          <div class="form-group" style="margin-top: 0.8rem;">
            <label class="form-label" style="font-weight: 700; font-size: 0.82rem;">SKUs Excluidos de Cambios/Devoluciones (Opcional, separados por coma)</label>
            <input type="text" id="rw-excluded-skus" class="form-input" value="${escapeHtml((state.excluded_skus || []).join(', '))}" placeholder="Ej: ROPA-INT-01, GIFTCARD-10K">
          </div>
        </div>

        <div class="rw-card">
          <h3 class="rw-card-title"><i class="ri-secure-payment-line" style="color:#2563eb;"></i> Cobro de Diferencias de Precio o Logística</h3>
          <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 0.8rem 1rem; font-size: 0.78rem; color: #1e40af; margin-bottom: 0.95rem; line-height: 1.45;">
            <i class="ri-information-fill"></i> <strong>Flujo Operativo:</strong> El stock del ítem de reemplazo se reserva en WMS <strong>cuando tú apruebas la solicitud</strong>. Si existe saldo a pagar por el comprador, tú gestionas el pago y marcas <strong>"Marcar como Pagado"</strong> en Stocka (el comprador también puede adjuntar su comprobante en el portal).
          </div>

          <div class="form-group">
            <label class="form-label" style="font-weight: 700; font-size: 0.82rem;">Link de Pago Rápido (Opcional — Webpay.cl, MercadoPago, Flow, VentiPay)</label>
            <input type="url" id="rw-payment-link" class="form-input" value="${escapeHtml(state.payment_link_url || '')}" placeholder="https://www.webpay.cl/company/...">
          </div>

          <div class="form-group" style="margin-top: 0.8rem;">
            <label class="form-label" style="font-weight: 700; font-size: 0.82rem;">Instrucciones de Transferencia / Pago para el Comprador</label>
            <textarea id="rw-payment-instructions" class="form-input" rows="3" placeholder="Ej: Banco Santander · Cuenta Corriente 00-12345-6 · RUT 77.123.456-7 · pagos@tutienda.cl. Indica tu N° de RMA y sube el comprobante en este portal.">${escapeHtml(state.payment_instructions || '')}</textarea>
          </div>
        </div>
      `;
      bindRulesEvents();
      return;
    }

    if (activeTab === 'logistics') {
      const m = state.enabled_methods || {};
      left.innerHTML = `
        <div class="rw-card">
          <h3 class="rw-card-title"><i class="ri-map-pin-range-line" style="color:#5c24ff;"></i> Medios Logísticos y Cobertura por Comuna</h3>

          <div class="rw-toggle-row">
            <div style="flex: 1;">
              <div style="font-weight: 800; font-size: 0.88rem; display: flex; align-items: center; gap: 0.4rem;">
                <i class="ri-store-2-line" style="color:#5c24ff;"></i> Entrega Presencial en Punto Stocka Ñuñoa ($0)
              </div>
              <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 2px;">
                Av. Campo de Deportes 405, Ñuñoa (Única sucursal física habilitada). Genera pase QR para atención rápida en mesón.
              </div>
            </div>
            <input type="checkbox" id="rw-allow-nunoa" ${m.sucursal_nunoa !== false ? 'checked' : ''} style="width: 20px; height: 20px; accent-color: #5c24ff;">
          </div>

          <div class="rw-toggle-row">
            <div style="flex: 1;">
              <div style="font-weight: 800; font-size: 0.88rem; display: flex; align-items: center; gap: 0.4rem;">
                <i class="ri-loop-left-line" style="color:#059669;"></i> Cambio Simultáneo Puerta a Puerta RM (Flota Stocka X)
              </div>
              <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 2px;">
                Disponible en las 36 comunas urbanas RM para cambios: el móvil entrega el reemplazo y retira el producto devuelto en el mismo viaje.
              </div>
              ${m.rm_simultaneous_swap !== false ? `
                <div style="margin-top: 0.55rem; display: flex; align-items: center; gap: 0.5rem;">
                  <label style="font-size: 0.76rem; font-weight: 700;">Tarifa Cambio Simultáneo RM (CLP):</label>
                  <input type="number" id="rw-rm-swap-fee" class="form-input" min="0" step="100" value="${state.rm_swap_fee_clp}" style="width: 125px; padding: 0.32rem 0.6rem;">
                </div>
              ` : ''}
            </div>
            <input type="checkbox" id="rw-allow-rm-swap" ${m.rm_simultaneous_swap !== false ? 'checked' : ''} style="width: 20px; height: 20px; accent-color: #5c24ff;">
          </div>

          <div class="rw-toggle-row">
            <div style="flex: 1;">
              <div style="font-weight: 800; font-size: 0.88rem;">Retiro a Domicilio RM (Devoluciones o Revisión Previa en Bodega)</div>
              <div style="font-size: 0.75rem; color: var(--color-text-muted);">Retiro programado en las 36 comunas urbanas RM hacia Matriz Ñuñoa.</div>
              ${m.rm_pickup !== false ? `
                <div style="margin-top: 0.55rem; display: flex; align-items: center; gap: 0.5rem;">
                  <label style="font-size: 0.76rem; font-weight: 700;">Tarifa Retiro RM (CLP):</label>
                  <input type="number" id="rw-rm-pickup-fee" class="form-input" min="0" step="100" value="${state.rm_shipping_fee_clp}" style="width: 125px; padding: 0.32rem 0.6rem;">
                </div>
              ` : ''}
            </div>
            <input type="checkbox" id="rw-allow-rm-pickup" ${m.rm_pickup !== false ? 'checked' : ''} style="width: 20px; height: 20px; accent-color: #5c24ff;">
          </div>

          <div class="rw-toggle-row">
            <div style="flex: 1;">
              <div style="font-weight: 800; font-size: 0.88rem;">Transporte Regiones y RM Rural (Blue Express / Starken / Chilexpress)</div>
              <div style="font-size: 0.75rem; color: var(--color-text-muted);">Cobertura en las 346 comunas de Chile con generación de etiqueta reversa vía integración Envíame.</div>
              ${m.regiones_courier !== false ? `
                <div style="margin-top: 0.65rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 0.65rem;">
                  <div>
                    <label style="font-size: 0.75rem; font-weight: 700; display: block; margin-bottom: 3px;">Modo de Cobro al Comprador:</label>
                    <select id="rw-regiones-mode" class="form-input" style="padding: 0.35rem 0.6rem; font-size: 0.8rem;">
                      <option value="table_rate" ${state.regiones_fee_mode !== 'flat_rate' ? 'selected' : ''}>Según Tarifario Comunal Stocka</option>
                      <option value="flat_rate" ${state.regiones_fee_mode === 'flat_rate' ? 'selected' : ''}>Tarifa Plana Fija Regiones</option>
                    </select>
                  </div>
                  ${state.regiones_fee_mode === 'flat_rate' ? `
                    <div>
                      <label style="font-size: 0.75rem; font-weight: 700; display: block; margin-bottom: 3px;">Tarifa Plana Regiones (CLP):</label>
                      <input type="number" id="rw-regiones-flat" class="form-input" min="0" step="100" value="${state.regiones_flat_fee_clp}" style="padding: 0.35rem 0.6rem;">
                    </div>
                  ` : ''}
                </div>
                <label style="display: inline-flex; align-items: center; gap: 0.45rem; margin-top: 0.6rem; font-size: 0.78rem; font-weight: 700; color: #1e40af; cursor: pointer;">
                  <input type="checkbox" id="rw-auto-enviame" ${state.auto_generate_enviame_label ? 'checked' : ''} style="accent-color:#2563eb;">
                  Emitir etiqueta reversa automáticamente vía Envíame API al aprobar RMA
                </label>
              ` : ''}
            </div>
            <input type="checkbox" id="rw-allow-regiones" ${m.regiones_courier !== false ? 'checked' : ''} style="width: 20px; height: 20px; accent-color: #5c24ff;">
          </div>

          <div class="rw-toggle-row">
            <div>
              <div style="font-weight: 800; font-size: 0.88rem;">Transporte Propio del Usuario</div>
              <div style="font-size: 0.75rem; color: var(--color-text-muted);">El cliente despacha pagado en origen hacia Punto Stocka Ñuñoa e informa el N° de seguimiento en el portal.</div>
            </div>
            <input type="checkbox" id="rw-allow-own" ${m.user_own_shipping !== false ? 'checked' : ''} style="width: 20px; height: 20px; accent-color: #5c24ff;">
          </div>

          <div class="rw-toggle-row" style="background: rgba(16, 185, 129, 0.05); border-color: rgba(16, 185, 129, 0.25);">
            <div>
              <div style="font-weight: 800; font-size: 0.86rem; color: #065f46;">Logística Costo $0 Automática en Garantía / Falla</div>
              <div style="font-size: 0.75rem; color: #047857;">Si el comprador selecciona un motivo marcado como falla o error de envío, no se le cobra tarifa logística.</div>
            </div>
            <input type="checkbox" id="rw-free-fault" ${state.free_shipping_on_fault ? 'checked' : ''} style="width: 19px; height: 19px; accent-color: #10b981;">
          </div>
        </div>

        <div class="rw-card">
          <h3 class="rw-card-title"><i class="ri-plug-2-line" style="color:#059669;"></i> Integración Opcional con tu Canal de Venta (Shopify / WooCommerce)</h3>
          <div class="form-group" style="margin-bottom: 0.9rem;">
            <label class="form-label" style="font-weight: 700; font-size: 0.82rem;">Comportamiento al Aprobar una Solicitud RMA</label>
            <select id="rw-channel-sync-mode" class="form-input">
              <option value="ask_on_approve" ${state.channel_sync_mode === 'ask_on_approve' ? 'selected' : ''}>Preguntar caso a caso al aprobar (Recomendado)</option>
              <option value="auto_on_approve" ${state.channel_sync_mode === 'auto_on_approve' ? 'selected' : ''}>Marcar sincronización automática por defecto al aprobar</option>
              <option value="none" ${state.channel_sync_mode === 'none' ? 'selected' : ''}>Solo gestionar en Stocka WMS (no tocar canal de venta)</option>
            </select>
          </div>

          <div class="rw-toggle-row">
            <div>
              <div style="font-weight: 800; font-size: 0.88rem;"><i class="ri-shopping-bag-3-line" style="color:#16a34a;"></i> Shopify · Registrar Return Oficial y Tags/Cupones</div>
              <div style="font-size: 0.75rem; color: var(--color-text-muted);">Ejecuta <code>returnCreate</code> GraphQL, etiqueta el pedido con el RMA y emite código de descuento si aplica Crédito en Tienda.</div>
            </div>
            <input type="checkbox" id="rw-shopify-ret" ${state.shopify_create_return ? 'checked' : ''} style="width: 20px; height: 20px; accent-color: #16a34a;">
          </div>

          <div class="rw-toggle-row">
            <div>
              <div style="font-weight: 800; font-size: 0.88rem;"><i class="ri-store-3-line" style="color:#7c3aed;"></i> WooCommerce · Notas de Orden y Cupón / Reembolso</div>
              <div style="font-size: 0.75rem; color: var(--color-text-muted);">Registra nota de trazabilidad en el pedido de WooCommerce y habilita reembolso contable al recepcionar QC.</div>
            </div>
            <input type="checkbox" id="rw-woo-notes" ${state.woocommerce_add_order_notes ? 'checked' : ''} style="width: 20px; height: 20px; accent-color: #7c3aed;">
          </div>

          <div class="rw-toggle-row">
            <div>
              <div style="font-weight: 800; font-size: 0.85rem;">WooCommerce · Crear también pedido espejo $0 en Cambios</div>
              <div style="font-size: 0.75rem; color: var(--color-text-muted);">Opcional: genera una orden vinculada de $0 en WooCommerce con protección anti-loop para que no duplique ingreso en WMS.</div>
            </div>
            <input type="checkbox" id="rw-woo-rep" ${state.woocommerce_create_replacement_order ? 'checked' : ''} style="width: 19px; height: 19px; accent-color: #7c3aed;">
          </div>
        </div>
      `;
      bindLogisticsEvents();
      return;
    }

    if (activeTab === 'form') {
      const reasonsHtml = (state.custom_reasons || []).map((r, idx) => `
        <div style="display: grid; grid-template-columns: 1.5fr 1fr auto auto; gap: 0.5rem; align-items: center; padding: 0.55rem 0.7rem; border: 1px solid var(--color-border, #e2e8f0); border-radius: 9px; margin-bottom: 0.45rem; background: #f8fafc;">
          <input type="text" class="form-input rw-reason-label" data-ridx="${idx}" value="${escapeHtml(r.label)}" placeholder="Texto del motivo para el cliente" style="padding: 0.36rem 0.6rem; font-size: 0.8rem; font-weight: 600;">
          <select class="form-input rw-reason-applies" data-ridx="${idx}" style="padding: 0.36rem 0.5rem; font-size: 0.76rem;">
            <option value="all" ${(r.applies_to || []).includes('return') && (r.applies_to || []).includes('exchange') ? 'selected' : ''}>Cambio y Devolución</option>
            <option value="exchange_only" ${(r.applies_to || []).includes('exchange') && !(r.applies_to || []).includes('return') ? 'selected' : ''}>Solo Cambio / Crédito</option>
            <option value="return_only" ${(r.applies_to || []).includes('return') && !(r.applies_to || []).includes('exchange') ? 'selected' : ''}>Solo Devolución</option>
          </select>
          <label title="Marca si es falla o error de despacho (activa envío gratis si corresponde)" style="display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.74rem; font-weight: 700; color: ${r.is_fault ? '#dc2626' : '#64748b'}; cursor: pointer; white-space: nowrap;">
            <input type="checkbox" class="rw-reason-fault" data-ridx="${idx}" ${r.is_fault ? 'checked' : ''} style="accent-color:#dc2626;">
            Es Falla
          </label>
          <button type="button" class="rw-mini-btn danger rw-reason-del" data-ridx="${idx}" title="Eliminar motivo"><i class="ri-delete-bin-line"></i></button>
        </div>
      `).join('');

      const fieldsHtml = (state.form_schema || []).map((fld, idx) => {
        const meta = FIELD_TYPE_META[fld.type] || { label: fld.type, icon: 'ri-question-line', color: '#475569' };
        const showRes = fld.show_when?.resolution_types || ['exchange', 'return', 'store_credit'];
        const showReasonIds = Array.isArray(fld.show_when?.reason_ids) ? fld.show_when.reason_ids : [];
        const isAllReasons = showReasonIds.length === 0;

        let resSelectVal = 'all';
        if (showRes.length === 1 && showRes[0] === 'exchange') resSelectVal = 'exchange';
        else if (showRes.length === 1 && showRes[0] === 'return') resSelectVal = 'return';
        else if (showRes.length === 1 && showRes[0] === 'store_credit') resSelectVal = 'store_credit';

        const isFaultReasonsPreset = !isAllReasons && showReasonIds.length > 0 && showReasonIds.every(rid => (state.custom_reasons || []).find(cr => cr.id === rid)?.is_fault);

        return `
          <div class="rw-field-card" data-fidx="${idx}">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.75rem; padding-bottom: 0.6rem; border-bottom: 1px dashed #e2e8f0;">
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span style="width: 28px; height: 28px; border-radius: 8px; background: ${meta.color}15; color: ${meta.color}; display: inline-flex; align-items: center; justify-content: center; font-size: 1rem;">
                  <i class="${meta.icon}"></i>
                </span>
                <div>
                  <div style="font-size: 0.8rem; font-weight: 800; color: var(--color-text-main);">#${idx + 1} · ${escapeHtml(meta.label)}</div>
                  <div style="font-size: 0.7rem; color: #64748b;">ID: <code>${escapeHtml(fld.id)}</code></div>
                </div>
              </div>
              <div style="display: flex; gap: 0.3rem;">
                <button type="button" class="rw-mini-btn rw-fld-up" data-fidx="${idx}" ${idx === 0 ? 'disabled style="opacity:0.4;"' : ''} title="Subir"><i class="ri-arrow-up-line"></i></button>
                <button type="button" class="rw-mini-btn rw-fld-down" data-fidx="${idx}" ${idx === state.form_schema.length - 1 ? 'disabled style="opacity:0.4;"' : ''} title="Bajar"><i class="ri-arrow-down-line"></i></button>
                <button type="button" class="rw-mini-btn danger rw-fld-del" data-fidx="${idx}" title="Eliminar bloque"><i class="ri-delete-bin-line"></i></button>
              </div>
            </div>

            <div class="rw-row-2">
              <div class="form-group">
                <label style="font-size: 0.75rem; font-weight: 700; display: block; margin-bottom: 3px;">Tipo de Requisito / Campo</label>
                <select class="form-input rw-fld-type" data-fidx="${idx}" style="padding: 0.4rem 0.6rem; font-size: 0.8rem; font-weight: 700;">
                  ${Object.entries(FIELD_TYPE_META).map(([k, m]) =>
                    `<option value="${k}" ${fld.type === k ? 'selected' : ''}>${escapeHtml(m.label)}</option>`
                  ).join('')}
                </select>
              </div>
              <div class="form-group">
                <label style="font-size: 0.75rem; font-weight: 700; display: block; margin-bottom: 3px;">Alcance de Captura</label>
                <select class="form-input rw-fld-scope" data-fidx="${idx}" style="padding: 0.4rem 0.6rem; font-size: 0.8rem;" ${fld.type === 'bank_details_cl' ? 'disabled' : ''}>
                  <option value="per_item" ${fld.scope === 'per_item' ? 'selected' : ''}>Por cada producto seleccionado</option>
                  <option value="per_request" ${fld.scope === 'per_request' ? 'selected' : ''}>Una vez por toda la solicitud</option>
                </select>
              </div>
            </div>

            <div class="form-group" style="margin-top: 0.65rem;">
              <label style="font-size: 0.75rem; font-weight: 700; display: block; margin-bottom: 3px;">Título / Qué le pides al comprador</label>
              <input type="text" class="form-input rw-fld-label" data-fidx="${idx}" value="${escapeHtml(fld.label || '')}" placeholder="Ej: Sube una foto midiendo el largo de la prenda con huincha" style="font-size: 0.83rem; font-weight: 600;">
            </div>

            <div class="form-group" style="margin-top: 0.6rem;">
              <label style="font-size: 0.75rem; font-weight: 700; display: block; margin-bottom: 3px;">Instrucciones personalizadas para el comprador</label>
              <textarea class="form-input rw-fld-instructions" data-fidx="${idx}" rows="2" placeholder="Ej: Coloca la prenda sobre una mesa bien iluminada y asegúrate de que se lean los centímetros..." style="font-size: 0.8rem;">${escapeHtml(fld.instructions || '')}</textarea>
            </div>

            ${fld.type === 'select' ? `
              <div class="form-group" style="margin-top: 0.6rem;">
                <label style="font-size: 0.75rem; font-weight: 700; display: block; margin-bottom: 3px;">Opciones desplegables (separadas por coma)</label>
                <input type="text" class="form-input rw-fld-options" data-fidx="${idx}" value="${escapeHtml((fld.options || []).join(', '))}" placeholder="Ej: Sellado sin abrir, Abierto sin uso, Usado con falla" style="font-size: 0.8rem;">
              </div>
            ` : ''}

            ${['photo_upload', 'video_upload', 'info_banner'].includes(fld.type) ? `
              <div style="margin-top: 0.65rem; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 9px; padding: 0.65rem 0.8rem;">
                <label style="font-size: 0.75rem; font-weight: 700; color: #334155; display: block; margin-bottom: 4px;">
                  <i class="ri-image-add-line" style="color:#5c24ff;"></i> Imagen Guía de Ejemplo para el Comprador (Opcional)
                </label>
                <div style="display: flex; gap: 0.45rem; align-items: center; flex-wrap: wrap;">
                  <input type="url" class="form-input rw-fld-refimg" data-fidx="${idx}" value="${escapeHtml(fld.reference_image_url || '')}" placeholder="URL de foto ejemplo o sube una desde tu PC..." style="flex: 1; min-width: 190px; font-size: 0.78rem; padding: 0.36rem 0.6rem;">
                  <label class="rw-mini-btn" style="cursor: pointer; padding: 0.4rem 0.7rem;">
                    <i class="ri-upload-cloud-2-line"></i> Subir Ejemplo
                    <input type="file" class="rw-fld-upload-guide" data-fidx="${idx}" accept="image/*" style="display: none;">
                  </label>
                  ${fld.reference_image_url ? `
                    <img src="${escapeHtml(fld.reference_image_url)}" alt="Guía" style="width: 36px; height: 36px; object-fit: cover; border-radius: 6px; border: 1px solid #cbd5e1;">
                  ` : ''}
                </div>
              </div>
            ` : ''}

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.6rem; margin-top: 0.7rem; align-items: end;">
              ${fld.type === 'photo_upload' ? `
                <div>
                  <label style="font-size: 0.73rem; font-weight: 700; display: block; margin-bottom: 3px;">Máx. Fotos</label>
                  <input type="number" class="form-input rw-fld-maxfiles" data-fidx="${idx}" min="1" max="5" value="${fld.max_files || 3}" style="padding: 0.35rem 0.55rem; font-size: 0.8rem;">
                </div>
              ` : ''}

              <div>
                <label style="font-size: 0.73rem; font-weight: 700; display: block; margin-bottom: 3px;">Mostrar cuando elija:</label>
                <select class="form-input rw-fld-when-res" data-fidx="${idx}" style="padding: 0.35rem 0.55rem; font-size: 0.78rem;">
                  <option value="all" ${resSelectVal === 'all' ? 'selected' : ''}>Cualquier resolución</option>
                  <option value="exchange" ${resSelectVal === 'exchange' ? 'selected' : ''}>Solo en Cambio</option>
                  <option value="return" ${resSelectVal === 'return' ? 'selected' : ''}>Solo en Devolución</option>
                  <option value="store_credit" ${resSelectVal === 'store_credit' ? 'selected' : ''}>Solo en Crédito Tienda</option>
                </select>
              </div>

              <div>
                <label style="font-size: 0.73rem; font-weight: 700; display: block; margin-bottom: 3px;">Condición por Motivo:</label>
                <select class="form-input rw-fld-when-reason" data-fidx="${idx}" style="padding: 0.35rem 0.55rem; font-size: 0.78rem;">
                  <option value="" ${isAllReasons ? 'selected' : ''}>En todos los motivos</option>
                  <option value="__faults__" ${isFaultReasonsPreset ? 'selected' : ''}>Solo motivos de Falla / Error</option>
                  ${(state.custom_reasons || []).map(cr =>
                    `<option value="${escapeHtml(cr.id)}" ${!isAllReasons && showReasonIds.length === 1 && showReasonIds[0] === cr.id ? 'selected' : ''}>Solo: ${escapeHtml(cr.label)}</option>`
                  ).join('')}
                </select>
              </div>

              ${fld.type !== 'info_banner' ? `
                <label style="display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.78rem; font-weight: 700; cursor: pointer; padding-bottom: 0.35rem;">
                  <input type="checkbox" class="rw-fld-req" data-fidx="${idx}" ${fld.required ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #5c24ff;">
                  Obligatorio
                </label>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');

      left.innerHTML = `
        <div class="rw-card">
          <h3 class="rw-card-title"><i class="ri-magic-line" style="color:#5c24ff;"></i> Plantillas Inteligentes 1-Click por Rubro</h3>
          <p style="font-size: 0.78rem; color: var(--color-text-muted); margin: -0.35rem 0 0.85rem;">
            Carga una estructura recomendada de motivos, fotos y videos según tu industria y luego edítala libremente.
          </p>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.65rem;">
            ${Object.entries(INDUSTRY_FORM_PRESETS).map(([key, p]) => `
              <button type="button" class="rw-preset-card" data-preset="${key}">
                <div style="font-weight: 800; font-size: 0.83rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.4rem;">
                  <i class="${p.icon}" style="color:#5c24ff;"></i> ${escapeHtml(p.name)}
                </div>
                <div style="font-size: 0.72rem; color: var(--color-text-muted); margin-top: 0.28rem; line-height: 1.35;">
                  ${escapeHtml(p.description)}
                </div>
              </button>
            `).join('')}
          </div>
        </div>

        <div class="rw-card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.85rem;">
            <h3 class="rw-card-title" style="margin: 0;"><i class="ri-question-answer-line" style="color:#2563eb;"></i> Motivos Seleccionables por el Comprador</h3>
            <button type="button" id="rw-btn-add-reason" class="rw-mini-btn" style="padding: 0.4rem 0.75rem; color: #5c24ff; border-color: #c4b5fd;">
              <i class="ri-add-line"></i> Agregar Motivo
            </button>
          </div>
          <div>${reasonsHtml || '<div style="font-size:0.8rem;color:#64748b;">No hay motivos configurados.</div>'}</div>
        </div>

        <div class="rw-card">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.85rem;">
            <div>
              <h3 class="rw-card-title" style="margin: 0;"><i class="ri-camera-switch-line" style="color:#db2777;"></i> Campos, Fotos, Videos e Instrucciones del Formulario</h3>
              <p style="font-size: 0.75rem; color: var(--color-text-muted); margin: 2px 0 0;">Define exactamente qué fotos, videos, imágenes guía o medidas debe completar el comprador.</p>
            </div>
            <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
              <button type="button" class="rw-mini-btn rw-quick-add" data-qtype="photo_upload" style="color:#5c24ff; border-color:#c4b5fd;"><i class="ri-camera-line"></i> + Pedir Foto</button>
              <button type="button" class="rw-mini-btn rw-quick-add" data-qtype="video_upload" style="color:#db2777; border-color:#fbcfe8;"><i class="ri-video-add-line"></i> + Pedir Video</button>
              <button type="button" class="rw-mini-btn rw-quick-add" data-qtype="info_banner" style="color:#2563eb; border-color:#bfdbfe;"><i class="ri-image-line"></i> + Instrucción con Foto</button>
              <button type="button" class="rw-mini-btn rw-quick-add" data-qtype="text"><i class="ri-add-line"></i> + Otro Campo</button>
            </div>
          </div>

          <div id="rw-fields-list">
            ${fieldsHtml || '<div style="padding: 1.5rem; text-align: center; color: #64748b; border: 1px dashed #cbd5e1; border-radius: 10px;">Sin campos adicionales. Usa los botones superiores para pedir fotos, videos o datos.</div>'}
          </div>
        </div>
      `;
      bindFormBuilderEvents();
      return;
    }

    if (activeTab === 'embed') {
      const storeUrl = getDirectStoreUrl();
      const globalUrl = `${PORTAL_PUBLIC_ORIGIN}/cambios`;
      const snippet = getEmbedHtmlSnippet();

      left.innerHTML = `
        <div class="rw-card">
          <h3 class="rw-card-title"><i class="ri-links-line" style="color:#5c24ff;"></i> 1. Enlace Directo Exclusivo de tu Comercio</h3>
          <p style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: -0.35rem;">
            Al ingresar por este enlace, tus clientes verán <strong>únicamente tu marca y las compras asociadas a ${escapeHtml(state.comercio)}</strong>.
          </p>
          <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-top: 0.75rem;">
            <input type="text" readonly class="form-input" value="${escapeHtml(storeUrl)}" style="flex: 1; min-width: 240px; font-family: monospace; font-weight: 700; background: #f8fafc;">
            <button type="button" id="rw-copy-store-url" class="btn btn-primary" style="background:#5c24ff; border-color:#5c24ff; padding: 0.55rem 0.95rem; font-weight: 700; font-size: 0.8rem;">
              <i class="ri-file-copy-line"></i> Copiar Link
            </button>
            <a href="/cambios?s=${encodeURIComponent(slugifyCommerce(state.slug || state.comercio))}" target="_blank" rel="noopener" class="btn btn-outline" style="padding: 0.55rem 0.95rem; font-weight: 700; font-size: 0.8rem; text-decoration: none;">
              <i class="ri-external-link-line"></i> Probar Portal en Vivo
            </a>
          </div>
        </div>

        <div class="rw-card">
          <h3 class="rw-card-title"><i class="ri-code-box-line" style="color:#059669;"></i> 2. Incrustar dentro de tu Sitio Web (Shopify / WooCommerce / Jumpseller)</h3>
          <p style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: -0.35rem;">
            Crea una página llamada <strong>"Cambios y Devoluciones"</strong> en tu tienda, activa el modo HTML (<code>&lt;/&gt;</code>) y pega este código auto-ajustable:
          </p>
          <textarea id="rw-embed-code" readonly class="form-input" rows="9" style="font-family: monospace; font-size: 0.76rem; background: #0f172a; color: #e2e8f0; border-radius: 10px; padding: 0.85rem; margin-top: 0.5rem;">${escapeHtml(snippet)}</textarea>
          <div style="margin-top: 0.65rem; display: flex; justify-content: flex-end;">
            <button type="button" id="rw-copy-embed" class="btn btn-primary" style="background:#059669; border-color:#059669; padding: 0.52rem 1rem; font-weight: 700; font-size: 0.8rem;">
              <i class="ri-file-copy-2-line"></i> Copiar Código HTML Iframe
            </button>
          </div>
        </div>

        <div class="rw-card" style="background: #f8fafc;">
          <h3 class="rw-card-title"><i class="ri-global-line" style="color:#475569;"></i> Enlace Portal Multimarca Stocka</h3>
          <p style="font-size: 0.78rem; color: var(--color-text-muted); margin: -0.35rem 0 0.65rem;">
            En el portal general de Stocka, un comprador que valide su correo puede consultar pedidos realizados en cualquiera de los comercios sellers de Stocka:
          </p>
          <code style="display: block; padding: 0.55rem 0.8rem; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 0.78rem;">${escapeHtml(globalUrl)}</code>
        </div>
      `;
      bindEmbedEvents();
    }
  }

  function renderRightPreview() {
    const right = container.querySelector('#rw-right-pane');
    if (!right) return;
    const primary = state.primary_color || '#5c24ff';
    const bg = state.background_color === 'transparent' ? '#f8fafc' : (state.background_color || '#f8fafc');
    const brand = state.brand_name || state.comercio || 'Tu Tienda';
    const m = state.enabled_methods || {};

    const previewFieldsHtml = (state.form_schema || []).slice(0, 5).map(fld => {
      const reqStar = fld.required ? '<span style="color:#ef4444;">*</span>' : '';
      return `
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 0.75rem; margin-bottom: 0.6rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.4rem;">
            <div style="font-weight: 700; font-size: 0.78rem; color: #0f172a;">${escapeHtml(fld.label || 'Campo sin título')} ${reqStar}</div>
            <span style="font-size: 0.65rem; background: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 99px; font-weight: 700;">
              ${fld.scope === 'per_item' ? 'Por unidad' : 'General'}
            </span>
          </div>
          ${fld.instructions ? `<div style="font-size: 0.71rem; color: #64748b; margin-top: 3px; line-height: 1.35;">${escapeHtml(fld.instructions)}</div>` : ''}
          ${fld.reference_image_url ? `
            <div style="margin-top: 0.45rem; display: inline-flex; align-items: center; gap: 0.45rem; background: #f8fafc; border: 1px solid #e2e8f0; padding: 4px 8px; border-radius: 8px;">
              <img src="${escapeHtml(fld.reference_image_url)}" alt="Ejemplo" style="width: 34px; height: 34px; object-fit: cover; border-radius: 5px;">
              <span style="font-size: 0.68rem; font-weight: 700; color: ${escapeHtml(primary)};">Foto guía visible al cliente</span>
            </div>
          ` : ''}
          ${fld.type === 'photo_upload' ? `
            <div style="margin-top: 0.5rem; border: 1.5px dashed #cbd5e1; border-radius: 8px; padding: 0.55rem; text-align: center; font-size: 0.72rem; color: #64748b;">
              <i class="ri-camera-lens-line" style="color:${escapeHtml(primary)};"></i> Toca para subir hasta ${fld.max_files || 3} foto(s)
            </div>
          ` : fld.type === 'video_upload' ? `
            <div style="margin-top: 0.5rem; border: 1.5px dashed #fbcfe8; background: #fdf2f8; border-radius: 8px; padding: 0.55rem; text-align: center; font-size: 0.72rem; color: #be185d;">
              <i class="ri-video-upload-line"></i> Subir video corto MP4/MOV (máx ${fld.max_mb || 35} MB)
            </div>
          ` : fld.type === 'checkbox_confirm' ? `
            <div style="margin-top: 0.4rem; font-size: 0.72rem; color: #334155; display: flex; align-items: center; gap: 0.35rem;">
              <span style="width: 14px; height: 14px; border: 1.5px solid ${escapeHtml(primary)}; border-radius: 4px; display: inline-block;"></span> Casilla de confirmación
            </div>
          ` : fld.type === 'bank_details_cl' ? `
            <div style="margin-top: 0.45rem; display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:4px 7px;font-size:0.68rem;color:#94a3b8;">Banco / Tipo Cuenta</div>
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:4px 7px;font-size:0.68rem;color:#94a3b8;">RUT Validado + N° Cuenta</div>
            </div>
          ` : fld.type !== 'info_banner' ? `
            <div style="margin-top: 0.45rem; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:5px 8px; font-size:0.7rem; color:#94a3b8;">Respuesta del comprador...</div>
          ` : ''}
        </div>
      `;
    }).join('');

    right.innerHTML = `
      <div class="rw-card" style="padding: 1rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem;">
          <span style="font-size: 0.78rem; font-weight: 800; color: var(--color-text-main); display: flex; align-items: center; gap: 0.4rem;">
            <span style="width: 8px; height: 8px; border-radius: 50%; background: #10b981; display: inline-block;"></span>
            Vista Previa Interactiva
          </span>
          <div style="display: inline-flex; background: #f1f5f9; border-radius: 8px; padding: 2px;">
            <button type="button" class="rw-prev-mode" data-pmode="login" style="border:none; padding: 4px 9px; border-radius: 6px; font-size: 0.72rem; font-weight: 700; cursor: pointer; background: ${previewMode === 'login' ? '#fff' : 'transparent'}; color: ${previewMode === 'login' ? '#0f172a' : '#64748b'};">Acceso OTP</button>
            <button type="button" class="rw-prev-mode" data-pmode="form" style="border:none; padding: 4px 9px; border-radius: 6px; font-size: 0.72rem; font-weight: 700; cursor: pointer; background: ${previewMode === 'form' ? '#fff' : 'transparent'}; color: ${previewMode === 'form' ? '#0f172a' : '#64748b'};">Formulario & Reglas</button>
          </div>
        </div>

        <div style="border: 1px solid #cbd5e1; border-radius: 14px; overflow: hidden; background: ${escapeHtml(bg)};">
          <div style="background: #f1f5f9; padding: 0.45rem 0.75rem; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; gap: 0.4rem;">
            <span style="width:9px;height:9px;border-radius:50%;background:#f87171;"></span>
            <span style="width:9px;height:9px;border-radius:50%;background:#fbbf24;"></span>
            <span style="width:9px;height:9px;border-radius:50%;background:#34d399;"></span>
            <span style="margin-left: 0.4rem; font-size: 0.68rem; font-family: monospace; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${escapeHtml(getDirectStoreUrl())}
            </span>
          </div>

          <div style="padding: 1.15rem;">
            <div style="text-align: center; margin-bottom: 0.95rem;">
              ${state.logo_url
                ? `<img src="${escapeHtml(state.logo_url)}" alt="Logo" style="max-height: 38px; max-width: 150px; object-fit: contain; margin-bottom: 0.4rem;">`
                : `<div style="display:inline-flex;align-items:center;gap:0.35rem;background:${escapeHtml(primary)}15;color:${escapeHtml(primary)};padding:0.25rem 0.7rem;border-radius:99px;font-weight:800;font-size:0.74rem;margin-bottom:0.4rem;"><i class="ri-store-2-line"></i> ${escapeHtml(brand)}</div>`
              }
              <div style="font-weight: 800; font-size: 1.02rem; color: #0f172a;">${escapeHtml(state.hero_title)}</div>
              <div style="font-size: 0.74rem; color: #64748b; margin-top: 2px;">${escapeHtml(state.hero_subtitle)}</div>
            </div>

            ${state.policy_summary_text ? `
              <div style="background: #ffffff; border-left: 3px solid ${escapeHtml(primary)}; border-radius: 8px; padding: 0.55rem 0.75rem; font-size: 0.72rem; color: #334155; margin-bottom: 0.85rem; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
                ${escapeHtml(state.policy_summary_text)}
              </div>
            ` : ''}

            ${previewMode === 'login' ? `
              <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1rem;">
                <label style="font-size: 0.74rem; font-weight: 700; color: #0f172a; display: block; margin-bottom: 4px;">Correo electrónico de tu compra</label>
                <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 0.52rem 0.75rem; font-size: 0.76rem; color: #94a3b8; margin-bottom: 0.65rem;">
                  cliente@correo.cl
                </div>
                <div style="background: ${escapeHtml(primary)}; color: #fff; text-align: center; padding: 0.55rem; border-radius: 8px; font-weight: 800; font-size: 0.78rem;">
                  Enviar Código de Verificación (6 dígitos)
                </div>
              </div>
            ` : `
              <div style="display: flex; gap: 0.35rem; flex-wrap: wrap; margin-bottom: 0.75rem;">
                ${state.enable_exchanges ? `<span style="background:${escapeHtml(primary)};color:#fff;padding:4px 9px;border-radius:99px;font-size:0.7rem;font-weight:700;"><i class="ri-exchange-line"></i> Cambio (${state.exchange_window_days}d)</span>` : ''}
                ${state.enable_returns ? `<span style="background:#ffffff;border:1px solid #cbd5e1;color:#334155;padding:4px 9px;border-radius:99px;font-size:0.7rem;font-weight:700;">Devolución (${state.return_window_days}d)</span>` : ''}
                ${state.enable_store_credit ? `<span style="background:#ecfdf5;border:1px solid #6ee7b7;color:#065f46;padding:4px 9px;border-radius:99px;font-size:0.7rem;font-weight:800;">Crédito +${state.store_credit_bonus_pct}%</span>` : ''}
              </div>

              <div>
                ${previewFieldsHtml}
                ${(state.form_schema || []).length > 5 ? `<div style="text-align:center;font-size:0.7rem;color:#64748b;">+ ${(state.form_schema || []).length - 5} campo(s) adicional(es)</div>` : ''}
              </div>

              <div style="margin-top: 0.75rem; padding-top: 0.65rem; border-top: 1px solid #e2e8f0; display: flex; gap: 0.35rem; flex-wrap: wrap;">
                ${m.sucursal_nunoa !== false ? `<span style="font-size:0.66rem;background:#ede9fe;color:#5b21b6;padding:3px 7px;border-radius:6px;font-weight:700;">Punto Stocka Ñuñoa</span>` : ''}
                ${m.rm_simultaneous_swap !== false ? `<span style="font-size:0.66rem;background:#dcfce7;color:#166534;padding:3px 7px;border-radius:6px;font-weight:700;">Swap RM ($${Number(state.rm_swap_fee_clp).toLocaleString('es-CL')})</span>` : ''}
                ${m.regiones_courier !== false ? `<span style="font-size:0.66rem;background:#dbeafe;color:#1e40af;padding:3px 7px;border-radius:6px;font-weight:700;">Regiones Envíame</span>` : ''}
                ${m.user_own_shipping !== false ? `<span style="font-size:0.66rem;background:#f1f5f9;color:#475569;padding:3px 7px;border-radius:6px;font-weight:700;">Envío Propio</span>` : ''}
              </div>
            `}
          </div>
        </div>
      </div>
    `;

    right.querySelectorAll('.rw-prev-mode').forEach(btn => {
      btn.addEventListener('click', () => {
        previewMode = btn.getAttribute('data-pmode') || 'form';
        renderRightPreview();
      });
    });
  }

  function bindShellEvents() {
    const sel = container.querySelector('#rw-select-commerce');
    if (sel) {
      sel.addEventListener('change', async () => {
        window.activeReturnsCommerce = sel.value;
        state = await loadReturnPortalConfig(window.activeReturnsCommerce);
        renderFullLayout();
      });
    }

    const backBtn = container.querySelector('#rw-btn-back-returns');
    if (backBtn && typeof options.onBackToReturns === 'function') {
      backBtn.addEventListener('click', () => options.onBackToReturns());
    }

    container.querySelectorAll('.rw-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.getAttribute('data-rw-tab') || 'design';
        if (activeTab === 'design') previewMode = 'login';
        if (activeTab === 'form' || activeTab === 'rules' || activeTab === 'logistics') previewMode = 'form';
        renderFullLayout();
      });
    });

    const saveBtn = container.querySelector('#rw-btn-save-top');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        if (!state.enable_exchanges && !state.enable_returns && !state.enable_store_credit) {
          alert('Debes habilitar al menos una opción de resolución (Cambio, Devolución o Crédito en Tienda).');
          return;
        }
        const origHtml = saveBtn.innerHTML;
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Guardando...';
        try {
          const saved = await saveReturnPortalConfig(window.activeReturnsCommerce, state);
          state = { ...state, ...saved };
          renderFullLayout();
          if (window.Swal) {
            window.Swal.fire({
              icon: 'success',
              title: 'Portal Actualizado',
              text: `La configuración y formulario dinámico de ${window.activeReturnsCommerce} ya están activos en línea.`,
              timer: 2400,
              showConfirmButton: false
            });
          } else {
            alert('Configuración guardada exitosamente.');
          }
        } catch (err) {
          alert('Error al guardar configuración: ' + (err.message || err));
          saveBtn.disabled = false;
          saveBtn.innerHTML = origHtml;
        }
      });
    }
  }

  function bindDesignEvents() {
    const bindInput = (selector, key, transform) => {
      const el = container.querySelector(selector);
      if (!el) return;
      el.addEventListener('input', () => {
        state[key] = transform ? transform(el.value) : el.value;
        renderRightPreview();
      });
    };

    const chkEnabled = container.querySelector('#rw-is-enabled');
    if (chkEnabled) chkEnabled.addEventListener('change', () => { state.is_enabled = chkEnabled.checked; });

    bindInput('#rw-brand-name', 'brand_name');
    bindInput('#rw-slug', 'slug', v => slugifyCommerce(v));
    bindInput('#rw-logo-url', 'logo_url');
    bindInput('#rw-hero-title', 'hero_title');
    bindInput('#rw-hero-subtitle', 'hero_subtitle');
    bindInput('#rw-policy-text', 'policy_summary_text');
    bindInput('#rw-support-wa', 'support_wa');
    bindInput('#rw-support-email', 'support_email');

    const picker = container.querySelector('#rw-primary-color');
    const hex = container.querySelector('#rw-primary-hex');
    if (picker && hex) {
      picker.addEventListener('input', () => {
        state.primary_color = picker.value;
        hex.value = picker.value;
        renderRightPreview();
      });
      hex.addEventListener('input', () => {
        if (/^#[0-9a-fA-F]{6}$/.test(hex.value)) {
          state.primary_color = hex.value;
          picker.value = hex.value;
          renderRightPreview();
        }
      });
    }

    container.querySelectorAll('.rw-color-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        const c = sw.getAttribute('data-color');
        state.primary_color = c;
        if (picker) picker.value = c;
        if (hex) hex.value = c;
        renderRightPreview();
      });
    });

    const bgSel = container.querySelector('#rw-bg-color');
    if (bgSel) {
      bgSel.addEventListener('change', () => {
        state.background_color = bgSel.value;
        renderRightPreview();
      });
    }

    const logoFile = container.querySelector('#rw-logo-upload-file');
    if (logoFile) {
      logoFile.addEventListener('change', async () => {
        const file = logoFile.files?.[0];
        if (!file) return;
        try {
          const url = await uploadGuideAsset(state.slug || state.comercio, file, 'logos');
          state.logo_url = url;
          renderLeftTab();
          renderRightPreview();
        } catch (err) {
          alert('No se pudo subir el logo: ' + (err.message || err));
        }
      });
    }
  }

  function bindRulesEvents() {
    const bindChk = (sel, key, rerenderLeft = false) => {
      const el = container.querySelector(sel);
      if (!el) return;
      el.addEventListener('change', () => {
        state[key] = el.checked;
        if (rerenderLeft) renderLeftTab();
        renderRightPreview();
      });
    };

    bindChk('#rw-enable-exchange', 'enable_exchanges');
    bindChk('#rw-enable-return', 'enable_returns');
    bindChk('#rw-enable-credit', 'enable_store_credit', true);
    bindChk('#rw-even-variant', 'allow_even_variant_exchange');
    bindChk('#rw-catalog-exchange', 'allow_catalog_exchange');
    bindChk('#rw-require-delivered', 'require_delivered_status');

    const bonus = container.querySelector('#rw-credit-bonus');
    if (bonus) bonus.addEventListener('input', () => { state.store_credit_bonus_pct = Number(bonus.value) || 0; renderRightPreview(); });

    const exDays = container.querySelector('#rw-exchange-days');
    if (exDays) exDays.addEventListener('input', () => { state.exchange_window_days = parseInt(exDays.value, 10) || 30; renderRightPreview(); });

    const retDays = container.querySelector('#rw-return-days');
    if (retDays) retDays.addEventListener('input', () => { state.return_window_days = parseInt(retDays.value, 10) || 10; renderRightPreview(); });

    const exSkus = container.querySelector('#rw-excluded-skus');
    if (exSkus) exSkus.addEventListener('input', () => {
      state.excluded_skus = exSkus.value.split(',').map(s => s.trim()).filter(Boolean);
    });

    const payLink = container.querySelector('#rw-payment-link');
    if (payLink) payLink.addEventListener('input', () => { state.payment_link_url = payLink.value; });

    const payInst = container.querySelector('#rw-payment-instructions');
    if (payInst) payInst.addEventListener('input', () => { state.payment_instructions = payInst.value; });
  }

  function bindLogisticsEvents() {
    state.enabled_methods = state.enabled_methods || {};

    const bindMethod = (sel, mKey, rerenderLeft = false) => {
      const el = container.querySelector(sel);
      if (!el) return;
      el.addEventListener('change', () => {
        state.enabled_methods[mKey] = el.checked;
        if (rerenderLeft) renderLeftTab();
        renderRightPreview();
      });
    };

    bindMethod('#rw-allow-nunoa', 'sucursal_nunoa');
    bindMethod('#rw-allow-rm-swap', 'rm_simultaneous_swap', true);
    bindMethod('#rw-allow-rm-pickup', 'rm_pickup', true);
    bindMethod('#rw-allow-regiones', 'regiones_courier', true);
    bindMethod('#rw-allow-own', 'user_own_shipping');

    const bindChk = (sel, key) => {
      const el = container.querySelector(sel);
      if (!el) return;
      el.addEventListener('change', () => {
        state[key] = el.checked;
        renderRightPreview();
      });
    };

    bindChk('#rw-auto-enviame', 'auto_generate_enviame_label');
    bindChk('#rw-free-fault', 'free_shipping_on_fault');
    bindChk('#rw-shopify-ret', 'shopify_create_return');
    bindChk('#rw-woo-notes', 'woocommerce_add_order_notes');
    bindChk('#rw-woo-rep', 'woocommerce_create_replacement_order');

    const syncModeSel = container.querySelector('#rw-channel-sync-mode');
    if (syncModeSel) syncModeSel.addEventListener('change', () => { state.channel_sync_mode = syncModeSel.value; });

    const bindNum = (sel, key) => {
      const el = container.querySelector(sel);
      if (!el) return;
      el.addEventListener('input', () => {
        state[key] = Math.max(0, Math.round(Number(el.value) || 0));
        renderRightPreview();
      });
    };

    bindNum('#rw-rm-swap-fee', 'rm_swap_fee_clp');
    bindNum('#rw-rm-pickup-fee', 'rm_shipping_fee_clp');
    bindNum('#rw-regiones-flat', 'regiones_flat_fee_clp');

    const regMode = container.querySelector('#rw-regiones-mode');
    if (regMode) {
      regMode.addEventListener('change', () => {
        state.regiones_fee_mode = regMode.value;
        renderLeftTab();
        renderRightPreview();
      });
    }
  }

  function bindFormBuilderEvents() {
    container.querySelectorAll('.rw-preset-card').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-preset');
        const preset = INDUSTRY_FORM_PRESETS[key];
        if (!preset) return;
        state.custom_reasons = JSON.parse(JSON.stringify(preset.reasons));
        state.form_schema = JSON.parse(JSON.stringify(preset.schema));
        renderFullLayout();
      });
    });

    const addReasonBtn = container.querySelector('#rw-btn-add-reason');
    if (addReasonBtn) {
      addReasonBtn.addEventListener('click', () => {
        state.custom_reasons = state.custom_reasons || [];
        state.custom_reasons.push({
          id: 'motivo_' + Date.now().toString(36),
          label: 'Nuevo motivo de cambio o devolución',
          applies_to: ['exchange', 'return', 'store_credit'],
          is_fault: false,
          active: true
        });
        renderLeftTab();
      });
    }

    container.querySelectorAll('.rw-reason-label').forEach(inp => {
      inp.addEventListener('input', () => {
        const idx = Number(inp.getAttribute('data-ridx'));
        if (state.custom_reasons[idx]) state.custom_reasons[idx].label = inp.value;
      });
    });

    container.querySelectorAll('.rw-reason-applies').forEach(sel => {
      sel.addEventListener('change', () => {
        const idx = Number(sel.getAttribute('data-ridx'));
        if (!state.custom_reasons[idx]) return;
        if (sel.value === 'exchange_only') state.custom_reasons[idx].applies_to = ['exchange', 'store_credit'];
        else if (sel.value === 'return_only') state.custom_reasons[idx].applies_to = ['return'];
        else state.custom_reasons[idx].applies_to = ['exchange', 'return', 'store_credit'];
      });
    });

    container.querySelectorAll('.rw-reason-fault').forEach(chk => {
      chk.addEventListener('change', () => {
        const idx = Number(chk.getAttribute('data-ridx'));
        if (state.custom_reasons[idx]) {
          state.custom_reasons[idx].is_fault = chk.checked;
          renderLeftTab();
        }
      });
    });

    container.querySelectorAll('.rw-reason-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-ridx'));
        state.custom_reasons.splice(idx, 1);
        renderLeftTab();
      });
    });

    container.querySelectorAll('.rw-quick-add').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.getAttribute('data-qtype') || 'photo_upload';
        state.form_schema = state.form_schema || [];
        const defaultLabels = {
          photo_upload: 'Sube una foto clara del producto',
          video_upload: 'Sube un video corto mostrando el detalle',
          info_banner: 'Instrucción importante para preparar tu producto',
          text: 'Ingresa el dato solicitado'
        };
        state.form_schema.push({
          id: 'fld_' + Date.now().toString(36),
          type,
          scope: type === 'info_banner' ? 'per_request' : 'per_item',
          label: defaultLabels[type] || 'Nuevo campo',
          instructions: '',
          reference_image_url: '',
          required: type !== 'info_banner',
          min_files: type === 'photo_upload' ? 1 : 0,
          max_files: type === 'photo_upload' ? 3 : 1,
          max_mb: type === 'video_upload' ? 35 : 15,
          options: [],
          show_when: { resolution_types: ['exchange', 'return', 'store_credit'], reason_ids: [] }
        });
        renderFullLayout();
      });
    });

    container.querySelectorAll('.rw-fld-up').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-fidx'));
        if (idx > 0) {
          const tmp = state.form_schema[idx - 1];
          state.form_schema[idx - 1] = state.form_schema[idx];
          state.form_schema[idx] = tmp;
          renderFullLayout();
        }
      });
    });

    container.querySelectorAll('.rw-fld-down').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-fidx'));
        if (idx < state.form_schema.length - 1) {
          const tmp = state.form_schema[idx + 1];
          state.form_schema[idx + 1] = state.form_schema[idx];
          state.form_schema[idx] = tmp;
          renderFullLayout();
        }
      });
    });

    container.querySelectorAll('.rw-fld-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-fidx'));
        state.form_schema.splice(idx, 1);
        renderFullLayout();
      });
    });

    container.querySelectorAll('.rw-fld-type').forEach(sel => {
      sel.addEventListener('change', () => {
        const idx = Number(sel.getAttribute('data-fidx'));
        const f = state.form_schema[idx];
        if (!f) return;
        f.type = sel.value;
        if (f.type === 'bank_details_cl' || f.type === 'info_banner') f.scope = 'per_request';
        if (f.type === 'info_banner') f.required = false;
        renderLeftTab();
        renderRightPreview();
      });
    });

    container.querySelectorAll('.rw-fld-scope').forEach(sel => {
      sel.addEventListener('change', () => {
        const idx = Number(sel.getAttribute('data-fidx'));
        if (state.form_schema[idx]) {
          state.form_schema[idx].scope = sel.value;
          renderRightPreview();
        }
      });
    });

    container.querySelectorAll('.rw-fld-label').forEach(inp => {
      inp.addEventListener('input', () => {
        const idx = Number(inp.getAttribute('data-fidx'));
        if (state.form_schema[idx]) {
          state.form_schema[idx].label = inp.value;
          renderRightPreview();
        }
      });
    });

    container.querySelectorAll('.rw-fld-instructions').forEach(inp => {
      inp.addEventListener('input', () => {
        const idx = Number(inp.getAttribute('data-fidx'));
        if (state.form_schema[idx]) {
          state.form_schema[idx].instructions = inp.value;
          renderRightPreview();
        }
      });
    });

    container.querySelectorAll('.rw-fld-options').forEach(inp => {
      inp.addEventListener('input', () => {
        const idx = Number(inp.getAttribute('data-fidx'));
        if (state.form_schema[idx]) {
          state.form_schema[idx].options = inp.value.split(',').map(s => s.trim()).filter(Boolean);
        }
      });
    });

    container.querySelectorAll('.rw-fld-refimg').forEach(inp => {
      inp.addEventListener('input', () => {
        const idx = Number(inp.getAttribute('data-fidx'));
        if (state.form_schema[idx]) {
          state.form_schema[idx].reference_image_url = inp.value.trim();
          renderRightPreview();
        }
      });
    });

    container.querySelectorAll('.rw-fld-upload-guide').forEach(fileInp => {
      fileInp.addEventListener('change', async () => {
        const idx = Number(fileInp.getAttribute('data-fidx'));
        const file = fileInp.files?.[0];
        if (!file || !state.form_schema[idx]) return;
        try {
          const publicUrl = await uploadGuideAsset(state.slug || state.comercio, file, 'guides');
          state.form_schema[idx].reference_image_url = publicUrl;
          renderLeftTab();
          renderRightPreview();
        } catch (err) {
          alert('Error subiendo imagen guía: ' + (err.message || err));
        }
      });
    });

    container.querySelectorAll('.rw-fld-maxfiles').forEach(inp => {
      inp.addEventListener('input', () => {
        const idx = Number(inp.getAttribute('data-fidx'));
        if (state.form_schema[idx]) {
          state.form_schema[idx].max_files = Math.max(1, Math.min(5, parseInt(inp.value, 10) || 3));
          renderRightPreview();
        }
      });
    });

    container.querySelectorAll('.rw-fld-req').forEach(chk => {
      chk.addEventListener('change', () => {
        const idx = Number(chk.getAttribute('data-fidx'));
        if (state.form_schema[idx]) {
          state.form_schema[idx].required = chk.checked;
          renderRightPreview();
        }
      });
    });

    container.querySelectorAll('.rw-fld-when-res').forEach(sel => {
      sel.addEventListener('change', () => {
        const idx = Number(sel.getAttribute('data-fidx'));
        const f = state.form_schema[idx];
        if (!f) return;
        f.show_when = f.show_when || { resolution_types: ['exchange', 'return', 'store_credit'], reason_ids: [] };
        if (sel.value === 'all') f.show_when.resolution_types = ['exchange', 'return', 'store_credit'];
        else f.show_when.resolution_types = [sel.value];
      });
    });

    container.querySelectorAll('.rw-fld-when-reason').forEach(sel => {
      sel.addEventListener('change', () => {
        const idx = Number(sel.getAttribute('data-fidx'));
        const f = state.form_schema[idx];
        if (!f) return;
        f.show_when = f.show_when || { resolution_types: ['exchange', 'return', 'store_credit'], reason_ids: [] };
        if (!sel.value) {
          f.show_when.reason_ids = [];
        } else if (sel.value === '__faults__') {
          f.show_when.reason_ids = (state.custom_reasons || []).filter(r => r.is_fault).map(r => r.id);
        } else {
          f.show_when.reason_ids = [sel.value];
        }
      });
    });
  }

  function bindEmbedEvents() {
    const copyUrlBtn = container.querySelector('#rw-copy-store-url');
    if (copyUrlBtn) {
      copyUrlBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(getDirectStoreUrl());
          copyUrlBtn.innerHTML = '<i class="ri-check-line"></i> ¡Link Copiado!';
          setTimeout(() => { copyUrlBtn.innerHTML = '<i class="ri-file-copy-line"></i> Copiar Link'; }, 2000);
        } catch (_) {}
      });
    }

    const copyEmbedBtn = container.querySelector('#rw-copy-embed');
    if (copyEmbedBtn) {
      copyEmbedBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(getEmbedHtmlSnippet());
          copyEmbedBtn.innerHTML = '<i class="ri-check-line"></i> ¡Código HTML Copiado!';
          setTimeout(() => { copyEmbedBtn.innerHTML = '<i class="ri-file-copy-2-line"></i> Copiar Código HTML Iframe'; }, 2000);
        } catch (_) {}
      });
    }
  }

  renderFullLayout();
}
