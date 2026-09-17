// Cartografía SIMTAC GeoServer sobre OpenLayers.
//
// Implementa lo documentado en `INTEGRACION_SIMTAC_GEOSERVER.md` y
// `INTEGRACION_RED_LOCAL_MAC.md`: base cacheada por WMTS/GWC, mosaico
// satelital condicional, WMS dinámico (GetMap/GetFeatureInfo/GetLegendGraphic),
// WFS y ruta vehicular por `viewparams`.
//
// Reglas duras que vienen de esos documentos y NO hay que "optimizar":
//
//  1. El único gridset sembrado es `EPSG:4326`. `WebMercatorQuad` NO existe en
//     esa instalación, así que el mapa entero corre en EPSG:4326 (ver
//     `geo.js`, `PROYECCION_MAPA`), no en el Web Mercator por defecto de OL.
//  2. Un solo layergroup base activo por vez, según el zoom (`grupoParaZoom`).
//     Los rangos son intervalos semiabiertos `[min, max)`.
//  3. `SIMTAC_CACHE_VERSION` solo donde toca (z7+ en la base, siempre en el
//     satélite). Ponerlo en todas las peticiones tira a la basura la caché.
//  4. WMS 1.1.1, nunca 1.3.0: con EPSG:4326 la 1.3.0 invierte el orden de ejes
//     del bbox (lat,lon) y devuelve mapas en blanco.
//  5. `/geoserver/rest/...` y `/geoserver/gwc/rest/...` NUNCA se llaman desde
//     acá: piden credenciales de administrador y son tarea del operador.

import Config from './config.js';

/** Valor de último recurso; la cadena de configuración real vive en `config.js`. */
export const URL_POR_DEFECTO = Config.DEFECTOS.geoserver;

/** Constantes del proyecto SIMTAC (`BASE_CACHE_VERSION`/`SATELLITE_CACHE_VERSION`). */
export const CACHE_VERSION_BASE = '20260828-relieve-sombreado-v10';
export const CACHE_VERSION_SATELITE = '20260828-satelital-v2';

/** Capa del mosaico satelital: vive en un disco externo, puede no estar montado. */
export const CAPA_SATELITE = 'simtac_general:img_sat_nal';

/**
 * Los 5 layergroups base por banda de zoom. `versionada` marca los que llevan
 * `SIMTAC_CACHE_VERSION` (z7+). Los 3 grupos heredados
 * (`simtac_zoom_nacional`/`_regional`/`_detalle`) quedan deliberadamente fuera:
 * el documento pide no usarlos en integraciones nuevas.
 */
export const GRUPOS_BASE = [
  { nombre: 'simtac_zoom_mundo', min: 0, max: 5, matrizMax: 4, versionada: false, titulo: 'Mundo (z0–4)' },
  { nombre: 'simtac_zoom_pais', min: 5, max: 7, matrizMax: 6, versionada: false, titulo: 'País (z5–6)' },
  { nombre: 'simtac_zoom_region', min: 7, max: 9, matrizMax: 8, versionada: true, titulo: 'Región (z7–8)' },
  { nombre: 'simtac_zoom_operacional', min: 9, max: 11, matrizMax: 10, versionada: true, titulo: 'Operacional (z9–10)' },
  { nombre: 'simtac_zoom_contexto', min: 11, max: Infinity, matrizMax: 18, versionada: true, titulo: 'Contexto (z11+)' },
];

/** Zoom mínimo/máximo en el que se muestra el satélite, y último nivel sembrado. */
export const SATELITE_ZOOM_MIN = 12;
export const SATELITE_ZOOM_MAX = 18;
export const SATELITE_ZOOM_NATIVO_MAX = 15;

// ---------------------------------------------------------------------------
// Gridset EPSG:4326 de GeoWebCache
//
// Nivel 0 = 2 teselas de 256 px cubriendo el mundo, o sea 0.703125°/px, y cada
// nivel siguiente parte la resolución a la mitad. El `View` del mapa usa ESTA
// misma tabla de resoluciones (ver `resoluciones()`), así que el zoom entero
// del mapa coincide exactamente con el `TILEMATRIX` de GWC y con las bandas de
// zoom documentadas — si se dejara el default de OL para EPSG:4326 (360/256 en
// z0) todos los umbrales quedarían corridos un nivel.
// ---------------------------------------------------------------------------

export const RESOLUCION_Z0 = 180 / 256; // 0.703125 grados por píxel
const NIVELES_BASE = 19; // z0–18: el grupo `contexto`, el que más lejos llega
const ORIGEN_GRID = [-180, 90];
const EXTENSION_MUNDO = [-180, -90, 180, 90];

/** Resoluciones del gridset completo (las usa el `View` del mapa). */
export function resoluciones(niveles = NIVELES_BASE) {
  return Array.from({ length: niveles }, (_, z) => RESOLUCION_Z0 / 2 ** z);
}

/**
 * Tile grid acotado a los `TILEMATRIX` que ESA capa tiene publicados en GWC.
 *
 * No es una optimización: cada layergroup está sembrado solo en su banda y
 * GWC devuelve `HTTP 400 Unknown TILEMATRIX EPSG:4326:{z}` para cualquier otro
 * nivel — comprobado nivel por nivel contra el servidor. Con un grid completo
 * OL pide el nivel más cercano a la resolución de la vista, y durante un zoom
 * fraccionario (z8.5, mitad de una animación) eso cae fuera de la banda y la
 * tesela falla. Con el grid acotado, `getZForResolution` no puede salirse: se
 * queda en el nivel del borde y OL lo reescala, que es lo que se ve igual.
 *
 * Los índices del array arrancan en 0 pero `matrixIds` lleva el identificador
 * real (`EPSG:4326:7`...), así que el pedido sale con el nivel correcto. Las
 * filas y columnas no dependen del índice sino del origen y la resolución.
 */
function gridWmts(zMin, zMax) {
  const niveles = [];
  for (let z = zMin; z <= zMax; z += 1) niveles.push(z);
  return new ol.tilegrid.WMTS({
    origin: ORIGEN_GRID,
    extent: EXTENSION_MUNDO,
    resolutions: niveles.map((z) => RESOLUCION_Z0 / 2 ** z),
    matrixIds: niveles.map((z) => `EPSG:4326:${z}`),
    tileSize: 256,
  });
}

/** Grupo base que corresponde a un zoom. Intervalo semiabierto `[min, max)`. */
export function grupoParaZoom(zoom) {
  const z = Math.floor(Number(zoom) || 0);
  return GRUPOS_BASE.find((g) => z >= g.min && z < g.max) || GRUPOS_BASE[GRUPOS_BASE.length - 1];
}

// ---------------------------------------------------------------------------
// URL del servidor
//
// No se resuelve acá: la cadena de configuración (query string → config del
// usuario → `config.json` del despliegue → valor por defecto) vive en
// `config.js`, que la comparte con la URL del backend Node. Este módulo solo
// pone nombres propios de cartografía sobre esa base.
// ---------------------------------------------------------------------------

/** Valida una URL base de GeoServer (rechaza además la ruta administrativa `/rest`). */
export function urlSegura(valor) {
  return Config.urlSegura(valor, { prohibirRest: true });
}

/** URL base vigente. Sincrónica: la usan las fábricas de capas. */
export function urlBase() {
  return Config.geoserver();
}

/** De dónde salió la URL vigente. Para mostrarlo en el panel de capas. */
export function origenConfiguracion() {
  return Config.origen('geoserver');
}

/** Ruta del `config.json` editable, o `null` fuera de Tauri. */
export function rutaConfigUsuario() {
  return Config.rutaConfigUsuario();
}

/** Resuelve la configuración. Llamar una vez al arrancar, antes de crear capas. */
export function cargarConfiguracion() {
  return Config.cargar();
}

/**
 * Cambia la URL del GeoServer y la persiste en el config del usuario. Devuelve
 * la URL normalizada; lanza si no pasa la validación. Quien llama decide si
 * recarga las capas (`Mapa.reapuntarGeoserver` lo hace).
 */
export function fijarUrlBase(valor) {
  return Config.fijar('geoserver', valor);
}

/** Vuelve a lo que diga el `config.json` del despliegue. */
export async function limpiarUrlBase() {
  await Config.restablecer();
  return urlBase();
}

// ---------------------------------------------------------------------------
// Capas OpenLayers
// ---------------------------------------------------------------------------

function fuenteWmts(capa, { cacheVersion, zMin = 0, zMax = NIVELES_BASE - 1 } = {}) {
  return new ol.source.WMTS({
    url: `${urlBase()}/gwc/service/wmts`,
    layer: capa,
    matrixSet: 'EPSG:4326',
    projection: 'EPSG:4326',
    format: 'image/png',
    style: '',
    requestEncoding: 'KVP',
    tileGrid: gridWmts(zMin, zMax),
    // GWC guarda cada valor de la dimensión por separado: el cache-busting no
    // mezcla teselas viejas con nuevas ni obliga a truncar la caché.
    dimensions: cacheVersion ? { SIMTAC_CACHE_VERSION: cacheVersion } : undefined,
    wrapX: false,
    crossOrigin: 'anonymous',
    attributions: 'SIMTAC GeoServer',
  });
}

/**
 * Las 5 capas base (una por layergroup). Se devuelven todas creadas pero solo
 * una visible: `sincronizarBase` prende la que corresponde al zoom.
 */
export function crearCapasBase() {
  return GRUPOS_BASE.map((grupo) => {
    const capa = new ol.layer.Tile({
      source: fuenteWmts(grupo.nombre, {
        cacheVersion: grupo.versionada ? CACHE_VERSION_BASE : null,
        zMin: grupo.min,
        zMax: grupo.matrizMax,
      }),
      visible: false,
      zIndex: 1,
    });
    capa.set('grupoSimtac', grupo.nombre);
    capa.set('title', `SIMTAC ${grupo.titulo}`);
    return capa;
  });
}

/**
 * Capa del mosaico satelital. Se crea siempre (sale barato) pero arranca
 * invisible: solo se prende si `sateliteDisponible()` confirma que el disco
 * está montado Y el usuario la pide. El tile grid llega hasta el último nivel
 * sembrado (z15) a propósito: de z16 a z18 OL reescala z15, que es exactamente
 * lo que hace `maxNativeZoom` en el visor de referencia.
 */
export function crearCapaSatelite() {
  const capa = new ol.layer.Tile({
    source: fuenteWmts(CAPA_SATELITE, {
      cacheVersion: CACHE_VERSION_SATELITE,
      zMin: SATELITE_ZOOM_MIN,
      zMax: SATELITE_ZOOM_NATIVO_MAX,
    }),
    visible: false,
    zIndex: 2, // sobre la base, debajo de vectores y símbolos
  });
  capa.set('title', 'Mosaico satelital');
  return capa;
}

/**
 * Overlay WMS dinámico para una capa suelta (no cacheada). `estilo` vacío
 * hereda el `defaultStyle` publicado — obligatorio para las capas RM
 * remapeadas semánticamente, que dependen de él.
 */
export function crearCapaWms(nombre, { estilo = '', zIndex = 3, visible = true } = {}) {
  const capa = new ol.layer.Tile({
    source: new ol.source.TileWMS({
      url: `${urlBase()}/wms`,
      params: {
        LAYERS: nombre,
        STYLES: estilo,
        VERSION: '1.1.1', // 1.3.0 invierte los ejes del bbox en EPSG:4326
        FORMAT: 'image/png',
        TRANSPARENT: true,
        TILED: true,
      },
      projection: 'EPSG:4326',
      serverType: 'geoserver',
      crossOrigin: 'anonymous',
    }),
    visible,
    zIndex,
  });
  capa.set('capaSimtac', nombre);
  capa.set('title', nombre);
  return capa;
}

/**
 * Deja visible únicamente el grupo base que corresponde al zoom actual.
 * Devuelve el nombre del grupo activo (o `null` si no hay capas).
 */
export function sincronizarBase(capasBase, zoom) {
  if (!capasBase?.length) return null;
  const activo = grupoParaZoom(zoom).nombre;
  for (const capa of capasBase) capa.setVisible(capa.get('grupoSimtac') === activo);
  return activo;
}

/**
 * El satélite solo se dibuja entre z12 y z18. `intencion` es lo que pidió el
 * usuario: se conserva aparte para poder reactivarlo al volver al rango, en vez
 * de "apagarse solo" y quedar apagado.
 */
export function sincronizarSatelite(capaSatelite, zoom, intencion) {
  if (!capaSatelite) return false;
  const z = Math.floor(Number(zoom) || 0);
  const enRango = z >= SATELITE_ZOOM_MIN && z <= SATELITE_ZOOM_MAX;
  const visible = !!intencion && enRango;
  capaSatelite.setVisible(visible);
  return visible;
}

// ---------------------------------------------------------------------------
// Peticiones OGC
// ---------------------------------------------------------------------------

/**
 * `fetch` con timeout. GeoServer contesta errores como XML
 * (`ServiceExceptionReport`) incluso cuando se pidió JSON, así que un
 * `HTTP 200` no alcanza: hay que mirar el `Content-Type`.
 */
async function pedir(url, { timeoutMs = 15000, esperaJson = false } = {}) {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), timeoutMs);
  try {
    const respuesta = await fetch(url, { signal: control.signal });
    const tipo = respuesta.headers.get('content-type') || '';
    if (!respuesta.ok) throw new Error(`GeoServer respondió HTTP ${respuesta.status}`);
    if (esperaJson && !tipo.includes('json')) {
      throw new Error(`GeoServer devolvió ${tipo || 'contenido desconocido'} en vez de JSON`);
    }
    return esperaJson ? respuesta.json() : respuesta.text();
  } finally {
    clearTimeout(reloj);
  }
}

/** GetCapabilities de WMS, opcionalmente acotado a un workspace (más liviano). */
export function capabilitiesWms(workspace = null, opciones = {}) {
  const raiz = workspace ? `${urlBase()}/${encodeURIComponent(workspace)}/wms` : `${urlBase()}/wms`;
  const parametros = new URLSearchParams({
    service: 'WMS',
    version: '1.1.1',
    request: 'GetCapabilities',
  });
  return pedir(`${raiz}?${parametros}`, { timeoutMs: 30000, ...opciones });
}

/**
 * ¿Está montado el mosaico satelital? Se pregunta con el GetCapabilities
 * acotado al workspace (mucho más liviano que el global, que trae las ~390
 * capas). Que NO esté es un estado esperado, no una falla del servidor: por eso
 * devuelve `false` en vez de propagar el error.
 */
export async function sateliteDisponible() {
  try {
    const xml = await capabilitiesWms('simtac_general');
    return xml.includes('<Name>simtac_general:img_sat_nal</Name>') || xml.includes('<Name>img_sat_nal</Name>');
  } catch (error) {
    console.warn('[geoserver] no se pudo verificar el satélite:', error.message);
    return false;
  }
}

/**
 * Capas publicadas, leídas del GetCapabilities (fuente de verdad del propio
 * servidor, nunca una lista hardcodeada que se desincroniza). Devuelve
 * `[{ nombre, titulo }]` ya ordenado.
 */
export async function listarCapas(workspace = null) {
  const xml = await capabilitiesWms(workspace);
  const documento = new DOMParser().parseFromString(xml, 'application/xml');
  if (documento.querySelector('parsererror')) throw new Error('GetCapabilities ilegible');

  const capas = [];
  for (const nodo of documento.querySelectorAll('Layer')) {
    const nombre = nodo.querySelector(':scope > Name')?.textContent?.trim();
    if (!nombre) continue; // los `Layer` sin `Name` son solo contenedores del árbol
    capas.push({ nombre, titulo: nodo.querySelector(':scope > Title')?.textContent?.trim() || nombre });
  }
  return capas.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/**
 * GetFeatureInfo sobre una petición GetMap equivalente. `bbox` va en orden
 * `lonMin,latMin,lonMax,latMax` porque se pide WMS 1.1.1.
 *
 * Los atributos vuelven crudos: GeoServer no filtra los campos técnicos, eso es
 * responsabilidad del cliente (ver `panel-cartografia` en `mapa.js`).
 */
export async function getFeatureInfo({ capas, bbox, ancho, alto, x, y, cantidad = 10 }) {
  const parametros = new URLSearchParams({
    service: 'WMS',
    version: '1.1.1',
    request: 'GetFeatureInfo',
    layers: capas,
    query_layers: capas,
    styles: '',
    bbox: bbox.join(','),
    width: String(Math.round(ancho)),
    height: String(Math.round(alto)),
    srs: 'EPSG:4326',
    info_format: 'application/json',
    feature_count: String(cantidad),
    x: String(Math.round(x)),
    y: String(Math.round(y)),
  });
  return pedir(`${urlBase()}/wms?${parametros}`, { esperaJson: true });
}

/** URL del recuadro de leyenda de una capa (o de su estilo, si se pasa uno). */
export function urlLeyenda(capa, estilo = '') {
  const parametros = new URLSearchParams({
    service: 'WMS',
    version: '1.1.1',
    request: 'GetLegendGraphic',
    layer: capa,
    format: 'image/png',
    width: '20',
    height: '20',
  });
  if (estilo) parametros.set('style', estilo);
  return `${urlBase()}/wms?${parametros}`;
}

/**
 * WFS en GeoJSON. `bbox` (o `cqlFilter`) no es opcional por capricho:
 * `simtac_general:caminos_nal` sin acotar son ~1.87 M de features y la petición
 * no termina. Se acota siempre que la capa pueda ser grande.
 */
export async function getFeature(capa, { bbox = null, cqlFilter = null, maximo = 1000, timeoutMs = 30000 } = {}) {
  const parametros = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeName: capa,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    count: String(maximo),
  });
  if (bbox) parametros.set('bbox', bbox.join(','));
  if (cqlFilter) parametros.set('CQL_FILTER', cqlFilter);
  return pedir(`${urlBase()}/wfs?${parametros}`, { esperaJson: true, timeoutMs });
}

/**
 * Un valor de `viewparams` no puede contener `:` ni `;`: el servidor decodifica
 * el parámetro externo y recién ahí parsea el mini-formato
 * `clave:valor;clave:valor`, así que `encodeURIComponent` sobre la cadena
 * completa NO alcanza — hay que rechazar el valor antes de componerla.
 */
function valorViewParam(valor) {
  const texto = String(valor);
  if (texto.includes(':') || texto.includes(';')) {
    throw new Error('valor inválido para viewparams');
  }
  return texto;
}

/**
 * Ruta vehicular por la vista SQL parametrizada (pgRouting). Coordenadas a 6
 * decimales: más precisión que eso la rechaza el `regexpValidator` de la vista
 * con HTTP 400.
 *
 * La respuesta es un `FeatureCollection` con **0 o 1** features; la geometría
 * es `MultiLineString` (no `LineString`): hay que recorrer todas sus partes, no
 * asumir `coordinates[0]`, y el sentido de la línea no está garantizado.
 * `properties.length_m` es la longitud real sobre la red vial — usala como
 * distancia en vez de un haversine sobre los vértices; no viene duración.
 *
 * ⚠️ Defecto del servidor (no del cliente), corregido por la migración
 * `db/migrations/006_routing_cache_upsert.sql` pero todavía presente en los
 * despliegues donde no se aplicó: repetir exactamente el mismo par de
 * coordenadas cuya ruta ya está cacheada hace más de 7 días devuelve
 * `HTTP 400 duplicate key ... simtac_ruta_cache_pkey` en vez del resultado — el
 * `INSERT` de la caché no tiene `ON CONFLICT`. Se traduce a un mensaje
 * entendible en vez de dejar salir el error crudo de Postgres.
 */
export async function calcularRuta(origen, destino, { timeoutMs = 60000 } = {}) {
  const red = (n) => Number(n).toFixed(6);
  const viewparams = [
    `origen_lon:${valorViewParam(red(origen.x))}`,
    `origen_lat:${valorViewParam(red(origen.y))}`,
    `destino_lon:${valorViewParam(red(destino.x))}`,
    `destino_lat:${valorViewParam(red(destino.y))}`,
  ].join(';');

  const parametros = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeName: 'simtac_general:simtac_ruta_calculada',
    outputFormat: 'application/json',
    viewparams,
  });

  try {
    return await pedir(`${urlBase()}/wfs?${parametros}`, { esperaJson: true, timeoutMs });
  } catch (error) {
    if (String(error.message).includes('400')) {
      throw new Error(
        'GeoServer rechazó la ruta (HTTP 400). Si el servidor no tiene aplicada la migración ' +
          '006 de la caché de rutas, repetir coordenadas exactas falla: desplazá el origen o el ' +
          'destino unos metros.',
      );
    }
    throw error;
  }
}

/** Diagnóstico rápido desde DevTools: `await window.simtacGeoserver.probar()`. */
export async function probar() {
  const base = urlBase();
  const resultado = { url: base, capabilities: null, satelite: null, teselaBase: null };
  try {
    const xml = await capabilitiesWms();
    resultado.capabilities = `ok (${xml.length} bytes)`;
  } catch (error) {
    resultado.capabilities = `falló: ${error.message}`;
  }
  resultado.satelite = (await sateliteDisponible()) ? 'montado' : 'desmontado o inaccesible';
  try {
    const parametros = new URLSearchParams({
      SERVICE: 'WMTS', REQUEST: 'GetTile', VERSION: '1.0.0',
      LAYER: 'simtac_zoom_pais', STYLE: '', FORMAT: 'image/png',
      TILEMATRIXSET: 'EPSG:4326', TILEMATRIX: 'EPSG:4326:5', TILEROW: '10', TILECOL: '7',
    });
    const respuesta = await fetch(`${base}/gwc/service/wmts?${parametros}`);
    const blob = await respuesta.blob();
    resultado.teselaBase = `HTTP ${respuesta.status}, ${blob.size} bytes, ${blob.type}`;
  } catch (error) {
    resultado.teselaBase = `falló: ${error.message}`;
  }
  return resultado;
}

export default {
  URL_POR_DEFECTO,
  GRUPOS_BASE,
  CAPA_SATELITE,
  SATELITE_ZOOM_MIN,
  SATELITE_ZOOM_MAX,
  resoluciones,
  grupoParaZoom,
  cargarConfiguracion,
  urlBase,
  urlSegura,
  fijarUrlBase,
  limpiarUrlBase,
  origenConfiguracion,
  rutaConfigUsuario,
  crearCapasBase,
  crearCapaSatelite,
  crearCapaWms,
  sincronizarBase,
  sincronizarSatelite,
  capabilitiesWms,
  sateliteDisponible,
  listarCapas,
  getFeatureInfo,
  urlLeyenda,
  getFeature,
  calcularRuta,
  probar,
};
