// Importar módulos
import Session from './session.js';
import Auth from './auth.js';
import LoginUI from './login-ui.js';

// Variables globales
window.mapState = {
  currentZoom: 14,
  mouseCoordinates: { lon: 0, lat: 0, x: 0, y: 0 },
  ratio: window.devicePixelRatio || 1,
};

// Socket.IO instance
let socket = null;

// Función para conectar socket después de autenticación
function conectarSocket() {
  const token = Session.getToken();
  if (!token) return;

  socket = io('http://node.localhost', {
    auth: { token },
  });

  socket.on('connect', () => {
    console.log('✓ Conectado al servidor (Socket.IO)');
  });

  socket.on('connect_error', (err) => {
    console.error('✗ Error de conexión Socket:', err.message);
    if (err.message === 'Token inválido o expirado') {
      logout();
    }
  });

  socket.on('disconnect', () => {
    console.log('✓ Desconectado del servidor');
  });

  // Listeners para chat y documentos
  socket.on('chat:message', (msg) => {
    console.log('Nuevo mensaje:', msg);
    // Aquí se agregará lógica de actualización de UI
  });

  socket.on('documento:nuevo', (doc) => {
    console.log('Nuevo documento:', doc);
    // Aquí se agregará lógica de actualización de UI
  });
}

// Función para desloguear
function logout() {
  if (socket) {
    socket.disconnect();
  }
  Session.clear();
  LoginUI.hideApp();
  LoginUI.showLogin();
  location.reload();
}

// Hacer funciones disponibles globalmente
window.logout = logout;

// Función para inicializar app después de login
window.inicializarAppAfterLogin = async function() {
  console.log('✓ Inicializando aplicación después de login...');

  // Conectar socket
  conectarSocket();

  // Esperar a que el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializarApp);
  } else {
    inicializarApp();
  }
};

// Función para actualizar los relojes
function actualizarRelojes() {
  const ahora = new Date();
  const utcTime = new Date(ahora.getTime() + ahora.getTimezoneOffset() * 60000);

  const localTimeStr = ahora.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const localDateStr = ahora.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const utcTimeStr = utcTime.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const utcDateStr = utcTime.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const localTimeEl = document.getElementById('local-time');
  const localDateEl = document.getElementById('local-date');
  const utcTimeEl = document.getElementById('utc-time');
  const utcDateEl = document.getElementById('utc-date');

  if (localTimeEl) localTimeEl.textContent = localTimeStr;
  if (localDateEl) localDateEl.textContent = localDateStr;
  if (utcTimeEl) utcTimeEl.textContent = utcTimeStr;
  if (utcDateEl) utcDateEl.textContent = utcDateStr;
}

// Función para actualizar información del usuario en header
function actualizarUserSection() {
  const user = Session.getUser();
  if (!user) return;

  const avatarEl = document.querySelector('.avatar');
  const usernameEl = document.querySelector('.username');
  const roleEl = document.querySelector('.role');

  if (avatarEl) {
    const initials = user.nombre
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
    avatarEl.textContent = initials;
  }

  if (usernameEl) usernameEl.textContent = user.nombre;
  if (roleEl) roleEl.textContent = user.grado || 'Operador';
}

// Inicialización principal
async function inicializar() {
  console.log('=== INICIANDO SIMTAC ===');

  // Verificar si hay sesión activa
  if (!Session.isAuthenticated()) {
    console.log('✓ Sin sesión - Mostrando login');
    await LoginUI.init();
    return;
  }

  console.log('✓ Sesión activa - Inicializando aplicación');

  // Mostrar app y ocultar login
  LoginUI.showApp();

  // Conectar socket
  conectarSocket();

  // Esperar a que el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializarApp);
  } else {
    inicializarApp();
  }
}

async function inicializarApp() {
  console.log('=== INICIALIZANDO COMPONENTES DE LA APP ===');
  console.log('window.__TAURI__ disponible:', !!window.__TAURI__);
  console.log('milsymbol (ms) disponible:', typeof ms !== 'undefined');
  console.log('OpenLayers (ol) disponible:', typeof ol !== 'undefined');

  // Actualizar información del usuario
  actualizarUserSection();

  // Configurar botón de logout
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', logout);
  }

  // Crear mapa
  const map = new ol.Map({
    target: 'map-container',
    layers: [
      new ol.layer.Tile({
        source: new ol.source.OSM(),
      }),
    ],
    view: new ol.View({
      center: ol.proj.fromLonLat([-71.0589, 42.3601]),
      zoom: 14,
    }),
  });

  console.log('✓ Mapa creado exitosamente');

  // Actualizar relojes inmediatamente y cada segundo
  actualizarRelojes();
  setInterval(actualizarRelojes, 1000);

  // Configurar listeners del mapa
  configurarListenersMapa(map);

  // Inicializar componentes
  inicializarModalPanelUnidad();
  inicializarMenuUnidad();
  inicializarChat();
  inicializarDocumentos();

  // Cargar unidades
  await cargarUnidades(map);
}

// ===== FUNCIONES EXISTENTES (adaptar para nueva estructura) =====

function configurarListenersMapa(map) {
  const view = map.getView();
  const zoomElement = document.getElementById('zoom-level');
  const coordinatesElement = document.getElementById('mouse-coordinates');

  view.on('change:resolution', () => {
    const zoom = view.getZoom();
    window.mapState.currentZoom = zoom;
    if (zoomElement) zoomElement.textContent = `Zoom: ${zoom.toFixed(2)}`;
  });

  map.on('pointermove', (evt) => {
    const coordinate = map.getEventCoordinate(evt.originalEvent);
    const lonLat = ol.proj.toLonLat(coordinate);

    window.mapState.mouseCoordinates = {
      lon: lonLat[0],
      lat: lonLat[1],
      x: coordinate[0],
      y: coordinate[1],
    };

    if (coordinatesElement) {
      coordinatesElement.textContent = `Coordenadas: ${lonLat[0].toFixed(4)}°, ${lonLat[1].toFixed(4)}°`;
    }
  });

  if (zoomElement) {
    zoomElement.textContent = `Zoom: ${view.getZoom().toFixed(2)}`;
  }

  console.log('✓ Listeners del mapa configurados');
}

async function cargarUnidades(map) {
  try {
    console.log('1. Iniciando carga de unidades...');
    console.log('2. Verificando window.__TAURI__:', typeof window.__TAURI__);

    const { invoke } = window.__TAURI__.core;
    console.log('3. Función invoke disponible:', typeof invoke);

    const estado = await invoke('cargar_estado_actual');
    console.log('4. Estado cargado desde Rust:', estado);

    const todasLasUnidades = [
      ...estado.unidadesRojas,
      ...estado.unidadesAzules,
      ...estado.unidadesNeutrales,
    ];
    console.log('5. Total de unidades:', todasLasUnidades.length);

    const vectorSource = new ol.source.Vector();
    console.log('6. Vector source creado');

    todasLasUnidades.forEach((unidad, index) => {
      console.log(`   Procesando unidad ${index + 1}:`, unidad);

      try {
        console.log(`   - SIDC: ${unidad.sidc}`);
        console.log(`   - Verificando ms.Symbol:`, typeof ms, typeof ms.Symbol);

        const simbolo = new ms.Symbol(unidad.SIDC, {
          size: 35 * window.mapState.ratio,
        });

        const feature = new ol.Feature({
          geometry: new ol.geom.Point(
            ol.proj.fromLonLat(unidad.posicion)
          ),
          nombre: unidad.id,
          sidc: unidad.sidc,
          personal: unidad.personal,
          ataque: unidad.ataque,
          defensa: unidad.defensa,
        });

        const canvas = simbolo.asCanvas();

        const style = new ol.style.Style({
          image: new ol.style.Icon({
            img: canvas,
            scale: 1 / window.mapState.ratio,
            anchor: [simbolo.getAnchor().x, simbolo.getAnchor().y],
            anchorXUnits: 'pixels',
            anchorYUnits: 'pixels',
            imgSize: canvas ? [canvas.width, canvas.height] : undefined,
          }),
        });

        feature.setStyle(style);
        vectorSource.addFeature(feature);
        console.log(`   - Feature agregado al vector source`);
      } catch (unitError) {
        console.error(`   ERROR procesando unidad ${index}:`, unitError);
      }
    });

    const vectorLayer = new ol.layer.Vector({
      source: vectorSource,
      title: 'Unidades Militares',
    });

    map.addLayer(vectorLayer);
    console.log('7. Capa de vector agregada al mapa');
    console.log(`✓ Cargadas ${todasLasUnidades.length} unidades en el mapa`);

    configurarClickEnUnidades(map, vectorLayer);
  } catch (error) {
    console.error('✗ Error al cargar unidades:', error);
    console.error('   Stack:', error.stack);
  }
}

function configurarClickEnUnidades(map, vectorLayer) {
  map.on('click', (evt) => {
    const feature = map.forEachFeatureAtPixel(evt.pixel, (feature) => {
      return feature;
    });

    if (feature && vectorLayer.getSource().getFeatures().includes(feature)) {
      const unidadNombre = feature.get('nombre');
      mostrarMenuUnidad(unidadNombre, feature);
      console.log('Unidad seleccionada:', unidadNombre);
    } else {
      ocultarMenuUnidad();
    }
  });

  map.on('pointermove', (evt) => {
    const hasFeature = map.forEachFeatureAtPixel(evt.pixel, (feature) => {
      return vectorLayer.getSource().getFeatures().includes(feature);
    });
    map.getViewport().style.cursor = hasFeature ? 'pointer' : '';
  });
}

function mostrarMenuUnidad(nombreUnidad, feature) {
  const unitMenu = document.getElementById('unit-menu');
  window.mapState.selectedFeature = feature;
  if (unitMenu) unitMenu.classList.add('active');
  console.log(`Unidad seleccionada: ${nombreUnidad}`);
}

function ocultarMenuUnidad() {
  const unitMenu = document.getElementById('unit-menu');
  if (unitMenu) unitMenu.classList.remove('active');
  window.mapState.selectedFeature = null;
}

function inicializarModalPanelUnidad() {
  const unitPanelBtn = document.getElementById('unit-panel-btn');
  const unitModal = document.getElementById('unit-modal');
  const modalOverlay = document.getElementById('modal-overlay');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const coordinatesPanel = document.getElementById('coordinates-panel');

  if (!unitPanelBtn) return;

  unitPanelBtn.addEventListener('click', () => {
    if (unitModal) unitModal.classList.add('active');
    if (modalOverlay) modalOverlay.classList.add('active');
    if (coordinatesPanel) coordinatesPanel.style.display = 'none';
  });

  function cerrarModal() {
    if (unitModal) unitModal.classList.remove('active');
    if (modalOverlay) modalOverlay.classList.remove('active');
    if (coordinatesPanel) coordinatesPanel.style.display = 'block';
  }

  if (modalCloseBtn) modalCloseBtn.addEventListener('click', cerrarModal);
  if (modalOverlay) modalOverlay.addEventListener('click', cerrarModal);

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.getAttribute('data-tab');
      tabBtns.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.remove('active');
      });
      btn.classList.add('active');
      const pane = document.getElementById(tabName);
      if (pane) pane.classList.add('active');
    });
  });

  console.log('✓ Modal de panel de unidad inicializado');
}

function inicializarMenuUnidad() {
  const unitActions = document.querySelectorAll('.unit-action');

  unitActions.forEach(action => {
    action.addEventListener('click', (e) => {
      e.stopPropagation();
      const actionType = action.getAttribute('data-action');
      manejarAccionUnidad(actionType);
    });
  });

  console.log('✓ Menú lateral de unidad inicializado');
}

function inicializarChat() {
  const chatMinimized = document.getElementById('chat-minimized');
  const chatExpanded = document.getElementById('chat-expanded');
  const chatMinimizeBtn = document.getElementById('chat-minimize-btn');

  if (chatMinimized) {
    chatMinimized.addEventListener('click', () => {
      if (chatExpanded) chatExpanded.classList.add('active');
    });
  }

  if (chatMinimizeBtn) {
    chatMinimizeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (chatExpanded) chatExpanded.classList.remove('active');
    });
  }

  console.log('✓ Chat inicializado');
}

function manejarAccionUnidad(actionType) {
  const feature = window.mapState.selectedFeature;
  if (!feature) return;

  const unidadNombre = feature.get('nombre');

  switch(actionType) {
    case 'movement':
      console.log(`Movimiento Terrestre para: ${unidadNombre}`);
      alert(`Modo Movimiento Terrestre activado para ${unidadNombre}`);
      break;
    case 'mission':
      console.log(`Misión Especial para: ${unidadNombre}`);
      alert(`Modo Misión Especial activado para ${unidadNombre}`);
      break;
    case 'details':
      console.log(`Mostrar Detalles de: ${unidadNombre}`);
      alert(`Detalles de ${unidadNombre}: Personal ${feature.get('personal')}, Ataque ${feature.get('ataque')}, Defensa ${feature.get('defensa')}`);
      break;
  }
}

class DocumentosManager {
  constructor() {
    this.inbox = [
      {
        id: 1,
        from: 'General Rodríguez',
        to: 'Operadores',
        subject: 'Orden de Operación 001',
        date: '2025-12-15 09:30',
        body: 'Se inicia operación táctica en sector norte. Todas las unidades deben estar en posición de alerta máxima. Coordinar movimientos a través del canal táctico.',
        preview: 'Se inicia operación táctica en sector norte...'
      },
    ];

    this.outbox = [];
    this.currentFolder = 'inbox';
    this.currentView = 'list';
    this.selectedDoc = null;
    this.searchTerm = '';
  }

  getDocuments() {
    const docs = this.currentFolder === 'inbox' ? this.inbox : this.outbox;
    return this.searchTerm
      ? docs.filter(doc =>
          doc.subject.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
          doc.from.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
          doc.body.toLowerCase().includes(this.searchTerm.toLowerCase())
        )
      : docs;
  }

  switchFolder(folder) {
    this.currentFolder = folder;
    this.searchTerm = '';
    this.renderList();
  }

  showComposeView() {
    this.currentView = 'compose';
    this.renderViews();
  }

  showListView() {
    this.currentView = 'list';
    this.selectedDoc = null;
    this.renderViews();
    this.renderList();
  }

  showDetailView(docId) {
    const docs = this.getDocuments();
    this.selectedDoc = docs.find(d => d.id === docId);
    this.currentView = 'detail';
    this.renderViews();
    this.renderDetail();
  }

  sendDocument(to, subject, body) {
    if (!to || !subject || !body) {
      alert('Por favor completa todos los campos');
      return;
    }

    const newDoc = {
      id: Math.max(...this.outbox.map(d => d.id), 0) + 1,
      from: 'Yo',
      to,
      subject,
      date: new Date().toLocaleString('es-ES'),
      body,
      preview: body.substring(0, 50) + '...'
    };

    this.outbox.unshift(newDoc);
    this.switchFolder('outbox');
    alert('Documento enviado exitosamente');
  }

  renderList() {
    const docs = this.getDocuments();
    const listContainer = document.getElementById('docs-list');
    const listTitle = document.getElementById('docs-list-title');

    if (!listContainer) return;

    listTitle.textContent = this.currentFolder === 'inbox'
      ? 'Bandeja de Entrada'
      : 'Bandeja de Salida';

    listContainer.innerHTML = docs.length === 0
      ? '<div style="padding: 20px; text-align: center; color: rgba(232, 232, 232, 0.5); font-size: 12px;">Sin documentos</div>'
      : docs.map(doc => `
        <button class="docs-item" onclick="docsManager.showDetailView(${doc.id})">
          <div class="docs-item-header">
            <span class="docs-item-sender">${doc.from}</span>
            <span class="docs-item-date">${doc.date}</span>
          </div>
          <div class="docs-item-subject">${doc.subject}</div>
          <div class="docs-item-preview">${doc.preview}</div>
        </button>
      `).join('');

    this.updateFolderCounts();
  }

  renderDetail() {
    if (!this.selectedDoc) return;

    document.getElementById('detail-from').textContent = this.selectedDoc.from;
    document.getElementById('detail-to').textContent = this.selectedDoc.to;
    document.getElementById('detail-subject').textContent = this.selectedDoc.subject;
    document.getElementById('detail-date').textContent = this.selectedDoc.date;
    document.getElementById('detail-body').textContent = this.selectedDoc.body;
  }

  renderViews() {
    const views = document.querySelectorAll('.docs-view');
    views.forEach(v => v.classList.remove('active'));

    if (this.currentView === 'list') {
      const listView = document.getElementById('docs-list-view');
      if (listView) listView.classList.add('active');
    } else if (this.currentView === 'detail') {
      const detailView = document.getElementById('docs-detail-view');
      if (detailView) detailView.classList.add('active');
    } else if (this.currentView === 'compose') {
      const composeView = document.getElementById('docs-compose-view');
      if (composeView) composeView.classList.add('active');
      document.getElementById('compose-to').focus();
    }
  }

  updateFolderCounts() {
    const inboxCount = document.getElementById('inbox-count');
    const outboxCount = document.getElementById('outbox-count');
    if (inboxCount) inboxCount.textContent = this.inbox.length;
    if (outboxCount) outboxCount.textContent = this.outbox.length;
  }
}

function inicializarDocumentos() {
  window.docsManager = new DocumentosManager();

  window.docsManager.updateFolderCounts();
  window.docsManager.renderList();

  document.querySelectorAll('.docs-folder-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.docs-folder-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      window.docsManager.switchFolder(btn.getAttribute('data-folder'));
    });
  });

  const composeBtn = document.getElementById('docs-compose-btn');
  if (composeBtn) {
    composeBtn.addEventListener('click', () => {
      window.docsManager.showComposeView();
    });
  }

  const backBtn = document.getElementById('docs-back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.docsManager.showListView();
    });
  }

  const closeComposeBtn = document.getElementById('docs-close-compose-btn');
  if (closeComposeBtn) {
    closeComposeBtn.addEventListener('click', () => {
      window.docsManager.showListView();
    });
  }

  const searchInput = document.getElementById('docs-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      window.docsManager.searchTerm = e.target.value;
      window.docsManager.renderList();
    });
  }

  const sendBtn = document.getElementById('docs-send-btn');
  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      const to = document.getElementById('compose-to').value;
      const subject = document.getElementById('compose-subject').value;
      const body = document.getElementById('compose-body').value;

      window.docsManager.sendDocument(to, subject, body);

      document.getElementById('compose-to').value = '';
      document.getElementById('compose-subject').value = '';
      document.getElementById('compose-body').value = '';
    });
  }

  const draftBtn = document.getElementById('docs-draft-btn');
  if (draftBtn) {
    draftBtn.addEventListener('click', () => {
      alert('Documento guardado como borrador');
      document.getElementById('compose-to').value = '';
      document.getElementById('compose-subject').value = '';
      document.getElementById('compose-body').value = '';
      window.docsManager.showListView();
    });
  }

  const replyBtn = document.getElementById('docs-reply-btn');
  if (replyBtn) {
    replyBtn.addEventListener('click', () => {
      if (window.docsManager.selectedDoc) {
        document.getElementById('compose-to').value = window.docsManager.selectedDoc.from;
        document.getElementById('compose-subject').value =
          'RE: ' + window.docsManager.selectedDoc.subject;
        document.getElementById('compose-body').value =
          '\n\n--- Mensaje Original ---\n' +
          window.docsManager.selectedDoc.body;
        window.docsManager.showComposeView();
      }
    });
  }

  const deleteBtn = document.getElementById('docs-delete-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      if (confirm('¿Eliminar este documento?')) {
        const docs = window.docsManager.currentFolder === 'inbox'
          ? window.docsManager.inbox
          : window.docsManager.outbox;
        const idx = docs.findIndex(d => d.id === window.docsManager.selectedDoc.id);
        if (idx > -1) {
          docs.splice(idx, 1);
          window.docsManager.showListView();
        }
      }
    });
  }

  console.log('✓ Sistema de documentación inicializado');
}

// Iniciar la aplicación
inicializar();
