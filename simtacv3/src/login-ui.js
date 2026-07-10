// Gestor de interfaz de login
import Auth from './auth.js';
import Session from './session.js';

const LoginUI = {
  async init() {
    this.setupTabSwitching();
    this.setupFormHandlers();
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
