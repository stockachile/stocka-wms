import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

// Normaliza y valida RUT chileno al formato sin puntos y con guión (ej: "76684648-3" o "77737611-K")
function normalizeAndValidateRut(raw: string): { valid: boolean; formatted: string; clean: string } {
  const cleaned = String(raw || "")
    .replace(/[^0-9kK]/g, "")
    .toUpperCase()
    .trim();

  if (cleaned.length < 7 || cleaned.length > 10) {
    return { valid: false, formatted: "", clean: cleaned };
  }

  const body = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);
  if (!/^\d+$/.test(body)) {
    return { valid: false, formatted: "", clean: cleaned };
  }

  let sum = 0;
  let mul = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i], 10) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const mod = 11 - (sum % 11);
  const expectedDv = mod === 11 ? "0" : mod === 10 ? "K" : String(mod);

  return {
    valid: dv === expectedDv,
    formatted: `${body}-${dv}`,
    clean: cleaned,
  };
}

function decodeBase64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getChileTodayIso(): string {
  try {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Santiago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function extractLiorenErrorMessage(data: any, fallbackStatus: number): string {
  if (!data) return `Error HTTP ${fallbackStatus} desde Lioren API`;
  if (Array.isArray(data.errors) && data.errors.length > 0) {
    return data.errors
      .map((e: any) => (typeof e === "string" ? e : e?.message || JSON.stringify(e)))
      .join(" | ");
  }
  if (data.errors && typeof data.errors === "object") {
    const msgs: string[] = [];
    for (const [field, val] of Object.entries(data.errors)) {
      if (Array.isArray(val)) msgs.push(`${field}: ${val.join(", ")}`);
      else if (val) msgs.push(`${field}: ${String(val)}`);
    }
    if (msgs.length > 0) return msgs.join(" | ");
  }
  if (typeof data.message === "string" && data.message.trim()) {
    return data.message.trim();
  }
  if (typeof data.error === "string" && data.error.trim()) {
    return data.error.trim();
  }
  return `Error HTTP ${fallbackStatus} al comunicarse con Lioren API`;
}

async function liorenFetch(
  baseUrl: string,
  token: string,
  path: string,
  options: { method?: string; body?: unknown; idempotencyKey?: string } = {}
) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.idempotencyKey) {
    headers["X-Idempotency-Check"] = options.idempotencyKey;
  }

  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { message: text };
  }

  return { status: res.status, ok: res.ok, data: json };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();
    const supabaseServiceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
    const liorenToken = (Deno.env.get("LIOREN_API_TOKEN") ?? "").trim();
    const liorenBaseUrl = (Deno.env.get("LIOREN_API_BASE_URL") ?? "https://cl.lioren.enterprises/api").trim();

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ ok: false, error: "Falta cabecera Authorization." }, 401);
    }

    if (!liorenToken) {
      return jsonResponse(
        {
          ok: false,
          error: "El secreto LIOREN_API_TOKEN no está configurado en Supabase Secrets.",
        },
        500
      );
    }

    const callerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // Verificar permisos de administrador / colaborador autorizado
    let isAuthorized = false;
    let callerUserId: string | null = null;

    if (supabaseServiceKey && callerToken === supabaseServiceKey) {
      isAuthorized = true;
    } else {
      const {
        data: { user: verifiedUser },
        error: authErr,
      } = await supabaseClient.auth.getUser(callerToken);

      if (!authErr && verifiedUser) {
        callerUserId = verifiedUser.id;
        const { data: profile } = await supabaseClient
          .from("profiles")
          .select("role, is_colaborador, allowed_modules")
          .eq("id", verifiedUser.id)
          .maybeSingle();

        if (
          profile &&
          (profile.role === "admin" ||
            profile.role === "all" ||
            profile.is_colaborador === true ||
            profile.allowed_modules === "all")
        ) {
          isAuthorized = true;
        }
      }
    }

    if (!isAuthorized) {
      return jsonResponse(
        { ok: false, error: "No autorizado. Se requiere rol de administrador para operar con Lioren API." },
        403
      );
    }

    const body = req.method === "GET" ? { action: "status" } : await req.json().catch(() => ({}));
    const action = String(body.action || "status").trim();

    // =========================================================================
    // ACCIÓN 1: STATUS (Validar Token, Empresa, Actividades SII y Folios)
    // =========================================================================
    if (action === "status") {
      const [whoamiRes, empRes, tipodocsRes] = await Promise.all([
        liorenFetch(liorenBaseUrl, liorenToken, "whoami"),
        liorenFetch(liorenBaseUrl, liorenToken, "miempresa"),
        liorenFetch(liorenBaseUrl, liorenToken, "tipodocs"),
      ]);

      if (!whoamiRes.ok || !empRes.ok) {
        return jsonResponse(
          {
            ok: false,
            error: extractLiorenErrorMessage(
              !whoamiRes.ok ? whoamiRes.data : empRes.data,
              !whoamiRes.ok ? whoamiRes.status : empRes.status
            ),
          },
          400
        );
      }

      const rsUpper = String(empRes.data?.rs || "").toUpperCase();
      const isSandbox = rsUpper.includes("PRUEBAS API") || Deno.env.get("LIOREN_ENV") === "sandbox";

      const tipodocsArr = Array.isArray(tipodocsRes.data?.tipodocs) ? tipodocsRes.data.tipodocs : [];
      const relevantCodes = ["33", "34", "61", "56", "52"];
      const folios: Record<string, { nombre: string; disponibles: number; siguiente: number }> = {};
      for (const td of tipodocsArr) {
        const code = String(td.codigosii || "");
        if (relevantCodes.includes(code) && td.folios) {
          folios[code] = {
            nombre: td.nombre || code,
            disponibles: Number(td.folios.disponibles || 0),
            siguiente: Number(td.folios.siguiente || 0),
          };
        }
      }

      return jsonResponse({
        ok: true,
        isSandbox,
        environment: isSandbox ? "sandbox" : "production",
        whoami: whoamiRes.data,
        miempresa: empRes.data,
        actividades: Array.isArray(empRes.data?.actividades) ? empRes.data.actividades : [],
        folios,
      });
    }

    // =========================================================================
    // ACCIÓN 2: LOCALIDADES (Regiones, Comunas y Ciudades oficiales de Lioren)
    // =========================================================================
    if (action === "localidades") {
      const [regRes, comRes, ciuRes] = await Promise.all([
        liorenFetch(liorenBaseUrl, liorenToken, "regiones"),
        liorenFetch(liorenBaseUrl, liorenToken, "comunas"),
        liorenFetch(liorenBaseUrl, liorenToken, "ciudades"),
      ]);

      if (!comRes.ok || !ciuRes.ok) {
        return jsonResponse(
          {
            ok: false,
            error: extractLiorenErrorMessage(
              !comRes.ok ? comRes.data : ciuRes.data,
              !comRes.ok ? comRes.status : ciuRes.status
            ),
          },
          400
        );
      }

      const regiones = Array.isArray(regRes.data) ? regRes.data : regRes.data?.regiones || [];
      const comunas = Array.isArray(comRes.data) ? comRes.data : comRes.data?.comunas || comRes.data?.regiones || [];
      const ciudades = Array.isArray(ciuRes.data) ? ciuRes.data : ciuRes.data?.ciudades || [];

      return jsonResponse({
        ok: true,
        regiones,
        comunas,
        ciudades,
      });
    }

    // =========================================================================
    // ACCIÓN 2B: LOOKUP_COMPRADOR (Buscar cliente en Círculo de Compradores Lioren, 0 UF)
    // =========================================================================
    if (action === "lookup_comprador") {
      const rawRut = String(body.rut || "").trim();
      const rutCheck = normalizeAndValidateRut(rawRut);
      if (!rutCheck.valid) {
        return jsonResponse({ ok: false, error: "RUT inválido para búsqueda en Lioren." }, 400);
      }

      const rutBody = rutCheck.clean.slice(0, -1);
      // Lioren almacena rut sin guión en /api/compradores (ej: "772056354")
      let searchRes = await liorenFetch(
        liorenBaseUrl,
        liorenToken,
        `compradores?rut=${encodeURIComponent(rutCheck.clean)}&rpp=20`
      );
      let items: any[] = Array.isArray(searchRes.data?.data) ? searchRes.data.data : [];

      if (items.length === 0 && rutBody.length >= 6) {
        searchRes = await liorenFetch(
          liorenBaseUrl,
          liorenToken,
          `compradores?rut=${encodeURIComponent(rutBody)}&rpp=20`
        );
        items = Array.isArray(searchRes.data?.data) ? searchRes.data.data : [];
      }

      const matched = items.find((it) => {
        const itClean = String(it?.rut || "")
          .replace(/[^0-9kK]/g, "")
          .toUpperCase();
        return itClean === rutCheck.clean;
      });

      if (!matched?.id) {
        return jsonResponse({ ok: true, found: false, comprador: null });
      }

      const detailRes = await liorenFetch(liorenBaseUrl, liorenToken, `compradores/${matched.id}`);
      if (!detailRes.ok || !detailRes.data?.id) {
        return jsonResponse({ ok: true, found: false, comprador: null });
      }

      const c = detailRes.data;
      return jsonResponse({
        ok: true,
        found: true,
        comprador: {
          id: c.id,
          rut: rutCheck.formatted,
          rs: c.rs || matched.rs || "",
          giro: c.giro ? String(c.giro).trim().slice(0, 40) : "",
          direccion: c.direccion ? String(c.direccion).trim().slice(0, 70) : "",
          region_id: c.region_id ? Number(c.region_id) : null,
          comuna_id: c.comuna_id ? Number(c.comuna_id) : null,
          ciudad_id: c.ciudad_id ? Number(c.ciudad_id) : null,
          email: c.email ? String(c.email).trim() : "",
          telefono: c.telefono ? String(c.telefono).trim() : "",
        },
      });
    }

    // =========================================================================
    // ACCIÓN 2C: SYNC_COMPRADORES (Importar masivamente Círculo de Compradores Lioren -> WMS, 0 UF)
    // =========================================================================
    if (action === "sync_compradores") {
      const allCompradores: any[] = [];
      let page = 1;
      let lastPage = 1;

      while (page <= lastPage && page <= 10) {
        const listRes = await liorenFetch(liorenBaseUrl, liorenToken, `compradores?rpp=100&page=${page}`);
        if (!listRes.ok) {
          return jsonResponse(
            { ok: false, error: extractLiorenErrorMessage(listRes.data, listRes.status) },
            400
          );
        }
        const rows = Array.isArray(listRes.data?.data) ? listRes.data.data : [];
        allCompradores.push(...rows);
        lastPage = Number(listRes.data?.last_page || 1);
        page++;
      }

      if (allCompradores.length === 0) {
        return jsonResponse({
          ok: true,
          totalInLioren: 0,
          matchedCount: 0,
          updatedComercios: [],
        });
      }

      // Cargar catálogos de comunas/ciudades para guardar también el nombre legible
      const [comRes, ciuRes, cfgRes] = await Promise.all([
        liorenFetch(liorenBaseUrl, liorenToken, "comunas"),
        liorenFetch(liorenBaseUrl, liorenToken, "ciudades"),
        supabaseClient.from("comercios_adicional_config").select("*"),
      ]);

      const comunasMap = new Map<number, string>();
      for (const cm of Array.isArray(comRes.data) ? comRes.data : []) {
        if (cm?.id && cm?.nombre) comunasMap.set(Number(cm.id), String(cm.nombre));
      }
      const ciudadesMap = new Map<number, string>();
      for (const ci of Array.isArray(ciuRes.data) ? ciuRes.data : []) {
        if (ci?.id && ci?.nombre) ciudadesMap.set(Number(ci.id), String(ci.nombre));
      }

      const normRs = (s: string) =>
        String(s || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toUpperCase()
          .replace(/\s+/g, " ")
          .trim();

      const compradorByCleanRut = new Map<string, any>();
      const compradorByNormRs = new Map<string, any>();
      for (const comp of allCompradores) {
        const clean = String(comp?.rut || "")
          .replace(/[^0-9kK]/g, "")
          .toUpperCase();
        if (clean && !compradorByCleanRut.has(clean)) {
          compradorByCleanRut.set(clean, comp);
        }
        const nRs = normRs(comp?.rs || "");
        if (nRs && !compradorByNormRs.has(nRs)) {
          compradorByNormRs.set(nRs, comp);
        }
      }

      const configs = Array.isArray(cfgRes.data) ? cfgRes.data : [];
      const detailCache = new Map<number, any>();
      const updatedComercios: string[] = [];

      for (const cfg of configs) {
        const cfgCleanRut = String(cfg?.rut || "")
          .replace(/[^0-9kK]/g, "")
          .toUpperCase();
        const cfgNormRs = normRs(cfg?.razon_social || cfg?.comercio || "");

        const matchComp =
          (cfgCleanRut ? compradorByCleanRut.get(cfgCleanRut) : null) ||
          (cfgNormRs ? compradorByNormRs.get(cfgNormRs) : null);
        if (!matchComp?.id) continue;

        let detail = detailCache.get(Number(matchComp.id));
        if (!detail) {
          const dRes = await liorenFetch(liorenBaseUrl, liorenToken, `compradores/${matchComp.id}`);
          if (dRes.ok && dRes.data?.id) {
            detail = dRes.data;
            detailCache.set(Number(matchComp.id), detail);
          }
        }
        if (!detail) continue;

        const rutFmt = normalizeAndValidateRut(detail.rut || cfg.rut || "").formatted || cfg.rut;
        const comunaId = detail.comuna_id ? Number(detail.comuna_id) : null;
        const ciudadId = detail.ciudad_id ? Number(detail.ciudad_id) : null;

        const updPayload: Record<string, unknown> = {
          comercio: cfg.comercio,
          razon_social: cfg.razon_social || detail.rs || null,
          rut: cfg.rut || rutFmt,
          giro_facturacion: cfg.giro_facturacion || (detail.giro ? String(detail.giro).trim().slice(0, 40) : null),
          direccion_facturacion:
            cfg.direccion_facturacion || (detail.direccion ? String(detail.direccion).trim().slice(0, 70) : null),
          comuna_facturacion: cfg.comuna_facturacion || (comunaId ? comunasMap.get(comunaId) || null : null),
          ciudad_facturacion: cfg.ciudad_facturacion || (ciudadId ? ciudadesMap.get(ciudadId) || null : null),
          lioren_comuna_id: cfg.lioren_comuna_id || comunaId,
          lioren_ciudad_id: cfg.lioren_ciudad_id || ciudadId,
          email_facturacion: cfg.email_facturacion || (detail.email ? String(detail.email).trim() : null),
          updated_at: new Date().toISOString(),
        };

        const { error: upErr } = await supabaseClient
          .from("comercios_adicional_config")
          .upsert(updPayload, { onConflict: "comercio" });

        if (!upErr) {
          updatedComercios.push(cfg.comercio);
        }
      }

      return jsonResponse({
        ok: true,
        totalInLioren: allCompradores.length,
        matchedCount: updatedComercios.length,
        updatedComercios,
      });
    }

    // =========================================================================
    // ACCIÓN 3: EMIT_DTE (Emisión de Factura Electrónica 33 / 34 con 1 sola glosa)
    // =========================================================================
    if (action === "emit_dte") {
      const recordId = String(body.recordId || "").trim();
      const serviceType = body.serviceType === "enviame" ? "enviame" : "fulfillment";
      const tipodoc = String(body.tipodoc || "33").trim();
      if (!["33", "34"].includes(tipodoc)) {
        return jsonResponse({ ok: false, error: `Tipo de DTE no soportado para emisión directa: ${tipodoc}` }, 400);
      }

      // Validar datos del receptor
      const receptorIn = body.receptor || {};
      const rutCheck = normalizeAndValidateRut(receptorIn.rut || "");
      if (!rutCheck.valid) {
        return jsonResponse(
          { ok: false, error: `El RUT del receptor (${receptorIn.rut || "vacío"}) no es un RUT chileno válido.` },
          400
        );
      }

      const rs = String(receptorIn.rs || "").trim().slice(0, 100);
      if (rs.length < 5) {
        return jsonResponse(
          { ok: false, error: "La Razón Social del receptor es obligatoria (mínimo 5 caracteres)." },
          400
        );
      }

      const giro = String(receptorIn.giro || "").trim().slice(0, 40);
      if (giro.length < 5) {
        return jsonResponse(
          { ok: false, error: "El Giro tributario del receptor es obligatorio (entre 5 y 40 caracteres)." },
          400
        );
      }

      const direccion = String(receptorIn.direccion || "").trim().slice(0, 70);
      if (direccion.length < 5) {
        return jsonResponse(
          { ok: false, error: "La Dirección tributaria del receptor es obligatoria (entre 5 y 70 caracteres)." },
          400
        );
      }

      const comunaId = parseInt(String(receptorIn.comuna || ""), 10);
      const ciudadId = parseInt(String(receptorIn.ciudad || ""), 10);
      if (!Number.isInteger(comunaId) || comunaId <= 0) {
        return jsonResponse({ ok: false, error: "Debes seleccionar una Comuna válida del catálogo SII/Lioren." }, 400);
      }
      if (!Number.isInteger(ciudadId) || ciudadId <= 0) {
        return jsonResponse({ ok: false, error: "Debes seleccionar una Ciudad válida del catálogo SII/Lioren." }, 400);
      }

      const emailReceptor = String(receptorIn.email || "").trim().slice(0, 80);
      const fechaEmision = /^\d{4}-\d{2}-\d{2}$/.test(String(body.fecha || ""))
        ? String(body.fecha)
        : getChileTodayIso();
      const vencimiento = /^\d{4}-\d{2}-\d{2}$/.test(String(body.vencimiento || ""))
        ? String(body.vencimiento)
        : undefined;

      // Validar detalle de 1 sola glosa
      const glosa = String(body.glosa || "").trim().slice(0, 80);
      if (glosa.length < 3) {
        return jsonResponse({ ok: false, error: "La glosa de la factura es obligatoria (mínimo 3 caracteres)." }, 400);
      }
      const descripcion = String(body.descripcion || "").trim().slice(0, 1000);
      const observaciones = String(body.observaciones || "").trim().slice(0, 250);
      const montoNeto = Math.round(Number(body.montoNeto || 0));
      if (!Number.isFinite(montoNeto) || montoNeto <= 0) {
        return jsonResponse({ ok: false, error: "El monto neto a facturar debe ser mayor a $0." }, 400);
      }

      // Construir objeto emisor para Lioren
      const emisorPayload: Record<string, unknown> = {
        tipodoc,
        fecha: fechaEmision,
      };
      if (vencimiento) emisorPayload.vencimiento = vencimiento;
      if (observaciones) emisorPayload.observaciones = observaciones;
      if (body.actividad) {
        const actNum = parseInt(String(body.actividad), 10);
        if (Number.isInteger(actNum) && actNum > 0) {
          emisorPayload.actividad = actNum;
        }
      }

      // Construir objeto receptor para Lioren
      const receptorPayload: Record<string, unknown> = {
        rut: rutCheck.formatted,
        rs,
        giro,
        comuna: comunaId,
        ciudad: ciudadId,
        direccion,
      };
      if (emailReceptor && emailReceptor.length >= 5 && emailReceptor.includes("@")) {
        receptorPayload.email = emailReceptor;
      }

      const codigoItem = String(
        body.codigo || (serviceType === "fulfillment" ? "SERV-FULF" : "SERV-ENVIAME")
      )
        .trim()
        .slice(0, 128);

      const detalleItem: Record<string, unknown> = {
        codigo: codigoItem,
        nombre: glosa,
        cantidad: 1,
        unidad: "UN",
        precio: montoNeto,
        exento: tipodoc === "34",
      };
      if (descripcion) {
        detalleItem.descripcion = descripcion;
      }

      const dteRequestPayload = {
        emisor: emisorPayload,
        receptor: receptorPayload,
        detalles: [detalleItem],
        expects: "all",
      };

      // Idempotencia (entre 36 y 64 caracteres)
      let idemKey = String(body.idempotencyKey || "").trim();
      if (idemKey.length < 36 || idemKey.length > 64) {
        idemKey = crypto.randomUUID();
      }

      // Verificar entorno (sandbox vs producción) en paralelo con emisión o lectura rápida
      const [empCheck, emitRes] = await Promise.all([
        liorenFetch(liorenBaseUrl, liorenToken, "miempresa"),
        liorenFetch(liorenBaseUrl, liorenToken, "dtes", {
          method: "POST",
          body: dteRequestPayload,
          idempotencyKey: idemKey,
        }),
      ]);

      const isSandbox =
        String(empCheck.data?.rs || "")
          .toUpperCase()
          .includes("PRUEBAS API") || Deno.env.get("LIOREN_ENV") === "sandbox";

      let dteData = emitRes.data;
      // Manejo idempotente: si Lioren retorna 409 con original_response cacheado, recuperarlo
      if (emitRes.status === 409 && emitRes.data?.original_response) {
        const origStatus = Number(emitRes.data.original_status || 200);
        if (origStatus >= 200 && origStatus < 300) {
          dteData =
            typeof emitRes.data.original_response === "string"
              ? JSON.parse(emitRes.data.original_response)
              : emitRes.data.original_response;
        } else {
          return jsonResponse(
            { ok: false, error: extractLiorenErrorMessage(emitRes.data.original_response, origStatus) },
            400
          );
        }
      } else if (!emitRes.ok || (Array.isArray(dteData?.errors) && dteData.errors.length > 0)) {
        return jsonResponse(
          {
            ok: false,
            error: extractLiorenErrorMessage(dteData, emitRes.status),
            liorenStatus: emitRes.status,
          },
          400
        );
      }

      const folio = Number(dteData?.folio || 0);
      const liorenDteId = Number(dteData?.id || 0) || null;
      if (!folio) {
        return jsonResponse(
          { ok: false, error: "Lioren no retornó un número de folio válido en la respuesta." },
          500
        );
      }

      // Subir PDF y XML firmados a Supabase Storage (mismo bucket payment_receipts/billing_files)
      let pdfUrl: string | null = null;
      let xmlUrl: string | null = null;
      const ts = Date.now();
      const safeRef = recordId || "manual";

      if (typeof dteData.pdf === "string" && dteData.pdf.length > 20) {
        const pdfBytes = decodeBase64ToBytes(dteData.pdf);
        const pdfPath = `billing_files/${safeRef}_factura_${serviceType}_dte${tipodoc}_folio_${folio}_${ts}.pdf`;
        const { error: pdfUpErr } = await supabaseClient.storage
          .from("payment_receipts")
          .upload(pdfPath, pdfBytes, { contentType: "application/pdf", upsert: true });

        if (!pdfUpErr) {
          const { data: pubPdf } = supabaseClient.storage.from("payment_receipts").getPublicUrl(pdfPath);
          pdfUrl = pubPdf?.publicUrl || null;
        } else {
          console.error("Error subiendo PDF de Lioren a Storage:", pdfUpErr);
        }
      }

      if (typeof dteData.xml === "string" && dteData.xml.length > 20) {
        const xmlBytes = decodeBase64ToBytes(dteData.xml);
        const xmlPath = `billing_files/${safeRef}_factura_${serviceType}_dte${tipodoc}_folio_${folio}_${ts}.xml`;
        const { error: xmlUpErr } = await supabaseClient.storage
          .from("payment_receipts")
          .upload(xmlPath, xmlBytes, { contentType: "application/xml", upsert: true });

        if (!xmlUpErr) {
          const { data: pubXml } = supabaseClient.storage.from("payment_receipts").getPublicUrl(xmlPath);
          xmlUrl = pubXml?.publicUrl || null;
        } else {
          console.error("Error subiendo XML de Lioren a Storage:", xmlUpErr);
        }
      }

      // Actualizar billing_records si viene asociado a un registro de cobranza
      let periodIdForLog: string | null = null;
      let comercioForLog = String(body.comercio || rs).trim();

      if (recordId) {
        const { data: recRow } = await supabaseClient
          .from("billing_records")
          .select("id, period_id, comercio")
          .eq("id", recordId)
          .maybeSingle();

        if (recRow) {
          periodIdForLog = recRow.period_id || null;
          if (recRow.comercio) comercioForLog = recRow.comercio;
        }

        const nowIso = new Date().toISOString();
        const coreUpdates: Record<string, unknown> = {
          updated_at: nowIso,
        };
        const extendedUpdates: Record<string, unknown> = {
          updated_at: nowIso,
        };

        if (serviceType === "fulfillment") {
          coreUpdates.factura_fulfillment = "Emitida";
          coreUpdates.num_factura = folio;
          if (vencimiento !== undefined) coreUpdates.fecha_limite = vencimiento;
          if (pdfUrl) coreUpdates.factura_fulfillment_pdf_url = pdfUrl;

          Object.assign(extendedUpdates, coreUpdates, {
            lioren_dte_id_fulfillment: liorenDteId,
            lioren_sii_status_fulfillment: dteData?.estado || "pendiente",
            ...(xmlUrl ? { factura_fulfillment_xml_url: xmlUrl } : {}),
          });
        } else {
          coreUpdates.factura_enviame = "Emitida";
          coreUpdates.num_factura_enviame = folio;
          if (vencimiento !== undefined) coreUpdates.fecha_limite_enviame = vencimiento;
          if (pdfUrl) coreUpdates.factura_enviame_pdf_url = pdfUrl;

          Object.assign(extendedUpdates, coreUpdates, {
            lioren_dte_id_enviame: liorenDteId,
            lioren_sii_status_enviame: dteData?.estado || "pendiente",
            ...(xmlUrl ? { factura_enviame_xml_url: xmlUrl } : {}),
          });
        }

        const { error: extErr } = await supabaseClient
          .from("billing_records")
          .update(extendedUpdates)
          .eq("id", recordId);

        if (extErr) {
          console.warn("Fallback actualizando billing_records sin columnas extendidas Lioren:", extErr.message);
          const { error: coreErr } = await supabaseClient
            .from("billing_records")
            .update(coreUpdates)
            .eq("id", recordId);
          if (coreErr) {
            console.error("Error crítico actualizando billing_records tras emitir en Lioren:", coreErr);
          }
        }
      }

      // Guardar/actualizar ficha tributaria del comercio si se solicitó
      if (body.saveCommerceLegalInfo !== false && body.comercio) {
        const targetComercio = String(body.comercio).trim();
        const fullLegalPayload: Record<string, unknown> = {
          comercio: targetComercio,
          razon_social: rs,
          rut: rutCheck.formatted,
          giro_facturacion: giro,
          direccion_facturacion: direccion,
          comuna_facturacion: String(receptorIn.comunaNombre || "").trim() || null,
          ciudad_facturacion: String(receptorIn.ciudadNombre || "").trim() || null,
          lioren_comuna_id: comunaId,
          lioren_ciudad_id: ciudadId,
          ...(emailReceptor ? { email_facturacion: emailReceptor } : {}),
          updated_at: new Date().toISOString(),
        };

        const { error: legalErr } = await supabaseClient
          .from("comercios_adicional_config")
          .upsert(fullLegalPayload, { onConflict: "comercio" });

        if (legalErr) {
          await supabaseClient
            .from("comercios_adicional_config")
            .upsert(
              {
                comercio: targetComercio,
                razon_social: rs,
                rut: rutCheck.formatted,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "comercio" }
            );
        }
      }

      // Registrar en bitácora lioren_dte_logs (best-effort si la tabla ya fue creada)
      await supabaseClient
        .from("lioren_dte_logs")
        .insert({
          record_id: recordId || null,
          period_id: periodIdForLog,
          comercio: comercioForLog,
          service_type: serviceType,
          tipodoc,
          folio,
          lioren_dte_id: liorenDteId,
          environment: isSandbox ? "sandbox" : "production",
          receptor_rut: rutCheck.formatted,
          receptor_rs: rs,
          receptor_giro: giro,
          receptor_direccion: direccion,
          receptor_comuna_id: comunaId,
          receptor_ciudad_id: ciudadId,
          glosa,
          monto_neto: Number(dteData?.montoneto ?? montoNeto),
          monto_iva: Number(dteData?.montoiva ?? 0),
          monto_total: Number(dteData?.montototal ?? montoNeto),
          pdf_url: pdfUrl,
          xml_url: xmlUrl,
          sii_status: dteData?.estado || "pendiente",
          idempotency_key: idemKey,
          emitted_by: callerUserId,
        })
        .then(
          () => {},
          () => {}
        );

      return jsonResponse({
        ok: true,
        isSandbox,
        environment: isSandbox ? "sandbox" : "production",
        dte: {
          id: liorenDteId,
          tipodoc,
          folio,
          fecha: dteData?.fecha || fechaEmision,
          rut: dteData?.rut || rutCheck.formatted,
          rs: dteData?.rs || rs,
          montoneto: Number(dteData?.montoneto ?? montoNeto),
          montoexento: Number(dteData?.montoexento ?? 0),
          montoiva: Number(dteData?.montoiva ?? 0),
          montototal: Number(dteData?.montototal ?? 0),
          estado: dteData?.estado || "pendiente",
        },
        pdfUrl,
        xmlUrl,
      });
    }

    // =========================================================================
    // ACCIÓN 4: CONSULT_DTE (Consultar estado SII / Track ID / Recuperar PDF)
    // =========================================================================
    if (action === "consult_dte") {
      const tipodoc = String(body.tipodoc || "33").trim();
      const folio = parseInt(String(body.folio || ""), 10);
      const recordId = String(body.recordId || "").trim();
      const serviceType = body.serviceType === "enviame" ? "enviame" : "fulfillment";
      const refreshFiles = Boolean(body.refreshFiles);

      if (!Number.isInteger(folio) || folio <= 0) {
        return jsonResponse({ ok: false, error: "Debes indicar un número de folio válido a consultar." }, 400);
      }

      const query = new URLSearchParams({
        tipodoc,
        folio: String(folio),
        ...(refreshFiles ? { expects: "all" } : {}),
      });

      const consultRes = await liorenFetch(liorenBaseUrl, liorenToken, `dtes?${query.toString()}`);
      if (!consultRes.ok || (Array.isArray(consultRes.data?.errors) && consultRes.data.errors.length > 0)) {
        return jsonResponse(
          { ok: false, error: extractLiorenErrorMessage(consultRes.data, consultRes.status) },
          400
        );
      }

      const d = consultRes.data;
      let pdfUrl: string | null = null;
      let xmlUrl: string | null = null;

      if (refreshFiles && typeof d.pdf === "string" && d.pdf.length > 20) {
        const ts = Date.now();
        const safeRef = recordId || "consult";
        const pdfPath = `billing_files/${safeRef}_factura_${serviceType}_dte${tipodoc}_folio_${folio}_${ts}.pdf`;
        const { error: upErr } = await supabaseClient.storage
          .from("payment_receipts")
          .upload(pdfPath, decodeBase64ToBytes(d.pdf), { contentType: "application/pdf", upsert: true });
        if (!upErr) {
          pdfUrl = supabaseClient.storage.from("payment_receipts").getPublicUrl(pdfPath).data?.publicUrl || null;
        }
      }

      if (refreshFiles && typeof d.xml === "string" && d.xml.length > 20) {
        const ts = Date.now();
        const safeRef = recordId || "consult";
        const xmlPath = `billing_files/${safeRef}_factura_${serviceType}_dte${tipodoc}_folio_${folio}_${ts}.xml`;
        const { error: upErr } = await supabaseClient.storage
          .from("payment_receipts")
          .upload(xmlPath, decodeBase64ToBytes(d.xml), { contentType: "application/xml", upsert: true });
        if (!upErr) {
          xmlUrl = supabaseClient.storage.from("payment_receipts").getPublicUrl(xmlPath).data?.publicUrl || null;
        }
      }

      if (recordId) {
        const extUpd: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (serviceType === "fulfillment") {
          extUpd.lioren_dte_id_fulfillment = Number(d.id || 0) || null;
          extUpd.lioren_sii_status_fulfillment = d.estado || "pendiente";
          extUpd.lioren_track_id_fulfillment = d.trackid ? String(d.trackid) : null;
          if (pdfUrl) extUpd.factura_fulfillment_pdf_url = pdfUrl;
          if (xmlUrl) extUpd.factura_fulfillment_xml_url = xmlUrl;
        } else {
          extUpd.lioren_dte_id_enviame = Number(d.id || 0) || null;
          extUpd.lioren_sii_status_enviame = d.estado || "pendiente";
          extUpd.lioren_track_id_enviame = d.trackid ? String(d.trackid) : null;
          if (pdfUrl) extUpd.factura_enviame_pdf_url = pdfUrl;
          if (xmlUrl) extUpd.factura_enviame_xml_url = xmlUrl;
        }
        await supabaseClient
          .from("billing_records")
          .update(extUpd)
          .eq("id", recordId)
          .then(
            () => {},
            () => {}
          );
      }

      return jsonResponse({
        ok: true,
        dte: {
          id: d.id,
          tipodoc: d.tipodoc,
          folio: d.folio,
          fecha: d.fecha,
          rut: d.rut,
          rs: d.rs,
          montoneto: d.montoneto,
          montoiva: d.montoiva,
          montototal: d.montototal,
          estado: d.estado || "pendiente",
          trackid: d.trackid || null,
        },
        pdfUrl,
        xmlUrl,
      });
    }

    // =========================================================================
    // ACCIÓN 5: EMIT_CREDIT_NOTE (Emitir Nota de Crédito 61 para anular Factura)
    // =========================================================================
    if (action === "emit_credit_note") {
      const recordId = String(body.recordId || "").trim();
      const serviceType = body.serviceType === "enviame" ? "enviame" : "fulfillment";
      const refTipodoc = String(body.refTipodoc || "33").trim();
      const refFolio = parseInt(String(body.refFolio || ""), 10);
      const motivoGlosa = String(body.motivoGlosa || "Anula factura electrónica de referencia")
        .trim()
        .slice(0, 80);

      if (!Number.isInteger(refFolio) || refFolio <= 0) {
        return jsonResponse({ ok: false, error: "Folio de factura a anular inválido." }, 400);
      }
      if (motivoGlosa.length < 5) {
        return jsonResponse(
          { ok: false, error: "La glosa de referencia debe tener al menos 5 caracteres." },
          400
        );
      }

      // Consultar la factura original en Lioren para copiar exactamente ítems y fecha
      const origRes = await liorenFetch(
        liorenBaseUrl,
        liorenToken,
        `dtes?tipodoc=${encodeURIComponent(refTipodoc)}&folio=${refFolio}`
      );
      if (!origRes.ok || !origRes.data?.folio) {
        return jsonResponse(
          {
            ok: false,
            error:
              "No se encontró la factura original en Lioren para emitir Nota de Crédito: " +
              extractLiorenErrorMessage(origRes.data, origRes.status),
          },
          400
        );
      }

      const orig = origRes.data;
      const receptorIn = body.receptor || {};
      const rutCheck = normalizeAndValidateRut(receptorIn.rut || orig.rut || "");
      if (!rutCheck.valid) {
        return jsonResponse({ ok: false, error: "RUT del receptor inválido para Nota de Crédito." }, 400);
      }

      const comunaId = parseInt(String(receptorIn.comuna || ""), 10);
      const ciudadId = parseInt(String(receptorIn.ciudad || ""), 10);
      const giro = String(receptorIn.giro || "").trim().slice(0, 40);
      const direccion = String(receptorIn.direccion || "").trim().slice(0, 70);

      if (!comunaId || !ciudadId || giro.length < 5 || direccion.length < 5) {
        return jsonResponse(
          {
            ok: false,
            error:
              "Para emitir la Nota de Crédito se requieren Giro, Dirección, Comuna y Ciudad tributaria del receptor.",
          },
          400
        );
      }

      const origDetalles = Array.isArray(orig.detalles) && orig.detalles.length > 0
        ? orig.detalles.map((it: any) => ({
            ...(it.codigo ? { codigo: String(it.codigo).slice(0, 128) } : {}),
            nombre: String(it.nombre || "Anulación de Servicio").slice(0, 80),
            cantidad: Number(it.cantidad || 1),
            unidad: String(it.unidad || "UN").slice(0, 4),
            precio: Number(it.precio || orig.montoneto || 0),
            exento: Number(it.exento) === 1 || Boolean(it.exento === true),
          }))
        : [
            {
              nombre: `ANULA FACTURA FOLIO ${refFolio}`,
              cantidad: 1,
              unidad: "UN",
              precio: Number(orig.montoneto || 0),
              exento: refTipodoc === "34",
            },
          ];

      const ncPayload = {
        emisor: {
          tipodoc: "61",
          fecha: getChileTodayIso(),
          observaciones: `Anula Factura Electrónica Folio #${refFolio}`,
        },
        receptor: {
          rut: rutCheck.formatted,
          rs: String(receptorIn.rs || orig.rs || "").trim().slice(0, 100),
          giro,
          comuna: comunaId,
          ciudad: ciudadId,
          direccion,
        },
        detalles: origDetalles,
        referencias: [
          {
            fecha: orig.fecha,
            tipodoc: refTipodoc,
            folio: String(refFolio),
            razon: 1, // 1 = Anula Documento de Referencia
            glosa: motivoGlosa,
          },
        ],
        expects: "all",
      };

      const idemKey = String(body.idempotencyKey || "").trim().length >= 36
        ? String(body.idempotencyKey).trim().slice(0, 64)
        : crypto.randomUUID();

      const ncRes = await liorenFetch(liorenBaseUrl, liorenToken, "dtes", {
        method: "POST",
        body: ncPayload,
        idempotencyKey: idemKey,
      });

      if (!ncRes.ok || (Array.isArray(ncRes.data?.errors) && ncRes.data.errors.length > 0)) {
        return jsonResponse(
          { ok: false, error: extractLiorenErrorMessage(ncRes.data, ncRes.status) },
          400
        );
      }

      const ncData = ncRes.data;
      const ncFolio = Number(ncData?.folio || 0);
      let ncPdfUrl: string | null = null;
      const ts = Date.now();
      const safeRef = recordId || "nc";

      if (typeof ncData.pdf === "string" && ncData.pdf.length > 20) {
        const pdfPath = `billing_files/${safeRef}_nc61_${serviceType}_folio_${ncFolio}_anula_${refFolio}_${ts}.pdf`;
        const { error: upErr } = await supabaseClient.storage
          .from("payment_receipts")
          .upload(pdfPath, decodeBase64ToBytes(ncData.pdf), { contentType: "application/pdf", upsert: true });
        if (!upErr) {
          ncPdfUrl = supabaseClient.storage.from("payment_receipts").getPublicUrl(pdfPath).data?.publicUrl || null;
        }
      }

      if (recordId && body.resetBillingStatus !== false) {
        const coreReset: Record<string, unknown> = { updated_at: new Date().toISOString() };
        const extReset: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (serviceType === "fulfillment") {
          coreReset.factura_fulfillment = "Facturar";
          coreReset.num_factura = null;
          Object.assign(extReset, coreReset, {
            lioren_nc_folio_fulfillment: ncFolio,
            lioren_nc_pdf_url_fulfillment: ncPdfUrl,
            lioren_sii_status_fulfillment: `anulada_nc_${ncFolio}`,
          });
        } else {
          coreReset.factura_enviame = "Facturar";
          coreReset.num_factura_enviame = null;
          Object.assign(extReset, coreReset, {
            lioren_nc_folio_enviame: ncFolio,
            lioren_nc_pdf_url_enviame: ncPdfUrl,
            lioren_sii_status_enviame: `anulada_nc_${ncFolio}`,
          });
        }
        const { error: eErr } = await supabaseClient.from("billing_records").update(extReset).eq("id", recordId);
        if (eErr) {
          await supabaseClient.from("billing_records").update(coreReset).eq("id", recordId);
        }
      }

      return jsonResponse({
        ok: true,
        nc: {
          id: ncData.id,
          folio: ncFolio,
          fecha: ncData.fecha,
          montototal: ncData.montototal,
          refFolio,
        },
        ncPdfUrl,
      });
    }

    return jsonResponse({ ok: false, error: `Acción desconocida en lioren-api: ${action}` }, 400);
  } catch (err: any) {
    console.error("Unhandled error in lioren-api Edge Function:", err);
    return jsonResponse({ ok: false, error: err?.message || "Error interno en lioren-api" }, 500);
  }
});
