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

const corruptedOrders = [
  { id: '2bf167d1-465b-47a3-aae0-2c4a5c7eb994', num: 'MSE2000015405956759', com: 'MAESE' },
  { id: 'a82482fc-0c33-40dd-a8f9-3362ba701821', num: 'MME2000015414781871', com: 'MMEDD' },
  { id: 'd4cb4bed-d7e7-4f13-b571-3b9eb30a5897', num: 'MME2000015413019651', com: 'MMEDD' },
  { id: 'cc4dce38-052e-4121-8650-75d7ab6f89ed', num: 'MSE2000015404113841', com: 'MAESE' },
  { id: 'ae9aac8c-f1f1-428c-b2bb-1effa2c16e75', num: 'MSE2000015423645405', com: 'MAESE' },
  { id: 'ff239858-d7ad-4262-98c4-82a38bed3b85', num: 'MSE2000015408779673', com: 'MAESE' },
  { id: '5169c239-0600-46f4-b9f3-310eb119be9d', num: 'MME2000015416869813', com: 'MMEDD' },
  { id: '5be2eadc-51f3-4946-8615-5fbf00c50dc1', num: '2000015402652205', com: 'HIT GAMING' },
  { id: 'b0064362-30af-4cb2-98f9-d7fe02b0730d', num: '2000015398837571', com: 'HIT GAMING' },
  { id: '1a2594e4-efac-4809-8d5d-a0e7be347ccb', num: '2000015394409461', com: 'CHC COSMETIC' },
  { id: '0571055a-17bc-4f22-a81e-398a965e82c2', num: '2000015416163999', com: 'CHC COSMETIC' },
  { id: '5e4e69b4-e66c-431e-9e78-4bd7b3eeea60', num: 'MSE2000015408443279', com: 'MAESE' }
];

async function check() {
  const tokenCache = {};
  for (const o of corruptedOrders) {
    if (!tokenCache[o.com]) {
      const { data: int } = await supabase.from('merchant_integrations').select('*').eq('comercio', o.com).eq('platform', 'MercadoLibre').single();
      const tokenUrl = 'https://api.mercadolibre.com/oauth/token';
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: int.client_id,
        client_secret: int.client_secret,
        refresh_token: int.refresh_token
      });
      const res = await fetch(tokenUrl, { method: 'POST', body: params });
      const d = await res.json();
      tokenCache[o.com] = d.access_token;
    }
    const token = tokenCache[o.com];
    const cleanId = o.num.replace(/\D/g, '');

    // check pack
    const pRes = await fetch(`https://api.mercadolibre.com/packs/${cleanId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (pRes.ok) {
      const pack = await pRes.json();
      const shipId = pack.shipment?.id;
      let logType = 'unknown';
      let expectedDate = null;
      if (shipId) {
        const sRes = await fetch(`https://api.mercadolibre.com/shipments/${shipId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (sRes.ok) {
          const sd = await sRes.json();
          logType = sd.logistic_type;
        }
        const slaRes = await fetch(`https://api.mercadolibre.com/shipments/${shipId}/sla`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (slaRes.ok) {
          const slad = await slaRes.json();
          expectedDate = slad.expected_date;
        }
      }
      console.log(`PACK ${o.num} (${o.com}): orders=${pack.orders?.length}, shipId=${shipId}, logType=${logType}, sla=${expectedDate}`);
    } else {
      // check order
      const ordRes = await fetch(`https://api.mercadolibre.com/orders/${cleanId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (ordRes.ok) {
        const ord = await ordRes.json();
        const shipId = ord.shipping?.id;
        let logType = 'unknown';
        if (shipId) {
          const sRes = await fetch(`https://api.mercadolibre.com/shipments/${shipId}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (sRes.ok) {
            const sd = await sRes.json();
            logType = sd.logistic_type;
          }
        }
        console.log(`ORDER ${o.num} (${o.com}): shipId=${shipId}, logType=${logType}`);
      } else {
        console.log(`NOT FOUND: ${o.num}`);
      }
    }
  }
}

check();
