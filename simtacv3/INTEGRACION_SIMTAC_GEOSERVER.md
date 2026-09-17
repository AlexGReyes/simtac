# Integración con SIMTAC GeoServer desde otro proyecto cliente

## Cambio visual incompatible — cartografía 2026-08-25

Los cinco grupos públicos mantienen nombres, workspaces y endpoints, pero su representación global
cambió a la familia `simtac_cartografia_*`. Un consumidor que compare píxeles o interprete los
colores anteriores debe actualizarse. La jerarquía nueva es relieve/océano → coberturas terrestres
→ límites → vialidad/hidrografía → etiquetas. Paleta principal: océano `#075A9E`, plataforma
`#BFDDE7`, relieve verde–ocre, límites administrativos cian `#16D6D6`, límites RM lima
`#B7D51A`, región aérea
`#985083`/`#D2E21B`, urbano `#D8C39E`, vialidad principal `#E3A11A` y texto
`#252525` con halo `#FFFBE7`.

La vialidad se clasifica por el campo real `tipo`; no debe inferirse por nombre ni dibujar todo
`caminos_nal`, porque esa capa también contiene límites de manzana, áreas construidas y otros
elementos no viales. La convención pública es:

| Orden | Categorías principales | Trazo |
|---|---|---|
| 1.º | autopista, pavimentada, sus puentes y túnel carretero principal | ámbar `#E3A11A`, resguardo oscuro, mayor grosor |
| 2.º | TTTT/TTTS, puentes y túneles asociados | café `#8D765D`, grosor medio |
| 3.º | avenidas/calles; brechas/veredas | crema `#D8C39E`, fino; discontinuo para brecha/vereda |

Para una capa vial WMS solicitada fuera de los grupos base o regionales, usar el estilo explícito
`simtac_cartografia_vialidad_jerarquica`. Sus rótulos usan `nombre`, Arial y halo claro, con
resolución de conflictos y umbrales de escala. El visor de referencia incluye además una leyenda
local desde z7; esa acotación no es una capa OGC.
En el visor de referencia, las capas temáticas `caminos_*` seleccionadas usan z7 como mínimo:
se retiran en z0–6 sin perder la intención y reaparecen al regresar a z7.

La retícula, sus rótulos de borde, flecha norte y escala gráfica son responsabilidad del cliente;
no son capas WMS/WMTS. Deben colocarse sin interceptar clics destinados a GetFeatureInfo o rutas.

Guía técnica para consumir los servicios OGC públicos de la instalación local de SIMTAC GeoServer
desde una aplicación **distinta** de `simtac-viewer/` (otro frontend, otro backend, otra IA
construyendo un cliente). Todo lo documentado aquí está verificado contra el servidor real, no
inferido de la especificación OGC en abstracto — donde algo no se pudo verificar, se dice
explícitamente.

Para el inventario completo de capacidades y su evidencia de verificación, ver
`DEMO_VISOR_SIMTAC.md`. Para la skill que empaqueta estos mismos patrones para otra IA, ver
`.agents/skills/simtac-geoserver-client/`.

## Separación tajante: OGC público de lectura vs. REST administrativo

Todo lo de este documento es **de solo lectura y sin credenciales**: `wms`, `wfs`,
`gwc/service/wmts`, `ows` (WCS/WPS, sin caso de uso de cliente aquí). El endpoint
`/geoserver/rest/...` **requiere credenciales de administrador** (usuario `admin`,
`GEOSERVER_ADMIN_PASSWORD` del `.env` del servidor) y permite publicar, borrar capas, cambiar
estilos y sembrar/truncar caché. **Nunca lo expongas a un navegador ni lo llames desde código
cliente** — ni siquiera de lectura (`GET /rest/...` también exige autenticación). Si tu integración
necesita algo administrativo, es una tarea de operación del servidor (ver la skill `geoserver-ops`
de este mismo repositorio), no algo que resolver desde el cliente.

## URL del servidor: desde el host y desde un contenedor

> Para consumir la **réplica levantada en el Mac desde otros equipos de la LAN**
> (`10.40.0.0/23` o `172.200.1.0/24`), ver
> [`INTEGRACION_RED_LOCAL_MAC.md`](INTEGRACION_RED_LOCAL_MAC.md): ahí el puerto se
> publica en `0.0.0.0:3001` y hay endpoints concretos por IP. La descripción de
> abajo (loopback) es el valor **por defecto del repo**, no el de ese despliegue.

- **Desde el host** (tu máquina, un navegador, un proceso Node/Python fuera de Docker):
  `http://localhost:3001/geoserver` — por defecto el puerto se publica **solo en loopback**
  (`127.0.0.1:3001:8080` en `docker-compose.yml`), no accesible desde otras máquinas de la red
  salvo que el despliegue cambie `SIMTAC_GEOSERVER_BIND_ADDRESS` (p. ej. a `0.0.0.0`).
- **Desde otro contenedor Docker en la misma red** (`simtac_net`, tipo `bridge`): agrega tu servicio
  a esa red externa y usa el nombre del contenedor y el puerto **interno**:
  `http://simtac_geoserver:8080/geoserver`. No uses `localhost` desde dentro de un contenedor — no
  resuelve al host.
- El puerto host (`3001` por defecto) es configurable vía `SIMTAC_GEOSERVER_PORT` en `.env`; no lo
  asumas fijo si integras contra un despliegue ajeno — descúbrelo de la configuración de ese
  despliegue, no lo copies de aquí.

## CORS

Confirmado en vivo (`curl` con `Origin: http://example.com` contra `/geoserver/wms?...GetCapabilities`):
GeoServer responde `Access-Control-Allow-Origin: *`. Un cliente de navegador en un origen distinto
(otra app web, otro puerto) puede llamar estos endpoints directamente con `fetch()`/`XMLHttpRequest`
sin proxy intermedio. Esto aplica a los servicios OGC públicos; no se verificó (ni hace falta) para
`/rest/`, que de todos modos nunca debe llamarse desde un navegador.

## Workspaces y convenciones de nombres

| Workspace | Dominio | Prefijo de capa típico |
|---|---|---|
| `simtac_general` | Cartografía nacional (caminos, ciudades, clima, océanos, mosaico satelital, basemapas) | `*_nal` |
| `simtac_rm` | 12 Regiones Militares | `*_irm`…`*_xiirm` |
| `simtac_fam` | 4 Regiones Aéreas (FAM) | `*_rac`, `*_rane`, `*_rano`, `*_rase` |
| `simtac_marina` | Marina | `*_marina` |

Una capa se referencia siempre como `workspace:nombre_de_capa` (ej. `simtac_rm:inst_mil_irm`) en
cualquier parámetro `layers`/`typeName`/`LAYER` de WMS/WFS/WMTS.

## Descubrimiento dinámico: no copiar una lista fija de capas

El catálogo real vive en `catalogo_capas.json` (raíz del repo del servidor) y cambia con el tiempo
(nuevas capas, capas retiradas, el mosaico satelital montado o no). **No hardcodees una lista de
capas en tu cliente** — dos formas de descubrir en runtime, en orden de preferencia:

1. **Si tu cliente puede leer el filesystem del proyecto SIMTAC** (mismo repo o uno hermano):
   `catalogo_capas.json` trae la estructura `{ regiones_militares, regiones_aereas, marina, general }`,
   cada una con `workspace` y `zonas`/`capas` — mismo formato que consume `simtac-viewer/`. Es la
   fuente más rica: incluye `tipo_geometria`, `clasificacion` (`"automatica"` vs. manual/omitida) y
   advertencias de calidad de datos por capa.
2. **Si tu cliente solo tiene acceso de red al servidor** (caso más común para un proyecto externo):
   pide `GetCapabilities` de WMS o WFS y parsea los `<Name>`/`<FeatureType>` — es la misma fuente de
   verdad que usa GeoServer para servir, así que nunca queda desincronizada. Para un descubrimiento
   más liviano de un solo workspace, pide el `GetCapabilities` **scoped al workspace**
   (`/geoserver/{workspace}/wms?...`) en vez del global — mismo patrón que usa `simtac-viewer/` para
   detectar el mosaico satelital sin descargar las 389 capas del catálogo completo.

## WMS: GetMap, GetFeatureInfo, GetLegendGraphic

Base: `GET {geoserver}/wms?service=WMS&version=1.1.1&request=...`. Usa **1.1.1**, no 1.3.0: con
`EPSG:4326` la versión 1.3.0 invierte el orden de ejes del `bbox` a lat,lon (vs. lon,lat en 1.1.1),
un bug real que ya causó un GetMap en blanco durante la verificación de este proyecto (HTTP 200 con
PNG de 3,852 B y desviación estándar de 14.96 — un blanco válido, no un error) — usar 1.1.1 evita la
ambigüedad de raíz.

- **GetMap**: `&layers=ws:capa&styles=&bbox=lonMin,latMin,lonMax,latMax&width=&height=&srs=EPSG:4326&format=image/png&transparent=true`.
  Deja `styles=` vacío para heredar el `defaultStyle` de la capa (necesario para las capas
  remapeadas semánticamente de RM, que dependen de su estilo por defecto); pasa un `styles=` con
  nombre solo para las presentaciones genéricas por tipo de geometría.
- **GetFeatureInfo**: agrega `&query_layers=ws:capa&info_format=application/json&x=&y=` (coordenadas
  de píxel dentro del `width`/`height` pedido) a una petición GetMap equivalente. Verificado con
  `simtac_rm:inst_mil_irm`: responde JSON con atributos reales (`descripcio`, `nombre`,
  `ubicacion`...) — filtra los campos técnicos/internos en tu cliente antes de mostrarlos a un
  usuario final, GeoServer no los omite por su cuenta.
- **GetLegendGraphic**: `&request=GetLegendGraphic&layer=ws:capa&format=image/png&width=20&height=20`,
  con `&style=nombre` opcional (mismo criterio que GetMap: sin `style` para heredar el default). Un
  estilo de una sola regla sin nombre devuelve un swatch sin etiqueta — válido, no es un error que
  haya que manejar como excepción.

## WFS: GeoJSON y límites de consulta

Base: `GET {geoserver}/wfs?service=WFS&version=2.0.0&request=GetFeature&typeName=ws:capa&outputFormat=application/json`.
Verificado: 380 `FeatureType` publicados (= 389 capas totales − 9 coverages raster, que no son
consultables por WFS). No se confirmó un límite `maxFeatures` global configurado en esta instalación
— asume que una consulta sin acotar puede devolver el dataset completo. Ejemplo real de por qué
importa: `simtac_general:caminos_nal` (sin simplificar) tiene 1.87M features; una petición sin acotar
por `bbox` o `CQL_FILTER` puede tardar más de 30 s o no completar. Acota siempre con `bbox=` o
`CQL_FILTER=` cuando la capa pueda ser grande, y usa la variante `*_simplificado` cuando exista para
vistas de escala amplia.

## Ruta vehicular: `viewparams` por GET/KVP

La capa `simtac_general:simtac_ruta_calculada` es una vista SQL parametrizada (pgRouting). Se
consume con WFS GET/KVP, **no** con el flujo XML/POST de WFS (documentado como defectuoso en este
proyecto — no lo repitas):

```
GET {geoserver}/wfs?service=WFS&version=2.0.0&request=GetFeature
  &typeName=simtac_general:simtac_ruta_calculada&outputFormat=application/json
  &viewparams=origen_lon:{lon};origen_lat:{lat};destino_lon:{lon};destino_lat:{lat}
```

Coordenadas redondeadas a 6 decimales (~11 cm) — GeoServer rechaza con `HTTP 400` valores con más
precisión que el `regexpValidator` de la vista SQL acepta. Un valor de `viewparams` que contenga `:`
o `;` sin escapar corrompe el mini-formato interno (`clave:valor;clave:valor`) una vez que el
servidor decodifica el parámetro externo `viewparams=` — no basta con `encodeURIComponent` sobre la
cadena completa, hay que validar/rechazar esos caracteres en cada valor antes de componerla (ver
`SimtacClient.encodeViewParams` en `simtac-viewer/lib/simtac-client.js` para una implementación ya
endurecida con pruebas negativas, reutilizable como referencia).

**Defecto conocido, corregido en la réplica Mac (pendiente en el equipo de origen)**: repetir
exactamente las mismas coordenadas (redondeadas a 6 decimales) cuya fila de caché ya venció (>7
días) fallaba con `HTTP 400` (`duplicate key value violates unique constraint
"simtac_ruta_cache_pkey"`) en vez de devolver el resultado — la función SQL de caché hacía `INSERT`
sin `ON CONFLICT`. Coordenadas nuevas (o con un desplazamiento mínimo, ~30 m, insuficiente para
alejarse de la vía más cercana) funcionaban correctamente. La corrección es
`db/migrations/006_routing_cache_upsert.sql` (upsert idempotente); donde esté aplicada, el cliente
**no** necesita workaround alguno. Ver "Hallazgo 2" en `DEMO_VISOR_SIMTAC.md`.

## WMTS (GeoWebCache): `EPSG:4326`, grupos y estrategia de caché

Base: `GET {geoserver}/gwc/service/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=&STYLE=&FORMAT=image/png&TILEMATRIXSET=EPSG:4326&TILEMATRIX=EPSG:4326:{z}&TILEROW={y}&TILECOL={x}`.

Solo el grid `EPSG:4326` está sembrado en esta instalación; `WebMercatorQuad` no lo está — si tu
cliente usa un mapa en Web Mercator (la mayoría de librerías por defecto), necesitas o bien
reproyectar tu capa base a `EPSG:4326` (como hace `simtac-viewer/`, con una transformación Leaflet
custom) o pedir a un operador que siembre el grid que necesites (ver `MANTENIMIENTO_CACHE.md` — no
lo hagas tú mismo desde el cliente, es una operación administrativa).

5 layergroups base por rango de zoom, cacheados en GWC (más 3 heredados de compatibilidad, no
usarlos en una integración nueva). Rangos expresados como intervalo semiabierto `[mínimo, máximo)`
— el zoom del límite superior ya pertenece al siguiente grupo, no a este — igual que `groupForZoom`
en `simtac-viewer/lib/simtac-client.js`: `simtac_zoom_mundo` = `[0, 5)` (zooms enteros 0–4),
`simtac_zoom_pais` = `[5, 7)` (5–6), `simtac_zoom_region` = `[7, 9)` (7–8), `simtac_zoom_operacional`
= `[9, 11)` (9–10), `simtac_zoom_contexto` = `[11, ∞)` (11 en adelante). Cambia de grupo activo
cuando el zoom del cliente cruza esos umbrales, no sirvas todos a la vez.

Orden de composición recomendado: pane base WMTS (z-index bajo), pane satelital WMTS y, encima,
vectores/temáticas. El satélite nunca debe tapar símbolos RM/FAM/Marina ni resultados de ruta.
Cuando el usuario selecciona una RM, el visor de referencia intercala además un WMS directo del
`poligono_*rm` con el estilo `simtac_cartografia_rm_seleccionada`: relleno malva `#985083` al
18 % y contorno lima, sólo en z4–10 y sin eventos de puntero. Su pane queda sobre la base y bajo
satélite, líneas e iconos. Los municipios recuperan el borde cian y `nomgeo` oscuro con halo crema.
En `simtac_zoom_contexto`, la vialidad se pinta antes de los municipios para que límites y nombres
queden encima desde z11.

En la instalación del 2026-08-28, las bandas z7+ combinan el relieve detallado
`modelo_seis_relieve` (RGBA precalculado, paleta verde–ocre y hillshade multidireccional sutil)
con el polígono sólido `oceanos_nal`; `modelo_seis_color` permanece disponible como alternativa
plana y mecanismo de reversión, y `oceanos_raster_nal` queda reservado a
las escalas amplias porque también contiene tierra a baja resolución. El visor pide los cinco
grupos por WMTS; en z7+ agrega
`SIMTAC_CACHE_VERSION=20260828-relieve-sombreado-v10`. GWC reconoce esa dimensión y la almacena
separada de `legacy-pre-versioned-cache`, por lo que no se mezclan teselas antiguas ni fue necesario
truncarlas.

Recomendación de rendimiento: agrega un parámetro de cache-busting propio
(`&SIMTAC_CACHE_VERSION=...`) solo cuando cambies deliberadamente de versión de estilo/base — no en
cada petición, o pierdes el beneficio de GWC.

## Layergroups semánticos RM por escala

Cada Región Militar tiene layergroups pre-armados por banda de detalle, nombrados
`simtac_piloto_rm_{numeral_romano_en_minusculas}_{banda}` — ej. `simtac_piloto_rm_i_detalle_operativo`
para la I RM. Bandas disponibles y su rango de zoom recomendado (ver `RM_BAND_ZOOMS` en
`simtac-viewer/index.html` para los umbrales exactos usados en este proyecto):
`jurisdiccion_region`, `estatal_amplio`, `regional_municipal`, `vialidad_puentes`,
`detalle_operativo`. No todas las 12 regiones tienen las 5 bandas pobladas — descubre cuáles existen
por región desde `catalogo_capas.json` (`clasificacion: "automatica"` + `banda_zoom`) en vez de
asumir el conjunto completo. `continental_maritimo` está fuera de alcance de este flujo, no lo
actives desde un cliente sin verificar primero si aplica a tu caso.

## Mosaico satelital y detección de disponibilidad

`simtac_general:img_sat_nal` vive en un disco externo montable/desmontable — trátalo siempre como
**condicionalmente disponible**, nunca como una capa garantizada:

```
GET {geoserver}/simtac_general/wms?service=WMS&version=1.1.1&request=GetCapabilities
```

Busca `<Name>img_sat_nal</Name>` en la respuesta (GetCapabilities scoped al workspace, más liviano
que el global). Si no aparece, el perfil está desmontado — es un estado esperado, no un error que
reportar como fallo del servidor. Si aparece, extrae su `<LatLonBoundingBox>` real del mismo
documento para encuadrar tu vista (nunca inventes coordenadas). Resolución aproximada ~1.5 m
(varía con la latitud, EPSG:4326); sin fecha de adquisición en los metadatos fuente — comunica esa
limitación a tu usuario final si la muestras.

Además, sólo se muestra en zoom Leaflet **12–18**. Configura la capa con `minZoom: 12`,
`maxZoom: 18` y `maxNativeZoom: 15`: GWC guarda PNG/EPSG:4326 z12–15 y el cliente amplía z15 al
acercarse más. Añade `SIMTAC_CACHE_VERSION=20260828-satelital-v2` a la petición WMTS. No la añadas
fuera de ese rango y conserva por separado la intención del usuario para reactivarla al volver. El estilo
predeterminado `simtac_cartografia_satelite_operativo` aplica también a WMS externo una banda
nominal aproximada hasta 1:200,000, con resguardo técnico inferior 1:750 para que la
matriz EPSG:4326 cubra z18. “Operacional satelital” no significa el grupo base histórico
`simtac_zoom_operacional`, que sigue correspondiendo a z9–10.

## Timeouts, cancelación y errores OGC

- Usa `AbortController` con un timeout explícito en cualquier petición que pueda tardar (WFS sobre
  capas grandes, ruta). Este proyecto usa 60 s para el cálculo de ruta como referencia razonable —
  ajústalo a tu caso, no lo copies sin pensar.
- GeoServer devuelve errores OGC como XML (`ServiceExceptionReport`) incluso cuando pediste
  `outputFormat=application/json` para el caso de éxito — un `response.ok` con `HTTP 200` no
  garantiza que el cuerpo sea el JSON esperado; valida la forma de la respuesta antes de asumir
  éxito, o revisa el `Content-Type` devuelto.
- Un `HTTP 200` con contenido válido no es evidencia de que el resultado sea correcto: un GetMap
  puede devolver un PNG válido y en blanco (bbox mal formado, capa vacía en esa área, versión WMS
  incorrecta). Si tu integración depende de verificar visualmente, no te bases solo en el código de
  estado.

## Ejemplo mínimo con `fetch` (sin librería de mapas)

```js
async function getFeatureInfo(geoserverUrl, layer, bboxLonLat, width, height, x, y) {
  const params = new URLSearchParams({
    service: "WMS", version: "1.1.1", request: "GetFeatureInfo",
    layers: layer, query_layers: layer, styles: "",
    bbox: bboxLonLat, width: String(width), height: String(height),
    srs: "EPSG:4326", info_format: "application/json", x: String(x), y: String(y),
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${geoserverUrl}/wms?${params}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}
```

## Ejemplo mínimo con Leaflet

```js
const grupos = [
  [0, 5, "simtac_zoom_mundo"], [5, 7, "simtac_zoom_pais"],
  [7, 9, "simtac_zoom_region"], [9, 11, "simtac_zoom_operacional"],
  [11, 99, "simtac_zoom_contexto"],
];
const grupoParaZoom = z => grupos.find(([min, max]) => z >= min && z < max)[2];

// WMTS base: usa grupoParaZoom(map.getZoom()) como LAYER y EPSG:4326 como matrix set.
// Satélite WMTS versionado; {z}/{y}/{x} se sustituyen por TileMatrix/Row/Col.
const satUrl = `${geoserverUrl}/gwc/service/wmts?SERVICE=WMTS&REQUEST=GetTile` +
  `&VERSION=1.0.0&LAYER=simtac_general%3Aimg_sat_nal&STYLE=&FORMAT=image%2Fpng` +
  `&TILEMATRIXSET=EPSG%3A4326&TILEMATRIX=EPSG%3A4326%3A{z}` +
  `&TILEROW={y}&TILECOL={x}&SIMTAC_CACHE_VERSION=20260828-satelital-v2`;
const satelite = L.tileLayer(satUrl, {
  minZoom: 12, maxZoom: 18, maxNativeZoom: 15, pane: "satelite",
});
map.on("zoomend", () => {
  const permitido = map.getZoom() >= 12 && map.getZoom() <= 18;
  if (!permitido && map.hasLayer(satelite)) map.removeLayer(satelite);
});
```

No se probó un ejemplo equivalente con OpenLayers en este proyecto (el visor de referencia usa
Leaflet exclusivamente) — construye los parámetros WMTS KVP indicados en esta sección; no hay una
verificación específica de OpenLayers que citar aquí.

## Configuración y enlaces compartibles para otra aplicación

- **URL del servidor configurable, no hardcodeada**: si construyes un cliente web, permite apuntar a
  otra instalación (parámetro de query, variable de entorno, config) y valida esa entrada antes de
  usarla — protocolo `http`/`https` únicamente, sin credenciales embebidas, sin ruta `/rest`
  (incluida su forma percent-encoded), sin query ni fragmento propios. `SimtacClient.resolveGeoServerUrl`/
  `requireSafeBaseUrl` en `simtac-viewer/lib/simtac-client.js` son una implementación ya endurecida y
  con pruebas negativas — reutilízala o pórtala en vez de reescribir la validación desde cero.
- **Enlaces compartibles**: si tu cliente tiene estado de vista (centro, zoom, capas activas), sigue
  el mismo patrón de `SimtacClient.serializeShareState`/`parseShareState`: solo los campos
  reconocidos explícitamente, validados por rango/regex al restaurar, un tope superior al número de
  capas que se pueden serializar (aquí 50, para no activar cientos de capas de golpe desde un enlace
  malicioso o corrupto), y nunca parámetros administrativos ni credenciales en la URL.
