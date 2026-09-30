// Configuración del despliegue: las URLs que cambian de una instalación a
// otra —el **backend Node** de la simulación, el **GeoServer** de la
// cartografía y el manifiesto de **actualizaciones**— y de dónde salen.
//
// El objetivo es que mover el sistema a otra máquina o a otra red sea editar un
// archivo, nunca tocar código ni recompilar. Cadena de resolución por clave, de
// más a menos prioridad:
//
//   1. Query string de arranque (`?backend=...`, `?geoserver=...`) — prueba
//      puntual, no persiste.
//   2. `config.json` del directorio de configuración de la app
//      (`%APPDATA%/com.agrey.simtacv3/`, el mismo de `sesion.json`). Es el
//      único editable en una máquina YA instalada, porque el `config.json` de
//      abajo viaja dentro del binario en un build de release. Lo escribe
//      Administración → Conexiones (`conexiones.js`) y se puede editar con un bloc de notas.
//   3. `src/config.json` — el config del despliegue, que viaja con la app.
//   4. Los valores de `DEFECTOS`, último recurso.
//
// Una candidata inválida se descarta con un aviso por consola y se prueba la
// siguiente: un archivo mal editado degrada al nivel de abajo en vez de dejar
// la app sin backend ni mapa.

/** Valores de último recurso: el despliegue original, todo en la misma máquina. */
export const DEFECTOS = {
  backend: 'http://10.40.0.6',
  geoserver: 'http://10.40.0.6:3001/geoserver',
};

/**
 * Manifiesto del actualizador (`actualizador.js`). No tiene valor fijo de
 * último recurso: si nadie lo configuró, vive en el mismo servidor que el
 * backend, así que sigue al backend cuando este cambia de IP.
 */
const RUTA_ACTUALIZACIONES = '/actualizaciones/latest.json';

/**
 * Claves que este módulo conoce. Cualquier otra en el JSON se ignora. El orden
 * importa: `actualizaciones` se resuelve después de `backend` porque su valor
 * por defecto sale de él.
 */
const CLAVES = [...Object.keys(DEFECTOS), 'actualizaciones'];

function defecto(clave) {
  return clave === 'actualizaciones' ? `${valores.backend}${RUTA_ACTUALIZACIONES}` : DEFECTOS[clave];
}

/**
 * Valida y normaliza una URL de servicio. Devuelve la URL sin barra final o
 * lanza con un motivo legible.
 *
 * `prohibirRest` es para GeoServer: `/geoserver/rest/...` es la API de
 * administración, pide credenciales y permite borrar capas o truncar la caché.
 * Nunca se llama desde el cliente, así que una URL base que la contenga se
 * rechaza de entrada — también en su forma percent-encoded.
 */
export function urlSegura(valor, { prohibirRest = false } = {}) {
  const texto = String(valor ?? '').trim();
  if (!texto) throw new Error('URL vacía');

  let url;
  try {
    url = new URL(texto);
  } catch {
    throw new Error('URL mal formada');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Solo se aceptan URLs http:// o https://');
  }
  if (url.username || url.password) throw new Error('La URL no puede llevar credenciales');
  if (url.search || url.hash) throw new Error('La URL no puede llevar query ni fragmento');

  if (prohibirRest) {
    // Un `decodeURIComponent` sobre una ruta con un `%` suelto tira; en ese
    // caso se rechaza igual, no se deja pasar por las dudas.
    let ruta;
    try {
      ruta = decodeURIComponent(url.pathname).toLowerCase();
    } catch {
      throw new Error('La ruta de la URL está mal codificada');
    }
    if (/(^|\/)rest(\/|$)/.test(ruta)) {
      throw new Error('La API REST de GeoServer es administrativa: no se consume desde el cliente');
    }
  }

  return (url.origin + url.pathname).replace(/\/+$/, '');
}

const VALIDADORES = {
  backend: (valor) => urlSegura(valor),
  geoserver: (valor) => urlSegura(valor, { prohibirRest: true }),
  actualizaciones: (valor) => urlSegura(valor),
};

// ---------------------------------------------------------------------------
// Fuentes
// ---------------------------------------------------------------------------

function leerDeQuery(clave) {
  try {
    return new URLSearchParams(window.location.search).get(clave);
  } catch {
    return null;
  }
}

/** `invoke` de Tauri, o rechazo si la app corre fuera de Tauri (navegador). */
function invocar(comando, args) {
  const core = window.__TAURI__?.core;
  if (!core?.invoke) return Promise.reject(new Error('Tauri no disponible'));
  return core.invoke(comando, args);
}

const CLAVE_LOCAL = 'simtac:config';

/** Config del usuario. Fuera de Tauri degrada a `localStorage`, como `session.js`. */
async function leerConfigUsuario() {
  let crudo = null;
  try {
    crudo = await invocar('leer_config');
  } catch {
    try {
      crudo = window.localStorage.getItem(CLAVE_LOCAL);
    } catch {
      /* sin almacenamiento: se sigue con el config del despliegue */
    }
  }
  if (!crudo) return null;
  try {
    return JSON.parse(crudo);
  } catch (error) {
    console.warn('[config] el config del usuario no es JSON válido:', error.message);
    return null;
  }
}

/**
 * Config del despliegue: `config.json` al lado del frontend. Se resuelve contra
 * la URL de ESTE módulo (no contra la de la página) para que funcione igual
 * desde `index.html` que desde `mapa-prueba.html`.
 */
async function leerConfigDespliegue() {
  try {
    const respuesta = await fetch(new URL('./config.json', import.meta.url), { cache: 'no-store' });
    if (!respuesta.ok) return null;
    return await respuesta.json();
  } catch (error) {
    console.warn('[config] config.json no se pudo leer:', error.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Estado resuelto
// ---------------------------------------------------------------------------

const valores = { ...DEFECTOS };
const origenes = Object.fromEntries(CLAVES.map((c) => [c, 'valor por defecto']));
let rutaArchivoUsuario = null;
let cargado = false;

/**
 * Resuelve la configuración. Llamar UNA vez al arrancar, antes de crear capas o
 * de hablar con el backend: los getters son sincrónicos y devuelven los valores
 * por defecto hasta que esto termina.
 */
export async function cargar() {
  const usuario = await leerConfigUsuario();
  const despliegue = await leerConfigDespliegue();

  try {
    rutaArchivoUsuario = await invocar('ruta_config_usuario');
  } catch {
    rutaArchivoUsuario = null; // fuera de Tauri no hay archivo que mostrar
  }

  for (const clave of CLAVES) {
    const candidatas = [
      [`query string (?${clave}=)`, leerDeQuery(clave)],
      ['config del usuario', usuario?.[clave]],
      ['config.json del despliegue', despliegue?.[clave]],
      ['valor por defecto', defecto(clave)],
    ];

    for (const [origen, valor] of candidatas) {
      if (!valor) continue;
      try {
        valores[clave] = VALIDADORES[clave](valor);
        origenes[clave] = origen;
        break;
      } catch (error) {
        console.warn(`[config] ${clave} descartado de ${origen}: "${valor}" — ${error.message}`);
      }
    }
    console.info(`[config] ${clave} = ${valores[clave]} (${origenes[clave]})`);
  }

  cargado = true;
  return { ...valores };
}

/** URL del backend Node de la simulación (REST + Socket.IO). */
export function backend() {
  return valores.backend;
}

/** URL base del GeoServer de la cartografía. */
export function geoserver() {
  return valores.geoserver;
}

/** URL del manifiesto `latest.json` del actualizador. */
export function actualizaciones() {
  return valores.actualizaciones;
}

/** De dónde salió el valor vigente de una clave. Para mostrarlo en la interfaz. */
export function origen(clave) {
  return origenes[clave] ?? 'desconocido';
}

/** Ruta del `config.json` editable, o `null` fuera de Tauri. */
export function rutaConfigUsuario() {
  return rutaArchivoUsuario;
}

export function estaCargado() {
  return cargado;
}

/**
 * Cambia un valor y lo persiste en el config del usuario. Devuelve el valor ya
 * normalizado; lanza si no pasa la validación.
 *
 * La escritura va en segundo plano —mismo criterio que `session.js`— para que
 * quien llama siga sin esperar al disco. Se reescribe el archivo entero con
 * todas las claves conocidas, así que editarlo a mano y usar la interfaz no se
 * pisan entre sí.
 */
export function fijar(clave, valor) {
  if (!CLAVES.includes(clave)) throw new Error(`Clave de configuración desconocida: ${clave}`);
  const normalizado = VALIDADORES[clave](valor);
  valores[clave] = normalizado;
  origenes[clave] = 'config del usuario';
  persistir();
  return normalizado;
}

/** `http://a:3001/geoserver` con el host de `nuevo` → `http://b:3001/geoserver`. */
function conHost(url, nuevo) {
  const u = new URL(url);
  u.hostname = new URL(nuevo).hostname;
  return (u.origin + u.pathname).replace(/\/+$/, '');
}

/**
 * Cambia el backend y arrastra lo que depende de él. El GeoServer y el
 * servidor de actualizaciones viven en la misma máquina que el backend (otro
 * puerto u otra ruta): si apuntaban al host del backend anterior, pasan al
 * host nuevo conservando puerto y ruta. Si apuntaban a otra máquina, se dejan.
 * El manifiesto que nadie fijó ya sigue al backend solo (se deriva de él).
 *
 * Devuelve `{ url, arrastrados: [{ clave, antes, ahora }] }`; lanza si la URL
 * no pasa la validación (y entonces no cambia nada).
 */
export function fijarBackend(valor) {
  const url = VALIDADORES.backend(valor);
  const hostAnterior = new URL(valores.backend).hostname;
  const arrastrados = [];

  for (const clave of ['geoserver', 'actualizaciones']) {
    const antes = valores[clave];
    let ahora = antes;
    if (clave === 'actualizaciones' && origenes.actualizaciones !== 'config del usuario') {
      ahora = `${url}${RUTA_ACTUALIZACIONES}`;
    } else if (new URL(antes).hostname === hostAnterior) {
      ahora = VALIDADORES[clave](conHost(antes, url));
      origenes[clave] = 'config del usuario';
    }
    if (ahora !== antes) {
      valores[clave] = ahora;
      arrastrados.push({ clave, antes, ahora });
    }
  }

  valores.backend = url;
  origenes.backend = 'config del usuario';
  persistir();
  return { url, arrastrados };
}

function persistir() {
  // Solo lo que eligió el usuario. Guardar todo dejaba el GeoServer (o el
  // manifiesto) clavado al servidor de hoy aunque viniera del despliegue: al
  // cambiar la IP del backend, el mapa se quedaba en la IP vieja.
  const aGuardar = Object.fromEntries(
    CLAVES.filter((c) => origenes[c] === 'config del usuario').map((c) => [c, valores[c]]),
  );
  const datos = JSON.stringify(aGuardar, null, 2);
  invocar('guardar_config', { datos }).catch(() => {
    try {
      window.localStorage.setItem(CLAVE_LOCAL, datos);
    } catch {
      /* sin persistencia: vale para esta sesión igual */
    }
  });
}

/**
 * Borra el config del usuario y vuelve a resolver la cadena: en la práctica,
 * vuelve a lo que diga el `config.json` del despliegue.
 */
export async function restablecer() {
  try {
    await invocar('guardar_config', { datos: '{}' });
  } catch {
    /* fuera de Tauri alcanza con limpiar localStorage */
  }
  try {
    window.localStorage.removeItem(CLAVE_LOCAL);
  } catch {
    /* nada que limpiar */
  }
  Object.assign(valores, DEFECTOS);
  return cargar();
}

export default {
  DEFECTOS,
  urlSegura,
  cargar,
  backend,
  geoserver,
  actualizaciones,
  origen,
  rutaConfigUsuario,
  estaCargado,
  fijar,
  fijarBackend,
  restablecer,
};
