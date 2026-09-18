// Valida `config/simtac-geoserver.json`: el archivo que lee el backend Node
// para hablarle al SIMTAC GeoServer (ver RESPUESTA_PEDIDO_CONFIG_GEOSERVER.md).
//
//   node pruebas/config-geoserver.mjs
//
// No toca la red: comprueba que el archivo esté completo y coherente, que es lo
// que se rompe al editarlo cuando cambia el despliegue.
import { readFileSync } from 'node:fs';
import { urlSegura } from '../src/config.js';

const cfg = JSON.parse(
  readFileSync(new URL('../config/simtac-geoserver.json', import.meta.url), 'utf8'),
);

const casos = [];
function comprueba(nombre, condicion) {
  const ok = Boolean(condicion);
  casos.push(ok);
  console.log(`${ok ? 'OK  ' : 'FALLA'} ${nombre}`);
}

// URLs: válidas y sin la API administrativa (/rest, /gwc/rest).
for (const clave of ['baseUrl', 'baseUrlAlt']) {
  const valor = cfg.geoserver?.[clave];
  let normalizada = null;
  try { normalizada = urlSegura(valor, { prohibirRest: true }); } catch { /* queda null */ }
  comprueba(`geoserver.${clave} es una URL segura`, normalizada === valor);
}
comprueba('geoserver.dnsLan es null o una URL segura', (() => {
  const v = cfg.geoserver?.dnsLan;
  if (v === null) return true;
  try { return urlSegura(v, { prohibirRest: true }) === v; } catch { return false; }
})());

// Health check: lo que el backend usa para elegir entre baseUrl y baseUrlAlt.
const hc = cfg.geoserver?.healthCheck ?? {};
comprueba('healthCheck.path arranca con /', typeof hc.path === 'string' && hc.path.startsWith('/'));
comprueba('healthCheck espera WMT_MS_Capabilities (WMS 1.1.1)',
  hc.cuerpoContiene === 'WMT_MS_Capabilities' && hc.path?.includes('version=1.1.1'));
comprueba('healthCheck.timeoutMs es un número positivo', hc.timeoutMs > 0);

// Ruta vehicular: lo que se compone en el GetFeature.
const rv = cfg.rutaVehicular ?? {};
comprueba('rutaVehicular.endpointPath es /wfs', rv.endpointPath === '/wfs');
comprueba('rutaVehicular.timeoutMs es un número positivo', rv.timeoutMs > 0);
comprueba('rutaVehicular.auth es null (endpoint público de solo lectura)', rv.auth === null);
for (const [clave, valor] of Object.entries({
  service: 'WFS', version: '2.0.0', request: 'GetFeature',
  typeName: 'simtac_general:simtac_ruta_calculada', outputFormat: 'application/json',
})) {
  comprueba(`parametrosFijos.${clave} = ${valor}`, rv.parametrosFijos?.[clave] === valor);
}
comprueba('viewparams son las 4 coordenadas a 12 decimales',
  rv.viewparams?.decimales === 12 &&
  ['origen_lon', 'origen_lat', 'destino_lon', 'destino_lat']
    .every((k) => rv.viewparams?.claves?.includes(k)));
comprueba('la respuesta documenta el recorrido ordenado v2',
  rv.respuesta?.geometria?.tipoCompatibilidad === 'MultiLineString' &&
  rv.respuesta?.geometria?.propiedadOrdenada === 'recorrido_geojson');
comprueba('concurrenciaRecomendada <= concurrenciaMax',
  rv.throughput?.concurrenciaRecomendada > 0 &&
  rv.throughput.concurrenciaRecomendada <= rv.throughput.concurrenciaMax);

// Metadatos: sin fecha no se sabe si el despliegue sigue vigente.
comprueba('_meta.actualizado es una fecha ISO válida',
  !Number.isNaN(Date.parse(cfg._meta?.actualizado ?? '')));

console.log(`\n${casos.filter(Boolean).length}/${casos.length} pruebas pasan`);
process.exit(casos.every(Boolean) ? 0 : 1);
