const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf-8');
  envConfig.split(/\r?\n/).forEach(line => {
    if (!line || line.startsWith('#')) return;
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      const value = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
      process.env[key.trim()] = value;
    }
  });
}

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', '7bfc7bde-ad45-4f29-ba2e-1c36e7388b89')
    .maybeSingle();
    
  if (error) {
    console.error('Error:', error);
  } else if (data) {
    console.log('Order Details:', {
      id: data.id,
      external_order_number: data.external_order_number,
      tracking_number: data.tracking_number,
      courier: data.courier,
      estado_wms: data.estado_wms,
      has_label: !!data.label_base64,
      label_length: data.label_base64 ? data.label_base64.length : 0
    });
  } else {
    console.log('Order not found.');
  }
})();
