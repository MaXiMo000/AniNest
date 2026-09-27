import { apiPost } from '../lib/http.js';
import { navigate } from '../lib/router.js';
import { escapeHtml, showToast } from '../lib/ui.js';

// "Forgot password?" (asks for an email) and the page the emailed link opens
// (#/reset-password?token=...). See backend/src/routes/auth.js /forgot, /reset.

function errorHTML(message) {
  return `<div class="form-error">💥 ${escapeHtml(message)}</div>`;
}

export function renderForgotPassword(root) {
  document.title = 'Forgot Password — AniNest';
  root.innerHTML = `
    <div class="auth-page">
      <h1>Forgot It? 🔑</h1>
      <p class="sub">Enter the email you signed up with and we'll send you a reset link.</p>
      <div id="auth-error"></div>
      <form id="forgot-form" novalidate>
        <div class="form-field">
          <label for="email">Email</label>
          <input id="email" name="email" type="email" autocomplete="email" required />
        </div>
        <button type="submit" class="btn-pow btn-pow--pink" style="width:100%">SEND RESET LINK</button>
      </form>
      <p class="auth-switch">Remembered it? <a href="#/login">Log in</a></p>
    </div>`;

  const form = root.querySelector('#forgot-form');
  const errBox = root.querySelector('#auth-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.innerHTML = '';
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await apiPost('/api/auth/forgot', { email: form.email.value.trim() });
      form.outerHTML = `<p class="section-sub" style="text-align:center">📬 If that email has an account, a reset link is on its way. It works once, for 30 minutes.</p>`;
    } catch (err) {
      errBox.innerHTML = errorHTML(err.message || 'Something went wrong.');
      btn.disabled = false;
    }
  });
}

export function renderResetPassword(root, params) {
  document.title = 'Reset Password — AniNest';
  const token = params.get('token') || '';
  root.innerHTML = `
    <div class="auth-page">
      <h1>New Password 🔐</h1>
      <p class="sub">Pick a new password. Every device signed in to your account will be signed out.</p>
      <div id="auth-error"></div>
      <form id="reset-form" novalidate>
        <div class="form-field">
          <label for="password">New password</label>
          <input id="password" name="password" type="password" autocomplete="new-password" minlength="8" required />
        </div>
        <button type="submit" class="btn-pow btn-pow--pink" style="width:100%">SAVE PASSWORD</button>
      </form>
    </div>`;

  const form = root.querySelector('#reset-form');
  const errBox = root.querySelector('#auth-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.innerHTML = '';
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await apiPost('/api/auth/reset', { token, password: form.password.value });
      showToast('Password changed. Log in with the new one.');
      navigate('#/login');
    } catch (err) {
      errBox.innerHTML = errorHTML(err.message || 'That reset link didn’t work.');
      btn.disabled = false;
    }
  });
}
