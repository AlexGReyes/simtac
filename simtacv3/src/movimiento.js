// Fase 4 — Movimiento.
//
// Dos modalidades; el servidor interpola igual en las dos y lo único que cambia
// es de dónde salen los waypoints:
//   · terrestre (`entidad:mover`)       -> se manda origen/destino, el servidor
//                                          resuelve el trayecto contra `rutas`.
//   · libre     (`entidad:mover_libre`) -> el cliente traza la polilínea.
//
// La posición autoritativa es siempre la del último evento del backend; la
// animación entre ticks es cosmética.

import Store from './store.js';
import Socket from './socket.js';
import Mapa from './mapa.js';
import { mapaAXY, xyAMapa, formatearDistancia, formatearDuracion } from './geo.js';
import { toast, toastError, toastExito, toastAviso, esc } from './ui.js';
import { crearRegistroMovimientos } from './movimiento-protocolo.js';

let modo = null;              // null | 'destino' | 'polilinea' | 'base'
let itemActivo = null;
let puntos = [];
let banner = null;
let desuscribirClic = null;
const registro = crearRegistroMovimientos();

function commandId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `mov-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function dibujarInicio(evento, resultado) {
  const item = Store.aplicarCampos(evento.entidad_tipo, evento.entidad_id, { estado_movimiento: 'en_movimiento' });
  if (!item || !Store.visibleParaMi(item)) return item;
  Mapa.dibujarTrayecto(evento.entidad_tipo, evento.entidad_id, resultado.current.route || [],
    Store.esAliada(item.entidad), resultado.current.identity);
  return item;
}

function adoptarInicio(evento) {
  const resultado = registro.inicio(evento);
  if (!resultado.accepted) return null;
  return { resultado, item: dibujarInicio(evento, resultado) };
}

function camposFinales(evento) {
  const fields = { estado_movimiento: 'estacionado' };
  for (const name of ['posicion_x', 'posicion_y', 'distancia_recorrida', 'autonomia_actual']) {
    if (Number.isFinite(Number(evento[name]))) fields[name] = Number(evento[name]);
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Banner de modo
// ---------------------------------------------------------------------------

function mostrarBanner(texto) {
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'modo-banner';
    document.body.appendChild(banner);
  }
  banner.innerHTML = texto;
  banner.classList.add('visible');
}

function ocultarBanner() {
  banner?.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Modo "mover a" (terrestre)
// ---------------------------------------------------------------------------

export function iniciarModoDestino(item) {
  if (!verificarPuedeMover(item)) return;
  salirDeModo();
  modo = 'destino';
  itemActivo = item;
  window.simtacModoMapa = 'destino';
  mostrarBanner(`Destino de <strong>${esc(item.entidad.nombre)}</strong>: clic en el mapa · <kbd>Esc</kbd> cancela`);

  const mapa = Mapa.instancia();
  const manejador = (evento) => {
    const destino = mapaAXY(evento.coordinate);
    salirDeModo();
    enviarMovimiento(item, destino);
  };
  mapa.on('singleclick', manejador);
  desuscribirClic = () => mapa.un('singleclick', manejador);
}

async function enviarMovimiento(item, destino) {
  try {
    const respuesta = await Socket.emitir('entidad:mover', {
      ejercicio_id: Store.ejercicioId,
      entidad_tipo: item.tipo,
      entidad_id: item.id,
      commandId: commandId(),
      // `posicion_inicio` es opcional: omitirlo usa la posición actual.
      posicion_fin: destino,
    });
    // ACK y evento llevan la misma identidad: adoptar ambos es seguro y no
    // crea una segunda capa ni reemplaza una orden posterior.
    adoptarInicio(respuesta);
    const ruta = respuesta.routeId ? ' por ruta calculada' : (respuesta.ruta_nombre ? ` por «${respuesta.ruta_nombre}»` : '');
    toastExito(
      `${item.entidad.nombre}${ruta}: ${formatearDistancia((respuesta.distancia_km || 0) * 1000)} · ${formatearDuracion(respuesta.tiempo_estimado_seg)}`,
    );
  } catch (e) {
    toastError(e.message);
  }
}

// ---------------------------------------------------------------------------
// Modo polilínea (libre: aire / mar / anfibio)
// ---------------------------------------------------------------------------

export function iniciarModoPolilinea(item) {
  if (!verificarPuedeMover(item)) return;
  salirDeModo();
  modo = 'polilinea';
  itemActivo = item;
  puntos = [];
  window.simtacModoMapa = 'polilinea';
  actualizarBannerPolilinea();

  const mapa = Mapa.instancia();
  const alClic = (evento) => {
    puntos.push(mapaAXY(evento.coordinate));
    dibujarPreview();
    actualizarBannerPolilinea();
  };
  const alDobleClic = (evento) => {
    evento.stopPropagation();
    evento.preventDefault();
    // OpenLayers no dispara `singleclick` para un clic que termina formando
    // parte de un `dblclick` (lo suprime para poder distinguir un doble clic
    // de dos clics sueltos): sin esto, el punto donde el usuario termina de
    // trazar la ruta nunca se agrega a `puntos`, y de los n puntos que marcó
    // solo se mandan n-1.
    puntos.push(mapaAXY(evento.coordinate));
    confirmarPolilinea();
  };
  mapa.on('singleclick', alClic);
  mapa.on('dblclick', alDobleClic);
  desuscribirClic = () => {
    mapa.un('singleclick', alClic);
    mapa.un('dblclick', alDobleClic);
  };
}

function actualizarBannerPolilinea() {
  mostrarBanner(
    `Trazando ruta de <strong>${esc(itemActivo.entidad.nombre)}</strong> · ${puntos.length} punto(s) · ` +
    `<kbd>doble clic</kbd> o <kbd>Enter</kbd> confirma · <kbd>Esc</kbd> cancela`,
  );
}

function dibujarPreview() {
  const capa = Mapa.capaDeDibujo();
  const fuente = capa.getSource();
  fuente.clear();
  const coords = puntos.map(xyAMapa);
  if (coords.length >= 2) {
    fuente.addFeature(new ol.Feature({ geometry: new ol.geom.LineString(coords) }));
  }
  coords.forEach((c) => fuente.addFeature(new ol.Feature({ geometry: new ol.geom.Point(c) })));
}

/**
 * Un vehículo de tipo "aire" siempre despega y aterriza en su base: la ruta
 * que se manda tiene que empezar y terminar en `posicion_base_x/y`, sin
 * importar qué puntos intermedios haya trazado el usuario. Es una regla de
 * negocio (`backend.md`, punto 13a): idealmente la aplica también el
 * servidor, pero como el cliente arma el array completo para
 * `entidad:mover_libre`, hay que garantizarlo acá para que la ruta real
 * empiece a existir.
 */
function conBaseAlPrincipioYFinal(item, waypoints) {
  if (!Store.esVehiculoAire(item)) return waypoints;
  const x = item.entidad.posicion_base_x;
  const y = item.entidad.posicion_base_y;
  if (x === null || x === undefined || y === null || y === undefined) return null;
  const base = { x: Number(x), y: Number(y) };
  return [base, ...waypoints, base];
}

async function confirmarPolilinea() {
  const item = itemActivo;
  const waypoints = [...puntos];
  salirDeModo();
  if (!item || waypoints.length < 1) {
    toastAviso('Hacen falta al menos un punto de destino');
    return;
  }
  const waypointsFinales = conBaseAlPrincipioYFinal(item, waypoints);
  if (waypointsFinales === null) {
    toastError(`${item.entidad.nombre} no tiene una posición base definida: establecela antes de trazar la ruta`);
    return;
  }
  try {
    const respuesta = await Socket.emitir('entidad:mover_libre', {
      ejercicio_id: Store.ejercicioId,
      entidad_tipo: item.tipo,
      entidad_id: item.id,
      commandId: commandId(),
      waypoints: waypointsFinales,
    });
    adoptarInicio(respuesta);
    toastExito(
      `${item.entidad.nombre}: ${formatearDistancia((respuesta.distancia_km || 0) * 1000)} · ${formatearDuracion(respuesta.tiempo_estimado_seg)}`,
    );
  } catch (e) {
    toastError(e.message);
  }
}

// ---------------------------------------------------------------------------
// Modo "establecer base" (solo vehículos de tipo aire)
//
// La posición base es el punto de salida y llegada de toda ruta aérea. El
// usuario la fija haciendo clic en el mapa con el vehículo seleccionado y
// este modo activo (ver `backend.md`, punto 13b: hoy el socket no tiene un
// evento para esto, la base de un vehículo es derivada de su unidad/portador
// — se emite igual, a la espera de que el backend lo soporte).
// ---------------------------------------------------------------------------

export function iniciarModoBase(item) {
  if (!Store.esVehiculoAire(item)) {
    toastError('Solo los vehículos de tipo aire tienen posición base');
    return;
  }
  if (!Store.controlo(item)) {
    toastError('No controlás esta entidad');
    return;
  }
  salirDeModo();
  modo = 'base';
  itemActivo = item;
  window.simtacModoMapa = 'base';
  mostrarBanner(`Nueva base de <strong>${esc(item.entidad.nombre)}</strong>: clic en el mapa · <kbd>Esc</kbd> cancela`);

  const mapa = Mapa.instancia();
  const manejador = (evento) => {
    const punto = mapaAXY(evento.coordinate);
    salirDeModo();
    establecerBase(item, punto);
  };
  mapa.on('singleclick', manejador);
  desuscribirClic = () => mapa.un('singleclick', manejador);
}

async function establecerBase(item, punto) {
  try {
    const respuesta = await Socket.emitir('vehiculo:establecer_base', {
      ejercicio_id: Store.ejercicioId,
      entidad_id: item.id,
      posicion_base_x: punto.x,
      posicion_base_y: punto.y,
    });
    const actualizado = Store.aplicarCampos('vehiculo', item.id, {
      posicion_base_x: respuesta.posicion_base_x ?? punto.x,
      posicion_base_y: respuesta.posicion_base_y ?? punto.y,
    });
    if (actualizado) Mapa.mostrarBase(actualizado);
    toastExito(`${item.entidad.nombre}: nueva base en ${punto.x.toFixed(5)}, ${punto.y.toFixed(5)}`);
  } catch (e) {
    toastError(`No se pudo establecer la base: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Cancelar / salir de modo
// ---------------------------------------------------------------------------

export async function cancelar(item) {
  if (Store.esVehiculoAire(item)) {
    return volverABase(item);
  }
  try {
    await Socket.emitir('entidad:cancelar_movimiento', {
      ejercicio_id: Store.ejercicioId,
      entidad_tipo: item.tipo,
      entidad_id: item.id,
    });
    toast(`Movimiento de ${item.entidad.nombre} cancelado`);
  } catch (e) {
    toastError(e.message);
  }
}

/**
 * Cancelar el movimiento de un vehículo aire NO lo detiene en el aire: en vez
 * de eso, cambia su ruta y lo manda directo a su base (`posicion_base_x/y`).
 * Se resuelve con dos eventos ya existentes, en secuencia:
 *   1. `entidad:cancelar_movimiento` corta el trayecto en curso.
 *   2. `entidad:mover_libre` con un único waypoint (la base) ordena el nuevo
 *      trayecto directo desde donde haya quedado.
 * No hace falta esperar el tick de posición entre los dos: el segundo emit
 * usa la posición que el servidor ya tiene para la entidad en ese momento.
 */
async function volverABase(item) {
  const x = item.entidad.posicion_base_x;
  const y = item.entidad.posicion_base_y;
  if (x === null || x === undefined || y === null || y === undefined) {
    toastError(`${item.entidad.nombre} no tiene una posición base definida`);
    return;
  }
  try {
    await Socket.emitir('entidad:cancelar_movimiento', {
      ejercicio_id: Store.ejercicioId,
      entidad_tipo: item.tipo,
      entidad_id: item.id,
    });
    const base = { x: Number(x), y: Number(y) };
    const respuesta = await Socket.emitir('entidad:mover_libre', {
      ejercicio_id: Store.ejercicioId,
      entidad_tipo: item.tipo,
      entidad_id: item.id,
      commandId: commandId(),
      waypoints: [base],
    });
    adoptarInicio(respuesta);
    toastAviso(`${item.entidad.nombre}: regresando a la base`);
  } catch (e) {
    toastError(e.message);
  }
}

export function salirDeModo() {
  modo = null;
  itemActivo = null;
  puntos = [];
  window.simtacModoMapa = null;
  desuscribirClic?.();
  desuscribirClic = null;
  Mapa.limpiarDibujo();
  ocultarBanner();
}

/** Validación local para no ofrecer acciones muertas; el backend reautoriza. */
function verificarPuedeMover(item) {
  if (!Store.controlo(item)) {
    toastError('No controlás esta entidad');
    return false;
  }
  if (!Store.enEjecucion()) {
    toastError(`El ejercicio está ${Store.estadoEjercicio() || 'sin iniciar'}`);
    return false;
  }
  if (item.entidad.en_combate) {
    toastError('La entidad está en combate: hay que retirarse antes de moverse');
    return false;
  }
  if (item.tipo === 'unidad' && Number(item.entidad.efectivo) <= 0) {
    toastError('La unidad no tiene efectivo');
    return false;
  }
  if (item.tipo === 'vehiculo' && item.entidad.estado_actual === 'destruido') {
    toastError('El vehículo está destruido');
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Eventos del servidor
// ---------------------------------------------------------------------------

export function init() {
  Socket.on('entidad:movimiento_iniciado', (e) => {
    adoptarInicio(e);
  });

  // Llega 1 vez por segundo.
  Socket.on('entidad:posicion_actualizada', (e) => {
    const resultado = registro.posicion(e);
    if (!resultado.accepted) return;
    const item = Store.actualizarPosicion(e);
    if (!item) return;
    Mapa.animarPorTrayecto(item, resultado.current.route,
      resultado.previous?.progressKm ?? resultado.current.progressKm,
      resultado.current.progressKm, 1000);
  });

  Socket.on('entidad:movimiento_completado', (e) => {
    const resultado = registro.final(e);
    if (!resultado.accepted) return;
    const item = Store.aplicarCampos(e.entidad_tipo, e.entidad_id, camposFinales(e));
    Mapa.limpiarTrayecto(e.entidad_tipo, e.entidad_id, resultado.current.identity);
    if (item && Store.controlo(item)) {
      toast(e.cancelado
        ? `${item.entidad.nombre}: movimiento cancelado`
        : `${item.entidad.nombre} llegó al destino`);
    }
  });

  Socket.on('entidad:movimientos_snapshot', (snapshot) => {
    const resultado = registro.snapshot(snapshot);
    if (!resultado.accepted) return;
    for (const { entry } of resultado.removed) {
      Mapa.limpiarTrayecto(entry.entity.tipo, entry.entity.id, entry.identity);
    }
    for (const movimiento of resultado.movements) {
      const item = Store.obtenerPorClave(movimiento.key);
      if (!item || !Store.visibleParaMi(item)) continue;
      Mapa.dibujarTrayecto(item.tipo, item.id, movimiento.current.route || [],
        Store.esAliada(item.entidad), movimiento.current.identity);
    }
  });

  Socket.alVolverAUnirse(async () => {
    try {
      const snapshot = await Socket.emitir('entidad:movimientos', { ejercicio_id: Store.ejercicioId });
      const resultado = registro.snapshot(snapshot);
      if (!resultado.accepted) return;
      for (const { entry } of resultado.removed) Mapa.limpiarTrayecto(entry.entity.tipo, entry.entity.id, entry.identity);
      for (const movimiento of resultado.movements) {
        const item = Store.obtenerPorClave(movimiento.key);
        if (item && Store.visibleParaMi(item)) {
          Mapa.dibujarTrayecto(item.tipo, item.id, movimiento.current.route || [],
            Store.esAliada(item.entidad), movimiento.current.identity);
        }
      }
    } catch (error) {
      console.warn('No se pudo sincronizar movimientos tras reconectar:', error.message);
    }
  });

  document.addEventListener('keydown', (evento) => {
    if (!modo) return;
    if (evento.key === 'Escape') {
      salirDeModo();
      toast('Modo cancelado');
    } else if (evento.key === 'Enter' && modo === 'polilinea') {
      confirmarPolilinea();
    }
  });
}

export default { init, iniciarModoDestino, iniciarModoPolilinea, iniciarModoBase, cancelar, salirDeModo };
