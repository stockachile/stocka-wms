import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const brevoApiKey = Deno.env.get("BREVO_API_KEY") ?? "";
const enviameApiKey = Deno.env.get("ENVIAME_API_KEY") ?? "";
const shopifyClientId = Deno.env.get("SHOPIFY_CLIENT_ID") ?? "";
const shopifyClientSecret = Deno.env.get("SHOPIFY_CLIENT_SECRET") ?? "";

const MATRIZ_NUNOA_WH_ID = "973da888-8a63-4790-a08f-919e1af41a93";

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false }
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function escapeHtml(str: string): string {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatCLP(val: number): string {
  return "$" + Math.round(Number(val) || 0).toLocaleString("es-CL");
}

async function authorizeCaller(req: Request, targetComercio?: string) {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) {
    throw { status: 401, message: "Falta cabecera Authorization." };
  }
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (supabaseServiceKey && token === supabaseServiceKey.trim()) {
    return { isService: true, isAdmin: true, email: "Sistema WMS Stocka", userId: null };
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    throw { status: 401, message: "Sesión de usuario inválida o expirada." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, comercio, company_name")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    throw { status: 403, message: "Perfil de usuario no encontrado." };
  }

  const isAdmin = profile.role === "admin" || String(profile.comercio || "").trim().toLowerCase() === "all";
  if (!isAdmin && targetComercio) {
    const allowed = String(profile.comercio || "")
      .split(",")
      .map((c: string) => c.trim().toLowerCase())
      .filter(Boolean);
    if (!allowed.includes(targetComercio.trim().toLowerCase())) {
      throw { status: 403, message: "No tienes permisos sobre este comercio." };
    }
  }

  return {
    isService: false,
    isAdmin,
    email: user.email || "Usuario WMS",
    userId: user.id
  };
}

async function sendBrevoEmail(opts: {
  to: { email: string; name?: string }[];
  subject: string;
  htmlContent: string;
  senderName?: string;
}) {
  if (!brevoApiKey || !opts.to || opts.to.length === 0) return;
  try {
    await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "api-key": brevoApiKey
      },
      body: JSON.stringify({
        sender: { name: opts.senderName || "Stocka Postventa", email: "info@stocka.cl" },
        to: opts.to,
        subject: opts.subject,
        htmlContent: opts.htmlContent
      })
    });
  } catch (e) {
    console.warn("[reverse-channel-sync] Aviso enviando email Brevo:", e);
  }
}

async function getSellerNotificationEmails(comercio: string, supportEmail?: string): Promise<{ email: string; name?: string }[]> {
  const set = new Set<string>();
  if (supportEmail && supportEmail.includes("@")) {
    set.add(supportEmail.trim().toLowerCase());
  }
  const { data: addCfg } = await supabase
    .from("comercios_adicional_config")
    .select("email_colaborador, rep_legal_email")
    .ilike("comercio", comercio.trim())
    .maybeSingle();

  if (addCfg?.email_colaborador) {
    String(addCfg.email_colaborador).split(/[,;\s]+/).forEach((e) => {
      if (e.includes("@")) set.add(e.trim().toLowerCase());
    });
  }
  if (addCfg?.rep_legal_email && String(addCfg.rep_legal_email).includes("@")) {
    set.add(String(addCfg.rep_legal_email).trim().toLowerCase());
  }

  set.add("stockachile@gmail.com");
  return Array.from(set).slice(0, 6).map((email) => ({ email }));
}

// Intentar generar etiqueta de retorno con Envíame API v2 (Cliente Regiones -> Bodega Stocka Ñuñoa)
async function tryCreateEnviameReverseLabel(rma: any): Promise<{
  ok: boolean;
  tracking_number?: string;
  label_url?: string;
  delivery_id?: string;
  carrier?: string;
  error?: string;
}> {
  if (!enviameApiKey) {
    return { ok: false, error: "ENVIAME_API_KEY no configurada." };
  }

  try {
    const { data: addCfg } = await supabase
      .from("comercios_adicional_config")
      .select("enviame_id")
      .ilike("comercio", String(rma.comercio || "").trim())
      .maybeSingle();

    let companyId = "";
    if (addCfg?.enviame_id) {
      companyId = String(addCfg.enviame_id).split(",")[0].trim().replace(/^ID\s*:?\s*/i, "");
    }
    if (!companyId) {
      return { ok: false, error: "El comercio no registra enviame_id configurado para emisión automática." };
    }

    const rawCarrier = String(rma.inbound_courier || "BLUEXPRESS").toUpperCase();
    let carrierCode = "BLX";
    if (rawCarrier.includes("STARKEN")) carrierCode = "STK";
    else if (rawCarrier.includes("CHILEXPRESS")) carrierCode = "CHX";
    else if (rawCarrier.includes("BLUE")) carrierCode = "BLX";

    const totalQty = Math.max(1, Number(rma.cantidad_total) || 1);
    const payload = {
      shipping_order: {
        n_packages: 1,
        content_description: `Devolución Ecommerce ${rma.rma_number || rma.referencia_pedido}`,
        imported_id: `${rma.rma_number || rma.id}-RET`,
        order_price: Math.max(1000, Number(rma.financial_summary?.credit_total) || 10000),
        weight: Math.max(0.5, totalQty * 0.5),
        volume: 0.004,
        type: "reverse"
      },
      shipping_origin: {
        warehouse_code: "DEFAULT"
      },
      shipping_destination: {
        customer: {
          name: `Recepción Stocka (${rma.comercio})`,
          email: "info@stocka.cl",
          phone: "56900000000"
        },
        delivery_address: {
          home_address: {
            place: "Ñuñoa",
            full_address: "Av. Campo de Deportes 405, Ñuñoa",
            information: `RMA ${rma.rma_number} · Cliente origen: ${rma.customer_name || ""} (${rma.shipping_city || ""})`
          }
        }
      },
      carrier: {
        carrier_code: carrierCode,
        tracking_number: ""
      }
    };

    const res = await fetch(`https://api.enviame.io/api/s2/v2/companies/${companyId}/deliveries`, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "api-key": enviameApiKey
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `Envíame HTTP ${res.status}: ${txt.slice(0, 180)}` };
    }

    const json = await res.json();
    const d = json?.data || json;
    const trackingNumber = String(d?.tracking_number || "").trim();
    const labelUrl = String(d?.label?.PDF || d?.label_url || "").trim();
    const deliveryId = d?.identifier ? String(d.identifier) : (d?.id ? String(d.id) : "");

    if (!trackingNumber) {
      return { ok: false, error: "Envíame no retornó número de seguimiento." };
    }

    return {
      ok: true,
      tracking_number: trackingNumber,
      label_url: labelUrl,
      delivery_id: deliveryId,
      carrier: rawCarrier
    };
  } catch (err: any) {
    return { ok: false, error: err.message || "Excepción conectando con Envíame." };
  }
}

// Sincronización con Shopify (GraphQL returnCreate + Cupón Store Credit + Tags/Notas)
async function syncRmaWithShopify(rma: any, origOrder: any, options: any): Promise<any> {
  const { data: integration } = await supabase
    .from("merchant_integrations")
    .select("*")
    .eq("platform", "Shopify")
    .eq("is_active", true)
    .ilike("comercio", String(rma.comercio || "").trim())
    .maybeSingle();

  if (!integration || !integration.shop_url || !integration.access_token) {
    return { ok: false, skipped: true, reason: "Sin integración activa de Shopify para este comercio." };
  }

  let accessToken = integration.access_token;
  const shop = String(integration.shop_url).replace(/^https?:\/\//, "").replace(/\/$/, "");
  const shopifyOrderId = origOrder?.raw_shopify_data?.id ? String(origOrder.raw_shopify_data.id) : "";

  const resultSummary: Record<string, any> = {
    platform: "Shopify",
    synced_at: new Date().toISOString()
  };

  // Helper GraphQL con refresh automático si token expiró
  async function shopifyGraphql(query: string, variables: any) {
    let res = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query, variables })
    });

    if (res.status === 401 && integration.refresh_token && shopifyClientId && shopifyClientSecret) {
      const refreshRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: shopifyClientId,
          client_secret: shopifyClientSecret,
          grant_type: "refresh_token",
          refresh_token: integration.refresh_token
        })
      });
      if (refreshRes.ok) {
        const td = await refreshRes.json();
        accessToken = td.access_token;
        await supabase
          .from("merchant_integrations")
          .update({ access_token: accessToken, refresh_token: td.refresh_token || integration.refresh_token })
          .eq("id", integration.id);

        res = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ query, variables })
        });
      }
    }
    return res.json();
  }

  // 1. Agregar Tag y Nota de trazabilidad a la orden original en Shopify (funciona con write_orders ya concedido)
  if (shopifyOrderId) {
    try {
      const tagMutation = `
        mutation tagsAdd($id: ID!, $tags: [String!]!) {
          tagsAdd(id: $id, tags: $tags) {
            userErrors { field message }
          }
        }
      `;
      await shopifyGraphql(tagMutation, {
        id: `gid://shopify/Order/${shopifyOrderId}`,
        tags: [`Stocka-RMA`, rma.rma_number || "RMA", rma.tipo_movimiento]
      });
      resultSummary.order_tagged = true;
    } catch (e: any) {
      resultSummary.tag_warning = e.message;
    }
  }

  // 2. Ejecutar returnCreate oficial en Shopify si hay shopifyOrderId y el seller lo solicitó
  if (shopifyOrderId && options?.create_return !== false) {
    try {
      const orderQuery = `
        query getOrderFulfillments($id: ID!) {
          order(id: $id) {
            id
            fulfillments(first: 10) {
              fulfillmentLineItems(first: 50) {
                edges {
                  node {
                    id
                    quantity
                    lineItem {
                      sku
                      variant { id }
                    }
                  }
                }
              }
            }
          }
        }
      `;
      const fqRes = await shopifyGraphql(orderQuery, { id: `gid://shopify/Order/${shopifyOrderId}` });
      const fulfillments = fqRes?.data?.order?.fulfillments || [];
      const fliPool: any[] = [];
      fulfillments.forEach((f: any) => {
        (f.fulfillmentLineItems?.edges || []).forEach((edge: any) => {
          if (edge?.node) fliPool.push(edge.node);
        });
      });

      const returnLineItems: any[] = [];
      for (const rIt of (rma.return_items || [])) {
        const matchFli = fliPool.find((fli: any) => {
          const fliSku = String(fli.lineItem?.sku || "").trim().toLowerCase();
          const fliVarGid = String(fli.lineItem?.variant?.id || "");
          return (rIt.sku && fliSku === String(rIt.sku).trim().toLowerCase()) ||
                 (rIt.shopify_variant_id && fliVarGid.endsWith(`/${rIt.shopify_variant_id}`));
        });
        if (matchFli) {
          returnLineItems.push({
            fulfillmentLineItemId: matchFli.id,
            quantity: Math.min(Number(rIt.qty) || 1, Number(matchFli.quantity) || 1),
            returnReason: rIt.is_fault ? "DEFECTIVE" : "SIZE_TOO_SMALL",
            returnReasonNote: rIt.reason_label || "Gestionado en Portal Stocka"
          });
        }
      }

      if (returnLineItems.length > 0) {
        const exchangeLineItems: any[] = [];
        if (rma.resolution_type === "exchange" && options?.create_exchange_items) {
          for (const exIt of (rma.exchange_items || [])) {
            if (exIt.shopify_variant_id) {
              exchangeLineItems.push({
                variantId: `gid://shopify/ProductVariant/${exIt.shopify_variant_id}`,
                quantity: Number(exIt.qty) || 1
              });
            }
          }
        }

        const returnCreateMutation = `
          mutation returnCreate($returnInput: ReturnInput!) {
            returnCreate(returnInput: $returnInput) {
              return { id name status }
              userErrors { field message }
            }
          }
        `;
        const rcInput: Record<string, any> = {
          orderId: `gid://shopify/Order/${shopifyOrderId}`,
          returnLineItems
        };
        if (exchangeLineItems.length > 0) {
          rcInput.exchangeLineItems = exchangeLineItems;
        }

        const rcRes = await shopifyGraphql(returnCreateMutation, { returnInput: rcInput });
        if (rcRes?.errors) {
          resultSummary.return_api_notice = "Requiere re-autorizar permiso write_returns en Integraciones Shopify.";
          resultSummary.needs_scope_reauth = true;
        } else if (rcRes?.data?.returnCreate?.return) {
          resultSummary.shopify_return = rcRes.data.returnCreate.return;
        } else if (rcRes?.data?.returnCreate?.userErrors?.length > 0) {
          resultSummary.return_user_errors = rcRes.data.returnCreate.userErrors;
        }
      } else {
        resultSummary.return_api_notice = "El pedido en Shopify aún no tenía FulfillmentLineItems para asociar returnCreate (se aplicó etiqueta RMA).";
      }
    } catch (retErr: any) {
      resultSummary.return_error = retErr.message;
    }
  }

  // 3. Si es Crédito en Tienda (store_credit), emitir código de descuento único por el monto a favor
  if (rma.resolution_type === "store_credit" && Number(rma.financial_summary?.store_credit_final) > 0) {
    try {
      const codeStr = `CRED-${(rma.rma_number || "STK").replace(/[^A-Z0-9]/gi, "")}`;
      const amountVal = Math.round(Number(rma.financial_summary.store_credit_final));
      const discMutation = `
        mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
          discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
            codeDiscountNode { id }
            userErrors { field message }
          }
        }
      `;
      const dRes = await shopifyGraphql(discMutation, {
        basicCodeDiscount: {
          title: `Crédito Postventa ${rma.rma_number}`,
          code: codeStr,
          startsAt: new Date().toISOString(),
          usageLimit: 1,
          appliesOncePerCustomer: true,
          customerSelection: { all: true },
          customerGets: {
            value: {
              discountAmount: {
                amount: String(amountVal),
                appliesOnEachItem: false
              }
            },
            items: { all: true }
          }
        }
      });

      if (dRes?.data?.discountCodeBasicCreate?.codeDiscountNode) {
        resultSummary.store_credit_code = codeStr;
        resultSummary.store_credit_amount = amountVal;
      } else {
        resultSummary.discount_notice = dRes?.errors?.[0]?.message || dRes?.data?.discountCodeBasicCreate?.userErrors?.[0]?.message;
      }
    } catch (dErr: any) {
      resultSummary.discount_error = dErr.message;
    }
  }

  resultSummary.ok = true;
  return resultSummary;
}

// Sincronización con WooCommerce (Notas, Orden de Reemplazo $0, Cupón Crédito o Refund al recepcionar)
async function syncRmaWithWooCommerce(rma: any, origOrder: any, options: any): Promise<any> {
  const { data: integration } = await supabase
    .from("merchant_integrations")
    .select("*")
    .eq("platform", "WooCommerce")
    .eq("is_active", true)
    .ilike("comercio", String(rma.comercio || "").trim())
    .maybeSingle();

  if (!integration || !integration.shop_url || !integration.access_token) {
    return { ok: false, skipped: true, reason: "Sin integración activa de WooCommerce para este comercio." };
  }

  let creds: any = {};
  try {
    creds = JSON.parse(integration.access_token);
  } catch {
    return { ok: false, error: "Credenciales WooCommerce inválidas." };
  }

  let baseUrl = String(integration.shop_url).trim();
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) baseUrl = "https://" + baseUrl;
  if (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);

  const authHeader = "Basic " + btoa(`${String(creds.consumer_key || "").trim()}:${String(creds.consumer_secret || "").trim()}`);
  const headers = {
    "Authorization": authHeader,
    "Accept": "application/json",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; StockaWMS/2.0)"
  };

  const wooOrderId = origOrder?.raw_woocommerce_data?.id ? String(origOrder.raw_woocommerce_data.id) : "";
  const resultSummary: Record<string, any> = {
    platform: "WooCommerce",
    synced_at: new Date().toISOString()
  };

  // 1. Nota de auditoría en pedido original
  if (wooOrderId && options?.add_notes !== false) {
    try {
      const noteText = `[Stocka Logística Inversa · ${rma.rma_number}] Solicitud de ${rma.tipo_movimiento} aprobada. Estado: ${rma.workflow_status}. Modalidad: ${rma.transporte || rma.logistics_option}.`;
      const nRes = await fetch(`${baseUrl}/wp-json/wc/v3/orders/${wooOrderId}/notes`, {
        method: "POST",
        headers,
        body: JSON.stringify({ note: noteText, customer_note: false })
      });
      resultSummary.note_added = nRes.ok;
    } catch (e: any) {
      resultSummary.note_error = e.message;
    }
  }

  // 2. Crear Orden de Reemplazo vinculada en WooCommerce si el seller lo solicitó
  if (rma.resolution_type === "exchange" && options?.create_replacement_order === true) {
    try {
      const lineItems = (rma.exchange_items || [])
        .filter((it: any) => it.woocommerce_product_id)
        .map((it: any) => ({
          product_id: Number(it.woocommerce_product_id),
          ...(it.woocommerce_variation_id ? { variation_id: Number(it.woocommerce_variation_id) } : {}),
          quantity: Number(it.qty) || 1,
          subtotal: "0.00",
          total: "0.00"
        }));

      if (lineItems.length > 0) {
        const nameParts = String(rma.customer_name || "Cliente").trim().split(/\s+/);
        const firstName = nameParts[0] || "Cliente";
        const lastName = nameParts.slice(1).join(" ") || "-";

        const newOrderPayload = {
          status: "processing",
          set_paid: true,
          customer_note: `Orden de Cambio asociada a ${rma.rma_number} (Pedido original ${rma.referencia_pedido})`,
          billing: {
            first_name: firstName,
            last_name: lastName,
            email: rma.customer_email || "",
            phone: rma.customer_phone || "",
            address_1: rma.shipping_address || "",
            city: rma.shipping_city || ""
          },
          shipping: {
            first_name: firstName,
            last_name: lastName,
            address_1: rma.shipping_address || "",
            address_2: rma.shipping_complement || "",
            city: rma.shipping_city || ""
          },
          line_items: lineItems,
          meta_data: [
            { key: "_stocka_rma_id", value: String(rma.id) },
            { key: "_stocka_rma_number", value: String(rma.rma_number || "") },
            { key: "_stocka_skip_webhook_import", value: "true" }
          ]
        };

        const oRes = await fetch(`${baseUrl}/wp-json/wc/v3/orders`, {
          method: "POST",
          headers,
          body: JSON.stringify(newOrderPayload)
        });
        if (oRes.ok) {
          const oJson = await oRes.json();
          resultSummary.woo_replacement_order_id = oJson.id;
          resultSummary.woo_replacement_order_number = oJson.number;
        }
      }
    } catch (e: any) {
      resultSummary.replacement_error = e.message;
    }
  }

  // 3. Emitir Cupón de Crédito en Tienda si corresponde
  if (rma.resolution_type === "store_credit" && Number(rma.financial_summary?.store_credit_final) > 0) {
    try {
      const codeStr = `CRED-${(rma.rma_number || "STK").replace(/[^A-Z0-9]/gi, "")}`;
      const amountVal = Math.round(Number(rma.financial_summary.store_credit_final));
      const cRes = await fetch(`${baseUrl}/wp-json/wc/v3/coupons`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          code: codeStr,
          discount_type: "fixed_cart",
          amount: String(amountVal),
          individual_use: true,
          usage_limit: 1,
          email_restrictions: rma.customer_email ? [rma.customer_email] : [],
          description: `Crédito de cambio/devolución ${rma.rma_number}`
        })
      });
      if (cRes.ok) {
        resultSummary.store_credit_code = codeStr;
        resultSummary.store_credit_amount = amountVal;
      }
    } catch (e: any) {
      resultSummary.coupon_error = e.message;
    }
  }

  // 4. Registrar Refund contable en WooCommerce cuando se ejecuta desde QC / Devolución confirmada
  if (wooOrderId && options?.execute_refund === true && rma.resolution_type === "return") {
    try {
      const refundAmt = Math.max(0, Number(rma.financial_summary?.refund_final ?? rma.financial_summary?.credit_total ?? 0));
      if (refundAmt > 0) {
        const refRes = await fetch(`${baseUrl}/wp-json/wc/v3/orders/${wooOrderId}/refunds`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            amount: String(refundAmt),
            reason: `Devolución recepcionada en Stocka (${rma.rma_number})`,
            api_refund: false, // Registro contable seguro; el seller ejecuta la transferencia/pasarela
            restock_items: false // El stock maestro ya se ajusta en Stocka WMS
          })
        });
        if (refRes.ok) {
          const refJson = await refRes.json();
          resultSummary.woo_refund_id = refJson.id;
        }
      }
    } catch (e: any) {
      resultSummary.refund_error = e.message;
    }
  }

  resultSummary.ok = true;
  return resultSummary;
}

function buildBuyerStatusEmailHtml(opts: {
  brandName: string;
  primaryColor: string;
  logoUrl?: string;
  title: string;
  badgeText: string;
  rmaNumber: string;
  orderNumber: string;
  bodyHtml: string;
  portalUrl: string;
}) {
  const safeBrand = escapeHtml(opts.brandName);
  const color = /^#[0-9A-Fa-f]{6}$/.test(opts.primaryColor || "") ? opts.primaryColor : "#5c24ff";
  const logoHtml = opts.logoUrl
    ? `<img src="${escapeHtml(opts.logoUrl)}" alt="${safeBrand}" style="max-height: 46px; max-width: 190px; object-fit: contain; margin-bottom: 14px;">`
    : `<div style="font-size: 19px; font-weight: 800; color: ${color}; margin-bottom: 10px;">${safeBrand}</div>`;

  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 12px;">
  <div style="max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 10px 25px rgba(15, 23, 42, 0.06);">
    <div style="height: 6px; background: ${color};"></div>
    <div style="padding: 28px 28px 18px 28px; text-align: center; border-bottom: 1px solid #f1f5f9;">
      ${logoHtml}
      <div style="display: inline-block; background: #f1f5f9; color: #334155; font-size: 11.5px; font-weight: 700; padding: 4px 12px; border-radius: 999px; margin-bottom: 10px; text-transform: uppercase;">
        ${escapeHtml(opts.badgeText)} · ${escapeHtml(opts.rmaNumber)}
      </div>
      <h1 style="margin: 0; font-size: 21px; font-weight: 800; color: #0f172a;">${escapeHtml(opts.title)}</h1>
      <p style="margin: 6px 0 0 0; font-size: 13px; color: #64748b;">Pedido original: <strong>#${escapeHtml(opts.orderNumber)}</strong></p>
    </div>
    <div style="padding: 24px 28px; font-size: 14.5px; color: #334155; line-height: 1.6;">
      ${opts.bodyHtml}
      <div style="text-align: center; margin-top: 26px;">
        <a href="${escapeHtml(opts.portalUrl)}" target="_blank" style="display: inline-block; background: ${color}; color: #ffffff !important; text-decoration: none; font-weight: 700; font-size: 14px; padding: 12px 26px; border-radius: 10px;">
          Ver Estado de mi Solicitud
        </a>
      </div>
    </div>
    <div style="background: #f8fafc; padding: 14px 24px; text-align: center; font-size: 11.5px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
      Logística Inversa operada por <strong>Stocka Logistics &amp; WMS</strong> · Av. Campo de Deportes 405, Ñuñoa
    </div>
  </div>
</body>
</html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "").trim();

    // =========================================================================
    // 1. OBTENER SIGNED READ URLS PARA VISOR MULTIMEDIA EN WMS (SELLER / ADMIN)
    // =========================================================================
    if (action === "get_signed_media_urls") {
      const rlId = String(body.rl_id || "").trim();
      const paths: string[] = Array.isArray(body.paths) ? body.paths : [];

      const { data: rma } = await supabase
        .from("reverse_logistics")
        .select("id, comercio")
        .eq("id", rlId)
        .maybeSingle();

      if (!rma) {
        return new Response(JSON.stringify({ error: "Registro no encontrado." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      await authorizeCaller(req, rma.comercio);

      const signedMap: Record<string, string> = {};
      for (const p of paths.slice(0, 30)) {
        const cleanP = String(p || "").trim();
        if (!cleanP) continue;
        if (cleanP.startsWith("http://") || cleanP.startsWith("https://")) {
          signedMap[cleanP] = cleanP;
          continue;
        }
        const { data } = await supabase.storage
          .from("reverse-logistics-media")
          .createSignedUrl(cleanP, 7200);
        if (data?.signedUrl) {
          signedMap[cleanP] = data.signedUrl;
        }
      }

      return new Response(JSON.stringify({ success: true, urls: signedMap }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // =========================================================================
    // 2. NOTIFICAR NUEVA SOLICITUD CREADA DESDE EL PORTAL PÚBLICO O INTERNO
    // =========================================================================
    if (action === "notify_new_portal_rma" || action === "notify_internal_rl_created") {
      const rlId = String(body.rl_id || "").trim();
      const { data: rma } = await supabase
        .from("reverse_logistics")
        .select("*")
        .eq("id", rlId)
        .maybeSingle();

      if (!rma) {
        return new Response(JSON.stringify({ error: "RMA no encontrado" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      await authorizeCaller(req, rma.comercio);

      const { data: cfg } = await supabase.rpc("get_public_return_portal_config", {
        p_comercio_or_slug: rma.comercio
      });
      const brandName = cfg?.brand_name || rma.comercio || "Stocka";
      const primaryColor = cfg?.primary_color || "#5c24ff";
      const portalUrl = cfg?.slug
        ? `https://wms.stocka.cl/cambios?s=${encodeURIComponent(cfg.slug)}`
        : `https://wms.stocka.cl/cambios`;

      const folio = rma.rma_number || rma.referencia_pedido || "RMA";

      if (action === "notify_new_portal_rma" && rma.customer_email) {
        const buyerHtml = buildBuyerStatusEmailHtml({
          brandName,
          primaryColor,
          logoUrl: cfg?.logo_url,
          title: "¡Recibimos tu solicitud!",
          badgeText: rma.tipo_movimiento === "CAMBIO" ? "Solicitud de Cambio" : "Solicitud de Devolución",
          rmaNumber: folio,
          orderNumber: rma.referencia_pedido || "-",
          portalUrl,
          bodyHtml: `
            <p>Hola <strong>${escapeHtml(rma.customer_name || "Cliente")}</strong>,</p>
            <p>Hemos registrado tu solicitud <strong>${escapeHtml(folio)}</strong> en <strong>${escapeHtml(brandName)}</strong>. El equipo de la tienda revisará los antecedentes enviados y te notificaremos por esta misma vía apenas sea aprobada con las instrucciones de entrega o retiro.</p>
            ${Number(rma.financial_summary?.buyer_owes_amount) > 0 ? `
              <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 14px; margin: 16px 0; font-size: 13.5px; color: #92400e;">
                <strong>Diferencia estimada a pagar: ${formatCLP(rma.financial_summary.buyer_owes_amount)}</strong><br>
                Una vez aprobada tu solicitud por la tienda, podrás gestionar el pago y subir tu comprobante en el portal.
              </div>
            ` : ""}
          `
        });

        await sendBrevoEmail({
          to: [{ email: rma.customer_email, name: rma.customer_name || "Cliente" }],
          subject: `[${folio}] Recibimos tu solicitud en ${brandName}`,
          htmlContent: buyerHtml,
          senderName: `${brandName} - Postventa`
        });
      }

      const sellerRecipients = await getSellerNotificationEmails(rma.comercio, cfg?.support_email);
      await sendBrevoEmail({
        to: sellerRecipients,
        subject: `🔄 Nueva Solicitud ${folio} (${rma.tipo_movimiento}) - ${rma.comercio} · Ped #${rma.referencia_pedido}`,
        senderName: "Stocka WMS · Logística Inversa",
        htmlContent: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
            <h2 style="margin-top: 0; color: #0f172a;">Nueva Solicitud de Logística Inversa: ${escapeHtml(folio)}</h2>
            <p style="color: #475569;">Se ha registrado una solicitud desde <strong>${escapeHtml(rma.creado_por || "Portal")}</strong> para el comercio <strong>${escapeHtml(rma.comercio)}</strong>.</p>
            <ul style="color: #334155; font-size: 14px; line-height: 1.6;">
              <li><strong>Pedido Original:</strong> #${escapeHtml(rma.referencia_pedido || "-")}</li>
              <li><strong>Tipo:</strong> ${escapeHtml(rma.tipo_movimiento)} (${escapeHtml(rma.resolution_type || "-")})</li>
              <li><strong>Cliente:</strong> ${escapeHtml(rma.customer_name || "-")} (${escapeHtml(rma.customer_email || "-")})</li>
              <li><strong>Modalidad solicitada:</strong> ${escapeHtml(rma.transporte || "-")}</li>
              <li><strong>Diferencia financiera:</strong> ${formatCLP(rma.financial_summary?.net_difference || 0)}</li>
            </ul>
            <div style="margin-top: 20px;">
              <a href="https://wms.stocka.cl/dashboard.html" style="display: inline-block; background: #5c24ff; color: #fff; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-weight: 700;">Revisar y Aprobar en WMS Stocka</a>
            </div>
          </div>
        `
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // =========================================================================
    // 3. APROBAR SOLICITUD RMA (RESERVA STOCK EN CAMBIOS + CREA ORDEN WMS + OPCIONAL SHOPIFY/WOO/ENVIAME)
    // =========================================================================
    if (action === "approve_rma") {
      const rlId = String(body.rl_id || "").trim();
      const { data: rma } = await supabase
        .from("reverse_logistics")
        .select("*")
        .eq("id", rlId)
        .maybeSingle();

      if (!rma) {
        return new Response(JSON.stringify({ error: "Solicitud RMA no encontrada." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const caller = await authorizeCaller(req, rma.comercio);

      if (!["solicitado", "pendiente", "esperando_pago"].includes(rma.workflow_status || "pendiente")) {
        return new Response(JSON.stringify({ error: `La solicitud ya se encuentra en estado "${rma.workflow_status}".` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Permitir ediciones opcionales del seller al aprobar
      const updatedExchangeItems = Array.isArray(body.exchange_items) ? body.exchange_items : (rma.exchange_items || []);
      const updatedReturnItems = Array.isArray(body.return_items) ? body.return_items : (rma.return_items || []);
      const sellerNotes = body.seller_notes !== undefined ? String(body.seller_notes).trim() : (rma.seller_notes || "");
      const waivePayment = Boolean(body.waive_payment);
      const overrideBuyerOwes = body.buyer_owes_override !== undefined && body.buyer_owes_override !== null && body.buyer_owes_override !== ""
        ? Math.max(0, Math.round(Number(body.buyer_owes_override)))
        : null;

      const fin = { ...(rma.financial_summary || {}) };
      if (overrideBuyerOwes !== null) {
        fin.buyer_owes_amount = overrideBuyerOwes;
        fin.net_difference = overrideBuyerOwes;
      }
      if (waivePayment) {
        fin.buyer_owes_amount = 0;
        if (Number(fin.net_difference) > 0) fin.net_difference = 0;
      }

      const buyerOwes = Math.max(0, Number(fin.buyer_owes_amount) || 0);
      const isAlreadyPaid = rma.payment_status === "paid" || waivePayment || buyerOwes === 0;
      const effectivePaymentStatus = waivePayment
        ? "waived"
        : (buyerOwes > 0 && rma.payment_status !== "paid" ? (rma.payment_status === "receipt_uploaded" ? "receipt_uploaded" : "pending") : (rma.payment_status === "paid" ? "paid" : "not_required"));

      const isExchange = rma.tipo_movimiento === "CAMBIO" || rma.resolution_type === "exchange";
      const logOpt = String(body.logistics_option || rma.logistics_option || rma.modo_entrega || "sucursal_nunoa");

      // Verificar stock disponible en vivo y reservar (crear orden WMS) si aún no existe
      let replacementOrderId = rma.replacement_order_id || null;
      let wmsOrderId = rma.wms_order_id || null;

      // Resolver merchant_id del comercio
      let merchantId: string | null = null;
      if (rma.origen_order_id) {
        const { data: origOrd } = await supabase
          .from("orders")
          .select("merchant_id")
          .eq("id", rma.origen_order_id)
          .maybeSingle();
        if (origOrd?.merchant_id) merchantId = origOrd.merchant_id;
      }

      if (isExchange && !replacementOrderId) {
        // 1. Validar stock disponible antes de reservar
        for (const ex of updatedExchangeItems) {
          if (!ex.product_id) continue;
          const { data: invRows } = await supabase
            .from("inventory")
            .select("quantity, committed_quantity, reserved_quantity")
            .eq("product_id", ex.product_id);

          const avail = (invRows || []).reduce((s: number, i: any) => {
            return s + Math.max(0, (Number(i.quantity) || 0) - (Number(i.committed_quantity) || 0) - (Number(i.reserved_quantity) || 0));
          }, 0);

          if ((Number(ex.qty) || 1) > avail) {
            return new Response(JSON.stringify({
              error: `Stock insuficiente para aprobar el reemplazo "${ex.name || ex.sku}": quedan ${avail} disponibles y se requieren ${ex.qty}. Puedes editar el producto de reemplazo.`
            }), {
              status: 409,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
        }

        // 2. Determinar estado inicial y hold_reason de la orden de reemplazo
        let holdReason: string | null = null;
        let orderStatus = "para procesar";
        let categoriaEntrega = "DISTRIBUCIÓN";
        let operador = rma.inbound_courier || "STOCKA";

        if (!isAlreadyPaid) {
          holdReason = "awaiting_buyer_payment";
          orderStatus = "en espera";
        } else if (logOpt === "rm_simultaneous_swap") {
          holdReason = null;
          orderStatus = "para procesar";
          categoriaEntrega = "LOGÍSTICA INVERSA";
          operador = "STOCKA X";
        } else if (logOpt === "sucursal_nunoa" || logOpt === "sucursal") {
          holdReason = null;
          orderStatus = "para procesar";
          categoriaEntrega = "RETIRO";
          operador = "RETIRO EN SUCURSAL";
        } else {
          // Flujo en 2 etapas (Regiones, RM Pickup o Transporte Propio): reserva stock hoy, libera a picking al recepcionar retorno
          holdReason = "awaiting_return_receipt";
          orderStatus = "en espera";
          categoriaEntrega = "DISTRIBUCIÓN";
        }

        const totalOutQty = updatedExchangeItems.reduce((s: number, i: any) => s + (Number(i.qty) || 1), 0);
        const outSkus = updatedExchangeItems.map((i: any) => i.sku).join(", ");
        const outNames = updatedExchangeItems.map((i: any) => i.name).join(", ");
        const folio = rma.rma_number || `LI-${String(rma.id).slice(0, 6).toUpperCase()}`;

        const repOrderPayload = {
          merchant_id: merchantId,
          comercio: rma.comercio,
          status: orderStatus,
          estado_wms: "En procesamiento",
          hold_reason: holdReason,
          categoria_entrega: categoriaEntrega,
          sucursal_pickeo: "Sucursal Ñuñoa",
          customer_name: rma.customer_name || "Cliente",
          customer_email: rma.customer_email || null,
          customer_phone: rma.customer_phone || null,
          shipping_address: rma.shipping_address || "Punto Stocka Ñuñoa",
          shipping_city: rma.shipping_city || "Ñuñoa",
          shipping_complement: rma.shipping_complement || null,
          shipping_method: `${rma.transporte || logOpt} (${folio})`,
          operador,
          courier: operador,
          origen: "Logística Inversa",
          external_platform: "Logística Inversa",
          external_order_number: `${folio}-CAMBIO`,
          cantidad: totalOutQty,
          sku: outSkus,
          item: outNames,
          total_value: Math.max(0, Number(fin.buyer_owes_amount) || 0),
          admin_notes: logOpt === "rm_simultaneous_swap"
            ? `🔄 CAMBIO SIMULTÁNEO PUERTA A PUERTA (${folio}): Entregar reemplazo y retirar del cliente: ${updatedReturnItems.map((i: any) => `${i.qty}x ${i.sku}`).join(", ")}`
            : `🔄 Reemplazo por Cambio ${folio} (Ref original #${rma.referencia_pedido}).`,
          raw_shopify_data: {
            is_reverse_logistics: true,
            rl_id: rma.id,
            rma_number: folio,
            rl_type: "CAMBIO",
            rl_reference: rma.referencia_pedido,
            force_wms_stock_control: true,
            incoming_products: updatedReturnItems
          }
        };

        const { data: newRepOrd, error: repErr } = await supabase
          .from("orders")
          .insert([repOrderPayload])
          .select("id")
          .single();

        if (repErr) throw repErr;
        replacementOrderId = newRepOrd.id;
        if (!wmsOrderId) wmsOrderId = replacementOrderId;

        // Asegurar fila en inventory en Matriz Ñuñoa antes de insertar order_items para que el trigger comprometa stock exactamente 1 vez
        for (const ex of updatedExchangeItems) {
          if (!ex.product_id) continue;
          const { data: invRow } = await supabase
            .from("inventory")
            .select("id")
            .eq("product_id", ex.product_id)
            .eq("warehouse_id", MATRIZ_NUNOA_WH_ID)
            .maybeSingle();

          if (!invRow) {
            await supabase.from("inventory").insert([
              {
                product_id: ex.product_id,
                warehouse_id: MATRIZ_NUNOA_WH_ID,
                quantity: 0,
                committed_quantity: 0
              }
            ]);
          }
        }

        const oiRows = updatedExchangeItems
          .filter((ex: any) => ex.product_id)
          .map((ex: any) => ({
            order_id: replacementOrderId,
            product_id: ex.product_id,
            warehouse_id: MATRIZ_NUNOA_WH_ID,
            quantity: Math.max(1, Number(ex.qty) || 1),
            unit_price: Number(ex.catalog_unit_price) || 0,
            effective_unit_price: Number(ex.effective_unit_price) || 0,
            image_url: ex.image_url || null
          }));

        if (oiRows.length > 0) {
          const { error: oiErr } = await supabase.from("order_items").insert(oiRows);
          if (oiErr) throw oiErr;
        }
      } else if (!isExchange && !wmsOrderId) {
        // Crear orden de trazabilidad entrante para DEVOLUCION (sin descuento de stock)
        const folio = rma.rma_number || `LI-${String(rma.id).slice(0, 6).toUpperCase()}`;
        const totalInQty = updatedReturnItems.reduce((s: number, i: any) => s + (Number(i.qty) || 1), 0);
        const { data: inOrd, error: inErr } = await supabase
          .from("orders")
          .insert([
            {
              merchant_id: merchantId,
              comercio: rma.comercio,
              status: "para procesar",
              estado_wms: "En procesamiento",
              categoria_entrega: "LOGÍSTICA INVERSA",
              sucursal_pickeo: "Sucursal Ñuñoa",
              customer_name: rma.customer_name || "Cliente",
              customer_email: rma.customer_email || null,
              customer_phone: rma.customer_phone || null,
              shipping_address: rma.shipping_address || "Punto Stocka Ñuñoa",
              shipping_city: rma.shipping_city || "Ñuñoa",
              shipping_method: `Retorno Logística Inversa (${folio})`,
              operador: rma.inbound_courier || "STOCKA",
              courier: rma.inbound_courier || "STOCKA",
              origen: "Logística Inversa",
              external_platform: "Logística Inversa",
              external_order_number: folio,
              cantidad: totalInQty,
              sku: updatedReturnItems.map((i: any) => i.sku).join(", "),
              item: updatedReturnItems.map((i: any) => i.name).join(", "),
              total_value: 0,
              raw_shopify_data: {
                is_reverse_logistics: true,
                rl_id: rma.id,
                rma_number: folio,
                rl_type: "DEVOLUCION",
                no_stock_deduction: true,
                incoming_products: updatedReturnItems
              }
            }
          ])
          .select("id")
          .single();

        if (!inErr && inOrd) {
          wmsOrderId = inOrd.id;
        }
      }

      // Determinar workflow_status resultante
      let nextWorkflowStatus = "aprobado_esperando_retorno";
      if (!isAlreadyPaid) {
        nextWorkflowStatus = "esperando_pago";
      } else if (isExchange && logOpt === "rm_simultaneous_swap") {
        nextWorkflowStatus = "reemplazo_en_preparacion";
      }

      // Intentar emitir etiqueta de retorno vía Envíame si aplica (Regiones y pago al día)
      let inboundLabelUrl = rma.inbound_label_url || null;
      let inboundTracking = rma.inbound_tracking_number || null;
      let inboundEnviameId = rma.inbound_enviame_id || null;
      let enviameNotice: string | null = null;

      const wantEnviameLabel = body.generate_enviame_label !== false && logOpt === "regiones_courier" && isAlreadyPaid && !inboundLabelUrl;
      if (wantEnviameLabel) {
        const envRes = await tryCreateEnviameReverseLabel(rma);
        if (envRes.ok) {
          inboundTracking = envRes.tracking_number || null;
          inboundLabelUrl = envRes.label_url || null;
          inboundEnviameId = envRes.delivery_id || null;
        } else {
          enviameNotice = envRes.error || null;
        }
      }

      // Opcional: Sincronizar con Canal de Venta (Shopify / WooCommerce)
      const channelSyncOpts = body.channel_sync || {};
      let channelSyncResult = { ...(rma.channel_sync_result || {}) };

      if (rma.origen_order_id && (channelSyncOpts.sync_shopify || channelSyncOpts.sync_woocommerce)) {
        const { data: origOrder } = await supabase
          .from("orders")
          .select("id, external_platform, raw_shopify_data, raw_woocommerce_data")
          .eq("id", rma.origen_order_id)
          .maybeSingle();

        const updatedRmaTemp = {
          ...rma,
          return_items: updatedReturnItems,
          exchange_items: updatedExchangeItems,
          financial_summary: fin,
          workflow_status: nextWorkflowStatus,
          logistics_option: logOpt
        };

        if (channelSyncOpts.sync_shopify) {
          channelSyncResult.shopify = await syncRmaWithShopify(updatedRmaTemp, origOrder, channelSyncOpts);
        }
        if (channelSyncOpts.sync_woocommerce) {
          channelSyncResult.woocommerce = await syncRmaWithWooCommerce(updatedRmaTemp, origOrder, channelSyncOpts);
        }
      }

      const ttlDays = 7;
      const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

      const updateFields: Record<string, any> = {
        workflow_status: nextWorkflowStatus,
        return_items: updatedReturnItems,
        exchange_items: updatedExchangeItems,
        financial_summary: fin,
        payment_status: effectivePaymentStatus,
        logistics_option: logOpt,
        wms_order_id: wmsOrderId,
        replacement_order_id: replacementOrderId,
        inbound_label_url: inboundLabelUrl,
        inbound_tracking_number: inboundTracking,
        referencia_transporte: inboundTracking || rma.referencia_transporte,
        inbound_enviame_id: inboundEnviameId,
        channel_sync_options: channelSyncOpts,
        channel_sync_result: channelSyncResult,
        seller_notes: sellerNotes || null,
        seller_reviewed_by: caller.email,
        seller_reviewed_at: new Date().toISOString(),
        expires_at: expiresAt,
        updated_at: new Date().toISOString()
      };

      const { error: updErr } = await supabase
        .from("reverse_logistics")
        .update(updateFields)
        .eq("id", rma.id);

      if (updErr) throw updErr;

      // Notificar al comprador por correo
      if (rma.customer_email) {
        const { data: cfg } = await supabase.rpc("get_public_return_portal_config", {
          p_comercio_or_slug: rma.comercio
        });
        const brandName = cfg?.brand_name || rma.comercio || "Stocka";
        const primaryColor = cfg?.primary_color || "#5c24ff";
        const portalUrl = cfg?.slug
          ? `https://wms.stocka.cl/cambios?s=${encodeURIComponent(cfg.slug)}`
          : `https://wms.stocka.cl/cambios`;
        const folio = rma.rma_number || "RMA";

        let instructionsHtml = "";
        if (nextWorkflowStatus === "esperando_pago") {
          instructionsHtml = `
            <p>Tu solicitud <strong>${escapeHtml(folio)}</strong> ha sido <strong>pre-aprobada</strong> y ya reservamos tu producto de reemplazo en bodega.</p>
            <div style="background: #fffbeb; border: 1.5px solid #fcd34d; border-radius: 12px; padding: 16px; margin: 16px 0;">
              <div style="font-size: 16px; font-weight: 800; color: #92400e; margin-bottom: 6px;">Saldo pendiente por pagar: ${formatCLP(buyerOwes)}</div>
              ${cfg?.payment_instructions ? `<div style="font-size: 13.5px; color: #78350f; white-space: pre-line; margin-top: 8px;">${escapeHtml(cfg.payment_instructions)}</div>` : `<div style="font-size: 13.5px; color: #78350f;">Ingresa al portal para revisar los datos de pago y adjuntar tu comprobante para liberar el despacho/retiro.</div>`}
              ${cfg?.payment_link_url ? `<div style="margin-top: 12px;"><a href="${escapeHtml(cfg.payment_link_url)}" target="_blank" style="color: #b45309; font-weight: 700;">Ir al Link de Pago de la Tienda &rarr;</a></div>` : ""}
            </div>
          `;
        } else if (logOpt === "sucursal_nunoa" || logOpt === "sucursal") {
          instructionsHtml = `
            <p>¡Tu solicitud <strong>${escapeHtml(folio)}</strong> está <strong>APROBADA</strong>!</p>
            <div style="background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 12px; padding: 16px; margin: 16px 0;">
              <strong style="color: #166534; display: block; margin-bottom: 6px;">📍 Entrega presencial en Punto Stocka Ñuñoa</strong>
              <div style="font-size: 13.5px; color: #14532d;">
                <strong>Dirección:</strong> Av. Campo de Deportes 405, Ñuñoa, RM.<br>
                <strong>Horario:</strong> Lunes a Viernes 10:30 a 17:00 hrs · Sábado 10:30 a 14:00 hrs.<br>
                <strong>Tu Código de Atención:</strong> <code style="font-size: 15px; font-weight: 800;">${escapeHtml(rma.qr_branch_token || folio)}</code>
              </div>
            </div>
          `;
        } else if (logOpt === "rm_simultaneous_swap") {
          instructionsHtml = `
            <p>¡Tu cambio <strong>${escapeHtml(folio)}</strong> está <strong>APROBADO</strong> y pasó a preparación en bodega!</p>
            <div style="background: #eff6ff; border: 1.5px solid #93c5fd; border-radius: 12px; padding: 16px; margin: 16px 0; font-size: 13.5px; color: #1e3a8a;">
              <strong>🚚 Cambio Simultáneo a Domicilio (Flota Stocka X):</strong><br>
              Nuestro móvil irá a <strong>${escapeHtml(rma.shipping_address || "")}, ${escapeHtml(rma.shipping_city || "")}</strong> para entregarte tu nuevo producto y retirar en el mismo momento el producto devuelto (tenlo embalado y rotulado con el código <strong>${escapeHtml(folio)}</strong>).
            </div>
          `;
        } else if (inboundLabelUrl) {
          instructionsHtml = `
            <p>¡Tu solicitud <strong>${escapeHtml(folio)}</strong> está <strong>APROBADA</strong>!</p>
            <div style="background: #eff6ff; border: 1.5px solid #93c5fd; border-radius: 12px; padding: 16px; margin: 16px 0; font-size: 13.5px; color: #1e3a8a;">
              <strong>📦 Etiqueta de Retorno Lista (${escapeHtml(rma.inbound_courier || "Courier")} · Guía ${escapeHtml(inboundTracking || "")}):</strong><br>
              Descarga e imprime tu etiqueta o preséntala en un punto habilitado:<br>
              <a href="${escapeHtml(inboundLabelUrl)}" target="_blank" style="display: inline-block; margin-top: 10px; font-weight: 800; color: #1d4ed8;">Descargar Etiqueta PDF de Devolución &rarr;</a>
            </div>
          `;
        } else {
          instructionsHtml = `
            <p>¡Tu solicitud <strong>${escapeHtml(folio)}</strong> está <strong>APROBADA</strong>!</p>
            <div style="background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 12px; padding: 16px; margin: 16px 0; font-size: 13.5px; color: #334155;">
              <strong>📦 Instrucciones de Envío hacia Bodega Stocka:</strong><br>
              Envía tu paquete (pagado en origen) a <strong>Av. Campo de Deportes 405, Ñuñoa, RM</strong> a nombre de <strong>Stocka Recepción Inversa · ${escapeHtml(brandName)} (${escapeHtml(folio)})</strong>, e ingresa el número de seguimiento en el portal para monitorear su llegada.
            </div>
          `;
        }

        if (sellerNotes) {
          instructionsHtml += `<p style="font-size: 13.5px; color: #475569;"><strong>Nota de la tienda:</strong> ${escapeHtml(sellerNotes)}</p>`;
        }

        const couponCode = channelSyncResult?.shopify?.store_credit_code || channelSyncResult?.woocommerce?.store_credit_code;
        if (couponCode) {
          instructionsHtml += `
            <div style="background: #ecfdf5; border: 1.5px solid #6ee7b7; border-radius: 12px; padding: 14px; margin-top: 14px; text-align: center;">
              <div style="font-size: 12.5px; color: #065f46; font-weight: 700;">TU CUPÓN DE CRÉDITO EN TIENDA</div>
              <div style="font-family: monospace; font-size: 22px; font-weight: 900; color: #047857; margin: 4px 0;">${escapeHtml(couponCode)}</div>
            </div>
          `;
        }

        await sendBrevoEmail({
          to: [{ email: rma.customer_email, name: rma.customer_name || "Cliente" }],
          subject: nextWorkflowStatus === "esperando_pago"
            ? `[${folio}] Solicitud pre-aprobada · Pendiente de pago - ${brandName}`
            : `[${folio}] ¡Solicitud Aprobada! Instrucciones de ${rma.tipo_movimiento === "CAMBIO" ? "Cambio" : "Devolución"} - ${brandName}`,
          htmlContent: buildBuyerStatusEmailHtml({
            brandName,
            primaryColor,
            logoUrl: cfg?.logo_url,
            title: nextWorkflowStatus === "esperando_pago" ? "Solicitud Pre-Aprobada" : "¡Solicitud Aprobada!",
            badgeText: folio,
            rmaNumber: folio,
            orderNumber: rma.referencia_pedido || "-",
            portalUrl,
            bodyHtml: instructionsHtml
          }),
          senderName: `${brandName} - Postventa`
        });
      }

      return new Response(JSON.stringify({
        success: true,
        workflow_status: nextWorkflowStatus,
        replacement_order_id: replacementOrderId,
        wms_order_id: wmsOrderId,
        inbound_label_url: inboundLabelUrl,
        inbound_tracking_number: inboundTracking,
        enviame_notice: enviameNotice,
        channel_sync_result: channelSyncResult
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // =========================================================================
    // 4. MARCAR COMO PAGADO POR EL SELLER EN STOCKA WMS
    // =========================================================================
    if (action === "mark_rma_paid") {
      const rlId = String(body.rl_id || "").trim();
      const paymentNotes = String(body.payment_notes || "").trim();

      const { data: rma } = await supabase
        .from("reverse_logistics")
        .select("*")
        .eq("id", rlId)
        .maybeSingle();

      if (!rma) {
        return new Response(JSON.stringify({ error: "Solicitud no encontrada." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const caller = await authorizeCaller(req, rma.comercio);
      const logOpt = String(rma.logistics_option || rma.modo_entrega || "sucursal_nunoa");
      const isExchange = rma.tipo_movimiento === "CAMBIO" || rma.resolution_type === "exchange";

      const nextWf = (isExchange && logOpt === "rm_simultaneous_swap")
        ? "reemplazo_en_preparacion"
        : (rma.workflow_status === "esperando_pago" ? "aprobado_esperando_retorno" : rma.workflow_status);

      // Actualizar hold_reason en la orden de reemplazo si existía
      if (rma.replacement_order_id) {
        const shouldReleaseImmediately = logOpt === "rm_simultaneous_swap" || logOpt === "sucursal_nunoa" || logOpt === "sucursal";
        await supabase
          .from("orders")
          .update({
            hold_reason: shouldReleaseImmediately ? null : "awaiting_return_receipt",
            status: shouldReleaseImmediately ? "para procesar" : "en espera"
          })
          .eq("id", rma.replacement_order_id)
          .eq("hold_reason", "awaiting_buyer_payment");
      }

      // Si es regiones_courier y aún no tenía etiqueta Envíame porque estaba esperando pago, emitirla ahora
      let inboundLabelUrl = rma.inbound_label_url || null;
      let inboundTracking = rma.inbound_tracking_number || null;
      let inboundEnviameId = rma.inbound_enviame_id || null;

      if (logOpt === "regiones_courier" && !inboundLabelUrl) {
        const envRes = await tryCreateEnviameReverseLabel(rma);
        if (envRes.ok) {
          inboundLabelUrl = envRes.label_url || null;
          inboundTracking = envRes.tracking_number || null;
          inboundEnviameId = envRes.delivery_id || null;
        }
      }

      await supabase
        .from("reverse_logistics")
        .update({
          payment_status: "paid",
          payment_confirmed_by: caller.email,
          payment_confirmed_at: new Date().toISOString(),
          payment_notes: paymentNotes || rma.payment_notes || "Confirmado por comercio en Stocka WMS",
          workflow_status: nextWf,
          inbound_label_url: inboundLabelUrl,
          inbound_tracking_number: inboundTracking,
          inbound_enviame_id: inboundEnviameId,
          referencia_transporte: inboundTracking || rma.referencia_transporte,
          updated_at: new Date().toISOString()
        })
        .eq("id", rma.id);

      if (rma.customer_email) {
        const { data: cfg } = await supabase.rpc("get_public_return_portal_config", {
          p_comercio_or_slug: rma.comercio
        });
        const brandName = cfg?.brand_name || rma.comercio || "Stocka";
        const portalUrl = cfg?.slug
          ? `https://wms.stocka.cl/cambios?s=${encodeURIComponent(cfg.slug)}`
          : `https://wms.stocka.cl/cambios`;
        const folio = rma.rma_number || "RMA";

        await sendBrevoEmail({
          to: [{ email: rma.customer_email, name: rma.customer_name || "Cliente" }],
          subject: `[${folio}] Pago confirmado · Instrucciones activas - ${brandName}`,
          senderName: `${brandName} - Postventa`,
          htmlContent: buildBuyerStatusEmailHtml({
            brandName,
            primaryColor: cfg?.primary_color || "#5c24ff",
            logoUrl: cfg?.logo_url,
            title: "¡Pago Confirmado!",
            badgeText: folio,
            rmaNumber: folio,
            orderNumber: rma.referencia_pedido || "-",
            portalUrl,
            bodyHtml: `
              <p>Hola <strong>${escapeHtml(rma.customer_name || "Cliente")}</strong>,</p>
              <p>Confirmamos la recepción de tu pago para la solicitud <strong>${escapeHtml(folio)}</strong>. Ya puedes revisar tus instrucciones activas, código QR de sucursal o etiqueta de envío directamente en el portal.</p>
              ${inboundLabelUrl ? `<p><a href="${escapeHtml(inboundLabelUrl)}" target="_blank" style="font-weight: 800;">Descargar Etiqueta PDF de Envío &rarr;</a></p>` : ""}
            `
          })
        });
      }

      return new Response(JSON.stringify({
        success: true,
        workflow_status: nextWf,
        inbound_label_url: inboundLabelUrl,
        inbound_tracking_number: inboundTracking
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // =========================================================================
    // 5. RECHAZAR SOLICITUD RMA (LIBERA RESERVAS SI EXISTÍAN)
    // =========================================================================
    if (action === "reject_rma") {
      const rlId = String(body.rl_id || "").trim();
      const rejectionReason = String(body.rejection_reason || "").trim();

      if (!rejectionReason) {
        return new Response(JSON.stringify({ error: "Debes indicar el motivo del rechazo para informar al cliente." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { data: rma } = await supabase
        .from("reverse_logistics")
        .select("*")
        .eq("id", rlId)
        .maybeSingle();

      if (!rma) {
        return new Response(JSON.stringify({ error: "Solicitud no encontrada." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const caller = await authorizeCaller(req, rma.comercio);

      // Si existía orden de reemplazo, cancelarla para liberar committed_quantity automáticamente
      if (rma.replacement_order_id) {
        await supabase
          .from("orders")
          .update({
            estado_wms: "Cancelado",
            status: "cancelado",
            hold_reason: null
          })
          .eq("id", rma.replacement_order_id)
          .neq("estado_wms", "Despachado")
          .neq("estado_wms", "Entregado");
      }

      await supabase
        .from("reverse_logistics")
        .update({
          workflow_status: "rechazado",
          status: "rechazado",
          rejection_reason: rejectionReason,
          seller_reviewed_by: caller.email,
          seller_reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", rma.id);

      if (rma.customer_email) {
        const { data: cfg } = await supabase.rpc("get_public_return_portal_config", {
          p_comercio_or_slug: rma.comercio
        });
        const brandName = cfg?.brand_name || rma.comercio || "Stocka";
        const portalUrl = cfg?.slug
          ? `https://wms.stocka.cl/cambios?s=${encodeURIComponent(cfg.slug)}`
          : `https://wms.stocka.cl/cambios`;
        const folio = rma.rma_number || "RMA";

        await sendBrevoEmail({
          to: [{ email: rma.customer_email, name: rma.customer_name || "Cliente" }],
          subject: `[${folio}] Actualización sobre tu solicitud - ${brandName}`,
          senderName: `${brandName} - Postventa`,
          htmlContent: buildBuyerStatusEmailHtml({
            brandName,
            primaryColor: cfg?.primary_color || "#5c24ff",
            logoUrl: cfg?.logo_url,
            title: "Actualización de tu Solicitud",
            badgeText: "Revisión Finalizada",
            rmaNumber: folio,
            orderNumber: rma.referencia_pedido || "-",
            portalUrl,
            bodyHtml: `
              <p>Hola <strong>${escapeHtml(rma.customer_name || "Cliente")}</strong>,</p>
              <p>Te informamos que tu solicitud <strong>${escapeHtml(folio)}</strong> no pudo ser aprobada por el siguiente motivo informado por la tienda:</p>
              <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 14px; margin: 14px 0; color: #991b1b;">
                ${escapeHtml(rejectionReason)}
              </div>
              <p style="font-size: 13px; color: #64748b;">Si tienes consultas adicionales, puedes comunicarte directamente con los canales de atención de ${escapeHtml(brandName)}.</p>
            `
          })
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // =========================================================================
    // 6. COMPLETAR RECEPCIÓN E INSPECCIÓN FÍSICA QC EN BODEGA / MESÓN ÑUÑOA
    //    (Dispara trigger SQL de +Stock o Merma + libera orden de reemplazo a Picking)
    // =========================================================================
    if (action === "complete_qc_inspection") {
      const rlId = String(body.rl_id || "").trim();
      const itemsQc: any[] = Array.isArray(body.items_qc) ? body.items_qc : [];
      const qcNotes = String(body.qc_notes || "").trim();
      const executeWooRefund = Boolean(body.execute_woo_refund);

      const { data: rma } = await supabase
        .from("reverse_logistics")
        .select("*")
        .eq("id", rlId)
        .maybeSingle();

      if (!rma) {
        return new Response(JSON.stringify({ error: "Solicitud no encontrada." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const caller = await authorizeCaller(req, rma.comercio);

      // Aplicar disposición QC por unidad (+Stock vs Merma)
      const currentReturnItems = Array.isArray(rma.return_items) && rma.return_items.length > 0
        ? [...rma.return_items]
        : [];

      const updatedReturnItems = currentReturnItems.map((it: any, idx: number) => {
        const matchQc = itemsQc[idx] || itemsQc.find((q: any) => q.sku === it.sku || (q.product_id && q.product_id === it.product_id));
        const returnToStock = matchQc !== undefined ? Boolean(matchQc.return_to_stock) : Boolean(it.return_to_stock);
        return {
          ...it,
          return_to_stock: returnToStock,
          qc_disposition: returnToStock ? "restock" : "quarantine",
          qc_comment: matchQc?.qc_comment || it.qc_comment || ""
        };
      });

      const currentLegacy = Array.isArray(rma.productos) ? [...rma.productos] : [];
      const updatedLegacy = currentLegacy.map((p: any, idx: number) => {
        const matchQc = itemsQc[idx];
        const returnToStock = matchQc !== undefined ? Boolean(matchQc.return_to_stock) : Boolean(p.regresar_a_inventario);
        return {
          ...p,
          regresar_a_inventario: returnToStock
        };
      });

      const isExchange = rma.tipo_movimiento === "CAMBIO" || rma.resolution_type === "exchange";
      const logOpt = String(rma.logistics_option || rma.modo_entrega || "");
      const isCounterImmediateComplete = logOpt === "sucursal_nunoa" || logOpt === "sucursal" || Boolean(body.mark_counter_delivered);

      const nextWf = (!isExchange || isCounterImmediateComplete)
        ? "completado"
        : "reemplazo_en_preparacion";

      let channelSyncResult = { ...(rma.channel_sync_result || {}) };
      if (executeWooRefund && rma.origen_order_id) {
        const { data: origOrder } = await supabase
          .from("orders")
          .select("id, raw_woocommerce_data")
          .eq("id", rma.origen_order_id)
          .maybeSingle();
        if (origOrder?.raw_woocommerce_data?.id) {
          channelSyncResult.woocommerce_qc = await syncRmaWithWooCommerce(rma, origOrder, {
            add_notes: true,
            execute_refund: true
          });
        }
      }

      // Al pasar status = 'procesado', el trigger SQL handle_reverse_logistics_to_entregado_func:
      // 1. Suma a inventory.quantity (+ movements 'in') los ítems con return_to_stock = true
      // 2. Suma a inventory.quarantine_quantity los ítems marcados como Merma (return_to_stock = false)
      // 3. Libera hold_reason = 'awaiting_return_receipt' en replacement_order_id para que pase a Picking
      const { error: qcErr } = await supabase
        .from("reverse_logistics")
        .update({
          status: "procesado",
          workflow_status: nextWf,
          return_items: updatedReturnItems.length > 0 ? updatedReturnItems : rma.return_items,
          productos: updatedLegacy.length > 0 ? updatedLegacy : rma.productos,
          qc_inspected_by: caller.email,
          qc_inspected_at: new Date().toISOString(),
          qc_notes: qcNotes || null,
          channel_sync_result: channelSyncResult,
          updated_at: new Date().toISOString()
        })
        .eq("id", rma.id);

      if (qcErr) throw qcErr;

      return new Response(JSON.stringify({
        success: true,
        workflow_status: nextWf
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ error: "Acción no soportada." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err: any) {
    const status = err?.status || 500;
    const msg = err?.message || "Error interno en sincronización de logística inversa.";
    if (status >= 500) console.error("[reverse-channel-sync] Error:", err);
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
