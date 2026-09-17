use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
pub struct Unidad {
    #[serde(rename = "SIDC")]
    sidc: String,
    id: i32,
    posicion: [f64; 2],
    personal: i32,
    ataque: i32,
    defensa: i32,
    #[serde(rename = "lineaDeVista")]
    linea_de_vista: i32,
    peleando: bool,
    #[serde(rename = "enMovimiento")]
    en_movimiento: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EstadoActual {
    ejercicio: i32,
    sala: i32,
    #[serde(rename = "unidadesRojas")]
    unidades_rojas: Vec<Unidad>,
    #[serde(rename = "unidadesAzules")]
    unidades_azules: Vec<Unidad>,
    #[serde(rename = "unidadesNeutrales")]
    unidades_neutrales: Vec<Unidad>,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn cargar_estado_actual() -> Result<EstadoActual, String> {
    let possible_paths = vec![
        PathBuf::from("json/estadoactual.json"),
        PathBuf::from("./json/estadoactual.json"),
        PathBuf::from("../json/estadoactual.json"),
    ];

    let mut json_content = None;
    let mut last_error = String::new();

    for path in &possible_paths {
        match fs::read_to_string(path) {
            Ok(content) => {
                println!("✓ Archivo encontrado en: {:?}", path);
                json_content = Some(content);
                break;
            }
            Err(e) => {
                last_error = format!("{:?}: {}", path, e);
                println!("✗ No encontrado en {:?}", path);
            }
        }
    }

    let json_content = json_content
        .ok_or_else(|| format!("No se pudo encontrar estadoactual.json. Último error: {}", last_error))?;

    let estado: EstadoActual = serde_json::from_str(&json_content)
        .map_err(|e| format!("Error al parsear JSON: {}", e))?;

    println!("✓ Estado actual cargado: {} rojas, {} azules, {} neutrales",
        estado.unidades_rojas.len(),
        estado.unidades_azules.len(),
        estado.unidades_neutrales.len());

    Ok(estado)
}

// ---------------------------------------------------------------------------
// Persistencia de la sesión (access token + refresh token + usuario)
//
// El frontend no debe guardar los tokens en localStorage. Se escriben en el
// directorio de configuración de la app, al que solo llega el proceso nativo.
// ---------------------------------------------------------------------------

fn ruta_sesion(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("No se pudo resolver el directorio de configuración: {}", e))?;
    fs::create_dir_all(&dir)
        .map_err(|e| format!("No se pudo crear {:?}: {}", dir, e))?;
    Ok(dir.join("sesion.json"))
}

#[tauri::command]
fn guardar_sesion(app: tauri::AppHandle, datos: String) -> Result<(), String> {
    let ruta = ruta_sesion(&app)?;
    fs::write(&ruta, datos).map_err(|e| format!("No se pudo escribir {:?}: {}", ruta, e))
}

#[tauri::command]
fn leer_sesion(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let ruta = ruta_sesion(&app)?;
    match fs::read_to_string(&ruta) {
        Ok(contenido) => Ok(Some(contenido)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("No se pudo leer {:?}: {}", ruta, e)),
    }
}

#[tauri::command]
fn borrar_sesion(app: tauri::AppHandle) -> Result<(), String> {
    let ruta = ruta_sesion(&app)?;
    match fs::remove_file(&ruta) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("No se pudo borrar {:?}: {}", ruta, e)),
    }
}

// ---------------------------------------------------------------------------
// Configuración del despliegue (hoy: la URL del GeoServer)
//
// `src/config.json` viaja DENTRO del binario en un build de release, así que no
// sirve para que el operador cambie la IP en una máquina ya instalada. Este
// archivo vive en el directorio de configuración de la app —el mismo que
// `sesion.json`— y por eso sí se puede editar con un bloc de notas sin
// recompilar ni reinstalar nada. Tiene prioridad sobre `config.json`.
//
// Es un JSON opaco para Rust (se guarda y se devuelve tal cual): quien decide
// qué claves tiene es el frontend (`geoserver.js`), no este archivo.
// ---------------------------------------------------------------------------

fn ruta_config(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("No se pudo resolver el directorio de configuración: {}", e))?;
    fs::create_dir_all(&dir)
        .map_err(|e| format!("No se pudo crear {:?}: {}", dir, e))?;
    Ok(dir.join("config.json"))
}

#[tauri::command]
fn leer_config(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let ruta = ruta_config(&app)?;
    match fs::read_to_string(&ruta) {
        Ok(contenido) => Ok(Some(contenido)),
        // Que no exista es lo normal en una instalación recién puesta: se cae a
        // `config.json` del despliegue, no es un error que haya que reportar.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("No se pudo leer {:?}: {}", ruta, e)),
    }
}

#[tauri::command]
fn guardar_config(app: tauri::AppHandle, datos: String) -> Result<(), String> {
    let ruta = ruta_config(&app)?;
    fs::write(&ruta, datos).map_err(|e| format!("No se pudo escribir {:?}: {}", ruta, e))
}

/// Ruta del archivo, para poder mostrársela al operador que lo tiene que editar.
#[tauri::command]
fn ruta_config_usuario(app: tauri::AppHandle) -> Result<String, String> {
    Ok(ruta_config(&app)?.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            cargar_estado_actual,
            guardar_sesion,
            leer_sesion,
            borrar_sesion,
            leer_config,
            guardar_config,
            ruta_config_usuario
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
