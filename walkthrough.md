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
