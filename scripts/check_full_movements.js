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

const ids = [
  '0af59166-a750-4401-aac5-80078c025c00',
  '962a173a-737b-4da7-b8dd-1beac33e2fe4',
  'bb214b1d-2f4d-4b2a-8706-d34e87103c9f',
  '194d0224-8067-4900-9062-7272d475a02b',
  '28772480-4e8a-46b9-b62b-87a72508d667',
  '4e262990-e255-4a85-b850-706fec9666bf',
  '16d33473-96ae-4558-930a-bddba69af292',
  'f18664e4-b067-4280-b29d-d5be2504e4b8',
  '376ff109-3353-4f26-9040-98e96410859c',
  '3918a113-efb3-4920-9e7a-09791397bd5a',
  '57d00b44-a2f6-46b8-ae6a-2492133e9008',
  '979f3b00-93bc-42b1-8193-6a0f631a7cfa'
];

async function check() {
  const { data, error } = await supabase
    .from('movements')
    .select('id, order_id, reference_doc, quantity')
    .in('order_id', ids);

  console.log('Movements found:', data?.length || 0);
  if (data?.length) console.log(data);
}

check();
