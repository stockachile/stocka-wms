const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const envConfig = fs.readFileSync('.env', 'utf-8');
const env = {};
envConfig.split(/\r?\n/).forEach(line => {
  if (!line || line.startsWith('#')) return;
  const [k, ...v] = line.split('=');
  if (k && v.length) env[k.trim()] = v.join('=').trim().replace(/^['"]|['"]$/g, '');
});

const supabase = createClient(env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co', env.SUPABASE_SERVICE_ROLE_KEY);

function formatFullName(firstName, lastName) {
  const f = (firstName || '').trim();
  const l = (lastName || '').trim();
  if (f && l) {
    if (f.toLowerCase().endsWith(l.toLowerCase())) {
      return f;
    }
    return `${f} ${l}`;
  }
  return f || l || '';
}

const isValidName = (str) => {
  if (!str) return false;
  const s = String(str).trim();
  if (!s || s.includes('@') || s.toLowerCase() === 'no registrado' || s.toLowerCase() === 'cliente jumpseller') {
    return false;
  }
  return true;
};

function getJumpsellerCustomerName(o) {
  if (!o) return null;
  const shippingFullName = formatFullName(
    o.shipping_address?.name || o.shipping_address?.first_name,
    o.shipping_address?.surname || o.shipping_address?.last_name
  );
  const billingFullName = formatFullName(
    o.billing_address?.name || o.billing_address?.first_name,
    o.billing_address?.surname || o.billing_address?.last_name
  );
  const customerFullName = (
    o.customer?.fullname ||
    formatFullName(
      o.customer?.name || o.customer?.first_name,
      o.customer?.surname || o.customer?.last_name
    )
  ).trim();

  const validShip = isValidName(shippingFullName) ? shippingFullName : '';
  const validBill = isValidName(billingFullName) ? billingFullName : '';
  const validCust = isValidName(customerFullName) ? customerFullName : '';

  let finalCustomerName = null;
  if (validShip) {
    if (!validShip.includes(' ')) {
      if (validCust && validCust.includes(' ') && validCust.toLowerCase().startsWith(validShip.toLowerCase())) {
        finalCustomerName = validCust;
      } else if (validBill && validBill.includes(' ') && validBill.toLowerCase().startsWith(validShip.toLowerCase())) {
        finalCustomerName = validBill;
      } else {
        finalCustomerName = validShip;
      }
    } else {
      finalCustomerName = validShip;
    }
  } else if (validBill) {
    if (!validBill.includes(' ') && validCust && validCust.includes(' ') && validCust.toLowerCase().startsWith(validBill.toLowerCase())) {
      finalCustomerName = validCust;
    } else {
      finalCustomerName = validBill;
    }
  } else if (validCust) {
    finalCustomerName = validCust;
  }
  return finalCustomerName;
}

async function migrate() {
  console.log('🔄 Iniciando actualización retroactiva de apellidos en pedidos Jumpseller...');

  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, external_order_number, customer_name, raw_jumpseller_data')
    .eq('external_platform', 'Jumpseller')
    .not('raw_jumpseller_data', 'is', null);

  if (error) {
    console.error('❌ Error al consultar pedidos:', error);
    return;
  }

  let updatedCount = 0;
  let skippedCount = 0;

  for (const ord of orders) {
    const raw = ord.raw_jumpseller_data;
    if (raw && (raw.wms_shipping_edited === true || raw.wms_custom_edited === true)) {
      // No sobrescribir si fue editado manualmente en WMS
      skippedCount++;
      continue;
    }

    const newName = getJumpsellerCustomerName(raw);
    if (newName && newName !== ord.customer_name) {
      const { error: updateErr } = await supabase
        .from('orders')
        .update({ customer_name: newName })
        .eq('id', ord.id);

      if (updateErr) {
        console.error(`❌ Error actualizando ${ord.external_order_number}:`, updateErr.message);
      } else {
        console.log(`✅ [${ord.external_order_number}]: "${ord.customer_name}" -> "${newName}"`);
        updatedCount++;
      }
    } else {
      skippedCount++;
    }
  }

  console.log(`\n🎉 Migración completada: ${updatedCount} pedidos actualizados con apellido, ${skippedCount} sin cambios.`);

  // Verificar orden específica del usuario
  const { data: targetOrder } = await supabase
    .from('orders')
    .select('id, external_order_number, customer_name, customer_email, customer_phone')
    .ilike('external_order_number', '%1046%')
    .eq('external_platform', 'Jumpseller')
    .maybeSingle();

  if (targetOrder) {
    console.log('\n🔍 Verificación de pedido MSE#JS-1046:', targetOrder);
  }
}

migrate();
