// Publica una versión ya compilada en el servidor de actualizaciones por
// SSH/SFTP (contrato en PEDIDO_SERVIDOR_ACTUALIZACIONES.md §1–§3).
//
//   npm run subir                         # sube .exe + .sig de src/version.json (sin publicar)
//   npm run subir -- --publicar           # ...y reemplaza latest.json: queda vigente
//   npm run subir -- --publicar --version 2026.929.1157   # volver atrás a una ya compilada
//   npm run subir -- --registrar-host     # fija la clave del host del servidor (una vez)
//   npm run compilar -- --subir [--publicar]              # compila y sube en un paso
//
// Destino y credenciales: `config/actualizaciones-ssh.json` (sin secretos) +
// la clave privada de `~/.ssh/simtac_publicador`. La clave del HOST se fija en
// `config/actualizaciones_known_hosts` y se exige (StrictHostKeyChecking=yes):
// nunca se sube a un servidor que no es el registrado.
//
// Orden de publicación (para que ningún cliente vea un estado a medias):
//   1. archivos/<exe>.part y .sig.part → rename al nombre final;
//   2. latest.json.part → rename a latest.json (atómico). Recién ahí los
//      clientes ven la versión nueva. Sin `--publicar` no se toca latest.json.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const TAURI = path.join(RAIZ, 'src-tauri');

/** Marcador que el nginx del servidor reemplaza por el origen de cada request (§1.3). */
export const MARCADOR_BASE = '__SIMTAC_BASE__';

// ---------------------------------------------------------------------------
// Artefactos y manifiesto
// ---------------------------------------------------------------------------

/** Ruta del instalador y su .sig para una versión semver ya compilada. */
export function artefactos(semver) {
  const producto = JSON.parse(readFileSync(path.join(TAURI, 'tauri.conf.json'), 'utf8')).productName;
  const nombre = `${producto}_${semver}_x64-setup.exe`;
  const instalador = path.join(TAURI, 'target', 'release', 'bundle', 'nsis', nombre);
  return { nombre, instalador, firma: `${instalador}.sig` };
}

/** `2026.929.1157` → `2026.09.29-1157` (la versión que se ve en el login). */
export function versionLegible(semver) {
  const m = /^(\d{4})\.(\d{1,4})\.(\d{1,4})$/.exec(semver);
  if (!m) return semver;
  const md = m[2].padStart(4, '0');
  return `${m[1]}.${md.slice(0, 2)}.${md.slice(2)}-${m[3].padStart(4, '0')}`;
}

/**
 * `latest.json` del updater de Tauri. La `url` lleva el marcador en lugar del
 * origen: la IP del servidor cambia y la pone nginx al servirlo (§1.3).
 */
export function manifiesto({ semver, notas, fecha = new Date() }) {
  const { nombre, firma } = artefactos(semver);
  return {
    version: semver,
    notes: notas || `Versión ${versionLegible(semver)}`,
    pub_date: fecha.toISOString(),
    platforms: {
      'windows-x86_64': {
        signature: readFileSync(firma, 'utf8').trim(),
        url: `${MARCADOR_BASE}/actualizaciones/archivos/${encodeURIComponent(nombre)}`,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Destino SSH
// ---------------------------------------------------------------------------

function expandir(ruta) {
  return ruta.startsWith('~') ? path.join(homedir(), ruta.slice(1)) : path.resolve(RAIZ, ruta);
}

export function destinoSsh({ servidor = null } = {}) {
  const archivo = JSON.parse(readFileSync(path.join(RAIZ, 'config', 'actualizaciones-ssh.json'), 'utf8'));
  const despliegue = JSON.parse(readFileSync(path.join(RAIZ, 'src', 'config.json'), 'utf8'));
  const e = process.env;
  const host = servidor || e.SIMTAC_SSH_HOST || archivo.host || new URL(despliegue.backend).hostname;
  return {
    host,
    puerto: Number(e.SIMTAC_SSH_PUERTO || archivo.puerto || 22),
    usuario: e.SIMTAC_SSH_USUARIO || archivo.usuario,
    ruta: (e.SIMTAC_SSH_RUTA || archivo.ruta).replace(/\/+$/, ''),
    clave: expandir(e.SIMTAC_SSH_CLAVE || archivo.clave),
    knownHosts: expandir(e.SIMTAC_SSH_KNOWN_HOSTS || archivo.knownHosts),
  };
}

function opcionesSsh(d) {
  return [
    '-i', d.clave,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes',                       // nunca pedir contraseña: solo clave
    '-o', 'StrictHostKeyChecking=yes',           // host no registrado = no se sube
    '-o', `UserKnownHostsFile=${d.knownHosts}`,
    '-o', 'ConnectTimeout=15',
  ];
}

/** Corre un lote de comandos sftp. Lanza con la salida si falla. */
function sftp(d, comandos) {
  const dir = mkdtempSync(path.join(tmpdir(), 'simtac-sftp-'));
  const lote = path.join(dir, 'lote.txt');
  writeFileSync(lote, `${comandos.join('\n')}\n`);
  try {
    const r = spawnSync('sftp', [...opcionesSsh(d), '-P', String(d.puerto), '-b', lote, `${d.usuario}@${d.host}`],
      { encoding: 'utf8' });
    if (r.error) throw new Error(`No se pudo ejecutar sftp: ${r.error.message}`);
    if (r.status !== 0) {
      const salida = `${r.stderr || ''}${r.stdout || ''}`.trim();
      if (/Host key verification failed|No .* host key is known/i.test(salida)) {
        throw new Error(`La clave del host ${d.host} no está registrada o CAMBIÓ.\n` +
          '         Si es la primera vez: npm run subir -- --registrar-host\n' +
          '         Si ya estaba registrada: NO seguir sin confirmar con el backend (posible servidor impostor).');
      }
      throw new Error(`sftp falló (código ${r.status}):\n${salida}`);
    }
    return r.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Comillas para rutas del lote sftp. */
const q = (s) => `"${String(s).replace(/\\/g, '/').replace(/"/g, '\\"')}"`;

// ---------------------------------------------------------------------------
// Operaciones
// ---------------------------------------------------------------------------

/**
 * Sube .exe + .sig de `semver`; con `publicar`, reemplaza además latest.json.
 * Lanza con un motivo legible si algo falla.
 */
export async function subirVersion({ semver, notas = null, publicar = false, servidor = null }) {
  const d = destinoSsh({ servidor });
  const { nombre, instalador, firma } = artefactos(semver);
  if (!existsSync(instalador) || !existsSync(firma)) {
    throw new Error(`No está compilada la versión ${semver}: falta ${instalador} o su .sig`);
  }
  if (!existsSync(d.clave)) throw new Error(`Falta la clave SSH privada: ${d.clave}`);
  if (!existsSync(d.knownHosts)) {
    throw new Error(`Falta ${d.knownHosts}: registrar primero la clave del host con\n` +
      '         npm run subir -- --registrar-host');
  }

  const remoto = `${d.ruta}/archivos`;
  const comandos = [
    `-mkdir ${q(remoto)}`,                                  // '-' = no falla si ya existe
    `put ${q(instalador)} ${q(`${remoto}/${nombre}.part`)}`,
    `rename ${q(`${remoto}/${nombre}.part`)} ${q(`${remoto}/${nombre}`)}`,
    `put ${q(firma)} ${q(`${remoto}/${nombre}.sig.part`)}`,
    `rename ${q(`${remoto}/${nombre}.sig.part`)} ${q(`${remoto}/${nombre}.sig`)}`,
  ];

  let temporal = null;
  if (publicar) {
    temporal = mkdtempSync(path.join(tmpdir(), 'simtac-latest-'));
    const local = path.join(temporal, 'latest.json');
    writeFileSync(local, `${JSON.stringify(manifiesto({ semver, notas }), null, 2)}\n`);
    comandos.push(
      `put ${q(local)} ${q(`${d.ruta}/latest.json.part`)}`,
      // OpenSSH usa posix-rename: reemplaza el destino de forma atómica.
      `rename ${q(`${d.ruta}/latest.json.part`)} ${q(`${d.ruta}/latest.json`)}`,
    );
  }

  console.log(`[subir] ${nombre} → ${d.usuario}@${d.host}:${d.puerto}${remoto}/`);
  try {
    sftp(d, comandos);
  } finally {
    if (temporal) rmSync(temporal, { recursive: true, force: true });
  }
  console.log('[subir] instalador y firma subidos.');
  if (publicar) {
    console.log(`[subir] latest.json → ${semver} (${versionLegible(semver)}): es la vigente.`);
    console.log('        Todos los equipos se actualizan al próximo arranque.');
  } else {
    console.log('[subir] latest.json NO se tocó: los clientes siguen en la versión anterior.');
    console.log(`        Para publicarla: npm run subir -- --publicar --version ${semver}`);
  }
}

/**
 * Trae la clave del host con ssh-keyscan, muestra la huella y, si el operador
 * confirma que coincide con la informada por el backend, la guarda.
 */
export async function registrarHost({ servidor = null } = {}) {
  const d = destinoSsh({ servidor });
  const scan = spawnSync('ssh-keyscan', ['-p', String(d.puerto), '-t', 'ed25519', d.host], { encoding: 'utf8' });
  const linea = (scan.stdout || '').split('\n').find((l) => l.trim() && !l.startsWith('#'));
  if (!linea) throw new Error(`ssh-keyscan no obtuvo clave de ${d.host}:${d.puerto}\n${scan.stderr || ''}`);

  const dir = mkdtempSync(path.join(tmpdir(), 'simtac-kh-'));
  writeFileSync(path.join(dir, 'k'), `${linea}\n`);
  const huella = spawnSync('ssh-keygen', ['-lf', path.join(dir, 'k')], { encoding: 'utf8' }).stdout.trim();
  rmSync(dir, { recursive: true, force: true });

  console.log(`Clave del host ${d.host}:${d.puerto}:\n  ${huella}`);
  console.log('Compararla con la huella de RESPUESTA_PEDIDO_SERVIDOR_ACTUALIZACIONES.md.');
  const ok = process.env.SIMTAC_SSH_CONFIRMAR_HOST === 'si'
    || (process.stdin.isTTY && /^s/i.test(await new Promise((res) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('¿Coincide? (s/N) ', (r) => { rl.close(); res(r); });
    })));
  if (!ok) throw new Error('No se registró: sin confirmación de la huella.');

  mkdirSync(path.dirname(d.knownHosts), { recursive: true });
  writeFileSync(d.knownHosts, `${linea}\n`);
  console.log(`Registrada en ${path.relative(RAIZ, d.knownHosts)}.`);
}

export function leerArgumentos(argv = process.argv) {
  const valor = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
  return {
    notas: valor('notas'),
    servidor: valor('servidor'),
    version: valor('version'),
    publicar: argv.includes('--publicar'),
    subir: argv.includes('--subir'),
    registrarHost: argv.includes('--registrar-host'),
  };
}

// Ejecutado como script.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = leerArgumentos();
  const tarea = a.registrarHost
    ? registrarHost({ servidor: a.servidor })
    : subirVersion({
      semver: a.version || JSON.parse(readFileSync(path.join(RAIZ, 'src', 'version.json'), 'utf8')).semver,
      notas: a.notas,
      publicar: a.publicar,
      servidor: a.servidor,
    });
  tarea.catch((error) => {
    console.error(`[subir] ${error.message}`);
    process.exit(1);
  });
}
