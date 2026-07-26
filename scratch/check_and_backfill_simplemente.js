const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const XLSX = require('xlsx');

try {
  const envContent = fs.readFileSync('.env', 'utf-8');
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const key = trimmed.substring(0, idx).trim();
      const val = trimmed.substring(idx + 1).trim();
      process.env[key] = val;
    }
  });
} catch (e) {
  console.warn('Advertencia: No se pudo leer el archivo .env:', e.message);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function getDeclarationProducts(dec) {
  if (dec.products_list && Array.isArray(dec.products_list) && dec.products_list.length > 0) {
    return dec.products_list;
  }
  if (dec.file_base64) {
    try {
      const buffer = Buffer.from(dec.file_base64, 'base64');
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      const parsed = [];
      if (rows && rows.length > 1) {
        const headerRow = rows[0];
        const skuIdx = headerRow.findIndex(h => h && h.toString().trim().toLowerCase() === 'sku');
        const nameIdx = headerRow.findIndex(h => h && h.toString().trim().toLowerCase() === 'nombre producto');
        const qtyIdx = headerRow.findIndex(h => h && h.toString().trim().toLowerCase() === 'cantidad declarada');
        
        if (skuIdx !== -1 && nameIdx !== -1 && qtyIdx !== -1) {
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (row && row[skuIdx] !== undefined) {
              const skuStr = String(row[skuIdx] || '').trim();
              if (skuStr) {
                parsed.push({
                  sku: skuStr,
                  name: String(row[nameIdx] || '').trim(),
                  qty: parseInt(row[qtyIdx] || 0)
                });
              }
            }
          }
        }
      }
      return parsed;
    } catch (e) {
      console.error('Error parsing Excel:', e);
    }
  }
  return [];
}

async function run() {
  console.log('Searching completed stock declarations for SIMPLEMENTE CAFE...');
  
  const { data: declarations, error } = await supabase
    .from('stock_declarations')
    .select('*')
    .eq('comercio', 'SIMPLEMENTE CAFE')
    .in('status', ['Recibido Conforme', 'Recibido con Incidencias']);

  if (error) {
    console.error('Error fetching declarations:', error.message);
    return;
  }

  console.log(`Found ${declarations.length} completed declarations for SIMPLEMENTE CAFE.`);

  for (const dec of declarations) {
    console.log(`\nProcessing Declaration: "${dec.title}" (ID: ${dec.id})`);
    console.log(`Status: ${dec.status}, Warehouse ID: ${dec.warehouse_id}`);

    const productsList = getDeclarationProducts(dec);
    if (productsList.length === 0) {
      console.log('No products found in products_list or base64 file.');
      continue;
    }

    console.log(`Found ${productsList.length} products to process.`);

    for (const item of productsList) {
      if (!item.sku || !item.qty) {
        console.log(`Skipping item due to missing SKU or quantity: ${JSON.stringify(item)}`);
        continue;
      }

      // Check if movements already exist for this declaration reference
      const refDoc = `Ingreso de Stock: ${dec.title}`;
      const { data: existingMovs } = await supabase
        .from('movements')
        .select('id')
        .eq('reference_doc', refDoc)
        .eq('type', 'in')
        .limit(1);

      // Check if we already processed this product in movements for this declaration
      const { data: specificMov } = await supabase
        .from('movements')
        .select('id')
        .eq('reference_doc', refDoc)
        .eq('type', 'in')
        .eq('quantity', item.qty)
        .limit(1);
      
      if (specificMov && specificMov.length > 0) {
        console.log(`Stock movement already exists for "${item.sku}" under reference "${refDoc}". Skipping to avoid duplication.`);
        continue;
      }

      console.log(`Processing item: SKU ${item.sku}, Qty: ${item.qty}`);

      // Find product by SKU and Comercio
      const { data: prod } = await supabase
        .from('products')
        .select('id')
        .eq('comercio', 'SIMPLEMENTE CAFE')
        .ilike('sku', item.sku.trim())
        .limit(1)
        .maybeSingle();

      if (!prod) {
        console.warn(`Product not found for SKU: ${item.sku} in SIMPLEMENTE CAFE!`);
        continue;
      }

      // Update or insert inventory
      const { data: inv } = await supabase
        .from('inventory')
        .select('id, quantity')
        .eq('product_id', prod.id)
        .eq('warehouse_id', dec.warehouse_id)
        .maybeSingle();

      if (inv) {
        const newQty = (inv.quantity || 0) + item.qty;
        console.log(`Updating inventory quantity from ${inv.quantity} to ${newQty}`);
        await supabase
          .from('inventory')
          .update({ quantity: newQty })
          .eq('id', inv.id);
      } else {
        console.log(`Inserting new inventory record for product_id: ${prod.id}, qty: ${item.qty}`);
        await supabase
          .from('inventory')
          .insert([{
            product_id: prod.id,
            warehouse_id: dec.warehouse_id,
            quantity: item.qty,
            committed_quantity: 0
          }]);
      }

      // Record stock movement
      console.log(`Inserting movement for product_id: ${prod.id}, qty: ${item.qty}`);
      await supabase
        .from('movements')
        .insert([{
          product_id: prod.id,
          warehouse_id: dec.warehouse_id,
          type: 'in',
          quantity: item.qty,
          reference_doc: refDoc
        }]);
    }

    // Update the database products_list column if it was empty so that it's cached
    if (!dec.products_list || dec.products_list.length === 0) {
      console.log(`Caching products list in stock_declarations row...`);
      await supabase
        .from('stock_declarations')
        .update({ products_list: productsList })
        .eq('id', dec.id);
    }
  }

  console.log('\nBackfill completed.');
}

run();
