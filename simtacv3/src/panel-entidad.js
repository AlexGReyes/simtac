// Fase 3 — Panel lateral con el detalle de la entidad seleccionada y las
// acciones disponibles sobre ella.
//
// La UI valida para no ofrecer botones muertos, pero el backend es quien
// autoriza: cada acción maneja igual el rechazo del ack.

import Store from './store.js';
import Session from './session.js';
import Mapa, { estadoVisual } from './mapa.js';
import Movimiento from './movimiento.js';
import Combate from './combate.js';
import Logistica from './logistica.js';
import { esc } from './ui.js';
import { formatearDistancia } from './geo.js';

let panel = null;

/** Umbrales de combate que aplica el backend; se muestran como referencia. */
export function umbralCombate(item) {
  return Store.umbralCombate(item);
}

/** Un vehículo `tierra`/`anfibio` sigue rutas del servidor; `aire`/`mar`, waypoints libres. */
export function modalidadMovimiento(item) {
  if (item.tipo === 'unidad') return { terrestre: true, libre: false };
  const tipo = item.entidad.tipo;
  if (tipo === 'anfibio') return { terrestre: true, libre: true };
  if (tipo === 'tierra') return { terrestre: true, libre: false };
  return { terrestre: false, libre: true };
}

/** Un vehículo con munición o autonomía por debajo del máximo de catálogo puede recargar. */
function necesitaRecarga(item) {
  if (item.tipo !== 'vehiculo') return false;
  const v = item.entidad;
  const armas = v.armamentos || [];
  const faltaMunicion = armas.some((a) => Number(a.municion_actual ?? a.municion ?? 0) < Number(a.municion ?? 0));
  const autonomiaMax = Number(v.autonomia) || 0;
  const autonomiaActual = v.autonomia_actual !== undefined && v.autonomia_actual !== null
    ? Number(v.autonomia_actual)
    : autonomiaMax;
  const faltaAutonomia = autonomiaMax > 0 && autonomiaActual < autonomiaMax;
  return faltaMunicion || faltaAutonomia;
}

function crearPanel() {
  if (panel && document.body.contains(panel)) return panel;
  panel = document.createElement('aside');
  panel.id = 'panel-entidad';
  panel.className = 'panel-entidad';
  document.body.appendChild(panel);
  panel.addEventListener('click', (evento) => {
    const boton = evento.target.closest('[data-accion]');
    if (!boton) return;
    manejarAccion(boton.dataset.accion);
  });
  return panel;
}

function barra(valor, maximo, clase) {
  const pct = maximo > 0 ? Math.max(0, Math.min(100, (valor / maximo) * 100)) : 0;
  return `<div class="pe-barra"><div class="pe-barra-relleno ${clase}" style="width:${pct.toFixed(1)}%"></div></div>`;
}

function fila(etiqueta, valor, extra = '') {
  return `<div class="pe-fila"><span class="pe-label">${esc(etiqueta)}</span><span class="pe-valor ${extra}">${valor}</span></div>`;
}

function seccionArmamentos(vehiculo) {
  const armas = vehiculo.armamentos || [];
  if (!armas.length) return '<div class="pe-vacio">Sin armamento montado</div>';
  return armas.map((a) => {
    const municion = a.municion_actual ?? a.municion ?? 0;
    return `
      <div class="pe-arma ${Number(municion) <= 0 ? 'sin-municion' : ''}">
        <div class="pe-arma-head">
          <span>${esc(a.nombre || `Arma ${a.armamento_id}`)}</span>
          <span class="pe-arma-mun">${esc(municion)} mun.</span>
        </div>
        <div class="pe-arma-meta">
          <span>vs ${esc(a.tipo_ataque || '--')}</span>
          <span>cad. ${esc(a.cadencia_disparo_seg ?? '--')}s</span>
          <span>u ${esc(a.danio_unidades_pct ?? '--')}%</span>
          <span>v ${esc(a.danio_vehiculos_pct ?? '--')}%</span>
        </div>
      </div>
    `;
  }).join('');
}

function seccionUnidad(item) {
  const u = item.entidad;
  return `
    ${fila('Efectivo', `<strong>${esc(u.efectivo ?? '--')}</strong>`)}
    ${fila('Ataque', esc(u.ataque ?? '--'))}
    ${fila('Defensa', `${esc(u.defensa ?? '--')} <small class="pe-nota">(no la usa el motor de combate)</small>`)}
    ${fila('Velocidad', `${esc(u.velocidad_movimiento ?? '--')} km/h`)}
    ${fila('Rango de visión', formatearDistancia(u.rango_vision_m))}
    ${fila('Umbral de combate', formatearDistancia(umbralCombate(item)))}
    ${fila('Movimiento', esc(u.estado_movimiento || 'estacionado'))}
    ${fila('Distancia recorrida', formatearDistancia((u.distancia_recorrida || 0) * 1000))}
  `;
}

function seccionVehiculo(item) {
  const v = item.entidad;
  const umbral = Number(v.umbral_danio) || 0;
  const danio = Number(v.danio_acumulado) || 0;
  const estado = estadoVisual(item);
  const autonomiaMax = Number(v.autonomia) || 0;
  // `autonomia_actual` es el combustible que queda (recargable); `distancia_recorrida`
  // es el odómetro puro, nunca se toca (backend.md, punto 18).
  const autonomiaActual = v.autonomia_actual !== undefined && v.autonomia_actual !== null
    ? Number(v.autonomia_actual)
    : Math.max(0, autonomiaMax - (Number(v.distancia_recorrida) || 0));
  const recorrido = Number(v.distancia_recorrida) || 0;
  const esAire = Store.esVehiculoAire(item);

  return `
    ${fila('Tipo', esc(v.tipo || '--'))}
    ${fila('Estado', `<span class="pe-estado estado-${esc(estado)}">${esc(v.estado_actual || estado)}</span>`)}
    ${esAire ? fila('Posición base', (v.posicion_base_x !== undefined && v.posicion_base_x !== null)
      ? `${Number(v.posicion_base_x).toFixed(5)}, ${Number(v.posicion_base_y).toFixed(5)}`
      : '<span class="pe-nota">sin definir</span>') : ''}
    <div class="pe-bloque">
      <div class="pe-fila"><span class="pe-label">Daño acumulado</span><span class="pe-valor">${danio.toFixed(1)} / ${umbral.toFixed(1)}</span></div>
      ${barra(umbral - danio, umbral || 1, 'vida')}
    </div>
    ${fila('Munición total', esc(v.municion_actual ?? '--'))}
    ${fila('Velocidad', `${esc(v.velocidad_desplazamiento ?? '--')} km/h`)}
    ${fila('Rango de visión', formatearDistancia(v.rango_vision_m))}
    ${fila('Umbral de combate', formatearDistancia(umbralCombate(item)))}
    ${fila('Distancia recorrida', `${recorrido.toFixed(2)} km`)}
    ${autonomiaMax > 0 ? `
      <div class="pe-bloque">
        <div class="pe-fila"><span class="pe-label">Autonomía restante</span><span class="pe-valor">${autonomiaActual.toFixed(1)} / ${autonomiaMax.toFixed(1)} km</span></div>
        ${barra(autonomiaActual, autonomiaMax, 'combustible')}
      </div>` : ''}
    ${fila('Movimiento', esc(v.estado_movimiento || 'estacionado'))}
    <div class="pe-subtitulo">Armamento</div>
    ${seccionArmamentos(v)}
  `;
}

/**
 * Vehículos que cuelgan de esta entidad: los de una unidad, o los que
 * transporta un vehículo (`unidad_padre_tipo: "vehiculo_militar"` +
 * `unidad_padre_id`). Ambos se mueven y atacan por su cuenta, no dependen de
 * las acciones del padre, así que hay que poder saltar a ellos desde acá.
 */
function vehiculosHijos(item) {
  if (item.tipo === 'unidad') return item.entidad.vehiculos || [];
  if (item.tipo === 'vehiculo') {
    return Store.todas()
      .filter((i) => i.tipo === 'vehiculo'
        && i.entidad.unidad_padre_tipo === 'vehiculo_militar'
        && Number(i.entidad.unidad_padre_id) === Number(item.id))
      .map((i) => i.entidad);
  }
  return [];
}

function seccionVehiculosHijos(item) {
  const vehiculos = vehiculosHijos(item);
  if (!vehiculos.length) return '';
  const titulo = item.tipo === 'unidad' ? 'Vehículos de la unidad' : 'Vehículos transportados';
  return `
    <div class="pe-subtitulo">${titulo} (${vehiculos.length})</div>
    <div class="pe-lista-vehiculos">
      ${vehiculos.map((v) => `
        <button class="pe-vehiculo-item" data-accion="seleccionar:vehiculo:${esc(v.id)}">
          <span>${esc(v.nombre || `Vehículo ${v.id}`)}</span>
          <span class="pe-vehiculo-estado estado-${esc(v.estado_actual || 'activo')}">${esc(v.estado_actual || 'activo')}</span>
        </button>
      `).join('')}
    </div>
  `;
}

function seccionDeteccion(item) {
  // `detectado_por[]` dice quién la está viendo A ELLA: para las propias, si el
  // enemigo las tiene localizadas.
  const propia = Store.esAliada(item.entidad);
  const vistoPor = Array.isArray(item.entidad.detectado_por) ? item.entidad.detectado_por : [];
  const observadores = Store.observadoresDe(item.tipo, item.id);

  if (propia) {
    return vistoPor.length
      ? `<div class="pe-alerta">⚠ Detectada por ${vistoPor.length} elemento(s) enemigo(s)</div>`
      : '<div class="pe-ok">Sin detección enemiga conocida</div>';
  }

  const deteccion = Store.detecciones.get(item.clave);
  return `
    <div class="pe-bloque">
      ${fila('La ven', observadores.length
        ? observadores.map((k) => {
            const [tipo, id] = k.split(':');
            return esc(Store.nombre(tipo, id));
          }).join(', ')
        : '--')}
      ${deteccion?.distancia_m !== undefined ? fila('Distancia', formatearDistancia(deteccion.distancia_m)) : ''}
    </div>
  `;
}

function botones(item) {
  const controlo = Store.controlo(item);
  const estado = estadoVisual(item);
  const activo = Store.enEjecucion();
  const enCombate = !!item.entidad.en_combate;
  const modalidad = modalidadMovimiento(item);
  const inoperante = estado === 'destruido';

  // No se puede mover una entidad en combate: primero hay que retirarse.
  const puedeMover = controlo && activo && !enCombate && !inoperante;
  const razon = !controlo ? 'No controlás esta entidad'
    : inoperante ? 'La entidad está fuera de combate'
    : !activo ? `El ejercicio está ${Store.estadoEjercicio() || 'sin iniciar'}`
    : enCombate ? 'Está en combate: hay que retirarse antes de moverse'
    : '';

  const enMovimiento = item.entidad.estado_movimiento && item.entidad.estado_movimiento !== 'estacionado';
  const esAire = Store.esVehiculoAire(item);

  // Un vehículo aire solo puede atacar mientras está en movimiento.
  const puedeAtacarAhora = !esAire || Store.enMovimiento(item);
  const razonAtaque = puedeAtacarAhora ? '' : 'Un vehículo aéreo solo puede atacar mientras está en movimiento';

  return `
    <div class="pe-acciones">
      ${modalidad.terrestre ? `<button class="pe-btn" data-accion="mover" ${puedeMover ? '' : 'disabled'} title="${esc(razon || 'Clic en el mapa para fijar el destino')}">🎯 Mover a…</button>` : ''}
      ${modalidad.libre ? `<button class="pe-btn" data-accion="mover_libre" ${puedeMover ? '' : 'disabled'} title="${esc(razon || 'Trazá la polilínea en el mapa')}">✏️ Trazar ruta</button>` : ''}
      ${esAire ? `<button class="pe-btn" data-accion="establecer_base" ${controlo ? '' : 'disabled'} title="Clic en el mapa para fijar la nueva base">🏠 Establecer base</button>` : ''}
      ${enMovimiento ? `<button class="pe-btn pe-btn-alerta" data-accion="cancelar_movimiento" ${controlo ? '' : 'disabled'} title="${esAire ? 'Cambia la ruta y vuelve directo a la base' : 'Detiene la entidad donde está'}">${esAire ? '🏠 Volver a base' : '⛔ Cancelar movimiento'}</button>` : ''}
      ${enCombate ? `<button class="pe-btn pe-btn-alerta" data-accion="retirarse" ${controlo ? '' : 'disabled'}>🏳️ Retirarse</button>` : ''}
      ${!enCombate && controlo && activo && !inoperante ? `<button class="pe-btn" data-accion="atacar" ${puedeAtacarAhora ? '' : 'disabled'} title="${esc(razonAtaque || 'Elegí el objetivo en el mapa')}">⚔️ Atacar objetivo…</button>` : ''}
      ${item.tipo === 'vehiculo' && controlo && !inoperante ? `<button class="pe-btn pe-btn-plano" data-accion="recargar" ${necesitaRecarga(item) ? '' : 'disabled'} title="${necesitaRecarga(item) ? 'Reabastece munición y autonomía al máximo de catálogo' : 'Munición y autonomía al máximo'}">🔧 Recargar munición y autonomía</button>` : ''}
      <button class="pe-btn pe-btn-plano" data-accion="centrar">📍 Centrar</button>
      ${Session.esAdmin() ? `
        <button class="pe-btn pe-btn-plano" data-accion="visibilidad">${item.entidad.visible === false ? '👁 Hacer visible' : '🚫 Ocultar al enemigo'}</button>
        <button class="pe-btn pe-btn-plano" data-accion="editar">✎ Editar en caliente</button>
      ` : ''}
    </div>
    ${razon ? `<div class="pe-razon">${esc(razon)}</div>` : ''}
    ${!razon && razonAtaque ? `<div class="pe-razon">${esc(razonAtaque)}</div>` : ''}
  `;
}

export function render() {
  const el = crearPanel();
  const item = Store.seleccionada();

  if (!item) {
    el.classList.remove('visible');
    el.innerHTML = '';
    return;
  }

  const e = item.entidad;
  el.classList.add('visible');
  el.innerHTML = `
    <div class="pe-header">
      <div>
        <div class="pe-nombre">${esc(e.nombre || `${item.tipo} ${item.id}`)}</div>
        <div class="pe-sub">
          <span class="pe-bando bando-${esc(String(e.bando || 'neutral').toLowerCase())}">${esc(e.bando || 'sin bando')}</span>
          <span class="pe-tipo">${esc(item.tipo)}</span>
          ${Store.controlo(item) ? '<span class="pe-propia">bajo tu mando</span>' : ''}
        </div>
      </div>
      <button class="pe-cerrar" data-accion="cerrar">✕</button>
    </div>
    <div class="pe-sidc"><code>${esc(e.sidc || '--')}</code></div>
    ${e.en_combate ? '<div class="pe-alerta pe-combate">⚔️ EN COMBATE</div>' : ''}
    ${e.en_rango_combate && !e.en_combate ? '<div class="pe-aviso">🎯 Enemigo en rango de combate</div>' : ''}
    ${e.en_retirada ? '<div class="pe-aviso">🏳️ En retirada</div>' : ''}
    ${e.visible === false ? '<div class="pe-aviso">🚫 Oculta para el enemigo (dirección)</div>' : ''}
    <div class="pe-cuerpo">
      ${item.tipo === 'unidad' ? seccionUnidad(item) : seccionVehiculo(item)}
      ${seccionVehiculosHijos(item)}
      <div class="pe-subtitulo">Detección</div>
      ${seccionDeteccion(item)}
    </div>
    ${botones(item)}
  `;
}

async function manejarAccion(accion) {
  const item = Store.seleccionada();
  if (accion.startsWith('seleccionar:')) {
    const [, tipo, id] = accion.split(':');
    Store.seleccionar(`${tipo}:${id}`);
    return;
  }
  if (!item) return;

  switch (accion) {
    case 'cerrar':
      Store.seleccionar(null);
      break;
    case 'centrar':
      Mapa.centrarEn(item.entidad);
      break;
    case 'mover':
      Movimiento.iniciarModoDestino(item);
      break;
    case 'mover_libre':
      Movimiento.iniciarModoPolilinea(item);
      break;
    case 'establecer_base':
      Movimiento.iniciarModoBase(item);
      break;
    case 'cancelar_movimiento':
      Movimiento.cancelar(item);
      break;
    case 'retirarse':
      Combate.retirarse(item);
      break;
    case 'atacar':
      Combate.elegirObjetivo(item);
      break;
    case 'recargar':
      Logistica.recargar(item);
      break;
    case 'visibilidad':
      window.simtacDireccion?.alternarVisibilidad(item);
      break;
    case 'editar':
      window.simtacDireccion?.editarEntidad(item);
      break;
  }
}

export function init() {
  crearPanel();
  Store.on('seleccion', render);
  Store.on('entidad:cambio', (item) => {
    if (item && Store.seleccion === item.clave) render();
  });
  Store.on('entidad:posicion', (item) => {
    if (item && Store.seleccion === item.clave && item.tipo === 'vehiculo') render();
  });
  Store.on('deteccion', () => {
    if (Store.seleccion) render();
  });
  Store.on('estado', () => render());
}

export default { init, render, umbralCombate, modalidadMovimiento };
