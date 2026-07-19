/**
 * WMS STOCKA -> PICKER SYSTEM BIDIRECTIONAL SYNC SCRIPT
 * 
 * Este script se puede ejecutar periódicamente (cada 5 minutos) en el servidor del WMS
 * para mantener sincronizados los pedidos que están en preparación y sus estados.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// 1. Cargar variables de entorno del WMS
const envPath = '.env';
let env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1);
      }
      env[key] = value.trim();
    }
  });
}

const WMS_URL = env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const WMS_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

// Credenciales del Picker (HPOMYMTECMXUJBXQAWU)
const PICKER_URL = 'https://hpomymtecmxujbjxqawu.supabase.co';
const PICKER_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwb215bXRlY214dWpianhxYXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTE1NzAsImV4cCI6MjA5NTU2NzU3MH0.HD7Fbt7k95N9lB6NBGM87k3eFeZFDGLJK_Tp3EHT6JQ';

if (!WMS_KEY) {
  console.error("❌ Error: SUPABASE_SERVICE_ROLE_KEY no está configurado en el archivo .env");
  process.exit(1);
}

const wmsClient = createClient(WMS_URL, WMS_KEY);
const pickerClient = createClient(PICKER_URL, PICKER_KEY);

async function run() {
  console.log(`[${new Date().toISOString()}] Iniciando sincronización bidireccional WMS <-> Picker...`);

  try {
    // 1. Obtener todos los pedidos del WMS en estado "En preparación"
    const { data: wmsOrders, error: wmsErr } = await wmsClient
      .from('orders')
      .select(`
        id,
        external_order_number,
        comercio,
        customer_name,
        customer_email,
        customer_phone,
        shipping_address,
        shipping_city,
        shipping_complement,
        tracking_number,
        observation,
        estado_wms,
        agenda,
        sucursal_pickeo,
        order_items (quantity, products(sku, name, price, image_url, options, is_virtual))
      `)
      .eq('estado_wms', 'En preparación');

    if (wmsErr) throw wmsErr;

    if (!wmsOrders || wmsOrders.length === 0) {
      console.log("ℹ️ No hay pedidos en estado 'En preparación' en el WMS.");
      return;
    }

    console.log(`📋 Se encontraron ${wmsOrders.length} pedidos 'En preparación' en WMS.`);

    // 2. Obtener todas las órdenes activas en el Picker para cruzar y comparar
    const orderNumbers = wmsOrders.map(o => String(o.external_order_number || o.id));
    const { data: pickerActiveOrders, error: pickerErr } = await pickerClient
      .from('active_orders')
      .select('*')
      .in('order_number', orderNumbers);

    if (pickerErr) throw pickerErr;

    for (const wmsOrder of wmsOrders) {
      const orderNo = String(wmsOrder.external_order_number || wmsOrder.id);
      const pickerItemsForOrder = (pickerActiveOrders || []).filter(item => String(item.order_number) === orderNo);

      if (pickerItemsForOrder.length > 0) {
        // === CASO A: El pedido ya existe en el Picker, verificar si fue modificado en el WMS ===
        console.log(`🔍 Pedido ${orderNo} activo en Picker. Comparando ítems...`);

        // Estructurar ítems de WMS para comparar
        const wmsItemsMap = {};
        wmsOrder.order_items.forEach(oi => {
          if (oi.products?.is_virtual) return;
          const sku = (oi.products?.sku || '').trim().toUpperCase();
          if (sku) {
            wmsItemsMap[sku] = (wmsItemsMap[sku] || 0) + (parseInt(oi.quantity, 10) || 0);
          }
        });

        // Estructurar ítems de Picker para comparar
        const pickerItemsMap = {};
        pickerItemsForOrder.forEach(pi => {
          const sku = (pi.sku || '').trim().toUpperCase();
          if (sku) {
            pickerItemsMap[sku] = (pickerItemsMap[sku] || 0) + (parseInt(pi.quantity, 10) || 0);
          }
        });

        // Comparar cantidad y SKUs
        let hasChanges = false;
        const wmsSkus = Object.keys(wmsItemsMap);
        const pickerSkus = Object.keys(pickerItemsMap);

        if (wmsSkus.length !== pickerSkus.length) {
          hasChanges = true;
        } else {
          for (const sku of wmsSkus) {
            if (wmsItemsMap[sku] !== pickerItemsMap[sku]) {
              hasChanges = true;
              break;
            }
          }
        }

        if (hasChanges) {
          console.log(`⚠️ DETECTADAS MODIFICACIONES en el pedido ${orderNo}. Actualizando Picker y alertando al operario...`);

          // 1. Eliminar anteriores en Picker
          await pickerClient
            .from('active_orders')
            .delete()
            .eq('order_number', orderNo);

          // 2. Insertar los actualizados con advertencia
          const payloads = [];
          const nowStr = new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
          wmsOrder.order_items.forEach(oi => {
            if (oi.products?.is_virtual) return;
            const prod = oi.products || {};
            const opt = prod.options || {};
            payloads.push({
              sucursal: wmsOrder.sucursal_pickeo || 'Sucursal Virtual (Hub)',
              order_number: orderNo,
              agenda: wmsOrder.agenda || 'STK',
              quantity: parseInt(oi.quantity, 10) || 1,
              sku: prod.sku || 'SKU-TEMP',
              name: prod.name || 'Producto WMS',
              color: opt.color || null,
              talla: opt.talla || opt.size || null,
              manga: opt.manga || null,
              cuello: opt.cuello || null,
              client_name: wmsOrder.customer_name || 'Sin nombre',
              tracking: wmsOrder.tracking_number || '',
              operator: '',
              totu: 0,
              sheet_status: 'Pendiente (Obs)', // Resalta en color de alerta en Picker
              observation: `⚠️ [MODIFICADO] Este pedido sufrió cambios en el WMS el [${nowStr}]. Por favor verificar ítems.`,
              contact_data_q: wmsOrder.customer_email || '',
              contact_data_r: wmsOrder.customer_phone || '',
              contact_data_s: wmsOrder.shipping_address || '',
              contact_data_t: wmsOrder.shipping_city || '',
              contact_data_u: wmsOrder.shipping_complement || '',
              extra_col_v: prod.image_url || '',
              comercio: wmsOrder.comercio || 'MAGIC MAKEUP',
              created_by: 'Sistema WMS'
            });
          });

          if (payloads.length > 0) {
            const { error: insErr } = await pickerClient.from('active_orders').insert(payloads);
            if (insErr) console.error(`Error re-insertando pedido ${orderNo} en Picker:`, insErr.message);
          }
        } else {
          console.log(`✅ Pedido ${orderNo} está al día en el Picker. Sin cambios.`);
        }

      } else {
        // === CASO B: El pedido ya no existe en Picker active_orders (puede haber finalizado) ===
        console.log(`🔍 Pedido ${orderNo} no está activo en Picker. Verificando historial de completado...`);

        // Consultar en logs de completado del Picker
        const { data: logs, error: logsErr } = await pickerClient
          .from('history_logs')
          .select('pedido, estado, comentarios')
          .eq('pedido', orderNo)
          .in('estado', ['Completado', 'Completado-Asistido', 'Listo para retiro', 'LISTO PARA RETIRO'])
          .order('created_at', { ascending: false })
          .limit(1);

        if (logsErr) {
          console.error(`Error consultando logs para ${orderNo}:`, logsErr.message);
          continue;
        }

        if (logs && logs.length > 0) {
          // El pedido fue completado en el Picker, actualizamos el WMS a 'Pickeado'
          console.log(`🎉 ¡Pedido ${orderNo} completado en Picker con estado: "${logs[0].estado}"! Sincronizando WMS...`);
          
          const { error: wmsUpdateErr } = await wmsClient
            .from('orders')
            .update({ estado_wms: 'Pickeado' })
            .eq('id', wmsOrder.id);

          if (wmsUpdateErr) {
            console.error(`Error actualizando estado en WMS para ${orderNo}:`, wmsUpdateErr.message);
          } else {
            console.log(`✅ Pedido ${orderNo} marcado exitosamente como 'Pickeado' en WMS.`);
          }
        } else {
          console.log(`ℹ️ El pedido ${orderNo} aún no registra completado en el Picker. Continúa en preparación.`);
        }
      }
    }

  } catch (err) {
    console.error("❌ Error general durante la sincronización:", err.message);
  }

  console.log(`[${new Date().toISOString()}] Sincronización finalizada.`);
}

run();
