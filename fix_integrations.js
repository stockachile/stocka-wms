const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "js", "app.js");
let content = fs.readFileSync(file, "utf8");

// Regex to find the start
const startRegex = /<div style="margin-bottom: 2rem;">[\s\S]*?<h2[^>]*>Integraciones Ecommerce<\/h2>/;
const match = content.match(startRegex);

if (!match) {
    console.error("No start match");
    process.exit(1);
}
const startIndex = match.index;

const endStr = "    // Shopify Submit Listener";
const endIndex = content.indexOf(endStr, startIndex);

if (endIndex === -1) {
    console.error("No end match");
    process.exit(1);
}

// Find the closing backtick before the endStr
const backtickIndex = content.lastIndexOf("`;", endIndex);

const templateReplacement = `<div style="margin-bottom: 2rem;">
        <h2 style="font-size: 1.75rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--color-text-main);">Integraciones Ecommerce</h2>
        <p style="color: var(--color-text-muted); font-size: 1rem; max-width: 800px; line-height: 1.6;">
          En esta sección puedes conectar WMS STOCKA con tus tiendas en línea y marketplaces. 
          Al realizar una integración, los <strong>pedidos</strong> que recibas en tu tienda se sincronizarán automáticamente con nuestro WMS para ser procesados y despachados.
        </p>
      </div>

      \${selectorHtml}

      <!-- Contenedor: una integracion por bloque -->
      <div style="display: flex; flex-direction: column; gap: 2rem;">

        <!-- SHOPIFY -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 1.5rem; align-items: start;">
          <div class="card" style="border:none; box-shadow: var(--shadow-md); margin:0;">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.25rem; display: flex; align-items: center; gap: 0.5rem;"><i class="ri-shopping-bag-3-line"></i> Shopify Integration</h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; background-color: \${hasShopify ? "rgba(16, 185, 129, 0.1)" : "var(--color-bg)"}; padding: 1rem; border-radius: 0.5rem; border: 1px solid \${hasShopify ? "rgba(16, 185, 129, 0.2)" : "var(--color-border)"};">
                 <div style="display: flex; align-items: center; gap: 1rem;">
                    <div>
                       <h4 style="margin: 0; font-size: 1.1rem; color: \${hasShopify ? "#10b981" : "var(--color-text-main)"};">Shopify Store</h4>
                       <p style="margin: 0; font-size: 0.875rem; color: var(--color-text-muted);">Pedidos e inventario automático.</p>
                    </div>
                 </div>
                 <div>
                    \${shopifyStatusText}
                 </div>
              </div>
              <form id="form-shopify-integration">
                <div class="form-group" style="margin-bottom: 1.25rem;">
                  <label class="form-label" style="font-weight: 600;">URL de tu tienda Shopify</label>
                  <input type="text" id="shopify-url" class="form-input" placeholder="ej. mitienda.myshopify.com" value="\${shopUrl}" \${hasShopify ? "readonly" : "required"} \${disabledAttr} style="background-color: \${hasShopify || isObserver ? "var(--color-bg)" : "var(--color-surface)"}; border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div class="form-group" style="margin-bottom: 1.25rem; \${hasShopify ? "display:none;" : ""}">
                  <label class="form-label" style="font-weight: 600;">Access Token (Admin API)</label>
                  <input type="password" id="shopify-token" class="form-input" placeholder="shpat_xxxxxxxxxxxxx" \${hasShopify ? "" : "required"} \${disabledAttr} style="background-color: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-main);">
                  <p style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.5rem;">Debe comenzar con <strong>shpat_</strong>.</p>
                </div>
                <div style="margin-top: 1.5rem; display: flex; gap: 1rem;">
                  \${shopifyButtonHtml}
                </div>
              </form>
            </div>
          </div>
          <div class="card" style="border: none; box-shadow: var(--shadow-md); background-color: var(--color-surface); margin:0;">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
                <span><i class="ri-shopping-bag-3-line" style="color: var(--color-primary);"></i></span> Guía de Integración Shopify
              </h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <ol style="margin: 0; padding-left: 1.25rem; color: var(--color-text-main); font-size: 0.95rem; display: flex; flex-direction: column; gap: 1.25rem;">
                <li>
                  <strong style="color: var(--color-text-main);">Crear Aplicación Personalizada:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">En el panel de administración de tu tienda Shopify, ve a <em>Configuración &gt; Aplicaciones y canales de ventas &gt; Desarrollar aplicaciones</em>. Haz clic en el botón <strong style="color: var(--color-text-main);">Crear una aplicación</strong> y asígnale un nombre (ej: WMS STOCKA).</p>
                </li>
                <li>
                  <strong style="color: var(--color-text-main);">Configurar Alcances de la API (Scopes):</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Haz clic en <strong style="color: var(--color-text-main);">Configurar alcances de la API del panel de control</strong>. Deberás seleccionar los permisos de <strong style="color: var(--color-text-main);">lectura y escritura</strong> (read and write) para las siguientes áreas:</p>
                  <ul style="margin: 0.5rem 0 0 0; padding-left: 1rem; color: var(--color-text-muted); font-size: 0.85rem;">
                     <li><em>Orders</em> (Pedidos)</li>
                     <li><em>Products</em> (Productos)</li>
                     <li><em>Inventory</em> (Inventario)</li>
                     <li><em>Locations</em> (Sucursales)</li>
                  </ul>
                </li>
                <li>
                  <strong style="color: var(--color-text-main);">Instalar la Aplicación:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Una vez configurados los alcances, guarda los cambios y haz clic en el botón <strong style="color: var(--color-text-main);">Instalar aplicación</strong> ubicado en la parte superior derecha.</p>
                </li>
                <li>
                  <strong style="color: var(--color-text-main);">Obtener el Access Token:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Ve a la pestaña <strong style="color: var(--color-text-main);">Credenciales de la API</strong> y revela el <em>Token de acceso de la API del panel de control</em> (este token empieza con <code style="background: var(--color-bg); padding: 0.1rem 0.3rem; border-radius: 4px;">shpat_</code>). Cópialo y pégalo en el formulario de la izquierda junto con la URL de tu tienda.</p>
                </li>
              </ol>
            </div>
          </div>
        </div>

        <!-- PARIS -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 1.5rem; align-items: start;">
          <div class="card" style="border: none; box-shadow: var(--shadow-md); margin:0;">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.25rem; display: flex; align-items: center; gap: 0.5rem;"><i class="ri-store-2-line"></i> París Marketplace (Cencosud)</h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; background-color: \${hasParis ? "rgba(16, 185, 129, 0.1)" : "var(--color-bg)"}; padding: 1rem; border-radius: 0.5rem; border: 1px solid \${hasParis ? "rgba(16, 185, 129, 0.2)" : "var(--color-border)"};">
                 <div style="display: flex; align-items: center; gap: 1rem;">
                    <div>
                       <h4 style="margin: 0; font-size: 1.1rem; color: \${hasParis ? "#10b981" : "var(--color-text-main)"};">París Store (Mirakl)</h4>
                       <p style="margin: 0; font-size: 0.875rem; color: var(--color-text-muted);">Sincronización y aceptación automática de pedidos.</p>
                    </div>
                 </div>
                 <div>
                    \${parisStatusText}
                 </div>
              </div>
              <form id="form-paris-integration">
                <div class="form-group" style="margin-bottom: 1.25rem;">
                  <label class="form-label" style="font-weight: 600;">URL de la API (Cencosud)</label>
                  <input type="text" id="paris-url" class="form-input" placeholder="ej. https://api-developers.ecomm.cencosud.com" value="\${parisUrl}" \${hasParis ? "readonly" : "required"} \${disabledAttr} style="background-color: \${hasParis || isObserver ? "var(--color-bg)" : "var(--color-surface)"}; border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div class="form-group" style="margin-bottom: 1.25rem; \${hasParis ? "display:none;" : ""}">
                  <label class="form-label" style="font-weight: 600;">API Key del Vendedor</label>
                  <input type="password" id="paris-token" class="form-input" placeholder="Ingresa tu API Key de Cencosud" \${hasParis ? "" : "required"} \${disabledAttr} style="background-color: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div style="margin-top: 1.5rem; display: flex; gap: 1rem;">
                  \${parisButtonHtml}
                </div>
              </form>
            </div>
          </div>
          <div class="card" style="border: none; box-shadow: var(--shadow-md); background-color: var(--color-surface); margin:0;">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
                <span><i class="ri-store-2-line" style="color: var(--color-primary);"></i></span> Guía de Integración París
              </h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <ol style="margin: 0; padding-left: 1.25rem; color: var(--color-text-main); font-size: 0.95rem; display: flex; flex-direction: column; gap: 1.25rem;">
                <li>
                  <strong style="color: var(--color-text-main);">Entrar al Seller Center:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Inicia sesión en tu portal de vendedor de París (Cencosud) y navega a la sección <strong style="color: var(--color-text-main);">Mi Cuenta &gt; Integraciones</strong>.</p>
                </li>
                <li>
                  <strong style="color: var(--color-text-main);">Habilitar Modo Integrador:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Activa el switch que dice <strong style="color: var(--color-text-main);">"Sí, quiero"</strong> bajo la pregunta <em>¿Quieres operar en Market Place usando un integrador?</em>.</p>
                </li>
                <li>
                  <strong style="color: var(--color-text-main);">Obtener la API Key:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Una vez activado, copia la <strong style="color: var(--color-text-main);">API Key</strong> generada. Pégala en el formulario de la izquierda.</p>
                </li>
                <li>
                  <strong style="color: var(--color-text-main);">Mapeo de SKUs:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Asegúrate de que los SKUs configurados en tus ofertas de París coincidan exactamente con los SKUs registrados en WMS STOCKA para la correcta asignación de productos en las órdenes.</p>
                </li>
              </ol>
            </div>
          </div>
        </div>

        <!-- FALABELLA -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 1.5rem; align-items: start;">
          <div class="card" style="border: none; box-shadow: var(--shadow-md); margin:0;">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.25rem; display: flex; align-items: center; gap: 0.5rem;"><i class="ri-store-2-line"></i> Falabella Marketplace</h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; background-color: \${hasFalabella ? "rgba(132, 204, 22, 0.1)" : "var(--color-bg)"}; padding: 1rem; border-radius: 0.5rem; border: 1px solid \${hasFalabella ? "rgba(132, 204, 22, 0.2)" : "var(--color-border)"};">
                 <div style="display: flex; align-items: center; gap: 1rem;">
                    <div>
                       <h4 style="margin: 0; font-size: 1.1rem; color: \${hasFalabella ? "#84cc16" : "var(--color-text-main)"};">Falabella Store (Mirakl)</h4>
                       <p style="margin: 0; font-size: 0.875rem; color: var(--color-text-muted);">Sincronización de pedidos y descarga de etiquetas PDF.</p>
                    </div>
                 </div>
                 <div>
                    \${falabellaStatusText}
                 </div>
              </div>
              <form id="form-falabella-integration">
                <div class="form-group" style="margin-bottom: 1.25rem;">
                  <label class="form-label" style="font-weight: 600;">URL de la API (Falabella)</label>
                  <input type="text" id="falabella-url" class="form-input" placeholder="ej. https://sellercenter-api.falabella.com" value="\${falabellaUrl}" \${hasFalabella ? "readonly" : "required"} \${disabledAttr} style="background-color: \${hasFalabella || isObserver ? "var(--color-bg)" : "var(--color-surface)"}; border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div class="form-group" style="margin-bottom: 1.25rem;">
                  <label class="form-label" style="font-weight: 600;">User ID / Email de Falabella</label>
                  <input type="email" id="falabella-user" class="form-input" placeholder="ej. hola@backintime.cl" value="\${falabellaUser}" \${hasFalabella ? "readonly" : "required"} \${disabledAttr} style="background-color: \${hasFalabella || isObserver ? "var(--color-bg)" : "var(--color-surface)"}; border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div class="form-group" style="margin-bottom: 1.25rem; \${hasFalabella ? "display:none;" : ""}">
                  <label class="form-label" style="font-weight: 600;">API Key del Vendedor</label>
                  <input type="password" id="falabella-token" class="form-input" placeholder="Ingresa tu API Key de Falabella" \${hasFalabella ? "" : "required"} \${disabledAttr} style="background-color: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div style="margin-top: 1.5rem; display: flex; gap: 1rem;">
                  \${falabellaButtonHtml}
                </div>
              </form>
            </div>
          </div>
          <div class="card" style="border: none; box-shadow: var(--shadow-md); background-color: var(--color-surface); margin:0;">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
                <span><i class="ri-store-2-line" style="color: var(--color-primary);"></i></span> Guía de Integración Falabella
              </h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <ol style="margin: 0; padding-left: 1.25rem; color: var(--color-text-main); font-size: 0.95rem; display: flex; flex-direction: column; gap: 1.25rem;">
                <li>
                  <strong style="color: var(--color-text-main);">Obtener Credenciales de API:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Inicia sesión en tu Seller Center de Falabella (Mirakl) y ve a la sección de configuración de perfil / API Key. Necesitarás tu <strong>User ID</strong> (email de acceso API) y la <strong>API Key</strong> correspondiente.</p>
                </li>
                <li>
                  <strong style="color: var(--color-text-main);">Configurar URL de la API:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">La URL de producción es <code style="background: var(--color-bg); padding: 0.1rem 0.3rem; border-radius: 4px;">https://sellercenter-api.falabella.com/</code>. Ingresa esta URL en el campo de la izquierda.</p>
                </li>
                <li>
                  <strong style="color: var(--color-text-main);">Mapeo de SKUs:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Asegúrate de que tus SKUs en Falabella coincidan de forma exacta con los SKUs en el WMS STOCKA para que las existencias se comprometan y descuenten automáticamente de forma correcta.</p>
                </li>
              </ol>
            </div>
          </div>
        </div>

        <!-- MERCADOLIBRE -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 1.5rem; align-items: start;">
          <div class="card" style="border: none; box-shadow: var(--shadow-md); margin:0;">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.25rem; display: flex; align-items: center; gap: 0.5rem;"><i class="ri-store-2-line"></i> MercadoLibre Marketplace</h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; background-color: \${hasMeli ? "rgba(245, 158, 11, 0.1)" : "var(--color-bg)"}; padding: 1rem; border-radius: 0.5rem; border: 1px solid \${hasMeli ? "rgba(245, 158, 11, 0.2)" : "var(--color-border)"};">
                 <div style="display: flex; align-items: center; gap: 1rem;">
                    <div>
                       <h4 style="margin: 0; font-size: 1.1rem; color: \${hasMeli ? "#f59e0b" : "var(--color-text-main)"};">MercadoLibre Store (Official API)</h4>
                       <p style="margin: 0; font-size: 0.875rem; color: var(--color-text-muted);">Sincronización de pedidos, control logístico y descarga de etiquetas.</p>
                    </div>
                 </div>
                 <div>
                    \${meliStatusText}
                 </div>
              </div>
              <form id="form-meli-integration">
                <div class="form-group" style="margin-bottom: 1.25rem;">
                  <label class="form-label" style="font-weight: 600;">Client ID (App ID)</label>
                  <input type="text" id="meli-client-id" class="form-input" placeholder="ej. 34091030018433" value="\${meliClientId || "34091030018433"}" readonly style="background-color: var(--color-bg); border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div class="form-group" style="margin-bottom: 1.25rem; \${hasMeli ? "display:none;" : ""}">
                  <label class="form-label" style="font-weight: 600;">Client Secret (Key)</label>
                  <input type="password" id="meli-client-secret" class="form-input" placeholder="Ingresa tu Client Secret" value="EJA46V6AKIWDAWG4xQ1y14pteBWR0yGl" readonly style="background-color: var(--color-bg); border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div class="form-group" style="margin-bottom: 1.25rem;">
                  <label class="form-label" style="font-weight: 600;">Redirect URI</label>
                  <input type="text" id="meli-redirect-uri" class="form-input" placeholder="ej. https://www.google.com" value="\${meliRedirectUri || "https://www.google.com"}" readonly style="background-color: var(--color-bg); border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div class="form-group" style="margin-bottom: 1.25rem; \${hasMeli ? "display:none;" : ""}">
                  <label class="form-label" style="font-weight: 600;">Código de Autorización (Authorization Code)</label>
                  <input type="password" id="meli-auth-code" class="form-input" placeholder="TG-xxxxxxxxxxxxxxxx" \${hasMeli ? "" : ""} \${disabledAttr} style="background-color: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-main);">
                  <p style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.5rem;">Requerido para nuevas integraciones (dejar vacío si migras con Refresh Token).</p>
                </div>
                <div class="form-group" style="margin-bottom: 1.25rem; \${hasMeli ? "display:none;" : ""}">
                  <label class="form-label" style="font-weight: 600;">Refresh Token Existente (Opcional - Migración)</label>
                  <input type="password" id="meli-refresh-token" class="form-input" placeholder="TG-xxxxxxxxxxxxx-xxxxxxxx" \${hasMeli ? "" : ""} \${disabledAttr} style="background-color: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-main);">
                  <p style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.5rem;">Pega aquí el refreshToken obtenido de Google Sheets para migrar tu sesión activa sin re-autorizar.</p>
                </div>
                <div style="margin-top: 1.5rem; display: flex; gap: 1rem;">
                  \${meliButtonHtml}
                </div>
              </form>
            </div>
          </div>
          <div class="card" style="border: none; box-shadow: var(--shadow-md); background-color: var(--color-surface); margin:0;">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
                <span><i class="ri-store-2-line" style="color: var(--color-primary);"></i></span> Guía de Integración MercadoLibre
              </h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <ol style="margin: 0; padding-left: 1.25rem; color: var(--color-text-main); font-size: 0.95rem; display: flex; flex-direction: column; gap: 1.25rem;">
                <li>
                  <strong style="color: var(--color-text-main);">Obtener Código de Autorización:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">
                    Haz clic en el siguiente enlace para iniciar la autorización de la aplicación de MercadoLibre:<br>
                    <a href="https://auth.mercadolibre.cl/authorization?response_type=code&client_id=34091030018433&redirect_uri=https://www.google.com" target="_blank" style="display: inline-block; background-color: var(--color-primary); color: var(--color-dark); padding: 0.5rem 1rem; border-radius: 0.375rem; font-weight: 600; text-decoration: none; margin: 0.5rem 0; font-size: 0.85rem;">👉 Obtener Código de Autorización</a><br>
                    Inicia sesión, autoriza el acceso y copia el código que aparece en la barra de direcciones después de <strong style="color: var(--color-text-main);">code=TG-xxxxx</strong> y pégalo en el formulario de la izquierda.
                  </p>
                </li>
                <li>
                  <strong style="color: var(--color-text-main);">Migración directa desde Google Sheets (Alternativa):</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">
                    Si ya tenías la cuenta conectada mediante el script de Google Sheets, deja el campo de código de autorización vacío y pega directamente tu <strong>Refresh Token Existente</strong> extraído del Apps Script.
                  </p>
                </li>
              </ol>
            </div>
          </div>
        </div>

        <!-- WOOCOMMERCE -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 1.5rem; align-items: start;">
          <div class="card" style="border: none; box-shadow: var(--shadow-md); margin:0;">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.25rem; display: flex; align-items: center; gap: 0.5rem;"><i class="ri-shopping-cart-2-line"></i> WooCommerce Integration</h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; background-color: \${hasWoo ? "rgba(150, 88, 138, 0.1)" : "var(--color-bg)"}; padding: 1rem; border-radius: 0.5rem; border: 1px solid \${hasWoo ? "rgba(150, 88, 138, 0.2)" : "var(--color-border)"};">
                 <div style="display: flex; align-items: center; gap: 1rem;">
                    <div>
                       <h4 style="margin: 0; font-size: 1.1rem; color: \${hasWoo ? "#96588a" : "var(--color-text-main)"};">WooCommerce Store</h4>
                       <p style="margin: 0; font-size: 0.875rem; color: var(--color-text-muted);">Sincronización de pedidos y productos.</p>
                    </div>
                 </div>
                 <div>
                    \${wooStatusText}
                 </div>
              </div>
              <form id="form-woo-integration">
                <div class="form-group" style="margin-bottom: 1.25rem;">
                  <label class="form-label" style="font-weight: 600;">URL de tu tienda WooCommerce</label>
                  <input type="text" id="woo-url" class="form-input" placeholder="ej. https://mitienda.cl" value="\${wooUrl}" \${hasWoo ? "readonly" : "required"} \${disabledAttr} style="background-color: \${hasWoo || isObserver ? "var(--color-bg)" : "var(--color-surface)"}; border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div class="form-group" style="margin-bottom: 1.25rem; \${hasWoo ? "display:none;" : ""}">
                  <label class="form-label" style="font-weight: 600;">Consumer Key</label>
                  <input type="password" id="woo-key" class="form-input" placeholder="ck_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value="\${wooKey}" \${hasWoo ? "readonly" : "required"} \${disabledAttr} style="background-color: \${hasWoo || isObserver ? "var(--color-bg)" : "var(--color-surface)"}; border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div class="form-group" style="margin-bottom: 1.25rem; \${hasWoo ? "display:none;" : ""}">
                  <label class="form-label" style="font-weight: 600;">Consumer Secret</label>
                  <input type="password" id="woo-secret" class="form-input" placeholder="cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value="\${wooSecret}" \${hasWoo ? "readonly" : "required"} \${disabledAttr} style="background-color: \${hasWoo || isObserver ? "var(--color-bg)" : "var(--color-surface)"}; border: 1px solid var(--color-border); color: var(--color-text-main);">
                </div>
                <div style="margin-top: 1.5rem; display: flex; gap: 1rem;">
                  \${wooButtonHtml}
                </div>
              </form>
            </div>
          </div>
          <div class="card" style="border: none; box-shadow: var(--shadow-md); background-color: var(--color-surface); margin:0;">
            <div class="card-header" style="background-color: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: 1.5rem;">
              <h3 style="margin: 0; font-size: 1.1rem; color: var(--color-text-main); display: flex; align-items: center; gap: 0.5rem;">
                <span><i class="ri-shopping-cart-2-line" style="color: var(--color-primary);"></i></span> Guía de Integración WooCommerce
              </h3>
            </div>
            <div class="card-body" style="padding: 1.5rem;">
              <ol style="margin: 0; padding-left: 1.25rem; color: var(--color-text-main); font-size: 0.95rem; display: flex; flex-direction: column; gap: 1.25rem;">
                <li>
                  <strong style="color: var(--color-text-main);">Habilitar SSL y Permalinks:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Asegúrate de que tu sitio tenga habilitado HTTPS y que los enlaces permanentes (Permalinks) no sean del tipo "Simple" en los ajustes de WordPress.</p>
                </li>
                <li>
                  <strong style="color: var(--color-text-main);">Generar Claves de la API:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">En tu panel de WordPress, ve a <em>WooCommerce &gt; Ajustes &gt; Avanzado &gt; API REST</em>. Haz clic en <strong style="color: var(--color-text-main);">Añadir clave</strong>.</p>
                </li>
                <li>
                  <strong style="color: var(--color-text-main);">Asignar Permisos:</strong>
                  <p style="margin: 0.25rem 0 0 0; color: var(--color-text-muted); font-size: 0.85rem; line-height: 1.5;">Configura el acceso con permisos de <strong style="color: var(--color-text-main);">Lectura y Escritura</strong>. Copia el <em>Consumer Key</em> y el <em>Consumer Secret</em> que se generarán y pégalos en el formulario.</p>
                </li>
              </ol>
            </div>
          </div>
        </div>

      </div>\n`;

let head = content.substring(0, startIndex);
let tail = content.substring(backtickIndex); // Starts with `;\n

let newContent = head + templateReplacement + tail;
fs.writeFileSync(file, newContent, "utf8");
console.log("Replaced successfully!");
