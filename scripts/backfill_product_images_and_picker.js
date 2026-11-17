/**
 * Retroactive backfill script:
 * 1. Populates missing `products.image_url` in WMS from `synced_products`, `products.raw_*_data`,
 *    `orders.raw_*_data` (WooCommerce, Tiendanube, Jumpseller, Paris, Falabella, Meli, Ripley),
 *    and Walmart /v3/items catalog.
 * 2. Updates all currently active orders in Picker (`active_orders`) with:
 *    `platform`, `platform_logo`, `shipping_method`, `payment_status`, `coverage`, `order_tags`,
 *    and missing `extra_col_v` product photos.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { buildPickerOrderMeta, resolveProductImageForPicker } = require('../services/picker_order_meta');

const envPath = path.join(__dirname, '..', '.env');
const env = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (m) {
      let v = (m[2] || '').trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      env[m[1]] = v;
    }
  });
}

const WMS_URL = env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const WMS_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const PICKER_URL = 'https://hpomymtecmxujbjxqawu.supabase.co';
const PICKER_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ';

const wms = createClient(WMS_URL, WMS_KEY);
const picker = createClient(PICKER_URL, PICKER_KEY);

async function fetchAllPages(client, table, selectCols, filterFn = null) {
  const all = [];
  let from = 0;
  const step = 1000;
  while (true) {
    let q = client.from(table).select(selectCols).range(from, from + step - 1);
    if (filterFn) q = filterFn(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < step) break;
    from += step;
  }
  return all;
}

async function syncWalmartImagesToMap(imgMap) {
  try {
    const { data: walInts } = await wms.from('merchant_integrations').select('*').eq('platform', 'Walmart').eq('is_active', true);
    for (const wi of (walInts || [])) {
      if (!wi.client_id || !wi.client_secret) continue;
      const basic = Buffer.from(`${wi.client_id}:${wi.client_secret}`).toString('base64');
      const tokRes = await fetch('https://marketplace.walmartapis.com/v3/token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'WM_SVC.NAME': 'Walmart Marketplace',
          'WM_QOS.CORRELATION_ID': crypto.randomUUID(),
          'WM_MARKET': 'cl',
          'Accept': 'application/json'
        },
        body: 'grant_type=client_credentials'
      });
      if (!tokRes.ok) continue;
      const { access_token } = await tokRes.json();
      if (!access_token) continue;

      const itRes = await fetch('https://marketplace.walmartapis.com/v3/items?limit=100', {
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'WM_SEC.ACCESS_TOKEN': access_token,
          'WM_SVC.NAME': 'Walmart Marketplace',
          'WM_QOS.CORRELATION_ID': crypto.randomUUID(),
          'WM_MARKET': 'cl',
          'Accept': 'application/json'
        }
      });
      if (!itRes.ok) continue;
      const itJson = await itRes.json();
      const items = itJson?.ItemResponse || [];
      const upserts = [];
      for (const it of items) {
        const sku = String(it.sku || '').trim().replace(/\s+/g, '');
        const img = it.mainImageUrl || it.images?.[0]?.url || (it.itemId ? `https://images.lider.cl/wmtcl?source=url[file:/product/${it.itemId}a.jpg]&sink` : '');
        if (sku && img) {
          const cUp = String(wi.comercio || '').trim().toUpperCase();
          const sUp = sku.toUpperCase();
          if (cUp) imgMap.set(`${cUp}__${sUp}`, img);
          if (!imgMap.has(sUp)) imgMap.set(sUp, img);
          upserts.push({
            comercio: wi.comercio,
            platform: 'Walmart',
            sku,
            name: it.productName || 'Producto Walmart',
            image_url: img
          });
        }
      }
      if (upserts.length > 0) {
        await wms.from('synced_products').upsert(upserts, { onConflict: 'comercio,platform,sku' });
        console.log(`✅ [Walmart] Sincronizadas ${upserts.length} fotos en synced_products para ${wi.comercio}.`);
      }
    }
  } catch (e) {
    console.warn('⚠️ Aviso Walmart backfill:', e.message);
  }
}

(async () => {
  console.log('🚀 Iniciando backfill retroactivo de fotos de productos y metadatos en Picker...');

  // 1. Construir mapa global de fotos desde synced_products y equivalencias
  const syncedRows = await fetchAllPages(wms, 'synced_products', 'comercio, sku, image_url', q => q.not('image_url', 'is', null));
  const imgMap = new Map();
  syncedRows.forEach(r => {
    const img = String(r.image_url || '').trim();
    const sUp = String(r.sku || '').trim().toUpperCase();
    const cUp = String(r.comercio || '').trim().toUpperCase();
    if (img && sUp) {
      if (cUp && !imgMap.has(`${cUp}__${sUp}`)) imgMap.set(`${cUp}__${sUp}`, img);
      if (!imgMap.has(sUp)) imgMap.set(sUp, img);
    }
  });
  console.log(`📸 Fotos cargadas desde synced_products: ${imgMap.size} claves.`);

  // 1.b Enriquecer con Walmart /v3/items
  await syncWalmartImagesToMap(imgMap);

  // 1.c Cargar equivalencias de SKU
  const equivRows = await fetchAllPages(wms, 'sku_equivalences', 'comercio, platform_sku, master_sku');
  const masterToPlatSkus = new Map();
  equivRows.forEach(eq => {
    const cUp = String(eq.comercio || '').trim().toUpperCase();
    const mUp = String(eq.master_sku || '').trim().toUpperCase();
    const pUp = String(eq.platform_sku || '').trim().replace(/\s+/g, '').toUpperCase();
    if (mUp && pUp) {
      const key = `${cUp}__${mUp}`;
      if (!masterToPlatSkus.has(key)) masterToPlatSkus.set(key, []);
      masterToPlatSkus.get(key).push(pUp);
    }
  });

  // 1.d Extraer fotos desde órdenes recientes con raw_woocommerce_data, raw_tiendanube_data, raw_jumpseller_data, raw_paris_data, raw_meli_data
  const rawOrderSources = [
    ['raw_woocommerce_data', (ord, raw) => {
      (raw?.line_items || []).forEach(li => {
        const sku = String(li?.sku || (li?.product_id ? `WC-${li.product_id}${li.variation_id ? '-' + li.variation_id : ''}` : '')).trim().replace(/\s+/g, '').toUpperCase();
        const src = li?.image?.src || (typeof li?.image === 'string' ? li.image : '');
        const cUp = String(ord.comercio || '').trim().toUpperCase();
        if (sku && src) {
          if (cUp && !imgMap.has(`${cUp}__${sku}`)) imgMap.set(`${cUp}__${sku}`, src);
          if (!imgMap.has(sku)) imgMap.set(sku, src);
        }
      });
    }],
    ['raw_tiendanube_data', (ord, raw) => {
      (raw?.products || []).forEach(li => {
        const sku = String(li?.sku || (li?.product_id ? `TN-${li.product_id}${li.variant_id ? '-' + li.variant_id : ''}` : '')).trim().replace(/\s+/g, '').toUpperCase();
        const src = li?.image?.src || (typeof li?.image === 'string' ? li.image : '');
        const cUp = String(ord.comercio || '').trim().toUpperCase();
        if (sku && src) {
          if (cUp && !imgMap.has(`${cUp}__${sku}`)) imgMap.set(`${cUp}__${sku}`, src);
          if (!imgMap.has(sku)) imgMap.set(sku, src);
        }
      });
    }],
    ['raw_jumpseller_data', (ord, raw) => {
      (raw?.products || []).forEach(li => {
        const pid = li?.product_id || li?.id;
        const sku = String(li?.sku || (pid ? `JS-${pid}${li.variant_id ? '-' + li.variant_id : ''}` : '')).trim().replace(/\s+/g, '').toUpperCase();
        const src = typeof li?.image === 'string' ? li.image : li?.image?.url;
        const cUp = String(ord.comercio || '').trim().toUpperCase();
        if (sku && src) {
          if (cUp && !imgMap.has(`${cUp}__${sku}`)) imgMap.set(`${cUp}__${sku}`, src);
          if (!imgMap.has(sku)) imgMap.set(sku, src);
        }
      });
    }],
    ['raw_paris_data', (ord, raw) => {
      (raw?.subOrders || []).forEach(so => {
        (so?.items || []).forEach(li => {
          const sku = String(li?.sellerSku || li?.sku || '').trim().replace(/\s+/g, '').toUpperCase();
          const src = li?.imagePath || li?.imageUrl || li?.thumbnail;
          const cUp = String(ord.comercio || '').trim().toUpperCase();
          if (sku && src) {
            if (cUp && !imgMap.has(`${cUp}__${sku}`)) imgMap.set(`${cUp}__${sku}`, src);
            if (!imgMap.has(sku)) imgMap.set(sku, src);
          }
        });
      });
    }],
    ['raw_meli_data', (ord, raw) => {
      const mOrders = Array.isArray(raw) ? raw : (Array.isArray(raw?.orders) ? raw.orders : [raw]);
      mOrders.forEach(mo => {
        (mo?.order_items || []).forEach(oi => {
          const sku = String(oi?.item?.seller_sku || oi?.item?.seller_custom_field || oi?.item?.id || '').trim().replace(/\s+/g, '').toUpperCase();
          let src = oi?.item?.secure_thumbnail || oi?.item?.thumbnail || '';
          if (src.startsWith('http://')) src = src.replace(/^http:\/\//i, 'https://');
          const cUp = String(ord.comercio || '').trim().toUpperCase();
          if (sku && src) {
            if (cUp && !imgMap.has(`${cUp}__${sku}`)) imgMap.set(`${cUp}__${sku}`, src);
            if (!imgMap.has(sku)) imgMap.set(sku, src);
          }
        });
      });
    }]
  ];

  for (const [col, extractor] of rawOrderSources) {
    const { data: ords } = await wms
      .from('orders')
      .select(`comercio, ${col}`)
      .not(col, 'is', null)
      .order('created_at', { ascending: false })
      .limit(600);
    (ords || []).forEach(o => extractor(o, o[col]));
  }
  console.log(`📸 Mapa enriquecido con órdenes crudas: ${imgMap.size} claves totales.`);

  // 2. Backfill en tabla maestra products donde image_url sea null o vacío
  const missingProds = await fetchAllPages(
    wms,
    'products',
    'id, comercio, sku, image_url, raw_paris_data, raw_falabella_data, raw_jumpseller_data, raw_tiendanube_data, raw_woocommerce_data, raw_meli_data, raw_ripley_data',
    q => q.or('image_url.is.null,image_url.eq.')
  );
  console.log(`🔎 Productos maestros sin image_url en WMS: ${missingProds.length}`);

  let updatedProdsCount = 0;
  for (const p of missingProds) {
    let found = resolveProductImageForPicker(p, { comercio: p.comercio }, imgMap);
    if (!found && p.sku && p.comercio) {
      const cUp = String(p.comercio).trim().toUpperCase();
      const sUp = String(p.sku).trim().toUpperCase();
      const eqSkus = masterToPlatSkus.get(`${cUp}__${sUp}`) || [];
      for (const ps of eqSkus) {
        found = imgMap.get(`${cUp}__${ps}`) || imgMap.get(ps) || '';
        if (found) break;
      }
    }
    if (found) {
      const { error } = await wms.from('products').update({ image_url: found }).eq('id', p.id);
      if (!error) {
        updatedProdsCount++;
        const cUp = String(p.comercio || '').trim().toUpperCase();
        const sUp = String(p.sku || '').trim().toUpperCase();
        if (cUp && sUp) imgMap.set(`${cUp}__${sUp}`, found);
        if (sUp && !imgMap.has(sUp)) imgMap.set(sUp, found);
      }
    }
  }
  console.log(`✅ Productos maestros actualizados con image_url en WMS: ${updatedProdsCount}`);

  // 3. Cargar catálogo completo con image_url para enriquecer active_orders actuales en Picker
  const allProdsWithImg = await fetchAllPages(wms, 'products', 'comercio, sku, image_url', q => q.not('image_url', 'is', null));
  allProdsWithImg.forEach(p => {
    const img = String(p.image_url || '').trim();
    const sUp = String(p.sku || '').trim().toUpperCase();
    const cUp = String(p.comercio || '').trim().toUpperCase();
    if (img && sUp) {
      if (cUp) imgMap.set(`${cUp}__${sUp}`, img);
      if (!imgMap.has(sUp)) imgMap.set(sUp, img);
    }
  });

  // 4. Actualizar todas las filas activas en Picker active_orders
  const pickerRows = await fetchAllPages(picker, 'active_orders', '*');
  console.log(`📦 Filas activas en Picker active_orders: ${pickerRows.length}`);

  const orderNumsSet = new Set();
  pickerRows.forEach(r => {
    const raw = String(r.order_number || '').trim();
    if (!raw || raw.startsWith('ING-')) return;
    orderNumsSet.add(raw);
    orderNumsSet.add(raw.replace(/^#/, ''));
    orderNumsSet.add('#' + raw.replace(/^#/, ''));
  });

  const orderNumsArr = Array.from(orderNumsSet);
  const wmsOrdersByNormKey = new Map();

  for (let i = 0; i < orderNumsArr.length; i += 150) {
    const chunk = orderNumsArr.slice(i, i + 150);
    const { data: wOrds } = await wms
      .from('orders')
      .select('id, external_order_number, external_platform, origen, status, payment_status, categoria_entrega, comercio, shipping_method, shipping_city, agenda, operador, courier, raw_shopify_data, raw_woocommerce_data, raw_tiendanube_data, raw_jumpseller_data, raw_meli_data, raw_falabella_data, raw_paris_data, raw_walmart_data, raw_ripley_data')
      .in('external_order_number', chunk);

    (wOrds || []).forEach(o => {
      const k = String(o.external_order_number || '').replace(/^#/, '').trim().toUpperCase();
      if (k) wmsOrdersByNormKey.set(k, o);
      const digits = k.replace(/\D/g, '');
      if (digits.length >= 8 && !wmsOrdersByNormKey.has(digits)) {
        wmsOrdersByNormKey.set(digits, o);
      }
    });
  }
  console.log(`🔗 Órdenes cruzadas con WMS: ${wmsOrdersByNormKey.size}`);

  let updatedPickerRows = 0;
  let updatedPickerPhotos = 0;

  for (const row of pickerRows) {
    const ordNum = String(row.order_number || '').trim();
    if (ordNum.startsWith('ING-')) continue;
    const normKey = ordNum.replace(/^#/, '').trim().toUpperCase();
    const digitsKey = normKey.replace(/\D/g, '');
    const wmsOrd = wmsOrdersByNormKey.get(normKey) || (digitsKey.length >= 8 ? wmsOrdersByNormKey.get(digitsKey) : null);

    let meta;
    if (wmsOrd) {
      meta = buildPickerOrderMeta(wmsOrd);
    } else {
      meta = buildPickerOrderMeta({
        external_order_number: row.order_number,
        comercio: row.comercio,
        agenda: row.agenda,
        operador: row.operator,
        shipping_method: row.shipping_method,
        shipping_city: row.contact_data_t,
        payment_status: 'paid',
        categoria_entrega: String(row.agenda || '').toUpperCase().includes('RETIRO') ? 'RETIRO' : 'DISTRIBUCIÓN'
      });
    }

    const patch = {
      platform: meta.platform,
      platform_logo: meta.platform_logo,
      shipping_method: meta.shipping_method,
      payment_status: meta.payment_status,
      coverage: meta.coverage,
      order_tags: meta.order_tags,
      order_sla: meta.order_sla
    };

    if (!row.extra_col_v || !String(row.extra_col_v).trim()) {
      const masterSku = String(row.sku || '').split('|')[0].trim();
      const resolvedImg = resolveProductImageForPicker(
        { sku: masterSku, comercio: row.comercio },
        wmsOrd || { comercio: row.comercio },
        imgMap
      );
      if (resolvedImg) {
        patch.extra_col_v = resolvedImg;
        updatedPickerPhotos++;
      }
    }

    const { error: upErr } = await picker.from('active_orders').update(patch).eq('id', row.id);
    if (!upErr) updatedPickerRows++;
  }

  console.log(`🎉 Backfill completado: ${updatedPickerRows}/${pickerRows.length} filas de Picker actualizadas (${updatedPickerPhotos} fotos nuevas inyectadas en pedidos activos).`);
})();
