// Fase 7 — Comunicaciones: chat de bando, documentos entre unidades y boletines.
//
// Los tres se persisten en el JSON del ejercicio y siguen funcionando con el
// ejercicio PAUSADO (lo que se bloquea al pausar es mover y combatir).
//
// ⚠️ Hay dos chats distintos y no se mezclan en la misma ventana:
//   · chat:enviar / chat:mensaje -> chat de BANDO dentro del ejercicio (JSON).
//   · chat:send   / chat:message -> mensajería personal usuario↔usuario (Postgres).

import Store from './store.js';
import Session from './session.js';
import Socket from './socket.js';
import Api from './api.js';
import { esc, hora, toast, toastError, toastExito, fechaHora } from './ui.js';

// ===========================================================================
// Chat
// ===========================================================================

const Chat = {
  pestania: 'bando',          // 'bando' | 'privado'
  contactoPrivado: null,      // usuarioId de la conversación personal abierta
  privados: new Map(),        // usuarioId -> mensajes[]
  contactos: [],
  noLeidos: 0,

  init() {
    document.querySelectorAll('[data-chat-tab]').forEach((boton) => {
      boton.addEventListener('click', () => this.cambiarPestania(boton.dataset.chatTab));
    });

    const enviar = () => this.enviar();
    document.getElementById('chat-send-btn')?.addEventListener('click', enviar);
    document.getElementById('chat-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        enviar();
      }
    });

    // Selector de bando destino: un administrador no tiene bando propio y DEBE
    // indicar a cuál habla.
    const selectorBando = document.getElementById('chat-bando-destino');
    if (selectorBando) selectorBando.style.display = Session.esAdmin() ? 'block' : 'none';

    Socket.on('chat:mensaje', (mensaje) => {
      Store.agregarMensaje(mensaje);
      if (this.pestania !== 'bando') this.marcarNoLeido();
      this.renderMensajes();
    });

    Socket.on('chat:message', (mensaje) => {
      const miId = Session.getUserId();
      const otro = Number(mensaje.remitente_id) === miId ? Number(mensaje.destinatario_id) : Number(mensaje.remitente_id);
      if (!this.privados.has(otro)) this.privados.set(otro, []);
      this.privados.get(otro).push(mensaje);
      if (this.pestania !== 'privado' || this.contactoPrivado !== otro) this.marcarNoLeido();
      if (this.pestania === 'privado') this.renderMensajes();
    });

    Store.on('estado', () => {
      this.renderMensajes();
      this.renderLaterales();
    });

    this.renderLaterales();
    this.renderMensajes();
  },

  marcarNoLeido() {
    const expandido = document.getElementById('chat-expanded')?.classList.contains('active');
    if (expandido) return;
    this.noLeidos += 1;
    const badge = document.querySelector('.chat-badge');
    if (badge) badge.textContent = this.noLeidos;
  },

  limpiarNoLeidos() {
    this.noLeidos = 0;
    const badge = document.querySelector('.chat-badge');
    if (badge) badge.textContent = '0';
  },

  cambiarPestania(pestania) {
    this.pestania = pestania;
    document.querySelectorAll('[data-chat-tab]').forEach((b) => {
      b.classList.toggle('active', b.dataset.chatTab === pestania);
    });
    const selectorBando = document.getElementById('chat-bando-destino');
    if (selectorBando) {
      selectorBando.style.display = pestania === 'bando' && Session.esAdmin() ? 'block' : 'none';
    }
    this.renderLaterales();
    this.renderMensajes();
  },

  async enviar() {
    const input = document.getElementById('chat-input');
    const contenido = input?.value.trim();
    if (!contenido) return;

    try {
      if (this.pestania === 'bando') {
        const payload = { ejercicio_id: Store.ejercicioId, contenido };
        // destinatario_id es un id de USUARIO; null u omitido = broadcast al bando.
        const destinatario = document.getElementById('chat-destinatario')?.value;
        if (destinatario) payload.destinatario_id = Number(destinatario);
        if (Session.esAdmin()) {
          const bando = document.getElementById('chat-bando-destino')?.value;
          if (!bando) {
            toastError('Elegí a qué bando le hablás');
            return;
          }
          payload.bando = bando;
        }
        await Socket.emitir('chat:enviar', payload);
      } else {
        if (!this.contactoPrivado) {
          toastError('Elegí un destinatario');
          return;
        }
        await Socket.emitir('chat:send', { destinatarioId: this.contactoPrivado, mensaje: contenido });
      }
      input.value = '';
    } catch (e) {
      toastError(e.message);
    }
  },

  renderMensajes() {
    const cont = document.getElementById('chat-mensajes');
    if (!cont) return;
    const miId = Session.getUserId();

    const mensajes = this.pestania === 'bando'
      ? (Store.estado.mensajes || [])
      : (this.privados.get(this.contactoPrivado) || []);

    if (!mensajes.length) {
      cont.innerHTML = `<div class="chat-vacio">${this.pestania === 'bando' ? 'Sin mensajes en el bando' : 'Elegí un contacto para ver la conversación'}</div>`;
      return;
    }

    cont.innerHTML = mensajes.map((m) => {
      const propio = Number(m.remitente_id) === miId;
      const texto = m.contenido ?? m.mensaje ?? '';
      const privado = m.destinatario_id !== null && m.destinatario_id !== undefined;
      return `
        <div class="chat-msg ${propio ? 'propio' : ''}">
          <div class="chat-msg-head">
            <span class="chat-msg-autor">${esc(m.remitente_nombre || (propio ? 'Yo' : `Usuario ${m.remitente_id}`))}</span>
            ${this.pestania === 'bando' && privado ? '<span class="chat-msg-privado">privado</span>' : ''}
            <span class="chat-msg-hora">${hora(m.timestamp || m.fecha)}</span>
          </div>
          <div class="chat-msg-texto">${esc(texto)}</div>
        </div>
      `;
    }).join('');
    cont.scrollTop = cont.scrollHeight;
  },

  /** Panel lateral: jugadores del bando (chat de bando) o contactos (privado). */
  async renderLaterales() {
    const cont = document.getElementById('chat-usuarios');
    if (!cont) return;

    if (this.pestania === 'bando') {
      const jugadores = (Store.estado.jugadores || []).filter((j) => Session.esAdmin() || j.bando === Store.bando);
      cont.innerHTML = `
        <div class="chat-lateral-titulo">MI BANDO</div>
        <select id="chat-destinatario" class="chat-select">
          <option value="">Todo el bando</option>
          ${jugadores.filter((j) => j.id !== Session.getUserId()).map((j) => `<option value="${esc(j.id)}">${esc(j.nombre)}</option>`).join('')}
        </select>
        ${Session.esAdmin() ? `
          <div class="chat-lateral-titulo">HABLAR AL BANDO</div>
          <select id="chat-bando-destino" class="chat-select">
            ${[...new Set((Store.estado.jugadores || []).map((j) => j.bando).filter(Boolean))]
              .map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join('')}
          </select>
        ` : ''}
        <div class="chat-lateral-lista">
          ${jugadores.map((j) => `
            <div class="chat-usuario">
              <span>${esc(j.nombre)}</span>
              <span class="chat-usuario-bando bando-${esc(String(j.bando || '').toLowerCase())}">${esc(j.bando || '')}</span>
            </div>
          `).join('')}
        </div>
      `;
      return;
    }

    // Chat personal: los contactos salen de Postgres, no del ejercicio.
    if (!this.contactos.length) {
      try {
        this.contactos = await Api.chat.conversaciones();
      } catch {
        this.contactos = [];
      }
    }
    cont.innerHTML = `
      <div class="chat-lateral-titulo">CONVERSACIONES</div>
      <div class="chat-lateral-lista">
        ${this.contactos.length
          ? this.contactos.map((c) => `
            <button class="chat-usuario chat-contacto ${this.contactoPrivado === Number(c.id) ? 'activo' : ''}" data-usuario="${esc(c.id)}">
              <span>${esc(c.nombre)}</span>
              <small>${esc(c.ultimo_mensaje || '')}</small>
            </button>`).join('')
          : '<div class="chat-vacio">Sin conversaciones</div>'}
      </div>
    `;
    cont.querySelectorAll('[data-usuario]').forEach((boton) => {
      boton.addEventListener('click', () => this.abrirPrivado(Number(boton.dataset.usuario)));
    });
  },

  async abrirPrivado(usuarioId) {
    this.contactoPrivado = usuarioId;
    if (!this.privados.has(usuarioId)) {
      try {
        this.privados.set(usuarioId, await Api.chat.historial(usuarioId));
      } catch {
        this.privados.set(usuarioId, []);
      }
    }
    this.renderLaterales();
    this.renderMensajes();
  },
};

// ===========================================================================
// Documentos entre unidades
// ===========================================================================

const TIPOS_DOCUMENTO = [
  { valor: 'orden_operaciones', etiqueta: 'Orden de operaciones', campos: ['mision', 'ejecucion', 'apoyo'] },
  { valor: 'parte_situacion', etiqueta: 'Parte de situación', campos: ['situacion', 'propias', 'enemigo'] },
  { valor: 'solicitud_apoyo', etiqueta: 'Solicitud de apoyo', campos: ['tipo_apoyo', 'ubicacion', 'urgencia'] },
  { valor: 'informe', etiqueta: 'Informe libre', campos: ['texto'] },
];

const Documentos = {
  carpeta: 'inbox',
  vista: 'list',
  seleccionado: null,
  busqueda: '',

  init() {
    document.querySelectorAll('.docs-folder-btn').forEach((boton) => {
      boton.addEventListener('click', () => {
        document.querySelectorAll('.docs-folder-btn').forEach((b) => b.classList.remove('active'));
        boton.classList.add('active');
        this.carpeta = boton.dataset.folder;
        this.busqueda = '';
        this.mostrarLista();
      });
    });

    document.getElementById('docs-compose-btn')?.addEventListener('click', () => this.mostrarRedaccion());
    document.getElementById('docs-back-btn')?.addEventListener('click', () => this.mostrarLista());
    document.getElementById('docs-close-compose-btn')?.addEventListener('click', () => this.mostrarLista());
    document.getElementById('docs-send-btn')?.addEventListener('click', () => this.enviar());
    document.getElementById('docs-reply-btn')?.addEventListener('click', () => this.responder());
    document.getElementById('docs-search')?.addEventListener('input', (e) => {
      this.busqueda = e.target.value;
      this.renderLista();
    });
    document.getElementById('compose-tipo')?.addEventListener('change', () => this.renderCamposTipo());

    Socket.on('documento:recibido', (doc) => {
      Store.agregarDocumento(doc);
      toast(`📄 Documento recibido: ${doc.asunto || 'sin asunto'}`, 'aviso', 6000);
      this.renderLista();
    });

    // Legacy: notificación del documento REST (unidad↔unidad, fuera del JSON).
    Socket.on('documento:nuevo', (doc) => {
      toast(`📄 Documento nuevo: ${doc.asunto || 'sin asunto'}`, 'aviso', 6000);
    });

    Store.on('estado', () => this.renderLista());
    this.renderLista();
  },

  /** Documentos del ejercicio separados por carpeta según mis unidades. */
  documentos() {
    const mias = new Set(Store.misUnidades().map((item) => item.id));
    const todos = Store.estado.documentos || [];
    const docs = todos.filter((d) => {
      const destino = Number(d.destinatario_unidad_id ?? d.destinatario_id);
      const origen = Number(d.remitente_unidad_id ?? d.remitente_id);
      if (Session.esAdmin()) return true;
      return this.carpeta === 'inbox' ? mias.has(destino) : mias.has(origen);
    });

    if (!this.busqueda) return docs;
    const q = this.busqueda.toLowerCase();
    return docs.filter((d) =>
      String(d.asunto || '').toLowerCase().includes(q) ||
      String(d.tipo || '').toLowerCase().includes(q) ||
      JSON.stringify(d.contenido || '').toLowerCase().includes(q));
  },

  renderLista() {
    const lista = document.getElementById('docs-list');
    const titulo = document.getElementById('docs-list-title');
    if (!lista) return;
    if (titulo) titulo.textContent = this.carpeta === 'inbox' ? 'Bandeja de Entrada' : 'Bandeja de Salida';

    const docs = this.documentos();
    const contarInbox = (Store.estado.documentos || []).length;
    const inboxCount = document.getElementById('inbox-count');
    const outboxCount = document.getElementById('outbox-count');
    if (inboxCount) inboxCount.textContent = this.carpeta === 'inbox' ? docs.length : contarInbox;
    if (outboxCount) outboxCount.textContent = this.carpeta === 'outbox' ? docs.length : '';

    lista.innerHTML = docs.length
      ? docs.map((d, indice) => `
          <button class="docs-item" data-indice="${indice}">
            <div class="docs-item-header">
              <span class="docs-item-sender">${esc(Store.nombre('unidad', d.remitente_unidad_id ?? d.remitente_id))}</span>
              <span class="docs-item-date">${fechaHora(d.timestamp || d.fecha)}</span>
            </div>
            <div class="docs-item-subject">${esc(d.asunto || '(sin asunto)')}</div>
            <div class="docs-item-preview">${esc(d.tipo || 'documento')} → ${esc(Store.nombre('unidad', d.destinatario_unidad_id ?? d.destinatario_id))}</div>
          </button>`).join('')
      : '<div class="docs-vacio">Sin documentos</div>';

    lista.querySelectorAll('[data-indice]').forEach((boton) => {
      boton.addEventListener('click', () => this.mostrarDetalle(docs[Number(boton.dataset.indice)]));
    });
  },

  cambiarVista(vista) {
    this.vista = vista;
    document.querySelectorAll('.docs-view').forEach((v) => v.classList.remove('active'));
    const id = vista === 'list' ? 'docs-list-view' : vista === 'detail' ? 'docs-detail-view' : 'docs-compose-view';
    document.getElementById(id)?.classList.add('active');
  },

  mostrarLista() {
    this.seleccionado = null;
    this.cambiarVista('list');
    this.renderLista();
  },

  mostrarDetalle(doc) {
    if (!doc) return;
    this.seleccionado = doc;
    this.cambiarVista('detail');
    const set = (id, valor) => {
      const el = document.getElementById(id);
      if (el) el.textContent = valor;
    };
    set('detail-from', Store.nombre('unidad', doc.remitente_unidad_id ?? doc.remitente_id));
    set('detail-to', Store.nombre('unidad', doc.destinatario_unidad_id ?? doc.destinatario_id));
    set('detail-subject', doc.asunto || '(sin asunto)');
    set('detail-date', fechaHora(doc.timestamp || doc.fecha));

    // `contenido` es JSON libre: se renderiza una plantilla por tipo.
    const cuerpo = document.getElementById('detail-body');
    if (cuerpo) cuerpo.innerHTML = this.renderContenido(doc);
  },

  renderContenido(doc) {
    const tipo = TIPOS_DOCUMENTO.find((t) => t.valor === doc.tipo);
    const contenido = doc.contenido;
    if (contenido === null || contenido === undefined) return '<em>Sin contenido</em>';
    if (typeof contenido === 'string') return `<p>${esc(contenido)}</p>`;

    const etiquetas = {
      mision: 'Misión', ejecucion: 'Ejecución', apoyo: 'Apoyo',
      situacion: 'Situación', propias: 'Fuerzas propias', enemigo: 'Enemigo',
      tipo_apoyo: 'Tipo de apoyo', ubicacion: 'Ubicación', urgencia: 'Urgencia', texto: 'Texto',
    };
    const claves = tipo ? tipo.campos.filter((c) => contenido[c] !== undefined) : Object.keys(contenido);
    const extra = Object.keys(contenido).filter((c) => !claves.includes(c));

    return `
      <div class="doc-tipo">${esc(tipo?.etiqueta || doc.tipo || 'documento')}</div>
      ${[...claves, ...extra].map((c) => `
        <div class="doc-campo">
          <div class="doc-campo-label">${esc(etiquetas[c] || c)}</div>
          <div class="doc-campo-valor">${esc(typeof contenido[c] === 'object' ? JSON.stringify(contenido[c]) : contenido[c])}</div>
        </div>`).join('')}
    `;
  },

  mostrarRedaccion(previo = null) {
    this.cambiarVista('compose');
    // Remitente: solo unidades que controlo. Destinatario: unidades del bando.
    const remitentes = Store.misUnidades();
    const destinatarios = Store.unidadesDelBando();

    const selRemitente = document.getElementById('compose-remitente');
    const selDestinatario = document.getElementById('compose-destinatario');
    const selTipo = document.getElementById('compose-tipo');

    if (selRemitente) {
      selRemitente.innerHTML = remitentes.length
        ? remitentes.map((item) => `<option value="${item.id}">${esc(item.entidad.nombre)}</option>`).join('')
        : '<option value="">No controlás ninguna unidad</option>';
    }
    if (selDestinatario) {
      selDestinatario.innerHTML = destinatarios
        .map((item) => `<option value="${item.id}">${esc(item.entidad.nombre)} (${esc(item.entidad.bando || '')})</option>`)
        .join('');
      if (previo) selDestinatario.value = String(previo.remitente_unidad_id ?? previo.remitente_id ?? '');
    }
    if (selTipo) {
      selTipo.innerHTML = TIPOS_DOCUMENTO.map((t) => `<option value="${t.valor}">${esc(t.etiqueta)}</option>`).join('');
    }
    const asunto = document.getElementById('compose-asunto');
    if (asunto) asunto.value = previo ? `RE: ${previo.asunto || ''}` : '';
    this.renderCamposTipo();
  },

  renderCamposTipo() {
    const cont = document.getElementById('compose-campos');
    if (!cont) return;
    const valor = document.getElementById('compose-tipo')?.value;
    const tipo = TIPOS_DOCUMENTO.find((t) => t.valor === valor) || TIPOS_DOCUMENTO[3];
    cont.innerHTML = tipo.campos.map((campo) => `
      <div class="form-group">
        <label for="doc-campo-${campo}">${esc(campo.replace(/_/g, ' '))}</label>
        <textarea id="doc-campo-${campo}" data-campo="${campo}" class="compose-textarea compose-textarea-corta"></textarea>
      </div>
    `).join('');
  },

  async enviar() {
    const remitente = document.getElementById('compose-remitente')?.value;
    const destinatario = document.getElementById('compose-destinatario')?.value;
    const asunto = document.getElementById('compose-asunto')?.value.trim();
    const tipo = document.getElementById('compose-tipo')?.value;

    if (!remitente || !destinatario || !asunto) {
      toastError('Remitente, destinatario y asunto son obligatorios');
      return;
    }

    const contenido = {};
    document.querySelectorAll('#compose-campos [data-campo]').forEach((campo) => {
      if (campo.value.trim()) contenido[campo.dataset.campo] = campo.value.trim();
    });

    try {
      await Socket.emitir('documento:enviar', {
        ejercicio_id: Store.ejercicioId,
        remitente_unidad_id: Number(remitente),
        destinatario_unidad_id: Number(destinatario),
        asunto,
        tipo,
        contenido,
      });
      toastExito('Documento enviado');
      this.mostrarLista();
    } catch (e) {
      toastError(e.message);
    }
  },

  responder() {
    if (this.seleccionado) this.mostrarRedaccion(this.seleccionado);
  },
};

// ===========================================================================
// Boletines (texto a voz)
//
// El backend solo emite el texto: la síntesis de voz es responsabilidad del
// cliente. Llegan solo a los jugadores; el admin que lo emitió no lo recibe.
// ===========================================================================

// Nombres de voces conocidas por sonar naturales (no robotizadas) en los
// motores TTS más comunes (Edge/Windows "Online (Natural)", Chrome/Google).
// Se ordenan de mejor a peor; la primera que exista en el sistema se usa.
const VOCES_FORMALES_PREFERIDAS = [
  /Microsoft.*Sabina/i,
  /Microsoft.*Alvaro.*Online.*Natural/i,
  /Microsoft.*Elvira.*Online.*Natural/i,
  /Microsoft.*Dalia.*Online.*Natural/i,
  /Online.*Natural.*Spanish/i,
  /Google.*español/i,
  /es-ES/i,
  /es-419|es-MX|es-US/i,
];

let vocesCache = null;

function obtenerVoces() {
  if (!window.speechSynthesis) return [];
  const voces = window.speechSynthesis.getVoices();
  if (voces.length) vocesCache = voces;
  return vocesCache || voces;
}

/** Elige la voz en español disponible que suene más formal/natural (menos robotizada). */
function elegirVozFormal() {
  const voces = obtenerVoces();
  for (const patron of VOCES_FORMALES_PREFERIDAS) {
    const voz = voces.find((v) => patron.test(v.name) || patron.test(v.lang));
    if (voz) return voz;
  }
  return voces.find((v) => /^es/i.test(v.lang)) || null;
}

/** Construye una locución con timbre pausado y formal, evitando el tono robótico por defecto. */
function crearLocucionFormal(texto) {
  const locucion = new SpeechSynthesisUtterance(texto || '');
  const voz = elegirVozFormal();
  if (voz) locucion.voice = voz;
  locucion.lang = voz?.lang || 'es-ES';
  locucion.rate = 0.95;
  locucion.pitch = 0.92;
  return locucion;
}

const Boletines = {
  cola: [],
  reproduciendo: false,
  silenciado: false,
  overlay: null,
  reproduciendoManual: false,

  init() {
    this.crearOverlay();
    if (window.speechSynthesis) {
      obtenerVoces();
      window.speechSynthesis.onvoiceschanged = () => obtenerVoces();
    }
    Socket.on('boletin:nuevo', (boletin) => {
      Store.agregarBoletin(boletin);
      this.encolar(boletin);
    });
    Store.on('boletin', () => this.renderLista());
  },

  /** Panel de consulta: lista de todos los boletines recibidos, con reproducción manual. */
  renderLista() {
    const cont = document.getElementById('boletines-lista');
    if (!cont) return;
    const boletines = (Store.estado.boletines || []).slice().reverse();

    cont.innerHTML = boletines.length
      ? boletines.map((b, indiceInvertido) => `
          <div class="boletin-item">
            <div class="boletin-item-cabecera">
              <span class="boletin-item-fecha">${fechaHora(b.timestamp)}</span>
              <button class="boletin-item-reproducir" data-indice="${boletines.length - 1 - indiceInvertido}" title="Reproducir">▶ Reproducir</button>
            </div>
            <div class="boletin-item-texto">${esc(b.texto || '')}</div>
          </div>
        `).join('')
      : '<div class="docs-vacio">Sin boletines</div>';

    cont.querySelectorAll('[data-indice]').forEach((boton) => {
      boton.addEventListener('click', () => {
        const boletin = (Store.estado.boletines || [])[Number(boton.dataset.indice)];
        if (!boletin) return;
        if (this.reproduciendoManual && boton.dataset.reproduciendo === '1') {
          this.detenerManual();
        } else {
          this.reproducirManual(boletin, boton);
        }
      });
    });
  },

  /** Reproduce un boletín puntual a pedido del jugador, sin tocar la cola de avisos entrantes. */
  reproducirManual(boletin, boton) {
    if (!window.speechSynthesis) return;
    this.detenerManual();
    this.crearOverlay();
    this.overlay.querySelector('#bo-texto').textContent = boletin.texto || '';
    this.overlay.querySelector('#bo-pie').textContent = `${hora(boletin.timestamp)} · reproducción manual`;
    this.overlay.classList.add('visible', 'bo-manual');

    const locucion = crearLocucionFormal(boletin.texto || '');
    locucion.onstart = () => { this.overlay.classList.add('hablando'); this.reproducirVideo(); };
    locucion.onend = () => this.detenerManual();
    locucion.onerror = () => this.detenerManual();
    this.botonManualActivo = boton;
    if (boton) {
      boton.dataset.reproduciendo = '1';
      boton.textContent = '⏹ Detener';
    }
    this.reproduciendoManual = true;
    window.speechSynthesis.speak(locucion);
  },

  /** Detiene la reproducción manual en curso, si hay alguna. */
  detenerManual() {
    window.speechSynthesis?.cancel();
    this.reproduciendoManual = false;
    this.detenerVideo();
    if (this.overlay?.classList.contains('bo-manual')) {
      this.overlay.classList.remove('visible', 'bo-manual', 'hablando');
    }
    if (this.botonManualActivo) {
      this.botonManualActivo.dataset.reproduciendo = '0';
      this.botonManualActivo.textContent = '▶ Reproducir';
      this.botonManualActivo = null;
    }
  },

  crearOverlay() {
    if (this.overlay && document.body.contains(this.overlay)) return this.overlay;
    this.overlay = document.createElement('div');
    this.overlay.id = 'boletin-overlay';
    this.overlay.className = 'boletin-overlay';
    this.overlay.innerHTML = `
      <div class="bo-caja">
        <div class="bo-header">
          <span>📢 BOLETÍN DE LA DIRECCIÓN</span>
          <div class="bo-acciones">
            <button class="bo-btn" id="bo-detener" title="Detener audio">⏹</button>
            <button class="bo-btn" id="bo-silenciar" title="Silenciar la voz">🔊</button>
            <button class="bo-btn" id="bo-cerrar" title="Cerrar">✕</button>
          </div>
        </div>
        <div class="bo-video">
          <video id="bo-video-el" muted playsinline preload="auto" src="/assets/reportera/boletin.mp4"></video>
          <div class="bo-en-vivo"><span class="bo-en-vivo-dot"></span>EN VIVO</div>
        </div>
        <div class="bo-texto" id="bo-texto"></div>
        <div class="bo-pie" id="bo-pie"></div>
      </div>
    `;
    document.body.appendChild(this.overlay);

    this.overlay.querySelector('#bo-detener').addEventListener('click', () => {
      window.speechSynthesis?.cancel();
      this.overlay.classList.remove('hablando');
      this.detenerVideo();
    });
    this.overlay.querySelector('#bo-silenciar').addEventListener('click', (e) => {
      this.silenciado = !this.silenciado;
      e.currentTarget.textContent = this.silenciado ? '🔇' : '🔊';
      if (this.silenciado) {
        window.speechSynthesis?.cancel();
        this.overlay.classList.remove('hablando');
        this.detenerVideo();
      }
    });
    this.overlay.querySelector('#bo-cerrar').addEventListener('click', () => {
      if (this.overlay.classList.contains('bo-manual')) this.detenerManual();
      else this.siguiente(true);
    });
    return this.overlay;
  },

  /** Arranca el video de la reportera en loop, sincronizado con el inicio del audio. */
  reproducirVideo() {
    const video = this.overlay?.querySelector('#bo-video-el');
    if (!video) return;
    video.loop = true;
    video.currentTime = 0;
    video.play().catch(() => {});
  },

  /** Detiene el video y lo deja en el primer cuadro (pose de reposo), cuando termina el audio. */
  detenerVideo() {
    const video = this.overlay?.querySelector('#bo-video-el');
    if (!video) return;
    video.loop = false;
    video.pause();
    video.currentTime = 0;
  },

  encolar(boletin) {
    this.cola.push(boletin);
    if (!this.reproduciendo) this.reproducir();
  },

  reproducir() {
    const boletin = this.cola[0];
    if (!boletin) {
      this.reproduciendo = false;
      this.overlay.classList.remove('visible');
      return;
    }
    this.reproduciendo = true;
    this.overlay.classList.add('visible');
    this.overlay.querySelector('#bo-texto').textContent = boletin.texto || '';
    this.overlay.querySelector('#bo-pie').textContent =
      `${hora(boletin.timestamp)}${this.cola.length > 1 ? ` · ${this.cola.length - 1} en cola` : ''}`;

    if (this.silenciado || !window.speechSynthesis) {
      // Sin voz el boletín queda visible un rato y sigue la cola.
      setTimeout(() => this.siguiente(), 6000);
      return;
    }

    const locucion = crearLocucionFormal(boletin.texto || '');
    locucion.onstart = () => { this.overlay.classList.add('hablando'); this.reproducirVideo(); };
    locucion.onend = () => { this.overlay.classList.remove('hablando'); this.detenerVideo(); this.siguiente(); };
    // Algunos WebViews exigen interacción previa del usuario para permitir audio.
    locucion.onerror = () => { this.overlay.classList.remove('hablando'); this.detenerVideo(); setTimeout(() => this.siguiente(), 4000); };
    window.speechSynthesis.speak(locucion);
  },

  siguiente(forzado = false) {
    if (forzado) window.speechSynthesis?.cancel();
    this.overlay.classList.remove('hablando');
    this.detenerVideo();
    this.cola.shift();
    if (this.cola.length) {
      this.reproducir();
    } else {
      this.reproduciendo = false;
      this.overlay.classList.remove('visible');
    }
  },
};

export function init() {
  Chat.init();
  Documentos.init();
  Boletines.init();

  // Al abrir el chat se limpia el contador de no leídos.
  document.getElementById('chat-minimized')?.addEventListener('click', () => Chat.limpiarNoLeidos());
}

export { Chat, Documentos, Boletines, TIPOS_DOCUMENTO };
export default { init, Chat, Documentos, Boletines };
