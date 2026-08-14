// Utilidades de presentación compartidas: toasts, escape de HTML, confirmaciones.

/** Escapa texto para interpolar en innerHTML sin riesgo de inyección. */
export function esc(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let contenedorToasts = null;

function asegurarContenedor() {
  if (contenedorToasts && document.body.contains(contenedorToasts)) return contenedorToasts;
  contenedorToasts = document.createElement('div');
  contenedorToasts.id = 'toast-container';
  contenedorToasts.className = 'toast-container';
  document.body.appendChild(contenedorToasts);
  return contenedorToasts;
}

/**
 * Muestra un aviso efímero.
 * @param {string} mensaje
 * @param {'info'|'exito'|'error'|'aviso'} tipo
 */
export function toast(mensaje, tipo = 'info', ms = 4000) {
  const cont = asegurarContenedor();
  const el = document.createElement('div');
  el.className = `toast toast-${tipo}`;
  el.textContent = mensaje;
  cont.appendChild(el);
  requestAnimationFrame(() => el.classList.add('visible'));
  setTimeout(() => {
    el.classList.remove('visible');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

export const toastError = (m) => toast(m, 'error', 6000);
export const toastExito = (m) => toast(m, 'exito');
export const toastAviso = (m) => toast(m, 'aviso', 5000);

/**
 * Confirmación con detalle del alcance de la acción.
 * Los borrados del backend cascadean sin avisar (ver frontend.md, fase 2), así
 * que toda destrucción tiene que pasar por acá.
 */
export function confirmar(titulo, detalle) {
  return window.confirm(detalle ? `${titulo}\n\n${detalle}` : titulo);
}

/** Crea un elemento con clase/atributos/HTML en una sola expresión. */
export function el(tag, props = {}, html = '') {
  const nodo = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') nodo.className = v;
    else if (k === 'dataset') Object.assign(nodo.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') nodo.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) nodo.setAttribute(k, v);
  }
  if (html) nodo.innerHTML = html;
  return nodo;
}

/** Hora corta local a partir de un timestamp ISO. */
export function hora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

/** Fecha y hora local a partir de un timestamp ISO. */
export function fechaHora(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  if (isNaN(d)) return '--';
  return d.toLocaleString('es-ES', { hour12: false });
}

export default { esc, toast, toastError, toastExito, toastAviso, confirmar, el, hora, fechaHora };
