// Gestión de sesión: access token (8 h), refresh token (7 días, ROTA en cada uso)
// y usuario. Los tokens se persisten del lado Rust (archivo en el directorio de
// configuración de la app), no en localStorage — ver frontend.md, fase 0.
//
// Los getters son sincrónicos: `init()` carga una vez desde el backend nativo a
// una copia en memoria y las escrituras persisten en segundo plano.

const CLAVE_LOCAL = 'simtac_sesion';

function invocar(cmd, args) {
  const core = window.__TAURI__?.core;
  if (!core?.invoke) return Promise.reject(new Error('Tauri no disponible'));
  return core.invoke(cmd, args);
}

let memoria = { token: null, refreshToken: null, usuario: null, ejercicioId: null };
let cargada = false;

function persistir() {
  const datos = JSON.stringify(memoria);
  invocar('guardar_sesion', { datos }).catch(() => {
    // Fuera de Tauri (o sin permiso) degradamos a localStorage para no perder
    // la sesión en desarrollo desde el navegador.
    try {
      localStorage.setItem(CLAVE_LOCAL, datos);
    } catch { /* almacenamiento no disponible */ }
  });
}

const Session = {
  /** Carga la sesión persistida. Llamar una vez al arrancar la app. */
  async init() {
    if (cargada) return memoria;
    let crudo = null;
    try {
      crudo = await invocar('leer_sesion');
    } catch {
      try {
        crudo = localStorage.getItem(CLAVE_LOCAL);
      } catch { /* sin almacenamiento */ }
    }
    if (crudo) {
      try {
        const datos = JSON.parse(crudo);
        memoria = {
          token: datos.token ?? null,
          refreshToken: datos.refreshToken ?? null,
          usuario: datos.usuario ?? null,
          ejercicioId: datos.ejercicioId ?? null,
        };
      } catch {
        memoria = { token: null, refreshToken: null, usuario: null, ejercicioId: null };
      }
    }
    cargada = true;
    return memoria;
  },

  /** Guarda la respuesta completa de /auth/login o /auth/refresh. */
  setSesion({ token, refreshToken, usuario }) {
    if (token !== undefined) memoria.token = token;
    if (refreshToken !== undefined) memoria.refreshToken = refreshToken;
    if (usuario !== undefined) memoria.usuario = usuario;
    persistir();
  },

  setToken(token) {
    memoria.token = token;
    persistir();
  },

  getToken() {
    return memoria.token;
  },

  /** El refresh token rota: el anterior deja de servir en cuanto se usa. */
  setRefreshToken(refreshToken) {
    memoria.refreshToken = refreshToken;
    persistir();
  },

  getRefreshToken() {
    return memoria.refreshToken;
  },

  setUser(usuario) {
    memoria.usuario = usuario;
    persistir();
  },

  getUser() {
    return memoria.usuario;
  },

  /** Rol del usuario: "administrador" | "jugador". */
  getRol() {
    return memoria.usuario?.rol ?? null;
  },

  esAdmin() {
    return memoria.usuario?.rol === 'administrador';
  },

  /** Id del usuario normalizado a Number (en REST viaja como string). */
  getUserId() {
    const id = memoria.usuario?.id;
    return id === null || id === undefined ? null : Number(id);
  },

  /** Último ejercicio elegido, para reofrecerlo al reabrir la app. */
  setEjercicioId(id) {
    memoria.ejercicioId = id === null || id === undefined ? null : Number(id);
    persistir();
  },

  getEjercicioId() {
    return memoria.ejercicioId;
  },

  isAuthenticated() {
    return !!memoria.token;
  },

  /** Devuelve la promesa del borrado nativo: quien necesite esperar a que
   * termine antes de seguir (p. ej. cerrar la ventana) puede awaitearla. */
  clear() {
    memoria = { token: null, refreshToken: null, usuario: null, ejercicioId: null };
    const promesa = invocar('borrar_sesion').catch(() => {
      try {
        localStorage.removeItem(CLAVE_LOCAL);
      } catch { /* sin almacenamiento */ }
    });
    try {
      localStorage.removeItem(CLAVE_LOCAL);
    } catch { /* sin almacenamiento */ }
    return promesa;
  },

  getAuthHeader() {
    return memoria.token ? { Authorization: `Bearer ${memoria.token}` } : {};
  },
};

export default Session;
