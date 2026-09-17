# Pedido: la ruta vehicular real (`simtac_ruta_calculada`) devuelve trayectos que se alejan kilómetros del origen/destino pedidos

## Contexto

Como se acordó en `PEDIDO_CONFIG_GEOSERVER.md` / `RESPUESTA_PEDIDO_CONFIG_GEOSERVER.md`, el backend Node del SIMTAC (`nodejs/src/services/rutaVehicularService.js`) ya consume `simtac_general:simtac_ruta_calculada` para resolver **todo** el movimiento terrestre del motor de ejercicio (`entidad:mover` — infantería y vehículos `tierra`/`anfibio`), sin fallback: si la ruta que devuelve GeoServer no tiene sentido, la entidad se mueve mal en el ejercicio en curso.

Reportaron que, en algunos ejercicios, las entidades hacen **saltos raros al moverse**: pasan dos veces por el mismo punto, retroceden a un punto anterior, o el trayecto se traza por donde no debería ser posible. Reproduje uno de esos casos contra el servidor real (no es una sospecha, es el `GetFeature` real de hoy) y el resultado confirma que el problema está del lado del cálculo de ruta, no de cómo el backend lo consume.

## Caso reproducido

**Origen**: `(-98.99804, 19.57328)` — **Destino**: `(-98.99993, 19.57174)`.

Distancia en línea recta entre esos dos puntos: **0.26 km**. Es un movimiento corto, del tipo que una unidad hace todo el tiempo dentro de un ejercicio.

Petición exacta:

```
GET {geoserver}/wfs?service=WFS&version=2.0.0&request=GetFeature
  &typeName=simtac_general:simtac_ruta_calculada&outputFormat=application/json
  &viewparams=origen_lon:-98.998040;origen_lat:19.573280;destino_lon:-98.999930;destino_lat:19.571740
```

Respuesta: `HTTP 200`, `FeatureCollection` con 1 feature, `MultiLineString` de 1 sola parte, 33 puntos.

```json
{ "id": 1, "length_m": 6744.962312149581, "n_segmentos": 4 }
```

**El problema**: la ruta devuelta mide **6.7 km** para un trayecto de 260 m en línea recta, y sus extremos no coinciden ni de cerca con lo pedido:

| | pedido | devuelto por la ruta | distancia entre ambos |
|---|---|---|---|
| Origen | `(-98.99804, 19.57328)` | `(-98.99700, 19.58670)` (primer punto) | **1.50 km** |
| Destino | `(-98.99993, 19.57174)` | `(-99.01370, 19.56670)` (último punto) | **1.55 km** |

O sea: para ir de A a B (260 m), la ruta arranca 1.5 km al norte de A, serpentea 6.7 km, y termina 1.55 km al suroeste de B. Del lado del backend esto es exactamente el síntoma reportado: como `entidad:mover` antepone el origen real y agrega el destino real como primer/último waypoint (para que el trayecto arranque y termine donde la entidad está de verdad — ver `rutaVehicularService.js`), el resultado que ve el usuario es la entidad **saltando ~1.5 km lejos de donde está, dando un rodeo de 6.7 km, y volviendo** — el "salto raro"/"retroceso" que reportaron.

Los 33 puntos completos de esta respuesta, por si ayuda a ubicar el tramo en el mapa:

```json
[[-98.997,19.5867],[-98.997,19.5867],[-98.9962,19.5877],[-98.9959,19.5884],
 [-98.996,19.5886],[-98.9968,19.5888],[-98.9981,19.5892],[-98.9988,19.5892],
 [-98.9992,19.5893],[-99.0037,19.5908],[-99.0087,19.5923],[-99.013,19.5935],
 [-99.0154,19.5941],[-99.0168,19.595],[-99.0179,19.5959],[-99.0183,19.5963],
 [-99.0183,19.5963],[-99.0185,19.5966],[-99.0196,19.5953],[-99.0213,19.5927],
 [-99.0231,19.5897],[-99.0237,19.5886],[-99.024,19.5882],[-99.0242,19.5878],
 [-99.0262,19.5841],[-99.0257,19.5833],[-99.0253,19.5825],[-99.0244,19.5808],
 [-99.0238,19.5797],[-99.0198,19.5744],[-99.0177,19.5717],[-99.0148,19.568],
 [-99.0137,19.5667]]
```

## Segundo hallazgo, más chico, en la misma respuesta

Vértices consecutivos duplicados: índices `0`-`1` y `15`-`16` son exactamente el mismo punto. Ya lo veníamos viendo en otras rutas al hacer pruebas generales (11 a 34 duplicados consecutivos por ruta, en pares que sí caían cerca de lo pedido) — probablemente un artefacto de cómo se concatenan los tramos de la red vial al armar la geometría. Esto no rompe el movimiento de nuestro lado (`rutaVehicularService.js` lo filtra antes de entregar los waypoints al motor), pero lo menciono porque puede ser síntoma del mismo problema de fondo que el caso principal.

## Lo que necesito que confirmen o investiguen

1. **¿Es un problema de snapping a la red vial?** Sospecho que cerca de `(-98.998, 19.573)` no hay ningún segmento de la red digitalizada (zona rural/sin caminos menores cargados), y pgRouting está snapeando origen y destino al nodo transitable más cercano — que en este caso queda a 1.5 km. Si es así, ¿hay forma de saber (desde la respuesta, o desde otro endpoint) a qué distancia quedó el snapping, para que el backend pueda rechazar o advertir cuando el desvío es demasiado grande respecto al trayecto pedido?
2. **¿O es un bug en la función SQL/vista** (`simtac_calcular_ruta_resumen` u otra) para trayectos cortos específicamente — por ejemplo, que el algoritmo de nodo-más-cercano falle o traiga un resultado obsoleto de caché cuando origen y destino están muy próximos entre sí?
3. Si es lo primero (snapping real por falta de red vial en la zona): ¿la cobertura de la red vial digitalizada en esa área (`19.57`, `-99.00`, cerca de CDMX) es conocida como incompleta, o debería haber caminos ahí? Si falta digitalizar, ¿hay un plazo o hay que reportarlo como dato faltante en otro lado?
4. Sobre los vértices duplicados consecutivos (hallazgo secundario): ¿es esperado por cómo se arma la geometría al unir tramos, o también apunta a un problema de la red?

## Qué NO estoy pidiendo

No pido que cambien el contrato de la API (`viewparams`, shape de la respuesta) — eso ya está andando bien para trayectos largos, como confirmamos en `RESPUESTA_PEDIDO_CONFIG_GEOSERVER.md`. Esto es puntual al comportamiento en trayectos cortos / zonas con red vial dispersa.

## Mientras tanto, del lado del backend

Mientras se diagnostica, agregué una validación provisoria en `rutaVehicularService.js` (`config/simtac-geoserver.json` → `rutaVehicular.validacionSnap`): se rechaza la ruta si el desvío de enganche en origen o destino supera `baseKm + factorTrayecto * distanciaDelTrayecto` (por defecto `0.5 + 1.0 * trayecto_km`). Con ese umbral, el caso reportado arriba se rechaza con margen (desvío 1.50/1.55 km contra un umbral de 0.76 km), y probé que **no** rechaza casos largos legítimos con snapping naturalmente grande — por ejemplo un trayecto de 15.8 km por zona de cerro dio 1.97 km de desvío por extremo y pasó, porque el umbral escala con la distancia del trayecto.

Es un parche, no una solución: si el diagnóstico determina que es un problema real de datos (red vial no digitalizada en ciertas zonas), este umbral solo evita que la entidad se mueva mal, pero para esas zonas seguirá sin poder trazarse ninguna ruta. Avisen si el número (`baseKm`/`factorTrayecto`) tiene sentido con lo que encuentren, o si conviene ajustarlo.
