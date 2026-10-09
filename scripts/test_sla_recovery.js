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

function getSlaFromRawMeli(order) {
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
      return {
        date: `${day}-${month}-${year}`,
        time: (hour && minute) ? `${hour}:${minute}` : ''
      };
    }
  } catch (e) {}
  return null;
}

async function test() {
  const { data: orders } = await supabase
    .from('orders')
    .select('id, external_order_number, comercio, shipping_method, raw_meli_data')
    .eq('external_platform', 'MercadoLibre')
    .gte('created_at', '2026-10-07T00:00:00Z');

  console.log(`Testing SLA extraction on ${orders.length} orders:`);
  let recoveredCount = 0;
  for (const o of orders) {
    const hasSlaInMethod = /SLA/i.test(o.shipping_method || '');
    if (!hasSlaInMethod) {
      const sla = getSlaFromRawMeli(o);
      if (sla) {
        recoveredCount++;
        console.log(`Recovered: ${o.external_order_number} (${o.comercio}) -> Date: ${sla.date}, Time: ${sla.time}`);
      } else {
        console.log(`FAILED to recover: ${o.external_order_number} (${o.comercio})`);
      }
    }
  }
  console.log(`\nTotal recovered: ${recoveredCount}`);
}

test();
