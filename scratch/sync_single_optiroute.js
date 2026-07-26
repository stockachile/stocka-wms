const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Cargar archivo .env
const envPath = path.join(__dirname, '..', '.env');
let env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split(/\r?\n/).forEach(line => {
    if (!line || line.startsWith('#')) return;
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      env[key.trim()] = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
    }
  });
}

const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function getOptirouteStatusName(statusNum) {
  const s = Number(statusNum);
  switch (s) {
    case -4: return 'DELETED';
    case -3: return 'TEMPORARY';
    case -2: return 'IMPORTED';
    case -1: return 'CANCELLED';
    case 0: return 'REVIEWING';
    case 1: return 'SCHEDULED';
    case 6: return 'ONROUTE';
    case 2: return 'ONGOING';
    case 4: return 'ARRIVED';
    case 3: return 'DELIVERED';
    case 5: return 'SKIPPED';
    default: return 'UNKNOWN';
  }
}

async function syncSingle() {
  console.log('🔄 Sincronizando pedido Optiroute 4707266...');

  try {
    // 1. Obtener integración
    const { data: integrations } = await supabase
      .from('merchant_integrations')
      .select('*')
      .eq('platform', 'Optiroute')
      .eq('is_active', true);
    
    if (!integrations || integrations.length === 0) {
      console.error('No active Optiroute integration found.');
      return;
    }

    const integration = integrations[0];

    // 2. Fetch detailed order
    const res = await fetch(`https://app.optiroute.cl/api/v1/integration-service-requests/4707266/`, {
      method: 'GET',
      headers: {
        'Authorization': `Token ${integration.access_token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) {
      throw new Error(`API failed: ${res.status} ${res.statusText}`);
    }

    const detailedOrder = await res.json();

    const email = detailedOrder.customer?.customer?.email || detailedOrder.customer?.email || null;
    const addressStr = detailedOrder.address?.full_address || detailedOrder.address?.excel_address || detailedOrder.address?.short_address || null;
    const commune = detailedOrder.address?.commune_string || null;

    const upsertPayload = {
      id: '4707266',
      referencia: 'TSS1062',
      empresa_comercio_proveedor: integration.comercio || 'STOCKA',
      tracking: (detailedOrder.tracking || '').trim() || null,
      tracking_url: (detailedOrder.tracking_url || '').trim() || null,
      courier: 'STOCKA X',
      status: getOptirouteStatusName(detailedOrder.status),
      created_at: detailedOrder.created_at,
      updated_at: detailedOrder.updated_at,
      servicio_tipo_envio: 'SAME DAY/24 HRS',
      nombre_destinatario: detailedOrder.customer?.name || null,
      telefono_destino: detailedOrder.customer?.phone_number || null,
      email_cliente_destino: email,
      direccion_destino: addressStr,
      complemento_destino: [detailedOrder.address?.apartment_number, detailedOrder.address?.address_more_info].filter(Boolean).join(', ') || null,
      comuna_destino: commune,
      raw_data: detailedOrder
    };

    console.log('Upsert payload:', {
      tracking: upsertPayload.tracking,
      tracking_url: upsertPayload.tracking_url,
      status: upsertPayload.status
    });

    const { error: upsertErr } = await supabase
      .from('optiroute_orders')
      .upsert(upsertPayload, { onConflict: 'id' });

    if (upsertErr) throw upsertErr;
    console.log('✅ Sincronizado exitosamente.');

  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

syncSingle();
