// Sección "Conexiones" del modal de administración: a qué backend y a qué
// GeoServer apunta esta instalación. Antes vivía en el panel 🗺 del mapa; el
// panel se quedó con lo cartográfico (satélite, capas WMS).
//
// Solo escribe a través de `Config` (misma cadena de prioridades y misma
// validación `urlSegura()`), así que el `config.json` editable del directorio
// de la app sigue siendo el que manda.
import Config from './config.js';
import Api from './api.js';
import Geoserver from './geoserver.js';
import Mapa from './mapa.js';

/**
 * Avisa al panel 🗺 que la cartografía cambió de servidor, para que vuelva a
 * verificar el satélite y el grupo base sin que este módulo lo conozca.
 */
function avisarCambioGeoserver() {
  window.dispatchEvent(new CustomEvent('simtac:geoserver-cambiado'));
}

const Conexiones = {
  listenersListos: false,

  el(id) {
    return document.getElementById(id);
  },

  pintarEstado(texto, clase = '') {
    const estado = this.el('conexiones-estado');
    if (!estado) return;
    estado.textContent = texto;
    estado.className = `conexiones-estado ${clase}`;
  },

  // Dice de dónde salió cada URL y qué archivo hay que editar para cambiarla
  // sin pasar por acá: es la pregunta que se hace el operador.
  pintar() {
    const inputGeo = this.el('conexiones-geoserver');
    const inputBack = this.el('conexiones-backend');
    if (inputGeo) inputGeo.value = Config.geoserver();
    if (inputBack) inputBack.value = Config.backend();
    const origenGeo = this.el('conexiones-geoserver-origen');
    const origenBack = this.el('conexiones-backend-origen');
    if (origenGeo) origenGeo.textContent = `Origen: ${Config.origen('geoserver')}`;
    if (origenBack) origenBack.textContent = `Origen: ${Config.origen('backend')}`;
    const archivo = this.el('conexiones-archivo');
    if (archivo) {
      const ruta = Config.rutaConfigUsuario();
      archivo.textContent = ruta
        ? `Archivo editable: ${ruta}`
        : 'Sin archivo de configuración (fuera de Tauri se guarda en el navegador).';
    }
  },

  /** Se llama cada vez que se abre la sección. */
  mostrar() {
    if (!this.listenersListos) {
      this.conectar();
      this.listenersListos = true;
    }
    this.pintar();
  },

  conectar() {
    this.el('conexiones-geoserver-aplicar')?.addEventListener('click', () => {
      try {
        const url = Mapa.reapuntarGeoserver(this.el('conexiones-geoserver').value);
        this.pintar();
        this.pintarEstado(`Cartografía apuntando a ${url}`, 'ok');
        avisarCambioGeoserver();
      } catch (error) {
        this.pintarEstado(error.message, 'error');
      }
    });

    // El backend solo se guarda: reapuntarlo en caliente dejaría el socket vivo
    // contra el servidor anterior y la sesión emitida por otro.
    this.el('conexiones-backend-aplicar')?.addEventListener('click', () => {
      try {
        const url = Config.fijar('backend', this.el('conexiones-backend').value);
        this.pintar();
        this.pintarEstado(`Backend guardado: ${url}. Se aplica al reiniciar la aplicación.`, 'ok');
      } catch (error) {
        this.pintarEstado(error.message, 'error');
      }
    });

    // Prueba los DOS servidores: si el mapa no carga, lo primero que hay que
    // saber es si el problema es solo de cartografía o no se llega a nada.
    this.el('conexiones-probar')?.addEventListener('click', async () => {
      this.pintarEstado('Probando…');
      const [cartografia, back] = await Promise.all([
        Geoserver.probar(),
        Api.probarConexion(Config.backend()),
      ]);
      const ok = String(cartografia.capabilities).startsWith('ok') && back.resultado === 'ok';
      this.pintarEstado(
        `Backend: ${back.detalle} · ` +
          `Cartografía — capabilities: ${cartografia.capabilities} · ` +
          `tesela base: ${cartografia.teselaBase} · satélite: ${cartografia.satelite}`,
        ok ? 'ok' : 'error',
      );
    });

    // Vuelve a lo que diga el `config.json` del despliegue, descartando lo que
    // se haya escrito acá antes.
    this.el('conexiones-restablecer')?.addEventListener('click', async () => {
      await Config.restablecer();
      Mapa.reapuntarGeoserver(Config.geoserver());
      this.pintar();
      this.pintarEstado(
        `Restablecido desde el config del despliegue. El backend (${Config.backend()}) se aplica al reiniciar.`,
        'ok',
      );
      avisarCambioGeoserver();
    });
  },
};

export default Conexiones;
