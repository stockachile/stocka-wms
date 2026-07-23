const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'supabase', 'functions', 'send-billing-email', 'index.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Normalizar saltos de línea a \n para evitar discrepancias de CRLF en Windows
content = content.replace(/\r\n/g, '\n');

// Definir el fragmento de código antiguo que queremos reemplazar
const targetStart = '    const htmlBody = `';
const targetEnd = `    const brevoPayload = {
      sender: {
        name: emailType === 'stock_inbound_created' ? "Sistema WMS Stocka" : (useInfoSender ? "Stocka" : "Finanzas Stocka"),
        email: useInfoSender ? "info@stocka.cl" : "finanzas@stocka.cl"
      },
      to: finalRecipients.map(email => ({ email })),
      subject: emailSubject,
      htmlContent: htmlBody
    };`;

const startIndex = content.indexOf(targetStart);
const endIndex = content.indexOf(targetEnd);

if (startIndex === -1 || endIndex === -1) {
  console.error("No se pudo encontrar el bloque de reemplazo en el archivo. Indices:", startIndex, endIndex);
  process.exit(1);
}

// Extraer el fin de targetEnd
const endMatchIndex = endIndex + targetEnd.length;

// Definir la nueva sección con las dos plantillas (infoSender vs billing)
const newContentBlock = `    const infoSenderTypes = [
      'onboarding_received', 
      'onboarding_approved', 
      'onboarding_observed', 
      'onboarding_admin_notification', 
      'stock_inbound_created',
      'out_of_stock',
      'critical_stock_report',
      'incident_report',
      'volume_alert',
      'weekly_sales_report',
      'monthly_activity_report',
      'order_no_stock_alert'
    ];
    const useInfoSender = infoSenderTypes.includes(emailType);
    const finalRecipients = emailType === 'stock_inbound_created' ? ["stockachile@gmail.com"] : recipientEmails;

    let htmlBody = '';
    
    if (useInfoSender) {
      // Corporativo Stocka (Purple / System / Operations)
      htmlBody = \`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; margin: 0; padding: 0; -webkit-font-smoothing: antialiased;">
  <div style="width: 100%; background-color: #f3f4f6; padding: 40px 0;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #e5e7eb; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -2px rgba(0, 0, 0, 0.02); overflow: hidden;">
      
      <!-- BRAND ACCENT BAR -->
      <div style="height: 6px; background: linear-gradient(90deg, #5e17eb, #8b5cf6);"></div>

      <!-- HEADER MINIMALISTA CORPORATIVO -->
      <div style="padding: 35px 30px 15px 30px; text-align: center; background-color: #ffffff;">
        <img src="https://cdn.shopify.com/s/files/1/0625/6141/9483/files/newlogotransp.png?v=1779852093" alt="Stocka Logo" style="height: 48px; margin-bottom: 20px; display: inline-block;">
        <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: #1e1b4b; letter-spacing: -0.5px;">\${emailTitle}</h1>
        <p style="margin: 6px 0 0 0; font-size: 13.5px; font-weight: 500; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">\${commerceName}</p>
      </div>
      
      <!-- CONTENT -->
      <div style="padding: 10px 30px 30px 30px;">
        \${emailBodyHtml}
        
        \${customMsgHtml}
        
        <!-- BUTTON ACCEDER A WMS STOCKA (Explicit inline color with !important to prevent email client override) -->
        <div style="text-align: center; margin: 25px 0;">
          <a href="https://stocka-wms.netlify.app/dashboard.html" target="_blank" style="display: inline-block; background-color: #5e17eb; color: #ffffff !important; padding: 12px 28px; font-size: 15px; font-weight: 600; border-radius: 8px; text-decoration: none; text-align: center; box-shadow: 0 4px 10px rgba(94, 23, 235, 0.25);">Acceder a WMS Stocka</a>
        </div>
        
        \${mainNoticeHtml}
      </div>
      
      <!-- FOOTER -->
      <div style="background-color: #f9fafb; padding: 30px 20px; text-align: center; font-size: 12px; color: #6b7280; border-top: 1px solid #f3f4f6; line-height: 1.6;">
        <strong style="color: #111827; font-size: 13px;">Stocka SpA</strong><br>
        Fulfillment & Soporte Logístico para Ecommerce<br>
        Campo de Deportes 405, Ñuñoa.<br>
        <span style="display: block; margin-top: 12px; font-size: 11px; color: #9ca3af;">¿Tienes dudas? Escríbenos a: <a href="mailto:info@stocka.cl" style="color: #5e17eb; text-decoration: none; font-weight: 700;">info@stocka.cl</a></span>
      </div>
      
    </div>
  </div>
</body>
</html>
      \`;
    } else {
      // Facturación Tradicional (Blue / Finance)
      htmlBody = \`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 0; -webkit-font-smoothing: antialiased;">
  <div style="width: 100%; background-color: #f8fafc; padding: 40px 0;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03); overflow: hidden;">
      
      <!-- HEADER -->
      <div style="background: \${headerGradient}; padding: 30px; text-align: center; color: #ffffff;">
        <h1 style="margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px; color: #ffffff !important;">\${emailTitle}</h1>
        <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9; color: #ffffff !important;">\${periodName} - \${commerceName}</p>
      </div>
      
      <!-- CONTENT -->
      <div style="padding: 30px;">
        \${emailBodyHtml}
        
        \${customMsgHtml}
        
        <!-- BUTTON ACCEDER A WMS STOCKA (Explicit inline color with !important to prevent email client override) -->
        <div style="text-align: center; margin: 25px 0;">
          <a href="https://stocka-wms.netlify.app/dashboard.html" target="_blank" style="display: block; background-color: #2563eb; color: #ffffff !important; padding: 12px 24px; font-size: 15px; font-weight: 600; border-radius: 8px; text-decoration: none; text-align: center; box-shadow: 0 4px 6px rgba(37, 99, 235, 0.2); text-shadow: 0 1px 1px rgba(0,0,0,0.2);">Acceder a WMS Stocka</a>
        </div>
        
        \${mainNoticeHtml}
      </div>
      
      <!-- FOOTER -->
      <div style="background-color: #f1f5f9; padding: 25px 20px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; line-height: 1.6;">
        <img src="https://cdn.shopify.com/s/files/1/0625/6141/9483/files/newlogotransp.png?v=1779852093" alt="Stocka Logo" style="height: 38px; margin-bottom: 12px; display: inline-block;"><br>
        <strong style="color: #1e293b;">Stocka SpA</strong><br>
        Logística y Fulfillment Ecommerce<br>
        Campo de Deportes 405, Ñuñoa.<br>
        <span style="display: block; margin-top: 10px; font-size: 11px; color: #94a3b8;">Contacto Finanzas: <a href="mailto:finanzas@stocka.cl" style="color: #2563eb; text-decoration: none; font-weight: 600;">finanzas@stocka.cl</a></span>
      </div>
      
    </div>
  </div>
</body>
</html>
      \`;
    }

    const brevoPayload = {
      sender: {
        name: emailType === 'stock_inbound_created' ? "Sistema WMS Stocka" : (useInfoSender ? "Stocka" : "Finanzas Stocka"),
        email: useInfoSender ? "info@stocka.cl" : "finanzas@stocka.cl"
      },
      to: finalRecipients.map(email => ({ email })),
      subject: emailSubject,
      htmlContent: htmlBody
    };`;

const finalContent = content.substring(0, startIndex) + newContentBlock + content.substring(endMatchIndex);
fs.writeFileSync(filePath, finalContent, 'utf8');
console.log("Reemplazo de plantilla dual con normalización CRLF completado con éxito.");
