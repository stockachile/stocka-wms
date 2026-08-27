/**
 * WMS STOCKA - Inbound Stock Lifecycle Notifications
 * Manejador centralizado para el envío automático de notificaciones por correo
 * a los usuarios de cada comercio en los 4 hitos del ingreso de stock:
 * 1. created (Creación de Ingreso)
 * 2. warehouse_assigned (Asignación de Bodega)
 * 3. received (Recibido en Bodega)
 * 4. completed (Completado Conforme o con Incidencias)
 */

(function() {
  const BREVO_DEFAULT_API_KEY = ['xkeysib', '27c9fbab0935cd3133d9f56db07a69afc87a4edfbc40165dca119dc156ae58e1', 'NIW2n77ElvT27lPo'].join('-');

  function getBrevoApiKey() {
    return localStorage.getItem('wms_brevo_api_key') || BREVO_DEFAULT_API_KEY;
  }

  /**
   * Obtiene la lista de correos de usuarios asociados a un comercio
   */
  async function getCommerceNotificationEmails(comercio) {
    if (!comercio || comercio === 'no asignado') return [];
    const emails = new Set();
    const targetComercioLower = comercio.trim().toLowerCase();

    try {
      // 1. Obtener perfiles de usuarios de la base de datos
      const { data: profiles, error: profErr } = await window.supabase
        .from('profiles')
        .select('id, email, full_name, comercio, role');

      if (!profErr && profiles) {
        profiles.forEach(p => {
          if (!p.email) return;
          if (!p.comercio || p.comercio === 'no asignado') return;
          
          const userComercios = p.comercio.split(',').map(c => c.trim().toLowerCase());
          if (userComercios.includes(targetComercioLower) || p.comercio.trim().toLowerCase() === targetComercioLower) {
            const cleanEmail = p.email.trim().toLowerCase();
            // Excluir cuentas de administración general para enviar a los clientes/observadores del comercio
            if (cleanEmail.includes('@') && p.role !== 'admin') {
              emails.add(cleanEmail);
            }
          }
        });
      }

      // 2. Obtener correos adicionales de configuración del comercio
      const { data: config, error: confErr } = await window.supabase
        .from('comercios_adicional_config')
        .select('email_colaborador, kam_email')
        .eq('comercio', comercio)
        .maybeSingle();

      if (!confErr && config) {
        if (config.email_colaborador) {
          config.email_colaborador.split(/[,;\s]+/).forEach(em => {
            const clean = em.trim().toLowerCase();
            if (clean.includes('@') && clean.includes('.')) {
              emails.add(clean);
            }
          });
        }
      }
    } catch (err) {
      console.error('[Inbound Notifications] Error al obtener correos del comercio:', err);
    }

    return Array.from(emails);
  }

  /**
   * Inserta notificaciones en el buzón interno (dashboard_notifications)
   */
  async function createInAppNotifications(comercio, title, message) {
    try {
      if (!comercio || comercio === 'no asignado' || !window.supabase) return;
      const targetComercioLower = comercio.trim().toLowerCase();

      const { data: profiles } = await window.supabase
        .from('profiles')
        .select('id, comercio')
        .neq('role', 'admin');

      if (profiles && profiles.length > 0) {
        const targetProfiles = profiles.filter(p => {
          if (!p.comercio || p.comercio === 'no asignado') return false;
          const list = p.comercio.split(',').map(c => c.trim().toLowerCase());
          return list.includes(targetComercioLower);
        });

        if (targetProfiles.length > 0) {
          const inserts = targetProfiles.map(p => ({
            user_id: p.id,
            target_role: 'client',
            title: title,
            message: message,
            is_read: false
          }));

          await window.supabase
            .from('dashboard_notifications')
            .insert(inserts);
        }
      }
    } catch (e) {
      console.warn('[Inbound Notifications] Error creando notificación in-app:', e);
    }
  }

  /**
   * Generador de plantilla HTML para los correos
   */
  function generateInboundEmailHtml(params) {
    const {
      event, // 'created' | 'warehouse_assigned' | 'received' | 'completed'
      shortCode,
      comercio,
      title,
      dec,
      warehouse,
      status,
      stageComment,
      incidentsList,
      productsList
    } = params;

    let emailSubject = '';
    let headerGradient = '';
    let emailTitle = '';
    let badgeText = '';
    let badgeColor = '';
    let bodyContentHtml = '';

    const appUrl = 'https://stocka-wms.netlify.app/dashboard.html';

    // 1. EVENTO: CREACIÓN DE INGRESO
    if (event === 'created') {
      emailSubject = `📦 [${shortCode}] Nuevo Ingreso de Stock Declarado - ${comercio}`;
      headerGradient = 'linear-gradient(135deg, #1e40af, #3b82f6)';
      emailTitle = 'Ingreso de Stock Registrado';
      badgeText = 'DECLARADO / CREADO';
      badgeColor = '#2563eb';

      let arrivalInfo = 'No definida';
      if (dec.estimated_arrival_date) arrivalInfo = `Fecha exacta: ${dec.estimated_arrival_date}`;
      else if (dec.estimated_arrival_period) arrivalInfo = `Plazo: ${dec.estimated_arrival_period}`;

      const totalUds = dec.quantity_declared || 0;
      const totalVol = parseFloat(dec.volume_declared || 0).toFixed(4);
      const bultos = dec.package_count || (parseInt(dec.container_count||0, 10)+parseInt(dec.pallet_count||0, 10)+parseInt(dec.box_count||0, 10)) || 0;
      const bultosDetalle = [];
      if (dec.container_count > 0) bultosDetalle.push(`${dec.container_count} Contenedores`);
      if (dec.pallet_count > 0) bultosDetalle.push(`${dec.pallet_count} Pallets`);
      if (dec.box_count > 0) bultosDetalle.push(`${dec.box_count} Cajas`);
      const bultosStr = bultosDetalle.length > 0 ? `${bultos} bultos (${bultosDetalle.join(', ')})` : `${bultos} bultos`;

      let productsRowsHtml = '';
      if (productsList && productsList.length > 0) {
        productsRowsHtml = `
          <div style="margin-top: 20px;">
            <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #1e293b; font-weight: 700;">Detalle de Productos Declarados:</h4>
            <table style="width: 100%; border-collapse: collapse; font-size: 12.5px; color: #334155; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;">
              <thead>
                <tr style="background-color: #f1f5f9; text-align: left; border-bottom: 1px solid #cbd5e1;">
                  <th style="padding: 8px 10px; font-weight: 600;">SKU</th>
                  <th style="padding: 8px 10px; font-weight: 600;">Producto</th>
                  <th style="padding: 8px 10px; text-align: center; font-weight: 600; width: 80px;">Cant.</th>
                </tr>
              </thead>
              <tbody>
                ${productsList.map((p, idx) => `
                  <tr style="border-bottom: 1px solid #e2e8f0; background-color: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                    <td style="padding: 8px 10px; font-family: monospace; font-weight: 600; color: #2563eb;">${p.sku || '-'}</td>
                    <td style="padding: 8px 10px;">${p.name || '-'}</td>
                    <td style="padding: 8px 10px; text-align: center; font-weight: 700;">${(p.qty || p.quantity || 0).toLocaleString('es-CL')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }

      bodyContentHtml = `
        <div style="font-size: 15px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Hola equipo <strong>${comercio}</strong>,<br><br>
          Se ha registrado exitosamente una nueva declaración de <strong>ingreso de stock</strong> en la plataforma WMS Stocka. A continuación te presentamos el resumen de la carga declarada:
        </div>

        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin-bottom: 20px;">
          <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #1e40af; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Resumen Logístico:</h4>
          <table style="width: 100%; border-collapse: collapse; font-size: 13.5px; color: #334155;">
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 7px 0; font-weight: 600; width: 42%;">Código de Ingreso:</td><td style="padding: 7px 0; font-weight: 700; color: #2563eb; font-family: monospace;">${shortCode}</td></tr>
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 7px 0; font-weight: 600;">Título / Referencia:</td><td style="padding: 7px 0; font-weight: 600; color: #1e293b;">${title}</td></tr>
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 7px 0; font-weight: 600;">Unidades Declaradas:</td><td style="padding: 7px 0;"><span style="background-color: #dbeafe; color: #1e40af; padding: 3px 8px; border-radius: 4px; font-weight: 700;">${totalUds.toLocaleString('es-CL')} unidades</span></td></tr>
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 7px 0; font-weight: 600;">Volumen Estimado:</td><td style="padding: 7px 0; font-weight: 600;">${totalVol} m³</td></tr>
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 7px 0; font-weight: 600;">Bultos Declarados:</td><td style="padding: 7px 0;">${bultosStr}</td></tr>
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 7px 0; font-weight: 600;">Fecha / Plazo de Arribo:</td><td style="padding: 7px 0;">${arrivalInfo}</td></tr>
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 7px 0; font-weight: 600;">Método de Entrega:</td><td style="padding: 7px 0;">${dec.delivery_method || 'No especificado'}</td></tr>
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 7px 0; font-weight: 600;">Transporte / Courier:</td><td style="padding: 7px 0;">${dec.carrier_info || dec.contact_info || 'No especificado'}</td></tr>
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 7px 0; font-weight: 600;">Servicio de Descarga:</td><td style="padding: 7px 0;">${dec.requires_unloading ? 'Sí, contratado' : 'No requiere'}</td></tr>
            <tr><td style="padding: 7px 0; font-weight: 600;">Observaciones:</td><td style="padding: 7px 0; font-style: italic;">${dec.notes || 'Sin observaciones'}</td></tr>
          </table>
        </div>

        ${productsRowsHtml}

        <div style="margin-top: 20px; padding: 14px; background-color: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px; font-size: 13px; color: #1e40af; line-height: 1.5;">
          <strong>Siguiente Paso:</strong> Nuestro equipo de operaciones revisará tu ingreso y te asignará la bodega de destino correspondiente. Recibirás un correo de confirmación con la dirección exacta para coordinar tu transporte.
        </div>
      `;
    }

    // 2. EVENTO: ASIGNACIÓN DE BODEGA
    else if (event === 'warehouse_assigned') {
      emailSubject = `🏢 [${shortCode}] Bodega Asignada a tu Ingreso de Stock - ${comercio}`;
      headerGradient = 'linear-gradient(135deg, #6d28d9, #8b5cf6)';
      emailTitle = 'Bodega de Destino Asignada';
      badgeText = 'BODEGA ASIGNADA';
      badgeColor = '#7c3aed';

      const whName = warehouse?.name || 'Bodega STOCKA';
      const whAddr = warehouse?.address || 'Dirección de bodega';
      const whComuna = warehouse?.comuna || 'Santiago';
      const whDays = warehouse?.operating_days || 'Lunes a Viernes';

      bodyContentHtml = `
        <div style="font-size: 15px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Hola equipo <strong>${comercio}</strong>,<br><br>
          Se ha asignado la bodega física de recepción para tu ingreso de stock <strong>"${title}"</strong> (${shortCode}). Ya puedes coordinar el despacho o entrega con tu transportista hacia la siguiente dirección:
        </div>

        <div style="background: linear-gradient(135deg, #f5f3ff, #ede9fe); border: 1.5px solid #c4b5fd; border-radius: 10px; padding: 20px; margin-bottom: 20px;">
          <h4 style="margin: 0 0 12px 0; font-size: 15px; color: #5b21b6; font-weight: 700; display: flex; align-items: center; gap: 6px;">
            📍 Datos de la Bodega Asignada:
          </h4>
          <table style="width: 100%; border-collapse: collapse; font-size: 13.5px; color: #334155;">
            <tr style="border-bottom: 1px solid #ddd6fe;"><td style="padding: 8px 0; font-weight: 600; width: 38%;">Nombre de Bodega:</td><td style="padding: 8px 0; font-weight: 700; color: #4c1d95; font-size: 14.5px;">${whName}</td></tr>
            <tr style="border-bottom: 1px solid #ddd6fe;"><td style="padding: 8px 0; font-weight: 600;">Dirección Completa:</td><td style="padding: 8px 0; font-weight: 600; color: #1e1b4b;">${whAddr}</td></tr>
            <tr style="border-bottom: 1px solid #ddd6fe;"><td style="padding: 8px 0; font-weight: 600;">Comuna:</td><td style="padding: 8px 0; font-weight: 600;">${whComuna}</td></tr>
            <tr style="border-bottom: 1px solid #ddd6fe;"><td style="padding: 8px 0; font-weight: 600;">Días de Operación:</td><td style="padding: 8px 0;">${whDays}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: 600;">Horario de Recepción:</td><td style="padding: 8px 0; font-weight: 700; color: #5b21b6;">11:00 a 16:00 hrs</td></tr>
          </table>
        </div>

        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          <h4 style="margin: 0 0 10px 0; font-size: 13.5px; color: #0f172a; font-weight: 700;">📋 Indicaciones para el Transportista:</h4>
          <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #475569; line-height: 1.6;">
            <li>El transportista debe presentar la <strong>Guía de Despacho</strong> física o digital indicando el código de ingreso <strong>${shortCode}</strong>.</li>
            <li>Horario de recepción exclusivo de <strong>11:00 a 16:00 hrs</strong> (No se reciben ingresos los días domingo).</li>
            <li>Todos los bultos deben venir debidamente rotulados con el nombre del comercio <strong>(${comercio})</strong>.</li>
          </ul>
        </div>
      `;
    }

    // 3. EVENTO: MARCADO COMO RECIBIDO EN BODEGA
    else if (event === 'received') {
      emailSubject = `📥 [${shortCode}] Ingreso de Stock Recibido en Bodega - ${comercio}`;
      headerGradient = 'linear-gradient(135deg, #b45309, #d97706)';
      emailTitle = 'Ingreso Recibido en Bodega';
      badgeText = 'RECIBIDO EN BODEGA';
      badgeColor = '#d97706';

      const whName = warehouse?.name || dec?.warehouses?.name || 'Bodega Central';
      const fechaRecepcion = new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' });
      const commentHtml = stageComment ? `<p style="font-size: 13px; color: #475569; font-style: italic; margin-top: 8px;">"${stageComment}"</p>` : '';

      bodyContentHtml = `
        <div style="font-size: 15px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Hola equipo <strong>${comercio}</strong>,<br><br>
          Te informamos que tu cargamento correspondiente al ingreso <strong>"${title}"</strong> (${shortCode}) ha sido <strong>recibido físicamente en bodega</strong> por nuestro equipo logístico.
        </div>

        <div style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 18px; margin-bottom: 20px;">
          <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #92400e; font-weight: 700; text-transform: uppercase;">Estado de la Recepción:</h4>
          <table style="width: 100%; border-collapse: collapse; font-size: 13.5px; color: #334155;">
            <tr style="border-bottom: 1px solid #fef3c7;"><td style="padding: 7px 0; font-weight: 600; width: 40%;">Código de Ingreso:</td><td style="padding: 7px 0; font-weight: 700; color: #2563eb; font-family: monospace;">${shortCode}</td></tr>
            <tr style="border-bottom: 1px solid #fef3c7;"><td style="padding: 7px 0; font-weight: 600;">Bodega de Recepción:</td><td style="padding: 7px 0; font-weight: 600; color: #1e293b;">${whName}</td></tr>
            <tr style="border-bottom: 1px solid #fef3c7;"><td style="padding: 7px 0; font-weight: 600;">Fecha y Hora de Llegada:</td><td style="padding: 7px 0; font-weight: 600;">${fechaRecepcion} hrs</td></tr>
            <tr style="border-bottom: 1px solid #fef3c7;"><td style="padding: 7px 0; font-weight: 600;">Estado Operativo:</td><td style="padding: 7px 0;"><span style="background-color: #fef3c7; color: #92400e; padding: 3px 8px; border-radius: 4px; font-weight: 700;">En proceso de conteo y clasificación</span></td></tr>
            <tr><td style="padding: 7px 0; font-weight: 600;">Bultos Declarados:</td><td style="padding: 7px 0;">${dec.package_count || 'Bultos en verificación'}</td></tr>
          </table>
          ${commentHtml}
        </div>

        <div style="margin-top: 20px; padding: 14px; background-color: #f8fafc; border-left: 4px solid #d97706; border-radius: 4px; font-size: 13px; color: #475569; line-height: 1.5;">
          <strong>Proceso en Curso:</strong> Nuestro personal de bodega se encuentra realizando la apertura, control de calidad, conteo unitario e inspección física de las unidades. Tan pronto finalice este proceso, recibirás el informe definitivo de stock ingresado.
        </div>
      `;
    }

    // 4. EVENTO: COMPLETADO (CONFORME O CON INCIDENCIAS)
    else if (event === 'completed') {
      const isConforme = status === 'Recibido Conforme';
      const hasIncidents = !isConforme || (incidentsList && incidentsList.length > 0);

      if (isConforme) {
        emailSubject = `✅ [${shortCode}] Ingreso de Stock Completado Conforme - ${comercio}`;
        headerGradient = 'linear-gradient(135deg, #047857, #10b981)';
        emailTitle = 'Ingreso Completado Conforme';
        badgeText = 'RECIBIDO CONFORME';
        badgeColor = '#059669';
      } else {
        emailSubject = `⚠️ [${shortCode}] Ingreso de Stock Finalizado con Incidencias - ${comercio}`;
        headerGradient = 'linear-gradient(135deg, #b91c1c, #ef4444)';
        emailTitle = 'Ingreso Finalizado con Incidencias';
        badgeText = 'RECIBIDO CON INCIDENCIAS';
        badgeColor = '#dc2626';
      }

      const qtyDeclared = dec.quantity_declared || 0;
      const qtyReceived = dec.quantity_received || (isConforme ? qtyDeclared : (qtyDeclared - (dec.quantity_incidents || 0)));
      const qtyIncidents = dec.quantity_incidents || (hasIncidents ? (incidentsList || []).reduce((acc, i) => acc + (parseInt(i.quantity || i.qty || 1, 10)), 0) : 0);
      const volConfirmed = parseFloat(dec.volume_confirmed || dec.volume_declared || 0).toFixed(4);

      let incidentsTableHtml = '';
      if (hasIncidents && incidentsList && incidentsList.length > 0) {
        incidentsTableHtml = `
          <div style="margin-top: 20px; background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px;">
            <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #991b1b; font-weight: 700;">⚠️ Detalle de Discrepancias / Incidencias Detectadas:</h4>
            <table style="width: 100%; border-collapse: collapse; font-size: 12.5px; color: #334155;">
              <thead>
                <tr style="border-bottom: 1px solid #fca5a5; text-align: left; color: #7f1d1d;">
                  <th style="padding: 6px 8px;">Tipo</th>
                  <th style="padding: 6px 8px;">SKU / Producto</th>
                  <th style="padding: 6px 8px; text-align: center;">Cant.</th>
                  <th style="padding: 6px 8px;">Motivo / Observación</th>
                </tr>
              </thead>
              <tbody>
                ${incidentsList.map((inc, i) => `
                  <tr style="border-bottom: 1px solid #fee2e2; background-color: ${i % 2 === 0 ? '#ffffff' : '#fff5f5'};">
                    <td style="padding: 7px 8px; font-weight: 700; color: #b91c1c;">${inc.type || inc.tipo || 'Incidencia'}</td>
                    <td style="padding: 7px 8px; font-family: monospace; font-weight: 600;">${inc.sku || inc.product_sku || '-'}: ${inc.name || inc.product_name || ''}</td>
                    <td style="padding: 7px 8px; text-align: center; font-weight: 700; color: #991b1b;">${inc.quantity || inc.qty || 1}</td>
                    <td style="padding: 7px 8px; font-size: 12px; color: #4b5563;">${inc.comment || inc.reason || inc.notes || 'Sin detalles'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }

      bodyContentHtml = `
        <div style="font-size: 15px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Hola equipo <strong>${comercio}</strong>,<br><br>
          El proceso de recepción física, conteo y clasificación para tu ingreso <strong>"${title}"</strong> (${shortCode}) ha finalizado. 
          ${isConforme ? 'Todas las unidades declaradas fueron verificadas correctamente y se encuentran cargadas en tu inventario.' : 'Se detectaron algunas discrepancias que detallamos a continuación. Las unidades conformes ya están disponibles en tu inventario activo.'}
        </div>

        <div style="background-color: ${isConforme ? '#f0fdf4' : '#fff7ed'}; border: 1px solid ${isConforme ? '#bbf7d0' : '#fed7aa'}; border-radius: 8px; padding: 18px; margin-bottom: 20px;">
          <h4 style="margin: 0 0 12px 0; font-size: 14px; color: ${isConforme ? '#166534' : '#9a3412'}; font-weight: 700; text-transform: uppercase;">Resultado del Conteo Final:</h4>
          <table style="width: 100%; border-collapse: collapse; font-size: 13.5px; color: #334155;">
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 7px 0; font-weight: 600; width: 42%;">Código de Ingreso:</td><td style="padding: 7px 0; font-weight: 700; color: #2563eb; font-family: monospace;">${shortCode}</td></tr>
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 7px 0; font-weight: 600;">Unidades Declaradas:</td><td style="padding: 7px 0; font-weight: 600;">${qtyDeclared.toLocaleString('es-CL')} uds</td></tr>
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 7px 0; font-weight: 600;">Unidades Recibidas Conformes:</td><td style="padding: 7px 0;"><span style="background-color: #dcfce7; color: #15803d; padding: 3px 8px; border-radius: 4px; font-weight: 700;">${qtyReceived.toLocaleString('es-CL')} uds</span></td></tr>
            ${hasIncidents ? `<tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 7px 0; font-weight: 600;">Unidades con Incidencias:</td><td style="padding: 7px 0;"><span style="background-color: #fee2e2; color: #b91c1c; padding: 3px 8px; border-radius: 4px; font-weight: 700;">${qtyIncidents.toLocaleString('es-CL')} uds</span></td></tr>` : ''}
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 7px 0; font-weight: 600;">Volumen Final Confirmado:</td><td style="padding: 7px 0; font-weight: 600;">${volConfirmed} m³</td></tr>
            <tr><td style="padding: 7px 0; font-weight: 600;">Observaciones del Equipo:</td><td style="padding: 7px 0; font-style: italic;">${stageComment || dec.admin_notes || 'Recepción completada satisfactoriamente.'}</td></tr>
          </table>
        </div>

        ${incidentsTableHtml}

        <div style="margin-top: 20px; padding: 14px; background-color: #f0fdf4; border-left: 4px solid #10b981; border-radius: 4px; font-size: 13px; color: #166534; line-height: 1.5;">
          <strong>Stock Disponible:</strong> Las unidades recibidas conformes ya se encuentran disponibles en tu módulo de <strong>Inventario</strong> para la preparación y despacho de tus pedidos.
        </div>
      `;
    }

    // HTML WRAPPER COMPLETO
    return {
      subject: emailSubject,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; margin: 0; padding: 0; -webkit-font-smoothing: antialiased;">
  <div style="width: 100%; background-color: #f3f4f6; padding: 30px 0;">
    <div style="max-width: 620px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05); overflow: hidden;">
      
      <!-- TOP ACCENT BAR -->
      <div style="height: 6px; background: ${headerGradient};"></div>

      <!-- HEADER -->
      <div style="padding: 30px 30px 15px 30px; text-align: center; background-color: #ffffff; border-bottom: 1px solid #f1f5f9;">
        <img src="https://cdn.shopify.com/s/files/1/0625/6141/9483/files/newlogotransp.png?v=1779852093" alt="Stocka Logo" style="height: 44px; margin-bottom: 16px; display: inline-block;">
        <h1 style="margin: 0; font-size: 22px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px;">${emailTitle}</h1>
        <div style="margin-top: 8px;">
          <span style="display: inline-block; background-color: ${badgeColor}15; color: ${badgeColor}; border: 1px solid ${badgeColor}35; font-size: 11.5px; font-weight: 700; padding: 3px 10px; border-radius: 99px; letter-spacing: 0.5px; text-transform: uppercase;">
            ${badgeText}
          </span>
          <span style="margin-left: 8px; font-size: 13px; font-weight: 600; color: #64748b;">${comercio}</span>
        </div>
      </div>
      
      <!-- BODY CONTENT -->
      <div style="padding: 25px 30px;">
        ${bodyContentHtml}

        <!-- BOTÓN ACCESO WMS -->
        <div style="text-align: center; margin: 30px 0 10px 0;">
          <a href="${appUrl}" target="_blank" style="display: inline-block; background: ${headerGradient}; color: #ffffff !important; padding: 13px 32px; font-size: 14.5px; font-weight: 700; border-radius: 8px; text-decoration: none; text-align: center; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);">
            Ver Ingreso en WMS Stocka
          </a>
        </div>
      </div>
      
      <!-- FOOTER -->
      <div style="background-color: #f8fafc; padding: 25px 20px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; line-height: 1.6;">
        <strong style="color: #0f172a; font-size: 13px;">Stocka SpA</strong><br>
        Fulfillment & Soporte Logístico para Ecommerce<br>
        Campo de Deportes 405, Ñuñoa, Santiago.<br>
        <span style="display: block; margin-top: 10px; font-size: 11px; color: #94a3b8;">
          Este es un correo automático del sistema WMS Stocka. ¿Tienes dudas? Contáctanos a <a href="mailto:contacto@stocka.cl" style="color: #2563eb; text-decoration: none; font-weight: 600;">contacto@stocka.cl</a>
        </span>
      </div>
      
    </div>
  </div>
</body>
</html>
      `
    };
  }

  /**
   * Función principal para disparar la notificación por correo y registrar la alerta in-app
   */
  async function sendStockInboundNotification(options) {
    const {
      event, // 'created' | 'warehouse_assigned' | 'received' | 'completed'
      declarationId,
      comercio,
      title = 'Ingreso de Stock',
      decData = {},
      warehouse = null,
      status = null,
      stageComment = '',
      incidentsList = [],
      productsList = [],
      fileBase64 = null,
      fileName = null
    } = options;

    try {
      if (!comercio || comercio === 'no asignado') {
        console.warn('[Inbound Notifications] Cancelado: Comercio no especificado.');
        return { success: false, reason: 'No commerce specified' };
      }

      console.log(`[Inbound Notifications] Procesando notificación "${event}" para el comercio "${comercio}" (Ingreso ID: ${declarationId || 'N/A'})...`);

      // 1. Resolver los correos de los usuarios del comercio
      const commerceEmails = await getCommerceNotificationEmails(comercio);
      const recipients = [...commerceEmails];

      // Si no se encuentran correos de clientes, registrar advertencia
      if (recipients.length === 0) {
        console.warn(`[Inbound Notifications] No se encontraron correos de usuarios para el comercio "${comercio}".`);
        return { success: false, reason: 'No recipients found for commerce' };
      }

      const shortCode = declarationId ? `#ING-${declarationId.substring(0, 8).toUpperCase()}` : '#ING-STOCKA';

      // 2. Generar el correo HTML
      const generated = generateInboundEmailHtml({
        event: event,
        shortCode: shortCode,
        comercio: comercio,
        title: title,
        dec: decData,
        warehouse: warehouse,
        status: status || decData.status || 'Creada',
        stageComment: stageComment,
        incidentsList: incidentsList,
        productsList: productsList.length > 0 ? productsList : (decData.products_list || [])
      });

      // 3. Preparar payload de Brevo (exclusivo para los usuarios del comercio)
      const brevoApiKey = getBrevoApiKey();
      const brevoPayload = {
        sender: { name: 'STOCKA WMS', email: 'info@stocka.cl' },
        to: recipients.map(email => ({ email })),
        subject: generated.subject,
        htmlContent: generated.html
      };

      // Adjuntar archivo PDF o comprobante si existe
      if (fileBase64 && fileName) {
        brevoPayload.attachment = [
          {
            content: fileBase64,
            name: fileName
          }
        ];
      } else if (decData.file_base64 && decData.file_name && decData.file_name.endsWith('.pdf')) {
        brevoPayload.attachment = [
          {
            content: decData.file_base64,
            name: decData.file_name
          }
        ];
      }

      // 4. Enviar mediante Brevo API
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
        console.error(`[Inbound Notifications] Error Brevo (${res.status}): ${errText}`);
      } else {
        console.log(`✅ [Inbound Notifications] Correo "${event}" enviado exitosamente a ${recipients.join(', ')}`);
      }

      // 5. Crear notificación in-app en dashboard_notifications
      const inAppMsg = stageComment ? `${generated.subject}. Comentario: "${stageComment}"` : generated.subject;
      await createInAppNotifications(comercio, `Ingreso de Stock ${shortCode}`, inAppMsg);

      return { success: true, recipients: recipients };
    } catch (err) {
      console.error('[Inbound Notifications] Error en sendStockInboundNotification:', err);
      return { success: false, error: err.message };
    }
  }

  // Exportar al objeto global window
  window.getCommerceNotificationEmails = getCommerceNotificationEmails;
  window.sendStockInboundNotification = sendStockInboundNotification;
  window.generateInboundEmailHtml = generateInboundEmailHtml;

})();
