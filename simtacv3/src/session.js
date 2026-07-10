// Gestión de sesión y token JWT
const Session = {
  TOKEN_KEY: 'simtac_token',
  USER_KEY: 'simtac_user',

  setToken(token) {
    localStorage.setItem(this.TOKEN_KEY, token);
  },

  getToken() {
    return localStorage.getItem(this.TOKEN_KEY);
  },

  setUser(user) {
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  },

  getUser() {
    const userData = localStorage.getItem(this.USER_KEY);
    return userData ? JSON.parse(userData) : null;
  },

  isAuthenticated() {
    return !!this.getToken();
  },

  clear() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
  },

  getAuthHeader() {
    const token = this.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  },
};

export default Session;
