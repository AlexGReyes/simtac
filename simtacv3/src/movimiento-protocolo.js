// Identidad y orden de los eventos de movimiento.
//
// El servidor es autoritativo: el cliente sólo adopta un evento si pertenece a
// la ejecución vigente de la entidad. Esto evita que un ACK duplicado, un tick
// retrasado o una ruta de una generación anterior reemplacen lo ya confirmado.

export function claveMovimiento({ entidad_tipo: tipo, entidad_id: id }) {
  return `${tipo}:${Number(id)}`;
}

function numero(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function identidad(evento) {
  const generation = numero(evento?.generation);
  const sequence = numero(evento?.sequence);
  if (!evento?.serverEpoch || generation === null || sequence === null) return null;
  return {
    serverEpoch: String(evento.serverEpoch),
    generation,
    sequence,
    routeId: evento.routeId ?? null,
  };
}

function comparable(value) {
  return value ? `${value.serverEpoch}:${value.generation}:${value.routeId ?? ''}` : null;
}

export function mismaRuta(first, second) {
  return comparable(first) !== null && comparable(first) === comparable(second);
}

export function crearRegistroMovimientos() {
  let serverEpoch = null;
  const entries = new Map();

  function reset(epoch = null) {
    serverEpoch = epoch;
    entries.clear();
  }

  function aceptar(evento, estado) {
    const id = identidad(evento);
    const key = claveMovimiento(evento || {});
    if (!key || key.includes('undefined') || key.endsWith(':NaN')) return { accepted: false, reason: 'invalid-entity' };

    // Compatibilidad transitoria con el backend anterior. No recibe garantías
    // de orden, pero permite desplegar el cliente antes de actualizar el motor.
    if (!id) {
      const prior = entries.get(key);
      const legacy = { serverEpoch: 'legacy', generation: (prior?.identity?.generation ?? -1) + 1,
        sequence: 0, routeId: null };
      const entry = { identity: legacy, state: estado, route: evento.waypoints ?? prior?.route ?? null,
        progressKm: Number(evento.progreso_km ?? prior?.progressKm ?? 0),
        entity: { tipo: evento.entidad_tipo, id: Number(evento.entidad_id) } };
      entries.set(key, entry);
      return { accepted: true, key, previous: prior ?? null, current: entry, legacy: true };
    }

    if (serverEpoch === null) serverEpoch = id.serverEpoch;
    if (id.serverEpoch !== serverEpoch) return { accepted: false, reason: 'other-server-epoch' };

    const prior = entries.get(key);
    if (prior) {
      if (id.generation < prior.identity.generation ||
          (id.generation === prior.identity.generation && id.sequence <= prior.identity.sequence)) {
        return { accepted: false, reason: 'stale-event' };
      }
    }
    const entry = {
      identity: id,
      state: estado,
      route: evento.waypoints ?? prior?.route ?? null,
      progressKm: Number(evento.progreso_km ?? prior?.progressKm ?? 0),
      entity: { tipo: evento.entidad_tipo, id: Number(evento.entidad_id) },
    };
    entries.set(key, entry);
    return { accepted: true, key, previous: prior ?? null, current: entry, legacy: false };
  }

  function inicio(evento) { return aceptar(evento, 'active'); }
  function posicion(evento) { return aceptar(evento, 'active'); }
  function final(evento) { return aceptar(evento, 'finished'); }

  function snapshot(snapshot = {}) {
    const epoch = snapshot.serverEpoch ? String(snapshot.serverEpoch) : null;
    if (!epoch) return { accepted: false, reason: 'snapshot-without-epoch', removed: [] };
    const removed = [...entries.entries()].filter(([, entry]) => entry.state === 'active').map(([key, entry]) => ({ key, entry }));
    reset(epoch);
    const accepted = [];
    for (const movement of snapshot.movimientos || []) {
      const result = inicio(movement);
      if (result.accepted) accepted.push(result);
    }
    return { accepted: true, removed, movements: accepted };
  }

  return { final, inicio, mismaRuta, posicion, reset, snapshot };
}
