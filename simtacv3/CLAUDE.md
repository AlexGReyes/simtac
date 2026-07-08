# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**simtacv3** is a Tauri v2 desktop application with a vanilla HTML/CSS/JavaScript frontend and a Rust backend. Tauri provides the bridge between the frontend and backend through an IPC (Inter-Process Communication) system.

## Development Commands

All commands should be run from the project root directory:

- **`npm run tauri dev`** — Start the app in development mode with hot-reload capability. The frontend rebuilds on file changes and the app automatically refreshes.
- **`npm run tauri build`** — Build the app in release mode and generate platform-specific bundles and installers.
- **`npm run tauri info`** — Display environment information (Node.js, Rust, Cargo versions, etc.). Useful for debugging build issues.

## Project Architecture

### Frontend (`src/`)
- **`index.html`** — UI template with a simple form that invokes the Rust backend
- **`main.js`** — Entry point that handles Tauri IPC communication; accesses `window.__TAURI__.core.invoke()` to call Rust commands
- **`styles.css`** — Application styling

### Rust Backend (`src-tauri/`)
- **`src/lib.rs`** — Defines Tauri commands (e.g., `#[tauri::command] fn greet()`) and initializes the app builder with plugins
- **`src/main.rs`** — Entry point that calls the library's `run()` function; prevents console window in release builds on Windows
- **`Cargo.toml`** — Rust dependencies (tauri, serde, tauri-plugin-opener)
- **`tauri.conf.json`** — Tauri app configuration (window size, title, bundle settings, icons)

### IPC Bridge
Frontend and backend communicate through Tauri's command invocation:
1. Frontend calls `invoke("greet", { name: value })` from `main.js`
2. Rust receives the command in `lib.rs` via the `#[tauri::command]` macro
3. Rust returns a response (string in the example) back to the frontend

## Key Files & Configuration

- **`package.json`** — Node.js metadata and Tauri CLI version
- **`src-tauri/Cargo.lock`** — Rust dependency lock file (commit to version control)
- **`src-tauri/tauri.conf.json`** — App identity, window dimensions, bundle configuration, and security settings (CSP currently disabled)
- **`src-tauri/capabilities/`** — Permission definitions for the app (Tauri v2 feature)

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
3. Call it from JavaScript using `invoke("command_name", { /* args */ })`

Example:
```rust
#[tauri::command]
fn add(a: i32, b: i32) -> i32 {
    a + b
}
```
Then register: `.invoke_handler(tauri::generate_handler![greet, add])`

## Notes

- The CSP (Content Security Policy) is currently set to `null` in `tauri.conf.json` — tighten this in production
- The app identifier is `com.agrey.simtacv3`; update if redistributing
- Default window size is 800x600 pixels (configurable in `tauri.conf.json`)
