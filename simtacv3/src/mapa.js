// Fase 3 — Render del mapa: símbolos SIDC, trayectos, rangos de visión y
// niebla de guerra. Todo lo necesario para dibujar viene en el JSON del
// ejercicio: este módulo no consulta nada al backend.

import Store, { clave } from './store.js';
import Session from './session.js';
import Sidc from './sidc.js';
import { entidadAMapa, xyAMapa } from './geo.js';

const ratio = () => window.devicePixelRatio || 1;

// GeoServer WMS local — corre en la misma máquina, no depende de internet
// (a diferencia de la capa OSM de abajo, que sí). Se agrega como overlay
// simultáneo sobre OSM, no como reemplazo.
// ⚠️ `LAYERS` es un placeholder: hay que cambiarlo por el nombre real
// publicado en ese GeoServer (formato típico `workspace:nombre_capa`,
// se ve en su GetCapabilities: http://localhost:3001/geoserver/wms?service=WMS&request=GetCapabilities).
const WMS_URL = 'http://localhost:3001/geoserver/wms';
const WMS_LAYERS = 'CAMBIAR:nombre_de_capa';

let mapa = null;
let capaEntidades = null;
let capaTrayectos = null;
let capaRangos = null;
let capaDibujo = null;
let capaReplay = null;
let capaBase = null;
let capaAnillos = null;
let mostrarRangos = false;

/** Animaciones en curso: clave -> { desde, hasta, t0, duracion }. */
const animaciones = new Map();
let rafActivo = false;

/** Interacción de reposicionamiento (solo administrador) y claves en arrastre. */
let interaccionArrastre = null;
const arrastrando = new Set();
/** Mismo filtro que usa `interaccionArrastre`: lo necesita el cursor del pointermove
 * para no mostrar "se puede arrastrar" en una entidad que la interacción va a rechazar. */
let puedeArrastrarActual = () => false;

/** Cache de estilos milsymbol; los campos de catálogo no cambian en el ejercicio. */
const cacheEstilos = new Map();

// OpenLayers dibuja en canvas y no puede consumir var(--sim-*) directamente:
// se leen los valores ya resueltos desde colors.css (única fuente de verdad
// de la paleta) una sola vez, al cargar el módulo.
const cssVar = (nombre) => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
const COLORES = {
  verde: cssVar('--sim-verde'),
  verdeRgb: cssVar('--sim-verde-rgb'),
  rojo: cssVar('--sim-rojo'),
  rojoRgb: cssVar('--sim-rojo-rgb'),
  texto: cssVar('--sim-texto'),
  negroRgb: cssVar('--sim-negro-rgb'),
  cianRgb: cssVar('--sim-cian-rgb'),
  ambar: cssVar('--sim-ambar'),
  ambarRgb: cssVar('--sim-ambar-rgb'),
  anilloVisionRgb: cssVar('--sim-anillo-vision-rgb'),
  anilloUmbralRgb: cssVar('--sim-anillo-umbral-rgb'),
};

// ---------------------------------------------------------------------------
// Símbolos
// ---------------------------------------------------------------------------

/**
 * La posición 4 del SIDC codifica la condición operacional: D = dañado,
 * X = destruido. milsymbol dibuja la decoración correspondiente.
 */
function sidcConEstado(sidc, estado) {
  if (!sidc || sidc.length < 4) return sidc || 'SUGP-----------';
  const codigo = estado === 'destruido' ? 'X' : estado === 'dañado' ? 'D' : null;
  if (!codigo) return sidc;
  return sidc.slice(0, 3) + codigo + sidc.slice(4);
}

/** Estado visual de la entidad, derivado de lo que manda el backend. */
export function estadoVisual(item) {
  const { tipo, entidad } = item;
  if (tipo === 'vehiculo') {
    if (entidad.estado_actual === 'destruido') return 'destruido';
    if (entidad.estado_actual === 'dañado' || entidad.estado_actual === 'danado') return 'dañado';
    const umbral = Number(entidad.umbral_danio) || 0;
    const danio = Number(entidad.danio_acumulado) || 0;
    if (umbral > 0 && danio >= umbral) return 'destruido';
    if (umbral > 0 && danio >= umbral * 0.5) return 'dañado';
    return 'activo';
  }
  if (Number(entidad.efectivo) <= 0) return 'destruido';
  return 'activo';
}

function estiloDe(item, seleccionado) {
  const { entidad } = item;
  const estado = estadoVisual(item);
  const detectada = Store.observadores.has(item.clave);
  const enCombate = !!entidad.en_combate;
  const oculta = entidad.visible === false;
  // `entidad.sidc` no siempre trae la afiliación ya resuelta contra el bando
  // (los vehículos reconciliados desde `GET /vehiculos` no la traen — ver
  // `Store.sincronizarVehiculos`): se resuelve acá, siempre, en vez de confiar
  // en que ya venga bien. Es un no-op si el SIDC ya tenía el dígito correcto.
  const sidc = Sidc.conBando(entidad.sidc, entidad.bando);
  const k = `${sidc}|${estado}|${seleccionado ? 1 : 0}|${enCombate ? 1 : 0}|${oculta ? 1 : 0}|${detectada ? 1 : 0}|${ratio()}`;

  if (cacheEstilos.has(k)) return cacheEstilos.get(k);

  const simbolo = new ms.Symbol(sidcConEstado(sidc, estado), {
    size: 34 * ratio(),
    infoFields: false,
  });

  if (seleccionado) {
    simbolo.style.outlineWidth = 6;
    simbolo.style.outlineColor = COLORES.verde;
  }
  if (enCombate) {
    simbolo.style.outlineWidth = 6;
    simbolo.style.outlineColor = COLORES.rojo;
  }
  simbolo.setOptions({ size: 34 * ratio() });

  const canvas = simbolo.asCanvas();
  const estilo = new ol.style.Style({
    image: new ol.style.Icon({
      img: canvas,
      scale: 1 / ratio(),
      anchor: [simbolo.getAnchor().x, simbolo.getAnchor().y],
      anchorXUnits: 'pixels',
      anchorYUnits: 'pixels',
      imgSize: canvas ? [canvas.width, canvas.height] : undefined,
      // Una entidad oculta por el admin, o destruida, se dibuja atenuada.
      opacity: estado === 'destruido' ? 0.4 : oculta ? 0.5 : 1,
    }),
    text: new ol.style.Text({
      text: etiqueta(item),
      font: `600 11px 'Segoe UI', sans-serif`,
      offsetY: 26,
      fill: new ol.style.Fill({ color: COLORES.texto }),
      stroke: new ol.style.Stroke({ color: `rgba(${COLORES.negroRgb},0.85)`, width: 3 }),
    }),
  });

  cacheEstilos.set(k, estilo);
  return estilo;
}

function etiqueta(item) {
  const { entidad, tipo } = item;
  const partes = [entidad.nombre || `${tipo} ${item.id}`];
  if (tipo === 'unidad' && entidad.efectivo !== undefined) {
    // Se muestra `efectivo` (entero), nunca `efectivo_exacto`.
    partes.push(`(${Number(entidad.efectivo)})`);
  }
  return partes.join(' ');
}

// ---------------------------------------------------------------------------
// Inicialización
// ---------------------------------------------------------------------------

export function init(targetId = 'map-container') {
  capaEntidades = new ol.layer.Vector({
    source: new ol.source.Vector(),
    title: 'Entidades',
    zIndex: 30,
  });
  capaTrayectos = new ol.layer.Vector({
    source: new ol.source.Vector(),
    title: 'Trayectos',
    zIndex: 20,
    style: (feature) => new ol.style.Style({
      stroke: new ol.style.Stroke({
        color: feature.get('propia') === false ? `rgba(${COLORES.rojoRgb},0.8)` : `rgba(${COLORES.verdeRgb},0.85)`,
        width: 2,
        lineDash: [6, 6],
      }),
    }),
  });
  capaRangos = new ol.layer.Vector({
    source: new ol.source.Vector(),
    title: 'Rangos de visión',
    zIndex: 10,
    visible: false,
    style: new ol.style.Style({
      stroke: new ol.style.Stroke({ color: `rgba(${COLORES.cianRgb},0.55)`, width: 1, lineDash: [3, 5] }),
      fill: new ol.style.Fill({ color: `rgba(${COLORES.cianRgb},0.05)` }),
    }),
  });
  capaDibujo = new ol.layer.Vector({
    source: new ol.source.Vector(),
    title: 'Dibujo',
    zIndex: 40,
    style: [
      new ol.style.Style({
        stroke: new ol.style.Stroke({ color: COLORES.ambar, width: 2 }),
        image: new ol.style.Circle({
          radius: 4,
          fill: new ol.style.Fill({ color: COLORES.ambar }),
        }),
      }),
    ],
  });

  // Capa propia del modo rebobinado: los frames son un preview, no el estado real.
  capaReplay = new ol.layer.Vector({
    source: new ol.source.Vector(),
    title: 'Rebobinado',
    zIndex: 35,
    visible: false,
  });

  // Marcador de la posición base del vehículo aire seleccionado (ver `mostrarBase`).
  capaBase = new ol.layer.Vector({
    source: new ol.source.Vector(),
    title: 'Base',
    zIndex: 25,
  });

  // Anillos de rango de visión y umbral de combate de la entidad seleccionada
  // (ver `mostrarAnillos`). Independiente del toggle "rangos de visión"
  // (`capaRangos`), que dibuja solo el rango de las entidades propias.
  capaAnillos = new ol.layer.Vector({
    source: new ol.source.Vector(),
    title: 'Anillos de selección',
    zIndex: 22,
  });

  const capaWms = new ol.layer.Tile({
    source: new ol.source.TileWMS({
      url: WMS_URL,
      params: { LAYERS: WMS_LAYERS, TILED: true },
      // Ajusta el pedido de tiles al gridset propio de GeoServer — evita
      // artefactos de borde entre tiles que salen con el default genérico.
      serverType: 'geoserver',
    }),
    title: 'GeoServer WMS',
    zIndex: 5,
  });

  mapa = new ol.Map({
    target: targetId,
    layers: [
      new ol.layer.Tile({ source: new ol.source.OSM() }),
      capaWms,
      capaRangos,
      capaTrayectos,
      capaAnillos,
      capaBase,
      capaEntidades,
      capaReplay,
      capaDibujo,
    ],
    view: new ol.View({
      center: ol.proj.fromLonLat([-99.1332, 19.4326]),
      zoom: 12,
    }),
  });

  window.map = mapa;
  window.simtacDiagnostico = diagnostico;
  // Solo para depurar desde DevTools (mismo criterio que `window.map`): `Store`
  // es un módulo ES6, no llega solo a la consola.
  window.Store = Store;

  // Selección de entidad.
  mapa.on('singleclick', (evento) => {
    if (window.simtacModoMapa) return; // una herramienta está capturando clics
    const feature = mapa.forEachFeatureAtPixel(evento.pixel, (f) => (f.get('clave') ? f : null), {
      layerFilter: (capa) => capa === capaEntidades,
      hitTolerance: 6,
    });
    Store.seleccionar(feature ? feature.get('clave') : null);
  });

  mapa.on('pointermove', (evento) => {
    if (evento.dragging) return;
    const feature = mapa.forEachFeatureAtPixel(evento.pixel, (f) => (f.get('clave') ? f : null), {
      layerFilter: (capa) => capa === capaEntidades,
      hitTolerance: 6,
    });
    // El cursor "move" tiene que reflejar lo que la interacción de arrastre
    // REALMENTE va a aceptar (mismo `puedeArrastrar` de `habilitarArrastre`):
    // si no, el cursor invita a arrastrar algo que la interacción rechaza y el
    // gesto cae al `DragPan` por defecto — se mueve el mapa, no la entidad.
    const itemDelFeature = feature && Store.obtenerPorClave(feature.getId());
    const arrastrable = !!itemDelFeature && !!interaccionArrastre && puedeArrastrarActual(itemDelFeature);
    if (window.simtacModoMapa) mapa.getViewport().style.cursor = 'crosshair';
    else if (arrastrable) mapa.getViewport().style.cursor = 'move';
    else if (feature) mapa.getViewport().style.cursor = 'pointer';
    else mapa.getViewport().style.cursor = '';
  });

  // Reacciones al store.
  Store.on('estado', () => {
    renderizarTodo();
    // `reemplazarEstado` puede vaciar la selección en silencio (sin emitir
    // `seleccion`) si la entidad seleccionada no sobrevivió al reemplazo: sin
    // esto, la base/los anillos quedarían dibujados para algo que ya no
    // existe.
    const item = Store.seleccionada();
    mostrarBase(item);
    mostrarAnillos(item);
  });
  Store.on('deteccion', () => {
    renderizarTodo();
    // Si la entidad seleccionada era un enemigo detectado y se pierde su
    // detección acá mismo, sus anillos/base quedarían dibujados hasta el
    // próximo `estado`/`entidad:cambio` si no se refrescan ahora: mismo caso
    // que ya cubre el listener de `estado`, más abajo.
    const item = Store.seleccionada();
    mostrarBase(item);
    mostrarAnillos(item);
  });
  Store.on('entidad:cambio', (item) => {
    actualizarEntidad(item);
    if (item && Store.seleccion === item.clave) {
      mostrarBase(item);
      mostrarAnillos(item);
    }
  });
  // Movimiento: llega 1 vez por segundo, fuera de `entidad:cambio` — sin esto
  // los anillos quedarían clavados en la posición donde se seleccionó la
  // entidad en vez de seguirla mientras se mueve.
  Store.on('entidad:posicion', (item) => {
    if (item && Store.seleccion === item.clave) mostrarAnillos(item);
  });
  Store.on('seleccion', () => {
    refrescarEstilos();
    const item = Store.seleccionada();
    mostrarBase(item);
    mostrarAnillos(item);
  });

  return mapa;
}

export function instancia() {
  return mapa;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * Diagnóstico manual desde DevTools (`window.simtacDiagnostico()`): por cada
 * entidad del Store, por qué se dibuja o no se dibuja en el mapa. Junta en
 * una sola tabla los dos motivos que NO dejan rastro en consola por su
 * cuenta: niebla de guerra (`visibleParaMi`) y falta de posición
 * (`entidadAMapa` devolviendo `null`).
 */
export function diagnostico() {
  const filas = Store.todas().map((item) => ({
    clave: item.clave,
    id: item.id,
    nombre: item.entidad.nombre ?? null,
    bando: item.entidad.bando ?? null,
    visibleParaMi: Store.visibleParaMi(item),
    posicion_x: item.entidad.posicion_x ?? null,
    posicion_y: item.entidad.posicion_y ?? null,
    posicion_base_x: item.entidad.posicion_base_x ?? null,
    posicion_base_y: item.entidad.posicion_base_y ?? null,
    tieneCoordenada: !!entidadAMapa(item.entidad),
    pendienteEnMotor: !!item.entidad._pendienteEnMotor,
  }));
  console.table(filas);
  return filas;
}

/** Reconstruye la capa de entidades aplicando niebla de guerra. */
export function renderizarTodo() {
  if (!capaEntidades) return;
  const fuente = capaEntidades.getSource();
  const vistos = new Set();

  for (const item of Store.todas()) {
    if (!Store.visibleParaMi(item)) continue;
    const coord = entidadAMapa(item.entidad);
    if (!coord) continue; // sin posición actual ni base: no hay dónde dibujarla
    vistos.add(item.clave);
    let feature = fuente.getFeatureById(item.clave);
    if (!feature) {
      feature = new ol.Feature({ geometry: new ol.geom.Point(coord) });
      feature.setId(item.clave);
      feature.set('clave', item.clave);
      feature.set('tipo', item.tipo);
      feature.set('entidadId', item.id);
      fuente.addFeature(feature);
    } else if (!animaciones.has(item.clave) && !arrastrando.has(item.clave)) {
      feature.getGeometry().setCoordinates(coord);
    }
    feature.setStyle(estiloDe(item, Store.seleccion === item.clave));
  }

  // Fuera de vista: se quitan del mapa (niebla de guerra).
  for (const feature of [...fuente.getFeatures()]) {
    if (!vistos.has(feature.getId())) {
      fuente.removeFeature(feature);
      animaciones.delete(feature.getId());
    }
  }

  limpiarTrayectosOcultos();
  dibujarRangos();
}

/**
 * Una entidad puede perder la detección (`entidad:perdida_de_vista`) mientras
 * sigue en movimiento: el ícono se oculta acá arriba, pero la línea de
 * trayecto (capa aparte, `capaTrayectos`) no se limpia sola con eso — solo la
 * borra `entidad:movimiento_completado` (`movimiento.js`), y ese evento puede
 * tardar. Sin este barrido, la ruta de un enemigo que salió de rango se queda
 * dibujada en el mapa aunque ya no se lo pueda ver.
 */
function limpiarTrayectosOcultos() {
  if (!capaTrayectos) return;
  for (const feature of [...capaTrayectos.getSource().getFeatures()]) {
    const id = String(feature.getId() || '');
    if (!id.startsWith('ruta:')) continue;
    const item = Store.obtenerPorClave(id.slice('ruta:'.length));
    if (item && !Store.visibleParaMi(item)) capaTrayectos.getSource().removeFeature(feature);
  }
}

/** Refresca el estilo de una entidad puntual sin rearmar la capa. */
export function actualizarEntidad(item) {
  if (!capaEntidades || !item) return;
  const fuente = capaEntidades.getSource();
  const feature = fuente.getFeatureById(item.clave);
  if (!feature) {
    renderizarTodo();
    return;
  }
  if (!Store.visibleParaMi(item)) {
    fuente.removeFeature(feature);
    return;
  }
  // Mientras el usuario la arrastra manda el puntero, no el store.
  if (!animaciones.has(item.clave) && !arrastrando.has(item.clave)) {
    const coord = entidadAMapa(item.entidad);
    if (coord) feature.getGeometry().setCoordinates(coord);
  }
  feature.setStyle(estiloDe(item, Store.seleccion === item.clave));
  if (mostrarRangos) dibujarRangos();
}

function refrescarEstilos() {
  if (!capaEntidades) return;
  for (const feature of capaEntidades.getSource().getFeatures()) {
    const item = Store.obtenerPorClave(feature.getId());
    if (item) feature.setStyle(estiloDe(item, Store.seleccion === item.clave));
  }
}

// ---------------------------------------------------------------------------
// Interpolación visual entre ticks
//
// Los updates de posición llegan 1 vez por segundo. Animar entre la posición
// anterior y la nueva es puramente cosmético: la autoritativa es siempre la del
// último evento.
// ---------------------------------------------------------------------------

export function animarHacia(item, duracion = 1000) {
  if (!capaEntidades) return;
  if (arrastrando.has(item.clave)) return; // la está moviendo el usuario
  const feature = capaEntidades.getSource().getFeatureById(item.clave);
  if (!feature) {
    renderizarTodo();
    return;
  }
  const hasta = entidadAMapa(item.entidad);
  if (!hasta) return; // sin posición válida: nada que animar
  animaciones.set(item.clave, {
    desde: feature.getGeometry().getCoordinates(),
    hasta,
    t0: performance.now(),
    duracion,
  });
  if (!rafActivo) {
    rafActivo = true;
    requestAnimationFrame(paso);
  }
}

function paso(ahora) {
  const fuente = capaEntidades?.getSource();
  if (!fuente) {
    rafActivo = false;
    return;
  }
  for (const [k, anim] of [...animaciones]) {
    const feature = fuente.getFeatureById(k);
    if (!feature) {
      animaciones.delete(k);
      continue;
    }
    const t = Math.min(1, (ahora - anim.t0) / anim.duracion);
    feature.getGeometry().setCoordinates([
      anim.desde[0] + (anim.hasta[0] - anim.desde[0]) * t,
      anim.desde[1] + (anim.hasta[1] - anim.desde[1]) * t,
    ]);
    if (t >= 1) animaciones.delete(k);
  }
  if (animaciones.size > 0) {
    requestAnimationFrame(paso);
  } else {
    rafActivo = false;
  }
}

// ---------------------------------------------------------------------------
// Trayectos
// ---------------------------------------------------------------------------

/** Dibuja los waypoints RESUELTOS POR EL SERVIDOR de un movimiento. */
export function dibujarTrayecto(tipo, id, waypoints, propia = true) {
  if (!capaTrayectos || !Array.isArray(waypoints) || waypoints.length < 2) return;
  const k = clave(tipo, id);
  limpiarTrayecto(tipo, id);
  const feature = new ol.Feature({
    geometry: new ol.geom.LineString(waypoints.map(xyAMapa)),
  });
  feature.setId(`ruta:${k}`);
  feature.set('propia', propia);
  capaTrayectos.getSource().addFeature(feature);
}

export function limpiarTrayecto(tipo, id) {
  if (!capaTrayectos) return;
  const feature = capaTrayectos.getSource().getFeatureById(`ruta:${clave(tipo, id)}`);
  if (feature) capaTrayectos.getSource().removeFeature(feature);
}

export function limpiarTrayectos() {
  capaTrayectos?.getSource().clear();
}

// ---------------------------------------------------------------------------
// Posición base (vehículos de tipo aire)
//
// Toda ruta aérea empieza y termina en la base (`movimiento.js`): mostrar
// dónde está ayuda a entender por qué el trayecto se ve "ir y volver". Se
// dibuja solo para la entidad seleccionada, y se actualiza al cambiar la
// selección o al fijar una base nueva (`Movimiento.iniciarModoBase`).
// ---------------------------------------------------------------------------

export function mostrarBase(item) {
  if (!capaBase) return;
  const fuente = capaBase.getSource();
  fuente.clear();
  // Se puede llegar a seleccionar una entidad oculta por niebla de guerra
  // (p. ej. un vehículo hijo listado en el panel de una unidad enemiga que sí
  // está detectada, pero él en particular no): sin este chequeo, la base se
  // dibuja igual y delata su posición aunque el ícono se mantenga oculto.
  if (!Store.visibleParaMi(item)) return;
  if (!Store.esVehiculoAire(item)) return;
  const { posicion_base_x: x, posicion_base_y: y } = item.entidad;
  if (x === null || x === undefined || y === null || y === undefined) return;
  const coord = xyAMapa({ x, y });
  const feature = new ol.Feature({ geometry: new ol.geom.Point(coord) });
  feature.setStyle(new ol.style.Style({
    image: new ol.style.Circle({
      radius: 9,
      fill: new ol.style.Fill({ color: `rgba(${COLORES.ambarRgb},0.25)` }),
      stroke: new ol.style.Stroke({ color: COLORES.ambar, width: 2 }),
    }),
    text: new ol.style.Text({
      text: '⌂ BASE',
      offsetY: -16,
      font: `600 11px 'Segoe UI', sans-serif`,
      fill: new ol.style.Fill({ color: COLORES.ambar }),
      stroke: new ol.style.Stroke({ color: `rgba(${COLORES.negroRgb},0.85)`, width: 3 }),
    }),
  }));
  fuente.addFeature(feature);
}

export function ocultarBase() {
  capaBase?.getSource().clear();
}

// ---------------------------------------------------------------------------
// Rangos de visión
// ---------------------------------------------------------------------------

export function alternarRangos(valor) {
  mostrarRangos = valor === undefined ? !mostrarRangos : !!valor;
  capaRangos?.setVisible(mostrarRangos);
  if (mostrarRangos) dibujarRangos();
  return mostrarRangos;
}

export function rangosVisibles() {
  return mostrarRangos;
}

/**
 * Un radio en metros no se puede usar tal cual como radio de un
 * `ol.geom.Circle` en EPSG:3857 (Mercator): hay que corregirlo por la
 * latitud de la entidad. Mismo fallback a `posicion_base_y` que usa
 * `entidadAMapa` cuando la posición actual todavía no llegó.
 */
function radioCorregido(entidad, metros) {
  const lat = Number(entidad.posicion_y ?? entidad.posicion_base_y);
  const correccion = 1 / Math.cos((lat * Math.PI) / 180);
  return metros * correccion;
}

function dibujarRangos() {
  if (!capaRangos || !mostrarRangos) return;
  const fuente = capaRangos.getSource();
  fuente.clear();
  for (const item of Store.todas()) {
    // Solo sobre las propias: del enemigo no conocemos su alcance real.
    if (!Store.esAliada(item.entidad)) continue;
    if (estadoVisual(item) === 'destruido') continue;
    const radio = Number(item.entidad.rango_vision_m);
    if (!radio) continue;
    const centro = entidadAMapa(item.entidad);
    if (!centro) continue; // sin posición válida: no hay dónde centrar el rango
    fuente.addFeature(new ol.Feature({
      geometry: new ol.geom.Circle(centro, radioCorregido(item.entidad, radio)),
    }));
  }
}

// ---------------------------------------------------------------------------
// Anillos de selección: rango de visión (azul) y umbral de combate (naranja)
//
// A diferencia de `capaRangos` (toggle manual, solo entidades propias), estos
// se dibujan siempre para lo que esté seleccionado — propio o enemigo, si es
// visible — y se actualizan solos al cambiar la selección o al moverse.
// ---------------------------------------------------------------------------

const COLOR_VISION = `rgba(${COLORES.anilloVisionRgb},ALPHA)`;
const COLOR_UMBRAL = `rgba(${COLORES.anilloUmbralRgb},ALPHA)`;

function estiloAnillo(color) {
  return new ol.style.Style({
    stroke: new ol.style.Stroke({ color: color.replace('ALPHA', '0.8'), width: 1.5 }),
    fill: new ol.style.Fill({ color: color.replace('ALPHA', '0.1') }),
  });
}

export function mostrarAnillos(item) {
  if (!capaAnillos) return;
  const fuente = capaAnillos.getSource();
  fuente.clear();
  if (!item) return;
  // Mismo caso que `mostrarBase`: una entidad seleccionada puede no ser
  // visible por niebla de guerra (vehículo hijo no detectado individualmente
  // dentro de una unidad enemiga que sí lo está). Sin este chequeo, los
  // anillos de rango de visión/combate se dibujan en su posición real.
  if (!Store.visibleParaMi(item)) return;
  const centro = entidadAMapa(item.entidad);
  if (!centro) return; // sin posición válida: no hay dónde centrar los anillos

  const vision = Number(item.entidad.rango_vision_m);
  if (vision > 0) {
    const anillo = new ol.Feature({ geometry: new ol.geom.Circle(centro, radioCorregido(item.entidad, vision)) });
    anillo.setStyle(estiloAnillo(COLOR_VISION));
    fuente.addFeature(anillo);
  }

  const umbral = Store.umbralCombate(item);
  if (umbral > 0) {
    const anillo = new ol.Feature({ geometry: new ol.geom.Circle(centro, radioCorregido(item.entidad, umbral)) });
    anillo.setStyle(estiloAnillo(COLOR_UMBRAL));
    fuente.addFeature(anillo);
  }
}

export function ocultarAnillos() {
  capaAnillos?.getSource().clear();
}

// ---------------------------------------------------------------------------
// Reposicionamiento por arrastre (solo administrador)
//
// Este módulo solo mueve el ícono y avisa dónde se soltó: quién puede arrastrar
// y cómo se persiste lo decide el que llama (direccion.js).
// ---------------------------------------------------------------------------

export function arrastreActivo() {
  return !!interaccionArrastre;
}

/**
 * Activa o desactiva el arrastre de entidades.
 *
 * @param {boolean} activo
 * @param {object} opciones
 * @param {(item) => boolean} opciones.puedeArrastrar  filtro por entidad
 * @param {(item, punto) => void} opciones.alSoltar    recibe { x: lon, y: lat }
 * @returns {boolean} si quedó activo
 */
export function habilitarArrastre(activo, opciones = {}) {
  if (!mapa) return false;

  if (interaccionArrastre) {
    mapa.removeInteraction(interaccionArrastre);
    interaccionArrastre = null;
    arrastrando.clear();
  }
  if (!activo) {
    puedeArrastrarActual = () => false;
    mapa.getViewport().style.cursor = '';
    return false;
  }

  const { puedeArrastrar = () => true, alSoltar = () => {} } = opciones;
  puedeArrastrarActual = puedeArrastrar;

  interaccionArrastre = new ol.interaction.Translate({
    layers: [capaEntidades],
    hitTolerance: 8,
    filter: (feature) => {
      // Mientras otra herramienta captura el mapa (mover, elegir objetivo,
      // tomar punto) el arrastre no debe interferir.
      if (window.simtacModoMapa) return false;
      const item = Store.obtenerPorClave(feature.getId());
      return !!item && puedeArrastrar(item);
    },
  });

  interaccionArrastre.on('translatestart', (evento) => {
    evento.features.forEach((feature) => {
      const k = feature.getId();
      if (!k) return;
      arrastrando.add(k);
      // Un tick de posición en pleno arrastre pelearía con el puntero.
      animaciones.delete(k);
    });
  });

  interaccionArrastre.on('translateend', (evento) => {
    evento.features.forEach((feature) => {
      const k = feature.getId();
      if (!k) return;
      arrastrando.delete(k);
      const item = Store.obtenerPorClave(k);
      if (!item) return;
      // x es longitud, y es latitud.
      const [x, y] = ol.proj.toLonLat(feature.getGeometry().getCoordinates());
      alSoltar(item, { x, y });
    });
  });

  mapa.addInteraction(interaccionArrastre);
  return true;
}

// ---------------------------------------------------------------------------
// Capa de dibujo (herramientas de movimiento)
// ---------------------------------------------------------------------------

export function capaDeDibujo() {
  return capaDibujo;
}

export function limpiarDibujo() {
  capaDibujo?.getSource().clear();
}

// ---------------------------------------------------------------------------
// Modo rebobinado (solo administrador)
//
// Los frames del replay NO reemplazan el estado real: se dibujan en su propia
// capa y la capa viva se oculta mientras dura la reproducción.
// ---------------------------------------------------------------------------

export function modoReplay(activo) {
  if (!capaReplay) return;
  capaReplay.setVisible(activo);
  capaEntidades?.setVisible(!activo);
  capaTrayectos?.setVisible(!activo);
  if (!activo) capaReplay.getSource().clear();
}

/** Dibuja un frame del rebobinado a partir del JSON crudo de ese checkpoint. */
export function renderFrame(estado) {
  if (!capaReplay) return;
  const fuente = capaReplay.getSource();
  fuente.clear();
  if (!estado) return;

  const entidades = [];
  for (const unidad of estado.unidades || []) {
    entidades.push({ tipo: 'unidad', id: unidad.id, entidad: unidad, clave: clave('unidad', unidad.id) });
    for (const vehiculo of unidad.vehiculos || []) {
      entidades.push({ tipo: 'vehiculo', id: vehiculo.id, entidad: vehiculo, clave: clave('vehiculo', vehiculo.id) });
    }
  }
  for (const vehiculo of estado.vehiculos || []) {
    entidades.push({ tipo: 'vehiculo', id: vehiculo.id, entidad: vehiculo, clave: clave('vehiculo', vehiculo.id) });
  }

  for (const item of entidades) {
    const coord = entidadAMapa(item.entidad);
    if (!coord) continue;
    const feature = new ol.Feature({ geometry: new ol.geom.Point(coord) });
    feature.setStyle(estiloDe(item, false));
    fuente.addFeature(feature);
  }
}

// ---------------------------------------------------------------------------
// Vista
// ---------------------------------------------------------------------------

export function centrarEn(entidad, zoom) {
  if (!mapa || !entidad) return;
  const coord = entidadAMapa(entidad);
  if (!coord) return;
  const vista = mapa.getView();
  vista.animate({ center: coord, duration: 400, zoom: zoom ?? vista.getZoom() });
}

/** Encaja la vista sobre todas las entidades visibles. */
export function encuadrarTodo() {
  if (!mapa || !capaEntidades) return;
  const fuente = capaEntidades.getSource();
  if (fuente.getFeatures().length === 0) return;
  mapa.getView().fit(fuente.getExtent(), {
    padding: [80, 80, 80, 380],
    maxZoom: 14,
    duration: 500,
  });
}

export default {
  init, instancia, renderizarTodo, actualizarEntidad, animarHacia,
  dibujarTrayecto, limpiarTrayecto, limpiarTrayectos,
  mostrarBase, ocultarBase, mostrarAnillos, ocultarAnillos,
  alternarRangos, rangosVisibles, capaDeDibujo, limpiarDibujo,
  habilitarArrastre, arrastreActivo,
  modoReplay, renderFrame, centrarEn, encuadrarTodo, estadoVisual, diagnostico,
};
