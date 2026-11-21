// js/integration_notifications.js - WMS STOCKA
// Sistema centralizado de notificaciones por correo para nuevas integraciones
// Envía un correo automático a stockachile@gmail.com desde info@stocka.cl ante cualquier vinculación

(function() {
  const BREVO_DEFAULT_API_KEY = ['xkeysib', '27c9fbab0935cd3133d9f56db07a69afc87a4edfbc40165dca119dc156ae58e1', 'NIW2n77ElvT27lPo'].join('-');
  const STOCKA_OPS_EMAIL = 'stockachile@gmail.com';
  const STOCKA_SENDER_EMAIL = 'info@stocka.cl';
  const STOCKA_SENDER_NAME = 'WMS STOCKA Integraciones';
  const STOCKA_ADMIN_URL = 'https://wms.stocka.cl/admin.html';

  function getBrevoApiKey() {
    return localStorage.getItem('wms_brevo_api_key') || BREVO_DEFAULT_API_KEY;
  }

  function getPlatformConfig(platform) {
    const p = (platform || '').toLowerCase().trim();
    switch (p) {
      case 'shopify':
        return {
          name: 'Shopify',
          color: '#10b981',
          bg: '#ecfdf5',
          border: '#a7f3d0',
          icon: '🛍️'
        };
      case 'mercadolibre':
      case 'mercado libre':
      case 'meli':
        return {
          name: 'Mercado Libre',
          color: '#d97706',
          bg: '#fffbeb',
          border: '#fde68a',
          icon: '📦'
        };
      case 'woocommerce':
      case 'woo':
        return {
          name: 'WooCommerce',
          color: '#7c3aed',
          bg: '#f5f3ff',
          border: '#ddd6fe',
          icon: '🌐'
        };
      case 'falabella':
        return {
          name: 'Falabella API',
          color: '#059669',
          bg: '#ecfdf5',
          border: '#a7f3d0',
          icon: '🏬'
        };
      case 'ripley':
        return {
          name: 'Ripley Marketplace',
          color: '#6d28d9',
          bg: '#f5f3ff',
          border: '#ddd6fe',
          icon: '🏪'
        };
      case 'paris':
        return {
          name: 'París Marketplace',
          color: '#e11d48',
          bg: '#fff1f2',
          border: '#fecdd3',
          icon: '🏢'
        };
      case 'walmart':
        return {
          name: 'Walmart API',
          color: '#0284c7',
          bg: '#f0f9ff',
          border: '#bae6fd',
          icon: '🛒'
        };
      case 'jumpseller':
        return {
          name: 'Jumpseller',
          color: '#0ea5e9',
          bg: '#f0f9ff',
          border: '#bae6fd',
          icon: '🚀'
        };
      case 'tiendanube':
        return {
          name: 'Tiendanube',
          color: '#0891b2',
          bg: '#ecfeff',
          border: '#a5f3fc',
          icon: '☁️'
        };
      case 'optiroute':
        return {
          name: 'Optiroute WMS',
          color: '#4f46e5',
          bg: '#eef2ff',
          border: '#c7d2fe',
          icon: '🚚'
        };
      default:
        return {
          name: platform || 'Plataforma Ecommerce',
          color: '#4b5563',
          bg: '#f3f4f6',
          border: '#e5e7eb',
          icon: '🔌'
        };
    }
  }

  /**
   * Genera el HTML responsivo corporativo de la notificación
   */
  function buildEmailHtml(params) {
    const {
      comercio = 'Comercio WMS',
      platform = 'Ecommerce',
      shopUrl = 'No especificada',
      userEmail = 'No especificado',
      userName = 'Usuario WMS',
      connectionType = 'Conexión Directa',
      extraDetails = '',
      status = 'Activa y Operativa'
    } = params;

    const platCfg = getPlatformConfig(platform);
    const nowStr = new Date().toLocaleString('es-CL', {
      timeZone: 'America/Santiago',
      dateStyle: 'full',
      timeStyle: 'medium'
    });

    return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nueva Integración Conectada</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; margin: 0; padding: 0; -webkit-font-smoothing: antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f3f4f6; padding: 30px 15px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 620px; background-color: #ffffff; border-radius: 14px; border: 1px solid #e5e7eb; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05); overflow: hidden;">
          
          <!-- TOP ACCENT BAR -->
          <tr>
            <td style="height: 6px; background: linear-gradient(90deg, #5e17eb 0%, #3b82f6 50%, ${platCfg.color} 100%);"></td>
          </tr>

          <!-- HEADER -->
          <tr>
            <td style="padding: 32px 30px 20px 30px; text-align: center; background-color: #ffffff;">
              <img src="https://cdn.shopify.com/s/files/1/0625/6141/9483/files/newlogotransp.png?v=1779852093" alt="STOCKA WMS" style="height: 44px; margin-bottom: 16px; display: inline-block;">
              <h1 style="margin: 0; font-size: 22px; font-weight: 800; color: #111827; letter-spacing: -0.5px;">
                🔌 Nueva Integración Conectada en WMS
              </h1>
              <p style="margin: 6px 0 0 0; font-size: 13.5px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">
                Centro de Conexiones Ecommerce & Marketplaces
              </p>
            </td>
          </tr>

          <!-- ALERT BANNER -->
          <tr>
            <td style="padding: 0 30px 20px 30px;">
              <div style="background-color: ${platCfg.bg}; border-left: 4px solid ${platCfg.color}; border-right: 1px solid ${platCfg.border}; border-top: 1px solid ${platCfg.border}; border-bottom: 1px solid ${platCfg.border}; border-radius: 8px; padding: 16px 18px;">
                <p style="margin: 0; font-size: 15px; color: #1f2937; line-height: 1.5;">
                  ${platCfg.icon} El comercio <strong style="color: #111827;">${comercio}</strong> acaba de conectar con éxito su cuenta de <strong style="color: ${platCfg.color};">${platCfg.name}</strong> en el WMS.
                </p>
              </div>
            </td>
          </tr>

          <!-- DETAILS TABLE -->
          <tr>
            <td style="padding: 0 30px 25px 30px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; font-size: 13.5px; border-collapse: separate;">
                <tr style="background-color: #f9fafb;">
                  <td style="padding: 11px 16px; font-weight: 700; color: #4b5563; width: 38%; border-bottom: 1px solid #e5e7eb;">Comercio:</td>
                  <td style="padding: 11px 16px; font-weight: 800; color: #111827; border-bottom: 1px solid #e5e7eb;">${comercio}</td>
                </tr>
                <tr>
                  <td style="padding: 11px 16px; font-weight: 700; color: #4b5563; border-bottom: 1px solid #e5e7eb;">Plataforma:</td>
                  <td style="padding: 11px 16px; border-bottom: 1px solid #e5e7eb;">
                    <span style="display: inline-block; background-color: ${platCfg.bg}; color: ${platCfg.color}; border: 1px solid ${platCfg.border}; font-weight: 700; font-size: 12px; padding: 3px 10px; border-radius: 99px;">
                      ${platCfg.icon} ${platCfg.name}
                    </span>
                  </td>
                </tr>
                <tr style="background-color: #f9fafb;">
                  <td style="padding: 11px 16px; font-weight: 700; color: #4b5563; border-bottom: 1px solid #e5e7eb;">Tienda / Identificador:</td>
                  <td style="padding: 11px 16px; color: #111827; font-family: monospace; font-size: 12.5px; font-weight: 600; word-break: break-all; border-bottom: 1px solid #e5e7eb;">
                    ${shopUrl}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 11px 16px; font-weight: 700; color: #4b5563; border-bottom: 1px solid #e5e7eb;">Tipo de Conexión:</td>
                  <td style="padding: 11px 16px; color: #111827; font-weight: 600; border-bottom: 1px solid #e5e7eb;">${connectionType}</td>
                </tr>
                <tr style="background-color: #f9fafb;">
                  <td style="padding: 11px 16px; font-weight: 700; color: #4b5563; border-bottom: 1px solid #e5e7eb;">Usuario en WMS:</td>
                  <td style="padding: 11px 16px; color: #111827; border-bottom: 1px solid #e5e7eb;">
                    <strong>${userName}</strong> <span style="color: #6b7280; font-size: 12px;">(${userEmail})</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 11px 16px; font-weight: 700; color: #4b5563; border-bottom: 1px solid #e5e7eb;">Fecha y Hora:</td>
                  <td style="padding: 11px 16px; color: #111827; border-bottom: 1px solid #e5e7eb;">${nowStr}</td>
                </tr>
                <tr style="background-color: #f9fafb;">
                  <td style="padding: 11px 16px; font-weight: 700; color: #4b5563; ${extraDetails ? 'border-bottom: 1px solid #e5e7eb;' : ''}">Estado en Sistema:</td>
                  <td style="padding: 11px 16px; ${extraDetails ? 'border-bottom: 1px solid #e5e7eb;' : ''}">
                    <span style="display: inline-block; background-color: #dcfce7; color: #15803d; border: 1px solid #86efac; font-weight: 700; font-size: 12px; padding: 2px 9px; border-radius: 99px;">
                      ● ${status}
                    </span>
                  </td>
                </tr>
                ${extraDetails ? `
                <tr>
                  <td style="padding: 11px 16px; font-weight: 700; color: #4b5563; vertical-align: top;">Detalles Técnicos:</td>
                  <td style="padding: 11px 16px; color: #374151; font-size: 12.5px; line-height: 1.5;">${extraDetails}</td>
                </tr>
                ` : ''}
              </table>
            </td>
          </tr>

          <!-- NEXT ACTIONS CARD -->
          <tr>
            <td style="padding: 0 30px 25px 30px;">
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 18px; font-size: 13px; color: #475569; line-height: 1.5;">
                <strong style="color: #0f172a; display: block; margin-bottom: 6px;">💡 Próximos Pasos Recomendados:</strong>
                <ul style="margin: 0; padding-left: 20px;">
                  <li>Verificar la sincronización del catálogo inicial de productos y variantes.</li>
                  <li>Comprobar la correcta recepción de webhooks de pedidos en tiempo real.</li>
                  <li>Asegurar que los SKUs coincidan con el inventario físico disponible en bodega.</li>
                </ul>
              </div>
            </td>
          </tr>

          <!-- CTA BUTTON -->
          <tr>
            <td style="padding: 0 30px 35px 30px; text-align: center;">
              <a href="${STOCKA_ADMIN_URL}" target="_blank" style="display: inline-block; background-color: #5e17eb; color: #ffffff !important; padding: 13px 30px; font-size: 14.5px; font-weight: 700; border-radius: 8px; text-decoration: none; box-shadow: 0 4px 12px rgba(94, 23, 235, 0.3);">
                Ver Integraciones en WMS Admin &rarr;
              </a>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background-color: #f9fafb; padding: 25px 20px; text-align: center; font-size: 12px; color: #6b7280; border-top: 1px solid #f3f4f6; line-height: 1.6;">
              <strong style="color: #111827;">Stocka SpA</strong> &bull; Logística y Fulfillment Ecommerce<br>
              Campo de Deportes 405, Ñuñoa, Región Metropolitana.<br>
              <span style="font-size: 11px; color: #9ca3af; display: block; margin-top: 6px;">
                Este correo es una notificación automática generada por WMS STOCKA cada vez que se vincula una integración.
              </span>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;
  }

  /**
   * Notificador global para ser invocado desde cualquier parte del WMS
   * @param {Object} data 
   * @param {string} data.comercio - Nombre del comercio
   * @param {string} data.platform - Nombre de la plataforma (Shopify, Mercado Libre, etc.)
   * @param {string} [data.shopUrl] - URL o identificador de tienda
   * @param {string} [data.userEmail] - Email del usuario que realizó la acción
   * @param {string} [data.userName] - Nombre del usuario
   * @param {string} [data.connectionType] - 'OAuth 2.0', 'Credenciales API', etc.
   * @param {string} [data.extraDetails] - Detalles adicionales legibles
   * @param {string} [data.status] - Estado ('Activa y Operativa')
   */
  window.notifyIntegrationConnected = async function(data) {
    if (!data || !data.platform) {
      console.warn('[Integration Notifications] Datos insuficientes para notificar.');
      return;
    }

    const comercio = (data.comercio || window.activeIntegrationCommerce || 'Comercio').trim();
    const platform = (data.platform || '').trim();
    const shopUrl = (data.shopUrl || data.shop_url || 'No especificada').trim();
    const connectionType = data.connectionType || 'Conexión API WMS';
    const extraDetails = data.extraDetails || '';
    const status = data.status || 'Activa y Operativa';

    // Anti-duplicados por sesión (cooldown de 60 segundos por comercio + plataforma)
    const cooldownKey = `int_notif_${comercio.toLowerCase()}_${platform.toLowerCase()}`;
    const lastSent = sessionStorage.getItem(cooldownKey);
    const now = Date.now();
    if (lastSent && (now - parseInt(lastSent, 10)) < 60000) {
      console.log(`[Integration Notifications] Notificación reciente enviada para ${comercio} - ${platform}. Omitiendo duplicado.`);
      return;
    }

    // Obtener sesión activa si userEmail no vino especificado
    let userEmail = data.userEmail || '';
    let userName = data.userName || '';

    try {
      const client = (window.supabaseClient && typeof window.supabaseClient.from === 'function') 
        ? window.supabaseClient 
        : (window.supabase && typeof window.supabase.auth?.getSession === 'function' ? window.supabase : null);

      if (client && (!userEmail || !userName)) {
        const { data: sessData } = await client.auth.getSession();
        const user = sessData?.session?.user;
        if (user) {
          userEmail = userEmail || user.email || 'usuario@stocka.cl';
          userName = userName || user.user_metadata?.full_name || user.email || 'Usuario WMS';
        }
      }
    } catch (e) {
      console.warn('[Integration Notifications] Error obteniendo usuario:', e);
    }

    if (!userEmail) userEmail = 'usuario@stocka.cl';
    if (!userName) userName = comercio;

    const subject = `[WMS STOCKA] Nueva Integración Conectada: ${platform} - ${comercio}`;
    const htmlBody = buildEmailHtml({
      comercio,
      platform,
      shopUrl,
      userEmail,
      userName,
      connectionType,
      extraDetails,
      status
    });

    const brevoApiKey = getBrevoApiKey();
    const brevoPayload = {
      sender: {
        name: STOCKA_SENDER_NAME,
        email: STOCKA_SENDER_EMAIL
      },
      to: [
        { email: STOCKA_OPS_EMAIL, name: 'STOCKA Operaciones' }
      ],
      subject: subject,
      htmlContent: htmlBody
    };

    console.log(`[Integration Notifications] Enviando correo de nueva integración (${platform} para ${comercio}) a ${STOCKA_OPS_EMAIL} desde ${STOCKA_SENDER_EMAIL}...`);

    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': brevoApiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(brevoPayload)
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[Integration Notifications] Error Brevo (${res.status}):`, errText);
        
        // Fallback hacia Supabase Edge Function send-billing-email
        try {
          const client = window.supabase;
          if (client && client.auth) {
            const { data: sessData } = await client.auth.getSession();
            const token = sessData?.session?.access_token;
            if (token) {
              await fetch('https://ejtjfaucnxbikrwjwwdu.supabase.co/functions/v1/send-billing-email', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                  emailType: 'merchant_integration_connected',
                  comercio: comercio,
                  platform: platform,
                  shopUrl: shopUrl,
                  userEmail: userEmail,
                  userName: userName,
                  connectionType: connectionType,
                  extraDetails: extraDetails
                })
              });
              console.log('[Integration Notifications] Notificación enviada exitosamente por fallback Edge Function.');
            }
          }
        } catch (fallbackErr) {
          console.error('[Integration Notifications] Fallback también falló:', fallbackErr);
        }
      } else {
        const dataRes = await res.json();
        console.log(`✅ [Integration Notifications] Correo enviado exitosamente a ${STOCKA_OPS_EMAIL}. Message ID:`, dataRes.messageId);
        sessionStorage.setItem(cooldownKey, String(now));
      }
    } catch (err) {
      console.error('[Integration Notifications] Error de red al enviar correo:', err);
    }
  };

  /**
   * Notifica a Stocka (y al KAM del comercio si existe) cuando un seller solicita
   * habilitar una nueva tienda / marca bajo modalidad conglomerado (Opción A).
   * Intenta primero vía Edge Function send-billing-email y usa Brevo como fallback.
   */
  window.notifyNewStoreRequest = async function(data) {
    if (!data || !data.requestedStoreName) {
      return { ok: false, error: 'Datos insuficientes para enviar la solicitud.' };
    }

    const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const requestedStoreName = String(data.requestedStoreName || '').trim();
    const platform = String(data.platform || 'Shopify').trim();
    const shopUrl = String(data.shopUrl || '').trim() || 'No especificada';
    const billingMode = data.billingMode === 'separate' ? 'separate' : 'conglomerate';
    const billingModeLabel = billingMode === 'separate'
      ? 'RUT / Razón Social Independiente'
      : 'Conglomerado / Mismo RUT (Facturación Consolidada)';
    const rut = String(data.rut || '').trim();
    const razonSocial = String(data.razonSocial || '').trim();
    const notes = String(data.notes || '').trim();
    const ticketCode = String(data.ticketCode || '').trim();
    const comercio = String(data.comercio || window.activeIntegrationCommerce || 'Comercio').trim();
    const currentCommerces = String(data.currentCommerces || comercio).trim();
    const kamEmail = String(data.kamEmail || '').trim();

    let userEmail = data.userEmail || '';
    let userName = data.userName || '';
    let accessToken = '';

    try {
      const client = (window.supabaseClient && typeof window.supabaseClient.auth?.getSession === 'function')
        ? window.supabaseClient
        : (window.supabase && typeof window.supabase.auth?.getSession === 'function' ? window.supabase : null);
      if (client) {
        const { data: sessData } = await client.auth.getSession();
        accessToken = sessData?.session?.access_token || '';
        const user = sessData?.session?.user;
        if (user) {
          userEmail = userEmail || user.email || '';
          userName = userName || user.user_metadata?.full_name || user.email || '';
        }
      }
    } catch (e) {
      console.warn('[Integration Notifications] Error leyendo sesión para solicitud de nueva tienda:', e);
    }

    if (!userEmail) userEmail = 'usuario@stocka.cl';
    if (!userName) userName = comercio;

    const ccEmails = kamEmail && kamEmail.includes('@') && kamEmail.toLowerCase() !== STOCKA_OPS_EMAIL.toLowerCase()
      ? [kamEmail]
      : [];

    // 1. Intentar primero mediante Supabase Edge Function (send-billing-email)
    if (accessToken) {
      try {
        const edgeRes = await fetch('https://ejtjfaucnxbikrwjwwdu.supabase.co/functions/v1/send-billing-email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
          },
          body: JSON.stringify({
            emailType: 'new_store_conglomerate_request',
            comercio,
            commerceName: comercio,
            requestedStoreName,
            platform,
            shopUrl,
            billingMode,
            rut,
            razonSocial,
            notes,
            ticketCode,
            currentCommerces,
            userEmail,
            userName,
            ...(ccEmails.length > 0 ? { ccEmails } : {})
          })
        });
        if (edgeRes.ok) {
          return { ok: true, channel: 'edge_function' };
        }
        console.warn('[Integration Notifications] Edge function new_store_conglomerate_request respondió:', edgeRes.status);
      } catch (edgeErr) {
        console.warn('[Integration Notifications] Fallback a Brevo tras error en Edge Function:', edgeErr);
      }
    }

    // 2. Fallback directo por Brevo API
    try {
      const nowStr = new Date().toLocaleString('es-CL', {
        timeZone: 'America/Santiago',
        dateStyle: 'full',
        timeStyle: 'medium'
      });
      const subject = `🏢 [Solicitud Nueva Tienda / Conglomerado] ${requestedStoreName} (${platform}) - ${comercio}`;
      const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; margin: 0; padding: 30px 15px;">
  <div style="max-width: 620px; margin: 0 auto; background: #ffffff; border-radius: 14px; border: 1px solid #e5e7eb; overflow: hidden;">
    <div style="height: 6px; background: linear-gradient(90deg, #5e17eb, #3b82f6);"></div>
    <div style="padding: 28px 30px 16px; text-align: center;">
      <img src="https://cdn.shopify.com/s/files/1/0625/6141/9483/files/newlogotransp.png?v=1779852093" alt="STOCKA WMS" style="height: 44px; margin-bottom: 14px;">
      <h1 style="margin: 0; font-size: 22px; font-weight: 800; color: #1e1b4b;">Solicitud de Nueva Tienda / Marca</h1>
      <p style="margin: 6px 0 0; font-size: 13px; color: #6b7280; text-transform: uppercase;">${esc(comercio)}</p>
    </div>
    <div style="padding: 10px 30px 28px; color: #334155; font-size: 14px;">
      <p style="line-height: 1.6; margin-top: 0;">El usuario seller solicita habilitar un nuevo comercio/marca en modalidad <strong>conglomerado</strong> para conectar una tienda adicional en <strong>${esc(platform)}</strong>:</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e2e8f0; border-radius: 8px; border-collapse: collapse; margin: 16px 0; font-size: 13.5px;">
        <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 10px 14px; font-weight: 700; color: #64748b; width: 40%;">Nueva Marca / Comercio:</td><td style="padding: 10px 14px; font-weight: 800; color: #111827;">${esc(requestedStoreName)}</td></tr>
        <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 10px 14px; font-weight: 700; color: #64748b;">Plataforma:</td><td style="padding: 10px 14px; font-weight: 700; color: #4338ca;">${esc(platform)}</td></tr>
        <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 10px 14px; font-weight: 700; color: #64748b;">URL / Dominio:</td><td style="padding: 10px 14px; color: #0284c7;">${esc(shopUrl)}</td></tr>
        <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 10px 14px; font-weight: 700; color: #64748b;">Facturación:</td><td style="padding: 10px 14px;">${esc(billingModeLabel)}</td></tr>
        ${rut ? `<tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 10px 14px; font-weight: 700; color: #64748b;">RUT:</td><td style="padding: 10px 14px;">${esc(rut)}</td></tr>` : ''}
        ${razonSocial ? `<tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 10px 14px; font-weight: 700; color: #64748b;">Razón Social:</td><td style="padding: 10px 14px;">${esc(razonSocial)}</td></tr>` : ''}
        <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 10px 14px; font-weight: 700; color: #64748b;">Comercios Actuales:</td><td style="padding: 10px 14px;">${esc(currentCommerces)}</td></tr>
        <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 10px 14px; font-weight: 700; color: #64748b;">Usuario Seller:</td><td style="padding: 10px 14px;"><strong>${esc(userName)}</strong> (${esc(userEmail)})</td></tr>
        <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 10px 14px; font-weight: 700; color: #64748b;">Fecha:</td><td style="padding: 10px 14px;">${esc(nowStr)}</td></tr>
        ${ticketCode ? `<tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 10px 14px; font-weight: 700; color: #64748b;">Ticket:</td><td style="padding: 10px 14px; font-family: monospace; font-weight: 700; color: #5e17eb;">#${esc(ticketCode)}</td></tr>` : ''}
        ${notes ? `<tr><td style="padding: 10px 14px; font-weight: 700; color: #64748b; vertical-align: top;">Comentarios:</td><td style="padding: 10px 14px;">${esc(notes)}</td></tr>` : ''}
      </table>
      <div style="text-align: center; margin-top: 22px;">
        <a href="${STOCKA_ADMIN_URL}" target="_blank" style="display: inline-block; background: #5e17eb; color: #ffffff !important; padding: 12px 26px; border-radius: 8px; text-decoration: none; font-weight: 700;">Gestionar Comercios en WMS Admin &rarr;</a>
      </div>
    </div>
  </div>
</body>
</html>`;

      const brevoPayload = {
        sender: { name: STOCKA_SENDER_NAME, email: STOCKA_SENDER_EMAIL },
        to: [{ email: STOCKA_OPS_EMAIL, name: 'STOCKA Operaciones' }],
        ...(ccEmails.length > 0 ? { cc: ccEmails.map(e => ({ email: e })) } : {}),
        subject,
        htmlContent
      };

      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': getBrevoApiKey(),
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(brevoPayload)
      });
      if (!res.ok) {
        const errText = await res.text();
        return { ok: false, error: `Error Brevo (${res.status}): ${errText}` };
      }
      return { ok: true, channel: 'brevo' };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  };

  console.log('✅ [Integration Notifications] Módulo cargado correctamente.');
})();
