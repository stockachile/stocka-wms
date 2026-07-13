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

async function run() {
  console.log('--- RECENT MELI WEBHOOKS ---');
  const { data: meliWebhooks, error: mErr } = await supabase
    .from('meli_webhooks')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
  
  if (mErr) console.error('Error fetching meli_webhooks:', mErr);
  else {
    meliWebhooks.forEach(w => {
      console.log(`[meli_webhooks] At: ${w.created_at} | Resource: ${w.resource} | User ID: ${w.user_id} | Raw: ${JSON.stringify(w.raw_data || w)}`);
    });
  }

  console.log('\n--- RECENT WEBHOOK LOGS ---');
  const { data: webhookLogs, error: wErr } = await supabase
    .from('webhook_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (wErr) console.error('Error fetching webhook_logs:', wErr);
  else {
    webhookLogs.forEach(w => {
      console.log(`[webhook_logs] At: ${w.created_at} | Topic: ${w.topic || w.platform} | Detail: ${w.error || w.message || JSON.stringify(w)}`);
    });
  }
}

run();
