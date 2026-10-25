const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const [k, ...v] = line.trim().split('=');
  if (k && v.length) env[k] = v.join('=').replace(/^['"]|['"]$/g, '');
});

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const COMERCIO = 'SMILE FOR PETS';
const COMERCIO_ID = '5238292e-b55c-4a0c-b0c0-2e74aa479e4c';
const NUNOA_ID = '973da888-8a63-4790-a08f-919e1af41a93';
const LAREINA_ID = '414605cb-f926-43d2-8bd2-d9509f7b458a';
const CENTRAL_ID = 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09';

async function runRegularization() {
  console.log('================================================================');
  console.log('EJECUTANDO REGULARIZACIÓN INTEGRAL: SMILE FOR PETS');
  console.log('================================================================\n');

  // 1. Obtener productos de SMILE FOR PETS
  const { data: products, error: prodErr } = await supabase
    .from('products')
    .select('id, sku, name, is_virtual')
    .eq('comercio', COMERCIO);
  if (prodErr) throw prodErr;

  const prodBySku = new Map();
  const prodById = new Map();
  products.forEach(p => {
    prodBySku.set(p.sku, p);
    prodById.set(p.id, p);
  });

  // 2. Configurar regla de corte para canal "Manual" en comercios_adicional_config
  console.log('1. Actualizando regla de corte en comercios_adicional_config...');
  const newInicioPedidos = {
    Shopify: {
      incluir: false,
      external_order_number: 'SFP#3576'
    },
    Manual: {
      incluir: false,
      external_order_number: 'SFPFAC516'
    }
  };
  const { error: cfgErr } = await supabase
    .from('comercios_adicional_config')
    .update({ inventario_inicio_pedidos: newInicioPedidos })
    .eq('comercio_id', COMERCIO_ID);
  if (cfgErr) throw cfgErr;
  console.log('   ✔ inventario_inicio_pedidos actualizado con corte Manual: SFPFAC516 (incluir: false).');

  // 3. Reversar facturas manuales previas al corte (SFPFAC518-519 del 01/09 y SFPFAC516 del 02/09)
  console.log('\n2. Reversando facturas manuales previas al corte (SFPFAC518-519 y SFPFAC516)...');
  const preCutoffOrders = [
    { id: '8d719498-e958-4293-b6f7-a09ab8dec05b', num: 'SFPFAC518-519' },
    { id: '1c8611a8-ee62-4f58-867b-6abb48b29d04', num: 'SFPFAC516' }
  ];

  for (const po of preCutoffOrders) {
    const { data: delMovs, error: delErr } = await supabase
      .from('movements')
      .delete()
      .eq('order_id', po.id)
      .select('id, product_id, quantity, reference_doc');
    if (delErr) throw delErr;
    console.log(`   ✔ Eliminados ${delMovs.length} movimientos de Kardex de ${po.num}:`);
    delMovs.forEach(m => {
      const p = prodById.get(m.product_id);
      console.log(`      - MovID ${m.id}: SKU ${p?.sku} x ${m.quantity} (${m.reference_doc})`);
    });

    const { error: updPoErr } = await supabase
      .from('orders')
      .update({ stock_descontado: false, stock_descontado_at: null })
      .eq('id', po.id);
    if (updPoErr) throw updPoErr;
    console.log(`   ✔ Orden ${po.num} marcada con stock_descontado = false.`);
  }

  // 4. Reasignar los 8 pedidos que cayeron en CDD La Reina hacia Matriz Ñuñoa
  console.log('\n3. Reasignando los 8 pedidos desde CDD La Reina hacia Matriz Ñuñoa...');
  const laReinaOrders = [
    { id: '146a57ad-26ef-4732-b0cc-a9ccfdbfd7e2', num: 'SFPFAC538' },
    { id: '958493a0-ff85-47dd-97a1-311e1839fd5a', num: 'SFPFAC540' },
    { id: '88f0251c-e9ff-43d4-a54f-e575a9a89363', num: 'SFPFAC542' },
    { id: '49e63d2c-8a46-45c7-813b-53897222d130', num: 'FAC544' },
    { id: '1205ef4e-6f6a-4f91-91f9-18352a113e13', num: 'SFPFAC548' },
    { id: '59364c82-914a-473b-8f67-e479f77147f1', num: 'SFPFAC550-560' },
    { id: '6b9e7a8b-ea26-4512-bf84-05d548d4da59', num: 'SFPFAC567' },
    { id: 'bd133110-46a8-48ef-8299-f687bf673c00', num: 'SFPFAC571' }
  ];

  for (const lo of laReinaOrders) {
    // Asegurar que la orden tenga status = 'despachado', estado_wms = 'Despachado', stock_descontado = true
    // y si era SFPFAC571 con Sucursal La Reina, pasarla a Sucursal Ñuñoa
    const updatePayload = {
      status: 'despachado',
      estado_wms: 'Despachado',
      stock_descontado: true
    };
    if (lo.num === 'SFPFAC571') {
      updatePayload.sucursal_pickeo = 'Sucursal Ñuñoa';
    }
    const { error: oUpdErr } = await supabase
      .from('orders')
      .update(updatePayload)
      .eq('id', lo.id);
    if (oUpdErr) throw oUpdErr;

    // Actualizar order_items que estaban en CDD La Reina -> Matriz Ñuñoa
    const { data: updItems, error: oiErr } = await supabase
      .from('order_items')
      .update({ warehouse_id: NUNOA_ID })
      .eq('order_id', lo.id)
      .eq('warehouse_id', LAREINA_ID)
      .select('id, product_id, quantity');
    if (oiErr) throw oiErr;

    // Actualizar movements (out) que estaban en CDD La Reina -> Matriz Ñuñoa
    const { data: updMovs, error: mErr } = await supabase
      .from('movements')
      .update({ warehouse_id: NUNOA_ID })
      .eq('order_id', lo.id)
      .eq('warehouse_id', LAREINA_ID)
      .select('id, product_id, quantity, reference_doc');
    if (mErr) throw mErr;

    console.log(`   ✔ ${lo.num}: ${updItems.length} order_items y ${updMovs.length} movimientos reasignados a Matriz Ñuñoa.`);
  }

  // También normalizar el flag stock_descontado = true en las 8 facturas de septiembre que ya tenían movimiento en Kardex
  const septOrders = [
    '17454627-903a-4901-a72f-b77e7a6f20d7', // FAC524
    'fa88ec92-f26e-41d6-93d4-94be9bc1f548', // FAC526
    '22b2369c-f494-4ef0-ad96-96abdc1736b1', // FAC528
    '54be3ff9-8499-4a12-8b9f-73aa3d5f07d7', // FAC521
    '600c2243-4ef5-4b11-8892-19e4590efcb6', // FAC529
    '753ff605-417f-4bb5-be35-38c39d4cb212', // FAC530
    '43a6d62e-f3fc-4dc3-8cc0-845ff74d3363', // FAC522
    'e6a73ca5-e1a6-47e7-8102-81c9fb15fb73'  // FAC523
  ];
  await supabase
    .from('orders')
    .update({ stock_descontado: true, status: 'despachado' })
    .in('id', septOrders);
  console.log('   ✔ Normalizado stock_descontado = true en las 8 facturas de septiembre.');

  // Purgar cualquier movimiento espurio si algún trigger de edición se disparó al mover order_items
  const prodIds = products.map(p => p.id);
  const { data: spuriousMovs } = await supabase
    .from('movements')
    .delete()
    .in('product_id', prodIds)
    .or('reference_doc.ilike.%Cambiado de bodega%,reference_doc.ilike.%en edición%')
    .select('id, reference_doc');
  if (spuriousMovs && spuriousMovs.length > 0) {
    console.log(`   ✔ Eliminados ${spuriousMovs.length} movimientos espurios de edición.`);
  }

  // 5. Corregir traslados internos entre CDD La Reina y Matriz Ñuñoa
  console.log('\n4. Ajustando traslados internos entre CDD La Reina y Matriz Ñuñoa...');

  // 5.1 SP012 (09/10/2026): 400 -> 288 (12 cajas máster de 24)
  const sp012MovIds = [
    'f945840e-6e94-472d-b3ed-3cb5cb519837', // OUT CDD La Reina
    '2fe28c52-cf8e-4c15-899d-f87ea7692826'  // IN Matriz Ñuñoa
  ];
  const { error: spErr } = await supabase
    .from('movements')
    .update({ quantity: 288 })
    .in('id', sp012MovIds);
  if (spErr) throw spErr;
  console.log('   ✔ Traslado SP012 (09/10/2026) ajustado de 400 a 288 un. (12 cajas máster).');

  // 5.2 PD010 (09/10/2026): 200 -> 125
  const pd010MovIds = [
    'd5c54ded-19ff-4436-84e4-6a5d9b1bfe9c', // OUT CDD La Reina
    '9b07c81b-3aae-4811-b3ea-7ab72233947a'  // IN Matriz Ñuñoa
  ];
  const { error: pd010Err } = await supabase
    .from('movements')
    .update({ quantity: 125 })
    .in('id', pd010MovIds);
  if (pd010Err) throw pd010Err;
  console.log('   ✔ Traslado PD010 (09/10/2026) ajustado de 200 a 125 un.');

  // 5.3 Registrar traslado físico de abastecimiento desde CDD La Reina a Matriz Ñuñoa para pedidos B2B (GD005: 908, GD009: 376, PD001: 240)
  const b2bTransfers = [
    { sku: 'GD005', qty: 908, date: '2026-10-20T18:00:00+00:00' },
    { sku: 'GD009', qty: 376, date: '2026-10-20T18:00:01+00:00' },
    { sku: 'PD001', qty: 240, date: '2026-10-20T18:00:02+00:00' }
  ];

  for (const t of b2bTransfers) {
    const prod = prodBySku.get(t.sku);
    if (!prod) continue;
    const refOut = 'Traslado a Matriz Ñuñoa (Ñuñoa). Nota: Regularización abastecimiento pedidos B2B';
    const refIn = 'Traslado desde CDD La Reina (La Reina). Nota: Regularización abastecimiento pedidos B2B';

    // Verificar que no se haya insertado previamente
    const { data: existingT } = await supabase
      .from('movements')
      .select('id')
      .eq('product_id', prod.id)
      .eq('reference_doc', refOut);

    if (!existingT || existingT.length === 0) {
      const { error: insTErr } = await supabase
        .from('movements')
        .insert([
          {
            product_id: prod.id,
            warehouse_id: LAREINA_ID,
            type: 'out',
            quantity: t.qty,
            date: t.date,
            reference_doc: refOut
          },
          {
            product_id: prod.id,
            warehouse_id: NUNOA_ID,
            type: 'in',
            quantity: t.qty,
            date: t.date,
            reference_doc: refIn
          }
        ]);
      if (insTErr) throw insTErr;
      console.log(`   ✔ Registrado traslado de abastecimiento B2B (CDD La Reina -> Matriz Ñuñoa): ${t.sku} x ${t.qty} un.`);
    }
  }

  // 6. Recalcular y cuadrar al 100% la tabla inventory (quantity, reserved_quantity, committed_quantity)
  console.log('\n5. Sincronizando niveles de inventario (inventory) con Kardex (movements) y pedidos activos...');

  const { data: allMovs, error: allMovErr } = await supabase
    .from('movements')
    .select('id, product_id, warehouse_id, type, quantity')
    .in('product_id', prodIds);
  if (allMovErr) throw allMovErr;

  const { data: allOrders, error: allOrdErr } = await supabase
    .from('orders')
    .select('id, external_order_number, estado_wms, external_platform, created_at')
    .eq('comercio', COMERCIO);
  if (allOrdErr) throw allOrdErr;

  const { data: allOrderItems, error: allOiErr } = await supabase
    .from('order_items')
    .select('id, order_id, product_id, warehouse_id, quantity')
    .in('product_id', prodIds);
  if (allOiErr) throw allOiErr;

  // Mapear órdenes activas post-corte (> 2026-09-02T20:28:00Z)
  const cutoffTime = new Date('2026-09-02T20:28:00+00:00').getTime();
  const activeOrdersById = new Map();
  allOrders.forEach(o => {
    const t = new Date(o.created_at).getTime();
    if (t > cutoffTime && o.external_order_number !== 'SFP#3576' && o.external_order_number !== 'SFPFAC516') {
      activeOrdersById.set(o.id, o);
    }
  });

  // Calcular Kardex neto por (product_id, warehouse_id)
  const kardexMap = new Map();
  allMovs.forEach(m => {
    const key = `${m.product_id}__${m.warehouse_id}`;
    const prev = kardexMap.get(key) || 0;
    const q = Number(m.quantity) || 0;
    kardexMap.set(key, prev + (m.type === 'in' ? q : -q));
  });

  // Calcular reserved_quantity y committed_quantity reales
  const reservedMap = new Map();
  const committedMap = new Map();
  allOrderItems.forEach(oi => {
    const ord = activeOrdersById.get(oi.order_id);
    if (!ord) return;
    const prod = prodById.get(oi.product_id);
    if (!prod || prod.is_virtual) return;
    const whId = oi.warehouse_id || NUNOA_ID;
    const key = `${oi.product_id}__${whId}`;
    const q = Number(oi.quantity) || 0;

    if (ord.estado_wms === 'Pickeado' || ord.estado_wms === 'En preparación') {
      reservedMap.set(key, (reservedMap.get(key) || 0) + q);
    } else if (ord.estado_wms === 'En procesamiento') {
      committedMap.set(key, (committedMap.get(key) || 0) + q);
    }
  });

  const { data: invRows, error: invErr } = await supabase
    .from('inventory')
    .select('id, product_id, warehouse_id, quantity, reserved_quantity, committed_quantity')
    .in('product_id', prodIds);
  if (invErr) throw invErr;

  const summaryTable = [];
  for (const inv of invRows) {
    const key = `${inv.product_id}__${inv.warehouse_id}`;
    const prod = prodById.get(inv.product_id);
    const exactQty = kardexMap.get(key) || 0;
    const exactRes = reservedMap.get(key) || 0;
    const exactCom = committedMap.get(key) || 0;

    if (inv.quantity !== exactQty || inv.reserved_quantity !== exactRes || inv.committed_quantity !== exactCom) {
      const { error: uInvErr } = await supabase
        .from('inventory')
        .update({
          quantity: exactQty,
          reserved_quantity: exactRes,
          committed_quantity: exactCom,
          updated_at: new Date().toISOString()
        })
        .eq('id', inv.id);
      if (uInvErr) throw uInvErr;
    }

    if (exactQty !== 0 || inv.quantity !== 0 || exactRes !== 0 || exactCom !== 0) {
      summaryTable.push({
        sku: prod?.sku,
        wh: inv.warehouse_id === NUNOA_ID ? 'Matriz Ñuñoa' : (inv.warehouse_id === LAREINA_ID ? 'CDD La Reina' : 'Bodega Central'),
        qtyAntes: inv.quantity,
        qtyAhora: exactQty,
        kardexNeto: exactQty,
        diffInvKardex: 0,
        reserved: exactRes,
        committed: exactCom
      });
    }
  }

  summaryTable.sort((a, b) => a.wh.localeCompare(b.wh) || a.sku.localeCompare(b.sku));
  console.table(summaryTable);

  // 7. Actualizar system_qty y difference en la solicitud de conteo pendiente REQ-INV-261023-923
  console.log('\n6. Actualizando system_qty en solicitud de conteo pendiente REQ-INV-261023-923...');
  const { data: reqRow, error: reqErr } = await supabase
    .from('inventory_count_requests')
    .select('id, folio, status, products_list')
    .eq('folio', 'REQ-INV-261023-923')
    .maybeSingle();

  if (reqRow && reqRow.status === 'Pendiente' && Array.isArray(reqRow.products_list)) {
    const updatedList = reqRow.products_list.map(item => {
      const key = `${item.id}__${item.warehouse_id}`;
      const newSysQty = kardexMap.get(key) || 0;
      const newDiff = item.counted_qty !== null && item.counted_qty !== undefined
        ? Number(item.counted_qty) - newSysQty
        : null;
      return {
        ...item,
        system_qty: newSysQty,
        difference: newDiff
      };
    });

    const { error: updReqErr } = await supabase
      .from('inventory_count_requests')
      .update({ products_list: updatedList, updated_at: new Date().toISOString() })
      .eq('id', reqRow.id);
    if (updReqErr) throw updReqErr;
    console.log('   ✔ REQ-INV-261023-923 actualizada con los nuevos saldos de sistema.');
  }

  console.log('\n================================================================');
  console.log('REGULARIZACIÓN FINALIZADA CON ÉXITO');
  console.log('================================================================');
}

runRegularization().catch(err => {
  console.error('Error en regularización:', err);
  process.exit(1);
});
