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
   - La estructura de la base de datos se mantiene idéntica a la instalada en el paso anterior. No se requieren scripts SQL adicionales.

2. **Probar el Flujo de Edición (Cliente):**
   - Inicia sesión como cliente. En la tabla resumen, haz click en el botón **"Editar"** en una declaración en estado *"Creada"*.
   - Comprueba que el formulario de la izquierda se despliega con la información del registro y que el botón *"Cancelar"* restablece el formulario.
   - Modifica algún dato (por ejemplo, cambia la cantidad de unidades o desmarca un tipo de bulto) y presiona *"Guardar Cambios"*. Revisa que la tabla se actualice y que al abrir el modal *"Detalle"* figure la nota en el historial.

3. **Probar el Flujo Guiado (Administrador):**
   - Entra al panel de administración, abre el modal **"Gestionar"** en una declaración en estado *"Creada"*.
   - Comprueba que solo aparece el botón *"Marcar como: En Recepción - Pendiente Conteo"* y que los inputs de cantidad física están ocultos.
   - Avanza las etapas escribiendo un comentario de avance. En la etapa de *"En proceso de conteo/clasificación"*, comprueba que aparecen las dos opciones de cierre y que al seleccionar una se despliegan dinámicamente los campos correspondientes.
