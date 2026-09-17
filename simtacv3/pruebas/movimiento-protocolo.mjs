import assert from 'node:assert/strict';
import { crearRegistroMovimientos } from '../src/movimiento-protocolo.js';

const base = { serverEpoch: 'server-a', ejercicio_id: 1, entidad_tipo: 'unidad', entidad_id: 7,
  commandId: 'orden-1', movementId: 'mov-1', generation: 2, routeId: 'ruta-1' };
const registro = crearRegistroMovimientos();

assert.equal(registro.inicio({ ...base, sequence: 1, waypoints: [{ x: -99, y: 19 }, { x: -99.1, y: 19.1 }] }).accepted, true);
assert.equal(registro.inicio({ ...base, sequence: 1 }).accepted, false, 'deduplica ACK y evento de inicio');
assert.equal(registro.posicion({ ...base, sequence: 3, progreso_km: 2 }).accepted, true);
assert.equal(registro.posicion({ ...base, sequence: 2, progreso_km: 1 }).accepted, false, 'descarta tick atrasado');
assert.equal(registro.final({ ...base, sequence: 4, progreso_km: 3 }).accepted, true);
assert.equal(registro.inicio({ ...base, sequence: 1 }).accepted, false, 'no revive una ruta terminada');

const reconciliado = registro.snapshot({
  serverEpoch: 'server-b',
  movimientos: [{ ...base, serverEpoch: 'server-b', generation: 1, sequence: 1, routeId: 'ruta-nueva', waypoints: [{ x: -99, y: 19 }, { x: -99.2, y: 19.2 }] }],
});
assert.equal(reconciliado.accepted, true);
assert.equal(reconciliado.movements.length, 1, 'adopta el snapshot de la conexión vigente');
assert.equal(registro.posicion({ ...base, sequence: 5, progreso_km: 4 }).accepted, false, 'descarta eventos del servidor anterior');

console.log('OK movimiento-protocolo: identidad, orden y snapshot');
