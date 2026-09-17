# Rutas y movimientos: versión coordinada 2026-09-17

El cliente usa una ruta canónica del backend para dibujar y animar. No conecta
extremos por proximidad ni interpola una cuerda entre ticks. Hay una sola capa por
entidad, incluso al recibir inicio y ACK duplicados. La llegada termina su animación
antes de retirar la capa; cancelación, desconexión y cambio de estado la limpian.

El backend compatible debe enviar `serverEpoch`, `ejercicio_id`, `generation`,
`movementId`, `routeId`, `sequence` y `revision`; el snapshot agrega `revision` y
`movimientos`. Durante la sincronización se retienen eventos y sólo se reproducen
los posteriores a la revisión del snapshot. No se acepta el servidor anterior,
otro ejercicio, progreso regresivo ni geometría de otra generación.

Los accesos calculados se reciben en los mismos waypoints con `segmentos`
(`kind`, `fromIndex`, `toIndex`, `evidence`). Se dibujan en ámbar discontinuo; la
parte vial conserva su color de bando. Si el backend rechaza cualquier acceso,
se informa la causa y no se inicia movimiento. Los anfibios usan cálculo validado:
el modo libre no sirve para saltarse las reglas de cruce.

## Verificación

```sh
npm ci
npm run test:movimiento
node pruebas/config.mjs
node pruebas/config-geoserver.mjs
npx playwright install chromium
```

La integración requiere el stack local GeoServer/PostGIS, el evaluador de terreno
y el backend corregido. Desde `simtac-geoserver`:

```sh
sh tools/routing/test_browser.sh
```

El script inicia un servidor desechable con los handlers reales de movimiento y
estado temporal; sólo el arnés de pruebas proporciona identidades sintéticas.
No desactiva la autenticación del backend desplegado. Dos usuarios/visores reciben
la ruta real Toreo–Toluca a 80 km/h. Se verifican geometría, distancia, curvas por
frame, llegada, cancelación, reconexión y rechazo de accesos desconocidos. Una
segunda prueba abre el login de la aplicación desplegada y comprueba la API.

Evidencia local: `test-results/toreo-toluca.png`. La suite exige el cliente web
local en `http://127.0.0.1:8082`; `SIMTAC_BROWSER_URL` selecciona el arnés aislado.
El cliente web ejecuta estos mismos módulos y OpenLayers. No se ha compilado ni
certificado un instalador Tauri nativo en esta máquina (no tiene Rust/Cargo).

## Caso del operador y alcance

Toreo aproximado `(-99.219119444, 19.454719444)` hacia Plaza de los Mártires
`(-99.65691, 19.292551)`, batallón de infantería a 80 km/h. La porción vial mide
63.1489 km en el modelo esférico del motor, con 695 vértices. La prueba completa
de esa porción usa reloj simulado; las ventanas del navegador usan tiempo real.

Los puntos pedidos requieren accesos de aproximadamente 197 m y 1.84 km.
El acceso inicial no cuenta con evidencia suficiente bajo las reglas actuales;
por ello la orden completa se rechaza sin mover la unidad. No confundir la prueba
vial aceptada entre nodos con un viaje completo aprobado desde esos puntos.
Las reglas son de simulación con cartografía estática, no una certificación de
transitabilidad física actual.
