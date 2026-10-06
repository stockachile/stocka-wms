import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const API_KEY = Deno.env.get("ENVIAME_API_KEY") || "6boQAR4qOMMZxjS1DJlrnOPqj0Vp8n";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Mapeo estandarizado de Courier a Operador WMS STOCKA
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
  if (cUpper.includes("RECIBELO") || cUpper.includes("RECÍBELO") || cUpper.includes("WELIVERY") || cUpper.includes("WOODELIVERY") || cUpper.includes("WODELY")) {
    return "STOCKA X";
  }
  return cUpper;
}

// Mapeo a estado global (DESPACHADO, SIN MOVIMIENTO, ALERTA)
function mapStatusToGlobal(statusName: string | null | undefined): string {
  if (!statusName) return "SIN MOVIMIENTO";
  const s = String(statusName).trim().toLowerCase();
  if (s.includes("requiere solucion") || s.includes("requiere solución") || s.includes("excepcion") || s.includes("excepción") || s.includes("siniestr") || s.includes("fallid") || s.includes("cancel") || s.includes("rechazad")) {
    return "ALERTA";
  }
  if (s.includes("transito") || s.includes("tránsito") || s.includes("ruta") || s.includes("reparto") || s.includes("camino") || s.includes("planta") || s.includes("admitid") || s.includes("disponible para retiro") || s.includes("entregad") || s.includes("delivered")) {
    return "DESPACHADO";
  }
  return "SIN MOVIMIENTO";
}

function cleanValue(v: any): string | null {
  if (!v) return null;
  const str = String(v).trim();
  if (!str || /^(no informado|noinformado|null|undefined|n\/a|-|sin informaci[oó]n)$/i.test(str)) {
    return null;
  }
  return str;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const orderId = body.order_id || body.orderId;
    let deliveryId = body.delivery_id || body.deliveryId;

    if (!orderId && !deliveryId) {
      return new Response(JSON.stringify({ error: "Se requiere 'order_id' o 'delivery_id'" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    let targetOrder: any = null;

    if (orderId) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(orderId));
      let q = supabase.from("orders").select("id, external_order_number, tracking_number, courier, operador, label_url, enviame_delivery_id, comercio");
      if (isUuid) {
        q = q.eq("id", orderId);
      } else {
        q = q.or(`external_order_number.eq.${orderId},external_order_number.eq.#${orderId},enviame_delivery_id.eq.${orderId}`);
      }
      const { data: oList } = await q.limit(1);
      if (oList && oList.length > 0) {
        targetOrder = oList[0];
      }
    }

    // Resolver deliveryId
    if (!deliveryId && targetOrder?.enviame_delivery_id) {
      deliveryId = targetOrder.enviame_delivery_id;
    }

    if (!deliveryId && targetOrder?.external_order_number) {
      const extNum = String(targetOrder.external_order_number);
      const cleanNum = extNum.replace(/^#/, "").replace(/^[A-Za-z]{2,5}/, "");
      const { data: shipRows } = await supabase
        .from("enviame_shipments")
        .select("id")
        .or(`order_id.eq.${extNum},order_id.eq.#${cleanNum},order_id.eq.${cleanNum}`)
        .order("created_at", { ascending: false })
        .limit(1);

      if (shipRows && shipRows.length > 0) {
        deliveryId = shipRows[0].id;
      }
    }

    if (!deliveryId) {
      return new Response(JSON.stringify({
        error: `No se encontró un delivery ID de Envíame para el pedido ${targetOrder?.external_order_number || orderId}.`
      }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Consultar directamente a la API de Envíame desde el backend Deno (sin restricciones CORS)
    const enviameRes = await fetch(`https://api.enviame.io/api/s2/v2/deliveries/${deliveryId}`, {
      headers: {
        "Accept": "application/json",
        "api-key": API_KEY
      }
    });

    if (!enviameRes.ok) {
      const errTxt = await enviameRes.text();
      return new Response(JSON.stringify({
        error: `Envíame API respondió con error ${enviameRes.status}: ${errTxt}`
      }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const enviameJson = await enviameRes.json();
    const d = enviameJson.data;
    if (!d) {
      return new Response(JSON.stringify({ error: "No se recibieron datos de Envíame para esta entrega" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const rawTracking = d.tracking_number || d.carrier_tracking_number || d.barcodes || null;
    const validTracking = cleanValue(rawTracking);
    const courier = cleanValue(d.carrier || d.courier?.name) || targetOrder?.courier || "STARKEN";
    const statusName = d.status?.name || d.status || "Creado";
    const mappedOperador = mapCourierToOperador(courier);
    const globalStatus = mapStatusToGlobal(statusName);

    let labelUrl: string | null = null;
    if (d.label && typeof d.label === "object") {
      labelUrl = d.label.PDF || d.label.PNG || null;
    } else if (typeof d.label === "string" && d.label.startsWith("http")) {
      labelUrl = d.label;
    }

    let trackingUrl: string | null = null;
    if (d.links && Array.isArray(d.links)) {
      const webLink = d.links.find((l: any) => l.rel === "tracking-web");
      if (webLink?.href) trackingUrl = webLink.href;
    }
    if (!trackingUrl && validTracking) {
      trackingUrl = `https://tracking.enviame.io/?n=${encodeURIComponent(validTracking)}`;
    }

    // 1. Actualizar enviame_shipments
    await supabase.from("enviame_shipments").upsert({
      id: String(deliveryId),
      order_id: d.imported_id || targetOrder?.external_order_number || String(deliveryId),
      tracking_number: validTracking || "No informado",
      tracking_url: trackingUrl,
      label_url: labelUrl,
      courier: courier,
      status: statusName,
      seller_name: d.company?.name || targetOrder?.comercio || null,
      service_type: d.service || null,
      recipient_name: cleanValue(d.customer?.full_name),
      recipient_phone: cleanValue(d.customer?.phone),
      recipient_email: cleanValue(d.customer?.email),
      recipient_address: cleanValue(d.shipping_address?.full_address),
      commune: cleanValue(d.shipping_address?.place || d.shipping_address?.county),
      enviame_created_at: d.created_at || null,
      enviame_updated_at: d.updated_at || null,
      raw_payload: d,
      updated_at: new Date().toISOString()
    }, { onConflict: "id" });

    // 2. Actualizar envios_unificados
    const unifiedPayload = {
      id: `enviame_shipments:${deliveryId}`,
      source_table: "enviame_shipments",
      source_id: String(deliveryId),
      empresa_comercio_proveedor: d.company?.name || targetOrder?.comercio || null,
      tracking: validTracking || "No informado",
      tracking_url: trackingUrl,
      courier: courier,
      status: statusName,
      global_status: globalStatus,
      updated_at: new Date().toISOString(),
      servicio_tipo_envio: d.service || null,
      nombre_destinatario: cleanValue(d.customer?.full_name),
      telefono_destino: cleanValue(d.customer?.phone),
      email_cliente_destino: cleanValue(d.customer?.email),
      direccion_destino: cleanValue(d.shipping_address?.full_address),
      comuna_destino: cleanValue(d.shipping_address?.place || d.shipping_address?.county),
      pedido_referencia: d.imported_id || targetOrder?.external_order_number || deliveryId,
      raw_data: d
    };
    await supabase.from("envios_unificados").upsert(unifiedPayload, { onConflict: "id" });

    // 3. Actualizar tabla orders si existe targetOrder
    if (targetOrder) {
      const orderUpdate: any = {
        enviame_delivery_id: String(deliveryId),
        enviame_status: statusName,
        courier: courier,
        operador: mappedOperador
      };

      if (validTracking) {
        orderUpdate.tracking_number = validTracking;
        if (trackingUrl) orderUpdate.tracking_url = trackingUrl;
      } else if (targetOrder.tracking_number === "No informado") {
        orderUpdate.tracking_number = null;
      }

      if (labelUrl) {
        orderUpdate.label_url = labelUrl;
      }

      await supabase.from("orders").update(orderUpdate).eq("id", targetOrder.id);
    }

    return new Response(JSON.stringify({
      success: true,
      deliveryId: String(deliveryId),
      orderId: targetOrder?.id || null,
      externalOrderNumber: targetOrder?.external_order_number || d.imported_id,
      courier: courier,
      operador: mappedOperador,
      trackingNumber: validTracking,
      trackingUrl: trackingUrl,
      labelUrl: labelUrl,
      status: statusName,
      globalStatus: globalStatus,
      message: validTracking
        ? `Sincronizado: Courier ${courier}, Tracking ${validTracking}`
        : `Envíame consultado: Estado '${statusName}' (Courier aún no asigna tracking)`
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || "Error interno en resync-enviame-order" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
