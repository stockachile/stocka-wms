const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envPath = 'c:/Users/felip/Desktop/WMS STOCKA/.env';
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
      process.env[key] = val;
    }
  });
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function searchVinaShipmentsByRef() {
  try {
    const { data: shipments, error } = await supabase
      .from('enviame_shipments')
      .select('id, tracking_number, order_id, courier, recipient_address, commune, seller_name, status, recipient_name, created_at')
      .or('recipient_address.ilike.%viña%,recipient_address.ilike.%vina%,commune.ilike.%viña%,commune.ilike.%vina%');

    if (error) throw error;

    console.log(`Buscando referencias sospechosas entre los ${shipments.length} envíos a Viña del Mar...`);
    
    // Filtrar referencias que empiecen con # o sean puramente numéricas cortas de 3-4 dígitos
    const suspected = shipments.filter(s => {
      const ref = (s.order_id || '').trim();
      // Match #100x o 100x
      const matchesNumPattern = /^#?10[0-9]{2}$/.test(ref);
      const matchesPom = ref.toLowerCase().includes('pom');
      return matchesNumPattern || matchesPom;
    });

    console.log(`Se encontraron ${suspected.length} envíos sospechosos:`);
    suspected.forEach(s => {
      console.log(`- ID: ${s.id}, Ref/Order_id: ${s.order_id}, Seller: ${s.seller_name}, Cliente: ${s.recipient_name}, Dirección: ${s.recipient_address}, Estado: ${s.status}, Fecha: ${s.created_at}`);
    });

  } catch (err) {
    console.error(err);
  }
}

searchVinaShipmentsByRef();
