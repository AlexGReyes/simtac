import Session from './session.js';
import Simbolo from './simbolo.js';
import * as Sidc from './sidc.js';
import Catalogos from './config-catalogos.js';
import Store from './store.js';
import Socket from './socket.js';
// Enlace vivo: `api.js` la reapunta cuando se resuelve la configuración, así
// que no puede copiarse a una constante local.
import { API_BASE } from './api.js';

/**
 * Id del usuario dentro de una fila que lo referencia.
 *
 * ⚠️ Las dos rutas que hacen falta para cruzar unidades con ejercicios no usan
 * la misma clave: `GET /ejercicios/:id/participantes` devuelve `usuario_id`
 * (ver API.md, sección 7) y `GET /unidades/:id/usuarios` devuelve el usuario
 * entero, con `id`. Leer la clave equivocada no falla: da vacío, y la tabla
 * queda sin filas como si el ejercicio no tuviera unidades.
 */
function idUsuario(fila) {
  const id = fila?.id ?? fila?.usuario_id;
  return id === null || id === undefined ? '' : String(id);
}

class AdminManager {
  constructor() {
    this.currentTable = 'usuarios';
    this.editingId = null;
    this.data = {};
    this.listenersListos = false;
    // unidadId -> usuarios que la controlan. Se arma con un pedido por unidad,
    // así que se cachea hasta que cambie una unidad o una asignación.
    this.controladores = null;
  }

  async init() {
    const user = Session.getUser();
    if (!user || user.rol !== 'administrador') {
      console.log('Acceso denegado: no es administrador');
      return false;
    }

    // `init()` corre cada vez que se abre el modal: los listeners se registran
    // una sola vez o cada click terminaría disparando el handler N veces.
    if (!this.listenersListos) {
      this.setupEventListeners();
      this.listenersListos = true;
    }
    await this.loadUsuarios();
    this.showTableDescription('usuarios');
    return true;
  }

  setupEventListeners() {
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const table = e.target.closest('.admin-tab-btn').dataset.table;
        this.switchTable(table);
        this.showTableDescription(table);
      });
    });

    document.getElementById('admin-close-btn')?.addEventListener('click', () => this.close());
    document.getElementById('admin-form-close-btn')?.addEventListener('click', () => this.closeForm());
    document.getElementById('admin-form-cancel-btn')?.addEventListener('click', () => this.closeForm());
    document.getElementById('admin-form-overlay')?.addEventListener('click', () => this.closeForm());
    document.getElementById('admin-form')?.addEventListener('submit', (e) => this.handleFormSubmit(e));

    document.getElementById('usuarios-new-btn')?.addEventListener('click', () => this.openForm('usuarios'));
    document.getElementById('unidades-base-new-btn')?.addEventListener('click', () => this.openForm('unidades-base'));
    document.getElementById('unidades-new-btn')?.addEventListener('click', () => this.openForm('unidades'));
    document.getElementById('ejercicios-new-btn')?.addEventListener('click', () => this.openForm('ejercicios'));
    document.getElementById('asignaciones-new-btn')?.addEventListener('click', () => this.openForm('asignaciones'));
    document.getElementById('participantes-new-btn')?.addEventListener('click', () => this.openForm('participantes'));

    // Filtros
    document.getElementById('usuarios-filter')?.addEventListener('input', () => this.filterTable('usuarios'));
    document.getElementById('usuarios-rol-filter')?.addEventListener('change', () => this.filterTable('usuarios'));

    document.getElementById('unidades-base-filter')?.addEventListener('input', () => this.filterTable('unidades-base'));
    document.getElementById('unidades-base-tipo-filter')?.addEventListener('input', () => this.filterTable('unidades-base'));
    document.getElementById('unidades-base-pais-filter')?.addEventListener('input', () => this.filterTable('unidades-base'));

    document.getElementById('unidades-filter')?.addEventListener('input', () => this.filterTable('unidades'));
    document.getElementById('unidades-tipo-filter')?.addEventListener('input', () => this.filterTable('unidades'));
    document.getElementById('unidades-sidc-filter')?.addEventListener('input', () => this.filterTable('unidades'));

    document.getElementById('ejercicios-filter')?.addEventListener('input', () => this.filterTable('ejercicios'));
    document.getElementById('ejercicios-estado-filter')?.addEventListener('change', () => this.filterTable('ejercicios'));

    document.getElementById('asignaciones-filter')?.addEventListener('input', () => this.filterTable('asignaciones'));

    document.getElementById('participantes-filter')?.addEventListener('input', () => this.filterTable('participantes'));
    document.getElementById('participantes-bando-filter')?.addEventListener('input', () => this.filterTable('participantes'));
  }

  getTableDescription(tableName) {
    const descriptions = {
      usuarios: 'Gestiona los usuarios del sistema, sus permisos y roles. Aquí puedes crear nuevos usuarios, asignar roles (administrador/jugador) y gestionar sus datos personales.',
      'unidades-base': 'Crea y mantiene las plantillas de unidades militares con sus códigos SIDC. Estas plantillas se utilizan como base para crear instancias de unidades en los ejercicios.',
      unidades: 'Administra las instancias de unidades militares que participan en los ejercicios. Puedes crear nuevas unidades basadas en las plantillas disponibles y establecer sus posiciones en el mapa. Con un ejercicio elegido arriba solo se listan las suyas: las que controla alguno de sus participantes.',
      ejercicios: 'Crea y gestiona sesiones de simulación. Cada ejercicio es una sesión independiente donde se pueden asignar unidades militares y ejecutar operaciones tácticas.',
      asignaciones: 'Asigna usuarios a unidades militares. Define quién controla cada unidad en los ejercicios, estableciendo la relación entre usuarios y unidades. Es lo que mete una unidad en un ejercicio: con un ejercicio elegido arriba solo se listan las asignaciones de sus participantes.',
      participantes: 'Asigna usuarios no-administradores a ejercicios con un bando específico (azul, rojo, etc.). Un usuario solo puede participar una vez en cada ejercicio, pero puede cambiar de bando.',
      armamento: 'Define los sistemas de armas: cadencia de disparo, daño a unidades y a vehículos, alcance y tipo de ataque. Después se montan sobre las plantillas de vehículo.',
      'vehiculos-base': 'Plantillas de vehículo con su SIDC, velocidad, umbral de daño y rango de visión. Desde cada tarjeta se monta y desmonta el armamento con su dotación de munición.',
      vehiculos: 'Instancias de vehículo dentro de un ejercicio. Acá se define su posición, su bando y a qué se asigna: suelto, dentro de una unidad o transportado por otro vehículo.',
    };
    return descriptions[tableName] || '';
  }

  showTableDescription(tableName) {
    const description = this.getTableDescription(tableName);
    let descriptionEl = document.getElementById('admin-table-description');

    if (!descriptionEl) {
      descriptionEl = document.createElement('div');
      descriptionEl.id = 'admin-table-description';
      descriptionEl.className = 'admin-table-description';
      const content = document.querySelector('.admin-content');
      content?.insertBefore(descriptionEl, content.firstChild);
    }

    descriptionEl.textContent = description;
  }

  filterTable(tableName) {
    const data = this.data[tableName.replace('-', '_')] || [];
    let filtered = data;

    if (tableName === 'usuarios') {
      const searchText = document.getElementById('usuarios-filter')?.value.toLowerCase() || '';
      const rolFilter = document.getElementById('usuarios-rol-filter')?.value || '';

      filtered = data.filter(u => {
        const matchSearch = !searchText ||
          u.usuario.toLowerCase().includes(searchText) ||
          u.nombre.toLowerCase().includes(searchText) ||
          (u.grado && u.grado.toLowerCase().includes(searchText));
        const matchRol = !rolFilter || u.rol === rolFilter;
        return matchSearch && matchRol;
      });
    } else if (tableName === 'unidades-base') {
      const searchText = document.getElementById('unidades-base-filter')?.value.toLowerCase() || '';
      const tipoFilter = document.getElementById('unidades-base-tipo-filter')?.value.toLowerCase() || '';
      const paisFilter = document.getElementById('unidades-base-pais-filter')?.value.toLowerCase() || '';

      filtered = data.filter(u => {
        const matchSearch = !searchText ||
          u.sidc.toLowerCase().includes(searchText) ||
          u.nombre.toLowerCase().includes(searchText);
        const matchTipo = !tipoFilter || (u.tipo && u.tipo.toLowerCase().includes(tipoFilter));
        const matchPais = !paisFilter || (u.country && u.country.toLowerCase().includes(paisFilter));
        return matchSearch && matchTipo && matchPais;
      });
    } else if (tableName === 'unidades') {
      const searchText = document.getElementById('unidades-filter')?.value.toLowerCase() || '';
      const tipoFilter = document.getElementById('unidades-tipo-filter')?.value.toLowerCase() || '';
      const sidcFilter = document.getElementById('unidades-sidc-filter')?.value.toLowerCase() || '';

      filtered = data.filter(u => {
        const matchSearch = !searchText || u.nombre.toLowerCase().includes(searchText);
        const matchTipo = !tipoFilter || (u.tipo && u.tipo.toLowerCase().includes(tipoFilter));
        const matchSidc = !sidcFilter || (u.sidc && u.sidc.toLowerCase().includes(sidcFilter));
        return matchSearch && matchTipo && matchSidc;
      });
    } else if (tableName === 'ejercicios') {
      const searchText = document.getElementById('ejercicios-filter')?.value.toLowerCase() || '';
      const estadoFilter = document.getElementById('ejercicios-estado-filter')?.value;

      filtered = data.filter(e => {
        const matchSearch = !searchText ||
          e.nombre.toLowerCase().includes(searchText) ||
          (e.sala && e.sala.toLowerCase().includes(searchText));
        const matchEstado = estadoFilter === '' || String(e.activo) === estadoFilter;
        return matchSearch && matchEstado;
      });
    } else if (tableName === 'asignaciones') {
      const searchText = document.getElementById('asignaciones-filter')?.value.toLowerCase() || '';

      filtered = data.filter(a => {
        return !searchText ||
          (a.usuario_nombre && a.usuario_nombre.toLowerCase().includes(searchText)) ||
          (a.unidad_nombre && a.unidad_nombre.toLowerCase().includes(searchText));
      });
    } else if (tableName === 'participantes') {
      const searchText = document.getElementById('participantes-filter')?.value.toLowerCase() || '';
      const bandoFilter = document.getElementById('participantes-bando-filter')?.value.toLowerCase() || '';

      filtered = data.filter(p => {
        const matchSearch = !searchText ||
          (p.usuario_nombre && p.usuario_nombre.toLowerCase().includes(searchText)) ||
          (p.ejercicio_nombre && p.ejercicio_nombre.toLowerCase().includes(searchText));
        const matchBando = !bandoFilter || (p.bando && p.bando.toLowerCase().includes(bandoFilter));
        return matchSearch && matchBando;
      });
    }

    this.renderTableByName(tableName, filtered);
  }

  /** ¿Algún filtro de texto de la sección está escrito? (para el mensaje de tabla vacía) */
  filtroActivo(...ids) {
    return ids.some(id => (document.getElementById(id)?.value || '').trim() !== '');
  }

  renderTableByName(tableName, data) {
    if (tableName === 'usuarios') {
      this.renderUsuariosTable(data);
    } else if (tableName === 'unidades-base') {
      this.renderUnidadesBaseTable(data);
    } else if (tableName === 'unidades') {
      this.renderUnidadesTable(data);
    } else if (tableName === 'ejercicios') {
      this.renderEjerciciosTable(data);
    } else if (tableName === 'asignaciones') {
      this.renderAsignacionesTable(data);
    } else if (tableName === 'participantes') {
      this.renderParticipantesTable(data);
    }
  }

  switchTable(tableName) {
    this.currentTable = tableName;
    document.querySelectorAll('.admin-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.admin-tab-btn[data-table="${tableName}"]`)?.classList.add('active');

    document.querySelectorAll('.admin-table-view').forEach(v => v.classList.remove('active'));
    document.querySelector(`.admin-table-view[data-table="${tableName}"]`)?.classList.add('active');

    // Las secciones del grupo "Ejercicio" comparten el selector de contexto:
    // al cambiarlo se recarga la tabla que esté abierta.
    Catalogos.montarContexto(tableName, () => this.loadTable(tableName));

    this.loadTable(tableName);
  }

  async loadTable(tableName) {
    switch (tableName) {
      case 'usuarios':
        await this.loadUsuarios();
        break;
      case 'unidades-base':
        await this.loadUnidadesBase();
        break;
      case 'unidades':
        await this.loadUnidades();
        break;
      case 'ejercicios':
        await this.loadEjercicios();
        break;
      case 'asignaciones':
        await this.loadAsignaciones();
        break;
      case 'participantes':
        await this.loadParticipantes();
        break;
      default:
        // Armamento y vehículos viven en config-catalogos.js.
        if (Catalogos.maneja(tableName)) await Catalogos.cargar(tableName);
    }
  }

  // -------------------------------------------------------------------------
  // Contexto de ejercicio
  //
  // `unidad_militar` no tiene columna `ejercicio` (ver DATABASE.md): una unidad
  // "está" en un ejercicio si la controla (`unidad_militar_usuario`) alguien
  // que participa de él (`ejercicio_usuario`). No hay endpoint que resuelva ese
  // cruce, así que se hace acá y se cachea.
  // -------------------------------------------------------------------------

  async apiGet(ruta) {
    const response = await fetch(`${API_BASE}${ruta}`, {
      headers: { 'Authorization': `Bearer ${Session.getToken()}` },
    });
    if (!response.ok) throw new Error(`Error ${response.status}`);
    return response.json();
  }

  /**
   * Participantes del ejercicio en contexto como Set de ids (string), o `null`
   * si no hay ejercicio elegido (= no filtrar). Deja la lista completa en
   * `data.participantes_contexto` para los selects de los formularios.
   */
  async participantesDelContexto() {
    const ejercicio = Catalogos.ejercicioActual();
    if (!ejercicio) {
      this.data.participantes_contexto = null;
      return null;
    }
    const participantes = await this
      .apiGet(`/ejercicios/${ejercicio}/participantes`)
      .catch(() => []);
    this.data.participantes_contexto = participantes;
    return new Set(participantes.map(idUsuario).filter(Boolean));
  }

  /** Map unidadId -> usuarios que la controlan. Un pedido por unidad, cacheado. */
  async cargarControladores(unidades) {
    if (!this.controladores) this.controladores = new Map();
    // Solo se piden las que faltan. Antes se devolvía el cache entero apenas
    // existía: una unidad creada después de armarlo no tenía entrada, y sin
    // entrada se caía del filtro del ejercicio (tabla vacía sin explicación).
    const faltantes = unidades.filter(u => !this.controladores.has(String(u.id)));
    const pares = await Promise.all(faltantes.map(async (unidad) => {
      const usuarios = await this.apiGet(`/unidades/${unidad.id}/usuarios`).catch(() => []);
      return [String(unidad.id), usuarios];
    }));
    for (const [id, usuarios] of pares) this.controladores.set(id, usuarios);
    return this.controladores;
  }

  invalidarControladores() {
    this.controladores = null;
  }

  /**
   * unidadId -> bando, derivado del jugador que la controla.
   *
   * El bando no es de la unidad: es del participante, y el mismo jugador puede
   * ser azul en un ejercicio y rojo en otro (backend.md, punto 7). Sin ejercicio
   * en contexto no hay nada que derivar.
   */
  async bandosPorUnidad(unidades) {
    const mapa = new Map();
    const participantes = this.data.participantes_contexto;
    if (!participantes?.length) return mapa;

    const bandoPorUsuario = new Map(participantes.map(p => [idUsuario(p), p.bando]));
    const controladores = await this.cargarControladores(unidades);
    for (const unidad of unidades) {
      const suyos = controladores.get(String(unidad.id)) || [];
      const bando = unidad.bando
        || suyos.map(u => bandoPorUsuario.get(idUsuario(u))).find(Boolean);
      if (bando) mapa.set(String(unidad.id), bando);
    }
    return mapa;
  }

  /** Celda de bando con el motivo cuando no se pudo derivar. */
  celdaBando(bando) {
    if (bando) {
      return `<span class="admin-bando-badge ${String(bando).toLowerCase()}">${bando}</span>`;
    }
    const motivo = Catalogos.ejercicioActual()
      ? 'Esta unidad no tiene un jugador que participe del ejercicio elegido'
      : 'Elegí un ejercicio arriba: el bando depende de en cuál participa el jugador';
    return `<span class="admin-bando-badge sin-bando" title="${motivo}">— sin bando</span>`;
  }

  /** Deja solo las unidades que controla algún participante del ejercicio. */
  async acotarUnidades(unidades) {
    const participantes = await this.participantesDelContexto();
    if (!participantes) return unidades;
    const controladores = await this.cargarControladores(unidades);
    return unidades.filter(u =>
      (controladores.get(String(u.id)) || []).some(usr => participantes.has(idUsuario(usr))));
  }

  /** Todas las unidades, sin acotar: los selects de los formularios las necesitan. */
  async todasLasUnidades() {
    if (!this.data.unidades_todas?.length) {
      this.data.unidades_todas = await this.apiGet('/unidades').catch(() => []);
    }
    return this.data.unidades_todas;
  }

  async loadUsuarios() {
    try {
      const token = Session.getToken();
      const response = await fetch(`${API_BASE}/usuarios`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) throw new Error(`Error ${response.status}`);
      const usuarios = await response.json();
      this.data.usuarios = usuarios;
      this.renderUsuariosTable(usuarios);
    } catch (error) {
      console.error('Error loading usuarios:', error);
    }
  }

  renderUsuariosTable(usuarios) {
    const tbody = document.querySelector('#usuarios-table tbody');
    if (!tbody) return;

    tbody.innerHTML = usuarios.map(u => {
      const fechaCreacion = u.fecha_creacion ? new Date(u.fecha_creacion).toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' }) : '-';
      return `
        <tr>
          <td>${u.id}</td>
          <td>${u.usuario}</td>
          <td>${u.nombre}</td>
          <td>${u.grado || '-'}</td>
          <td><span class="admin-rol-badge ${u.rol}">${u.rol}</span></td>
          <td><small>${fechaCreacion}</small></td>
          <td>
            <button class="admin-edit-btn" onclick="adminManager.openForm('usuarios', '${u.id}')">Editar</button>
            <button class="admin-delete-btn" onclick="adminManager.deleteRecord('usuarios', '${u.id}')">Eliminar</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  async loadUnidadesBase() {
    try {
      const token = Session.getToken();
      const response = await fetch(`${API_BASE}/unidades/base`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) throw new Error(`Error ${response.status}`);
      const unidades = await response.json();
      this.data.unidades_base = unidades;
      this.renderUnidadesBaseTable(unidades);
    } catch (error) {
      console.error('Error loading unidades base:', error);
    }
  }

  renderUnidadesBaseTable(unidades) {
    const tbody = document.querySelector('#unidades-base-table tbody');
    if (!tbody) return;

    tbody.innerHTML = unidades.map(u => {
      const fechaCreacion = u.fecha_creacion ? new Date(u.fecha_creacion).toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' }) : '-';
      return `
        <tr>
          <td>${u.id}</td>
          <td class="admin-simbolo-celda">${Simbolo.marca(u.sidc, { size: 28, alto: 34 })}</td>
          <td><code>${u.sidc}</code></td>
          <td>${u.nombre}</td>
          <td>${u.tipo || '-'}</td>
          <td>${u.country || '-'}</td>
          <td style="text-align: center; font-weight: 600;">${u.quantity || '-'}</td>
          <td><small>${fechaCreacion}</small></td>
          <td>
            <button class="admin-edit-btn" onclick="adminManager.openForm('unidades-base', '${u.id}')">Editar</button>
            <button class="admin-delete-btn" onclick="adminManager.deleteRecord('unidades-base', '${u.id}')">Eliminar</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  async loadUnidades() {
    try {
      const todas = await this.apiGet('/unidades');
      this.data.unidades_todas = todas;
      // Con un ejercicio en contexto solo se listan sus unidades.
      this.data.unidades = await this.acotarUnidades(todas);
      // El símbolo se pinta con la afiliación que da el bando del controlador.
      this.data.bandos_unidad = await this.bandosPorUnidad(this.data.unidades);
      this.renderUnidadesTable(this.data.unidades);
    } catch (error) {
      console.error('Error loading unidades:', error);
    }
  }

  renderUnidadesTable(unidades) {
    const tbody = document.querySelector('#unidades-table tbody');
    if (!tbody) return;

    if (!unidades.length) {
      let vacio = 'No hay unidades cargadas.';
      if (this.filtroActivo('unidades-filter', 'unidades-tipo-filter', 'unidades-sidc-filter')) {
        vacio = 'Ninguna unidad coincide con el filtro.';
      } else if (Catalogos.ejercicioActual()) {
        // Distinguir "no hay unidades" de "hay, pero ninguna es de este
        // ejercicio": el cruce se hace en el cliente y es la fuente habitual de
        // tablas vacías inesperadas.
        const total = this.data.unidades_todas?.length || 0;
        vacio = total
          ? `Hay ${total} unidad(es) cargadas, pero ninguna está en este ejercicio. `
            + 'Una unidad entra al ejercicio cuando se le asigna un participante de él '
            + '(pestaña «Usuarios → Unidades»). Si esperabas verla acá, revisá que su '
            + 'controlador sea participante de este ejercicio.'
          : 'No hay unidades cargadas todavía.';
      }
      tbody.innerHTML = `<tr><td colspan="9" class="admin-tabla-vacia">${vacio}</td></tr>`;
      return;
    }

    const bandos = this.data.bandos_unidad || new Map();
    tbody.innerHTML = unidades.map(u => {
      // El SIDC del catálogo trae la afiliación de la plantilla: el bando del
      // jugador que la controla es el que manda (dígito 4 del SIDC numérico).
      const bando = bandos.get(String(u.id)) || null;
      return `
      <tr>
        <td>${u.id}</td>
        <td class="admin-simbolo-celda">${Simbolo.marca(Sidc.conBando(u.sidc, bando), { size: 28, alto: 34 })}</td>
        <td>${u.nombre}</td>
        <td>${this.celdaBando(bando)}</td>
        <td><code>${u.sidc}</code></td>
        <td>${u.tipo || '-'}</td>
        <td>${u.pos_x ? u.pos_x.toFixed(2) : '-'}</td>
        <td>${u.pos_y ? u.pos_y.toFixed(2) : '-'}</td>
        <td>
          <button class="admin-edit-btn" onclick="adminManager.openForm('unidades', '${u.id}')">Editar</button>
          <button class="admin-delete-btn" onclick="adminManager.deleteRecord('unidades', '${u.id}')">Eliminar</button>
        </td>
      </tr>
    `;
    }).join('');
  }

  async loadEjercicios() {
    try {
      const token = Session.getToken();
      const response = await fetch(`${API_BASE}/ejercicios`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) throw new Error(`Error ${response.status}`);
      const ejercicios = await response.json();
      this.data.ejercicios = ejercicios;
      // El selector de contexto cachea la lista: si acá se creó o borró alguno,
      // hay que forzar que la relea.
      Catalogos.invalidarEjercicios();
      this.renderEjerciciosTable(ejercicios);
    } catch (error) {
      console.error('Error loading ejercicios:', error);
    }
  }

  renderEjerciciosTable(ejercicios) {
    const tbody = document.querySelector('#ejercicios-table tbody');
    if (!tbody) return;

    tbody.innerHTML = ejercicios.map(e => `
      <tr>
        <td>${e.id}</td>
        <td>${e.nombre}</td>
        <td>${e.sala || '-'}</td>
        <td><span class="admin-estado-badge ${e.activo ? 'activo' : 'inactivo'}">${e.activo ? '✓ Activo' : '✗ Inactivo'}</span></td>
        <td>
          <button class="admin-edit-btn" onclick="adminManager.openForm('ejercicios', '${e.id}')">Editar</button>
          <button class="admin-delete-btn" onclick="adminManager.deleteRecord('ejercicios', '${e.id}')">Eliminar</button>
        </td>
      </tr>
    `).join('');
  }

  async loadAsignaciones() {
    try {
      if (!this.data.usuarios || this.data.usuarios.length === 0) {
        this.data.usuarios = await this.apiGet('/usuarios').catch(() => []);
      }

      // Las asignaciones (`unidad_militar_usuario`) se arman recorriendo los
      // controladores de cada unidad; con un ejercicio en contexto se dejan
      // solo las de sus participantes.
      const unidades = await this.todasLasUnidades();
      const controladores = await this.cargarControladores(unidades);
      const participantes = await this.participantesDelContexto();

      // El bando de cada participante: es lo que hereda la unidad que controla.
      const bandoPorUsuario = new Map(
        (this.data.participantes_contexto || []).map(p => [idUsuario(p), p.bando]));

      const asignaciones = [];
      for (const unidad of unidades) {
        for (const usuario of (controladores.get(String(unidad.id)) || [])) {
          const usuarioId = idUsuario(usuario);
          if (participantes && !participantes.has(usuarioId)) continue;
          asignaciones.push({
            id: `${unidad.id}-${usuarioId}`,
            unidad_militar_id: unidad.id,
            unidad_nombre: unidad.nombre,
            unidad_sidc: unidad.sidc,
            usuario_id: usuarioId,
            usuario_nombre: usuario.usuario || usuario.nombre || `usuario ${usuarioId}`,
            // Heredado del jugador, no de la unidad (backend.md, punto 7).
            bando: unidad.bando || bandoPorUsuario.get(usuarioId) || null,
          });
        }
      }

      this.data.asignaciones = asignaciones;
      this.renderAsignacionesTable(asignaciones);
    } catch (error) {
      console.error('Error loading asignaciones:', error);
    }
  }

  renderAsignacionesTable(asignaciones) {
    const tbody = document.querySelector('#asignaciones-table tbody');
    if (!tbody) return;

    if (!asignaciones.length) {
      let vacio = 'No hay asignaciones cargadas.';
      if (this.filtroActivo('asignaciones-filter')) {
        vacio = 'Ninguna asignación coincide con el filtro.';
      } else if (Catalogos.ejercicioActual()) {
        vacio = 'Ningún participante de este ejercicio controla unidades todavía.';
      }
      tbody.innerHTML = `<tr><td colspan="6" class="admin-tabla-vacia">${vacio}</td></tr>`;
      return;
    }

    tbody.innerHTML = asignaciones.map(a => `
      <tr>
        <td>${a.id}</td>
        <td class="admin-simbolo-celda">${Simbolo.marca(Sidc.conBando(a.unidad_sidc, a.bando), { size: 28, alto: 34 })}</td>
        <td>${a.usuario_nombre || '-'}</td>
        <td>${a.unidad_nombre || '-'}</td>
        <td>${this.celdaBando(a.bando)}</td>
        <td>
          <button class="admin-delete-btn" onclick="adminManager.deleteRecord('asignaciones', '${a.id}')">Eliminar</button>
        </td>
      </tr>
    `).join('');
  }

  async loadParticipantes() {
    try {
      const token = Session.getToken();
      // Cargar todos los ejercicios y sus participantes
      const response = await fetch(`${API_BASE}/ejercicios`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) throw new Error(`Error ${response.status}`);
      const todos = await response.json();
      // La lista completa alimenta el select del formulario aunque la tabla
      // esté acotada a un solo ejercicio.
      this.data.ejercicios = todos;

      // Si hay un ejercicio en contexto se listan solo sus participantes.
      const contexto = Catalogos.ejercicioActual();
      const ejercicios = contexto
        ? todos.filter(e => String(e.id) === String(contexto))
        : todos;

      // Para cada ejercicio, cargar sus participantes
      const participantes = [];
      for (const ejercicio of ejercicios) {
        try {
          const partResponse = await fetch(`${API_BASE}/ejercicios/${ejercicio.id}/participantes`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          if (partResponse.ok) {
            const parts = await partResponse.json();
            parts.forEach(p => {
              participantes.push({
                id: `${ejercicio.id}-${p.usuario_id}`,
                ejercicio_id: ejercicio.id,
                ejercicio_nombre: ejercicio.nombre,
                usuario_id: p.usuario_id,
                usuario_nombre: p.usuario,
                nombre: p.nombre,
                grado: p.grado,
                bando: p.bando,
              });
            });
          }
        } catch (e) {
          console.error(`Error loading participantes for ejercicio ${ejercicio.id}:`, e);
        }
      }

      this.data.participantes = participantes;
      this.renderParticipantesTable(participantes);
    } catch (error) {
      console.error('Error loading participantes:', error);
    }
  }

  renderParticipantesTable(participantes) {
    const tbody = document.querySelector('#participantes-table tbody');
    if (!tbody) return;

    tbody.innerHTML = participantes.map(p => `
      <tr>
        <td>${p.id}</td>
        <td>${p.ejercicio_nombre}</td>
        <td>${p.usuario_nombre}</td>
        <td><span class="admin-bando-badge ${p.bando?.toLowerCase()}">${p.bando}</span></td>
        <td>
          <button class="admin-edit-btn" onclick="adminManager.openForm('participantes', '${p.id}')">Editar</button>
          <button class="admin-delete-btn" onclick="adminManager.deleteRecord('participantes', '${p.id}')">Eliminar</button>
        </td>
      </tr>
    `).join('');
  }

  async openForm(table, id = null) {
    this.editingId = id;
    const modal = document.getElementById('admin-form-modal');
    const overlay = document.getElementById('admin-form-overlay');
    const title = document.getElementById('admin-form-title');
    const fields = document.getElementById('admin-form-fields');

    // Los selects se arman con listas que hasta ahora solo cargaba la pestaña
    // dueña de cada una: abriendo el formulario desde otra pestaña salían
    // vacíos. Se trae lo que falte antes de pintar.
    await this.precargarSelects(table);

    const formConfig = this.getFormConfig(table, id);
    title.innerHTML = `
      <div style="margin-bottom: 8px;">${formConfig.title}</div>
      ${formConfig.description ? `<div class="admin-form-subtitle">${formConfig.description}</div>` : ''}
    `;
    fields.innerHTML = formConfig.fields;

    modal?.classList.add('active');
    overlay?.classList.add('active');

    // La plantilla define el SIDC: se dibuja el símbolo mientras se escribe.
    if (table === 'unidades-base') this.conectarPreviewSidc();
  }

  /**
   * Trae las listas que alimentan los selects del formulario de `table`.
   * Cada `load*` deja su lista en `this.data`, pero solo corre al abrir SU
   * pestaña; el formulario de participantes, por ejemplo, necesita `usuarios`
   * aunque nunca se haya entrado a «Usuarios».
   */
  async precargarSelects(table) {
    const pedidos = [];
    const falta = (clave) => !this.data[clave]?.length;

    if (table === 'participantes' || table === 'asignaciones') {
      if (falta('usuarios')) {
        pedidos.push(this.apiGet('/usuarios').then((r) => { this.data.usuarios = r; }));
      }
    }
    if (table === 'participantes' && falta('ejercicios')) {
      pedidos.push(this.apiGet('/ejercicios').then((r) => { this.data.ejercicios = r; }));
    }
    if (table === 'asignaciones') {
      pedidos.push(this.todasLasUnidades());
      // Con un ejercicio en contexto el select de usuarios se acota a sus
      // participantes: hay que tenerlos frescos.
      pedidos.push(this.participantesDelContexto());
      // Y las asignaciones vigentes, para saber qué unidades ya tienen dueño.
      if (!this.data.asignaciones) pedidos.push(this.loadAsignaciones());
    }
    if (table === 'unidades') {
      if (falta('unidades_base')) {
        pedidos.push(this.apiGet('/unidades/base').then((r) => { this.data.unidades_base = r; }));
      }
      // El alta pide el jugador que la controla: son los participantes del
      // ejercicio en contexto.
      pedidos.push(this.participantesDelContexto());
    }

    await Promise.all(pedidos.map((p) => p.catch((e) => {
      console.error(`No se pudo precargar un select de ${table}:`, e);
    })));
  }

  /** Vista previa del símbolo táctico junto al campo SIDC (milsymbol). */
  conectarPreviewSidc() {
    const input = document.getElementById('admin-sidc-input');
    const preview = document.getElementById('admin-sidc-preview');
    const estado = document.getElementById('admin-sidc-estado');
    if (!input || !preview) return;

    const dibujar = () => {
      const sidc = input.value.trim();
      Simbolo.pintar(preview, sidc, { size: 44, alto: 56 });
      if (!estado) return;
      if (!sidc) {
        estado.textContent = 'Escribí un SIDC para ver el símbolo.';
        estado.className = 'admin-sidc-estado';
      } else if (Simbolo.esValido(sidc)) {
        estado.textContent = /^\d+$/.test(sidc)
          ? `✓ SIDC numérico (MIL-STD-2525D / APP-6D) · afiliación: dígito 4 = ${sidc[3] ?? '?'}`
          : '✓ SIDC alfanumérico (MIL-STD-2525B/C)';
        estado.className = 'admin-sidc-estado ok';
      } else {
        estado.textContent = '⚠ milsymbol no reconoce este código: revisá el SIDC.';
        estado.className = 'admin-sidc-estado error';
      }
    };

    input.addEventListener('input', dibujar);
    dibujar();
  }

  getFormConfig(table, id) {
    const isEdit = !!id;
    // El id llega como string desde el `onclick` de la tabla, pero en `data`
    // puede ser number según de qué endpoint vino. Con `===` no matcheaba y el
    // formulario de edición salía en blanco, perdiendo la plantilla elegida.
    const record = isEdit
      ? this.data[table.replace('-', '_')]?.find(r => String(r.id) === String(id))
      : null;

    return {
      usuarios: this.getUsuariosForm(isEdit, record),
      'unidades-base': this.getUnidadesBaseForm(isEdit, record),
      unidades: this.getUnidadesForm(isEdit, record),
      ejercicios: this.getEjerciciosForm(isEdit, record),
      asignaciones: this.getAsignacionesForm(isEdit, record),
      participantes: this.getParticipantesForm(isEdit, record),
    }[table] || { title: 'Formulario', description: '', fields: '' };
  }

  getUsuariosForm(isEdit, record) {
    return {
      title: isEdit ? 'Editar Usuario' : 'Nuevo Usuario',
      description: isEdit
        ? `Editando usuario: <strong>${record?.nombre || 'Usuario'}</strong><br>Modifica sus datos personales, grado militar y permisos del sistema.`
        : 'Crea un nuevo usuario del sistema. El usuario podrá acceder con sus credenciales y se le asignarán unidades militares para controlar.',
      fields: `
        <div style="background: rgba(var(--sim-oro-rgb),0.1); padding: 12px; border-radius: 4px; margin-bottom: 12px; border-left: 3px solid var(--sim-oro);">
          <div style="font-size: 11px; color: var(--sim-oro); text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Credenciales de Acceso</div>
          <div class="admin-form-group">
            <label>Usuario (login)</label>
            <input type="text" name="usuario" value="${record?.usuario || ''}" ${isEdit ? 'disabled' : 'required'} placeholder="nombre_usuario">
          </div>
          ${!isEdit ? `
          <div class="admin-form-group">
            <label>Contraseña</label>
            <input type="password" name="password" required placeholder="Contraseña segura">
          </div>
          ` : ''}
        </div>
        <div style="background: rgba(var(--sim-cian-rgb),0.1); padding: 12px; border-radius: 4px; margin-bottom: 12px; border-left: 3px solid var(--sim-cian);">
          <div style="font-size: 11px; color: var(--sim-cian); text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Información Personal</div>
          <div class="admin-form-group">
            <label>Nombre Completo</label>
            <input type="text" name="nombre" value="${record?.nombre || ''}" required placeholder="Ej: Juan Pérez García">
          </div>
          <div class="admin-form-group">
            <label>Grado Militar</label>
            <input type="text" name="grado" value="${record?.grado || ''}" placeholder="Ej: Capitán, Mayor, Teniente">
          </div>
        </div>
        <div style="background: rgba(var(--sim-rojo-rgb),0.1); padding: 12px; border-radius: 4px; border-left: 3px solid var(--sim-rojo);">
          <div style="font-size: 11px; color: var(--sim-rojo); text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Permisos del Sistema</div>
          <div class="admin-form-group">
            <label>Rol</label>
            <select name="rol" ${!isEdit || Session.getUser().id !== record?.id ? '' : 'disabled'}>
              <option value="jugador" ${record?.rol !== 'administrador' ? 'selected' : ''}>👤 Jugador (operador)</option>
              <option value="administrador" ${record?.rol === 'administrador' ? 'selected' : ''}>👑 Administrador (gestor del sistema)</option>
            </select>
          </div>
        </div>
      `,
    };
  }

  getUnidadesBaseForm(isEdit, record) {
    return {
      title: isEdit ? 'Editar Plantilla de Unidad' : 'Nueva Plantilla de Unidad',
      description: isEdit
        ? `Editando plantilla: <strong>${record?.nombre || 'Plantilla'}</strong> (SIDC: ${record?.sidc})<br>Modifica los datos de esta plantilla base que se usará para crear nuevas instancias de unidades.`
        : 'Crea una nueva plantilla de unidad militar. La plantilla define el código SIDC y características base que se heredarán a las instancias de unidades.',
      fields: `
        <div style="background: rgba(var(--sim-oro-rgb),0.1); padding: 12px; border-radius: 4px; margin-bottom: 12px; border-left: 3px solid var(--sim-oro);">
          <div style="font-size: 11px; color: var(--sim-oro); text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Identificación</div>
          <div class="admin-form-group">
            <label>SIDC (Código MIL-STD-2525/APP-6) *</label>
            <div class="admin-sidc-fila">
              <input type="text" name="sidc" id="admin-sidc-input" value="${record?.sidc || ''}" required maxlength="30" placeholder="SFGPUCI---****X">
              <div class="admin-sidc-preview" id="admin-sidc-preview"></div>
            </div>
            <small class="admin-sidc-estado" id="admin-sidc-estado"></small>
          </div>
          <div class="admin-form-group">
            <label>Nombre de la Plantilla *</label>
            <input type="text" name="nombre" value="${record?.nombre || ''}" required placeholder="Ej: Compañía de Infantería, Pelotón de Carros">
          </div>
        </div>
        <div style="background: rgba(var(--sim-cian-rgb),0.1); padding: 12px; border-radius: 4px; border-left: 3px solid var(--sim-cian);">
          <div style="font-size: 11px; color: var(--sim-cian); text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Características</div>
          <div class="admin-form-group">
            <label>Tipo</label>
            <input type="text" name="tipo" value="${record?.tipo || ''}" placeholder="Ej: Infantería, Blindados, Artillería">
          </div>
          <div class="admin-form-group">
            <label>Plataforma</label>
            <input type="text" name="platform_type" value="${record?.platform_type || ''}" placeholder="Ej: Terrestre, Aérea, Naval">
          </div>
          <div class="admin-form-group">
            <label>País/Nación</label>
            <input type="text" name="country" value="${record?.country || ''}" placeholder="Ej: CL, AR, PE">
          </div>
          <div class="admin-form-group">
            <label>Cantidad por Defecto (Efectivos)</label>
            <input type="number" name="quantity" value="${record?.quantity || ''}" min="0" placeholder="Ej: 45, 120 (enteros positivos)">
          </div>
          <div class="admin-form-group">
            <label>Descripción</label>
            <textarea name="descripcion" style="min-height: 80px;" placeholder="Descripción detallada de la plantilla...">${record?.descripcion || ''}</textarea>
          </div>
        </div>
      `,
    };
  }

  getUnidadesForm(isEdit, record) {
    const plantillas = this.data.unidades_base || [];
    // El alta pide lo mínimo, igual que el alta en caliente del panel de
    // dirección: plantilla, nombre, jugador y posición. Los ~34 modificadores
    // MIL-STD solo aparecen al editar, cuando la unidad ya existe.
    const jugadores = (this.data.participantes_contexto || [])
      .map(p => ({ id: idUsuario(p), nombre: p.nombre || p.usuario, bando: p.bando }));
    const nombreEjercicio = Catalogos.ejercicioActualNombre();

    return {
      title: isEdit ? 'Editar Unidad' : 'Nueva Unidad',
      description: isEdit
        ? `Editando unidad: <strong>${record?.nombre || 'Unidad'}</strong><br>Además de lo básico, acá se completan las ~34 propiedades tácticas MIL-STD-2525/APP-6.`
        : 'Crea una unidad a partir de una plantilla. El bando sale del jugador que la controla; el resto de las propiedades tácticas se completan después, al editarla.',
      fields: `
        <div style="background: rgba(var(--sim-oro-rgb),0.1); padding: 12px; border-radius: 4px; margin-bottom: 12px; border-left: 3px solid var(--sim-oro);">
          <div style="font-size: 11px; color: var(--sim-oro); text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Información Básica</div>
          <div class="admin-form-group">
            <label>Plantilla Base (SIDC) *</label>
            <select name="unidad_militar_base_id" required ${plantillas.length ? '' : 'disabled'}>
              <option value="">${plantillas.length ? 'Seleccionar plantilla...' : '— No hay plantillas cargadas —'}</option>
              ${plantillas.map(u =>
                `<option value="${u.id}"${String(record?.unidad_militar_base_id) === String(u.id) ? ' selected' : ''}>${u.nombre} (${u.sidc})</option>`
              ).join('')}
            </select>
            ${plantillas.length ? '' : `
            <div style="font-size: 10px; color: var(--sim-rojo); margin-top: 8px; padding: 8px; background: rgba(var(--sim-rojo-rgb),0.12); border-radius: 3px;">
              ⚠ Creá primero una plantilla en la pestaña «Plantilla de Unidades».
            </div>`}
          </div>
          <div class="admin-form-group">
            <label>Nombre de la Unidad *</label>
            <input type="text" name="nombre" value="${record?.nombre || ''}" required placeholder="Ej: Alfa 1, Bravo Company, Zapadores 3">
          </div>
          ${isEdit ? '' : `
          <div class="admin-form-group">
            <label>Jugador que la controla *</label>
            <select name="jugador_asignado_id" required ${jugadores.length ? '' : 'disabled'}>
              <option value="">${jugadores.length ? 'Seleccionar jugador...' : '— No hay participantes en el ejercicio —'}</option>
              ${jugadores.map(j =>
                `<option value="${j.id}">${j.nombre}${j.bando ? ` — ${j.bando}` : ''}</option>`
              ).join('')}
            </select>
            <div style="font-size: 10px; color: ${jugadores.length ? 'var(--sim-cian)' : 'var(--sim-rojo)'}; margin-top: 8px; padding: 8px; background: rgba(${jugadores.length ? 'var(--sim-cian-rgb)' : 'var(--sim-rojo-rgb)'},0.15); border-radius: 3px;">
              ${jugadores.length
                ? '💡 Una unidad siempre tiene un jugador, y de él hereda el bando. Al guardar se crea la unidad y se le asigna el controlador en un solo paso.'
                : (nombreEjercicio
                  ? `⚠ <strong>${nombreEjercicio}</strong> todavía no tiene participantes: agregalos en la pestaña «Participantes».`
                  : '⚠ Elegí un ejercicio en la barra de arriba para ver sus participantes.')}
            </div>
          </div>`}
          <div class="admin-form-group">
            <label>Posición X (Longitud)</label>
            <input type="number" name="pos_x" value="${record?.pos_x ?? ''}" step="0.0001" placeholder="-71.0589">
          </div>
          <div class="admin-form-group">
            <label>Posición Y (Latitud)</label>
            <input type="number" name="pos_y" value="${record?.pos_y ?? ''}" step="0.0001" placeholder="42.3601">
          </div>
          ${isEdit ? `
          <div class="admin-form-group">
            <label>Tipo</label>
            <input type="text" name="tipo" value="${record?.tipo || ''}" placeholder="Ej: Infantería, Blindados">
          </div>` : ''}
        </div>
        ${!isEdit ? '' : `
        <fieldset style="border: 1px solid rgba(var(--sim-oro-rgb),0.3); padding: 12px; border-radius: 4px; margin-top: 12px;">
          <legend style="color: var(--sim-oro); font-size: 11px; font-weight: 700; text-transform: uppercase; padding: 0 8px;">Modificadores MIL-STD-2525/APP-6 (~34 campos)</legend>

          <div style="font-size: 10px; color: var(--sim-cian); margin-bottom: 12px; padding: 8px; background: rgba(var(--sim-cian-rgb),0.1); border-radius: 3px;">Todos los campos son opcionales. Completa solo los que apliquen a tu unidad.</div>

          <div class="admin-form-group">
            <label>Comentarios de Estado Mayor</label>
            <textarea name="staff_comments" style="min-height: 60px;" placeholder="Observaciones tácticas...">${record?.staff_comments || ''}</textarea>
          </div>
          <div class="admin-form-group">
            <label>Identificador Común (Callsign)</label>
            <input type="text" name="common_identifier" value="${record?.common_identifier || ''}" maxlength="100">
          </div>
          <div class="admin-form-group">
            <label>Formación Superior</label>
            <input type="text" name="higher_formation" value="${record?.higher_formation || ''}" maxlength="150" placeholder="Ej: Batallón Comando">
          </div>
          <div class="admin-form-group">
            <label>Evaluación</label>
            <input type="text" name="evaluation_rating" value="${record?.evaluation_rating || ''}" maxlength="10" placeholder="A, B, C...">
          </div>
          <div class="admin-form-group">
            <label>Efectividad de Combate (%)</label>
            <input type="text" name="combat_effectiveness" value="${record?.combat_effectiveness || ''}" maxlength="10" placeholder="100, 75, 50">
          </div>
          <div class="admin-form-group">
            <label>Altitud/Profundidad</label>
            <input type="text" name="altitude_depth" value="${record?.altitude_depth || ''}" maxlength="50" placeholder="1500m, 200m">
          </div>
          <div class="admin-form-group">
            <label>DTG (Date-Time Group)</label>
            <input type="text" name="dtg" value="${record?.dtg || ''}" maxlength="25" placeholder="121630ZJUL26">
          </div>
          <div class="admin-form-group">
            <label>IFF/SIF (Identificación Amiga)</label>
            <input type="text" name="iff_sif" value="${record?.iff_sif || ''}" maxlength="50">
          </div>
          <div class="admin-form-group">
            <label>Tipo (Type) - distinto de Tipo anterior</label>
            <input type="text" name="type" value="${record?.type || ''}" maxlength="100" placeholder="Ej: Vehículo, Personal, Sistema">
          </div>
          <div class="admin-form-group">
            <label>Plataforma</label>
            <input type="text" name="platform_type" value="${record?.platform_type || ''}" maxlength="100" placeholder="Terrestre, Aérea, Naval">
          </div>
          <div class="admin-form-group">
            <label>Tiempo de Desmontaje de Equipos</label>
            <input type="text" name="equipment_teardown_time" value="${record?.equipment_teardown_time || ''}" maxlength="50" placeholder="15 min, 1 hora">
          </div>
          <div class="admin-form-group">
            <label>Velocidad</label>
            <input type="text" name="speed" value="${record?.speed || ''}" maxlength="50" placeholder="50 km/h">
          </div>
          <div class="admin-form-group">
            <label>Cuartel General Especial</label>
            <input type="text" name="special_headquarters" value="${record?.special_headquarters || ''}" maxlength="100">
          </div>
          <div class="admin-form-group">
            <label>Designación Única</label>
            <input type="text" name="unique_designation" value="${record?.unique_designation || ''}" maxlength="150">
          </div>
          <div class="admin-form-group">
            <label>Indicador de Equipo Auxiliar</label>
            <input type="text" name="auxiliary_equipment_indicator" value="${record?.auxiliary_equipment_indicator || ''}" maxlength="50">
          </div>
          <div class="admin-form-group">
            <label>País/Nación</label>
            <input type="text" name="country" value="${record?.country || ''}" maxlength="100" placeholder="CL, AR, PE">
          </div>
          <div class="admin-form-group">
            <label>Dirección/Rumbo</label>
            <input type="text" name="direction" value="${record?.direction || ''}" maxlength="50" placeholder="N, NE, 045°">
          </div>
          <div class="admin-form-group">
            <label>Barra de Enganche</label>
            <input type="text" name="engagement_bar" value="${record?.engagement_bar || ''}" maxlength="50">
          </div>
          <div class="admin-form-group">
            <label>Tipo de Enganche</label>
            <input type="text" name="engagement_type" value="${record?.engagement_type || ''}" maxlength="50" placeholder="Defensivo, Ofensivo">
          </div>
          <div class="admin-form-group">
            <label>Unidad Guardada/Protegida</label>
            <input type="text" name="guarded_unit" value="${record?.guarded_unit || ''}" maxlength="150">
          </div>
          <div class="admin-form-group">
            <label>Elemento de Cuartel General</label>
            <input type="text" name="headquarters_element" value="${record?.headquarters_element || ''}" maxlength="50">
          </div>
          <div class="admin-form-group">
            <label>Hostil (Friendly/Hostile)</label>
            <input type="text" name="hostile" value="${record?.hostile || ''}" maxlength="50" placeholder="Friendly, Hostile, Unknown">
          </div>
          <div class="admin-form-group">
            <label>Composición de Instalación</label>
            <input type="text" name="installation_composition" value="${record?.installation_composition || ''}" maxlength="100">
          </div>
          <div class="admin-form-group">
            <label>Reforzado/Reducido</label>
            <input type="text" name="reinforced_reduced" value="${record?.reinforced_reduced || ''}" maxlength="10" placeholder="Reinf, Reduc">
          </div>
          <div class="admin-form-group">
            <label>SIGINT (Inteligencia de Señales)</label>
            <input type="text" name="sigint" value="${record?.sigint || ''}" maxlength="50">
          </div>
          <div class="admin-form-group">
            <label>Número de Objetivo</label>
            <input type="text" name="target_number" value="${record?.target_number || ''}" maxlength="50">
          </div>
          <div class="admin-form-group">
            <label>Equipo de Firma</label>
            <input type="text" name="signature_equipment" value="${record?.signature_equipment || ''}" maxlength="100">
          </div>
          <div class="admin-form-group">
            <label>Designador Especial</label>
            <input type="text" name="special_designator" value="${record?.special_designator || ''}" maxlength="150">
          </div>
          <div class="admin-form-group">
            <label>Líder de Velocidad</label>
            <input type="text" name="speed_leader" value="${record?.speed_leader || ''}" maxlength="50">
          </div>
          <div class="admin-form-group">
            <label>Información Adicional</label>
            <textarea name="additional_information" style="min-height: 80px;" placeholder="Notas adicionales sobre la unidad...">${record?.additional_information || ''}</textarea>
          </div>
        </fieldset>`}
      `,
    };
  }

  getEjerciciosForm(isEdit, record) {
    return {
      title: isEdit ? 'Editar Ejercicio' : 'Nuevo Ejercicio',
      description: isEdit
        ? `Editando ejercicio: <strong>${record?.nombre || 'Ejercicio'}</strong><br>Modifica los datos de esta sesión de simulación táctico.`
        : 'Crea una nueva sesión de ejercicio/simulación. Los ejercicios agrupan conjuntos de unidades militares para ejecutar operaciones tácticas coordenadas.',
      fields: `
        <div style="background: rgba(var(--sim-oro-rgb),0.1); padding: 12px; border-radius: 4px; margin-bottom: 12px; border-left: 3px solid var(--sim-oro);">
          <div style="font-size: 11px; color: var(--sim-oro); text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Información del Ejercicio</div>
          <div class="admin-form-group">
            <label>Nombre del Ejercicio *</label>
            <input type="text" name="nombre" value="${record?.nombre || ''}" required placeholder="Ej: Operación Centinela, Ejercicio Conjunto 2026">
          </div>
          <div class="admin-form-group">
            <label>Sala/Localización</label>
            <input type="text" name="sala" value="${record?.sala || ''}" placeholder="Ej: Sala 1, Sala de Operaciones A, Centro de Comando">
          </div>
        </div>
        <div style="background: rgba(var(--sim-cian-rgb),0.1); padding: 12px; border-radius: 4px; border-left: 3px solid var(--sim-cian);">
          <div style="font-size: 11px; color: var(--sim-cian); text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Estado</div>
          <div class="admin-form-group">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" name="activo" value="true" ${record?.activo !== false ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;">
              <span>Ejercicio Activo</span>
            </label>
            <div style="font-size: 10px; color: var(--sim-cian); margin-top: 8px; padding: 8px; background: rgba(var(--sim-cian-rgb),0.15); border-radius: 3px;">
              💡 Marca esta opción si el ejercicio está en curso. Desactívalo para "cerrar" la sesión sin eliminarla.
            </div>
          </div>
        </div>
      `,
    };
  }

  getAsignacionesForm(isEdit, record) {
    // Con un ejercicio en contexto solo tiene sentido asignar a alguien que
    // participe de él: asignarle una unidad a un participante es, justamente,
    // lo que mete esa unidad en el ejercicio.
    const participantes = this.data.participantes_contexto;
    const usuarios = participantes
      ? participantes.map(p => ({ id: p.usuario_id, nombre: p.nombre, usuario: p.usuario, bando: p.bando }))
      : (this.data.usuarios || []);
    // Las unidades van SIN acotar: si solo se ofrecieran las del ejercicio,
    // nunca se podría sumar una nueva.
    const unidades = this.data.unidades_todas || this.data.unidades || [];
    const nombreEjercicio = Catalogos.ejercicioActualNombre();
    // Una unidad la controla UN solo jugador por ejercicio: las que ya tienen
    // dueño se ofrecen deshabilitadas en vez de dejar crear una segunda
    // asignación que el modelo no admite.
    const tomadas = new Map(
      (this.data.asignaciones || [])
        .filter(a => !isEdit || String(a.id) !== String(record?.id))
        .map(a => [String(a.unidad_militar_id), a.usuario_nombre]),
    );

    return {
      title: isEdit ? 'Editar Asignación' : 'Nueva Asignación',
      description: isEdit
        ? `Editando asignación: <strong>${record?.usuario_nombre || 'Usuario'}</strong> → <strong>${record?.unidad_nombre || 'Unidad'}</strong><br>Modifica quién controla esta unidad militar.`
        : 'Asigna un usuario a una unidad militar. El usuario asignado podrá operar y controlar la unidad dentro de los ejercicios.'
          + (nombreEjercicio ? `<br>Solo se listan los participantes de <strong>${nombreEjercicio}</strong>.` : ''),
      fields: `
        <div style="background: rgba(var(--sim-oro-rgb),0.1); padding: 12px; border-radius: 4px; border-left: 3px solid var(--sim-oro);">
          <div style="font-size: 11px; color: var(--sim-oro); text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Relación Usuario-Unidad</div>
          <div class="admin-form-group">
            <label>Usuario *</label>
            <select name="usuario_id" required ${usuarios.length ? '' : 'disabled'}>
              <option value="">${usuarios.length ? 'Seleccionar usuario...' : '— No hay usuarios para asignar —'}</option>
              ${usuarios.map(u =>
                `<option value="${u.id}" ${String(record?.usuario_id) === String(u.id) ? 'selected' : ''}>${u.nombre} (${u.usuario})${u.bando ? ` — ${u.bando}` : ''}</option>`
              ).join('')}
            </select>
            ${usuarios.length ? '' : `
            <div style="font-size: 10px; color: var(--sim-rojo); margin-top: 8px; padding: 8px; background: rgba(var(--sim-rojo-rgb),0.12); border-radius: 3px;">
              ⚠ ${nombreEjercicio
                ? `<strong>${nombreEjercicio}</strong> todavía no tiene participantes: agregalos en la pestaña «Participantes».`
                : 'No hay usuarios cargados: creá uno en la pestaña «Usuarios».'}
            </div>`}
          </div>
          <div class="admin-form-group">
            <label>Unidad Militar *</label>
            <select name="unidad_militar_id" required ${unidades.length ? '' : 'disabled'}>
              <option value="">${unidades.length ? 'Seleccionar unidad...' : '— No hay unidades creadas —'}</option>
              ${unidades.map(u => {
                const dueno = tomadas.get(String(u.id));
                return `<option value="${u.id}"${String(record?.unidad_militar_id) === String(u.id) ? ' selected' : ''}${dueno ? ' disabled' : ''}>`
                  + `${u.nombre}${dueno ? ` — ya la controla ${dueno}` : ''}</option>`;
              }).join('')}
            </select>
            ${unidades.length ? `
            <div style="font-size: 10px; color: var(--sim-cian); margin-top: 8px; padding: 8px; background: rgba(var(--sim-cian-rgb),0.15); border-radius: 3px;">
              💡 Una unidad la controla <strong>un solo jugador por ejercicio</strong>. Las que ya
              tienen dueño${nombreEjercicio ? ` en ${nombreEjercicio}` : ''} aparecen deshabilitadas:
              para pasarla a otro jugador, primero eliminá la asignación existente.
            </div>` : `
            <div style="font-size: 10px; color: var(--sim-rojo); margin-top: 8px; padding: 8px; background: rgba(var(--sim-rojo-rgb),0.12); border-radius: 3px;">
              ⚠ Creá primero una unidad en la pestaña «Unidades».
            </div>`}
          </div>
        </div>
      `,
    };
  }

  getParticipantesForm(isEdit, record) {
    // ⚠️ El rol "usuario" se renombró a "jugador" (frontend.md, fase 1). Se
    // filtra por "no es administrador" para no depender del literal: el backend
    // rechaza con 400 a un administrador como participante.
    const jugadores = (this.data.usuarios || []).filter(u => u.rol !== 'administrador');
    const ejercicioElegido = record?.ejercicio_id ?? Catalogos.ejercicioActual();
    return {
      title: isEdit ? 'Editar Participante' : 'Agregar Participante',
      description: isEdit
        ? `Editando: <strong>${record?.usuario_nombre || 'Usuario'}</strong> en <strong>${record?.ejercicio_nombre || 'Ejercicio'}</strong><br>Cambia el bando o actualiza la participación del usuario en este ejercicio.`
        : 'Agrega un usuario (no-administrador) a un ejercicio con un bando específico. Un usuario solo puede estar una vez por ejercicio, pero puede cambiar de bando.',
      fields: `
        <div style="background: rgba(var(--sim-oro-rgb),0.1); padding: 12px; border-radius: 4px; margin-bottom: 12px; border-left: 3px solid var(--sim-oro);">
          <div style="font-size: 11px; color: var(--sim-oro); text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Información de Participación</div>
          <div class="admin-form-group">
            <label>Ejercicio *</label>
            <select name="ejercicio_id" required>
              <option value="">Seleccionar ejercicio...</option>
              ${(this.data.ejercicios || []).map(e =>
                `<option value="${e.id}" ${String(ejercicioElegido) === String(e.id) ? 'selected' : ''}>${e.nombre}${e.sala ? ` (${e.sala})` : ''}</option>`
              ).join('')}
            </select>
          </div>
          <div class="admin-form-group">
            <label>Usuario (no-administrador) *</label>
            <select name="usuario_id" required ${jugadores.length ? '' : 'disabled'}>
              <option value="">${jugadores.length ? 'Seleccionar usuario...' : '— No hay jugadores dados de alta —'}</option>
              ${jugadores.map(u =>
                `<option value="${u.id}" ${String(record?.usuario_id) === String(u.id) ? 'selected' : ''}>${u.nombre} (${u.usuario})</option>`
              ).join('')}
            </select>
            ${jugadores.length ? '' : `
            <div style="font-size: 10px; color: var(--sim-rojo); margin-top: 8px; padding: 8px; background: rgba(var(--sim-rojo-rgb),0.12); border-radius: 3px;">
              ⚠ Solo pueden participar los usuarios con rol <strong>jugador</strong>. Creá uno en la pestaña «Usuarios» y volvé acá.
            </div>`}
          </div>
        </div>
        <div style="background: rgba(var(--sim-cian-rgb),0.1); padding: 12px; border-radius: 4px; border-left: 3px solid var(--sim-cian);">
          <div style="font-size: 11px; color: var(--sim-cian); text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Bando/Facción</div>
          <div class="admin-form-group">
            <label>Bando *</label>
            <select name="bando" required>
              ${Sidc.opcionesBando(record?.bando, { vacio: 'Seleccionar bando...' })}
            </select>
          </div>
          <div style="font-size: 10px; color: var(--sim-cian); margin-top: 8px; padding: 8px; background: rgba(var(--sim-cian-rgb),0.15); border-radius: 3px;">
            💡 Solo hay dos bandos: <strong>azul</strong> y <strong>rojo</strong>. El bando define
            la afiliación del símbolo táctico (dígito 4 del SIDC) de todo lo que controle este usuario.
          </div>
        </div>
      `,
    };
  }

  async handleFormSubmit(e) {
    e.preventDefault();
    const formData = new FormData(document.getElementById('admin-form'));
    const data = Object.fromEntries(formData);

    // Convertir tipos de datos según la tabla
    if (this.currentTable === 'ejercicios') {
      data.activo = data.activo === 'true' ? true : false;
    }

    // Convertir IDs FK a números y remover campos vacíos
    const idFields = ['unidad_militar_base_id', 'usuario_id', 'ejercicio_id', 'unidad_militar_id',
      'jugador_asignado_id'];
    const numericFields = ['quantity', 'pos_x', 'pos_y', 'copias'];

    for (const field of idFields) {
      if (data[field] && data[field] !== '') {
        data[field] = parseInt(data[field], 10);
      } else if (data[field] === '') {
        delete data[field];
      }
    }

    for (const field of numericFields) {
      if (data[field] && data[field] !== '') {
        data[field] = field === 'quantity' || field === 'copias' ?
          parseInt(data[field], 10) :
          parseFloat(data[field]);
      } else if (data[field] === '') {
        delete data[field];
      }
    }

    // Remover campos vacíos de texto
    for (const key in data) {
      if (data[key] === '') {
        delete data[key];
      }
    }

    if (this.editingId) {
      await this.updateRecord(this.currentTable, this.editingId, data);
    } else {
      await this.createRecord(this.currentTable, data);
    }

    this.closeForm();
    this.loadTable(this.currentTable);
  }

  async createRecord(table, data) {
    try {
      const token = Session.getToken();
      let endpoint = this.getEndpoint(table, 'POST');

      // El alta de usuario NO es `POST /usuarios` (no existe): es
      // `POST /auth/register`, que además ignora `rol` — siempre nace jugador.
      // Si el admin pidió otro rol se corrige con un PUT posterior.
      let rolPedido = null;
      let jugadorDeLaUnidad = null;
      if (table === 'usuarios') {
        endpoint = '/auth/register';
        rolPedido = data.rol === 'administrador' ? 'administrador' : null;
        data = {
          usuario: data.usuario,
          password: data.password,
          nombre: data.nombre,
          ...(data.grado ? { grado: data.grado } : {}),
        };
      } else if (table === 'unidades') {
        // `jugador_asignado_id` no es una columna de `unidad_militar`: se
        // transforma al nombre que espera POST /unidades para que la unidad
        // nazca con controlador dentro de la misma transacción.
        jugadorDeLaUnidad = data.jugador_asignado_id ?? null;
        delete data.jugador_asignado_id;
        if (jugadorDeLaUnidad !== null && jugadorDeLaUnidad !== '') {
          data.usuarioId = Number(jugadorDeLaUnidad);
        }
      } else if (table === 'participantes') {
        const ejercicioId = data.ejercicio_id;
        endpoint = `/ejercicios/${ejercicioId}/participantes`;
        data = {
          usuarioId: data.usuario_id,
          bando: data.bando,
        };
      } else if (table === 'asignaciones') {
        const unidadId = data.unidad_militar_id;
        // Invariante del modelo: una unidad, un solo jugador por ejercicio. El
        // select ya deshabilita las tomadas; esto cubre el caso de que la lista
        // esté desactualizada respecto de lo que hay en la base.
        const yaAsignada = (this.data.asignaciones || [])
          .find(a => String(a.unidad_militar_id) === String(unidadId));
        if (yaAsignada) {
          throw new Error(
            `Esa unidad ya la controla ${yaAsignada.usuario_nombre}. Una unidad solo puede `
            + 'tener un jugador por ejercicio: eliminá la asignación existente antes de crear otra.',
          );
        }
        endpoint = `/unidades/${unidadId}/usuarios`;
        data = {
          usuarioId: data.usuario_id,
        };
      }

      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Error ${response.status}`);
      }

      // El body se consume UNA sola vez: `response.json()` no se puede repetir.
      const creado = await response.json().catch(() => ({}));

      // `/auth/register` no deja elegir el rol: se promueve con un PUT.
      if (rolPedido) {
        const promocion = await fetch(`${API_BASE}/usuarios/${creado.id}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ rol: rolPedido }),
        });
        if (!promocion.ok) {
          throw new Error('El usuario se creó como jugador, pero no se pudo promoverlo a administrador.');
        }
      }

      // Cambió el cruce unidad ↔ usuario que decide qué unidades ve el ejercicio.
      if (table === 'asignaciones' || table === 'unidades') this.invalidarControladores();
      if (table === 'usuarios') this.data.usuarios = null;   // que se relea con el nuevo
      alert('Registro creado exitosamente');
    } catch (error) {
      alert(`Error al crear registro: ${error.message}`);
      console.error(error);
    }
  }

  async updateRecord(table, id, data) {
    try {
      const token = Session.getToken();
      let endpoint = this.getEndpoint(table, 'PUT', id);

      if (table === 'participantes') {
        const record = this.data.participantes.find(p => String(p.id) === String(id));
        if (!record) throw new Error('Participante no encontrado');
        const ejercicioId = record.ejercicio_id;
        const usuarioId = record.usuario_id;
        endpoint = `/ejercicios/${ejercicioId}/participantes/${usuarioId}`;
        data = {
          bando: data.bando,
        };
      }

      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Error ${response.status}`);
      }
      alert('Registro actualizado exitosamente');
    } catch (error) {
      alert(`Error al actualizar registro: ${error.message}`);
      console.error(error);
    }
  }

  /**
   * Unidades del ejercicio en vivo que van a caer con este borrado. Para
   * `unidades` es ella misma; para `unidades-base` son todas sus instancias,
   * porque el borrado de una plantilla cascadea (ver frontend.md, fase 2).
   */
  unidadesAfectadas(table, id) {
    if (!Store.ejercicioId) return [];
    if (table === 'unidades') {
      const item = Store.obtener('unidad', id);
      return item ? [item] : [];
    }
    if (table === 'unidades-base') {
      return Store.todas().filter(item =>
        item.tipo === 'unidad' && String(item.entidad.unidad_militar_base_id) === String(id));
    }
    return [];
  }

  async deleteRecord(table, id) {
    // Los borrados cascadean y la API no frena: hay que decir el alcance.
    const enElMapa = this.unidadesAfectadas(table, id);
    let aviso = '¿Confirmar eliminación?';
    if (table === 'unidades-base') {
      aviso += '\n\nBorrar una plantilla borra TODAS las unidades creadas desde ella,'
        + ' con sus documentos y asignaciones.';
    }
    if (enElMapa.length) {
      aviso += `\n\nSe ${enElMapa.length === 1 ? 'quita' : 'quitan'} del mapa del ejercicio en curso: `
        + enElMapa.map(i => i.entidad.nombre || `unidad ${i.id}`).join(', ') + '.';
    }
    if (!confirm(aviso)) return;

    try {
      const token = Session.getToken();
      let endpoint = this.getEndpoint(table, 'DELETE', id);

      if (table === 'participantes') {
        const record = this.data.participantes.find(p => String(p.id) === String(id));
        if (!record) throw new Error('Participante no encontrado');
        const ejercicioId = record.ejercicio_id;
        const usuarioId = record.usuario_id;
        endpoint = `/ejercicios/${ejercicioId}/participantes/${usuarioId}`;
      } else if (table === 'asignaciones') {
        const record = this.data.asignaciones.find(a => String(a.id) === String(id));
        if (!record) throw new Error('Asignación no encontrada');
        const unidadId = record.unidad_militar_id;
        const usuarioId = record.usuario_id;
        endpoint = `/unidades/${unidadId}/usuarios/${usuarioId}`;
      }

      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Error ${response.status}`);
      }
      if (table === 'asignaciones' || table === 'unidades') this.invalidarControladores();
      await this.bajaEnElEjercicio(enElMapa);
      alert('Registro eliminado exitosamente');
      this.loadTable(table);
    } catch (error) {
      alert(`Error al eliminar registro: ${error.message}`);
      console.error(error);
    }
  }

  /**
   * Saca del ejercicio en curso las unidades que se acaban de borrar de la base.
   *
   * ⚠️ El backend NO tiene un evento de baja de unidad: el socket expone
   * `unidad:crear_en_ejercicio` y `unidad:modificar`, pero no un `eliminar`
   * (ver la tabla de eventos en frontend.md, fase 8). Lo más cerca que se puede
   * llegar sin tocar el backend es marcarla `visible: false`, que está en la
   * lista blanca de `unidad:modificar`: deja de dibujarse, de detectar y de
   * poder ser fijada como blanco en TODOS los clientes, y queda así en el
   * próximo checkpoint. La fila ya no existe en la base, así que la próxima vez
   * que el estado se genere desde la base la unidad no vuelve.
   */
  async bajaEnElEjercicio(items) {
    if (!items.length) return;

    for (const item of items) {
      if (Socket.conectado()) {
        try {
          await Socket.emitir('unidad:modificar', {
            ejercicio_id: Store.ejercicioId,
            entidad_id: item.id,
            visible: false,
          });
        } catch (e) {
          // La unidad ya no está en la base: que el servidor rechace el
          // modificar es esperable. El mapa local se corrige igual.
          console.warn(`No se pudo avisar la baja de la unidad ${item.id}:`, e.message);
        }
      }
      Store.quitarUnidad(item.id);   // dispara "estado" → el mapa se redibuja
    }
  }

  getEndpoint(table, method = 'GET', id = null, extraData = null) {
    const endpoints = {
      usuarios: { base: '/usuarios', hasId: true },
      'unidades-base': { base: '/unidades/base', hasId: true },
      unidades: { base: '/unidades', hasId: true },
      ejercicios: { base: '/ejercicios', hasId: true },
      asignaciones: { base: '/unidades', hasId: true, special: 'usuarios' },
      participantes: { base: '/ejercicios', hasId: true, special: 'participantes' },
    };

    const config = endpoints[table];
    if (!config) return '';

    if (table === 'asignaciones') {
      if (method === 'POST') return `${config.base}/:unidadId/usuarios`;
      if (method === 'DELETE') return `${config.base}/:unidadId/usuarios/:usuarioId`;
    }

    if (table === 'participantes') {
      if (method === 'POST') return `${config.base}/:ejercicioId/participantes`;
      if (method === 'PUT') return `${config.base}/:ejercicioId/participantes/:usuarioId`;
      if (method === 'DELETE') return `${config.base}/:ejercicioId/participantes/:usuarioId`;
      return `${config.base}/:ejercicioId/participantes`;
    }

    if (config.hasId && id) {
      return `${config.base}/${id}`;
    }
    return config.base;
  }

  closeForm() {
    document.getElementById('admin-form-modal')?.classList.remove('active');
    document.getElementById('admin-form-overlay')?.classList.remove('active');
    document.getElementById('admin-form').reset();
    this.editingId = null;
  }

  close() {
    document.getElementById('admin-modal')?.classList.remove('active');
  }
}

window.adminManager = new AdminManager();

export default AdminManager;
