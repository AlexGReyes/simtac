// Fase 1 — Selección de ejercicio y pantalla de espera.
//
// Un jugador solo ve los ejercicios donde está asignado; un administrador ve
// todos los activos y para él `bando` viene null (actúa sobre los dos).

import Api, { limpiar } from './api.js';
import Session from './session.js';
import Socket from './socket.js';
import Store from './store.js';
import { esc, toastError, toastExito, confirmar } from './ui.js';

let contenedor = null;
let alEntrar = null;
let ejercicios = [];
/** Solo admin: `/ejercicios` trae también los inactivos, `disponibles` no. */
let verTodos = false;

function pantalla() {
  if (contenedor && document.body.contains(contenedor)) return contenedor;
  contenedor = document.createElement('div');
  contenedor.id = 'ejercicio-screen';
  contenedor.className = 'ejercicio-screen';
  document.body.appendChild(contenedor);
  return contenedor;
}

function tarjeta(ejercicio) {
  const esAdmin = Session.esAdmin();
  // Para un administrador `bando` viene null en todos: no tiene bando propio.
  const bando = ejercicio.bando
    ? `<span class="ej-bando bando-${esc(String(ejercicio.bando).toLowerCase())}">${esc(ejercicio.bando)}</span>`
    : '<span class="ej-bando bando-admin">DIRECCIÓN</span>';
  // velocidad_ejercicio llega como string ("1.00"): es numeric en Postgres.
  const velocidad = Number(ejercicio.velocidad_ejercicio ?? 1);
  return `
    <div class="ej-card ${ejercicio.activo ? '' : 'inactiva'}" data-id="${esc(ejercicio.id)}">
      <button class="ej-card-main" data-elegir="${esc(ejercicio.id)}">
        <div class="ej-card-head">
          <span class="ej-nombre">${esc(ejercicio.nombre)}</span>
          ${bando}
        </div>
        <div class="ej-card-meta">
          <span>Sala: ${esc(ejercicio.sala || '--')}</span>
          <span>Velocidad: ×${Math.round(velocidad)}</span>
          <span class="ej-estado ${ejercicio.activo ? 'activo' : 'inactivo'}">
            ${ejercicio.activo ? 'Activo' : 'Inactivo'}
          </span>
        </div>
      </button>
      ${esAdmin ? `
        <div class="ej-card-admin">
          <button class="ej-mini ej-mini-preparar" data-preparar="${esc(ejercicio.id)}"
                  title="Entrar al ejercicio SIN iniciarlo, para preparar unidades">⚙ Preparar</button>
          <button class="ej-mini" data-editar="${esc(ejercicio.id)}" title="Modificar nombre, sala y velocidad">✎</button>
          <button class="ej-mini ej-mini-alerta" data-borrar="${esc(ejercicio.id)}" title="Eliminar el ejercicio">🗑</button>
        </div>
      ` : ''}
    </div>
  `;
}

const EjerciciosUI = {
  init({ alEntrar: callback } = {}) {
    alEntrar = callback;
  },

  /** Lista los ejercicios disponibles y espera la elección del usuario. */
  async mostrar() {
    const usuario = Session.getUser();
    const esAdmin = Session.esAdmin();
    const el = pantalla();
    el.classList.add('visible');
    el.innerHTML = `
      <div class="ej-panel">
        <div class="ej-header">
          <h1>SELECCIÓN DE EJERCICIO</h1>
          <p>${esc(usuario?.nombre || '')} · ${esc(usuario?.rol || '')}</p>
        </div>
        ${esAdmin ? `
          <div class="ej-admin-barra">
            <button class="ej-btn ej-btn-chico" id="ej-nuevo">+ Nuevo ejercicio</button>
            <label class="ej-check">
              <input type="checkbox" id="ej-ver-todos" ${verTodos ? 'checked' : ''}>
              Incluir inactivos
            </label>
          </div>
        ` : ''}
        <div class="ej-lista" id="ej-lista"><div class="ej-cargando">Cargando ejercicios...</div></div>
        <div class="ej-footer">
          <button class="ej-btn-secundario" id="ej-refrescar">↻ Refrescar</button>
          <button class="ej-btn-secundario" id="ej-logout">Cerrar sesión</button>
        </div>
      </div>
    `;

    el.querySelector('#ej-refrescar').addEventListener('click', () => this.cargarLista());
    el.querySelector('#ej-logout').addEventListener('click', () => window.logout?.());
    el.querySelector('#ej-nuevo')?.addEventListener('click', () => this.formulario(null));
    el.querySelector('#ej-ver-todos')?.addEventListener('change', (evento) => {
      verTodos = evento.target.checked;
      this.cargarLista();
    });

    await this.cargarLista();
  },

  async cargarLista() {
    const lista = document.getElementById('ej-lista');
    if (!lista) return;
    lista.innerHTML = '<div class="ej-cargando">Cargando ejercicios...</div>';

    try {
      // /ejercicios/disponibles devuelve lo mismo que `ejercicios_asignados` y
      // permite refrescar sin re-loguear. `disponibles` solo trae los activos:
      // para administrar (y ver los cerrados) hace falta /ejercicios.
      ejercicios = verTodos && Session.esAdmin()
        ? await Api.ejercicios.listar()
        : await Api.ejercicios.disponibles();
    } catch (e) {
      // Backend viejo o sin la ruta: caemos a lo que vino en el login.
      ejercicios = Session.getUser()?.ejercicios_asignados || [];
      if (!ejercicios.length) {
        lista.innerHTML = `<div class="ej-vacio">No se pudo obtener la lista de ejercicios.<br><small>${esc(e.message)}</small></div>`;
        return;
      }
    }

    if (!ejercicios.length) {
      lista.innerHTML = Session.esAdmin()
        ? '<div class="ej-vacio">No hay ejercicios cargados.<br><small>Creá uno con «+ Nuevo ejercicio».</small></div>'
        : '<div class="ej-vacio">No tenés ejercicios asignados.<br><small>Pedile al administrador que te agregue como participante.</small></div>';
      return;
    }

    lista.innerHTML = ejercicios.map(tarjeta).join('');
    lista.querySelectorAll('[data-elegir]').forEach((boton) => {
      boton.addEventListener('click', () => this.elegir(boton.dataset.elegir));
    });
    lista.querySelectorAll('[data-preparar]').forEach((boton) => {
      boton.addEventListener('click', () => this.elegir(boton.dataset.preparar));
    });
    lista.querySelectorAll('[data-editar]').forEach((boton) => {
      boton.addEventListener('click', () => {
        this.formulario(ejercicios.find((e) => String(e.id) === boton.dataset.editar));
      });
    });
    lista.querySelectorAll('[data-borrar]').forEach((boton) => {
      boton.addEventListener('click', () => {
        this.borrar(ejercicios.find((e) => String(e.id) === boton.dataset.borrar));
      });
    });
  },

  /**
   * Alta y modificación de ejercicios. Solo administrador: la API responde 403
   * a cualquier otro rol, pero igual no se ofrece el botón.
   */
  formulario(ejercicio) {
    if (!Session.esAdmin()) return;
    const esEdicion = !!ejercicio;
    const modal = document.createElement('div');
    modal.className = 'ej-modal';
    modal.innerHTML = `
      <div class="ej-modal-caja">
        <div class="ej-modal-header">
          <span>${esEdicion ? `Modificar «${esc(ejercicio.nombre)}»` : 'Nuevo ejercicio'}</span>
          <button class="ej-modal-cerrar" type="button">✕</button>
        </div>
        <form class="ej-modal-form">
          <label class="ej-campo">
            <span>Nombre *</span>
            <input name="nombre" required value="${esc(ejercicio?.nombre || '')}" placeholder="Ej: Operación Centinela">
          </label>
          <label class="ej-campo">
            <span>Sala</span>
            <input name="sala" value="${esc(ejercicio?.sala || '')}" placeholder="Ej: SALA 1">
          </label>
          <label class="ej-campo">
            <span>Velocidad del ejercicio (multiplicador de la hora táctica, entero)</span>
            <input name="velocidad_ejercicio" type="number" step="1" min="1"
                   value="${Math.round(Number(ejercicio?.velocidad_ejercicio ?? 1))}">
          </label>
          <label class="ej-check">
            <input type="checkbox" name="activo" ${ejercicio?.activo === false ? '' : 'checked'}>
            Ejercicio activo
          </label>
          <p class="ej-modal-nota">
            Desactivarlo lo «cierra» sin borrar nada: deja de aparecer en la lista de
            los jugadores. Los participantes y sus bandos se administran desde el
            panel de administración (⚙️).
          </p>
          <div class="ej-modal-acciones">
            <button type="submit" class="ej-btn ej-btn-chico">${esEdicion ? 'Guardar cambios' : 'Crear ejercicio'}</button>
            <button type="button" class="ej-btn-secundario ej-cancelar">Cancelar</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);

    const cerrar = () => modal.remove();
    modal.querySelector('.ej-modal-cerrar').addEventListener('click', cerrar);
    modal.querySelector('.ej-cancelar').addEventListener('click', cerrar);

    modal.querySelector('form').addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const campos = evento.target.elements;
      const boton = evento.target.querySelector('button[type="submit"]');

      const velocidadCruda = campos.velocidad_ejercicio.value;
      const velocidad = velocidadCruda === '' ? null : Number(velocidadCruda);
      if (velocidad !== null && (!Number.isInteger(velocidad) || velocidad < 1)) {
        toastError('La velocidad del ejercicio tiene que ser un número entero, 1 o mayor');
        return;
      }

      // `activo` es booleano y va siempre: `limpiar()` descarta '' y null, no false.
      const cuerpo = {
        ...limpiar({
          nombre: campos.nombre.value.trim(),
          sala: campos.sala.value.trim(),
          velocidad_ejercicio: velocidad,
        }),
        activo: campos.activo.checked,
      };

      boton.disabled = true;
      try {
        if (esEdicion) await Api.ejercicios.actualizar(ejercicio.id, cuerpo);
        else await Api.ejercicios.crear(cuerpo);
        toastExito(esEdicion ? 'Ejercicio actualizado' : 'Ejercicio creado');
        cerrar();
        // Un ejercicio nuevo nace inactivo o activo según el form: si no está
        // entre los "disponibles" hay que mirar la lista completa para verlo.
        if (!esEdicion && !cuerpo.activo) verTodos = true;
        await this.mostrar();
      } catch (e) {
        toastError(e.message);
        boton.disabled = false;
      }
    });
  },

  /** Los borrados cascadean y la API no devuelve 409: se avisa el alcance. */
  async borrar(ejercicio) {
    if (!ejercicio || !Session.esAdmin()) return;
    const ok = confirmar(
      `¿Eliminar el ejercicio «${ejercicio.nombre}»?`,
      'Se borran también sus participantes, y los vehículos y rutas asociados. '
      + 'El archivo JSON de estado del ejercicio queda en el servidor.\n\n'
      + 'Si solo querés cerrarlo, desmarcá "Ejercicio activo" en vez de borrarlo.',
    );
    if (!ok) return;

    try {
      await Api.ejercicios.borrar(ejercicio.id);
      toastExito(`Ejercicio «${ejercicio.nombre}» eliminado`);
      await this.cargarLista();
    } catch (e) {
      toastError(e.message);
    }
  },

  /**
   * Se une al ejercicio.
   *
   * Si ya está iniciado, entra al mapa. Si no:
   *   · jugador → pantalla de espera, hasta que el admin lo inicie.
   *   · administrador → entra igual, en **modo preparación**. Necesita el mapa
   *     y el panel de dirección para dar de alta unidades ANTES de arrancar;
   *     dejarlo en la espera lo obligaba a iniciar el ejercicio para poder
   *     prepararlo. El botón de iniciar vive en el panel de control.
   */
  async elegir(ejercicioId) {
    const id = Number(ejercicioId);
    const elegido = ejercicios.find((e) => Number(e.id) === id);
    try {
      const res = await Socket.unirse(id);
      const iniciado = !!res.iniciado;
      Session.setEjercicioId(id);
      Store.setEjercicio(id, { bando: res.bando ?? null, iniciado, datos: elegido });

      if (!iniciado && !Session.esAdmin()) {
        // No es un error: en cuanto el admin inicie llega estado_inicial solo.
        this.mostrarEspera(elegido, res.mensaje);
        return;
      }

      this.ocultar();
      alEntrar?.({
        ejercicioId: id,
        bando: res.bando ?? null,
        ejercicio: elegido,
        preparacion: !iniciado,
      });
    } catch (e) {
      toastError(e.message);
    }
  },

  /**
   * Pantalla de espera mientras el administrador no inicia el ejercicio.
   * Solo la ven los jugadores: el administrador entra en modo preparación y
   * arranca desde el panel de control (Dirección → Control → ▶ INICIAR).
   */
  mostrarEspera(ejercicio, mensaje) {
    const el = pantalla();
    el.classList.add('visible');
    el.innerHTML = `
      <div class="ej-panel ej-espera">
        <div class="ej-header">
          <h1>${esc(ejercicio?.nombre || 'EJERCICIO')}</h1>
          <p>${esc(mensaje || 'El ejercicio todavía no fue iniciado')}</p>
        </div>
        <div class="ej-espera-anim"><span></span><span></span><span></span></div>
        <p class="ej-espera-texto">
          Ya estás en la sala. En cuanto el administrador inicie el ejercicio, el mapa se carga solo.
        </p>
        <div class="ej-footer">
          <button class="ej-btn-secundario" id="ej-volver">← Elegir otro ejercicio</button>
        </div>
      </div>
    `;

    el.querySelector('#ej-volver').addEventListener('click', () => {
      Socket.olvidarEjercicio();
      this.mostrar();
    });
  },

  ocultar() {
    contenedor?.classList.remove('visible');
  },

  visible() {
    return !!contenedor?.classList.contains('visible');
  },
};

export default EjerciciosUI;
