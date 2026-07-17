# Walkthrough - Edición de Ingresos, Flujo Guiado Administrativo y Desglose de Bultos

Hemos completado el desarrollo e integración de los módulos de edición de declaraciones para el cliente, la restricción y secuenciación guiada de estados para el administrador, y la visualización de desglose en las tablas principales.

## Cambios Realizados

### 1. Tablas Resumen Actualizadas (Cliente y Administrador)
- En ambas tablas (Cliente y Administrador), la columna **Bultos** ahora muestra el desglose completo declarado en tiempo real:
  - *Ej: 12 (Mixto)* seguido de `C: 1 | P: 1 | Cx: 10`
  - Se añade un badge destacando la etiqueta **"Descarga"** si el cliente solicitó el servicio de descarga en bodega.

### 2. Edición de Declaración para el Cliente (`js/app.js`)
- **Acción "Editar" en la Tabla:**
  - Se habilitó un botón **"Editar"** en la columna de acciones de la tabla.
  - **Restricción de Estado:** Este botón solo es visible y funcional si la declaración está en etapas previas a ser finalizada (es decir, en estados `Creada`, `En Recepción - Pendiente Conteo`, o `En proceso de conteo/clasificación`). Si ya fue recibida, no permite edición.
- **Flujo de Edición:**
  - Al hacer click en **"Editar"**, el formulario lateral se adapta automáticamente:
    1. Cambia el título a *"Editar Declaración de Ingreso"*.
    2. Cambia el botón de envío a *"Guardar Cambios"*.
    3. Habilita un botón *"Cancelar"* (que permite revertir la edición y limpiar el formulario).
    4. Carga todos los valores previamente guardados (incluyendo checkboxes, deshabilitado dinámico de bultos, método de envío, etc.).
    5. Carga y resalta la fecha seleccionada en el mini calendario.
    6. **Planilla de Ingreso:** Se elimina el atributo `required` del input de archivo. Muestra un texto indicando el archivo actual guardado, permitiendo mantenerlo o subir uno nuevo para reemplazarlo.
- **Guardado:**
  - Al presionar *"Guardar Cambios"*, se actualiza el registro en Supabase, se guarda una entrada en la bitácora (`history`) indicando que fue modificada por el cliente, y se restablece el formulario a su estado original de creación.

### 3. Flujo Guiado y Secuencial para el Administrador (`admin.html` y `js/admin.js`)
- **Adiós al Selector Genérico:**
  - Se eliminó el menú desplegable (`select`) que permitía cambiar a cualquier estado arbitrariamente.
  - Se introdujo un panel dinámico de botones de acción secuenciales que restringe la ruta a los siguientes pasos lógicos:
    1. Si está en **Creada** ➡️ Permite avanzar únicamente a **"En Recepción - Pendiente Conteo"**.
    2. Si está en **En Recepción - Pendiente Conteo** ➡️ Permite avanzar únicamente a **"En proceso de conteo/clasificación"**.
    3. Si está en **En proceso de conteo/clasificación** ➡️ Ofrece las dos opciones de cierre: **"Recibido Conforme"** y **"Recibido con Incidencias"**.
    4. Si ya está en un estado final (terminal) ➡️ Muestra una notificación indicando que el proceso finalizó y oculta las acciones de cambio.
- **Campos Condicionales y Validación:**
  - Los campos de cantidades recepcionadas e incidencias se ocultan completamente en las etapas iniciales de avance de la recepción para evitar inconsistencias.
  - Solo se muestran y validan cuando el administrador avanza el estado a uno de los cierres finales (`Recibido Conforme` o `Recibido con Incidencias`).
  - Se mantiene la validación obligatoria del comentario de etapa en cada avance para mantener la trazabilidad de la línea de tiempo.

---

## Verificación de Sintaxis
- `node -c js/app.js js/admin.js` ➡️ **Éxito (Sin errores de sintaxis)**

---

## Instrucciones para Puesta en Marcha (Usuario)

1. **Migración de Base de Datos:**
   - Para habilitar la opción de incluir/excluir el pedido inicial en el descuento de stock, debes actualizar la función `should_process_order_stock` en Supabase.
   - Copia el código actualizado de [supabase_schema_inventory_control.sql](file:///c:/Users/felip/Desktop/WMS%20STOCKA/supabase/supabase_schema_inventory_control.sql) y ejecútalo en el SQL Editor de tu consola de Supabase.

2. **Probar el Flujo de Edición (Cliente):**
   - Inicia sesión como cliente. En la tabla resumen, haz click en el botón **"Editar"** en una declaración en estado *"Creada"*.
   - Comprueba que el formulario de la izquierda se despliega con la información del registro y que el botón *"Cancelar"* restablece el formulario.
    - Modifica algún dato (por ejemplo, cambia la cantidad de unidades o desmarca un tipo de bulto) y presiona *"Guardar Cambios"*. Revisa que la tabla se actualice y que al abrir el modal *"Detalle"* figure la nota en el historial.

3. **Probar el Flujo Guiado (Administrador):**
    - Entra al panel de administración, abre el modal **"Gestionar"** en una declaración en estado *"Creada"*.
    - Comprueba que solo aparece el botón *"Marcar como: En Recepción - Pendiente Conteo"* y que los inputs de cantidad física están ocultos.

---

## 6. Validación en Tiempo Real del Pedido Inicial para Seguimiento de Stock

Hemos implementado un validador interactivo y proactivo para la configuración de inicio de descuento de stock de los comercios (disponible al hacer clic en **Configurar Comercio** en el listado de comercios del Administrador):

### Características de la Validación:
1. **Verificación en Base de Datos**:
   - Al escribir un ID de pedido o número de orden externa (ej: `1024` o un ID en formato UUID), el sistema consulta inmediatamente en la tabla `orders` si el pedido existe para el comercio seleccionado.
   - Soporta búsqueda de coincidencias exactas e incluye remoción inteligente del símbolo `#` (por ejemplo, si el usuario escribe `1024` pero en la DB se guardó como `#1024`).
2. **Alertas y Mensajes Dinámicos**:
   - **Spinner de Carga**: Se muestra un icono animado de carga (`ri-loader-4-line spin`) mientras se procesa la consulta con un breve debounce para evitar saturar la base de datos con consultas repetidas.
   - **Estado Válido (Verde)**: Si el pedido existe y coincide con la plataforma seleccionada (por ejemplo, Shopify), se dibuja un borde verde y el texto: `"¡Válido! Pedido encontrado (DD/MM/AAAA, Estado: [Estado])"`.
   - **Plataforma Incorrecta (Naranja)**: Si el pedido existe en la base de datos para ese comercio pero pertenece a una plataforma externa distinta a la del campo (por ejemplo, se ingresa en el campo de *Shopify* pero corresponde a *Manual*), muestra un mensaje de advertencia naranja: `"Encontrado en [Plataforma] (DD/MM/AAAA, Estado: [Estado])"`.
   - **No Encontrado (Rojo)**: Si el pedido no se encuentra para ese comercio, muestra un mensaje de advertencia rojo indicando que no se localizó la orden.
   - **Campo Vacío (Gris)**: Indica el comportamiento por defecto: `"Descontará stock desde el inicio (todas las órdenes)"`.

---

## 7. Consulta de Detalle de Stock Comprometido (Admin y Cliente)

Hemos implementado un visualizador interactivo para ver en detalle qué pedidos de venta y qué canales/clientes están comprometiendo stock de un determinado producto:

### Características:
1. **Acceso Rápido**: En la columna **Comprometido** de la tabla de stock (tanto en la vista del administrador como la del cliente), si la cantidad comprometida es mayor a cero, el número se mostrará como un enlace interactivo subrayado.
2. **Modal Informativa**: Al hacer clic en el número comprometido, se despliega una modal dedicada con la información del producto (Nombre, SKU y Bodega seleccionada).
3. **Filtro Inteligente por RPC (`get_committed_order_details`)**: 
   - Realiza la consulta directa a través de un procedimiento almacenado en Supabase que filtra de forma inteligente excluyendo estados terminales (`despachado`, `cancelado`, `entregado`, `retirado`).
   - Además, aplica la función `should_process_order_stock(order_id)` en caliente, garantizando que **solo se listen aquellos pedidos que se crearon posterior a la marca de inicio (inclusive/exclusive según el checkbox)**. Esto previene cualquier discrepancia visual con la cantidad de stock comprometida acumulada en la base de datos.
4. **Campos Mostrados**:
   - Fecha/Hora de creación del pedido.
   - Número de pedido o canal ID.
   - Canal de origen (Shopify, Falabella, MercadoLibre, Manual, etc.).
   - Nombre del cliente receptor.
   - Estado del pedido en tiempo real.
   - Cantidad exacta de unidades de este SKU que el pedido tiene comprometidas.
