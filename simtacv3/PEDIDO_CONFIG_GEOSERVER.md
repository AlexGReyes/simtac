# Pedido: archivo de configuración para que el backend Node consuma el cálculo de ruta (pgRouting)

## Contexto

El backend Node del SIMTAC (`nodejs/src/services/rutaService.js`) resuelve
movimiento terrestre hoy con su propia lógica: busca, entre las rutas que
carga el administrador a mano en la tabla `rutas` (polilíneas dibujadas en
el mapa), la de menor desvío entre origen y destino, y si el ejercicio no
tiene ninguna cargada cae a línea recta. No usa red vial real ni pgRouting
para nada — es standalone, sin dependencias externas, y así fue diseñado.

Ya integraron el cálculo de ruta vehicular real por pgRouting del lado de
GeoServer (`simtac_general:simtac_ruta_calculada`, documentado en
`INTEGRACION_RED_LOCAL_MAC.md` §7 y `INTEGRACION_SIMTAC_GEOSERVER.md`), pero
hoy **solo lo consume el cliente Tauri directo por WFS**, sin pasar por el
backend Node. La idea es que el backend Node pueda consultarlo también (para
que el motor de movimiento use la ruta real en vez de la heurística de
`rutas`), y para eso necesito de ustedes un **archivo de configuración**,
no solo la documentación de la API — ya la tengo, está en los dos documentos
de arriba. Lo que falta es lo que **cambia según el despliegue** y hoy no
está en ningún lugar que un proceso pueda leer.

## Por qué un archivo y no hardcodear la URL

Ya nos pasó una vez (documentado en `backend.md`, punto 21): el mismo
GeoServer perdió conectividad una sesión entera porque su IP de Wi-Fi
(`10.40.0.24`) es DHCP y el lease cambió de dueño. El backend Node tiene el
mismo problema de fondo del lado de la IP propia. No quiero que
`rutaService` (o el servicio nuevo que lo reemplace/complemente) tenga la
URL de GeoServer escrita en el código: necesito poder leerla de un archivo
que ustedes mantengan actualizado, igual que el cliente Tauri ya resuelve su
propio `backend` desde `config.js`.

## Qué pido exactamente

Un archivo de configuración (JSON), con la forma que propongo abajo —
cambien nombres/estructura si les calza mejor con cómo ya versionan el resto
de la integración, lo único que importa es que sea **leíble por un proceso**
y esté siempre al día con el despliegue vigente:

```json
{
  "geoserver": {
    "baseUrl": "http://172.200.1.17:3001/geoserver",
    "baseUrlAlt": "http://10.40.0.24:3001/geoserver",
    "actualizado": "2026-09-10T00:00:00Z"
  },
  "rutaVehicular": {
    "workspace": "simtac_general",
    "typeName": "simtac_general:simtac_ruta_calculada",
    "service": "WFS",
    "version": "2.0.0",
    "outputFormat": "application/json",
    "viewparams": {
      "origen_lon": "número, 6 decimales",
      "origen_lat": "número, 6 decimales",
      "destino_lon": "número, 6 decimales",
      "destino_lat": "número, 6 decimales"
    },
    "timeoutMs": 60000,
    "auth": null
  }
}
```

Puntos concretos que necesito que confirmen o completen, porque no los
tengo del lado del backend (si ya están en algún doc que se me haya pasado,
me pasan la referencia y listo):

1. **Cuál de las dos URLs (Wi-Fi/Ethernet) debe usar el backend Node**, o si
   deberíamos apuntar los dos a un nombre DNS de LAN cuando exista uno —
   nuestro punto 21 propone lo mismo del lado del backend, así que si ya
   están evaluando darle un nombre fijo al Mac, avisen y unificamos.
2. **Shape exacto de la respuesta** de `simtac_ruta_calculada`: confirmo que
   es un `FeatureCollection` GeoJSON con una única `LineString` en
   `features[0].geometry.coordinates` (`[lon, lat]` por punto) — necesito
   saber si además trae `properties` con distancia/duración calculada, o si
   eso lo sigue calculando el backend con haversine sobre los puntos que
   devuelva la geometría.
3. **Qué hacer con el bug de caché conocido** (`HTTP 400 duplicate key ...
   simtac_ruta_cache_pkey` al repetir el mismo par de coordenadas a 6
   decimales con más de 7 días de antigüedad): ¿hay fecha para el `ON
   CONFLICT`, o el backend tiene que armar un workaround (reintentar con un
   jitter de coordenadas, o hay un endpoint para invalidar esa fila puntual)?
4. **Límite de throughput real**: el motor de movimiento del backend puede
   pedir una ruta por cada unidad terrestre que arranca una orden, no por
   cada tick — pero si varios jugadores mueven unidades casi al mismo
   tiempo puede haber varios `GetFeature` concurrentes. ¿Hay un máximo de
   requests concurrentes recomendado, o el servicio aguanta sin problema la
   carga de un ejercicio típico (siguiendo el orden de magnitud de
   `frontend.md`, decenas de unidades, no cientos)?
5. **Confirmación de que sigue sin credenciales** para este endpoint
   puntual (`/geoserver/wfs`, no `/geoserver/rest`) llamado servidor a
   servidor, no solo desde navegador — el documento de red dice que el CORS
   ya está en `*`, pero eso no dice nada sobre si hace falta un token para
   tráfico que no viene de un browser.

## Qué NO estoy pidiendo

No pido que cambien nada de cómo el cliente Tauri consume GeoServer hoy
(eso sigue funcionando igual, directo por WFS). Tampoco pido mover el
cálculo del lado del backend — al contrario, la idea es que el backend
llame al mismo servicio que ya usa el cliente, no que lo reimplemente.

## Cómo se usaría

Con ese archivo, `rutaService` (o un servicio nuevo, `rutaVehicularService`,
si se prefiere no mezclarlo con la lógica actual de la tabla `rutas`) haría
el mismo `GetFeature` que ya está armado en `INTEGRACION_RED_LOCAL_MAC.md`
§9.4, leyendo `baseUrl`/`timeoutMs`/etc. de este archivo en vez de tenerlos
fijos en el código — mismo patrón que ya usa el cliente para su propio
`config.js`.
