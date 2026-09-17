// Store del estado del ejercicio.
//
// El backend es dueño del estado: acá solo se guarda la última foto recibida y
// se indexa para lookup O(1). Nada de lógica de negocio.
//
// Dos reglas que atraviesan todo el archivo:
//   1. Los ids llegan como string por REST y como number por socket. Todo lo
//      que entra al store se normaliza a Number.
//   2. La clave compuesta "tipo:id" ("unidad:10", "vehiculo:5") es la misma que
//      usa el backend en `detectado_por[]`.

import Session from './session.js';

/** Clave compuesta canónica de una entidad. */
export function clave(tipo, id) {
  return `${tipo}:${Number(id)}`;
}

function num(valor) {
  if (valor === null || valor === undefined || valor === '') return valor === 0 ? 0 : null;
  const n = Number(valor);
  return isNaN(n) ? null : n;
}

function numCampos(objeto, campos) {
  if (!objeto) return objeto;
  for (const campo of campos) {
    if (objeto[campo] !== undefined && objeto[campo] !== null) {
      const n = Number(objeto[campo]);
      if (!isNaN(n)) objeto[campo] = n;
    }
  }
  return objeto;
}

const CAMPOS_UNIDAD = [
  'id', 'posicion_x', 'posicion_y', 'posicion_base_x', 'posicion_base_y',
  'efectivo', 'efectivo_exacto', 'ataque', 'defensa',
  'velocidad_movimiento', 'distancia_recorrida', 'rango_vision_m', 'unidad_militar_base_id',
];

const CAMPOS_VEHICULO = [
  'id', 'posicion_x', 'posicion_y', 'posicion_base_x', 'posicion_base_y',
  'danio_acumulado', 'umbral_danio', 'municion_actual',
  'velocidad_desplazamiento', 'rango_vision_m', 'distancia_recorrida', 'autonomia',
  // Combustible actual del vehículo (recargable, `logistica:recargar`),
  // separado de `autonomia` (tope de catálogo) y de `distancia_recorrida`
  // (odómetro puro, nunca se toca) — backend.md, punto 18.
  'autonomia_actual',
  'vehiculo_base_id', 'unidad_padre_id',
];

const CAMPOS_ARMAMENTO = [
  'armamento_id', 'municion', 'municion_actual', 'cadencia_disparo_seg',
  'danio_unidades_pct', 'danio_vehiculos_pct', 'alcance_m',
];

/**
 * Sin esto, un registro sin `id` (o con uno no numérico) se indexa igual bajo
 * la clave `"tipo:NaN"`: se dibuja en el mapa y se puede arrastrar, pero
 * `item.id` queda `undefined` — al mandarlo por socket, `entidad_id` se cae
 * del payload (JSON descarta claves `undefined`) y el backend responde
 * "entidad_id es requerido" sin que quede claro por qué.
 */
function idValido(id) {
  return id !== null && id !== undefined && Number.isFinite(Number(id));
}

/**
 * El estado en vivo (socket) manda `posicion_x`/`posicion_y`, pero algunas
 * respuestas REST devuelven el nombre crudo de columna, `pos_x`/`pos_y`
 * (`config-catalogos.js:posicionDe` ya se defendía de esto en un solo lugar).
 * Se alinea acá, en el único punto de entrada al Store, para que TODO lo que
 * lee `entidad.posicion_x` — el mapa incluido — no tenga que saber que existe
 * el nombre alternativo.
 */
function alinearPosicion(objeto) {
  if ((objeto.posicion_x === undefined || objeto.posicion_x === null) && objeto.pos_x !== undefined) {
    objeto.posicion_x = objeto.pos_x;
  }
  if ((objeto.posicion_y === undefined || objeto.posicion_y === null) && objeto.pos_y !== undefined) {
    objeto.posicion_y = objeto.pos_y;
  }
  return objeto;
}

/**
 * Algunos eventos del socket (p. ej. `ejercicio:unidad_modificada` cuando se
 * arrastra la unidad padre) traen los vehículos anidados con el nombre crudo
 * de columna, `vehiculo_militar_id`, en vez de `id` — igual que `pos_x`/
 * `pos_y` en `alinearPosicion`. Sin este alias, `idValido(vehiculo.id)` los
 * descarta del índice y dejan de poder arrastrarse (`backend.md`, punto 11:
 * son justamente los vehículos que ya quedaron en un estado raro del lado
 * del backend).
 */
function alinearId(objeto, campoCrudo) {
  if ((objeto.id === undefined || objeto.id === null) && objeto[campoCrudo] !== undefined) {
    objeto.id = objeto[campoCrudo];
  }
  return objeto;
}

function normalizarVehiculo(vehiculo) {
  alinearPosicion(vehiculo);
  alinearId(vehiculo, 'vehiculo_militar_id');
  numCampos(vehiculo, CAMPOS_VEHICULO);
  if (Array.isArray(vehiculo.armamentos)) {
    vehiculo.armamentos.forEach((a) => numCampos(a, CAMPOS_ARMAMENTO));
  }
  if (Array.isArray(vehiculo.usuarios_ids)) vehiculo.usuarios_ids = vehiculo.usuarios_ids.map(Number);
  if (vehiculo.jugador_asignado_id !== undefined && vehiculo.jugador_asignado_id !== null) {
    vehiculo.jugador_asignado_id = Number(vehiculo.jugador_asignado_id);
  }
  return vehiculo;
}

function normalizarUnidad(unidad) {
  alinearPosicion(unidad);
  alinearId(unidad, 'unidad_militar_id');
  numCampos(unidad, CAMPOS_UNIDAD);
  if (Array.isArray(unidad.usuarios_ids)) unidad.usuarios_ids = unidad.usuarios_ids.map(Number);
  if (Array.isArray(unidad.vehiculos)) unidad.vehiculos.forEach(normalizarVehiculo);
  return unidad;
}

/** Normaliza el JSON completo del ejercicio tal como llega por socket. */
export function normalizarEstado(estado) {
  if (!estado) return estado;
  if (estado.ejercicio) {
    numCampos(estado.ejercicio, ['id', 'velocidad_ejercicio']);
  }
  if (Array.isArray(estado.jugadores)) {
    estado.jugadores.forEach((j) => {
      numCampos(j, ['id']);
      if (Array.isArray(j.unidades_ids)) j.unidades_ids = j.unidades_ids.map(Number);
      if (Array.isArray(j.vehiculos_ids)) j.vehiculos_ids = j.vehiculos_ids.map(Number);
    });
  }
  if (Array.isArray(estado.unidades)) estado.unidades.forEach(normalizarUnidad);
  if (Array.isArray(estado.vehiculos)) estado.vehiculos.forEach(normalizarVehiculo);
  return estado;
}

// --- Emisor de eventos mínimo ---------------------------------------------

const suscriptores = new Map();

function emitir(evento, datos) {
  const lista = suscriptores.get(evento);
  if (!lista) return;
  for (const cb of [...lista]) {
    try {
      cb(datos);
    } catch (e) {
      console.error(`Error en suscriptor de "${evento}":`, e);
    }
  }
}

// --- Estado ---------------------------------------------------------------

const estadoVacio = () => ({
  ejercicio: null,
  jugadores: [],
  unidades: [],
  vehiculos: [],
  mensajes: [],
  documentos: [],
  boletines: [],
});

const Store = {
  /** Ejercicio al que estamos unidos. */
  ejercicioId: null,
  /** Bando que resolvió el servidor (null para administrador). */
  bando: null,
  /** false mientras el admin no haya iniciado el ejercicio. */
  iniciado: false,
  /** JSON del ejercicio, tal como lo emite el backend. */
  estado: estadoVacio(),
  /** "tipo:id" -> { tipo, id, clave, entidad, unidadPadreId }. */
  indice: new Map(),
  /** "tipo:id" del enemigo -> Set de claves de MIS observadores que lo ven. */
  observadores: new Map(),
  /** Detalle de detección por enemigo: distancia y datos del último aviso. */
  detecciones: new Map(),
  /** Combates activos: "atacante->objetivo" -> info del último tick. */
  combates: new Map(),
  /** Entidad seleccionada en el mapa ("tipo:id"). */
  seleccion: null,
  /** true mientras el admin está en modo rebobinado (estado de solo lectura). */
  rebobinando: false,

  on(evento, callback) {
    if (!suscriptores.has(evento)) suscriptores.set(evento, new Set());
    suscriptores.get(evento).add(callback);
    return () => suscriptores.get(evento)?.delete(callback);
  },

  emitir,

  // --- Ciclo de vida -----------------------------------------------------

  setEjercicio(ejercicioId, { bando = null, iniciado = false, datos = null } = {}) {
    const bandoCambio = this.bando !== bando;
    this.ejercicioId = num(ejercicioId);
    this.bando = bando;
    this.iniciado = !!iniciado;
    // Un ejercicio sin iniciar no emite `estado_inicial`, así que el panel de
    // control no tendría ni el nombre. Se siembra con lo que ya trajo la lista
    // de ejercicios; `reemplazarEstado` lo pisa entero cuando arranque.
    if (datos && !this.estado.ejercicio) {
      this.estado.ejercicio = {
        id: num(datos.id),
        nombre: datos.nombre ?? null,
        sala: datos.sala ?? null,
        velocidad_ejercicio: Number(datos.velocidad_ejercicio ?? 1),
        estado: null,
      };
      emitir('estado', this.estado);
    } else if (bandoCambio) {
      // `ejercicio:estado_inicial` puede llegar ANTES de que se resuelva el ack
      // de `ejercicio:unirse` (Socket.IO no garantiza que la promesa del ack
      // continúe antes del próximo evento en la misma tanda): si eso pasa,
      // `reemplazarEstado` ya corrió con `bando` todavía en null y
      // `reconstruirObservadores` no marcó ni las propias ni las detectadas.
      // Al llegar el bando real hay que rehacer ambas cosas, si no la niebla
      // de guerra queda calculada mal para siempre (nada se repinta solo).
      this.reconstruirObservadores();
      emitir('estado', this.estado);
    }
    emitir('ejercicio:contexto', { ejercicioId: this.ejercicioId, bando, iniciado });
  },

  /**
   * `ejercicio:estado_inicial` es SIEMPRE un reemplazo total, nunca un merge:
   * llega al unirse, al iniciar, al restaurar un estado y al cambiar de
   * ejercicio.
   */
  reemplazarEstado(estadoCrudo) {
    const estado = normalizarEstado(structuredClone(estadoCrudo ?? {}));
    this.estado = Object.assign(estadoVacio(), estado);
    this.iniciado = true;
    if (this.estado.ejercicio?.id) this.ejercicioId = this.estado.ejercicio.id;
    this.reindexar();
    this.reconstruirObservadores();
    this.combates.clear();
    if (this.seleccion && !this.indice.has(this.seleccion)) this.seleccion = null;
    emitir('estado', this.estado);
    emitir('estado:reemplazado', this.estado);
  },

  limpiar() {
    this.ejercicioId = null;
    this.estado = estadoVacio();
    this.indice.clear();
    this.observadores.clear();
    this.detecciones.clear();
    this.combates.clear();
    this.seleccion = null;
    this.iniciado = false;
    emitir('estado', this.estado);
    emitir('estado:reemplazado', this.estado);
  },

  // --- Índice ------------------------------------------------------------

  reindexar() {
    this.indice.clear();
    for (const unidad of this.estado.unidades || []) {
      if (!idValido(unidad.id)) {
        console.warn('Store.reindexar: unidad sin id válido, se descarta', unidad);
        continue;
      }
      const k = clave('unidad', unidad.id);
      this.indice.set(k, { tipo: 'unidad', id: unidad.id, clave: k, entidad: unidad, unidadPadreId: null });
      for (const vehiculo of unidad.vehiculos || []) {
        if (!idValido(vehiculo.id)) {
          console.warn('Store.reindexar: vehículo sin id válido, se descarta', vehiculo);
          continue;
        }
        const kv = clave('vehiculo', vehiculo.id);
        this.indice.set(kv, { tipo: 'vehiculo', id: vehiculo.id, clave: kv, entidad: vehiculo, unidadPadreId: unidad.id });
      }
    }
    // Los vehículos que no cuelgan de ninguna unidad viven en la raíz.
    for (const vehiculo of this.estado.vehiculos || []) {
      if (!idValido(vehiculo.id)) {
        console.warn('Store.reindexar: vehículo sin id válido, se descarta', vehiculo);
        continue;
      }
      const kv = clave('vehiculo', vehiculo.id);
      this.indice.set(kv, { tipo: 'vehiculo', id: vehiculo.id, clave: kv, entidad: vehiculo, unidadPadreId: null });
    }
  },

  /** { tipo, id, clave, entidad, unidadPadreId } o undefined. */
  obtener(tipo, id) {
    return this.indice.get(clave(tipo, id));
  },

  obtenerPorClave(k) {
    return this.indice.get(k);
  },

  entidad(tipo, id) {
    return this.indice.get(clave(tipo, id))?.entidad;
  },

  /** Todas las entidades del ejercicio (unidades, sus vehículos y los de raíz). */
  todas() {
    return [...this.indice.values()];
  },

  nombre(tipo, id) {
    return this.entidad(tipo, id)?.nombre ?? `${tipo} ${id}`;
  },

  // --- Pertenencia y control ---------------------------------------------

  /** ¿La entidad es de mi bando? El administrador no tiene bando propio. */
  esAliada(entidad) {
    if (!entidad) return false;
    if (Session.esAdmin()) return true;
    return entidad.bando === this.bando;
  },

  esEnemiga(entidad) {
    if (!entidad) return false;
    if (Session.esAdmin()) return false;
    return !!entidad.bando && entidad.bando !== this.bando;
  },

  /**
   * ¿Controlo esta entidad? Un vehículo anidado se controla a través de su
   * unidad. El administrador puede operar sobre todo.
   */
  controlo(item) {
    if (!item) return false;
    const { entidad, unidadPadreId } = item;
    if (Session.esAdmin()) return true;
    const miId = Session.getUserId();
    if (miId === null) return false;
    if (Array.isArray(entidad.usuarios_ids) && entidad.usuarios_ids.includes(miId)) return true;
    if (Number(entidad.jugador_asignado_id) === miId) return true;
    if (unidadPadreId !== null && unidadPadreId !== undefined) {
      const padre = this.entidad('unidad', unidadPadreId);
      if (Array.isArray(padre?.usuarios_ids) && padre.usuarios_ids.includes(miId)) return true;
    }
    return false;
  },

  /** Entidades que puedo comandar. */
  mias() {
    return this.todas().filter((item) => this.controlo(item));
  },

  /** Unidades propias, para los selectores de remitente de documentos. */
  misUnidades() {
    return this.mias().filter((item) => item.tipo === 'unidad');
  },

  /** Unidades del bando, destinatarias posibles de un documento. */
  unidadesDelBando() {
    return this.todas().filter((item) => item.tipo === 'unidad' && this.esAliada(item.entidad));
  },

  // --- Niebla de guerra ---------------------------------------------------

  /**
   * Reconstruye quién ve a quién a partir de `detectado_por[]` del estado.
   * El array de una entidad dice QUIÉN LA ESTÁ VIENDO A ELLA.
   */
  reconstruirObservadores() {
    this.observadores.clear();
    this.detecciones.clear();
    for (const item of this.todas()) {
      const vistoPor = item.entidad.detectado_por;
      if (!Array.isArray(vistoPor) || vistoPor.length === 0) continue;
      // Solo interesan los observadores propios: son los que justifican que yo
      // dibuje al enemigo.
      const propios = vistoPor.filter((k) => {
        const obs = this.indice.get(k);
        return obs && this.esAliada(obs.entidad);
      });
      if (propios.length) this.observadores.set(item.clave, new Set(propios));
    }
    emitir('deteccion', null);
  },

  agregarDeteccion(evento) {
    const kObjetivo = clave(evento.entidad_tipo, evento.entidad_id);
    const kObservador = clave(evento.detectada_por.entidad_tipo, evento.detectada_por.entidad_id);
    if (!this.observadores.has(kObjetivo)) this.observadores.set(kObjetivo, new Set());
    this.observadores.get(kObjetivo).add(kObservador);
    this.detecciones.set(kObjetivo, evento);
    emitir('deteccion', { clave: kObjetivo, evento, detectada: true });
  },

  /**
   * Quita un observador. La entidad se oculta solo cuando NINGUNO de mis
   * elementos la ve: con varios observadores, el primer `perdida_de_vista` no
   * alcanza (si no, parpadea).
   */
  quitarDeteccion(evento) {
    const kObjetivo = clave(evento.entidad_tipo, evento.entidad_id);
    const kObservador = clave(evento.detectada_por.entidad_tipo, evento.detectada_por.entidad_id);
    const set = this.observadores.get(kObjetivo);
    if (set) {
      set.delete(kObservador);
      if (set.size === 0) {
        this.observadores.delete(kObjetivo);
        this.detecciones.delete(kObjetivo);
      }
    }
    emitir('deteccion', { clave: kObjetivo, evento, detectada: this.observadores.has(kObjetivo) });
  },

  observadoresDe(tipo, id) {
    return [...(this.observadores.get(clave(tipo, id)) || [])];
  },

  /** ¿Se debe dibujar esta entidad? El administrador ve todo, siempre. */
  visibleParaMi(item) {
    if (!item) return false;
    if (Session.esAdmin()) return true;
    if (this.esAliada(item.entidad)) return true;
    return this.observadores.has(item.clave);
  },

  // --- Actualizaciones puntuales -----------------------------------------

  actualizarPosicion({ entidad_tipo, entidad_id, posicion_x, posicion_y, distancia_recorrida, autonomia_actual }) {
    if (!Number.isFinite(posicion_x) || !Number.isFinite(posicion_y) ||
        Math.abs(posicion_x) > 180 || Math.abs(posicion_y) > 90) return null;
    const item = this.obtener(entidad_tipo, entidad_id);
    if (!item) return null;
    item.entidad.posicion_x = Number(posicion_x);
    item.entidad.posicion_y = Number(posicion_y);
    if (distancia_recorrida !== undefined) item.entidad.distancia_recorrida = Number(distancia_recorrida);
    if (Number.isFinite(autonomia_actual)) item.entidad.autonomia_actual = autonomia_actual;
    delete item.entidad._pendienteEnMotor;
    emitir('entidad:posicion', item);
    return item;
  },

  /** Aplica campos sueltos (movimiento, combate, edición del admin). */
  aplicarCampos(tipo, id, campos) {
    const item = this.obtener(tipo, id);
    if (!item) return null;
    Object.assign(item.entidad, campos);
    // Si el motor manda algo sobre esta entidad, es porque la conoce.
    delete item.entidad._pendienteEnMotor;
    if (tipo === 'unidad') normalizarUnidad(item.entidad);
    else normalizarVehiculo(item.entidad);
    emitir('entidad:cambio', item);
    return item;
  },

  agregarUnidad(unidadCruda) {
    const unidad = normalizarUnidad(structuredClone(unidadCruda));
    if (!idValido(unidad.id)) {
      console.warn('Store.agregarUnidad: registro sin id válido, se descarta', unidadCruda);
      return null;
    }
    const existente = this.obtener('unidad', unidad.id);
    if (existente) {
      Object.assign(existente.entidad, unidad);
    } else {
      this.estado.unidades.push(unidad);
    }
    this.reindexar();
    emitir('estado', this.estado);
    return this.obtener('unidad', unidad.id);
  },

  /**
   * Inserta o actualiza un vehículo en el estado en vivo. La usan tanto el
   * listener de `ejercicio:vehiculo_creado` (alta en caliente por socket)
   * como `config-catalogos.js` con la respuesta de `GET /vehiculos`, para el
   * caso — todavía posible — de que el vehículo se haya dado de alta por
   * REST (ejercicio sin iniciar) y haya que reflejarlo igual si el admin
   * después abre ese mismo ejercicio en el mapa.
   */
  agregarVehiculo(vehiculoCrudo, { silencioso = false, origenCatalogo = false } = {}) {
    const vehiculo = normalizarVehiculo(structuredClone(vehiculoCrudo));
    if (!idValido(vehiculo.id)) {
      console.warn('Store.agregarVehiculo: registro sin id válido, se descarta', vehiculoCrudo);
      return null;
    }
    const existente = this.obtener('vehiculo', vehiculo.id);
    if (existente) {
      Object.assign(existente.entidad, vehiculo);
    } else {
      // Reconciliado desde `GET /vehiculos` (REST): si se creó con el
      // ejercicio ya corriendo, el motor no lo conoce y cualquier orden sobre
      // él rebota con "no existe en este ejercicio" (`frontend.md`, fase 8).
      // Se marca para que la UI no ofrezca acciones que van a fallar; el flag
      // se saca solo apenas llega CUALQUIER evento real del motor sobre esta
      // entidad (`aplicarCampos`/`actualizarPosicion`).
      if (origenCatalogo) vehiculo._pendienteEnMotor = true;
      const unidadPadre = vehiculo.unidad_padre_tipo === 'unidad_militar'
        ? this.estado.unidades.find((u) => Number(u.id) === Number(vehiculo.unidad_padre_id))
        : null;
      if (unidadPadre) {
        unidadPadre.vehiculos = unidadPadre.vehiculos || [];
        unidadPadre.vehiculos.push(vehiculo);
      } else {
        this.estado.vehiculos.push(vehiculo);
      }
    }
    if (!silencioso) {
      this.reindexar();
      emitir('estado', this.estado);
    }
    return this.obtener('vehiculo', vehiculo.id);
  },

  /**
   * Reconcilia el estado en vivo con `GET /vehiculos?ejercicioId=` completo:
   * agrega los que falten (anidándolos en su unidad si ya está indexada) y
   * actualiza los que cambiaron. Cubre los vehículos dados de alta por REST
   * (catálogo, ejercicio sin iniciar) que todavía no le llegaron al motor:
   * `config-catalogos.js` la llama cada vez que recarga su tabla de
   * vehículos, así el mapa y el panel no dependen de en qué momento se
   * guardaron.
   *
   * `origenCatalogo` (default `true`) es lo que decide si un vehículo NUEVO
   * para el cliente se marca `_pendienteEnMotor`. Ponelo en `false` cuando
   * quien llama YA sabe que el motor lo tiene (p. ej. se acaba de crear con
   * `vehiculo:crear_en_ejercicio`, que es síncrono con el motor) — si no, se
   * marcaría como pendiente algo que en realidad ya funciona.
   */
  sincronizarVehiculos(lista, { origenCatalogo = true } = {}) {
    for (const v of lista || []) this.agregarVehiculo(v, { silencioso: true, origenCatalogo });
    this.reindexar();
    emitir('estado', this.estado);
  },

  /**
   * Saca una unidad del estado y con ella todo lo que la referenciaba: sus
   * vehículos anidados, las detecciones donde participa (como objetivo o como
   * observador), sus combates abiertos y la selección si era ella.
   *
   * Se usa cuando el admin la borra de la base: el backend no emite ningún
   * evento de baja, así que el estado en vivo hay que corregirlo del lado del
   * cliente. Devuelve las claves dadas de baja.
   */
  quitarUnidad(id) {
    const item = this.obtener('unidad', id);
    if (!item) return [];

    const bajas = [item.clave, ...(item.entidad.vehiculos || []).map((v) => clave('vehiculo', v.id))];
    const dadaDeBaja = new Set(bajas);

    this.estado.unidades = (this.estado.unidades || []).filter((u) => Number(u.id) !== Number(id));
    // Un vehículo de la unidad puede estar además suelto en la raíz.
    this.estado.vehiculos = (this.estado.vehiculos || [])
      .filter((v) => !dadaDeBaja.has(clave('vehiculo', v.id)));

    for (const k of dadaDeBaja) {
      this.observadores.delete(k);
      this.detecciones.delete(k);
      // También deja de ser observador de otros: si era el único que veía a un
      // enemigo, ese enemigo tiene que volver a la niebla.
      for (const [objetivo, set] of this.observadores) {
        if (!set.delete(k)) continue;
        if (set.size === 0) {
          this.observadores.delete(objetivo);
          this.detecciones.delete(objetivo);
        }
      }
      for (const kc of [...this.combates.keys()]) {
        if (kc.includes(k)) this.combates.delete(kc);
      }
      if (this.seleccion === k) this.seleccion = null;
    }

    this.reindexar();
    emitir('estado', this.estado);
    return bajas;
  },

  setEstadoEjercicio(nuevoEstado) {
    if (!this.estado.ejercicio) this.estado.ejercicio = {};
    this.estado.ejercicio.estado = nuevoEstado;
    emitir('ejercicio:estado', nuevoEstado);
  },

  estadoEjercicio() {
    return this.estado.ejercicio?.estado ?? null;
  },

  /** El ejercicio acepta movimiento/combate solo estando activo. */
  enEjecucion() {
    return this.estadoEjercicio() === 'activo';
  },

  /** ¿La entidad está en movimiento ahora mismo? (`estado_movimiento` lo pisa el motor). */
  enMovimiento(item) {
    return item?.entidad?.estado_movimiento === 'en_movimiento';
  },

  /** Un vehículo de tipo "aire": el único que tiene ruta obligatoria base→base y ataque atado a estar en movimiento. */
  esVehiculoAire(item) {
    return item?.tipo === 'vehiculo' && item.entidad?.tipo === 'aire';
  },

  /**
   * Umbral de combate: lo aplica el backend (`frontend.md`, fase 6), acá solo
   * se mira para mostrarlo/dibujarlo, nunca para autorizar un ataque.
   */
  umbralCombate(item) {
    if (!item) return 0;
    if (item.tipo === 'unidad') return 500;
    return item.entidad?.tipo === 'aire' ? 3000 : 5000;
  },

  // --- Comunicaciones ----------------------------------------------------

  agregarMensaje(mensaje) {
    this.estado.mensajes = this.estado.mensajes || [];
    this.estado.mensajes.push(mensaje);
    emitir('mensaje', mensaje);
  },

  agregarDocumento(documento) {
    this.estado.documentos = this.estado.documentos || [];
    this.estado.documentos.push(documento);
    emitir('documento', documento);
  },

  agregarBoletin(boletin) {
    this.estado.boletines = this.estado.boletines || [];
    this.estado.boletines.push(boletin);
    emitir('boletin', boletin);
  },

  // --- Combate -----------------------------------------------------------

  claveCombate(a, b) {
    return `${a}=>${b}`;
  },

  registrarCombate(evento) {
    const k = this.claveCombate(
      clave(evento.entidad_tipo, evento.entidad_id),
      clave(evento.objetivo_tipo, evento.objetivo_id),
    );
    this.combates.set(k, evento);
    emitir('combate', { clave: k, evento });
    return k;
  },

  cerrarCombate(evento) {
    const k = this.claveCombate(
      clave(evento.entidad_tipo, evento.entidad_id),
      clave(evento.objetivo_tipo, evento.objetivo_id),
    );
    this.combates.delete(k);
    emitir('combate', { clave: k, evento, finalizado: true });
  },

  // --- Selección ---------------------------------------------------------

  seleccionar(k) {
    this.seleccion = k;
    emitir('seleccion', k ? this.indice.get(k) : null);
  },

  seleccionada() {
    return this.seleccion ? this.indice.get(this.seleccion) : null;
  },
};

export default Store;
