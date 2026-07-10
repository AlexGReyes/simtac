// Módulo de autenticación - Llamadas a la API
import Session from './session.js';

const API_BASE = 'http://node.localhost';

const Auth = {
  async register(usuario, password, nombre, grado = null) {
    try {
      const payload = { usuario, password, nombre };
      if (grado) payload.grado = grado;

      const response = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error en registro');
      }

      return data;
    } catch (error) {
      throw error;
    }
  },

  async login(usuario, password) {
    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Credenciales inválidas');
      }

      // Guardar token y usuario
      Session.setToken(data.token);
      Session.setUser(data.usuario);

      return data;
    } catch (error) {
      throw error;
    }
  },

  async getMe() {
    try {
      const token = Session.getToken();
      if (!token) throw new Error('No hay sesión activa');

      const response = await fetch(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al validar sesión');
      }

      return data;
    } catch (error) {
      throw error;
    }
  },

  async getUnidadesMias() {
    try {
      const token = Session.getToken();
      if (!token) throw new Error('No hay sesión activa');

      const response = await fetch(`${API_BASE}/unidades/mias`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al obtener unidades');
      }

      return data;
    } catch (error) {
      throw error;
    }
  },

  async getUsuarios() {
    try {
      const token = Session.getToken();
      if (!token) throw new Error('No hay sesión activa');

      const response = await fetch(`${API_BASE}/usuarios`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al obtener usuarios');
      }

      return data;
    } catch (error) {
      throw error;
    }
  },

  logout() {
    Session.clear();
  },
};

export default Auth;
