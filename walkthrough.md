# Walkthrough - Desglose de Bultos y Servicio de Descarga en Bodega

Hemos completado el desarrollo e integración de la funcionalidad de desglose detallado de bultos (contenedores, pallets y cajas) y la opción de solicitar descarga manual en bodega.

## Cambios Realizados

### 1. Base de Datos (Supabase)
- Actualizado el script [supabase_schema_declarations.sql](file:///c:/Users/felip/Desktop/WMS%20STOCKA/supabase_schema_declarations.sql) para incluir las siguientes nuevas columnas:
  - `container_count` INTEGER DEFAULT 0 (con CHECK >= 0)
  - `pallet_count` INTEGER DEFAULT 0 (con CHECK >= 0)
  - `box_count` INTEGER DEFAULT 0 (con CHECK >= 0)
  - `requires_unloading` BOOLEAN DEFAULT false
- Estas columnas aseguran que guardemos de forma estructurada los componentes individuales declarados.

### 2. Panel del Cliente (`js/app.js`)
- **Formulario de Ingreso de Stock:**
  - Reemplazados los campos genéricos de "Cantidad de Bultos Totales" y "Tipo de Bulto" por tres secciones de inputs con checkboxes:
    1. **Contenedores:** Input numérico + checkbox "No enviaré" (al marcarlo, se deshabilita el campo y se fija en 0).
    2. **Pallets:** Input numérico + checkbox "No enviaré" (al marcarlo, se deshabilita el campo y se fija en 0).
    3. **Cajas:** Input numérico + checkbox "No enviaré" (al marcarlo, se deshabilita el campo y se fija en 0).
  - **Servicio de Descarga:** Agregado un checkbox "¿El ingreso requiere servicio de descarga por parte de bodega?". Al marcarlo, se despliega una advertencia destacada sobre el costo adicional: *"Las descargas se realizan de forma manual en bodega y tienen un costo de 0,1 uf x m³"*.
- **Validación y Envío de Formulario:**
  - Se valida automáticamente que la suma de todos los bultos a enviar sea mayor o igual a 1.
  - Para asegurar la compatibilidad con listados e interfaces previas, `package_count` se calcula como la suma total de los bultos, y `package_type` se infiere dinámicamente como `'Contenedores'`, `'Pallets'`, `'Cajas'` o `'Mixto'`.
  - En la limpieza del formulario, los campos deshabilitados son reactivados y los warnings ocultados.
- **Detalle de la Declaración (Modal):**
  - Actualizado para mostrar el desglose de bultos declarados y si se solicitó o no el servicio de descarga con la tasa de cobro respectiva.

### 3. Panel de Administración (`admin.html` y `js/admin.js`)
- **Modal de Gestión de Declaraciones:**
  - Se agregaron campos informativos para que el administrador pueda ver los detalles individuales de contenedores, pallets, cajas y el requerimiento del servicio de descarga directamente en la ficha del ingreso.

---

## Verificación de Sintaxis
- `node -c js/app.js js/admin.js` ➡️ **Éxito (Sin errores de sintaxis)**

---

## Instrucciones para Puesta en Marcha (Usuario)

1. **Ejecutar Migración de Base de Datos:**
   - Ve a la consola de **Supabase** ➡️ **SQL Editor**.
   - Ejecuta las siguientes líneas de SQL para agregar las nuevas columnas a la tabla de declaraciones:
     ```sql
     ALTER TABLE public.stock_declarations ADD COLUMN IF NOT EXISTS container_count INTEGER DEFAULT 0 CHECK (container_count >= 0);
     ALTER TABLE public.stock_declarations ADD COLUMN IF NOT EXISTS pallet_count INTEGER DEFAULT 0 CHECK (pallet_count >= 0);
     ALTER TABLE public.stock_declarations ADD COLUMN IF NOT EXISTS box_count INTEGER DEFAULT 0 CHECK (box_count >= 0);
     ALTER TABLE public.stock_declarations ADD COLUMN IF NOT EXISTS requires_unloading BOOLEAN DEFAULT false;
     ```

2. **Probar el Flujo Completo:**
   - **Formulario Cliente:** Intenta marcar "No enviaré" en contenedores y pallets. Verifica que se deshabilitan. Deja Cajas vacías e intenta enviar. Comprueba el aviso de que debe ingresar al menos 1 bulto.
   - **Servicio de Descarga:** Marca el checkbox de descarga y comprueba que aparece la alerta de 0.1 UF x m³. Desmárcala y comprueba que se oculta.
   - **Recepción en Administración:** Abre el panel de administración, selecciona "Gestionar" en el registro de stock ingresado y verifica que el desglose de bultos y el estado del servicio de descarga se muestran correctamente.
