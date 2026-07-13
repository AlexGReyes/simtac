import Session from './session.js';

const API_BASE = 'http://node.localhost';

class AdminManager {
  constructor() {
    this.currentTable = 'usuarios';
    this.editingId = null;
    this.data = {};
  }

  async init() {
    const user = Session.getUser();
    if (!user || user.rol !== 'administrador') {
      console.log('Acceso denegado: no es administrador');
      return false;
    }

    this.setupEventListeners();
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
      usuarios: 'Gestiona los usuarios del sistema, sus permisos y roles. Aquí puedes crear nuevos usuarios, asignar roles (administrador/usuario) y gestionar sus datos personales.',
      'unidades-base': 'Crea y mantiene las plantillas de unidades militares con sus códigos SIDC. Estas plantillas se utilizan como base para crear instancias de unidades en los ejercicios.',
      unidades: 'Administra las instancias de unidades militares que participan en los ejercicios. Puedes crear nuevas unidades basadas en las plantillas disponibles y establecer sus posiciones en el mapa.',
      ejercicios: 'Crea y gestiona sesiones de simulación. Cada ejercicio es una sesión independiente donde se pueden asignar unidades militares y ejecutar operaciones tácticas.',
      asignaciones: 'Asigna usuarios a unidades militares. Define quién controla cada unidad en los ejercicios, estableciendo la relación entre usuarios y unidades.',
      participantes: 'Asigna usuarios no-administradores a ejercicios con un bando específico (azul, rojo, etc.). Un usuario solo puede participar una vez en cada ejercicio, pero puede cambiar de bando.',
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
    }
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
      const token = Session.getToken();
      const response = await fetch(`${API_BASE}/unidades`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) throw new Error(`Error ${response.status}`);
      const unidades = await response.json();
      this.data.unidades = unidades;
      this.renderUnidadesTable(unidades);
    } catch (error) {
      console.error('Error loading unidades:', error);
    }
  }

  renderUnidadesTable(unidades) {
    const tbody = document.querySelector('#unidades-table tbody');
    if (!tbody) return;

    tbody.innerHTML = unidades.map(u => `
      <tr>
        <td>${u.id}</td>
        <td>${u.nombre}</td>
        <td><code>${u.sidc}</code></td>
        <td>${u.tipo || '-'}</td>
        <td>${u.pos_x ? u.pos_x.toFixed(2) : '-'}</td>
        <td>${u.pos_y ? u.pos_y.toFixed(2) : '-'}</td>
        <td>
          <button class="admin-edit-btn" onclick="adminManager.openForm('unidades', '${u.id}')">Editar</button>
          <button class="admin-delete-btn" onclick="adminManager.deleteRecord('unidades', '${u.id}')">Eliminar</button>
        </td>
      </tr>
    `).join('');
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
      this.data.asignaciones = [];
      this.renderAsignacionesTable([]);
    } catch (error) {
      console.error('Error loading asignaciones:', error);
    }
  }

  renderAsignacionesTable(asignaciones) {
    const tbody = document.querySelector('#asignaciones-table tbody');
    if (!tbody) return;

    tbody.innerHTML = asignaciones.map(a => `
      <tr>
        <td>${a.id}</td>
        <td>${a.usuario_nombre || '-'}</td>
        <td>${a.unidad_nombre || '-'}</td>
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
      const ejercicios = await response.json();

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

  openForm(table, id = null) {
    this.editingId = id;
    const modal = document.getElementById('admin-form-modal');
    const overlay = document.getElementById('admin-form-overlay');
    const title = document.getElementById('admin-form-title');
    const fields = document.getElementById('admin-form-fields');

    const formConfig = this.getFormConfig(table, id);
    title.innerHTML = `
      <div style="margin-bottom: 8px;">${formConfig.title}</div>
      ${formConfig.description ? `<div class="admin-form-subtitle">${formConfig.description}</div>` : ''}
    `;
    fields.innerHTML = formConfig.fields;

    modal?.classList.add('active');
    overlay?.classList.add('active');
  }

  getFormConfig(table, id) {
    const isEdit = !!id;
    const record = isEdit ? this.data[table.replace('-', '_')]?.find(r => r.id === id) : null;

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
        <div style="background: rgba(212,175,55,0.1); padding: 12px; border-radius: 4px; margin-bottom: 12px; border-left: 3px solid #d4af37;">
          <div style="font-size: 11px; color: #d4af37; text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Credenciales de Acceso</div>
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
        <div style="background: rgba(160,212,232,0.1); padding: 12px; border-radius: 4px; margin-bottom: 12px; border-left: 3px solid #a0d4e8;">
          <div style="font-size: 11px; color: #a0d4e8; text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Información Personal</div>
          <div class="admin-form-group">
            <label>Nombre Completo</label>
            <input type="text" name="nombre" value="${record?.nombre || ''}" required placeholder="Ej: Juan Pérez García">
          </div>
          <div class="admin-form-group">
            <label>Grado Militar</label>
            <input type="text" name="grado" value="${record?.grado || ''}" placeholder="Ej: Capitán, Mayor, Teniente">
          </div>
        </div>
        <div style="background: rgba(255,107,107,0.1); padding: 12px; border-radius: 4px; border-left: 3px solid #ff6b6b;">
          <div style="font-size: 11px; color: #ff6b6b; text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Permisos del Sistema</div>
          <div class="admin-form-group">
            <label>Rol</label>
            <select name="rol" ${!isEdit || Session.getUser().id !== record?.id ? '' : 'disabled'}>
              <option value="usuario" ${record?.rol === 'usuario' ? 'selected' : ''}>👤 Usuario (operador)</option>
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
        <div style="background: rgba(212,175,55,0.1); padding: 12px; border-radius: 4px; margin-bottom: 12px; border-left: 3px solid #d4af37;">
          <div style="font-size: 11px; color: #d4af37; text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Identificación</div>
          <div class="admin-form-group">
            <label>SIDC (Código MIL-STD-2525/APP-6) *</label>
            <input type="text" name="sidc" value="${record?.sidc || ''}" required maxlength="30" placeholder="SFGPUCI---****X">
          </div>
          <div class="admin-form-group">
            <label>Nombre de la Plantilla *</label>
            <input type="text" name="nombre" value="${record?.nombre || ''}" required placeholder="Ej: Compañía de Infantería, Pelotón de Carros">
          </div>
        </div>
        <div style="background: rgba(160,212,232,0.1); padding: 12px; border-radius: 4px; border-left: 3px solid #a0d4e8;">
          <div style="font-size: 11px; color: #a0d4e8; text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Características</div>
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
    return {
      title: isEdit ? 'Editar Unidad' : 'Nueva Unidad',
      description: isEdit
        ? `Editando unidad: <strong>${record?.nombre || 'Unidad'}</strong><br>Modifica los datos de esta instancia de unidad, incluyendo su plantilla, posición en el mapa y ~34 propiedades tácticas MIL-STD-2525/APP-6.`
        : 'Crea una nueva instancia de unidad militar basada en una plantilla. Selecciona la plantilla base, asigna un nombre y establece la posición inicial en el mapa.',
      fields: `
        <div style="background: rgba(212,175,55,0.1); padding: 12px; border-radius: 4px; margin-bottom: 12px; border-left: 3px solid #d4af37;">
          <div style="font-size: 11px; color: #d4af37; text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Información Básica</div>
          <div class="admin-form-group">
            <label>Nombre de la Unidad *</label>
            <input type="text" name="nombre" value="${record?.nombre || ''}" required placeholder="Ej: Alfa 1, Bravo Company, Zapadores 3">
          </div>
          <div class="admin-form-group">
            <label>Plantilla Base (SIDC) *</label>
            <select name="unidad_militar_base_id" required>
              <option value="">Seleccionar plantilla...</option>
              ${(this.data.unidades_base || []).map(u =>
                `<option value="${u.id}" ${record?.unidad_militar_base_id === u.id ? 'selected' : ''}>${u.nombre} (${u.sidc})</option>`
              ).join('')}
            </select>
          </div>
          <div class="admin-form-group">
            <label>Tipo</label>
            <input type="text" name="tipo" value="${record?.tipo || ''}" placeholder="Ej: Infantería, Blindados">
          </div>
          <div class="admin-form-group">
            <label>Posición X (Longitud)</label>
            <input type="number" name="pos_x" value="${record?.pos_x || ''}" step="0.0001" placeholder="-71.0589">
          </div>
          <div class="admin-form-group">
            <label>Posición Y (Latitud)</label>
            <input type="number" name="pos_y" value="${record?.pos_y || ''}" step="0.0001" placeholder="42.3601">
          </div>
        </div>
        <fieldset style="border: 1px solid rgba(212,175,55,0.3); padding: 12px; border-radius: 4px; margin-top: 12px;">
          <legend style="color: #d4af37; font-size: 11px; font-weight: 700; text-transform: uppercase; padding: 0 8px;">Modificadores MIL-STD-2525/APP-6 (~34 campos)</legend>

          <div style="font-size: 10px; color: #a0d4e8; margin-bottom: 12px; padding: 8px; background: rgba(160,212,232,0.1); border-radius: 3px;">Todos los campos son opcionales. Completa solo los que apliquen a tu unidad.</div>

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
        </fieldset>
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
        <div style="background: rgba(212,175,55,0.1); padding: 12px; border-radius: 4px; margin-bottom: 12px; border-left: 3px solid #d4af37;">
          <div style="font-size: 11px; color: #d4af37; text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Información del Ejercicio</div>
          <div class="admin-form-group">
            <label>Nombre del Ejercicio *</label>
            <input type="text" name="nombre" value="${record?.nombre || ''}" required placeholder="Ej: Operación Centinela, Ejercicio Conjunto 2026">
          </div>
          <div class="admin-form-group">
            <label>Sala/Localización</label>
            <input type="text" name="sala" value="${record?.sala || ''}" placeholder="Ej: Sala 1, Sala de Operaciones A, Centro de Comando">
          </div>
        </div>
        <div style="background: rgba(160,212,232,0.1); padding: 12px; border-radius: 4px; border-left: 3px solid #a0d4e8;">
          <div style="font-size: 11px; color: #a0d4e8; text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Estado</div>
          <div class="admin-form-group">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" name="activo" value="true" ${record?.activo !== false ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;">
              <span>Ejercicio Activo</span>
            </label>
            <div style="font-size: 10px; color: #a0d4e8; margin-top: 8px; padding: 8px; background: rgba(160,212,232,0.15); border-radius: 3px;">
              💡 Marca esta opción si el ejercicio está en curso. Desactívalo para "cerrar" la sesión sin eliminarla.
            </div>
          </div>
        </div>
      `,
    };
  }

  getAsignacionesForm(isEdit, record) {
    return {
      title: isEdit ? 'Editar Asignación' : 'Nueva Asignación',
      description: isEdit
        ? `Editando asignación: <strong>${record?.usuario_nombre || 'Usuario'}</strong> → <strong>${record?.unidad_nombre || 'Unidad'}</strong><br>Modifica quién controla esta unidad militar.`
        : 'Asigna un usuario a una unidad militar. El usuario asignado podrá operar y controlar la unidad dentro de los ejercicios.',
      fields: `
        <div style="background: rgba(212,175,55,0.1); padding: 12px; border-radius: 4px; border-left: 3px solid #d4af37;">
          <div style="font-size: 11px; color: #d4af37; text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Relación Usuario-Unidad</div>
          <div class="admin-form-group">
            <label>Usuario *</label>
            <select name="usuario_id" required>
              <option value="">Seleccionar usuario...</option>
              ${(this.data.usuarios || []).map(u =>
                `<option value="${u.id}" ${record?.usuario_id === u.id ? 'selected' : ''}>${u.nombre} (${u.usuario})</option>`
              ).join('')}
            </select>
          </div>
          <div class="admin-form-group">
            <label>Unidad Militar *</label>
            <select name="unidad_militar_id" required>
              <option value="">Seleccionar unidad...</option>
              ${(this.data.unidades || []).map(u =>
                `<option value="${u.id}" ${record?.unidad_militar_id === u.id ? 'selected' : ''}>${u.nombre}</option>`
              ).join('')}
            </select>
          </div>
        </div>
      `,
    };
  }

  getParticipantesForm(isEdit, record) {
    return {
      title: isEdit ? 'Editar Participante' : 'Agregar Participante',
      description: isEdit
        ? `Editando: <strong>${record?.usuario_nombre || 'Usuario'}</strong> en <strong>${record?.ejercicio_nombre || 'Ejercicio'}</strong><br>Cambia el bando o actualiza la participación del usuario en este ejercicio.`
        : 'Agrega un usuario (no-administrador) a un ejercicio con un bando específico. Un usuario solo puede estar una vez por ejercicio, pero puede cambiar de bando.',
      fields: `
        <div style="background: rgba(212,175,55,0.1); padding: 12px; border-radius: 4px; margin-bottom: 12px; border-left: 3px solid #d4af37;">
          <div style="font-size: 11px; color: #d4af37; text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Información de Participación</div>
          <div class="admin-form-group">
            <label>Ejercicio *</label>
            <select name="ejercicio_id" required>
              <option value="">Seleccionar ejercicio...</option>
              ${(this.data.ejercicios || []).map(e =>
                `<option value="${e.id}" ${record?.ejercicio_id === e.id ? 'selected' : ''}>${e.nombre}${e.sala ? ` (${e.sala})` : ''}</option>`
              ).join('')}
            </select>
          </div>
          <div class="admin-form-group">
            <label>Usuario (no-administrador) *</label>
            <select name="usuario_id" required>
              <option value="">Seleccionar usuario...</option>
              ${(this.data.usuarios || []).filter(u => u.rol === 'usuario').map(u =>
                `<option value="${u.id}" ${record?.usuario_id === u.id ? 'selected' : ''}>${u.nombre} (${u.usuario})</option>`
              ).join('')}
            </select>
          </div>
        </div>
        <div style="background: rgba(160,212,232,0.1); padding: 12px; border-radius: 4px; border-left: 3px solid #a0d4e8;">
          <div style="font-size: 11px; color: #a0d4e8; text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Bando/Facción</div>
          <div class="admin-form-group">
            <label>Bando *</label>
            <input type="text" name="bando" value="${record?.bando || ''}" required placeholder="Ej: azul, rojo, verde, independiente" maxlength="50">
          </div>
          <div style="font-size: 10px; color: #a0d4e8; margin-top: 8px; padding: 8px; background: rgba(160,212,232,0.15); border-radius: 3px;">
            💡 El bando es texto libre. Ejemplos: "azul", "rojo", "ejército", "fuerzas especiales", etc.
          </div>
        </div>
      `,
    };
  }

  async handleFormSubmit(e) {
    e.preventDefault();
    const formData = new FormData(document.getElementById('admin-form'));
    const data = Object.fromEntries(formData);

    if (this.currentTable === 'ejercicios') {
      data.activo = data.activo === 'true' ? true : false;
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

      if (table === 'participantes') {
        const ejercicioId = data.ejercicio_id;
        endpoint = `/ejercicios/${ejercicioId}/participantes`;
        data = {
          usuarioId: data.usuario_id,
          bando: data.bando,
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
        const record = this.data.participantes.find(p => p.id === id);
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

  async deleteRecord(table, id) {
    if (!confirm('¿Confirmar eliminación?')) return;

    try {
      const token = Session.getToken();
      let endpoint = this.getEndpoint(table, 'DELETE', id);

      if (table === 'participantes') {
        const record = this.data.participantes.find(p => p.id === id);
        if (!record) throw new Error('Participante no encontrado');
        const ejercicioId = record.ejercicio_id;
        const usuarioId = record.usuario_id;
        endpoint = `/ejercicios/${ejercicioId}/participantes/${usuarioId}`;
      }

      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Error ${response.status}`);
      }
      alert('Registro eliminado exitosamente');
      this.loadTable(table);
    } catch (error) {
      alert(`Error al eliminar registro: ${error.message}`);
      console.error(error);
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
