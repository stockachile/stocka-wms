import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ENVIAME_API_KEY = Deno.env.get("ENVIAME_API_KEY") ?? "";
const ENVIAME_POLLER_SECRET = Deno.env.get("ENVIAME_POLLER_SECRET") ?? "";
const ENVIAME_WEBHOOK_SECRET = Deno.env.get("ENVIAME_WEBHOOK_SECRET") ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-poller-secret, x-webhook-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const IGNORED_COURIER_REGEX = /(RECIBELO|RECÍBELO|WELIVERY|WOODELIVERY|WODELY)/i;
const INVALID_TRACK_REGEX = /^(no informado|noinformado|null|undefined|n\/a|-|sin informaci[oó]n)$/i;
const INVALID_URL_REGEX = /(no\s*informado|no%20informado)/i;

function cleanValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const str = String(v).trim();
  if (!str || INVALID_TRACK_REGEX.test(str)) return null;
  return str;
}

function isIgnoredCourier(courier: string | null | undefined): boolean {
  return Boolean(courier && IGNORED_COURIER_REGEX.test(String(courier).trim()));
}

function isValidHttpUrl(v: unknown): boolean {
  if (!v || typeof v !== "string") return false;
  const s = v.trim();
  return /^https?:\/\//i.test(s) && !INVALID_URL_REGEX.test(s);
}

function extractLabelUrl(label: unknown): string | null {
  if (!label) return null;
  if (typeof label === "object") {
    const obj = label as Record<string, unknown>;
    const cand = obj.PDF || obj.pdf || obj.PNG || obj.png || null;
    return isValidHttpUrl(cand) ? String(cand).trim() : null;
  }
  if (typeof label === "string") {
    return isValidHttpUrl(label) ? label.trim() : null;
  }
  return null;
}

function mapCourierToOperador(courier: string | null | undefined): string {
  if (!courier) return "STOCKA";
  const cUpper = String(courier).trim().toUpperCase();
  if (cUpper.includes("STARKEN")) return "STARKEN";
  if (cUpper.includes("BLUEXPRESS") || cUpper.includes("BLUE EXPRESS") || cUpper.includes("BLUE")) return "BLUEXPRESS";
  if (cUpper.includes("CHILEXPRESS")) return "CHILEXPRESS";
  if (cUpper.includes("ALPHA") || cUpper.includes("LIGHTDATA")) return "ALPHA";
  if (cUpper.includes("FALABELLA")) return "FALABELLA";
  if (cUpper.includes("MERCADO")) return "MERCADOLIBRE";
  if (cUpper.includes("PARIS")) return "PARIS";
  if (cUpper.includes("RIPLEY")) return "RIPLEY";
  if (cUpper.includes("WALMART")) return "WALMART";
  if (IGNORED_COURIER_REGEX.test(cUpper)) return "STOCKA X";
  return cUpper;
}

function mapStatusToGlobal(statusName: string | null | undefined): string {
  if (!statusName) return "SIN MOVIMIENTO";
  const s = String(statusName).trim().toLowerCase();
  if (s.includes("rechazado por courier")) {
    return "SIN MOVIMIENTO";
  }
  if (
    s.includes("requiere solucion") ||
    s.includes("requiere solución") ||
    s.includes("pendiente - requiere") ||
    s.includes("retenid") ||
    s.includes("excepcion") ||
    s.includes("excepción") ||
    s.includes("siniestr") ||
    s.includes("fallid") ||
    s.includes("cancel") ||
    s.includes("rechazad")
  ) {
    return "ALERTA";
  }
  if (
    s.includes("transito") ||
    s.includes("tránsito") ||
    s.includes("ruta") ||
    s.includes("reparto") ||
    s.includes("camino") ||
    s.includes("planta") ||
    s.includes("admitid") ||
    s.includes("disponible para retiro") ||
    s.includes("entregad") ||
    s.includes("delivered")
  ) {
    return "DESPACHADO";
  }
  return "SIN MOVIMIENTO";
}

function buildTrackingUrl(
  courier: string | null | undefined,
  validTracking: string | null,
  links: unknown
): string | null {
  if (validTracking) {
    const cUpper = String(courier || "").toUpperCase();
    if (cUpper.includes("STARKEN")) {
      return `https://www.starken.cl/seguimiento?codigo=${encodeURIComponent(validTracking)}`;
    }
    if (cUpper.includes("BLUE") || cUpper === "BX" || cUpper.includes("BLUEXPRESS")) {
      return `https://tracking-unificado.blue.cl/?n_seguimiento=${encodeURIComponent(validTracking)}`;
    }
    if (cUpper.includes("CHILEXPRESS") || cUpper === "CXP") {
      return `https://centrodeayuda.chilexpress.cl/pre-seguimiento/${encodeURIComponent(validTracking)}`;
    }
  }
  if (validTracking && Array.isArray(links)) {
    const webLink = links.find((l: any) => l && l.rel === "tracking-web" && isValidHttpUrl(l.href));
    if (webLink?.href) return String(webLink.href).trim();
  }
  return null;
}

interface CommerceCache {
  enviameIdToCommerce: Record<string, string>;
  commerceToEnviameIds: Record<string, string[]>;
  commerceToSigla: Record<string, string>;
  siglaToCommerce: Record<string, string>;
  activeCompanyEntries: Array<{ comercio: string; compId: string }>;
}

async function loadCommerceCache(): Promise<CommerceCache> {
  const [{ data: configs, error: cfgErr }, { data: vComercios, error: vcErr }] = await Promise.all([
    supabase.from("comercios_adicional_config").select("comercio, enviame_id, activo"),
    supabase.from("v_comercios_config").select("nombre, sigla"),
  ]);
  if (cfgErr) console.warn("[enviame-webhook] Error cargando comercios_adicional_config:", cfgErr.message);
  if (vcErr) console.warn("[enviame-webhook] Error cargando v_comercios_config:", vcErr.message);

  const enviameIdToCommerce: Record<string, string> = {};
  const commerceToEnviameIds: Record<string, string[]> = {};
  const commerceToSigla: Record<string, string> = {};
  const siglaToCommerce: Record<string, string> = {};
  const activeCompanyEntries: Array<{ comercio: string; compId: string }> = [];
  const seenCompIds = new Set<string>();

  for (const v of vComercios || []) {
    if (v.nombre && v.sigla) {
      const cUpper = String(v.nombre).trim().toUpperCase();
      const sUpper = String(v.sigla).trim().toUpperCase();
      commerceToSigla[cUpper] = sUpper;
      siglaToCommerce[sUpper] = cUpper;
    }
  }

  for (const c of configs || []) {
    if (!c.comercio) continue;
    const cUpper = String(c.comercio).trim().toUpperCase();
    if (c.enviame_id) {
      const ids = String(c.enviame_id)
        .split(",")
        .map((s) => s.trim().replace(/^ID\s*:?\s*/i, ""))
        .filter((s) => /^\d+$/.test(s));
      for (const id of ids) {
        enviameIdToCommerce[id] = cUpper;
        if (c.activo !== false && id !== "1" && id !== "12345" && !seenCompIds.has(id)) {
          seenCompIds.add(id);
          activeCompanyEntries.push({ comercio: cUpper, compId: id });
        }
      }
      if (ids.length > 0) commerceToEnviameIds[cUpper] = ids;
    }
  }

  if (!enviameIdToCommerce["166878"]) enviameIdToCommerce["166878"] = "MAESE";
  if (!commerceToSigla["MAESE"]) commerceToSigla["MAESE"] = "MSE";
  if (!siglaToCommerce["MSE"]) siglaToCommerce["MSE"] = "MAESE";

  activeCompanyEntries.sort((a, b) => a.compId.localeCompare(b.compId));

  return {
    enviameIdToCommerce,
    commerceToEnviameIds,
    commerceToSigla,
    siglaToCommerce,
    activeCompanyEntries,
  };
}

function resolveCommerceForDelivery(
  d: any,
  context: { comercio?: string; enviameId?: string },
  cache: CommerceCache
) {
  const { enviameIdToCommerce, commerceToEnviameIds, commerceToSigla, siglaToCommerce } = cache;

  if (context.comercio) {
    const cUpper = context.comercio.trim().toUpperCase();
    return {
      comercio: cUpper,
      sigla: commerceToSigla[cUpper] || null,
      companyId: context.enviameId || commerceToEnviameIds[cUpper]?.[0] || null,
      companyName: d.company?.name ? String(d.company.name).trim().toUpperCase() : cUpper,
    };
  }

  let companyId: string | null = d.company?.id ? String(d.company.id).trim() : null;
  if (!companyId && d.seller_id) companyId = String(d.seller_id).trim();
  if (!companyId && Array.isArray(d.links)) {
    const link = d.links.find((l: any) => l?.href && String(l.href).includes("/companies/"));
    const m = link?.href?.match(/\/companies\/(\d+)\//);
    if (m) companyId = m[1];
  }
  if (!companyId && d.seller_name && /^ID\s*:?\s*\d+$/i.test(String(d.seller_name))) {
    companyId = String(d.seller_name).replace(/^ID\s*:?\s*/i, "").trim();
  }

  let companyName: string | null = d.company?.name ? String(d.company.name).trim().toUpperCase() : null;
  if (!companyName && d.seller_name && !/^ID\s*:?\s*\d+$/i.test(String(d.seller_name))) {
    companyName = String(d.seller_name).trim().toUpperCase();
  }

  if (companyId && enviameIdToCommerce[companyId]) {
    const com = enviameIdToCommerce[companyId];
    return { comercio: com, sigla: commerceToSigla[com] || null, companyId, companyName };
  }

  if (companyName) {
    for (const [comKey, sVal] of Object.entries(commerceToSigla)) {
      if (comKey === companyName || companyName.includes(comKey) || comKey.includes(companyName)) {
        return { comercio: comKey, sigla: sVal, companyId, companyName };
      }
    }
  }

  const ref = String(d.imported_id || d.order_number || "").trim();
  const cleanPrefix = ref.replace(/^[^A-Za-z0-9]+/, "").substring(0, 3).toUpperCase();
  if (cleanPrefix.length === 3 && siglaToCommerce[cleanPrefix]) {
    const com = siglaToCommerce[cleanPrefix];
    return { comercio: com, sigla: cleanPrefix, companyId, companyName };
  }

  return { comercio: null, sigla: null, companyId, companyName };
}

async function fetchEnviameDelivery(deliveryId: string): Promise<any | null> {
  const cleanId = String(deliveryId).trim();
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(cleanId)) return null;
  try {
    const res = await fetch(`https://api.enviame.io/api/s2/v2/deliveries/${encodeURIComponent(cleanId)}`, {
      headers: {
        Accept: "application/json",
        "api-key": ENVIAME_API_KEY,
      },
    });
    if (!res.ok) {
      console.warn(`[enviame-webhook] Envíame API HTTP ${res.status} para delivery ${cleanId}`);
      return null;
    }
    const json = await res.json();
    return json?.data || null;
  } catch (err: any) {
    console.error(`[enviame-webhook] Error consultando delivery ${cleanId}:`, err?.message || err);
    return null;
  }
}

async function processEnviameDelivery(
  d: any,
  context: { comercio?: string; enviameId?: string },
  cache: CommerceCache
) {
  const deliveryId = String(d?.identifier || d?.id || "").trim();
  if (!deliveryId) return { ok: false, reason: "missing_identifier" };

  const rawTracking = d.tracking_number || d.carrier_tracking_number || d.barcodes || null;
  const validTracking = cleanValue(rawTracking);
  const courier = cleanValue(d.carrier || d.courier?.name) || "STARKEN";
  const statusName = (typeof d.status === "object" ? d.status?.name : d.status) || "Creado";
  const importedId = cleanValue(d.imported_id || d.order_number);
  const mappedOperator = mapCourierToOperador(courier);
  const globalStatus = mapStatusToGlobal(statusName);
  const resolved = resolveCommerceForDelivery(d, context, cache);
  const labelUrl = extractLabelUrl(d.label);
  const trackingUrl = buildTrackingUrl(courier, validTracking, d.links);
  const nowIso = new Date().toISOString();

  const sellerDisplay =
    resolved.comercio || d.company?.name || (resolved.companyId ? `ID: ${resolved.companyId}` : null);

  // 1. Upsert enviame_shipments
  const { error: shipErr } = await supabase.from("enviame_shipments").upsert(
    {
      id: deliveryId,
      order_id: importedId,
      tracking_number: validTracking || "No informado",
      tracking_url: trackingUrl,
      label_url: labelUrl,
      courier: courier,
      status: statusName,
      seller_name: sellerDisplay,
      service_type: d.service || null,
      recipient_name: cleanValue(d.customer?.full_name),
      recipient_phone: cleanValue(d.customer?.phone),
      recipient_email: cleanValue(d.customer?.email),
      recipient_address: cleanValue(d.shipping_address?.full_address),
      commune: cleanValue(d.shipping_address?.place || d.shipping_address?.county),
      enviame_created_at: d.created_at || null,
      enviame_updated_at: d.updated_at || null,
      raw_payload: d,
      updated_at: nowIso,
    },
    { onConflict: "id" }
  );

  if (shipErr) {
    console.error(`[enviame-webhook] Error upsert enviame_shipments (${deliveryId}):`, shipErr.message);
  }

  // 2. Upsert envios_unificados
  const { error: uniErr } = await supabase.from("envios_unificados").upsert(
    {
      id: `enviame_shipments:${deliveryId}`,
      source_table: "enviame_shipments",
      source_id: deliveryId,
      empresa_comercio_proveedor: resolved.comercio || d.company?.name || null,
      tracking: validTracking || "No informado",
      tracking_url: trackingUrl,
      courier: courier,
      status: statusName,
      global_status: globalStatus,
      updated_at: nowIso,
      servicio_tipo_envio: d.service || null,
      nombre_destinatario: cleanValue(d.customer?.full_name),
      telefono_destino: cleanValue(d.customer?.phone),
      email_cliente_destino: cleanValue(d.customer?.email),
      direccion_destino: cleanValue(d.shipping_address?.full_address),
      comuna_destino: cleanValue(d.shipping_address?.place || d.shipping_address?.county),
      pedido_referencia: importedId || deliveryId,
      raw_data: d,
    },
    { onConflict: "id" }
  );

  if (uniErr) {
    console.warn(`[enviame-webhook] Aviso upsert envios_unificados (${deliveryId}):`, uniErr.message);
  }

  // 3. Actualizar public.orders con salvaguardas estrictas
  if (isIgnoredCourier(courier) || !resolved.comercio) {
    return {
      ok: true,
      deliveryId,
      orderId: null,
      trackingNumber: validTracking,
      status: statusName,
      orderUpdated: false,
    };
  }

  let targetOrder: any = null;
  const selectCols =
    "id, estado_wms, external_order_number, tracking_number, tracking_url, label_url, courier, operador, comercio, categoria_entrega, external_platform, raw_shopify_data";

  if (importedId) {
    let cleanNum = importedId.replace(/^#+/, "");
    if (resolved.sigla) {
      cleanNum = cleanNum.replace(new RegExp(`^${resolved.sigla}[#\\-_]?`, "i"), "");
    }
    cleanNum = cleanNum.replace(/^[A-Za-z]{2,5}/, "");

    const candidates = [
      ...new Set(
        [
          importedId,
          `#${cleanNum}`,
          cleanNum,
          resolved.sigla ? `${resolved.sigla}#${cleanNum}` : null,
          resolved.sigla ? `${resolved.sigla}${cleanNum}` : null,
        ].filter(Boolean) as string[]
      ),
    ];

    const { data: matchedOrders } = await supabase
      .from("orders")
      .select(selectCols)
      .ilike("comercio", resolved.comercio)
      .in("external_order_number", candidates)
      .order("created_at", { ascending: false })
      .limit(5);

    if (matchedOrders && matchedOrders.length > 0) {
      targetOrder =
        matchedOrders.find(
          (o: any) =>
            !["MercadoLibre", "Falabella", "Paris", "Ripley", "Walmart"].includes(
              String(o.external_platform || "")
            )
        ) || null;
    }
  }

  if (!targetOrder) {
    const { data: byDel } = await supabase
      .from("orders")
      .select(selectCols)
      .eq("enviame_delivery_id", deliveryId)
      .ilike("comercio", resolved.comercio)
      .maybeSingle();
    if (byDel) targetOrder = byDel;
  }

  let orderUpdated = false;
  if (targetOrder) {
    const isClosed = ["Entregado", "Listo para retiro"].includes(String(targetOrder.estado_wms || ""));
    const isRetiro = String(targetOrder.categoria_entrega || "").toUpperCase().trim() === "RETIRO";

    if (!isClosed && !isRetiro) {
      const orderValidTrack = validTracking && !/^46\d{6,}$/.test(validTracking) ? validTracking : null;
      const ft = targetOrder.raw_shopify_data?.wms_forced_tracking;
      const hasDifferentForcedTrack = Boolean(
        ft &&
          ft.active &&
          ft.tracking_number &&
          (!orderValidTrack ||
            String(ft.tracking_number).trim().toUpperCase() !== orderValidTrack.toUpperCase())
      );

      const orderUpdate: Record<string, unknown> = {
        enviame_delivery_id: deliveryId,
        enviame_status: statusName,
      };

      if (!hasDifferentForcedTrack) {
        orderUpdate.courier = courier;
        orderUpdate.operador = mappedOperator;

        if (orderValidTrack) {
          orderUpdate.tracking_number = orderValidTrack;
          if (trackingUrl) orderUpdate.tracking_url = trackingUrl;
        } else {
          if (targetOrder.tracking_number && INVALID_TRACK_REGEX.test(String(targetOrder.tracking_number).trim())) {
            orderUpdate.tracking_number = null;
          }
          if (targetOrder.tracking_url && INVALID_URL_REGEX.test(String(targetOrder.tracking_url))) {
            orderUpdate.tracking_url = null;
          }
        }
      }

      if (labelUrl) {
        orderUpdate.label_url = labelUrl;
      } else if (targetOrder.label_url && !isValidHttpUrl(targetOrder.label_url)) {
        orderUpdate.label_url = null;
      }

      const { error: ordErr } = await supabase.from("orders").update(orderUpdate).eq("id", targetOrder.id);
      if (ordErr) {
        console.error(`[enviame-webhook] Error actualizando order ${targetOrder.id}:`, ordErr.message);
      } else {
        orderUpdated = true;
      }
    }
  }

  return {
    ok: true,
    deliveryId,
    comercio: resolved.comercio,
    externalOrderNumber: targetOrder?.external_order_number || importedId,
    trackingNumber: validTracking,
    status: statusName,
    orderUpdated,
  };
}

async function runInBatches<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const slice = items.slice(i, i + concurrency);
    const batchOut = await Promise.all(slice.map(fn));
    results.push(...batchOut);
  }
  return results;
}

async function isAuthorizedPoller(req: Request): Promise<boolean> {
  const pollerHeader = req.headers.get("x-poller-secret")?.trim() || "";
  if (ENVIAME_POLLER_SECRET && pollerHeader && pollerHeader === ENVIAME_POLLER_SECRET.trim()) {
    return true;
  }

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  if (supabaseServiceKey && token === supabaseServiceKey.trim()) {
    return true;
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return false;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, comercio")
    .eq("id", user.id)
    .maybeSingle();
  return Boolean(
    profile && (profile.role === "admin" || String(profile.comercio || "").trim().toLowerCase() === "all")
  );
}

async function handlePollPending(body: any) {
  const startedAt = Date.now();
  const cache = await loadCommerceCache();
  const pendingLimit = Math.min(Math.max(Number(body?.pending_limit) || 40, 5), 80);
  const storeBatchSize = Math.min(Math.max(Number(body?.store_batch_size) || 8, 1), 30);

  // Fase A: Envíos recientes en enviame_shipments sin tracking o pendientes de retiro/etiqueta (excluyendo RECIBELO/WELIVERY en SQL)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: pendingRows, error: pendErr } = await supabase
    .from("enviame_shipments")
    .select("id, order_id, courier, tracking_number, status, label_url, updated_at")
    .or("tracking_number.eq.No informado,tracking_number.is.null,status.eq.Creado,status.ilike.Listo para despacho%")
    .not("courier", "ilike", "%RECIBELO%")
    .not("courier", "ilike", "%RECÍBELO%")
    .not("courier", "ilike", "%WELIVERY%")
    .not("courier", "ilike", "%WOODELIVERY%")
    .not("courier", "ilike", "%WODELY%")
    .gte("created_at", sevenDaysAgo)
    .order("updated_at", { ascending: true })
    .limit(pendingLimit);

  if (pendErr) {
    throw new Error(`Error consultando enviame_shipments pendientes: ${pendErr.message}`);
  }

  const candidatesA = (pendingRows || []).filter((r: any) => !isIgnoredCourier(r.courier));

  let pendingChecked = 0;
  let pendingUpdated = 0;
  let trackingsDiscovered = 0;
  const touchedIds = new Set<string>();

  await runInBatches(candidatesA, 6, async (row: any) => {
    const id = String(row.id);
    touchedIds.add(id);
    pendingChecked++;
    const d = await fetchEnviameDelivery(id);
    if (!d) return;

    const liveTrk = cleanValue(d.tracking_number || d.carrier_tracking_number || d.barcodes) || "No informado";
    const liveStatus = (typeof d.status === "object" ? d.status?.name : d.status) || "Creado";
    const liveLabel = extractLabelUrl(d.label);
    const dbHadNoTrack = !cleanValue(row.tracking_number);
    const liveHasTrack = Boolean(cleanValue(liveTrk));

    const changed =
      liveTrk !== (row.tracking_number || "No informado") ||
      liveStatus !== (row.status || "") ||
      (liveLabel && liveLabel !== row.label_url) ||
      (row.label_url && !isValidHttpUrl(row.label_url));

    if (changed) {
      await processEnviameDelivery(d, {}, cache);
      pendingUpdated++;
      if (dbHadNoTrack && liveHasTrack) trackingsDiscovered++;
    } else {
      // Rotar updated_at para que la cola pending avance en round-robin
      await supabase
        .from("enviame_shipments")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", id);
    }
  });

  // Fase B: Rotación de comercios para descubrir envíos nuevos o actualizados cuyo webhook no llegó
  const allStores = cache.activeCompanyEntries;
  let storesPolled = 0;
  let storeChangesApplied = 0;

  if (allStores.length > 0) {
    const sliceIdx =
      typeof body?.store_offset === "number"
        ? body.store_offset % allStores.length
        : (Math.floor(Date.now() / (5 * 60 * 1000)) * storeBatchSize) % allStores.length;

    const batchStores: Array<{ comercio: string; compId: string }> = [];
    for (let i = 0; i < Math.min(storeBatchSize, allStores.length); i++) {
      batchStores.push(allStores[(sliceIdx + i) % allStores.length]);
    }

    await runInBatches(batchStores, 4, async (store) => {
      try {
        const res = await fetch(
          `https://api.enviame.io/api/s2/v2/companies/${encodeURIComponent(store.compId)}/deliveries?limit=15`,
          { headers: { Accept: "application/json", "api-key": ENVIAME_API_KEY } }
        );
        if (!res.ok) return;
        storesPolled++;
        const json = await res.json();
        const deliveries: any[] = Array.isArray(json?.data) ? json.data : [];
        if (deliveries.length === 0) return;

        const ids = deliveries.map((d) => String(d.identifier || d.id || "")).filter(Boolean);
        const { data: existingRows } = await supabase
          .from("enviame_shipments")
          .select("id, tracking_number, status, label_url")
          .in("id", ids);
        const existingMap = new Map<string, any>((existingRows || []).map((r: any) => [String(r.id), r]));

        for (const d of deliveries) {
          const id = String(d.identifier || d.id || "").trim();
          if (!id || touchedIds.has(id)) continue;

          const existing = existingMap.get(id);
          const liveTrk = cleanValue(d.tracking_number || d.carrier_tracking_number || d.barcodes) || "No informado";
          const liveStatus = (typeof d.status === "object" ? d.status?.name : d.status) || "Creado";
          const liveLabel = extractLabelUrl(d.label);

          const needsSync =
            !existing ||
            liveTrk !== (existing.tracking_number || "No informado") ||
            liveStatus !== (existing.status || "") ||
            (liveLabel && liveLabel !== existing.label_url) ||
            (existing.label_url && !isValidHttpUrl(existing.label_url));

          if (needsSync) {
            if (!d.company) d.company = { id: store.compId, name: store.comercio };
            const dbHadNoTrack = !existing || !cleanValue(existing.tracking_number);
            const liveHasTrack = Boolean(cleanValue(liveTrk));
            await processEnviameDelivery(d, { comercio: store.comercio, enviameId: store.compId }, cache);
            storeChangesApplied++;
            if (dbHadNoTrack && liveHasTrack) trackingsDiscovered++;
          }
        }
      } catch (err: any) {
        console.warn(`[enviame-webhook] Error polling store ${store.comercio}:`, err?.message || err);
      }
    });
  }

  return {
    success: true,
    mode: "poll_pending",
    durationMs: Date.now() - startedAt,
    pendingChecked,
    pendingUpdated,
    storesPolled,
    storeChangesApplied,
    trackingsDiscovered,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return new Response(
      JSON.stringify({
        ok: true,
        service: "enviame-webhook",
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!ENVIAME_API_KEY) {
    return new Response(JSON.stringify({ error: "ENVIAME_API_KEY no configurada" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return new Response(JSON.stringify({ error: "Payload JSON inválido o vacío" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Modo 2: Poller automático invocado desde pg_cron o administrador
    if (body.mode === "poll_pending") {
      const authorized = await isAuthorizedPoller(req);
      if (!authorized) {
        return new Response(JSON.stringify({ error: "No autorizado para poll_pending" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const summary = await handlePollPending(body);
      return new Response(JSON.stringify(summary), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Modo 1: Webhook en tiempo real desde Envíame
    if (ENVIAME_WEBHOOK_SECRET) {
      const url = new URL(req.url);
      const tokenParam = url.searchParams.get("token") || req.headers.get("x-webhook-token") || "";
      if (tokenParam.trim() !== ENVIAME_WEBHOOK_SECRET.trim()) {
        return new Response(JSON.stringify({ error: "Token de webhook inválido" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const rawItems: any[] = Array.isArray(body)
      ? body
      : Array.isArray(body.deliveries)
        ? body.deliveries
        : [body.delivery || body.data || body];

    const deliveryIds = [
      ...new Set(
        rawItems
          .map((item) => String(item?.identifier || item?.delivery_id || item?.id || "").trim())
          .filter((id) => /^[a-zA-Z0-9_-]{1,40}$/.test(id))
      ),
    ];

    if (deliveryIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, ignored: true, reason: "no_delivery_id" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cache = await loadCommerceCache();
    const results = [];

    for (const delId of deliveryIds) {
      // Consultar directamente la API oficial de Envíame:
      // 1) Verifica autenticidad del delivery (evita inyección de webhooks falsos)
      // 2) Enriquecimiento completo (tracking, label PDF, company, customer, status actualizado)
      const verifiedDelivery = await fetchEnviameDelivery(delId);
      if (!verifiedDelivery) {
        results.push({ ok: false, deliveryId: delId, reason: "not_found_in_enviame_api" });
        continue;
      }
      const res = await processEnviameDelivery(verifiedDelivery, {}, cache);
      results.push(res);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        processed: results.filter((r) => r.ok).length,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[enviame-webhook] Error fatal:", err?.message || err);
    return new Response(JSON.stringify({ error: err?.message || "Error interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
