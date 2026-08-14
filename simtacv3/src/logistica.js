// Logística — vista de kilómetros recorridos, munición y autonomía
// consumidas/repuestas, bajas y bandos destruidos de las unidades y
// vehículos a cargo del jugador (o, para el administrador, de todo el
// ejercicio agrupado por bando).
//
// Todo lo que se muestra acá es dato autoritativo del backend (`backend.md`,
// punto 18, implementado 07-08-2026), leído en vivo del estado — sin
// acumuladores propios ni aproximaciones de sesión:
//   - `distancia_recorrida` (odómetro) y `autonomia_actual`/`autonomia`
//     (combustible actual/tope) viajan en cada entidad.
//   - `armamentos[].municion` (tope de catálogo) y `.municion_actual` — de
//     ahí sale "munición usada" restando, tal como lo dejó documentado
//     backend.md ("no hacía falta agregarlo del lado del servidor").
//   - `entidad.logistica.{bajas_propias,bajas_infligidas,
//     unidades_enemigas_destruidas,vehiculos_enemigos_destruidos}` lo
//     mantiene el motor de combate en el momento exacto del impacto —
//     sobrevive a reconectar, no hay que reconstruirlo del lado del cliente.
// La única acción propia de este módulo es `recargar()`, que emite
// `logistica:recargar` (jugador dueño del vehículo, o 👑).

import Store from './store.js';
import Session from './session.js';
import Socket from './socket.js';
import { esc, toastError, toastExito } from './ui.js';
import { estadoVisual } from './mapa.js';

/** "tipo:id" -> { municionRepuesta, autonomiaRepuesta } acumulado por recargas de ESTA sesión. */
const repuesto = new Map();

let modal = null;

function repuestoDe(k) {
  if (!repuesto.has(k)) repuesto.set(k, { municionRepuesta: 0, autonomiaRepuesta: 0 });
  return repuesto.get(k);
}

/** Munición usada de un vehículo: capacidad de catálogo menos la actual, por arma. */
function municionUsada(vehiculo) {
  const armas = vehiculo.armamentos || [];
  return armas.reduce((total, a) => {
    const max = Number(a.municion ?? 0);
    const actual = Number(a.municion_actual ?? max);
    return total + Math.max(0, max - actual);
  }, 0);
}

/**
 * "Unidades/vehículos destruidos" es un dato por-entidad (`logistica.*_destruidos`
 * de QUIEN atacó), no por bando. Como el dominio de bandos es cerrado —solo
 * azul/rojo—, "lo que perdió el bando X" se deriva sumando los destruidos que
 * reclama todo el resto de bandos (sus víctimas son, por descarte, de X).
 */
function totalesPorBando() {
  const totales = new Map(); // bando -> { unidadesDestruidas, vehiculosDestruidos }
  for (const item of Store.todas()) {
    const bando = item.entidad?.bando;
    const log = item.entidad?.logistica;
    if (!bando || !log) continue;
    if (!totales.has(bando)) totales.set(bando, { unidadesDestruidas: 0, vehiculosDestruidos: 0 });
    const t = totales.get(bando);
    t.unidadesDestruidas += Number(log.unidades_enemigas_destruidas) || 0;
    t.vehiculosDestruidos += Number(log.vehiculos_enemigos_destruidos) || 0;
  }
  return totales;
}

function perdidasDe(totales, bando) {
  let unidades = 0;
  let vehiculos = 0;
  for (const [b, t] of totales) {
    if (b === bando) continue;
    unidades += t.unidadesDestruidas;
    vehiculos += t.vehiculosDestruidos;
  }
  return { unidades, vehiculos };
}

function iniciar() {
  // `direccion.js` escucha `ejercicio:vehiculo_modificado` para reflejar
  // ediciones del admin, pero solo se registra si `Session.esAdmin()` — un
  // jugador no lo recibe. La recarga la puede pedir cualquier jugador dueño
  // del vehículo, así que hace falta un listener que corra para todos: acá
  // solo se aplican los campos que puede tocar la recarga, para no duplicar
  // el resto de `direccion.js`.
  Socket.on('ejercicio:vehiculo_modificado', (payload) => {
    const campos = {};
    if (payload.armamentos !== undefined) campos.armamentos = payload.armamentos;
    if (payload.municion_actual !== undefined) campos.municion_actual = payload.municion_actual;
    if (payload.autonomia_actual !== undefined) campos.autonomia_actual = payload.autonomia_actual;
    if (Object.keys(campos).length) Store.aplicarCampos('vehiculo', payload.entidad_id, campos);
  });
  // Un ejercicio nuevo (unirse a otro, o reiniciar) arranca la cuenta de
  // "cuánto reabastecí esta sesión" de nuevo.
  Store.on('ejercicio:contexto', () => repuesto.clear());
  Store.on('estado', () => { if (modal?.classList.contains('active')) render(); });
  Store.on('entidad:cambio', () => { if (modal?.classList.contains('active')) render(); });
  Store.on('entidad:posicion', () => { if (modal?.classList.contains('active')) render(); });
}

// ---------------------------------------------------------------------------
// Acción: recargar munición y autonomía (panel-entidad la invoca)
// ---------------------------------------------------------------------------

/**
 * Emite `logistica:recargar` (`src/sockets/handlers/logisticaHandler.js` del
 * backend, `backend.md` punto 18): rellena cada arma montada hasta su
 * dotación de catálogo y `autonomia_actual` hasta `autonomia`, sin pasarse.
 * El resultado real (armamentos/autonomía actualizados) llega por el
 * `ejercicio:vehiculo_modificado` que ya escucha `iniciar()`, así que acá
 * solo queda registrar CUÁNTO se repuso, para la columna de esta sesión.
 */
export async function recargar(item) {
  if (!item || item.tipo !== 'vehiculo') return;
  try {
    const respuesta = await Socket.emitir('logistica:recargar', {
      ejercicio_id: Store.ejercicioId,
      entidad_tipo: 'vehiculo',
      entidad_id: item.id,
    });
    const r = repuestoDe(item.clave);
    const totalMunicion = Object.values(respuesta.municion_repuesta || {})
      .reduce((total, cantidad) => total + Number(cantidad || 0), 0);
    r.municionRepuesta += totalMunicion;
    r.autonomiaRepuesta += Number(respuesta.autonomia_repuesta || 0);
    if (totalMunicion || Number(respuesta.autonomia_repuesta || 0)) {
      toastExito(`${item.entidad.nombre}: munición y autonomía reabastecidas`);
    } else {
      toastExito(`${item.entidad.nombre}: ya estaba al máximo`);
    }
    render();
  } catch (e) {
    toastError(`No se pudo recargar (${e.message})`);
  }
}

// ---------------------------------------------------------------------------
// Vista
// ---------------------------------------------------------------------------

function crearModal() {
  if (modal && document.body.contains(modal)) return modal;
  modal = document.createElement('div');
  modal.id = 'logistica-modal';
  modal.className = 'docs-modal logistica-modal';
  modal.innerHTML = `
    <div class="docs-modal-header">
      <h2>🪖 LOGÍSTICA</h2>
      <button id="logistica-modal-close" class="docs-modal-close">✕</button>
    </div>
    <div class="logistica-cuerpo">
      <div class="logistica-nota">
        Km recorridos, munición, autonomía, bajas y destruidos son datos en
        vivo del ejercicio (persisten aunque te desconectes). Munición y
        autonomía repuesta cuentan solo lo reabastecido en esta sesión.
      </div>
      <div class="logistica-resumen" id="logistica-resumen"></div>
      <div class="logistica-tabla-wrap">
        <table class="logistica-tabla" id="logistica-tabla">
          <thead>
            <tr>
              <th>Entidad</th><th>Tipo</th><th>Bando</th>
              <th>Km recorridos</th><th>Munición usada</th><th>Munición repuesta</th>
              <th>Autonomía restante</th><th>Autonomía repuesta</th>
              <th>Bajas propias</th><th>Bajas infligidas</th>
              <th>Uds. enemigas destr.</th><th>Vehíc. enemigos destr.</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#logistica-modal-close').addEventListener('click', () => modal.classList.remove('active'));
  return modal;
}

function filaHtml(item) {
  const e = item.entidad;
  const r = repuestoDe(item.clave);
  const log = e.logistica || {};

  const km = Number(e.distancia_recorrida) || 0;
  const esVehiculo = item.tipo === 'vehiculo';
  const mUsada = esVehiculo ? municionUsada(e) : null;
  const autonomiaMax = esVehiculo ? Number(e.autonomia) || 0 : 0;
  const autonomiaActual = esVehiculo && e.autonomia_actual !== undefined && e.autonomia_actual !== null
    ? Number(e.autonomia_actual)
    : null;
  const bajas = item.tipo === 'unidad' ? Number(log.bajas_propias) || 0 : null;
  const estado = estadoVisual(item);

  return `
    <tr class="${estado === 'destruido' ? 'logistica-fila-destruida' : ''}">
      <td>${esc(e.nombre || `${item.tipo} ${item.id}`)}</td>
      <td>${esc(item.tipo)}</td>
      <td><span class="pe-bando bando-${esc(String(e.bando || 'neutral').toLowerCase())}">${esc(e.bando || '--')}</span></td>
      <td>${km.toFixed(2)} km</td>
      <td>${mUsada !== null ? mUsada : '--'}</td>
      <td>${r.municionRepuesta || '--'}</td>
      <td>${autonomiaActual !== null ? `${autonomiaActual.toFixed(1)} / ${autonomiaMax.toFixed(1)} km` : '--'}</td>
      <td>${r.autonomiaRepuesta ? `${r.autonomiaRepuesta.toFixed(1)} km` : '--'}</td>
      <td>${bajas !== null ? bajas : '--'}</td>
      <td>${Number(log.bajas_infligidas) || 0}</td>
      <td>${Number(log.unidades_enemigas_destruidas) || 0}</td>
      <td>${Number(log.vehiculos_enemigos_destruidos) || 0}</td>
      <td><span class="pe-estado estado-${esc(estado)}">${esc(estado)}</span></td>
    </tr>
  `;
}

/** Jugador: solo lo suyo. Administrador: todo, agrupado por bando (vista de dirección). */
function entidadesAMostrar() {
  if (Session.esAdmin()) {
    return Store.todas().slice().sort((a, b) => String(a.entidad.bando).localeCompare(String(b.entidad.bando)));
  }
  return Store.mias();
}

function tarjetaResumen(etiqueta, valor, clase = '') {
  return `<div class="logistica-tarjeta ${clase}"><span class="lg-valor">${valor}</span><span class="lg-etiqueta">${esc(etiqueta)}</span></div>`;
}

function renderResumen() {
  const cont = modal.querySelector('#logistica-resumen');
  if (!cont) return;

  const totales = totalesPorBando();

  if (Session.esAdmin()) {
    const bandos = [...totales.keys()];
    cont.innerHTML = bandos.length
      ? bandos.map((bando) => {
          const propio = totales.get(bando);
          const perdidas = perdidasDe(totales, bando);
          return `
            <div class="logistica-resumen-bando">
              <span class="pe-bando bando-${esc(bando.toLowerCase())}">${esc(bando)}</span>
              ${tarjetaResumen('Unidades destruidas', propio.unidadesDestruidas, 'lg-buena')}
              ${tarjetaResumen('Vehículos destruidos', propio.vehiculosDestruidos, 'lg-buena')}
              ${tarjetaResumen('Unidades perdidas', perdidas.unidades, 'lg-mala')}
              ${tarjetaResumen('Vehículos perdidos', perdidas.vehiculos, 'lg-mala')}
            </div>
          `;
        }).join('')
      : '<div class="pe-nota">Sin combates registrados</div>';
    return;
  }

  const mio = totales.get(Store.bando) || { unidadesDestruidas: 0, vehiculosDestruidos: 0 };
  const perdidas = perdidasDe(totales, Store.bando);

  cont.innerHTML = `
    ${tarjetaResumen('Unidades enemigas destruidas', mio.unidadesDestruidas, 'lg-buena')}
    ${tarjetaResumen('Vehículos enemigos destruidos', mio.vehiculosDestruidos, 'lg-buena')}
    ${tarjetaResumen('Unidades propias perdidas', perdidas.unidades, 'lg-mala')}
    ${tarjetaResumen('Vehículos propios perdidos', perdidas.vehiculos, 'lg-mala')}
  `;
}

/** Incluye el equipo con su unidad y sus vehículos anidados. */
function todasLasFilas(items) {
  const salida = [];
  for (const item of items) {
    salida.push(item);
    if (item.tipo === 'unidad') {
      for (const v of item.entidad.vehiculos || []) {
        const it = Store.obtener('vehiculo', v.id);
        if (it) salida.push(it);
      }
    }
  }
  // Evita duplicar un vehículo si ya vino suelto en la lista original.
  const vistos = new Set();
  return salida.filter((it) => (vistos.has(it.clave) ? false : (vistos.add(it.clave), true)));
}

export function render() {
  if (!modal || !modal.classList.contains('active')) return;
  renderResumen();
  const tbody = modal.querySelector('#logistica-tabla tbody');
  const items = todasLasFilas(entidadesAMostrar());
  tbody.innerHTML = items.length
    ? items.map(filaHtml).join('')
    : '<tr><td colspan="13" class="pe-nota">Sin unidades a cargo en este ejercicio</td></tr>';
}

export function abrir() {
  crearModal();
  modal.classList.add('active');
  render();
}

export function cerrar() {
  modal?.classList.remove('active');
}

export function init() {
  crearModal();
  iniciar();
}

export default { init, abrir, cerrar, render, recargar };
