import assert from 'node:assert/strict';
import { crearRegistroMovimientos } from '../src/movimiento-protocolo.js';

const base = { serverEpoch: 'server-a', ejercicio_id: 1, entidad_tipo: 'unidad', entidad_id: 7,
  commandId: 'orden-1', movementId: 'mov-1', generation: 2, routeId: 'ruta-1', revision: 1, sequence: 1,
  waypoints: [{ x: -99, y: 19 }, { x: -99.1, y: 19.1 }] };
const registro = crearRegistroMovimientos();
assert.equal(registro.inicio(base).accepted, false);
let token = registro.comenzarSincronizacion(1);
assert.equal(registro.snapshot({ serverEpoch: 'server-a', ejercicio_id: 1, revision: 0, movimientos: [] }, token).accepted, true);
assert.equal(registro.inicio(base).accepted, true);
assert.equal(registro.inicio(base).accepted, false);
assert.equal(registro.posicion({ ...base, sequence: 3, revision: 3, progreso_km: 2 }).accepted, true);
assert.equal(registro.posicion({ ...base, sequence: 2, revision: 2, progreso_km: 1 }).accepted, false);
assert.equal(registro.posicion({ ...base, sequence: 4, revision: 4, progreso_km: 1 }).accepted, false);
assert.equal(registro.final({ ...base, sequence: 4, revision: 4, progreso_km: 3 }).accepted, true);
assert.equal(registro.inicio({ ...base, sequence: 5, revision: 5 }).accepted, false);
assert.equal(registro.inicio({ ...base, generation: 3, waypoints: undefined }).accepted, false);

token = registro.comenzarSincronizacion(1);
const next = { ...base, serverEpoch: 'server-b', generation: 1, revision: 1, routeId: 'new' };
assert.equal(registro.inicio(next).accepted, false);
assert.equal(registro.posicion({ ...next, revision: 2, sequence: 2, progreso_km: 1 }).accepted, false);
let result = registro.snapshot({ serverEpoch: 'server-b', ejercicio_id: 1, revision: 1, movimientos: [next] }, token);
assert.equal(result.accepted, true);
assert.equal(result.replay.length, 1);
assert.equal(registro.activos()[0].progressKm, 1);
assert.equal(registro.posicion({ ...base, sequence: 9, revision: 9 }).accepted, false);

const obsoleteToken = registro.comenzarSincronizacion(1);
token = registro.comenzarSincronizacion(2);
assert.equal(registro.snapshot({ serverEpoch: 'server-b', ejercicio_id: 1, revision: 20, movimientos: [] }, obsoleteToken).accepted, false);
assert.equal(registro.inicio(base).accepted, false);
assert.equal(registro.snapshot({ serverEpoch: 'server-b', ejercicio_id: 2, revision: 20, movimientos: [] }, token).accepted, true);
assert.equal(registro.inicio({ ...next, ejercicio_id: 2, revision: 19 }).accepted, false);

token = registro.comenzarSincronizacion(2);
const other = { ...next, ejercicio_id: 2, revision: 21 };
assert.equal(registro.snapshot({ serverEpoch: 'server-b', ejercicio_id: 2, revision: 21, movimientos: [other, other] }, token).accepted, false);
assert.equal(registro.activos().length, 0);
assert.equal(registro.snapshot({ serverEpoch: 'server-b', ejercicio_id: 2, revision: 21, movimientos: [other] }, token).accepted, true);
assert.equal(registro.final({ ...other, revision: 22, sequence: 2 }).accepted, true);
token = registro.comenzarSincronizacion(2);
assert.equal(registro.snapshot({ serverEpoch: 'server-b', ejercicio_id: 2, revision: 22, movimientos: [] }, token).accepted, true);
assert.equal(registro.inicio(other).accepted, false);
console.log('OK protocolo: deduplicación, progreso, épocas, ejercicios, snapshot transaccional y eventos en vuelo');
