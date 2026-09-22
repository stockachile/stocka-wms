# Stocka WMS - Aplicación Móvil para Clientes (iOS & Android)

Aplicación móvil nativa multiplataforma para clientes de **Stocka WMS**, construida con **React Native + Expo**, **TypeScript** y conectada directamente a la infraestructura existente de **Supabase**.

---

## 🚀 Cómo Iniciar en Desarrollo y Probar en tu Teléfono

### 1. Iniciar el servidor de desarrollo
En la terminal de PowerShell, ingresa a la carpeta del proyecto móvil y ejecuta:

```powershell
cd "c:\Users\felip\Desktop\WMS STOCKA\stocka-mobile"
npx expo start
```

### 2. Probar en tu Smartphone (Android o iPhone)
1. Descarga la aplicación gratuita **Expo Go** desde:
   - [Google Play Store (Android)](https://play.google.com/store/apps/details?id=host.exp.exponent)
   - [Apple App Store (iOS / iPhone)](https://apps.apple.com/app/expo-go/id982107779)
2. Abre la app en tu teléfono:
   - **En Android**: Abre Expo Go y presiona **"Scan QR code"**, luego apunta la cámara al código QR que aparece en tu terminal.
   - **En iPhone**: Abre la app de Cámara normal del iPhone, apunta al código QR y toca el enlace que dice **"Abrir en Expo Go"**.
3. ¡Listo! La app se compilará y abrirá en tu celular en tiempo real. Cualquier cambio que guardes en el código se reflejará al instante (Fast Refresh).

---

## 📱 Módulos y Funcionalidades Incluidas

1. **Autenticación Segura (Supabase Auth)**:
   - Login con correo y contraseña.
   - Persistencia automática de sesión en el almacenamiento local seguro.
   - Restricción por rol de cliente y comercio.

2. **Dashboard Ejecutivo**:
   - KPIs de despachos: Pedidos pendientes, en tránsito y quiebres de stock.
   - Tarjeta de contacto con tu **KAM Dedicado** (con botón de acceso directo a WhatsApp y llamada).
   - Acceso rápido a escaneo de productos y listado de últimos pedidos.

3. **Catálogo & Inventario**:
   - Búsqueda en tiempo real por SKU, nombre y código de barras.
   - Filtros rápidos: *Todos*, *Con Stock*, *Agotados*.
   - Detalle de stock por bodega (físico disponible vs. reservado).

4. **Escáner de Código de Barras con Cámara (`expo-camera`)**:
   - Botón de escáner en Dashboard e Inventario.
   - Abre la cámara del smartphone para escanear etiquetas físicas de productos (EAN-13, QR, Code128).
   - Soporte para encendido de linterna en bodegas oscuras.

5. **Despachos & Seguimiento (Tracking)**:
   - Listado de pedidos con transportistas (Starken, Blue Express, Optiroute, etc.).
   - Acceso directo a la página de seguimiento del courier con 1 tap.
   - Filtros por estado: *Pendientes*, *En Ruta*, *Entregados*.

6. **Mesa de Ayuda & Incidencias (Tickets)**:
   - Creación de tickets de soporte técnico u operacional.
   - Opción para **tomar fotos directamente con la cámara del celular** o subir evidencia desde la galería.
   - Envío automático de fotos al almacenamiento en la nube de Supabase (`public-docs/tickets/`).

7. **Mi Cuenta & Perfil**:
   - Datos del usuario, razón social y comercio asignado.
   - Enlace a la política de privacidad y versión web.
   - Cierre de sesión seguro con diálogo de confirmación.

---

## 📦 Compilación para Tiendas Oficiales (Google Play & App Store)

Para generar los instaladores oficiales (.apk/.aab para Android y .ipa para iOS):

```bash
# 1. Instalar EAS CLI globalmente
npm install -g eas-cli

# 2. Iniciar sesión en tu cuenta gratuita de Expo
eas login

# 3. Configurar el proyecto para compilación en la nube
eas build:configure

# 4. Compilar para Android (Google Play)
eas build --platform android

# 5. Compilar para iOS (App Store - ¡No requiere Mac físico!)
eas build --platform ios
```
