// Panel de jugador: unidades y vehículos a cargo, para ubicarlos rápido en
// el mapa. Es puramente de navegación — no repite lo que ya hace Logística
// (kilómetros, munición, bajas): acá solo interesa "¿dónde está y cómo la
// encuentro?".
//
// Reusa `Store.mias()` (mismo criterio de "controlo esta entidad" que usa
// el resto del frontend) y `Mapa.centrarEn()` (mismo camino que el botón
// "Centrar" del panel de entidad).

import Api from './api.js';
import Store from './store.js';
import Mapa, { estadoVisual } from './mapa.js';
import { esc } from './ui.js';

let modal = null;

function crearModal() {
  if (modal && document.body.contains(modal)) return modal;
  modal = document.createElement('div');
  modal.id = 'mis-unidades-modal';
  modal.className = 'docs-modal mis-unidades-modal';
  modal.innerHTML = `
    <div class="docs-modal-header">
      <h2>📍 MIS UNIDADES</h2>
      <button id="mis-unidades-modal-close" class="docs-modal-close">✕</button>
    </div>
    <div class="mis-unidades-cuerpo">
      <div class="mis-unidades-nota">Tocá una fila para centrarla en el mapa y abrir su panel de detalle.</div>
      <div class="mis-unidades-lista" id="mis-unidades-lista"></div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#mis-unidades-modal-close').addEventListener('click', cerrar);
  return modal;
}

/**
 * Ids de `GET /unidades/mias`: la respuesta del servidor sobre qué comanda el
 * usuario, independiente de los campos de control que traiga el estado del
 * ejercicio. Trae unidades de todos los ejercicios; se cruza con el Store.
 */
let idsDelServidor = new Set();

async function consultarServidor() {
  try {
    const respuesta = await Api.unidades.mias();
    const lista = Array.isArray(respuesta) ? respuesta : (respuesta?.unidades || respuesta?.data || []);
    idsDelServidor = new Set(lista.map((u) => Number(u.id ?? u.unidad_militar_id)).filter(Number.isFinite));
    const faltan = [...idsDelServidor].filter((id) => Store.obtener('unidad', id) && !Store.controlo(Store.obtener('unidad', id)));
    if (faltan.length) {
      console.warn('[mis-unidades] /unidades/mias trae unidades que el estado del ejercicio no marca como propias ' +
        '(sin usuarios_ids/unidades_ids para este usuario):', faltan);
    }
    render();
  } catch (error) {
    console.warn('[mis-unidades] no se pudo consultar /unidades/mias:', error);
  }
}

function propias() {
  const salida = Store.mias();
  for (const id of idsDelServidor) {
    const item = Store.obtener('unidad', id);
    if (item) salida.push(item);
  }
  return salida;
}

/** Incluye cada unidad con sus vehículos anidados, igual que hace logistica.js. */
function todasLasFilas() {
  const salida = [];
  for (const item of propias()) {
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

function irA(item) {
  Store.seleccionar(item.clave);
  Mapa.centrarEn(item.entidad, 15);
  cerrar();
}

function filaHtml(item) {
  const e = item.entidad;
  const estado = estadoVisual(item);
  const enMovimiento = e.estado_movimiento && e.estado_movimiento !== 'estacionado';
  return `
    <button type="button" class="mis-unidades-fila ${estado === 'destruido' ? 'mu-destruida' : ''}" data-clave="${esc(item.clave)}">
      <span class="mu-icono">${item.tipo === 'vehiculo' ? '🚗' : '⛊'}</span>
      <span class="mu-info">
        <span class="mu-nombre">${esc(e.nombre || `${item.tipo} ${item.id}`)}</span>
        <span class="mu-meta">
          <span class="estado-${esc(estado)}">${esc(estado)}</span>
          ${enMovimiento ? '<span class="mu-movimiento">● en movimiento</span>' : ''}
        </span>
      </span>
      <span class="mu-flecha" title="Centrar en el mapa">📍</span>
    </button>
  `;
}

export function render() {
  if (!modal || !modal.classList.contains('active')) return;
  const cont = modal.querySelector('#mis-unidades-lista');
  const items = todasLasFilas();
  cont.innerHTML = items.length
    ? items.map(filaHtml).join('')
    : '<div class="pe-nota">No tenés unidades ni vehículos a cargo en este ejercicio</div>';
  cont.querySelectorAll('[data-clave]').forEach((boton) => {
    boton.addEventListener('click', () => {
      const item = Store.obtenerPorClave(boton.dataset.clave);
      if (item) irA(item);
    });
  });
}

export function abrir() {
  crearModal();
  modal.classList.add('active');
  render();
  consultarServidor();
}

export function cerrar() {
  modal?.classList.remove('active');
}

function iniciar() {
  Store.on('estado', () => { if (modal?.classList.contains('active')) render(); });
  Store.on('entidad:cambio', () => { if (modal?.classList.contains('active')) render(); });
  Store.on('entidad:posicion', () => { if (modal?.classList.contains('active')) render(); });
}

export function init() {
  crearModal();
  iniciar();
}

export default { init, abrir, cerrar, render };
