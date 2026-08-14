// Autenticación. Capa fina sobre el cliente HTTP: el manejo de tokens, el
// refresh y los errores viven en api.js / session.js.
import Api from './api.js';
import Session from './session.js';

const Auth = {
  register(usuario, password, nombre, grado = null) {
    return Api.auth.register(usuario, password, nombre, grado);
  },

  /** Guarda token + refreshToken + usuario (incluye ejercicios_asignados). */
  login(usuario, password) {
    return Api.auth.login(usuario, password);
  },

  getMe() {
    return Api.auth.me();
  },

  /**
   * `ejercicios_asignados` NO viaja en el JWT: se relee de la base en cada
   * login/refresh porque la asignación puede cambiar durante las 8 h del token.
   */
  ejerciciosDisponibles() {
    return Api.ejercicios.disponibles();
  },

  getUnidadesMias() {
    return Api.unidades.mias();
  },

  getUsuarios() {
    return Api.usuarios.listar();
  },

  logout() {
    Session.clear();
  },
};

export default Auth;
