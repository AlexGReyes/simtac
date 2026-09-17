import { prepararRuta } from './movimiento-ruta.js';

export function claveMovimiento(evento) {
  return `${evento.entidad_tipo}:${evento.entidad_id}`;
}

const integer = value => Number.isSafeInteger(value) && value >= 0;
const positive = value => integer(value) && value > 0;

export function mismaRuta(first, second) {
  return !!first && !!second && first.serverEpoch === second.serverEpoch &&
    first.generation === second.generation && first.movementId === second.movementId &&
    first.routeId === second.routeId;
}

export function crearRegistroMovimientos() {
  let serverEpoch = null;
  let exercise = null;
  let watermark = -1;
  let token = 0;
  let pending = false;
  let buffered = [];
  const entries = new Map();
  const reject = reason => ({ accepted: false, reason });

  function reset(exerciseId = null) {
    exercise = exerciseId;
    serverEpoch = null;
    watermark = -1;
    pending = false;
    buffered = [];
    entries.clear();
    token += 1;
  }

  function comenzarSincronizacion(exerciseId) {
    if (exercise !== exerciseId) reset(exerciseId);
    pending = true;
    buffered = [];
    return ++token;
  }

  function aceptar(evento, state) {
    if (!evento || evento.ejercicio_id !== exercise ||
        !['unidad', 'vehiculo'].includes(evento.entidad_tipo) || !positive(evento.entidad_id) ||
        typeof evento.serverEpoch !== 'string' || !evento.serverEpoch ||
        !integer(evento.generation) || !positive(evento.sequence) || !integer(evento.revision)) {
      return reject('invalid-event');
    }
    if (pending) {
      if (buffered.length >= 10000) return reject('buffer-full');
      buffered.push({ evento, state });
      return reject('synchronizing');
    }
    if (!serverEpoch || evento.serverEpoch !== serverEpoch) return reject('other-server-epoch');
    if (evento.revision <= watermark) return reject('before-snapshot');
    const key = claveMovimiento(evento);
    const prior = entries.get(key);
    if (prior && (evento.generation < prior.identity.generation ||
        (evento.generation === prior.identity.generation &&
          (evento.sequence <= prior.identity.sequence || prior.state === 'finished' ||
           !mismaRuta(evento, prior.identity))))) return reject('stale-event');
    const same = mismaRuta(prior?.identity, evento);
    const route = evento.waypoints === undefined ? (same ? prior.route : null) : evento.waypoints;
    const prepared = route ? prepararRuta(route) : null;
    const progressKm = evento.progreso_km ?? (same ? prior.progressKm : 0);
    if (typeof progressKm !== 'number' || !Number.isFinite(progressKm) || progressKm < 0 ||
        (same && progressKm < prior.progressKm) ||
        (state === 'active' && (!prepared || typeof evento.routeId !== 'string' || !evento.routeId ||
          typeof evento.movementId !== 'string' || !evento.movementId || progressKm > prepared.totalKm + 1e-6))) {
      return reject('invalid-route-progress');
    }
    const entry = {
      identity: { serverEpoch, generation: evento.generation, movementId: evento.movementId,
        commandId: evento.commandId, routeId: evento.routeId, sequence: evento.sequence, revision: evento.revision },
      state, route: prepared?.points || null, progressKm,
      segments: evento.segmentos ?? (same ? prior.segments : []),
      entity: { tipo: evento.entidad_tipo, id: evento.entidad_id }, evento,
    };
    entries.set(key, entry);
    return { accepted: true, key, previous: prior || null, current: entry };
  }

  function snapshot(value, requestToken = token) {
    if (!pending || requestToken !== token || value?.ejercicio_id !== exercise ||
        typeof value.serverEpoch !== 'string' || !value.serverEpoch ||
        !integer(value.revision) || !Array.isArray(value.movimientos)) return reject('unexpected-snapshot');
    if (value.serverEpoch === serverEpoch && value.revision < watermark) return reject('stale-snapshot');
    const removed = [...entries.entries()].map(([key, entry]) => ({ key, entry }));
    const previous = new Map(entries);
    const previousEpoch = serverEpoch;
    const previousWatermark = watermark;
    const queued = buffered;
    serverEpoch = value.serverEpoch;
    watermark = -1;
    entries.clear();
    pending = false;
    buffered = [];
    const movements = [];
    for (const event of value.movimientos) {
      if (event.revision > value.revision || entries.has(claveMovimiento(event))) { pending = true; break; }
      const result = aceptar(event, 'active');
      if (!result.accepted) { pending = true; break; }
      movements.push(result);
    }
    if (pending) {
      serverEpoch = previousEpoch;
      watermark = previousWatermark;
      entries.clear();
      previous.forEach((entry, key) => entries.set(key, entry));
      buffered = queued;
      return reject('invalid-snapshot');
    }
    watermark = value.revision;
    const replay = [];
    for (const { evento, state } of queued.sort((first, second) => first.evento.revision - second.evento.revision)) {
      const result = aceptar(evento, state);
      if (result.accepted) replay.push(result);
    }
    return { accepted: true, removed, movements, replay };
  }

  return { inicio: event => aceptar(event, 'active'), posicion: event => aceptar(event, 'active'),
    final: event => aceptar(event, 'finished'), comenzarSincronizacion, snapshot, reset,
    activos: () => [...entries.values()].filter(entry => entry.state === 'active') };
}
