const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envConfig = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8');
const envVars = {};
envConfig.split(/\r?\n/).forEach(l => {
  const [k, ...v] = l.split('=');
  if (k && v.length) envVars[k.trim()] = v.join('=').trim().replace(/^['"]|['"]$/g, '');
});
const supabase = createClient(envVars.SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY);

function extractSla(order) {
  const rawMeli = order.raw_meli_data;
  if (!rawMeli) return null;
  const sh = rawMeli.shipping || (Array.isArray(rawMeli.orders) ? rawMeli.orders[0]?.shipping : null);
  const expDate = rawMeli.expected_date 
    || sh?.expected_date
    || sh?.shipping_option?.estimated_delivery_limit?.date 
    || sh?.shipping_option?.estimated_delivery_time?.date;

  if (!expDate) return null;

  try {
    const d = new Date(expDate);
    if (isNaN(d.getTime())) return null;

    const formatter = new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
    const parts = formatter.formatToParts(d);
    const day = parts.find(p => p.type === 'day')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const year = parts.find(p => p.type === 'year')?.value;
    let hour = parts.find(p => p.type === 'hour')?.value;
    let minute = parts.find(p => p.type === 'minute')?.value;

    const payBefore = sh?.shipping_option?.estimated_delivery_time?.pay_before;
    if (payBefore && (hour === '00' || !hour)) {
      try {
        const pbDate = new Date(payBefore);
        if (!isNaN(pbDate.getTime())) {
          const pbParts = formatter.formatToParts(pbDate);
          const pbHour = pbParts.find(p => p.type === 'hour')?.value;
          const pbMin = pbParts.find(p => p.type === 'minute')?.value;
          if (pbHour && pbMin && (pbHour !== '00' || pbMin !== '00')) {
            hour = pbHour;
            minute = pbMin;
          }
        }
      } catch (e) {}
    }

    if (day && month && year) {
      let baseMethod = (order.shipping_method || '').replace(/[\s\-]*(?:SLA|L[íi]mite)[\s:].*$/i, '').trim();
      const logType = sh?.logistic_type;
      if (logType === 'self_service') {
        baseMethod = 'FLEX ⚡';
      } else if (logType === 'cross_docking') {
        baseMethod = 'Colecta 🚚';
      } else if (logType === 'xd_drop_off' || logType === 'drop_off') {
        baseMethod = 'CENTRO DE ENVIOS 🏪';
      } else if (!baseMethod) {
        baseMethod = 'CENTRO DE ENVIOS 🏪';
      }

      const formattedTime = (hour && minute && (hour !== '00' || minute !== '00')) ? `${hour}:${minute}` : (payBefore ? '12:00' : '23:59');
      const newMethod = `${baseMethod} - SLA: ${day}/${month}/${year} ${formattedTime}`;

      return {
        newMethod,
        date: `${day}-${month}-${year}`,
        time: formattedTime
      };
    }
  } catch (e) {}
  return null;
}

async function fixOrders() {
  console.log('🚀 Actualizando pedidos MercadoLibre sin SLA en la base de datos...');

  const since = new Date();
  since.setDate(since.getDate() - 14);

  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, external_order_number, comercio, shipping_method, raw_meli_data')
    .eq('external_platform', 'MercadoLibre')
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error al consultar pedidos:', error);
    return;
  }

  console.log(`Evaluando ${orders.length} pedidos de los últimos 14 días...`);

  let updatedCount = 0;
  for (const o of orders) {
    const hasSla = /SLA/i.test(o.shipping_method || '');
    if (!hasSla) {
      const res = extractSla(o);
      if (res) {
        const { error: upErr } = await supabase
          .from('orders')
          .update({ shipping_method: res.newMethod })
          .eq('id', o.id);

        if (!upErr) {
          updatedCount++;
          console.log(`✅ [${o.external_order_number} (${o.comercio})]: "${o.shipping_method}" -> "${res.newMethod}"`);
        } else {
          console.error(`❌ Error actualizando ${o.external_order_number}:`, upErr.message);
        }
      }
    }
  }

  console.log(`\n🎉 Finalizado: ${updatedCount} pedidos actualizados con SLA y horario de corte.`);
}

fixOrders();
