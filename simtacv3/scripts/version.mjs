// Estampa la versión de la app: fecha y hora de compilación, en hora local.
// La misma marca de tiempo se escribe de dos formas:
//
//   version  `AAAA.MM.DD-HHMM` (ej. `2026.09.29-1045`) — la que se ve en el login.
//   semver   `AAAA.MMDD.HHMM` sin ceros a la izquierda (ej. `2026.929.1045`) —
//            la que compara el actualizador (tiene que ser semver). Crece con
//            el tiempo, así que cada compilación es "más nueva" sin numerar a mano.
//
// Escribe `src/version.json`, que leen el login y el actualizador. Corre solo
// antes de `npm run tauri dev` / `tauri build` (`beforeDevCommand` /
// `beforeBuildCommand` en `src-tauri/tauri.conf.json`), y a mano con
// `npm run build:version` después de cualquier cambio de código.
//
// `npm run compilar` fija la marca con la variable SIMTAC_COMPILADO (ISO) para
// que la versión del instalador y la de `version.json` sean la misma aunque
// `beforeBuildCommand` corra un rato después.
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dos = (n) => String(n).padStart(2, '0');

export function calcularVersion(fecha = new Date()) {
  const [a, m, d, h, min] = [fecha.getFullYear(), fecha.getMonth() + 1, fecha.getDate(), fecha.getHours(), fecha.getMinutes()];
  return {
    version: `${a}.${dos(m)}.${dos(d)}-${dos(h)}${dos(min)}`,
    semver: `${a}.${m * 100 + d}.${h * 100 + min}`,
    compilado: fecha.toISOString(),
  };
}

export function estamparVersion(fecha = new Date()) {
  const datos = calcularVersion(fecha);
  const destino = fileURLToPath(new URL('../src/version.json', import.meta.url));
  writeFileSync(destino, `${JSON.stringify(datos, null, 2)}\n`);
  return datos;
}

// Ejecutado como script (no importado).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fijada = process.env.SIMTAC_COMPILADO ? new Date(process.env.SIMTAC_COMPILADO) : new Date();
  const { version, semver } = estamparVersion(fijada);
  console.log(`[version] ${version} (semver ${semver})`);
}
