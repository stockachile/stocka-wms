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
   - Diseñamos y ejecutamos un script de migración para regularizar los ingresos cerrados que no habían sumado stock.
   - El script procesó la declaración *"Café 3 variedades"* (ID: `d3fcf14d-0b07-4de5-a180-774fac91477a`) del comercio **SIMPLEMENTE CAFE**, extrayendo sus ítems de la planilla Excel e ingresando exitosamente las unidades del `SKU 1-1` (20 unidades) al inventario y al log de movimientos en la Bodega Central, previniendo duplicaciones de otros SKUs que ya contaban con registros de movimientos previos.
