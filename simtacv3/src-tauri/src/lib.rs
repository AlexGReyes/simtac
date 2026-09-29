use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

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

// ---------------------------------------------------------------------------
// Actualizador (tauri-plugin-updater)
//
// Al abrir, antes del login, el frontend (`actualizador.js`) pregunta si hay
// una versión publicada distinta de la instalada. La URL del manifiesto
// `latest.json` NO está fija en `tauri.conf.json`: sale de la misma cadena de
// configuración que el backend (`Config.actualizaciones()`), así que si el
// servidor cambia de IP las actualizaciones lo siguen.
//
// Política del ejercicio: TODOS los equipos con la MISMA versión. Por eso el
// comparador es "distinta", no "mayor": si se republica una versión anterior
// (volver atrás un despliegue roto), los clientes también bajan a esa.
//
// El instalador viene firmado: el plugin verifica la firma contra la clave
// pública de `tauri.conf.json` antes de ejecutarlo, aunque el manifiesto se
// sirva por http plano en la LAN.
// ---------------------------------------------------------------------------

/// La actualización encontrada por `buscar_actualizacion`, a la espera de que
/// el frontend pida instalarla.
#[derive(Default)]
struct ActualizacionPendiente(Mutex<Option<Update>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InfoActualizacion {
    version: String,
    version_actual: String,
    notas: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "evento", content = "datos", rename_all = "camelCase")]
enum ProgresoDescarga {
    Inicio { total: Option<u64> },
    Avance { bytes: usize },
    Fin,
}

#[tauri::command]
async fn buscar_actualizacion(
    app: tauri::AppHandle,
    pendiente: State<'_, ActualizacionPendiente>,
    url: String,
) -> Result<Option<InfoActualizacion>, String> {
    // En desarrollo la versión es la de `tauri.conf.json` (0.1.0): contra una
    // versión publicada siempre daría "distinta" y cada `tauri dev` intentaría
    // reinstalar la app.
    if cfg!(debug_assertions) {
        println!("[actualizador] build de desarrollo: no se buscan actualizaciones");
        return Ok(None);
    }

    let endpoint: tauri::Url = url
        .parse()
        .map_err(|e| format!("URL de actualizaciones inválida ({}): {}", url, e))?;
    let actualizacion = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| e.to_string())?
        .version_comparator(|actual, remota| remota.version != actual)
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;

    let info = actualizacion.as_ref().map(|a| InfoActualizacion {
        version: a.version.clone(),
        version_actual: a.current_version.clone(),
        notas: a.body.clone(),
    });
    *pendiente.0.lock().map_err(|e| e.to_string())? = actualizacion;
    Ok(info)
}

#[tauri::command]
async fn instalar_actualizacion(
    app: tauri::AppHandle,
    pendiente: State<'_, ActualizacionPendiente>,
    progreso: Channel<ProgresoDescarga>,
) -> Result<(), String> {
    let actualizacion = pendiente
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or("No hay ninguna actualización pendiente: buscarla primero")?;

    let mut empezo = false;
    actualizacion
        .download_and_install(
            |bytes, total| {
                if !empezo {
                    empezo = true;
                    let _ = progreso.send(ProgresoDescarga::Inicio { total });
                }
                let _ = progreso.send(ProgresoDescarga::Avance { bytes });
            },
            || {
                let _ = progreso.send(ProgresoDescarga::Fin);
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    // En Windows el instalador NSIS ya cerró la app para reemplazarla; en el
    // resto de plataformas hay que reiniciar para cargar la versión nueva.
    app.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ActualizacionPendiente::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            cargar_estado_actual,
            guardar_sesion,
            leer_sesion,
            borrar_sesion,
            leer_config,
            guardar_config,
            ruta_config_usuario,
            buscar_actualizacion,
            instalar_actualizacion
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
