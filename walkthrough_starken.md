# Integración Starken Pro (starkenpro.cl) con WMS STOCKA - Éxito de Sincronización

La integración con **Starken Pro** se ha completado, configurado y validado en producción real con la cuenta corporativa **Stocka** (Categoría `SOMOS`).

---

## Resultados de la Primera Ejecución Real en Producción

```
====================================================
🔄 Sincronización Starken Pro -> WMS STOCKA
====================================================
📅 Rango de consulta: Últimos 30 días
👤 Usuario en sesión: Stocka
🏷️ Categoría de cuenta: SOMOS
📊 Total de envíos recuperados desde Starken Pro: 14
   - Tránsito: 4
   - Destino: 1
   - Reparto: 1
   - Entregados: 7
   - Otros: 1
🚀 Envíos registrados en tabla 'starken_envios': 14
📡 Registros sincronizados en 'envios_unificados' (AutoTrack): 14
✅ Pedidos vinculados y actualizados en WMS orders: 7
====================================================
```

---

## ¿Cómo opera el motor de vinculación inteligente?

Como las órdenes de flete (OF) en `starkenpro.cl` contienen datos de despacho y referencias en campos como `NUMERO_DOCUMENTO`, `DESTINATARIO`, y `DCTO`, el script implementa un extractor inteligente con múltiples patrones:
1. **Número de Documento / Pedido Directo:** `NUMERO_DOCUMENTO` (ej: `6657`, `6535`, `3098`) -> vincula directamente con órdenes de venta `#6657` o `6657`.
2. **Número de Orden incrustado en Destinatario:** Extrae `#XXXX` o números aislados de 4 a 7 dígitos.
3. **Sigla + Número de comercio:** `B4L1672` -> vincula con `B4L#1672`, etc.
4. **Fallback por Teléfono:** Últimos 8 dígitos del destinatario cruzados con el comercio emisor.
5. **Auto-actualización de Pedidos:** Asigna `courier = 'STARKEN'`, número de OF como tracking, enlace oficial de seguimiento (`https://www.starken.cl/seguimiento?codigo=...`) y si el paquete ya tiene movimiento activo (`DESPACHADO`), avanza el pedido de forma automática.

---

## Operación 100% Online en la Nube (GitHub Actions)

Al igual que con **Blue Express**, la sincronización de Starken Pro opera de forma 100% autónoma en la nube cada 3 horas a través de **GitHub Actions** (`.github/workflows/sync_starken.yml`), sin necesidad de tener scripts ni terminales corriendo en local:

1. **Secret en GitHub Repository:**
   - URL: `https://github.com/stockachile/stocka-wms/settings/secrets/actions`
   - Secreto: `STARKEN_STATE_JSON` con el contenido del JSON de sesión.
2. **Ejecución Automática:**
   - Corre cada 3 horas (UTC: 1, 4, 7, 10, 13, 16, 19, 22).
3. **Disparo Manual Online:**
   - En `https://github.com/stockachile/stocka-wms/actions/workflows/sync_starken.yml`, haz clic en **Run workflow**.

La sesión queda persistida en `starken_state.json` y se renueva automáticamente sin requerir interacción manual recurrente.
