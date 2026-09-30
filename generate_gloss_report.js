const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const XLSX = require('xlsx');

const envContent = fs.readFileSync('c:/Users/felip/Desktop/WMS STOCKA/.env', 'utf-8');
const env = {};
envContent.split(/\r?\n/).forEach(line => {
  const parts = line.split('=');
  if (parts.length >= 2) {
    env[parts[0].trim()] = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
  }
});

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const PICKER_URL = 'https://hpomymtecmxujbjxqawu.supabase.co';
const PICKER_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ';
const picker = createClient(PICKER_URL, PICKER_KEY);

function formatDateTimeCL(isoOrDateStr) {
  if (!isoOrDateStr) return null;
  // If already in DD/MM/YYYY HH:mm or similar
  if (typeof isoOrDateStr === 'string' && /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test(isoOrDateStr)) {
    return isoOrDateStr;
  }
  // If in YYYY-MM-DD HH:mm:ss format
  if (typeof isoOrDateStr === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(isoOrDateStr)) {
    const [d, t] = isoOrDateStr.split(' ');
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y} ${t.substring(0, 5)}`;
  }

  const d = new Date(isoOrDateStr);
  if (isNaN(d.getTime())) return String(isoOrDateStr);

  const parts = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(d);

  const map = {};
  parts.forEach(p => { map[p.type] = p.value; });
  return `${map.day}/${map.month}/${map.year} ${map.hour}:${map.minute}`;
}

function formatDateCL(isoOrDateStr) {
  const dt = formatDateTimeCL(isoOrDateStr);
  return dt ? dt.split(' ')[0] : null;
}

function formatTimeCL(isoOrDateStr) {
  const dt = formatDateTimeCL(isoOrDateStr);
  return dt ? dt.split(' ')[1] : null;
}

async function generateReport() {
  console.log('Fetching orders...');
  const { data: orders, error } = await supabase
    .from('orders')
    .select(`
      id,
      external_order_number,
      created_at,
      status,
      estado_wms,
      operador,
      courier,
      categoria_entrega,
      shipping_method,
      tracking_number,
      tracking_url,
      customer_name,
      shipping_city,
      raw_lightdata_data,
      raw_shopify_data
    `)
    .ilike('comercio', '%gloss%')
    .gte('created_at', '2026-09-01T00:00:00Z')
    .lte('created_at', '2026-09-30T23:59:59Z')
    .order('created_at', { ascending: true });

  if (error) {
    console.error(error);
    return;
  }
  console.log(`Loaded ${orders.length} orders.`);

  const orderNumbers = orders.map(o => o.external_order_number).filter(Boolean);
  const trackings = orders.map(o => o.tracking_number).filter(t => t && t !== 'No informado');

  // 1. Fetch Picker history_logs
  console.log('Fetching picker logs...');
  let pickerLogs = [];
  for (let i = 0; i < orderNumbers.length; i += 100) {
    const chunk = orderNumbers.slice(i, i + 100);
    const variants = [];
    chunk.forEach(num => {
      variants.push(num);
      variants.push('#' + num.replace(/^#/, ''));
      variants.push(num.replace(/^#/, ''));
    });
    const { data: logs } = await picker
      .from('history_logs')
      .select('pedido, estado, fecha, hora, created_at, picker, scanned_label, courier')
      .in('pedido', variants)
      .in('estado', ['Completado', 'COMPLETADO', 'Completado-Asistido', 'Listo para retiro', 'LISTO PARA RETIRO'])
      .order('created_at', { ascending: false });
    if (logs) pickerLogs = pickerLogs.concat(logs);
  }

  // 2. Fetch sucursal_pickups
  console.log('Fetching sucursal pickups...');
  let sucursalPickups = [];
  for (let i = 0; i < orderNumbers.length; i += 100) {
    const chunk = orderNumbers.slice(i, i + 100);
    const variants = [];
    chunk.forEach(num => {
      variants.push(num);
      variants.push('#' + num.replace(/^#/, ''));
      variants.push(num.replace(/^#/, ''));
    });
    const { data: picks } = await picker
      .from('sucursal_pickups')
      .select('*')
      .in('pedido', variants);
    if (picks) sucursalPickups = sucursalPickups.concat(picks);
  }

  // 3. Fetch envios_unificados
  console.log('Fetching envios_unificados...');
  let unifiedList = [];
  for (let i = 0; i < orderNumbers.length; i += 100) {
    const chunk = orderNumbers.slice(i, i + 100);
    const { data: u1 } = await supabase
      .from('envios_unificados')
      .select('*')
      .in('pedido_referencia', chunk);
    if (u1) unifiedList = unifiedList.concat(u1);
  }
  for (let i = 0; i < trackings.length; i += 100) {
    const chunk = trackings.slice(i, i + 100);
    const { data: u2 } = await supabase
      .from('envios_unificados')
      .select('*')
      .in('tracking', chunk);
    if (u2) unifiedList = unifiedList.concat(u2);
  }

  // Build report rows
  const reportRows = [];

  for (const o of orders) {
    const orderNo = o.external_order_number || `ORD-${o.id}`;
    const cleanNum = orderNo.replace(/^#/, '');

    // 1. Fecha y hora del pedido
    // Prefer raw_shopify_data.created_at if available, else o.created_at
    const orderCreatedAt = o.raw_shopify_data?.created_at || o.created_at;
    const fechaPedido = formatDateCL(orderCreatedAt);
    const horaPedido = formatTimeCL(orderCreatedAt);

    // 2. Fecha y hora de preparación
    // Check Picker history_logs first (matching completed)
    const pLog = pickerLogs.find(l => (l.pedido || '').replace(/^#/, '') === cleanNum);
    const sPick = sucursalPickups.find(p => (p.pedido || '').replace(/^#/, '') === cleanNum);

    let fechaPrep = null;
    let horaPrep = null;
    let fechaHoraPrepStr = 'Pendiente de preparación';

    if (pLog) {
      if (pLog.fecha && pLog.hora) {
        // pLog.fecha is YYYY-MM-DD, pLog.hora is HH:mm:ss in local time
        const [y, m, d] = pLog.fecha.split('-');
        fechaPrep = `${d}/${m}/${y}`;
        horaPrep = pLog.hora.substring(0, 5);
        fechaHoraPrepStr = `${fechaPrep} ${horaPrep}`;
      } else if (pLog.created_at) {
        fechaPrep = formatDateCL(pLog.created_at);
        horaPrep = formatTimeCL(pLog.created_at);
        fechaHoraPrepStr = `${fechaPrep} ${horaPrep}`;
      }
    } else if (sPick?.fecha_preparacion) {
      // sPick.fecha_preparacion is YYYY-MM-DD
      const [y, m, d] = sPick.fecha_preparacion.split('-');
      fechaPrep = `${d}/${m}/${y}`;
      horaPrep = formatTimeCL(sPick.created_at) || '12:00';
      fechaHoraPrepStr = `${fechaPrep} ${horaPrep}`;
    } else {
      if (o.estado_wms === 'Cancelado') {
        fechaHoraPrepStr = 'Cancelado antes de preparar';
      } else if (o.estado_wms === 'Incidencia') {
        fechaHoraPrepStr = 'En Incidencia';
      } else if (o.estado_wms === 'En procesamiento' || o.estado_wms === 'En preparación') {
        fechaHoraPrepStr = 'En proceso de preparación';
      }
    }

    // 3. Operador courier o Retiro
    const isRetiro = o.categoria_entrega === 'RETIRO' ||
      (o.operador || '').toUpperCase().includes('RETIRO') ||
      (o.shipping_method || '').toLowerCase().includes('retiro') ||
      (sPick != null);

    let courierOperador = '';
    if (isRetiro) {
      courierOperador = 'Retiro en Sucursal (Punto Stocka Ñuñoa)';
    } else {
      const c = (o.operador || o.courier || '').toUpperCase();
      if (c.includes('STARKEN')) courierOperador = 'Starken';
      else if (c.includes('CHILEXPRESS')) courierOperador = 'Chilexpress';
      else if (c.includes('BLUEXPRESS')) courierOperador = 'Blue Express';
      else if (c.includes('RECIBELO')) courierOperador = 'Recíbelo';
      else if (c.includes('STOCKA X') || c.includes('OPTIROUTE')) courierOperador = 'Stocka X (Optiroute)';
      else if (c.includes('CARRIER') || c.includes('ALPHA') || o.raw_lightdata_data) courierOperador = 'Alpha Group (Carrier Externo)';
      else courierOperador = o.operador || o.courier || 'Por asignar';
    }

    // 4. Fecha y hora de entrega
    let fechaHoraEntregaStr = '';
    let estadoEntrega = '';

    if (isRetiro) {
      if (sPick?.estado_pedido === 'ENTREGADO' || sPick?.fecha_retiro) {
        estadoEntrega = 'Entregado (Retirado en sucursal)';
        if (sPick.fecha_retiro && sPick.hora_retiro) {
          const [y, m, d] = sPick.fecha_retiro.split('-');
          fechaHoraEntregaStr = `${d}/${m}/${y} ${sPick.hora_retiro.substring(0, 5)}`;
        } else if (sPick.fecha_retiro) {
          const [y, m, d] = sPick.fecha_retiro.split('-');
          fechaHoraEntregaStr = `${d}/${m}/${y}`;
        } else {
          fechaHoraEntregaStr = formatDateTimeCL(sPick.updated_at);
        }
      } else if (sPick?.estado_pedido === 'CANCELADO' || o.estado_wms === 'Cancelado') {
        estadoEntrega = 'Cancelado';
        fechaHoraEntregaStr = 'Pedido Cancelado';
      } else {
        estadoEntrega = sPick?.estado_pedido || 'Listo para retiro';
        fechaHoraEntregaStr = 'Pendiente de retiro por cliente';
      }
    } else {
      // Find matches in unified
      const uMatches = unifiedList.filter(u => 
        (u.pedido_referencia && u.pedido_referencia.replace(/^#/, '') === cleanNum) ||
        (u.tracking && o.tracking_number && u.tracking === o.tracking_number)
      );

      // Prioritize delivered status
      let deliveredU = uMatches.find(u => 
        (u.status || '').toLowerCase().includes('entregad') || 
        u.status === 'DELIVERED'
      );

      // If lightdata on order directly
      let ldDelivered = false;
      let ldTime = null;
      if (o.raw_lightdata_data) {
        const ld = o.raw_lightdata_data;
        if (ld.status === 'Entregado' || (Array.isArray(ld.raw_data) && ld.raw_data[23] === 'Entregado')) {
          ldDelivered = true;
          if (Array.isArray(ld.raw_data) && ld.raw_data[25]) {
            ldTime = ld.raw_data[25]; // 'DD/MM/YYYY HH:mm'
          } else {
            ldTime = formatDateTimeCL(ld.fecha_actualizacion_lightdata);
          }
        }
      }

      if (deliveredU) {
        estadoEntrega = 'Entregado';
        // Extract precise timestamp from raw_data if possible
        if (deliveredU.source_table === 'enviame_shipments' && deliveredU.raw_data?.status?.created_at) {
          fechaHoraEntregaStr = formatDateTimeCL(deliveredU.raw_data.status.created_at);
        } else if (deliveredU.source_table === 'optiroute_orders' && (deliveredU.raw_data?.completed_at || deliveredU.raw_data?.waypoint?.completed_at)) {
          fechaHoraEntregaStr = formatDateTimeCL(deliveredU.raw_data.completed_at || deliveredU.raw_data.waypoint.completed_at);
        } else if (deliveredU.source_table === 'lightdata_envios' && Array.isArray(deliveredU.raw_data) && deliveredU.raw_data[25]) {
          fechaHoraEntregaStr = deliveredU.raw_data[25];
        } else {
          fechaHoraEntregaStr = formatDateTimeCL(deliveredU.updated_at);
        }
        // Refine courier if unified has more specific info
        if (deliveredU.courier) {
          const c = deliveredU.courier.toUpperCase();
          if (c.includes('STARKEN')) courierOperador = 'Starken';
          else if (c.includes('CHILEXPRESS')) courierOperador = 'Chilexpress';
          else if (c.includes('BLUEXPRESS')) courierOperador = 'Blue Express';
          else if (c.includes('RECIBELO')) courierOperador = 'Recíbelo';
          else if (c.includes('STOCKA X')) courierOperador = 'Stocka X (Optiroute)';
          else if (c.includes('CARRIER') || c.includes('ALPHA')) courierOperador = 'Alpha Group (Carrier Externo)';
        }
      } else if (ldDelivered) {
        estadoEntrega = 'Entregado';
        fechaHoraEntregaStr = ldTime;
        courierOperador = 'Alpha Group (Carrier Externo)';
      } else if (o.estado_wms === 'Cancelado') {
        estadoEntrega = 'Cancelado';
        fechaHoraEntregaStr = 'Pedido Cancelado';
      } else if (o.estado_wms === 'Incidencia') {
        estadoEntrega = 'Incidencia';
        fechaHoraEntregaStr = 'En Incidencia';
      } else if (uMatches.length > 0) {
        const firstU = uMatches[0];
        estadoEntrega = firstU.status;
        fechaHoraEntregaStr = `En tránsito (${firstU.status})`;
        if (firstU.courier) {
          const c = firstU.courier.toUpperCase();
          if (c.includes('STARKEN')) courierOperador = 'Starken';
          else if (c.includes('CHILEXPRESS')) courierOperador = 'Chilexpress';
          else if (c.includes('BLUEXPRESS')) courierOperador = 'Blue Express';
          else if (c.includes('RECIBELO')) courierOperador = 'Recíbelo';
          else if (c.includes('STOCKA X')) courierOperador = 'Stocka X (Optiroute)';
          else if (c.includes('CARRIER') || c.includes('ALPHA')) courierOperador = 'Alpha Group (Carrier Externo)';
        }
      } else {
        estadoEntrega = o.estado_wms;
        fechaHoraEntregaStr = `Pendiente (${o.estado_wms})`;
      }
    }

    reportRows.push({
      pedido: orderNo,
      fecha_pedido: fechaPedido,
      hora_pedido: horaPedido,
      fecha_hora_preparacion: fechaHoraPrepStr,
      fecha_hora_entrega: fechaHoraEntregaStr,
      operador_courier: courierOperador,
      estado_entrega: estadoEntrega,
      cliente: o.customer_name || '',
      comuna: o.shipping_city || '',
      tracking: o.tracking_number || ''
    });
  }

  console.log(`Generated ${reportRows.length} rows.`);

  // Write Excel file
  const wb = XLSX.utils.book_new();
  const wsData = [
    [
      'Pedido',
      'Fecha Pedido',
      'Hora Pedido',
      'Fecha y Hora de Preparación',
      'Fecha y Hora de Entrega',
      'Operador Courier / Retiro',
      'Estado de Entrega',
      'Destinatario',
      'Comuna / Ciudad',
      'Tracking / N° Guía'
    ],
    ...reportRows.map(r => [
      r.pedido,
      r.fecha_pedido,
      r.hora_pedido,
      r.fecha_hora_preparacion,
      r.fecha_hora_entrega,
      r.operador_courier,
      r.estado_entrega,
      r.cliente,
      r.comuna,
      r.tracking
    ])
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  // Auto-width
  ws['!cols'] = [
    { wch: 18 },
    { wch: 14 },
    { wch: 12 },
    { wch: 26 },
    { wch: 26 },
    { wch: 32 },
    { wch: 28 },
    { wch: 25 },
    { wch: 20 },
    { wch: 22 }
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Pedidos Joyas Gloss');
  
  const excelPath = 'c:/Users/felip/Desktop/WMS STOCKA/Informe_Pedidos_Joyas_Gloss_Septiembre_2026.xlsx';
  XLSX.writeFile(wb, excelPath);
  console.log(`Excel report saved to: ${excelPath}`);

  // Also save a JSON copy for summary analysis
  fs.writeFileSync('c:/Users/felip/Desktop/WMS STOCKA/report_summary.json', JSON.stringify(reportRows, null, 2));
  console.log('JSON summary saved.');
}

generateReport();
