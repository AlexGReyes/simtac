# Consumir SIMTAC GeoServer desde otra aplicación en la red local (réplica Mac)

Este documento es **autocontenido** y está pensado para entregárselo a otra IA o
a otro equipo de desarrollo que necesite integrar los mapas de SIMTAC —
teselas cacheadas (WMTS/GWC) y mapas dinámicos (WMS/WFS)— en su propia
aplicación, **tal como lo hace `simtac-viewer/`**, consumiéndolo desde la misma
red (`10.40.0.0/23` por Wi‑Fi o `172.200.1.0/24` por Ethernet).

Para el detalle fino de cada servicio OGC (parámetros exactos, defectos
conocidos, endurecimiento de entradas) la referencia profunda y verificada es
[`INTEGRACION_SIMTAC_GEOSERVER.md`](INTEGRACION_SIMTAC_GEOSERVER.md) en este mismo
repositorio. Aquí va lo mínimo operativo más los endpoints de red reales.

> Estado de este despliegue (2026‑09‑09): réplica Docker de SIMTAC levantada en
> un Mac M4 (Apple Silicon, imágenes `linux/amd64` bajo emulación). Es una
> **réplica de validación**, no producción: el equipo original sigue como
> reversión. No cambiar DNS ni URLs de servicio.

---

## 1. Endpoints de red

Los dos servicios escuchan en **`0.0.0.0`** (todas las interfaces), así que son
alcanzables por cualquier equipo de la(s) red(es) a la(s) que esté conectado el
Mac. Docker Desktop para Mac no permite ligar a una IP de host concreta; por eso
es `0.0.0.0` y no una IP fija.

| Servicio | Puerto | Qué es |
|---|---|---|
| **GeoServer** (mapas: WMS/WFS/WMTS/GWC) | `3001` | contenedor Docker `simtac_geoserver`, `restart: unless-stopped` |
| **Visor de referencia** `simtac-viewer` | `3002` | `python -m http.server` sirviendo la raíz del repo; **no** es un servicio persistente |

### IP a usar según la red del Mac

| Red | Interfaz | IP del Mac | Base GeoServer | Visor |
|---|---|---|---|---|
| Wi‑Fi `10.40.0.0/23` | `en1` | `10.40.0.24` *(DHCP, puede cambiar)* | `http://10.40.0.24:3001/geoserver` | `http://10.40.0.24:3002/simtac-viewer/` |
| Ethernet `172.200.1.0/24` | `en0` | `172.200.1.17` *(IP fija/manual)* | `http://172.200.1.17:3001/geoserver` | `http://172.200.1.17:3002/simtac-viewer/` |

- **Descubre la IP vigente** en el Mac con `ipconfig getifaddr en1` (Wi‑Fi) o
  `ipconfig getifaddr en0` (Ethernet). No la hardcodees si puedes evitarlo:
  hazla configurable en tu app.
- Al estar en `0.0.0.0`, si se conecta/desconecta el cable Ethernet **no hay que
  reiniciar nada**; la IP `172.200.1.17` empieza/deja de responder sola.
- `http://localhost:3001/geoserver` sólo funciona **en el propio Mac**.

### Abrir el visor de referencia desde otro equipo

El visor deriva por defecto la URL de GeoServer del **mismo origen** con el que
se abrió (`http://<host>:3002/geoserver`), que aquí no existe porque GeoServer
está en el puerto `3001`. Hay que pasarle la URL explícita por query string:

```
http://10.40.0.24:3002/simtac-viewer/?geoserver=http://10.40.0.24:3001/geoserver
http://172.200.1.17:3002/simtac-viewer/?geoserver=http://172.200.1.17:3001/geoserver
```

Regla: el valor de `?geoserver=` debe apuntar al **mismo host** con el que
abriste el visor (para no mezclar orígenes).

### CORS

Verificado en vivo contra este servidor: responde
`Access-Control-Allow-Origin: *` en los servicios OGC públicos. Un cliente de
navegador en cualquier origen puede llamar `wms`/`wfs`/`gwc/service/wmts`
directamente con `fetch()` **sin proxy**.

### Seguridad / alcance

- Todo lo de este documento es **de solo lectura y sin credenciales**:
  `/geoserver/wms`, `/geoserver/wfs`, `/geoserver/gwc/service/wmts`,
  `/geoserver/{workspace}/...`.
- **Nunca** llames `/geoserver/rest/...` ni `/geoserver/gwc/rest/...` desde código
  cliente: requieren credenciales de administrador y permiten publicar/borrar
  capas y truncar caché. Sembrar/invalidar caché es tarea del operador del
  servidor, no del cliente.
- El servidor está en HTTP plano, sin TLS, y el firewall del Mac está
  desactivado. Adecuado para una LAN de confianza; no exponer a Internet.

---

## 2. Modelo de capas

- Una capa se referencia siempre como `workspace:nombre` (p. ej.
  `simtac_rm:inst_mil_irm`) en `layers` / `typeName` / `LAYER`.

| Workspace | Dominio | Prefijo típico |
|---|---|---|
| `simtac_general` | Cartografía nacional: caminos, ciudades, clima, océanos, relieve, mosaico satelital, layergroups base | `*_nal` |
| `simtac_rm` | 12 Regiones Militares | `*_irm` … `*_xiirm` |
| `simtac_fam` | 4 Regiones Aéreas (FAM) | `*_rac`, `*_rane`, `*_rano`, `*_rase` |
| `simtac_marina` | Marina | `*_marina` |

- **No hardcodees la lista de capas** (~391 publicadas, cambia con el tiempo).
  Descúbrela en runtime:
  - **Con acceso al filesystem del repo**: `catalogo_capas.json` (raíz) — misma
    estructura que consume el visor, con `tipo_geometria`, `clasificacion`,
    `banda_zoom` y notas de calidad por capa.
  - **Sólo con acceso de red**: `GetCapabilities` de WMS/WFS y parsea
    `<Name>` / `<FeatureType>`. Para un solo workspace, pide el
    `GetCapabilities` *scoped*: `http://<host>:3001/geoserver/{workspace}/wms?...`.

---

## 3. WMTS / GeoWebCache — la base cacheada (lo que pinta el fondo del visor)

Base KVP:

```
GET http://<host>:3001/geoserver/gwc/service/wmts
  ?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0
  &LAYER={grupo}&STYLE=&FORMAT=image/png
  &TILEMATRIXSET=EPSG:4326&TILEMATRIX=EPSG:4326:{z}&TILEROW={y}&TILECOL={x}
```

- **Sólo está sembrado el grid `EPSG:4326`.** `WebMercatorQuad` **no** existe. Si
  tu librería de mapas usa Web Mercator por defecto (lo normal), tienes que
  configurar el mapa en `EPSG:4326` (como hace `simtac-viewer/` con una
  proyección Leaflet a medida) o pedir a un operador que siembre otro grid.
- `FORMAT=image/png`, teselas de 256×256.
- Cuota GWC: 6 GiB base + 2 GiB satélite, política LFU. Sembrado bajo demanda
  (la primera petición de cada tesela la genera y la guarda).
- BBOX con caché pre‑sembrada: `-118, 14, -86, 33` (EPSG:4326), zoom 0–11. Fuera
  de eso funciona igual pero se calcula al vuelo la primera vez.

### 3.1 Los 5 layergroups base por rango de zoom

Rangos como intervalo semiabierto `[min, max)` — el zoom del límite superior ya
es del siguiente grupo. **Cambia de grupo activo al cruzar el umbral; no sirvas
varios a la vez.**

| Grupo (`LAYER`) | Zooms | Contenido |
|---|---|---|
| `simtac_zoom_mundo` | 0–4 | relieve mundial + océanos + países; sin caminos |
| `simtac_zoom_pais` | 5–6 | base nacional sin vialidad |
| `simtac_zoom_region` | 7–8 | + vialidad simplificada + ciudades + límites RM/FAM |
| `simtac_zoom_operacional` | 9–10 | + municipios; conserva vialidad simplificada |
| `simtac_zoom_contexto` | 11–18 | + `caminos_nal` completo; las temáticas se piden aparte desde z12 |

Hay 3 grupos heredados (`simtac_zoom_nacional`, `simtac_zoom_regional`,
`simtac_zoom_detalle`) — **no usarlos en una integración nueva**.

### 3.2 Versionado de caché (cache‑busting)

Para z7+ el visor añade a la petición WMTS un parámetro de dimensión que GWC
almacena por separado:

| Uso | Parámetro |
|---|---|
| Relieve/base z7 y superiores | `&SIMTAC_CACHE_VERSION=20260828-relieve-sombreado-v10` |
| Mosaico satelital | `&SIMTAC_CACHE_VERSION=20260828-satelital-v2` |

Añádelo **sólo** cuando corresponda (z7+ para la base; siempre para el satélite),
no en cada petición indiscriminadamente, o pierdes el beneficio de la caché del
navegador. Estos valores son constantes del proyecto (`BASE_CACHE_VERSION` /
`SATELLITE_CACHE_VERSION` en `simtac-viewer/index.html`); cámbialos sólo cuando el
proyecto publique una generación nueva.

### 3.3 Variante RESTful (equivalente)

```
GET http://<host>:3001/geoserver/gwc/service/wmts/rest/{workspace}:{capa}/{estilo}/EPSG:4326/EPSG:4326:{z}/{y}/{x}?format=image/png
```

---

## 4. Mosaico satelital — `simtac_general:img_sat_nal`

Vive en un disco externo montable/desmontable. **Trátalo como condicionalmente
disponible**, nunca garantizado.

1. Comprueba disponibilidad con el GetCapabilities *scoped* al workspace:
   ```
   GET http://<host>:3001/geoserver/simtac_general/wms?service=WMS&version=1.1.1&request=GetCapabilities
   ```
   Si aparece `<Name>simtac_general:img_sat_nal</Name>` está montado; si no, está
   desmontado — es un estado **esperado**, no un fallo del servidor.
2. Cuando esté, toma su `<LatLonBoundingBox>` real del mismo documento para
   encuadrar; no inventes coordenadas.
3. Resolución ~1.5 m (EPSG:4326, varía con la latitud). Sin fecha de adquisición
   en los metadatos — adviértelo al usuario final si lo muestras.
4. Sólo se muestra en **zoom 12–18**. Config recomendada: `minZoom: 12`,
   `maxZoom: 18`, `maxNativeZoom: 15` (GWC guarda z12–15, el cliente amplía z15).
   Añade `&SIMTAC_CACHE_VERSION=20260828-satelital-v2`.
5. Orden de composición: el satélite va **debajo** de vectores, símbolos RM/FAM/
   Marina y resultados de ruta; nunca los tapa.

En este despliegue está **montado y sirviendo** (verificado: GetMap devuelve PNG
real con contenido, no un 200 en blanco). El disco está montado read‑only.

---

## 5. WMS dinámico — GetMap, GetFeatureInfo, GetLegendGraphic

Base: `GET http://<host>:3001/geoserver/wms?service=WMS&version=1.1.1&request=...`

**Usa WMS 1.1.1, no 1.3.0.** Con `EPSG:4326`, la 1.3.0 invierte el orden de ejes
del bbox a `lat,lon` (vs `lon,lat` en 1.1.1) — causa GetMap en blanco. La 1.1.1
evita la ambigüedad.

- **GetMap**:
  `&layers=ws:capa&styles=&bbox=lonMin,latMin,lonMax,latMax&width=&height=&srs=EPSG:4326&format=image/png&transparent=true`
  Deja `styles=` vacío para heredar el estilo por defecto de la capa (obligatorio
  para las capas RM remapeadas semánticamente). Pasa un `styles=` con nombre sólo
  para presentaciones genéricas por tipo de geometría.
- **GetFeatureInfo**: sobre una petición GetMap equivalente añade
  `&query_layers=ws:capa&info_format=application/json&x={px}&y={px}` (píxel dentro
  del `width`/`height` pedido). Devuelve un `FeatureCollection` GeoJSON. Filtra en
  tu cliente los campos técnicos antes de mostrarlos.
- **GetLegendGraphic**:
  `&request=GetLegendGraphic&layer=ws:capa&format=image/png&width=20&height=20`
  (`&style=` opcional, mismo criterio).
- Capa vial suelta (fuera de los grupos): usa el estilo explícito
  `simtac_cartografia_vialidad_jerarquica`. No dibujes todo `caminos_nal` sin
  filtrar por el campo `tipo`: esa capa también trae límites de manzana y áreas
  construidas.

### Layergroups RM por escala

Cada Región Militar tiene grupos pre‑armados
`simtac_piloto_rm_{romano_minúsculas}_{banda}` (p. ej.
`simtac_piloto_rm_i_detalle_operativo`). Bandas: `jurisdiccion_region`,
`estatal_amplio`, `regional_municipal`, `vialidad_puentes`, `detalle_operativo`.
No todas las 12 regiones tienen las 5 bandas — descubre cuáles existen desde
`catalogo_capas.json` (`clasificacion: "automatica"` + `banda_zoom`).

---

## 6. WFS — datos vectoriales (GeoJSON)

Base:
`GET http://<host>:3001/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeName=ws:capa&outputFormat=application/json`

- ~380 `FeatureType` consultables (las 9 coberturas raster no lo son).
- **Acota siempre** capas potencialmente grandes con `&bbox=lonMin,latMin,lonMax,latMax`
  o `&CQL_FILTER=...`. Ejemplo: `simtac_general:caminos_nal` sin simplificar tiene
  ~1.87 M features; sin acotar puede tardar >30 s. Usa la variante
  `*_simplificado` cuando exista para vistas de escala amplia.
- No se confirmó un `maxFeatures` global — asume que una consulta sin acotar
  puede traer el dataset completo.

---

## 7. Ruta vehicular (pgRouting) — `simtac_general:simtac_ruta_calculada`

Vista SQL parametrizada. Se consume por **WFS GET/KVP** (no por el flujo XML/POST):

```
GET http://<host>:3001/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature
  &typeName=simtac_general:simtac_ruta_calculada&outputFormat=application/json
  &viewparams=origen_lon:{lon};origen_lat:{lat};destino_lon:{lon};destino_lat:{lat}
```

- Coordenadas **redondeadas a 6 decimales**; más precisión → `HTTP 400`.
- Cada valor de `viewparams` no puede contener `:` ni `;` — valida/rechaza antes
  de componer la cadena (no basta `encodeURIComponent` sobre el todo). Referencia
  endurecida con pruebas: `SimtacClient.encodeViewParams` en
  `simtac-viewer/lib/simtac-client.js`.
- Usa `AbortController` con timeout (~60 s de referencia).

> **Defecto conocido, corregido en esta réplica (pendiente en el origen):**
> repetir exactamente el mismo par de coordenadas (a 6 decimales) cuya ruta ya
> está cacheada y con más de 7 días de antigüedad fallaba con
> `HTTP 400 duplicate key ... "simtac_ruta_cache_pkey"` en vez de devolver el
> resultado — la función SQL de caché hacía `INSERT` sin `ON CONFLICT`.
> Coordenadas nuevas (o con ~30 m de desplazamiento) funcionaban bien. La
> corrección es `db/migrations/006_routing_cache_upsert.sql`: donde esté
> aplicada no hace falta ningún workaround (ni desplazar coordenadas, ni
> reintentos, ni limpiar `simtac_ruta_cache` a mano).

---

## 8. Manejo de errores

- GeoServer devuelve errores como **XML** (`ServiceExceptionReport` /
  `ows:ExceptionReport`) **aunque pidieras `outputFormat=application/json`**. Un
  `HTTP 200` no garantiza que el cuerpo sea el JSON esperado — valida el
  `Content-Type` o la forma de la respuesta.
- Un `HTTP 200` con PNG válido puede ser un mapa **en blanco** (bbox mal formado,
  capa vacía en esa área, versión WMS incorrecta). No te fíes sólo del código.
- WFS sin acotar y rutas pueden tardar: usa `AbortController` con timeout.

---

## 9. Ejemplos listos para copiar

Sustituye `HOST` por `10.40.0.24` o `172.200.1.17` según la red.

### 9.1 Fondo WMTS + satélite con Leaflet (mapa en EPSG:4326)

```js
const HOST = "10.40.0.24"; // o "172.200.1.17"
const GS = `http://${HOST}:3001/geoserver`;
const BASE_CACHE_VERSION = "20260828-relieve-sombreado-v10";
const SAT_CACHE_VERSION  = "20260828-satelital-v2";

const ZOOM_GROUPS = [
  { name: "simtac_zoom_mundo",       min: 0,  max: 5  },
  { name: "simtac_zoom_pais",        min: 5,  max: 7  },
  { name: "simtac_zoom_region",      min: 7,  max: 9  },
  { name: "simtac_zoom_operacional", min: 9,  max: 11 },
  { name: "simtac_zoom_contexto",    min: 11, max: 20 },
];
const groupForZoom = z => ZOOM_GROUPS.find(g => z >= g.min && z < g.max);

function wmtsUrl(layer, { cacheVersion } = {}) {
  let u = `${GS}/gwc/service/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0` +
    `&LAYER=${encodeURIComponent(layer)}&STYLE=&FORMAT=image/png` +
    `&TILEMATRIXSET=EPSG:4326&TILEMATRIX=EPSG:4326:{z}&TILEROW={y}&TILECOL={x}`;
  if (cacheVersion) u += `&SIMTAC_CACHE_VERSION=${encodeURIComponent(cacheVersion)}`;
  return u;
}

// Base: cambia el layer del tileLayer cuando el zoom cruza un umbral de grupo.
// Para z>=7 pasa cacheVersion: BASE_CACHE_VERSION.

// Satélite (condicional; sólo z12-18):
const sat = L.tileLayer(
  wmtsUrl("simtac_general:img_sat_nal", { cacheVersion: SAT_CACHE_VERSION }),
  { minZoom: 12, maxZoom: 18, maxNativeZoom: 15, pane: "satelite" }
);
```

### 9.2 ¿Está montado el satélite?

```js
async function satelliteAvailable(GS) {
  const res = await fetch(
    `${GS}/simtac_general/wms?service=WMS&version=1.1.1&request=GetCapabilities`
  );
  const xml = await res.text();
  return xml.includes("<Name>simtac_general:img_sat_nal</Name>");
}
```

### 9.3 GetFeatureInfo (clic en el mapa)

```js
async function getFeatureInfo(GS, layer, bboxLonLat, width, height, x, y) {
  const p = new URLSearchParams({
    service: "WMS", version: "1.1.1", request: "GetFeatureInfo",
    layers: layer, query_layers: layer, styles: "",
    bbox: bboxLonLat, width: String(width), height: String(height),
    srs: "EPSG:4326", info_format: "application/json", x: String(x), y: String(y),
  });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${GS}/wms?${p}`, { signal: ctrl.signal });
    const ct = res.headers.get("content-type") || "";
    if (!res.ok || !ct.includes("json")) throw new Error(`respuesta inesperada: ${res.status} ${ct}`);
    return await res.json();
  } finally { clearTimeout(t); }
}
```

### 9.4 Ruta vehicular

```js
function encodeViewParam(v) {
  const s = String(v);
  if (s.includes(":") || s.includes(";")) throw new Error("valor inválido para viewparams");
  return s;
}
async function calcularRuta(GS, oLon, oLat, dLon, dLat) {
  const r = n => Number(n).toFixed(6);
  const vp = [
    `origen_lon:${encodeViewParam(r(oLon))}`,
    `origen_lat:${encodeViewParam(r(oLat))}`,
    `destino_lon:${encodeViewParam(r(dLon))}`,
    `destino_lat:${encodeViewParam(r(dLat))}`,
  ].join(";");
  const p = new URLSearchParams({
    service: "WFS", version: "2.0.0", request: "GetFeature",
    typeName: "simtac_general:simtac_ruta_calculada",
    outputFormat: "application/json", viewparams: vp,
  });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(`${GS}/wfs?${p}`, { signal: ctrl.signal });
    const ct = res.headers.get("content-type") || "";
    if (!res.ok || !ct.includes("json")) throw new Error(`ruta: ${res.status} ${ct}`);
    return await res.json();
  } finally { clearTimeout(t); }
}
```

### 9.5 Comprobación rápida por terminal

```bash
HOST=10.40.0.24
curl -s -o /dev/null -w "WMS caps: %{http_code}\n" \
  "http://$HOST:3001/geoserver/ows?service=WMS&version=1.3.0&request=GetCapabilities"
curl -s -o tile.png -w "WMTS tile: %{http_code} %{size_download}B\n" \
  "http://$HOST:3001/geoserver/gwc/service/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=simtac_zoom_pais&STYLE=&FORMAT=image/png&TILEMATRIXSET=EPSG:4326&TILEMATRIX=EPSG:4326:5&TILEROW=10&TILECOL=7"
```

---

## 10. Checklist para la otra IA / integrador

- [ ] Mapa configurado en **`EPSG:4326`** (no Web Mercator).
- [ ] URL de GeoServer **configurable** (no hardcodeada); validar: sólo `http`/`https`,
      sin credenciales, sin `/rest`, sin query/fragment propios.
- [ ] Capa base = un solo layergroup WMTS según el zoom (`groupForZoom`), cambiando
      al cruzar umbrales.
- [ ] `SIMTAC_CACHE_VERSION` sólo donde toca (z7+ base; siempre satélite).
- [ ] Satélite tratado como condicional (chequear GetCapabilities scoped); z12–18.
- [ ] WMS **1.1.1** con bbox `lon,lat`.
- [ ] WFS siempre acotado por `bbox`/`CQL_FILTER` en capas grandes.
- [ ] `viewparams` de ruta: 6 decimales, sin `:`/`;` por valor, timeout.
- [ ] Manejo de error: verificar `Content-Type`, no fiarse del `HTTP 200`.
- [ ] Nunca llamar `/rest/` ni `/gwc/rest/` desde el cliente.
- [ ] No versionar ni exponer nada de `/geoserver/rest`, credenciales o `.env`.
