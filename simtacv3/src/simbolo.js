// Render de símbolos tácticos con milsymbol (MIL-STD-2525 / APP-6).
//
// `ms` viene del CDN como global (ver index.html). milsymbol 3.x entiende los
// dos formatos que hay en el catálogo:
//   · numérico  "10031000211211000000"  (2525D / APP-6D)
//   · alfanumérico "SFGPUCI----E***"    (2525B/C)
//
// `isValid()` distingue un código real de uno mal escrito: milsymbol igual
// devuelve un SVG para los inválidos (su placeholder), así que sin esa
// comprobación un SIDC roto pasaría desapercibido.

const TAMANIO_POR_DEFECTO = 30;

function disponible() {
  return typeof ms !== 'undefined' && typeof ms.Symbol === 'function';
}

/** Instancia de milsymbol, o null si el SIDC está vacío o la lib no cargó. */
function simbolo(sidc, opciones = {}) {
  if (!disponible()) return null;
  const codigo = String(sidc ?? '').trim();
  if (!codigo) return null;
  try {
    return new ms.Symbol(codigo, { size: TAMANIO_POR_DEFECTO, ...opciones });
  } catch {
    return null;
  }
}

/** ¿milsymbol reconoce el código? */
export function esValido(sidc) {
  const s = simbolo(sidc);
  return !!s && s.isValid();
}

/** SVG del símbolo como string, o null si no se pudo generar. */
export function svg(sidc, opciones = {}) {
  const s = simbolo(sidc, opciones);
  if (!s) return null;
  try {
    return s.asSVG();
  } catch {
    return null;
  }
}

/**
 * Marca lista para interpolar en innerHTML: el símbolo dentro de un contenedor
 * con tamaño fijo. Un SIDC inválido o ausente cae en un guion, no en el
 * placeholder de milsymbol, para que se note en la tabla.
 */
export function marca(sidc, opciones = {}) {
  const { alto = 34, titulo = true } = opciones;
  const codigo = String(sidc ?? '').trim();
  if (!codigo) return '<span class="simbolo-vacio" title="Sin SIDC">—</span>';

  const s = simbolo(codigo, opciones);
  if (!s || !s.isValid()) {
    return `<span class="simbolo-invalido" title="SIDC no reconocido por milsymbol">⚠</span>`;
  }

  const dibujo = svg(codigo, opciones);
  if (!dibujo) return '<span class="simbolo-invalido">⚠</span>';

  return `<span class="simbolo" style="height:${alto}px"${titulo ? ` title="${codigo}"` : ''}>${dibujo}</span>`;
}

/** Pinta el símbolo dentro de un nodo ya existente. */
export function pintar(contenedor, sidc, opciones = {}) {
  if (!contenedor) return;
  contenedor.innerHTML = marca(sidc, opciones);
}

export default { esValido, svg, marca, pintar };
