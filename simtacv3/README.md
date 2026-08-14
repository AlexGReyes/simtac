# SIMTAC

Simulador militar táctico: aplicación de escritorio (Tauri v2) para dirigir y
jugar ejercicios militares en un mapa en vivo — unidades y vehículos con
simbología SIDC (MIL-STD-2525), movimiento, detección/niebla de guerra,
combate, comunicaciones y un panel de dirección para el administrador.

Frontend en HTML/CSS/JavaScript vanilla (sin framework, sin bundler) más un
backend Rust mínimo (Tauri) que solo persiste la sesión. La simulación en sí
la corre un servidor **Node** aparte (`http://node.localhost`), al que el
frontend habla por REST y Socket.IO.

## Estado actual

Las 8 fases del contrato de frontend (`frontend.md`) están implementadas:

| Fase | Qué hace | Módulos |
|---|---|---|
| 0 | Sesión, cliente HTTP/socket, store del estado | `api.js`, `session.js`, `auth.js`, `socket.js`, `store.js`, `geo.js`, `ui.js` |
| 1 | Login/registro y selección de ejercicio | `login-ui.js`, `ejercicios-ui.js` |
| 2 | Administración: usuarios, unidades, ejercicios, armamento, vehículos | `admin.js`, `config-catalogos.js` |
| 3 | Mapa OpenLayers con símbolos SIDC y panel de detalle | `mapa.js`, `panel-entidad.js` |
| 4 | Movimiento terrestre y libre (aire/mar), con interpolación visual | `movimiento.js` |
| 5 | Detección y niebla de guerra | `deteccion.js` |
| 6 | Combate (diálogo, HUD, log) | `combate.js` |
| 7 | Chat de bando, documentos entre unidades, boletines con TTS | `comunicaciones.js` |
| 8 | Panel de dirección: control del ejercicio, hora táctica, alta en caliente, checkpoints/rebobinado | `direccion.js` |

Además: un panel de logística (km, munición, autonomía, bajas — `logistica.js`)
y uno de "mis unidades" para que el jugador se ubique rápido en el mapa
(`mis-unidades.js`).

**Corre sin conexión a internet.** OpenLayers, milsymbol, socket.io-client y
la tipografía se vendorizaron en `src/vendor/` (nada se carga de un CDN — ver
`src/vendor/README.md`). El mapa además consume un **GeoServer WMS local**
(`http://localhost:3001/geoserver/wms`, no existe en esta máquina de
desarrollo, sí en producción) como overlay simultáneo sobre la capa base.

**Abierto:**
- La capa base del mapa sigue siendo OpenStreetMap (`ol.source.OSM()`), que
  **sí** pide tiles a internet — queda en blanco sin conexión. Pendiente:
  publicar un basemap en el GeoServer de producción y reemplazarla.
- `WMS_LAYERS` en `mapa.js` es un placeholder (`CAMBIAR:nombre_de_capa`):
  falta el nombre real de la capa, que solo se puede leer del
  `GetCapabilities` de un GeoServer de producción.

Ver `backend.md` para lo que todavía le falta al servidor Node (hoy: nada
pendiente, es historial de pedidos ya resueltos).

## Documentación

| Archivo | Para qué |
|---|---|
| `CLAUDE.md` | Guía técnica del repo (arquitectura, comandos, convenciones) |
| `frontend.md` | Contrato completo por fases: qué consume el frontend del backend |
| `backend.md` | Pedidos del frontend al backend — qué faltaba y cómo se resolvió |
| `API.md` | Endpoints REST y eventos de socket, con payloads |
| `DATABASE.md` | Esquema de la base (tablas, columnas, relaciones) |

## Requisitos

- **Node.js** (con npm) — [nodejs.org](https://nodejs.org/)
- **Rust** (rustc, cargo) — instalar con [rustup](https://rustup.rs/)
- Herramientas de build nativas según plataforma:
  - **Windows**: [Microsoft Visual C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
    (workload "Desktop development with C++") y
    [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)
    (viene preinstalado en Windows 11 y en Windows 10 actualizado)
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Linux**: GCC/Clang, `webkit2gtk`, `libssl-dev` y demás headers de
    desarrollo del sistema — ver la
    [guía oficial de prerequisitos de Tauri](https://v2.tauri.app/start/prerequisites/)
    para el paquete exacto según la distro

Con Node.js y Rust instalados, verificá que Tauri detecta todo correctamente:

```bash
npm install
npx tauri info
```

Revisá que no haya advertencias en rojo antes de seguir.

## Instalación

```bash
git clone https://github.com/AlexGReyes/simtac.git
cd simtacv3
npm install
```

`npm install` trae el CLI de Tauri (`@tauri-apps/cli`) y las dependencias JS
del frontend (`ol`, `milsymbol`, `socket.io-client`) que **también** están
vendorizadas en `src/vendor/` para que la app corra sin internet en runtime —
`npm install` es solo para desarrollo/build, no para lo que carga el WebView.

## Desarrollo

```bash
npm run tauri dev     # levanta la app en modo desarrollo con hot-reload
```

La primera vez, `cargo` compila todas las dependencias de Rust (puede tardar
varios minutos); las siguientes corridas son incrementales y arrancan mucho
más rápido. Se abre una ventana nativa (no un navegador) con la app ya
corriendo y las DevTools disponibles por clic derecho → Inspeccionar.

- **Cambios en `src/`** (HTML/CSS/JS) recargan solos, sin reiniciar nada — el
  frontend se sirve tal cual, sin paso de build (`frontendDist` apunta
  directo a `../src` en `tauri.conf.json`).
- **Cambios en `src-tauri/`** (Rust) no tienen hot-reload: hay que cortar
  (`Ctrl+C`) y volver a correr `npm run tauri dev` para que compilen.

Para compilar el build de producción (bundles/instaladores nativos —
`.msi`/`.exe` en Windows, `.dmg`/`.app` en macOS, `.deb`/`.AppImage` en
Linux, según la plataforma donde se corra):

```bash
npm run tauri build
```

Los artefactos quedan en `src-tauri/target/release/bundle/`.

## Estructura

```
src/                  Frontend (HTML/CSS/JS, servido sin bundlear)
  vendor/             OpenLayers, milsymbol, socket.io-client y fuentes,
                       vendorizados — sin CDN (ver vendor/README.md)
  assets/             Íconos, logo, fuentes
src-tauri/            Backend Rust (Tauri): solo persiste la sesión
CLAUDE.md             Guía técnica para trabajar en este repo
frontend.md           Contrato del frontend, por fase
backend.md            Historial de pedidos del frontend al backend
API.md                Contrato REST + Socket.IO
DATABASE.md           Esquema de la base de datos
```
