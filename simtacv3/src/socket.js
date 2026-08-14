// Cliente Socket.IO.
//
// Puntos finos que resuelve este módulo (frontend.md, trampas 3, 4 y 6):
//   - Toda acción usa ack: `emitir()` devuelve una promesa que rechaza con el
//     mensaje del backend cuando `ok: false`.
//   - El backend emite `error` ADEMÁS del ack. El listener global solo loguea;
//     el mensaje al usuario lo muestra quien hizo el emit (que sabe qué acción
//     fue) para no duplicar el toast.
//   - Socket.IO reconecta solo, pero las rooms se pierden: hay que volver a
//     emitir `ejercicio:unirse` en cada `connect`.

import Session from './session.js';
import { refrescarToken, API_BASE } from './api.js';

const TIMEOUT_ACK_MS = 15000;

let socket = null;
let ejercicioUnido = null;
let reintentoTrasRefresh = false;
const alReunirse = new Set();

/** El socket crudo, para casos puntuales. Preferir `emitir()` / `on()`. */
export function crudo() {
  return socket;
}

export function conectado() {
  return !!socket?.connected;
}

export function conectar() {
  const token = Session.getToken();
  if (!token) return null;

  if (socket) {
    socket.auth = { token };
    if (!socket.connected) socket.connect();
    return socket;
  }

  socket = io(API_BASE, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  socket.on('connect', async () => {
    console.log('✓ Socket conectado');
    reintentoTrasRefresh = false;
    window.dispatchEvent(new CustomEvent('simtac:socket-conectado'));
    // Las rooms no sobreviven a la reconexión.
    if (ejercicioUnido !== null) {
      try {
        const res = await unirse(ejercicioUnido);
        alReunirse.forEach((cb) => cb(res));
      } catch (e) {
        console.error('No se pudo volver a unirse al ejercicio:', e.message);
      }
    }
  });

  socket.on('disconnect', (motivo) => {
    console.log('✗ Socket desconectado:', motivo);
    window.dispatchEvent(new CustomEvent('simtac:socket-desconectado', { detail: { motivo } }));
  });

  socket.on('connect_error', async (err) => {
    console.error('✗ Error de conexión de socket:', err.message);
    const esAuth = /token/i.test(err.message || '');
    if (esAuth && !reintentoTrasRefresh) {
      reintentoTrasRefresh = true;
      const renovado = await refrescarToken();
      if (renovado) {
        socket.auth = { token: Session.getToken() };
        socket.connect();
        return;
      }
      window.dispatchEvent(new CustomEvent('simtac:sesion-expirada'));
    }
  });

  // Log únicamente: el aviso al usuario sale del ack de cada acción.
  socket.on('error', (payload) => {
    console.warn('[socket:error]', payload);
    window.dispatchEvent(new CustomEvent('simtac:socket-error', { detail: payload }));
  });

  return socket;
}

/** Un refresh de token invalida el handshake: hay que reconectar. */
window.addEventListener('simtac:token-renovado', () => {
  if (!socket) return;
  socket.auth = { token: Session.getToken() };
  if (socket.connected) socket.disconnect();
  socket.connect();
});

export function desconectar() {
  ejercicioUnido = null;
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

/**
 * Emite con ack. Resuelve con la respuesta cuando `ok: true`, rechaza con el
 * mensaje del backend cuando `ok: false`.
 */
export function emitir(evento, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!socket || !socket.connected) {
      reject(new Error('Sin conexión con el servidor'));
      return;
    }
    let resuelto = false;
    const temporizador = setTimeout(() => {
      if (resuelto) return;
      resuelto = true;
      reject(new Error(`El servidor no respondió a "${evento}"`));
    }, TIMEOUT_ACK_MS);

    socket.emit(evento, payload, (respuesta) => {
      if (resuelto) return;
      resuelto = true;
      clearTimeout(temporizador);
      if (!respuesta) {
        reject(new Error(`Respuesta vacía de "${evento}"`));
        return;
      }
      if (respuesta.ok === false) {
        const error = new Error(respuesta.error || `"${evento}" fue rechazado`);
        error.evento = evento;
        error.respuesta = respuesta;
        reject(error);
        return;
      }
      resolve(respuesta);
    });
  });
}

export function on(evento, callback) {
  if (!socket) conectar();
  socket?.on(evento, callback);
  return () => socket?.off(evento, callback);
}

export function off(evento, callback) {
  socket?.off(evento, callback);
}

/**
 * Entra a las rooms del ejercicio. El bando lo resuelve el servidor contra la
 * base: no se manda en el payload.
 */
export async function unirse(ejercicioId) {
  const respuesta = await emitir('ejercicio:unirse', { ejercicio_id: Number(ejercicioId) });
  ejercicioUnido = Number(ejercicioId);
  return respuesta;
}

/** Callbacks a ejecutar cada vez que se rehace el join tras reconectar. */
export function alVolverAUnirse(callback) {
  alReunirse.add(callback);
  return () => alReunirse.delete(callback);
}

export function ejercicioActual() {
  return ejercicioUnido;
}

export function olvidarEjercicio() {
  ejercicioUnido = null;
}

export default {
  conectar, desconectar, emitir, on, off, unirse, crudo, conectado,
  alVolverAUnirse, ejercicioActual, olvidarEjercicio,
};
