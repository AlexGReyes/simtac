# Respuesta a `PEDIDO_SERVIDOR_ACTUALIZACIONES.md`

Listo y verificado. El contrato del §1 se cumple tal cual: ruta, formato,
reemplazo de `__SIMTAC_BASE__`, cabeceras y ausencia de listado. Las 8
verificaciones del §4 pasan.

## 1. Datos para publicar

| Dato | Valor |
|---|---|
| Host | `10.40.0.19` (mismo host del backend) |
| Puerto SSH | `22` |
| Usuario | `simtac-publicador` |
| Carpeta vista desde la cuenta | `/actualizaciones` (la sesión abre ahí) y `/actualizaciones/archivos` |
| Autenticación | solo clave pública; la clave del §3 ya está autorizada |
| URL del manifiesto | `http://10.40.0.19/actualizaciones/latest.json` |

Huella de la clave de host, para fijar en `known_hosts`:

```
ED25519  SHA256:RykzfYnfNfwJ/Vul8n/t0ZcEDL0YksuU8iHU+NCvLvU
RSA      SHA256:D0dn/8XFL0nJIyg+kMhDKFbZVnpeBVMa+hkSWtkAmWg
```

Línea lista para `known_hosts`:

```
10.40.0.19 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAII2UEHPCg2EzSFDuFbE9MsH3JrO2pUFo7rrHwDwv0zqs
```

Las llaves de host están guardadas en el host (`actualizaciones/claves/`), así
que **la huella no cambia** al recrear o actualizar el contenedor. Si algún día
hay que rotarlas, se avisa antes.

Prueba manual:

```bash
sftp -i <clave privada> simtac-publicador@10.40.0.19
# abre en /actualizaciones; put, rename y rm funcionan ahí y en archivos/
```

## 2. Lo que quedó distinto del pedido, y por qué

### 2.1 El servidor es macOS, no Docker sobre WSL2

El pedido asume el backend en Docker dentro de WSL2 sobre Windows
(`backend.md`). El servidor real de esta instalación es un **Mac mini con macOS
26.6.2 (arm64)** y Docker Desktop. Por eso no aplica nada de lo de WSL,
*mirrored networking* ni rutas `/mnt/c/...`.

### 2.2 El SFTP corre en su propio contenedor, no como cuenta del sistema

En vez de crear la cuenta en el sistema operativo y abrir el `sshd` del Mac, el
SFTP es **un servicio más del stack**, con su propio `sshd` aislado. La jaula es
equivalente a la del §3 y de hecho usa esa misma configuración de OpenSSH.
Ventajas: no necesita `sudo`, no expone el SSH del Mac (que sigue apagado), y la
cuenta no existe en el sistema operativo, así que no hay forma de escalar desde
ella al host.

La imagen es propia (`actualizaciones/sftp/`, Alpine + OpenSSH 10.0, 18 MB).
Primero probamos `emberstack/sftp`, pero **regenera su `sshd_config` en cada
arranque** y siempre ofrece autenticación por contraseña, así que no permitía
cumplir `PasswordAuthentication no` del §3. Con la imagen propia la
configuración es explícita y auditable:

```
AuthenticationMethods publickey      # nada más que clave pública
PasswordAuthentication no
KbdInteractiveAuthentication no
AllowUsers simtac-publicador
AuthorizedKeysFile /etc/ssh/claves-autorizadas/%u   # montado de solo lectura

Match User simtac-publicador
    ChrootDirectory /srv/simtac      # de root, no escribible por el usuario
    ForceCommand internal-sftp -d /actualizaciones -l INFO
```

Dos detalles de endurecimiento sobre el pedido:

- **Las claves autorizadas se montan de solo lectura desde el host**, fuera del
  alcance de la cuenta: ni el usuario ni una subida pueden agregar una clave.
- **Sin shell de ningún tipo** (`/sbin/nologin` + `ForceCommand`): un `ssh` sin
  sftp recibe el rechazo del subsistema.

Borrar archivos **sí está permitido** (el §3.1 lo dejaba opcional), para poder
limpiar versiones viejas.

### 2.3 La carpeta vive con el stack, no en `/srv`

macOS no trae `/srv` y crearlo pide `sudo`. La carpeta publicada es:

```
simtac-deploy/actualizaciones/datos/          <- se ve como /actualizaciones
simtac-deploy/actualizaciones/datos/archivos/ <- se ve como /actualizaciones/archivos
```

Dentro del contenedor SFTP se monta en `/srv/simtac/actualizaciones`, así que la
jaula sigue siendo `/srv/simtac` como en el pedido y **desde la cuenta la ruta
es `/actualizaciones`**, tal como esperaban. nginx la monta en **solo lectura**.

Las carpetas se crearon a mano antes de levantar los contenedores y el usuario
del contenedor tiene el mismo uid/gid que el dueño en el host (501:20), así que
no aparece el `Permission denied` que advertía el pedido.

### 2.4 Las firmas se sirven como `text/plain`

La config del §1.3 servía los `.sig` como `application/octet-stream`, pero la
tabla del §1.4 los pide como texto plano. Agregamos un bloque para eso:

```nginx
location ~ ^/actualizaciones/archivos/.+\.sig$ { default_type text/plain; }
```

Gana al prefijo de `archivos/` por ser regex. En ambos casos el archivo se sirve
byte a byte, sin recompresión.

### 2.5 Nada más cambió

`nginx.conf` es el del §1.3 (incluidos los dos `map`), el router de Traefik es el
del §2 con `priority: 100`, sin `stripPrefix`, y `GET /actualizaciones/health`
quedó disponible.

## 3. Qué se agregó al servidor

| Artefacto | Ruta | Qué es |
|---|---|---|
| Servicio HTTP | `docker-compose.yml` → `actualizaciones` | `nginx:alpine`, monta la carpeta en solo lectura |
| Config de nginx | `actualizaciones/nginx.conf` | §1.3 y §1.4 |
| Servicio SFTP | `docker-compose.yml` → `sftp-actualizaciones` | imagen propia, publica el puerto 22 |
| Imagen SFTP | `actualizaciones/sftp/` | `Dockerfile`, `sshd_config`, `entrypoint.sh` |
| Clave autorizada | `actualizaciones/claves-autorizadas/simtac-publicador` | la clave del §3 |
| Llaves de host | `actualizaciones/claves/` | persistidas: la huella no cambia |
| Carpeta publicada | `actualizaciones/datos/` y `datos/archivos/` | vacías, listas para la primera publicación |
| Router | `traefik/dynamic.yml` → `actualizaciones` | `PathPrefix('/actualizaciones')`, `priority: 100` |
| Verificación | `verificar_actualizaciones.sh` | las 8 pruebas del §4, repetibles |

Después de editar `traefik/dynamic.yml` se reinició Traefik, por el bind mount
ligado al inodo que advierte `backend.md`.

## 4. Resultado de las verificaciones del §4

Salida de `./verificar_actualizaciones.sh <clave>`, corrida desde el propio host
contra `http://10.40.0.19`. Para las pruebas de SFTP se autorizó
temporalmente una clave de prueba, que **ya fue retirada** (la única clave
autorizada es la del §3; se verificó que la de prueba vuelve a ser rechazada).

```
== 1) latest.json sin nada publicado: 404 de nginx ==
OK    404 servido por nginx

== 8) el router de la simulación sigue intacto ==
OK    GET /health (200)
OK    GET /actualizaciones/health (200)

== 5) sin listado de directorio ==
OK    GET /actualizaciones/archivos/ (403)
OK    GET /actualizaciones/ (403)

Huella de la clave de host: SHA256:RykzfYnfNfwJ/Vul8n/t0ZcEDL0YksuU8iHU+NCvLvU

== 2) SFTP: entra, ve /actualizaciones, sube, renombra; no sale de la jaula ni abre shell ==
OK    entra en /actualizaciones, sube y renombra
OK    no puede escribir fuera de la carpeta
OK    shell rechazada

== 3) el origen de la URL sigue al Host, con Cache-Control: no-store ==
OK    url con Host: 10.40.0.19 (http://10.40.0.19/actualizaciones/archivos/simtacv3_prueba.1790720814_x64-setup.exe)
OK    url con Host: otra.lan (http://otra.lan/actualizaciones/archivos/simtacv3_prueba.1790720814_x64-setup.exe)
OK    Cache-Control (no-store)
OK    Content-Type (application/json)

== 4) descarga del instalador íntegra ==
OK    Content-Length (524288)
OK    Content-Type (application/octet-stream)
OK    SHA-256 subido = bajado (8ae3f52edf63f3f51ab2e306cd6a0fcafbace8b79ba624e611b40102417ca953)
OK    Range soportado (206)
OK    Content-Type de la firma (text/plain)

== 6) reemplazo atómico: 150 peticiones mientras se republica ==
OK    respuestas con JSON inválido (0)

== 7) los archivos sobreviven al reinicio del contenedor ==
OK    instalador tras reiniciar (200)

-- limpieza de los archivos de prueba
OK    carpeta limpia (latest.json) (404)

Todo correcto.
```

Además, fuera del script:

- **`ssh` sin sftp** responde `This service allows sftp connections only` y corta.
- **Fuera de la jaula**: `put` a `/fuera.txt` da `Permission denied`; `/etc` no
  existe para la cuenta. La raíz de la jaula solo muestra `actualizaciones`.
- **Métodos de autenticación ofrecidos**: `publickey` y nada más
  (`Permission denied (publickey)` al forzar otro método).
- **Reinicio completo del stack** (`docker compose down && up -d`) y recreación
  de los contenedores: los archivos siguen (están en el host), la huella de la
  clave de host es la misma y `GET /health` de la simulación sigue en 200.
- **Rollback**: republicar un `latest.json` anterior por `rename` se sirve de
  inmediato, sin caché (`no-store`).
- **`Range`**: soportado (`206` con `Content-Range`), por si la descarga se corta.

Los archivos de prueba se borraron: la carpeta está vacía y
`/actualizaciones/latest.json` responde `404` hasta la primera publicación real.

## 5. Dos cosas a tener en cuenta

- **El puerto 22 queda publicado en todas las interfaces del host.** En la LAN es
  lo que necesitan; si el router llegara a reenviar el 22 desde internet,
  conviene cerrarlo ahí. La cuenta solo acepta clave pública y está enjaulada,
  pero no hace falta exponerla más allá de la LAN.
- **La carpeta está en el SSD externo** donde vive todo el stack
  (`/Volumes/SSD 1TB/...`). Si el disco no está montado, el stack no levanta:
  es la misma condición que ya tiene el resto del despliegue.

Cuando quieran, hagan la prueba final desde el cliente: publiquen la N+1 y
abran la app de un equipo con la N.
