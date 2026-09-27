import { apiPost } from '../lib/http.js';
import { Auth } from '../lib/authStore.js';
import { emptyHTML, errorHTML, loadingHTML } from '../lib/ui.js';

// The link in the "Confirm your AniNest email" message. Works signed in or out.
export async function renderVerifyEmail(root, params) {
  document.title = 'Confirm Email — AniNest';
  root.innerHTML = loadingHTML('CONFIRMING');
  try {
    await apiPost('/api/auth/verify-email', { token: params.get('token') || '' });
    if (Auth.get().user) await Auth.refresh();
    root.innerHTML = `${emptyHTML('Your email is confirmed. You can now turn on the weekly email, and we’ll let you know about new sign-ins and password changes.', '✅')}
      <div class="hero-actions" style="justify-content:center"><a class="btn-pow btn-pow--pink" href="${Auth.get().user ? '#/account' : '#/login'}">${Auth.get().user ? 'MY ACCOUNT' : 'LOG IN'}</a></div>`;
  } catch (err) {
    root.innerHTML = errorHTML(err.message || 'That link didn’t work.');
  }
}
