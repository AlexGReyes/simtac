// Fase 5 — Detección y niebla de guerra.
//
// El backend evalúa una vez por segundo (A ve a B si distancia <= A.rango_vision_m
// y B.visible === true) y emite a la room del bando: si el evento te llegó, es
// porque lo viste. El cliente solo lleva la cuenta de observadores por enemigo
// para no esconder la entidad con el primer `perdida_de_vista` cuando la están
// viendo varios elementos.

import Store, { clave } from './store.js';
import Session from './session.js';
import Mapa from './mapa.js';
import { toast } from './ui.js';
import { formatearDistancia } from './geo.js';
import Socket from './socket.js';

let panelContactos = null;

function crearPanel() {
  if (panelContactos && document.body.contains(panelContactos)) return panelContactos;
  panelContactos = document.createElement('div');
  panelContactos.id = 'panel-contactos';
  panelContactos.className = 'panel-contactos';
  document.body.appendChild(panelContactos);
  panelContactos.addEventListener('click', (evento) => {
    const fila = evento.target.closest('[data-clave]');
    if (!fila) return;
    Store.seleccionar(fila.dataset.clave);
    const item = Store.obtenerPorClave(fila.dataset.clave);
    if (item) Mapa.centrarEn(item.entidad);
  });
  return panelContactos;
}

/** Lista de contactos enemigos actualmente detectados, con quién los ve. */
export function renderContactos() {
  const el = crearPanel();
  // El administrador ve todo siempre: no le aplica la niebla ni el panel de contactos.
  if (Session.esAdmin()) {
    el.classList.remove('visible');
    return;
  }

  const contactos = [...Store.observadores.keys()]
    .map((k) => ({ item: Store.obtenerPorClave(k), deteccion: Store.detecciones.get(k), clave: k }))
    .filter((c) => c.item && Store.esEnemiga(c.item.entidad));

  if (!contactos.length) {
    el.classList.remove('visible');
    el.innerHTML = '';
    return;
  }

  el.classList.add('visible');
  el.innerHTML = `
    <div class="pc-header">CONTACTOS (${contactos.length})</div>
    <div class="pc-lista">
      ${contactos.map(({ item, deteccion, clave: k }) => {
        const observadores = Store.observadoresDe(item.tipo, item.id)
          .map((ok) => {
            const [tipo, id] = ok.split(':');
            return Store.nombre(tipo, id);
          });
        const distancia = deteccion?.distancia_m !== undefined ? formatearDistancia(deteccion.distancia_m) : '';
        return `
          <button class="pc-item" data-clave="${k}">
            <div class="pc-item-head">
              <span class="pc-nombre">${item.entidad.nombre || `${item.tipo} ${item.id}`}</span>
              <span class="pc-dist">${distancia}</span>
            </div>
            <div class="pc-obs">visto por: ${observadores.join(', ') || '--'}</div>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

export function init() {
  crearPanel();

  Socket.on('entidad:detectada', (evento) => {
    const nuevo = !Store.observadores.has(clave(evento.entidad_tipo, evento.entidad_id));
    Store.agregarDeteccion(evento);
    if (nuevo) {
      toast(`🎯 Contacto: ${evento.nombre || evento.entidad_tipo} (${evento.bando || '?'}) a ${formatearDistancia(evento.distancia_m)}`, 'aviso');
    }
  });

  Socket.on('entidad:perdida_de_vista', (evento) => {
    Store.quitarDeteccion(evento);
  });

  Store.on('estado', renderContactos);
  Store.on('deteccion', renderContactos);
}

export default { init, renderContactos };
