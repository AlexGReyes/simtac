// Fase 6 — Combate.
//
// El ataque es opt-in: entrar en rango NO inicia nada. El backend avisa con
// `combate:en_rango` (solo al dueño de la entidad y a los administradores) y el
// jugador decide: ATACAR / IGNORAR / RETIRARSE. Eso define la UX de la fase.
//
// `confirmar_ataque` traba a las dos entidades (en_combate: true) y les cancela
// el movimiento; `retirarse` se puede emitir en cualquier momento.

import Store, { clave } from './store.js';
import Session from './session.js';
import Socket from './socket.js';
import Mapa from './mapa.js';
import { toast, toastError, toastAviso, esc, hora } from './ui.js';
import { formatearDistancia } from './geo.js';

/** Avisos pendientes de decisión, en orden de llegada. */
const cola = [];
let dialogo = null;
let panelLog = null;
let desuscribirObjetivo = null;
const entradasLog = [];
const MAX_LOG = 120;

// ---------------------------------------------------------------------------
// Diálogo de decisión
// ---------------------------------------------------------------------------

function crearDialogo() {
  if (dialogo && document.body.contains(dialogo)) return dialogo;
  dialogo = document.createElement('div');
  dialogo.id = 'dialogo-combate';
  dialogo.className = 'dialogo-combate';
  document.body.appendChild(dialogo);
  return dialogo;
}

function mostrarSiguiente() {
  const el = crearDialogo();
  if (!cola.length) {
    el.classList.remove('visible');
    el.innerHTML = '';
    return;
  }

  const aviso = cola[0];
  const propia = Store.obtener(aviso.entidad_tipo, aviso.entidad_id);
  const objetivo = Store.obtener(aviso.objetivo_tipo, aviso.objetivo_id);

  // `en_combate` se lee en vivo del Store (no de `aviso`, que es la foto de
  // cuando se encoló): así, si el combate arranca mientras este mismo aviso
  // ya está en cola, alcanza con volver a llamar a `mostrarSiguiente()` para
  // que RETIRARSE pase a habilitado sin tener que tocar la cola.
  const enCombate = !!propia?.entidad.en_combate;
  // Se puede anticipar el rechazo (armamento, aire en movimiento), pero igual
  // hay que manejar el que devuelva el backend. Si ya está en combate no
  // tiene sentido reconfirmar el ataque: ya está en curso.
  const veredicto = propia && objetivo ? puedeAtacar(propia, objetivo) : { ok: true };
  const puedeAtacarAhora = veredicto.ok && !enCombate;

  el.classList.add('visible');
  el.innerHTML = `
    <div class="dc-caja">
      <div class="dc-header">${enCombate ? '⚔️ EN COMBATE' : '⚔️ ENEMIGO EN RANGO'} ${cola.length > 1 ? `<span class="dc-cola">+${cola.length - 1} en espera</span>` : ''}</div>
      <div class="dc-cuerpo">
        <div class="dc-linea"><span>Tu entidad</span><strong>${esc(propia?.entidad.nombre || `${aviso.entidad_tipo} ${aviso.entidad_id}`)}</strong></div>
        <div class="dc-linea"><span>Objetivo</span><strong>${esc(aviso.objetivo_nombre || `${aviso.objetivo_tipo} ${aviso.objetivo_id}`)}</strong></div>
        <div class="dc-linea"><span>Bando</span><span class="dc-bando bando-${esc(String(aviso.objetivo_bando || '').toLowerCase())}">${esc(aviso.objetivo_bando || '?')}</span></div>
        <div class="dc-linea"><span>Distancia</span><strong>${formatearDistancia(aviso.distancia_m)}</strong></div>
        <div class="dc-linea"><span>Umbral de combate</span><strong>${formatearDistancia(aviso.umbral_m)}</strong></div>
        ${enCombate ? '<div class="dc-aviso">⚔️ El combate ya está en curso</div>' : (!veredicto.ok ? `<div class="dc-aviso">⚠ ${esc(veredicto.motivo)}</div>` : '')}
      </div>
      <div class="dc-acciones">
        <button class="dc-btn dc-atacar" data-dc="atacar" ${puedeAtacarAhora ? '' : 'disabled'}>⚔️ ATACAR</button>
        <button class="dc-btn dc-ignorar" data-dc="ignorar">➡️ IGNORAR</button>
        <button class="dc-btn dc-retirar" data-dc="retirar" ${enCombate ? '' : 'disabled'} title="${enCombate ? '' : esc('Todavía no está en combate: no hay nada de qué retirarse')}">🏳️ RETIRARSE</button>
        <button class="dc-btn dc-plano" data-dc="ver">📍 Ver en el mapa</button>
      </div>
    </div>
  `;

  el.querySelectorAll('[data-dc]').forEach((boton) => {
    boton.addEventListener('click', () => decidir(boton.dataset.dc, aviso));
  });
}

async function decidir(accion, aviso) {
  if (accion === 'ver') {
    const objetivo = Store.obtener(aviso.objetivo_tipo, aviso.objetivo_id);
    if (objetivo) {
      Store.seleccionar(objetivo.clave);
      Mapa.centrarEn(objetivo.entidad);
    }
    return;
  }

  if (accion === 'atacar') {
    try {
      const respuesta = await Socket.emitir('combate:confirmar_ataque', {
        ejercicio_id: Store.ejercicioId,
        entidad_tipo: aviso.entidad_tipo,
        entidad_id: aviso.entidad_id,
        objetivo_tipo: aviso.objetivo_tipo,
        objetivo_id: aviso.objetivo_id,
      });
      agregarLog('ataque', `Ataque confirmado a ${aviso.objetivo_nombre || aviso.objetivo_id} · ${formatearDistancia(respuesta.distancia_m)}` +
        (respuesta.armamentos_disparando?.length ? ` · armas: ${respuesta.armamentos_disparando.join(', ')}` : ''));
    } catch (e) {
      toastError(e.message);
    }
  } else if (accion === 'retirar') {
    const propia = Store.obtener(aviso.entidad_tipo, aviso.entidad_id);
    if (propia) await retirarse(propia);
  }

  cola.shift();
  mostrarSiguiente();
}

/**
 * Validación centralizada de si `atacante` puede atacar a `objetivo`, ANTES de
 * emitir `combate:confirmar_ataque`. Es solo anticipación en el cliente para
 * no ofrecer botones muertos — la autorización real la hace el backend, y
 * cualquier acción igual maneja el rechazo del ack.
 *
 * Reglas (ver `backend.md`, punto 13c, para la propuesta de que el servidor
 * las aplique también):
 *   1. Un vehículo de tipo "aire" SOLO puede atacar mientras está en
 *      movimiento (`estado_movimiento === 'en_movimiento'`).
 *   2. Una unidad no puede atacar a un vehículo "aire" que esté en movimiento.
 *   3. Un vehículo ataca según el `tipo_ataque` de su armamento:
 *      - "aire": solo vehículos "aire" en movimiento.
 *      - "tierra": todo excepto vehículos "aire" en movimiento.
 *      - cualquier otro valor: se compara contra el `tipo` del objetivo, como
 *        antes (compatibilidad con armamento "mar", etc.).
 */
export function puedeAtacar(atacante, objetivo) {
  if (!atacante || !objetivo) return { ok: false, motivo: 'Faltan datos del atacante o el objetivo' };

  if (Store.esVehiculoAire(atacante) && !Store.enMovimiento(atacante)) {
    return { ok: false, motivo: 'Un vehículo aéreo solo puede atacar mientras está en movimiento' };
  }

  const objetivoAireEnMovimiento = Store.esVehiculoAire(objetivo) && Store.enMovimiento(objetivo);

  if (atacante.tipo === 'unidad') {
    if (objetivoAireEnMovimiento) {
      return { ok: false, motivo: 'Una unidad no puede atacar a un vehículo aéreo en movimiento' };
    }
    return { ok: true };
  }

  // Atacante es vehículo: el tipo de ataque del armamento decide.
  const armas = atacante.entidad.armamentos || [];
  if (!armas.length) return { ok: false, motivo: 'El vehículo no tiene armamento montado' };

  const tipoObjetivo = objetivo.tipo === 'unidad' ? 'tierra' : (objetivo.entidad.tipo || 'tierra');
  const compatible = armas.some((a) => {
    const municion = Number(a.municion_actual ?? a.municion ?? 0);
    if (municion <= 0) return false;
    if (a.tipo_ataque === 'aire') return objetivoAireEnMovimiento;
    if (a.tipo_ataque === 'tierra') return !objetivoAireEnMovimiento;
    if (!a.tipo_ataque) return !objetivoAireEnMovimiento;
    return a.tipo_ataque === tipoObjetivo && !objetivoAireEnMovimiento;
  });

  if (!compatible) {
    return {
      ok: false,
      motivo: objetivoAireEnMovimiento
        ? 'Solo el armamento de tipo "aire" puede atacar a un vehículo aéreo en movimiento'
        : 'El vehículo no tiene armamento compatible con ese objetivo (o sin munición)',
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Acciones directas
// ---------------------------------------------------------------------------

export async function retirarse(item) {
  try {
    const respuesta = await Socket.emitir('combate:retirarse', {
      ejercicio_id: Store.ejercicioId,
      entidad_tipo: item.tipo,
      entidad_id: item.id,
    });
    // El log de la retirada lo escribe el listener de `combate:retirada` (más
    // abajo), no acá: ese evento es la confirmación del servidor y ya corre
    // para todos los involucrados. Loguearlo acá también duplicaba la
    // entrada para quien la pide ("se retira" + "se retiró" para la misma
    // acción, visible en el panel).
    toast(`${item.entidad.nombre} se retiró del combate`);
  } catch (e) {
    toastError(e.message);
  }
}

export async function confirmarAtaque(item, objetivo) {
  try {
    const respuesta = await Socket.emitir('combate:confirmar_ataque', {
      ejercicio_id: Store.ejercicioId,
      entidad_tipo: item.tipo,
      entidad_id: item.id,
      objetivo_tipo: objetivo.tipo,
      objetivo_id: objetivo.id,
    });
    agregarLog('ataque', `${item.entidad.nombre} ataca a ${objetivo.entidad.nombre} · ${formatearDistancia(respuesta.distancia_m)}`);
  } catch (e) {
    toastError(e.message);
  }
}

/** Modo mapa: elegir manualmente el objetivo de una entidad propia. */
export function elegirObjetivo(item) {
  const mapa = Mapa.instancia();
  window.simtacModoMapa = 'objetivo';
  toastAviso(`Elegí el objetivo de ${item.entidad.nombre} en el mapa (Esc cancela)`);

  const manejador = (evento) => {
    const feature = mapa.forEachFeatureAtPixel(evento.pixel, (f) => (f.get('clave') ? f : null), { hitTolerance: 8 });
    salirModoObjetivo();
    if (!feature) return;
    const objetivo = Store.obtenerPorClave(feature.get('clave'));
    if (!objetivo) return;
    if (Store.esAliada(objetivo.entidad) && objetivo.entidad.bando === item.entidad.bando) {
      toastError('No podés atacar a una entidad de tu bando');
      return;
    }
    const veredicto = puedeAtacar(item, objetivo);
    if (!veredicto.ok) {
      toastError(veredicto.motivo);
      return;
    }
    confirmarAtaque(item, objetivo);
  };

  mapa.on('singleclick', manejador);
  desuscribirObjetivo = () => mapa.un('singleclick', manejador);
}

function salirModoObjetivo() {
  window.simtacModoMapa = null;
  desuscribirObjetivo?.();
  desuscribirObjetivo = null;
}

// ---------------------------------------------------------------------------
// Log de combate
// ---------------------------------------------------------------------------

function crearLog() {
  if (panelLog && document.body.contains(panelLog)) return panelLog;
  panelLog = document.createElement('div');
  panelLog.id = 'log-combate';
  panelLog.className = 'log-combate';
  panelLog.innerHTML = `
    <div class="lc-header">
      <span>LOG DE COMBATE</span>
      <button class="lc-toggle" title="Minimizar">−</button>
    </div>
    <div class="lc-lista"></div>
  `;
  document.body.appendChild(panelLog);
  panelLog.querySelector('.lc-toggle').addEventListener('click', () => {
    panelLog.classList.toggle('colapsado');
    panelLog.querySelector('.lc-toggle').textContent = panelLog.classList.contains('colapsado') ? '+' : '−';
  });
  return panelLog;
}

function agregarLog(tipo, texto) {
  entradasLog.push({ tipo, texto, ts: new Date().toISOString() });
  if (entradasLog.length > MAX_LOG) entradasLog.shift();
  const el = crearLog();
  el.classList.add('visible');
  const lista = el.querySelector('.lc-lista');
  lista.innerHTML = entradasLog
    .slice()
    .reverse()
    .map((e) => `<div class="lc-item lc-${esc(e.tipo)}"><span class="lc-hora">${hora(e.ts)}</span>${esc(e.texto)}</div>`)
    .join('');
}

/** ¿Controlo esta entidad? `undefined` (evento sin ese lado, p. ej. `combate:retirada`) es "no". */
function controloEntidad(tipo, id) {
  if (tipo === undefined || id === undefined) return false;
  return Store.controlo(Store.obtener(tipo, id));
}

/**
 * ¿Me involucra este combate? `combate:iniciado`/`tick`/`finalizado`/`retirada`
 * llegan a TODA la room del ejercicio (`frontend.md`, fase 6 — igual que el
 * `entidad:movimiento_iniciado` de fase 4), no solo a los dos bandos que
 * pelean: sin este filtro, el log de combate de un jugador muestra los
 * combates de cualquier otro par de entidades del ejercicio, aunque no
 * controle ninguna de las dos. El administrador sí ve todo — es quien audita.
 */
function estoyInvolucrado(...pares) {
  if (Session.esAdmin()) return true;
  return pares.some(([tipo, id]) => controloEntidad(tipo, id));
}

/**
 * Al arrancar un combate de verdad, si controlo alguna de las dos entidades
 * me aseguro de tener a mano el diálogo con RETIRARSE habilitado. Cubre el
 * caso que quedaba sin aviso: un vehículo sin armamento nunca pasa por
 * ATACAR, así que si lo alcanza a atacar el enemigo primero, el combate
 * arranca sin que este jugador haya tocado nada — sin esto, la única forma
 * de retirarse era encontrar el botón en el panel lateral. Si el aviso de
 * `combate:en_rango` para este par ya estaba en cola, no hace falta
 * agregarlo de nuevo: alcanza con volver a pintar, `mostrarSiguiente()` lee
 * `en_combate` en vivo del Store.
 */
function asegurarAvisoDeRetirada(evento) {
  if (Session.esAdmin()) return;
  const lados = [
    [evento.entidad_tipo, evento.entidad_id, evento.objetivo_tipo, evento.objetivo_id],
    [evento.objetivo_tipo, evento.objetivo_id, evento.entidad_tipo, evento.entidad_id],
  ];
  let interviene = false;
  for (const [tipo, id, objTipo, objId] of lados) {
    if (!controloEntidad(tipo, id)) continue;
    interviene = true;
    const yaEnCola = cola.some((a) =>
      a.entidad_id === id && a.entidad_tipo === tipo &&
      a.objetivo_id === objId && a.objetivo_tipo === objTipo);
    if (yaEnCola) continue;
    const objetivo = Store.obtener(objTipo, objId);
    // Prioridad: un combate ya activo importa más que un simple "en rango"
    // de otro par que estuviera esperando turno.
    cola.unshift({
      entidad_tipo: tipo,
      entidad_id: id,
      objetivo_tipo: objTipo,
      objetivo_id: objId,
      objetivo_nombre: objetivo?.entidad.nombre,
      objetivo_bando: objetivo?.entidad.bando,
    });
  }
  if (interviene) mostrarSiguiente();
}

// ---------------------------------------------------------------------------
// Eventos del servidor
// ---------------------------------------------------------------------------

export function init() {
  crearDialogo();
  crearLog();

  // Transición fuera->dentro del umbral, solo si la entidad no combatía ya.
  // El backend avisa tanto al dueño de la entidad como a los administradores
  // (comentario de cabecera de este archivo), pero la decisión de ATACAR /
  // IGNORAR / RETIRARSE es del jugador: el administrador no controla la
  // entidad, así que para él el diálogo no tiene ninguna acción válida.
  Socket.on('combate:en_rango', (evento) => {
    if (Session.esAdmin()) return;
    const yaEnCola = cola.some((a) =>
      a.entidad_id === evento.entidad_id && a.entidad_tipo === evento.entidad_tipo &&
      a.objetivo_id === evento.objetivo_id && a.objetivo_tipo === evento.objetivo_tipo);
    if (yaEnCola) return;
    cola.push(evento);
    mostrarSiguiente();
  });

  Socket.on('combate:iniciado', (evento) => {
    Store.registrarCombate(evento);
    Store.aplicarCampos(evento.entidad_tipo, evento.entidad_id, { en_combate: true, estado_movimiento: 'estacionado' });
    Store.aplicarCampos(evento.objetivo_tipo, evento.objetivo_id, { en_combate: true, estado_movimiento: 'estacionado' });
    Mapa.limpiarTrayecto(evento.entidad_tipo, evento.entidad_id);
    Mapa.limpiarTrayecto(evento.objetivo_tipo, evento.objetivo_id);
    if (estoyInvolucrado([evento.entidad_tipo, evento.entidad_id], [evento.objetivo_tipo, evento.objetivo_id])) {
      agregarLog('inicio', `Combate iniciado: ${Store.nombre(evento.entidad_tipo, evento.entidad_id)} vs ${Store.nombre(evento.objetivo_tipo, evento.objetivo_id)}`);
    }
    asegurarAvisoDeRetirada(evento);
  });

  // `combate:tick` tiene dos formas; se discrimina por `modelo`.
  Socket.on('combate:tick', (evento) => {
    if (evento.modelo === 'lanchester') {
      // Infantería vs infantería. `bajas` es el delta del entero: un 0 no
      // significa que no pasó nada, el backend acumula la fracción.
      (evento.participantes || []).forEach((p) => {
        Store.aplicarCampos(p.entidad_tipo, p.entidad_id, { efectivo: Number(p.efectivo) });
      });
      if (estoyInvolucrado(...(evento.participantes || []).map((p) => [p.entidad_tipo, p.entidad_id]))) {
        const detalle = (evento.participantes || [])
          .map((p) => `${Store.nombre(p.entidad_tipo, p.entidad_id)}: ${p.efectivo} (−${p.bajas ?? 0})`)
          .join(' · ');
        agregarLog('tick', `[lanchester ${formatearDistancia(evento.distancia_m)}] ${detalle}`);
      }
    } else {
      // Modelo por armamento: cada arma dispara con su propia cadencia, así que
      // llegan ticks intercalados de armas distintas para el mismo combate.
      const campos = {};
      if (evento.efectivo !== undefined) campos.efectivo = Number(evento.efectivo);
      if (evento.danio_acumulado !== undefined) campos.danio_acumulado = Number(evento.danio_acumulado);
      if (evento.estado_actual !== undefined) campos.estado_actual = evento.estado_actual;
      Store.aplicarCampos(evento.objetivo_tipo, evento.objetivo_id, campos);

      if (evento.municion_restante !== undefined) {
        actualizarMunicion(evento.entidad_tipo, evento.entidad_id, evento.armamento_id, evento.municion_restante);
      }

      if (estoyInvolucrado([evento.entidad_tipo, evento.entidad_id], [evento.objetivo_tipo, evento.objetivo_id])) {
        const impacto = evento.danio !== undefined
          ? `daño ${Number(evento.danio).toFixed(1)} (acum. ${Number(evento.danio_acumulado ?? 0).toFixed(1)})`
          : `bajas ${evento.bajas ?? 0} → efectivo ${evento.efectivo ?? '?'}`;
        agregarLog('tick', `[${esc(evento.armamento_nombre || 'arma')}] ${Store.nombre(evento.entidad_tipo, evento.entidad_id)} → ${Store.nombre(evento.objetivo_tipo, evento.objetivo_id)}: ${impacto} · mun. ${evento.municion_restante ?? '?'}`);
      }
    }
    Store.registrarCombate(evento);
  });

  Socket.on('combate:finalizado', (evento) => {
    Store.cerrarCombate(evento);
    // Una entidad puede estar en varios combates: en_combate pasa a false solo
    // cuando ninguno la involucra.
    [[evento.entidad_tipo, evento.entidad_id], [evento.objetivo_tipo, evento.objetivo_id]].forEach(([tipo, id]) => {
      if (!tipo || id === undefined) return;
      const k = clave(tipo, id);
      const sigueEnCombate = [...Store.combates.keys()].some((ck) => ck.includes(k));
      Store.aplicarCampos(tipo, id, { en_combate: sigueEnCombate });
    });
    if (estoyInvolucrado([evento.entidad_tipo, evento.entidad_id], [evento.objetivo_tipo, evento.objetivo_id])) {
      agregarLog('fin', `Combate finalizado (${esc(evento.motivo || 'sin motivo')}): ${Store.nombre(evento.entidad_tipo, evento.entidad_id)} vs ${Store.nombre(evento.objetivo_tipo, evento.objetivo_id)}`);
    }
    // Si el aviso pendiente era de ese par, ya no aplica.
    const antes = cola.length;
    for (let i = cola.length - 1; i >= 0; i--) {
      const a = cola[i];
      if (a.entidad_id === evento.entidad_id && a.objetivo_id === evento.objetivo_id) cola.splice(i, 1);
    }
    if (cola.length !== antes) mostrarSiguiente();
  });

  Socket.on('combate:retirada', (evento) => {
    Store.aplicarCampos(evento.entidad_tipo, evento.entidad_id, { en_combate: false, en_retirada: true });
    if (estoyInvolucrado([evento.entidad_tipo, evento.entidad_id])) {
      agregarLog('retirada', `${Store.nombre(evento.entidad_tipo, evento.entidad_id)} se retiró`);
    }
  });

  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && window.simtacModoMapa === 'objetivo') salirModoObjetivo();
  });
}

function actualizarMunicion(tipo, id, armamentoId, municion) {
  const item = Store.obtener(tipo, id);
  if (!item || !Array.isArray(item.entidad.armamentos)) return;
  const arma = item.entidad.armamentos.find((a) => Number(a.armamento_id) === Number(armamentoId));
  if (arma) arma.municion_actual = Number(municion);
  // `municion_actual` del vehículo es la suma de la de sus armamentos.
  item.entidad.municion_actual = item.entidad.armamentos
    .reduce((total, a) => total + Number(a.municion_actual ?? a.municion ?? 0), 0);
  Store.emitir('entidad:cambio', item);
}

export default { init, retirarse, confirmarAtaque, elegirObjetivo, puedeAtacar };
