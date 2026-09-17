// Fase 2 — Catálogos dentro del panel de Administración del sistema.
//
// Cubre lo que `admin.js` no trae: armamento, plantillas de vehículo (con sus
// armas montadas) y vehículos instancia (con su asignación a una unidad o a
// otro vehículo).
//
// Se engancha al mismo modal que el resto de la administración: cada sección
// pinta dentro de su `.admin-table-view[data-table="…"]` y `admin.js` delega
// acá las tablas que no conoce (ver `loadTable`).
//
// ⚠️ Las cuatro vistas conviven en el DOM al mismo tiempo (se muestran con la
// clase `active`), así que TODA búsqueda va acotada al contenedor de la
// sección. Un `document.getElementById('cat-form')` devolvería el de la primera
// sección del documento, que está oculta.
//
// Dos cosas que el backend NO frena y hay que resolver en la UI:
//   · Los borrados cascadean: borrar una plantilla borra todas sus instancias.
//   · `POST /vehiculos/base/:id/armamentos` es idempotente: sirve para montar
//     un arma y para corregir su dotación.

import Api, { limpiar } from './api.js';
import Session from './session.js';
import Store from './store.js';
import Socket from './socket.js';
import Mapa from './mapa.js';
import { xyAMapa, mapaALonLat } from './geo.js';
import Simbolo from './simbolo.js';
import * as Sidc from './sidc.js';
import { esc, toast, toastError, toastExito, toastAviso, confirmar } from './ui.js';

/** Tablas que este módulo maneja dentro del modal de administración. */
export const TABLAS = ['armamento', 'vehiculos-base', 'vehiculos'];

/**
 * Tablas cuyo contenido pertenece a UN ejercicio. Comparten el selector de
 * contexto de la cabecera para que siempre esté a la vista cuál se está
 * modificando, y todas se ACOTAN a lo que elija ese selector.
 *
 * `participantes`, `unidades` y `asignaciones` las maneja admin.js. Las dos
 * últimas se acotan en el cliente: `unidad_militar` no tiene columna
 * `ejercicio` en la base, así que "qué unidades están en el ejercicio" se
 * resuelve cruzando sus controladores con los participantes (ver
 * `acotarUnidades` en admin.js). Los vehículos, en cambio, sí se filtran en
 * el servidor con `?ejercicioId=`.
 */
export const TABLAS_EJERCICIO = [
  'participantes', 'unidades', 'vehiculos', 'asignaciones',
];

export function maneja(tabla) {
  return TABLAS.includes(tabla);
}

export function esDeEjercicio(tabla) {
  return TABLAS_EJERCICIO.includes(tabla);
}

const TIPOS_VEHICULO = ['tierra', 'aire', 'mar', 'anfibio'];
const TIPOS_ATAQUE = ['tierra', 'aire', 'mar'];

/** Default del backend cuando no se manda `rango_vision_m` al crear. */
const VISION_POR_DEFECTO = { tierra: 10000, anfibio: 10000, aire: 15000, mar: 15000 };

let datos = {
  armamento: [],
  vehiculosBase: [],
  vehiculos: [],
  ejercicios: [],
  unidades: [],
};
let ejercicioFiltro = '';   // los vehículos se listan por ejercicio
/**
 * Mientras el admin no haya elegido un ejercicio a mano en la barra de
 * contexto, `ejercicioFiltro` sigue al que está en vivo en el mapa
 * (`Store.ejercicioId`) — así lo que se crea/edita en Administración se ve
 * en el mapa sin tener que sincronizar los dos selectores por las suyas.
 * Una vez que el admin elige algo a mano (aunque sea "Todos"), se respeta esa
 * elección: sigue siendo posible preparar el catálogo de OTRO ejercicio
 * mientras uno distinto está en vivo.
 */
let contextoElegidoManualmente = false;
let dibujo = null;          // captura de puntos sobre el mapa

/**
 * Cambios de armamento pendientes de guardar, por plantilla:
 *   baseId -> { montar: Map<armamentoId, municion>, desmontar: Set<armamentoId> }
 * Se acumulan en memoria para poder asignar varias armas de una y recién
 * después mandarlas todas.
 */
const pendientes = new Map();

function pendienteDe(baseId) {
  const k = String(baseId);
  if (!pendientes.has(k)) pendientes.set(k, { montar: new Map(), desmontar: new Set() });
  return pendientes.get(k);
}

function tieneCambios(baseId) {
  const p = pendientes.get(String(baseId));
  return !!p && (p.montar.size > 0 || p.desmontar.size > 0);
}

/**
 * Los ids de relación viajan en camelCase en los cuerpos POST documentados
 * (`usuarioId`, `armamentoId`) mientras que las respuestas usan snake_case.
 * Se mandan las dos formas: la que el backend no conozca la ignora.
 */
function fk(nombreSnake, valor) {
  if (valor === '' || valor === null || valor === undefined) return {};
  const camel = nombreSnake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  return { [nombreSnake]: Number(valor), [camel]: Number(valor) };
}

function vista(tabla) {
  return document.querySelector(`.admin-table-view[data-table="${tabla}"]`);
}

// ---------------------------------------------------------------------------
// Herencia del padre (bando y posición base)
//
// El vehículo ya no pide bando ni posición: los hereda de a quién está asignado
// (unidad, o vehículo portador → su unidad). Ver backend.md, puntos 6, 7 y 8.
//
// Mientras el backend siga exigiendo `bando` y `posicion_*` en el POST, la
// cadena la resuelve el cliente acá y los manda igual. Cuando el backend los
// derive por su cuenta, esta sección entera se borra.
// ---------------------------------------------------------------------------

/** ejercicioId -> participantes. El bando vive en `ejercicio_usuario`. */
const participantesPorEjercicio = new Map();

async function participantesDe(ejercicioId) {
  const k = String(ejercicioId);
  if (!participantesPorEjercicio.has(k)) {
    participantesPorEjercicio.set(k, await Api.ejercicios.participantes(ejercicioId).catch(() => []));
  }
  return participantesPorEjercicio.get(k);
}

/** Id de usuario en filas que a veces traen `id` y a veces `usuario_id`. */
function idUsuario(fila) {
  const id = fila?.id ?? fila?.usuario_id;
  return id === null || id === undefined ? '' : String(id);
}

/**
 * unidadId -> bando. Se arma una vez por carga de tabla; sin esto habría que
 * pedir los controladores de cada unidad en cada celda que quiera pintar el
 * símbolo con su afiliación.
 */
let bandoPorUnidad = new Map();

/**
 * Resuelve el bando de todas las unidades del ejercicio en contexto.
 *
 * El bando NO es de la unidad: es del jugador que la controla, y un jugador
 * puede ser azul en un ejercicio y rojo en otro. Por eso sin ejercicio elegido
 * no se puede derivar nada.
 */
async function resolverBandosDeUnidades() {
  bandoPorUnidad = new Map();
  if (!ejercicioFiltro) return;

  const participantes = await participantesDe(ejercicioFiltro);
  const bandoPorUsuario = new Map(participantes.map((p) => [idUsuario(p), p.bando]));

  await Promise.all(datos.unidades.map(async (u) => {
    if (u.bando) {                       // si la API ya lo resuelve, no se pide nada
      bandoPorUnidad.set(String(u.id), u.bando);
      return;
    }
    const controladores = await Api.unidades.controladores(u.id).catch(() => []);
    const bando = controladores.map((c) => bandoPorUsuario.get(idUsuario(c))).find(Boolean);
    if (bando) bandoPorUnidad.set(String(u.id), bando);
  }));
}

/** Bando de una unidad ya resuelto, o null si no tiene controlador acá. */
function bandoDeUnidad(unidadId) {
  return bandoPorUnidad.get(String(unidadId)) ?? null;
}

/**
 * Bando de una unidad en un ejercicio puntual. A diferencia de `bandoDeUnidad`
 * (que lee el cache `bandoPorUnidad`, siempre atado a `ejercicioFiltro`, el
 * selector de contexto de la CABECERA), esto resuelve contra el
 * `ejercicioId` que se le pasa. Lo necesita el formulario de alta/edición de
 * vehículo: tiene su PROPIO selector de ejercicio, independiente del filtro
 * de cabecera, así que no puede asumir que son el mismo.
 */
async function bandoDeUnidadEnEjercicio(unidadId, ejercicioId) {
  if (!unidadId || !ejercicioId) return null;
  if (String(ejercicioId) === String(ejercicioFiltro)) return bandoDeUnidad(unidadId);
  const participantes = await participantesDe(ejercicioId);
  const bandoPorUsuario = new Map(participantes.map((p) => [idUsuario(p), p.bando]));
  const controladores = await Api.unidades.controladores(unidadId).catch(() => []);
  return controladores.map((c) => bandoPorUsuario.get(idUsuario(c))).find(Boolean) ?? null;
}

/**
 * Bando de un vehículo. `GET /vehiculos` ya lo devuelve resuelto
 * (`frontend.md`, fase 2): si no vino en la fila (registro todavía no
 * guardado, usado para la previsualización del form), sube por la cadena de
 * asignación (`unidad_padre_tipo`/`unidad_padre_id`) hasta dar con una unidad.
 * `vistos` corta los ciclos de transporte (A lleva a B, B lleva a A).
 */
function bandoDeVehiculo(vehiculo, vistos = new Set()) {
  if (!vehiculo || vistos.has(String(vehiculo.id))) return null;
  if (vehiculo.bando) return vehiculo.bando;
  vistos.add(String(vehiculo.id));
  if (vehiculo.unidad_padre_tipo === 'unidad_militar') return bandoDeUnidad(vehiculo.unidad_padre_id);
  if (vehiculo.unidad_padre_tipo === 'vehiculo_militar') {
    const padre = datos.vehiculos.find((v) => String(v.id) === String(vehiculo.unidad_padre_id));
    return bandoDeVehiculo(padre, vistos);
  }
  return null;                            // sin asignar: no hay de dónde sacarlo
}

/** Primera coordenada disponible de un registro (unidad o vehículo). */
function posicionDe(registro) {
  const x = registro?.posicion_x ?? registro?.pos_x;
  const y = registro?.posicion_y ?? registro?.pos_y;
  return x === null || x === undefined || y === null || y === undefined
    ? null
    : { x: Number(x), y: Number(y) };
}

/**
 * Bando y posición que le corresponden a un vehículo por su asignación.
 * Devuelve `{ bando, posicion }`; cualquiera de los dos puede venir en null si
 * la cadena está incompleta (unidad sin controlador, padre sin posición).
 */
async function heredadoDelPadre({ asignadoA, unidadId, vehiculoPadreId, ejercicioId }) {
  if (asignadoA === 'vehiculo') {
    const padre = datos.vehiculos.find((v) => String(v.id) === String(vehiculoPadreId));
    return { bando: bandoDeVehiculo(padre), posicion: posicionDe(padre) };
  }
  const unidad = datos.unidades.find((u) => String(u.id) === String(unidadId));
  return { bando: await bandoDeUnidadEnEjercicio(unidadId, ejercicioId), posicion: posicionDe(unidad) };
}

// ---------------------------------------------------------------------------
// Entrada desde admin.js
// ---------------------------------------------------------------------------

/** Carga del servidor y pinta. `admin.js` la llama desde `loadTable`. */
export async function cargar(tabla) {
  const cont = vista(tabla);
  if (!cont) return;
  cont.innerHTML = '<div class="cat-cargando">Cargando…</div>';

  try {
    if (!datos.ejercicios.length) {
      datos.ejercicios = await Api.ejercicios.listar().catch(() => []);
    }

    if (tabla === 'armamento') {
      datos.armamento = await Api.armamento.listar();
      renderArmamento(cont);
    } else if (tabla === 'vehiculos-base') {
      [datos.vehiculosBase, datos.armamento] = await Promise.all([
        Api.vehiculosBase.listar(),
        Api.armamento.listar().catch(() => datos.armamento),
      ]);
      pendientes.clear();   // lo que llegó del servidor es la nueva verdad
      renderVehiculosBase(cont);
    } else if (tabla === 'vehiculos') {
      // El bando sale de los participantes: si cambiaron en Administración, el
      // cache tiene que caducar o se hereda un bando viejo.
      participantesPorEjercicio.clear();
      [datos.vehiculos, datos.vehiculosBase, datos.unidades] = await Promise.all([
        Api.vehiculos.listar(ejercicioFiltro || undefined),
        Api.vehiculosBase.listar(),
        Api.unidades.listar().catch(() => []),
      ]);
      // Necesita `datos.unidades` ya cargado: va después, no en el Promise.all.
      await resolverBandosDeUnidades();
      renderVehiculos(cont);
      // El mapa/panel no se enteran de altas o ediciones de vehículo por REST
      // (no hay evento de socket para eso): si este es el ejercicio que está
      // en vivo en el mapa, se reconcilia acá para que aparezcan sin depender
      // de en qué momento se guardaron.
      if (ejercicioFiltro && Number(ejercicioFiltro) === Store.ejercicioId) {
        Store.sincronizarVehiculos(datos.vehiculos);
      }
    }
  } catch (e) {
    cont.innerHTML = `<div class="cat-error">No se pudo cargar: ${esc(e.message)}</div>`;
  }
}

const recargar = (tabla) => cargar(tabla);

// ---------------------------------------------------------------------------
// Piezas comunes
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Contexto de ejercicio
//
// Las secciones del grupo "Ejercicio" (participantes, unidades, vehículos,
// asignaciones) trabajan sobre un ejercicio concreto. El selector vive UNA
// sola vez en la cabecera del modal para que siempre se vea sobre cuál se
// está operando, y al cambiarlo se recarga la tabla abierta acotada a él.
// ---------------------------------------------------------------------------

/** Id del ejercicio en contexto ('' = todos). */
export function ejercicioActual() {
  return ejercicioFiltro;
}

export function ejercicioActualNombre() {
  const e = datos.ejercicios.find((x) => String(x.id) === String(ejercicioFiltro));
  return e?.nombre ?? null;
}

/**
 * Dibuja (o esconde) la barra de contexto según la tabla activa.
 * `alCambiar` se ejecuta cuando el usuario elige otro ejercicio.
 */
export async function montarContexto(tabla, alCambiar) {
  const barra = document.getElementById('admin-contexto-ejercicio');
  if (!barra) return;

  if (!esDeEjercicio(tabla)) {
    barra.classList.remove('visible');
    barra.innerHTML = '';
    return;
  }

  if (!contextoElegidoManualmente && !ejercicioFiltro && Store.ejercicioId) {
    ejercicioFiltro = String(Store.ejercicioId);
  }

  if (!datos.ejercicios.length) {
    datos.ejercicios = await Api.ejercicios.listar().catch(() => []);
  }

  const elegido = datos.ejercicios.find((e) => String(e.id) === String(ejercicioFiltro));
  barra.classList.add('visible');
  barra.innerHTML = `
    <div class="admin-contexto-principal">
      <span class="admin-contexto-etiqueta">Modificando el ejercicio</span>
      <select class="admin-contexto-select" data-rol="contexto-ejercicio">
        <option value="">— Todos los ejercicios —</option>
        ${datos.ejercicios.map((e) => `
          <option value="${esc(e.id)}" ${String(e.id) === String(ejercicioFiltro) ? 'selected' : ''}>
            ${esc(e.nombre)}${e.activo ? '' : ' (inactivo)'}
          </option>`).join('')}
      </select>
    </div>
    <div class="admin-contexto-meta">
      ${elegido
        ? `<span class="admin-contexto-detalle">
             Sala ${esc(elegido.sala || '--')} ·
             ×${Math.round(Number(elegido.velocidad_ejercicio ?? 1))} ·
             <span class="${elegido.activo ? 'estado-activo' : 'estado-detenido'}">
               ${elegido.activo ? 'activo' : 'inactivo'}
             </span>
           </span>`
        : '<span class="admin-contexto-detalle admin-contexto-aviso">Elegí un ejercicio para acotar lo que ves y lo que creás.</span>'}
    </div>
  `;

  barra.querySelector('[data-rol="contexto-ejercicio"]').addEventListener('change', (evento) => {
    ejercicioFiltro = evento.target.value;
    contextoElegidoManualmente = true;
    montarContexto(tabla, alCambiar);
    alCambiar?.(ejercicioFiltro);
  });
}

/** Se llama tras crear/borrar un ejercicio para que el selector se entere. */
export function invalidarEjercicios() {
  datos.ejercicios = [];
}

/** Contenedor del formulario de la sección (siempre acotado al pane). */
function zonaForm(cont) {
  return cont.querySelector('[data-rol="form"]');
}

function campoTexto(nombre, etiqueta, valor, requerido = false) {
  return `
    <label class="cat-campo">
      <span>${esc(etiqueta)}</span>
      <input type="text" name="${nombre}" class="cat-input" value="${esc(valor ?? '')}" ${requerido ? 'required' : ''}>
    </label>`;
}

function campoNumero(nombre, etiqueta, valor, paso) {
  return `
    <label class="cat-campo">
      <span>${esc(etiqueta)}</span>
      <input type="number" name="${nombre}" class="cat-input" value="${esc(valor ?? '')}" ${paso ? `step="${paso}"` : ''}>
    </label>`;
}

function campoSelect(nombre, etiqueta, opciones, valor) {
  return `
    <label class="cat-campo">
      <span>${esc(etiqueta)}</span>
      <select name="${nombre}" class="cat-input">
        ${opciones.map((o) => `<option value="${o}" ${o === valor ? 'selected' : ''}>${o}</option>`).join('')}
      </select>
    </label>`;
}

/** Toma los campos del form descartando vacíos: el backend actualiza lo que llega. */
function valoresDelForm(form, excluir = []) {
  const salida = {};
  for (const campo of form.elements) {
    if (!campo.name || excluir.includes(campo.name)) continue;
    const valor = campo.type === 'number'
      ? (campo.value === '' ? '' : Number(campo.value))
      : (campo.value.trim?.() ?? campo.value);
    salida[campo.name] = valor;
  }
  return limpiar(salida);
}

/** Todo borrado pasa por acá: la API cascadea sin devolver 409. */
async function borrar(recurso, tabla, id, alcance) {
  const nombres = {
    armamento: 'el armamento',
    vehiculosBase: 'la plantilla de vehículo',
    vehiculos: 'el vehículo',
  };
  if (!confirmar(`¿Borrar ${nombres[recurso]} #${id}?`, alcance)) return;
  try {
    await Api[recurso].borrar(id);
    toastExito('Borrado');
    recargar(tabla);
  } catch (e) {
    toastError(e.message);
  }
}

/** Vista previa del símbolo junto a un campo SIDC. */
function conectarPreviewSidc(form) {
  const input = form.querySelector('[name="sidc"]');
  const preview = form.querySelector('.cat-sidc-preview');
  if (!input || !preview) return;
  const dibujar = () => Simbolo.pintar(preview, input.value.trim(), { size: 40, alto: 50 });
  input.addEventListener('input', dibujar);
  dibujar();
}

function campoSidc(valor) {
  return `
    <label class="cat-campo cat-campo-ancho">
      <span>SIDC (símbolo táctico)</span>
      <div class="cat-sidc-fila">
        <input type="text" name="sidc" class="cat-input" value="${esc(valor ?? '')}" placeholder="10031000161211000000">
        <div class="cat-sidc-preview"></div>
      </div>
    </label>`;
}

// ---------------------------------------------------------------------------
// Armamento
// ---------------------------------------------------------------------------

function renderArmamento(cont) {
  cont.innerHTML = `
    <div class="admin-actions">
      <button class="admin-new-btn" data-rol="nuevo">+ Nuevo Armamento</button>
      <span class="cat-nota">Sistemas de armas que después se montan en las plantillas de vehículo.</span>
    </div>
    <div data-rol="form"></div>
    <table class="admin-data-table">
      <thead>
        <tr><th>ID</th><th>Nombre</th><th>Cadencia</th><th>Daño unid.</th><th>Daño veh.</th><th>Tipo de ataque</th><th>Alcance</th><th>Acciones</th></tr>
      </thead>
      <tbody>
        ${datos.armamento.map((a) => `
          <tr>
            <td>${esc(a.id)}</td>
            <td>${esc(a.nombre)}</td>
            <td>${esc(a.cadencia_disparo_seg ?? '--')} s</td>
            <td>${esc(a.danio_unidades_pct ?? '--')}%</td>
            <td>${esc(a.danio_vehiculos_pct ?? '--')}%</td>
            <td><span class="cat-chip">${esc(a.tipo_ataque || '--')}</span></td>
            <td>${a.alcance_m ? `${esc(a.alcance_m)} m` : '--'}</td>
            <td>
              <button class="admin-edit-btn" data-editar="${esc(a.id)}">Editar</button>
              <button class="admin-delete-btn" data-borrar="${esc(a.id)}">Eliminar</button>
            </td>
          </tr>`).join('') || '<tr><td colspan="8" class="cat-vacio">Sin armamento cargado</td></tr>'}
      </tbody>
    </table>
  `;

  cont.querySelector('[data-rol="nuevo"]').addEventListener('click', () => formArmamento(cont, null));
  cont.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () =>
    formArmamento(cont, datos.armamento.find((a) => String(a.id) === b.dataset.editar))));
  cont.querySelectorAll('[data-borrar]').forEach((b) => b.addEventListener('click', () =>
    borrar('armamento', 'armamento', b.dataset.borrar,
      'Se desmonta de todas las plantillas de vehículo que lo tengan.')));
}

function formArmamento(cont, registro) {
  const zona = zonaForm(cont);
  zona.innerHTML = `
    <form class="cat-form">
      <h3>${registro ? `Editar «${esc(registro.nombre)}»` : 'Nuevo armamento'}</h3>
      <div class="cat-grid">
        ${campoTexto('nombre', 'Nombre', registro?.nombre, true)}
        ${campoSelect('tipo_ataque', 'Tipo de ataque', TIPOS_ATAQUE, registro?.tipo_ataque)}
        ${campoNumero('cadencia_disparo_seg', 'Cadencia (seg entre disparos)', registro?.cadencia_disparo_seg, 'any')}
        ${campoNumero('alcance_m', 'Alcance (m)', registro?.alcance_m)}
        ${campoNumero('danio_unidades_pct', 'Daño a unidades (%)', registro?.danio_unidades_pct, 'any')}
        ${campoNumero('danio_vehiculos_pct', 'Daño a vehículos (%)', registro?.danio_vehiculos_pct, 'any')}
      </div>
      <p class="cat-nota">
        Un arma <strong>tierra</strong> no puede batir a un vehículo <strong>aire</strong>:
        el motor compara <code>tipo_ataque</code> con el tipo del objetivo.
      </p>
      <div class="cat-form-acciones">
        <button type="submit" class="admin-submit-btn">Guardar</button>
        <button type="button" class="admin-cancel-btn" data-rol="cancelar">Cancelar</button>
      </div>
    </form>
  `;

  zona.querySelector('[data-rol="cancelar"]').addEventListener('click', () => { zona.innerHTML = ''; });
  zona.querySelector('form').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const cuerpo = valoresDelForm(evento.target);
    try {
      if (registro) await Api.armamento.actualizar(registro.id, cuerpo);
      else await Api.armamento.crear(cuerpo);
      toastExito(registro ? 'Armamento actualizado' : 'Armamento creado');
      recargar('armamento');
    } catch (e) {
      toastError(e.message);
    }
  });
}

// ---------------------------------------------------------------------------
// Plantillas de vehículo + asignación de armamento
//
// El armamento se arma en memoria: se pueden agregar y quitar varias armas y
// recién al tocar «Guardar armamento» se mandan todas. Mientras haya cambios
// sin guardar la tarjeta queda marcada.
// ---------------------------------------------------------------------------

/** Armas de una plantilla ya combinadas con lo pendiente, para pintar. */
function armamentoEfectivo(base) {
  const pend = pendientes.get(String(base.id));
  const filas = [];

  for (const arma of base.armamentos || []) {
    const id = String(arma.armamento_id);
    if (pend?.desmontar.has(id)) {
      filas.push({ ...arma, estado: 'quitar' });
    } else if (pend?.montar.has(id)) {
      filas.push({ ...arma, municion: pend.montar.get(id), estado: 'modificado' });
    } else {
      filas.push({ ...arma, estado: 'guardado' });
    }
  }

  // Armas nuevas: están en pendientes pero no en la plantilla del servidor.
  const yaEstan = new Set((base.armamentos || []).map((a) => String(a.armamento_id)));
  for (const [id, municion] of pend?.montar ?? []) {
    if (yaEstan.has(id)) continue;
    const cat = datos.armamento.find((a) => String(a.id) === id);
    filas.push({
      armamento_id: id,
      nombre: cat?.nombre || `armamento ${id}`,
      tipo_ataque: cat?.tipo_ataque,
      cadencia_disparo_seg: cat?.cadencia_disparo_seg,
      danio_unidades_pct: cat?.danio_unidades_pct,
      danio_vehiculos_pct: cat?.danio_vehiculos_pct,
      municion,
      estado: 'nuevo',
    });
  }
  return filas;
}

const ETIQUETA_ESTADO = {
  nuevo: 'sin guardar',
  modificado: 'modificado',
  quitar: 'se va a quitar',
};

function renderVehiculosBase(cont) {
  cont.innerHTML = `
    <div class="admin-actions">
      <button class="admin-new-btn" data-rol="nuevo">+ Nueva Plantilla</button>
      <span class="cat-nota">
        El <strong>tipo</strong> decide cómo se mueve: <code>tierra</code> y <code>anfibio</code>
        siguen rutas del servidor; <code>aire</code> y <code>mar</code> reciben waypoints libres.
      </span>
    </div>
    <div data-rol="form"></div>
    <div class="cat-tarjetas">
      ${datos.vehiculosBase.map((v) => {
        const armas = armamentoEfectivo(v);
        const sucia = tieneCambios(v.id);
        return `
        <div class="cat-tarjeta ${sucia ? 'cat-tarjeta-sucia' : ''}">
          <div class="cat-tarjeta-head">
            <span class="cat-tarjeta-simbolo">${Simbolo.marca(v.sidc, { size: 30, alto: 38 })}</span>
            <span class="cat-tarjeta-nombre">${esc(v.nombre)}</span>
            <span class="cat-chip cat-chip-${esc(v.tipo)}">${esc(v.tipo)}</span>
          </div>
          <div class="cat-tarjeta-sidc"><code>${esc(v.sidc || 'sin SIDC')}</code></div>
          <div class="cat-tarjeta-meta">
            <span>Vel. ${esc(v.velocidad_desplazamiento ?? '--')} km/h</span>
            <span>Umbral daño ${esc(v.umbral_danio ?? '--')}</span>
            <span>Visión ${esc(v.rango_vision_m ?? '--')} m</span>
          </div>

          <div class="cat-armas">
            <div class="cat-armas-titulo">
              Armamento montado (${armas.filter((a) => a.estado !== 'quitar').length})
              ${sucia ? '<span class="cat-badge-sucio">● cambios sin guardar</span>' : ''}
            </div>
            ${armas.length
              ? armas.map((a) => `
                <div class="cat-arma cat-arma-${a.estado}">
                  <span>${esc(a.nombre)}</span>
                  <span class="cat-arma-meta">
                    ${esc(a.tipo_ataque ?? '--')} · ${esc(a.cadencia_disparo_seg ?? '--')} s ·
                    ${esc(a.danio_unidades_pct ?? '--')}% / ${esc(a.danio_vehiculos_pct ?? '--')}%
                  </span>
                  <span class="cat-arma-mun">${esc(a.municion ?? 0)} mun.</span>
                  ${a.estado !== 'guardado'
                    ? `<span class="cat-arma-estado">${ETIQUETA_ESTADO[a.estado]}</span>`
                    : ''}
                  ${a.estado === 'quitar'
                    ? `<button class="cat-mini" data-deshacer="${esc(v.id)}:${esc(a.armamento_id)}" title="Deshacer">↺</button>`
                    : `<button class="cat-mini cat-mini-alerta" data-quitar-arma="${esc(v.id)}:${esc(a.armamento_id)}" title="Quitar">✕</button>`}
                </div>`).join('')
              : '<div class="cat-vacio">Sin armas montadas</div>'}

            <div class="cat-montar">
              <select class="cat-input cat-input-corto" data-arma-de="${esc(v.id)}">
                ${datos.armamento.map((a) => `<option value="${esc(a.id)}">${esc(a.nombre)}</option>`).join('')
                  || '<option value="">Cargá armamento primero</option>'}
              </select>
              <input type="number" min="0" class="cat-input cat-input-corto" placeholder="munición" data-mun-de="${esc(v.id)}">
              <button class="cat-mini" data-agregar-arma="${esc(v.id)}" title="Agregar a la lista (no guarda todavía)">⊕ Agregar</button>
            </div>

            <div class="cat-armas-acciones">
              <button class="admin-submit-btn" data-guardar-armas="${esc(v.id)}" ${sucia ? '' : 'disabled'}>
                💾 Guardar armamento
              </button>
              <button class="admin-cancel-btn" data-descartar-armas="${esc(v.id)}" ${sucia ? '' : 'disabled'}>
                Descartar cambios
              </button>
            </div>
          </div>

          <div class="cat-tarjeta-acciones">
            <button class="admin-edit-btn" data-editar="${esc(v.id)}">Editar</button>
            <button class="admin-delete-btn" data-borrar="${esc(v.id)}">Eliminar</button>
          </div>
        </div>`;
      }).join('') || '<div class="cat-vacio">Sin plantillas de vehículo</div>'}
    </div>
  `;

  cont.querySelector('[data-rol="nuevo"]').addEventListener('click', () => formVehiculoBase(cont, null));
  cont.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () =>
    formVehiculoBase(cont, datos.vehiculosBase.find((v) => String(v.id) === b.dataset.editar))));
  cont.querySelectorAll('[data-borrar]').forEach((b) => b.addEventListener('click', () =>
    borrar('vehiculosBase', 'vehiculos-base', b.dataset.borrar,
      'Se borran TODOS los vehículos creados desde esta plantilla y sus asignaciones. La API no lo frena.')));

  // --- Edición del armamento en memoria ---

  cont.querySelectorAll('[data-agregar-arma]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.agregarArma;
    const armamentoId = cont.querySelector(`[data-arma-de="${id}"]`)?.value;
    const municion = cont.querySelector(`[data-mun-de="${id}"]`)?.value;
    if (!armamentoId) return toastError('Elegí un armamento');

    const pend = pendienteDe(id);
    pend.desmontar.delete(String(armamentoId));
    pend.montar.set(String(armamentoId), municion === '' ? null : Number(municion));
    renderVehiculosBase(cont);
  }));

  cont.querySelectorAll('[data-quitar-arma]').forEach((b) => b.addEventListener('click', () => {
    const [baseId, armamentoId] = b.dataset.quitarArma.split(':');
    const pend = pendienteDe(baseId);
    const base = datos.vehiculosBase.find((v) => String(v.id) === baseId);
    const estabaEnServidor = (base?.armamentos || []).some((a) => String(a.armamento_id) === armamentoId);

    pend.montar.delete(armamentoId);
    // Si nunca se guardó, alcanza con sacarla de lo pendiente.
    if (estabaEnServidor) pend.desmontar.add(armamentoId);
    if (!pend.montar.size && !pend.desmontar.size) pendientes.delete(String(baseId));
    renderVehiculosBase(cont);
  }));

  cont.querySelectorAll('[data-deshacer]').forEach((b) => b.addEventListener('click', () => {
    const [baseId, armamentoId] = b.dataset.deshacer.split(':');
    const pend = pendienteDe(baseId);
    pend.desmontar.delete(armamentoId);
    if (!pend.montar.size && !pend.desmontar.size) pendientes.delete(String(baseId));
    renderVehiculosBase(cont);
  }));

  cont.querySelectorAll('[data-descartar-armas]').forEach((b) => b.addEventListener('click', () => {
    pendientes.delete(String(b.dataset.descartarArmas));
    renderVehiculosBase(cont);
    toast('Cambios de armamento descartados');
  }));

  cont.querySelectorAll('[data-guardar-armas]').forEach((b) => b.addEventListener('click', () =>
    guardarArmamento(cont, b.dataset.guardarArmas, b)));
}

/** Manda al backend todos los cambios de armamento acumulados de una plantilla. */
async function guardarArmamento(cont, baseId, boton) {
  const pend = pendientes.get(String(baseId));
  if (!pend) return;

  boton.disabled = true;
  boton.textContent = 'Guardando…';

  const errores = [];
  // Primero las bajas, después las altas: si se reemplaza un arma por otra el
  // orden evita que un desmontaje posterior pise el montaje nuevo.
  for (const armamentoId of pend.desmontar) {
    try {
      await Api.vehiculosBase.desmontarArmamento(baseId, armamentoId);
    } catch (e) {
      errores.push(`desmontar ${armamentoId}: ${e.message}`);
    }
  }
  for (const [armamentoId, municion] of pend.montar) {
    try {
      // Idempotente: si ya estaba montado, actualiza la munición.
      await Api.vehiculosBase.montarArmamento(baseId, Number(armamentoId),
        municion === null ? undefined : Number(municion));
    } catch (e) {
      errores.push(`montar ${armamentoId}: ${e.message}`);
    }
  }

  if (errores.length) {
    toastError(`Hubo errores: ${errores.join(' · ')}`);
  } else {
    toastExito('Armamento guardado');
  }
  // Se recarga igual: el servidor es la verdad y `cargar` limpia lo pendiente.
  await recargar('vehiculos-base');
}

function formVehiculoBase(cont, registro) {
  const zona = zonaForm(cont);
  zona.innerHTML = `
    <form class="cat-form">
      <h3>${registro ? `Editar «${esc(registro.nombre)}»` : 'Nueva plantilla de vehículo'}</h3>
      <div class="cat-grid">
        ${campoTexto('nombre', 'Nombre', registro?.nombre, true)}
        ${campoSelect('tipo', 'Tipo', TIPOS_VEHICULO, registro?.tipo)}
        ${campoSidc(registro?.sidc)}
        ${campoNumero('velocidad_desplazamiento', 'Velocidad (km/h)', registro?.velocidad_desplazamiento, 'any')}
        ${campoNumero('umbral_danio', 'Umbral de daño', registro?.umbral_danio, 'any')}
        ${campoNumero('rango_vision_m', 'Rango de visión (m)', registro?.rango_vision_m)}
        ${campoNumero('autonomia', 'Autonomía (km)', registro?.autonomia, 'any')}
      </div>
      <p class="cat-nota" data-rol="nota-vision"></p>
      <div class="cat-form-acciones">
        <button type="submit" class="admin-submit-btn">Guardar</button>
        <button type="button" class="admin-cancel-btn" data-rol="cancelar">Cancelar</button>
      </div>
    </form>
  `;

  const form = zona.querySelector('form');
  conectarPreviewSidc(form);

  const notaVision = () => {
    const tipo = form.elements.tipo.value;
    zona.querySelector('[data-rol="nota-vision"]').innerHTML =
      `Si dejás el rango de visión vacío, el backend usa el default del tipo <strong>${esc(tipo)}</strong>: ${VISION_POR_DEFECTO[tipo]} m.`;
  };
  form.elements.tipo.addEventListener('change', notaVision);
  notaVision();

  zona.querySelector('[data-rol="cancelar"]').addEventListener('click', () => { zona.innerHTML = ''; });
  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const cuerpo = valoresDelForm(evento.target);
    try {
      if (registro) await Api.vehiculosBase.actualizar(registro.id, cuerpo);
      else await Api.vehiculosBase.crear(cuerpo);
      toastExito(registro ? 'Plantilla actualizada' : 'Plantilla creada');
      recargar('vehiculos-base');
    } catch (e) {
      toastError(e.message);
    }
  });
}

// ---------------------------------------------------------------------------
// Vehículos (instancias) + asignación a unidad o a otro vehículo
// ---------------------------------------------------------------------------

function plantillaDe(vehiculo) {
  return datos.vehiculosBase.find((b) => String(b.id) === String(vehiculo.vehiculo_base_id));
}

/** SIDC efectivo: el de la instancia, o el de su plantilla si no tiene propio. */
function sidcDeVehiculo(vehiculo) {
  return vehiculo.sidc || plantillaDe(vehiculo)?.sidc || '';
}

/** A qué está asignado el vehículo: una unidad, otro vehículo o nada. */
function asignacionDe(vehiculo) {
  if (vehiculo.unidad_padre_tipo === 'unidad_militar') {
    const unidad = datos.unidades.find((u) => String(u.id) === String(vehiculo.unidad_padre_id));
    return `<span class="cat-chip cat-chip-unidad">🎖️ ${esc(unidad?.nombre || `unidad ${vehiculo.unidad_padre_id}`)}</span>`;
  }
  if (vehiculo.unidad_padre_tipo === 'vehiculo_militar') {
    const padre = datos.vehiculos.find((v) => String(v.id) === String(vehiculo.unidad_padre_id));
    return `<span class="cat-chip cat-chip-vehiculo">🚙 ${esc(padre?.nombre || `vehículo ${vehiculo.unidad_padre_id}`)}</span>`;
  }
  // Estado inválido según el modelo: sin padre no hay bando ni posición base.
  return '<span class="cat-chip cat-chip-alerta" title="Un vehículo siempre debe estar asignado a una unidad o a otro vehículo">⚠ Sin asignar</span>';
}

/** Celda de bando derivado, con el aviso de por qué falta cuando falta. */
function celdaBando(bando, { sinAsignar = false } = {}) {
  if (bando) {
    return `<span class="cat-chip bando-${esc(String(bando).toLowerCase())}">${esc(bando)}</span>`;
  }
  const motivo = sinAsignar
    ? 'Sin asignar: el bando se hereda de la unidad o del vehículo portador'
    : ejercicioFiltro
      ? 'La unidad no tiene un jugador que participe de este ejercicio'
      : 'Elegí un ejercicio arriba: el bando depende de en cuál participa el jugador';
  return `<span class="cat-chip cat-chip-alerta" title="${esc(motivo)}">— sin bando</span>`;
}

function renderVehiculos(cont) {
  const sinPlantillas = !datos.vehiculosBase.length;
  const sinEjercicios = !datos.ejercicios.length;

  cont.innerHTML = `
    <div class="admin-actions">
      <button class="admin-new-btn" data-rol="nuevo" ${sinPlantillas || sinEjercicios ? 'disabled' : ''}>
        + Nuevo Vehículo
      </button>
      <span class="cat-nota">Hereda la munición de su plantilla si no indicás <code>municion_actual</code>.</span>
    </div>
    ${sinPlantillas ? '<div class="cat-error">Para crear un vehículo primero necesitás al menos una <strong>plantilla de vehículo</strong>.</div>' : ''}
    ${sinEjercicios ? '<div class="cat-error">Para crear un vehículo primero necesitás al menos un <strong>ejercicio</strong>.</div>' : ''}
    <div data-rol="form"></div>
    <table class="admin-data-table">
      <thead>
        <tr><th>ID</th><th>Símbolo</th><th>Plantilla</th><th>Bando</th><th>Asignado a</th><th>Posición (x, y)</th><th>Estado</th><th>Acciones</th></tr>
      </thead>
      <tbody>
        ${datos.vehiculos.map((v) => {
          // GET /vehiculos ya devuelve el bando resuelto; con él se reescribe
          // el dígito de afiliación del SIDC antes de dibujarlo.
          const bando = bandoDeVehiculo(v);
          const sinAsignar = !v.unidad_padre_tipo;
          const sidc = Sidc.conBando(sidcDeVehiculo(v), bando);
          return `
          <tr${sinAsignar ? ' class="cat-fila-alerta"' : ''}>
            <td>${esc(v.id)}</td>
            <td class="admin-simbolo-celda">${Simbolo.marca(sidc, { size: 28, alto: 34 })}</td>
            <td>${esc(plantillaDe(v)?.nombre || v.vehiculo_base_id || '--')}</td>
            <td>${celdaBando(bando, { sinAsignar })}</td>
            <td>${asignacionDe(v)}</td>
            <td>${esc(v.posicion_x ?? '--')}, ${esc(v.posicion_y ?? '--')}</td>
            <td>${esc(v.estado_actual || 'activo')}</td>
            <td>
              <button class="admin-edit-btn" data-editar="${esc(v.id)}">Editar</button>
              <button class="admin-delete-btn" data-borrar="${esc(v.id)}">Eliminar</button>
            </td>
          </tr>`;
        }).join('') || '<tr><td colspan="8" class="cat-vacio">Sin vehículos</td></tr>'}
      </tbody>
    </table>
  `;

  cont.querySelector('[data-rol="nuevo"]').addEventListener('click', () => formVehiculo(cont, null));
  cont.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () =>
    formVehiculo(cont, datos.vehiculos.find((v) => String(v.id) === b.dataset.editar))));
  cont.querySelectorAll('[data-borrar]').forEach((b) => b.addEventListener('click', () =>
    borrar('vehiculos', 'vehiculos', b.dataset.borrar, 'El vehículo desaparece del ejercicio y de su unidad.')));
}

function formVehiculo(cont, registro) {
  const zona = zonaForm(cont);
  // Un vehículo no puede colgar de sí mismo.
  const posiblesPadres = datos.vehiculos.filter((v) => String(v.id) !== String(registro?.id));
  const asignadoA = registro?.unidad_padre_tipo === 'unidad_militar' ? 'unidad'
    : registro?.unidad_padre_tipo === 'vehiculo_militar' ? 'vehiculo'
    : 'ninguno';
  const unidadPadreId = asignadoA === 'unidad' ? registro?.unidad_padre_id : null;
  const vehiculoPadreIdActual = asignadoA === 'vehiculo' ? registro?.unidad_padre_id : null;

  zona.innerHTML = `
    <form class="cat-form">
      <h3>${registro ? `Editar vehículo #${esc(registro.id)}` : 'Nuevo vehículo'}</h3>
      <div class="cat-grid">
        <label class="cat-campo">
          <span>Plantilla *</span>
          <select name="vehiculo_base_id" class="cat-input" required>
            ${datos.vehiculosBase.map((b) => `
              <option value="${esc(b.id)}" ${String(b.id) === String(registro?.vehiculo_base_id) ? 'selected' : ''}>
                ${esc(b.nombre)} — ${esc(b.tipo)}
              </option>`).join('')}
          </select>
        </label>
        <label class="cat-campo">
          <span>Ejercicio *</span>
          <select name="ejercicio_id" class="cat-input" required>
            ${datos.ejercicios.map((e) => `
              <option value="${esc(e.id)}" ${String(e.id) === String(registro?.ejercicio_id ?? ejercicioFiltro) ? 'selected' : ''}>
                ${esc(e.nombre)}
              </option>`).join('')}
          </select>
        </label>
      </div>

      <div class="cat-subtitulo">Asignación *</div>
      <div class="cat-fila-radios">
        <label class="cat-radio">
          <input type="radio" name="asignado_a" value="unidad" ${asignadoA !== 'vehiculo' ? 'checked' : ''}>
          A una unidad
        </label>
        <label class="cat-radio">
          <input type="radio" name="asignado_a" value="vehiculo" ${asignadoA === 'vehiculo' ? 'checked' : ''}>
          A otro vehículo (transporte)
        </label>
      </div>
      <div class="cat-grid">
        <label class="cat-campo" data-rol="campo-unidad">
          <span>Unidad</span>
          <select name="unidad_militar_id" class="cat-input">
            <option value="">— Elegí una unidad —</option>
            ${datos.unidades.map((u) => `
              <option value="${esc(u.id)}" ${String(u.id) === String(unidadPadreId) ? 'selected' : ''}>
                ${esc(u.nombre)}
              </option>`).join('')}
          </select>
        </label>
        <label class="cat-campo" data-rol="campo-vehiculo-padre">
          <span>Vehículo portador</span>
          <select name="vehiculo_padre_id" class="cat-input">
            <option value="">— Elegí un vehículo —</option>
            ${posiblesPadres.map((v) => `
              <option value="${esc(v.id)}" ${String(v.id) === String(vehiculoPadreIdActual) ? 'selected' : ''}>
                ${esc(v.nombre || `vehículo ${v.id}`)}
              </option>`).join('')}
          </select>
        </label>
      </div>

      <div class="cat-nota" id="cat-vehiculo-herencia">Elegí la asignación para ver qué hereda.</div>
      <p class="cat-nota">
        Un vehículo <strong>siempre</strong> va asignado: a una unidad, o a otro
        vehículo que lo transporta y del que hereda la unidad. De ahí salen su
        <strong>bando</strong> (el del usuario que controla la unidad) y su
        <strong>posición base</strong>, así que ninguno de los dos se carga acá.
      </p>
      <div class="cat-form-acciones">
        <button type="submit" class="admin-submit-btn">Guardar</button>
        <button type="button" class="admin-cancel-btn" data-rol="cancelar">Cancelar</button>
      </div>
    </form>
  `;

  const form = zona.querySelector('form');

  // Solo se muestra el selector que corresponde a la opción elegida.
  const sincronizarAsignacion = () => {
    const elegido = form.querySelector('[name="asignado_a"]:checked')?.value || 'unidad';
    zona.querySelector('[data-rol="campo-unidad"]').style.display = elegido === 'unidad' ? '' : 'none';
    zona.querySelector('[data-rol="campo-vehiculo-padre"]').style.display = elegido === 'vehiculo' ? '' : 'none';
  };
  // El bando y la posición ya no se ven en el form: se muestran acá para que el
  // admin sepa qué va a heredar ANTES de guardar.
  const previsualizarHerencia = async () => {
    const salida = zona.querySelector('#cat-vehiculo-herencia');
    if (!salida) return;
    const elegido = form.querySelector('[name="asignado_a"]:checked')?.value || 'unidad';
    const destino = elegido === 'unidad'
      ? form.elements.unidad_militar_id.value
      : form.elements.vehiculo_padre_id.value;
    if (!destino) {
      salida.textContent = elegido === 'unidad'
        ? 'Elegí una unidad para ver qué bando y posición hereda.'
        : 'Elegí el vehículo portador para ver qué bando y posición hereda.';
      return;
    }
    salida.textContent = 'Resolviendo herencia…';
    const { bando, posicion } = await heredadoDelPadre({
      asignadoA: elegido,
      unidadId: form.elements.unidad_militar_id.value,
      vehiculoPadreId: form.elements.vehiculo_padre_id.value,
      ejercicioId: form.elements.ejercicio_id.value,
    });
    const lugar = posicion ? `${posicion.x.toFixed(4)}, ${posicion.y.toFixed(4)}` : 'sin posición cargada';
    salida.innerHTML = bando
      ? `Hereda · bando <strong>${esc(bando)}</strong> · posición ${esc(lugar)}`
      : '⚠ No se puede deducir el bando: la unidad no tiene un controlador que participe de este ejercicio.';
  };

  form.querySelectorAll('[name="asignado_a"]').forEach((radio) => {
    radio.addEventListener('change', () => { sincronizarAsignacion(); previsualizarHerencia(); });
  });
  form.elements.unidad_militar_id.addEventListener('change', previsualizarHerencia);
  form.elements.vehiculo_padre_id.addEventListener('change', previsualizarHerencia);
  form.elements.ejercicio_id.addEventListener('change', previsualizarHerencia);
  sincronizarAsignacion();
  previsualizarHerencia();

  zona.querySelector('[data-rol="cancelar"]').addEventListener('click', () => { zona.innerHTML = ''; });

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const campos = evento.target.elements;
    const elegido = form.querySelector('[name="asignado_a"]:checked')?.value || 'unidad';

    // La asignación es obligatoria: no hay vehículos sueltos. El bando y la
    // posición base salen de acá, así que sin esto el vehículo queda huérfano.
    if (elegido === 'unidad' && !campos.unidad_militar_id.value) {
      return toastError('Elegí la unidad a la que se asigna: un vehículo no puede quedar suelto');
    }
    if (elegido === 'vehiculo' && !campos.vehiculo_padre_id.value) {
      return toastError('Elegí el vehículo portador: un vehículo no puede quedar suelto');
    }

    const valores = valoresDelForm(evento.target,
      ['vehiculo_base_id', 'ejercicio_id', 'unidad_militar_id', 'vehiculo_padre_id', 'asignado_a']);

    const ejercicioId = campos.ejercicio_id.value;
    // El formulario ya no los pide: salen de la asignación.
    const { bando, posicion } = await heredadoDelPadre({
      asignadoA: elegido,
      unidadId: campos.unidad_militar_id.value,
      vehiculoPadreId: campos.vehiculo_padre_id.value,
      ejercicioId,
    });

    if (!bando) {
      return toastError(
        elegido === 'unidad'
          ? 'No se pudo deducir el bando: la unidad elegida no tiene un controlador que participe de este ejercicio. Asignale un participante en Administración → Usuarios → Unidades.'
          : 'No se pudo deducir el bando del vehículo portador: revisá a qué unidad está asignado.',
      );
    }

    // El SIDC de la plantilla trae la afiliación en blanco (o la del catálogo):
    // el mapa dibuja `entidad.sidc` tal cual llega, así que hay que mandarlo ya
    // resuelto con el bando o el vehículo se ve con el símbolo/color equivocado.
    const plantilla = datos.vehiculosBase.find((b) => String(b.id) === String(campos.vehiculo_base_id.value));
    const sidc = Sidc.conBando(plantilla?.sidc, bando);

    // La relación siempre fue este par polimórfico — `frontend.md`, fase 2:
    // `unidad_militar_id`/`vehiculo_padre_id` nunca existieron del lado del
    // servidor, no se mandan.
    const unidadPadreTipo = elegido === 'unidad' ? 'unidad_militar' : 'vehiculo_militar';
    const unidadPadreId = elegido === 'unidad'
      ? Number(campos.unidad_militar_id.value)
      : Number(campos.vehiculo_padre_id.value);

    const cuerpo = {
      ...valores,
      sidc,
      ...fk('vehiculo_base_id', campos.vehiculo_base_id.value),
      ...fk('ejercicio_id', ejercicioId),
      unidad_padre_tipo: unidadPadreTipo,
      unidad_padre_id: unidadPadreId,
      // El backend ahora deriva el bando de la unidad/controlador: mandarlo
      // da 400 ("bando ya no se manda"). Se sigue calculando arriba solo para
      // la validación (¿hay controlador?) y la previsualización.
      ...(posicion ? { posicion_x: posicion.x, posicion_y: posicion.y } : {}),
    };

    // Con el ejercicio ya iniciado, `POST`/`PUT /vehiculos` (REST) escriben la
    // base pero no el motor en memoria: el vehículo se ve pero ninguna orden
    // le funciona ("La entidad no existe en este ejercicio" — `frontend.md`,
    // fase 8). Si es este mismo ejercicio el que está en vivo en el mapa, el
    // alta va por socket para que el motor lo registre de una.
    const enVivoAca = Number(ejercicioId) === Store.ejercicioId && Store.iniciado;

    try {
      if (registro) {
        await Api.vehiculos.actualizar(registro.id, cuerpo);
        if (enVivoAca) {
          toastAviso('El ejercicio ya está en marcha: cambiar la plantilla o la asignación acá no llega al motor. Para eso hace falta un evento de edición en caliente que este formulario todavía no ofrece.');
        }
      } else if (enVivoAca) {
        await Socket.emitir('vehiculo:crear_en_ejercicio', {
          ejercicio_id: Number(ejercicioId),
          vehiculo_base_id: Number(campos.vehiculo_base_id.value),
          unidad_padre_tipo: unidadPadreTipo,
          unidad_padre_id: unidadPadreId,
          sidc,
          ...(posicion ? { posicion_x: posicion.x, posicion_y: posicion.y } : {}),
        });
        // El ack no siempre trae el registro completo; `recargar` (abajo) se
        // encarga de traer la versión definitiva desde `GET /vehiculos`.
      } else {
        await Api.vehiculos.crear(cuerpo);
      }
      toastExito(registro ? 'Vehículo actualizado' : 'Vehículo creado');
      // `recargar` sincroniza el Store del mapa según `ejercicioFiltro` (el
      // selector de contexto de la cabecera), que puede no ser el mismo
      // ejercicio que se acaba de elegir ACÁ en el formulario (p. ej. el admin
      // tiene la cabecera en "Todos los ejercicios"). Si el vehículo es del
      // ejercicio que está en vivo en el mapa, se sincroniza por su cuenta —
      // si no, nunca se ve aunque se haya creado bien.
      if (Number(ejercicioId) === Store.ejercicioId) {
        // Si se creó por socket (`enVivoAca`), el motor ya lo tiene: no se
        // marca `_pendienteEnMotor` aunque sea nuevo para este cliente.
        Api.vehiculos.listar(ejercicioId)
          .then((lista) => Store.sincronizarVehiculos(lista, { origenCatalogo: !enVivoAca }))
          .catch(() => {});
      }
      recargar('vehiculos');
    } catch (e) {
      toastError(e.message);
    }
  });
}

// ---------------------------------------------------------------------------
// Captura de puntos sobre el mapa
// ---------------------------------------------------------------------------

function modalAdmin() {
  return document.getElementById('admin-modal');
}

function cerrarModalAdmin() {
  modalAdmin()?.classList.remove('active');
}

function dibujarPuntosEnMapa(puntos) {
  const capa = Mapa.capaDeDibujo();
  if (!capa) return;
  const fuente = capa.getSource();
  fuente.clear();
  if (!puntos?.length) return;
  const coords = puntos.map((p) => xyAMapa(p));
  coords.forEach((c) => fuente.addFeature(new ol.Feature({ geometry: new ol.geom.Point(c) })));
  if (coords.length > 1) fuente.addFeature(new ol.Feature({ geometry: new ol.geom.LineString(coords) }));
}

/**
 * Oculta el modal y deja al usuario marcar puntos en el mapa.
 * `maximo` 1 cierra la captura en el primer clic; Infinity espera Enter.
 */
function tomarPuntos(maximo, alTerminar, iniciales = []) {
  const mapa = Mapa.instancia();
  if (!mapa) return toastError('El mapa todavía no está listo');

  cerrarModalAdmin();
  dibujo = { puntos: [...iniciales], alTerminar, maximo };
  window.simtacModoMapa = 'catalogo';
  dibujarPuntosEnMapa(dibujo.puntos);
  mostrarBanner(maximo === 1
    ? 'Clic en el mapa para fijar el punto · Esc cancela'
    : 'Clic para agregar waypoints · Enter termina · Esc cancela');

  mapa.on('singleclick', alClicDeCaptura);
  document.addEventListener('keydown', alTeclaDeCaptura);
}

function alClicDeCaptura(evento) {
  if (!dibujo) return;
  const [x, y] = mapaALonLat(evento.coordinate);
  dibujo.puntos.push({ x, y });
  dibujarPuntosEnMapa(dibujo.puntos);
  if (dibujo.puntos.length >= dibujo.maximo) terminarCaptura(true);
}

function alTeclaDeCaptura(evento) {
  if (!dibujo) return;
  if (evento.key === 'Enter') terminarCaptura(true);
  else if (evento.key === 'Escape') terminarCaptura(false);
}

function terminarCaptura(confirmado) {
  if (!dibujo) return;
  const { puntos, alTerminar } = dibujo;
  const mapa = Mapa.instancia();
  mapa?.un('singleclick', alClicDeCaptura);
  document.removeEventListener('keydown', alTeclaDeCaptura);
  window.simtacModoMapa = null;
  ocultarBanner();
  dibujo = null;

  // Se reabre el modal SIN recargar: el formulario que pidió los puntos sigue
  // montado y es quien los recibe.
  modalAdmin()?.classList.add('active');

  if (confirmado && puntos.length) {
    alTerminar(puntos);
    toast(`${puntos.length} punto(s) capturado(s)`);
  } else {
    Mapa.limpiarDibujo();
  }
}

function mostrarBanner(texto) {
  let banner = document.getElementById('cat-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'cat-banner';
    banner.className = 'modo-banner';
    document.body.appendChild(banner);
  }
  banner.textContent = texto;
  banner.classList.add('visible');
}

function ocultarBanner() {
  document.getElementById('cat-banner')?.classList.remove('visible');
}

// ---------------------------------------------------------------------------

export function init() {
  if (!Session.esAdmin()) return;

  // Si el admin no fijó un ejercicio a mano en la barra de contexto, seguí al
  // que está en vivo en el mapa — incluye los cambios que se hacen desde
  // Dirección → Control → "Cambiar de ejercicio", no solo el que estaba
  // activo cuando se abrió Administración por primera vez.
  Store.on('ejercicio:contexto', ({ ejercicioId }) => {
    if (contextoElegidoManualmente || !ejercicioId) return;
    ejercicioFiltro = String(ejercicioId);
  });

  // Atajo desde la cabecera: abre la administración en la pestaña de armamento.
  const boton = document.getElementById('catalogos-btn');
  if (!boton) return;
  boton.style.display = 'flex';
  boton.addEventListener('click', async () => {
    modalAdmin()?.classList.add('active');
    await window.adminManager?.init();
    window.adminManager?.switchTable('armamento');
  });
}

export default {
  init, maneja, cargar, TABLAS, TABLAS_EJERCICIO,
  esDeEjercicio, montarContexto, ejercicioActual, ejercicioActualNombre,
  invalidarEjercicios,
};
