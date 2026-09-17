// Cliente HTTP del backend.
//
// - Base configurable (`config.js`, clave `backend`; por defecto
//   `http://node.localhost`), header `Authorization: Bearer <token>`.
// - Todos los errores del backend tienen la forma { error: "mensaje" }.
// - Interceptor de 401: intenta UN refresh, reintenta la request original y, si
//   el refresh también falla, avisa que la sesión murió (evento
//   `simtac:sesion-expirada`).
// - El refresh token ROTA: cada /auth/refresh devuelve uno nuevo y el anterior
//   deja de servir, así que se guarda siempre el nuevo.

import Session from './session.js';
import Config from './config.js';

/**
 * Base del backend Node. Es `let` a propósito: `Config.cargar()` corre al
 * arrancar y `sincronizarBase()` la actualiza, y como los módulos ES tienen
 * enlaces vivos, quien la importó (`socket.js`, `admin.js`) ve el valor nuevo
 * sin volver a importar nada. Todas las lecturas ocurren dentro de funciones,
 * nunca al cargar el módulo, así que ninguna se queda con el valor viejo.
 */
export let API_BASE = Config.backend();

/** Realinea la base con la configuración ya resuelta. La llama `app.js`. */
export function sincronizarBase() {
  API_BASE = Config.backend();
  return API_BASE;
}

/**
 * ¿Se llega al backend? Es para el panel de configuración: sirve para
 * distinguir "el servidor está caído" de "la dirección apunta a cualquier
 * lado", que desde la app se ven igual (todo falla).
 *
 * Distingue tres desenlaces, porque desde la app los tres se ven igual (todo
 * falla) pero se arreglan en lugares distintos:
 *
 *   - `"ok"`      — `/health` contesta 2xx: es el backend y está vivo.
 *   - `"ajeno"`   — contesta algo, pero no 2xx. Hay un servidor de ese lado que
 *                   no es nuestro backend, o el proxy de adelante no está
 *                   ruteando hasta él. El caso real: el proxy rutea por header
 *                   `Host`, así que apuntar a `http://<ip>` en vez de al nombre
 *                   con el que tiene regla devuelve 404 (ver `backend.md`,
 *                   punto 21). No es un problema que se resuelva del lado del
 *                   cliente, y por eso conviene nombrarlo.
 *   - `"caido"`   — fallo de red: host inexistente, puerto cerrado o timeout.
 *
 * El timeout es corto a propósito: una IP que ya no existe no rechaza la
 * conexión, se queda colgada hasta que expira —unos 20 s en Windows— y el
 * usuario no tiene por qué esperar eso para saber que se equivocó de dirección.
 */
export async function probarConexion(base = API_BASE) {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), 6000);
  const t0 = Date.now();
  try {
    const respuesta = await fetch(`${base}/health`, { signal: control.signal });
    const ms = Date.now() - t0;
    if (respuesta.ok) {
      return { resultado: 'ok', status: respuesta.status, detalle: `responde en ${ms} ms` };
    }
    return {
      resultado: 'ajeno',
      status: respuesta.status,
      detalle: `contesta HTTP ${respuesta.status}: hay un servidor ahí, pero no es el backend`,
    };
  } catch (error) {
    const expiro = error.name === 'AbortError';
    return {
      resultado: 'caido',
      status: null,
      detalle: expiro
        ? 'sin respuesta en 6 s (¿dirección equivocada o servidor apagado?)'
        : `no se pudo conectar (${error.message})`,
    };
  } finally {
    clearTimeout(reloj);
  }
}

export class ApiError extends Error {
  constructor(mensaje, status) {
    super(mensaje);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Mensajes legibles por código, para cuando el backend no manda `error`. */
const MENSAJES_POR_STATUS = {
  400: 'Datos inválidos',
  401: 'Sesión inválida o expirada',
  403: 'No tenés permisos para esta acción',
  404: 'El recurso no existe',
  409: 'Conflicto: el registro ya existe o está en uso',
  500: 'Error interno del servidor',
};

let refrescoEnCurso = null;

function sesionExpirada() {
  Session.clear();
  window.dispatchEvent(new CustomEvent('simtac:sesion-expirada'));
}

/**
 * Renueva el access token. Varias requests que fallen con 401 a la vez
 * comparten la misma promesa para no quemar el refresh token dos veces.
 */
export function refrescarToken() {
  if (refrescoEnCurso) return refrescoEnCurso;

  const refreshToken = Session.getRefreshToken();
  if (!refreshToken) return Promise.resolve(false);

  refrescoEnCurso = (async () => {
    try {
      const respuesta = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!respuesta.ok) return false;
      const datos = await respuesta.json();
      Session.setSesion({
        token: datos.token,
        refreshToken: datos.refreshToken,
        usuario: datos.usuario ?? Session.getUser(),
      });
      // El handshake viejo del socket no se revalida solo.
      window.dispatchEvent(new CustomEvent('simtac:token-renovado', { detail: { token: datos.token } }));
      return true;
    } catch {
      return false;
    } finally {
      refrescoEnCurso = null;
    }
  })();

  return refrescoEnCurso;
}

/**
 * `fetch` con Authorization y reintento tras refresh. Firma compatible con
 * fetch para poder usarse como reemplazo directo.
 */
export async function apiFetch(url, opciones = {}, _esReintento = false) {
  const headers = new Headers(opciones.headers || {});
  const token = Session.getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (opciones.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const respuesta = await fetch(url, { ...opciones, headers });

  if (respuesta.status === 401 && !_esReintento) {
    const renovado = await refrescarToken();
    if (renovado) return apiFetch(url, opciones, true);
    sesionExpirada();
  }

  return respuesta;
}

async function request(metodo, ruta, cuerpo) {
  const opciones = { method: metodo };
  if (cuerpo !== undefined) opciones.body = JSON.stringify(cuerpo);

  let respuesta;
  try {
    respuesta = await apiFetch(`${API_BASE}${ruta}`, opciones);
  } catch (e) {
    throw new ApiError('No se pudo contactar al servidor', 0);
  }

  if (respuesta.status === 204) return null;

  let datos = null;
  const texto = await respuesta.text();
  if (texto) {
    try {
      datos = JSON.parse(texto);
    } catch {
      datos = null;
    }
  }

  if (!respuesta.ok) {
    const mensaje = datos?.error || MENSAJES_POR_STATUS[respuesta.status] || `Error ${respuesta.status}`;
    throw new ApiError(mensaje, respuesta.status);
  }

  return datos;
}

const get = (ruta) => request('GET', ruta);
const post = (ruta, cuerpo) => request('POST', ruta, cuerpo ?? {});
const put = (ruta, cuerpo) => request('PUT', ruta, cuerpo ?? {});
const del = (ruta) => request('DELETE', ruta);

/** Quita claves con '' / null / undefined: el backend actualiza solo lo que llega. */
export function limpiar(objeto) {
  const salida = {};
  for (const [clave, valor] of Object.entries(objeto)) {
    if (valor === '' || valor === null || valor === undefined) continue;
    salida[clave] = valor;
  }
  return salida;
}

const Api = {
  /** Realinea la base con la configuración resuelta (ver `sincronizarBase`). */
  sincronizarBase,
  probarConexion,

  get,
  post,
  put,
  del,
  request,

  // --- Autenticación -------------------------------------------------------
  auth: {
    async login(usuario, password) {
      const datos = await post('/auth/login', { usuario, password });
      Session.setSesion({
        token: datos.token,
        refreshToken: datos.refreshToken,
        usuario: datos.usuario,
      });
      return datos;
    },
    register(usuario, password, nombre, grado = null) {
      return post('/auth/register', limpiar({ usuario, password, nombre, grado }));
    },
    me: () => get('/auth/me'),
    refrescar: refrescarToken,
  },

  // --- Ejercicios ----------------------------------------------------------
  ejercicios: {
    disponibles: () => get('/ejercicios/disponibles'),
    listar: () => get('/ejercicios'),
    obtener: (id) => get(`/ejercicios/${id}`),
    crear: (cuerpo) => post('/ejercicios', cuerpo),
    actualizar: (id, cuerpo) => put(`/ejercicios/${id}`, cuerpo),
    borrar: (id) => del(`/ejercicios/${id}`),
    participantes: (id) => get(`/ejercicios/${id}/participantes`),
    agregarParticipante: (id, usuarioId, bando) => post(`/ejercicios/${id}/participantes`, { usuarioId, bando }),
    cambiarBando: (id, usuarioId, bando) => put(`/ejercicios/${id}/participantes/${usuarioId}`, { bando }),
    quitarParticipante: (id, usuarioId) => del(`/ejercicios/${id}/participantes/${usuarioId}`),
  },

  // --- Usuarios ------------------------------------------------------------
  usuarios: {
    listar: () => get('/usuarios'),
    obtener: (id) => get(`/usuarios/${id}`),
    actualizar: (id, cuerpo) => put(`/usuarios/${id}`, cuerpo),
    borrar: (id) => del(`/usuarios/${id}`),
  },

  // --- Plantillas de unidad (sidc, tipo, quantity viven acá) ---------------
  unidadesBase: {
    listar: () => get('/unidades/base'),
    obtener: (id) => get(`/unidades/base/${id}`),
    crear: (cuerpo) => post('/unidades/base', cuerpo),
    actualizar: (id, cuerpo) => put(`/unidades/base/${id}`, cuerpo),
    borrar: (id) => del(`/unidades/base/${id}`),
  },

  // --- Unidades (instancias) ----------------------------------------------
  unidades: {
    listar: () => get('/unidades'),
    mias: () => get('/unidades/mias'),
    obtener: (id) => get(`/unidades/${id}`),
    crear: (cuerpo) => post('/unidades', cuerpo),
    actualizar: (id, cuerpo) => put(`/unidades/${id}`, cuerpo),
    borrar: (id) => del(`/unidades/${id}`),
    controladores: (id) => get(`/unidades/${id}/usuarios`),
    asignarControlador: (id, usuarioId) => post(`/unidades/${id}/usuarios`, { usuarioId }),
    quitarControlador: (id, usuarioId) => del(`/unidades/${id}/usuarios/${usuarioId}`),
  },

  // --- Armamento -----------------------------------------------------------
  armamento: {
    listar: () => get('/armamento'),
    obtener: (id) => get(`/armamento/${id}`),
    crear: (cuerpo) => post('/armamento', cuerpo),
    actualizar: (id, cuerpo) => put(`/armamento/${id}`, cuerpo),
    borrar: (id) => del(`/armamento/${id}`),
  },

  // --- Plantillas de vehículo (con armamentos aplanados en armamentos[]) ---
  vehiculosBase: {
    listar: () => get('/vehiculos/base'),
    obtener: (id) => get(`/vehiculos/base/${id}`),
    crear: (cuerpo) => post('/vehiculos/base', cuerpo),
    actualizar: (id, cuerpo) => put(`/vehiculos/base/${id}`, cuerpo),
    borrar: (id) => del(`/vehiculos/base/${id}`),
    armamentos: (id) => get(`/vehiculos/base/${id}/armamentos`),
    // Idempotente: si el arma ya estaba montada, actualiza su munición.
    montarArmamento: (id, armamentoId, municion) =>
      post(`/vehiculos/base/${id}/armamentos`, limpiar({ armamentoId, municion })),
    desmontarArmamento: (id, armamentoId) => del(`/vehiculos/base/${id}/armamentos/${armamentoId}`),
  },

  // --- Vehículos (instancias) ---------------------------------------------
  vehiculos: {
    listar: (ejercicioId) => get(ejercicioId ? `/vehiculos?ejercicioId=${ejercicioId}` : '/vehiculos'),
    obtener: (id) => get(`/vehiculos/${id}`),
    crear: (cuerpo) => post('/vehiculos', cuerpo),
    actualizar: (id, cuerpo) => put(`/vehiculos/${id}`, cuerpo),
    borrar: (id) => del(`/vehiculos/${id}`),
  },

  // --- Rutas (waypoints terrestres) ---------------------------------------
  rutas: {
    listar: (ejercicioId) => get(ejercicioId ? `/rutas?ejercicioId=${ejercicioId}` : '/rutas'),
    obtener: (id) => get(`/rutas/${id}`),
    crear: (cuerpo) => post('/rutas', cuerpo),
    actualizar: (id, cuerpo) => put(`/rutas/${id}`, cuerpo),
    borrar: (id) => del(`/rutas/${id}`),
  },

  // --- Chat personal (usuario <-> usuario, fuera del ejercicio) ------------
  chat: {
    conversaciones: () => get('/chat/conversaciones'),
    historial: (usuarioId, limit = 50) => get(`/chat/${usuarioId}?limit=${limit}`),
  },
};

export default Api;
