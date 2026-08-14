# src/vendor/ — dependencias sin CDN

El equipo que corre `simtacv3` no tiene conexión a internet, así que ningún
archivo de `index.html` puede venir de un CDN (`jsdelivr`, `fonts.googleapis.com`,
etc.): todo lo que antes se cargaba por `<script src="https://...">` o
`<link href="https://...">` vive acá, copiado de los mismos paquetes que ya
están en `package.json`.

| Archivo | Sale de | Versión | Reemplaza |
|---|---|---|---|
| `ol/ol.js` | `node_modules/ol/dist/ol.js` | 10.9.0 | `cdn.jsdelivr.net/npm/ol@10.9.0/dist/ol.js` |
| `ol/ol.css` | `node_modules/ol/ol.css` | 10.9.0 | `cdn.jsdelivr.net/npm/ol@10.9.0/ol.css` |
| `milsymbol/milsymbol.js` | `node_modules/milsymbol/dist/milsymbol.js` | 3.0.4 | `cdn.jsdelivr.net/npm/milsymbol@3.0.4/dist/milsymbol.min.js` |
| `socket.io/socket.io.js` | `node_modules/socket.io-client/dist/socket.io.js` | 4.5.4 | `cdn.jsdelivr.net/npm/socket.io-client@4.5.4/dist/socket.io.js` |
| `fonts.css` + `../assets/fonts/unica-one-*.woff2` | `fonts.googleapis.com/css2?family=Unica+One` (subsets `latin`/`latin-ext`) | v20 | `fonts.googleapis.com` + `fonts.gstatic.com` |

Los tres `.js` son los mismos bundles UMD que servía el CDN — cada uno sigue
exponiendo su global de siempre (`window.ol`, `window.ms`, `window.io`), así
que el resto del código (`mapa.js`, `sidc.js`/`simbolo.js`, `socket.js`) no
cambió nada de cómo los usa.

## Por qué copiados a mano y no un bundler

El proyecto no tiene paso de build para el frontend (`src/` se sirve tal cual,
`CLAUDE.md`): agregar Vite/Webpack solo para esto sería un cambio de
arquitectura mucho más grande que lo que pide el problema. Copiar el `dist`
que cada paquete ya trae — y que ya vive en `node_modules` porque `ol` y
`milsymbol` son dependencias de `package.json`, y `socket.io-client` se
agregó como dependencia igual aunque antes solo se cargaba por CDN — es el
camino más chico.

⚠️ `npm install` no actualiza `src/vendor/` solo: son copias, no symlinks. Si
se sube la versión de `ol`, `milsymbol` o `socket.io-client` en `package.json`,
hay que repetir el `cp` de la tabla de arriba a mano (los `.js.map` de al
lado no hace falta copiarlos, son solo para depurar con el árbol de fuentes
completo).

## Fuentes

`unica-one-latin.woff2` / `unica-one-latin-ext.woff2` son los mismos archivos
`.woff2` que Google Fonts servía para `family=Unica+One&display=swap`, bajados
una sola vez. Se dejó afuera el subset `vietnamese` que traía la hoja de
Google Fonts porque la interfaz no usa esos caracteres. Si en algún momento
hace falta agregar otro peso/estilo de la tipografía, hay que volver a
bajarlo de `fonts.gstatic.com` (con internet, una sola vez) y sumar su
`@font-face` a `fonts.css`.
