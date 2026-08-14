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
| `mapa.js`, `panel-entidad.js` | 3 | Mapa OpenLayers con símbolos SIDC y panel de detalle |
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

**Cerrar la ventana cierra la sesión.** `app.js` → `registrarCierreDeVentana()` intercepta `onCloseRequested` (API global de ventana, `withGlobalTauri`), espera a que `Session.clear()` termine de borrar el token persistido y recién ahí llama a `window.destroy()` — si no, el token queda válido y quien reabra la app en esa máquina entra ya logueado. `destroy()` necesita el permiso `core:window:allow-destroy` en `capabilities/default.json`: **no** viene incluido en `core:default`, hay que declararlo aparte (a diferencia de casi todo lo demás del core, que sí cae bajo el default).

⚠️ El resto del backend NO es Rust: la simulación vive en un servidor Node en `http://node.localhost`, al que el frontend habla por REST y Socket.IO. `node.localhost` lo resuelve el WebView, no el resolver de Rust/Node.

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
