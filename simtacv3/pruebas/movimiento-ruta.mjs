import assert from 'node:assert/strict';
import { posicionEnRuta, prepararRuta } from '../src/movimiento-ruta.js';

const ruta = prepararRuta([
  { x: -99, y: 19 },
  { x: -99, y: 19.1 },
  { x: -98.9, y: 19.1 },
]);

assert.ok(ruta.totalKm > 20);
const alDoblar = posicionEnRuta(ruta, ruta.cumulativeM[1] / 1000);
assert.equal(alDoblar.x, -99);
assert.equal(alDoblar.y, 19.1);
const despuesDeDoblar = posicionEnRuta(ruta, ruta.cumulativeM[1] / 1000 + 1);
assert.ok(Math.abs(despuesDeDoblar.y - 19.1) < 0.00001);
assert.ok(despuesDeDoblar.x > -99);
assert.equal(prepararRuta([{ x: -99, y: 19 }, { x: null, y: 19 }, { x: -98, y: 19 }]), null);
assert.deepEqual(posicionEnRuta(ruta, ruta.totalKm), ruta.points.at(-1));

console.log('OK movimiento-ruta: progreso conserva vértices');
