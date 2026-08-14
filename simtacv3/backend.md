# backend.md — Lo que el frontend necesita del backend

Pedidos del cliente (Tauri + vanilla JS, repo `simtacv3`) al servidor Node de
simulación. Complementa a `API.md` (contrato REST actual), `frontend.md`
(contrato por fases) y `DATABASE.md` (esquema): acá va **solo lo que todavía no
existe**, con el porqué y una propuesta concreta de contrato.

Cada ítem dice qué hace hoy el frontend para compensar la falta, así que también
sirve de checklist de qué código del cliente se puede borrar cuando esté hecho.

**Estado:** actualizado 10-08-2026. Los puntos 1–20 están **cubiertos**. El
**punto 19 — boletines dirigidos a un solo bando** y el **punto 20 — hora
táctica autoritativa del servidor** se implementaron el mismo día que se
agregaron a este documento: `boletin:enviar` ya acepta `bando` opcional y
acota la emisión a la room del bando cuando se manda; y `hora_tactica` ya es
un campo autoritativo del estado del ejercicio, avanzado por el motor,
pausable/ajustable a mano por el administrador, con `velocidad_ejercicio`
como entero de efecto inmediato.

Los puntos 1, 2, 3, 4 y 5 resultaron ya estar implementados en
el servidor (releyendo el código, no eran huecos reales, o ya se habían
cerrado sin que este documento se actualizara). Los puntos 6, 7 y 8 estaban
**implementados** — `frontend.md` ya los documenta con el contrato real, que
en 7 y 8 salió distinto al propuesto acá. El punto 9 original estaba **mal
diagnosticado**: no era un hueco del backend, era el cliente usando el
endpoint REST en vez del evento de socket que `frontend.md` ya documentaba.
El punto 10 se confirmó resuelto en vivo (`GET /vehiculos` ya carga). El
punto 11 — el más urgente — ya está corregido: alta/edición de vehículo por
REST convergen en caliente con el motor, y reanudar un ejercicio reconcilia
contra la base sin pisar el progreso en curso. El punto 12 fue
el último en cerrarse antes del 13/14: reposicionar a mano una unidad o un
vehículo portador rebasea en cascada (directo y transitivo) a los vehículos
que cuelgan de él.

Punto 18 (07-08-2026): logística de unidades/vehículos — km recorridos,
munición y autonomía consumidas/repuestas, bajas propias e infligidas,
unidades y vehículos propios/enemigos destruidos, y una acción de
**recarga** que hoy no puede pedir un jugador. **Todo el estado nuevo que
pide este punto vive únicamente en el JSON del ejercicio** (el mismo
archivo donde ya viven `efectivo`, `distancia_recorrida`, `danio_acumulado`,
etc.) — nada de tablas ni columnas nuevas en Postgres. **Implementado el
mismo día** — ver el detalle en su sección.

| # | Necesidad | Prioridad | Estado |
|---|---|---|---|
| 1 | Baja de entidad en el ejercicio en vivo | ~~P1~~ hecho | `unidad:eliminar_del_ejercicio` / `vehiculo:eliminar_del_ejercicio` + eventos `ejercicio:*_eliminad[ao]` |
| 2 | Que la baja llegue al archivo de estado | ~~P1~~ hecho | `bajaEntidadService.darDeBaja` persiste de inmediato, sin esperar el intervalo de checkpoint |
| 3 | `GET /unidades?ejercicioId=` | ~~P2~~ hecho | Existe, con `bando` resuelto |
| 4 | Participantes de varios ejercicios en un pedido | ~~P2~~ hecho | `GET /participantes`, plano con `ejercicio_id`/`ejercicio_nombre` |
| 5 | `POST /usuarios` 👑 con `rol` | ~~P3~~ hecho | Existe, `rol` opcional con default `jugador` |
| 6 | Posición base separada de la actual | ~~P1~~ hecho | `posicion_base_x/y` ya existe (`frontend.md`, fase 2 y 3) |
| 7 | Bando derivado: borrar la columna | ~~P1~~ hecho | `bando` ya se rechaza como input y vuelve resuelto en `GET` |
| 8 | Cardinalidad de las asignaciones | ~~P1~~ hecho, contrato distinto | `unidad_padre_tipo`/`unidad_padre_id`, no el `CHECK` propuesto acá |
| 9 | ~~Alta de vehículo en el ejercicio en vivo~~ | resuelto | Era un bug del cliente: no usaba `vehiculo:crear_en_ejercicio` |
| 10 | ~~`GET /vehiculos` rompía: `column vm.nombre does not exist`~~ | resuelto | Confirmado 04-08-2026: el catálogo ya carga |
| 11 | Reiniciar el ejercicio no reseedea vehículos (sí unidades) | ~~P1~~ hecho | Alta/edición por REST convergen en caliente + reconciliación no destructiva al reanudar |
| 12 | La base de un vehículo hijo no sigue a la de su padre al moverse | ~~P2~~ hecho | Reposicionar a mano rebasea en cascada, directo y transitivo, sin tocar la base del padre |
| 13 | Vehículos aire: ruta base→base, base editable por el usuario y ataque atado al movimiento | ~~P1~~ hecho | Las tres piezas de servidor están, ver detalle abajo |
| 14 | "Volver a base" de un vehículo aire no respeta su `velocidad_desplazamiento` | ~~P1~~ hecho | Bug real en `forzarBaseAireEnWaypoints` (punto 13a), corregido — ver detalle abajo |
| 15 | `combate:retirarse` no reordena movimiento de vuelta al origen | ~~P2~~ hecho | El motor retiene el tramo recorrido al frenar por combate y lo retoma invertido al retirarse |
| 16 | Eventos de combate emitidos a toda la room, no acotados a quien corresponde | ~~P2~~ hecho | Ahora van a los controladores de las dos entidades (+ administradores), no a toda la room |
| 17 | `detectado_por[]` marca observadores fuera de su `rango_vision_m` | ~~P1~~ hecho | Causa real: los motores no sobrevivían a un restart del proceso — ver detalle abajo |
| 18 | Logística: km/munición/autonomía, bajas, destruidos y recarga | ~~P2~~ hecho | `autonomia_actual` separado del odómetro, `logistica:recargar`, y un bloque `logistica{}` acumulado por el motor — ver detalle abajo |
| 19 | Boletines dirigidos a un solo bando | ~~P2~~ hecho | `boletin:enviar` acepta `bando` opcional; con él, emite solo a `ejercicio_{id}_bando_{bando}` |
| 20 | Hora táctica autoritativa del servidor | ~~P2~~ hecho | `hora_tactica` en el estado, avanzada por el `CombateEngine`, pausable con el ejercicio, ajustable a mano (`ejercicio:establecer_hora_tactica`) y `velocidad_ejercicio` entero de efecto inmediato — ver detalle abajo |

Los puntos 1 a 20 quedan acá **como historial** — no queda trabajo
pendiente **del lado del backend** en este documento.

**Auditoría 10-08-2026:** se releyó el código actual de `src/` (el frontend
tuvo una reescritura grande en módulos, sin commitear todavía) contra cada
"Qué hizo/hace el frontend" de este documento. La mayoría sigue exacta.
Se encontraron y corrigieron tres afirmaciones desactualizadas (puntos 7, 13
y 18 — detalle en sus secciones) y cuatro casos donde el backend ya resolvió
su parte pero **el cliente todavía no migró** al camino nuevo, así que sigue
corriendo el workaround viejo (puntos 1, 3, 4 y 5 — marcados con ⚠️ en sus
secciones). Ninguno es un hueco de backend nuevo; son líneas del propio
checklist de este documento ("qué código del cliente se puede borrar cuando
esté hecho") que quedaron sin tachar.

---

## 1 · Baja de una entidad del ejercicio en vivo — ~~P1~~ hecho

### Actualización 04-08-2026 — implementado

`unidad:eliminar_del_ejercicio` y `vehiculo:eliminar_del_ejercicio` existen
(`src/sockets/handlers/unidadHandler.js`), con el shape de acá abajo: ack
`{ entidad_tipo, entidad_id, vehiculos_eliminados }` y los eventos
`ejercicio:unidad_eliminada` / `ejercicio:vehiculo_eliminado` a la room del
ejercicio. La limpieza (trayectos, combates, `detectado_por[]`) y la
simetría con `DELETE /unidades|vehiculos/:id` también están —
`bajaEntidadService` es el único camino para ambos, tal como pedía la
"simetría útil" de más abajo. Falta que el cliente cambie
`unidad:modificar { visible: false }` por este evento (ver "Qué hace el
frontend mientras tanto").

### El problema (histórico)

El socket tiene alta y edición en caliente, pero **no tiene baja**. En la tabla
de eventos de `frontend.md` (fase 8) están `unidad:crear_en_ejercicio` y
`unidad:modificar`, y del lado servidor→cliente `ejercicio:unidad_creada` y
`ejercicio:unidad_modificada`. No hay ningún `eliminar` ni
`ejercicio:unidad_eliminada`.

Consecuencia: cuando el administrador borra una unidad desde el panel de
administración, `DELETE /unidades/:id` borra la fila de la base, **pero la
unidad sigue dibujada en el mapa de todos los clientes conectados**, sigue
detectando, sigue pudiendo ser fijada como blanco y sigue apareciendo en los
paneles. El ejercicio queda operando sobre una entidad que ya no existe.

Es peor con las plantillas: borrar una `unidad_militar_base` cascadea a **todas**
sus instancias (`DATABASE.md`, sección de cascadas), así que un solo borrado
puede dejar decenas de unidades fantasma.

Aplica igual a vehículos: `config-catalogos.js:733` ya le promete al usuario
*"El vehículo desaparece del ejercicio y de su unidad"* — hoy eso es falso.

### Propuesta

```js
// cliente → servidor (👑)
socket.emit("unidad:eliminar_del_ejercicio", {
  ejercicio_id: 7,
  entidad_id: 11,
}, (res) => {
  // { ok: true, entidad_tipo: "unidad", entidad_id: 11,
  //   vehiculos_eliminados: [4, 5] }   // los que colgaban de ella
});

socket.emit("vehiculo:eliminar_del_ejercicio", { ejercicio_id: 7, entidad_id: 4 }, cb);
```

```js
// servidor → cliente, room `ejercicio_{id}`
socket.on("ejercicio:unidad_eliminada",  ({ entidad_id, vehiculos_eliminados }) => {});
socket.on("ejercicio:vehiculo_eliminado", ({ entidad_id }) => {});
```

Qué tendría que hacer el servidor al recibirlo:

1. Sacar la entidad del estado en memoria del ejercicio (y sus vehículos
   anidados, si es una unidad).
2. Cortar lo que la referencie: trayectos en curso, combates abiertos, y
   quitarla de los `detectado_por[]` de las demás entidades. Si era el único
   observador de un enemigo, ese enemigo vuelve a la niebla.
3. Emitir el evento a la room del ejercicio.
4. Persistirlo (ver punto 2).

**Simetría útil:** el borrado por REST y el borrado en caliente deberían
converger. Lo ideal es que `DELETE /unidades/:id` dispare internamente lo mismo
si la unidad está en un ejercicio corriendo, y así el cliente no tiene que
acordarse de hacer las dos cosas. Si preferís mantenerlos separados, avisá y el
frontend encadena las dos llamadas.

### Qué hace el frontend mientras tanto

`admin.js` → `bajaEnElEjercicio()`:

- Emite `unidad:modificar { visible: false }` — es lo único de la lista blanca
  que se le parece. La unidad deja de dibujarse y de detectar en todos los
  clientes, pero **sigue en el estado**.
- Llama a `Store.quitarUnidad(id)` (`store.js`), que la saca del estado local y
  redibuja el mapa. Solo corrige **el cliente que hizo el borrado**; el resto
  depende del `visible: false`.

⚠️ **Pendiente de migrar (confirmado 10-08-2026):** el evento ya existe del
lado del servidor desde el 04-08-2026 (ver arriba), pero `src/` todavía no lo
usa — no hay ninguna referencia a `unidad:eliminar_del_ejercicio`,
`vehiculo:eliminar_del_ejercicio` ni `ejercicio:unidad_eliminada` en el
código actual (grep vacío). `admin.js` → `bajaEnElEjercicio()` (`admin.js:1532-1551`)
sigue dando de baja con `unidad:modificar { visible: false }` seguido de
`Store.quitarUnidad(item.id)`, tal como describe esta sección — y solo para
unidades: no hay un camino equivalente para dar de baja en caliente un
vehículo suelto (no anidado en una unidad borrada), porque `Store` no tiene
un `quitarVehiculo()` independiente, solo el que remueve unidad + vehículos
anidados. Migrar implica: cambiar la emisión por
`unidad:eliminar_del_ejercicio`/`vehiculo:eliminar_del_ejercicio`, agregar
listeners de `ejercicio:unidad_eliminada`/`ejercicio:vehiculo_eliminado`, y
agregar el `quitarVehiculo()` independiente que hoy falta en `store.js` para
el caso vehículo-suelto. Es la línea del checklist que este documento
promete en su introducción ("qué código del cliente se puede borrar cuando
esté hecho"), y hoy sigue sin borrarse.

---

## 2 · Que la baja llegue al archivo de estado — ~~P1~~ hecho

### Actualización 04-08-2026 — implementado

`bajaEntidadService.darDeBaja` sobreescribe siempre el archivo **principal**
al dar de baja (`fileService.guardar`, sin esperar `CHECKPOINT_INTERVALO_MS`),
así que un `ejercicio:iniciar` que reanuda no resucita la entidad. Se tomó la
decisión "razonable" que proponía este punto: los checkpoints anteriores al
borrado quedan intactos, y `ejercicio:cargar_estado` a uno de ellos sí trae de
vuelta la entidad — es historia, y el rebobinado la necesita.

### El problema (histórico)

`frontend.md:593` dice: *"`iniciar` genera el JSON desde la base **la primera
vez**; si el archivo ya existe reanuda el ejercicio tal como quedó."*

O sea que el archivo de estado y la base **divergen y nunca se reconcilian**.
Una unidad borrada de la base sigue en el archivo, y al reanudar el ejercicio
**vuelve al mapa**. No se autocorrige: no alcanza con borrar la fila.

Lo mismo vale para el rebobinado, que ya está documentado como trampa conocida
en `frontend.md` (fase 8): *"Retroceder un estado NO revierte la base de datos"*.
Es la misma divergencia mirada desde el otro lado.

### Propuesta

Que el handler del punto 1 escriba el estado ya sin la entidad (un checkpoint
inmediato, sin esperar el `CHECKPOINT_INTERVALO_MS`), para que un reanudar o un
`cargar_estado` posterior no la resucite.

Queda a criterio del backend qué pasa con los checkpoints **anteriores** al
borrado: lo razonable es dejarlos intactos (son historia, y el rebobinado los
necesita) y aceptar que retroceder a un punto previo traiga de vuelta una
entidad borrada. Si se decide eso, alcanza con documentarlo y el frontend lo
avisa en la UI del rebobinado.

No hay forma de hacer esto desde el cliente: los archivos de estado los escribe
el backend y el socket solo los expone para *listar*, *cargar* y *rebobinar*.

---

## 3 · `GET /unidades?ejercicioId=` — ~~P2~~ hecho

### Actualización 04-08-2026 — implementado

`GET /unidades?ejercicioId=` existe (`src/routes/unidades.js`), con `bando`
resuelto en cada fila como pedía la propuesta. Sin el parámetro, devuelve
todas con `bando: null`.

⚠️ **Pendiente de migrar (confirmado 10-08-2026):** igual que el punto 1, el
cliente todavía no usa lo que ya existe. `api.js:203-204` —
`unidades: { listar: () => get('/unidades') }` — nunca manda `ejercicioId`,
a diferencia de `vehiculos.listar(ejercicioId)` (`api.js:240`), que sí lo
soporta desde que se implementó ahí. `admin.js` sigue con el patrón N+1 que
describe el problema histórico de abajo: `cargarControladores`
(`admin.js:299-311`, un `GET /unidades/:id/usuarios` por unidad),
`acotarUnidades` (`admin.js:352-358`) y el cache `this.controladores`
(`admin.js:32`, invalidado en `invalidarControladores`, `admin.js:313-315`).
Migrar a `unidades.listar(ejercicioId)` con `bando` ya resuelto dejaría
borrar esas ~60 líneas, tal como prometía este punto en su momento.

### El problema (histórico)

`unidad_militar` no tiene columna `ejercicio`. Para saber qué unidades están en
un ejercicio hay que cruzar sus controladores (`unidad_militar_usuario`) con los
participantes (`ejercicio_usuario`). `DATABASE.md:286` lo dice explícitamente:
*"no hay un endpoint que lo haga en un solo paso todavía; avisar si hace falta"*.

**Hace falta.** Hoy `admin.js` (`cargarControladores`) hace **un
`GET /unidades/:id/usuarios` por cada unidad** para armar el cruce en el
cliente. Con 50 unidades son 51 requests para pintar una tabla. Está cacheado en
memoria, pero se invalida en cada alta, baja o cambio de asignación.

El backend **ya resuelve esto para vehículos**: `GET /vehiculos?ejercicioId=`
existe y filtra del lado del servidor (`api.js:240`). Es la misma consulta, solo
que para unidades no está.

### Propuesta

```
GET /unidades?ejercicioId=7      🔒
```

Mismo shape que `GET /unidades`, filtrado a las unidades controladas por algún
participante del ejercicio. Sin el parámetro, comportamiento actual (todas).

Ideal, si sale barato en el `JOIN`: agregar `bando` a cada unidad de la
respuesta, resuelto desde el bando del controlador. El cliente lo necesita para
colorear el símbolo y hoy lo deduce por su cuenta.

Se borra: `cargarControladores`, `acotarUnidades`, `participantesDelContexto` y
el cache `this.controladores` de `admin.js` (~60 líneas).

---

## 4 · Participantes de varios ejercicios en un pedido — ~~P2~~ hecho

### Actualización 04-08-2026 — implementado

`GET /participantes` existe (`src/routes/participantes.js`): vista plana de
`ejercicio_usuario` con `ejercicio_id`/`ejercicio_nombre` en cada fila, y
acepta `?ejercicioId=` opcional para filtrar. La primera de las dos opciones
propuestas.

⚠️ **Pendiente de migrar (confirmado 10-08-2026):** mismo caso que los
puntos 1 y 3. `admin.js:618` (`loadParticipantes()`) sigue pidiendo
`GET /ejercicios` y recorriendo cada uno con
`GET /ejercicios/${ejercicio.id}/participantes` (`admin.js:640-644`); no hay
ninguna llamada a `/participantes` en `src/`. Migrar a la vista plana
elimina el bucle N+1.

### El problema (histórico)

`admin.js` → `loadParticipantes()` recorre los ejercicios y hace un
`GET /ejercicios/:id/participantes` **por cada uno** para poder mostrar la tabla
de participantes sin filtro de ejercicio.

### Propuesta

Cualquiera de las dos alcanza:

```
GET /participantes                🔒   // todos, con ejercicio_id en cada fila
GET /ejercicios?incluir=participantes  🔒
```

Con el `ejercicio_id` y el nombre del ejercicio ya en cada fila, para no tener
que volver a cruzar en el cliente.

---

## 5 · `POST /usuarios` 👑 con `rol` — ~~P3~~ hecho

### Actualización 04-08-2026 — implementado

`POST /usuarios` existe (`src/routes/usuarios.js`) con exactamente el shape
propuesto: `rol` opcional (default `"jugador"` vía columna), `409` si el
usuario existe, `400` si faltan campos o `rol` no es válido. `POST
/auth/register` sigue sin aceptar `rol`.

⚠️ **Pendiente de migrar (confirmado 10-08-2026):** `admin.js` →
`createRecord()` sigue con el patrón de dos llamadas (registrar +
`PUT /usuarios/:id { rol }`) descrito abajo — no usa `POST /usuarios`
todavía, así que la ventana de "usuario a medio crear" que motivó este
punto sigue existiendo en la práctica. Prioridad baja (P3), no es urgente.

### El problema (histórico)

No existe `POST /usuarios`. El alta es `POST /auth/register`, que es **público**
y por diseño no deja elegir `rol` — siempre nace `jugador`. Para dar de alta un
administrador desde el panel hay que hacer dos llamadas: registrar y después
`PUT /usuarios/:id { rol: "administrador" }`.

Es lo que hace hoy `admin.js` → `createRecord()`. Funciona, pero deja una
ventana en la que el usuario existe con el rol equivocado, y si el `PUT` falla
queda a medio crear sin forma automática de deshacerlo.

### Propuesta

```
POST /usuarios   👑
{ "usuario": "jperez", "password": "clave123", "nombre": "Juan Perez",
  "grado": "Capitan", "rol": "administrador" }
```

`201` con el mismo shape que `GET /usuarios/:id`. `rol` opcional, default
`"jugador"`. Los mismos errores que `register` (`409` si el usuario existe,
`400` si faltan campos) más `400` si `rol` no es válido.

`POST /auth/register` se queda como está: es el alta pública, otro caso de uso.

### Nota al margen

El literal del rol no-administrador es **`jugador`**. `API.md` y `DATABASE.md`
documentaban `usuario` (el nombre viejo) y eso ya causó un bug en el panel de
administración: el combo de participantes filtraba por `rol === 'usuario'` y
salía siempre vacío. Los tres documentos ya están corregidos. Si el backend
todavía acepta `usuario` por compatibilidad, conviene que lo rechace o que al
menos no lo devuelva nunca.

---

## 6 · Posición base separada de la posición actual — **P1**

### El problema

Hoy una entidad tiene **una sola** posición (`pos_x` / `pos_y` en
`unidad_militar`, `posicion_x` / `posicion_y` en `vehiculo`), y esa misma pareja
de columnas se usa para dos cosas que no son la misma:

- **Dónde arranca** la entidad cuando el ejercicio se genera desde la base.
- **Dónde está ahora**, que el motor de movimiento pisa una vez por segundo.

Como el motor sobrescribe la posición, **el punto de partida se pierde apenas la
entidad se mueve**. No se puede volver a colocar el orden de batalla en su
posición inicial, ni comparar cuánto se desplazó respecto de su base, ni
regenerar el ejercicio desde la base sin arrastrar las posiciones de la última
corrida.

### Propuesta

Dos posiciones por entidad, en `unidad_militar` y en `vehiculo`:

| Campo | Quién lo escribe | Para qué |
|---|---|---|
| `posicion_base_x` / `posicion_base_y` | El administrador, desde configuración | Punto de partida. Al generar el estado desde la base, la entidad nace acá. |
| `posicion_x` / `posicion_y` (actual) | El motor de simulación | Dónde está ahora. Es la que viaja en `entidad:posicion_actualizada`. |

Reglas propuestas:

- Al **crear** la entidad, si no se manda posición actual, arranca en la base.
- Al **generar el estado desde la base** (`iniciar` la primera vez), la posición
  actual se resetea a la base.
- La posición base **no la toca el motor**: solo se cambia desde configuración.

**De dónde sale la base de un vehículo.** No se carga a mano: un vehículo
siempre está asignado (ver punto 8), así que **hereda la posición base de su
padre** — la unidad a la que pertenece, o el vehículo que lo transporta, que a
su vez la hereda de su unidad. Es decir: la base se define **una sola vez, en la
unidad**, y baja por la cadena.

### Qué hizo el frontend

El formulario de vehículos (Administración → Vehículos) **ya no pide posición**:
quedó con nombre, plantilla, ejercicio y la asignación.

⚠️ Sacarlos del `POST /vehiculos` dio **`400 Bad Request`**: el backend los
exige. Así que el cliente ahora **resuelve la cadena y los manda igual**: busca
la unidad (o el vehículo portador) y copia su posición. Es un parche —
`config-catalogos.js`, función `heredadoDelPadre()` — que existe solo hasta que
el backend derive la posición por su cuenta.

En cuanto existan `posicion_base_*`, el frontend los muestra como solo lectura
en el vehículo (heredados del padre) y editables en la unidad.

### Actualización 31-07-2026 — implementado, `frontend.md` ya lo documenta

`posicion_base_x`/`posicion_base_y` ya existen en `unidad_militar` (editables
solo por configuración, `PUT /unidades/:id`) y `POST`/`PUT /vehiculos` ya
**no** exige `posicion_x`/`posicion_y`: si se omiten, el vehículo nace en la
base de la unidad de la que depende, subiendo la cadena si el padre es otro
vehículo (`frontend.md`, fase 2). El `⚠️` de arriba sobre el `400 Bad
Request` quedó obsoleto.

**El cliente todavía no se actualizó del todo:** `heredadoDelPadre()`
(`config-catalogos.js`) sigue resolviendo la cadena a mano y mandando
`posicion_x`/`posicion_y` calculados en vez de omitirlos y dejar que el
backend derive desde la base. Es innecesario pero no incorrecto — sigue
funcionando porque el backend acepta la posición explícita igual que antes,
solo que ahora también acepta que se omita. Falta confirmar además si
`heredadoDelPadre()` debería copiar `posicion_base_x/y` del padre (la base) en
vez de `posicion_x/y` (la actual, que el motor pisa) — hoy copia la actual,
que puede haberse movido de la base si la unidad ya se desplazó.

---

## 7 · Bando derivado: borrar la columna de las entidades — **P1**

### El problema

`API.md` (sección 7) describe el bando como **texto libre**: *"de qué bando
(`"azul"`, `"rojo"`, texto libre)"*. Eso permite que convivan `"azul"`,
`"Azul"`, `"ejército"` y `"fuerzas especiales"`, y el frontend no puede confiar
en el valor para nada. `sidc.js` tiene que mantener una tabla de alias
(`azul|blue|amigo|aliado|propio|friend`) solo para adivinar la afiliación del
símbolo táctico.

Peor: el bando está **duplicado**. Vive en `ejercicio_usuario.bando` (el bando
del participante) y otra vez en cada unidad y cada vehículo. Nada garantiza que
coincidan, y si divergen no hay una regla que diga cuál gana.

### Propuesta

**a. Dominio cerrado.** Solo dos valores: `"azul"` y `"rojo"`. Un `CHECK` en la
base y `400` en la API ante cualquier otro. Es la regla que pidió el usuario.

**b. `bando` deja de existir como columna en `unidad_militar` y en `vehiculo`.**
No es "una columna que hay que mantener sincronizada": es un dato **que no
pertenece a la entidad**. El único lugar donde se define es
`ejercicio_usuario.bando`, y de ahí baja por la cadena de asignaciones:

```
vehículo → (unidad, o vehículo padre → su unidad)
         → usuario que controla la unidad
         → su bando en el ejercicio          ← única fuente de verdad
```

Como el punto 8 garantiza que la cadena **nunca** se corta (todo vehículo tiene
padre, toda unidad tiene jugador), la derivación siempre resuelve. No hace falta
un default ni un caso "sin bando".

Que la API lo devuelva **ya resuelto** —como campo calculado— en `GET /unidades`,
`GET /vehiculos` y en el JSON del ejercicio, para que el cliente no rearme la
cadena. Si por performance se prefiere materializarlo, que lo haga un trigger
del backend; lo que no debe seguir pasando es que el frontend lo mande.

**c. Consecuencia útil:** cambiar de bando a un participante reafilia todas sus
entidades de una, y con eso el dígito 4 del SIDC de todos sus símbolos. Hoy hay
que editarlas una por una y nada garantiza que queden consistentes.

### Qué hizo el frontend

- **Donde el bando se elige** (participantes) pasó de `<input type="text">` a un
  `<select>` con **solo azul y rojo**. `sidc.js` expone `BANDOS` y
  `opcionesBando()` como fuente única.
- **Donde el bando se hereda** ya no se pide:
  - Vehículos (`config-catalogos.js`): sale de la unidad asignada.
  - Alta de unidad en caliente (`direccion.js`): sale del jugador que la
    controla, que ahora es **obligatorio**. El SIDC se recalcula al elegirlo.
- Si un registro viejo trae un bando fuera del dominio, el select lo agrega como
  opción extra marcada «(bando anterior)» en vez de reasignarlo en silencio.
  Esas filas hay que migrarlas del lado de la base.

### Actualización 31-07-2026 — esto ya se implementó (parcial)

Confirmado en vivo: `POST`/`PUT /vehiculos` ahora devuelve **`400`** si el body
incluye `bando`, con el mensaje *"bando ya no se manda: se deriva de la unidad
del vehículo y del bando de su controlador"*. El frontend dejó de mandarlo
(`config-catalogos.js`, y por simetría también `direccion.js` en
`unidad:crear_en_ejercicio`). **Confirmado 10-08-2026, releyendo el código:**
`direccion.js` también omite `bando` del payload de `unidad:crear_en_ejercicio`,
con un comentario propio (`direccion.js:780-781`) que cita explícitamente el
`400` de este punto — la duda que quedaba abierta ya está resuelta, no hace
falta re-confirmarlo en vivo.
Sigue calculándolo del lado del cliente, pero solo para dos cosas que **no**
van al body: validar que la unidad/vehículo elegido tenga de dónde sacar bando
antes de dejar guardar, y la previsualización en el formulario.

**Confirmado 31-07-2026, releyendo `frontend.md`:** la parte (c) de la
propuesta **sí está implementada** — `GET /unidades?ejercicioId=` y
`GET /vehiculos` ya devuelven `bando` resuelto (`frontend.md`, fase 2:
*"con `?ejercicioId=` el servidor cruza controladores × participantes y
agrega `bando` ya resuelto"*; *"`GET /unidades?ejercicioId=` y
`GET /vehiculos` ya devuelven `bando` resuelto para colorear el símbolo"*).
`bandoDeVehiculo()`/`heredadoDelPadre()` (`config-catalogos.js`) ahora leen
`vehiculo.bando` directo cuando está presente, y solo suben la cadena de
asignación como *fallback* para la previsualización del formulario (un
vehículo que todavía no existe no tiene `bando` que leer).

**Corrección 10-08-2026, releyendo el código:** la frase anterior sobre
`mapa.js` quedó desactualizada. Ya **no** confía en `entidad.sidc` tal cual
llega: `estiloDe()` (`mapa.js:85-95`) recalcula siempre
`Sidc.conBando(entidad.sidc, entidad.bando)` antes de dibujar, con un
comentario propio explicando el motivo — los vehículos que llegan por
reconciliación REST (`Store.sincronizarVehiculos`, ver punto 11) no siempre
traen el SIDC con la afiliación ya resuelta. Es un no-op si el dígito ya
estaba bien, así que no contradice que el campo venga resuelto del servidor;
es una defensa adicional del cliente para el caso en que no venga, y el punto
que hay que corregir en este documento es la afirmación de que "esto ya
funciona sin cambios adicionales" — sí hizo falta un cambio, y ya está hecho.

⚠️ **Falta corregir del lado del backend:** el `POST /vehiculos` sin
`?ejercicioId=` en la query (o si el vehículo no pertenece a un ejercicio con
participantes cargados) — confirmar que ese caso también resuelve `bando`, o
documentar cuándo puede venir vacío.

---

## 8 · Cardinalidad de las asignaciones — **P1**

### El problema

Las dos relaciones de asignación son hoy **más laxas de lo que el modelo
admite**, y eso permite crear estados que no significan nada:

| Relación | Hoy | Debe ser |
|---|---|---|
| unidad ↔ usuario (`unidad_militar_usuario`) | N a N: varios jugadores pueden controlar la misma unidad | **Exactamente 1 jugador por unidad y por ejercicio** |
| vehículo → padre | `unidad_militar_id` y `vehiculo_padre_id` son ambos nullables e independientes | **Exactamente uno de los dos, nunca ambos, nunca ninguno** |

Las consecuencias no son teóricas:

- Una unidad con **dos** controladores de bandos distintos hace que el bando
  derivado (punto 7) sea **ambiguo**: no hay forma de decidir de quién sale.
- Un vehículo **sin** padre no tiene de dónde sacar bando ni posición base.
- Un vehículo con **los dos** padres tiene dos cadenas de herencia que pueden
  contradecirse.

O sea: los puntos 6 y 7 **no se pueden implementar bien sin esto**. Es el
cimiento de los otros dos.

### Propuesta

**a. Una unidad, un jugador, por ejercicio.**

```sql
-- la unidad no puede repetirse dentro del mismo ejercicio
UNIQUE (unidad_militar_id, ejercicio_id)
```

Ojo: hoy `unidad_militar_usuario` **no tiene columna `ejercicio_id`** — la
participación vive en `ejercicio_usuario`. Hay dos caminos:

1. Agregar `ejercicio_id` a `unidad_militar_usuario` y poner el `UNIQUE` directo.
   Es lo más simple de garantizar en la base.
2. Dejar el esquema como está y validarlo con un trigger que cruce contra
   `ejercicio_usuario`. Menos invasivo, más frágil.

Preferimos el 1, pero es decisión del backend. Lo que importa es que
`POST /unidades/:id/usuarios` devuelva **`409`** cuando la unidad ya tiene un
controlador en ese ejercicio, en vez de crear la segunda fila.

**b. Un vehículo, un solo padre.**

```sql
CHECK ((unidad_militar_id IS NULL) <> (vehiculo_padre_id IS NULL))
```

Un `XOR` estricto: exactamente uno de los dos. Ni los dos, ni ninguno. El
vehículo transportado **hereda la unidad** de su portador, así que la cadena
siempre termina en una unidad. Conviene además prevenir **ciclos** de transporte
(A lleva a B, B lleva a A), que el `CHECK` no cubre.

**c. Una unidad siempre tiene jugador.** Al menos —y a lo sumo— una fila en
`unidad_militar_usuario`. Crear una unidad sin controlador debería rechazarse, o
`POST /unidades` debería aceptar el `usuarioId` y crear las dos filas en una
transacción. Sin esto, «exactamente 1» se cumple de forma vacía con cero.

### Qué falta decidir

Qué pasa al **quitar** el único controlador de una unidad, o al borrar el
vehículo padre de otro. Lo razonable es `409` con un mensaje claro en vez de
dejar la entidad huérfana, pero es decisión del backend.

⚠️ **Revisar los datos existentes antes de poner las restricciones.** Si ya hay
vehículos sueltos, vehículos con dos padres, unidades sin controlador o unidades
con dos, la migración falla. Conviene una consulta de diagnóstico primero.

### Qué hizo el frontend

- **Vehículos**: se fue la opción «Suelto (cuelga de la raíz del ejercicio)».
  Solo se elige unidad **o** vehículo portador, y no se puede dejar vacío. Los
  radios ya hacían el XOR; ahora además es obligatorio.
- **Asignaciones de unidad**: el select de unidades **deshabilita las que ya
  tienen dueño** en el ejercicio, mostrando quién es, y el guardado se frena con
  un mensaje explícito si igual se intenta. Es validación de cliente sobre datos
  que puede tener desactualizados: **no reemplaza el `409` del backend**.
- **Se eliminó la vista «Vehículos → Unidad / Vehículo»** (`vehiculos-asignacion`).
  Era una segunda forma de editar la misma relación, en tanda, y además permitía
  dejar un vehículo en «Suelto», que ahora es un estado inválido. La asignación
  se hace únicamente en el formulario de Vehículos.

### Actualización 31-07-2026 — el contrato real salió distinto al de (b), y ya está documentado en `frontend.md`

El backend **no** implementó el `CHECK` de la propuesta (b) sobre
`unidad_militar_id`/`vehiculo_padre_id` — esos dos nombres de columna **nunca
existieron del lado del servidor** (`frontend.md`, fase 2). El contrato real,
confirmado tanto en vivo como releyendo `frontend.md`, es un par polimórfico:

```json
{ "unidad_padre_tipo": "unidad_militar" | "vehiculo_militar", "unidad_padre_id": 12 }
```

Obligatorio en `POST /vehiculos`, en `vehiculo:crear_en_ejercicio` (ver punto
9) y presumiblemente en `PUT /vehiculos/:id` (sin confirmar en vivo, pero
`frontend.md` no distingue create/update para este campo). `GET /vehiculos`
devuelve el par ya resuelto en cada fila.

El frontend (`config-catalogos.js`, `store.js`, `panel-entidad.js`) ya se
corrigió para usar únicamente `unidad_padre_tipo`/`unidad_padre_id`, tanto al
mandar como al leer — se sacó el envío duplicado de los nombres viejos que
este documento pedía antes como parche a ciegas.

**Sigue sin confirmar:** si el `XOR` y la prevención de ciclos de la
propuesta (b) se aplican sobre este nuevo par (un vehículo con
`unidad_padre_id` apuntando a un vehículo que no participa del ejercicio, o a
un ciclo de transporte A↔B).

---

## 9 · ~~Alta de vehículo en el ejercicio en vivo~~ — resuelto, era un bug del cliente

**Corrección 31-07-2026.** Este punto se escribió a partir de una prueba en
vivo sin haber releído `frontend.md` primero, y diagnosticaba mal la causa:
no es un hueco del backend, es que el cliente estaba usando el endpoint
equivocado.

Lo que se confirmó en vivo: un vehículo creado por `POST /vehiculos` mientras
el ejercicio **ya está corriendo** queda escrito en la base, pero el motor de
simulación no lo conoce — cualquier orden sobre él (se probó
`entidad:mover_libre`) rechaza el ack con `"La entidad no existe en este
ejercicio"`. Hasta ahí, correcto.

Lo que se dedujo mal: que no había forma de dar de alta un vehículo en el
motor en caliente. **Sí la hay** — `frontend.md`, fase 8, la documenta con
ejemplo completo: `vehiculo:crear_en_ejercicio` → `ejercicio:vehiculo_creado`,
simétrico a `unidad:crear_en_ejercicio`. La misma fase incluso advierte
explícitamente sobre el error que se terminó reproduciendo: *"un vehículo
dado de alta con `POST /vehiculos` mientras el ejercicio corría se veía en el
mapa... pero cualquier orden sobre él rebotaba... porque el motor no lo
conocía — usá este evento para altas con el ejercicio en marcha, no el
REST"*.

**Ya corregido en el cliente:** `config-catalogos.js` ahora emite
`vehiculo:crear_en_ejercicio` (en vez de `POST /vehiculos`) cuando el
ejercicio que se está editando es el mismo que está en vivo en el mapa de
este cliente (`Store.ejercicioId` + `Store.iniciado`); si no, sigue usando
REST como corresponde a una alta de catálogo con el ejercicio sin iniciar.
`direccion.js` ahora también escucha `ejercicio:vehiculo_creado` (antes solo
escuchaba el de unidad).

**Límite que queda:** si el admin edita el catálogo de un ejercicio que está
en vivo para **otro** cliente pero no para este (nunca se unió a su room),
no hay señal para saber que está corriendo y el alta cae a REST igual — el
mismo problema, pero server-side no hay forma de que el cliente lo sepa sin
consultarlo. Si esto importa, agregar el estado del ejercicio a
`GET /ejercicios` (`iniciado: true/false`, no solo `activo`) resolvería el
límite sin que el cliente tenga que estar unido a la room.

---

## 10 · El `nombre` de la instancia de vehículo no se persiste — P1 (antes P2)

### Actualización 04-08-2026: ahora es un error duro, no un fallback silencioso

Administración → catálogo de **Vehículos (instancias)** no carga: tira
`No se pudo cargar: column vm.nombre does not exist`. Confirmado con el
equipo de backend que la columna `nombre` de `vehiculo_militar` **se borró
de la base** (probablemente como respuesta a lo reportado el 31-07-2026, más
abajo). El problema es que la query detrás de `GET /vehiculos` (alias `vm`
para `vehiculo_militar`) no se actualizó junto con la migración: sigue
haciendo `SELECT ... vm.nombre ...`, y ahora Postgres tira el error crudo en
vez de devolver la lista.

**Efecto:** ya no es un dato mal mostrado, es un endpoint roto — nadie puede
ver ni administrar vehículos hasta que se corrija la query. Sube de P2 a P1.

**Qué hay que tocar en el backend:** sacar `vm.nombre` del `SELECT`/`JOIN` de
`GET /vehiculos` (y de `GET /vehiculos/base` si comparte la misma query). El
nombre a mostrar debe salir siempre de la plantilla
(`vehiculo_militar_base.nombre`), nunca de la instancia — confirma la
sospecha original de que el nombre propio nunca se persistió. Si además
`POST`/`PUT /vehiculos` todavía intentan escribir `nombre` en
`vehiculo_militar`, van a fallar con el mismo error de columna inexistente y
también hay que sacarlo de ahí.

El frontend no necesita cambios: ya no manda ni pide `nombre` para la
instancia (ver más abajo), así que tolera su ausencia sin romperse — el único
bloqueo es que el `GET` ni siquiera responde.

### El problema original (31-07-2026)

`frontend.md` (fase 2) documentaba que `nombre` es de la instancia y que **si
no se manda, se ve el de la plantilla** como fallback — eso es esperado. Lo
que se observó en vivo no fue ese caso: se probaron tres vehículos de
plantillas distintas **mandando un `nombre` propio** en `POST /vehiculos`, y
los tres volvieron de `GET /vehiculos` con el nombre de su plantilla en vez
del que se tipeó — o sea, el fallback se activó incluso habiendo mandado el
campo.

Se descartaron causas del lado del cliente: `config-catalogos.js` mandaba
`{ nombre: <lo que escribe el usuario> }` una única vez, sin ningún listener
que lo pisara con el de la plantilla antes de enviarlo. Como no se llegó a
confirmar con la respuesta cruda del `POST` (solo con la lista posterior de
`GET /vehiculos`), quedaba abierta la posibilidad de que el problema estuviera
en lo que devuelve el `GET` (un `JOIN` a la plantilla que pisa el campo al
leer) en vez de en lo que guarda el `POST`. La columna borrada confirma que
el dato nunca vivió de forma confiable del lado de la instancia.

### Qué hizo el frontend

Sacó el campo **Nombre** del formulario de vehículos y de la columna
correspondiente en la tabla del catálogo (`config-catalogos.js`) — no tenía
sentido pedir un dato que el backend descartaba en silencio.

### Propuesta

Corregir la query de `GET /vehiculos` (y `/vehiculos/base` si aplica) para
que deje de referenciar `vm.nombre` y resuelva el nombre mostrado siempre
desde `vehiculo_militar_base`. Confirmar también que `POST`/`PUT /vehiculos`
no intenten escribir esa columna. Avisar cuando esté desplegado para
verificar que el catálogo vuelve a cargar.

---

## 11 · Reiniciar el ejercicio reseedea unidades pero NO vehículos — ~~P1~~ hecho

### Actualización 04-08-2026 (2) — corregido, con un diagnóstico distinto

Dos cosas se corrigieron, y juntas cierran el punto:

**a. El alta/edición por REST ahora converge con el motor en caliente**, sin
esperar a ningún reinicio (`src/services/vehiculoSyncService.js`, simétrico a
`bajaEntidadService`): si el ejercicio ya está corriendo y la unidad de la que
depende el vehículo ya está viva en él, `POST`/`PUT /vehiculos` lo suman
también al JSON y emiten `ejercicio:vehiculo_creado`/`ejercicio:vehiculo_modificado`
a la room — el caso del paso 1 del repro (vehículos 26/27 rechazados con "no
existe en este ejercicio") ya no ocurre: aparecen solos, sin necesidad de
reiniciar nada.

**b. Reiniciar ahora sí rescata lo que quedó huérfano** (`estadoInicialService.reconciliarCatalogo`,
llamado desde `ejercicio:iniciar` y `ejercicio:cambiar` cuando el archivo ya
existía). El diagnóstico original decía que `generarEstadoInicial` no incluía
vehículos — releyendo el código eso **no es así**: `cargarVehiculos` +
`anidarVehiculos` siempre estuvieron ahí y los incluyen bien. El bug real es
un nivel más arriba, en `ejercicio:iniciar`: si el archivo ya existe, **nunca
vuelve a consultar la base** (`frontend.md` lo documenta: *"si el archivo ya
existe reanuda el ejercicio tal como quedó"*), así que ni unidades ni
vehículos dados de alta después del primer arranque aparecían al
detener→iniciar — la asimetría "unidades sí, vehículos no" del repro no era
tal: para unidades tampoco había reseed, sólo que el caso de prueba no llegó
a notarlo. Regenerar todo desde la base en cada reinicio hubiera sido peor
remedio que enfermedad (pisaría posiciones, daño y combates en curso — el
archivo es la fuente de verdad en tiempo real, no la base), así que la
solución es una reconciliación **no destructiva**: al reanudar, se suma
cualquier unidad/vehículo que esté en la base y no esté todavía en el JSON,
sin tocar nada de lo que ya está. Verificado en vivo: una unidad y un
vehículo insertados directo en la base (sin pasar por REST, para simular el
peor caso) aparecieron completos — `bando` y posición base derivados,
anidados bajo la unidad correcta — después de un `ejercicio:detener` +
`ejercicio:iniciar`, sin alterar la posición ni el progreso de las entidades
que ya estaban viviendo en el ejercicio.

`Store.agregarVehiculo` puede dejar de marcar `_pendienteEnMotor` como
permanente: con (a) la marca ya casi no debería aparecer, y con (b) un
reinicio ahora sí la resuelve si por lo que sea llegó a aparecer.

### El problema (histórico)

`frontend.md` documenta (y el punto 9 de este archivo lo confirmó) que al
iniciar un ejercicio el motor genera el estado en vivo **desde la base**, así
que cualquier unidad dada de alta en Administración mientras el ejercicio no
estaba corriendo aparece sola al arrancar. Probado en vivo el 04-08-2026:
**eso es cierto para unidades, pero no para vehículos.**

Reproducido así:
1. Con el ejercicio corriendo, dos vehículos (`id` 26 y 27, plantilla
   "Bombardero", uno por bando) estaban dados de alta en la base pero el
   motor los rechazaba con `"El vehículo no existe en este ejercicio"` al
   intentar moverlos — el caso ya conocido de POST /vehiculos con el
   ejercicio corriendo.
2. Se reinició el ejercicio completo: Dirección → Control → ⏹ DETENER, ▶
   INICIAR.
3. Inmediatamente después del `ejercicio:estado_inicial` que llega al
   reiniciar, **sin tocar Administración para nada**, se inspeccionó el
   estado recibido: las 2 unidades del ejercicio están, con `id`, posición y
   bando resueltos. **Ningún vehículo aparece** — ni en `estado.vehiculos[]`
   ni anidado en `unidad.vehiculos[]`. Los dos vehículos existen en la base
   (se ven perfecto por `GET /vehiculos?ejercicioId=`) pero el motor no los
   incluyó al regenerar el estado desde la base.

### Por qué importa

Es la misma asimetría del punto 9 (alta de vehículo en caliente vs. unidad en
caliente) pero un nivel más arriba: para unidades, "reiniciá el ejercicio" es
un workaround real para el caso de alta por REST con el ejercicio corriendo.
Para vehículos, **ese workaround no existe** — reiniciar no los rescata. Con
el estado actual del backend, un vehículo dado de alta por
`POST /vehiculos` (REST) mientras el ejercicio corría queda **permanentemente
fuera del motor** hasta que alguien lo borre y lo vuelva a crear con
`vehiculo:crear_en_ejercicio` (socket) mientras el ejercicio esté
efectivamente corriendo — no hay ningún reinicio que lo arregle.

### Qué hizo el frontend

`Store.agregarVehiculo` marca `_pendienteEnMotor` en cualquier vehículo que
llega solo por reconciliación REST (`GET /vehiculos`, no por un evento real
del motor) y bloquea arrastrarlo/editarlo en caliente mientras tenga esa
marca — así la UI no deja intentar una orden que el motor va a rechazar. Sin
el fix de este punto 11 en el backend, esa marca queda **permanente** para
cualquier vehículo creado antes de que el ejercicio arrancara, sin importar
cuántas veces se reinicie.

### Actualización 04-08-2026 — mismos vehículos, síntoma nuevo: `id` ausente al venir anidados

Reproducido con los mismos dos "Bombardero" (`vehiculo_militar_id` 26 y 27):
al arrastrar la unidad padre (`unidad_padre_id` 45), el backend contesta
`ejercicio:unidad_modificada` con la unidad completa, y **los vehículos
anidados en `unidad.vehiculos[]` no traen `id`** — traen `vehiculo_militar_id`
(el nombre crudo de columna) en su lugar. `Store.reindexar` los descartaba en
silencio (`console.warn`: *"vehículo sin id válido, se descarta"*), así que
dejaban de estar en el índice y no se podían ni dibujar ni arrastrar.

No se confirmó todavía si pasa con vehículos "sanos" (dados de alta con el
ejercicio corriendo, no huérfanos como estos) o si es otro efecto colateral
del mismo estado roto del punto 11 — pero el nombre de campo equivocado es un
problema aparte de que el motor no los conozca, y aplicaría igual a
cualquier vehículo si el backend arma así el payload anidado.

**Qué hizo el frontend:** `store.js` ahora alías `vehiculo_militar_id` → `id`
(y `unidad_militar_id` → `id` por simetría, sin caso confirmado todavía) al
normalizar cualquier registro que entra al Store, igual que ya hacía con
`pos_x`/`pos_y`. Tapa el síntoma — el vehículo vuelve a indexarse y
arrastrarse — pero no corrige que el motor lo siga sin registrar
correctamente (punto 11 sigue abierto). Si el backend corrige el nombre del
campo en el payload anidado, este alias queda inofensivo (no pisa un `id` que
ya esté presente).

**Confirmado 04-08-2026 (2): no era un efecto colateral del estado roto —
es el contrato real, y es permanente.** `vehiculo_militar_id` es y va a
seguir siendo el nombre del campo identificador de un vehículo en **todo**
el JSON del ejercicio (`estadoInicialService`, los eventos
`ejercicio:vehiculo_*`, `vehiculoSyncService`) — nunca `id`, con o sin
vehículos huérfanos de por medio. Es deliberado, no un descuido: un `id` de
unidad y uno de vehículo pueden coincidir (son PKs de tablas distintas), así
que el JSON los distingue por nombre de campo en vez de por tipo
(`entidadService.idDeEntidad`/`claveEntidad` lo hacen del lado del
servidor). `unidad_militar_id`, en cambio, **si es un caso real**: es el
campo que ya usan `GET /vehiculos` y el objeto `vehiculo` del JSON para el
id de la unidad raíz derivada (ver punto 6/7) — no hay ningún lugar donde un
vehículo use `unidad_militar_id` como su propio identificador, así que ese
alias en particular no debería tener nada que pisar.

La asimetría con REST es real pero es la misma en los dos sentidos: `GET
/vehiculos` devuelve `id` (la columna de la tabla, como cualquier otro
recurso REST de esta API) y el JSON del ejercicio devuelve
`vehiculo_militar_id` (para no chocar con el `id` de unidad en la misma
estructura). El alias de `store.js` para `vehiculo_militar_id` → `id` es la
forma correcta de absorber esa asimetría del lado del cliente — conviene
dejarlo como adaptador permanente, no como parche temporario a la espera de
un fix acá.

### Propuesta

Al generar el estado en vivo desde la base (mismo query/proceso que ya
reseedea `unidad_militar` → `unidades[]`), incluir también `vehiculo_militar`
→ anidado en `unidad.vehiculos[]` o en `vehiculos[]` de raíz según
`unidad_padre_tipo`/`unidad_padre_id`, igual que ya lo arma `GET /vehiculos`.

---

## 12 · La base de un vehículo hijo no sigue a la de su unidad/vehículo padre al moverse — ~~P2~~ hecho

### Actualización 04-08-2026 (3) — implementado

Se resolvió la ambigüedad que dejaba abierta la propuesta ("falta que el
backend decida qué movimiento dispara el recálculo") exactamente como
sugería el propio punto: **solo el reposicionamiento explícito** —
`unidad:modificar` / `vehiculo:modificar` con `posicion_x`/`posicion_y` (el
mismo evento que ya usa `direccion.js` → `reposicionar()`, sea por REST vía
`PUT /vehiculos/:id` o por socket) — cascadea la base a los hijos. El motor
de movimiento (`entidad:mover`/`mover_libre`, un tick por segundo) **no**
dispara el recálculo, tal como el propio punto recomendaba, para no convertir
la base en un alias de la posición actual.

Cómo quedó (`src/services/entidadService.js` → `descendientesVehiculos`,
usada desde `unidadHandler.js` y `vehiculoSyncService.js`):

- Al reposicionar una unidad o un vehículo portador, **todos** los vehículos
  que cuelgan de él —directo o transitivo, un vehículo transportando a
  otro— reciben `posicion_base_x`/`posicion_base_y` = la nueva posición.
  La base de la propia entidad reposicionada **no se toca** — sigue siendo
  config-only (`PUT /unidades/:id`), sin excepción para este caso: solo se
  actualiza la de sus hijos, que no tienen columna propia en la base de
  datos (es un campo 100% derivado que vive únicamente en el JSON del
  ejercicio).
- No hace falta contrato nuevo: cada vehículo rebaseado se avisa con el
  mismo `ejercicio:vehiculo_modificado` que ya existía (`campos:
  ["posicion_base_x", "posicion_base_y"]`), así que el cliente lo refleja
  con el listener que ya tiene.
- La respuesta de `unidad:modificar`/`vehiculo:modificar` ahora también
  trae `vehiculos_rebaseados: [id, ...]`, por si el cliente lo quiere
  loguear o mostrar, pero no hace falta leerlo: los eventos ya alcanzan.

Verificado en vivo con una cadena de tres niveles (unidad → vehículo
portador → vehículo transportado): reposicionar la unidad rebaseó a su
vehículo directo; reposicionar ese vehículo portador (por socket y por
`PUT /vehiculos/:id`) rebaseó a su vez al transportado, sin tocar la base
de ningún vehículo de otra rama del árbol.

### El problema (histórico)

`posicion_base_x`/`posicion_base_y` (punto 6) es "dónde nace" la entidad: el
punto que usa el motor para regenerar el estado desde la base, y la
referencia contra la que se mide cuánto se desplazó. Un vehículo **hereda**
la base de su padre — la unidad a la que pertenece, o el vehículo que lo
transporta — pero esa herencia hoy es **un snapshot de una sola vez**, tomado
en el momento de crear el vehículo (`config-catalogos.js`,
`heredadoDelPadre()`, que ya está anotado en el punto 6 como copiando la
posición **actual** del padre, no su base).

Después de creado, la base del vehículo hijo queda **congelada**: si la
unidad (o el vehículo portador) se mueve — sea por el motor de movimiento
durante el ejercicio, sea porque el administrador la arrastra en modo
reposicionar (`direccion.js` → `reposicionar()`, que ya persiste
`posicion_x`/`posicion_y` de la entidad arrastrada) — nada actualiza
`posicion_base_x`/`posicion_base_y` de sus vehículos hijos. Quedan "naciendo"
en un punto que ya no tiene relación con dónde está su unidad ahora.

Consecuencia concreta: si más adelante se regenera el ejercicio desde la
base (reinicio, o el fix del punto 11 cuando exista), los vehículos van a
aparecer en la posición vieja de su unidad, no en la actual — la formación
se rompe visualmente aunque la unidad nunca se haya desconectado de sus
vehículos.

### Propuesta

Cuando cambia la posición de una unidad o vehículo que actúa como padre de
otros, cascadear el nuevo valor a `posicion_base_x`/`posicion_base_y` de
**todos** los vehículos que cuelgan de él (directo o transitivo, si hay
vehículos transportando vehículos), con la misma regla de herencia que ya
usa el backend para resolver la base al crear.

Falta que el backend decida (y documente) **qué movimiento dispara el
recálculo**, porque no es lo mismo:

- **Reposicionamiento del administrador** (`unidad:modificar` /
  `vehiculo:modificar` con `posicion_x`/`posicion_y`, incluido el arrastre en
  el mapa): esto ya es una acción explícita de dirección, tiene sentido que
  re-base a los hijos con ella.
- **Movimiento normal del motor** (`entidad:mover` / `entidad:mover_libre`
  durante el ejercicio, un tick por segundo): re-basear en cada tick
  convertiría la base en un alias de la posición actual, lo que anula el
  propósito original del punto 6 (poder comparar "dónde empezó" vs "dónde
  está ahora"). Probablemente **no** se quiere cascadear acá — pero es una
  decisión del backend, no algo que el cliente pueda asumir.

Si la respuesta es "solo con el reposicionamiento del administrador", el
contrato que ya existe alcanza sin agregar nada nuevo: `ejercicio:unidad_modificada`
/ `ejercicio:vehiculo_modificado` ya viajan a la room del ejercicio: que el
payload de esos eventos incluya los vehículos hijos con su
`posicion_base_x/y` recalculada (o que el objeto `unidad`/`vehiculo` completo
que ya se manda en algunos casos —ver la actualización 04-08-2026 del punto
11— traiga sus `vehiculos[]` con la base actualizada) es suficiente para que
el cliente los refleje sin lógica nueva, con el mismo camino que hoy usa
`Store.agregarUnidad`.

### Qué hace el frontend mientras tanto

Nada — no hay forma de simularlo del lado del cliente sin arriesgarse a que
diverja de lo que decida el backend. `heredadoDelPadre()` sigue siendo un
snapshot de una sola vez, al crear el vehículo; después de eso su base no se
vuelve a tocar aunque el padre se reposicione.

---

## 13 · Vehículos de tipo aire: ruta base→base, base editable por el usuario y ataque atado al movimiento — ~~P1~~ hecho

### Actualización 05-08-2026 (2) — implementado

Las tres piezas de servidor están, siguiendo el contrato propuesto:

**a. Ruta base→base forzada en el servidor**
(`src/sockets/handlers/movimientoHandler.js`, `forzarBaseAireEnWaypoints`):
en `entidad:mover_libre`, si el vehículo es `tipo: "aire"`, el primer y el
último elemento de `waypoints` se fuerzan a `posicion_base_x/y` — se
insertan si no están, se corrigen si lo que mandó el cliente difiere. Un
vehículo aire sin base definida (`posicion_base_x/y` nulo) rechaza el
movimiento con un mensaje explícito en vez de intentar volar sin origen. El
resto de los tipos (`mar`, `anfibio`) sigue arrancando desde su posición
actual, sin cambios.

**b. `vehiculo:establecer_base`** (`src/sockets/handlers/unidadHandler.js`),
con el contrato propuesto: `{ ejercicio_id, entidad_id, posicion_base_x,
posicion_base_y }` → ack `{ posicion_base_x, posicion_base_y }`. Reglas
implementadas:

- `400` si la entidad no es un vehículo `tipo: "aire"` — el resto sigue sin
  poder tocar su base (`vehiculo:modificar` la sigue rechazando, con un
  mensaje que ahora menciona esta excepción).
- Permiso igual que dar una orden de movimiento: el jugador que controla el
  vehículo (a través de la unidad de la que depende) o un administrador —
  gateado en `validarPermiso.js` como `['jugador', 'administrador']` y
  verificado con `usuarioControlaEntidad` adentro del handler.
- Cancela el trayecto en curso (`movimientoManager.cancelar` +
  `estado_movimiento: 'estacionado'`), igual que reposicionar a mano.
- Emite `ejercicio:vehiculo_modificado` con
  `campos: ["posicion_base_x", "posicion_base_y"]` — no hace falta un
  evento servidor→cliente nuevo, tal como proponía este documento.

**Lo que quedaba por decidir — resuelto:** a partir de
`vehiculo:establecer_base`, el vehículo **deja de heredar** la base de su
padre. Queda marcado con un campo nuevo, `base_propia` (solo vive en el
JSON del ejercicio, igual que `posicion_base_x/y` de un vehículo — no hay
columna en la base), que el rebaseo en cascada del punto 12
(`cascadearBaseAHijos` en `unidadHandler.js`, y su equivalente en
`vehiculoSyncService.js` para la convergencia por REST) ahora salta. Nace en
`false` para cualquier vehículo — se comporta como hoy hasta que se use el
evento nuevo.

**c. `puedeAtacar` centralizado** (`src/services/combateEngine.js`),
aplicado en `combate:confirmar_ataque` antes de dejar iniciar un combate:

- Un vehículo aire que no está `en_movimiento` no puede confirmar ningún
  ataque.
- Una unidad no puede confirmar ataque contra un vehículo aire que esté
  `en_movimiento`.
- `categoriaObjetivo` (la función que ya filtraba armamento "aire"/"tierra"
  contra el objetivo) ahora también depende del movimiento: un vehículo aire
  solo es blanco "aire" mientras vuela — parado, es blanco "tierra" como
  cualquier otro. Con eso, un armamento `tipo_ataque: "aire"` solo bate
  aeronaves en vuelo y uno `tipo_ataque: "tierra"` bate todo excepto una
  aeronave en vuelo, sin tocar `armamentosUtiles` ni el manejo de `"ambos"`.
- No se tocó `combate:en_rango`: sigue avisando por proximidad sin filtrar
  por esta regla, a propósito — el cliente ya calcula `puedeAtacar()` del
  lado suyo para decidir qué mostrar en ese diálogo (ver "Qué hizo el
  frontend" abajo), y si el servidor dejara de emitir el aviso para los
  casos no atacables, ese cálculo del cliente dejaría de tener con qué
  disparar.

**Nota:** confirmar un ataque sigue cancelando el movimiento de las dos
entidades y marcándolas `estacionado` (comportamiento previo, común a
cualquier combate, no específico de vehículos aire) — así que un vehículo
aire que entra en combate quedará "en tierra" para el próximo ataque que
alguien le quiera confirmar, aunque el que él mismo disparó haya arrancado
mientras volaba. No se tocó porque el punto 13 solo pedía la validación en
`confirmar_ataque`, no un cambio a qué pasa después.

### El problema (histórico)

Funcionalidad nueva pedida para vehículos de `tipo: "aire"`, en tres partes.
Las tres necesitan una pieza de servidor que hoy no existe.

**a. Toda ruta aérea tiene que empezar y terminar en la base.** Al trazar una
polilínea para un vehículo `aire` (`entidad:mover_libre`), la posición base
(`posicion_base_x`/`posicion_base_y`) tiene que ser siempre el primer y el
último waypoint del trayecto, sin importar los puntos intermedios que dibuje
el usuario.

**b. El usuario tiene que poder cambiar la base de un vehículo aire haciendo
clic en el mapa**, con el vehículo seleccionado y un modo "establecer base"
activo. Hoy `posicion_base_x/y` de un vehículo es un campo **derivado**: se
hereda de la unidad (o el vehículo portador) del que depende (punto 6 y
punto 12 de este documento, y `frontend.md` fase 2), y el socket **rechaza
explícitamente** cualquier intento de mandarlo en `vehiculo:modificar`
(*"La posición base solo se cambia desde configuración..."*, `frontend.md`,
apéndice C). No hay ningún camino — ni REST ni socket — para fijar la base de
**un** vehículo puntual, independiente de la de su padre. Esta funcionalidad
lo necesita.

**c. Las reglas de ataque de un vehículo aire dependen de si está en
movimiento**, algo que hoy `combate:confirmar_ataque` no contempla:

- Un vehículo aire **solo puede atacar mientras está en movimiento**
  (`estado_movimiento === 'en_movimiento'`).
- Una unidad **no puede** atacar a un vehículo aire que esté en movimiento.
- Un armamento de `tipo_ataque: "aire"` **solo** puede atacar a vehículos aire
  en movimiento.
- Un armamento de `tipo_ataque: "tierra"` puede atacar a todo **excepto** a un
  vehículo aire en movimiento.

Hoy `confirmar_ataque` valida armamento vs. `objetivo.tipo`, pero no el
estado de movimiento del objetivo ni el del propio atacante. Sin esto, un
cliente que no aplique la regla (o uno modificado) puede forzar un ataque que
la mecánica no debería permitir — la validación real tiene que vivir en el
servidor, el cliente solo puede anticiparla.

### Propuesta

**a. Ruta base→base, también del lado del servidor.** El cliente arma el
array completo de `waypoints` para la modalidad libre, así que hoy ya
antepone y agrega la base antes de emitir. Pero como ese array lo controla el
cliente, conviene que el servidor lo garantice igual: si `entidad_tipo` +
`entidad_id` resuelve a un vehículo `aire`, forzar el primer y el último
elemento de `waypoints` a `posicion_base_x/y` de ese vehículo (insertándolos
si no están, corrigiéndolos si difieren), en vez de confiar en lo que mande
el cliente.

**b. Nuevo evento para fijar la base de un vehículo aire.**

```js
// cliente → servidor
socket.emit("vehiculo:establecer_base", {
  ejercicio_id: 7,
  entidad_id: 5,
  posicion_base_x: -99.14,
  posicion_base_y: 19.44,
}, (res) => {
  // { ok: true, posicion_base_x, posicion_base_y }
});
```

Reglas sugeridas:

- Solo sobre vehículos de `tipo: "aire"` — `400` para cualquier otro tipo (el
  resto sigue heredando la base de su padre, sin cambios).
- Solo el jugador que controla el vehículo (a través de la unidad de la que
  depende) o un administrador — mismo criterio que `vehiculo:modificar`.
- Cancela el trayecto en curso, igual que reposicionar con
  `posicion_x/posicion_y` (fijar una base nueva a mitad de vuelo no tiene
  sentido con una ruta vieja todavía activa).
- Falta decidir si este vehículo **deja de heredar** la base de su padre de
  ahí en adelante, o si la herencia se retoma la próxima vez que el padre se
  reposicione (punto 12) — avisar cuál de las dos rige, porque el cliente no
  puede asumirlo.
- Emitir `ejercicio:vehiculo_modificado` con
  `campos: ["posicion_base_x", "posicion_base_y"]`, el mismo evento que ya
  usa el rebaseo en cascada del punto 12: no hace falta un evento nuevo del
  lado servidor→cliente.

**c. `puede_atacar` centralizado en el motor de combate**, aplicado en
`combate:confirmar_ataque` (y, si corresponde, antes de emitir
`combate:en_rango`):

```
puede_atacar(atacante, objetivo):
  si atacante es vehículo "aire" y NO está en_movimiento -> rechazar
  objetivo_aire_en_movimiento = objetivo es vehículo "aire" Y objetivo.en_movimiento
  si atacante es unidad:
    devolver NO objetivo_aire_en_movimiento
  si atacante es vehículo:
    compatible = alguna arma con munición > 0 tal que:
      (arma.tipo_ataque == "aire"   Y objetivo_aire_en_movimiento) OR
      (arma.tipo_ataque == "tierra" Y NO objetivo_aire_en_movimiento)
    devolver compatible
```

`en_movimiento` no es un campo nuevo: ya es `estado_movimiento ===
'en_movimiento'`, el mismo que el JSON del ejercicio expone hoy
(`frontend.md`, fase 3) — la función solo tiene que leerlo, no agregar
columna ni evento.

### Qué hizo el frontend mientras tanto

- **`puedeAtacar(atacante, objetivo)`** (`combate.js`) centraliza las cuatro
  reglas de (c) del lado del cliente, devolviendo `{ ok, motivo }`. Se usa
  para filtrar el clic de objetivo en el modo de selección en el mapa
  (`Combate.elegirObjetivo`) y para mostrar el motivo real de rechazo en el
  diálogo de `combate:en_rango` en vez del genérico anterior. Es solo
  anticipación: `combate:confirmar_ataque` se sigue emitiendo igual, y su
  rechazo se maneja como cualquier otro ack negativo.
  ⚠️ **Corrección 10-08-2026:** el botón "⚔️ Atacar objetivo…" del panel de
  entidad **no** llama a esta función pese a lo que decía este punto antes —
  reimplementa la regla 1 sola, en línea (`panel-entidad.js:227-228`,
  `const puedeAtacarAhora = !esAire || Store.enMovimiento(item)`), porque a
  esa altura todavía no hay un objetivo elegido y las reglas 2–4 no aplican
  sin uno. Funcionalmente da lo mismo, pero es una regla duplicada en vez de
  reusar `puedeAtacar()` — si se agrega una quinta regla algún día, hay que
  acordarse de tocar los dos lugares.
- **Ruta base→base** (`movimiento.js`, función `conBaseAlPrincipioYFinal`): al
  confirmar una polilínea para un vehículo `aire`, el cliente antepone y
  agrega `posicion_base_x/y` al array de `waypoints` antes de emitir
  `entidad:mover_libre`. Si el vehículo no tiene base definida, corta el
  envío con un aviso en vez de mandar una ruta incompleta.
- **Modo "establecer base"** (`Movimiento.iniciarModoBase`, botón
  "🏠 Establecer base" en el panel de entidad, visible solo para vehículos
  `aire`): activa clic-en-mapa y emite el evento propuesto en (b),
  `vehiculo:establecer_base`. Ya no falla — el evento existe del lado del
  servidor con exactamente el contrato de arriba, así que el cliente no
  necesita ningún cambio (payload, ack, actualización del Store y el
  marcador visual en el mapa ya estaban armados para esto).
- **Marcador de base** (`Mapa.mostrarBase`/`ocultarBase`): dibuja un ícono en
  la posición base del vehículo aire seleccionado; se actualiza solo al
  cambiar la selección o al recibir un cambio de esa entidad (por ejemplo, la
  confirmación de `vehiculo:establecer_base`, o el rebaseo en cascada del
  punto 12).
- `posicion_base_x`/`posicion_base_y` se agregaron a la lista de campos que
  `store.js` normaliza a `Number` para unidades y vehículos (antes solo se
  normalizaba `posicion_x`/`posicion_y` actual) — sin esto, un valor recibido
  como string rompía las comparaciones numéricas al dibujar el marcador.
- **Cancelar el movimiento de un vehículo aire no lo detiene en el aire: lo
  redirige a su base.** Es otra pieza de la misma mecánica (una vez que un
  vehículo aire despegó, "cancelar" tiene que significar "volver a la base",
  no "quedarse flotando donde esté"). `movimiento.js` → `volverABase()` lo
  resuelve **sin evento nuevo**, encadenando dos que ya existen:
  `entidad:cancelar_movimiento` (corta el trayecto en curso) seguido de
  `entidad:mover_libre` con un único waypoint, la base. El segundo emit se
  manda después de que el ack del primero resuelve, así que usa la posición
  que el servidor ya tiene para la entidad en ese momento — no hace falta
  esperar un tick de `entidad:posicion_actualizada` en el medio. Si esto
  resulta frágil en la práctica (por ejemplo, si cancelar deja un estado
  intermedio inconsistente entre los dos emits), la alternativa más limpia es
  que el servidor ofrezca un solo evento (`entidad:volver_a_base` o que
  `entidad:cancelar_movimiento` mismo, para un vehículo aire, dispare
  internamente el nuevo trayecto) — pero no es necesario para que funcione
  hoy.

---

## 14 · "Volver a base" de un vehículo aire no respeta su `velocidad_desplazamiento` — ~~P1~~ hecho

### Actualización 05-08-2026 (4) — implementado, causa confirmada distinta a la hipótesis

La hipótesis del reporte apuntaba bien (`forzarBaseAireEnWaypoints`,
`src/sockets/handlers/movimientoHandler.js`), pero la causa real es un
nivel más abajo de lo que suponía: no es que la función "inserte en vez de
comparar" — sí comparaba, y con `waypoints: [base]` (el payload exacto de
`volverABase()`) el resultado terminaba siendo `[base, base]` porque el
único punto que mandó el cliente **ya era la base**, así que se lo
consumía como "ya está" tanto por el lado del primer como del último
chequeo, y los dos extremos se rellenaban de nuevo con la misma base.

El motivo por el que `[base, base]` explica el síntoma exacto (el vehículo
no se ve viajar, "llega" ya): `movimientoManager.iniciar()` usa
`waypoints[0]` como la posición de arranque del trayecto sin interpolar
(`entidad.posicion_x = waypoints[0].x/y`), y `distanciaTotalKm([base,
base])` da `0`. En `interpolarPosicion` (`haversineService.js`), un tramo
de distancia `0` se salta sin consumir el `deltaKm` del tick
(`if (tramo === 0) { objetivo += 1; continue; }`), así que en el primerísimo
tick `objetivo` ya llega al final del array y `llego: true` sale
inmediatamente — el vehículo "completa" el viaje sin haber avanzado nada,
sin importar `velocidad_desplazamiento`: la velocidad nunca llegó a
usarse porque no había distancia que recorrer a esa velocidad.

**La causa de fondo** no era el manejo del caso degenerado en sí, sino una
decisión de diseño del punto 13a que solo se sostenía bajo un supuesto que
"volver a base" rompe: que `entidad:mover_libre` para un vehículo aire
siempre se llama con la entidad **parada en su base** (arrancando una
misión nueva). Bajo ese supuesto, forzar el primer waypoint a la base es
inofensivo porque la posición actual ya es la base. `volverABase()`
(agregado en la actualización anterior de este documento, "Qué hizo el
frontend" del punto 13) rompe el supuesto: llama a `entidad:mover_libre`
con el vehículo **en el aire**, en cualquier otra posición.

**La corrección:** `forzarBaseAireEnWaypoints` ya no fuerza el primer
waypoint a la base — usa la posición **actual** de la entidad, igual que
cualquier otro vehículo (`entidad.posicion_x/y`). Solo el **último**
waypoint se sigue forzando a la base, que es la parte del invariante que
importa de verdad ("toda ruta aérea vuelve a la base"). Esto no cambia
nada para el caso normal (despegar con una misión nueva desde la base): ahí
la posición actual ya es la base, así que el resultado es idéntico a
forzarla. Para "volver a base" a mitad de vuelo, ahora arma
`[posición_actual, base]` — un tramo real, con distancia real, que
`movimientoManager` recorre a `velocidad_desplazamiento` como cualquier
otro trayecto. Verificado el cálculo a mano con el código de
`haversineService`/`movimientoManager`: con dos puntos distintos,
`distanciaTotalKm` da la distancia real y `tiempo_estimado_seg` sale de
`distancia_km / velocidadKmh`, sin casos especiales.

No hizo falta tocar `entidad:mover_libre` en sí ni el cálculo de
`distancia_km`/`tiempo_estimado_seg` de `movimientoManager` (ítem 1 de la
propuesta): ya calculaban bien para cualquier cantidad de waypoints: el
problema nunca fue el cálculo de velocidad, fue que el trayecto que le
llegaba tenía distancia cero.

### El problema (histórico)

Al cancelar el movimiento de un vehículo aire, el cliente lo redirige a su
base en vez de detenerlo en el aire (punto 13, "Qué hizo el frontend",
último ítem): encadena `entidad:cancelar_movimiento` seguido de
`entidad:mover_libre` con un único waypoint, la base. Funcionalmente
redirige bien — el vehículo cambia de rumbo y vuela hacia la base — pero
**no se desplaza a la velocidad configurada** del vehículo
(`velocidad_desplazamiento`, de su plantilla o instancia).

El cliente no calcula velocidad, distancia ni tiempo en ningún lado para
esta orden ni para ninguna otra: la posición autoritativa llega 1 vez por
segundo por `entidad:posicion_actualizada`, y el ícono solo interpola
*visualmente* entre el tick anterior y el nuevo durante 1 segundo
(`mapa.js` → `animarHacia`, duración fija de 1000 ms). Si el salto entre dos
ticks consecutivos no corresponde a la velocidad configurada, la distancia
recorrida por segundo la decide el motor, no el cliente — el problema tiene
que estar en cómo se calculó el trayecto o la interpolación para esta orden
puntual.

**Hipótesis sin confirmar** (no hay forma de verificarla sin ver el código
del servidor, que no vive en este repo): el punto 13a agregó
`forzarBaseAireEnWaypoints`, que fuerza el primer y el último elemento de
`waypoints` a la base — "se insertan si no están, se corrigen si lo que
mandó el cliente difiere". El payload de "volver a base" es
`waypoints: [base]`: **un solo punto que ya es la base**. Si esa función
inserta un punto nuevo en vez de reconocer que el único elemento ya cumple
las dos condiciones (ser el primero y ser el último), el trayecto resultante
podría terminar con puntos duplicados (p. ej. `[base, base]` o
`[base, base, base]`) en vez de un trayecto de un solo tramo real (posición
actual → base). Si el cálculo de velocidad/tiempo de la modalidad libre
reparte la duración entre "tramos" de la ruta en vez de entre los metros
totales, un trayecto con puntos degenerados así podría dar una velocidad de
interpolación distinta de la que corresponde. Es una pista para acotar dónde
mirar, no un diagnóstico confirmado.

### Propuesta

- Confirmar que `entidad:mover_libre` calcula `distancia_km` /
  `tiempo_estimado_seg` (y la velocidad de interpolación tick a tick) siempre
  a partir de `vehiculo.velocidad_desplazamiento`, para cualquier cantidad de
  waypoints, incluido un trayecto de un solo punto real.
- Revisar puntualmente el caso "volver a base": un `waypoints` de un solo
  elemento que ya coincide con la base no debería generar puntos duplicados
  al pasar por `forzarBaseAireEnWaypoints` — confirmar que esa función
  compara antes de insertar, no que siempre antepone/agrega.
- Si la causa es otra (por ejemplo, esta orden puntual cae por un camino de
  código distinto al de un `entidad:mover_libre` normal y ahí se usa una
  velocidad por defecto en vez de la del vehículo), corregir ese camino —
  tiene que quedar unificado con el resto de la modalidad libre, no como un
  caso aparte.

### Qué hace el frontend mientras tanto

Nada — no hay ningún cálculo de velocidad, distancia o tiempo del lado del
cliente para ajustar. `movimiento.js` → `volverABase()` sigue mandando
`waypoints: [base]` tal cual, confiando en que el servidor calcula el
recorrido con la misma fórmula que cualquier otro trayecto libre.

---

## 15 · `combate:retirarse` no reordena movimiento de vuelta al origen — ~~P2~~ hecho

### Actualización 06-08-2026 (2) — implementado

Las dos piezas de la propuesta están, siguiendo el contrato sugerido:

- **`movimientoManager` retiene el trayecto interrumpido**
  (`src/services/movimientoManager.js`, `cancelarPorCombate` /
  `retomarTrayectoInterrumpido`): cuando el motor de combate frena a una
  entidad al entrar en combate, en vez del `cancelar()` de siempre se llama
  a `cancelarPorCombate(ejercicioId, tipo, id, posicionActual)`
  (`combateEngine.confirmarAtaque`), que antes de cortar el intervalo arma
  `[posiciónActual, ...waypointsYaVisitados.invertidos]` y lo guarda en un
  `Map` propio, en memoria, por ejercicio — no hace falta persistirlo más
  allá de la vida del combate, tal como decía la propuesta. Una orden de
  movimiento nueva (`entidad:mover`/`entidad:mover_libre`, que ya rechazaba
  moverse con `en_combate: true`) descarta cualquier trayecto retenido al
  arrancar, para que uno viejo nunca se cuele en un movimiento no
  relacionado.
- **`combate:retirarse` lo retoma** (`src/services/combateEngine.js`,
  `retirarse`, ahora async): después de cortar los combates y liberar
  `en_combate` como ya hacía, si había un trayecto retenido para esa
  entidad lo saca del `Map` (se consume, no queda para la próxima) y
  arranca un movimiento nuevo con `movimientoManager.iniciar()` —el mismo
  camino que usan `entidad:mover`/`entidad:mover_libre`, así que corre con
  las mismas reglas de velocidad/interpolación (punto 14, mismo motor)—, y
  emite `entidad:movimiento_iniciado` igual que cualquier otro movimiento,
  sin evento especial. Si la entidad ya estaba parada cuando entró en
  combate, no hay nada retenido y `combate:retirarse` se comporta
  exactamente como antes.

El ack de `combate:retirarse` ahora trae además `vuelta_a_origen`: `null` si
no había nada que retomar, o `{ distancia_km, tiempo_estimado_seg,
waypoints }` si arrancó el regreso — no hace falta leerlo para que funcione,
los eventos ya alcanzan, pero está por si el cliente lo quiere mostrar.

Sobre el caso límite que dejaba abierto la propuesta ("¿el motor rechaza un
`entidad:mover` nuevo mientras la entidad sigue en combate?"): confirmado
que sí — `exigirEntidadMovible` (`movimientoHandler.js`) ya tiraba error si
`entidad.en_combate`, así que no había ambigüedad que resolver ahí.

### El pedido

Al presionar RETIRARSE en el diálogo de `combate:en_rango` (fase 6), la
entidad debería volver **por la misma ruta** al punto donde arrancó el
movimiento que la llevó a combate — no quedarse parada donde la agarró el
combate. Hoy `combate:retirarse` (`frontend.md`, fase 6) solo hace dos cosas:
saca a las dos entidades de `en_combate` y deja a la que se retira libre para
recibir una orden de movimiento nueva. No reencola ningún trayecto: si el
usuario no manda una orden de movimiento después, la entidad se queda parada
en el lugar exacto donde el motor la frenó al entrar en combate.

### Por qué no lo puede resolver el cliente

`entidad:mover`/`entidad:mover_libre` cancelan y reemplazan el trayecto
activo — no hay ningún evento para "reanudar desde acá con el resto de la
ruta pendiente invertida". Y aunque lo hubiera, el cliente no tiene con qué
reconstruir esa ruta en el momento de decidir: `combate:iniciado`
(`combate.js`, `Socket.on('combate:iniciado', ...)`) llama a
`Mapa.limpiarTrayecto` para las dos entidades apenas arranca el combate —
borra la polilínea dibujada del lado del cliente porque ya no representa
nada real (`movimientoManager` frenó a la entidad en el motor). Para cuando
el jugador ve el diálogo y decide RETIRARSE, el cliente ya no tiene ni el
trayecto pendiente ni el punto exacto de origen de este movimiento en
particular — solo la posición actual (`entidad.posicion_x/y`). El servidor sí
tiene esa información: es quien resolvió el trayecto original (`waypoints`
de `entidad:mover`/`entidad:mover_libre`) y quien decidió en qué punto de esa
polilínea frenó a la entidad al detectar combate.

### Propuesta

- El motor de movimiento, al frenar una entidad por `combate:en_rango`/
  `combate:iniciado`, retiene el trayecto interrumpido (los `waypoints`
  restantes desde el punto donde se frenó hacia atrás hasta el origen del
  movimiento) asociado a esa entidad — no hace falta persistirlo más allá de
  la vida del combate, con guardarlo en memoria junto al resto del estado de
  combate alcanza.
- `combate:retirarse` (`src/sockets/handlers/combateHandler.js` o
  equivalente), además de lo que ya hace (liberar `en_combate`), si la
  entidad tenía un trayecto interrumpido por este combate arranca
  automáticamente un movimiento con esos waypoints **invertidos** —
  reutilizando el mismo camino de `movimientoManager.iniciar()` que usa
  `entidad:mover`/`entidad:mover_libre`, para que valgan las mismas reglas de
  velocidad/interpolación (ver punto 14, mismo motor).
- Emitir `entidad:movimiento_iniciado` para ese trayecto de vuelta igual que
  para cualquier otro, así el cliente lo dibuja solo (`movimiento.js`,
  `Socket.on('entidad:movimiento_iniciado', ...)`) sin necesitar un evento
  especial.
- Si la entidad ya estaba parada (sin movimiento en curso) cuando entró en
  combate, no hay adónde volver: `combate:retirarse` se comporta como hoy,
  solo libera `en_combate`.
- Caso límite a definir: si mientras dura el combate alguien ya emitió un
  `entidad:mover`/`entidad:mover_libre` nuevo para esa entidad (¿lo rechaza
  el motor por `en_combate`, como documenta `frontend.md` trampa de fase 4?
  si es así, no hay ambigüedad: el trayecto guardado sigue siendo el único
  candidato para la vuelta).

### Qué hace el frontend mientras tanto

Nada — `combate.js` → `retirarse()` emite `combate:retirarse` tal cual y
listo; la entidad queda parada donde el motor la frenó hasta que alguien
(jugador o admin) le dé una orden de movimiento nueva. No se intenta
reconstruir la ruta del lado del cliente porque, como se explica arriba, ya
no queda información para hacerlo en el momento de la decisión.

---

## 16 · Eventos de combate emitidos a toda la room, no acotados a quien corresponde — ~~P2~~ hecho

### Actualización 06-08-2026 (4) — implementado

`combate:iniciado`, `combate:tick` (las dos variantes, Lanchester y por
armamento), `combate:finalizado` y `combate:retirada`
(`src/services/combateEngine.js`) dejaron de emitirse a
`roomEjercicio(ejercicioId)` — ahora van solo a los controladores de las
entidades involucradas más los administradores, con el mismo criterio que
ya usaba `combate:en_rango` (`emitirADuenos`). Se agregó
`emitirAInvolucrados(io, ejercicioId, estado, refs, evento, payload)`, que
generaliza esa función a una lista de entidades (no una sola): junta los
`propietariosDeEntidad` de todas, sin duplicar si alguien controla más de
una punta del combate, y les emite a cada `usuario_{id}` más a
`ejercicio_{id}_rol_administrador`.

Los cuatro puntos de emisión quedaron así:

- `combate:iniciado` (en `confirmarAtaque`) y los dos `combate:tick`
  (`aplicarLanchester` para Lanchester, `dispararArmamento` para daño por
  armamento): a `[atacante, objetivo]`.
- `combate:finalizado` (en `finalizarCombate`): a `[combate.atacante,
  combate.objetivo]` — son solo `{tipo, id}`, no hace falta la entidad
  resuelta porque `propietariosDeEntidad` ya busca por su cuenta; sigue
  funcionando incluso en el caso `entidad_inexistente` (la entidad ya no
  está, `propietariosDeEntidad` devuelve `[]` y el evento igual les llega a
  los administradores).
- `combate:retirada` (en `retirarse`): a quien se retira **más los
  oponentes de todos los combates que se cortan**, no solo al que se
  retira — como un mismo `retirarse` puede cortar varios combates a la vez
  (varios enemigos atacando a la misma entidad), los oponentes se juntan
  recorriendo `motor.combates` **antes** de llamar a `cortarCombatesDe`
  (que los borra del `Map` al cortarlos).

No se tocó `combate:en_rango` (ya iba acotado) ni, a propósito, la segunda
parte "si sale barato" de la propuesta —`entidad:movimiento_iniciado`/
`posicion_actualizada`/`movimiento_completado`— que queda fuera de este
punto: acotar movimiento por control **o** detección es una cuenta bastante
más grande (hay que cruzar `detectado_por[]` de cada tick, no solo
`usuarios_ids`) y el pedido la marcaba como opcional, no como parte del
`P2` de este punto.

### El problema

`combate:iniciado`, `combate:tick`, `combate:finalizado` y `combate:retirada`
van a la room `ejercicio_{id}` completa (`frontend.md`, tabla de fase 6) —
es decir, a **todos** los sockets del ejercicio, de los dos bandos, controlen
o no alguna de las dos entidades que están peleando. Es el mismo patrón que
ya tenía fase 4 con `entidad:movimiento_iniciado`/`posicion_actualizada`/
`movimiento_completado` (sin acotar por bando, a diferencia de
`entidad:detectada`/`perdida_de_vista`, que sí van a la room `bando`): el
servidor cuenta con que el cliente filtre lo que corresponde mostrar.

Eso funciona para la niebla de guerra del **mapa** (`Store.visibleParaMi`
decide qué ícono/trayecto dibujar) porque ahí lo único que importa es si la
entidad es visible o no, y esa info (`detectado_por`) sí viaja acotada. Pero
para el **log de combate** el criterio no es visibilidad — es **control**:
"¿el jugador tiene alguna unidad o vehículo metido en este combate?", sin
importar si puede ver a las entidades en el mapa. El dato para decidir eso
(`usuarios_ids`/`jugador_asignado_id` de cada entidad) sí viaja completo en
`ejercicio:estado_inicial` para todas las entidades del ejercicio, sin
acotar por bando (`frontend.md:273`, campo `usuarios_ids` del ejemplo de
unidad) — así que el filtro se puede hacer del lado del cliente sin pedir
nada nuevo, y así quedó implementado (ver "Qué hizo el frontend" abajo).

El problema de fondo es que ese filtrado del lado del cliente es cosmético:
esconde el diálogo, el log y (para movimiento) el trazo, pero el payload
completo — con el nombre, la posición, el daño y el resultado de un combate
entre dos entidades que el jugador ni controla ni puede ver — igual llega a
su socket. Cualquiera con las DevTools abiertas (`window.__TAURI__` corre
sobre un WebView normal) puede escuchar el evento crudo y enterarse de
combates ajenos sin que el juego se lo permita. Para un ejercicio de
instrucción/simulación el riesgo real es bajo, pero rompe la premisa de
niebla de guerra si alguien decide aprovecharlo.

### Propuesta

- `combate:iniciado`/`tick`/`finalizado`/`retirada`: en vez de `io.to(
  `ejercicio_${id}`)`, emitir solo a los sockets de los usuarios que
  controlan `entidad_tipo/entidad_id` u `objetivo_tipo/objetivo_id` (mismo
  criterio que ya resuelve `usuarios_ids`/`jugador_asignado_id` para
  `combate:en_rango`, que ya va acotado a `usuario_{id}`) — más los
  administradores, que auditan todo.
  Si ya existe una room por usuario (`usuario_{id}`, ver Apéndice A de
  `frontend.md`) alcanza con emitir a cada `usuario_{id}` de los
  controladores de las dos entidades, en vez de a la room del ejercicio.
- Mismo tratamiento, si sale barato, para `entidad:movimiento_iniciado`/
  `posicion_actualizada`/`movimiento_completado` (fase 4): acotar a quienes
  controlan la entidad **o** a quienes ya la tienen detectada
  (`detectado_por[]`, que el motor ya calcula para la niebla de guerra) —
  hoy también van a toda la room del ejercicio y el cliente los filtra igual
  que a los de combate (ver `mapa.js`, `movimiento.js`).
- Si acotar por socket individual sale caro (buscar todos los sockets de un
  usuario que puede tener varias pestañas/conexiones), una alternativa más
  barata es una room por bando por combate, o simplemente reusar la lógica
  de "a quién le llega `combate:en_rango`" que ya existe, aplicada también a
  estos cuatro eventos.

### Qué hizo el frontend mientras tanto

`combate.js` filtra en el cliente: agregó `estoyInvolucrado(...)`, que
devuelve `true` para el administrador (audita todo, como en el resto de la
app) o si `Store.controlo(...)` da `true` para `entidad_tipo/entidad_id` o
`objetivo_tipo/objetivo_id` del evento (o para cualquiera de los
`participantes` del modelo Lanchester). Los cuatro listeners
(`combate:iniciado`/`tick`/`finalizado`/`retirada`) solo llaman a
`agregarLog(...)` cuando `estoyInvolucrado(...)` da `true` — el resto del
manejo (`Store.aplicarCampos`, `Store.registrarCombate`/`cerrarCombate`,
`Mapa.limpiarTrayecto`) sigue corriendo siempre, porque eso es
sincronización de datos, no algo que se muestre. También se ocultó el
diálogo de `combate:en_rango` para el administrador (no controla ninguna
entidad, así que ATACAR/IGNORAR/RETIRARSE no le aplican) y se filtró la
línea de trayecto de `entidad:movimiento_iniciado` por `visibleParaMi` — el
mismo patrón, aplicado antes a fase 4.

Esto tapa la fuga en la UI pero no en el transporte: sigue siendo un parche
de cliente, con la misma limitación que se explica arriba.

---

## 17 · `detectado_por[]` marca observadores fuera de su `rango_vision_m` — ~~P1~~ hecho

### Actualización 06-08-2026 (6) — implementado, causa real distinta a las dos hipótesis

Las dos hipótesis del reporte apuntaban al lugar correcto (el motor de
detección) pero ninguna era la causa de fondo del caso reproducible:

- `evaluarDetecciones` (`src/services/visibilidadService.js`) **sí**
  reevalúa las combinaciones observador↔objetivo completas en cada ciclo,
  sin importar si alguna de las dos partes está en movimiento — no hay
  atajo por movimiento que descartar.
- El cálculo de distancia contra `rango_vision_m` (`haversineService.js`)
  está bien: se verificó a mano con las coordenadas exactas del reporte
  (`vehiculo:30`/`vehiculo:31`, ejercicio 14) y da los mismos 9694 m que
  reportó el cliente.

**La causa real, confirmada reproduciéndola en vivo antes de tocar nada:**
`ejercicio_14.json` en el servidor decía `estado: "activo"` — pero
`combateEngine`/`movimientoManager` son estado **en memoria** (`Map`s por
proceso), y no sobreviven a un restart del proceso Node (deploy, crash, o
`nodemon` reiniciando en dev, que es lo que pasó acá: los cuatro puntos
anteriores de esta misma sesión de trabajo lo reiniciaron varias veces).
Nada en el arranque del servidor volvía a llamar
`combateEngine.iniciar(io, ejercicioId)` para los ejercicios que ya estaban
"activo" en su archivo — así que el ciclo de detección/combate quedaba
**muerto para siempre**, salvo que alguien emitiera `ejercicio:iniciar` de
nuevo a mano. El archivo seguía diciendo "activo", los clientes que se
conectaban lo creían corriendo, pero nada volvía a tickear: `detectado_por[]`
quedaba congelado con el último cálculo antes del reinicio, sin importar
cuánto se hubieran movido las entidades después.

Se confirmó leyendo el JSON en vivo antes de la corrección:
`vehiculo:30.detectado_por` traía `["vehiculo:31"]` con `ejercicio.estado:
"activo"` — el caso exacto del reporte, reproducido de nuevo sin cambiar
nada todavía.

**La corrección**, en dos partes:

- **`unidad:modificar`/`vehiculo:modificar`** (`src/sockets/handlers/unidadHandler.js`)
  y **`admin:set_visibilidad`** (`src/sockets/handlers/visibilidadHandler.js`)
  ahora llaman a `evaluarDetecciones(io, ejercicioId, estado)` de inmediato
  cuando el cambio toca `posicion_x`, `posicion_y`, `rango_vision_m` o
  `visible` — los cuatro campos que pueden volver obsoleta una detección —
  en vez de esperar al próximo tick del ciclo de `combateEngine` (que
  además solo corre con el ejercicio activo: `*:modificar` funciona incluso
  pausado). Esto no era la causa del caso reportado, pero es el mismo tipo
  de hueco y ya estaba ahí.
- **`src/index.js`** agrega `reanudarEjerciciosActivos()`, que corre una
  vez al arrancar: recorre los ejercicios con archivo
  (`listarEjerciciosIniciados`), y a cada uno que tenga `estado: "activo"`
  le vuelve a llamar `combateEngine.iniciar(io, ejercicioId)`. El trayecto
  de un movimiento en curso no se puede resucitar (`waypoints`/`índice`
  nunca se persisten, solo `posicion_x/y`), así que de paso pasa a
  `estacionado` cualquier entidad que haya quedado `en_movimiento` — y
  `en_combate` a `false`, mismo saneamiento que ya hacen
  `ejercicio:pausar`/`detener`, porque sin `combateEngine.motores` en
  memoria tampoco hay combate real sosteniendo esa marca.

**Verificado en vivo, de punta a punta:** con el bug todavía presente,
`vehiculo:30.detectado_por` era `["vehiculo:31"]`. Después de aplicar la
corrección (que reinició el proceso una vez más, como cualquier cambio de
código), el log confirmó `Ejercicios activos reanudados al arrancar el
servidor { reanudados: 1 }`, y unos segundos después —ya con el ciclo de
detección corriendo de nuevo— `vehiculo:30.detectado_por` pasó a `[]`, lo
correcto dado que la distancia real (9694 m) sigue superando el
`rango_vision_m` (5000 m) de `vehiculo:31`.

### El problema

Toda la niebla de guerra del cliente (mapa, log de combate, panel lateral)
confía ciegamente en `detectado_por[]`: si una entidad enemiga trae ahí la
clave de una entidad propia, se la trata como vista, punto — es justamente
el contrato que documenta `deteccion.js` (*"El backend evalúa una vez por
segundo... si el evento te llegó, es porque lo viste"*). Encontramos un caso
en vivo (ejercicio 14) donde ese contrato se rompe: el dato dice que hay
detección, pero la distancia real entre las dos entidades es casi el doble
del `rango_vision_m` del supuesto observador.

**Caso reproducible, capturado en vivo desde la consola del cliente
(`Store.seleccionada()`/`Store.observadoresDe(...)`, ejercicio 14):**

```json
{
  "objetivo": { "clave": "vehiculo:30", "bando": "rojo",
    "x": -99.150709, "y": 19.482614 },
  "observador_marcado": { "clave": "vehiculo:31", "bando": "azul",
    "x": -99.14259501984893, "y": 19.39576877474063,
    "rango_vision_m": 5000 },
  "distancia_real_m": 9694.2
}
```

`vehiculo:30.detectado_por` incluye `"vehiculo:31"`, pero la distancia real
entre ambos (haversine sobre `posicion_x/y`, verificado con un script aparte,
no a ojo sobre el mapa) es **9694 m — un 94% más que los 5000 m** de
`vehiculo:31.rango_vision_m`. Las dos entidades estaban `estado_movimiento:
"estacionado"` en el momento de la captura, así que no es un artefacto de
interpolación entre ticks del lado del cliente: el JSON crudo del estado ya
trae la inconsistencia.

### Hipótesis (sin ver el código del servidor, no confirmable desde acá)

- Detección **no recalculada** para entidades estacionadas: si el motor solo
  reevalúa distancias cuando alguna de las dos partes está en movimiento (o
  en un tick disparado por movimiento), un observador que detectó al blanco
  en algún momento anterior — y que desde entonces se alejó, o el blanco se
  alejó de él — puede quedar con la marca de detección pegada indefinidamente
  si ninguno de los dos vuelve a moverse.
- O, alternativamente, el chequeo de distancia en sí tiene un error de
  cálculo (radio mal aplicado, unidades mezcladas km/m, comparación contra el
  `rango_vision_m` de la entidad equivocada) que no depende del movimiento.
- Se puede descartar que sea un problema de conversión de coordenadas o de
  proyección del lado del cliente: la distancia se calculó con haversine
  directo sobre `posicion_x/y` (grados decimales, lon/lat), sin pasar por
  ninguna capa de OpenLayers ni por `radioCorregido` (eso es solo para
  dibujar el anillo en pantalla, `mapa.js`).

### Propuesta

- Confirmar que el motor de detección reevalúa **todas** las combinaciones
  observador↔objetivo activas en cada tick de 1 s, no solo las que
  involucran una entidad en movimiento — si el diseño actual es "solo
  recalcular en movimiento", agregar también un recálculo periódico
  independiente para pares que ya están marcados como detectados, así una
  detección vieja expira sola en el próximo tick si la distancia ya no da.
- Revisar el cálculo de distancia contra `rango_vision_m` puntualmente para
  este par (`vehiculo:30`/`vehiculo:31`, ejercicio 14, con las coordenadas de
  arriba) para descartar un bug de unidades o de comparación.
- Si el diagnóstico correcto es "detección vieja no expira", confirmar
  también que `entidad:perdida_de_vista` se emite en cuanto deja de cumplirse
  la condición — el cliente ya lo escucha y actualiza bien
  (`Store.quitarDeteccion`, `deteccion.js`), el problema no está ahí.

### Qué hace el frontend mientras tanto

Nada — no hay forma de que el cliente recalcule o cuestione la niebla de
guerra sin duplicar la lógica del servidor (y mantenerla sincronizada sería
peor que el problema actual). `Store.visibleParaMi`/`reconstruirObservadores`
siguen confiando en `detectado_por[]` tal cual llega, como documenta el
contrato de fase 5.

---

## 18 · Logística: km/munición/autonomía, bajas, destruidos y recarga — ~~P2~~ hecho

### Actualización 07-08-2026 — implementado

Las tres piezas de la propuesta están:

**a. `autonomia_actual` separado del odómetro.** Nuevo campo en el vehículo,
junto a `autonomia` (que pasa a ser exclusivamente el tope de catálogo) y
`distancia_recorrida` (que sigue siendo el odómetro puro, nadie lo vuelve a
tocar). Nace en `autonomia` (tanque lleno) al generar el estado desde la
base (`estadoInicialService`), al crear un vehículo en caliente
(`construccionEntidadService`) y al reconciliar el catálogo — mismo lugar
que ya inicializaba el resto de los campos en tiempo real. `movimientoManager`
lo descuenta cada tick por la distancia real avanzada (`avanzadoKm`), con
piso en `0`, en el mismo lugar donde ya sumaba al odómetro — son dos
contadores independientes desde ahí, uno nunca pisa al otro. Solo los
vehículos lo tienen: una unidad de infantería no tiene `autonomia_actual`
porque no consume combustible. Viaja también en `entidad:posicion_actualizada`
y `entidad:movimiento_completado` (solo para vehículos), así que "autonomía
restante" ya no hace falta calcularla del lado del cliente restando contra
el odómetro — es un valor que el servidor manda directo y en vivo.

**b. `logistica:recargar`** (`src/sockets/handlers/logisticaHandler.js`), con
el contrato que proponía este documento: jugador dueño de la entidad (a
través de la unidad de la que depende) o administrador — mismo criterio que
`vehiculo:establecer_base`. Rellena cada arma montada hasta su dotación de
catálogo y `autonomia_actual` hasta `autonomia`, sin pasarse nunca; si ya
estaba todo al tope, `ok: true` con `municion_repuesta`/`autonomia_repuesta`
en `0`, no un error. Rechaza si la entidad no es un vehículo, si no está en
este ejercicio, si no la controlás, o si está `destruido`. Un efecto
colateral necesario: `armamentos[]` ahora también guarda `municion` (la
dotación de catálogo de **esa** arma en **ese** vehículo, `vehiculo_armamento.municion`)
junto a `municion_actual` — antes solo se usaba una vez, al construir el
JSON, para inicializar `municion_actual`, y se perdía: sin guardar el tope
en algún lado no había contra qué comparar para rellenar. Difunde el
resultado por `ejercicio:vehiculo_modificado` (`campos: ["armamentos",
"municion_actual", "autonomia_actual"]`), el mismo evento que ya existía —
no hizo falta ninguno nuevo.

**c. Bloque `logistica{}` acumulado por el motor**, en cada unidad y cada
vehículo (`{ bajas_propias, bajas_infligidas, unidades_enemigas_destruidas,
vehiculos_enemigos_destruidos }`). Se decidió por un contador incremental en
vez de la `efectivo_inicial` que sugería la propuesta como alternativa: se
actualiza en el momento exacto en que el motor de combate aplica el daño
(`aplicarLanchester` para infantería, `dispararArmamento` para vehículos),
así que atribuye correctamente quién le hizo qué a quién —incluida la
atrición **mutua** de Lanchester, que en un mismo tick acredita bajas a las
dos puntas— sin depender de qué `efectivo` vio el cliente primero ni
romperse si un administrador resetea `efectivo` a mano más tarde. Un
"destruido" se acredita al atacante que causó la transición viva→fuera de
combate en **ese** disparo, no a quien resulte estar en el combate que se
cierra después (evita atribuir mal un `atacante_destruido`/`objetivo_destruido`
causado por otro combate concurrente). `bajas_propias` no aplica a
vehículos —no tienen `efectivo`, tienen `estado_actual`/`danio_acumulado`—
y queda siempre en `0` para ellos. Los ejercicios ya en curso al desplegar
esto tienen entidades sin este campo en su JSON: `entidadService.logisticaDe()`
lo inicializa perezosamente la primera vez que hace falta, sin necesitar
migrar archivos a mano.

**Qué no se hizo, a propósito:** `municion_usada` (el bloque `c` de la
propuesta lo marcaba como opcional, "solo si sale gratis") no se agregó —
sigue siendo `municion - municion_actual` en cada arma, tan barato de
calcular en el cliente como en el servidor, y agregarlo hubiera sido un
número más para mantener sincronizado sin necesidad real.

**Qué hizo el frontend, una vez implementado (actualización 10-08-2026):**
la sección "Qué hace el frontend mientras tanto" de más abajo quedó
**histórica** — describe los parches previos a que esto se implementara, y
ya no es lo que corre hoy. `logistica.js` se reescribió para ser
backend-authoritative en las tres piezas que antes aproximaba:

- **Bajas propias y destruidos**: ya no acumula nada en memoria ni escucha
  `combate:finalizado`. Lee directo `entidad.logistica.bajas_propias`
  (`logistica.js:182,191`) y `entidad.logistica.unidades_enemigas_destruidas`/
  `vehiculos_enemigos_destruidos` (`logistica.js:53-65`, `totalesPorBando()`)
  del estado que ya manda el motor. Como consecuencia, los contadores
  **sobreviven a un reconectar** — la nota de la UI que avisaba "se arman
  desde que te uniste a esta sesión" se sacó, porque ya no aplica.
- **Autonomía**: `panel-entidad.js` y `logistica.js` prefieren
  `autonomia_actual` tal cual llega, y solo caen a la resta vieja
  (`autonomia - distancia_recorrida`) como *fallback* para estado de un
  ejercicio viejo que no tenga el campo todavía (`panel-entidad.js:110-115`,
  patrón repetido en `necesitaRecarga()` y en `logistica.js:188-190`).
- **Recarga**: el botón ya no dispara un evento que nadie escucha.
  `logistica.js:112-134` (`recargar()`) espera el ack real de
  `logistica:recargar` y lee `municion_repuesta`/`autonomia_repuesta`, que
  acumula en un `Map` con alcance de sesión (`logistica.js:27-35`, se limpia
  en `ejercicio:contexto`) solo para mostrar una columna "reabastecido esta
  sesión" — ya no es un parche para tapar un evento inexistente, es una
  vista de conveniencia sobre una respuesta real.
- Se confirma además que `ejercicio:vehiculo_modificado` lo sigue escuchando
  `logistica.js` sin condición de rol (`logistica.js:85-91`), aparte del
  listener de `direccion.js` que sigue gateado a administrador
  (`direccion.js:1077-1078`, ahora como early-return de todo el módulo en
  vez de un chequeo por-listener) — el comportamiento neto es el mismo que
  ya documentaba este punto.

### El problema (histórico)

El frontend agregó una vista de **Logística** (`src/logistica.js`, botón 🪖 en
la barra superior) que muestra, por unidad/vehículo a cargo del jugador (o de
todo el ejercicio, agrupado por bando, para el administrador): kilómetros
recorridos, munición usada/repuesta, autonomía repuesta, bajas propias,
bajas causadas, y totales de unidades/vehículos propios y enemigos
destruidos. También se agregó un botón **"🔧 Recargar munición y autonomía"**
en el panel de entidad, para vehículos propios.

De los datos que necesita esta vista, **una parte ya existe** y otra **no
existe en absoluto**:

**Ya existe (no hace falta nada del backend):**

- `distancia_recorrida` — el odómetro, por unidad y por vehículo, ya viaja en
  `entidad:posicion_actualizada` y en el estado. Se muestra tal cual.
- `armamentos[].municion` (capacidad de catálogo) y `armamentos[].municion_actual`
  (actual) — ya viajan juntos en cada arma montada. "Munición usada" sale de
  restar los dos, sin acumular nada del lado del cliente.

**No existe:**

1. **No hay forma de que un jugador recargue.** `vehiculo:modificar` (el
   único evento que puede tocar `municion_actual`) es 👑 — un jugador no
   puede pedir que se rellene la munición ni la autonomía de su propio
   vehículo. Tiene sentido que sea una acción de **logística del jugador**,
   no una edición administrativa.
2. **`autonomia` y `distancia_recorrida` son el mismo número usado dos
   veces.** Hoy "autonomía restante" se calcula en el cliente como
   `autonomia - distancia_recorrida` (`panel-entidad.js`, ya lo hacía antes
   de este punto). Eso significa que **no se puede "recargar" autonomía sin
   pisar el odómetro** — y el odómetro es justo el dato que la logística
   necesita que nunca se toque (es "cuánto recorrió en total", no "cuánto
   combustible le queda"). Hoy son la misma resta; recargar exige que dejen
   de serlo.
3. **No hay contador de bajas, ni de destruidos, en ningún lado.** No existe
   ni `efectivo_inicial` (para saber cuántas bajas sufrió una unidad sin
   depender de haber visto su primer tick) ni ningún acumulado de "unidades/
   vehículos destruidos" por unidad, por jugador o por bando. Lo único que
   hay es el estado instantáneo (`efectivo` actual, `estado_actual`) y los
   eventos de combate en vivo (`combate:tick`, `combate:finalizado`), que no
   se guardan en ningún lado más allá del tick en curso.

### Qué hacía el frontend mientras tanto (histórico — ver la actualización de arriba)

⚠️ Esta sección describe el parche **previo** a la implementación del punto
18. Quedó como historial de por qué se pedía cada pieza; el comportamiento
real hoy es el de "Qué hizo el frontend, una vez implementado" más arriba.

`logistica.js` armaba los tres puntos que faltaban **acumulando en memoria,
durante la sesión del cliente**, con lo que ya llegaba por eventos que sí existían:

- **Bajas propias**: guarda el primer `efectivo` que vio para cada unidad
  (al indexarla) como base, y resta contra el actual. Si el jugador se unió
  después de que la unidad ya había sufrido bajas, el número queda corto —
  es una aproximación, avisada en la propia UI ("Los contadores de bajas...
  se arman desde que te uniste a esta sesión").
- **Destruidos propios/enemigos**: escucha `combate:finalizado` y, si el
  `motivo` es `objetivo_destruido` o `atacante_destruido`, acredita la baja
  al bando de la víctima y la baja infligida a quien atacó — con una guarda
  para no contar dos veces la misma entidad. Se pierde al recargar la app o
  reconectar (no hay snapshot que restaurar).
- **Recarga**: el botón del panel de entidad emite un evento que **todavía
  no existe del lado del servidor** (`logistica:recargar`, propuesta abajo).
  No se simula ningún resultado en el cliente — si el backend no lo conoce,
  el `ack` nunca llega y `Socket.emitir` corta con su timeout normal de 15 s
  ("El servidor no respondió a..."), que ya maneja el botón mostrando el
  error. Nada de fabricar un "reabastecido" falso del lado del cliente.

### Propuesta

**a. Separar el combustible del odómetro.** Nuevo campo `autonomia_actual`
en el vehículo (junto al ya existente `autonomia`, que pasa a ser
únicamente el máximo de catálogo — mismo patrón que `municion`/
`municion_actual` por arma). `distancia_recorrida` sigue siendo el odómetro
puro, nunca se resetea ni se toca al recargar. "Autonomía restante" pasa a
ser `autonomia_actual` tal cual, no una resta contra el odómetro.

```jsonc
// vehiculo, campo nuevo junto a los que ya existen
{ "autonomia": 400, "autonomia_actual": 235.5, "distancia_recorrida": 812.3 }
```

`autonomia_actual` arranca en `autonomia` (tanque lleno) y el motor de
movimiento lo descuenta igual que hoy descuenta contra el odómetro — la
única diferencia es que ahora hay dos números en vez de uno, y sólo el
segundo se puede recargar.

**b. `logistica:recargar` — jugador dueño de la entidad, o 👑.**

```js
// cliente → servidor
socket.emit("logistica:recargar", {
  ejercicio_id: 7, entidad_tipo: "vehiculo", entidad_id: 12,
}, (res) => {
  // { ok: true,
  //   municion_repuesta: { "4": 12, "5": 3 },   // armamento_id -> cuánto se agregó
  //   autonomia_repuesta: 164.5 }                // km agregados, tope en `autonomia`
});
```

Rellena **cada arma montada** hasta su `municion` de catálogo (nunca más
allá, aunque se pida varias veces seguidas: si ya está al tope, `ok: true`
con los dos campos en `0`, no un error) y `autonomia_actual` hasta
`autonomia`. Rechaza igual que cualquier otra acción de entidad: `403` si no
la controla, `404` si no existe en el ejercicio, sin efecto si el vehículo
está `destruido` (mensaje explícito, no un `ok: true` mudo).

Difunde el resultado por **`ejercicio:vehiculo_modificado`** (el evento que
ya existe, fase 8) a toda la room del ejercicio — no un evento nuevo — con
`armamentos[]` y `autonomia_actual` actualizados, exactamente como cualquier
otra modificación de vehículo. Importante: hoy ese evento solo lo escucha
`direccion.js`, y solo si `Session.esAdmin()` — el frontend ya agregó un
listener aparte en `logistica.js` que corre para **todos**, así que del
lado del cliente esta parte ya está resuelta; no hace falta pedirle nada
extra al backend en este punto, alcanza con que seguir emitiendo el evento
existente a la room completa como ya se documenta en `frontend.md`
(Apéndice B).

**c. Contadores agregados, persistidos en el JSON del ejercicio.** Un bloque
`logistica` por unidad (y, si sale barato, uno por jugador/bando a nivel
raíz del estado) que el motor mantenga y que sobreviva a un reconectar —
hoy el cliente lo pierde apenas recarga la página:

```jsonc
// dentro de cada unidad/vehículo del estado
"logistica": {
  "municion_usada": 48,          // ya derivable hoy sin este campo (municion - municion_actual);
                                  // incluirlo solo si sale gratis del mismo cálculo que hace el motor
  "bajas_propias": 12,           // reemplaza la aproximación de "primer efectivo visto"
  "bajas_infligidas": 30,
  "unidades_enemigas_destruidas": 1,
  "vehiculos_enemigos_destruidos": 2
}
```

No hace falta todo de una: lo único que el frontend **no puede** aproximar
de ningún modo hoy es `bajas_propias` con una base confiable (depende de
`efectivo_inicial`, que no existe) y los contadores de destruidos que
sobrevivan a una reconexión. Si el backend prefiere resolver esto en dos
pasos, ese es el orden de prioridad.

**d. Nada de esto va a Postgres.** Ni `autonomia_actual` ni el bloque
`logistica` son columnas nuevas: viven en el mismo JSON por ejercicio donde
ya vive `efectivo`, `distancia_recorrida` y `danio_acumulado` — se
recalculan/regeneran igual que el resto del estado en vivo, no hace falta
persistencia relacional para esto.

---

## 19 · Boletines dirigidos a un solo bando — ~~P2~~ hecho

### Actualización 10-08-2026 — implementado

`boletin:enviar` acepta `{ ejercicio_id, texto, bando? }`, exactamente el
contrato propuesto abajo (`src/sockets/handlers/boletinHandler.js`):

- `bando` es opcional. Si viene, se valida contra el mismo dominio cerrado
  del punto 7 (`bandoService.esBandoValido`, `"azul"`/`"rojo"`) — si no
  matchea, el ack vuelve `{ ok: false, error: "bando inválido" }` (el
  equivalente socket del `400` de la propuesta).
- Con `bando` válido, `boletin:nuevo` se emite solo a
  `ejercicio_{id}_bando_{bando}` (`roomBando`, la misma room que ya usan
  `chat:mensaje` y `entidad:detectada`/`perdida_de_vista`) — no se creó
  ninguna room nueva.
- Sin `bando`, comportamiento sin cambios: `ejercicio_{id}_rol_jugador`,
  todos los jugadores.
- El shape de `boletin:nuevo` no cambió (`{ texto, timestamp, ... }`); el
  bando no viaja en el evento, tal como pedía la propuesta.
- El administrador que emite el boletín sigue sin recibirlo de vuelta, con o
  sin bando.

**Corrección 10-08-2026:** este párrafo decía que `API.md` ya documentaba el
`bando?` opcional — no es así, `API.md` es el contrato **REST** y los
boletines son Socket.IO puro, así que nunca tuvieron sección ahí (confirmado:
`grep -i boletin API.md` no encuentra nada, ni la tuvo antes de este punto).
El contrato de socket vive en `frontend.md` (fase 7 y Apéndice B), que ya se
actualizó para incluir `bando?`. La nota de alerta (`pd-nota-alerta`) del
selector "Un bando" en `direccion.js` se sacó — el filtrado ya es real, no
solo una promesa de UI.

### El problema (histórico)

`boletin:enviar` (`frontend.md`, fase 7) solo acepta `{ ejercicio_id, texto }`
y el servidor siempre emite `boletin:nuevo` a la room `ejercicio_{id}_rol_jugador`
— **todos** los jugadores del ejercicio, sin importar el bando. No hay forma
de que el administrador le hable solo al bando azul o solo al rojo; hoy tiene
que redactar dos boletines con aclaraciones tipo "solo para el bando azul" y
confiar en que el bando rojo lo ignore, lo cual no es niebla de guerra real:
ambos bandos escuchan y ven el texto igual.

Es la misma asimetría que ya resolvió el chat de bando (`chat:enviar`, fase 7)
y la detección (fase 5): las dos ya filtran por la room
`ejercicio_{id}_bando_{bando}` que el servidor arma al `ejercicio:unirse`
(`frontend.md`, Apéndice A). Boletines es el único de los tres canales de
comunicación que no tiene la opción de acotarse a un bando.

### Propuesta

Agregar un `bando` **opcional** al payload de `boletin:enviar`. Sin el campo,
comportamiento actual (todos los jugadores) — es un agregado aditivo, no rompe
nada existente.

```js
// cliente → servidor, 👑
socket.emit("boletin:enviar", {
  ejercicio_id: 7,
  texto: "Atención. La unidad Alfa avanzó al sector norte.",
  bando: "azul",   // opcional; se omite (o null) = todos los jugadores, como hoy
}, cb);
```

Del lado del servidor:

- Si `bando` está presente, validarlo contra el mismo dominio cerrado del
  punto 7 (`"azul"` / `"rojo"`) y devolver `400` si no matchea.
- Si `bando` está presente, emitir `boletin:nuevo` **solo** a
  `ejercicio_{id}_bando_{bando}` en vez de `ejercicio_{id}_rol_jugador` — la
  misma room que ya usan `chat:mensaje` y `entidad:detectada`/`perdida_de_vista`,
  no hace falta crear una room nueva.
- Si `bando` no está, comportamiento actual sin cambios: `ejercicio_{id}_rol_jugador`.
- El shape de `boletin:nuevo` no cambia (`{ texto, timestamp }`); no hace
  falta devolver el `bando` al cliente porque quien lo recibe ya sabe a qué
  bando pertenece.
- Igual que hoy, el administrador que lo emitió no lo recibe de vuelta.

### Qué hizo el frontend (histórico + actualizado 10-08-2026)

El panel de dirección (`direccion.js`, sección Boletín) tiene el selector de
destinatario — "Todos los jugadores" o "Un bando" con un `<select>` azul/rojo
(`Sidc.opcionesBando`) — y manda `bando` en el payload de `boletin:enviar`
cuando se elige un bando específico.

Mientras el backend no filtraba, la UI mostraba una nota de alerta
(`pd-nota-alerta`) avisando que el mensaje salía igual a todos los bandos.
**Ahora que el filtrado es real (ver la actualización arriba), esa nota se
sacó** — ya no hay ninguna promesa vacía que corregir en el cliente para
este punto.

Los boletines emitidos por el propio administrador se listan localmente
(`Store.agregarBoletin`) con el bando elegido (o "Todos") para que quede
registro de qué se intentó mandar a quién, aunque el servidor no lo haya
podido filtrar.

---

## 20 · Hora táctica autoritativa del servidor — ~~P2~~ hecho

### Actualización 10-08-2026 — implementado

Las cuatro piezas de la propuesta están, todas del lado del servidor:

**a. `hora_tactica` autoritativa.** Vive en `estado.ejercicio.hora_tactica`
(ISO 8601), sin columna nueva en Postgres — nace en la hora real del
servidor al generar el estado por primera vez (`estadoInicialService.generarEstadoInicial`).
El `CombateEngine` (`src/services/combateEngine.js`, `avanzarHoraTactica`)
la avanza en el mismo ciclo de 1 s que ya evalúa detección y combate —no se
creó un intervalo aparte—: `CICLO_MS * velocidad_ejercicio` de reloj
táctico por cada segundo real, releyendo `velocidad_ejercicio` del estado en
cada ciclo. Se difunde cada ciclo a `ejercicio_{id}` con `ejercicio:hora_tactica
{ ejercicio_id, hora_tactica, velocidad_ejercicio }`, reutilizando el tick
que ya existía en vez de crear uno nuevo, tal como sugería la propuesta.

**b. Se pausa y reanuda sola, sin contrato nuevo.** Como el `CombateEngine`
ya corta su intervalo entero en `ejercicio:pausar`/`ejercicio:detener` y lo
retoma en `ejercicio:iniciar` (`cambiarEstado`/`combateEngine.iniciar`), y
`hora_tactica` solo avanza dentro de ese ciclo, congelarla y retomarla desde
donde quedó salió gratis: no hizo falta tocar `ejercicioHandler.js` para
esto. Restaurar un checkpoint (`ejercicio:cargar_estado`) también revierte
`hora_tactica` junto con el resto del snapshot, que es lo esperable.

**c. `ejercicio:establecer_hora_tactica`** 👑 existe con el contrato
propuesto: `{ ejercicio_id, hora_tactica }` → ack `{ hora_tactica }`. No
exige que el ejercicio esté `activo` (usa `exigirEjercicioCargado`, no
`exigirEjercicioActivo`), así que también se puede corregir con el
ejercicio pausado. `400` (ack `ok:false`) si `hora_tactica` no parsea como
fecha. Difunde `ejercicio:hora_tactica` de inmediato en vez de esperar al
próximo ciclo, tal como pedía la propuesta.

**d. `velocidad_ejercicio` entero, de efecto inmediato.** `POST`/`PUT
/ejercicios/:id` (`src/routes/ejercicios.js`) ahora exigen `Number.isInteger`,
`400` si no. Y como la base queda en solo lectura una vez que el ejercicio
tiene JSON (nada se sincroniza de vuelta), el `PUT` ahora converge en
caliente: si el archivo ya existe, escribe también
`estado.ejercicio.velocidad_ejercicio` y emite `ejercicio:hora_tactica` —
mismo patrón que ya usa `reafiliarParticipante` para el bando. El motor ya
releía `velocidad_ejercicio` del estado en cada tick/ciclo (movimiento,
Lanchester, cadencia de armamento, y ahora también la hora táctica), así que
con la sincronización del `PUT` el cambio tiene efecto en el próximo ciclo,
no recién al reiniciar. La UI que ya fuerza enteros
(`direccion.js`/`ejercicios-ui.js`/tarjeta de selección) puede dejar de ser
la única validación: el servidor ahora la respalda.

**Corrección 10-08-2026:** este párrafo decía que `API.md` ya documentaba una
sección "Hora táctica" — no es así, `hora_tactica` y
`ejercicio:establecer_hora_tactica` son Socket.IO puro (igual que el punto
19), así que el contrato completo vive en `frontend.md` (fase 8, sección
"Hora táctica", más el estado de fase 3 y los Apéndices A/B), que ya se
actualizó. Lo único que sí es REST — `velocidad_ejercicio` como entero en
`PUT /ejercicios/:id`, con convergencia en caliente — se agregó a `API.md`
en su sección correspondiente. El cálculo local aproximado de
`actualizarRelojes()` (`app.js`) se sacó: el cliente pinta `hora_tactica`
tal cual llega por `ejercicio:hora_tactica`, igual que cualquier otro campo
del estado.

⚠️ **Criterio de aceptación, cierra el punto abierto de la propuesta
(d):** la propuesta original dejaba sin decidir si el multiplicador debía
acelerar solo el reloj o **todo** el ejercicio, y pedía avisar cuál era el
caso real. Queda saldado como requisito duro, no opcional: **cambiar
`velocidad_ejercicio` con el ejercicio corriendo (activo o pausado) tiene
que reflejarse en el próximo ciclo del motor — reloj táctico, movimiento y
combate por igual —, nunca recién al reiniciar.** Es lo que ya describe
este párrafo (`PUT` converge en caliente, el motor relee el campo por
ciclo), pero si en algún momento se detecta que alguna de las tres piezas
(reloj, movimiento, combate) queda desfasada del multiplicador vigente
mientras el ejercicio corre, es una regresión de este punto, no un
comportamiento aceptable a documentar aparte.

### El problema (histórico)

Hoy el reloj llamado "HORA TÁCTICA" en la cabecera (`index.html`, recién
renombrado — antes decía "UTC") es una ficción **100% del cliente**: se
calcula como `hora local + offset de huso horario` (`app.js` →
`actualizarRelojes()`), sin ninguna relación con el ejercicio. Consecuencias
concretas:

1. **No la fija el servidor.** No hay ningún campo `hora_tactica` en el JSON
   del ejercicio (`frontend.md` no lo documenta en ningún lado del estado) —
   cada cliente la calcula por su cuenta a partir de su propio reloj de
   sistema, así que dos clientes con el reloj del sistema desincronizado ven
   horas tácticas distintas.
2. **El administrador no la puede fijar a mano.** No hay ningún evento para
   decir "la hora táctica del ejercicio es tal fecha/hora" — a diferencia de
   otros valores del ejercicio (posición, visibilidad, logística), que sí
   tienen un camino de edición en caliente.
3. **No se pausa con el ejercicio.** `ejercicio:pausar` corta movimiento y
   combate (`frontend.md`, fase 8), pero el reloj de la cabecera sigue
   corriendo en tiempo real porque es un `setInterval` ajeno al estado del
   ejercicio — un jugador puede ver el reloj avanzar mientras nada más se
   mueve, lo cual es inconsistente con la idea de "tiempo del ejercicio".
4. **El multiplicador (`velocidad_ejercicio`) no la acelera en vivo.** El
   campo existe (`numeric` en Postgres, editable por `PUT /ejercicios/:id` y
   desde el panel de dirección, `direccion.js` → sección "Hora táctica"), y
   la UI ya lo describe como "acelera el reloj del ejercicio" — pero
   cambiarlo con el ejercicio corriendo **no tiene ningún efecto observable**
   hasta el próximo reinicio (confirmado por el propio código: el toast que
   se mostraba decía literalmente *"el multiplicador se aplica al reiniciar
   el ejercicio si el motor ya estaba corriendo"*). Además el campo acepta
   **decimales** (`step="0.01"` en el formulario de alta/edición de
   ejercicio) cuando la mecánica pedida es que el multiplicador sea siempre
   un **entero** (×2 = los segundos avanzan de 2 en 2; ×2.5 no tiene una
   lectura natural en un reloj de segundos enteros).

### Propuesta

**a. `hora_tactica` como campo autoritativo del ejercicio**, junto a
`estado`, `inicio` y `velocidad_ejercicio` (mismo JSON del ejercicio,
`frontend.md` fase 3/8 — no hace falta columna nueva en Postgres, es estado
en vivo como `efectivo` o `distancia_recorrida`):

```jsonc
// dentro de "ejercicio" en el estado
{ "estado": "activo", "velocidad_ejercicio": 2, "hora_tactica": "2026-08-10T14:32:07.000Z" }
```

- Nace en algún valor base al generar el estado por primera vez (la hora real
  del servidor en ese momento es una opción razonable por defecto, salvo que
  el administrador la haya fijado antes de iniciar).
- El motor la avanza **un tick por segundo real, multiplicada por
  `velocidad_ejercicio`** — mismo patrón que ya usa para mover entidades
  (`movimientoManager`, un tick/seg), solo que acá el "avance" es sobre un
  reloj en vez de sobre una posición.
- Se difunde en el tick que ya existe o en uno dedicado — lo que salga más
  barato de enganchar al lado del motor. Si ya hay un tick de 1 Hz que le
  llega a todos los clientes de la room del ejercicio (el de movimiento), lo
  más simple es sumarle `hora_tactica` al payload en vez de crear un evento
  nuevo. Si no, un evento liviano tipo `ejercicio:hora_tactica { ejercicio_id,
  hora_tactica }` a la room `ejercicio_{id}` alcanza.

**b. Se pausa y reanuda con el ejercicio, sin evento aparte.**
`ejercicio:pausar` congela el avance de `hora_tactica` (deja de tickear,
igual que deja de tickear el movimiento); `ejercicio:iniciar` sobre un
ejercicio pausado la retoma desde donde quedó, no la resetea. No hace falta
un contrato nuevo para esto: es el mismo `estado` (`activo`/`pausado`) que ya
gatea todo lo demás, aplicado también al tick del reloj.

**c. Evento para que el administrador fije la hora a mano.**

```js
// cliente → servidor, 👑
socket.emit("ejercicio:establecer_hora_tactica", {
  ejercicio_id: 7,
  hora_tactica: "2026-08-10T06:00:00.000Z",
}, (res) => {
  // { ok: true, hora_tactica }
});
```

Reglas sugeridas: solo administrador (`403` si no), `400` si `hora_tactica`
no parsea como fecha válida. Difunde el nuevo valor por el mismo canal del
punto (a) — no hace falta un evento servidor→cliente aparte, el próximo tick
ya lo lleva, aunque para que el cambio se vea al instante (sin esperar hasta
1 s) puede convenir emitirlo también de inmediato como parte del ack o de un
evento explícito.

**d. `velocidad_ejercicio` pasa a ser entero, con efecto inmediato.**
Agregar la validación de entero (`Number.isInteger`, `400` si no) a
`PUT /ejercicios/:id` — hoy acepta cualquier `numeric` positivo. Y lo más
importante: el motor tiene que leer `velocidad_ejercicio` **en cada tick**
(o releerlo cuando cambie) al calcular cuánto avanza `hora_tactica`, no
solo al generar el estado inicial — es lo que hace que cambiar el
multiplicador con el ejercicio corriendo tenga efecto ya, no recién al
reiniciar. Si el motor de movimiento también usa este multiplicador para
la velocidad de las entidades (no solo el reloj), aplicar el mismo criterio
ahí sería consistente, pero no es parte de este pedido si hoy es un
comportamiento aparte — avisar cuál es el caso real.

### Qué hizo el frontend (histórico + actualizado 10-08-2026)

- **Overlay de pausa a pantalla completa** (`index.html` → `#pausa-overlay`,
  estilos en `estilos-simtac.css`, lógica en `app.js` →
  `actualizarOverlayPausa()`): cubre el 100% de la interfaz con
  "EJERCICIO PAUSADO" para cualquier sesión que **no** sea administrador
  mientras `Store.estadoEjercicio() === 'pausado'`, y desaparece solo al
  volver a `activo`. Es 100% cliente y no cambió con este punto — ya
  funcionaba con el `estado`/`ejercicio:estado_cambiado` que el backend ya
  emitía antes.
- **Reloj táctico: ahora pinta lo que manda el servidor, sin calcular nada.**
  Mientras `hora_tactica` no existía, `app.js` → `actualizarRelojes()`
  aproximaba el reloj en el cliente (congelándolo en pausa, multiplicando el
  avance) — esa lógica **se sacó entera**. Ahora:
  - `registrarEventosDelEjercicio()` (`app.js`) escucha
    `ejercicio:hora_tactica` y guarda `hora_tactica`/`velocidad_ejercicio`
    tal cual llegan en `Store.estado.ejercicio`.
  - `actualizarRelojes()` pinta ese valor directo, sin recalcular nada; solo
    cae a la vieja aproximación (hora local + offset) si todavía no hay
    ejercicio o el campo no llegó (compatibilidad con un estado viejo).
  - Como el servidor deja de emitir el tick mientras el ejercicio está
    pausado, el reloj mostrado queda solo en el último valor recibido —
    "congelado" sale gratis, no hace falta que el cliente detecte la pausa.
- **Panel de dirección: modal para fijar la hora a mano** (`direccion.js`,
  sección Control → "Hora táctica"): un botón "🕓 Fijar hora táctica…" abre
  `abrirModalHoraTactica()`, un modal (`.pd-modal`, mismo componente que ya
  usa la edición en caliente de entidades) con un `<input
  type="datetime-local">` precargado con la hora actual y un botón "Fijar"
  que emite `ejercicio:establecer_hora_tactica`. El botón que abre el modal
  está habilitado solo si el ejercicio ya se inició al menos una vez (mismo
  criterio que `exigirEjercicioCargado` del lado del servidor). El panel de
  Control también muestra la hora táctica actual como texto informativo,
  fuera del modal.
- **Multiplicador entero en toda la UI**: los tres lugares donde se
  edita/muestra `velocidad_ejercicio` — el control de dirección, el
  alta/edición de ejercicio (`ejercicios-ui.js`) y la tarjeta de selección
  de ejercicio — fuerzan/validan entero (`Number.isInteger`, `step="1"`,
  `min="1"`). Ahora el servidor también lo valida (punto (d) de la
  actualización), así que esta UI ya no es la única barrera — pero se deja
  igual para dar el error antes de golpear la red.

---

## Cómo hablamos hoy

Para contexto de quien tome estos pedidos:

- **REST** en `http://node.localhost` — CRUD de configuración (fase 2). Ids como
  **string**. Token en `Authorization: Bearer`.
- **Socket.IO** — todo lo que pasa durante el ejercicio (fases 3 a 8). Ids como
  **number**. Toda acción del cliente usa **ack**: `socket.js` → `emitir()`
  devuelve una promesa que rechaza con el mensaje del backend cuando
  `ok: false`, y con timeout propio si no hay respuesta. Cualquier evento nuevo
  tiene que responder ack para encajar.
- El cliente normaliza ids a `Number` en el borde (`store.js`), así que la
  asimetría string/number no es un problema mientras se mantenga consistente.
