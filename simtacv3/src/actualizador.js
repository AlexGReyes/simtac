// Actualización obligatoria al abrir la app, antes del login.
//
// Política del ejercicio: todos los equipos con la MISMA versión. Si la
// versión publicada en el servidor (`latest.json`, URL de
// `Config.actualizaciones()`) es distinta de la instalada, se instala sin
// preguntar: la pantalla solo informa el progreso. No hay "después".
//
// El trabajo pesado es de Rust (`buscar_actualizacion` /
// `instalar_actualizacion` en `lib.rs`, con tauri-plugin-updater): descarga,
// verifica la firma, instala y reinicia. Solo corre dentro de Tauri y en
// builds de release; en el navegador o en `tauri dev` no hace nada.
//
// Si el servidor de actualizaciones no responde, la app SIGUE: un servidor
// caído no puede dejar a todo el ejercicio sin poder entrar. Se avisa y listo.
import Config from './config.js';
import { esc, toastAviso } from './ui.js';

function invocar(comando, args) {
  return window.__TAURI__.core.invoke(comando, args);
}

/** `2026.929.1156` (semver del instalador) → `2026.09.29-1156` (la del login). */
export function versionLegible(semver) {
  const m = /^(\d{4})\.(\d{1,4})\.(\d{1,4})$/.exec(String(semver ?? ''));
  if (!m) return String(semver ?? '?');
  const [, anio, mesDia, horaMin] = m;
  const md = mesDia.padStart(4, '0');
  const hm = horaMin.padStart(4, '0');
  return `${anio}.${md.slice(0, 2)}.${md.slice(2)}-${hm}`;
}

function pantalla() {
  let el = document.getElementById('actualizacion-screen');
  if (!el) {
    el = document.createElement('div');
    el.id = 'actualizacion-screen';
    el.className = 'actualizacion-screen';
    document.body.appendChild(el);
  }
  return el;
}

function formatearMB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Descarga e instala; al terminar la app se reinicia sola (no vuelve). */
async function instalar(info) {
  const el = pantalla();
  el.innerHTML = `
    <div class="actualizacion-caja">
      <h1>ACTUALIZACIÓN OBLIGATORIA</h1>
      <p class="actualizacion-motivo">Todos los equipos del ejercicio deben usar la misma versión.</p>
      <p class="actualizacion-versiones">
        Instalada <strong>${esc(versionLegible(info.versionActual))}</strong>
        → publicada <strong>${esc(versionLegible(info.version))}</strong>
      </p>
      ${info.notas ? `<p class="actualizacion-notas">${esc(info.notas)}</p>` : ''}
      <div class="actualizacion-barra"><div class="actualizacion-barra-relleno"></div></div>
      <p class="actualizacion-estado">Descargando…</p>
    </div>
  `;
  const relleno = el.querySelector('.actualizacion-barra-relleno');
  const estado = el.querySelector('.actualizacion-estado');

  let total = null;
  let recibidos = 0;
  const canal = new window.__TAURI__.core.Channel();
  canal.onmessage = ({ evento, datos }) => {
    if (evento === 'inicio') {
      total = datos.total ?? null;
    } else if (evento === 'avance') {
      recibidos += datos.bytes;
      if (total) {
        relleno.style.width = `${Math.min(100, (recibidos / total) * 100).toFixed(1)}%`;
        estado.textContent = `Descargando… ${formatearMB(recibidos)} de ${formatearMB(total)}`;
      } else {
        estado.textContent = `Descargando… ${formatearMB(recibidos)}`;
      }
    } else if (evento === 'fin') {
      relleno.style.width = '100%';
      estado.textContent = 'Verificado. Instalando: la aplicación se va a reiniciar…';
    }
  };

  try {
    await invocar('instalar_actualizacion', { progreso: canal });
  } catch (error) {
    // Firma inválida, instalador corrupto, sin espacio... No se sigue con una
    // versión distinta a la del resto: se ofrece reintentar.
    const firmaInvalida = /signature/i.test(String(error));
    estado.textContent = firmaInvalida
      ? 'No se pudo instalar: la firma del instalador no es válida (no fue generado con la clave oficial). Avisá al administrador.'
      : `No se pudo instalar: ${error}`;
    estado.classList.add('error');
    const reintentar = document.createElement('button');
    reintentar.className = 'actualizacion-btn';
    reintentar.textContent = 'Reintentar';
    reintentar.addEventListener('click', () => verificarAlArrancar());
    el.querySelector('.actualizacion-caja').appendChild(reintentar);
    await new Promise(() => {}); // se queda acá hasta reintentar o cerrar
  }
}

/**
 * Llamar al arrancar, con la configuración ya cargada y antes del login. Si
 * hay que actualizar no vuelve (la app se reinicia); si no, resuelve y el
 * arranque sigue.
 */
export async function verificarAlArrancar() {
  if (!window.__TAURI__?.core?.invoke) return; // navegador: no hay instalador

  let info;
  try {
    info = await invocar('buscar_actualizacion', { url: Config.actualizaciones() });
  } catch (error) {
    console.warn('[actualizador] no se pudo consultar', Config.actualizaciones(), '—', error);
    toastAviso('No se pudo verificar si hay actualizaciones. Se continúa con la versión instalada.');
    return;
  }
  if (!info) {
    console.info('[actualizador] versión al día');
    return;
  }
  console.info(`[actualizador] ${info.versionActual} → ${info.version}`);
  await instalar(info);
}

export default { verificarAlArrancar, versionLegible };
