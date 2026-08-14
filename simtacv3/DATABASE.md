# Estructura de la base de datos — simtac

Referencia para el frontend: qué tablas existen, qué columnas tiene cada una,
cómo se relacionan entre sí y qué endpoint de la API (ver `API.md`) expone
cada una. Útil para diseñar formularios, tablas y selects.

Motor: PostgreSQL 16. Los `id` son `BIGSERIAL` (llegan como **string** en el
JSON de la API, no como number — ojo al tipar en el frontend).

---

## Diagrama de relaciones

```
usuario ──< unidad_militar_usuario >── unidad_militar ──> unidad_militar_base
   │                                        │
   │                                        └──< documento >──┘  (remitente_id / destinatario_id, ambos apuntan a unidad_militar)
   │
   ├──< chat >──┘  (remitente_id / destinatario_id, ambos apuntan a usuario)
   │
   └──< ejercicio_usuario >── ejercicio   (con bando)
```

`>──` y `──<` indican el lado "muchos" de una relación 1-N. `unidad_militar_usuario`
y `ejercicio_usuario` son tablas puente N-N. **`unidad_militar` no tiene
ninguna relación con `ejercicio`** — quién participa en un ejercicio se
resuelve a nivel de `usuario` (con su `bando`), no de unidad.

---

## Tablas

### `usuario`

Cuentas del sistema (login).

| Columna | Tipo | Null | Notas |
|---|---|---|---|
| `id` | bigint | NOT NULL | PK |
| `usuario` | varchar(100) | NOT NULL | login, único |
| `password` | varchar(255) | NOT NULL | hash bcrypt — **nunca se expone en la API** |
| `nombre` | varchar(200) | NOT NULL | nombre completo |
| `grado` | varchar(100) | null | grado militar, texto libre |
| `rol` | varchar(20) | NOT NULL | `'administrador'` \| `'jugador'` (default `'jugador'`) |
| `fecha_creacion` | timestamptz | NOT NULL | default `now()` |
| `fecha_modificacion` | timestamptz | NOT NULL | se actualiza sola con cada `UPDATE` (trigger) |

Expuesta por: `POST /auth/register` (crear), `POST /auth/login`, `GET /auth/me`,
`GET /usuarios`, `GET /usuarios/:id` (leer), `PUT /usuarios/:id` 👑 (editar),
`DELETE /usuarios/:id` 👑 (borrar). 👑 = requiere `rol: "administrador"`.
Nunca incluye `password` en las respuestas.

---

### `unidad_militar_base`

Catálogo de unidades militares **predefinidas** (plantillas), reutilizables
al crear una `unidad_militar`. `sidc`, `tipo` y `quantity` (cantidad de
efectivos) viven únicamente aquí — `unidad_militar` no tiene columnas
propias para ninguno de los tres, los hereda de la plantilla a través de
`unidad_militar_base_id`.

| Columna | Tipo | Null | Notas |
|---|---|---|---|
| `id` | bigint | NOT NULL | PK |
| `sidc` | varchar(30) | NOT NULL | código SIDC de la plantilla |
| `nombre` | varchar(200) | NOT NULL | nombre de la plantilla (ej. "Compañía de Infantería") |
| `tipo` | varchar(100) | null | |
| `platform_type` | varchar(100) | null | |
| `country` | varchar(100) | null | |
| `descripcion` | text | null | |
| `fecha_creacion` | timestamptz | NOT NULL | default `now()` |
| `quantity` | integer | null | cantidad de efectivos de la plantilla |

CRUD completo: `GET /unidades/base`, `GET /unidades/base/:id`,
`POST /unidades/base` 👑, `PUT /unidades/base/:id` 👑,
`DELETE /unidades/base/:id` 👑 — **borra en cascada** todas las
`unidad_militar` creadas desde esta plantilla (y, por debajo, sus
`documento` y `unidad_militar_usuario` asociados: ver el aviso de FKs al
final de este archivo). Ya no da `409`, borra de verdad.

---

### `unidad_militar`

Instancia real de una unidad en el mapa (ej. "Alfa 1"). Tiene muchísimos
campos porque modela los *modifiers* de MIL-STD-2525/APP-6; la mayoría son
opcionales y solo se completan si aplica. **No tiene relación con
`ejercicio`** — a qué ejercicio/bando pertenece se resuelve vía
`ejercicio_usuario` + `unidad_militar_usuario` (¿qué usuario controla la
unidad? ¿en qué ejercicio/bando participa ese usuario?), no con una columna
propia. Tampoco tiene `sidc`, `tipo` ni `quantity` propios — los tres viven
en `unidad_militar_base` (ver arriba) y se leen vía `JOIN`.

| Columna | Tipo | Null | Notas |
|---|---|---|---|
| `id` | bigint | NOT NULL | PK |
| `unidad_militar_base_id` | bigint | NOT NULL | FK → `unidad_militar_base.id`, `ON DELETE CASCADE` — de acá salen `sidc`, `tipo` y `quantity` |
| `nombre` | varchar(200) | NOT NULL | nombre propio de la instancia (ej. "Alfa 1") |
| `staff_comments` | text | null | |
| `common_identifier` | varchar(100) | null | |
| `higher_formation` | varchar(150) | null | |
| `evaluation_rating` | varchar(10) | null | |
| `combat_effectiveness` | varchar(10) | null | |
| `altitude_depth` | varchar(50) | null | |
| `dtg` | varchar(25) | null | date-time group |
| `iff_sif` | varchar(50) | null | |
| `type` | varchar(100) | null | |
| `platform_type` | varchar(100) | null | |
| `equipment_teardown_time` | varchar(50) | null | |
| `speed` | varchar(50) | null | |
| `special_headquarters` | varchar(100) | null | |
| `unique_designation` | varchar(150) | null | |
| `additional_information` | text | null | |
| `auxiliary_equipment_indicator` | varchar(50) | null | |
| `country` | varchar(100) | null | |
| `direction` | varchar(50) | null | |
| `engagement_bar` | varchar(50) | null | |
| `engagement_type` | varchar(50) | null | |
| `guarded_unit` | varchar(150) | null | |
| `headquarters_element` | varchar(50) | null | |
| `hostile` | varchar(50) | null | |
| `installation_composition` | varchar(100) | null | |
| `reinforced_reduced` | varchar(10) | null | |
| `sigint` | varchar(50) | null | |
| `target_number` | varchar(50) | null | |
| `signature_equipment` | varchar(100) | null | |
| `special_designator` | varchar(150) | null | |
| `speed_leader` | varchar(50) | null | |
| `pos_x` | double precision | null | posición X en el mapa/plano |
| `pos_y` | double precision | null | posición Y en el mapa/plano |

CRUD completo: `GET /unidades` y `GET /unidades/mias` devuelven un
**subconjunto** (`id, sidc, nombre, tipo, quantity, pos_x, pos_y` — `sidc`,
`tipo` y `quantity` resueltos desde la plantilla); `GET /unidades/:id`
devuelve **todas** las columnas propias + `sidc`/`tipo`/`quantity` de la
plantilla. `POST /unidades` 👑 y `PUT /unidades/:id` 👑 aceptan cualquiera de
las ~32 columnas propias de la tabla (mismo nombre, snake_case) — para
`tipo`/`quantity` hay que editar la plantilla (`PUT /unidades/base/:id`), no
la unidad. `DELETE /unidades/:id` 👑 **borra en cascada** sus `documento`
asociados (ya no da `409`). Asignar/quitar quién controla la unidad:
`GET|POST /unidades/:id/usuarios`, `DELETE /unidades/:id/usuarios/:usuarioId`
(`POST`/`DELETE` 👑).

---

### `ejercicio`

Sesión/ejercicio de simulación.

| Columna | Tipo | Null | Notas |
|---|---|---|---|
| `id` | bigint | NOT NULL | PK |
| `sala` | varchar(100) | null | |
| `nombre` | varchar(200) | NOT NULL | |
| `activo` | boolean | NOT NULL | si el ejercicio está en curso; default `true` |

CRUD completo: `GET /ejercicios`, `GET /ejercicios/:id`, `POST /ejercicios` 👑
(`activo` opcional, default `true`), `PUT /ejercicios/:id` 👑 (`activo` se
puede poner en `false` para "cerrar" el ejercicio sin borrarlo).
`DELETE /ejercicios/:id` 👑.

---

### `ejercicio_usuario` (puente N-N, con atributo)

Qué usuario **no administrador** participa en qué ejercicio, y de qué
**bando** (ej. `"azul"` / `"rojo"` — texto libre, no hay `CHECK` de valores
todavía). Reemplaza al viejo diseño donde esto se resolvía a nivel de
`unidad_militar`.

| Columna | Tipo | Null | Notas |
|---|---|---|---|
| `id` | bigint | NOT NULL | PK |
| `ejercicio_id` | bigint | NOT NULL | FK → `ejercicio.id`, `ON DELETE/UPDATE CASCADE` |
| `usuario_id` | bigint | NOT NULL | FK → `usuario.id`, `ON DELETE/UPDATE CASCADE` |
| `bando` | varchar(50) | NOT NULL | lado del ejercicio, texto libre |

`UNIQUE (ejercicio_id, usuario_id)` — un usuario no puede estar dos veces en
el mismo ejercicio (pero sí cambiar de bando vía `PUT`). Un **trigger**
(`trg_ejercicio_usuario_no_admin`) rechaza a nivel de base de datos cualquier
`INSERT`/`UPDATE` donde `usuario_id` sea de un usuario con `rol =
"administrador"` — es una regla de negocio, no solo de la API.

Expuesta por `GET /ejercicios/:id/participantes`,
`POST /ejercicios/:id/participantes` 👑 (`{ "usuarioId": 5, "bando": "azul" }`,
`400` si el usuario es administrador o no existe),
`PUT /ejercicios/:id/participantes/:usuarioId` 👑 (cambia el `bando`),
`DELETE /ejercicios/:id/participantes/:usuarioId` 👑.

---

### `unidad_militar_usuario` (puente N-N)

Qué usuario(s) controlan cada unidad militar. Es la tabla que resuelve
"¿quién opera esta unidad?" — se usa para saber a nombre de qué unidades
puede actuar un usuario (remitente de documentos, `GET /unidades/mias`).

| Columna | Tipo | Null | Notas |
|---|---|---|---|
| `id` | bigint | NOT NULL | PK |
| `unidad_militar_id` | bigint | NOT NULL | FK → `unidad_militar.id`, `ON DELETE/UPDATE CASCADE` |
| `usuario_id` | bigint | NOT NULL | FK → `usuario.id`, `ON DELETE/UPDATE CASCADE` |

`UNIQUE (unidad_militar_id, usuario_id)`. Expuesta por
`GET /unidades/:id/usuarios`, `POST /unidades/:id/usuarios` 👑,
`DELETE /unidades/:id/usuarios/:usuarioId` 👑 (y de forma indirecta/resumida
por `GET /unidades/mias`).

---

### `chat`

Mensajería **usuario ↔ usuario** (no unidad ↔ unidad).

| Columna | Tipo | Null | Notas |
|---|---|---|---|
| `id` | bigint | NOT NULL | PK |
| `remitente_id` | bigint | NOT NULL | FK → `usuario.id`, `ON DELETE/UPDATE CASCADE` |
| `destinatario_id` | bigint | NOT NULL | FK → `usuario.id`, `ON DELETE/UPDATE CASCADE` |
| `mensaje` | text | NOT NULL | |
| `fecha` | timestamptz | NOT NULL | default `now()` |

⚠️ Borrar un `usuario` (`DELETE /usuarios/:id`) ahora **borra en cascada todo
su historial de chat** (enviado y recibido), ya no lo bloquea.

Expuesta por `GET /chat/conversaciones`, `GET /chat/:usuarioId` y el socket
`chat:send` / `chat:message` (ver `API.md`).

---

### `documento`

Correspondencia **unidad ↔ unidad** (no usuario ↔ usuario). Remitente y
destinatario son siempre `unidad_militar`, nunca `usuario` directamente.

| Columna | Tipo | Null | Notas |
|---|---|---|---|
| `id` | bigint | NOT NULL | PK |
| `asunto` | varchar(255) | NOT NULL | |
| `contenido` | text | null | |
| `fecha` | timestamptz | NOT NULL | default `now()` |
| `copias` | integer | NOT NULL | default `0` |
| `remitente_id` | bigint | NOT NULL | FK → `unidad_militar.id`, `ON DELETE/UPDATE CASCADE` |
| `destinatario_id` | bigint | NOT NULL | FK → `unidad_militar.id`, `ON DELETE/UPDATE CASCADE` |

Expuesta por `GET /documentos`, `GET /documentos/:id`, `POST /documentos` y
el socket `documento:nuevo` (ver `API.md`).

⚠️ Borrar una `unidad_militar` ahora **borra en cascada todos sus
documentos** (como remitente o destinatario), ya no lo bloquea.

---

## Notas para armar las vistas

- **IDs son strings en el JSON** (Postgres `bigint` → `pg` los serializa como
  string para no perder precisión). No asumir `number`.
- **`rol` de usuario** solo tiene dos valores posibles: `administrador` /
  `jugador` (hay un `CHECK` en la base). Útil para mostrar/ocultar vistas de
  administración en el frontend. ⚠️ El valor `usuario` es el nombre viejo del
  rol no-administrador y quedó obsoleto: no lo uses como literal en código
  nuevo. Para "todos los que no son admin", comparar por `!== 'administrador'`
  es más robusto que por `=== 'jugador'`.
- **`sidc`, `tipo` y `quantity` (cantidad de efectivos) ya no están en
  `unidad_militar`**, solo en `unidad_militar_base`. La API sigue
  devolviendo los tres en `GET /unidades` (se resuelven con un `JOIN`), así
  que no cambia mucho el contrato que ya consume el frontend — pero si el
  frontend edita `tipo`/`quantity` desde un formulario de unidad, ahora
  tiene que mandar ese `PUT` a `/unidades/base/:id`, no a `/unidades/:id`.
- **Chat vs. documentos usan entidades distintas**: chat es entre `usuario`s,
  documentos son entre `unidad_militar`es. Si el frontend quiere "chatear con
  una unidad", primero hay que resolver qué `usuario` la controla (tabla
  `unidad_militar_usuario`, expuesta indirectamente en `GET /unidades/mias`).
- **CRUD y autorización**: todas las tablas tienen ya CRUD completo por REST
  (ver `API.md`). Leer (`GET`) solo requiere estar logueado; crear/editar/
  borrar en `usuario`, `unidad_militar`, `unidad_militar_base`, `ejercicio`,
  `unidad_militar_usuario` y `ejercicio_usuario` requiere `rol:
  "administrador"` (marcado con 👑 en `API.md`). `chat` y `documento` son
  historial/correspondencia — se quedan como append-only (crear + leer), sin
  editar/borrar por REST.
- **`unidad_militar` no tiene relación con `ejercicio`** (se eliminó
  `unidad_militar.ejercicio_id`, que a su vez había reemplazado a la vieja
  tabla puente `ejercicio_unidad_militar`, también eliminada). La
  participación en un ejercicio ahora es por **usuario + bando**
  (`ejercicio_usuario`), no por unidad. Si el frontend necesita saber "qué
  unidades están del bando azul", hay que resolverlo en el cliente cruzando
  `ejercicio_usuario` (usuario → bando) con `unidad_militar_usuario`
  (usuario → unidades que controla) — no hay un endpoint que lo haga en un
  solo paso todavía; avisar si hace falta.
- ⚠️ **Todas las FK del esquema son `ON DELETE CASCADE ON UPDATE CASCADE`**
  (antes algunas eran `RESTRICT`, ver historial). Esto significa que borrar
  un registro **borra en cascada toda su descendencia**, y ya no bloquea el
  borrado con `409` como antes en algunos casos. Cadena completa a tener en
  cuenta antes de exponer un botón "borrar" en el frontend, especialmente
  para administradores:
  - Borrar un `usuario` → borra sus `chat`, sus filas de
    `unidad_militar_usuario` y de `ejercicio_usuario`.
  - Borrar una `unidad_militar_base` (plantilla) → borra **todas** las
    `unidad_militar` creadas desde ella → lo que a su vez borra sus
    `documento` y sus filas de `unidad_militar_usuario`.
  - Borrar una `unidad_militar` → borra sus `documento` (como remitente o
    destinatario) y sus filas de `unidad_militar_usuario`.
  - Borrar un `ejercicio` → borra sus filas de `ejercicio_usuario`.
  - `ON UPDATE CASCADE` es principalmente defensivo: como todos los `id`
    son `BIGSERIAL` autogenerados y nunca se actualizan a mano, en la
    práctica no debería dispararse nunca.
  - Recomendación para el frontend: en las vistas de borrado de `usuario`,
    `unidad_militar_base` y `unidad_militar` (las que tienen descendencia
    grande), mostrar una confirmación explícita del alcance del borrado
    antes de llamar al `DELETE` — la API ya no va a avisar con un `409`.
