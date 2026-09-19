import { Auth } from '../lib/authStore.js';
import { navigate } from '../lib/router.js';
import { escapeHtml, showToast } from '../lib/ui.js';

export function renderLogin(root) {
  if (Auth.get().user) { navigate('#/account'); return; }

  root.innerHTML = `
    <div class="auth-page">
      <h1>Welcome Back 👋</h1>
      <p class="sub">Log in to sync your favorites everywhere.</p>
      <div id="auth-error"></div>
      <form id="login-form" novalidate>
        <div class="form-field">
          <label for="identifier">Username or Email</label>
          <input id="identifier" name="identifier" type="text" autocomplete="username" required />
        </div>
        <div class="form-field">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required />
        </div>
        <button type="submit" class="btn-pow btn-pow--pink" style="width:100%">LOG IN</button>
      </form>
      <p class="auth-switch">New here? <a href="#/register">Create an account</a></p>
    </div>
  `;

  const form = root.querySelector('#login-form');
  const errBox = root.querySelector('#auth-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.innerHTML = '';
    const identifier = form.identifier.value.trim();
    const password = form.password.value;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'LOGGING IN...';
    try {
      await Auth.login(identifier, password);
      showToast('Welcome back!');
      navigate('#/');
    } catch (err) {
      errBox.innerHTML = `<div class="form-error">💥 ${escapeHtml(err.message || 'Login failed.')}</div>`;
      submitBtn.disabled = false;
      submitBtn.textContent = 'LOG IN';
    }
  });
}
