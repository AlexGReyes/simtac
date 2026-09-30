// Verifica la cadena de resolución de `src/config.js` sin navegador.
//
//   node pruebas/config.mjs
//
// Stubea `window` (sin Tauri, así degrada a localStorage) y `fetch` (para servir
// `src/config.json` desde el disco). No necesita el GeoServer ni el backend:
// prueba la precedencia entre orígenes y la validación de URLs, que es lo que
// se puede romper al editar un archivo de configuración.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// El valor esperado sale del propio archivo del despliegue: si mañana cambia la
// IP, la prueba sigue valiendo sin tener que editarla.
const DESPLIEGUE = JSON.parse(
  readFileSync(new URL('../src/config.json', import.meta.url), 'utf8'),
);

const casos = [];
function stub({ query = '', usuario = null, despliegue = true }) {
  globalThis.window = {
    location: { search: query },
    localStorage: {
      _d: usuario ? { 'simtac:config': JSON.stringify(usuario) } : {},
      getItem(k) { return this._d[k] ?? null; },
      setItem(k, v) { this._d[k] = v; },
      removeItem(k) { delete this._d[k]; },
    },
    __TAURI__: undefined, // fuera de Tauri: degrada a localStorage
  };
  globalThis.fetch = async (url) => {
    if (!despliegue) return { ok: false };
    const cuerpo = readFileSync(fileURLToPath(url), 'utf8');
    return { ok: true, json: async () => JSON.parse(cuerpo) };
  };
}

async function corre(nombre, escenario, esperado) {
  stub(escenario);
  const mod = await import(`../src/config.js?v=${Math.random()}`);
  await mod.cargar();
  const real = { backend: mod.backend(), geoserver: mod.geoserver(),
                 origenGeo: mod.origen('geoserver'), origenBack: mod.origen('backend'),
                 actualizaciones: mod.actualizaciones(), origenAct: mod.origen('actualizaciones') };
  const ok = Object.entries(esperado).every(([k, v]) => real[k] === v);
  casos.push(ok);
  console.log(`${ok ? 'OK  ' : 'FALLA'} ${nombre}`);
  if (!ok) console.log('   esperado:', esperado, '\n   real:', real);
}

console.log('--- silenciando avisos esperados ---');
const warn = console.warn; console.warn = () => {};

await corre('config.json del despliegue', {},
  { geoserver: DESPLIEGUE.geoserver, backend: DESPLIEGUE.backend,
    origenGeo: 'config.json del despliegue' });

await corre('query string gana sobre todo',
  { query: '?geoserver=http://172.200.1.17:3001/geoserver&backend=http://10.0.0.9:3000',
    usuario: { geoserver: 'http://otra:3001/geoserver' } },
  { geoserver: 'http://172.200.1.17:3001/geoserver', backend: 'http://10.0.0.9:3000',
    origenGeo: 'query string (?geoserver=)' });

await corre('config del usuario gana sobre el del despliegue',
  { usuario: { geoserver: 'http://10.0.0.5:3001/geoserver', backend: 'http://10.0.0.5:3000' } },
  { geoserver: 'http://10.0.0.5:3001/geoserver', backend: 'http://10.0.0.5:3000',
    origenGeo: 'config del usuario' });

await corre('valor invalido degrada al siguiente nivel',
  { usuario: { geoserver: 'http://10.0.0.5:3001/geoserver/rest' } },
  { geoserver: DESPLIEGUE.geoserver, origenGeo: 'config.json del despliegue' });

await corre('sin config.json quedan los valores por defecto',
  { despliegue: false },
  { geoserver: 'http://10.40.0.6:3001/geoserver', backend: 'http://10.40.0.6',
    origenGeo: 'valor por defecto' });

await corre('actualizaciones sigue al backend si nadie la fijó',
  { query: '?backend=http://10.0.0.9' },
  { actualizaciones: 'http://10.0.0.9/actualizaciones/latest.json', origenAct: 'valor por defecto' });

await corre('actualizaciones del config del usuario gana sobre el derivado',
  { usuario: { actualizaciones: 'http://repo.local/simtac/latest.json' } },
  { actualizaciones: 'http://repo.local/simtac/latest.json', origenAct: 'config del usuario' });


// Cambio de IP del backend por un administrador (`fijarBackend`): lo que vive
// en el mismo host lo sigue, lo que vive en otro se deja, y solo se guarda lo
// que eligió el usuario.
async function cambioDeBackend(nombre, escenario, nuevo, esperado) {
  stub(escenario);
  const mod = await import(`../src/config.js?v=${Math.random()}`);
  await mod.cargar();
  const { arrastrados } = mod.fijarBackend(nuevo);
  await new Promise((r) => setTimeout(r, 0)); // persistir() degrada a localStorage en un then
  const guardado = JSON.parse(window.localStorage.getItem('simtac:config') || '{}');
  const real = { backend: mod.backend(), geoserver: mod.geoserver(), actualizaciones: mod.actualizaciones(),
                 arrastrados: arrastrados.map((a) => a.clave).join(','), guardado: Object.keys(guardado).sort().join(',') };
  const ok = Object.entries(esperado).every(([k, v]) => real[k] === v);
  casos.push(ok);
  console.log(`${ok ? 'OK  ' : 'FALLA'} ${nombre}`);
  if (!ok) console.log('   esperado:', esperado, '\n   real:', real);
}

await cambioDeBackend('cambiar el backend arrastra el GeoServer del mismo host', {},
  'http://10.40.0.99',
  { backend: 'http://10.40.0.99', geoserver: 'http://10.40.0.99:3001/geoserver',
    actualizaciones: 'http://10.40.0.99/actualizaciones/latest.json',
    arrastrados: 'geoserver,actualizaciones', guardado: 'backend,geoserver' });

await cambioDeBackend('un GeoServer elegido en otra máquina se conserva',
  { usuario: { geoserver: 'http://10.9.9.9:3001/geoserver' } }, 'http://10.40.0.99',
  { geoserver: 'http://10.9.9.9:3001/geoserver', arrastrados: 'actualizaciones', guardado: 'backend,geoserver' });

await cambioDeBackend('un GeoServer del despliegue en otro host no queda clavado en el config',
  { query: '?geoserver=http://10.9.9.9:3001/geoserver' }, 'http://10.40.0.99',
  { geoserver: 'http://10.9.9.9:3001/geoserver', guardado: 'backend' });

await cambioDeBackend('actualizaciones fijada en el mismo host se mueve y conserva la ruta',
  { usuario: { actualizaciones: `${DESPLIEGUE.backend}/otra/latest.json` } }, 'http://10.40.0.99',
  { actualizaciones: 'http://10.40.0.99/otra/latest.json', guardado: 'actualizaciones,backend,geoserver' });

await cambioDeBackend('URL inválida no cambia nada',
  {}, 'ftp://x',
  { backend: DESPLIEGUE.backend }).catch(() => {
    casos.push(true);
    console.log('OK   URL inválida lanza y no cambia nada');
  });

console.warn = warn;

// Validación puntual
const { urlSegura } = await import('../src/config.js');
const rechazos = [
  ['ftp://x/geoserver', 'protocolo'],
  ['http://u:p@x/geoserver', 'credenciales'],
  ['http://x/geoserver?a=1', 'query'],
  ['http://x/geoserver/rest', 'ruta rest'],
  ['http://x/geoserver/%72est', 'rest percent-encoded'],
];
for (const [valor, motivo] of rechazos) {
  let tiro = false;
  try { urlSegura(valor, { prohibirRest: true }); } catch { tiro = true; }
  casos.push(tiro);
  console.log(`${tiro ? 'OK  ' : 'FALLA'} rechaza ${motivo}`);
}
const normalizada = urlSegura('http://10.40.0.24:3001/geoserver/', { prohibirRest: true });
casos.push(normalizada === 'http://10.40.0.24:3001/geoserver');
console.log(`${normalizada === 'http://10.40.0.24:3001/geoserver' ? 'OK  ' : 'FALLA'} normaliza la barra final`);

console.log(`\n${casos.filter(Boolean).length}/${casos.length} pruebas pasan`);
process.exit(casos.every(Boolean) ? 0 : 1);
