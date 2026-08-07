const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// Configuration
const FILE_PATH = path.join(__dirname, '..', 'downloads', 'tarifas_actuales.xlsx');
const OUTPUT_FILE = path.join(__dirname, '..', 'js', 'shipping_rates.js');

const BRACKETS = ['0-1', '1-3', '3-6', '6-9', '9-12', '12-15', '15-18'];
const COURIER_SHEETS = {
  starken: 'SKN-NOR',
  chilexpress: 'CHX-ND',
  bluexpress: 'BLX-STD',
  stocka: 'STK-SD'
};

const BRACKET_HEADERS = {
  '0-1': 'Hasta 1 Kilos',
  '1-3': 'Hasta 3 Kilos',
  '3-6': 'Hasta 6 Kilos',
  '6-9': 'Hasta 9 Kilos',
  '9-12': 'Hasta 12 Kilos',
  '12-15': 'Hasta 15 Kilos',
  '15-18': 'Hasta 18 Kilos'
};

function normalizeKey(name) {
  if (!name) return '';
  return name.toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ñ/g, 'n')
    .replace(/[^a-z\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function parseIntSafe(val) {
  if (val === undefined || val === null || val === '') return null;
  if (typeof val === 'number') return Math.round(val);
  const cleaned = val.toString().replace(/[^\d]/g, '');
  return cleaned ? parseInt(cleaned, 10) : null;
}

function main() {
  if (!fs.existsSync(FILE_PATH)) {
    console.error(`Error: El archivo '${FILE_PATH}' no existe.`);
    process.exit(1);
  }

  console.log(`Leyendo tarifas desde: ${FILE_PATH}...`);
  const wb = XLSX.readFile(FILE_PATH);

  const ratesDb = {};

  // Procesar cada courier
  Object.entries(COURIER_SHEETS).forEach(([courierId, sheetName]) => {
    if (!wb.SheetNames.includes(sheetName)) {
      console.warn(`Advertencia: No se encontró la pestaña '${sheetName}' en el Excel. Se omitirá este courier.`);
      return;
    }

    console.log(`Procesando courier ${courierId.toUpperCase()} (Pestaña: ${sheetName})...`);
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

    if (rows.length === 0) return;

    // Buscar la fila de cabecera
    let headerRowIdx = 0;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].some(cell => cell && cell.toString().toLowerCase().includes('comuna'))) {
        headerRowIdx = i;
        break;
      }
    }

    const headers = rows[headerRowIdx].map(h => h ? h.toString().trim() : '');
    
    // Encontrar índices de columnas clave
    const comunaIdx = headers.findIndex(h => h.toLowerCase() === 'comuna');
    const regionIdx = headers.findIndex(h => h.toLowerCase().includes('region') || h.toLowerCase().includes('región'));
    const localidadIdx = headers.findIndex(h => h.toLowerCase() === 'localidad');

    if (comunaIdx === -1) {
      console.error(`Error en pestaña ${sheetName}: No se encontró columna 'Comuna'.`);
      return;
    }

    // Mapear cabeceras de tramos a sus índices
    const bracketIndices = {};
    Object.entries(BRACKET_HEADERS).forEach(([bracket, headerName]) => {
      const idx = headers.findIndex(h => h.toLowerCase() === headerName.toLowerCase());
      if (idx !== -1) {
        bracketIndices[bracket] = idx;
      } else {
        console.warn(`  Aviso: No se encontró la columna '${headerName}' para el tramo '${bracket}' en '${sheetName}'`);
      }
    });

    // Procesar filas de datos
    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length <= comunaIdx) continue;

      const comunaRaw = row[comunaIdx];
      if (!comunaRaw) continue;

      const key = normalizeKey(comunaRaw);
      if (!key) continue;

      const region = regionIdx !== -1 && regionIdx < row.length ? row[regionIdx] : '';
      const transitDays = localidadIdx !== -1 && localidadIdx < row.length ? parseIntSafe(row[localidadIdx]) : null;

      // Inicializar registro de comuna si no existe
      if (!ratesDb[key]) {
        ratesDb[key] = {
          region: region ? region.toString().trim() : '',
          comuna: comunaRaw.toString().trim(),
          transit_days: {
            starken: null,
            chilexpress: null,
            bluexpress: null,
            stocka: null
          },
          rates: {}
        };
        BRACKETS.forEach(b => {
          ratesDb[key].rates[b] = {
            starken: null,
            chilexpress: null,
            bluexpress: null,
            stocka: null
          };
        });
      }

      // Guardar días de tránsito (localidad)
      if (transitDays !== null) {
        ratesDb[key].transit_days[courierId] = transitDays;
      }

      // Guardar precios de tramos
      Object.entries(bracketIndices).forEach(([bracket, idx]) => {
        if (idx < row.length) {
          const price = parseIntSafe(row[idx]);
          if (price !== null) {
            ratesDb[key].rates[bracket][courierId] = price;
          }
        }
      });
    }
  });

  // Guardar archivo JS final
  const jsContent = `// Compiled shipping rates for Chile regions by weight brackets (net rates)\n` +
    `window.shippingRates = ${JSON.stringify(ratesDb, null, 2)};\n`;

  fs.writeFileSync(OUTPUT_FILE, jsContent, 'utf-8');
  console.log(`¡Éxito! Archivo de tarifas compilado en: ${OUTPUT_FILE}`);
  console.log(`Se compilaron ${Object.keys(ratesDb).length} comunas en total.`);
}

main();
