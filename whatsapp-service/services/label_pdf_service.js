/**
 * Servicio de Generación de Etiquetas de Despacho en PDF (Formato 10x15 cm)
 * Compatible con impresoras térmicas (Zebra, Xprinter, etc.)
 */

const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');
const fs = require('fs');
const path = require('path');

/**
 * Genera el Buffer PDF de una etiqueta de despacho en formato 10x15 cm
 * @param {Object} order Objeto completo de la orden con order_items
 * @param {Object} options Opciones de configuración (courier, headComment, footComment)
 * @returns {Promise<Buffer>} Buffer del documento PDF generado
 */
async function generatePickupLabelPDF(order, options = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      // Dimensiones exactas 100mm x 150mm (1 pt = 1/72 pulgada, 25.4 mm = 1 pulgada)
      const widthPt = 283.46;
      const heightPt = 425.20;
      const margin = 14; // ~5mm de margen perimetral
      const contentWidth = widthPt - (margin * 2);

      const doc = new PDFDocument({
        size: [widthPt, heightPt],
        margins: { top: margin, bottom: margin, left: margin, right: margin },
        autoFirstPage: true,
        info: {
          Title: `Etiqueta_${order.external_order_number || order.id}`,
          Author: 'Stocka Logística WMS',
          Subject: 'Etiqueta de Retiro en Sucursal'
        }
      });

      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      const startX = margin;
      let curY = margin;

      // --- 1. CABECERA CON LOGO Y TÍTULOS ---
      let logoFound = false;
      const possibleLogoPaths = [
        path.join(__dirname, '../assets/logo.png'),
        path.join(__dirname, '../whatsapp-service/assets/logo.png'),
        path.join(__dirname, 'assets/logo.png'),
        path.join(process.cwd(), 'assets/logo.png')
      ];

      for (const p of possibleLogoPaths) {
        if (fs.existsSync(p)) {
          doc.image(p, startX, curY, { height: 22, fit: [80, 22] });
          logoFound = true;
          break;
        }
      }

      if (!logoFound) {
        doc.fontSize(14).font('Helvetica-Bold').fillColor('#000').text('STOCKA', startX, curY);
      }

      doc.fontSize(11).font('Helvetica-Bold').fillColor('#000').text('ETIQUETA DE DESPACHO', startX + 80, curY, {
        width: contentWidth - 80,
        align: 'right'
      });
      doc.fontSize(7).font('Helvetica').fillColor('#555').text('STOCKA LOGÍSTICA WMS', startX + 80, curY + 13, {
        width: contentWidth - 80,
        align: 'right'
      });
      doc.fillColor('#000');

      curY += 26;
      doc.lineWidth(1.5).moveTo(startX, curY).lineTo(startX + contentWidth, curY).stroke();
      curY += 4;

      // --- 2. COMENTARIO DE CABECERA (HEAD) ---
      const headComment = options.headComment || 'RETIRO EN SUCURSAL';
      if (headComment && headComment.trim()) {
        doc.rect(startX, curY, contentWidth, 18).fill('#000');
        doc.fillColor('#fff').fontSize(9).font('Helvetica-Bold').text(headComment.trim().toUpperCase(), startX, curY + 4, {
          width: contentWidth,
          align: 'center'
        });
        doc.fillColor('#000');
        curY += 22;
      }

      // --- 3. COURIER / OPERADOR & MÉTODO DE ENVÍO ---
      const courierVal = options.courier || order.operador || 'RETIRO';
      const shippingMethod = order.shipping_method || 'Retiro en Sucursal';
      const colW = contentWidth / 2;
      const boxH = 28;

      doc.lineWidth(1).rect(startX, curY, contentWidth, boxH).stroke();
      doc.moveTo(startX + colW, curY).lineTo(startX + colW, curY + boxH).stroke();

      // Columna Izquierda: Courier
      doc.fontSize(6).font('Helvetica-Bold').fillColor('#555').text('COURIER / OPERADOR', startX + 4, curY + 4);
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#000').text(courierVal.toUpperCase(), startX + 4, curY + 12);

      // Columna Derecha: Método
      doc.fontSize(6).font('Helvetica-Bold').fillColor('#555').text('MÉTODO DE ENVÍO', startX + colW + 4, curY + 4);
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#000').text(shippingMethod, startX + colW + 4, curY + 13, {
        width: colW - 8,
        ellipsis: true
      });

      curY += boxH + 4;

      // --- 4. DESTINATARIO ---
      const destBoxH = 62;
      doc.rect(startX, curY, contentWidth, destBoxH).lineWidth(1.2).stroke();

      doc.fontSize(6).font('Helvetica-Bold').fillColor('#555').text('DESTINATARIO', startX + 6, curY + 4);
      doc.lineWidth(0.5).moveTo(startX + 6, curY + 12).lineTo(startX + contentWidth - 6, curY + 12).stroke();

      const customerName = order.customer_name || 'Sin nombre';
      const address = order.shipping_address || 'Retiro en Sucursal Ñuñoa';
      const city = order.shipping_city || 'Ñuñoa';
      const phone = order.customer_phone || 'Sin teléfono';

      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000').text(customerName, startX + 6, curY + 15, {
        width: contentWidth - 12,
        ellipsis: true
      });
      doc.fontSize(7.5).font('Helvetica').text(address, startX + 6, curY + 28, {
        width: contentWidth - 12,
        ellipsis: true
      });
      doc.fontSize(9).font('Helvetica-Bold').text(city.toUpperCase(), startX + 6, curY + 39, {
        width: contentWidth - 12,
        ellipsis: true
      });
      doc.fontSize(7).font('Helvetica').text(`Tel: ${phone}`, startX + 6, curY + 51);

      curY += destBoxH + 4;

      // --- 5. REMITENTE & REFERENCIA PEDIDO ---
      const originBoxH = 26;
      doc.lineWidth(1).rect(startX, curY, contentWidth, originBoxH).stroke();
      doc.moveTo(startX + colW, curY).lineTo(startX + colW, curY + originBoxH).stroke();

      // Columna 1: Tienda
      doc.fontSize(6).font('Helvetica-Bold').fillColor('#555').text('REMITENTE (TIENDA)', startX + 4, curY + 3);
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#000').text(order.comercio || 'STOCKA', startX + 4, curY + 12, {
        width: colW - 8,
        ellipsis: true
      });

      // Columna 2: Referencia
      const orderNo = String(order.external_order_number || order.id);
      doc.fontSize(6).font('Helvetica-Bold').fillColor('#555').text('REFERENCIA PEDIDO', startX + colW + 4, curY + 3);
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#000').text(`#${orderNo}`, startX + colW + 4, curY + 12, {
        width: colW - 8,
        ellipsis: true
      });

      curY += originBoxH + 4;

      // --- 6. CÓDIGO DE BARRAS (Code 128) ---
      const rawCode = orderNo.replace(/[^a-zA-Z0-9]/g, '') || orderNo;
      try {
        const barcodePng = await bwipjs.toBuffer({
          bcid: 'code128',
          text: rawCode,
          scale: 2,
          height: 9,
          includetext: true,
          textxalign: 'center',
          textsize: 8
        });

        const barcodeH = 34;
        doc.rect(startX, curY, contentWidth, barcodeH).stroke();
        doc.image(barcodePng, startX + (contentWidth - 160) / 2, curY + 3, { width: 160, height: 28 });
        curY += barcodeH + 4;
      } catch (bcErr) {
        console.error('[LabelPDF] Error generando barcode:', bcErr.message);
        curY += 10;
      }

      // --- 7. DETALLE DE PRODUCTOS ---
      const items = order.order_items || [];
      const itemsBoxH = 110;
      doc.rect(startX, curY, contentWidth, itemsBoxH).stroke();

      doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#333').text('DETALLE DE PRODUCTOS (PICKING & PACKING)', startX + 4, curY + 3);
      doc.lineWidth(0.5).moveTo(startX, curY + 12).lineTo(startX + contentWidth, curY + 12).stroke();

      let tableY = curY + 15;
      doc.fontSize(6).font('Helvetica-Bold').text('SKU', startX + 4, tableY);
      doc.text('PRODUCTO', startX + 65, tableY);
      doc.text('CANT', startX + contentWidth - 25, tableY, { width: 20, align: 'center' });

      tableY += 8;
      doc.moveTo(startX, tableY).lineTo(startX + contentWidth, tableY).stroke();
      tableY += 3;

      const displayItems = items.length > 0 ? items : [{
        quantity: order.cantidad || 1,
        products: { sku: order.sku || 'Sin SKU', name: order.item || 'Producto' }
      }];

      displayItems.slice(0, 6).forEach(oi => {
        const sku = oi.products?.sku || oi.sku || 'Sin SKU';
        const name = oi.products?.name || oi.name || 'Producto';
        const qty = oi.quantity || 1;

        doc.fontSize(6).font('Helvetica-Bold').text(sku, startX + 4, tableY, { width: 58, ellipsis: true });
        doc.fontSize(6).font('Helvetica').text(name, startX + 65, tableY, { width: contentWidth - 95, ellipsis: true });
        doc.fontSize(7).font('Helvetica-Bold').text(String(qty), startX + contentWidth - 25, tableY, { width: 20, align: 'center' });

        tableY += 12;
      });

      curY += itemsBoxH + 4;

      // Comentario de Pie si existiera
      if (options.footComment && options.footComment.trim()) {
        doc.rect(startX, curY, contentWidth, 14).stroke();
        doc.fontSize(6.5).font('Helvetica-Bold').text(options.footComment.trim().toUpperCase(), startX, curY + 3, {
          width: contentWidth,
          align: 'center'
        });
      }

      // --- 8. PIE DE PÁGINA ---
      doc.fontSize(5.5).font('Helvetica').fillColor('#666').text('Preparado y despachado desde Centro de Distribución STOCKA', startX, heightPt - margin - 8, {
        width: contentWidth,
        align: 'center'
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generatePickupLabelPDF
};
