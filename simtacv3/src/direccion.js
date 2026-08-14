// Fase 8 — Panel de dirección del administrador. Todo requiere rol administrador.
//
// Incluye: control del ejercicio, visibilidad de entidades, alta y edición en
// caliente, boletines, línea de tiempo de checkpoints con rebobinado y cambio
// de ejercicio.

import Store from './store.js';
import Session from './session.js';
import Socket from './socket.js';
import Api from './api.js';
import Mapa from './mapa.js';
import Sidc from './sidc.js';
import { esc, toast, toastError, toastExito, toastAviso, confirmar, fechaHora } from './ui.js';

/** Listas blancas del backend: cualquier otra clave se ignora. */
const CAMPOS_UNIDAD = [
  { nombre: 'nombre', tipo: 'text' },
  { nombre: 'sidc', tipo: 'text' },
  { nombre: 'posicion_x', tipo: 'number', paso: 'any' },
  { nombre: 'posicion_y', tipo: 'number', paso: 'any' },
  { nombre: 'efectivo', tipo: 'number' },
  { nombre: 'ataque', tipo: 'number' },
  { nombre: 'defensa', tipo: 'number' },
  { nombre: 'velocidad_movimiento', tipo: 'number', paso: 'any' },
  { nombre: 'rango_vision_m', tipo: 'number' },
  { nombre: 'visible', tipo: 'checkbox' },
];

const CAMPOS_VEHICULO = [
  { nombre: 'nombre', tipo: 'text' },
  { nombre: 'sidc', tipo: 'text' },
  { nombre: 'posicion_x', tipo: 'number', paso: 'any' },
  { nombre: 'posicion_y', tipo: 'number', paso: 'any' },
  { nombre: 'estado_actual', tipo: 'select', opciones: ['activo', 'dañado', 'destruido'] },
  { nombre: 'danio_acumulado', tipo: 'number', paso: 'any' },
  { nombre: 'municion_actual', tipo: 'number' },
  { nombre: 'velocidad_desplazamiento', tipo: 'number', paso: 'any' },
  { nombre: 'rango_vision_m', tipo: 'number' },
  { nombre: 'umbral_danio', tipo: 'number', paso: 'any' },
  { nombre: 'visible', tipo: 'checkbox' },
];

/**
 * `ejercicio:unidad_modificada` / `ejercicio:vehiculo_modificado` traen los
 * campos cambiados sueltos en el payload (junto con `entidad_id`, etc.), no
 * un objeto `entidad` aparte. Se extraen acá solo los de la lista blanca para
 * no pisar `item.entidad` con claves que no son parte del modelo.
 */
function camposModificados(payload, definiciones) {
  const campos = {};
  for (const { nombre } of definiciones) {
    if (payload[nombre] !== undefined) campos[nombre] = payload[nombre];
  }
  return campos;
}

let panel = null;
let seccion = 'control';
let estadosGuardados = [];
/** Cache del catálogo `unidad_militar_base` (GET /unidades/base). */
let plantillasUnidad = [];
/** Cache de los participantes del ejercicio (GET /ejercicios/:id/participantes). */
let participantesEjercicio = [];

/**
 * Jugadores que se pueden poner al mando de una unidad.
 *
 * ⚠️ NO alcanza con `Store.estado.jugadores`: ese array sale del JSON del
 * ejercicio, que no existe hasta que el ejercicio arranca (y en modo
 * preparación el select quedaba vacío). La lista real de "quién está en este
 * ejercicio" es `ejercicio_usuario`, que se pide por REST. Se combinan las dos
 * y gana la del estado, que trae el bando ya resuelto por el backend.
 */
async function cargarJugadores(forzar = false) {
  if (participantesEjercicio.length && !forzar) return jugadoresCombinados();
  if (!Store.ejercicioId) return jugadoresCombinados();
  participantesEjercicio = await Api.ejercicios
    .participantes(Store.ejercicioId)
    .catch(() => []);
  return jugadoresCombinados();
}

function jugadoresCombinados() {
  const porId = new Map();
  for (const p of participantesEjercicio) {
    const id = p.usuario_id ?? p.id;
    if (id === null || id === undefined) continue;
    porId.set(String(id), { id, nombre: p.nombre || p.usuario, bando: p.bando || null });
  }
  // El estado del ejercicio pisa al REST: es la verdad de la corrida en curso.
  for (const j of (Store.estado.jugadores || [])) {
    porId.set(String(j.id), { id: j.id, nombre: j.nombre, bando: j.bando || porId.get(String(j.id))?.bando || null });
  }
  return [...porId.values()];
}
let replay = { activo: false, indice: 0, total: 0, nombreArchivo: null, timestamp: null, pausado: false };

// ---------------------------------------------------------------------------
// Estructura del panel
// ---------------------------------------------------------------------------

function crearPanel() {
  if (panel && document.body.contains(panel)) return panel;
  panel = document.createElement('div');
  panel.id = 'panel-direccion';
  panel.className = 'panel-direccion';
  document.body.appendChild(panel);
  return panel;
}

function render() {
  if (!Session.esAdmin()) return;
  const el = crearPanel();
  el.innerHTML = `
    <div class="pd-header">
      <span>🎖️ DIRECCIÓN DEL EJERCICIO</span>
      <button class="pd-toggle" title="Minimizar">−</button>
    </div>
    <div class="pd-nav">
      ${[['control', 'Control'], ['entidades', 'Entidades'], ['alta', 'Alta'], ['boletin', 'Boletín'], ['tiempo', 'Tiempo']]
        .map(([id, etiqueta]) => `<button class="pd-nav-btn ${seccion === id ? 'active' : ''}" data-seccion="${id}">${etiqueta}</button>`).join('')}
    </div>
    <div class="pd-cuerpo" id="pd-cuerpo"></div>
  `;
  el.classList.add('visible');

  el.querySelector('.pd-toggle').addEventListener('click', () => {
    el.classList.toggle('colapsado');
    el.querySelector('.pd-toggle').textContent = el.classList.contains('colapsado') ? '+' : '−';
  });
  el.querySelectorAll('[data-seccion]').forEach((boton) => {
    boton.addEventListener('click', () => {
      seccion = boton.dataset.seccion;
      render();
    });
  });

  renderSeccion();
}

function renderSeccion() {
  const cuerpo = document.getElementById('pd-cuerpo');
  if (!cuerpo) return;
  if (seccion === 'control') renderControl(cuerpo);
  else if (seccion === 'entidades') renderEntidades(cuerpo);
  else if (seccion === 'alta') renderAlta(cuerpo);
  else if (seccion === 'boletin') renderBoletin(cuerpo);
  else if (seccion === 'tiempo') renderTiempo(cuerpo);
}

// ---------------------------------------------------------------------------
// Control del ejercicio
// ---------------------------------------------------------------------------

/** ISO (UTC) → valor de un `<input type="datetime-local">`, en hora local. */
function isoParaInputLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function renderControl(cuerpo) {
  const estado = Store.estadoEjercicio();
  const ejercicio = Store.estado.ejercicio;
  cuerpo.innerHTML = `
    <div class="pd-estado">
      <div class="pd-estado-nombre">${esc(ejercicio?.nombre || 'Sin ejercicio')}</div>
      <div class="pd-estado-badge estado-${esc(estado || 'sin-iniciar')}">${esc(estado || 'sin iniciar')}</div>
    </div>
    <div class="pd-info">
      <span>ID: ${esc(Store.ejercicioId ?? '--')}</span>
      <span>Velocidad: ×${Math.round(Number(ejercicio?.velocidad_ejercicio ?? 1))}</span>
      <span>Inicio: ${fechaHora(ejercicio?.inicio)}</span>
    </div>
    <div class="pd-botones">
      <button class="pd-btn pd-btn-ok" data-ctrl="iniciar">▶ ${estado === 'pausado' ? 'REANUDAR' : 'INICIAR'}</button>
      <button class="pd-btn pd-btn-aviso" data-ctrl="pausar" ${estado === 'activo' ? '' : 'disabled'}>⏸ PAUSAR</button>
      <button class="pd-btn pd-btn-alerta" data-ctrl="detener" ${estado ? '' : 'disabled'}>⏹ DETENER</button>
    </div>
    ${estado ? '' : `
    <div class="pd-nota pd-nota-preparacion">
      <strong>Modo preparación.</strong> Estás dentro del ejercicio pero todavía no
      arrancó: el mapa queda vacío hasta que lo inicies. Las unidades que des de
      alta desde Administración (⚙️) entran al ejercicio al iniciarlo, porque el
      estado se genera desde la base la primera vez.
    </div>`}
    <div class="pd-nota">
      Pausar y detener cortan movimiento y combate. El chat, los documentos y los
      boletines siguen funcionando con el ejercicio pausado.
    </div>
    <div class="pd-subtitulo">Hora táctica</div>
    <div class="pd-info">Actual: ${fechaHora(ejercicio?.hora_tactica)}</div>
    <div class="pd-fila-inline">
      <label class="pd-inline-label" for="pd-velocidad">Multiplicador ×</label>
      <input type="number" id="pd-velocidad" class="pd-input pd-input-corto"
             min="1" step="1" value="${Math.round(Number(ejercicio?.velocidad_ejercicio ?? 1))}">
      <button class="pd-btn pd-btn-plano" data-ctrl="velocidad">Actualizar</button>
    </div>
    <div class="pd-info">
      Acelera el reloj táctico: con ×2 los segundos avanzan de 2 en 2. Tiene
      que ser un <strong>número entero, 1 o mayor</strong> (×1 = tiempo real).
    </div>
    <button class="pd-btn pd-btn-plano" id="pd-abrir-hora-tactica" ${estado ? '' : 'disabled'}>🕓 Fijar hora táctica…</button>
    <div class="pd-info">
      Ajusta la hora táctica a mano; sigue corriendo desde ahí con el
      multiplicador de arriba, pausada o no. Hace falta haber iniciado el
      ejercicio al menos una vez.
    </div>

    <div class="pd-subtitulo">Cambiar de ejercicio</div>
    <div class="pd-fila-inline">
      <select id="pd-ejercicio-nuevo" class="pd-select"><option value="">Cargando...</option></select>
      <button class="pd-btn pd-btn-plano" data-ctrl="cambiar">Cambiar</button>
    </div>
    <div class="pd-nota">
      Mueve a TODOS los sockets del ejercicio actual al nuevo. El bando de cada
      jugador se resuelve en el ejercicio de destino.
    </div>
  `;

  cuerpo.querySelectorAll('[data-ctrl]').forEach((boton) => {
    boton.addEventListener('click', () => accionControl(boton.dataset.ctrl));
  });
  document.getElementById('pd-abrir-hora-tactica')?.addEventListener('click', abrirModalHoraTactica);

  cargarEjerciciosSelector();
}

async function cargarEjerciciosSelector() {
  const selector = document.getElementById('pd-ejercicio-nuevo');
  if (!selector) return;
  try {
    const ejercicios = await Api.ejercicios.listar();
    selector.innerHTML = ejercicios
      .filter((e) => Number(e.id) !== Store.ejercicioId)
      .map((e) => `<option value="${esc(e.id)}">${esc(e.nombre)}${e.activo ? '' : ' (inactivo)'}</option>`)
      .join('') || '<option value="">Sin otros ejercicios</option>';
  } catch (e) {
    selector.innerHTML = `<option value="">${esc(e.message)}</option>`;
  }
}

async function accionControl(accion) {
  try {
    if (accion === 'velocidad') {
      const campo = document.getElementById('pd-velocidad');
      const valor = Number(campo?.value);
      if (!Number.isInteger(valor) || valor < 1) {
        toastError('El multiplicador tiene que ser un número entero, 1 o mayor');
        return;
      }
      if (!Store.ejercicioId) {
        toastError('No hay ejercicio activo');
        return;
      }
      // No hay evento de socket para esto: es una propiedad del ejercicio en la
      // base, así que va por REST. El PUT converge en caliente si el ejercicio
      // ya tiene JSON (backend.md, punto 20d): el motor relee el multiplicador
      // en el próximo ciclo (reloj, movimiento y combate) sin reiniciar nada.
      await Api.ejercicios.actualizar(Store.ejercicioId, { velocidad_ejercicio: valor });
      if (Store.estado.ejercicio) Store.estado.ejercicio.velocidad_ejercicio = valor;
      toastExito(`Multiplicador ×${valor} aplicado de inmediato al ejercicio en curso`);
      renderSeccion();
      return;
    }

    if (accion === 'cambiar') {
      const nuevo = document.getElementById('pd-ejercicio-nuevo')?.value;
      if (!nuevo) return;
      const respuesta = await Socket.emitir('ejercicio:cambiar', { ejercicio_id_nuevo: Number(nuevo) });
      toastExito(`Cambiado al ejercicio ${respuesta.ejercicio_id} · ${respuesta.sockets_movidos} socket(s) movido(s)`);
      Session.setEjercicioId(Number(nuevo));
      return;
    }

    // `iniciar` también reanuda un ejercicio pausado: no hay evento aparte.
    const respuesta = await Socket.emitir(`ejercicio:${accion}`, { ejercicio_id: Store.ejercicioId });
    if (respuesta.estado) Store.setEstadoEjercicio(respuesta.estado);
    const detalle = respuesta.movimientos_detenidos !== undefined
      ? ` · ${respuesta.movimientos_detenidos} movimiento(s) detenido(s), ${respuesta.combates_cortados ?? 0} combate(s) cortado(s)`
      : '';
    toastExito(`Ejercicio ${respuesta.estado || accion}${detalle}`);
    renderSeccion();
  } catch (e) {
    toastError(e.message);
  }
}

/** Modal para fijar la hora táctica a mano — más cómodo que un input suelto en el panel. */
function abrirModalHoraTactica() {
  const ejercicio = Store.estado.ejercicio;
  const modal = document.createElement('div');
  modal.className = 'pd-modal visible';
  modal.innerHTML = `
    <div class="pd-modal-caja">
      <div class="pd-modal-header">
        <span>🕓 Fijar hora táctica</span>
        <button class="pd-modal-cerrar">✕</button>
      </div>
      <form class="pd-modal-form">
        <div class="pd-info">Actual: ${fechaHora(ejercicio?.hora_tactica)}</div>
        <div class="pd-campo">
          <label>Fecha y hora</label>
          <input type="datetime-local" name="hora_tactica" step="1" required
                 value="${isoParaInputLocal(ejercicio?.hora_tactica)}">
        </div>
        <div class="pd-nota">
          Sigue corriendo desde acá con el multiplicador configurado, esté el
          ejercicio activo o pausado.
        </div>
        <div class="pd-modal-acciones">
          <button type="submit" class="pd-btn pd-btn-ok">Fijar</button>
          <button type="button" class="pd-btn pd-btn-plano pd-cancelar">Cancelar</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  const cerrar = () => modal.remove();
  modal.querySelector('.pd-modal-cerrar').addEventListener('click', cerrar);
  modal.querySelector('.pd-cancelar').addEventListener('click', cerrar);

  modal.querySelector('form').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const valor = new FormData(evento.target).get('hora_tactica');
    const fecha = valor ? new Date(valor) : null;
    if (!fecha || Number.isNaN(fecha.getTime())) {
      toastError('Elegí una fecha y hora válidas');
      return;
    }
    if (!Store.ejercicioId) {
      toastError('No hay ejercicio activo');
      return;
    }
    try {
      const respuesta = await Socket.emitir('ejercicio:establecer_hora_tactica', {
        ejercicio_id: Store.ejercicioId,
        hora_tactica: fecha.toISOString(),
      });
      if (Store.estado.ejercicio) Store.estado.ejercicio.hora_tactica = respuesta.hora_tactica;
      toastExito('Hora táctica fijada');
      cerrar();
      if (seccion === 'control') renderSeccion();
    } catch (e) {
      toastError(e.message);
    }
  });
}

// ---------------------------------------------------------------------------
// Entidades: visibilidad y edición en caliente
// ---------------------------------------------------------------------------

function renderEntidades(cuerpo) {
  const entidades = Store.todas();
  cuerpo.innerHTML = `
    <label class="pd-check">
      <input type="checkbox" id="pd-arrastrar" ${Mapa.arrastreActivo() ? 'checked' : ''}>
      ✋ Reposicionar arrastrando en el mapa
    </label>
    <div class="pd-info">
      Con el modo activo se arrastran las entidades directamente sobre el mapa.
      Reposicionar cancela el trayecto que estuviera siguiendo.
    </div>
    <input type="text" id="pd-filtro" class="pd-input" placeholder="Filtrar por nombre o bando...">
    <div class="pd-lista" id="pd-lista-entidades">
      ${entidades.map((item) => filaEntidad(item)).join('') || '<div class="pd-vacio">Sin entidades</div>'}
    </div>
  `;

  document.getElementById('pd-arrastrar').addEventListener('change', (evento) => {
    alternarArrastre(evento.target.checked);
  });

  const filtrar = () => {
    const q = document.getElementById('pd-filtro').value.toLowerCase();
    document.querySelectorAll('#pd-lista-entidades .pd-entidad').forEach((fila) => {
      fila.style.display = fila.dataset.busqueda.includes(q) ? '' : 'none';
    });
  };
  document.getElementById('pd-filtro').addEventListener('input', filtrar);

  cuerpo.querySelectorAll('[data-ent-accion]').forEach((boton) => {
    boton.addEventListener('click', () => {
      const item = Store.obtenerPorClave(boton.dataset.clave);
      if (!item) return;
      if (boton.dataset.entAccion === 'visibilidad') alternarVisibilidad(item);
      else if (boton.dataset.entAccion === 'editar') editarEntidad(item);
      else if (boton.dataset.entAccion === 'ver') {
        Store.seleccionar(item.clave);
        Mapa.centrarEn(item.entidad);
      }
    });
  });
}

/**
 * Sin `posicion_x`/`posicion_y` NI `posicion_base_x`/`posicion_base_y`,
 * `Mapa.entidadAMapa` no tiene de dónde sacar coordenadas y la entidad
 * simplemente no se dibuja — sin este aviso, "no aparece en el mapa" es
 * indistinguible de un bug (ver `geo.js`, `entidadAMapa`).
 */
function sinPosicion(entidad) {
  const sinActual = entidad.posicion_x === null || entidad.posicion_x === undefined
    || entidad.posicion_y === null || entidad.posicion_y === undefined;
  const sinBase = entidad.posicion_base_x === null || entidad.posicion_base_x === undefined
    || entidad.posicion_base_y === null || entidad.posicion_base_y === undefined;
  return sinActual && sinBase;
}

function filaEntidad(item) {
  const e = item.entidad;
  const busqueda = `${e.nombre || ''} ${e.bando || ''} ${item.tipo}`.toLowerCase();
  return `
    <div class="pd-entidad" data-busqueda="${esc(busqueda)}">
      <div class="pd-entidad-info">
        <span class="pd-entidad-nombre">${esc(e.nombre || `${item.tipo} ${item.id}`)}</span>
        <span class="pd-entidad-meta">
          <span class="pd-tipo">${esc(item.tipo)}</span>
          <span class="pd-bando bando-${esc(String(e.bando || '').toLowerCase())}">${esc(e.bando || '--')}</span>
          ${item.tipo === 'unidad' ? `<span>ef. ${esc(e.efectivo ?? '--')}</span>` : `<span>${esc(e.estado_actual || 'activo')}</span>`}
          ${e.en_combate ? '<span class="pd-flag">combate</span>' : ''}
          ${e.visible === false ? '<span class="pd-flag">oculta</span>' : ''}
          ${e._pendienteEnMotor ? '<span class="pd-flag" title="Se creó por catálogo (REST) con el ejercicio corriendo: el motor todavía no la conoce, no se puede mover ni editar hasta que el ejercicio se reinicie">⏳ pendiente en el motor</span>' : ''}
          ${sinPosicion(e) ? '<span class="pd-flag" title="No tiene posición actual ni posición base: no se puede dibujar en el mapa hasta que se le fije una">📍 sin posición</span>' : ''}
        </span>
      </div>
      <div class="pd-entidad-acciones">
        <button class="pd-mini" data-ent-accion="ver" data-clave="${item.clave}" title="Ver en el mapa">📍</button>
        <button class="pd-mini" data-ent-accion="visibilidad" data-clave="${item.clave}" title="${e.visible === false ? 'Hacer visible' : 'Ocultar al enemigo'}">${e.visible === false ? '🚫' : '👁'}</button>
        <button class="pd-mini" data-ent-accion="editar" data-clave="${item.clave}" title="Editar" ${e._pendienteEnMotor ? 'disabled' : ''}>✎</button>
      </div>
    </div>
  `;
}

/**
 * Ocultar una entidad simula que el enemigo no tiene inteligencia sobre ella:
 * deja de recibir detecciones y no puede fijarla como blanco. Es una
 * herramienta de dirección, no una propiedad física.
 */
// ---------------------------------------------------------------------------
// Reposicionamiento por arrastre
// ---------------------------------------------------------------------------

/**
 * Persiste la nueva posición de una entidad arrastrada en el mapa.
 *
 * Reposicionar CANCELA el trayecto que estuviera siguiendo: el backend lo hace
 * y acá se refleja para que la UI no muestre una ruta que ya no existe.
 */
async function reposicionar(item, punto) {
  const evento = item.tipo === 'unidad' ? 'unidad:modificar' : 'vehiculo:modificar';
  const anterior = { x: item.entidad.posicion_x, y: item.entidad.posicion_y };

  try {
    await Socket.emitir(evento, {
      ejercicio_id: Store.ejercicioId,
      entidad_id: item.id,
      posicion_x: punto.x,
      posicion_y: punto.y,
    });

    Store.aplicarCampos(item.tipo, item.id, {
      posicion_x: punto.x,
      posicion_y: punto.y,
      estado_movimiento: 'estacionado',
    });
    Mapa.limpiarTrayecto(item.tipo, item.id);
    toast(`${item.entidad.nombre || item.tipo}: reposicionada en ${punto.x.toFixed(5)}, ${punto.y.toFixed(5)}`);
  } catch (e) {
    toastError(`No se pudo reposicionar: ${e.message}`);
    // El store nunca se tocó: repintar devuelve el ícono a donde estaba.
    Mapa.actualizarEntidad(item);
    console.warn('Reposicionamiento rechazado, se vuelve a', anterior);
  }
}

/**
 * Enciende o apaga el modo arrastre. Mantiene en sincronía los dos disparadores
 * (el botón de la barra del mapa y el check de la sección Entidades).
 */
export function alternarArrastre(forzar, { silencioso = false } = {}) {
  const encender = forzar === undefined ? !Mapa.arrastreActivo() : !!forzar;

  const activo = Mapa.habilitarArrastre(encender, {
    // Durante el rebobinado se ve un preview, no el estado real. Un vehículo
    // `_pendienteEnMotor` viene de reconciliar el catálogo (REST) y el motor
    // todavía no lo conoce: arrastrarlo solo terminaría en "no existe en este
    // ejercicio" (ver `Store.agregarVehiculo`). Un `id` inválido (NaN) es un
    // registro corrupto que se coló al Store antes de que `agregarVehiculo`/
    // `agregarUnidad` empezaran a rechazarlos: sin esto, `entidad_id` se cae
    // del payload y el backend responde "entidad_id es requerido".
    puedeArrastrar: (item) => !Store.rebobinando && !item.entidad._pendienteEnMotor && Number.isFinite(Number(item.id)),
    alSoltar: reposicionar,
  });

  document.getElementById('mapa-arrastrar')?.classList.toggle('activo', activo);
  const check = document.getElementById('pd-arrastrar');
  if (check) check.checked = activo;

  if (!silencioso) {
    toast(activo
      ? '✋ Modo reposicionar: arrastrá las entidades en el mapa'
      : 'Modo reposicionar desactivado');
  }
  return activo;
}

export async function alternarVisibilidad(item) {
  const visible = item.entidad.visible === false;
  try {
    await Socket.emitir('admin:set_visibilidad', {
      ejercicio_id: Store.ejercicioId,
      entidad_tipo: item.tipo,
      entidad_id: item.id,
      visible,
    });
    Store.aplicarCampos(item.tipo, item.id, { visible });
    toast(`${item.entidad.nombre}: ${visible ? 'visible' : 'oculta para el enemigo'}`);
    if (seccion === 'entidades') renderSeccion();
  } catch (e) {
    toastError(e.message);
  }
}

/** Formulario de edición en caliente (lista blanca de campos del backend). */
export function editarEntidad(item) {
  const campos = item.tipo === 'unidad' ? CAMPOS_UNIDAD : CAMPOS_VEHICULO;
  const modal = document.createElement('div');
  modal.className = 'pd-modal visible';
  modal.innerHTML = `
    <div class="pd-modal-caja">
      <div class="pd-modal-header">
        <span>Editar ${esc(item.tipo)}: ${esc(item.entidad.nombre || item.id)}</span>
        <button class="pd-modal-cerrar">✕</button>
      </div>
      <form class="pd-modal-form">
        ${campos.map((campo) => {
          const valor = item.entidad[campo.nombre];
          if (campo.tipo === 'checkbox') {
            return `<label class="pd-check"><input type="checkbox" name="${campo.nombre}" ${valor === false ? '' : 'checked'}> ${esc(campo.nombre)}</label>`;
          }
          if (campo.tipo === 'select') {
            return `
              <div class="pd-campo">
                <label>${esc(campo.nombre)}</label>
                <select name="${campo.nombre}">
                  ${campo.opciones.map((o) => `<option value="${esc(o)}" ${valor === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
                </select>
              </div>`;
          }
          if (campo.nombre === 'sidc') {
            // Solo lectura: el bando es derivado (`frontend.md`, fase 8) —
            // para cambiarlo hay que reasignar el controlador o su bando en
            // Participantes, no se edita acá. Si el SIDC es numérico (2525D)
            // el bando reescribe el dígito 4 (afiliación); si es
            // alfanumérico queda tal cual.
            return `
              <div class="pd-campo">
                <label>sidc (derivado del bando: ${esc(item.entidad.bando || 'sin bando')})</label>
                <input name="sidc" value="${esc(valor ?? '')}" class="pd-input-bloqueado" readonly tabindex="-1">
                <small class="pd-info">${esc(Sidc.explicacion(valor, item.entidad.bando))}</small>
              </div>`;
          }
          return `
            <div class="pd-campo">
              <label>${esc(campo.nombre)}</label>
              <input type="${campo.tipo}" name="${campo.nombre}" value="${esc(valor ?? '')}" ${campo.paso ? `step="${campo.paso}"` : ''}>
            </div>`;
        }).join('')}
        <div class="pd-nota">Reposicionar una entidad cancela el trayecto que estuviera siguiendo.</div>
        <div class="pd-modal-acciones">
          <button type="submit" class="pd-btn pd-btn-ok">Guardar cambios</button>
          <button type="button" class="pd-btn pd-btn-plano pd-cancelar">Cancelar</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  const cerrar = () => modal.remove();
  modal.querySelector('.pd-modal-cerrar').addEventListener('click', cerrar);
  modal.querySelector('.pd-cancelar').addEventListener('click', cerrar);

  modal.querySelector('form').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const datos = new FormData(evento.target);
    const payload = { ejercicio_id: Store.ejercicioId, entidad_id: item.id };

    for (const campo of campos) {
      if (campo.tipo === 'checkbox') {
        const marcado = datos.get(campo.nombre) !== null;
        if (marcado !== (item.entidad[campo.nombre] !== false)) payload[campo.nombre] = marcado;
        continue;
      }
      const valor = datos.get(campo.nombre);
      if (valor === null || valor === '') continue;
      const nuevo = campo.tipo === 'number' ? Number(valor) : valor;
      // Solo se mandan los campos que efectivamente cambiaron.
      if (String(nuevo) !== String(item.entidad[campo.nombre] ?? '')) payload[campo.nombre] = nuevo;
    }

    if (Object.keys(payload).length <= 2) {
      toastAviso('No hay campos para modificar');
      return;
    }

    try {
      const evento_socket = item.tipo === 'unidad' ? 'unidad:modificar' : 'vehiculo:modificar';
      const respuesta = await Socket.emitir(evento_socket, payload);
      toastExito(`Actualizado: ${(respuesta.campos || []).join(', ')}`);
      cerrar();
    } catch (e) {
      toastError(e.message);
    }
  });
}

// ---------------------------------------------------------------------------
// Alta de unidad en caliente
// ---------------------------------------------------------------------------

/**
 * Catálogo `unidad_militar_base`: ahí viven `sidc`, `quantity` (efectivos),
 * `velocidad_movimiento` y `rango_vision_m`. Se carga una vez y se cachea; el
 * alta de plantillas sigue estando en el panel de administración.
 */
async function cargarPlantillasUnidad(forzar = false) {
  if (plantillasUnidad.length && !forzar) return plantillasUnidad;
  plantillasUnidad = await Api.unidadesBase.listar();
  return plantillasUnidad;
}

/** SIDC base de la plantilla elegida; el mostrado se deriva de él + el bando. */
let sidcBaseAlta = '';

/**
 * Bando de la unidad que se está dando de alta. Ya no se elige: sale del
 * jugador que la va a controlar, que lo tiene por su participación en el
 * ejercicio (`ejercicio_usuario.bando`). Ver backend.md, punto 7.
 */
function bandoDelJugadorElegido(form) {
  const select = form.elements.jugador_asignado_id;
  return select?.selectedOptions?.[0]?.dataset?.bando || '';
}

/**
 * Recalcula el SIDC visible. Es de solo lectura: el código sale de la plantilla
 * y lo único que puede cambiar es el dígito 4 (afiliación) cuando el SIDC del
 * catálogo es numérico. Si es alfanumérico queda igual que en la tabla.
 */
function refrescarSidc(form) {
  const bando = bandoDelJugadorElegido(form);
  form.elements.sidc.value = Sidc.conBando(sidcBaseAlta, bando);

  const aviso = document.getElementById('pd-alta-bando');
  if (aviso) {
    aviso.textContent = bando
      ? `Bando heredado del jugador: ${bando}.`
      : 'Una unidad siempre tiene un jugador, y de él sale el bando.';
  }

  const pie = document.getElementById('pd-sidc-explicacion');
  if (!pie) return;
  pie.textContent = Sidc.explicacion(sidcBaseAlta, bando);
  // Numérico + bando sin mapear = el SIDC queda con la afiliación del catálogo.
  const sinAplicar = Sidc.esNumerico(sidcBaseAlta) && !Sidc.bandoReconocido(bando);
  pie.classList.toggle('pd-nota', sinAplicar);
}

/** Vuelca los valores de la plantilla elegida sobre el formulario. */
function aplicarPlantilla(form, plantilla) {
  sidcBaseAlta = plantilla?.sidc || '';
  refrescarSidc(form);

  const detalle = document.getElementById('pd-plantilla-detalle');
  if (!plantilla) {
    if (detalle) detalle.innerHTML = '';
    return;
  }

  if (plantilla.quantity !== undefined && plantilla.quantity !== null) {
    form.elements.efectivo.value = Number(plantilla.quantity);
  }
  if (plantilla.velocidad_movimiento !== undefined && plantilla.velocidad_movimiento !== null) {
    form.elements.velocidad_movimiento.value = Number(plantilla.velocidad_movimiento);
  }
  if (plantilla.rango_vision_m !== undefined && plantilla.rango_vision_m !== null) {
    form.elements.rango_vision_m.value = Number(plantilla.rango_vision_m);
  }
  if (!form.elements.nombre.value.trim()) form.elements.nombre.value = plantilla.nombre || '';

  if (detalle) {
    detalle.innerHTML = `
      <span class="pd-tipo">${esc(plantilla.tipo || 'sin tipo')}</span>
      ${plantilla.country ? `<span class="pd-tipo">${esc(plantilla.country)}</span>` : ''}
      ${plantilla.quantity ? `<span class="pd-tipo">${esc(plantilla.quantity)} efectivos</span>` : ''}
    `;
  }
}

function renderAlta(cuerpo) {
  cuerpo.innerHTML = `
    ${Store.estadoEjercicio() ? '' : `
    <div class="pd-nota pd-nota-preparacion">
      <strong>El ejercicio no está iniciado.</strong> El alta en caliente actúa
      sobre el estado en vivo, que todavía no existe: es probable que el servidor
      la rechace. Para preparar el orden de batalla usá Administración (⚙️ →
      Unidades) e iniciá después — esas unidades sí entran al arrancar.
    </div>`}
    <form id="pd-form-alta" class="pd-form">
      <div class="pd-campo">
        <label>Plantilla de unidad (catálogo) *</label>
        <div class="pd-fila-inline">
          <select name="unidad_militar_base_id" id="pd-plantilla" class="pd-select" required>
            <option value="">Cargando catálogo…</option>
          </select>
          <button type="button" class="pd-mini" id="pd-plantillas-refrescar" title="Recargar el catálogo">↻</button>
        </div>
        <div class="pd-entidad-meta" id="pd-plantilla-detalle"></div>
      </div>
      <div class="pd-campo"><label>Nombre *</label><input name="nombre" required placeholder="Delta"></div>
      <div class="pd-campo">
        <label>Jugador que la controla *</label>
        <div class="pd-fila-inline">
          <select name="jugador_asignado_id" id="pd-jugador" class="pd-select" required>
            <option value="">Cargando jugadores…</option>
          </select>
          <button type="button" class="pd-mini" id="pd-jugadores-refrescar" title="Recargar los participantes">↻</button>
        </div>
        <small class="pd-info" id="pd-alta-bando">
          Una unidad siempre tiene un jugador, y de él sale el bando.
        </small>
      </div>
      <div class="pd-campo">
        <label>SIDC (derivado del catálogo y el bando del jugador)</label>
        <input name="sidc" class="pd-input-bloqueado" readonly tabindex="-1"
               value="" placeholder="Elegí una plantilla">
        <small class="pd-info" id="pd-sidc-explicacion">Elegí una plantilla para obtener el SIDC del catálogo.</small>
      </div>
      <div class="pd-fila-doble">
        <div class="pd-campo"><label>posicion_x (lon)</label><input name="posicion_x" type="number" step="any"></div>
        <div class="pd-campo"><label>posicion_y (lat)</label><input name="posicion_y" type="number" step="any"></div>
      </div>
      <button type="button" class="pd-btn pd-btn-plano" id="pd-tomar-punto">📍 Tomar del mapa</button>
      <div class="pd-fila-doble">
        <div class="pd-campo"><label>Efectivo</label><input name="efectivo" type="number" value="100"></div>
        <div class="pd-campo"><label>Ataque</label><input name="ataque" type="number" value="35"></div>
      </div>
      <div class="pd-fila-doble">
        <div class="pd-campo"><label>Velocidad (km/h)</label><input name="velocidad_movimiento" type="number" step="any" value="5"></div>
        <div class="pd-campo"><label>Rango visión (m)</label><input name="rango_vision_m" type="number" value="1000"></div>
      </div>
      <div class="pd-info">
        Las plantillas se dan de alta en el panel de administración
        (⚙️ → Plantilla de Unidades). El SIDC sale del catálogo: si es numérico
        (MIL-STD-2525D / APP-6D) el bando reescribe el dígito 4, la afiliación;
        si es alfanumérico queda igual que en la tabla. La unidad nace con el
        mismo esquema que las del inicio.
      </div>
      <button type="submit" class="pd-btn pd-btn-ok">+ Crear unidad en el ejercicio</button>
    </form>
  `;

  document.getElementById('pd-tomar-punto').addEventListener('click', () => tomarPuntoDelMapa());

  const form = document.getElementById('pd-form-alta');
  const selector = document.getElementById('pd-plantilla');

  const llenarSelector = async (forzar = false) => {
    selector.innerHTML = '<option value="">Cargando catálogo…</option>';
    try {
      const plantillas = await cargarPlantillasUnidad(forzar);
      if (!plantillas.length) {
        selector.innerHTML = '<option value="">— No hay plantillas cargadas —</option>';
        aplicarPlantilla(form, null);
        return;
      }
      // La plantilla es obligatoria: no hay opción de crearla al vuelo.
      selector.innerHTML = `
        <option value="" disabled selected>— Elegí una plantilla —</option>
        ${plantillas.map((p) => `
          <option value="${esc(p.id)}">${esc(p.nombre)}${p.tipo ? ` · ${esc(p.tipo)}` : ''}</option>
        `).join('')}
      `;
      aplicarPlantilla(form, null);
    } catch (e) {
      selector.innerHTML = '<option value="">— No se pudo leer el catálogo —</option>';
      toastError(`Catálogo de unidades: ${e.message}`);
    }
  };

  const selectorJugador = document.getElementById('pd-jugador');

  const llenarJugadores = async (forzar = false) => {
    selectorJugador.innerHTML = '<option value="">Cargando jugadores…</option>';
    const jugadores = await cargarJugadores(forzar);
    if (!jugadores.length) {
      selectorJugador.innerHTML = '<option value="">— Este ejercicio no tiene jugadores —</option>';
      selectorJugador.disabled = true;
      const aviso = document.getElementById('pd-alta-bando');
      if (aviso) aviso.textContent = 'Agregá participantes en el panel de administración (⚙️ → Participantes).';
      return;
    }
    selectorJugador.disabled = false;
    selectorJugador.innerHTML = `
      <option value="" disabled selected>— Elegí un jugador —</option>
      ${jugadores.map((j) => `
        <option value="${esc(j.id)}" data-bando="${esc(j.bando || '')}">
          ${esc(j.nombre)} (${esc(j.bando || 'sin bando')})
        </option>`).join('')}
    `;
    refrescarSidc(form);
  };

  document.getElementById('pd-jugadores-refrescar').addEventListener('click', () => llenarJugadores(true));
  llenarJugadores();

  selector.addEventListener('change', () => {
    // Los ids llegan como string por REST: se comparan normalizados.
    const plantilla = plantillasUnidad.find((p) => String(p.id) === selector.value);
    aplicarPlantilla(form, plantilla || null);
  });

  // El SIDC no se escribe: se recalcula con la identidad que da el bando, y el
  // bando sale del jugador elegido.
  form.elements.jugador_asignado_id.addEventListener('change', () => refrescarSidc(form));

  document.getElementById('pd-plantillas-refrescar').addEventListener('click', () => llenarSelector(true));
  llenarSelector();

  document.getElementById('pd-form-alta').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const datos = Object.fromEntries(new FormData(evento.target));
    if (!datos.unidad_militar_base_id) {
      toastError('Elegí una plantilla del catálogo: la unidad no se puede crear sin ella');
      return;
    }

    if (!datos.jugador_asignado_id) {
      toastError('Elegí el jugador que la controla: una unidad siempre tiene uno, y de él sale el bando');
      return;
    }

    // El bando no se pide: es el del jugador elegido (backend.md, punto 7).
    const bando = bandoDelJugadorElegido(evento.target);
    if (!bando) {
      toastError('Ese jugador no tiene bando en este ejercicio: revisá su participación en Administración → Participantes');
      return;
    }

    const payload = {
      ejercicio_id: Store.ejercicioId,
      nombre: datos.nombre,
      sidc: Sidc.conBando(sidcBaseAlta, bando),
      // El backend deriva el bando del jugador asignado: mandarlo da 400
      // ("bando ya no se manda"), igual que en POST /vehiculos.
      jugador_asignado_id: Number(datos.jugador_asignado_id),
      unidad_militar_base_id: Number(datos.unidad_militar_base_id),
    };
    for (const clave of ['posicion_x', 'posicion_y', 'efectivo', 'ataque', 'velocidad_movimiento', 'rango_vision_m']) {
      if (datos[clave] !== '') payload[clave] = Number(datos[clave]);
    }

    try {
      await Socket.emitir('unidad:crear_en_ejercicio', payload);
      toastExito(`Unidad "${payload.nombre}" creada`);
      evento.target.reset();
      // `reset()` deja el select en la primera opción: hay que desbloquear el
      // SIDC y limpiar el detalle para que el formulario quede coherente.
      aplicarPlantilla(evento.target, null);
    } catch (e) {
      toastError(e.message);
    }
  });
}

function tomarPuntoDelMapa() {
  const mapa = Mapa.instancia();
  window.simtacModoMapa = 'punto';
  toastAviso('Clic en el mapa para fijar la posición');
  const manejador = (evento) => {
    const lonLat = ol.proj.toLonLat(evento.coordinate);
    const form = document.getElementById('pd-form-alta');
    if (form) {
      form.elements.posicion_x.value = lonLat[0].toFixed(6);
      form.elements.posicion_y.value = lonLat[1].toFixed(6);
    }
    window.simtacModoMapa = null;
    mapa.un('singleclick', manejador);
  };
  mapa.on('singleclick', manejador);
}

// ---------------------------------------------------------------------------
// Boletines
// ---------------------------------------------------------------------------

function renderBoletin(cuerpo) {
  cuerpo.innerHTML = `
    <div class="pd-campo">
      <label>Texto del boletín</label>
      <textarea id="pd-boletin-texto" rows="4" placeholder="Atención. La unidad Alfa avanzó al sector norte."></textarea>
    </div>
    <div class="pd-campo">
      <label>Destinatarios</label>
      <div class="pd-fila-radios">
        <label class="pd-radio">
          <input type="radio" name="pd-boletin-dest" value="todos" checked>
          Todos los jugadores
        </label>
        <label class="pd-radio">
          <input type="radio" name="pd-boletin-dest" value="bando">
          Un bando
        </label>
      </div>
      <select id="pd-boletin-bando" class="pd-select" disabled>
        ${Sidc.opcionesBando(null, { vacio: '— Elegí un bando —' })}
      </select>
    </div>
    <button class="pd-btn pd-btn-ok" id="pd-boletin-enviar">📢 Enviar boletín</button>
    <div class="pd-nota">
      El backend solo emite el texto: la voz la sintetiza cada cliente. Vos no
      lo recibís de vuelta, lo hayas mandado a todos o a un bando.
    </div>
    <div class="pd-subtitulo">Boletines emitidos</div>
    <div class="pd-lista pd-lista-boletines">
      ${(Store.estado.boletines || []).slice().reverse().map((b) => `
        <div class="pd-boletin">
          <span>${fechaHora(b.timestamp)} · ${b.bando ? `Bando ${esc(b.bando)}` : 'Todos'}</span>
          <p>${esc(b.texto)}</p>
        </div>
      `).join('') || '<div class="pd-vacio">Sin boletines</div>'}
    </div>
  `;

  const selectBando = document.getElementById('pd-boletin-bando');
  const modoDestinatario = () => cuerpo.querySelector('input[name="pd-boletin-dest"]:checked')?.value || 'todos';
  const actualizarModoDestinatario = () => {
    selectBando.disabled = modoDestinatario() !== 'bando';
  };
  cuerpo.querySelectorAll('input[name="pd-boletin-dest"]').forEach((radio) => {
    radio.addEventListener('change', actualizarModoDestinatario);
  });

  document.getElementById('pd-boletin-enviar').addEventListener('click', async () => {
    const texto = document.getElementById('pd-boletin-texto').value.trim();
    if (!texto) return;
    const bando = modoDestinatario() === 'bando' ? selectBando.value : '';
    if (modoDestinatario() === 'bando' && !bando) {
      toastError('Elegí un bando');
      return;
    }
    try {
      const payload = { ejercicio_id: Store.ejercicioId, texto };
      if (bando) payload.bando = bando;
      await Socket.emitir('boletin:enviar', payload);
      Store.agregarBoletin({ texto, bando: bando || null, timestamp: new Date().toISOString() });
      document.getElementById('pd-boletin-texto').value = '';
      toastExito(bando ? `Boletín enviado (bando ${bando})` : 'Boletín enviado a todos los jugadores');
      renderSeccion();
    } catch (e) {
      toastError(e.message);
    }
  });
}

// ---------------------------------------------------------------------------
// Línea de tiempo: estados anteriores y rebobinado
// ---------------------------------------------------------------------------

function renderTiempo(cuerpo) {
  const estado = Store.estadoEjercicio();
  cuerpo.innerHTML = `
    <button class="pd-btn pd-btn-ok" id="pd-guardar-estado" ${estado ? '' : 'disabled'}>💾 Guardar punto de restauración</button>
    <div class="pd-nota">
      Los checkpoints <strong>ya no se generan solos</strong>: esta es la
      única forma de dejar un punto al que volver. Guardá antes de un
      rebobinado, o en cualquier momento que quieras poder recuperar.
    </div>
    <div class="pd-fila-inline">
      <button class="pd-btn pd-btn-plano" id="pd-listar">↻ Listar checkpoints</button>
      <span class="pd-contador" id="pd-total-estados">${estadosGuardados.length} guardado(s)</span>
    </div>
    <div class="pd-replay ${replay.activo ? 'activo' : ''}" id="pd-replay">
      <div class="pd-subtitulo">Rebobinado (solo lectura)</div>
      ${replay.activo ? `
        <div class="pd-replay-info">
          Frame ${replay.indice + 1} / ${replay.total} · ${fechaHora(replay.timestamp)}
        </div>
        <input type="range" min="0" max="${Math.max(0, replay.total - 1)}" value="${replay.indice}" id="pd-scrubber" disabled>
        <div class="pd-botones">
          <button class="pd-btn pd-btn-plano" data-replay="pausar">${replay.pausado ? '▶ Seguir' : '⏸ Pausar'}</button>
          <button class="pd-btn pd-btn-ok" data-replay="confirmar">✓ Fijar este frame</button>
          <button class="pd-btn pd-btn-alerta" data-replay="cancelar">✕ Salir del replay</button>
        </div>
        <div class="pd-nota">
          Durante el replay tu socket sale de la room: no recibís posiciones ni
          ticks de combate hasta confirmar o cancelar.
        </div>
      ` : `
        <div class="pd-fila-inline">
          <label class="pd-inline-label">Intervalo (ms)</label>
          <input type="number" id="pd-intervalo" class="pd-input pd-input-corto" value="1000" min="200" step="100">
          <button class="pd-btn pd-btn-plano" data-replay="iniciar">⏪ Rebobinar</button>
        </div>
      `}
    </div>
    <div class="pd-subtitulo">Estados guardados (del más reciente al más antiguo)</div>
    <div class="pd-lista" id="pd-lista-estados">
      ${estadosGuardados.length
        ? estadosGuardados.map((e, i) => `
            <div class="pd-estado-item">
              <div>
                <div class="pd-estado-fecha">${fechaHora(e.timestamp)}</div>
                <div class="pd-estado-archivo">${esc(e.nombre_archivo)} · ${(Number(e.bytes) / 1024).toFixed(1)} KB</div>
              </div>
              <div class="pd-entidad-acciones">
                <button class="pd-mini" data-cargar="${i}" title="Retroceder a este estado">⏮</button>
                <button class="pd-mini" data-desde="${i}" title="Rebobinar desde acá">⏪</button>
              </div>
            </div>`).join('')
        : '<div class="pd-vacio">Sin checkpoints listados</div>'}
    </div>
    <div class="pd-nota">
      ⚠ Retroceder un estado NO revierte la base de datos: una unidad creada en
      caliente desaparece del JSON pero su fila en la base queda.
    </div>
  `;

  document.getElementById('pd-guardar-estado').addEventListener('click', guardarEstado);
  document.getElementById('pd-listar').addEventListener('click', listarEstados);
  cuerpo.querySelectorAll('[data-replay]').forEach((boton) => {
    boton.addEventListener('click', () => accionReplay(boton.dataset.replay));
  });
  cuerpo.querySelectorAll('[data-cargar]').forEach((boton) => {
    boton.addEventListener('click', () => cargarEstado(estadosGuardados[Number(boton.dataset.cargar)]));
  });
  cuerpo.querySelectorAll('[data-desde]').forEach((boton) => {
    boton.addEventListener('click', () => accionReplay('iniciar', estadosGuardados[Number(boton.dataset.desde)]?.nombre_archivo));
  });
}

/**
 * Los checkpoints ya no se generan solos (frontend.md, fase 8): esta es la
 * única forma de dejar un punto al que volver más tarde.
 */
async function guardarEstado() {
  try {
    const respuesta = await Socket.emitir('ejercicio:guardar_estado', { ejercicio_id: Store.ejercicioId });
    toastExito(`Checkpoint guardado: ${respuesta.nombre_archivo}`);
    await listarEstados();
  } catch (e) {
    toastError(e.message);
  }
}

async function listarEstados() {
  try {
    const respuesta = await Socket.emitir('ejercicio:listar_estados', { ejercicio_id: Store.ejercicioId });
    estadosGuardados = respuesta.estados || [];
    renderSeccion();
  } catch (e) {
    toastError(e.message);
  }
}

async function cargarEstado(estado) {
  if (!estado) return;
  const ok = confirmar(
    `¿Retroceder el ejercicio a ${fechaHora(estado.timestamp)}?`,
    'Se emite a todos los clientes. El estado que se descarta también queda guardado, así que el retroceso se puede deshacer.\n\nOJO: esto NO revierte la base de datos.',
  );
  if (!ok) return;
  try {
    await Socket.emitir('ejercicio:cargar_estado', {
      ejercicio_id: Store.ejercicioId,
      nombre_archivo_estado: estado.nombre_archivo,
    });
    toastExito('Estado restaurado y sincronizado');
  } catch (e) {
    toastError(e.message);
  }
}

async function accionReplay(accion, desdeArchivo = null) {
  try {
    if (accion === 'iniciar') {
      const intervalo = Number(document.getElementById('pd-intervalo')?.value || 1000);
      const respuesta = await Socket.emitir('ejercicio:rebobinar_iniciar', {
        ejercicio_id: Store.ejercicioId,
        desde_archivo: desdeArchivo,
        intervalo_ms: intervalo,
      });
      replay = { activo: true, indice: 0, total: respuesta.frames || 0, nombreArchivo: null, timestamp: respuesta.desde, pausado: false };
      Store.rebobinando = true;
      Mapa.modoReplay(true);
      mostrarBannerReplay();
      renderSeccion();
      return;
    }

    if (accion === 'pausar') {
      const respuesta = await Socket.emitir('ejercicio:rebobinar_pausar', { ejercicio_id: Store.ejercicioId });
      replay.pausado = !replay.pausado;
      replay.indice = respuesta.indice ?? replay.indice;
      replay.total = respuesta.total ?? replay.total;
      replay.nombreArchivo = respuesta.nombre_archivo ?? replay.nombreArchivo;
      replay.timestamp = respuesta.timestamp ?? replay.timestamp;
      renderSeccion();
      return;
    }

    if (accion === 'confirmar') {
      const ok = confirmar(
        '¿Fijar el frame que estás viendo como estado real?',
        'Se sincroniza a todos los clientes. Sin nombre_archivo se usa el frame actual.',
      );
      if (!ok) return;
      await Socket.emitir('ejercicio:rebobinar_confirmar', {
        ejercicio_id: Store.ejercicioId,
        ...(replay.nombreArchivo ? { nombre_archivo: replay.nombreArchivo } : {}),
      });
      salirDeReplay();
      toastExito('Frame fijado como estado real');
      return;
    }

    if (accion === 'cancelar') {
      await Socket.emitir('ejercicio:rebobinar_cancelar', { ejercicio_id: Store.ejercicioId });
      salirDeReplay();
      toast('Rebobinado cancelado');
    }
  } catch (e) {
    toastError(e.message);
  }
}

function salirDeReplay() {
  replay = { activo: false, indice: 0, total: 0, nombreArchivo: null, timestamp: null, pausado: false };
  Store.rebobinando = false;
  Mapa.modoReplay(false);
  document.getElementById('replay-banner')?.remove();
  Mapa.renderizarTodo();
  renderSeccion();
}

function mostrarBannerReplay() {
  if (document.getElementById('replay-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'replay-banner';
  banner.className = 'replay-banner';
  banner.innerHTML = '⏪ <strong>MODO REBOBINADO</strong> — vista de solo lectura; el ejercicio sigue corriendo para el resto';
  document.body.appendChild(banner);
}

// ---------------------------------------------------------------------------
// Inicialización
// ---------------------------------------------------------------------------

export function init() {
  if (!Session.esAdmin()) return;

  Socket.on('ejercicio:rebobinar_tick', (frame) => {
    replay.activo = true;
    replay.indice = frame.indice ?? 0;
    replay.total = frame.total ?? replay.total;
    replay.nombreArchivo = frame.nombre_archivo ?? null;
    replay.timestamp = frame.timestamp ?? null;
    // Preview: NO se reemplaza el estado real.
    Mapa.renderFrame(frame.estado);
    if (seccion === 'tiempo') renderSeccion();
  });

  Socket.on('ejercicio:rebobinar_fin', ({ frames }) => {
    toast(`Rebobinado terminado (${frames} frame(s)). Fijá un frame o cancelá para volver al vivo.`);
    replay.pausado = true;
    if (seccion === 'tiempo') renderSeccion();
  });

  Socket.on('ejercicio:estados_lista', (respuesta) => {
    estadosGuardados = respuesta.estados || estadosGuardados;
    if (seccion === 'tiempo') renderSeccion();
  });

  Socket.on('admin:visibilidad_actualizada', (confirmacion) => {
    Store.aplicarCampos(confirmacion.entidad_tipo, confirmacion.entidad_id, { visible: confirmacion.visible });
  });

  Socket.on('ejercicio:unidad_creada', ({ unidad }) => {
    Store.agregarUnidad(unidad);
    toast(`Unidad "${unidad.nombre}" agregada al ejercicio`);
  });

  Socket.on('ejercicio:vehiculo_creado', ({ vehiculo }) => {
    Store.agregarVehiculo(vehiculo);
    toast(`Vehículo "${vehiculo.nombre || vehiculo.id}" agregado al ejercicio`);
  });

  Socket.on('ejercicio:unidad_modificada', (payload) => {
    if (payload.unidad) {
      Store.agregarUnidad(payload.unidad);
      return;
    }
    Store.aplicarCampos('unidad', payload.entidad_id, camposModificados(payload, CAMPOS_UNIDAD));
  });

  Socket.on('ejercicio:vehiculo_modificado', (payload) => {
    Store.aplicarCampos('vehiculo', payload.entidad_id, camposModificados(payload, CAMPOS_VEHICULO));
  });

  Store.on('estado', () => {
    if (seccion === 'entidades' || seccion === 'control' || seccion === 'boletin') renderSeccion();
  });
  Store.on('ejercicio:estado', () => {
    if (seccion === 'control') renderSeccion();
  });

  // Reposicionamiento por arrastre: el botón solo existe para el administrador.
  const botonArrastre = document.getElementById('mapa-arrastrar');
  if (botonArrastre) {
    botonArrastre.style.display = 'flex';
    botonArrastre.addEventListener('click', () => alternarArrastre());
  }
  // Un reemplazo de estado recrea las features: se rearma la interacción para
  // no quedar con claves de arrastre viejas.
  Socket.on('ejercicio:estado_inicial', () => {
    if (Mapa.arrastreActivo()) alternarArrastre(true, { silencioso: true });
  });

  render();
  window.simtacDireccion = { alternarVisibilidad, editarEntidad, alternarArrastre, render };
}

export default { init, alternarVisibilidad, editarEntidad, alternarArrastre };
