# Walkthrough - Leads de la Demo, Consola Brevo y Coherencia de Datos Ficticios

Hemos completado e integrado con éxito el panel de control comercial de Leads de la Demo, la integración con la API de Brevo para envío de correos con plantillas personalizadas, y la coherencia completa de los pedidos, despachos y catálogo de productos del entorno simulado.

## Nuevas Características y Mejoras

### 1. Panel de Gestión de Leads (Administrador)
- **Estructura de Pestañas**: En la sección de *Gestionar Usuarios*, implementamos dos pestañas interactivas:
  - *Usuarios y Roles*: Muestra la lista de usuarios operativos (excluyendo leads demo).
  - *Leads de la Demo*: Lista exclusivamente a los usuarios registrados a través del formulario de la cuenta demo (`is_demo_user: true`).
- **Tarjetas de Estadísticas**: Añadimos indicadores visuales dinámicos que muestran:
  - *Total Leads*, *Nuevos*, *Contactados*, *En Seguimiento* y *Convertidos*.
- **Dropdown de Estado Comercial**: Permite actualizar en tiempo real el estado de cada lead (`nuevo`, `contactado`, `seguimiento`, `convertido`) con colores asociados para máxima claridad.
- **Notas de Seguimiento**: Los administradores pueden añadir y actualizar notas de texto específicas para cada lead con un botón de edición en línea.

### 2. Envío de Correos vía Brevo
- **Configuración Segura (API Key)**: Para proteger la clave de API de Brevo, esta se ingresa directamente en la UI del administrador y se almacena en el `localStorage` del navegador, evitando filtraciones en repositorios.
- **Remitente y Destinatario**: Preconfigurado con el emisor oficial `felipe.tp@stocka.cl`.
- **Plantillas Predefinidas (Editable)**:
  1. *Bienvenida a la Demo*: Correo inicial para presentarse, ofrecer soporte y agendar llamada comercial.
  2. *Seguimiento Comercial*: Consulta de experiencia con la demo e integraciones ecommerce.
  3. *Propuesta de Fulfillment*: Propuesta comercial formal de cierre.
- **Historial de Envíos**: Cada envío exitoso registra automáticamente la plantilla, asunto y fecha exacta en la base de datos de Supabase, manteniendo una bitácora detallada accesible en un modal flotante.

### 3. Coherencia de Datos Ficticios (Pedidos y Despachos)
- Sincronizamos las referencias de pedidos, nombres de destinatarios, couriers y trackings entre el catálogo de productos, la vista de pedidos y los despachos simulados.
- Añadimos la relación de la tabla `order_items` vinculada a `products` en el resolvedor de base de datos simulada (`MockQueryBuilder`) para que al expandir un pedido se muestre el detalle del artículo con su SKU y nombre real de catálogo.

---


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

---

## 8. Pantalla de Carga Premium en Módulo de Inventario (Cliente)
---

## 6. Sincronización de Filtros en Detalle de Stock Comprometido (Todas las Bodegas)

Hemos corregido la discrepancia visual entre el stock comprometido mostrado en la tabla de catálogo/inventario y el listado de pedidos del modal "Detalle de Stock Comprometido" al consultar la vista global ("Todas las Bodegas"):

1. **Filtrado en Frontend**:
   - Anteriormente, al hacer clic en el número de stock comprometido global, el modal realizaba una consulta directa de todas las órdenes activas en Supabase sin aplicar el filtro de inicio de pedidos (`should_process_order_stock`). Esto causaba que se listaran pedidos antiguos (anteriores al inicio configurado del comercio) y se mostrara una suma inflada (ej: 5 en lugar de 3).
   - Modificamos la consulta global en [admin.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/admin.js) y [app.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/app.js) para obtener la configuración adicional de comercio (`comercios_adicional_config`) y simular exactamente las mismas reglas de exclusión por canal y número de pedido inicial que la base de datos ejecuta.
2. **Sincronía Perfecta**:
   - Tras aplicar este filtro en Javascript para la consulta consolidada, el total de unidades comprometidas y el listado de pedidos en el modal ahora coinciden al 100% con los valores de la base de datos en todas las pantallas.

### Client Commerce & Orders Filter Updates (Added on July 31, 2026)

#### [MODIFY] [app.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/app.js)
- **Client Despachos (Shipments)**: Added a "Comercio" filter dropdown in `renderShipments()`. It is rendered conditionally **only** if the client user is associated with more than one commerce (i.e. `currentCompany` is comma-separated, e.g. `'RELAJARTE, SMILE FOR PETS'`).
- **Client Pedidos (Orders)**:
  - Removed the "Exportación Shopify" filter dropdown since it is not useful for client users.
  - Added a conditional "Comercio" filter dropdown in its place (using the same multi-commerce check).
  - Updated the filtering logic `window.applyClientWmsFiltersAndRender` to filter orders based on the selected commerce (`order.comercio`) and bound the change event listener.

---

## 7. Corrección de Sobreescritura en Sincronización (MercadoLibre/Walmart) y Saneamiento de Pedido (MAGIC MAKEUP)

Hemos solucionado una discrepancia en el stock comprometido de **MAGIC MAKEUP** (donde figuraba 1 unidad comprometida fantasma de `MAGIC064` debido a un pedido ya despachado en WMS):

1. **Bug en Sincronización**:
   - Descubrimos que al correr la sincronización de MercadoLibre (`sync_meli.js`) y Walmart (`sync_walmart.js`), si el pedido aún no figuraba como despachado en la plataforma origen, el script de integración actualizaba la columna `status` del WMS de vuelta a `'en preparación'` (estado activo) sin alterar `estado_wms = 'Despachado'`.
   - Modificamos ambos scripts para que **no** actualicen la columna `status` en Supabase si el pedido ya tiene un estado terminal (`despachado`, `cancelado`, `entregado`, `retirado`) en el WMS.
2. **Saneamiento de la Orden `MAG2000017541792738`**:
   - Movimos el ítem de la orden desde Bodega Central a **Matriz Ñuñoa** (donde está el stock real de MAGIC MAKEUP) y luego forzamos el estado de la orden a `'despachado'` mediante un script correctivo.
   - Esto disparó correctamente los triggers de la base de datos, descontando la unidad física y liberando el stock comprometido fantasma de `MAGIC064` en el catálogo.


Para mejorar el diseño visual y la experiencia de usuario (UX), hemos alineado el módulo de inventario con el de catálogo introduciendo una pantalla de carga dedicada:

### Detalles Visuales:
1. **Diseño Uniforme**: Utiliza un contenedor centrado con fondo de tarjeta de superficie (`var(--color-surface)`), bordes redondeados y sombra sutil.
2. **Animación Circular**: Muestra un spinner animado circular continuo que rota suavemente en 360 grados (`wms-spin`).
3. **Ícono Pulsante**: Centrado dentro del círculo de carga, el ícono de caja archivadora (`ri-archive-line`) tiene una animación de pulso continuo (`wms-pulse`) escalando suavemente de tamaño y opacidad.
4. **Textos**: Muestra el título *"Cargando mi Inventario"* en negrita junto con el texto de espera habitual.
---

## 14. Filtros Avanzados en Catálogo Master (Cliente y Administrador)

Hemos implementado filtros avanzados en tiempo real en las vistas de Catálogo Master, accesibles de forma idéntica en el panel del **Cliente** (`js/app.js`) y del **Administrador** (`js/admin.js`):

### Características de los Filtros:
1. **Canal / Origen:**
   - Permite filtrar los productos por su canal de integración: **Shopify**, **MercadoLibre**, **Falabella**, **Paris**, **WooCommerce**, **Jumpseller**, o aquellos registrados como **Manual (Sin canal)**.
2. **Estructura (Packs / Combos):**
   - Permite filtrar si el producto es un **Pack o Combo** o excluir packs para mostrar únicamente productos individuales.
3. **Tipo de Producto (Virtual vs. Físico):**
   - Permite filtrar si el producto es de tipo **Virtual** o **Físico**.
4. **Buscador Integrado en Tiempo Real:**
   - Los filtros funcionan de manera conjunta con la barra de búsqueda general y la ordenación (sorting) de columnas. Al cambiar cualquier filtro o término de búsqueda, la tabla se renderiza y ordena de inmediato en milisegundos sin recargar la página.
5. **Aviso de Resultados Vacíos:**
   - Si una combinación de filtros no produce resultados, en lugar de una tabla vacía confusa, se renderiza el mensaje: *"No se encontraron productos con los filtros seleccionados."*
---

## 15. Corrección de Pérdida de Listeners al Filtrar / Buscar

### Problema Detectado:
Al escribir en el buscador o cambiar un filtro, la tabla se limpia y se re-dibuja desde cero (sobrescribiendo `innerHTML` del contenedor `#catalog-master-tbody`). Esto causaba que los event listeners estáticos de los botones **"Editar"** y **"Eliminar"** (que se enlazaban únicamente una vez al cargar el módulo) se destruyeran, imposibilitando editar o eliminar cualquier producto después de realizar un filtrado.

### Solución Implementada:
Hemos migrado las acciones de edición y de eliminación a un modelo de **Delegación de Eventos** (Event Delegation) en `js/app.js` y `js/admin.js`:
- En lugar de escuchar los clicks directamente en cada botón, el event listener se asocia al elemento contenedor padre `#catalog-master-tbody`.
- Al hacer click en cualquier parte del cuerpo de la tabla, se detecta de forma dinámica el elemento más cercano que coincida con `.btn-edit-product` o `.btn-delete-product` mediante `e.target.closest()`.
- **Resultado:** Los botones de editar y eliminar siguen funcionando de manera ininterrumpida y persistente, sin importar cuántas veces se filtre, busque o re-ordene la tabla.

---

## 16. Mejoras de Interactividad y Cálculo en Gráficos de Evolución de Volumen

Hemos implementado ajustes finos para mejorar la visualización y exactitud en el panel de **Evolución de Volumen Diario** tanto en el Cliente (`js/app.js`) como en el Administrador (`js/admin.js`):

1. **Gráfico Limpio en Selección Individual**: 
   - Cuando se selecciona un comercio individual en el filtro de Comercio (`selectedCommerce` no vacío / `isStackedBar` es falso), se oculta la curva de totales ("Curva Total") que se superponía innecesariamente sobre la línea única del comercio.
   - De igual manera, se oculta la leyenda superior (`legend: { display: isStackedBar }`), dejando la línea del gráfico completamente despejada y limpia.
2. **Cálculo de Tendencia Corregido**:
   - Anteriormente, el indicador de **Tendencia Periodo** calculaba erróneamente el total en tiempo real sumando todos los comercios asignados al usuario en lugar del comercio seleccionado.
   - Ahora, al seleccionar un comercio individual, el cálculo de tendencia del periodo toma estrictamente la lectura en tiempo real del comercio seleccionado (`liveVolumeMap[selectedCommerce] || 0`), recalculando el porcentaje de forma exacta, reflejando correctamente las tendencias negativas si el comercio está en descenso.
3. **Optimización de Consultas en Tiempo Real**:
   - Se adaptaron las consultas en tiempo real a Supabase para filtrar por el comercio activo si hay un comercio individual seleccionado.

---

## 17. Implementación de Onboarding de Comercio y Notificaciones por Correo

Hemos implementado un sistema completo de Onboarding para la incorporación de nuevos comercios, que abarca desde la solicitud de alta del cliente hasta la revisión del administrador y las notificaciones automáticas.

### Características y Flujos:
1. **Formulario de Registro de Onboarding (`onboarding.html` y `js/onboarding.js`)**:
   - Formulario autoguiado dividido en 4 secciones lógicas (Datos de Contacto, Datos de Facturación, Configuración de Ventas/Logística y Carga del Contrato Firmado).
   - Sube el contrato firmado en formato PDF directamente a la carpeta segura `onboarding/` en Supabase Storage.
2. **Seguimiento del Cliente (`js/app.js`)**:
   - Si un usuario tiene el rol `observer`, su panel operativo se restringe. Se muestra un banner de seguimiento interactivo en tres pasos: **Enviado** ➡️ **En Revisión / Observada** ➡️ **Activación**.
   - Si su solicitud fue observada (rechazada para corrección), el cliente ve los motivos listados y tiene un acceso directo para volver a abrir el formulario de onboarding y corregir los datos.
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

---

## 8. Pantalla de Carga Premium en Módulo de Inventario (Cliente)

Para mejorar el diseño visual y la experiencia de usuario (UX), hemos alineado el módulo de inventario con el de catálogo introduciendo una pantalla de carga dedicada:

### Detalles Visuales:
1. **Diseño Uniforme**: Utiliza un contenedor centrado con fondo de tarjeta de superficie (`var(--color-surface)`), bordes redondeados y sombra sutil.
2. **Animación Circular**: Muestra un spinner animado circular continuo que rota suavemente en 360 grados (`wms-spin`).
3. **Ícono Pulsante**: Centrado dentro del círculo de carga, el ícono de caja archivadora (`ri-archive-line`) tiene una animación de pulso continuo (`wms-pulse`) escalando suavemente de tamaño y opacidad.
4. **Textos**: Muestra el título *"Cargando mi Inventario"* en negrita junto con el texto de espera habitual.
---

## 14. Filtros Avanzados en Catálogo Master (Cliente y Administrador)

Hemos implementado filtros avanzados en tiempo real en las vistas de Catálogo Master, accesibles de forma idéntica en el panel del **Cliente** (`js/app.js`) y del **Administrador** (`js/admin.js`):

### Características de los Filtros:
1. **Canal / Origen:**
   - Permite filtrar los productos por su canal de integración: **Shopify**, **MercadoLibre**, **Falabella**, **Paris**, **WooCommerce**, **Jumpseller**, o aquellos registrados como **Manual (Sin canal)**.
2. **Estructura (Packs / Combos):**
   - Permite filtrar si el producto es un **Pack o Combo** o excluir packs para mostrar únicamente productos individuales.
3. **Tipo de Producto (Virtual vs. Físico):**
   - Permite filtrar si el producto es de tipo **Virtual** o **Físico**.
4. **Buscador Integrado en Tiempo Real:**
   - Los filtros funcionan de manera conjunta con la barra de búsqueda general y la ordenación (sorting) de columnas. Al cambiar cualquier filtro o término de búsqueda, la tabla se renderiza y ordena de inmediato en milisegundos sin recargar la página.
5. **Aviso de Resultados Vacíos:**
   - Si una combinación de filtros no produce resultados, en lugar de una tabla vacía confusa, se renderiza el mensaje: *"No se encontraron productos con los filtros seleccionados."*
---

## 15. Corrección de Pérdida de Listeners al Filtrar / Buscar

### Problema Detectado:
Al escribir en el buscador o cambiar un filtro, la tabla se limpia y se re-dibuja desde cero (sobrescribiendo `innerHTML` del contenedor `#catalog-master-tbody`). Esto causaba que los event listeners estáticos de los botones **"Editar"** y **"Eliminar"** (que se enlazaban únicamente una vez al cargar el módulo) se destruyeran, imposibilitando editar o eliminar cualquier producto después de realizar un filtrado.

### Solución Implementada:
Hemos migrado las acciones de edición y de eliminación a un modelo de **Delegación de Eventos** (Event Delegation) en `js/app.js` y `js/admin.js`:
- En lugar de escuchar los clicks directamente en cada botón, el event listener se asocia al elemento contenedor padre `#catalog-master-tbody`.
- Al hacer click en cualquier parte del cuerpo de la tabla, se detecta de forma dinámica el elemento más cercano que coincida con `.btn-edit-product` o `.btn-delete-product` mediante `e.target.closest()`.
- **Resultado:** Los botones de editar y eliminar siguen funcionando de manera ininterrumpida y persistente, sin importar cuántas veces se filtre, busque o re-ordene la tabla.

---

## 16. Mejoras de Interactividad y Cálculo en Gráficos de Evolución de Volumen

Hemos implementado ajustes finos para mejorar la visualización y exactitud en el panel de **Evolución de Volumen Diario** tanto en el Cliente (`js/app.js`) como en el Administrador (`js/admin.js`):

1. **Gráfico Limpio en Selección Individual**: 
   - Cuando se selecciona un comercio individual en el filtro de Comercio (`selectedCommerce` no vacío / `isStackedBar` es falso), se oculta la curva de totales ("Curva Total") que se superponía innecesariamente sobre la línea única del comercio.
   - De igual manera, se oculta la leyenda superior (`legend: { display: isStackedBar }`), dejando la línea del gráfico completamente despejada y limpia.
2. **Cálculo de Tendencia Corregido**:
   - Anteriormente, el indicador de **Tendencia Periodo** calculaba erróneamente el total en tiempo real sumando todos los comercios asignados al usuario en lugar del comercio seleccionado.
   - Ahora, al seleccionar un comercio individual, el cálculo de tendencia del periodo toma estrictamente la lectura en tiempo real del comercio seleccionado (`liveVolumeMap[selectedCommerce] || 0`), recalculando el porcentaje de forma exacta, reflejando correctamente las tendencias negativas si el comercio está en descenso.
3. **Optimización de Consultas en Tiempo Real**:
   - Se adaptaron las consultas en tiempo real a Supabase para filtrar por el comercio activo si hay un comercio individual seleccionado.

---

## 17. Implementación de Onboarding de Comercio y Notificaciones por Correo

Hemos implementado un sistema completo de Onboarding para la incorporación de nuevos comercios, que abarca desde la solicitud de alta del cliente hasta la revisión del administrador y las notificaciones automáticas.

### Características y Flujos:
1. **Formulario de Registro de Onboarding (`onboarding.html` y `js/onboarding.js`)**:
   - Formulario autoguiado dividido en 4 secciones lógicas (Datos de Contacto, Datos de Facturación, Configuración de Ventas/Logística y Carga del Contrato Firmado).
   - Sube el contrato firmado en formato PDF directamente a la carpeta segura `onboarding/` en Supabase Storage.
2. **Seguimiento del Cliente (`js/app.js`)**:
   - Si un usuario tiene el rol `observer`, su panel operativo se restringe. Se muestra un banner de seguimiento interactivo en tres pasos: **Enviado** ➡️ **En Revisión / Observada** ➡️ **Activación**.
   - Si su solicitud fue observada (rechazada para corrección), el cliente ve los motivos listados y tiene un acceso directo para volver a abrir el formulario de onboarding y corregir los datos.
3. **Consola del Administrador (`js/admin.js`)**:
   - Muestra una pestaña **"Solicitudes de Alta"** con un listado filtrable (Todas, Pendientes, Aprobadas, Observadas).
   - Un modal de detalle para descargar el contrato PDF del cliente y revisar toda la información de facturación y embalaje.
4. **Formulario Interactivo de Observaciones (Modal en `js/admin.js`)**:
   - Al hacer clic en "Observar / Corregir", se despliega una modal con observaciones comunes (ej: falta firma del contrato, RUT inválido, etc.) que se pueden marcar con un solo click, además de un campo de comentarios detallados.
   - Consolda el resultado en una lista con viñetas en la base de datos.
5. **Notificaciones de Correo Inteligentes y Remitente Dinámico**:
   - Modificada la Edge Function de Supabase (`send-billing-email`) para procesar 4 plantillas de onboarding:
     - `onboarding_received`: Correo de bienvenida y confirmación enviado automáticamente al cliente.
     - `onboarding_approved`: Correo de activación de cuenta enviado automáticamente al cliente.
     - `onboarding_observed`: Correo con la lista detallada de observaciones/correcciones enviado automáticamente al cliente.
     - `onboarding_admin_notification`: Correo de alerta enviado automáticamente al administrador (`stockachile@gmail.com`) con una tabla resumen que incluye todos los detalles del nuevo comercio registrado y el enlace directo a su contrato.
   - En caso de correos de onboarding, el remitente se cambia de forma dinámica a `info@stocka.cl` (bajo el nombre "Stocka"), mientras que los cobros regulares se mantienen con `finanzas@stocka.cl`.
6. **Automatización vía Triggers de Base de Datos (`supabase_schema_onboarding.sql`)**:
   - Un trigger Postgres (`tg_onboarding_request_email`) invoca de manera asíncrona a la Edge Function de Supabase al insertar una solicitud:
     - Realiza una llamada HTTP para notificar al cliente del recibido.
     - Realiza una segunda llamada HTTP con el resumen estructurado de campos hacia `stockachile@gmail.com` para alertar al equipo de operaciones.
   - Al actualizar su estado (`approved` o `rejected`), se encarga de enviar los correos de actualización respectivos al cliente.
   - Una función RPC segura (`update_user_metadata_from_onboarding`) actualiza los metadatos de Auth para asegurar que el cambio de rol del usuario de `observer` a `client` persista de inmediato en su sesión activa sin requerir cerrar sesión.

---

## 18. Tarjetas de Resumen y Métricas en el Encabezado de Catálogo (Cliente y Admin)

Hemos implementado un conjunto de tarjetas de métricas en la sección superior de la vista de catálogo (junto al seleccionable de comercio), tanto en la vista de **Cliente** (`js/app.js`) como en la del **Administrador** (`js/admin.js`).

### Métricas Incluidas:
1. **SKUs en Catálogo:**
   - Muestra la cantidad total de SKUs registrados en el catálogo master del comercio.
   - Incluye el desglose dinámico indicando cuántos de esos SKUs poseen inventario físico actual mayor a cero en las bodegas.
2. **Packs / Combos:**
   - Cantidad de artículos configurados como Packs/Combos de productos.
3. **Artículos Virtuales:**
   - Cantidad de productos virtuales (servicios, intangibles o sin inventario físico).
4. **Incidencias:**
   - Número de incidencias activas en estado **Pendiente** asignadas al comercio, mostrando además el total histórico de incidencias registradas.

### Características Visuales y de UX:
- **Diseño Moderno:** Tarjetas con bordes redondeados (`radius-md`), fondo de tarjeta de superficie (`var(--color-surface)`), sombras sutiles y efectos de hover suaves.
- **Iconografía Integrada:** Iconos de Remix Icon específicos con colores de contraste agradables y semánticos (azul para SKUs, morado para Packs, verde para Virtuales, rojo para Incidencias).
- **Consistencia de Carga:** Muestra un estado de carga animado (*"Cargando estadísticas..."*) de manera asíncrona mientras se realizan las consultas a Supabase, evitando parpadeos bruscos en la interfaz.
- **Sincronización:** En la vista de administrador, el panel de tarjetas se oculta/muestra y actualiza en tiempo real de acuerdo al comercio seleccionado en el menú desplegable. En la vista del cliente, las métricas se recalculan automáticamente si este cambia de comercio activo.

---

## 19. Notificaciones y Popups Premium con SweetAlert2

Para mejorar la experiencia visual del usuario (UX) y transmitir mayor confianza y profesionalismo, hemos reemplazado las notificaciones estándar del navegador (`alert`) por alertas personalizadas y premium basadas en la librería **SweetAlert2** (que ya cuenta con estilos adaptados al tema oscuro/claro del WMS en `css/layout.css`):

1. **Inclusión de la Librería:**
   - Se añadió el CDN de **SweetAlert2** en [dashboard.html](file:///c:/Users/felip/Desktop/WMS%20STOCKA/dashboard.html).

2. **Interceptación Global de Alertas:**
   - Redefinimos la función global `window.alert` en [app.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/app.js) para que intercepte de manera transparente todos los mensajes de alerta del portal del cliente.
   - **Trazabilidad Inteligente de Iconos y Títulos:** El sistema analiza el contenido del mensaje en tiempo real para determinar dinámicamente si se trata de un mensaje de **Éxito** (`success`), **Error** (`error`), **Advertencia** (`warning`), o **Información** (`info`), personalizando el icono y el título de la alerta de forma adecuada.
   - **Estilo Coherente:** Las alertas ahora respetan el diseño de la aplicación, utilizando tipografía moderna, botones con estilo WMS y bordes redondeados.
   - **Mecanismo Fallback Seguro:** Si SweetAlert2 no está disponible o no ha terminado de cargar, el sistema usa el alert nativo sin generar recursividad.

---

## 20. Split-Screen Layout y Carrusel de Beneficios WMS en Onboarding

Para brindar una experiencia de registro (onboarding) de primer nivel, hemos rediseñado la interfaz del asistente de alta comercial migrando a una pantalla dividida (Split-Screen) en computadoras y tablets grandes:

1. **Diseño de Pantalla Dividida (`onboarding.html` y `js/onboarding.js`)**:
   - **Columna Izquierda (60% ancho)**: Contiene el formulario del asistente en 5 pasos (Datos de contacto, Facturación, Configuración Comercial, Firma del Contrato y Pantalla Final de Éxito).
   - **Columna Derecha (40% ancho)**: Un slideshow/carrusel de imágenes premium que rotan de manera interactiva mostrando los principales pilares del WMS y los beneficios del servicio.
   - **Diseño Responsivo**: En pantallas móviles el carrusel se oculta automáticamente para priorizar el espacio de digitación del formulario, adaptándose en una sola columna limpia.

2. **Rotación Interactiva y Automática de Slides**:
   - **Ciclo Automático**: Las imágenes y los textos del carrusel transicionan con un efecto de fundido cruzado suave (Fading) cada 5 segundos de forma automatizada.
   - **Controles de Indicadores (Dots)**: Se incluye un set de indicadores de posición interactivos en la parte inferior. Al hacer clic en un indicador, el carrusel cambia al slide seleccionado y reinicia el temporizador de forma inteligente.
   - **Respaldo de Diseño (Fallback Gradient)**: En caso de que las imágenes del carrusel no estén subidas o no se localicen, cada slide cuenta con una configuración CSS de fondo con degradados de color modernos basados en los colores corporativos de Stocka, asegurando que la interfaz siempre luzca profesional y premium.

3. **Ubicación de Imágenes Personalizadas**:
   - Se creó la carpeta de destino [`img/onboarding/`](file:///c:/Users/felip/Desktop/WMS%20STOCKA/img/onboarding/) con un archivo instructivo `README.txt` detallando los nombres exactos y resoluciones requeridas para que el usuario pueda subir sus propias fotos de logística:
     * `slide1.jpg` -> Operaciones de Bodega y Despacho.
     * `slide2.jpg` -> Conexión con Canales de Venta (Shopify, Mercado Libre, etc.).
     * `slide3.jpg` -> Monitoreo de Stock e Inventario.
     * `slide4.jpg` -> Same Day y Cobertura Multicourier.

---

## 21. Asignación de Comercio en Sincronización WooCommerce

Hemos solucionado el problema que provocaba que las órdenes importadas automáticamente desde tiendas **WooCommerce** se mostraran como pertenecientes a un comercio **"Desconocido"** en el panel de control de pedidos:

1. **Corrección de la Estructura de Datos de Sincronización:**
   - En el archivo de tareas programadas [sync_woocommerce.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/sync_woocommerce.js), se detectó que al estructurar el objeto de datos a guardar (`orderDataToSave`) no se estaba incluyendo la propiedad `comercio` de la integración. Esto causaba que la columna `comercio` en la tabla `orders` se guardara vacía (`null`).
   - Añadimos la línea `comercio: integration.comercio,` para garantizar que toda orden entrante de WooCommerce quede correctamente asociada al comercio correspondiente (ej: `'SIMPLEMENTE CAFE'`).

2. **Reparación y Corrección de Registros Existentes:**
   - Ejecutamos un script de base de datos a medida para buscar y corregir retroactivamente todos los pedidos de WooCommerce huérfanos. Las órdenes existentes asociadas al comercio de Eduardo Guaita (Simplemente Café) fueron actualizadas y asignadas correctamente a `'SIMPLEMENTE CAFE'`, normalizando por completo la visualización en las pantallas del WMS.

---

## 105. Corrección en la Detección y Etiquetado de Packs en Pedidos

Hemos corregido la lógica de detección de productos de tipo **Pack / Combo** en la lista de pedidos tanto en el panel del Administrador (`js/admin.js`) como en el del Cliente (`js/app.js`):

1. **Causa Raíz del Error**:
   - El sistema dependía de la inspección de los campos JSON crudos de integración (como `raw_shopify_data.line_items`, `raw_woocommerce_data.line_items`, etc.) para identificar si los ítems de un pedido contenían SKUs marcados como packs.
   - Sin embargo, para mejorar el rendimiento de la red y optimizar la velocidad de carga de las órdenes en el WMS, las consultas SQL omitían la descarga de estas columnas JSON completas (o solo traían campos mínimos como el estado). Al no estar presentes los line items crudos, el sistema nunca identificaba los packs y no mostraba la etiqueta `"Con Packs"`.

2. **Detección Directa y Confiable**:
   - Reestructuramos la lógica para comprobar las fuentes directas de información de la orden procesada:
     - **`order.sku`**: El SKU principal del pedido si es de un solo ítem.
     - **`order.order_items`**: Los productos asociados de forma nativa en la base de datos a la orden (que ya contiene los SKUs y cantidades procesadas en WMS).
     - **Fallback Crudo**: Se mantiene la inspección de datos crudos de integración por compatibilidad.
   - Si cualquiera de estos SKUs se encuentra en el conjunto global de packs cargados (`window.currentPackSkusList`), el sistema lo cataloga y muestra con éxito el badge morado **`Con Packs`** y el desglose de packs contenidos en el detalle de la fila.

---

## 106. Acciones Masivas en Catálogo de Administrador (Virtual vs. Físico)

Hemos implementado un sistema de **acciones masivas (bulk actions)** para el catálogo de productos en el panel del administrador (`js/admin.js`). Esto permite actualizar múltiples productos simultáneamente:

1. **Casillas de Selección y Barra Flotante**:
   - Se añadió un checkbox "Seleccionar Todo" en el encabezado de la tabla de catálogo.
   - Se agregaron checkboxes individuales en cada fila del producto.
   - Al seleccionar uno o más productos, aparece dinámicamente una barra superior de acciones masivas premium en color corporativo que indica el número de ítems seleccionados.
2. **Cambio de Estado Virtual/Físico en Lote**:
   - Permite a los administradores marcar todos los productos seleccionados como **Virtuales** o **Físicos** de un solo golpe.
   - Se integra con alertas SweetAlert2 para solicitar confirmación del usuario antes de aplicar la modificación masiva en la tabla `products` de Supabase.

---

## 107. Protección de Colisiones en Envíos por Comercio (Despachos)

Hemos implementado protección avanzada contra colisiones de referencias de envíos en el panel de administrador (`js/admin.js`):

1. **El Problema de las Referencias Duplicadas**:
   - Anteriormente, al filtrar la tabla de envíos unificados por número de referencia del pedido (`pedido_referencia`), si dos comercios distintos tenían una orden con la misma referencia (por ejemplo, el correlativo `#1024` o `1024` usado por Shopify en diferentes tiendas), ambos envíos aparecían asociados al pedido del comercio activo en la tabla de WMS, mezclando estados de courier incorrectos.
2. **Solución mediante Coincidencia de Comercio**:
   - El sistema ahora compara el campo `empresa_comercio_proveedor` del envío en `envios_unificados` con el campo `comercio` de la orden.
   - Se implementó un mapeo dinámico de IDs de Envíame (`enviameIdToCommerceMap`) para traducir códigos numéricos al nombre del comercio correspondiente.
   - Si se detecta que el envío pertenece a un comercio diferente al del pedido, se excluye de la renderización del pedido (tanto en la grilla principal del WMS como en el modal de detalle del pedido), garantizando una correlación 100% libre de colisiones cruzadas.

---

## 108. Adición del Estado "Cancelado" en Acciones Masivas del WMS

Para dar respuesta al requerimiento de anulación/cancelación masiva de pedidos por parte del usuario, realizamos las siguientes modificaciones:

1. **Dropdown de Acciones Masivas**:
   - Añadimos la opción `<option value="Cancelado">Cancelado</option>` a la barra de acciones masivas de la tabla de órdenes (`#bulk-wms-status`).
2. **Ejecución y Descuento de Inventario**:
   - Al marcar masivamente o de forma individual un conjunto de órdenes como `Cancelado`, se actualizan los campos correspondientes en Supabase.
   - Esto interactúa correctamente con los triggers de base de datos (`on_order_status_update` / `handle_order_status_change()`), liberando automáticamente el stock previamente comprometido (`committed_quantity`) de los ítems de las órdenes canceladas.

---

## 22. Visualización e Indicador de Stock Insuficiente en Pedidos (Admin y Cliente)

Hemos implementado un sistema visual de alertas en tiempo real para notificar tanto a los administradores del WMS como a los clientes cuando un pedido no tiene stock físico disponible suficiente en la bodega asignada:

1. **Restricción por Configuración de Comercio (`inventario_seguimiento`)**:
   - Para evitar ruido visual innecesario, estas alertas **solo se muestran para los comercios que tienen activa la opción de seguimiento de inventario** (`inventario_seguimiento: true` en la tabla `comercios_adicional_config`).

2. **Visibilidad en el Panel del Administrador (`js/admin.js`) y del Cliente (`js/app.js`)**:
   - **Badge en Ficha de Pedido (SIN STOCK)**: Si se detecta stock insuficiente, se renderiza un badge rojo **`SIN STOCK`** junto al número del pedido. Al pasar el cursor por encima (hover), un tooltip indica detalladamente qué SKUs están en falta y cuántas unidades se necesitan.
   - **Columna de Stock en el Desglose de Ítems**: Se incorporó una columna de **Stock** en la tabla detallada de ítems dentro del desplegable de cada pedido:
     * **Disponible**: Badge verde con el stock físico disponible en bodega.
     * **Insuficiente**: Badge rojo detallando las unidades disponibles vs. necesarias, y sombreado rojo en toda la fila para alertar al usuario.
     * **Virtual**: Los productos marcados como virtuales se eximen de la validación física y muestran un badge gris `Virtual`.

3. **Carga Optimizada en Lotes**:
   - Ambas vistas consultan la disponibilidad física de los productos en lotes agrupados (queries `IN` de Supabase) para evitar realizar peticiones individuales por fila, garantizando máxima velocidad y rendimiento en la carga del dashboard.

4. **Reglas de Exclusión Dinámica en Frontend (`shouldProcessOrderStockLocal`)**:
   - Se implementó la lógica en `js/admin.js` y `js/app.js` para ocultar proactivamente la alerta de **SIN STOCK** y el sombreado de filas insuficientes en:
     - Pedidos que se encuentren en estados terminales (`despachado`, `cancelado`, `entregado`, `retirado`).
     - Pedidos que sean anteriores al número de pedido inicial configurado para descontar stock (respetando la opción de incluir/excluir dicho pedido inicial configurada en el panel del administrador). Esto asegura consistencia total entre las alertas del frontend y el flujo del inventario.

---

## 23. Mapeo de Métodos de Envío desde WooCommerce

Hemos corregido la sincronización para extraer y mostrar de forma correcta el **Método de Envío** configurado por los clientes finales al comprar en tiendas WooCommerce (anteriormente figuraba como `"Por definir"`):

1. **Extracción Automática en la Sincronización:**
   - En el archivo [sync_woocommerce.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/sync_woocommerce.js), agregamos el campo `shipping_method` en el mapeo de órdenes (`orderDataToSave`).
   - Extraemos de manera dinámica el título legible de la primera línea de despacho de la orden utilizando: `order.shipping_lines?.[0]?.method_title || 'Por definir'`.

2. **Soporte Retroactivo en la Base de Datos:**
   - Escribimos y ejecutamos un script corrector (`scratch/fix_null_woocommerce_shipping.js`) para parsear las órdenes ya sincronizadas de WooCommerce.
   - Esto corrigió de manera inmediata el método de envío de los pedidos en el WMS: por ejemplo, actualizando `SIM3478` a `"Retiro Gratis (Av. Campos de Deportes 405. Ñuñoa)"` y `SIM3479` a `"Envío gratis"`.

---

## 24. Visualización de Ciudad/Comuna en Columna de Envío (Admin)

Para agilizar la revisión logística de despachos desde el panel de control de pedidos, hemos incorporado la visualización de la ciudad o comuna de destino directamente en la tabla principal del Administrador:

1. **Rediseño de la Celda "Envío":**
   - En [js/admin.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/admin.js), modificamos la renderización de la columna **Envío** para cambiar de una sola línea de texto a un contenedor flexible de dos líneas (`flex-direction: column`).
   - La primera línea sigue mostrando en negrita y tamaño destacado el **Método de Envío** de origen (ej: *Envío gratis* o *Retiro Gratis...*).
   - La segunda línea ahora muestra en tamaño más pequeño y color atenuado (`var(--color-text-muted)`) la **Ciudad/Comuna** registrada para el despacho (`order.shipping_city`), permitiendo a los operadores identificar el destino geográfico de un vistazo sin necesidad de abrir el detalle del pedido.

---

## 25. Autocompletado y Buscador Integrado de Productos en Pedidos Manuales

Hemos unificado la caja de búsqueda y el listado de resultados en un único componente de autocompletado nativo y fluido, evitando que el usuario tenga que interactuar con dos campos distintos (un input de búsqueda y un select):

1. **Diseño de Entrada Unificada (Single-Input Autocomplete):**
   - En [dashboard.html](file:///c:/Users/felip/Desktop/WMS%20STOCKA/dashboard.html), eliminamos el selector `<select>` apilado.
   - En su lugar, colocamos un campo de texto principal `#order-product-search` junto con un elemento flotante absoluto `#order-product-dropdown-list` para renderizar el menú desplegable de sugerencias y un input oculto `#order-product` para almacenar el UUID del producto seleccionado de forma transparente.

2. **Interacciones y Comportamiento Premium:**
   - En [js/app.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/app.js), registramos delegación de eventos para sincronizar el ciclo de vida del dropdown:
     * **Mostrar al enfocar/escribir:** Al dar clic o foco en el buscador, o al comenzar a escribir, el dropdown flotante se despliega mostrando el listado filtrado por SKU o Nombre.
     * **Selección con un clic:** Al hacer clic en cualquier opción sugerida, el valor visual se asigna al input de búsqueda (ej: *SKU - Nombre (Precio)*), el UUID se guarda en el campo oculto y el dropdown se cierra inmediatamente.
     * **Cerrar al hacer clic fuera:** Si el usuario hace clic en cualquier otra parte de la pantalla fuera del buscador o del menú flotante, el dropdown se cierra de manera limpia.
     * **Reinicio Automático:** Al hacer clic en "Añadir", el valor seleccionado y el campo de búsqueda se limpian por completo y el dropdown vuelve a ocultarse para permitir un nuevo ingreso limpio.

---

## 26. Automatización de Sincronización y Sincronización Manual para Shopify

Para garantizar que los pedidos de Shopify (como `HIT1017`) ingresen y se actualicen sin interrupciones, hemos implementado el motor de sincronización automática y manual para esta plataforma:

1. **Flujo de Trabajo Automatizado (Cron Job):**
   - Creamos el archivo de workflow de GitHub Actions [sync_shopify.yml](file:///c:/Users/felip/Desktop/WMS%20STOCKA/.github/workflows/sync_shopify.yml).
   - Configura la ejecución periódica automática cada 30 minutos (`cron: '*/30 * * * *'`), inyectando de forma segura las credenciales y tokens del WMS desde los secretos de GitHub para procesar todos los pedidos recientes de tiendas Shopify activas.

2. **Habilitación de Sincronización Manual:**
   - En la función Edge de Supabase [sync-integrations/index.ts](file:///c:/Users/felip/Desktop/WMS%20STOCKA/supabase/functions/sync-integrations/index.ts), agregamos el mapeo para la plataforma `'Shopify'` asociándola a su respectivo archivo de workflow.
   - En [js/admin.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/admin.js), incluimos `'Shopify'` en el listado de plataformas soportadas para sincronización manual (`supportManualSync`).
   - Esto habilita el botón de **"Sincronizar"** en el panel de integraciones del administrador para las tiendas Shopify, permitiendo forzar la actualización inmediata en caliente desde la interfaz web.

---

## 27. Corrección de RLS (Row-Level Security) en Carga de Contratos (Storage)

Hemos corregido el error `new row violates row-level security policy` que se producía cuando un usuario intentaba registrarse y subir su contrato firmado en el paso 4 del Onboarding:

1. **Origen del Problema**:
   - Al registrarse (`signUp`), el proceso de autenticación de Supabase requiere por defecto la confirmación del correo electrónico. Esto significa que a nivel de cliente el usuario **aún no tiene una sesión autenticada activa** (su sesión es anónima) al momento en que el código intenta subir el contrato PDF a Supabase Storage.
   - La política RLS anterior del bucket `service_docs` exigía que el rol del remitente fuera obligatoriamente `authenticated` para realizar subidas (`FOR INSERT TO authenticated`). Al no existir una sesión confirmada, el motor de Supabase bloqueaba la subida del archivo por seguridad RLS.

2. **Solución Aplicada**:
   - Modificamos la política RLS del bucket `service_docs` en [`supabase_schema_onboarding.sql`](file:///c:/Users/felip/Desktop/WMS%20STOCKA/supabase_schema_onboarding.sql) cambiándola a `FOR INSERT TO public`.
   - Esto permite que tanto usuarios autenticados como usuarios anónimos (durante su proceso de registro) puedan subir archivos, con la restricción de seguridad obligatoria de que la subida esté acotada únicamente a la carpeta segura `onboarding/` (`WITH CHECK (bucket_id = 'service_docs' AND (storage.foldername(name))[1] = 'onboarding')`).
   - Dado que los usuarios anónimos no tienen permisos de lectura (`SELECT`) sobre esta carpeta, no pueden listar ni descargar contratos ajenos, garantizando la confidencialidad de la información y solucionando el bloqueo en el flujo de registro.

---

## 28. Navegación Interactiva y Bloqueo Dinámico por Stepper en Onboarding

Hemos implementado la posibilidad de navegar entre los diferentes pasos del formulario de Onboarding haciendo clic directamente en los indicadores numéricos del stepper superior (1, 2, 3, 4, 5):

1. **Navegación Libre y Segura**:
   - El usuario puede hacer clic en cualquiera de los pasos numéricos en la parte superior para saltar directamente a esa sección y previsualizar qué datos se le solicitarán.

2. **Bloqueo Dinámico de Pasos Futuros**:
   - El sistema realiza un seguimiento continuo del paso máximo alcanzado (`maxReachedStep`) por el usuario a través de la validación natural del botón "Siguiente".
   - Si el usuario hace clic para visualizar un paso que está **adelante** de su progreso actual (`targetStep > maxReachedStep`), el panel correspondiente se muestra, pero **todos los campos de entrada, botones de opción, selectores y zonas de arrastre de archivos quedan deshabilitados (bloqueados)** de forma automática.
   - Si el usuario regresa a un paso ya desbloqueado (`targetStep <= maxReachedStep`), todos sus campos se vuelven editables de inmediato para permitir modificaciones.

3. **Aviso Explicativo**:
   - Cada panel que sea visualizado bajo estado bloqueado despliega automáticamente un banner informativo en la parte superior con un diseño moderno de color azul WMS (`alert-info`), indicando: *“⚠️ Tienes pasos previos sin resolver aún. Completa los pasos anteriores para poder editar esta sección.”*
   - Además, el botón "Siguiente" del pie de página se deshabilita visualmente y se bloquea su puntero para evitar envíos de pasos no resueltos.

---

## 29. Sub-etapas e Iconos de Guía en el Paso 3 (Comercial)

Para evitar que el paso 3 ("Comercial") se hiciera demasiado largo y fatigara al usuario al registrarse, hemos subdividido esta etapa en 4 sub-etapas lógicas y ligeras, guiadas por pestañas dinámicas e iconos:

1. **Estructura de las Sub-etapas**:
   - **3.1 Identidad de tu Comercio** (Icono: `ri-store-2-line`): Nombre de fantasía y sitio web.
   - **3.2 Canales e Integraciones** (Icono: `ri-links-line`): Plataformas de venta (Shopify, WooCommerce, etc.), marketplaces y configuraciones condicionales de Mercado Libre.
   - **3.3 Logística y Despacho** (Icono: `ri-truck-line`): Preferencias de courier para Santiago y Regiones, y opción de Retiro en Sucursal.
   - **3.4 Instrucciones de Embalaje** (Icono: `ri-box-3-line`): Detalle del packaging y empaque de sus productos.

2. **Sub-stepper Interactivo**:
   - Agregamos una barra superior horizontal inside del panel 3 con 4 pestañas interactivas y hermosos iconos de Remix Icon.
   - Las pestañas cambian de estilo automáticamente de acuerdo a la navegación (`active` con borde iluminado morado, `completed` en verde con checkmark implícito, u opaco/deshabilitado si no se ha alcanzado).
   - El botón **Siguiente** avanza secuencialmente a través de las sub-etapas validando cada sub-paso de forma independiente. El botón **Atrás** regresa de igual manera. Al finalizar el sub-paso 4, el usuario avanza naturalmente al Paso 4 (Firma).

3. **Iconos Guía**:
   - Agregamos iconos semánticos a cada una de las etiquetas y preguntas del formulario (`ri-global-line`, `ri-computer-line`, `ri-map-pin-line`, `ri-archive-line`, etc.) para hacer el llenado visualmente guiado e intuitivo.

---

## 30. Corrección de Cierre Sintáctico en Validación de Pasos (Onboarding)

Hemos solucionado un problema que bloqueaba la interactividad del asistente de Onboarding e impedía que los botones de navegación ("Siguiente", "Atrás") y los círculos del stepper respondieran:

1. **Origen del Problema**:
   - Durante la reestructuración del Paso 3 en sub-pasos, se omitió por accidente la llave de cierre (`};`) y el retorno por defecto (`return true;`) de la función de validación principal `validateStep(step)`.
   - Debido a esto, la función `updateStepper()` quedó anidada sintácticamente dentro de `validateStep()`, haciéndola inaccesible para los escuchadores de clics de los botones e indicadores superiores (lanzando un error silencioso de tipo `ReferenceError: updateStepper is not defined` en la consola).

2. **Corrección**:
   - Cerramos correctamente la declaración de `validateStep()` con su respectivo `return true; };` en [`js/onboarding.js`](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/onboarding.js), restaurando el alcance (scope) global de `updateStepper` e inicializando el asistente de Onboarding sin errores en consola.

---

## 31. Corrección en Modal de Stock Pendiente de Ingreso (Cliente)

Hemos solucionado el problema que afectaba a la ventana emergente de visualización de **Detalle de Stock Pendiente de Ingreso** en el panel del cliente (`js/app.js`):

1. **Origen del Problema (Placeholders Literales)**:
   - Los marcadores de posición `${name}`, `${sku}` y `${rowsHtml}` se mostraban literalmente como texto en lugar de evaluarse con sus valores reales. Esto se debió a un escape incorrecto con barras invertidas (`\${}`) en los literales de plantilla (template literals) de JavaScript.
   - Adicionalmente, el botón de cierre del modal (`Cerrar` o `×`) intentaba remover el elemento con ID `${modalId}` literalmente, lo cual retornaba `null` y arrojaba un error fatal en consola: `TypeError: Cannot read properties of null (reading 'remove')`.

2. **Solución**:
   - Eliminamos todos los caracteres de escape de barra invertida (`\`) de las variables de plantilla en [app.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/app.js).
   - Ahora, el modal renderiza dinámicamente el nombre, SKU e ingresa los registros correctos en la tabla de declaraciones pendientes de ingreso, y permite el cierre de la ventana sin generar errores en consola.

---

## 32. Estado de Pago, Alertas de Cancelación y Badges de Preparación (Fulfillment) en la Grilla

Hemos enriquecido la visualización del listado de pedidos en el panel del Administrador para proporcionar información crítica sobre transacciones y despachos de un vistazo, evitando que los operadores procesen por error pedidos cancelados o no pagados:

1. **Estado de Pago (Badges de Transacción):**
   - Incorporamos la visualización automática del estado de pago de cada pedido directamente bajo su ID en [js/admin.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/admin.js).
   - **`PAGADO`** (Badge verde `#d1fae5` / `#065f46`): Indica que la transacción se completó con éxito (estados `paid` o `authorized`).
   - **`PAGO PENDIENTE`** (Badge amarillo `#fef3c7` / `#92400e`): Alerta a los operadores que el pago no se ha completado (estados `pending` o `partially_paid`).
   - **`REEMBOLSADO`** (Badge rojo `#fee2e2` / `#991b1b`): Muestra estados de reembolso o anulación (`refunded`, `partially_refunded` o `voided`).

2. **Alertas de Pedido Cancelado:**
   - Si un pedido se cancela en la plataforma de origen (por ejemplo, Shopify) o en el propio WMS, se dibuja un badge rojo destacado de **`CANCELADO`** con un icono de error (`ri-close-circle-line`), advirtiendo a los preparadores detener cualquier tarea logística de inmediato.

3. **Estado de Preparación (Fulfillment) de Shopify:**
   - Para evitar doble preparación en el WMS, extraemos el estado logístico nativo de Shopify (`fulfillment_status`) desde el payload completo:
     * **`FULFILLED`** (Badge azul índigo `#e0e7ff` / `#3730a3`): El pedido ya fue despachado en la plataforma de origen.
     * **`FULFILL. PARCIAL`** (Badge naranja `#ffedd5` / `#9a3412`): El pedido tiene despachos parciales.
     * **`RESTOCKED`** (Badge gris `#f1f5f9` / `#475569`): Los ítems fueron devueltos al inventario de la tienda.

---

## 33. Estado WMS "Cancelado" para Archivado Libre de Impacto en Estadísticas e Inventario

Hemos implementado un nuevo estado de preparación/fulfillment en el WMS denominado **`Cancelado`**, que archiva los pedidos y los desvincula del cálculo de estadísticas y del compromiso de inventario:

1. **Liberación de Stock Automática (Triggers de Base de Datos):**
   - Al cambiar el estado de un pedido a `Cancelado` desde la interfaz, el campo `status` en la tabla `orders` se actualiza de manera sincronizada a `'cancelado'`.
   - Esto dispara el trigger nativo `handle_order_status_change()` de Supabase, que se encarga de restar automáticamente las unidades del pedido del campo `committed_quantity` (cantidad comprometida) en la tabla `inventory`, devolviendo la disponibilidad de stock a la bodega.

2. **Habilitación en la Interfaz (Dropdowns y Pestañas):**
   - Agregamos la opción **`Cancelado`** al selector de estados de la grilla del Administrador (`wms-status-select`) en [js/admin.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/admin.js), asignándole un estilo visual de color rojo en sus bordes.
   - Añadimos la pestaña **`Cancelado`** en los encabezados de pestañas del panel de administración ([js/admin.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/admin.js)) y del cliente ([js/app.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/app.js)) con un contador dedicado. Esto permite que los pedidos queden archivados de forma independiente sin mezclar la vista con pedidos activos.

3. **Exclusión de Estadísticas WMS:**
   - La lógica de cálculo de ventas totales en ambos dashboards (administrador y cliente) filtra y excluye explícitamente los registros en estado `'cancelado'`.

4. **Integración con la Sincronización de Shopify:**
   - Actualizamos el proceso de importación masiva [sync_shopify.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/sync_shopify.js). Ahora, si un pedido importado tiene fecha de cancelación (`cancelled_at` presente), se le asigna de manera inicial el estado `status = 'cancelado'` y `estado_wms = 'Cancelado'`. Además, si un pedido existente en la base de datos se cancela en la plataforma de Shopify, la tarea de sincronización periódica actualiza de forma segura su estado en el WMS a `Cancelado` para gatillar el retorno del stock.

---

## 34. Migración Unificada de Nombre de Comercio (POM KIDS)

Corregimos el problema de visualización del catálogo maestro, inventario y estadísticas de la integración tras el renombre del comercio **POMS KIDS** a **POM KIDS**:

1. **Unificación Completa de Base de Datos**:
   - Actualizamos todas las tablas vinculadas para que utilicen de forma consistente el nuevo nombre de comercio **`POM KIDS`** (sin la *S*), evitando inconsistencias por cruce de datos:
     * `comercios_adicional_config` (configuración adicional).
     * `products` (productos en catálogo master).
     * `synced_products` (catálogos sincronizados desde plataformas).
     * `merchant_integrations` (integración y credenciales).
     * `orders` (pedidos de venta históricos y activos).
2. **Prevención de Regresión por Sincronizadores**:
    - Al haber actualizado la tabla `merchant_integrations`, los scripts automatizados de sincronización (`sync_shopify.js`, `sync_woocommerce.js`) buscarán y procesarán los productos con el nuevo nombre, previniendo que reinserten registros duplicados con el nombre anterior.

---

## 35. Corrección de Bloqueo con Spinner en Modal de Edición de Pedidos

Corregimos un error de flujo y visualización en el modal de **Editar Ítems del Pedido** en el panel del Administrador, donde al hacer clic en "Guardar Cambios" sin haber modificado nada la pantalla quedaba bloqueada indefinidamente con un spinner de carga:

1. **Origen del Problema**:
   - Al pulsar "Guardar Cambios", el código llamaba inmediatamente a `Swal.fire({ title: 'Guardando cambios...', ... })` con `Swal.showLoading()`.
   - Luego, de manera síncrona en memoria, determinaba que la lista de cambios (`changesList`) estaba vacía y llamaba a `Swal.fire('Sin Cambios', 'No se realizaron modificaciones al pedido.', 'info')` saliendo de la función con `return`.
   - Debido al orden y a la interacción interna de SweetAlert2, el loader previamente activado no se cerraba ni limpiaba adecuadamente, dejando al usuario con el aviso de "Sin Cambios" pero con un spinner de carga infinito en la parte inferior del modal que impedía la interacción.

2. **Solución Aplicada**:
   - Reestructuramos la función `window.saveEditOrderItems` en [js/admin.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/admin.js) para realizar la comparación de ítems modificados de manera **previa** al despliegue de cualquier modal de carga.
   - Si no se detectan diferencias entre los productos/cantidades iniciales y los temporales, el sistema muestra directamente el SweetAlert2 informativo de "Sin Cambios" sin abrir jamás la animación de carga, evitando bloqueos y garantizando una experiencia de usuario fluida y libre de bugs.

---

## 36. Alertas Visuales y Estado "Insuficiente" en Grilla de Inventario (Admin y Cliente)

Hemos enriquecido la visualización del inventario de stock físico y comprometido en los paneles del Administrador (`js/admin.js`) y del Cliente (`js/app.js`):

1. **Estado "Insuficiente" Destacado**:
   - Si un producto tiene unidades comprometidas (`committed > 0`) pero no cuenta con stock físico en la bodega (`physical <= 0`), la etiqueta de estado de la fila cambia a **`Insuficiente`** en reemplazo de "Agotado".
   - Esta etiqueta se diseñó con un tono rojo más fuerte y sólido (fondo `#e11d48`, texto blanco y borde `#be123c`) para captar la atención de los operadores de manera inmediata.

2. **Icono de Alerta de Compromiso sin Stock**:
   - Al cumplirse la condición de insuficiencia, la cantidad de stock disponible (`Disp. (Bodega)` y `Disp. (Total)`) muestra un icono de advertencia rojo (`ri-error-warning-line`).
   - Al pasar el cursor por encima (hover), un tooltip nativo describe: *"El producto tiene unidades comprometidas pero no tiene unidades físicas en stock"*.

---

## 37. Correo de Bienvenida con Instrucciones de Declaración de Stock (WMS)

Hemos ampliado el flujo de correo automático enviado al cliente cuando el administrador aprueba su solicitud de Onboarding:

1. **Flujo del Correo `onboarding_approved`**:
   - Cuando el administrador aprueba la solicitud de alta en el panel (lo que promueve al usuario de `observer` a `client` y crea su comercio), el trigger de base de datos (`tg_onboarding_request_email`) asocia y dispara automáticamente un correo `onboarding_approved` al email del cliente.
   - Modificamos la plantilla HTML del correo en la Edge Function [`supabase/functions/send-billing-email/index.ts`](file:///c:/Users/felip/Desktop/WMS%20STOCKA/supabase/functions/send-billing-email/index.ts) para detallar que el siguiente paso crucial para operar es **crear su primera Declaración de Ingreso de Stock (D.I.)**.
   - **Explicación del Proceso Paso a Paso**: El correo contiene una guía estructurada y numerada indicando cómo:
     1. Iniciar sesión.
     2. Registrar el catálogo de productos y SKUs (requisito previo).
     3. Crear la Declaración de Stock desde el menú **Ingresos / Stock**.
     4. Descargar el comprobante en PDF, adherirlo de forma visible a los bultos/cajas y despachar la mercadería a la bodega WMS de Stocka.
   - **Llamada a la Acción (CTA)**: Se incluyó un botón de ingreso centralizado (`Ingresar al Portal WMS`) para facilitar el acceso rápido del cliente.

2. **Flujo de Confirmación de Correo Electrónico**:
   - **Primer Paso (Registro/SignUp)**: Al rellenar y enviar el formulario de onboarding (Paso 4), el sistema realiza un `signUp` en Supabase Auth. Si Supabase tiene activa la confirmación de email (lo cual es por defecto y muy seguro), la plataforma le envía de forma inmediata y automática un correo de verificación del email.
   - **Segundo Paso (Verificación)**: El usuario debe hacer clic en el enlace del correo de Supabase para validar su casilla de correo.
   - **Tercer Paso (Aprobación Admin)**: Tras la verificación del email, el usuario puede acceder al WMS pero en rol de observador (`observer`), viendo la barra de progreso de su alta. Una vez que el administrador lo aprueba, se le notifica por correo con la guía de Declaración de Stock y su rol cambia de inmediato a `client`, dándole acceso completo a las funciones operativas del WMS.

---

## 38. Actualización Automática de Inventario en Recepción de Declaraciones (WMS)

Hemos solucionado el problema por el cual el inventario físico (`inventory`) y el historial de transacciones (`movements`) de los productos no se actualizaban de manera automática al finalizar y confirmar la llegada de un ingreso de stock (declaración) en el panel del Administrador:

1. **Automatización de Entrada de Stock en Cierre**:
   - Modificamos el controlador de envío del formulario de gestión de declaraciones (`#form-manage-declaration` en [js/admin.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/admin.js)) para evaluar el cambio de estado.
   - Si la declaración pasa de un estado activo/pendiente (`Creada`, `Bodega Asignada`, `En Recepción - Pendiente Conteo`, `En proceso de conteo/clasificación`) a un estado finalizado de recepción (**`Recibido Conforme`** o **`Recibido con Incidencias`**), el sistema ahora ejecuta de manera automática el siguiente flujo:
     1. Obtiene la lista de productos de la declaración (desde la columna `products_list` o procesando dinámicamente la planilla Excel en `file_base64`).
     2. Para cada producto, localiza su ID en el catálogo (`products`) mediante coincidencia exacta e insensible a mayúsculas/minúsculas de su SKU.
     3. Busca el registro de inventario físico para el producto y la bodega asignada al ingreso. Si existe, suma la cantidad recibida; si no, crea un nuevo registro inicial en `inventory`.
     4. Registra un movimiento de tipo entrada (`type: 'in'`) en la tabla `movements` con el documento de referencia correspondiente (ej. *`Ingreso de Stock: [Título]`*) para mantener la trazabilidad completa.
   - **Control de Duplicados**: El proceso solo se dispara en la transición inicial a un estado final, evitando duplicaciones de stock si el administrador vuelve a editar campos secundarios de un ingreso ya cerrado.

2. **Reparación y Backfill Retroactivo ("Simplemente Café")**:
   - Diseñamos y ejecutamos un script de migración para regularizar los ingresos cerrados de **SIMPLEMENTE CAFE** de acuerdo a los requerimientos del comercio.
   - Dejamos sumado exclusivamente el ingreso *"grano clásico y envases"* (ID: `23483bd8-5ede-4b7b-a8d9-005182128284`), el cual registró e incrementó el stock de la bodega con **30 unidades** para el `SKU 2-1` (Grano Clásico 1 Kg.) con su respectivo log en la tabla de movimientos.
   - Cualquier otra regularización (como las del ingreso *"Café 3 variedades"*) fue revertida y eliminada del log de movimientos e inventarios para reflejar únicamente la entrada del ingreso solicitado.

---

## 39. Asignación Masiva de Stock a Bodegas desde los Paneles de Cliente y Admin

Hemos implementado una nueva funcionalidad que permite asignar/cargar stock de manera masiva a cualquier bodega del sistema, tanto desde el panel del Cliente (`js/app.js`) como del Administrador (`js/admin.js`):

1. **Botón en Interfaz de Inventario**:
   - Agregamos el botón **`Asignar Stock Masivo`** (con un estilo visual distintivo en color verde de éxito, borde y el icono `ri-upload-2-line`) justo al lado del botón "Exportar CSV" en los encabezados de las vistas de inventario de ambos paneles.

2. **Modal de Carga con Selector de Bodega**:
   - Al pulsar el botón, se despliega dinámicamente un modal elegante que guía al usuario en 3 simples pasos:
     1. **Selección de Bodega**: Un dropdown de selección obligatoria donde se listan todas las bodegas registradas.
     2. **Descarga de Plantilla**: Un botón que permite descargar una plantilla Excel (`plantilla_carga_masiva_stock.xlsx`) pre-formateada con las columnas requeridas: `SKU` y `Stock`.
     3. **Subida de Archivo**: Una zona interactiva de drag-and-drop o clic para arrastrar/seleccionar el archivo Excel con los datos.

3. **Validación y Vista Previa Dinámica**:
   - Al subir el archivo, el sistema procesa el contenido localmente y cruza los SKUs contra el catálogo master del comercio activo.
   - Lanza un modal detallado de vista previa de carga (reutilizando y ampliando la infraestructura de `window.showStockAndDimensionsPreviewModal`) que muestra:
     - El SKU y nombre del producto.
     - El stock físico actual de la bodega (Stock Anterior).
     - El stock declarado en el Excel (Stock Nuevo).
     - El estado del registro (Listo / Error) y detalles descriptivos (ej. si el SKU no pertenece al comercio, si el stock es un número inválido o negativo).
   - El botón de confirmación se bloquea si no hay registros válidos para subir.

4. **Sincronización Inteligente de Stock y Movimientos**:
   - Al confirmar la carga, para cada producto válido se calcula la diferencia (`newValue - oldValue`).
   - Si existe una variación (`diff !== 0`), el sistema:
     1. Actualiza el valor directo del inventario en `inventory` para asegurar la coincidencia exacta con el Excel.
     2. Inserta una transacción de ajuste en la tabla `movements` (con tipo `in` si la diferencia es positiva, u `out` si es negativa) bajo el documento de referencia `Carga Masiva Stock`.
   - Finalmente, se refresca automáticamente la grilla y el listado de inventario en la pantalla para reflejar los nuevos datos en tiempo real.

5. **Asignación Directa de Bodega y Stock por Selección**:
   - Para complementar la carga masiva mediante planillas Excel, hemos incorporado la funcionalidad de **Asignación Directa por Selección** en los paneles de Cliente (`js/app.js`) y Administrador (`js/admin.js`):
     - **Selección Múltiple**: Se añadió una columna de casillas de verificación (checkboxes) y un control de selección global ("Seleccionar Todo") en los encabezados y filas de ambas grillas de inventario.
     - **Acceso Rápido**: Un nuevo botón **`Asignar Bodega`** (de color acento) permite procesar de manera conjunta todos los productos seleccionados.
     - **Modal Interactivo**: Al hacer clic, se abre una ventana modal donde el usuario puede:
       1. Seleccionar la bodega destino.
       2. Ver el stock físico actual que tiene cada producto seleccionado en la bodega de destino elegida (se actualiza automáticamente al cambiar de bodega).
       3. Definir y ajustar directamente los nuevos niveles de stock para cada uno de los productos sin salir de la pantalla.
     - **Actualización y Trazabilidad**: El sistema realiza las actualizaciones en lote en la tabla `inventory` e inserta los logs correspondientes en `movements` bajo el documento de referencia `Ajuste Manual Bodega`, refrescando la vista principal tras la confirmación.

---

## 40. Ajuste y Reubicación de Etiquetas en Borde Inferior de Fila en Gestor de Pedidos

Ajustamos la visualización y distribución de las etiquetas/badges en el listado de pedidos tanto del Administrador ([js/admin.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/admin.js)) como del Cliente ([js/app.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/app.js)) para evitar que ensanchen la columna `ID` y alteren la alineación vertical de la tabla:

1. **Reubicación de Badges (Fila Exclusiva)**:
   - Extrajimos el contenedor de etiquetas (`Exportado`, `PAGADO`, `Con Packs`, `FULFILLED`, `SIN STOCK`, `CANCELADO`, `Etiqueta`, etc.) de la celda de la columna de ID.
   - Creamos una fila secundaria (`<tr class="order-badges-row">`) posicionada inmediatamente debajo de la fila de datos principal de cada pedido.
   - Esta fila de etiquetas cuenta con un `colspan` adaptado a la tabla correspondiente (`colspan="14"` en admin, `colspan="12"` en cliente) y un sangrado/padding izquierdo (`padding-left` de `3.4rem` en admin y `5.6rem` en cliente) que alinea horizontalmente las etiquetas justo debajo del número de pedido e ID.

2. **Fusión Visual y Sincronización de Hover (CSS)**:
   - Añadimos estilos específicos en [css/layout.css](file:///c:/Users/felip/Desktop/WMS%20STOCKA/css/layout.css):
     * Eliminamos el borde inferior de la fila principal (`.order-row td`) y se lo asignamos únicamente a la fila de etiquetas (`.order-badges-row td`), logrando que ambas filas se perciban visualmente como una sola tarjeta unificada.
     * Implementamos reglas avanzadas de hover en CSS (utilizando selectores modernos `:has()` y combinadores hermanos `+` para máxima compatibilidad):
       ```css
       .order-row:hover td,
       .order-badges-row:hover td,
       .order-row:has(+ .order-badges-row:hover) td,
       .order-row:hover + .order-badges-row td {
         background-color: var(--color-surface-hover) !important;
       }
       ```
       Esto asegura que si el usuario posiciona el cursor sobre la fila principal o sobre el espacio de las etiquetas, toda la estructura (pedido y etiquetas) se resalte de forma simultánea.

Gracias a esto, el gestor de pedidos ahora aprovecha el ancho completo de la fila para distribuir las etiquetas, previniendo columnas sobredimensionadas y manteniendo una interfaz limpia y profesional.

---

## 41. Ajuste de Stock y Traslado Masivo entre Bodegas (WMS)

Hemos refinado y ampliado las operaciones masivas de inventario en los paneles de Cliente (`js/app.js`) y Administrador (`js/admin.js`):

1. **Renombramiento de "Asignar Bodega" a "Ajustar Stock"**:
   - Para evitar confusiones semánticas con la acción de traslado o asignación inicial de bodega, renombramos los botones, modales y controladores de la acción de edición directa de stock a **`Ajustar Stock`**.
   - Ahora, al seleccionar varios productos en la grilla y hacer clic en **`Ajustar Stock`**, se abre el modal correspondiente que permite definir la cantidad exacta final de cada artículo en una bodega seleccionada, registrando los movimientos bajo el concepto de `Ajuste Manual Stock`.

2. **Nuevo Flujo de "Traslado de Stock"**:
   - Diseñamos e implementamos un nuevo botón **`Traslado de Stock`** (con estilo en tonalidad naranja `#d97706` e icono `ri-arrow-left-right-line`) en las grillas de inventario de cliente y administrador.
   - Al seleccionar productos y hacer clic en este botón, se abre un modal de traslado que permite:
     1. **Seleccionar Bodega de Origen y Bodega de Destino** (validando que sean distintas y estén correctamente seleccionadas).
     2. **Visualizar el stock disponible en la bodega de origen** en tiempo real.
     3. **Ingresar la cantidad a trasladar** para cada producto, validando que no sea mayor que el stock disponible en el origen ni un valor negativo.
     4. **Ejecutar la reubicación**: Resta el stock en la bodega de origen e incrementa la misma cantidad en la bodega de destino (creando el registro si no existía en el destino).
     5. **Registrar de forma separada los movimientos**: Crea un movimiento de salida (`type: 'out'`) para la bodega de origen referenciando `Traslado a [Nombre de Destino]` y un movimiento de entrada (`type: 'in'`) en la bodega de destino referenciando `Traslado desde [Nombre de Origen]`.

---

## 42. Corrección de Políticas RLS para Modificaciones de Ítems del Pedido (Admin)

Corregimos el error de base de datos (`violates row-level security policy for table "order_items"`) que impedía a los administradores del WMS guardar cambios (insertar, actualizar o eliminar) sobre la tabla `order_items` al editar pedidos desde la grilla principal:

1. **Origen del Problema**:
   - La tabla `order_items` tenía habilitado RLS (Row-Level Security) con una única política activa para lectura de clientes (`Clientes ven items de sus pedidos`).
   - La política de administrador previa (`Admin can view and modify all order items`) carecía de una cláusula `WITH CHECK` explícita y no utilizaba la calificación de esquema `public.` para la función `is_admin()`. 
   - Al realizar un `INSERT` o `UPDATE` desde el panel de administración, el motor de Supabase fallaba en la resolución de permisos de inserción en la tabla de ítems de órdenes, denegando la consulta con un error de violación de políticas RLS.

2. **Solución y Migración SQL**:
   - Diseñamos la migración [supabase_schema_order_items_rls_fix.sql](file:///c:/Users/felip%20WMS%20STOCKA/supabase_schema_order_items_rls_fix.sql) para limpiar y recrear la política de acceso total de administrador.
   - Definimos explícitamente la política sobre `public.order_items` para que permita todas las acciones (`FOR ALL`) a usuarios autenticados (`TO authenticated`), utilizando `public.is_admin()` tanto en la cláusula `USING` (lectura/borrado) como en la cláusula `WITH CHECK` (inserción/modificación).
   - Esto autoriza de manera segura y definitiva a los usuarios con rol de administrador (`role = 'admin'`) a guardar cualquier cambio estructural en los ítems del pedido sin generar bloqueos en la interfaz.

---

## 43. Botón de Actualización Sin Recarga de Navegador (Gestor de Pedidos WMS)

Agregamos un nuevo botón **`Actualizar`** en el Panel de Control de Pedidos del Administrador ([js/admin.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/admin.js)) que permite refrescar las órdenes y sus dependencias en tiempo real sin recargar la página completa ni perder los filtros activos:

1. **Ubicación en Interfaz**:
   - Incorporamos el botón en la cabecera de la grilla de pedidos, posicionado junto al botón de "Gestionar Opciones". Utiliza el icono `ri-refresh-line` y cuenta con una animación de carga (`spin`) mientras la operación está en curso.

2. **Comportamiento y Preservación de Filtros**:
   - Al pulsarlo, el controlador `window.refreshWmsOrders(btn)` realiza un re-fetch asíncrono de los datos esenciales de Supabase:
     * Pedidos del mes en curso y sus correspondientes ítems de orden.
     * Despachos unificados (`envios_unificados`).
     * Asignaciones de operarios picker y mapas de inventario comprometido.
   - Una vez finalizada la consulta, vuelve a invocar de forma síncrona `applyWmsFiltersAndRender()`. Al no recargar la página completa, los selectores de filtro y buscador (que residen en el DOM) conservan sus estados intactos, aplicando instantáneamente los mismos criterios sobre la nueva data cargada.
   - Para agilizar la respuesta al usuario, los pedidos históricos se vuelven a cargar y fusionar en segundo plano de manera transparente, permitiendo que la interfaz siga operativa de inmediato.

---

## 44. Corrección en Eliminación de Ítems del Pedido sin SKU Asociado (S/SKU)

Corregimos un error crítico en el modal de edición de ítems de pedidos ([js/admin.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/admin.js)) que impedía eliminar o actualizar correctamente aquellos ítems que carecían de un producto registrado en el catálogo (`product_id: null` en la base de datos, mostrándose como `S/SKU` en la interfaz):

1. **Origen del Problema**:
   - Anteriormente, el flujo de comparación y persistencia de cambios en `saveEditOrderItems` identificaba los registros utilizando el identificador del producto (`product_id`).
   - Al guardar los cambios, si un producto era eliminado de la orden temporal y su `product_id` era `null`, el sistema ejecutaba la consulta Supabase `.delete().eq('product_id', null)`. En SQL, la comparación `product_id = NULL` siempre evalúa a falso, resultando en que la fila nunca se eliminaba de la tabla `order_items` de la base de datos (se borraban 0 filas).
   - Adicionalmente, al reconstruir la lista de catálogo `commerceProducts` dentro del controlador de eliminación `removeTempEditItem`, se extraían los valores del datalist del DOM, perdiendo los identificadores reales de producto (`id: null`) al faltar el atributo `data-id`.

2. **Refactorización y Solución de Clave Primaria**:
   - **Identificación por Clave Primaria (`id`)**: Modificamos el mapeo de inicialización en `openEditOrderItemsModal` para que cargue y preserve el identificador único de la fila (`id` de `order_items`).
   - **Flujo de Persistencia Seguro**: Adaptamos `saveEditOrderItems` para que realice las consultas `.delete().eq('id', orig.id)` y `.update(...).eq('id', orig.id)`. Al apuntar directamente a la clave primaria de la tabla intermedia en lugar del `product_id`, las operaciones de eliminación y actualización funcionan con precisión del 100%, incluso si el ítem de la orden tiene un producto nulo o no catalogado.
   - **Persistencia Global de Catálogo**: Centralizamos el listado de productos de la tienda en `window.tempCommerceProducts` cuando se abre el modal. Esto elimina por completo la necesidad de reconstruir o parsear el datalist del DOM al borrar elementos, previniendo fallos en asignaciones de IDs posteriores.
   - **Sincronización con el Buscador**: Agregamos el atributo `data-id="${p.id}"` en la renderización de las opciones del datalist para mantener la consistencia e integridad de datos del catálogo durante la búsqueda.

---

## 45. Vista de Inventario Agrupada y Detalle Desplegable por Bodega

Hemos unificado y optimizado la presentación de stock de productos en los paneles de **Cliente** (`js/app.js`) y del **Administrador** (`js/admin.js`), agrupando los registros a nivel de producto único y delegando el detalle de existencias por bodega a una interfaz desplegable interactiva:

### Mejoras Incorporadas:
1. **Agrupación Consolidada**:
   - En lugar de repetir múltiples filas del mismo producto (una por cada bodega donde tiene existencias), la tabla principal de inventario muestra ahora una única fila consolidada por SKU.
   - Las métricas de **Stock Físico**, **Comprometido** y **Disponible Total** muestran la suma acumulada de existencias de todas las bodegas del comercio.
2. **Detalle Desplegable e Interactivo**:
   - La columna **Bodega** incluye un botón selector interactivo (`Mostrar Bodegas (N)` / `Ocultar Bodegas (N)`) que permite desplegar sub-filas hijas.
   - Estas sub-filas muestran el desglose de stock físico y comprometido específico de cada bodega activa, usando un conector curvo (`ri-corner-down-right-line`).
   - Se filtran automáticamente las bodegas con stock `0` para no saturar la pantalla con registros innecesarios.
3. **Mapeo de Datos en CSV**:
   - La exportación a CSV mantiene la granularidad original (desglosado por bodega) para facilitar análisis contables detallados y auditorías externas.
4. **Detalle de Pedidos Comprometidos Consolidado**:
   - Al hacer clic en el stock comprometido de la fila consolidada principal, se consultan y despliegan los pedidos pendientes que comprometen stock del producto a lo largo de **todas** las bodegas.
   - Al hacer clic en una sub-fila de bodega específica, se muestra el detalle filtrado para esa bodega concreta.
5. **Métricas de Dashboard Inteligentes**:
   - La sección de métricas globales de stock y alertas de bajo stock agrupan los datos por SKU único para evitar contar múltiples alertas para un mismo producto distribuido en varias bodegas.

---

## 46. Columna de Tipo de Producto en la Tabla de Inventario (Client & Admin)

Hemos agregado la columna **`Tipo`** en la tabla de inventario tanto en la interfaz de Cliente ([js/app.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/app.js)) como en la de Administrador ([js/admin.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/admin.js)):

1. **Ubicación e Integración Visual**:
   - La nueva columna se posiciona justo al lado derecho de la columna **Producto** y a la izquierda de **Bodega**, en perfecto orden lógico y estético.
   - Cuenta con una cabecera interactiva y ordenable (`data-sort="product_type"`) para que los usuarios puedan clasificar y agrupar el inventario según el tipo de producto.

2. **Indicadores de Tipo de Producto (Badges)**:
   - Evaluamos de forma precisa el estado del producto basándonos en sus atributos booleanos (`is_virtual` e `is_pack` cargados desde Supabase):
     * **`Online`**: Mostrado con un badge gris de fondo alternativo, texto principal y el icono `ri-computer-line` en color azul principal, indicando que el producto es virtual o digital.
     * **`Pack`**: Mostrado con un badge violeta translúcido (`rgba(139, 92, 246, 0.1)`), texto violeta e icono `ri-stack-line` para identificar conjuntos o combos de productos.
     * **`Físico`**: Mostrado con un badge verde esmeralda translúcido (`rgba(16, 185, 129, 0.1)`), texto verde e icono `ri-archive-line` para bienes físicos estándar.

3. **Alineación de Detalle por Bodega**:
   - Ajustamos las celdas y el atributo `colspan` de las filas hijas detalladas por bodega para mantener una grilla alineada del 100%, incrementando la cantidad de columnas de `12` a `13`.

---

## 47. Mapeo Completo de Bodegas con Iconos y Filtro por Tipo de Producto en Inventario

Hemos ampliado las capacidades de visualización del inventario de Cliente ([js/app.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/app.js)) y Administrador ([js/admin.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/admin.js)):

1. **Mapeo Completo de todas las Bodegas en el Detalle**:
   - Anteriormente, al expandir la fila de un producto, solo se listaban aquellas bodegas que tuvieran existencias físicas o comprometidas registradas (`quantity > 0` o `committed_quantity > 0`), omitiendo bodegas activas con stock en 0.
   - Ahora, el sistema consulta dinámicamente el listado completo de bodegas (`window.allWarehousesList`) asociadas y construye para cada producto el desglose total.
   - Si una bodega tiene stock en `0` (físico y comprometido), se muestra de todas formas en la sub-tabla con una **opacidad reducida (0.65)** y con los contadores de stock atenuados, indicando claramente la ausencia de existencias en dicha ubicación sin ocultar su disponibilidad como bodega de destino potencial.

2. **Iconografía Específica por Bodega**:
   - Para mejorar la escaneabilidad visual, asignamos iconos contextuales según el nombre de la bodega:
     - **`Bodega Central` o similares**: Icono de edificio (`ri-building-2-line`) en color azul primario.
     - **`Tienda`, `Showroom` o similares**: Icono de tienda (`ri-store-3-line`) en color accent violeta.
     - **`Virtual`, `Online` o similares**: Icono de nube (`ri-cloud-line`) en color azul celeste.
     - **Otras bodegas**: Icono de base de datos general (`ri-database-2-line`) en color atenuado.

3. **Selector de Filtro de Tipo de Producto**:
   - Incorporamos un nuevo control desplegable **`Todos los Tipos / Físico / Pack / Online`** en la barra de filtros del inventario (al lado de la barra de búsqueda por SKU/nombre) en ambos paneles.
   - Al seleccionar un tipo, se ejecuta un filtrado reactivo local instantáneo que limita la grilla únicamente a los productos correspondientes, recalculando la paginación y las sumatorias en tiempo real.

---

## 48. Ampliación y Visualización de Totales en Modal de Traslado de Stock entre Bodegas

Optimizamos la experiencia de usuario y la visibilidad de datos al realizar traslados de stock en lote desde el panel de Cliente ([js/app.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/app.js)) y del Administrador ([js/admin.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/admin.js)):

1. **Aumento de Dimensiones del Modal**:
   - Incrementamos el ancho máximo de la ventana emergente (`max-width: 850px; width: 90%`) y limitamos su altura para dispositivos pequeños (`max-height: 90vh`).
   - Elevamos la altura útil del contenedor de la tabla de definición de cantidades de `250px` a `450px` (`max-height: 450px; overflow-y: auto`), facilitando la visualización y edición cómoda cuando se seleccionan múltiples productos simultáneamente.

2. **Indicador en Tiempo Real de Unidades Totales de la Bodega de Origen**:
   - Añadimos una etiqueta de información dinámica (`#transfer-source-total-stock`) alineada al lado derecho del título de la bodega de origen.
   - Al seleccionar una bodega de origen, el sistema calcula de forma instantánea:
     - El stock sumado de los productos seleccionados en esa bodega.
     - El stock total general (de todos los productos) registrado en dicha bodega.
     - Muestra un formato descriptivo y claro: *`Total seleccionados: X uds. / Total general: Y uds.`* para dar contexto inmediato de la carga y capacidad física de la ubicación de origen antes de proceder con el traslado.

---

## 49. Traslado Completo de Todo el Stock de una Bodega a Otra (WMS)

Hemos añadido una opción avanzada que permite trasladar el 100% de las existencias físicas de todas las mercancías de una bodega de origen a otra de destino en un único paso, simplificando mudanzas de inventario y reestructuraciones de almacenamiento:

1. **Opción interactiva en el Modal de Traslado**:
   - Agregamos una opción y casilla de verificación en el modal: **"Trasladar todo el stock disponible de la bodega de origen a la de destino"**.
   - **Activación Inteligente**: Si el usuario abre el modal de traslado sin haber seleccionado previamente productos en la grilla principal, el sistema detecta la ausencia de selección, activa de forma automática esta opción y la bloquea como obligatoria. Además, muestra un mensaje descriptivo indicando que se trasladará el 100% de las unidades físicas de todos los productos que tengan stock activo en el origen.
   - Si hay una selección de productos, el checkbox se muestra habilitado, permitiendo al usuario decidir si prefiere ignorar la selección y trasladar todo el stock del origen.

2. **Procesamiento de Inventario Masivo**:
   - Al confirmar el traslado masivo total:
     1. Consulta todos los productos pertenecientes al catálogo del comercio seleccionado.
     2. Recupera todas las existencias físicas en la bodega de origen para dichos productos (excluyendo registros con stock `0`).
     3. Para cada uno, reduce la cantidad física en origen a `0`, incrementa en la misma medida la bodega de destino, y registra los movimientos de entrada y salida individuales en la tabla de auditoría `movements`.
     4. Al finalizar, refresca la grilla principal en tiempo real.

---

## 50. Eje Vertical en Cero para Gráficos de Evolución de Volumen (Admin y Cliente)

Hemos configurado los ejes verticales (`y-axis`) de los gráficos de Evolución de Volumen Diario en ambos paneles para que se inicialicen forzosamente desde cero (`min: 0`) en lugar de ajustarse automáticamente al volumen más bajo registrado, garantizando una representación visual honesta y libre de distorsiones en las fluctuaciones de volumen por metro cúbico.

---

## 51. Validación de Stock de Pedidos contra Stock Total (Todas las Bodegas)

Modificamos el algoritmo de verificación visual de stock de los pedidos en los paneles de Cliente ([js/app.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/app.js)) y Administrador ([js/admin.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/admin.js)), pasando de una validación a nivel de bodega asignada/defecto (Central) a una validación consolidada contra el stock total acumulado del comercio:

1. **Motivación del Cambio**:
   - Anteriormente, al importarse los pedidos de plataformas externas, a los ítems del pedido se les asignaba la bodega por defecto (generalmente Bodega Central).
   - El indicador de alerta visual **`SIN STOCK`** (badge rojo) y la columna de disponibilidad en la grilla desplegable realizaban el chequeo únicamente contra las existencias registradas en esa bodega específica. Esto generaba falsas alertas de falta de stock en pedidos cuando el producto en cuestión sí tenía existencias suficientes distribuidas en otras bodegas de la misma tienda.

2. **Solución Implementada**:
   - **Badge de Alerta Principal**: Modificamos el ciclo de verificación de ítems en el renderizado de la fila del pedido. Ahora, en lugar de consultar solo `invMap[product_id_warehouse_id]`, el sistema busca y suma las existencias físicas de dicho producto a lo largo de todas las llaves de bodega asociadas en el mapa de inventario cargado localmente (`window.loadedOrdersInventoryMap` / `window.clientOrdersInventoryMap`).
   - **Tabla Desplegable del Detalle de Pedido**: Adaptamos la celda de disponibilidad en la sub-tabla desplegable para reflejar la cantidad total agregada de todas las bodegas. Ahora indica correctamente si el artículo está disponible o si es insuficiente considerando el stock global del comercio.

---

## 52. Manejo de Tokens de Acceso Offline que Expiran (Expiring Offline Tokens) de Shopify

Corregimos y refinamos el flujo de integración de Shopify ([supabase/functions/shopify-oauth/index.ts](file:///c:/Users/felip/Desktop/WMS%20STOCKA/supabase/functions/shopify-oauth/index.ts)) para adaptarlo a las nuevas políticas de seguridad obligatorias de Shopify:

1. **Requisito de Shopify (Tokens con Expiración)**:
   - Para aplicaciones públicas registradas recientemente, Shopify ya **no permite el uso de tokens de acceso offline no expirables** (permanentes). Cualquier intento de realizar llamadas al API con un token permanente retorna un error `403 Forbidden` informando que se debe usar "expiring offline tokens".
   - Por esta razón, la Edge Function `shopify-oauth` debe incluir obligatoriamente el parámetro `"expiring": 1` al solicitar el token en el flujo OAuth. Esto devuelve un token de acceso (`access_token`) con una validez de 60 minutos y un token de actualización (`refresh_token`) con una validez de 90 días (que se renueva con cada ciclo de refresco).

2. **Sincronización en Segundo Plano**:
   - Para que el script de sincronización en GitHub Actions (`sync_shopify.js`) pueda rotar el token de acceso usando el `refresh_token`, es indispensable que las variables de entorno `SHOPIFY_CLIENT_ID` y `SHOPIFY_CLIENT_SECRET` estén configuradas.
   - Hemos confirmado que el flujo de trabajo de GitHub Actions (`sync_shopify.yml`) inyecta estas variables correctamente desde los secretos del repositorio, garantizando el refresco automático cada 30 minutos sin interrupciones.

3. **Acción Requerida**:
   - El cliente de **Smile for Pets** debe ir a la sección de **Integraciones**, hacer clic en **Conectar / Re-conectar** e iniciar sesión nuevamente. Con esto, Shopify generará un token offline con expiración oficial y un refresh token válidos, permitiendo que la sincronización vuelva a fluir correctamente.

---

## 53. Animación de Carga (Spin) en Botón de Actualización de Pedidos

Añadimos la regla de estilo para la clase CSS `.spin` en la hoja de estilos global ([css/style.css](file:///c:/Users/felip/Desktop/WMS%20STOCKA/css/style.css)) para habilitar la animación visual de rotación del icono de refresco al pulsar el botón de actualizar pedidos en el panel del administrador:

1. **Origen del Problema**:
   - Al pulsar el botón "Actualizar", el controlador JS desactivaba el botón y agregaba la clase `spin` al icono (`ri-refresh-line spin`).
   - Sin embargo, no existía ninguna regla CSS asociada a la clase `.spin`, por lo que el icono permanecía estático sin ofrecer feedback visual de que se estaba ejecutando una consulta asíncrona en segundo plano.

2. **Solución Implementada**:
   - Declaramos la clase CSS `.spin` vinculándola a la animación `@keyframes spin` ya existente en la hoja de estilos:
     ```css
     .spin {
       animation: spin 1s linear infinite;
       display: inline-block;
     }
     ```
   - Esto hace que el icono rote de forma continua a velocidad constante mientras dura el fetch y se remueva inmediatamente en el bloque `finally` del controlador JS al completarse la sincronización, mejorando la experiencia de usuario.

---

## 54. Tratamiento de Stock Comprometido como Global (WMS)

Hemos modificado las vistas de inventario y los flujos de cálculo en los paneles de Cliente ([js/app.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/app.js)) y del Administrador ([js/admin.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/admin.js)) para considerar el stock comprometido como un indicador puramente global del producto, evitando asignarlo o descontarlo de bodegas físicas individuales de manera errónea:

1. **Eliminación de Stock Comprometido por Bodega**:
   - En las subfilas desplegables de "Detalle por bodega" en las grillas de inventario, ahora mostramos un guion `-` atenuado en la columna **COMPROMETIDO** en lugar de una cantidad numérica específica.
   - **Disponible por Bodega (`Disp. (Bodega)`)**: Se calcula única y exclusivamente con base en el stock físico real de la bodega (`inv.quantity`). Ya no se resta el comprometido de esa ubicación, lo cual evita que se muestren stocks disponibles negativos (ej. `-2` en Bodega Central en productos con stock físico en otras bodegas).

2. **Remoción de Alertas y Warnings Locales**:
   - Retiramos el icono de alerta rojo (`ri-error-warning-line`) y la lógica asociada en los desgloses de bodega. La advertencia visual de stock insuficiente se mantiene de manera precisa únicamente en la fila principal consolidada del producto si el stock disponible global (`FÍSICO - COMPROMETIDO`) resulta ser menor o igual a `0` existiendo unidades comprometidas.

3. **Optimización en la Selección Automática de Bodega**:
   - Modificamos el algoritmo de asignación de bodega automática para nuevos pedidos en [js/app.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/app.js). Al determinar qué bodega tiene la mayor disponibilidad para servir un ítem, el sistema ahora evalúa directamente el stock físico de las bodegas (`inv.quantity`), ya que el comprometido se procesa a nivel global de tienda.

---

## 55. Validación de Stock de la Sucursal Seleccionada al Enviar al Picker (WMS)

Hemos corregido la validación de stock físico al enviar pedidos al Picker para que coincida con la sucursal real asignada al pedido, solucionando errores de falsos positivos/negativos de stock insuficiente (por ejemplo, el caso del pedido `MAG5602` asignado a Ñuñoa):

1. **Mapeo Inteligente de Sucursales a Bodegas**:
   - Implementamos la función `getWarehouseIdFromSucursal` en [js/admin.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/admin.js) que asocia cada sucursal textual elegible para picking con su UUID de bodega física correspondiente en Supabase:
     - `"Sucursal Ñuñoa"` ➡️ `Matriz Ñuñoa`
     - `"Sucursal La Reina"` ➡️ `CDD La Reina`
     - `"Sucursal Recoleta"` ➡️ `CDD Recoleta`
     - `"Sucursal Virtual (Hub)"` ➡️ `Bodega Central`

2. **Validación Contextualizada**:
   - Al enviar pedidos en lote (`applyBulkWmsStatus`) o de forma individual (`updateWmsOrderStatus`) a "En preparación", el sistema valida la disponibilidad física de stock en la bodega de la sucursal seleccionada en el modal en lugar de usar la bodega que el ítem tenía asignada por defecto (Bodega Central).

3. **Sincronización en Cascada en la Base de Datos**:
   - Una vez superada la validación de stock, el sistema actualiza en caliente el campo `warehouse_id` de los registros asociados en la tabla `order_items` de Supabase para alinearlos con la sucursal de destino.
   - Esta reubicación de bodega gatilla los triggers nativos de base de datos (`update_committed_quantity`), transfiriendo automáticamente la reserva del stock comprometido de la bodega anterior a la nueva.
   - Finalmente, se sincronizan las referencias locales de memoria para mantener la consistencia del catálogo en tiempo real.

4. **Persistencia en Modificaciones de Picking**:
   - Adaptamos los flujos de asignación de picking individual (`editWmsOrderPickingInfo`) y masivo (`bulkSetWmsOrderPickingInfo`) para aplicar la misma sincronización del `warehouse_id` de los ítems en base de datos y memoria local al cambiar o actualizar la sucursal asignada.



## 56. Integración de Servicio de Etiquetado de Códigos de Barra en Ingresos de Stock (WMS)

Hemos implementado un flujo completo para que los comercios declaren sus preferencias de etiquetado de códigos de barra al ingresar stock, automatizando el cálculo de recargos y la confirmación física en bodega:

1. **Campos de Preferencia en el Formulario del Cliente (`js/app.js`)**:
   - Agregamos controles de selección por radio en el formulario de nueva declaración:
     - **Completamente Etiquetado (Listo)**: Los productos ya vienen etiquetados. No aplica cargos adicionales.
     - **Parcialmente Etiquetado**: Permite especificar de manera precisa el número de unidades que requieren etiquetado en bodega.
     - **Sin Etiquetado**: El comercio declara que ninguna unidad viene etiquetada. El sistema bloquea el input y auto-completa el conteo con el total de unidades declaradas.
   - Si se requiere etiquetado (parcial o total), se despliega un panel de advertencia informando sobre el costo unitario de **$100 CLP por etiqueta**, el cual es obligatorio para la operación logística.

2. **Cálculo Dinámico de Costo de Etiquetado**:
   - Actualizamos `window.calculateEntryCost` para sumar el recargo de etiquetado.
   - El costo en pesos ($100 CLP x unidad a etiquetar) se convierte automáticamente a UF utilizando el valor del indicador diario de la UF en tiempo real (`window.currentUfValue`).
   - Se muestra el desglose del costo de etiquetado en UF y pesos aproximados dentro del modal de vista previa antes del envío de la declaración.

3. **Persistencia en la Base de Datos**:
   - Creamos la migración [supabase_schema_declarations_labeling.sql](file:///c:/Users/felip/Desktop/WMS%20STOCKA/supabase_schema_declarations_labeling.sql) para añadir las columnas `labeling_type`, `labeling_qty_requested` y `labeling_qty_confirmed` a la tabla `stock_declarations`.
   - Estas preferencias se guardan y modifican correctamente durante la inserción y edición de ingresos.

4. **Validación y Cierre en el Panel de Administración (`js/admin.js`)**:
   - El popup de gestión de ingresos en el admin muestra el tipo de etiquetado y la cantidad de unidades solicitada por el cliente.
   - Al marcar un ingreso como "Recibido Conforme" o "Recibido con Incidencias", el formulario despliega el campo **"Uds. Etiquetadas (Confirmado)"**, permitiendo al administrador ingresar la cantidad final auditada físicamente en bodega.
   - Esta cantidad confirmada se almacena en el campo `labeling_qty_confirmed` para futuras liquidaciones y auditorías de cobro.

---

## 57. Truncamiento de Ancho y Tooltip para el Campo de Envío (WMS)

Hemos limitado el ancho máximo visual del método de envío (columna **ENVÍO**) en la grilla principal de control de pedidos en el administrador ([js/admin.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/admin.js)), para evitar que textos muy largos extiendan de forma excesiva las columnas de la tabla y distorsionen la interfaz:

1. **Limitación de Ancho (`max-width: 180px`)**:
   - Agregamos propiedades de estilo en línea a las etiquetas `span` de las columnas de método de envío y ciudad (`shipping_method` y `shipping_city`):
     - `max-width: 180px`
     - `overflow: hidden`
     - `text-overflow: ellipsis`
     - `white-space: nowrap`
     - `display: inline-block`
   - Esto hace que cualquier texto que supere dicho límite se corte limpiamente agregando puntos suspensivos (`...`).

2. **Tooltip con Dato Completo (Hover Hint)**:
   - Mantuvimos y aseguramos el atributo `title="${order.shipping_method || ''}"` en los elementos HTML. Al posicionar el cursor (mouse) sobre el texto recortado, el navegador despliega un tooltip nativo con el contenido completo del método de envío o ciudad.

---

## 58. Renombramiento de Cobros Adicionales a Saldos Adicionales (WMS)

Hemos reestructurado la terminología y campos del módulo de cargos extraordinarios en la administración y en el portal del cliente para unificarlo bajo el concepto de **Saldos Adicionales** (compuesto por **Cargos** y **Descuentos**):

1. **Selector de Tipo de Saldo (`tipo`)**:
   - Agregamos la columna `tipo` (con valores `'cargo'` o `'descuento'`) a la tabla `extra_billing_charges` de Supabase.
   - En el formulario de registro y edición de saldos extraordinarios, se incorporó un selector desplegable (**Tipo de Saldo**):
     - **Cargo (Cobro Extraordinario)**: Registra cobros a sumar en la facturación del cliente.
     - **Descuento (Saldo a Favor)**: Registra montos a restar en la facturación del cliente (representado visualmente en negativo con signo `-` y color verde `#10b981`).
   - Los formularios de creación (`openCreateExtraChargeModal`) y edición (`openEditExtraChargeModal`) ahora leen, guardan e insertan este campo en Supabase de forma íntegra.

2. **Unificación de Interfaz y Terminología**:
   - Reemplazamos todos los encabezados y etiquetas de "Cobros Adicionales" por **Saldos Adicionales** en la navegación y tablas (tanto del Administrador como del Cliente).
   - El estado de los registros asociados a un periodo se renombró de "Cobrado" a **"Aplicado"** para reflejar adecuadamente que tanto un cargo como un descuento han sido aplicados al balance del periodo de facturación.
   - Las confirmaciones y diálogos de estado y eliminación fueron adaptados para referenciar "saldos adicionales" en lugar de "cobros".

---

## 59. Controles Visuales Premium para Método de Ingreso y Servicio de Descarga (WMS)

Hemos rediseñado y modernizado la sección de método de ingreso y servicio de descarga en el formulario de creación y edición de ingresos de stock del cliente ([js/app.js](file:///C:/Users/felip/Desktop/WMS%20STOCKA/js/app.js)), reemplazando los inputs estándar por componentes premium interactivos:

1. **Cuadrícula de Tarjetas para Método de Ingreso**:
   - Reemplazamos el antiguo elemento selector desplegable (`select`) por una cuadrícula interactiva de 4 tarjetas (`.delivery-method-grid`), cada una representando un método de ingreso (Courier, Desde Proveedor, Particular, Solicitar Retiro).
   - Cada tarjeta contiene un icono redondeado temático, un título en negrita y un subtítulo explicativo con el flujo correspondiente.
   - Cuenta con un indicador circular que simula un checkbox que se activa en color azul primario con un check animado cuando la tarjeta está seleccionada.
   - Se comunica transparentemente con un input oculto `#dec-delivery-method` para mantener la compatibilidad nativa con la validación de HTML5 y los envíos al backend.

2. **Interruptor Custom para Servicio de Descarga**:
   - Reemplazamos la fila del checkbox convencional por una tarjeta de ancho completo (`.unloading-service-card`) con interacción completa al hacer clic.
   - Incorporamos un interruptor/deslizador moderno custom (`.custom-switch`) que se desplaza y cambia de color a azul primario de forma fluida.
   - El estado activo resalta visualmente la tarjeta de fondo y muestra el banner de advertencia sobre la tarifa especial de descarga (0,1 UF por m³).

3. **Sincronización del Ciclo de Vida**:
   - Definimos métodos globales (`window.updateDeliveryMethodVisuals` and `window.updateUnloadingVisuals`) para asegurar que el estado visual de las tarjetas y el interruptor custom estén siempre sincronizados con los datos del formulario al entrar en modo de edición (`editDeclaration`), resetear/cancelar la edición (`cancelEditDeclaration`) y al abrir un nuevo ingreso limpio (`openNewDeclarationSlideOver`).

---

## 60. Rediseño de Información de Contacto, Transportista y Notas en Formulario de Ingresos (WMS)

Hemos reestructurado y mejorado visualmente la sección final de datos de contacto y transportista en el formulario de ingresos de stock del cliente ([js/app.js](file:///C:/Users/felip/Desktop/WMS%20STOCKA/js/app.js)) para ofrecer una experiencia visual premium y unificada:

1. **Tarjeta Unificada de Información**:
   - Agrupamos los campos en una sola tarjeta con borde sutil, fondo distinguido (`var(--color-surface)`) y sombreado elegante para agrupar semánticamente estos campos adicionales.
   - Añadimos un encabezado con el icono `ri-contacts-book-line` en color azul primario y una descripción explicativa para guiar al usuario.

2. **Entradas de Texto con Iconos Integrados (Inline Icons)**:
   - Envolvimos las entradas de texto (`input` y `textarea`) en contenedores con posicionamiento relativo e iconos internos de Remix Icon (`ri-user-voice-line`, `ri-car-line`, `ri-sticky-note-line`).
   - Aplicamos un padding lateral izquierdo de `2.25rem` a las cajas de texto para alinear perfectamente el texto de entrada y los marcadores de posición sin superponerse con los iconos.
   - El área de notas (`textarea`) se aumentó a 3 filas (`rows="3"`) e incluye soporte para cambio de tamaño vertical con un alto mínimo de `80px`.

---

## 61. Integración de Ingresos de Stock con Picker App (WMS)

Hemos implementado un flujo bidireccional completo para integrar los ingresos de stock del WMS con el sistema de operarios en el Picker:

1. **Preservación de Código de Barras en el Catálogo (`js/app.js`)**:
   - Modificamos la visualización y autocompletado del catálogo al agregar productos en el formulario de ingreso del cliente. El sistema ahora extrae y asocia el atributo `barcode` (código de barras) de cada producto seleccionado.
   - En el envío del formulario, la lista de productos seleccionados (`parsedProducts`) incluye el campo `barcode`.

2. **Panel de Integración con Picker en Administración (`admin.html`)**:
   - Agregamos la sección interactiva `#manage-dec-picker-panel` en el modal de gestión de ingresos de stock del administrador.
1. **Motivación del Cambio**:
   - Anteriormente, al importarse los pedidos de plataformas externas, a los ítems del pedido se les asignaba la bodega por defecto (generalmente Bodega Central).
   - El indicador de alerta visual **`SIN STOCK`** (badge rojo) y la columna de disponibilidad en la grilla desplegable realizaban el chequeo únicamente contra las existencias registradas en esa bodega específica. Esto generaba falsas alertas de falta de stock en pedidos cuando el producto en cuestión sí tenía existencias suficientes distribuidas en otras bodegas de la misma tienda.

2. **Solución Implementada**:
   - **Badge de Alerta Principal**: Modificamos el ciclo de verificación de ítems en el renderizado de la fila del pedido. Ahora, en lugar de consultar solo `invMap[product_id_warehouse_id]`, el sistema busca y suma las existencias físicas de dicho producto a lo largo de todas las llaves de bodega asociadas en el mapa de inventario cargado localmente (`window.loadedOrdersInventoryMap` / `window.clientOrdersInventoryMap`).
   - **Tabla Desplegable del Detalle de Pedido**: Adaptamos la celda de disponibilidad en la sub-tabla desplegable para reflejar la cantidad total agregada de todas las bodegas. Ahora indica correctamente si el artículo está disponible o si es insuficiente considerando el stock global del comercio.

---

## 52. Manejo de Tokens de Acceso Offline que Expiran (Expiring Offline Tokens) de Shopify

Corregimos y refinamos el flujo de integración de Shopify ([supabase/functions/shopify-oauth/index.ts](file:///c:/Users/felip/Desktop/WMS%20STOCKA/supabase/functions/shopify-oauth/index.ts)) para adaptarlo a las nuevas políticas de seguridad obligatorias de Shopify:

1. **Requisito de Shopify (Tokens con Expiración)**:
   - Para aplicaciones públicas registradas recientemente, Shopify ya **no permite el uso de tokens de acceso offline no expirables** (permanentes). Cualquier intento de realizar llamadas al API con un token permanente retorna un error `403 Forbidden` informando que se debe usar "expiring offline tokens".
   - Por esta razón, la Edge Function `shopify-oauth` debe incluir obligatoriamente el parámetro `"expiring": 1` al solicitar el token en el flujo OAuth. Esto devuelve un token de acceso (`access_token`) con una validez de 60 minutos y un token de actualización (`refresh_token`) con una validez de 90 días (que se renueva con cada ciclo de refresco).

2. **Sincronización en Segundo Plano**:
   - Para que el script de sincronización en GitHub Actions (`sync_shopify.js`) pueda rotar el token de acceso usando el `refresh_token`, es indispensable que las variables de entorno `SHOPIFY_CLIENT_ID` y `SHOPIFY_CLIENT_SECRET` estén configuradas.
   - Hemos confirmado que el flujo de trabajo de GitHub Actions (`sync_shopify.yml`) inyecta estas variables correctamente desde los secretos del repositorio, garantizando el refresco automático cada 30 minutos sin interrupciones.

3. **Acción Requerida**:
   - El cliente de **Smile for Pets** debe ir a la sección de **Integraciones**, hacer clic en **Conectar / Re-conectar** e iniciar sesión nuevamente. Con esto, Shopify generará un token offline con expiración oficial y un refresh token válidos, permitiendo que la sincronización vuelva a fluir correctamente.

---

## 53. Animación de Carga (Spin) en Botón de Actualización de Pedidos

Añadimos la regla de estilo para la clase CSS `.spin` en la hoja de estilos global ([css/style.css](file:///c:/Users/felip/Desktop/WMS%20STOCKA/css/style.css)) para habilitar la animación visual de rotación del icono de refresco al pulsar el botón de actualizar pedidos en el panel del administrador:

1. **Origen del Problema**:
   - Al pulsar el botón "Actualizar", el controlador JS desactivaba el botón y agregaba la clase `spin` al icono (`ri-refresh-line spin`).
   - Sin embargo, no existía ninguna regla CSS asociada a la clase `.spin`, por lo que el icono permanecía estático sin ofrecer feedback visual de que se estaba ejecutando una consulta asíncrona en segundo plano.

2. **Solución Implementada**:
   - Declaramos la clase CSS `.spin` vinculándola a la animación `@keyframes spin` ya existente en la hoja de estilos:
     ```css
     .spin {
       animation: spin 1s linear infinite;
       display: inline-block;
     }
     ```
   - Esto hace que el icono rote de forma continua a velocidad constante mientras dura el fetch y se remueva inmediatamente en el bloque `finally` del controlador JS al completarse la sincronización, mejorando la experiencia de usuario.

---

## 54. Tratamiento de Stock Comprometido como Global (WMS)

Hemos modificado las vistas de inventario y los flujos de cálculo en los paneles de Cliente ([js/app.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/app.js)) y del Administrador ([js/admin.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/admin.js)) para considerar el stock comprometido como un indicador puramente global del producto, evitando asignarlo o descontarlo de bodegas físicas individuales de manera errónea:

1. **Eliminación de Stock Comprometido por Bodega**:
   - En las subfilas desplegables de "Detalle por bodega" en las grillas de inventario, ahora mostramos un guion `-` atenuado en la columna **COMPROMETIDO** en lugar de una cantidad numérica específica.
   - **Disponible por Bodega (`Disp. (Bodega)`)**: Se calcula única y exclusivamente con base en el stock físico real de la bodega (`inv.quantity`). Ya no se resta el comprometido de esa ubicación, lo cual evita que se muestren stocks disponibles negativos (ej. `-2` en Bodega Central en productos con stock físico en otras bodegas).

2. **Remoción de Alertas y Warnings Locales**:
   - Retiramos el icono de alerta rojo (`ri-error-warning-line`) y la lógica asociada en los desgloses de bodega. La advertencia visual de stock insuficiente se mantiene de manera precisa únicamente en la fila principal consolidada del producto si el stock disponible global (`FÍSICO - COMPROMETIDO`) resulta ser menor o igual a `0` existiendo unidades comprometidas.

3. **Optimización en la Selección Automática de Bodega**:
   - Modificamos el algoritmo de asignación de bodega automática para nuevos pedidos en [js/app.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/app.js). Al determinar qué bodega tiene la mayor disponibilidad para servir un ítem, el sistema ahora evalúa directamente el stock físico de las bodegas (`inv.quantity`), ya que el comprometido se procesa a nivel global de tienda.

---

## 55. Validación de Stock de la Sucursal Seleccionada al Enviar al Picker (WMS)

Hemos corregido la validación de stock físico al enviar pedidos al Picker para que coincida con la sucursal real asignada al pedido, solucionando errores de falsos positivos/negativos de stock insuficiente (por ejemplo, el caso del pedido `MAG5602` asignado a Ñuñoa):

1. **Mapeo Inteligente de Sucursales a Bodegas**:
   - Implementamos la función `getWarehouseIdFromSucursal` en [js/admin.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/admin.js) que asocia cada sucursal textual elegible para picking con su UUID de bodega física correspondiente en Supabase:
     - `"Sucursal Ñuñoa"` ➡️ `Matriz Ñuñoa`
     - `"Sucursal La Reina"` ➡️ `CDD La Reina`
     - `"Sucursal Recoleta"` ➡️ `CDD Recoleta`
     - `"Sucursal Virtual (Hub)"` ➡️ `Bodega Central`

2. **Validación Contextualizada**:
   - Al enviar pedidos en lote (`applyBulkWmsStatus`) o de forma individual (`updateWmsOrderStatus`) a "En preparación", el sistema valida la disponibilidad física de stock en la bodega de la sucursal seleccionada en el modal en lugar de usar la bodega que el ítem tenía asignada por defecto (Bodega Central).

3. **Sincronización en Cascada en la Base de Datos**:
   - Una vez superada la validación de stock, el sistema actualiza en caliente el campo `warehouse_id` de los registros asociados en la tabla `order_items` de Supabase para alinearlos con la sucursal de destino.
   - Esta reubicación de bodega gatilla los triggers nativos de base de datos (`update_committed_quantity`), transfiriendo automáticamente la reserva del stock comprometido de la bodega anterior a la nueva.
   - Finalmente, se sincronizan las referencias locales de memoria para mantener la consistencia del catálogo en tiempo real.

4. **Persistencia en Modificaciones de Picking**:
   - Adaptamos los flujos de asignación de picking individual (`editWmsOrderPickingInfo`) y masivo (`bulkSetWmsOrderPickingInfo`) para aplicar la misma sincronización del `warehouse_id` de los ítems en base de datos y memoria local al cambiar o actualizar la sucursal asignada.



## 56. Integración de Servicio de Etiquetado de Códigos de Barra en Ingresos de Stock (WMS)

Hemos implementado un flujo completo para que los comercios declaren sus preferencias de etiquetado de códigos de barra al ingresar stock, automatizando el cálculo de recargos y la confirmación física en bodega:

1. **Campos de Preferencia en el Formulario del Cliente (`js/app.js`)**:
   - Agregamos controles de selección por radio en el formulario de nueva declaración:
     - **Completamente Etiquetado (Listo)**: Los productos ya vienen etiquetados. No aplica cargos adicionales.
     - **Parcialmente Etiquetado**: Permite especificar de manera precisa el número de unidades que requieren etiquetado en bodega.
     - **Sin Etiquetado**: El comercio declara que ninguna unidad viene etiquetada. El sistema bloquea el input y auto-completa el conteo con el total de unidades declaradas.
   - Si se requiere etiquetado (parcial o total), se despliega un panel de advertencia informando sobre el costo unitario de **$100 CLP por etiqueta**, el cual es obligatorio para la operación logística.

2. **Cálculo Dinámico de Costo de Etiquetado**:
   - Actualizamos `window.calculateEntryCost` para sumar el recargo de etiquetado.
   - El costo en pesos ($100 CLP x unidad a etiquetar) se convierte automáticamente a UF utilizando el valor del indicador diario de la UF en tiempo real (`window.currentUfValue`).
   - Se muestra el desglose del costo de etiquetado en UF y pesos aproximados dentro del modal de vista previa antes del envío de la declaración.

3. **Persistencia en la Base de Datos**:
   - Creamos la migración [supabase_schema_declarations_labeling.sql](file:///c:/Users/felip/Desktop/WMS%20STOCKA/supabase_schema_declarations_labeling.sql) para añadir las columnas `labeling_type`, `labeling_qty_requested` y `labeling_qty_confirmed` a la tabla `stock_declarations`.
   - Estas preferencias se guardan y modifican correctamente durante la inserción y edición de ingresos.

4. **Validación y Cierre en el Panel de Administración (`js/admin.js`)**:
   - El popup de gestión de ingresos en el admin muestra el tipo de etiquetado y la cantidad de unidades solicitada por el cliente.
   - Al marcar un ingreso como "Recibido Conforme" o "Recibido con Incidencias", el formulario despliega el campo **"Uds. Etiquetadas (Confirmado)"**, permitiendo al administrador ingresar la cantidad final auditada físicamente en bodega.
   - Esta cantidad confirmada se almacena en el campo `labeling_qty_confirmed` para futuras liquidaciones y auditorías de cobro.

---

## 57. Truncamiento de Ancho y Tooltip para el Campo de Envío (WMS)

Hemos limitado el ancho máximo visual del método de envío (columna **ENVÍO**) en la grilla principal de control de pedidos en el administrador ([js/admin.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/admin.js)), para evitar que textos muy largos extiendan de forma excesiva las columnas de la tabla y distorsionen la interfaz:

1. **Limitación de Ancho (`max-width: 180px`)**:
   - Agregamos propiedades de estilo en línea a las etiquetas `span` de las columnas de método de envío y ciudad (`shipping_method` y `shipping_city`):
     - `max-width: 180px`
     - `overflow: hidden`
     - `text-overflow: ellipsis`
     - `white-space: nowrap`
     - `display: inline-block`
   - Esto hace que cualquier texto que supere dicho límite se corte limpiamente agregando puntos suspensivos (`...`).

2. **Tooltip con Dato Completo (Hover Hint)**:
   - Mantuvimos y aseguramos el atributo `title="${order.shipping_method || ''}"` en los elementos HTML. Al posicionar el cursor (mouse) sobre el texto recortado, el navegador despliega un tooltip nativo con el contenido completo del método de envío o ciudad.

---

## 58. Renombramiento de Cobros Adicionales a Saldos Adicionales (WMS)

Hemos reestructurado la terminología y campos del módulo de cargos extraordinarios en la administración y en el portal del cliente para unificarlo bajo el concepto de **Saldos Adicionales** (compuesto por **Cargos** y **Descuentos**):

1. **Selector de Tipo de Saldo (`tipo`)**:
   - Agregamos la columna `tipo` (con valores `'cargo'` o `'descuento'`) a la tabla `extra_billing_charges` de Supabase.
   - En el formulario de registro y edición de saldos extraordinarios, se incorporó un selector desplegable (**Tipo de Saldo**):
     - **Cargo (Cobro Extraordinario)**: Registra cobros a sumar en la facturación del cliente.
     - **Descuento (Saldo a Favor)**: Registra montos a restar en la facturación del cliente (representado visualmente en negativo con signo `-` y color verde `#10b981`).
   - Los formularios de creación (`openCreateExtraChargeModal`) y edición (`openEditExtraChargeModal`) ahora leen, guardan e insertan este campo en Supabase de forma íntegra.

2. **Unificación de Interfaz y Terminología**:
   - Reemplazamos todos los encabezados y etiquetas de "Cobros Adicionales" por **Saldos Adicionales** en la navegación y tablas (tanto del Administrador como del Cliente).
   - El estado de los registros asociados a un periodo se renombró de "Cobrado" a **"Aplicado"** para reflejar adecuadamente que tanto un cargo como un descuento han sido aplicados al balance del periodo de facturación.
   - Las confirmaciones y diálogos de estado y eliminación fueron adaptados para referenciar "saldos adicionales" en lugar de "cobros".

---

## 59. Controles Visuales Premium para Método de Ingreso y Servicio de Descarga (WMS)

Hemos rediseñado y modernizado la sección de método de ingreso y servicio de descarga en el formulario de creación y edición de ingresos de stock del cliente ([js/app.js](file:///C:/Users/felip/Desktop/WMS%20STOCKA/js/app.js)), reemplazando los inputs estándar por componentes premium interactivos:

1. **Cuadrícula de Tarjetas para Método de Ingreso**:
   - Reemplazamos el antiguo elemento selector desplegable (`select`) por una cuadrícula interactiva de 4 tarjetas (`.delivery-method-grid`), cada una representando un método de ingreso (Courier, Desde Proveedor, Particular, Solicitar Retiro).
   - Cada tarjeta contiene un icono redondeado temático, un título en negrita y un subtítulo explicativo con el flujo correspondiente.
   - Cuenta con un indicador circular que simula un checkbox que se activa en color azul primario con un check animado cuando la tarjeta está seleccionada.
   - Se comunica transparentemente con un input oculto `#dec-delivery-method` para mantener la compatibilidad nativa con la validación de HTML5 y los envíos al backend.

2. **Interruptor Custom para Servicio de Descarga**:
   - Reemplazamos la fila del checkbox convencional por una tarjeta de ancho completo (`.unloading-service-card`) con interacción completa al hacer clic.
   - Incorporamos un interruptor/deslizador moderno custom (`.custom-switch`) que se desplaza y cambia de color a azul primario de forma fluida.
   - El estado activo resalta visualmente la tarjeta de fondo y muestra el banner de advertencia sobre la tarifa especial de descarga (0,1 UF por m³).

3. **Sincronización del Ciclo de Vida**:
   - Definimos métodos globales (`window.updateDeliveryMethodVisuals` and `window.updateUnloadingVisuals`) para asegurar que el estado visual de las tarjetas y el interruptor custom estén siempre sincronizados con los datos del formulario al entrar en modo de edición (`editDeclaration`), resetear/cancelar la edición (`cancelEditDeclaration`) y al abrir un nuevo ingreso limpio (`openNewDeclarationSlideOver`).

---

## 60. Rediseño de Información de Contacto, Transportista y Notas en Formulario de Ingresos (WMS)

Hemos reestructurado y mejorado visualmente la sección final de datos de contacto y transportista en el formulario de ingresos de stock del cliente ([js/app.js](file:///C:/Users/felip/Desktop/WMS%20STOCKA/js/app.js)) para ofrecer una experiencia visual premium y unificada:

1. **Tarjeta Unificada de Información**:
   - Agrupamos los campos en una sola tarjeta con borde sutil, fondo distinguido (`var(--color-surface)`) y sombreado elegante para agrupar semánticamente estos campos adicionales.
   - Añadimos un encabezado con el icono `ri-contacts-book-line` en color azul primario y una descripción explicativa para guiar al usuario.

2. **Entradas de Texto con Iconos Integrados (Inline Icons)**:
   - Envolvimos las entradas de texto (`input` y `textarea`) en contenedores con posicionamiento relativo e iconos internos de Remix Icon (`ri-user-voice-line`, `ri-car-line`, `ri-sticky-note-line`).
   - Aplicamos un padding lateral izquierdo de `2.25rem` a las cajas de texto para alinear perfectamente el texto de entrada y los marcadores de posición sin superponerse con los iconos.
   - El área de notas (`textarea`) se aumentó a 3 filas (`rows="3"`) e incluye soporte para cambio de tamaño vertical con un alto mínimo de `80px`.

---

## 61. Integración de Ingresos de Stock con Picker App (WMS)

Hemos implementado un flujo bidireccional completo para integrar los ingresos de stock del WMS con el sistema de operarios en el Picker:

1. **Preservación de Código de Barras en el Catálogo (`js/app.js`)**:
   - Modificamos la visualización y autocompletado del catálogo al agregar productos en el formulario de ingreso del cliente. El sistema ahora extrae y asocia el atributo `barcode` (código de barras) de cada producto seleccionado.
   - En el envío del formulario, la lista de productos seleccionados (`parsedProducts`) incluye el campo `barcode`.

2. **Panel de Integración con Picker en Administración (`admin.html`)**:
   - Agregamos la sección interactiva `#manage-dec-picker-panel` en el modal de gestión de ingresos de stock del administrador.
   - Esta sección permite enviar el ingreso actual al Picker y realizar la consulta de su estado en tiempo real.
   - Cuenta con badges adaptativos ("No enviado", "En Picker", "Completado/Parcial") y un indicador de operario asignado.

3. **Carga y Registro de Órdenes de Ingreso en el Picker (`js/admin.js`)**:
   - Implementamos `window.sendIntakeToPicker(id)` para registrar los productos declarados en la tabla `active_orders` del Picker con el prefijo de orden `ING-${ID}` y agenda `'INGRESO'`.
   - **Regla de Código de Barras**: Si un producto cuenta con código de barras declarado por catálogo o planilla, y es diferente al SKU, se envía el código de barras en lugar del SKU para facilitar la lectura física por el escáner del operario.
   - El estado del ingreso en el WMS se actualiza automáticamente a "En Recepción - Pendiente Conteo".

4. **Importación Automatizada de Cantidades Contadas (`js/admin.js`)**:
   - Implementamos `window.loadCountsFromPicker(id, itemsSummary)` para parsear e importar el desglose del campo `items_summary` registrado en la tabla `history_logs` del Picker.
   - Utiliza una expresión regular avanzada para emparejar y cruzar el conteo por SKU y por código de barras de manera precisa.
   - Auto-rellena de forma instantánea los campos de **Cantidad Recepcionada (Física)** e **Incidencias** en el panel administrativo, y avanza el estado del flujo a "En proceso de conteo/clasificación" para facilitar el cierre.

5. **Generación Automática de Comprobante PDF para Correo y Base de Datos**:
   - Implementamos `window.generateDeclarationPDFBase64(dec)` para renderizar dinámicamente un comprobante digital en PDF de la declaración de ingreso.
   - Tras crearse una declaración, el sistema genera de forma asíncrona este comprobante PDF, lo asocia al registro en Supabase bajo la columna `file_base64` y despacha el correo de notificación al administrador con este PDF oficial adjunto (en lugar del archivo Excel original), garantizando una experiencia formal de recepción.
   - Modificamos la visualización y exportación del PDF tanto en el panel de administrador como de cliente para priorizar el desglose estructurado de la columna `products_list` si está presente, evitando fallos de decodificación o procesamiento de archivos Excel binarios.

---

## 62. Limpieza de Caché de Inventario al Refrescar/Cargar Pedidos (WMS)

Hemos solucionado la visualización incorrecta del estado **`SIN STOCK`** en pedidos de comercios (como "THE SKIN STORE") cuyos niveles de stock físico fueron actualizados o trasladados recientemente en la base de datos:

1. **Diagnóstico del Problema**:
   - Para evitar consultas redundantes a la base de datos en operaciones locales (paginación, ordenamiento, filtrado), la aplicación utiliza un mapa de caché en el frontend (`window.loadedOrdersInventoryMap` para el administrador y `window.clientOrdersInventoryMap` para el cliente).
   - Sin embargo, este mapa de caché nunca se limpiaba al pulsar el botón "Actualizar" (Refresh) o al recargar el módulo. Esto causaba que la aplicación reutilizara valores obsoletos de inventario (en este caso, stock inicial de `0` antes de los traslados a Ñuñoa) sin consultar los nuevos datos de stock de Supabase.

2. **Limpieza del Caché en el Administrador**:
   - Modificamos `window.refreshWmsOrders` en [js/admin.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/admin.js) para vaciar el caché (`window.loadedOrdersInventoryMap = {};`) al hacer clic en el botón de actualización.
   - Modificamos `renderAdminOrders` en [js/admin.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/admin.js) para reiniciar el caché al inicializar o recargar la vista del módulo.

3. **Limpieza del Caché en el Cliente**:
   - Modificamos `renderOrders` en [js/app.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/app.js) para reiniciar el caché (`window.clientOrdersInventoryMap = {};`) al cargar la sección de control de pedidos del portal del cliente.

---

## 63. Validación Proactiva de Stock y Asignación de Sucursal al Despachar Pedidos (WMS)

Hemos implementado un flujo de control de stock interactivo en el panel de administrador ([js/admin.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/admin.js)) al cambiar el estado de un pedido a **"Despachado"** (tanto de forma individual como masiva). Esto previene y resuelve los errores de base de datos (`violates check constraint "inventory_quantity_check"`):

1. **Selección Dinámica de Sucursal de Despacho**:
   - Si se intenta despachar un pedido cuyos artículos todavía están asignados a la **Bodega Central (Virtual)** o que no tiene una sucursal física asignada, el sistema despliega un diálogo emergente de SweetAlert2 (`Swal`).
   - El usuario puede elegir la sucursal física real desde la cual se está realizando el despacho (Ñuñoa, La Reina o Recoleta).
   - Al seleccionar la sucursal, el sistema actualiza en caliente en Supabase el campo `warehouse_id` de los ítems del pedido (`order_items`) y la sucursal de picking (`sucursal_pickeo`) del pedido principal, sincronizando la memoria local de la aplicación.

2. **Validación Previa de Stock Físico**:
   - Antes de enviar la actualización de estado a la base de datos, el sistema consulta en Supabase el stock real disponible de los productos del pedido en la bodega física correspondiente.
   - Si las existencias físicas disponibles resultan ser inferiores a las cantidades solicitadas en el pedido, el despacho se detiene de forma segura.
   - En lugar de fallar de manera silenciosa o cruda con una excepción de base de datos, el sistema muestra un SweetAlert interactivo detallado:
     - *"No se puede marcar como Despachado: El SKU XXX (Nombre) no tiene suficiente stock físico en la bodega YYY (Requerido: A, Disponible: B)."*
   - Esto mantiene la consistencia lógica del inventario de forma segura y mejora la usabilidad para el operador.

---

## 64. Corrección de Mapeo de Catálogo por Comercio y Backfill de Ítems (WMS)

Hemos solucionado el problema que causaba que ciertos pedidos (especialmente de **MAGIC MAKEUP**) se importaran con `0` unidades y sin información de SKU/nombre (mostrándose como `Sin SKU` / `Sin Nombre` en el gestor):

1. **Resolución de Colisión de Integración Multicuentas (`sync_shopify.js` y `sync_tiendanube.js`)**:
   - **Diagnóstico**: Cuando un usuario administrador (como Felipe) conecta múltiples tiendas Shopify/Tiendanube bajo sus credenciales de integración, el `merchant_id` en la tabla `merchant_integrations` se guarda con el UUID del administrador. Sin embargo, el catálogo de productos de cada tienda en la base de datos está registrado bajo el `merchant_id` del dueño original (como `mlg@magicmakeup.cl` en MAGIC MAKEUP).
   - El script de sincronización buscaba el producto filtrando por `.eq('merchant_id', integration.merchant_id).eq('sku', sku)`. Al no coincidir el ID de la integración con el del producto, no encontraba ningún registro y fallaba al intentar auto-crearlo de nuevo debido a la clave única del SKU por comercio (`products_comercio_sku_key`), dejando el pedido sin ítems asociados (`order_items` vacío).
   - **Solución**: Modificamos la búsqueda en los scripts de sincronización de plataformas para consultar el producto filtrando por el nombre de comercio (`comercio`) y el SKU: `.eq('sku', sku).eq('comercio', integration.comercio)`. Esto garantiza una correspondencia del 100% independientemente del usuario que haya establecido la conexión.
   - Al auto-crear un producto faltante, el sistema busca de manera inteligente un producto hermano existente para heredar su `merchant_id` real, manteniendo la coherencia de propiedad de los datos.

2. **Campaña de Backfill Explicativo de Pedidos Afectados**:
   - Ejecutamos un script de reparación en caliente (`scratch/backfill_missing_order_items.js`) que analizó la base de datos, detectó 45 pedidos de Magic Makeup afectados por este desfase histórico que carecían de ítems y procesó su campo original `raw_shopify_data` para insertar correctamente sus correspondientes registros en la tabla `order_items` con sus SKUs, cantidades y precios reales.
   - Todo el histórico actual y activo del comercio MAGIC MAKEUP se encuentra ahora 100% corregido y visible en la plataforma.

---

## 65. Optimización Crítica de Políticas RLS para envios_unificados (WMS)

Hemos solucionado la lentitud extrema y carga infinita en el inicio de la administración al optimizar las políticas de seguridad a nivel de fila (RLS) en la tabla `envios_unificados` en Supabase:

1. **Diagnóstico del Cuello de Botella**:
   - Al cargar el gestor, el frontend consulta la tabla `envios_unificados` (que contiene más de 36,000 registros).
   - La política de visualización para clientes (`Clientes ven envios de su comercio asignado`) ejecutaba una subconsulta correlacionada: `EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND ... IN (unnest(string_to_array(profiles.comercio))))`.
   - Debido a esta correlación, PostgreSQL se veía forzado a ejecutar una consulta secuencial en la tabla `profiles` por cada uno de los 36,000 registros de envíos. Esto superaba el tiempo límite de ejecución de la base de datos (`statement timeout` con error `57014`), bloqueando la carga y dejando el dashboard congelado en la pantalla de carga.

2. **Implementación de Función SECURITY DEFINER Estable**:
   - Diseñamos la función PostgreSQL `public.get_user_comercio_list()` con nivel de volatilidad `STABLE` y seguridad `SECURITY DEFINER`.
   - Esta función consulta el comercio del usuario logueado en la tabla `profiles` una única vez por transacción y retorna un arreglo (`text[]`) con la lista de comercios autorizados, evitando ejecutar subconsultas en cascada y saltando las políticas RLS internas de `profiles` de forma segura.

3. **Reescritura de la Política RLS**:
   - Reemplazamos la política ineficiente por una condición no correlacionada que se evalúa de manera inmediata contra el arreglo de constantes devuelto por la función estable:
     ```sql
     (public.is_admin())
     OR ('all' = ANY(public.get_user_comercio_list()))
     OR (lower(empresa_comercio_proveedor) = ANY(public.get_user_comercio_list()))
     ```
   - Gracias a este desacoplamiento, el tiempo de planificación y ejecución de la consulta bajó de **más de 10 segundos** (timeout) a **0.33 milisegundos** (una mejora de velocidad de casi 30,000 veces).

---

## 66. Consultas de Envíos en Trozos (Chunked Fetch) para Prevenir Desbordamiento de URL (WMS)

Hemos solucionado el error de red `net::ERR_FAILED 520` (Cloudflare Unknown Error / URI Too Long) al cargar o refrescar pedidos en el panel de administración ([js/admin.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/admin.js)):

1. **Origen del Problema**:
   - Para asociar cada pedido con su respectivo despacho logístico, el frontend compilaba una lista gigante de referencias cruzadas (`allRefs` conteniendo IDs, números de orden externos y códigos de seguimiento de miles de pedidos cargados).
   - Esta lista masiva era inyectada directamente en una sola consulta `.in('pedido_referencia', allRefs)`.
   - PostgREST traduce el filtro `.in(...)` a parámetros en la URL (GET `?pedido_referencia=in.(...)`). Con miles de pedidos, la URL generada superaba los **60 Kilobytes**, superando los límites máximos permitidos por proxies (Cloudflare limita el tamaño de la cabecera HTTP/URL a 8-16 KB), gatillando un error de red `520` inmediato y congelando la interfaz.

2. **Solución Implementada**:
   - Implementamos la función asíncrona `fetchEnviosUnificadosByRefs(allRefs)`.
   - **Remoción de Duplicados**: Primero, el sistema limpia la lista de referencias eliminando duplicados mediante `[...new Set(allRefs)]`, reduciendo considerablemente la cantidad de elementos.
   - **Segmentación en Trozos (Chunking)**: Divide la lista en porciones o trozos pequeños de tamaño seguro (`CHUNK_SIZE = 150` elementos por consulta, generando URLs de apenas 3 KB a 5 KB).
   - **Ejecución Concurrente**: Utiliza `Promise.all` para lanzar las consultas de forma paralela en base a un plan optimizado. Esto aprovecha el índice B-tree de `pedido_referencia` en la base de datos, retornando la información de manera inmediata y uniendo todas las respuestas mediante `.flat()`.
   - Reemplazamos los 4 puntos de consulta masiva a `envios_unificados` para utilizar este nuevo cargador segmentado, eliminando por completo las caídas por desbordamiento de URL.
   - **Estabilidad de Código**: Corregimos un breve error de sintaxis accidental en la inserción de la función del helper que omitía la llave de cierre `};` al final de `window.reassignOrderCommerce`, garantizando que la carga de ES Modules en el navegador compile perfectamente sin arrojar `SyntaxError: Unexpected end of input`.

---

## 67. Integración de Razón Social y RUT de Comercios (WMS)

Hemos implementado la integración y visualización del RUT y Razón Social de los comercios en el panel de administración del WMS, permitiendo enlazar cada cuenta con su entidad fiscal correspondiente:

1. **Campos en el Listado Principal**:
   - Agregamos una nueva columna **Razón Social / RUT** en la tabla de Configuración de Comercios de la vista del Administrador.
   - Si el comercio está asociado a una Razón Social y RUT en la configuración local (`comercios_adicional_config`), se muestra la información estructurada con un diseño limpio. Si no tiene datos asociados, se visualiza como *No enlazado* con tipografía atenuada.

2. **Buscador Avanzado**:
   - Actualizamos el buscador del panel de comercios para permitir filtrar y encontrar clientes no solo por su **Nombre** o **Sigla**, sino también por su **Razón Social** o **RUT** de forma instantánea.

3. **Creación y Edición de Comercios**:
   - **Formulario de Creación**: Se añadieron los campos opcionales **Razón Social de la Empresa** y **RUT de la Empresa** en el modal de creación (`showMerchantCreateModal`).
   - **Formulario de Edición**: Se añadieron los mismos campos en el modal de configuración de comercio (`showMerchantEditModal`), precargados con los valores actuales.
   - **Formateador de RUT**: Implementamos un formateador en tiempo real para el campo de RUT en ambos formularios. A medida que el usuario escribe, el sistema limpia caracteres inválidos, convierte a mayúsculas y añade los puntos y guion correspondientes (ej: de `761234567` a `76.123.456-7`).
   - **Persistencia**: Al guardar o crear, el RUT y la Razón Social se envían de forma automática a la base de datos Supabase, actualizando la tabla `comercios_adicional_config`.
   - **Script SQL Actualizado**: Actualizamos el modal de migración SQL (`showMerchantMigrationModal`) y el archivo de script `supabase_schema_comercios_config_adicional.sql` para incluir las columnas `rut` y `razon_social` junto con las instrucciones `ALTER TABLE` para su compatibilidad retrospectiva.

---

## 68. Corrección de Pedidos Duplicados de MercadoLibre y Desacoplamiento por Comercio (WMS)

Hemos diagnosticado, limpiado de la base de datos y prevenido a futuro la aparición de pedidos duplicados provenientes de MercadoLibre en la cuenta del comercio **MAGIC MAKEUP**:

1. **Causa Raíz del Problema**:
   - Originalmente, la integración de MercadoLibre para Magic Makeup estaba vinculada bajo la cuenta y `merchant_id` del dueño original (MLG).
   - Recientemente, la integración fue re-vinculada bajo las credenciales del usuario administrador (Felipe), asociando el nuevo `merchant_id` de Felipe al mismo comercio `MAGIC MAKEUP` y mismo `username` de MercadoLibre (`751215607`).
   - Al ejecutarse la sincronización cron (`sync_meli.js`) o recibirse notificaciones del webhook (`meli-webhook`), el sistema buscaba órdenes existentes filtrando estrictamente por `merchant_id`: `.eq('merchant_id', integration.merchant_id).eq('external_order_number', orderId)`.
   - Dado que el `merchant_id` de la integración cambió (de MLG a Felipe), la búsqueda de los pedidos importados previamente bajo la cuenta de MLG no arrojaba resultados. Esto provocaba que el sincronizador los interpretara erróneamente como "nuevos pedidos", duplicándolos en la base de datos e importando una versión vacía (sin ítems) bajo el nuevo `merchant_id` de Felipe, mientras que el original (con ítems) seguía existiendo bajo el `merchant_id` de MLG.

2. **Campaña de Limpieza y Unificación (Hot-fix)**:
   - Rastreábamos 60 órdenes duplicadas en la base de datos de producción.
   - **Remoción de Duplicados Vacíos**: Eliminamos las 60 filas duplicadas vacías creadas recientemente bajo el `merchant_id` de Felipe.
   - **Migración y Consistencia**: Actualizamos las 96 órdenes reales remanentes (que conservaban sus correspondientes registros de ítems bajo el `merchant_id` de MLG) para transferir su propiedad al `merchant_id` actual de la integración (Felipe), garantizando consistencia absoluta sin perder ningún historial ni asignación de bodega.

3. **Prevención de Duplicados en Todas las Integraciones**:
   - **Búsqueda por Comercio**: Modificamos los scripts de sincronización (`sync_meli.js`, `sync_shopify.js`, `sync_tiendanube.js`, `sync_jumpseller.js`, `sync_woocommerce.js`, `sync_paris.js`, `sync_falabella.js`, `sync_walmart.js`) y la Edge Function `meli-webhook` para buscar pedidos existentes comparando por el nombre único del comercio (`comercio`) en lugar del `merchant_id` del usuario que configuró la integración:
     ```javascript
     .eq('comercio', integration.comercio)
     .eq('external_order_number', orderNumber)
     ```
   - Esto desacopla por completo la identidad de las órdenes de las cuentas individuales, previniendo duplicados si se renuevan credenciales o si cambia el administrador encargado del enlace.
   - **Despliegue de Edge Function**: Desplegamos la nueva versión del webhook de MercadoLibre (`meli-webhook`) de forma exitosa en el entorno de Supabase.

---

## 69. Incorporación de RUT y Razón Social en Facturas por Emitir (WMS)

Hemos integrado la visualización interactiva del RUT y Razón Social de los comercios en el listado de facturas pendientes de emisión en el sub-módulo de **Tareas y Pendientes** del panel de administración:

1. **Consulta Unificada en Segundo Plano**:
   - Modificamos la carga del Dashboard de Métricas (`loadBillingMetricsDashboard` y `refreshDashboardData`) para consultar las configuraciones fiscales registradas en la tabla `comercios_adicional_config` y los mapeos de agrupación en `billing_mappings` de Supabase.
   - Guardamos esta información en las variables globales `cachedDashboardCommerceAdicionalConfig` y `cachedDashboardBillingMappings` al iniciar el dashboard o al refrescar sus datos.

2. **Resolución de Mapeos Agrupados (Herencia de Datos Fiscales)**:
   - Implementamos un resolvedor de nombres agrupados en la generación del mapa de configuración.
   - Si una cuenta agrupadora de facturación (ej: `BIG BANG`) no tiene configuración directa en `comercios_adicional_config`, el sistema busca de manera inteligente los comercios individuales asociados (ej: `BACK IN TIME`, `DORMILONES`, `RELAJARTE`) a través de `billing_mappings` y hereda su RUT y Razón Social (`77.205.635-4 | BIG BANG SPA`) de forma automática.

3. **Visualización Elegante en la Columna Comercio**:
   - En la tabla de **Facturas por Emitir**, renderizamos el RUT y la Razón Social de cada comercio directamente en la columna **Comercio**, como un texto secundario en tamaño reducido (`0.725rem`) y en tono atenuado (`var(--color-text-muted)`). Esto evita saturar de columnas horizontales la grilla y mantiene un diseño móvil/desktop limpio.
   - Si un comercio no cuenta con RUT o Razón Social registrada ni mapeos válidos con datos, se visualiza su nombre normalmente sin alterar el espaciado.
   - El filtrado por Comercio, Período y Servicio continúa operando de forma reactiva sin alteración de sus atributos.

4. **Botón de Copiado Rápido de RUT**:
   - Agregamos un botón de copiado rápido (`window.copyRutToClipboard(rut, btnEl)`) con icono de portapapeles justo al lado del texto del RUT.
   - El botón tiene un diseño mini adaptado (`16px` de ancho/alto) y realiza una limpieza automática de los puntos al copiar (p. ej., de `77.205.635-4` a `77205635-4`), que es el formato estándar con guion aceptado por los portales de facturación de Chile (SII, ERPs).
   - Muestra la animación de confirmación con checkmark verde por 1.5 segundos al hacer clic.

5. **Glosa/Título de Factura Dinámica**:
   - Para agilizar aún más la digitación en los sistemas de facturación, el modal **"Registrar Factura Oficial"** ahora genera automáticamente el título/glosa estándar correspondiente al servicio y periodo:
     * Si es Fulfillment: `SERV. FULFILLMENT MES-AAAA` (ej: `SERV. FULFILLMENT JUNIO-2026`).
     * Si es Envíame: `SERV. ENVIAME MES-AAAA` (ej: `SERV. ENVIAME JUNIO-2026`).
   - Esta glosa se muestra en la tarjeta de información y cuenta con un botón de copiado rápido (`window.copyTextToClipboard(text, btnEl)`) para que el usuario pueda copiarla directamente al portapapeles con un solo clic.

6. **Buscador de Comercio en Tiempo Real (Tipo Lupa)**:
   - Reemplazamos el antiguo selector `<select>` de Comercio por un campo de texto de búsqueda dinámica.
   - Cuenta con un icono de lupa (`ri-search-line`) a la izquierda e interactúa en tiempo real al escribir (`oninput`).
   - **Búsqueda Avanzada Unificada**: Además del nombre del comercio, la búsqueda busca coincidencias en el **RUT** (independiente de los puntos) y la **Razón Social** del comercio, permitiendo encontrar registros pendientes por cualquiera de estos tres identificadores al instante.

7. **Validación de Duplicidad en Tiempo Real al Escribir**:
   - Trasladamos la comprobación de duplicidad a un evento `input` dinámico con **debounce (350ms)** para evitar saturación de peticiones.
   - Mientras el usuario escribe el folio, se muestra una indicación visual debajo del input: `🔍 Validando número...`
   - **Caso Duplicado**: Si el número está ocupado, el borde del input se torna rojo, el botón **"Guardar y Confirmar"** se inhabilita completamente y se muestra el detalle del conflicto en texto rojo: `❌ El folio 1091 ya está en uso por MAGIC MAKEUP (Periodo - Servicio).`
   - **Caso Disponible**: Si el número no registra duplicados, el borde se tiñe de verde, se habilita el botón de confirmación y se muestra `✓ Número de factura disponible.` en verde.
   - Excluye el propio `recordId` en edición para evitar advertir sobre su propia confirmación previa.

8. **Ajuste de Superposición de Modals (z-index)**:
   - Corregimos el problema de orden de apilamiento en el WMS. Cuando el usuario abría el modal de "Detalle de Montos con Atraso" (que tiene `z-index: 1100`) e intentaba abrir el modal para "Enviar Desglose por Email", este último se abría por debajo.
   - Aplicamos `zIndex: 9999` inline al contenedor `#modal-send-billing-email` de forma dinámica, forzándolo a renderizarse correctamente por encima de cualquier modal de detalles del panel principal.

---

## 70. Corrección de Productos Vacíos en Sincronización y Envío de Pedidos al Picker (WMS)

Hemos resuelto un problema estructural en la sincronización de catálogos y el envío de pedidos al sistema de picking (Picker) que causaba que pedidos de Falabella (y otras plataformas) se importaran vacíos (sin ítems) y no llegaran al Picker:

1. **Causa Raíz de Pedidos Vacíos en Falabella**:
   - Similar a lo solucionado para Shopify y Tiendanube, al re-vincular la integración bajo la cuenta de administración de Felipe, el script de sincronización de Falabella (`sync_falabella.js`) buscaba los productos del catálogo del comercio (MAGIC MAKEUP) utilizando el `merchant_id` de la integración vinculada (Felipe) en lugar del de la tienda original (MLG).
   - Como no encontraba el SKU (`MAGIC064`) bajo el `merchant_id` de Felipe, intentaba auto-crearlo de nuevo. Sin embargo, esto violaba la restricción de clave única de SKU por comercio (`products_comercio_sku_key`), fallando de manera silenciosa y dejando la orden guardada en el WMS con 0 ítems asociados en la tabla `order_items`.

2. **Falla de brackets en la Actualización de Pedidos Existentes**:
   - Además de la búsqueda, el bloque de código encargado de registrar los ítems de las órdenes (`order_items`) en `sync_falabella.js` estaba anidado erróneamente dentro del bloque `else` (reservado solo para la creación de órdenes nuevas).
   - Si una orden ya existía en el WMS pero le faltaban ítems en la base de datos (por ejemplo, porque la primera importación falló), el sistema detectaba que faltaban ítems (`shouldInsertItems = true`) pero nunca ejecutaba la inserción por estar dentro del bloque exclusivo de órdenes nuevas.

3. **Corrección de la Sincronización General (Multicuentas)**:
   - **Resolver Dinámico en Sincronizadores**: Agregamos el resolvedor dinámico de `merchant_id` en el inicio del procesamiento de todas las integraciones activas de los sincronizadores principales (`sync_falabella.js`, `sync_tiendanube.js`, `sync_jumpseller.js`, `sync_woocommerce.js`, `sync_paris.js`, `sync_walmart.js`, `sync_meli.js`). Esto permite heredar dinámicamente el `merchant_id` real del catálogo del comercio y asegura consistencia total.
   - **Desacoplamiento de Registro de Ítems**: Refactorizamos `sync_falabella.js` extrayendo el bloque de cálculo de SKUs/cantidades y la inserción de ítems fuera del bloque condicional `if-else`. Ahora, si una orden ya existe en el WMS pero su detalle de ítems está vacío, el sincronizador es capaz de consultar el API, resolver el producto y poblar los ítems correctamente.

4. **Saneamiento y Envío Exitoso de Pedido 3246115747**:
   - Ejecutamos la sincronización actualizada, lo que recuperó el SKU `MAGIC064` (cantidad: 1) e insertó correctamente el ítem asociado a la orden `3246115747` de Falabella.
   - Corregimos el script de sincronización bidireccional WMS <-> Picker (`sync_to_picker.js`) para remover la referencia a la columna inexistente `orders.observation`, que arrojaba un error de Postgres (`column orders.observation does not exist`) y bloqueaba todo el flujo de sincronización del picker.
   - Forzamos la inserción del pedido saneado en el Picker, dejándolo 100% activo en el sistema (`active_orders`) bajo la sucursal asignada ("Sucursal Ñuñoa") y listo para preparación física.

---

## 71. Validación Condicional de Stock en Frontend Según Configuración del Comercio (WMS)

Hemos corregido la validación de stock en el cliente (js/admin.js) al momento de enviar pedidos a preparación ("En preparación") o al marcarlos como "Despachado", asegurando que el stock solo se valide para comercios que tengan habilitado el seguimiento de inventario:

1. **El Problema**:
   - Anteriormente, el frontend validaba la disponibilidad de stock físico de todas las órdenes seleccionadas antes de permitir el cambio de estado masivo o individual.
   - Si un comercio no tenía activo el seguimiento de stock en el WMS (es decir, su campo inventario_seguimiento en la tabla comercios_adicional_config era false o null, como en el caso de **SMILE FOR PETS**), no tenía stock físico real registrado en el sistema.
   - Como resultado, el frontend arrojaba la alerta de error "Stock Insuficiente Detectado" para estos comercios, bloqueando el envío al Picker de forma incorrecta, a pesar de que la base de datos permitía procesarlos sin restricciones.

2. **Implementación de Filtro Condicional**:
   - Modificamos las tres funciones de validación clave en js/admin.js:
     * **Cambio de Estado Masivo a "En preparación"** (window.applyBulkWmsStatus): Ahora consulta el mapa window.loadedCommerceConfigsMap y salta la acumulación y validación de ítems para cualquier pedido cuyo comercio tenga inventario_seguimiento: false.
     * **Cambio de Estado Individual a "En preparación"** (window.updateWmsOrderStatus): Ahora determina el estado de seguimiento antes de armar la lista de ítems a verificar. Si está desactivado, salta la validación de stock.
     * **Validación de Stock de Despacho** (validateOrderStockForDispatch): Agregamos una cláusula de escape en el bucle principal de órdenes que ignora el pedido si su comercio no tiene habilitado el seguimiento.
   - Esto hace que los comercios sin seguimiento de stock omitan por completo la validación en cliente, resolviendo el bloqueo y permitiendo la preparación y el despacho de sus órdenes de forma normal.

---

## 72. Obtención Alternativa de Datos de Facturación/Cliente para Pedidos sin Envío (Shopify)

Hemos resuelto la incidencia donde los pedidos de Shopify que son retirados en tienda (sin dirección de envío asociada) aparecían con el nombre del cliente y datos de contacto como "No registrado":

1. **El Problema**:
   - Cuando un pedido de Shopify tiene el método de entrega "Retiro en sucursal" (o similar), el payload no incluye `shipping_address`.
   - Tanto el script de sincronización programada (`sync_shopify.js`) como la Edge Function del Webhook de Shopify (`supabase/functions/shopify-webhook/index.ts`) utilizaban únicamente `order.shipping_address` para extraer el nombre y teléfono del cliente.
   - Al no existir esta sección de envío, los campos `customer_name` y `customer_phone` se guardaban como vacíos o nulos en la base de datos, mostrándose en el WMS como "No registrado".

2. **Solución en Sincronizadores y Webhook**:
   - Implementamos una lógica robusta de fallbacks sucesivos en `sync_shopify.js` y en la función `shopify-webhook` de Supabase:
     * **Nombre del Cliente** (`customer_name`): Intenta leer de la dirección de envío (`shipping_address`). Si no existe, recurre a la dirección de facturación (`billing_address`). Si tampoco está, utiliza los datos de la cuenta de cliente de Shopify (`customer`). Si todo falla, queda como "No registrado".
     * **Teléfono** (`customer_phone`): Busca en `shipping_address.phone`, luego en `billing_address.phone` y finalmente en `customer.phone` antes de dejarlo como nulo.
     * **Email** (`customer_email`): Busca en `contact_email`, luego `email` y finalmente en `customer.email`.
   - Desplegamos la Edge Function de Supabase (`shopify-webhook`) actualizada exitosamente.

3. **Solución Dinámica en el Frontend (WMS)**:
   - Para dar soporte inmediato a los pedidos existentes o históricos que ya se habían guardado con datos vacíos en la base de datos, modificamos las vistas principales del WMS en cliente (`js/admin.js` y `js/app.js`).
   - Al renderizar cada orden en el listado, si `customer_name` (o el teléfono / email) es nulo, vacío o dice "No registrado", el frontend consulta dinámicamente el campo JSON `raw_shopify_data` para extraer los datos de la dirección de facturación o de la cuenta del cliente. Esto corrige visualmente todos los pedidos retroactivamente sin necesidad de re-sincronizar la base de datos.

---

## 73. Configuración de Prefijos por Plataforma de Venta (WMS)

Hemos implementado un sistema completo y granular que permite a cada comercio configurar si se deben añadir y/o remover prefijos numéricos de pedidos de forma independiente por cada canal de ventas integrado (Shopify, WooCommerce, MercadoLibre, Falabella, Paris, Jumpseller, Tiendanube, Walmart y Manual):

1. **Estructura de Base de Datos y Retrocompatibilidad**:
   - Agregamos la columna `plat_siglas_config` de tipo `JSONB` a la tabla `public.comercios_adicional_config` en Supabase para almacenar las reglas de prefijos estructuradas por plataforma.
   - Si no existe una regla parametrizada para un canal en la columna JSONB, el sistema recurre al comportamiento previo (fallback legacy) de la bandera booleana global `pedido_trae_sigla`.

2. **Rediseño Completo de la Interfaz de Configuración (Administración)**:
   - Modificamos los modales de **Creación** y **Edición** de comercios en `js/admin.js`, reemplazando el único toggle general *"Pedido de origen trae sigla"* por una grilla/tabla interactiva de plataformas.
   - Por cada plataforma disponible se renderiza:
     - Un interruptor/toggle (`agregar_prefijo`) que define si el WMS debe anteponer la sigla del comercio al número de orden al recibirlo.
     - Un campo de texto (`prefijo_origen`, ej: `#` o `WEB-`) que indica si la orden ya viene con un prefijo preestablecido de fábrica para que el sistema lo limpie y remueva antes de procesar el pedido.

3. **Lógica de Normalización en Scripts de Sincronización**:
   - Modificamos los sincronizadores correspondientes para que limpien y agreguen los prefijos según la regla parametrizada de cada canal:
     - [sync_woocommerce.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/sync_woocommerce.js) (WooCommerce)
     - [sync_tiendanube.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/sync_tiendanube.js) (Tiendanube)
     - [sync_shopify.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/sync_shopify.js) (Shopify)
     - [sync_meli.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/sync_meli.js) (MercadoLibre)
     - [sync_jumpseller.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/sync_jumpseller.js) (Jumpseller)
     - [sync_walmart.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/sync_walmart.js) (Walmart)
     - [sync_falabella.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/sync_falabella.js) (Falabella)
     - [sync_paris.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/sync_paris.js) (Paris)
   - El algoritmo limpia primero el prefijo de origen (si coincide) y luego antepone la sigla del comercio si `agregar_prefijo` es verdadero, evitando duplicar siglas repetidas de manera preventiva.

4. **Soporte en Pedidos Manuales (Cliente/WMS)**:
   - Modificamos la creación manual de pedidos en `js/app.js` para aplicar el mismo flujo de validación y formateo de prefijos buscando la regla de la plataforma `Manual` configurada por el comercio.

---

## 74. Nueva Pestaña de Apelaciones y Observaciones en el Módulo de Facturación (Administración)

Hemos implementado una pestaña dedicada de forma ordenada y centralizada en el Panel de Administración de Facturación para que el equipo administrativo pueda revisar y dar respuesta a las observaciones/apelaciones enviadas por los comercios:

1. **Nueva Pestaña e Indicador Visual Reactivo**:
   - Agregamos la pestaña **"Apelaciones / Observaciones"** en la barra de navegación del módulo de facturación.
   - Cuenta con una etiqueta/badge dinámico (`pending-observations-badge`) en color naranjo/marrón (`#d97706`) que muestra la cantidad exacta de apelaciones pendientes de respuesta en tiempo real.

2. **Grilla y Filtros Avanzados**:
   - La pestaña muestra una tabla detallada con los campos: **Comercio**, **Periodo**, **Observación del Cliente**, **Última Actualización**, **Estado de la Apelación** y **Respuesta de la Administración**.
   - **Buscador en Tiempo Real**: Permite filtrar las observaciones instantáneamente por el nombre del comercio.
   - **Filtro por Estado**: Permite conmutar la vista para visualizar todas las observaciones, solo las "Pendientes de Respuesta" (seleccionado por defecto), las "Respondidas" o las resueltas ("Sin Observación").

3. **Resolución Directa e Integrada**:
   - Cada fila cuenta con un botón **"Responder"** que abre el modal administrativo de resolución (`openAdminBillingObservationModal`).
   - Al guardar la respuesta, la grilla de observaciones se actualiza automáticamente junto con el contador del badge pendiente, eliminando la necesidad de recargar la página y manteniendo una experiencia de gestión sumamente premium y ágil.

---

## 73. Corrección de Enlaces de Seguimiento (API Envíame) y Corrección de Desplazamiento en LightData

Hemos corregido y mejorado los enlaces de seguimiento para transportistas externos en el panel WMS:

1. **Incidencia de Enlaces Envíame**:
   - **El Problema**: Los envíos creados a través de Envíame registraban en la base de datos la URL de la API interna (`https://api.enviame.io/s2/companies/.../deliveries/.../tracking`). Al hacer clic en el WMS, esto mostraba un JSON plano en lugar de la interfaz de usuario de tracking.
   - **La Solución**: Modificamos el frontend del WMS (`js/admin.js` y `js/app.js`) para que si detecta un enlace que apunte a la API de Envíame, lo limpie dinámicamente y genere la URL pública del portal de rastreo de Envíame utilizando el formato oficial: `https://tracking.enviame.io/?n={tracking_number}`.

2. **Incidencia de Desplazamiento de Columnas de LightData**:
   - **El Problema**: Detectamos que LightData añadió columnas a su exporte de Excel, lo que desplazó los índices de mapeo de `sync_lightdata.js` en +1 para todas las columnas a partir del índice 15. Esto provocaba que:
     * El estado del envío se guardara con la longitud de coordenadas (`-70.7341292`) en lugar del texto del estado real.
     * La URL de seguimiento se guardara con las observaciones de dirección (`Parcela 123`).
     * Las fechas de actualización y direcciones estuvieran desfasadas o nulas.
   - **La Solución**:
     * Corregimos los índices de mapeo en `sync_lightdata.js` (ej. `direccion_destino` pasa a index 17, `status` a index 23, `fecha_actualizacion` a index 25, y `tracking_url` a index 31).
     * Combinamos las observaciones de dirección de los índices 29 y 30 en `complemento_destino`.
     * Agregamos lógica retroactiva en el frontend del WMS para que si un pedido histórico de LightData tiene una URL inválida, recupere la URL de tracking correcta directamente del arreglo raw guardado en `raw_lightdata_data.raw_data[31]`.

3. **Visualización de Sub-courier Real**:
   - Para aquellos pedidos que tienen el courier principal registrado genéricamente como `CARRIER EXTERNO` en el pedido, el frontend del WMS ahora muestra el sub-courier específico detectado en la tabla de envíos (ej. `RECIBELO` en lugar del genérico `CARRIER EXTERNO`).

---

## 76. Priorización de Envíos Activos y Homogeneización de Estado Global de Despacho (WMS)

Hemos resuelto la incidencia de visualización en el panel WMS (tanto para administradores como para clientes) donde se mostraban estados de despacho "Sin Movimiento" para pedidos que ya contaban con etiquetas activas despachadas, debido a la coexistencia de múltiples etiquetas o desfases de estados:

1. **Priorización de Envíos en Movimiento**:
   - Modificamos el algoritmo de ordenamiento de envíos (`orderShipments.sort`) en `js/admin.js` y `js/app.js` para priorizar los envíos que tienen movimiento real (`DESPACHADO` o `ALERTA`) sobre aquellos que están estancados en `"SIN MOVIMIENTO"` o son etiquetas antiguas canceladas/sin retirar.
   - Esto asegura que si un pedido tiene una etiqueta de Envíame estancada en `"SIN MOVIMIENTO"` y una etiqueta de LightData con movimiento real, el WMS seleccione y muestre de manera prioritaria el envío activo.

2. **Resolución Dinámica de Estado Global para LightData**:
   - Descubrimos que la función de base de datos `get_global_status` no mapeaba estados específicos de LightData (tales como *"En planta de procesamiento"*, *"Clasificado en planta"*, o *"Recepcionado en planta"*), retornando `NULL` y provocando que el WMS los mostrara de manera predeterminada como `"SIN MOVIMIENTO"`.
   - Implementamos un resolvedor dinámico en el frontend (`js/admin.js` y `js/app.js`) que traduce estos estados de LightData a su estado real de `"DESPACHADO"` o `"ALERTA"` al vuelo en las vistas principales de la grilla y en el modal de edición de despachos.
   - Creamos la migración SQL [supabase_schema_unification_phase19.sql](file:///c:/Users/felip/Desktop/WMS%20STOCKA/supabase_schema_unification_phase19.sql) para actualizar la función `get_global_status` en la base de datos de Supabase y recalcular el estado global para todos los registros históricos.

3. **Filtrado de Coordenadas Geográficas en Estado Crudo**:
   - Corregimos el problema visual donde el WMS renderizaba coordenadas de longitud/latitud (ej. `'-70.5786311'`) en la columna de estado.
   - Añadimos un filtro de expresiones regulares en el frontend que detecta si el estado es un valor numérico/coordenada decimal y lo oculta visualmente mostrando un guion estándar `'-'`.

4. **Visualización Complementaria del Estado Particular/Crudo**:
   - Agregamos la renderización del estado particular (ej: *"En planta de procesamiento"*, *"Listo para despacho"*, *"En reparto"*) directamente en la grilla principal de pedidos (debajo del badge del estado global).
   - Esto permite que el usuario vea de un vistazo la información detallada del transportista complementando el estado global unificado, tanto en la vista de cliente como en la de administrador.

---

## 77. Corrección de Consistencia de Tracking y Edición de Despachos en Detalle de Pedido (WMS)

Hemos resuelto de manera definitiva la inconsistencia visual de tracking en el modal de detalle del pedido y en las opciones de edición de tracking en el gestor de pedidos:

1. **Resolución de URLs Híbridas en Detalle de Pedido**:
   - Corregimos el bloque de tracking en el modal detallado del pedido (`js/admin.js` y `js/app.js`) para evitar que se mezclaran datos de couriers. Si un pedido posee múltiples etiquetas, la URL de seguimiento se extrae estrictamente del envío prioritized (evitando que se inyectara de forma retroactiva el enlace de LightData sobre el texto de Envíame).
2. **Corrección de Estado Real de LightData desde `raw_data[23]`**:
   - Si el estado de un envío de LightData es guardado como coordenada decimal debido al desfase de columnas histórico, el sistema recupera automáticamente el nombre legible del estado real (ej: *"En camino al destinatario"*) desde la columna oculta `raw_data[23]`.
   - Esto permite que tanto el WMS como el modal de "Editar Courier y N° Seguimiento" resuelvan correctamente el estado global como `"DESPACHADO"`, mostrando la descripción real del movimiento en lugar de figurar como `"SIN MOVIMIENTO"` o `"En reparto"` falso positivo.
3. **Eliminación de Opciones de Envío Duplicadas**:
   - Filtramos las sugerencias del modal de "Editar Courier y N° Seguimiento" para evitar que se ofrezcan opciones redundantes (como la Etiqueta Alpha genérica de LightData) cuando ya se encuentra disponible el envío unificado correspondiente de LightData, previniendo confusiones operacionales.
4. **Traducción Automática en la Vista de Envíos Consolidados**:
   - Actualizamos la columna de estado en la pestaña de **Envíos Consolidados** (`js/admin.js`) para que si un envío de LightData tiene coordenadas en su estado físico, las traduzca utilizando su verdadero estado de `raw_data[23]`, visualizándolo como *"En camino al destinatario"* en lugar de la traducción genérica predeterminada.
5. **Corrección de Tags e Indicador de Tracking en la Grilla Principal (Badges)**:
   - Se actualizó la generación del badge de estado global de despacho (`shipmentBadgeHtml`) mostrado en la grilla principal de pedidos (debajo del ID del pedido en la fila de badges) tanto en `js/admin.js` como en `js/app.js`.
   - Ahora, este badge también resuelve dinámicamente las coordenadas y los estados particulares a su estado global correspondiente (`DESPACHADO`, `ALERTA` o `SIN MOVIMIENTO`), garantizando alineación y coherencia absoluta con el detalle del panel derecho de integración.

---

## 78. Rediseño de Vista de Integración MercadoLibre (Formulario en Dos Columnas, Scroll Independiente y Timeline de Colaboradores)

Hemos implementado un rediseño completo de la interfaz de integración para **MercadoLibre Marketplace** en el WMS Stocka (`js/app.js`):

1. **Diseño de Dos Columnas (Split Layout)**:
   - Dividimos la pantalla del tab de MercadoLibre en dos columnas principales.
   - **Columna Izquierda (Formulario de Conexión)**: Se configuró con `position: sticky; top: 1.5rem;` para que permanezca flotando e inmóvil en pantalla mientras el usuario realiza scroll en la documentación de la derecha.
   - **Columna Derecha (Información y Guías)**: Se agruparon las secciones de *Guía de Integración*, *Servicios y Tarifas* y *Pasos Críticos Después de la Integración* en un contenedor de scroll independiente (`max-height: 80vh; overflow-y: auto;`). Esto mantiene siempre visible el formulario a la izquierda.

2. **Detalles Visuales e Iconografía**:
   - Siguiendo el lenguaje de diseño del formulario de ingreso de stock, añadimos iconos internos alineados a la izquierda de cada campo de texto (ej: `ri-fingerprint-line` para Client ID, `ri-shield-keyhole-line` para Client Secret, `ri-compass-3-line` para Redirect URI, `ri-ticket-line` para Código de Autorización y `ri-loop-left-line` para Refresh Token).
   - Los labels de los campos del formulario cuentan ahora con iconos descriptivos de color primario (`ri-key-line`, `ri-lock-password-line`, `ri-link-m`, `ri-qr-code-line`, `ri-refresh-line`).
   - Se añadieron iconos de acción a los botones de control (`ri-plug-line` para conectar, `ri-link-unlink` para desconectar y `ri-refresh-line` para sincronizar pedidos).

3. **Guía de Colaborador y Timeline Post-Integración**:
   - **Paso 1: Email de Colaborador**: Integra una consulta dinámica a `comercios_adicional_config`. Si existe un correo configurado, muestra un input de sólo lectura de color primario con un botón interactivo *"Copiar Email de Colaborador"* (`ri-file-copy-line`) para que el usuario copie la dirección asignada con un clic. Si no está configurado, renderiza un aviso recomendando contactar a su ejecutivo KAM de Stocka para la asignación de su correo de marketplace.
   - **Paso 2: Permisos del Rol**: Presenta una grilla con los permisos mínimos requeridos por el personal de bodega de Stocka (Publicación y Ventas, Envíos y Logística). Vincula directamente a la guía oficial de MercadoLibre mediante un enlace interactivo con icono externo.
   - **Paso 3: Notificación de Aceptación (Límite 24 hrs)**: Alerta al usuario sobre la caducidad automática de 24 horas del enlace de invitación oficial enviado por MercadoLibre, indicándole notificar a su KAM con prioridad crítica.

---

## 79. Rediseño de Vista de Integración Falabella (Formulario en Dos Columnas, Scroll Independiente y Guía de Colaborador)

Hemos replicado y adaptado el diseño moderno y guiado en dos columnas para **Falabella Marketplace (Mirakl)** en el WMS Stocka (`js/app.js`):

1. **Diseño de Dos Columnas (Split Layout)**:
   - **Columna Izquierda (Formulario de Conexión)**: El formulario se configuró con `position: sticky; top: 1.5rem;`, permaneciendo fijo en pantalla.
   - **Columna Derecha (Información y Guías)**: Las secciones de *Guía de Integración Falabella* y la nueva sección *Pasos Críticos Después de la Integración* se agruparon en un panel de scroll independiente (`max-height: 80vh; overflow-y: auto; padding-right: 0.5rem;`).

2. **Detalles Visuales e Iconografía**:
   - Agregamos iconos internos en la parte izquierda de cada campo de texto (`ri-compass-3-line` para URL API, `ri-mail-line` para User ID y `ri-shield-keyhole-line` para API Key).
   - Los labels de los campos del formulario cuentan ahora con iconos descriptivos de color primario (`ri-link-m`, `ri-user-line`, `ri-key-line`).
   - Añadimos iconos de acción a los botones de conexión/sincronización (`ri-plug-line` para conectar, `ri-link-unlink` para desconectar y `ri-refresh-line` para sincronizar pedidos y productos).

3. **Guía de Colaborador y Timeline Post-Integración**:
   - **Paso 1: Email de Colaborador**: Integra una consulta dinámica a `comercios_adicional_config`. Si existe un correo configurado, muestra un input de sólo lectura de color primario con un botón interactivo *"Copiar Email de Colaborador"* (`ri-file-copy-line`) para copiar la dirección asignada. Si no está configurado, renderiza un aviso recomendando contactar a su ejecutiva KAM.
   - **Paso 2: Creación y Permisos de Usuario**: Presenta la guía oficial de administración de usuarios en Falabella e instruye sobre el permiso obligatorio requerido por el personal de Stocka: **seller order access**.
   - **Paso 3: Notificación de Aceptación (Límite 24 hrs)**: Alerta al usuario sobre la caducidad del enlace de invitación, indicándole notificar a su KAM con prioridad crítica para proceder a la validación.

---

## 80. Corrección de Cierre de Contenedores en Pestaña de MercadoLibre (Walmart, WooCommerce, Tiendanube y Jumpseller Inactivos)

Hemos corregido un error de maquetación HTML en la pestaña de integración de MercadoLibre que afectaba el funcionamiento de las pestañas siguientes:

1. **El Problema**:
   - Al realizar el rediseño y depurar tags anteriores en la pestaña de MercadoLibre (`tab-meli`), los contenedores del layout de rejilla (`display: grid`) y del contenedor de pestaña principal (`#tab-meli`) quedaron abiertos (sin sus correspondientes etiquetas `</div>` de cierre).
   - Esto provocaba que el navegador interpretara las pestañas subsiguientes (Walmart, WooCommerce, Jumpseller y Tiendanube) como elementos anidados dentro de la pestaña de MercadoLibre.
   - Como consecuencia, cuando `tab-meli` se ocultaba (`display: none`), arrastraba a todas las pestañas siguientes, haciendo que al hacer clic sobre ellas se activaran en código, pero permanecieran completamente invisibles.

2. **La Solución**:
   - Agregamos los dos cierres de contenedor `</div>` faltantes al final del timeline del panel derecho de la pestaña de MercadoLibre (`js/app.js`), independizando correctamente cada panel.
   - Con esta corrección, la navegación entre las pestañas de **Walmart**, **WooCommerce**, **Jumpseller** y **Tiendanube** vuelve a funcionar con total normalidad y respuesta inmediata.

---

## 81. Robustecimiento de Fallbacks para Despachos de LightData en WMS (Cliente y Administrador)

Hemos robustecido la consistencia de los datos de despacho de LightData en todo el WMS, asegurando que no se pierdan estados reales ni enlaces de seguimiento en ningún punto de la interfaz:

1. **Fallback Inteligente a `order.raw_lightdata_data`**:
   - En las vistas detalladas del pedido (tanto para cliente en `js/app.js` como administrador en `js/admin.js`) y en las funciones de ordenamiento de la grilla de pedidos, si un envío proviene de LightData y su campo de estado es una coordenada decimal, el WMS busca proactivamente la descripción textual en el JSON histórico de la integración (`order.raw_lightdata_data.raw_data[23]`).
   - Del mismo modo, el enlace de seguimiento de LightData se recupera directamente del JSON histórico (`order.raw_lightdata_data.raw_data[31]`) si el registro de la tabla unificada de envíos no lo tiene disponible.

2. **Badges de Plataforma Integrados**:
   - Diseñamos y agregamos badges distintivos para cada plataforma de origen de despacho (**LightData**, **Envíame**, **OptiRoute**) en la vista detallada de órdenes del cliente, alineándolos estéticamente con el panel del administrador y facilitando la identificación instantánea del courier por parte del usuario.

3. **Consistencia de Badges en la Grilla Principal**:
   - Actualizamos la columna y fila de badges de despacho de la grilla principal para resolver adecuadamente las coordenadas geográficas de LightData a su estado global correspondiente (`DESPACHADO`, `ALERTA` o `SIN MOVIMIENTO`), garantizando una experiencia de usuario sin información desalineada.

---

## 82. Reubicación del Módulo "Reasignar Comercio / Tienda"

Para evitar sobrecargar visualmente la columna de **Integración y Despacho** (Columna 3 en el detalle del pedido) y mantener un flujo de trabajo más limpio e intuitivo:

1. **Reubicación de la Sección**:
   - Movimos la sección **Reasignar Comercio / Tienda** (el selector de comercios) al final de la columna central de **Ítems del Pedido** (Columna 2), justo debajo del desglose de productos.
2. **Estilo y Espaciado**:
   - Se le aplicó un margen superior de `1.25rem` (`margin-top: 1.25rem;`) y se mantuvo el borde discontinuo estilo premium, logrando que el selector esté perfectamente integrado y no genere contaminación visual en el panel de transportes.

---

## 83. Consistencia de la Vista de Detalles del Pedido en el Portal del Cliente (Tags y Datos Premium sin Edición)

Hemos mejorado drásticamente la consistencia de la interfaz del portal de clientes (`js/app.js`) para alinearla al diseño premium del administrador:

1. **Alineación Estética de Integración y Despacho**:
   - Reemplazamos la columna 3 simplificada del cliente por el diseño premium estructurado en tarjetas de la vista de administrador.
   - El cliente ahora visualiza el bloque de **Origen de la Orden** (Plataforma, ID de Pedido, Estado de Plataforma), el bloque de **Courier y Tracking** (Courier Asignado, Enlace de Seguimiento con badges de estado global/crudo y botón de etiqueta si corresponde), y el bloque de **Auto Track / Monitoreo** (con su diseño dinámico de Radar).

2. **Sin Capacidad de Edición para el Cliente**:
   - Aislamos todos los controles y botones de edición de la columna 3 (tales como "Editar Envío", "Editar Picking", selectores de reasignación) para que el cliente únicamente visualice la información en formato de lectura premium, resguardando la integridad operacional del WMS.

3. **Reubicación y Organización de Campos Logísticos**:
   - Agrupamos de forma prolija los campos de logística interna (**Sucursal Pickeo**, **Agenda Picking**, **Fecha Procesamiento** y **Operador Courier**) en una sección de lectura con bordes punteados al final de la columna 1 (**Datos de Despacho**).
   - Añadimos la columna `sucursal_pickeo` a la consulta de órdenes principal de la sección de clientes para garantizar su correcta visualización.

4. **Soporte Completo de Etiqueta (Descarga y Enlace)**:
   - Añadimos soporte para renderizar tanto etiquetas descargables en Base64 como enlaces directos a etiquetas externas (`order.label_url`) para que los clientes puedan consultar o descargar el archivo original directamente si está disponible.

---

## 84. Consistencia Total de Visibilidad de Despacho y Estados de Seguimiento para el Cliente

Para cumplir a cabalidad con la solicitud de que el portal del cliente tenga la misma visibilidad y visualización exacta de envíos y estados que la del administrador:

1. **Remoción de Filtro `visible_to_client`**:
   - Eliminamos la restricción `.eq('visible_to_client', true)` de todas las consultas Supabase hacia la tabla `envios_unificados` en `js/app.js`.
   - Esto permite que el cliente recupere los registros de despacho y tracking para sus pedidos de forma irrestricta (al igual que el administrador), solucionando el problema donde los envíos quedaban invisibles debido a dicho flag.
   - La seguridad de los datos se mantiene garantizada a nivel de comercio/proveedor mediante el filtrado de pertenencia por `companyList` de la cuenta.

2. **Visibilidad de Badges de Seguimiento en la Rejilla y Modal**:
   - Al cargar correctamente la información de despacho unificado sin filtros restrictivos, ahora se renderizan en tiempo real los badges de estado global (`DESPACHADO`, `ALERTA`, etc.) y el estado particular descriptivo tanto en la columna de badges de la fila de la grilla principal de pedidos como en la tarjeta de Auto Track del detalle del pedido.

---

## 85. Optimización Chunked para Carga de Despachos Unificados en Cliente (Prevención de Error HTTP 414)

Al cargar la lista de despachos unificados asociados a los pedidos del cliente en [js/app.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/app.js):

1. **El Problema**:
   - Las consultas a `envios_unificados` usaban `.in('pedido_referencia', allRefs)` con una lista que contenía los identificadores de todos los pedidos cargados del mes (más de 1,500 referencias en clientes de alto volumen).
   - Esto resultaba en peticiones HTTP con URLs excesivamente largas que excedían los límites del servidor (HTTP 414 URI Too Large), causando que la consulta fallara silenciosamente y dejara la lista de envíos vacía, mostrando el seguimiento como `-`.

2. **La Solución (Consulta Segmentada)**:
   - Implementamos la función `fetchEnviosUnificadosByRefs(allRefs)` en el cliente con un tamaño de lote (`CHUNK_SIZE`) de 150 elementos, idéntica a la optimización del panel de administración.
   - Reemplazamos las llamadas directas de consulta de despachos tanto para la carga inicial de la grilla como para la carga en segundo plano del historial histórico.
   - Esto garantiza la correcta asociación de despachos (incluyendo los de OptiRoute/Stocka X como el del pedido `MAG5609`) bajo cualquier volumen de órdenes.

---

## 86. Corrección de RLS para el Registro de Observaciones de Facturación (Portal Cliente)

Hemos detectado y corregido un problema de seguridad a nivel de base de datos (RLS) que impedía a los usuarios cliente enviar comentarios u observaciones sobre sus facturas:

1. **Causa Raíz de la Falla Silenciosa**:
   - En la tabla `public.billing_records`, existía una política de lectura (`FOR SELECT`) para clientes, pero no una política que permitiera la actualización (`FOR UPDATE`).
   - Como resultado, cuando un cliente (por ejemplo, `mlg@magicmakeup.cl`) rellenaba la apelación en el portal y enviaba la solicitud, la API de Supabase rechazaba el `UPDATE` retornando `0` filas actualizadas. En la interfaz cliente esto no arrojaba un error de red y simulaba un éxito aparente, pero el comentario nunca llegaba a guardarse.

2. **Aplicación de la Nueva Política de UPDATE**:
   - Diseñamos la política `"Clientes pueden actualizar observaciones de sus comercios"` para la tabla `public.billing_records`.
   - Esta política restringe la actualización para que el usuario autenticado solo pueda modificar registros que pertenezcan a su comercio (siguiendo el mismo esquema riguroso del filtrado de lectura).
   - Generamos el archivo de migración [supabase_schema_billing_records_policy_fix.sql](file:///c:/Users/felip/Desktop/WMS%20STOCKA/supabase_schema_billing_records_policy_fix.sql) con las sentencias correspondientes y actualizamos el archivo consolidado [supabase_schema_billing.sql](file:///c:/Users/felip/Desktop/WMS%20STOCKA/supabase_schema_billing.sql).

---

## 87. Sincronización de Prefijos en Webhooks y Limpieza de Pedidos Duplicados (SMILE FOR PETS)

Detectamos y corregimos un problema de duplicación de pedidos que afectaba al comercio **SMILE FOR PETS** (y potencialmente a otros comercios con prefijos personalizados de Shopify):

1. **Causa Raíz de la Duplicación**:
   - En la base de datos existía el comercio `SMILE FOR PETS` con la sigla `SFP` configurada en `comercios_adicional_config` con `agregar_prefijo: true` para Shopify.
   - El webhook en tiempo real (`shopify-webhook` Edge Function) insertaba las órdenes con su identificador original de Shopify (ej: `#3326`).
   - El script programado `sync_shopify.js` procesaba las órdenes aplicando el prefijo (`SFP#3326`) y, al buscarlas en la base de datos para actualizar, no encontraba concordancia con `#3326`, por lo que insertaba un registro duplicado.

2. **Resolución de la Duplicación en Webhooks**:
   - Modificamos la Edge Function [index.ts](file:///c:/Users/felip/Desktop/WMS%20STOCKA/supabase/functions/shopify-webhook/index.ts) para implementar la misma lógica de resolución de prefijos que `sync_shopify.js`, utilizando las consultas a `v_comercios_config` y `comercios_adicional_config`.
   - Ahora, tanto el webhook como el script programado resuelven exactamente la misma referencia final (ej: `SFP#3326`), evitando la creación de duplicados a futuro.

3. **Saneamiento de Datos Históricos**:
   - Diseñamos y ejecutamos un script inteligente de purga ([execute_smile_cleanup.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/scratch/execute_smile_cleanup.js)) que analizó 50 grupos de duplicados de `SMILE FOR PETS`.
   - El script priorizó conservar el registro con el estado más avanzado en el WMS (ej: `Pickeado` o `Despachado`) frente a `En procesamiento`.
   - Eliminó las copias sobrantes respetando la integridad (eliminación en cascada de items) y formateó las órdenes conservadas con el prefijo correcto `SFP#` si no lo tenían, asegurando coherencia total de datos y eliminando los 50 grupos de duplicados.

---

## 88. Búsqueda por Lista de Pedidos (Multiselección) y Persistencia de Selección en WMS

Hemos implementado dos importantes mejoras de usabilidad en el panel del WMS Administrador:

1. **Botón de Multiselección y Ventana Modal**:
   - Reemplazamos la caja de texto estática por un botón estilizado **"Multiselección"** en la barra de filtros del WMS.
   - Al hacer clic, abre un modal emergente interactivo (SweetAlert) donde el operador puede pegar cómodamente los números de pedido o IDs de Supabase.
   - El modal ofrece tres opciones claras: **Aplicar Filtro**, **Limpiar Filtro** y **Cancelar**.
   - Al aplicar el filtro, el botón cambia dinámicamente de apariencia (borde y fondo en color primario de acento) y muestra el contador de pedidos filtrados (ej: `Multiselección (8)`).
   - **Auto-selección Inteligente**: Al ingresar una lista de pedidos mediante el modal de multiselección, el sistema selecciona automáticamente y de forma inmediata todos los pedidos coincidentes en el WMS (marcándolos con el checkbox y sumándolos al conjunto de órdenes seleccionadas), de modo que el operador puede aplicar acciones masivas inmediatamente.

2. **Persistencia de Selección tras Acciones Masivas**:
   - Anteriormente, al ejecutar una acción masiva (como asignar operador, asignar datos de preparación o asignar periodo de facturación), la selección de pedidos se borraba (`wmsSelectedOrderIds.clear()`) de manera automática.
   - Modificamos las funciones `bulkSetWmsOrderOperador`, `bulkSetWmsOrderPickingInfo` y `bulkSetWmsOrderBillingPeriod` para que **no limpien** el conjunto de pedidos seleccionados.
   - Esto permite que los pedidos sigan seleccionados después de que la base de datos se actualice, facilitando al operador encadenar múltiples configuraciones masivas sucesivas sobre la misma selección de pedidos sin tener que volver a buscarlos y marcarlos.

---

## 89. Separación de Flujos de Registro e Incorporación en la Página de Acceso (Login)

Modificamos la interfaz de la página de inicio de sesión (`index.html`) para diferenciar con total claridad el canal de nuevos clientes del canal de clientes existentes:

1. **Doble Tarjeta Guiada (Dual-Path Layout)**:
   - **¿Nuevo en Stocka? (Solicitar Alta)**: Mantenemos el recuadro con temática violeta (`--color-accent` / `@ri-rocket-2-line`) destinado a los comercios nuevos que desean iniciar su cotización e incorporación a Stocka, dirigiéndolos hacia `onboarding.html`.
   - **¿Ya eres cliente de Stocka? (Crear Cuenta)**: Diseñamos una nueva tarjeta con bordes punteados de color esmeralda (`--color-success` / `@ri-user-add-line`) dedicada a los clientes con servicio contratado que únicamente necesitan su usuario para acceder al portal.

2. **Remoción de Enlaces Confusos**:
   - Eliminamos el enlace de texto plano simple del pie de página que decía *"¿No tienes una cuenta? Regístrate aquí"*. Esto evita que los clientes se confundan y realicen el flujo de onboarding comercial creyendo que es el registro regular del WMS.
   - El nuevo botón *"Crear tu Cuenta de Usuario"* reutiliza el disparador de alternancia original (`#toggle-to-register`), asegurando compatibilidad nativa con la lógica existente de `js/auth.js`.

---

## 90. Implementación de Slideshow (Carrusel) de Características WMS en la Página de Login

Transformamos la columna derecha estática de la página de inicio de sesión (`index.html`) en un carrusel interactivo y premium que educa a los usuarios sobre las funcionalidades clave del WMS Stocka:

1. **Diseño de Diapositivas e Iconografía Premium**:
   - **Slide 1 (Inventario)**: *Control de Inventario en Tiempo Real* (icono `ri-archive-line`), ilustrando el control de stock, mapping de SKU y packs.
   - **Slide 2 (Preparación)**: *Picking y Empaque Automatizado* (icono `ri-barcode-box-line`), destacando la sincronización multicanal y lectura de códigos de barras.
   - **Slide 3 (Envíos)**: *Monitoreo y Despacho Multicourier* (icono `ri-truck-line`), mostrando Auto Track y emisión automática de etiquetas.
   - **Slide 4 (Finanzas)**: *Finanzas y Reportes Transparentes* (icono `ri-file-chart-line`), describiendo el control de cobros y el flujo de apelaciones directas.

2. **Detalles de Animación y Estilos (Style.css)**:
   - Añadimos clases CSS (`.auth-slider-container`, `.auth-slide`, `.auth-slide-bg`, `.auth-slide-content`, `.auth-slider-dots` y `.auth-slider-dot`) al final de `css/style.css`.
   - Implementamos efectos de transición de opacidad cruzada (`opacity`), zoom progresivo (`transform: scale`) en los fondos, y entrada flotante (`translateY`) en el contenido de texto.
   - Cuenta con una capa de gradiente oscuro (`auth-slide-overlay`) que garantiza excelente legibilidad de los textos blancos sobre cualquier imagen de fondo.

3. **Lógica de Control Asíncrona (Auth.js)**:
   - Agregamos la lógica en `js/auth.js` que gestiona la rotación automática cada 5 segundos y responde de inmediato al clic en los puntos indicadores (dots) inferiores para la navegación manual.

---

## 91. Corrección de Pedidos MercadoLibre Duplicados en Webhooks y Saneamiento de Datos

Detectamos y corregimos un problema de duplicación de pedidos que afectaba a la integración de MercadoLibre:

1. **Causa Raíz de la Duplicación**:
   - La Edge Function `meli-webhook` insertaba las órdenes con su identificador original de MercadoLibre (ej: `2000014053625735`).
   - El script programado `sync_meli.js` procesaba las órdenes aplicando el prefijo/sigla del comercio de forma automatizada (ej: `MAG2000014053625735` para MAGIC MAKEUP).
   - Cuando el script programado buscaba si el pedido existía en la base de datos para no duplicarlo, buscaba por el formato con prefijo (`MAG2000014053625735`). Como el webhook lo había insertado sin prefijo (`2000014053625735`), no encontraba concordancia y volvía a insertar la orden, generando un duplicado.

2. **Resolución en Webhooks (`supabase/functions/meli-webhook/index.ts`)**:
   - Implementamos la función de resolución de prefijos `resolveMeliOrderNumber(comercio, originalGroupId)` que lee dinámicamente `v_comercios_config` y `comercios_adicional_config` para resolver el prefijo de MercadoLibre idénticamente al script `sync_meli.js`.
   - Modificamos la comprobación de existencia previa en el webhook para buscar por ambos formatos usando `.in('external_order_number', [groupId, finalGroupId])`. Esto previene duplicaciones incluso si alguna orden fue creada inicialmente sin prefijo.
   - Guardamos las nuevas órdenes en la base de datos usando el número unificado con prefijo (`finalGroupId`).

3. **Saneamiento Histórico Total (`scratch/execute_meli_cleanup.js`)**:
   - Desarrollamos un script de purga paginado inteligente que analizó toda la historia de pedidos de MercadoLibre (2,241 registros).
   - Identificó 349 grupos duplicados y evaluó cuál de los registros conservar: priorizó el que tuviese un estado de WMS más avanzado en bodega (ej: `Despachado` o `Pickeado` sobre `En procesamiento`).
   - Eliminó las 349 órdenes duplicadas sobrantes, renombró las conservadas al formato con prefijo unificado si era necesario, y actualizó concurrentemente la columna `pedido_referencia` en la tabla unificada de despachos (`envios_unificados`) para evitar que se perdiera el enlace de seguimiento en el portal de clientes.

---

## 92. Prevención Global de Duplicados por Cambios de Prefijo y Limpieza de Falabella y París

Extendimos la solución de prevención de duplicados de forma proactiva y realizamos la limpieza en las demás plataformas integradas:

1. **Detección e Identificación**:
   - Analizamos toda la base de datos buscando duplicados en otras plataformas integradas. Detectamos un patrón de duplicados menor en **Falabella** (7 grupos) y **París** (26 grupos) afectando a comercios como `SERPA LTDA`, `MAGIC MAKEUP`, `RCT CHILE` y `THE SKIN STORE`.
   - **Causa**: Estos duplicados ocurrieron cuando los comercios cambiaron su configuración de prefijos (`agregarPrefijo` habilitado/deshabilitado en base de datos) a mitad de camino. Los scripts de sincronización buscaban por el nuevo formato del número de orden, no encontraban el registro anterior y lo duplicaban.

2. **Saneamiento Histórico Concurrente (`scratch/execute_all_platforms_cleanup.js`)**:
   - Desarrollamos y ejecutamos un script de limpieza multicorreo enfocado en Falabella y París.
   - Procesó 33 grupos duplicados históricos aplicando el mismo criterio operativo (conservando la orden con mayor estado operativo en WMS, renombrándola si correspondía, eliminando la duplicada inútil, y actualizando la columna unificada `pedido_referencia` en `envios_unificados`).

3. **Protección Proactiva Transversal en Sincronizadores y Webhooks**:
   - Para evitar duplicaciones futuras por cambios de configuración de siglas/prefijos en base de datos, modificamos todos los scripts y webhooks para que realicen búsquedas tolerantes a prefijos (`.in('external_order_number', [orderNumber, finalOrderNumber])`).
   - Los archivos actualizados son:
     * **Sincronizadores**: [sync_falabella.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/sync_falabella.js), [sync_paris.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/sync_paris.js), [sync_jumpseller.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/sync_jumpseller.js) y [sync_tiendanube.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/sync_tiendanube.js).
     * **Webhooks**: [supabase/functions/shopify-webhook/index.ts](file:///c:/Users/felip/Desktop/WMS%20STOCKA/supabase/functions/shopify-webhook/index.ts), [supabase/functions/jumpseller-webhook/index.ts](file:///c:/Users/felip/Desktop/WMS%20STOCKA/supabase/functions/jumpseller-webhook/index.ts) y [supabase/functions/tiendanube-webhook/index.ts](file:///c:/Users/felip/Desktop/WMS%20STOCKA/supabase/functions/tiendanube-webhook/index.ts).

---

## 93. Desacoplamiento y Separación Completa de Observaciones/Apelaciones para Envíame y Fulfillment

Hemos implementado un desacoplamiento completo para las observaciones y apelaciones de cobro de facturación de los clientes, permitiendo manejar de forma independiente las disputas de Fulfillment y Envíame:

1. **Estructura de Base de Datos e Integración de RLS**:
   - Agregamos las nuevas columnas a la tabla `billing_records`: `client_observation_enviame`, `admin_response_enviame`, `observation_status_enviame`, y `observation_updated_at_enviame`.
   - Modificamos la política RLS `Clientes pueden actualizar observaciones de sus comercios` en `public.billing_records` para permitir que los clientes actualicen los campos de observaciones y estados tanto de Fulfillment como de Envíame de manera segura.
## 82. Reubicación del Módulo "Reasignar Comercio / Tienda"

Para evitar sobrecargar visualmente la columna de **Integración y Despacho** (Columna 3 en el detalle del pedido) y mantener un flujo de trabajo más limpio e intuitivo:

1. **Reubicación de la Sección**:
   - Movimos la sección **Reasignar Comercio / Tienda** (el selector de comercios) al final de la columna central de **Ítems del Pedido** (Columna 2), justo debajo del desglose de productos.
2. **Estilo y Espaciado**:
   - Se le aplicó un margen superior de `1.25rem` (`margin-top: 1.25rem;`) y se mantuvo el borde discontinuo estilo premium, logrando que el selector esté perfectamente integrado y no genere contaminación visual en el panel de transportes.

---

## 83. Consistencia de la Vista de Detalles del Pedido en el Portal del Cliente (Tags y Datos Premium sin Edición)

Hemos mejorado drásticamente la consistencia de la interfaz del portal de clientes (`js/app.js`) para alinearla al diseño premium del administrador:

1. **Alineación Estética de Integración y Despacho**:
   - Reemplazamos la columna 3 simplificada del cliente por el diseño premium estructurado en tarjetas de la vista de administrador.
   - El cliente ahora visualiza el bloque de **Origen de la Orden** (Plataforma, ID de Pedido, Estado de Plataforma), el bloque de **Courier y Tracking** (Courier Asignado, Enlace de Seguimiento con badges de estado global/crudo y botón de etiqueta si corresponde), y el bloque de **Auto Track / Monitoreo** (con su diseño dinámico de Radar).

2. **Sin Capacidad de Edición para el Cliente**:
   - Aislamos todos los controles y botones de edición de la columna 3 (tales como "Editar Envío", "Editar Picking", selectores de reasignación) para que el cliente únicamente visualice la información en formato de lectura premium, resguardando la integridad operacional del WMS.

3. **Reubicación y Organización de Campos Logísticos**:
   - Agrupamos de forma prolija los campos de logística interna (**Sucursal Pickeo**, **Agenda Picking**, **Fecha Procesamiento** y **Operador Courier**) en una sección de lectura con bordes punteados al final de la columna 1 (**Datos de Despacho**).
   - Añadimos la columna `sucursal_pickeo` a la consulta de órdenes principal de la sección de clientes para garantizar su correcta visualización.

4. **Soporte Completo de Etiqueta (Descarga y Enlace)**:
   - Añadimos soporte para renderizar tanto etiquetas descargables en Base64 como enlaces directos a etiquetas externas (`order.label_url`) para que los clientes puedan consultar o descargar el archivo original directamente si está disponible.

---

## 84. Consistencia Total de Visibilidad de Despacho y Estados de Seguimiento para el Cliente

Para cumplir a cabalidad con la solicitud de que el portal del cliente tenga la misma visibilidad y visualización exacta de envíos y estados que la del administrador:

1. **Remoción de Filtro `visible_to_client`**:
   - Eliminamos la restricción `.eq('visible_to_client', true)` de todas las consultas Supabase hacia la tabla `envios_unificados` en `js/app.js`.
   - Esto permite que el cliente recupere los registros de despacho y tracking para sus pedidos de forma irrestricta (al igual que el administrador), solucionando el problema donde los envíos quedaban invisibles debido a dicho flag.
   - La seguridad de los datos se mantiene garantizada a nivel de comercio/proveedor mediante el filtrado de pertenencia por `companyList` de la cuenta.

2. **Visibilidad de Badges de Seguimiento en la Rejilla y Modal**:
   - Al cargar correctamente la información de despacho unificado sin filtros restrictivos, ahora se renderizan en tiempo real los badges de estado global (`DESPACHADO`, `ALERTA`, etc.) y el estado particular descriptivo tanto en la columna de badges de la fila de la grilla principal de pedidos como en la tarjeta de Auto Track del detalle del pedido.

---

## 85. Optimización Chunked para Carga de Despachos Unificados en Cliente (Prevención de Error HTTP 414)

Al cargar la lista de despachos unificados asociados a los pedidos del cliente en [js/app.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/js/app.js):

1. **El Problema**:
   - Las consultas a `envios_unificados` usaban `.in('pedido_referencia', allRefs)` con una lista que contenía los identificadores de todos los pedidos cargados del mes (más de 1,500 referencias en clientes de alto volumen).
   - Esto resultaba en peticiones HTTP con URLs excesivamente largas que excedían los límites del servidor (HTTP 414 URI Too Large), causando que la consulta fallara silenciosamente y dejara la lista de envíos vacía, mostrando el seguimiento como `-`.

2. **La Solución (Consulta Segmentada)**:
   - Implementamos la función `fetchEnviosUnificadosByRefs(allRefs)` en el cliente con un tamaño de lote (`CHUNK_SIZE`) de 150 elementos, idéntica a la optimización del panel de administración.
   - Reemplazamos las llamadas directas de consulta de despachos tanto para la carga inicial de la grilla como para la carga en segundo plano del historial histórico.
   - Esto garantiza la correcta asociación de despachos (incluyendo los de OptiRoute/Stocka X como el del pedido `MAG5609`) bajo cualquier volumen de órdenes.

---

## 86. Corrección de RLS para el Registro de Observaciones de Facturación (Portal Cliente)

Hemos detectado y corregido un problema de seguridad a nivel de base de datos (RLS) que impedía a los usuarios cliente enviar comentarios u observaciones sobre sus facturas:

1. **Causa Raíz de la Falla Silenciosa**:
   - En la tabla `public.billing_records`, existía una política de lectura (`FOR SELECT`) para clientes, pero no una política que permitiera la actualización (`FOR UPDATE`).
   - Como resultado, cuando un cliente (por ejemplo, `mlg@magicmakeup.cl`) rellenaba la apelación en el portal y enviaba la solicitud, la API de Supabase rechazaba el `UPDATE` retornando `0` filas actualizadas. En la interfaz cliente esto no arrojaba un error de red y simulaba un éxito aparente, pero el comentario nunca llegaba a guardarse.

2. **Aplicación de la Nueva Política de UPDATE**:
   - Diseñamos la política `"Clientes pueden actualizar observaciones de sus comercios"` para la tabla `public.billing_records`.
   - Esta política restringe la actualización para que el usuario autenticado solo pueda modificar registros que pertenezcan a su comercio (siguiendo el mismo esquema riguroso del filtrado de lectura).
   - Generamos el archivo de migración [supabase_schema_billing_records_policy_fix.sql](file:///c:/Users/felip/Desktop/WMS%20STOCKA/supabase_schema_billing_records_policy_fix.sql) con las sentencias correspondientes y actualizamos el archivo consolidado [supabase_schema_billing.sql](file:///c:/Users/felip/Desktop/WMS%20STOCKA/supabase_schema_billing.sql).

---

## 87. Sincronización de Prefijos en Webhooks y Limpieza de Pedidos Duplicados (SMILE FOR PETS)

Detectamos y corregimos un problema de duplicación de pedidos que afectaba al comercio **SMILE FOR PETS** (y potencialmente a otros comercios con prefijos personalizados de Shopify):

1. **Causa Raíz de la Duplicación**:
   - En la base de datos existía el comercio `SMILE FOR PETS` con la sigla `SFP` configurada en `comercios_adicional_config` con `agregar_prefijo: true` para Shopify.
   - El webhook en tiempo real (`shopify-webhook` Edge Function) insertaba las órdenes con su identificador original de Shopify (ej: `#3326`).
   - El script programado `sync_shopify.js` procesaba las órdenes aplicando el prefijo (`SFP#3326`) y, al buscarlas en la base de datos para actualizar, no encontraba concordancia con `#3326`, por lo que insertaba un registro duplicado.

2. **Resolución de la Duplicación en Webhooks**:
   - Modificamos la Edge Function [index.ts](file:///c:/Users/felip/Desktop/WMS%20STOCKA/supabase/functions/shopify-webhook/index.ts) para implementar la misma lógica de resolución de prefijos que `sync_shopify.js`, utilizando las consultas a `v_comercios_config` y `comercios_adicional_config`.
   - Ahora, tanto el webhook como el script programado resuelven exactamente la misma referencia final (ej: `SFP#3326`), evitando la creación de duplicados a futuro.

3. **Saneamiento de Datos Históricos**:
   - Diseñamos y ejecutamos un script inteligente de purga ([execute_smile_cleanup.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/scratch/execute_smile_cleanup.js)) que analizó 50 grupos de duplicados de `SMILE FOR PETS`.
   - El script priorizó conservar el registro con el estado más avanzado en el WMS (ej: `Pickeado` o `Despachado`) frente a `En procesamiento`.
   - Eliminó las copias sobrantes respetando la integridad (eliminación en cascada de items) y formateó las órdenes conservadas con el prefijo correcto `SFP#` si no lo tenían, asegurando coherencia total de datos y eliminando los 50 grupos de duplicados.

---

## 88. Búsqueda por Lista de Pedidos (Multiselección) y Persistencia de Selección en WMS

Hemos implementado dos importantes mejoras de usabilidad en el panel del WMS Administrador:

1. **Botón de Multiselección y Ventana Modal**:
   - Reemplazamos la caja de texto estática por un botón estilizado **"Multiselección"** en la barra de filtros del WMS.
   - Al hacer clic, abre un modal emergente interactivo (SweetAlert) donde el operador puede pegar cómodamente los números de pedido o IDs de Supabase.
   - El modal ofrece tres opciones claras: **Aplicar Filtro**, **Limpiar Filtro** y **Cancelar**.
   - Al aplicar el filtro, el botón cambia dinámicamente de apariencia (borde y fondo en color primario de acento) y muestra el contador de pedidos filtrados (ej: `Multiselección (8)`).
   - **Auto-selección Inteligente**: Al ingresar una lista de pedidos mediante el modal de multiselección, el sistema selecciona automáticamente y de forma inmediata todos los pedidos coincidentes en el WMS (marcándolos con el checkbox y sumándolos al conjunto de órdenes seleccionadas), de modo que el operador puede aplicar acciones masivas inmediatamente.

2. **Persistencia de Selección tras Acciones Masivas**:
   - Anteriormente, al ejecutar una acción masiva (como asignar operador, asignar datos de preparación o asignar periodo de facturación), la selección de pedidos se borraba (`wmsSelectedOrderIds.clear()`) de manera automática.
   - Modificamos las funciones `bulkSetWmsOrderOperador`, `bulkSetWmsOrderPickingInfo` y `bulkSetWmsOrderBillingPeriod` para que **no limpien** el conjunto de pedidos seleccionados.
   - Esto permite que los pedidos sigan seleccionados después de que la base de datos se actualice, facilitando al operador encadenar múltiples configuraciones masivas sucesivas sobre la misma selección de pedidos sin tener que volver a buscarlos y marcarlos.

---

## 89. Separación de Flujos de Registro e Incorporación en la Página de Acceso (Login)

Modificamos la interfaz de la página de inicio de sesión (`index.html`) para diferenciar con total claridad el canal de nuevos clientes del canal de clientes existentes:

1. **Doble Tarjeta Guiada (Dual-Path Layout)**:
   - **¿Nuevo en Stocka? (Solicitar Alta)**: Mantenemos el recuadro con temática violeta (`--color-accent` / `@ri-rocket-2-line`) destinado a los comercios nuevos que desean iniciar su cotización e incorporación a Stocka, dirigiéndolos hacia `onboarding.html`.
   - **¿Ya eres cliente de Stocka? (Crear Cuenta)**: Diseñamos una nueva tarjeta con bordes punteados de color esmeralda (`--color-success` / `@ri-user-add-line`) dedicada a los clientes con servicio contratado que únicamente necesitan su usuario para acceder al portal.

2. **Remoción de Enlaces Confusos**:
   - Eliminamos el enlace de texto plano simple del pie de página que decía *"¿No tienes una cuenta? Regístrate aquí"*. Esto evita que los clientes se confundan y realicen el flujo de onboarding comercial creyendo que es el registro regular del WMS.
   - El nuevo botón *"Crear tu Cuenta de Usuario"* reutiliza el disparador de alternancia original (`#toggle-to-register`), asegurando compatibilidad nativa con la lógica existente de `js/auth.js`.

---

## 90. Implementación de Slideshow (Carrusel) de Características WMS en la Página de Login

Transformamos la columna derecha estática de la página de inicio de sesión (`index.html`) en un carrusel interactivo y premium que educa a los usuarios sobre las funcionalidades clave del WMS Stocka:

1. **Diseño de Diapositivas e Iconografía Premium**:
   - **Slide 1 (Inventario)**: *Control de Inventario en Tiempo Real* (icono `ri-archive-line`), ilustrando el control de stock, mapping de SKU y packs.
   - **Slide 2 (Preparación)**: *Picking y Empaque Automatizado* (icono `ri-barcode-box-line`), destacando la sincronización multicanal y lectura de códigos de barras.
   - **Slide 3 (Envíos)**: *Monitoreo y Despacho Multicourier* (icono `ri-truck-line`), mostrando Auto Track y emisión automática de etiquetas.
   - **Slide 4 (Finanzas)**: *Finanzas y Reportes Transparentes* (icono `ri-file-chart-line`), describiendo el control de cobros y el flujo de apelaciones directas.

2. **Detalles de Animación y Estilos (Style.css)**:
   - Añadimos clases CSS (`.auth-slider-container`, `.auth-slide`, `.auth-slide-bg`, `.auth-slide-content`, `.auth-slider-dots` y `.auth-slider-dot`) al final de `css/style.css`.
   - Implementamos efectos de transición de opacidad cruzada (`opacity`), zoom progresivo (`transform: scale`) en los fondos, y entrada flotante (`translateY`) en el contenido de texto.
   - Cuenta con una capa de gradiente oscuro (`auth-slide-overlay`) que garantiza excelente legibilidad de los textos blancos sobre cualquier imagen de fondo.

3. **Lógica de Control Asíncrona (Auth.js)**:
   - Agregamos la lógica en `js/auth.js` que gestiona la rotación automática cada 5 segundos y responde de inmediato al clic en los puntos indicadores (dots) inferiores para la navegación manual.

---

## 91. Corrección de Pedidos MercadoLibre Duplicados en Webhooks y Saneamiento de Datos

Detectamos y corregimos un problema de duplicación de pedidos que afectaba a la integración de MercadoLibre:

1. **Causa Raíz de la Duplicación**:
   - La Edge Function `meli-webhook` insertaba las órdenes con su identificador original de MercadoLibre (ej: `2000014053625735`).
   - El script programado `sync_meli.js` procesaba las órdenes aplicando el prefijo/sigla del comercio de forma automatizada (ej: `MAG2000014053625735` para MAGIC MAKEUP).
   - Cuando el script programado buscaba si el pedido existía en la base de datos para no duplicarlo, buscaba por el formato con prefijo (`MAG2000014053625735`). Como el webhook lo había insertado sin prefijo (`2000014053625735`), no encontraba concordancia y volvía a insertar la orden, generando un duplicado.

2. **Resolución en Webhooks (`supabase/functions/meli-webhook/index.ts`)**:
   - Implementamos la función de resolución de prefijos `resolveMeliOrderNumber(comercio, originalGroupId)` que lee dinámicamente `v_comercios_config` y `comercios_adicional_config` para resolver el prefijo de MercadoLibre idénticamente al script `sync_meli.js`.
   - Modificamos la comprobación de existencia previa en el webhook para buscar por ambos formatos usando `.in('external_order_number', [groupId, finalGroupId])`. Esto previene duplicaciones incluso si alguna orden fue creada inicialmente sin prefijo.
   - Guardamos las nuevas órdenes en la base de datos usando el número unificado con prefijo (`finalGroupId`).

3. **Saneamiento Histórico Total (`scratch/execute_meli_cleanup.js`)**:
   - Desarrollamos un script de purga paginado inteligente que analizó toda la historia de pedidos de MercadoLibre (2,241 registros).
   - Identificó 349 grupos duplicados y evaluó cuál de los registros conservar: priorizó el que tuviese un estado de WMS más avanzado en bodega (ej: `Despachado` o `Pickeado` sobre `En procesamiento`).
   - Eliminó las 349 órdenes duplicadas sobrantes, renombró las conservadas al formato con prefijo unificado si era necesario, y actualizó concurrentemente la columna `pedido_referencia` en la tabla unificada de despachos (`envios_unificados`) para evitar que se perdiera el enlace de seguimiento en el portal de clientes.

---

## 92. Prevención Global de Duplicados por Cambios de Prefijo y Limpieza de Falabella y París

Extendimos la solución de prevención de duplicados de forma proactiva y realizamos la limpieza en las demás plataformas integradas:

1. **Detección e Identificación**:
   - Analizamos toda la base de datos buscando duplicados en otras plataformas integradas. Detectamos un patrón de duplicados menor en **Falabella** (7 grupos) y **París** (26 grupos) afectando a comercios como `SERPA LTDA`, `MAGIC MAKEUP`, `RCT CHILE` y `THE SKIN STORE`.
   - **Causa**: Estos duplicados ocurrieron cuando los comercios cambiaron su configuración de prefijos (`agregarPrefijo` habilitado/deshabilitado en base de datos) a mitad de camino. Los scripts de sincronización buscaban por el nuevo formato del número de orden, no encontraban el registro anterior y lo duplicaban.

2. **Saneamiento Histórico Concurrente (`scratch/execute_all_platforms_cleanup.js`)**:
   - Desarrollamos y ejecutamos un script de limpieza multicorreo enfocado en Falabella y París.
   - Procesó 33 grupos duplicados históricos aplicando el mismo criterio operativo (conservando la orden con mayor estado operativo en WMS, renombrándola si correspondía, eliminando la duplicada inútil, y actualizando la columna unificada `pedido_referencia` en `envios_unificados`).

3. **Protección Proactiva Transversal en Sincronizadores y Webhooks**:
   - Para evitar duplicaciones futuras por cambios de configuración de siglas/prefijos en base de datos, modificamos todos los scripts y webhooks para que realicen búsquedas tolerantes a prefijos (`.in('external_order_number', [orderNumber, finalOrderNumber])`).
   - Los archivos actualizados son:
     * **Sincronizadores**: [sync_falabella.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/sync_falabella.js), [sync_paris.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/sync_paris.js), [sync_jumpseller.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/sync_jumpseller.js) y [sync_tiendanube.js](file:///c:/Users/felip/Desktop/WMS%20STOCKA/sync_tiendanube.js).
     * **Webhooks**: [supabase/functions/shopify-webhook/index.ts](file:///c:/Users/felip/Desktop/WMS%20STOCKA/supabase/functions/shopify-webhook/index.ts), [supabase/functions/jumpseller-webhook/index.ts](file:///c:/Users/felip/Desktop/WMS%20STOCKA/supabase/functions/jumpseller-webhook/index.ts) y [supabase/functions/tiendanube-webhook/index.ts](file:///c:/Users/felip/Desktop/WMS%20STOCKA/supabase/functions/tiendanube-webhook/index.ts).

---

## 93. Desacoplamiento y Separación Completa de Observaciones/Apelaciones para Envíame y Fulfillment

Hemos implementado un desacoplamiento completo para las observaciones y apelaciones de cobro de facturación de los clientes, permitiendo manejar de forma independiente las disputas de Fulfillment y Envíame:

1. **Estructura de Base de Datos e Integración de RLS**:
   - Agregamos las nuevas columnas a la tabla `billing_records`: `client_observation_enviame`, `admin_response_enviame`, `observation_status_enviame`, y `observation_updated_at_enviame`.
   - Modificamos la política RLS `Clientes pueden actualizar observaciones de sus comercios` en `public.billing_records` para permitir que los clientes actualicen los campos de observaciones y estados tanto de Fulfillment como de Envíame de manera segura.

2. **Panel del Cliente e Ingreso de Comentarios (`js/app.js`)**:
   - Modificamos el modal de observaciones (`openClientBillingObservationModal`) y su formulario para aceptar un parámetro de servicio (`serviceType` = `'fulfillment'` o `'enviame'`).
   - El cliente ahora puede ingresar y visualizar comentarios por separado. Los iconos en la tabla de facturación cambian de color dinámicamente de acuerdo al estado específico de la apelación del servicio correspondiente (`pendiente` = naranjo, `respondida` = verde, `sin_observacion` = gris).

3. **Pestaña Administrativa Centralizada y Contadores (`js/admin.js`)**:
   - Modificamos la grilla general de apelaciones en el módulo de facturación para listar de forma independiente las apelaciones de Fulfillment y Envíame, añadiendo un badge visual distintivo (Fulfillment en azul, Envíame en morado).
   - Actualizamos el contador dinámico del badge reactivo en el botón de la pestaña para sumar de forma combinada los registros con estado `pendiente` de ambos servicios.
   - Adaptamos el modal de resolución administrativa (`openAdminBillingObservationModal`) para guardar las respuestas de manera independiente en los campos respectivos según el servicio que se esté respondiendo.

---

## 96. Filtros de Estado de Stock con Checkboxes Acumulativos

Hemos implementado la capacidad de filtrar productos en la tabla de inventario en tiempo real combinando tres estados mediante checkboxes: **En Stock**, **Bajo Stock** y **Agotado**.

1. **Visualización y UI (`js/app.js` y `js/admin.js`)**:
   - Diseñamos e incorporamos un contenedor horizontal con tres checkboxes estilizados e identificados individualmente (`inv-filter-instock`, `inv-filter-lowstock`, `inv-filter-outofstock` para el cliente y `admin-inv-filter-instock`, `admin-inv-filter-lowstock`, `admin-inv-filter-outofstock` para el administrador) junto a los filtros de tipo de producto.
   - Cada checkbox está enlazado a variables globales (`window.inventoryFilterInStock`, etc. y sus equivalentes `admin`) y se inicializan en `true` por defecto para mostrar todos los productos.

2. **Eventos y Reactividad**:
   - Registramos listeners de eventos `'change'` en ambos portales para capturar cuando el usuario activa/desactiva algún estado de stock.
   - Al cambiar el estado de cualquier checkbox, se gatilla la correspondiente función de renderizado (`renderInventoryTableBody()` / `renderAdminInventoryTableBody()`) de forma inmediata.

3. **Lógica de Filtrado Local (`applyInventoryFiltersAndSort` / `applyAdminInventoryFiltersAndSort`)**:
   - Modificamos las funciones encargadas de aplicar los filtros y el orden sobre el arreglo en memoria de filas procesadas.
   - Ahora evalúan el campo `r.status` de cada fila contra el estado de las variables de checkbox:
     * Si `status === 'En Stock'` y el checkbox correspondiente no está marcado, se descarta.
     * Si `status === 'Bajo Stock'` y el checkbox correspondiente no está marcado, se descarta.
     * Si `status === 'Agotado'` y el checkbox correspondiente no está marcado, se descarta.
   - Esto permite la combinación acumulativa y en tiempo real de cualquiera de los tres estados del inventario.

---

## 97. Sistema de Caché de Datos y Recarga Dinámica en Dashboards

Hemos implementado un sistema robusto de almacenamiento en caché en memoria y recarga dinámica bajo demanda para optimizar las peticiones de los dashboards de Cliente (`js/app.js`) y Administrador (`js/admin.js`). Esto evita golpear innecesariamente la base de datos Supabase al navegar entre pestañas, manteniendo una excelente velocidad de carga y experiencia de usuario.

1. **Gestor de Caché Global (`js/app.js` y `js/admin.js`)**:
   - Definimos métodos globales (`window.getDashboardCache`, `window.setDashboardCache`, `window.clearDashboardCache`) en el objeto window para interactuar con un storage persistente en memoria que mantiene los payloads de datos con una marca de tiempo.
   - Cuenta con un tiempo de expiración (TTL) configurable de 5 minutos por defecto.

2. **Integración en Portal Cliente (`js/app.js`)**:
   - Al inicializar y cargar la vista del dashboard (`renderDashboard`), el sistema evalúa si existe un caché válido para el comercio del usuario.
   - Si existe, se recupera de inmediato la data pre-cargada. En el Hero Banner superior se despliega un indicador visual discreto con un icono de historial detallando la edad del caché (ej: *"Caché (hace 2 min)"*).
   - Se añadió un botón **"Actualizar"** al Hero Banner. Al ser presionado, se invalida el caché del comercio y se recargan las consultas en tiempo real directamente desde el servidor Supabase.

3. **Integración en Portal Administrador (`js/admin.js`)**:
   - Se adaptó la función `fetchAndRenderAdminMetrics()` de forma equivalente. Utiliza llaves de caché diferenciadas por comercio seleccionado (o `'all'` para la consolidación total).
   - El contenedor base del Dashboard Admin ahora incluye un elemento `#admin-cache-indicator` y el botón `#admin-refresh-dashboard-btn` (icono de refresco) integrados elegantemente junto al selector superior de comercios.
   - Al cambiar de comercio o presionar el botón de refresco, el sistema invalida la llave correspondiente y solicita los datos actualizados a la base de datos de manera fluida y con loaders premium en tiempo real.

---

## 98. Visualización de Etiquetas de Producto Virtual en Catálogos

Hemos implementado la visualización de etiquetas o "badges" para identificar los productos de tipo virtual/digital (`is_virtual === true`) en las tablas de catálogos tanto del Administrador como del Cliente.

1. **Catálogo de Administrador (`js/admin.js`)**:
   - Modificamos la función `renderMasterCatalogRows` para comprobar si el producto tiene el flag `is_virtual` activo.
   - Si es verdadero, se agrega dinámicamente un badge con color de fondo verde, un ícono de computadora (`ri-computer-line`) y el texto "Virtual" al lado del origen del producto y/o de su badge de "Pack".

2. **Catálogo de Cliente/Merchant (`js/app.js`)**:
   - Replicamos la misma lógica en la función `renderMasterCatalogRows` de la vista de cliente para asegurar consistencia visual en todo el sistema.
   - Se aplicó cache-busting en los archivos HTML (`admin.html` y `dashboard.html`) para forzar la recarga de los scripts actualizados en el navegador de los usuarios.

---

## 99. Soporte para Alertas de Stock Físico Insuficiente en Dashboards

Hemos mejorado las tablas de **Alertas de Stock Crítico** tanto en el panel del Cliente (`js/app.js`) como en el del Administrador (`js/admin.js`) para capturar, validar e identificar adecuadamente aquellos productos físicos que están en estado "Insuficiente" (unidades comprometidas superan el stock disponible, dejando un inventario disponible menor o igual a cero).

1. **Inclusión de is_virtual en la Consulta de Métricas**:
   - Modificamos las peticiones `inventory` en Supabase para obtener el flag `is_virtual` de los productos. Esto permite asegurar que solo se evalúen productos físicos.

2. **Criterios de Alerta Expandidos**:
   - En el procesamiento de métricas, los productos son empujados a `lowStockItems` bajo dos condiciones complementarias:
     - **Bajo Stock Crítico**: Si el producto posee un umbral de stock crítico configurado (`stock_critico > 0`) y el stock disponible actual es menor o igual a dicho umbral (`available <= stock_critico`).
     - **Insuficiente**: Si el producto posee unidades comprometidas (`committed_quantity > 0`) y el stock disponible actual es menor o igual a cero (`available <= 0`), aun cuando no tenga configurado un umbral crítico.

3. **Etiquetado WMS Coherente en las Filas**:
   - Modificamos el renderizador de filas en la tabla del dashboard:
     - Si el stock disponible es menor a cero (`available < 0`), se asigna el badge de estado **`Insuficiente`** en color carmesí (`#e11d48`) y el número de stock disponible se pinta de color rojo.
     - Si el stock disponible es igual a cero (`available === 0`), se mantiene el badge **`Sin Stock`** (`#ef4444`).
     - Si el producto se muestra por falta de stock disponible pero no cuenta con un umbral crítico de control personalizado (`critico === 0`), se dibuja la etiqueta descriptiva `(sin crít.)` en lugar del valor de umbral vacío `/ crít. 0`.

---

## 100. Desacoplamiento de Estado de Despachos e Inventario (Sincronizaciones de LightData y Envíame)

Hemos solucionado el error en el que las actualizaciones automáticas de tracking y estado de entrega de los despachos causaban deducciones de stock e incidencias de stock crítico debido a la falta de stock virtual en la base de datos (bloqueando la sincronización de envíos válidos con un error de restricción de check `inventory_quantity_check`).

1. **Sincronización de LightData (`sync_lightdata.js`)**:
   - Eliminamos la actualización automática de la columna `status` en la tabla `orders` cuando el envío cambia de estado en LightData. Esto previene que se dispare el trigger `handle_order_status_change()` al sincronizar.
   - El script sigue sincronizando toda la información de tracking, urls, couriers y metadatos de LightData tanto en la orden como en la tabla dedicada de despachos.

2. **Trigger de Envíame (`sync_enviame_shipment_to_orders_func`)**:
   - Redefinimos la función del trigger para excluir la columna `status` del bloque de actualización. Los tránsitos y entregas registrados en Envíame ya no cambian de forma automática la columna `status` del pedido en WMS.

3. **Trigger de Envíos Unificados (`sync_unified_status_to_orders_func`)**:
   - Redefinimos la función del trigger encargado de asociar la información de tracking a las órdenes de WMS. Ya no modifica la columna `status` a `'despachado'` cuando el estado consolidado de la entrega es `'DESPACHADO'`.

4. **Script de Migración SQL (`supabase_schema_unification_phase18.sql`)**:
   - Creamos este script conteniendo las definiciones reestructuradas de ambas funciones trigger para que el administrador pueda ejecutarlas directamente en el editor SQL de Supabase.

---

## 101. Habilitación del Estado 'Cancelado' en el WMS (Modificación de Restricción CHECK de Base de Datos)

Hemos identificado y solucionado el error que impedía cambiar el estado de un pedido a **"Cancelado"** en el WMS (`Error al actualizar estado WMS: new row for relation "orders" violates check constraint "check_estado_wms"`).

### Causa Raíz:
Aunque las vistas administrativas en el frontend (`js/admin.js`) y las llamadas de integración ya estaban completamente adaptadas para soportar la opción `"Cancelado"` para el estado del WMS (`estado_wms`), la base de datos PostgreSQL en Supabase tenía activa una restricción `CHECK` (`check_estado_wms`) que limitaba los valores válidos para esta columna exclusivamente a: `'En procesamiento', 'En preparación', 'Pickeado', 'Despachado', 'Incidencia'`. Cualquier intento de establecer `'Cancelado'` violaba esta restricción y causaba que la transacción fuera revertida con un error 23514.

### Solución / Pasos de Aplicación:
Hemos generado un script de migración SQL dedicado para actualizar la restricción de validación en la base de datos:

1. **Script de Corrección SQL**:
   - Se encuentra guardado en el archivo [supabase_schema_cancelado_constraint_fix.sql](file:///c:/Users/felip/Desktop/WMS%20STOCKA/supabase_schema_cancelado_constraint_fix.sql).
   - Su contenido es el siguiente:
     ```sql
     -- WMS STOCKA - Fix check_estado_wms constraint
     -- Ejecuta este script en el SQL Editor de tu proyecto de Supabase (https://supabase.com/dashboard)

     -- 1. Eliminar la restricción CHECK anterior si existe
     ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS check_estado_wms;

     -- 2. Volver a crear la restricción CHECK incluyendo el estado 'Cancelado'
     ALTER TABLE public.orders ADD CONSTRAINT check_estado_wms 
       CHECK (estado_wms IN ('En procesamiento', 'En preparación', 'Pickeado', 'Despachado', 'Incidencia', 'Cancelado'));
     ```

2. **Instrucciones para Aplicar**:
   - Copia el código SQL anterior.
   - Ve a tu panel de control de Supabase (https://supabase.com/dashboard), abre la sección **SQL Editor**, crea una pestaña en blanco, pega el código y haz clic en **Run**.
   - Con esto, la base de datos aceptará `"Cancelado"` como un estado WMS válido, y al realizar este cambio se liberará automáticamente el stock comprometido de los ítems de ese pedido.

---

## 102. Habilitación de la Cancelación Masiva en el Frontend (Bulk WMS Actions)

Hemos completado la integración del estado `'Cancelado'` en las acciones masivas del WMS:

1. **Adición de Opción en Dropdown de Acciones Masivas (`js/admin.js`)**:
   - Añadimos la opción `<option value="Cancelado">Cancelado</option>` a la barra de acciones masivas (`#bulk-wms-status`).
   - Con esto, el administrador ahora puede seleccionar múltiples pedidos en la tabla principal y cambiar su estado WMS a `"Cancelado"` de forma simultánea.
   
2. **Propagación y Liberación de Inventario**:
   - Al realizar el cambio masivo a `"Cancelado"`, se actualiza la columna `estado_wms` a `'Cancelado'` y el estado de origen (`status`) a `'cancelado'`.
   - La base de datos, a través del trigger `on_order_status_update`, disminuye el inventario comprometido (`committed_quantity`) liberando automáticamente las unidades reservadas para todos los ítems de dichos pedidos.

---

## 103. Corrección de Error de Sintaxis (SyntaxError: Unexpected token 'const')

Corregimos un error de sintaxis en `js/admin.js` introducido accidentalmente en reemplazos previos durante el desarrollo:

1. **Restauración de `updateMerchantFilterOptions`**:
   - Corregimos el corte del método en `select.value = currentVal;` que había quedado truncado como `select.value = currentVa`.
2. **Corrección de la Carga de Historial**:
   - Limpiamos y re-estructuramos la llamada asíncrona a `window.fetchAllSupabaseRows('orders', ...)` para eliminar código duplicado y llamadas rotas que generaban fallos en la consola del desarrollador.

---

## 104. Optimización de la Carga de Pedidos en el Panel de Administrador (Carga Bajo Demanda por Rango de Fechas)

Hemos mejorado la carga inicial de pedidos en el panel de WMS Administrador:

1. **Reemplazo de la Descarga en Segundo Plano**:
   - Anteriormente, el panel de administración cargaba el mes actual y luego ejecutaba una función asíncrona en segundo plano que descargaba e integraba recursivamente **todo el historial completo de pedidos** del sistema. Esto ocasionaba un alto volumen de datos transferidos y demoras/congelamientos visuales.
2. **Uso de `window.fetchWmsOrdersData`**:
   - Ahora el WMS Administrador se carga utilizando la función unificada y optimizada de consulta por rango de fechas `window.fetchWmsOrdersData()`. Esto permite que el listado inicial sólo descargue los pedidos correspondientes al rango de fechas visible en el panel.
   - La tabla se refresca de forma síncrona y fluida al cambiar el filtro temporal, eliminando consultas en bucle innecesarias.

---

## 105. Configuración de Holding SILVER FOX para Facturación de FORTE MAX y MENPRIME

Hemos integrado el nuevo comercio holding **SILVER FOX** en el módulo de facturación para agrupar de forma transparente y automática a las marcas individuales **FORTE MAX** y **MENPRIME**:

1. **Definición de Mapeos de Facturación**:
   - Agregamos los registros correspondientes en la tabla `billing_mappings` mapeando `FORTE MAX` y `MENPRIME` al holding `SILVER FOX`. Esto se incluyó en las sentencias de inserción iniciales de [supabase_schema_billing.sql](file:///c:/Users/felip/Desktop/WMS%20STOCKA/supabase_schema_billing.sql).
   
2. **Estado del Servicio y Facturación Dinámica**:
   - Agregamos un registro para `SILVER FOX` en la tabla `commerce_billing_status` estableciéndolo como `al_dia = true`.
   - Debido al diseño dinámico del módulo de facturación del sistema, las vistas administrativa y de cliente ahora agruparán automáticamente todos los cobros de Fulfillment y Envíame de `FORTE MAX` y `MENPRIME` bajo el registro consolidado de `SILVER FOX` de manera idéntica a como se procesa con `BIG BANG`.
   - La información de RUT (`77.265.758-7`) y Razón Social (`SILVER FOX SPA`) se heredará de manera inteligente desde la configuración de los comercios individuales si el holding no cuenta con una configuración directa.

---

## 106. Resolución Dinámica de Holdings en los Desplegables de Facturación

Corregimos y mejoramos la experiencia de usuario al agregar comercios y registrar saldos adicionales en el panel administrativo:

1. **Función de Resolución Unificada (`window.getBillingCommerceOptions`)**:
   - Implementamos un resolvedor dinámico en `js/admin.js` que consulta `v_comercios_config` y `billing_mappings` en conjunto.
   - Si un comercio pertenece a un holding (ej: `FORTE MAX` o `MENPRIME` mapeados a `SILVER FOX`), agrupa y muestra directamente la opción del holding con el formato `SILVER FOX (Holding)` en el desplegable, previniendo duplicados y permitiendo agregar directamente registros al holding correspondiente.
   
2. **Aplicación en Formularios Administrativos**:
   - Reemplazamos la renderización estática por este resolvedor en los modales:
     * **Añadir Comercio a un Periodo** (`window.openAddCommerceModal`).
     * **Crear Saldo Adicional / Cobro Extraordinario** (`window.openCreateExtraChargeModal`).
     * **Editar Saldo Adicional** (`window.openEditExtraChargeModal`).

---

## 107. Integración Completa de Opción Tiendanube en Selectores de Catálogo y Filtros de Origen

Hemos incorporado "Tiendanube" como opción de plataforma principal y filtro de origen en todo el sistema:

1. **Selector de Plataforma Principal / Catálogo Maestro**:
   - Agregamos la opción `<option value="Tiendanube">Tiendanube</option>` en el selector `#eq-main-platform-select` en ambos portales:
     * Portal del Administrador (`js/admin.js` - línea ~7885).
     * Portal del Cliente (`js/app.js` - línea ~1975).
   - Esto permite configurar Tiendanube como el origen del catálogo maestro de productos de un comercio y sincronizar correctamente sus inventarios.

2. **Filtros de Pedidos por Canal de Origen**:
   - Incluimos "Tiendanube" en los filtros de origen de pedidos (`#filter-origen` and `#filter-client-origen`):
     * Portal del Administrador (`js/admin.js`).
     * Portal del Cliente (`js/app.js`).
     * Modal de creación de pedidos en el dashboard (`dashboard.html` - `#order-cust-origen`).

3. **Filtro de Movimientos de Inventario**:
   - Agregamos la opción al selector de plataforma de movimientos `#movs-filter-platform` en `js/app.js` para permitir a los clientes filtrar los movimientos de inventario originados por ventas en Tiendanube.

4. **Incremento de Versiones para Cache-Busting**:
   - Incrementamos la versión de los scripts en `admin.html` (de `1.0.10` a `1.0.11`) y `dashboard.html` (de `1.0.11` a `1.0.12`) para garantizar que los navegadores carguen las opciones actualizadas inmediatamente.

---

## 108. Integración del Logo Oficial de Tiendanube en Badges y Vistas de Integraciones

Hemos incorporado el logotipo oficial de **Tiendanube** en todas las vistas, grillas y resúmenes del WMS, alineándolo con el resto de las plataformas:

1. **Uso del Archivo de Imagen**:
   - Agregamos la ruta `img/tiendanube.png` en el resolvedor del badge de plataforma `getPlatformBadge(platform)`.
   - Con esto, todas las tablas y listas que usan esta función (como las listas de integraciones activas en `js/app.js` y `js/admin.js`) muestran automáticamente el logo de Tiendanube en lugar del tag de texto estilizado anterior.

2. **Carga Dinámica en Detalle de Pedidos**:
   - Las vistas de detalles de órdenes en el portal del administrador (`js/admin.js`) y del cliente (`js/app.js`) cargan dinámicamente el logotipo usando la ruta `./img/${platformLower}.png`.
   - Con el nuevo archivo `tiendanube.png` cargado en el directorio de imágenes del WMS, ambos portales ahora despliegan correctamente el logo en el bloque de **Origen de la Orden** al recibir pedidos de este canal.

---

## 109. Integración del Logo Oficial Stocka.cap en Pedidos Manuales

Hemos incorporado el logotipo oficial de **Stocka.cap** (`img/stocka.cap.png`) para identificar visualmente a todos los pedidos ingresados manualmente en el WMS:

1. **Uso en getPlatformBadge**:
   - Modificamos la función `getPlatformBadge(platform)` tanto en `js/app.js` como en `js/admin.js` para asociar los valores de plataforma que contengan `"manual"` o `"stocka"` con la imagen del logo `img/stocka.cap.png`.
   - Esto asegura que todas las grillas e historiales de integraciones activas muestren el logo corporativo de Stocka.cap para las órdenes manuales.

2. **Cálculo y Resolución Dinámica del Logo en Detalles**:
   - Ajustamos la resolución de `platformLower` en las vistas detalladas y modales de pedidos de ambos portales (`js/app.js` y `js/admin.js`).
   - Si la plataforma de origen es `"Manual"`, el resolvedor dinámico lo traduce automáticamente a `"stocka.cap"`, permitiendo que la etiqueta de origen (`originHtml` / `originBadge`) cargue directamente `./img/stocka.cap.png` sin fallar ni recurrir al fallback de texto plano.

---

## 110. Remoción de Fondos Oscuros Laterales en Notificaciones (Toasts) y Optimización

Hemos realizado un ajuste específico de estilos y comportamiento en las notificaciones flotantes (toasts) y alertas del WMS:

1. **Remoción del Fondo Oscuro Lateral en Notificaciones**:
   - Modificamos las clases globales de SweetAlert2 (`.swal2-container` y `.swal2-backdrop-show`) en `css/layout.css` para aplicar exclusiones mediante `:not(.swal2-no-backdrop)`.
   - Esto asegura que las notificaciones flotantes de tipo Toast (que no requieren foco de confirmación ni fondo) ya no muestren la franja oscura lateral ni desenfoquen el fondo de la pantalla.
   - Los modales regulares de edición/creación (`.modal-overlay`), los paneles de transporte (`.slide-over-overlay`) y los cuadros de confirmación interactiva de SweetAlert conservan correctamente sus fondos oscuros y desenfoques traseros para mantener la jerarquía visual del WMS.

2. **Notificaciones (Toasts) Más Compactas y Detalladas**:
   - Rediseñamos los popups de tipo Toast en SweetAlert2 (`.swal2-popup.swal2-toast`) con un tamaño más ajustado, espaciados reducidos y un esquema premium compatible con temas claro/oscuro.
   - Modificamos los eventos de sincronización del picker y actualización de campos de pedidos en `js/admin.js` para incluir información útil en la notificación, listando qué pedidos específicos fueron finalizados o modificados (ej: *Pedido: **1005***).




