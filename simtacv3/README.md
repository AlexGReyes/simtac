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

- **Node.js** (con npm)
- **Rust** (rustc, cargo) — [rustup.rs](https://rustup.rs/)
- Herramientas de build según plataforma:
  - Windows: Microsoft Visual C++ Build Tools
  - macOS: Xcode Command Line Tools
  - Linux: GCC/Clang y headers de desarrollo del sistema

Verificá el entorno con `npm run tauri info`.

## Desarrollo

```bash
npm install
npm run tauri dev     # modo desarrollo, hot-reload del frontend
npm run tauri build   # build de release (bundles/instaladores)
```

El frontend (`src/`) se sirve tal cual, sin paso de build — los cambios ahí
recargan solos. Cambios en `src-tauri/` (Rust) requieren reiniciar
`npm run tauri dev`.

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
