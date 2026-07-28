# Stocka Shopify Theme

Este directorio contiene el código fuente del tema de Shopify para Stocka (www.stocka.cl).
Trabajamos localmente con Shopify CLI para desarrollar las páginas nativas y reemplazar EComposer.

## Comandos Útiles

1. **Iniciar sesión y descargar el tema:**
   ```bash
   npx @shopify/cli theme pull --store=stocka-cl.myshopify.com
   ```
   *(Nota: Reemplazar stocka-cl.myshopify.com por la URL de desarrollo si es diferente).*

2. **Iniciar servidor local de desarrollo:**
   ```bash
   npx @shopify/cli theme dev
   ```

3. **Subir los cambios al tema:**
   ```bash
   npx @shopify/cli theme push
   ```
