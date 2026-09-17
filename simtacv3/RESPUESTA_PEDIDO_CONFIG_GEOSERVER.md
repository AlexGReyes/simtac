# Respuesta a `PEDIDO_CONFIG_GEOSERVER.md`

Entregado en este repositorio:

| Artefacto | Ruta | Qué es |
|---|---|---|
| **Archivo de configuración** | [`config/simtac-geoserver.json`](config/simtac-geoserver.json) | Lo que cambia según el despliegue (URLs, timeouts, shape de la respuesta, límites), leíble por un proceso. |
| Arreglo del bug de caché | [`db/migrations/006_routing_cache_upsert.sql`](db/migrations/006_routing_cache_upsert.sql) | `INSERT` → upsert idempotente en la función SQL de caché de ruta. **Ya aplicado** en la réplica Mac. |
| API de referencia | [`INTEGRACION_RED_LOCAL_MAC.md`](INTEGRACION_RED_LOCAL_MAC.md) §7, [`INTEGRACION_SIMTAC_GEOSERVER.md`](INTEGRACION_SIMTAC_GEOSERVER.md) | Sin cambios de fondo; ya la tenían. |

El archivo de config se **mantiene en este repo**; el backend Node lo copia o lo lee, no lo edita. Cuando cambie el despliegue (puerto, IP, estado del servicio) se actualiza `_meta.actualizado` y los campos afectados en el mismo commit.

---

## Respuesta punto por punto

### 1. ¿Cuál de las dos URLs (Wi‑Fi / Ethernet) debe usar el backend?

**La de Ethernet: `http://172.200.1.17:3001/geoserver`** (`geoserver.baseUrl` en el JSON).

- `172.200.1.17` es la IP de `en0` (Ethernet), **configuración manual/fija** — no DHCP. Es la estable.
- `10.40.0.24` es Wi‑Fi (`en1`), **DHCP** — mismo problema que su punto 21. Queda como `geoserver.baseUrlAlt`, sólo respaldo o si el cable Ethernet está desconectado.
- **No hay DNS de LAN todavía** (`geoserver.dnsLan: null`). Si le dan un nombre fijo al Mac, avisen y lo ponemos en `geoserver.dnsLan`; el backend debería preferirlo sobre las IPs cuando exista.
- Patrón recomendado para el backend: al iniciar (y al detectar un fallo de red, de forma perezosa, no en cada request) probar `baseUrl + geoserver.healthCheck.path`; si no responde `200` con `WMT_MS_Capabilities` en 15 s, probar `baseUrlAlt` y quedarse con la que funcione. El JSON trae ese endpoint y el token esperado.

### 2. Shape exacto de la respuesta de `simtac_ruta_calculada`

Verificado contra el servidor en vivo (ver `rutaVehicular.respuesta` en el JSON):

- `FeatureCollection` GeoJSON, CRS `urn:ogc:def:crs:EPSG::4326`.
- **1 feature** cuando hay ruta; **0 features** (FeatureCollection vacío, HTTP 200) cuando no se pudo trazar.
- ⚠️ **La geometría es `MultiLineString`, no `LineString`.** `features[0].geometry.coordinates` es `[ [ [lon,lat], … ], … ]` — una o varias partes (normalmente 1; puede haber 2+ si la ruta queda disjunta tras `ST_LineMerge`). **Itera todas las partes**, no asumas `coordinates[0]`.
- Puntos en orden `[lon, lat]`.
- ⚠️ **El sentido de la línea no está garantizado** — puede venir de destino → origen. Si necesitas orientarla, compara los extremos contra las coordenadas pedidas e invierte si hace falta.
- `properties`:
  - `id`: siempre `1`, no significativo.
  - **`length_m`**: longitud real de la ruta sobre la red vial, en metros. **Úsala como distancia** — es más precisa que un haversine sobre los vértices.
  - `n_segmentos`: número de tramos de calle.
  - **No hay duración.** pgRouting devuelve sólo distancia y conteo de segmentos. **El tiempo/velocidad lo sigue calculando el backend** (tu modelo de velocidad sobre `length_m` o por tipo de vía). Ejemplo real: `{"id":1,"length_m":64895.84,"n_segmentos":59}`.

### 3. Bug de caché (`HTTP 400 duplicate key … simtac_ruta_cache_pkey`)

**Corregido.** `db/migrations/006_routing_cache_upsert.sql`, aplicado a la réplica Mac el 2026‑09‑10. El `INSERT` de la función `simtac_calcular_ruta_resumen` pasó a ser `INSERT … ON CONFLICT (cache_key) DO UPDATE`: una fila de caché vencida (>7 días) se **refresca** en lugar de colisionar.

- Verificado: el par que antes fallaba (`-99.1332,19.4326 → -99.6532,19.2926`) ahora responde `HTTP 200`; `simtac.ps1 health -IncludeRoute` → `geoserver:route OK`.
- **El backend no necesita workaround** (ni jitter de coordenadas, ni reintentos, ni endpoint de invalidación puntual) para este motivo.
- Pendiente: aplicar la misma migración `006` al **equipo de origen** cuando se coordine — hoy el origen sigue con el bug (está fuera de esta réplica de validación).

### 4. Límite de throughput

**No hay límite duro configurado; la carga de un ejercicio típico no es problema.**

Prueba real (8 `GetFeature` concurrentes, rutas frescas de hasta ~886 km / 671 segmentos, PostGIS `amd64` emulado en el Mac M4): todas `HTTP 200`, 0.4–1.4 s cada una, ~1.4 s de pared total. Rutas cortas o ya cacheadas: <100 ms.

Recomendaciones para el backend (en `rutaVehicular.throughput` del JSON):

1. Pedir una ruta **por unidad al arrancar la orden**, no por tick.
2. **Deduplicar/cachear del lado del backend** por par de coordenadas (el servidor ya cachea 7 días, pero evitas el round‑trip).
3. Limitar la **concurrencia saliente** hacia GeoServer a ~4–8 peticiones en vuelo y encolar el resto — el objetivo es no competir con las peticiones de teselas del visor, no una limitación del cálculo.

### 5. ¿Sigue sin credenciales para tráfico servidor a servidor?

**Sí.** `/geoserver/wfs` es público de solo lectura. Verificado con `curl` (sin navegador, sin cabecera `Authorization`): responde `200` sin token. El `Access-Control-Allow-Origin: *` es para navegadores y no dice nada sobre servidor‑a‑servidor — pero no hace falta ningún token para ninguno de los dos.

`auth: null` en el JSON. **Nunca** llamar `/geoserver/rest` ni `/geoserver/gwc/rest` desde el backend (requieren admin, permiten borrar/publicar/truncar).

---

## Cómo lo usaría el backend

`rutaService` (o un `rutaVehicularService` nuevo, si prefieren no mezclarlo con la lógica de la tabla `rutas`) haría el mismo `GetFeature` de `INTEGRACION_RED_LOCAL_MAC.md` §9.4, leyendo de `config/simtac-geoserver.json`:

```js
const cfg = JSON.parse(fs.readFileSync("config/simtac-geoserver.json", "utf8"));
const base = await pickBaseUrl(cfg.geoserver);            // baseUrl, con fallback a baseUrlAlt vía healthCheck
const rv = cfg.rutaVehicular;

function viewparam(v) {
  const s = String(v);
  if (s.includes(":") || s.includes(";")) throw new Error("valor inválido para viewparams");
  return s;
}
async function calcularRutaReal(oLon, oLat, dLon, dLat) {
  const r = n => Number(n).toFixed(6);
  const vp = [
    `origen_lon:${viewparam(r(oLon))}`,  `origen_lat:${viewparam(r(oLat))}`,
    `destino_lon:${viewparam(r(dLon))}`, `destino_lat:${viewparam(r(dLat))}`,
  ].join(";");
  const qs = new URLSearchParams({ ...rv.parametrosFijos, viewparams: vp });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), rv.timeoutMs);
  try {
    const res = await fetch(`${base}${rv.endpointPath}?${qs}`, { signal: ctrl.signal });
    const ct = res.headers.get("content-type") || "";
    if (!res.ok || !ct.includes("json")) throw new Error(`ruta: ${res.status} ${ct}`);
    const gj = await res.json();
    if (!gj.features || gj.features.length === 0) return null;   // sin ruta trazable
    const f = gj.features[0];
    const pts = f.geometry.coordinates.flat();                   // MultiLineString -> lista de [lon,lat]
    return { coords: pts, length_m: f.properties.length_m, segmentos: f.properties.n_segmentos };
  } finally { clearTimeout(t); }
}
```

Nota: `coordinates.flat()` aplana las partes del `MultiLineString`. Si te importa el sentido, orienta `pts` comparando sus extremos con `(oLon,oLat)` / `(dLon,dLat)`.
