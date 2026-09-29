// Compila el instalador de release firmado y deja listo el paquete de
// actualización para publicar.
//
//   npm run compilar -- --notas "Corrige el encuadre"
//   npm run compilar -- --notas "Corrige el encuadre" --subir              # sube, sin publicar
//   npm run compilar -- --notas "Corrige el encuadre" --subir --publicar   # sube y queda vigente
//
// 1. Fija la marca de tiempo de compilación y estampa `src/version.json`.
// 2. Corre `tauri build` con esa versión en semver (sin tocar el
//    `tauri.conf.json` versionado: va como `--config` en un archivo temporal).
// 3. Firma con la clave privada de `~/.tauri/simtacv3.key` (o la que diga
//    TAURI_SIGNING_PRIVATE_KEY_PATH). La clave NUNCA va al repo.
// 4. Arma `publicar/actualizaciones/` con la MISMA estructura que la carpeta
//    del servidor (`latest.json` + `archivos/`), por si hay que copiarla a mano.
// 5. Con `--subir`, la publica por SSH/SFTP (`subir.mjs`); con `--publicar`
//    además reemplaza `latest.json` y todos los equipos se actualizan al
//    próximo arranque. Si la subida falla, la compilación no se pierde:
//    `npm run subir` reintenta solo esa parte.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { estamparVersion } from './version.mjs';
import { artefactos, leerArgumentos, manifiesto, subirVersion } from './subir.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const TAURI = path.join(RAIZ, 'src-tauri');
const opciones = leerArgumentos();
const { notas } = opciones;

const clave = process.env.TAURI_SIGNING_PRIVATE_KEY_PATH || path.join(homedir(), '.tauri', 'simtacv3.key');
if (!process.env.TAURI_SIGNING_PRIVATE_KEY && !existsSync(clave)) {
  console.error(`[compilar] Falta la clave privada de firma: ${clave}\n` +
    '           Sin ella no se puede firmar la actualización y los clientes la rechazarían.');
  process.exit(1);
}

const ahora = new Date();
const { version, semver } = estamparVersion(ahora);
console.log(`[compilar] versión ${version} (semver ${semver})`);

const configTemporal = path.join(TAURI, 'tauri.version.json');
writeFileSync(configTemporal, JSON.stringify({ version: semver }));

const entorno = {
  ...process.env,
  SIMTAC_COMPILADO: ahora.toISOString(),
  TAURI_SIGNING_PRIVATE_KEY: process.env.TAURI_SIGNING_PRIVATE_KEY || readFileSync(clave, 'utf8'),
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '',
};
// Una sola línea de comando (no array de argumentos + shell): en Windows `npx`
// es un .cmd y necesita shell, y así no se concatenan argumentos sin escapar.
const build = spawnSync(`npx tauri build --config "${configTemporal}"`, {
  cwd: RAIZ, env: entorno, stdio: 'inherit', shell: true,
});
rmSync(configTemporal, { force: true });
if (build.status !== 0) {
  console.error('[compilar] tauri build falló');
  process.exit(build.status ?? 1);
}

const { nombre, instalador, firma } = artefactos(semver);
if (!existsSync(instalador) || !existsSync(firma)) {
  console.error(`[compilar] No se encontró ${instalador} o su .sig`);
  process.exit(1);
}

// Misma estructura que la carpeta del servidor (PEDIDO_SERVIDOR_ACTUALIZACIONES.md §1.2).
const destino = path.join(RAIZ, 'publicar', 'actualizaciones');
rmSync(destino, { recursive: true, force: true });
mkdirSync(path.join(destino, 'archivos'), { recursive: true });
copyFileSync(instalador, path.join(destino, 'archivos', nombre));
copyFileSync(firma, path.join(destino, 'archivos', `${nombre}.sig`));
writeFileSync(path.join(destino, 'latest.json'),
  `${JSON.stringify(manifiesto({ semver, notas, fecha: ahora }), null, 2)}
`);
console.log(`
[compilar] Listo: ${destino}`);

if (opciones.subir) {
  try {
    await subirVersion({ semver, notas, publicar: opciones.publicar, servidor: opciones.servidor });
  } catch (error) {
    console.error(`[compilar] La compilación quedó lista pero la subida falló: ${error.message}`);
    console.error(`           Reintentar solo la subida con: npm run subir -- --version ${semver}` +
      (opciones.publicar ? ' --publicar' : ''));
    process.exit(1);
  }
}
