const fs = require('fs');
const path = require('path');
const XLSX = require('c:/Users/felip/Desktop/WMS STOCKA/node_modules/xlsx');

// Inline .env file parser
const envPath = path.join('c:', 'Users', 'felip', 'Desktop', 'WMS STOCKA', '.env');
const env = {};
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      env[key] = val;
    }
  });
}

// Initialize Supabase Client
const { createClient } = require('c:/Users/felip/Desktop/WMS STOCKA/node_modules/@supabase/supabase-js');
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase credentials in .env file.");
  process.exit(1);
}
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const dirPath = path.join('c:', 'Users', 'felip', 'Desktop', 'WMS STOCKA', 'historico enviame');
const outputPath = path.join('c:', 'Users', 'felip', 'Desktop', 'WMS STOCKA', 'js', 'historical_enviame_data.json');

const monthMapping = {
  'enero': '01',
  'febrero': '02',
  'marzo': '03',
  'abril': '04',
  'mayo': '05',
  'junio': '06',
  'julio': '07',
  'agosto': '08',
  'septiembre': '09',
  'octubre': '10',
  'noviembre': '11',
  'diciembre': '12'
};

const cols = {
  company_id: ['company_id', 'companyid', 'id_compania', 'company_identifier'],
  id: ['id', 'enviame_id', 'shipment_id', 'id_envio'],
  imported_id: ['imported_id', 'importedid', 'id_pedido', 'order_id', 'referencia'],
  tracking: ['tracking_number', 'tracking', 'numero_tracking', 'carrier_tracking_number'],
  carrier: ['carrier', 'courier', 'transportista'],
  status: ['status', 'estado', 'status_name'],
  comune: ['com_destino', 'comuna_destino', 'comuna', 'county', 'commune'],
  peso: ['peso informado por carrier', 'peso_informado_por_carrier', 'peso', 'weight', 'peso_carrier'],
  neto: ['precio', 'valor_neto', 'neto', 'price', 'net_price']
};

function getRowValue(row, possibleKeys) {
  for (let key of possibleKeys) {
    if (row[key] !== undefined && row[key] !== null) {
      return row[key];
    }
    const lowerKey = key.toLowerCase();
    for (let k in row) {
      if (k.toLowerCase() === lowerKey && row[k] !== undefined && row[k] !== null) {
        return row[k];
      }
    }
  }
  return null;
}

async function run() {
  try {
    console.log("Fetching configurations from Supabase database...");
    const { data: configs, error: configsErr } = await supabase
      .from('comercios_adicional_config')
      .select('comercio, enviame_id');
    if (configsErr) throw configsErr;
    
    const { data: mappings, error: mappingsErr } = await supabase
      .from('billing_mappings')
      .select('comercio_nombre, billing_name');
    if (mappingsErr) throw mappingsErr;
    
    const enviameIdToCommerceMap = {};
    const commerceToBillingGroup = {};
    
    (configs || []).forEach(c => {
      commerceToBillingGroup[c.comercio] = c.comercio;
      if (c.enviame_id) {
        const ids = c.enviame_id.split(',').map(id => id.trim().replace(/^ID\s*:?\s*/i, ''));
        ids.forEach(id => {
          if (id) enviameIdToCommerceMap[id] = c.comercio;
        });
      }
    });
    
    (mappings || []).forEach(m => {
      commerceToBillingGroup[m.comercio_nombre] = m.billing_name;
    });

    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.xlsx'));
    console.log(`Found ${files.length} Excel files to process.`);
    
    const globalHistory = [];
    const commerceHistory = {}; // Keyed by billingGroup

    files.forEach(file => {
      const match = file.match(/Enviame\s+([a-zA-ZáéíóúÁÉÍÓÚ]+)\s+(\d{4})\.xlsx/i);
      if (!match) return;
      
      const spanishMonth = match[1].toLowerCase();
      const year = match[2];
      const monthNum = monthMapping[spanishMonth];
      if (!monthNum) return;
      
      const periodKey = `${year}-${monthNum}`;
      const periodLabel = `${spanishMonth.charAt(0).toUpperCase() + spanishMonth.slice(1)} ${year}`;
      
      console.log(`Processing period ${periodKey} from file: ${file}`);
      
      const filePath = path.join(dirPath, file);
      const workbook = XLSX.readFile(filePath);
      
      let sheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('detall'));
      if (!sheetName) {
        let maxRows = 0;
        workbook.SheetNames.forEach(n => {
          const s = workbook.Sheets[n];
          const rowsCount = XLSX.utils.sheet_to_json(s).length;
          if (rowsCount > maxRows) {
            maxRows = rowsCount;
            sheetName = n;
          }
        });
      }
      if (!sheetName) sheetName = workbook.SheetNames[0];
      
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      
      // Global and commerce-specific shipments arrays for this file
      const fileShipments = [];
      const commerceShipments = {}; // Keyed by billingGroup
      
      rows.forEach(row => {
        const rawCompId = getRowValue(row, cols.company_id);
        const compId = rawCompId ? rawCompId.toString().trim() : null;
        if (!compId) return;
        
        const rawPeso = getRowValue(row, cols.peso);
        const peso = rawPeso ? parseFloat(rawPeso) : 0.0;
        
        const rawNeto = getRowValue(row, cols.neto);
        const neto = rawNeto ? Math.round(Number(rawNeto)) : 0;
        
        const resolvedCommerce = enviameIdToCommerceMap[compId] || (compId === '8326' ? 'Stocka' : `ID_${compId}`);
        const billingGroup = commerceToBillingGroup[resolvedCommerce] || resolvedCommerce;
        
        const shipment = {
          carrier: getRowValue(row, cols.carrier) || 'Desconocido',
          commune: getRowValue(row, cols.comune) || 'Sin especificar',
          peso,
          neto
        };
        
        fileShipments.push(shipment);
        
        if (!commerceShipments[billingGroup]) {
          commerceShipments[billingGroup] = [];
        }
        commerceShipments[billingGroup].push(shipment);
      });
      
      // 1. Calculate and push Global metrics
      if (fileShipments.length > 0) {
        const totalShipments = fileShipments.length;
        const totalNet = fileShipments.reduce((sum, s) => sum + s.neto, 0);
        const totalWeight = fileShipments.reduce((sum, s) => sum + s.peso, 0);
        const avgWeight = totalWeight / totalShipments;
        const avgRate = totalNet / totalShipments;
        
        const courierGroups = {};
        fileShipments.forEach(s => {
          if (!courierGroups[s.carrier]) courierGroups[s.carrier] = { count: 0, totalWeight: 0, totalNet: 0 };
          courierGroups[s.carrier].count++;
          courierGroups[s.carrier].totalWeight += s.peso;
          courierGroups[s.carrier].totalNet += s.neto;
        });
        const couriers = Object.entries(courierGroups).map(([name, c]) => ({
          name, count: c.count,
          percentage: ((c.count / totalShipments) * 100).toFixed(1),
          avgWeight: c.totalWeight / c.count,
          avgRate: c.totalNet / c.count
        })).sort((a, b) => b.count - a.count);
        
        const destGroups = {};
        fileShipments.forEach(s => {
          if (!destGroups[s.commune]) destGroups[s.commune] = 0;
          destGroups[s.commune]++;
        });
        const destinations = Object.entries(destGroups).map(([name, count]) => ({
          name, count,
          percentage: ((count / totalShipments) * 100).toFixed(1)
        })).sort((a, b) => b.count - a.count).slice(0, 10);
        
        globalHistory.push({
          periodKey, periodLabel, totalShipments, totalNet, avgWeight, avgRate,
          preferredCourier: couriers[0] ? couriers[0].name : 'N/A',
          couriers, destinations
        });
      }
      
      // 2. Calculate and push Commerce-specific metrics
      Object.entries(commerceShipments).forEach(([groupName, shipmentsList]) => {
        if (shipmentsList.length === 0) return;
        
        const totalShipments = shipmentsList.length;
        const totalNet = shipmentsList.reduce((sum, s) => sum + s.neto, 0);
        const totalWeight = shipmentsList.reduce((sum, s) => sum + s.peso, 0);
        const avgWeight = totalWeight / totalShipments;
        const avgRate = totalNet / totalShipments;
        
        const courierGroups = {};
        shipmentsList.forEach(s => {
          if (!courierGroups[s.carrier]) courierGroups[s.carrier] = { count: 0, totalWeight: 0, totalNet: 0 };
          courierGroups[s.carrier].count++;
          courierGroups[s.carrier].totalWeight += s.peso;
          courierGroups[s.carrier].totalNet += s.neto;
        });
        const couriers = Object.entries(courierGroups).map(([name, c]) => ({
          name, count: c.count,
          percentage: ((c.count / totalShipments) * 100).toFixed(1),
          avgWeight: c.totalWeight / c.count,
          avgRate: c.totalNet / c.count
        })).sort((a, b) => b.count - a.count);
        
        const destGroups = {};
        shipmentsList.forEach(s => {
          if (!destGroups[s.commune]) destGroups[s.commune] = 0;
          destGroups[s.commune]++;
        });
        const destinations = Object.entries(destGroups).map(([name, count]) => ({
          name, count,
          percentage: ((count / totalShipments) * 100).toFixed(1)
        })).sort((a, b) => b.count - a.count).slice(0, 10);
        
        if (!commerceHistory[groupName]) {
          commerceHistory[groupName] = [];
        }
        commerceHistory[groupName].push({
          periodKey, periodLabel, totalShipments, totalNet, avgWeight, avgRate,
          preferredCourier: couriers[0] ? couriers[0].name : 'N/A',
          couriers, destinations
        });
      });
    });
    
    // Sort all arrays chronologically
    globalHistory.sort((a, b) => a.periodKey.localeCompare(b.periodKey));
    Object.keys(commerceHistory).forEach(g => {
      commerceHistory[g].sort((a, b) => a.periodKey.localeCompare(b.periodKey));
    });
    
    const output = {
      global: globalHistory,
      byCommerce: commerceHistory
    };
    
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
    console.log(`\nSUCCESS: Grouped historical data compiled successfully to: ${outputPath}`);
    console.log(`Compiled global periods: ${globalHistory.map(g => g.periodKey).join(', ')}`);
    console.log(`Compiled commerce groups: ${Object.keys(commerceHistory).join(', ')}`);
    
  } catch (err) {
    console.error("Compilation error:", err);
  }
}

run();
