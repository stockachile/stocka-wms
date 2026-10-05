// js/agendas_grid.js - Módulo de Gestión de Agendas con Grilla Interactiva Estilo Excel para WMS STOCKA

(function() {
  'use strict';

  // ==========================================================================
  // 1. Estado Global de la Grilla de Agendas
  // ==========================================================================
  window.agendasGridState = {
    activeCell: null,           // { rowIndex, colKey, orderId, value }
    dragState: {
      isDragging: false,
      startRowIndex: -1,
      currentEndRowIndex: -1,
      colKey: null,
      sourceValue: null
    },
    columnFilters: {},          // { colKey: Set of allowed string values }
    searchQuery: '',
    filteredOrders: [],
    selectedOrderIds: new Set(), // Set de IDs de pedidos seleccionados para despacho Optiroute
    sortConfig: { colKey: 'fecha', direction: 'desc' },
    isSaving: false
  };

  // ==========================================================================
  // 1.b Catálogo de las 36 Comunas de RM y Cobertura STK (Sub-cobertura)
  // ==========================================================================
  const RM_36_COMMUNES = [
    { key: 'cerrillos', name: 'Cerrillos' },
    { key: 'cerro navia', name: 'Cerro Navia' },
    { key: 'colina', name: 'Colina' },
    { key: 'conchali', name: 'Conchalí' },
    { key: 'el bosque', name: 'El Bosque' },
    { key: 'estacion central', name: 'Estación Central' },
    { key: 'huechuraba', name: 'Huechuraba' },
    { key: 'independencia', name: 'Independencia' },
    { key: 'la cisterna', name: 'La Cisterna' },
    { key: 'la florida', name: 'La Florida' },
    { key: 'la granja', name: 'La Granja' },
    { key: 'la pintana', name: 'La Pintana' },
    { key: 'la reina', name: 'La Reina' },
    { key: 'las condes', name: 'Las Condes' },
    { key: 'lo barnechea', name: 'Lo Barnechea' },
    { key: 'lo espejo', name: 'Lo Espejo' },
    { key: 'lo prado', name: 'Lo Prado' },
    { key: 'macul', name: 'Macul' },
    { key: 'maipu', name: 'Maipú' },
    { key: 'nunoa', name: 'Ñuñoa' },
    { key: 'padre hurtado', name: 'Padre Hurtado' },
    { key: 'pedro aguirre cerda', name: 'Pedro Aguirre Cerda' },
    { key: 'penalolen', name: 'Peñalolén' },
    { key: 'providencia', name: 'Providencia' },
    { key: 'pudahuel', name: 'Pudahuel' },
    { key: 'puente alto', name: 'Puente Alto' },
    { key: 'quilicura', name: 'Quilicura' },
    { key: 'quinta normal', name: 'Quinta Normal' },
    { key: 'recoleta', name: 'Recoleta' },
    { key: 'renca', name: 'Renca' },
    { key: 'san bernardo', name: 'San Bernardo' },
    { key: 'san joaquin', name: 'San Joaquín' },
    { key: 'san miguel', name: 'San Miguel' },
    { key: 'san ramon', name: 'San Ramón' },
    { key: 'santiago', name: 'Santiago' },
    { key: 'vitacura', name: 'Vitacura' }
  ];

  window.RM_36_COMMUNES = RM_36_COMMUNES;

  // ==========================================================================
  // 1.c Catálogo Oficial de los 45 Proveedores Registrados en Optiroute
  // ==========================================================================
  const OPTIROUTE_SUPPLIERS = [
    'AIRPURE',
    'ANACONDA HAITI',
    'ANLU STORE',
    'AQUALAT',
    'ASTERFAIRO',
    'B4LIFE',
    'BACK IN TIME',
    'BE NATIVE',
    'BLESSNUSS',
    'CROMO',
    'DG ORAL CARE',
    'DORMILONES',
    'EL MUNDO DEL CAFE',
    'FORTE MAX',
    'FRUTZ',
    'GLOSS',
    'GRANJA MAGDALENA PET',
    'LA MANTA CHILENA',
    'LAQU',
    'LIVROS',
    'LUTAI',
    'MAESE',
    'MAGIC MAKEUP',
    'MARINA VITAL',
    'MEDSKILLS',
    'MENPRIME',
    'MMEDD',
    'MUKAVA',
    'NATIVA ELEMENTS',
    'NOMAD',
    'OPARD',
    'POM KIDS',
    'PORTONESAUTOMAT',
    'RCT CHILE',
    'RELAJARTE',
    'RTT DEL SUR',
    'SAGUAROSHOES',
    'SERPA',
    'SILVER FOX',
    'SIMPLEMENTE CAFE',
    'SMILE FOR PETS',
    'STOCKA',
    'STREET GYM',
    'THE SKIN STORE',
    'VITALITYFOODS'
  ];

  window.OPTIROUTE_SUPPLIERS = OPTIROUTE_SUPPLIERS;

  // Mapeo Canónico por defecto de Comercios WMS -> Proveedores oficiales de Optiroute
  const DEFAULT_WMS_TO_OPTIROUTE_MAP = {
    'ANLUSTORE': 'ANLU STORE',
    'JOYAS GLOSS': 'GLOSS',
    'GLOSS JOYAS': 'GLOSS',
    'LAQU & COMPANY': 'LAQU',
    'LAQU SPA': 'LAQU',
    'LAQU': 'LAQU',
    'PORTONES AUTOMAT': 'PORTONESAUTOMAT',
    'PORTONES AUTOMATICOS': 'PORTONESAUTOMAT',
    'SERPA LTDA': 'SERPA',
    'SERPA LIMITADA': 'SERPA',
    'SILVER FOX SPA': 'SILVER FOX',
    'SILVER FOX': 'SILVER FOX',
    'GRANJA MAGDALENA': 'GRANJA MAGDALENA PET',
    'VITALITY FOODS': 'VITALITYFOODS',
    'SAGUARO': 'SAGUAROSHOES',
    'SAGUARO SHOES': 'SAGUAROSHOES',
    'STOCKA STORE TEST': 'STOCKA',
    'STOCKA TEST': 'STOCKA',
    'EL MUNDO DEL CAFÉ': 'EL MUNDO DEL CAFE',
    'EL MUNDO DEL CAFE': 'EL MUNDO DEL CAFE'
  };

  window.DEFAULT_WMS_TO_OPTIROUTE_MAP = DEFAULT_WMS_TO_OPTIROUTE_MAP;

  function resolveComunaNorm(str) {
    if (!str) return '';
    let norm = typeof window.normalizeComunaKey === 'function' 
      ? window.normalizeComunaKey(str) 
      : String(str).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ñ/g, 'n').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    const aliases = {
      'santiago centro': 'santiago',
      'stgo': 'santiago',
      'santiago de chile': 'santiago',
      'valpo': 'valparaiso',
      'vina': 'vina del mar'
    };
    return aliases[norm] || norm;
  }

  function isComunaRM(comunaRaw) {
    const norm = resolveComunaNorm(comunaRaw);
    if (!norm) return false;
    if (typeof window.isAlphaComunaExact === 'function') {
      return window.isAlphaComunaExact(norm);
    }
    return RM_36_COMMUNES.some(c => c.key === norm);
  }

  function isComunaCoberturaStk(comunaRaw) {
    const norm = resolveComunaNorm(comunaRaw);
    if (!norm) return false;
    return window.coberturaStkComunas ? window.coberturaStkComunas.has(norm) : false;
  }

  function computeSuggestedCoverage(order) {
    if (!order) return '';

    // Comuna de destino válida
    const comunaRaw = getOrderFieldValue(order, 'comuna');
    if (!comunaRaw || comunaRaw === 'Por definir' || comunaRaw === '-') return '';

    const norm = resolveComunaNorm(comunaRaw);
    if (!norm) return '';

    // Si es una de las 36 comunas de la RM
    if (isComunaRM(comunaRaw)) {
      if (isComunaCoberturaStk(comunaRaw)) {
        return 'RM-STK';
      }
      return 'RM';
    }

    // Si es una comuna fuera de la RM
    return 'REGIONES';
  }

  function getSupabase() {
    if (window.supabaseClient && typeof window.supabaseClient.from === 'function') {
      return window.supabaseClient;
    }
    if (window.supabaseDb && typeof window.supabaseDb.from === 'function') {
      return window.supabaseDb;
    }
    if (typeof supabase !== 'undefined' && supabase && typeof supabase.from === 'function') {
      return supabase;
    }
    return null;
  }

  function initCoberturaStkComunas() {
    window.coberturaStkComunas = new Set();

    // 1. Cargar desde localStorage para disponibilidad síncrona inmediata
    try {
      const saved = localStorage.getItem('wms_cobertura_stk_comunas');
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr)) {
          window.coberturaStkComunas = new Set(arr);
        }
      }
    } catch (e) {
      console.warn('Error leyendo wms_cobertura_stk_comunas de localStorage:', e);
    }

    // 2. Sincronizar desde Supabase de forma segura y diferida
    const syncFromDb = () => {
      const sb = getSupabase();
      if (!sb) return;
      sb.from('wms_config_options')
        .select('type, value')
        .then(({ data, error }) => {
          if (!error && data) {
            let keys = [];
            const stkRows = data.filter(d => d.type === 'cobertura_stk_comuna');
            if (stkRows.length > 0) {
              keys = stkRows.map(d => d.value);
            } else {
              const marker = data.find(d => d.type === 'keyword_retiro' && d.value && d.value.startsWith('__STK_COMUNAS__:'));
              if (marker) {
                try {
                  const parsed = JSON.parse(marker.value.replace('__STK_COMUNAS__:', ''));
                  if (Array.isArray(parsed)) keys = parsed;
                } catch (e) {
                  console.warn('Error parseando __STK_COMUNAS__:', e);
                }
              }
            }

            if (keys.length > 0 || (data.length > 0 && !localStorage.getItem('wms_cobertura_stk_comunas'))) {
              window.coberturaStkComunas = new Set(keys);
              localStorage.setItem('wms_cobertura_stk_comunas', JSON.stringify(keys));
              
              const badge = document.getElementById('agendas-stk-badge');
              if (badge) badge.textContent = `${keys.length}/36`;
              
              if (typeof refreshTableBodyOnly === 'function') {
                refreshTableBodyOnly();
              }
            }
          }
        })
        .catch(err => console.warn('Error cargando cobertura STK desde Supabase:', err));
    };

    setTimeout(syncFromDb, 300);
  }

  // ==========================================================================
  // 1.d Caché y Resolución de Estados de Ruta Optiroute
  // ==========================================================================
  window.optirouteOrdersStatusCache = new Map();

  async function loadOptirouteOrdersStatusCache() {
    const sb = getSupabase();
    if (!sb) return;
    try {
      // Filtrar solo registros de los últimos 5 días para evitar heredar rutas antiguas terminadas
      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

      const { data, error } = await sb
        .from('optiroute_orders')
        .select('id, referencia, status, raw_data, created_at')
        .gte('created_at', fiveDaysAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(1000);

      if (!error && Array.isArray(data)) {
        window.optirouteOrdersStatusCache.clear();
        data.forEach(row => {
          if (!row.referencia) return;
          const refKey = String(row.referencia).trim().toLowerCase();
          const rawSt = String(row.status || '').toUpperCase().trim();
          const hasDriver = Boolean(
            row.raw_data?.assigned_driver || 
            row.raw_data?.driver || 
            row.raw_data?.waypoint?.route_driver
          );

          let derivedStatus = '';
          if (['SKIPPED', 'CANCELLED', 'DELETED', 'RECHAZADO'].includes(rawSt)) {
            derivedStatus = 'descartado';
          } else if (hasDriver || ['ONROUTE', 'ONGOING', 'ARRIVED', 'DELIVERED', 'COMPLETED'].includes(rawSt)) {
            derivedStatus = 'confirmado';
          } else if (['REVIEWING', 'SCHEDULED', 'IMPORTED', 'CREATED', 'CREADO', 'PENDING'].includes(rawSt)) {
            derivedStatus = 'creado';
          }

          if (derivedStatus && !window.optirouteOrdersStatusCache.has(refKey)) {
            window.optirouteOrdersStatusCache.set(refKey, derivedStatus);
          }
        });
      }
    } catch (e) {
      console.warn('Aviso: no se pudo cargar caché de optiroute_orders:', e);
    }
  }

  // ==========================================================================
  // 1.e Sincronización de Pedidos en RUTAS ACTIVAS de Optiroute
  // Solo se consideran planes con status !== 2 (status 0: en planificación, 1: en ruta)
  // Las rutas terminadas (status 2) son históricas y se ignoran.
  // ==========================================================================
  window.loadOptirouteActiveAssignedRefs = async function(options = {}) {
    const silent = options.silent !== false;
    try {
      const token = await getOptirouteToken();
      if (!token) {
        if (!silent) console.warn('[Optiroute] No se encontró token activo de Optiroute.');
        return window.optirouteActiveAssignedRefs;
      }

      // 1. Obtener planes de ruta recientes (últimos 25 planes)
      const rpRes = await fetch('https://app.optiroute.cl/api/v1/route-plans/?per_page=25', {
        headers: { 'Authorization': `Token ${token}` }
      });
      if (!rpRes.ok) {
        if (!silent) console.warn('[Optiroute] Error al consultar route-plans:', rpRes.status);
        return window.optirouteActiveAssignedRefs;
      }

      const rpData = await rpRes.json();
      const allPlans = rpData.results || rpData || [];

      // Filtrar solo planes ACTIVOS (status !== 2)
      // status 0 = Planificación / Creado / Revisión
      // status 1 = En Ruta / En ejecución
      // status 2 = Finalizado / Terminado (histórico)
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      const activePlans = allPlans.filter(p => {
        const st = Number(p.status);
        if (st === 2 || p.status === '2') return false;
        if (p.departure_datetime) {
          const dep = new Date(p.departure_datetime);
          if (!isNaN(dep.getTime()) && dep < twoDaysAgo) return false;
        }
        return true;
      });

      if (!silent) {
        console.log(`[Optiroute] Rutas activas encontradas (${activePlans.length}):`, activePlans.map(p => `${p.name} [ID:${p.id}, Estado:${p.status}]`));
      }

      const newActiveRefs = new Set();
      const newActiveMap = new Map();

      // 2. Para cada ruta activa, descargar sus waypoints y vehículos asignados
      for (const plan of activePlans) {
        try {
          const detailRes = await fetch(`https://app.optiroute.cl/api/v1/route-plans/${plan.id}/`, {
            headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' }
          });

          if (detailRes.ok) {
            const planDetail = await detailRes.json();
            const routes = planDetail.routes || [];

            if (routes.length > 0) {
              const routePromises = routes.map(async (routeObj) => {
                try {
                  const rRes = await fetch(`https://app.optiroute.cl/api/v1/web-routes/${routeObj.id}/`, {
                    headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' }
                  });
                  if (rRes.ok) {
                    const rData = await rRes.json();
                    const wps = (rData.waypoints || []).filter(w => w.is_customer);
                    const driverName = rData.driver?.first_name 
                      ? `${rData.driver.first_name} ${rData.driver.last_name || ''}`.trim() 
                      : (rData.driver?.name || routeObj.driver?.name || 'Conductor asignado');
                    const vehicleName = rData.vehicle?.license_plate || rData.vehicle?.name || routeObj.vehicle?.license_plate || routeObj.vehicle?.name || '';
                    const rName = rData.name || routeObj.name || plan.name || 'Ruta';
                    const depTime = planDetail.departure_datetime || plan.departure_datetime || null;

                    wps.forEach(wp => {
                      const rawRef = String(wp.service_request?.reference || '').trim();
                      if (rawRef) {
                        const lowRef = rawRef.toLowerCase();
                        newActiveRefs.add(lowRef);
                        const altRef = lowRef.startsWith('#') ? lowRef.substring(1) : ('#' + lowRef);
                        newActiveRefs.add(altRef);

                        const routeInfo = {
                          reference: rawRef,
                          planId: plan.id,
                          planName: plan.name,
                          routeId: routeObj.id,
                          routeName: rName,
                          driver: driverName,
                          vehicle: vehicleName,
                          departureTime: depTime,
                          status: wp.status
                        };
                        newActiveMap.set(lowRef, routeInfo);
                        newActiveMap.set(altRef, routeInfo);
                      }
                    });
                  }
                } catch (errR) {
                  console.warn(`[Optiroute] Error al cargar web-route ${routeObj.id}:`, errR);
                }
              });
              await Promise.all(routePromises);
            }
          }
        } catch (planErr) {
          console.warn(`[Optiroute] Error al consultar detalle del plan ${plan.id}:`, planErr);
        }
      }

      // 3. Actualizar memoria y persistir en localStorage
      window.optirouteActiveAssignedRefs = newActiveRefs;
      window.optirouteActiveAssignedMap = newActiveMap;

      try {
        localStorage.setItem('wms_optiroute_active_assigned_refs', JSON.stringify(Array.from(newActiveRefs)));
        const mapObj = {};
        for (const [k, v] of newActiveMap.entries()) {
          mapObj[k] = v;
        }
        localStorage.setItem('wms_optiroute_active_assigned_map', JSON.stringify(mapObj));
      } catch (lsErr) {}

      // 4. Si la tabla de Torre de Control o Grilla de Agendas está en pantalla, actualizar
      if (typeof window.updateOrderTagFilterOptions === 'function') {
        window.updateOrderTagFilterOptions();
      }
      if (typeof window.applyWmsFiltersAndRender === 'function') {
        window.applyWmsFiltersAndRender();
      } else if (typeof window.renderOrdersTable === 'function' && window.loadedOrders) {
        window.renderOrdersTable();
      }

      return window.optirouteActiveAssignedRefs;
    } catch (e) {
      console.warn('[Optiroute] Error sincronizando referencias activas:', e);
      return window.optirouteActiveAssignedRefs;
    }
  };

  initCoberturaStkComunas();
  if (typeof loadOptirouteMerchantsConfig === 'function') {
    loadOptirouteMerchantsConfig();
  }
  loadOptirouteOrdersStatusCache();
  // Cargar referencias de rutas activas silenciosamente en segundo plano
  setTimeout(() => {
    if (typeof window.loadOptirouteActiveAssignedRefs === 'function') {
      window.loadOptirouteActiveAssignedRefs({ silent: true });
    }
  }, 1000);

  // Definición de las 17 Columnas (con anchos compactos por defecto que caben en 100% de pantalla)
  const COLUMN_DEFS = [
    { key: 'numero_pedido', label: 'N° Pedido', letter: 'A', defaultWidth: 85, editable: false, align: 'left' },
    { key: 'comercio', label: 'Comercio', letter: 'B', defaultWidth: 85, editable: false, align: 'left' },
    { key: 'fecha', label: 'Fecha', letter: 'C', defaultWidth: 75, editable: false, align: 'center' },
    { key: 'hora', label: 'Hora', letter: 'D', defaultWidth: 65, editable: false, align: 'center' },
    { key: 'cliente', label: 'Nombre Cliente', letter: 'E', defaultWidth: 110, editable: false, align: 'left' },
    { key: 'direccion', label: 'Dirección', letter: 'F', defaultWidth: 135, editable: false, align: 'left' },
    { key: 'complemento', label: 'Complemento', letter: 'G', defaultWidth: 95, editable: false, align: 'left' },
    { key: 'comuna', label: 'Comuna', letter: 'H', defaultWidth: 105, editable: true, align: 'left', isSpecial: true },
    { key: 'cobertura_sugerida', label: 'Cobertura Sugerida', letter: 'I', defaultWidth: 95, editable: false, align: 'center' },
    { key: 'estado_pago', label: 'Estado Pago Origen', letter: 'J', defaultWidth: 85, editable: false, align: 'center' },
    { key: 'valor_total', label: 'Valor Total', letter: 'K', defaultWidth: 75, editable: false, align: 'right' },
    { key: 'metodo_envio', label: 'Método de Envío', letter: 'L', defaultWidth: 85, editable: false, align: 'left' },
    { key: 'canal_ventas', label: 'Canal de Ventas', letter: 'M', defaultWidth: 75, editable: false, align: 'center' },
    { key: 'categoria_entrega', label: 'CATEGORÍA', letter: 'N', defaultWidth: 95, editable: true, align: 'center', isSpecial: true },
    { key: 'agenda', label: 'AGENDA', letter: 'O', defaultWidth: 85, editable: true, align: 'center', isSpecial: true },
    { key: 'operador', label: 'OPERADOR', letter: 'P', defaultWidth: 90, editable: true, align: 'center', isSpecial: true },
    { key: 'estado_ruta_optiroute', label: 'RUTA OPTIROUTE', letter: 'Q', defaultWidth: 135, editable: true, align: 'center', isSpecial: true }
  ];

  function getSavedColumnWidth(key, defaultWidth) {
    try {
      const saved = localStorage.getItem('agendas_grid_column_widths');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed[key] === 'number' && parsed[key] >= 40) {
          return parsed[key];
        }
      }
    } catch (e) {
      console.warn('Error reading saved column widths:', e);
    }
    return defaultWidth;
  }

  function saveColumnWidth(key, width) {
    try {
      const saved = localStorage.getItem('agendas_grid_column_widths');
      const parsed = saved ? JSON.parse(saved) : {};
      parsed[key] = Math.round(width);
      localStorage.setItem('agendas_grid_column_widths', JSON.stringify(parsed));
    } catch (e) {
      console.warn('Error saving column width:', e);
    }
  }

  window.resetAgendasColumnWidths = function() {
    localStorage.removeItem('agendas_grid_column_widths');
    window.renderAgendasGrid();
    const toast = Swal.mixin({
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 1500
    });
    toast.fire({
      icon: 'info',
      title: 'Anchos de columnas restablecidos al valor por defecto'
    });
  };

  // ==========================================================================
  // 2. Extracción y Formateo de Datos por Columna
  // ==========================================================================
  function getOrderFieldValue(order, colKey) {
    if (!order) return '';
    switch (colKey) {
      case 'numero_pedido':
        return String(order.external_order_number || order.id || '').trim();

      case 'comercio':
        return String(order.comercio || 'Desconocido').trim();

      case 'fecha': {
        const rawDate = order.fecha_pedido || order.created_at;
        if (!rawDate) return '';
        const d = new Date(rawDate);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });
      }

      case 'hora': {
        const rawDate = order.fecha_pedido || order.created_at;
        if (!rawDate) return '';
        const d = new Date(rawDate);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' });
      }

      case 'cliente': {
        let name = order.customer_name || '';
        if (!name || name === 'No registrado' || name.trim() === '' || name === 'Cliente Jumpseller' || (order.raw_jumpseller_data && !name.includes(' '))) {
          if (order.raw_shopify_data?.billing_address) {
            const b = order.raw_shopify_data.billing_address;
            name = `${b.first_name || ''} ${b.last_name || ''}`.trim();
          } else if (order.raw_shopify_data?.customer) {
            const c = order.raw_shopify_data.customer;
            name = `${c.first_name || ''} ${c.last_name || ''}`.trim();
          } else if (order.raw_jumpseller_data) {
            const raw = order.raw_jumpseller_data;
            const isValidName = s => s && !s.includes('@') && s.toLowerCase() !== 'no registrado' && s.toLowerCase() !== 'cliente jumpseller';
            const sName = [raw.shipping_address?.name || raw.shipping_address?.first_name, raw.shipping_address?.surname || raw.shipping_address?.last_name].filter(Boolean).map(s => String(s).trim()).join(' ').trim();
            const bName = [raw.billing_address?.name || raw.billing_address?.first_name, raw.billing_address?.surname || raw.billing_address?.last_name].filter(Boolean).map(s => String(s).trim()).join(' ').trim();
            const cName = (raw.customer?.fullname || [raw.customer?.name || raw.customer?.first_name, raw.customer?.surname || raw.customer?.last_name].filter(Boolean).map(s => String(s).trim()).join(' ') || '').trim();
            const validShip = isValidName(sName) ? sName : '';
            const validBill = isValidName(bName) ? bName : '';
            const validCust = isValidName(cName) ? cName : '';
            let jumpName = validShip || validBill || validCust;
            if (validShip && !validShip.includes(' ')) {
              if (validCust && validCust.includes(' ') && validCust.toLowerCase().startsWith(validShip.toLowerCase())) jumpName = validCust;
              else if (validBill && validBill.includes(' ') && validBill.toLowerCase().startsWith(validShip.toLowerCase())) jumpName = validBill;
            } else if (validBill && !validBill.includes(' ')) {
              if (validCust && validCust.includes(' ') && validCust.toLowerCase().startsWith(validBill.toLowerCase())) jumpName = validCust;
            }
            if (jumpName) name = jumpName;
          }
        }
        return name || 'No registrado';
      }

      case 'direccion': {
        let addr = order.shipping_address || order.address || '';
        if (!addr && order.raw_shopify_data?.shipping_address?.address1) {
          addr = order.raw_shopify_data.shipping_address.address1;
        } else if (!addr && order.raw_shopify_data?.billing_address?.address1) {
          addr = order.raw_shopify_data.billing_address.address1;
        }
        return String(addr || '-').trim();
      }

      case 'complemento': {
        let comp = order.shipping_complement || order.address_additional || order.depto || '';
        if (!comp && order.raw_shopify_data?.shipping_address?.address2) {
          comp = order.raw_shopify_data.shipping_address.address2;
        } else if (!comp && order.raw_shopify_data?.billing_address?.address2) {
          comp = order.raw_shopify_data.billing_address.address2;
        }
        return String(comp || '-').trim();
      }

      case 'comuna':
        return String(order.shipping_city || order.comuna || 'Por definir').trim();

      case 'cobertura_sugerida':
        return computeSuggestedCoverage(order);

      case 'estado_pago': {
        let rawFin = String(order.raw_shopify_data?.financial_status || order.payment_status || '').toLowerCase().trim();
        const isMarketplace = ['Falabella', 'MercadoLibre', 'Paris', 'Ripley', 'Walmart'].includes(order.external_platform || order.origen);
        if (isMarketplace && order.status !== 'cancelado') {
          if (!['refunded', 'reembolsado', 'partially_refunded', 'parcialmente_reembolsado', 'voided'].includes(rawFin)) {
            rawFin = 'paid';
          }
        }
        if (['paid', 'pagado', 'completed', 'approved'].includes(rawFin)) return 'PAGADO';
        if (['pending', 'pendiente', 'unpaid', 'no pagado'].includes(rawFin)) return 'PENDIENTE';
        if (['partially_refunded', 'parcialmente_reembolsado'].includes(rawFin)) return 'PARCIALMENTE REEMBOLSADO';
        if (['refunded', 'reembolsado'].includes(rawFin)) return 'REEMBOLSADO';
        if (['partially_paid', 'parcialmente_pagado'].includes(rawFin)) return 'PARCIALMENTE PAGADO';
        if (['authorized', 'autorizado'].includes(rawFin)) return 'AUTORIZADO';
        if (['voided', 'anulado', 'cancelado'].includes(rawFin)) return 'ANULADO';
        return rawFin ? rawFin.toUpperCase() : 'PENDIENTE';
      }

      case 'valor_total': {
        const rawVal = order.total_amount || order.total || order.raw_shopify_data?.total_price || 0;
        const num = parseFloat(rawVal) || 0;
        return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(num);
      }

      case 'metodo_envio':
        return String(order.shipping_method || '-').trim();

      case 'canal_ventas':
        return String(order.origen || order.external_platform || 'Manual').trim();

      case 'categoria_entrega':
      case 'categoria':
        if (order.categoria_entrega) {
          const directCat = String(order.categoria_entrega).trim().toUpperCase();
          if (directCat === 'DISTRIBUCION') return 'DISTRIBUCIÓN';
          if (directCat === 'LOGISTICA INVERSA') return 'LOGÍSTICA INVERSA';
          return directCat;
        }
        if (typeof window.getOrderEffectiveCategoriaEntrega === 'function') {
          return window.getOrderEffectiveCategoriaEntrega(order);
        }
        return 'DISTRIBUCIÓN';

      case 'agenda':
        return String(order.agenda || '').trim().toUpperCase();

      case 'operador':
        return String(order.operador || '').trim().toUpperCase();

      case 'estado_ruta_optiroute': {
        // 1. Si está confirmado en una RUTA ACTIVA de Optiroute
        if (typeof window.isOrderOptirouteConfirmado === 'function' && window.isOrderOptirouteConfirmado(order)) {
          return 'confirmado';
        }

        const ref = String(order.external_order_number || order.numero_orden || order.numero_pedido || '').trim().toLowerCase();

        // 2. Si fue descartado en caché reciente
        if (window.optirouteOrdersStatusCache && window.optirouteOrdersStatusCache.has(ref)) {
          const cached = window.optirouteOrdersStatusCache.get(ref);
          if (cached === 'descartado') {
            return 'descartado';
          }
        }

        // 3. Asignación directa en base de datos o memoria
        if (order.estado_ruta_optiroute) {
          const direct = String(order.estado_ruta_optiroute).trim().toLowerCase();
          if (['creado', 'descartado'].includes(direct)) {
            return direct;
          }
          if (direct === 'confirmado') {
            const wmsStatus = String(order.estado_wms || '').trim().toLowerCase();
            const origStatus = String(order.status || '').trim().toLowerCase();
            if (!['despachado', 'cancelado', 'archivado', 'entregado'].includes(wmsStatus) &&
                !['despachado', 'cancelado', 'archivado', 'entregado'].includes(origStatus)) {
              if (window.optirouteActiveAssignedRefs && window.optirouteActiveAssignedRefs.size > 0) {
                return window.optirouteActiveAssignedRefs.has(ref) ? 'confirmado' : 'creado';
              }
              return 'confirmado';
            }
          }
        }

        // 4. Fallback a caché para creado
        if (window.optirouteOrdersStatusCache && window.optirouteOrdersStatusCache.has(ref)) {
          const cached = window.optirouteOrdersStatusCache.get(ref);
          return cached === 'descartado' ? 'descartado' : 'creado';
        }
        return '';
      }

      default:
        return '';
    }
  }

  // ==========================================================================
  // 3. Renderizado de Celda HTML
  // ==========================================================================
  function renderCellHtml(order, col, rowIndex) {
    const rawVal = getOrderFieldValue(order, col.key);
    const orderId = order.id;

    if (col.key === 'categoria_entrega' || col.key === 'categoria') {
      const displayVal = rawVal || 'DISTRIBUCIÓN';
      let badgeClass = 'excel-badge-cat-dist';
      let icon = 'ri-truck-line';
      if (displayVal === 'RETIRO') {
        badgeClass = 'excel-badge-cat-ret';
        icon = 'ri-store-2-line';
      } else if (displayVal === 'LOGÍSTICA INVERSA' || displayVal === 'LOGISTICA INVERSA') {
        badgeClass = 'excel-badge-cat-li';
        icon = 'ri-arrow-left-right-line';
      } else if (displayVal.includes('POS') || displayVal.includes('SHOP POINT')) {
        badgeClass = 'excel-badge-cat-pos';
        icon = 'ri-shopping-cart-2-line';
      }

      return `
        <div class="excel-cell-content excel-cell-dropdown-wrapper" style="text-align: center;">
          <span class="${badgeClass}" style="display: inline-flex; align-items: center; gap: 0.2rem; max-width: calc(100% - 14px); white-space: normal; line-height: 1.15; padding: 0.12rem 0.35rem; font-size: 0.68rem;" title="${displayVal}">
            <i class="${icon}"></i> ${displayVal}
          </span>
          <i class="ri-arrow-down-s-line excel-cell-caret" title="Desplegar opciones de Categoría"></i>
        </div>
      `;
    }

    if (col.key === 'agenda') {
      const displayVal = rawVal || '-';
      const badgeClass = rawVal ? 'excel-badge-agenda' : '';
      return `
        <div class="excel-cell-content excel-cell-dropdown-wrapper" style="text-align: center;">
          ${rawVal ? `<span class="${badgeClass}" style="display: inline-block; max-width: calc(100% - 14px); white-space: normal; line-height: 1.15; padding: 0.12rem 0.35rem; font-size: 0.7rem;">${displayVal}</span>` : `<span style="color: var(--color-text-muted);">-</span>`}
          <i class="ri-arrow-down-s-line excel-cell-caret" title="Desplegar opciones de Agenda"></i>
        </div>
      `;
    }

    if (col.key === 'operador') {
      const displayVal = rawVal || '-';
      const badgeClass = rawVal ? 'excel-badge-operador' : '';
      return `
        <div class="excel-cell-content excel-cell-dropdown-wrapper" style="text-align: center;">
          ${rawVal ? `<span class="${badgeClass}" style="display: inline-block; max-width: calc(100% - 14px); white-space: normal; line-height: 1.15; padding: 0.12rem 0.35rem; font-size: 0.7rem;">${displayVal}</span>` : `<span style="color: var(--color-text-muted);">-</span>`}
          <i class="ri-arrow-down-s-line excel-cell-caret" title="Desplegar opciones de Operador"></i>
        </div>
      `;
    }

    if (col.key === 'estado_ruta_optiroute') {
      const displayVal = (rawVal || '').toLowerCase().trim();
      let badgeHtml = '';
      if (displayVal === 'creado') {
        badgeHtml = `<span class="excel-badge-opti-creado" title="Creado: Es parte de una ruta que se está creando"><i class="ri-route-line"></i> Creado</span>`;
      } else if (displayVal === 'confirmado') {
        badgeHtml = `<span class="excel-badge-opti-confirmado" title="Confirmado: Ya es parte de la ruta de un conductor"><i class="ri-user-follow-line"></i> Confirmado</span>`;
      } else if (displayVal === 'descartado') {
        badgeHtml = `<span class="excel-badge-opti-descartado" title="Descartado: No considerado en ninguna ruta de conductor"><i class="ri-close-circle-line"></i> Descartado</span>`;
      } else {
        badgeHtml = `<span style="color: var(--color-text-muted); font-size: 0.75rem;">-</span>`;
      }

      return `
        <div class="excel-cell-content excel-cell-dropdown-wrapper" style="text-align: center;">
          ${badgeHtml}
          <i class="ri-arrow-down-s-line excel-cell-caret" title="Cambiar estado en ruta Optiroute"></i>
        </div>
      `;
    }

    if (col.key === 'comuna') {
      const displayVal = rawVal || 'Por definir';
      const isPorDefinir = !rawVal || rawVal === 'Por definir' || rawVal === '-';
      return `
        <div class="excel-cell-content excel-cell-dropdown-wrapper" style="text-align: left; justify-content: space-between;">
          <span style="font-weight: 600; font-size: 0.74rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; ${isPorDefinir ? 'color: var(--color-text-muted); font-style: italic;' : 'color: var(--color-text-main);'}" title="${displayVal}">
            ${displayVal}
          </span>
          <i class="ri-arrow-down-s-line excel-cell-caret" title="Desplegar opciones de Comuna"></i>
        </div>
      `;
    }

    if (col.key === 'cobertura_sugerida') {
      const val = rawVal || '';
      if (!val) {
        return `
          <div class="excel-cell-content" style="text-align: center;">
            <span style="color: var(--color-text-muted);">-</span>
          </div>
        `;
      }
      let badgeClass = 'excel-badge-cov-rm';
      if (val === 'RM-STK') badgeClass = 'excel-badge-cov-stk';
      else if (val === 'REGIONES') badgeClass = 'excel-badge-cov-reg';

      return `
        <div class="excel-cell-content" style="text-align: center;">
          <span class="${badgeClass}" title="Cobertura sugerida para pedidos en procesamiento">${val}</span>
        </div>
      `;
    }

    if (col.key === 'estado_pago') {
      let bg = '#e5e7eb';
      let color = '#374151';
      if (rawVal === 'PAGADO') { bg = '#d1fae5'; color = '#065f46'; }
      else if (rawVal === 'PENDIENTE') { bg = '#fef3c7'; color = '#92400e'; }
      else if (rawVal.includes('REEMBOLSADO')) { bg = '#fee2e2'; color = '#991b1b'; }
      else if (rawVal === 'AUTORIZADO') { bg = '#e0f2fe'; color = '#0369a1'; }

      return `
        <div class="excel-cell-content" style="text-align: center;">
          <span style="background:${bg}; color:${color}; padding: 0.12rem 0.35rem; border-radius: 4px; font-weight: 700; font-size: 0.68rem; letter-spacing: 0.02em; display: inline-block; white-space: normal; line-height: 1.15; max-width: 100%;">
            ${rawVal}
          </span>
        </div>
      `;
    }

    if (col.key === 'canal_ventas') {
      const platformLower = (rawVal.toLowerCase() === 'manual' || rawVal.toLowerCase() === 'logística inversa') ? 'stocka.cap' : rawVal.toLowerCase();
      return `
        <div class="excel-cell-content" style="text-align: center; display: flex; align-items: center; justify-content: center; gap: 0.25rem;">
          <img src="./img/${platformLower}.png" alt="${rawVal}" style="height: 16px; max-width: 38px; object-fit: contain;" onerror="this.style.display='none';" />
          <span style="font-size: 0.7rem; font-weight: 600; white-space: normal; line-height: 1.15;">${rawVal}</span>
        </div>
      `;
    }

    if (col.key === 'numero_pedido') {
      return `
        <div class="excel-cell-content" style="font-family: monospace; font-weight: 700; color: var(--color-primary); white-space: nowrap; font-size: 0.76rem;" title="${rawVal}">
          ${rawVal}
        </div>
      `;
    }

    if (col.key === 'fecha') {
      return `
        <div class="excel-cell-content" style="text-align: center; white-space: nowrap; font-size: 0.74rem;" title="${rawVal}">
          ${rawVal}
        </div>
      `;
    }

    if (col.key === 'hora') {
      return `
        <div class="excel-cell-content" style="text-align: center; white-space: nowrap; font-size: 0.74rem; color: var(--color-text-muted);" title="${rawVal}">
          ${rawVal}
        </div>
      `;
    }

    if (col.key === 'valor_total') {
      return `
        <div class="excel-cell-content" style="text-align: right; font-weight: 600; font-family: monospace; white-space: nowrap; font-size: 0.76rem;" title="${rawVal}">
          ${rawVal}
        </div>
      `;
    }

    return `
      <div class="excel-cell-content" style="text-align: ${col.align}; white-space: normal; word-break: break-word; overflow-wrap: break-word; line-height: 1.25;" title="${String(rawVal).replace(/"/g, '&quot;')}">
        ${rawVal}
      </div>
    `;
  }

  // ==========================================================================
  // 4. Regla de Elegibilidad para Gestión de Agendas:
  // Solo se deben mostrar pedidos en estado WMS 'En procesamiento' y 'En preparación'
  // ==========================================================================
  window.isOrderInAgendasAllowedState = function(order) {
    if (!order) return false;

    // 1. Excluir estados terminales o finalizados tanto de status como de estado_wms
    const st = String(order.status || '').toLowerCase().trim();
    const wms = String(order.estado_wms || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

    const terminalStatuses = ['despachado', 'entregado', 'retirado', 'cancelado', 'archivado', 'rechazado'];
    if (terminalStatuses.includes(st) || terminalStatuses.includes(wms)) {
      return false;
    }

    // Excluir si ya fue completado de mesa / pickeado
    if (wms === 'pickeado' || st === 'preparado' || st === 'pickeado') {
      return false;
    }

    // 2. Aceptar estrictamente pedidos en estado "En procesamiento" o "En preparación"
    const isEnProcesamiento = wms.includes('procesamiento') || wms === 'para procesar' || st === 'para procesar' || st.includes('procesamiento');
    const isEnPreparacion = wms.includes('preparacion') || st.includes('preparacion');

    // Si no tiene estado_wms ni status terminal, por convención WMS es procesamiento inicial
    if (!wms && !st) {
      return true;
    }

    return isEnProcesamiento || isEnPreparacion;
  };

  function getEligibleAgendasOrders() {
    const allOrders = window.loadedOrders || [];
    return allOrders.filter(window.isOrderInAgendasAllowedState);
  }

  window.getEligibleAgendasCount = function() {
    return getEligibleAgendasOrders().length;
  };

  function getEligibleOrdersForColFilter(targetColKey) {
    const eligibleOrders = getEligibleAgendasOrders();
    const { searchQuery, columnFilters } = window.agendasGridState;
    const queryNorm = (searchQuery || '').toLowerCase().trim();

    return eligibleOrders.filter(order => {
      // 1. Buscador Global
      if (queryNorm) {
        const idStr = String(order.external_order_number || order.id || '').toLowerCase();
        const clientStr = String(getOrderFieldValue(order, 'cliente')).toLowerCase();
        const addrStr = String(getOrderFieldValue(order, 'direccion')).toLowerCase();
        const compStr = String(getOrderFieldValue(order, 'complemento')).toLowerCase();
        const dateStr = String(getOrderFieldValue(order, 'fecha')).toLowerCase();
        const timeStr = String(getOrderFieldValue(order, 'hora')).toLowerCase();
        const commStr = String(order.comercio || '').toLowerCase();
        const cityStr = String(order.shipping_city || order.comuna || '').toLowerCase();
        const covStr = String(getOrderFieldValue(order, 'cobertura_sugerida') || '').toLowerCase();
        const catStr = String(getOrderFieldValue(order, 'categoria_entrega') || '').toLowerCase();
        const optiRouteStr = String(getOrderFieldValue(order, 'estado_ruta_optiroute') || '').toLowerCase();
        const matchGlobal = idStr.includes(queryNorm) || clientStr.includes(queryNorm) || addrStr.includes(queryNorm) || compStr.includes(queryNorm) || dateStr.includes(queryNorm) || timeStr.includes(queryNorm) || commStr.includes(queryNorm) || cityStr.includes(queryNorm) || covStr.includes(queryNorm) || catStr.includes(queryNorm) || optiRouteStr.includes(queryNorm);
        if (!matchGlobal) return false;
      }

      // 2. Filtros por Columna (evaluando todas excepto la columna que se está filtrando)
      for (const [colKey, allowedSet] of Object.entries(columnFilters)) {
        if (colKey === targetColKey) continue;
        if (!allowedSet) continue;
        const val = getOrderFieldValue(order, colKey);
        if (!allowedSet.has(val)) {
          return false;
        }
      }

      return true;
    });
  }

  // ==========================================================================
  // 4.b Filtrado y Ordenamiento de Datos
  // ==========================================================================
  function computeFilteredOrders() {
    const eligibleOrders = getEligibleAgendasOrders();
    const { searchQuery, columnFilters } = window.agendasGridState;
    const queryNorm = (searchQuery || '').toLowerCase().trim();

    return eligibleOrders.filter(order => {
      // 1. Buscador Global
      if (queryNorm) {
        const idStr = String(order.external_order_number || order.id || '').toLowerCase();
        const clientStr = String(getOrderFieldValue(order, 'cliente')).toLowerCase();
        const addrStr = String(getOrderFieldValue(order, 'direccion')).toLowerCase();
        const compStr = String(getOrderFieldValue(order, 'complemento')).toLowerCase();
        const dateStr = String(getOrderFieldValue(order, 'fecha')).toLowerCase();
        const timeStr = String(getOrderFieldValue(order, 'hora')).toLowerCase();
        const commStr = String(order.comercio || '').toLowerCase();
        const cityStr = String(order.shipping_city || order.comuna || '').toLowerCase();
        const covStr = String(getOrderFieldValue(order, 'cobertura_sugerida') || '').toLowerCase();
        const catStr = String(getOrderFieldValue(order, 'categoria_entrega') || '').toLowerCase();
        const optiRouteStr = String(getOrderFieldValue(order, 'estado_ruta_optiroute') || '').toLowerCase();
        const matchGlobal = idStr.includes(queryNorm) || clientStr.includes(queryNorm) || addrStr.includes(queryNorm) || compStr.includes(queryNorm) || dateStr.includes(queryNorm) || timeStr.includes(queryNorm) || commStr.includes(queryNorm) || cityStr.includes(queryNorm) || covStr.includes(queryNorm) || catStr.includes(queryNorm) || optiRouteStr.includes(queryNorm);
        if (!matchGlobal) return false;
      }

      // 2. Filtros por Columna
      for (const [colKey, allowedSet] of Object.entries(columnFilters)) {
        if (!allowedSet) continue;
        const val = getOrderFieldValue(order, colKey);
        if (!allowedSet.has(val)) {
          return false;
        }
      }

      return true;
    });
  }

  // ==========================================================================
  // 5. Renderizado Principal de la Vista
  // ==========================================================================
  window.renderAgendasGrid = function() {
    const container = document.getElementById('subview-agendas-grid');
    if (!container) return;

    window.agendasGridState.filteredOrders = computeFilteredOrders();
    const visibleOrders = window.agendasGridState.filteredOrders;
    const totalEligible = getEligibleAgendasOrders().length;

    // Actualizar badge en la pestaña
    const tabCountBadge = document.getElementById('agendas-tab-count');
    if (tabCountBadge) {
      tabCountBadge.textContent = totalEligible;
    }

    container.innerHTML = `
      <!-- Barra Superior de Herramientas de Planilla -->
      <div class="agendas-toolbar-card">
        <div class="agendas-toolbar-left">
          <div class="agendas-search-box">
            <i class="ri-search-line"></i>
            <input type="text" id="agendas-search-input" class="agendas-search-input" placeholder="Buscar por N° pedido, cliente, comercio..." value="${window.agendasGridState.searchQuery || ''}" />
            <button type="button" id="agendas-clear-search-btn" class="agendas-clear-search" onclick="window.clearAgendasSearch()"><i class="ri-close-line"></i></button>
          </div>
          <span id="agendas-orders-count-text" style="font-size: 0.8rem; font-weight: 600; color: var(--color-text-muted);">
            Mostrando <strong style="color: var(--color-primary);">${visibleOrders.length}</strong> de ${totalEligible} pedidos
          </span>
          ${hasActiveColumnFilters() ? `
            <button type="button" class="btn btn-outline" onclick="window.clearAllAgendasColumnFilters()" style="padding: 0.25rem 0.6rem; font-size: 0.75rem; color: #ef4444; border-color: #fca5a5; display: inline-flex; align-items: center; gap: 0.3rem;">
              <i class="ri-filter-off-line"></i> Limpiar filtros
            </button>
          ` : ''}
        </div>

        <div class="agendas-toolbar-right">
          <!-- Acciones Masivas y Despacho Optiroute -->
          <div id="agendas-batch-actions-container" style="display: inline-flex; align-items: center;"></div>

          <!-- Indicador de Guardado -->
          <div id="agendas-save-indicator" class="agendas-save-status">
            <i class="ri-check-double-line"></i>
            <span>Todos los cambios guardados</span>
          </div>

          <!-- Botón Sincronizar Optiroute en Tiempo Real -->
          <button type="button" class="btn btn-outline" id="btn-agendas-sync-optiroute" onclick="window.syncAgendasWithOptiroute()" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 0.35rem; border-color: #c7d2fe; color: #4338ca; background: rgba(79, 70, 229, 0.05); font-weight: 600;" title="Sincronizar estados de rutas y asignación de conductores directamente desde Optiroute API en tiempo real">
            <i class="ri-refresh-line" style="font-size: 0.95rem;"></i> Sincronizar Optiroute
          </button>

          <!-- Botón Cobertura STK (Configuración de sub-cobertura 36 comunas RM) -->
          <button type="button" class="btn btn-outline" id="btn-agendas-cobertura-stk" onclick="window.openCoberturaStkModal()" style="padding: 0.35rem 0.7rem; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 0.35rem; border-color: #99f6e4; color: #0f766e; background: rgba(13, 148, 136, 0.05); font-weight: 600;" title="Configurar comunas con cobertura STK (RM-STK)">
            <i class="ri-map-pin-range-line" style="font-size: 0.95rem;"></i> Cobertura STK
            <span id="agendas-stk-badge" style="background: rgba(13, 148, 136, 0.15); color: #0f766e; font-size: 0.7rem; padding: 0.05rem 0.4rem; border-radius: 99px; font-weight: 700;">${(window.coberturaStkComunas || new Set()).size}/36</span>
          </button>

          <!-- Botón Gestionar Opciones (Agenda y Operador) -->
          <button type="button" class="btn btn-outline" onclick="window.manageWmsConfigOptions()" style="padding: 0.35rem 0.7rem; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 0.3rem;" title="Gestionar catálogo de opciones">
            <i class="ri-settings-3-line"></i> Opciones
          </button>

          <!-- Botón Restablecer Anchos de Columnas -->
          <button type="button" class="btn btn-outline" onclick="window.resetAgendasColumnWidths()" style="padding: 0.35rem 0.65rem; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 0.3rem;" title="Restablecer anchos de columnas por defecto para ver todas en pantalla">
            <i class="ri-aspect-ratio-line"></i> Anchos por defecto
          </button>

          <!-- Botón Exportar a Excel -->
          <button type="button" class="btn btn-outline" onclick="window.exportAgendasToExcel()" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; border-color: #10b981; color: #059669; background: rgba(16, 185, 129, 0.05); display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 600;" title="Descargar como archivo Excel">
            <i class="ri-file-excel-2-line" style="font-size: 1rem;"></i> Exportar Excel
          </button>

          <!-- Botón Refrescar -->
          <button type="button" class="btn btn-primary" onclick="window.refreshAgendasGrid()" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 600;" title="Actualizar datos con Torre de Control">
            <i class="ri-refresh-line"></i> Sincronizar
          </button>
        </div>
      </div>

      <!-- Grilla Excel Principal -->
      <div class="agendas-grid-wrapper">
        <div class="agendas-grid-scroll-area" id="agendas-scroll-container">
          <table class="agendas-excel-table" id="agendas-excel-table">
            <colgroup>
              <col style="width: 32px; min-width: 32px; max-width: 32px;">
              <col style="width: 36px; min-width: 36px; max-width: 36px;">
              ${COLUMN_DEFS.map(col => {
                const w = getSavedColumnWidth(col.key, col.defaultWidth);
                return `<col data-col-key="${col.key}" style="width: ${w}px;">`;
              }).join('')}
            </colgroup>
            <thead>
              <tr>
                <th class="th-row-select" title="Seleccionar todos los pedidos visibles">
                  <input type="checkbox" id="agendas-select-all-cb" onchange="window.toggleSelectAllAgendas(this)" />
                </th>
                <th class="th-row-index">#</th>
                ${COLUMN_DEFS.map(col => {
                  const isFiltered = Object.prototype.hasOwnProperty.call(window.agendasGridState.columnFilters, col.key);
                  const w = getSavedColumnWidth(col.key, col.defaultWidth);
                  return `
                    <th style="width: ${w}px;" data-col-key="${col.key}">
                      <div class="th-content">
                        <span class="th-title-text" title="${col.label}"><span class="th-col-letter">${col.letter}</span>${col.label}</span>
                        <button type="button" class="th-filter-btn ${isFiltered ? 'filter-active' : ''}" onclick="window.openAgendasColFilter(event, '${col.key}', '${col.label}')" title="Filtrar ${col.label}">
                          <i class="ri-filter-3-line"></i>
                        </button>
                      </div>
                      <div class="th-resizer" title="Arrastra para cambiar el ancho (Doble clic para reiniciar)"></div>
                    </th>
                  `;
                }).join('')}
              </tr>
            </thead>
            <tbody id="agendas-grid-tbody">
              ${renderTableRowsHtml(visibleOrders)}
            </tbody>
          </table>
        </div>

        <!-- Barra Inferior de Atajos y Ayuda -->
        <div class="agendas-footer-bar">
          <div class="agendas-shortcuts-tip">
            <span><i class="ri-keyboard-line"></i> <strong>Atajos Excel:</strong></span>
            <span><kbd>Ctrl+C</kbd> Copiar celda</span>
            <span><kbd>Ctrl+V</kbd> Pegar</span>
            <span><kbd>Arrastrar esquina</kbd> Copiar en serie</span>
            <span><kbd>Arrastrar borde columna</kbd> Ajustar ancho</span>
          </div>
          <div>
            <span style="font-weight: 600; color: var(--color-primary);"><i class="ri-links-line"></i> Sincronizado en tiempo real con Torre de Control</span>
          </div>
        </div>
      </div>
    `;

    // Vincular buscador
    const searchInput = document.getElementById('agendas-search-input');
    const clearSearchBtn = document.getElementById('agendas-clear-search-btn');
    if (searchInput) {
      if (searchInput.value) clearSearchBtn.style.display = 'flex';
      searchInput.addEventListener('input', (e) => {
        window.agendasGridState.searchQuery = e.target.value;
        clearSearchBtn.style.display = e.target.value ? 'flex' : 'none';
        refreshTableBodyOnly();
      });
    }

    // Inicializar manejadores de celdas, selección y redimensionamiento de columnas
    attachGridCellEvents();
    attachSelectCellEvents();
    attachColumnResizers();
    updateSelectionUi();
  };

  function renderTableRowsHtml(orders) {
    if (!orders || orders.length === 0) {
      return `
        <tr>
          <td colspan="19" style="text-align: center; padding: 4rem; color: var(--color-text-muted);">
            <div style="display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
              <i class="ri-inbox-line" style="font-size: 2.2rem; opacity: 0.5;"></i>
              <span style="font-weight: 600; font-size: 0.95rem;">No hay pedidos con los filtros aplicados</span>
              <button class="btn btn-outline" onclick="window.clearAllAgendasColumnFilters()" style="margin-top: 0.5rem; font-size: 0.8rem;">Restablecer filtros</button>
            </div>
          </td>
        </tr>
      `;
    }

    return orders.map((order, index) => {
      const rowNum = index + 1;
      const isSelected = window.agendasGridState.selectedOrderIds && window.agendasGridState.selectedOrderIds.has(String(order.id));
      return `
        <tr data-row-index="${index}" data-order-id="${order.id}" class="${isSelected ? 'row-selected' : ''}">
          <td class="excel-cell-select" title="Seleccionar pedido #${order.numero_orden || order.id}">
            <input type="checkbox" class="agendas-row-cb" data-order-id="${order.id}" ${isSelected ? 'checked' : ''} onchange="window.toggleAgendasRowSelection('${order.id}', this.checked)" />
          </td>
          <td class="excel-cell-row-index">${rowNum}</td>
          ${COLUMN_DEFS.map(col => {
            const isEditable = col.editable;
            return `
              <td class="excel-cell ${isEditable ? 'excel-cell-editable' : ''}" 
                  data-row-index="${index}" 
                  data-col-key="${col.key}" 
                  data-order-id="${order.id}" 
                  tabindex="0">
                ${renderCellHtml(order, col, index)}
              </td>
            `;
          }).join('')}
        </tr>
      `;
    }).join('');
  }

  function refreshTableBodyOnly() {
    window.agendasGridState.filteredOrders = computeFilteredOrders();
    const visibleOrders = window.agendasGridState.filteredOrders;
    const totalEligible = getEligibleAgendasOrders().length;

    const countEl = document.getElementById('agendas-orders-count-text');
    if (countEl) {
      countEl.innerHTML = `Mostrando <strong style="color: var(--color-primary);">${visibleOrders.length}</strong> de ${totalEligible} pedidos`;
    }
    const tabCountBadge = document.getElementById('agendas-tab-count');
    if (tabCountBadge) {
      tabCountBadge.textContent = totalEligible;
    }

    const tbody = document.getElementById('agendas-grid-tbody');
    if (tbody) {
      tbody.innerHTML = renderTableRowsHtml(visibleOrders);
      attachGridCellEvents();
      attachSelectCellEvents();
      updateSelectionUi();
    }
  }

  function hasActiveColumnFilters() {
    return Object.keys(window.agendasGridState.columnFilters).length > 0;
  }

  window.clearAgendasSearch = function() {
    const searchInput = document.getElementById('agendas-search-input');
    if (searchInput) searchInput.value = '';
    window.agendasGridState.searchQuery = '';
    const clearBtn = document.getElementById('agendas-clear-search-btn');
    if (clearBtn) clearBtn.style.display = 'none';
    refreshTableBodyOnly();
  };

  window.clearAllAgendasColumnFilters = function() {
    window.agendasGridState.columnFilters = {};
    window.renderAgendasGrid();
  };

  // ==========================================================================
  // 6. Manejo de Selección de Celda y Fill Handle (Arrastre en Serie)
  // ==========================================================================
  function setActiveCell(cellElement) {
    if (!cellElement) return;

    // Remover celda activa anterior
    const prevActive = document.querySelector('.excel-cell-active');
    if (prevActive) {
      prevActive.classList.remove('excel-cell-active');
      const oldHandle = prevActive.querySelector('.excel-fill-handle');
      if (oldHandle) oldHandle.remove();
    }

    // Activar nueva celda
    cellElement.classList.add('excel-cell-active');
    const rowIndex = parseInt(cellElement.getAttribute('data-row-index'), 10);
    const colKey = cellElement.getAttribute('data-col-key');
    const orderId = cellElement.getAttribute('data-order-id');
    const order = window.agendasGridState.filteredOrders[rowIndex];
    const val = order ? getOrderFieldValue(order, colKey) : '';

    window.agendasGridState.activeCell = {
      element: cellElement,
      rowIndex,
      colKey,
      orderId,
      value: val
    };

    // Añadir manejador de arrastre (Fill Handle) si es columna editable
    const colDef = COLUMN_DEFS.find(c => c.key === colKey);
    if (colDef && colDef.editable) {
      const handle = document.createElement('div');
      handle.className = 'excel-fill-handle';
      handle.title = 'Arrastra hacia abajo para copiar en serie';
      handle.addEventListener('mousedown', initFillDrag);
      cellElement.appendChild(handle);
    }
  }

  function attachGridCellEvents() {
    const cells = document.querySelectorAll('.agendas-excel-table tbody .excel-cell');
    cells.forEach(cell => {
      cell.addEventListener('click', (e) => {
        // Evitar si se hace click en el fill handle
        if (e.target.classList.contains('excel-fill-handle')) return;

        const colKey = cell.getAttribute('data-col-key');
        const orderId = cell.getAttribute('data-order-id');

        // Toggle si se hace clic de nuevo en la misma celda con el dropdown ya abierto
        const existingDropdown = document.getElementById('agendas-cell-dropdown');
        if (existingDropdown && existingDropdown.getAttribute('data-order-id') === orderId && existingDropdown.getAttribute('data-col-key') === colKey) {
          closeCellDropdown();
          return;
        }

        setActiveCell(cell);

        // Desplegar inmediatamente las opciones configuradas al hacer clic en CATEGORÍA, AGENDA, OPERADOR, RUTA OPTIROUTE o COMUNA
        if (colKey === 'categoria_entrega' || colKey === 'categoria' || colKey === 'agenda' || colKey === 'operador' || colKey === 'estado_ruta_optiroute' || colKey === 'comuna') {
          openCellDropdown(cell);
        } else {
          closeCellDropdown();
        }
      });

      // Doble clic también asegura que se abra el desplegable
      cell.addEventListener('dblclick', (e) => {
        if (e.target.classList.contains('excel-fill-handle')) return;
        const colKey = cell.getAttribute('data-col-key');
        if (colKey === 'categoria_entrega' || colKey === 'categoria' || colKey === 'agenda' || colKey === 'operador' || colKey === 'estado_ruta_optiroute' || colKey === 'comuna') {
          openCellDropdown(cell);
        }
      });
    });
  }

  // ==========================================================================
  // 6.b Redimensionamiento Manual de Columnas (Excel Column Resizing)
  // ==========================================================================
  function attachColumnResizers() {
    const table = document.getElementById('agendas-excel-table');
    if (!table) return;

    const ths = table.querySelectorAll('thead th[data-col-key]');
    ths.forEach(th => {
      const resizer = th.querySelector('.th-resizer');
      if (!resizer) return;

      const colKey = th.getAttribute('data-col-key');
      const colEl = table.querySelector(`colgroup col[data-col-key="${colKey}"]`);

      // Doble clic para reiniciar a ancho por defecto
      resizer.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const colDef = COLUMN_DEFS.find(c => c.key === colKey);
        if (colDef) {
          saveColumnWidth(colKey, colDef.defaultWidth);
          th.style.width = colDef.defaultWidth + 'px';
          if (colEl) colEl.style.width = colDef.defaultWidth + 'px';
        }
      });

      resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const startX = e.pageX;
        const startWidth = th.offsetWidth;
        resizer.classList.add('is-resizing');
        document.body.classList.add('resizing-columns');

        const onMouseMove = (moveEvent) => {
          const diffX = moveEvent.pageX - startX;
          const newWidth = Math.max(45, Math.round(startWidth + diffX));
          th.style.width = newWidth + 'px';
          if (colEl) colEl.style.width = newWidth + 'px';
        };

        const onMouseUp = () => {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          resizer.classList.remove('is-resizing');
          document.body.classList.remove('resizing-columns');

          const finalWidth = th.offsetWidth;
          saveColumnWidth(colKey, finalWidth);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
    });
  }

  // ==========================================================================
  // 7. Motor de Arrastre en Serie (Fill Handle)
  // ==========================================================================
  function initFillDrag(e) {
    e.preventDefault();
    e.stopPropagation();

    closeCellDropdown();

    const sourceCell = e.target.closest('.excel-cell');
    if (sourceCell && (!window.agendasGridState.activeCell || window.agendasGridState.activeCell.element !== sourceCell)) {
      setActiveCell(sourceCell);
    }

    const active = window.agendasGridState.activeCell;
    if (!active) return;

    const rowIndex = active.rowIndex;
    const colKey = active.colKey;
    const orderId = active.orderId;

    // Resolver el valor FUENTE más fresco y confiable posible (memoria, badge DOM o activeCell)
    const visibleOrders = window.agendasGridState.filteredOrders || [];
    const sourceOrder = (orderId ? (window.loadedOrders || []).find(o => String(o.id) === String(orderId)) : null)
      || visibleOrders[rowIndex];

    let resolvedSourceValue = '';
    if (sourceOrder && colKey) {
      resolvedSourceValue = getOrderFieldValue(sourceOrder, colKey);
    }
    if (!resolvedSourceValue && sourceCell) {
      if (colKey === 'comuna') {
        const textSpan = sourceCell.querySelector('.excel-cell-content span');
        resolvedSourceValue = textSpan ? textSpan.textContent.trim() : '';
        if (resolvedSourceValue === 'Por definir' || resolvedSourceValue === '-') resolvedSourceValue = '';
      } else {
        const badge = sourceCell.querySelector('.excel-badge-agenda, .excel-badge-operador, [class*="excel-badge-cat-"], [class*="excel-badge-opti-"]');
        if (badge) {
          resolvedSourceValue = colKey === 'estado_ruta_optiroute' ? badge.textContent.trim().toLowerCase() : badge.textContent.trim().toUpperCase();
        }
      }
    }
    if (!resolvedSourceValue && active.value) {
      resolvedSourceValue = active.value;
    }

    // Actualizar activeCell con el valor resuelto
    active.value = resolvedSourceValue;

    window.agendasGridState.dragState = {
      isDragging: true,
      startRowIndex: rowIndex,
      currentEndRowIndex: rowIndex,
      colKey: colKey,
      sourceValue: resolvedSourceValue
    };

    document.addEventListener('mousemove', onFillDragMove);
    document.addEventListener('mouseup', onFillDragEnd);
  }

  function onFillDragMove(e) {
    const dragState = window.agendasGridState.dragState;
    if (!dragState.isDragging) return;

    // Buscar celda bajo el cursor
    const elementUnderCursor = document.elementFromPoint(e.clientX, e.clientY);
    const targetCell = elementUnderCursor ? elementUnderCursor.closest('.excel-cell') : null;
    if (!targetCell) return;

    const targetRowIndex = parseInt(targetCell.getAttribute('data-row-index'), 10);
    const targetColKey = targetCell.getAttribute('data-col-key');

    // Solo permitir arrastrar verticalmente en la misma columna y hacia abajo
    if (targetColKey !== dragState.colKey || isNaN(targetRowIndex)) return;
    if (targetRowIndex < dragState.startRowIndex) return;

    dragState.currentEndRowIndex = targetRowIndex;
    highlightDragRange(dragState.startRowIndex, targetRowIndex, dragState.colKey);
  }

  function highlightDragRange(startRow, endRow, colKey) {
    // Limpiar highlights previos
    document.querySelectorAll('.excel-cell-in-drag').forEach(el => {
      el.classList.remove('excel-cell-in-drag', 'excel-cell-in-drag-last');
    });

    const tbody = document.getElementById('agendas-grid-tbody');
    if (!tbody) return;

    for (let r = startRow + 1; r <= endRow; r++) {
      const cell = tbody.querySelector(`.excel-cell[data-row-index="${r}"][data-col-key="${colKey}"]`);
      if (cell) {
        cell.classList.add('excel-cell-in-drag');
        if (r === endRow) cell.classList.add('excel-cell-in-drag-last');
      }
    }
  }

  async function onFillDragEnd(e) {
    document.removeEventListener('mousemove', onFillDragMove);
    document.removeEventListener('mouseup', onFillDragEnd);

    const dragState = window.agendasGridState.dragState;
    if (!dragState.isDragging) return;
    dragState.isDragging = false;

    // Limpiar clases visuales de arrastre
    document.querySelectorAll('.excel-cell-in-drag').forEach(el => {
      el.classList.remove('excel-cell-in-drag', 'excel-cell-in-drag-last');
    });

    const { startRowIndex, currentEndRowIndex, colKey, sourceValue } = dragState;
    if (currentEndRowIndex <= startRowIndex) return;

    const visibleOrders = window.agendasGridState.filteredOrders || [];
    const updates = [];

    // 1. Actualización visual optimista INMEDIATA (no esperar a la respuesta del servidor)
    for (let r = startRowIndex + 1; r <= currentEndRowIndex; r++) {
      const order = visibleOrders[r];
      if (order) {
        order[colKey] = sourceValue;
        updates.push({
          orderId: order.id,
          field: colKey,
          value: sourceValue
        });

        // Actualizar la celda visualmente al instante
        const colDef = COLUMN_DEFS.find(c => c.key === colKey);
        const cell = document.querySelector(`.excel-cell[data-order-id="${order.id}"][data-col-key="${colKey}"]`)
          || document.querySelector(`.excel-cell[data-row-index="${r}"][data-col-key="${colKey}"]`);
        if (cell && colDef) {
          cell.innerHTML = renderCellHtml(order, colDef, r);
        }
      }
    }

    // 2. Persistir en base de datos y memoria global
    if (updates.length > 0) {
      await window.batchUpdateAgendasOrders(updates);
    }
  }

  // ==========================================================================
  // 8. Menú Desplegable Flotante para AGENDA y OPERADOR (Opciones de Torre de Control)
  // ==========================================================================
  const DEFAULT_AGENDAS = ['RM', 'STK', 'RM-STK', 'REGION', 'RETIRO', 'FLEX', 'CENTRO DE ENVIOS', 'FALABELLA', 'PARIS', 'RIPLEY', 'WALMART', 'COLINA', 'PENDIENTE', 'CANCELA', 'COMPRA EN BODEGA'];
  const DEFAULT_OPERADORES = ['STARKEN', 'BLUEXPRESS', 'CHILEXPRESS', 'ENVIAME', 'STOCKA X', 'ALPHA', 'SUCURSAL ÑUÑOA', 'FALABELLA', 'MERCADOLIBRE', 'RIPLEY'];

  function closeCellDropdown() {
    const existing = document.getElementById('agendas-cell-dropdown');
    if (existing) {
      existing.remove();
    }
    document.removeEventListener('pointerdown', handleDropdownOutsideClick, true);
    window.removeEventListener('resize', closeCellDropdown);
  }

  function handleDropdownOutsideClick(e) {
    const popover = document.getElementById('agendas-cell-dropdown');
    if (!popover) return;
    if (popover.contains(e.target)) return;
    // Si hace clic en otra celda editable, dejamos que el evento click de la celda actúe
    if (e.target.closest('.excel-cell-editable')) return;
    closeCellDropdown();
  }

  function openCellDropdown(cellElement) {
    closeCellDropdown();

    const colKey = cellElement.getAttribute('data-col-key');
    const orderId = cellElement.getAttribute('data-order-id');
    const rowIndex = parseInt(cellElement.getAttribute('data-row-index'), 10);
    const order = (window.agendasGridState.filteredOrders || [])[rowIndex] || (window.loadedOrders || []).find(o => o.id === orderId);
    if (!order) return;

    let currentValue = (getOrderFieldValue(order, colKey) || '').trim();

    // Obtener opciones en caliente desde la configuración activa de Torre de Control, catálogo o comunas
    const isAgenda = colKey === 'agenda';
    const isOperador = colKey === 'operador';
    const isCategoria = colKey === 'categoria_entrega' || colKey === 'categoria';
    const isEstadoRutaOptiroute = colKey === 'estado_ruta_optiroute';
    const isComuna = colKey === 'comuna';

    if (isComuna && (currentValue === 'Por definir' || currentValue === '-')) {
      currentValue = '';
    } else if (!isComuna) {
      currentValue = currentValue.toUpperCase();
    }

    let configOptions = [];
    let title = '';
    let icon = '';
    let badgeClass = '';
    const allComunasMap = new Map();

    if (isAgenda) {
      configOptions = window.agendaOptions && window.agendaOptions.length ? window.agendaOptions : DEFAULT_AGENDAS;
      title = 'Agenda';
      icon = 'ri-calendar-event-line';
      badgeClass = 'excel-badge-agenda';
    } else if (isOperador) {
      configOptions = window.operadorOptions && window.operadorOptions.length ? window.operadorOptions : DEFAULT_OPERADORES;
      title = 'Operador';
      icon = 'ri-truck-line';
      badgeClass = 'excel-badge-operador';
    } else if (isCategoria) {
      configOptions = ['DISTRIBUCIÓN', 'RETIRO', 'LOGÍSTICA INVERSA', 'SHOP POINT (POS)'];
      title = 'Categoría';
      icon = 'ri-price-tag-3-line';
      badgeClass = 'excel-badge-cat-dist';
    } else if (isEstadoRutaOptiroute) {
      configOptions = ['creado', 'confirmado', 'descartado'];
      title = 'Ruta Optiroute';
      icon = 'ri-route-line';
    } else if (isComuna) {
      title = 'Comuna de Destino';
      icon = 'ri-map-pin-2-line';
      const all = typeof window.getChileCommunesList === 'function' ? window.getChileCommunesList() : [];
      if (all && all.length > 0) {
        configOptions = all.map(c => c.name);
        all.forEach(c => allComunasMap.set(c.name.toLowerCase(), c));
      } else if (typeof RM_36_COMMUNES !== 'undefined') {
        configOptions = RM_36_COMMUNES.map(c => c.name);
        RM_36_COMMUNES.forEach(c => allComunasMap.set(c.name.toLowerCase(), { name: c.name, region: 'Región Metropolitana', hasAlpha: true }));
      }
    } else {
      return;
    }

    const options = [...configOptions];
    // Si el pedido tiene un valor asignado que no está en la lista configurada, incluirlo al inicio
    if (currentValue && !options.some(o => o.toLowerCase() === currentValue.toLowerCase())) {
      options.unshift(currentValue);
    }

    function getCatBadgeAndIcon(val) {
      if (val === 'RETIRO') return { cls: 'excel-badge-cat-ret', ico: 'ri-store-2-line' };
      if (val === 'LOGÍSTICA INVERSA' || val === 'LOGISTICA INVERSA') return { cls: 'excel-badge-cat-li', ico: 'ri-arrow-left-right-line' };
      if (val.includes('POS') || val.includes('SHOP POINT')) return { cls: 'excel-badge-cat-pos', ico: 'ri-shopping-cart-2-line' };
      return { cls: 'excel-badge-cat-dist', ico: 'ri-truck-line' };
    }

    const popover = document.createElement('div');
    popover.id = 'agendas-cell-dropdown';
    popover.className = 'excel-dropdown-popover';
    popover.setAttribute('data-order-id', orderId);
    popover.setAttribute('data-col-key', colKey);
    popover.setAttribute('data-row-index', rowIndex);

    const itemsHtml = options.map(opt => {
      const isSelected = opt.toLowerCase() === currentValue.toLowerCase();
      let badgeContent = '';
      let subDesc = '';
      let itemSearchText = opt.toLowerCase();

      if (isCategoria) {
        const catInfo = getCatBadgeAndIcon(opt);
        badgeContent = `<span class="${catInfo.cls}"><i class="${catInfo.ico}"></i> ${opt}</span>`;
      } else if (isEstadoRutaOptiroute) {
        if (opt.toLowerCase() === 'creado') {
          badgeContent = `<span class="excel-badge-opti-creado"><i class="ri-route-line"></i> Creado</span>`;
          subDesc = '<span style="font-size: 0.68rem; color: var(--color-text-muted); display: block; margin-top: 1px;">Parte de una ruta que se está creando</span>';
        } else if (opt.toLowerCase() === 'confirmado') {
          badgeContent = `<span class="excel-badge-opti-confirmado"><i class="ri-user-follow-line"></i> Confirmado</span>`;
          subDesc = '<span style="font-size: 0.68rem; color: var(--color-text-muted); display: block; margin-top: 1px;">Ya es parte de la ruta de un conductor</span>';
        } else if (opt.toLowerCase() === 'descartado') {
          badgeContent = `<span class="excel-badge-opti-descartado"><i class="ri-close-circle-line"></i> Descartado</span>`;
          subDesc = '<span style="font-size: 0.68rem; color: var(--color-text-muted); display: block; margin-top: 1px;">No considerado en ninguna ruta de conductor</span>';
        } else {
          badgeContent = `<span>${opt}</span>`;
        }
      } else if (isComuna) {
        const cObj = allComunasMap.get(opt.toLowerCase());
        const isRM = isComunaRM(opt);
        const isStk = isComunaCoberturaStk(opt);
        let badgePill = '';
        if (isStk) {
          badgePill = `<span style="background: rgba(113, 23, 235, 0.12); color: #7117eb; padding: 1px 6px; border-radius: 4px; font-size: 0.65rem; font-weight: 700; border: 1px solid rgba(113, 23, 235, 0.25);">RM-STK</span>`;
        } else if (isRM) {
          badgePill = `<span style="background: rgba(16, 185, 129, 0.12); color: #059669; padding: 1px 6px; border-radius: 4px; font-size: 0.65rem; font-weight: 700;">RM</span>`;
        } else {
          badgePill = `<span style="background: rgba(59, 130, 246, 0.1); color: #2563eb; padding: 1px 6px; border-radius: 4px; font-size: 0.65rem; font-weight: 600;">Región</span>`;
        }
        const regText = cObj?.region ? `<span style="font-size: 0.72rem; color: var(--color-text-muted); margin-left: 0.35rem;">(${cObj.region})</span>` : '';
        itemSearchText = `${opt} ${cObj?.region || ''}`.toLowerCase();
        badgeContent = `
          <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 0.5rem;">
            <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              <span style="font-weight: 600; font-size: 0.82rem; color: var(--color-text-main);">${opt}</span>
              ${regText}
            </div>
            <div>${badgePill}</div>
          </div>
        `;
      } else {
        badgeContent = `<span class="${badgeClass}">${opt}</span>`;
      }

      return `
        <div class="excel-dropdown-item ${isSelected ? 'selected' : ''}" data-value="${opt.replace(/"/g, '&quot;')}" data-text="${itemSearchText.replace(/"/g, '&quot;')}">
          <div style="display: flex; flex-direction: column; min-width: 0; flex: 1;">
            <div style="display: flex; align-items: center; gap: 0.45rem; width: 100%;">
              ${badgeContent}
            </div>
            ${subDesc}
          </div>
          ${isSelected ? '<i class="ri-check-line excel-dropdown-check"></i>' : ''}
        </div>
      `;
    }).join('');

    popover.innerHTML = `
      <div class="excel-dropdown-header">
        <div class="excel-dropdown-title">
          <i class="${icon}"></i>
          <span>${title} (${options.length})</span>
        </div>
        <button type="button" class="excel-dropdown-close" title="Cerrar"><i class="ri-close-line"></i></button>
      </div>
      <div class="excel-dropdown-search">
        <i class="ri-search-line"></i>
        <input type="text" class="excel-dropdown-search-input" placeholder="Buscar o escribir opción..." autocomplete="off" />
      </div>
      <div class="excel-dropdown-list">
        ${!isCategoria ? `
        <div class="excel-dropdown-item ${!currentValue ? 'selected' : ''}" data-value="" data-text="vacio sin asignar ninguno limpiar - sin ruta sin comuna" style="border-bottom: 1px dashed var(--color-border); margin-bottom: 2px;">
          <div style="display: flex; align-items: center; gap: 0.45rem; color: var(--color-text-muted); font-size: 0.76rem; font-style: italic;">
            <i class="ri-forbid-line"></i> ${isEstadoRutaOptiroute ? '(Sin ruta asignada / -)' : (isComuna ? '(Sin comuna / Por definir)' : '(Sin asignar / Vacío)')}
          </div>
          ${!currentValue ? '<i class="ri-check-line excel-dropdown-check"></i>' : ''}
        </div>
        ` : ''}
        ${itemsHtml}
      </div>
    `;

    document.body.appendChild(popover);

    // Posicionamiento dinámico adaptado a la celda y bordes de la pantalla
    const rect = cellElement.getBoundingClientRect();
    const popoverWidth = isComuna ? 300 : (isEstadoRutaOptiroute ? 280 : 230);
    const popoverHeight = Math.min(340, popover.offsetHeight || 280);

    let left = rect.left;
    if (left + popoverWidth > window.innerWidth - 12) {
      left = window.innerWidth - popoverWidth - 12;
    }
    if (left < 10) left = 10;

    let top = rect.bottom + 3;
    if (top + popoverHeight > window.innerHeight - 10 && rect.top - popoverHeight > 10) {
      top = rect.top - popoverHeight - 3;
    }

    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
    popover.style.width = `${popoverWidth}px`;

    // Cerrar botón x
    popover.querySelector('.excel-dropdown-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeCellDropdown();
    });

    // Manejar selección de opción al hacer clic
    const listEl = popover.querySelector('.excel-dropdown-list');
    listEl?.addEventListener('click', async (e) => {
      const item = e.target.closest('.excel-dropdown-item');
      if (!item) return;

      const newVal = item.getAttribute('data-value') || '';
      closeCellDropdown();

      if (window.agendasGridState.activeCell) {
        window.agendasGridState.activeCell.value = newVal;
      }

      await window.batchUpdateAgendasOrders([{
        orderId,
        field: colKey,
        value: newVal
      }]);
    });

    // Manejar buscador en vivo y teclado
    const searchInput = popover.querySelector('.excel-dropdown-search-input');
    if (searchInput) {
      setTimeout(() => searchInput.focus(), 30);

      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ñ/g, 'n').trim();
        const items = listEl.querySelectorAll('.excel-dropdown-item');
        let highlighted = false;

        items.forEach(it => {
          const rawText = it.getAttribute('data-text') || '';
          const text = rawText.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ñ/g, 'n');
          if (!query || text.includes(query)) {
            it.style.display = 'flex';
            if (!highlighted) {
              it.classList.add('highlighted');
              highlighted = true;
            } else {
              it.classList.remove('highlighted');
            }
          } else {
            it.style.display = 'none';
            it.classList.remove('highlighted');
          }
        });
      });

      searchInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Escape') {
          closeCellDropdown();
          cellElement.focus();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const highlightedItem = listEl.querySelector('.excel-dropdown-item.highlighted') 
            || Array.from(listEl.querySelectorAll('.excel-dropdown-item')).find(it => it.style.display !== 'none');
          if (highlightedItem) {
            const newVal = highlightedItem.getAttribute('data-value') || '';
            closeCellDropdown();

            if (window.agendasGridState.activeCell) {
              window.agendasGridState.activeCell.value = newVal;
            }

            await window.batchUpdateAgendasOrders([{
              orderId,
              field: colKey,
              value: newVal
            }]);
          } else if (isComuna && searchInput.value.trim()) {
            const newVal = searchInput.value.trim();
            closeCellDropdown();
            if (window.agendasGridState.activeCell) {
              window.agendasGridState.activeCell.value = newVal;
            }
            await window.batchUpdateAgendasOrders([{
              orderId,
              field: colKey,
              value: newVal
            }]);
          }
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const visibleItems = Array.from(listEl.querySelectorAll('.excel-dropdown-item')).filter(it => it.style.display !== 'none');
          if (visibleItems.length === 0) return;

          const currentIdx = visibleItems.findIndex(it => it.classList.contains('highlighted'));
          let nextIdx = 0;
          if (e.key === 'ArrowDown') {
            nextIdx = currentIdx < visibleItems.length - 1 ? currentIdx + 1 : 0;
          } else {
            nextIdx = currentIdx > 0 ? currentIdx - 1 : visibleItems.length - 1;
          }

          visibleItems.forEach(it => it.classList.remove('highlighted'));
          visibleItems[nextIdx].classList.add('highlighted');
          visibleItems[nextIdx].scrollIntoView({ block: 'nearest' });
        }
      });
    }

    // Cerrar al hacer clic fuera o hacer scroll
    setTimeout(() => {
      document.addEventListener('pointerdown', handleDropdownOutsideClick, true);
      window.addEventListener('resize', closeCellDropdown, { once: true });
    }, 50);

    const scrollContainer = document.getElementById('agendas-scroll-container');
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', closeCellDropdown, { once: true, passive: true });
    }
  }

  // Alias para mantener compatibilidad
  window.openCellInlineEditor = openCellDropdown;
  window.openCellDropdown = openCellDropdown;
  window.closeCellDropdown = closeCellDropdown;

  // ==========================================================================
  // 8.b Modal Interactivo para Configurar Comunas de Cobertura STK (RM-STK)
  // ==========================================================================
  window.toggleStkCardClass = function(checkbox) {
    const card = checkbox.closest('.stk-commune-card');
    if (card) {
      if (checkbox.checked) card.classList.add('active');
      else card.classList.remove('active');
    }
    const count = document.querySelectorAll('#stk-communes-container .stk-commune-cb:checked').length;
    const el = document.getElementById('stk-selected-counter');
    if (el) el.textContent = `${count} de 36 seleccionadas`;
  };

  window.setAllStkCommunes = function(check) {
    document.querySelectorAll('#stk-communes-container .stk-commune-card').forEach(card => {
      if (card.style.display !== 'none') {
        const cb = card.querySelector('.stk-commune-cb');
        if (cb) {
          cb.checked = check;
          if (check) card.classList.add('active');
          else card.classList.remove('active');
        }
      }
    });
    const count = document.querySelectorAll('#stk-communes-container .stk-commune-cb:checked').length;
    const el = document.getElementById('stk-selected-counter');
    if (el) el.textContent = `${count} de 36 seleccionadas`;
  };

  window.filterStkCommunesList = function(query) {
    const q = (query || '').toLowerCase().trim();
    document.querySelectorAll('#stk-communes-container .stk-commune-card').forEach(card => {
      const text = card.getAttribute('data-name') || '';
      if (!q || text.includes(q)) {
        card.style.display = 'flex';
      } else {
        card.style.display = 'none';
      }
    });
  };

  window.openCoberturaStkModal = async function() {
    const currentStkSet = window.coberturaStkComunas || new Set();

    const communesHtml = RM_36_COMMUNES.map(c => {
      const isChecked = currentStkSet.has(c.key);
      return `
        <label class="stk-commune-card ${isChecked ? 'active' : ''}" data-name="${c.name.toLowerCase()} ${c.key}">
          <input type="checkbox" class="stk-commune-cb" value="${c.key}" ${isChecked ? 'checked' : ''} onchange="window.toggleStkCardClass(this)" />
          <span class="stk-commune-name">${c.name}</span>
        </label>
      `;
    }).join('');

    const { isConfirmed } = await Swal.fire({
      title: 'Configurar Cobertura STK',
      width: '740px',
      html: `
        <div style="text-align: left; font-size: 0.85rem; color: var(--color-text-main); font-family: Outfit, sans-serif;">
          <p style="margin-top: 0; margin-bottom: 0.75rem; color: var(--color-text-muted); font-size: 0.82rem; line-height: 1.4;">
            Selecciona las comunas de la <strong>Región Metropolitana</strong> (de las 36 disponibles) que tienen <strong>cobertura STK</strong>. Los pedidos en estas comunas que se encuentren <em>en procesamiento y sin agenda asignada</em> mostrarán la sugerencia <strong style="color: #0f766e; background: #ccfbf1; padding: 0.1rem 0.4rem; border-radius: 4px;">RM-STK</strong>.
          </p>

          <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.75rem; flex-wrap: wrap;">
            <div style="position: relative; flex: 1; min-width: 200px;">
              <i class="ri-search-line" style="position: absolute; left: 0.6rem; top: 50%; transform: translateY(-50%); color: var(--color-text-muted);"></i>
              <input type="text" id="stk-commune-search" placeholder="Filtrar comunas..." style="width: 100%; padding: 0.35rem 0.5rem 0.35rem 1.8rem; font-size: 0.8rem; border-radius: 6px; border: 1px solid var(--color-border); background: var(--color-bg); outline: none; box-sizing: border-box;" oninput="window.filterStkCommunesList(this.value)" autocomplete="off" />
            </div>
            <div style="display: flex; align-items: center; gap: 0.4rem;">
              <button type="button" class="btn btn-outline" onclick="window.setAllStkCommunes(true)" style="padding: 0.25rem 0.55rem; font-size: 0.75rem;">Todas (36)</button>
              <button type="button" class="btn btn-outline" onclick="window.setAllStkCommunes(false)" style="padding: 0.25rem 0.55rem; font-size: 0.75rem;">Ninguna</button>
              <span id="stk-selected-counter" style="font-size: 0.76rem; font-weight: 700; color: #0d9488; margin-left: 0.3rem;">
                ${currentStkSet.size} de 36 seleccionadas
              </span>
            </div>
          </div>

          <div id="stk-communes-container" class="stk-communes-grid">
            ${communesHtml}
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '<i class="ri-save-line"></i> Guardar Cobertura STK',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#0d9488',
      didOpen: () => {
        document.getElementById('stk-commune-search')?.focus();
      }
    });

    if (isConfirmed) {
      const selectedKeys = [];
      document.querySelectorAll('#stk-communes-container .stk-commune-cb:checked').forEach(cb => {
        selectedKeys.push(cb.value);
      });

      try {
        const sb = getSupabase();
        if (sb) {
          // 1. Intentar primero guardar con el tipo nativo 'cobertura_stk_comuna'
          let savedNative = false;
          try {
            await sb
              .from('wms_config_options')
              .delete()
              .eq('type', 'cobertura_stk_comuna');

            if (selectedKeys.length > 0) {
              const rows = selectedKeys.map(k => ({
                type: 'cobertura_stk_comuna',
                value: k
              }));
              const { error: insErr } = await sb.from('wms_config_options').insert(rows);
              if (insErr) throw insErr;
            }
            // Limpiar respaldo anterior si existía
            await sb.from('wms_config_options').delete().eq('type', 'keyword_retiro').like('value', '__STK_COMUNAS__:%');
            savedNative = true;
          } catch (nativeErr) {
            console.warn('Almacenamiento nativo cobertura_stk_comuna con check constraint. Usando almacenamiento compatible:', nativeErr.message);
            // 2. Fallback compatible: almacenar en wms_config_options bajo keyword_retiro con prefijo __STK_COMUNAS__:
            await sb.from('wms_config_options').delete().eq('type', 'keyword_retiro').like('value', '__STK_COMUNAS__:%');
            if (selectedKeys.length > 0) {
              const payload = {
                type: 'keyword_retiro',
                value: '__STK_COMUNAS__:' + JSON.stringify(selectedKeys)
              };
              const { error: fallbackErr } = await sb.from('wms_config_options').insert([payload]);
              if (fallbackErr) throw fallbackErr;
            }
          }
        }

        window.coberturaStkComunas = new Set(selectedKeys);
        localStorage.setItem('wms_cobertura_stk_comunas', JSON.stringify(selectedKeys));

        const badge = document.getElementById('agendas-stk-badge');
        if (badge) badge.textContent = `${selectedKeys.length}/36`;

        refreshTableBodyOnly();

        const toast = Swal.mixin({
          toast: true,
          position: 'top-end',
          showConfirmButton: false,
          timer: 2000
        });
        toast.fire({
          icon: 'success',
          title: `Cobertura STK guardada (${selectedKeys.length} comunas activas)`
        });
      } catch (err) {
        console.error('Error guardando cobertura STK:', err);
        Swal.fire('Error', 'No se pudo guardar la configuración: ' + err.message, 'error');
      }
    }
  };

  // ==========================================================================
  // 9. Motor de Copiar y Pegar (Clipboard Engine)
  // ==========================================================================
  async function handleGridCopy(e) {
    const active = window.agendasGridState.activeCell;
    if (!active) return;

    // Solo interceptar si el foco no está en un input de texto
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

    e.preventDefault();
    try {
      const visibleOrders = window.agendasGridState.filteredOrders || [];
      const order = (active.orderId ? (window.loadedOrders || []).find(o => String(o.id) === String(active.orderId)) : null)
        || visibleOrders[active.rowIndex];
      let valToCopy = order ? getOrderFieldValue(order, active.colKey) : '';
      if (active.colKey === 'comuna' && (valToCopy === 'Por definir' || valToCopy === '-')) {
        valToCopy = '';
      }
      if (!valToCopy && active.element) {
        if (active.colKey === 'comuna') {
          const span = active.element.querySelector('.excel-cell-content span');
          valToCopy = span ? span.textContent.trim() : '';
          if (valToCopy === 'Por definir' || valToCopy === '-') valToCopy = '';
        } else {
          const badge = active.element.querySelector('.excel-badge-agenda, .excel-badge-operador, [class*="excel-badge-cat-"], [class*="excel-badge-opti-"]');
          if (badge) {
            valToCopy = active.colKey === 'estado_ruta_optiroute' ? badge.textContent.trim().toLowerCase() : badge.textContent.trim().toUpperCase();
          }
        }
      }
      if (!valToCopy) valToCopy = active.value || '';

      await navigator.clipboard.writeText(valToCopy);
      const toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 1200
      });
      toast.fire({
        icon: 'info',
        title: `Copiado: "${valToCopy || '(vacío)'}"`
      });
    } catch (err) {
      console.warn('Error al copiar al portapapeles:', err);
    }
  }

  async function handleGridPaste(e) {
    closeCellDropdown();
    const active = window.agendasGridState.activeCell;
    if (!active) return;
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

    // Solo permitir pegar en columnas editables (agenda, operador, categoría, comuna o ruta optiroute)
    const isPasteAllowed = ['agenda', 'operador', 'categoria_entrega', 'categoria', 'estado_ruta_optiroute', 'comuna'].includes(active.colKey);
    if (!isPasteAllowed) {
      const toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 1800
      });
      toast.fire({
        icon: 'warning',
        title: 'Solo se puede pegar en COMUNA, CATEGORÍA, AGENDA, OPERADOR o RUTA OPTIROUTE'
      });
      return;
    }

    e.preventDefault();
    let pasteText = '';
    if (e.clipboardData) {
      pasteText = e.clipboardData.getData('text');
    } else if (navigator.clipboard) {
      pasteText = await navigator.clipboard.readText();
    }

    if (!pasteText) return;

    // Separar por líneas (permite copiar de Excel externo o Google Sheets)
    const lines = pasteText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return;

    const visibleOrders = window.agendasGridState.filteredOrders;
    const updates = [];

    lines.forEach((lineVal, offset) => {
      const targetRow = active.rowIndex + offset;
      if (targetRow < visibleOrders.length) {
        const order = visibleOrders[targetRow];
        // Extraer primera celda si venía tab-delimited
        let rawCellVal = lineVal.split('\t')[0].trim();
        let cellVal = rawCellVal;
        if (active.colKey === 'categoria_entrega' || active.colKey === 'categoria') {
          cellVal = cellVal.toUpperCase();
          if (cellVal === 'DISTRIBUCION') cellVal = 'DISTRIBUCIÓN';
          else if (cellVal === 'LOGISTICA INVERSA') cellVal = 'LOGÍSTICA INVERSA';
          else if (cellVal.includes('POS') || cellVal.includes('SHOP POINT')) cellVal = 'SHOP POINT (POS)';
        } else if (active.colKey === 'estado_ruta_optiroute') {
          const lVal = cellVal.toLowerCase();
          if (lVal.includes('cread') || lVal.includes('crear')) cellVal = 'creado';
          else if (lVal.includes('confirm') || lVal.includes('chofer') || lVal.includes('conductor')) cellVal = 'confirmado';
          else if (lVal.includes('descart') || lVal.includes('omit') || lVal.includes('cancel')) cellVal = 'descartado';
          else if (lVal === '-' || lVal === 'ninguno' || lVal === 'vacio' || lVal === 'sin asignar') cellVal = '';
          else cellVal = lVal;
        } else if (active.colKey === 'comuna') {
          const allComs = typeof window.getChileCommunesList === 'function' ? window.getChileCommunesList() : [];
          const normInput = resolveComunaNorm(rawCellVal);
          const match = allComs.find(c => resolveComunaNorm(c.name) === normInput);
          if (match) {
            cellVal = match.name;
          } else {
            cellVal = rawCellVal;
          }
        } else {
          cellVal = cellVal.toUpperCase();
        }
        updates.push({
          orderId: order.id,
          field: active.colKey,
          value: cellVal
        });
      }
    });

    if (updates.length > 0) {
      await window.batchUpdateAgendasOrders(updates);
    }
  }

  // ==========================================================================
  // 10. Persistencia en Base de Datos y Sincronización
  // ==========================================================================
  window.batchUpdateAgendasOrders = async function(updates) {
    if (!updates || updates.length === 0) return;

    const saveIndicator = document.getElementById('agendas-save-indicator');
    if (saveIndicator) {
      saveIndicator.className = 'agendas-save-status saving';
      saveIndicator.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> <span>Guardando ${updates.length} cambio(s)...</span>`;
    }

    try {
      // 1. Agrupar por par (campo, valor) para hacer consultas masivas con `.in('id', ids)`
      const groups = new Map();
      updates.forEach(u => {
        const key = `${u.field}:::${u.value}`;
        if (!groups.has(key)) {
          groups.set(key, { field: u.field, value: u.value, ids: [] });
        }
        groups.get(key).ids.push(u.orderId);
      });

      // 2. Ejecutar updates en Supabase
      const sb = getSupabase();
      if (!sb) {
        throw new Error('Cliente de base de datos no disponible');
      }

      const promises = [];
      for (const grp of groups.values()) {
        if (grp.field === 'comuna') {
          // Para comunas, persistir en shipping_city y actualizar flags en metadata raw
          for (const oid of grp.ids) {
            const targetOrder = (window.loadedOrders || []).find(o => String(o.id) === String(oid))
              || (window.agendasGridState?.filteredOrders || []).find(o => String(o.id) === String(oid));

            const rawKey = targetOrder?.raw_shopify_data ? 'raw_shopify_data' :
                           (targetOrder?.raw_woocommerce_data ? 'raw_woocommerce_data' :
                           (targetOrder?.raw_falabella_data ? 'raw_falabella_data' :
                           (targetOrder?.raw_paris_data ? 'raw_paris_data' :
                           (targetOrder?.raw_ripley_data ? 'raw_ripley_data' :
                           (targetOrder?.raw_jumpseller_data ? 'raw_jumpseller_data' :
                           (targetOrder?.raw_tiendanube_data ? 'raw_tiendanube_data' :
                           (targetOrder?.raw_meli_data ? 'raw_meli_data' :
                           (targetOrder?.raw_walmart_data ? 'raw_walmart_data' : null))))))));

            const updatePayload = {
              shipping_city: grp.value || null
            };

            if (rawKey && targetOrder && targetOrder[rawKey]) {
              const updatedRaw = {
                ...targetOrder[rawKey],
                wms_shipping_edited: true,
                wms_custom_edited: true
              };
              updatePayload[rawKey] = updatedRaw;
              targetOrder[rawKey] = updatedRaw;
            }

            promises.push(
              sb
                .from('orders')
                .update(updatePayload)
                .eq('id', oid)
                .then(res => {
                  if (res.error) throw res.error;
                  return res;
                })
            );
          }
        } else {
          const payload = {};
          payload[grp.field] = grp.value || null;

          promises.push(
            sb
              .from('orders')
              .update(payload)
              .in('id', grp.ids)
              .then(res => {
                if (res.error) {
                  // Si la columna aún no ha sido creada en Supabase (error 42703), no interrumpir la ejecución
                  if (res.error.code === '42703' || String(res.error.message || '').includes('estado_ruta_optiroute')) {
                    console.warn(`Aviso: La columna '${grp.field}' aún no está creada en Supabase (código 42703). Cambios guardados en memoria.`);
                    return { data: null, error: null, warningSkipped: true };
                  }
                  throw res.error;
                }
                return res;
              })
          );
        }
      }

      await Promise.all(promises);

      // 2.b Sincronizar en Picker (active_orders) y registrar auditoría si se modificaron comunas
      const comunaUpdates = updates.filter(u => u.field === 'comuna');
      if (comunaUpdates.length > 0) {
        // Sincronizar con el sistema de Picker
        const pSb = window.pickerSupabase || (typeof pickerSupabase !== 'undefined' ? pickerSupabase : null);
        for (const cu of comunaUpdates) {
          const ord = (window.loadedOrders || []).find(o => String(o.id) === String(cu.orderId))
            || (window.agendasGridState?.filteredOrders || []).find(o => String(o.id) === String(cu.orderId));
          if (ord) {
            const orderNumber = String(ord.external_order_number || ord.id);
            if (pSb) {
              pSb.from('active_orders')
                .update({ contact_data_t: cu.value || '' })
                .eq('order_number', orderNumber)
                .then(res => {
                  if (res.error) console.warn('Aviso sincronización Picker active_orders:', res.error);
                  else console.log(`✅ Comuna sincronizada en Picker active_orders para ${orderNumber}: ${cu.value}`);
                })
                .catch(err => console.warn('Picker sync err:', err));
            }
          }
        }

        // Registrar auditoría en order_audit_logs
        try {
          const { data: { session } } = await sb.auth.getSession();
          const userEmail = session?.user?.email || 'admin@stocka.cl';
          const userId = session?.user?.id || null;
          const auditRows = comunaUpdates.map(cu => {
            const ord = (window.loadedOrders || []).find(o => String(o.id) === String(cu.orderId));
            const prevComuna = ord ? (ord.shipping_city || ord.comuna || 'No registrada') : 'No registrada';
            return {
              order_id: cu.orderId,
              user_id: userId,
              user_email: userEmail,
              action: 'Modificación de Comuna/Ciudad',
              details: {
                changes: [`Comuna/Ciudad cambiada a: "${cu.value || 'Vacío'}" (anterior: "${prevComuna}") desde Gestor de Agendas`]
              }
            };
          });
          sb.from('order_audit_logs').insert(auditRows).catch(e => console.warn('Error registrando auditoría:', e));
        } catch (audErr) {
          console.warn('Error en bloque de auditoría de comunas:', audErr);
        }
      }

      // 3. Sincronizar en memoria en `window.loadedOrders` y `window.agendasGridState.filteredOrders`
      const updatesMap = new Map();
      updates.forEach(u => {
        const idKey = String(u.orderId);
        if (!updatesMap.has(idKey)) updatesMap.set(idKey, {});
        updatesMap.get(idKey)[u.field] = u.value;
        if (u.field === 'comuna') {
          updatesMap.get(idKey)['shipping_city'] = u.value;
          updatesMap.get(idKey)['comuna'] = u.value;
        }

        // Si la celda activa corresponde a este pedido y campo, actualizar su activeCell.value
        if (window.agendasGridState.activeCell && String(window.agendasGridState.activeCell.orderId) === idKey && window.agendasGridState.activeCell.colKey === u.field) {
          window.agendasGridState.activeCell.value = u.value;
        }
      });

      (window.loadedOrders || []).forEach(o => {
        const idKey = String(o.id);
        if (updatesMap.has(idKey)) {
          Object.assign(o, updatesMap.get(idKey));
          // Propagar al picker si está en preparación (solo si cambiaron campos relevantes para picker)
          const updatedFields = Object.keys(updatesMap.get(idKey) || {});
          const hasPickerField = updatedFields.some(f => ['operador', 'agenda', 'comuna', 'shipping_city', 'sucursal_pickeo'].includes(f));
          if (hasPickerField && o.estado_wms === 'En preparación' && typeof window.propagateOrderUpdateToPicker === 'function') {
            window.propagateOrderUpdateToPicker(o, { itemsChanged: false }).catch(err => console.warn('Picker prop error:', err));
          }
        }
      });

      (window.agendasGridState.filteredOrders || []).forEach(o => {
        const idKey = String(o.id);
        if (updatesMap.has(idKey)) {
          Object.assign(o, updatesMap.get(idKey));
        }
      });

      // 4. Actualizar celdas en la grilla visualmente
      updates.forEach(u => {
        const idKey = String(u.orderId);
        let cell = document.querySelector(`.excel-cell[data-order-id="${u.orderId}"][data-col-key="${u.field}"]`);
        if (!cell) {
          cell = document.querySelector(`.excel-cell[data-order-id="${idKey}"][data-col-key="${u.field}"]`);
        }
        if (!cell) {
          const cells = document.querySelectorAll(`.excel-cell[data-col-key="${u.field}"]`);
          for (let c of cells) {
            if (String(c.getAttribute('data-order-id')) === idKey) {
              cell = c;
              break;
            }
          }
        }

        if (cell) {
          const colDef = COLUMN_DEFS.find(c => c.key === u.field);
          const order = (window.loadedOrders || []).find(o => String(o.id) === idKey)
            || (window.agendasGridState.filteredOrders || []).find(o => String(o.id) === idKey);

          if (order && colDef) {
            order[u.field] = u.value; // Asegurar asignación directa en el objeto orden
            if (u.field === 'comuna') {
              order.shipping_city = u.value;
              order.comuna = u.value;
            }
            const isActive = cell.classList.contains('excel-cell-active');
            cell.innerHTML = renderCellHtml(order, colDef, parseInt(cell.getAttribute('data-row-index'), 10));
            if (isActive && colDef.editable) {
              const handle = document.createElement('div');
              handle.className = 'excel-fill-handle';
              handle.title = 'Arrastra hacia abajo para copiar en serie';
              handle.addEventListener('mousedown', initFillDrag);
              cell.appendChild(handle);
            }
          }
        }

        // Si se actualizó la comuna, re-renderizar de inmediato la celda de cobertura_sugerida de esa misma fila
        if (u.field === 'comuna') {
          let covCell = document.querySelector(`.excel-cell[data-order-id="${u.orderId}"][data-col-key="cobertura_sugerida"]`);
          if (!covCell) {
            covCell = document.querySelector(`.excel-cell[data-order-id="${idKey}"][data-col-key="cobertura_sugerida"]`);
          }
          if (covCell) {
            const covDef = COLUMN_DEFS.find(c => c.key === 'cobertura_sugerida');
            const order = (window.loadedOrders || []).find(o => String(o.id) === idKey)
              || (window.agendasGridState.filteredOrders || []).find(o => String(o.id) === idKey);
            if (order && covDef) {
              covCell.innerHTML = renderCellHtml(order, covDef, parseInt(covCell.getAttribute('data-row-index'), 10));
            }
          }
        }
      });

      // 5. Restablecer indicador
      if (saveIndicator) {
        saveIndicator.className = 'agendas-save-status';
        saveIndicator.innerHTML = `<i class="ri-check-double-line"></i> <span>Todos los cambios guardados (${updates.length} actualizados)</span>`;
      }

      // Notificación toast amigable
      const toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 2000,
        timerProgressBar: true
      });
      toast.fire({
        icon: 'success',
        title: updates.length === 1 ? 'Campo actualizado' : `${updates.length} pedidos actualizados en serie`
      });

    } catch (err) {
      console.error('Error al guardar cambios de agendas en lote:', err);
      if (saveIndicator) {
        saveIndicator.className = 'agendas-save-status saving';
        saveIndicator.innerHTML = `<i class="ri-error-warning-line" style="color: #ef4444;"></i> <span style="color: #ef4444;">Error al guardar</span>`;
      }
      Swal.fire('Error', 'No se pudieron guardar los cambios: ' + err.message, 'error');
    }
  };

  // ==========================================================================
  // 11. Motor de Filtros por Columna Estilo Excel
  // ==========================================================================
  window.openAgendasColFilter = function(event, colKey, colLabel) {
    event.stopPropagation();

    // Cerrar cualquier popover existente
    const existing = document.getElementById('agendas-col-popover');
    if (existing) existing.remove();

    // Obtener pedidos elegibles contextuales a las otras columnas y búsqueda activa
    const eligibleOrders = getEligibleOrdersForColFilter(colKey);
    const valueCounts = new Map();

    eligibleOrders.forEach(o => {
      const val = getOrderFieldValue(o, colKey);
      valueCounts.set(val, (valueCounts.get(val) || 0) + 1);
    });

    const activeSet = window.agendasGridState.columnFilters[colKey] || null;

    const sortedValues = Array.from(valueCounts.keys()).sort((a, b) => {
      if (a === '') return -1;
      if (b === '') return 1;
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });

    const popover = document.createElement('div');
    popover.id = 'agendas-col-popover';
    popover.className = 'agendas-col-popover';

    // Posicionamiento inteligente bajo el botón
    const triggerRect = event.currentTarget.getBoundingClientRect();
    popover.style.top = `${triggerRect.bottom + 6}px`;
    popover.style.left = `${Math.max(10, Math.min(window.innerWidth - 340, triggerRect.left - 120))}px`;

    const itemsHtml = sortedValues.length === 0
      ? `<div style="padding: 1.5rem 1rem; text-align: center; color: var(--color-text-muted); font-size: 0.8rem;">No hay opciones disponibles en las filas visibles</div>`
      : sortedValues.map(val => {
          const count = valueCounts.get(val) || 0;
          const displayVal = val === '' ? '(Vacío)' : val;
          const isChecked = !activeSet || activeSet.has(val);
          const safeVal = String(val).replace(/"/g, '&quot;');
          const safeText = `${displayVal} ${val}`.toLowerCase();

          return `
            <label class="popover-item" data-text="${safeText}">
              <div style="display: flex; align-items: center; gap: 0.45rem; min-width: 0; flex: 1;">
                <input type="checkbox" class="agendas-filter-cb" data-value="${safeVal}" ${isChecked ? 'checked' : ''} style="width: 14px; height: 14px; accent-color: var(--color-primary); cursor: pointer;" />
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${displayVal}">${displayVal}</span>
              </div>
              <span style="font-size: 0.68rem; color: var(--color-text-muted); background: rgba(0,0,0,0.05); padding: 0.05rem 0.35rem; border-radius: 99px; font-weight: 600;">${count}</span>
            </label>
          `;
        }).join('');

    popover.innerHTML = `
      <div class="popover-header">
        <span>Filtrar ${colLabel}</span>
        <i class="ri-close-line" onclick="document.getElementById('agendas-col-popover').remove()"></i>
      </div>
      <div class="popover-search-container">
        <i class="ri-search-line"></i>
        <input type="text" id="agendas-popover-search" class="popover-search-input" placeholder="Buscar valores..." autocomplete="off" />
      </div>
      <div class="popover-actions">
        <div style="display: flex; gap: 0.35rem;">
          <button type="button" class="popover-quick-btn" onclick="window.setAllAgendasFilterCbs(true)">Todos</button>
          <button type="button" class="popover-quick-btn" onclick="window.setAllAgendasFilterCbs(false)">Ninguno</button>
        </div>
        <span id="agendas-popover-counter" style="font-size: 0.7rem; color: var(--color-text-muted); font-weight: 600;">${sortedValues.length} valores</span>
      </div>
      <div class="popover-list" id="agendas-popover-list">
        ${itemsHtml}
      </div>
      <div class="popover-footer">
        <button type="button" class="btn btn-outline" style="padding: 0.25rem 0.55rem; font-size: 0.75rem;" onclick="window.clearSingleColFilter('${colKey}')">Limpiar</button>
        <button type="button" class="btn btn-primary" style="padding: 0.25rem 0.75rem; font-size: 0.75rem; color: white;" onclick="window.applyAgendasColFilter('${colKey}')">Aplicar</button>
      </div>
    `;

    document.body.appendChild(popover);

    // Auto-focus buscador
    const searchInput = document.getElementById('agendas-popover-search');
    if (searchInput) {
      setTimeout(() => searchInput.focus(), 40);
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        const items = popover.querySelectorAll('.popover-item');
        let matches = 0;
        items.forEach(it => {
          const text = it.getAttribute('data-text') || '';
          if (!query || text.includes(query)) {
            it.style.display = 'flex';
            matches++;
          } else {
            it.style.display = 'none';
          }
        });
        document.getElementById('agendas-popover-counter').textContent = `${matches} coincidencias`;
      });
    }

    // Cerrar al hacer clic fuera
    setTimeout(() => {
      const clickOutsideHandler = (e) => {
        if (!popover.contains(e.target) && e.target !== event.currentTarget) {
          popover.remove();
          document.removeEventListener('click', clickOutsideHandler);
        }
      };
      document.addEventListener('click', clickOutsideHandler);
    }, 0);
  };

  window.setAllAgendasFilterCbs = function(checked) {
    const popover = document.getElementById('agendas-col-popover');
    if (!popover) return;
    popover.querySelectorAll('.popover-item').forEach(it => {
      if (it.style.display !== 'none') {
        const cb = it.querySelector('.agendas-filter-cb');
        if (cb) cb.checked = checked;
      }
    });
  };

  window.applyAgendasColFilter = function(colKey) {
    const popover = document.getElementById('agendas-col-popover');
    if (!popover) return;

    const checkedValues = new Set();
    let totalItems = 0;

    popover.querySelectorAll('.agendas-filter-cb').forEach(cb => {
      totalItems++;
      if (cb.checked) {
        checkedValues.add(cb.getAttribute('data-value'));
      }
    });

    popover.remove();

    // Si todos están marcados, equivale a no tener filtro
    if (checkedValues.size === totalItems) {
      delete window.agendasGridState.columnFilters[colKey];
    } else {
      window.agendasGridState.columnFilters[colKey] = checkedValues;
    }

    window.renderAgendasGrid();
  };

  window.clearSingleColFilter = function(colKey) {
    const popover = document.getElementById('agendas-col-popover');
    if (popover) popover.remove();
    delete window.agendasGridState.columnFilters[colKey];
    window.renderAgendasGrid();
  };

  // ==========================================================================
  // 12. Exportación a Excel (.xlsx) con SheetJS
  // ==========================================================================
  window.exportAgendasToExcel = function() {
    if (typeof XLSX === 'undefined') {
      Swal.fire('Error', 'La biblioteca XLSX no se encuentra disponible.', 'error');
      return;
    }

    const visibleOrders = window.agendasGridState.filteredOrders || [];
    if (visibleOrders.length === 0) {
      Swal.fire('Atención', 'No hay pedidos visibles para exportar.', 'info');
      return;
    }

    const dataToExport = visibleOrders.map((order, i) => {
      const row = { 'N° Fila': i + 1 };
      COLUMN_DEFS.forEach(col => {
        row[col.label] = getOrderFieldValue(order, col.key);
      });
      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Gestion_Agendas');

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `Gestion_Agendas_STOCKA_${dateStr}.xlsx`);
  };

  // ==========================================================================
  // 13. Sincronización Manual
  // ==========================================================================
  window.refreshAgendasGrid = async function() {
    await loadOptirouteOrdersStatusCache();
    window.renderAgendasGrid();
    const toast = Swal.mixin({
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 1500
    });
    toast.fire({
      icon: 'success',
      title: 'Datos sincronizados con éxito'
    });
  };

  // ==========================================================================
  // 13.b Selección de Pedidos y Despacho Híbrido Optiroute (API & Excel)
  // ==========================================================================
  function escapeHtml(str) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(str);
    if (!str && str !== 0) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function updateSelectionUi() {
    const selectedSet = window.agendasGridState.selectedOrderIds;
    const selectedCount = selectedSet ? selectedSet.size : 0;
    
    // 1. Contenedor en Toolbar
    const container = document.getElementById('agendas-batch-actions-container');
    if (container) {
      if (selectedCount > 0) {
        container.innerHTML = `
          <div class="agendas-batch-actions">
            <span class="agendas-batch-badge">
              <i class="ri-checkbox-circle-fill"></i> ${selectedCount} selec.
            </span>
            <button type="button" class="btn btn-primary btn-optiroute-action" onclick="window.openOptirouteDispatchModal()" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 700;" title="Generar ruta de entrega en Optiroute con los pedidos seleccionados">
              <i class="ri-truck-line" style="font-size: 0.95rem;"></i> Generar Ruta Optiroute
            </button>
            <button type="button" class="btn btn-outline" onclick="window.clearAgendasSelection()" style="padding: 0.35rem 0.55rem; font-size: 0.8rem;" title="Deseleccionar todos los pedidos">
              <i class="ri-close-line"></i>
            </button>
          </div>
        `;
      } else {
        container.innerHTML = '';
      }
    }

    // 2. Checkbox Maestro Cabecera
    const masterCb = document.getElementById('agendas-select-all-cb');
    if (masterCb) {
      const visibleOrders = window.agendasGridState.filteredOrders || [];
      if (visibleOrders.length === 0 || selectedCount === 0) {
        masterCb.checked = false;
        masterCb.indeterminate = false;
      } else {
        let visibleSelectedCount = 0;
        visibleOrders.forEach(o => {
          if (selectedSet.has(String(o.id))) visibleSelectedCount++;
        });
        if (visibleSelectedCount === 0) {
          masterCb.checked = false;
          masterCb.indeterminate = false;
        } else if (visibleSelectedCount === visibleOrders.length) {
          masterCb.checked = true;
          masterCb.indeterminate = false;
        } else {
          masterCb.checked = false;
          masterCb.indeterminate = true;
        }
      }
    }
  }

  window.toggleAgendasRowSelection = function(orderId, isChecked) {
    if (!window.agendasGridState.selectedOrderIds) {
      window.agendasGridState.selectedOrderIds = new Set();
    }
    const idStr = String(orderId);
    if (isChecked) {
      window.agendasGridState.selectedOrderIds.add(idStr);
    } else {
      window.agendasGridState.selectedOrderIds.delete(idStr);
    }

    const tr = document.querySelector(`.agendas-excel-table tbody tr[data-order-id="${idStr}"]`);
    if (tr) {
      if (isChecked) tr.classList.add('row-selected');
      else tr.classList.remove('row-selected');
    }

    updateSelectionUi();
  };

  window.toggleSelectAllAgendas = function(masterCb) {
    if (!window.agendasGridState.selectedOrderIds) {
      window.agendasGridState.selectedOrderIds = new Set();
    }
    const shouldSelect = masterCb.checked;
    const visibleOrders = window.agendasGridState.filteredOrders || [];

    visibleOrders.forEach(o => {
      const idStr = String(o.id);
      if (shouldSelect) {
        window.agendasGridState.selectedOrderIds.add(idStr);
      } else {
        window.agendasGridState.selectedOrderIds.delete(idStr);
      }
    });

    const rowCheckboxes = document.querySelectorAll('.agendas-excel-table tbody .agendas-row-cb');
    rowCheckboxes.forEach(cb => {
      cb.checked = shouldSelect;
      const tr = cb.closest('tr');
      if (tr) {
        if (shouldSelect) tr.classList.add('row-selected');
        else tr.classList.remove('row-selected');
      }
    });

    updateSelectionUi();
  };

  window.clearAgendasSelection = function() {
    if (window.agendasGridState.selectedOrderIds) {
      window.agendasGridState.selectedOrderIds.clear();
    }
    const masterCb = document.getElementById('agendas-select-all-cb');
    if (masterCb) {
      masterCb.checked = false;
      masterCb.indeterminate = false;
    }
    const rowCheckboxes = document.querySelectorAll('.agendas-excel-table tbody .agendas-row-cb');
    rowCheckboxes.forEach(cb => {
      cb.checked = false;
      const tr = cb.closest('tr');
      if (tr) tr.classList.remove('row-selected');
    });

    updateSelectionUi();
  };

  function attachSelectCellEvents() {
    const selectCells = document.querySelectorAll('.agendas-excel-table tbody .excel-cell-select');
    selectCells.forEach(cell => {
      cell.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        const cb = cell.querySelector('input.agendas-row-cb');
        if (cb) {
          cb.checked = !cb.checked;
          const orderId = cb.getAttribute('data-order-id');
          window.toggleAgendasRowSelection(orderId, cb.checked);
        }
      });
    });
  }

  async function getOptirouteToken() {
    if (window.activeOptirouteToken) return window.activeOptirouteToken;
    const sb = getSupabase();
    if (!sb) return null;
    const { data, error } = await sb
      .from('merchant_integrations')
      .select('access_token')
      .eq('platform', 'Optiroute')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (error || !data || !data.access_token) return null;
    window.activeOptirouteToken = data.access_token;
    return data.access_token;
  }

  // ==========================================================================
  // Helper de extracción de datos completos para Optiroute (Excel y API)
  // ==========================================================================
  function getOptirouteReference(order) {
    if (!order) return '';
    return String(order.external_order_number || order.order_number || order.numero_orden || order.numero_pedido || order.name || order.id || '').trim();
  }

  function getOptirouteCustomerName(order) {
    if (!order) return '';
    const valFromField = getOrderFieldValue(order, 'cliente');
    if (valFromField && valFromField !== 'No registrado' && valFromField.trim() !== '') {
      return valFromField.trim();
    }
    let name = order.customer_name || order.shipping_name || order.nombre_destinatario || '';
    if (!name || name === 'No registrado' || name === 'Cliente Jumpseller' || (order.raw_jumpseller_data && !name.includes(' '))) {
      if (order.raw_shopify_data?.billing_address) {
        const b = order.raw_shopify_data.billing_address;
        name = `${b.first_name || ''} ${b.last_name || ''}`.trim();
      } else if (order.raw_shopify_data?.customer) {
        const c = order.raw_shopify_data.customer;
        name = `${c.first_name || ''} ${c.last_name || ''}`.trim();
      } else if (order.raw_jumpseller_data) {
        const raw = order.raw_jumpseller_data;
        name = [raw.shipping_address?.name || raw.shipping_address?.first_name, raw.shipping_address?.surname || raw.shipping_address?.last_name].filter(Boolean).join(' ').trim()
          || (raw.customer?.fullname || [raw.customer?.name, raw.customer?.surname].filter(Boolean).join(' ') || '').trim();
      } else if (order.raw_woocommerce_data?.billing) {
        const b = order.raw_woocommerce_data.billing;
        name = `${b.first_name || ''} ${b.last_name || ''}`.trim();
      }
    }
    if (!name || name === 'No registrado') name = '';
    return String(name).trim();
  }

  function getOptirouteAddress(order) {
    if (!order) return '';
    const valFromField = getOrderFieldValue(order, 'direccion');
    if (valFromField && valFromField !== '-' && valFromField.trim() !== '') {
      return valFromField.trim();
    }
    let addr = order.shipping_address || order.address || '';
    if (!addr && order.raw_shopify_data?.shipping_address?.address1) {
      addr = order.raw_shopify_data.shipping_address.address1;
    } else if (!addr && order.raw_shopify_data?.billing_address?.address1) {
      addr = order.raw_shopify_data.billing_address.address1;
    } else if (!addr && order.raw_jumpseller_data?.shipping_address?.address) {
      addr = order.raw_jumpseller_data.shipping_address.address;
    } else if (!addr && order.raw_woocommerce_data?.shipping?.address_1) {
      addr = order.raw_woocommerce_data.shipping.address_1;
    }
    if (addr === '-') addr = '';
    return String(addr).trim();
  }

  function getOptirouteComplement(order) {
    if (!order) return '';
    const valFromField = getOrderFieldValue(order, 'complemento');
    if (valFromField && valFromField !== '-' && valFromField.trim() !== '') {
      return valFromField.trim();
    }
    let comp = order.shipping_complement || order.address_additional || order.depto || order.departamento || '';
    if (!comp && order.raw_shopify_data?.shipping_address?.address2) {
      comp = order.raw_shopify_data.shipping_address.address2;
    } else if (!comp && order.raw_shopify_data?.billing_address?.address2) {
      comp = order.raw_shopify_data.billing_address.address2;
    } else if (!comp && order.raw_jumpseller_data?.shipping_address?.additional_information) {
      comp = order.raw_jumpseller_data.shipping_address.additional_information;
    } else if (!comp && order.raw_woocommerce_data?.shipping?.address_2) {
      comp = order.raw_woocommerce_data.shipping.address_2;
    }
    if (comp === '-') comp = '';
    return String(comp).trim();
  }

  function getOptirouteExtra(order) {
    if (!order) return '';
    let extra = order.notes || order.observacion || order.shipping_notes || order.customer_note || '';
    if (!extra && order.raw_shopify_data?.note) {
      extra = order.raw_shopify_data.note;
    } else if (!extra && order.raw_jumpseller_data?.customer_notes) {
      extra = order.raw_jumpseller_data.customer_notes;
    }
    return String(extra).trim();
  }

  function getOptirouteCommune(order) {
    if (!order) return '';
    const valFromField = getOrderFieldValue(order, 'comuna');
    if (valFromField && valFromField !== '-' && valFromField !== 'Por definir' && valFromField.trim() !== '') {
      return valFromField.trim();
    }
    let c = order.shipping_city || order.comuna || '';
    if (!c && order.raw_shopify_data?.shipping_address?.city) {
      c = order.raw_shopify_data.shipping_address.city;
    } else if (!c && order.raw_jumpseller_data?.shipping_address?.city) {
      c = order.raw_jumpseller_data.shipping_address.city;
    }
    return String(c).trim();
  }

  function getOptirouteEmail(order) {
    if (!order) return '';
    let email = order.customer_email || order.email || order.correo || '';
    if (!email || email === 'No registrado' || email.trim() === '') {
      if (order.raw_shopify_data) {
        const raw = order.raw_shopify_data;
        email = raw.contact_email || raw.email || raw.customer?.email || '';
      } else if (order.raw_jumpseller_data) {
        const raw = order.raw_jumpseller_data;
        email = raw.customer?.email || raw.shipping_address?.email || raw.billing_address?.email || '';
      } else if (order.raw_woocommerce_data?.billing?.email) {
        email = order.raw_woocommerce_data.billing.email;
      } else if (order.raw_tiendanube_data?.customer?.email) {
        email = order.raw_tiendanube_data.customer.email;
      }
    }
    if (email === 'No registrado' || email === 'sin email') email = '';
    return String(email).trim();
  }

  function getOptiroutePhone(order) {
    if (!order) return '';
    let phone = order.customer_phone || order.phone || order.telefono || '';
    if (!phone || phone === 'No registrado' || phone.trim() === '') {
      if (order.raw_shopify_data) {
        const raw = order.raw_shopify_data;
        phone = raw.shipping_address?.phone || raw.billing_address?.phone || raw.customer?.phone || raw.phone || '';
      } else if (order.raw_jumpseller_data) {
        const raw = order.raw_jumpseller_data;
        phone = raw.customer?.phone || raw.shipping_address?.phone || raw.billing_address?.phone || '';
      } else if (order.raw_woocommerce_data) {
        const raw = order.raw_woocommerce_data;
        phone = raw.billing?.phone || raw.shipping?.phone || '';
      } else if (order.raw_tiendanube_data) {
        const raw = order.raw_tiendanube_data;
        phone = raw.customer?.phone || raw.shipping_address?.phone || '';
      }
    }
    if (phone === 'No registrado' || phone === 'Sin teléfono') phone = '';
    let cleanPhone = String(phone).replace(/[^0-9+]/g, '').trim();
    if (cleanPhone.startsWith('+569') && cleanPhone.length === 12) {
      cleanPhone = cleanPhone.substring(3);
    } else if (cleanPhone.startsWith('569') && cleanPhone.length === 11) {
      cleanPhone = cleanPhone.substring(2);
    } else if (cleanPhone.startsWith('+56') && cleanPhone.length > 9) {
      cleanPhone = cleanPhone.substring(3);
    }
    return cleanPhone;
  }

  // ==========================================================================
  // Sincronización y Resolución de Proveedores Optiroute
  // ==========================================================================
  window.optirouteMerchantsConfigMap = window.optirouteMerchantsConfigMap || {};

  async function loadOptirouteMerchantsConfig() {
    try {
      const sb = getSupabase();
      if (!sb) return;
      const { data, error } = await sb
        .from('comercios_adicional_config')
        .select('comercio, optiroute_proveedor, plat_siglas_config');

      if (error) {
        // Si la columna optiroute_proveedor no existe aún en PostgreSQL, consultar con fallback
        if (error.code === '42703' || (error.message && error.message.includes('optiroute_proveedor'))) {
          const { data: dataFallback } = await sb
            .from('comercios_adicional_config')
            .select('comercio, plat_siglas_config');
          if (dataFallback && Array.isArray(dataFallback)) {
            dataFallback.forEach(item => {
              if (item && item.comercio) {
                const opti = (item.plat_siglas_config?.optiroute_proveedor || '').trim();
                if (opti) {
                  window.optirouteMerchantsConfigMap[String(item.comercio).trim().toUpperCase()] = opti;
                }
              }
            });
          }
        }
        return;
      }

      if (data && Array.isArray(data)) {
        data.forEach(item => {
          if (item && item.comercio) {
            const opti = (item.optiroute_proveedor || item.plat_siglas_config?.optiroute_proveedor || '').trim();
            if (opti) {
              window.optirouteMerchantsConfigMap[String(item.comercio).trim().toUpperCase()] = opti;
            }
          }
        });
      }
    } catch (e) {
      console.warn('Excepción al cargar configuraciones de proveedores Optiroute:', e);
    }
  }

  function getOptirouteProveedorForComercio(comercioName) {
    if (!comercioName) return 'STOCKA';
    const rawComercio = String(comercioName).trim();
    if (!rawComercio) return 'STOCKA';
    const upperComercio = rawComercio.toUpperCase();

    // 1. Verificar si está en window.optirouteMerchantsConfigMap (cargado de DB)
    if (window.optirouteMerchantsConfigMap && window.optirouteMerchantsConfigMap[upperComercio]) {
      return window.optirouteMerchantsConfigMap[upperComercio];
    }

    // 2. Verificar si está en window.cachedAdminMerchants
    if (Array.isArray(window.cachedAdminMerchants)) {
      const foundM = window.cachedAdminMerchants.find(m => (m.nombre || '').trim().toUpperCase() === upperComercio);
      if (foundM) {
        const customOpti = (foundM.optiroute_proveedor || foundM.plat_siglas_config?.optiroute_proveedor || '').trim();
        if (customOpti && OPTIROUTE_SUPPLIERS.includes(customOpti)) {
          return customOpti;
        }
      }
    }

    // 3. Mapeo Canónico WMS -> Proveedores Optiroute
    if (DEFAULT_WMS_TO_OPTIROUTE_MAP[upperComercio]) {
      return DEFAULT_WMS_TO_OPTIROUTE_MAP[upperComercio];
    }

    // 4. Coincidencia directa exacta en el catálogo de los 45 proveedores oficiales
    if (OPTIROUTE_SUPPLIERS.includes(upperComercio)) {
      return upperComercio;
    }

    // 5. Coincidencia normalizada (sin espacios ni caracteres especiales)
    const cleanUpper = upperComercio.replace(/[^A-Z0-9]/g, '');
    const normMatch = OPTIROUTE_SUPPLIERS.find(s => s.replace(/[^A-Z0-9]/g, '') === cleanUpper);
    if (normMatch) {
      return normMatch;
    }

    // 6. Fallback oficial garantizado: STOCKA
    return 'STOCKA';
  }

  function getOptirouteProveedor(order) {
    if (!order) return 'STOCKA';
    return getOptirouteProveedorForComercio(order.comercio);
  }

  // IDs numéricos oficiales de Proveedores registrados en Optiroute
  const OPTIROUTE_SUPPLIER_IDS = {
    'AIRPURE': 19363,
    'B4LIFE': 22356,
    'BACK IN TIME': 18412,
    'BE NATIVE': 25403,
    'CROMO': 21108,
    'DG ORAL CARE': 25238,
    'DORMILONES': 18680,
    'EL MUNDO DEL CAFE': 20065,
    'FORTE MAX': 26901,
    'GLOSS': 26394,
    'GRANJA MAGDALENA PET': 19081,
    'LA MANTA CHILENA': 25658,
    'LAQU': 20293,
    'LIVROS': 25680,
    'MAESE': 18792,
    'MAGIC MAKEUP': 25459,
    'MARINA VITAL': 20581,
    'MEDSKILLS': 18730,
    'MMEDD': 18786,
    'MUKAVA': 19195,
    'NATIVA ELEMENTS': 20665,
    'OPARD': 20735,
    'POM KIDS': 26803,
    'PORTONESAUTOMAT': 20308,
    'RCT CHILE': 18754,
    'RELAJARTE': 19362,
    'SAGUAROSHOES': 18704,
    'SILVER FOX': 26013,
    'SIMPLEMENTE CAFE': 25809,
    'SMILE FOR PETS': 25356,
    'STOCKA': 18647,
    'STREET GYM': 23685,
    'THE SKIN STORE': 26298,
    'TIENDA 1': 18584,
    'TIENDA 2': 19862,
    'TIENDA 3': 19863
  };
  window.OPTIROUTE_SUPPLIER_IDS = OPTIROUTE_SUPPLIER_IDS;

  function getOptirouteSupplierId(comercioOrProvName) {
    if (!comercioOrProvName) return OPTIROUTE_SUPPLIER_IDS['STOCKA'] || 18647;
    // 1. Si ya es o resuelve a un proveedor oficial conocido
    const resolvedProv = getOptirouteProveedorForComercio(comercioOrProvName);
    if (resolvedProv && OPTIROUTE_SUPPLIER_IDS[resolvedProv]) {
      return OPTIROUTE_SUPPLIER_IDS[resolvedProv];
    }
    const clean = String(comercioOrProvName).toUpperCase().trim();
    if (OPTIROUTE_SUPPLIER_IDS[clean]) {
      return OPTIROUTE_SUPPLIER_IDS[clean];
    }
    const simplified = clean.replace(/[^A-Z0-9]/g, '');
    for (const [name, id] of Object.entries(OPTIROUTE_SUPPLIER_IDS)) {
      if (name.replace(/[^A-Z0-9]/g, '') === simplified) {
        return id;
      }
    }
    return OPTIROUTE_SUPPLIER_IDS['STOCKA'] || 18647;
  }
  window.getOptirouteSupplierId = getOptirouteSupplierId;

  window.getOptirouteProveedorForComercio = getOptirouteProveedorForComercio;
  window.getOptirouteProveedor = getOptirouteProveedor;
  window.loadOptirouteMerchantsConfig = loadOptirouteMerchantsConfig;

  window.openOptirouteDispatchModal = async function() {
    const selectedIds = window.agendasGridState.selectedOrderIds ? Array.from(window.agendasGridState.selectedOrderIds) : [];
    if (selectedIds.length === 0) {
      Swal.fire('Atención', 'No hay pedidos seleccionados. Marca las casillas de los pedidos que deseas despachar.', 'info');
      return;
    }

    // Asegurar que las configuraciones de proveedores de comercios estén sincronizadas
    await loadOptirouteMerchantsConfig();

    const allOrders = window.loadedOrders || [];
    const selectedOrders = allOrders.filter(o => window.agendasGridState.selectedOrderIds.has(String(o.id)));
    if (selectedOrders.length === 0) {
      Swal.fire('Atención', 'No se pudieron encontrar los datos de los pedidos seleccionados.', 'warning');
      return;
    }

    // Estadísticas de comunas
    const communeCounts = {};
    selectedOrders.forEach(o => {
      const c = (getOptirouteCommune(o) || 'Sin comuna').trim();
      communeCounts[c] = (communeCounts[c] || 0) + 1;
    });
    const sortedCommunes = Object.entries(communeCounts).sort((a, b) => b[1] - a[1]);

    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String(now.getFullYear()).slice(-2);
    const defaultRouteName = `STK ${dd}-${mm}-${yy}`;

    const operatorsList = (window.operadorOptions && window.operadorOptions.length)
      ? window.operadorOptions
      : (typeof DEFAULT_OPERADORES !== 'undefined' ? DEFAULT_OPERADORES : ['STARKEN', 'BLUEXPRESS', 'CHILEXPRESS', 'ENVIAME', 'STOCKA X', 'ALPHA', 'SUCURSAL ÑUÑOA']);

    const modalConfig = {
      routeName: defaultRouteName,
      updateOperator: true,
      operatorValue: operatorsList.includes('STOCKA X') ? 'STOCKA X' : (operatorsList[0] || 'STOCKA X'),
      updateStatus: true
    };

    const communePillsHtml = sortedCommunes.map(([cName, count]) => `
      <span style="display: inline-flex; align-items: center; gap: 0.25rem; background: #e0f2fe; color: #0369a1; padding: 0.2rem 0.5rem; border-radius: 9999px; font-size: 0.73rem; font-weight: 600; border: 1px solid #bae6fd;">
        ${escapeHtml(cName)} <strong style="background: #0284c7; color: white; border-radius: 99px; padding: 0.02rem 0.35rem; font-size: 0.68rem;">${count}</strong>
      </span>
    `).join('');

    const previewRowsHtml = selectedOrders.map((rawOrder, idx) => {
      const o = (window.loadedOrders || []).find(lo => String(lo.id) === String(rawOrder.id)) || rawOrder;
      const ref = getOptirouteReference(o);
      const name = getOptirouteCustomerName(o);
      const commune = getOptirouteCommune(o);
      const address = getOptirouteAddress(o);
      const complement = getOptirouteComplement(o);
      const phone = getOptiroutePhone(o);
      const email = getOptirouteEmail(o);
      const proveedor = getOptirouteProveedor(o);

      return `
        <tr>
          <td style="text-align: center; color: var(--color-text-muted);">${idx + 1}</td>
          <td><strong>#${escapeHtml(ref)}</strong></td>
          <td>${escapeHtml(name || '-')}</td>
          <td><span style="background: rgba(99, 102, 241, 0.1); color: #4f46e5; font-size: 0.72rem; padding: 0.1rem 0.4rem; border-radius: 4px; font-weight: 600;">${escapeHtml(commune || '-')}</span></td>
          <td style="max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(address + (complement ? ' ' + complement : ''))}">
            ${escapeHtml(address || '-')} ${complement ? `<small style="color: #6366f1; font-weight: 600;">(${escapeHtml(complement)})</small>` : ''}
          </td>
          <td>${escapeHtml(phone || '-')}</td>
          <td style="max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(email)}">${escapeHtml(email || '-')}</td>
          <td><span style="font-size: 0.7rem; font-weight: 700; color: #475569;">${escapeHtml(proveedor || '-')}</span></td>
        </tr>
      `;
    }).join('');

    const modalHtml = `
      <div style="text-align: left; font-size: 0.85rem;">
        <!-- Header / Stats Bar -->
        <div style="background: linear-gradient(135deg, #f8fafc 0%, #ede9fe 100%); border: 1px solid #e0e7ff; border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 0.85rem; display: flex; align-items: center; justify-content: space-between;">
          <div>
            <div style="font-size: 0.72rem; text-transform: uppercase; color: #6366f1; font-weight: 700; letter-spacing: 0.04em;">Despacho de Pedidos</div>
            <div style="font-size: 1.15rem; font-weight: 800; color: #1e1b4b;">${selectedOrders.length} pedidos seleccionados</div>
          </div>
          <div style="text-align: right;">
            <span style="font-size: 0.75rem; color: #64748b; font-weight: 600;">Comunas involucradas:</span>
            <div style="font-size: 0.95rem; font-weight: 700; color: #334155;">${sortedCommunes.length} comuna(s)</div>
          </div>
        </div>

        <!-- Comunas Chips -->
        <div style="display: flex; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 0.85rem; max-height: 80px; overflow-y: auto;">
          ${communePillsHtml}
        </div>

        <!-- Configuración de Despacho -->
        <div style="background: #ffffff; border: 1px solid var(--color-border); border-radius: 8px; padding: 0.85rem; margin-bottom: 0.85rem; display: flex; flex-direction: column; gap: 0.75rem;">
          <!-- Nombre de la Ruta -->
          <div>
            <label style="display: block; font-weight: 700; font-size: 0.8rem; margin-bottom: 0.25rem; color: var(--color-text-main);">
              <i class="ri-map-pin-time-line" style="color: #4f46e5;"></i> Nombre de la Ruta / Plan Optiroute:
            </label>
            <input type="text" id="optiroute-route-name-input" class="swal2-input" value="${defaultRouteName}" style="margin: 0; width: 100%; height: 2.2rem; font-size: 0.85rem; padding: 0.3rem 0.6rem; border-radius: 6px; box-sizing: border-box;" placeholder="Ej: STK 05-10-26" />
            <span style="font-size: 0.72rem; color: var(--color-text-muted);">Se creará o asociará este plan de ruta en Optiroute para optimizar el despacho.</span>
          </div>

          <!-- Operador WMS -->
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.5rem 0.6rem; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0;">
            <div style="display: flex; align-items: center; gap: 0.45rem;">
              <input type="checkbox" id="optiroute-update-operator-cb" checked style="width: 16px; height: 16px; accent-color: #4f46e5; cursor: pointer;" />
              <label for="optiroute-update-operator-cb" style="font-weight: 600; font-size: 0.8rem; cursor: pointer; margin: 0;">
                Asignar Operador WMS:
              </label>
            </div>
            <select id="optiroute-operator-select" class="swal2-select" style="margin: 0; height: 2rem; font-size: 0.8rem; padding: 0.15rem 0.5rem; border-radius: 6px; min-width: 140px;">
              ${operatorsList.map(op => `
                <option value="${escapeHtml(op)}" ${op.toUpperCase() === 'STOCKA X' || op.toUpperCase() === 'STOCKA' ? 'selected' : ''}>${escapeHtml(op)}</option>
              `).join('')}
            </select>
          </div>

          <!-- Estado WMS -->
          <div style="display: flex; align-items: center; gap: 0.45rem; padding: 0.5rem 0.6rem; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0;">
            <input type="checkbox" id="optiroute-update-status-cb" checked style="width: 16px; height: 16px; accent-color: #4f46e5; cursor: pointer;" />
            <label for="optiroute-update-status-cb" style="font-weight: 600; font-size: 0.8rem; cursor: pointer; margin: 0;">
              Cambiar estado WMS a <span style="color: #0284c7; font-weight: 700;">"En preparación"</span> (para picking y empaque)
            </label>
          </div>
        </div>

        <!-- Tabla de Previsualización -->
        <div style="font-weight: 700; font-size: 0.78rem; color: var(--color-text-muted); text-transform: uppercase; margin-bottom: 0.35rem;">
          <i class="ri-list-check-2"></i> Previsualización de Pedidos (${selectedOrders.length})
        </div>
        <div class="optiroute-preview-table-wrap">
          <table class="optiroute-orders-preview-table">
            <thead>
              <tr>
                <th style="width: 28px; text-align: center;">#</th>
                <th>N° Pedido</th>
                <th>Cliente</th>
                <th>Comuna</th>
                <th>Dirección</th>
                <th>Teléfono</th>
                <th>Correo</th>
                <th>Proveedor</th>
              </tr>
            </thead>
            <tbody>
              ${previewRowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const result = await Swal.fire({
      title: '<div style="display: flex; align-items: center; justify-content: center; gap: 0.5rem; font-size: 1.25rem;"><i class="ri-truck-fill" style="color: #4f46e5;"></i> Generar Despacho en Optiroute</div>',
      html: modalHtml,
      width: '840px',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: '<i class="ri-cloud-upload-line"></i> Enviar Directo a Optiroute API',
      denyButtonText: '<i class="ri-file-excel-2-line"></i> Descargar Planilla Excel',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#4f46e5',
      denyButtonColor: '#059669',
      cancelButtonColor: '#64748b',
      focusConfirm: false,
      didOpen: () => {
        const routeInput = document.getElementById('optiroute-route-name-input');
        const updateOpCb = document.getElementById('optiroute-update-operator-cb');
        const opSelect = document.getElementById('optiroute-operator-select');
        const updateStatusCb = document.getElementById('optiroute-update-status-cb');

        if (routeInput) routeInput.addEventListener('input', (e) => { modalConfig.routeName = e.target.value.trim(); });
        if (updateOpCb) {
          updateOpCb.addEventListener('change', (e) => {
            modalConfig.updateOperator = e.target.checked;
            if (opSelect) opSelect.disabled = !e.target.checked;
          });
        }
        if (opSelect) opSelect.addEventListener('change', (e) => { modalConfig.operatorValue = e.target.value; });
        if (updateStatusCb) updateStatusCb.addEventListener('change', (e) => { modalConfig.updateStatus = e.target.checked; });
      }
    });

    if (result.isConfirmed) {
      await window.executeOptirouteApiDispatch(selectedOrders, modalConfig);
    } else if (result.isDenied) {
      await window.executeOptirouteExcelDownload(selectedOrders, modalConfig);
    }
  };

  window.executeOptirouteExcelDownload = async function(selectedOrders, config) {
    if (typeof XLSX === 'undefined') {
      Swal.fire('Error', 'La biblioteca XLSX no está disponible.', 'error');
      return;
    }

    const routeName = (config.routeName || 'Ruta Optiroute').trim();

    // Construir filas para Optiroute con la plantilla y nombres de columnas oficiales
    const rows = selectedOrders.map((rawOrder) => {
      const o = (window.loadedOrders || []).find(lo => String(lo.id) === String(rawOrder.id)) || rawOrder;
      return {
        'nombre': getOptirouteCustomerName(o),
        'dirección': getOptirouteAddress(o),
        'departamento': getOptirouteComplement(o),
        'extra': getOptirouteExtra(o),
        'comuna': getOptirouteCommune(o),
        'correo': getOptirouteEmail(o),
        'teléfono': getOptiroutePhone(o),
        'demanda': '',
        'referencia_pedido': getOptirouteReference(o),
        'proveedor': getOptirouteProveedor(o),
        'habilidades': '',
        'latitud': '',
        'longitud': '',
        'ventana_inicio': '',
        'ventana_termino': '',
        'tiempo_entrega': ''
      };
    });

    const headersOrder = [
      'nombre',
      'dirección',
      'departamento',
      'extra',
      'comuna',
      'correo',
      'teléfono',
      'demanda',
      'referencia_pedido',
      'proveedor',
      'habilidades',
      'latitud',
      'longitud',
      'ventana_inicio',
      'ventana_termino',
      'tiempo_entrega'
    ];

    const ws = XLSX.utils.json_to_sheet(rows, { header: headersOrder });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ruta_Optiroute');

    const safeRouteName = routeName.replace(/[^a-zA-Z0-9_\-]/g, '_');
    XLSX.writeFile(wb, `Planilla_Optiroute_${safeRouteName}.xlsx`);

    // Actualizar pedidos en WMS si el usuario lo marcó
    const updates = [];
    selectedOrders.forEach(o => {
      updates.push({ orderId: o.id, field: 'estado_ruta_optiroute', value: 'creado' });
      if (config.updateOperator && config.operatorValue) {
        updates.push({ orderId: o.id, field: 'operador', value: config.operatorValue });
      }
      if (config.updateStatus) {
        updates.push({ orderId: o.id, field: 'estado_wms', value: 'En preparación' });
      }
    });

    if (updates.length > 0) {
      await window.batchUpdateAgendasOrders(updates);
    }

    window.clearAgendasSelection();

    Swal.fire({
      icon: 'success',
      title: '¡Planilla Optiroute Descargada!',
      html: `
        <div style="font-size: 0.9rem; text-align: left; padding: 0.5rem;">
          <p style="margin-bottom: 0.5rem;">
            Se descargó el archivo Excel con <strong>${selectedOrders.length}</strong> pedidos formateados para Optiroute.
          </p>
          <p style="margin-bottom: 0.5rem; color: #4f46e5;">
            <i class="ri-file-excel-line"></i> Archivo: <strong>Planilla_Optiroute_${safeRouteName}.xlsx</strong>
          </p>
          <p style="margin-bottom: 0.5rem; color: #1d4ed8;">
            <i class="ri-route-line"></i> Ruta Optiroute: <strong class="excel-badge-opti-creado">creado</strong> (Listo para armar ruta en Optiroute)
          </p>
          ${config.updateOperator ? `<p style="margin-bottom: 0.5rem; color: #0f766e;">
            <i class="ri-user-follow-line"></i> Operador WMS actualizado a: <strong>${escapeHtml(config.operatorValue)}</strong>
          </p>` : ''}
          ${config.updateStatus ? `<p style="margin-bottom: 0.5rem; color: #0284c7;">
            <i class="ri-loader-2-line"></i> Estado WMS actualizado a: <strong>En preparación</strong>
          </p>` : ''}
          <p style="font-size: 0.8rem; color: #64748b; margin-top: 0.8rem;">
            Puedes cargar esta planilla directamente en <a href="https://app.optiroute.cl/" target="_blank" style="color: #4f46e5; font-weight: 600;">app.optiroute.cl</a> en la sección de Carga Masiva.
          </p>
        </div>
      `,
      confirmButtonText: 'Entendido',
      confirmButtonColor: '#4f46e5'
    });
  };

  let cachedRecentOptiOrdersMap = null;

  async function getRecentOptirouteOrdersMap(token) {
    if (cachedRecentOptiOrdersMap) return cachedRecentOptiOrdersMap;
    const map = new Map();
    try {
      const now = new Date();
      now.setDate(now.getDate() - 7);
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yyyy = now.getFullYear();
      const startDate = `${dd}-${mm}-${yyyy}`;

      let url = `https://app.optiroute.cl/api/v1/integration-service-requests/?per_page=100&creationStartDate=${startDate}`;
      let pages = 0;
      while (url && pages < 5) {
        pages++;
        const resp = await fetch(url, { headers: { 'Authorization': `Token ${token}` } });
        if (!resp.ok) break;
        const data = await resp.json();
        const list = Array.isArray(data) ? data : (data.results || []);
        list.forEach(sr => {
          if (sr && sr.reference && sr.id) {
            map.set(String(sr.reference).trim().toLowerCase(), Number(sr.id));
          }
        });
        url = data.next || null;
      }
    } catch (e) {
      console.warn('Error precargando pedidos recientes de Optiroute:', e);
    }
    cachedRecentOptiOrdersMap = map;
    return map;
  }

  async function findExistingOptirouteServiceRequestId(token, ref) {
    if (!token || !ref) return null;
    const cleanRef = String(ref).trim().toLowerCase();

    // 1. Buscar en el mapa de pedidos recientes por creationStartDate (últimos 7 días)
    const map = await getRecentOptirouteOrdersMap(token);
    if (map && map.has(cleanRef)) {
      return map.get(cleanRef);
    }

    // 2. Buscar por endpoint directo /{ref}/
    try {
      const directResp = await fetch(`https://app.optiroute.cl/api/v1/integration-service-requests/${encodeURIComponent(ref)}/`, {
        headers: { 'Authorization': `Token ${token}` }
      });
      if (directResp.ok) {
        const data = await directResp.json();
        if (data && data.id && Number.isInteger(Number(data.id))) {
          map.set(cleanRef, Number(data.id));
          return Number(data.id);
        }
      }
    } catch (eDirect) {
      console.warn('Aviso buscando pedido por ID directo en Optiroute:', eDirect);
    }

    return null;
  }

  window.executeOptirouteApiDispatch = async function(selectedOrders, config) {
    cachedRecentOptiOrdersMap = null;
    // 1. Mostrar progreso inicial
    Swal.fire({
      title: 'Conectando con Optiroute...',
      html: `
        <div style="padding: 0.5rem 0;">
          <div id="optiroute-progress-label" style="font-size: 0.85rem; font-weight: 600; color: #334155; margin-bottom: 0.5rem;">
            Obteniendo credenciales y configuración...
          </div>
          <div style="width: 100%; background: #e2e8f0; border-radius: 99px; height: 10px; overflow: hidden; margin-bottom: 0.5rem;">
            <div id="optiroute-progress-bar" style="width: 5%; height: 100%; background: #4f46e5; transition: width 0.2s ease;"></div>
          </div>
          <div id="optiroute-progress-count" style="font-size: 0.8rem; color: #64748b;">
            Iniciando proceso...
          </div>
        </div>
      `,
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    const progressBar = document.getElementById('optiroute-progress-bar');
    const progressLabel = document.getElementById('optiroute-progress-label');
    const progressCount = document.getElementById('optiroute-progress-count');

    // 2. Obtener Token y cargar mapeos de proveedores
    let token = null;
    try {
      token = await getOptirouteToken();
      await loadOptirouteMerchantsConfig();
    } catch (errToken) {
      console.error('Error fetching Optiroute token/config:', errToken);
    }

    if (!token) {
      Swal.fire({
        icon: 'error',
        title: 'Token no disponible',
        html: `
          <p>No se pudo obtener el token de autorización de Optiroute desde <code>merchant_integrations</code>.</p>
          <p style="font-size: 0.85rem; color: #64748b; margin-top: 0.5rem;">
            Puedes utilizar la opción <strong>Descargar Planilla Excel</strong> para cargar los pedidos manualmente en Optiroute, o activar la integración en el WMS.
          </p>
        `,
        confirmButtonText: 'Entendido',
        confirmButtonColor: '#4f46e5'
      });
      return;
    }

    // 3. Crear o buscar el Plan de Rutas en Optiroute ANTES de procesar los pedidos
    let targetRoutePlanId = null;
    const routeName = (config.routeName || '').trim();

    if (routeName) {
      if (progressLabel) progressLabel.textContent = `Preparando Plan de Rutas "${routeName}" en Optiroute...`;
      if (progressBar) progressBar.style.width = '12%';

      try {
        const getRpResp = await fetch('https://app.optiroute.cl/api/v1/route-plans/?per_page=100', {
          headers: { 'Authorization': `Token ${token}` }
        });
        if (getRpResp.ok) {
          const rpData = await getRpResp.json();
          const list = rpData.results || rpData || [];
          const match = Array.isArray(list) && list.find(rp => rp.name && rp.name.trim().toLowerCase() === routeName.toLowerCase());
          if (match && match.id) {
            targetRoutePlanId = match.id;
          }
        }
      } catch (e) {
        console.warn('Error consultando planes de rutas existentes:', e);
      }

      // Si no existe, crear el plan de rutas
      if (!targetRoutePlanId) {
        try {
          const now = new Date();
          const yyyy = now.getFullYear();
          const mm = String(now.getMonth() + 1).padStart(2, '0');
          const dd = String(now.getDate()).padStart(2, '0');
          const departureIso = `${yyyy}-${mm}-${dd}T08:00:00-03:00`;
          const finishIso = `${yyyy}-${mm}-${dd}T20:00:00-03:00`;

          const createRpResp = await fetch('https://app.optiroute.cl/api/v1/route-plans/', {
            method: 'POST',
            headers: {
              'Authorization': `Token ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              name: routeName,
              departure_datetime: departureIso,
              finish_datetime: finishIso
            })
          });

          if (createRpResp.ok) {
            const newRp = await createRpResp.json();
            if (newRp && newRp.id) {
              targetRoutePlanId = newRp.id;
              console.log(`✅ Plan de rutas "${routeName}" creado en Optiroute (ID #${targetRoutePlanId})`);
            }
          } else {
            console.warn('Aviso al crear plan de rutas:', await createRpResp.text());
          }
        } catch (errCreateRp) {
          console.warn('Excepción al crear plan de rutas:', errCreateRp);
        }
      }
    }

    // 4. Crear o actualizar cada pedido en Optiroute asociándolo al plan y proveedor
    const total = selectedOrders.length;
    const createdServiceRequestIds = [];
    const errors = [];
    let successCount = 0;

    for (let i = 0; i < total; i++) {
      const rawOrder = selectedOrders[i];
      const o = (window.loadedOrders || []).find(lo => String(lo.id) === String(rawOrder.id)) || rawOrder;
      const ref = getOptirouteReference(o);
      const provName = getOptirouteProveedorForComercio(o.comercio);
      const suppId = getOptirouteSupplierId(provName || o.comercio);
      
      if (progressLabel) progressLabel.textContent = `Enviando pedido ${ref} (${i + 1}/${total})...`;
      if (progressCount) progressCount.textContent = `Procesando ${i + 1} de ${total} pedidos (${Math.round(((i + 1) / total) * 100)}%)`;
      if (progressBar) progressBar.style.width = `${15 + Math.round(((i + 1) / total) * 65)}%`;

      const extraDetails = getOptirouteExtra(o) || '';

      const payload = {
        reference: ref,
        customer: {
          name: getOptirouteCustomerName(o) || 'Cliente',
          phone_number: getOptiroutePhone(o),
          email: getOptirouteEmail(o)
        },
        address: {
          address_string: getOptirouteAddress(o),
          commune_string: getOptirouteCommune(o),
          apartment_number: getOptirouteComplement(o),
          address_more_info: extraDetails
        }
      };

      if (suppId) {
        payload.supplier = { id: suppId };
      }

      try {
        const resp = await fetch('https://app.optiroute.cl/api/v1/integration-service-requests/', {
          method: 'POST',
          headers: {
            'Authorization': `Token ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (resp.ok) {
          const data = await resp.json();
          if (data && data.id) {
            createdServiceRequestIds.push(data.id);
          }
          successCount++;
        } else {
          const errJson = await resp.json().catch(() => null);
          const errStr = JSON.stringify(errJson || '');
          const isDuplicateRef = errStr.includes('Ya existe una solicitud de servicio') || errStr.includes('already exists');

          if (isDuplicateRef) {
            // El pedido ya existe en Optiroute (por ejemplo, de una ruta anterior que fue borrada).
            // Recuperamos su ID real en Optiroute y lo reutilizamos para vincularlo a la nueva ruta
            if (progressLabel) progressLabel.textContent = `Pedido ${ref} ya existe en Optiroute. Reutilizando para "${routeName || 'nueva ruta'}"...`;
            const existingId = await findExistingOptirouteServiceRequestId(token, ref);
            if (existingId) {
              createdServiceRequestIds.push(existingId);
              successCount++;
              try {
                const patchPayload = { ...payload };
                const patchResp = await fetch(`https://app.optiroute.cl/api/v1/integration-service-requests/${existingId}/`, {
                  method: 'PATCH',
                  headers: {
                    'Authorization': `Token ${token}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify(patchPayload)
                });
                if (!patchResp.ok) {
                  console.warn(`Aviso al actualizar pedido ${existingId} en Optiroute:`, await patchResp.text());
                }
              } catch (ePatch) {
                console.warn('Error en PATCH de pedido existente:', ePatch);
              }
            } else {
              errors.push({ ref, error: 'Ya existe en Optiroute pero no se pudo recuperar su ID numérico para vincularlo a la nueva ruta.' });
            }
          } else {
            const errMsg = errJson ? JSON.stringify(errJson) : `HTTP ${resp.status}`;
            console.warn(`Error enviando pedido ${ref} a Optiroute:`, errMsg);
            errors.push({ ref, error: errMsg });
          }
        }
      } catch (errFetch) {
        console.error(`Excepción enviando pedido ${ref} a Optiroute:`, errFetch);
        errors.push({ ref, error: errFetch.message });
      }
    }

    // 5. Vincular masivamente los pedidos al Plan de Rutas en Optiroute
    if (targetRoutePlanId && createdServiceRequestIds.length > 0) {
      if (progressLabel) progressLabel.textContent = `Asegurando ${createdServiceRequestIds.length} pedidos en el Plan de Rutas...`;
      if (progressBar) progressBar.style.width = '88%';

      console.log(`🔗 Vinculando ${createdServiceRequestIds.length} pedidos al plan #${targetRoutePlanId} en Optiroute:`, createdServiceRequestIds);

      // Endpoint oficial documentado: POST /api/v1/route-plans/{id}/add_service_requests
      try {
        const respAddNoSlash = await fetch(`https://app.optiroute.cl/api/v1/route-plans/${targetRoutePlanId}/add_service_requests`, {
          method: 'POST',
          headers: {
            'Authorization': `Token ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            service_requests: createdServiceRequestIds
          })
        });
        console.log('Optiroute add_service_requests (sin slash):', respAddNoSlash.status);
      } catch (eAddNoSlash) {
        console.warn('Error en add_service_requests (sin slash):', eAddNoSlash);
      }

      // Con slash: POST /api/v1/route-plans/{id}/add_service_requests/
      try {
        const respAddSlash = await fetch(`https://app.optiroute.cl/api/v1/route-plans/${targetRoutePlanId}/add_service_requests/`, {
          method: 'POST',
          headers: {
            'Authorization': `Token ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            service_requests: createdServiceRequestIds
          })
        });
        console.log('Optiroute add_service_requests/ (con slash):', respAddSlash.status);
      } catch (eAddSlash) {
        console.warn('Error en add_service_requests/ (con slash):', eAddSlash);
      }

      // Endpoint con guión: POST /api/v1/route-plans/{id}/add-service-requests/
      try {
        const respAddHyphen = await fetch(`https://app.optiroute.cl/api/v1/route-plans/${targetRoutePlanId}/add-service-requests/`, {
          method: 'POST',
          headers: {
            'Authorization': `Token ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            service_requests: createdServiceRequestIds
          })
        });
        console.log('Optiroute add-service-requests/ (con guión):', respAddHyphen.status);
      } catch (eAddHyphen) {
        console.warn('Error en add-service-requests/ (con guión):', eAddHyphen);
      }

      // PATCH directo a route-plans/{id}/
      try {
        const respPatch = await fetch(`https://app.optiroute.cl/api/v1/route-plans/${targetRoutePlanId}/`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Token ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            service_requests: createdServiceRequestIds
          })
        });
        console.log('Optiroute PATCH route-plans/:', respPatch.status);
      } catch (ePatch) {
        console.warn('Error en PATCH route-plans/:', ePatch);
      }
    }

    // 6. Actualizar pedidos en base de datos WMS
    if (progressLabel) progressLabel.textContent = 'Actualizando pedidos en WMS STOCKA...';
    if (progressBar) progressBar.style.width = '96%';

    const updates = [];
    selectedOrders.forEach(o => {
      const orderRef = String(o.external_order_number || o.numero_orden || o.id);
      const hadError = errors.some(e => String(e.ref) === orderRef);
      if (!hadError) {
        updates.push({ orderId: o.id, field: 'estado_ruta_optiroute', value: 'creado' });
      }
      if (config.updateOperator && config.operatorValue) {
        updates.push({ orderId: o.id, field: 'operador', value: config.operatorValue });
      }
      if (config.updateStatus) {
        updates.push({ orderId: o.id, field: 'estado_wms', value: 'En preparación' });
      }
    });

    if (updates.length > 0) {
      try {
        await window.batchUpdateAgendasOrders(updates);
      } catch (errBatch) {
        console.warn('Error al actualizar pedidos en base de datos:', errBatch);
      }
    }

    if (progressBar) progressBar.style.width = '100%';

    // 7. Limpiar selección y mostrar resumen final con guía interactiva
    window.clearAgendasSelection();

    if (successCount === 0 && errors.length > 0) {
      Swal.fire({
        icon: 'error',
        title: 'Error al enviar a Optiroute',
        html: `
          <p>No se pudo enviar ninguno de los pedidos seleccionados a Optiroute API.</p>
          <div style="max-height: 150px; overflow-y: auto; text-align: left; background: #fee2e2; padding: 0.5rem; border-radius: 6px; font-size: 0.78rem; margin-top: 0.5rem;">
            ${errors.map(e => `<div><strong>${escapeHtml(e.ref)}:</strong> ${escapeHtml(e.error)}</div>`).join('')}
          </div>
          <p style="margin-top: 0.5rem; font-size: 0.8rem; color: #64748b;">
            Puedes utilizar la opción <strong>Descargar Planilla Excel</strong> para no detener tu operación.
          </p>
        `,
        confirmButtonText: 'Entendido',
        confirmButtonColor: '#ef4444'
      });
      return;
    }

    Swal.fire({
      icon: errors.length > 0 ? 'warning' : 'success',
      title: errors.length > 0 ? 'Envío completado con advertencias' : '¡Despacho a Optiroute exitoso!',
      html: `
        <div style="font-size: 0.9rem; text-align: left; padding: 0.5rem;">
          <p style="margin-bottom: 0.5rem;">
            Se sincronizaron <strong>${successCount}</strong> de <strong>${total}</strong> pedidos correctamente en Optiroute API.
          </p>
          <p style="margin-bottom: 0.5rem; color: #1d4ed8;">
            <i class="ri-route-line"></i> Ruta Optiroute: <strong class="excel-badge-opti-creado">creado</strong> (Listo para optimizar)
          </p>
          ${targetRoutePlanId ? `
            <p style="margin-bottom: 0.5rem; color: #4f46e5;">
              <i class="ri-route-line"></i> Plan de Rutas: <strong>${escapeHtml(routeName)}</strong> (ID #${targetRoutePlanId})
            </p>
          ` : ''}
          ${config.updateOperator ? `
            <p style="margin-bottom: 0.5rem; color: #0f766e;">
              <i class="ri-user-follow-line"></i> Operador WMS asignado: <strong>${escapeHtml(config.operatorValue)}</strong>
            </p>
          ` : ''}
          ${config.updateStatus ? `
            <p style="margin-bottom: 0.5rem; color: #0284c7;">
              <i class="ri-loader-2-line"></i> Estado WMS actualizado a: <strong>En preparación</strong>
            </p>
          ` : ''}
          <div style="margin-top: 0.75rem; padding: 0.65rem 0.85rem; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; font-size: 0.8rem; color: #166534; line-height: 1.45;">
            <strong style="display: block; margin-bottom: 0.2rem;"><i class="ri-lightbulb-line"></i> ¿Cómo ver y armar la ruta en Optiroute?</strong>
            Tus pedidos ya están cargados en Optiroute. Al abrir tu plan de rutas en Optiroute:
            <ul style="margin: 0.35rem 0 0 1.1rem; padding: 0;">
              <li>Si los pedidos están pre-cargados, pulsa <strong>"Optimizar"</strong> para calcular los trayectos.</li>
              <li>Si el plan aparece inicialmente en blanco esperando confirmación, haz clic en el botón superior <strong>[Desde Pedidos]</strong>, selecciona los pedidos ingresados y haz clic en <strong>"Agregar"</strong>.</li>
            </ul>
          </div>
          ${errors.length > 0 ? `
            <div style="margin-top: 0.6rem; padding: 0.4rem; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; font-size: 0.78rem; color: #b45309;">
              <strong>${errors.length} pedido(s) con error:</strong>
              ${errors.slice(0, 5).map(e => `<div>#${escapeHtml(e.ref)}: ${escapeHtml(e.error)}</div>`).join('')}
              ${errors.length > 5 ? `<div>... y ${errors.length - 5} más</div>` : ''}
            </div>
          ` : ''}
          <div style="margin-top: 1.25rem; text-align: center;">
            <a href="https://app.optiroute.cl/" target="_blank" class="btn btn-primary" style="text-decoration: none; display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.45rem 1.1rem; font-weight: 700;">
              <i class="ri-external-link-line"></i> Abrir Optiroute para Optimizar Ruta
            </a>
          </div>
        </div>
      `,
      confirmButtonText: 'Aceptar',
      confirmButtonColor: '#4f46e5'
    });
  };

  // ==========================================================================
  // 13.b Sincronización en Tiempo Real de Estados de Ruta desde Optiroute API
  // ==========================================================================
  window.syncAgendasWithOptiroute = async function() {
    const btn = document.getElementById('btn-agendas-sync-optiroute');
    let origHtml = '';
    if (btn) {
      origHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Sincronizando...';
    }

    try {
      const token = await getOptirouteToken();
      if (!token) {
        Swal.fire('Error', 'No se encontró el token de autorización de Optiroute.', 'error');
        return;
      }

      const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 2500,
        timerProgressBar: true
      });
      Toast.fire({
        icon: 'info',
        title: 'Consultando estados y asignaciones en Optiroute...'
      });

      // Sincronizar referencias asignadas a RUTAS ACTIVAS directamente desde Optiroute API
      try {
        await window.loadOptirouteActiveAssignedRefs({ silent: false });
      } catch (eActive) {
        console.warn('Aviso cargando rutas activas:', eActive);
      }

      // Consultar pedidos recientes en Optiroute (últimos 7 días)
      const now = new Date();
      now.setDate(now.getDate() - 7);
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yyyy = now.getFullYear();
      const startDate = `${dd}-${mm}-${yyyy}`;

      let url = `https://app.optiroute.cl/api/v1/integration-service-requests/?per_page=100&creationStartDate=${startDate}`;
      const optiMap = new Map();
      let pageCount = 0;

      while (url && pageCount < 3) {
        pageCount++;
        const resp = await fetch(url, { headers: { 'Authorization': `Token ${token}` } });
        if (!resp.ok) break;
        const data = await resp.json();
        const results = data.results || data || [];

        results.forEach(item => {
          if (!item.reference) return;
          const refKey = String(item.reference).trim().toLowerCase();
          const rawSt = String(item.status || '').toUpperCase().trim();
          const hasDriver = Boolean(
            item.assigned_driver || 
            item.driver || 
            item.waypoint?.route_driver ||
            item.waypoint?.route
          );

          let derivedStatus = 'creado';
          if (['SKIPPED', 'CANCELLED', 'DELETED', 'RECHAZADO', '-4', '-1'].includes(rawSt)) {
            derivedStatus = 'descartado';
          } else if (hasDriver || ['ONROUTE', 'ONGOING', 'ARRIVED', 'DELIVERED', 'COMPLETED', '6', '2', '3'].includes(rawSt)) {
            derivedStatus = 'confirmado';
          } else if (item.route_plan && (!item.waypoint || !hasDriver)) {
            // Está en un plan pero no tiene móvil/conductor asignado -> descartado por el optimizador
            derivedStatus = 'descartado';
          }

          optiMap.set(refKey, {
            status: derivedStatus,
            driverName: item.assigned_driver?.name || null,
            vehicleName: item.assigned_vehicle?.name || null,
            planName: item.route_plan?.name || null
          });

          // Actualizar caché de estados
          if (window.optirouteOrdersStatusCache) {
            window.optirouteOrdersStatusCache.set(refKey, derivedStatus);
          }
        });

        url = data.next || null;
      }

      // Cruzar con window.loadedOrders y preparar actualizaciones
      const loaded = window.loadedOrders || [];
      const updates = [];
      let confCount = 0;
      let descCount = 0;
      let creadCount = 0;

      loaded.forEach(order => {
        const ref = String(order.external_order_number || order.numero_orden || order.numero_pedido || '').trim().toLowerCase();
        const isConfirmadoEnRutaActiva = typeof window.isOrderOptirouteConfirmado === 'function' 
          ? window.isOrderOptirouteConfirmado(order) 
          : (window.optirouteActiveAssignedRefs && window.optirouteActiveAssignedRefs.has(ref));

        if (isConfirmadoEnRutaActiva) {
          const currentStatus = String(order.estado_ruta_optiroute || '').trim().toLowerCase();
          if (currentStatus !== 'confirmado') {
            updates.push({
              orderId: order.id,
              field: 'estado_ruta_optiroute',
              value: 'confirmado'
            });
            order.estado_ruta_optiroute = 'confirmado';
          }
          confCount++;
        } else if (optiMap.has(ref)) {
          const optiInfo = optiMap.get(ref);
          // Si Optiroute devuelve 'confirmado' pero NO pertenece a una ruta activa, tratar como 'creado'
          const targetStatus = optiInfo.status === 'confirmado' ? 'creado' : optiInfo.status;
          const currentStatus = String(order.estado_ruta_optiroute || '').trim().toLowerCase();
          
          if (targetStatus !== currentStatus && targetStatus) {
            updates.push({
              orderId: order.id,
              field: 'estado_ruta_optiroute',
              value: targetStatus
            });
            order.estado_ruta_optiroute = targetStatus;
          }

          if (targetStatus === 'descartado') descCount++;
          else creadCount++;
        }
      });

      // Guardar cambios en Supabase en lote
      if (updates.length > 0) {
        try {
          await window.batchUpdateAgendasOrders(updates);
        } catch (eUpd) {
          console.warn('Aviso guardando estado_ruta_optiroute en Supabase:', eUpd);
        }
      }

      // Re-renderizar la cuadrícula y Torre de Control
      if (typeof window.updateOrderTagFilterOptions === 'function') {
        window.updateOrderTagFilterOptions();
      }
      if (typeof window.applyAgendasFiltersAndRender === 'function') {
        window.applyAgendasFiltersAndRender();
      }
      if (typeof window.applyWmsFiltersAndRender === 'function') {
        window.applyWmsFiltersAndRender();
      } else if (typeof window.renderOrdersTable === 'function') {
        window.renderOrdersTable();
      }

      Swal.fire({
        icon: 'success',
        title: 'Sincronización con Optiroute',
        html: `
          <div style="text-align: left; font-size: 0.88rem; padding: 0.25rem;">
            <p style="margin-bottom: 0.65rem;">Se sincronizaron los estados de ruta y asignaciones en tiempo real:</p>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.65rem 0.85rem; margin-bottom: 0.75rem;">
              <div style="margin-bottom: 0.35rem; color: #16a34a; font-weight: 600;">
                <i class="ri-checkbox-circle-fill"></i> <strong>${confCount} Asignados en Rutas Activas</strong> <span style="font-size: 0.75rem; color: #64748b; font-weight: normal;">(móvil y conductor en ruta activa)</span>
              </div>
              <div style="margin-bottom: 0.35rem; color: #dc2626; font-weight: 600;">
                <i class="ri-close-circle-fill"></i> <strong>${descCount} Descartados</strong> <span style="font-size: 0.75rem; color: #64748b; font-weight: normal;">(fuera de ruta o rechazados)</span>
              </div>
              <div style="color: #4f46e5; font-weight: 600;">
                <i class="ri-route-line"></i> <strong>${creadCount} Creados</strong> <span style="font-size: 0.75rem; color: #64748b; font-weight: normal;">(en preparación)</span>
              </div>
            </div>
            ${updates.length > 0 
              ? `<p style="font-size: 0.8rem; color: #0f766e; margin: 0;"><strong>${updates.length}</strong> pedido(s) cambiaron de estado y fueron guardados en el WMS.</p>` 
              : '<p style="font-size: 0.8rem; color: #64748b; margin: 0;">Todos los pedidos en pantalla ya estaban sincronizados con Optiroute.</p>'}
          </div>
        `,
        confirmButtonColor: '#4f46e5'
      });

    } catch (err) {
      console.error('Error sincronizando con Optiroute:', err);
      Swal.fire('Error al sincronizar', err.message || 'No se pudo sincronizar con Optiroute.', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    }
  };

  // ==========================================================================
  // 14. Eventos Globales de Teclado (Navegación, Copiar, Pegar)
  // ==========================================================================
  document.addEventListener('keydown', (e) => {
    // Si no estamos en la pestaña de agendas, omitir
    const agendasContainer = document.getElementById('subview-agendas-grid');
    if (!agendasContainer || agendasContainer.style.display === 'none') return;

    // Atajo Copiar (Ctrl+C / Cmd+C)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      handleGridCopy(e);
      return;
    }

    // Atajo Pegar (Ctrl+V / Cmd+V)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      handleGridPaste(e);
      return;
    }

    // Navegación con teclado en la grilla
    const active = window.agendasGridState.activeCell;
    if (!active) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

    const visibleOrders = window.agendasGridState.filteredOrders;
    const maxRows = visibleOrders.length;
    const currentColIndex = COLUMN_DEFS.findIndex(c => c.key === active.colKey);

    let nextRow = active.rowIndex;
    let nextCol = currentColIndex;

    if (e.key === 'Escape') {
      closeCellDropdown();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      nextRow = Math.min(maxRows - 1, active.rowIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      nextRow = Math.max(0, active.rowIndex - 1);
    } else if (e.key === 'ArrowRight' || e.key === 'Tab') {
      e.preventDefault();
      nextCol = (currentColIndex + 1) % COLUMN_DEFS.length;
      if (e.key === 'Tab' && nextCol === 0) {
        nextRow = Math.min(maxRows - 1, active.rowIndex + 1);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      nextCol = Math.max(0, currentColIndex - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (COLUMN_DEFS[currentColIndex]?.editable) {
        openCellDropdown(active.element);
      } else {
        nextRow = Math.min(maxRows - 1, active.rowIndex + 1);
      }
    }

    if (nextRow !== active.rowIndex || nextCol !== currentColIndex) {
      closeCellDropdown();
      const nextColKey = COLUMN_DEFS[nextCol].key;
      const targetCell = document.querySelector(`.excel-cell[data-row-index="${nextRow}"][data-col-key="${nextColKey}"]`);
      if (targetCell) {
        setActiveCell(targetCell);
        targetCell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
  });

})();
