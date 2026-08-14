// Punto de entrada de simtac.
//
// Une las fases del frontend en un solo arranque:
//   0 sesión + cliente HTTP/socket · 1 login y elección de ejercicio ·
//   2 configuración (modal de administración) · 3 mapa en vivo · 4 movimiento ·
//   5 detección · 6 combate · 7 comunicaciones · 8 dirección.
//
// Acá no hay lógica de negocio: solo orquestación de módulos y los listeners de
// ciclo de vida del ejercicio (estado_inicial, estado_cambiado, sesión, red).

import Session from './session.js';
import Api from './api.js';
import Socket from './socket.js';
import Store from './store.js';
import LoginUI from './login-ui.js';
import EjerciciosUI from './ejercicios-ui.js';
import Mapa from './mapa.js';
import PanelEntidad from './panel-entidad.js';
import Movimiento from './movimiento.js';
import Deteccion from './deteccion.js';
import Combate from './combate.js';
import Comunicaciones from './comunicaciones.js';
import Logistica from './logistica.js';
import MisUnidades from './mis-unidades.js';
import Direccion from './direccion.js';
import Catalogos from './config-catalogos.js';
import { toast, toastAviso, toastError } from './ui.js';

let modulosIniciados = false;
let relojes = null;

// ---------------------------------------------------------------------------
// Cabecera
// ---------------------------------------------------------------------------

function actualizarUsuario() {
  const usuario = Session.getUser();
  if (!usuario) return;

  const nombre = document.querySelector('.username');
  if (nombre) nombre.textContent = usuario.nombre || usuario.usuario || '';
  const rol = document.querySelector('.role');
  if (rol) rol.textContent = `${usuario.grado || 'Operador'} · ${usuario.rol || ''}`;
}

/**
 * El servidor manda `ejercicio.hora_tactica` autoritativa, ya pausada/
 * acelerada según corresponda (backend.md, punto 20) — se pinta tal cual
 * llega, sin recalcular nada acá. `registrarEventosDelEjercicio()` la
 * mantiene al día escuchando `ejercicio:hora_tactica`.
 *
 * Si todavía no hay ejercicio (pantalla de selección) o el estado es de
 * antes de que este campo existiera, se cae a la aproximación vieja
 * (hora local + offset de huso horario) para no mostrar el reloj vacío.
 */
function horaTacticaActual(ahora) {
  const cruda = Store.estado?.ejercicio?.hora_tactica;
  if (cruda) {
    const parseada = new Date(cruda);
    if (!Number.isNaN(parseada.getTime())) return parseada;
  }
  return new Date(ahora.getTime() + ahora.getTimezoneOffset() * 60000);
}

function actualizarRelojes() {
  const ahora = new Date();
  const hhmmss = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  const ddmmyy = { day: '2-digit', month: '2-digit', year: 'numeric' };

  const escribir = (id, texto) => {
    const el = document.getElementById(id);
    if (el) el.textContent = texto;
  };
  escribir('local-time', ahora.toLocaleTimeString('es-ES', hhmmss));
  escribir('local-date', ahora.toLocaleDateString('es-ES', ddmmyy));

  const horaTactica = horaTacticaActual(ahora);
  escribir('tactica-time', horaTactica.toLocaleTimeString('es-ES', hhmmss));
  escribir('tactica-date', horaTactica.toLocaleDateString('es-ES', ddmmyy));
}

/**
 * Overlay a pantalla completa mientras el ejercicio está pausado — solo para
 * jugadores: la dirección lo pausó y necesita seguir viendo el mapa/panel
 * para poder reanudarlo. Desaparece solo al volver a `activo`.
 */
function actualizarOverlayPausa() {
  const el = document.getElementById('pausa-overlay');
  if (!el) return;
  el.hidden = Session.esAdmin() || Store.estadoEjercicio() !== 'pausado';
}

/** Indicador de estado del ejercicio: activo / pausado / detenido (fase 3). */
function actualizarIndicadorEjercicio() {
  const el = document.getElementById('ejercicio-indicador');
  if (!el) return;
  const ejercicio = Store.estado.ejercicio;
  if (!ejercicio) {
    el.className = 'ejercicio-indicador';
    el.innerHTML = '<span class="ei-punto"></span><span class="ei-texto">Sin ejercicio</span>';
    return;
  }
  const estado = ejercicio.estado || 'sin iniciar';
  const bando = Session.esAdmin() ? 'DIRECCIÓN' : (Store.bando || 'sin bando');
  el.className = `ejercicio-indicador estado-${estado}`;
  el.innerHTML = `
    <span class="ei-punto"></span>
    <span class="ei-texto">${ejercicio.nombre || `Ejercicio ${ejercicio.id}`}</span>
    <span class="ei-estado">${estado}</span>
    <span class="ei-bando bando-${String(bando).toLowerCase()}">${bando}</span>
  `;
}

function actualizarIndicadorRed(conectado) {
  const el = document.getElementById('red-indicador');
  if (!el) return;
  el.classList.toggle('caido', !conectado);
  el.title = conectado ? 'Conectado al servidor' : 'Sin conexión con el servidor';
}

// ---------------------------------------------------------------------------
// Barra de herramientas del mapa
// ---------------------------------------------------------------------------

function inicializarBarraMapa() {
  document.getElementById('mapa-encuadrar')?.addEventListener('click', () => Mapa.encuadrarTodo());

  const botonRangos = document.getElementById('mapa-rangos');
  botonRangos?.addEventListener('click', () => {
    const visibles = Mapa.alternarRangos();
    botonRangos.classList.toggle('activo', visibles);
  });

  document.getElementById('mapa-cambiar-ejercicio')?.addEventListener('click', () => volverASeleccion());

  // Zoom y coordenadas bajo el cursor.
  const mapa = Mapa.instancia();
  if (!mapa) return;
  const zoomEl = document.getElementById('zoom-level');
  const coordEl = document.getElementById('mouse-coordinates');

  const pintarZoom = () => {
    if (zoomEl) zoomEl.textContent = `Zoom: ${mapa.getView().getZoom().toFixed(2)}`;
  };
  mapa.getView().on('change:resolution', pintarZoom);
  pintarZoom();

  mapa.on('pointermove', (evento) => {
    if (!coordEl || evento.dragging) return;
    // x es longitud, y es latitud: se muestran en ese orden en todo el sistema.
    const [x, y] = ol.proj.toLonLat(evento.coordinate);
    coordEl.textContent = `x ${x.toFixed(5)}° · y ${y.toFixed(5)}°`;
  });
}

/** Chat y bandeja de documentos son paneles flotantes: los abre esta capa. */
function inicializarPanelesComunicaciones() {
  const expandido = document.getElementById('chat-expanded');
  document.getElementById('chat-minimized')?.addEventListener('click', () => expandido?.classList.add('active'));
  document.getElementById('chat-minimize-btn')?.addEventListener('click', (evento) => {
    evento.stopPropagation();
    expandido?.classList.remove('active');
  });

  const docs = document.getElementById('docs-modal');
  document.getElementById('docs-btn')?.addEventListener('click', () => docs?.classList.toggle('active'));
  document.getElementById('docs-modal-close')?.addEventListener('click', () => docs?.classList.remove('active'));

  // Los boletines son un panel de consulta solo para jugadores: el admin ya
  // los ve (y los redacta) en el panel de dirección.
  const boletines = document.getElementById('boletines-modal');
  const botonBoletines = document.getElementById('boletines-btn');
  if (botonBoletines) {
    botonBoletines.style.display = Session.esAdmin() ? 'none' : 'flex';
    botonBoletines.addEventListener('click', () => {
      boletines?.classList.toggle('active');
      if (boletines?.classList.contains('active')) Comunicaciones.Boletines.renderLista();
    });
  }
  document.getElementById('boletines-modal-close')?.addEventListener('click', () => boletines?.classList.remove('active'));

  // "Mis unidades" es para ubicarse en el mapa: el admin ya tiene la lista
  // completa (con arrastre y edición) en el panel de dirección.
  const botonMisUnidades = document.getElementById('mis-unidades-btn');
  if (botonMisUnidades) {
    botonMisUnidades.style.display = Session.esAdmin() ? 'none' : 'flex';
    botonMisUnidades.addEventListener('click', () => MisUnidades.abrir());
  }

  document.getElementById('logistica-btn')?.addEventListener('click', () => Logistica.abrir());
}

// ---------------------------------------------------------------------------
// Ciclo de vida del ejercicio
// ---------------------------------------------------------------------------

/**
 * `ejercicio:estado_inicial` NO es solo la respuesta a `unirse`: también llega
 * al iniciar, al restaurar un estado, al confirmar un rebobinado y al cambiar de
 * ejercicio. Siempre se trata como reemplazo total, nunca como merge.
 */
function alRecibirEstadoInicial(estado) {
  const primeraCarga = !Store.estado.ejercicio;
  Store.reemplazarEstado(estado);
  EjerciciosUI.ocultar();
  actualizarIndicadorEjercicio();
  actualizarOverlayPausa();
  if (primeraCarga) Mapa.encuadrarTodo();
}

function registrarEventosDelEjercicio() {
  Socket.on('ejercicio:estado_inicial', alRecibirEstadoInicial);

  Socket.on('ejercicio:estado_cambiado', ({ estado, estado_anterior }) => {
    Store.setEstadoEjercicio(estado);
    actualizarIndicadorEjercicio();
    actualizarOverlayPausa();
    const aviso = {
      activo: '▶ El ejercicio está en marcha',
      pausado: '⏸ El ejercicio fue pausado: no se puede mover ni combatir',
      detenido: '⏹ El ejercicio fue detenido',
    };
    toastAviso(aviso[estado] || `Estado del ejercicio: ${estado_anterior} → ${estado}`);
  });

  // Un tick por segundo real del motor (backend.md, punto 20) mientras el
  // ejercicio está activo; deja de llegar solo mientras está pausado, así
  // que no hace falta congelar nada del lado del cliente.
  Socket.on('ejercicio:hora_tactica', ({ hora_tactica, velocidad_ejercicio }) => {
    if (!Store.estado.ejercicio) return;
    Store.estado.ejercicio.hora_tactica = hora_tactica;
    if (velocidad_ejercicio !== undefined) Store.estado.ejercicio.velocidad_ejercicio = velocidad_ejercicio;
  });

  Store.on('ejercicio:estado', actualizarIndicadorEjercicio);
  Store.on('estado', actualizarIndicadorEjercicio);
  Store.on('ejercicio:contexto', actualizarIndicadorEjercicio);
  Store.on('ejercicio:estado', actualizarOverlayPausa);
  Store.on('estado', actualizarOverlayPausa);
  Store.on('ejercicio:contexto', actualizarOverlayPausa);
}

function registrarEventosDeRed() {
  window.addEventListener('simtac:socket-conectado', () => actualizarIndicadorRed(true));
  window.addEventListener('simtac:socket-desconectado', () => {
    actualizarIndicadorRed(false);
    toastAviso('Se perdió la conexión con el servidor. Reintentando...');
  });

  // El backend emite `error` ADEMÁS del ack: acá solo se atienden los casos que
  // cambian de pantalla, el mensaje al usuario lo muestra quien hizo el emit.
  window.addEventListener('simtac:socket-error', (evento) => {
    const mensaje = evento.detail?.error || '';
    if (/no particip/i.test(mensaje)) {
      toastError('No participás en ese ejercicio: volvés a la selección');
      volverASeleccion();
    }
  });

  window.addEventListener('simtac:sesion-expirada', () => {
    toastError('La sesión expiró. Hay que volver a ingresar.');
    setTimeout(() => cerrarSesion(), 1200);
  });

  // Al reconectar, socket.js rehace el join; el estado llega de nuevo entero.
  Socket.alVolverAUnirse((respuesta) => {
    actualizarIndicadorRed(true);
    if (respuesta?.bando !== undefined) {
      Store.setEjercicio(Store.ejercicioId, { bando: respuesta.bando, iniciado: !!respuesta.iniciado });
    }
  });
}

/** Vuelve a la pantalla de selección sin cerrar la sesión. */
function volverASeleccion() {
  Socket.olvidarEjercicio();
  Store.limpiar();
  Session.setEjercicioId(null);
  Mapa.limpiarTrayectos();
  actualizarIndicadorEjercicio();
  actualizarOverlayPausa();
  EjerciciosUI.mostrar();
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

function iniciarModulos() {
  if (modulosIniciados) return;
  modulosIniciados = true;

  Socket.conectar();

  Mapa.init('map-container');       // fase 3
  PanelEntidad.init();              // fase 3
  Movimiento.init();                // fase 4
  Deteccion.init();                 // fase 5
  Combate.init();                   // fase 6
  Comunicaciones.init();            // fase 7
  Logistica.init();                 // logística: km, munición, bajas y destruidos
  MisUnidades.init();                // panel de jugador: ubicar lo propio en el mapa
  Direccion.init();                 // fase 8 (no hace nada si no sos admin)
  Catalogos.init();                 // fase 2 (catálogos que faltaban en admin.js)

  registrarEventosDelEjercicio();
  registrarEventosDeRed();
  inicializarBarraMapa();
  inicializarPanelesComunicaciones();
  inicializarModalAdmin();

  actualizarUsuario();
  actualizarRelojes();
  if (!relojes) relojes = setInterval(actualizarRelojes, 1000);
  actualizarIndicadorEjercicio();
  actualizarOverlayPausa();
  actualizarIndicadorRed(Socket.conectado());

  document.getElementById('logout-btn')?.addEventListener('click', cerrarSesion);
}

/** Fase 2: el CRUD de configuración vive en el modal de administración. */
function inicializarModalAdmin() {
  const boton = document.getElementById('admin-btn');
  if (!boton) return;
  if (!Session.esAdmin()) {
    boton.style.display = 'none';
    return;
  }
  boton.style.display = 'flex';
  boton.addEventListener('click', async () => {
    document.getElementById('admin-modal')?.classList.add('active');
    await window.adminManager?.init();
  });
}

/** Entra al mapa una vez elegido el ejercicio. */
function alEntrarAlEjercicio({ ejercicioId, preparacion = false }) {
  actualizarIndicadorEjercicio();
  // El estado llega por `ejercicio:estado_inicial`; si el ejercicio ya estaba
  // corriendo el backend lo emite al unirse.
  console.log(`✓ Unido al ejercicio ${ejercicioId}${preparacion ? ' (preparación)' : ''}`);

  // Modo preparación: el admin entró sin iniciar. Todavía no hay estado, así
  // que el mapa arranca vacío y se puebla cuando arranque el ejercicio.
  if (preparacion) {
    toastAviso(
      'Modo preparación: el ejercicio NO está iniciado. '
      + 'Arrancalo desde Dirección → Control → ▶ INICIAR.',
    );
  }
}

async function entrarALaApp() {
  LoginUI.showApp();
  iniciarModulos();
  EjerciciosUI.init({ alEntrar: alEntrarAlEjercicio });
  await EjerciciosUI.mostrar();
}

function cerrarSesion() {
  Socket.desconectar();
  Session.clear();
  Store.limpiar();
  location.reload();
}

window.logout = cerrarSesion;
window.simtacVolverASeleccion = volverASeleccion;

/** Login desde la pantalla de ingreso: login-ui.js llama a este hook. */
window.inicializarAppAfterLogin = () => entrarALaApp();

/**
 * Cerrar la ventana también cierra la sesión: si no, el token persistido
 * (`session.js`, `withGlobalTauri`) queda válido en el archivo de
 * configuración de la app y cualquiera que la reabra entra ya logueado.
 * Se intercepta el cierre, se espera a que `Session.clear()` termine de
 * borrarlo y recién ahí se destruye la ventana — nunca se deja avanzar el
 * cierre por su cuenta, si no la escritura nativa puede no llegar a correr.
 * Solo aplica dentro de Tauri: en el navegador (desarrollo) no hay ventana
 * nativa que interceptar.
 */
function registrarCierreDeVentana() {
  const tauriWindow = window.__TAURI__?.window;
  if (!tauriWindow?.getCurrentWindow) return;
  const actual = tauriWindow.getCurrentWindow();
  actual.onCloseRequested(async (evento) => {
    evento.preventDefault();
    try {
      await Session.clear();
    } finally {
      await actual.destroy();
    }
  });
}

async function arrancar() {
  registrarCierreDeVentana();

  console.log('=== SIMTAC ===');
  await Session.init();

  await LoginUI.init();

  if (!Session.isAuthenticated()) {
    LoginUI.showLogin();
    return;
  }

  // Revalidar la sesión al abrir la app: `ejercicios_asignados` se relee de la
  // base en cada login/refresh porque la asignación puede cambiar.
  try {
    // `/auth/me` puede devolver el usuario plano o envuelto en { usuario }:
    // `usuario` también es el nombre de la columna de login, así que solo se
    // desenvuelve cuando es un objeto.
    const respuesta = await Api.auth.me();
    const usuario = typeof respuesta?.usuario === 'object' && respuesta.usuario !== null
      ? respuesta.usuario
      : respuesta;
    if (usuario?.id) Session.setUser(usuario);
  } catch (e) {
    console.warn('No se pudo revalidar la sesión:', e.message);
    if (e.status === 401) {
      Session.clear();
      LoginUI.showLogin();
      return;
    }
    toast('Sin conexión con el servidor: se usa la sesión guardada', 'aviso');
  }

  await entrarALaApp();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', arrancar);
} else {
  arrancar();
}
