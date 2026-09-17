# Respuesta a `PEDIDO_BUG_RUTA_VEHICULAR.md`

Reproduje el caso exacto contra el servidor real y diagnostiqué a nivel de
datos (no sólo de la función SQL). Conclusión corta: **es la hipótesis 1**
(enganche/snap a la red vial real, no un bug de cálculo ni de caché), y ya
implementé lo que pedían en el punto 1 — la distancia de snap ahora viene en
la respuesta.

## Diagnóstico del caso reproducido

Petición exacta de `PEDIDO_BUG_RUTA_VEHICULAR.md`
(`-98.998040,19.573280 → -98.999930,19.571740`), consultada directamente en
PostGIS para separar "qué hizo la función" de "qué datos tenía disponibles":

```sql
-- vértice de la red vial más cercano a cada punto pedido
origen : id 122104, a 1491.13 m  -- POINT(-98.99696, 19.58665)
destino: id  86823, a 1552.64 m  -- POINT(-99.01373, 19.56665)

-- edges de caminos_nal_vial (la red YA filtrada a tipos viales) a menos de:
300 m del origen o destino:  0
1000 m del origen o destino: 0
1200 m: 1     1500 m: 3     2000 m: 6     3000 m: 9

-- incluso en caminos_nal SIN filtrar (1,868,648 features, todos los tipos):
lo más cercano al origen en 1500 m son un TERRAPLEN a 1108 m y una sola
PAVIMENTADA a 1165 m -- no hay nada vial a menos de ~1.1 km en ningún archivo.
```

**No hay ningún camino digitalizado (filtrado o sin filtrar) a menos de ~1.1
km de ese punto.** pgRouting hizo exactamente lo que tenía que hacer: enganchó
al vértice transitable real más cercano (a 1.49 km y 1.55 km respectivamente)
y trazó el camino más corto entre esos dos vértices — que da la ruta de 6.7 km
que reportaron. La función SQL y la caché están sanas; confirmé además que
esta respuesta se generó fresca (no es un resultado viejo repetido: el
`cache_key` de este par no existía antes de mi prueba).

**No es un caso raro o extremo.** Medí la separación al vecino más cercano
entre los ~386,700 vértices de la red nacional: mediana **467 m**, percentil
95 **1.91 km**. Un snap de 1.5 km cae cerca del p95, no fuera de la
distribución — quiere decir que van a aparecer más casos como éste en otras
zonas con densidad de digitalización baja, no sólo en este punto.

### Respuesta a los 4 puntos

1. **¿Es snapping por falta de red vial cerca?** Sí, confirmado con las
   consultas de arriba. **¿Se puede saber la distancia de enganche?** Antes
   no; ahora sí — ver siguiente sección.
2. **¿Es un bug de la función SQL para trayectos cortos?** No. Confirmé que la
   ruta se computó fresca (no caché obsoleta) y que el algoritmo de
   nodo-más-cercano hizo lo correcto dado lo que hay en los datos. El
   problema es 100% de cobertura de datos en esa zona puntual, no del código.
3. **¿La red vial en esa zona (19.57, -98.998) es conocida como incompleta?**
   No encontré ninguna nota previa sobre esa zona específica en
   `CALIDAD_DATOS.md` (ese documento sí registra, de forma general, por qué
   se filtró `caminos_nal_vial` — ver "Clasificación de los 77 valores de
   `tipo`" — pero no un mapa de huecos locales). Es un hallazgo nuevo de este
   pedido, no un gap ya documentado. Dado que el p95 nacional ya anticipa
   huecos de ~1.9 km en zonas dispersas, no lo trataría como un caso aislado a
   corregir manualmente, sino como una limitación de cobertura conocida del
   dataset `caminos_nal` en general — reportarlo como pendiente de
   digitalización es válido, pero no tengo plazo que ofrecer (es trabajo de
   captura de datos, no de este repositorio).
4. **Vértices consecutivos duplicados — ¿esperado?** Investigado a fondo:
   **no son duplicados exactos.** Extraje las coordenadas completas (sin el
   redondeo del WFS) de los pares "duplicados" reportados: p. ej. el punto 1
   es `(-98.99696230510861, 19.586651579448425)` y el punto 2 es
   `(-98.99699435443205, 19.58665626816844)` — distintos, separados por unos
   pocos metros. El **WFS serializa a ~4 decimales** (`[-98.997,19.5867]`),
   suficientemente grueso (≈11 m a esta latitud) para que dos vértices reales
   y cercanos se vean idénticos en el JSON. Es un artefacto de presentación,
   no de la geometría ni del ruteo. Igual apliqué `ST_RemoveRepeatedPoints`
   (tolerancia 0, sólo elimina duplicados exactos) del lado del servidor como
   limpieza general — no cambia este caso puntual porque, otra vez, esos
   puntos no son exactamente iguales.

## Implementado: distancia de snap en la respuesta

`db/migrations/007_routing_snap_distance.sql` (aplicado ya en esta réplica) +
actualización de la vista virtual WFS de GeoServer. La respuesta de
`simtac_general:simtac_ruta_calculada` trae ahora dos campos nuevos,
**aditivos** (no rompen nada de lo que ya leían):

```json
{ "id": 1, "length_m": 64895.84550458446, "n_segmentos": 59,
  "snap_origen_m": 12.4, "snap_destino_m": 8.1 }
```

- `snap_origen_m` / `snap_destino_m`: distancia real en metros entre el punto
  pedido y el vértice de la red vial al que se enganchó. Se calculan
  **siempre**, incluso cuando la ruta viene de caché — no dependen de cuándo
  se generó la fila cacheada.
- Verificado contra el caso reportado: `snap_origen_m: 1491.13`,
  `snap_destino_m: 1552.64` — coincide con lo calculado arriba.
- Documentado en `config/simtac-geoserver.json` →
  `rutaVehicular.respuesta.properties` y `rutaVehicular.respuesta.snapDesvioGrande`.

Con esto, **el backend ya no necesita inferir el desvío con lógica propia** —
puede leer `snap_origen_m`/`snap_destino_m` directamente de la misma
respuesta que ya consume.

## Sobre el parche provisorio (`validacionSnap`)

Con los números reales del caso confirmado, el umbral `0.5 + 1.0 *
trayecto_km` **sí rechaza correctamente** el caso reportado (desvío 1.49/1.55
km contra un umbral de 0.76 km para un trayecto de 0.26 km) y es coherente con
la distribución nacional que medí (mediana 467 m, p95 1.91 km): un desvío de
~1.5 km para un trayecto corto está fuera de lo normal, así que rechazarlo
tiene sentido.

Una observación para cuando lo ajusten: el desvío de snap depende de la
**densidad de la red cerca de ese punto específico**, no de qué tan largo sea
el trayecto — por eso escalar el umbral con `distanciaTrayecto` funciona bien
como aproximación (un trayecto largo típicamente cruza zonas más dispersas),
pero en el límite permite un desvío enorme para trayectos muy largos sin
límite superior. Ahora que `snap_origen_m`/`snap_destino_m` vienen en la
respuesta, pueden simplificar a un tope absoluto, o mantener la fórmula actual
pero con un techo, p. ej. `min(4, 0.5 + 1.0 * trayecto_km)` km — evita que un
movimiento de 50 km acepte sin más un desvío de 50 km. Es su decisión de
producto, no algo que necesite cambiar de este lado.

## Qué NO cambié

- El contrato de `viewparams` y el resto del shape de la respuesta: igual que
  antes, sólo se agregaron los dos campos nuevos.
- No toqué `caminos_nal` ni `caminos_nal_vial` (sería una operación de datos,
  no de código, y no me pidieron eso).
- El bug de caché de `PEDIDO_CONFIG_GEOSERVER.md` (007 se construye sobre 006,
  conserva el `ON CONFLICT`) sigue corregido.
