# Integración Blue Express (app.bluex.cl) con WMS STOCKA - Éxito de Sincronización

La integración con **Blue Express** se ha completado, configurado y validado en producción real con la cuenta `stockachile@gmail.com`.

---

## Resultados de la Primera Ejecución Real

```
====================================================
🔄 Sincronización Blue Express -> WMS STOCKA
====================================================
📅 Rango: Últimos 30 días
👤 Usuario en sesión: stockachile@gmail.com
📊 Total de envíos recuperados desde Blue Express: 52
🚀 Envíos registrados en tabla 'bluex_envios': 52
✅ Pedidos vinculados y actualizados en WMS orders: 43
====================================================
```

### Ejemplos de Pedidos Vinculados y Actualizados:
- **Orden #6549 (Cristina Valdebenito):** Asignado tracking `2401185651` con enlace a `https://tracking-unificado.blue.cl/?n_seguimiento=2401185651` y courier `BLUEXPRESS`.
- **Orden #6536 (Barbara Carvajal / Angels Eyelashes):** Asignado tracking `2401178253` con enlace de seguimiento y courier `BLUEXPRESS`.

---

## ¿Cómo funciona el motor de vinculación inteligente?

Como los envíos en `app.bluex.cl` suelen generarse con el número de pedido incluido dentro del campo de destinatario o referencia, el script implementa un extractor inteligente con múltiples patrones:
1. **Número con almohadilla:** `#6536` -> vincula directamente con `#6536` o `6536`.
2. **Sigla + Número de comercio:** `B4L1672` -> vincula con `B4L#1672`, `1672`, etc.
3. **Número de orden al final o aislado:** `Cristina Valdebenito 6549` -> vincula con `#6549` o `6549`.
4. **Fallback por Teléfono:** Últimos 8 dígitos del destinatario cruzados con el comercio emisor.

---

## Comandos Disponibles

A partir de ahora, puedes sincronizar en cualquier momento con un solo comando en tu terminal (desde `C:\Users\felip\Desktop\WMS STOCKA`):

```bash
# Sincronización normal (últimos 30 días)
npm run sync:bluex

# Sincronizar un rango personalizado (ejemplo: últimos 7 días)
node sync_bluex.js --days 7
```

La sesión queda persistida en `bluex_state.json` y se renueva automáticamente sin requerir interacción manual.
