const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
let env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      let value = match[2] || '';
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.substring(1, value.length - 1);
      }
      env[match[1]] = value.trim();
    }
  });
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  // Let's check v_comercios_volumen_actual
  const { data: curVol, error: vErr } = await supabase
    .from('v_comercios_volumen_actual')
    .select('*')
    .eq('comercio', 'B4LIFE');
  console.log('v_comercios_volumen_actual for B4LIFE:', curVol, 'err:', vErr);

  // Let's check inventory of B4LIFE:
  // p.volumen * i.quantity
  // Product volumen = 0.0029 m3
  // i.quantity = 149
  // 0.0029 * 149 = 0.4321 m3
  console.log('0.0029 * 149 =', 0.0029 * 149);

  // If volume is 0.4321 m3:
  // Base storage rate for Rango 1 (0 to 25 orders): $48,900 / m3
  // Storage cost = 0.4321 * 48900 = 21,129.69 CLP
  // If Rango 2 (26 to 100 orders): $43,500 / m3 -> 0.4321 * 43500 = 18,796.35 CLP

  // What about fixed service fee?
  // If billable orders < 50 (16 orders) and volume < 1.0 m3 (0.4321 m3):
  // fixed fee = 1.5 UF * 40884 = ~61,326 CLP
  // Pick & pack for 16 orders = 16 * 1250 = 20,000 CLP
  // Delivery types / flex / etc.?
  // Let's inspect the billing record row to see if there is any other data!
}

main().catch(console.error);
