import { Auth } from '../lib/authStore.js';
import { navigate } from '../lib/router.js';
import { escapeHtml, showToast } from '../lib/ui.js';

export function renderRegister(root) {
  if (Auth.get().user) { navigate('#/account'); return; }

  root.innerHTML = `
    <div class="auth-page">
      <h1>Join AniNest 🐣</h1>
      <p class="sub">Create an account to save favorites across devices.</p>
      <div id="auth-error"></div>
      <form id="register-form" novalidate>
        <div class="form-field">
          <label for="username">Username</label>
          <input id="username" name="username" type="text" autocomplete="username" minlength="3" maxlength="20" pattern="[a-zA-Z0-9_]+" required />
          <span class="form-hint">3–20 characters: letters, numbers, underscores.</span>
        </div>
        <div class="form-field">
          <label for="email">Email</label>
          <input id="email" name="email" type="email" autocomplete="email" required />
        </div>
        <div class="form-field">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="new-password" minlength="8" required />
          <span class="form-hint">At least 8 characters, with a letter and a number.</span>
        </div>
        <div class="form-field">
          <label for="confirm">Confirm Password</label>
          <input id="confirm" name="confirm" type="password" autocomplete="new-password" required />
        </div>
        <button type="submit" class="btn-pow btn-pow--pink" style="width:100%">CREATE ACCOUNT</button>
      </form>
      <p class="auth-switch">Already have an account? <a href="#/login">Log in</a></p>
    </div>
  `;

  const form = root.querySelector('#register-form');
  const errBox = root.querySelector('#auth-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.innerHTML = '';
    const username = form.username.value.trim();
    const email = form.email.value.trim();
    const password = form.password.value;
    const confirm = form.confirm.value;

    if (password !== confirm) {
      errBox.innerHTML = `<div class="form-error">💥 Passwords don't match.</div>`;
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'CREATING...';
    try {
      await Auth.register(username, email, password);
      showToast('Account created! Welcome to AniNest.');
      navigate('#/');
    } catch (err) {
      errBox.innerHTML = `<div class="form-error">💥 ${escapeHtml(err.message || 'Registration failed.')}</div>`;
      submitBtn.disabled = false;
      submitBtn.textContent = 'CREATE ACCOUNT';
    }
  });
}
