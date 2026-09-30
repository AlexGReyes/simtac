// Gestor de interfaz de login
import Auth from './auth.js';
import Session from './session.js';
import Api from './api.js';
import Config from './config.js';

const LoginUI = {
  async init() {
    this.setupTabSwitching();
    this.setupFormHandlers();
    this.setupPasswordPeek();
    this.setupServidor();
    this.mostrarVersion();
  },

  // Versión = fecha y hora de compilación (`scripts/version.mjs` escribe
  // `version.json` antes de cada `tauri dev`/`tauri build`).
  async mostrarVersion() {
    const el = document.getElementById('login-version');
    if (!el) return;
    try {
      const respuesta = await fetch(new URL('./version.json', import.meta.url), { cache: 'no-store' });
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
      const { version } = await respuesta.json();
      el.textContent = `Versión ${version}`;
    } catch (error) {
      console.warn('[version] version.json no se pudo leer:', error.message);
      el.textContent = 'Versión sin estampar';
    }
  },

  // Enlace "⚙ Servidor" debajo del formulario: permite corregir la dirección
  // del backend sin haber entrado. En la pantalla de login todavía no hay
  // socket (se crea al entrar y cerrar sesión recarga la página), así que acá
  // el cambio se aplica en el acto, sin reiniciar.
  setupServidor() {
    const toggle = document.getElementById('login-servidor-toggle');
    const form = document.getElementById('login-servidor-form');
    const actual = document.getElementById('login-servidor-actual');
    const input = document.getElementById('login-servidor-url');
    const guardar = document.getElementById('login-servidor-guardar');
    const estado = document.getElementById('login-servidor-estado');
    if (!toggle || !form || !input || !guardar) return;

    const pintarEstado = (texto, clase = '') => {
      estado.textContent = texto;
      estado.className = `login-servidor-estado ${clase}`;
    };
    const pintarActual = () => {
      actual.textContent = Config.backend();
    };
    pintarActual();

    toggle.addEventListener('click', () => {
      const abrir = form.hidden;
      form.hidden = !abrir;
      toggle.setAttribute('aria-expanded', String(abrir));
      if (abrir) {
        input.value = Config.backend();
        pintarEstado('');
        input.focus();
        input.select();
      }
    });

    const aplicar = async () => {
      let url;
      try {
        // Arrastra el GeoServer y las actualizaciones si vivían en el mismo
        // host: el mapa todavía no existe, se crea al entrar con estos valores.
        ({ url } = Config.fijarBackend(input.value));
      } catch (error) {
        pintarEstado(error.message, 'error');
        return;
      }
      Api.sincronizarBase();
      input.value = url;
      pintarActual();
      pintarEstado('Guardado. Probando conexión…');
      guardar.disabled = true;
      const prueba = await Api.probarConexion(url);
      guardar.disabled = false;
      pintarEstado(
        prueba.resultado === 'ok' ? `Conectado: ${prueba.detalle}.` : `Guardado, pero ${prueba.detalle}.`,
        prueba.resultado === 'ok' ? 'ok' : 'error',
      );
    };

    guardar.addEventListener('click', aplicar);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        aplicar();
      }
    });
  },

  // Muestra la contraseña solo mientras el botón del ojo está pulsado
  // (mouse, táctil o Espacio/Enter con el botón enfocado).
  setupPasswordPeek() {
    document.querySelectorAll('.password-peek').forEach(btn => {
      const input = btn.parentElement.querySelector('input');
      if (!input) return;

      const mostrar = () => {
        input.type = 'text';
        btn.classList.add('activo');
      };
      const ocultar = () => {
        input.type = 'password';
        btn.classList.remove('activo');
      };

      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault(); // no robarle el foco al campo
        btn.setPointerCapture(e.pointerId);
        mostrar();
      });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev =>
        btn.addEventListener(ev, ocultar));

      btn.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          mostrar();
        }
      });
      btn.addEventListener('keyup', (e) => {
        if (e.key === ' ' || e.key === 'Enter') ocultar();
      });
      btn.addEventListener('blur', ocultar);
    });
  },

  setupTabSwitching() {
    const tabBtns = document.querySelectorAll('.login-tab-btn');
    const forms = document.querySelectorAll('.login-form');

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabName = btn.getAttribute('data-tab');

        tabBtns.forEach(b => b.classList.remove('active'));
        forms.forEach(f => f.classList.remove('active'));

        btn.classList.add('active');
        document.querySelector(`.login-form[data-form="${tabName}"]`)?.classList.add('active');
      });
    });
  },

  setupFormHandlers() {
    const signinForm = document.getElementById('signin-form');
    const signupForm = document.getElementById('signup-form');

    if (signinForm) {
      signinForm.addEventListener('submit', (e) => this.handleSignIn(e));
    }

    if (signupForm) {
      signupForm.addEventListener('submit', (e) => this.handleSignUp(e));
    }
  },

  async handleSignIn(e) {
    e.preventDefault();

    const usuario = document.getElementById('signin-usuario').value.trim();
    const password = document.getElementById('signin-password').value;
    const errorEl = document.getElementById('signin-error');
    const loadingEl = document.getElementById('signin-loading');
    const submitBtn = e.target.querySelector('button[type="submit"]');

    errorEl.textContent = '';
    loadingEl.style.display = 'block';
    submitBtn.disabled = true;

    try {
      await Auth.login(usuario, password);
      this.showApp();
      // Llamar a inicializarApp después de mostrar el app
      setTimeout(() => window.inicializarAppAfterLogin?.(), 100);
    } catch (error) {
      errorEl.textContent = error.message;
      loadingEl.style.display = 'none';
      submitBtn.disabled = false;
    }
  },

  async handleSignUp(e) {
    e.preventDefault();

    const usuario = document.getElementById('signup-usuario').value.trim();
    const password = document.getElementById('signup-password').value;
    const nombre = document.getElementById('signup-nombre').value.trim();
    const grado = document.getElementById('signup-grado').value.trim() || null;
    const errorEl = document.getElementById('signup-error');
    const loadingEl = document.getElementById('signup-loading');
    const submitBtn = e.target.querySelector('button[type="submit"]');

    // Validaciones básicas
    if (!usuario || !password || !nombre) {
      errorEl.textContent = 'Usuario, contraseña y nombre son obligatorios';
      return;
    }

    if (password.length < 6) {
      errorEl.textContent = 'La contraseña debe tener al menos 6 caracteres';
      return;
    }

    errorEl.textContent = '';
    loadingEl.style.display = 'block';
    submitBtn.disabled = true;

    try {
      await Auth.register(usuario, password, nombre, grado);
      // Después de registrar, logear automáticamente
      await Auth.login(usuario, password);
      this.showApp();
      // Llamar a inicializarApp después de mostrar el app
      setTimeout(() => window.inicializarAppAfterLogin?.(), 100);
    } catch (error) {
      errorEl.textContent = error.message;
      loadingEl.style.display = 'none';
      submitBtn.disabled = false;
    }
  },

  hideLogin() {
    const loginScreen = document.getElementById('login-screen');
    if (loginScreen) {
      loginScreen.classList.add('hidden');
    }
  },

  showLogin() {
    const loginScreen = document.getElementById('login-screen');
    if (loginScreen) {
      loginScreen.classList.remove('hidden');
    }
  },

  showApp() {
    const appContainer = document.getElementById('app-container');
    if (appContainer) {
      appContainer.classList.add('active');
      this.hideLogin();
    }
  },

  hideApp() {
    const appContainer = document.getElementById('app-container');
    if (appContainer) {
      appContainer.classList.remove('active');
    }
  },
};

export default LoginUI;
