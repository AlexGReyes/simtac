// SIDC — Symbol Identification Code.
//
// Regla del sistema: el SIDC es de SOLO LECTURA. Su valor base es el de
// `unidad_militar_base.sidc` y lo único que puede cambiar es la **afiliación**,
// derivada del bando.
//
// El catálogo puede tener SIDC en dos formatos:
//
//   · **Numérico** (MIL-STD-2525D / APP-6D). Los primeros 10 dígitos son el
//     "Set A":
//
//       pos 1-2   Version
//       pos 3     Standard Identity 1 — contexto (0 real · 1 ejercicio · 2 simulación)
//       pos 4     Standard Identity 2 — AFILIACIÓN  <- lo único que se toca
//       pos 5-6   Symbol Set
//       pos 7     Status
//       pos 8     HQ / Task Force / Dummy
//       pos 9-10  Amplifier / Descriptor
//
//     Afiliaciones válidas en la posición 4:
//       0 Pending · 1 Unknown · 2 Assumed Friend · 3 Friend ·
//       4 Neutral · 5 Suspect/Joker · 6 Hostile/Faker
//
//   · **Alfanumérico** (MIL-STD-2525B/C, tipo `SFGPUCI----E***`). Acá NO se
//     toca nada: el SIDC queda tal cual está en la tabla.

/** Índice 0-based de la posición 4 del SIDC numérico. */
const POS_AFILIACION = 3;

/** Afiliación (posición 4 del SIDC numérico) → etiqueta del estándar. */
export const AFILIACIONES = {
  0: 'Pending',
  1: 'Unknown',
  2: 'Assumed Friend',
  3: 'Friend',
  4: 'Neutral',
  5: 'Suspect / Joker',
  6: 'Hostile / Faker',
};

/**
 * Bando → dígito de afiliación. El bando es texto libre en la base ("azul",
 * "rojo"), así que se normaliza y se aceptan los alias más comunes.
 *
 * Un bando que no esté acá NO modifica el SIDC: se deja el del catálogo.
 */
export const AFILIACION_POR_BANDO = {
  azul: '3', blue: '3', amigo: '3', aliado: '3', propio: '3', friend: '3',
  rojo: '6', red: '6', enemigo: '6', hostil: '6', hostile: '6',
  verde: '4', green: '4', neutral: '4', neutro: '4',
  desconocido: '1', unknown: '1',
  sospechoso: '5', suspect: '5',
};

/**
 * Los dos únicos bandos que se ofrecen para dar de alta. `AFILIACION_POR_BANDO`
 * sigue aceptando más alias a propósito: en la base puede haber datos viejos
 * ("verde", "neutral") que hay que poder seguir dibujando, pero nada nuevo se
 * crea con esos valores.
 */
export const BANDOS = ['azul', 'rojo'];

const ETIQUETA_BANDO = { azul: '🔵 Azul', rojo: '🔴 Rojo' };

/**
 * `<option>`s de bando para un `<select>`.
 *
 * Si el registro trae un bando que ya no se ofrece, se agrega igual como opción
 * seleccionada: editar un vehículo viejo no tiene por qué reasignarle el bando
 * en silencio.
 */
export function opcionesBando(seleccionado, { vacio = null } = {}) {
  const actual = normalizarBando(seleccionado);
  const opciones = BANDOS.map((b) =>
    `<option value="${b}"${actual === b ? ' selected' : ''}>${ETIQUETA_BANDO[b]}</option>`);
  if (actual && !BANDOS.includes(actual)) {
    const viejo = actual.replace(/[<>&"]/g, '');
    opciones.push(`<option value="${viejo}" selected>${viejo} (bando anterior)</option>`);
  }
  if (vacio !== null) {
    opciones.unshift(`<option value=""${actual ? '' : ' selected'}>${vacio}</option>`);
  }
  return opciones.join('');
}

function normalizarBando(bando) {
  return String(bando ?? '').trim().toLowerCase();
}

/** ¿El SIDC del catálogo es el numérico de 2525D? */
export function esNumerico(sidc) {
  const base = String(sidc ?? '').trim();
  return base.length > POS_AFILIACION && /^\d+$/.test(base);
}

/** Dígito de afiliación que le corresponde a un bando, o null si no está mapeado. */
export function afiliacionDeBando(bando) {
  return AFILIACION_POR_BANDO[normalizarBando(bando)] ?? null;
}

/** "3" -> "Friend". */
export function etiquetaAfiliacion(digito) {
  return AFILIACIONES[String(digito)] || 'Desconocida';
}

/** ¿El bando tiene una afiliación definida? */
export function bandoReconocido(bando) {
  return afiliacionDeBando(bando) !== null;
}

/** Afiliación actual de un SIDC numérico (null si es alfanumérico). */
export function afiliacionDe(sidc) {
  return esNumerico(sidc) ? String(sidc).trim()[POS_AFILIACION] : null;
}

/**
 * Devuelve el SIDC que corresponde a un bando.
 *
 * Solo se reescribe el **dígito 4** de un SIDC numérico y solo si el bando está
 * mapeado. En cualquier otro caso —SIDC alfanumérico, SIDC vacío, bando sin
 * mapear— se devuelve exactamente el valor del catálogo.
 */
export function conBando(sidcBase, bando) {
  const base = String(sidcBase ?? '').trim();
  if (!esNumerico(base)) return base;

  const afiliacion = afiliacionDeBando(bando);
  if (afiliacion === null) return base;

  return base.slice(0, POS_AFILIACION) + afiliacion + base.slice(POS_AFILIACION + 1);
}

/** Texto para mostrar debajo del campo: qué se aplicó y por qué. */
export function explicacion(sidcBase, bando) {
  const base = String(sidcBase ?? '').trim();
  if (!base) return 'Elegí una plantilla para obtener el SIDC del catálogo.';

  if (!esNumerico(base)) {
    return 'SIDC alfanumérico (MIL-STD-2525B/C): se usa tal cual está en el catálogo, el bando no lo modifica.';
  }

  const afiliacion = afiliacionDeBando(bando);
  if (afiliacion === null) {
    const texto = normalizarBando(bando)
      ? `Bando «${bando}» no mapeado`
      : 'Sin bando';
    return `${texto}: se mantiene el SIDC del catálogo (afiliación ${afiliacionDe(base)}).`;
  }

  return `Bando «${bando}» → dígito 4 = ${afiliacion} (${etiquetaAfiliacion(afiliacion)}).`;
}

export default {
  AFILIACIONES, AFILIACION_POR_BANDO, BANDOS,
  esNumerico, afiliacionDeBando, etiquetaAfiliacion, bandoReconocido,
  afiliacionDe, conBando, explicacion, opcionesBando,
};
