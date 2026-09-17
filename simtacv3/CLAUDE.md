# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**simtacv3** is a Tauri v2 desktop application for geospatial visualization with a vanilla HTML/CSS/JavaScript frontend and a Rust backend. It uses **OpenLayers** for interactive mapping and **milsymbol** for rendering military tactical symbols. Tauri provides the IPC (Inter-Process Communication) bridge between frontend and backend.

## Development Commands

All commands should be run from the project root directory:

- **`npm run tauri dev`** — Start the app in development mode with hot-reload. Frontend changes (HTML/JS/CSS in `src/`) reload instantly; Rust backend changes require restarting dev mode.
- **`npm run tauri build`** — Build the app in release mode and generate platform-specific bundles and installers.
- **`npm run tauri info`** — Display environment information (Node.js, Rust, Cargo versions, etc.). Useful for debugging build issues.

## Key Technologies

- **OpenLayers** — Interactive web mapping library for map rendering and manipulation
- **milsymbol** — Library for rendering NATO military tactical symbols (MilStd 2525)
- **Tauri v2** — Lightweight desktop framework with Rust backend and web frontend; includes security model based on capabilities/permissions

## Project Architecture

### Frontend (`src/`)
Uses ES modules (`"type": "module"` in package.json).

- **`index.html`** — App shell (login, mapa, chat, documentos, administración); carga OpenLayers, milsymbol y socket.io desde `vendor/` (sin CDN, ver más abajo)
- **`app.js`** — Punto de entrada: sesión, login, selección de ejercicio y arranque de todos los módulos de fase
- **`styles.css`** — Estilos base (login, administración); `.map-container` ocupa el viewport
- **`estilos-simtac.css`** — Estilos de los paneles de las fases 1–8

Módulos por fase (contrato completo en `frontend.md`):

| Archivo | Fase | Qué hace |
|---|---|---|
| `api.js`, `session.js`, `auth.js`, `socket.js`, `store.js`, `geo.js`, `ui.js` | 0 | Cliente HTTP con refresh de token, sesión persistida en Rust, socket con ack, store indexado por `"tipo:id"` |
| `login-ui.js`, `ejercicios-ui.js` | 1 | Login/registro y selección de ejercicio con pantalla de espera |
| `admin.js`, `config-catalogos.js` | 2 | CRUD de configuración: usuarios/unidades/ejercicios y armamento/vehículos/rutas |
| `mapa.js`, `geoserver.js`, `panel-entidad.js` | 3 | Mapa OpenLayers con cartografía SIMTAC GeoServer, símbolos SIDC y panel de detalle |
| `movimiento.js` | 4 | `entidad:mover` (terrestre) y `entidad:mover_libre` (aire/mar) con interpolación visual |
| `deteccion.js` | 5 | Niebla de guerra por contador de observadores |
| `combate.js` | 6 | Diálogo opt-in de ataque, HUD y log de combate |
| `comunicaciones.js` | 7 | Chat de bando, documentos entre unidades y boletines con TTS |
| `direccion.js` | 8 | Panel del administrador: control, visibilidad, alta en caliente, rebobinado |

### Rust Backend (`src-tauri/`)
- **`src/lib.rs`** — Defines Tauri commands (e.g., `#[tauri::command] fn greet()`) and initializes the app builder with plugins
- **`src/main.rs`** — Entry point that calls the library's `run()` function; prevents console window in release builds on Windows
- **`Cargo.toml`** — Rust dependencies (tauri, serde, tauri-plugin-opener)
- **`tauri.conf.json`** — Tauri app configuration (window size, title, bundle settings, icons)

### IPC Bridge
El proceso Rust se usa para persistir la sesión (los tokens NO van a `localStorage`):
1. `session.js` llama a `invoke("guardar_sesion" | "leer_sesion" | "borrar_sesion")`
2. Rust recibe el comando en `lib.rs` vía la macro `#[tauri::command]` y escribe en el directorio de configuración de la app
3. Fuera de Tauri (navegador, desarrollo) `session.js` degrada a `localStorage`

Con el mismo patrón, `config.js` usa `leer_config`/`guardar_config`/
`ruta_config_usuario` para el `config.json` editable del directorio de
configuración de la app (ver más abajo).

**Cerrar la ventana cierra la sesión.** `app.js` → `registrarCierreDeVentana()` intercepta `onCloseRequested` (API global de ventana, `withGlobalTauri`), espera a que `Session.clear()` termine de borrar el token persistido y recién ahí llama a `window.destroy()` — si no, el token queda válido y quien reabra la app en esa máquina entra ya logueado. `destroy()` necesita el permiso `core:window:allow-destroy` en `capabilities/default.json`: **no** viene incluido en `core:default`, hay que declararlo aparte (a diferencia de casi todo lo demás del core, que sí cae bajo el default).

⚠️ El resto del backend NO es Rust: la simulación vive en un servidor Node en `http://node.localhost`, al que el frontend habla por REST y Socket.IO. `node.localhost` lo resuelve el WebView, no el resolver de Rust/Node.

## Cartografía: SIMTAC GeoServer sobre OpenLayers

El fondo del mapa no es OSM (el equipo corre sin internet): son las capas de una
instalación de **SIMTAC GeoServer** en la red local. `src/geoserver.js` es el
único módulo que habla con ese servidor; `mapa.js` solo arma capas con él. Todo
lo que implementa está verificado contra el servidor real y documentado en
`INTEGRACION_SIMTAC_GEOSERVER.md` (referencia profunda de cada servicio OGC) y
`INTEGRACION_RED_LOCAL_MAC.md` (endpoints de la réplica en la LAN).

Reglas que NO son preferencias de estilo — romperlas deja el mapa en blanco:

- **El mapa corre en `EPSG:4326`, no en el Web Mercator por defecto de OL.** Es
  el único gridset sembrado en GeoWebCache (`WebMercatorQuad` no existe ahí). La
  proyección se decide en un solo lugar: `PROYECCION_MAPA` en `geo.js`. Ningún
  módulo llama `ol.proj.*` a mano; todos pasan por `xyAMapa`/`mapaAXY`/
  `mapaALonLat`/`metrosAUnidadesMapa`.
- **El `ol.View` usa las resoluciones del gridset de GWC** (`Geoserver.resoluciones()`),
  no las que OL calcularía solo. Así el zoom entero del mapa coincide con el
  `TILEMATRIX` pedido y con las bandas de zoom de los layergroups; con el default
  de OL todos los umbrales quedan corridos un nivel.
- **Un solo layergroup base visible por vez**, elegido por zoom con
  `grupoParaZoom` (intervalos semiabiertos `[min, max)`): `simtac_zoom_mundo`
  0–4, `_pais` 5–6, `_region` 7–8, `_operacional` 9–10, `_contexto` 11+. Los 3
  grupos heredados (`_nacional`, `_regional`, `_detalle`) no se usan.
- **Cada capa WMTS lleva su propio tile grid, acotado a su banda.** Cada
  layergroup está sembrado en GWC SOLO en sus niveles (mundo 0–4, país 5–6,
  región 7–8, operacional 9–10, contexto 11–18, satélite 12–15) y cualquier otro
  devuelve `HTTP 400 Unknown TILEMATRIX EPSG:4326:{z}` — comprobado nivel por
  nivel contra el servidor; el `GetCapabilities` NO declara esos límites, así
  que no se pueden descubrir leyéndolo. Con un grid completo, un zoom
  fraccionario (z8.5, a mitad de una animación) hace que OL pida el nivel vecino
  y la tesela falla. `gridWmts(zMin, zMax)` en `geoserver.js` lo evita, y el
  `View` usa `constrainResolution: true` para asentarse en niveles enteros.
- **`SIMTAC_CACHE_VERSION` solo donde toca**: z7+ en la base, siempre en el
  satélite. Mandarlo en todas las peticiones tira la caché de GWC a la basura.
- **WMS 1.1.1, nunca 1.3.0**: con `EPSG:4326` la 1.3.0 invierte el orden de ejes
  del bbox (lat,lon) y devuelve mapas en blanco con HTTP 200.
- **El mosaico satelital (`simtac_general:img_sat_nal`) es condicional**: vive en
  un disco montable. Que no esté publicado es un estado esperado, no un fallo —
  se verifica con el GetCapabilities acotado al workspace y solo se dibuja en
  z12–18.
- **Nunca llamar `/geoserver/rest/...` ni `/geoserver/gwc/rest/...`** desde el
  cliente: piden credenciales de administrador y permiten publicar/borrar capas
  y truncar caché. `urlSegura()` rechaza cualquier URL que los contenga.
- **La lista de capas no se hardcodea**: son ~390 y cambian. Se descubre en
  runtime del `GetCapabilities` (`Geoserver.listarCapas`).

### URL del servidor: archivo de configuración

Ver **`config.js` — configuración del despliegue** más abajo: la URL del
GeoServer sale de la misma cadena que la del backend. `Geoserver.urlBase()` es
solo un alias de `Config.geoserver()`. Resumen de la cadena, de más a menos
prioridad:

| # | Origen | Para qué |
|---|---|---|
| 1 | `?geoserver=...` en la URL de arranque | prueba puntual, no persiste |
| 2 | `config.json` del directorio de config de la app (`%APPDATA%/com.agrey.simtacv3/`) | **lo editable en una máquina ya instalada**; es lo que escribe el botón Aplicar del panel 🗺 |
| 3 | `src/config.json` | config del despliegue, viaja con la app |
| 4 | `http://localhost:3001/geoserver` | último recurso |

A la URL del GeoServer se le exige además no contener `/rest` (ni
percent-encoded): es la API administrativa.

## `config.js` — configuración del despliegue

`src/config.js` resuelve las **dos direcciones que cambian al mover el sistema**
de máquina o de red, y es el único lugar donde se deciden:

| Clave | Qué es | Por defecto |
|---|---|---|
| `backend` | servidor Node de la simulación (REST + Socket.IO) | `http://node.localhost` |
| `geoserver` | cartografía (WMS/WFS/WMTS) | `http://localhost:3001/geoserver` |

Cadena de resolución por clave, de más a menos prioridad: **query string**
(`?backend=`, `?geoserver=`) → **`config.json` del directorio de configuración
de la app** → **`src/config.json`** → **`DEFECTOS`**.

El segundo nivel existe porque `src/config.json` queda **dentro del binario** en
un build de release: ahí ya no se puede editar. Lo sirven los comandos Rust
`leer_config`/`guardar_config`/`ruta_config_usuario` (mismo directorio que
`sesion.json`); fuera de Tauri degradan a `localStorage`. El panel 🗺 muestra de
qué nivel salió cada valor, la ruta exacta del archivo editable, y permite
cambiar los dos.

Cada candidata pasa por `urlSegura()`: **una inválida se descarta con un aviso
por consola y se prueba la siguiente**, para que un archivo mal editado degrade
en vez de dejar la app sin backend ni sin mapa.

`Config.cargar()` se llama una sola vez, al principio de `arrancar()` en
`app.js`, seguido de `Api.sincronizarBase()`: tiene que resolverse antes de que
`Mapa.init()` cree las capas y antes de la primera llamada al backend.

⚠️ `API_BASE` en `api.js` es `export let`, no `const`: se apoya en los enlaces
vivos de los módulos ES para que `socket.js` y `admin.js` vean el valor
actualizado. Por eso **nunca hay que copiarla a una constante local** ni leerla
en el cuerpo de un módulo — solo dentro de funciones. Cambiar el backend desde
el panel solo guarda: se aplica al reiniciar, porque reapuntarlo en caliente
dejaría el socket vivo contra el servidor anterior.

`node pruebas/config.mjs` verifica la precedencia y la validación sin navegador
ni servidores (11 casos).

### `config/simtac-geoserver.json` — config para el backend Node

Distinto de `src/config.js`: ese resuelve las URLs **del cliente Tauri**.
`config/simtac-geoserver.json` es el archivo que el **backend Node** lee para
consultar el cálculo de ruta vehicular (pgRouting) del mismo GeoServer — la
respuesta a `PEDIDO_CONFIG_GEOSERVER.md`, detallada en
`RESPUESTA_PEDIDO_CONFIG_GEOSERVER.md`. Trae las dos URLs de la LAN (Ethernet
fija primero, Wi-Fi DHCP como respaldo), el health check con que elegir entre
ellas, los parámetros fijos del `GetFeature`, el shape real de la respuesta
(⚠️ `MultiLineString`, sin duración, distancia en `properties.length_m`) y los
límites de concurrencia. Se mantiene en este repo; el backend lo lee o lo copia,
no lo edita. `node pruebas/config-geoserver.mjs` lo valida (18 casos).

`db/migrations/006_routing_cache_upsert.sql` corrige, del lado de la base de
PostGIS del GeoServer, el `HTTP 400 duplicate key ... simtac_ruta_cache_pkey` al
repetir un par de coordenadas cacheado hace más de 7 días: convierte el `INSERT`
de la función de caché en upsert. Es idempotente y se aplica sobre la definición
viva de la función.

### Diagnóstico

- `src/mapa-prueba.html` — página suelta que dibuja solo la cartografía, sin
  login ni backend Node. Sirve `src/` por HTTP (no `file://`, los módulos ES se
  bloquean) y abrila con `?geoserver=http://<ip>:3001/geoserver`.
- En DevTools de la app: `await window.simtacGeoserver.probar()` devuelve estado
  de GetCapabilities, de una tesela base y del satélite.

## Key Files & Configuration

- **`package.json`** — Node.js metadata, Tauri CLI version, and dependencies (OpenLayers, milsymbol)
- **`src-tauri/build.rs`** — Tauri build script; prepares manifests and schemas
- **`src-tauri/Cargo.toml`** — Rust dependencies (tauri, serde, serde_json, tauri-plugin-opener)
- **`src-tauri/Cargo.lock`** — Rust dependency lock file (commit to version control)
- **`src-tauri/tauri.conf.json`** — App metadata (productName, identifier, version), window config (800x600), bundle settings, and CSP (currently `null`)
- **`src-tauri/capabilities/default.json`** — Tauri v2 capability definition; maps permissions to windows and declares which commands are accessible

## Tauri v2 Security: Capabilities

Tauri v2 uses a **capability-based permission system** instead of global permissions:

- **`capabilities/default.json`** — Defines which permissions (and thus Rust commands) are available to the app
- Permissions are declared in this file and referenced by their scope (e.g., `"core:default"`, `"opener:default"`)
- When adding new Rust commands, ensure the capability is granted in `capabilities/default.json`; otherwise the command will be blocked at runtime
- CSP is currently disabled (`null` in `tauri.conf.json`) — enable and tighten before production

## Prerequisites

- **Node.js** (npm installed)
- **Rust toolchain** (rustc, cargo) — install via [rustup](https://rustup.rs/)
- Platform-specific build tools:
  - **Windows**: Microsoft Visual C++ Build Tools
  - **macOS**: Xcode Command Line Tools
  - **Linux**: GCC/Clang and system development headers

Check your setup with `npm run tauri info`.

## Adding Rust Commands

1. Add a `#[tauri::command]` function in `src-tauri/src/lib.rs`
2. Register it in the `invoke_handler!()` macro in `lib.rs`
3. **Grant the permission** in `src-tauri/capabilities/default.json` (Tauri v2 requirement)
4. Call it from JavaScript using `invoke("command_name", { /* args */ })`

Example:
```rust
#[tauri::command]
fn add(a: i32, b: i32) -> i32 {
    a + b
}
```
Then register: `.invoke_handler(tauri::generate_handler![greet, add])`

## Testing & Debugging

- **Frontend debugging** — Use browser DevTools in the app window (right-click → Inspect/DevTools)
- **Rust logging** — Add `println!()` or use the `log` crate; output appears in the terminal where `npm run tauri dev` runs
- **IPC communication** — Test command invocation from the browser console using `window.__TAURI__.core.invoke("command_name", {args})`
- **Map interaction** — el mapa se crea en `mapa.js` (`init()`); inspeccioná `window.map` en DevTools para depurar la instancia de OL
- **App crashes** — Check `npm run tauri info` output; Rust panics will be visible in the terminal

## Development Notes

- **Frontend distribution** — `src/` is served as-is by Tauri (not bundled); assets in `src/assets/` are accessible via relative paths
- **Module system** — `package.json` declares `"type": "module"` (ES modules); use standard `import`/`export` syntax
- **Sin CDN, vendorizado en `src/vendor/`** — El equipo que corre la app no tiene internet: OpenLayers, milsymbol, socket.io-client y la tipografía "Unica One" son copias locales de los mismos paquetes de `package.json` (o, para la fuente, de Google Fonts bajada una sola vez), no links a un CDN. Ver `src/vendor/README.md` para qué archivo sale de dónde y cómo re-vendorizar al subir una versión.
- **Launches maximized** — `"maximized": true` in `tauri.conf.json`, `app.windows[0]` (window keeps its title bar/borders, unlike fullscreen); `width`/`height` (800x600) stay as the fallback size if un-maximized
- **App identifier** — `com.agrey.simtacv3` in `tauri.conf.json`; update if redistributing
- **CSP disabled** — Currently `null` in `tauri.conf.json`; enable and tighten CSP policy before production deployment
- **Hot-reload limitation** — Backend changes (Rust) require stopping and restarting `npm run tauri dev`; frontend changes reload automatically
