import { Auth } from '../lib/authStore.js';
import { navigate } from '../lib/router.js';
import { escapeHtml, showToast } from '../lib/ui.js';

// Second step for accounts with two-factor login on.
function showCodeStep(root, ticket) {
  const box = root.querySelector('.auth-page');
  box.innerHTML = `
    <h1>One More Step 🔐</h1>
    <p class="sub">Enter the 6-digit code from your authenticator app. Lost your phone? Use one of your recovery codes.</p>
    <div id="auth-error"></div>
    <form id="code-form" novalidate>
      <div class="form-field">
        <label for="code">Code</label>
        <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="20" required autofocus />
      </div>
      <button type="submit" class="btn-pow btn-pow--pink" style="width:100%">VERIFY</button>
    </form>
    <p class="auth-switch"><a href="#/login" id="restart-login">Start over</a></p>`;
  const form = box.querySelector('#code-form');
  const errBox = box.querySelector('#auth-error');
  box.querySelector('#restart-login').addEventListener('click', (e) => { e.preventDefault(); renderLogin(root); });
  form.code.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.innerHTML = '';
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await Auth.loginSecondStep(ticket, form.code.value.trim());
      showToast('Welcome back!');
      navigate('#/');
    } catch (err) {
      if (err.restart) { renderLogin(root); showToast(err.message); return; }
      errBox.innerHTML = `<div class="form-error">💥 ${escapeHtml(err.message || 'That code didn’t work.')}</div>`;
      btn.disabled = false;
      form.code.select();
    }
  });
}

export function renderLogin(root) {
  document.title = 'Log In — AniNest';
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
      <p class="auth-switch"><a href="#/forgot-password">Forgot your password?</a></p>
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
      const result = await Auth.login(identifier, password);
      if (result?.twoFactor) { showCodeStep(root, result.ticket); return; }
      showToast('Welcome back!');
      navigate('#/');
    } catch (err) {
      errBox.innerHTML = `<div class="form-error">💥 ${escapeHtml(err.message || 'Login failed.')}</div>`;
      submitBtn.disabled = false;
      submitBtn.textContent = 'LOG IN';
    }
  });
}
