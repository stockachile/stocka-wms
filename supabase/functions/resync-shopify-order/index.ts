import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const WHATSAPP_API_URL = Deno.env.get("WHATSAPP_API_URL") || "https://stocka-whatsapp-bot.onrender.com";
const WHATSAPP_API_KEY = Deno.env.get("WHATSAPP_API_KEY") || "stocka_wa_internal_secret_2026";
const GESTION_STOCKA_GROUP_JID = "120363422429248666@g.us";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function notifyWhatsAppGestion(message: string) {
  try {
    const res = await fetch(`${WHATSAPP_API_URL}/send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": WHATSAPP_API_KEY,
      },
      body: JSON.stringify({
        to: GESTION_STOCKA_GROUP_JID,
        message: message,
        withPrefix: false,
      }),
    });
    return await res.json();
  } catch (err: any) {
    console.error("[WhatsApp Bot] Error enviando mensaje:", err.message);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { order_id } = await req.json();
    if (!order_id) {
      return new Response(JSON.stringify({ error: "Parámetro 'order_id' es requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Obtener la orden de la base de datos
    const { data: order, error: ordErr } = await supabase
      .from("orders")
      .select("id, comercio, merchant_id, external_order_number, estado_wms, status, raw_shopify_data, total_value, shipping_method, payment_status, sku, item, cantidad")
      .eq("id", order_id)
      .maybeSingle();

    if (ordErr || !order) {
      return new Response(JSON.stringify({ error: "Pedido no encontrado en WMS" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validar estado WMS
    const currentWms = (order.estado_wms || "").trim();
    if (currentWms !== "En procesamiento") {
      return new Response(JSON.stringify({
        error: `El pedido se encuentra actualmente en estado '${currentWms}'. Para admitir y procesar los cambios de Shopify, debe devolver el pedido a 'En procesamiento' antes de sincronizar.`
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const existingRaw = (order.raw_shopify_data || {}) as Record<string, any>;
    const isWmsItemsEdited = existingRaw.wms_items_edited === true;
    const isWmsShippingEdited = existingRaw.wms_shipping_edited === true;

    // 2. Obtener integración activa de Shopify
    let integQuery = supabase
      .from("merchant_integrations")
      .select("*")
      .eq("platform", "Shopify")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (order.comercio) {
      integQuery = integQuery.eq("comercio", order.comercio);
    } else if (order.merchant_id) {
      integQuery = integQuery.eq("merchant_id", order.merchant_id);
    }

    const { data: integs } = await integQuery.limit(1);
    const integ = integs?.[0];

    if (!integ) {
      return new Response(JSON.stringify({ error: `No se encontró integración activa de Shopify para el comercio '${order.comercio}'` }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Consultar la API de Shopify desde el backend (sin restricciones de CORS)
    let shopifyOrder: any = null;
    const rawId = order.raw_shopify_data?.id;

    if (rawId) {
      try {
        const resp = await fetch(`https://${integ.shop_url}/admin/api/2024-04/orders/${rawId}.json`, {
          headers: { "X-Shopify-Access-Token": integ.access_token },
        });
        if (resp.ok) {
          const d = await resp.json();
          shopifyOrder = d.order;
        }
      } catch (fetchErr: any) {
        console.warn("Error consultando por ID a Shopify:", fetchErr.message);
      }
    }

    if (!shopifyOrder) {
      const orderNum = order.external_order_number || "";
      const cleanNum = orderNum.replace(/^[A-Z\s]+#/, "#");
      const encodedNum = encodeURIComponent(cleanNum || orderNum);
      const resp = await fetch(`https://${integ.shop_url}/admin/api/2024-04/orders.json?name=${encodedNum}&status=any`, {
        headers: { "X-Shopify-Access-Token": integ.access_token },
      });
      if (resp.ok) {
        const d = await resp.json();
        if (d.orders && d.orders.length > 0) {
          shopifyOrder = d.orders[0];
        }
      }
    }

    if (!shopifyOrder) {
      return new Response(JSON.stringify({ error: `No fue posible encontrar el pedido en Shopify con referencia ${order.external_order_number}` }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Conciliar ítems de forma inteligente protegiendo ajustes manuales a nivel granular
    let deletedCount = 0;
    const deletedSkusSet = new Set<string>();
    const lineItems = shopifyOrder.line_items || [];

    // Obtener reglas de ediciones manuales si el pedido fue modificado en WMS
    let manualEdits: {
      deleted_skus: string[];
      added_skus: string[];
      modified_quantities: Record<string, number>;
    } = { deleted_skus: [], added_skus: [], modified_quantities: {} };

    if (isWmsItemsEdited) {
      if (existingRaw.wms_manual_edits) {
        manualEdits = {
          deleted_skus: existingRaw.wms_manual_edits.deleted_skus || [],
          added_skus: existingRaw.wms_manual_edits.added_skus || [],
          modified_quantities: existingRaw.wms_manual_edits.modified_quantities || {}
        };
      } else {
        // Fallback: parsear desde order_audit_logs para retrocompatibilidad
        try {
          const { data: logs } = await supabase
            .from("order_audit_logs")
            .select("details")
            .eq("order_id", order.id)
            .eq("action", "Modificación de Ítems")
            .order("created_at", { ascending: true });

          if (logs && logs.length > 0) {
            const delSet = new Set<string>();
            const addSet = new Set<string>();
            const modMap: Record<string, number> = {};

            logs.forEach((log: any) => {
              const changes = log.details?.changes || [];
              changes.forEach((ch: string) => {
                const delMatch = ch.match(/Eliminado SKU\s+([^:]+)/i);
                if (delMatch) {
                  const sku = delMatch[1].trim();
                  delSet.add(sku);
                  addSet.delete(sku);
                  delete modMap[sku];
                }
                const addMatch = ch.match(/Agregado SKU\s+([^:]+):.*\(Cant:\s*(\d+)\)/i);
                if (addMatch) {
                  const sku = addMatch[1].trim();
                  const qty = parseInt(addMatch[2], 10);
                  addSet.add(sku);
                  delSet.delete(sku);
                  modMap[sku] = qty;
                }
                const modMatch = ch.match(/Modificado SKU\s+([^:]+):.*de cantidad\s+\d+\s+a\s+(\d+)/i);
                if (modMatch) {
                  const sku = modMatch[1].trim();
                  const qty = parseInt(modMatch[2], 10);
                  modMap[sku] = qty;
                }
              });
            });

            manualEdits = {
              deleted_skus: Array.from(delSet),
              added_skus: Array.from(addSet),
              modified_quantities: modMap
            };
          }
        } catch (auditErr) {
          console.warn("Aviso consultando audit logs para manual edits:", auditErr);
        }
      }
    }

    const manualDeletedSet = new Set((manualEdits.deleted_skus || []).map((s: string) => s.trim().toLowerCase()));
    const manualAddedSet = new Set((manualEdits.added_skus || []).map((s: string) => s.trim().toLowerCase()));
    const protectedManualLogs: string[] = [];
    const appliedChangesLogs: string[] = [];

    const activeItems = lineItems.filter((item: any) => {
      const effectiveQty = item.current_quantity !== undefined ? item.current_quantity : item.quantity;
      if (effectiveQty <= 0) return false;
      const cleanSku = (item.sku || "").trim().toLowerCase();
      const fallbackSku = (item.variant_id?.toString() || item.id?.toString() || "").trim().toLowerCase();
      if (manualDeletedSet.has(cleanSku) || manualDeletedSet.has(fallbackSku)) {
        protectedManualLogs.push(`SKU ${item.sku || fallbackSku} (${item.title}) se mantiene eliminado por ajuste manual en WMS.`);
        return false;
      }
      return true;
    });

    // Cargar equivalencias de SKU para este comercio
    const skuMap: Record<string, string> = {};
    try {
      const { data: equivalences } = await supabase
        .from("sku_equivalences")
        .select("platform_sku, master_sku, platform")
        .eq("comercio", order.comercio);
      if (equivalences) {
        equivalences.forEach((e: any) => {
          if (e.platform_sku && (e.platform === "Todas" || e.platform === "Shopify")) {
            skuMap[e.platform_sku.trim().replace(/\s+/g, "")] = e.master_sku.trim();
          }
        });
      }
    } catch (_) {}

    // Identificar SKUs eliminados desde Shopify
    const deletedShopifyItems = lineItems.filter((item: any) => {
      const effectiveQty = item.current_quantity !== undefined ? item.current_quantity : item.quantity;
      return effectiveQty <= 0;
    });

    deletedShopifyItems.forEach((item: any) => {
      const sku = (item.sku || "").trim();
      if (sku) deletedSkusSet.add(sku);
      else if (item.title || item.name) deletedSkusSet.add((item.title || item.name).trim());
    });

    // Cargar bodega por defecto
    const { data: whRel } = await supabase
      .from("merchants_warehouses")
      .select("warehouse_id")
      .eq("merchant_id", order.merchant_id || integ.merchant_id)
      .limit(1)
      .maybeSingle();
    const warehouseId = whRel?.warehouse_id || null;

    // 1. Obtener order_items actuales en BD incluyendo SKU para identificar eliminados y agrupar por product_id
    const { data: existingOrderItems } = await supabase
      .from("order_items")
      .select("id, product_id, quantity, warehouse_id, products(sku, name, price)")
      .eq("order_id", order.id);

    const existingByProduct = new Map<string, any[]>();
    (existingOrderItems || []).forEach((i: any) => {
      if (!existingByProduct.has(i.product_id)) existingByProduct.set(i.product_id, []);
      existingByProduct.get(i.product_id)!.push(i);
    });

    // 2. Consolidar cantidades esperadas por product_id (agrupando líneas repetidas del mismo SKU)
    const expectedQuantities = new Map<string, number>();

    for (const item of activeItems) {
      let effectiveQty = item.current_quantity !== undefined ? item.current_quantity : item.quantity;
      const cleanSku = (item.sku || "").trim().replace(/\s+/g, "");
      const mappedSku = skuMap[cleanSku] || cleanSku;
      const fallbackSku = item.variant_id ? String(item.variant_id) : (item.id ? String(item.id) : "NO-SKU");
      const searchSku = mappedSku || fallbackSku;

      // Verificar si hay cantidad modificada manualmente en WMS
      const cleanLower = cleanSku.toLowerCase();
      const varLower = (item.variant_id?.toString() || '').toLowerCase();
      for (const [mSku, mQty] of Object.entries(manualEdits.modified_quantities || {})) {
        const mLower = mSku.trim().toLowerCase();
        if (mLower === cleanLower || mLower === varLower) {
          effectiveQty = mQty;
          protectedManualLogs.push(`SKU ${searchSku} mantiene cantidad manual WMS (${mQty}) en lugar de Shopify (${item.current_quantity || item.quantity}).`);
          break;
        }
      }

      let { data: prod } = await supabase
        .from("products")
        .select("id, sku, name")
        .eq("sku", searchSku)
        .eq("comercio", order.comercio)
        .maybeSingle();

      if (!prod) {
        const { data: newProd } = await supabase
          .from("products")
          .insert([{
            merchant_id: integ.merchant_id,
            comercio: order.comercio,
            sku: searchSku,
            name: `${item.title}${item.variant_title && item.variant_title !== "Default Title" ? " - " + item.variant_title : ""}`,
            price: item.price ? parseFloat(item.price) : 0,
            status: "active"
          }])
          .select("id, sku, name")
          .single();
        prod = newProd;
      }

      if (prod) {
        const currentQty = expectedQuantities.get(prod.id) || 0;
        expectedQuantities.set(prod.id, currentQty + effectiveQty);
      }
    }

    // Preservar productos agregados manualmente en WMS que no vienen en Shopify
    for (const [prodId, rows] of existingByProduct.entries()) {
      const pSku = (rows[0]?.products?.sku || "").trim();
      const pSkuLower = pSku.toLowerCase();
      if (manualAddedSet.has(pSkuLower) && !expectedQuantities.has(prodId)) {
        const manualQty = manualEdits.modified_quantities[pSku] || rows[0]?.quantity || 1;
        expectedQuantities.set(prodId, manualQty);
        protectedManualLogs.push(`Item "${rows[0]?.products?.name}" (SKU: ${pSku}) se preserva por haber sido agregado manualmente en WMS.`);
      }
    }

    // Identificar cambios aplicados desde Shopify vs existentes en WMS
    for (const [prodId, expQty] of expectedQuantities.entries()) {
      const rows = existingByProduct.get(prodId) || [];
      if (rows.length === 0) {
        appliedChangesLogs.push(`Añadido desde Shopify: ${expQty} ud(s)`);
      } else if (rows[0].quantity !== expQty) {
        appliedChangesLogs.push(`Cantidad actualizada: de ${rows[0].quantity} a ${expQty} ud(s)`);
      }
    }

    // 3. Conciliar contra existingOrderItems consolidando duplicados
    for (const [prodId, expQty] of expectedQuantities.entries()) {
      const rows = existingByProduct.get(prodId) || [];
      if (rows.length === 0) {
        await supabase
          .from("order_items")
          .insert([{
            order_id: order.id,
            product_id: prodId,
            warehouse_id: warehouseId,
            quantity: expQty,
          }]);
      } else {
        const primaryRow = rows[0];
        if (primaryRow.quantity !== expQty || (warehouseId && primaryRow.warehouse_id !== warehouseId)) {
          await supabase
            .from("order_items")
            .update({
              quantity: expQty,
              warehouse_id: warehouseId || primaryRow.warehouse_id,
            })
            .eq("id", primaryRow.id);
        }
        if (rows.length > 1) {
          for (let k = 1; k < rows.length; k++) {
            await supabase.from("order_items").delete().eq("id", rows[k].id);
          }
        }
      }
    }

    // 4. Eliminar de order_items aquellos productos que ya no están activos
    for (const [prodId, rows] of existingByProduct.entries()) {
      if (!expectedQuantities.has(prodId)) {
        for (const row of rows) {
          await supabase.from("order_items").delete().eq("id", row.id);
          deletedCount++;
          const pSku = row.products?.sku;
          if (pSku) {
            deletedSkusSet.add(pSku.trim());
            appliedChangesLogs.push(`Eliminado por Shopify: SKU ${pSku.trim()} (${row.quantity} ud)`);
          }
        }
      }
    }

    // Asegurar que deletedSkusSet no incluya SKUs que aún tienen unidades activas
    activeItems.forEach((item: any) => {
      const sku = (item.sku || "").trim();
      if (sku) deletedSkusSet.delete(sku);
      if (item.title || item.name) deletedSkusSet.delete((item.title || item.name).trim());
    });

    const deletedSkusList = Array.from(deletedSkusSet);
    const deletedSkusText = deletedSkusList.length > 0 
      ? `(SKU eliminados: ${deletedSkusList.join(", ")})` 
      : `(Sin SKU eliminados)`;

    let totalUpdatedUnits = 0;
    for (const qty of expectedQuantities.values()) {
      totalUpdatedUnits += qty;
    }

    // 5. Actualizar el pedido en orders respetando las ediciones manuales en WMS
    const newTotal = isWmsItemsEdited
      ? Number(order.total_value)
      : Number(shopifyOrder.current_total_price || shopifyOrder.total_price || order.total_value);

    const updatedPayload: Record<string, any> = {
      payment_status: shopifyOrder.financial_status || order.payment_status,
      cantidad: totalUpdatedUnits,
      raw_shopify_data: {
        ...shopifyOrder,
        line_items: isWmsItemsEdited ? (existingRaw.line_items || shopifyOrder.line_items) : shopifyOrder.line_items,
        ...(isWmsItemsEdited ? { wms_items_edited: true } : {}),
        ...(isWmsShippingEdited ? { wms_shipping_edited: true } : {}),
        ...((existingRaw.wms_custom_edited || isWmsItemsEdited || isWmsShippingEdited) ? { wms_custom_edited: true } : {}),
        ...(existingRaw.wms_manual_edits ? { wms_manual_edits: existingRaw.wms_manual_edits } : {})
      }
    };

    if (!isWmsItemsEdited) {
      updatedPayload.total_value = newTotal;
    }

    if (!isWmsShippingEdited) {
      updatedPayload.shipping_method = shopifyOrder.shipping_lines?.[0]?.title || order.shipping_method;
      if (shopifyOrder.shipping_address) {
        updatedPayload.shipping_address = shopifyOrder.shipping_address.address1;
        updatedPayload.shipping_city = shopifyOrder.shipping_address.city;
        updatedPayload.shipping_complement = shopifyOrder.shipping_address.address2;
        updatedPayload.customer_name = `${shopifyOrder.shipping_address.first_name || ''} ${shopifyOrder.shipping_address.last_name || ''}`.trim() || undefined;
        updatedPayload.customer_phone = shopifyOrder.shipping_address.phone || undefined;
      }
      if (shopifyOrder.contact_email || shopifyOrder.email) {
        updatedPayload.customer_email = shopifyOrder.contact_email || shopifyOrder.email;
      }
    }

    await supabase
      .from("orders")
      .update(updatedPayload)
      .eq("id", order.id);

    // 6. Notificar a WhatsApp grupo "Gestión Stocka"
    const formattedPrice = Number(order.total_value || newTotal).toLocaleString("es-CL");
    let waMsg = `ℹ️ *Pedido Re-sincronizado desde Shopify*\n\n` +
      `🏪 *Comercio:* ${order.comercio}\n` +
      `📦 *Pedido:* ${order.external_order_number || order.id}\n` +
      `🏷️ *Estado WMS:* En procesamiento\n` +
      `💰 *Total:* $${formattedPrice} (${totalUpdatedUnits} uds.)\n` +
      `🛒 *SKU activos:* ${expectedQuantities.size} ${deletedSkusText}\n\n`;

    if (appliedChangesLogs.length > 0) {
      waMsg += `📋 *Cambios aplicados desde Shopify:*\n` + appliedChangesLogs.map(c => `• ${c}`).join('\n') + '\n\n';
    }

    if (protectedManualLogs.length > 0) {
      waMsg += `🛡️ *Ajustes manuales WMS protegidos:*\n` + protectedManualLogs.map(p => `• ${p}`).join('\n') + '\n\n';
    }

    notifyWhatsAppGestion(waMsg.trim()).catch(() => {});

    let respMessage = `Pedido ${order.external_order_number || order.id} re-sincronizado exitosamente desde Shopify.`;
    if (protectedManualLogs.length > 0) {
      respMessage += ` Se protegieron los ajustes manuales previos de bodega.`;
    }

    return new Response(JSON.stringify({
      success: true,
      activeItemsCount: expectedQuantities.size,
      totalUnits: totalUpdatedUnits,
      deletedItemsCount: deletedCount,
      deletedSkus: deletedSkusList,
      totalValue: newTotal,
      paymentStatus: updatedPayload.payment_status,
      wmsItemsProtected: isWmsItemsEdited,
      protectedActions: protectedManualLogs,
      appliedChanges: appliedChangesLogs,
      message: respMessage
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err: any) {
    console.error("[Resync Shopify Order Error]:", err);
    return new Response(JSON.stringify({ error: err.message || "Error interno del servidor" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
