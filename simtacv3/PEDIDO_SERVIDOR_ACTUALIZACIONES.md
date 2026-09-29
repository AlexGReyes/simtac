# Pedido: ruta de publicación de actualizaciones del cliente SIMTAC (carpeta estática + SSH)

## Contexto

El cliente Tauri (`simtacv3`) ya tiene **actualización automática** implementada
y probada del lado del cliente (`tauri-plugin-updater`). Al abrir la app, antes
del login, el cliente pide un manifiesto `latest.json` por HTTP; si la versión
publicada es **distinta** de la instalada, descarga el instalador, **verifica
su firma** contra una clave pública embebida en la app, lo instala y se
reinicia. No hay opción de posponer: la política del ejercicio es que **todos
los equipos usen la misma versión**.

Del lado servidor **no hace falta lógica**: nada de base de datos, API ni panel
de administración. La máquina que compila genera el instalador, su firma y el
`latest.json`, y los **sube por SSH**. Lo que pido es:

1. Una **carpeta** en el servidor del backend donde se depositan esos archivos.
2. Que esa carpeta quede **servida por HTTP, detrás de Traefik**, en la ruta
   que consultan los clientes.
3. Una **cuenta SSH** restringida a esa carpeta, para subir los archivos.

---

## 1. Contrato con el cliente — esto NO se puede cambiar

El cliente ya está compilado contra esto. Si algo de acá no calza, avisen antes
de implementar, no después.

### 1.1 Dónde busca

- **`GET <backend>/actualizaciones/latest.json`**, donde `<backend>` es la misma
  URL base con la que el cliente habla con el backend Node (hoy
  `http://10.40.0.19`). O sea: **`http://10.40.0.19/actualizaciones/latest.json`**.
- Es configurable en el cliente, pero ese es el valor que va a usar el 100% de
  las instalaciones si nadie toca nada. Sirvan esa ruta exacta.
- **HTTP plano** (la LAN no tiene TLS). El cliente lo acepta a propósito: lo
  que protege es la firma del instalador, no el transporte.
- Timeout del cliente: **10 s**. Si no responde (o `latest.json` no existe →
  `404`), el cliente **sigue** con la versión instalada: no bloquea el ejercicio.

### 1.2 Qué archivos hay en la carpeta

Los genera y sube la máquina que compila (`npm run compilar` en el repo del
cliente). El servidor **no los arma ni los modifica** (salvo el reemplazo del
§1.3):

```
actualizaciones/
├── latest.json
└── archivos/
    ├── simtacv3_2026.1002.915_x64-setup.exe
    ├── simtacv3_2026.1002.915_x64-setup.exe.sig
    ├── simtacv3_2026.929.1157_x64-setup.exe      ← versiones anteriores: se conservan
    └── ...                                         (volver atrás = republicar una)
```

`latest.json` (formato estático del updater de Tauri v2), como referencia:

```json
{
  "version": "2026.1002.915",
  "notes": "Corrige el congelamiento al entrar al ejercicio",
  "pub_date": "2026-10-02T15:15:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkK...",
      "url": "__SIMTAC_BASE__/actualizaciones/archivos/simtacv3_2026.1002.915_x64-setup.exe"
    }
  }
}
```

### 1.3 La URL del instalador tiene que seguir a la IP del servidor

El updater exige una `url` **absoluta**, pero la IP del host cambia (DHCP,
documentado en `backend.md` §21): si la compilación escribe
`http://10.40.0.19/...` y mañana el servidor es `10.40.0.23`, todos los
clientes fallan al descargar.

Por eso el `latest.json` subido lleva el marcador literal **`__SIMTAC_BASE__`**
en lugar del origen, y **el servidor lo reemplaza al servirlo** por el origen
con el que llegó la request (`<proto>://<host>`, tomado de
`X-Forwarded-Proto` / `X-Forwarded-Host` que pone Traefik, o de `Host`).
Con nginx es `sub_filter`. **Esta es la config completa, probada** (nginx:alpine
+ la subida real por SFTP, ver §4): con los headers de Traefik usa esos, y si
alguien entra directo al contenedor cae a `Host`, en vez de devolver una URL
rota (`://...`):

```nginx
# Origen público de la request: el que manda Traefik, o el propio si se entra directo.
map $http_x_forwarded_host  $simtac_host  { default $http_x_forwarded_host;  "" $http_host; }
map $http_x_forwarded_proto $simtac_proto { default $http_x_forwarded_proto; "" $scheme; }

server {
    listen 80;
    root /usr/share/nginx/html;
    autoindex off;
    gzip off;

    location = /actualizaciones/latest.json {
        default_type application/json;
        sub_filter_types application/json;
        sub_filter '__SIMTAC_BASE__' '$simtac_proto://$simtac_host';
        sub_filter_once off;
        add_header Cache-Control "no-store" always;
    }
    location /actualizaciones/archivos/ {
        types { }
        default_type application/octet-stream;
    }
    location = /actualizaciones/health { default_type application/json; return 200 '{"status":"ok"}'; }
}
```

(Los `map` van en contexto `http`: en `conf.d/default.conf` de la imagen
oficial ya lo están.)

Solo en `latest.json`: los `.exe` y `.sig` se sirven **byte a byte**, la firma
se verifica sobre esos bytes.

### 1.4 Cómo se sirve cada cosa

| Ruta | Requisitos |
|---|---|
| `/actualizaciones/latest.json` | `Content-Type: application/json`, **`Cache-Control: no-store`** (si un proxy lo cachea, un rollback no llega), reemplazo del §1.3 |
| `/actualizaciones/archivos/*.exe` | `Content-Type: application/octet-stream`, **`Content-Length`** (el cliente muestra una barra de progreso con él), sin recompresión (`gzip off`); ideal con soporte de `Range` (nginx lo trae) |
| `/actualizaciones/archivos/*.sig` | texto plano, byte a byte |

- **Todo público, sin autenticación**: el cliente no manda credenciales.
- **Sin listado de directorio** (`autoindex off`).
- Tamaño: el instalador pesa ≈ 5 MB hoy; dejen margen hasta **300 MB**.

---

## 2. Servir la carpeta detrás de Traefik

Traefik es solo proxy, no sirve archivos: hace falta un contenedor estático
chico. Propuesta: **`nginx:alpine`** como servicio `actualizaciones` en el
mismo `docker-compose.yml`, en la red `traefik-public`, con la carpeta del
host montada **de solo lectura**:

```yaml
  actualizaciones:
    image: nginx:alpine
    restart: unless-stopped
    volumes:
      - /srv/simtac/actualizaciones:/usr/share/nginx/html/actualizaciones:ro
      - ./actualizaciones/nginx.conf:/etc/nginx/conf.d/default.conf:ro
    networks: [traefik-public]
```

Hoy `traefik/dynamic.yml` manda **todo** a `node-app` con `PathPrefix('/')`
(`backend.md`, actualización 10-09-2026). La regla nueva tiene que **ganarle**:

```yaml
http:
  routers:
    actualizaciones:
      rule: "PathPrefix(`/actualizaciones`)"
      priority: 100          # > la del router de node-app
      service: actualizaciones
      entryPoints: [web]
  services:
    actualizaciones:
      loadBalancer:
        servers:
          - url: "http://actualizaciones:80"
```

- Sin `stripPrefix`: nginx sirve `/actualizaciones/...` tal cual desde
  `/usr/share/nginx/html/actualizaciones/`.
- Pongan `priority` explícito aunque Traefik v3 ya favorezca la regla más larga.
- ⚠️ **El bind mount de `dynamic.yml` es de un solo archivo y Docker lo liga al
  inodo** (`backend.md`): si lo editan con un editor que hace rename, Traefik no
  ve el cambio. `docker compose restart traefik` después de editarlo.
- Opcional: `GET /actualizaciones/health` → `200` estático, para diagnóstico.

La ruta del host (`/srv/simtac/actualizaciones`) es una propuesta: usen la que
les calce, pero **tiene que ser la misma** que ve la cuenta SSH del §3 y la que
monta el contenedor.

---

## 3. Cuenta SSH para publicar

La máquina que compila sube por SSH (`scp`/`sftp`) a la carpeta del §2.

- **Cuenta dedicada** (propuesta: `simtac-publicador`), que **no** sea la del
  operador del servidor ni tenga `sudo`.
- **Solo acceso a la carpeta de actualizaciones**: SFTP enjaulado, sin shell.
  Con OpenSSH:

  ```
  Match User simtac-publicador
      ChrootDirectory /srv/simtac          # propiedad de root, no escribible por el usuario
      ForceCommand internal-sftp
      AllowTcpForwarding no
      X11Forwarding no
      PasswordAuthentication no
  ```

  con `/srv/simtac/actualizaciones` **y `archivos/` adentro, ya creadas y
  propiedad de `simtac-publicador`**. Desde la cuenta, la carpeta se ve como
  `/actualizaciones`. ⚠️ Comprobado en la prueba: si la carpeta la crea Docker
  (volumen o bind mount a una ruta que no existe) queda de `root` y la
  subida falla con `Permission denied`. Créenla antes y hagan el `chown`.
- **Autenticación por clave pública, no por contraseña.** Clave pública de la
  máquina que compila, para `authorized_keys` (si después hay más máquinas
  publicadoras, una clave por máquina):

  ```
  ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFhtsrvKzhtzHc8vwW9cN99iDSMPerVDPlqnsdIRnGCw simtac-publicador@Reptilian
  ```

  Huella: `SHA256:XPEmmfPtQ7mHjyjVoj0BLD2EFcl/TPTzqUdUpIFIB4U`.
- El contenedor nginx la monta **solo lectura**: la cuenta SSH es la única vía
  de escritura.
- ⚠️ El backend corre en **Docker dentro de WSL2 sobre Windows** (`backend.md`).
  Decidan dónde corre el servidor SSH (OpenSSH de Windows o `sshd` dentro de
  WSL) y que la carpeta sea **la misma** que monta el contenedor. Con
  *mirrored networking* (ya configurado para el puerto 80) el `sshd` de WSL
  queda accesible desde la LAN; si usan el de Windows, la carpeta tiene que
  estar en una ruta que WSL/Docker vean (`/mnt/c/...`).
- Puerto: el 22 salvo que prefieran otro; díganme cuál.

### 3.1 Cómo va a publicar el cliente (para que la cuenta lo permita)

Lo hace el script de compilación, en este orden, para que ningún cliente vea
nunca un estado a medias:

1. `put` del `.exe` y el `.sig` a `/actualizaciones/archivos/` (primero como
   `*.part`, y `rename` al nombre final al terminar).
2. `put` de `latest.json.part` a `/actualizaciones/` y **`rename`** a
   `latest.json`: el reemplazo es atómico (mismo sistema de archivos), así un
   cliente que consulta justo en ese momento ve la versión vieja o la nueva
   completa, nunca un JSON cortado.

O sea, la cuenta necesita **crear, sobrescribir y renombrar** archivos en esas
dos carpetas. Borrar no es necesario (las versiones viejas se conservan para
poder volver atrás); si quieren permitirlo para limpieza, bien.

---

## 4. Qué verificar antes de dar esto por cerrado

Del lado del cliente ya está probado contra un servidor equivalente
(`atmoz/sftp` enjaulado + `nginx:alpine` con la config del §1.3, en Docker):
subida sin publicar, publicación, `url` distinta según el host, descarga con
SHA-256 idéntico, sin listado, rollback, shell rechazada, clave de host
cambiada → el script se niega a subir, y la app de release leyendo el
`latest.json` servido. Falta repetirlo contra el servidor real:

Desde **otra máquina de la LAN**:

1. `curl -i http://<ip>/actualizaciones/latest.json` sin nada subido → `404`
   (no `502`, no el `404` de `node-app`: que venga de nginx).
2. `sftp -i <clave> simtac-publicador@<ip>`: entra, ve `/actualizaciones`, puede
   subir y renombrar ahí; **no** puede salir de la jaula ni abrir una shell
   (`ssh simtac-publicador@<ip>` sin sftp → rechazado).
3. Subir un `latest.json` con `__SIMTAC_BASE__` y pedirlo con dos `Host`
   distintos (`curl -H "Host: 10.40.0.19"` y `-H "Host: otra"`): la `url`
   devuelta cambia con el `Host`, y trae `Cache-Control: no-store`.
4. Subir un `.exe` de prueba y bajarlo por HTTP → `200`, `Content-Length`
   correcto, **SHA-256 del archivo bajado = el del subido**.
5. `curl http://<ip>/actualizaciones/archivos/` → sin listado (`403`).
6. Reemplazar `latest.json` por `rename` mientras otro `curl` lo pide en bucle:
   nunca devuelve un JSON inválido.
7. Reiniciar el stack → todo sigue (la carpeta está en el host).
8. `GET /health` de la simulación sigue en `200` (no se rompió el router de
   `node-app`).

La prueba final la hago yo desde el cliente: un equipo con la versión N,
publico la N+1 por SSH, al abrir la app se tiene que actualizar solo.

---

## 5. Entregables

- Servicio `actualizaciones` (nginx) en `docker-compose.yml` + su `nginx.conf`
  (§1.3, §1.4).
- Router en `traefik/dynamic.yml` (§2).
- Carpeta en el host con los permisos del §3.
- Cuenta SSH enjaulada con mi clave pública en `authorized_keys`.
- Respuesta en `RESPUESTA_PEDIDO_SERVIDOR_ACTUALIZACIONES.md` con:
  - **host, puerto y usuario SSH**, y la **huella (fingerprint) de la clave del
    host** (`ssh-keyscan -t ed25519 <ip> | ssh-keygen -lf -`), para que el
    script la fije en `known_hosts` y no acepte a ciegas un servidor impostor;
  - la ruta de la carpeta tal como se ve desde la cuenta SFTP;
  - qué quedó distinto de este pedido y por qué;
  - la salida de las verificaciones del §4.
