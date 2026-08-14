# API — simtac backend

Backend de la simulación: autenticación, chat y documentos entre unidades. Las funcionalidades militares (movimiento, instrucciones) se agregarán después.

Para la estructura completa de la base de datos (tablas, columnas, relaciones) ver `DATABASE.md`.

## Base URL

| Contexto | URL |
|---|---|
| REST | `http://node.localhost` |
| Socket.IO | `http://node.localhost` (mismo host, mismo puerto) |

CORS está abierto (`*`) en este entorno de desarrollo.

Todas las rutas devuelven JSON. Los endpoints protegidos requieren el header:

```
Authorization: Bearer <token>
```

Errores siempre tienen la forma `{ "error": "mensaje" }`, con el status HTTP correspondiente (`400`, `401`, `403`, `404`, `409`, `500`).

🔒 = requiere `Authorization: Bearer <token>` de cualquier usuario logueado.
👑 = requiere además `rol: "administrador"` en el token (si no, `403 { "error": "Requiere rol administrador" }`).

Los `id` siempre viajan como **string** en el JSON (Postgres `bigint`), no como `number`.

⚠️ **Solo hay dos roles: `"jugador"` y `"administrador"`.** El valor `"usuario"` es el
nombre viejo del rol no-administrador y quedó obsoleto: el backend ya no lo emite ni lo
acepta. Si portás código viejo, actualizá el literal (ver `frontend.md`, fase 1).

---

## 1. Autenticación

El login es JWT sin estado: no hay endpoint de logout, "cerrar sesión" es simplemente descartar el token en el cliente. El token expira a las 8 horas.

### `POST /auth/register`

Crea un usuario.

```json
// request
{ "usuario": "jperez", "password": "clave123", "nombre": "Juan Perez", "grado": "Capitan" }
```

```json
// 201
{ "id": "1", "usuario": "jperez", "nombre": "Juan Perez", "grado": "Capitan", "rol": "jugador", "fecha_creacion": "2026-07-10T16:02:36.785Z" }
```

`grado` es opcional. `409` si `usuario` ya existe. `400` si falta `usuario`, `password` o `nombre`. `rol` siempre queda en `"jugador"` — este endpoint no permite auto-asignarse `administrador`. Para dar de alta un administrador hay que registrarlo y después promoverlo con `PUT /usuarios/:id` (sección 2).

### `POST /auth/login`

```json
// request
{ "usuario": "jperez", "password": "clave123" }
```

```json
// 200
{
  "token": "eyJhbGciOi...",
  "usuario": { "id": "1", "usuario": "jperez", "nombre": "Juan Perez", "grado": "Capitan", "rol": "jugador" }
}
```

`401` si las credenciales son inválidas.

Guarda `token` — se usa tanto en el header `Authorization` de REST como en el handshake de Socket.IO.

### `GET /auth/me` 🔒

Devuelve el payload del token actual (útil para validar que sigue vigente). No consulta la base de datos, así que refleja el estado del usuario al momento del login, no el actual.

```json
{ "usuario": { "id": "1", "usuario": "jperez", "nombre": "Juan Perez", "grado": "Capitan", "rol": "jugador", "iat": 1783699376, "exp": 1783728176 } }
```

---

## 2. Usuarios

Crear un usuario es siempre `POST /auth/register` (público, sección 1) — `rol` no se puede elegir ahí. Editar/borrar sí requiere administrador.

### `GET /usuarios` 🔒

```json
[{ "id": "1", "usuario": "jperez", "nombre": "Juan Perez", "grado": "Capitan", "rol": "jugador" }]
```

### `GET /usuarios/:id` 🔒

```json
{ "id": "1", "usuario": "jperez", "nombre": "Juan Perez", "grado": "Capitan", "rol": "jugador", "fecha_creacion": "...", "fecha_modificacion": "..." }
```

`404` si no existe.

### `PUT /usuarios/:id` 👑

Todos los campos son opcionales, se actualiza solo lo que mandes.

```json
// request
{ "nombre": "Juan Perez G.", "grado": "Mayor", "rol": "administrador", "password": "nuevaClave" }
```

Devuelve el usuario actualizado (mismo shape que `GET /usuarios/:id`). `400` si `rol` no es `"administrador"` ni `"jugador"`. Es el único endpoint que permite promover a alguien a administrador.

### `DELETE /usuarios/:id` 👑

`204` sin body. ⚠️ **Borra en cascada** todo el historial de `chat` de ese usuario (enviado y recibido) y sus filas en `unidad_militar_usuario` / `ejercicio_usuario`. Ya no da `409` — confirmar explícitamente en el frontend antes de llamar a este endpoint.

---

## 3. Unidades militares base (catálogo / plantillas)

`unidad_militar_base` es el catálogo de unidades predefinidas reutilizables. `sidc`, `tipo` y `quantity` (cantidad de efectivos) viven acá, no en `unidad_militar` — ver `DATABASE.md`.

### `GET /unidades/base` 🔒

```json
[{ "id": "1", "sidc": "SFGPUCI---****X", "nombre": "Infanteria genérica", "tipo": "Infanteria", "platform_type": null, "country": null, "descripcion": null, "fecha_creacion": "...", "quantity": 120 }]
```

### `GET /unidades/base/:id` 🔒

Igual shape, un solo registro. `404` si no existe.

### `POST /unidades/base` 👑

```json
// request
{ "sidc": "SFGPUCIZ---****X", "nombre": "Zapadores", "tipo": "Ingenieria", "platform_type": null, "country": "CL", "descripcion": "Unidad de ingenieros de combate", "quantity": 80 }
```

`sidc` y `nombre` son requeridos, el resto opcional (incluido `quantity`). `201` con el registro creado.

### `PUT /unidades/base/:id` 👑

Igual que `POST` pero todos los campos opcionales (solo actualiza lo que mandes) — incluido `quantity`.  `404` si no existe.

### `DELETE /unidades/base/:id` 👑

`204` sin body. ⚠️ **Borra en cascada** todas las `unidad_militar` creadas desde esta plantilla, y por debajo de esas, sus `documento` y `unidad_militar_usuario`. Ya no da `409` — confirmar explícitamente en el frontend antes de llamar a este endpoint, sobre todo si la plantilla tiene unidades activas.

---

## 4. Unidades militares (instancias)

`unidad_militar` es una unidad real en el mapa (ej. "Alfa 1"). Siempre nace de una plantilla de `unidad_militar_base` (`unidad_militar_base_id` es obligatorio) y **hereda de ahí `sidc`, `tipo` y `quantity`** — la unidad ya no tiene esas tres columnas propias; para cambiarlas hay que editar la plantilla (`PUT /unidades/base/:id`, sección 3), no la unidad. **Tampoco tiene relación con `ejercicio`** — a qué ejercicio/bando "pertenece" una unidad se resuelve cruzando quién la controla (`unidad_militar_usuario`, más abajo) con el bando de ese usuario en el ejercicio (`ejercicio_usuario`, sección 7), no con una columna propia. Ver `DATABASE.md` para la lista completa de columnas propias — son ~32 campos "modifier" de MIL-STD-2525/APP-6, todos opcionales salvo `nombre` y `unidad_militar_base_id`, y se mandan **tal cual el nombre de columna** (snake_case: `pos_x`, `staff_comments`, `higher_formation`, etc.) tanto en `POST` como en `PUT`.

### `GET /unidades` 🔒

Todas las unidades militares. Responde un subconjunto de columnas (para el mapa/lista); usar `GET /unidades/:id` para el registro completo.

```json
[{ "id": "1", "sidc": "SFGPUCI---****X", "nombre": "Alfa 1", "tipo": "Infanteria", "quantity": null, "pos_x": null, "pos_y": null }]
```

### `GET /unidades/mias` 🔒

Solo las unidades que controla el usuario autenticado (según `unidad_militar_usuario`). Úsalo para saber qué unidades puede usar el usuario como remitente al redactar un documento.

### `GET /unidades/:id` 🔒

Registro completo (todas las columnas propias + `sidc`/`tipo`/`quantity` resueltos desde la plantilla). `404` si no existe.

### `POST /unidades` 👑

```json
// request mínimo
{ "unidad_militar_base_id": 2, "nombre": "Zapadores 1", "pos_x": 10.5, "pos_y": 20.1 }
```

`unidad_militar_base_id` y `nombre` son requeridos (`tipo`/`quantity` **no** van acá, son de la plantilla). `400` si falta alguno, `404`/error si `unidad_militar_base_id` no existe. `201` con el registro completo (mismo shape que `GET /unidades/:id`).

### `PUT /unidades/:id` 👑

Mismos campos que `POST`, todos opcionales — actualiza solo lo que mandes. `404` si no existe.

### `DELETE /unidades/:id` 👑

`204` sin body. ⚠️ **Borra en cascada** sus `documento` asociados (como remitente o destinatario) y sus filas de `unidad_militar_usuario`. Ya no da `409`.

### Controladores de una unidad (`unidad_militar_usuario`)

Qué usuario(s) pueden operar una unidad — esto es lo que resuelve `GET /unidades/mias`.

- **`GET /unidades/:id/usuarios`** 🔒 — lista de usuarios que controlan la unidad.
- **`POST /unidades/:id/usuarios`** 👑 — `{ "usuarioId": 5 }`. `201` con la asignación. `409` si ya estaba asignado, `409` si `usuarioId` no existe.
- **`DELETE /unidades/:id/usuarios/:usuarioId`** 👑 — quita la asignación. `204`, o `404` si no existía.

---

## 5. Chat (usuario ↔ usuario)

El envío de mensajes es **solo por socket**; REST únicamente expone el historial. Si dos usuarios controlan unidades y quieres "chatear con una unidad", primero resuelve el usuario controlador con `GET /unidades/mias` / `GET /unidades` (join implícito vía `unidad_militar_usuario`) y luego chateas con ese `usuario.id`.

### `GET /chat/conversaciones` 🔒

Lista de contactos con los que ya hay historial, con el último mensaje.

```json
[{ "id": "2", "nombre": "Maria Gomez", "usuario": "mgomez", "ultimo_mensaje": "Hola Bravo 1...", "fecha": "2026-07-10T16:05:26.593Z" }]
```

### `GET /chat/:usuarioId?limit=50` 🔒

Historial con un usuario específico, orden cronológico ascendente. `limit` es opcional (máx. 200, default 50).

```json
[{ "id": "1", "remitente_id": "1", "destinatario_id": "2", "mensaje": "Hola Bravo 1, reportar posición", "fecha": "2026-07-10T16:05:26.593Z" }]
```

### Socket: enviar un mensaje

Evento `chat:send`, con ack:

```js
socket.emit("chat:send", { destinatarioId: 2, mensaje: "Hola" }, (ack) => {
  // ack.ok === true  -> ack.mensaje es la fila insertada
  // ack.ok === false -> ack.error describe el problema
});
```

### Socket: recibir un mensaje

Evento `chat:message`, llega tanto al remitente (confirmación en otras pestañas/dispositivos) como al destinatario:

```js
socket.on("chat:message", (msg) => {
  // { id, remitente_id, destinatario_id, mensaje, fecha }
});
```

---

## 6. Documentos (unidad ↔ unidad)

A diferencia del chat, remitente y destinatario de un documento son **unidades militares**, no usuarios directamente. Un usuario solo puede enviar documentos en nombre de una unidad que controla. No hay `DELETE /documentos/:id` — pero si se borra la unidad remitente o destinatario (`DELETE /unidades/:id` o `DELETE /unidades/base/:id`), el documento se borra en cascada con ella.

### `GET /documentos` 🔒

Documentos donde alguna unidad controlada por el usuario es remitente o destinatario (bandeja de entrada + salida combinada).

### `GET /documentos/:id` 🔒

Un documento puntual. `403` si ninguna unidad del usuario participa en él, `404` si no existe.

### `POST /documentos` 🔒

```json
// request
{
  "asunto": "Orden de movimiento",
  "contenido": "Avanzar a Fase Linea Azul",
  "copias": 1,
  "remitenteUnidadId": 1,
  "destinatarioUnidadId": 2
}
```

```json
// 201
{ "id": "1", "asunto": "Orden de movimiento", "contenido": "Avanzar a Fase Linea Azul", "fecha": "2026-07-10T16:05:34.787Z", "copias": 1, "remitente_id": "1", "destinatario_id": "2" }
```

`403` si el usuario no controla `remitenteUnidadId` (según `unidad_militar_usuario`). `contenido` y `copias` son opcionales.

### Socket: notificación de documento nuevo

Al crear un documento, el backend empuja un evento a los usuarios que controlan la unidad destinataria (no hace falta que ellos hagan nada, solo escuchar):

```js
socket.on("documento:nuevo", (doc) => {
  // misma forma que la respuesta de POST /documentos
});
```

---

## 7. Ejercicios

`ejercicio` es una sesión/sala de simulación. La participación se modela por **usuario + bando** (`ejercicio_usuario`), no por unidad — `unidad_militar` no tiene ninguna relación con `ejercicio`.

### `GET /ejercicios` 🔒

```json
[{ "id": "1", "sala": "Sala 1", "nombre": "Ejercicio Test", "activo": true }]
```

### `GET /ejercicios/:id` 🔒

Un solo ejercicio. `404` si no existe.

### `POST /ejercicios` 👑

```json
// request
{ "nombre": "Ejercicio Test", "sala": "Sala 1", "activo": true }
```

`nombre` es requerido; `sala` y `activo` opcionales (`activo` default `true`). `201` con el registro creado.

### `PUT /ejercicios/:id` 👑

`{ "nombre": ..., "sala": ..., "activo": ..., "velocidad_ejercicio": ... }`, todos opcionales — actualiza solo lo que mandes. Útil para "cerrar" un ejercicio con `{ "activo": false }` sin borrarlo. `404` si no existe.

`velocidad_ejercicio` tiene que ser un **entero, `≥ 1`** — `400` si no (multiplicador de la hora táctica: ×2 hace que el reloj del ejercicio avance el doble de rápido que el tiempo real). Si el ejercicio ya tiene un JSON en vivo (está o estuvo corriendo), el cambio converge ahí mismo y el motor lo aplica en el próximo ciclo — no hace falta reiniciar el ejercicio para que tenga efecto.

### `DELETE /ejercicios/:id` 👑

`204` sin body. Borra en cascada las filas de `ejercicio_usuario` asociadas (los usuarios y unidades en sí no se tocan).

### Participantes del ejercicio (`ejercicio_usuario`, con bando)

Qué usuario **no administrador** participa en el ejercicio y de qué bando (`"azul"`, `"rojo"`, texto libre).

- **`GET /ejercicios/:id/participantes`** 🔒

```json
[{ "usuario_id": "5", "usuario": "usuario_test", "nombre": "Usuario Normal de Prueba", "grado": "Soldado", "bando": "azul" }]
```

- **`POST /ejercicios/:id/participantes`** 👑 — `{ "usuarioId": 5, "bando": "azul" }`. `201` con la asignación. `400` si `usuarioId` es de un administrador (no puede participar) o si faltan campos, `404` si `usuarioId` no existe, `409` si ya estaba asignado a este ejercicio.
- **`PUT /ejercicios/:id/participantes/:usuarioId`** 👑 — `{ "bando": "rojo" }`, cambia el bando de un participante ya asignado. `404` si no existía.
- **`DELETE /ejercicios/:id/participantes/:usuarioId`** 👑 — lo saca del ejercicio. `204`, o `404` si no participaba.

Esto **no** dice qué unidades están en el ejercicio — para eso hay que cruzar en el cliente el `bando` del usuario con `GET /unidades/:id/usuarios` (sección 4) o `GET /unidades/mias` para saber qué unidades controla ese usuario.

---

## 8. Conectar el socket

```js
import { io } from "socket.io-client";

const socket = io("http://node.localhost", {
  auth: { token }, // el token de /auth/login
});

socket.on("connect", () => { /* listo */ });
socket.on("connect_error", (err) => {
  // err.message: "Token requerido" | "Token inválido o expirado"
  // -> redirigir a login
});
```

Al conectar, el servidor valida el JWT y une el socket a una room privada `user:<id>`; todo lo que se te envía (chat, documentos) llega por ahí automáticamente, no hace falta unirse a nada manualmente.

Verificado en vivo (login → conectar socket vía Traefik → upgrade a WebSocket → `chat:send`/`chat:message` → casos de error) el 2026-07-13: todo el camino funciona correctamente, incluido el proxy de Traefik para el handshake y el upgrade de WebSocket (no hace falta config adicional en `dynamic.yml`, Traefik v3 lo maneja solo para routers HTTP).

### Troubleshooting

- **`connect_error: "Token requerido"`** — no se mandó `auth: { token }` en el `io(...)`, o se mandó vacío.
- **`connect_error: "Token inválido o expirado"`** — el JWT no es válido, expiró (8h), o `JWT_SECRET` no coincide (revisar `.env`).
- **El socket nunca conecta / cuelga (sin `connect` ni `connect_error`)** — normalmente es que el navegador/cliente no llega a `http://node.localhost` en absoluto (Traefik caído, o la app está en un contenedor Docker que no puede resolver `node.localhost` — ver nota abajo). Confirmar primero con `GET http://node.localhost/health`.
- **Clientes que corren en Node (SSR, scripts de test, no un navegador) no resuelven `node.localhost`** — a diferencia de los navegadores, el resolver de Node no implementa la regla de RFC 6761 (`*.localhost` → loopback automático); sin una entrada en `/etc/hosts` o similar, `dns.lookup('node.localhost')` falla con `ENOTFOUND` aunque `curl` y el navegador sí lo resuelvan. Si el frontend hace alguna conexión de socket desde el lado servidor (no desde el browser del usuario), hay que apuntar directo al contenedor (`http://node-app:3000` dentro de la red `traefik-public`) o agregar la entrada a `/etc/hosts`.

---

## Flujo típico de un cliente nuevo

1. `POST /auth/register` (una vez) → `POST /auth/login` → guardar `token`.
2. Conectar socket con ese `token`.
3. `GET /unidades/mias` para saber qué unidades puede operar el usuario.
4. `GET /usuarios` + `GET /chat/conversaciones` para armar la lista de contactos de chat; `GET /chat/:usuarioId` para abrir una conversación.
5. Escuchar `chat:message` y `documento:nuevo` durante toda la sesión para actualizar la UI en tiempo real.
6. `GET /documentos` para la bandeja de documentos; `POST /documentos` para redactar uno nuevo.
