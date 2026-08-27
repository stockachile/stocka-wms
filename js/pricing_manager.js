/**
 * Pricing Manager - STOCKA WMS Fulfillment 360
 * Basado en Tarifarios Stocka 2024-2025 v1.2 y configurable por el Administrador.
 */

// Configuración por defecto oficial (Tarifarios Stocka 2024-2025 v1.2)
export const DEFAULT_PRICING_CONFIG = {
  version: "1.2 (2024-2025)",
  updated_at: "2026-08-25",
  uf_value: 40867, // Valor UF de referencia en CLP actualizado en vivo

  // 1. Rangos de Pedidos Mensuales (fijan tarifa base de pick & pack y costo por m3)
  order_ranges: [
    { id: 1, min: 0, max: 25, label: "0 a 25 pedidos", storage_m3: 48900, pick_pack_base: 1250 },
    { id: 2, min: 26, max: 100, label: "26 a 100 pedidos", storage_m3: 43500, pick_pack_base: 1200 },
    { id: 3, min: 101, max: 200, label: "101 a 200 pedidos", storage_m3: 38500, pick_pack_base: 1150 },
    { id: 4, min: 201, max: 500, label: "201 a 500 pedidos", storage_m3: 33500, pick_pack_base: 1050 },
    { id: 5, min: 501, max: 1500, label: "501 a 1.500 pedidos", storage_m3: 30500, pick_pack_base: 950 },
    { id: 6, min: 1501, max: 2500, label: "1.501 a 2.500 pedidos", storage_m3: 28500, pick_pack_base: 900 },
    { id: 7, min: 2501, max: 999999, label: "+2.500 pedidos", storage_m3: 26500, pick_pack_base: 850 }
  ],

  // 2. Descuentos por volumen de almacenamiento (>10 m3)
  storage_discounts: [
    { min: 10.0, max: 15.0, discount_pct: 18, label: "10 - 15 m³ (18%)" },
    { min: 15.01, max: 25.0, discount_pct: 21, label: "15.1 - 25 m³ (21%)" },
    { min: 25.01, max: 35.0, discount_pct: 24, label: "25.1 - 35 m³ (24%)" },
    { min: 35.01, max: 60.0, discount_pct: 27, label: "35.1 - 60 m³ (27%)" },
    { min: 60.01, max: 999999, discount_pct: 32, label: "+60 m³ (32%)" }
  ],

  // 3. Reglas y Recargos de Pick & Pack
  pick_pack_rules: {
    base_included_sku: 3, // Hasta 3 SKU incluidos en tarifa base
    base_included_units: 10, // Hasta 10 unidades incluidas en tarifa base
    surcharge_extra_sku: 100, // $100 por cada SKU adicional > 3
    surcharge_extra_unit: 50, // $50 por cada unidad adicional > 10 (desde la 11)
    protected_ticket_threshold: 10000, // Ticket menor a $10.000 (venta protegida)
    protected_ticket_base_rate: 650, // Tarifa base rebajada para venta protegida ($650)
    surcharge_marketplace_collect: 100, // $100 por entrega en centro de envío / courier marketplace
    surcharge_catalogue_over_100_sku: 100, // $100 por pedido si catálogo > 100 SKU (aplica si >2 unidades)
    surcharge_ml_full_labeling: 100 // $100 por ítem etiquetado para envíos FULL
  },

  // 4. Costo Fijo Mensual de Servicio (si no se superan los mínimos de actividad)
  fixed_service_fee: {
    exemption_min_orders: 75, // Si pedidos >= 75 -> Costo fijo $0
    exemption_min_volume: 1.5, // Si volumen >= 1.5 m3 -> Costo fijo $0
    tier1_fee_uf: 1.5, // 1.5 UF si volumen < 1 m3 Y pedidos < 50
    tier2_fee_uf: 0.9 // 0.9 UF si no supera 1.5 m3 O 75 pedidos
  },

  // 5. Tarifas de Despacho y Entregas
  shipping: {
    same_day_rm: 3200, // Despacho Same Day RM y Flex MercadoLibre ($3.200 + IVA)
    colina: 3490, // Despacho a Colina ($3.490 + IVA)
    enviame_integration_fee: 35, // Cargo fijo integración Envíame por venta ($35)
    pickup_sucursal_standard: 0, // Retiro en sucursal gratuito (solo costo preparación)
    pickup_express_base: 1490, // Retiro Express inmediato en sucursal base ($1.490 + IVA)
    pickup_express_extra_unit: 150, // Recargo $150/unidad extra (tope 15)
    pickup_express_extra_sku: 150 // Recargo $150/sku extra (tope 6)
  },

  // 6. Insumos Opcionales (Empaque adicional no estándar)
  supplies: {
    bubble_wrap_sqm: 360, // m2 plástico burbuja ($360 + IVA)
    box_xs: 280, // Caja XS 10x10x10 cm ($280 + IVA)
    box_s: 450, // Caja S 20x20x20 cm ($450 + IVA)
    box_m: 990 // Caja M 30x30x30 cm ($990 + IVA)
  },

  // 7. Servicios Adicionales en Sucursal / Bodega
  services: {
    pos_monthly_uf: 0.2, // Punto de Venta mensual (0.2 UF)
    pos_fee_debit_pct: 2.5, // Comisión POS Débito 2.5%
    pos_fee_credit_pct: 3.5, // Comisión POS Crédito 3.5%
    vitrina_monthly_uf: 0.6, // Vitrina de exhibición (0.6 UF)
    showroom_sale_base: 1490, // Showroom venta $1.490 base
    unloading_service_uf_per_m3: 0.1, // Descarga camión/proveedor (0.1 UF/m3)
    unloading_service_cap_uf: 2.0 // Tope descarga (2.0 UF)
  },

  // 8. Cajas y Dimensiones Didácticas para Cálculo de Volumen
  didactic_items: [
    { id: "clothing", name: "Prendas / Ropa doblada / Accesorios", length: 30, width: 20, height: 10, volume_m3: 0.006, icon: "ri-t-shirt-line", default_qty: 0 },
    { id: "shoes", name: "Calzado / Cajas de Zapatos", length: 35, width: 25, height: 15, volume_m3: 0.013, icon: "ri-footprint-line", default_qty: 0 },
    { id: "box_s", name: "Caja Pequeña S (Cosmética, Joyería, Tech)", length: 20, width: 20, height: 20, volume_m3: 0.008, icon: "ri-archive-line", default_qty: 0 },
    { id: "box_m", name: "Caja Mediana M (Artículos Generales, Deco)", length: 30, width: 30, height: 30, volume_m3: 0.027, icon: "ri-box-3-line", default_qty: 0 },
    { id: "box_l", name: "Caja Grande L (Voluminosos, Packs)", length: 50, width: 40, height: 30, volume_m3: 0.060, icon: "ri-archive-stack-line", default_qty: 0 },
    { id: "box_xl", name: "Caja Master XL / Bultos Importación", length: 60, width: 50, height: 40, volume_m3: 0.120, icon: "ri-layout-grid-line", default_qty: 0 },
    { id: "pallet", name: "Pallet Estándar (1.2m x 1.0m x 1.5m)", length: 120, width: 100, height: 150, volume_m3: 1.800, icon: "ri-building-line", default_qty: 0 },
    { id: "rack", name: "Estantería / Rack (1.0m x 0.5m x 2.0m)", length: 100, width: 50, height: 200, volume_m3: 1.000, icon: "ri-grid-line", default_qty: 0 }
  ],

  // 9. Presentaciones Comerciales de Servicios (Descargables en Cotizador y Correo)
  presentations: {
    fulfillment_url: "https://wms.stocka.cl/downloads/presentacion_fulfillment_360.pdf",
    fulfillment_name: "Presentación de Servicio Fulfillment 360 (PDF)",
    fulfillment_storage_path: "presentations/presentacion_fulfillment_360.pdf",
    fulfillment_updated_at: "2026-08-25",
    despachos_rm_url: "https://wms.stocka.cl/downloads/presentacion_despachos_rm.pdf",
    despachos_rm_name: "Presentación de Despachos RM y Cobertura (PDF)",
    despachos_rm_storage_path: "presentations/presentacion_despachos_rm.pdf",
    despachos_rm_updated_at: "2026-08-25"
  },

  // 10. Estimaciones de Envíos a Regiones por Peso Promedio y Zonas Populares (Vía Envíame)
  regional_shipping: {
    enviame_integration_fee: 35,
    default_weight_bracket: '1_3kg',
    weight_brackets: [
      { id: '0_1kg', label: 'Hasta 1 kg (Paquete Ligero)', avg_rate: 3950, cheapest_courier: 'Starken / Envíame' },
      { id: '1_3kg', label: '1 a 3 kg (Estándar E-commerce)', avg_rate: 4050, cheapest_courier: 'Starken / Envíame' },
      { id: '3_6kg', label: '3 a 6 kg (Paquete Mediano)', avg_rate: 6450, cheapest_courier: 'Starken / Envíame' },
      { id: '6_9kg', label: '6 a 9 kg (Paquete Grande)', avg_rate: 6790, cheapest_courier: 'Starken / Envíame' }
    ],
    popular_destinations: [
      { city: 'Valparaíso / Viña del Mar', zone: 'Zona Centro', rate_1_3kg: 3335, courier: 'Starken' },
      { city: 'Coquimbo / La Serena', zone: 'Norte Chico', rate_1_3kg: 3748, courier: 'Starken' },
      { city: 'Concepción / Biobío', zone: 'Zona Sur', rate_1_3kg: 4174, courier: 'Starken' },
      { city: 'Antofagasta / Calama', zone: 'Zona Norte', rate_1_3kg: 5294, courier: 'Starken' },
      { city: 'Rancagua / Machalí', zone: 'Centro-Sur', rate_1_3kg: 3460, courier: 'Starken' },
      { city: 'Temuco / Araucanía', zone: 'Zona Sur', rate_1_3kg: 4038, courier: 'Starken' },
      { city: 'Puerto Montt / Los Lagos', zone: 'Sur Austral', rate_1_3kg: 4223, courier: 'Starken' }
    ]
  }
};

const STORAGE_KEY = "stocka_wms_pricing_config_v1";

/**
 * Obtiene el valor real en vivo de la UF desde mindicador.cl o caché local del día
 */
export async function getLiveUfValue() {
  const today = new Date().toISOString().slice(0, 10);
  
  // 1. Intentar desde caché local si corresponde a hoy
  try {
    if (typeof localStorage !== 'undefined') {
      const cached = JSON.parse(localStorage.getItem('stocka-uf') || 'null');
      if (cached && cached.date === today && cached.numericValue && cached.numericValue > 30000) {
        return cached.numericValue;
      }
    }
  } catch (e) {}

  // 2. Fetch desde API oficial mindicador.cl
  try {
    const res = await fetch('https://mindicador.cl/api/uf');
    if (res.ok) {
      const data = await res.json();
      const val = data?.serie?.[0]?.valor;
      if (val && !isNaN(val) && val > 30000) {
        const numVal = Math.round(parseFloat(val));
        const formatted = numVal.toLocaleString('es-CL');
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('stocka-uf', JSON.stringify({
            date: today,
            value: `$${formatted}`,
            numericValue: numVal
          }));
          localStorage.setItem('stocka-last-uf-backup', numVal.toString());
        }
        return numVal;
      }
    }
  } catch (e) {
    console.warn('No se pudo obtener UF en vivo de mindicador.cl:', e);
  }

  // 3. Respaldo previo en localStorage
  try {
    if (typeof localStorage !== 'undefined') {
      const backup = localStorage.getItem('stocka-last-uf-backup');
      if (backup && !isNaN(backup) && parseFloat(backup) > 30000) {
        return Math.round(parseFloat(backup));
      }
    }
  } catch (e) {}

  // 4. Fallback oficial actualizado
  return 40867;
}

/**
 * Carga la configuración de precios desde Supabase o localStorage con fallback a la configuración por defecto.
 */
export async function loadPricingConfig(supabaseClient = null) {
  let loadedConfig = null;

  // Intentar cargar desde Supabase si hay cliente disponible
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('pricing_config')
        .select('data')
        .eq('config_key', 'current_rates')
        .maybeSingle();

      if (!error && data && data.data) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data.data));
        loadedConfig = data.data;
      }
    } catch (e) {
      console.warn("No se pudo conectar a pricing_config en Supabase, usando almacenamiento local:", e);
    }
  }

  // Fallback a localStorage
  if (!loadedConfig) {
    try {
      const local = localStorage.getItem(STORAGE_KEY);
      if (local) {
        const parsed = JSON.parse(local);
        if (parsed && parsed.order_ranges) {
          loadedConfig = parsed;
        }
      }
    } catch (e) {
      console.warn("Error leyendo pricing config de localStorage:", e);
    }
  }

  // Fallback definitivo a defaults oficiales
  if (!loadedConfig) {
    loadedConfig = JSON.parse(JSON.stringify(DEFAULT_PRICING_CONFIG));
  }

  // Actualizar UF en vivo para garantizar cálculo exacto con la UF real del día
  try {
    const liveUf = await getLiveUfValue();
    if (liveUf && liveUf > 30000) {
      loadedConfig.uf_value = liveUf;
    }
  } catch (e) {}

  return loadedConfig;
}

/**
 * Guarda una nueva configuración de tarifas (sincroniza en Supabase y localStorage).
 */
export async function savePricingConfig(newConfig, supabaseClient = null) {
  newConfig.updated_at = new Date().toISOString();
  
  // Guardar en localStorage
  localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));

  // Guardar en Supabase si está disponible
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient
        .from('pricing_config')
        .upsert({
          config_key: 'current_rates',
          data: newConfig,
          updated_at: new Date().toISOString()
        }, { onConflict: 'config_key' });

      if (error) {
        console.error("Error guardando pricing_config en Supabase:", error);
        return { success: false, error: error.message };
      }
    } catch (e) {
      console.error("Excepción al guardar pricing_config en Supabase:", e);
      return { success: false, error: e.message };
    }
  }

  return { success: true };
}

/**
 * Restablece la configuración de tarifas a los valores por defecto oficiales.
 */
export async function resetPricingConfigToDefaults(supabaseClient = null) {
  const defaults = JSON.parse(JSON.stringify(DEFAULT_PRICING_CONFIG));
  return await savePricingConfig(defaults, supabaseClient);
}

/**
 * Motor de Cálculo de Cotización.
 * Calcula Almacenamiento, Pick & Pack, Costo Fijo, Despachos y Extras.
 */
export function calculateQuotation(inputs, config = DEFAULT_PRICING_CONFIG) {
  const monthlyOrders = Math.max(0, parseInt(inputs.monthlyOrders, 10) || 0);
  const storageVolumeM3 = Math.max(0, parseFloat(inputs.storageVolumeM3) || 0);
  const ufValue = parseFloat(config.uf_value) || 38500;

  // 1. Determinar el Rango Tarifario Activo según los pedidos mensuales
  let activeRange = config.order_ranges[0];
  for (const r of config.order_ranges) {
    if (monthlyOrders >= r.min && monthlyOrders <= r.max) {
      activeRange = r;
      break;
    }
  }
  // Si supera el máximo de la lista
  if (monthlyOrders > config.order_ranges[config.order_ranges.length - 1].min) {
    activeRange = config.order_ranges[config.order_ranges.length - 1];
  }

  // Progreso al siguiente rango
  let nextRange = null;
  let ordersToNextRange = 0;
  const currentRangeIndex = config.order_ranges.findIndex(r => r.id === activeRange.id);
  if (currentRangeIndex >= 0 && currentRangeIndex < config.order_ranges.length - 1) {
    nextRange = config.order_ranges[currentRangeIndex + 1];
    ordersToNextRange = Math.max(0, nextRange.min - monthlyOrders);
  }

  // 2. Cálculo de Almacenamiento
  const baseStorageM3Rate = activeRange.storage_m3;
  const grossStorageCost = storageVolumeM3 * baseStorageM3Rate;

  // Determinar descuento por volumen de almacenamiento (> 10 m3)
  let storageDiscountPct = 0;
  let storageDiscountLabel = "Sin descuento (< 10 m³)";
  if (config.storage_discounts && config.storage_discounts.length > 0) {
    for (const d of config.storage_discounts) {
      if (storageVolumeM3 >= d.min && storageVolumeM3 <= d.max) {
        storageDiscountPct = d.discount_pct;
        storageDiscountLabel = `${d.discount_pct}% dcto por volumen (${d.min} - ${d.max === 999999 ? '+60' : d.max} m³)`;
        break;
      }
    }
  }
  const storageDiscountAmount = grossStorageCost * (storageDiscountPct / 100);
  const netStorageCost = grossStorageCost - storageDiscountAmount;

  // 3. Cálculo de Pick & Pack (Preparación de Pedidos)
  const isProtectedSale = !!inputs.isProtectedSale; // Ticket < $10.000
  const basePickPackRate = isProtectedSale 
    ? (config.pick_pack_rules.protected_ticket_base_rate || 650)
    : activeRange.pick_pack_base;

  const skuPerOrder = Math.max(1, parseInt(inputs.skuPerOrder, 10) || 1);
  const unitsPerOrder = Math.max(1, parseInt(inputs.unitsPerOrder, 10) || 1);
  const isMarketplaceCollect = !!inputs.isMarketplaceCollect;
  const hasOver100SkuCatalogue = !!inputs.hasOver100SkuCatalogue;

  // Recargos unitarios por pedido
  const extraSkuCount = Math.max(0, skuPerOrder - (config.pick_pack_rules.base_included_sku || 3));
  const surchargeExtraSku = extraSkuCount * (config.pick_pack_rules.surcharge_extra_sku || 100);

  const extraUnitsCount = Math.max(0, unitsPerOrder - (config.pick_pack_rules.base_included_units || 10));
  const surchargeExtraUnits = extraUnitsCount * (config.pick_pack_rules.surcharge_extra_unit || 50);

  const surchargeMarketplace = isMarketplaceCollect ? (config.pick_pack_rules.surcharge_marketplace_collect || 100) : 0;
  
  // Recargo por catálogo > 100 SKU no aplica en pedidos con 2 o menos unidades
  const surchargeCatalogue = (hasOver100SkuCatalogue && unitsPerOrder > 2) 
    ? (config.pick_pack_rules.surcharge_catalogue_over_100_sku || 100) 
    : 0;

  const unitPickPackCost = basePickPackRate + surchargeExtraSku + surchargeExtraUnits + surchargeMarketplace + surchargeCatalogue;
  const totalPickPackCost = monthlyOrders * unitPickPackCost;

  // 4. Cálculo de Costo Fijo Mensual de Servicio
  const minOrdersExemption = config.fixed_service_fee.exemption_min_orders || 75;
  const minVolumeExemption = config.fixed_service_fee.exemption_min_volume || 1.5;
  
  let fixedFeeExempt = false;
  let fixedFeeUF = 0;
  let fixedFeeCLP = 0;
  let fixedFeeReason = "";

  if (monthlyOrders >= minOrdersExemption || storageVolumeM3 >= minVolumeExemption) {
    fixedFeeExempt = true;
    fixedFeeUF = 0;
    fixedFeeCLP = 0;
    fixedFeeReason = `Exento ($0) por alcanzar ${monthlyOrders >= minOrdersExemption ? '≥ 75 pedidos' : '≥ 1.5 m³ de almacenamiento'}`;
  } else if (storageVolumeM3 < 1.0 && monthlyOrders < 50) {
    fixedFeeUF = config.fixed_service_fee.tier1_fee_uf || 1.5;
    fixedFeeCLP = Math.round(fixedFeeUF * ufValue);
    fixedFeeReason = `Costo fijo 1.5 UF (${formatCLP(fixedFeeCLP)}) por operar con < 50 pedidos y < 1 m³`;
  } else {
    fixedFeeUF = config.fixed_service_fee.tier2_fee_uf || 0.9;
    fixedFeeCLP = Math.round(fixedFeeUF * ufValue);
    fixedFeeReason = `Costo fijo 0.9 UF (${formatCLP(fixedFeeCLP)}) por operar con < 75 pedidos y < 1.5 m³`;
  }

  // 5. Despachos y Envíos Proyectados
  const shipmentsSameDay = Math.max(0, parseInt(inputs.shipmentsSameDay, 10) || 0);
  const shipmentsCourier = Math.max(0, parseInt(inputs.shipmentsCourier, 10) || 0);
  const pickupsExpress = Math.max(0, parseInt(inputs.pickupsExpress, 10) || 0);

  // Envíos a Regiones por Peso Promedio y Courier más económico
  const regionalWeightBracketId = inputs.regionalWeightBracket || config.regional_shipping?.default_weight_bracket || '1_3kg';
  const weightBrackets = config.regional_shipping?.weight_brackets || [
    { id: '0_1kg', label: 'Hasta 1 kg (Paquete Ligero)', avg_rate: 3950, cheapest_courier: 'Starken / Envíame' },
    { id: '1_3kg', label: '1 a 3 kg (Estándar E-commerce)', avg_rate: 4050, cheapest_courier: 'Starken / Envíame' },
    { id: '3_6kg', label: '3 a 6 kg (Paquete Mediano)', avg_rate: 6450, cheapest_courier: 'Starken / Envíame' },
    { id: '6_9kg', label: '6 a 9 kg (Paquete Grande)', avg_rate: 6790, cheapest_courier: 'Starken / Envíame' }
  ];
  const activeWeightBracket = weightBrackets.find(w => w.id === regionalWeightBracketId) || weightBrackets[1];
  
  const regionalAvgCourierRate = activeWeightBracket.avg_rate || 4050;
  const enviameFeePerOrder = config.shipping.enviame_integration_fee || 35;
  const unitRegionalShipmentRate = regionalAvgCourierRate + enviameFeePerOrder;

  const costShipmentsSameDay = shipmentsSameDay * (config.shipping.same_day_rm || 3200);
  const costCourierIntegration = shipmentsCourier * enviameFeePerOrder;
  const costCourierFreight = shipmentsCourier * regionalAvgCourierRate;
  const costCourierTotal = shipmentsCourier * unitRegionalShipmentRate;
  const costPickupsExpress = pickupsExpress * (config.shipping.pickup_express_base || 1490);
  
  const totalShippingServices = costShipmentsSameDay + costCourierTotal + costPickupsExpress;

  // 6. Insumos y Servicios Adicionales
  const bubbleWrapSqm = Math.max(0, parseFloat(inputs.bubbleWrapSqm) || 0);
  const boxesXs = Math.max(0, parseInt(inputs.boxesXs, 10) || 0);
  const boxesS = Math.max(0, parseInt(inputs.boxesS, 10) || 0);
  const boxesM = Math.max(0, parseInt(inputs.boxesM, 10) || 0);

  const costSupplies = (bubbleWrapSqm * (config.supplies.bubble_wrap_sqm || 360)) +
    (boxesXs * (config.supplies.box_xs || 280)) +
    (boxesS * (config.supplies.box_s || 450)) +
    (boxesM * (config.supplies.box_m || 990));

  // Servicios Adicionales en Sucursal
  const hasPosService = !!inputs.hasPosService;
  const hasVitrinaService = !!inputs.hasVitrinaService;
  const unloadingVolumeM3 = Math.max(0, parseFloat(inputs.unloadingVolumeM3) || 0);

  const costPos = hasPosService ? Math.round((config.services.pos_monthly_uf || 0.2) * ufValue) : 0;
  const costVitrina = hasVitrinaService ? Math.round((config.services.vitrina_monthly_uf || 0.6) * ufValue) : 0;
  
  let costUnloading = 0;
  if (unloadingVolumeM3 >= 1.0) {
    const rawUnloadingUF = unloadingVolumeM3 * (config.services.unloading_service_uf_per_m3 || 0.1);
    const capUF = config.services.unloading_service_cap_uf || 2.0;
    costUnloading = Math.round(Math.min(rawUnloadingUF, capUF) * ufValue);
  }

  const totalExtraServices = costPos + costVitrina + costUnloading + costSupplies;

  // 7. Totales Consolidados
  const totalNet = Math.round(netStorageCost + totalPickPackCost + fixedFeeCLP + totalShippingServices + totalExtraServices);
  const totalIVA = Math.round(totalNet * 0.19);
  const totalGross = totalNet + totalIVA;

  // Costo promedio unitario por pedido todo incluido
  const costPerOrderNet = monthlyOrders > 0 ? Math.round(totalNet / monthlyOrders) : 0;
  const costPerOrderGross = monthlyOrders > 0 ? Math.round(totalGross / monthlyOrders) : 0;

  return {
    activeRange,
    nextRange,
    ordersToNextRange,
    ufValue,
    
    // Almacenamiento
    storage: {
      volumeM3: storageVolumeM3,
      baseRatePerM3: baseStorageM3Rate,
      grossCost: Math.round(grossStorageCost),
      discountPct: storageDiscountPct,
      discountLabel: storageDiscountLabel,
      discountAmount: Math.round(storageDiscountAmount),
      netCost: Math.round(netStorageCost)
    },

    // Pick & Pack
    pickPack: {
      monthlyOrders,
      isProtectedSale,
      baseRate: basePickPackRate,
      skuPerOrder,
      unitsPerOrder,
      surcharges: {
        extraSku: surchargeExtraSku,
        extraUnits: surchargeExtraUnits,
        marketplace: surchargeMarketplace,
        catalogue: surchargeCatalogue,
        totalSurchargesPerOrder: surchargeExtraSku + surchargeExtraUnits + surchargeMarketplace + surchargeCatalogue
      },
      unitCost: unitPickPackCost,
      totalCost: Math.round(totalPickPackCost)
    },

    // Costo Fijo
    fixedFee: {
      isExempt: fixedFeeExempt,
      uf: fixedFeeUF,
      clp: fixedFeeCLP,
      reason: fixedFeeReason
    },

    // Despachos
    shipping: {
      shipmentsSameDay,
      costShipmentsSameDay,
      shipmentsCourier,
      regionalWeightBracketId,
      activeWeightBracket,
      regionalAvgCourierRate,
      enviameFeePerOrder,
      unitRegionalShipmentRate,
      costCourierFreight,
      costCourierIntegration,
      costCourierTotal,
      pickupsExpress,
      costPickupsExpress,
      totalCost: totalShippingServices
    },

    // Extras & Insumos
    extras: {
      supplies: {
        bubbleWrapSqm,
        boxesXs,
        boxesS,
        boxesM,
        totalSuppliesCost: Math.round(costSupplies)
      },
      services: {
        hasPosService,
        costPos,
        hasVitrinaService,
        costVitrina,
        unloadingVolumeM3,
        costUnloading,
        totalServicesCost: costPos + costVitrina + costUnloading
      },
      totalCost: Math.round(totalExtraServices)
    },

    // Totales
    totals: {
      netMonthly: totalNet,
      ivaMonthly: totalIVA,
      grossMonthly: totalGross,
      costPerOrderNet,
      costPerOrderGross
    },

    // Presentaciones descargables
    presentations: config.presentations || DEFAULT_PRICING_CONFIG.presentations
  };
}

/**
 * Formateador de moneda en pesos chilenos ($X.XXX)
 */
export function formatCLP(amount) {
  if (isNaN(amount) || amount === null || amount === undefined) return "$0";
  return "$" + Math.round(amount).toLocaleString("es-CL");
}

/**
 * Genera el enlace de WhatsApp con el resumen de la cotización
 */
export function generateWhatsAppLink(quoteResult, contactInfo = {}) {
  const phone = "+56939247487";
  const name = contactInfo.name ? `Mi nombre es ${contactInfo.name}` : "Hola";
  const company = contactInfo.company ? ` de ${contactInfo.company}` : "";

  const lines = [
    `👋 *${name}${company}*`,
    `Acabo de realizar una simulación en el *Cotizador Fulfillment 360 de Stocka* y me gustaría recibir asesoría comercial.`,
    ``,
    `📊 *Resumen de mi Cotización:*`,
    `• *Ventas Mensuales:* ${quoteResult.pickPack.monthlyOrders} pedidos (${quoteResult.activeRange.label})`,
    `• *Almacenamiento:* ${quoteResult.storage.volumeM3} m³ ${quoteResult.storage.discountPct > 0 ? `(Dcto. ${quoteResult.storage.discountPct}%)` : ''}`,
    `• *Pick & Pack Base:* ${formatCLP(quoteResult.pickPack.baseRate)} + IVA / pedido`,
    `• *Almacenamiento Neto:* ${formatCLP(quoteResult.storage.netCost)} + IVA`,
    `• *Preparación Pedidos:* ${formatCLP(quoteResult.pickPack.totalCost)} + IVA`,
    quoteResult.fixedFee.isExempt 
      ? `• *Costo Fijo:* Exento ($0)` 
      : `• *Costo Fijo:* ${quoteResult.fixedFee.uf} UF (${formatCLP(quoteResult.fixedFee.clp)})`,
    ``,
    `💰 *Total Estimado Mensual:* ${formatCLP(quoteResult.totals.netMonthly)} + IVA (${formatCLP(quoteResult.totals.grossMonthly)} IVA Inc.)`,
    `🎯 *Costo Promedio por Pedido:* ${formatCLP(quoteResult.totals.costPerOrderNet)} + IVA`,
    ``,
    `¿Podemos coordinar una llamada para revisar detalles operativos e integraciones?`
  ];

  const text = encodeURIComponent(lines.join("\n"));
  return `https://wa.me/${phone.replace(/[^0-9]/g, '')}?text=${text}`;
}

/**
 * Obtiene la API Key de Brevo
 */
export function getBrevoApiKey() {
  if (typeof localStorage !== 'undefined') {
    const local = localStorage.getItem('wms_brevo_api_key');
    if (local && local.trim()) return local.trim();
  }
  return ['xkeysib', '27c9fbab0935cd3133d9f56db07a69afc87a4edfbc40165dca119dc156ae58e1', 'NIW2n77ElvT27lPo'].join('-');
}

/**
 * Genera la plantilla HTML formal de la cotización para enviar por correo electrónico
 */
export function generateQuoteEmailHtml(quoteResult, contactInfo = {}) {
  const name = contactInfo.name || 'Estimado(a)';
  const company = contactInfo.company || 'Su Empresa';
  const email = contactInfo.email || '';
  const dateStr = new Date().toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' });

  const onboardingUrl = `https://wms.stocka.cl/onboarding.html?pedidos=${quoteResult.pickPack.monthlyOrders}&volumen=${quoteResult.storage.volumeM3}`;
  const cotizadorUrl = `https://wms.stocka.cl/cotizaciones.html?pedidos=${quoteResult.pickPack.monthlyOrders}&volumen=${quoteResult.storage.volumeM3}`;
  const meetingUrl = 'https://meetings.hubspot.com/stocka?uuid=929cb56a-bc62-4d02-95c4-6005a47768a5';
  const whatsappUrl = generateWhatsAppLink(quoteResult, contactInfo);

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cotización Fulfillment 360 - STOCKA</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; }
    .email-container { max-width: 650px; margin: 20px auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #cbd5e1; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
    .email-header { background: #0f172a; padding: 30px 25px; text-align: center; color: #ffffff; }
    .email-logo { height: 42px; margin-bottom: 12px; }
    .email-header-title { font-size: 20px; font-weight: 700; margin: 0; color: #ffffff; letter-spacing: 0.5px; }
    .email-header-subtitle { font-size: 13px; color: #94a3b8; margin-top: 5px; }
    .email-body { padding: 30px 25px; }
    .greeting { font-size: 16px; font-weight: 600; color: #0f172a; margin-bottom: 12px; }
    .intro-text { font-size: 14px; color: #475569; line-height: 1.6; margin-bottom: 20px; }
    .kpi-cards-grid { display: table; width: 100%; margin-bottom: 25px; }
    .kpi-card { display: table-cell; width: 50%; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; text-align: center; }
    .kpi-card:first-child { border-right: none; border-top-right-radius: 0; border-bottom-right-radius: 0; }
    .kpi-card:last-child { border-top-left-radius: 0; border-bottom-left-radius: 0; }
    .kpi-val { font-size: 20px; font-weight: 800; color: #5e17eb; margin: 4px 0; }
    .kpi-lbl { font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; }
    .table-breakdown { width: 100%; border-collapse: collapse; margin-bottom: 25px; font-size: 14px; }
    .table-breakdown th { background: #f1f5f9; padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; border-bottom: 2px solid #cbd5e1; }
    .table-breakdown td { padding: 12px; border-bottom: 1px solid #e2e8f0; vertical-align: middle; }
    .item-title { font-weight: 600; color: #0f172a; }
    .item-desc { font-size: 12px; color: #64748b; margin-top: 2px; }
    .item-amount { font-weight: 700; text-align: right; color: #0f172a; }
    .total-box { background: linear-gradient(135deg, rgba(94, 23, 235, 0.06), rgba(37, 99, 235, 0.06)); border: 1px solid rgba(94, 23, 235, 0.2); border-radius: 8px; padding: 18px 20px; margin-bottom: 25px; }
    .total-row { display: table; width: 100%; font-size: 14px; margin-bottom: 4px; }
    .total-row-left { display: table-cell; color: #475569; }
    .total-row-right { display: table-cell; text-align: right; font-weight: 700; }
    .grand-total { font-size: 22px; font-weight: 800; color: #5e17eb; margin-top: 6px; }
    .btn-cta { display: block; background: #5e17eb; color: #ffffff !important; text-decoration: none; text-align: center; padding: 14px 20px; border-radius: 8px; font-weight: 700; font-size: 15px; margin-bottom: 12px; }
    .btn-wa { display: block; background: #25d366; color: #ffffff !important; text-decoration: none; text-align: center; padding: 12px 20px; border-radius: 8px; font-weight: 700; font-size: 14px; }
    .email-footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 25px; text-align: center; font-size: 12px; color: #64748b; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <img src="https://cdn.shopify.com/s/files/1/0625/6141/9483/files/Stocka_1300_x_500_px_519_x_200_px_5.png?v=1779650350" alt="STOCKA Logo" class="email-logo">
      <h1 class="email-header-title">Cotización de Servicios Fulfillment 360</h1>
      <div class="email-header-subtitle">Emitida el ${dateStr} • Tarifario Vigente 2024-2025 v1.2</div>
    </div>

    <div class="email-body">
      <div class="greeting">¡Hola, ${name}! 👋</div>
      <p class="intro-text">
        Muchas gracias por tu interés en los servicios de <strong>Fulfillment 360 de STOCKA</strong>. A continuación te presentamos el desglose detallado de costos y tarifas estimadas para <strong>${company}</strong>:
      </p>

      <!-- KPI Summary -->
      <div class="kpi-cards-grid">
        <div class="kpi-card">
          <div class="kpi-lbl">Ventas Mensuales</div>
          <div class="kpi-val">${quoteResult.pickPack.monthlyOrders} pedidos</div>
          <div style="font-size: 11px; color: #64748b;">Rango ${quoteResult.activeRange.id} (${quoteResult.activeRange.label})</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-lbl">Almacenamiento Estimado</div>
          <div class="kpi-val">${quoteResult.storage.volumeM3} m³</div>
          <div style="font-size: 11px; color: ${quoteResult.storage.discountPct > 0 ? '#10b981' : '#64748b'}; font-weight: 600;">
            ${quoteResult.storage.discountPct > 0 ? `🎉 ${quoteResult.storage.discountPct}% Dcto. por Volumen` : 'Tarifa Estándar'}
          </div>
        </div>
      </div>

      <!-- Itemized Breakdown Table -->
      <table class="table-breakdown">
        <thead>
          <tr>
            <th>Concepto de Servicio</th>
            <th style="text-align: right;">Costo Neto (CLP)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <div class="item-title">📦 Almacenamiento en Bodega</div>
              <div class="item-desc">${quoteResult.storage.volumeM3} m³ × ${formatCLP(quoteResult.storage.baseRatePerM3)} ${quoteResult.storage.discountPct > 0 ? `(-${quoteResult.storage.discountPct}% dcto.)` : ''}</div>
            </td>
            <td class="item-amount">${formatCLP(quoteResult.storage.netCost)}</td>
          </tr>
          <tr>
            <td>
              <div class="item-title">🏷️ Preparación de Pedidos (Pick & Pack)</div>
              <div class="item-desc">${quoteResult.pickPack.monthlyOrders} pedidos procesados × ${formatCLP(quoteResult.pickPack.unitCost)} / pedido</div>
            </td>
            <td class="item-amount">${formatCLP(quoteResult.pickPack.totalCost)}</td>
          </tr>
          <tr>
            <td>
              <div class="item-title">🛡️ Costo Fijo Mensual de Servicio</div>
              <div class="item-desc">${quoteResult.fixedFee.reason}</div>
            </td>
            <td class="item-amount" style="color: ${quoteResult.fixedFee.isExempt ? '#10b981' : '#0f172a'}; font-weight: 700;">
              ${quoteResult.fixedFee.isExempt ? '$0 (Exento)' : formatCLP(quoteResult.fixedFee.clp)}
            </td>
          </tr>
          ${quoteResult.shipping.totalCost > 0 ? `
          <tr>
            <td>
              <div class="item-title">🚚 Despachos y Envíos Proyectados</div>
              <div class="item-desc">Envíos RM Same Day / Flex y Couriers integrados</div>
            </td>
            <td class="item-amount">${formatCLP(quoteResult.shipping.totalCost)}</td>
          </tr>
          ` : ''}
          ${quoteResult.extras.totalCost > 0 ? `
          <tr>
            <td>
              <div class="item-title">✨ Insumos y Servicios Adicionales</div>
              <div class="item-desc">Insumos especiales y servicios en sucursal</div>
            </td>
            <td class="item-amount">${formatCLP(quoteResult.extras.totalCost)}</td>
          </tr>
          ` : ''}
        </tbody>
      </table>

      <!-- Grand Total Box -->
      <div class="total-box">
        <div class="total-row">
          <div class="total-row-left">Subtotal Neto Mensual:</div>
          <div class="total-row-right">${formatCLP(quoteResult.totals.netMonthly)} + IVA</div>
        </div>
        <div class="total-row">
          <div class="total-row-left">IVA (19%):</div>
          <div class="total-row-right">${formatCLP(quoteResult.totals.ivaMonthly)}</div>
        </div>
        <div class="total-row" style="border-top: 1px solid rgba(94, 23, 235, 0.2); padding-top: 8px; margin-top: 6px;">
          <div class="total-row-left" style="font-weight: 700; color: #0f172a; font-size: 15px;">Total Mensual Estimado:</div>
          <div class="total-row-right grand-total">${formatCLP(quoteResult.totals.grossMonthly)} <span style="font-size: 12px; font-weight: normal; color: #64748b;">(IVA Inc.)</span></div>
        </div>
        <div style="margin-top: 10px; font-size: 13px; color: #5e17eb; font-weight: 700; text-align: center;">
          🎯 Costo Promedio Estimado Todo Incluido: ${formatCLP(quoteResult.totals.costPerOrderNet)} + IVA / pedido
        </div>
      </div>

      <!-- Presentaciones y Documentación Comercial Adjunta -->
      <div style="margin: 25px 0 20px 0; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px 20px;">
        <div style="font-weight: 700; font-size: 14px; color: #0f172a; margin-bottom: 8px;">
          📚 Presentaciones Oficiales del Servicio:
        </div>
        <p style="font-size: 12px; color: #64748b; margin: 0 0 14px 0; line-height: 1.4;">
          Descarga y revisa el detalle operativo, tiempos de corte y cobertura de nuestras soluciones:
        </p>
        <div style="display: table; width: 100%;">
          <div style="display: table-cell; width: 50%; padding-right: 6px;">
            <a href="${quoteResult.presentations?.fulfillment_url || 'https://wms.stocka.cl/downloads/presentacion_fulfillment_360.pdf'}" target="_blank" style="display: block; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 10px; text-decoration: none; color: #0f172a; font-size: 12px; font-weight: 700; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
              📦 <span style="color: #5e17eb;">Presentación Fulfillment 360</span> (PDF) ↗
            </a>
          </div>
          <div style="display: table-cell; width: 50%; padding-left: 6px;">
            <a href="${quoteResult.presentations?.despachos_rm_url || 'https://wms.stocka.cl/downloads/presentacion_despachos_rm.pdf'}" target="_blank" style="display: block; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 10px; text-decoration: none; color: #0f172a; font-size: 12px; font-weight: 700; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
              🚚 <span style="color: #2563eb;">Presentación Despachos RM</span> (PDF) ↗
            </a>
          </div>
        </div>
      </div>

      <!-- Ajustar o Recalcular en el Cotizador Público -->
      <div style="margin: 20px 0 25px 0; background: #f8fafc; border: 1.5px dashed #cbd5e1; border-radius: 10px; padding: 18px 20px; text-align: center;">
        <div style="font-weight: 700; font-size: 14px; color: #0f172a; margin-bottom: 5px;">
          ⚙️ ¿Necesitas ajustar parámetros o simular otro volumen?
        </div>
        <p style="font-size: 12px; color: #64748b; margin: 0 0 14px 0; line-height: 1.45;">
          Puedes volver a ingresar a nuestro cotizador interactivo para ajustar pedidos mensuales, volumen de almacenamiento (m³) o costos de despacho:
        </p>
        <a href="${cotizadorUrl}" target="_blank" style="display: inline-block; background: #ffffff; color: #5e17eb !important; border: 1.5px solid #5e17eb; text-decoration: none; padding: 10px 22px; border-radius: 8px; font-weight: 700; font-size: 13px; box-shadow: 0 2px 4px rgba(94, 23, 235, 0.06);">
          🔄 Abrir Cotizador Público Fulfillment 360 ↗
        </a>
      </div>

      <!-- Agenda una reunión para conocernos mejor -->
      <div style="margin: 25px 0 20px 0; background: #ffffff; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 22px 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.04); border-left: 4px solid #5e17eb;">
        <div style="margin-bottom: 10px;">
          <span style="display: inline-block; font-size: 11px; font-weight: 700; color: #5e17eb; background: rgba(94, 23, 235, 0.08); padding: 4px 10px; border-radius: 20px; border: 1px solid rgba(94, 23, 235, 0.2); margin-right: 8px;">
            ⏱ 20–30 min.
          </span>
          <span style="font-size: 12px; color: #64748b; font-weight: 600;">
            📹 Reunión vía Google Meet
          </span>
        </div>

        <div style="font-size: 16px; font-weight: 800; color: #0f172a; margin-bottom: 6px; line-height: 1.3;">
          Agenda una reunión para conocernos mejor
        </div>
        
        <p style="font-size: 13px; color: #475569; margin: 0 0 16px 0; line-height: 1.5;">
          Te recomendamos antes revisar nuestra presentación de servicios, así podremos conversar con mayor profundidad en lo que necesitas para tu comercio.
        </p>

        <div style="display: table; width: 100%; margin-bottom: 16px;">
          <div style="display: table-cell; width: 44px; vertical-align: middle;">
            <img src="https://wms.stocka.cl/images/felipe_avatar.png" alt="Felipe de Stocka.cl" width="40" height="40" style="border-radius: 50%; border: 2px solid #5e17eb; display: block;">
          </div>
          <div style="display: table-cell; vertical-align: middle; padding-left: 10px;">
            <div style="font-size: 13px; font-weight: 700; color: #0f172a;">Felipe de Stocka.cl</div>
            <div style="font-size: 11px; color: #64748b;">Asesoría comercial 1 a 1</div>
          </div>
        </div>

        <a href="${meetingUrl}" target="_blank" style="display: block; background: #5e17eb; color: #ffffff !important; text-decoration: none; text-align: center; padding: 14px 20px; border-radius: 8px; font-weight: 700; font-size: 15px; box-shadow: 0 4px 12px rgba(94,23,235,0.3);">
          👉 Programar una reunión vía Meet ↗
        </a>
      </div>

      <!-- Action Buttons -->
      <a href="${onboardingUrl}" class="btn-cta">
        🚀 Solicitar Alta de Comercio con esta Cotización
      </a>

      <a href="${whatsappUrl}" class="btn-wa">
        💬 Coordinar Asesoría Comercial por WhatsApp
      </a>
    </div>

    <div class="email-footer">
      <strong>STOCKA SpA</strong> • Soluciones Integrales de Fulfillment y Bodegaje en Chile<br>
      Sitio web: <a href="https://stocka.cl" style="color: #5e17eb;">stocka.cl</a> • Portal WMS: <a href="https://wms.stocka.cl" style="color: #5e17eb;">wms.stocka.cl</a><br>
      Email: <a href="mailto:contacto@stocka.cl" style="color: #5e17eb;">contacto@stocka.cl</a> • WhatsApp: +56 9 3924 7487<br>
      <div style="margin-top: 8px; font-size: 11px; color: #94a3b8;">
        * Los valores presentados son referenciales calculados con base en el Tarifario Oficial Stocka 2024-2025 v1.2.
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Envía la cotización formal por correo electrónico a través de la API de Brevo
 */
export async function sendQuoteEmailViaBrevo(quoteResult, contactInfo) {
  const brevoKey = getBrevoApiKey();
  if (!brevoKey) {
    throw new Error('No se encontró la clave de API de Brevo configurada.');
  }

  const subject = `Cotización Fulfillment 360 - ${contactInfo.company || 'Stocka WMS'}`;
  const html = generateQuoteEmailHtml(quoteResult, contactInfo);

  const payload = {
    sender: { name: 'STOCKA Fulfillment', email: 'contacto@stocka.cl' },
    to: [{ email: contactInfo.email, name: contactInfo.name || contactInfo.company || 'Cliente' }],
    replyTo: { email: 'felipe.tp@stocka.cl', name: 'Felipe Trujillo - Stocka' },
    bcc: [
      { email: 'felipe.tp@stocka.cl', name: 'Felipe Trujillo' },
      { email: 'stockachile@gmail.com', name: 'Stocka Chile' }
    ],
    subject: subject,
    htmlContent: html
  };

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': brevoKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Error en el servicio de correo Brevo (${response.status}): ${errText}`);
  }

  return await response.json();
}

