// Conversión de coordenadas.
//
// REGLA ÚNICA DEL SISTEMA: `x` es LONGITUD, `y` es LATITUD.
//   posicion_x: -99.1332 (lon)   posicion_y: 19.4326 (lat)
//
// El mapa NO corre en el EPSG:3857 por defecto de OpenLayers, sino en
// EPSG:4326: es el único gridset sembrado en el GeoServer de SIMTAC
// (`INTEGRACION_RED_LOCAL_MAC.md` §3; `WebMercatorQuad` no existe ahí). Todo
// módulo que necesite pasar de {x, y} a coordenada de mapa —o al revés— usa
// estos helpers y nunca `ol.proj.*` a mano, para que la proyección se pueda
// cambiar en un solo lugar: la constante de acá abajo.

/** Proyección del `ol.View`. Única fuente de verdad del sistema. */
export const PROYECCION_MAPA = 'EPSG:4326';

/** {x, y} del backend -> coordenada de mapa proyectada. */
export function xyAMapa(punto) {
  return ol.proj.fromLonLat([Number(punto.x), Number(punto.y)], PROYECCION_MAPA);
}

/**
 * posicion_x/posicion_y de una entidad -> coordenada de mapa proyectada.
 *
 * Si la posición actual no llegó (pasa con algunas unidades viejas: quedan
 * con `posicion_x`/`posicion_y` sin resolver), cae a la posición base
 * (`posicion_base_x`/`posicion_base_y`) — el mismo criterio que documenta el
 * backend para cuando no se manda posición al crear ("nace en la base").
 * Sin ninguna de las dos, no hay nada que dibujar: devuelve `null` y quien
 * llama decide qué hacer (no agregar el ícono, no rearmar el extent, etc.)
 * en vez de proyectar `NaN` y terminar con un ícono invisible sin ningún
 * aviso.
 */
export function entidadAMapa(entidad) {
  const x = entidad?.posicion_x ?? entidad?.posicion_base_x;
  const y = entidad?.posicion_y ?? entidad?.posicion_base_y;
  if (x === null || x === undefined || y === null || y === undefined) return null;
  const punto = ol.proj.fromLonLat([Number(x), Number(y)], PROYECCION_MAPA);
  return Number.isFinite(punto[0]) && Number.isFinite(punto[1]) ? punto : null;
}

/** Coordenada de mapa proyectada -> {x, y} para enviar al backend. */
export function mapaAXY(coordenada) {
  const lonLat = ol.proj.toLonLat(coordenada, PROYECCION_MAPA);
  return { x: lonLat[0], y: lonLat[1] };
}

/** [lon, lat] -> coordenada de mapa proyectada. */
export function lonLatAMapa(lonLat) {
  return ol.proj.fromLonLat(lonLat, PROYECCION_MAPA);
}

/** Coordenada de mapa proyectada -> [lon, lat]. */
export function mapaALonLat(coordenada) {
  return ol.proj.toLonLat(coordenada, PROYECCION_MAPA);
}

/**
 * Un radio en metros no se puede usar tal cual como radio de un
 * `ol.geom.Circle`: las unidades del mapa no son metros. En EPSG:4326 son
 * grados, y un grado de longitud mide menos cuanto más lejos del ecuador, así
 * que la conversión depende de la latitud. (En EPSG:3857 la corrección es la
 * inversa —multiplicar por 1/cos— porque Mercator estira la escala; por eso
 * vive acá y no repartida por los módulos que dibujan círculos.)
 */
export function metrosAUnidadesMapa(metros, lat) {
  const m = Number(metros);
  if (!isFinite(m)) return 0;
  const coseno = Math.cos(((Number(lat) || 0) * Math.PI) / 180);
  if (PROYECCION_MAPA === 'EPSG:4326') {
    const METROS_POR_GRADO = 111320;
    return m / (METROS_POR_GRADO * Math.max(coseno, 0.01));
  }
  return m / Math.max(coseno, 0.01);
}

/** Distancia en metros entre dos {x, y} (Haversine). Solo para mostrar. */
export function distanciaMetros(a, b) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (Number(b.y) - Number(a.y)) * rad;
  const dLon = (Number(b.x) - Number(a.x)) * rad;
  const lat1 = Number(a.y) * rad;
  const lat2 = Number(b.y) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Formatea una distancia en metros como "480 m" o "5.2 km". */
export function formatearDistancia(metros) {
  const m = Number(metros);
  if (!isFinite(m)) return '--';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

/** Formatea segundos como "25m 41s". */
export function formatearDuracion(segundos) {
  const s = Math.max(0, Math.round(Number(segundos) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export default {
  PROYECCION_MAPA,
  xyAMapa,
  entidadAMapa,
  mapaAXY,
  lonLatAMapa,
  mapaALonLat,
  metrosAUnidadesMapa,
  distanciaMetros,
  formatearDistancia,
  formatearDuracion,
};
