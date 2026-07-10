// Variables globales
window.mapState = {
  currentZoom: 14,
  mouseCoordinates: { lon: 0, lat: 0, x: 0, y: 0 },
  ratio: window.devicePixelRatio || 1,
};

// Función para actualizar los relojes
function actualizarRelojes() {
  const ahora = new Date();
  const utcTime = new Date(ahora.getTime() + ahora.getTimezoneOffset() * 60000);

  // Hora local
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

  // Hora UTC
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

  document.getElementById('local-time').textContent = localTimeStr;
  document.getElementById('local-date').textContent = localDateStr;
  document.getElementById('utc-time').textContent = utcTimeStr;
  document.getElementById('utc-date').textContent = utcDateStr;
}

window.addEventListener("DOMContentLoaded", async () => {
  console.log("=== INICIANDO APLICACIÓN ===");
  console.log("window.__TAURI__ disponible:", !!window.__TAURI__);
  console.log("milsymbol (ms) disponible:", typeof ms !== "undefined");
  console.log("OpenLayers (ol) disponible:", typeof ol !== "undefined");

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

  console.log("Mapa creado exitosamente");

  // Actualizar relojes inmediatamente y cada segundo
  actualizarRelojes();
  setInterval(actualizarRelojes, 1000);

  // Configurar listeners del mapa
  configurarListenersMapa(map);

  // Inicializar modal de panel de unidad
  inicializarModalPanelUnidad();

  // Inicializar menú lateral de unidad
  inicializarMenuUnidad();

  await cargarUnidades(map);
});

function configurarListenersMapa(map) {
  const view = map.getView();
  const zoomElement = document.getElementById("zoom-level");
  const coordinatesElement = document.getElementById("mouse-coordinates");

  // Listener para cambios de zoom
  view.on("change:resolution", () => {
    const zoom = view.getZoom();
    window.mapState.currentZoom = zoom;
    zoomElement.textContent = `Zoom: ${zoom.toFixed(2)}`;
  });

  // Listener para movimiento del mouse en el mapa
  map.on("pointermove", (evt) => {
    const coordinate = map.getEventCoordinate(evt.originalEvent);
    const lonLat = ol.proj.toLonLat(coordinate);

    window.mapState.mouseCoordinates = {
      lon: lonLat[0],
      lat: lonLat[1],
      x: coordinate[0],
      y: coordinate[1],
    };

    coordinatesElement.textContent = `Coordenadas: ${lonLat[0].toFixed(4)}°, ${lonLat[1].toFixed(4)}°`;
  });

  // Inicializar zoom en el panel
  zoomElement.textContent = `Zoom: ${view.getZoom().toFixed(2)}`;

  console.log("Listeners del mapa configurados");
}

async function cargarUnidades(map) {
  try {
    console.log("1. Iniciando carga de unidades...");
    console.log("2. Verificando window.__TAURI__:", typeof window.__TAURI__);

    const { invoke } = window.__TAURI__.core;
    console.log("3. Función invoke disponible:", typeof invoke);

    const estado = await invoke("cargar_estado_actual");
    console.log("4. Estado cargado desde Rust:", estado);

    const todasLasUnidades = [
      ...estado.unidadesRojas,
      ...estado.unidadesAzules,
      ...estado.unidadesNeutrales,
    ];
    console.log("5. Total de unidades:", todasLasUnidades.length);

    const vectorSource = new ol.source.Vector();
    console.log("6. Vector source creado");

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
      title: "Unidades Militares",
    });

    map.addLayer(vectorLayer);
    console.log("7. Capa de vector agregada al mapa");
    console.log(`✓ Cargadas ${todasLasUnidades.length} unidades en el mapa`);

    // Agregar evento de click en los símbolos
    configurarClickEnUnidades(map, vectorLayer);
  } catch (error) {
    console.error("✗ Error al cargar unidades:", error);
    console.error("   Stack:", error.stack);
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
      console.log("Unidad seleccionada:", unidadNombre);
    } else {
      ocultarMenuUnidad();
    }
  });

  // Cambiar cursor al pasar sobre unidades
  map.on('pointermove', (evt) => {
    const hasFeature = map.forEachFeatureAtPixel(evt.pixel, (feature) => {
      return vectorLayer.getSource().getFeatures().includes(feature);
    });
    map.getViewport().style.cursor = hasFeature ? 'pointer' : '';
  });
}

function mostrarMenuUnidad(nombreUnidad, feature) {
  const unitMenu = document.getElementById('unit-menu');

  // Guardar feature seleccionada en el estado global
  window.mapState.selectedFeature = feature;

  unitMenu.classList.add('active');
  console.log(`Unidad seleccionada: ${nombreUnidad}`);
}

function ocultarMenuUnidad() {
  const unitMenu = document.getElementById('unit-menu');
  unitMenu.classList.remove('active');
  window.mapState.selectedFeature = null;
}

// === GESTIÓN DEL MODAL DE PANEL DE UNIDAD ===
function inicializarModalPanelUnidad() {
  const unitPanelBtn = document.getElementById('unit-panel-btn');
  const unitModal = document.getElementById('unit-modal');
  const modalOverlay = document.getElementById('modal-overlay');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const tabBtns = document.querySelectorAll('.tab-btn');

  // Abrir modal
  unitPanelBtn.addEventListener('click', () => {
    unitModal.classList.add('active');
    modalOverlay.classList.add('active');
  });

  // Cerrar modal
  function cerrarModal() {
    unitModal.classList.remove('active');
    modalOverlay.classList.remove('active');
  }

  modalCloseBtn.addEventListener('click', cerrarModal);
  modalOverlay.addEventListener('click', cerrarModal);

  // Cambiar de pestaña
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.getAttribute('data-tab');

      // Remover clase activa de todos los botones y pestañas
      tabBtns.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.remove('active');
      });

      // Agregar clase activa al botón clickeado y su pestaña
      btn.classList.add('active');
      document.getElementById(tabName).classList.add('active');
    });
  });

  console.log("Modal de panel de unidad inicializado");
}

// === GESTIÓN DEL MENÚ LATERAL DE UNIDAD ===
function inicializarMenuUnidad() {
  const unitActions = document.querySelectorAll('.unit-action');

  // Manejadores de acciones
  unitActions.forEach(action => {
    action.addEventListener('click', (e) => {
      e.stopPropagation();
      const actionType = action.getAttribute('data-action');
      manejarAccionUnidad(actionType);
    });
  });

  console.log("Menú lateral de unidad inicializado");
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
