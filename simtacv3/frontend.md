# Guía de implementación del frontend — simtac

Sistema de ejercicios militares tácticos. Este documento le dice al frontend (Tauri v2) **qué consumir del backend y en qué orden construirlo**.

Fuentes de verdad del contrato, que este documento resume:

- `nodejs/API.md` — endpoints REST y eventos de socket, con payloads completos.
- `nodejs/DATABASE.md` — tablas, columnas y relaciones (para las pantallas de configuración).

Si algo de acá contradice esos dos archivos, mandan ellos.

---

## Regla de oro

> **El frontend es exclusivamente una capa de presentación e interacción.** Renderiza el estado que recibe del backend, captura las acciones del usuario y las envía como eventos Socket.IO. **No implementa lógica de negocio.**

Concretamente, esto **no** va en el frontend:

- calcular posiciones, distancias o tiempos de desplazamiento;
- decidir si dos entidades están en rango, resolver combate o calcular daño;
- decidir qué puede hacer un rol (validalo igual en la UI para no ofrecer botones muertos, pero **el backend es quien autoriza**);
- persistir estado del ejercicio en disco o en la base.

El backend mantiene el estado en un archivo JSON por ejercicio y lo emite. El frontend lo dibuja.

---

## Antes de escribir la primera línea: siete trampas

Estas son las que más tiempo hacen perder. Vale la pena leerlas ahora.

**1. Los ids llegan con tipos distintos según la fuente.**
En **REST** los ids son `bigint` de Postgres y `pg` los serializa como **string** (`"14"`). En el **JSON del ejercicio** (socket) los mismos ids son **number** (`14`). Nunca compares con `===` entre una fuente y la otra. Normalizá en el borde: convertí todo a `Number` al entrar al store.

**2. `x` es longitud, `y` es latitud.** En todo el sistema: `posicion_x: -99.1332` (lon), `posicion_y: 19.4326` (lat). Casi todas las librerías de mapas esperan `[lat, lng]` — vas a tener que invertir. Escribí un único helper y usalo siempre.

**3. Toda acción de socket usa ack.** Nunca asumas que un `emit` funcionó.

```js
socket.emit("entidad:mover", payload, (res) => {
  if (!res.ok) return mostrarError(res.error);
  // res trae además los datos de la operación
});
```

**4. El evento `error` se emite ADEMÁS del ack.** Cuando una acción se rechaza, el backend responde `{ ok: false, error }` en el ack **y** emite `error: { evento, error }` al socket. Si mostrás un toast en los dos lugares vas a duplicar el mensaje. Recomendado: manejar el error en el ack (que sabe qué acción fue) y usar el listener global solo para log.

**5. `ejercicio:estado_inicial` puede llegar en cualquier momento.** No es solo la respuesta a `unirse`: también llega cuando el admin inicia, restaura un estado anterior, confirma un rebobinado o cambia de ejercicio. Tratalo siempre como **"reemplazá todo el estado"**, nunca como un merge.

**6. Al reconectar hay que volver a emitir `ejercicio:unirse`.** Socket.IO reconecta solo, pero las rooms se pierden. Sin ese re-emit dejás de recibir todo.

**7. `node.localhost` no lo resuelve el lado Rust de Tauri.** El WebView (navegador) sí, por la regla de RFC 6761. El resolver de Node/Rust no. Si hacés alguna llamada desde el proceso nativo, apuntá a la IP o agregá la entrada a `/etc/hosts`.

---

## Fases de desarrollo

Cada fase deja la app en un estado usable. No arranques la siguiente sin cerrar los criterios de aceptación de la anterior.

| Fase | Qué queda funcionando |
|---|---|
| 0 | Proyecto, cliente HTTP/socket, sesión |
| 1 | Login y elección de ejercicio |
| 2 | Pantallas de configuración (admin) |
| 3 | Mapa con el estado del ejercicio en vivo |
| 4 | Mover unidades y vehículos |
| 5 | Detección y niebla de guerra |
| 6 | Combate |
| 7 | Chat, documentos y boletines |
| 8 | Panel de dirección del administrador |

---

## Fase 0 — Cimientos

**Objetivo:** infraestructura sin pantallas de negocio.

### Qué construir

**Cliente HTTP** con base `http://node.localhost`, header `Authorization: Bearer <token>` y manejo centralizado de errores. Todos los errores del backend tienen la misma forma:

```json
{ "error": "mensaje legible" }
```

Códigos: `400` validación, `401` token inválido/expirado, `403` rol insuficiente, `404` no existe, `409` conflicto (duplicado o relación), `500` interno.

**Manejo de sesión con dos tokens:**

| Token | Vida | Uso |
|---|---|---|
| `token` (access) | 8 h | Header REST y handshake del socket |
| `refreshToken` | 7 días | Solo `POST /auth/refresh` |

⚠️ **El refresh token rota**: cada llamada a `/auth/refresh` devuelve uno nuevo y el anterior deja de servir. Guardá el nuevo siempre. Implementá un interceptor: ante un `401`, intentá refrescar una vez, reintentá la request original, y si el refresh también falla, mandá a login.

Guardá los tokens con el store seguro de Tauri, no en `localStorage`.

**Cliente Socket.IO** con el access token en el handshake:

```js
import { io } from "socket.io-client";

const socket = io("http://node.localhost", { auth: { token } });

socket.on("connect_error", (err) => {
  // "Token requerido" | "Token inválido o expirado"
  // -> refrescar el token y reconectar, o ir a login
});
```

Si refrescás el token, actualizá `socket.auth.token` y reconectá — el handshake viejo no se revalida solo.

**Store de estado** con al menos: sesión (usuario, rol, tokens), ejercicio actual (el JSON completo), y colecciones derivadas indexadas por `"tipo:id"` para lookup O(1) (`"unidad:10"`, `"vehiculo:5"`). Esa clave compuesta es la misma que usa el backend en `detectado_por[]`.

**Tipos.** Escribí los tipos del JSON del ejercicio una sola vez (ver el esquema completo en `API.md`, sección 12). Es el objeto que vas a tocar en todas las fases siguientes.

### Criterios de aceptación

- La app conecta el socket y sobrevive a un reinicio del backend (reconecta sola).
- Un `401` dispara refresh transparente sin sacar al usuario.

---

## Fase 1 — Login y selección de ejercicio

**Objetivo:** entrar y elegir en qué ejercicio se va a trabajar.

### Endpoints

| Método | Ruta | Notas |
|---|---|---|
| `POST` | `/auth/login` | `{ usuario, password }` |
| `POST` | `/auth/refresh` | `{ refreshToken }` |
| `GET` | `/auth/me` | revalidar sesión al abrir la app |
| `GET` | `/ejercicios/disponibles` | ejercicios activos que le corresponden al usuario |
| `POST` | `/auth/register` | alta de usuario (siempre nace con rol `jugador`) |

Respuesta de login:

```json
{
  "token": "eyJ...",
  "refreshToken": "eyJ...",
  "usuario": {
    "id": "14", "usuario": "jperez", "nombre": "Cap. García", "grado": "Capitán",
    "rol": "jugador",
    "ejercicios_asignados": [
      { "id": "6", "nombre": "EJERCICIO 1", "sala": "SALA 1",
        "activo": true, "velocidad_ejercicio": "1.00", "bando": "azul" }
    ]
  }
}
```

### Qué construir

- Pantalla de login.
- Pantalla de selección de ejercicio a partir de `ejercicios_asignados` (o `GET /ejercicios/disponibles`, que devuelve lo mismo y sirve para refrescar sin re-loguear).
- Ruteo por rol: `administrador` ve el panel de dirección, `jugador` va directo al mapa.

### Trampas

- **Solo hay dos roles: `jugador` y `administrador`.** El valor `"usuario"` fue renombrado a `"jugador"`; si portás código viejo, actualizá el literal.
- **`ejercicios_asignados` NO viene dentro del JWT.** Se relee de la base en cada login/refresh, a propósito: la asignación puede cambiar durante las 8 h del token. No lo cachees indefinidamente.
- Para un **administrador**, `bando` viene `null` en todos los ejercicios: no tiene bando propio, actúa sobre los dos.
- `velocidad_ejercicio` llega como **string** (`"1.00"`), es `numeric` en Postgres — pero el valor siempre es entero: `PUT /ejercicios/:id` rechaza decimales desde el punto 20 de `backend.md`.

### Criterios de aceptación

- Login, refresh automático y logout (descartar tokens; no hay endpoint de logout, es JWT sin estado).
- Un jugador solo ve sus ejercicios; un admin ve todos los activos.

---

## Fase 2 — Configuración (REST)

**Objetivo:** las pantallas CRUD que se usan **antes** de arrancar un ejercicio. Todo esto es REST puro; el socket todavía no entra en juego.

👑 = requiere `rol: "administrador"`.

### Catálogos

| Recurso | Endpoints | Qué es |
|---|---|---|
| Usuarios | `GET /usuarios`, `GET /usuarios/:id`, `POST` 👑, `PUT` 👑, `DELETE` 👑 | `POST /usuarios` 👑 (con `rol` opcional, default `"jugador"`) es el alta desde el panel — no hace falta registrar y después `PUT` para dar de alta un administrador. `POST /auth/register` sigue siendo el alta pública, siempre `jugador` |
| Plantillas de unidad | `GET|POST|PUT|DELETE /unidades/base` 👑 | acá viven `sidc`, `quantity` (efectivos), `velocidad_movimiento`, `rango_vision_m` |
| Unidades (instancias) | `GET /unidades`, `GET /unidades?ejercicioId=`, `/unidades/mias`, `/unidades/:id`, `POST|PUT|DELETE` 👑 | ~32 campos "modifier" de MIL-STD-2525/APP-6, todos opcionales. Con `?ejercicioId=` el servidor cruza controladores × participantes y agrega `bando` ya resuelto — no arrastres esa lógica al cliente |
| Controladores de unidad | `GET|POST /unidades/:id/usuarios`, `DELETE /unidades/:id/usuarios/:usuarioId` 👑 | quién comanda cada unidad. `POST` da **`409`** si la unidad ya tiene otro controlador que participa del mismo ejercicio (una unidad, un controlador, por ejercicio); `DELETE` da **`409`** si es el único controlador |
| Armamento | `GET|POST|PUT|DELETE /armamento` 👑 | sistemas de armas |
| Plantillas de vehículo | `GET|POST|PUT|DELETE /vehiculos/base` 👑 | |
| Armas montadas | `GET|POST /vehiculos/base/:id/armamentos`, `DELETE .../:armamentoId` 👑 | con munición por arma |
| Vehículos (instancias) | `GET /vehiculos?ejercicioId=`, `POST|PUT|DELETE` 👑 | `nombre` es de la instancia (si no se manda, se ve el de la plantilla). La asignación (`unidad_padre_tipo` + `unidad_padre_id`) es obligatoria: un vehículo nunca queda suelto |
| Rutas | `GET /rutas?ejercicioId=`, `POST|PUT|DELETE` 👑 | waypoints terrestres |
| Ejercicios | `GET|POST|PUT|DELETE /ejercicios` 👑 | |
| Participantes | `GET /participantes` 🔒 (todos, con `ejercicio_id`/`ejercicio_nombre` en cada fila), `GET /participantes?ejercicioId=` 🔒, `GET|POST /ejercicios/:id/participantes`, `PUT|DELETE .../:usuarioId` 👑 | usuario + bando. Para una tabla de participantes que cruce ejercicios, `GET /participantes` evita un `GET /ejercicios/:id/participantes` por cada uno |

### Qué construir

**Editor de plantillas de unidad.** Recordá que `sidc`, `tipo` y `quantity` viven en la **plantilla**, no en la instancia: si el formulario de una unidad deja editar esos campos, el `PUT` va a `/unidades/base/:id`, no a `/unidades/:id`.

**Editor de unidades: posición base ≠ posición actual.** `unidad_militar` tiene dos pares de coordenadas: `posicion_base_x`/`posicion_base_y` (el orden de batalla — solo lo toca este formulario) y `pos_x`/`pos_y` (dónde está *ahora*, la pisa el motor de movimiento durante el ejercicio; no la edites acá). El formulario de configuración solo necesita pedir la **base**: si no mandás `pos_x`/`pos_y` al crear, la unidad arranca en su base. `POST /unidades` también exige `usuarioId` (el controlador inicial) — una unidad no puede quedar sin controlador.

**Bando: no se edita en la unidad ni en el vehículo.** Es un dominio cerrado (`"azul"` | `"rojo"`) que se define **una sola vez**, al asignar el bando de un participante (`PUT /ejercicios/:id/participantes/:usuarioId`), y de ahí baja por la cadena de asignaciones hasta cada unidad y vehículo. `POST`/`PUT /unidades` y `POST`/`PUT /vehiculos` **rechazan con `400`** si el body trae `bando` o `posicion_base_x`/`posicion_base_y` (en vehículos) — no los mandes, ya no existen como campos editables ahí. `GET /unidades?ejercicioId=` y `GET /vehiculos` ya devuelven `bando` resuelto para colorear el símbolo.

**Editor de vehículos con armamento.** `GET /vehiculos/base` ya devuelve los armamentos **aplanados** en `armamentos[]`, no hace falta una segunda llamada:

```json
{
  "id": "1", "nombre": "Tanque T-72", "tipo": "tierra",
  "velocidad_desplazamiento": "60.00", "umbral_danio": "100.00", "rango_vision_m": "10000.00",
  "armamentos": [
    { "armamento_id": 1, "nombre": "Cañón 125mm", "cadencia_disparo_seg": 8,
      "danio_unidades_pct": 15, "danio_vehiculos_pct": 40, "tipo_ataque": "tierra", "municion": 32 }
  ]
}
```

`tipo` del vehículo (`tierra` | `aire` | `mar` | `anfibio`) decide **cómo se mueve** después: los `tierra` siguen rutas del servidor, los demás reciben waypoints libres. Mostralo claro en el formulario.

`POST /vehiculos/base/:id/armamentos` es **idempotente**: si el arma ya estaba montada, actualiza su munición en vez de fallar. Podés usar el mismo botón para montar y para editar la dotación.

**Alta de una instancia de vehículo.** `POST /vehiculos` necesita `unidad_padre_tipo` (`"unidad_militar"` | `"vehiculo_militar"`) + `unidad_padre_id`: el formulario tiene que ofrecer **una sola** asignación (unidad **o** vehículo portador), nunca las dos, nunca ninguna — no existe la opción "suelto". Si no mandás `posicion_x`/`posicion_y`, el vehículo nace en la posición base de la unidad de la que termina dependiendo (subiendo la cadena si el padre es otro vehículo). No mandes `unidad_militar_id` ni `vehiculo_padre_id`: esos nombres nunca existieron del lado del servidor, la relación siempre fue el par `unidad_padre_tipo`/`unidad_padre_id`.

**Editor de rutas sobre el mapa.** `puntos` es un array `[{x, y}, ...]`. El usuario dibuja la polilínea y se guarda tal cual. Sin rutas cargadas el movimiento terrestre igual funciona (cae a línea recta), pero conviene que el admin cargue al menos una.

**Asignación de participantes.** `POST /ejercicios/:id/participantes` con `{ usuarioId, bando }`. `bando` es un **dominio cerrado**: solo `"azul"` | `"rojo"` (`400` con cualquier otro valor) — dejó de ser texto libre. Usá un `<select>`, no un input de texto. Es el **único lugar** donde se fija el bando: de acá sale, por herencia, el de todas las unidades y vehículos del participante. Un administrador **no puede** asignarse a un ejercicio: hay un trigger en la base que lo rechaza, la API devuelve `400`.

### Trampas

- **Los borrados cascadean y ya no dan `409`.** Borrar una plantilla de unidad borra **todas** las unidades creadas desde ella, y con ellas sus documentos y asignaciones. Lo mismo con plantillas de vehículo. Mostrá una confirmación explícita con el alcance del borrado — la API no te va a frenar. La cadena completa está en `DATABASE.md`.
- **`rango_vision_m` tiene default por tipo** si no lo mandás al crear un vehículo: `tierra`/`anfibio` → 10000, `aire`/`mar` → 15000. Para unidades el default es 1000.
- Un vehículo instancia hereda la munición de su plantilla si no mandás `municion_actual`.

### Criterios de aceptación

- Se puede armar un ejercicio completo desde cero: usuarios → plantillas → unidades → asignar controladores → vehículos con armamento → rutas → ejercicio → participantes con bando.

---

## Fase 3 — Mapa y estado del ejercicio

**Objetivo:** entrar a un ejercicio y ver el mapa en vivo. Es la fase donde el socket pasa a ser el canal principal.

### Flujo

```js
socket.emit("ejercicio:unirse", { ejercicio_id: 7 }, (res) => {
  // { ok: true, iniciado: true,  bando: "azul", estado: "activo" }
  // { ok: true, iniciado: false, bando: "azul", mensaje: "El ejercicio todavía no fue iniciado" }
});

socket.on("ejercicio:estado_inicial", (estado) => reemplazarEstado(estado));
socket.on("ejercicio:estado_cambiado", ({ estado, estado_anterior }) => { /* activo|pausado|detenido */ });
```

`ejercicio:unirse` te mete en las rooms del ejercicio. **El bando lo resuelve el servidor** contra la base, no se manda en el payload.

Si `iniciado: false`, quedás en la room esperando: en cuanto el admin emita `ejercicio:iniciar` vas a recibir `ejercicio:estado_inicial` automáticamente. Mostrá una pantalla de espera, no un error.

### El objeto de estado

Estructura (esquema completo en `API.md`, sección 12):

```jsonc
{
  "ejercicio": { "id": 7, "nombre": "...", "estado": "activo",
                 "velocidad_ejercicio": 1, "inicio": "2026-07-29T22:32:02.882Z",
                 "hora_tactica": "2026-07-29T22:32:02.882Z" },
  "jugadores": [{ "id": 8, "nombre": "Cap. García", "bando": "azul", "unidades_ids": [9] }],
  "unidades": [{
    "id": 9, "nombre": "3ra Cía", "sidc": "SFGPUCI----E***", "bando": "azul",
    "usuarios_ids": [8],
    "posicion_base_x": -99.1332, "posicion_base_y": 19.4326,
    "posicion_x": -99.1332, "posicion_y": 19.4326,
    "efectivo": 120, "efectivo_exacto": 120, "ataque": 40, "defensa": 60,
    "velocidad_movimiento": 6,
    "estado_movimiento": "estacionado", "distancia_recorrida": 0,
    "en_rango_combate": false, "en_combate": false, "en_retirada": false,
    "visible": true, "rango_vision_m": 1000, "detectado_por": [],
    "vehiculos": [ /* ... */ ]
  }],
  "vehiculos": [],   // los que no cuelgan de ninguna unidad
  "mensajes": [], "documentos": [], "boletines": []
}
```

**Los vehículos están anidados dentro de su unidad**, en `unidad.vehiculos[]`. Los que no cuelgan de ninguna unidad del ejercicio quedan en el array `vehiculos[]` de la raíz. Tu función de "recorrer todas las entidades" tiene que mirar los dos lugares.

### Qué construir

- Render del mapa con símbolos **SIDC** (MIL-STD-2525 / APP-6) a partir del campo `sidc`. Todo lo necesario para dibujar viene en el JSON; no hace falta ninguna consulta extra.
- Panel lateral con el detalle de la entidad seleccionada: efectivo, munición, autonomía restante (`distancia_recorrida` vs `autonomia`), armamentos, estado.
- Indicador del estado del ejercicio (activo / pausado / detenido).
- Reconexión: `socket.on("connect", ...)` → re-emitir `ejercicio:unirse`.

### Trampas

- **`efectivo` vs `efectivo_exacto`**: mostrá siempre `efectivo` (entero). `efectivo_exacto` es el valor real con decimales que usa el motor de combate internamente; no lo muestres.
- **`posicion_base_x`/`posicion_base_y` vs `posicion_x`/`posicion_y`**: la base es el orden de batalla (fija, solo cambia desde configuración); la actual la pisa el motor de movimiento cada segundo. Son dos pares de campos distintos en el mismo objeto — no los confundas ni sobrescribas uno con el otro al renderizar.
- Los campos de catálogo (`sidc`, velocidades, `umbral_danio`, `armamentos`) **no cambian** durante el ejercicio. Los de "estado en tiempo real" sí. Podés cachear los primeros sin miedo.
- `municion_actual` del vehículo es la **suma** de la munición de sus armamentos; la que manda para cada arma es `armamentos[].municion_actual`.

### Criterios de aceptación

- Dos clientes distintos ven el mismo mapa.
- Cortar la red y reconectar deja el mapa consistente sin recargar la app.

---

## Fase 4 — Movimiento

**Objetivo:** el jugador ordena desplazamientos y los ve avanzar.

### Dos modalidades

El servidor interpola igual en los dos casos; lo único que cambia es **de dónde salen los waypoints**.

**Terrestre** — unidades de infantería y vehículos `tierra` / `anfibio`. El cliente manda **solo origen y destino**; el servidor resuelve el trayecto contra la tabla `rutas`.

```js
socket.emit("entidad:mover", {
  ejercicio_id: 7,
  entidad_tipo: "unidad",        // "unidad" | "vehiculo"
  entidad_id: 9,
  posicion_inicio: { x, y },     // opcional: si se omite usa la posición actual
  posicion_fin: { x: -99.115, y: 19.448 },
}, (res) => {
  // { ok: true, ruta_id: 2, ruta_nombre: "Camino norte",
  //   distancia_km: 2.569, tiempo_estimado_seg: 1541, waypoints: [{x,y}, ...] }
});
```

**Libre** — vehículos `mar` / `aire` / `anfibio`. El usuario traza la polilínea en el mapa y se manda completa.

```js
socket.emit("entidad:mover_libre", {
  ejercicio_id: 7, entidad_tipo: "vehiculo", entidad_id: 4,
  waypoints: [{ x: -99.10, y: 19.46 }, { x: -99.09, y: 19.47 }],
}, cb);
```

**Cancelar:** `entidad:cancelar_movimiento` con `{ ejercicio_id, entidad_tipo, entidad_id }`.

### Eventos que hay que escuchar

| Evento | Cuándo | Payload |
|---|---|---|
| `entidad:movimiento_iniciado` | confirmación | `{ entidad_tipo, entidad_id, waypoints, distancia_km, tiempo_estimado_seg, ruta_id, ruta_nombre }` |
| `entidad:posicion_actualizada` | **1 vez por segundo** | `{ entidad_tipo, entidad_id, posicion_x, posicion_y, distancia_recorrida }` |
| `entidad:movimiento_completado` | llegó o lo cancelaron | `{ ..., posicion_x, posicion_y, distancia_recorrida, cancelado? }` |

### Qué construir

- Herramienta de "mover a": seleccionar entidad → clic en destino → `entidad:mover`.
- Herramienta de trazado de polilínea para agua/aire → `entidad:mover_libre`.
- Dibujo del trayecto usando los `waypoints` que devuelve `entidad:movimiento_iniciado` (son los **resueltos por el servidor**, no los que mandaste).
- **Interpolación visual entre ticks.** Los updates llegan 1/s; si movés el ícono de golpe se ve a saltos. Animá entre la posición anterior y la nueva durante ~1 s. Es puramente cosmético: la posición autoritativa es siempre la del último evento.

### Trampas

- **No podés mover una entidad `en_combate`.** Hay que emitir `combate:retirarse` primero (fase 6). Deshabilitá el botón cuando `en_combate === true`.
- Cruzar las modalidades da error explícito: un vehículo `aire` con `entidad:mover` responde `"Un vehículo de tipo \"aire\" se mueve con entidad:mover_libre, no con entidad:mover"`. Elegí el evento según `entidad.tipo`.
- Una unidad con `efectivo` 0 y un vehículo `destruido` no se mueven.
- Con el ejercicio **pausado** cualquier movimiento se rechaza con `"El ejercicio está pausado"`.
- Si se te cae el socket, el backend detiene los movimientos de tus entidades y las deja `estacionado`. Al reconectar y reunirte recibís la posición donde quedaron: hay que **volver a ordenar** el movimiento, no se reanuda solo.

### Criterios de aceptación

- Una unidad se mueve siguiendo la ruta y se detiene en el destino.
- Un helicóptero sigue la polilínea dibujada.
- Cancelar detiene el ícono en el acto.

---

## Fase 5 — Detección y niebla de guerra

**Objetivo:** que cada bando vea solo lo que le corresponde.

La detección es una fase **previa** al combate: el rango de visión es bastante mayor que el umbral de combate, así que ves venir al enemigo y podés maniobrar antes del enfrentamiento.

El backend evalúa una vez por segundo: **A detecta a B** si `distancia <= A.rango_vision_m` **y** `B.visible === true`.

### Eventos

```js
socket.on("entidad:detectada", (e) => {
  // { detectada_por: { entidad_tipo, entidad_id },   <- quién la vio (de los tuyos)
  //   entidad_tipo, entidad_id, nombre, sidc, bando, posicion_x, posicion_y, distancia_m }
});

socket.on("entidad:perdida_de_vista", (e) => {
  // { detectada_por, entidad_tipo, entidad_id }
});
```

Llegan a la room de tu bando (`ejercicio_{id}_bando_{bando}`), así que ya vienen filtrados: **si te llegó, es porque lo viste**.

### Qué construir

- **Niebla de guerra.** Renderizá las entidades enemigas solo mientras estén detectadas. Como una entidad puede ser vista por varios de tus elementos a la vez, llevá un contador o un `Set` de observadores por enemigo y ocultala cuando quede vacío — no la escondas con el primer `perdida_de_vista`.
- Indicador de quién está viendo qué (`detectada_por`), útil para el jugador.
- Círculos de rango de visión (`rango_vision_m`) sobre las entidades propias, opcional pero muy útil.

### Trampas

- **`detectado_por[]` guarda claves `"tipo:id"`**, no ids sueltos: `["unidad:11", "vehiculo:5"]`. Es a propósito: un id de unidad y uno de vehículo pueden coincidir.
- El array `detectado_por` de una entidad dice **quién la está viendo a ella**. Para tus propias entidades te dice si el enemigo las tiene localizadas.
- Las entidades destruidas (o con `efectivo` 0) no detectan ni son detectadas.
- El administrador ve todo siempre: no le apliques niebla de guerra.

### Criterios de aceptación

- El cliente del bando rojo no ve una unidad azul fuera de rango.
- Al acercarse aparece y al alejarse desaparece, sin parpadeos cuando hay varios observadores.

---

## Fase 6 — Combate

**Objetivo:** el jugador decide y ejecuta enfrentamientos.

### El ataque es opt-in — esto define la UX de la fase

⚠️ **Entrar en rango NO inicia el ataque.** El backend te avisa y **vos decidís**. Es el punto central de la mecánica: permite maniobrar, esquivar o hacer otra cosa.

```js
socket.on("combate:en_rango", (e) => {
  // { entidad_tipo, entidad_id, objetivo_tipo, objetivo_id,
  //   objetivo_nombre, objetivo_bando, distancia_m, umbral_m }
  // -> mostrar la decisión: ATACAR / IGNORAR / RETIRARSE
});
```

Llega solo a `usuario_{id}` del **dueño** de la entidad (y a los administradores), no a toda la room. Se emite en la **transición** fuera→dentro del umbral, y solo si la entidad no está ya combatiendo — no esperes uno por segundo.

**Umbrales de combate** (los aplica el backend; mostralos para que el jugador entienda):

| Entidad | Umbral |
|---|---|
| Unidad de infantería | 500 m |
| Vehículo `tierra` / `mar` / `anfibio` | 5 km |
| Vehículo `aire` | 3 km |

El que vale es el del **atacante**: un tanque puede batir a 5 km a una compañía cuyo propio umbral es 500 m.

### Acciones

```js
socket.emit("combate:confirmar_ataque", {
  ejercicio_id: 7,
  entidad_tipo: "vehiculo", entidad_id: 5,
  objetivo_tipo: "vehiculo", objetivo_id: 6,
}, (res) => {
  // { ok: true, distancia_m: 499.1, umbral_m: 5000, armamentos_disparando: [4, 5] }
});

socket.emit("combate:retirarse", { ejercicio_id: 7, entidad_tipo: "unidad", entidad_id: 9 }, cb);
```

`confirmar_ataque` marca `en_combate: true` en **las dos** entidades y **cancela su movimiento**: quedan trabadas hasta que alguna se retire. Reflejalo en la UI (el botón de mover se deshabilita solo, pero el usuario tiene que entender por qué).

`retirarse` se puede emitir **en cualquier momento**, incluso en pleno combate. Deja la entidad libre para moverse. Si el enemigo vuelve a acercarse, recibís `combate:en_rango` otra vez.

### Eventos de resultado

`combate:tick` tiene **dos formas** según el modelo. Discriminá por el campo `modelo`:

```js
// infantería vs infantería
{ modelo: "lanchester", distancia_m,
  participantes: [{ entidad_tipo, entidad_id, efectivo, bajas }, ...] }

// cualquier cosa que involucre un vehículo
{ modelo: "armamento", entidad_tipo, entidad_id, objetivo_tipo, objetivo_id,
  armamento_id, armamento_nombre, distancia_m, factor_distancia,
  danio, danio_acumulado, estado_actual, municion_restante }   // contra vehículo
{ ..., bajas, efectivo, municion_restante }                     // contra infantería
```

Otros: `combate:iniciado`, `combate:retirada`, y `combate:finalizado` con `motivo`:

| `motivo` | Significado |
|---|---|
| `fuera_de_rango` | la distancia superó el umbral |
| `objetivo_destruido` / `atacante_destruido` | destruido o sin efectivo |
| `sin_municion` | todas las armas del vehículo quedaron sin munición |
| `retirada` | alguien se retiró |
| `entidad_inexistente` | la entidad desapareció (estado restaurado, ejercicio cambiado) |

### Qué construir

- **Diálogo de decisión** al recibir `combate:en_rango`, con distancia y umbral.
- HUD de combate: efectivo, `danio_acumulado` vs `umbral_danio` (barra de vida), munición por armamento.
- Estados visuales del vehículo: `activo` / `dañado` (≥50% del umbral) / `destruido`.
- Log de combate alimentado por `combate:tick`.

### Trampas

- **`bajas` puede ser 0 en un tick y 1 en el siguiente** aunque el desgaste sea constante: es el delta del entero, y el backend acumula la fracción internamente. No interpretes un 0 como "no pasó nada".
- **Cada armamento dispara con su propia cadencia**: un tanque puede tirar con el cañón cada 8 s y con la ametralladora cada 2 s. Vas a recibir ticks intercalados de armas distintas para el mismo combate.
- Un vehículo con solo armamento `tierra` **no puede atacar** a un `aire`: `confirmar_ataque` devuelve `"El vehículo no tiene armamento compatible con ese objetivo (o sin munición)"`. Podés anticiparlo en la UI comparando `armamentos[].tipo_ataque` con el `tipo` del objetivo, pero igual manejá el rechazo.
- Una entidad puede estar en **varios combates a la vez**; `en_combate` pasa a `false` solo cuando ninguno la involucra.
- `defensa` existe en el modelo de datos pero **el motor de combate no la usa**. No la muestres como si afectara el resultado.

### Criterios de aceptación

- Acercar dos unidades enemigas dispara el diálogo y nada más pasa hasta confirmar.
- Confirmar produce bajas visibles y el combate termina con un motivo.
- Retirarse corta el combate y habilita el movimiento.

---

## Fase 7 — Comunicaciones

**Objetivo:** chat de bando, documentos entre unidades y boletines.

Los tres se persisten en el JSON del ejercicio (`mensajes[]`, `documentos[]`, `boletines[]`) y **siguen funcionando con el ejercicio pausado** — es justo cuando el admin da instrucciones. Lo que se bloquea al pausar es mover y combatir.

### Chat de bando

```js
socket.emit("chat:enviar", {
  ejercicio_id: 7,
  contenido: "Avanzar al sector norte",
  destinatario_id: null,   // id de USUARIO; null u omitido = broadcast al bando
  bando: "azul",           // SOLO si sos administrador
}, cb);

socket.on("chat:mensaje", (m) => {
  // { id, remitente_id, remitente_nombre, destinatario_id, bando, contenido, timestamp }
});
```

Llega **solo** a la room de tu bando. Un administrador no tiene bando propio: **debe** indicar `bando` en el payload para elegir a cuál habla.

> ⚠️ **Hay dos chats distintos.** `chat:enviar` / `chat:mensaje` es el chat de **bando dentro de un ejercicio**, guardado en el JSON. `chat:send` / `chat:message` (con `GET /chat/conversaciones` y `GET /chat/:usuarioId`) es mensajería **personal usuario ↔ usuario** guardada en Postgres, independiente del ejercicio. No los mezcles en la misma ventana.

### Documentos entre unidades

```js
socket.emit("documento:enviar", {
  ejercicio_id: 7,
  remitente_unidad_id: 12, destinatario_unidad_id: 13,
  asunto: "Orden de avance al sector norte",
  tipo: "orden_operaciones",
  contenido: { mision: "Ocupar cota 431" },   // JSON libre
}, cb);

socket.on("documento:recibido", (doc) => { /* ... */ });
```

Remitente y destinatario son **unidades**, no usuarios, y tienen que ser del mismo bando. Solo podés escribir en nombre de una unidad que controlás. El evento llega a `usuario_{id}` de **quienes comandan la unidad destinataria**, no a todo el bando.

`contenido` es JSON libre: definí ahí la estructura de cada `tipo` de documento (orden de operaciones, parte de situación, etc.) y renderizá una plantilla distinta por tipo.

### Boletines (texto a voz)

```js
// solo administrador
socket.emit("boletin:enviar", {
  ejercicio_id: 7,
  texto: "Atención. La unidad Alfa avanzó al sector norte.",
  bando: "azul",   // opcional (backend.md, punto 19); se omite = todos los jugadores
}, cb);

socket.on("boletin:nuevo", ({ texto, timestamp }) => {
  mostrarOverlay(texto);
  speechSynthesis.speak(new SpeechSynthesisUtterance(texto));
});
```

**La síntesis de voz es responsabilidad del cliente.** El backend solo emite el texto. Usá la **Web Speech API** (`SpeechSynthesis`) y mostrá un overlay/modal que reproduzca el audio automáticamente.

Sin `bando`, llega a **todos los jugadores** (`ejercicio_{id}_rol_jugador`). Con `bando`, llega solo a la room de ese bando (`ejercicio_{id}_bando_{bando}`, la misma que usan `chat:mensaje` y detección) — un `bando` fuera del dominio (`"azul"`/`"rojo"`) rechaza el ack. El admin que lo emitió no lo recibe de vuelta, con o sin `bando`.

Detalles prácticos: fijá `utterance.lang = "es-ES"` (o la voz que corresponda), encolá los boletines para que no se pisen, y ofrecé un botón de silenciar. Algunos WebViews requieren una interacción previa del usuario antes de permitir audio.

### Qué construir

- Panel de chat de bando con historial (viene en `estado.mensajes[]` al unirse).
- Bandeja de documentos: entrada/salida, lectura y redacción por tipo.
- Overlay de boletín con TTS y cola.

### Criterios de aceptación

- Un mensaje del bando azul no llega al cliente del bando rojo.
- Un documento llega solo a quien comanda la unidad destinataria.
- El boletín se escucha y se ve en los clientes de los jugadores.

---

## Fase 8 — Panel de dirección (administrador)

**Objetivo:** las herramientas con las que el admin dirige el ejercicio. Todo 👑.

### Control del ejercicio

```js
socket.emit("ejercicio:iniciar", { ejercicio_id: 7 }, cb);  // también REANUDA un pausado
socket.emit("ejercicio:pausar",  { ejercicio_id: 7 }, cb);
socket.emit("ejercicio:detener", { ejercicio_id: 7 }, cb);
```

`iniciar` genera el JSON desde la base **la primera vez**; si el archivo ya existe reanuda el ejercicio tal como quedó. No hay un evento "reanudar" aparte. `pausar` y `detener` cortan todos los intervalos y devuelven `{ estado, movimientos_detenidos, combates_cortados }`.

### Hora táctica

El reloj del ejercicio es autoritativo del servidor: vive en
`estado.ejercicio.hora_tactica` (ISO 8601) y avanza un tick por segundo real,
multiplicado por `velocidad_ejercicio` (entero, `≥ 1`).

```js
socket.on("ejercicio:hora_tactica", ({ ejercicio_id, hora_tactica, velocidad_ejercicio }) => {
  // pintá hora_tactica tal cual — no recalcules nada del lado del cliente
});
```

Llega a la room `ejercicio_{id}` una vez por segundo mientras el ejercicio
está `activo`; deja de llegar mientras está `pausado` o `detenido` (el mismo
intervalo que corta movimiento/combate también corta este tick), así que
alcanza con pintar el último valor recibido — no hace falta detectar la
pausa a mano para "congelar" el reloj en la UI.

```js
// fijar la hora a mano, 👑
socket.emit("ejercicio:establecer_hora_tactica", {
  ejercicio_id: 7,
  hora_tactica: "2026-08-10T06:00:00.000Z",
}, cb);   // { hora_tactica }
```

No exige que el ejercicio esté `activo` — funciona también pausado. `400`
(ack `ok:false`) si `hora_tactica` no parsea como fecha. Difunde
`ejercicio:hora_tactica` de inmediato, no hace falta esperar al próximo tick.

`velocidad_ejercicio` tiene que ser **entero** (`PUT /ejercicios/:id` lo
valida, `400` si no) y su cambio tiene efecto **inmediato sobre todo el
ejercicio** — reloj táctico, movimiento y combate por igual, no solo el
reloj: si el ejercicio ya tiene un JSON en vivo, el `PUT` lo escribe también
ahí y el motor lo relee en el próximo ciclo, sin reiniciar nada.

### Visibilidad

```js
socket.emit("admin:set_visibilidad", {
  ejercicio_id: 7, entidad_tipo: "unidad", entidad_id: 11, visible: false,
}, cb);
socket.on("admin:visibilidad_actualizada", (c) => { /* confirmación */ });
```

Ocultar una entidad simula que el enemigo no tiene inteligencia sobre ella, aunque esté dentro del rango: deja de recibir detecciones y no puede fijarla como blanco. Es una herramienta de dirección, no una propiedad física.

### Crear y editar entidades en caliente

```js
socket.emit("unidad:crear_en_ejercicio", {
  ejercicio_id: 7, nombre: "Delta", sidc: "SFGPUCI----E***",
  posicion_x: -99.14, posicion_y: 19.44, efectivo: 90,
  velocidad_movimiento: 5, rango_vision_m: 1200, ataque: 35,
  jugador_asignado_id: 14,             // queda como controlador — de acá sale el bando
  unidad_militar_base_id: null,        // si lo omitís, se crea la plantilla al vuelo
}, cb);

socket.on("ejercicio:unidad_creada", ({ unidad }) => agregarAlMapa(unidad));
```

⚠️ **No mandes `bando`.** Es derivado: sale del bando que tiene `jugador_asignado_id` en este ejercicio. `jugador_asignado_id` es obligatorio — sin controlador la unidad no tiene de dónde sacar el bando. Si igual lo mandás y no coincide con el del jugador, el servidor **rechaza** la creación en vez de resolver el conflicto en silencio.

La unidad nace con **exactamente el mismo esquema** que las generadas al inicio: no necesitás un camino de render distinto.

```js
socket.emit("vehiculo:crear_en_ejercicio", {
  ejercicio_id: 7, vehiculo_base_id: 3,
  unidad_padre_tipo: "unidad_militar", unidad_padre_id: 12,   // o "vehiculo_militar" — mismo XOR que POST /vehiculos
  nombre: "T-72 #4",                    // opcional
  posicion_x: -99.14, posicion_y: 19.44,  // opcionales: si faltan, nace en la base de la unidad
}, cb);

socket.on("ejercicio:vehiculo_creado", ({ vehiculo }) => agregarAlMapa(vehiculo));
```

Simétrico al alta de unidad, pero para vehículos: `unidad_padre_tipo`/`unidad_padre_id` son obligatorios (la unidad — o el vehículo portador, subiendo la cadena — tiene que **participar en este ejercicio**), y `bando`/`posicion_base_*` salen heredados, no se mandan. Antes de esto, un vehículo dado de alta con `POST /vehiculos` mientras el ejercicio corría se veía en el mapa (por `GET /vehiculos?ejercicioId=`) pero cualquier orden sobre él rebotaba con `"La entidad no existe en este ejercicio"` porque el motor no lo conocía — **usá este evento para altas con el ejercicio en marcha**, no el REST.

```js
socket.emit("unidad:modificar",   { ejercicio_id, entidad_id, efectivo: 75, visible: false }, cb);
socket.emit("vehiculo:modificar", { ejercicio_id, entidad_id, estado_actual: "dañado" }, cb);
```

Los campos aceptados son una **lista blanca**; cualquier otra clave se ignora y si no queda ninguna válida devuelve `"No hay campos para modificar"`.

| | Campos modificables |
|---|---|
| unidad | `nombre`, `sidc`, `posicion_x`, `posicion_y`, `efectivo`, `ataque`, `defensa`, `velocidad_movimiento`, `rango_vision_m`, `visible` |
| vehículo | `nombre`, `sidc`, `posicion_x`, `posicion_y`, `estado_actual`, `danio_acumulado`, `municion_actual`, `velocidad_desplazamiento`, `rango_vision_m`, `umbral_danio`, `visible` |

⚠️ **`bando` ya no está en la lista** (es derivado — para cambiarlo, reasigná el controlador o cambiale el bando en `PUT /ejercicios/:id/participantes/:usuarioId`) **ni `posicion_base_x`/`posicion_base_y`** (solo se tocan desde configuración, `PUT /unidades/:id`). Mandarlos da error explícito en vez de ignorarse.

Respuesta: `{ ok: true, campos: ["efectivo", "visible"] }`. Eventos: `ejercicio:unidad_modificada` / `ejercicio:vehiculo_modificado`.

Reposicionar una entidad **cancela el trayecto** que estuviera siguiendo.

### Baja de entidades en caliente

```js
socket.emit("unidad:eliminar_del_ejercicio", { ejercicio_id: 7, entidad_id: 11 }, (res) => {
  // { ok: true, entidad_tipo: "unidad", entidad_id: 11, vehiculos_eliminados: [4, 5] }
});
socket.emit("vehiculo:eliminar_del_ejercicio", { ejercicio_id: 7, entidad_id: 4 }, cb);

socket.on("ejercicio:unidad_eliminada",  ({ entidad_id, vehiculos_eliminados }) => quitarDelMapa(entidad_id));
socket.on("ejercicio:vehiculo_eliminado", ({ entidad_id }) => quitarDelMapa(entidad_id));
```

Es la contraparte del alta: saca la entidad del mapa de **todos** los clientes conectados, no solo del tuyo. Una unidad se lleva sus vehículos anidados (`vehiculos_eliminados`). Además de sacarla del JSON, el servidor corta sus trayectos y combates en curso (liberando al contrincante) y la quita de los `detectado_por[]` de las demás entidades — si era el único observador de un enemigo, ese enemigo vuelve a la niebla para ese bando (`entidad:perdida_de_vista`). Funciona con el ejercicio **pausado**.

**Simetría con REST:** `DELETE /unidades/:id` y `DELETE /vehiculos/:id` (y sus plantillas, que cascadean a todas sus instancias) disparan internamente esta misma baja en cualquier ejercicio donde la entidad esté viva — no hace falta encadenar las dos llamadas si el borrado se hace desde el catálogo. Al revés no es simétrico: `POST`/`PUT /vehiculos` (a diferencia del alta/edición por socket) **no** tocan el JSON de un ejercicio en marcha, así que para un ejercicio ya iniciado usá siempre `vehiculo:crear_en_ejercicio` / `vehiculo:modificar`, nunca el REST.

### Estados anteriores

⚠️ **Cambio de comportamiento (31-07-2026): los checkpoints dejaron de generarse solos.** Antes, cada acción (crear/editar/borrar una entidad, pausar, chat, etc.) dejaba una copia en `estados_anteriores/` automáticamente. Ya no: la **única** forma de que aparezca un checkpoint nuevo es que el administrador lo pida explícitamente.

```js
socket.emit("ejercicio:guardar_estado", { ejercicio_id: 7 }, (res) => {
  // { ok: true, nombre_archivo: "ejercicio_7_2026-07-31_23-10-04-118.json" }
});
```

Sin evento de confirmación al resto de la room — es una acción de archivo, no algo que cambie lo que ven los demás. Mostrá un toast propio con `nombre_archivo` y refrescá la lista de checkpoints (`ejercicio:listar_estados`) para que aparezca de inmediato en tu línea de tiempo, sin esperar a volver a pedirla.

```js
socket.emit("ejercicio:listar_estados", { ejercicio_id: 7 }, (res) => {
  // { ok: true, total: 5, estados: [
  //     { nombre_archivo: "ejercicio_7_2026-07-29_23-06-35-526.json",
  //       timestamp: "2026-07-29T23:06:35.526Z", bytes: 4812 }, ... ] }
});

socket.emit("ejercicio:cargar_estado", {
  ejercicio_id: 7, nombre_archivo_estado: "ejercicio_7_...json",
}, cb);
```

Vienen del más reciente al más antiguo. `cargar_estado` retrocede el ejercicio a ese punto y emite `ejercicio:estado_inicial` a todos.

⚠️ **Ya NO es cierto que "un retroceso siempre se puede deshacer".** Antes, el estado que `cargar_estado` descartaba quedaba guardado solo. Ahora no: si el admin quiere poder volver al punto en el que estaba, tiene que emitir `ejercicio:guardar_estado` **antes** de cargar el checkpoint. Ofrecé ese guardado como paso previo en el flujo de la UI (por ejemplo, un botón "Guardar antes de retroceder" en el mismo diálogo de confirmación), no como algo que el admin tenga que acordarse de hacer por su cuenta.

### Rebobinado

Reproduce el timeline hacia atrás para ver cómo se llegó al estado actual antes de decidir a cuál retroceder. Es de **solo lectura** y solo lo ve el admin; el ejercicio sigue corriendo para el resto.

```js
socket.emit("ejercicio:rebobinar_iniciar", { ejercicio_id: 7, desde_archivo: null, intervalo_ms: 1000 }, (res) => {
  // { ok: true, frames: 5, intervalo_ms: 1000, desde: "...", hasta: "..." }
});

socket.on("ejercicio:rebobinar_tick", ({ indice, total, nombre_archivo, timestamp, estado }) => {
  renderizarFrame(estado);   // NO reemplaces el estado real: es un preview
});
socket.on("ejercicio:rebobinar_fin", ({ frames }) => { /* terminó el timeline */ });

socket.emit("ejercicio:rebobinar_pausar", { ejercicio_id: 7 }, (res) => {
  // { ok: true, indice, total, nombre_archivo, timestamp }
});
socket.emit("ejercicio:rebobinar_confirmar", { ejercicio_id: 7 /*, nombre_archivo */ }, cb);
socket.emit("ejercicio:rebobinar_cancelar",  { ejercicio_id: 7 }, cb);
```

Solo puede haber **un rebobinado activo por ejercicio**. `confirmar` fija el frame como estado real y sincroniza a todos; si omitís `nombre_archivo` usa el frame que estás viendo. Misma advertencia que con `cargar_estado`: **confirmar tampoco deja un checkpoint del estado que se abandona** — ofrecé `ejercicio:guardar_estado` antes de confirmar si el admin quiere poder volver.

⚠️ **Durante el replay tu socket sale de la room del ejercicio**, así que dejás de recibir `entidad:posicion_actualizada` y `combate:tick` hasta que confirmes o canceles. Es intencional: evita mezclar el replay con lo que pasa en vivo. Diseñá la UI como un **modo modal** de reproducción, con su propia capa de render, y volvé al mapa normal al salir.

### Cambiar de ejercicio

```js
socket.emit("ejercicio:cambiar", { ejercicio_id_nuevo: 10 }, (res) => {
  // { ok: true, ejercicio_id: 10, generado_desde_bd: true, sockets_movidos: 2 }
});
```

Mueve a **todos** los sockets del ejercicio actual al nuevo y les emite `ejercicio:estado_inicial`. El bando de cada uno se resuelve **en el ejercicio nuevo** (un jugador puede ser azul en uno y rojo en otro). A quien no participa del destino se lo deja fuera con un evento `error`: como cliente, si recibís ese error tenés que volver a la pantalla de selección.

### Qué construir

- Barra de control: iniciar / pausar / detener con el estado actual.
- Panel de entidades con edición inline, toggle de visibilidad y **botón de baja** (`unidad`/`vehiculo:eliminar_del_ejercicio`).
- Formulario de alta de unidad **y de vehículo** en caliente.
- **Botón "Guardar punto de restauración"** (`ejercicio:guardar_estado`) — visible y a mano, no escondido: es la única forma de que exista un checkpoint para volver más tarde.
- **Línea de tiempo** de checkpoints con reproductor (play / pausa / confirmar / cancelar) y scrubber por índice. Refrescala después de cada `ejercicio:guardar_estado` exitoso.
- Selector de ejercicio con `ejercicio:cambiar`.

### Trampas

- **Los checkpoints ya no son automáticos.** Si el panel no ofrece un botón de guardado explícito y visible, el admin puede terminar sin ningún punto al que volver — antes esto pasaba solo, ahora no. No lo escondas en un menú secundario.
- **Retroceder un estado NO revierte la base de datos.** Una unidad o vehículo creado en caliente desaparece del JSON al restaurar, pero su fila en la base queda. Lo mismo al revés: una entidad dada de baja en caliente **puede volver a aparecer** si se retrocede a un checkpoint anterior a la baja (los checkpoints previos no se tocan, son historia). Si el admin espera "deshacer todo", aclaralo en la UI.
- `nombre_archivo` se valida contra el prefijo del ejercicio: no se puede cargar el estado de otro ejercicio.
- **No uses `POST`/`PUT /vehiculos` (REST) para altas o ediciones con el ejercicio ya iniciado.** Son operaciones de catálogo (fase 2): escriben la base pero no el JSON, así que el vehículo se ve en el panel (por el polling de `GET /vehiculos?ejercicioId=`) pero el motor no le da órdenes. Con el ejercicio corriendo, alta y edición van por socket (`vehiculo:crear_en_ejercicio` / `vehiculo:modificar`); `DELETE /vehiculos/:id` sí es simétrico con la baja por socket.

### Criterios de aceptación

- El admin pausa y los jugadores lo ven al instante.
- Ocultar una unidad la saca del mapa del enemigo.
- Rebobinar, pausar y confirmar deja a todos los clientes en el estado elegido.

---

## Apéndice A — Rooms

A las tres últimas te une el servidor cuando emitís `ejercicio:unirse`.

| Room | Qué llega |
|---|---|
| `usuario_{id}` | notificaciones personales: `combate:en_rango`, `documento:recibido` |
| `user:{id}` | **legacy**, misma función — usada por `chat:message` y `documento:nuevo` |
| `ejercicio_{id}` | estado, movimiento, combate |
| `ejercicio_{id}_bando_{bando}` | detección y chat de bando |
| `ejercicio_{id}_rol_{rol}` | boletines a jugadores |

---

## Apéndice B — Mapa completo de eventos

### Cliente → servidor

| Evento | Rol | Payload |
|---|---|---|
| `ejercicio:unirse` | todos | `{ ejercicio_id }` |
| `ejercicio:iniciar` | 👑 | `{ ejercicio_id }` |
| `ejercicio:pausar` | 👑 | `{ ejercicio_id }` |
| `ejercicio:detener` | 👑 | `{ ejercicio_id }` |
| `ejercicio:cambiar` | 👑 | `{ ejercicio_id_nuevo }` |
| `ejercicio:guardar_estado` | 👑 | `{ ejercicio_id }` |
| `ejercicio:listar_estados` | 👑 | `{ ejercicio_id }` |
| `ejercicio:cargar_estado` | 👑 | `{ ejercicio_id, nombre_archivo_estado }` |
| `ejercicio:rebobinar_iniciar` | 👑 | `{ ejercicio_id, desde_archivo?, intervalo_ms? }` |
| `ejercicio:rebobinar_pausar` | 👑 | `{ ejercicio_id }` |
| `ejercicio:rebobinar_confirmar` | 👑 | `{ ejercicio_id, nombre_archivo? }` |
| `ejercicio:rebobinar_cancelar` | 👑 | `{ ejercicio_id }` |
| `ejercicio:establecer_hora_tactica` | 👑 | `{ ejercicio_id, hora_tactica }` |
| `entidad:mover` | jugador, 👑 | `{ ejercicio_id, entidad_tipo, entidad_id, posicion_inicio?, posicion_fin }` |
| `entidad:mover_libre` | jugador, 👑 | `{ ejercicio_id, entidad_tipo, entidad_id, waypoints[] }` |
| `entidad:cancelar_movimiento` | jugador, 👑 | `{ ejercicio_id, entidad_tipo, entidad_id }` |
| `combate:confirmar_ataque` | jugador, 👑 | `{ ejercicio_id, entidad_tipo, entidad_id, objetivo_tipo, objetivo_id }` |
| `combate:retirarse` | jugador, 👑 | `{ ejercicio_id, entidad_tipo, entidad_id }` |
| `unidad:crear_en_ejercicio` | 👑 | ver fase 8 |
| `vehiculo:crear_en_ejercicio` | 👑 | ver fase 8 |
| `unidad:modificar` | 👑 | `{ ejercicio_id, entidad_id, ...campos }` |
| `vehiculo:modificar` | 👑 | `{ ejercicio_id, entidad_id, ...campos }` |
| `unidad:eliminar_del_ejercicio` | 👑 | `{ ejercicio_id, entidad_id }` |
| `vehiculo:eliminar_del_ejercicio` | 👑 | `{ ejercicio_id, entidad_id }` |
| `admin:set_visibilidad` | 👑 | `{ ejercicio_id, entidad_tipo, entidad_id, visible }` |
| `chat:enviar` | jugador, 👑 | `{ ejercicio_id, contenido, destinatario_id?, bando? }` |
| `documento:enviar` | jugador, 👑 | `{ ejercicio_id, remitente_unidad_id, destinatario_unidad_id, asunto, tipo?, contenido? }` |
| `boletin:enviar` | 👑 | `{ ejercicio_id, texto, bando? }` |
| `chat:send` | todos | `{ destinatarioId, mensaje }` — chat personal, fuera del ejercicio |

### Servidor → cliente

| Evento | Room | Fase |
|---|---|---|
| `ejercicio:estado_inicial` | socket / `ejercicio_{id}` | 3 |
| `ejercicio:estado_cambiado` | `ejercicio_{id}` | 3 |
| `ejercicio:hora_tactica` | `ejercicio_{id}` | 3 / 8 |
| `entidad:movimiento_iniciado` | `ejercicio_{id}` | 4 |
| `entidad:posicion_actualizada` | `ejercicio_{id}` | 4 |
| `entidad:movimiento_completado` | `ejercicio_{id}` | 4 |
| `entidad:detectada` | bando | 5 |
| `entidad:perdida_de_vista` | bando | 5 |
| `combate:en_rango` | `usuario_{id}` | 6 |
| `combate:iniciado` | `ejercicio_{id}` | 6 |
| `combate:tick` | `ejercicio_{id}` | 6 |
| `combate:finalizado` | `ejercicio_{id}` | 6 |
| `combate:retirada` | `ejercicio_{id}` | 6 |
| `chat:mensaje` | bando | 7 |
| `documento:recibido` | `usuario_{id}` | 7 |
| `boletin:nuevo` | `ejercicio_{id}_rol_jugador` | 7 |
| `ejercicio:unidad_creada` | `ejercicio_{id}` | 8 |
| `ejercicio:vehiculo_creado` | `ejercicio_{id}` | 8 |
| `ejercicio:unidad_modificada` | `ejercicio_{id}` | 8 |
| `ejercicio:vehiculo_modificado` | `ejercicio_{id}` | 8 |
| `ejercicio:unidad_eliminada` | `ejercicio_{id}` | 8 |
| `ejercicio:vehiculo_eliminado` | `ejercicio_{id}` | 8 |
| `admin:visibilidad_actualizada` | socket admin | 8 |
| `ejercicio:estados_lista` | socket admin | 8 |
| `ejercicio:rebobinar_tick` | socket admin | 8 |
| `ejercicio:rebobinar_fin` | socket admin | 8 |
| `error` | socket | todas |
| `chat:message` | `user:{id}` | legacy |
| `documento:nuevo` | `user:{id}` | legacy |

---

## Apéndice C — Errores frecuentes y qué significan

| Mensaje | Causa | Qué hacer en la UI |
|---|---|---|
| `Token requerido` / `Token inválido o expirado` | handshake sin token o vencido | refrescar y reconectar |
| `El rol "jugador" no puede emitir X` | acción de admin desde jugador | no ofrecer el botón |
| `Primero hay que unirse al ejercicio (ejercicio:unirse)` | acción sin haberse unido | emitir `unirse` y reintentar |
| `El ejercicio está pausado` / `detenido` | acción de ejecución con el ejercicio frenado | deshabilitar controles según `ejercicio.estado` |
| `No participás en este ejercicio` | jugador sin asignación | volver a la selección |
| `No controlás esta entidad` | entidad de otro jugador | permitir seleccionar solo las propias |
| `La entidad está en combate: hay que retirarse antes de moverse` | mover con `en_combate` | ofrecer `combate:retirarse` |
| `Un vehículo de tipo "aire" se mueve con entidad:mover_libre...` | modalidad cruzada | elegir el evento según `entidad.tipo` |
| `El vehículo no tiene armamento compatible con ese objetivo` | armamento vs tipo de blanco | anticiparlo comparando `tipo_ataque` |
| `El objetivo está a N m, fuera del umbral de combate` | se alejó entre el aviso y la confirmación | cerrar el diálogo y esperar un nuevo `combate:en_rango` |
| `Ya hay un rebobinado en curso para este ejercicio` | doble replay | un solo control de rebobinado |
| `El archivo de estado no pertenece a este ejercicio` | nombre inválido | usar solo nombres de `listar_estados` |
| `El bando es derivado: cambiáselo al controlador de la entidad...` | se mandó `bando` en `unidad`/`vehiculo:modificar`, `POST`/`PUT /unidades`, o `POST`/`PUT /vehiculos` | no incluir `bando` en el payload; para cambiarlo, reasignar el controlador o su bando |
| `La posición base solo se cambia desde configuración...` | se mandó `posicion_base_x`/`posicion_base_y` en un evento de socket | esos campos solo se editan por `PUT /unidades/:id` |
| `La unidad de la que depende el vehículo no participa en este ejercicio` | `vehiculo:crear_en_ejercicio` con una unidad/cadena que no está en `estado.unidades` | verificar que la unidad esté asignada a este ejercicio antes de ofrecer el formulario |
| `Es el único controlador de la unidad: asigná otro antes de quitarlo` | `DELETE /unidades/:id/usuarios/:usuarioId` sobre el último controlador | asignar un reemplazo primero, deshabilitar el botón de quitar si es el único |
| `La unidad ya tiene un controlador (...) en el ejercicio ...` | `POST /unidades/:id/usuarios` con un usuario que ya participa en un ejercicio donde la unidad tiene otro controlador | en el selector de controladores, marcar o deshabilitar usuarios que generarían el choque |
| `No hay campos para modificar` | ninguna clave de la lista blanca | validar el formulario antes de enviar |
| `El ejercicio N no tiene archivo de estado — hay que iniciarlo primero` | `ejercicio:guardar_estado` antes de que el ejercicio se haya iniciado alguna vez | deshabilitar el botón de guardado hasta que `ejercicio:iniciar` haya corrido al menos una vez |
